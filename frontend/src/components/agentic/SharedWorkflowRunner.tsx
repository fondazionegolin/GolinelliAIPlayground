import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Loader2, Play, RotateCcw, Send } from '@/components/icons'
import { markdownCodeComponents } from '@/components/CodeBlock'
import { Button } from '@/design'
import { tl } from '@/i18n/tl'
import type { SharedWorkflowApp, SharedWorkflowRun } from '@/lib/api'
import { ArtifactPreviews, extractArtifacts, hasArtifacts } from './NodeArtifacts'
import { OutputExplorerModal, formatCompact, isPlot, isTable, type ExplorerTarget, type TableValue } from './OutputExplorer'
import { buildChatLog } from './chatLog'

export interface SharedRunAdapter {
  start: () => Promise<SharedWorkflowRun>
  get: (runId: string) => Promise<SharedWorkflowRun>
  send: (runId: string, content: string) => Promise<SharedWorkflowRun>
}

const ACTIVE = new Set(['running', 'queued'])
const errorText = (error: unknown) =>
  (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || tl("Qualcosa è andato storto: riprova tra poco.")

/**
 * Runs a shared workflow as an app: chat flows become a conversation, the others show the result of their last nodes.
 * Visitors never see the graph, only what it produces.
 */
export default function SharedWorkflowRunner({ app, adapter, allowDrive = true }: { app: SharedWorkflowApp; adapter: SharedRunAdapter; allowDrive?: boolean }) {
  const [run, setRun] = useState<SharedWorkflowRun | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [explorer, setExplorer] = useState<ExplorerTarget | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter

  const chatLog = useMemo(() => buildChatLog(run, app.graph.nodes), [run, app.graph.nodes])
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' }) }, [chatLog.length, run?.status])

  // The server keeps running after each answer: poll until the flow waits for the visitor or ends.
  useEffect(() => {
    if (!run || !ACTIVE.has(run.status)) return
    const id = run.id
    const timer = window.setTimeout(async () => {
      try { setRun(await adapterRef.current.get(id)) }
      catch (e) { setError(errorText(e)) }
    }, 900)
    return () => window.clearTimeout(timer)
  }, [run])

  const start = useCallback(async () => {
    setBusy(true); setError(null); setRun(null)
    try { setRun(await adapterRef.current.start()) }
    catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }, [])

  const send = async (value?: string) => {
    const content = (value ?? draft).trim()
    if (!run || !content || busy) return
    setBusy(true); setError(null)
    try { setRun(await adapterRef.current.send(run.id, content)); setDraft('') }
    catch (e) { setError(errorText(e)) }
    finally { setBusy(false) }
  }

  const waiting = run?.status === 'waiting'
  const options = waiting && Array.isArray(run?.output?.options) ? (run!.output!.options as string[]) : []
  const working = busy || (run != null && ACTIVE.has(run.status))
  const finished = run != null && ['completed', 'failed', 'cancelled'].includes(run.status)
  const failure = run?.status === 'failed' ? (run.error || run.nodes.find((node) => node.error)?.error || tl("Il flusso si è interrotto.")) : null

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-3 p-4">
      {!run && (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
          <div className="space-y-1">
            <h2 className="text-xl font-black text-[var(--text-primary)]">{app.title}</h2>
            {app.author && <p className="text-xs text-[var(--text-secondary)]">{tl("di {0}", app.author)}</p>}
          </div>
          <Button onClick={start} disabled={busy} tone="accent" surface="solid" className="rounded-full">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} {app.chat ? tl("Inizia la conversazione") : tl("Avvia")}
          </Button>
        </div>
      )}

      {run && (
        <>
          {app.chat ? (
            <div ref={logRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto rounded-2xl bg-[var(--surface-muted)] p-3">
              {chatLog.map((entry, index) => (
                <div key={index} className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`${entry.artifacts ? 'w-[80%]' : 'max-w-[80%]'} rounded-2xl px-3 py-2 text-sm ${entry.role === 'user' ? 'bg-violet-600 text-white' : 'bg-[var(--surface-base)] text-[var(--text-primary)]'}`}>
                    {entry.artifacts && <div className="-m-2"><ArtifactPreviews artifacts={allowDrive ? entry.artifacts : { ...entry.artifacts, driveIds: [] }} nodeLabel={entry.label || tl("Risultato")} /></div>}
                    {entry.role === 'bot'
                      ? entry.text && <ReactMarkdown remarkPlugins={[remarkGfm]} className="chat-markdown prose prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1" components={markdownCodeComponents()}>{entry.text}</ReactMarkdown>
                      : entry.text}
                  </div>
                </div>
              ))}
              {working && <div className="flex"><div className="rounded-2xl bg-[var(--surface-base)] px-3 py-2"><Loader2 className="h-4 w-4 animate-spin text-[var(--text-secondary)]" /></div></div>}
            </div>
          ) : (
            <ResultCards app={app} run={run} working={working} allowDrive={allowDrive} onExplore={setExplorer} />
          )}

          {failure && <p className="rounded-xl bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">{failure}</p>}

          {waiting && options.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {options.map((option) => <Button key={option} onClick={() => send(option)} disabled={busy} surface="solid" tone="accent" density="compact" className="rounded-full">{option}</Button>)}
            </div>
          )}
          {waiting && options.length === 0 && (
            <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); send() }}>
              <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={4000} autoFocus disabled={busy}
                placeholder={tl("Scrivi la tua risposta")} className="ds-field h-11 min-w-0 flex-1 px-4 text-sm" />
              <Button type="submit" disabled={busy || !draft.trim()} tone="accent" surface="solid" className="rounded-full"><Send className="h-4 w-4" /> {tl("Invia")}</Button>
            </form>
          )}
          {finished && (
            <div className="flex justify-center">
              <Button onClick={start} disabled={busy} tone="neutral" surface="outline" density="compact" className="rounded-full"><RotateCcw className="h-4 w-4" /> {tl("Ricomincia")}</Button>
            </div>
          )}
        </>
      )}
      {error && <p className="text-center text-xs font-semibold text-rose-600">{error}</p>}
      {explorer && <OutputExplorerModal target={explorer} onClose={() => setExplorer(null)} onOpenTable={() => undefined} />}
    </div>
  )
}

