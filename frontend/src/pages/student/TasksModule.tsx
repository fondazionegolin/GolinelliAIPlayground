import { useState, useEffect, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { studentApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import {
  ClipboardList, Check, Clock, Send, Lightbulb,
  ChevronLeft, ChevronRight, X,
  Award, CheckCircle2,
  Monitor, PenTool, BookOpen,
  Search, LayoutGrid, List
} from 'lucide-react'
import { loadStudentAccent, getStudentAccentTheme } from '@/lib/studentAccent'
import { TrackedCorrectionText } from '@/components/tasks/TrackedCorrectionText'

interface QuizQuestion {
  question: string
  options: string[]
  correctIndex: number
}

interface TaskContent {
  type: 'quiz' | 'exercise' | 'discussion' | 'presentation' | 'lesson' | 'presentation_v2' | 'document_v1' | 'student_presentation' | 'student_document' | 'student_sheet' | 'student_canvas'
  questions?: QuizQuestion[]
  text?: string
  hint?: string
  instructions?: string
  examples?: string[]
  difficulty?: 'easy' | 'medium' | 'hard'
  title?: string
  description?: string
  slides?: any[]
  htmlContent?: string
}

interface TaskData {
  id: string
  title: string
  description: string | null
  task_type: string
  due_at: string | null
  points: string | null
  content_json: string | null
  created_at: string
  uda_folder?: string
  submission: {
    id: string
    content: string
    content_json?: string
    submitted_at: string
    score: string | null
    feedback: string | null
    answer_feedback?: Record<string, string>
    feedback_published_at?: string | null
    feedback_read_at?: string | null
    correction?: {
      kind: 'exercise_inline'
      status: 'pending' | 'read'
      original_content: string
      suggested_content: string
      teacher_name?: string
      updated_at: string
      read_at?: string | null
    } | null
  } | null
}

interface StudentTaskDraft {
  response?: string
  exerciseResponse?: string
  quizAnswers?: Record<number, number>
  quizIndex?: number
  updatedAt: string
}

const taskDraftKey = (studentId: string, taskId: string) => `student-task-draft:${studentId}:${taskId}`

function loadTaskDraft(studentId: string, taskId: string): StudentTaskDraft | null {
  try {
    const raw = localStorage.getItem(taskDraftKey(studentId, taskId))
    return raw ? JSON.parse(raw) as StudentTaskDraft : null
  } catch {
    return null
  }
}

function hasMeaningfulDraft(draft: StudentTaskDraft) {
  return Boolean(
    draft.response?.trim()
    || draft.exerciseResponse?.trim()
    || Object.keys(draft.quizAnswers || {}).length
  )
}

function saveTaskDraft(studentId: string, taskId: string, draft: StudentTaskDraft) {
  if (hasMeaningfulDraft(draft)) localStorage.setItem(taskDraftKey(studentId, taskId), JSON.stringify(draft))
  else localStorage.removeItem(taskDraftKey(studentId, taskId))
}

interface TasksModuleProps {
  openTaskId?: string | null
  studentId?: string
  onOpenDocument?: (taskId: string) => void
  readOnly?: boolean
}

const fuzzyMatch = (query: string, ...fields: string[]) => {
  if (!query.trim()) return true
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const target = fields.join(' ').toLowerCase()
  return terms.every(term => target.includes(term))
}

export default function TasksModule({ openTaskId, studentId = 'anonymous', onOpenDocument, readOnly = false }: TasksModuleProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(openTaskId || null)
  const [accentTheme] = useState(getStudentAccentTheme(loadStudentAccent()))
  const [taskSearch, setTaskSearch] = useState('')
  const [draftTaskIds, setDraftTaskIds] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(
    () => (localStorage.getItem('student_tasks_view') as 'grid' | 'list') || 'grid'
  )

  useEffect(() => {
    localStorage.setItem('student_tasks_view', viewMode)
  }, [viewMode])

  const { data: tasks, isLoading, refetch } = useQuery<TaskData[]>({
    queryKey: ['student-tasks'],
    queryFn: async () => {
      const res = await studentApi.getTasks()
      return res.data
    },
  })

  useEffect(() => {
    if (!tasks) return
    setDraftTaskIds(new Set(tasks.filter(task => {
      const draft = loadTaskDraft(studentId, task.id)
      return !task.submission && draft && hasMeaningfulDraft(draft)
    }).map(task => task.id)))
  }, [studentId, tasks])

  const handleDraftStateChange = useCallback((taskId: string, hasDraft: boolean) => {
    setDraftTaskIds(current => {
      const next = new Set(current)
      if (hasDraft) next.add(taskId)
      else next.delete(taskId)
      return next
    })
  }, [])

  useEffect(() => {
    const handleCorrection = (event: Event) => {
      const detail = (event as CustomEvent<{ task_id?: string }>).detail
      queryClient.invalidateQueries({ queryKey: ['student-tasks'] })
      if (detail?.task_id) setSelectedTaskId(detail.task_id)
      toast({
        title: 'Nuova correzione del docente',
        description: 'Apri il compito, leggi le modifiche evidenziate e conferma con “Ho letto”.',
      })
    }
    window.addEventListener('student-task-correction', handleCorrection)
    return () => window.removeEventListener('student-task-correction', handleCorrection)
  }, [queryClient, toast])

  useEffect(() => {
    const handleFeedback = (event: Event) => {
      const detail = (event as CustomEvent<{ task_id?: string }>).detail
      queryClient.invalidateQueries({ queryKey: ['student-tasks'] })
      if (detail?.task_id) setSelectedTaskId(detail.task_id)
      toast({ title: 'Nuovo feedback del docente', description: 'Apri il compito per leggere la valutazione e i commenti.' })
    }
    window.addEventListener('student-task-feedback', handleFeedback)
    return () => window.removeEventListener('student-task-feedback', handleFeedback)
  }, [queryClient, toast])

  const selectedTask = useMemo(() =>
    tasks?.find(t => t.id === selectedTaskId),
    [tasks, selectedTaskId]
  )

  const visibleTasks = useMemo(
    () => (tasks || []).filter(task => fuzzyMatch(taskSearch, task.title, task.description || '', task.task_type)),
    [taskSearch, tasks]
  )
  const pendingTasks = useMemo(() => visibleTasks
    .filter(task => !task.submission)
    .sort((a, b) => {
      const aDue = a.due_at ? new Date(a.due_at).getTime() : Number.POSITIVE_INFINITY
      const bDue = b.due_at ? new Date(b.due_at).getTime() : Number.POSITIVE_INFINITY
      if (aDue !== bDue) return aDue - bDue
      return Number(draftTaskIds.has(b.id)) - Number(draftTaskIds.has(a.id))
    }), [draftTaskIds, visibleTasks])
  const completedTasks = useMemo(() => visibleTasks
    .filter(task => task.submission)
    .sort((a, b) => new Date(b.submission!.submitted_at).getTime() - new Date(a.submission!.submitted_at).getTime()), [visibleTasks])

  useEffect(() => {
    if (openTaskId) setSelectedTaskId(openTaskId)
  }, [openTaskId])

  // If we need to open a specific task but it's not in the cache yet, refetch
  useEffect(() => {
    if (selectedTaskId && !isLoading && tasks && !tasks.find(t => t.id === selectedTaskId)) {
      refetch()
    }
  }, [selectedTaskId, tasks, isLoading, refetch])

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center p-12">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        >
          <LoaderIcon className="h-8 w-8 text-slate-300" />
        </motion.div>
      </div>
    )
  }

  if (!tasks || tasks.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-100 p-12 text-center">
        <div className="w-20 h-20 rounded-xl border border-emerald-200 bg-emerald-100 flex items-center justify-center mb-6 shadow-sm">
          <ClipboardList className="h-10 w-10 text-emerald-800" />
        </div>
        <h3 className="text-xl font-black text-slate-950 mb-2">{t('tasks.empty_title')}</h3>
        <p className="text-slate-600 max-w-sm">
          {t('tasks.empty_body')}
        </p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col relative overflow-hidden bg-slate-100">
      <section className="relative shrink-0 border-b border-slate-200 bg-white/70 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4 py-7 md:px-6">
          <div className="mx-auto max-w-3xl text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: accentTheme.text }}>Compiti</p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{t('tasks.title')}</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              {readOnly ? 'Consulta attività, istruzioni e consegne in modalità sola lettura.' : t('tasks.subtitle')}
            </p>
            <label className="mx-auto mt-6 flex max-w-xl items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 shadow-sm">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                type="text"
                value={taskSearch}
                onChange={e => setTaskSearch(e.target.value)}
                placeholder="Cerca compiti..."
                className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none"
              />
              {taskSearch && (
                <button
                  type="button"
                  onClick={() => setTaskSearch('')}
                  className="rounded-full p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                  aria-label="Cancella ricerca"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </label>
            <div className="mt-5 flex items-center justify-center gap-2">
              <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 p-0.5 shadow-sm">
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  aria-label="Vista griglia"
                  title="Vista griglia"
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <LayoutGrid className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  aria-label="Vista lista"
                  title="Vista lista"
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${viewMode === 'list' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  <List className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-100 px-3 py-1.5 text-emerald-800 shadow-sm">
                <Award className="h-3.5 w-3.5 text-emerald-700" />
                <span className="text-xs font-bold">
                  {tasks.filter(task => task.submission).length}/{tasks.length}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24 pt-5 md:px-6 md:pb-8">
        <div className="mx-auto w-full max-w-6xl">
          {visibleTasks.length === 0 && taskSearch ? (
            <p className="py-10 text-center text-sm text-slate-400">Nessun compito corrisponde a "{taskSearch}"</p>
          ) : (
            <div className="space-y-8">
              <TaskSection
                title="Da consegnare"
                subtitle="Parti da qui: bozze e attività ancora da completare"
                tasks={pendingTasks}
                viewMode={viewMode}
                draftTaskIds={draftTaskIds}
                accentColor={accentTheme.accent}
                onOpenDocument={onOpenDocument}
                onOpenTask={setSelectedTaskId}
                emptyMessage="Non hai compiti da consegnare"
              />
              {completedTasks.length > 0 && (
                <TaskSection
                  title="Consegnati"
                  subtitle="Attività completate e materiali già inviati"
                  tasks={completedTasks}
                  viewMode={viewMode}
                  draftTaskIds={draftTaskIds}
                  accentColor={accentTheme.accent}
                  onOpenDocument={onOpenDocument}
                  onOpenTask={setSelectedTaskId}
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Task Viewer Modal — rendered in a portal to escape any parent transform context */}
      {createPortal(
        <AnimatePresence>
          {selectedTask && (
            <TaskViewerOverlay
              key={selectedTask.id}
              task={selectedTask}
              studentId={studentId}
              onClose={() => setSelectedTaskId(null)}
              accentTheme={accentTheme}
              onSuccess={() => queryClient.invalidateQueries({ queryKey: ['student-tasks'] })}
              onDraftStateChange={handleDraftStateChange}
              readOnly={readOnly}
            />
          )}
        </AnimatePresence>,
        document.body
      )}

    </div>
  )
}

const TASK_TILE_STYLES: Record<string, { card: string; iconBg: string; icon: string; badge: string; time: string }> = {
  completed:    { card: 'border border-[rgba(62,169,244,0.18)] bg-[rgba(62,169,244,0.075)] shadow-sm hover:border-[rgba(62,169,244,0.30)] hover:bg-[rgba(62,169,244,0.11)] hover:shadow-lg', iconBg: 'border border-sky-200 bg-sky-100', icon: 'text-sky-800', badge: 'border border-sky-200 bg-sky-100 text-sky-800', time: 'text-sky-800' },
  quiz:         { card: 'border border-violet-200 bg-violet-50/80 shadow-sm hover:border-violet-300 hover:bg-violet-100/70 hover:shadow-lg', iconBg: 'border border-violet-200 bg-violet-100', icon: 'text-violet-800', badge: 'border border-violet-200 bg-violet-100 text-violet-800', time: 'text-violet-800' },
  lesson:       { card: 'border border-[rgba(62,169,244,0.18)] bg-[rgba(62,169,244,0.075)] shadow-sm hover:border-[rgba(62,169,244,0.30)] hover:bg-[rgba(62,169,244,0.11)] hover:shadow-lg',     iconBg: 'border border-sky-200 bg-sky-100',      icon: 'text-sky-800',     badge: 'border border-sky-200 bg-sky-100 text-sky-800',          time: 'text-sky-800' },
  presentation: { card: 'border border-[rgba(123,105,201,0.18)] bg-[rgba(123,105,201,0.075)] shadow-sm hover:border-[rgba(123,105,201,0.30)] hover:bg-[rgba(123,105,201,0.11)] hover:shadow-lg',  iconBg: 'border border-indigo-200 bg-indigo-100', icon: 'text-indigo-800', badge: 'border border-indigo-200 bg-indigo-100 text-indigo-800', time: 'text-indigo-800' },
  exercise:     { card: 'border border-orange-200 bg-orange-50/80 shadow-sm hover:border-orange-300 hover:bg-orange-100/70 hover:shadow-lg', iconBg: 'border border-orange-200 bg-orange-100', icon: 'text-orange-800', badge: 'border border-orange-200 bg-orange-100 text-orange-800', time: 'text-orange-800' },
  default:      { card: 'border border-[rgba(23,21,27,0.10)] bg-[rgba(23,21,27,0.035)] shadow-sm hover:border-[rgba(23,21,27,0.16)] hover:bg-[rgba(23,21,27,0.055)] hover:shadow-lg',   iconBg: 'border border-slate-200 bg-slate-100',   icon: 'text-slate-800',   badge: 'border border-slate-200 bg-slate-100 text-slate-800',    time: 'text-slate-700' },
}

const TASK_TYPE_LABELS: Record<string, string> = {
  lesson: 'Documento',
  quiz: 'Quiz',
  exercise: 'Esercizio',
  presentation: 'Presentazione',
}

function TaskSection({ title, subtitle, tasks, viewMode, draftTaskIds, accentColor, onOpenDocument, onOpenTask, emptyMessage }: {
  title: string
  subtitle: string
  tasks: TaskData[]
  viewMode: 'grid' | 'list'
  draftTaskIds: Set<string>
  accentColor: string
  onOpenDocument?: (taskId: string) => void
  onOpenTask: (taskId: string) => void
  emptyMessage?: string
}) {
  const openTask = (task: TaskData) => {
    if ((task.task_type === 'lesson' || task.task_type === 'presentation') && onOpenDocument) onOpenDocument(task.id)
    else onOpenTask(task.id)
  }

  return (
    <section>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-black text-slate-900">{title}</h3>
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-black text-slate-600">{tasks.length}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        </div>
      </div>
      {tasks.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-emerald-200 bg-emerald-50/50 px-5 py-7 text-center text-sm font-medium text-emerald-800">
          <CheckCircle2 className="mx-auto mb-2 h-5 w-5" />
          {emptyMessage}
        </div>
      ) : viewMode === 'list' ? (
        <div className="space-y-2">
          {tasks.map(task => (
            <TaskRow key={task.id} task={task} hasDraft={draftTaskIds.has(task.id)} onClick={() => openTask(task)} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              hasDraft={draftTaskIds.has(task.id)}
              onClick={() => openTask(task)}
              accentColor={accentColor}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function TaskCard({ task, hasDraft, onClick }: { task: TaskData; hasDraft: boolean; onClick: () => void; accentColor: string }) {
  const isCompleted = !!task.submission
  const hasUnreadFeedback = Boolean(task.submission?.feedback_published_at && !task.submission?.feedback_read_at)
  const hasUnreadCorrection = task.submission?.correction?.status === 'pending'

  const s = useMemo(() => {
    if (isCompleted) return TASK_TILE_STYLES.completed
    return TASK_TILE_STYLES[task.task_type] ?? TASK_TILE_STYLES.default
  }, [task.task_type, isCompleted])

  const typeIcon = useMemo(() => {
    switch (task.task_type) {
      case 'quiz': return <ListChecksIcon className="h-6 w-6" />
      case 'lesson': return <BookOpen className="h-6 w-6" />
      case 'presentation': return <Monitor className="h-6 w-6" />
      case 'exercise': return <PenTool className="h-6 w-6" />
      default: return <ClipboardList className="h-6 w-6" />
    }
  }, [task.task_type])

  return (
    <motion.div
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={`relative flex min-h-[124px] cursor-pointer flex-col overflow-hidden rounded-[22px] p-3.5 text-left transition-all hover:-translate-y-0.5 ${s.card}`}
    >
      <span className={`absolute right-3 top-4 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase ${hasDraft && !isCompleted ? 'border-amber-200 bg-amber-100 text-amber-800' : s.badge}`}>
        {isCompleted ? 'Fatto' : hasDraft ? 'Bozza' : (TASK_TYPE_LABELS[task.task_type] ?? task.task_type)}
      </span>
      {(hasUnreadFeedback || hasUnreadCorrection) && (
        <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-100 px-2 py-1 text-[9px] font-black uppercase tracking-wide text-amber-900">
          Nuovo feedback
        </span>
      )}
      <div className="flex items-start gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg shadow-sm ${s.iconBg} ${s.icon}`}>
          {typeIcon}
        </div>
        <div className="min-w-0 flex-1 pr-14">
          <div className="line-clamp-2 text-sm font-black leading-5 text-slate-950">{task.title}</div>
        </div>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 pt-3">
        {task.due_at && !isCompleted && (
          <div className={`flex items-center gap-1 ${s.time}`}>
            <Clock className="h-3 w-3" />
            <span className="text-[10px]">{new Date(task.due_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        )}
        {isCompleted && (
          <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-800"><Check className="h-3 w-3" /> Consegnato</span>
        )}
        {!task.due_at && !isCompleted && <span className="text-[10px] font-medium text-slate-400">Apri il compito</span>}
        <ChevronRight className="h-4 w-4 text-slate-300" />
      </div>
    </motion.div>
  )
}

function TaskRow({ task, hasDraft, onClick }: { task: TaskData; hasDraft: boolean; onClick: () => void }) {
  const isCompleted = !!task.submission
  const hasUnreadFeedback = Boolean(task.submission?.feedback_published_at && !task.submission?.feedback_read_at)
  const hasUnreadCorrection = task.submission?.correction?.status === 'pending'

  const s = useMemo(() => {
    if (isCompleted) return TASK_TILE_STYLES.completed
    return TASK_TILE_STYLES[task.task_type] ?? TASK_TILE_STYLES.default
  }, [task.task_type, isCompleted])

  const typeIcon = useMemo(() => {
    switch (task.task_type) {
      case 'quiz': return <ListChecksIcon className="h-5 w-5" />
      case 'lesson': return <BookOpen className="h-5 w-5" />
      case 'presentation': return <Monitor className="h-5 w-5" />
      case 'exercise': return <PenTool className="h-5 w-5" />
      default: return <ClipboardList className="h-5 w-5" />
    }
  }, [task.task_type])

  return (
    <motion.div
      whileTap={{ scale: 0.995 }}
      onClick={onClick}
      className={`group flex cursor-pointer items-center gap-3 rounded-2xl px-4 py-3 transition-all ${s.card}`}
    >
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg shadow-sm ${s.iconBg} ${s.icon}`}>
        {typeIcon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-black text-slate-950">{task.title}</div>
        {(hasUnreadFeedback || hasUnreadCorrection) && <span className="text-[10px] font-black text-amber-700">Nuovo feedback del docente</span>}
      </div>
      <span className={`hidden shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase sm:inline-block ${hasDraft && !isCompleted ? 'border-amber-200 bg-amber-100 text-amber-800' : s.badge}`}>
        {isCompleted ? 'Fatto' : hasDraft ? 'Bozza' : (TASK_TYPE_LABELS[task.task_type] ?? task.task_type)}
      </span>
      {task.due_at && !isCompleted && (
        <div className={`hidden shrink-0 items-center gap-1 md:flex ${s.time}`}>
          <Clock className="h-3 w-3" />
          <span className="text-[10px]">{new Date(task.due_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      )}
      {isCompleted && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-slate-400" />
    </motion.div>
  )
}

const TASK_TYPE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  quiz:         { bg: 'bg-violet-100',  text: 'text-violet-700',  label: 'Quiz' },
  exercise:     { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Esercizio' },
  lesson:       { bg: 'bg-blue-100',    text: 'text-blue-700',    label: 'Documento' },
  presentation: { bg: 'bg-indigo-100',  text: 'text-indigo-700',  label: 'Presentazione' },
  discussion:   { bg: 'bg-violet-100',  text: 'text-violet-700',  label: 'Discussione' },
}

const TASK_MODAL_THEMES: Record<string, {
  shell: string
  header: string
  icon: string
  iconBg: string
  action: string
}> = {
  exercise: {
    shell: 'border-orange-200', header: 'border-orange-200 bg-gradient-to-r from-orange-50 via-white to-amber-50',
    icon: 'text-orange-700', iconBg: 'border-orange-200 bg-orange-100', action: 'border-orange-300 bg-orange-500 text-white hover:bg-orange-600',
  },
  quiz: {
    shell: 'border-violet-200', header: 'border-violet-200 bg-gradient-to-r from-violet-50 via-white to-purple-50',
    icon: 'text-violet-700', iconBg: 'border-violet-200 bg-violet-100', action: 'border-violet-300 bg-violet-600 text-white hover:bg-violet-700',
  },
  lesson: {
    shell: 'border-blue-200', header: 'border-blue-200 bg-gradient-to-r from-blue-50 via-white to-sky-50',
    icon: 'text-blue-700', iconBg: 'border-blue-200 bg-blue-100', action: 'border-blue-300 bg-blue-600 text-white hover:bg-blue-700',
  },
  presentation: {
    shell: 'border-indigo-200', header: 'border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-violet-50',
    icon: 'text-indigo-700', iconBg: 'border-indigo-200 bg-indigo-100', action: 'border-indigo-300 bg-indigo-600 text-white hover:bg-indigo-700',
  },
  default: {
    shell: 'border-slate-200', header: 'border-slate-200 bg-gradient-to-r from-slate-50 via-white to-slate-50',
    icon: 'text-slate-700', iconBg: 'border-slate-200 bg-slate-100', action: 'border-slate-300 bg-slate-800 text-white hover:bg-slate-900',
  },
}

function TaskTypeIcon({ type, className = 'h-5 w-5' }: { type: string; className?: string }) {
  if (type === 'quiz') return <ListChecksIcon className={className} />
  if (type === 'exercise') return <PenTool className={className} />
  if (type === 'lesson') return <BookOpen className={className} />
  if (type === 'presentation') return <Monitor className={className} />
  return <ClipboardList className={className} />
}

function TaskViewerOverlay({ task, studentId, onClose, accentTheme, onSuccess, onDraftStateChange, readOnly }: {
  task: TaskData
  studentId: string
  onClose: () => void
  accentTheme: any
  onSuccess: () => void
  onDraftStateChange: (taskId: string, hasDraft: boolean) => void
  readOnly: boolean
}) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const isCompleted = !!task.submission
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [draft, setDraft] = useState<StudentTaskDraft>(() => loadTaskDraft(studentId, task.id) || { updatedAt: new Date().toISOString() })

  const content = useMemo(() => {
    if (!task.content_json) return null
    try { return JSON.parse(task.content_json) as TaskContent } catch { return null }
  }, [task.content_json])

  const badge = TASK_TYPE_BADGE[task.task_type] ?? { bg: 'bg-slate-100', text: 'text-slate-600', label: task.task_type }
  const theme = TASK_MODAL_THEMES[task.task_type] ?? TASK_MODAL_THEMES.default
  const hasDraft = hasMeaningfulDraft(draft)
  const hasUnreadFeedback = Boolean(task.submission?.feedback_published_at && !task.submission?.feedback_read_at)

  useEffect(() => {
    if (!isCompleted || !hasUnreadFeedback) return
    studentApi.acknowledgeTaskFeedback(task.id)
      .then(() => onSuccess())
      .catch(() => undefined)
  }, [hasUnreadFeedback, isCompleted, onSuccess, task.id])

  const updateDraft = useCallback((updates: Partial<StudentTaskDraft>) => {
    setDraft(current => ({ ...current, ...updates, updatedAt: new Date().toISOString() }))
  }, [])

  useEffect(() => {
    if (isCompleted || readOnly) return
    saveTaskDraft(studentId, task.id, draft)
    onDraftStateChange(task.id, hasMeaningfulDraft(draft))
  }, [draft, isCompleted, onDraftStateChange, readOnly, studentId, task.id])

  const closeAndKeepDraft = useCallback(() => {
    if (!isCompleted && !readOnly) {
      saveTaskDraft(studentId, task.id, draft)
      onDraftStateChange(task.id, hasMeaningfulDraft(draft))
    }
    onClose()
  }, [draft, isCompleted, onClose, onDraftStateChange, readOnly, studentId, task.id])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || isSubmitting) return
      event.preventDefault()
      closeAndKeepDraft()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeAndKeepDraft, isSubmitting])

  const submitMutation = useMutation({
    mutationFn: ({ content, content_json }: { content?: string; content_json?: string }) =>
      studentApi.submitTask(task.id, content, content_json),
    onSuccess: () => {
      localStorage.removeItem(taskDraftKey(studentId, task.id))
      onDraftStateChange(task.id, false)
      onSuccess()
      toast({ title: t('tasks.submitted_title'), description: t('tasks.submitted_body') })
      onClose()
    },
    onError: () => {
      toast({ variant: 'destructive', title: t('tasks.submit_error_title'), description: t('tasks.submit_error_body') })
    },
    onSettled: () => setIsSubmitting(false)
  })

  const handleFinalSubmit = (submissionContent: string, submissionJson?: string) => {
    setIsSubmitting(true)
    submitMutation.mutate({ content: submissionContent, content_json: submissionJson })
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/65 p-0 md:items-center md:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSubmitting) closeAndKeepDraft()
      }}
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className={`flex max-h-[calc(100dvh-0.5rem)] w-full flex-col overflow-hidden rounded-t-[24px] border bg-white shadow-2xl md:max-h-[min(86vh,780px)] md:max-w-3xl md:rounded-[28px] ${theme.shell}`}
      >
        <div className="flex h-5 shrink-0 items-center justify-center md:hidden" aria-hidden="true">
          <span className="h-1 w-10 rounded-full bg-slate-300" />
        </div>
        {/* Header */}
        <div className={`flex shrink-0 items-center gap-3 border-b px-3 py-2.5 md:px-5 md:py-3.5 ${theme.header}`}>
          <div className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border shadow-sm sm:flex ${theme.iconBg} ${theme.icon}`}>
            <TaskTypeIcon type={task.task_type} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${badge.bg} ${badge.text}`}>
                {badge.label}
              </span>
              {hasDraft && !isCompleted && !readOnly && (
                <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-white/80 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                  <Clock className="h-2.5 w-2.5" /> Bozza salvata
                </span>
              )}
              {readOnly && !isCompleted && (
                <span className="inline-flex items-center gap-1 rounded-full border border-sky-200 bg-white/80 px-2 py-0.5 text-[10px] font-bold text-sky-800">
                  <BookOpen className="h-2.5 w-2.5" /> Sola lettura
                </span>
              )}
              {task.due_at && !isCompleted && (
                <span className="flex items-center gap-1 text-[10px] text-slate-500">
                  <Clock className="h-3 w-3" /> {new Date(task.due_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
            <h2 className="line-clamp-1 text-base font-black leading-tight text-slate-950 md:text-lg">{task.title}</h2>
          </div>
          {isCompleted && (
            <div className="hidden flex-shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 sm:flex">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              <span className="text-xs font-bold text-emerald-700">{t('tasks.completed_badge')}</span>
            </div>
          )}
          <button
            onClick={closeAndKeepDraft}
            disabled={isSubmitting}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-white/80 bg-white/70 text-slate-500 shadow-sm transition-colors hover:bg-white hover:text-slate-900 disabled:opacity-40"
            aria-label={readOnly ? 'Chiudi compito' : 'Chiudi e salva la bozza'}
            title={readOnly ? 'Chiudi compito (Esc)' : 'Chiudi e salva la bozza (Esc)'}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-3 sm:p-4 md:p-6">
            {isCompleted ? (
              <SubmissionSummary task={task} accentTheme={accentTheme} />
            ) : readOnly ? (
              <ReadOnlyTaskContent task={task} content={content} />
            ) : (
              <div className="mx-auto max-w-2xl space-y-4">
                {task.description && (
                  <p className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm leading-relaxed text-slate-600">{task.description}</p>
                )}
                {task.task_type === 'quiz' && content?.questions ? (
                  <QuizCarousel
                    questions={content.questions}
                    onSubmit={(answers) => {
                      let correct = 0
                      content.questions!.forEach((q, i) => { if (answers[i] === q.correctIndex) correct++ })
                      const scoreText = `${correct}/${content.questions!.length}`
                      const content_json = JSON.stringify({
                        answers: Object.entries(answers).map(([qIndex, aIndex]) => ({
                          questionIndex: parseInt(qIndex),
                          selectedIndex: aIndex,
                        }))
                      })
                      handleFinalSubmit(scoreText, content_json)
                    }}
                    accentTheme={accentTheme}
                    theme={theme}
                    isSubmitting={isSubmitting}
                    initialAnswers={draft.quizAnswers || {}}
                    initialIndex={draft.quizIndex || 0}
                    onDraftChange={(quizAnswers, quizIndex) => updateDraft({ quizAnswers, quizIndex })}
                  />
                ) : task.task_type === 'exercise' ? (
                  <ExerciseViewer
                    content={content}
                    onSubmit={(text) => handleFinalSubmit(text)}
                    accentTheme={accentTheme}
                    isSubmitting={isSubmitting}
                    response={draft.exerciseResponse || ''}
                    onResponseChange={(exerciseResponse) => updateDraft({ exerciseResponse })}
                  />
                ) : (
                  <div className="space-y-4">
                    <textarea
                      value={draft.response || ''}
                      onChange={(e) => updateDraft({ response: e.target.value })}
                      onPaste={(e) => e.preventDefault()}
                      onCopy={(e) => e.preventDefault()}
                      onCut={(e) => e.preventDefault()}
                      placeholder={t('tasks.answer_placeholder')}
                      className="min-h-[150px] w-full resize-y rounded-xl border border-slate-300 bg-white p-4 text-slate-800 shadow-sm outline-none focus:ring-2"
                      style={{ '--tw-ring-color': accentTheme.accent } as React.CSSProperties}
                    />
                    <button
                      onClick={() => handleFinalSubmit(draft.response || '')}
                      disabled={!draft.response?.trim() || isSubmitting}
                      className={`h-11 w-full rounded-xl border text-sm font-black transition-all disabled:cursor-not-allowed disabled:opacity-40 ${theme.action}`}
                    >
                      {isSubmitting ? t('tasks.submitting') : t('tasks.submit_answer')}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function ReadOnlyTaskContent({ task, content }: { task: TaskData; content: TaskContent | null }) {
  const body = content?.instructions || content?.text || content?.description || task.description
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {body && <p className="whitespace-pre-wrap rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm leading-7 text-slate-700">{body}</p>}
      {content?.questions?.map((question, index) => (
        <section key={`${question.question}-${index}`} className="rounded-2xl border border-violet-100 bg-violet-50/60 p-5">
          <p className="text-xs font-black uppercase tracking-wider text-violet-600">Domanda {index + 1}</p>
          <h3 className="mt-2 font-extrabold leading-6 text-slate-950">{question.question}</h3>
          <div className="mt-4 space-y-2">
            {question.options.map((option, optionIndex) => (
              <div key={`${option}-${optionIndex}`} className="flex min-h-[48px] items-center gap-3 rounded-xl border border-white bg-white/80 px-4 text-sm font-medium text-slate-600">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-xs font-black text-violet-700">{String.fromCharCode(65 + optionIndex)}</span>
                {option}
              </div>
            ))}
          </div>
        </section>
      ))}
      {content?.examples && content.examples.length > 0 && (
        <section className="rounded-2xl border border-sky-100 bg-sky-50/70 p-5">
          <h3 className="font-extrabold text-slate-950">Esempi</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
            {content.examples.map((example, index) => <li key={`${example}-${index}`}>• {example}</li>)}
          </ul>
        </section>
      )}
      {content?.hint && <p className="rounded-2xl border border-amber-100 bg-amber-50 p-4 text-sm font-medium text-amber-900"><Lightbulb className="mr-2 inline h-4 w-4" />{content.hint}</p>}
      {!body && !content?.questions?.length && <p className="py-10 text-center text-sm text-slate-400">Nessun contenuto aggiuntivo per questo compito.</p>}
    </div>
  )
}

function QuizCarousel({ questions, onSubmit, accentTheme, theme, isSubmitting, initialAnswers, initialIndex, onDraftChange }: {
  questions: QuizQuestion[]; 
  onSubmit: (answers: Record<number, number>) => void;
  accentTheme: any;
  theme: (typeof TASK_MODAL_THEMES)[string];
  isSubmitting: boolean;
  initialAnswers: Record<number, number>;
  initialIndex: number;
  onDraftChange: (answers: Record<number, number>, currentIndex: number) => void;
}) {
  const [currentIndex, setCurrentIndex] = useState(Math.min(initialIndex, Math.max(questions.length - 1, 0)))
  const [answers, setAnswers] = useState<Record<number, number>>(initialAnswers)

  const allAnswered = questions.every((_, i) => answers[i] !== undefined)

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      const nextIndex = currentIndex + 1
      setCurrentIndex(nextIndex)
      onDraftChange(answers, nextIndex)
    }
  }

  const handlePrev = () => {
    if (currentIndex > 0) {
      const nextIndex = currentIndex - 1
      setCurrentIndex(nextIndex)
      onDraftChange(answers, nextIndex)
    }
  }

  return (
    <div className="space-y-6">
      {/* Progress */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-slate-200/80 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: accentTheme.accent }}
            animate={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
          />
        </div>
        <span className="text-xs font-bold text-slate-400 tabular-nums flex-shrink-0">
          {currentIndex + 1} / {questions.length}
        </span>
      </div>

      <div className="relative min-h-[210px] overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ x: 30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -30, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="space-y-4"
          >
            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 shadow-sm">
              <h3 className="text-base font-black text-slate-950 leading-snug">
                {questions[currentIndex].question}
              </h3>
            </div>

            <div className="space-y-2">
              {questions[currentIndex].options.map((opt, optIndex) => {
                const isSelected = answers[currentIndex] === optIndex
                return (
                  <button
                    key={optIndex}
                    onClick={() => {
                      const next = { ...answers, [currentIndex]: optIndex }
                      setAnswers(next)
                      onDraftChange(next, currentIndex)
                    }}
                    className="w-full text-left p-3.5 rounded-lg border transition-all flex items-center justify-between gap-3 backdrop-blur-sm"
                    style={{
                      backgroundColor: isSelected ? '#ede9fe' : '#ffffff',
                      borderColor: isSelected ? '#a78bfa' : '#cbd5e1',
                    }}
                  >
                    <span className={`text-sm font-semibold ${isSelected ? 'text-violet-950' : 'text-slate-700'}`}>
                      {opt}
                    </span>
                    <div
                      className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all"
                      style={{
                        backgroundColor: isSelected ? '#ffffff' : 'transparent',
                        borderColor: isSelected ? '#7c3aed' : '#cbd5e1',
                      }}
                    >
                      {isSelected && <Check className="h-3 w-3 text-violet-800" />}
                    </div>
                  </button>
                )
              })}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-4 border-t border-slate-200/50">
        <button
          onClick={handlePrev}
          disabled={currentIndex === 0}
          className="flex items-center gap-1.5 rounded-lg border border-transparent px-4 py-2 text-sm font-bold text-slate-600 transition-all hover:border-violet-200 hover:bg-violet-50 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft className="h-4 w-4" /> Precedente
        </button>

        {currentIndex === questions.length - 1 ? (
          <button
            disabled={!allAnswered || isSubmitting}
            onClick={() => onSubmit(answers)}
            className={`flex items-center gap-2 rounded-lg border px-6 py-2 text-sm font-black transition-all disabled:cursor-not-allowed disabled:opacity-40 ${theme.action}`}
          >
            {isSubmitting ? 'Invio...' : 'Invia Quiz'} <Send className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={handleNext}
            disabled={answers[currentIndex] === undefined}
            className={`flex items-center gap-2 rounded-lg border px-6 py-2 text-sm font-black transition-all disabled:cursor-not-allowed disabled:opacity-40 ${theme.action}`}
          >
            Avanti <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function ExerciseViewer({ content, onSubmit, accentTheme, isSubmitting, response, onResponseChange }: {
  content: TaskContent | null;
  onSubmit: (text: string) => void;
  accentTheme: any;
  isSubmitting: boolean;
  response: string;
  onResponseChange: (response: string) => void;
}) {
  const exerciseText = content?.instructions || content?.text
  const examples = Array.isArray(content?.examples) ? content.examples.filter(Boolean) : []

  return (
    <div className="space-y-4">
      {exerciseText && (
        <div className="bg-white border border-amber-300 rounded-xl p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <PenTool className="h-4 w-4 text-amber-600" />
            <span className="text-xs font-bold uppercase tracking-widest text-amber-500">Esercizio</span>
          </div>
          {content?.title && (
            <h3 className="text-lg font-bold text-slate-900 mb-2">{content.title}</h3>
          )}
          {content?.description && (
            <p className="text-sm text-slate-600 mb-4">{content.description}</p>
          )}
          <p className="text-slate-800 font-medium leading-relaxed whitespace-pre-wrap">
            {exerciseText}
          </p>
          {examples.length > 0 && (
            <div className="mt-4 rounded-xl bg-white/70 border border-amber-100 p-3">
              <div className="text-xs font-bold uppercase tracking-widest text-amber-600 mb-2">Esempi</div>
              <ul className="space-y-1.5 pl-4 text-sm text-slate-700">
                {examples.map((example, index) => (
                  <li key={index}>{example}</li>
                ))}
              </ul>
            </div>
          )}
          {content.hint && (
            <div className="mt-4 flex items-start gap-2 text-xs text-amber-700 bg-amber-100/80 p-3 rounded-xl border border-amber-200/60">
              <Lightbulb className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{content.hint}</span>
            </div>
          )}
        </div>
      )}

      <textarea
        value={response}
        onPaste={(e) => e.preventDefault()}
        onCopy={(e) => e.preventDefault()}
        onCut={(e) => e.preventDefault()}
        placeholder="Scrivi qui la tua risposta..."
        onChange={(e) => onResponseChange(e.target.value)}
        className="min-h-[150px] w-full resize-y rounded-xl border border-orange-200 bg-orange-50/20 p-4 text-slate-800 shadow-sm outline-none focus:ring-2"
        style={{ '--tw-ring-color': accentTheme.accent } as React.CSSProperties}
      />

      <button
        onClick={() => onSubmit(response)}
        disabled={!response.trim() || isSubmitting}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-orange-300 bg-orange-500 text-sm font-black text-white transition-all hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Send className="h-4 w-4" />
        {isSubmitting ? 'Invio in corso...' : 'Consegna Risposta'}
      </button>
    </div>
  )
}

function SubmissionSummary({ task, accentTheme }: { task: TaskData; accentTheme: any }) {
  const submission = task.submission
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const acknowledgeCorrection = useMutation({
    mutationFn: () => studentApi.acknowledgeTaskCorrection(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['student-tasks'] })
      toast({ title: 'Conferma inviata', description: 'Il docente vedrà che hai letto la correzione.' })
    },
    onError: () => {
      toast({ title: 'Impossibile inviare la conferma', variant: 'destructive' })
    },
  })
  if (!submission) return null
  const correction = submission.correction?.kind === 'exercise_inline' ? submission.correction : null

  return (
    <div className="mx-auto max-w-2xl space-y-3 sm:space-y-5">
      <div className="py-2 text-center sm:py-6">
        <div className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-full border border-emerald-200/70 bg-emerald-50 sm:mb-4 sm:h-14 sm:w-14">
          <CheckCircle2 className="h-6 w-6 text-emerald-500 sm:h-7 sm:w-7" />
        </div>
        <h3 className="text-lg font-bold text-slate-900 sm:text-xl">Ottimo lavoro!</h3>
        <p className="text-slate-400 text-sm mt-1">Consegnato il {new Date(submission.submitted_at).toLocaleDateString('it-IT')}</p>
      </div>

      <div className="space-y-3">
        {/* Answer Box */}
        <div className="rounded-xl border border-slate-200/60 bg-white/60 p-4 backdrop-blur-sm sm:p-5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">La tua consegna</p>
          <p className="break-words text-sm leading-relaxed text-slate-700">
            {submission.content}
          </p>
        </div>

        {correction && (
          <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50/40">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-200 bg-amber-100/70 px-4 py-3 sm:px-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-amber-900">Correzioni del docente</p>
                <p className="mt-0.5 text-xs text-amber-800">Le parti evidenziate in giallo sono state modificate.</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                correction.status === 'read'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-white text-amber-900'
              }`}>
                {correction.status === 'read' ? 'Letto · docente avvisato' : 'Da leggere'}
              </span>
            </div>
            <div className="space-y-4 p-4 sm:p-5">
              <TrackedCorrectionText
                original={correction.original_content || submission.content || ''}
                corrected={correction.suggested_content}
              />
              {correction.status === 'pending' && (
                <div className="flex justify-end border-t border-amber-100 pt-4">
                  <button
                    type="button"
                    onClick={() => acknowledgeCorrection.mutate()}
                    disabled={acknowledgeCorrection.isPending}
                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-amber-300 bg-amber-100 px-4 text-sm font-black text-amber-950 transition-colors hover:bg-amber-200 disabled:opacity-50"
                  >
                    <Check className="h-4 w-4" />
                    {acknowledgeCorrection.isPending ? 'Invio…' : 'Ho letto'}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Feedback / Score Box */}
        {(submission.score || submission.feedback || (submission.answer_feedback && Object.keys(submission.answer_feedback).length > 0)) && (
          <div
            className="rounded-xl border p-4 backdrop-blur-sm sm:p-5"
            style={{
              backgroundColor: `${accentTheme.accent}08`,
              borderColor: `${accentTheme.accent}25`,
            }}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: accentTheme.accent }}>
                Feedback del Docente
              </span>
              {submission.score && (
                <div
                  className="px-3 py-1 rounded-full text-xs font-bold border bg-white/80"
                  style={{ color: accentTheme.accent, borderColor: `${accentTheme.accent}30` }}
                >
                  Voto: {submission.score}
                </div>
              )}
            </div>
            {submission.feedback ? (
              <p className="text-slate-700 leading-relaxed text-sm">{submission.feedback}</p>
            ) : (
              <p className="text-slate-400 text-sm italic">Il docente non ha ancora inserito un commento.</p>
            )}
            {submission.answer_feedback && Object.keys(submission.answer_feedback).length > 0 && (
              <div className="mt-4 space-y-2 border-t border-slate-200 pt-3">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Commenti sulle risposte</p>
                {Object.entries(submission.answer_feedback).sort(([a], [b]) => Number(a) - Number(b)).map(([questionIndex, comment]) => (
                  <div key={questionIndex} className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2 text-sm text-slate-700">
                    <span className="mr-2 font-bold">Domanda {Number(questionIndex) + 1}</span>{comment}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// Icons
function LoaderIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2v4" />
      <path d="m16.2 7.8 2.9-2.9" />
      <path d="M18 12h4" />
      <path d="m16.2 16.2 2.9 2.9" />
      <path d="M12 18v4" />
      <path d="m4.9 19.1 2.9-2.9" />
      <path d="M2 12h4" />
      <path d="m4.9 4.9 2.9 2.9" />
    </svg>
  )
}

function ListChecksIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 17 2 2 4-4" />
      <path d="m3 7 2 2 4-4" />
      <path d="M13 6h8" />
      <path d="M13 12h8" />
      <path d="M13 18h8" />
    </svg>
  )
}
