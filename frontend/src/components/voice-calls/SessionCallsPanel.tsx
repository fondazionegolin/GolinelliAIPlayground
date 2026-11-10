import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BookOpen, Brain, ChevronDown, ChevronRight, Clock, Copy, Download, ExternalLink, FileText, Loader2,
  Highlighter, MessageSquare, Mic, RefreshCw, Search, Settings2, Share2, Sparkles, Trash2, Video, X,
} from '@/components/icons'
import {
  Button, Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle, IconButton, Input, Select,
} from '@/design'
import { useToast } from '@/components/ui/use-toast'
import { voiceCallsApi, type CallAnalysis, type CallRecording, type CallToolKind } from '@/lib/api'
import { tl } from '@/i18n/tl'
import { buildAccentNavClusterStyle } from '@/lib/navbarGlass'
import { SearchPill } from '@/design/primitives/SearchPill'
import { clock, safeFileName, transcriptToMarkdown, transcriptToText } from '@/lib/transcriptFormat'
import { highlightChildren, useHighlighter, type Highlighter as HighlighterT } from './HighlightedText'
import { TranscriptView } from './TranscriptView'
import { openVoiceCall, voiceCallsQueryKey } from './VoiceCallLinkCard'

const TOOLS: { kind: Exclude<CallToolKind, 'custom' | 'summary'>; label: string; hint: string; icon: typeof Brain }[] = [
  { kind: 'synthesis', label: tl("Sintesi"), hint: tl("Punti chiave, concetti, decisioni, compiti"), icon: Sparkles },
  { kind: 'analysis', label: tl("Analisi didattica"), hint: tl("Partecipazione, comprensione, misconcezioni, suggerimenti. Resta privata: non entra nella knowledge finché non la aggiungi tu."), icon: Brain },
  { kind: 'questions', label: tl("Domande"), hint: tl("Dubbi emersi e domande di verifica per la classe"), icon: MessageSquare },
]

const SPEAKER_COLORS = ['#6366f1', '#0d9488', '#e85c8d', '#f59e0b', '#3b82f6', '#8b5cf6', '#16a34a', '#dc2626']

const humanDuration = (seconds: number) => {
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return tl("{0} min", Math.max(minutes, seconds > 0 ? 1 : 0))
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

const STATUS: Record<CallRecording['status'], { label: string; dot: string; pill: string }> = {
  recording: { label: tl("In registrazione"), dot: 'bg-red-500 animate-pulse', pill: 'bg-red-500/10 text-red-700' },
  processing: { label: tl("Elaborazione"), dot: 'bg-amber-400 animate-pulse', pill: 'bg-amber-400/20 text-amber-800' },
  ready: { label: tl("Pronta"), dot: 'bg-emerald-500', pill: 'bg-emerald-500/10 text-emerald-700' },
  failed: { label: tl("Errore"), dot: 'bg-rose-500', pill: 'bg-rose-500/10 text-rose-700' },
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'

/** Summary/analysis text: coloured headings bar, bold terms in the accent colour, keywords/numbers/names marked. */
function Markdown({ text, highlighter, highlight }: { text: string; highlighter: HighlighterT; highlight: boolean }) {
  const wrap = (children: React.ReactNode) => highlightChildren(children, highlighter, highlight)
  return (
    <div className="prose prose-sm max-w-none text-[15px] leading-7 text-[var(--text-primary)] dark:prose-invert
      prose-headings:mb-2 prose-headings:mt-6 prose-headings:border-l-4 prose-headings:border-violet-500 prose-headings:pl-3 prose-headings:font-bold prose-headings:text-[var(--text-primary)]
      prose-h1:text-lg prose-h2:text-base prose-h3:text-sm first:prose-headings:mt-0
      prose-strong:font-bold prose-strong:text-violet-700 dark:prose-strong:text-violet-300
      prose-li:my-1.5 prose-ul:my-2 prose-ol:my-2 prose-li:marker:text-violet-500
      prose-blockquote:border-l-4 prose-blockquote:border-teal-500 prose-blockquote:text-[var(--text-secondary)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p>{wrap(children)}</p>,
          li: ({ children }) => <li>{wrap(children)}</li>,
          td: ({ children }) => <td>{wrap(children)}</td>,
          blockquote: ({ children }) => <blockquote>{children}</blockquote>,
        }}
      >{text}</ReactMarkdown>
    </div>
  )
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon: typeof Brain }[] }) {
  return (
    <div className="flex w-fit max-w-full flex-wrap items-center gap-1 rounded-[var(--selection-radius)] p-1" style={buildAccentNavClusterStyle()}>
      {options.map((o) => (
        <Button key={o.value} type="button" tone="neutral" surface="ghost" density="compact" aria-pressed={value === o.value}
          className={value === o.value ? 'ds-selected' : ''} onClick={() => onChange(o.value)}>
          <o.icon className="mr-1.5 h-3.5 w-3.5" />{o.label}
        </Button>
      ))}
    </div>
  )
}

