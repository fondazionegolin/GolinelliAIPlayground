import { Fragment, useEffect, useRef, useState, type ClipboardEvent, type DragEvent } from 'react'
import { Check, ChevronDown, ImageIcon, Loader2, Plus, Tags, X } from '@/components/icons'
import { boardsApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { tl } from '@/i18n/tl'

/** kind=external: a person without a platform account, named by whoever creates the task. A freshly typed one has id `new:<name>`. */
export type Member = { kind: 'teacher' | 'student' | 'external'; id: string; name: string; owner?: boolean; direct?: boolean }

export const memberKey = (person: Pick<Member, 'kind' | 'id'>) => `${person.kind}-${person.id}`
export const isNewExternal = (person: Pick<Member, 'kind' | 'id'>) => person.kind === 'external' && person.id.startsWith('new:')
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'

const KIND_LABEL: Record<Member['kind'], string> = { teacher: tl("docente"), student: tl("studente"), external: tl("esterno") }
const AVATAR_STYLE: Record<Member['kind'], string> = {
  teacher: 'bg-slate-800 text-white',
  student: 'bg-teal-100 text-teal-800',
  external: 'bg-amber-100 text-amber-800',
}

export function Avatar({ person, size = 'sm', ringClass = 'ring-white' }: { person: Member; size?: 'sm' | 'md'; ringClass?: string }) {
  const dim = size === 'md' ? 'h-7 w-7 text-[10px]' : 'h-6 w-6 text-[9px]'
  return (
    <span className={`group/av relative inline-flex ${dim} shrink-0 items-center justify-center rounded-full font-semibold ring-2 ${ringClass} ${AVATAR_STYLE[person.kind]}`} aria-label={`${person.name} (${KIND_LABEL[person.kind]})`}>
      {initials(person.name)}
      <span role="tooltip" className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[11px] font-semibold text-white opacity-0 shadow-[var(--ds-shadow-1)] transition-opacity group-hover/av:opacity-100">{person.name} · {KIND_LABEL[person.kind]}</span>
    </span>
  )
}

/** Every responsible person, never truncated: the card must show who is on it at a glance. */
export function AssigneeStack({ people, size = 'sm' }: { people: Member[]; size?: 'sm' | 'md' }) {
  if (!people.length) return null
  return (
    <div className="ml-auto flex flex-wrap justify-end gap-1" aria-label={tl("Responsabili: {0}", people.map((person) => person.name).join(', '))}>
      {people.map((person) => <Avatar key={memberKey(person)} person={person} size={size} />)}
    </div>
  )
}

const IMAGE_MARKDOWN = /!\[([^\]]*)\]\(([^)\s]+)\)/g
const safeImageUrl = (url: string) => url.startsWith('/uploads/') || /^https:\/\//i.test(url)

