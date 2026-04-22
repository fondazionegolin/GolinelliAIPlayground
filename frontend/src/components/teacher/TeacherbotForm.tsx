import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Save, Loader2, Globe, Check, X, Upload, Trash2, FileText, Database, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Sparkles, Layers } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { teacherbotsApi, teacherApi } from '@/lib/api'
import { TeacherbotPromptOptimizer } from './TeacherbotPromptOptimizer'
import { useTranslation } from 'react-i18next'

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

const DOC_TYPE_ICON: Record<string, React.ReactNode> = {
  pdf: <FileText className="h-4 w-4 text-red-500" />,
  xlsx: <Database className="h-4 w-4 text-emerald-500" />,
  xls: <Database className="h-4 w-4 text-emerald-500" />,
  csv: <Database className="h-4 w-4 text-emerald-500" />,
  docx: <FileText className="h-4 w-4 text-blue-500" />,
  doc: <FileText className="h-4 w-4 text-blue-500" />,
  txt: <FileText className="h-4 w-4 text-slate-400" />,
}

interface KnowledgeBaseSectionProps {
  teacherbotId?: string
  pendingFiles?: File[]
  onPendingFilesChange?: (files: File[]) => void
}

const EMBED_STEPS = [
  { label: 'Estrazione testo dal documento…' },
  { label: 'Analisi struttura e contenuto…' },
  { label: 'Divisione in blocchi semantici…' },
  { label: 'Generazione embedding vettoriali…' },
  { label: 'Indicizzazione nella knowledge base…' },
]

