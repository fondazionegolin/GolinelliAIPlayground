import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { io } from 'socket.io-client'
import { useAuthStore } from '@/stores/auth'
import { studentApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Bot, Brain, Award, MessageSquare, FileEdit,
  Loader2, ChevronRight, Sparkles, ClipboardList, FileText, LayoutDashboard,
  Home, FileCode2, Menu, BookOpen
} from 'lucide-react'
const ChatbotModule         = lazy(() => import('./ChatbotModule'))
const TasksModule           = lazy(() => import('./TasksModule'))
const ClassificationModule  = lazy(() => import('./ClassificationModule'))
const StudentDocumentsModule = lazy(() => import('./StudentDocumentsModule'))
const StudentNotebookModule = lazy(() => import('../notebook/StudentNotebookModule'))
const StudentWikiPage       = lazy(() => import('./StudentWikiPage'))
const DesktopPage           = lazy(() => import('../shared/DesktopPage'))
import ChatSidebar from '@/components/ChatSidebar'
import { LogoMark } from '@/components/LogoMark'
import { StudentNavbar } from '@/components/StudentNavbar'
import { useMobile } from '@/hooks/useMobile'
import { useSwipeBack } from '@/hooks/useSwipeBack'
import { AppBackground } from '@/components/ui/AppBackground'
import { getStudentAccentTheme, loadStudentAccent, type StudentAccentId } from '@/lib/studentAccent'
import { getAppBackgroundGradient } from '@/lib/theme'

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
  teacher?: {
    id: string
    name: string
  } | null
  enabled_modules: Array<{
    key: string
    config: Record<string, unknown>
  }>
}

type ModuleConfig = {
  label: string
  description: string
  icon: typeof Bot
  colorClass: string
  bgClass: string
  borderClass: string
  shadowClass: string
}

function getModuleConfig(t: (key: string) => string): Record<string, ModuleConfig> {
  const chatEntry: ModuleConfig = {
    label: t('student_dashboard.chat_label'),
    description: t('student_dashboard.chat_desc'),
    icon: MessageSquare,
    colorClass: 'text-sky-700',
    bgClass: 'bg-sky-100',
    borderClass: 'border-sky-200/70',
    shadowClass: 'shadow-sky-100/40',
  }
  return {
    chatbot: {
      label: t('student_dashboard.chatbot_label'),
      description: t('student_dashboard.chatbot_desc'),
      icon: Bot,
      colorClass: 'text-indigo-700',
      bgClass: 'bg-indigo-100',
      borderClass: 'border-indigo-200/70',
      shadowClass: 'shadow-indigo-100/40',
    },
    classification: {
      label: t('student_dashboard.ml_label'),
      description: t('student_dashboard.ml_desc'),
      icon: Brain,
      colorClass: 'text-emerald-700',
      bgClass: 'bg-emerald-100',
      borderClass: 'border-emerald-200/70',
      shadowClass: 'shadow-emerald-100/40',
    },
    documents: {
      label: t('student_dashboard.docs_label'),
      description: t('student_dashboard.docs_desc'),
      icon: FileEdit,
      colorClass: 'text-violet-700',
      bgClass: 'bg-violet-100',
      borderClass: 'border-violet-200/70',
      shadowClass: 'shadow-violet-100/40',
    },
    self_assessment: {
      label: t('student_dashboard.quiz_label'),
      description: t('student_dashboard.quiz_desc'),
      icon: Award,
      colorClass: 'text-amber-700',
      bgClass: 'bg-amber-100',
      borderClass: 'border-amber-200/70',
      shadowClass: 'shadow-amber-100/40',
    },
    chat: chatEntry,
    classe: chatEntry,
    desktop: {
      label: 'Desktop',
      description: 'Il tuo spazio personale con widget',
      icon: LayoutDashboard,
      colorClass: 'text-indigo-700',
      bgClass: 'bg-indigo-100',
      borderClass: 'border-indigo-200/70',
      shadowClass: 'shadow-indigo-100/40',
    },
    wiki: {
      label: 'Wiki',
      description: 'Guida completa alle funzioni della piattaforma',
      icon: BookOpen,
      colorClass: 'text-cyan-800',
      bgClass: 'bg-cyan-100',
      borderClass: 'border-cyan-200/70',
      shadowClass: 'shadow-cyan-100/40',
    },
  }
}

