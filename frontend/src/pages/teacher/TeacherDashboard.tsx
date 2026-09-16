import { useState, useEffect, lazy, Suspense, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { Routes, Route, useLocation, Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { MessageSquare, MessageSquarePlus, Users, PlayCircle, ClipboardList, History, Monitor, BookOpen, UserRound, Code2, KanbanSquare, Search, Loader2, Snowflake, Sun, Menu, X, LogOut, ChevronRight, FileText, Bot, Brain, Box, Network, Zap } from 'lucide-react'
import { LogoMark } from '@/components/LogoMark'
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
import { FloatingClassChat } from '@/components/FloatingClassChat'
import { useSocket } from '@/hooks/useSocket'
import { AcademicAiIcon } from '@/components/icons/AcademicAiIcon'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/components/ui/use-toast'

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
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
  const isTeacherHomeRoute = location.pathname === '/teacher' || location.pathname === '/teacher/'
  const isTeacherAssistantRoute = isTeacherHomeRoute || location.pathname === '/teacher/assistant'
  const showMobileHome = isMobile && isTeacherHomeRoute

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
    { path: '/teacher', label: 'Home', icon: AcademicAiIcon, exact: true },
    { path: '/teacher/classes', label: t('navbar.nav_classes'), icon: Users },
    { path: '/teacher/sessions', label: t('navbar.sessions_title'), icon: PlayCircle },
    { path: '/teacher/documents', label: t('navbar.nav_documents'), icon: FileText },
    { path: '/teacher/teacherbots', label: t('navbar.nav_teacherbots'), icon: Bot },
    { path: '/teacher/wiki', label: t('navbar.nav_wiki'), icon: BookOpen },
    { path: '/teacher/boards', label: 'Board', icon: KanbanSquare },
    { path: '/teacher/coding', label: t('navbar.nav_coding_lab'), icon: Code2 },
    { path: '/teacher/ml-lab', label: t('navbar.nav_ml_lab'), icon: Brain },
    { path: '/teacher/3d-lab', label: '3D Lab', icon: Box },
    { path: '/teacher/live-interaction', label: 'Live', icon: Zap },
    { path: '/teacher/toy-lm', label: 'ToyGPT', icon: Network },
  ]

  const handleMobileLogout = () => {
    setMobileMenuOpen(false)
    localStorage.removeItem('teacher_token')
    localStorage.removeItem('teacher_selected_session')
    useAuthStore.getState().logout()
    navigate('/login')
  }

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [location.pathname])

  return (
    <AppBackground className={`h-[100dvh] flex flex-col overflow-hidden ${isMobile ? 'teacher-mobile-shell' : ''}`} gradient={bgGradient}>

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
        <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-200 bg-white/95 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <div className="flex h-12 items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center text-slate-700"
              aria-label="Apri menu"
            >
              <Menu className="h-6 w-6" strokeWidth={2.5} />
            </button>
            <button type="button" onClick={() => navigate('/teacher')} className="min-w-0 flex-1 text-left">
              <span className="block text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: teacherTheme.accent }}>Area docente</span>
              <span className="block truncate text-base font-black leading-tight text-slate-950">
                {isTeacherHomeRoute ? 'Home' : mobileNav.find(item => location.pathname.startsWith(item.path) && item.path !== '/teacher')?.label || 'Workspace'}
              </span>
            </button>
            {currentSession && (
              <button
                type="button"
                onClick={() => navigate(`/teacher/sessions/${currentSession.id}`)}
                className="flex h-10 max-w-[7.5rem] shrink-0 items-center gap-2 rounded-full bg-emerald-50 px-3 text-left text-emerald-800 ring-1 ring-emerald-200"
                title={currentSession.name}
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.14)]" />
                <span className="min-w-0">
                  <span className="block text-[8px] font-black uppercase leading-none tracking-wider text-emerald-600">Live</span>
                  <span className="mt-0.5 block truncate text-[11px] font-black leading-tight">{currentSession.name}</span>
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setClassChatOpen(true)}
              className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-slate-200 bg-slate-50 text-xs font-black text-slate-800"
              title={teacherProfile?.name || 'Docente'}
              aria-label={`Apri chat di classe · ${teacherProfile?.name || 'Docente'}`}
            >
              {teacherProfile?.name?.split(' ').map(part => part[0]).slice(0, 2).join('').toUpperCase() || 'D'}
              <span className="absolute -bottom-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full rounded-bl-none border-2 border-white bg-[image:var(--selection-active-bg)] px-1 text-[var(--selection-active-text)] shadow-sm">
                <MessageSquare className="h-2.5 w-2.5" fill="currentColor" />
              </span>
              {classChatUnread > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-black text-white ring-2 ring-white">
                  {classChatUnread > 9 ? '9+' : classChatUnread}
                </span>
              )}
            </button>
          </div>
        </header>
      )}

      {isMobile && mobileMenuOpen && (
        <div className="fixed inset-0 z-[80]">
          <button className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} aria-label="Chiudi menu" />
          <aside className="absolute inset-y-0 left-0 flex w-[min(88vw,360px)] flex-col bg-white shadow-2xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-5 pb-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
              <div className="flex items-center gap-3">
                <LogoMark className="h-11 w-11 shrink-0" />
                <div>
                  <span className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: teacherTheme.accent }}>Golinelli.ai</span>
                  <p className="mt-1 text-lg font-black text-slate-950">{teacherProfile?.name || t('teacher_dashboard.mobile_teacher_default')}</p>
                  <p className="text-xs font-medium text-slate-400">Area docente</p>
                </div>
              </div>
              <button onClick={() => setMobileMenuOpen(false)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700" aria-label="Chiudi menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto p-3">
              {mobileNav.map(({ path, label, icon: Icon, exact }) => {
                const active = exact ? isTeacherHomeRoute : location.pathname.startsWith(path)
                return (
                  <Link key={path} to={path} className={`mb-1 flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-bold ${active ? 'border border-[color:var(--selection-border-hover)] bg-[image:var(--selection-active-bg)] text-[var(--selection-active-text)]' : 'text-slate-600 hover:bg-slate-100'}`}>
                    <Icon className="h-5 w-5 shrink-0" />
                    <span className="flex-1">{label}</span>
                    <ChevronRight className="h-4 w-4 opacity-50" />
                  </Link>
                )
              })}
            </nav>
            <div className="border-t border-slate-100 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setFeedbackOpen(true); setMobileMenuOpen(false) }}
                className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-orange-50 px-4 py-3.5 text-sm font-black text-orange-600"
              >
                <MessageSquarePlus className="h-5 w-5" />
                Feedback
              </button>
              <button onClick={handleMobileLogout} className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-red-50 px-4 py-3.5 text-sm font-black text-red-600">
                <LogOut className="h-5 w-5" />
                {t('navbar.logout')}
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ── Main Content ── */}
      <div className={`flex-1 flex overflow-hidden ${isMobile ? 'pt-[calc(4rem+env(safe-area-inset-top))]' : 'pt-16 md:pl-16 2xl:pl-0'}`}>

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

        <main className={`relative min-w-0 w-full overscroll-contain ${isTeacherAssistantRoute && !showMobileHome ? 'hidden' : 'flex-1'} ${location.pathname.includes('/notebooks/notebook/') || location.pathname.includes('/teacher/coding') ? 'overflow-hidden flex flex-col' : 'overflow-y-auto'}`}>
          {showMobileHome && (
            <MobileTeacherHome
              teacherName={teacherProfile?.name}
              currentSession={currentSession}
              accentColor={teacherTheme.accent}
              onOpenAssistant={() => navigate('/teacher/assistant')}
            />
          )}
          {!showMobileHome && <Suspense fallback={<div className="flex items-center justify-center h-full min-h-[40vh] text-sm text-slate-400">{t('common.loading')}</div>}>
            <Routes>
              <Route index element={<div className="h-full bg-neutral-100" />} />
              <Route path="assistant" element={<div />} />
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
          </Suspense>}
        </main>

        <motion.div
          layout
          transition={{ type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }}
          className={`h-full overflow-hidden bg-white ${
            isTeacherAssistantRoute && !showMobileHome
              ? 'relative flex-1 border-l-0 opacity-100'
              : teacherChatSidebarOpen
                ? 'relative flex-shrink-0 border-l border-slate-200 opacity-100'
                : 'pointer-events-none flex-shrink-0 border-l-0 opacity-0'
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

      <FloatingHelper
        hideTrigger={isMobile}
        open={isMobile ? feedbackOpen : undefined}
        onOpenChange={isMobile ? setFeedbackOpen : undefined}
      />
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
  const firstName = teacherName?.trim().split(/\s+/)[0] || 'docente'
  const tools = [
    { to: '/teacher/classes', title: 'Classi', description: 'Gestisci studenti e gruppi', icon: Users, tone: 'bg-sky-50 text-sky-700' },
    { to: '/teacher/sessions', title: 'Sessioni', description: 'Prepara e avvia una lezione', icon: PlayCircle, tone: 'bg-rose-50 text-rose-600' },
    { to: '/teacher/documents', title: 'Documenti', description: 'Materiali e risorse didattiche', icon: FileText, tone: 'bg-amber-50 text-amber-700' },
    { to: '/teacher/teacherbots', title: 'Teacherbot', description: 'Crea assistenti per la classe', icon: Bot, tone: 'bg-violet-50 text-violet-700' },
  ]

  return (
    <div className="min-h-full w-full overflow-y-auto bg-[#f4f6f8] px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">
      <section className="relative overflow-hidden rounded-[2rem] bg-slate-950 px-6 pb-6 pt-7 text-white shadow-2xl shadow-slate-300">
        <div className="absolute -right-16 -top-20 h-56 w-56 rounded-full opacity-30 blur-3xl" style={{ backgroundColor: accentColor }} />
        <div className="relative">
          <div className="flex items-center gap-2 text-sm font-bold text-emerald-400">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_0_5px_rgba(52,211,153,0.12)]" />
            Area docente connessa
          </div>
          <p className="mt-14 text-base font-bold text-slate-400">Ciao, {firstName}</p>
          <h1 className="mt-2 max-w-[15rem] text-4xl font-black leading-[1.05] tracking-tight">Cosa prepariamo oggi?</h1>
          <button
            type="button"
            onClick={onOpenAssistant}
            className="mt-8 flex w-full items-center gap-3 rounded-[1.35rem] bg-white px-5 py-5 text-left text-slate-950 shadow-lg"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-700">
              <AcademicAiIcon className="h-6 w-6" />
            </span>
            <span className="flex-1 text-lg font-black">Apri l'assistente AI</span>
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
            <span className="block text-xs font-bold uppercase tracking-wider text-emerald-600">Sessione attiva</span>
            <span className="block truncate text-base font-black text-slate-900">{currentSession.name}</span>
            <span className="block truncate text-xs text-slate-400">{currentSession.className}{currentSession.joinCode ? ` · ${currentSession.joinCode}` : ''}</span>
          </span>
          <ChevronRight className="h-5 w-5 text-slate-400" />
        </Link>
      )}

      <div className="mt-6 flex items-end justify-between px-1">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em]" style={{ color: accentColor }}>Workspace</p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">I tuoi strumenti</h2>
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
