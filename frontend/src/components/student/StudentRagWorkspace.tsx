import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { confirmAttachments } from '@/components/privacy/AttachmentPrivacyGuard'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen, Upload, Trash2, FileText, Database, Search, Send, Loader2,
  CheckCircle2, Eye, ChevronDown, ChevronUp, ChevronLeft,
  Sparkles, PanelLeftClose, PanelLeftOpen, AlertCircle, Plus, Clock,
  Link2, ImageIcon, X, Highlighter,
} from '@/components/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { studentRagApi, type RagWorkspaceApi } from '@/lib/api'
import type { AccentTheme } from '@/design/themes/roleThemes'
import { type RagSession, saveRagSession, getRagSessions } from '@/lib/ragSessions'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RagDoc {
  id: string
  title: string
  doc_type: string
  status: string
  chunk_count: number
  created_at: string
}

interface RagHighlight {
  start: number
  end: number
  score: number
  kind: 'semantic' | 'keyword' | string
}

interface RagChunk {
  id: string
  chunk_index: number
  text: string
  page?: number
  document_id: string
  document_title: string
  score?: number
  terms?: string[]
  embedded?: boolean
  highlights?: RagHighlight[]
}

interface RagSessionStore {
  get: () => RagSession[]
  save: (s: RagSession) => void
}

interface RagMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sourceChunks?: RagChunk[]
}

type RagPhase = 'idle' | 'searching' | 'generating'

// ─── Theme helpers ────────────────────────────────────────────────────────────

function hex2rgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ─── Constants ────────────────────────────────────────────────────────────────

const UPLOAD_STEPS = [
  { key: 'reading', label: 'Lettura del documento…' },
  { key: 'chunking', label: 'Divisione in blocchi semantici…' },
  { key: 'embedding', label: 'Generazione vettori embedding…' },
  { key: 'indexing', label: 'Indicizzazione nella knowledge base…' },
  { key: 'done', label: 'Documento pronto!' },
]

const DOC_ICON: Record<string, React.ReactNode> = {
  pdf: <FileText className="h-4 w-4 text-red-400" />,
  docx: <FileText className="h-4 w-4 text-blue-400" />,
  doc: <FileText className="h-4 w-4 text-blue-400" />,
  csv: <Database className="h-4 w-4 text-emerald-400" />,
  xlsx: <Database className="h-4 w-4 text-emerald-400" />,
  xls: <Database className="h-4 w-4 text-emerald-400" />,
  txt: <FileText className="h-4 w-4 text-slate-400" />,
  png: <ImageIcon className="h-4 w-4 text-fuchsia-400" />,
  jpg: <ImageIcon className="h-4 w-4 text-fuchsia-400" />,
  jpeg: <ImageIcon className="h-4 w-4 text-fuchsia-400" />,
  webp: <ImageIcon className="h-4 w-4 text-fuchsia-400" />,
  gif: <ImageIcon className="h-4 w-4 text-fuchsia-400" />,
  youtube: <Link2 className="h-4 w-4 text-red-500" />,
  html: <FileText className="h-4 w-4 text-cyan-500" />,
  brochure: <FileText className="h-4 w-4 text-amber-500" />,
}

function docIcon(docType: string) {
  return DOC_ICON[docType] ?? <FileText className="h-4 w-4 text-slate-400" />
}

function normalizeChunk(c: Record<string, unknown>): RagChunk {
  // Text is already cleaned server-side; highlight offsets refer to this exact string.
  const highlights = Array.isArray(c.highlights)
    ? (c.highlights as RagHighlight[]).filter((h) => Number.isFinite(h?.start) && Number.isFinite(h?.end) && h.end > h.start)
    : undefined
  return {
    id: (c.id || c.chunk_id) as string,
    chunk_index: c.chunk_index as number,
    text: (c.text as string) || '',
    page: c.page as number | undefined,
    document_id: c.document_id as string,
    document_title: (c.document_title || '') as string,
    score: c.score as number | undefined,
    terms: Array.isArray(c.terms) ? c.terms.map(String) : undefined,
    embedded: typeof c.embedded === 'boolean' ? c.embedded : undefined,
    highlights,
  }
}

/** Render text with the semantically matching sentences marked like a highlighter pen. */
function HighlightedText({ text, highlights }: { text: string; highlights?: RagHighlight[] }) {
  if (!highlights || highlights.length === 0) return <>{text}</>
  const spans = [...highlights].sort((a, b) => a.start - b.start)
  const out: React.ReactNode[] = []
  let pos = 0
  spans.forEach((h, i) => {
    const start = Math.max(h.start, pos)
    if (start > pos) out.push(<span key={`t${i}`}>{text.slice(pos, start)}</span>)
    if (h.end > start) {
      out.push(
        <mark
          key={`h${i}`}
          data-rag-highlight
          title={`Corrispondenza ${h.kind === 'semantic' ? 'semantica' : 'testuale'} · ${Math.round(h.score * 100)}%`}
          className="rounded-[3px] px-0.5 text-slate-900"
          style={{
            background: 'linear-gradient(transparent 12%, rgba(250,204,21,0.62) 12%, rgba(250,204,21,0.62) 92%, transparent 92%)',
            boxDecorationBreak: 'clone',
            WebkitBoxDecorationBreak: 'clone',
          }}
        >
          {text.slice(start, h.end)}
        </mark>,
      )
    }
    pos = Math.max(pos, h.end)
  })
  if (pos < text.length) out.push(<span key="tail">{text.slice(pos)}</span>)
  return <>{out}</>
}

