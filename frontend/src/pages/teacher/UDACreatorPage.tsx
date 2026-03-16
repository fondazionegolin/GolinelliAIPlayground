import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { udaApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import {
  ArrowLeft, BookOpen, Lightbulb, List, Zap, Eye, Send,
  Pencil, Trash2, CheckCircle, Loader2, Plus, ChevronDown, ChevronUp,
  Upload, Bot
} from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

interface UdaItem {
  id: string
  task_id?: string
  title: string
  task_type: string
  status: string
  content?: object
}

interface Uda {
  id: string
  title: string
  description?: string
  status: string
  uda_phase: string
  kb: Record<string, unknown>
  plan: { items?: UdaItem[] }
  children: UdaItem[]
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
                  <div key={child.id} className="flex items-center gap-3 bg-white rounded-lg px-3 py-3 border border-slate-100 shadow-sm">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColor(child.task_type)}`}>
                      {TYPE_LABELS[child.task_type] || child.task_type}
                    </span>
                    <span className="text-sm flex-1 font-medium">{child.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${child.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {child.status === 'published' ? 'Pubblicato' : 'Bozza'}
                    </span>
                    {phase === 'review' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
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
