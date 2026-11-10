/**
 * VoiceRecorder — reusable voice input component.
 *
 * Behavior:
 *   idle      → mic button
 *   recording → live waveform bars + timer + stop + cancel
 *   processing→ spinner while Whisper transcribes
 *   review    → compact panel anchored to the prompt, with editable transcription
 *
 * Props:
 *   onInsertText  – called with the final (possibly edited/translated) text.
 *                   In chatbot contexts this fills the textarea; the user still clicks Send.
 *   compact       – smaller mic icon (for chat sidebar)
 */

import { useState, useRef, useEffect, useLayoutEffect, type CSSProperties } from 'react'
import {
  Mic,
  Square,
  X,
  Send,
  RefreshCw,
  Volume2,
  Languages,
  RotateCcw,
} from '@/components/icons'
import { Button, Dialog, DialogContent, DialogTitle, IconButton, Select, Textarea, zIndexTokens } from '@/design'
import { useTranslation } from 'react-i18next'
import { getApiAuthHeaders } from '@/lib/api'
import { tl } from '@/i18n/tl'

interface VoiceRecorderProps {
  onInsertText: (text: string) => void
  compact?: boolean
  /** Explicit target for dictation controls rendered outside the prompt (e.g. GlobalDictation). */
  anchorElement?: HTMLElement | null
  /** Override the transcription endpoint — used by the anonymous public teacherbot share-link
   *  page, which has no student/teacher auth token and hits a link-scoped public route instead. */
  transcribeUrl?: string
  /** Hide the translate-to-language control (the /stt/translate endpoint also requires auth). */
  allowTranslate?: boolean
  /** Reports idle / recording / processing / review so a host can keep the recorder mounted while it works. */
  onStateChange?: (state: RecorderState) => void
}

export type RecorderState = 'idle' | 'recording' | 'processing' | 'review'

const LANGUAGES = [
  { code: 'it', label: tl("Italiano"), flag: '🇮🇹' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'pt', label: 'Português', flag: '🇵🇹' },
  { code: 'zh', label: '中文', flag: '🇨🇳' },
  { code: 'ar', label: 'العربية', flag: '🇸🇦' },
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'ru', label: 'Русский', flag: '🇷🇺' },
]

const NUM_BARS = 12

