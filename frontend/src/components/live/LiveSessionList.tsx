import { SearchPill } from '@/design/primitives/SearchPill'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Select } from '@/design'
import LiveSlidePreview, { KIND_META, slideKind, slideText, type PreviewSlide } from '@/components/live/LiveSlidePreview'
import { Atom, BarChart3, BookOpen, Brain, Building2, Calculator, Code2, Compass, Copy, Cpu, Dna, Droplets, FileBarChart2, FlaskConical, Globe, Heart, KeyRound, Landmark, Languages, Leaf, Lightbulb, ListChecks, MoreHorizontal, Mountain, Music, Palette, Pencil, Play, Puzzle, Pyramid, Radio, Rocket, Scale, Share2, Shield, Sparkles, Square, Trash2, Trophy, Microscope, Zap, ChevronLeft, ChevronRight, X, type LucideIcon } from '@/components/icons'
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

function StatusBadge({ item }: { item: LiveSessionItem }) {
  const active = item.status === 'ACTIVE'
  const lobby = isOpenLobby(item)
  const closed = item.status === 'CLOSED'
  const label = active ? tl("In corso") : lobby ? tl("Lobby aperta") : closed ? tl("Conclusa") : tl("Bozza")
  const style = active ? 'bg-emerald-500 text-white' : lobby ? 'bg-amber-500 text-white' : closed ? 'bg-[var(--ds-field-bg)] text-[var(--text-secondary)]' : 'bg-amber-400/20 text-amber-600'
  return (
    <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${style}`}>
      {(active || lobby) && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}{label}
    </span>
  )
}

/** One readable line about what the session contains: its first question or clue. */
function summary(item: LiveSessionItem) {
  const first = slidesOf(item).map((slide) => slideText(slide)).find((text) => text && text.trim())
  return first?.trim() || (isEscape(item) ? tl("Escape room senza indizi") : tl("Nessuna domanda ancora"))
}

/** Explorer card: cover with the topic emblem, title and one line of content. Everything else lives in the detail. */
function Card({ item, actions, onOpen }: { item: LiveSessionItem; actions: Actions; onOpen: (item: LiveSessionItem) => void }) {
  const { Icon, color, label } = sessionEmblem(item)
  const active = item.status === 'ACTIVE' || isOpenLobby(item)
  return (
    <article className="ui-card ui-card-interactive group relative overflow-hidden">
      <button type="button" onClick={() => onOpen(item)} aria-label={tl("Apri {0}", item.title)} className="block w-full text-left">
        <div className="relative aspect-video overflow-hidden" style={{ background: `linear-gradient(135deg, ${color} 0%, ${color}b3 55%, ${color}66 100%)` }}>
          <Icon className="absolute -bottom-6 -right-4 h-36 w-36 text-white/20" strokeWidth={1.2} aria-hidden />
          <span className="ds-squircle absolute bottom-4 left-4 flex h-12 w-12 items-center justify-center bg-white/20 text-white" aria-hidden><Icon className="h-6 w-6" strokeWidth={1.7} /></span>
          <span className={`absolute left-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white ${active ? 'bg-emerald-600' : 'bg-black/55'}`}>
            {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}
            {item.status === 'ACTIVE' ? tl("In corso") : isOpenLobby(item) ? tl("Lobby aperta") : item.status === 'CLOSED' ? tl("Conclusa") : tl("Bozza")}
          </span>
        </div>
        <div className="px-4 pb-4 pt-3">
          <h2 className="line-clamp-1 text-sm font-semibold text-[var(--text-primary)]" title={item.title}>{item.title}</h2>
          <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-[var(--text-secondary)]">{summary(item)}</p>
          <p className="mt-2 text-[11px] text-[var(--text-secondary)] opacity-80">{isEscape(item) ? 'Escape Room' : label} · {unit(item)}</p>
        </div>
      </button>
      <div className="absolute right-2 top-2 rounded-xl bg-black/30 text-white opacity-0 transition group-hover:opacity-100 focus-within:opacity-100 [&_button]:text-white">
        <ItemMenu item={item} actions={actions} />
      </div>
    </article>
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
            <h2 className="mt-1.5 break-words text-xl font-semibold text-[var(--text-primary)]">{item.title}</h2>
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
                    <span className="min-w-0 flex-1"><span className="block font-semibold text-[var(--text-secondary)]">{position + 1}</span><span className="line-clamp-2 font-semibold text-[var(--text-primary)]">{slideText(slide) || '…'}</span></span>
                  </button>
                </li>
              )
            })}
            {!slides.length && <li className="p-3 text-xs text-[var(--text-secondary)]">{tl("Nessuna slide")}</li>}
          </ol>

          <div className="flex min-w-0 flex-col gap-3 rounded-3xl bg-[var(--ds-well)] p-4">
            <div className="min-h-[18rem] flex-1 [&>div]:min-h-[18rem]">{current && <LiveSlidePreview slide={current} escape={isEscape(item)} />}</div>
            {slides.length > 1 && (
              <div className="flex items-center justify-center gap-3 text-xs font-semibold text-[var(--text-secondary)]">
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

/** Live activities of a session, laid out like the Video Lab library: one filter row, clean cards on a darker well; details open on click. */
export default function LiveSessionList({ items, ...actions }: { items: LiveSessionItem[]; onNew?: () => void } & Actions) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [type, setType] = useState<TypeFilter>('all')
  const [sort, setSort] = useState<SortKey>('recent')
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

  // Running sessions first, then drafts, then the archive; the chosen sort applies inside each group.
  const rank = (i: LiveSessionItem) => (i.status === 'ACTIVE' || isOpenLobby(i) ? 0 : i.status === 'DRAFT' ? 1 : 2)
  const ordered = [...visible].sort((a, b) => rank(a) - rank(b))
  const pending = items.filter(isPending)
  const chips: Array<[StatusFilter, string]> = [['all', tl("Tutte")], ['ACTIVE', tl("In corso")], ['DRAFT', tl("Bozze")], ['CLOSED', tl("Concluse")]]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <SearchPill value={query} placeholder={tl("Cerca per titolo, argomento o domanda")} aria-label={tl("Cerca sessioni")} onValueChange={setQuery} className="w-full sm:w-80" />
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={tl("Filtra per stato")}>
          {chips.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setStatus(id)} aria-pressed={status === id}
              className={`rounded-full px-3.5 py-2 text-xs font-semibold transition ${status === id ? 'ds-selected text-[var(--text-primary)]' : 'text-[var(--text-secondary)] hover:bg-black/5'}`}>
              {label} <span className="opacity-60">{counts[id]}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-2 sm:ml-auto">
          <Select density="compact" value={type} onChange={(event) => setType(event.target.value as TypeFilter)} aria-label={tl("Filtra per tipo")} className="w-auto text-xs font-semibold">
            <option value="all">{tl("Tutti i tipi")}</option><option value="slides">{tl("Quiz e sondaggi")}</option><option value="escape_room">Escape Room</option>
          </Select>
          <Select density="compact" value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label={tl("Ordina")} className="w-auto text-xs font-semibold">
            <option value="recent">{tl("Più recenti")}</option><option value="oldest">{tl("Più vecchie")}</option><option value="name">{tl("Nome A–Z")}</option>
          </Select>
        </div>
      </div>

      {pending.length > 0 && (
        <div role="alert" className="flex flex-col gap-3 rounded-2xl bg-amber-500/15 p-4 sm:flex-row sm:items-center">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-white"><Radio className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{pending.length === 1 ? tl("1 sessione è ancora attiva") : tl("{0} sessioni sono ancora attive", pending.length)}{tl(": gli studenti della classe la vedono.")}</p>
            <p className="truncate text-xs text-[var(--text-secondary)]">{pending.map(i => i.title).join(' · ')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {pending.map(item => (
              <button key={item.id} type="button" onClick={() => actions.onEnd(item)} className="flex items-center gap-1.5 rounded-xl bg-red-600 px-3 py-2 text-xs font-semibold text-white hover:bg-red-700">
                <Square className="h-3.5 w-3.5" />{isOpenLobby(item) ? tl("Chiudi lobby") : tl("Concludi")}{pending.length > 1 ? ` «${item.title.length > 18 ? item.title.slice(0, 18) + '…' : item.title}»` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {ordered.length > 0 ? (
        <div className="ds-well grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {ordered.map((item) => <Card key={item.id} item={item} actions={actions} onOpen={(i) => setPreviewId(i.id)} />)}
        </div>
      ) : (
        <div className="ds-well py-14 text-center text-[var(--text-secondary)]">
          <Zap className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm font-medium text-[var(--text-primary)]">{tl("Nessuna sessione corrisponde ai filtri")}</p>
          <button type="button" onClick={() => { setQuery(''); setStatus('all'); setType('all') }} className="mt-2 text-xs font-semibold text-[var(--app-accent,#7c3aed)] underline">{tl("Azzera i filtri")}</button>
        </div>
      )}

      {previewItem && <PreviewDialog item={previewItem} actions={actions} onClose={() => setPreviewId(null)} />}
    </div>
  )
}
