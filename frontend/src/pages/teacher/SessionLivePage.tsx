import { SectionHeading } from '@/design/primitives/SectionHeading'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, Link, useLocation, useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Socket } from 'socket.io-client'
import { useTranslation } from 'react-i18next'
import { teacherApi, teacherbotsApi } from '@/lib/api'
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/design'
import { useToast } from '@/components/ui/use-toast'
import {
  ArrowLeft, Users, Copy, Play, Square,
  Bot, Brain, MessageSquare,
  ClipboardList, ChevronDown, ChevronUp, History, User, BookOpen, Search, X,
  MonitorPlay, ChevronRight, FileCode2, Code2, FileText, Filter, ArrowUpDown,
  ListChecks, SquareKanban, Video
} from '@/components/icons'
import { MushroomIcon, Cube3DIcon, CanvasEaselIcon } from '@/components/icons/CustomIcons'
import { llmApi } from '@/lib/api'
import TasksPanel from '@/components/tasks/TasksPanel'
import type { TaskData } from '@/components/tasks/taskShared'
import TeacherbotTestChat from '@/components/teacher/TeacherbotTestChat'
import { MessageBubble } from '@/components/student/ChatConversationView'
import type { TokenUsageJson } from '@/lib/environmentalImpact'
import 'katex/dist/katex.min.css'
// TeacherNotifications removed per redesign
import { useSocket } from '@/hooks/useSocket'
import { useAuthStore } from '@/stores/auth'
import { Switch } from '@/components/ui/switch'
import { tl } from '@/i18n/tl'
import { SessionCallsPanel } from '@/components/voice-calls/SessionCallsPanel'

interface StudentData {
  id: string
  nickname: string
  is_frozen: boolean
  joined_at: string
  last_activity_at: string | null
}

interface SharedDocumentData {
  id: string
  task_id: string
  submission_id: string | null
  source: 'teacher' | 'student'
  title: string
  doc_type: string
  content_json: string
  updated_at: string
  session_id: string
  session_name: string
  class_name: string
  author_name: string
}

interface SessionLiveData {
  session: {
    id: string
    class_id: string
    title: string
    join_code: string
    status: string
    class_name: string
    class_school_grade?: string | null
    default_llm_provider?: string | null
    default_llm_model?: string | null
  }
  students: StudentData[]
  modules: {
    module_key: string
    is_enabled: boolean
  }[]
}

