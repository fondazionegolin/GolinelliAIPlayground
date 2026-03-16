import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { udaApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import {
  ArrowLeft, BookOpen, Lightbulb, List, Zap, Eye, Send,
  Pencil, Trash2, CheckCircle, Loader2, ChevronDown, ChevronUp,
  Upload, Bot, X, Save, ChevronLeft, ChevronRight
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

// Items inside the plan JSON (pre-generation, from uda_agent)
interface PlanItem {
  id: string
  type: string
  title: string
  description?: string
  purpose?: string
}

// Typed content shapes per task type
interface LessonContent { html: string }
interface QuizQuestion { question: string; options: string[]; correct: number; explanation?: string }
interface QuizContent { questions: QuizQuestion[] }
interface ExerciseQuestion { question: string; hint?: string }
interface ExerciseContent { instructions: string; questions: ExerciseQuestion[]; evaluation_rubric?: string }
interface Slide { title: string; content: string; notes?: string }
interface PresentationContent { slides: Slide[] }

type ChildContent = LessonContent | QuizContent | ExerciseContent | PresentationContent | Record<string, unknown>

// Actual child Task records (post-generation)
interface ChildTask {
  id: string
  title: string
  task_type: string
  status: string
  content?: ChildContent
}

interface Uda {
  id: string
  title: string
  description?: string
  status: string
  uda_phase: string
  kb: Record<string, unknown>
  plan: { items?: PlanItem[] }
  children: ChildTask[]
  created_at: string
}

// ─── Phase config ─────────────────────────────────────────────────────────────

const PHASES = ['briefing', 'kb', 'plan', 'generating', 'review', 'published'] as const
type Phase = typeof PHASES[number]

const PHASE_LABELS: Record<Phase, string> = {
  briefing: 'Briefing',
  kb: 'Knowledge Base',
  plan: 'Piano',
  generating: 'Generazione',
  review: 'Revisione',
  published: 'Pubblicata',
}

const PHASE_ICONS: Record<Phase, React.ReactNode> = {
  briefing: <Lightbulb className="h-4 w-4" />,
  kb: <BookOpen className="h-4 w-4" />,
  plan: <List className="h-4 w-4" />,
  generating: <Zap className="h-4 w-4" />,
  review: <Eye className="h-4 w-4" />,
  published: <CheckCircle className="h-4 w-4" />,
}

const TYPE_LABELS: Record<string, string> = {
  lesson: 'Documento',
  quiz: 'Quiz',
  exercise: 'Esercizio',
  presentation: 'Presentazione',
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function UDACreatorPage() {
  const { classId, udaId } = useParams<{ classId: string; udaId: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<{ role: string; content: string }[]>([])
  const [generating, setGenerating] = useState(false)
  const [genProgress, setGenProgress] = useState<string[]>([])
  const [editingKb, setEditingKb] = useState(false)
  const [kbDraft, setKbDraft] = useState('')
  const [editingPlan, setEditingPlan] = useState(false)
  const [planDraft, setPlanDraft] = useState('')
  const [uploadFiles, setUploadFiles] = useState<File[]>([])
  const [briefingPrompt, setBriefingPrompt] = useState('')
  const [previewChild, setPreviewChild] = useState<ChildTask | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  const { data: uda, isLoading } = useQuery<Uda>({
    queryKey: ['uda', classId, udaId],
    queryFn: async () => {
      const res = await udaApi.listUdas(classId!)
      const list = res.data as Uda[]
      const found = list.find(u => u.id === udaId)
      if (!found) throw new Error('UDA not found')
      return found
    },
    enabled: !!classId && !!udaId,
    refetchInterval: generating ? 2000 : false,
  })

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  // ─── Mutations ───────────────────────────────────────────────────────────────

  const generateKbMutation = useMutation({
    mutationFn: async () => {
      const res = await udaApi.generateKb(classId!, udaId!, briefingPrompt, uploadFiles)
      return res.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uda', classId, udaId] })
      queryClient.invalidateQueries({ queryKey: ['udas', classId] })
      setUploadFiles([])
      toast({ title: 'Knowledge base generata' })
    },
    onError: () => toast({ title: 'Errore generazione KB', variant: 'destructive' }),
  })

  const generatePlanMutation = useMutation({
    mutationFn: () => udaApi.generatePlan(classId!, udaId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uda', classId, udaId] })
      toast({ title: 'Piano generato' })
    },
    onError: () => toast({ title: 'Errore generazione piano', variant: 'destructive' }),
  })

  const updateKbMutation = useMutation({
    mutationFn: (kb: object) => udaApi.updateKb(classId!, udaId!, kb),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uda', classId, udaId] })
      setEditingKb(false)
    },
  })

  const updatePlanMutation = useMutation({
    mutationFn: (plan: object) => udaApi.updatePlan(classId!, udaId!, plan),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['uda', classId, udaId] })
      setEditingPlan(false)
    },
  })

  const deleteChildMutation = useMutation({
    mutationFn: (childId: string) => udaApi.deleteChild(classId!, udaId!, childId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['uda', classId, udaId] }),
  })

  const publishMutation = useMutation({
    mutationFn: () => udaApi.publishUda(classId!, udaId!),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['uda', classId, udaId] })
      toast({ title: `UDA pubblicata su ${res.data.session_count} sessioni!` })
    },
    onError: () => toast({ title: 'Errore pubblicazione', variant: 'destructive' }),
  })

  const chatMutation = useMutation({
    mutationFn: (message: string) => udaApi.chat(classId!, udaId!, message),
    onSuccess: (res) => {
      setChatMessages(prev => [...prev, { role: 'assistant', content: res.data.reply }])
      if (res.data.updated_kb || res.data.updated_plan) {
        queryClient.invalidateQueries({ queryKey: ['uda', classId, udaId] })
      }
    },
    onError: () => toast({ title: 'Errore chat', variant: 'destructive' }),
  })

  // ─── Generate content via SSE ─────────────────────────────────────────────

  const startGeneration = async () => {
    if (!classId || !udaId) return
    setGenerating(true)
    setGenProgress([])
    const token = (() => {
      try {
        const raw = localStorage.getItem('eduai-auth')
        return raw ? JSON.parse(raw)?.state?.accessToken : null
      } catch { return null }
    })()

    try {
      const res = await fetch(udaApi.generateContent(classId, udaId), {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      if (!reader) return

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const text = decoder.decode(value)
        const lines = text.split('\n').filter(l => l.startsWith('data:'))
        for (const line of lines) {
          try {
            const ev = JSON.parse(line.slice(5).trim())
            if (ev.event === 'item_start') {
              setGenProgress(p => [...p, `⏳ Generando: ${ev.title} (${ev.type})`])
            } else if (ev.event === 'item_done') {
              setGenProgress(p => [...p.slice(0, -1), `✅ ${ev.title}`])
            } else if (ev.event === 'item_error') {
              setGenProgress(p => [...p, `❌ Errore: ${ev.error}`])
            } else if (ev.event === 'done') {
              setGenProgress(p => [...p, '🎉 Generazione completata!'])
            }
          } catch { /* ignore */ }
        }
      }
    } catch (e) {
      toast({ title: 'Errore generazione contenuti', variant: 'destructive' })
    } finally {
      setGenerating(false)
      queryClient.invalidateQueries({ queryKey: ['uda', classId, udaId] })
    }
  }

  // ─── Chat send ────────────────────────────────────────────────────────────

  const handleChatSend = () => {
    const msg = chatInput.trim()
    if (!msg || chatMutation.isPending) return
    setChatMessages(prev => [...prev, { role: 'user', content: msg }])
    setChatInput('')
    chatMutation.mutate(msg)
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    )
  }

  if (!uda) {
    return <div className="p-8 text-center text-slate-500">UDA non trovata.</div>
  }

  const phase = uda.uda_phase as Phase
  const phaseIndex = PHASES.indexOf(phase)

  return (
    <div className="flex flex-col h-full bg-slate-50 overflow-auto">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center gap-4 sticky top-0 z-10">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="h-9 w-9 p-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-slate-800 truncate">{uda.title}</h1>
          <p className="text-xs text-slate-500">Unità Didattica</p>
        </div>
        {/* Phase stepper */}
        <div className="hidden md:flex items-center gap-1">
          {PHASES.filter(p => p !== 'generating').map((p, i) => {
            const idx = PHASES.indexOf(p)
            const active = p === phase
            const done = phaseIndex > idx
            return (
              <div key={p} className="flex items-center gap-1">
                <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors
                  ${active ? 'bg-indigo-100 text-indigo-700' : done ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                  {PHASE_ICONS[p]}
                  <span>{PHASE_LABELS[p]}</span>
                </div>
                {i < 4 && <span className="text-slate-300">→</span>}
              </div>
            )
          })}
        </div>
        {phase === 'review' && (
          <Button
            onClick={() => publishMutation.mutate()}
            disabled={publishMutation.isPending}
            className="bg-indigo-600 hover:bg-indigo-700 text-white"
          >
            {publishMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle className="h-4 w-4 mr-2" />}
            Pubblica UDA
          </Button>
        )}
        {phase === 'published' && (
          <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium flex items-center gap-1">
            <CheckCircle className="h-4 w-4" />Pubblicata
          </span>
        )}
      </div>

      <div className="flex flex-1 gap-0 min-h-0">
        {/* Main content */}
        <div className="flex-1 overflow-auto p-6 space-y-6">

          {/* PHASE: briefing */}
          {(phase === 'briefing' || phase === 'kb') && (
            <PhaseCard title="Fase 1 – Descrivi la tua UDA" icon={<Lightbulb />} active={phase === 'briefing'}>
              {phase === 'briefing' && (
                <div className="space-y-4">
                  <p className="text-sm text-slate-600">
                    Descrivi la tua Unità Didattica nel dettaglio: argomento, classe, obiettivi, durata prevista.
                    Puoi anche allegare documenti di riferimento.
                  </p>
                  <textarea
                    className="w-full border border-slate-200 rounded-lg p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    rows={6}
                    placeholder="Es: Voglio creare una UDA per la classe 2ª media sull'ecosistema del laghetto. Durata 4 settimane. Gli studenti devono capire le catene alimentari, i cicli dell'acqua e l'equilibrio degli ecosistemi..."
                    value={briefingPrompt}
                    onChange={e => setBriefingPrompt(e.target.value)}
                  />
                  <div className="flex items-center gap-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      multiple
                      accept=".pdf,.docx,.pptx,.ppt,.txt,.md"
                      onChange={e => setUploadFiles(Array.from(e.target.files || []))}
                    />
                    <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="h-4 w-4 mr-2" />
                      Allega documenti
                    </Button>
                    {uploadFiles.length > 0 && (
                      <span className="text-sm text-slate-500">{uploadFiles.length} file selezionati</span>
                    )}
                    <Button
                      className="ml-auto bg-indigo-600 hover:bg-indigo-700 text-white"
                      disabled={!briefingPrompt.trim() || generateKbMutation.isPending}
                      onClick={() => generateKbMutation.mutate()}
                    >
                      {generateKbMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}
                      Genera Knowledge Base
                    </Button>
                  </div>
                </div>
              )}
            </PhaseCard>
          )}

          {/* PHASE: KB */}
          {(phase === 'kb' || phase === 'plan' || phase === 'generating' || phase === 'review' || phase === 'published') && Object.keys(uda.kb).length > 0 && (
            <PhaseCard title="Knowledge Base" icon={<BookOpen />} active={phase === 'kb'} collapsible defaultOpen={phase === 'kb'}>
              {editingKb ? (
                <div className="space-y-2">
                  <textarea
                    className="w-full font-mono text-xs border border-slate-200 rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    rows={16}
                    value={kbDraft}
                    onChange={e => setKbDraft(e.target.value)}
                  />
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setEditingKb(false)}>Annulla</Button>
                    <Button size="sm" onClick={() => {
                      try { updateKbMutation.mutate(JSON.parse(kbDraft)) }
                      catch { toast({ title: 'JSON non valido', variant: 'destructive' }) }
                    }}>Salva</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <KbDisplay kb={uda.kb} />
                  {phase !== 'published' && (
                    <div className="flex gap-2 flex-wrap">
                      <Button variant="outline" size="sm" onClick={() => { setKbDraft(JSON.stringify(uda.kb, null, 2)); setEditingKb(true) }}>
                        <Pencil className="h-3 w-3 mr-1" />Modifica
                      </Button>
                      {phase === 'kb' && (
                        <Button
                          className="bg-indigo-600 hover:bg-indigo-700 text-white"
                          size="sm"
                          disabled={generatePlanMutation.isPending}
                          onClick={() => generatePlanMutation.mutate()}
                        >
                          {generatePlanMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <List className="h-4 w-4 mr-1" />}
                          Genera Piano
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </PhaseCard>
          )}

          {/* PHASE: Plan */}
          {(phase === 'plan' || phase === 'generating' || phase === 'review' || phase === 'published') && uda.plan?.items && (
            <PhaseCard title="Piano Operativo" icon={<List />} active={phase === 'plan'} collapsible defaultOpen={phase === 'plan'}>
              {editingPlan ? (
                <div className="space-y-2">
                  <textarea
                    className="w-full font-mono text-xs border border-slate-200 rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400"
                    rows={16}
                    value={planDraft}
                    onChange={e => setPlanDraft(e.target.value)}
                  />
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => setEditingPlan(false)}>Annulla</Button>
                    <Button size="sm" onClick={() => {
                      try { updatePlanMutation.mutate(JSON.parse(planDraft)) }
                      catch { toast({ title: 'JSON non valido', variant: 'destructive' }) }
                    }}>Salva</Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid gap-2">
                    {uda.plan.items?.map((item, i) => (
                      <div key={item.id || i} className="flex items-center gap-3 bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                        <span className="text-xs font-bold text-slate-400 w-5 text-center">{i + 1}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColor(item.type || (item as { task_type?: string }).task_type || 'lesson')}`}>
                          {TYPE_LABELS[item.type || (item as { task_type?: string }).task_type || 'lesson'] || item.type}
                        </span>
                        <span className="text-sm flex-1">{item.title}</span>
                      </div>
                    ))}
                  </div>
                  {phase === 'plan' && (
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={() => { setPlanDraft(JSON.stringify(uda.plan, null, 2)); setEditingPlan(true) }}>
                        <Pencil className="h-3 w-3 mr-1" />Modifica Piano
                      </Button>
                      <Button
                        className="bg-indigo-600 hover:bg-indigo-700 text-white"
                        size="sm"
                        disabled={generating}
                        onClick={startGeneration}
                      >
                        {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Zap className="h-4 w-4 mr-1" />}
                        Genera Contenuti
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </PhaseCard>
          )}

          {/* Generation progress */}
          {(generating || genProgress.length > 0) && (
            <PhaseCard title="Generazione in corso..." icon={<Zap />} active>
              <div className="space-y-1">
                {genProgress.map((msg, i) => (
                  <p key={i} className="text-sm text-slate-700">{msg}</p>
                ))}
                {generating && <Loader2 className="h-4 w-4 animate-spin text-indigo-500 mt-2" />}
              </div>
            </PhaseCard>
          )}

          {/* PHASE: Review – children */}
          {(phase === 'review' || phase === 'published') && uda.children.length > 0 && (
            <PhaseCard title="Contenuti Generati" icon={<Eye />} active={phase === 'review'} collapsible defaultOpen>
              <div className="space-y-2">
                {uda.children.map((child) => (
                  <div key={child.id} className="flex items-center gap-3 bg-white rounded-lg px-3 py-3 border border-slate-100 shadow-sm hover:border-indigo-200 transition-colors">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${typeColor(child.task_type)}`}>
                      {TYPE_LABELS[child.task_type] || child.task_type}
                    </span>
                    <span className="text-sm flex-1 font-medium truncate">{child.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${child.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {child.status === 'published' ? 'Pubblicato' : 'Bozza'}
                    </span>
                    {/* Preview/Edit button — always visible */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 flex-shrink-0"
                      title="Anteprima e modifica"
                      onClick={() => setPreviewChild(child)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    {phase === 'review' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-400 hover:text-red-600 flex-shrink-0"
                        onClick={() => deleteChildMutation.mutate(child.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </PhaseCard>
          )}
        </div>

        {/* Chat sidebar */}
        <div className="w-80 flex-shrink-0 border-l border-slate-200 bg-white flex flex-col">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <Bot className="h-4 w-4 text-indigo-500" />
            <span className="text-sm font-semibold text-slate-700">Assistente UDA</span>
          </div>
          <div className="flex-1 overflow-auto px-3 py-3 space-y-3">
            {chatMessages.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-xs">
                <Bot className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p>Chiedimi di modificare la knowledge base, il piano, o qualsiasi cosa sull'UDA.</p>
                <div className="mt-4 space-y-2">
                  {[
                    'Aggiungi un obiettivo sulla sostenibilità',
                    'Rimuovi la presentazione dal piano',
                    'Aggiungi un quiz sulla biodiversità',
                  ].map(s => (
                    <button
                      key={s}
                      onClick={() => setChatInput(s)}
                      className="block w-full text-left px-3 py-2 bg-slate-50 hover:bg-slate-100 rounded-lg text-xs text-slate-600 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chatMessages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] px-3 py-2 rounded-xl text-xs ${
                  msg.role === 'user'
                    ? 'bg-indigo-500 text-white rounded-br-none'
                    : 'bg-slate-100 text-slate-700 rounded-bl-none'
                }`}>
                  {msg.content}
                </div>
              </div>
            ))}
            {chatMutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-slate-100 px-3 py-2 rounded-xl text-xs text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin" />
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div className="px-3 py-2 border-t border-slate-100">
            <div className="flex gap-2">
              <input
                className="flex-1 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                placeholder="Modifica, chiedi, aggiungi..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleChatSend()}
              />
              <Button
                size="sm"
                className="h-8 w-8 p-0 bg-indigo-600 hover:bg-indigo-700"
                disabled={!chatInput.trim() || chatMutation.isPending}
                onClick={handleChatSend}
              >
                <Send className="h-3.5 w-3.5 text-white" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Child preview/edit modal — portal to escape transforms */}
      {previewChild && createPortal(
        <ChildPreviewModal
          child={previewChild}
          classId={classId!}
          udaId={udaId!}
          readOnly={phase === 'published'}
          onClose={() => setPreviewChild(null)}
          onSaved={(updated) => {
            setPreviewChild(updated)
            queryClient.invalidateQueries({ queryKey: ['uda', classId, udaId] })
          }}
        />,
        document.body
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PhaseCard({
  title,
  icon,
  active,
  children,
  collapsible,
  defaultOpen = true,
}: {
  title: string
  icon: React.ReactNode
  active?: boolean
  children: React.ReactNode
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={`bg-white rounded-xl border shadow-sm ${active ? 'border-indigo-200 ring-1 ring-indigo-100' : 'border-slate-100'}`}>
      <div
        className={`flex items-center gap-2 px-5 py-3 ${collapsible ? 'cursor-pointer select-none' : ''}`}
        onClick={() => collapsible && setOpen(o => !o)}
      >
        <span className={`${active ? 'text-indigo-500' : 'text-slate-400'}`}>{icon}</span>
        <h3 className={`font-semibold text-sm ${active ? 'text-indigo-700' : 'text-slate-700'}`}>{title}</h3>
        {collapsible && (
          <span className="ml-auto text-slate-400">
            {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </span>
        )}
      </div>
      {(!collapsible || open) && (
        <div className="px-5 pb-5">{children}</div>
      )}
    </div>
  )
}

function KbDisplay({ kb }: { kb: Record<string, unknown> }) {
  const labels: Record<string, string> = {
    title: 'Titolo',
    school_level: 'Livello scolastico',
    subject: 'Disciplina',
    duration: 'Durata',
    objectives: 'Obiettivi',
    prerequisites: 'Prerequisiti',
    key_contents: 'Contenuti chiave',
    methodology: 'Metodologie',
    evaluation_criteria: 'Criteri di valutazione',
    notes: 'Note',
  }

  return (
    <div className="grid gap-2 text-sm">
      {Object.entries(kb).map(([key, value]) => {
        if (!value || (Array.isArray(value) && value.length === 0)) return null
        return (
          <div key={key} className="flex gap-3">
            <span className="text-xs font-semibold text-slate-500 w-36 flex-shrink-0 pt-0.5">
              {labels[key] || key}
            </span>
            {Array.isArray(value) ? (
              <ul className="list-disc list-inside space-y-0.5 text-slate-700">
                {(value as string[]).map((v, i) => <li key={i} className="text-xs">{v}</li>)}
              </ul>
            ) : (
              <span className="text-slate-700 text-xs">{String(value)}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function typeColor(type: string): string {
  const map: Record<string, string> = {
    lesson: 'bg-blue-100 text-blue-700',
    quiz: 'bg-amber-100 text-amber-700',
    exercise: 'bg-emerald-100 text-emerald-700',
    presentation: 'bg-purple-100 text-purple-700',
  }
  return map[type] || 'bg-slate-100 text-slate-600'
}

// ─── Child Preview / Edit Modal ───────────────────────────────────────────────

function ChildPreviewModal({
  child,
  classId,
  udaId,
  readOnly,
  onClose,
  onSaved,
}: {
  child: ChildTask
  classId: string
  udaId: string
  readOnly: boolean
  onClose: () => void
  onSaved: (updated: ChildTask) => void
}) {
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [titleDraft, setTitleDraft] = useState(child.title)

  // Per-type edit state
  const [lessonHtml, setLessonHtml] = useState(
    (child.content as { html?: string })?.html ?? ''
  )
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>(
    (child.content as { questions?: QuizQuestion[] })?.questions ?? []
  )
  const [exerciseDraft, setExerciseDraft] = useState<ExerciseContent>({
    instructions: (child.content as ExerciseContent)?.instructions ?? '',
    questions: (child.content as ExerciseContent)?.questions ?? [],
    evaluation_rubric: (child.content as ExerciseContent)?.evaluation_rubric ?? '',
  })
  const [slides, setSlides] = useState<Slide[]>(
    (child.content as { slides?: Slide[] })?.slides ?? []
  )
  const [slideIndex, setSlideIndex] = useState(0)

  const saveMutation = useMutation({
    mutationFn: async () => {
      let newContent: ChildContent
      if (child.task_type === 'lesson') newContent = { html: lessonHtml }
      else if (child.task_type === 'quiz') newContent = { questions: quizQuestions }
      else if (child.task_type === 'exercise') newContent = exerciseDraft
      else if (child.task_type === 'presentation') newContent = { slides }
      else newContent = child.content ?? {}
      return udaApi.updateChild(classId, udaId, child.id, { title: titleDraft, content: newContent })
    },
    onSuccess: (res) => {
      toast({ title: 'Modifiche salvate' })
      setEditing(false)
      onSaved({ ...child, title: titleDraft, content: res.data.content ?? child.content })
    },
    onError: () => toast({ title: 'Errore salvataggio', variant: 'destructive' }),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl mx-4 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-slate-100">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${typeColor(child.task_type)}`}>
            {TYPE_LABELS[child.task_type] || child.task_type}
          </span>
          {editing ? (
            <input
              className="flex-1 text-sm font-semibold border-b border-indigo-300 focus:outline-none px-1"
              value={titleDraft}
              onChange={e => setTitleDraft(e.target.value)}
            />
          ) : (
            <h2 className="flex-1 text-sm font-semibold text-slate-800 truncate">{child.title}</h2>
          )}
          <div className="flex gap-2 flex-shrink-0">
            {!readOnly && !editing && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)} className="h-8 text-xs">
                <Pencil className="h-3.5 w-3.5 mr-1" />Modifica
              </Button>
            )}
            {editing && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)} className="h-8 text-xs">
                  Annulla
                </Button>
                <Button
                  size="sm"
                  className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  {saveMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                  Salva
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={onClose} className="h-8 w-8 p-0">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">
          {child.task_type === 'lesson' && (
            editing ? (
              <div className="space-y-2">
                <p className="text-xs text-slate-400">Modifica il contenuto HTML del documento</p>
                <textarea
                  className="w-full font-mono text-xs border border-slate-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-1 focus:ring-indigo-400 min-h-[400px]"
                  value={lessonHtml}
                  onChange={e => setLessonHtml(e.target.value)}
                />
              </div>
            ) : (
              <div
                className="prose prose-sm max-w-none text-slate-700"
                dangerouslySetInnerHTML={{ __html: lessonHtml }}
              />
            )
          )}

          {child.task_type === 'quiz' && (
            <div className="space-y-4">
              {quizQuestions.map((q, qi) => (
                <div key={qi} className="border border-slate-100 rounded-xl p-4 space-y-2">
                  {editing ? (
                    <>
                      <input
                        className="w-full text-sm font-medium border-b border-slate-200 focus:outline-none pb-1"
                        value={q.question}
                        onChange={e => {
                          const updated = [...quizQuestions]
                          updated[qi] = { ...q, question: e.target.value }
                          setQuizQuestions(updated)
                        }}
                      />
                      {q.options.map((opt, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <button
                            type="button"
                            className={`w-5 h-5 rounded-full border-2 flex-shrink-0 ${q.correct === oi ? 'border-green-500 bg-green-500' : 'border-slate-300'}`}
                            onClick={() => {
                              const updated = [...quizQuestions]
                              updated[qi] = { ...q, correct: oi }
                              setQuizQuestions(updated)
                            }}
                          />
                          <input
                            className="flex-1 text-sm border-b border-slate-100 focus:outline-none"
                            value={opt}
                            onChange={e => {
                              const updated = [...quizQuestions]
                              const opts = [...q.options]
                              opts[oi] = e.target.value
                              updated[qi] = { ...q, options: opts }
                              setQuizQuestions(updated)
                            }}
                          />
                        </div>
                      ))}
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-slate-800">{qi + 1}. {q.question}</p>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {q.options.map((opt, oi) => (
                          <div key={oi} className={`text-xs px-3 py-2 rounded-lg border ${oi === q.correct ? 'bg-green-50 border-green-200 text-green-700 font-medium' : 'bg-slate-50 border-slate-100 text-slate-600'}`}>
                            {opt}
                          </div>
                        ))}
                      </div>
                      {q.explanation && (
                        <p className="text-xs text-slate-400 mt-1 italic">💡 {q.explanation}</p>
                      )}
                    </>
                  )}
                </div>
              ))}
            </div>
          )}

          {child.task_type === 'exercise' && (
            <div className="space-y-4">
              <div className={`rounded-xl p-4 ${editing ? 'border border-slate-200' : 'bg-slate-50'}`}>
                <p className="text-xs font-semibold text-slate-500 uppercase mb-1">Istruzioni</p>
                {editing ? (
                  <textarea
                    className="w-full text-sm border-0 focus:outline-none resize-none bg-transparent"
                    rows={3}
                    value={exerciseDraft.instructions}
                    onChange={e => setExerciseDraft(d => ({ ...d, instructions: e.target.value }))}
                  />
                ) : (
                  <p className="text-sm text-slate-700">{exerciseDraft.instructions}</p>
                )}
              </div>
              {exerciseDraft.questions.map((q, qi) => (
                <div key={qi} className="border border-slate-100 rounded-xl p-4">
                  <p className="text-xs font-semibold text-slate-400 mb-1">{qi + 1}.</p>
                  {editing ? (
                    <input
                      className="w-full text-sm border-b border-slate-200 focus:outline-none pb-1"
                      value={q.question}
                      onChange={e => {
                        const updated = [...exerciseDraft.questions]
                        updated[qi] = { ...q, question: e.target.value }
                        setExerciseDraft(d => ({ ...d, questions: updated }))
                      }}
                    />
                  ) : (
                    <p className="text-sm text-slate-800">{q.question}</p>
                  )}
                  {q.hint && <p className="text-xs text-indigo-400 mt-1 italic">💡 {q.hint}</p>}
                </div>
              ))}
              {exerciseDraft.evaluation_rubric && (
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
                  <p className="text-xs font-semibold text-amber-600 mb-1">Criteri di valutazione</p>
                  {editing ? (
                    <textarea
                      className="w-full text-sm border-0 focus:outline-none resize-none bg-transparent"
                      rows={2}
                      value={exerciseDraft.evaluation_rubric}
                      onChange={e => setExerciseDraft(d => ({ ...d, evaluation_rubric: e.target.value }))}
                    />
                  ) : (
                    <p className="text-sm text-amber-700">{exerciseDraft.evaluation_rubric}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {child.task_type === 'presentation' && slides.length > 0 && (
            <div className="space-y-4">
              {/* Slide navigator */}
              <div className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-2">
                <Button
                  variant="ghost" size="sm"
                  disabled={slideIndex === 0}
                  onClick={() => setSlideIndex(i => i - 1)}
                  className="h-8 w-8 p-0"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm font-medium text-slate-600">
                  Slide {slideIndex + 1} / {slides.length}
                </span>
                <Button
                  variant="ghost" size="sm"
                  disabled={slideIndex === slides.length - 1}
                  onClick={() => setSlideIndex(i => i + 1)}
                  className="h-8 w-8 p-0"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Slide content */}
              {slides[slideIndex] && (
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <div className="bg-indigo-600 px-6 py-4">
                    {editing ? (
                      <input
                        className="w-full text-lg font-bold text-white bg-transparent border-b border-white/40 focus:outline-none"
                        value={slides[slideIndex].title}
                        onChange={e => {
                          const updated = [...slides]
                          updated[slideIndex] = { ...updated[slideIndex], title: e.target.value }
                          setSlides(updated)
                        }}
                      />
                    ) : (
                      <h3 className="text-lg font-bold text-white">{slides[slideIndex].title}</h3>
                    )}
                  </div>
                  <div className="p-6 min-h-[200px]">
                    {editing ? (
                      <textarea
                        className="w-full text-sm text-slate-700 border-0 focus:outline-none resize-none bg-transparent min-h-[150px]"
                        value={slides[slideIndex].content}
                        onChange={e => {
                          const updated = [...slides]
                          updated[slideIndex] = { ...updated[slideIndex], content: e.target.value }
                          setSlides(updated)
                        }}
                      />
                    ) : (
                      <p className="text-sm text-slate-700 whitespace-pre-line">{slides[slideIndex].content}</p>
                    )}
                  </div>
                  {slides[slideIndex].notes && (
                    <div className="px-6 py-3 bg-slate-50 border-t border-slate-100">
                      <p className="text-xs text-slate-400 italic">Note: {slides[slideIndex].notes}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Slide thumbnails */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {slides.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => setSlideIndex(i)}
                    className={`flex-shrink-0 w-24 h-16 rounded-lg border text-xs font-medium px-2 text-left overflow-hidden transition-colors ${
                      i === slideIndex ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-100 bg-white text-slate-500 hover:border-slate-300'
                    }`}
                  >
                    <span className="block text-[10px] text-slate-400">{i + 1}</span>
                    <span className="block truncate leading-tight">{s.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
