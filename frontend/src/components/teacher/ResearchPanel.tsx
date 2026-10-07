import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BookOpen, Brain, Check, ChevronDown, ChevronRight, Copy, Download, Eye, FileText, Globe, Layers, Loader2,
  Pencil, Search, Sparkles, Square, X, AlertCircle,
} from '@/components/icons'
import type { GeneratedDoc } from '@/components/teacher/DocumentCanvas'

export type ResearchRole = 'crawler' | 'reader' | 'analyst' | 'writer' | 'editor'

export interface ResearchAgent {
  id: string
  role: ResearchRole
  label: string
  status: 'running' | 'done' | 'error'
  parent?: string | null
  detail?: string
  logs: string[]
}

export interface ResearchRound {
  round: number
  max_rounds?: number
  status?: 'running' | 'done'
  novelty?: number
  saturated?: boolean
}

export interface ResearchRun {
  status: 'idle' | 'running' | 'done' | 'error'
  agents: ResearchAgent[]
  rounds: ResearchRound[]
  sources: number
  statusText?: string
  error?: string
}

export const EMPTY_RESEARCH_RUN: ResearchRun = { status: 'idle', agents: [], rounds: [], sources: 0 }

/** Fold one SSE event of the deep-research stream into the run state (pure, safe to call in setState). */
export function applyResearchEvent(run: ResearchRun, event: any): ResearchRun {
  switch (event.type) {
    case 'agent': {
      const info = event.agent
      const index = run.agents.findIndex((a) => a.id === info.id)
      const agent: ResearchAgent = { ...(index >= 0 ? run.agents[index] : { logs: [] }), ...info }
      const agents = index >= 0 ? run.agents.map((a, i) => (i === index ? agent : a)) : [...run.agents, agent]
      return { ...run, agents }
    }
    case 'agent_log':
      return { ...run, agents: run.agents.map((a) => (a.id === event.id ? { ...a, logs: [...a.logs, event.message].slice(-25) } : a)) }
    case 'source':
      return { ...run, sources: run.sources + 1 }
    case 'round': {
      const rounds = run.rounds.some((r) => r.round === event.round)
        ? run.rounds.map((r) => (r.round === event.round ? { ...r, ...event } : r))
        : [...run.rounds, event]
      return { ...run, rounds }
    }
    case 'status':
      return { ...run, statusText: event.message }
    case 'error':
      return { ...run, status: 'error', error: event.message }
    case 'done':
      return { ...run, status: 'done', statusText: undefined }
    default:
      return run
  }
}

const ROLE_META: Record<ResearchRole, { label: string; Icon: typeof Search }> = {
  crawler: { label: 'Crawler', Icon: Search },
  reader: { label: 'Lettore', Icon: Globe },
  analyst: { label: 'Analista', Icon: Brain },
  writer: { label: 'Autore', Icon: Pencil },
  editor: { label: 'Editor', Icon: Layers },
}

function StatusDot({ status }: { status: ResearchAgent['status'] }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--selection-text)]" />
  if (status === 'error') return <AlertCircle className="h-3.5 w-3.5 text-rose-500" />
  return <Check className="h-3.5 w-3.5 text-emerald-600" />
}

