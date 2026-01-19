import { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { Button } from './ui/button'

interface QuizQuestion {
  question: string
  options: string[]
  correctIndex: number
  explanation?: string
  points?: number
}

interface QuizData {
  title: string
  description: string
  questions: QuizQuestion[]
  total_points?: number
  time_limit_minutes?: number
}

interface LessonSection {
  title: string
  content: string
  duration_minutes?: number
}

interface LessonData {
  title: string
  description: string
  objectives: string[]
  sections: LessonSection[]
  activities?: string[]
  resources?: string[]
}

interface ExerciseData {
  title: string
  description: string
  instructions: string
  examples?: string[]
  solution?: string
  difficulty?: 'easy' | 'medium' | 'hard'
  hint?: string
}

interface PresentationSlide {
  order: number
  title: string
  content: string
}

interface PresentationData {
  title: string
  description: string
  slides: PresentationSlide[]
}

interface ContentEditorModalProps {
  content: QuizData | LessonData | ExerciseData | PresentationData
  type: 'quiz' | 'lesson' | 'exercise' | 'presentation'
  onSave: (edited: any) => void
  onCancel: () => void
}

export function ContentEditorModal({ content, type, onSave, onCancel }: ContentEditorModalProps) {
  // Normalize content to ensure all arrays exist
  const normalizeContent = (data: any, contentType: string) => {
    if (contentType === 'quiz') {
      return {
        ...data,
        questions: (data.questions || []).map((q: any) => ({
          ...q,
          options: Array.isArray(q.options) ? q.options : ['', '', '', ''],
          correctIndex: q.correctIndex ?? 0,
          points: q.points ?? 1
        }))
      }
    }
    if (contentType === 'lesson') {
      return {
        ...data,
        objectives: Array.isArray(data.objectives) ? data.objectives : [],
        sections: Array.isArray(data.sections) ? data.sections : [],
        activities: Array.isArray(data.activities) ? data.activities : [],
        resources: Array.isArray(data.resources) ? data.resources : []
      }
    }
    if (contentType === 'presentation') {
      return {
        ...data,
        slides: (data.slides || []).map((s: any, index: number) => ({
          order: s.order ?? index,
          title: s.title || '',
          content: s.content || ''
        }))
      }
    }
    return data
  }

  const [editedContent, setEditedContent] = useState(normalizeContent(content, type))
  const [viewMode, setViewMode] = useState<'form' | 'json'>('form')
  const [jsonError, setJsonError] = useState<string | null>(null)

  const handleSave = () => {
    // Validate before saving
    if (type === 'quiz') {
      const quiz = editedContent as QuizData
      if (!quiz.title || !quiz.description || quiz.questions.length === 0) {
        alert('Compila tutti i campi obbligatori')
        return
      }
    }
    onSave(editedContent)
  }

  const handleJsonChange = (newJson: string) => {
    try {
      const parsed = JSON.parse(newJson)
      setEditedContent(parsed)
      setJsonError(null)
    } catch (e: any) {
      setJsonError(e.message)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl max-h-[90vh] flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              Modifica {type === 'quiz' ? 'Quiz' : type === 'lesson' ? 'Lezione' : type === 'exercise' ? 'Esercizio' : 'Presentazione'}
            </h2>
            <p className="text-sm text-gray-500 mt-1">
              Puoi modificare i contenuti prima di pubblicarli
            </p>
          </div>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* View mode tabs */}
        <div className="flex gap-2 px-6 pt-4 border-b">
          <button
            onClick={() => setViewMode('form')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              viewMode === 'form'
                ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-700'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Modulo
          </button>
          <button
            onClick={() => setViewMode('json')}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors ${
              viewMode === 'json'
                ? 'bg-blue-50 text-blue-700 border-b-2 border-blue-700'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            JSON
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {viewMode === 'form' ? (
            <div>
              {type === 'quiz' && <QuizFormEditor content={editedContent as QuizData} onChange={setEditedContent} />}
              {type === 'lesson' && <LessonFormEditor content={editedContent as LessonData} onChange={setEditedContent} />}
              {type === 'exercise' && <ExerciseFormEditor content={editedContent as ExerciseData} onChange={setEditedContent} />}
              {type === 'presentation' && <PresentationFormEditor content={editedContent as PresentationData} onChange={setEditedContent} />}
            </div>
          ) : (
            <div>
              <textarea
                value={JSON.stringify(editedContent, null, 2)}
                onChange={(e) => handleJsonChange(e.target.value)}
                className="w-full h-96 font-mono text-sm p-4 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                spellCheck={false}
              />
              {jsonError && (
                <div className="mt-2 text-sm text-red-600">
                  Errore JSON: {jsonError}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50">
          <Button
            variant="outline"
            onClick={onCancel}
          >
            Annulla
          </Button>
          <Button
            onClick={handleSave}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            Salva modifiche
          </Button>
        </div>
      </div>
    </div>
  )
}

// Quiz Form Editor
function QuizFormEditor({ content, onChange }: { content: QuizData; onChange: (c: any) => void }) {
  const updateField = (field: keyof QuizData, value: any) => {
    onChange({ ...content, [field]: value })
  }

  const addQuestion = () => {
    onChange({
      ...content,
      questions: [
        ...content.questions,
        { question: '', options: ['', '', '', ''], correctIndex: 0, explanation: '', points: 1 }
      ]
    })
  }

  const updateQuestion = (index: number, field: keyof QuizQuestion, value: any) => {
    const newQuestions = [...content.questions]
    newQuestions[index] = { ...newQuestions[index], [field]: value }
    onChange({ ...content, questions: newQuestions })
  }

  const updateOption = (questionIndex: number, optionIndex: number, value: string) => {
    const newQuestions = [...content.questions]
    newQuestions[questionIndex].options[optionIndex] = value
    onChange({ ...content, questions: newQuestions })
  }

  const removeQuestion = (index: number) => {
    onChange({
      ...content,
      questions: content.questions.filter((_, i) => i !== index)
    })
  }

  return (
    <div className="space-y-6">
      {/* Basic info */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Titolo Quiz *
        </label>
        <input
          type="text"
          value={content.title}
          onChange={(e) => updateField('title', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder="Es: Quiz sulle Equazioni di Secondo Grado"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Descrizione *
        </label>
        <textarea
          value={content.description}
          onChange={(e) => updateField('description', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          rows={2}
          placeholder="Breve descrizione del quiz"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Tempo limite (minuti)
          </label>
          <input
            type="number"
            value={content.time_limit_minutes || ''}
            onChange={(e) => updateField('time_limit_minutes', parseInt(e.target.value) || undefined)}
            className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            placeholder="Es: 30"
            min="1"
          />
        </div>
      </div>

      {/* Questions */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Domande ({content.questions.length})</h3>
          <Button
            size="sm"
            onClick={addQuestion}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4 mr-1" />
            Aggiungi domanda
          </Button>
        </div>

        <div className="space-y-6">
          {content.questions.map((q, qIndex) => (
            <div key={qIndex} className="border rounded-lg p-4 bg-gray-50">
              <div className="flex items-start justify-between mb-3">
                <h4 className="font-medium text-gray-900">Domanda {qIndex + 1}</h4>
                <button
                  onClick={() => removeQuestion(qIndex)}
                  className="text-red-600 hover:text-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Testo domanda *
                  </label>
                  <input
                    type="text"
                    value={q.question}
                    onChange={(e) => updateQuestion(qIndex, 'question', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg bg-white"
                    placeholder="Scrivi la domanda..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Opzioni di risposta *
                  </label>
                  <div className="space-y-2">
                    {q.options.map((opt, optIndex) => (
                      <div key={optIndex} className="flex items-center gap-2">
                        <input
                          type="radio"
                          checked={q.correctIndex === optIndex}
                          onChange={() => updateQuestion(qIndex, 'correctIndex', optIndex)}
                          className="h-4 w-4 text-green-600"
                        />
                        <input
                          type="text"
                          value={opt}
                          onChange={(e) => updateOption(qIndex, optIndex, e.target.value)}
                          className="flex-1 px-3 py-2 border rounded-lg bg-white"
                          placeholder={`Opzione ${optIndex + 1}`}
                        />
                        {q.correctIndex === optIndex && (
                          <span className="text-xs text-green-600 font-medium">✓ Corretta</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Spiegazione
                  </label>
                  <textarea
                    value={q.explanation || ''}
                    onChange={(e) => updateQuestion(qIndex, 'explanation', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg bg-white"
                    rows={2}
                    placeholder="Spiega perché questa è la risposta corretta..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Punti
                  </label>
                  <input
                    type="number"
                    value={q.points || 1}
                    onChange={(e) => updateQuestion(qIndex, 'points', parseInt(e.target.value) || 1)}
                    className="w-20 px-3 py-2 border rounded-lg bg-white"
                    min="0"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Lesson Form Editor
function LessonFormEditor({ content, onChange }: { content: LessonData; onChange: (c: any) => void }) {
  const updateField = (field: keyof LessonData, value: any) => {
    onChange({ ...content, [field]: value })
  }

  const addSection = () => {
    onChange({
      ...content,
      sections: [...content.sections, { title: '', content: '', duration_minutes: undefined }]
    })
  }

  const updateSection = (index: number, field: keyof LessonSection, value: any) => {
    const newSections = [...content.sections]
    newSections[index] = { ...newSections[index], [field]: value }
    onChange({ ...content, sections: newSections })
  }

  const removeSection = (index: number) => {
    onChange({
      ...content,
      sections: content.sections.filter((_, i) => i !== index)
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Titolo Lezione *</label>
        <input
          type="text"
          value={content.title}
          onChange={(e) => updateField('title', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Descrizione *</label>
        <textarea
          value={content.description}
          onChange={(e) => updateField('description', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg"
          rows={3}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Obiettivi *</label>
        <textarea
          value={content.objectives.join('\n')}
          onChange={(e) => updateField('objectives', e.target.value.split('\n').filter(Boolean))}
          className="w-full px-3 py-2 border rounded-lg font-mono text-sm"
          rows={4}
          placeholder="Un obiettivo per riga..."
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Sezioni ({content.sections.length})</h3>
          <Button size="sm" onClick={addSection} className="bg-emerald-600 hover:bg-emerald-700">
            <Plus className="h-4 w-4 mr-1" />
            Aggiungi sezione
          </Button>
        </div>

        <div className="space-y-4">
          {content.sections.map((section, index) => (
            <div key={index} className="border rounded-lg p-4 bg-gray-50">
              <div className="flex items-start justify-between mb-3">
                <h4 className="font-medium">Sezione {index + 1}</h4>
                <button onClick={() => removeSection(index)} className="text-red-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-3">
                <input
                  type="text"
                  value={section.title}
                  onChange={(e) => updateSection(index, 'title', e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white"
                  placeholder="Titolo sezione"
                />
                <textarea
                  value={section.content}
                  onChange={(e) => updateSection(index, 'content', e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg bg-white"
                  rows={4}
                  placeholder="Contenuto della sezione..."
                />
                <input
                  type="number"
                  value={section.duration_minutes || ''}
                  onChange={(e) => updateSection(index, 'duration_minutes', parseInt(e.target.value) || undefined)}
                  className="w-32 px-3 py-2 border rounded-lg bg-white"
                  placeholder="Durata (min)"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// Exercise Form Editor
function ExerciseFormEditor({ content, onChange }: { content: ExerciseData; onChange: (c: any) => void }) {
  const updateField = (field: keyof ExerciseData, value: any) => {
    onChange({ ...content, [field]: value })
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Titolo *</label>
        <input
          type="text"
          value={content.title}
          onChange={(e) => updateField('title', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Descrizione *</label>
        <textarea
          value={content.description}
          onChange={(e) => updateField('description', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg"
          rows={2}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Istruzioni *</label>
        <textarea
          value={content.instructions}
          onChange={(e) => updateField('instructions', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg"
          rows={4}
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Difficoltà</label>
        <select
          value={content.difficulty || 'medium'}
          onChange={(e) => updateField('difficulty', e.target.value)}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="easy">Facile</option>
          <option value="medium">Media</option>
          <option value="hard">Difficile</option>
        </select>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Suggerimento</label>
        <input
          type="text"
          value={content.hint || ''}
          onChange={(e) => updateField('hint', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg"
        />
      </div>
    </div>
  )
}

// Presentation Form Editor
function PresentationFormEditor({ content, onChange }: { content: PresentationData; onChange: (c: any) => void }) {
  const updateField = (field: keyof PresentationData, value: any) => {
    onChange({ ...content, [field]: value })
  }

  const addSlide = () => {
    onChange({
      ...content,
      slides: [...content.slides, { order: content.slides.length, title: '', content: '' }]
    })
  }

  const updateSlide = (index: number, field: keyof PresentationSlide, value: any) => {
    const newSlides = [...content.slides]
    newSlides[index] = { ...newSlides[index], [field]: value }
    onChange({ ...content, slides: newSlides })
  }

  const removeSlide = (index: number) => {
    const newSlides = content.slides.filter((_, i) => i !== index)
    // Reorder remaining slides
    const reorderedSlides = newSlides.map((slide, idx) => ({ ...slide, order: idx }))
    onChange({ ...content, slides: reorderedSlides })
  }

  const moveSlide = (index: number, direction: 'up' | 'down') => {
    if ((direction === 'up' && index === 0) || (direction === 'down' && index === content.slides.length - 1)) {
      return
    }

    const newSlides = [...content.slides]
    const targetIndex = direction === 'up' ? index - 1 : index + 1
    const temp = newSlides[index]
    newSlides[index] = newSlides[targetIndex]
    newSlides[targetIndex] = temp

    // Update order numbers
    const reorderedSlides = newSlides.map((slide, idx) => ({ ...slide, order: idx }))
    onChange({ ...content, slides: reorderedSlides })
  }

  return (
    <div className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Titolo Presentazione *</label>
        <input
          type="text"
          value={content.title}
          onChange={(e) => updateField('title', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          placeholder="Es: Introduzione alle Equazioni"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Descrizione *</label>
        <textarea
          value={content.description}
          onChange={(e) => updateField('description', e.target.value)}
          className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          rows={2}
          placeholder="Breve descrizione della presentazione"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">Slide ({content.slides.length})</h3>
          <Button
            size="sm"
            onClick={addSlide}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            <Plus className="h-4 w-4 mr-1" />
            Aggiungi slide
          </Button>
        </div>

        <div className="space-y-4">
          {content.slides.map((slide, index) => (
            <div key={index} className="border rounded-lg p-4 bg-gradient-to-br from-indigo-50 to-purple-50">
              <div className="flex items-start justify-between mb-3">
                <h4 className="font-medium text-gray-900">Slide {index + 1}</h4>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => moveSlide(index, 'up')}
                    disabled={index === 0}
                    className="text-gray-600 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Sposta su"
                  >
                    ↑
                  </button>
                  <button
                    onClick={() => moveSlide(index, 'down')}
                    disabled={index === content.slides.length - 1}
                    className="text-gray-600 hover:text-gray-900 disabled:opacity-30 disabled:cursor-not-allowed"
                    title="Sposta giù"
                  >
                    ↓
                  </button>
                  <button
                    onClick={() => removeSlide(index)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Titolo slide *</label>
                  <input
                    type="text"
                    value={slide.title}
                    onChange={(e) => updateSlide(index, 'title', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    placeholder="Titolo della slide..."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Contenuto *
                    <span className="text-xs text-gray-500 ml-2">(supporta Markdown)</span>
                  </label>
                  <textarea
                    value={slide.content}
                    onChange={(e) => updateSlide(index, 'content', e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg bg-white font-mono text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    rows={6}
                    placeholder="Contenuto della slide (puoi usare Markdown per formattazione)..."
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
