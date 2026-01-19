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
    content_json?: string
  }) => void
  onCancel: () => void
  isLoading?: boolean
}

export default function TaskBuilder({ onSubmit, onCancel, isLoading }: TaskBuilderProps) {
  const [taskType, setTaskType] = useState<'quiz' | 'exercise' | 'discussion' | 'lesson'>('quiz')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  
  // Quiz state
  const [questions, setQuestions] = useState<QuizQuestion[]>([
    { id: '1', question: '', options: ['', '', '', ''], correctIndex: 0 }
  ])
  
  // Exercise state
  const [exerciseText, setExerciseText] = useState('')
  const [exerciseHint, setExerciseHint] = useState('')
  
  // Lesson state
  const [lessonContent, setLessonContent] = useState('')

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
        type: 'quiz',
        questions: validQuestions.map(q => ({
          question: q.question,
          options: q.options.filter(o => o.trim()),
          correctIndex: q.correctIndex,
        }))
      })
    } else if (taskType === 'exercise') {
      content_json = JSON.stringify({
        type: 'exercise',
        text: exerciseText,
        hint: exerciseHint,
      })
    } else if (taskType === 'discussion') {
      content_json = JSON.stringify({
        type: 'discussion',
        topic: description,
      })
    } else if (taskType === 'lesson') {
      content_json = JSON.stringify({
        type: 'lesson',
        content: lessonContent,
      })
    }

    onSubmit({
      title,
      description,
      task_type: taskType,
      content_json,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Crea Nuovo Compito</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Task Type Selection */}
        <div className="flex gap-2">
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
        </div>

        {/* Title */}
        <div>
          <label className="text-sm font-medium mb-1 block">Titolo</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Es: Quiz sui complementi"
          />
        </div>

        {/* Description */}
        <div>
          <label className="text-sm font-medium mb-1 block">Descrizione (opzionale)</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Istruzioni per gli studenti..."
            className="w-full p-2 border rounded-md text-sm min-h-[60px]"
          />
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
          </div>
        )}

        {/* Discussion Builder */}
        {taskType === 'discussion' && (
          <div className="border-t pt-4">
            <p className="text-sm text-gray-600">
              Gli studenti potranno rispondere liberamente alla discussione.
              Usa il campo "Descrizione" sopra per specificare l'argomento.
            </p>
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

        {/* Actions */}
        <div className="flex gap-2 pt-4 border-t">
          <Button
            onClick={handleSubmit}
            disabled={!title.trim() || isLoading}
            className="flex-1"
          >
            {isLoading ? 'Creazione...' : 'Crea Compito'}
          </Button>
          <Button variant="outline" onClick={onCancel}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
