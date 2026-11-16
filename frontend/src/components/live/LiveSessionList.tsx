import { SearchPill } from '@/design/primitives/SearchPill'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/design'
import LiveSlidePreview, { KIND_META, slideKind, slideText, type PreviewSlide, type SlideKind } from '@/components/live/LiveSlidePreview'
import { Atom, BarChart3, BookOpen, Brain, Building2, Calculator, Code2, Compass, Copy, Cpu, Dna, Droplets, FileBarChart2, FlaskConical, Globe, Heart, KeyRound, Landmark, Languages, Leaf, Lightbulb, ListChecks, MoreHorizontal, Mountain, Music, Palette, Pencil, Play, Puzzle, Pyramid, Radio, Rocket, Scale, Share2, Shield, Sparkles, Square, Trash2, Trophy, Microscope, Zap, ChevronDown, ChevronLeft, ChevronRight, Eye, Plus, X, type LucideIcon } from '@/components/icons'
import { tl } from '@/i18n/tl'

export interface LiveSessionItem {
  id: string
  title: string
  status: string // DRAFT | ACTIVE | CLOSED
  slides_count: number
  slides_json?: Array<object>
  created_at: string
  interaction_type?: 'slides' | 'escape_room'
  public_enabled?: boolean
  started_at?: string | null
  updated_at?: string | null
}

/** Draft escape room whose public lobby is still open: students can be waiting in it. */
export const isOpenLobby = (item: LiveSessionItem) => item.status === 'DRAFT' && item.interaction_type === 'escape_room' && !!item.public_enabled
/** Something still running that the teacher should conclude. */
export const isPending = (item: LiveSessionItem) => item.status === 'ACTIVE' || isOpenLobby(item)

type IconType = LucideIcon
// Platform palette (solid colours used across the app): logo violet and blue, brand pink, teal, indigo, amber.
const PALETTE = { violet: '#7b69c9', blue: '#3ea9f4', pink: '#e85c8d', teal: '#0d9488', indigo: '#5b5bd6', amber: '#d97706' } as const
const PALETTE_LIST = Object.values(PALETTE)
interface Theme { match: RegExp; icon: IconType; color: string; label: string }

