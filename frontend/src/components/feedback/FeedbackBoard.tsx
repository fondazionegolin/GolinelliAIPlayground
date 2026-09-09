import { useMemo, useState, useRef, type DragEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { feedbackApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { ZoomableImage } from '@/components/ui/ZoomableImage'
import { Button, SearchPill } from '@/design'
import {
  Bug, Sparkles, Palette, MousePointerClick, AlertTriangle, Wand2, Wrench,
  CheckCircle, Mail, Globe, Monitor, ImageIcon, X, Share2, Trash2, Plus, Loader2,
  Send, Columns3, Settings2,
} from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────────
interface BoardCard {
  id: string
  user_type: string
  user_display_name: string | null
  user_email: string | null
  message: string
  page_url: string | null
  browser_info: {
    user_agent?: string
    screen_width?: number
    screen_height?: number
    language?: string
    platform?: string
    viewport_width?: number
    viewport_height?: number
    screenshot_base64?: string
  }
  console_errors: string[]
  status: string
  source?: string
  created_by_display_name?: string | null
  last_actor_display_name?: string | null
  board_status: string
  category: string | null
  urgency: string | null
  internal_note: string | null
  auto_classified: boolean
  created_at: string
}

interface Collaborator {
  teacher_id: string
  name: string
  email: string
  added_at?: string
}

type BoardColumn = { id: string; label: string; hint: string; color: string }
type BoardTemplate = { id: string; label: string; columns: BoardColumn[] }
type BoardConfig = {
  title: string
  columns: BoardColumn[]
  templates: BoardTemplate[]
  is_shared_with_class: boolean
  students_can_contribute: boolean
}

// ── Board taxonomy (mirrors backend contract) ─────────────────────────────────
const DEFAULT_COLUMNS: BoardColumn[] = [
  { id: 'inbox', label: 'Inbox / Nuovi', hint: 'Segnalazioni grezze da leggere e valutare', color: '#64748b' },
  { id: 'triage', label: 'In Analisi / Triage', hint: 'Qualifica: bug, feature o errore d’uso. Assegna priorità', color: '#0ea5e9' },
  { id: 'qa', label: 'In Revisione / QA', hint: 'Verifica tecnica e qualitativa del fix', color: '#a855f7' },
  { id: 'released', label: 'Rilasciato / Chiuso', hint: 'Online e cliente avvisato', color: '#10b981' },
]

const CATEGORY_META: Record<string, { label: string; icon: typeof Bug; cls: string }> = {
  bug: { label: 'Bug', icon: Bug, cls: 'bg-red-100 text-red-700' },
  feature: { label: 'Feature', icon: Sparkles, cls: 'bg-indigo-100 text-indigo-700' },
  ui: { label: 'UI', icon: Palette, cls: 'bg-pink-100 text-pink-700' },
  ux: { label: 'UX', icon: MousePointerClick, cls: 'bg-amber-100 text-amber-700' },
}

const URGENCY_META: Record<string, { label: string; cls: string; dot: string }> = {
  alta: { label: 'Alta', cls: 'bg-red-50 text-red-600 border-red-200', dot: 'bg-red-500' },
  media: { label: 'Media', cls: 'bg-amber-50 text-amber-600 border-amber-200', dot: 'bg-amber-500' },
  bassa: { label: 'Bassa', cls: 'bg-slate-100 text-slate-500 border-slate-200', dot: 'bg-slate-400' },
}

const URGENCY_ORDER: Record<string, number> = { alta: 0, media: 1, bassa: 2 }

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'adesso'
  if (mins < 60) return `${mins}m fa`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h fa`
  const days = Math.floor(hrs / 24)
  return `${days}g fa`
}

function matchesSearch(card: BoardCard, query: string, columns: BoardColumn[]): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return true

  const categoryLabel = card.category ? CATEGORY_META[card.category]?.label : ''
  const urgencyLabel = card.urgency ? URGENCY_META[card.urgency]?.label : ''
  const columnLabel = columns.find((col) => col.id === card.board_status)?.label || card.board_status
  const browserInfo = card.browser_info
    ? Object.entries(card.browser_info)
        .filter(([key]) => key !== 'screenshot_base64')
        .map(([key, value]) => `${key} ${String(value ?? '')}`)
        .join(' ')
    : ''

  const target = [
    card.id,
    card.user_type,
    card.user_display_name,
    card.user_email,
    card.message,
    card.page_url,
    browserInfo,
    ...(card.console_errors || []),
    card.status,
    card.source,
    card.created_by_display_name,
    card.last_actor_display_name,
    card.board_status,
    columnLabel,
    card.category,
    categoryLabel,
    card.urgency,
    urgencyLabel,
    card.internal_note,
    card.created_at,
  ].filter(Boolean).join(' ').toLowerCase()

  return terms.every((term) => target.includes(term))
}

// ── Small presentational helpers ──────────────────────────────────────────────
function CategoryBadge({ category }: { category: string | null }) {
  if (!category || !CATEGORY_META[category]) {
    return <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400">N/D</span>
  }
  const meta = CATEGORY_META[category]
  const Icon = meta.icon
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full ${meta.cls}`}>
      <Icon className="h-3 w-3" />
      {meta.label}
    </span>
  )
}

