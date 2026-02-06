import { useState, useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import ClassesPage from './ClassesPage'
import SessionsPage from './SessionsPage'
import SessionLivePage from './SessionLivePage'
import TeacherSupportChat from './TeacherSupportChat'
import TeacherDocumentsPage from './TeacherDocumentsPage'
import TeacherMLLabPage from './TeacherMLLabPage'
import { TeacherNavbar } from '@/components/TeacherNavbar'
import ChatSidebar from '@/components/ChatSidebar'
import { teacherApi } from '@/lib/api'
import { AppBackground } from '@/components/ui/AppBackground'

export default function TeacherDashboard() {
  const location = useLocation()

  // Sidebar State - always visible and pinned
  const [teacherProfile, setTeacherProfile] = useState<{ id: string, name: string } | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(380)
  const [showSidebar, setShowSidebar] = useState(true)

  // Load persisted session from localStorage
  const getPersistedSession = (): { id: string, name: string, className: string } | null => {
    try {
      const stored = localStorage.getItem('teacher_selected_session')
      if (stored) {
        return JSON.parse(stored)
      }
    } catch {
      // Invalid JSON, clear it
      localStorage.removeItem('teacher_selected_session')
    }
    return null
  }

  const [currentSession, setCurrentSession] = useState<{ id: string, name: string, className: string } | null>(getPersistedSession)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(currentSession?.id || null)

  // Detect session ID from URL or use persisted session
  useEffect(() => {
    const match = location.pathname.match(/\/sessions\/([^\/]+)/)
    const urlSessionId = match?.[1]

    if (urlSessionId) {
      // URL has a session ID - load its info and set it as current
      setActiveSessionId(urlSessionId)
      teacherApi.getSessionLive(urlSessionId).then((res: { data: { session: { name?: string; title?: string; class_name?: string } } }) => {
        const sessionInfo = {
          id: urlSessionId,
          name: res.data.session?.name || res.data.session?.title || 'Sessione',
          className: res.data.session?.class_name || 'Classe'
        }
        setCurrentSession(sessionInfo)
        // Persist the session
        localStorage.setItem('teacher_selected_session', JSON.stringify(sessionInfo))
      }).catch(() => {
        // Session not found, but keep the persisted one if available
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
      // No URL session, but we have a persisted one - validate it still exists
      setActiveSessionId(currentSession.id)
      teacherApi.getSessionLive(currentSession.id).catch(() => {
        // Session no longer valid, clear it
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
          name: `${res.data.first_name} ${res.data.last_name}`
        })
      } catch (e) { console.error(e) }
    }
    loadProfile()
  }, [])

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

  return (
    <AppBackground className="h-screen flex flex-col overflow-hidden">
      <TeacherNavbar
        currentSession={currentSession}
        onSessionChange={(session) => {
          setCurrentSession(session)
          setActiveSessionId(session.id)
          // Persist session selection
          localStorage.setItem('teacher_selected_session', JSON.stringify(session))
        }}
        showChatToggle={!showSidebar}
        onShowChatSidebar={() => setShowSidebar(true)}
      />

      <div className="flex-1 flex overflow-hidden pt-16">
        {/* Main Content */}
        <main className="flex-1 overflow-y-auto relative">
          <Routes>
            <Route index element={<TeacherSupportChat />} />
            <Route path="documents" element={<TeacherDocumentsPage />} />
            <Route path="ml-lab" element={<TeacherMLLabPage />} />
            <Route path="classes" element={<ClassesPage />} />
            <Route path="sessions" element={<SessionsPage />} />
            <Route path="sessions/:sessionId" element={<SessionLivePage />} />
          </Routes>
        </main>

        {showSidebar ? (
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
                <p className="text-sm font-medium text-slate-700 mb-1">Chat di Classe</p>
                <p className="text-xs text-slate-400">Seleziona una sessione per visualizzare la chat.</p>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </AppBackground>
  )
}
