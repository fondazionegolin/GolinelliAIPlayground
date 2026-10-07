import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Atom, BarChart3, BookOpen, Brain, Building2, Calculator, Code2, Compass, Copy, Cpu, Dna, Droplets, FileBarChart2, FlaskConical, Globe, Heart, KeyRound, Landmark,
  Languages, Leaf, Lightbulb, ListChecks, Lock, MoreHorizontal, Mountain, Music, Palette, Pencil, Play, Puzzle, Pyramid, Radio, Rocket, Scale, Search, Share2, Shield,
  Sparkles, Trash2, Trophy, Microscope, Zap, ChevronDown,
  type LucideIcon,
} from '@/components/icons'

export interface LiveSessionItem {
  id: string
  title: string
  status: string // DRAFT | ACTIVE | CLOSED
  slides_count: number
  slides_json?: Array<object>
  created_at: string
  interaction_type?: 'slides' | 'escape_room'
}

type IconType = LucideIcon
// Platform palette (solid colours used across the app): logo violet and blue, brand pink, teal, indigo, amber.
const PALETTE = { violet: '#7b69c9', blue: '#3ea9f4', pink: '#e85c8d', teal: '#0d9488', indigo: '#5b5bd6', amber: '#d97706' } as const
const PALETTE_LIST = Object.values(PALETTE)
interface Theme { match: RegExp; icon: IconType; color: string; label: string }

// First matching rule wins: it picks an emblematic icon and colour from what the session is about.
const THEMES: Theme[] = [
  { match: /dna|cellul|genetic|biolog|evoluz|organism|batter|virus/i, icon: Dna, color: PALETTE.teal, label: 'Biologia' },
  { match: /anatom|corpo umano|cuore|salute|medic|benessere/i, icon: Heart, color: PALETTE.pink, label: 'Salute' },
  { match: /microscop|laboratorio|esperiment|scienz/i, icon: Microscope, color: PALETTE.teal, label: 'Laboratorio' },
  { match: /chimic|element|molecol|tavola periodica|reazion/i, icon: FlaskConical, color: PALETTE.violet, label: 'Chimica' },
  { match: /fisic|energia|forza|elettric|magnet|atomo|quantistic/i, icon: Atom, color: PALETTE.blue, label: 'Fisica' },
  { match: /matemat|algebra|geometr|frazion|equazion|statistic|calcol/i, icon: Calculator, color: PALETTE.amber, label: 'Matematica' },
  { match: /egitt|piramid|faraon/i, icon: Pyramid, color: PALETTE.amber, label: 'Antico Egitto' },
  { match: /stori|medioev|roman|antic|guerra|rinascim|rivoluzion|impero|archivio/i, icon: Landmark, color: PALETTE.amber, label: 'Storia' },
  { match: /montagn|vulcan|terremot|geolog/i, icon: Mountain, color: PALETTE.teal, label: 'Terra' },
  { match: /geograf|continent|mappa|paes|territor|mondo/i, icon: Globe, color: PALETTE.blue, label: 'Geografia' },
  { match: /acqua|mare|ocean|fium|idric/i, icon: Droplets, color: PALETTE.blue, label: 'Acqua' },
  { match: /ambient|ecolog|sostenib|natura|pianta|foresta|biodivers|clima/i, icon: Leaf, color: PALETTE.teal, label: 'Ambiente' },
  { match: /spazio|pianet|galass|astro|universo|razzo|luna\b|sole\b/i, icon: Rocket, color: PALETTE.indigo, label: 'Spazio' },
  { match: /intelligenza artificiale|machine learning|chatbot|prompt|\bai\b|neural|llm/i, icon: Brain, color: PALETTE.violet, label: 'Intelligenza artificiale' },
  { match: /codice|coding|program|algoritm|python|javascript|informatic|software|app\b|digital/i, icon: Code2, color: PALETTE.indigo, label: 'Informatica' },
  { match: /robot|elettronic|micro:?bit|arduino|sensor|hardware/i, icon: Cpu, color: PALETTE.blue, label: 'Tecnologia' },
  { match: /sicurezza|privacy|cyber|difesa|protezion/i, icon: Shield, color: PALETTE.indigo, label: 'Sicurezza' },
  { match: /citt[àa]|urban|resilien|architett|edific|territorio/i, icon: Building2, color: PALETTE.blue, label: 'Città' },
  { match: /business|impresa|canvas|startup|marketing|mercato|idea|innovaz|progett|management|project/i, icon: Lightbulb, color: PALETTE.amber, label: 'Innovazione' },
  { match: /diritt|legge|costituz|cittadinanz|etica|giustizia|regole/i, icon: Scale, color: PALETTE.indigo, label: 'Cittadinanza' },
  { match: /ingles|english|francese|spagnol|tedesco|lingua|lingue/i, icon: Languages, color: PALETTE.pink, label: 'Lingue' },
  { match: /italiano|letteratur|poesi|grammatic|racconto|scrittura|romanzo|libro|lettura/i, icon: BookOpen, color: PALETTE.pink, label: 'Letteratura' },
  { match: /music|canzone|ritmo|strument/i, icon: Music, color: PALETTE.pink, label: 'Musica' },
  { match: /arte|pittur|disegn|creativ|design|color|illustraz/i, icon: Palette, color: PALETTE.pink, label: 'Arte' },
  { match: /sport|olimpi|gara|campion|movimento/i, icon: Trophy, color: PALETTE.amber, label: 'Sport' },
  { match: /viaggio|esplora|avventur|mistero|indagine|caccia/i, icon: Compass, color: PALETTE.teal, label: 'Esplorazione' },
  { match: /formazione|training|trainer|didattic|lezione|corso|webinar/i, icon: Sparkles, color: PALETTE.violet, label: 'Formazione' },
  { match: /gioco|quiz|sfida|puzzle|enigm/i, icon: Puzzle, color: PALETTE.violet, label: 'Gioco' },
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
    : { Icon: hash(title) % 2 ? ListChecks : BarChart3, color, label: 'Quiz' }
}

