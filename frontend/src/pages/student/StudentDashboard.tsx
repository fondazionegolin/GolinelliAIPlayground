import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { studentApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { 
  Bot, Brain, Award, MessageSquare,
  Loader2
} from 'lucide-react'
import ChatbotModule from './ChatbotModule'
import TasksModule from './TasksModule'
import ClassificationModule from './ClassificationModule'
import ChatSidebar from '@/components/ChatSidebar'
import { ChatMessage } from '@/hooks/useSocket'
import { MobileNav } from '@/components/student/MobileNav'
import { StudentNavbar } from '@/components/StudentNavbar'

interface SessionInfo {
  session: {
    id: string
    title: string
    status: string
    join_code: string
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

const moduleConfig: Record<string, {
  label: string
  description: string
  icon: typeof Bot
  colorClass: string
  bgClass: string
  borderClass: string
  shadowClass: string
}> = {
  chatbot: {
    label: 'Chatbot AI',
    description: 'Il tuo assistente personale intelligente. Chiedi aiuto, genera idee o fatti spiegare concetti complessi.',
    icon: Bot,
    colorClass: 'text-indigo-600',
    bgClass: 'bg-indigo-50/50 hover:bg-indigo-50',
    borderClass: 'border-indigo-100 hover:border-indigo-200',
    shadowClass: 'shadow-indigo-100/50',
  },
  classification: {
    label: 'ML Lab',
    description: 'Laboratorio di Machine Learning. Addestra modelli per classificare testi e immagini in tempo reale.',
    icon: Brain,
    colorClass: 'text-emerald-600',
    bgClass: 'bg-emerald-50/50 hover:bg-emerald-50',
    borderClass: 'border-emerald-100 hover:border-emerald-200',
    shadowClass: 'shadow-emerald-100/50',
  },
  self_assessment: {
    label: 'Quiz & Badge',
    description: 'Mettiti alla prova! Completa quiz, ottieni badge e traccia i tuoi progressi nell\'apprendimento.',
    icon: Award,
    colorClass: 'text-orange-600',
    bgClass: 'bg-orange-50/50 hover:bg-orange-50',
    borderClass: 'border-orange-100 hover:border-orange-200',
    shadowClass: 'shadow-orange-100/50',
  },
  chat: {
    label: 'Chat Classe',
    description: 'Comunica con la tua classe.',
    icon: MessageSquare,
    colorClass: 'text-sky-600',
    bgClass: 'bg-sky-50',
    borderClass: 'border-sky-200',
    shadowClass: 'shadow-sky-100',
  }
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
    // Handle all task types: quiz, exercise, presentation, lesson, document_task
    const taskTypes = ['quiz', 'task', 'exercise', 'presentation', 'lesson', 'document_task']
    if (notifType && taskTypes.includes(notifType)) {
      const taskId = notification.notification_data?.task_id as string | undefined
      if (taskId) {
        setOpenTaskId(taskId)
        // Switch to tasks module (will close chat on mobile automatically)
        setActiveModule('self_assessment')
      }
    } else if (notifType === 'document') {
      // Switch to RAG/documents module
      setActiveModule('rag')
    }
  }

  const isChatActive = activeModule === 'chat'

  return (
    <div className="min-h-[100dvh] bg-slate-50 lg:bg-gradient-to-br lg:from-slate-50 lg:to-gray-100 lg:pr-80 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
      {/* Student Navbar */}
      <StudentNavbar 
        activeModule={activeModule} 
        onNavigate={setActiveModule}
        sessionTitle={sessionInfo.session.title}
        joinCode={sessionInfo.session.join_code}
        sessionId={sessionInfo.session.id}
        onNotificationClick={handleNotificationClick}
      />

      {/* Main Content Area - with top padding for fixed navbar */}
      <main className={`max-w-6xl mx-auto ${activeModule ? 'p-0 md:p-6 pt-24' : 'p-4 md:p-6 min-h-screen flex flex-col justify-center pt-28'} transition-all duration-300`}>
        {!activeModule ? (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto w-full">
            {/* Welcome Banner Mobile */}
            <div className="md:hidden bg-gradient-to-br from-indigo-600 to-violet-600 rounded-2xl p-6 text-white shadow-lg shadow-indigo-200 mb-8">
              <h2 className="text-2xl font-bold mb-2">Ciao, {sessionInfo.student.nickname}! 👋</h2>
              <p className="text-indigo-100 opacity-90 text-sm">
                Benvenuto nella tua area di apprendimento AI. Seleziona un modulo per iniziare.
              </p>
            </div>

            <div className="px-1">
              <h2 className="text-2xl font-bold text-slate-800 mb-2">Strumenti disponibili</h2>
              <p className="text-slate-500 mb-6">Seleziona un'attività per iniziare il tuo percorso.</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {enabledModules.map((moduleKey) => {
                const config = moduleConfig[moduleKey] || {
                  label: moduleKey,
                  description: 'Modulo attivo',
                  icon: Bot,
                  colorClass: 'text-slate-600',
                  bgClass: 'bg-white',
                  borderClass: 'border-slate-200',
                  shadowClass: 'shadow-slate-100'
                }
                const Icon = config.icon

                return (
                  <Card 
                    key={moduleKey} 
                    className={`cursor-pointer transition-all duration-300 group relative overflow-hidden border-2 ${config.borderClass} ${config.bgClass} hover:shadow-xl ${config.shadowClass}`}
                    onClick={() => setActiveModule(moduleKey)}
                  >
                    <div className={`absolute top-0 right-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity ${config.colorClass}`}>
                      <Icon className="w-32 h-32 -mr-10 -mt-10 transform group-hover:rotate-12 transition-transform duration-500" />
                    </div>

                    <CardContent className="p-6 sm:p-8 flex flex-col items-start gap-4 relative z-10 h-full">
                      <div className={`w-14 h-14 rounded-2xl bg-white shadow-sm flex items-center justify-center ${config.colorClass} ring-4 ring-white/50`}>
                        <Icon className="h-7 w-7" />
                      </div>
                      
                      <div className="space-y-2">
                        <h3 className={`font-bold text-xl ${config.colorClass}`}>{config.label}</h3>
                        <p className="text-slate-600 font-medium leading-relaxed">
                          {config.description}
                        </p>
                      </div>

                      <div className="mt-auto pt-4 flex items-center text-sm font-semibold opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                        <span className={config.colorClass}>Inizia ora</span>
                        <svg className={`w-4 h-4 ml-2 ${config.colorClass}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                        </svg>
                      </div>
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
