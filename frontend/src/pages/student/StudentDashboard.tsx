import { useEffect, useState, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useAuthStore } from '@/stores/auth'
import { studentApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Bot, Brain, Award, MessageSquare, FileEdit,
  Loader2, ChevronRight, Sparkles, ClipboardList, FileText
} from 'lucide-react'
import ChatbotModule from './ChatbotModule'
import TasksModule from './TasksModule'
import ClassificationModule from './ClassificationModule'
import StudentDocumentsModule from './StudentDocumentsModule'
import ChatSidebar from '@/components/ChatSidebar'
import { MobileNav } from '@/components/student/MobileNav'
import { MobileHeader } from '@/components/student/MobileHeader'
import { StudentNavbar } from '@/components/StudentNavbar'
import { useMobile, useKeyboard } from '@/hooks/useMobile'
import { useSwipeBack } from '@/hooks/useSwipeBack'
import { AppBackground } from '@/components/ui/AppBackground'
import { loadStudentAccent, type StudentAccentId } from '@/lib/studentAccent'

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
    bgClass: 'bg-indigo-500/5 hover:bg-indigo-500/10',
    borderClass: 'border-indigo-500/20 hover:border-indigo-500/40',
    shadowClass: 'shadow-indigo-100/30',
  },
  classification: {
    label: 'ML Lab',
    description: 'Laboratorio di Machine Learning. Addestra modelli per classificare testi e immagini in tempo reale.',
    icon: Brain,
    colorClass: 'text-emerald-600',
    bgClass: 'bg-emerald-500/5 hover:bg-emerald-500/10',
    borderClass: 'border-emerald-500/20 hover:border-emerald-500/40',
    shadowClass: 'shadow-emerald-100/30',
  },
  documents: {
    label: 'Editor Documenti',
    description: 'Crea documenti e presentazioni. Invia i tuoi lavori al docente per la revisione.',
    icon: FileEdit,
    colorClass: 'text-violet-600',
    bgClass: 'bg-violet-500/5 hover:bg-violet-500/10',
    borderClass: 'border-violet-500/20 hover:border-violet-500/40',
    shadowClass: 'shadow-violet-100/30',
  },
  self_assessment: {
    label: 'Quiz & Badge',
    description: 'Mettiti alla prova! Completa quiz, ottieni badge e traccia i tuoi progressi nell\'apprendimento.',
    icon: Award,
    colorClass: 'text-orange-600',
    bgClass: 'bg-orange-500/5 hover:bg-orange-500/10',
    borderClass: 'border-orange-500/20 hover:border-orange-500/40',
    shadowClass: 'shadow-orange-100/30',
  },
  chat: {
    label: 'Chat Classe',
    description: 'Comunica con la tua classe.',
    icon: MessageSquare,
    colorClass: 'text-sky-600',
    bgClass: 'bg-sky-500/5',
    borderClass: 'border-sky-500/20',
    shadowClass: 'shadow-sky-100/30',
  },
  classe: {
    label: 'Chat Classe',
    description: 'Comunica con la tua classe.',
    icon: MessageSquare,
    colorClass: 'text-sky-600',
    bgClass: 'bg-sky-500/5',
    borderClass: 'border-sky-500/20',
    shadowClass: 'shadow-sky-100/30',
  }
}

// Animation variants for page transitions
const pageVariants = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
}

