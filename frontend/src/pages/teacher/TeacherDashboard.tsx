import { NavbarMusicButton } from '@/components/voice-lab/BackgroundAudio'
import BackgroundJobsIndicator from '@/components/BackgroundJobsIndicator'
import { NavbarCalendarClock } from '@/components/NavbarCalendarClock'
import { ShellFullscreenCorner } from '@/components/ShellFullscreen'
import { FloatingWindow } from '@/components/FloatingWindow'
import { SessionStudentsPanel } from '@/components/teacher/SessionStudentsPanel'
import { MobileSessionsSheet } from '@/components/teacher/MobileSessionsSheet'
import { endSession } from '@/lib/session'
import { useState, useEffect, useCallback, useRef, lazy, Suspense, type ComponentType, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Routes, Route, Navigate, useLocation, Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronDown, MessageSquare, MessageSquarePlus, Users, PlayCircle, ClipboardList, History, Monitor, BookOpen, UserRound, Code2, KanbanSquare, Menu, X, LogOut, ChevronRight, FileText, Bot, Brain, Network, Zap, GitBranch, FolderOpen, Mic } from '@/components/icons'
import { MushroomIcon, Cube3DIcon, CanvasEaselIcon } from '@/components/icons/CustomIcons'
import { LogoMark } from '@/components/LogoMark'
// Heavy pages loaded lazily — only parsed when first visited
const ClassesPage        = lazy(() => import('./ClassesPage'))
const VoiceLabPage = lazy(() => import('./VoiceLabPage'))
const VideoStudioLibraryPage = lazy(() => import('./VideoStudioLibraryPage'))
const VideoStudioEditorPage = lazy(() => import('./VideoStudioEditorPage'))
const VisualComprehensionPage = lazy(() => import('./VisualComprehensionPage'))
const SmartCanvasPage = lazy(() => import('./SmartCanvasPage'))
const SchoolOwnerPanelPage = lazy(() => import('./SchoolOwnerPanelPage'))
const SessionsPage       = lazy(() => import('./SessionsPage'))
const SessionLivePage    = lazy(() => import('./SessionLivePage'))
const TeacherDocumentsPage = lazy(() => import('./TeacherDocumentsPage'))
const TeacherbotsPage     = lazy(() => import('./TeacherbotsPage'))
const TeacherMLLabPage   = lazy(() => import('./TeacherMLLabPage'))
const Teacher3DLabPage   = lazy(() => import('./Teacher3DLabPage'))
const UDAListPage        = lazy(() => import('./UDAListPage'))
const UDACreatorPage     = lazy(() => import('./UDACreatorPage'))
const TeacherDemoPage    = lazy(() => import('./TeacherDemoPage'))
const TeacherWikiPage    = lazy(() => import('./TeacherWikiPage'))
const NotebookListPage   = lazy(() => import('../notebook/NotebookListPage'))
const NotebookPage       = lazy(() => import('../notebook/NotebookPage'))
const DesktopPage        = lazy(() => import('../shared/DesktopPage'))
const LiveInteractionBuilderPage = lazy(() => import('./LiveInteractionBuilderPage'))
const LiveInteractionControlPage = lazy(() => import('./LiveInteractionControlPage'))
const ToyLMPage = lazy(() => import('./ToyLMPage'))
const TeacherFeedbackBoardPage = lazy(() => import('./FeedbackBoardPage'))
const BoardManagerPage = lazy(() => import('./BoardManagerPage'))
const StudentCodingLabModule = lazy(() => import('../student/StudentCodingLabModule'))
const AgenticWorkflowStudioPage = lazy(() => import('./AgenticWorkflowStudioPage'))
const AgenticWorkflowLibraryPage = lazy(() => import('./AgenticWorkflowLibraryPage'))
const TeacherFilesPage = lazy(() => import('./TeacherFilesPage'))
// TeacherSupportChat is the index route — load eagerly for fast first paint
import TeacherSupportChat from './TeacherSupportChat'

