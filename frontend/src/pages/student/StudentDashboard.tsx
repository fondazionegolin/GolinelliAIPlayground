import { useEffect, useState, useCallback, useRef, lazy, Suspense, type ComponentType, type SVGProps } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { io } from 'socket.io-client'
import { useAuthStore } from '@/stores/auth'
import { boardsApi, studentApi } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import {
  Bot, Brain, Award, MessageSquare, FileEdit,
  Loader2, ChevronRight, Sparkles, ClipboardList, FileText, LayoutDashboard,
  Home, Menu, BookOpen, Code2, KanbanSquare, X, LogOut, Radio, Video, Wifi
} from 'lucide-react'
import { AcademicAiIcon } from '@/components/icons/AcademicAiIcon'
const ChatbotModule         = lazy(() => import('./ChatbotModule'))
const TasksModule           = lazy(() => import('./TasksModule'))
const ClassificationModule  = lazy(() => import('./ClassificationModule'))
const StudentDocumentsModule = lazy(() => import('./StudentDocumentsModule'))
const StudentNotebookModule = lazy(() => import('../notebook/StudentNotebookModule'))
const StudentWikiPage       = lazy(() => import('./StudentWikiPage'))
const StudentCodingLabModule = lazy(() => import('./StudentCodingLabModule'))
const BoardManager = lazy(() => import('@/components/boards/BoardManager'))
const DesktopPage           = lazy(() => import('../shared/DesktopPage'))
import ChatSidebar from '@/components/ChatSidebar'
import { LogoMark } from '@/components/LogoMark'
import { StudentNavbar } from '@/components/StudentNavbar'
import LiveInteractionStudentOverlay from '@/components/LiveInteractionStudentOverlay'
import { FloatingHelper } from '@/components/FloatingHelper'
import { useMobile } from '@/hooks/useMobile'
import { useSwipeBack } from '@/hooks/useSwipeBack'
import { AppBackground } from '@/components/ui/AppBackground'
import { getStudentAccentTheme, loadStudentAccent, type StudentAccentId } from '@/lib/studentAccent'
import { getAppBackgroundGradient } from '@/lib/theme'
import { publishRealtimeEvent, usePlatformRealtimeSync } from '@/lib/realtimeEvents'

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
    is_enabled?: boolean
    config: Record<string, unknown>
  }>
}

type StudentTaskSummary = {
  task_type: string
  submission: { id: string } | null
}

const NON_SUBMITTABLE_TASK_TYPES = new Set(['lesson', 'presentation', 'student_submission'])

type ModuleConfig = {
  label: string
  description: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
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
      icon: AcademicAiIcon,
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
      label: t('student_nav.desktop_label'),
      description: t('student_nav.desktop_desc'),
      icon: LayoutDashboard,
      colorClass: 'text-indigo-700',
      bgClass: 'bg-indigo-100',
      borderClass: 'border-indigo-200/70',
      shadowClass: 'shadow-indigo-100/40',
    },
    wiki: {
      label: t('student_nav.wiki_label'),
      description: t('student_nav.wiki_desc'),
      icon: BookOpen,
      colorClass: 'text-cyan-800',
      bgClass: 'bg-cyan-100',
      borderClass: 'border-cyan-200/70',
      shadowClass: 'shadow-cyan-100/40',
    },
    coding: {
      label: t('navbar.nav_coding_lab'),
      description: t('student_nav.coding_desc'),
      icon: Code2,
      colorClass: 'text-slate-800',
      bgClass: 'bg-slate-100',
      borderClass: 'border-slate-200/80',
      shadowClass: 'shadow-slate-100/40',
    },
    boards: {
      label: 'Board',
      description: 'Organizza task e idee con la classe',
      icon: KanbanSquare,
      colorClass: 'text-sky-800',
      bgClass: 'bg-sky-100',
      borderClass: 'border-sky-200/80',
      shadowClass: 'shadow-sky-100/40',
    },
  }
}

// Animation variants for page transitions
const pageVariants = {
  initial: { opacity: 0, x: 20 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -20 },
}

const MOBILE_MODULE_ORDER: Array<string | null> = [null, 'chatbot', 'live', 'classe', 'self_assessment', 'documents']