export default function StudentDashboard() {
  const { studentSession, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeModule, setActiveModule] = useState<string | null>(null)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [openDocumentTaskId, setOpenDocumentTaskId] = useState<string | null>(null)
  const [pendingTasksCount, setPendingTasksCount] = useState(0)
  const [lastDocument] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(380)
  const [selectedTeacherbotId, setSelectedTeacherbotId] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState(false)
  const [studentAccent, setStudentAccent] = useState<StudentAccentId>(loadStudentAccent())

  const { isMobile } = useMobile()
  const { isOpen: isKeyboardOpen } = useKeyboard()

  // Handle swipe back on mobile
  const handleSwipeBack = useCallback(() => {
    if (activeModule) {
      setActiveModule(null)
    }
  }, [activeModule])

  const handleNotificationClick = useCallback((notification: any) => {
    try {
      const data = typeof notification.notification_data === 'string'
        ? JSON.parse(notification.notification_data)
        : notification.notification_data

      const notifType = notification.notification_type
      const effectiveType = (data?.task_type || notifType || '').toString().toLowerCase()
      const taskId = data?.task_id
      if (taskId && (effectiveType === 'quiz' || effectiveType === 'exercise' || effectiveType === 'task')) {
        setOpenTaskId(null)
        setTimeout(() => setOpenTaskId(taskId), 0)
        setActiveModule('self_assessment')
        navigate({ search: `?taskId=${taskId}&jump=${Date.now()}` }, { replace: false })
        return
      }

      if (taskId && (effectiveType === 'lesson' || effectiveType === 'presentation' || effectiveType === 'document')) {
        setOpenDocumentTaskId(null)
        setTimeout(() => setOpenDocumentTaskId(taskId), 0)
        setActiveModule('documents')
        return
      }

      if (effectiveType === 'document') {
        setActiveModule('documents')
        return
      }

      const teacherbotId = data?.teacherbot_id
      if (notifType === 'teacherbot_published' && teacherbotId) {
        setSelectedTeacherbotId(teacherbotId)
        setActiveModule('chatbot')
      }
    } catch {
      // Ignore malformed notification data
    }
  }, [navigate])

  const swipeState = useSwipeBack({
    onSwipeBack: handleSwipeBack,
    enabled: isMobile && activeModule !== null,
  })

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

        // Fetch pending tasks count for the home card
        try {
          const tasksResponse = await studentApi.getTasks()
          const pending = tasksResponse.data.filter((t: { status: string }) => t.status === 'pending').length
          setPendingTasksCount(pending)
        } catch {
          // Ignore if tasks API fails
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
      studentApi.heartbeat().catch(() => { })
    }, 30000)

    return () => clearInterval(interval)
  }, [studentSession, navigate, logout, location.search])

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1100) {
        setShowSidebar(false)
      }
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Get header config based on active module
  const getHeaderConfig = () => {
    if (!activeModule) {
      return { title: 'GolinelliAI', showBack: false }
    }
    const config = moduleConfig[activeModule]
    return {
      title: config?.label || activeModule,
      showBack: true,
    }
  }

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

  // Filter out 'chat' module since it's handled separately
  // Always include 'documents' module for students
  const sessionModules = sessionInfo.enabled_modules.map(m => m.key).filter(k => k !== 'chat')
  const enabledModules = [...new Set([...sessionModules, 'documents'])]

  const headerConfig = getHeaderConfig()

  return (
    <AppBackground className="h-[100dvh] flex flex-col">
      {/* Desktop Navbar - hidden on mobile */}
      <div className="hidden md:block h-16 flex-shrink-0">
        <StudentNavbar
          activeModule={activeModule}
          onNavigate={setActiveModule}
          sessionTitle={sessionInfo.session.title}
          sessionId={sessionInfo.session.id}
          chatSidebarOpen={showSidebar}
          onToggleChatSidebar={() => setShowSidebar(v => !v)}
          accent={studentAccent}
          onAccentChange={setStudentAccent}
        />
      </div>

      {/* Mobile Header - only on mobile */}
      {isMobile && (
        <MobileHeader
          title={headerConfig.title}
          showBack={headerConfig.showBack}
          onBack={() => setActiveModule(null)}
          avatar={!headerConfig.showBack ? sessionInfo.student.nickname : undefined}
        />
      )}

      {/* Swipe back overlay */}
      {swipeState.isActive && (
        <motion.div
          className="fixed inset-0 bg-black/10 z-40 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: swipeState.progress }}
        />
      )}

      {/* Main Layout with Chat Sidebar */}
      <div className={`flex flex-1 overflow-hidden ${isMobile ? 'pt-14' : ''}`}>
        {/* Main Content Area */}
        <main className={`flex-1 relative ${activeModule === 'chatbot' || activeModule === 'classe' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeModule || 'home'}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className={`${activeModule === 'chatbot' || activeModule === 'classe' || activeModule === 'documents' ? 'p-0 md:p-6 h-full' : 'p-4 md:p-6'}`}
              style={swipeState.isActive ? { transform: `translateX(${swipeState.x}px)` } : undefined}
            >
              {!activeModule ? (
                <HomeView
                  sessionInfo={sessionInfo}
                  enabledModules={enabledModules}
                  onNavigate={setActiveModule}
                  pendingTasksCount={pendingTasksCount}
                  lastDocument={lastDocument}
                  isMobile={isMobile}
                />
              ) : (
                <div className="h-full flex flex-col">
                  {activeModule !== 'documents' && (
                    <div className={`mb-4 ${activeModule === 'chatbot' || activeModule === 'classe' ? 'hidden md:block' : ''}`}>
                      <Button
                        variant="ghost"
                        className="gap-2 pl-0 hover:bg-transparent text-slate-600"
                        onClick={() => setActiveModule(null)}
                      >
                        ← Torna alla home
                      </Button>
                    </div>
                  )}

                  <ModuleView
                    moduleKey={activeModule}
                    sessionId={sessionInfo.session.id}
                    openTaskId={openTaskId}
                    studentId={sessionInfo.student.id}
                    studentName={sessionInfo.student.nickname}
                    onTeacherbotNotificationClick={handleNotificationClick}
                    selectedTeacherbotId={selectedTeacherbotId}
                    studentAccent={studentAccent}
                    openDocumentTaskId={openDocumentTaskId}
                    onOpenDocument={(taskId) => {
                      setOpenDocumentTaskId(taskId)
                      setActiveModule('documents')
                    }}
                  />
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        {showSidebar ? (
          <div
            className="hidden lg:block border-l border-slate-200 bg-white flex-shrink-0 relative"
            style={{ width: `${sidebarWidth}px`, height: '100%' }}
          >
            <ChatSidebar
              sessionId={sessionInfo.session.id}
              userType="student"
              currentUserId={sessionInfo.student.id}
              currentUserName={sessionInfo.student.nickname}
              studentAccent={studentAccent}
              isPinned={true}
              onPinToggle={() => setShowSidebar(false)}
              onToggle={() => { }}
              onWidthChange={setSidebarWidth}
              initialWidth={sidebarWidth}
              className="h-full w-full"
              onNotificationClick={handleNotificationClick}
            />
          </div>
        ) : null}
      </div>

      {/* Mobile Bottom Navigation */}
      <MobileNav
        activeModule={activeModule}
        onNavigate={setActiveModule}
        hidden={isKeyboardOpen}
      />
    </AppBackground>
  )
}

// Home View Component
function HomeView({
  sessionInfo,
  enabledModules,
  onNavigate,
  pendingTasksCount,
  lastDocument,
  isMobile,
}: {
  sessionInfo: SessionInfo
  enabledModules: string[]
  onNavigate: (module: string | null) => void
  pendingTasksCount: number
  lastDocument: string | null
  isMobile: boolean
}) {
  // Quick start AI profiles
  const quickStartProfiles = [
    { key: 'tutor', label: 'Tutor', icon: '📚' },
    { key: 'quiz', label: 'Quiz', icon: '📝' },
    { key: 'math_coach', label: 'Math', icon: '🔢' },
  ]

  if (isMobile) {
    return (
      <div className="space-y-4 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-300">
        {/* Welcome Banner */}
        <div className="bg-gradient-to-br from-fuchsia-500 via-purple-500 to-violet-600 rounded-2xl p-5 text-white shadow-lg shadow-fuchsia-200/50">
          <h2 className="text-xl font-bold mb-1">Ciao, {sessionInfo.student.nickname}! 👋</h2>
          <p className="text-fuchsia-100 text-sm opacity-90">
            Pronto per una nuova sessione di apprendimento?
          </p>
        </div>

        {/* Tasks & Documents Cards */}
        <div className="grid grid-cols-2 gap-3">
          {/* Tasks Card */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => onNavigate('self_assessment')}
            className="bg-white/60 backdrop-blur-md rounded-xl p-4 border border-orange-500/20 shadow-sm text-left group active:bg-orange-500/10 transition-all"
          >
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center mb-3 group-active:bg-orange-500/20 transition-colors">
              <ClipboardList className="h-5 w-5 text-orange-600" />
            </div>
            <h3 className="font-semibold text-slate-800 text-sm">Compiti</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {pendingTasksCount > 0 ? (
                <span className="text-orange-600 font-medium">{pendingTasksCount} da fare</span>
              ) : (
                'Tutto fatto!'
              )}
            </p>
            <ChevronRight className="h-4 w-4 text-slate-300 absolute top-4 right-3" />
          </motion.button>

          {/* Documents Card */}
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => onNavigate('documents')}
            className="bg-white/60 backdrop-blur-md rounded-xl p-4 border border-violet-500/20 shadow-sm text-left group active:bg-violet-500/10 transition-all relative"
          >
            <div className="w-10 h-10 rounded-xl bg-violet-500/10 flex items-center justify-center mb-3 group-active:bg-violet-500/20 transition-colors">
              <FileText className="h-5 w-5 text-violet-600" />
            </div>
            <h3 className="font-semibold text-slate-800 text-sm">Documenti</h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {lastDocument || 'I tuoi lavori'}
            </p>
            <ChevronRight className="h-4 w-4 text-slate-300 absolute top-4 right-3" />
          </motion.button>
        </div>

        {/* Quick Start AI */}
        <div className="bg-white rounded-xl p-4 border border-slate-100 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-indigo-500" />
            <h3 className="font-semibold text-slate-800 text-sm">Quick Start AI</h3>
          </div>
          <div className="flex gap-2">
            {quickStartProfiles.map((profile) => (
              <motion.button
                key={profile.key}
                whileTap={{ scale: 0.95 }}
                onClick={() => onNavigate('chatbot')}
                className="flex-1 py-2.5 px-3 bg-gradient-to-br from-indigo-50 to-blue-50 rounded-xl border border-indigo-100 text-center active:from-indigo-100 active:to-blue-100 transition-colors"
              >
                <span className="text-lg">{profile.icon}</span>
                <p className="text-xs font-medium text-indigo-700 mt-0.5">{profile.label}</p>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Module Grid for remaining modules */}
        <div className="space-y-3">
          <h3 className="font-semibold text-slate-700 text-sm px-1">Esplora</h3>
          {enabledModules.filter(k => !['self_assessment', 'documents'].includes(k)).map((moduleKey) => {
            const config = moduleConfig[moduleKey] || {
              label: moduleKey,
              description: 'Modulo attivo',
              icon: Bot,
              colorClass: 'text-slate-600',
              bgClass: 'bg-white',
              borderClass: 'border-slate-200',
            }
            const Icon = config.icon

            return (
              <motion.button
                key={moduleKey}
                whileTap={{ scale: 0.98 }}
                onClick={() => onNavigate(moduleKey)}
                className={`w-full flex items-center gap-4 p-4 rounded-xl border backdrop-blur-md transition-all shadow-sm active:scale-95 ${config.borderClass} ${config.bgClass} text-left`}
              >
                <div className={`w-12 h-12 rounded-xl bg-white/80 shadow-sm flex items-center justify-center ${config.colorClass}`}>
                  <Icon className="h-6 w-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className={`font-bold ${config.colorClass}`}>{config.label}</h4>
                  <p className="text-xs text-slate-500 line-clamp-1">{config.description}</p>
                </div>
                <ChevronRight className="h-5 w-5 text-slate-300" />
              </motion.button>
            )
          })}
        </div>
      </div>
    )
  }

  // Desktop view - original layout
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto w-full pt-4">
      {/* Welcome Banner Mobile */}
      <div className="md:hidden bg-gradient-to-br from-fuchsia-600 to-purple-600 rounded-3xl p-6 text-white shadow-lg shadow-fuchsia-200 mb-8">
        <h2 className="text-2xl font-bold mb-2">Ciao, {sessionInfo.student.nickname}!</h2>
        <p className="text-fuchsia-100 opacity-90 text-sm">
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
              className={`cursor-pointer transition-all duration-300 group relative overflow-hidden border-2 rounded-3xl backdrop-blur-md ${config.borderClass} ${config.bgClass} hover:shadow-xl ${config.shadowClass}`}
              onClick={() => onNavigate(moduleKey)}
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
  )
}

function ModuleView({ moduleKey, sessionId, openTaskId, studentId, studentName, onTeacherbotNotificationClick, selectedTeacherbotId, studentAccent, openDocumentTaskId, onOpenDocument }: {
  moduleKey: string;
  sessionId: string;
  openTaskId?: string | null;
  studentId?: string;
  studentName?: string;
  onTeacherbotNotificationClick?: (notification: any) => void;
  selectedTeacherbotId?: string | null;
  studentAccent: StudentAccentId;
  openDocumentTaskId?: string | null;
  onOpenDocument?: (taskId: string) => void;
}) {
  // Class chat module - full screen ChatSidebar
  if (moduleKey === 'classe' || moduleKey === 'chat') {
    return (
      <div className="h-[calc(100dvh-7rem)] md:h-[calc(100vh-6rem)] -mx-4 md:mx-0">
        <ChatSidebar
          sessionId={sessionId}
          userType="student"
          currentUserId={studentId || ''}
          currentUserName={studentName || 'Studente'}
          studentAccent={studentAccent}
          isMobileView={true}
          className="h-full"
          onNotificationClick={onTeacherbotNotificationClick}
        />
      </div>
    )
  }

  if (moduleKey === 'chatbot') {
    return (
      <div className="h-[calc(100dvh-7rem)] md:h-full flex flex-col overflow-y-auto">
        <ChatbotModule
          sessionId={sessionId}
          initialTeacherbotId={selectedTeacherbotId}
        />
      </div>
    )
  }

  if (moduleKey === 'self_assessment') {
    return (
      <Card className="border-0 md:border shadow-none md:shadow-sm h-full">
        <CardContent className="p-0 h-full">
          <TasksModule 
            openTaskId={openTaskId} 
            onOpenDocument={onOpenDocument}
          />
        </CardContent>
      </Card>
    )
  }

  if (moduleKey === 'classification') {
    return (
      <div className="pb-20 md:pb-4">
        <ClassificationModule />
      </div>
    )
  }

  if (moduleKey === 'documents') {
    return (
      <div className="h-[calc(100dvh-7rem)] md:h-full">
        <StudentDocumentsModule sessionId={sessionId} openLessonTaskId={openDocumentTaskId} />
      </div>
    )
  }

  return null
}
