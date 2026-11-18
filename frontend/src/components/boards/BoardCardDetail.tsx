import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CalendarRange, Trash2, X } from '@/components/icons'
import type { BoardCardFields } from '@/lib/api'
import { formatSprintDates } from './BoardTimeline'
import type { BoardLabel } from './BoardLabelsDialog'
import type { BoardSprint } from './BoardSprintsDialog'
import { Select } from '@/design'
import { Avatar, AssigneePicker, DescriptionEditor, LabelDropdown, assigneeFields, joinDescription, splitDescription, type DescriptionImage, type Member } from './BoardCardParts'
import { tl } from '@/i18n/tl'

type Column = { id: string; label: string; hint: string; color: string }
type Priority = 'alta' | 'media' | 'bassa'
export type DetailCard = {
  id: string
  column_id: string
  title: string
  description?: string | null
  color?: string | null
  created_by_display_name?: string | null
  last_actor_display_name?: string | null
  labels?: string[]
  assignees?: Member[]
  card_type?: 'epic' | 'story' | 'task' | null
  priority?: Priority | null
  story_points?: number | null
  parent_card_id?: string | null
  sprint_id?: string | null
}

const CARD_TYPE_LABEL = { epic: 'Epic', story: 'Story', task: 'Task' } as const
const PRIORITY_LABEL: Record<Priority, string> = { alta: tl("Alta"), media: tl("Media"), bassa: tl("Bassa") }
const sectionTitle = 'text-[10px] font-black uppercase tracking-wide text-slate-400'
const fieldClass = 'mt-1.5 h-10 text-sm'

