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
  Search
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
      <div className="h-full flex flex-col items-center justify-center p-12 text-center">
        <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mb-6">
          <ClipboardList className="h-10 w-10 text-slate-300" />
        </div>
        <h3 className="text-xl font-bold text-slate-800 mb-2">{t('tasks.empty_title')}</h3>
        <p className="text-slate-500 max-w-sm">
          {t('tasks.empty_body')}
        </p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      {/* Grid View */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-700">{t('tasks.title')}</h2>
              <p className="text-xs text-slate-400">{t('tasks.subtitle')}</p>
            </div>
            <div className="bg-white/60 backdrop-blur-md px-3 py-1.5 rounded-full border border-slate-200 shadow-sm flex items-center gap-1.5">
              <Award className="h-3.5 w-3.5 text-amber-500" />
              <span className="text-xs font-bold text-slate-700">
                {regularTasks.filter(t => t.submission).length}/{regularTasks.length}
              </span>
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
              className="w-full pl-9 pr-8 py-2 text-sm bg-white/80 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 placeholder:text-slate-400"
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
              <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide">Unità Didattiche</h3>
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
            return (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {filtered.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onClick={() => {
                      if ((task.task_type === 'lesson' || task.task_type === 'presentation') && onOpenDocument) {
                        onOpenDocument(task.id)
                      } else {
                        setSelectedTaskId(task.id)
                      }
                    }}
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
  completed:    { card: 'bg-emerald-50/80 border border-emerald-200/70 hover:border-emerald-300/80 hover:bg-emerald-50', iconBg: 'bg-emerald-100', icon: 'text-emerald-700', badge: 'bg-emerald-200 text-emerald-700', time: 'text-emerald-600' },
  quiz:         { card: 'bg-rose-50/80 border border-rose-200/70 hover:border-rose-300/80 hover:bg-rose-50',             iconBg: 'bg-rose-100',    icon: 'text-rose-700',    badge: 'bg-rose-200 text-rose-700',    time: 'text-rose-500' },
  lesson:       { card: 'bg-blue-50/80 border border-blue-200/70 hover:border-blue-300/80 hover:bg-blue-50',             iconBg: 'bg-blue-100',    icon: 'text-blue-800',    badge: 'bg-blue-200 text-blue-700',    time: 'text-blue-500' },
  presentation: { card: 'bg-indigo-50/80 border border-indigo-200/70 hover:border-indigo-300/80 hover:bg-indigo-50',     iconBg: 'bg-indigo-100',  icon: 'text-indigo-700',  badge: 'bg-indigo-200 text-indigo-700', time: 'text-indigo-500' },
  exercise:     { card: 'bg-amber-50/80 border border-amber-200/70 hover:border-amber-300/80 hover:bg-amber-50',         iconBg: 'bg-amber-100',   icon: 'text-amber-700',   badge: 'bg-amber-200 text-amber-700',  time: 'text-amber-600' },
  default:      { card: 'bg-slate-50/80 border border-slate-200/70 hover:border-slate-300/80 hover:bg-slate-50',         iconBg: 'bg-slate-100',   icon: 'text-slate-600',   badge: 'bg-slate-200 text-slate-600',  time: 'text-slate-500' },
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
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        <div className="w-8 h-8 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
          <FolderOpen className="h-4 w-4 text-indigo-600" />
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
                  className="w-full flex items-center gap-3 bg-slate-50 hover:bg-indigo-50 hover:border-indigo-100 border border-transparent rounded-xl px-3 py-2.5 text-left transition-colors"
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
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      className={`aspect-square relative cursor-pointer rounded-2xl shadow-sm transition-all flex flex-col items-center justify-center p-4 backdrop-blur-sm ${s.card}`}
    >
      {isCompleted && (
        <div className={`absolute top-2.5 right-2.5 ${s.badge} rounded-full p-0.5`}>
          <Check className="h-3 w-3" />
        </div>
      )}
      <div className={`w-11 h-11 rounded-xl ${s.iconBg} ${s.icon} flex items-center justify-center mb-2.5`}>
        {typeIcon}
      </div>
      <span className="text-xs font-semibold leading-tight text-center text-slate-800 line-clamp-2 px-1">{task.title}</span>
      {task.due_at && !isCompleted && (
        <div className={`flex items-center gap-1 mt-1.5 ${s.time}`}>
          <Clock className="h-3 w-3" />
          <span className="text-[10px]">{new Date(task.due_at).toLocaleDateString('it-IT')}</span>
        </div>
      )}
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
      className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-0 md:p-4"
    >
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 30, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="w-full h-full md:h-[90vh] md:max-w-3xl md:rounded-2xl overflow-hidden flex flex-col shadow-2xl border border-white/40"
        style={{ backgroundColor: 'rgba(248,250,252,0.97)', backdropFilter: 'blur(24px)' }}
      >
        {/* Header */}
        <div className="px-5 py-3.5 flex items-center gap-3 border-b border-slate-200/60 bg-white/50 backdrop-blur-sm flex-shrink-0">
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
            <h2 className="font-bold text-base text-slate-900 leading-tight line-clamp-1">{task.title}</h2>
          </div>
          {isCompleted && (
            <div className="bg-emerald-50 border border-emerald-200/60 px-2.5 py-1 rounded-xl flex items-center gap-1.5 flex-shrink-0">
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
              <div className="max-w-2xl mx-auto space-y-6">
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
                      placeholder={t('tasks.answer_placeholder')}
                      className="w-full p-4 rounded-xl border border-slate-200/70 bg-white/70 backdrop-blur-sm min-h-[200px] focus:ring-2 outline-none text-slate-700 resize-none"
                      style={{ '--tw-ring-color': accentTheme.accent } as React.CSSProperties}
                    />
                    <button
                      onClick={() => handleFinalSubmit(response)}
                      disabled={!response.trim() || isSubmitting}
                      className="w-full h-12 text-sm font-semibold rounded-xl text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ backgroundColor: accentTheme.accent }}
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
            <div className="bg-white/60 backdrop-blur-sm border border-slate-200/60 rounded-xl p-5">
              <h3 className="text-base font-bold text-slate-800 leading-snug">
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
                    className="w-full text-left p-3.5 rounded-xl border transition-all flex items-center justify-between gap-3 backdrop-blur-sm"
                    style={{
                      backgroundColor: isSelected ? `${accentTheme.accent}12` : 'rgba(255,255,255,0.65)',
                      borderColor: isSelected ? `${accentTheme.accent}55` : 'rgba(203,213,225,0.5)',
                    }}
                  >
                    <span className={`text-sm font-medium ${isSelected ? 'text-slate-900' : 'text-slate-600'}`}>
                      {opt}
                    </span>
                    <div
                      className="w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all"
                      style={{
                        backgroundColor: isSelected ? accentTheme.accent : 'transparent',
                        borderColor: isSelected ? accentTheme.accent : '#cbd5e1',
                      }}
                    >
                      {isSelected && <Check className="h-3 w-3 text-white" />}
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
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
        >
          <ChevronLeft className="h-4 w-4" /> Precedente
        </button>

        {currentIndex === questions.length - 1 ? (
          <button
            disabled={!allAnswered || isSubmitting}
            onClick={() => onSubmit(answers)}
            className="flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: accentTheme.accent }}
          >
            {isSubmitting ? 'Invio...' : 'Invia Quiz'} <Send className="h-3.5 w-3.5" />
          </button>
        ) : (
          <button
            onClick={handleNext}
            disabled={answers[currentIndex] === undefined}
            className="flex items-center gap-2 px-6 py-2 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: accentTheme.accent }}
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

  return (
    <div className="space-y-4">
      {content?.text && (
        <div className="bg-amber-50/70 backdrop-blur-sm border border-amber-200/60 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <PenTool className="h-4 w-4 text-amber-600" />
            <span className="text-xs font-bold uppercase tracking-widest text-amber-500">Esercizio</span>
          </div>
          <p className="text-slate-800 font-medium leading-relaxed">
            {content.text}
          </p>
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
        placeholder="Scrivi qui la tua risposta..."
        className="w-full p-4 rounded-xl border border-slate-200/70 bg-white/70 backdrop-blur-sm min-h-[220px] focus:ring-2 outline-none text-slate-700 resize-none"
        style={{ '--tw-ring-color': accentTheme.accent } as React.CSSProperties}
      />

      <button
        onClick={() => onSubmit(response)}
        disabled={!response.trim() || isSubmitting}
        className="w-full h-12 text-sm font-semibold rounded-xl text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        style={{ backgroundColor: accentTheme.accent }}
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