export default function StudentDashboard() {
  const { studentSession, logout } = useAuthStore()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  usePlatformRealtimeSync(queryClient)
  const location = useLocation()
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeModule, setActiveModule] = useState<string | null>(() => (
    typeof window !== 'undefined' && window.innerWidth < 768 ? null : 'chatbot'
  ))
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const [openDocumentTaskId, setOpenDocumentTaskId] = useState<string | null>(null)
  const [lastDocument] = useState<string | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(380)
  const [selectedTeacherbotId, setSelectedTeacherbotId] = useState<string | null>(null)
  const [oggiImparoLesson, setOggiImparoLesson] = useState<string | null>(null)
  const [showSidebar, setShowSidebar] = useState(false)
  const [studentAccent, setStudentAccent] = useState<StudentAccentId>(loadStudentAccent())
  const [sharedCodingProject, setSharedCodingProject] = useState<{ projectId: string; nonce: number } | null>(null)
  const [studentChatSidebarOpen, setStudentChatSidebarOpen] = useState(false)

  const { data: studentTasks = [] } = useQuery<StudentTaskSummary[]>({
    queryKey: ['student-tasks'],
    queryFn: async () => (await studentApi.getTasks()).data,
    enabled: Boolean(studentSession),
  })
  const pendingTasksCount = studentTasks.filter(
    (task) => !task.submission && !NON_SUBMITTABLE_TASK_TYPES.has(task.task_type),
  ).length
  const { data: sharedBoards = [] } = useQuery<{ id: string; title: string; visibility: string }[]>({
    queryKey: ['student-shared-boards', sessionInfo?.session.id],
    queryFn: async () => (await boardsApi.list()).data,
    enabled: Boolean(sessionInfo?.session.id),
  })

  const exitStudentSession = useCallback(() => {
    localStorage.removeItem('student_token')
    logout()
    navigate('/join')
  }, [logout, navigate])

  const { isMobile } = useMobile()

  useEffect(() => {
    const handleOpenSharedProject = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail
      if (!detail?.projectId) return
      setSharedCodingProject({ projectId: detail.projectId, nonce: Date.now() })
      setActiveModule('coding')
      setShowSidebar(false)
    }
    window.addEventListener('coding-lab-open-shared-project', handleOpenSharedProject)
    return () => window.removeEventListener('coding-lab-open-shared-project', handleOpenSharedProject)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('module') === 'coding' && params.get('project')) {
      setActiveModule('coding')
      setShowSidebar(false)
    }
  }, [location.search])

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
    const refreshTasks = () => {
      queryClient.invalidateQueries({ queryKey: ['student-tasks'] })
    }
    window.addEventListener('student-task-published', refreshTasks)
    return () => window.removeEventListener('student-task-published', refreshTasks)
  }, [queryClient])

  useEffect(() => {
    const studentToken = localStorage.getItem('student_token')
    const studentId = studentSession?.student_id
    if (!studentToken || !studentId || !sessionInfo?.session?.id) return

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
    socket.on('document_uploaded', (data: { document_id: string; filename: string }) => {
      publishRealtimeEvent('document_uploaded', data)
      window.dispatchEvent(new CustomEvent('student-document-uploaded', { detail: data }))
    })
    socket.on('task_published', (data: { task_id: string; title: string; task_type: string }) => {
      publishRealtimeEvent('task_published', data)
      window.dispatchEvent(new CustomEvent('student-task-published', { detail: data }))
    })
    socket.on('board_shared', (data: Record<string, any>) => publishRealtimeEvent('board_shared', data))
    socket.on('task_correction', (data: Record<string, any>) => {
      if (data.student_id === studentId) publishRealtimeEvent('task_correction', data)
    })
    socket.on('task_feedback_published', (data: Record<string, any>) => {
      if (data.student_id === studentId) publishRealtimeEvent('task_feedback_published', data)
    })
    socket.on('platform_change', (data: Record<string, any>) => publishRealtimeEvent('platform_change', data))
    socket.on('share_chat_invite', (data: Record<string, any>) => publishRealtimeEvent('share_chat_invite', data))
    socket.on('share_chat_mention', (data: Record<string, any>) => publishRealtimeEvent('share_chat_mention', data))
    socket.on('module_toggled', (data: { module_key: string; is_enabled: boolean }) => {
      publishRealtimeEvent('module_toggled', data)
      setSessionInfo((previous) => {
        if (!previous) return previous
        const modules = previous.enabled_modules || []
        const existing = modules.find((module) => module.key === data.module_key)
        const enabled_modules = existing
          ? modules.map((module) => module.key === data.module_key ? { ...module, is_enabled: data.is_enabled } : module)
          : [...modules, { key: data.module_key, is_enabled: data.is_enabled, config: {} }]
        return { ...previous, enabled_modules }
      })
      if (data.module_key === 'chat' && !data.is_enabled) {
        window.dispatchEvent(new CustomEvent('studentPrivateChatDisabled', { detail: data }))
      }
    })

    return () => {
      socket.disconnect()
    }
  }, [sessionInfo?.session?.id, studentSession?.student_id, exitStudentSession])

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

  const privateChatEnabled = sessionInfo?.enabled_modules?.some((m) => m.key === 'chat' && m.is_enabled !== false) ?? false
  const collaborationEnabled = sessionInfo?.enabled_modules?.some((m) => m.key === 'chat_collaboration' && m.is_enabled !== false) ?? false
  const sessionModules = sessionInfo?.enabled_modules?.filter((m) => m.is_enabled !== false).map(m => m.key).filter(k => k !== 'chat' && k !== 'chat_collaboration') ?? []
  const enabledModules = [...new Set([...sessionModules, 'classe', 'documents', ...(sharedBoards.length ? ['boards'] : [])])]
  const chatbotEnabled = enabledModules.includes('chatbot')

  const dockStudentChat = () => {
    setStudentChatSidebarOpen(true)
    if (activeModule === 'chatbot') {
      setActiveModule(null)
    }
  }

  const expandStudentChat = () => {
    setStudentChatSidebarOpen(false)
    setActiveModule('chatbot')
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
        openTaskId={openTaskId}
        privateChatEnabled={privateChatEnabled}
        collaborationEnabled={collaborationEnabled}
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
          pendingTasksCount={pendingTasksCount}
        />
      </div>

      {/* Main Layout with Chat Sidebar */}
      <div className="flex flex-1 overflow-hidden md:pl-16 xl:pl-0">
        {/* Main Content Area */}
        <main className={`min-h-0 relative ${activeModule === 'chatbot' ? 'hidden' : 'flex-1'} ${activeModule ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'}`}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeModule || 'home'}
              variants={pageVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              className={`${activeModule ? 'p-0 h-full min-h-0' : 'p-4 md:p-6'}`}
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
                      collaborationEnabled={collaborationEnabled}
                      sharedCodingProject={sharedCodingProject}
                      onModuleBack={() => setActiveModule(null)}
                    />
                  </Suspense>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </main>

        {chatbotEnabled && sessionInfo && (
          <motion.div
            layout
            transition={{ type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }}
            className={`overflow-hidden bg-white ${
              activeModule === 'chatbot'
                ? 'relative flex-1 h-full border-l-0 opacity-100'
                : studentChatSidebarOpen
                  ? 'relative flex-shrink-0 h-full border-l border-slate-200 opacity-100'
                  : 'pointer-events-none flex-shrink-0 h-full border-l-0 opacity-0'
            }`}
            style={{
              width: activeModule === 'chatbot' ? 'auto' : studentChatSidebarOpen ? 460 : 0,
              transformOrigin: 'right bottom',
            }}
            aria-hidden={activeModule !== 'chatbot' && !studentChatSidebarOpen}
          >
            <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}>
              <ChatbotModule
                sessionId={sessionInfo.session.id}
                studentId={sessionInfo.student.id}
                initialTeacherbotId={selectedTeacherbotId}
                oggiImparoContext={oggiImparoLesson ?? undefined}
                onOggiImparoContextConsumed={() => setOggiImparoLesson(null)}
                studentAccent={studentAccent}
                collaborationEnabled={collaborationEnabled}
                onMinimize={dockStudentChat}
                onExpand={expandStudentChat}
                onClose={() => setStudentChatSidebarOpen(false)}
                sidebarMode={activeModule !== 'chatbot' && studentChatSidebarOpen}
                dockArmed={studentChatSidebarOpen}
              />
            </Suspense>
          </motion.div>
        )}
        {sessionInfo ? (
          <div
            className={`hidden h-full flex-shrink-0 overflow-hidden bg-white transition-[width,opacity] duration-200 lg:block ${
              showSidebar ? 'relative border-l border-slate-200 opacity-100' : 'pointer-events-none border-l-0 opacity-0'
            }`}
            style={{ width: showSidebar ? `${sidebarWidth}px` : 0, height: '100%' }}
            aria-hidden={!showSidebar}
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
      <FloatingHelper module={activeModule} />
      {sessionInfo && (
        <LiveInteractionStudentOverlay sessionId={sessionInfo.session.id} />
      )}
    </AppBackground>
  )
}

