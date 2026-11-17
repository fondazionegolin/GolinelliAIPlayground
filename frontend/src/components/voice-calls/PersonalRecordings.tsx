import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Loader2, Mic, Volume2 } from '@/components/icons'
import { useQuery } from '@tanstack/react-query'
import { Button, IconButton, Select } from '@/design'
import { voiceCallsApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { ToastAction } from '@/components/ui/toast'
import { tl } from '@/i18n/tl'
import { recordingSupported, systemAudioSupported, usePersonalRecording, type RecordingSource } from '@/lib/personalRecording'

export const RECORDINGS_PATH = '/teacher/recordings'

function useClock(startedAt: number | null) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!startedAt) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  if (!startedAt) return '00:00'
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const h = Math.floor(seconds / 3600)
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const CONSENT = () => tl(
  "Avviare la registrazione?\n\nConferma di aver informato le persone che verranno registrate e di rispettare le regole della scuola sulla registrazione (anche per gli studenti minorenni). Audio e trascrizione restano privati."
)

let announcedId: string | null = null

/** Small red «rec» icon for the navbar. Opens a popover to start/stop; recordings live on their own page. Teachers only. */
export function NavbarRecordButton() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const { status, source, startedAt, error, lastClosed, start, stop, clearError } = usePersonalRecording()
  const [open, setOpen] = useState(false)
  const [choice, setChoice] = useState<RecordingSource>('mic')
  const [language, setLanguage] = useState('')
  const [speech, setSpeech] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const recording = status === 'recording' || status === 'stopping'
  const busy = status === 'starting' || status === 'stopping'
  const clock = useClock(recording ? startedAt : null)
  const supported = recordingSupported()
  const systemOk = systemAudioSupported()

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(352, window.innerWidth - 24)
      setPosition({ top: rect.bottom + 8, left: Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12)), width })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (panelRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])

  // Recording closed: transcription now runs as a background job (navbar indicator), the result lands in the page.
  useEffect(() => {
    if (!lastClosed || announcedId === lastClosed.id) return
    announcedId = lastClosed.id
    toast({
      title: tl("Registrazione terminata"),
      description: tl("La trascrizione procede in background: puoi cambiare pagina."),
      duration: 10000,
      action: <ToastAction altText={tl("Apri Registrazioni")} onClick={() => navigate(`${RECORDINGS_PATH}?recording=${lastClosed.id}`)}>{tl("Apri")}</ToastAction>,
    })
  }, [lastClosed, toast, navigate])

  const goToRecordings = () => { setOpen(false); navigate(RECORDINGS_PATH) }
  const begin = () => {
    if (!window.confirm(CONSENT())) return
    void start(choice, language ? { languages: [language], speech, provider: 'auto' } : undefined)
  }
  const { data: catalogue } = useQuery({ queryKey: ['call-languages'], queryFn: async () => (await voiceCallsApi.languages()).data, enabled: open, staleTime: 3_600_000 })

  const options: { value: RecordingSource; label: string; hint: string; icon: typeof Mic; off?: boolean }[] = [
    { value: 'mic', label: tl("Solo microfono"), hint: tl("Lezioni, riunioni, appunti vocali"), icon: Mic },
    { value: 'mic+system', label: tl("Microfono + audio di sistema"), hint: systemOk ? tl("Anche l'audio di una scheda o del computer") : tl("Solo Chrome/Edge da computer"), icon: Volume2, off: !systemOk },
  ]

  return (
    <>
      <IconButton ref={buttonRef} tone="neutral" surface="ghost" className="relative shrink-0" onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog" aria-expanded={open}
        aria-label={recording ? tl("Registrazione in corso · {0}", clock) : tl("Registra audio")}
        title={recording ? tl("Registrazione in corso · {0}", clock) : tl("Registra audio")}>
        <span className={`flex h-4 w-4 items-center justify-center rounded-full border-2 border-red-500 ${recording ? 'animate-pulse' : ''}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        </span>
        {recording && <span className="absolute -bottom-0.5 left-1/2 -translate-x-1/2 rounded-full bg-red-600 px-1 text-[8px] font-black leading-3 text-white tabular-nums">{clock}</span>}
      </IconButton>
      {open && position && createPortal(
        <div ref={panelRef} role="dialog" aria-label={tl("Registra audio")}
          className="ds-popover fixed z-[120] max-h-[calc(100dvh-5rem)] space-y-3 overflow-y-auto rounded-3xl p-4"
          style={{ top: position.top, left: position.left, width: position.width }}>
          {recording ? (
            <div className="flex flex-col items-center gap-2 text-center">
              <span className="flex items-center gap-2 text-sm font-bold text-red-600"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-600" />{tl("Registrazione in corso")}</span>
              <span className="text-4xl font-black tabular-nums">{clock}</span>
              <span className="text-xs text-[var(--text-secondary)]">
                {source === 'mic+system' ? tl("Microfono + audio di sistema") : tl("Solo microfono")}. {tl("Continua anche se cambi pagina. Su telefono tieni schermo e pagina aperti.")}
              </span>
              <Button type="button" className="w-full" onClick={() => void stop()} disabled={busy}>
                {status === 'stopping' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <span className="mr-2 h-3 w-3 rounded-sm bg-red-500" />}
                {tl("Termina e trascrivi")}
              </Button>
            </div>
          ) : (
            <>
              <h3 className="text-sm font-black">{tl("Registra audio")}</h3>
              <div role="radiogroup" aria-label={tl("Sorgente audio")} className="space-y-1.5">
                {options.map((option) => (
                  <button key={option.value} type="button" role="radio" aria-checked={choice === option.value} disabled={busy || option.off}
                    onClick={() => setChoice(option.value)}
                    className={`flex w-full items-start gap-3 rounded-2xl p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${choice === option.value ? 'ds-selected' : 'bg-[var(--ds-surface-muted)] hover:bg-[var(--ds-control-hover)]'}`}>
                    <option.icon className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold">{option.label}</span>
                      <span className="block text-xs text-[var(--text-secondary)]">{option.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
              <div className="space-y-2 rounded-2xl bg-[var(--ds-surface-muted)] p-3">
                <label className="grid gap-1 text-xs font-bold">{tl("Traduci anche in")}
                  <Select value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy} aria-label={tl("Lingua di traduzione")}>
                    <option value="">{tl("Nessuna traduzione")}</option>
                    {(catalogue?.languages ?? []).map((l) => <option key={l.code} value={l.code}>{l.name} · {l.native}</option>)}
                  </Select>
                </label>
                {language && (
                  <label className="flex items-center gap-2 text-xs font-semibold">
                    <input type="checkbox" checked={speech} onChange={(e) => setSpeech(e.target.checked)} />{tl("Genera anche la voce")}
                  </label>
                )}
                {language && <p className="text-[11px] text-[var(--text-secondary)]">{tl("Riassunto e trascrizione vengono tradotti in automatico dopo la registrazione.")}</p>}
              </div>
              <Button type="button" className="w-full" onClick={begin} disabled={busy || !supported}>
                {status === 'starting' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <span className="mr-2 h-3 w-3 rounded-full bg-red-500" />}
                {tl("Avvia registrazione")}
              </Button>
              {!supported && <p className="text-xs text-rose-600">{tl("Questo browser non supporta la registrazione audio")}</p>}
            </>
          )}
          {error && (
            <p role="alert" className="flex items-start justify-between gap-3 rounded-2xl bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-700">
              <span>{error}</span>
              <button type="button" className="shrink-0 underline" onClick={clearError}>{tl("Chiudi")}</button>
            </p>
          )}
          <button type="button" onClick={goToRecordings} className="flex w-full items-center justify-between rounded-2xl px-3 py-2.5 text-sm font-bold transition-colors hover:bg-[var(--ds-control-hover)]">
            {tl("Le tue registrazioni")}<ChevronRight className="h-4 w-4 text-[var(--text-secondary)]" />
          </button>
        </div>,
        document.body,
      )}
    </>
  )
}
