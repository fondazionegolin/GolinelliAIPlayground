import { useState, useRef, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { teacherApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/use-toast'
import { 
  ArrowLeft, Users, Copy, Play, Square, 
  Snowflake, Sun, Bot, Brain, MessageSquare, Send,
  ClipboardList, Plus, Trash2, Check, Eye, ChevronDown, ChevronUp, History, User
} from 'lucide-react'
import { llmApi } from '@/lib/api'
import TaskBuilder from '@/components/TaskBuilder'
import TeacherNotifications from '@/components/TeacherNotifications'
import { useSocket } from '@/hooks/useSocket'
import { TeacherNavbar } from '@/components/TeacherNavbar'

interface StudentData {
  id: string
  nickname: string
  is_frozen: boolean
  joined_at: string
  last_activity_at: string | null
}

interface ChatMessage {
  id: string
  sender: 'teacher' | 'student'
  senderName: string
  content: string
  timestamp: Date
  isPrivate: boolean
  targetStudentId?: string
}

interface TaskData {
  id: string
  title: string
  description: string | null
  task_type: string
  status: string
  due_at: string | null
  points: string | null
  created_at: string
}

interface SessionLiveData {
  session: {
    id: string
    title: string
    join_code: string
    status: string
    class_name: string
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
  const { toast } = useToast()
  const [autoRefresh] = useState(true)
  const [activeTab, setActiveTab] = useState('students')
  const [chatInput, setChatInput] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [selectedStudent, setSelectedStudent] = useState<string | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const [showTaskBuilder, setShowTaskBuilder] = useState(false)
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null)
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  
  // Fetch available LLM models
  const { data: modelsData } = useQuery({
    queryKey: ['available-models'],
    queryFn: async () => {
      const res = await llmApi.getAvailableModels()
      return res.data as { models: { provider: string; model: string; name: string; description: string }[]; default_provider: string; default_model: string }
    },
    staleTime: 1000 * 60 * 10,
  })

  // Get online users and notifications from socket
  const { onlineUsers, notifications: socketNotifications } = useSocket(sessionId || '')
  const [teacherNotifications, setTeacherNotifications] = useState<Array<{
    id: string
    type: 'student_joined' | 'student_left' | 'private_message' | 'task_submitted'
    session_id: string
    student_id: string
    nickname: string
    message: string
    preview?: string
    task_title?: string
    timestamp: string
    read: boolean
  }>>([])

  // Convert socket notifications to teacher notifications format
  useEffect(() => {
    const newNotifs = socketNotifications
      .filter(n => n.notification_data && (n.notification_data as Record<string, unknown>).type)
      .map(n => {
        const data = n.notification_data as Record<string, unknown>
        return {
          id: n.id,
          type: (data.type as string) as 'student_joined' | 'student_left' | 'private_message' | 'task_submitted',
          session_id: (data.session_id as string) || sessionId || '',
          student_id: (data.student_id as string) || '',
          nickname: (data.nickname as string) || n.sender_name || '',
          message: n.text,
          preview: data.preview as string | undefined,
          task_title: data.task_title as string | undefined,
          timestamp: n.created_at,
          read: false,
        }
      })
    
    if (newNotifs.length > 0) {
      setTeacherNotifications(prev => {
        const existingIds = new Set(prev.map(p => p.id))
        const toAdd = newNotifs.filter(n => !existingIds.has(n.id))
        return [...prev, ...toAdd]
      })
    }
  }, [socketNotifications, sessionId])

  const handleClearNotifications = () => setTeacherNotifications([])
  const handleMarkAsRead = (id: string) => {
    setTeacherNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

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
    refetchInterval: autoRefresh ? 5000 : false,
  })

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

  const handleSendMessage = () => {
    if (!chatInput.trim()) return
    
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      sender: 'teacher',
      senderName: 'Docente',
      content: chatInput,
      timestamp: new Date(),
      isPrivate: !!selectedStudent,
      targetStudentId: selectedStudent || undefined,
    }
    setChatMessages(prev => [...prev, newMessage])
    setChatInput('')
    
    // TODO: Send via Socket.IO when implemented
    toast({ title: selectedStudent ? 'Messaggio privato inviato' : 'Messaggio inviato alla classe' })
  }

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

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    toast({ title: 'Codice copiato!' })
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-800',
      active: 'bg-green-100 text-green-800',
      paused: 'bg-yellow-100 text-yellow-800',
      ended: 'bg-red-100 text-red-800',
    }
    const labels: Record<string, string> = {
      draft: 'Bozza',
      active: 'Attiva',
      paused: 'In pausa',
      ended: 'Terminata',
    }
    return (
      <span className={`px-3 py-1 rounded-full text-sm font-medium ${styles[status] || styles.draft}`}>
        {labels[status] || status}
      </span>
    )
  }

  const getModuleIcon = (key: string) => {
    const icons: Record<string, React.ReactNode> = {
      chat: <MessageSquare className="h-4 w-4" />,
      chatbot: <Bot className="h-4 w-4" />,
      classification: <Brain className="h-4 w-4" />,
      self_assessment: <ClipboardList className="h-4 w-4" />,
    }
    return icons[key] || null
  }

  if (isLoading) {
    return <p>Caricamento...</p>
  }

  if (!data) {
    return <p>Sessione non trovata</p>
  }

  const { session, students, modules } = data

  return (
    <>
      <TeacherNavbar />
      <div className="pt-16 min-h-screen bg-slate-50">
        <div className="max-w-7xl mx-auto p-6">
          <div className="flex flex-wrap items-center gap-2 md:gap-4 mb-6">
            <Link to="/teacher/sessions">
              <Button variant="ghost" size="sm">
                <ArrowLeft className="h-4 w-4 mr-1 md:mr-2" />
                <span className="hidden sm:inline">Indietro</span>
              </Button>
            </Link>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg md:text-2xl font-bold truncate">{session.title}</h2>
              <p className="text-sm text-muted-foreground truncate">{session.class_name}</p>
            </div>
            {getStatusBadge(session.status)}
          </div>

      {/* Compact Header Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-4 p-3 bg-white rounded-lg border">
        {/* Access Code + Actions */}
        <div className="flex items-center gap-2">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Codice</p>
            <code className="text-lg font-mono font-bold text-primary">{session.join_code}</code>
          </div>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => copyCode(session.join_code)}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="h-8 w-px bg-gray-200" />

        {/* Students Count */}
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <div>
            <p className="text-xs text-muted-foreground">Studenti</p>
            <p className="text-lg font-bold leading-none">{students.length}</p>
          </div>
        </div>

        <div className="h-8 w-px bg-gray-200" />

        {/* Session Controls */}
        <div className="flex items-center gap-2">
          {session.status === 'draft' && (
            <Button size="sm" onClick={() => updateStatusMutation.mutate('active')}>
              <Play className="h-3.5 w-3.5 mr-1" />
              Avvia
            </Button>
          )}
          {session.status === 'active' && (
            <>
              <Button variant="outline" size="sm" onClick={() => updateStatusMutation.mutate('paused')}>
                <Square className="h-3.5 w-3.5 mr-1" />
                Pausa
              </Button>
              <Button variant="destructive" size="sm" onClick={() => updateStatusMutation.mutate('ended')}>
                Termina
              </Button>
            </>
          )}
          {session.status === 'paused' && (
            <Button size="sm" onClick={() => updateStatusMutation.mutate('active')}>
              <Play className="h-3.5 w-3.5 mr-1" />
              Riprendi
            </Button>
          )}
        </div>

        {/* Notifications Toggle */}
        <div className="ml-auto">
          <TeacherNotifications
            notifications={teacherNotifications}
            onClearAll={handleClearNotifications}
            onMarkAsRead={handleMarkAsRead}
          />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-5 mb-4 h-auto">
          <TabsTrigger value="students" className="text-xs md:text-sm px-1 md:px-3 py-2">
            <Users className="h-4 w-4 md:mr-2 shrink-0" />
            <span className="hidden md:inline">Studenti</span>
          </TabsTrigger>
          <TabsTrigger value="modules" className="text-xs md:text-sm px-1 md:px-3 py-2">
            <Brain className="h-4 w-4 md:mr-2 shrink-0" />
            <span className="hidden md:inline">Moduli</span>
          </TabsTrigger>
          <TabsTrigger value="tasks" className="text-xs md:text-sm px-1 md:px-3 py-2">
            <ClipboardList className="h-4 w-4 md:mr-2 shrink-0" />
            <span className="hidden md:inline">Compiti</span>
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs md:text-sm px-1 md:px-3 py-2">
            <History className="h-4 w-4 md:mr-2 shrink-0" />
            <span className="hidden md:inline">Storico</span>
          </TabsTrigger>
          <TabsTrigger value="chat" className="text-xs md:text-sm px-1 md:px-3 py-2">
            <MessageSquare className="h-4 w-4 md:mr-2 shrink-0" />
            <span className="hidden md:inline">Chat</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="students">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Studenti ({students.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {students.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
                  Nessuno studente connesso.<br />
                  Condividi il codice <strong>{session.join_code}</strong> con gli studenti.
                </p>
              ) : (
                <div className="space-y-2">
                  {students.map((student) => {
                    const isOnline = onlineUsers.some(u => u.student_id === student.id)
                    return (
                    <div
                      key={student.id}
                      className={`flex items-center justify-between p-3 rounded-lg ${
                        student.is_frozen ? 'bg-blue-50 border border-blue-200' : 'bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className={`w-2.5 h-2.5 rounded-full ${
                          isOnline ? 'bg-green-500' : 'bg-gray-300'
                        }`} title={isOnline ? 'Online' : 'Offline'} />
                        <span className="font-medium">{student.nickname}</span>
                        {!isOnline && (
                          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                            Offline
                          </span>
                        )}
                        {student.is_frozen && (
                          <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded">
                            Bloccato
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setSelectedStudent(student.id === selectedStudent ? null : student.id)}
                          title="Chat privata"
                        >
                          <MessageSquare className={`h-4 w-4 ${selectedStudent === student.id ? 'text-emerald-500' : 'text-gray-400'}`} />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => 
                            student.is_frozen 
                              ? unfreezeMutation.mutate(student.id)
                              : freezeMutation.mutate(student.id)
                          }
                        >
                          {student.is_frozen ? (
                            <Sun className="h-4 w-4 text-yellow-500" />
                          ) : (
                            <Snowflake className="h-4 w-4 text-blue-500" />
                          )}
                        </Button>
                      </div>
                    </div>
                  )})}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="modules">
          <Card>
            <CardHeader>
              <CardTitle>Gestione Moduli</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Attiva o disattiva i moduli disponibili per gli studenti in questa sessione.
              </p>
              <div className="space-y-3">
                {modules.map((mod) => (
                  <div
                    key={mod.module_key}
                    className={`flex items-center justify-between p-4 rounded-lg border ${
                      mod.is_enabled ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {getModuleIcon(mod.module_key)}
                      <div>
                        <span className="font-medium capitalize">{mod.module_key.replace('_', ' ')}</span>
                        <p className="text-xs text-muted-foreground">
                          {mod.module_key === 'chatbot' && 'Assistente AI con diverse modalità'}
                          {mod.module_key === 'classification' && 'Classificazione ML: immagini, testo, dati'}
                          {mod.module_key === 'self_assessment' && 'Quiz e autovalutazione'}
                          {mod.module_key === 'chat' && 'Chat di classe'}
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={mod.is_enabled}
                      onCheckedChange={(checked: boolean) => 
                        toggleModuleMutation.mutate({ moduleKey: mod.module_key, isEnabled: checked })
                      }
                    />
                  </div>
                ))}
              </div>

              {/* Default LLM Model Selector */}
              <div className="mt-6 pt-6 border-t">
                <h4 className="font-medium mb-2 flex items-center gap-2">
                  <Bot className="h-4 w-4" />
                  Modello AI di Default
                </h4>
                <p className="text-sm text-muted-foreground mb-3">
                  Seleziona il modello AI che verrà usato di default dagli studenti in questa sessione.
                </p>
                <div className="space-y-2">
                  {modelsData?.models?.map((m: { provider: string; model: string; name: string; description: string }) => {
                    const isSelected = (data as SessionLiveData & { session: { default_llm_provider?: string; default_llm_model?: string } })?.session?.default_llm_provider === m.provider && 
                                       (data as SessionLiveData & { session: { default_llm_provider?: string; default_llm_model?: string } })?.session?.default_llm_model === m.model
                    return (
                      <label 
                        key={`${m.provider}:${m.model}`}
                        className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          isSelected ? 'bg-violet-50 border-violet-300' : 'bg-white border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <input
                          type="radio"
                          name="default_model"
                          checked={isSelected}
                          onChange={() => updateDefaultModelMutation.mutate({ provider: m.provider, model: m.model })}
                          className="w-4 h-4 text-violet-600 focus:ring-violet-500"
                        />
                        <div className="flex-1">
                          <span className="font-medium text-sm">{m.name}</span>
                          <span className="text-xs text-muted-foreground ml-2">({m.provider})</span>
                        </div>
                        {isSelected && <Check className="h-4 w-4 text-violet-600" />}
                      </label>
                    )
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tasks">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5" />
                  Compiti e Attività
                </span>
                {!showTaskBuilder && (
                  <Button size="sm" onClick={() => setShowTaskBuilder(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    Nuovo
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {showTaskBuilder && (
                <div className="mb-6">
                  <TaskBuilder
                    onSubmit={(data) => createTaskMutation.mutate(data)}
                    onCancel={() => setShowTaskBuilder(false)}
                    isLoading={createTaskMutation.isPending}
                  />
                </div>
              )}

              {!tasksData || tasksData.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  Nessun compito assegnato. Crea il primo compito sopra.
                </p>
              ) : (
                <div className="space-y-3">
                  {tasksData.map((task) => (
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
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <ConversationHistoryView 
            sessionId={sessionId!} 
            selectedConversationId={selectedConversationId}
            onSelectConversation={setSelectedConversationId}
          />
        </TabsContent>

        <TabsContent value="chat">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span className="flex items-center gap-2">
                  <MessageSquare className="h-5 w-5" />
                  {selectedStudent 
                    ? `Chat con ${students.find(s => s.id === selectedStudent)?.nickname || 'Studente'}`
                    : 'Chat di Classe'
                  }
                </span>
                {selectedStudent && (
                  <Button variant="ghost" size="sm" onClick={() => setSelectedStudent(null)}>
                    Torna alla classe
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px] overflow-y-auto bg-gray-50 rounded-lg p-4 mb-4 space-y-3">
                {chatMessages.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    {selectedStudent 
                      ? 'Inizia una conversazione privata con lo studente.'
                      : 'Invia un messaggio a tutta la classe.'
                    }
                  </p>
                ) : (
                  chatMessages
                    .filter(m => !selectedStudent || !m.isPrivate || m.targetStudentId === selectedStudent)
                    .map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.sender === 'teacher' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div className={`max-w-[70%] rounded-lg p-3 ${
                          msg.sender === 'teacher' 
                            ? 'bg-emerald-600 text-white' 
                            : 'bg-white border'
                        }`}>
                          <p className="text-sm">{msg.content}</p>
                          <p className={`text-xs mt-1 ${msg.sender === 'teacher' ? 'text-emerald-200' : 'text-gray-400'}`}>
                            {msg.timestamp.toLocaleTimeString()}
                            {msg.isPrivate && ' (privato)'}
                          </p>
                        </div>
                      </div>
                    ))
                )}
                <div ref={chatEndRef} />
              </div>
              <div className="flex gap-2">
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder={selectedStudent ? 'Messaggio privato...' : 'Messaggio alla classe...'}
                  className="flex-1"
                />
                <Button onClick={handleSendMessage} disabled={!chatInput.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
        </div>
      </div>
    </>
  )
}

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
  submitted_at: string
  score: string | null
  feedback: string | null
}

function TaskCard({ task, sessionId, isExpanded, onToggle, onPublish, onDelete }: TaskCardProps) {
  const { data: submissions, isLoading } = useQuery<SubmissionData[]>({
    queryKey: ['task-submissions', sessionId, task.id],
    queryFn: async () => {
      const res = await teacherApi.getTaskSubmissions(sessionId, task.id)
      return res.data
    },
    enabled: isExpanded && task.status === 'published',
  })

  return (
    <div className={`rounded-lg border ${task.status === 'published' ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
      <div className="flex items-center justify-between p-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{task.title}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              task.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-600'
            }`}>
              {task.status === 'published' ? 'Pubblicato' : 'Bozza'}
            </span>
            <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700 capitalize">
              {task.task_type}
            </span>
          </div>
          {task.description && (
            <p className="text-sm text-muted-foreground mt-1">{task.description}</p>
          )}
        </div>
        <div className="flex gap-2">
          {task.status === 'published' && (
            <Button size="sm" variant="outline" onClick={onToggle}>
              {isExpanded ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
              {isExpanded ? 'Chiudi' : 'Risposte'}
            </Button>
          )}
          {task.status === 'draft' && (
            <Button size="sm" variant="outline" onClick={onPublish}>
              <Check className="h-4 w-4 mr-1" />
              Pubblica
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDelete}>
            <Trash2 className="h-4 w-4 text-red-500" />
          </Button>
        </div>
      </div>

      {isExpanded && task.status === 'published' && (
        <div className="border-t p-4 bg-white rounded-b-lg">
          <h4 className="font-medium mb-3 flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Risposte degli studenti
          </h4>
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
                </div>
              ))}
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
}

interface ConversationHistoryViewProps {
  sessionId: string
  selectedConversationId: string | null
  onSelectConversation: (id: string | null) => void
}

function ConversationHistoryView({ sessionId, selectedConversationId, onSelectConversation }: ConversationHistoryViewProps) {
  const [expandedStudents, setExpandedStudents] = useState<Set<string>>(new Set())
  
  const toggleStudent = (studentId: string) => {
    setExpandedStudents(prev => {
      const next = new Set(prev)
      if (next.has(studentId)) {
        next.delete(studentId)
      } else {
        next.add(studentId)
      }
      return next
    })
  }

  const { data: conversations, isLoading: loadingConversations } = useQuery<ConversationData[]>({
    queryKey: ['session-conversations', sessionId],
    queryFn: async () => {
      const res = await llmApi.getSessionConversations(sessionId)
      return res.data
    },
    refetchInterval: 3000, // Poll every 3 seconds for new conversations
  })

  const { data: messages, isLoading: loadingMessages } = useQuery<MessageData[]>({
    queryKey: ['conversation-messages', selectedConversationId],
    queryFn: async () => {
      const res = await llmApi.getConversationMessages(selectedConversationId!)
      return res.data
    },
    enabled: !!selectedConversationId,
    refetchInterval: 2000, // Poll every 2 seconds for new messages
  })

  const selectedConversation = conversations?.find(c => c.id === selectedConversationId)

  if (loadingConversations) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Caricamento storico...
        </CardContent>
      </Card>
    )
  }

  if (!conversations || conversations.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-5 w-5" />
            Storico Chatbot
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground py-8">
            Nessuna conversazione registrata per questa sessione.
          </p>
        </CardContent>
      </Card>
    )
  }

  // Group conversations by student
  const byStudent = conversations.reduce((acc, conv) => {
    if (!acc[conv.student_id]) {
      acc[conv.student_id] = { nickname: conv.student_nickname, conversations: [] }
    }
    acc[conv.student_id].conversations.push(conv)
    return acc
  }, {} as Record<string, { nickname: string; conversations: ConversationData[] }>)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Conversations List */}
      <Card className="lg:col-span-1">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-5 w-5" />
            Storico Chatbot
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-y-auto">
            {Object.entries(byStudent).map(([studentId, { nickname, conversations: convs }]) => (
              <div key={studentId} className="border-b last:border-b-0">
                <button
                  onClick={() => toggleStudent(studentId)}
                  className="w-full px-4 py-2 bg-slate-50 font-medium text-sm flex items-center gap-2 hover:bg-slate-100 transition-colors"
                >
                  {expandedStudents.has(studentId) ? (
                    <ChevronUp className="h-4 w-4 text-slate-500" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-500" />
                  )}
                  <User className="h-4 w-4 text-slate-500" />
                  {nickname}
                  <span className="text-xs text-slate-400 ml-auto">({convs.length} chat)</span>
                </button>
                {expandedStudents.has(studentId) && convs.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => onSelectConversation(conv.id)}
                    className={`w-full text-left px-4 py-3 pl-10 hover:bg-slate-50 transition-colors border-l-4 ${
                      selectedConversationId === conv.id 
                        ? 'border-l-violet-500 bg-violet-50' 
                        : 'border-l-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium capitalize">{conv.profile_key}</span>
                      <span className="text-xs text-slate-400">{conv.message_count} msg</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {new Date(conv.updated_at).toLocaleString('it-IT')}
                    </p>
                    {conv.llm_model && (
                      <span className="text-xs bg-slate-100 px-1.5 py-0.5 rounded mt-1 inline-block">
                        {conv.llm_model}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Messages View */}
      <Card className="lg:col-span-2">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              {selectedConversation 
                ? `${selectedConversation.student_nickname} - ${selectedConversation.profile_key}`
                : 'Seleziona una conversazione'
              }
            </span>
            {selectedConversationId && (
              <Button variant="ghost" size="sm" onClick={() => onSelectConversation(null)}>
                Chiudi
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!selectedConversationId ? (
            <p className="text-center text-muted-foreground py-12">
              Seleziona una conversazione dalla lista per vedere i messaggi.
            </p>
          ) : loadingMessages ? (
            <p className="text-center text-muted-foreground py-12">
              Caricamento messaggi...
            </p>
          ) : !messages || messages.length === 0 ? (
            <p className="text-center text-muted-foreground py-12">
              Nessun messaggio in questa conversazione.
            </p>
          ) : (
            <div className="max-h-[450px] overflow-y-auto space-y-4 pr-2">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                      <Bot className="h-4 w-4 text-white" />
                    </div>
                  )}
                  <div className={`max-w-[80%] rounded-xl px-4 py-2 ${
                    msg.role === 'user' 
                      ? 'bg-slate-800 text-white' 
                      : 'bg-slate-100 text-slate-800'
                  }`}>
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                    <p className={`text-xs mt-1 ${msg.role === 'user' ? 'text-slate-400' : 'text-slate-500'}`}>
                      {new Date(msg.created_at).toLocaleTimeString('it-IT')}
                      {msg.model && ` • ${msg.model}`}
                    </p>
                  </div>
                  {msg.role === 'user' && (
                    <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center flex-shrink-0">
                      <User className="h-4 w-4 text-white" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