// Animation variants for page transitions
const pageVariants = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
}

export default function StudentDashboard() {
  const { t } = useTranslation()
  const { studentSession, logout } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const location = useLocation()
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeModule, setActiveModule] = useState<string | null>('desktop')
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [openDocumentTaskId, setOpenDocumentTaskId] = useState<string | null>(null)
  const [pendingTasksCount, setPendingTasksCount] = useState(0)
  const [lastDocument] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(380)
  const [selectedTeacherbotId, setSelectedTeacherbotId] = useState<string | null>(null)
  const [oggiImparoLesson, setOggiImparoLesson] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState(false)
  const [studentAccent, setStudentAccent] = useState<StudentAccentId>(loadStudentAccent())

  const exitStudentSession = useCallback(() => {
    localStorage.removeItem('student_token')
    logout()
    navigate('/join')
  }, [logout, navigate])

  const { isMobile } = useMobile()

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

      const notifType = (notification.notification_type || '').toString().toLowerCase()
      const taskType = (data?.task_type || '').toString().toLowerCase()
      const effectiveType = taskType || notifType

      // Teacherbot
      if (notifType === 'teacherbot_published') {
        const teacherbotId = data?.teacherbot_id
        if (teacherbotId) {
          setSelectedTeacherbotId(teacherbotId)
          setActiveModule('chatbot')
        }
        return
      }

      const taskId = data?.task_id
      const DOCUMENT_TYPES = new Set(['lesson', 'presentation', 'presentation_v2', 'document_v1', 'document'])

      if (taskId) {
        if (DOCUMENT_TYPES.has(effectiveType)) {
          // lesson / presentation → Documents module
          queryClient.invalidateQueries({ queryKey: ['student-tasks'] })
          setOpenDocumentTaskId(null)
          setTimeout(() => setOpenDocumentTaskId(taskId), 0)
          setActiveModule('documents')
        } else {
          // quiz / exercise / discussion / any other task → Tasks module
          // Invalidate so the fresh task appears immediately after module mounts
          queryClient.invalidateQueries({ queryKey: ['student-tasks'] })
          setOpenTaskId(null)
          setTimeout(() => setOpenTaskId(taskId), 0)
          setActiveModule('self_assessment')
          navigate({ search: `?taskId=${taskId}&jump=${Date.now()}` }, { replace: false })
        }
        return
      }

      // Document upload notification (document_id without task_id)
      if (data?.document_id || effectiveType === 'document') {
        setActiveModule('documents')
      }
    } catch {
      // Ignore malformed notification data
    }
  }, [navigate, queryClient])

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
        exitStudentSession()
      } finally {
        setLoading(false)
      }
    }

    fetchSession()

    const interval = setInterval(() => {
      studentApi.heartbeat().catch((error: any) => {
        const status = error?.response?.status
        if (status === 401 || status === 403) {
          exitStudentSession()
        }
      })
    }, 30000)

    return () => clearInterval(interval)
  }, [studentSession, navigate, location.search, exitStudentSession])

  useEffect(() => {
    const handleSessionRevoked = () => exitStudentSession()
    window.addEventListener('studentSessionAccessRevoked', handleSessionRevoked)
    return () => window.removeEventListener('studentSessionAccessRevoked', handleSessionRevoked)
  }, [exitStudentSession])

  useEffect(() => {
    const handlePrivateChatDisabled = () => {}
    window.addEventListener('studentPrivateChatDisabled', handlePrivateChatDisabled)
    return () => window.removeEventListener('studentPrivateChatDisabled', handlePrivateChatDisabled)
  }, [])

  useEffect(() => {
    const studentToken = localStorage.getItem('student_token')
    if (!studentToken || !sessionInfo?.session?.id) return

    const socket = io(window.location.origin, {
      path: '/socket.io',
      auth: { token: studentToken },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 2000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
    })

    socket.on('session_access_revoked', () => exitStudentSession())
    socket.on('module_toggled', (data: { module_key: string; is_enabled: boolean }) => {
      if (data.module_key === 'chat' && !data.is_enabled) {
        window.dispatchEvent(new CustomEvent('studentPrivateChatDisabled', { detail: data }))
      }
    })

    return () => {
      socket.disconnect()
    }
  }, [sessionInfo?.session?.id, exitStudentSession])

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

  // Listen for "Espandi" from OggiImparoWidget → navigate to chatbot with lesson context
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { lesson?: string; sessionName?: string }
      setOggiImparoLesson(detail.lesson ?? null)
      setActiveModule('chatbot')
    }
    window.addEventListener('oggi-imparo:expand', handler)
    return () => window.removeEventListener('oggi-imparo:expand', handler)
  }, [])

  const privateChatEnabled = sessionInfo?.enabled_modules?.some((m) => m.key === 'chat') ?? false
  const sessionModules = sessionInfo?.enabled_modules?.map(m => m.key).filter(k => k !== 'chat') ?? []
  const enabledModules = [...new Set([...sessionModules, 'classe', 'documents', 'desktop', 'wiki'])]

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

  const studentTheme = getStudentAccentTheme(loadStudentAccent())
  const bgGradient = getAppBackgroundGradient(studentTheme)

  if (isMobile) {
    return (
      <StudentMobileShell
        sessionInfo={sessionInfo}
        enabledModules={enabledModules}
        activeModule={activeModule}
        onNavigate={setActiveModule}
        pendingTasksCount={pendingTasksCount}
        lastDocument={lastDocument}
        openTaskId={openTaskId}
        privateChatEnabled={privateChatEnabled}
        studentAccent={studentAccent}
        selectedTeacherbotId={selectedTeacherbotId}
        oggiImparoLesson={oggiImparoLesson}
        onOggiImparoLessonConsumed={() => setOggiImparoLesson(null)}
        openDocumentTaskId={openDocumentTaskId}
        onOpenDocument={(taskId) => {
          setOpenDocumentTaskId(taskId)
          setActiveModule('documents')
        }}
        onTeacherbotNotificationClick={handleNotificationClick}
        onLogout={() => {
          localStorage.removeItem('student_token')
          logout()
          navigate('/join')
        }}
        swipeState={swipeState}
      />
    )
  }

  return (
    <AppBackground className="h-[100dvh] flex flex-col" gradient={bgGradient}>
      {/* Desktop Navbar - hidden on mobile */}
      <div className={`hidden md:block flex-shrink-0 ${localStorage.getItem('_preview_mode') === 'true' ? 'h-24' : 'h-16'}`}>
        <StudentNavbar
          activeModule={activeModule}
          onNavigate={setActiveModule}
          sessionTitle={sessionInfo.session.title}
          sessionId={sessionInfo.session.id}
          joinCode={sessionInfo.session.join_code}
          chatSidebarOpen={showSidebar}
          onToggleChatSidebar={() => setShowSidebar(v => !v)}
          accent={studentAccent}
          onAccentChange={setStudentAccent}
          enabledModules={enabledModules}
        />
      </div>

      {/* Main Layout with Chat Sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main Content Area */}
        <main className={`flex-1 min-h-0 relative ${activeModule === 'chatbot' || activeModule === 'classe' || activeModule === 'documents' || activeModule === 'desktop' || activeModule === 'notebook' ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'}`}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeModule || 'home'}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className={`${activeModule === 'chatbot' || activeModule === 'classe' || activeModule === 'documents' || activeModule === 'desktop' || activeModule === 'notebook' ? 'p-0 h-full min-h-0' : 'p-4 md:p-6'}`}
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
                <div className="h-full min-h-0 flex flex-col">
                  {activeModule !== 'documents' && activeModule !== 'desktop' && activeModule !== 'chatbot' && activeModule !== 'classe' && activeModule !== 'notebook' && activeModule !== 'tasks' && activeModule !== 'classification' && (
                    <div className={`mb-4 ${activeModule === 'chatbot' || activeModule === 'classe' ? 'hidden md:block' : ''}`}>
                      <Button
                        variant="ghost"
                        className="gap-2 pl-0 hover:bg-transparent text-slate-600"
                        onClick={() => setActiveModule(null)}
                      >
                        ← {t('student_dashboard.back_home')}
                      </Button>
                    </div>
                  )}

                  <Suspense fallback={
                    <div className="flex items-center justify-center h-full min-h-[40vh]">
                      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                    </div>
                  }>
                    <ModuleView
                      moduleKey={activeModule}
                      sessionId={sessionInfo.session.id}
                      sessionName={sessionInfo.session.title}
                      openTaskId={openTaskId}
                      studentId={sessionInfo.student.id}
                      studentName={sessionInfo.student.nickname}
                      onTeacherbotNotificationClick={handleNotificationClick}
                      selectedTeacherbotId={selectedTeacherbotId}
                      oggiImparoLesson={oggiImparoLesson}
                      onOggiImparoLessonConsumed={() => setOggiImparoLesson(null)}
                      studentAccent={studentAccent}
                      openDocumentTaskId={openDocumentTaskId}
                      onOpenDocument={(taskId) => {
                        setOpenDocumentTaskId(taskId)
                        setActiveModule('documents')
                      }}
                      teacherTarget={sessionInfo.teacher ?? undefined}
                      privateChatEnabled={privateChatEnabled}
                    />
                  </Suspense>
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
              teacherTarget={sessionInfo.teacher ?? undefined}
              privateChatEnabled={privateChatEnabled}
            />
          </div>
        ) : null}
      </div>

    </AppBackground>
  )
}

