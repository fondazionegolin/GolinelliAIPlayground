import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronDown, Download, Headphones, Languages, Loader2, Send, Trash2, Volume2 } from '@/components/icons'
import { Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, IconButton, Select } from '@/design'
import { useToast } from '@/components/ui/use-toast'
import { voiceCallsApi, type CallAnalysis, type CallRecording, type SpeechProvider } from '@/lib/api'
import { voiceLabApi } from '@/lib/voiceLab'
import { tl } from '@/i18n/tl'

const WAIT_LIMIT_MS = 6 * 60 * 1000

const signature = (a: CallAnalysis) => `${a.has_audio ? 1 : 0}:${a.audio_provider ?? ''}:${a.audio_seconds ?? ''}`

function providerLabel(value?: string | null) {
  if (!value) return ''
  const [provider, model] = value.split(':')
  return provider === 'elevenlabs' ? 'ElevenLabs' : `${model?.split('/').pop() ?? provider} · OpenRouter`
}

/** The spoken version of a translation, fetched with the teacher's session (the file is private). */
function SpokenAudio({ analysis }: { analysis: CallAnalysis }) {
  const { data: url } = useQuery({
    queryKey: ['call-audio', analysis.id, signature(analysis)],
    queryFn: async () => URL.createObjectURL((await voiceCallsApi.analysisAudio(analysis.id)).data),
    staleTime: Infinity,
    gcTime: 0,
  })
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])
  if (!url) return <Loader2 className="h-4 w-4 animate-spin text-[var(--text-secondary)]" />
  return (
    <div className="flex flex-col gap-1.5">
      <audio controls preload="metadata" src={url} className="h-10 w-full" />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--text-secondary)]">
        <span>{providerLabel(analysis.audio_provider)}{analysis.audio_seconds ? ` · ${Math.round(analysis.audio_seconds)} s` : ''}</span>
        <a href={url} download={`${analysis.title}.mp3`} className="flex items-center gap-1 font-semibold underline"><Download className="h-3 w-3" />{tl("Scarica MP3")}</a>
      </div>
    </div>
  )
}