function KnowledgeBaseSection({ teacherbotId, pendingFiles, onPendingFilesChange }: KnowledgeBaseSectionProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const kbInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [embedStep, setEmbedStep] = useState(0)
  const [embedResult, setEmbedResult] = useState<{ filename: string; chunk_count: number } | null>(null)
  const [explainerOpen, setExplainerOpen] = useState(false)

  // Only fetch from API when we have a saved teacherbot
  const { data: docs, isLoading } = useQuery({
    queryKey: ['teacherbot-kb', teacherbotId],
    queryFn: async () => {
      const res = await teacherbotsApi.listKbDocuments(teacherbotId!)
      return (res.data || []) as Array<{ id: string; title: string; doc_type: string; status: string; created_at: string }>
    },
    enabled: !!teacherbotId,
  })

  const deleteMutation = useMutation({
    mutationFn: (docId: string) => teacherbotsApi.deleteKbDocument(teacherbotId!, docId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacherbot-kb', teacherbotId] })
      toast({ title: 'Documento rimosso dalla knowledge base' })
    },
  })

  const handleFileInput = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const fileArray = Array.from(files)
    if (kbInputRef.current) kbInputRef.current.value = ''

    if (!teacherbotId) {
      onPendingFilesChange?.([...(pendingFiles || []), ...fileArray])
      return
    }

    // Edit mode: upload with animated progress
    setUploading(true)
    setEmbedStep(0)
    setEmbedResult(null)

    const stepTimings = [300, 700, 1100, 1500, 1900]
    stepTimings.forEach((delay, i) => {
      setTimeout(() => setEmbedStep(i + 1), delay)
    })

    let lastChunkCount = 0
    for (const file of fileArray) {
      try {
        const res = await teacherbotsApi.uploadKbDocument(teacherbotId, file)
        lastChunkCount = res.data?.chunk_count || 0
        setEmbedResult({ filename: file.name, chunk_count: lastChunkCount })
      } catch (e: any) {
        toast({
          title: 'Errore caricamento',
          description: e.response?.data?.detail || file.name,
          variant: 'destructive',
        })
      }
    }
    setUploading(false)
    queryClient.invalidateQueries({ queryKey: ['teacherbot-kb', teacherbotId] })
  }

  const removePending = (idx: number) => {
    if (!pendingFiles) return
    onPendingFilesChange?.(pendingFiles.filter((_, i) => i !== idx))
  }

  const statusColor = (s: string) => ({
    ready: 'text-emerald-600 bg-emerald-50',
    processing: 'text-amber-600 bg-amber-50',
    queued: 'text-sky-600 bg-sky-50',
    failed: 'text-red-600 bg-red-50',
  }[s] || 'text-slate-500 bg-slate-100')

  const statusLabel = (s: string) => ({
    ready: 'Pronto',
    processing: 'Elaborazione…',
    queued: 'In coda',
    failed: 'Errore',
  }[s] || s)

  const getExt = (filename: string) => filename.split('.').pop()?.toLowerCase() || ''

  return (
    <div className="mt-6 bg-white rounded-2xl border border-slate-200 p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Database className="h-4 w-4 text-indigo-600" />
            Knowledge Base RAG
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {teacherbotId
              ? 'Carica documenti — il bot userà queste fonti per rispondere con citazioni accurate'
              : 'Aggiungi documenti ora — verranno caricati automaticamente al salvataggio'}
          </p>
        </div>
        <div>
          <input
            ref={kbInputRef}
            type="file"
            className="hidden"
            multiple
            accept=".pdf,.doc,.docx,.txt,.csv,.xlsx,.xls,.md"
            onChange={(e) => handleFileInput(e.target.files)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={uploading}
            onClick={() => kbInputRef.current?.click()}
            className="border-indigo-200 text-indigo-700 hover:bg-indigo-50"
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
            {uploading ? 'Elaborazione…' : 'Aggiungi documento'}
          </Button>
        </div>
      </div>

      {/* Embedding progress animation */}
      {uploading && (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
          <p className="text-xs font-semibold text-indigo-700 mb-3 flex items-center gap-2">
            <Layers className="h-3.5 w-3.5" />
            Pipeline di indicizzazione in corso…
          </p>
          <div className="space-y-2">
            {EMBED_STEPS.map((step, i) => (
              <div key={i} className="flex items-center gap-3">
                {i < embedStep ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                ) : i === embedStep ? (
                  <Loader2 className="h-4 w-4 text-indigo-500 animate-spin shrink-0" />
                ) : (
                  <div className="h-4 w-4 rounded-full border-2 border-slate-300 shrink-0" />
                )}
                <span className={`text-xs ${i <= embedStep ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 h-1.5 bg-indigo-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-600 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, (embedStep / EMBED_STEPS.length) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Embedding result + explainability */}
      {embedResult && !uploading && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 space-y-3">
          <div className="flex items-center gap-2 text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            <span className="text-sm font-semibold">Indicizzazione completata: {embedResult.filename}</span>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-white rounded-xl p-3 border border-emerald-100">
              <p className="text-2xl font-bold text-indigo-600">{embedResult.chunk_count}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">blocchi semantici</p>
            </div>
            <div className="bg-white rounded-xl p-3 border border-emerald-100">
              <p className="text-2xl font-bold text-indigo-600">{embedResult.chunk_count}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">vettori embedding</p>
            </div>
            <div className="bg-white rounded-xl p-3 border border-emerald-100">
              <p className="text-2xl font-bold text-indigo-600">1536</p>
              <p className="text-[11px] text-slate-500 mt-0.5">dimensioni/vettore</p>
            </div>
          </div>
          <p className="text-xs text-emerald-700">
            Il bot utilizzerà questi {embedResult.chunk_count} blocchi come contesto per rispondere con precisione alle domande degli studenti.
          </p>
        </div>
      )}

      {/* Pending files (creation mode) */}
      {!teacherbotId && pendingFiles && pendingFiles.length > 0 && (
        <div className="space-y-2">
          {pendingFiles.map((file, idx) => (
            <div key={idx} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-indigo-50 border border-indigo-100">
              {DOC_TYPE_ICON[getExt(file.name)] || <FileText className="h-4 w-4 text-slate-400" />}
              <span className="flex-1 text-sm text-slate-700 truncate">{file.name}</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium text-indigo-600 bg-indigo-100">In attesa</span>
              <button type="button" onClick={() => removePending(idx)} className="text-slate-300 hover:text-red-500 transition-colors flex-shrink-0">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Empty state (creation mode) */}
      {!teacherbotId && (!pendingFiles || pendingFiles.length === 0) && (
        <div className="flex flex-col items-center justify-center py-8 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">
          <Database className="h-8 w-8 mb-2 opacity-30" />
          <p>Nessun documento aggiunto</p>
          <p className="text-xs mt-1">Opzionale — puoi aggiungerne anche dopo il salvataggio</p>
        </div>
      )}

      {/* Saved bot: loading */}
      {teacherbotId && isLoading && (
        <div className="flex items-center justify-center py-6 text-slate-400 text-sm">
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />Caricamento…
        </div>
      )}

      {/* Saved bot: empty */}
      {teacherbotId && !isLoading && (!docs || docs.length === 0) && (
        <div className="flex flex-col items-center justify-center py-8 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-xl">
          <Database className="h-8 w-8 mb-2 opacity-30" />
          <p>Nessun documento nella knowledge base</p>
          <p className="text-xs mt-1">I documenti caricati guidano le risposte del bot con recupero contestuale</p>
        </div>
      )}

      {/* Saved bot: document list */}
      {teacherbotId && !isLoading && docs && docs.length > 0 && (
        <div className="space-y-2">
          {docs.map((doc) => (
            <div key={doc.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100">
              {DOC_TYPE_ICON[doc.doc_type] || <FileText className="h-4 w-4 text-slate-400" />}
              <span className="flex-1 text-sm text-slate-700 truncate">{doc.title}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(doc.status)}`}>
                {statusLabel(doc.status)}
              </span>
              {doc.status === 'failed' && <AlertCircle className="h-4 w-4 text-red-400 flex-shrink-0" />}
              <button
                type="button"
                onClick={() => deleteMutation.mutate(doc.id)}
                disabled={deleteMutation.isPending}
                className="text-slate-300 hover:text-red-500 transition-colors flex-shrink-0"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Explainability accordion */}
      <div className="rounded-xl border border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setExplainerOpen(!explainerOpen)}
          className="flex w-full items-center gap-2 px-4 py-2.5 text-left bg-slate-50 hover:bg-slate-100 transition-colors"
        >
          <Sparkles className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
          <span className="text-xs font-semibold text-slate-600 flex-1">Come funziona la Knowledge Base RAG?</span>
          {explainerOpen ? <ChevronUp className="h-3.5 w-3.5 text-slate-400" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-400" />}
        </button>
        {explainerOpen && (
          <div className="px-4 py-3 bg-white space-y-3 text-xs text-slate-600">
            <div className="flex gap-3 items-start">
              <div className="h-6 w-6 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center shrink-0 text-[11px]">1</div>
              <div>
                <strong>Chunking semantico:</strong> il documento viene diviso in blocchi di ~1000 caratteri rispettando le frasi complete. Ogni blocco è un'unità di conoscenza autonoma.
              </div>
            </div>
            <div className="flex gap-3 items-start">
              <div className="h-6 w-6 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center shrink-0 text-[11px]">2</div>
              <div>
                <strong>Embedding vettoriale:</strong> ogni blocco viene trasformato in un vettore di 1536 numeri tramite il modello <code className="bg-slate-100 px-1 rounded">text-embedding-3-small</code>. Il vettore codifica il <em>significato</em> del testo, non solo le parole.
              </div>
            </div>
            <div className="flex gap-3 items-start">
              <div className="h-6 w-6 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center shrink-0 text-[11px]">3</div>
              <div>
                <strong>Ricerca per coseno:</strong> quando uno studente fa una domanda, anche essa viene trasformata in vettore e vengono trovati i blocchi più simili usando la <em>distanza del coseno</em> tra vettori (pgvector).
              </div>
            </div>
            <div className="flex gap-3 items-start">
              <div className="h-6 w-6 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center shrink-0 text-[11px]">4</div>
              <div>
                <strong>Generazione aumentata:</strong> i top-5 blocchi vengono passati all'LLM come contesto. Il modello risponde <em>solo</em> basandosi su queste fonti, riducendo drasticamente le allucinazioni.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default function TeacherbotForm({ teacherbotId, onBack, onSaved }: TeacherbotFormProps) {
  const { toast } = useToast()
  const { t } = useTranslation()
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

  const [pendingKbFiles, setPendingKbFiles] = useState<File[]>([])

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
    onSuccess: async (res) => {
      const savedId: string | undefined = res?.data?.id || teacherbotId
      if (!isEditing && pendingKbFiles.length > 0 && savedId) {
        for (const file of pendingKbFiles) {
          try { await teacherbotsApi.uploadKbDocument(savedId, file) } catch {}
        }
        setPendingKbFiles([])
      }
      toast({ title: isEditing ? t('teacherbot.updated') : t('teacherbot.created') })
      queryClient.invalidateQueries({ queryKey: ['teacherbots'] })
      onSaved()
    },
    onError: () => {
      toast({ title: t('common.error'), description: t('teacherbot.save_error'), variant: 'destructive' })
    },
  })

  const publishMutation = useMutation({
    mutationFn: async (classId: string) => {
      return teacherbotsApi.publish(teacherbotId!, classId)
    },
    onSuccess: () => {
      toast({ title: t('teacherbot.published'), description: t('teacherbot.published_body') })
      queryClient.invalidateQueries({ queryKey: ['teacherbot-publications', teacherbotId] })
      setShowPublishModal(false)
      setSelectedClassId(null)
    },
    onError: (error: any) => {
      const msg = error.response?.data?.detail || t('teacherbot.publish_error')
      toast({ title: t('common.error'), description: msg, variant: 'destructive' })
    },
  })

  const unpublishMutation = useMutation({
    mutationFn: async (publicationId: string) => {
      return teacherbotsApi.unpublish(teacherbotId!, publicationId)
    },
    onSuccess: () => {
      toast({ title: t('teacherbot.unpublished') })
      queryClient.invalidateQueries({ queryKey: ['teacherbot-publications', teacherbotId] })
    },
    onError: () => {
      toast({ title: t('common.error'), description: t('teacherbot.unpublish_error'), variant: 'destructive' })
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name.trim() || !formData.system_prompt.trim()) {
      toast({ title: t('common.error'), description: t('teacherbot.name_required'), variant: 'destructive' })
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
      indigo: 'bg-[#181b1e]',
      blue: 'bg-blue-500',
      green: 'bg-green-500',
      purple: 'bg-purple-500',
      pink: 'bg-pink-500',
      orange: 'bg-orange-500',
      teal: 'bg-teal-500',
      cyan: 'bg-cyan-500',
      red: 'bg-red-500',
    }
    const base = baseColors[color] || 'bg-[#181b1e]'
    return isSelected ? `${base} ring-2 ring-offset-2 ring-${color}-500` : base
  }

  // Get published class IDs
  const publishedClassIds = new Set((publications || []).filter((p: any) => p.is_active).map((p: any) => p.class_id))

  if (isLoadingBot && isEditing) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-[#181b1e]" />
      </div>
    )
  }

  return (
    <div className="h-full min-h-[600px] flex flex-col">
      <div className="flex items-center gap-4 mb-4 flex-shrink-0">
        <Button variant="ghost" onClick={onBack} className="text-slate-600">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t('common.back')}
        </Button>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-slate-800">
            {isEditing ? t('teacherbot.edit_teacherbot') : t('teacherbot.new_teacherbot')}
          </h2>
        </div>
        {isEditing && (
          <Button
            variant="outline"
            onClick={() => setShowPublishModal(true)}
            className="text-[#181b1e] border-[#181b1e]/20 hover:bg-[#181b1e]/5"
          >
            <Globe className="h-4 w-4 mr-2" />
            {t('teacherbot.publish_btn')}
          </Button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto pr-1">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left Column - Basic Info */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-800 mb-4">{t('teacherbot.basic_info')}</h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Nome <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#181b1e] focus:border-transparent"
                    placeholder="es. Tutor di Matematica"
                    maxLength={100}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    {t('teacherbot.synopsis_label')}
                  </label>
                  <input
                    type="text"
                    value={formData.synopsis}
                    onChange={(e) => setFormData({ ...formData, synopsis: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#181b1e] focus:border-transparent"
                    placeholder="es. Un assistente per esercizi di algebra"
                    maxLength={255}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">{t('teacherbot.color_label')}</label>
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
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-800 mb-4">{t('teacherbot.options_section')}</h3>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="font-medium text-slate-700">{t('teacherbot.proactive')}</label>
                    <p className="text-sm text-slate-500">{t('teacherbot.proactive_desc')}</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={formData.is_proactive}
                    onClick={() => setFormData({ ...formData, is_proactive: !formData.is_proactive })}
                    className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
                      formData.is_proactive ? 'bg-[#181b1e]' : 'bg-slate-200'
                    }`}
                  >
                    <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                      formData.is_proactive ? 'translate-x-7' : 'translate-x-1'
                    }`} />
                  </button>
                </div>

                {formData.is_proactive && (
                  <div className="ml-1 pl-4 border-l-2 border-[#181b1e]/15 animate-in slide-in-from-top-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('teacherbot.initial_message_label')}
                    </label>
                    <textarea
                      value={formData.proactive_message}
                      onChange={(e) => setFormData({ ...formData, proactive_message: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#181b1e] focus:border-transparent"
                      placeholder={t('teacherbot.initial_message_placeholder')}
                      rows={2}
                    />
                  </div>
                )}

                <div className="pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="font-medium text-slate-700">{t('teacherbot.reporting')}</label>
                      <p className="text-sm text-slate-500">{t('teacherbot.reporting_desc')}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={formData.enable_reporting}
                      onClick={() => setFormData({ ...formData, enable_reporting: !formData.enable_reporting })}
                      className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${
                        formData.enable_reporting ? 'bg-[#181b1e]' : 'bg-slate-200'
                      }`}
                    >
                      <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                        formData.enable_reporting ? 'translate-x-7' : 'translate-x-1'
                      }`} />
                    </button>
                  </div>
                </div>

                {formData.enable_reporting && (
                  <div className="ml-1 pl-4 border-l-2 border-[#181b1e]/15 animate-in slide-in-from-top-2">
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      {t('teacherbot.report_prompt_label')}
                    </label>
                    <textarea
                      value={formData.report_prompt}
                      onChange={(e) => setFormData({ ...formData, report_prompt: e.target.value })}
                      className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#181b1e] focus:border-transparent text-sm"
                      placeholder={t('teacherbot.report_prompt_placeholder')}
                      rows={3}
                    />
                  </div>
                )}

                <div className="pt-4 border-t border-slate-100">
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    {t('teacherbot.temperature_label', { value: formData.temperature.toFixed(1) })}
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
                    <span>{t('teacherbot.temp_precise')}</span>
                    <span>{t('teacherbot.temp_creative')}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column - System Prompt */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col relative h-[520px] lg:h-[640px]">
            <h3 className="font-semibold text-slate-800 mb-2">
              System Prompt <span className="text-red-500">*</span>
            </h3>
            <p className="text-sm text-slate-500 mb-4">
              {t('teacherbot.system_prompt_desc', 'Define the personality and behaviour of your assistant.')}
              <br />
              <span className="text-[#181b1e] text-xs italic">
                {t('teacherbot.system_prompt_tip')}
              </span>
            </p>

            <textarea
              ref={textareaRef}
              value={formData.system_prompt}
              onChange={(e) => setFormData({ ...formData, system_prompt: e.target.value })}
              onMouseUp={handleMouseUpWithEvent}
              className="flex-1 w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#181b1e] focus:border-transparent font-mono text-sm resize-none"
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

        {/* Knowledge Base Section — always visible */}
        <KnowledgeBaseSection
          teacherbotId={teacherbotId}
          pendingFiles={pendingKbFiles}
          onPendingFilesChange={setPendingKbFiles}
        />

        {/* Save Button */}
        <div className="mt-4 pt-4 pb-4 flex justify-end gap-3 border-t border-slate-200 bg-white/95 backdrop-blur-sm sticky bottom-0">
          <Button type="button" variant="outline" onClick={onBack}>
            {t('common.cancel')}
          </Button>
          <Button
            type="submit"
            disabled={saveMutation.isPending}
            className="bg-[#181b1e] hover:bg-[#0f1113]"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            {isEditing ? t('teacherbot.save_changes') : t('teacherbot.create_btn')}
          </Button>
        </div>
      </form>

      {/* Publish Modal includes are kept same as before */}
      {showPublishModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold text-slate-800">{t('teacherbot.publish_title')}</h3>
              <Button variant="ghost" size="icon" onClick={() => setShowPublishModal(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>

            <p className="text-sm text-slate-600 mb-4">
              {t('teacherbot.publish_desc')}
            </p>

            {/* Current publications */}
            {publications && publications.filter((p: any) => p.is_active).length > 0 && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">{t('teacherbot.published_on')}</label>
                <div className="space-y-2">
                  {publications.filter((p: any) => p.is_active).map((pub: any) => (
                    <div key={pub.id} className="flex items-center justify-between p-3 bg-green-50 rounded-xl border border-green-200">
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
                        {t('teacherbot.remove_btn')}
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
                  className={`w-full text-left p-3 rounded-xl border transition-all ${selectedClassId === cls.id
                    ? 'border-[#181b1e]/40 bg-[#181b1e]/5'
                    : 'border-slate-200 hover:border-[#181b1e]/20 hover:bg-slate-50'
                    }`}
                >
                  <div className="font-medium text-slate-800">{cls.name}</div>
                  <div className="text-xs text-slate-500">
                    {cls.role === 'owner' ? t('teacherbot.owner') : t('teacherbot.shared_by', { name: cls.owner_name })}
                  </div>
                </button>
              ))}
              {classes?.filter((c: any) => !publishedClassIds.has(c.id)).length === 0 && (
                <p className="text-center text-sm text-slate-400 py-4">
                  {t('teacherbot.all_published')}
                </p>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowPublishModal(false)}>
                {t('common.close')}
              </Button>
              <Button
                onClick={handlePublish}
                disabled={!selectedClassId || publishMutation.isPending}
                className="bg-[#181b1e] hover:bg-[#0f1113]"
              >
                {publishMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Globe className="h-4 w-4 mr-2" />
                )}
                {t('teacherbot.publish_btn')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