/** Task description: plain text with line breaks and pasted pictures (markdown image links). */
export function DescriptionView({ text, compact = false }: { text: string; compact?: boolean }) {
  const parts: Array<{ kind: 'text' | 'image'; value: string; alt?: string }> = []
  let last = 0
  for (const match of text.matchAll(IMAGE_MARKDOWN)) {
    if (match.index! > last) parts.push({ kind: 'text', value: text.slice(last, match.index) })
    if (safeImageUrl(match[2])) parts.push({ kind: 'image', value: match[2], alt: match[1] })
    last = match.index! + match[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', value: text.slice(last) })
  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {parts.map((part, index) => part.kind === 'image'
        ? <img key={index} src={part.value} alt={part.alt || tl("Immagine del task")} loading="lazy" className={`rounded-lg object-contain ${compact ? 'max-h-32' : 'max-h-80'} max-w-full bg-slate-100`} />
        : part.value.trim() ? <p key={index} className="whitespace-pre-wrap break-words">{part.value.trim()}</p> : <Fragment key={index} />)}
    </div>
  )
}

export const descriptionHasContent = (text?: string | null) => Boolean(text && text.replace(IMAGE_MARKDOWN, (_m, _a, url) => (safeImageUrl(url) ? 'x' : '')).trim())

/** A description is free text plus pasted pictures (markdown links): the editor shows them apart so pictures are visible at once. */
export type DescriptionImage = { url: string; alt: string }
export function splitDescription(text: string): { text: string; images: DescriptionImage[] } {
  const images: DescriptionImage[] = []
  const rest = text.replace(IMAGE_MARKDOWN, (whole, alt, url) => {
    if (!safeImageUrl(url)) return whole
    images.push({ url, alt })
    return ''
  })
  return { text: rest.replace(/\n{3,}/g, '\n\n').trim(), images }
}
export const joinDescription = (text: string, images: DescriptionImage[]) =>
  [text.trim(), ...images.map((image) => `![${image.alt || 'immagine'}](${image.url})`)].filter(Boolean).join('\n\n')

/** Textarea that accepts pasted (or dropped) pictures: they are uploaded and inserted as markdown at the caret. */
export function DescriptionEditor({ boardId, value, onChange, onBlur, onImage, rows = 4, autoFocus = false, placeholder, className = '' }: {
  boardId: string
  value: string
  onChange: (value: string) => void
  onBlur?: (value: string) => void
  /** When set, an uploaded picture goes here (shown apart) instead of being written into the text. */
  onImage?: (image: DescriptionImage) => void
  rows?: number
  autoFocus?: boolean
  placeholder?: string
  className?: string
}) {
  const { toast } = useToast()
  const ref = useRef<HTMLTextAreaElement>(null)
  const latest = useRef(value)
  latest.current = value
  const [uploading, setUploading] = useState(0)

  const insertImages = async (files: File[], caret: number) => {
    setUploading((count) => count + files.length)
    let position = caret
    for (const file of files) {
      try {
        const { data } = await boardsApi.uploadImage(boardId, file)
        if (onImage) { onImage({ url: data.url, alt: tl("immagine") }); continue }
        const snippet = `${position > 0 && !latest.current.slice(0, position).endsWith('\n') ? '\n' : ''}![${tl("immagine")}](${data.url})\n`
        const next = latest.current.slice(0, position) + snippet + latest.current.slice(position)
        latest.current = next
        onChange(next)
        position += snippet.length
      } catch (error: any) {
        toast({ title: tl("Immagine non caricata"), description: error?.response?.data?.detail || tl("Riprova tra poco."), variant: 'destructive' })
      } finally {
        setUploading((count) => count - 1)
      }
    }
  }
  const imagesFromItems = (list: DataTransferItemList | undefined) => Array.from(list || [])
    .map((item) => (item.kind === 'file' ? item.getAsFile() : null))
    .filter((file): file is File => Boolean(file && file.type.startsWith('image/')))
  const imagesFromFiles = (list: FileList | undefined) => Array.from(list || []).filter((file) => file.type.startsWith('image/'))

  return (
    <div className="relative">
      <textarea
        ref={ref}
        autoFocus={autoFocus}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onBlur?.(event.target.value)}
        onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => {
          const files = imagesFromItems(event.clipboardData?.items)
          if (!files.length) return
          event.preventDefault()
          void insertImages(files, event.currentTarget.selectionStart)
        }}
        onDrop={(event: DragEvent<HTMLTextAreaElement>) => {
          const files = imagesFromFiles(event.dataTransfer?.files)
          if (!files.length) return
          event.preventDefault()
          void insertImages(files, event.currentTarget.selectionStart)
        }}
        className={className}
      />
      <p className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
        {uploading > 0 ? <><Loader2 className="h-3 w-3 animate-spin" /> {tl("Carico l’immagine…")}</> : <><ImageIcon className="h-3 w-3" /> {tl("Incolla (Ctrl+V) o trascina un’immagine per inserirla")}</>}
      </p>
    </div>
  )
}

/** People who can be responsible for a task: board members plus anyone named by hand (no platform account needed). */
export function AssigneePicker({ members, value, onChange }: { members: Member[]; value: Member[]; onChange: (next: Member[]) => void }) {
  const [name, setName] = useState('')
  const selected = (person: Member) => value.some((item) => item.kind === person.kind && item.id === person.id)
  const options = [...members, ...value.filter((item) => !members.some((member) => member.kind === item.kind && member.id === item.id))]
  const toggle = (person: Member) => onChange(selected(person) ? value.filter((item) => !(item.kind === person.kind && item.id === person.id)) : [...value, person])
  const addExternal = () => {
    const clean = name.replace(/\s+/g, ' ').trim()
    if (!clean) return
    const existing = options.find((person) => person.kind === 'external' && person.name.toLowerCase() === clean.toLowerCase())
    if (existing) { if (!selected(existing)) onChange([...value, existing]) } else onChange([...value, { kind: 'external', id: `new:${clean}`, name: clean }])
    setName('')
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {options.map((person) => {
          const active = selected(person)
          return (
            <button key={memberKey(person)} type="button" aria-pressed={active} aria-label={person.name} onClick={() => toggle(person)}
              className={`rounded-full transition ${active ? '' : 'opacity-45 hover:opacity-100'}`}>
              <Avatar person={person} size="md" ringClass={active ? 'ring-slate-900 dark:ring-white' : 'ring-transparent'} />
            </button>
          )
        })}
        {options.length === 0 && <p className="text-xs text-slate-400">{tl("Nessuno con cui condividere: aggiungi un nome qui sotto.")}</p>}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addExternal() } }}
          placeholder={tl("Persona esterna: scrivi un nome")}
          aria-label={tl("Nome di una persona esterna")}
          className="ds-field h-9 min-w-0 flex-1 rounded-[var(--ds-field-radius)] px-3 text-xs"
        />
        <button type="button" onClick={addExternal} disabled={!name.trim()} aria-label={tl("Aggiungi")} className="ds-control inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-700 disabled:opacity-40">
          <Plus className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