export function VoiceRecorder({ onInsertText, compact = false, transcribeUrl = '/api/v1/stt/transcribe', allowTranslate = true, onStateChange, anchorElement }: VoiceRecorderProps) {
  const { t } = useTranslation()
  const [recorderState, setRecorderState] = useState<RecorderState>('idle')
  useEffect(() => { onStateChange?.(recorderState) }, [recorderState, onStateChange])
  const [transcription, setTranscription] = useState('')
  const [detectedLanguage, setDetectedLanguage] = useState('')
  const [translateTarget, setTranslateTarget] = useState('en')
  const [translating, setTranslating] = useState(false)
  const [showTranslation, setShowTranslation] = useState(false)
  const [reviewPosition, setReviewPosition] = useState<CSSProperties>({ width: 'min(40rem, calc(100vw - 24px))' })
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [recordingTime, setRecordingTime] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [barHeights, setBarHeights] = useState<number[]>(
    Array.from({ length: NUM_BARS }, () => 4)
  )

  const micRef = useRef<HTMLButtonElement>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  const reviewTextareaRef = useRef<HTMLTextAreaElement>(null)
  const canceledRef = useRef(false)
  const startingRef = useRef(false)
  const transcriptionAbortRef = useRef<AbortController | null>(null)
  const translationAbortRef = useRef<AbortController | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  // The dialog lives in a portal; its width and position follow the actual prompt,
  // including sidebar layouts and the mobile visual viewport/keyboard.
  useLayoutEffect(() => {
    if (recorderState !== 'review') return
    const update = () => {
      const viewport = window.visualViewport
      const top = viewport?.offsetTop || 0
      const left = viewport?.offsetLeft || 0
      const width = viewport?.width || window.innerWidth
      const height = viewport?.height || window.innerHeight
      const anchor = anchorRef.current
      const rect = anchor?.isConnected ? anchor.getBoundingClientRect() : null
      const gutter = rect ? Math.max(0, Math.min(12, rect.left - left, left + width - rect.right)) : 12
      const panelWidth = Math.min(rect?.width || 640, width - gutter * 2)
      const panelLeft = Math.max(left + gutter, Math.min(rect?.left ?? left + (width - panelWidth) / 2, left + width - panelWidth - gutter))
      const above = rect ? rect.top - top - 20 : height - 32
      const below = rect ? top + height - rect.bottom - 20 : 0
      const placeAbove = above >= 200 || above >= below
      setReviewPosition({
        position: 'fixed', left: panelLeft, width: panelWidth, maxWidth: 'none', transform: 'none',
        ...(placeAbove ? {
          top: 'auto', bottom: window.innerHeight - (rect?.top ?? top + height - 12) + 8,
          maxHeight: Math.max(100, above),
        } : {
          top: (rect?.bottom ?? top) + 8, bottom: 'auto', maxHeight: Math.max(100, below),
        }),
      })
    }
    update()
    const observer = new ResizeObserver(update)
    if (anchorRef.current) observer.observe(anchorRef.current)
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [recorderState])

  useEffect(() => () => {
    canceledRef.current = true
    transcriptionAbortRef.current?.abort()
    translationAbortRef.current?.abort()
    if (timerRef.current) clearInterval(timerRef.current)
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop()
    void audioCtxRef.current?.close().catch(() => {})
  }, [])

  // Same auth the rest of the app uses (cookie session or student token); a legacy bearer token is added when present.
  const authHeaders = (): Record<string, string> => {
    const legacy = localStorage.getItem('student_token') || localStorage.getItem('teacher_token') || ''
    return { ...(legacy ? { Authorization: `Bearer ${legacy}` } : {}), ...getApiAuthHeaders() }
  }

  // ─── recording ──────────────────────────────────────────────────────────────

  const startRecording = async () => {
    if (startingRef.current) return
    startingRef.current = true
    canceledRef.current = false
    setShowTranslation(false)
    let anchor = anchorElement || micRef.current?.closest<HTMLElement>('[data-prompt-composer]') || micRef.current?.parentElement
    if (!anchorElement) {
      while (anchor && !anchor.querySelector('textarea, input:not([type="file"]):not([type="hidden"])')) anchor = anchor.parentElement
    }
    anchorRef.current = anchor || null
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      if (canceledRef.current) { stream.getTracks().forEach(track => track.stop()); return }

      // Analyser for live waveform
      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const src = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 64
      src.connect(analyser)
      analyserRef.current = analyser

      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(
        (m) => MediaRecorder.isTypeSupported(m)
      ) || ''

      const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      mediaRecorderRef.current = mr
      chunksRef.current = []

      mr.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        ctx.close().catch(() => {})
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)

        if (canceledRef.current) return
        const blob = new Blob(chunksRef.current, { type: mimeType || 'audio/webm' })
        setAudioUrl(URL.createObjectURL(blob))
        await transcribeBlob(blob, mimeType || 'audio/webm')
      }

      mr.start(200)
      setRecorderState('recording')
      setRecordingTime(0)

      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000)

      // Live waveform animation
      const drawWave = () => {
        const buf = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(buf)
        const step = Math.floor(buf.length / NUM_BARS)
        const heights = Array.from({ length: NUM_BARS }, (_, i) => {
          const val = buf[i * step] ?? 0
          return Math.max(3, Math.round((val / 255) * 24))
        })
        setBarHeights(heights)
        animFrameRef.current = requestAnimationFrame(drawWave)
      }
      drawWave()
    } catch {
      setError(t('voice_recorder.mic_error'))
    } finally { startingRef.current = false }
  }

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    mediaRecorderRef.current?.stop()
    setRecorderState('processing')
  }

  const cancelRecording = () => {
    canceledRef.current = true
    transcriptionAbortRef.current?.abort()
    if (timerRef.current) clearInterval(timerRef.current)
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    mediaRecorderRef.current?.stop()
    setRecorderState('idle')
    chunksRef.current = []
  }

  // ─── transcription ──────────────────────────────────────────────────────────

  const transcribeBlob = async (blob: Blob, mimeType: string) => {
    const controller = new AbortController()
    transcriptionAbortRef.current?.abort()
    transcriptionAbortRef.current = controller
    try {
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
      const fd = new FormData()
      fd.append('file', blob, `recording.${ext}`)

      const resp = await fetch(transcribeUrl, {
        method: 'POST',
        headers: authHeaders(),
        credentials: 'include',
        body: fd,
        signal: controller.signal,
      })

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ detail: tl("Errore sconosciuto") }))
        throw new Error(body.detail || tl("Trascrizione fallita"))
      }

      const data = await resp.json()
      controller.signal.throwIfAborted()
      setTranscription(data.text || '')
      setDetectedLanguage(data.language || '')
      setRecorderState('review')
    } catch (e: any) {
      if (controller.signal.aborted) return
      setError(e.message || tl("Errore nella trascrizione. Riprova."))
      setRecorderState('idle')
    }
  }

  // ─── translation ────────────────────────────────────────────────────────────

  const handleTranslate = async () => {
    if (!transcription.trim()) return
    const controller = new AbortController()
    translationAbortRef.current?.abort()
    translationAbortRef.current = controller
    setTranslating(true)
    try {
      const resp = await fetch('/api/v1/stt/translate', {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        credentials: 'include',
        signal: controller.signal,
        body: JSON.stringify({
          text: transcription,
          source_language: detectedLanguage,
          target_language: translateTarget,
        }),
      })
      const data = await resp.json()
      controller.signal.throwIfAborted()
      if (data.translated_text) {
        setTranscription(data.translated_text)
        setDetectedLanguage(translateTarget)
      }
    } catch {
      // silently ignore — keep original
    } finally {
      setTranslating(false)
    }
  }

  // ─── actions ─────────────────────────────────────────────────────────────────

  const handleInsert = () => {
    if (transcription.trim()) onInsertText(transcription)
    handleClose()
  }

  const handleClose = () => {
    transcriptionAbortRef.current?.abort()
    translationAbortRef.current?.abort()
    setTranslating(false)
    setRecorderState('idle')
    setTranscription('')
    setDetectedLanguage('')
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl)
      setAudioUrl(null)
    }
  }

  const fmt = (s: number) =>
    `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`

  const langLabel = LANGUAGES.find((l) => l.code === detectedLanguage)?.label ?? detectedLanguage

  // ─── render ─────────────────────────────────────────────────────────────────

  // Review: a light, non-modal panel matching the prompt's width.
  if (recorderState === 'review') {
    return (
      <Dialog open modal={false} onOpenChange={(open) => { if (!open) handleClose() }}>
        <DialogContent
          showClose={false}
          aria-describedby={undefined}
          data-voice-review
          data-no-dictation
          className="gap-3 overflow-y-auto rounded-[var(--card-radius)] p-4"
          style={{ ...reviewPosition, zIndex: zIndexTokens.dictation }}
          onOpenAutoFocus={(event) => { event.preventDefault(); reviewTextareaRef.current?.focus() }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const anchor = anchorRef.current
            const input = anchor?.matches('input, textarea') ? anchor : anchor?.querySelector<HTMLElement>('textarea, input:not([type="file"])')
            input?.focus()
          }}
        >
          <div className="flex items-center gap-2">
            <Mic className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" />
            <DialogTitle className="min-w-0 flex-1 text-sm font-semibold">{t('voice_recorder.header')}</DialogTitle>
            {detectedLanguage && <span className="text-xs text-[var(--text-secondary)]">{langLabel}</span>}
            {audioUrl && <IconButton tone="neutral" surface="ghost" size="sm" aria-label={t('voice_recorder.listen')} title={t('voice_recorder.listen')} onClick={() => { void audioRef.current?.play() }}><Volume2 /></IconButton>}
            <IconButton tone="neutral" surface="ghost" size="sm" aria-label={tl('Chiudi trascrizione')} onClick={handleClose}><X /></IconButton>
            <audio ref={audioRef} src={audioUrl ?? ''} className="hidden" />
          </div>

          <Textarea
            ref={reviewTextareaRef}
            value={transcription}
            onChange={(event) => setTranscription(event.target.value)}
            aria-label={t('voice_recorder.header')}
            placeholder={t('voice_recorder.transcript_placeholder')}
            data-no-dictation
            rows={3}
            className="min-h-[80px] max-h-48 resize-y text-sm leading-relaxed"
          />

          {allowTranslate && showTranslation && (
            <div className="flex items-center gap-2">
              <Select aria-label={t('voice_recorder.translate_label')} value={translateTarget} onChange={(event) => setTranslateTarget(event.target.value)} density="compact" className="min-w-0 flex-1">
                {LANGUAGES.map((language) => <option key={language.code} value={language.code}>{language.label}</option>)}
              </Select>
              <Button tone="neutral" surface="solid" density="compact" onClick={handleTranslate} disabled={translating || !transcription.trim()}>
                {translating ? <RefreshCw className="animate-spin" /> : <RotateCcw />}
                {translating ? t('voice_recorder.translating') : t('voice_recorder.translate_btn')}
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            {allowTranslate && <IconButton tone="neutral" surface="ghost" size="sm" className="mr-auto" aria-label={t('voice_recorder.translate_label')} title={t('voice_recorder.translate_label')} aria-expanded={showTranslation} onClick={() => setShowTranslation(value => !value)}><Languages /></IconButton>}
            <Button tone="neutral" surface="ghost" density="compact" onClick={handleClose}>{t('voice_recorder.discard')}</Button>
            <Button tone="accent" surface="solid" density="compact" onClick={handleInsert} disabled={!transcription.trim()}><Send />{t('voice_recorder.use_text')}</Button>
          </div>
        </DialogContent>
      </Dialog>
    )
  }

  // Recording: inline waveform
  if (recorderState === 'recording') {
    return (
      <div className="flex items-center gap-2 px-1 py-0.5" data-voice-recorder="">
        {/* Live waveform */}
        <div className="flex items-end gap-[2px] h-5" aria-hidden="true">
          {barHeights.map((h, i) => (
            <div
              key={i}
              className="w-[2px] bg-red-500 rounded-full transition-all duration-75"
              style={{ height: `${h}px` }}
            />
          ))}
        </div>

        {/* Timer */}
        <span className="text-xs text-red-500 font-mono tabular-nums w-10 flex-shrink-0">
          {fmt(recordingTime)}
        </span>

        {/* Stop */}
        <button
          onClick={stopRecording}
          className="h-7 w-7 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-colors flex-shrink-0"
          title={t('voice_recorder.stop_title')}
          type="button"
        >
          <Square className="h-3 w-3 text-white fill-white" />
        </button>

        {/* Cancel */}
        <button
          onClick={cancelRecording}
          className="h-7 w-7 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors flex-shrink-0"
          title={t('voice_recorder.cancel_title')}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  // Processing
  if (recorderState === 'processing') {
    return (
      <div className="flex items-center gap-2 px-1">
        <RefreshCw className="h-4 w-4 animate-spin text-blue-500" />
        <span className="text-xs text-slate-500">{t('voice_recorder.processing')}</span>
      </div>
    )
  }

  // Idle
  return (
    <div className="relative flex-shrink-0" data-voice-recorder="">
      <button
        ref={micRef}
        onClick={startRecording}
        className={`${
          compact ? 'h-8 w-8' : 'h-9 w-9'
        } rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-blue-600 transition-colors`}
        title={t('voice_recorder.mic_title')}
        type="button"
      >
        <Mic className={compact ? 'h-4 w-4' : 'h-4 w-4'} />
      </button>
      {error && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 bg-red-50 border border-red-200 text-red-700 text-[11px] rounded-xl px-3 py-2 shadow-lg z-20 text-center">
          {error}
        </div>
      )}
    </div>
  )
}
