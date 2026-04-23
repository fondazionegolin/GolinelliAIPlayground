import { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Socket } from 'socket.io-client'
import { teacherApi, teacherbotsApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import {
  ArrowLeft, Users, Copy, Play, Square,
  Snowflake, Sun, Bot, Brain, MessageSquare,
  ClipboardList, Plus, Trash2, Check, Eye, ChevronDown, ChevronUp, History, User, BookOpen, Search, X,
  MonitorPlay, Send, ChevronRight, LayoutGrid, List
} from 'lucide-react'
import { llmApi } from '@/lib/api'
import TaskBuilder from '@/components/TaskBuilder'
import TeacherbotTestChat from '@/components/teacher/TeacherbotTestChat'
import { MessageBubble } from '@/components/student/ChatConversationView'
import type { TokenUsageJson } from '@/lib/environmentalImpact'
// TeacherNotifications removed per redesign
import { useSocket } from '@/hooks/useSocket'
import { useAuthStore } from '@/stores/auth'

interface StudentData {
  id: string
  nickname: string
  is_frozen: boolean
  joined_at: string
  last_activity_at: string | null
}

interface TaskData {
  id: string
  title: string
  description: string | null
  task_type: string
  status: string
  due_at: string | null
  points: string | null
  content_json?: string | null
  created_at: string
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
  const navigate = useNavigate()
  const { toast } = useToast()
  useAuthStore() // Keep store connection for auth state
  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState(() => {
    const tab = searchParams.get('tab')
    return tab === 'tasks' || tab === 'history' ? tab : 'modules'
  })

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab === 'tasks' || tab === 'history') setActiveTab(tab)
  }, [searchParams])
  const [showOfflineStudents, setShowOfflineStudents] = useState(false)
  const [showTaskBuilder, setShowTaskBuilder] = useState(false)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [taskSearch, setTaskSearch] = useState('')
  const [taskViewMode, setTaskViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)

  // Demo mode: teacherbot slide-over
  const [demoBotId, setDemoBotId] = useState<string | null>(null)

  // Per-student push: which student has the bot picker open
  const [pushBotStudentId, setPushBotStudentId] = useState<string | null>(null)
  const pushPopoverRef = useRef<HTMLDivElement>(null)

  // Fetch teacher's teacherbots for demo mode and push
  const { data: teacherbots } = useQuery({
    queryKey: ['teacherbots'],
    queryFn: async () => {
      const res = await teacherbotsApi.list()
      return res.data as { id: string; name: string; color: string; icon: string | null; synopsis: string | null; status: string }[]
    },
    staleTime: 1000 * 60 * 5,
  })

  // Fetch available LLM models
  const { data: modelsData } = useQuery({
    queryKey: ['available-models'],
    queryFn: async () => {
      const res = await llmApi.getAvailableModels()
      return res.data as { models: { provider: string; model: string; name: string; description: string }[]; default_provider: string; default_model: string }
    },
    staleTime: 1000 * 60 * 10,
  })

  // Get online users + socket for real-time updates
  const { onlineUsers, socket } = useSocket(sessionId || '')

  const { data: tasksData } = useQuery<TaskData[]>({
    queryKey: ['session-tasks', sessionId],
    queryFn: async () => {
      const res = await teacherApi.getTasks(sessionId!)
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

    socket.on('student_frozen_status', handleFrozenStatus)
    socket.on('module_toggled', handleModuleToggled)
    return () => {
      socket.off('student_frozen_status', handleFrozenStatus)
      socket.off('module_toggled', handleModuleToggled)
    }
  }, [socket, sessionId, queryClient])

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) => teacherApi.updateSession(sessionId!, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-live', sessionId] })
      toast({ title: 'Stato aggiornato!' })
    },
  })

  const freezeMutation = useMutation({
    mutationFn: (studentId: string) => teacherApi.freezeStudent(sessionId!, studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-live', sessionId] })
      toast({ title: 'Studente bloccato' })
    },
  })

  const unfreezeMutation = useMutation({
    mutationFn: (studentId: string) => teacherApi.unfreezeStudent(sessionId!, studentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-live', sessionId] })
      toast({ title: 'Studente sbloccato' })
    },
  })

  const toggleModuleMutation = useMutation({
    mutationFn: ({ moduleKey, isEnabled }: { moduleKey: string; isEnabled: boolean }) =>
      teacherApi.toggleModule(sessionId!, moduleKey, isEnabled),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['session-live', sessionId] })
      toast({ title: `Modulo ${variables.isEnabled ? 'attivato' : 'disattivato'}` })
    },
  })

  const updateDefaultModelMutation = useMutation({
    mutationFn: ({ provider, model }: { provider: string; model: string }) =>
      teacherApi.updateSession(sessionId!, { default_llm_provider: provider, default_llm_model: model }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-live', sessionId] })
      toast({ title: 'Modello di default aggiornato!' })
    },
  })

  const createTaskMutation = useMutation({
    mutationFn: (data: { title: string; description: string; task_type: string; content_json?: string }) =>
      teacherApi.createTask(sessionId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-tasks', sessionId] })
      setShowTaskBuilder(false)
      toast({ title: 'Compito creato!' })
    },
  })

  const publishTaskMutation = useMutation({
    mutationFn: (taskId: string) => teacherApi.updateTask(sessionId!, taskId, { new_status: 'published' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-tasks', sessionId] })
      toast({ title: 'Compito pubblicato!' })
    },
  })

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: string) => teacherApi.deleteTask(sessionId!, taskId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-tasks', sessionId] })
      toast({ title: 'Compito eliminato' })
    },
  })

  const pushTeacherbotMutation = useMutation({
    mutationFn: ({ studentId, teacherbotId }: { studentId: string; teacherbotId: string }) =>
      teacherApi.pushTeacherbotToStudent(sessionId!, studentId, teacherbotId),
    onSuccess: (_, { studentId }) => {
      const student = data?.students.find(s => s.id === studentId)
      toast({ title: `Bot inviato a ${student?.nickname ?? 'studente'}` })
      setPushBotStudentId(null)
    },
    onError: () => {
      toast({ title: 'Errore invio bot', variant: 'destructive' })
    },
  })

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    toast({ title: 'Codice copiato!' })
  }



  // Close bot popover when clicking outside
  useEffect(() => {
    if (!pushBotStudentId) return
    const handler = (e: MouseEvent) => {
      if (pushPopoverRef.current && !pushPopoverRef.current.contains(e.target as Node)) {
        setPushBotStudentId(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [pushBotStudentId])

  // All hooks must be before any conditional returns (Rules of Hooks)
  const onlineStudentIds = useMemo(() => new Set(onlineUsers.map(u => u.student_id)), [onlineUsers])
  const onlineStudents = useMemo(
    () => (data?.students || []).filter(s => onlineStudentIds.has(s.id)),
    [data?.students, onlineStudentIds]
  )
  const offlineStudents = useMemo(
    () => (data?.students || []).filter(s => !onlineStudentIds.has(s.id)),
    [data?.students, onlineStudentIds]
  )

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[40vh] text-sm text-slate-400">
        Caricamento sessione...
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-full min-h-[40vh] text-sm text-slate-400">
        Sessione non trovata
      </div>
    )
  }

  const { session, students, modules } = data

  const statusConfig = {
    active: { dot: 'bg-emerald-500 animate-pulse', badge: 'bg-emerald-100 text-emerald-700', label: 'Attiva' },
    paused: { dot: 'bg-amber-500', badge: 'bg-amber-100 text-amber-700', label: 'In Pausa' },
    ended:  { dot: 'bg-red-400',   badge: 'bg-red-100 text-red-700',     label: 'Terminata' },
    draft:  { dot: 'bg-slate-400', badge: 'bg-slate-100 text-slate-600', label: 'Bozza' },
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
                Modalità Demo
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
        <div className="bg-white border-b border-slate-200 px-6 md:px-8 py-4">
          <div className="max-w-6xl mx-auto flex items-center justify-between gap-4 flex-wrap">
            {/* Left: back + title */}
            <div className="flex items-center gap-3 min-w-0">
              <Link
                to="/teacher/classes"
                className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition-colors flex-shrink-0"
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="hidden sm:inline">Classi</span>
              </Link>
              <span className="text-slate-300">/</span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-lg font-bold text-slate-900 truncate">{session.title}</h1>
                  <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${sc.badge}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                    {sc.label}
                  </span>
                </div>
                <p className="text-sm text-slate-500 truncate">
                  {session.class_name}
                  {session.class_school_grade && <span className="ml-2 text-slate-400">· {session.class_school_grade}</span>}
                </p>
              </div>
            </div>

            {/* Center: join code */}
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <span className="text-xs text-slate-500">Codice:</span>
              {joinCodeAvailable ? (
                <>
                  <code className="font-mono font-bold text-base text-slate-800 tracking-wider">{session.join_code}</code>
                  <button
                    onClick={() => copyCode(session.join_code)}
                    className="ml-1 text-slate-400 hover:text-slate-700 transition-colors"
                    title="Copia codice"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <span className="text-sm font-medium text-slate-400">
                  {session.status === 'paused' ? 'Non disponibile in pausa' : 'Codice dismesso'}
                </span>
              )}
            </div>

            {/* Right: actions */}
            <div className="flex items-center gap-2">
              {session.status === 'draft' && (
                <Button size="sm" onClick={() => updateStatusMutation.mutate('active')}>
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  Avvia
                </Button>
              )}
              {session.status === 'active' && (
                <>
                  <Button size="sm" variant="outline" onClick={() => updateStatusMutation.mutate('paused')}>
                    <Square className="h-3.5 w-3.5 mr-1.5" />
                    Pausa
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => updateStatusMutation.mutate('ended')}>
                    Termina
                  </Button>
                </>
              )}
              {session.status === 'paused' && (
                <Button size="sm" onClick={() => updateStatusMutation.mutate('active')}>
                  <Play className="h-3.5 w-3.5 mr-1.5" />
                  Riprendi
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Main Layout: Sidebar + Content */}
        <div className="max-w-7xl mx-auto px-4 md:px-6 py-5">
          <div className="flex gap-4">

            {/* ── Left Sidebar: Students ── */}
            <div className="w-52 shrink-0">
              <div className="sticky top-4 rounded-2xl border border-slate-200 shadow-sm overflow-hidden bg-white">
                {/* Header */}
                <div className="px-3 py-2.5 bg-gradient-to-r from-slate-800 to-slate-700 flex items-center justify-between">
                  <span className="text-xs font-bold text-white flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5" /> Studenti
                  </span>
                  <span className="px-1.5 py-0.5 bg-emerald-400/25 text-emerald-300 text-[10px] font-bold rounded-full">
                    {onlineStudents.length} online
                  </span>
                </div>

                <div className="p-2">
                  {students.length === 0 ? (
                    <div className="text-center py-6">
                      <Users className="h-7 w-7 mx-auto mb-1.5 text-slate-200" />
                      <p className="text-xs text-slate-400">Nessuno studente</p>
                      <span className="text-xs font-semibold text-slate-400 mt-1 block">
                        {joinCodeAvailable ? session.join_code : session.status === 'paused' ? 'Codice non disponibile' : 'Codice dismesso'}
                      </span>
                    </div>
                  ) : (
                    <div className="space-y-0.5 max-h-[65vh] overflow-y-auto">
                      {onlineStudents.map((student) => (
                        <div
                          key={student.id}
                          className={`flex items-center gap-1.5 px-2 py-1.5 rounded-xl transition-colors ${
                            student.is_frozen ? 'bg-blue-50 border border-blue-100' : 'hover:bg-slate-50'
                          }`}
                        >
                          {/* Avatar */}
                          <div className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0 ${
                            student.is_frozen
                              ? 'bg-gradient-to-br from-blue-400 to-blue-500'
                              : 'bg-gradient-to-br from-emerald-400 to-teal-500'
                          }`}>
                            {student.nickname.charAt(0).toUpperCase()}
                          </div>
                          <span className="flex-1 text-xs font-medium text-slate-800 truncate min-w-0">{student.nickname}</span>
                          {/* Actions */}
                          <div className="flex gap-0.5 shrink-0">
                            <button
                              onClick={() => window.dispatchEvent(new CustomEvent('openPrivateChat', { detail: { id: student.id, nickname: student.nickname } }))}
                              title="Chat diretta"
                              className="h-5 w-5 flex items-center justify-center rounded-md text-slate-300 hover:text-sky-500 hover:bg-sky-50 transition-colors"
                            >
                              <MessageSquare className="h-3 w-3" />
                            </button>
                            <div className="relative">
                              <button
                                onClick={() => setPushBotStudentId(pushBotStudentId === student.id ? null : student.id)}
                                title="Invia bot"
                                className="h-5 w-5 flex items-center justify-center rounded-md text-slate-300 hover:text-violet-500 hover:bg-violet-50 transition-colors"
                              >
                                <Bot className="h-3 w-3" />
                              </button>
                              {pushBotStudentId === student.id && (
                                <div
                                  ref={pushPopoverRef}
                                  className="absolute left-0 top-6 z-50 w-52 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
                                >
                                  <div className="px-3 py-2 border-b border-slate-100 text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                                    <Send className="h-3 w-3" />
                                    Invia bot a {student.nickname}
                                  </div>
                                  {!teacherbots || teacherbots.length === 0 ? (
                                    <div className="px-3 py-3 text-xs text-slate-400 text-center">Nessun bot disponibile</div>
                                  ) : (
                                    <div className="max-h-48 overflow-y-auto">
                                      {teacherbots.map(bot => (
                                        <button
                                          key={bot.id}
                                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 transition-colors text-left"
                                          onClick={() => pushTeacherbotMutation.mutate({ studentId: student.id, teacherbotId: bot.id })}
                                          disabled={pushTeacherbotMutation.isPending}
                                        >
                                          <BotColorDot color={bot.color} />
                                          <span className="truncate flex-1 text-slate-800">{bot.name}</span>
                                          <ChevronRight className="h-3 w-3 text-slate-300 shrink-0" />
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => student.is_frozen ? unfreezeMutation.mutate(student.id) : freezeMutation.mutate(student.id)}
                              title={student.is_frozen ? 'Sblocca' : 'Blocca'}
                              className="h-5 w-5 flex items-center justify-center rounded-md text-slate-300 hover:text-amber-500 hover:bg-amber-50 transition-colors"
                            >
                              {student.is_frozen
                                ? <Sun className="h-3 w-3 text-amber-400" />
                                : <Snowflake className="h-3 w-3" />
                              }
                            </button>
                          </div>
                        </div>
                      ))}

                      {offlineStudents.length > 0 && (
                        <>
                          <button
                            onClick={() => setShowOfflineStudents(!showOfflineStudents)}
                            className="w-full flex items-center justify-between px-2 py-1.5 text-[10px] text-slate-400 hover:text-slate-600 transition-colors mt-1 rounded-lg hover:bg-slate-50"
                          >
                            <span className="flex items-center gap-1.5">
                              <User className="h-3 w-3" />
                              Disconnessi ({offlineStudents.length})
                            </span>
                            {showOfflineStudents ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </button>
                          {showOfflineStudents && offlineStudents.map((student) => (
                            <div key={student.id} className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl opacity-40">
                              <div className="w-6 h-6 rounded-lg bg-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-500 flex-shrink-0">
                                {student.nickname.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-xs text-slate-500 truncate">{student.nickname}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Main Content Area ── */}
            <div className="flex-1 min-w-0">

              {/* Pill tab bar */}
              <div className="flex bg-slate-100 rounded-2xl p-1 gap-1 mb-4">
                {([
                  { key: 'modules', icon: Brain, label: 'Moduli' },
                  { key: 'tasks',   icon: ClipboardList, label: 'Compiti' },
                  { key: 'history', icon: History, label: 'Storico' },
                ] as { key: string; icon: React.FC<{ className?: string }>; label: string }[]).map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold transition-all ${
                      activeTab === tab.key
                        ? 'bg-slate-900 text-white shadow-sm'
                        : 'text-slate-500 hover:text-slate-800 hover:bg-white/60'
                    }`}
                  >
                    <tab.icon className="h-4 w-4" />
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              {/* ── Moduli ── */}
              {activeTab === 'modules' && (
                <div className="space-y-4">

                  {/* Module toggles */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                      <Brain className="h-4 w-4 text-slate-500" />
                      <span className="font-semibold text-sm text-slate-800">Moduli Attivi</span>
                    </div>
                    <div className="p-3 space-y-2">
                      {modules.map((mod) => {
                        const cfg: Record<string, { border: string; bg: string; activeBg: string; icon: React.FC<{ className?: string }>; label: string; desc: string }> = {
                          chatbot:         { border: 'border-l-violet-400', bg: 'bg-violet-50',  activeBg: 'bg-gradient-to-br from-violet-500 to-purple-600', icon: Bot,          label: 'Chatbot AI',       desc: 'Assistente AI con diverse modalità' },
                          classification:  { border: 'border-l-sky-400',    bg: 'bg-sky-50',     activeBg: 'bg-gradient-to-br from-sky-500 to-cyan-600',      icon: Brain,        label: 'Classificazione ML', desc: 'Immagini, testo, dati' },
                          self_assessment: { border: 'border-l-amber-400',  bg: 'bg-amber-50',   activeBg: 'bg-gradient-to-br from-amber-500 to-orange-500',  icon: ClipboardList,label: 'Autovalutazione',   desc: 'Quiz e autovalutazione' },
                          chat:            { border: 'border-l-emerald-400', bg: 'bg-emerald-50', activeBg: 'bg-gradient-to-br from-emerald-500 to-teal-600',  icon: MessageSquare,label: 'Chat privata',      desc: 'Solo docente e singolo studente' },
                        }
                        const c = cfg[mod.module_key] ?? { border: 'border-l-slate-300', bg: 'bg-slate-50', activeBg: 'bg-slate-500', icon: Bot, label: mod.module_key, desc: '' }
                        const ModIcon = c.icon
                        return (
                          <div
                            key={mod.module_key}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border border-slate-100 border-l-4 transition-all ${
                              mod.is_enabled ? `${c.border} ${c.bg}` : 'border-l-slate-200 bg-white'
                            }`}
                          >
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${mod.is_enabled ? c.activeBg : 'bg-slate-200'}`}>
                              <ModIcon className="h-4 w-4 text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-semibold text-slate-800">{c.label}</p>
                              <p className="text-[11px] text-slate-400">{c.desc}</p>
                            </div>
                            {/* Pill toggle */}
                            <button
                              onClick={() => toggleModuleMutation.mutate({ moduleKey: mod.module_key, isEnabled: !mod.is_enabled })}
                              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0 ${
                                mod.is_enabled ? 'bg-emerald-500' : 'bg-slate-300'
                              }`}
                            >
                              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                                mod.is_enabled ? 'translate-x-6' : 'translate-x-1'
                              }`} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Default LLM model */}
                  <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                      <Bot className="h-4 w-4 text-slate-500" />
                      <span className="font-semibold text-sm text-slate-800">Modello AI di Default</span>
                    </div>
                    <div className="p-3 flex flex-wrap gap-2">
                      {modelsData?.models?.map((m: { provider: string; model: string; name: string; description: string }) => {
                        const isSelected =
                          (data as SessionLiveData & { session: { default_llm_provider?: string; default_llm_model?: string } })?.session?.default_llm_provider === m.provider &&
                          (data as SessionLiveData & { session: { default_llm_provider?: string; default_llm_model?: string } })?.session?.default_llm_model === m.model
                        return (
                          <button
                            key={`${m.provider}:${m.model}`}
                            onClick={() => updateDefaultModelMutation.mutate({ provider: m.provider, model: m.model })}
                            className={`flex items-center gap-2 px-3 py-2 rounded-full border text-xs font-semibold transition-all ${
                              isSelected
                                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:bg-slate-50'
                            }`}
                          >
                            <span className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${isSelected ? 'bg-white/20' : 'bg-slate-100'}`}>
                              {m.provider === 'openai' ? (
                                <img src="/icone_ai/OpenAI_logo_2025_(symbol).svg.png" alt="OpenAI" className="h-3 w-3 object-contain" />
                              ) : m.provider === 'anthropic' ? (
                                <img src="/icone_ai/anthropic.svg" alt="Anthropic" className="h-3 w-3 object-contain" />
                              ) : m.provider === 'deepseek' ? (
                                <img src="/icone_ai/deepseek-logo-icon.svg" alt="DeepSeek" className="h-3 w-3 object-contain" />
                              ) : (
                                <Bot className="h-3 w-3" />
                              )}
                            </span>
                            {m.name}
                            {isSelected && <Check className="h-3 w-3 shrink-0" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Compiti ── */}
              {activeTab === 'tasks' && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-slate-500" />
                    <span className="font-semibold text-sm text-slate-800">Compiti e Attività</span>
                    <div className="ml-auto flex gap-2">
                      {data?.session?.class_id && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => navigate(`/teacher/classes/${data.session.class_id}/uda`)}
                          className="h-7 text-xs text-indigo-600 border-indigo-200 hover:bg-indigo-50"
                        >
                          <BookOpen className="h-3 w-3 mr-1" />
                          UDA
                        </Button>
                      )}
                      {!showTaskBuilder && (
                        <Button size="sm" onClick={() => setShowTaskBuilder(true)} className="h-7 text-xs">
                          <Plus className="h-3 w-3 mr-1" />
                          Nuovo
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="p-4">
                    {showTaskBuilder && (
                      <div className="mb-4">
                        <TaskBuilder
                          onSubmit={(data) => createTaskMutation.mutate(data)}
                          onCancel={() => setShowTaskBuilder(false)}
                          isLoading={createTaskMutation.isPending}
                        />
                      </div>
                    )}
                    {tasksData && tasksData.length > 0 && (
                      <div className="mb-3 flex items-center gap-2">
                        <div className="relative flex-1 max-w-sm">
                          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                          <input
                            type="text"
                            placeholder="Cerca compiti..."
                            value={taskSearch}
                            onChange={e => setTaskSearch(e.target.value)}
                            className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-full focus:outline-none focus:ring-2 focus:ring-slate-300 transition-colors"
                          />
                          {taskSearch && (
                            <button onClick={() => setTaskSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        {/* View mode toggle */}
                        <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                          <button
                            onClick={() => setTaskViewMode('grid')}
                            className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${taskViewMode === 'grid' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            title="Vista griglia"
                          >
                            <LayoutGrid className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setTaskViewMode('list')}
                            className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${taskViewMode === 'list' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            title="Vista elenco"
                          >
                            <List className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                    {!tasksData || tasksData.length === 0 ? (
                      <p className="text-center text-sm text-slate-400 py-8">
                        Nessun compito assegnato. Crea il primo compito sopra.
                      </p>
                    ) : (() => {
                      const filtered = tasksData.filter(t => {
                        if (!taskSearch.trim()) return true
                        const terms = taskSearch.toLowerCase().split(/\s+/).filter(Boolean)
                        const target = [t.title, t.description || '', t.task_type].join(' ').toLowerCase()
                        return terms.every(term => target.includes(term))
                      })
                      if (filtered.length === 0) return (
                        <div className="flex flex-col items-center py-10 text-center">
                          <Search className="h-7 w-7 text-slate-200 mb-2" />
                          <p className="text-sm text-slate-400">Nessun compito corrisponde a <strong>"{taskSearch}"</strong></p>
                        </div>
                      )
                      if (taskViewMode === 'list') return (
                        <div className="flex flex-col gap-2">
                          {filtered.map((task) => (
                            <TaskCard
                              key={task.id}
                              task={task}
                              sessionId={sessionId!}
                              isExpanded={expandedTaskId === task.id}
                              onToggle={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                              onPublish={() => publishTaskMutation.mutate(task.id)}
                              onDelete={() => deleteTaskMutation.mutate(task.id)}
                            />
                          ))}
                        </div>
                      )
                      return (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                          {filtered.map((task) => (
                            <div key={task.id} className={expandedTaskId === task.id ? 'col-span-full' : ''}>
                              <TaskCard
                                task={task}
                                sessionId={sessionId!}
                                isExpanded={expandedTaskId === task.id}
                                onToggle={() => setExpandedTaskId(expandedTaskId === task.id ? null : task.id)}
                                onPublish={() => publishTaskMutation.mutate(task.id)}
                                onDelete={() => deleteTaskMutation.mutate(task.id)}
                              />
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              )}

              {/* ── Storico ── */}
              {activeTab === 'history' && (
                <>
                  <AnalyticsPanel sessionId={sessionId!} socket={socket} />
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
      </div>
    </>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function BotColorDot({ color, large }: { color: string; large?: boolean }) {
  const colorMap: Record<string, string> = {
    indigo: 'bg-[#181b1e]', blue: 'bg-blue-500', green: 'bg-green-500',
    red: 'bg-red-500', purple: 'bg-purple-500', pink: 'bg-pink-500',
    orange: 'bg-orange-500', teal: 'bg-teal-500', cyan: 'bg-cyan-500',
  }
  const bg = colorMap[color] || 'bg-[#181b1e]'
  const size = large ? 'w-8 h-8 rounded-lg' : 'w-5 h-5 rounded-md'
  return (
    <div className={`${size} ${bg} flex items-center justify-center shrink-0`}>
      <Bot className={`${large ? 'h-4 w-4' : 'h-3 w-3'} text-white`} />
    </div>
  )
}

// ─── TaskCard ────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: TaskData
  sessionId: string
  isExpanded: boolean
  onToggle: () => void
  onPublish: () => void
  onDelete: () => void
}

interface SubmissionData {
  id: string
  student_id: string
  student_nickname: string
  content: string
  content_json?: string | null
  submitted_at: string
  score: string | null
  feedback: string | null
}

interface QuizQuestion {
  question: string
  options: string[]
  correctIndex: number
}

interface QuizWrongAnswerDetail {
  questionNumber: number
  question: string
  selectedAnswer: string
  correctAnswer: string
}

function TaskCard({ task, sessionId, isExpanded, onToggle, onPublish, onDelete }: TaskCardProps) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [isEditingDraft, setIsEditingDraft] = useState(false)
  const [editTitle, setEditTitle] = useState(task.title)
  const [editDescription, setEditDescription] = useState(task.description || '')
  const [editContentJson, setEditContentJson] = useState(task.content_json || '')

  const getWrongQuizAnswers = (submission: SubmissionData): QuizWrongAnswerDetail[] => {
    if (task.task_type !== 'quiz') return []
    if (!task.content_json || !submission.content_json) return []

    try {
      const taskContent = JSON.parse(task.content_json) as { questions?: QuizQuestion[] }
      const submissionContent = JSON.parse(submission.content_json) as { answers?: Array<{ questionIndex: number; selectedIndex: number }> }
      const questions = taskContent.questions || []
      const answers = submissionContent.answers || []

      const wrongAnswers: QuizWrongAnswerDetail[] = []
      for (const answer of answers) {
        const q = questions[answer.questionIndex]
        if (!q) continue
        if (answer.selectedIndex === q.correctIndex) continue

        wrongAnswers.push({
          questionNumber: answer.questionIndex + 1,
          question: q.question,
          selectedAnswer: q.options[answer.selectedIndex] ?? 'Nessuna risposta',
          correctAnswer: q.options[q.correctIndex] ?? 'N/D',
        })
      }

      return wrongAnswers
    } catch {
      return []
    }
  }

  const { data: submissions, isLoading } = useQuery<SubmissionData[]>({
    queryKey: ['task-submissions', sessionId, task.id],
    queryFn: async () => {
      const res = await teacherApi.getTaskSubmissions(sessionId, task.id)
      return res.data
    },
    enabled: isExpanded && task.status === 'published',
  })

  const updateTaskMutation = useMutation({
    mutationFn: (payload: { title?: string; description?: string; content_json?: string }) =>
      teacherApi.updateTask(sessionId, task.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-tasks', sessionId] })
      setIsEditingDraft(false)
      toast({ title: 'Bozza aggiornata' })
    },
    onError: () => {
      toast({ title: 'Errore aggiornamento bozza', variant: 'destructive' })
    },
  })

  return (
    <div className={`rounded-xl border transition-colors ${
      task.status === 'published'
        ? 'bg-emerald-50/50 border-emerald-200'
        : 'bg-white border-slate-200'
    }`}>
      <div className="flex items-center justify-between px-4 py-3 gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-slate-800 truncate">{task.title}</span>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${
              task.status === 'published'
                ? 'bg-emerald-100 text-emerald-700'
                : 'bg-slate-100 text-slate-600'
            }`}>
              {task.status === 'published' ? 'Pubblicato' : 'Bozza'}
            </span>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-100 text-sky-700 font-medium capitalize flex-shrink-0">
              {task.task_type}
            </span>
          </div>
          {task.description && (
            <p className="text-xs text-slate-500 mt-0.5 truncate">{task.description}</p>
          )}
        </div>
        <div className="flex gap-1.5 shrink-0">
          <Button size="sm" variant="outline" onClick={onToggle} className="text-xs">
            {isExpanded ? <ChevronUp className="h-3.5 w-3.5 mr-1" /> : <ChevronDown className="h-3.5 w-3.5 mr-1" />}
            {isExpanded ? 'Chiudi' : 'Dettagli'}
          </Button>
          {task.status === 'draft' && (
            <Button size="sm" variant="outline" onClick={onPublish} className="text-xs">
              <Check className="h-3.5 w-3.5 mr-1" />
              Pubblica
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDelete} className="h-8 w-8 p-0">
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
          </Button>
        </div>
      </div>

      {isExpanded && (
        <div className="border-t p-4 bg-white rounded-b-lg">
          <h4 className="font-medium mb-3 flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Dettagli Compito
          </h4>
          {task.status === 'draft' && (
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm text-slate-600">Questa attività è in bozza: puoi modificarla prima della pubblicazione.</p>
              <Button size="sm" variant="outline" onClick={() => setIsEditingDraft(v => !v)}>
                {isEditingDraft ? 'Annulla Modifica' : 'Modifica Bozza'}
              </Button>
            </div>
          )}

          {isEditingDraft ? (
            <div className="space-y-3 border rounded-lg p-3 bg-slate-50">
              <div>
                <label className="text-xs font-medium text-slate-600">Titolo</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Descrizione</label>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm min-h-[70px]"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-600">Contenuto (JSON)</label>
                <textarea
                  value={editContentJson}
                  onChange={(e) => setEditContentJson(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-xs font-mono min-h-[180px]"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => updateTaskMutation.mutate({
                    title: editTitle,
                    description: editDescription,
                    content_json: editContentJson,
                  })}
                  disabled={updateTaskMutation.isPending}
                >
                  Salva Bozza
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {task.description && (
                <p className="text-sm text-slate-700"><span className="font-medium">Descrizione:</span> {task.description}</p>
              )}
              {task.content_json && (
                <details className="border rounded-lg bg-slate-50">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700">Apri contenuto del compito</summary>
                  <pre className="text-xs p-3 overflow-x-auto whitespace-pre-wrap break-all">{task.content_json}</pre>
                </details>
              )}
            </div>
          )}

          {task.status === 'published' && (
            <div className="mt-6">
              <h5 className="font-medium mb-3 text-sm">Risposte degli studenti</h5>
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Caricamento...</p>
              ) : !submissions || submissions.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nessuna risposta ancora.</p>
              ) : (
                <div className="space-y-3">
                  {submissions.map((sub) => (
                    <div key={sub.id} className="p-3 bg-gray-50 rounded-lg border">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-sm">{sub.student_nickname}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(sub.submitted_at).toLocaleString('it-IT')}
                        </span>
                      </div>
                      <p className="text-sm mb-2">{sub.content}</p>
                      {sub.score && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium bg-emerald-100 text-emerald-700 px-2 py-1 rounded">
                            Punteggio: {sub.score}
                          </span>
                        </div>
                      )}
                      {task.task_type === 'quiz' && (() => {
                        const wrongAnswers = getWrongQuizAnswers(sub)
                        if (wrongAnswers.length === 0) return null
                        return (
                          <div className="mt-3 bg-red-50 rounded-lg border border-red-200 p-2 space-y-2">
                            <p className="text-xs font-medium text-red-700">
                              Errori: {wrongAnswers.length}
                            </p>
                            {wrongAnswers.map((wa) => (
                              <div key={`${sub.id}-wrong-${wa.questionNumber}`} className="text-xs bg-white border border-red-100 rounded p-2">
                                <p className="font-medium text-slate-800">
                                  {wa.questionNumber}. {wa.question}
                                </p>
                                <p className="text-red-700">
                                  Risposta studente: {wa.selectedAnswer}
                                </p>
                                <p className="text-emerald-700">
                                  Corretta: {wa.correctAnswer}
                                </p>
                              </div>
                            ))}
                          </div>
                        )
                      })()}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
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
  provider: string | null
  model: string | null
  created_at: string
  token_usage_json?: TokenUsageJson | null
}

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
          Analisi Pedagogica
          <span className="text-xs font-normal text-slate-400 ml-1">{conversations.length} conversazioni • {Object.keys(studentActivity).length} studenti</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Student activity ranking */}
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Studenti più attivi</h4>
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
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Argomenti frequenti</h4>
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
                <p className="text-xs text-slate-400">Nessun titolo disponibile per l'analisi</p>
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
  })

  // Teacherbot conversations for this session
  const { data: tbConversations, isLoading: loadingTBConversations } = useQuery<TeacherbotConvData[]>({
    queryKey: ['session-tb-conversations', sessionId],
    queryFn: async () => {
      const res = await teacherbotsApi.getSessionConversations(sessionId)
      return res.data
    },
  })

  // Selected teacherbot conv — fetch its messages
  const selectedTBConv = (tbConversations ?? []).find(c => c.id === selectedTBConvId)
  const { data: tbMessages, isLoading: loadingTBMessages } = useQuery<MessageData[]>({
    queryKey: ['tb-conv-messages', selectedTBConvId],
    queryFn: async () => {
      const res = await teacherbotsApi.getTeacherConvMessages(selectedTBConv!.teacherbot_id, selectedTBConvId!)
      return res.data
    },
    enabled: !!selectedTBConvId && !!selectedTBConv,
  })

  const { data: messages, isLoading: loadingMessages } = useQuery<MessageData[]>({
    queryKey: ['conversation-messages', selectedConversationId],
    queryFn: async () => {
      const res = await llmApi.getConversationMessages(selectedConversationId!)
      return res.data
    },
    enabled: !!selectedConversationId,
  })

  // Scroll to bottom when messages load
  useEffect(() => {
    if (messages && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages])

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
    { key: 'chatbot' as const, label: 'Chatbot AI', icon: Bot,          count: aiConversations.length },
    { key: 'teacherbot' as const, label: 'Teacherbot', icon: User,       count: (tbConversations ?? []).length },
    { key: 'learning' as const, label: 'Apprendimento', icon: BookOpen,  count: learningConversations.length },
  ]

  return (
    <div className="flex h-[calc(100vh-320px)] min-h-[480px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">

      {/* ── Left panel ── */}
      <div className="w-72 flex-shrink-0 border-r border-slate-200 flex flex-col bg-slate-50">

        {/* Sub-tab bar */}
        <div className="flex bg-slate-100 rounded-xl m-2 p-0.5 gap-0.5 flex-shrink-0">
          {TAB_CONFIG.map(tab => (
            <button
              key={tab.key}
              onClick={() => {
                setHistoryTab(tab.key)
                onSelectConversation(null)
                setSelectedTBConvId(null)
              }}
              className={`flex-1 flex flex-col items-center py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                historyTab === tab.key
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-400 hover:text-slate-600'
              }`}
            >
              <tab.icon className="h-3.5 w-3.5 mb-0.5" />
              {tab.label}
              <span className={`text-[9px] ${historyTab === tab.key ? 'text-slate-400' : 'text-slate-300'}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">

          {/* ── Chatbot / Learning tabs ── */}
          {(historyTab === 'chatbot' || historyTab === 'learning') && (
            (loadingConversations)
              ? <div className="p-4 text-xs text-slate-400 text-center">Caricamento…</div>
              : Object.keys(byStudent).length === 0
                ? <div className="p-4 text-xs text-slate-400 text-center">Nessuna conversazione</div>
                : Object.entries(byStudent).map(([studentId, { nickname, conversations: convs }]) => {
                    const isExpanded = expandedStudents.has(studentId)
                    const hasSelected = convs.some(c => c.id === selectedConversationId)
                    return (
                      <div key={studentId} className="border-b border-slate-100 last:border-b-0">
                        <button
                          onClick={() => toggleStudent(studentId)}
                          className={`w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-slate-100 transition-colors ${hasSelected ? 'bg-slate-100' : ''}`}
                        >
                          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-slate-600 to-slate-700 flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0">
                            {nickname.charAt(0).toUpperCase()}
                          </div>
                          <span className="flex-1 text-xs font-semibold text-slate-800 truncate">{nickname}</span>
                          <span className="text-[10px] text-slate-400 mr-0.5">{convs.length}</span>
                          {isExpanded ? <ChevronUp className="h-3 w-3 text-slate-400 flex-shrink-0" /> : <ChevronDown className="h-3 w-3 text-slate-400 flex-shrink-0" />}
                        </button>
                        {isExpanded && convs.map((conv) => {
                          const isActive = selectedConversationId === conv.id
                          const color = profileColor(conv.profile_key)
                          return (
                            <button key={conv.id} onClick={() => onSelectConversation(conv.id)}
                              className={`w-full text-left px-3 py-1.5 pl-4 flex items-center gap-2 transition-colors border-l-2 ${isActive ? 'bg-white border-l-violet-500' : 'border-l-transparent hover:bg-white hover:border-l-slate-300'}`}
                            >
                              <div className={`w-5 h-5 rounded-md ${color} flex items-center justify-center flex-shrink-0`}>
                                <Bot className="h-2.5 w-2.5 text-white" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] font-semibold text-slate-700 capitalize truncate">{conv.profile_key}</p>
                                <p className="text-[10px] text-slate-400">{conv.message_count} msg · {new Date(conv.updated_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}</p>
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
              ? <div className="p-4 text-xs text-slate-400 text-center">Caricamento…</div>
              : Object.keys(tbByStudent).length === 0
                ? <div className="p-4 text-xs text-slate-400 text-center">Nessuna conversazione teacherbot</div>
                : Object.entries(tbByStudent).map(([studentId, { nickname, conversations: convs }]) => {
                    const isExpanded = expandedStudents.has(studentId)
                    const hasSelected = convs.some(c => c.id === selectedTBConvId)
                    const latestConv = [...convs].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]
                    return (
                      <div key={studentId} className="px-3 py-2">
                        <button
                          onClick={() => toggleStudent(studentId)}
                          className={`w-full rounded-2xl border px-4 py-4 flex items-center gap-3 text-left transition-all ${
                            hasSelected
                              ? 'bg-white shadow-sm ring-1 ring-violet-100'
                              : 'bg-white/80 hover:bg-white hover:shadow-sm'
                          }`}
                        >
                          <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-slate-700 via-slate-800 to-slate-900 flex items-center justify-center text-sm font-bold text-white shadow-lg shadow-slate-300/60 flex-shrink-0">
                            {nickname.charAt(0).toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[15px] font-semibold text-slate-900 truncate">{nickname}</span>
                              <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] font-semibold text-violet-700">
                                {convs.length} chat
                              </span>
                            </div>
                            {latestConv && (
                              <p className="mt-1 text-[12px] text-slate-500 truncate">
                                Ultima attivita {new Date(latestConv.updated_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                              </p>
                            )}
                          </div>
                          {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-500 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-slate-500 flex-shrink-0" />}
                        </button>
                        {isExpanded && (
                          <div className="mt-2 space-y-2 pl-2">
                            {convs.map((conv) => {
                          const isActive = selectedTBConvId === conv.id
                          const color = tbColor(conv.teacherbot_color)
                          return (
                            <button
                              key={conv.id}
                              onClick={() => setSelectedTBConvId(conv.id)}
                              className={`w-full rounded-2xl text-left px-4 py-3.5 flex items-center gap-3 transition-all border ${
                                isActive
                                  ? 'bg-gradient-to-r from-violet-50 via-white to-indigo-50 border-violet-200 shadow-sm'
                                  : 'bg-white/90 border-slate-200 hover:bg-white hover:border-slate-300'
                              }`}
                            >
                              <div className={`w-10 h-10 rounded-2xl ${color} flex items-center justify-center flex-shrink-0 shadow-md`}>
                                <Bot className="h-4 w-4 text-white" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <p className="text-[14px] font-semibold text-slate-900 truncate">{conv.teacherbot_name}</p>
                                  {isActive && (
                                    <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                                      Aperta
                                    </span>
                                  )}
                                </div>
                                <p className="mt-1 text-[12px] font-medium text-slate-600">
                                  {conv.message_count} messaggi
                                </p>
                                <p className="text-[11px] text-slate-500">
                                  Aggiornata il {new Date(conv.updated_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                </p>
                              </div>
                              <ChevronRight className={`h-4 w-4 flex-shrink-0 ${isActive ? 'text-violet-500' : 'text-slate-300'}`} />
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
              <p className="text-sm">Seleziona una conversazione dalla lista</p>
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
                <span className="text-xs text-slate-400">{activeCount} messaggi</span>
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
                    Nessun messaggio in questa conversazione.
                  </div>
                ) : (
                  activeMsgs.map((msg) => (
                    <div key={msg.id}>
                      {/* Student label above user messages */}
                      {msg.role === 'user' && (
                        <div className="flex justify-end mb-1 pr-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-semibold text-slate-500">{activeName}</span>
                            <div className="w-5 h-5 rounded-full bg-gradient-to-br from-slate-500 to-slate-700 flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0">
                              {activeName?.charAt(0).toUpperCase() ?? 'S'}
                            </div>
                          </div>
                        </div>
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
                    </div>
                  ))
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
