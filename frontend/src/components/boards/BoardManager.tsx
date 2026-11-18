import { SectionHeading } from '@/design/primitives/SectionHeading'
import { useEffect, useMemo, useState, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { boardsApi, type BackgroundJob, type BoardCardFields, type BoardSprintInput } from '@/lib/api'
import { findActiveJob, notifyJobsChanged, useTicker, waitForJob } from '@/lib/backgroundJobs'
import { ArrowLeft, CalendarRange, Check, CheckSquare, Square, ListChecks, GanttChartSquare, Edit2, FileUp, GripVertical, KanbanSquare, LayoutTemplate, Loader2, Lock, Palette, Plus, Share2, Sparkles, Tags, Trash2, UserRound, Users, X } from '@/components/icons'
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
import BoardCardDetail from './BoardCardDetail'
import PresenceAvatars from '@/components/PresenceAvatars'
import { useResourcePresence } from '@/hooks/useResourcePresence'
import { AddColumnTile, AssigneePicker, AssigneeStack, Avatar, DescriptionEditor, DescriptionView, assigneeFields, descriptionHasContent, memberKey, type Member } from './BoardCardParts'
import { tl } from '@/i18n/tl'

type BoardColumn = { id: string; label: string; hint: string; color: string }
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
  external_people?: { id: string; name: string }[]
  auto_label?: boolean
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
  external_people?: { id?: string; name: string }[]
  auto_label?: boolean
  visibility?: 'private' | 'session_shared'
  students_can_edit?: boolean
  session_id?: string
  coding_project_id?: string | null
  move_cards_from_column_id?: string
  move_cards_to_column_id?: string
}

const TASK_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#737373']
const PRIORITY_STYLE: Record<Priority, { label: string; className: string }> = {
  alta: { label: tl("Alta"), className: 'bg-red-50 text-red-700' },
  media: { label: tl("Media"), className: 'bg-amber-50 text-amber-700' },
  bassa: { label: tl("Bassa"), className: 'bg-slate-100 text-slate-600' },
}
const CARD_TYPE_LABEL: Record<CardType, string> = { epic: 'Epic', story: 'Story', task: 'Task' }
const FRAMEWORKS = [
  { id: 'kanban', label: 'Kanban', hint: tl("Task operativi in un flusso continuo") },
  { id: 'scrum', label: 'Scrum / Agile', hint: tl("Epic, user story, story point e sprint") },
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
    assignees: assigneeFields(draft.assignees),
    priority: draft.priority || null,
    story_points: Number.isFinite(points) && points > 0 ? points : null,
    sprint_id: draft.sprintId || null,
  }
}



