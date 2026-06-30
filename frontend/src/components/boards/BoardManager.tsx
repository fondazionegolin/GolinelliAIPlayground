import { useMemo, useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { boardsApi, codingApi } from '@/lib/api'
import { Bot, Code2, Columns3, ExternalLink, LayoutTemplate, Lock, Palette, PlayCircle, Plus, Share2, Wand2 } from 'lucide-react'
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
type AiMessage = { role: 'user' | 'assistant'; content: string }
type AiTask = { title: string; description?: string; column_id?: string; color?: string }

const TASK_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#64748b']

function slug(label: string, fallback: string) {
  return label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || fallback
}

export default function BoardManager({ sessionId, isStudent = false }: { sessionId?: string; isStudent?: boolean }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const draggedCard = useRef<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [templateKey, setTemplateKey] = useState('kanban')
  const [shareOnCreate, setShareOnCreate] = useState(false)
  const [newCardTitle, setNewCardTitle] = useState('')
  const [newCardColumnId, setNewCardColumnId] = useState<string | null>(null)
  const [newCardColor, setNewCardColor] = useState(TASK_COLORS[0])
  const [inlineColumnId, setInlineColumnId] = useState<string | null>(null)
  const [inlineTitle, setInlineTitle] = useState('')
  const [newColumnName, setNewColumnName] = useState('')
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const [aiInput, setAiInput] = useState('')
  const [aiHistory, setAiHistory] = useState<AiMessage[]>([])
  const [aiTasks, setAiTasks] = useState<AiTask[]>([])
  const [codingBusy, setCodingBusy] = useState(false)

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

  const createCard = useMutation({
    mutationFn: (payload: { title: string; columnId?: string | null; color?: string }) => boardsApi.createCard(board!.id, {
      title: payload.title.trim(),
      column_id: payload.columnId || columns[0]?.id,
      color: payload.color || newCardColor,
    }),
    onSuccess: () => {
      setNewCardTitle('')
      setInlineTitle('')
      setInlineColumnId(null)
      queryClient.invalidateQueries({ queryKey: ['board', board!.id] })
      queryClient.invalidateQueries({ queryKey: ['boards'] })
    },
  })

  const moveCard = useMutation({
    mutationFn: ({ cardId, columnId }: { cardId: string; columnId: string }) => boardsApi.updateCard(board!.id, cardId, { column_id: columnId }),
    onSuccess: async (_res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['board', board!.id] })
      queryClient.invalidateQueries({ queryKey: ['boards'] })
      const column = columns.find((item) => item.id === variables.columnId)
      const card = cards.find((item) => item.id === variables.cardId)
      if (card && column && isRunningColumn(column)) {
        await sendCardToCoding(card)
      }
    },
  })

  const updateCardColor = useMutation({
    mutationFn: ({ cardId, color }: { cardId: string; color: string }) => boardsApi.updateCard(board!.id, cardId, { color }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board', board!.id] })
    },
  })

  const bulkCreateCards = useMutation({
    mutationFn: (tasks: AiTask[]) => boardsApi.createCardsBulk(board!.id, { cards: tasks }),
    onSuccess: () => {
      setAiTasks([])
      queryClient.invalidateQueries({ queryKey: ['board', board!.id] })
      queryClient.invalidateQueries({ queryKey: ['boards'] })
      toast({ title: 'Task generati aggiunti alla board' })
    },
  })

  const aiChat = useMutation({
    mutationFn: (generateTasks: boolean) => boardsApi.aiChat(board!.id, {
      message: aiInput.trim(),
      history: aiHistory,
      generate_tasks: generateTasks,
    }),
    onSuccess: (res, generateTasks) => {
      const reply = String(res.data?.reply || '')
      const tasks = (res.data?.tasks || []) as AiTask[]
      setAiHistory((prev) => [...prev, { role: 'user', content: aiInput.trim() }, { role: 'assistant', content: reply }])
      setAiInput('')
      if (generateTasks) setAiTasks(tasks)
    },
  })

  const grouped = useMemo(() => {
    const map: Record<string, BoardCard[]> = {}
    columns.forEach((column) => { map[column.id] = [] })
    cards.forEach((card) => { (map[card.column_id] || map[columns[0]?.id] || []).push(card) })
    return map
  }, [cards, columns])

  const addColumn = () => {
    if (!board?.can_manage || !newColumnName.trim()) return
    const label = newColumnName.trim()
    const next = [...columns, { id: slug(label, `col_${columns.length + 1}`), label, hint: '', color: '#64748b' }]
    setNewColumnName('')
    updateBoard.mutate({ columns: next } as Partial<Board>)
  }

  const isRunningColumn = (column: BoardColumn) => {
    const raw = `${column.id} ${column.label}`.toLowerCase()
    return raw.includes('running') || raw.includes('doing') || raw.includes('in_progress') || raw.includes('in corso') || raw.includes('sviluppo')
  }

  const buildProjectPrompt = (card?: BoardCard) => {
    const taskLines = cards.map((item) => `- ${item.title}${item.description ? `: ${item.description}` : ''}`).join('\n')
    const activeTask = card ? `\n\nTASK DA ESEGUIRE ORA:\n${card.title}\n${card.description || ''}` : ''
    return [
      `Idea progettuale: ${board?.title || 'Nuova app'}`,
      board?.description ? `Descrizione: ${board.description}` : '',
      taskLines ? `Task della board:\n${taskLines}` : '',
      activeTask,
      'Realizza o modifica la mini app React/Vite rispettando questo piano. Mantieni il codice funzionante e aggiorna solo cio che serve.',
    ].filter(Boolean).join('\n\n')
  }

  const ensureCodingProject = async () => {
    if (!board) throw new Error('Board non selezionata')
    if (board.coding_project_id) return board.coding_project_id
    const res = await codingApi.createProject({
      title: board.title,
      session_id: sessionId,
      template_key: 'vite-react',
      initial_prompt: buildProjectPrompt(),
    })
    const projectId = String(res.data.id)
    await boardsApi.update(board.id, { coding_project_id: projectId } as any)
    queryClient.setQueryData(['board', board.id], { ...board, coding_project_id: projectId })
    queryClient.invalidateQueries({ queryKey: ['boards'] })
    return projectId
  }

  const startCodingDraft = async () => {
    if (!board) return
    setCodingBusy(true)
    try {
      const projectId = await ensureCodingProject()
      await codingApi.generateProject(projectId, { prompt: buildProjectPrompt() })
      toast({ title: 'Prima stesura avviata nel Coding Lab' })
      openCodingProject(projectId)
    } catch (err: any) {
      toast({ title: 'Coding Lab non avviato', description: err?.response?.data?.detail || err?.message || 'Errore inatteso', variant: 'destructive' })
    } finally {
      setCodingBusy(false)
    }
  }

  const sendCardToCoding = async (card: BoardCard) => {
    if (!board || codingBusy) return
    setCodingBusy(true)
    try {
      const projectId = await ensureCodingProject()
      await boardsApi.updateCard(board.id, card.id, { coding_project_id: projectId, coding_status: 'running' })
      await codingApi.generateProject(projectId, { prompt: buildProjectPrompt(card) })
      await boardsApi.updateCard(board.id, card.id, { coding_project_id: projectId, coding_status: 'done' })
      queryClient.invalidateQueries({ queryKey: ['board', board.id] })
      toast({ title: 'Task inviato al Coding Lab' })
    } catch (err: any) {
      await boardsApi.updateCard(board.id, card.id, { coding_status: 'error' }).catch(() => undefined)
      toast({ title: 'Task non elaborato', description: err?.response?.data?.detail || err?.message || 'Errore inatteso', variant: 'destructive' })
    } finally {
      setCodingBusy(false)
    }
  }

  const openCodingProject = (projectId: string) => {
    if (isStudent) {
      window.location.href = `/student?module=coding&project=${projectId}`
    } else {
      window.location.href = `/teacher/coding?project=${projectId}`
    }
  }

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
            <button key={item.id} onClick={() => setSelectedId(item.id)} className={`mb-2 w-full rounded-lg border px-3 py-2 text-left ${board?.id === item.id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
              <div className="truncate text-sm font-black">{item.title}</div>
              <div className={`mt-1 flex items-center gap-1 text-[11px] ${board?.id === item.id ? 'text-white/70' : 'text-slate-500'}`}>
                {item.visibility === 'session_shared' ? <Share2 className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                <span>{item.visibility === 'session_shared' ? 'Condivisa' : 'Privata'}</span>
              </div>
            </button>
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
            <div className="grid gap-2 border-b border-slate-200 bg-white p-3 lg:grid-cols-[minmax(0,1fr)_auto]">
              <form onSubmit={(e) => { e.preventDefault(); if (newCardTitle.trim()) createCard.mutate({ title: newCardTitle, columnId: newCardColumnId, color: newCardColor }) }} className="flex min-w-0 gap-2">
                <input value={newCardTitle} onChange={(e) => setNewCardTitle(e.target.value)} placeholder="Nuovo task" className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
                <select value={newCardColumnId || columns[0]?.id || ''} onChange={(e) => setNewCardColumnId(e.target.value)} className="h-9 rounded-lg border border-slate-200 px-2 text-sm">
                  {columns.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}
                </select>
                <ColorPicker value={newCardColor} onChange={setNewCardColor} />
                <button className="inline-flex h-9 items-center gap-1 rounded-lg bg-slate-900 px-3 text-sm font-bold text-white"><Plus className="h-4 w-4" /> Task</button>
              </form>
              <div className="flex flex-wrap justify-end gap-2">
                <button disabled={codingBusy} onClick={startCodingDraft} className="inline-flex h-9 items-center gap-1 rounded-lg border border-sky-200 bg-sky-50 px-3 text-sm font-bold text-sky-800 disabled:opacity-60">
                  <PlayCircle className="h-4 w-4" /> Attacca Coding Lab
                </button>
                {board.coding_project_id && (
                  <button onClick={() => openCodingProject(board.coding_project_id!)} className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-600">
                    <ExternalLink className="h-4 w-4" /> Apri
                  </button>
                )}
                {board.can_manage && (
                <form onSubmit={(e) => { e.preventDefault(); addColumn() }} className="flex gap-2">
                  <input value={newColumnName} onChange={(e) => setNewColumnName(e.target.value)} placeholder="Nuova colonna" className="w-40 rounded-lg border border-slate-200 px-3 text-sm" />
                  <button className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-600"><Columns3 className="h-4 w-4" /> Colonna</button>
                </form>
                )}
              </div>
              <div className="lg:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                <div className="flex items-center gap-2">
                  <Bot className="h-4 w-4 text-slate-500" />
                  <input value={aiInput} onChange={(e) => setAiInput(e.target.value)} placeholder="Descrivi l'idea progettuale o rispondi al coach AI..." className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm" />
                  <button disabled={!aiInput.trim() || aiChat.isPending} onClick={() => aiChat.mutate(false)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 disabled:opacity-50">Chat</button>
                  <button disabled={!aiInput.trim() || aiChat.isPending} onClick={() => aiChat.mutate(true)} className="inline-flex h-9 items-center gap-1 rounded-lg bg-slate-900 px-3 text-xs font-bold text-white disabled:opacity-50"><Wand2 className="h-3.5 w-3.5" /> Genera task</button>
                </div>
                {(aiHistory.length > 0 || aiTasks.length > 0) && (
                  <div className="mt-2 grid gap-2 lg:grid-cols-2">
                    <div className="max-h-24 overflow-y-auto rounded-lg bg-white p-2 text-xs text-slate-600">
                      {aiHistory.slice(-4).map((msg, idx) => <p key={idx} className="mb-1"><strong>{msg.role === 'user' ? 'Tu' : 'AI'}:</strong> {msg.content}</p>)}
                    </div>
                    <div className="rounded-lg bg-white p-2">
                      {aiTasks.length ? (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-700">{aiTasks.length} task pronti</span>
                          <button onClick={() => bulkCreateCards.mutate(aiTasks)} className="rounded-lg bg-sky-700 px-3 py-1.5 text-xs font-bold text-white">Aggiungi alla board</button>
                        </div>
                      ) : <span className="text-xs text-slate-400">I task generati compariranno qui.</span>}
                    </div>
                  </div>
                )}
              </div>
            </div>
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
                  className={`flex w-[300px] shrink-0 flex-col border bg-white ${dragOverCol === column.id ? 'border-slate-500' : 'border-slate-200'}`}
                >
                  <div className="border-b border-slate-200 px-3 py-2" style={{ borderTop: `3px solid ${column.color}` }}>
                    <h3 className="text-xs font-black uppercase tracking-wide">{column.label}</h3>
                    {column.hint && <p className="mt-0.5 text-[10px] text-slate-400">{column.hint}</p>}
                  </div>
                  <div
                    onDoubleClick={() => { setInlineColumnId(column.id); setInlineTitle('') }}
                    className="flex min-h-[180px] flex-1 flex-col gap-2 bg-slate-50/70 p-2"
                  >
                    {inlineColumnId === column.id && (
                      <form onSubmit={(e) => { e.preventDefault(); if (inlineTitle.trim()) createCard.mutate({ title: inlineTitle, columnId: column.id, color: newCardColor }) }} className="rounded-lg border border-slate-300 bg-white p-2 shadow-sm">
                        <input autoFocus value={inlineTitle} onChange={(e) => setInlineTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setInlineColumnId(null) }} placeholder="Titolo task" className="h-8 w-full rounded-md border border-slate-200 px-2 text-sm" />
                      </form>
                    )}
                    {(grouped[column.id] || []).map((card) => (
                      <article key={card.id} draggable onDragStart={() => { draggedCard.current = card.id }} className="cursor-grab border border-slate-200 bg-white p-3 shadow-sm active:cursor-grabbing" style={{ borderLeft: `4px solid ${card.color || '#cbd5e1'}` }}>
                        <div className="flex items-start gap-2">
                          <h4 className="min-w-0 flex-1 text-sm font-bold">{card.title}</h4>
                          <ColorPicker value={card.color || '#cbd5e1'} onChange={(color) => updateCardColor.mutate({ cardId: card.id, color })} compact />
                        </div>
                        {card.description && <p className="mt-1 text-xs text-slate-500">{card.description}</p>}
                        {card.coding_status && <p className="mt-2 inline-flex rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700">Coding: {card.coding_status}</p>}
                        <p className="mt-2 text-[10px] text-slate-400">
                          {card.created_by_display_name && `Creato da ${card.created_by_display_name}`}
                          {card.last_actor_display_name && ` · ultima modifica ${card.last_actor_display_name}`}
                        </p>
                        <button onClick={() => sendCardToCoding(card)} className="mt-2 inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-600">
                          <Code2 className="h-3 w-3" /> Coding Lab
                        </button>
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
