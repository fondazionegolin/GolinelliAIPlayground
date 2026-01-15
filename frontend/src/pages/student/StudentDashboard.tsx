import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { studentApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { 
  Bot, Brain, Award, MessageSquare, LogOut,
  Loader2
} from 'lucide-react'
import ChatbotModule from './ChatbotModule'
import TasksModule from './TasksModule'
import ClassificationModule from './ClassificationModule'
import ChatSidebar from '@/components/ChatSidebar'
import { ChatMessage } from '@/hooks/useSocket'

interface SessionInfo {
  session: {
    id: string
    title: string
    status: string
  }
  student: {
    id: string
    nickname: string
    is_frozen: boolean
  }
  enabled_modules: Array<{
    key: string
    config: Record<string, unknown>
  }>
}

const moduleIcons: Record<string, typeof Bot> = {
  chatbot: Bot,
  classification: Brain,
  self_assessment: Award,
  chat: MessageSquare,
}

const moduleLabels: Record<string, string> = {
  chatbot: 'Chatbot AI',
  classification: 'Classificazione ML',
  self_assessment: 'Quiz & Badge',
  chat: 'Chat Classe',
}

export default function StudentDashboard() {
  const { studentSession, logout } = useAuthStore()
  const navigate = useNavigate()
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeModule, setActiveModule] = useState<string | null>(null)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)

  useEffect(() => {
    if (!studentSession) {
      navigate('/join')
      return
    }

    const fetchSession = async () => {
      try {
        const response = await studentApi.getSession()
        setSessionInfo(response.data)
      } catch {
        logout()
        navigate('/join')
      } finally {
        setLoading(false)
      }
    }

    fetchSession()

    const interval = setInterval(() => {
      studentApi.heartbeat().catch(() => {})
    }, 30000)

    return () => clearInterval(interval)
  }, [studentSession, navigate, logout])

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-100 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
      </div>
    )
  }

  if (!sessionInfo) {
    return null
  }

  // Filter out 'chat' module since it's always available in sidebar
  const enabledModules = sessionInfo.enabled_modules.map(m => m.key).filter(k => k !== 'chat')

  const handleNotificationClick = (notification: ChatMessage) => {
    const notifType = notification.notification_type
    if (notifType === 'quiz' || notifType === 'task') {
      const taskId = notification.notification_data?.task_id as string | undefined
      setOpenTaskId(taskId || null)
      setActiveModule('self_assessment')
    } else if (notifType === 'document') {
      setActiveModule('rag')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-gray-100 lg:pr-80">
      <header className="bg-white border-b px-4 md:px-6 py-3 md:py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 md:gap-4 min-w-0">
            <img 
              src="/golinelli-logo.svg" 
              alt="Golinelli" 
              className="h-8 w-auto object-contain shrink-0"
              style={{ maxWidth: '40px' }}
            />
            <div className="min-w-0">
              <h1 className="text-lg md:text-xl font-bold text-slate-800 truncate">{sessionInfo.session.title}</h1>
              <p className="text-xs md:text-sm text-muted-foreground truncate">
                Ciao, <span className="font-medium">{sessionInfo.student.nickname}</span>!
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={logout} className="shrink-0">
            <LogOut className="h-4 w-4 md:mr-2" />
            <span className="hidden md:inline">Esci</span>
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {!activeModule ? (
          <>
            <h2 className="text-lg font-semibold mb-4">Strumenti disponibili</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {enabledModules.map((moduleKey) => {
                const Icon = moduleIcons[moduleKey] || Bot
                const label = moduleLabels[moduleKey] || moduleKey
                return (
                  <Card 
                    key={moduleKey} 
                    className="cursor-pointer hover:shadow-md transition-shadow"
                    onClick={() => setActiveModule(moduleKey)}
                  >
                    <CardContent className="p-6 text-center">
                      <Icon className="h-10 w-10 mx-auto mb-3 text-emerald-600" />
                      <h3 className="font-medium">{label}</h3>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </>
        ) : (
          <div>
            <Button 
              variant="ghost" 
              className="mb-4"
              onClick={() => setActiveModule(null)}
            >
              ← Torna alla home
            </Button>
            <ModuleView moduleKey={activeModule} sessionId={sessionInfo.session.id} openTaskId={openTaskId} />
          </div>
        )}
      </main>
      
      <ChatSidebar
        sessionId={sessionInfo.session.id}
        userType="student"
        currentUserId={sessionInfo.student.id}
        currentUserName={sessionInfo.student.nickname}
        onNotificationClick={handleNotificationClick}
      />
    </div>
  )
}

function ModuleView({ moduleKey, sessionId, openTaskId }: { moduleKey: string; sessionId: string; openTaskId?: string | null }) {
  const label = moduleLabels[moduleKey] || moduleKey

  if (moduleKey === 'chatbot') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{label}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ChatbotModule sessionId={sessionId} />
        </CardContent>
      </Card>
    )
  }

  if (moduleKey === 'self_assessment') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{label}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <TasksModule openTaskId={openTaskId} />
        </CardContent>
      </Card>
    )
  }

  if (moduleKey === 'classification') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{label}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ClassificationModule />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground">
          Modulo {label} - Interfaccia in sviluppo
        </p>
        {moduleKey === 'chat' && (
          <div className="mt-4 p-4 bg-gray-50 rounded-lg">
            <p className="text-sm">
              Chat di classe per comunicare con il docente e i compagni.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
