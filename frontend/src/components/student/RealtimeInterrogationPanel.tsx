import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Mic, Square, X, GraduationCap, Volume2, Search, KeyRound, Send } from '@/components/icons'
import { llmApi, type InquiryState } from '@/lib/api'

interface AccentColors {
  accent: string
  text: string
  soft: string
  softStrong: string
  border: string
}

/** Where the realtime voice session comes from: the oral-exam profile, or a teacher-created bot. */
export type VoiceSessionSource =
  | { kind: 'interrogation' }
  | { kind: 'teacherbot'; teacherbotId: string; botName: string }
  | { kind: 'inquiry'; teacherbotId: string; botName: string }

interface RealtimeInterrogationPanelProps {
  /** Pre-filled exam topic; the student can still edit it before starting. */
  initialTopic?: string
  language: 'it' | 'en'
  accent: AccentColors
  onClose: () => void
  /** Called with each finalised spoken turn so it can be mirrored into the chat. */
  onTurn?: (role: 'user' | 'assistant', text: string) => void
  /** Which backend session to mint. Defaults to the oral-exam interrogation. */
  sessionSource?: VoiceSessionSource
  /** Existing text turns used to continue the same conversation in voice. */
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
}

type Phase = 'setup' | 'connecting' | 'live' | 'error'
/** idle = student's turn to talk · recording = holding mic · responding = professor speaking */
type TurnState = 'idle' | 'recording' | 'responding'

interface TranscriptTurn {
  id: string
  role: 'user' | 'assistant'
  text: string
  final: boolean
}

const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls'
const MIN_HOLD_MS = 250

type Gender = 'female' | 'male'
type Style = 'warm' | 'natural' | 'strict'
type Pace = 'slow' | 'normal' | 'fast'

// marin (female) and cedar (male) are the most natural/expressive gpt-realtime voices.
const VOICE_BY_GENDER: Record<Gender, string> = { female: 'marin', male: 'cedar' }
const VOICE_PREFS_KEY = 'interrogation_voice_prefs'

interface VoicePrefs { gender: Gender; style: Style; pace: Pace }

function loadVoicePrefs(): VoicePrefs {
  try {
    const raw = localStorage.getItem(VOICE_PREFS_KEY)
    if (raw) return { gender: 'female', style: 'warm', pace: 'normal', ...JSON.parse(raw) }
  } catch { /* noop */ }
  return { gender: 'female', style: 'warm', pace: 'normal' }
}

/**
 * Dual real-time visualiser: mirrored frequency bars for the AI voice (top, accent)
 * and the student's microphone (bottom, emerald). Driven by two WebAudio analysers.
 */
function DualVisualizer({
  aiAnalyser,
  micAnalyser,
  accent,
}: {
  aiAnalyser: AnalyserNode | null
  micAnalyser: AnalyserNode | null
  accent: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      canvas.width = rect.width * dpr
      canvas.height = rect.height * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()

    const BARS = 48
    const aiBuf = aiAnalyser ? new Uint8Array(new ArrayBuffer(aiAnalyser.frequencyBinCount)) : null
    const micBuf = micAnalyser ? new Uint8Array(new ArrayBuffer(micAnalyser.frequencyBinCount)) : null
    const aiHeights = new Array(BARS).fill(0)
    const micHeights = new Array(BARS).fill(0)
    let raf = 0

    const sampleInto = (analyser: AnalyserNode | null, buf: Uint8Array<ArrayBuffer> | null, target: number[]) => {
      if (!analyser || !buf) {
        for (let i = 0; i < BARS; i++) target[i] *= 0.82
        return
      }
      analyser.getByteFrequencyData(buf)
      const step = Math.floor(buf.length / BARS) || 1
      for (let i = 0; i < BARS; i++) {
        const v = buf[i * step] / 255
        target[i] = target[i] * 0.6 + v * 0.4
      }
    }

    const draw = () => {
      const rect = canvas.getBoundingClientRect()
      const w = rect.width
      const h = rect.height
      const mid = h / 2
      ctx.clearRect(0, 0, w, h)

      const gap = 3
      const barW = (w - gap * (BARS - 1)) / BARS

      sampleInto(aiAnalyser, aiBuf, aiHeights)
      sampleInto(micAnalyser, micBuf, micHeights)

      for (let i = 0; i < BARS; i++) {
        const x = i * (barW + gap)
        const aiH = Math.max(2, aiHeights[i] * (mid - 6))
        const micH = Math.max(2, micHeights[i] * (mid - 6))

        ctx.fillStyle = accent
        ctx.globalAlpha = 0.9
        roundedBar(ctx, x, mid - aiH, barW, aiH, barW / 2)

        ctx.fillStyle = '#10b981'
        ctx.globalAlpha = 0.8
        roundedBar(ctx, x, mid, barW, micH, barW / 2)
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }

    draw()
    window.addEventListener('resize', resize)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [aiAnalyser, micAnalyser, accent])

  return <canvas ref={canvasRef} className="h-full w-full" />
}

function roundedBar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + radius, y)
  ctx.arcTo(x + w, y, x + w, y + h, radius)
  ctx.arcTo(x + w, y + h, x, y + h, radius)
  ctx.arcTo(x, y + h, x, y, radius)
  ctx.arcTo(x, y, x + w, y, radius)
  ctx.closePath()
  ctx.fill()
}

