import { useState, useEffect, useMemo } from 'react'
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
  Monitor, PenTool, BookOpen, FolderOpen, ChevronDown, ChevronUp,
  Search, LayoutGrid, List
} from 'lucide-react'
import { loadStudentAccent, getStudentAccentTheme } from '@/lib/studentAccent'

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
  } | null
}

function getTaskCardPreview(task: TaskData) {
  if (task.description?.trim()) return task.description.trim()
  if (!task.content_json) return ''

  try {
    const content = JSON.parse(task.content_json) as TaskContent
    if (content.description?.trim()) return content.description.trim()
    if (content.text?.trim()) return content.text.trim()
    if (content.title?.trim()) return content.title.trim()
    if (content.questions?.length) return content.questions[0]?.question?.trim() || ''
    return ''
  } catch {
    return ''
  }
}

interface TasksModuleProps {
  openTaskId?: string | null
  onOpenDocument?: (taskId: string) => void
}

const fuzzyMatch = (query: string, ...fields: string[]) => {
  if (!query.trim()) return true
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const target = fields.join(' ').toLowerCase()
  return terms.every(term => target.includes(term))
}

export default function TasksModule({ openTaskId, onOpenDocument }: TasksModuleProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(openTaskId || null)
  const [accentTheme] = useState(getStudentAccentTheme(loadStudentAccent()))
  const [taskSearch, setTaskSearch] = useState('')
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

  const selectedTask = useMemo(() =>
    tasks?.find(t => t.id === selectedTaskId),
    [tasks, selectedTaskId]
  )

  // Group tasks by uda_folder; tasks without uda_folder go in the regular grid
  const { udaFolderMap, regularTasks } = useMemo(() => {
    const folderMap: Record<string, TaskData[]> = {}
    const regular: TaskData[] = []
    tasks?.forEach(t => {
      if (t.uda_folder) {
        if (!folderMap[t.uda_folder]) folderMap[t.uda_folder] = []
        folderMap[t.uda_folder].push(t)
      } else {
        regular.push(t)
      }
    })
    return { udaFolderMap: folderMap, regularTasks: regular }
  }, [tasks])

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

  if (!tasks || (tasks.length === 0 && Object.keys(udaFolderMap).length === 0)) {
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
      {/* Grid View */}
      <div className="flex-1 overflow-y-auto px-4 pb-24 pt-5 md:px-6 md:pb-8">
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-100 text-emerald-800 shadow-sm">
                <ClipboardList className="h-4 w-4" />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-950">{t('tasks.title')}</h2>
                <p className="text-xs font-medium text-slate-500">{t('tasks.subtitle')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
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
                  {regularTasks.filter(t => t.submission).length}/{regularTasks.length}
                </span>
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={taskSearch}
              onChange={e => setTaskSearch(e.target.value)}
              placeholder="Cerca compiti..."
              className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-9 pr-8 text-sm shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400"
            />
            {taskSearch && (
              <button onClick={() => setTaskSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* UDA Folders */}
          {Object.keys(udaFolderMap).length > 0 && (
            <div className="mb-6 space-y-3">
              <h3 className="text-[11px] font-black text-slate-600 uppercase tracking-[0.18em]">Unità Didattiche</h3>
              {Object.entries(udaFolderMap).map(([folderName, folderTasks]) => (
                <UdaFolder
                  key={folderName}
                  folderName={folderName}
                  folderTasks={folderTasks.filter(t => fuzzyMatch(taskSearch, t.title, t.description || '', t.task_type))}
                  onOpenTask={(task) => {
                    if ((task.task_type === 'lesson' || task.task_type === 'presentation') && onOpenDocument) {
                      onOpenDocument(task.id)
                    } else {
                      setSelectedTaskId(task.id)
                    }
                  }}
                />
              ))}
            </div>
          )}

          {(() => {
            const filtered = regularTasks.filter(t => fuzzyMatch(taskSearch, t.title, t.description || '', t.task_type))
            if (filtered.length === 0 && taskSearch) {
              return <p className="text-center text-sm text-slate-400 py-8">Nessun compito corrisponde a "{taskSearch}"</p>
            }
            const openTask = (task: TaskData) => {
              if ((task.task_type === 'lesson' || task.task_type === 'presentation') && onOpenDocument) {
                onOpenDocument(task.id)
              } else {
                setSelectedTaskId(task.id)
              }
            }
            if (viewMode === 'list') {
              return (
                <div className="space-y-2">
                  {filtered.map((task) => (
                    <TaskRow key={task.id} task={task} onClick={() => openTask(task)} />
                  ))}
                </div>
              )
            }
            return (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onClick={() => openTask(task)}
                    accentColor={accentTheme.accent}
                  />
                ))}
              </div>
            )
          })()}
        </div>
      </div>

      {/* Task Viewer Modal — rendered in a portal to escape any parent transform context */}
      {createPortal(
        <AnimatePresence>
          {selectedTask && (
            <TaskViewerOverlay
              task={selectedTask}
              onClose={() => setSelectedTaskId(null)}
              accentTheme={accentTheme}
              onSuccess={() => queryClient.invalidateQueries({ queryKey: ['student-tasks'] })}
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
  quiz:         { card: 'border border-[rgba(254,0,77,0.18)] bg-[rgba(254,0,77,0.075)] shadow-sm hover:border-[rgba(254,0,77,0.28)] hover:bg-[rgba(254,0,77,0.11)] hover:shadow-lg',    iconBg: 'border border-rose-200 bg-rose-100',    icon: 'text-rose-800',    badge: 'border border-rose-200 bg-rose-100 text-rose-800',       time: 'text-rose-800' },
  lesson:       { card: 'border border-[rgba(62,169,244,0.18)] bg-[rgba(62,169,244,0.075)] shadow-sm hover:border-[rgba(62,169,244,0.30)] hover:bg-[rgba(62,169,244,0.11)] hover:shadow-lg',     iconBg: 'border border-sky-200 bg-sky-100',      icon: 'text-sky-800',     badge: 'border border-sky-200 bg-sky-100 text-sky-800',          time: 'text-sky-800' },
  presentation: { card: 'border border-[rgba(123,105,201,0.18)] bg-[rgba(123,105,201,0.075)] shadow-sm hover:border-[rgba(123,105,201,0.30)] hover:bg-[rgba(123,105,201,0.11)] hover:shadow-lg',  iconBg: 'border border-indigo-200 bg-indigo-100', icon: 'text-indigo-800', badge: 'border border-indigo-200 bg-indigo-100 text-indigo-800', time: 'text-indigo-800' },
  exercise:     { card: 'border border-[rgba(123,105,201,0.18)] bg-[rgba(123,105,201,0.075)] shadow-sm hover:border-[rgba(123,105,201,0.30)] hover:bg-[rgba(123,105,201,0.11)] hover:shadow-lg',   iconBg: 'border border-violet-200 bg-violet-100',   icon: 'text-violet-800',   badge: 'border border-violet-200 bg-violet-100 text-violet-800',    time: 'text-violet-800' },
  default:      { card: 'border border-[rgba(23,21,27,0.10)] bg-[rgba(23,21,27,0.035)] shadow-sm hover:border-[rgba(23,21,27,0.16)] hover:bg-[rgba(23,21,27,0.055)] hover:shadow-lg',   iconBg: 'border border-slate-200 bg-slate-100',   icon: 'text-slate-800',   badge: 'border border-slate-200 bg-slate-100 text-slate-800',    time: 'text-slate-700' },
}

const UDA_TYPE_CHIP: Record<string, string> = {
  lesson: 'bg-blue-100 text-blue-700',
  quiz: 'bg-rose-100 text-rose-700',
  exercise: 'bg-amber-100 text-amber-700',
  presentation: 'bg-purple-100 text-purple-700',
}

const UDA_TYPE_LABELS: Record<string, string> = {
  lesson: 'Documento',
  quiz: 'Quiz',
  exercise: 'Esercizio',
  presentation: 'Presentazione',
}

function UdaFolder({
  folderName,
  folderTasks,
  onOpenTask,
}: {
  folderName: string
  folderTasks: TaskData[]
  onOpenTask: (task: TaskData) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="overflow-hidden rounded-lg border border-emerald-200 bg-gradient-to-br from-white via-emerald-50/40 to-white shadow-sm">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-emerald-50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-emerald-200 bg-emerald-100 text-emerald-800">
          <FolderOpen className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-800 truncate">{folderName}</p>
          <p className="text-xs text-slate-400">{folderTasks.length} contenuti</p>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-slate-400 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-slate-400 flex-shrink-0" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 space-y-2">
              {folderTasks.map(task => (
                <button
                  key={task.id}
                  className="w-full flex items-center gap-3 rounded-lg border border-emerald-200 bg-white px-3 py-2.5 text-left transition-colors hover:bg-emerald-50 hover:border-emerald-300"
                  onClick={() => onOpenTask(task)}
                >
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${UDA_TYPE_CHIP[task.task_type] ?? 'bg-slate-100 text-slate-600'}`}>
                    {UDA_TYPE_LABELS[task.task_type] ?? task.task_type}
                  </span>
                  <span className="text-sm text-slate-700 flex-1 truncate">{task.title}</span>
                  {task.submission && <Check className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />}
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300 flex-shrink-0" />
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function TaskCard({ task, onClick }: { task: TaskData; onClick: () => void; accentColor: string }) {
  const isCompleted = !!task.submission
  const preview = useMemo(() => getTaskCardPreview(task), [task])

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
      className={`relative flex min-h-[154px] cursor-pointer flex-col overflow-hidden rounded-[24px] p-3.5 text-left transition-all hover:-translate-y-0.5 ${s.card}`}
    >
      <span className={`absolute right-3 top-4 rounded-full px-2.5 py-1 text-[10px] font-black uppercase ${s.badge}`}>
        {isCompleted ? 'Fatto' : (UDA_TYPE_LABELS[task.task_type] ?? task.task_type)}
      </span>
      <div className="flex items-start gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg shadow-sm ${s.iconBg} ${s.icon}`}>
          {typeIcon}
        </div>
        <div className="min-w-0 flex-1 pr-6">
          <div className="line-clamp-2 text-sm font-black leading-5 text-slate-950">{task.title}</div>
          {preview && (
            <p className="mt-1 line-clamp-3 text-[12px] leading-5 text-slate-500">
              {preview}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
          {TASK_TYPE_BADGE[task.task_type]?.label ?? task.task_type}
        </span>
        {task.due_at && !isCompleted && (
          <div className={`flex items-center gap-1 ${s.time}`}>
            <Clock className="h-3 w-3" />
            <span className="text-[10px]">{new Date(task.due_at).toLocaleDateString('it-IT')}</span>
          </div>
        )}
        {isCompleted && (
          <span className="inline-flex items-center gap-1 text-[10px] font-black text-emerald-800"><Check className="h-3 w-3" /> Completato</span>
        )}
      </div>
      {!task.due_at && !isCompleted && (
        <div className="mt-2 text-[10px] font-medium text-slate-400">
          Apri per vedere i dettagli
        </div>
      )}
    </motion.div>
  )
}

function TaskRow({ task, onClick }: { task: TaskData; onClick: () => void }) {
  const isCompleted = !!task.submission
  const preview = useMemo(() => getTaskCardPreview(task), [task])

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
        {preview && (
          <p className="truncate text-[12px] leading-5 text-slate-500">{preview}</p>
        )}
      </div>
      <span className={`hidden shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase sm:inline-block ${s.badge}`}>
        {isCompleted ? 'Fatto' : (UDA_TYPE_LABELS[task.task_type] ?? task.task_type)}
      </span>
      {task.due_at && !isCompleted && (
        <div className={`hidden shrink-0 items-center gap-1 md:flex ${s.time}`}>
          <Clock className="h-3 w-3" />
          <span className="text-[10px]">{new Date(task.due_at).toLocaleDateString('it-IT')}</span>
        </div>
      )}
      {isCompleted && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
      <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-slate-400" />
    </motion.div>
  )
}

const TASK_TYPE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  quiz:         { bg: 'bg-rose-100',    text: 'text-rose-700',    label: 'Quiz' },
  exercise:     { bg: 'bg-amber-100',   text: 'text-amber-700',   label: 'Esercizio' },
  lesson:       { bg: 'bg-blue-100',    text: 'text-blue-700',    label: 'Lezione' },
  presentation: { bg: 'bg-indigo-100',  text: 'text-indigo-700',  label: 'Presentazione' },
  discussion:   { bg: 'bg-violet-100',  text: 'text-violet-700',  label: 'Discussione' },
}

function TaskViewerOverlay({ task, onClose, accentTheme, onSuccess }: { task: TaskData; onClose: () => void; accentTheme: any; onSuccess: () => void }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const isCompleted = !!task.submission
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [response, setResponse] = useState('')

  const content = useMemo(() => {
    if (!task.content_json) return null
    try { return JSON.parse(task.content_json) as TaskContent } catch { return null }
  }, [task.content_json])

  const badge = TASK_TYPE_BADGE[task.task_type] ?? { bg: 'bg-slate-100', text: 'text-slate-600', label: task.task_type }

  const submitMutation = useMutation({
    mutationFn: ({ content, content_json }: { content?: string; content_json?: string }) =>
      studentApi.submitTask(task.id, content, content_json),
    onSuccess: () => {
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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/65 p-0 md:p-4"
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="flex h-full w-full flex-col overflow-hidden border border-slate-300 bg-white shadow-2xl md:h-[90vh] md:max-w-4xl md:rounded-xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-3.5">
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors flex-shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${badge.bg} ${badge.text}`}>
                {badge.label}
              </span>
              {task.due_at && !isCompleted && (
                <span className="text-[10px] text-slate-400 flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {new Date(task.due_at).toLocaleDateString()}
                </span>
              )}
            </div>
            <h2 className="font-black text-base text-slate-950 leading-tight line-clamp-1">{task.title}</h2>
          </div>
          {isCompleted && (
            <div className="flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              <span className="text-xs font-bold text-emerald-700">{t('tasks.completed_badge')}</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-5 md:p-8">
            {isCompleted ? (
              <SubmissionSummary task={task} accentTheme={accentTheme} />
            ) : (
              <div className="max-w-3xl mx-auto space-y-6">
                {task.description && (
                  <p className="text-slate-600 leading-relaxed text-base">{task.description}</p>
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
                    isSubmitting={isSubmitting}
                  />
                ) : task.task_type === 'exercise' ? (
                  <ExerciseViewer
                    content={content}
                    onSubmit={(text) => handleFinalSubmit(text)}
                    accentTheme={accentTheme}
                    isSubmitting={isSubmitting}
                  />
                ) : (
                  <div className="space-y-4">
                    <textarea
                      value={response}
                      onChange={(e) => setResponse(e.target.value)}
                      onPaste={(e) => e.preventDefault()}
                      onCopy={(e) => e.preventDefault()}
                      onCut={(e) => e.preventDefault()}
                      placeholder={t('tasks.answer_placeholder')}
                      className="w-full p-4 rounded-xl border border-slate-300 bg-white min-h-[200px] focus:ring-2 outline-none text-slate-800 resize-none shadow-sm"
                      style={{ '--tw-ring-color': accentTheme.accent } as React.CSSProperties}
                    />
                    <button
                      onClick={() => handleFinalSubmit(response)}
                      disabled={!response.trim() || isSubmitting}
                      className="w-full h-12 text-sm font-black rounded-lg border border-indigo-200 bg-indigo-100 text-indigo-900 transition-all hover:bg-indigo-200 disabled:opacity-40 disabled:cursor-not-allowed"
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

function QuizCarousel({ questions, onSubmit, accentTheme, isSubmitting }: { 
  questions: QuizQuestion[]; 
  onSubmit: (answers: Record<number, number>) => void;
  accentTheme: any;
  isSubmitting: boolean;
}) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  
  const allAnswered = questions.every((_, i) => answers[i] !== undefined)

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex(currentIndex + 1)
    }
  }

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1)
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

      <div className="min-h-[280px] relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ x: 30, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -30, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="space-y-4"
          >
            <div className="bg-white border border-slate-300 rounded-xl p-5 shadow-sm">
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
                    onClick={() => setAnswers(prev => ({ ...prev, [currentIndex]: optIndex }))}
                    className="w-full text-left p-3.5 rounded-lg border transition-all flex items-center justify-between gap-3 backdrop-blur-sm"
                    style={{
                      backgroundColor: isSelected ? '#ffe4e6' : '#ffffff',
                      borderColor: isSelected ? '#fda4af' : '#cbd5e1',
                    }}
                  >
                    <span className={`text-sm font-semibold ${isSelected ? 'text-rose-950' : 'text-slate-700'}`}>
                      {opt}
                    </span>
                    <div
                      className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all"
                      style={{
                        backgroundColor: isSelected ? '#ffffff' : 'transparent',
                        borderColor: isSelected ? '#e11d48' : '#cbd5e1',
                      }}
                    >
                      {isSelected && <Check className="h-3 w-3 text-rose-800" />}
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
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-transparent text-sm font-bold text-slate-600 hover:border-rose-200 hover:bg-rose-50 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          <ChevronLeft className="h-4 w-4" /> Precedente
        </button>

        {currentIndex === questions.length - 1 ? (
          <button
            disabled={!allAnswered || isSubmitting}
            onClick={() => onSubmit(answers)}
            className="flex items-center gap-2 px-6 py-2 rounded-lg border border-rose-200 bg-rose-100 text-sm font-black text-rose-900 transition-all hover:bg-rose-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Invio...' : 'Invia Quiz'} <Send className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={handleNext}
            disabled={answers[currentIndex] === undefined}
            className="flex items-center gap-2 px-6 py-2 rounded-lg border border-rose-200 bg-rose-100 text-sm font-black text-rose-900 transition-all hover:bg-rose-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Avanti <ChevronRight className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function ExerciseViewer({ content, onSubmit, accentTheme, isSubmitting }: {
  content: TaskContent | null;
  onSubmit: (text: string) => void;
  accentTheme: any;
  isSubmitting: boolean;
}) {
  const [response, setResponse] = useState('')
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
        onChange={(e) => setResponse(e.target.value)}
        onPaste={(e) => e.preventDefault()}
        onCopy={(e) => e.preventDefault()}
        onCut={(e) => e.preventDefault()}
        placeholder="Scrivi qui la tua risposta..."
        className="w-full p-4 rounded-xl border border-slate-300 bg-white min-h-[220px] focus:ring-2 outline-none text-slate-800 resize-none shadow-sm"
        style={{ '--tw-ring-color': accentTheme.accent } as React.CSSProperties}
      />

      <button
        onClick={() => onSubmit(response)}
        disabled={!response.trim() || isSubmitting}
        className="w-full h-12 text-sm font-black rounded-lg border border-amber-200 bg-amber-100 text-amber-900 transition-all hover:bg-amber-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        <Send className="h-4 w-4" />
        {isSubmitting ? 'Invio in corso...' : 'Consegna Risposta'}
      </button>
    </div>
  )
}

function SubmissionSummary({ task, accentTheme }: { task: TaskData; accentTheme: any }) {
  const submission = task.submission
  if (!submission) return null

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="text-center py-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200/70 mb-4">
          <CheckCircle2 className="h-7 w-7 text-emerald-500" />
        </div>
        <h3 className="text-xl font-bold text-slate-900">Ottimo lavoro!</h3>
        <p className="text-slate-400 text-sm mt-1">Consegnato il {new Date(submission.submitted_at).toLocaleDateString('it-IT')}</p>
      </div>

      <div className="space-y-3">
        {/* Answer Box */}
        <div className="bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl p-5">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">La tua consegna</p>
          <p className="text-slate-700 leading-relaxed text-sm">
            {submission.content}
          </p>
        </div>

        {/* Feedback / Score Box */}
        {(submission.score || submission.feedback) && (
          <div
            className="backdrop-blur-sm rounded-xl p-5 border"
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