export default function BoardManager({ sessionId, isStudent = false }: { sessionId?: string; isStudent?: boolean }) {
  const { toast } = useToast()
  const { isMobile } = useMobile()
  const queryClient = useQueryClient()
  const draggedCard = useRef<string | null>(null)
  const draggedColumn = useRef<string | null>(null)
  const cancelColumnEdit = useRef(false)
  // Navbar quick access links here with ?board=<id>.
  const location = useLocation()
  const [selectedId, setSelectedId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('board'))
  useEffect(() => {
    const fromUrl = new URLSearchParams(location.search).get('board')
    if (fromUrl) setSelectedId(fromUrl)
  }, [location.search])
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
  const [openCardId, setOpenCardId] = useState<string | null>(null)
  const [selectMode, setSelectMode] = useState(false)
  const [pickedIds, setPickedIds] = useState<Set<string>>(() => new Set())
  const [bulkTarget, setBulkTarget] = useState('')
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
  const boardPresence = useResourcePresence('board', board?.id, isStudent ? 'student' : 'teacher')
  // Who the board is shared with (direct shares + the class), shown in the header; external people are only named, not shared with.
  const sharedPeople = useMemo(() => members.filter((member) => member.direct), [members])
  const sharedWithClass = board?.visibility === 'session_shared'
  const isShared = sharedPeople.length > 0 || sharedWithClass

  // AI clustering/labelling of the tasks (3D, Code, UI…): automatic a few seconds after tasks are added, or on demand.
  const [autoLabeling, setAutoLabeling] = useState(false)
  const autoLabelTimer = useRef<number | null>(null)
  const autoLabelBoardId = useRef<string | null>(null)
  autoLabelBoardId.current = board?.id ?? null
  useEffect(() => () => { if (autoLabelTimer.current) window.clearTimeout(autoLabelTimer.current) }, [])
  const runAutoLabel = async (mode: 'unlabeled' | 'all', silent = false) => {
    const boardId = autoLabelBoardId.current
    if (!boardId) return
    setAutoLabeling(true)
    try {
      const { data } = await boardsApi.autoLabel(boardId, mode)
      queryClient.setQueryData(['board', boardId], data.board)
      queryClient.invalidateQueries({ queryKey: ['boards'] })
      if (!silent || data.cards_labeled) {
        toast({
          title: data.cards_labeled ? tl("Task raggruppati ed etichettati") : tl("Nessun task da etichettare"),
          description: data.cards_labeled ? tl("{0} task etichettati, {1} nuove etichette.", data.cards_labeled, data.labels_created) : undefined,
        })
      }
    } catch (error: any) {
      if (!silent) toast({ title: tl("Analisi non riuscita"), description: error?.response?.data?.detail || tl("Riprova tra poco."), variant: 'destructive' })
    } finally {
      setAutoLabeling(false)
    }
  }
  const scheduleAutoLabel = () => {
    if (!board?.auto_label || !board.can_edit) return
    if (autoLabelTimer.current) window.clearTimeout(autoLabelTimer.current)
    autoLabelTimer.current = window.setTimeout(() => { void runAutoLabel('unlabeled', true) }, 3500)
  }
  const labelCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    cards.forEach((card) => (card.labels || []).forEach((id) => { counts[id] = (counts[id] || 0) + 1 }))
    return counts
  }, [cards])
  const activeMobileColumnId = columns.some((column) => column.id === mobileColumnId) ? mobileColumnId : columns[0]?.id

  const createBoard = useMutation({
    mutationFn: () => boardsApi.create({
      title: title.trim() || tl("Nuova board"),
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
      toast({ title: tl("Board creata") })
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
      queryClient.invalidateQueries({ queryKey: ['board-members', board!.id] })
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
        toast({ title: tl("Backlog generato"), description: tl("{0} task in “{1}”.", job.result.cards ?? 0, job.result.title ?? 'nuova board') })
      } else if (job.status !== 'succeeded') {
        toast({ title: tl("Generazione non riuscita"), description: job.error || tl("Riprova tra poco."), variant: 'destructive' })
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
      toast({ title: tl("Generazione non riuscita"), description: error?.response?.data?.detail || tl("Riprova tra poco."), variant: 'destructive' })
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
      toast({ title: tl("Board eliminata") })
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
      scheduleAutoLabel()
    },
    onError: (error: any) => {
      toast({
        title: tl("Impossibile creare il task"),
        description: error?.response?.data?.detail || tl("Non hai i permessi per modificare questa board."),
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

  const exitSelectMode = () => { setSelectMode(false); setPickedIds(new Set()); setBulkTarget('') }
  const togglePicked = (ids: string[], on?: boolean) => setPickedIds((prev) => {
    const next = new Set(prev)
    const add = on ?? ids.some((id) => !next.has(id))
    ids.forEach((id) => (add ? next.add(id) : next.delete(id)))
    return next
  })
  const moveMany = useMutation({
    mutationFn: ({ ids, columnId }: { ids: string[]; columnId: string }) => Promise.all(ids.map((cardId) => boardsApi.updateCard(board!.id, cardId, { column_id: columnId }))),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['board', board!.id] })
      queryClient.invalidateQueries({ queryKey: ['boards'] })
      toast({ title: tl("{0} task spostati", String(vars.ids.length)) })
      exitSelectMode()
    },
    onError: (error: any) => {
      queryClient.invalidateQueries({ queryKey: ['board', board!.id] })
      toast({ title: tl("Spostamento non riuscito"), description: error?.response?.data?.detail || tl("Riprova tra poco."), variant: 'destructive' })
    },
  })

  // Task fields are edited in place and saved as soon as they change (no edit mode).
  const patchCard = useMutation({
    mutationFn: ({ cardId, fields }: { cardId: string; fields: BoardCardFields }) => boardsApi.updateCard(board!.id, cardId, fields),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board', board!.id] })
      queryClient.invalidateQueries({ queryKey: ['board-members', board!.id] })
      queryClient.invalidateQueries({ queryKey: ['boards'] })
      scheduleAutoLabel()
    },
    onError: (error: any) => {
      toast({
        title: tl("Modifica non salvata"),
        description: error?.response?.data?.detail || tl("Riprova tra poco."),
        variant: 'destructive',
      })
    },
  })

  const deleteCard = useMutation({
    mutationFn: (cardId: string) => boardsApi.deleteCard(board!.id, cardId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['board', board!.id] })
      queryClient.invalidateQueries({ queryKey: ['boards'] })
      toast({ title: tl("Task eliminato") })
    },
    onError: (error: any) => {
      toast({
        title: tl("Impossibile eliminare il task"),
        description: error?.response?.data?.detail || tl("Riprova tra poco."),
        variant: 'destructive',
      })
    },
  })

  const addColumn = (label?: string) => {
    if (!board?.can_manage || columns.length >= 12) return
    const column: BoardColumn = {
      id: `col_${Date.now().toString(36)}`,
      label: label || tl("Nuova colonna"),
      hint: '',
      color: TASK_COLORS[columns.length % TASK_COLORS.length],
    }
    updateBoard.mutate({ columns: [...columns, column] }, {
      onSuccess: () => {
        if (isMobile) setMobileColumnId(column.id)
        if (!label) {
          cancelColumnEdit.current = false
          setEditingColumnId(column.id)
          setEditingColumnLabel(column.label)
        }
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
          expandLabel={tl("Espandi elenco board")}
          onExpand={() => toggleSidebar(false)}
          onCreate={() => { toggleSidebar(false); setShowCreateForm(true) }}
          createLabel={tl("Nuova board")}
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
          section="/teacher/boards"
          eyebrow={isStudent ? tl("Spazio studente") : tl("Pannello docente")}
          title="Board"
          description={isMobile ? '' : (isStudent ? tl("Board personali e condivise in un unico explorer.") : tl("Crea e condividi board nella sessione attiva."))}
          action={(
            <div className="flex shrink-0 items-center gap-1.5">
            {!isMobile && <SidebarCollapseButton onClick={() => toggleSidebar(true)} label={tl("Comprimi elenco board")} />}
            <Button
              type="button"
              onClick={() => setShowCreateForm((value) => !value)}
              density="compact"
              tone="accent"
              surface="solid"
              className="h-9 w-9 shrink-0 rounded-full p-0"
              title={tl("Nuova board")}
              aria-label={tl("Nuova board")}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            </div>
          )}
          searchValue={boardListSearch}
          onSearchChange={setBoardListSearch}
          searchPlaceholder={tl("Cerca board...")}
          clearSearchLabel={tl("Cancella ricerca board")}
        />
        {showCreateForm && <div className="space-y-2 border-b border-slate-200/80 px-5 py-4">
          <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1" role="tablist" aria-label={tl("Tipo di board")}>
            {([['ai', tl("Con AI")], ['blank', tl("Vuota")]] as const).map(([mode, label]) => (
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
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={createMode === 'ai' ? tl("Titolo (facoltativo)") : tl("Titolo board")} className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:ring-2 focus:ring-slate-300" />
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
                placeholder={tl("Descrivi il progetto: obiettivo, destinatari, vincoli, scadenze…")}
                className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-slate-300"
              />
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600 hover:border-slate-400">
                <FileUp className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{aiFile ? aiFile.name : tl("Carica un file di progetto (PDF, DOCX, PPTX, TXT, MD)")}</span>
                {aiFile && (
                  <button type="button" onClick={(e) => { e.preventDefault(); setAiFile(null) }} className="rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label={tl("Rimuovi file")}>
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
                {generateBoard.isPending || backlogJob ? <><Loader2 className="h-4 w-4 animate-spin" /> {tl("Genero il backlog…")}</> : <><Sparkles className="h-4 w-4" /> {tl("Genera backlog")}</>}
              </button>
              {backlogJob && (
                <div className="space-y-1">
                  <div className="h-1 overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-[image:var(--selection-active-bg)] transition-[width] duration-700" style={{ width: `${Math.round((backlogJob.progress_display ?? 0.1) * 100)}%` }} />
                  </div>
                  <p className="text-center text-[11px] text-slate-400">
                    {backlogJob.progress_label || tl("Analisi del progetto…")} {tl("Puoi cambiare pagina: la generazione continua in background.")}
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
                  <Plus className="h-4 w-4" /> {tl("Crea")}
                </button>
              </div>
              {sessionId && (
                <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                  <input type="checkbox" checked={shareOnCreate} onChange={(e) => setShareOnCreate(e.target.checked)} />
                  {tl("condividi con la classe")}
                </label>
              )}
            </>
          )}
          {!isStudent && (
            <p className="text-[11px] leading-4 text-slate-400">
              {sessionId ? tl("La board sarà collegata alla sessione attiva.") : tl("Nessuna sessione attiva: potrai condividerla con altri docenti e collegarla a una sessione in seguito.")}
            </p>
          )}
        </div>}
        <WorkspaceExplorerList>
          {isLoading ? <p className="p-3 text-sm text-slate-400">{tl("Caricamento...")}</p> : filteredBoards.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs leading-5 text-slate-400">
              {boardListSearch ? tl("Nessuna board corrisponde a “{0}”.", boardListSearch) : tl("Nessuna board disponibile.")}
            </p>
          ) : <div className="space-y-2">{filteredBoards.map((item) => (
            <WorkspaceExplorerItem
              key={item.id}
              icon={<KanbanSquare className="h-4 w-4" />}
              title={item.title}
              subtitle={isMobile ? undefined : [
                item.created_by_display_name ? tl("Creata da {0}", item.created_by_display_name) : null,
                !isStudent && item.session_title ? item.session_title : null,
              ].filter(Boolean).join(' · ') || undefined}
              selected={board?.id === item.id}
              onClick={() => setSelectedId(item.id)}
              badges={(
                <WorkspaceExplorerBadge>
                  <span className="inline-flex items-center gap-1">
                    {item.shared_with_me ? <Users className="h-3 w-3" /> : item.visibility === 'session_shared' ? <Share2 className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                    {item.shared_with_me ? tl("Condivisa con te") : item.visibility === 'session_shared' ? tl("Condivisa") : tl("Privata")}
                  </span>
                </WorkspaceExplorerBadge>
              )}
              trailing={item.can_manage ? (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(tl("Eliminare la board \"{0}\"?", item.title))) deleteBoard.mutate(item.id)
                  }}
                  className="flex w-10 items-center justify-center border-l border-white/70 text-slate-400 hover:bg-red-50/80 hover:text-red-600"
                  aria-label={tl("Elimina {0}", item.title)}
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
          <div className="flex h-full items-center justify-center text-sm text-slate-500">{tl("Crea una board per iniziare.")}</div>
        ) : (
          <>
            <header className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5 border-b border-slate-200 bg-white px-3 py-1.5 md:flex md:flex-wrap md:justify-between md:gap-2 md:px-4 md:py-2">
              <div className="flex min-w-0 items-center gap-2">
                {isMobile && <button type="button" onClick={() => setSelectedId(null)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700" aria-label={tl("Torna alle board")}><ArrowLeft className="h-5 w-5" /></button>}
                <SectionHeading section="/teacher/boards" as="h2" compact className="truncate text-lg font-bold">{board.title}</SectionHeading>
              </div>
              <div className="col-span-2 flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 md:col-span-1">
                <div className="inline-flex h-11 shrink-0 items-center gap-0.5 rounded-xl bg-slate-100 p-1 md:h-9" role="tablist" aria-label={tl("Vista")}>
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
                  <span className="sr-only">{tl("Filtra per sprint")}</span>
                  <select
                    value={activeSprintFilter || ''}
                    onChange={(event) => setSprintFilter(event.target.value || null)}
                    className="h-full max-w-[180px] bg-transparent pr-1 text-xs font-bold text-slate-700 outline-none"
                  >
                    <option value="">{tl("Tutti gli sprint")}</option>
                    {sprints.map((sprint) => (
                      <option key={sprint.id} value={sprint.id}>{sprintCode[sprint.id]} · {sprint.name}{sprintStats[sprint.id] ? ` (${sprintStats[sprint.id].count})` : ''}</option>
                    ))}
                    <option value="none">{tl("Senza sprint")}{sprintStats.none ? ` (${sprintStats.none.count})` : ''}</option>
                  </select>
                </label>
                <SearchPill
                  value={searchQuery}
                  onValueChange={setSearchQuery}
                  placeholder={tl("Cerca task")}
                  aria-label={tl("Cerca nelle task della board")}
                  className="min-w-0 flex-1 sm:w-[260px] sm:flex-none"
                />
                {board.can_edit && viewMode === 'board' && (
                  <button
                    type="button"
                    onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
                    aria-pressed={selectMode}
                    className={`inline-flex h-11 items-center gap-1 rounded-xl border px-3 text-xs font-bold md:h-9 ${selectMode ? 'border-[color:var(--selection-border-hover)] bg-[image:var(--selection-active-bg)] text-[var(--selection-active-text)]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    <ListChecks className="h-4 w-4" /> {tl("Seleziona")}
                  </button>
                )}
                {board.me && (
                  <button
                    type="button"
                    onClick={() => setMineOnly((value) => !value)}
                    aria-pressed={mineOnly}
                    className={`inline-flex h-11 items-center gap-1 rounded-xl border px-3 text-xs font-bold md:h-9 ${mineOnly ? 'border-[color:var(--selection-border-hover)] bg-[image:var(--selection-active-bg)] text-[var(--selection-active-text)]' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                  >
                    <UserRound className="h-4 w-4" /> {tl("I miei task")}
                  </button>
                )}
                {(labels.length > 0 || board.can_edit) && (
                  <div className="group relative">
                    <button type="button" onClick={() => setLabelsMenuOpen((open) => !open)} aria-expanded={labelsMenuOpen} aria-label={tl("Filtra per etichetta")} className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border text-slate-600 hover:bg-slate-50 md:h-9 md:w-9 ${labelFilter ? 'border-slate-500 bg-slate-100' : 'border-slate-200'}`} title={tl("Etichette")}>
                      {autoLabeling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Tags className="h-4 w-4" />}
                    </button>
                    <div className={`${labelsMenuOpen ? 'block' : 'hidden group-hover:block group-focus-within:block'} absolute right-0 top-full z-30 min-w-44 pt-1`}>
                      <div className="rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg" role="group" aria-label={tl("Etichette")}>
                        {labels.map((label) => (
                          <button key={label.id} type="button" aria-pressed={labelFilter === label.id} onClick={() => { setLabelFilter(labelFilter === label.id ? null : label.id); setLabelsMenuOpen(false) }} className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs hover:bg-slate-100 ${labelFilter === label.id ? 'font-bold text-slate-900' : 'text-slate-600'}`}>
                            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: label.color }} />{label.name}<span className="ml-auto pl-3 text-[10px] font-medium text-slate-400">{labelCounts[label.id] || 0}</span>
                          </button>
                        ))}
                        {board.can_manage && <button type="button" onClick={() => { setLabelsMenuOpen(false); setLabelsOpen(true) }} className="w-full rounded-lg border-t border-slate-100 px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-100">{tl("Gestisci etichette")}</button>}
                        {board.can_edit && cards.length > 0 && (
                          <div className="mt-1 space-y-0.5 border-t border-slate-100 pt-1">
                            <button type="button" disabled={autoLabeling} onClick={() => { setLabelsMenuOpen(false); void runAutoLabel('unlabeled') }} className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                              <Sparkles className="h-3.5 w-3.5" /> {tl("Raggruppa ed etichetta i task con l’IA")}
                            </button>
                            <button type="button" disabled={autoLabeling} onClick={() => { setLabelsMenuOpen(false); void runAutoLabel('all') }} className="w-full rounded-lg px-2 py-1.5 pl-7 text-left text-[11px] text-slate-500 hover:bg-slate-50 disabled:opacity-50">
                              {tl("Rianalizza anche quelli già etichettati")}
                            </button>
                            {board.can_manage && (
                              <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] font-bold text-slate-600 hover:bg-slate-50">
                                <input type="checkbox" checked={Boolean(board.auto_label)} onChange={(event) => updateBoard.mutate({ auto_label: event.target.checked })} />
                                {tl("Etichetta automaticamente i nuovi task")}
                              </label>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
                <PresenceAvatars people={boardPresence.others} />
                {isShared && (
                  <div className="hidden h-9 shrink-0 items-center gap-1.5 rounded-xl bg-violet-50 px-2 text-[11px] font-bold text-violet-700 sm:inline-flex" aria-label={tl("Condivisa con")}>
                    <Users className="h-3.5 w-3.5" />
                    <span>{tl("Condivisa con")}</span>
                    {sharedWithClass && <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] text-white" title={board.session_title || undefined}>{tl("Tutta la classe")}</span>}
                    <span className="flex flex-wrap gap-1">{sharedPeople.map((person) => <Avatar key={memberKey(person)} person={person} ringClass="ring-violet-50" />)}</span>
                  </div>
                )}
                {board.can_manage && (
                  <button type="button" onClick={() => setShareOpen(true)} className={`inline-flex h-11 w-11 items-center justify-center gap-1 rounded-xl border text-sm font-bold md:h-9 md:w-auto md:px-3 ${isShared ? 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`} title={isShared ? tl("Condivisione") : tl("Condividi")}>
                    {board.visibility === 'session_shared' ? <Share2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                    <span className="hidden md:inline">{isShared ? tl("Condivisa") : tl("Condividi")}</span>
                  </button>
                )}
              </div>
              {(sprints.length > 0 || board.can_manage) && (
                <div className="col-span-2 w-full">
                  <div className="flex w-full items-stretch gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label={tl("Sprint e date")}>
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
                            {formatSprintDates(sprint) || tl("Date da definire")}
                            {status === 'current' && <span className={`ml-1 ${active ? 'text-white/70' : 'text-violet-600'}`}>{tl("· in corso")}</span>}
                          </span>
                        </button>
                      )
                    })}
                    {sprints.length === 0 && <span className="self-center text-[11px] text-slate-400">{tl("Nessuno sprint pianificato.")}</span>}
                    {board.can_manage && (
                      <button type="button" onClick={() => setSprintsOpen(true)} className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-dashed border-slate-300 px-2.5 py-1 text-[11px] font-bold text-slate-500 hover:border-slate-400 hover:text-slate-800">
                        {sprints.length ? <><Edit2 className="h-3 w-3" /> {tl("Gestisci sprint")}</> : <><Plus className="h-3 w-3" /> {tl("Crea sprint")}</>}
                      </button>
                    )}
                  </div>
                  {activeSprintFilter && activeSprintFilter !== 'none' && sprintById[activeSprintFilter]?.goal && (
                    <p className="mt-1 truncate text-xs text-slate-500"><span className="font-bold text-slate-700">{tl("Obiettivo")} {sprintCode[activeSprintFilter]}:</span> {sprintById[activeSprintFilter].goal}</p>
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
                onOpenCard={(id) => setOpenCardId(id)}
              />
            ) : <>
            {isMobile && <nav className="flex shrink-0 gap-2 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2" aria-label={tl("Colonne board")}>
              {columns.map((column) => <button key={column.id} type="button" onClick={() => setMobileColumnId(column.id)} className={`min-h-11 shrink-0 rounded-full px-4 text-xs font-black ${activeMobileColumnId === column.id ? 'bg-[image:var(--selection-active-bg)] text-[var(--selection-active-text)]' : 'bg-slate-100 text-slate-600'}`}>{column.label} <span className="opacity-60">{(grouped[column.id] || []).length}</span></button>)}
              {board.can_manage && (
                <button
                  type="button"
                  onClick={() => addColumn()}
                  disabled={columns.length >= 12 || updateBoard.isPending}
                  className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border border-dashed border-slate-300 bg-white px-4 text-xs font-black text-slate-600 disabled:opacity-40"
                  aria-label={tl("Nuova colonna")}
                >
                  <Plus className="h-4 w-4" /> {tl("Nuova colonna")}
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
                            aria-label={tl("Rinomina {0}", column.label)}
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
                          title={tl("Rinomina colonna")}
                          aria-label={tl("Rinomina {0}", column.label)}
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        {columns.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setColumnToDelete({ columnId: column.id, targetId: columns.find((item) => item.id !== column.id)!.id })}
                            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-white/70 hover:text-red-600 md:h-7 md:w-7 md:rounded-md"
                            title={tl("Elimina colonna")}
                            aria-label={tl("Elimina {0}", column.label)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                    {selectMode && (grouped[column.id] || []).length > 0 && (
                      <button type="button" onClick={() => togglePicked((grouped[column.id] || []).map((item) => item.id))}
                        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2 text-[11px] font-bold text-slate-600 hover:bg-slate-900/[0.06]"
                        title={tl("Seleziona tutti i task della colonna")} aria-label={tl("Seleziona tutti i task della colonna")}>
                        {(grouped[column.id] || []).every((item) => pickedIds.has(item.id)) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                      </button>
                    )}
                    {board.can_edit && !selectMode && (
                      <button
                        type="button"
                        onClick={() => {
                          setInlineColumnId(column.id)
                          setInlineDraft({ ...emptyDraft(), sprintId: activeSprintFilter && activeSprintFilter !== 'none' ? activeSprintFilter : '' })
                        }}
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/85 text-slate-600 opacity-100 shadow-[var(--ds-shadow-1)] transition hover:border-slate-400 hover:text-slate-900 md:h-7 md:w-7 md:rounded-full md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                        aria-label={tl("Crea un task in {0}", column.label)}
                        title={tl("Crea un task in {0}", column.label)}
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col items-stretch gap-2 overflow-x-hidden overflow-y-auto bg-slate-50/40 p-2 lg:min-h-0">
                    {inlineColumnId === column.id && (
                      <div className="ui-card w-full shrink-0 p-3">
                        <CardForm
                          boardId={board.id}
                          heading={tl("Nuovo task")}
                          draft={inlineDraft}
                          onChange={setInlineDraft}
                          labels={labels}
                          members={members}
                          sprints={sprints}
                          showPoints={isScrum}
                          pending={createCard.isPending}
                          submitLabel={createCard.isPending ? tl("Creazione…") : tl("Crea task")}
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
                        aria-label={tl("Apri {0}", card.title)}
                        aria-pressed={selectMode ? pickedIds.has(card.id) : undefined}
                        onClick={() => (selectMode ? togglePicked([card.id]) : setOpenCardId(card.id))}
                        onKeyDown={(event) => {
                          if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                            event.preventDefault()
                            if (selectMode) togglePicked([card.id])
                            else setOpenCardId(card.id)
                          }
                        }}
                        draggable={Boolean(!isMobile && board.can_edit && !selectMode)}
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
                        className={`group/card ui-card ui-card-interactive w-full shrink-0 cursor-pointer p-3 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${draggingCardId === card.id ? 'opacity-50' : ''} ${selectMode && pickedIds.has(card.id) ? 'ring-2 ring-[var(--logo-violet)]' : ''}`}
                      >
                        <div className="flex items-start gap-2">
                          {selectMode && (pickedIds.has(card.id) ? <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-[var(--logo-violet)]" aria-hidden="true" /> : <Square className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />)}
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
                          <div className="mt-2 flex items-start gap-1.5">
                            {card.priority && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${PRIORITY_STYLE[card.priority].className}`}>{PRIORITY_STYLE[card.priority].label}</span>}
                            {card.story_points ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600" title="Story point">{card.story_points} pt</span> : null}
                            <AssigneeStack people={card.assignees || []} />
                          </div>
                        )}
                        {descriptionHasContent(card.description) && (
                          // Hovering (or focusing) the task unfolds its content right in the column.
                          <div className="grid grid-rows-[0fr] transition-[grid-template-rows] duration-200 ease-out group-hover/card:grid-rows-[1fr] group-focus-within/card:grid-rows-[1fr]">
                            <div className="min-h-0 overflow-hidden">
                              <div className="mt-2 max-h-64 overflow-y-auto border-t border-slate-200/70 pt-2 text-xs leading-5 text-slate-600">
                                <DescriptionView text={card.description || ''} compact />
                              </div>
                            </div>
                          </div>
                        )}
                      </article>
                    ))}
                    {(grouped[column.id] || []).length === 0 && (
                      <div className={`flex min-w-[180px] flex-1 items-center justify-center text-xs ${draggingCardId ? 'font-bold text-sky-600' : 'text-slate-300'}`}>
                        <LayoutTemplate className="mr-1 h-3 w-3" />
                        {draggingCardId ? tl("Rilascia qui") : searchQuery ? tl("Nessun risultato") : tl("Nessun task")}
                      </div>
                    )}
                  </div>
                </section>
              ))}
              {!isMobile && board.can_manage && (
                <AddColumnTile existing={columns.map((column) => column.label)} disabled={columns.length >= 12 || updateBoard.isPending} onAdd={(label) => addColumn(label)} />
              )}
            </div>
            </>}
          </>
        )}
      </main>}
      {selectMode && board?.can_edit && (
        <div className="ds-popover fixed bottom-4 left-1/2 z-40 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-[var(--ds-radius-card)] px-3 py-2" role="toolbar" aria-label={tl("Azioni sui task selezionati")}>
          <span className="px-1 text-sm font-bold text-slate-800">{tl("{0} selezionati", String(pickedIds.size))}</span>
          <select value={bulkTarget} onChange={(event) => setBulkTarget(event.target.value)} aria-label={tl("Sposta in")} className="ds-field h-10 rounded-[var(--ds-field-radius)] px-3 text-sm font-bold">
            <option value="">{tl("Sposta in…")}</option>
            {columns.map((column) => <option key={column.id} value={column.id}>{column.label}</option>)}
          </select>
          <Button tone="accent" surface="solid" disabled={!pickedIds.size || !bulkTarget || moveMany.isPending} onClick={() => moveMany.mutate({ ids: Array.from(pickedIds), columnId: bulkTarget })}>
            {moveMany.isPending ? tl("Spostamento…") : tl("Sposta")}
          </Button>
          <Button tone="neutral" surface="ghost" onClick={exitSelectMode}>{tl("Fine")}</Button>
        </div>
      )}
      {openCard && board && (
        <BoardCardDetail
          boardId={board.id}
          card={openCard}
          columns={columns}
          labels={labels}
          members={members}
          sprints={sprints}
          cards={cards}
          canEdit={Boolean(board.can_edit)}
          showPoints={isScrum || openCard.card_type === 'story'}
          colorControl={<ColorPicker value={openCard.color || TASK_COLORS[0]} onChange={(color) => patchCard.mutate({ cardId: openCard.id, fields: { color } })} compact />}
          onPatch={(fields) => patchCard.mutate({ cardId: openCard.id, fields })}
          onMove={(columnId) => moveCard.mutate({ cardId: openCard.id, columnId })}
          onDelete={() => {
            if (window.confirm(tl("Eliminare il task \"{0}\"?", openCard.title))) {
              deleteCard.mutate(openCard.id, { onSuccess: () => setOpenCardId(null) })
            }
          }}
          deletePending={deleteCard.isPending}
          onOpenCard={(id) => setOpenCardId(id)}
          onClose={() => setOpenCardId(null)}
        />
      )}
      {shareOpen && board?.can_manage && (
        <BoardShareDialog
          board={board}
          activeSessionId={sessionId}
          isStudent={isStudent}
          onClose={() => setShareOpen(false)}
          onBoardPatch={(patch) => updateBoard.mutate(patch, {
            onError: (error: any) => toast({ title: tl("Modifica non salvata"), description: error?.response?.data?.detail || tl("Riprova tra poco."), variant: 'destructive' }),
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
            onError: (error: any) => toast({ title: tl("Sprint non salvati"), description: error?.response?.data?.detail || tl("Riprova tra poco."), variant: 'destructive' }),
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
                <h3 id="delete-column-title" className="text-lg font-black text-slate-900">{tl("Elimina colonna")}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {tl("I task di “")}{columns.find((column) => column.id === columnToDelete.columnId)?.label}{tl("” devono essere spostati prima dell’eliminazione.")}
                </p>
              </div>
              <button type="button" onClick={() => setColumnToDelete(null)} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={tl("Chiudi")}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="mt-5 block text-xs font-bold uppercase tracking-wide text-slate-500">
              {tl("Sposta i task in")}
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
              <button type="button" onClick={() => setColumnToDelete(null)} className="h-10 rounded-lg px-4 text-sm font-bold text-slate-600 hover:bg-slate-100">{tl("Annulla")}</button>
              <button type="button" disabled={updateBoard.isPending} onClick={confirmDeleteColumn} className="h-10 rounded-lg bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
                {updateBoard.isPending ? tl("Eliminazione…") : tl("Sposta ed elimina")}
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
        title={tl("Colore task")}
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

function CardForm({ boardId, heading, draft, onChange, labels, members, sprints, showPoints, pending, submitLabel, onCancel, onSubmit }: {
  boardId: string
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
  const set = (patch: Partial<CardDraft>) => onChange({ ...draft, ...patch })
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
          <button type="button" onClick={onCancel} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={tl("Annulla")}>
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
      <label className={fieldLabel}>
        {tl("Titolo")}
        <input autoFocus required value={draft.title} onChange={(e) => set({ title: e.target.value })} onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }} placeholder={tl("Cosa bisogna fare?")} className={`${inputClass} h-8`} />
      </label>
      <div className={fieldLabel}>
        {tl("Descrizione")} <span className="font-normal normal-case">(facoltativa)</span>
        <DescriptionEditor boardId={boardId} value={draft.description} onChange={(description) => set({ description })} placeholder={tl("Aggiungi indicazioni")} rows={3} className={`${inputClass} resize-none py-1.5`} />
      </div>
      {labels.length > 0 && (
        <div>
          <p className={fieldLabel}>{tl("Etichette")}</p>
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
          {tl("Priorità")}
          <select value={draft.priority} onChange={(e) => set({ priority: e.target.value as Priority | '' })} className={`${inputClass} h-8 bg-white`}>
            <option value="">—</option>
            <option value="alta">{tl("Alta")}</option>
            <option value="media">{tl("Media")}</option>
            <option value="bassa">{tl("Bassa")}</option>
          </select>
        </label>
        {sprints.length > 0 && (
          <label className={`${fieldLabel} flex-1`}>
            Sprint
            <select value={draft.sprintId} onChange={(e) => set({ sprintId: e.target.value })} className={`${inputClass} h-8 bg-white`}>
              <option value="">{tl("Nessuno")}</option>
              {sprints.map((sprint, index) => <option key={sprint.id} value={sprint.id}>S{index + 1} · {sprint.name}</option>)}
            </select>
          </label>
        )}
        {showPoints && (
          <label className={`${fieldLabel} w-20`}>
            {tl("Punti")}
            <input type="number" min={1} max={100} value={draft.storyPoints} onChange={(e) => set({ storyPoints: e.target.value })} className={`${inputClass} h-8`} />
          </label>
        )}
      </div>
      <div>
        <p className={fieldLabel}>{tl("Responsabili")}{draft.assignees.length ? ` · ${draft.assignees.length}` : ''}</p>
        <div className="mt-1"><AssigneePicker members={members} value={draft.assignees} onChange={(assignees) => set({ assignees })} /></div>
      </div>
      <div className="flex items-center justify-between gap-2 pt-1">
        <ColorPicker value={draft.color} onChange={(color) => set({ color })} />
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="h-8 rounded-md px-2 text-xs font-bold text-slate-500 hover:bg-slate-100">{tl("Annulla")}</button>
          <button disabled={!draft.title.trim() || pending} className="inline-flex h-8 items-center gap-1 rounded-full border border-transparent bg-[image:var(--selection-active-bg)] px-3 text-xs font-bold text-[var(--selection-active-text)] disabled:cursor-not-allowed disabled:opacity-40">
            <Check className="h-3.5 w-3.5" /> {submitLabel}
          </button>
        </div>
      </div>
    </form>
  )
}
