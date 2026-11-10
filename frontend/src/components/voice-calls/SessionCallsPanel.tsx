import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BookOpen, Brain, ChevronDown, Download, ExternalLink, FileText, Loader2, MessageSquare, RefreshCw, Search, Sparkles, Trash2, Users, Video,
} from '@/components/icons'
import { Button, Card, Input, Textarea } from '@/design'
import { useToast } from '@/components/ui/use-toast'
import { voiceCallsApi, type CallAnalysis, type CallRecording, type CallToolKind } from '@/lib/api'
import { tl } from '@/i18n/tl'
import { buildAccentNavClusterStyle } from '@/lib/navbarGlass'
import { VoiceCallCodeTag, formatCallWhen, openVoiceCall, voiceCallsQueryKey } from './VoiceCallLinkCard'

const TOOLS: { kind: Exclude<CallToolKind, 'custom'>; label: string; hint: string; icon: typeof Brain }[] = [
  { kind: 'summary', label: tl("Riassunto"), hint: tl("Di cosa si è parlato, in ordine, con le conclusioni"), icon: FileText },
  { kind: 'synthesis', label: tl("Sintesi"), hint: tl("Punti chiave, concetti, decisioni, compiti"), icon: Sparkles },
  { kind: 'analysis', label: tl("Analisi didattica"), hint: tl("Partecipazione, comprensione, misconcezioni, suggerimenti"), icon: Brain },
  { kind: 'questions', label: tl("Domande e verifica"), hint: tl("Dubbi emersi e domande di verifica per la classe"), icon: MessageSquare },
]

const SPEAKER_COLORS = ['#6366f1', '#0d9488', '#e85c8d', '#f59e0b', '#3b82f6', '#8b5cf6', '#16a34a', '#dc2626']

const clock = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

const STATUS: Record<CallRecording['status'], { label: string; className: string }> = {
  recording: { label: tl("In registrazione"), className: 'bg-red-100 text-red-700' },
  processing: { label: tl("Elaborazione…"), className: 'bg-amber-100 text-amber-800' },
  ready: { label: tl("Pronta"), className: 'bg-emerald-100 text-emerald-700' },
  failed: { label: tl("Errore"), className: 'bg-rose-100 text-rose-700' },
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none text-[var(--text-primary)] prose-headings:text-[var(--text-primary)] prose-strong:text-[var(--text-primary)] dark:prose-invert">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

function AnalysisCard({ analysis, recordingId, sessionBound }: { analysis: CallAnalysis; recordingId: string; sessionBound: boolean }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(true)
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['call-recording', recordingId] })
    queryClient.invalidateQueries({ queryKey: [...voiceCallsQueryKey, 'recordings'] })
  }
  const toKnowledge = useMutation({
    mutationFn: () => voiceCallsApi.analysisToKnowledge(analysis.id),
    onSuccess: () => { refresh(); toast({ title: tl("Aggiunto alla knowledge di sessione") }) },
  })
  const remove = useMutation({ mutationFn: () => voiceCallsApi.deleteAnalysis(analysis.id), onSuccess: refresh })
  return (
    <div className="rounded-2xl bg-[var(--ds-surface)] p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <ChevronDown className={`h-4 w-4 flex-shrink-0 transition-transform ${open ? '' : '-rotate-90'}`} />
          <span className="truncate text-sm font-bold">{analysis.title}</span>
        </button>
        {analysis.in_knowledge ? (
          <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"><BookOpen className="h-3 w-3" />{tl("Nella knowledge")}</span>
        ) : sessionBound && (
          <Button type="button" tone="neutral" surface="soft" density="compact" disabled={toKnowledge.isPending} onClick={() => {
            if (window.confirm(tl("La knowledge di sessione è consultabile anche dagli studenti della sessione. Aggiungere questo testo?"))) toKnowledge.mutate()
          }}>
            <BookOpen className="mr-1 h-3.5 w-3.5" />{tl("Aggiungi alla knowledge")}
          </Button>
        )}
        <Button type="button" tone="neutral" surface="ghost" density="icon" aria-label={tl("Copia")} onClick={() => { void navigator.clipboard?.writeText(analysis.content); toast({ title: tl("Copiato") }) }}>
          <FileText className="h-4 w-4" />
        </Button>
        <Button type="button" tone="danger" surface="ghost" density="icon" aria-label={tl("Elimina")} onClick={() => { if (window.confirm(tl("Eliminare questo risultato (anche dalla knowledge)?"))) remove.mutate() }}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {open && <div className="mt-3"><Markdown text={analysis.content} /></div>}
    </div>
  )
}

