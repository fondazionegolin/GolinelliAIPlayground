import { useState, useEffect, lazy, Suspense, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Routes, Route, useLocation, Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { MessageSquare, Users, PlayCircle, ClipboardList, History, Monitor, BookOpen, UserRound, Code2, KanbanSquare, Search, Loader2, Snowflake, Sun } from 'lucide-react'
// Heavy pages loaded lazily — only parsed when first visited
const ClassesPage        = lazy(() => import('./ClassesPage'))
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
// TeacherSupportChat is the index route — load eagerly for fast first paint
import TeacherSupportChat from './TeacherSupportChat'
import { TeacherNavbar } from '@/components/TeacherNavbar'
import ChatSidebar from '@/components/ChatSidebar'
import { teacherApi } from '@/lib/api'
import { AppBackground } from '@/components/ui/AppBackground'
import { getTeacherAccentTheme, type TeacherAccentId } from '@/lib/teacherAccent'
import { type StudentAccentId } from '@/lib/studentAccent'
import { getAppBackgroundGradient } from '@/lib/theme'
import { useMobile } from '@/hooks/useMobile'
import { useTeacherProfile } from '@/hooks/useTeacherProfile'
import { FloatingHelper } from '@/components/FloatingHelper'
import { useSocket } from '@/hooks/useSocket'
import { AcademicAiIcon } from '@/components/icons/AcademicAiIcon'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/components/ui/use-toast'
import TuringTestPanel from '@/components/TuringTestPanel'

const CHATBAR_AUTO_HIDE_BREAKPOINT = 1280
type SessionStudentSummary = { id: string; nickname: string; is_frozen: boolean }

export default function TeacherDashboard() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { isMobile } = useMobile()
  const authStore = useAuthStore()
  const { toast } = useToast()

  const { data: teacherProfileData } = useTeacherProfile()
  const [teacherProfile, setTeacherProfile] = useState<{ id: string, name: string, uiAccent?: TeacherAccentId } | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(380)
  const [showSidebar, setShowSidebar] = useState(true)
  const [showOnlineMenu, setShowOnlineMenu] = useState(false)
  const [teacherChatSidebarOpen, setTeacherChatSidebarOpen] = useState(false)
  const [subjectiveStudentId, setSubjectiveStudentId] = useState<string | null>(null)
  const [sessionStudents, setSessionStudents] = useState<SessionStudentSummary[]>([])
  const [updatingStudentId, setUpdatingStudentId] = useState<string | null>(null)

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
  const { onlineUsers, socket: sessionSocket } = useSocket(activeSessionId ?? undefined)
  const onlineStudents = onlineUsers.filter((user) => user.role !== 'teacher')
  const onlineStudentIds = new Set(onlineStudents.map(student => student.student_id))
  const visibleSessionStudents = [
    ...sessionStudents,
    ...onlineStudents
      .filter(student => !sessionStudents.some(enrolled => enrolled.id === student.student_id))
      .map(student => ({ id: student.student_id, nickname: student.nickname || 'Studente', is_frozen: false })),
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

  useEffect(() => {
    const handleResize = () => {
      setShowSidebar(prev => (
        window.innerWidth < CHATBAR_AUTO_HIDE_BREAKPOINT ? false : prev
      ))
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const teacherTheme = getTeacherAccentTheme(teacherProfile?.uiAccent)
  const bgGradient = getAppBackgroundGradient(teacherTheme)
  const isTeacherSupportRoute = location.pathname === '/teacher' || location.pathname === '/teacher/'

  const dockTeacherChat = () => {
    setTeacherChatSidebarOpen(true)
  }

  const enterSubjectiveView = async (student: { student_id: string; nickname?: string }) => {
    if (!activeSessionId || subjectiveStudentId) return
    setSubjectiveStudentId(student.student_id)
    try {
      const response = await teacherApi.createStudentSubjectiveView(activeSessionId, student.student_id)
      const { token, student_id, session_id, session_title, nickname } = response.data
      if (authStore.accessToken && authStore.user) {
        localStorage.setItem('_teacher_token_backup', authStore.accessToken)
        localStorage.setItem('_teacher_user_backup', JSON.stringify(authStore.user))
      }
      localStorage.setItem('_subjective_mode', JSON.stringify({
        studentId: student_id,
        nickname,
        returnPath: `${location.pathname}${location.search}`,
      }))
      authStore.setObservedStudentSession({ student_id, session_id, session_title, nickname }, token)
      navigate('/student')
    } catch (error: any) {
      localStorage.removeItem('_subjective_mode')
      localStorage.removeItem('student_token')
      toast({
        variant: 'destructive',
        title: 'Vista soggettiva non disponibile',
        description: error?.response?.data?.detail || 'Non è stato possibile accedere all’interfaccia dello studente.',
      })
    } finally {
      setSubjectiveStudentId(null)
    }
  }

  const toggleStudentFrozen = async (student: SessionStudentSummary) => {
    if (!activeSessionId || updatingStudentId) return
    setUpdatingStudentId(student.id)
    try {
      if (student.is_frozen) await teacherApi.unfreezeStudent(activeSessionId, student.id)
      else await teacherApi.freezeStudent(activeSessionId, student.id)
      setSessionStudents(current => current.map(item => item.id === student.id ? { ...item, is_frozen: !student.is_frozen } : item))
      toast({ title: student.is_frozen ? 'Studente sbloccato' : 'Studente bloccato' })
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Operazione non riuscita',
        description: error?.response?.data?.detail || 'Impossibile aggiornare lo studente.',
      })
    } finally {
      setUpdatingStudentId(null)
    }
  }
  const railButtonStyle = { '--btn-tone': teacherTheme.accent } as CSSProperties
  const mobileNav = [
    { path: '/teacher', label: t('navbar.nav_support'), icon: AcademicAiIcon, exact: true },
    { path: '/teacher/classes', label: t('navbar.nav_classes'), icon: Users },
    { path: '/teacher/sessions', label: t('navbar.sessions_title'), icon: PlayCircle },
    { path: '/teacher/wiki', label: t('navbar.nav_wiki'), icon: BookOpen },
    { path: '/teacher/boards', label: 'Board', icon: KanbanSquare },
    { path: '/teacher/coding', label: t('navbar.nav_coding_lab'), icon: Code2 },
  ]

  return (
    <AppBackground className="h-[100dvh] flex flex-col overflow-hidden" gradient={bgGradient}>

      {/* ── Desktop Navbar ── */}
      {!isMobile && (
        <TeacherNavbar
          currentSession={currentSession}
          onSessionChange={(session) => {
            setCurrentSession(session)
            setActiveSessionId(session.id)
            localStorage.setItem('teacher_selected_session', JSON.stringify(session))
          }}
          chatSidebarOpen={showSidebar}
          onToggleChatSidebar={() => setShowSidebar(v => !v)}
        />
      )}

      {/* ── Mobile Top Bar ── */}
      {isMobile && (
        <div
          className="fixed top-0 inset-x-0 z-50 h-12 flex items-center px-4 border-b border-white/20 backdrop-blur-md"
          style={{ backgroundColor: `${teacherTheme.soft}ee` }}
        >
          <div className="w-7 h-7 rounded-full flex items-center justify-center mr-2.5 shadow-sm" style={{ backgroundColor: teacherTheme.accent }}>
            <AcademicAiIcon className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-bold flex-1" style={{ color: teacherTheme.text }}>
            {teacherProfile?.name || t('teacher_dashboard.mobile_teacher_default')}
          </span>
        </div>
      )}

      {/* ── Main Content ── */}
      <div className={`flex-1 flex overflow-hidden ${isMobile ? 'pt-12 pb-16' : 'pt-16 md:pl-16 2xl:pl-0'}`}>

        {/* ── Session Context Strip (left, desktop only) ── */}
        {!isMobile && currentSession && (
          <div className="flex-shrink-0 flex items-center pl-2 py-2 z-10">
          <div
            className="flex flex-col items-center py-3 px-1.5 gap-1 rounded-2xl shadow-lg border backdrop-blur-md"
            style={{
              backgroundColor: `${teacherTheme.soft}e0`,
              borderColor: `${teacherTheme.accent}30`,
            }}
          >
            {/* Session live */}
            <button
              title={currentSession.name}
              onClick={() => navigate(`/teacher/sessions/${currentSession.id}`)}
              className={`app-button-chrome flex h-9 w-9 items-center justify-center rounded-lg ${location.pathname.includes(`/sessions/${currentSession.id}`) && !location.search ? 'app-button-chrome-active' : ''}`}
              style={railButtonStyle}
            >
              <Monitor className="h-4 w-4" />
            </button>

            {/* Tasks */}
            <button
              title={t('teacher_dashboard.session_tasks')}
              onClick={() => navigate(`/teacher/sessions/${currentSession.id}?tab=tasks`)}
              className={`app-button-chrome flex h-9 w-9 items-center justify-center rounded-lg ${location.search === '?tab=tasks' ? 'app-button-chrome-active' : ''}`}
              style={railButtonStyle}
            >
              <ClipboardList className="h-4 w-4" />
            </button>

            {/* History */}
            <button
              title={t('teacher_dashboard.chat_history')}
              onClick={() => navigate(`/teacher/sessions/${currentSession.id}?tab=history`)}
              className={`app-button-chrome flex h-9 w-9 items-center justify-center rounded-lg ${location.search === '?tab=history' ? 'app-button-chrome-active' : ''}`}
              style={railButtonStyle}
            >
              <History className="h-4 w-4" />
            </button>

            {/* Online students */}
            <div className="relative">
              <button
                title="Studenti connessi"
                onClick={() => setShowOnlineMenu(v => !v)}
                className={`app-button-chrome relative flex h-9 w-9 items-center justify-center rounded-lg ${showOnlineMenu ? 'app-button-chrome-active' : ''}`}
                style={railButtonStyle}
              >
                <UserRound className="h-4 w-4" />
                <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-black leading-none text-white ring-2 ring-white">
                  {onlineStudents.length}
                </span>
              </button>

              {showOnlineMenu && (
                <div className="absolute left-full top-0 z-[70] ml-3 w-80 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                  <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--brand-pill-lavender)] text-[var(--brand-pill-violet)]">
                      <UserRound className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-800">Studenti della sessione</p>
                      <p className="text-[11px] text-slate-400">{onlineStudents.length} online · {visibleSessionStudents.length} iscritti</p>
                    </div>
                  </div>
                  <div className="max-h-[min(60vh,30rem)] overflow-y-auto p-2">
                    {visibleSessionStudents.length === 0 ? (
                      <p className="px-3 py-8 text-center text-xs text-slate-400">Nessuno studente nella sessione</p>
                    ) : (
                      visibleSessionStudents.map((student) => {
                        const isOnline = onlineStudentIds.has(student.id)
                        return (
                        <div key={student.id} className="flex items-center gap-2 rounded-xl px-2.5 py-2.5 hover:bg-slate-50">
                          <span className={`h-2.5 w-2.5 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-700">{student.nickname || 'Studente'}</p>
                            <p className="text-[10px] text-slate-400">{isOnline ? 'Online' : 'Disconnesso'}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => window.dispatchEvent(new CustomEvent('openPrivateChat', { detail: { id: student.id, nickname: student.nickname } }))}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-sky-50 hover:text-sky-600"
                            title={`Chat diretta con ${student.nickname}`}
                            aria-label={`Chat diretta con ${student.nickname}`}
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void toggleStudentFrozen(student)}
                            disabled={updatingStudentId !== null}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-amber-50 hover:text-amber-600 disabled:opacity-40"
                            title={student.is_frozen ? `Sblocca ${student.nickname}` : `Blocca ${student.nickname}`}
                            aria-label={student.is_frozen ? `Sblocca ${student.nickname}` : `Blocca ${student.nickname}`}
                          >
                            {updatingStudentId === student.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : student.is_frozen ? <Sun className="h-3.5 w-3.5" /> : <Snowflake className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => void enterSubjectiveView({ student_id: student.id, nickname: student.nickname })}
                            disabled={!isOnline || subjectiveStudentId !== null}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 disabled:cursor-wait disabled:opacity-50"
                            title={isOnline ? `Entra nella vista soggettiva di ${student.nickname || 'Studente'}` : 'Vista soggettiva disponibile solo quando lo studente è online'}
                            aria-label={`Entra nella vista soggettiva di ${student.nickname || 'Studente'}`}
                          >
                            {subjectiveStudentId === student.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Search className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      )})
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex-1" />

            {/* Toggle chat sidebar */}
            <button
              title={t('teacher_dashboard.class_chat')}
              onClick={() => setShowSidebar(v => !v)}
              className={`app-button-chrome flex h-9 w-9 items-center justify-center rounded-lg ${showSidebar ? 'app-button-chrome-active' : ''}`}
              style={railButtonStyle}
            >
              <MessageSquare className="h-4 w-4" />
            </button>
          </div>
          </div>
        )}

        <main className={`relative ${isTeacherSupportRoute ? 'hidden' : 'flex-1'} ${location.pathname.includes('/notebooks/notebook/') || location.pathname.includes('/teacher/coding') ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'}`}>
          <Suspense fallback={<div className="flex items-center justify-center h-full min-h-[40vh] text-sm text-slate-400">{t('common.loading')}</div>}>
            <Routes>
              <Route index element={<div className="h-full bg-neutral-100" />} />
              <Route path="documents" element={<TeacherDocumentsPage />} />
              <Route path="teacherbots" element={<TeacherbotsPage />} />
              <Route path="wiki" element={<TeacherWikiPage accentId={teacherProfile?.uiAccent} />} />
              <Route path="ml-lab" element={<TeacherMLLabPage />} />
              <Route path="3d-lab" element={<Teacher3DLabPage sessionId={activeSessionId ?? undefined} />} />
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
              <Route path="coding" element={
                activeSessionId ? (
                  <div className="h-full min-h-0 overflow-hidden">
                    <StudentCodingLabModule sessionId={activeSessionId} isTeacher />
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center p-8">
                    <div className="max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
                      <Code2 className="mx-auto h-8 w-8 text-slate-400" />
                      <h2 className="mt-3 text-sm font-bold text-slate-900">Seleziona una sessione</h2>
                      <p className="mt-2 text-xs leading-relaxed text-slate-500">
                        Il Vibe Lab docente usa la sessione corrente per condividere app, versioni e commit con la classe.
                      </p>
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
        </main>

        <motion.div
          layout
          transition={{ type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }}
          className={`h-full overflow-hidden bg-white ${
            isTeacherSupportRoute
              ? 'relative flex-1 border-l-0 opacity-100'
              : teacherChatSidebarOpen
                ? 'relative flex-shrink-0 border-l border-slate-200 opacity-100'
                : 'pointer-events-none flex-shrink-0 border-l-0 opacity-0'
          }`}
          style={{
            width: isTeacherSupportRoute ? 'auto' : teacherChatSidebarOpen ? 480 : 0,
            transformOrigin: 'right bottom',
          }}
          aria-hidden={!isTeacherSupportRoute && !teacherChatSidebarOpen}
        >
          <TeacherSupportChat
            onMinimize={dockTeacherChat}
            onClose={() => setTeacherChatSidebarOpen(false)}
            sidebarMode={!isTeacherSupportRoute && teacherChatSidebarOpen}
            dockArmed={teacherChatSidebarOpen}
          />
        </motion.div>
        {/* Right chat sidebar — kept mounted so voice stays connected when hidden */}
        {!isMobile && (
          <div
            className={`h-full flex-shrink-0 overflow-hidden bg-white transition-[width,opacity] duration-200 ${
              showSidebar ? 'relative border-l border-slate-200 opacity-100' : 'pointer-events-none border-l-0 opacity-0'
            }`}
            style={{ width: showSidebar ? `${sidebarWidth}px` : 0 }}
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
                initialWidth={sidebarWidth}
                className="h-full w-full"
                studentAccent={teacherProfile.uiAccent as StudentAccentId}
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                <div className="w-16 h-16 rounded-full bg-cyan-100 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-slate-700 mb-1">{t('teacher_dashboard.chat_title')}</p>
                <p className="text-xs text-slate-400">{t('teacher_dashboard.chat_hint')}</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Mobile Bottom Nav ── */}
      {isMobile && (
        <nav
          className="fixed bottom-0 inset-x-0 z-50 h-16 bg-white/90 backdrop-blur-md border-t border-slate-200 flex items-center justify-around"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {mobileNav.map(({ path, label, icon: Icon, exact }) => {
            const isActive = exact
              ? location.pathname === path
              : location.pathname.startsWith(path) && location.pathname !== '/teacher'
            return (
              <Link
                key={path}
                to={path}
                className="flex flex-col items-center gap-0.5 px-5 py-1 rounded-xl transition-colors"
                style={isActive ? { color: teacherTheme.text } : { color: '#94a3b8' }}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-semibold">{label}</span>
              </Link>
            )
          })}
        </nav>
      )}
      <FloatingHelper />
      {isMobile && activeSessionId && (
        <TuringTestPanel
          sessionId={activeSessionId}
          userType="teacher"
          socket={sessionSocket}
          onlineStudentCount={onlineStudents.length}
          floatingTrigger
        />
      )}
    </AppBackground>
  )
}
