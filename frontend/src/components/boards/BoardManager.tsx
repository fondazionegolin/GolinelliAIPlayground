import { useMemo, useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { boardsApi } from '@/lib/api'
import { Check, Edit2, GripVertical, LayoutTemplate, Lock, Palette, Plus, Share2, Trash2, X } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { SearchPill } from '@/design'

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
  session_id?: string | null
  title: string
  description?: string | null
  template_key?: string | null
  coding_project_id?: string | null
  columns: BoardColumn[]
  visibility: 'private' | 'session_shared'
  students_can_edit: boolean
  created_by_display_name?: string | null
  can_manage?: boolean
  can_edit?: boolean
  cards?: BoardCard[] | null
}
type Template = { id: string; label: string; columns: BoardColumn[] }
type BoardPatch = {
  title?: string
  description?: string
  columns?: BoardColumn[]
  visibility?: 'private' | 'session_shared'
  students_can_edit?: boolean
  coding_project_id?: string | null
  move_cards_from_column_id?: string
  move_cards_to_column_id?: string
}

const TASK_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#64748b']

export default function BoardManager({ sessionId, isStudent = false }: { sessionId?: string; isStudent?: boolean }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const draggedCard = useRef<string | null>(null)
  const draggedColumn = useRef<string | null>(null)
  const cancelColumnEdit = useRef(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [templateKey, setTemplateKey] = useState('kanban')
  const [shareOnCreate, setShareOnCreate] = useState(false)
  const [newCardColor, setNewCardColor] = useState(TASK_COLORS[0])
  const [inlineColumnId, setInlineColumnId] = useState<string | null>(null)
  const [inlineTitle, setInlineTitle] = useState('')
  const [inlineDescription, setInlineDescription] = useState('')
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null)
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null)
  const [columnDragOver, setColumnDragOver] = useState<string | null>(null)
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
  const [editingColumnLabel, setEditingColumnLabel] = useState('')
  const [columnToDelete, setColumnToDelete] = useState<{ columnId: string; targetId: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [editCardTitle, setEditCardTitle] = useState('')
  const [editCardDescription, setEditCardDescription] = useState('')
  const [editCardColor, setEditCardColor] = useState(TASK_COLORS[0])

  const { data: templates = [] } = useQuery({
    queryKey: ['boards-templates'],
    queryFn: async () => (await boardsApi.templates()).data as Template[],
  })
  const { data: boards = [], isLoading } = useQuery({
    queryKey: ['boards', sessionId],
    queryFn: async () => (await boardsApi.list(sessionId)).data as Board[],
    enabled: Boolean(sessionId),
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
    mutationFn: (patch: BoardPatch) => boardsApi.update(board!.id, patch),
    onSuccess: (res) => {
      queryClient.setQueryData<Board>(['board', board!.id], (current) => ({
        ...current,
        ...res.data,
        cards: res.data.cards ?? current?.cards ?? [],
      }))
      queryClient.invalidateQueries({ queryKey: ['board', board!.id] })
      queryClient.invalidateQueries({ queryKey: ['boards', sessionId] })
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
    onError: (error: any) => {
      toast({
        title: 'Impossibile creare il task',
        description: error?.response?.data?.detail || 'Non hai i permessi per modificare questa board.',
        variant: 'destructive',
      })
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

  const updateCard = useMutation({
    mutationFn: ({ cardId, title, description, color }: { cardId: string; title: string; description: string; color: string }) =>
      boardsApi.updateCard(board!.id, cardId, {
        title: title.trim(),
        description: description.trim(),
        color,
      }),
    onSuccess: () => {
      setEditingCardId(null)
      queryClient.invalidateQueries({ queryKey: ['board', board!.id] })
      queryClient.invalidateQueries({ queryKey: ['boards'] })
      toast({ title: 'Task aggiornato' })
    },
    onError: (error: any) => {
      toast({
        title: 'Impossibile modificare il task',
        description: error?.response?.data?.detail || 'Riprova tra poco.',
        variant: 'destructive',
      })
    },
  })

  const deleteCard = useMutation({
    mutationFn: (cardId: string) => boardsApi.deleteCard(board!.id, cardId),
    onSuccess: () => {
      setEditingCardId(null)
      queryClient.invalidateQueries({ queryKey: ['board', board!.id] })
      queryClient.invalidateQueries({ queryKey: ['boards'] })
      toast({ title: 'Task eliminato' })
    },
    onError: (error: any) => {
      toast({
        title: 'Impossibile eliminare il task',
        description: error?.response?.data?.detail || 'Riprova tra poco.',
        variant: 'destructive',
      })
    },
  })

  const startEditingCard = (card: BoardCard) => {
    setEditingCardId(card.id)
    setEditCardTitle(card.title)
    setEditCardDescription(card.description || '')
    setEditCardColor(card.color || TASK_COLORS[0])
  }

  const addColumn = () => {
    if (!board?.can_manage || columns.length >= 12) return
    const column: BoardColumn = {
      id: `col_${Date.now().toString(36)}`,
      label: 'Nuova colonna',
      hint: '',
      color: TASK_COLORS[columns.length % TASK_COLORS.length],
    }
    updateBoard.mutate({ columns: [...columns, column] }, {
      onSuccess: () => {
        cancelColumnEdit.current = false
        setEditingColumnId(column.id)
        setEditingColumnLabel(column.label)
      },
    })
  }

  const saveColumnLabel = (columnId: string) => {
    const label = editingColumnLabel.trim()
    if (!label) return
    updateBoard.mutate({
      columns: columns.map((column) => column.id === columnId ? { ...column, label } : column),
    }, {
      onSuccess: () => setEditingColumnId(null),
    })
  }

  const moveColumn = (targetColumnId: string) => {
    const sourceColumnId = draggedColumn.current
    if (!board?.can_manage || !sourceColumnId || sourceColumnId === targetColumnId) return
    const sourceIndex = columns.findIndex((column) => column.id === sourceColumnId)
    const targetIndex = columns.findIndex((column) => column.id === targetColumnId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const reordered = [...columns]
    const [source] = reordered.splice(sourceIndex, 1)
    reordered.splice(targetIndex, 0, source)
    updateBoard.mutate({ columns: reordered })
  }

  const confirmDeleteColumn = () => {
    if (!columnToDelete || !board?.can_manage) return
    updateBoard.mutate({
      columns: columns.filter((column) => column.id !== columnToDelete.columnId),
      move_cards_from_column_id: columnToDelete.columnId,
      move_cards_to_column_id: columnToDelete.targetId,
    }, {
      onSuccess: () => setColumnToDelete(null),
    })
  }

  const grouped = useMemo(() => {
    const map: Record<string, BoardCard[]> = {}
    columns.forEach((column) => { map[column.id] = [] })
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('it')
    cards.forEach((card) => {
      if (normalizedQuery) {
        const columnLabel = columns.find((column) => column.id === card.column_id)?.label || ''
        const searchableText = [
          card.title,
          card.description,
          card.created_by_display_name,
          card.last_actor_display_name,
          columnLabel,
        ].filter(Boolean).join(' ').toLocaleLowerCase('it')
        if (!searchableText.includes(normalizedQuery)) return
      }
      ;(map[card.column_id] || map[columns[0]?.id] || []).push(card)
    })
    return map
  }, [cards, columns, searchQuery])

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100 text-slate-900 lg:flex-row">
      <aside className="flex max-h-[220px] w-full shrink-0 flex-col border-b border-slate-200 bg-white lg:max-h-none lg:w-[300px] lg:border-b-0 lg:border-r">
        <div className="border-b border-slate-100 p-3">
          <h1 className="text-base font-black">Board Manager</h1>
          <p className="text-xs text-slate-500">
            {isStudent ? 'Crea board personali o condivise nella sessione.' : 'Crea e condividi board nella sessione attiva.'}
          </p>
        </div>
        <div className="space-y-2 border-b border-slate-100 p-3">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titolo board" className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
          <div className="flex gap-2">
            <select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-2 text-sm">
              {templates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
            </select>
            <button disabled={!sessionId || createBoard.isPending} onClick={() => createBoard.mutate()} className="inline-flex h-9 items-center gap-1 rounded-lg bg-slate-900 px-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
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
                {item.created_by_display_name && (
                  <div className={`mt-1 truncate text-[10px] ${board?.id === item.id ? 'text-white/55' : 'text-slate-400'}`}>
                    Creata da {item.created_by_display_name}
                  </div>
                )}
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
            <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-xl font-black">{board.title}</h2>
              </div>
              <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
                <SearchPill
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  placeholder="Cerca task"
                  aria-label="Cerca nelle task della board"
                  className="w-full sm:w-[260px]"
                />
                {board.can_manage && (
                  <>
                    <button onClick={() => updateBoard.mutate({ visibility: board.visibility === 'session_shared' ? 'private' : 'session_shared' })} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-600 hover:bg-slate-50">
                      {board.visibility === 'session_shared' ? <Share2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                      {board.visibility === 'session_shared' ? 'Condivisa' : 'Privata'}
                    </button>
                    <label className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600">
                      <input type="checkbox" checked={board.students_can_edit} onChange={(e) => updateBoard.mutate({ students_can_edit: e.target.checked })} />
                      studenti editano
                    </label>
                  </>
                )}
              </div>
            </header>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-hidden p-3 lg:flex-row lg:overflow-x-auto lg:overflow-y-hidden lg:p-4">
              {columns.map((column) => (
                <section
                  key={column.id}
                  onDragOver={(e) => {
                    e.preventDefault()
                    if (draggedColumn.current) setColumnDragOver(column.id)
                    else if (draggedCard.current) setDragOverCol(column.id)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    if (draggedColumn.current) {
                      moveColumn(column.id)
                      draggedColumn.current = null
                      setDraggingColumnId(null)
                      setColumnDragOver(null)
                      return
                    }
                    const cardId = draggedCard.current
                    draggedCard.current = null
                    setDraggingCardId(null)
                    setDragOverCol(null)
                    if (cardId && board.can_edit) moveCard.mutate({ cardId, columnId: column.id })
                  }}
                  className={`group flex min-h-[210px] w-full shrink-0 flex-row overflow-hidden rounded-xl border bg-white transition lg:h-full lg:min-h-0 lg:w-[300px] lg:flex-col lg:rounded-none ${
                    dragOverCol === column.id
                      ? 'border-sky-500 bg-sky-50/70 ring-2 ring-sky-300'
                      : draggingCardId
                        ? 'border-sky-300 shadow-[0_0_0_2px_rgba(125,211,252,0.2)]'
                        : columnDragOver === column.id
                          ? 'border-violet-500 ring-2 ring-violet-200'
                          : 'border-slate-200'
                  } ${draggingColumnId === column.id ? 'opacity-50' : ''}`}
                >
                  <div
                    draggable={Boolean(board.can_manage && editingColumnId !== column.id)}
                    onDragStart={(event) => {
                      if (!board.can_manage || (event.target as HTMLElement).closest('button, input')) {
                        event.preventDefault()
                        return
                      }
                      draggedColumn.current = column.id
                      setDraggingColumnId(column.id)
                      event.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={() => {
                      draggedColumn.current = null
                      setDraggingColumnId(null)
                      setColumnDragOver(null)
                    }}
                    className={`flex w-[148px] shrink-0 flex-col items-start gap-2 border-r border-slate-200 px-3 py-3 lg:min-h-[47px] lg:w-auto lg:flex-row lg:items-center lg:border-b lg:border-r-0 lg:py-2 ${board.can_manage && editingColumnId !== column.id ? 'cursor-grab active:cursor-grabbing' : ''}`}
                    style={{ borderTop: `3px solid ${column.color}` }}
                  >
                    {board.can_manage && <GripVertical className="hidden h-4 w-4 shrink-0 text-slate-300 lg:block" aria-hidden="true" />}
                    <div className="min-w-0 flex-1">
                      {editingColumnId === column.id ? (
                        <div>
                          <input
                            autoFocus
                            value={editingColumnLabel}
                            onChange={(event) => setEditingColumnLabel(event.target.value)}
                            onBlur={() => {
                              if (cancelColumnEdit.current) {
                                cancelColumnEdit.current = false
                                return
                              }
                              if (editingColumnLabel.trim()) saveColumnLabel(column.id)
                              else setEditingColumnId(null)
                            }}
                            onKeyDown={(event) => {
                              if (event.key === 'Escape') {
                                cancelColumnEdit.current = true
                                setEditingColumnId(null)
                              }
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                event.currentTarget.blur()
                              }
                            }}
                            className="h-7 w-full rounded-md border border-slate-300 px-2 text-xs font-black uppercase tracking-wide outline-none focus:ring-2 focus:ring-slate-300"
                            aria-label={`Rinomina ${column.label}`}
                          />
                        </div>
                      ) : (
                        <>
                          <h3 className="text-xs font-black uppercase tracking-wide">{column.label}</h3>
                          {column.hint && <p className="mt-0.5 text-[10px] text-slate-400">{column.hint}</p>}
                        </>
                      )}
                    </div>
                    {board.can_manage && editingColumnId !== column.id && (
                      <div className="flex shrink-0 items-center opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                        <button
                          type="button"
                          onClick={() => { cancelColumnEdit.current = false; setEditingColumnId(column.id); setEditingColumnLabel(column.label) }}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          title="Rinomina colonna"
                          aria-label={`Rinomina ${column.label}`}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        {columns.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setColumnToDelete({ columnId: column.id, targetId: columns.find((item) => item.id !== column.id)!.id })}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600"
                            title="Elimina colonna"
                            aria-label={`Elimina ${column.label}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                    {board.can_edit && (
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
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-row items-stretch gap-2 overflow-x-auto overflow-y-hidden bg-slate-50/70 p-2 lg:min-h-0 lg:flex-col lg:items-stretch lg:overflow-x-hidden lg:overflow-y-auto">
                    {inlineColumnId === column.id && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault()
                          if (inlineTitle.trim()) createCard.mutate({ title: inlineTitle, description: inlineDescription, columnId: column.id, color: newCardColor })
                        }}
                        className="w-[280px] shrink-0 space-y-2 rounded-lg border border-slate-300 bg-white p-3 shadow-sm lg:w-auto"
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
                      <article
                        key={card.id}
                        draggable={Boolean(board.can_edit && editingCardId !== card.id)}
                        onDragStart={(event) => {
                          if (!board.can_edit || editingCardId === card.id || (event.target as HTMLElement).closest('button, input, textarea')) {
                            event.preventDefault()
                            return
                          }
                          draggedCard.current = card.id
                          setDraggingCardId(card.id)
                          event.dataTransfer.effectAllowed = 'move'
                        }}
                        onDragEnd={() => {
                          draggedCard.current = null
                          setDraggingCardId(null)
                          setDragOverCol(null)
                        }}
                        className={`group/card w-[260px] shrink-0 border border-slate-200 bg-white p-3 shadow-sm lg:w-auto ${board.can_edit && editingCardId !== card.id ? 'cursor-grab active:cursor-grabbing' : ''}`}
                        style={{ borderLeft: `4px solid ${editingCardId === card.id ? editCardColor : card.color || '#cbd5e1'}` }}
                      >
                        {editingCardId === card.id ? (
                          <form
                            className="space-y-2"
                            onSubmit={(event) => {
                              event.preventDefault()
                              if (!editCardTitle.trim()) return
                              updateCard.mutate({
                                cardId: card.id,
                                title: editCardTitle,
                                description: editCardDescription,
                                color: editCardColor,
                              })
                            }}
                          >
                            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                              Titolo
                              <input
                                autoFocus
                                required
                                value={editCardTitle}
                                onChange={(event) => setEditCardTitle(event.target.value)}
                                onKeyDown={(event) => { if (event.key === 'Escape') setEditingCardId(null) }}
                                className="mt-1 h-8 w-full rounded-md border border-slate-200 px-2 text-sm font-normal normal-case tracking-normal text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
                              />
                            </label>
                            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                              Descrizione
                              <textarea
                                value={editCardDescription}
                                onChange={(event) => setEditCardDescription(event.target.value)}
                                rows={3}
                                placeholder="Aggiungi indicazioni"
                                className="mt-1 w-full resize-none rounded-md border border-slate-200 px-2 py-1.5 text-sm font-normal normal-case tracking-normal text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
                              />
                            </label>
                            <div className="flex items-center justify-between gap-2">
                              <ColorPicker value={editCardColor} onChange={setEditCardColor} />
                              <div className="flex items-center gap-1">
                                <button type="button" onClick={() => setEditingCardId(null)} className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Annulla modifica" aria-label="Annulla modifica">
                                  <X className="h-4 w-4" />
                                </button>
                                <button disabled={!editCardTitle.trim() || updateCard.isPending} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white disabled:cursor-not-allowed disabled:opacity-40" title="Salva task" aria-label="Salva task">
                                  <Check className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          </form>
                        ) : (
                          <>
                            <div className="flex items-start gap-1">
                              <h4 className="min-w-0 flex-1 text-sm font-bold">{card.title}</h4>
                              {board.can_edit && (
                                <div className="flex shrink-0 items-center opacity-100 transition-opacity sm:opacity-0 sm:group-hover/card:opacity-100 sm:group-focus-within/card:opacity-100">
                                  <button type="button" onClick={() => startEditingCard(card)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="Modifica task" aria-label={`Modifica ${card.title}`}>
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={deleteCard.isPending}
                                    onClick={() => {
                                      if (window.confirm(`Eliminare il task "${card.title}"?`)) deleteCard.mutate(card.id)
                                    }}
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                                    title="Elimina task"
                                    aria-label={`Elimina ${card.title}`}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                              {board.can_edit && <ColorPicker value={card.color || '#cbd5e1'} onChange={(color) => updateCardColor.mutate({ cardId: card.id, color })} compact />}
                            </div>
                            {card.description && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-500">{card.description}</p>}
                            <p className="mt-2 text-[10px] text-slate-400">
                              {card.created_by_display_name && `Creato da ${card.created_by_display_name}`}
                              {card.last_actor_display_name && ` · ultima modifica ${card.last_actor_display_name}`}
                            </p>
                          </>
                        )}
                      </article>
                    ))}
                    {(grouped[column.id] || []).length === 0 && (
                      <div className={`flex min-w-[180px] flex-1 items-center justify-center text-xs ${draggingCardId ? 'font-bold text-sky-600' : 'text-slate-300'}`}>
                        <LayoutTemplate className="mr-1 h-3 w-3" />
                        {draggingCardId ? 'Rilascia qui' : searchQuery ? 'Nessun risultato' : 'Nessun task'}
                      </div>
                    )}
                  </div>
                </section>
              ))}
              {board.can_manage && (
                <button
                  type="button"
                  onClick={addColumn}
                  disabled={columns.length >= 12 || updateBoard.isPending}
                  className="flex min-h-[72px] w-full shrink-0 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-white/60 text-sm font-bold text-slate-500 transition hover:border-slate-400 hover:bg-white hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40 lg:h-full lg:min-h-0 lg:w-[90px]"
                  title={columns.length >= 12 ? 'Numero massimo di colonne raggiunto' : 'Nuova colonna'}
                >
                  <Plus className="h-5 w-5" />
                  <span className="lg:sr-only">Nuova colonna</span>
                </button>
              )}
            </div>
          </>
        )}
      </main>
      {columnToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setColumnToDelete(null) }}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="delete-column-title">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 id="delete-column-title" className="text-lg font-black text-slate-900">Elimina colonna</h3>
                <p className="mt-1 text-sm text-slate-500">
                  I task di “{columns.find((column) => column.id === columnToDelete.columnId)?.label}” devono essere spostati prima dell’eliminazione.
                </p>
              </div>
              <button type="button" onClick={() => setColumnToDelete(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Chiudi">
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="mt-5 block text-xs font-bold uppercase tracking-wide text-slate-500">
              Sposta i task in
              <select
                autoFocus
                value={columnToDelete.targetId}
                onChange={(event) => setColumnToDelete((current) => current ? { ...current, targetId: event.target.value } : null)}
                className="mt-2 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-slate-900 outline-none focus:ring-2 focus:ring-slate-300"
              >
                {columns.filter((column) => column.id !== columnToDelete.columnId).map((column) => (
                  <option key={column.id} value={column.id}>{column.label}</option>
                ))}
              </select>
            </label>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setColumnToDelete(null)} className="h-10 rounded-lg px-4 text-sm font-bold text-slate-600 hover:bg-slate-100">Annulla</button>
              <button type="button" disabled={updateBoard.isPending} onClick={confirmDeleteColumn} className="h-10 rounded-lg bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
                {updateBoard.isPending ? 'Eliminazione…' : 'Sposta ed elimina'}
              </button>
            </div>
          </div>
        </div>
      )}
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