function RecordingDetail({ recording }: { recording: CallRecording }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [view, setView] = useState<'tools' | 'transcript'>('tools')
  const [filter, setFilter] = useState('')
  const [question, setQuestion] = useState('')
  const { data, isLoading } = useQuery({
    queryKey: ['call-recording', recording.id],
    queryFn: async () => (await voiceCallsApi.getRecording(recording.id)).data,
    enabled: recording.status === 'ready',
  })
  const run = useMutation({
    mutationFn: async (vars: { kind: CallToolKind; prompt?: string }) => (await voiceCallsApi.runTool(recording.id, vars)).data,
    onSuccess: () => {
      setQuestion('')
      queryClient.invalidateQueries({ queryKey: ['call-recording', recording.id] })
      queryClient.invalidateQueries({ queryKey: [...voiceCallsQueryKey, 'recordings'] })
    },
    onError: (error: any) => toast({ title: tl("Strumento non riuscito"), description: error?.response?.data?.detail, variant: 'destructive' }),
  })

  const colors = useMemo(() => {
    const map = new Map<string, string>()
    recording.participants.forEach((p, i) => map.set(p.identity, SPEAKER_COLORS[i % SPEAKER_COLORS.length]))
    return map
  }, [recording.participants])

  const lines = (data?.transcript ?? []).filter((line) => !filter.trim() || `${line.speaker} ${line.text}`.toLowerCase().includes(filter.toLowerCase()))
  const download = () => {
    const text = (data?.transcript ?? []).map((line) => `[${clock(line.start)}] ${line.speaker}: ${line.text}`).join('\n')
    const url = URL.createObjectURL(new Blob([`${recording.title}\n\n${text}\n`], { type: 'text/plain;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `trascrizione-${recording.title.replace(/[^\w-]+/g, '_')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (recording.status !== 'ready') return null
  if (isLoading || !data) return <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-[var(--text-secondary)]" />

  return (
    <div className="mt-4 grid gap-4">
      <div className="flex w-fit items-center gap-1 rounded-[var(--selection-radius)] p-1" style={buildAccentNavClusterStyle()}>
        {([['tools', tl("Strumenti AI")], ['transcript', tl("Trascrizione")]] as const).map(([value, label]) => (
          <Button key={value} type="button" tone="neutral" surface="ghost" density="compact" aria-pressed={view === value}
            className={view === value ? 'ds-selected' : ''} onClick={() => setView(value)}>{label}</Button>
        ))}
      </div>

      {view === 'tools' ? (
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {TOOLS.map((tool) => (
              <button key={tool.kind} type="button" disabled={run.isPending} onClick={() => run.mutate({ kind: tool.kind })}
                className="flex items-start gap-3 rounded-2xl bg-[var(--ds-surface)] p-3 text-left shadow-[var(--shadow-sm)] transition hover:-translate-y-px hover:shadow-[var(--shadow-lg)] disabled:opacity-50">
                {run.isPending && run.variables?.kind === tool.kind ? <Loader2 className="mt-0.5 h-5 w-5 flex-shrink-0 animate-spin" /> : <tool.icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--text-secondary)]" />}
                <span>
                  <span className="block text-sm font-bold">{tool.label}</span>
                  <span className="block text-xs text-[var(--text-secondary)]">{tool.hint}</span>
                </span>
              </button>
            ))}
          </div>
          <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(e) => { e.preventDefault(); if (question.trim()) run.mutate({ kind: 'custom', prompt: question.trim() }) }}>
            <Textarea value={question} onChange={(e) => setQuestion(e.target.value)} rows={2} placeholder={tl("Chiedi qualcosa sulla chiamata (es. «Quali studenti hanno avuto difficoltà con le frazioni?»)")} className="flex-1" />
            <Button type="submit" tone="accent" surface="solid" disabled={run.isPending || !question.trim()} className="sm:self-end">
              {run.isPending && run.variables?.kind === 'custom' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}{tl("Chiedi")}
            </Button>
          </form>
          <p className="text-xs text-[var(--text-secondary)]">
            {recording.session_id
              ? tl("Trascrizione, riassunto, sintesi e domande entrano nella knowledge di sessione, consultabile anche dagli studenti. L'analisi didattica resta privata finché non la aggiungi tu. I crediti usati sono i tuoi.")
              : tl("Questa chiamata non è collegata a una sessione: i risultati restano qui.")}
          </p>
          {(data.analyses ?? []).slice().reverse().map((analysis) => (
            <AnalysisCard key={analysis.id} analysis={analysis} recordingId={recording.id} sessionBound={!!recording.session_id} />
          ))}
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--text-secondary)]" />
              <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={tl("Cerca nella trascrizione o per nome")} className="pl-9" />
            </div>
            <Button type="button" tone="neutral" surface="soft" density="compact" onClick={download}><Download className="mr-1.5 h-4 w-4" />{tl("Scarica .txt")}</Button>
          </div>
          <div className="max-h-[60vh] space-y-2 overflow-y-auto rounded-2xl bg-[var(--ds-surface)] p-4">
            {lines.length === 0 && <p className="text-center text-sm text-[var(--text-secondary)]">{tl("Nessuna riga")}</p>}
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2 text-sm">
                <span className="pt-0.5 font-mono text-[11px] text-[var(--text-secondary)]">{clock(line.start)}</span>
                <p><span className="font-bold" style={{ color: colors.get(line.identity) }}>{line.speaker}: </span>{line.text}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RecordingCard({ recording }: { recording: CallRecording }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const refresh = () => queryClient.invalidateQueries({ queryKey: [...voiceCallsQueryKey, 'recordings'] })
  const retry = useMutation({ mutationFn: () => voiceCallsApi.stopRecording(recording.id), onSuccess: refresh,
    onError: (error: any) => toast({ title: tl("Operazione non riuscita"), description: error?.response?.data?.detail, variant: 'destructive' }) })
  const remove = useMutation({ mutationFn: () => voiceCallsApi.deleteRecording(recording.id), onSuccess: () => { refresh(); toast({ title: tl("Registrazione eliminata") }) } })
  const total = recording.participants.reduce((sum, p) => sum + p.seconds, 0) || 1
  const status = STATUS[recording.status]

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start gap-3">
        <button type="button" onClick={() => setOpen((v) => !v)} disabled={recording.status !== 'ready'} className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-default">
          <span className="mt-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-[var(--ds-surface-muted)]"><Video className="h-5 w-5 text-[var(--text-secondary)]" /></span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold">{recording.title}</span>
            <span className="block text-xs text-[var(--text-secondary)]">
              {recording.started_at ? formatCallWhen(recording.started_at) : ''}
              {recording.duration_seconds ? ` · ${clock(recording.duration_seconds)}` : ''}
              {recording.status === 'ready' ? ` · ${tl("{0} interventi", recording.lines)}` : ''}
            </span>
          </span>
        </button>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${status.className}`}>
          {recording.status === 'processing' && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />}{status.label}
        </span>
        {recording.in_knowledge && <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-700"><BookOpen className="h-3 w-3" />{tl("Nella knowledge")}</span>}
        {(recording.status === 'failed' || recording.status === 'recording') && (
          <Button type="button" tone="neutral" surface="soft" density="compact" disabled={retry.isPending} onClick={() => {
            if (recording.status === 'recording' && !window.confirm(tl("La registrazione risulta ancora attiva. Chiuderla ed elaborare l'audio arrivato finora?"))) return
            retry.mutate()
          }}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />{recording.status === 'failed' ? tl("Riprova") : tl("Chiudi ed elabora")}
          </Button>
        )}
        <Button type="button" tone="danger" surface="ghost" density="icon" aria-label={tl("Elimina registrazione")} onClick={() => {
          if (window.confirm(tl("Eliminare audio, trascrizione e analisi di questa registrazione? Verranno tolte anche dalla knowledge di sessione."))) remove.mutate()
        }}>
          <Trash2 className="h-4 w-4" />
        </Button>
        {recording.status === 'ready' && (
          <Button type="button" tone="neutral" surface="ghost" density="icon" aria-label={tl("Apri")} onClick={() => setOpen((v) => !v)}>
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} />
          </Button>
        )}
      </div>
      {recording.error_message && <p className="mt-2 text-xs font-semibold text-[var(--logo-pink)]">{recording.error_message}</p>}
      {recording.participants.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {recording.participants.map((p, i) => (
            <span key={p.identity} className="flex items-center gap-2 rounded-full bg-[var(--ds-surface-muted)] px-2.5 py-1 text-[11px] font-semibold" title={tl("{0} interventi, {1} parole", p.turns, p.words)}>
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: SPEAKER_COLORS[i % SPEAKER_COLORS.length] }} />
              {p.name}
              <span className="text-[var(--text-secondary)]">{clock(p.seconds)} · {Math.round((p.seconds / total) * 100)}%</span>
            </span>
          ))}
        </div>
      )}
      {open && <RecordingDetail recording={recording} />}
    </Card>
  )
}

/** Session configuration › «Chiamate»: the session's video calls and every recording with its AI tools. */
export function SessionCallsPanel({ sessionId }: { sessionId: string }) {
  const { data: calls = [] } = useQuery({
    queryKey: [...voiceCallsQueryKey, 'session', sessionId],
    queryFn: async () => (await voiceCallsApi.list(sessionId)).data,
    refetchInterval: 30_000,
  })
  const { data: recordings = [], isLoading } = useQuery({
    queryKey: [...voiceCallsQueryKey, 'recordings', sessionId],
    queryFn: async () => (await voiceCallsApi.listRecordings(sessionId)).data,
    refetchInterval: (query) => (query.state.data ?? []).some((r) => r.status === 'processing' || r.status === 'recording') ? 5000 : 60_000,
  })

  return (
    <div className="grid gap-5">
      <section className="grid gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold"><Users className="h-4 w-4" />{tl("Videochiamate della sessione")}</h2>
        {calls.length === 0 ? (
          <p className="text-sm text-[var(--text-secondary)]">{tl("Nessuna videochiamata: creala dalla chat di classe («Videochiamate con link») o da un evento del calendario.")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {calls.map((call) => (
              <div key={call.id} className="flex items-center gap-3 rounded-2xl bg-[var(--ds-surface)] px-4 py-3 shadow-[var(--shadow-sm)]">
                <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${call.live ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{call.title}</div>
                  <div className="truncate text-xs text-[var(--text-secondary)]">
                    {call.live ? tl("In corso") : call.next_event ? tl("Prossima: {0}", formatCallWhen(call.next_event.starts_at)) : call.last_started_at ? tl("Ultima: {0}", formatCallWhen(call.last_started_at)) : tl("Mai avviata")}
                  </div>
                </div>
                <VoiceCallCodeTag code={call.code} />
                <Button type="button" tone="neutral" surface="ghost" density="icon" aria-label={tl("Apri")} onClick={() => openVoiceCall(call.code)}><ExternalLink className="h-4 w-4" /></Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold"><Video className="h-4 w-4" />{tl("Registrazioni e strumenti AI")}</h2>
          <p className="text-xs text-[var(--text-secondary)]">{tl("Avvia la registrazione dalla videochiamata (pulsante «Registra»). Alla fine trovi qui la trascrizione con i nomi di chi parla, il riassunto e gli strumenti di sintesi e analisi; tutto entra nella knowledge di sessione.")}</p>
        </div>
        {isLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin text-[var(--text-secondary)]" />}
        {!isLoading && recordings.length === 0 && (
          <Card className="p-6 text-center text-sm text-[var(--text-secondary)]">{tl("Nessuna chiamata registrata in questa sessione.")}</Card>
        )}
        {recordings.map((recording) => <RecordingCard key={recording.id} recording={recording} />)}
      </section>
    </div>
  )
}