function StudentMobileShell({
  sessionInfo,
  enabledModules,
  activeModule,
  onNavigate,
  pendingTasksCount,
  lastDocument,
  openTaskId,
  privateChatEnabled,
  studentAccent,
  selectedTeacherbotId,
  oggiImparoLesson,
  onOggiImparoLessonConsumed,
  openDocumentTaskId,
  onOpenDocument,
  onTeacherbotNotificationClick,
  onLogout,
  swipeState,
}: {
  sessionInfo: SessionInfo
  enabledModules: string[]
  activeModule: string | null
  onNavigate: (module: string | null) => void
  pendingTasksCount: number
  lastDocument: string | null
  openTaskId: string | null
  privateChatEnabled: boolean
  studentAccent: StudentAccentId
  selectedTeacherbotId: string | null
  oggiImparoLesson: string | null
  onOggiImparoLessonConsumed: () => void
  openDocumentTaskId: string | null
  onOpenDocument: (taskId: string) => void
  onTeacherbotNotificationClick: (notification: any) => void
  onLogout: () => void
  swipeState: ReturnType<typeof useSwipeBack>
}) {
  const { t } = useTranslation()
  const [menuOpen, setMenuOpen] = useState(false)
  const studentTheme = getStudentAccentTheme(studentAccent)
  const bgGradient = getAppBackgroundGradient(studentTheme)
  const moduleConfig = getModuleConfig(t)
  const topNav = [
    { key: null as string | null, label: 'Home', icon: Home },
    { key: 'chatbot', label: 'AI', icon: Bot },
    { key: 'wiki', label: 'Wiki', icon: BookOpen },
    { key: 'classe', label: 'Classe', icon: MessageSquare },
    { key: 'documents', label: 'Docs', icon: FileText },
    { key: 'notebook', label: 'Code', icon: FileCode2 },
    { key: 'classification', label: 'ML', icon: Brain },
    { key: 'self_assessment', label: 'Task', icon: ClipboardList },
    { key: 'desktop', label: 'Desktop', icon: LayoutDashboard },
  ].filter((item) => item.key === null || enabledModules.includes(item.key))
  const activeTitle = activeModule ? (moduleConfig[activeModule]?.label || activeModule) : 'Home'
  const homeTiles = [
    { key: 'chatbot', label: 'AI', icon: Bot, meta: 'Tutor', tint: 'from-sky-500/22 to-cyan-400/8' },
    { key: 'classe', label: 'Classe', icon: MessageSquare, meta: 'Chat', tint: 'from-indigo-500/22 to-sky-400/8' },
    { key: 'documents', label: 'Docs', icon: FileText, meta: 'Scrivi', tint: 'from-violet-500/22 to-fuchsia-400/8' },
    { key: 'notebook', label: 'Code', icon: FileCode2, meta: 'Python', tint: 'from-emerald-500/22 to-teal-400/8' },
    { key: 'classification', label: 'ML', icon: Brain, meta: 'Lab', tint: 'from-amber-400/22 to-orange-400/8' },
    { key: 'self_assessment', label: 'Task', icon: ClipboardList, meta: pendingTasksCount > 0 ? `${pendingTasksCount}` : 'Ok', tint: 'from-rose-400/20 to-amber-300/10' },
  ].filter((item) => enabledModules.includes(item.key))

  const handleNavigate = (module: string | null) => {
    onNavigate(module)
    setMenuOpen(false)
  }

  return (
    <AppBackground className="h-[100dvh] flex flex-col" gradient={bgGradient}>
      {swipeState.isActive && (
        <motion.div
          className="fixed inset-0 z-40 bg-slate-950/10 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: swipeState.progress }}
        />
      )}

      <header className="fixed inset-x-0 top-0 z-50 px-2 pt-[env(safe-area-inset-top)]">
        <div className="mx-auto max-w-screen-sm rounded-[16px] border border-slate-900/10 bg-white/82 backdrop-blur-xl shadow-[0_12px_32px_rgba(15,23,42,0.14)]">
          <div className="flex h-13 items-center gap-2 px-2.5">
            <button
              onClick={() => setMenuOpen((value) => !value)}
              className="flex h-10 items-center gap-2 rounded-[12px] border border-slate-200 bg-slate-950 px-2.5 text-white shadow-sm"
              aria-label="Apri menu"
            >
              <LogoMark className="h-5 w-auto" />
              <Menu className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleNavigate(null)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2 text-left"
            >
              <div className="truncate text-sm font-semibold text-slate-950">{activeTitle === 'Home' ? sessionInfo.session.title : activeTitle}</div>
            </button>
          </div>
        </div>
        <AnimatePresence>
          {menuOpen && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.16 }}
              className="mx-auto mt-2 max-w-screen-sm rounded-[18px] border border-slate-900/10 bg-white/92 p-2 backdrop-blur-xl shadow-[0_18px_48px_rgba(15,23,42,0.18)]"
            >
              <div className="grid grid-cols-4 gap-2">
                {topNav.map((item) => {
                  const Icon = item.icon
                  const isActive = activeModule === item.key || (item.key === null && activeModule === null)
                  return (
                    <button
                      key={item.label}
                      onClick={() => handleNavigate(item.key)}
                      className={`flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-[14px] border px-2 py-2 text-[11px] font-semibold transition ${
                        isActive ? 'border-slate-950 bg-slate-950 text-white shadow-md' : 'border-slate-200 bg-slate-50 text-slate-700'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  )
                })}
                <button
                  onClick={onLogout}
                  className="col-span-4 flex min-h-[48px] items-center justify-center rounded-[14px] border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-700"
                >
                  Esci
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className={`flex-1 min-h-0 ${menuOpen ? 'pt-[calc(env(safe-area-inset-top)+8.9rem)]' : 'pt-[calc(env(safe-area-inset-top)+4.1rem)]'}`}>
        <AnimatePresence mode="wait">
          <motion.div
            key={activeModule || 'mobile-home'}
            variants={pageVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.22, ease: 'easeInOut' }}
            className="h-full min-h-0 px-2 pb-2"
            style={swipeState.isActive ? { transform: `translateX(${swipeState.x}px)` } : undefined}
          >
            {!activeModule ? (
              <div className="mx-auto flex h-full max-w-screen-sm flex-col gap-2 overflow-hidden pb-16">
                <section className="rounded-[16px] border border-slate-900/10 bg-white/86 p-3 shadow-[0_10px_26px_rgba(15,23,42,0.10)]">
                  <div className="flex items-center gap-2">
                    <LogoMark className="h-9 w-auto" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-950">{sessionInfo.session.title}</div>
                      <div className="truncate text-[11px] font-medium text-slate-600">{sessionInfo.student.nickname}</div>
                    </div>
                    <button
                      onClick={() => handleNavigate('documents')}
                      className="rounded-[12px] border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] font-semibold text-sky-800"
                    >
                      Docs
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <CompactStat label="Task" value={pendingTasksCount > 0 ? `${pendingTasksCount}` : '0'} />
                    <CompactStat label="Ultimo" value={lastDocument ? 'Doc' : 'AI'} />
                    <CompactStat label="Mode" value="Full" />
                  </div>
                </section>

                <section className="grid flex-1 auto-rows-fr grid-cols-2 gap-2">
                  {homeTiles.map((tile) => {
                    const Icon = tile.icon
                    return (
                      <button
                      key={tile.key}
                      onClick={() => handleNavigate(tile.key)}
                        className={`rounded-[16px] border p-3 text-left shadow-sm ${getMobileTileClass(tile.key, tile.tint)}`}
                      >
                        <div className="flex h-9 w-9 items-center justify-center rounded-[12px] border border-black/5 bg-white/75 text-slate-900 shadow-sm">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="mt-4 text-sm font-semibold text-slate-900">{tile.label}</div>
                        <div className="mt-1 text-[11px] font-medium text-slate-700">{tile.meta}</div>
                      </button>
                    )
                  })}
                  {enabledModules.includes('desktop') && (
                    <button
                      onClick={() => handleNavigate('desktop')}
                      className="col-span-2 flex items-center justify-between rounded-[16px] border border-slate-200 bg-white px-4 py-3 text-left shadow-sm"
                    >
                      <div>
                        <div className="text-sm font-semibold text-slate-900">Desktop</div>
                        <div className="text-[11px] font-medium text-slate-600">Workspace completo</div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    </button>
                  )}
                </section>
              </div>
            ) : (
              <div className="mx-auto flex h-full max-w-screen-sm min-h-0 flex-col overflow-hidden rounded-[16px] border border-slate-900/10 bg-white/90 shadow-[0_18px_48px_rgba(15,23,42,0.14)]">
                <div className="flex items-center gap-3 border-b border-slate-200 px-3 py-2.5">
                  <button onClick={() => handleNavigate(null)} className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700">
                    Home
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-slate-900">{activeTitle}</div>
                    <div className="truncate text-[11px] text-slate-500">{sessionInfo.session.title}</div>
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>}>
                    <ModuleView
                      moduleKey={activeModule}
                      sessionId={sessionInfo.session.id}
                      sessionName={sessionInfo.session.title}
                      openTaskId={openTaskId}
                      studentId={sessionInfo.student.id}
                      studentName={sessionInfo.student.nickname}
                      onTeacherbotNotificationClick={onTeacherbotNotificationClick}
                      selectedTeacherbotId={selectedTeacherbotId}
                      oggiImparoLesson={oggiImparoLesson}
                      onOggiImparoLessonConsumed={onOggiImparoLessonConsumed}
                      studentAccent={studentAccent}
                      openDocumentTaskId={openDocumentTaskId}
                      onOpenDocument={onOpenDocument}
                      teacherTarget={sessionInfo.teacher ?? undefined}
                      privateChatEnabled={privateChatEnabled}
                    />
                  </Suspense>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {activeModule !== 'chatbot' && (
        <button
          onClick={() => handleNavigate('chatbot')}
          className="fixed bottom-4 right-3 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-slate-950 text-white shadow-[0_18px_40px_rgba(15,23,42,0.28)]"
        >
          <Bot className="h-4.5 w-4.5" />
        </button>
      )}
    </AppBackground>
  )
}

function CompactStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/35 bg-white/45 px-3 py-2 backdrop-blur-xl">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className="mt-1 truncate text-sm font-semibold text-slate-900">{value}</div>
    </div>
  )
}

function getMobileTileClass(key: string, tint: string) {
  const base = 'bg-gradient-to-br'
  if (key === 'chatbot') return `${base} from-sky-100 to-cyan-50 border-sky-200`
  if (key === 'classe') return `${base} from-indigo-100 to-sky-50 border-indigo-200`
  if (key === 'documents') return `${base} from-violet-100 to-fuchsia-50 border-violet-200`
  if (key === 'notebook') return `${base} from-emerald-100 to-teal-50 border-emerald-200`
  if (key === 'classification') return `${base} from-amber-100 to-orange-50 border-amber-200`
  if (key === 'self_assessment') return `${base} from-rose-100 to-amber-50 border-rose-200`
  return `${base} ${tint} border-slate-200`
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
  const { t } = useTranslation()
  const moduleConfig = getModuleConfig(t)

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
          <h2 className="text-xl font-bold mb-1">{t('student_dashboard.welcome', { name: sessionInfo.student.nickname })} 👋</h2>
          <p className="text-fuchsia-100 text-sm opacity-90">
            {t('student_dashboard.welcome_body_mobile')}
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
            <h3 className="font-semibold text-slate-800 text-sm">{t('student_dashboard.tasks_label')}</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {pendingTasksCount > 0 ? (
                <span className="text-orange-600 font-medium">{t('student_dashboard.tasks_pending', { count: pendingTasksCount })}</span>
              ) : (
                t('student_dashboard.tasks_all_done')
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
            <h3 className="font-semibold text-slate-800 text-sm">{t('student_dashboard.docs_label')}</h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">
              {lastDocument || t('student_dashboard.docs_your_work')}
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
          <h3 className="font-semibold text-slate-700 text-sm px-1">{t('student_dashboard.explore')}</h3>
          {enabledModules.filter(k => !['self_assessment', 'documents'].includes(k)).map((moduleKey) => {
            const config = moduleConfig[moduleKey] || {
              label: moduleKey,
              description: t('student_dashboard.module_active'),
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
                className={`w-full flex items-center gap-4 p-4 rounded-xl border backdrop-blur-sm bg-white/70 transition-all shadow-sm active:scale-95 active:bg-white/90 ${config.borderClass} text-left`}
              >
                <div className={`w-11 h-11 rounded-xl ${config.bgClass} flex items-center justify-center ${config.colorClass} flex-shrink-0`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-slate-800 text-sm">{config.label}</h4>
                  <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">{config.description}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-slate-300 flex-shrink-0" />
              </motion.button>
            )
          })}
        </div>
      </div>
    )
  }

  // Desktop view
  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-5xl mx-auto w-full p-6 md:p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">{t('student_dashboard.tools_title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('student_dashboard.tools_subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {enabledModules.map((moduleKey) => {
          const config = moduleConfig[moduleKey] || {
            label: moduleKey,
            description: t('student_dashboard.module_active'),
            icon: Bot,
            colorClass: 'text-slate-600',
            bgClass: 'bg-white',
            borderClass: 'border-slate-200',
            shadowClass: 'shadow-slate-100'
          }
          const Icon = config.icon

          return (
            <button
              key={moduleKey}
              onClick={() => onNavigate(moduleKey)}
              className={`group text-left bg-white/80 backdrop-blur-sm rounded-xl border p-6 flex items-start gap-4 hover:shadow-md hover:bg-white transition-all duration-200 ${config.borderClass}`}
            >
              <div className={`w-12 h-12 rounded-xl ${config.bgClass} flex items-center justify-center ${config.colorClass} flex-shrink-0`}>
                <Icon className="h-6 w-6" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className={`font-bold text-base ${config.colorClass} mb-1`}>{config.label}</h3>
                <p className="text-slate-500 text-sm leading-relaxed">{config.description}</p>
              </div>
              <ChevronRight className={`h-5 w-5 mt-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all ${config.colorClass}`} />
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ModuleView({ moduleKey, sessionId, sessionName, openTaskId, studentId, studentName, onTeacherbotNotificationClick, selectedTeacherbotId, oggiImparoLesson, onOggiImparoLessonConsumed, studentAccent, openDocumentTaskId, onOpenDocument, teacherTarget, privateChatEnabled }: {
  moduleKey: string;
  sessionId: string;
  sessionName?: string;
  openTaskId?: string | null;
  studentId?: string;
  studentName?: string;
  onTeacherbotNotificationClick?: (notification: any) => void;
  selectedTeacherbotId?: string | null;
  oggiImparoLesson?: string | null;
  onOggiImparoLessonConsumed?: () => void;
  studentAccent: StudentAccentId;
  openDocumentTaskId?: string | null;
  onOpenDocument?: (taskId: string) => void;
  teacherTarget?: { id: string; name: string };
  privateChatEnabled?: boolean;
}) {
  const { t } = useTranslation()
  // Class chat module - full screen ChatSidebar
  if (moduleKey === 'classe' || moduleKey === 'chat') {
    return (
      <div className="h-[calc(100dvh-7rem)] md:h-[calc(100vh-6rem)] -mx-4 md:mx-0">
        <ChatSidebar
          sessionId={sessionId}
          userType="student"
          currentUserId={studentId || ''}
          currentUserName={studentName || t('student_dashboard.student_default')}
          studentAccent={studentAccent}
          isMobileView={true}
          className="h-full"
          onNotificationClick={onTeacherbotNotificationClick}
          teacherTarget={teacherTarget}
          privateChatEnabled={privateChatEnabled}
        />
      </div>
    )
  }

  if (moduleKey === 'chatbot') {
    return (
      <div className="h-[calc(100dvh-7rem)] md:h-full md:min-h-0 flex flex-col overflow-hidden md:p-5">
        <ChatbotModule
          sessionId={sessionId}
          studentId={studentId}
          initialTeacherbotId={selectedTeacherbotId}
          oggiImparoContext={oggiImparoLesson ?? undefined}
          onOggiImparoContextConsumed={onOggiImparoLessonConsumed}
          studentAccent={studentAccent}
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
        <ClassificationModule sessionId={sessionId} />
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

  if (moduleKey === 'notebook') {
    return (
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        <StudentNotebookModule />
      </div>
    )
  }

  if (moduleKey === 'desktop') {
    return (
      <div className="h-[calc(100dvh-7rem)] md:h-full flex flex-col overflow-hidden">
        <Suspense fallback={<div className="flex items-center justify-center h-full"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}>
          <DesktopPage sessionId={sessionId} sessionName={sessionName} userType="student" accentColor={getStudentAccentTheme(loadStudentAccent()).accent} />
        </Suspense>
      </div>
    )
  }

  if (moduleKey === 'wiki') {
    return (
      <div className="h-full overflow-y-auto">
        <StudentWikiPage />
      </div>
    )
  }

  return null
}