function parseCitations(text: string) {
  const segments: Array<{ type: 'text' | 'cite'; content: string; index?: number }> = []
  const parts = text.split(/(\[\[\d+\]\])/g)
  for (const part of parts) {
    const match = part.match(/^\[\[(\d+)\]\]$/)
    if (match) {
      segments.push({ type: 'cite', content: part, index: parseInt(match[1]) })
    } else if (part) {
      segments.push({ type: 'text', content: part })
    }
  }
  return segments
}

function getLatestSessionSourceChunks(messages: RagMessage[]): RagChunk[] | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const chunks = messages[i]?.sourceChunks
    if (chunks && chunks.length > 0) return chunks
  }
  return null
}

// ─── Explainer (popover content) ──────────────────────────────────────────────

function RagExplainer({ theme, teacher }: { theme: AccentTheme; teacher?: boolean }) {
  const steps = [
    { n: 1, title: 'Lettura completa', desc: 'Il documento viene segmentato in parti leggibili, mantenendo pagine e struttura.' },
    { n: 2, title: 'Ricerca intelligente', desc: 'La domanda viene confrontata sia per significato sia per parole esatte.' },
    { n: 3, title: 'Selezione delle prove', desc: 'I passaggi più utili compaiono nella colonna Fonti con le frasi pertinenti evidenziate.' },
    { n: 4, title: 'Risposta vincolata', desc: 'Il chatbot resta dentro i contenuti caricati e cita i riferimenti [[n]].' },
  ]
  return (
    <div className="space-y-2 text-[11px] text-slate-600">
      {steps.map(({ n, title, desc }) => (
        <div key={n} className="flex items-start gap-2">
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold"
            style={{ color: theme.text }}>{n}</div>
          <p><strong>{title}:</strong> {desc}</p>
        </div>
      ))}
      {teacher && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] leading-relaxed text-amber-900">
          <p><strong>RAG ≠ context learning.</strong> Con il <em>context learning</em> incolli i documenti nel prompt: il modello
            li legge tutti ma entrano solo se sono corti. Con il <em>RAG</em> i documenti vengono indicizzati e, a ogni richiesta,
            viene recuperato solo il frammento pertinente: scala a molti file, costa meno e permette citazioni verificabili.
            Per creare quiz, infografiche o documenti da materiali lunghi il RAG è lo strumento migliore:
            allega un notebook nella chat del docente.</p>
        </div>
      )}
    </div>
  )
}

// ─── Document list (left) ─────────────────────────────────────────────────────

