import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { studentApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import {
  ClipboardList, Check, Clock, Send, Lightbulb,
  ChevronLeft, ChevronRight, X, 
  Award, ArrowRight, CheckCircle2,
  Monitor, PenTool, BookOpen
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
  submission: {
    id: string
    content: string
    content_json?: string
    submitted_at: string
    score: string | null
    feedback: string | null
  } | null
}

type Priority = 'high' | 'medium' | 'low'

interface TasksModuleProps {
  openTaskId?: string | null
  onOpenDocument?: (taskId: string) => void
}

export default function TasksModule({ openTaskId, onOpenDocument }: TasksModuleProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(openTaskId || null)
  const [accentTheme] = useState(getStudentAccentTheme(loadStudentAccent()))

  const { data: tasks, isLoading } = useQuery<TaskData[]>({
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

  useEffect(() => {
    if (openTaskId) setSelectedTaskId(openTaskId)
  }, [openTaskId])

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
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{t('tasks.title')}</h2>
              <p className="text-slate-500">{t('tasks.subtitle')}</p>
            </div>
            <div className="bg-white/50 backdrop-blur-md px-4 py-2 rounded-full border border-slate-200 shadow-sm flex items-center gap-2">
              <Award className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-bold text-slate-700">
                {t('tasks.completed_count', { done: tasks.filter(t => t.submission).length, total: tasks.length })}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {tasks.map((task) => (
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
        </div>
      </div>

      {/* Task Viewer Modal */}
      <AnimatePresence>
        {selectedTask && (
          <TaskViewerOverlay 
            task={selectedTask} 
            onClose={() => setSelectedTaskId(null)} 
            accentTheme={accentTheme}
            onSuccess={() => queryClient.invalidateQueries({ queryKey: ['student-tasks'] })}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function TaskCard({ task, onClick, accentColor }: { task: TaskData; onClick: () => void; accentColor: string }) {
  const { t } = useTranslation()
  const isCompleted = !!task.submission
  
  // Calculate priority
  const priority = useMemo((): Priority => {
    if (isCompleted) return 'low'
    if (!task.due_at) return 'medium'
    const dueDate = new Date(task.due_at)
    const now = new Date()
    const diff = dueDate.getTime() - now.getTime()
    const diffHours = diff / (1000 * 60 * 60)
    
    if (diffHours < 0) return 'high' // Expired
    if (diffHours < 24) return 'high'
    if (diffHours < 72) return 'medium'
    return 'low'
  }, [task.due_at, isCompleted])

  const typeIcon = useMemo(() => {
    switch (task.task_type) {
      case 'quiz': return <ListChecksIcon className="h-5 w-5" />
      case 'lesson': return <BookOpen className="h-5 w-5" />
      case 'presentation': return <Monitor className="h-5 w-5" />
      case 'exercise': return <PenTool className="h-5 w-5" />
      default: return <ClipboardList className="h-5 w-5" />
    }
  }, [task.task_type])

  const priorityStyles = {
    high: 'bg-red-50 text-red-600 border-red-100',
    medium: 'bg-amber-50 text-amber-600 border-amber-100',
    low: 'bg-slate-50 text-slate-500 border-slate-100'
  }

  return (
    <motion.div
      whileHover={{ y: -4, boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)' }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={`
        relative group cursor-pointer bg-white/70 backdrop-blur-md rounded-2xl border transition-all duration-300
        ${isCompleted ? 'border-emerald-500/30' : 'border-slate-200'}
      `}
    >
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className={`p-2.5 rounded-xl shadow-sm ${isCompleted ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
            {typeIcon}
          </div>
          <div className={`px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-wider ${priorityStyles[priority]}`}>
            {priority === 'high' ? (isCompleted ? t('tasks.priority_low') : t('tasks.priority_urgent')) : priority === 'medium' ? t('tasks.priority_medium') : t('tasks.priority_low')}
          </div>
        </div>

        {/* Title & Desc */}
        <h3 className={`text-lg font-bold mb-1 line-clamp-1 ${isCompleted ? 'text-emerald-900' : 'text-slate-800'}`}>
          {task.title}
        </h3>
        <p className="text-sm text-slate-500 line-clamp-2 mb-6 min-h-[40px]">
          {task.description || t('tasks.no_description')}
        </p>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-slate-100">
          <div className="flex items-center gap-4">
            {task.due_at && (
              <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                <Clock className="h-3.5 w-3.5" />
                {new Date(task.due_at).toLocaleDateString('it-IT')}
              </div>
            )}
            {task.points && (
              <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                <TargetIcon className="h-3.5 w-3.5" />
                {task.points} pt
              </div>
            )}
          </div>
          
          <div className={`flex items-center gap-1.5 text-sm font-bold ${isCompleted ? 'text-emerald-600' : ''}`} style={{ color: !isCompleted ? accentColor : undefined }}>
            {isCompleted ? (
              <>
                <CheckCircle2 className="h-4 w-4" />
                <span>{t('tasks.done')}</span>
              </>
            ) : (
              <>
                <span>{t('tasks.start')}</span>
                <ArrowRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Completion overlay badge */}
      {isCompleted && (
        <div className="absolute top-0 right-0 p-2">
          <div className="bg-emerald-500 text-white rounded-full p-0.5 shadow-sm">
            <Check className="h-3 w-3" />
          </div>
        </div>
      )}
    </motion.div>
  )
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
      className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-0 md:p-4"
    >
      <motion.div
        initial={{ y: 50, scale: 0.95 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 50, scale: 0.95 }}
        className="bg-white w-full h-full md:h-[90vh] md:max-w-4xl md:rounded-3xl shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between shrink-0 bg-white/80 backdrop-blur-md sticky top-0 z-10">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={onClose} className="rounded-full">
              <X className="h-5 w-5" />
            </Button>
            <div>
              <h2 className="font-bold text-lg text-slate-900 leading-tight line-clamp-1">{task.title}</h2>
              <div className="flex items-center gap-3 mt-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  {task.task_type}
                </span>
                {task.due_at && (
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <Clock className="h-3 w-3" /> {t('tasks.deadline')} {new Date(task.due_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </div>
          
          {isCompleted && (
            <div className="bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-100 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="text-xs font-bold text-emerald-700">{t('tasks.completed_badge')}</span>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto bg-slate-50/50">
          <div className="p-6 md:p-8">
            {isCompleted ? (
              <SubmissionSummary task={task} />
            ) : (
              <div className="max-w-2xl mx-auto space-y-8">
                {task.description && (
                  <div className="prose prose-slate max-w-none">
                    <p className="text-slate-600 leading-relaxed text-lg">
                      {task.description}
                    </p>
                  </div>
                )}

                {task.task_type === 'quiz' && content?.questions ? (
                  <QuizCarousel 
                    questions={content.questions} 
                    onSubmit={(answers) => {
                      let correct = 0
                      content.questions!.forEach((q, i) => {
                        if (answers[i] === q.correctIndex) correct++
                      })
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
                      className="w-full p-4 rounded-2xl border border-slate-200 bg-white shadow-sm min-h-[200px] focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                    <Button
                      onClick={() => handleFinalSubmit(response)}
                      disabled={!response.trim() || isSubmitting}
                      className="w-full h-12 text-lg rounded-xl"
                      style={{ backgroundColor: accentTheme.accent }}
                    >
                      {isSubmitting ? t('tasks.submitting') : t('tasks.submit_answer')}
                    </Button>
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
    <div className="space-y-8">
      {/* Progress */}
      <div className="flex items-center gap-4">
        <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
          <motion.div 
            className="h-full" 
            style={{ backgroundColor: accentTheme.accent }}
            animate={{ width: `${((currentIndex + 1) / questions.length) * 100}%` }}
          />
        </div>
        <span className="text-xs font-bold text-slate-400 uppercase">
          Domanda {currentIndex + 1} di {questions.length}
        </span>
      </div>

      <div className="min-h-[300px] relative overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentIndex}
            initial={{ x: 50, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -50, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-6"
          >
            <h3 className="text-xl font-bold text-slate-800 leading-snug">
              {questions[currentIndex].question}
            </h3>

            <div className="space-y-3">
              {questions[currentIndex].options.map((opt, optIndex) => (
                <button
                  key={optIndex}
                  onClick={() => setAnswers(prev => ({ ...prev, [currentIndex]: optIndex }))}
                  className={`
                    w-full text-left p-4 rounded-2xl border-2 transition-all flex items-center justify-between group
                    ${answers[currentIndex] === optIndex 
                      ? 'bg-white border-indigo-500 shadow-md' 
                      : 'bg-white border-transparent hover:border-slate-200'}
                  `}
                  style={answers[currentIndex] === optIndex ? { borderColor: accentTheme.accent } : {}}
                >
                  <span className={`text-sm font-medium ${answers[currentIndex] === optIndex ? 'text-slate-900' : 'text-slate-600'}`}>
                    {opt}
                  </span>
                  <div className={`
                    w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all
                    ${answers[currentIndex] === optIndex ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-slate-200'}
                  `}
                  style={answers[currentIndex] === optIndex ? { backgroundColor: accentTheme.accent, borderColor: accentTheme.accent } : {}}
                  >
                    {answers[currentIndex] === optIndex && <Check className="h-3.5 w-3.5" />}
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-6 border-t border-slate-100">
        <Button 
          variant="ghost" 
          onClick={handlePrev} 
          disabled={currentIndex === 0}
          className="gap-2 rounded-full"
        >
          <ChevronLeft className="h-4 w-4" /> Precedente
        </Button>

        {currentIndex === questions.length - 1 ? (
          <Button 
            disabled={!allAnswered || isSubmitting}
            onClick={() => onSubmit(answers)}
            className="gap-2 rounded-full px-8 shadow-lg shadow-indigo-100"
            style={{ backgroundColor: accentTheme.accent }}
          >
            {isSubmitting ? 'Invio...' : 'Invia Quiz'} <Send className="h-4 w-4" />
          </Button>
        ) : (
          <Button 
            onClick={handleNext}
            disabled={answers[currentIndex] === undefined}
            className="gap-2 rounded-full px-8"
            style={{ backgroundColor: accentTheme.accent }}
          >
            Avanti <ChevronRight className="h-4 w-4" />
          </Button>
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
    <div className="space-y-6">
      {content?.text && (
        <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <PenTool className="h-4 w-4" style={{ color: accentTheme.accent }} />
            <span className="text-xs font-bold uppercase tracking-widest text-slate-400">Esercizio</span>
          </div>
          <p className="text-slate-800 font-medium leading-relaxed italic">
            "{content.text}"
          </p>
          {content.hint && (
            <div className="mt-4 flex items-start gap-2 text-xs text-amber-600 bg-amber-50 p-3 rounded-xl border border-amber-100">
              <Lightbulb className="h-3.5 w-3.5 shrink-0" />
              <span>{content.hint}</span>
            </div>
          )}
        </div>
      )}

      <textarea
        value={response}
        onChange={(e) => setResponse(e.target.value)}
        placeholder="Scrivi qui la tua risposta..."
        className="w-full p-5 rounded-3xl border border-slate-200 bg-white shadow-sm min-h-[250px] focus:ring-2 focus:ring-indigo-500 outline-none text-slate-700"
      />

      <Button
        onClick={() => onSubmit(response)}
        disabled={!response.trim() || isSubmitting}
        className="w-full h-14 text-lg rounded-2xl shadow-lg transition-all active:scale-[0.99]"
        style={{ backgroundColor: accentTheme.accent }}
      >
        {isSubmitting ? 'Invio in corso...' : 'Consegna Risposta'}
      </Button>
    </div>
  )
}

function SubmissionSummary({ task }: { task: TaskData }) {
  const submission = task.submission
  if (!submission) return null

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-50 mb-4">
          <CheckCircle2 className="h-8 w-8 text-emerald-500" />
        </div>
        <h3 className="text-2xl font-bold text-slate-900">Ottimo lavoro!</h3>
        <p className="text-slate-500">Hai completato questa attività il {new Date(submission.submitted_at).toLocaleDateString()}</p>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {/* Answer Box */}
        <div className="bg-white/60 backdrop-blur-md p-6 rounded-3xl border border-slate-200 shadow-sm">
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">La tua consegna:</p>
          <div className="prose prose-slate prose-sm max-w-none">
            <p className="text-slate-700 leading-relaxed font-medium">
              {submission.content}
            </p>
          </div>
        </div>

        {/* Feedback / Score Box */}
        {(submission.score || submission.feedback) && (
          <div className="bg-indigo-500/5 backdrop-blur-md p-6 rounded-3xl border border-indigo-500/20 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Feedback del Docente</span>
              {submission.score && (
                <div className="bg-white px-3 py-1 rounded-full border border-indigo-100 font-bold text-indigo-600 text-sm shadow-sm">
                  Voto: {submission.score}
                </div>
              )}
            </div>
            {submission.feedback ? (
              <p className="text-slate-700 leading-relaxed">{submission.feedback}</p>
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

function TargetIcon(props: any) {
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
      <circle cx="12" cy="12" r="10" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="2" />
    </svg>
  )
}
