import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Mic, Square, X, GraduationCap, Volume2 } from 'lucide-react'
import { llmApi } from '@/lib/api'

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
                  ? 'border border-[color:var(--selection-border)] bg-[image:var(--selection-bg)] text-[var(--selection-active-text)] shadow-sm'
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

export default function RealtimeInterrogationPanel({
  initialTopic = '',
  language,
  accent,
  onClose,
  onTurn,
  sessionSource = { kind: 'interrogation' },
}: RealtimeInterrogationPanelProps) {
  const isEnglish = language === 'en'
  const isTeacherbot = sessionSource.kind === 'teacherbot'
  const speakerName = isTeacherbot
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
    if (final && text.trim()) onTurn?.(role, text.trim())
  }, [onTurn])

  const handleServerEvent = useCallback((evt: any) => {
    const type: string = evt?.type || ''

    if (type === 'response.created') {
      setTurnState('responding')
      return
    }
    if (type === 'response.done' || type === 'response.completed') {
      setTurnState('idle')
      return
    }

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
      upsertTurn(`user-${key}`, 'user', evt.transcript ?? userBufferRef.current[key] ?? '', true)
      delete userBufferRef.current[key]
      return
    }

    if (type === 'error') {
      const message = evt?.error?.message
      if (message) setError(message)
    }
  }, [upsertTurn])

  const start = useCallback(async () => {
    setError(null)
    setPhase('connecting')
    try {
      const voiceOpts = {
        voice: VOICE_BY_GENDER[prefs.gender],
        style: prefs.style,
        pace: prefs.pace,
      }
      const { data } = sessionSource.kind === 'teacherbot'
        ? await llmApi.createRealtimeTeacherbotSession(sessionSource.teacherbotId, language, voiceOpts)
        : await llmApi.createRealtimeInterrogationSession(topic.trim(), language, voiceOpts)
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
        // The professor greets and asks the first question right away.
        setTurnState('responding')
        try { dc.send(JSON.stringify({ type: 'response.create' })) } catch { /* noop */ }
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
  }, [topic, language, prefs, isEnglish, handleServerEvent, cleanup, sessionSource])

  // ── Tap-to-talk (toggle) ─────────────────────────────────────────────────
  // A toggle is far more robust than hold-to-talk for long answers: the mic can't
  // be cut off mid-sentence by the pointer drifting off the button.
  const startTalking = useCallback(() => {
    if (phase !== 'live') return
    const track = micStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    // Barge-in: if the professor is still talking, cancel that response first.
    if (turnState === 'responding') sendEvent({ type: 'response.cancel' })
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
    sendEvent({ type: 'response.create' })
    setTurnState('responding')
  }, [turnState, sendEvent])

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
  }, [cleanup])

  const unlockAudio = useCallback(() => {
    audioElRef.current?.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true))
  }, [])

  const cardStyle = {
    backgroundColor: 'rgba(255, 255, 255, 0.82)',
    backdropFilter: 'blur(30px) saturate(140%)',
    WebkitBackdropFilter: 'blur(30px) saturate(140%)',
    borderColor: 'rgba(148, 163, 184, 0.24)',
    boxShadow: '0 24px 70px rgba(15, 23, 42, 0.18)',
  } as const

  const statusLabel = turnState === 'recording'
    ? (isEnglish ? 'Recording — release to send' : 'Registrazione — rilascia per inviare')
    : turnState === 'responding'
      ? (isEnglish ? `${speakerName} is speaking…` : `${speakerName} sta parlando…`)
      : (isEnglish ? 'Your turn — hold to answer' : 'Tocca a te — tieni premuto per rispondere')

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-md">
      <audio ref={audioElRef} autoPlay className="hidden" />
      <div className="relative flex h-[min(660px,92vh)] w-full max-w-2xl flex-col overflow-hidden rounded-[28px] border" style={cardStyle}>
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-200/60 px-5 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl" style={{ backgroundColor: accent.soft, color: accent.text }}>
            <GraduationCap className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-bold text-slate-900">
              {isTeacherbot
                ? speakerName
                : (isEnglish ? 'Voice oral exam' : 'Interrogazione vocale')}
            </h3>
            <p className="truncate text-xs text-slate-500">
              {phase === 'live'
                ? statusLabel
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
                {isTeacherbot
                  ? (isEnglish ? `Talk out loud with ${speakerName}` : `Parla a voce con ${speakerName}`)
                  : (isEnglish ? 'What topic should I examine you on?' : 'Su quale argomento vuoi essere interrogato?')}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {isTeacherbot
                  ? (isEnglish
                      ? 'Choose the voice, then start the conversation.'
                      : 'Scegli la voce, poi avvia la conversazione.')
                  : (isEnglish
                      ? 'Optional — you can also let the professor ask you live.'
                      : 'Facoltativo — puoi anche lasciare che sia il professore a chiedertelo a voce.')}
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
            {/* Voice settings */}
            <div className="w-full max-w-sm space-y-3 text-left">
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
              <Segmented
                label={isEnglish ? 'Tone' : 'Tono'}
                value={prefs.style}
                accent={accent}
                onChange={(v) => updatePrefs({ style: v as Style })}
                options={[
                  { value: 'warm', label: isEnglish ? 'Warm' : 'Caloroso' },
                  { value: 'natural', label: isEnglish ? 'Natural' : 'Naturale' },
                  { value: 'strict', label: isEnglish ? 'Strict' : 'Severo' },
                ]}
              />
              <Segmented
                label={isEnglish ? 'Pace' : 'Ritmo'}
                value={prefs.pace}
                accent={accent}
                onChange={(v) => updatePrefs({ pace: v as Pace })}
                options={[
                  { value: 'slow', label: isEnglish ? 'Slow' : 'Lento' },
                  { value: 'normal', label: isEnglish ? 'Normal' : 'Normale' },
                  { value: 'fast', label: isEnglish ? 'Fast' : 'Veloce' },
                ]}
              />
            </div>

            {error && <p className="text-xs font-medium text-rose-600">{error}</p>}
            <button
              type="button"
              onClick={() => void start()}
              className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-bold text-white transition-transform hover:-translate-y-0.5"
              style={{ backgroundColor: accent.accent, boxShadow: `0 12px 28px ${accent.soft}` }}
            >
              <Mic className="h-4 w-4" />
              {isTeacherbot
                ? (isEnglish ? 'Start voice chat' : 'Avvia conversazione vocale')
                : (isEnglish ? 'Start voice exam' : 'Avvia interrogazione vocale')}
            </button>
          </div>
        )}

        {/* Connecting */}
        {phase === 'connecting' && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-slate-500">
            <Loader2 className="h-8 w-8 animate-spin" style={{ color: accent.accent }} />
            <p className="text-sm font-medium">{isEnglish ? 'Connecting…' : 'Connessione in corso…'}</p>
          </div>
        )}

        {/* Live */}
        {phase === 'live' && (
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
                          ? 'rounded-br-md border border-[color:var(--selection-border)] bg-[image:var(--selection-bg)] text-[var(--selection-active-text)]'
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
                {isTeacherbot
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