function DocumentPanel({
  docs, selectedDocIds, onToggleDoc, onDelete, onPreview, previewDocId,
  isUploading, uploadStep, uploadResult, onDismissResult, noun, theme,
}: {
  docs: RagDoc[]
  selectedDocIds: string[]
  onToggleDoc: (id: string) => void
  onDelete: (id: string) => void
  onPreview: (id: string) => void
  previewDocId: string | null
  isUploading: boolean
  uploadStep: number
  uploadResult: { chunk_count: number; key_concepts: string[]; summary: string } | null
  onDismissResult: () => void
  noun: string
  theme: AccentTheme
}) {
  const [showDetails, setShowDetails] = useState(false)
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <BookOpen className="h-4 w-4" style={{ color: theme.text }} />
        <span className="text-sm font-semibold text-slate-800">Documenti</span>
        {docs.length > 0 && (
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold" style={{ color: theme.text }}>
            {docs.length}
          </span>
        )}
        {docs.length > 1 && (
          <button
            type="button"
            onClick={() => {
              const allSelected = docs.every((d) => selectedDocIds.includes(d.id))
              docs.forEach((d) => { if (allSelected === selectedDocIds.includes(d.id)) onToggleDoc(d.id) })
            }}
            className="ml-auto text-[10px] font-semibold text-slate-400 hover:text-slate-700"
          >
            {docs.every((d) => selectedDocIds.includes(d.id)) ? 'Deseleziona' : 'Seleziona tutti'}
          </button>
        )}
      </div>

      {isUploading && (
        <div className="rounded-lg border bg-white px-2.5 py-2" style={{ borderColor: hex2rgba(theme.accent, 0.25) }}>
          <div className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" style={{ color: theme.text }} />
            <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">
              {UPLOAD_STEPS[Math.min(uploadStep, UPLOAD_STEPS.length - 1)].label}
            </p>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-slate-500 transition-all duration-500"
              style={{ width: `${(uploadStep / (UPLOAD_STEPS.length - 1)) * 100}%` }} />
          </div>
        </div>
      )}

      {uploadResult && !isUploading && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-semibold">
              Pronto · {uploadResult.chunk_count} passaggi indicizzati
            </span>
            {(uploadResult.summary || uploadResult.key_concepts.length > 0) && (
              <button type="button" onClick={() => setShowDetails((v) => !v)} className="text-emerald-600 hover:text-emerald-800">
                {showDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            )}
            <button type="button" onClick={onDismissResult} className="text-emerald-500 hover:text-emerald-800" aria-label="Chiudi">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {showDetails && (
            <div className="mt-1.5 max-h-28 space-y-1.5 overflow-y-auto text-[11px] text-slate-600">
              {uploadResult.key_concepts.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {uploadResult.key_concepts.slice(0, 8).map((c) => (
                    <span key={c} className="rounded-full bg-white px-2 py-0.5 text-[10px]" style={{ color: theme.text }}>{c}</span>
                  ))}
                </div>
              )}
              {uploadResult.summary && <p className="italic">{uploadResult.summary}</p>}
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
        {docs.length === 0 && !isUploading && (
          <div className="flex h-full flex-col items-center justify-center py-8 text-center text-xs text-slate-400">
            <BookOpen className="mb-2 h-8 w-8 opacity-30" />
            <p className="font-medium">Nessun documento</p>
            <p className="mt-1 text-[11px]">Usa <strong>Aggiungi file</strong> o trascina qui PDF, Word, fogli dati, immagini</p>
          </div>
        )}
        {docs.map((doc) => {
          const isSelected = selectedDocIds.includes(doc.id)
          const ready = doc.status === 'ready' || doc.status === 'READY'
          const processing = doc.status === 'processing' || doc.status === 'PROCESSING' || doc.status === 'queued' || doc.status === 'QUEUED'
          return (
            <div key={doc.id} onClick={() => onToggleDoc(doc.id)}
              className="cursor-pointer rounded-lg border px-2 py-1.5 transition-all"
              style={{
                borderColor: isSelected ? hex2rgba(theme.accent, 0.4) : 'rgba(203,213,225,0.6)',
                backgroundColor: isSelected ? '#fafafa' : 'white',
              }}>
              <div className="flex items-center gap-2">
                <div className="flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-all"
                  style={isSelected
                    ? { borderColor: 'var(--selection-border)', backgroundImage: 'var(--selection-bg)', color: 'var(--selection-text)' }
                    : { borderColor: '#d4d4d4' }}>
                  {isSelected && <CheckCircle2 className="h-3 w-3" />}
                </div>
                {docIcon(doc.doc_type)}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-700" title={doc.title}>{doc.title}</p>
                  <p className="flex items-center gap-1.5 text-[10px] text-slate-400">
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${ready ? 'bg-emerald-500' : processing ? 'bg-amber-500' : 'bg-red-500'}`} />
                    {ready ? (doc.chunk_count > 0 ? `${doc.chunk_count} blocchi` : 'Pronto') : processing ? 'Elaborazione…' : 'Errore'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  {ready && (
                    <button onClick={(e) => { e.stopPropagation(); onPreview(doc.id) }}
                      title="Anteprima documento"
                      className="rounded-lg p-1 transition-colors hover:bg-slate-100"
                      style={previewDocId === doc.id ? { color: theme.text } : { color: '#a3a3a3' }}>
                      <Eye className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); onDelete(doc.id) }}
                    title={`Rimuovi dal ${noun}`}
                    className="rounded-lg p-1 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Document preview modal ───────────────────────────────────────────────────

function DocumentPreviewModal({
  doc, chunks, loading, highlightsByChunk, focusChunkId, onClose, theme,
}: {
  doc: RagDoc
  chunks: RagChunk[]
  loading: boolean
  highlightsByChunk: Map<string, RagHighlight[]>
  focusChunkId: string | null
  onClose: () => void
  theme: AccentTheme
}) {
  const focusRef = useRef<HTMLDivElement>(null)
  const firstMarkRef = useRef<HTMLDivElement>(null)
  const totalHighlights = chunks.reduce((n, c) => n + (highlightsByChunk.get(c.id)?.length || 0), 0)

  useEffect(() => {
    const el = focusRef.current ?? firstMarkRef.current
    if (el) el.scrollIntoView({ block: 'center' })
  }, [chunks, focusChunkId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  let markAssigned = false
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/45 p-3 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Anteprima ${doc.title}`}>
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-4 py-3">
          {docIcon(doc.doc_type)}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-slate-800">{doc.title}</p>
            <p className="text-[11px] text-slate-400">
              {chunks.length} blocchi
              {totalHighlights > 0 && <> · <span className="inline-flex items-center gap-1"><Highlighter className="h-3 w-3" />{totalHighlights} passaggi evidenziati dall’ultima ricerca</span></>}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Chiudi">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400" style={{ color: theme.text }}>
              <Loader2 className="h-4 w-4 animate-spin" /> Caricamento…
            </div>
          )}
          {!loading && chunks.length === 0 && <p className="py-12 text-center text-sm text-slate-400">Nessun contenuto da mostrare.</p>}
          {chunks.map((c, i) => {
            const hl = highlightsByChunk.get(c.id)
            const isFocus = focusChunkId === c.id
            const attachMark = !markAssigned && !focusChunkId && !!hl?.length
            if (attachMark) markAssigned = true
            const prevPage = i > 0 ? chunks[i - 1].page : undefined
            return (
              <div key={c.id}>
                {c.page && c.page !== prevPage && (
                  <p className="mb-1 mt-2 border-b border-slate-100 pb-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">Pagina {c.page}</p>
                )}
                <div ref={isFocus ? focusRef : attachMark ? firstMarkRef : undefined}
                  className={`whitespace-pre-wrap rounded-lg px-2 py-1 text-[13px] leading-relaxed text-slate-700 ${isFocus ? 'ring-2 ring-amber-300' : ''}`}>
                  <HighlightedText text={c.text} highlights={hl} />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Cited Content ────────────────────────────────────────────────────────────

function CitedContent({
  content, sourceChunks, onCitationClick, activeCitationIndex,
}: {
  content: string
  sourceChunks: RagChunk[]
  onCitationClick: (chunk: RagChunk, index: number, chunks: RagChunk[]) => void
  activeCitationIndex: number | null
}) {
  const segments = parseCitations(content)
  return (
    <div className="chat-markdown prose max-w-none prose-slate text-[16px] leading-7">
      {segments.map((seg, i) => {
        if (seg.type === 'cite') {
          const idx = seg.index! - 1
          const chunk = sourceChunks[idx]
          const isActive = activeCitationIndex === idx
          return (
            <button key={i} onClick={() => chunk && onCitationClick(chunk, idx, sourceChunks)}
              className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded px-1.5 text-[11px] font-bold transition-all"
              style={isActive
	                ? { backgroundColor: 'var(--text-primary)', color: 'var(--surface-base)' }
	                : chunk
	                  ? { backgroundColor: 'var(--surface-muted)', color: 'var(--selection-text)' }
                  : { backgroundColor: 'var(--surface-muted)', color: 'var(--text-muted)' }}
              title={chunk ? `Fonte: ${chunk.document_title}${chunk.page ? ` — p.${chunk.page}` : ''}` : 'Fonte non disponibile'}>
              {seg.index}
            </button>
          )
        }
        return (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <span>{children}</span>,
            }}
          >
            {seg.content}
          </ReactMarkdown>
        )
      })}
    </div>
  )
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────

function ChatPanel({
  messages, ragPhase, onSend,
  selectedDocIds, onCitationClick, activeCitationIndex, error, theme, noun,
}: {
  noun: string
  messages: RagMessage[]
  ragPhase: RagPhase
  onSend: (msg: string) => void
  selectedDocIds: string[]
  onCitationClick: (chunk: RagChunk, index: number, chunks: RagChunk[]) => void
  activeCitationIndex: number | null
  error: string | null
  theme: AccentTheme
}) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, ragPhase])

  const handleSend = () => {
    if (!input.trim() || ragPhase !== 'idle') return
    onSend(input.trim())
    setInput('')
  }

  const isLoading = ragPhase !== 'idle'

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 pr-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-slate-400 py-12">
            <Search className="h-10 w-10 mb-3 opacity-30" />
            <p className="text-sm font-medium text-slate-600">Fai domande precise sui tuoi documenti</p>
            <p className="text-xs mt-1 max-w-sm">
              Il sistema cerca passaggi pertinenti, li mostra nella colonna Fonti e risponde con citazioni [[1]], [[2]].
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
	              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-500 to-blue-600 shadow-sm">
	                <BookOpen className="h-3.5 w-3.5 text-white" />
	              </div>
            )}
	            <div className={`max-w-[92%] md:max-w-[80%] rounded-xl px-4 py-3 text-[16px] leading-7 shadow-sm ${
                msg.role === 'user'
                  ? 'rounded-br-md border border-[color:var(--selection-border)] bg-[image:var(--selection-bg)] text-[var(--selection-text)]'
                  : 'rounded-bl-md border border-[color:var(--border-subtle)] bg-[var(--surface-base)] text-[var(--text-primary)]'
              }`}>
              {msg.role === 'assistant' ? (
                <CitedContent content={msg.content} sourceChunks={msg.sourceChunks || []}
                  onCitationClick={onCitationClick} activeCitationIndex={activeCitationIndex} />
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {/* Loading phases */}
        {ragPhase === 'searching' && (
          <div className="flex gap-3">
	            <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 bg-slate-100">
              <Search className="h-3.5 w-3.5 animate-pulse" style={{ color: theme.text }} />
            </div>
	            <div className="rounded-xl rounded-bl-md border border-[color:var(--border-subtle)] bg-[var(--surface-base)] px-4 py-3 shadow-sm">
              <p className="text-sm font-medium text-[var(--text-primary)]">Ricerca nelle fonti…</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">Sto combinando significato e corrispondenze testuali.</p>
              <div className="flex gap-1 mt-1.5">
                {[0, 150, 300].map((d) => (
	                  <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce"
	                    style={{ backgroundColor: '#737373', animationDelay: `${d}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        {ragPhase === 'generating' && (
          <div className="flex gap-3">
	            <div className="h-7 w-7 rounded-lg flex items-center justify-center shrink-0 bg-slate-100">
	              <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: theme.text }} />
	            </div>
	            <div className="rounded-xl rounded-bl-md border border-[color:var(--border-subtle)] bg-[var(--surface-base)] px-4 py-3 shadow-sm">
              <p className="text-sm font-medium text-[var(--text-primary)]">Generazione risposta…</p>
              <p className="mt-1 text-xs text-[var(--text-muted)]">La risposta viene costruita solo a partire dai passaggi trovati.</p>
              <div className="flex gap-1 mt-1.5">
                {[0, 150, 300].map((d) => (
	                  <span key={d} className="w-2 h-2 rounded-full animate-bounce"
	                    style={{ backgroundColor: '#737373', animationDelay: `${d}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}

        {error && (
	          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 pt-3 border-t border-slate-200 mt-3">
	        <div className={`flex gap-2 items-end rounded-[24px] border bg-white p-1.5 shadow-sm transition-all focus-within:border-slate-300 focus-within:ring-2 focus-within:ring-slate-200 ${isLoading ? 'opacity-70' : ''}`}
          style={{ borderColor: isLoading ? '#e5e5e5' : '#d4d4d4' }}
          onFocus={(e) => { if (!isLoading) (e.currentTarget as HTMLDivElement).style.borderColor = theme.accent }}
          onBlur={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#d4d4d4' }}>
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder={isLoading ? 'Elaborazione in corso…' :
              selectedDocIds.length > 0 ? 'Domanda sui documenti selezionati…' : `Domanda sul ${noun}…`}
            rows={2} disabled={isLoading}
            className="flex-1 resize-none bg-transparent px-2 py-2 text-[16px] leading-7 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] disabled:cursor-not-allowed" />
          <button onClick={handleSend} disabled={!input.trim() || isLoading}
	            className="h-9 w-9 rounded-full flex items-center justify-center border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] text-[var(--text-primary)] transition hover:border-[color:var(--button-chrome-border-hover)] disabled:bg-none disabled:bg-slate-100 disabled:text-slate-300 shrink-0">
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[10px] text-slate-400">
          Risposte ancorate ai documenti caricati · Citazioni [[n]] cliccabili
        </p>
      </div>
    </div>
  )
}

// ─── Source Panel ─────────────────────────────────────────────────────────────

function SourcePanel({
  activeDoc, chunks, isLoadingChunks, highlightedChunk, sourceChunks, pendingChunks, ragPhase, theme, onOpenInDocument,
}: {
  onOpenInDocument: (chunk: RagChunk) => void
  activeDoc: RagDoc | null
  chunks: RagChunk[]
  isLoadingChunks: boolean
  highlightedChunk: RagChunk | null
  sourceChunks: RagChunk[] | null
  pendingChunks: RagChunk[] | null
  ragPhase: RagPhase
  theme: AccentTheme
}) {
  const highlightRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (highlightedChunk && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightedChunk])

  const displayChunks = pendingChunks ?? sourceChunks ?? chunks
  const label = pendingChunks ? `Fonti trovate (${pendingChunks.length})`
    : sourceChunks ? `Fonti citate (${sourceChunks.length})`
    : activeDoc ? activeDoc.title
    : 'Fonti'

  const labelBadge = pendingChunks ? { text: 'anteprima', amber: true }
    : sourceChunks ? { text: 'ultima risposta', amber: false }
    : null

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 pb-3 border-b border-slate-200 mb-3 shrink-0">
        <Eye className="h-4 w-4 shrink-0" style={{ color: theme.text }} />
        <span className="text-sm font-semibold text-slate-800 truncate">{label}</span>
        {labelBadge && (
          <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0"
            style={labelBadge.amber
              ? { backgroundColor: 'rgb(var(--c-amber-100))', color: 'rgb(var(--t-amber-800))' }
	              : { backgroundColor: 'rgb(var(--c-neutral-100))', color: theme.text }}>
            {labelBadge.text}
          </span>
        )}
      </div>

      {(isLoadingChunks || ragPhase === 'searching') && (
        <div className="flex flex-col items-center justify-center py-8 gap-2" style={{ color: theme.text }}>
          <Search className="h-5 w-5 animate-pulse" />
          <p className="text-[11px]">Ricerca in corso…</p>
        </div>
      )}

      {!isLoadingChunks && ragPhase !== 'searching' && displayChunks.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-slate-400 text-xs text-center py-8">
          <Eye className="h-8 w-8 mb-2 opacity-30" />
          <p>Le fonti appariranno qui</p>
          <p className="mt-1 text-[11px]">Apri un documento o invia una domanda per vedere i passaggi usati</p>
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
        {displayChunks.map((chunk, i) => {
          const isHighlighted = highlightedChunk?.id === chunk.id
          const scorePct = chunk.score !== undefined ? Math.round(Math.min(1, Math.max(0, chunk.score)) * 100) : null
          return (
            <div key={chunk.id} ref={isHighlighted ? highlightRef : undefined}
              className="rounded-xl border p-3 transition-all duration-300"
              style={isHighlighted
                ? {
                    borderColor: hex2rgba(theme.accent, 0.5),
	                    backgroundColor: 'rgb(var(--c-neutral-50))',
                    boxShadow: `0 0 0 2px ${hex2rgba(theme.accent, 0.2)}`,
                  }
                : { borderColor: '#e5e5e5', backgroundColor: 'white' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold rounded-full px-2 py-0.5"
	                  style={{ backgroundColor: 'rgb(var(--c-neutral-100))', color: theme.text }}>
                  {sourceChunks || pendingChunks ? `[[${i + 1}]]` : `#${(chunk.chunk_index ?? i) + 1}`}
                </span>
                {chunk.document_title && (
                  <span className="text-[10px] text-slate-500 truncate flex-1">{chunk.document_title}</span>
                )}
                {chunk.page && <span className="text-[10px] text-slate-400 shrink-0">p.{chunk.page}</span>}
                {scorePct !== null && (
                  <div className="ml-auto shrink-0 flex items-center gap-1.5">
                    <div className="h-1.5 w-14 rounded-full bg-slate-200 overflow-hidden">
	                      <div className="h-full rounded-full bg-slate-500" style={{ width: `${scorePct}%` }} />
                    </div>
                    <span className="text-[10px] text-slate-400">{scorePct}%</span>
                  </div>
                )}
              </div>
              <p className={`whitespace-pre-wrap text-[12px] leading-relaxed ${isHighlighted ? 'text-slate-800' : 'text-slate-600'}`}>
                <HighlightedText text={chunk.text} highlights={chunk.highlights} />
              </p>
              <div className="mt-2 flex items-center gap-2">
                {chunk.highlights && chunk.highlights.length > 0 && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-700">
                    <Highlighter className="h-3 w-3" />{chunk.highlights.length} {chunk.highlights.length === 1 ? 'passaggio pertinente' : 'passaggi pertinenti'}
                  </span>
                )}
                <button type="button" onClick={() => onOpenInDocument(chunk)}
                  className="ml-auto text-[10px] font-semibold text-slate-400 hover:text-slate-700">
                  Apri nel documento
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const ACCEPT = '.pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.md,.png,.jpg,.jpeg,.webp,.gif'

export default function StudentRagWorkspace({
  theme, session, onSessionUpdate, onNewSession, onSwitchSession, onDeleteSession,
  api = studentRagApi, store, variant = 'student', onBack, backLabel = 'Spazio AI',
}: {
  theme: AccentTheme
  session: RagSession
  onSessionUpdate: (s: RagSession) => void
  onNewSession: () => void
  onSwitchSession: (id: string) => void
  onDeleteSession: (id: string) => void
  api?: RagWorkspaceApi
  store?: RagSessionStore
  variant?: 'student' | 'teacher'
  onBack?: () => void
  backLabel?: string
}) {
  const queryClient = useQueryClient()
  const sessionStore: RagSessionStore = store ?? { get: getRagSessions, save: saveRagSession }
  const isTeacher = variant === 'teacher'
  const noun = isTeacher ? 'notebook' : 'knowledge base'
  const qk = isTeacher ? 'teacher-rag' : 'student-rag'

  const [docsCollapsed, setDocsCollapsed] = useState(false)
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(session.selectedDocIds)
  const [messages, setMessages] = useState<RagMessage[]>(session.messages)
  const [isUploading, setIsUploading] = useState(false)
  const [isAddingSource, setIsAddingSource] = useState(false)
  const [uploadStep, setUploadStep] = useState(0)
  const [uploadResult, setUploadResult] = useState<{ chunk_count: number; key_concepts: string[]; summary: string } | null>(null)
  const [previewDocId, setPreviewDocId] = useState<string | null>(null)
  const [previewFocusChunkId, setPreviewFocusChunkId] = useState<string | null>(null)
  const [highlightedChunk, setHighlightedChunk] = useState<RagChunk | null>(null)
  const [activeCitationIndex, setActiveCitationIndex] = useState<number | null>(null)
  const [sourceChunks, setSourceChunks] = useState<RagChunk[] | null>(getLatestSessionSourceChunks(session.messages))
  const [pendingChunks, setPendingChunks] = useState<RagChunk[] | null>(null)
  const [ragPhase, setRagPhase] = useState<RagPhase>('idle')
  const [chatError, setChatError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [youtubeOpen, setYoutubeOpen] = useState(false)
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [infoOpen, setInfoOpen] = useState(false)
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const sessionMenuRef = useRef<HTMLDivElement>(null)
  const youtubeRef = useRef<HTMLDivElement>(null)
  const infoRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setSelectedDocIds(session.selectedDocIds)
    setMessages(session.messages)
    setSourceChunks(getLatestSessionSourceChunks(session.messages))
    setPendingChunks(null)
    setHighlightedChunk(null)
    setActiveCitationIndex(null)
    setPreviewDocId(null)
    setChatError(null)
  }, [session])

  useEffect(() => {
    function handler(e: MouseEvent) {
      const t = e.target as Node
      if (sessionMenuRef.current && !sessionMenuRef.current.contains(t)) setSessionMenuOpen(false)
      if (youtubeRef.current && !youtubeRef.current.contains(t)) setYoutubeOpen(false)
      if (infoRef.current && !infoRef.current.contains(t)) setInfoOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const persistSession = useCallback((msgs: RagMessage[], docIds: string[]) => {
    const name = msgs.find((m) => m.role === 'user')?.content.slice(0, 50) || session.name
    const updated: RagSession = {
      ...session,
      name,
      messages: msgs,
      selectedDocIds: docIds,
      searchMode: 'hybrid',
      updatedAt: new Date().toISOString(),
    }
    sessionStore.save(updated)
    onSessionUpdate(updated)
  }, [session, onSessionUpdate, sessionStore])

  const docsKey = [`${qk}-docs`, session.id]
  const { data: docs = [] } = useQuery<RagDoc[]>({
    queryKey: docsKey,
    queryFn: async () => (await api.listDocuments(session.id)).data || [],
  })

  const { data: previewChunks = [], isFetching: previewLoading } = useQuery<RagChunk[]>({
    queryKey: [`${qk}-chunks`, previewDocId],
    queryFn: async () => ((await api.getChunks(previewDocId!)).data || []).map(normalizeChunk),
    enabled: !!previewDocId,
  })

  // Highlights produced by the latest semantic search, keyed by chunk id (reused in the preview modal).
  const highlightsByChunk = useMemo(() => {
    const map = new Map<string, RagHighlight[]>()
    for (const list of [pendingChunks, sourceChunks]) {
      list?.forEach((c) => { if (c.highlights?.length && !map.has(c.id)) map.set(c.id, c.highlights) })
    }
    return map
  }, [pendingChunks, sourceChunks])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await api.deleteDocument(id)
      queryClient.invalidateQueries({ queryKey: docsKey })
      setSelectedDocIds((prev) => {
        const next = prev.filter((d) => d !== id)
        persistSession(messages, next)
        return next
      })
      if (previewDocId === id) setPreviewDocId(null)
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, messages, persistSession, queryClient, session.id, previewDocId])

  const errorDetail = (err: unknown, fallback: string) =>
    (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback

  const handleUpload = useCallback(async (files: File[]) => {
    if (!files.length) return
    setIsUploading(true)
    setUploadStep(0)
    setUploadResult(null)
    setChatError(null)
    const timers = [400, 900, 1500, 2200].map((delay, i) => setTimeout(() => setUploadStep(i + 1), delay))
    const errors: string[] = []
    try {
      for (const file of files) {
        try {
          const res = await api.uploadDocument(file, session.id)
          setUploadResult({
            chunk_count: res.data.chunk_count,
            key_concepts: res.data.key_concepts || [],
            summary: res.data.summary || '',
          })
        } catch (err) {
          errors.push(`${file.name}: ${errorDetail(err, 'caricamento non riuscito')}`)
        }
      }
      setUploadStep(4)
      queryClient.invalidateQueries({ queryKey: docsKey })
      if (errors.length) setChatError(errors.join(' · '))
    } finally {
      timers.forEach(clearTimeout)
      setIsUploading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, queryClient, session.id])

  // Privacy alert + anonymized copy before a document enters the RAG.
  const askThenUpload = useCallback((files: File[]) => {
    void confirmAttachments(files).then((kept) => { if (kept.length) void handleUpload(kept) })
  }, [handleUpload])

  const handleYoutube = useCallback(async (url: string) => {
    setIsAddingSource(true)
    setUploadResult(null)
    setChatError(null)
    try {
      const res = await api.ingestYoutube(url, session.id)
      setUploadResult({
        chunk_count: res.data.chunk_count,
        key_concepts: res.data.key_concepts || [],
        summary: res.data.summary || '',
      })
      queryClient.invalidateQueries({ queryKey: docsKey })
    } catch (err: unknown) {
      setChatError(errorDetail(err, 'Impossibile trascrivere e indicizzare il video YouTube.'))
    } finally {
      setIsAddingSource(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, queryClient, session.id])

  const toggleDocSelection = useCallback((id: string) => {
    setSelectedDocIds((prev) => {
      const next = prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
      persistSession(messages, next)
      return next
    })
  }, [messages, persistSession])

  const handleSend = useCallback(async (message: string) => {
    const userMsg: RagMessage = { id: `user-${Date.now()}`, role: 'user', content: message }
    setMessages((prev) => [...prev, userMsg])
    setHighlightedChunk(null)
    setActiveCitationIndex(null)
    setChatError(null)

    const docFilter = selectedDocIds.length > 0 ? selectedDocIds : undefined
    const history = messages.map((m) => ({ role: m.role, content: m.content }))

    setRagPhase('searching')
    try {
      const searchRes = await api.search(message, docFilter, 10, session.id)
      setPendingChunks((searchRes.data || []).map((c: Record<string, unknown>) => normalizeChunk(c)))
    } catch { /* non-fatal */ }

    setRagPhase('generating')
    try {
      const chatRes = await api.chat(message, history, docFilter, 10, session.id)
      const data = chatRes.data as { response: string; source_chunks: unknown[] }
      const responseChunks = (data.source_chunks || []).map((c) => normalizeChunk(c as Record<string, unknown>))
      const newAssistant: RagMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: data.response,
        sourceChunks: responseChunks,
      }
      setMessages((prev) => {
        const next = [...prev, newAssistant]
        persistSession(next, selectedDocIds)
        return next
      })
      setSourceChunks(responseChunks)
      setPendingChunks(null)
    } catch (err: unknown) {
      setChatError(errorDetail(err, err instanceof Error ? err.message : 'Errore nella risposta. Riprova.'))
      setPendingChunks(null)
    } finally {
      setRagPhase('idle')
    }
  }, [api, messages, selectedDocIds, persistSession, session.id])

  const handleCitationClick = useCallback((chunk: RagChunk, index: number, citationChunks: RagChunk[]) => {
    setSourceChunks(citationChunks)
    setHighlightedChunk(chunk)
    setActiveCitationIndex(index)
    setPendingChunks(null)
  }, [])

  const openPreview = (docId: string, focusChunkId: string | null = null) => {
    setPreviewDocId(docId)
    setPreviewFocusChunkId(focusChunkId)
  }

  const previewDoc = docs.find((d) => d.id === previewDocId) ?? null
  const allSessions = sessionStore.get()

  const toolbarBtn =
    'inline-flex h-9 items-center gap-1.5 rounded-xl border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] px-3 text-xs font-semibold text-[var(--text-primary)] shadow-sm transition-colors hover:border-[color:var(--button-chrome-border-hover)] disabled:opacity-50'

  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-slate-100 md:bg-transparent"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true) } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false) }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setDragOver(false)
        if (!isUploading) askThenUpload(Array.from(e.dataTransfer.files))
      }}
    >
      <input ref={fileRef} type="file" className="hidden" multiple accept={ACCEPT}
        onChange={(e) => {
          if (e.target.files) askThenUpload(Array.from(e.target.files))
          e.target.value = ''
        }} />

      {/* Single toolbar: navigation · session · sources · help */}
      <div className="relative z-20 flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-white/95 px-3 py-2 shadow-sm">
        {onBack && (
          <button type="button" onClick={onBack} className="inline-flex h-9 items-center gap-1 rounded-xl px-2 text-xs font-bold text-slate-700 hover:bg-slate-100" title={`Torna a ${backLabel}`}>
            <ChevronLeft className="h-4 w-4" />
            <span className="hidden sm:inline">{backLabel}</span>
          </button>
        )}

        {/* Session selector */}
        <div className="relative min-w-0 flex-1 sm:max-w-xs" ref={sessionMenuRef}>
          <button
            onClick={() => setSessionMenuOpen((o) => !o)}
            className="flex h-9 w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left transition-all hover:border-slate-300"
            title="Cronologia e fonti della sessione"
          >
            <Database className="h-3.5 w-3.5 shrink-0" style={{ color: theme.text }} />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">{session.name}</span>
            <ChevronDown className={`h-3 w-3 shrink-0 text-slate-400 transition-transform ${sessionMenuOpen ? 'rotate-180' : ''}`} />
          </button>
          {sessionMenuOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
              <div className="border-b border-slate-100 p-2">
                <button
                  onClick={() => { setSessionMenuOpen(false); onNewSession() }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-slate-50"
                >
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                    <Plus className="h-3.5 w-3.5" style={{ color: theme.text }} />
                  </div>
                  <span className="text-xs font-semibold" style={{ color: theme.text }}>Nuova sessione</span>
                </button>
              </div>
              <div className="max-h-56 space-y-0.5 overflow-y-auto p-2">
                {allSessions.length === 0 && (
                  <p className="py-3 text-center text-[11px] text-slate-400">Nessuna sessione salvata</p>
                )}
                {allSessions.map((s) => {
                  const isCurrent = s.id === session.id
                  const lastMsg = s.messages.filter((m) => m.role === 'user').pop()
                  return (
                    <div key={s.id}
                      className="flex w-full items-start gap-2 rounded-xl px-3 py-2 text-left transition-colors hover:bg-slate-50"
                      style={isCurrent ? { backgroundColor: 'rgb(var(--c-neutral-50))' } : {}}>
                      <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                      <button onClick={() => { setSessionMenuOpen(false); onSwitchSession(s.id) }} className="min-w-0 flex-1 text-left">
                        <div className="flex items-center gap-1">
                          <span className="truncate text-xs font-semibold text-slate-700">{s.name}</span>
                          {isCurrent && (
                            <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                              style={{ backgroundColor: 'rgb(var(--c-neutral-100))', color: theme.text }}>attiva</span>
                          )}
                        </div>
                        {lastMsg && <p className="truncate text-[10px] text-slate-400">{lastMsg.content.slice(0, 50)}</p>}
                        <p className="text-[10px] text-slate-300">{new Date(s.updatedAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                      </button>
                      <button
                        onClick={() => { onDeleteSession(s.id); setSessionMenuOpen(false) }}
                        className="shrink-0 rounded-lg p-1.5 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
                        title="Rimuovi sessione"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        <button onClick={onNewSession} title="Nuova sessione" className={toolbarBtn}>
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden md:inline">Nuova</span>
        </button>

        <span className="mx-1 hidden h-6 w-px bg-slate-200 sm:block" />

        {/* Sources */}
        <button onClick={() => fileRef.current?.click()} disabled={isUploading} className={toolbarBtn}
          title="PDF, Word, TXT, CSV, Excel, immagini — puoi anche trascinarli nella finestra">
          {isUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          <span className="hidden md:inline">Aggiungi file</span>
        </button>

        <div className="relative" ref={youtubeRef}>
          <button onClick={() => setYoutubeOpen((o) => !o)} disabled={isAddingSource} className={toolbarBtn} title="Aggiungi trascrizione YouTube">
            {isAddingSource ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            <span className="hidden md:inline">YouTube</span>
          </button>
          {youtubeOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-2.5 shadow-xl">
              <p className="mb-1.5 text-[11px] font-bold text-slate-700">Trascrizione YouTube nel {noun}</p>
              <form className="flex gap-2" onSubmit={(e) => {
                e.preventDefault()
                if (!youtubeUrl.trim()) return
                void handleYoutube(youtubeUrl.trim())
                setYoutubeUrl('')
                setYoutubeOpen(false)
              }}>
                <input autoFocus value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtu.be/…"
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs outline-none placeholder:text-slate-400 focus:border-slate-300" />
                <button type="submit" disabled={!youtubeUrl.trim()}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[color:var(--button-chrome-border)] bg-[image:var(--button-chrome-bg)] disabled:bg-none disabled:bg-slate-100 disabled:text-slate-300"
                  title="Trascrivi e indicizza">
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </form>
            </div>
          )}
        </div>

        <div className="relative ml-auto flex items-center gap-1" ref={infoRef}>
          <button onClick={() => setInfoOpen((o) => !o)} className={toolbarBtn} title="Come usa le fonti?">
            <Sparkles className="h-3.5 w-3.5" style={{ color: theme.text }} />
            <span className="hidden lg:inline">Come funziona</span>
          </button>
          {infoOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
              <RagExplainer theme={theme} teacher={isTeacher} />
            </div>
          )}
          <button onClick={() => setDocsCollapsed((v) => !v)} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
            title={docsCollapsed ? 'Mostra documenti' : 'Nascondi documenti'}>
            {docsCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-xl border-2 border-dashed bg-white/80 backdrop-blur-[1px]"
          style={{ borderColor: theme.accent }}>
          <div className="text-center">
            <Upload className="mx-auto mb-2 h-8 w-8" style={{ color: theme.text }} />
            <p className="text-sm font-bold text-slate-700">Rilascia per aggiungere al {noun}</p>
          </div>
        </div>
      )}

      {/* Three panels */}
      <div className="flex min-h-0 flex-1">
        {/* Left: documents */}
        {!docsCollapsed && (
          <div className="flex w-52 shrink-0 flex-col border-r border-slate-200 bg-white p-3 sm:w-64">
            <DocumentPanel
              docs={docs} selectedDocIds={selectedDocIds}
              onToggleDoc={toggleDocSelection}
              onDelete={handleDelete}
              onPreview={(id) => openPreview(id)}
              previewDocId={previewDocId}
              isUploading={isUploading} uploadStep={uploadStep} uploadResult={uploadResult}
              onDismissResult={() => setUploadResult(null)}
              noun={noun} theme={theme}
            />
          </div>
        )}

        {/* Center: chat */}
        <div className="mx-2 my-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            <ChatPanel
              messages={messages} ragPhase={ragPhase}
              onSend={handleSend} selectedDocIds={selectedDocIds}
              onCitationClick={handleCitationClick} activeCitationIndex={activeCitationIndex}
              error={chatError} theme={theme} noun={noun}
            />
          </div>
        </div>

        {/* Right: sources */}
        <div className="my-3 mr-2 flex w-64 shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:w-80">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-4">
            <SourcePanel
              activeDoc={null} chunks={[]}
              isLoadingChunks={false} highlightedChunk={highlightedChunk}
              sourceChunks={sourceChunks} pendingChunks={pendingChunks}
              ragPhase={ragPhase} theme={theme}
              onOpenInDocument={(chunk) => openPreview(chunk.document_id, chunk.id)}
            />
          </div>
        </div>
      </div>

      {previewDoc && (
        <DocumentPreviewModal
          doc={previewDoc}
          chunks={previewChunks}
          loading={previewLoading}
          highlightsByChunk={highlightsByChunk}
          focusChunkId={previewFocusChunkId}
          onClose={() => { setPreviewDocId(null); setPreviewFocusChunkId(null) }}
          theme={theme}
        />
      )}
    </div>
  )
}
