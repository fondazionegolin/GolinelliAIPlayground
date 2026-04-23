import { useState, useRef, useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BookOpen, Upload, Trash2, FileText, Database, Search, Send, Loader2,
  CheckCircle2, Layers, Eye, ChevronDown, ChevronUp,
  Sparkles, PanelLeftClose, PanelLeftOpen, AlertCircle, Plus, Clock,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { studentRagApi } from '@/lib/api'
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

interface RagChunk {
  id: string
  chunk_index: number
  text: string
  page?: number
  document_id: string
  document_title: string
  score?: number
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
}

function docIcon(docType: string) {
  return DOC_ICON[docType] ?? <FileText className="h-4 w-4 text-slate-400" />
}

function normalizeChunk(c: Record<string, unknown>): RagChunk {
  return {
    id: (c.id || c.chunk_id) as string,
    chunk_index: c.chunk_index as number,
    text: c.text as string,
    page: c.page as number | undefined,
    document_id: c.document_id as string,
    document_title: (c.document_title || '') as string,
    score: c.score as number | undefined,
  }
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

// ─── Embedding Explainer ──────────────────────────────────────────────────────

function EmbeddingExplainer({ theme }: { theme: AccentTheme }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: theme.text }} />
        <span className="text-[11px] font-semibold text-slate-600 flex-1">Come usa le fonti?</span>
        {open ? <ChevronUp className="h-3 w-3 text-slate-400" /> : <ChevronDown className="h-3 w-3 text-slate-400" />}
      </button>
      {open && (
        <div className="px-3 pb-3 text-[11px] text-slate-600 space-y-2">
          {[
            { n: 1, title: 'Lettura completa', desc: 'Il documento viene segmentato in parti leggibili, mantenendo pagine e struttura.' },
            { n: 2, title: 'Ricerca intelligente', desc: 'La domanda viene confrontata sia per significato sia per parole esatte.' },
            { n: 3, title: 'Selezione delle prove', desc: 'I passaggi più utili vengono mostrati nella colonna Fonti prima e dopo la risposta.' },
            { n: 4, title: 'Risposta vincolata', desc: "Il chatbot deve restare dentro i contenuti caricati e citare i riferimenti [[n]]." },
          ].map(({ n, title, desc }) => (
            <div key={n} className="flex items-start gap-2">
              <div className="h-5 w-5 rounded-full flex items-center justify-center font-bold shrink-0 mt-0.5 text-[10px]"
                style={{ backgroundColor: hex2rgba(theme.accent, 0.12), color: theme.text }}>
                {n}
              </div>
              <p><strong>{title}:</strong> {desc}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Document Panel ───────────────────────────────────────────────────────────

function DocumentPanel({
  docs, selectedDocIds, onToggleDoc, onDelete, onUpload,
  isUploading, uploadStep, uploadResult, activeDocForChunks, onViewChunks, theme,
}: {
  docs: RagDoc[]
  selectedDocIds: string[]
  onToggleDoc: (id: string) => void
  onDelete: (id: string) => void
  onUpload: (files: FileList) => void
  isUploading: boolean
  uploadStep: number
  uploadResult: { chunk_count: number; key_concepts: string[]; summary: string } | null
  activeDocForChunks: string | null
  onViewChunks: (id: string | null) => void
  theme: AccentTheme
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4" style={{ color: theme.text }} />
          <span className="text-sm font-semibold text-slate-800">Documenti</span>
          {docs.length > 0 && (
            <span className="text-[10px] font-bold rounded-full px-1.5 py-0.5"
              style={{ backgroundColor: hex2rgba(theme.accent, 0.12), color: theme.text }}>
              {docs.length}
            </span>
          )}
        </div>
        <div>
          <input ref={fileRef} type="file" className="hidden" multiple
            accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.md"
            onChange={(e) => e.target.files && onUpload(e.target.files)} />
          <button onClick={() => fileRef.current?.click()} disabled={isUploading}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50"
            style={{ backgroundColor: theme.accent }}>
            {isUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
            Carica
          </button>
        </div>
      </div>

      {/* Upload progress */}
      {isUploading && (
        <div className="rounded-2xl border p-3 space-y-2"
          style={{ borderColor: hex2rgba(theme.accent, 0.25), backgroundColor: hex2rgba(theme.accent, 0.06) }}>
          <div className="flex items-center gap-2">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" style={{ color: theme.text }} />
            <p className="text-xs font-semibold" style={{ color: theme.text }}>Elaborazione in corso…</p>
          </div>
          <div className="space-y-1.5">
            {UPLOAD_STEPS.slice(0, -1).map((step, i) => (
              <div key={step.key} className="flex items-center gap-2">
                {i < uploadStep
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  : i === uploadStep
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" style={{ color: theme.text }} />
                    : <div className="h-3.5 w-3.5 rounded-full border border-slate-300 shrink-0" />}
                <span className={`text-[11px] ${i <= uploadStep ? 'text-slate-700' : 'text-slate-400'}`}>{step.label}</span>
              </div>
            ))}
          </div>
          <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(uploadStep / (UPLOAD_STEPS.length - 1)) * 100}%`, backgroundColor: theme.accent }} />
          </div>
        </div>
      )}

      {/* Upload result */}
      {uploadResult && !isUploading && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 space-y-2">
          <div className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-xs font-semibold">Documento pronto per le domande</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="bg-white rounded-xl p-2 border border-emerald-100 text-center">
              <p className="font-bold text-lg" style={{ color: theme.text }}>{uploadResult.chunk_count}</p>
              <p className="text-slate-500">passaggi indicizzati</p>
            </div>
            <div className="bg-white rounded-xl p-2 border border-emerald-100 text-center">
              <p className="font-bold text-lg" style={{ color: theme.text }}>{uploadResult.chunk_count}</p>
              <p className="text-slate-500">segmenti pronti</p>
            </div>
          </div>
          {uploadResult.key_concepts.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-emerald-700 mb-1">Concetti chiave:</p>
              <div className="flex flex-wrap gap-1">
                {uploadResult.key_concepts.slice(0, 8).map((c) => (
                  <span key={c} className="text-[10px] rounded-full px-2 py-0.5"
                    style={{ backgroundColor: hex2rgba(theme.accent, 0.12), color: theme.text }}>
                    {c}
                  </span>
                ))}
              </div>
            </div>
          )}
          {uploadResult.summary && (
            <p className="text-[11px] text-slate-600 bg-white rounded-xl p-2 border border-emerald-100 italic">{uploadResult.summary}</p>
          )}
        </div>
      )}

      {/* Doc list */}
      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
        {docs.length === 0 && !isUploading && (
          <div className="flex flex-col items-center justify-center h-full text-slate-400 text-xs text-center py-8">
            <BookOpen className="h-8 w-8 mb-2 opacity-30" />
            <p className="font-medium">Nessun documento caricato</p>
            <p className="mt-1 text-[11px]">Carica PDF, Word o fogli dati per iniziare</p>
          </div>
        )}
        {docs.map((doc) => {
          const isSelected = selectedDocIds.includes(doc.id)
          const isActive = activeDocForChunks === doc.id
          return (
            <div key={doc.id} onClick={() => onToggleDoc(doc.id)}
              className="rounded-2xl border p-2.5 transition-all cursor-pointer"
              style={{
                borderColor: isSelected ? hex2rgba(theme.accent, 0.4) : 'rgba(203,213,225,0.6)',
                backgroundColor: isSelected ? hex2rgba(theme.accent, 0.07) : 'white',
              }}>
              <div className="flex items-start gap-2">
                <div className="mt-0.5 h-4 w-4 rounded border-2 shrink-0 flex items-center justify-center transition-all"
                  style={isSelected
                    ? { borderColor: theme.accent, backgroundColor: theme.accent }
                    : { borderColor: '#cbd5e1' }}>
                  {isSelected && <CheckCircle2 className="h-3 w-3 text-white" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {docIcon(doc.doc_type)}
                    <span className="text-xs font-medium text-slate-700 truncate">{doc.title}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      doc.status === 'ready' || doc.status === 'READY' ? 'bg-emerald-100 text-emerald-700' :
                      doc.status === 'processing' || doc.status === 'PROCESSING' ? 'bg-amber-100 text-amber-700' :
                      'bg-red-100 text-red-600'
                    }`}>
                      {doc.status === 'ready' || doc.status === 'READY' ? 'Pronto' :
                       doc.status === 'processing' || doc.status === 'PROCESSING' ? 'Elaborazione…' : 'Errore'}
                    </span>
                    {doc.chunk_count > 0 && (
                      <span className="text-[10px] text-slate-400">{doc.chunk_count} blocchi</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 shrink-0">
                  {(doc.status === 'ready' || doc.status === 'READY') && (
                    <button onClick={(e) => { e.stopPropagation(); onViewChunks(isActive ? null : doc.id) }}
                      title="Visualizza blocchi"
                      className="p-1 rounded-lg transition-colors"
                      style={isActive
                        ? { color: theme.text, backgroundColor: hex2rgba(theme.accent, 0.12) }
                        : { color: '#94a3b8' }}>
                      <Layers className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); onDelete(doc.id) }}
                    className="p-1 rounded-lg text-slate-300 hover:text-red-400 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <EmbeddingExplainer theme={theme} />
    </div>
  )
}

// ─── Cited Content ────────────────────────────────────────────────────────────

function CitedContent({
  content, sourceChunks, onCitationClick, activeCitationIndex, theme,
}: {
  content: string
  sourceChunks: RagChunk[]
  onCitationClick: (chunk: RagChunk, index: number, chunks: RagChunk[]) => void
  activeCitationIndex: number | null
  theme: AccentTheme
}) {
  const segments = parseCitations(content)
  return (
    <div className="prose prose-sm max-w-none prose-slate">
      {segments.map((seg, i) => {
        if (seg.type === 'cite') {
          const idx = seg.index! - 1
          const chunk = sourceChunks[idx]
          const isActive = activeCitationIndex === idx
          return (
            <button key={i} onClick={() => chunk && onCitationClick(chunk, idx, sourceChunks)}
              className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded text-[10px] font-bold transition-all mx-0.5"
              style={isActive
                ? { backgroundColor: theme.accent, color: 'white' }
                : chunk
                  ? { backgroundColor: hex2rgba(theme.accent, 0.12), color: theme.text }
                  : { backgroundColor: '#f1f5f9', color: '#64748b' }}
              title={chunk ? `Fonte: ${chunk.document_title}${chunk.page ? ` — p.${chunk.page}` : ''}` : 'Fonte non disponibile'}>
              {seg.index}
            </button>
          )
        }
        return <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>{seg.content}</ReactMarkdown>
      })}
    </div>
  )
}

// ─── Chat Panel ───────────────────────────────────────────────────────────────

function ChatPanel({
  messages, ragPhase, onSend,
  selectedDocIds, onCitationClick, activeCitationIndex, error, theme,
}: {
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
      <div
        className="mb-4 shrink-0 rounded-2xl border px-4 py-3"
        style={{ borderColor: hex2rgba(theme.accent, 0.18), backgroundColor: hex2rgba(theme.accent, 0.05) }}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]"
            style={{ backgroundColor: hex2rgba(theme.accent, 0.14), color: theme.text }}
          >
            Ricerca intelligente attiva
          </span>
          <span className="text-xs font-medium text-slate-600">
            Significato + parole esatte, solo nei documenti caricati.
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px] text-slate-500">
          {selectedDocIds.length > 0 ? (
            <span className="rounded-full bg-white px-2.5 py-1 border border-slate-200">
              {selectedDocIds.length} documenti selezionati
            </span>
          ) : (
            <span className="rounded-full bg-white px-2.5 py-1 border border-slate-200">
              Tutta la knowledge base personale
            </span>
          )}
          <span>Le fonti usate compaiono subito a destra.</span>
        </div>
      </div>

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
              <div className="h-7 w-7 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                style={{ backgroundColor: theme.accent }}>
                <BookOpen className="h-3.5 w-3.5 text-white" />
              </div>
            )}
            <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm"
              style={msg.role === 'user'
                ? { backgroundColor: theme.accent, color: 'white', borderRadius: '1rem 1rem 4px 1rem' }
                : { backgroundColor: 'white', border: '1px solid #e2e8f0', color: '#1e293b', borderRadius: '1rem 1rem 1rem 4px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
              {msg.role === 'assistant' ? (
                <CitedContent content={msg.content} sourceChunks={msg.sourceChunks || []}
                  onCitationClick={onCitationClick} activeCitationIndex={activeCitationIndex} theme={theme} />
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {/* Loading phases */}
        {ragPhase === 'searching' && (
          <div className="flex gap-3">
            <div className="h-7 w-7 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: hex2rgba(theme.accent, 0.12) }}>
              <Search className="h-3.5 w-3.5 animate-pulse" style={{ color: theme.text }} />
            </div>
            <div className="rounded-2xl rounded-bl-md px-4 py-3 shadow-sm border"
              style={{ backgroundColor: hex2rgba(theme.accent, 0.06), borderColor: hex2rgba(theme.accent, 0.2) }}>
              <p className="text-xs font-medium" style={{ color: theme.text }}>Ricerca nelle fonti…</p>
              <p className="mt-1 text-[11px] text-slate-500">Sto combinando significato e corrispondenze testuali.</p>
              <div className="flex gap-1 mt-1.5">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="w-1.5 h-1.5 rounded-full animate-bounce"
                    style={{ backgroundColor: theme.accent, animationDelay: `${d}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        {ragPhase === 'generating' && (
          <div className="flex gap-3">
            <div className="h-7 w-7 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: theme.accent }}>
              <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm">
              <p className="text-xs text-slate-500 font-medium">Generazione risposta…</p>
              <p className="mt-1 text-[11px] text-slate-400">La risposta viene costruita solo a partire dai passaggi trovati.</p>
              <div className="flex gap-1 mt-1.5">
                {[0, 150, 300].map((d) => (
                  <span key={d} className="w-2 h-2 rounded-full animate-bounce"
                    style={{ backgroundColor: theme.accent, animationDelay: `${d}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">
            <AlertCircle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
            <p className="text-xs text-red-700">{error}</p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 pt-3 border-t border-slate-200 mt-3">
        <div className={`flex gap-2 items-end rounded-2xl border bg-white p-2 transition-all ${isLoading ? 'opacity-70' : ''}`}
          style={{ borderColor: isLoading ? '#e2e8f0' : '#cbd5e1' }}
          onFocus={(e) => { if (!isLoading) (e.currentTarget as HTMLDivElement).style.borderColor = theme.accent }}
          onBlur={(e) => { (e.currentTarget as HTMLDivElement).style.borderColor = '#cbd5e1' }}>
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
            placeholder={isLoading ? 'Elaborazione in corso…' :
              selectedDocIds.length > 0 ? 'Domanda sui documenti selezionati…' : 'Domanda sulla knowledge base…'}
            rows={2} disabled={isLoading}
            className="flex-1 resize-none bg-transparent text-sm leading-relaxed text-slate-800 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed" />
          <button onClick={handleSend} disabled={!input.trim() || isLoading}
            className="h-8 w-8 rounded-xl flex items-center justify-center text-white transition disabled:opacity-40 shrink-0"
            style={{ backgroundColor: theme.accent }}>
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
  activeDoc, chunks, isLoadingChunks, highlightedChunk, sourceChunks, pendingChunks, ragPhase, theme,
}: {
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
              ? { backgroundColor: '#fef3c7', color: '#92400e' }
              : { backgroundColor: hex2rgba(theme.accent, 0.1), color: theme.text }}>
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
          return (
            <div key={chunk.id} ref={isHighlighted ? highlightRef : undefined}
              className="rounded-2xl border p-3 transition-all duration-300"
              style={isHighlighted
                ? {
                    borderColor: hex2rgba(theme.accent, 0.5),
                    backgroundColor: hex2rgba(theme.accent, 0.07),
                    boxShadow: `0 0 0 2px ${hex2rgba(theme.accent, 0.2)}`,
                  }
                : { borderColor: '#e2e8f0', backgroundColor: 'white' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-bold rounded-full px-2 py-0.5"
                  style={{ backgroundColor: hex2rgba(theme.accent, 0.12), color: theme.text }}>
                  {sourceChunks || pendingChunks ? `[[${i + 1}]]` : `#${(chunk.chunk_index ?? i) + 1}`}
                </span>
                {chunk.document_title && (
                  <span className="text-[10px] text-slate-500 truncate flex-1">{chunk.document_title}</span>
                )}
                {chunk.page && <span className="text-[10px] text-slate-400 shrink-0">p.{chunk.page}</span>}
                {chunk.score !== undefined && (
                  <div className="ml-auto shrink-0 flex items-center gap-1.5">
                    <div className="h-1.5 w-14 rounded-full bg-slate-200 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, chunk.score * 100)}%`, backgroundColor: theme.accent }} />
                    </div>
                    <span className="text-[10px] text-slate-400">{(chunk.score * 100).toFixed(0)}%</span>
                  </div>
                )}
              </div>
              <p className={`text-[12px] leading-relaxed ${isHighlighted ? 'text-slate-800 font-medium' : 'text-slate-600'}`}>
                {chunk.text}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function StudentRagWorkspace({
  theme, session, onSessionUpdate, onNewSession, onSwitchSession, onDeleteSession,
}: {
  theme: AccentTheme
  session: RagSession
  onSessionUpdate: (s: RagSession) => void
  onNewSession: () => void
  onSwitchSession: (id: string) => void
  onDeleteSession: (id: string) => void
}) {
  const queryClient = useQueryClient()

  const [kbCollapsed, setKbCollapsed] = useState(false)
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>(session.selectedDocIds)
  const [messages, setMessages] = useState<RagMessage[]>(session.messages)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadStep, setUploadStep] = useState(0)
  const [uploadResult, setUploadResult] = useState<{ chunk_count: number; key_concepts: string[]; summary: string } | null>(null)
  const [activeDocForChunks, setActiveDocForChunks] = useState<string | null>(null)
  const [highlightedChunk, setHighlightedChunk] = useState<RagChunk | null>(null)
  const [activeCitationIndex, setActiveCitationIndex] = useState<number | null>(null)
  const [sourceChunks, setSourceChunks] = useState<RagChunk[] | null>(getLatestSessionSourceChunks(session.messages))
  const [pendingChunks, setPendingChunks] = useState<RagChunk[] | null>(null)
  const [ragPhase, setRagPhase] = useState<RagPhase>('idle')
  const [chatError, setChatError] = useState<string | null>(null)

  useEffect(() => {
    setSelectedDocIds(session.selectedDocIds)
    setMessages(session.messages)
    setSourceChunks(getLatestSessionSourceChunks(session.messages))
    setPendingChunks(null)
    setHighlightedChunk(null)
    setActiveCitationIndex(null)
    setActiveDocForChunks(null)
    setChatError(null)
  }, [session])

  const persistSession = useCallback((
    msgs: RagMessage[],
    docIds: string[],
  ) => {
    const name = msgs.find((m) => m.role === 'user')?.content.slice(0, 50) || session.name
    const updated: RagSession = {
      ...session,
      name,
      messages: msgs,
      selectedDocIds: docIds,
      searchMode: 'hybrid',
      updatedAt: new Date().toISOString(),
    }
    saveRagSession(updated)
    onSessionUpdate(updated)
  }, [session, onSessionUpdate])

  const { data: docs = [] } = useQuery<RagDoc[]>({
    queryKey: ['student-rag-docs'],
    queryFn: async () => {
      const res = await studentRagApi.listDocuments()
      return res.data || []
    },
  })

  const { data: docChunks = [], isFetching: chunksLoading } = useQuery<RagChunk[]>({
    queryKey: ['student-rag-chunks', activeDocForChunks],
    queryFn: async () => {
      const res = await studentRagApi.getChunks(activeDocForChunks!)
      return (res.data || []).map(normalizeChunk)
    },
    enabled: !!activeDocForChunks,
  })

  const handleDelete = useCallback(async (id: string) => {
    try {
      await studentRagApi.deleteDocument(id)
      queryClient.invalidateQueries({ queryKey: ['student-rag-docs'] })
      setSelectedDocIds((prev) => {
        const next = prev.filter((d) => d !== id)
        persistSession(messages, next)
        return next
      })
    } catch { /* noop */ }
  }, [messages, persistSession, queryClient])

  const handleUpload = useCallback(async (files: FileList) => {
    setIsUploading(true)
    setUploadStep(0)
    setUploadResult(null)
    const timings = [400, 900, 1500, 2200]
    timings.forEach((delay, i) => setTimeout(() => setUploadStep(i + 1), delay))
    try {
      for (const file of Array.from(files)) {
        const res = await studentRagApi.uploadDocument(file)
        const data = res.data
        setUploadResult({
          chunk_count: data.chunk_count,
          key_concepts: data.key_concepts || [],
          summary: data.summary || '',
        })
      }
      setUploadStep(4)
      queryClient.invalidateQueries({ queryKey: ['student-rag-docs'] })
    } catch {
      setChatError('Errore durante il caricamento del documento.')
    } finally {
      setIsUploading(false)
    }
  }, [queryClient])

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
      const searchRes = await studentRagApi.search(message, docFilter, 8)
      const chunks = (searchRes.data || []).map(normalizeChunk)
      setPendingChunks(chunks)
    } catch { /* non-fatal */ }

    setRagPhase('generating')
    try {
      const chatRes = await studentRagApi.chat(message, history, docFilter, 8)
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
      setActiveDocForChunks(null)
    } catch (err: unknown) {
      setChatError(err instanceof Error ? err.message : 'Errore nella risposta. Riprova.')
      setPendingChunks(null)
    } finally {
      setRagPhase('idle')
    }
  }, [messages, selectedDocIds, persistSession])

  const handleCitationClick = useCallback((chunk: RagChunk, index: number, citationChunks: RagChunk[]) => {
    setSourceChunks(citationChunks)
    setHighlightedChunk(chunk)
    setActiveCitationIndex(index)
    setActiveDocForChunks(null)
    setPendingChunks(null)
  }, [])

  const handleViewChunks = (docId: string | null) => {
    setActiveDocForChunks(docId)
    setSourceChunks(null)
    setPendingChunks(null)
    setHighlightedChunk(null)
    setActiveCitationIndex(null)
  }

  const activeDoc = docs.find((d) => d.id === activeDocForChunks) ?? null
  const displayChunks = activeDocForChunks ? docChunks : []

  const allSessions = getRagSessions()
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false)
  const sessionMenuRef = useRef<HTMLDivElement>(null)

  // Close menu on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (sessionMenuRef.current && !sessionMenuRef.current.contains(e.target as Node)) {
        setSessionMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="flex flex-col h-full min-h-0 bg-slate-100">
      {/* Session bar */}
      <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5 shrink-0">
        {/* Session selector */}
        <div className="relative flex-1 min-w-0" ref={sessionMenuRef}>
          <button
            onClick={() => setSessionMenuOpen((o) => !o)}
            className="flex items-center gap-2 px-3 py-2 rounded-2xl bg-white border border-slate-200 hover:border-slate-300 transition-all text-left w-full max-w-sm shadow-sm"
          >
            <Database className="h-3.5 w-3.5 shrink-0" style={{ color: theme.text }} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-700 truncate">{session.name}</p>
              <p className="text-[10px] text-slate-400">Cronologia e fonti della sessione</p>
            </div>
            <ChevronDown className={`h-3 w-3 text-slate-400 shrink-0 transition-transform ${sessionMenuOpen ? 'rotate-180' : ''}`} />
          </button>

          {sessionMenuOpen && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-white rounded-2xl border border-slate-200 shadow-xl z-50 overflow-hidden">
              <div className="p-2 border-b border-slate-100">
                <button
                  onClick={() => { setSessionMenuOpen(false); onNewSession() }}
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-xl text-left transition-colors hover:bg-slate-50"
                >
                  <div className="h-6 w-6 rounded-lg flex items-center justify-center shrink-0"
                    style={{ backgroundColor: hex2rgba(theme.accent, 0.12) }}>
                    <Plus className="h-3.5 w-3.5" style={{ color: theme.text }} />
                  </div>
                  <span className="text-xs font-semibold" style={{ color: theme.text }}>Nuova sessione</span>
                </button>
              </div>
              <div className="max-h-56 overflow-y-auto p-2 space-y-0.5">
                {allSessions.length === 0 && (
                  <p className="text-[11px] text-slate-400 text-center py-3">Nessuna sessione salvata</p>
                )}
                {allSessions.map((s) => {
                  const isCurrent = s.id === session.id
                  const lastMsg = s.messages.filter((m) => m.role === 'user').pop()
                  return (
                    <div key={s.id}
                      className="flex items-start gap-2 w-full px-3 py-2 rounded-xl text-left transition-colors hover:bg-slate-50"
                      style={isCurrent ? { backgroundColor: hex2rgba(theme.accent, 0.08) } : {}}>
                      <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-slate-400" />
                      <button
                        onClick={() => { setSessionMenuOpen(false); onSwitchSession(s.id) }}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-1">
                          <span className="text-xs font-semibold text-slate-700 truncate">{s.name}</span>
                          {isCurrent && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0 font-bold"
                              style={{ backgroundColor: hex2rgba(theme.accent, 0.12), color: theme.text }}>
                              attiva
                            </span>
                          )}
                        </div>
                        {lastMsg && <p className="text-[10px] text-slate-400 truncate">{lastMsg.content.slice(0, 50)}</p>}
                        <p className="text-[10px] text-slate-300">{new Date(s.updatedAt).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                      </button>
                      <button
                        onClick={() => { onDeleteSession(s.id); setSessionMenuOpen(false) }}
                        className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors shrink-0"
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

        {/* New session shortcut */}
        <button
          onClick={onNewSession}
          title="Nuova sessione"
          className="flex items-center gap-1.5 px-3 py-2 rounded-2xl text-xs font-semibold text-white shadow-sm shrink-0 transition-opacity hover:opacity-90"
          style={{ backgroundColor: theme.accent }}
        >
          <Plus className="h-3.5 w-3.5" />
          Nuova
        </button>
      </div>

      {/* Three panels */}
      <div className="flex flex-1 min-h-0">
      {/* Left: Knowledge Base */}
      <div className={`shrink-0 flex flex-col transition-all duration-300 ${kbCollapsed ? 'w-12' : 'w-72'}`}>
        {kbCollapsed ? (
          <div className="flex flex-col items-center gap-3 p-2 pt-4 h-full bg-white border-r border-slate-200">
            <button onClick={() => setKbCollapsed(false)} title="Espandi Knowledge Base"
              className="p-2 rounded-xl hover:bg-slate-50 transition-colors" style={{ color: theme.text }}>
              <PanelLeftOpen className="h-4 w-4" />
            </button>
            <div className="w-px flex-1 bg-slate-200 mx-auto" />
            {docs.map((doc) => (
              <div key={doc.id} title={doc.title}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold cursor-pointer transition-colors"
                style={selectedDocIds.includes(doc.id)
                  ? { backgroundColor: theme.accent, color: 'white' }
                  : { backgroundColor: '#f1f5f9', color: '#64748b' }}
                onClick={() => toggleDocSelection(doc.id)}>
                {doc.title.slice(0, 1).toUpperCase()}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col h-full bg-white border-r border-slate-200">
            <div className="flex items-center justify-end px-3 pt-3 shrink-0">
              <button onClick={() => setKbCollapsed(true)} title="Comprimi"
                className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-50 transition-colors"
                style={{ color: '#94a3b8' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = theme.text)}
                onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}>
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden p-4 pt-1">
              <DocumentPanel
                docs={docs} selectedDocIds={selectedDocIds}
                onToggleDoc={toggleDocSelection}
                onDelete={handleDelete} onUpload={handleUpload}
                isUploading={isUploading} uploadStep={uploadStep} uploadResult={uploadResult}
                activeDocForChunks={activeDocForChunks} onViewChunks={handleViewChunks}
                theme={theme}
              />
            </div>
          </div>
        )}
      </div>

      {/* Center: Chat */}
      <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-white mx-2 my-3 rounded-[24px] border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex-1 min-h-0 p-4 flex flex-col overflow-hidden">
          <ChatPanel
            messages={messages} ragPhase={ragPhase}
            onSend={handleSend} selectedDocIds={selectedDocIds}
            onCitationClick={handleCitationClick} activeCitationIndex={activeCitationIndex}
            error={chatError} theme={theme}
          />
        </div>
      </div>

      {/* Right: Sources */}
      <div className="w-72 shrink-0 flex flex-col bg-white mr-2 my-3 rounded-[24px] border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex-1 min-h-0 p-4 flex flex-col overflow-hidden">
          <SourcePanel
            activeDoc={activeDoc} chunks={displayChunks}
            isLoadingChunks={chunksLoading} highlightedChunk={highlightedChunk}
            sourceChunks={sourceChunks} pendingChunks={pendingChunks}
            ragPhase={ragPhase} theme={theme}
          />
        </div>
      </div>
      </div>
    </div>
  )
}