// First matching rule wins: it picks an emblematic icon and colour from what the session is about.
const THEMES: Theme[] = [
  { match: /dna|cellul|genetic|biolog|evoluz|organism|batter|virus/i, icon: Dna, color: PALETTE.teal, label: tl("Biologia") },
  { match: /anatom|corpo umano|cuore|salute|medic|benessere/i, icon: Heart, color: PALETTE.pink, label: tl("Salute") },
  { match: /microscop|laboratorio|esperiment|scienz/i, icon: Microscope, color: PALETTE.teal, label: tl("Laboratorio") },
  { match: /chimic|element|molecol|tavola periodica|reazion/i, icon: FlaskConical, color: PALETTE.violet, label: tl("Chimica") },
  { match: /fisic|energia|forza|elettric|magnet|atomo|quantistic/i, icon: Atom, color: PALETTE.blue, label: tl("Fisica") },
  { match: /matemat|algebra|geometr|frazion|equazion|statistic|calcol/i, icon: Calculator, color: PALETTE.amber, label: tl("Matematica") },
  { match: /egitt|piramid|faraon/i, icon: Pyramid, color: PALETTE.amber, label: tl("Antico Egitto") },
  { match: /stori|medioev|roman|antic|guerra|rinascim|rivoluzion|impero|archivio/i, icon: Landmark, color: PALETTE.amber, label: tl("Storia") },
  { match: /montagn|vulcan|terremot|geolog/i, icon: Mountain, color: PALETTE.teal, label: tl("Terra") },
  { match: /geograf|continent|mappa|paes|territor|mondo/i, icon: Globe, color: PALETTE.blue, label: tl("Geografia") },
  { match: /acqua|mare|ocean|fium|idric/i, icon: Droplets, color: PALETTE.blue, label: tl("Acqua") },
  { match: /ambient|ecolog|sostenib|natura|pianta|foresta|biodivers|clima/i, icon: Leaf, color: PALETTE.teal, label: tl("Ambiente") },
  { match: /spazio|pianet|galass|astro|universo|razzo|luna\b|sole\b/i, icon: Rocket, color: PALETTE.indigo, label: tl("Spazio") },
  { match: /intelligenza artificiale|machine learning|chatbot|prompt|\bai\b|neural|llm/i, icon: Brain, color: PALETTE.violet, label: tl("Intelligenza artificiale") },
  { match: /codice|coding|program|algoritm|python|javascript|informatic|software|app\b|digital/i, icon: Code2, color: PALETTE.indigo, label: tl("Informatica") },
  { match: /robot|elettronic|micro:?bit|arduino|sensor|hardware/i, icon: Cpu, color: PALETTE.blue, label: tl("Tecnologia") },
  { match: /sicurezza|privacy|cyber|difesa|protezion/i, icon: Shield, color: PALETTE.indigo, label: tl("Sicurezza") },
  { match: /citt[àa]|urban|resilien|architett|edific|territorio/i, icon: Building2, color: PALETTE.blue, label: tl("Città") },
  { match: /business|impresa|canvas|startup|marketing|mercato|idea|innovaz|progett|management|project/i, icon: Lightbulb, color: PALETTE.amber, label: tl("Innovazione") },
  { match: /diritt|legge|costituz|cittadinanz|etica|giustizia|regole/i, icon: Scale, color: PALETTE.indigo, label: tl("Cittadinanza") },
  { match: /ingles|english|francese|spagnol|tedesco|lingua|lingue/i, icon: Languages, color: PALETTE.pink, label: tl("Lingue") },
  { match: /italiano|letteratur|poesi|grammatic|racconto|scrittura|romanzo|libro|lettura/i, icon: BookOpen, color: PALETTE.pink, label: tl("Letteratura") },
  { match: /music|canzone|ritmo|strument/i, icon: Music, color: PALETTE.pink, label: tl("Musica") },
  { match: /arte|pittur|disegn|creativ|design|color|illustraz/i, icon: Palette, color: PALETTE.pink, label: tl("Arte") },
  { match: /sport|olimpi|gara|campion|movimento/i, icon: Trophy, color: PALETTE.amber, label: 'Sport' },
  { match: /viaggio|esplora|avventur|mistero|indagine|caccia/i, icon: Compass, color: PALETTE.teal, label: tl("Esplorazione") },
  { match: /formazione|training|trainer|didattic|lezione|corso|webinar/i, icon: Sparkles, color: PALETTE.violet, label: tl("Formazione") },
  { match: /gioco|quiz|sfida|puzzle|enigm/i, icon: Puzzle, color: PALETTE.violet, label: tl("Gioco") },
]

function hash(text: string) {
  let value = 0
  for (let index = 0; index < text.length; index += 1) value = (value * 31 + text.charCodeAt(index)) >>> 0
  return value
}

function contentText(item: LiveSessionItem) {
  const parts: string[] = [item.title]
  for (const raw of (item.slides_json || []).slice(0, 6) as Array<Record<string, unknown>>) {
    for (const key of ['question', 'prompt', 'title', 'false_statement', 'explanation']) {
      const value = raw?.[key]
      if (typeof value === 'string') parts.push(value)
    }
  }
  return parts.join(' ')
}

export function sessionEmblem(item: LiveSessionItem): { Icon: IconType; color: string; label: string } {
  const title = item.title || ''
  // The title is the strongest signal; fall back to the slide content, then to the type.
  const theme = THEMES.find((entry) => entry.match.test(title)) ?? THEMES.find((entry) => entry.match.test(contentText(item)))
  const color = theme?.color ?? PALETTE_LIST[hash(title) % PALETTE_LIST.length]
  if (theme) return { Icon: theme.icon, color, label: theme.label }
  return item.interaction_type === 'escape_room'
    ? { Icon: KeyRound, color, label: 'Escape Room' }
    : { Icon: hash(title) % 2 ? ListChecks : BarChart3, color, label: tl("Quiz") }
}

