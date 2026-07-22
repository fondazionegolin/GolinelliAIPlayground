import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  Plus, Trash2, Check, X, ClipboardList, FileText, MessageSquare, BookOpen
} from 'lucide-react'

interface QuizQuestion {
  id: string
  question: string
  options: string[]
  correctIndex: number
}

interface TaskBuilderProps {
  onSubmit: (data: {
    title: string
    description: string
    task_type: string
    due_at?: string | null
    content_json?: string
  }) => void
  onCancel: () => void
  isLoading?: boolean
  mode?: 'create' | 'edit'
  initialData?: {
    title: string
    description?: string | null
    task_type: string
    due_at?: string | null
    content_json?: string | null
  }
}

function parseInitialContent(raw?: string | null): Record<string, any> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function toDateTimeLocalValue(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export default function TaskBuilder({ onSubmit, onCancel, isLoading, mode = 'create', initialData }: TaskBuilderProps) {
  const initialContent = parseInitialContent(initialData?.content_json)
  const [taskType, setTaskType] = useState(initialData?.task_type || 'quiz')
  const [title, setTitle] = useState(initialData?.title || '')
  const [description, setDescription] = useState(initialData?.description || '')
  const [dueAt, setDueAt] = useState(() => toDateTimeLocalValue(initialData?.due_at))
  
  // Quiz state
  const [questions, setQuestions] = useState<QuizQuestion[]>(() => {
    if (!Array.isArray(initialContent.questions) || initialContent.questions.length === 0) {
      return [{ id: '1', question: '', options: ['', '', '', ''], correctIndex: 0 }]
    }
    return initialContent.questions.map((question: any, index: number) => ({
      id: String(question.id || index + 1),
      question: String(question.question || question.text || ''),
      options: Array.isArray(question.options)
        ? [...question.options.map((option: unknown) => String(option)), ...Array(4).fill('')].slice(0, Math.max(4, question.options.length))
        : ['', '', '', ''],
      correctIndex: Number.isInteger(Number(question.correctIndex)) ? Number(question.correctIndex) : 0,
    }))
  })
  
  // Exercise state
  const [exerciseText, setExerciseText] = useState(() => String(
    initialContent.text || initialContent.instructions || initialContent.content || initialContent.description || ''
  ))
  const [exerciseHint, setExerciseHint] = useState(() => String(initialContent.hint || ''))
  const [exerciseExamples, setExerciseExamples] = useState(() => {
    if (Array.isArray(initialContent.examples)) return initialContent.examples.map(String).join('\n')
    return typeof initialContent.examples === 'string' ? initialContent.examples : ''
  })
  const [discussionTopic, setDiscussionTopic] = useState(() => String(initialContent.topic || initialData?.description || ''))
  
  // Lesson state
  const [lessonContent, setLessonContent] = useState(() => String(
    initialContent.content || initialContent.text || initialContent.htmlContent || ''
  ))
  const [genericContent, setGenericContent] = useState(() => String(
    initialContent.text || initialContent.instructions || initialContent.content || initialContent.description || ''
  ))

  const addQuestion = () => {
    setQuestions([
      ...questions,
      { 
        id: String(Date.now()), 
        question: '', 
        options: ['', '', '', ''], 
        correctIndex: 0 
      }
    ])
  }

  const removeQuestion = (id: string) => {
    if (questions.length > 1) {
      setQuestions(questions.filter(q => q.id !== id))
    }
  }

  const updateQuestion = (id: string, field: string, value: string | number) => {
    setQuestions(questions.map(q => 
      q.id === id ? { ...q, [field]: value } : q
    ))
  }

  const updateOption = (questionId: string, optionIndex: number, value: string) => {
    setQuestions(questions.map(q => {
      if (q.id === questionId) {
        const newOptions = [...q.options]
        newOptions[optionIndex] = value
        return { ...q, options: newOptions }
      }
      return q
    }))
  }

  const handleSubmit = () => {
    if (!title.trim()) return

    let content_json: string | undefined

    if (taskType === 'quiz') {
      // Validate quiz
      const validQuestions = questions.filter(q => 
        q.question.trim() && q.options.some(o => o.trim())
      )
      if (validQuestions.length === 0) return

      content_json = JSON.stringify({
        ...initialContent,
        type: 'quiz',
        questions: validQuestions.map(q => ({
          question: q.question,
          options: q.options.filter(o => o.trim()),
          correctIndex: q.correctIndex,
        }))
      })
    } else if (taskType === 'exercise') {
      content_json = JSON.stringify({
        ...initialContent,
        type: 'exercise',
        text: exerciseText,
        hint: exerciseHint,
        examples: exerciseExamples.split('\n').map(example => example.trim()).filter(Boolean),
      })
    } else if (taskType === 'discussion') {
      content_json = JSON.stringify({
        ...initialContent,
        type: 'discussion',
        topic: discussionTopic,
      })
    } else if (taskType === 'lesson') {
      content_json = JSON.stringify({
        ...initialContent,
        type: 'lesson',
        content: lessonContent,
      })
    } else {
      content_json = JSON.stringify({
        ...initialContent,
        content: genericContent,
      })
    }

    onSubmit({
      title,
      description,
      task_type: taskType,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      content_json,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{mode === 'edit' ? 'Modifica Bozza' : 'Crea Nuovo Compito'}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Task Type Selection */}
        {mode === 'create' && <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant={taskType === 'quiz' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTaskType('quiz')}
          >
            <ClipboardList className="h-4 w-4 mr-1" />
            Quiz
          </Button>
          <Button
            type="button"
            variant={taskType === 'exercise' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTaskType('exercise')}
          >
            <FileText className="h-4 w-4 mr-1" />
            Esercizio
          </Button>
          <Button
            type="button"
            variant={taskType === 'discussion' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTaskType('discussion')}
          >
            <MessageSquare className="h-4 w-4 mr-1" />
            Discussione
          </Button>
          <Button
            type="button"
            variant={taskType === 'lesson' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setTaskType('lesson')}
          >
            <BookOpen className="h-4 w-4 mr-1" />
            Lezione
          </Button>
        </div>}

        {/* Title */}
        <div>
          <label className="text-sm font-medium mb-1 block">Titolo</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Es: Quiz sui complementi"
            className="focus:!border-[var(--logo-blue)] focus:outline-none focus:ring-2 focus:!ring-[var(--logo-blue)] focus:ring-offset-2 focus-visible:!border-[var(--logo-blue)] focus-visible:!ring-[var(--logo-blue)]"
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-sm font-medium mb-1 block">Descrizione (opzionale)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Istruzioni per gli studenti..."
            className="min-h-[60px] w-full rounded-md border p-2 text-sm focus:!border-[var(--logo-blue)] focus:outline-none focus:ring-2 focus:!ring-[var(--logo-blue)] focus:ring-offset-2 focus-visible:!border-[var(--logo-blue)] focus-visible:!ring-[var(--logo-blue)]"
          />
        </div>

        <div>
          <label className="text-sm font-medium mb-1 block">Scadenza (opzionale)</label>
          <Input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="h-11"
          />
          <p className="mt-1 text-xs text-gray-500">
            La scadenza viene mostrata agli studenti e resta modificabile dal docente.
          </p>
        </div>

        {/* Quiz Builder */}
        {taskType === 'quiz' && (
          <div className="space-y-4 border-t pt-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Domande</h4>
              <Button type="button" size="sm" variant="outline" onClick={addQuestion}>
                <Plus className="h-4 w-4 mr-1" />
                Aggiungi
              </Button>
            </div>

            {questions.map((q, qIndex) => (
              <div key={q.id} className="border rounded-lg p-3 space-y-3 bg-gray-50">
                <div className="flex items-start gap-2">
                  <span className="text-sm font-medium text-gray-500 mt-2">
                    {qIndex + 1}.
                  </span>
                  <Input
                    value={q.question}
                    onChange={(e) => updateQuestion(q.id, 'question', e.target.value)}
                    placeholder="Scrivi la domanda..."
                    className="flex-1"
                  />
                  {questions.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeQuestion(q.id)}
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  )}
                </div>

                <div className="pl-6 space-y-2">
                  <p className="text-xs text-gray-500">
                    Opzioni (clicca ✓ per la risposta corretta):
                  </p>
                  {q.options.map((opt, optIndex) => (
                    <div key={optIndex} className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => updateQuestion(q.id, 'correctIndex', optIndex)}
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                          q.correctIndex === optIndex
                            ? 'bg-green-500 border-green-500 text-white'
                            : 'border-gray-300 hover:border-green-400'
                        }`}
                      >
                        {q.correctIndex === optIndex && <Check className="h-3 w-3" />}
                      </button>
                      <Input
                        value={opt}
                        onChange={(e) => updateOption(q.id, optIndex, e.target.value)}
                        placeholder={`Opzione ${optIndex + 1}`}
                        className="flex-1"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Exercise Builder */}
        {taskType === 'exercise' && (
          <div className="space-y-3 border-t pt-4">
            <div>
              <label className="text-sm font-medium mb-1 block">
                Testo dell'esercizio
              </label>
              <textarea
                value={exerciseText}
                onChange={(e) => setExerciseText(e.target.value)}
                placeholder="Es: Correggi la seguente frase e individua il complemento predicativo del soggetto: 'Il bambino sembra felice.'"
                className="w-full p-2 border rounded-md text-sm min-h-[100px]"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                Suggerimento (opzionale)
              </label>
              <Input
                value={exerciseHint}
                onChange={(e) => setExerciseHint(e.target.value)}
                placeholder="Es: Il complemento predicativo si riferisce al soggetto..."
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">
                Esempi (opzionali)
              </label>
              <textarea
                value={exerciseExamples}
                onChange={(e) => setExerciseExamples(e.target.value)}
                placeholder="Inserisci un esempio per riga"
                className="w-full p-2 border rounded-md text-sm min-h-[90px]"
              />
              <p className="mt-1 text-xs text-gray-500">Un esempio per riga.</p>
            </div>
          </div>
        )}

        {/* Discussion Builder */}
        {taskType === 'discussion' && (
          <div className="space-y-2 border-t pt-4">
            <label className="text-sm font-medium block">Argomento della discussione</label>
            <textarea
              value={discussionTopic}
              onChange={(e) => setDiscussionTopic(e.target.value)}
              placeholder="Scrivi la domanda o l'argomento da discutere..."
              className="w-full p-2 border rounded-md text-sm min-h-[100px]"
            />
          </div>
        )}

        {/* Lesson Builder */}
        {taskType === 'lesson' && (
          <div className="space-y-3 border-t pt-4">
            <div>
              <label className="text-sm font-medium mb-1 block">
                Contenuto della lezione (supporta Markdown e immagini)
              </label>
              <textarea
                value={lessonContent}
                onChange={(e) => setLessonContent(e.target.value)}
                placeholder="Scrivi il contenuto della lezione...&#10;&#10;Puoi usare Markdown per formattare il testo:&#10;- **grassetto** per evidenziare&#10;- *corsivo* per enfasi&#10;- # Titoli&#10;- Elenchi puntati&#10;- ![descrizione](url) per immagini"
                className="w-full p-2 border rounded-md text-sm min-h-[200px] font-mono"
              />
            </div>
            <p className="text-xs text-gray-500">
              💡 Suggerimento: Puoi generare lezioni complete usando il chatbot Supporto Docente e poi pubblicarle qui.
            </p>
          </div>
        )}

        {!['quiz', 'exercise', 'discussion', 'lesson'].includes(taskType) && (
          <div className="space-y-2 border-t pt-4">
            <label className="text-sm font-medium block">Contenuto</label>
            <textarea
              value={genericContent}
              onChange={(e) => setGenericContent(e.target.value)}
              placeholder="Modifica il contenuto del compito..."
              className="w-full p-2 border rounded-md text-sm min-h-[160px]"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t">
          <Button
            onClick={handleSubmit}
            disabled={!title.trim() || isLoading}
            className="flex-1"
          >
            {isLoading
              ? mode === 'edit' ? 'Salvataggio...' : 'Creazione...'
              : mode === 'edit' ? 'Salva modifiche' : 'Crea Compito'}
          </Button>
          <Button variant="outline" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