export default function SessionLivePage() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const { toast } = useToast()
  useAuthStore() // Keep store connection for auth state
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState(() => {
    const tab = searchParams.get('tab')
    return tab === 'tasks' || tab === 'history' || tab === 'documents' || tab === 'calls' ? tab : 'modules'
  })

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'tasks' || tab === 'history' || tab === 'documents' || tab === 'calls') setActiveTab(tab)
  }, [searchParams])
  const [showPedagogicalAnalysis, setShowPedagogicalAnalysis] = useState(false)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)

  // Demo mode: teacherbot slide-over
  const [demoBotId, setDemoBotId] = useState<string | null>(null)

  // Fetch available LLM models
  const { data: modelsData } = useQuery({
    queryKey: ['available-models'],
    queryFn: async () => {
      const res = await llmApi.getAvailableModels()
      return res.data as { models: { provider: string; model: string; name: string; description: string }[]; default_provider: string; default_model: string }
    },
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  // Get online users + socket for real-time updates
  const { socket } = useSocket(sessionId || '')

  const { data: tasksData } = useQuery<TaskData[]>({
    queryKey: ['session-tasks', sessionId],
    queryFn: async () => {
      const res = await teacherApi.getTasks(sessionId!)
      return res.data
    },
    enabled: !!sessionId,
  })

  const { data: documentsData = [] } = useQuery<SharedDocumentData[]>({
    queryKey: ['session-documents', sessionId],
    queryFn: async () => {
      const res = await teacherApi.listSharedDocuments({ session_id: sessionId! })
      return res.data
    },
    enabled: !!sessionId,
  })

  const { data, isLoading } = useQuery<SessionLiveData>({
    queryKey: ['session-live', sessionId],
    queryFn: async () => {
      const res = await teacherApi.getSessionLive(sessionId!)
      return res.data
    },
    enabled: !!sessionId,
    // No polling — updates arrive via socket events (student_frozen_status, module_toggled)
  })

  // Real-time: update session-live cache when backend pushes changes
  useEffect(() => {
    if (!socket || !sessionId) return

    const handleFrozenStatus = (d: { student_id: string; is_frozen: boolean }) => {
      queryClient.setQueryData(['session-live', sessionId], (old: SessionLiveData | undefined) => {
        if (!old) return old
        return { ...old, students: old.students.map(s => s.id === d.student_id ? { ...s, is_frozen: d.is_frozen } : s) }
      })
    }

    const handleModuleToggled = (d: { module_key: string; is_enabled: boolean }) => {
      queryClient.setQueryData(['session-live', sessionId], (old: SessionLiveData | undefined) => {
        if (!old) return old
        const exists = old.modules.some(m => m.module_key === d.module_key)
        const modules = exists
          ? old.modules.map(m => m.module_key === d.module_key ? { ...m, is_enabled: d.is_enabled } : m)
          : [...old.modules, { module_key: d.module_key, is_enabled: d.is_enabled }]
        return { ...old, modules }
      })
    }

    const handleTeacherNotification = (d: { type?: string }) => {
      if (d.type === 'student_document') {
        queryClient.invalidateQueries({ queryKey: ['session-documents', sessionId] })
      }
    }

    const handleTaskSubmission = (d: { task_id?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['session-tasks', sessionId] })
      if (d.task_id) {
        queryClient.invalidateQueries({ queryKey: ['task-results', sessionId, d.task_id] })
        queryClient.invalidateQueries({ queryKey: ['task-submissions', sessionId, d.task_id] })
        queryClient.invalidateQueries({ queryKey: ['task-overview', sessionId, d.task_id] })
      }
    }

    const handleTaskCorrectionRead = (d: { task_id?: string }) => {
      if (d.task_id) {
        queryClient.invalidateQueries({ queryKey: ['task-submissions', sessionId, d.task_id] })
      }
    }

    socket.on('student_frozen_status', handleFrozenStatus)
    socket.on('module_toggled', handleModuleToggled)
    socket.on('teacher_notification', handleTeacherNotification)
    socket.on('task_submission', handleTaskSubmission)
    socket.on('task_correction_read', handleTaskCorrectionRead)
    return () => {
      socket.off('student_frozen_status', handleFrozenStatus)
      socket.off('module_toggled', handleModuleToggled)
      socket.off('teacher_notification', handleTeacherNotification)
      socket.off('task_submission', handleTaskSubmission)
      socket.off('task_correction_read', handleTaskCorrectionRead)
    }
  }, [socket, sessionId, queryClient])

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) => teacherApi.updateSession(sessionId!, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-live', sessionId] })
      toast({ title: tl("Stato aggiornato!") })
    },
  })

  const toggleModuleMutation = useMutation({
    mutationFn: ({ moduleKey, isEnabled }: { moduleKey: string; isEnabled: boolean }) =>
      teacherApi.toggleModule(sessionId!, moduleKey, isEnabled),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['session-live', sessionId] })
      toast({ title: tl("Modulo {0}", variables.isEnabled ? 'attivato' : 'disattivato') })
    },
  })

  const updateDefaultModelMutation = useMutation({
    mutationFn: ({ provider, model }: { provider: string; model: string }) =>
      teacherApi.updateSession(sessionId!, { default_llm_provider: provider, default_llm_model: model }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-live', sessionId] })
      toast({ title: tl("Modello di default aggiornato!") })
    },
  })




  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    toast({ title: tl("Codice copiato!") })
  }



  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[40vh] text-sm text-slate-400">
        {t('common.loading')}
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full min-h-[40vh] text-sm text-slate-400">
        {t('navbar.no_session')}
      </div>
    )
  }

  const { session, modules } = data

  // Some optional modules are off by default and have no row until first enabled —
  // surface them in the toggle list so the teacher can turn them on.
  const MODULE_ORDER = ['chatbot', 'self_assessment', 'notebook', 'boards', 'classification', 'chat', 'coding', 'models3d', 'models3d_ai', 'smart_canvas', 'chat_collaboration']
  const displayModules = [
    ...MODULE_ORDER
      .filter((k) => !modules.some((m) => m.module_key === k))
      .map((k) => ({ module_key: k, is_enabled: false })),
    ...modules,
  ].sort((left, right) => {
    const leftIndex = MODULE_ORDER.indexOf(left.module_key)
    const rightIndex = MODULE_ORDER.indexOf(right.module_key)
    return (leftIndex === -1 ? MODULE_ORDER.length : leftIndex) - (rightIndex === -1 ? MODULE_ORDER.length : rightIndex)
  })

  const statusConfig = {
    active: { dot: 'bg-emerald-500 animate-pulse', badge: 'bg-emerald-100 text-emerald-700', label: t('sessions.status_active') },
    paused: { dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700', label: t('sessions.status_paused') },
    ended:  { dot: 'bg-red-400',   badge: 'bg-red-100 text-red-700',     label: t('sessions.status_ended') },
    draft:  { dot: 'bg-slate-400', badge: 'bg-slate-100 text-slate-600', label: t('sessions.status_draft') },
  }
  const sc = statusConfig[session.status as keyof typeof statusConfig] ?? statusConfig.draft
  const joinCodeAvailable = session.status === 'active'

  return (
    <>
      {/* Demo mode slide-over */}
      {demoBotId && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="flex-1 bg-black/30" onClick={() => setDemoBotId(null)} />
          {/* Panel */}
          <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col h-full overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <MonitorPlay className="h-4 w-4 text-[#e85c8d]" />
                {t('teacher_chat.mode_image') === 'Image' ? 'Demo Mode' : tl("Modalità Demo")}
              </div>
              <button
                onClick={() => setDemoBotId(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden p-4">
              <TeacherbotTestChat
                teacherbotId={demoBotId}
                onBack={() => setDemoBotId(null)}
              />
            </div>
          </div>
        </div>
      )}

      <div>
        {/* Header */}
        <div className="ds-frame-header px-6 md:px-8 py-4">
          <div className="mx-auto flex max-w-6xl flex-col items-stretch gap-4 md:flex-row md:items-center md:justify-between">
            {/* Left: back + title */}
            <div className="flex items-center gap-3 min-w-0">
              <Link
                to="/teacher/classes"
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors flex-shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">{t('navbar.nav_classes')}</span>
              </Link>
              <span className="text-slate-300">/</span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-start gap-2">
                  <SectionHeading section="/teacher/classes" compact className="min-w-0 flex-1 break-words text-lg font-bold leading-tight text-slate-900" titleClassName="line-clamp-2" title={session.title}>{session.title}</SectionHeading>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${sc.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                    {sc.label}
                  </span>
                </div>
                <p className="mt-1 break-words text-sm leading-snug text-slate-500 line-clamp-2" title={[session.class_name, session.class_school_grade].filter(Boolean).join(' · ')}>
                  {session.class_name}
                  {session.class_school_grade && <span className="ml-2 text-slate-400">· {session.class_school_grade}</span>}
                </p>
              </div>
            </div>

            {/* Center: join code */}
            <div className="flex items-center justify-center gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-base)] px-3 py-2 shadow-[var(--shadow-sm)] md:justify-start">
              <span className="text-xs text-slate-500">{tl("Codice:")}</span>
              {joinCodeAvailable ? (
                <>
                  <code className="font-mono font-bold text-base text-slate-800 tracking-wider">{session.join_code}</code>
                  <button
                    onClick={() => copyCode(session.join_code)}
                    className="ml-1 text-slate-400 hover:text-slate-700 transition-colors"
                    title={tl("Copia codice")}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <span className="text-sm font-medium text-slate-400">
                  {session.status === 'paused' ? tl("Non disponibile in pausa") : tl("Codice dismesso")}
                </span>
              )}
            </div>

            {/* Right: actions */}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {session.status === 'draft' && (
                <Button size="sm" tone="accent" surface="solid" onClick={() => updateStatusMutation.mutate('active')}>
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  {tl("Avvia")}
                </Button>
              )}
              {session.status === 'active' && (
                <>
                  <Button size="sm" tone="neutral" surface="outline" onClick={() => updateStatusMutation.mutate('paused')}>
                    <Square className="h-3.5 w-3.5 mr-1.5" />
                    {tl("Pausa")}
                  </Button>
                  <Button size="sm" tone="danger" surface="outline" onClick={() => updateStatusMutation.mutate('ended')}>
                    {tl("Termina")}
                  </Button>
                </>
              )}
              {session.status === 'paused' && (
                <Button size="sm" tone="accent" surface="solid" onClick={() => updateStatusMutation.mutate('active')}>
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  {tl("Riprendi")}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Main control area — students live in the floating rail panel. */}
        <div className="mx-auto max-w-7xl px-4 py-5 md:px-6">
            <div className="min-w-0">

              <Tabs value={activeTab} onValueChange={setActiveTab} density="default" tone="neutral" className="mb-5">
                {/* Same material as the navbar selector: cluster track + ds-selected active tab. */}
                <TabsList
                  className="grid h-auto w-full grid-cols-2 gap-1 !border-0 p-1 sm:grid-cols-5"
                  style={{
                    borderRadius: 'var(--selection-radius)',
                    backgroundColor: 'var(--ds-navbar-cluster)',
                    backgroundImage: 'var(--ds-navbar-cluster-bg)',
                    boxShadow: 'var(--ds-shadow-cluster)',
                  }}
                >
                  {([
                    { key: 'modules', icon: Brain, label: tl("Moduli") },
                    { key: 'tasks',   icon: ClipboardList, label: t('teacher_dashboard.session_tasks') },
                    { key: 'documents', icon: FileText, label: tl("Documenti") },
                    { key: 'history', icon: History, label: t('teacher_dashboard.chat_history') },
                    { key: 'calls', icon: Video, label: tl("Chiamate") },
                  ] as { key: string; icon: React.FC<{ className?: string }>; label: string }[]).map(tab => (
                    <TabsTrigger
                      key={tab.key}
                      value={tab.key}
                      style={activeTab === tab.key ? {
                        backgroundColor: 'transparent',
                        backgroundImage: 'var(--ds-choice-bg)',
                        color: 'var(--ds-choice-ink)',
                        boxShadow: 'var(--ds-choice-ring-strong), var(--ds-choice-shadow)',
                        backdropFilter: 'var(--ds-choice-blur)',
                        WebkitBackdropFilter: 'var(--ds-choice-blur)',
                      } : undefined}
                      className={`min-h-[var(--selection-height)] gap-2 rounded-[var(--selection-radius)] border-0 px-[var(--selection-padding-x)] py-1.5 text-xs font-bold transition-all duration-150 ${activeTab === tab.key ? '' : 'bg-transparent text-slate-600 shadow-none hover:bg-[var(--ds-control-hover)] hover:text-[var(--selection-text)] hover:shadow-[var(--ds-shadow-1)]'}`}
                    >
                      <tab.icon className="h-4 w-4" />
                      <span>{tab.label}</span>
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {/* ── Moduli ── */}
              {activeTab === 'modules' && (
                <div className="space-y-4">

                  {/* Module toggles */}
                  <section className="ds-panel overflow-hidden rounded-[var(--ds-radius-panel)]">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-4 shadow-[inset_0_-1px_0_var(--ds-frame-divider)] sm:px-6">
                      <Brain className="h-[18px] w-[18px] text-[var(--logo-violet)]" />
                      <div className="min-w-0 flex-1">
                        <h2 className="text-base font-black text-slate-900">{tl("Moduli visibili agli studenti")}</h2>
                        <p className="text-xs text-slate-500">{tl("Attiva gli strumenti che gli studenti vedono nella sessione.")}</p>
                      </div>
                      <span className="rounded-full bg-[color-mix(in_srgb,var(--logo-violet)_10%,var(--mix-base))] px-2.5 py-1 text-[11px] font-bold text-[var(--logo-violet)]">
                        {displayModules.filter((mod) => mod.is_enabled).length} {tl("di")} {displayModules.length} {tl("attivi")}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 sm:p-5 lg:grid-cols-3 xl:grid-cols-4">
                      {displayModules.map((mod) => {
                        const cfg: Record<string, { icon: React.FC<{ className?: string }>; label: string; subtitle: string; desc: string }> = {
                          chatbot: {
                            icon: Bot,
                            label: tl("Chatbot AI"),
                            subtitle: tl("Tutor virtuale per lo studio"),
                            desc: tl("Assistente personale per lo studio individuale, il ripasso e il chiarimento dei dubbi sui contenuti."),
                          },
                          self_assessment: {
                            icon: ListChecks,
                            label: tl("Autovalutazione"),
                            subtitle: tl("Quiz e feedback immediato"),
                            desc: tl("Genera test e verifiche automatiche per tracciare la comprensione della classe in tempo reale."),
                          },
                          notebook: {
                            icon: FileCode2,
                            label: 'Coding Lab',
                            subtitle: tl("Ambiente Notebook"),
                            desc: tl("Spazio interattivo per eseguire codice Python, svolgere esercitazioni guidate e analizzare dati."),
                          },
                          boards: {
                            icon: SquareKanban,
                            label: 'Boards',
                            subtitle: tl("Gestione e organizzazione"),
                            desc: tl("Bacheca visiva per assegnare compiti, organizzare il lavoro della classe e tracciare l'avanzamento dei progetti."),
                          },
                          classification: {
                            icon: Brain,
                            label: tl("Classificazione ML"),
                            subtitle: tl("Modelli di Machine Learning"),
                            desc: tl("Ambiente pratico per addestrare e testare modelli di intelligenza artificiale su immagini, testi e dati."),
                          },
                          chat: {
                            icon: MessageSquare,
                            label: tl("Chat privata"),
                            subtitle: tl("Comunicazione 1 a 1"),
                            desc: tl("Spazio di messaggistica diretto per offrire supporto individuale e feedback riservato a ciascun studente."),
                          },
                          coding: {
                            icon: Code2,
                            label: 'Vibe Lab',
                            subtitle: tl("Generatore di Web App"),
                            desc: tl("Crea e progetta piccole applicazioni web tramite prompt di testo, con anteprima istantanea del codice."),
                          },
                          models3d: {
                            icon: Cube3DIcon,
                            label: '3D Lab',
                            subtitle: tl("Modellazione solida"),
                            desc: tl("Modellatore 3D in stile Tinkercad con assistente AI: gli studenti costruiscono oggetti ed esportano STL per la stampa 3D."),
                          },
                          smart_canvas: {
                            icon: CanvasEaselIcon,
                            label: tl("Lavagne intelligenti"),
                            subtitle: tl("Lavagne collaborative"),
                            desc: tl("Gli studenti vedono le lavagne condivise dal docente in tempo reale e possono crearne di proprie. Se il docente abilita la modifica, usano anche l’assistente AI."),
                          },
                          models3d_ai: {
                            icon: MushroomIcon,
                            label: tl("AI 3D"),
                            subtitle: tl("Modelli 3D generativi"),
                            desc: tl("Generazione di modelli 3D da un testo o da un’immagine con Meshy, pronti da scaricare e condividere in chat."),
                          },
                          chat_collaboration: {
                            icon: Users,
                            label: tl("Collaborazione chat"),
                            subtitle: tl("Lavoro di gruppo assistito"),
                            desc: tl("Spazio condiviso dove gli studenti collaborano in team interagendo insieme con lo stesso tutor AI."),
                          },
                        }
                        const c = cfg[mod.module_key] ?? { icon: Bot, label: mod.module_key, subtitle: '', desc: '' }
                        const ModIcon = c.icon
                        return (
                          <div
                            key={mod.module_key}
                            role="button"
                            tabIndex={0}
                            aria-pressed={mod.is_enabled}
                            aria-label={`${mod.is_enabled ? 'Disattiva' : 'Attiva'} ${c.label}`}
                            onClick={() => { if (!toggleModuleMutation.isPending) toggleModuleMutation.mutate({ moduleKey: mod.module_key, isEnabled: !mod.is_enabled }) }}
                            onKeyDown={(event) => {
                              if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) {
                                event.preventDefault()
                                if (!toggleModuleMutation.isPending) toggleModuleMutation.mutate({ moduleKey: mod.module_key, isEnabled: !mod.is_enabled })
                              }
                            }}
                            className={`ui-card-interactive group flex min-h-[168px] cursor-pointer flex-col rounded-[var(--ds-radius-control)] p-4 outline-none transition-colors focus-visible:shadow-[var(--ds-shadow-focus)] ${mod.is_enabled
                              ? 'bg-[color-mix(in_srgb,var(--logo-violet)_8%,var(--mix-base))] shadow-[var(--ds-shadow-1)]'
                              : 'bg-white/60 shadow-[var(--ds-shadow-inset)]'
                              }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${mod.is_enabled
                                ? 'bg-[var(--logo-violet)] shadow-[var(--ds-shadow-1)]'
                                : 'bg-slate-100'
                                }`}>
                                <ModIcon className={`h-5 w-5 ${mod.is_enabled ? 'text-white' : 'text-slate-400'}`} />
                              </div>
                              <div onClick={(event) => event.stopPropagation()}>
                                <Switch
                                  checked={mod.is_enabled}
                                  disabled={toggleModuleMutation.isPending}
                                  onCheckedChange={(isEnabled) => toggleModuleMutation.mutate({ moduleKey: mod.module_key, isEnabled })}
                                  aria-label={`${mod.is_enabled ? 'Disattiva' : 'Attiva'} ${c.label}`}
                                  className="h-[24px] w-[42px] bg-slate-200 peer-focus:ring-0 peer-checked:bg-[var(--logo-violet)] peer-disabled:cursor-wait peer-disabled:opacity-60 after:start-[4px] after:top-[3px] after:h-[18px] after:w-[18px] peer-checked:after:translate-x-[16px]"
                                />
                              </div>
                            </div>
                            <div className="mt-3 min-w-0">
                              <p className={`text-sm font-black ${mod.is_enabled ? 'text-slate-900' : 'text-slate-600'}`}>{c.label}</p>
                              <p className={`text-xs font-semibold ${mod.is_enabled ? 'text-[var(--logo-violet)]' : 'text-slate-400'}`}>{c.subtitle}</p>
                            </div>
                            <p className="mt-2 line-clamp-3 text-xs leading-[1.4] text-slate-500">{c.desc}</p>
                            <p className={`mt-auto pt-2 text-[10px] font-bold uppercase tracking-wide ${mod.is_enabled ? 'text-[var(--logo-violet)]' : 'text-slate-400'}`}>
                              {mod.is_enabled ? tl("Visibile agli studenti") : tl("Nascosto")}
                            </p>
                          </div>
                        )
                      })}
                    </div>
                  </section>

                  {/* Default LLM model */}
                  <section className="ds-panel rounded-[var(--ds-radius-panel)]">
                    <div className="flex items-center gap-3 px-5 py-4 shadow-[inset_0_-1px_0_var(--ds-frame-divider)] sm:px-6">
                      <Bot className="h-[18px] w-[18px] text-[var(--logo-violet)]" />
                      <div className="min-w-0">
                        <h2 className="text-base font-black text-slate-900">{tl("Modello AI predefinito")}</h2>
                        <p className="text-xs text-slate-500">{tl("Usato dagli strumenti AI degli studenti in questa sessione.")}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 p-4 sm:p-5">
                      <SearchableSelect className="w-full" label={tl("Modello AI predefinito")}
                        value={`${data.session.default_llm_provider || modelsData?.default_provider}|${data.session.default_llm_model || modelsData?.default_model}`}
                        disabled={updateDefaultModelMutation.isPending}
                        onChange={(value) => { const [provider, model] = value.split('|'); updateDefaultModelMutation.mutate({ provider, model }) }}
                        options={(modelsData?.models || []).map((m) => ({ value: `${m.provider}|${m.model}`, label: m.name, description: m.provider, searchText: m.model }))} />
                    </div>
                  </section>
                </div>
              )}

              {/* ── Compiti ── */}
              {activeTab === 'tasks' && (
                <TasksPanel sessionId={sessionId!} tasks={tasksData} studentCount={data?.students?.length ?? 0} />
              )}

              {/* ── Documenti ── */}
              {activeTab === 'documents' && (
                <SessionDocumentsPanel documents={documentsData} />
              )}

              {/* ── Chiamate: log delle videochiamate, registrazioni e strumenti AI ── */}
              {activeTab === 'calls' && <SessionCallsPanel sessionId={sessionId!} />}

              {/* ── Storico ── */}
              {activeTab === 'history' && (
                <>
                  <div className="mb-3 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setShowPedagogicalAnalysis(value => !value)}
                      className={`app-button-chrome flex items-center gap-2 rounded-full px-3.5 py-2 text-xs ${showPedagogicalAnalysis ? 'app-button-chrome-active' : 'app-button-chrome-quiet'}`}
                      aria-expanded={showPedagogicalAnalysis}
                    >
                      <Brain className="h-3.5 w-3.5" />
                      {tl("Analisi pedagogica")}
                      {showPedagogicalAnalysis ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  {showPedagogicalAnalysis && <AnalyticsPanel sessionId={sessionId!} socket={socket} />}
                  <ConversationHistoryView
                    sessionId={sessionId!}
                    selectedConversationId={selectedConversationId}
                    onSelectConversation={setSelectedConversationId}
                    socket={socket}
                  />
                </>
              )}
            </div>
          </div>
        </div>
    </>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function SessionDocumentsPanel({ documents }: { documents: SharedDocumentData[] }) {
  const navigate = useNavigate()
  const location = useLocation()
  const [studentDocsCollapsed, setStudentDocsCollapsed] = useState(false)
  const [documentSearch, setDocumentSearch] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'student' | 'teacher'>('all')
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'az' | 'za'>('newest')
  const visibleDocuments = useMemo(() => {
    const sourceFiltered = sourceFilter === 'all'
      ? documents
      : documents.filter((doc) => doc.source === sourceFilter)
    const terms = documentSearch.trim().toLocaleLowerCase('it').split(/\s+/).filter(Boolean)
    const filtered = terms.length === 0
      ? sourceFiltered
      : sourceFiltered.filter((doc) => {
          const searchableText = [doc.title, doc.author_name, doc.doc_type]
            .join(' ')
            .toLocaleLowerCase('it')
          return terms.every((term) => searchableText.includes(term))
        })
    return [...filtered].sort((left, right) => {
      if (sortOrder === 'az' || sortOrder === 'za') {
        const comparison = left.title.localeCompare(right.title, 'it', { sensitivity: 'base' })
        return sortOrder === 'az' ? comparison : -comparison
      }
      const comparison = new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime()
      return sortOrder === 'oldest' ? comparison : -comparison
    })
  }, [documentSearch, documents, sortOrder, sourceFilter])
  const teacherDocuments = visibleDocuments.filter((doc) => doc.source === 'teacher')
  const studentDocuments = visibleDocuments.filter((doc) => doc.source === 'student')
  const formatPublishedAt = (value: string) =>
    new Date(value).toLocaleString('it-IT', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  const openDocument = (doc: SharedDocumentData) => {
    const documentReturnTo = `${location.pathname}${location.search}`
    navigate(`/teacher/documents?open=${encodeURIComponent(doc.id)}&returnTo=${encodeURIComponent(documentReturnTo)}`, {
      state: { documentReturnTo },
    })
  }
  const renderCard = (doc: SharedDocumentData) => (
    <button
      key={doc.id}
      type="button"
      onClick={() => openDocument(doc)}
      className="group rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${doc.source === 'student' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
          <FileText className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800">{doc.title}</p>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
            <User className="h-3 w-3" />
            {tl("Autore:")} {doc.author_name}
          </p>
          <p className="mt-1 text-[10px] text-slate-400">
            {doc.doc_type || tl("documento")} · {formatPublishedAt(doc.updated_at)}
          </p>
        </div>
      </div>
    </button>
  )

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <FileText className="h-4 w-4 text-slate-500" />
        <span className="text-sm font-semibold text-slate-800">{tl("Documenti")}</span>
        <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500">
          {visibleDocuments.length === documents.length
            ? documents.length
            : `${visibleDocuments.length}/${documents.length}`}
        </span>
      </div>
      <div className="space-y-5 p-4">
        {documents.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            {tl("Nessun documento condiviso o inviato in questa sessione.")}
          </p>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={documentSearch}
                onChange={(event) => setDocumentSearch(event.target.value)}
                placeholder={tl("Cerca per titolo, autore o tipo…")}
                aria-label={tl("Cerca documenti per titolo, autore o tipo")}
                className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-10 text-sm text-slate-700 outline-none placeholder:text-slate-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
              />
              {documentSearch && (
                <button
                  type="button"
                  onClick={() => setDocumentSearch('')}
                  aria-label={tl("Cancella ricerca documenti")}
                  className="absolute right-2.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center">
              <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold text-slate-600">
                <Filter className="h-4 w-4 shrink-0 text-slate-400" />
                <span>{tl("Filtra")}</span>
                <select
                  value={sourceFilter}
                  onChange={(event) => setSourceFilter(event.target.value as typeof sourceFilter)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="all">{tl("Tutti")}</option>
                  <option value="student">{tl("Studenti")}</option>
                  <option value="teacher">{tl("Docente")}</option>
                </select>
              </label>
              <label className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold text-slate-600">
                <ArrowUpDown className="h-4 w-4 shrink-0 text-slate-400" />
                <span>{tl("Ordina")}</span>
                <select
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as typeof sortOrder)}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs font-semibold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
                >
                  <option value="newest">{tl("Più recenti")}</option>
                  <option value="oldest">{tl("Meno recenti")}</option>
                  <option value="az">{tl("Titolo A–Z")}</option>
                  <option value="za">{tl("Titolo Z–A")}</option>
                </select>
              </label>
            </div>

            {visibleDocuments.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-400">
                {tl("Nessun documento corrisponde alla ricerca e ai filtri selezionati.")}
              </div>
            )}

            {sourceFilter !== 'teacher' && visibleDocuments.length > 0 && (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-[10px] font-bold uppercase tracking-widest text-emerald-700">{tl("Condivisi dagli studenti")}</h3>
                  <p className="mt-1 text-xs text-emerald-700/70">{studentDocuments.length} {tl("documenti ricevuti")}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setStudentDocsCollapsed(value => !value)}
                  className="rounded-full bg-white/80 px-3 py-1.5 text-[11px] font-bold text-emerald-700 shadow-sm ring-1 ring-emerald-100 transition-colors hover:bg-white"
                >
                  {studentDocsCollapsed ? tl("Espandi") : tl("Comprimi")}
                </button>
              </div>
              {studentDocuments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-emerald-200 bg-white/55 px-4 py-5 text-center text-xs text-emerald-700/60">
                  {tl("Nessun documento inviato dagli studenti.")}
                </div>
              ) : studentDocsCollapsed ? (
                <div className="flex min-h-10 items-center gap-2 overflow-x-auto rounded-xl bg-white/65 px-2 py-2">
                  {studentDocuments.map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => openDocument(doc)}
                      title={`${doc.title} · ${doc.author_name}`}
                      className="flex h-9 max-w-56 shrink-0 items-center gap-2 rounded-lg bg-emerald-100 px-2.5 text-emerald-800 shadow-sm transition-transform hover:-translate-y-0.5"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      <span className="min-w-0 truncate text-left text-[11px] font-bold">{doc.title}</span>
                      <span className="max-w-20 truncate text-[10px] text-emerald-700/70">{doc.author_name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {studentDocuments.map(renderCard)}
                </div>
              )}
            </section>
            )}
            {sourceFilter !== 'student' && visibleDocuments.length > 0 && (
            <section>
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">{tl("Condivisi dal docente")}</h3>
              {teacherDocuments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 px-4 py-5 text-center text-xs text-slate-400">
                  {tl("Nessun documento docente in questa sessione.")}
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {teacherDocuments.map(renderCard)}
                </div>
              )}
            </section>
            )}
            {visibleDocuments.length > 0 && (
            <section>
              <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">{tl("Tutti i documenti")}</h3>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                {visibleDocuments.map((doc) => (
                  <button
                    key={`list-${doc.id}`}
                    type="button"
                    onClick={() => openDocument(doc)}
                    className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-left last:border-b-0 hover:bg-slate-50"
                  >
                    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${doc.source === 'student' ? 'bg-emerald-100 text-emerald-700' : 'bg-indigo-100 text-indigo-700'}`}>
                      <FileText className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-slate-800">{doc.title}</p>
                      <p className="truncate text-[10px] text-slate-500">
                        {doc.source === 'student' ? tl("Studente") : tl("Docente")} · {doc.author_name}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] font-medium text-slate-400">
                      {formatPublishedAt(doc.updated_at)}
                    </span>
                  </button>
                ))}
              </div>
            </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

interface ConversationData {
  id: string
  student_id: string
  student_nickname: string
  profile_key: string
  title: string | null
  llm_provider: string | null
  llm_model: string | null
  message_count: number
  created_at: string
  updated_at: string
}

interface MessageData {
  id: string
  role: string
  content: string | null
  content_json?: { files?: { filename?: string; mime_type?: string }[] } | null
  provider: string | null
  model: string | null
  created_at: string
  token_usage_json?: TokenUsageJson | null
}

// The history is the teacher's record of what students did: keep it fresh even without socket events.
const HISTORY_LIST_REFRESH_MS = 15000
const HISTORY_MESSAGES_REFRESH_MS = 10000

interface TeacherbotConvData {
  id: string
  student_id: string
  student_nickname: string
  teacherbot_id: string
  teacherbot_name: string
  teacherbot_color: string
  message_count: number
  created_at: string
  updated_at: string
}

const STOP_WORDS = new Set(['il', 'la', 'lo', 'i', 'le', 'gli', 'un', 'una', 'uno', 'di', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra', 'e', 'o', 'ma', 'se', 'che', 'come', 'cosa', 'the', 'a', 'an', 'is', 'it', 'of', 'to', 'and', 'or', 'how', 'what', 'mi', 'ti', 'si', 'ci', 'vi', 'me', 'te', 'non', 'ho', 'ha', 'hai', 'del', 'dei', 'delle', 'degli', 'al', 'ai', 'alle', 'agli', 'nel', 'nei', 'nelle', 'negli', 'dal', 'dai'])

function AnalyticsPanel({ sessionId, socket }: { sessionId: string; socket: Socket | null }) {
  const queryClient = useQueryClient()
  const { data: conversations } = useQuery<ConversationData[]>({
    queryKey: ['session-conversations', sessionId],
    queryFn: async () => {
      const res = await llmApi.getSessionConversations(sessionId)
      return res.data
    },
    // No polling — updates come via socket
  })

  // Socket: invalidate conversations when new ones arrive or get updated
  useEffect(() => {
    if (!socket) return
    const invalidate = () => queryClient.invalidateQueries({ queryKey: ['session-conversations', sessionId] })
    socket.on('conversation_created', invalidate)
    socket.on('conversation_updated', invalidate)
    return () => {
      socket.off('conversation_created', invalidate)
      socket.off('conversation_updated', invalidate)
    }
  }, [socket, sessionId, queryClient])

  // ALL hooks must be before any conditional return — memoize on the possibly-empty array
  const studentActivity = useMemo(() => {
    if (!conversations || conversations.length === 0) return []
    return Object.values(
      conversations.reduce((acc, conv) => {
        if (!acc[conv.student_id]) {
          acc[conv.student_id] = { nickname: conv.student_nickname, messageCount: 0, convCount: 0 }
        }
        acc[conv.student_id].messageCount += conv.message_count
        acc[conv.student_id].convCount += 1
        return acc
      }, {} as Record<string, { nickname: string; messageCount: number; convCount: number }>)
    ).sort((a, b) => b.messageCount - a.messageCount).slice(0, 5)
  }, [conversations])

  const { topWords, maxFreq } = useMemo(() => {
    if (!conversations || conversations.length === 0) return { topWords: [], maxFreq: 1 }
    const wordFreq: Record<string, number> = {}
    conversations.forEach(conv => {
      if (!conv.title) return
      conv.title.toLowerCase().split(/\s+/).forEach(word => {
        const clean = word.replace(/[^a-zA-ZàèéìòùÀÈÉÌÒÙ]/g, '')
        if (clean.length > 3 && !STOP_WORDS.has(clean)) {
          wordFreq[clean] = (wordFreq[clean] || 0) + 1
        }
      })
    })
    const top = Object.entries(wordFreq).sort((a, b) => b[1] - a[1]).slice(0, 20)
    return { topWords: top, maxFreq: top[0]?.[1] || 1 }
  }, [conversations])

  if (!conversations || conversations.length === 0) return null

  return (
    <Card className="mb-4 border-indigo-100">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Brain className="h-4 w-4 text-indigo-500" />
          {tl("Analisi Pedagogica")}
          <span className="text-xs font-normal text-slate-400 ml-1">{conversations.length} {tl("conversazioni •")} {Object.keys(studentActivity).length} {tl("studenti")}</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Student activity ranking */}
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{tl("Studenti più attivi")}</h4>
            <div className="space-y-2.5">
              {studentActivity.map((s, i) => (
                <div key={s.nickname} className="flex items-center gap-2">
                  <span className="text-xs text-slate-300 w-4 font-mono">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-sm text-slate-700 font-medium">{s.nickname}</span>
                      <span className="text-xs text-slate-400">{s.messageCount} msg · {s.convCount} conv</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-indigo-400"
                        style={{ width: `${(s.messageCount / (studentActivity[0]?.messageCount || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Argomenti frequenti (tag cloud) */}
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">{tl("Argomenti frequenti")}</h4>
            <div className="flex flex-wrap gap-1.5">
              {topWords.map(([word, count]) => (
                <span
                  key={word}
                  className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 cursor-default"
                  style={{
                    fontSize: `${Math.max(10, Math.min(16, 10 + (count / maxFreq) * 6))}px`,
                    opacity: 0.4 + (count / maxFreq) * 0.6,
                  }}
                  title={`${count} occorrenze`}
                >
                  {word}
                </span>
              ))}
              {topWords.length === 0 && (
                <p className="text-xs text-slate-400">{tl("Nessun titolo disponibile per l'analisi")}</p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

interface ConversationHistoryViewProps {
  sessionId: string
  selectedConversationId: string | null
  onSelectConversation: (id: string | null) => void
  socket: Socket | null
}

// Profile key → gradient color class
const PROFILE_COLORS: Record<string, string> = {
  tutor:       'bg-gradient-to-br from-violet-500 to-purple-600',
  socratico:   'bg-gradient-to-br from-amber-500 to-orange-500',
  coach:       'bg-gradient-to-br from-emerald-500 to-teal-600',
  critico:     'bg-gradient-to-br from-rose-500 to-red-600',
  esploratore: 'bg-gradient-to-br from-sky-500 to-cyan-600',
  narratore:   'bg-gradient-to-br from-fuchsia-500 to-pink-600',
  oggi_imparo: 'bg-gradient-to-br from-indigo-500 to-violet-600',
}
const profileColor = (key: string) => PROFILE_COLORS[key.toLowerCase()] ?? 'bg-gradient-to-br from-sky-500 to-blue-600'

const TB_COLOR_MAP: Record<string, string> = {
  indigo: 'bg-[#181b1e]', blue: 'bg-blue-500', green: 'bg-green-500',
  purple: 'bg-purple-500', pink: 'bg-pink-500', orange: 'bg-orange-500',
  teal: 'bg-teal-500', cyan: 'bg-cyan-500', red: 'bg-red-500',
}
const tbColor = (color: string) => TB_COLOR_MAP[color] ?? 'bg-slate-700'

function ConversationHistoryView({ sessionId, selectedConversationId, onSelectConversation, socket }: ConversationHistoryViewProps) {
  const queryClient = useQueryClient()
  const [historyTab, setHistoryTab] = useState<'chatbot' | 'teacherbot' | 'learning'>('chatbot')
  const [expandedStudents, setExpandedStudents] = useState<Set<string>>(new Set())
  const [selectedTBConvId, setSelectedTBConvId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const toggleStudent = (studentId: string) => {
    setExpandedStudents(prev => {
      const next = new Set(prev)
      if (next.has(studentId)) next.delete(studentId)
      else next.add(studentId)
      return next
    })
  }

  const { data: conversations, isLoading: loadingConversations } = useQuery<ConversationData[]>({
    queryKey: ['session-conversations', sessionId],
    queryFn: async () => {
      const res = await llmApi.getSessionConversations(sessionId)
      return res.data
    },
    refetchInterval: HISTORY_LIST_REFRESH_MS,
    refetchOnWindowFocus: true,
  })

  // Teacherbot conversations for this session
  const { data: tbConversations, isLoading: loadingTBConversations } = useQuery<TeacherbotConvData[]>({
    queryKey: ['session-tb-conversations', sessionId],
    queryFn: async () => {
      const res = await teacherbotsApi.getSessionConversations(sessionId)
      return res.data
    },
    refetchInterval: HISTORY_LIST_REFRESH_MS,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    const source = historyTab === 'teacherbot' ? (tbConversations ?? []) : (conversations ?? [])
    const firstStudentId = source[0]?.student_id
    if (!firstStudentId) return
    setExpandedStudents(current => current.size === 0 ? new Set([firstStudentId]) : current)
  }, [conversations, historyTab, tbConversations])

  // Selected teacherbot conv — fetch its messages
  const selectedTBConv = (tbConversations ?? []).find(c => c.id === selectedTBConvId)
  const { data: tbMessages, isLoading: loadingTBMessages } = useQuery<MessageData[]>({
    queryKey: ['tb-conv-messages', selectedTBConvId],
    queryFn: async () => {
      const res = await teacherbotsApi.getTeacherConvMessages(selectedTBConv!.teacherbot_id, selectedTBConvId!)
      return res.data
    },
    enabled: !!selectedTBConvId && !!selectedTBConv,
    refetchInterval: HISTORY_MESSAGES_REFRESH_MS,
    refetchOnWindowFocus: true,
  })

  const { data: messages, isLoading: loadingMessages } = useQuery<MessageData[]>({
    queryKey: ['conversation-messages', selectedConversationId],
    queryFn: async () => {
      const res = await llmApi.getConversationMessages(selectedConversationId!)
      return res.data
    },
    enabled: !!selectedConversationId,
    refetchInterval: HISTORY_MESSAGES_REFRESH_MS,
    refetchOnWindowFocus: true,
  })

  // Scroll to bottom when a conversation opens or grows (not on every identical background refresh)
  const shownMessages = historyTab === 'teacherbot' ? tbMessages : messages
  const shownKey = `${historyTab === 'teacherbot' ? selectedTBConvId : selectedConversationId}:${shownMessages?.length ?? 0}`
  useEffect(() => {
    if (shownMessages && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey])

  // Socket: real-time updates
  useEffect(() => {
    if (!socket) return
    const handleConvCreated = (conv: ConversationData) => {
      queryClient.setQueryData(['session-conversations', sessionId], (old: ConversationData[] | undefined) => {
        if (!old) return [conv]
        if (old.find(c => c.id === conv.id)) return old
        return [conv, ...old]
      })
    }
    const handleConvUpdated = (d: { conversation_id: string; message_count: number; updated_at: string }) => {
      queryClient.setQueryData(['session-conversations', sessionId], (old: ConversationData[] | undefined) =>
        old?.map(c => c.id === d.conversation_id ? { ...c, message_count: d.message_count, updated_at: d.updated_at } : c)
      )
      if (d.conversation_id === selectedConversationId) {
        queryClient.invalidateQueries({ queryKey: ['conversation-messages', selectedConversationId] })
      }
    }
    socket.on('conversation_created', handleConvCreated)
    socket.on('conversation_updated', handleConvUpdated)
    return () => {
      socket.off('conversation_created', handleConvCreated)
      socket.off('conversation_updated', handleConvUpdated)
    }
  }, [socket, sessionId, selectedConversationId, queryClient])

  // Chatbot conversations grouped by student
  const chatbotConversations = (conversations ?? []).filter(c => !c.profile_key.startsWith('teacherbot-'))
  const learningConversations = chatbotConversations.filter(c => c.profile_key === 'oggi_imparo')
  const aiConversations = chatbotConversations.filter(c => c.profile_key !== 'oggi_imparo')

  const selectedConversation = conversations?.find(c => c.id === selectedConversationId)
  const avatarColor = selectedConversation ? profileColor(selectedConversation.profile_key) : 'bg-gradient-to-br from-sky-500 to-blue-600'

  const mapMessages = (msgs: MessageData[]) => msgs.map(msg => ({
    id: msg.id,
    role: msg.role as 'user' | 'assistant',
    content: msg.content ?? '',
    timestamp: new Date(msg.created_at),
    provider: msg.provider ?? undefined,
    model: msg.model ?? undefined,
    token_usage_json: msg.token_usage_json ?? null,
    files: (msg.content_json?.files ?? []).filter(file => file && (file.filename || file.mime_type)),
  }))

  const groupByStudent = (convs: ConversationData[]) =>
    convs.reduce((acc, conv) => {
      if (!acc[conv.student_id]) acc[conv.student_id] = { nickname: conv.student_nickname, conversations: [] }
      acc[conv.student_id].conversations.push(conv)
      return acc
    }, {} as Record<string, { nickname: string; conversations: ConversationData[] }>)

  const groupTBByStudent = (convs: TeacherbotConvData[]) =>
    convs.reduce((acc, conv) => {
      if (!acc[conv.student_id]) acc[conv.student_id] = { nickname: conv.student_nickname, conversations: [] }
      acc[conv.student_id].conversations.push(conv)
      return acc
    }, {} as Record<string, { nickname: string; conversations: TeacherbotConvData[] }>)

  // Active data for the current tab
  const activeConvs = historyTab === 'chatbot' ? aiConversations : learningConversations
  const byStudent = groupByStudent(activeConvs)
  const tbByStudent = groupTBByStudent(tbConversations ?? [])

  // The currently selected conv's data and messages (chatbot or teacherbot)
  const activeMsgs = historyTab === 'teacherbot'
    ? mapMessages(tbMessages ?? [])
    : mapMessages(messages ?? [])
  const isLoadingActiveMsgs = historyTab === 'teacherbot' ? loadingTBMessages : loadingMessages

  const TAB_CONFIG = [
    { key: 'chatbot' as const, label: tl("Chatbot AI"), icon: Bot,          count: aiConversations.length },
    { key: 'teacherbot' as const, label: 'Teacherbot', icon: User,       count: (tbConversations ?? []).length },
    { key: 'learning' as const, label: tl("Apprendimento"), icon: BookOpen,  count: learningConversations.length },
  ]

  return (
    <div className="flex min-h-[660px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm lg:h-[calc(100vh-270px)] lg:min-h-[560px] lg:flex-row">

      {/* ── Left panel ── */}
      <div className="flex max-h-96 w-full flex-shrink-0 flex-col border-b border-slate-200 bg-white lg:max-h-none lg:w-96 lg:border-b-0 lg:border-r">

        <div className="flex items-center gap-2 px-4 pb-1 pt-4">
          <Search className="h-4 w-4 text-slate-400" />
          <div>
            <p className="text-sm font-bold text-slate-800">{tl("Esplora conversazioni")}</p>
            <p className="text-[11px] text-slate-400">{tl("Seleziona uno studente e apri una chat")}</p>
          </div>
        </div>

        {/* Conversation type dropdown */}
        <div className="m-3 flex-shrink-0">
          <label htmlFor="history-conversation-type" className="mb-1.5 block text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
            {tl("Tipo di conversazione")}
          </label>
          <div className="relative">
            <select
              id="history-conversation-type"
              value={historyTab}
              onChange={(event) => {
                setHistoryTab(event.target.value as typeof historyTab)
                onSelectConversation(null)
                setSelectedTBConvId(null)
              }}
              className="ui-control-label h-10 w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-3 pr-10 text-slate-700 outline-none transition-colors hover:border-slate-300 focus:border-[color:var(--selection-border-hover)] focus:ring-2 focus:ring-[color:var(--selection-border)]"
            >
              {TAB_CONFIG.map(tab => (
                <option key={tab.key} value={tab.key}>{tab.label} ({tab.count})</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Chatbot / Learning tabs ── */}
          {(historyTab === 'chatbot' || historyTab === 'learning') && (
            (loadingConversations)
              ? <div className="p-4 text-xs text-slate-400 text-center">{tl("Caricamento…")}</div>
              : Object.keys(byStudent).length === 0
                ? <div className="p-4 text-xs text-slate-400 text-center">{tl("Nessuna conversazione")}</div>
                : Object.entries(byStudent).map(([studentId, { nickname, conversations: convs }]) => {
                    const isExpanded = expandedStudents.has(studentId)
                    const hasSelected = convs.some(c => c.id === selectedConversationId)
                    return (
                      <div key={studentId} className="border-b border-slate-100 last:border-b-0">
                        <button
                          onClick={() => toggleStudent(studentId)}
                          className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${hasSelected ? 'bg-[var(--brand-pill-lavender)]/45' : ''}`}
                        >
                          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-slate-600 to-slate-700 text-xs font-bold text-white">
                            {nickname.charAt(0).toUpperCase()}
                          </div>
                          <span className="flex-1 truncate text-sm font-semibold text-slate-800">{nickname}</span>
                          <span className="mr-0.5 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{convs.length}</span>
                          {isExpanded ? <ChevronUp className="h-3 w-3 text-slate-400 flex-shrink-0" /> : <ChevronDown className="h-3 w-3 text-slate-400 flex-shrink-0" />}
                        </button>
                        {isExpanded && convs.map((conv) => {
                          const isActive = selectedConversationId === conv.id
                          const color = profileColor(conv.profile_key)
                          return (
                            <button key={conv.id} onClick={() => onSelectConversation(conv.id)}
                              className={`flex w-full items-center gap-3 border-l-2 px-4 py-2.5 pl-6 text-left transition-colors ${isActive ? 'border-l-violet-500 bg-violet-50/60' : 'border-l-transparent hover:bg-slate-50 hover:border-l-slate-300'}`}
                            >
                              <div className={`w-5 h-5 rounded-md ${color} flex items-center justify-center flex-shrink-0`}>
                                <Bot className="h-2.5 w-2.5 text-white" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="truncate text-xs font-semibold capitalize text-slate-700">{conv.title || conv.profile_key}</p>
                                <p className="text-[11px] text-slate-400">{conv.message_count} {tl("messaggi ·")} {new Date(conv.updated_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}</p>
                              </div>
                              {isActive && <ChevronRight className="h-3 w-3 text-violet-400 flex-shrink-0" />}
                            </button>
                          )
                        })}
                      </div>
                    )
                  })
          )}

          {/* ── Teacherbot tab ── */}
          {historyTab === 'teacherbot' && (
            (loadingTBConversations)
              ? <div className="p-4 text-xs text-slate-400 text-center">{tl("Caricamento…")}</div>
              : Object.keys(tbByStudent).length === 0
                ? <div className="p-4 text-xs text-slate-400 text-center">{tl("Nessuna conversazione teacherbot")}</div>
                : Object.entries(tbByStudent).map(([studentId, { nickname, conversations: convs }]) => {
                    const isExpanded = expandedStudents.has(studentId)
                    const hasSelected = convs.some(c => c.id === selectedTBConvId)
                    const latestConv = [...convs].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
                    return (
                      <div key={studentId} className="border-b border-slate-100 last:border-b-0">
                        <button
                          onClick={() => toggleStudent(studentId)}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors ${hasSelected ? 'bg-slate-100' : 'hover:bg-slate-100'}`}
                        >
                          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 text-[10px] font-bold text-white">
                            {nickname.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="truncate text-xs font-semibold text-slate-800">{nickname}</span>
                              <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">
                                {convs.length} {tl("chat")}
                              </span>
                            </div>
                            {latestConv && (
                              <p className="truncate text-[10px] text-slate-400">
                                {tl("Ultima attivita")} {new Date(latestConv.updated_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                              </p>
                            )}
                          </div>
                          {isExpanded ? <ChevronUp className="h-3 w-3 flex-shrink-0 text-slate-400" /> : <ChevronDown className="h-3 w-3 flex-shrink-0 text-slate-400" />}
                        </button>
                        {isExpanded && (
                          <div>
                            {convs.map((conv) => {
                          const isActive = selectedTBConvId === conv.id
                          const color = tbColor(conv.teacherbot_color)
                          return (
                            <button
                              key={conv.id}
                              onClick={() => setSelectedTBConvId(conv.id)}
                              className={`flex w-full items-center gap-2 border-l-2 px-3 py-1.5 pl-4 text-left transition-colors ${
                                isActive
                                  ? 'border-l-violet-500 bg-white'
                                  : 'border-l-transparent hover:border-l-slate-300 hover:bg-white'
                              }`}
                            >
                              <div className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md ${color}`}>
                                <Bot className="h-2.5 w-2.5 text-white" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="truncate text-[11px] font-semibold text-slate-700">{conv.teacherbot_name}</p>
                                  {isActive && (
                                    <span className="rounded-full bg-violet-600 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wide text-white">
                                      {tl("Aperta")}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-slate-400">
                                  {conv.message_count} msg · {new Date(conv.updated_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}
                                </p>
                              </div>
                              <ChevronRight className={`h-3 w-3 flex-shrink-0 ${isActive ? 'text-violet-500' : 'text-slate-300'}`} />
                            </button>
                          )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })
          )}
        </div>
      </div>

      {/* ── Right panel: chat view ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {(() => {
          const activeId = historyTab === 'teacherbot' ? selectedTBConvId : selectedConversationId
          const activeName = historyTab === 'teacherbot' ? selectedTBConv?.student_nickname : selectedConversation?.student_nickname
          const activeSubtitle = historyTab === 'teacherbot' ? selectedTBConv?.teacherbot_name : selectedConversation?.profile_key
          const activeCount = historyTab === 'teacherbot' ? selectedTBConv?.message_count : selectedConversation?.message_count
          const activeAvatarColor = historyTab === 'teacherbot'
            ? tbColor(selectedTBConv?.teacherbot_color ?? 'indigo')
            : avatarColor
          const onClose = historyTab === 'teacherbot'
            ? () => setSelectedTBConvId(null)
            : () => onSelectConversation(null)

          if (!activeId) return (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-400 bg-slate-50/50">
              <Bot className="h-10 w-10 opacity-20" />
              <p className="text-sm">{tl("Seleziona una conversazione dalla lista")}</p>
            </div>
          )

          return (
            <>
              <div className="flex-shrink-0 px-5 py-3 border-b border-slate-200 bg-white flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl ${activeAvatarColor} flex items-center justify-center shadow-md flex-shrink-0`}>
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-slate-800 truncate">{activeName}</p>
                  <p className="text-xs text-slate-500 capitalize">{activeSubtitle}</p>
                </div>
                <span className="text-xs text-slate-400">{activeCount} {tl("messaggi")}</span>
                <button onClick={onClose} className="ml-2 h-7 w-7 rounded-full flex items-center justify-center hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4 bg-slate-50">
                {isLoadingActiveMsgs ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                ) : activeMsgs.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-slate-400 text-sm">
                    {tl("Nessun messaggio in questa conversazione.")}
                  </div>
                ) : (
                  activeMsgs.map((msg, index) => {
                    const time = msg.timestamp.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
                    const previous = activeMsgs[index - 1]
                    const showDay = !previous || previous.timestamp.toDateString() !== msg.timestamp.toDateString()
                    return (
                    <div key={msg.id}>
                      {showDay && (
                        <div className="my-2 flex justify-center">
                          <span className="rounded-full bg-white px-3 py-0.5 text-[10px] font-semibold text-slate-400 shadow-sm">
                            {msg.timestamp.toLocaleDateString('it-IT', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                          </span>
                        </div>
                      )}
                      {/* Student label above user messages */}
                      {msg.role === 'user' ? (
                        <div className="flex justify-end mb-1 pr-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-slate-400">{time}</span>
                            <span className="text-[11px] font-semibold text-slate-500">{activeName}</span>
                            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                              {activeName?.charAt(0).toUpperCase() ?? 'S'}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="mb-1 pl-11 text-[10px] text-slate-400">{time}</div>
                      )}
                      <MessageBubble
                        message={msg}
                        avatarColorClass={activeAvatarColor}
                        isCopied={copiedId === msg.id}
                        onCopy={() => {
                          navigator.clipboard.writeText(msg.content)
                          setCopiedId(msg.id)
                          setTimeout(() => setCopiedId(null), 2000)
                        }}
                      />
                      {msg.files.length > 0 && (
                        <div className={`mt-1 flex flex-wrap gap-1 ${msg.role === 'user' ? 'justify-end pr-1' : 'pl-11'}`}>
                          {msg.files.map((file, fileIndex) => (
                            <span key={fileIndex} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500 shadow-sm">
                              📎 {file.filename && file.filename !== 'blob' ? file.filename : (file.mime_type?.startsWith('image/') ? tl("Immagine allegata") : tl("File allegato"))}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    )
                  })
                )}
                <div ref={messagesEndRef} />
              </div>
            </>
          )
        })()}
      </div>
    </div>
  )
}