function StudentMobileShell({
  sessionInfo,
  enabledModules,
  activeModule,
  onNavigate,
  pendingTasksCount,
  openTaskId,
  privateChatEnabled,
  collaborationEnabled,
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
  openTaskId: string | null
  privateChatEnabled: boolean
  collaborationEnabled: boolean
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
  const [studentChatSidebarOpen, setStudentChatSidebarOpen] = useState(false)
  const previousModule = useRef<string | null>(activeModule)
  const previousIndex = MOBILE_MODULE_ORDER.indexOf(previousModule.current)
  const currentIndex = MOBILE_MODULE_ORDER.indexOf(activeModule)
  const slideDirection = currentIndex >= previousIndex ? 1 : -1
  const studentTheme = getStudentAccentTheme(studentAccent)
  const bgGradient = getAppBackgroundGradient(studentTheme)
  const moduleConfig = getModuleConfig(t)
  const topNav = [
    { key: null as string | null, label: 'Home', detail: sessionInfo.session.title, icon: Home },
    { key: 'chatbot', label: 'Tutor AI', detail: 'Il tuo chatbot personale', icon: AcademicAiIcon },
    { key: 'live', label: 'Sessione live', detail: 'Attività in tempo reale', icon: Radio },
    { key: 'classe', label: 'Classe', detail: 'Chat e videocall', icon: Video },
    { key: 'self_assessment', label: t('navbar.nav_tasks'), detail: pendingTasksCount ? `${pendingTasksCount} assegnati` : 'Tutto in ordine', icon: ClipboardList },
    { key: 'documents', label: t('navbar.nav_documents'), detail: 'Materiali in sola lettura', icon: FileText },
  ].filter((item) => item.key === null || item.key === 'live' || ['chatbot', 'classe', 'documents'].includes(item.key) || enabledModules.includes(item.key))
  const activeItem = topNav.find((item) => item.key === activeModule)
  const activeTitle = activeItem?.label || moduleConfig[activeModule || '']?.label || 'Home'
  const isImmersiveModule = !!activeModule && activeModule !== 'live'
  const primaryTiles = topNav.filter((item) => item.key && item.key !== 'documents')

  useEffect(() => {
    if (activeModule && !MOBILE_MODULE_ORDER.includes(activeModule)) onNavigate(null)
  }, [activeModule, onNavigate])

  useEffect(() => {
    if (!menuOpen) return
    const previousOverflow = document.body.style.overflow
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [menuOpen])

  const handleNavigate = (module: string | null) => {
    previousModule.current = activeModule
    onNavigate(module)
    setMenuOpen(false)
  }

  const dockStudentChat = () => {
    setStudentChatSidebarOpen(true)
    if (activeModule === 'chatbot') {
      onNavigate(null)
    }
  }

  const expandStudentChat = () => {
    setStudentChatSidebarOpen(false)
    onNavigate('chatbot')
  }

  return (
    <AppBackground className="mobile-student-app h-[100dvh] flex flex-col overflow-hidden" gradient={bgGradient}>
      {swipeState.isActive && (
        <motion.div
          className="fixed inset-0 z-40 bg-slate-950/10 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: swipeState.progress }}
        />
      )}

      <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-200/80 bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur-2xl">
        <div className="mx-auto flex h-16 max-w-screen-sm items-center gap-3 px-4">
            <button
              onClick={() => setMenuOpen((value) => !value)}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg shadow-slate-950/15 active:scale-95"
              aria-label={t('student_dashboard.explore')}
            >
              <Menu className="h-6 w-6" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-bold uppercase tracking-[0.16em] text-sky-700">{sessionInfo.session.title}</p>
              <h1 className="truncate text-lg font-extrabold tracking-tight text-slate-950">{activeTitle}</h1>
            </div>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sm font-black text-sky-800 ring-1 ring-sky-100">
              {sessionInfo.student.nickname.slice(0, 2).toUpperCase()}
            </div>
        </div>
      </header>

      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-[60] bg-slate-950/45 backdrop-blur-sm"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setMenuOpen(false)}
            />
            <motion.aside
              initial={{ x: '-100%' }} animate={{ x: 0 }} exit={{ x: '-100%' }}
              transition={{ type: 'spring', stiffness: 420, damping: 38 }}
              className="fixed inset-y-0 left-0 z-[70] flex w-[min(88vw,360px)] flex-col bg-white px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] shadow-2xl"
            >
              <div className="mb-6 flex items-center gap-3 px-1">
                <LogoMark className="h-11 w-11" />
                <div className="min-w-0 flex-1">
                  <div className="brand-wordmark text-lg">Golinelli<span className="brand-wordmark-ai">.ai</span></div>
                  <p className="truncate text-xs font-semibold text-slate-500">{sessionInfo.student.nickname}</p>
                </div>
                <button onClick={() => setMenuOpen(false)} className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-700" aria-label="Chiudi menu">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex-1 space-y-2 overflow-y-auto" aria-label="Navigazione studente">
                {topNav.map((item) => {
                  const Icon = item.icon
                  const isActive = activeModule === item.key || (item.key === null && activeModule === null)
                  return (
                    <button
                      key={item.label}
                      onClick={() => handleNavigate(item.key)}
                      className={`flex min-h-[64px] w-full items-center gap-4 rounded-[20px] px-4 py-3 text-left transition active:scale-[0.98] ${
                        isActive ? 'bg-slate-950 text-white shadow-lg shadow-slate-950/15' : 'bg-slate-50 text-slate-800'
                      }`}
                    >
                      <span className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isActive ? 'bg-white/15' : 'bg-white text-sky-700 shadow-sm'}`}>
                        <Icon className="h-5 w-5" />
                        {item.key === 'self_assessment' && pendingTasksCount > 0 && (
                          <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#fe004d] px-1 text-[10px] font-black text-white ring-2 ring-white">
                            {pendingTasksCount > 9 ? '9+' : pendingTasksCount}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-extrabold">{item.label}</span>
                        <span className={`block truncate text-xs ${isActive ? 'text-white/60' : 'text-slate-500'}`}>{item.detail}</span>
                      </span>
                      <ChevronRight className="h-5 w-5 opacity-40" />
                    </button>
                  )
                })}
              </nav>
              <button onClick={onLogout} className="mt-4 flex min-h-[56px] w-full items-center justify-center gap-3 rounded-[20px] bg-rose-50 font-bold text-rose-700 active:scale-[0.98]">
                <LogOut className="h-5 w-5" /> {t('navbar.logout')}
              </button>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <main className="min-h-0 flex-1 pt-[calc(env(safe-area-inset-top)+4rem)]">
        <AnimatePresence mode="popLayout" custom={slideDirection}>
          <motion.div
            key={activeModule || 'mobile-home'}
            custom={slideDirection}
            variants={{
              initial: (direction: number) => ({ opacity: 0, x: direction * 72 }),
              animate: { opacity: 1, x: 0 },
              exit: (direction: number) => ({ opacity: 0, x: direction * -56 }),
            }}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.75 }}
            className={`h-full min-h-0 ${isImmersiveModule ? 'px-0' : 'px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]'}`}
            style={swipeState.isActive ? { transform: `translateX(${swipeState.x}px)` } : undefined}
          >
            {!activeModule ? (
              <div className="mx-auto h-full max-w-screen-sm overflow-y-auto overscroll-contain py-4">
                <section className="relative overflow-hidden rounded-[30px] bg-slate-950 p-6 text-white shadow-[0_22px_50px_rgba(15,23,42,0.22)]">
                  <div className="absolute -right-14 -top-16 h-44 w-44 rounded-full bg-sky-400/25 blur-2xl" />
                  <div className="relative">
                    <div className="mb-8 flex items-center gap-2 text-xs font-bold text-emerald-300">
                      <Wifi className="h-4 w-4" /> Sessione connessa
                    </div>
                    <p className="text-sm font-semibold text-white/60">Ciao, {sessionInfo.student.nickname}</p>
                    <h2 className="mt-1 text-3xl font-black leading-tight tracking-tight">Cosa facciamo<br />oggi?</h2>
                    <button onClick={() => handleNavigate('chatbot')} className="mt-6 flex min-h-[58px] w-full items-center justify-between rounded-[20px] bg-white px-5 text-left text-slate-950 shadow-lg active:scale-[0.98]">
                      <span className="flex items-center gap-3"><AcademicAiIcon className="h-6 w-6 text-sky-600" /><span className="font-extrabold">Apri il Tutor AI</span></span>
                      <ChevronRight className="h-5 w-5" />
                    </button>
                  </div>
                </section>
                <section className="mt-4 grid grid-cols-2 gap-3 pb-4">
                  {primaryTiles.map((tile, index) => {
                    const Icon = tile.icon
                    const wide = tile.key === 'live' || tile.key === 'classe'
                    return (
                      <button
                        key={tile.key}
                        onClick={() => handleNavigate(tile.key)}
                        className={`${wide ? 'col-span-2' : ''} group relative min-h-[142px] overflow-hidden rounded-[26px] border border-white/80 bg-white/85 p-5 text-left shadow-[0_12px_30px_rgba(15,23,42,0.08)] backdrop-blur-xl active:scale-[0.98]`}
                      >
                        <div className="flex items-start justify-between">
                          <div className={`flex h-12 w-12 items-center justify-center rounded-[18px] ${index === 1 ? 'bg-rose-50 text-rose-600' : 'bg-sky-50 text-sky-700'}`}>
                            <Icon className="h-6 w-6" />
                          </div>
                          {tile.key === 'self_assessment' && pendingTasksCount > 0 && <span className="rounded-full bg-[#fe004d] px-2.5 py-1 text-xs font-black text-white">{pendingTasksCount}</span>}
                        </div>
                        <div className="mt-5 text-lg font-extrabold text-slate-950">{tile.label}</div>
                        <div className="mt-1 text-sm font-medium text-slate-500">{tile.detail}</div>
                      </button>
                    )
                  })}
                  <button onClick={() => handleNavigate('documents')} className="col-span-2 flex min-h-[82px] items-center gap-4 rounded-[24px] border border-violet-100 bg-violet-50/90 px-5 text-left active:scale-[0.98]">
                    <span className="flex h-12 w-12 items-center justify-center rounded-[18px] bg-white text-violet-700 shadow-sm"><FileText className="h-6 w-6" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-base font-extrabold text-slate-950">{t('navbar.nav_documents')}</span><span className="block truncate text-sm font-medium text-slate-500">Materiali da consultare</span></span>
                    <ChevronRight className="h-5 w-5 text-violet-400" />
                  </button>
                </section>
              </div>
            ) : activeModule === 'live' ? (
              <div className="mx-auto flex h-full max-w-screen-sm items-center justify-center">
                <div className="w-full rounded-[30px] border border-white/80 bg-white/85 p-7 text-center shadow-xl backdrop-blur-xl">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[28px] bg-rose-50 text-rose-600"><Radio className="h-9 w-9" /></div>
                  <h2 className="mt-6 text-2xl font-black text-slate-950">Sessione live</h2>
                  <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-500">Quando il docente avvia un'attività, comparirà automaticamente qui a schermo intero.</p>
                  <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-sm font-bold text-emerald-700"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-500" /> In attesa del docente</div>
                </div>
              </div>
            ) : (
              <div className={`mx-auto flex h-full min-h-0 flex-col overflow-hidden ${isImmersiveModule ? 'w-full max-w-none rounded-none border-0 bg-transparent shadow-none' : 'max-w-screen-sm rounded-[16px] border border-slate-900/10 bg-white/90 shadow-[0_18px_48px_rgba(15,23,42,0.14)]'}`}>
                {!isImmersiveModule && (
                  <div className="flex items-center gap-3 border-b border-slate-200 px-3 py-2.5">
                    {activeModule !== 'self_assessment' && (
                      <button onClick={() => handleNavigate(null)} className="rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700">
                        {t('student_dashboard.back_home')}
                      </button>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-900">{activeTitle}</div>
                      <div className="truncate text-[11px] text-slate-500">{sessionInfo.session.title}</div>
                    </div>
                  </div>
                )}
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
                      collaborationEnabled={collaborationEnabled}
                      onModuleBack={() => handleNavigate(null)}
                      documentsReadOnly
                      tasksReadOnly
                    />
                  </Suspense>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      <div
        className={
          activeModule === 'chatbot'
            ? 'fixed inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+4.1rem)] z-40 overflow-hidden bg-white'
            : studentChatSidebarOpen
              ? 'fixed inset-y-0 right-0 z-40 w-[min(92vw,420px)] overflow-hidden border-l border-slate-200 bg-white shadow-2xl'
              : 'pointer-events-none fixed bottom-0 right-0 h-px w-px overflow-hidden opacity-0'
        }
        aria-hidden={activeModule !== 'chatbot' && !studentChatSidebarOpen}
      >
        <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}>
          <ChatbotModule
            sessionId={sessionInfo.session.id}
            studentId={sessionInfo.student.id}
            initialTeacherbotId={selectedTeacherbotId}
            oggiImparoContext={oggiImparoLesson ?? undefined}
            onOggiImparoContextConsumed={onOggiImparoLessonConsumed}
            studentAccent={studentAccent}
            collaborationEnabled={collaborationEnabled}
            onMinimize={dockStudentChat}
            onExpand={expandStudentChat}
            onClose={() => setStudentChatSidebarOpen(false)}
            sidebarMode={activeModule !== 'chatbot' && studentChatSidebarOpen}
          />
        </Suspense>
      </div>

      <LiveInteractionStudentOverlay sessionId={sessionInfo.session.id} />
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
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 w-full p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{t('student_dashboard.tools_title')}</h1>
        <p className="text-slate-500 text-sm mt-1">{t('student_dashboard.tools_subtitle')}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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

function ModuleView({ moduleKey, sessionId, sessionName, openTaskId, studentId, studentName, onTeacherbotNotificationClick, studentAccent, openDocumentTaskId, onOpenDocument, teacherTarget, privateChatEnabled, sharedCodingProject, onModuleBack, documentsReadOnly = false, tasksReadOnly = false }: {
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
  collaborationEnabled?: boolean;
  sharedCodingProject?: { projectId: string; nonce: number } | null;
  onModuleBack?: () => void;
  documentsReadOnly?: boolean;
  tasksReadOnly?: boolean;
}) {
  const { t } = useTranslation()
  // Class chat module - full screen ChatSidebar
  if (moduleKey === 'classe' || moduleKey === 'chat') {
    return (
      <div className="h-full min-h-0 md:h-[calc(100vh-6rem)]">
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
      <div className="h-[calc(100dvh-7rem)] md:h-full md:min-h-0 flex flex-col overflow-hidden bg-neutral-100">
        <div className="flex h-full items-center justify-center text-sm text-slate-400">
          {t('common.loading')}
        </div>
      </div>
    )
  }

  if (moduleKey === 'self_assessment') {
    return (
      <Card className="h-full border-0 rounded-none bg-transparent shadow-none">
        <CardContent className="h-full p-0">
          <TasksModule 
            openTaskId={openTaskId} 
            studentId={studentId}
            onOpenDocument={onOpenDocument}
            readOnly={tasksReadOnly}
          />
        </CardContent>
      </Card>
    )
  }

  if (moduleKey === 'classification') {
    return (
      <div className="h-full min-h-0 overflow-hidden">
        <ClassificationModule sessionId={sessionId} />
      </div>
    )
  }

  if (moduleKey === 'documents') {
    return (
      <div className="h-full min-h-0">
        <StudentDocumentsModule sessionId={sessionId} openLessonTaskId={openDocumentTaskId} readOnlyCatalog={documentsReadOnly} />
      </div>
    )
  }

  if (moduleKey === 'notebook') {
    return (
      <div className="h-full min-h-0 flex flex-col overflow-hidden">
        <StudentNotebookModule onBack={onModuleBack} />
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
      <div className="h-full min-h-0 overflow-hidden">
        <StudentWikiPage />
      </div>
    )
  }

  if (moduleKey === 'coding') {
    return (
      <div className="h-[calc(100dvh-7rem)] md:h-full min-h-0 overflow-hidden">
        <StudentCodingLabModule sessionId={sessionId} sharedProject={sharedCodingProject} />
      </div>
    )
  }

  if (moduleKey === 'boards') {
    return (
      <div className="h-[calc(100dvh-7rem)] md:h-full min-h-0 overflow-hidden">
        <BoardManager sessionId={sessionId} isStudent />
      </div>
    )
  }

  return null
}
