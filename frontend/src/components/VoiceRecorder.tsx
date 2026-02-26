/**
 * VoiceRecorder — reusable voice input component.
 *
 * Behavior:
 *   idle      → mic button
 *   recording → live waveform bars + timer + stop + cancel
 *   processing→ spinner while Whisper transcribes
 *   review    → bottom-sheet with editable transcription, playback, translation controls
 *
 * Props:
 *   onInsertText  – called with the final (possibly edited/translated) text.
 *                   In chatbot contexts this fills the textarea; the user still clicks Send.
 *   compact       – smaller mic icon (for chat sidebar)
 */

import { useState, useRef } from 'react'
import {
  Mic,
  Square,
  X,
  Send,
  RefreshCw,
  Volume2,
  Languages,
  RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'

interface VoiceRecorderProps {
  onInsertText: (text: string) => void
  compact?: boolean
}

type RecorderState = 'idle' | 'recording' | 'processing' | 'review'

const LANGUAGES = [
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
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

export function VoiceRecorder({ onInsertText, compact = false }: VoiceRecorderProps) {
  const { t } = useTranslation()
  const [recorderState, setRecorderState] = useState<RecorderState>('idle')
  const [transcription, setTranscription] = useState('')
  const [detectedLanguage, setDetectedLanguage] = useState('')
  const [translateTarget, setTranslateTarget] = useState('en')
  const [translating, setTranslating] = useState(false)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [recordingTime, setRecordingTime] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [barHeights, setBarHeights] = useState<number[]>(
    Array.from({ length: NUM_BARS }, () => 4)
  )

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const animFrameRef = useRef<number | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)

  const getToken = () =>
    localStorage.getItem('student_token') || localStorage.getItem('teacher_token') || ''

  // ─── recording ──────────────────────────────────────────────────────────────

  const startRecording = async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })

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
    }
  }

  const stopRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    mediaRecorderRef.current?.stop()
    setRecorderState('processing')
  }

  const cancelRecording = () => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
    mediaRecorderRef.current?.stop()
    // suppress the onstop → just reset
    setTimeout(() => setRecorderState('idle'), 50)
    chunksRef.current = []
  }

  // ─── transcription ──────────────────────────────────────────────────────────

  const transcribeBlob = async (blob: Blob, mimeType: string) => {
    try {
      const ext = mimeType.includes('mp4') ? 'mp4' : mimeType.includes('ogg') ? 'ogg' : 'webm'
      const fd = new FormData()
      fd.append('file', blob, `recording.${ext}`)

      const resp = await fetch('/api/v1/stt/transcribe', {
        method: 'POST',
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      })

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({ detail: 'Errore sconosciuto' }))
        throw new Error(body.detail || 'Trascrizione fallita')
      }

      const data = await resp.json()
      setTranscription(data.text || '')
      setDetectedLanguage(data.language || '')
      setRecorderState('review')
    } catch (e: any) {
      setError(e.message || 'Errore nella trascrizione. Riprova.')
      setRecorderState('idle')
    }
  }

  // ─── translation ────────────────────────────────────────────────────────────

  const handleTranslate = async () => {
    if (!transcription.trim()) return
    setTranslating(true)
    try {
      const resp = await fetch('/api/v1/stt/translate', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: transcription,
          source_language: detectedLanguage,
          target_language: translateTarget,
        }),
      })
      const data = await resp.json()
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

  // Review: bottom sheet
  if (recorderState === 'review') {
    return (
      <>
        {/* Backdrop */}
        <div className="fixed inset-0 bg-black/25 z-40 backdrop-blur-[1px]" onClick={handleClose} />

        {/* Sheet */}
        <div
          className="fixed bottom-0 left-0 right-0 bg-white rounded-t-3xl shadow-2xl border-t border-slate-100 z-50 p-5"
          style={{ animation: 'voiceSheetIn 0.25s ease-out' }}
        >
          {/* Drag handle */}
          <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto mb-4" />

          {/* Header row */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center">
                <Mic className="h-4 w-4 text-blue-600" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-800">{t('voice_recorder.header')}</p>
                {detectedLanguage && (
                  <p className="text-[11px] text-slate-400">
                    {t('voice_recorder.detected_lang', { lang: langLabel })}
                  </p>
                )}
              </div>
            </div>

            {/* Playback button */}
            {audioUrl && (
              <button
                onClick={() => audioRef.current?.play()}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 px-3 py-1.5 rounded-full border border-slate-200 hover:border-blue-200 transition-colors"
              >
                <Volume2 className="h-3.5 w-3.5" />
                {t('voice_recorder.listen')}
              </button>
            )}
            <audio ref={audioRef} src={audioUrl ?? ''} className="hidden" />
          </div>

          {/* Editable transcription */}
          <textarea
            value={transcription}
            onChange={(e) => setTranscription(e.target.value)}
            className="w-full text-sm border border-slate-200 rounded-2xl p-3.5 resize-none focus:outline-none focus:ring-2 focus:ring-blue-200 focus:border-blue-300 min-h-[96px] max-h-[220px] text-slate-800 leading-relaxed placeholder:text-slate-400"
            placeholder={t('voice_recorder.transcript_placeholder')}
            autoFocus
          />

          {/* Translation controls */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <Languages className="h-4 w-4 text-slate-400 flex-shrink-0" />
            <span className="text-xs text-slate-500">{t('voice_recorder.translate_label')}</span>
            <select
              value={translateTarget}
              onChange={(e) => setTranslateTarget(e.target.value)}
              className="text-xs border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white text-slate-700"
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.flag} {l.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleTranslate}
              disabled={translating || !transcription.trim()}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {translating ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              {translating ? t('voice_recorder.translating') : t('voice_recorder.translate_btn')}
            </button>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              className="text-slate-500 hover:text-slate-700 gap-1"
            >
              <X className="h-4 w-4" />
              {t('voice_recorder.discard')}
            </Button>
            <Button
              size="sm"
              onClick={handleInsert}
              disabled={!transcription.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white gap-1.5 px-4"
            >
              <Send className="h-3.5 w-3.5" />
              {t('voice_recorder.use_text')}
            </Button>
          </div>
        </div>

        <style>{`
          @keyframes voiceSheetIn {
            from { transform: translateY(100%); opacity: 0; }
            to   { transform: translateY(0);    opacity: 1; }
          }
        `}</style>
      </>
    )
  }

  // Recording: inline waveform
  if (recorderState === 'recording') {
    return (
      <div className="flex items-center gap-2 px-1 py-0.5">
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
    <div className="relative flex-shrink-0">
      <button
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
