import { useState, useEffect, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { Routes, Route, useLocation, Link, useNavigate } from 'react-router-dom'
import { MessageSquare, Users, PlayCircle, Bot, Loader2, LogOut } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
// TeacherSupportChat is the landing route — kept eager
import TeacherSupportChat from './TeacherSupportChat'
// All other pages lazy-loaded: they contain heavy deps (Tiptap, Canvas, etc.)
const ClassesPage       = lazy(() => import('./ClassesPage'))
const SessionsPage      = lazy(() => import('./SessionsPage'))
const SessionLivePage   = lazy(() => import('./SessionLivePage'))
const TeacherDocumentsPage = lazy(() => import('./TeacherDocumentsPage'))
const TeacherMLLabPage  = lazy(() => import('./TeacherMLLabPage'))
import { TeacherNavbar } from '@/components/TeacherNavbar'
import ChatSidebar from '@/components/ChatSidebar'
import { teacherApi } from '@/lib/api'
import { AppBackground } from '@/components/ui/AppBackground'
import { getTeacherAccentTheme, DEFAULT_TEACHER_ACCENT, type TeacherAccentId } from '@/lib/teacherAccent'
import { getAppBackgroundGradient } from '@/lib/theme'
import { useMobile } from '@/hooks/useMobile'

const CHATBAR_AUTO_HIDE_BREAKPOINT = 1280

const MOBILE_NAV = [
  { path: '/teacher',          label: 'Chat',     icon: MessageSquare, exact: true },
  { path: '/teacher/classes',  label: 'Classi',   icon: Users },
  { path: '/teacher/sessions', label: 'Sessioni', icon: PlayCircle },
]

export default function TeacherDashboard() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const { isMobile } = useMobile()
  const { logout } = useAuthStore()

  const [teacherProfile, setTeacherProfile] = useState<{ id: string, name: string, uiAccent?: TeacherAccentId } | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(380)
  const [showSidebar, setShowSidebar] = useState(false)

  const getPersistedSession = (): { id: string, name: string, className: string } | null => {
    try {
      const stored = localStorage.getItem('teacher_selected_session')
      if (stored) return JSON.parse(stored)
    } catch {
      localStorage.removeItem('teacher_selected_session')
    }
    return null
  }

  const [currentSession, setCurrentSession] = useState<{ id: string, name: string, className: string } | null>(getPersistedSession)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(currentSession?.id || null)

  useEffect(() => {
    const match = location.pathname.match(/\/sessions\/([^\/]+)/)
    const urlSessionId = match?.[1]

    if (urlSessionId) {
      setActiveSessionId(urlSessionId)
      teacherApi.getSessionLive(urlSessionId).then((res: { data: { session: { name?: string; title?: string; class_name?: string } } }) => {
        const sessionInfo = {
          id: urlSessionId,
          name: res.data.session?.name || res.data.session?.title || t('navbar.no_session'),
          className: res.data.session?.class_name || t('navbar.nav_classes')
        }
        setCurrentSession(sessionInfo)
        localStorage.setItem('teacher_selected_session', JSON.stringify(sessionInfo))
      }).catch(() => {
        const persisted = getPersistedSession()
        if (persisted) {
          setCurrentSession(persisted)
          setActiveSessionId(persisted.id)
        } else {
          setCurrentSession(null)
          setActiveSessionId(null)
        }
      })
    } else if (currentSession?.id) {
      setActiveSessionId(currentSession.id)
      teacherApi.getSessionLive(currentSession.id).catch(() => {
        localStorage.removeItem('teacher_selected_session')
        setCurrentSession(null)
        setActiveSessionId(null)
      })
    }
  }, [location.pathname])

  useEffect(() => {
    const loadProfile = async () => {
      try {
        const res = await teacherApi.getProfile()
        setTeacherProfile({
          id: res.data.id,
          name: `${res.data.first_name} ${res.data.last_name}`,
          uiAccent: res.data.ui_accent || DEFAULT_TEACHER_ACCENT,
        })
      } catch (e) { console.error(e) }
    }
    loadProfile()

    const handleProfileUpdate = (e: any) => {
      const updated = e.detail
      setTeacherProfile(prev => prev ? ({
        ...prev,
        name: `${updated.firstName} ${updated.lastName}`,
        uiAccent: updated.uiAccent
      }) : null)
    }
    window.addEventListener('teacherProfileUpdated', handleProfileUpdate)
    return () => window.removeEventListener('teacherProfileUpdated', handleProfileUpdate)
  }, [])

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
          <div
            className="w-7 h-7 rounded-xl flex items-center justify-center mr-2.5 shadow-sm flex-shrink-0"
            style={{ background: `linear-gradient(135deg, ${teacherTheme.accent}, ${teacherTheme.text})` }}
          >
            <Bot className="h-4 w-4 text-white" />
          </div>
          <span className="text-sm font-bold flex-1" style={{ color: teacherTheme.text }}>
            {teacherProfile?.name || 'Docente AI'}
          </span>
          <button
            onClick={() => { logout(); navigate('/login') }}
            className="flex items-center gap-1 text-xs text-slate-500 hover:text-red-500 transition-colors px-2 py-1 rounded-lg hover:bg-red-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Esci</span>
          </button>
        </div>
      )}

      {/* ── Main Content ── */}
      <div className={`flex-1 flex overflow-hidden ${isMobile ? 'pt-12 pb-16' : 'pt-16'}`}>
        <main className="flex-1 overflow-y-auto relative">
          <Suspense fallback={
            <div className="flex items-center justify-center h-full min-h-[60vh]">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          }>
            <Routes>
              <Route index element={<TeacherSupportChat />} />
              <Route path="documents" element={<TeacherDocumentsPage />} />
              <Route path="ml-lab" element={<TeacherMLLabPage />} />
              <Route path="classes" element={<ClassesPage />} />
              <Route path="sessions" element={<SessionsPage />} />
              <Route path="sessions/:sessionId" element={<SessionLivePage />} />
            </Routes>
          </Suspense>
        </main>

        {/* Right chat sidebar — desktop only */}
        {!isMobile && showSidebar && (
          <div
            className="border-l border-slate-200 bg-white h-full flex-shrink-0 relative"
            style={{ width: `${sidebarWidth}px` }}
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
          {MOBILE_NAV.map(({ path, label, icon: Icon, exact }) => {
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
    </AppBackground>
  )
}
