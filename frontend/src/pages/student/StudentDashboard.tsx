import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { studentApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { 
  Bot, Brain, Award, MessageSquare, LogOut,
  Loader2, User
} from 'lucide-react'
import ChatbotModule from './ChatbotModule'
import TasksModule from './TasksModule'
import ClassificationModule from './ClassificationModule'
import ChatSidebar from '@/components/ChatSidebar'
import { ChatMessage } from '@/hooks/useSocket'
import { MobileNav } from '@/components/student/MobileNav'

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
  classification: 'ML Lab',
  self_assessment: 'Quiz & Badge',
  chat: 'Chat Classe',
}

export default function StudentDashboard() {
  const { studentSession, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
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
        
        // Check for direct task link via query param
        const searchParams = new URLSearchParams(location.search)
        const taskId = searchParams.get('taskId')
        if (taskId) {
          setActiveModule('self_assessment')
          setOpenTaskId(taskId)
        }
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
  }, [studentSession, navigate, logout, location.search])

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

  // Filter out 'chat' module since it's handled separately in navigation
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

  const isChatActive = activeModule === 'chat'

  return (
    <div className="min-h-[100dvh] bg-slate-50 lg:bg-gradient-to-br lg:from-slate-50 lg:to-gray-100 lg:pr-80 pb-20 lg:pb-0">
      {/* Header - Simplified on Mobile */}
      <header className="bg-white border-b sticky top-0 z-40 px-4 md:px-6 py-3 shadow-sm lg:shadow-none">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 md:gap-4 min-w-0">
            <img 
              src="/golinelli-logo.svg" 
              alt="Golinelli" 
              className="h-8 w-auto object-contain shrink-0"
              style={{ maxWidth: '40px' }}
            />
            <div className="min-w-0">
              <h1 className="text-base md:text-xl font-bold text-slate-800 truncate leading-tight">
                {activeModule && activeModule !== 'chat' ? moduleLabels[activeModule] : sessionInfo.session.title}
              </h1>
              {!activeModule && (
                <p className="text-xs md:text-sm text-muted-foreground truncate hidden md:block">
                  Ciao, <span className="font-medium">{sessionInfo.student.nickname}</span>!
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!activeModule && (
              <div className="flex items-center gap-2 md:hidden bg-slate-100 px-3 py-1.5 rounded-full">
                <User className="h-4 w-4 text-slate-500" />
                <span className="text-xs font-medium text-slate-700 max-w-[80px] truncate">
                  {sessionInfo.student.nickname}
                </span>
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={logout} className="shrink-0 h-8 w-8 p-0 md:h-9 md:w-auto md:px-4">
              <LogOut className="h-4 w-4 md:mr-2" />
              <span className="hidden md:inline">Esci</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className={`max-w-6xl mx-auto ${activeModule ? 'p-0 md:p-6' : 'p-4 md:p-6'} h-full`}>
        {!activeModule ? (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Welcome Banner Mobile */}
            <div className="md:hidden bg-gradient-to-br from-violet-600 to-indigo-600 rounded-2xl p-6 text-white shadow-lg mb-6">
              <h2 className="text-2xl font-bold mb-2">Ciao, {sessionInfo.student.nickname}! 👋</h2>
              <p className="text-violet-100 opacity-90 text-sm">
                Benvenuto nella tua area di apprendimento AI. Seleziona un modulo per iniziare.
              </p>
            </div>

            <div className="flex items-center justify-between mb-4 px-1">
              <h2 className="text-lg font-semibold text-slate-800">Strumenti disponibili</h2>
            </div>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
              {enabledModules.map((moduleKey) => {
                const Icon = moduleIcons[moduleKey] || Bot
                const label = moduleLabels[moduleKey] || moduleKey
                return (
                  <Card 
                    key={moduleKey} 
                    className="cursor-pointer hover:shadow-lg hover:scale-[1.02] transition-all border-0 shadow-sm md:border active:scale-95 duration-200"
                    onClick={() => setActiveModule(moduleKey)}
                  >
                    <CardContent className="p-4 md:p-6 flex flex-col items-center justify-center text-center aspect-[4/3] md:aspect-square">
                      <div className="w-12 h-12 md:w-16 md:h-16 rounded-2xl bg-slate-50 flex items-center justify-center mb-3 md:mb-4 group-hover:bg-violet-50 transition-colors">
                        <Icon className="h-6 w-6 md:h-8 md:w-8 text-violet-600" />
                      </div>
                      <h3 className="font-semibold text-sm md:text-base text-slate-700">{label}</h3>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="h-full">
            <div className="md:mb-4 hidden md:block">
              <Button 
                variant="ghost" 
                className="gap-2 pl-0 hover:bg-transparent"
                onClick={() => setActiveModule(null)}
              >
                ← Torna alla home
              </Button>
            </div>
            
            {/* Mobile-optimized container */}
            <div className={`${isChatActive ? 'h-[calc(100dvh-130px)] md:h-auto' : ''}`}>
              {activeModule === 'chat' ? (
                // Mobile Chat View (replaces Sidebar)
                <div className="h-full bg-white md:rounded-xl md:border md:shadow-sm overflow-hidden">
                  <ChatSidebar
                    sessionId={sessionInfo.session.id}
                    userType="student"
                    currentUserId={sessionInfo.student.id}
                    currentUserName={sessionInfo.student.nickname}
                    onNotificationClick={handleNotificationClick}
                    isMobileView={true} // We'll need to support this prop or adapt styling
                  />
                </div>
              ) : (
                <ModuleView moduleKey={activeModule} sessionId={sessionInfo.session.id} openTaskId={openTaskId} />
              )}
            </div>
          </div>
        )}
      </main>
      
      {/* Desktop Sidebar - Always visible on desktop */}
      <div className="hidden lg:block">
        <ChatSidebar
          sessionId={sessionInfo.session.id}
          userType="student"
          currentUserId={sessionInfo.student.id}
          currentUserName={sessionInfo.student.nickname}
          onNotificationClick={handleNotificationClick}
        />
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav 
        activeModule={activeModule} 
        onNavigate={setActiveModule}
      />
    </div>
  )
}

function ModuleView({ moduleKey, sessionId, openTaskId }: { moduleKey: string; sessionId: string; openTaskId?: string | null }) {
  if (moduleKey === 'chatbot') {
    return (
      <div className="h-[calc(100dvh-120px)] md:h-auto">
        <ChatbotModule sessionId={sessionId} />
      </div>
    )
  }

  if (moduleKey === 'self_assessment') {
    return (
      <Card className="border-0 md:border shadow-none md:shadow-sm h-full">
        <CardContent className="p-0 h-full">
          <TasksModule openTaskId={openTaskId} />
        </CardContent>
      </Card>
    )
  }

  if (moduleKey === 'classification') {
    return (
      <div className="pb-4">
        <ClassificationModule />
      </div>
    )
  }

  return null
}
