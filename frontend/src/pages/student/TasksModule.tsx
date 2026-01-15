import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { studentApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { 
  ClipboardList, Check, Clock, Send, ChevronDown, ChevronUp, Lightbulb
} from 'lucide-react'

interface QuizQuestion {
  question: string
  options: string[]
  correctIndex: number
}

interface TaskContent {
  type: 'quiz' | 'exercise' | 'discussion'
  questions?: QuizQuestion[]
  text?: string
  hint?: string
  topic?: string
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