/** Labels collapse into one dropdown: the chosen ones stay visible beside the icon, the rest open on demand. */
export function LabelDropdown({ labels, value, canEdit, onChange }: { labels: Array<{ id: string; name: string; color: string }>; value: string[]; canEdit: boolean; onChange: (next: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false) }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey, true) }
  }, [open])
  const chosen = labels.filter((label) => value.includes(label.id))
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id])
  return (
    <div ref={ref} className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {canEdit && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="listbox" aria-label={tl("Etichette")} title={tl("Etichette")}
            className="ds-field inline-flex h-9 items-center gap-1 rounded-full px-3 text-slate-600">
            <Tags className="h-4 w-4" /><ChevronDown className={`h-3.5 w-3.5 transition ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
        {chosen.map((label) => (
          <span key={label.id} className="rounded-full px-2.5 py-1 text-xs font-semibold text-white" style={{ backgroundColor: label.color }}>{label.name}</span>
        ))}
        {!canEdit && chosen.length === 0 && <p className="text-sm text-slate-400">—</p>}
      </div>
      {open && (
        <div role="listbox" aria-multiselectable="true" className="ds-popover absolute left-0 top-full z-20 mt-1.5 max-h-56 min-w-52 overflow-y-auto rounded-[var(--ds-radius-card)] p-1.5">
          {labels.length === 0 && <p className="px-2 py-1.5 text-xs text-slate-400">{tl("Nessuna etichetta nella board.")}</p>}
          {labels.map((label) => {
            const active = value.includes(label.id)
            return (
              <button key={label.id} type="button" role="option" aria-selected={active} onClick={() => toggle(label.id)}
                className={`flex min-h-9 w-full items-center gap-2 rounded-[var(--control-radius)] px-3 py-1.5 text-left text-xs font-semibold text-[var(--text-primary)] transition-colors ${active ? 'ds-selected' : 'hover:bg-[var(--ds-control-hover)]'}`}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: label.color }} />
                <span className="flex-1">{label.name}</span>
                {active && <Check className="h-3.5 w-3.5" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const COLUMN_SUGGESTIONS = [tl("Da fare"), tl("In corso"), tl("In revisione"), tl("Bloccato"), tl("Fatto")]

/** Last tile of the board: one click opens a name field (Enter adds), with one-tap suggestions. */
export function AddColumnTile({ existing, disabled, onAdd }: { existing: string[]; disabled: boolean; onAdd: (label: string) => void }) {
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const taken = new Set(existing.map((item) => item.toLowerCase()))
  const submit = (value: string) => {
    const clean = value.replace(/\s+/g, ' ').trim()
    if (!clean) return
    onAdd(clean)
    setLabel('')
    setOpen(false)
  }
  if (!open) {
    return (
      <button type="button" disabled={disabled} onClick={() => setOpen(true)}
        className="flex min-h-[72px] w-full shrink-0 items-center justify-center gap-2 rounded-[var(--ds-radius-panel)] bg-white/60 text-sm font-semibold text-slate-500 transition hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40 lg:h-fit lg:w-[260px] lg:min-h-[56px]"
        title={disabled ? tl("Numero massimo di colonne raggiunto") : tl("Aggiungi una colonna")}>
        <Plus className="h-5 w-5" /> {tl("Aggiungi colonna")}
      </button>
    )
  }
  return (
    <div className="ds-panel w-full shrink-0 space-y-2 rounded-[var(--ds-radius-panel)] p-3 lg:h-fit lg:w-[260px]">
      <input
        autoFocus
        value={label}
        maxLength={40}
        onChange={(event) => setLabel(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit(label) } if (event.key === 'Escape') { setOpen(false); setLabel('') } }}
        placeholder={tl("Nome della colonna")}
        aria-label={tl("Nome della nuova colonna")}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:ring-2 focus:ring-slate-300"
      />
      <div className="flex flex-wrap gap-1">
        {COLUMN_SUGGESTIONS.filter((item) => !taken.has(item.toLowerCase())).map((item) => (
          <button key={item} type="button" onClick={() => submit(item)} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 shadow-[var(--ds-shadow-1)] hover:text-slate-900">+ {item}</button>
        ))}
      </div>
      <div className="flex justify-end gap-1.5">
        <button type="button" onClick={() => { setOpen(false); setLabel('') }} className="inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-500 hover:bg-white"><X className="h-3.5 w-3.5" /> {tl("Annulla")}</button>
        <button type="button" disabled={!label.trim()} onClick={() => submit(label)} className="inline-flex h-8 items-center gap-1 rounded-full border border-transparent bg-[image:var(--selection-active-bg)] px-3 text-xs font-semibold text-[var(--selection-active-text)] disabled:opacity-40"><Check className="h-3.5 w-3.5" /> {tl("Aggiungi")}</button>
      </div>
    </div>
  )
}

export const assigneeFields = (people: Member[]) =>
  people.map((person) => isNewExternal(person) ? { kind: 'external' as const, name: person.name } : { kind: person.kind, id: person.id })
