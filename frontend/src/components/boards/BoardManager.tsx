import { useEffect, useMemo, useState, useRef, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { boardsApi, type BackgroundJob, type BoardCardFields, type BoardSprintInput } from '@/lib/api'
import { findActiveJob, notifyJobsChanged, useTicker, waitForJob } from '@/lib/backgroundJobs'
import { ArrowLeft, CalendarRange, Check, GanttChartSquare, Edit2, FileUp, GripVertical, KanbanSquare, LayoutTemplate, Loader2, Lock, Palette, Plus, Share2, Sparkles, Tags, Trash2, UserRound, Users, X } from '@/components/icons'
import { useToast } from '@/components/ui/use-toast'
import { Button, SearchPill } from '@/design'
import {
  WorkspaceExplorerBadge,
  WorkspaceExplorerHeader,
  WorkspaceExplorerItem,
  WorkspaceExplorerList,
  WorkspaceExplorerSidebar,
} from '@/components/WorkspaceExplorerSidebar'
import { useMobile } from '@/hooks/useMobile'
import { SidebarCollapseButton, SidebarRail, useSidebarCollapsed } from '@/components/SidebarRail'
import BoardShareDialog from './BoardShareDialog'
import BoardLabelsDialog, { type BoardLabel } from './BoardLabelsDialog'
import BoardSprintsDialog, { type BoardSprint } from './BoardSprintsDialog'
import BoardTimeline, { formatSprintDates, sprintStatus } from './BoardTimeline'

type BoardColumn = { id: string; label: string; hint: string; color: string }
type Member = { kind: 'teacher' | 'student'; id: string; name: string }
type Priority = 'alta' | 'media' | 'bassa'
type CardType = 'epic' | 'story' | 'task'
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
  labels?: string[]
  assignees?: Member[]
  card_type?: CardType | null
  priority?: Priority | null
  story_points?: number | null
  parent_card_id?: string | null
  sprint_id?: string | null
}
type Board = {
  id: string
  session_id?: string | null
  session_title?: string | null
  framework?: 'scrum' | 'kanban' | null
  labels?: BoardLabel[]
  sprints?: BoardSprint[]
  auto_sprint_weekly?: boolean
  shared_with_me?: boolean
  me?: { kind: 'teacher' | 'student'; id: string } | null
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
  labels?: { id?: string; name: string; color?: string }[]
  sprints?: BoardSprintInput[]
  auto_sprint_weekly?: boolean
  visibility?: 'private' | 'session_shared'
  students_can_edit?: boolean
  session_id?: string
  coding_project_id?: string | null
  move_cards_from_column_id?: string
  move_cards_to_column_id?: string
}

const TASK_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#737373']
const PRIORITY_STYLE: Record<Priority, { label: string; className: string }> = {
  alta: { label: 'Alta', className: 'bg-red-50 text-red-700' },
  media: { label: 'Media', className: 'bg-amber-50 text-amber-700' },
  bassa: { label: 'Bassa', className: 'bg-slate-100 text-slate-600' },
}
const CARD_TYPE_LABEL: Record<CardType, string> = { epic: 'Epic', story: 'Story', task: 'Task' }
const FRAMEWORKS = [
  { id: 'kanban', label: 'Kanban', hint: 'Task operativi in un flusso continuo' },
  { id: 'scrum', label: 'Scrum / Agile', hint: 'Epic, user story, story point e sprint' },
] as const
const BACKLOG_FILE_ACCEPT = '.pdf,.docx,.pptx,.txt,.md'

type CardDraft = {
  title: string
  description: string
  color: string
  labels: string[]
  assignees: Member[]
  priority: Priority | ''
  storyPoints: string
  sprintId: string
}

const emptyDraft = (color = TASK_COLORS[0]): CardDraft => ({ title: '', description: '', color, labels: [], assignees: [], priority: '', storyPoints: '', sprintId: '' })

function draftToFields(draft: CardDraft): BoardCardFields {
  const points = Number.parseInt(draft.storyPoints, 10)
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    color: draft.color,
    labels: draft.labels,
    assignees: draft.assignees.map(({ kind, id }) => ({ kind, id })),
    priority: draft.priority || null,
    story_points: Number.isFinite(points) && points > 0 ? points : null,
    sprint_id: draft.sprintId || null,
  }
}



function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?'
}

