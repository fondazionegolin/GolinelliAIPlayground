import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Save, Loader2, Globe, Check, X } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { Switch } from '@/components/ui/switch'
import { teacherbotsApi, teacherApi } from '@/lib/api'
import { TeacherbotPromptOptimizer } from './TeacherbotPromptOptimizer'

interface TeacherbotFormProps {
  teacherbotId?: string
  onBack: () => void
  onSaved: () => void
}

interface FormData {
  name: string
  synopsis: string
  // description removed
  icon: string
  color: string
  system_prompt: string
  is_proactive: boolean
  proactive_message: string
  enable_reporting: boolean
  report_prompt: string
  llm_provider: string
  llm_model: string
  temperature: number
}

const COLORS = ['indigo', 'blue', 'green', 'purple', 'pink', 'orange', 'teal', 'cyan', 'red']

export default function TeacherbotForm({ teacherbotId, onBack, onSaved }: TeacherbotFormProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const isEditing = !!teacherbotId

  const [formData, setFormData] = useState<FormData>({
    name: '',
    synopsis: '',
    icon: 'bot',
    color: 'indigo',
    system_prompt: '',
    is_proactive: false,
    proactive_message: '',
    enable_reporting: false,
    report_prompt: '',
    llm_provider: '',
    llm_model: '',
    temperature: 0.7,
  })

  // Selection state for AI Optimizer
  const [selection, setSelection] = useState<{ text: string, position: { x: number, y: number } } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const [showPublishModal, setShowPublishModal] = useState(false)
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null)

  // Load existing teacherbot data
  const { data: teacherbot, isLoading: isLoadingBot } = useQuery({
    queryKey: ['teacherbot', teacherbotId],
    queryFn: async () => {
      if (!teacherbotId) return null
      const res = await teacherbotsApi.get(teacherbotId)
      return res.data
    },
    enabled: !!teacherbotId,
  })

  // Load classes for publishing
  const { data: classes } = useQuery({
    queryKey: ['teacher-classes'],
    queryFn: async () => {
      const res = await teacherApi.getClasses()
      return res.data || []
    },
  })

  // Load publications for this teacherbot
  const { data: publications } = useQuery({
    queryKey: ['teacherbot-publications', teacherbotId],
    queryFn: async () => {
      if (!teacherbotId) return []
      const res = await teacherbotsApi.getPublications(teacherbotId)
      return res.data || []
    },
    enabled: !!teacherbotId,
  })

  useEffect(() => {
    if (teacherbot) {
      setFormData({
        name: teacherbot.name || '',
        synopsis: teacherbot.synopsis || '',
        icon: teacherbot.icon || 'bot',
        color: teacherbot.color || 'indigo',
        system_prompt: teacherbot.system_prompt || '',
        is_proactive: teacherbot.is_proactive || false,
        proactive_message: teacherbot.proactive_message || '',
        enable_reporting: teacherbot.enable_reporting || false,
        report_prompt: teacherbot.report_prompt || '',
        llm_provider: teacherbot.llm_provider || '',
        llm_model: teacherbot.llm_model || '',
        temperature: teacherbot.temperature ?? 0.7,
      })
    }
  }, [teacherbot])

  const saveMutation = useMutation({
    mutationFn: async (data: FormData) => {
      // Map back to API expected format (including description as optional/empty)
      // We send empty description as requested
      const apiData = { ...data, description: '' }
      if (isEditing) {
        return teacherbotsApi.update(teacherbotId, apiData)
      } else {
        return teacherbotsApi.create(apiData)
      }
    },
    onSuccess: () => {
      toast({ title: isEditing ? 'Teacherbot aggiornato' : 'Teacherbot creato' })
      queryClient.invalidateQueries({ queryKey: ['teacherbots'] })
      onSaved()
    },
    onError: () => {
      toast({ title: 'Errore', description: 'Impossibile salvare il teacherbot', variant: 'destructive' })
    },
  })

  const publishMutation = useMutation({
    mutationFn: async (classId: string) => {
      return teacherbotsApi.publish(teacherbotId!, classId)
    },
    onSuccess: () => {
      toast({ title: 'Teacherbot pubblicato', description: 'Gli studenti possono ora interagire con questo assistente' })
      queryClient.invalidateQueries({ queryKey: ['teacherbot-publications', teacherbotId] })
      setShowPublishModal(false)
      setSelectedClassId(null)
    },
    onError: (error: any) => {
      const msg = error.response?.data?.detail || 'Impossibile pubblicare il teacherbot'
      toast({ title: 'Errore', description: msg, variant: 'destructive' })
    },
  })

  const unpublishMutation = useMutation({
    mutationFn: async (publicationId: string) => {
      return teacherbotsApi.unpublish(teacherbotId!, publicationId)
    },
    onSuccess: () => {
      toast({ title: 'Pubblicazione rimossa' })
      queryClient.invalidateQueries({ queryKey: ['teacherbot-publications', teacherbotId] })
    },
    onError: () => {
      toast({ title: 'Errore', description: 'Impossibile rimuovere la pubblicazione', variant: 'destructive' })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim() || !formData.system_prompt.trim()) {
      toast({ title: 'Errore', description: 'Nome e System Prompt sono obbligatori', variant: 'destructive' })
      return
    }
    saveMutation.mutate(formData)
  }

  const handlePublish = () => {
    if (selectedClassId) {
      publishMutation.mutate(selectedClassId)
    }
  }

  const handleMouseUpWithEvent = useCallback((e: React.MouseEvent<HTMLTextAreaElement>) => {
    const textarea = e.currentTarget
    const start = textarea.selectionStart
    const end = textarea.selectionEnd

    if (start !== end) {
      const selectedText = textarea.value.substring(start, end)
      // Trigger only for meaningful selections
      if (selectedText.trim().length > 5) {
        setSelection({
          text: selectedText,
          // Position relative to viewport
          position: { x: e.clientX, y: e.clientY + 20 }
        })
        return
      }
    }
    setSelection(null)
  }, [])

  const handleApplyOptimization = (newText: string) => {
    // Replace the selection with the optimized text
    // actually, system prompt optimizer typically rewrites the whole thing or a large section.
    // If the selection is the whole text, we replace all.
    // If selection is partial, we replace just the selection?
    // Usually "Expand System Prompt" implies replacing the draft with the polished version.

    if (!textareaRef.current || !selection) return

    const textarea = textareaRef.current
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const currentVal = textarea.value

    const newVal = currentVal.substring(0, start) + newText + currentVal.substring(end)

    setFormData({ ...formData, system_prompt: newVal })
    setSelection(null)
  }

  const getColorClass = (color: string, isSelected: boolean) => {
    const baseColors: Record<string, string> = {
      indigo: 'bg-indigo-500',
      blue: 'bg-blue-500',
      green: 'bg-green-500',
      purple: 'bg-purple-500',
      pink: 'bg-pink-500',
      orange: 'bg-orange-500',
      teal: 'bg-teal-500',
      cyan: 'bg-cyan-500',
      red: 'bg-red-500',
    }
    const base = baseColors[color] || 'bg-indigo-500'
    return isSelected ? `${base} ring-2 ring-offset-2 ring-${color}-500` : base
  }

  // Get published class IDs
  const publishedClassIds = new Set((publications || []).filter((p: any) => p.is_active).map((p: any) => p.class_id))

  if (isLoadingBot && isEditing) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    )
  }

  return (
    <div className="h-full min-h-[600px] flex flex-col">
      <div className="flex items-center gap-4 mb-4 flex-shrink-0">
        <Button variant="ghost" onClick={onBack} className="text-slate-600">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Indietro
        </Button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-slate-800">
            {isEditing ? 'Modifica Teacherbot' : 'Nuovo Teacherbot'}
          </h2>
        </div>
        {isEditing && (
          <Button
            variant="outline"
            onClick={() => setShowPublishModal(true)}
            className="text-indigo-600 border-indigo-200 hover:bg-indigo-50"
          >
            <Globe className="h-4 w-4 mr-2" />
            Pubblica
          </Button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Basic Info */}
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-800 mb-4">Informazioni Base</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Nome <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="es. Tutor di Matematica"
                    maxLength={100}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Sinossi (breve descrizione)
                  </label>
                  <input
                    type="text"
                    value={formData.synopsis}
                    onChange={(e) => setFormData({ ...formData, synopsis: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                    placeholder="es. Un assistente per esercizi di algebra"
                    maxLength={255}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Colore</label>
                  <div className="flex gap-2 flex-wrap">
                    {COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        onClick={() => setFormData({ ...formData, color })}
                        className={`w-8 h-8 rounded-lg transition-all ${getColorClass(color, formData.color === color)}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Options */}
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="font-semibold text-slate-800 mb-4">Opzioni</h3>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="font-medium text-slate-700">Proattivo</label>
                    <p className="text-sm text-slate-500">Il bot si presenta e inizia con una domanda</p>
                  </div>
                  <Switch
                    checked={formData.is_proactive}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_proactive: checked })}
                  />
                </div>

                {formData.is_proactive && (
                  <div className="ml-1 pl-4 border-l-2 border-indigo-100 animate-in slide-in-from-top-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Messaggio iniziale
                    </label>
                    <textarea
                      value={formData.proactive_message}
                      onChange={(e) => setFormData({ ...formData, proactive_message: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                      placeholder="es. Ciao! Sono qui per aiutarti con la matematica. Su quale argomento vorresti lavorare oggi?"
                      rows={2}
                    />
                  </div>
                )}

                <div className="pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="font-medium text-slate-700">Reporting</label>
                      <p className="text-sm text-slate-500">Genera report automatici delle conversazioni</p>
                    </div>
                    <Switch
                      checked={formData.enable_reporting}
                      onCheckedChange={(checked) => setFormData({ ...formData, enable_reporting: checked })}
                    />
                  </div>
                </div>

                {formData.enable_reporting && (
                  <div className="ml-1 pl-4 border-l-2 border-indigo-100 animate-in slide-in-from-top-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Prompt per il report (opzionale)
                    </label>
                    <textarea
                      value={formData.report_prompt}
                      onChange={(e) => setFormData({ ...formData, report_prompt: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                      placeholder="Lascia vuoto per usare il prompt predefinito"
                      rows={3}
                    />
                  </div>
                )}

                <div className="pt-4 border-t border-slate-100">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Temperatura: {formData.temperature.toFixed(1)}
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={formData.temperature}
                    onChange={(e) => setFormData({ ...formData, temperature: parseFloat(e.target.value) })}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-slate-400 mt-1">
                    <span>Preciso</span>
                    <span>Creativo</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - System Prompt */}
          <div className="bg-white rounded-xl border border-slate-200 p-5 flex flex-col relative h-[520px] lg:h-[640px]">
            <h3 className="font-semibold text-slate-800 mb-2">
              System Prompt <span className="text-red-500">*</span>
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              Definisci la personalità e il comportamento del tuo assistente.
              <br />
              <span className="text-indigo-600 text-xs italic">
                💡 Suggerimento: Seleziona del testo per attivare l'ottimizzatore AI.
              </span>
            </p>

            <textarea
              ref={textareaRef}
              value={formData.system_prompt}
              onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
              onMouseUp={handleMouseUpWithEvent}
              className="flex-1 w-full px-4 py-3 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-sm resize-none"
              placeholder={`Esempio:
Sei un tutor esperto di matematica per studenti delle scuole superiori.

Il tuo obiettivo è:
- Aiutare gli studenti a comprendere i concetti matematici
- Fornire spiegazioni chiare e step-by-step
- Proporre esercizi di difficoltà crescente`}
            />

            {selection && (
              <TeacherbotPromptOptimizer
                selectedText={selection.text}
                teacherbotName={formData.name}
                teacherbotSynopsis={formData.synopsis}
                position={selection.position}
                onClose={() => setSelection(null)}
                onApply={handleApplyOptimization}
              />
            )}
          </div>
        </div>
        </div>

        {/* Save Button */}
        <div className="mt-4 pt-4 pb-4 flex justify-end gap-3 border-t border-slate-200 bg-white/95 backdrop-blur-sm sticky bottom-0">
          <Button type="button" variant="outline" onClick={onBack}>
            Annulla
          </Button>
          <Button
            type="submit"
            disabled={saveMutation.isPending}
            className="bg-indigo-600 hover:bg-indigo-700"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {isEditing ? 'Salva modifiche' : 'Crea Teacherbot'}
          </Button>
        </div>
      </form>

      {/* Publish Modal includes are kept same as before */}
      {showPublishModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800">Pubblica Teacherbot</h3>
              <Button variant="ghost" size="icon" onClick={() => setShowPublishModal(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            <p className="text-sm text-slate-600 mb-4">
              Seleziona la classe in cui pubblicare questo assistente. Gli studenti potranno interagire con il bot durante le sessioni.
            </p>

            {/* Current publications */}
            {publications && publications.filter((p: any) => p.is_active).length > 0 && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">Pubblicato su:</label>
                <div className="space-y-2">
                  {publications.filter((p: any) => p.is_active).map((pub: any) => (
                    <div key={pub.id} className="flex items-center justify-between p-2 bg-green-50 rounded-lg border border-green-200">
                      <span className="text-sm text-green-700 flex items-center gap-2">
                        <Check className="h-4 w-4" />
                        {pub.class_name}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:bg-red-50"
                        onClick={() => unpublishMutation.mutate(pub.id)}
                      >
                        Rimuovi
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Available classes */}
            <div className="space-y-2 max-h-60 overflow-y-auto mb-4">
              {classes?.filter((c: any) => !publishedClassIds.has(c.id)).map((cls: any) => (
                <button
                  key={cls.id}
                  type="button"
                  onClick={() => setSelectedClassId(cls.id)}
                  className={`w-full text-left p-3 rounded-lg border transition-all ${selectedClassId === cls.id
                    ? 'border-indigo-400 bg-indigo-50'
                    : 'border-slate-200 hover:border-indigo-200 hover:bg-slate-50'
                    }`}
                >
                  <div className="font-medium text-slate-800">{cls.name}</div>
                  <div className="text-xs text-slate-500">
                    {cls.role === 'owner' ? 'Proprietario' : `Condivisa da ${cls.owner_name}`}
                  </div>
                </button>
              ))}
              {classes?.filter((c: any) => !publishedClassIds.has(c.id)).length === 0 && (
                <p className="text-center text-sm text-slate-400 py-4">
                  Tutte le classi sono già state pubblicate
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowPublishModal(false)}>
                Chiudi
              </Button>
              <Button
                onClick={handlePublish}
                disabled={!selectedClassId || publishMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {publishMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Globe className="h-4 w-4 mr-2" />
                )}
                Pubblica
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