/** Outputs of the nodes nothing else feeds from: what the flow was built to produce. */
function ResultCards({ app, run, working, allowDrive, onExplore }: { app: SharedWorkflowApp; run: SharedWorkflowRun; working: boolean; allowDrive: boolean; onExplore: (target: ExplorerTarget) => void }) {
  const sinks = app.graph.nodes.filter((node) => !app.graph.edges.some((edge) => edge.from === node.instanceId))
  const cards = sinks.map((node) => {
    const runs = run.nodes.filter((item) => item.node_instance_id === node.instanceId && item.status === 'completed' && item.output)
    return runs.length ? runs[runs.length - 1] : null
  }).filter((item): item is NonNullable<typeof item> => item !== null)
  return (
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
      {working && <div className="flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]"><Loader2 className="h-4 w-4 animate-spin" /> {tl("Sto elaborando…")}</div>}
      {!working && run.status === 'completed' && cards.length === 0 && <p className="text-sm text-[var(--text-secondary)]">{tl("Il flusso è terminato senza risultati da mostrare.")}</p>}
      {cards.map((item) => {
        const output = item.output || {}
        const artifacts = extractArtifacts(output)
        const shown = allowDrive ? artifacts : { ...artifacts, driveIds: [] }
        const entries = Object.entries(output)
        return (
          <section key={item.node_instance_id} className="space-y-2 rounded-2xl bg-[var(--surface-muted)] p-3">
            <p className="text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]">{item.label}</p>
            {hasArtifacts(shown) && <ArtifactPreviews artifacts={shown} nodeLabel={item.label} />}
            {entries.map(([port, value]) => {
              if (isTable(value)) return <ResultTable key={port} port={port} table={value} />
              if (isPlot(value)) return <Button key={port} onClick={() => onExplore({ kind: 'plot', title: value.title || item.label, plot: value })} tone="neutral" surface="outline" density="compact" className="rounded-full">{tl("Apri il grafico")}</Button>
              if (typeof value === 'string' && value.startsWith('data:image/')) return null
              if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return <p key={port} className="whitespace-pre-wrap text-sm text-[var(--text-primary)]">{String(value)}</p>
              if (value && typeof value === 'object' && port === 'metrics') return <dl key={port} className="grid grid-cols-2 gap-2 sm:grid-cols-3">{Object.entries(value as Record<string, unknown>).map(([key, metric]) => <div key={key} className="rounded-xl bg-[var(--surface-base)] px-3 py-2"><dt className="text-[10px] font-bold uppercase text-[var(--text-secondary)]">{key}</dt><dd className="text-sm font-black text-[var(--text-primary)]">{formatCompact(metric)}</dd></div>)}</dl>
              return null
            })}
          </section>
        )
      })}
    </div>
  )
}

function ResultTable({ port, table }: { port: string; table: TableValue }) {
  const columns = table.columns?.length ? table.columns : Object.keys(table.rows[0] || {})
  const rows = table.rows.slice(0, 100)
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-bold text-[var(--text-secondary)]">{port} · {tl("{0} righe", table.rowCount ?? table.rows.length)}</p>
      <div className="max-h-80 overflow-auto rounded-xl bg-[var(--surface-base)]">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[var(--surface-muted)]"><tr>{columns.map((column) => <th key={column} className="px-3 py-1.5 font-black text-[var(--text-primary)]">{column}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => <tr key={index} className="border-t border-[var(--border-subtle)]">{columns.map((column) => <td key={column} className="whitespace-nowrap px-3 py-1 text-[var(--text-primary)]">{formatCompact(row[column])}</td>)}</tr>)}</tbody>
        </table>
      </div>
    </div>
  )
}