function UrgencyFlag({ urgency }: { urgency: string | null }) {
  if (!urgency || !URGENCY_META[urgency]) return null
  const meta = URGENCY_META[urgency]
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${meta.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />
      {meta.label}
    </span>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────────
function Card({
  card,
  onDragStart,
  onClick,
}: {
  card: BoardCard
  onDragStart: (e: DragEvent, id: string) => void
  onClick: () => void
}) {
  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, card.id)}
      onClick={onClick}
      className="group w-[280px] shrink-0 cursor-pointer border border-slate-200 border-l-2 bg-white p-3 shadow-sm transition-all hover:border-slate-300 hover:shadow-md active:cursor-grabbing lg:w-auto"
    >
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <CategoryBadge category={card.category} />
        <UrgencyFlag urgency={card.urgency} />
        <span className="ml-auto text-[10px] text-slate-400">{timeAgo(card.created_at)}</span>
      </div>
      <p className="text-[13px] leading-snug text-slate-700 line-clamp-3">{card.message}</p>
      <div className="mt-2 flex items-center gap-1.5">
        <div className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${
          card.user_type === 'teacher' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'
        }`}>
          {(card.user_display_name?.[0] || '?').toUpperCase()}
        </div>
        <span className="text-[11px] text-slate-500 truncate">{card.user_display_name || 'Anonimo'}</span>
        {card.source === 'manual' && (
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">task</span>
        )}
        {card.browser_info?.screenshot_base64 && <ImageIcon className="h-3 w-3 text-slate-300" />}
        {card.console_errors?.length > 0 && (
          <span className="ml-auto flex items-center gap-0.5 text-[10px] text-amber-600">
            <AlertTriangle className="h-3 w-3" />{card.console_errors.length}
          </span>
        )}
      </div>
      {(card.created_by_display_name || card.last_actor_display_name) && (
        <div className="mt-1.5 text-[10px] leading-tight text-slate-400">
          {card.created_by_display_name && <span>Creato da {card.created_by_display_name}</span>}
          {card.last_actor_display_name && card.last_actor_display_name !== card.created_by_display_name && (
            <span> · ultima modifica {card.last_actor_display_name}</span>
          )}
        </div>
      )}
    </div>
  )
}

// ── Detail modal ──────────────────────────────────────────────────────────────
function DetailModal({
  card,
  columns,
  onClose,
  onPatch,
  onClassify,
  onReply,
  busy,
}: {
  card: BoardCard
  columns: BoardColumn[]
  onClose: () => void
  onPatch: (patch: { board_status?: string; category?: string; urgency?: string; internal_note?: string }) => void
  onClassify: () => void
  onReply: (type: 'in_progress' | 'resolved') => void
  busy: boolean
}) {
  const [note, setNote] = useState(card.internal_note || '')
  const [replySent, setReplySent] = useState<string | null>(null)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 bg-slate-50/60 px-5 py-4">
          <div className="flex items-center gap-2 flex-wrap">
            <CategoryBadge category={card.category} />
            <UrgencyFlag urgency={card.urgency} />
            {card.auto_classified && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400">
                <Wand2 className="h-3 w-3" /> auto
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Reporter */}
          <div className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
              card.user_type === 'teacher' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'
            }`}>
              {(card.user_display_name?.[0] || '?').toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800">{card.user_display_name || 'Anonimo'}</p>
              {card.user_email && (
                <a href={`mailto:${card.user_email}`} className="flex items-center gap-1 text-[11px] text-indigo-500 hover:underline">
                  <Mail className="h-3 w-3" />{card.user_email}
                </a>
              )}
            </div>
            <span className="ml-auto text-[11px] text-slate-400">{timeAgo(card.created_at)}</span>
          </div>

          {/* Message */}
          <p className="text-sm leading-relaxed text-slate-700 whitespace-pre-wrap">{card.message}</p>

          {card.page_url && (
            <div className="flex items-center gap-1 text-[11px] text-slate-400">
              <Globe className="h-3 w-3" /><span className="truncate">{card.page_url}</span>
            </div>
          )}

          {/* Screenshot */}
          {card.browser_info?.screenshot_base64 && (
            <ZoomableImage
              src={card.browser_info.screenshot_base64}
              alt={`Screenshot ${card.id}`}
              className="max-w-full rounded-lg border border-slate-200 overflow-hidden"
            />
          )}

          {/* Classification controls */}
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Tipologia</span>
              <select
                value={card.category || ''}
                onChange={(e) => onPatch({ category: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-slate-300"
              >
                <option value="" disabled>—</option>
                {Object.entries(CATEGORY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Urgenza</span>
              <select
                value={card.urgency || ''}
                onChange={(e) => onPatch({ urgency: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-slate-300"
              >
                <option value="" disabled>—</option>
                {Object.entries(URGENCY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
              </select>
            </label>
          </div>

          {/* Move + classify */}
          <div className="flex items-end gap-2">
            <label className="block flex-1">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Sposta in…</span>
              <select
                value={card.board_status}
                onChange={(e) => onPatch({ board_status: e.target.value })}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-slate-300"
              >
                {columns.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>
            <button
              onClick={onClassify}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
              title="Riclassifica con AI"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              AI
            </button>
          </div>

          {/* Internal note */}
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Nota interna</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => { if (note !== (card.internal_note || '')) onPatch({ internal_note: note }) }}
              rows={2}
              placeholder="Annotazioni del team (non visibili all'utente)…"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-slate-300"
            />
          </label>

          {/* Technical details */}
          {(card.browser_info?.user_agent || card.console_errors?.length > 0) && (
            <details className="rounded-lg bg-slate-50 px-3 py-2">
              <summary className="cursor-pointer text-[11px] font-semibold text-slate-500">Dettagli tecnici</summary>
              {card.browser_info?.user_agent && (
                <div className="mt-2 flex items-start gap-1.5">
                  <Monitor className="mt-0.5 h-3 w-3 flex-shrink-0 text-slate-400" />
                  <p className="text-[11px] text-slate-500 break-all">{card.browser_info.user_agent}</p>
                </div>
              )}
              {card.console_errors?.length > 0 && (
                <div className="mt-2 max-h-32 overflow-y-auto rounded bg-slate-900 p-2">
                  {card.console_errors.map((err, i) => (
                    <p key={i} className="font-mono text-[10px] leading-relaxed text-red-300">{err}</p>
                  ))}
                </div>
              )}
            </details>
          )}

          {/* Reply */}
          {card.user_email && (
            <div className="flex items-center gap-2 border-t border-slate-100 pt-3">
              {replySent ? (
                <span className="flex items-center gap-1 text-[11px] text-green-600">
                  <Send className="h-3 w-3" /> Email inviata ({replySent === 'in_progress' ? 'in lavorazione' : 'risolto'})
                </span>
              ) : (
                <>
                  <button
                    onClick={() => { onReply('in_progress'); setReplySent('in_progress') }}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-amber-600 hover:bg-amber-50"
                  >
                    <Wrench className="h-3.5 w-3.5" /> Avvisa: in lavorazione
                  </button>
                  <button
                    onClick={() => { onReply('resolved'); setReplySent('resolved') }}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-medium text-green-600 hover:bg-green-50"
                  >
                    <CheckCircle className="h-3.5 w-3.5" /> Avvisa: risolto
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Collaborators modal (admin only) ──────────────────────────────────────────
function CollaboratorsModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [search, setSearch] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  const { data: collaborators = [], isLoading } = useQuery({
    queryKey: ['feedback-board-collaborators'],
    queryFn: async () => (await feedbackApi.listCollaborators()).data as Collaborator[],
  })

  const { data: eligible = [] } = useQuery({
    queryKey: ['feedback-board-eligible'],
    queryFn: async () => (await feedbackApi.listEligibleCollaborators()).data as Collaborator[],
  })

  const filteredEligible = eligible.filter((t) => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return t.name.toLowerCase().includes(q) || t.email.toLowerCase().includes(q)
  })

  const addMutation = useMutation({
    mutationFn: (e: string) => feedbackApi.addCollaborator(e),
    onSuccess: () => {
      setEmail('')
      setSearch('')
      setPickerOpen(false)
      queryClient.invalidateQueries({ queryKey: ['feedback-board-collaborators'] })
      queryClient.invalidateQueries({ queryKey: ['feedback-board-eligible'] })
      toast({ title: 'Collaboratore aggiunto' })
    },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Errore', description: err.response?.data?.detail || 'Impossibile aggiungere' }),
  })

  const removeMutation = useMutation({
    mutationFn: (id: string) => feedbackApi.removeCollaborator(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feedback-board-collaborators'] }),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="flex items-center gap-2 text-base font-bold text-slate-800"><Share2 className="h-4 w-4" /> Condividi la board</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-5 w-5" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          <p className="text-xs text-slate-500">I docenti aggiunti vedranno la board come voce "Board" nella loro navbar.</p>

          {/* Searchable picker of registered teachers */}
          <div className="relative">
            <input
              type="text"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPickerOpen(true) }}
              onFocus={() => setPickerOpen(true)}
              onBlur={() => setTimeout(() => setPickerOpen(false), 150)}
              placeholder="Cerca un docente registrato…"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
            />
            {pickerOpen && filteredEligible.length > 0 && (
              <div className="absolute z-10 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                {filteredEligible.map((t) => (
                  <button
                    key={t.teacher_id}
                    type="button"
                    disabled={addMutation.isPending}
                    onMouseDown={(e) => { e.preventDefault(); addMutation.mutate(t.email) }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 disabled:opacity-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-700">{t.name}</p>
                      <p className="truncate text-[11px] text-slate-400">{t.email}</p>
                    </div>
                    <Plus className="h-4 w-4 text-slate-300" />
                  </button>
                ))}
              </div>
            )}
            {pickerOpen && search.trim() && filteredEligible.length === 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400 shadow-lg">
                Nessun docente registrato corrisponde — usa l'email qui sotto.
              </div>
            )}
          </div>

          {/* Manual email fallback (for teachers not yet registered) */}
          <form
            onSubmit={(e) => { e.preventDefault(); if (email.trim()) addMutation.mutate(email.trim()) }}
            className="flex gap-2"
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="oppure aggiungi via email"
              className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
            />
            <button
              type="submit"
              disabled={addMutation.isPending}
              className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
            >
              {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Aggiungi
            </button>
          </form>

          <div className="space-y-1.5">
            {isLoading ? (
              <p className="text-sm text-slate-400">Caricamento…</p>
            ) : collaborators.length === 0 ? (
              <p className="text-sm text-slate-400">Nessun collaboratore ancora.</p>
            ) : (
              collaborators.map((c) => (
                <div key={c.teacher_id} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700">{c.name}</p>
                    <p className="truncate text-[11px] text-slate-400">{c.email}</p>
                  </div>
                  <button
                    onClick={() => removeMutation.mutate(c.teacher_id)}
                    className="text-slate-300 hover:text-red-500"
                    title="Rimuovi"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Board ─────────────────────────────────────────────────────────────────────
export default function FeedbackBoard({ isAdmin = false }: { isAdmin?: boolean }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const draggedId = useRef<string | null>(null)
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showCollaborators, setShowCollaborators] = useState(false)
  const [newTaskText, setNewTaskText] = useState('')
  const [newColumnName, setNewColumnName] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [inlineColumnId, setInlineColumnId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  const { data: cards = [], isLoading } = useQuery({
    queryKey: ['feedback-board'],
    queryFn: async () => (await feedbackApi.board()).data as BoardCard[],
  })

  const { data: config } = useQuery({
    queryKey: ['feedback-board-config'],
    queryFn: async () => (await feedbackApi.boardConfig()).data as BoardConfig,
  })

  const columns = config?.columns?.length ? config.columns : DEFAULT_COLUMNS

  const patchMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: any }) => feedbackApi.updateBoardCard(id, patch),
    onSuccess: (res) => {
      const updated = res.data as BoardCard
      queryClient.setQueryData<BoardCard[]>(['feedback-board'], (old) =>
        (old || []).map((c) => (c.id === updated.id ? updated : c)),
      )
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Errore', description: 'Aggiornamento non riuscito' })
      queryClient.invalidateQueries({ queryKey: ['feedback-board'] })
    },
  })

  const classifyMutation = useMutation({
    mutationFn: (id: string) => feedbackApi.classifyCard(id),
    onSuccess: (res) => {
      const updated = res.data as BoardCard
      queryClient.setQueryData<BoardCard[]>(['feedback-board'], (old) =>
        (old || []).map((c) => (c.id === updated.id ? updated : c)),
      )
    },
  })

  const replyMutation = useMutation({
    mutationFn: ({ id, type }: { id: string; type: 'in_progress' | 'resolved' }) => feedbackApi.replyBoardCard(id, type),
    onSuccess: () => toast({ title: 'Email inviata' }),
    onError: (err: any) => toast({ variant: 'destructive', title: 'Errore', description: err.response?.data?.detail || 'Invio non riuscito' }),
  })

  const classifyAllMutation = useMutation({
    mutationFn: () => feedbackApi.classifyAll(),
    onSuccess: (res) => {
      const { classified } = res.data as { classified: number; total: number }
      queryClient.invalidateQueries({ queryKey: ['feedback-board'] })
      toast({
        title: classified > 0 ? 'Valutazione completata' : 'Niente da valutare',
        description: classified > 0
          ? `${classified} feedback classificati con AI. Quelli già etichettati non sono stati toccati.`
          : 'Tutti i feedback hanno già tipologia e urgenza.',
      })
    },
    onError: () => toast({ variant: 'destructive', title: 'Errore', description: 'Valutazione AI non riuscita' }),
  })

  const createCardMutation = useMutation({
    mutationFn: ({ message, boardStatus }: { message: string; boardStatus: string }) =>
      feedbackApi.createBoardCard({ message, board_status: boardStatus }),
    onSuccess: (res) => {
      const created = res.data as BoardCard
      setNewTaskText('')
      setInlineColumnId(null)
      queryClient.setQueryData<BoardCard[]>(['feedback-board'], (old) => [created, ...(old || [])])
      toast({ title: 'Task creato' })
    },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Errore', description: err.response?.data?.detail || 'Creazione task non riuscita' }),
  })

  const updateConfigMutation = useMutation({
    mutationFn: (patch: any) => feedbackApi.updateBoardConfig(patch),
    onSuccess: (res) => {
      queryClient.setQueryData(['feedback-board-config'], res.data)
      queryClient.invalidateQueries({ queryKey: ['feedback-board'] })
      toast({ title: 'Board aggiornata' })
    },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Errore', description: err.response?.data?.detail || 'Configurazione non salvata' }),
  })

  const unclassifiedCount = useMemo(() => cards.filter((c) => !c.category || !c.urgency).length, [cards])
  const filteredCards = useMemo(
    () => cards.filter((card) => matchesSearch(card, searchQuery, columns)),
    [cards, columns, searchQuery],
  )

  const grouped = useMemo(() => {
    const map: Record<string, BoardCard[]> = {}
    for (const col of columns) map[col.id] = []
    for (const card of filteredCards) {
      const key = map[card.board_status] ? card.board_status : (columns[0]?.id || 'inbox')
      map[key].push(card)
    }
    for (const col of columns) {
      map[col.id].sort((a, b) => {
        const ua = URGENCY_ORDER[a.urgency || 'bassa'] ?? 3
        const ub = URGENCY_ORDER[b.urgency || 'bassa'] ?? 3
        if (ua !== ub) return ua - ub
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      })
    }
    return map
  }, [filteredCards, columns])

  const moveCard = (id: string, target: string) => {
    const card = cards.find((c) => c.id === id)
    if (!card || card.board_status === target) return
    // optimistic
    queryClient.setQueryData<BoardCard[]>(['feedback-board'], (old) =>
      (old || []).map((c) => (c.id === id ? { ...c, board_status: target } : c)),
    )
    patchMutation.mutate({ id, patch: { board_status: target } })
  }

  const handleDragStart = (e: DragEvent, id: string) => {
    draggedId.current = id
    e.dataTransfer.effectAllowed = 'move'
  }

  const handleDrop = (e: DragEvent, colId: string) => {
    e.preventDefault()
    setDragOverCol(null)
    const id = draggedId.current
    draggedId.current = null
    if (id) moveCard(id, colId)
  }

  const selectedCard = cards.find((c) => c.id === selectedId) || null

  const applyTemplate = (templateId: string) => {
    if (!templateId) return
    updateConfigMutation.mutate({ template_id: templateId })
  }

  const addColumn = () => {
    const label = newColumnName.trim()
    if (!label) return
    const id = (label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `col_${columns.length + 1}`).slice(0, 20)
    updateConfigMutation.mutate({
      columns: [...columns, { id, label, hint: 'Colonna personalizzata', color: '#64748b' }],
    })
    setNewColumnName('')
  }

  return (
    <div className={`flex min-h-0 flex-col overflow-hidden bg-[var(--surface-page)] ${
      isAdmin ? 'h-[calc(100dvh-6rem)] lg:h-[calc(100dvh-3.5rem)]' : 'h-full'
    }`}>
      <header className="relative z-20 grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-header)] px-4 py-3 shadow-[var(--shadow-sm)] sm:grid-cols-[minmax(0,1fr)_minmax(240px,360px)_minmax(0,1fr)]">
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold text-[var(--text-primary)]">{config?.title || 'Board di sviluppo'}</h1>
          <p className="text-xs text-[var(--text-secondary)]">{cards.length} task · {columns.length} colonne</p>
        </div>
        <SearchPill
          value={searchQuery}
          onValueChange={setSearchQuery}
          placeholder="Cerca task, etichette o persone…"
          className="col-span-2 row-start-2 w-full sm:col-span-1 sm:col-start-2 sm:row-start-1"
        />
        <div className="flex min-w-0 items-center justify-end gap-2 sm:col-start-3">
          <Button
            type="button"
            tone="warning"
            surface="soft"
            density="compact"
            onClick={() => classifyAllMutation.mutate()}
            disabled={classifyAllMutation.isPending || unclassifiedCount === 0}
            title={unclassifiedCount === 0 ? 'Tutti i feedback sono già etichettati' : `${unclassifiedCount} feedback da valutare`}
          >
            {classifyAllMutation.isPending ? <Loader2 className="animate-spin" /> : <Wand2 />}
            <span className="hidden xl:inline">Valuta con AI</span>
            {unclassifiedCount > 0 && (
              <span className="rounded-full bg-[var(--surface-base)] px-1.5 py-0.5 text-[10px] font-bold">{unclassifiedCount}</span>
            )}
          </Button>
          {isAdmin && (
            <Button type="button" tone="neutral" surface="soft" density="compact" onClick={() => setShowCollaborators(true)}>
              <Share2 /> <span className="hidden xl:inline">Condividi</span>
            </Button>
          )}
          <div className="relative">
            <Button
              type="button"
              tone="neutral"
              surface="soft"
              density="compact"
              onClick={() => setShowSettings((visible) => !visible)}
              aria-expanded={showSettings}
            >
              <Settings2 /> <span className="hidden xl:inline">Configura</span>
            </Button>
            {showSettings && (
              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-30 w-[min(360px,calc(100vw-2rem))] space-y-3 rounded-[var(--card-radius)] border border-[var(--border-subtle)] bg-[var(--surface-base)] p-3 text-[var(--text-primary)] shadow-[var(--shadow-xl)]">
              <div>
                <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Template board</label>
                <select
                  onChange={(e) => applyTemplate(e.target.value)}
                  defaultValue=""
                  disabled={updateConfigMutation.isPending}
                  className="h-9 w-full rounded-[var(--control-radius)] border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 text-sm font-medium text-[var(--text-primary)] outline-none focus:ring-2 focus:ring-[var(--selection-border)]"
                >
                  <option value="" disabled>Seleziona un template</option>
                  {(config?.templates || []).map((template) => (
                    <option key={template.id} value={template.id}>{template.label}</option>
                  ))}
                </select>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  addColumn()
                }}
                className="space-y-1"
              >
                <label className="block text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)]">Nuova colonna</label>
                <div className="flex gap-2">
                  <input
                    value={newColumnName}
                    onChange={(e) => setNewColumnName(e.target.value)}
                    placeholder="Nome colonna"
                    className="h-9 min-w-0 flex-1 rounded-[var(--control-radius)] border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:ring-2 focus:ring-[var(--selection-border)]"
                  />
                  <Button
                    type="submit"
                    tone="neutral"
                    surface="soft"
                    density="compact"
                    disabled={updateConfigMutation.isPending || !newColumnName.trim()}
                  >
                    <Columns3 /> Aggiungi
                  </Button>
                </div>
              </form>
              </div>
            )}
          </div>
        </div>
      </header>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto p-3 lg:flex-row lg:overflow-x-auto lg:overflow-y-hidden lg:p-4">
          {columns.map((col) => {
            const colCards = grouped[col.id]
            return (
              <div
                key={col.id}
                onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.id) }}
                onDragLeave={() => setDragOverCol((c) => (c === col.id ? null : c))}
                onDrop={(e) => handleDrop(e, col.id)}
                className={`group/column flex min-h-[210px] w-full shrink-0 flex-row overflow-hidden rounded-xl border bg-slate-50/70 transition-colors lg:h-full lg:min-h-0 lg:w-[320px] lg:flex-col lg:rounded-none ${
                  dragOverCol === col.id ? 'border-slate-400 bg-slate-100' : 'border-slate-200'
                }`}
              >
                <div
                  className="flex w-[150px] shrink-0 flex-col border-r border-slate-200 bg-white px-3 py-3 lg:w-auto lg:flex-row lg:items-start lg:border-b lg:border-r-0"
                  style={{ borderTop: `3px solid ${col.color}` }}
                >
                  <div className="min-w-0 flex-1">
                    <h3 className="text-[12px] font-bold uppercase leading-tight tracking-wide text-slate-700">{col.label}</h3>
                    <p className="mt-1 line-clamp-3 text-[10px] leading-tight text-slate-400 lg:line-clamp-2">{col.hint}</p>
                  </div>
                  <div className="mt-auto flex items-center gap-1.5 pt-3 lg:mt-0 lg:pt-0">
                    <span className="border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] font-bold text-slate-500">{colCards.length}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setNewTaskText('')
                        setInlineColumnId((current) => current === col.id ? null : col.id)
                      }}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 opacity-100 shadow-sm transition hover:border-slate-300 hover:text-slate-800 lg:opacity-0 lg:group-hover/column:opacity-100 lg:focus-visible:opacity-100"
                      title={`Aggiungi task in ${col.label}`}
                      aria-label={`Aggiungi task in ${col.label}`}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="flex min-w-0 flex-1 flex-row items-stretch gap-2 overflow-x-auto overflow-y-hidden p-2 lg:min-h-0 lg:flex-col lg:items-stretch lg:overflow-x-hidden lg:overflow-y-auto">
                  {inlineColumnId === col.id && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault()
                        if (newTaskText.trim()) {
                          createCardMutation.mutate({ message: newTaskText.trim(), boardStatus: col.id })
                        }
                      }}
                      className="w-[280px] shrink-0 space-y-2 border border-slate-200 bg-white p-3 shadow-sm lg:w-auto"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">Nuovo task</span>
                        <button type="button" onClick={() => setInlineColumnId(null)} className="text-slate-400 hover:text-slate-700" aria-label="Annulla">
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                      <textarea
                        autoFocus
                        value={newTaskText}
                        onChange={(e) => setNewTaskText(e.target.value)}
                        placeholder="Descrivi il task o l'attività…"
                        rows={3}
                        className="w-full resize-none rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
                      />
                      <Button
                        type="submit"
                        tone="accent"
                        surface="solid"
                        density="compact"
                        fullWidth
                        disabled={createCardMutation.isPending || !newTaskText.trim()}
                      >
                        {createCardMutation.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
                        Crea task
                      </Button>
                    </form>
                  )}
                  {colCards.map((card) => (
                    <Card key={card.id} card={card} onDragStart={handleDragStart} onClick={() => setSelectedId(card.id)} />
                  ))}
                  {colCards.length === 0 && inlineColumnId !== col.id && (
                    <div className="flex min-w-[160px] flex-1 items-center justify-center py-6 text-center text-[11px] text-slate-300">
                      {searchQuery.trim() ? 'Nessun risultato' : 'Trascina qui'}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {selectedCard && (
        <DetailModal
          card={selectedCard}
          columns={columns}
          onClose={() => setSelectedId(null)}
          onPatch={(patch) => patchMutation.mutate({ id: selectedCard.id, patch })}
          onClassify={() => classifyMutation.mutate(selectedCard.id)}
          onReply={(type) => replyMutation.mutate({ id: selectedCard.id, type })}
          busy={classifyMutation.isPending}
        />
      )}

      {showCollaborators && isAdmin && <CollaboratorsModal onClose={() => setShowCollaborators(false)} />}
    </div>
  )
}