/** One block of the detail panel: tinted icon + title (+ actions) over a bordered surface. */
function Block({ icon: Icon, title, color, actions, children }: { icon: typeof Brain; title: string; color: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--ds-surface)]">
      <header className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-2.5" style={{ backgroundColor: `${color}12` }}>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ backgroundColor: `${color}26`, color }}><Icon className="h-4 w-4" /></span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-bold">{title}</h3>
        {actions}
      </header>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  )
}

/** Small round icon meaning «in the session knowledge». */
function KnowledgeMark({ on }: { on: boolean }) {
  if (!on) return null
  return (
    <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600" title={tl("Nella knowledge di sessione")} aria-label={tl("Nella knowledge di sessione")}>
      <BookOpen className="h-3.5 w-3.5" />
    </span>
  )
}

// ── Transcription engine (admins choose, teachers see) ─────────────────────────

function TranscriptionSettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { data } = useQuery({
    queryKey: [...voiceCallsQueryKey, 'transcription-settings'],
    queryFn: async () => (await voiceCallsApi.transcriptionSettings()).data,
    enabled: open,
    refetchInterval: open ? 10_000 : false,
  })
  const save = useMutation({
    mutationFn: async (value: string) => {
      const [engine, model] = value.split(':') as ['local' | 'openai', string]
      return (await voiceCallsApi.updateTranscriptionSettings({ engine, model, preload: true })).data
    },
    onSuccess: (_r, value) => {
      queryClient.invalidateQueries({ queryKey: [...voiceCallsQueryKey, 'transcription-settings'] })
      const model = value.split(':')[1]
      toast({
        title: tl("Modello aggiornato"),
        description: value.startsWith('local:') && !data?.downloaded.includes(model) ? tl("Download in corso sul server: qualche minuto la prima volta.") : undefined,
      })
    },
    onError: (error: any) => toast({ title: tl("Impossibile cambiare modello"), description: error?.response?.data?.detail, variant: 'destructive' }),
  })
  const value = data ? `${data.current.engine}:${data.current.model}` : ''
  const current = data?.options?.find((o) => `${o.engine}:${o.model}` === value)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <DialogHeader className="pr-10">
          <DialogTitle className="text-xl">{tl("Trascrizione")}</DialogTitle>
          <DialogDescription>{tl("Il modello che trascrive le registrazioni di tutte le chiamate.")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {!data ? <Loader2 className="mx-auto h-5 w-5 animate-spin" /> : (
            <div className="grid gap-3">
              {data.can_edit ? (
                <Select value={value} disabled={save.isPending} onChange={(e) => save.mutate(e.target.value)} aria-label={tl("Modello di trascrizione")}>
                  {(data.options ?? []).map((o) => {
                    const key = `${o.engine}:${o.model}`
                    const state = o.engine === 'local'
                      ? data.loaded_model === o.model ? tl(" · in memoria") : data.downloaded.includes(o.model) ? tl(" · scaricato") : tl(" · da scaricare")
                      : ''
                    return <option key={key} value={key}>{o.label}{state}</option>
                  })}
                </Select>
              ) : (
                <p className="text-sm font-bold">{current?.label ?? value}</p>
              )}
              {current?.note && <p className="text-xs text-[var(--text-secondary)]">{current.note}</p>}
              {data.current.engine === 'local' && (
                <p className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                  <span className={`h-2 w-2 rounded-full ${!data.local_available ? 'bg-rose-500' : data.loaded_model ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                  {!data.local_available
                    ? tl("Motore locale non disponibile: si usa OpenAI.")
                    : data.loaded_model ? tl("In memoria sulla {0}, si libera dopo 10 minuti di inattività.", data.device === 'cuda' ? 'GPU' : 'CPU')
                      : tl("Si carica alla prossima trascrizione.")}
                </p>
              )}
              {!data.can_edit && <p className="text-xs text-[var(--text-secondary)]">{tl("Solo gli amministratori possono cambiarlo.")}</p>}
            </div>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

// ── Detail panel ───────────────────────────────────────────────────────────────

function ResultActions({ analysis, recordingId, sessionBound }: { analysis: CallAnalysis; recordingId: string; sessionBound: boolean }) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['call-recording', recordingId] })
    queryClient.invalidateQueries({ queryKey: [...voiceCallsQueryKey, 'recordings'] })
  }
  const toKnowledge = useMutation({ mutationFn: () => voiceCallsApi.analysisToKnowledge(analysis.id), onSuccess: () => { refresh(); toast({ title: tl("Aggiunto alla knowledge") }) } })
  const share = useMutation({
    mutationFn: () => voiceCallsApi.shareAnalysis(analysis.id),
    onSuccess: () => toast({ title: tl("Pubblicato nella chat di classe"), description: tl("Gli studenti della sessione lo trovano nella chat.") }),
    onError: (error: any) => toast({ title: tl("Impossibile condividere"), description: error?.response?.data?.detail, variant: 'destructive' }),
  })
  const remove = useMutation({ mutationFn: () => voiceCallsApi.deleteAnalysis(analysis.id), onSuccess: refresh })
  return (
    <div className="flex items-center gap-1">
      <KnowledgeMark on={analysis.in_knowledge} />
      {!analysis.in_knowledge && sessionBound && (
        <IconButton tone="neutral" surface="ghost" size="sm" title={tl("Aggiungi alla knowledge (visibile agli studenti)")} aria-label={tl("Aggiungi alla knowledge")}
          disabled={toKnowledge.isPending} onClick={() => { if (window.confirm(tl("La knowledge di sessione è consultabile anche dagli studenti. Aggiungere questo testo?"))) toKnowledge.mutate() }}>
          <BookOpen className="h-4 w-4" />
        </IconButton>
      )}
      {sessionBound && (
        <IconButton tone="neutral" surface="ghost" size="sm" title={tl("Condividi nella chat di classe")} aria-label={tl("Condividi nella chat di classe")} disabled={share.isPending}
          onClick={() => { if (window.confirm(tl("Pubblicare «{0}» nella chat di classe? Lo vedranno tutti gli studenti della sessione.", analysis.title))) share.mutate() }}>
          {share.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
        </IconButton>
      )}
      <IconButton tone="neutral" surface="ghost" size="sm" title={tl("Copia")} aria-label={tl("Copia")} onClick={() => { void navigator.clipboard?.writeText(analysis.content); toast({ title: tl("Copiato") }) }}>
        <Copy className="h-4 w-4" />
      </IconButton>
      <IconButton tone="danger" surface="ghost" size="sm" title={tl("Elimina")} aria-label={tl("Elimina")} onClick={() => { if (window.confirm(tl("Eliminare questo risultato (anche dalla knowledge)?"))) remove.mutate() }}>
        <Trash2 className="h-4 w-4" />
      </IconButton>
    </div>
  )
}

function DownloadMenu({ items }: { items: { label: string; hint?: string; disabled?: boolean; onClick: () => void }[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const esc = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <IconButton type="button" tone="neutral" surface="ghost" size="sm" title={tl("Scarica")} aria-label={tl("Scarica")} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Download className="h-4 w-4" />
      </IconButton>
      {open && (
        <div role="menu" className="ds-popover absolute left-0 top-full z-20 mt-2 w-72 rounded-2xl p-1.5">
          {items.map((item) => (
            <button key={item.label} type="button" role="menuitem" disabled={item.disabled} onClick={() => { item.onClick(); setOpen(false) }}
              className="flex w-full flex-col rounded-xl px-3 py-2 text-left transition-colors hover:bg-[var(--ds-surface-muted)] disabled:opacity-40 disabled:hover:bg-transparent">
              <span className="text-sm font-semibold">{item.label}</span>
              {item.hint && <span className="text-xs text-[var(--text-secondary)]">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function download(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function RecordingDetail({ recording, onClose }: { recording: CallRecording; onClose: () => void }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<'summary' | 'transcript' | 'tools'>('summary')
  const [question, setQuestion] = useState('')
  const [lastCreated, setLastCreated] = useState<string | null>(null)
  const [openResults, setOpenResults] = useState<Set<string>>(new Set())

  const { data } = useQuery({
    queryKey: ['call-recording', recording.id],
    queryFn: async () => (await voiceCallsApi.getRecording(recording.id)).data,
    enabled: recording.status === 'ready',
  })
  const run = useMutation({
    mutationFn: async (vars: { kind: CallToolKind; prompt?: string }) => (await voiceCallsApi.runTool(recording.id, vars)).data,
    onSuccess: (analysis) => {
      setQuestion('')
      setLastCreated(analysis.id)
      if (analysis.kind === 'summary') setTab('summary')
      else setOpenResults((prev) => new Set(prev).add(analysis.id))
      queryClient.invalidateQueries({ queryKey: ['call-recording', recording.id] })
      queryClient.invalidateQueries({ queryKey: [...voiceCallsQueryKey, 'recordings'] })
    },
    onError: (error: any) => toast({ title: tl("Strumento non riuscito"), description: error?.response?.data?.detail, variant: 'destructive' }),
  })
  const retry = useMutation({
    mutationFn: () => voiceCallsApi.stopRecording(recording.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...voiceCallsQueryKey, 'recordings'] }),
    onError: (error: any) => toast({ title: tl("Operazione non riuscita"), description: error?.response?.data?.detail, variant: 'destructive' }),
  })
  const remove = useMutation({
    mutationFn: () => voiceCallsApi.deleteRecording(recording.id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [...voiceCallsQueryKey, 'recordings'] }); toast({ title: tl("Registrazione eliminata") }); onClose() },
  })

  const colors = useMemo(() => {
    const map = new Map<string, string>()
    recording.participants.forEach((p, i) => map.set(p.identity, SPEAKER_COLORS[i % SPEAKER_COLORS.length]))
    return map
  }, [recording.participants])
  const total = recording.participants.reduce((sum, p) => sum + p.seconds, 0) || 1
  const analyses = data?.analyses ?? []
  const summary = [...analyses].reverse().find((a) => a.kind === 'summary')
  const results = [...analyses].reverse().filter((a) => a !== summary)
  const model = recording.transcription_model?.replace('local:', '').replace('openai:', 'OpenAI ')
  const started = recording.started_at ? new Date(recording.started_at) : null
  const sessionBound = !!recording.session_id
  const status = STATUS[recording.status]

  const meta = [
    started ? started.toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '',
    recording.duration_seconds ? humanDuration(recording.duration_seconds) : '',
    recording.participants.length ? tl("Partecipanti: {0}", recording.participants.map((p) => p.name).join(', ')) : '',
  ].filter(Boolean).join(' · ')
  const fileBase = safeFileName(recording.title)
  const transcript = data?.transcript ?? []
  const [highlight, setHighlight] = useState(true)
  const [filter, setFilter] = useState('')
  const highlighter = useHighlighter(transcript.map((line) => line.text))
  const exportLines = transcript.map((line) => ({ speaker: line.speaker, start: line.start, text: line.text }))
  const summaryMarkdown = summary ? `# ${recording.title}\n\n_${meta}_\n\n${summary.content}\n` : ''
  const downloads = [
    { label: tl("Trascrizione (.txt)"), hint: tl("Testo pulito, un blocco per ogni intervento"), disabled: !transcript.length,
      onClick: () => download(`${fileBase}-trascrizione.txt`, transcriptToText(recording.title, meta, exportLines)) },
    { label: tl("Riassunto (.md)"), hint: tl("Il riassunto con titolo e partecipanti"), disabled: !summary,
      onClick: () => download(`${fileBase}-riassunto.md`, summaryMarkdown, 'text/markdown;charset=utf-8') },
    { label: tl("Tutto in un file (.md)"), hint: tl("Riassunto, risultati degli strumenti e trascrizione"), disabled: !transcript.length,
      onClick: () => download(`${fileBase}.md`, [
        `# ${recording.title}`, `_${meta}_`,
        summary ? `## ${summary.title}\n\n${summary.content}` : '',
        ...results.map((a) => `## ${a.title}\n\n${a.content}`),
        `## Trascrizione\n\n${transcriptToMarkdown(exportLines)}`,
      ].filter(Boolean).join('\n\n') + '\n', 'text/markdown;charset=utf-8') },
  ]
  const shareSummary = useMutation({
    mutationFn: () => voiceCallsApi.shareAnalysis(summary!.id),
    onSuccess: () => toast({ title: tl("Riassunto pubblicato nella chat di classe"), description: tl("Gli studenti della sessione lo trovano nella chat.") }),
    onError: (error: any) => toast({ title: tl("Impossibile condividere"), description: error?.response?.data?.detail, variant: 'destructive' }),
  })

  const facts = [
    started ? started.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '',
    recording.duration_seconds ? humanDuration(recording.duration_seconds) : '',
    recording.participants.length ? tl("{0} partecipanti", recording.participants.length) : '',
    model || '',
  ].filter(Boolean)
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-3">
      {/* Row 1: title and actions */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="min-w-0 flex-1 basis-56 truncate text-lg font-bold leading-snug" title={recording.title}>{recording.title}</h3>
        <div className="flex flex-wrap items-center gap-2">
          {recording.status === 'ready' && (
            <>
              <DownloadMenu items={downloads} />
              {sessionBound && (
                <IconButton type="button" tone="neutral" surface="ghost" size="sm" disabled={!summary || shareSummary.isPending} aria-label={tl("Condividi il riassunto")}
                  title={summary ? tl("Condividi il riassunto nella chat di classe") : tl("Genera prima il riassunto")}
                  onClick={() => { if (window.confirm(tl("Pubblicare il riassunto nella chat di classe? Lo vedranno tutti gli studenti della sessione."))) shareSummary.mutate() }}>
                  {shareSummary.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                </IconButton>
              )}
            </>
          )}
          <IconButton tone="danger" surface="ghost" size="sm" title={tl("Elimina la registrazione")} aria-label={tl("Elimina la registrazione")} disabled={remove.isPending} onClick={() => {
            if (window.confirm(tl("Eliminare audio, trascrizione e analisi? Verranno tolte anche dalla knowledge di sessione."))) remove.mutate()
          }}><Trash2 className="h-4 w-4" /></IconButton>
          <IconButton tone="neutral" surface="ghost" size="sm" title={tl("Chiudi")} aria-label={tl("Chiudi")} onClick={onClose}><X className="h-4 w-4" /></IconButton>
        </div>
      </div>

      {/* Row 2: plain facts + who spoke, on one line */}
      <div className="flex flex-shrink-0 flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--text-secondary)]">
        <span>{facts.join(' · ')}</span>
        {recording.status !== 'ready' && <span className="flex items-center gap-1.5 font-semibold"><span className={`h-2 w-2 rounded-full ${status.dot}`} />{status.label}</span>}
        {recording.in_knowledge && <span className="flex items-center gap-1.5 text-emerald-600"><BookOpen className="h-3.5 w-3.5" />{tl("Nella knowledge")}</span>}
        {recording.status === 'ready' && recording.participants.length > 0 && (
          <span className="flex min-w-[14rem] max-w-xl flex-1 items-center gap-3">
            <span className="flex h-1.5 min-w-[5rem] flex-1 overflow-hidden rounded-full bg-[var(--ds-surface-muted)]">
              {recording.participants.map((p) => <span key={p.identity} style={{ width: `${(p.seconds / total) * 100}%`, backgroundColor: colors.get(p.identity) }} title={`${p.name} · ${clock(p.seconds)}`} />)}
            </span>
            {recording.participants.slice(0, 3).map((p) => (
              <span key={p.identity} className="flex items-center gap-1.5 whitespace-nowrap" title={tl("{0} interventi, {1} parole", p.turns, p.words)}>
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colors.get(p.identity) }} />
                <span className="font-semibold text-[var(--text-primary)]">{p.name}</span>{Math.round((p.seconds / total) * 100)}%
              </span>
            ))}
            {recording.participants.length > 3 && <span>+{recording.participants.length - 3}</span>}
          </span>
        )}
      </div>

      {/* Problems / pending states */}
      {recording.error_message && (
        <div className="flex flex-shrink-0 items-center gap-3 rounded-2xl bg-rose-500/10 px-4 py-2.5 text-sm">
          <span className="min-w-0 flex-1">{recording.error_message}</span>
          <Button type="button" tone="neutral" surface="soft" density="compact" disabled={retry.isPending} onClick={() => retry.mutate()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />{tl("Riprova")}
          </Button>
        </div>
      )}
      {recording.status === 'recording' && (
        <div className="flex flex-shrink-0 items-center gap-3 rounded-2xl bg-[var(--ds-surface-muted)] px-4 py-2.5 text-sm">
          <span className="min-w-0 flex-1">{tl("La registrazione risulta ancora aperta.")}</span>
          <Button type="button" tone="neutral" surface="soft" density="compact" disabled={retry.isPending} onClick={() => retry.mutate()}>{tl("Chiudi ed elabora")}</Button>
        </div>
      )}
      {recording.status === 'processing' && (
        <div className="flex flex-shrink-0 items-center gap-3 rounded-2xl bg-[var(--ds-surface-muted)] px-4 py-8 text-sm text-[var(--text-secondary)]"><Loader2 className="h-5 w-5 animate-spin" />{tl("Trascrizione e riassunto in corso: puoi lasciare questa pagina, la chiamata resta qui.")}</div>
      )}

      {recording.status === 'ready' && (
        <>
          {/* Row 3: tabs, search (transcript) and highlight switch */}
          <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
            <Segmented value={tab} onChange={setTab} options={[
              { value: 'summary', label: tl("Riassunto"), icon: FileText },
              { value: 'transcript', label: tl("Trascrizione"), icon: MessageSquare },
              { value: 'tools', label: tl("Strumenti AI"), icon: Sparkles },
            ]} />
            {tab === 'transcript' && <SearchPill value={filter} placeholder={tl("Cerca nel testo o per nome")} onValueChange={setFilter} className="min-w-[10rem] flex-1" />}
            {tab !== 'tools' && (
              <div className="ml-auto flex items-center rounded-[var(--selection-radius)] p-1" style={buildAccentNavClusterStyle()}>
                <Button type="button" tone="neutral" surface="ghost" density="compact" aria-pressed={highlight} className={highlight ? 'ds-selected' : ''}
                  title={tl("Colora parole chiave (sottolineate), numeri, nomi propri e domande")} onClick={() => setHighlight((v) => !v)}>
                  <Highlighter className="mr-1.5 h-3.5 w-3.5" />{tl("Evidenzia")}
                </Button>
              </div>
            )}
          </div>

          {/* The body is what scrolls: the page height stays put however long the text is */}
          {!data ? <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-[var(--text-secondary)]" /> : tab === 'transcript' ? (
            <div className="min-h-0 flex-1 overflow-hidden max-lg:h-[60dvh]">
              {transcript.length
                ? <TranscriptView lines={transcript} colors={colors} highlighter={highlighter} highlight={highlight} filter={filter} />
                : <p className="py-6 text-center text-sm text-[var(--text-secondary)]">{tl("Nessun parlato riconosciuto.")}</p>}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto pr-2 max-lg:max-h-[60dvh]">
              {tab === 'summary' ? (
                summary ? (
                  <Block icon={FileText} title={summary.title} color="#6366f1" actions={<ResultActions analysis={summary} recordingId={recording.id} sessionBound={sessionBound} />}>
                    <Markdown text={summary.content.replace(/^#+\s*Riassunto\s*\n/i, '')} highlighter={highlighter} highlight={highlight} />
                  </Block>
                ) : (
                  <Block icon={FileText} title={tl("Riassunto")} color="#6366f1">
                    <Button type="button" tone="accent" surface="solid" disabled={run.isPending} onClick={() => run.mutate({ kind: 'summary' })}>
                      {run.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}{tl("Genera il riassunto")}
                    </Button>
                  </Block>
                )
              ) : (
                <div className="grid gap-4">
                  <Block icon={Sparkles} title={tl("Strumenti AI")} color="#0d9488">
                    <div className="grid gap-4">
                      <div className="flex flex-wrap gap-2">
                        {TOOLS.map((tool) => (
                          <Button key={tool.kind} type="button" tone="neutral" surface="soft" title={tool.hint} disabled={run.isPending} onClick={() => run.mutate({ kind: tool.kind })}>
                            {run.isPending && run.variables?.kind === tool.kind ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <tool.icon className="mr-1.5 h-4 w-4" />}{tool.label}
                          </Button>
                        ))}
                      </div>
                      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (question.trim()) run.mutate({ kind: 'custom', prompt: question.trim() }) }}>
                        <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={tl("Chiedi qualcosa sulla chiamata…")} className="flex-1" />
                        <IconButton type="submit" tone="accent" surface="solid" disabled={run.isPending || !question.trim()} aria-label={tl("Chiedi")}>
                          {run.isPending && run.variables?.kind === 'custom' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                        </IconButton>
                      </form>
                    </div>
                  </Block>
                  {results.length === 0 ? (
                    <p className="text-center text-xs text-[var(--text-secondary)]">{tl("I risultati compaiono qui sotto.")}</p>
                  ) : results.map((a) => {
                    const expanded = openResults.has(a.id) || a.id === lastCreated
                    const Icon = a.kind === 'analysis' ? Brain : a.kind === 'questions' ? MessageSquare : a.kind === 'custom' ? Search : Sparkles
                    return (
                      <section key={a.id} className="overflow-hidden rounded-2xl border border-[var(--border-subtle)] bg-[var(--ds-surface)]">
                        <header className="flex items-center gap-2 px-4 py-2.5">
                          <button type="button" aria-expanded={expanded} className="flex min-w-0 flex-1 items-center gap-3 text-left"
                            onClick={() => setOpenResults((prev) => { const next = new Set(prev); if (next.has(a.id) || a.id === lastCreated) { next.delete(a.id); if (a.id === lastCreated) setLastCreated(null) } else next.add(a.id); return next })}>
                            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--ds-surface-muted)] text-[var(--text-secondary)]"><Icon className="h-4 w-4" /></span>
                            <span className="truncate text-sm font-bold">{a.title}</span>
                            <ChevronDown className={`h-4 w-4 flex-shrink-0 text-[var(--text-secondary)] transition-transform ${expanded ? 'rotate-180' : ''}`} />
                          </button>
                          <ResultActions analysis={a} recordingId={recording.id} sessionBound={sessionBound} />
                        </header>
                        {expanded && <div className="border-t border-[var(--border-subtle)] p-4 sm:p-5"><Markdown text={a.content} highlighter={highlighter} highlight={highlight} /></div>}
                      </section>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── List ───────────────────────────────────────────────────────────────────────

function SpeakerStack({ participants, max = 3 }: { participants: CallRecording['participants']; max?: number }) {
  if (participants.length === 0) return null
  return (
    <div className="flex -space-x-2">
      {participants.slice(0, max).map((p, i) => (
        <span key={p.identity} title={`${p.name} · ${clock(p.seconds)}`} className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white ring-2 ring-[var(--ds-surface)]"
          style={{ backgroundColor: SPEAKER_COLORS[i % SPEAKER_COLORS.length] }}>{initials(p.name)}</span>
      ))}
      {participants.length > max && <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ds-surface-muted)] text-[10px] font-bold ring-2 ring-[var(--ds-surface)]">+{participants.length - max}</span>}
    </div>
  )
}

function CallRow({ recording, onOpen, compact, selected }: { recording: CallRecording; onOpen: () => void; compact: boolean; selected: boolean }) {
  const started = recording.started_at ? new Date(recording.started_at) : null
  const status = STATUS[recording.status]
  if (compact) {
    // Sidebar item: flat menu entry like the platform navigation, selection = ds-selected, no badges.
    const when = started ? [
      started.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
      started.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
      recording.duration_seconds ? humanDuration(recording.duration_seconds) : '',
    ].filter(Boolean).join(' · ') : ''
    return (
      <li>
        <button type="button" onClick={onOpen} aria-current={selected ? 'true' : undefined}
          className={`flex w-full items-center gap-2 rounded-[var(--selection-radius)] px-3 py-2 text-left transition-colors ${selected ? 'ds-selected' : 'hover:bg-[var(--ds-control-hover)]'}`}>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{recording.call_title || tl("Chiamata di classe")}</span>
            <span className="block truncate text-xs text-[var(--text-secondary)]">{when}</span>
          </span>
          {recording.status !== 'ready' && <span className={`h-2 w-2 flex-shrink-0 rounded-full ${status.dot}`} title={status.label} aria-label={status.label} />}
        </button>
      </li>
    )
  }
  return (
    <li>
      <button type="button" onClick={onOpen} aria-current={selected ? 'true' : undefined}
        className={`flex w-full items-center rounded-2xl text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--logo-violet)] ${compact ? 'gap-3 px-3 py-2.5' : 'gap-4 px-3 py-3.5 sm:px-4'} ${selected ? 'bg-[color-mix(in_srgb,var(--logo-violet)_12%,var(--mix-base))] shadow-[inset_3px_0_0_var(--logo-violet)]' : 'hover:bg-[var(--ds-surface-muted)]'}`}>
        {started && (
          <span className={`flex flex-shrink-0 flex-col items-center leading-tight ${compact ? 'w-10' : 'w-14'}`} aria-hidden="true">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">{started.toLocaleDateString(undefined, { month: 'short' }).replace('.', '')}</span>
            <span className={`${compact ? 'text-lg' : 'text-xl'} font-black tabular-nums`}>{started.getDate()}</span>
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-bold">{recording.call_title || tl("Chiamata di classe")}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--text-secondary)]">
            {started && <span>{started.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</span>}
            {recording.duration_seconds ? <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{humanDuration(recording.duration_seconds)}</span> : null}
            {!compact && recording.call_code ? <span className="flex items-center gap-1"><Video className="h-3 w-3" />{tl("con link")}</span> : null}
          </span>
        </span>
        {compact ? (
          <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${status.dot}`} title={status.label} aria-label={status.label} />
        ) : (
          <>
            <span className="hidden sm:block"><SpeakerStack participants={recording.participants} /></span>
            <span className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold sm:flex ${status.pill}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />{status.label}
            </span>
            <KnowledgeMark on={recording.in_knowledge} />
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-[var(--text-secondary)]" />
          </>
        )}
      </button>
    </li>
  )
}

function useViewport() {
  const [size, setSize] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

/**
 * Session configuration › «Chiamate». At first only the list of recorded calls, full width. Opening one slides the
 * list into a sidebar on the left and shows the call in the rest of the panel (fixed height, the text scrolls inside).
 */
export function SessionCallsPanel({ sessionId }: { sessionId: string }) {
  // `?recording=<id>` (link from the «registrazione terminata» notice) opens that call straight away.
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('recording'))
  const [settingsOpen, setSettingsOpen] = useState(false)
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
  const opened = recordings.find((r) => r.id === openId) ?? null
  const live = calls.find((call) => call.live)
  // With a call open (wide screens) the body has a fixed, fairly short height: the call's text scrolls inside it
  // and the section never grows past the screen (scrolling starts early on purpose).
  const viewport = useViewport()
  const fixedHeight = opened && viewport.width >= 1024 ? Math.min(600, Math.max(420, viewport.height - 380)) : undefined

  // Esc closes the open call (unless the user is typing).
  useEffect(() => {
    if (!opened) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (event.key === 'Escape' && !/^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) setOpenId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [opened])

  return (
    <div className="space-y-4">
      {/* Same panel as the other session sections («Moduli visibili agli studenti»…) */}
      <section className="ds-panel overflow-hidden rounded-[var(--ds-radius-panel)]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4 shadow-[inset_0_-1px_0_var(--ds-frame-divider)] sm:px-6">
          <Video className="h-[18px] w-[18px] text-[var(--logo-violet)]" />
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-black text-slate-900">{tl("Chiamate registrate")}</h2>
            <p className="text-xs text-slate-500">{tl("Trascrizione con i nomi, riassunto e strumenti AI di ogni chiamata.")}</p>
          </div>
          <span className="rounded-full bg-[color-mix(in_srgb,var(--logo-violet)_10%,var(--mix-base))] px-2.5 py-1 text-[11px] font-bold text-[var(--logo-violet)]">
            {recordings.length} {recordings.length === 1 ? tl("chiamata") : tl("chiamate")}
          </span>
          <IconButton tone="neutral" surface="ghost" size="sm" title={tl("Modello di trascrizione")} aria-label={tl("Modello di trascrizione")} onClick={() => setSettingsOpen(true)}>
            <Settings2 className="h-4 w-4" />
          </IconButton>
        </div>

        {live && (
          <button type="button" onClick={() => openVoiceCall(live.code)} className="flex w-full items-center gap-3 bg-emerald-500/10 px-5 py-3 text-left text-sm transition-colors hover:bg-emerald-500/15 sm:px-6">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" />
            <span className="min-w-0 flex-1 truncate"><strong>{live.title}</strong> {tl("è in corso")}</span>
            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">{tl("Entra")}<ExternalLink className="h-3.5 w-3.5" /></span>
          </button>
        )}

        {isLoading ? <Loader2 className="mx-auto my-10 h-5 w-5 animate-spin text-[var(--text-secondary)]" /> : recordings.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
            <Mic className="h-7 w-7 text-[var(--text-secondary)]" />
            <p className="text-sm font-bold">{tl("Nessuna chiamata registrata")}</p>
            <p className="max-w-sm text-xs text-[var(--text-secondary)]">{tl("Durante una chiamata premi «Registra»: la trascrizione arriva qui.")}</p>
          </div>
        ) : (
          <motion.div initial={false} animate={{ height: fixedHeight ?? 'auto' }} transition={{ type: 'spring', stiffness: 260, damping: 32 }} className="flex gap-0 overflow-hidden">
            {/* List: full width until a call is open, then a 19rem sidebar (width animates) */}
            <motion.nav
              aria-label={tl("Chiamate registrate")}
              initial={false}
              animate={{ width: opened ? 272 : '100%' }}
              transition={{ type: 'spring', stiffness: 260, damping: 32 }}
              className={`min-h-0 flex-shrink-0 overflow-y-auto p-2 sm:p-3 ${opened ? 'max-lg:hidden lg:shadow-[inset_-1px_0_0_var(--ds-frame-divider)]' : ''}`}
            >
              <ul className={opened ? 'space-y-0.5' : 'divide-y divide-[var(--ds-frame-divider)]'}>
                {recordings.map((recording) => (
                  <CallRow key={recording.id} recording={recording} compact={!!opened} selected={recording.id === openId}
                    onOpen={() => setOpenId(recording.id === openId ? null : recording.id)} />
                ))}
              </ul>
            </motion.nav>

            {/* The open call, in the page */}
            <AnimatePresence initial={false}>
              {opened && (
                <motion.div
                  key="detail"
                  initial={{ opacity: 0, x: 32 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 32 }}
                  transition={{ duration: 0.25, ease: 'easeOut' }}
                  className="min-h-0 min-w-0 flex-1 overflow-hidden p-4 sm:p-5"
                >
                  <RecordingDetail key={opened.id} recording={opened} onClose={() => setOpenId(null)} />
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </section>

      <TranscriptionSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  )
}