function Emblem({ item, size }: { item: LiveSessionItem; size: 'large' | 'tile' }) {
  const { Icon, color: background } = sessionEmblem(item)
  // Solid platform colour on a squircle: the shape and the flat colour carry the identity, the icon stays quiet.
  const large = size === 'large'
  return (
    <span className={`ds-squircle flex shrink-0 items-center justify-center text-white ${large ? 'h-16 w-16' : 'h-11 w-11'}`} style={{ background }} aria-hidden>
      <Icon className={large ? 'h-7 w-7' : 'h-5 w-5'} strokeWidth={1.7} />
    </span>
  )
}

interface Actions {
  onOpen: (item: LiveSessionItem) => void
  onShare: (item: LiveSessionItem) => void
  onEdit: (item: LiveSessionItem) => void
  onDuplicate: (item: LiveSessionItem) => void
  onDelete: (item: LiveSessionItem) => void
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
    { label: 'Link pubblico', icon: Share2, run: () => actions.onShare(item), hidden: item.status === 'CLOSED' },
    { label: 'Modifica', icon: Pencil, run: () => actions.onEdit(item), hidden: !(item.status === 'DRAFT' && item.interaction_type !== 'escape_room') },
    { label: 'Report', icon: FileBarChart2, run: () => actions.onOpen(item), hidden: item.status === 'DRAFT' || item.status === 'CLOSED' },
    { label: 'Duplica', icon: Copy, run: () => actions.onDuplicate(item) },
    { label: 'Elimina', icon: Trash2, run: () => actions.onDelete(item), danger: true, hidden: item.status === 'ACTIVE' },
  ]
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-label="Altre azioni" aria-expanded={open}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
        <MoreHorizontal className="h-5 w-5" />
      </button>
      {open && (
        <div className="ds-popover absolute right-0 top-full z-30 mt-1 w-48 rounded-2xl p-1.5 shadow-xl" role="menu">
          {entries.filter((entry) => !entry.hidden).map((entry) => (
            <button key={entry.label} type="button" role="menuitem" onClick={() => { setOpen(false); entry.run() }}
              className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium transition hover:bg-slate-100 ${entry.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700'}`}>
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

function Card({ item, actions }: { item: LiveSessionItem; actions: Actions }) {
  const active = item.status === 'ACTIVE'
  const escape = item.interaction_type === 'escape_room'
  const TypeIcon = escape ? Lock : BarChart3
  return (
    <article className={`ui-card flex flex-col gap-4 p-4 transition hover:-translate-y-0.5 hover:shadow-lg ${active ? 'ring-2 ring-emerald-500/60' : ''}`}>
      <div className="flex items-start gap-3.5">
        <Emblem item={item} size="large" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600"><TypeIcon className="h-3 w-3" />{escape ? 'Escape Room' : 'Quiz'}</span>
            <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${active ? 'bg-emerald-500 text-white' : 'bg-amber-100 text-amber-700'}`}>
              {active && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}{active ? 'In corso' : 'Bozza'}
            </span>
          </div>
          <h3 className="mt-1.5 line-clamp-2 break-words text-base font-bold leading-snug text-slate-900" title={item.title}>{item.title}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{unit(item)} <span className="px-1 text-slate-300">·</span> {date(item.created_at)}</p>
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2">
        <button type="button" onClick={() => actions.onOpen(item)}
          className={`flex h-10 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-bold transition ${active ? 'bg-emerald-600 text-white hover:bg-emerald-700' : 'bg-[var(--app-accent,#7c3aed)] text-white hover:opacity-90'}`}>
          {active ? <><Radio className="h-4 w-4" /> Pannello live</> : <><Play className="h-4 w-4" /> Avvia</>}
        </button>
        <ItemMenu item={item} actions={actions} />
      </div>
    </article>
  )
}

function ArchiveRow({ item, actions }: { item: LiveSessionItem; actions: Actions }) {
  const { label } = sessionEmblem(item)
  return (
    <div className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition hover:bg-slate-100/70">
      <Emblem item={item} size="tile" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900" title={item.title}>{item.title}</p>
        <p className="truncate text-xs text-slate-500">{item.interaction_type === 'escape_room' ? 'Escape Room' : 'Quiz'} · {label} · {unit(item)} · {date(item.created_at)}</p>
      </div>
      <button type="button" onClick={() => actions.onOpen(item)} className="hidden h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-bold text-slate-600 transition hover:bg-slate-200/70 sm:flex">
        <FileBarChart2 className="h-3.5 w-3.5" /> Report
      </button>
      <ItemMenu item={item} actions={actions} />
    </div>
  )
}

type StatusFilter = 'all' | 'ACTIVE' | 'DRAFT' | 'CLOSED'
type TypeFilter = 'all' | 'slides' | 'escape_room'
type SortKey = 'recent' | 'oldest' | 'name'

/** Live activities of a session: grouped by state, searchable, each one recognisable by its emblem. */
export default function LiveSessionList({ items, ...actions }: { items: LiveSessionItem[] } & Actions) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [type, setType] = useState<TypeFilter>('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [showAllArchive, setShowAllArchive] = useState(false)

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
      (!needle || item.title.toLowerCase().includes(needle) || sessionEmblem(item).label.toLowerCase().includes(needle)))
    const time = (i: LiveSessionItem) => new Date(i.created_at).getTime()
    return list.sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, 'it') : sort === 'oldest' ? time(a) - time(b) : time(b) - time(a))
  }, [items, query, status, type, sort])

  const active = visible.filter((i) => i.status === 'ACTIVE')
  const drafts = visible.filter((i) => i.status === 'DRAFT')
  const archive = visible.filter((i) => i.status === 'CLOSED')
  const archiveShown = showAllArchive || archive.length <= 8 ? archive : archive.slice(0, 8)

  const chips: Array<[StatusFilter, string]> = [['all', 'Tutte'], ['ACTIVE', 'In corso'], ['DRAFT', 'Bozze'], ['CLOSED', 'Archivio']]

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <label className="ui-search flex h-10 min-w-[12rem] flex-1 items-center gap-2 px-3 sm:max-w-xs">
          <Search className="h-4 w-4 shrink-0 text-slate-400" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca per titolo o argomento" aria-label="Cerca sessioni"
            className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400" />
        </label>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtra per stato">
          {chips.map(([id, label]) => (
            <button key={id} type="button" onClick={() => setStatus(id)} aria-pressed={status === id}
              className={`rounded-full px-3.5 py-1.5 text-xs font-bold transition ${status === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {label} <span className={status === id ? 'text-white/60' : 'text-slate-400'}>{counts[id]}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <select value={type} onChange={(event) => setType(event.target.value as TypeFilter)} aria-label="Filtra per tipo" className="h-9 rounded-xl border-0 bg-slate-100 px-3 text-xs font-semibold text-slate-700">
            <option value="all">Tutti i tipi</option><option value="slides">Quiz e sondaggi</option><option value="escape_room">Escape Room</option>
          </select>
          <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)} aria-label="Ordina" className="h-9 rounded-xl border-0 bg-slate-100 px-3 text-xs font-semibold text-slate-700">
            <option value="recent">Più recenti</option><option value="oldest">Più vecchie</option><option value="name">Nome A–Z</option>
          </select>
        </div>
      </div>

      {active.length > 0 && (
        <Section title="In corso" hint="Sessioni live attive adesso" count={active.length} tone="emerald">
          <Grid>{active.map((item) => <Card key={item.id} item={item} actions={actions} />)}</Grid>
        </Section>
      )}
      {drafts.length > 0 && (
        <Section title="Da preparare" hint="Controlla i contenuti e avvia quando sei pronto" count={drafts.length} tone="violet">
          <Grid>{drafts.map((item) => <Card key={item.id} item={item} actions={actions} />)}</Grid>
        </Section>
      )}
      {archive.length > 0 && (
        <Section title="Archivio" hint="Sessioni concluse: report e riutilizzo" count={archive.length} tone="slate">
          <div className="ui-card divide-y divide-slate-100/60 p-1.5">
            {archiveShown.map((item) => <ArchiveRow key={item.id} item={item} actions={actions} />)}
          </div>
          {archive.length > 8 && (
            <button type="button" onClick={() => setShowAllArchive((value) => !value)} className="mx-auto mt-3 flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold text-slate-500 transition hover:bg-slate-100">
              {showAllArchive ? 'Mostra meno' : `Mostra tutte (${archive.length})`}<ChevronDown className={`h-3.5 w-3.5 transition ${showAllArchive ? 'rotate-180' : ''}`} />
            </button>
          )}
        </Section>
      )}
      {visible.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 py-14 text-center text-slate-400">
          <Zap className="mx-auto mb-2 h-8 w-8 opacity-40" />
          <p className="text-sm font-medium text-slate-600">Nessuna sessione corrisponde ai filtri</p>
          <button type="button" onClick={() => { setQuery(''); setStatus('all'); setType('all') }} className="mt-2 text-xs font-bold text-[var(--app-accent,#7c3aed)] underline">Azzera i filtri</button>
        </div>
      )}
    </div>
  )
}

function Section({ title, hint, count, tone, children }: { title: string; hint: string; count: number; tone: 'emerald' | 'violet' | 'slate'; children: React.ReactNode }) {
  const badge = tone === 'emerald' ? 'bg-emerald-100 text-emerald-700' : tone === 'violet' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'
  return (
    <section>
      <div className="mb-3 flex items-baseline gap-3 px-1">
        <h2 className="text-sm font-black uppercase tracking-[0.14em] text-slate-700">{title}</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${badge}`}>{count}</span>
        <p className="hidden text-xs text-slate-400 sm:block">{hint}</p>
      </div>
      {children}
    </section>
  )
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
}