// Right padding (pr-4) around the class-chat card; added to the column width so the
// card edge tracks the cursor exactly while dragging the resize grip.
const CHAT_SIDEBAR_GUTTER = 28
// Collapsed dock: 36px bar + the same 1rem gutter used around the page frame.
const CHAT_DOCK_WIDTH = 52
import { TeacherNavbar } from '@/components/TeacherNavbar'
import ChatSidebar from '@/components/ChatSidebar'
import { PageFrame } from '@/components/ui/PageFrame'
import { SectionHeading } from '@/design/primitives/SectionHeading'
import { teacherApi } from '@/lib/api'
import { AppBackground } from '@/components/ui/AppBackground'
import { getTeacherAccentTheme, type TeacherAccentId } from '@/lib/teacherAccent'
import { type StudentAccentId } from '@/lib/studentAccent'
import { getAppBackgroundGradient } from '@/lib/theme'
import { useMobile } from '@/hooks/useMobile'
import { useTeacherProfile } from '@/hooks/useTeacherProfile'
import { FloatingHelper } from '@/components/FloatingHelper'
import { FloatingClassChat } from '@/components/FloatingClassChat'
import { ClassChatDock } from '@/components/ClassChatDock'
import { SessionRail, LiveSessionPreview, TasksPreview, HistoryPreview, FilesPreview } from '@/components/SessionRail'
import { useClassChatSidebar } from '@/hooks/useClassChatSidebar'
import { useSocket } from '@/hooks/useSocket'
import { AcademicAiIcon } from '@/components/icons/AcademicAiIcon'
import { useAuthStore } from '@/stores/auth'
import { useUiThemeScope } from '@/stores/uiTheme'
import { ThemeToggleMenuItem } from '@/components/ThemeToggleMenuItem'
import { tl } from '@/i18n/tl'

type SessionStudentSummary = { id: string; nickname: string; is_frozen: boolean }