function AgentRow({ agent, depth }: { agent: ResearchAgent; depth: number }) {
  const [open, setOpen] = useState(false)
  const { label, Icon } = ROLE_META[agent.role] ?? ROLE_META.reader
  const hasLogs = agent.logs.length > 0
  return (
    <div style={{ marginLeft: depth * 18 }} className="ds-control rounded-[var(--ds-radius-control)]">
      <button
        type="button"
        onClick={() => hasLogs && setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-[var(--ds-radius-control)] px-3 py-2 text-left outline-none focus-visible:shadow-[var(--ds-shadow-focus)]"
      >
        <Icon className="h-4 w-4 shrink-0 text-slate-500" />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-400">{label}</span>
            <span className="truncate text-xs font-bold text-slate-800">{agent.label}</span>
          </span>
          {agent.detail && <span className="mt-0.5 block truncate text-[11px] text-slate-500">{agent.detail}</span>}
        </span>
        <StatusDot status={agent.status} />
        {hasLogs && (open ? <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-400" />)}
      </button>
      {open && hasLogs && (
        <ul className="space-y-0.5 px-4 pb-2.5 pl-10 text-[11px] leading-snug text-slate-500">
          {agent.logs.map((line, i) => <li key={i}>{line}</li>)}
        </ul>
      )}
    </div>
  )
}

function ActivityTab({ run }: { run: ResearchRun }) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (run.status === 'running') endRef.current?.scrollIntoView({ block: 'nearest' }) }, [run.agents.length, run.status])

  const ids = new Set(run.agents.map((a) => a.id))
  const roots = run.agents.filter((a) => !a.parent || !ids.has(a.parent))
  const children = (id: string) => run.agents.filter((a) => a.parent === id)
  const running = run.agents.filter((a) => a.status === 'running').length

  if (run.agents.length === 0) {
    return <p className="p-6 text-center text-xs text-slate-500">Nessuna attività registrata per questa ricerca.</p>
  }
  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        {[['Agent', run.agents.length], ['Attivi', running], ['Fonti', run.sources || '—']].map(([name, value]) => (
          <div key={name as string} className="ds-control rounded-[var(--ds-radius-control)] px-2 py-2">
            <div className="text-base font-extrabold text-slate-800">{value}</div>
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{name}</div>
          </div>
        ))}
      </div>
      {run.rounds.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {run.rounds.map((r) => (
            <span key={r.round} className="ds-control rounded-full px-2.5 py-1 text-[11px] font-semibold text-slate-600">
              Giro {r.round}{r.status === 'done' && r.novelty !== undefined ? ` · novità ${Math.round(r.novelty * 100)}%` : ' · in corso'}{r.saturated ? ' · esaurito' : ''}
            </span>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        {roots.map((agent) => (
          <div key={agent.id} className="space-y-1.5">
            <AgentRow agent={agent} depth={0} />
            {children(agent.id).map((child) => <AgentRow key={child.id} agent={child} depth={1} />)}
          </div>
        ))}
      </div>
      {run.status === 'error' && <p className="rounded-[var(--ds-radius-control)] bg-rose-50 px-3 py-2 text-xs text-rose-700">{run.error}</p>}
      <div ref={endRef} />
    </div>
  )
}

function DocumentTab({ doc, onChange }: { doc: GeneratedDoc; onChange: (content: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(doc.content)
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | null>(null)

  // A new version from the chat (e.g. an appended section) replaces the local draft.
  useEffect(() => { setDraft(doc.content) }, [doc.content, doc.version])
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])

  const edit = (value: string) => {
    setDraft(value)
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => onChange(value), 700)
  }
  const download = () => {
    const url = URL.createObjectURL(new Blob([draft], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${(doc.title || 'ricerca').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') || 'ricerca'}.md`
    a.click()
    URL.revokeObjectURL(url)
  }
  const pill = 'ds-control inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-bold text-slate-600 outline-none focus-visible:shadow-[var(--ds-shadow-focus)]'

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1.5 px-4 py-2">
        <button type="button" className={`${pill} ${editing ? '' : 'ds-selected'}`} onClick={() => setEditing(false)}><Eye className="h-3 w-3" />Anteprima</button>
        <button type="button" className={`${pill} ${editing ? 'ds-selected' : ''}`} onClick={() => setEditing(true)}><Pencil className="h-3 w-3" />Modifica</button>
        <span className="flex-1" />
        <button type="button" className={pill} onClick={() => { navigator.clipboard?.writeText(draft); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }}>
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{copied ? 'Copiato' : 'Copia'}
        </button>
        <button type="button" className={pill} onClick={download}><Download className="h-3 w-3" />.md</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {editing ? (
          <textarea
            value={draft}
            onChange={(e) => edit(e.target.value)}
            spellCheck={false}
            className="h-full min-h-[24rem] w-full resize-none rounded-[var(--ds-radius-control)] bg-transparent p-3 font-mono text-xs leading-relaxed text-slate-800 outline-none focus:shadow-[var(--ds-shadow-focus)]"
          />
        ) : (
          <article className="prose prose-sm prose-slate max-w-none prose-headings:font-bold prose-a:text-[var(--selection-text)]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
          </article>
        )}
      </div>
    </div>
  )
}

interface ResearchPanelProps {
  doc: GeneratedDoc | null
  run: ResearchRun
  onClose: () => void
  onStop: () => void
  onDocChange: (content: string) => void
}

/** Right-hand panel of the deep-research mode: live activity of every spawned sub-agent + the editable document. */
export default function ResearchPanel({ doc, run, onClose, onStop, onDocChange }: ResearchPanelProps) {
  const view = useMemo<ResearchRun>(() => {
    if (run.status !== 'idle') return run
    const agents = (doc?.run?.agents ?? []).map((a) => ({ ...a, logs: a.logs ?? [] }))
    return { status: 'done', agents, rounds: doc?.run?.rounds ?? [], sources: doc?.sources?.length ?? 0 }
  }, [run, doc])
  const running = view.status === 'running'
  const [tab, setTab] = useState<'activity' | 'document'>(running || !doc ? 'activity' : 'document')

  useEffect(() => { if (running) setTab('activity') }, [running])
  useEffect(() => { if (view.status === 'done' && doc) setTab('document') }, [view.status, doc?.version]) // eslint-disable-line react-hooks/exhaustive-deps

  const tabClass = (active: boolean) =>
    `inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-bold outline-none focus-visible:shadow-[var(--ds-shadow-focus)] ${active ? 'ds-selected' : 'ds-control text-slate-600'}`

  return (
    <div className="flex h-full flex-col bg-white/60">
      <div className="flex items-center gap-2 px-4 pb-1 pt-3">
        <Sparkles className="h-4 w-4 text-slate-500" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-extrabold text-slate-800">{doc?.title || 'Deep Research'}</h2>
          <p className="truncate text-[11px] text-slate-500">
            {running ? (view.statusText || 'Ricerca in corso…') : view.status === 'error' ? 'Ricerca interrotta' : doc ? `v${doc.version} · ${doc.sources?.length ?? 0} fonti` : 'In attesa'}
          </p>
        </div>
        {running && (
          <button type="button" onClick={onStop} className="ds-control inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-bold text-rose-600 outline-none focus-visible:shadow-[var(--ds-shadow-focus)]">
            <Square className="h-3 w-3" />Ferma
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Chiudi" className="ds-control flex h-8 w-8 items-center justify-center rounded-full text-slate-500 outline-none focus-visible:shadow-[var(--ds-shadow-focus)]">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex gap-2 px-4 py-2">
        <button type="button" className={tabClass(tab === 'activity')} onClick={() => setTab('activity')}>
          <Layers className="h-3.5 w-3.5" />Attività{view.agents.length ? ` (${view.agents.length})` : ''}
        </button>
        <button type="button" className={tabClass(tab === 'document')} onClick={() => setTab('document')} disabled={!doc}>
          <FileText className="h-3.5 w-3.5" />Documento
        </button>
        {doc?.sources?.length ? (
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold text-slate-400"><BookOpen className="h-3 w-3" />{doc.sources.length}</span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'activity' || !doc ? <ActivityTab run={view} /> : <DocumentTab doc={doc} onChange={onDocChange} />}
      </div>
    </div>
  )
}