interface Actions {
  onOpen: (item: LiveSessionItem) => void
  onShare: (item: LiveSessionItem) => void
  onEdit: (item: LiveSessionItem) => void
  onDuplicate: (item: LiveSessionItem) => void
  onDelete: (item: LiveSessionItem) => void
  /** Ask to close the session for everyone (always confirmed by the caller). */
  onEnd: (item: LiveSessionItem) => void
  /** PDF report of a finished session. */
  onDownloadReport: (item: LiveSessionItem) => void
}

function ItemMenu({ item, actions }: { item: LiveSessionItem; actions: Actions }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  const entries: Array<{ label: string; icon: IconType; run: () => void; danger?: boolean; hidden?: boolean }> = [
    { label: tl("Link pubblico"), icon: Share2, run: () => actions.onShare(item), hidden: item.status === 'CLOSED' },
    { label: tl("Modifica"), icon: Pencil, run: () => actions.onEdit(item), hidden: item.status !== 'DRAFT' },
    { label: 'Report', icon: FileBarChart2, run: () => actions.onOpen(item), hidden: item.status === 'DRAFT' || item.status === 'CLOSED' },
    { label: tl("Scarica report PDF"), icon: FileBarChart2, run: () => actions.onDownloadReport(item), hidden: item.status !== 'CLOSED' },
    { label: isOpenLobby(item) ? tl("Chiudi lobby") : tl("Concludi per tutti"), icon: Square, run: () => actions.onEnd(item), danger: true, hidden: !isPending(item) },
    { label: tl("Duplica"), icon: Copy, run: () => actions.onDuplicate(item) },
    { label: tl("Elimina"), icon: Trash2, run: () => actions.onDelete(item), danger: true, hidden: item.status === 'ACTIVE' },
  ]
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-label={tl("Altre azioni")} aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-[var(--text-secondary)] transition hover:bg-black/5 hover:text-[var(--text-primary)]">
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && (
        <div className="ds-popover absolute right-0 top-full z-30 mt-1 w-48 rounded-2xl p-1.5 shadow-xl" role="menu">
          {entries.filter((entry) => !entry.hidden).map((entry) => (
            <button key={entry.label} type="button" role="menuitem" onClick={() => { setOpen(false); entry.run() }}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition hover:bg-black/5 ${entry.danger ? 'text-red-600' : 'text-[var(--text-primary)]'}`}>
              <entry.icon className="h-4 w-4" />{entry.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const date = (iso: string) => new Date(iso).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })
const unit = (item: LiveSessionItem) => `${item.slides_count} ${item.interaction_type === 'escape_room' ? 'indizi' : 'slide'}`
const slidesOf = (item: LiveSessionItem) => (item.slides_json || []) as PreviewSlide[]
const isEscape = (item: LiveSessionItem) => item.interaction_type === 'escape_room'

/** Per-kind counts of an item's slides, e.g. 4 × risposta multipla, 1 × word wall. */
function kindCounts(item: LiveSessionItem) {
  const counts = new Map<SlideKind, number>()
  for (const slide of slidesOf(item)) {
    const kind = slideKind(slide, isEscape(item))
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts.entries()]
}

function StatusBadge({ item }: { item: LiveSessionItem }) {
  const active = item.status === 'ACTIVE'
  const lobby = isOpenLobby(item)
  const closed = item.status === 'CLOSED'
  const label = active ? tl("In corso") : lobby ? tl("Lobby aperta") : closed ? tl("Conclusa") : tl("Bozza")
  const style = active ? 'bg-emerald-500 text-white' : lobby ? 'bg-amber-500 text-white' : closed ? 'bg-[var(--ds-field-bg)] text-[var(--text-secondary)]' : 'bg-amber-400/20 text-amber-600'
  return (
    <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${style}`}>
      {(active || lobby) && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}{label}
    </span>
  )
}

function KindChips({ item }: { item: LiveSessionItem }) {
  const counts = kindCounts(item)
  if (!counts.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {counts.map(([kind, count]) => {
        const { icon: KindIcon, color, label } = KIND_META[kind]
        return (
          <span key={kind} title={label} className="flex items-center gap-1 rounded-full bg-[var(--ds-field-bg)] py-0.5 pl-1 pr-2 text-[11px] font-semibold text-[var(--text-secondary)]">
            <span className="flex h-4 w-4 items-center justify-center rounded-full text-white" style={{ background: color }}><KindIcon className="h-2.5 w-2.5" /></span>
            {count} {label}
          </span>
        )
      })}
    </div>
  )
}

function Tile({ item, actions, onPreview }: { item: LiveSessionItem; actions: Actions; onPreview: (item: LiveSessionItem) => void }) {
  const active = item.status === 'ACTIVE'
  const closed = item.status === 'CLOSED'
  const first = slidesOf(item)[0]
  const { Icon, color } = sessionEmblem(item)
  return (
    <article className="flex flex-col gap-3 rounded-3xl bg-[var(--ds-well-tile)] p-3 shadow-sm transition hover:bg-[var(--ds-well-tile-hover)]">
      <button type="button" onClick={() => onPreview(item)} aria-label={tl("Anteprima di {0}", item.title)} className="group relative block overflow-hidden rounded-2xl text-left">
        <div className="pointer-events-none h-44">
          {first
            ? <LiveSlidePreview slide={first} escape={isEscape(item)} compact />
            : <div className="flex h-full items-center justify-center rounded-2xl bg-[var(--ds-field-bg)] text-sm text-[var(--text-secondary)]">{tl("Nessuna slide")}</div>}
        </div>
        <span className="absolute inset-0 flex items-center justify-center bg-black/35 text-sm font-bold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <Eye className="mr-1.5 h-4 w-4" />{tl("Anteprima")}
        </span>
      </button>

      <div className="flex items-start gap-3 px-1">
        <span className="ds-squircle flex h-10 w-10 shrink-0 items-center justify-center text-white" style={{ background: color }} aria-hidden><Icon className="h-5 w-5" strokeWidth={1.7} /></span>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 break-words text-sm font-bold leading-snug text-[var(--text-primary)]" title={item.title}>{item.title}</h3>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">{isEscape(item) ? 'Escape Room' : tl("Quiz")} · {unit(item)} · {date(item.created_at)}</p>
        </div>
        <StatusBadge item={item} />
      </div>

      <div className="px-1"><KindChips item={item} /></div>

      <div className="mt-auto flex items-center gap-2">
        {closed ? (
          <Button tone="neutral" surface="solid" className="h-10 flex-1 justify-center" onClick={() => actions.onOpen(item)}><FileBarChart2 className="h-4 w-4" /> Report</Button>
        ) : (
          <Button tone="accent" surface="solid" className="h-10 flex-1 justify-center" onClick={() => actions.onOpen(item)}>
            {active ? <><Radio className="h-4 w-4" /> {tl("Pannello live")}</> : <><Play className="h-4 w-4" /> {tl("Avvia")}</>}
          </Button>
        )}
        <ItemMenu item={item} actions={actions} />
      </div>
    </article>
  )
}

function NewTile({ onNew }: { onNew: () => void }) {
  return (
    <button type="button" onClick={onNew} className="flex min-h-[18rem] flex-col items-center justify-center gap-3 rounded-3xl bg-[var(--ds-well-tile)]/60 p-6 text-center text-[var(--text-secondary)] transition hover:bg-[var(--ds-well-tile)] hover:text-[var(--text-primary)]">
      <span className="ds-squircle flex h-14 w-14 items-center justify-center bg-[var(--ds-field-bg)]"><Plus className="h-6 w-6" /></span>
      <span className="text-sm font-bold">{tl("Nuova sessione")}</span>
      <span className="max-w-[14rem] text-xs leading-5">{tl("Scegli il tipo e guarda l’anteprima prima di iniziare")}</span>
    </button>
  )
}

/** Full-size preview of every slide of a session, with the main actions at hand. */
function PreviewDialog({ item, actions, onClose }: { item: LiveSessionItem; actions: Actions; onClose: () => void }) {
  const slides = slidesOf(item)
  const [index, setIndex] = useState(0)
  const safe = Math.min(index, Math.max(0, slides.length - 1))
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      else if (event.key === 'ArrowRight') setIndex((value) => Math.min(slides.length - 1, value + 1))
      else if (event.key === 'ArrowLeft') setIndex((value) => Math.max(0, value - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, slides.length])
  const closed = item.status === 'CLOSED'
  const current = slides[safe]

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={item.title} className="ds-popover flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[var(--ds-radius-panel)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 px-6 pb-3 pt-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><StatusBadge item={item} /><span className="text-xs text-[var(--text-secondary)]">{isEscape(item) ? 'Escape Room' : tl("Quiz")} · {unit(item)} · {date(item.created_at)}</span></div>
            <h2 className="mt-1.5 break-words text-xl font-bold text-[var(--text-primary)]">{item.title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label={tl("Chiudi")} className="rounded-xl p-2 text-[var(--text-secondary)] hover:bg-black/5"><X className="h-5 w-5" /></button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 pb-4 md:grid-cols-[16rem_1fr]">
          <ol className="max-h-[50vh] space-y-1.5 overflow-y-auto rounded-3xl bg-[var(--ds-well)] p-2.5 md:max-h-none">
            {slides.map((slide, position) => {
              const { icon: KindIcon, color } = KIND_META[slideKind(slide, isEscape(item))]
              return (
                <li key={position}>
                  <button type="button" onClick={() => setIndex(position)} aria-current={safe === position}
                    className={`flex w-full items-center gap-2.5 rounded-2xl p-2 text-left text-xs transition ${safe === position ? 'bg-[var(--ds-well-tile)] shadow-sm' : 'hover:bg-[var(--ds-well-tile)]/50'}`}>
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: color }}><KindIcon className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0 flex-1"><span className="block font-bold text-[var(--text-secondary)]">{position + 1}</span><span className="line-clamp-2 font-semibold text-[var(--text-primary)]">{slideText(slide) || '…'}</span></span>
                  </button>
                </li>
              )
            })}
            {!slides.length && <li className="p-3 text-xs text-[var(--text-secondary)]">{tl("Nessuna slide")}</li>}
          </ol>

          <div className="flex min-w-0 flex-col gap-3 rounded-3xl bg-[var(--ds-well)] p-4">
            <div className="min-h-[18rem] flex-1 [&>div]:min-h-[18rem]">{current && <LiveSlidePreview slide={current} escape={isEscape(item)} />}</div>
            {slides.length > 1 && (
              <div className="flex items-center justify-center gap-3 text-xs font-bold text-[var(--text-secondary)]">
                <button type="button" disabled={safe === 0} onClick={() => setIndex(safe - 1)} aria-label={tl("Slide precedente")} className="rounded-full p-1.5 hover:bg-black/5 disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                {safe + 1} / {slides.length}
                <button type="button" disabled={safe === slides.length - 1} onClick={() => setIndex(safe + 1)} aria-label={tl("Slide successiva")} className="rounded-full p-1.5 hover:bg-black/5 disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-3 px-6 pb-6 pt-2">
          {item.status === 'DRAFT' && <Button tone="neutral" surface="ghost" onClick={() => { onClose(); actions.onEdit(item) }}><Pencil className="h-4 w-4" /> {tl("Modifica")}</Button>}
          <Button tone="neutral" surface="ghost" onClick={() => { onClose(); actions.onDuplicate(item) }}><Copy className="h-4 w-4" /> {tl("Duplica")}</Button>
          <Button tone="accent" surface="solid" onClick={() => { onClose(); actions.onOpen(item) }}>
            {closed ? <><FileBarChart2 className="h-4 w-4" /> Report</> : item.status === 'ACTIVE' ? <><Radio className="h-4 w-4" /> {tl("Pannello live")}</> : <><Play className="h-4 w-4" /> {tl("Avvia")}</>}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

type StatusFilter = 'all' | 'ACTIVE' | 'DRAFT' | 'CLOSED'
type TypeFilter = 'all' | 'slides' | 'escape_room'
type SortKey = 'recent' | 'oldest' | 'name'

/** Live activities of a session: centred search, tiles with a real preview of the content, all framed on a darker well. */
export default function LiveSessionList({ items, onNew, ...actions }: { items: LiveSessionItem[]; onNew?: () => void } & Actions) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [type, setType] = useState<TypeFilter>('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [showAllArchive, setShowAllArchive] = useState(false)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const previewItem = items.find((item) => item.id === previewId) ?? null

  const counts = useMemo(() => ({
    all: items.length,
    ACTIVE: items.filter((i) => i.status === 'ACTIVE').length,
    DRAFT: items.filter((i) => i.status === 'DRAFT').length,
    CLOSED: items.filter((i) => i.status === 'CLOSED').length,
  }), [items])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const list = items.filter((item) =>
      (status === 'all' || item.status === status) &&
      (type === 'all' || (item.interaction_type ?? 'slides') === type) &&
      (!needle || item.title.toLowerCase().includes(needle) || sessionEmblem(item).label.toLowerCase().includes(needle) || contentText(item).toLowerCase().includes(needle)))
    const time = (i: LiveSessionItem) => new Date(i.created_at).getTime()
    return list.sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, 'it') : sort === 'oldest' ? time(a) - time(b) : time(b) - time(a))
  }, [items, query, status, type, sort])

  const active = visible.filter((i) => i.status === 'ACTIVE')
  const pending = items.filter(isPending)
  const drafts = visible.filter((i) => i.status === 'DRAFT')
  const archive = visible.filter((i) => i.status === 'CLOSED')
  const archiveShown = showAllArchive || archive.length <= 6 ? archive : archive.slice(0, 6)
  const newTile = onNew && !query ? <NewTile onNew={onNew} /> : null

  const chips: Array<[StatusFilter, string]> = [['all', tl("Tutte")], ['ACTIVE', tl("In corso")], ['DRAFT', tl("Bozze")], ['CLOSED', tl("Archivio")]]
  const selectClass = 'h-9 rounded-xl border-0 bg-[var(--ds-field-bg)] px-3 text-xs font-semibold text-[var(--ds-field-ink)]'

  return (
    <div className="space-y-6">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3">
        <SearchPill value={query} placeholder={tl("Cerca per titolo, argomento o domanda")} aria-label={tl("Cerca sessioni")} onValueChange={setQuery} className="w-full" />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <div className="flex flex-wrap items-center justify-center gap-1.5" role="group" aria-label={tl("Filtra per stato")}>
            {chips.map(([id, label]) => (
              <button key={id} type="button" onClick={() => setStatus(id)} aria-pressed={status === id}
                className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${status === id ? 'ds-selected text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-black/5'}`}>
                {label} <span className="opacity-60">{counts[id]}</span>
              </button>
            ))}
          </div>
          <select value={type} onChange={(event) => setType(event.target.value as TypeFilter)} aria-label={tl("Filtra per tipo")} className={selectClass}>
            <option value="all">{tl("Tutti i tipi")}</option><option value="slides">{tl("Quiz e sondaggi")}</option><option value="escape_room">Escape Room</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label={tl("Ordina")} className={selectClass}>
            <option value="recent">{tl("Più recenti")}</option><option value="oldest">{tl("Più vecchie")}</option><option value="name">{tl("Nome A–Z")}</option>
          </select>
        </div>
      </div>

      {pending.length > 0 && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl bg-amber-500/15 p-4 sm:flex-row sm:items-center">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white"><Radio className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-[var(--text-primary)]">{pending.length === 1 ? tl("1 sessione è ancora attiva") : tl("{0} sessioni sono ancora attive", pending.length)}{tl(": gli studenti della classe la vedono.")}</p>
            <p className="truncate text-xs text-[var(--text-secondary)]">{pending.map(i => i.title).join(' · ')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {pending.map(item => (
              <button key={item.id} type="button" onClick={() => actions.onEnd(item)} className="flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-2 text-xs font-bold text-white hover:bg-red-700">
                <Square className="h-3.5 w-3.5" />{isOpenLobby(item) ? tl("Chiudi lobby") : tl("Concludi")}{pending.length > 1 ? ` «${item.title.length > 18 ? item.title.slice(0, 18) + '…' : item.title}»` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-8 rounded-[2rem] bg-[var(--ds-well)] p-4 sm:p-6">
        {active.length > 0 && (
          <Section title={tl("In corso")} hint={tl("Sessioni live attive adesso")} count={active.length}>
            <Grid>{active.map((item) => <Tile key={item.id} item={item} actions={actions} onPreview={(i) => setPreviewId(i.id)} />)}</Grid>
          </Section>
        )}
        {(drafts.length > 0 || (active.length === 0 && newTile)) && (
          <Section title={tl("Da preparare")} hint={tl("Controlla i contenuti e avvia quando sei pronto")} count={drafts.length}>
            <Grid>{newTile}{drafts.map((item) => <Tile key={item.id} item={item} actions={actions} onPreview={(i) => setPreviewId(i.id)} />)}</Grid>
          </Section>
        )}
        {archive.length > 0 && (
          <Section title={tl("Archivio")} hint={tl("Sessioni concluse: report e riutilizzo")} count={archive.length}>
            <Grid>{archiveShown.map((item) => <Tile key={item.id} item={item} actions={actions} onPreview={(i) => setPreviewId(i.id)} />)}</Grid>
            {archive.length > 6 && (
              <button type="button" onClick={() => setShowAllArchive((value) => !value)} className="mx-auto mt-4 flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold text-[var(--text-secondary)] transition hover:bg-black/5">
                {showAllArchive ? tl("Mostra meno") : tl("Mostra tutte ({0})", archive.length)}<ChevronDown className={`h-3.5 w-3.5 transition ${showAllArchive ? 'rotate-180' : ''}`} />
              </button>
            )}
          </Section>
        )}
        {visible.length === 0 && (
          <div className="py-14 text-center text-[var(--text-secondary)]">
            <Zap className="mx-auto mb-2 h-8 w-8 opacity-40" />
            <p className="text-sm font-medium text-[var(--text-primary)]">{tl("Nessuna sessione corrisponde ai filtri")}</p>
            <button type="button" onClick={() => { setQuery(''); setStatus('all'); setType('all') }} className="mt-2 text-xs font-bold text-[var(--app-accent,#7c3aed)] underline">{tl("Azzera i filtri")}</button>
          </div>
        )}
      </div>

      {previewItem && <PreviewDialog item={previewItem} actions={actions} onClose={() => setPreviewId(null)} />}
    </div>
  )
}

function Section({ title, hint, count, children }: { title: string; hint: string; count: number; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-3 px-1">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-[var(--text-primary)]">{title}</h2>
        <span className="rounded-full bg-[var(--ds-well-tile)] px-2.5 py-0.5 text-xs font-bold text-[var(--text-secondary)]">{count}</span>
        <p className="hidden text-xs text-[var(--text-secondary)] sm:block">{hint}</p>
      </div>
      {children}
    </section>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
}
