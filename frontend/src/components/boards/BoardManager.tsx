import { useMemo, useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { boardsApi } from '@/lib/api'
import { LayoutTemplate, Lock, Palette, Plus, Share2, Trash2, X } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

type BoardColumn = { id: string; label: string; hint: string; color: string }
type BoardCard = {
  id: string
  board_id: string
  column_id: string
  title: string
  description?: string | null
  color?: string | null
  coding_project_id?: string | null
  coding_status?: string | null
  created_by_display_name?: string | null
  last_actor_display_name?: string | null
}
type Board = {
  id: string
  title: string
  description?: string | null
  template_key?: string | null
  coding_project_id?: string | null
  columns: BoardColumn[]
  visibility: 'private' | 'session_shared'
  students_can_edit: boolean
  created_by_display_name?: string | null
  can_manage?: boolean
  cards?: BoardCard[] | null
}
type Template = { id: string; label: string; columns: BoardColumn[] }

const TASK_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#64748b']

export default function BoardManager({ sessionId, isStudent = false }: { sessionId?: string; isStudent?: boolean }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const draggedCard = useRef<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [templateKey, setTemplateKey] = useState('kanban')
  const [shareOnCreate, setShareOnCreate] = useState(false)
  const [newCardColor, setNewCardColor] = useState(TASK_COLORS[0])
  const [inlineColumnId, setInlineColumnId] = useState<string | null>(null)
  const [inlineTitle, setInlineTitle] = useState('')
  const [inlineDescription, setInlineDescription] = useState('')
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)

  const { data: templates = [] } = useQuery({
    queryKey: ['boards-templates'],
    queryFn: async () => (await boardsApi.templates()).data as Template[],
  })
  const { data: boards = [], isLoading } = useQuery({
    queryKey: ['boards'],
    queryFn: async () => (await boardsApi.list()).data as Board[],
  })

  const selectedSummary = useMemo(() => boards.find((board) => board.id === selectedId) || boards[0] || null, [boards, selectedId])
  const { data: selectedBoard } = useQuery({
    queryKey: ['board', selectedSummary?.id],
    enabled: Boolean(selectedSummary?.id),
    queryFn: async () => (await boardsApi.get(selectedSummary!.id)).data as Board,
  })
  const board = selectedBoard || selectedSummary
  const columns = board?.columns || []
  const cards = board?.cards || []

  const createBoard = useMutation({
    mutationFn: () => boardsApi.create({
      title: title.trim() || 'Nuova board',
      session_id: sessionId,
      template_key: templateKey,
      visibility: shareOnCreate ? 'session_shared' : 'private',
      students_can_edit: shareOnCreate,
    }),
    onSuccess: (res) => {
      const created = res.data as Board
      setTitle('')
      setShareOnCreate(false)
      setSelectedId(created.id)
      queryClient.invalidateQueries({ queryKey: ['boards'] })
      queryClient.setQueryData(['board', created.id], created)
      toast({ title: 'Board creata' })
    },
  })

  const updateBoard = useMutation({
    mutationFn: (patch: Partial<Board>) => boardsApi.update(board!.id, patch as any),
    onSuccess: (res) => {
      queryClient.setQueryData(['board', board!.id], res.data)
      queryClient.invalidateQueries({ queryKey: ['boards'] })
    },
  })

  const deleteBoard = useMutation({
    mutationFn: (boardId: string) => boardsApi.delete(boardId),
    onSuccess: (_res, boardId) => {
      queryClient.removeQueries({ queryKey: ['board', boardId] })
      queryClient.invalidateQueries({ queryKey: ['boards'] })
      if (selectedId === boardId || board?.id === boardId) {
        setSelectedId(boards.find((item) => item.id !== boardId)?.id || null)
      }
      toast({ title: 'Board eliminata' })
    },
  })

  const createCard = useMutation({
    mutationFn: (payload: { title: string; description?: string; columnId?: string | null; color?: string }) => boardsApi.createCard(board!.id, {
      title: payload.title.trim(),
      description: payload.description?.trim() || undefined,
      column_id: payload.columnId || columns[0]?.id,
      color: payload.color || newCardColor,
    }),
    onSuccess: () => {
      setInlineTitle('')
      setInlineDescription('')
      setInlineColumnId(null)
      queryClient.invalidateQueries({ queryKey: ['board', board!.id] })
      queryClient.invalidateQueries({ queryKey: ['boards'] })
    },
  })

  const moveCard = useMutation({
    mutationFn: ({ cardId, columnId }: { cardId: string; columnId: string }) => boardsApi.updateCard(board!.id, cardId, { column_id: columnId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board', board!.id] })
      queryClient.invalidateQueries({ queryKey: ['boards'] })
    },
  })

  const updateCardColor = useMutation({
    mutationFn: ({ cardId, color }: { cardId: string; color: string }) => boardsApi.updateCard(board!.id, cardId, { color }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board', board!.id] })
    },
  })

  const grouped = useMemo(() => {
    const map: Record<string, BoardCard[]> = {}
    columns.forEach((column) => { map[column.id] = [] })
    cards.forEach((card) => { (map[card.column_id] || map[columns[0]?.id] || []).push(card) })
    return map
  }, [cards, columns])

  return (
    <div className="flex h-full min-h-0 bg-slate-100 text-slate-900">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-3">
          <h1 className="text-base font-black">Board Manager</h1>
          <p className="text-xs text-slate-500">
            {isStudent ? 'Crea board personali o condivise nella sessione.' : 'Crea, richiama e condividi board di lavoro.'}
          </p>
        </div>
        <div className="space-y-2 border-b border-slate-100 p-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titolo board" className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
          <div className="flex gap-2">
            <select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-2 text-sm">
              {templates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
            </select>
            <button onClick={() => createBoard.mutate()} className="inline-flex h-9 items-center gap-1 rounded-lg bg-slate-900 px-3 text-sm font-bold text-white">
              <Plus className="h-4 w-4" /> Crea
            </button>
          </div>
          <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
            <input type="checkbox" checked={shareOnCreate} onChange={(e) => setShareOnCreate(e.target.checked)} />
            condividi con la classe
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {isLoading ? <p className="p-3 text-sm text-slate-400">Caricamento...</p> : boards.map((item) => (
            <div key={item.id} className={`mb-2 flex items-stretch rounded-lg border ${board?.id === item.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
              <button onClick={() => setSelectedId(item.id)} className="min-w-0 flex-1 px-3 py-2 text-left">
                <div className="truncate text-sm font-black">{item.title}</div>
                <div className={`mt-1 flex items-center gap-1 text-[11px] ${board?.id === item.id ? 'text-white/70' : 'text-slate-500'}`}>
                  {item.visibility === 'session_shared' ? <Share2 className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                  <span>{item.visibility === 'session_shared' ? 'Condivisa' : 'Privata'}</span>
                </div>
              </button>
              {item.can_manage && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Eliminare la board "${item.title}"?`)) deleteBoard.mutate(item.id)
                  }}
                  className={`flex w-10 items-center justify-center border-l ${board?.id === item.id ? 'border-white/15 text-white/70 hover:text-white' : 'border-slate-100 text-slate-400 hover:bg-red-50 hover:text-red-600'}`}
                  aria-label={`Elimina ${item.title}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {!board ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Crea una board per iniziare.</div>
        ) : (
          <>
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-black">{board.title}</h2>
                <p className="text-xs text-slate-500">{board.created_by_display_name ? `Creata da ${board.created_by_display_name}` : 'Board'}</p>
              </div>
              <div className="flex items-center gap-2">
                {board.can_manage && (
                  <>
                    <button onClick={() => updateBoard.mutate({ visibility: board.visibility === 'session_shared' ? 'private' : 'session_shared' } as Partial<Board>)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-600 hover:bg-slate-50">
                      {board.visibility === 'session_shared' ? <Share2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                      {board.visibility === 'session_shared' ? 'Condivisa' : 'Privata'}
                    </button>
                    <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600">
                      <input type="checkbox" checked={board.students_can_edit} onChange={(e) => updateBoard.mutate({ students_can_edit: e.target.checked } as Partial<Board>)} />
                      studenti editano
                    </label>
                  </>
                )}
              </div>
            </header>
            <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-4">
              {columns.map((column) => (
                <section
                  key={column.id}
                  onDragOver={(e) => { e.preventDefault(); setDragOverCol(column.id) }}
                  onDragLeave={() => setDragOverCol(null)}
                  onDrop={(e) => {
                    e.preventDefault()
                    const cardId = draggedCard.current
                    draggedCard.current = null
                    setDragOverCol(null)
                    if (cardId) moveCard.mutate({ cardId, columnId: column.id })
                  }}
                  className={`group flex w-[300px] shrink-0 flex-col border bg-white ${dragOverCol === column.id ? 'border-slate-500' : 'border-slate-200'}`}
                >
                  <div className="flex min-h-[47px] items-center gap-2 border-b border-slate-200 px-3 py-2" style={{ borderTop: `3px solid ${column.color}` }}>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-xs font-black uppercase tracking-wide">{column.label}</h3>
                      {column.hint && <p className="mt-0.5 text-[10px] text-slate-400">{column.hint}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setInlineColumnId(column.id)
                        setInlineTitle('')
                        setInlineDescription('')
                        setNewCardColor(TASK_COLORS[0])
                      }}
                      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 opacity-100 shadow-sm transition hover:border-slate-400 hover:text-slate-900 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
                      aria-label={`Crea un task in ${column.label}`}
                      title={`Crea un task in ${column.label}`}
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex min-h-[180px] flex-1 flex-col gap-2 bg-slate-50/70 p-2">
                    {inlineColumnId === column.id && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          if (inlineTitle.trim()) createCard.mutate({ title: inlineTitle, description: inlineDescription, columnId: column.id, color: newCardColor })
                        }}
                        className="space-y-2 rounded-lg border border-slate-300 bg-white p-3 shadow-sm"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-black text-slate-700">Nuovo task</p>
                          <button type="button" onClick={() => setInlineColumnId(null)} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Annulla creazione">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <label className="block text-[11px] font-bold text-slate-500">
                          Titolo
                          <input autoFocus required value={inlineTitle} onChange={(e) => setInlineTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setInlineColumnId(null) }} placeholder="Cosa bisogna fare?" className="mt-1 h-8 w-full rounded-md border border-slate-200 px-2 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-slate-300" />
                        </label>
                        <label className="block text-[11px] font-bold text-slate-500">
                          Descrizione <span className="font-normal">(facoltativa)</span>
                          <textarea value={inlineDescription} onChange={(e) => setInlineDescription(e.target.value)} placeholder="Aggiungi indicazioni" rows={3} className="mt-1 w-full resize-none rounded-md border border-slate-200 px-2 py-1.5 text-sm font-normal text-slate-900 outline-none focus:ring-2 focus:ring-slate-300" />
                        </label>
                        <div className="flex items-center justify-between gap-2">
                          <ColorPicker value={newCardColor} onChange={setNewCardColor} />
                          <div className="flex gap-2">
                            <button type="button" onClick={() => setInlineColumnId(null)} className="h-8 rounded-md px-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Annulla</button>
                            <button disabled={!inlineTitle.trim() || createCard.isPending} className="h-8 rounded-md bg-slate-900 px-3 text-xs font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
                              {createCard.isPending ? 'Creazione…' : 'Crea task'}
                            </button>
                          </div>
                        </div>
                      </form>
                    )}
                    {(grouped[column.id] || []).map((card) => (
                      <article key={card.id} draggable onDragStart={() => { draggedCard.current = card.id }} className="cursor-grab border border-slate-200 bg-white p-3 shadow-sm active:cursor-grabbing" style={{ borderLeft: `4px solid ${card.color || '#cbd5e1'}` }}>
                        <div className="flex items-start gap-2">
                          <h4 className="min-w-0 flex-1 text-sm font-bold">{card.title}</h4>
                          <ColorPicker value={card.color || '#cbd5e1'} onChange={(color) => updateCardColor.mutate({ cardId: card.id, color })} compact />
                        </div>
                        {card.description && <p className="mt-1 text-xs text-slate-500">{card.description}</p>}
                        <p className="mt-2 text-[10px] text-slate-400">
                          {card.created_by_display_name && `Creato da ${card.created_by_display_name}`}
                          {card.last_actor_display_name && ` · ultima modifica ${card.last_actor_display_name}`}
                        </p>
                      </article>
                    ))}
                    {(grouped[column.id] || []).length === 0 && <div className="flex flex-1 items-center justify-center text-xs text-slate-300"><LayoutTemplate className="mr-1 h-3 w-3" /> Trascina qui</div>}
                  </div>
                </section>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function ColorPicker({ value, onChange, compact = false }: { value: string; onChange: (color: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); setOpen((current) => !current) }}
        className={`${compact ? 'h-6 w-6' : 'h-9 w-9'} inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white shadow-sm`}
        title="Colore task"
      >
        {compact ? <span className="h-3 w-3 rounded-full" style={{ backgroundColor: value }} /> : <Palette className="h-4 w-4" style={{ color: value }} />}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 grid grid-cols-3 gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-xl">
          {TASK_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              onClick={(event) => { event.stopPropagation(); onChange(color); setOpen(false) }}
              className="h-6 w-6 rounded-md border border-slate-200"
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
      )}
    </div>
  )
}