function Segmented({
  label,
  value,
  options,
  accent,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  accent: AccentColors
  onChange: (value: string) => void
}) {
  void accent
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-semibold text-[var(--text-secondary)]">{label}</span>
      <div className="inline-flex rounded-full border border-[color:var(--border-subtle)] bg-[var(--surface-muted)] p-0.5">
        {options.map((opt) => {
          const active = opt.value === value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition-all ${
                active
                  ? 'border border-[color:var(--selection-border)] bg-[image:var(--selection-bg)] text-[var(--selection-text)] shadow-sm'
                  : 'border border-transparent text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function SuspectAvatar({ name, url, size, accent }: { name: string; url: string | null; size: number; accent: string }) {
  return (
    <span
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full font-black text-white ring-2 ring-white/70"
      style={{ width: size, height: size, backgroundColor: accent, fontSize: size * 0.42 }}
    >
      {url ? <img src={url} alt={name} className="h-full w-full object-cover" /> : (name.trim().slice(0, 1).toUpperCase() || '?')}
    </span>
  )
}

export default function RealtimeInterrogationPanel({
  initialTopic = '',
  language,
  accent,
  onClose,
  onTurn,
  sessionSource = { kind: 'interrogation' },
  conversationHistory = [],
}: RealtimeInterrogationPanelProps) {
  const isEnglish = language === 'en'
  const isInquiry = sessionSource.kind === 'inquiry'
  const isTeacherbot = sessionSource.kind === 'teacherbot' || isInquiry
  const seededHistory = (isInquiry ? [] : conversationHistory)
    .filter(turn => turn.content?.trim())
    .slice(-24)
    .map(turn => ({ role: turn.role, content: turn.content.trim().slice(0, 4000) }))
  const hasPreviousContext = seededHistory.length > 0
  const speakerName = (sessionSource.kind === 'teacherbot' || sessionSource.kind === 'inquiry')
    ? sessionSource.botName
    : (isEnglish ? 'Professor' : 'Professore')
  const [phase, setPhase] = useState<Phase>('setup')
  const [turnState, setTurnState] = useState<TurnState>('idle')
  const [topic, setTopic] = useState(initialTopic)
  const [prefs, setPrefs] = useState<VoicePrefs>(loadVoicePrefs)
  const [error, setError] = useState<string | null>(null)

  const updatePrefs = useCallback((patch: Partial<VoicePrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch }
      try { localStorage.setItem(VOICE_PREFS_KEY, JSON.stringify(next)) } catch { /* noop */ }
      return next
    })
  }, [])
  const [turns, setTurns] = useState<TranscriptTurn[]>([])
  const [audioBlocked, setAudioBlocked] = useState(false)

  // ── Inquiry (investigative NPC) state ──
  const [inquiry, setInquiry] = useState<InquiryState | null>(null)
  const [debugInfo, setDebugInfo] = useState<{ flag: string | null; intent: string; trust: number; pressure: number } | null>(null)
  const [newClue, setNewClue] = useState<string | null>(null)
  const [restartNext, setRestartNext] = useState(false)
  const [activeSuspectId, setActiveSuspectId] = useState<string | null>(null)
  const activeSuspectRef = useRef<string | null>(null)
  const turnsCacheRef = useRef<Record<string, TranscriptTurn[]>>({})
  const [accusedId, setAccusedId] = useState<string | null>(null)
  const [answerText, setAnswerText] = useState('')
  const [answerBusy, setAnswerBusy] = useState(false)
  const [answerResult, setAnswerResult] = useState<{ correct: boolean; score: number; feedback: string; correct_answer?: string; truth?: string; culprit?: { id: string; name: string } } | null>(null)
  const inquirySessionRef = useRef<string | null>(null)
  const fillerIdRef = useRef<string | null>(null)
  const fillerActiveRef = useRef(false)
  const awaitingTurnRef = useRef(false)
  // null = nothing pending · '' = plain reply (classifier failed) · text = stage direction to inject
  const pendingDirectiveRef = useRef<string | null>(null)

  const pcRef = useRef<RTCPeerConnection | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const micStreamRef = useRef<MediaStream | null>(null)
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const [aiAnalyser, setAiAnalyser] = useState<AnalyserNode | null>(null)
  const [micAnalyser, setMicAnalyser] = useState<AnalyserNode | null>(null)
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const holdStartRef = useRef<number>(0)
  // Accumulators for streaming transcript deltas, keyed by item/response id.
  const aiBufferRef = useRef<Record<string, string>>({})
  const userBufferRef = useRef<Record<string, string>>({})

  const cleanup = useCallback(() => {
    try { dcRef.current?.close() } catch { /* noop */ }
    dcRef.current = null
    const pc = pcRef.current
    pcRef.current = null
    if (pc) {
      pc.getSenders().forEach((s) => { try { s.track?.stop() } catch { /* noop */ } })
      try { pc.close() } catch { /* noop */ }
    }
    micStreamRef.current?.getTracks().forEach((t) => { try { t.stop() } catch { /* noop */ } })
    micStreamRef.current = null
    if (audioElRef.current) audioElRef.current.srcObject = null
    void audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    setAiAnalyser(null)
    setMicAnalyser(null)
    setTurnState('idle')
    fillerActiveRef.current = false
    fillerIdRef.current = null
    awaitingTurnRef.current = false
    pendingDirectiveRef.current = null
  }, [])

  useEffect(() => () => cleanup(), [cleanup])

  useEffect(() => {
    const el = transcriptScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns])

  const sendEvent = useCallback((event: Record<string, unknown>) => {
    const dc = dcRef.current
    if (dc?.readyState === 'open') {
      try { dc.send(JSON.stringify(event)) } catch { /* noop */ }
    }
  }, [])

  const upsertTurn = useCallback((id: string, role: 'user' | 'assistant', text: string, final: boolean) => {
    setTurns((prev) => {
      const idx = prev.findIndex((t) => t.id === id)
      if (idx === -1) return [...prev, { id, role, text, final }]
      const next = [...prev]
      next[idx] = { ...next[idx], text, final }
      return next
    })
    if (final && text.trim()) {
      if (inquirySessionRef.current) {
        if (role === 'assistant') {
          void llmApi.inquiryLog(inquirySessionRef.current, [{ role, text: text.trim() }], activeSuspectRef.current ?? undefined).catch(() => {})
        }
      } else {
        onTurn?.(role, text.trim())
      }
    }
  }, [onTurn])

  /** Send the pending stage direction + real reply once the "Hmm…" filler has finished. */
  const flushInquiryReply = useCallback(() => {
    if (pendingDirectiveRef.current === null || fillerActiveRef.current) return
    const direction = pendingDirectiveRef.current
    pendingDirectiveRef.current = null
    awaitingTurnRef.current = false
    if (direction) {
      sendEvent({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'system', content: [{ type: 'input_text', text: direction }] },
      })
    }
    sendEvent({ type: 'response.create' })
  }, [sendEvent])

  /** Out-of-band, history-free interjection that covers the classifier latency. */
  const sendFiller = useCallback(() => {
    fillerActiveRef.current = true
    sendEvent({
      type: 'response.create',
      response: {
        conversation: 'none',
        output_modalities: ['audio'],
        metadata: { kind: 'filler' },
        instructions: isEnglish
          ? 'Utter exactly ONE of these sounds and nothing else: "Hmm…", "Pfft…" or "Uhm…". No words, no sentences.'
          : 'Emetti ESATTAMENTE UNO di questi suoni e nient\'altro: "Hmm…", "Bah…" oppure "Ehm…". Nessuna parola, nessuna frase.',
      },
    })
  }, [sendEvent, isEnglish])

  const runInquiryTurn = useCallback(async (text: string) => {
    const sid = inquirySessionRef.current
    if (!sid) return
    try {
      const { data } = await llmApi.inquiryTurn(sid, text, language, activeSuspectRef.current ?? undefined)
      pendingDirectiveRef.current = data.stage_direction
      setInquiry(data.state)
      if (data.debug) setDebugInfo({ flag: data.flag, ...data.debug })
      if (data.new_clue) {
        setNewClue(data.new_clue.text)
        window.setTimeout(() => setNewClue(null), 6000)
      }
    } catch (err) {
      console.error('Inquiry turn failed:', err)
      pendingDirectiveRef.current = ''
    }
    flushInquiryReply()
  }, [language, flushInquiryReply])

  const handleServerEvent = useCallback((evt: any) => {
    const type: string = evt?.type || ''

    const respMeta = evt?.response?.metadata
    if (type === 'response.created') {
      if (respMeta?.kind === 'filler') fillerIdRef.current = evt.response?.id ?? null
      setTurnState('responding')
      return
    }
    if (type === 'response.done' || type === 'response.completed') {
      if (respMeta?.kind === 'filler' || (evt.response?.id && evt.response.id === fillerIdRef.current)) {
        fillerActiveRef.current = false
        fillerIdRef.current = null
        flushInquiryReply()
        return
      }
      setTurnState('idle')
      return
    }
    // The "Hmm…" filler is out-of-band: keep it out of the transcript.
    if (fillerIdRef.current && evt.response_id === fillerIdRef.current && type.includes('transcript')) return

    // AI spoken-answer transcript (streamed).
    if ((type.endsWith('output_audio_transcript.delta') || type.endsWith('audio_transcript.delta')) && !type.includes('input_audio')) {
      const key = evt.item_id || evt.response_id || 'ai'
      aiBufferRef.current[key] = (aiBufferRef.current[key] || '') + (evt.delta || '')
      upsertTurn(`ai-${key}`, 'assistant', aiBufferRef.current[key], false)
      return
    }
    if ((type.endsWith('output_audio_transcript.done') || type.endsWith('audio_transcript.done')) && !type.includes('input_audio')) {
      const key = evt.item_id || evt.response_id || 'ai'
      upsertTurn(`ai-${key}`, 'assistant', evt.transcript ?? aiBufferRef.current[key] ?? '', true)
      delete aiBufferRef.current[key]
      return
    }

    // Student speech transcription (runs after the buffer is committed).
    if (type.endsWith('input_audio_transcription.delta')) {
      const key = evt.item_id || 'user'
      userBufferRef.current[key] = (userBufferRef.current[key] || '') + (evt.delta || '')
      upsertTurn(`user-${key}`, 'user', userBufferRef.current[key], false)
      return
    }
    if (type.endsWith('input_audio_transcription.completed')) {
      const key = evt.item_id || 'user'
      const finalText: string = evt.transcript ?? userBufferRef.current[key] ?? ''
      upsertTurn(`user-${key}`, 'user', finalText, true)
      delete userBufferRef.current[key]
      if (awaitingTurnRef.current && inquirySessionRef.current) {
        const clean = finalText.trim()
        if (clean) {
          void runInquiryTurn(clean)
        } else {
          pendingDirectiveRef.current = ''
          flushInquiryReply()
        }
      }
      return
    }

    if (type === 'error') {
      const message = evt?.error?.message
      if (message) setError(message)
    }
  }, [upsertTurn, flushInquiryReply, runInquiryTurn])

  const start = useCallback(async (suspectId?: string) => {
    setError(null)
    setPhase('connecting')
    try {
      const voiceOpts = {
        voice: VOICE_BY_GENDER[prefs.gender],
        style: prefs.style,
        pace: prefs.pace,
        history: seededHistory,
      }
      let resumedInquiry = false
      let data: { value: string; model: string }
      if (sessionSource.kind === 'inquiry') {
        const res = await llmApi.createRealtimeInquirySession(sessionSource.teacherbotId, language, {
          voice: voiceOpts.voice, restart: restartNext, suspect_id: suspectId ?? activeSuspectRef.current ?? undefined,
        })
        data = res.data
        resumedInquiry = res.data.resumed
        inquirySessionRef.current = res.data.state.session_id
        if (restartNext) { turnsCacheRef.current = {}; setRestartNext(false); setAccusedId(null) }
        activeSuspectRef.current = res.data.suspect_id
        setActiveSuspectId(res.data.suspect_id)
        setTurns(turnsCacheRef.current[res.data.suspect_id] ?? [])
        setInquiry(res.data.state)
        setAnswerResult(null)
        setDebugInfo(null)
      } else {
        data = (sessionSource.kind === 'teacherbot'
          ? await llmApi.createRealtimeTeacherbotSession(sessionSource.teacherbotId, language, voiceOpts)
          : await llmApi.createRealtimeInterrogationSession(topic.trim(), language, voiceOpts)).data
      }
      const ephemeralKey = data.value
      const model = data.model

      const micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      micStreamRef.current = micStream
      // Push-to-talk: mic stays silent between turns until the student holds the button.
      micStream.getAudioTracks().forEach((t) => { t.enabled = false })

      const pc = new RTCPeerConnection()
      pcRef.current = pc

      const audioCtx = new AudioContext()
      audioCtxRef.current = audioCtx

      const micSource = audioCtx.createMediaStreamSource(micStream)
      const micAn = audioCtx.createAnalyser()
      micAn.fftSize = 256
      micAn.smoothingTimeConstant = 0.7
      micSource.connect(micAn)
      setMicAnalyser(micAn)

      pc.ontrack = (e) => {
        const [remoteStream] = e.streams
        if (audioElRef.current) {
          audioElRef.current.srcObject = remoteStream
          audioElRef.current.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true))
        }
        const aiSource = audioCtx.createMediaStreamSource(remoteStream)
        const aiAn = audioCtx.createAnalyser()
        aiAn.fftSize = 256
        aiAn.smoothingTimeConstant = 0.7
        aiSource.connect(aiAn)
        setAiAnalyser(aiAn)
      }

      pc.addTrack(micStream.getAudioTracks()[0], micStream)

      const dc = pc.createDataChannel('oai-events')
      dcRef.current = dc
      dc.onmessage = (e) => {
        try { handleServerEvent(JSON.parse(e.data)) } catch { /* ignore non-JSON */ }
      }
      dc.onopen = () => {
        if (hasPreviousContext || resumedInquiry) {
          // The text transcript is already included in the session instructions.
          // Wait for the next spoken user turn instead of greeting and restarting.
          setTurnState('idle')
        } else {
          setTurnState('responding')
          try { dc.send(JSON.stringify({ type: 'response.create' })) } catch { /* noop */ }
        }
      }

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)

      const sdpResponse = await fetch(`${REALTIME_CALLS_URL}?model=${encodeURIComponent(model)}`, {
        method: 'POST',
        body: offer.sdp,
        headers: { Authorization: `Bearer ${ephemeralKey}`, 'Content-Type': 'application/sdp' },
      })
      if (!sdpResponse.ok) throw new Error('SDP exchange failed')
      const answerSdp = await sdpResponse.text()
      await pc.setRemoteDescription({ type: 'answer', sdp: answerSdp })

      setPhase('live')
    } catch (err: any) {
      console.error('Realtime interrogation start failed:', err)
      setError(
        err?.response?.data?.detail ||
        (err?.name === 'NotAllowedError'
          ? (isEnglish ? 'Microphone access denied.' : 'Accesso al microfono negato.')
          : (isEnglish ? 'Could not start the voice exam.' : 'Impossibile avviare l\'interrogazione vocale.'))
      )
      cleanup()
      setPhase('error')
    }
  }, [topic, language, prefs, isEnglish, handleServerEvent, cleanup, sessionSource, hasPreviousContext, seededHistory, restartNext])

  // Pre-connection cast gallery + saved progress.
  const inquiryBotId = sessionSource.kind === 'inquiry' ? sessionSource.teacherbotId : null
  useEffect(() => {
    if (!inquiryBotId) return
    let alive = true
    llmApi.inquiryOverview(inquiryBotId).then((r) => { if (alive) setInquiry(r.data) }).catch(() => {})
    return () => { alive = false }
  }, [inquiryBotId])

  /** Move to another suspect: each NPC has its own realtime session, the case state is shared. */
  const switchSuspect = useCallback((id: string) => {
    if (id === activeSuspectRef.current || phase !== 'live') return
    if (activeSuspectRef.current) turnsCacheRef.current[activeSuspectRef.current] = turns
    aiBufferRef.current = {}
    userBufferRef.current = {}
    cleanup()
    void start(id)
  }, [phase, turns, cleanup, start])

  // ── Tap-to-talk (toggle) ─────────────────────────────────────────────────
  // A toggle is far more robust than hold-to-talk for long answers: the mic can't
  // be cut off mid-sentence by the pointer drifting off the button.
  const startTalking = useCallback(() => {
    if (phase !== 'live') return
    const track = micStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    // Barge-in: if the professor is still talking, cancel that response first.
    if (turnState === 'responding') sendEvent({ type: 'response.cancel' })
    fillerActiveRef.current = false
    awaitingTurnRef.current = false
    pendingDirectiveRef.current = null
    holdStartRef.current = Date.now()
    sendEvent({ type: 'input_audio_buffer.clear' })
    track.enabled = true
    setTurnState('recording')
  }, [phase, turnState, sendEvent])

  const stopTalking = useCallback(() => {
    if (turnState !== 'recording') return
    const track = micStreamRef.current?.getAudioTracks()[0]
    if (track) track.enabled = false
    if (Date.now() - holdStartRef.current < MIN_HOLD_MS) {
      // Accidental double-tap — discard and stay on the student's turn.
      sendEvent({ type: 'input_audio_buffer.clear' })
      setTurnState('idle')
      return
    }
    sendEvent({ type: 'input_audio_buffer.commit' })
    if (isInquiry) {
      // Classify first, then answer with a stage direction. Cover the wait with an in-character "Hmm…".
      awaitingTurnRef.current = true
      pendingDirectiveRef.current = null
      sendFiller()
    } else {
      sendEvent({ type: 'response.create' })
    }
    setTurnState('responding')
  }, [turnState, sendEvent, isInquiry, sendFiller])

  const [textDraft, setTextDraft] = useState('')
  const sendTextTurn = useCallback(() => {
    const text = textDraft.trim()
    if (!text || phase !== 'live' || turnState === 'recording') return
    if (turnState === 'responding') sendEvent({ type: 'response.cancel' })
    setTextDraft('')
    upsertTurn(`text-${Date.now()}`, 'user', text, true)
    sendEvent({
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    })
    awaitingTurnRef.current = false
    pendingDirectiveRef.current = null
    sendFiller()
    setTurnState('responding')
    void runInquiryTurn(text)
  }, [textDraft, phase, turnState, sendEvent, upsertTurn, sendFiller, runInquiryTurn])

  const toggleTalk = useCallback(() => {
    if (turnState === 'recording') stopTalking()
    else startTalking()
  }, [turnState, startTalking, stopTalking])

  // Spacebar toggles recording too.
  useEffect(() => {
    if (phase !== 'live') return
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault()
        toggleTalk()
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [phase, toggleTalk])

  const stop = useCallback(() => {
    cleanup()
    setPhase('setup')
    setTurns([])
    setRestartNext(false)
    turnsCacheRef.current = {}
  }, [cleanup])

  const unlockAudio = useCallback(() => {
    audioElRef.current?.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true))
  }, [])

  const cardStyle = {
    backgroundColor: 'rgb(var(--c-white) / 0.82)',
    backdropFilter: 'blur(30px) saturate(140%)',
    WebkitBackdropFilter: 'blur(30px) saturate(140%)',
    borderColor: 'rgba(163, 163, 163, 0.24)',
    boxShadow: '0 24px 70px rgba(23, 23, 23, 0.18)',
  } as const

  const activeSuspect = inquiry?.suspects.find((sp) => sp.id === activeSuspectId) ?? null
  const statusLabel = isInquiry
    ? (turnState === 'recording'
        ? (isEnglish ? 'Recording — tap to send' : 'Registrazione — tocca per inviare')
        : turnState === 'responding'
          ? (isEnglish ? `${speakerName} is answering…` : `${speakerName} risponde…`)
          : (isEnglish ? 'Your turn — speak or type' : 'Tocca a te — parla o scrivi'))
    : turnState === 'recording'
    ? (isEnglish ? 'Recording — release to send' : 'Registrazione — rilascia per inviare')
    : turnState === 'responding'
      ? (isEnglish ? `${speakerName} is speaking…` : `${speakerName} sta parlando…`)
      : (isEnglish ? 'Your turn — hold to answer' : 'Tocca a te — tieni premuto per rispondere')

  return (
    <div className={`fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 backdrop-blur-md ${isInquiry ? 'p-0' : 'p-4'}`}>
      <audio ref={audioElRef} autoPlay className="hidden" />
      <div className={`relative flex flex-col overflow-hidden border ${isInquiry ? 'h-full w-full rounded-none' : 'h-[min(660px,92vh)] w-full max-w-2xl rounded-[28px]'}`} style={isInquiry ? { ...cardStyle, backgroundColor: 'var(--surface-base)' } : cardStyle}>
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-200/60 px-5 py-4">
          {isInquiry && activeSuspect?.avatar_url ? (
            <img src={activeSuspect.avatar_url} alt={activeSuspect.name} className="h-10 w-10 rounded-full object-cover ring-2 ring-white/60" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ backgroundColor: accent.soft, color: accent.text }}>
              <GraduationCap className="h-5 w-5" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-bold text-slate-900">
              {isInquiry
                ? (phase === 'live' && inquiry?.multi && activeSuspect
                    ? `${activeSuspect.name}${activeSuspect.role ? ` · ${activeSuspect.role}` : ''}`
                    : (inquiry?.case_title || speakerName))
                : isTeacherbot
                  ? speakerName
                  : (isEnglish ? 'Voice oral exam' : 'Interrogazione vocale')}
            </h3>
            <p className="truncate text-xs text-slate-500">
              {phase === 'live'
                ? statusLabel
                : isInquiry
                  ? (isEnglish ? 'Investigative interview' : 'Intervista investigativa')
                : isTeacherbot
                  ? (isEnglish ? 'Talk to this assistant out loud' : 'Parla a voce con questo assistente')
                  : (isEnglish ? 'A teacher questions you out loud' : 'Un docente ti interroga a voce')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { cleanup(); onClose() }}
            className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-500/10 hover:text-slate-600"
            aria-label={isEnglish ? 'Close' : 'Chiudi'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Setup / error */}
        {(phase === 'setup' || phase === 'error') && (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl" style={{ backgroundColor: accent.soft }}>
              <Mic className="h-9 w-9" style={{ color: accent.text }} />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-800">
                {isInquiry
                  ? (isEnglish ? `Question ${speakerName}` : `Interroga ${speakerName}`)
                  : isTeacherbot
                  ? (isEnglish ? `Talk out loud with ${speakerName}` : `Parla a voce con ${speakerName}`)
                  : (isEnglish ? 'What topic should I examine you on?' : 'Su quale argomento vuoi essere interrogato?')}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {isInquiry
                  ? (isEnglish
                      ? 'They know more than they say. Ask the right questions to uncover the clues, then answer the final question.'
                      : 'Sa più di quanto dice. Fai le domande giuste per scoprire gli indizi, poi rispondi alla domanda finale.')
                  : isTeacherbot
                  ? (isEnglish
                      ? (hasPreviousContext ? `The voice will continue from the last ${seededHistory.length} chat messages.` : 'Choose the voice, then start the conversation.')
                      : (hasPreviousContext ? `La voce riprenderà dagli ultimi ${seededHistory.length} messaggi della chat.` : 'Scegli la voce, poi avvia la conversazione.'))
                  : (isEnglish
                      ? (hasPreviousContext ? `The oral exam will continue from the last ${seededHistory.length} chat messages.` : 'Optional — you can also let the professor ask you live.')
                      : (hasPreviousContext ? `L’interrogazione riprenderà dagli ultimi ${seededHistory.length} messaggi della chat.` : 'Facoltativo — puoi anche lasciare che sia il professore a chiedertelo a voce.'))}
              </p>
            </div>
            {!isTeacherbot && (
              <input
                type="text"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void start() }}
                placeholder={isEnglish ? 'e.g. The French Revolution' : 'es. La Rivoluzione Francese'}
                className="w-full max-w-sm rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 text-sm text-slate-800 outline-none transition-all focus:bg-white"
                style={{ boxShadow: `0 0 0 0 ${accent.accent}` }}
                onFocus={(e) => { e.currentTarget.style.boxShadow = `0 0 0 3px ${accent.soft}`; e.currentTarget.style.borderColor = accent.accent }}
                onBlur={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '' }}
              />
            )}
            {isInquiry && inquiry?.multi && (
              <div className="w-full max-w-3xl">
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">
                  {isEnglish ? 'Who do you want to question?' : 'Chi vuoi interrogare?'}
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {inquiry.suspects.map((sp) => (
                    <button
                      key={sp.id}
                      type="button"
                      onClick={() => void start(sp.id)}
                      className="group flex flex-col items-center gap-2 rounded-2xl border border-[color:var(--border-subtle)] p-4 text-center transition hover:-translate-y-0.5 hover:shadow-md"
                    >
                      <SuspectAvatar name={sp.name} url={sp.avatar_url} size={72} accent={accent.accent} />
                      <span className="text-sm font-bold text-[var(--text-primary)]">{sp.name}</span>
                      <span className="text-[11px] leading-4 text-[var(--text-muted)]">{sp.role}</span>
                      {sp.clues_found > 0 && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: accent.soft, color: accent.text }}>
                          {sp.clues_found} {isEnglish ? 'clues' : 'indizi'}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* Voice settings */}
            <div className={`w-full max-w-sm space-y-3 text-left ${isInquiry && inquiry?.multi ? 'hidden' : ''}`}>
              <Segmented
                label={isEnglish ? 'Voice' : 'Voce'}
                value={prefs.gender}
                accent={accent}
                onChange={(v) => updatePrefs({ gender: v as Gender })}
                options={[
                  { value: 'female', label: isEnglish ? 'Female' : 'Femminile' },
                  { value: 'male', label: isEnglish ? 'Male' : 'Maschile' },
                ]}
              />
              {!isInquiry && <Segmented
                label={isEnglish ? 'Tone' : 'Tono'}
                value={prefs.style}
                accent={accent}
                onChange={(v) => updatePrefs({ style: v as Style })}
                options={[
                  { value: 'warm', label: isEnglish ? 'Warm' : 'Caloroso' },
                  { value: 'natural', label: isEnglish ? 'Natural' : 'Naturale' },
                  { value: 'strict', label: isEnglish ? 'Strict' : 'Severo' },
                ]}
              />}
              {!isInquiry && <Segmented
                label={isEnglish ? 'Pace' : 'Ritmo'}
                value={prefs.pace}
                accent={accent}
                onChange={(v) => updatePrefs({ pace: v as Pace })}
                options={[
                  { value: 'slow', label: isEnglish ? 'Slow' : 'Lento' },
                  { value: 'normal', label: isEnglish ? 'Normal' : 'Normale' },
                  { value: 'fast', label: isEnglish ? 'Fast' : 'Veloce' },
                ]}
              />}
            </div>

            {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
            <button
              type="button"
              onClick={() => void start()}
              hidden={isInquiry && !!inquiry?.multi}
              className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white transition-transform hover:-translate-y-0.5 data-[h=true]:hidden"
              data-h={isInquiry && !!inquiry?.multi}
              style={{ backgroundColor: accent.accent, boxShadow: `0 12px 28px ${accent.soft}` }}
            >
              <Mic className="h-4 w-4" />
              {isInquiry
                ? (restartNext
                    ? (isEnglish ? 'Start a new interview' : 'Avvia una nuova intervista')
                    : (isEnglish ? 'Start / resume interview' : 'Avvia / riprendi intervista'))
                : isTeacherbot
                ? (isEnglish ? 'Start voice chat' : 'Avvia conversazione vocale')
                : (isEnglish ? 'Start voice exam' : 'Avvia interrogazione vocale')}
            </button>
            {isInquiry && (
              <button
                type="button"
                onClick={() => setRestartNext((v) => !v)}
                className="text-[11px] font-semibold text-slate-500 underline-offset-2 hover:underline"
              >
                {restartNext
                  ? (isEnglish ? 'Resume the previous interview instead' : 'Riprendi invece la precedente')
                  : (isEnglish ? 'Start over from scratch' : 'Ricomincia da zero')}
              </button>
            )}
          </div>
        )}

        {/* Connecting */}
        {phase === 'connecting' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: accent.accent }} />
            <p className="text-sm font-medium">{isEnglish ? 'Connecting…' : 'Connessione in corso…'}</p>
          </div>
        )}

        {/* Live — inquiry: full-screen stage + notebook */}
        {phase === 'live' && isInquiry && (
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
            {/* Stage */}
            <div className="flex min-h-0 flex-1 flex-col">
              {inquiry?.multi && (
                <div className="flex gap-2 overflow-x-auto border-b border-[color:var(--border-subtle)] px-4 py-2.5">
                  {inquiry.suspects.map((sp) => {
                    const active = sp.id === activeSuspectId
                    return (
                      <button
                        key={sp.id}
                        type="button"
                        onClick={() => switchSuspect(sp.id)}
                        className={`flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-left transition ${active ? '' : 'opacity-70 hover:opacity-100'}`}
                        style={{ borderColor: active ? accent.accent : 'var(--border-subtle)', backgroundColor: active ? accent.soft : 'transparent' }}
                        title={isEnglish ? `Question ${sp.name}` : `Interroga ${sp.name}`}
                      >
                        <SuspectAvatar name={sp.name} url={sp.avatar_url} size={32} accent={accent.accent} />
                        <span className="text-xs font-bold leading-tight text-[var(--text-primary)]">
                          {sp.name}
                          {sp.clues_found > 0 && <span className="ml-1.5 rounded-full px-1.5 text-[10px]" style={{ backgroundColor: accent.accent, color: '#fff' }}>{sp.clues_found}</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
              {audioBlocked && (
                <button type="button" onClick={unlockAudio} className="flex w-full items-center justify-center gap-2 bg-amber-50/80 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100/80">
                  <Volume2 className="h-3.5 w-3.5" />
                  {isEnglish ? 'Tap to enable audio' : "Tocca per abilitare l'audio"}
                </button>
              )}
              <div className="px-6 pt-5">
                <div className="h-28 w-full overflow-hidden rounded-2xl border border-[color:var(--border-subtle)]">
                  <DualVisualizer aiAnalyser={aiAnalyser} micAnalyser={micAnalyser} accent={accent.accent} />
                </div>
                <div className="mt-2 flex items-center justify-center gap-5 text-[11px] font-semibold">
                  <span className="flex items-center gap-1.5" style={{ color: accent.text }}>
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accent.accent }} />{activeSuspect?.name || inquiry?.npc_name || speakerName}
                  </span>
                  <span className="flex items-center gap-1.5 text-emerald-600">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />{isEnglish ? 'You' : 'Tu'}
                  </span>
                </div>
              </div>

              <div ref={transcriptScrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-6 py-4">
                {turns.length === 0 ? (
                  <p className="mt-6 text-center text-xs text-[var(--text-muted)]">
                    {isEnglish ? 'The interview transcript will appear here.' : "Qui comparirà la trascrizione dell'intervista."}
                  </p>
                ) : turns.map((turn) => (
                  <div key={turn.id} className={`flex items-end gap-2 ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {turn.role === 'assistant' && <SuspectAvatar name={activeSuspect?.name || speakerName} url={activeSuspect?.avatar_url ?? null} size={28} accent={accent.accent} />}
                    <div className={`max-w-[92%] rounded-2xl px-4 py-3 text-[15px] leading-6 shadow-sm md:max-w-[75%] ${turn.final ? '' : 'opacity-70'} ${
                      turn.role === 'user'
                        ? 'rounded-br-md border border-[color:var(--selection-border)] bg-[image:var(--selection-bg)] text-[var(--selection-text)]'
                        : 'rounded-bl-md border border-[color:var(--border-subtle)] bg-[var(--surface-raised,var(--surface-base))] text-[var(--text-primary)]'
                    }`}>
                      {turn.text || '…'}
                    </div>
                  </div>
                ))}
              </div>

              {/* Composer: voice or text */}
              <div className="flex items-center gap-3 border-t border-[color:var(--border-subtle)] px-6 py-4">
                <button
                  type="button"
                  onClick={toggleTalk}
                  className="relative flex h-14 w-14 shrink-0 select-none items-center justify-center rounded-full text-white transition-all"
                  style={{
                    backgroundColor: turnState === 'recording' ? '#ef4444' : accent.accent,
                    boxShadow: turnState === 'recording' ? '0 0 0 8px rgba(239,68,68,0.18)' : `0 8px 20px ${accent.soft}`,
                  }}
                  title={isEnglish ? 'Tap to talk (or press Space)' : 'Tocca per parlare (o premi Spazio)'}
                >
                  {turnState === 'recording' && <span className="absolute inset-0 animate-ping rounded-full" style={{ backgroundColor: 'rgba(239,68,68,0.35)' }} />}
                  {turnState === 'recording' ? <Square className="relative h-5 w-5 fill-white" /> : <Mic className="relative h-6 w-6" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={textDraft}
                      onChange={(e) => setTextDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); sendTextTurn() } }}
                      disabled={turnState === 'recording'}
                      placeholder={isEnglish ? 'Or type your question…' : 'Oppure scrivi la tua domanda…'}
                      className="w-full rounded-full border border-[color:var(--border-subtle)] bg-transparent px-4 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[color:var(--selection-border)] disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={sendTextTurn}
                      disabled={!textDraft.trim() || turnState === 'recording'}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white transition disabled:opacity-40"
                      style={{ backgroundColor: accent.accent }}
                      aria-label={isEnglish ? 'Send' : 'Invia'}
                    >
                      <Send className="h-4 w-4" />
                    </button>
                  </div>
                  <p className="mt-1 pl-1 text-[11px] font-medium text-[var(--text-muted)]">{statusLabel}</p>
                </div>
                <button
                  type="button"
                  onClick={stop}
                  className="hidden shrink-0 items-center gap-2 rounded-full border border-rose-200/80 bg-rose-50/70 px-4 py-2 text-xs font-bold text-rose-600 hover:bg-rose-100/80 sm:inline-flex"
                >
                  <Square className="h-3.5 w-3.5 fill-rose-600" />
                  {isEnglish ? 'End interview' : 'Termina intervista'}
                </button>
              </div>
            </div>

            {/* Investigation notebook */}
            {inquiry && (
              <aside className="max-h-[42vh] w-full shrink-0 overflow-y-auto border-t border-[color:var(--border-subtle)] p-5 lg:max-h-none lg:w-[400px] lg:border-l lg:border-t-0">
                <div className="flex items-center justify-between">
                  <h4 className="flex items-center gap-2 text-sm font-bold text-[var(--text-primary)]">
                    <Search className="h-4 w-4" style={{ color: accent.text }} />
                    {isEnglish ? 'Investigation notebook' : 'Taccuino investigativo'}
                  </h4>
                  <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ backgroundColor: accent.soft, color: accent.text }}>
                    {inquiry.unlocked_clues.length}/{inquiry.total_clues}
                  </span>
                </div>

                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[color:var(--border-subtle)]">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (inquiry.unlocked_clues.length / Math.max(1, inquiry.min_clues)) * 100)}%`, backgroundColor: accent.accent }} />
                </div>
                <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                  {inquiry.unlocked_clues.length >= inquiry.min_clues
                    ? (isEnglish ? 'You have enough clues to answer.' : 'Hai abbastanza indizi per rispondere.')
                    : (isEnglish ? `Find at least ${inquiry.min_clues} clues to answer.` : `Trova almeno ${inquiry.min_clues} indizi per poter rispondere.`)}
                </p>

                {inquiry.case_brief && (
                  <div className="mt-4 rounded-xl border border-[color:var(--border-subtle)] p-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{isEnglish ? 'The case' : 'Il caso'}</p>
                    <p className="mt-1 text-[13px] leading-5 text-[var(--text-secondary,var(--text-primary))]">{inquiry.case_brief}</p>
                  </div>
                )}

                <ol className="mt-4 space-y-2.5">
                  {inquiry.unlocked_clues.map((c, i) => (
                    <li
                      key={c.id}
                      className="flex gap-3 rounded-xl border p-3 shadow-sm"
                      style={{
                        borderColor: newClue === c.text ? accent.accent : 'var(--border-subtle)',
                        backgroundColor: newClue === c.text ? accent.soft : 'transparent',
                      }}
                    >
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ backgroundColor: accent.accent }}>{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium leading-5 text-[var(--text-primary)]">{c.text}</p>
                        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                          {inquiry.multi && c.suspect_name ? `${c.suspect_name} · ` : ''}{isEnglish ? 'Clue' : 'Indizio'} · {c.tier === 1 ? (isEnglish ? 'easy' : 'facile') : c.tier === 2 ? (isEnglish ? 'hard-won' : 'sudato') : (isEnglish ? 'key' : 'chiave')}
                        </p>
                      </div>
                    </li>
                  ))}
                  {Array.from({ length: Math.max(0, inquiry.total_clues - inquiry.unlocked_clues.length) }).map((_, i) => (
                    <li key={`locked-${i}`} className="flex items-center gap-3 rounded-xl border border-dashed border-[color:var(--border-subtle)] p-3 opacity-60">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-[color:var(--border-subtle)] text-[11px] font-bold text-[var(--text-muted)]">?</span>
                      <p className="text-[12px] italic text-[var(--text-muted)]">{isEnglish ? 'Hidden clue — ask the right questions' : 'Indizio nascosto — fai le domande giuste'}</p>
                    </li>
                  ))}
                </ol>

                {/* Final answer */}
                <div className="mt-5 rounded-xl border border-[color:var(--border-subtle)] p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">{isEnglish ? 'Final question' : 'Domanda finale'}</p>
                  <p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{inquiry.final_question}</p>
                  {inquiry.multi && inquiry.status === 'active' && (
                    <div className={`mt-3 grid grid-cols-3 gap-2 ${inquiry.can_answer ? '' : 'pointer-events-none opacity-40'}`}>
                      {inquiry.suspects.map((sp) => (
                        <button
                          key={sp.id}
                          type="button"
                          onClick={() => setAccusedId(sp.id)}
                          className="flex flex-col items-center gap-1 rounded-xl border p-2 text-center transition"
                          style={{ borderColor: accusedId === sp.id ? accent.accent : 'var(--border-subtle)', backgroundColor: accusedId === sp.id ? accent.soft : 'transparent' }}
                        >
                          <SuspectAvatar name={sp.name} url={sp.avatar_url} size={40} accent={accent.accent} />
                          <span className="text-[11px] font-bold leading-tight text-[var(--text-primary)]">{sp.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {inquiry.status === 'active' && (
                    <>
                      <textarea
                        value={answerText}
                        onChange={(e) => setAnswerText(e.target.value)}
                        disabled={!inquiry.can_answer}
                        className="mt-2 min-h-[64px] w-full rounded-lg border border-[color:var(--border-subtle)] bg-transparent px-3 py-2 text-sm text-[var(--text-primary)] outline-none disabled:opacity-40"
                        placeholder={inquiry.can_answer ? (inquiry.multi ? (isEnglish ? 'Why them? Motive and evidence…' : 'Perché proprio lui/lei? Movente e prove…') : (isEnglish ? 'Your answer…' : 'La tua risposta…')) : (isEnglish ? 'Unlocked after enough clues' : 'Si sblocca con abbastanza indizi')}
                      />
                      <button
                        type="button"
                        disabled={!inquiry.can_answer || answerBusy || !answerText.trim() || (inquiry.multi && !accusedId)}
                        onClick={async () => {
                          const sid = inquirySessionRef.current
                          if (!sid) return
                          setAnswerBusy(true)
                          try {
                            const { data } = await llmApi.inquiryAnswer(sid, answerText.trim(), accusedId ?? undefined)
                            setInquiry(data)
                            setAnswerResult({ correct: data.correct, score: data.score, feedback: data.feedback, correct_answer: data.correct_answer, truth: data.truth, culprit: data.culprit })
                          } catch (err: any) {
                            setAnswerResult({ correct: false, score: 0, feedback: err?.response?.data?.detail || (isEnglish ? 'Could not check the answer.' : 'Impossibile valutare la risposta.') })
                          } finally {
                            setAnswerBusy(false)
                          }
                        }}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold text-white transition disabled:cursor-not-allowed disabled:opacity-40"
                        style={{ backgroundColor: accent.accent }}
                      >
                        {answerBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
                        {isEnglish ? 'Submit answer' : 'Invia risposta'}
                        <span className="opacity-70">({inquiry.attempts}/{inquiry.max_attempts})</span>
                      </button>
                    </>
                  )}
                  {answerResult && (
                    <div className={`mt-3 rounded-lg px-3 py-2 text-xs leading-5 ${answerResult.correct ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'}`}>
                      <p className="font-bold">
                        {answerResult.correct ? (isEnglish ? 'Case solved!' : 'Caso risolto!') : (inquiry.status === 'failed' ? (isEnglish ? 'Case closed' : 'Caso chiuso') : (isEnglish ? 'Not quite' : 'Non ci siamo'))} · {answerResult.score}/100
                      </p>
                      <p>{answerResult.feedback}</p>
                      {answerResult.culprit && <p className="mt-1"><b>{isEnglish ? 'The culprit: ' : 'Il colpevole: '}</b>{answerResult.culprit.name}</p>}
                      {answerResult.correct_answer && <p className="mt-1"><b>{isEnglish ? 'Solution: ' : 'Soluzione: '}</b>{answerResult.correct_answer}</p>}
                      {answerResult.truth && <p className="mt-1 opacity-80">{answerResult.truth}</p>}
                    </div>
                  )}
                </div>

                {debugInfo && (
                  <p className="mt-3 font-mono text-[10px] text-[var(--text-muted)]">
                    [test] flag={debugInfo.flag ?? 'neutral'} · intent={debugInfo.intent} · trust={debugInfo.trust} · pressure={debugInfo.pressure}
                  </p>
                )}
                <button type="button" onClick={stop} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-full border border-rose-200/80 bg-rose-50/70 px-4 py-2 text-xs font-bold text-rose-600 sm:hidden">
                  <Square className="h-3.5 w-3.5 fill-rose-600" />{isEnglish ? 'End interview' : 'Termina intervista'}
                </button>
              </aside>
            )}
          </div>
        )}

        {/* Live */}
        {phase === 'live' && !isInquiry && (
          <>
            {audioBlocked && (
              <button
                type="button"
                onClick={unlockAudio}
                className="flex w-full items-center justify-center gap-2 bg-amber-50/80 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100/80"
              >
                <Volume2 className="h-3.5 w-3.5" />
                {isEnglish ? 'Tap to enable audio' : "Tocca per abilitare l'audio"}
              </button>
            )}

            {/* Visualiser */}
            <div className="px-6 pt-5">
              <div className="h-24 w-full overflow-hidden rounded-2xl border border-slate-200/60 bg-white/50">
                <DualVisualizer aiAnalyser={aiAnalyser} micAnalyser={micAnalyser} accent={accent.accent} />
              </div>
              <div className="mt-2 flex items-center justify-center gap-5 text-[11px] font-semibold">
                <span className="flex items-center gap-1.5" style={{ color: accent.text }}>
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: accent.accent }} />
                  {speakerName}
                </span>
                <span className="flex items-center gap-1.5 text-emerald-600">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  {isEnglish ? 'You' : 'Tu'}
                </span>
              </div>
            </div>

            {/* Transcript */}
            <div ref={transcriptScrollRef} className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
              {turns.length === 0 ? (
                <p className="mt-6 text-center text-xs text-slate-400">
                  {isEnglish ? 'The conversation transcript will appear here.' : 'Qui comparirà la trascrizione della conversazione.'}
                </p>
              ) : (
                turns.map((turn) => (
                  <div key={turn.id} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[92%] md:max-w-[80%] rounded-2xl px-4 py-3 text-[16px] leading-7 shadow-sm ${turn.final ? '' : 'opacity-70'} ${
                        turn.role === 'user'
                          ? 'rounded-br-md border border-[color:var(--selection-border)] bg-[image:var(--selection-bg)] text-[var(--selection-text)]'
                          : 'rounded-bl-md border border-[color:var(--border-subtle)] bg-[var(--surface-base)] text-[var(--text-primary)]'
                      }`}
                    >
                      {turn.text || '…'}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Tap-to-talk controls */}
            <div className="flex flex-col items-center gap-3 border-t border-[color:var(--border-subtle)] px-6 py-5">
              <button
                type="button"
                onClick={toggleTalk}
                className="relative flex h-20 w-20 select-none items-center justify-center rounded-full text-white transition-all"
                style={{
                  backgroundColor: turnState === 'recording' ? '#ef4444' : accent.accent,
                  boxShadow: turnState === 'recording'
                    ? '0 0 0 10px rgba(239,68,68,0.18)'
                    : `0 12px 28px ${accent.soft}`,
                  transform: turnState === 'recording' ? 'scale(1.06)' : 'scale(1)',
                }}
                title={isEnglish ? 'Tap to talk (or press Space)' : 'Tocca per parlare (o premi Spazio)'}
              >
                {turnState === 'recording' && (
                  <span className="absolute inset-0 animate-ping rounded-full" style={{ backgroundColor: 'rgba(239,68,68,0.35)' }} />
                )}
                {turnState === 'recording'
                  ? <Square className="relative h-7 w-7 fill-white" />
                  : <Mic className="relative h-8 w-8" />}
              </button>
              <p className="text-xs font-medium text-slate-500">
                {turnState === 'recording'
                  ? (isEnglish ? 'Tap to send your answer' : 'Tocca per inviare la risposta')
                  : turnState === 'responding'
                    ? (isEnglish ? `${speakerName} speaking — tap to reply` : `${speakerName} parla — tocca per rispondere`)
                    : (isEnglish ? 'Tap to answer' : 'Tocca per rispondere')}
              </p>

              <button
                type="button"
                onClick={stop}
                className="mt-1 inline-flex items-center gap-2 rounded-full border border-rose-200/80 bg-rose-50/70 px-4 py-2 text-xs font-bold text-rose-600 transition-colors hover:bg-rose-100/80"
              >
                <Square className="h-3.5 w-3.5 fill-rose-600" />
                {isInquiry
                  ? (isEnglish ? 'End interview' : 'Termina intervista')
                  : isTeacherbot
                  ? (isEnglish ? 'End chat' : 'Termina conversazione')
                  : (isEnglish ? 'End exam' : 'Termina interrogazione')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