export default function TeacherDashboard() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { isMobile } = useMobile()
  const authStore = useAuthStore()

  const { data: teacherProfileData } = useTeacherProfile()
  useUiThemeScope(teacherProfileData?.uiTheme)
  const [teacherProfile, setTeacherProfile] = useState<{ id: string, name: string, uiAccent?: TeacherAccentId } | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(380)
  const [isResizingChat, setIsResizingChat] = useState(false)
  const chatColumnRef = useRef<HTMLDivElement>(null)
  const previewChatWidth = useCallback((width: number) => {
    if (chatColumnRef.current) chatColumnRef.current.style.width = `${width + CHAT_SIDEBAR_GUTTER}px`
  }, [])
  const [showSidebar, setShowSidebar] = useClassChatSidebar('teacher', authStore.user?.id)
  const [teacherChatSidebarOpen, setTeacherChatSidebarOpen] = useState(false)
  const [sessionStudents, setSessionStudents] = useState<SessionStudentSummary[]>([])
  const [studentsWindowOpen, setStudentsWindowOpen] = useState(false)
  const [classChatOpen, setClassChatOpen] = useState(false)
  const [classChatUnread, setClassChatUnread] = useState(0)
  const [feedbackOpen, setFeedbackOpen] = useState(false)

  const getPersistedSession = (): { id: string, name: string, className: string } | null => {
    try {
      const stored = localStorage.getItem('teacher_selected_session')
      if (stored) return JSON.parse(stored)
    } catch {
      localStorage.removeItem('teacher_selected_session')
    }
    return null
  }

  const [currentSession, setCurrentSession] = useState<{ id: string, name: string, className: string, joinCode?: string } | null>(getPersistedSession)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(currentSession?.id || null)
  const { onlineUsers } = useSocket(activeSessionId ?? undefined)
  const onlineStudents = onlineUsers.filter((user) => user.role !== 'teacher')
  const onlineStudentIds = new Set(onlineStudents.map(student => student.student_id))
  const visibleSessionStudents = [
    ...sessionStudents,
    ...onlineStudents
      .filter(student => !sessionStudents.some(enrolled => enrolled.id === student.student_id))
      .map(student => ({ id: student.student_id, nickname: student.nickname || tl("Studente"), is_frozen: false })),
  ].sort((left, right) => {
    const onlineDelta = Number(onlineStudentIds.has(right.id)) - Number(onlineStudentIds.has(left.id))
    return onlineDelta || left.nickname.localeCompare(right.nickname, 'it')
  })

  useEffect(() => {
    const match = location.pathname.match(/\/sessions\/([^\/]+)/)
    const urlSessionId = match?.[1]

    if (urlSessionId) {
      setActiveSessionId(urlSessionId)
      teacherApi.getSessionLive(urlSessionId).then((res: { data: { session: { name?: string; title?: string; class_name?: string; join_code?: string }; students?: SessionStudentSummary[] } }) => {
        const sessionInfo = {
          id: urlSessionId,
          name: res.data.session?.name || res.data.session?.title || t('navbar.no_session'),
          className: res.data.session?.class_name || t('navbar.nav_classes'),
          joinCode: res.data.session?.join_code,
        }
        setCurrentSession(sessionInfo)
        setSessionStudents(res.data.students || [])
        localStorage.setItem('teacher_selected_session', JSON.stringify(sessionInfo))
      }).catch(() => {
        const persisted = getPersistedSession()
        if (persisted) {
          setCurrentSession(persisted)
          setActiveSessionId(persisted.id)
        } else {
          setCurrentSession(null)
          setActiveSessionId(null)
          setSessionStudents([])
        }
      })
    } else if (currentSession?.id) {
      setActiveSessionId(currentSession.id)
      teacherApi.getSessionLive(currentSession.id)
        .then((res: { data: { students?: SessionStudentSummary[] } }) => setSessionStudents(res.data.students || []))
        .catch(() => {
          localStorage.removeItem('teacher_selected_session')
          setCurrentSession(null)
          setActiveSessionId(null)
          setSessionStudents([])
        })
    }
  }, [location.pathname])

  useEffect(() => {
    if (teacherProfileData) {
      setTeacherProfile(prev => ({
        id: prev?.id || '',
        name: `${teacherProfileData.firstName} ${teacherProfileData.lastName}`,
        uiAccent: teacherProfileData.uiAccent,
      }))
    }
  }, [teacherProfileData])

  const teacherTheme = getTeacherAccentTheme(teacherProfile?.uiAccent)
  const bgGradient = getAppBackgroundGradient(teacherTheme)
  const isTeacherHomeRoute = location.pathname === '/teacher' || location.pathname === '/teacher/'
  const isTeacherAssistantRoute = isTeacherHomeRoute || location.pathname === '/teacher/assistant'
  // Routes that own their internal scroll panes (editor/IDE layouts) — the page frame must not scroll them.
  const selfScrollingRoute = location.pathname.includes('/notebooks/notebook/') || location.pathname.includes('/teacher/coding') || location.pathname.includes('/teacher/agentic') || location.pathname.includes('/teacher/video-studio') || location.pathname.includes('/teacher/visual-comprehension') || location.pathname.includes('/teacher/smart-canvas')
  const showMobileHome = isMobile && isTeacherHomeRoute

  const dockTeacherChat = () => {
    setTeacherChatSidebarOpen(true)
  }

  const railButtonStyle = { '--btn-tone': teacherTheme.accent } as CSSProperties
  const mobileNav = [
    { path: '/teacher', label: 'Home', icon: AcademicAiIcon, exact: true },
    { path: '/teacher/classes', label: t('navbar.nav_classes'), icon: Users },
    { path: '/teacher/sessions', label: t('navbar.sessions_title'), icon: PlayCircle },
    { path: '/teacher/documents', label: t('navbar.nav_documents'), icon: FileText },
    { path: '/teacher/files', label: t('navbar.nav_files'), icon: FolderOpen },
    { path: '/teacher/teacherbots', label: t('navbar.nav_teacherbots'), icon: Bot },
    { path: '/teacher/audio-lab', label: 'Audio Lab', icon: Mic },
    { path: '/teacher/wiki', label: t('navbar.nav_wiki'), icon: BookOpen },
    { path: '/teacher/boards', label: 'Board', icon: KanbanSquare },
    { path: '/teacher/coding', label: t('navbar.nav_coding_lab'), icon: Code2 },
    { path: '/teacher/ml-lab', label: t('navbar.nav_ml_lab'), icon: Brain },
    { path: '/teacher/3d-lab', label: '3D Lab', icon: Cube3DIcon },
    { path: '/teacher/ai-3d', label: tl("AI 3D"), icon: MushroomIcon },
    { path: '/teacher/live-interaction', label: 'Live', icon: Zap },
    { path: '/teacher/toy-lm', label: 'ToyGPT', icon: Network },
    { path: '/teacher/agentic', label: tl("Dataflow Studio"), icon: GitBranch },
    { path: '/teacher/smart-canvas', label: tl("Canvas intelligente"), icon: CanvasEaselIcon },
  ]

  const handleMobileLogout = () => {
    void endSession().finally(() => navigate('/login'))
  }

  return (
    <AppBackground className={`h-[100dvh] flex flex-col overflow-hidden ${isMobile ? 'teacher-mobile-shell' : ''}`} gradient={bgGradient}>

      <ShellFullscreenCorner />

      {/* ── Desktop Navbar ── */}
      {!isMobile && (
        <TeacherNavbar
          currentSession={currentSession}
          onSessionChange={(session) => {
            setCurrentSession(session)
            setActiveSessionId(session.id)
            localStorage.setItem('teacher_selected_session', JSON.stringify(session))
          }}
        />
      )}

      {isMobile && (
        <TeacherMobileNavigation
          currentSession={currentSession}
          teacherName={teacherProfile?.name}
          accentColor={teacherTheme.accent}
          currentPath={location.pathname}
          items={mobileNav}
          unreadCount={classChatUnread}
          onNavigate={navigate}
          onOpenChat={() => setClassChatOpen(true)}
          onOpenFeedback={() => setFeedbackOpen(true)}
          onLogout={handleMobileLogout}
          onSessionChange={(session) => {
            setCurrentSession(session)
            setActiveSessionId(session.id)
            localStorage.setItem('teacher_selected_session', JSON.stringify(session))
          }}
        />
      )}

      {/* ── Main Content ── */}
      <div className={`flex-1 flex overflow-hidden ${isMobile ? 'pt-[calc(4rem+env(safe-area-inset-top))]' : 'pt-[var(--shell-nav-h)] md:pl-16 xl:pl-0'}`}>

        {/* ── Session rail (left, desktop only): hover = preview, click = open ── */}
        {!isMobile && currentSession && (
          <div className="flex-shrink-0 flex items-center pl-4 py-4 z-10 ml-auto">
          <div
            className="flex flex-col items-center py-1.5 px-1.5 gap-1.5 rounded-full shadow-lg border backdrop-blur-md"
            style={{
              backgroundColor: `${teacherTheme.soft}e0`,
              borderColor: `${teacherTheme.accent}30`,
            }}
          >
            <SessionRail
              style={railButtonStyle}
              items={[
                {
                  key: 'live', icon: Monitor, title: currentSession.name,
                  onClick: () => navigate(`/teacher/sessions/${currentSession.id}`),
                  active: location.pathname.includes(`/sessions/${currentSession.id}`) && !location.search,
                  preview: <LiveSessionPreview name={currentSession.name} className={currentSession.className} joinCode={currentSession.joinCode} online={onlineStudents.length} enrolled={visibleSessionStudents.length} />,
                },
                {
                  key: 'tasks', icon: ClipboardList, title: t('teacher_dashboard.session_tasks'),
                  onClick: () => navigate(`/teacher/sessions/${currentSession.id}?tab=tasks`),
                  active: location.search === '?tab=tasks',
                  preview: <TasksPreview sessionId={currentSession.id} />,
                },
                {
                  key: 'history', icon: History, title: t('teacher_dashboard.chat_history'),
                  onClick: () => navigate(`/teacher/sessions/${currentSession.id}?tab=history`),
                  active: location.search === '?tab=history',
                  preview: <HistoryPreview sessionId={currentSession.id} />,
                },
                {
                  key: 'files', icon: FolderOpen, title: t('teacher_dashboard.session_files'),
                  onClick: () => navigate(`/teacher/files?session=${currentSession.id}`),
                  active: location.pathname.startsWith('/teacher/files'),
                  preview: <FilesPreview sessionId={currentSession.id} />,
                },
                {
                  key: 'students', icon: UserRound, title: tl("Studenti connessi"),
                  onClick: () => setStudentsWindowOpen((open) => !open),
                  active: studentsWindowOpen,
                  badge: (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-black leading-none text-white ring-2 ring-white">
                      {onlineStudents.length}
                    </span>
                  ),
                  preview: (
                    <div className="w-full">
                      <div className="flex items-center gap-3 px-4 py-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-pill-lavender)] text-[var(--brand-pill-violet)]">
                          <UserRound className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-bold text-slate-800">{tl("Studenti della sessione")}</p>
                          <p className="text-[11px] text-slate-400">{onlineStudents.length} online · {visibleSessionStudents.length} {tl("iscritti")}</p>
                        </div>
                      </div>
                      <p className="px-4 pb-3 text-[10px] text-slate-400">{tl("Clic per aprire la finestra di gestione")}</p>
                    </div>
                  ),
                },
              ]}
            />
          </div>
          </div>
        )}

        {studentsWindowOpen && currentSession && !isMobile && (
          <FloatingWindow
            title={tl("Studenti della sessione")}
            subtitle={`${onlineStudents.length} online · ${visibleSessionStudents.length} ${tl("iscritti")}`}
            onClose={() => setStudentsWindowOpen(false)}
            initial={{ x: 96, y: 120 }}
          >
            <SessionStudentsPanel sessionId={currentSession.id} onlineUsers={onlineUsers} />
          </FloatingWindow>
        )}

        <main className={`teacher-ui relative min-w-0 w-full overscroll-contain ${isTeacherAssistantRoute && !showMobileHome ? 'hidden' : `flex-1 ${isMobile ? '' : `max-w-[calc(1800px+2*var(--ds-frame-gutter))] ${currentSession ? '' : 'ml-auto'}`}`} ${isMobile ? (selfScrollingRoute ? 'overflow-hidden flex flex-col' : 'overflow-y-auto') : 'overflow-hidden flex flex-col'}`}>
          {showMobileHome && (
            <MobileTeacherHome
              teacherName={teacherProfile?.name}
              currentSession={currentSession}
              accentColor={teacherTheme.accent}
              onOpenAssistant={() => navigate('/teacher/assistant')}
            />
          )}
          {!showMobileHome && <PageFrame bare={isMobile} scroll={!selfScrollingRoute}>
          <Suspense fallback={<div className="flex items-center justify-center h-full min-h-[40vh] text-sm text-slate-400">{t('common.loading')}</div>}>
            <Routes>
              <Route index element={<div className="h-full bg-transparent" />} />
              <Route path="assistant" element={<div />} />
              <Route path="documents" element={<TeacherDocumentsPage />} />
              <Route path="files" element={<TeacherFilesPage />} />
              <Route path="teacherbots" element={<TeacherbotsPage />} />
              <Route path="audio-lab" element={<VoiceLabPage />} />
              <Route path="voice-lab" element={<Navigate to={`/teacher/audio-lab${location.search}`} replace />} />
              <Route path="wiki" element={<TeacherWikiPage accentId={teacherProfile?.uiAccent} />} />
              <Route path="ml-lab" element={<TeacherMLLabPage />} />
              <Route path="3d-lab" element={<Teacher3DLabPage sessionId={activeSessionId ?? undefined} view="modeler" />} />
              <Route path="ai-3d" element={<Teacher3DLabPage sessionId={activeSessionId ?? undefined} view="generate" />} />
              <Route path="school" element={<SchoolOwnerPanelPage />} />
              <Route path="classes" element={<ClassesPage currentSession={currentSession} />} />
              <Route path="sessions" element={<SessionsPage currentSession={currentSession} />} />
              <Route path="sessions/:sessionId" element={<SessionLivePage />} />
              <Route path="classes/:classId/uda" element={<UDAListPage />} />
              <Route path="classes/:classId/uda/:udaId" element={<UDACreatorPage />} />
              <Route path="demo" element={<TeacherDemoPage />} />
              <Route path="notebooks" element={<NotebookListPage />} />
              <Route path="notebooks/notebook/:notebookId" element={<NotebookPage />} />
              <Route path="live-interaction" element={<LiveInteractionBuilderPage sessionId={activeSessionId ?? undefined} />} />
              <Route path="live-interaction/:interactionId/control" element={<LiveInteractionControlPage />} />
              <Route path="toy-lm" element={<ToyLMPage />} />
              <Route path="feedback-board" element={<TeacherFeedbackBoardPage />} />
              <Route path="boards" element={<BoardManagerPage sessionId={activeSessionId ?? undefined} />} />
              <Route path="smart-canvas" element={<SmartCanvasPage />} />
              <Route path="visual-comprehension" element={authStore.user?.role === 'ADMIN' ? <VisualComprehensionPage /> : <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-500">{tl("Area riservata agli amministratori.")}</div>} />
              <Route path="video-studio" element={<VideoStudioLibraryPage />} />
              <Route path="video-studio/:projectId" element={<VideoStudioEditorPage />} />
              <Route path="agentic" element={<AgenticWorkflowLibraryPage />} />
              <Route path="agentic/new" element={<AgenticWorkflowStudioPage sessionId={activeSessionId ?? undefined} />} />
              <Route path="agentic/:workflowId" element={<AgenticWorkflowStudioPage sessionId={activeSessionId ?? undefined} />} />
              <Route path="coding" element={
                activeSessionId ? (
                  <div className="h-full min-h-0 overflow-hidden">
                    <StudentCodingLabModule sessionId={activeSessionId} isTeacher />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center p-8">
                    <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
                      <SectionHeading section="/teacher/coding" as="h2" compact className="justify-center text-sm font-bold text-slate-900" subtitle={<>
                        {tl("Il Vibe Lab docente usa la sessione corrente per condividere app, versioni e commit con la classe.")}
                      </>} subtitleClassName="mt-2 text-xs leading-relaxed text-slate-500">{tl("Seleziona una sessione")}</SectionHeading>
                    </div>
                  </div>
                )
              } />
              <Route path="desktop" element={
                <DesktopPage
                  sessionId={activeSessionId ?? undefined}
                  sessionName={currentSession?.name}
                  userType="teacher"
                  accentColor={teacherTheme.accent}
                />
              } />
            </Routes>
          </Suspense>
          </PageFrame>}
        </main>

        <motion.div
          layout={!isResizingChat}
          transition={{ type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }}
          className={`h-full overflow-hidden ${
            isTeacherAssistantRoute && !showMobileHome
              ? 'relative flex-1 border-l-0 bg-transparent opacity-100'
              : teacherChatSidebarOpen
                ? 'relative flex-shrink-0 border-l border-slate-200 bg-white opacity-100'
                : 'pointer-events-none flex-shrink-0 border-l-0 bg-white opacity-0'
          }`}
          style={{
            width: isTeacherAssistantRoute && !showMobileHome ? 'auto' : teacherChatSidebarOpen ? 480 : 0,
            transformOrigin: 'right bottom',
          }}
          aria-hidden={(!isTeacherAssistantRoute || showMobileHome) && !teacherChatSidebarOpen}
        >
          <TeacherSupportChat
            onMinimize={dockTeacherChat}
            onClose={() => setTeacherChatSidebarOpen(false)}
            sidebarMode={!isTeacherAssistantRoute && teacherChatSidebarOpen}
            dockArmed={teacherChatSidebarOpen}
          />
        </motion.div>
        {/* Right chat column — ChatSidebar stays mounted so voice survives collapsing.
            Collapsed: a slim dock at the frame gutter's distance from the main frame. */}
        {!isMobile && (
          <div
            ref={chatColumnRef}
            className={`h-full flex-shrink-0 mr-auto bg-transparent box-border relative ${showSidebar ? "overflow-hidden" : "overflow-visible"} ${
              isResizingChat ? '' : 'transition-[width] duration-200'
            } ${showSidebar ? 'py-4 pl-3 pr-4' : 'py-4 pr-4'}`}
            style={{ width: showSidebar ? `${sidebarWidth + CHAT_SIDEBAR_GUTTER}px` : CHAT_DOCK_WIDTH }}
          >
            {!showSidebar && (
              <ClassChatDock
                sessionId={activeSessionId}
                currentUserId={teacherProfile?.id}
                accentColor={teacherTheme.accent}
                chatOpen={showSidebar}
                onOpen={() => setShowSidebar(true)}
              />
            )}
            <div
              className={`ds-page-frame h-full overflow-hidden ${showSidebar ? 'w-full' : 'invisible pointer-events-none absolute left-0 top-0'}`}
              style={showSidebar ? undefined : { width: sidebarWidth }}
              aria-hidden={!showSidebar}
            >
              {activeSessionId && teacherProfile ? (
                <ChatSidebar
                  sessionId={activeSessionId}
                  userType="teacher"
                  currentUserId={teacherProfile.id}
                  currentUserName={teacherProfile.name}
                  isPinned={true}
                  onPinToggle={() => setShowSidebar(false)}
                  onToggle={() => { }}
                  onWidthChange={setSidebarWidth}
                  onResizingChange={setIsResizingChat}
                  onResizePreview={previewChatWidth}
                  initialWidth={sidebarWidth}
                  className="h-full w-full !bg-white !shadow-none"
                  studentAccent={teacherProfile.uiAccent as StudentAccentId}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                  <div className="w-16 h-16 rounded-full bg-cyan-100 flex items-center justify-center mb-4">
                    <MessageSquare className="w-8 h-8 text-cyan-500" />
                  </div>
                  <p className="text-sm font-medium text-slate-700 mb-1">{t('teacher_dashboard.chat_title')}</p>
                  <p className="text-xs text-slate-400">{t('teacher_dashboard.chat_hint')}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <FloatingHelper open={feedbackOpen} onOpenChange={setFeedbackOpen} />
      {isMobile && activeSessionId && teacherProfile && (
        <FloatingClassChat
          sessionId={activeSessionId}
          userType="teacher"
          currentUserId={teacherProfile.id}
          currentUserName={teacherProfile.name}
          studentAccent={teacherProfile.uiAccent as StudentAccentId}
          hideTrigger
          open={classChatOpen}
          onOpenChange={setClassChatOpen}
          onUnreadCountChange={setClassChatUnread}
        />
      )}
    </AppBackground>
  )
}

type TeacherMobileNavItem = {
  path: string
  label: string
  icon: ComponentType<{ className?: string }>
  exact?: boolean
}

function TeacherMobileNavigation({
  currentSession,
  teacherName,
  accentColor,
  currentPath,
  items,
  unreadCount,
  onNavigate,
  onOpenChat,
  onOpenFeedback,
  onLogout,
  onSessionChange,
}: {
  currentSession: { id: string; name: string } | null
  teacherName?: string
  accentColor: string
  currentPath: string
  items: TeacherMobileNavItem[]
  unreadCount: number
  onNavigate: (path: string) => void
  onOpenChat: () => void
  onOpenFeedback: () => void
  onLogout: () => void
  onSessionChange: (session: { id: string; name: string; className: string; joinCode?: string }) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const isHome = currentPath === '/teacher' || currentPath === '/teacher/'

  useEffect(() => setOpen(false), [currentPath])
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previousOverflow }
  }, [open])

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-200 bg-white px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        {/* One flex row, nothing absolutely positioned: menu · session (takes the free space) · tools · user */}
        <div className="flex h-12 items-center gap-1">
          <button type="button" onClick={() => setOpen(true)} className="flex h-10 w-10 shrink-0 items-center justify-center text-slate-700" aria-label={tl("Apri menu")}>
            <Menu className="h-6 w-6" strokeWidth={2.5} />
          </button>
          <button type="button" onClick={() => onNavigate('/teacher')} className="hidden min-w-0 flex-1 text-left sm:block">
            <span className="block text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: accentColor }}>{tl("Area docente")}</span>
            <span className="block truncate text-base font-black leading-tight text-slate-950">
              {isHome ? 'Home' : items.find(item => currentPath.startsWith(item.path) && item.path !== '/teacher')?.label || 'Workspace'}
            </span>
          </button>
          <div className="min-w-0 flex-1 sm:flex-none">
            {currentSession ? (
              <button type="button" onClick={() => onNavigate(`/teacher/sessions/${currentSession.id}`)} className="flex h-10 max-w-full items-center gap-2 rounded-full bg-emerald-50 px-3 text-left text-emerald-800 ring-1 ring-emerald-200 sm:max-w-[14rem]" title={currentSession.name}>
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]" />
                <span className="min-w-0"><span className="block text-[8px] font-black uppercase leading-none tracking-wider text-emerald-600">Live</span><span className="mt-0.5 block truncate text-[11px] font-black leading-tight">{currentSession.name}</span></span>
              </button>
            ) : (
              // No session yet: the slot opens the list of available sessions right away.
              <button type="button" onClick={() => setSessionsOpen(true)} className="flex h-10 max-w-full items-center gap-2 rounded-full bg-slate-100 px-3 text-left text-slate-600 ring-1 ring-slate-200 sm:max-w-[14rem]" aria-haspopup="dialog" aria-label={tl("Scegli una sessione")}>
                <span className="h-2 w-2 shrink-0 rounded-full bg-slate-300" />
                <span className="min-w-0 flex-1 truncate text-[12px] font-bold">{tl("Scegli sessione")}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              </button>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center">
            <BackgroundJobsIndicator accentColor={accentColor} />
            <NavbarMusicButton sessionId={currentSession?.id} />
            <NavbarCalendarClock compact sessionId={currentSession?.id} accentColor={accentColor} />
            <button type="button" onClick={onOpenChat} className="relative flex h-10 w-10 shrink-0 items-center justify-center text-[10px] font-black text-slate-800" title={teacherName || tl("Docente")} aria-label={tl("Apri chat di classe · {0}", teacherName || 'Docente')}>
              <MessageSquare className="absolute inset-0 h-10 w-10 fill-white stroke-slate-700" strokeWidth={1.8} />
              <span className="relative -translate-y-px">{teacherName?.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'D'}</span>
              {unreadCount > 0 && <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-black text-white ring-2 ring-white">{unreadCount > 9 ? '9+' : unreadCount}</span>}
            </button>
          </div>
        </div>
      </header>

      <MobileSessionsSheet
        open={sessionsOpen}
        currentSessionId={currentSession?.id}
        onClose={() => setSessionsOpen(false)}
        onSelect={(session) => {
          onSessionChange({ id: session.id, name: session.name, className: session.className, joinCode: session.joinCode })
          setSessionsOpen(false)
          onNavigate(`/teacher/sessions/${session.id}`)
        }}
        onManage={(session) => {
          setSessionsOpen(false)
          onNavigate(`/teacher/sessions/${session.id}`)
        }}
        onCreate={() => { setSessionsOpen(false); onNavigate('/teacher/sessions') }}
      />

      {open && (
        <div className="fixed inset-0 z-[80]">
          <button className="absolute inset-0 bg-slate-950/45" onClick={() => setOpen(false)} aria-label={tl("Chiudi menu")} />
          <aside className="absolute inset-y-0 left-0 flex w-[min(88vw,360px)] flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
              <div className="flex items-center gap-3"><LogoMark className="h-11 w-11 shrink-0" /><div><span className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: accentColor }}>Golinelli.ai</span><p className="mt-1 text-lg font-black text-slate-950">{teacherName || t('teacher_dashboard.mobile_teacher_default')}</p><p className="text-xs font-medium text-slate-400">{tl("Area docente")}</p></div></div>
              <button type="button" onClick={() => setOpen(false)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700" aria-label={tl("Chiudi menu")}><X className="h-5 w-5" /></button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3">
              {items.map(({ path, label, icon: Icon, exact }) => {
                const active = exact ? isHome : currentPath.startsWith(path)
                return <Link key={path} to={path} onClick={() => setOpen(false)} className={`mb-1 flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold ${active ? 'border border-transparent bg-[image:var(--selection-active-bg)] text-[var(--selection-active-text)]' : 'text-slate-600 active:bg-slate-100'}`}><Icon className="h-5 w-5 shrink-0" /><span className="flex-1">{label}</span><ChevronRight className="h-4 w-4 opacity-50" /></Link>
              })}
            </nav>
            <div className="border-t border-slate-100 py-1">
              <ThemeToggleMenuItem persist={(ui_theme) => teacherApi.updateProfile({ ui_theme })} />
            </div>
            <div className="flex items-center gap-2 border-t border-slate-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <button type="button" onClick={() => { setOpen(false); onOpenFeedback() }} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-orange-50 px-4 py-3.5 text-sm font-black text-orange-600"><MessageSquarePlus className="h-5 w-5" />Feedback</button>
              <button type="button" onClick={onLogout} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-red-50 px-4 py-3.5 text-sm font-black text-red-600"><LogOut className="h-5 w-5" />{t('navbar.logout')}</button>
            </div>
          </aside>
        </div>
      )}
    </>
  )
}

function MobileTeacherHome({
  teacherName,
  currentSession,
  accentColor,
  onOpenAssistant,
}: {
  teacherName?: string
  currentSession: { id: string; name: string; className: string; joinCode?: string } | null
  accentColor: string
  onOpenAssistant: () => void
}) {
  const firstName = teacherName?.trim().split(/\s+/)[0] || tl("docente")
  const tools = [
    { to: '/teacher/classes', title: tl("Classi"), description: tl("Gestisci studenti e gruppi"), icon: Users, tone: 'bg-sky-50 text-sky-700' },
    { to: '/teacher/sessions', title: tl("Sessioni"), description: tl("Prepara e avvia una lezione"), icon: PlayCircle, tone: 'bg-rose-50 text-rose-600' },
    { to: '/teacher/documents', title: tl("Documenti"), description: tl("Materiali e risorse didattiche"), icon: FileText, tone: 'bg-amber-50 text-amber-700' },
    { to: '/teacher/audio-lab', title: 'Audio Lab', description: tl("Crea voci, audio e registrazioni"), icon: Mic, tone: 'bg-pink-50 text-pink-700' },
    { to: '/teacher/teacherbots', title: 'Teacherbot', description: tl("Crea assistenti per la classe"), icon: Bot, tone: 'bg-violet-50 text-violet-700' },
  ]

  return (
    <div className="min-h-full w-full overflow-y-auto bg-neutral-100 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">
      <section className="relative overflow-hidden rounded-[2rem] bg-slate-950 px-6 pb-6 pt-7 text-white shadow-2xl shadow-slate-300">
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-30 blur-3xl" style={{ backgroundColor: accentColor }} />
        <div className="relative">
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_5px_rgba(52,211,153,0.12)]" />
            {tl("Area docente connessa")}
          </div>
          <p className="mt-14 text-base font-bold text-slate-400">{tl("Ciao,")} {firstName}</p>
          <h1 className="mt-2 max-w-[15rem] text-4xl font-black leading-[1.05] tracking-tight">{tl("Cosa prepariamo oggi?")}</h1>
          <button
            type="button"
            onClick={onOpenAssistant}
            className="mt-8 flex w-full items-center gap-3 rounded-[1.35rem] bg-white px-5 py-5 text-left text-slate-950 shadow-lg"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
              <AcademicAiIcon className="h-6 w-6" />
            </span>
            <span className="flex-1 text-lg font-black">{tl("Apri l'assistente AI")}</span>
            <ChevronRight className="h-6 w-6" strokeWidth={2.5} />
          </button>
        </div>
      </section>

      {currentSession && (
        <Link to={`/teacher/sessions/${currentSession.id}`} className="mt-4 flex items-center gap-3 rounded-3xl border border-emerald-100 bg-white p-4 shadow-sm">
          <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <Monitor className="h-5 w-5" />
            <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-bold uppercase tracking-wider text-emerald-600">{tl("Sessione attiva")}</span>
            <span className="block truncate text-base font-black text-slate-900">{currentSession.name}</span>
            <span className="block truncate text-xs text-slate-400">{currentSession.className}{currentSession.joinCode ? ` · ${currentSession.joinCode}` : ''}</span>
          </span>
          <ChevronRight className="h-5 w-5 text-slate-400" />
        </Link>
      )}

      <div className="mt-6 flex items-end justify-between px-1">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em]" style={{ color: accentColor }}>Workspace</p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">{tl("I tuoi strumenti")}</h2>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {tools.map(({ to, title, description, icon: Icon, tone }) => (
          <Link key={to} to={to} className="mobile-card-standard flex flex-col rounded-[1.75rem] bg-white p-4 shadow-sm ring-1 ring-slate-100 transition-transform active:scale-[0.98]">
            <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tone}`}>
              <Icon className="h-6 w-6" />
            </span>
            <h3 className="mt-auto line-clamp-2 text-base font-black leading-tight text-slate-950">{title}</h3>
            <p className="mt-1 hidden text-sm font-semibold leading-snug text-slate-400 md:block">{description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
