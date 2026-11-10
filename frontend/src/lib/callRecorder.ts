/**
 * Records every participant of a LiveKit call on its own track (exact speaker attribution) in standalone
 * segments of a few minutes, uploaded as soon as they close: a crash or a closed tab loses at most one segment.
 * Segments with no voice (level never above the threshold) are not uploaded, which saves transcription cost and
 * avoids Whisper inventing text on silence.
 */
export type SegmentMeta = { identity: string; name: string; offsetMs: number; durationMs: number; mimeType: string }
export type SegmentUpload = (blob: Blob, meta: SegmentMeta) => Promise<void>

const SEGMENT_MS = 3 * 60 * 1000
const LEVEL_SAMPLE_MS = 200
const VOICE_RMS = 0.02

type TrackRecording = {
  identity: string
  name: string
  stream: MediaStream
  recorder: MediaRecorder | null
  chunks: Blob[]
  segmentStart: number
  voiced: boolean
  timer: ReturnType<typeof setTimeout> | null
  sampler: ReturnType<typeof setInterval> | null
  analyser: AnalyserNode | null
  source: MediaStreamAudioSourceNode | null
}

function pickMimeType(): string {
  const options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
  return options.find((type) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type)) || ''
}

export class CallRecorder {
  private tracks = new Map<string, TrackRecording>()
  private startedAt = 0
  private pending = new Set<Promise<void>>()
  private context: AudioContext | null = null
  private mimeType = pickMimeType()
  private stopped = false
  onError?: (message: string) => void

  constructor(private upload: SegmentUpload) {}

  static supported() {
    return typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && !!pickMimeType()
  }

  start(startedAt = Date.now()) {
    this.startedAt = startedAt
    this.stopped = false
    try {
      this.context = new AudioContext()
    } catch {
      this.context = null // level detection off: every segment is uploaded
    }
  }

  trackKeys() {
    return [...this.tracks.keys()]
  }

  get active() {
    return this.startedAt > 0 && !this.stopped
  }

  /** Start (or keep) recording a participant's audio track. `key` must be unique per track. */
  addTrack(key: string, identity: string, name: string, track: MediaStreamTrack) {
    if (!this.active || this.tracks.has(key)) return
    const stream = new MediaStream([track])
    const entry: TrackRecording = {
      identity, name, stream, recorder: null, chunks: [], segmentStart: Date.now(), voiced: false,
      timer: null, sampler: null, analyser: null, source: null,
    }
    if (this.context) {
      try {
        entry.source = this.context.createMediaStreamSource(stream)
        entry.analyser = this.context.createAnalyser()
        entry.analyser.fftSize = 1024
        entry.source.connect(entry.analyser)
        const buffer = new Float32Array(entry.analyser.fftSize)
        entry.sampler = setInterval(() => {
          if (!entry.analyser || entry.voiced) return
          entry.analyser.getFloatTimeDomainData(buffer)
          let sum = 0
          for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i]
          if (Math.sqrt(sum / buffer.length) > VOICE_RMS) entry.voiced = true
        }, LEVEL_SAMPLE_MS)
      } catch {
        entry.voiced = true
      }
    } else {
      entry.voiced = true
    }
    this.tracks.set(key, entry)
    this.startSegment(entry)
  }

  removeTrack(key: string) {
    const entry = this.tracks.get(key)
    if (!entry) return
    this.tracks.delete(key)
    this.closeSegment(entry, false)
    if (entry.sampler) clearInterval(entry.sampler)
    entry.source?.disconnect()
  }

  /** Stop everything and wait until the last segments are uploaded. */
  async stop() {
    if (this.stopped) return
    this.stopped = true
    for (const key of [...this.tracks.keys()]) this.removeTrack(key)
    // MediaRecorder.onstop fires asynchronously: give it a tick before waiting for uploads.
    await new Promise((resolve) => setTimeout(resolve, 300))
    await Promise.allSettled([...this.pending])
    try { await this.context?.close() } catch { /* already closed */ }
    this.context = null
  }

  private startSegment(entry: TrackRecording) {
    if (this.stopped) return
    let recorder: MediaRecorder
    try {
      recorder = this.mimeType ? new MediaRecorder(entry.stream, { mimeType: this.mimeType }) : new MediaRecorder(entry.stream)
    } catch {
      this.onError?.('Il browser non riesce a registrare questa traccia audio')
      return
    }
    entry.recorder = recorder
    entry.chunks = []
    entry.segmentStart = Date.now()
    entry.voiced = !this.context
    recorder.ondataavailable = (event) => { if (event.data.size) entry.chunks.push(event.data) }
    recorder.start(5000)
    entry.timer = setTimeout(() => {
      this.closeSegment(entry, true)
    }, SEGMENT_MS)
  }

  /** Close the current segment, upload it if someone spoke, and optionally start the next one. */
  private closeSegment(entry: TrackRecording, restart: boolean) {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    const recorder = entry.recorder
    entry.recorder = null
    if (!recorder || recorder.state === 'inactive') return
    const segmentStart = entry.segmentStart
    const voiced = entry.voiced
    const chunks = entry.chunks
    recorder.onstop = () => {
      const durationMs = Date.now() - segmentStart
      if (!voiced || !chunks.length) return
      const blob = new Blob(chunks, { type: recorder.mimeType || this.mimeType || 'audio/webm' })
      const job = this.upload(blob, {
        identity: entry.identity, name: entry.name, offsetMs: Math.max(0, segmentStart - this.startedAt),
        durationMs, mimeType: blob.type,
      }).catch(() => this.onError?.('Un segmento della registrazione non è stato caricato'))
      this.pending.add(job)
      void job.finally(() => this.pending.delete(job))
    }
    try { recorder.stop() } catch { /* already stopped */ }
    if (restart && this.tracks.get(this.keyOf(entry)) === entry) this.startSegment(entry)
  }

  private keyOf(entry: TrackRecording) {
    for (const [key, value] of this.tracks) if (value === entry) return key
    return ''
  }
}