/** Task detail where every field is edited in place and saved as soon as it changes: no separate edit mode. */
export default function BoardCardDetail({ boardId, card, labels, members, sprints, cards, canEdit, showPoints, colorControl, onPatch, onDelete, deletePending, onOpenCard, onClose }: {
  boardId: string
  card: DetailCard
  columns?: Column[]
  labels: BoardLabel[]
  members: Member[]
  sprints: BoardSprint[]
  cards: DetailCard[]
  canEdit: boolean
  showPoints: boolean
  colorControl: ReactNode
  onPatch: (fields: BoardCardFields) => void
  onMove?: (columnId: string) => void
  onDelete: () => void
  deletePending: boolean
  onOpenCard: (id: string) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(card.title)
  const [text, setText] = useState(() => splitDescription(card.description || '').text)
  const [images, setImages] = useState<DescriptionImage[]>(() => splitDescription(card.description || '').images)
  const editingText = useRef(false)
  const [assignees, setAssignees] = useState<Member[]>(card.assignees || [])
  const [points, setPoints] = useState(card.story_points ? String(card.story_points) : '')
  const typing = useRef(false)
  const [preview, setPreview] = useState<number | null>(null)

  useEffect(() => { setTitle(card.title) }, [card.id, card.title])
  useEffect(() => {
    if (editingText.current) return
    const parts = splitDescription(card.description || '')
    setText(parts.text)
    setImages(parts.images)
  }, [card.id, card.description])
  useEffect(() => { setAssignees(card.assignees || []) }, [card.id, JSON.stringify(card.assignees || [])])
  useEffect(() => { setPoints(card.story_points ? String(card.story_points) : '') }, [card.id, card.story_points])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (preview !== null) { setPreview(null); return }
      if (!typing.current) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, preview])

  const parent = card.parent_card_id ? cards.find((item) => item.id === card.parent_card_id) : null
  const children = cards.filter((item) => item.parent_card_id === card.id)
  const sprint = card.sprint_id ? sprints.find((item) => item.id === card.sprint_id) : undefined
  const sprintCode = sprint ? `S${sprints.indexOf(sprint) + 1}` : undefined
  const cardLabels = (card.labels || []).filter((id) => labels.some((label) => label.id === id))

  const commitTitle = () => {
    const clean = title.trim()
    if (!clean) { setTitle(card.title); return }
    if (clean !== card.title) onPatch({ title: clean })
  }
  const saveDescription = (nextText: string, nextImages: DescriptionImage[]) => {
    const next = joinDescription(nextText, nextImages)
    if (next !== (card.description || '').trim()) onPatch({ description: next })
  }
  const commitText = (value: string) => {
    editingText.current = false
    typing.current = false
    saveDescription(value, images)
  }
  const addImage = (image: DescriptionImage) => {
    const next = [...images, image]
    setImages(next)
    saveDescription(text, next)
  }
  const removeImage = (index: number) => {
    const next = images.filter((_, i) => i !== index)
    setImages(next)
    saveDescription(text, next)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="ds-popover flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-[var(--ds-radius-card)] sm:max-h-[86vh] sm:rounded-[var(--ds-radius-card)]" role="dialog" aria-modal="true" aria-labelledby="board-card-title">
        <div className="flex items-start gap-3 px-6 pb-3 pt-5">
          <span className="mt-4 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: card.color || '#d4d4d4' }} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-wide">
              {card.card_type && <span className={`rounded-full px-2 py-0.5 ${card.card_type === 'epic' ? 'bg-violet-100 text-violet-700' : card.card_type === 'story' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>{CARD_TYPE_LABEL[card.card_type]}</span>}
              {sprint && <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/[0.06] px-2 py-0.5 text-slate-600"><CalendarRange className="h-3 w-3" />{sprintCode} · {sprint.name}{formatSprintDates(sprint) ? ` · ${formatSprintDates(sprint)}` : ''}</span>}
            </div>
            {canEdit ? (
              <input
                id="board-card-title"
                value={title}
                maxLength={220}
                onChange={(event) => setTitle(event.target.value)}
                onFocus={() => { typing.current = true }}
                onBlur={() => { typing.current = false; commitTitle() }}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                aria-label={tl("Titolo del task")}
                data-field-appearance="plain"
                className="mt-1 w-full rounded-lg border-0 bg-transparent px-1 py-0.5 -mx-1 text-xl font-black leading-7 text-slate-900 outline-none hover:bg-slate-900/[0.04] focus:bg-slate-900/[0.05] focus:ring-2 focus:ring-slate-300"
              />
            ) : <h3 id="board-card-title" className="mt-1 text-xl font-black leading-7 text-slate-900">{card.title}</h3>}
            {parent && <button type="button" onClick={() => onOpenCard(parent.id)} className="mt-1 max-w-full truncate text-left text-xs font-bold text-slate-500 hover:text-slate-800 hover:underline">↳ Epic: {parent.title}</button>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={tl("Chiudi")}><X className="h-5 w-5" /></button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 items-start gap-6 overflow-y-auto overflow-x-hidden px-6 pb-6 pt-1 md:grid-cols-[minmax(0,1fr)_240px]">
          {/* Content first: attached pictures, then the description on a dark field. */}
          <div className="flex min-w-0 flex-col gap-4">
            {images.length > 0 && (
              <section aria-label={tl("Immagini allegate")}>
                <h4 className={sectionTitle}>{tl("Immagini")} · {images.length}</h4>
                <ul className="mt-1.5 flex flex-wrap gap-2">
                  {images.map((image, index) => (
                    <li key={`${image.url}-${index}`} className="group/img relative h-28 w-40 overflow-hidden rounded-xl bg-[var(--ds-well)]">
                      <button type="button" onClick={() => setPreview(index)} className="block h-full w-full" aria-label={tl("Apri l’immagine")}>
                        <img src={image.url} alt={image.alt || tl("Immagine del task")} loading="lazy" className="h-full w-full object-cover" />
                      </button>
                      {canEdit && (
                        <button type="button" onClick={() => removeImage(index)} aria-label={tl("Rimuovi l’immagine")}
                          className="absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-900/80 text-white opacity-0 transition hover:bg-slate-900 group-hover/img:opacity-100 focus-visible:opacity-100">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h4 className={sectionTitle}>{tl("Descrizione")}</h4>
              {canEdit ? (
                <div className="mt-1.5">
                  <DescriptionEditor boardId={boardId} value={text}
                    onChange={(value) => { editingText.current = true; typing.current = true; setText(value) }}
                    onBlur={commitText} onImage={addImage} rows={10}
                    placeholder={tl("Aggiungi indicazioni, incolla un’immagine…")}
                    className="ds-field !bg-[var(--ds-well)] block w-full resize-y rounded-[var(--ds-field-radius)] px-4 py-3 text-sm leading-6 focus:!bg-[var(--ds-well)]" />
                </div>
              ) : (
                <p className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-7 text-slate-700">{text || <span className="text-slate-400">{tl("Nessuna descrizione.")}</span>}</p>
              )}
            </section>
          </div>

          <aside className="min-w-0 space-y-5">
            <section>
              <h4 className={sectionTitle}>{tl("Responsabili")}</h4>
              <div className="mt-2">
                {canEdit
                  ? <AssigneePicker members={members} value={assignees} onChange={(next) => { setAssignees(next); onPatch({ assignees: assigneeFields(next) }) }} />
                  : (card.assignees || []).length
                    ? <ul className="flex flex-wrap gap-1.5">{(card.assignees || []).map((person) => <li key={`${person.kind}-${person.id}`}><Avatar person={person} size="md" /></li>)}</ul>
                    : <p className="text-sm text-slate-400">{tl("Nessuno assegnato.")}</p>}
              </div>
            </section>

            {(labels.length > 0 || cardLabels.length > 0) && (
              <section>
                <h4 className={sectionTitle}>{tl("Etichette")}</h4>
                <div className="mt-2"><LabelDropdown labels={labels} value={cardLabels} canEdit={canEdit} onChange={(next) => onPatch({ labels: next })} /></div>
              </section>
            )}

            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={sectionTitle}>{tl("Priorità")}</span>
                <Select density="compact" disabled={!canEdit} value={card.priority || ''} onChange={(event) => onPatch({ priority: (event.target.value || null) as Priority | null })} className={fieldClass}>
                  <option value="">—</option>
                  {(Object.keys(PRIORITY_LABEL) as Priority[]).map((key) => <option key={key} value={key}>{PRIORITY_LABEL[key]}</option>)}
                </Select>
              </label>
              {showPoints && (
                <label className="block">
                  <span className={sectionTitle}>{tl("Punti")}</span>
                  <input disabled={!canEdit} type="number" min={1} max={100} value={points} onChange={(event) => setPoints(event.target.value)}
                    onBlur={() => { const value = Number.parseInt(points, 10); const next = Number.isFinite(value) && value > 0 ? value : null; if (next !== (card.story_points ?? null)) onPatch({ story_points: next }) }}
                    className="ds-field mt-1.5 h-10 w-full rounded-[var(--ds-field-radius)] px-3 text-sm" />
                </label>
              )}
              {sprints.length > 0 && (
                <label className="col-span-2 block">
                  <span className={sectionTitle}>Sprint</span>
                  <Select density="compact" disabled={!canEdit} value={card.sprint_id || ''} onChange={(event) => onPatch({ sprint_id: event.target.value || null })} className={fieldClass}>
                    <option value="">{tl("Nessuno")}</option>
                    {sprints.map((item, index) => <option key={item.id} value={item.id}>S{index + 1} · {item.name}</option>)}
                  </Select>
                </label>
              )}
            </div>

            {children.length > 0 && (
              <section>
                <h4 className={sectionTitle}>User story · {children.length}</h4>
                <ul className="mt-1.5 space-y-1">
                  {children.map((child) => (
                    <li key={child.id}>
                      <button type="button" onClick={() => onOpenCard(child.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-900/[0.05]">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: child.color || '#d4d4d4' }} />
                        <span className="min-w-0 flex-1 truncate font-bold">{child.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="text-[11px] text-slate-400">
              {card.created_by_display_name && tl("Creato da {0}", card.created_by_display_name)}
              {card.last_actor_display_name && tl(" · ultima modifica {0}", card.last_actor_display_name)}
            </p>
          </aside>
        </div>

        {canEdit && (
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-6 py-3">
            <button type="button" disabled={deletePending} onClick={onDelete} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-40"><Trash2 className="h-4 w-4" /> {tl("Elimina")}</button>
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500">{tl("Colore")}{colorControl}</div>
          </div>
        )}
      </div>
      {preview !== null && images[preview] && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-6" role="dialog" aria-modal="true" aria-label={tl("Anteprima immagine")}
          onMouseDown={(event) => { event.stopPropagation(); setPreview(null) }}>
          <img src={images[preview].url} alt={images[preview].alt || tl("Immagine del task")} className="max-h-full max-w-full rounded-xl object-contain" />
        </div>
      )}
    </div>
  )
}
