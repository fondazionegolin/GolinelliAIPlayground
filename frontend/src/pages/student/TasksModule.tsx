import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import {
  ClipboardList, Check, Clock, Send, ChevronDown, ChevronUp, Lightbulb,
  ChevronLeft, ChevronRight, BookOpen, X, Target, Sparkles, ListChecks,
  BookMarked, ExternalLink
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

interface QuizQuestion {
  question: string
  options: string[]
  correctIndex: number
}

interface Block {
  id: string
  type: 'text' | 'image'
  content: string
  x: number
  y: number
  width: number
  height: number
  style: {
    backgroundColor?: string
    color?: string
    fontSize?: number
    fontFamily?: string
    textAlign?: 'left' | 'center' | 'right'
    borderRadius?: number
    padding?: number
  }
}

interface PresentationSlide {
  order?: number // Legacy
  id?: string
  title: string
  content?: string // Legacy markdown content
  speaker_notes?: string
  blocks?: Block[] // New format
}

interface LessonSection {
  title: string
  content: string
}

interface TaskContent {
  type: 'quiz' | 'exercise' | 'discussion' | 'presentation' | 'lesson' | 'presentation_v2' | 'document_v1'
  format?: '16:9' | '4:3' | 'a4'
  questions?: QuizQuestion[]
  text?: string
  hint?: string
  topic?: string
  // Presentation fields
  title?: string
  description?: string
  slides?: PresentationSlide[]
  // Lesson/Document fields
  content?: string
  htmlContent?: string // New field for HTML documents
  sections?: LessonSection[]
  learning_objectives?: string[]
  key_concepts?: string[]
  summary?: string
  activities?: string[]
  resources?: string[]
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

interface TasksModuleProps {
  openTaskId?: string | null
}

export default function TasksModule({ openTaskId }: TasksModuleProps) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [expandedTask, setExpandedTask] = useState<string | null>(openTaskId || null)
  const [responses, setResponses] = useState<Record<string, string>>({})
  const [quizAnswers, setQuizAnswers] = useState<Record<string, Record<number, number>>>({})

  useEffect(() => {
    if (openTaskId) {
      setExpandedTask(openTaskId)
    }
  }, [openTaskId])

  const { data: tasks, isLoading } = useQuery<TaskData[]>({
    queryKey: ['student-tasks'],
    queryFn: async () => {
      const res = await studentApi.getTasks()
      return res.data
    },
  })

  const submitMutation = useMutation({
    mutationFn: ({ taskId, content, content_json }: { taskId: string; content?: string; content_json?: string }) =>
      studentApi.submitTask(taskId, content, content_json),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['student-tasks'] })
      setResponses(prev => ({ ...prev, [variables.taskId]: '' }))
      setQuizAnswers(prev => ({ ...prev, [variables.taskId]: {} }))
      toast({ title: 'Risposta inviata!' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Errore nell\'invio' })
    },
  })

  const handleSubmitExercise = (taskId: string) => {
    const content = responses[taskId]
    if (content?.trim()) {
      submitMutation.mutate({ taskId, content: content.trim() })
    }
  }

  const handleSubmitQuiz = (taskId: string, task: TaskData) => {
    const answers = quizAnswers[taskId]
    if (!answers) return

    const content = parseTaskContent(task)
    if (!content?.questions) return

    const content_json = JSON.stringify({
      answers: Object.entries(answers).map(([qIndex, aIndex]) => ({
        questionIndex: parseInt(qIndex),
        selectedIndex: aIndex,
      }))
    })

    // Calculate score
    let correct = 0
    content.questions.forEach((q, i) => {
      if (answers[i] === q.correctIndex) correct++
    })
    const scoreText = `${correct}/${content.questions.length}`

    submitMutation.mutate({ taskId, content: scoreText, content_json })
  }

  const parseTaskContent = (task: TaskData): TaskContent | null => {
    if (!task.content_json) return null
    try {
      return JSON.parse(task.content_json)
    } catch {
      return null
    }
  }

  const getTaskTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      exercise: 'Esercizio',
      quiz: 'Quiz',
      reading: 'Lettura',
      discussion: 'Discussione',
      project: 'Progetto',
      presentation: 'Presentazione',
      lesson: 'Lezione',
      document_v1: 'Documento', // Label for new type
    }
    return labels[type] || type
  }

  const getTaskTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      exercise: 'bg-blue-100 text-blue-700',
      quiz: 'bg-purple-100 text-purple-700',
      reading: 'bg-green-100 text-green-700',
      discussion: 'bg-orange-100 text-orange-700',
      project: 'bg-pink-100 text-pink-700',
      presentation: 'bg-indigo-100 text-indigo-700',
      lesson: 'bg-emerald-100 text-emerald-700',
      document_v1: 'bg-slate-100 text-slate-700',
    }
    return colors[type] || 'bg-gray-100 text-gray-700'
  }

  if (isLoading) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">Caricamento compiti...</p>
      </div>
    )
  }

  if (!tasks || tasks.length === 0) {
    return (
      <div className="p-6 text-center">
        <ClipboardList className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
        <h3 className="font-semibold mb-2">Nessun compito</h3>
        <p className="text-muted-foreground">
          Il docente non ha ancora assegnato compiti.
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 mb-4">
        <ClipboardList className="h-5 w-5 text-emerald-600" />
        <h3 className="font-semibold">Compiti Assegnati ({tasks.length})</h3>
      </div>

      {tasks.map((task) => (
        <Card key={task.id} className={task.submission ? 'border-green-200 bg-green-50/50' : ''}>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <CardTitle className="text-base">{task.title}</CardTitle>
                  <span className={`text-xs px-2 py-0.5 rounded ${getTaskTypeColor(task.task_type)}`}>
                    {getTaskTypeLabel(task.task_type)}
                  </span>
                  {task.submission && (
                    <span className="text-xs px-2 py-0.5 rounded bg-green-100 text-green-700 flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      Completato
                    </span>
                  )}
                </div>
                {task.due_at && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Scadenza: {new Date(task.due_at).toLocaleDateString('it-IT')}
                  </p>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
              >
                {expandedTask === task.id ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </Button>
            </div>
          </CardHeader>

          {expandedTask === task.id && (
            <CardContent className="pt-2">
              {task.description && (
                <p className="text-sm text-muted-foreground mb-4">{task.description}</p>
              )}

              {task.submission ? (
                <SubmissionView task={task} />
              ) : (
                <TaskInputView
                  task={task}
                  responses={responses}
                  setResponses={setResponses}
                  quizAnswers={quizAnswers}
                  setQuizAnswers={setQuizAnswers}
                  onSubmitExercise={handleSubmitExercise}
                  onSubmitQuiz={handleSubmitQuiz}
                  isPending={submitMutation.isPending}
                  parseTaskContent={parseTaskContent}
                  onSubmitDocument={() => submitMutation.mutate({ taskId: task.id, content: 'Letto' })}
                />
              )}
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  )
}

function SubmissionView({ task }: { task: TaskData }) {
  return (
    <div className="space-y-3">
      <div className="bg-white p-3 rounded-lg border">
        <p className="text-xs text-muted-foreground mb-1">La tua risposta:</p>
        <p className="text-sm">{task.submission?.content}</p>
        <p className="text-xs text-muted-foreground mt-2">
          Inviata: {new Date(task.submission?.submitted_at || '').toLocaleString('it-IT')}
        </p>
      </div>
      
      {task.submission?.score && (
        <div className="bg-blue-50 p-3 rounded-lg border border-blue-200">
          <p className="text-sm font-medium text-blue-700">
            Valutazione: {task.submission.score}
          </p>
          {task.submission.feedback && (
            <p className="text-sm text-blue-600 mt-1">{task.submission.feedback}</p>
          )}
        </div>
      )}
    </div>
  )
}

interface TaskInputViewProps {
  task: TaskData
  responses: Record<string, string>
  setResponses: React.Dispatch<React.SetStateAction<Record<string, string>>>
  quizAnswers: Record<string, Record<number, number>>
  setQuizAnswers: React.Dispatch<React.SetStateAction<Record<string, Record<number, number>>>>
  onSubmitExercise: (taskId: string) => void
  onSubmitQuiz: (taskId: string, task: TaskData) => void
  onSubmitDocument: (taskId: string) => void
  isPending: boolean
  parseTaskContent: (task: TaskData) => TaskContent | null
}

function TaskInputView({
  task,
  responses,
  setResponses,
  quizAnswers,
  setQuizAnswers,
  onSubmitExercise,
  onSubmitQuiz,
  onSubmitDocument,
  isPending,
  parseTaskContent,
}: TaskInputViewProps) {
  const content = parseTaskContent(task)

  // Quiz view
  if (task.task_type === 'quiz' && content?.questions) {
    const answers = quizAnswers[task.id] || {}
    const allAnswered = content.questions.every((_, i) => answers[i] !== undefined)

    return (
      <div className="space-y-4">
        {content.questions.map((q, qIndex) => (
          <div key={qIndex} className="border rounded-lg p-4 bg-gray-50">
            <p className="font-medium mb-3">
              {qIndex + 1}. {q.question}
            </p>
            <div className="space-y-2">
              {q.options.map((opt, optIndex) => (
                <button
                  key={optIndex}
                  type="button"
                  onClick={() => setQuizAnswers(prev => ({
                    ...prev,
                    [task.id]: { ...prev[task.id], [qIndex]: optIndex }
                  }))}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    answers[qIndex] === optIndex
                      ? 'bg-emerald-100 border-emerald-500 text-emerald-800'
                      : 'bg-white hover:bg-gray-100 border-gray-200'
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                      answers[qIndex] === optIndex
                        ? 'bg-emerald-500 border-emerald-500'
                        : 'border-gray-300'
                    }`}>
                      {answers[qIndex] === optIndex && <Check className="h-3 w-3 text-white" />}
                    </span>
                    {opt}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}
        <Button
          onClick={() => onSubmitQuiz(task.id, task)}
          disabled={!allAnswered || isPending}
          className="w-full"
        >
          <Send className="h-4 w-4 mr-2" />
          Invia Quiz ({Object.keys(answers).length}/{content.questions.length} risposte)
        </Button>
      </div>
    )
  }

  // Exercise view
  if (task.task_type === 'exercise' && content?.text) {
    return (
      <div className="space-y-4">
        <div className="bg-amber-50 p-4 rounded-lg border border-amber-200">
          <p className="text-sm font-medium text-amber-800 mb-2">Esercizio:</p>
          <p className="text-sm text-amber-900">{content.text}</p>
          {content.hint && (
            <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
              <Lightbulb className="h-3 w-3" />
              Suggerimento: {content.hint}
            </p>
          )}
        </div>
        <textarea
          value={responses[task.id] || ''}
          onChange={(e) => setResponses(prev => ({ ...prev, [task.id]: e.target.value }))}
          placeholder="Scrivi la tua risposta..."
          className="w-full p-3 border rounded-lg text-sm min-h-[100px] resize-none"
        />
        <Button
          onClick={() => onSubmitExercise(task.id)}
          disabled={!responses[task.id]?.trim() || isPending}
          className="w-full"
        >
          <Send className="h-4 w-4 mr-2" />
          Invia Risposta
        </Button>
      </div>
    )
  }

  // Presentation view (Legacy and V2)
  if ((task.task_type === 'presentation' || content?.type === 'presentation_v2') && content?.slides && content.slides.length > 0) {
    return <PresentationViewer content={content} slides={content.slides} title={content.title || task.title} />
  }

  // Document/HTML view
  if (content?.type === 'document_v1' || content?.htmlContent) {
    return (
      <div className="space-y-4">
        <div className="border bg-white rounded-lg shadow-sm p-8 min-h-[400px]">
          <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: content.htmlContent || '' }} />
        </div>
        <Button
          onClick={() => onSubmitDocument(task.id)}
          disabled={isPending}
          className="w-full bg-emerald-600 hover:bg-emerald-700"
        >
          <Check className="h-4 w-4 mr-2" />
          Segna come letto
        </Button>
      </div>
    )
  }

  // Lesson view
  if (task.task_type === 'lesson' && content) {
    return (
      <LessonViewer
        content={content}
        title={content.title || task.title}
        description={content.description || task.description}
      />
    )
  }

  // Default text response (discussion, etc.)
  return (
    <div className="space-y-3">
      <textarea
        value={responses[task.id] || ''}
        onChange={(e) => setResponses(prev => ({ ...prev, [task.id]: e.target.value }))}
        placeholder="Scrivi la tua risposta..."
        className="w-full p-3 border rounded-lg text-sm min-h-[100px] resize-none"
      />
      <Button
        onClick={() => onSubmitExercise(task.id)}
        disabled={!responses[task.id]?.trim() || isPending}
        className="w-full"
      >
        <Send className="h-4 w-4 mr-2" />
        Invia Risposta
      </Button>
    </div>
  )
}

// Presentation Viewer Component
function PresentationViewer({ slides, title: _title, content }: { slides: PresentationSlide[]; title: string; content?: TaskContent }) {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0)
  const [scale, setScale] = useState(1)
  const containerRef = useRef<HTMLDivElement>(null)

  // Sort slides by order if present (legacy), otherwise use array order
  const sortedSlides = [...slides].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const slide = sortedSlides[currentSlideIndex]
  
  const isV2 = content?.type === 'presentation_v2' || !!slide.blocks
  const format = content?.format || '16:9'

  // Dimensions reference (must match editor)
  const FORMAT_DIMENSIONS = {
    '16:9': { width: 960, height: 540 },
    '4:3': { width: 800, height: 600 },
    'a4': { width: 595, height: 842 }
  }
  const dims = FORMAT_DIMENSIONS[format] || FORMAT_DIMENSIONS['16:9']

  // Handle auto-scaling
  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && isV2) {
        const parentWidth = containerRef.current.clientWidth
        // Calculate scale to fit width
        const newScale = Math.min(parentWidth / dims.width, 1) 
        setScale(newScale)
      }
    }
    
    window.addEventListener('resize', handleResize)
    handleResize() // Initial call
    // Small delay to ensure parent container is rendered
    setTimeout(handleResize, 100)
    
    return () => window.removeEventListener('resize', handleResize)
  }, [currentSlideIndex, isV2, dims.width])

  const goToPrevious = () => {
    setCurrentSlideIndex((prev) => Math.max(0, prev - 1))
  }

  const goToNext = () => {
    setCurrentSlideIndex((prev) => Math.min(sortedSlides.length - 1, prev + 1))
  }

  return (
    <div className="space-y-4">
      {/* Slide Display Area */}
      <div 
        className={`rounded-xl bg-slate-100 overflow-hidden relative flex items-center justify-center border shadow-sm ${!isV2 ? 'p-6 min-h-[300px]' : ''}`}
        ref={containerRef}
        style={isV2 ? { height: dims.height * scale + 40 } : {}} // Add padding for V2 height
      >
        {isV2 ? (
          /* V2 Block Based Renderer */
          <div 
            className="bg-white shadow-lg origin-top transition-transform duration-200 ease-out"
            style={{
              width: dims.width,
              height: dims.height,
              transform: `scale(${scale})`,
              marginTop: 20
            }}
          >
             {/* Slide Title */}
             <div className="absolute top-0 left-0 right-0 p-8 z-10 pointer-events-none">
                <h2 className="text-4xl font-bold text-slate-900">{slide.title}</h2>
             </div>

             {/* Blocks */}
             {slide.blocks?.map((block, idx) => (
               <div
                 key={block.id || idx}
                 className="absolute"
                 style={{
                   left: block.x,
                   top: block.y,
                   width: block.width,
                   height: block.height,
                   backgroundColor: block.style.backgroundColor,
                   borderRadius: block.style.borderRadius,
                 }}
               >
                 {block.type === 'text' ? (
                   <div 
                     className="w-full h-full p-2 whitespace-pre-wrap break-words"
                     style={{
                       color: block.style.color,
                       fontSize: block.style.fontSize,
                       fontFamily: block.style.fontFamily,
                       textAlign: block.style.textAlign
                     }}
                   >
                     {block.content}
                   </div>
                 ) : (
                   <img 
                     src={block.content} 
                     className="w-full h-full object-cover rounded-sm" 
                     alt="content" 
                   />
                 )}
               </div>
             ))}
          </div>
        ) : (
          /* Legacy Markdown Renderer */
          <div className="w-full max-w-3xl">
            <div className="flex justify-between items-start mb-6 border-b pb-2">
               <h3 className="text-2xl font-bold text-indigo-800 pr-16">{slide?.title}</h3>
               <span className="px-2 py-1 bg-indigo-100 text-indigo-700 text-xs font-medium rounded-full">
                 {currentSlideIndex + 1} / {sortedSlides.length}
               </span>
            </div>
            <div className="prose prose-sm max-w-none prose-headings:text-indigo-800 prose-p:text-gray-700 prose-li:text-gray-700">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
                {slide?.content || ''}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      {/* Navigation Controls */}
      <div className="flex items-center justify-between bg-white p-3 rounded-lg border">
        <Button
          variant="ghost"
          onClick={goToPrevious}
          disabled={currentSlideIndex === 0}
          className="flex items-center gap-1"
        >
          <ChevronLeft className="h-4 w-4" />
          Precedente
        </Button>

        {/* Slide dots or counter */}
        <span className="text-sm font-medium text-slate-500">
           Slide {currentSlideIndex + 1} di {sortedSlides.length}
        </span>

        <Button
          variant="ghost"
          onClick={goToNext}
          disabled={currentSlideIndex === sortedSlides.length - 1}
          className="flex items-center gap-1"
        >
          Successiva
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      
      {/* Keyboard hint */}
      <p className="text-xs text-center text-gray-400">
        Usa i pulsanti per navigare
      </p>
    </div>
  )
}

// Lesson Viewer Component - Ebook style modal
interface LessonViewerProps {
  content: TaskContent
  title: string
  description?: string | null
  onClose?: () => void
}

function LessonViewer({ content, title, description }: LessonViewerProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [currentSection, setCurrentSection] = useState(0)

  const sections = content.sections || []
  const hasMultipleSections = sections.length > 1

  return (
    <>
      {/* Preview Card */}
      <div className="space-y-4">
        <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-6">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-emerald-500 rounded-xl text-white">
              <BookOpen className="h-8 w-8" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-bold text-emerald-800 mb-1">{title}</h3>
              {description && (
                <p className="text-sm text-emerald-600 mb-3">{description}</p>
              )}

              {/* Learning Objectives Preview */}
              {content.learning_objectives && content.learning_objectives.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-semibold text-emerald-700 mb-1 flex items-center gap-1">
                    <Target className="h-3 w-3" />
                    Obiettivi di apprendimento:
                  </p>
                  <ul className="text-xs text-emerald-600 space-y-0.5">
                    {content.learning_objectives.slice(0, 2).map((obj, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <span className="text-emerald-400">•</span>
                        {obj}
                      </li>
                    ))}
                    {content.learning_objectives.length > 2 && (
                      <li className="text-emerald-400 italic">
                        +{content.learning_objectives.length - 2} altri...
                      </li>
                    )}
                  </ul>
                </div>
              )}

              {/* Sections count */}
              {sections.length > 0 && (
                <p className="text-xs text-emerald-500">
                  {sections.length} {sections.length === 1 ? 'sezione' : 'sezioni'} disponibili
                </p>
              )}
            </div>
          </div>
        </div>

        <Button
          onClick={() => setIsModalOpen(true)}
          className="w-full bg-emerald-600 hover:bg-emerald-700"
        >
          <BookOpen className="h-4 w-4 mr-2" />
          Apri Lezione
        </Button>
      </div>

      {/* Modal Ebook Reader */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-6 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <BookOpen className="h-6 w-6" />
                <div>
                  <h2 className="font-bold text-lg">{title}</h2>
                  {hasMultipleSections && (
                    <p className="text-emerald-100 text-sm">
                      Sezione {currentSection + 1} di {sections.length}
                    </p>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsModalOpen(false)}
                className="text-white hover:bg-emerald-500"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto">
              <div className="p-6 md:p-8">
                {/* Learning Objectives */}
                {content.learning_objectives && content.learning_objectives.length > 0 && currentSection === 0 && (
                  <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-xl">
                    <h3 className="font-semibold text-amber-800 mb-3 flex items-center gap-2">
                      <Target className="h-5 w-5" />
                      Obiettivi di Apprendimento
                    </h3>
                    <ul className="space-y-2">
                      {content.learning_objectives.map((obj, i) => (
                        <li key={i} className="flex items-start gap-2 text-amber-700">
                          <Check className="h-4 w-4 mt-0.5 text-amber-500 flex-shrink-0" />
                          <span>{obj}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Key Concepts */}
                {content.key_concepts && content.key_concepts.length > 0 && currentSection === 0 && (
                  <div className="mb-8 p-4 bg-violet-50 border border-violet-200 rounded-xl">
                    <h3 className="font-semibold text-violet-800 mb-3 flex items-center gap-2">
                      <Sparkles className="h-5 w-5" />
                      Concetti Chiave
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {content.key_concepts.map((concept, i) => (
                        <span
                          key={i}
                          className="px-3 py-1 bg-violet-100 text-violet-700 rounded-full text-sm font-medium"
                        >
                          {concept}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Main Content - Sections or Simple Content */}
                {sections.length > 0 ? (
                  <div className="prose prose-emerald max-w-none">
                    <h2 className="text-2xl font-bold text-emerald-800 mb-4 pb-2 border-b border-emerald-100">
                      {sections[currentSection]?.title}
                    </h2>
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      className="text-gray-700 leading-relaxed"
                    >
                      {sections[currentSection]?.content || ''}
                    </ReactMarkdown>
                  </div>
                ) : content.content ? (
                  <div className="prose prose-emerald max-w-none">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm, remarkMath]}
                      rehypePlugins={[rehypeKatex]}
                      className="text-gray-700 leading-relaxed"
                    >
                      {content.content}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-gray-500 text-center py-8">
                    Nessun contenuto disponibile per questa lezione.
                  </p>
                )}

                {/* Summary - show at the end */}
                {content.summary && (!hasMultipleSections || currentSection === sections.length - 1) && (
                  <div className="mt-8 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                    <h3 className="font-semibold text-blue-800 mb-3 flex items-center gap-2">
                      <BookMarked className="h-5 w-5" />
                      Riepilogo
                    </h3>
                    <p className="text-blue-700">{content.summary}</p>
                  </div>
                )}

                {/* Activities */}
                {content.activities && content.activities.length > 0 && (!hasMultipleSections || currentSection === sections.length - 1) && (
                  <div className="mt-8 p-4 bg-orange-50 border border-orange-200 rounded-xl">
                    <h3 className="font-semibold text-orange-800 mb-3 flex items-center gap-2">
                      <ListChecks className="h-5 w-5" />
                      Attività Suggerite
                    </h3>
                    <ul className="space-y-2">
                      {content.activities.map((activity, i) => (
                        <li key={i} className="flex items-start gap-2 text-orange-700">
                          <span className="w-5 h-5 bg-orange-200 text-orange-600 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {i + 1}
                          </span>
                          <span>{activity}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Resources */}
                {content.resources && content.resources.length > 0 && (!hasMultipleSections || currentSection === sections.length - 1) && (
                  <div className="mt-8 p-4 bg-gray-50 border border-gray-200 rounded-xl">
                    <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                      <ExternalLink className="h-5 w-5" />
                      Risorse Aggiuntive
                    </h3>
                    <ul className="space-y-1">
                      {content.resources.map((resource, i) => (
                        <li key={i} className="text-gray-600 flex items-center gap-2">
                          <span className="text-gray-400">•</span>
                          {resource}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Modal Footer - Navigation */}
            {hasMultipleSections && (
              <div className="border-t bg-gray-50 px-6 py-4 flex items-center justify-between">
                <Button
                  variant="outline"
                  onClick={() => setCurrentSection(prev => Math.max(0, prev - 1))}
                  disabled={currentSection === 0}
                >
                  <ChevronLeft className="h-4 w-4 mr-1" />
                  Precedente
                </Button>

                {/* Section dots */}
                <div className="flex gap-2">
                  {sections.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentSection(idx)}
                      className={`w-3 h-3 rounded-full transition-colors ${
                        idx === currentSection
                          ? 'bg-emerald-600'
                          : 'bg-gray-300 hover:bg-emerald-300'
                      }`}
                      aria-label={`Vai alla sezione ${idx + 1}`}
                    />
                  ))}
                </div>

                <Button
                  variant="outline"
                  onClick={() => setCurrentSection(prev => Math.min(sections.length - 1, prev + 1))}
                  disabled={currentSection === sections.length - 1}
                >
                  Successiva
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </div>
            )}

            {/* Close button for single section lessons */}
            {!hasMultipleSections && (
              <div className="border-t bg-gray-50 px-6 py-4 flex justify-center">
                <Button
                  onClick={() => setIsModalOpen(false)}
                  className="bg-emerald-600 hover:bg-emerald-700"
                >
                  <Check className="h-4 w-4 mr-2" />
                  Ho completato la lettura
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