export default function BoardManager({ sessionId, isStudent = false }: { sessionId?: string; isStudent?: boolean }) {
  const { toast } = useToast()
  const { isMobile } = useMobile()
  const queryClient = useQueryClient()
  const draggedCard = useRef<string | null>(null)
  const draggedColumn = useRef<string | null>(null)
  const cancelColumnEdit = useRef(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [templateKey, setTemplateKey] = useState('kanban')
  const [shareOnCreate, setShareOnCreate] = useState(false)
  const [createMode, setCreateMode] = useState<'ai' | 'blank'>('ai')
  const [aiFramework, setAiFramework] = useState<'kanban' | 'scrum'>('kanban')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiFile, setAiFile] = useState<File | null>(null)
  const [inlineColumnId, setInlineColumnId] = useState<string | null>(null)
  const [inlineDraft, setInlineDraft] = useState<CardDraft>(emptyDraft())
  const [dragOverCol, setDragOverCol] = useState<string | null>(null)
  const [draggingCardId, setDraggingCardId] = useState<string | null>(null)
  const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null)
  const [columnDragOver, setColumnDragOver] = useState<string | null>(null)
  const [editingColumnId, setEditingColumnId] = useState<string | null>(null)
  const [editingColumnLabel, setEditingColumnLabel] = useState('')
  const [columnToDelete, setColumnToDelete] = useState<{ columnId: string; targetId: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [openCardId, setOpenCardId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<CardDraft>(emptyDraft())
  const [labelFilter, setLabelFilter] = useState<string | null>(null)
  const [mineOnly, setMineOnly] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [labelsMenuOpen, setLabelsMenuOpen] = useState(false)
  const [sprintFilter, setSprintFilter] = useState<string | null>(null) // sprint id, 'none', or null = all
  const [sprintsOpen, setSprintsOpen] = useState(false)
  const [viewMode, setViewMode] = useState<'board' | 'timeline'>('board')
  const [boardListSearch, setBoardListSearch] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [sidebarCollapsed, toggleSidebar] = useSidebarCollapsed('boards')
  const [mobileColumnId, setMobileColumnId] = useState<string | null>(null)

  const { data: templates = [] } = useQuery({
    queryKey: ['boards-templates'],
    queryFn: async () => (await boardsApi.templates()).data as Template[],
  })
  const { data: boards = [], isLoading } = useQuery({
    queryKey: ['boards', sessionId],
    queryFn: async () => (await boardsApi.list(sessionId)).data as Board[],
  })

  const selectedSummary = useMemo(() => boards.find((board) => board.id === selectedId) || (!isMobile ? boards[0] : null), [boards, isMobile, selectedId])
  const filteredBoards = useMemo(() => {
    const query = boardListSearch.trim().toLocaleLowerCase('it')
    if (!query) return boards
    return boards.filter((item) => [item.title, item.created_by_display_name].filter(Boolean).join(' ').toLocaleLowerCase('it').includes(query))
  }, [boards, boardListSearch])
  const { data: selectedBoard } = useQuery({
    queryKey: ['board', selectedSummary?.id],
    enabled: Boolean(selectedSummary?.id),
    queryFn: async () => (await boardsApi.get(selectedSummary!.id)).data as Board,
  })
  const board = selectedBoard || selectedSummary
  const columns = board?.columns || []
  const cards = board?.cards || []
  const labels = board?.labels || []
  const sprints = board?.sprints || []
  const sprintById = useMemo(() => Object.fromEntries(sprints.map((sprint) => [sprint.id, sprint])), [sprints])
  const sprintCode = useMemo(() => Object.fromEntries(sprints.map((sprint, index) => [sprint.id, `S${index + 1}`])), [sprints])
  const activeSprintFilter = sprintFilter === 'none' || (sprintFilter && sprintById[sprintFilter]) ? sprintFilter : null
  const sprintStats = useMemo(() => {
    const stats: Record<string, { count: number; points: number }> = {}
    cards.forEach((card) => {
      const key = card.sprint_id && sprintById[card.sprint_id] ? card.sprint_id : card.card_type === 'epic' ? null : 'none'
      if (!key) return
      stats[key] = stats[key] || { count: 0, points: 0 }
      stats[key].count += 1
      stats[key].points += card.story_points || 0
    })
    return stats
  }, [cards, sprintById])
  const isScrum = board?.framework === 'scrum'
  const { data: members = [] } = useQuery({
    queryKey: ['board-members', board?.id, board?.visibility, board?.session_id],
    enabled: Boolean(board?.id),
    queryFn: async () => (await boardsApi.members(board!.id)).data as Member[],
  })
  const labelById = useMemo(() => Object.fromEntries(labels.map((label) => [label.id, label])), [labels])
  const openCard = cards.find((card) => card.id === openCardId) || null
  const activeMobileColumnId = columns.some((column) => column.id === mobileColumnId) ? mobileColumnId : columns[0]?.id

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
      setShowCreateForm(false)
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

  // Backlog generation runs as a server-side job: it survives page changes, and coming back to
  // the boards page picks up the one still running.
  const [backlogJob, setBacklogJob] = useState<BackgroundJob | null>(null)
  const followingBacklogJob = useRef<string | null>(null)
  useTicker(Boolean(backlogJob), 1000)
  const followBacklogJob = async (jobId: string) => {
    if (followingBacklogJob.current === jobId) return
    followingBacklogJob.current = jobId
    try {
      const job = await waitForJob(jobId, setBacklogJob)
      if (job.status === 'succeeded' && job.result?.board_id) {
        await queryClient.invalidateQueries({ queryKey: ['boards'] })
        setSelectedId(String(job.result.board_id))
        setShowCreateForm(false)
        toast({ title: 'Backlog generato', description: `${job.result.cards ?? 0} task in “${job.result.title ?? 'nuova board'}”.` })
      } else if (job.status !== 'succeeded') {
        toast({ title: 'Generazione non riuscita', description: job.error || 'Riprova tra poco.', variant: 'destructive' })
      }
    } catch {
      // Network hiccup: the job keeps running server-side and the navbar indicator tracks it.
    } finally {
      if (followingBacklogJob.current === jobId) followingBacklogJob.current = null
      setBacklogJob(null)
      notifyJobsChanged()
    }
  }
  useEffect(() => {
    let cancelled = false
    void findActiveJob('board_backlog').then((job) => {
      if (!job || cancelled) return
      setShowCreateForm(true)
      setCreateMode('ai')
      void followBacklogJob(job.id)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const generateBoard = useMutation({
    mutationFn: () => boardsApi.generate({
      framework: aiFramework,
      prompt: aiPrompt.trim(),
      title: title.trim(),
      session_id: sessionId,
      file: aiFile,
    }),
    onSuccess: (res) => {
      setTitle('')
      setAiPrompt('')
      setAiFile(null)
      notifyJobsChanged()
      void followBacklogJob(res.data.job_id)
    },
    onError: (error: any) => {
      toast({ title: 'Generazione non riuscita', description: error?.response?.data?.detail || 'Riprova tra poco.', variant: 'destructive' })
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
    mutationFn: ({ draft, columnId }: { draft: CardDraft; columnId: string }) => boardsApi.createCard(board!.id, {
      ...draftToFields(draft),
      title: draft.title.trim(),
      description: draft.description.trim() || undefined,
      column_id: columnId || columns[0]?.id,
    }),
    onSuccess: () => {
      setInlineDraft(emptyDraft())
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

  const updateCard = useMutation({
    mutationFn: ({ cardId, draft }: { cardId: string; draft: CardDraft }) =>
      boardsApi.updateCard(board!.id, cardId, draftToFields(draft)),
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
    setEditDraft({
      title: card.title,
      description: card.description || '',
      color: card.color || TASK_COLORS[0],
      labels: card.labels || [],
      assignees: card.assignees || [],
      priority: card.priority || '',
      storyPoints: card.story_points ? String(card.story_points) : '',
      sprintId: card.sprint_id || '',
    })
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
        if (isMobile) setMobileColumnId(column.id)
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

  const visibleCards = useMemo(() => {
    const out: BoardCard[] = []
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('it')
    const me = board?.me
    cards.forEach((card) => {
      if (labelFilter && !(card.labels || []).includes(labelFilter)) return
      if (activeSprintFilter) {
        const inSprint = (item: BoardCard) => activeSprintFilter === 'none'
          ? !(item.sprint_id && sprintById[item.sprint_id]) && item.card_type !== 'epic'
          : item.sprint_id === activeSprintFilter
        // Epics have no sprint: keep them when one of their stories is in the selected sprint.
        const epicMatches = card.card_type === 'epic' && activeSprintFilter !== 'none' && cards.some((child) => child.parent_card_id === card.id && inSprint(child))
        if (!inSprint(card) && !epicMatches) return
      }
      if (mineOnly && !(me && (card.assignees || []).some((a) => a.kind === me.kind && a.id === me.id))) return
      if (normalizedQuery) {
        const columnLabel = columns.find((column) => column.id === card.column_id)?.label || ''
        const searchableText = [
          card.title,
          card.description,
          card.created_by_display_name,
          card.last_actor_display_name,
          columnLabel,
          ...(card.labels || []).map((id) => labelById[id]?.name),
          ...(card.assignees || []).map((a) => a.name),
        ].filter(Boolean).join(' ').toLocaleLowerCase('it')
        if (!searchableText.includes(normalizedQuery)) return
      }
      out.push(card)
    })
    return out
  }, [activeSprintFilter, board?.me, cards, columns, labelById, labelFilter, mineOnly, searchQuery, sprintById])

  const grouped = useMemo(() => {
    const map: Record<string, BoardCard[]> = {}
    columns.forEach((column) => { map[column.id] = [] })
    visibleCards.forEach((card) => { (map[card.column_id] || map[columns[0]?.id] || []).push(card) })
    return map
  }, [columns, visibleCards])

  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent text-slate-900 lg:flex-row">
      {!isMobile && sidebarCollapsed && (
        <SidebarRail
          label="Board"
          expandLabel="Espandi elenco board"
          onExpand={() => toggleSidebar(false)}
          onCreate={() => { toggleSidebar(false); setShowCreateForm(true) }}
          createLabel="Nuova board"
          items={boards.map((item) => ({
            id: item.id,
            title: item.title,
            icon: <KanbanSquare className="h-4 w-4" />,
            selected: board?.id === item.id,
            onClick: () => setSelectedId(item.id),
          }))}
        />
      )}
      {(isMobile ? !board : !sidebarCollapsed) && <WorkspaceExplorerSidebar>
        <WorkspaceExplorerHeader
          eyebrow={isStudent ? 'Spazio studente' : 'Pannello docente'}
          title="Board"
          description={isMobile ? '' : (isStudent ? 'Board personali e condivise in un unico explorer.' : 'Crea e condividi board nella sessione attiva.')}
          action={(
            <div className="flex shrink-0 items-center gap-1.5">
            {!isMobile && <SidebarCollapseButton onClick={() => toggleSidebar(true)} label="Comprimi elenco board" />}
            <Button
              type="button"
              onClick={() => setShowCreateForm((value) => !value)}
              density="compact"
              tone="accent"
              surface="solid"
              className="h-9 w-9 shrink-0 rounded-full p-0"
              title="Nuova board"
              aria-label="Nuova board"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            </div>
          )}
          searchValue={boardListSearch}
          onSearchChange={setBoardListSearch}
          searchPlaceholder="Cerca board..."
          clearSearchLabel="Cancella ricerca board"
        />
        {showCreateForm && <div className="space-y-2 border-b border-slate-200/80 px-5 py-4">
          <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1" role="tablist" aria-label="Tipo di board">
            {([['ai', 'Con AI'], ['blank', 'Vuota']] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={createMode === mode}
                onClick={() => setCreateMode(mode)}
                className={`inline-flex h-8 items-center justify-center gap-1 rounded-full text-xs font-bold ${createMode === mode ? 'bg-white text-slate-900 shadow-[var(--ds-shadow-1)]' : 'text-slate-500'}`}
              >
                {mode === 'ai' && <Sparkles className="h-3.5 w-3.5" />}{label}
              </button>
            ))}
          </div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={createMode === 'ai' ? 'Titolo (facoltativo)' : 'Titolo board'} className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
          {createMode === 'ai' ? (
            <>
              <label className="block text-[11px] font-bold text-slate-500">
                Framework
                <select value={aiFramework} onChange={(e) => setAiFramework(e.target.value as 'kanban' | 'scrum')} className="mt-1 h-9 w-full rounded-lg border border-slate-200 px-2 text-sm font-normal text-slate-900">
                  {FRAMEWORKS.map((framework) => <option key={framework.id} value={framework.id}>{framework.label}</option>)}
                </select>
                <span className="mt-1 block font-normal text-slate-400">{FRAMEWORKS.find((framework) => framework.id === aiFramework)?.hint}</span>
              </label>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                rows={4}
                placeholder="Descrivi il progetto: obiettivo, destinatari, vincoli, scadenze…"
                className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
              />
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 hover:border-slate-400">
                <FileUp className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{aiFile ? aiFile.name : 'Carica un file di progetto (PDF, DOCX, PPTX, TXT, MD)'}</span>
                {aiFile && (
                  <button type="button" onClick={(e) => { e.preventDefault(); setAiFile(null) }} className="rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Rimuovi file">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <input type="file" accept={BACKLOG_FILE_ACCEPT} className="sr-only" onChange={(e) => { setAiFile(e.target.files?.[0] || null); e.target.value = '' }} />
              </label>
              <button
                type="button"
                disabled={(!aiPrompt.trim() && !aiFile) || generateBoard.isPending || Boolean(backlogJob) || (isStudent && !sessionId)}
                onClick={() => generateBoard.mutate()}
                className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-full border border-transparent bg-[image:var(--selection-active-bg)] px-3 text-sm font-bold text-[var(--selection-active-text)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {generateBoard.isPending || backlogJob ? <><Loader2 className="h-4 w-4 animate-spin" /> Genero il backlog…</> : <><Sparkles className="h-4 w-4" /> Genera backlog</>}
              </button>
              {backlogJob && (
                <div className="space-y-1">
                  <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-[image:var(--selection-active-bg)] transition-[width] duration-700" style={{ width: `${Math.round((backlogJob.progress_display ?? 0.1) * 100)}%` }} />
                  </div>
                  <p className="text-center text-[11px] text-slate-400">
                    {backlogJob.progress_label || 'Analisi del progetto…'} Puoi cambiare pagina: la generazione continua in background.
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex gap-2">
                <select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-2 text-sm">
                  {templates.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
                </select>
                <button disabled={(isStudent && !sessionId) || createBoard.isPending} onClick={() => createBoard.mutate()} className="inline-flex h-9 items-center gap-1 rounded-full border border-transparent bg-[image:var(--selection-active-bg)] px-3 text-sm font-bold text-[var(--selection-active-text)] disabled:cursor-not-allowed disabled:opacity-40">
                  <Plus className="h-4 w-4" /> Crea
                </button>
              </div>
              {sessionId && (
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                  <input type="checkbox" checked={shareOnCreate} onChange={(e) => setShareOnCreate(e.target.checked)} />
                  condividi con la classe
                </label>
              )}
            </>
          )}
          {!isStudent && (
            <p className="text-[11px] leading-4 text-slate-400">
              {sessionId ? 'La board sarà collegata alla sessione attiva.' : 'Nessuna sessione attiva: potrai condividerla con altri docenti e collegarla a una sessione in seguito.'}
            </p>
          )}
        </div>}
        <WorkspaceExplorerList>
          {isLoading ? <p className="p-3 text-sm text-slate-400">Caricamento...</p> : filteredBoards.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs leading-5 text-slate-400">
              {boardListSearch ? `Nessuna board corrisponde a “${boardListSearch}”.` : 'Nessuna board disponibile.'}
            </p>
          ) : <div className="space-y-2">{filteredBoards.map((item) => (
            <WorkspaceExplorerItem
              key={item.id}
              icon={<KanbanSquare className="h-4 w-4" />}
              title={item.title}
              subtitle={isMobile ? undefined : [
                item.created_by_display_name ? `Creata da ${item.created_by_display_name}` : null,
                !isStudent && item.session_title ? item.session_title : null,
              ].filter(Boolean).join(' · ') || undefined}
              selected={board?.id === item.id}
              onClick={() => setSelectedId(item.id)}
              badges={(
                <WorkspaceExplorerBadge>
                  <span className="inline-flex items-center gap-1">
                    {item.shared_with_me ? <Users className="h-3 w-3" /> : item.visibility === 'session_shared' ? <Share2 className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                    {item.shared_with_me ? 'Condivisa con te' : item.visibility === 'session_shared' ? 'Condivisa' : 'Privata'}
                  </span>
                </WorkspaceExplorerBadge>
              )}
              trailing={item.can_manage ? (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Eliminare la board "${item.title}"?`)) deleteBoard.mutate(item.id)
                  }}
                  className="flex w-10 items-center justify-center border-l border-white/70 text-slate-400 hover:bg-red-50/80 hover:text-red-600"
                  aria-label={`Elimina ${item.title}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : undefined}
            />
          ))}</div>}
        </WorkspaceExplorerList>
      </WorkspaceExplorerSidebar>}
      {(!isMobile || board) && <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!board ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">Crea una board per iniziare.</div>
        ) : (
          <>
            <header className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-1.5 md:flex md:flex-wrap md:justify-between md:gap-2 md:px-4 md:py-2">
              <div className="flex min-w-0 items-center gap-2">
                {isMobile && <button type="button" onClick={() => setSelectedId(null)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700" aria-label="Torna alle board"><ArrowLeft className="h-5 w-5" /></button>}
                <h2 className="truncate text-lg font-bold">{board.title}</h2>
              </div>
              <div className="col-span-2 flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 md:col-span-1">
                <div className="inline-flex h-11 shrink-0 items-center gap-0.5 rounded-xl bg-slate-100 p-1 md:h-9" role="tablist" aria-label="Vista">
                  {([['board', 'Board', KanbanSquare], ['timeline', 'Timeline', GanttChartSquare]] as const).map(([mode, label, Icon]) => (
                    <button
                      key={mode}
                      type="button"
                      role="tab"
                      aria-selected={viewMode === mode}
                      onClick={() => setViewMode(mode)}
                      className={`inline-flex h-full items-center gap-1 rounded-lg px-2.5 text-xs font-bold ${viewMode === mode ? 'bg-white text-slate-900 shadow-[var(--ds-shadow-1)]' : 'text-slate-500 hover:text-slate-800'}`}
                    >
                      <Icon className="h-4 w-4" /><span className="hidden sm:inline">{label}</span>
                    </button>
                  ))}
                </div>
                <label className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white pl-2.5 pr-1 text-xs font-bold text-slate-600 md:h-9">
                  <CalendarRange className="h-4 w-4 text-slate-400" aria-hidden="true" />
                  <span className="sr-only">Filtra per sprint</span>
                  <select
                    value={activeSprintFilter || ''}
                    onChange={(event) => setSprintFilter(event.target.value || null)}
                    className="h-full max-w-[180px] bg-transparent pr-1 text-xs font-bold text-slate-700 outline-none"
                  >
                    <option value="">Tutti gli sprint</option>
                    {sprints.map((sprint) => (
                      <option key={sprint.id} value={sprint.id}>{sprintCode[sprint.id]} · {sprint.name}{sprintStats[sprint.id] ? ` (${sprintStats[sprint.id].count})` : ''}</option>
                    ))}
                    <option value="none">Senza sprint{sprintStats.none ? ` (${sprintStats.none.count})` : ''}</option>
                  </select>
                </label>
                <SearchPill
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  placeholder="Cerca task"
                  aria-label="Cerca nelle task della board"
                  className="min-w-0 flex-1 sm:w-[260px] sm:flex-none"
                />
                {board.me && (
                  <button
                    type="button"
                    onClick={() => setMineOnly((value) => !value)}
                    aria-pressed={mineOnly}
                    className={`inline-flex h-11 items-center gap-1 rounded-xl border px-3 text-xs font-bold md:h-9 ${mineOnly ? 'border-[color:var(--selection-border-hover)] bg-[image:var(--selection-active-bg)] text-[var(--selection-active-text)]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    <UserRound className="h-4 w-4" /> I miei task
                  </button>
                )}
                {(labels.length > 0 || board.can_manage) && (
                  <div className="group relative">
                    <button type="button" onClick={() => setLabelsMenuOpen((open) => !open)} aria-expanded={labelsMenuOpen} aria-label="Filtra per etichetta" className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border text-slate-600 hover:bg-slate-50 md:h-9 md:w-9 ${labelFilter ? 'border-slate-500 bg-slate-100' : 'border-slate-200'}`} title="Etichette">
                      <Tags className="h-4 w-4" />
                    </button>
                    <div className={`${labelsMenuOpen ? 'block' : 'hidden group-hover:block group-focus-within:block'} absolute right-0 top-full z-30 min-w-44 pt-1`}>
                      <div className="rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg" role="group" aria-label="Etichette">
                        {labels.map((label) => (
                          <button key={label.id} type="button" aria-pressed={labelFilter === label.id} onClick={() => { setLabelFilter(labelFilter === label.id ? null : label.id); setLabelsMenuOpen(false) }} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-100 ${labelFilter === label.id ? 'font-bold text-slate-900' : 'text-slate-600'}`}>
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: label.color }} />{label.name}
                          </button>
                        ))}
                        {board.can_manage && <button type="button" onClick={() => { setLabelsMenuOpen(false); setLabelsOpen(true) }} className="w-full rounded-lg border-t border-slate-100 px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-100">Gestisci etichette</button>}
                      </div>
                    </div>
                  </div>
                )}
                {board.can_manage && (
                  <button type="button" onClick={() => setShareOpen(true)} className="inline-flex h-11 w-11 items-center justify-center gap-1 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 hover:bg-slate-50 md:h-9 md:w-auto md:px-3" title="Condividi">
                    {board.visibility === 'session_shared' ? <Share2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                    <span className="hidden md:inline">Condividi</span>
                  </button>
                )}
              </div>
              {(sprints.length > 0 || board.can_manage) && (
                <div className="col-span-2 w-full">
                  <div className="flex w-full items-stretch gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Sprint e date">
                    {sprints.map((sprint) => {
                      const active = activeSprintFilter === sprint.id
                      const status = sprintStatus(sprint)
                      return (
                        <button
                          key={sprint.id}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setSprintFilter(active ? null : sprint.id)}
                          title={[sprint.name, sprint.goal].filter(Boolean).join(' — ')}
                          className={`inline-flex shrink-0 items-center gap-2 rounded-xl px-2.5 py-1 text-left transition ${active ? 'bg-slate-900 text-white shadow-[var(--ds-shadow-1)]' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                          <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${active ? 'bg-white/15' : status === 'current' ? 'bg-violet-600 text-white' : 'bg-white text-slate-700'}`}>{sprintCode[sprint.id]}</span>
                          <span className="text-[11px] font-bold leading-4">
                            {formatSprintDates(sprint) || 'Date da definire'}
                            {status === 'current' && <span className={`ml-1 ${active ? 'text-white/70' : 'text-violet-600'}`}>· in corso</span>}
                          </span>
                        </button>
                      )
                    })}
                    {sprints.length === 0 && <span className="self-center text-[11px] text-slate-400">Nessuno sprint pianificato.</span>}
                    {board.can_manage && (
                      <button type="button" onClick={() => setSprintsOpen(true)} className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-dashed border-slate-300 px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:border-slate-400 hover:text-slate-800">
                        {sprints.length ? <><Edit2 className="h-3 w-3" /> Gestisci sprint</> : <><Plus className="h-3 w-3" /> Crea sprint</>}
                      </button>
                    )}
                  </div>
                  {activeSprintFilter && activeSprintFilter !== 'none' && sprintById[activeSprintFilter]?.goal && (
                    <p className="mt-1 truncate text-xs text-slate-500"><span className="font-bold text-slate-700">Obiettivo {sprintCode[activeSprintFilter]}:</span> {sprintById[activeSprintFilter].goal}</p>
                  )}
                </div>
              )}
            </header>
            {viewMode === 'timeline' ? (
              <BoardTimeline
                sprints={sprints}
                sprintCode={sprintCode}
                cards={visibleCards}
                columns={columns}
                canManage={Boolean(board.can_manage)}
                onManageSprints={() => setSprintsOpen(true)}
                onOpenCard={(id) => { setOpenCardId(id); setEditingCardId(null) }}
              />
            ) : <>
            {isMobile && <nav className="flex shrink-0 gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2" aria-label="Colonne board">
              {columns.map((column) => <button key={column.id} type="button" onClick={() => setMobileColumnId(column.id)} className={`min-h-11 shrink-0 rounded-full px-4 text-xs font-black ${activeMobileColumnId === column.id ? 'bg-[image:var(--selection-active-bg)] text-[var(--selection-active-text)]' : 'bg-slate-100 text-slate-600'}`}>{column.label} <span className="opacity-60">{(grouped[column.id] || []).length}</span></button>)}
              {board.can_manage && (
                <button
                  type="button"
                  onClick={addColumn}
                  disabled={columns.length >= 12 || updateBoard.isPending}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-dashed border-slate-300 bg-white px-4 text-xs font-black text-slate-600 disabled:opacity-40"
                  aria-label="Nuova colonna"
                >
                  <Plus className="h-4 w-4" /> Nuova colonna
                </button>
              )}
            </nav>}
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden p-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] md:p-2.5 lg:flex-row lg:overflow-x-auto lg:overflow-y-hidden lg:p-3">
              {columns.filter((column) => !isMobile || column.id === activeMobileColumnId).map((column) => (
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
                  className={`ds-panel group flex min-h-0 w-full shrink-0 flex-col overflow-hidden rounded-[var(--ds-radius-panel)] transition lg:h-full lg:w-[300px] ${
                    dragOverCol === column.id
                      ? 'ring-2 ring-sky-400'
                      : draggingCardId
                        ? 'ring-2 ring-sky-200'
                        : columnDragOver === column.id
                          ? 'ring-2 ring-violet-300'
                          : ''
                  } ${draggingColumnId === column.id ? 'opacity-50' : ''}`}
                >
                  <div
                    draggable={Boolean(!isMobile && board.can_manage && editingColumnId !== column.id)}
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
                    className={`flex w-full shrink-0 flex-row items-center gap-2 border-b border-slate-200 bg-white px-2.5 py-1.5 lg:min-h-[40px] lg:w-auto ${board.can_manage && editingColumnId !== column.id ? 'cursor-grab active:cursor-grabbing' : ''}`}
                  >
                    {board.can_manage && <GripVertical className="hidden h-4 w-4 shrink-0 text-slate-500/50 lg:block" aria-hidden="true" />}
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
                          <h3 className="flex items-center gap-1.5 text-xs font-semibold text-slate-800"><span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: column.color }} />{column.label} <span className="text-[10px] font-medium text-slate-400">{(grouped[column.id] || []).length}</span></h3>
                        </>
                      )}
                    </div>
                    {board.can_manage && editingColumnId !== column.id && (
                      <div className="flex shrink-0 items-center opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
                        <button
                          type="button"
                          onClick={() => { cancelColumnEdit.current = false; setEditingColumnId(column.id); setEditingColumnLabel(column.label) }}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-white/70 hover:text-slate-800 md:h-7 md:w-7 md:rounded-md"
                          title="Rinomina colonna"
                          aria-label={`Rinomina ${column.label}`}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        {columns.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setColumnToDelete({ columnId: column.id, targetId: columns.find((item) => item.id !== column.id)!.id })}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-white/70 hover:text-red-600 md:h-7 md:w-7 md:rounded-md"
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
                          setInlineDraft({ ...emptyDraft(), sprintId: activeSprintFilter && activeSprintFilter !== 'none' ? activeSprintFilter : '' })
                        }}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/85 text-slate-600 opacity-100 shadow-[var(--ds-shadow-1)] transition hover:border-slate-400 hover:text-slate-900 md:h-7 md:w-7 md:rounded-full md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                        aria-label={`Crea un task in ${column.label}`}
                        title={`Crea un task in ${column.label}`}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col items-stretch gap-2 overflow-x-hidden overflow-y-auto bg-slate-50/40 p-2 lg:min-h-0">
                    {inlineColumnId === column.id && (
                      <div className="ui-card w-full shrink-0 p-3">
                        <CardForm
                          heading="Nuovo task"
                          draft={inlineDraft}
                          onChange={setInlineDraft}
                          labels={labels}
                          members={members}
                          sprints={sprints}
                          showPoints={isScrum}
                          pending={createCard.isPending}
                          submitLabel={createCard.isPending ? 'Creazione…' : 'Crea task'}
                          onCancel={() => setInlineColumnId(null)}
                          onSubmit={() => createCard.mutate({ draft: inlineDraft, columnId: column.id })}
                        />
                      </div>
                    )}
                    {(grouped[column.id] || []).map((card) => (
                      <article
                        key={card.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Apri ${card.title}`}
                        onClick={() => { setOpenCardId(card.id); setEditingCardId(null) }}
                        onKeyDown={(event) => {
                          if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                            event.preventDefault()
                            setOpenCardId(card.id)
                            setEditingCardId(null)
                          }
                        }}
                        draggable={Boolean(!isMobile && board.can_edit)}
                        onDragStart={(event) => {
                          if (!board.can_edit || (event.target as HTMLElement).closest('button, input, textarea')) {
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
                        className={`ui-card ui-card-interactive w-full shrink-0 cursor-pointer p-3 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${draggingCardId === card.id ? 'opacity-50' : ''}`}
                      >
                        <div className="flex items-start gap-2">
                          <h4 className="min-w-0 flex-1 text-sm font-bold leading-5 text-slate-900">{card.title}</h4>
                          <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: card.color || '#d4d4d4' }} aria-hidden="true" />
                        </div>
                        {((card.card_type && card.card_type !== 'task') || (card.labels || []).some((id) => labelById[id]) || (card.sprint_id && sprintById[card.sprint_id])) && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {card.sprint_id && sprintById[card.sprint_id] && (
                              <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] font-black text-white" title={sprintById[card.sprint_id].name}>{sprintCode[card.sprint_id]}</span>
                            )}
                            {card.card_type && card.card_type !== 'task' && (
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${card.card_type === 'epic' ? 'bg-violet-100 text-violet-700' : 'bg-sky-50 text-sky-700'}`}>{CARD_TYPE_LABEL[card.card_type]}</span>
                            )}
                            {(card.labels || []).map((id) => labelById[id] && (
                              <span key={id} className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ backgroundColor: `${labelById[id].color}1f`, color: labelById[id].color }}>
                                {labelById[id].name}
                              </span>
                            ))}
                          </div>
                        )}
                        {(card.priority || card.story_points || (card.assignees || []).length > 0) && (
                          <div className="mt-2 flex items-center gap-1.5">
                            {card.priority && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${PRIORITY_STYLE[card.priority].className}`}>{PRIORITY_STYLE[card.priority].label}</span>}
                            {card.story_points ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600" title="Story point">{card.story_points} pt</span> : null}
                            <AssigneeStack people={card.assignees || []} />
                          </div>
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
              {!isMobile && board.can_manage && (
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
            </>}
          </>
        )}
      </main>}
      {openCard && board && (
        <CardDetailModal
          card={openCard}
          columns={columns}
          labelById={labelById}
          sprint={openCard.sprint_id ? sprintById[openCard.sprint_id] : undefined}
          sprintLabel={openCard.sprint_id ? sprintCode[openCard.sprint_id] : undefined}
          cards={cards}
          canEdit={Boolean(board.can_edit)}
          editing={editingCardId === openCard.id}
          editForm={(
            <CardForm
              draft={editDraft}
              onChange={setEditDraft}
              labels={labels}
              members={members}
              sprints={sprints}
              showPoints={isScrum || openCard.card_type === 'story'}
              pending={updateCard.isPending}
              submitLabel={updateCard.isPending ? 'Salvataggio…' : 'Salva'}
              onCancel={() => setEditingCardId(null)}
              onSubmit={() => updateCard.mutate({ cardId: openCard.id, draft: editDraft })}
            />
          )}
          onEdit={() => startEditingCard(openCard)}
          onMove={(columnId) => moveCard.mutate({ cardId: openCard.id, columnId })}
          onDelete={() => {
            if (window.confirm(`Eliminare il task "${openCard.title}"?`)) {
              deleteCard.mutate(openCard.id, { onSuccess: () => setOpenCardId(null) })
            }
          }}
          deletePending={deleteCard.isPending}
          onOpenCard={(id) => { setOpenCardId(id); setEditingCardId(null) }}
          onClose={() => { setOpenCardId(null); setEditingCardId(null) }}
        />
      )}
      {shareOpen && board?.can_manage && (
        <BoardShareDialog
          board={board}
          activeSessionId={sessionId}
          isStudent={isStudent}
          onClose={() => setShareOpen(false)}
          onBoardPatch={(patch) => updateBoard.mutate(patch, {
            onError: (error: any) => toast({ title: 'Modifica non salvata', description: error?.response?.data?.detail || 'Riprova tra poco.', variant: 'destructive' }),
          })}
          boardPatchPending={updateBoard.isPending}
        />
      )}
      {sprintsOpen && board?.can_manage && (
        <BoardSprintsDialog
          sprints={sprints}
          autoSprintWeekly={Boolean(board.auto_sprint_weekly)}
          cardCounts={Object.fromEntries(Object.entries(sprintStats).map(([id, stats]) => [id, stats.count]))}
          pending={updateBoard.isPending}
          onClose={() => setSprintsOpen(false)}
          onSave={(next, automatic) => updateBoard.mutate({ sprints: next, auto_sprint_weekly: automatic }, {
            onSuccess: () => setSprintsOpen(false),
            onError: (error: any) => toast({ title: 'Sprint non salvati', description: error?.response?.data?.detail || 'Riprova tra poco.', variant: 'destructive' }),
          })}
        />
      )}
      {labelsOpen && board?.can_manage && (
        <BoardLabelsDialog
          labels={labels}
          pending={updateBoard.isPending}
          onClose={() => setLabelsOpen(false)}
          onSave={(next) => updateBoard.mutate({ labels: next }, {
            onSuccess: () => {
              setLabelsOpen(false)
              if (labelFilter && !next.some((label) => label.id === labelFilter)) setLabelFilter(null)
            },
          })}
        />
      )}
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

function CardForm({ heading, draft, onChange, labels, members, sprints, showPoints, pending, submitLabel, onCancel, onSubmit }: {
  heading?: string
  draft: CardDraft
  onChange: (draft: CardDraft) => void
  labels: BoardLabel[]
  members: Member[]
  sprints: BoardSprint[]
  showPoints: boolean
  pending: boolean
  submitLabel: string
  onCancel: () => void
  onSubmit: () => void
}) {
  const [showPeople, setShowPeople] = useState(false)
  const set = (patch: Partial<CardDraft>) => onChange({ ...draft, ...patch })
  const isAssigned = (member: Member) => draft.assignees.some((a) => a.kind === member.kind && a.id === member.id)
  const fieldLabel = 'block text-[10px] font-bold uppercase tracking-wide text-slate-500'
  const inputClass = 'mt-1 w-full rounded-md border border-slate-200 px-2 text-sm font-normal normal-case tracking-normal text-slate-900 outline-none focus:ring-2 focus:ring-slate-300'
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (draft.title.trim()) onSubmit()
      }}
    >
      {heading && (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-black text-slate-700">{heading}</p>
          <button type="button" onClick={onCancel} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Annulla">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <label className={fieldLabel}>
        Titolo
        <input autoFocus required value={draft.title} onChange={(e) => set({ title: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }} placeholder="Cosa bisogna fare?" className={`${inputClass} h-8`} />
      </label>
      <label className={fieldLabel}>
        Descrizione <span className="font-normal normal-case">(facoltativa)</span>
        <textarea value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Aggiungi indicazioni" rows={3} className={`${inputClass} resize-none py-1.5`} />
      </label>
      {labels.length > 0 && (
        <div>
          <p className={fieldLabel}>Etichette</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {labels.map((label) => {
              const active = draft.labels.includes(label.id)
              return (
                <button
                  key={label.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => set({ labels: active ? draft.labels.filter((id) => id !== label.id) : [...draft.labels, label.id] })}
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${active ? 'text-white' : 'bg-slate-100 text-slate-500'}`}
                  style={active ? { backgroundColor: label.color } : undefined}
                >
                  {label.name}
                </button>
              )
            })}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <label className={`${fieldLabel} flex-1`}>
          Priorità
          <select value={draft.priority} onChange={(e) => set({ priority: e.target.value as Priority | '' })} className={`${inputClass} h-8 bg-white`}>
            <option value="">—</option>
            <option value="alta">Alta</option>
            <option value="media">Media</option>
            <option value="bassa">Bassa</option>
          </select>
        </label>
        {sprints.length > 0 && (
          <label className={`${fieldLabel} flex-1`}>
            Sprint
            <select value={draft.sprintId} onChange={(e) => set({ sprintId: e.target.value })} className={`${inputClass} h-8 bg-white`}>
              <option value="">Nessuno</option>
              {sprints.map((sprint, index) => <option key={sprint.id} value={sprint.id}>S{index + 1} · {sprint.name}</option>)}
            </select>
          </label>
        )}
        {showPoints && (
          <label className={`${fieldLabel} w-20`}>
            Punti
            <input type="number" min={1} max={100} value={draft.storyPoints} onChange={(e) => set({ storyPoints: e.target.value })} className={`${inputClass} h-8`} />
          </label>
        )}
      </div>
      {members.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowPeople((value) => !value)} className={`${fieldLabel} flex w-full items-center justify-between`}>
            <span>Assegnatari{draft.assignees.length ? ` · ${draft.assignees.length}` : ''}</span>
            <span className="font-normal normal-case text-slate-400">{showPeople ? 'chiudi' : 'modifica'}</span>
          </button>
          {!showPeople && draft.assignees.length > 0 && (
            <p className="mt-1 truncate text-xs text-slate-600">{draft.assignees.map((a) => a.name).join(', ')}</p>
          )}
          {showPeople && (
            <div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-slate-200 p-1">
              {members.map((member) => (
                <label key={`${member.kind}-${member.id}`} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                  <input
                    type="checkbox"
                    checked={isAssigned(member)}
                    onChange={(e) => set({
                      assignees: e.target.checked
                        ? [...draft.assignees, member]
                        : draft.assignees.filter((a) => !(a.kind === member.kind && a.id === member.id)),
                    })}
                  />
                  <span className="min-w-0 flex-1 truncate font-bold">{member.name}</span>
                  <span className="text-[10px] text-slate-400">{member.kind === 'teacher' ? 'docente' : 'studente'}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 pt-1">
        <ColorPicker value={draft.color} onChange={(color) => set({ color })} />
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="h-8 rounded-md px-2 text-xs font-bold text-slate-500 hover:bg-slate-100">Annulla</button>
          <button disabled={!draft.title.trim() || pending} className="inline-flex h-8 items-center gap-1 rounded-full border border-transparent bg-[image:var(--selection-active-bg)] px-3 text-xs font-bold text-[var(--selection-active-text)] disabled:cursor-not-allowed disabled:opacity-40">
            <Check className="h-3.5 w-3.5" /> {submitLabel}
          </button>
        </div>
      </div>
    </form>
  )
}

function AssigneeStack({ people, size = 'sm' }: { people: Member[]; size?: 'sm' | 'md' }) {
  if (!people.length) return null
  const dim = size === 'md' ? 'h-7 w-7 text-[10px]' : 'h-6 w-6 text-[9px]'
  return (
    <div className="ml-auto flex -space-x-1.5">
      {people.slice(0, 4).map((person) => (
        <span
          key={`${person.kind}-${person.id}`}
          className={`inline-flex ${dim} items-center justify-center rounded-full font-black ring-2 ring-white ${person.kind === 'teacher' ? 'bg-slate-800 text-white' : 'bg-teal-100 text-teal-800'}`}
          title={`${person.name}${person.kind === 'teacher' ? ' (docente)' : ''}`}
        >
          {initials(person.name)}
        </span>
      ))}
      {people.length > 4 && <span className={`inline-flex ${dim} items-center justify-center rounded-full bg-slate-100 font-black text-slate-600 ring-2 ring-white`}>+{people.length - 4}</span>}
    </div>
  )
}

function CardDetailModal({ card, columns, labelById, sprint, sprintLabel, cards, canEdit, editing, editForm, onEdit, onMove, onDelete, deletePending, onOpenCard, onClose }: {
  card: BoardCard
  columns: BoardColumn[]
  labelById: Record<string, BoardLabel>
  sprint?: BoardSprint
  sprintLabel?: string
  cards: BoardCard[]
  canEdit: boolean
  editing: boolean
  editForm: ReactNode
  onEdit: () => void
  onMove: (columnId: string) => void
  onDelete: () => void
  deletePending: boolean
  onOpenCard: (id: string) => void
  onClose: () => void
}) {
  const parent = card.parent_card_id ? cards.find((item) => item.id === card.parent_card_id) : null
  const children = cards.filter((item) => item.parent_card_id === card.id)
  const column = columns.find((item) => item.id === card.column_id)
  const cardLabels = (card.labels || []).map((id) => labelById[id]).filter(Boolean)
  const sectionTitle = 'text-[10px] font-black uppercase tracking-wide text-slate-400'

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !editing) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="ds-popover flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-[var(--ds-radius-card)] sm:rounded-[var(--ds-radius-card)]" role="dialog" aria-modal="true" aria-labelledby="board-card-title">
        <div className="flex items-start gap-3 px-6 pb-3 pt-6">
          <span className="mt-2 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: card.color || '#d4d4d4' }} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-black uppercase tracking-wide">
              {card.card_type && (
                <span className={`rounded-full px-2 py-0.5 ${card.card_type === 'epic' ? 'bg-violet-100 text-violet-700' : card.card_type === 'story' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-600'}`}>{CARD_TYPE_LABEL[card.card_type]}</span>
              )}
              {column && (
                <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-slate-700" style={{ backgroundColor: `${column.color}2e` }}>{column.label}</span>
              )}
              {sprint && <span className="inline-flex items-center gap-1 rounded-full bg-slate-900/[0.06] px-2 py-0.5 text-slate-600"><CalendarRange className="h-3 w-3" />{sprintLabel} · {sprint.name}{formatSprintDates(sprint) ? ` · ${formatSprintDates(sprint)}` : ''}</span>}
            </div>
            <h3 id="board-card-title" className="mt-1.5 text-xl font-black leading-7 text-slate-900">{card.title}</h3>
            {parent && (
              <button type="button" onClick={() => onOpenCard(parent.id)} className="mt-1 max-w-full truncate text-left text-xs font-bold text-slate-500 hover:text-slate-800 hover:underline">
                ↳ Epic: {parent.title}
              </button>
            )}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Chiudi">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-5">
          {editing ? editForm : (
            <div className="space-y-5">
              {(cardLabels.length > 0 || card.priority || card.story_points) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {cardLabels.map((label) => (
                    <span key={label.id} className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: `${label.color}1f`, color: label.color }}>{label.name}</span>
                  ))}
                  {card.priority && <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${PRIORITY_STYLE[card.priority].className}`}>Priorità {PRIORITY_STYLE[card.priority].label.toLowerCase()}</span>}
                  {card.story_points ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{card.story_points} story point</span> : null}
                </div>
              )}
              <section>
                <h4 className={sectionTitle}>Descrizione</h4>
                {card.description
                  ? <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-700">{card.description}</p>
                  : <p className="mt-1.5 text-sm text-slate-400">Nessuna descrizione.</p>}
              </section>
              <section>
                <h4 className={sectionTitle}>Assegnatari</h4>
                {(card.assignees || []).length ? (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {(card.assignees || []).map((person) => (
                      <li key={`${person.kind}-${person.id}`} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 py-0.5 pl-0.5 pr-2.5 text-xs font-bold text-slate-700">
                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-black ${person.kind === 'teacher' ? 'bg-slate-800 text-white' : 'bg-teal-100 text-teal-800'}`}>{initials(person.name)}</span>
                        {person.name}
                        <span className="font-normal text-slate-400">{person.kind === 'teacher' ? 'docente' : 'studente'}</span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-1.5 text-sm text-slate-400">Nessuno assegnato.</p>}
              </section>
              {children.length > 0 && (
                <section>
                  <h4 className={sectionTitle}>User story · {children.length}</h4>
                  <ul className="mt-1.5 space-y-1">
                    {children.map((child) => (
                      <li key={child.id}>
                        <button type="button" onClick={() => onOpenCard(child.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: child.color || '#d4d4d4' }} />
                          <span className="min-w-0 flex-1 truncate font-bold">{child.title}</span>
                          <span className="shrink-0 text-[10px] text-slate-400">{columns.find((item) => item.id === child.column_id)?.label}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {canEdit && columns.length > 1 && (
                <label className="block">
                  <span className={sectionTitle}>Sposta in</span>
                  <select value={card.column_id} onChange={(event) => onMove(event.target.value)} className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm">
                    {columns.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                </label>
              )}
              <p className="text-[11px] text-slate-400">
                {card.created_by_display_name && `Creato da ${card.created_by_display_name}`}
                {card.last_actor_display_name && ` · ultima modifica ${card.last_actor_display_name}`}
              </p>
            </div>
          )}
        </div>

        {canEdit && !editing && (
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-6 py-4">
            <button type="button" disabled={deletePending} onClick={onDelete} className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-bold text-red-600 hover:bg-red-50 disabled:opacity-40">
              <Trash2 className="h-4 w-4" /> Elimina
            </button>
            <button type="button" onClick={onEdit} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-transparent bg-[image:var(--selection-active-bg)] px-4 text-sm font-bold text-[var(--selection-active-text)]">
              <Edit2 className="h-4 w-4" /> Modifica
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