function ShareDialog({ analysis, recording, open, onOpenChange }: { analysis: CallAnalysis; recording: CallRecording; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast()
  const [sessionId, setSessionId] = useState(recording.session_id ?? '')
  const [target, setTarget] = useState<'class' | 'student'>('class')
  const [studentId, setStudentId] = useState('')
  const [withAudio, setWithAudio] = useState(true)
  const sessions = useQuery({ queryKey: ['call-share-targets'], queryFn: async () => (await voiceCallsApi.shareTargets()).data, enabled: open })
  const students = useQuery({
    queryKey: ['call-share-students', sessionId], enabled: open && target === 'student' && !!sessionId,
    queryFn: async () => (await voiceCallsApi.shareTargetStudents(sessionId)).data,
  })
  useEffect(() => { setStudentId('') }, [sessionId])
  const share = useMutation({
    mutationFn: () => voiceCallsApi.shareAnalysis(analysis.id, {
      session_id: sessionId, student_id: target === 'student' ? studentId : undefined, include_audio: analysis.has_audio && withAudio,
    }),
    onSuccess: () => {
      toast({ title: target === 'student' ? tl("Inviato allo studente") : tl("Pubblicato nella chat di classe") })
      onOpenChange(false)
    },
    onError: (error: any) => toast({ title: tl("Impossibile condividere"), description: error?.response?.data?.detail, variant: 'destructive' }),
  })
  const ready = !!sessionId && (target === 'class' || !!studentId)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-xl">{tl("Condividi")}</DialogTitle>
          <DialogDescription>{analysis.title}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="grid gap-4">
            <label className="grid gap-1.5 text-xs font-semibold">{tl("Sessione")}
              <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)} aria-label={tl("Sessione")}>
                <option value="">{sessions.isLoading ? tl("Caricamento…") : tl("Scegli una sessione")}</option>
                {(sessions.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.class_name} · {s.title}</option>)}
              </Select>
            </label>
            <div role="radiogroup" aria-label={tl("Destinatario")} className="grid grid-cols-2 gap-2">
              {([['class', tl("Tutta la classe")], ['student', tl("Un solo studente")]] as const).map(([value, label]) => (
                <button key={value} type="button" role="radio" aria-checked={target === value} onClick={() => setTarget(value)}
                  className={`rounded-2xl px-3 py-2.5 text-sm font-semibold transition-colors ${target === value ? 'ds-selected' : 'bg-[var(--ds-surface-muted)] hover:bg-[var(--ds-control-hover)]'}`}>{label}</button>
              ))}
            </div>
            {target === 'student' && (
              <Select value={studentId} onChange={(e) => setStudentId(e.target.value)} aria-label={tl("Studente")} disabled={!sessionId}>
                <option value="">{students.isLoading ? tl("Caricamento…") : tl("Scegli lo studente")}</option>
                {(students.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.nickname}</option>)}
              </Select>
            )}
            {analysis.has_audio && (
              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={withAudio} onChange={(e) => setWithAudio(e.target.checked)} />{tl("Includi la voce (MP3)")}
              </label>
            )}
            <Button type="button" disabled={!ready || share.isPending} onClick={() => share.mutate()}>
              {share.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}{tl("Condividi")}
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function TranslationCard({ analysis, recording, onSpeak, speaking, onDelete }: {
  analysis: CallAnalysis; recording: CallRecording; onSpeak: () => void; speaking: boolean; onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [sharing, setSharing] = useState(false)
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--ds-surface)]">
      <header className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        <button type="button" aria-expanded={open} className="flex min-w-0 flex-1 basis-40 items-center gap-3 text-left" onClick={() => setOpen((v) => !v)}>
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--ds-surface-muted)] text-[var(--text-secondary)]"><Languages className="h-4 w-4" /></span>
          <span className="truncate text-sm font-semibold">{analysis.title}</span>
          <ChevronDown className={`h-4 w-4 flex-shrink-0 text-[var(--text-secondary)] transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        <div className="flex items-center gap-1">
          <Button type="button" tone="neutral" surface="soft" density="compact" disabled={speaking} onClick={onSpeak}
            title={analysis.has_audio ? tl("Rigenera la voce") : tl("Leggi ad alta voce")}>
            {speaking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Volume2 className="mr-1.5 h-3.5 w-3.5" />}
            {analysis.has_audio ? tl("Rigenera voce") : tl("Voce")}
          </Button>
          <IconButton type="button" tone="neutral" surface="ghost" size="sm" aria-label={tl("Condividi")} title={tl("Condividi con la classe o uno studente")} onClick={() => setSharing(true)}><Send className="h-4 w-4" /></IconButton>
          <IconButton type="button" tone="neutral" surface="ghost" size="sm" aria-label={tl("Elimina")} onClick={() => { if (window.confirm(tl("Eliminare questa traduzione?"))) onDelete() }}><Trash2 className="h-4 w-4" /></IconButton>
        </div>
      </header>
      {analysis.has_audio && <div className="px-4 pb-3"><SpokenAudio analysis={analysis} /></div>}
      {open && (
        <div className="prose prose-sm max-w-none border-t border-[var(--border-subtle)] p-4 text-[13px] sm:p-5">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{analysis.content}</ReactMarkdown>
        </div>
      )}
      {sharing && <ShareDialog analysis={analysis} recording={recording} open onOpenChange={setSharing} />}
    </section>
  )
}

/** Translate the summary / transcript of a recording, read them aloud, share them. Jobs run in the background. */
export function TranslationsPanel({ recording, analyses, hasSummary }: { recording: CallRecording; analyses: CallAnalysis[]; hasSummary: boolean }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data: catalogue } = useQuery({ queryKey: ['call-languages'], queryFn: async () => (await voiceCallsApi.languages()).data, staleTime: 3_600_000 })
  const [language, setLanguage] = useState(recording.pipeline?.languages?.[0] ?? 'en')
  const [provider, setProvider] = useState<SpeechProvider>('auto')
  const [fallback, setFallback] = useState('')
  const [voiceId, setVoiceId] = useState('')
  const [showVoice, setShowVoice] = useState(false)
  // Work started here and not finished yet: key -> what the analyses looked like when it started.
  const [waiting, setWaiting] = useState<Record<string, { since: number; sig: string }>>({})
  const startedRef = useRef(waiting)
  startedRef.current = waiting

  const voices = useQuery({
    queryKey: ['call-eleven-voices'], enabled: showVoice && provider !== 'openrouter' && !!catalogue?.speech.elevenlabs,
    queryFn: async () => (await voiceLabApi.voices()).data, staleTime: 600_000,
  })
  const translations = useMemo(() => analyses.filter((a) => a.kind === 'translation').sort((a, b) =>
    (a.language ?? '').localeCompare(b.language ?? '') || (a.source_kind === 'summary' ? -1 : 1)), [analyses])

  // Clear finished work; keep polling the recording while something is running.
  useEffect(() => {
    const keys = Object.keys(waiting)
    if (!keys.length) return
    const finished = keys.filter((key) => {
      const entry = waiting[key]
      if (Date.now() - entry.since > WAIT_LIMIT_MS) return true
      if (key.startsWith('tr:')) return analyses.some((a) => `tr:${a.language}:${a.source_kind}` === key && a.created_at && Date.parse(a.created_at) >= entry.since - 5000)
      const found = analyses.find((a) => `sp:${a.id}` === key)
      return !found || signature(found) !== entry.sig
    })
    if (finished.length) setWaiting((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !finished.includes(k))))
  }, [analyses, waiting])
  useEffect(() => {
    if (!Object.keys(waiting).length) return
    const timer = setInterval(() => queryClient.invalidateQueries({ queryKey: ['call-recording', recording.id] }), 4000)
    return () => clearInterval(timer)
  }, [waiting, queryClient, recording.id])

  const translate = useMutation({
    mutationFn: (source: 'summary' | 'transcript') => voiceCallsApi.translate(recording.id, { language, source }),
    onSuccess: (_r, source) => {
      setWaiting((prev) => ({ ...prev, [`tr:${language}:${source}`]: { since: Date.now(), sig: '' } }))
      toast({ title: tl("Traduzione avviata"), description: tl("Procede in background: puoi cambiare pagina.") })
    },
    onError: (error: any) => toast({ title: tl("Traduzione non avviata"), description: error?.response?.data?.detail, variant: 'destructive' }),
  })
  const speak = useMutation({
    mutationFn: (analysis: CallAnalysis) => voiceCallsApi.speak(analysis.id, {
      provider, voice_id: voiceId || undefined, fallback_model: fallback || catalogue?.speech.default_fallback,
    }),
    onSuccess: (_r, analysis) => {
      setWaiting((prev) => ({ ...prev, [`sp:${analysis.id}`]: { since: Date.now(), sig: signature(analysis) } }))
      toast({ title: tl("Sintesi vocale avviata"), description: tl("Se ElevenLabs non risponde, si usa un modello di riserva.") })
    },
    onError: (error: any) => toast({ title: tl("Voce non avviata"), description: error?.response?.data?.detail, variant: 'destructive' }),
  })
  const remove = useMutation({
    mutationFn: (analysis: CallAnalysis) => voiceCallsApi.deleteAnalysis(analysis.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['call-recording', recording.id] }),
  })

  const busyTranslate = (source: 'summary' | 'transcript') => translate.isPending || `tr:${language}:${source}` in waiting
  const languageName = catalogue?.languages.find((l) => l.code === language)

  return (
    <div className="grid gap-4">
      <section className="grid gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--ds-surface)] p-4">
        <div className="flex items-center gap-2 text-sm font-semibold"><Languages className="h-4 w-4 text-[var(--text-secondary)]" />{tl("Traduci per chi non parla ancora italiano")}</div>
        <Select value={language} onChange={(e) => setLanguage(e.target.value)} aria-label={tl("Lingua")}>
          {(catalogue?.languages ?? []).map((l) => <option key={l.code} value={l.code}>{l.name} · {l.native}</option>)}
        </Select>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" tone="accent" surface="solid" disabled={!hasSummary || busyTranslate('summary')} onClick={() => translate.mutate('summary')}
            title={hasSummary ? undefined : tl("Genera prima il riassunto")}>
            {busyTranslate('summary') ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Languages className="mr-2 h-4 w-4" />}{tl("Traduci il riassunto")}
          </Button>
          <Button type="button" tone="neutral" surface="soft" disabled={busyTranslate('transcript')} onClick={() => translate.mutate('transcript')}>
            {busyTranslate('transcript') ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Languages className="mr-2 h-4 w-4" />}{tl("Traduci la trascrizione")}
          </Button>
        </div>
        <button type="button" className="flex items-center gap-1.5 text-left text-xs font-semibold text-[var(--text-secondary)]" aria-expanded={showVoice} onClick={() => setShowVoice((v) => !v)}>
          <Headphones className="h-3.5 w-3.5" />{tl("Opzioni della voce")}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${showVoice ? 'rotate-180' : ''}`} />
        </button>
        {showVoice && catalogue && (
          <div className="grid gap-2">
            <Select value={provider} onChange={(e) => setProvider(e.target.value as SpeechProvider)} aria-label={tl("Servizio vocale")}>
              <option value="auto">{tl("Automatico: ElevenLabs, poi un modello di riserva")}</option>
              <option value="elevenlabs" disabled={!catalogue.speech.elevenlabs}>{tl("Solo ElevenLabs")}</option>
              <option value="openrouter">{tl("Solo modello di riserva (OpenRouter)")}</option>
            </Select>
            {provider !== 'openrouter' && catalogue.speech.elevenlabs && (
              <Select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} aria-label={tl("Voce ElevenLabs")}>
                <option value="">{voices.isLoading ? tl("Caricamento voci…") : tl("Voce ElevenLabs predefinita")}</option>
                {(voices.data ?? []).map((v) => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
              </Select>
            )}
            {provider !== 'elevenlabs' && (
              <Select value={fallback || catalogue.speech.default_fallback} onChange={(e) => setFallback(e.target.value)} aria-label={tl("Modello di riserva")}>
                {catalogue.speech.fallbacks.map((f) => <option key={f.model} value={f.model}>{f.label} · ${f.usd_per_1000_characters}/1000 car.</option>)}
              </Select>
            )}
            <p className="text-xs text-[var(--text-secondary)]">{tl("La voce si genera per ogni traduzione con «Voce». I costi sono scalati dai crediti.")}</p>
          </div>
        )}
      </section>

      {translations.length === 0 ? (
        <p className="py-4 text-center text-xs text-[var(--text-secondary)]">
          {languageName ? tl("Nessuna traduzione ancora: scegli «{0}» o un'altra lingua e premi Traduci.", languageName.name) : tl("Nessuna traduzione ancora.")}
        </p>
      ) : translations.map((a) => (
        <TranslationCard key={a.id} analysis={a} recording={recording} speaking={speak.isPending && speak.variables?.id === a.id || `sp:${a.id}` in waiting}
          onSpeak={() => speak.mutate(a)} onDelete={() => remove.mutate(a)} />
      ))}
    </div>
  )
}
