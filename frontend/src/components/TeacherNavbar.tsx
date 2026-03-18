import { useState, useRef, useEffect, type CSSProperties } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { User, Settings, LogOut, ChevronDown, Users, MessageSquare, FileText, Check, Brain, MonitorPlay } from 'lucide-react'
import { Button } from './ui/button'
import { LogoMark } from './LogoMark'
import { teacherApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import TeacherNotifications, { TeacherNotification } from './TeacherNotifications'
import { useSocket } from '@/hooks/useSocket'
import { DEFAULT_TEACHER_ACCENT, getTeacherAccentTheme, TEACHER_ACCENTS, type TeacherAccentId } from '@/lib/teacherAccent'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useTeacherProfile, useInvalidateTeacherProfile, TEACHER_PROFILE_KEY } from '@/hooks/useTeacherProfile'
import { useQueryClient } from '@tanstack/react-query'

interface TeacherProfile {
  firstName: string
  lastName: string
  email: string
  avatarUrl?: string
  uiAccent?: TeacherAccentId
}

interface SessionInfo {
  id: string
  name: string
  className: string
  joinCode?: string
}

interface ActiveSession {
  id: string
  name: string
  className: string
  studentCount?: number
  joinCode?: string
}

interface TeacherNavbarProps {
  currentSession?: SessionInfo | null
  onSessionChange?: (session: SessionInfo) => void
  chatSidebarOpen?: boolean
  onToggleChatSidebar?: () => void
}

export function TeacherNavbar({ currentSession, onSessionChange, chatSidebarOpen = false, onToggleChatSidebar }: TeacherNavbarProps) {
  const location = useLocation()
  const navigate = useNavigate()

  const { data: profileData } = useTeacherProfile()
  const invalidateProfile = useInvalidateTeacherProfile()
  const queryClient = useQueryClient()
  const profile: TeacherProfile = profileData ?? { firstName: '', lastName: '', email: '', avatarUrl: '', uiAccent: DEFAULT_TEACHER_ACCENT }
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [showSessionsMenu, setShowSessionsMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const sessionsMenuRef = useRef<HTMLDivElement>(null)
  const accentTheme = getTeacherAccentTheme(profile.uiAccent)
  const accentVars = {
    '--teacher-accent': accentTheme.accent,
    '--teacher-accent-text': accentTheme.text,
    '--teacher-accent-soft': accentTheme.soft,
    '--teacher-accent-soft-strong': accentTheme.softStrong,
    '--teacher-accent-border': accentTheme.border,
    backgroundColor: accentTheme.soft,
    borderBottomColor: accentTheme.border,
  } as CSSProperties

  // Global notifications state
  const [teacherNotifications, setTeacherNotifications] = useState<TeacherNotification[]>([])

  // Connect to global WebSocket for teacher notifications (empty sessionId for global)
  const { notifications: socketNotifications } = useSocket('')

  // Convert socket notifications to teacher notifications format
  useEffect(() => {
    if (socketNotifications.length > 0) {
      const latestNotification = socketNotifications[socketNotifications.length - 1]
      const notificationData = latestNotification.notification_data as {
        type?: string
        session_id?: string
        session_name?: string
        class_name?: string
        student_id?: string
        nickname?: string
        message?: string
        preview?: string
        task_title?: string
        quiz_answers?: Array<{
          question_index: number
          question_text: string
          student_answer: string
          correct_answer: string
          is_correct: boolean
        }>
        quiz_score?: { correct: number; total: number }
        timestamp?: string
      }

      if (notificationData.type) {
        const nd = notificationData as typeof notificationData & {
          alert_id?: string
          alert_type?: string
          risk_score?: number
        }
        const newNotification: TeacherNotification = {
          id: latestNotification.id,
          type: nd.type as TeacherNotification['type'],
          session_id: nd.session_id || '',
          session_name: nd.session_name,
          class_name: nd.class_name,
          student_id: nd.student_id || '',
          nickname: nd.nickname || 'Studente',
          message: nd.message || latestNotification.text,
          preview: nd.preview,
          task_title: nd.task_title,
          quiz_answers: nd.quiz_answers,
          quiz_score: nd.quiz_score,
          alert_id: nd.alert_id,
          alert_type: nd.alert_type as TeacherNotification['alert_type'],
          risk_score: nd.risk_score,
          alertStatus: 'pending',
          timestamp: nd.timestamp || new Date().toISOString(),
          read: false,
        }
        setTeacherNotifications(prev => [newNotification, ...prev])
      }
    }
  }, [socketNotifications])

  const handleClearNotifications = () => setTeacherNotifications([])
  const handleMarkAsRead = (id: string) => {
    setTeacherNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
  }

  const handleAlertAction = async (alertId: string, action: 'acknowledged' | 'blocked' | 'accepted') => {
    try {
      await fetch(`/api/v1/alerts/${alertId}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('teacher_token')}`,
        },
        body: JSON.stringify({ status: action }),
      })
    } catch (err) {
      console.error('[TeacherNavbar] Alert action failed:', err)
    }
    setTeacherNotifications(prev =>
      prev.map(n => n.alert_id === alertId ? { ...n, alertStatus: action } : n)
    )
  }

  useEffect(() => {
    loadActiveSessions()

    // Load saved session from localStorage and sync with parent
    const savedSession = localStorage.getItem('teacher_selected_session')
    if (savedSession && onSessionChange) {
      try {
        const sessionInfo = JSON.parse(savedSession)
        onSessionChange(sessionInfo)
      } catch (err) {
        console.error('Failed to parse saved session', err)
      }
    }
  }, [])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
      if (sessionsMenuRef.current && !sessionsMenuRef.current.contains(event.target as Node)) {
        setShowSessionsMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const loadActiveSessions = async () => {
    try {
      console.log('[TeacherNavbar] Loading active sessions...')
      // First, get all classes
      const classesRes = await teacherApi.getClasses()
      const classes = classesRes.data
      console.log('[TeacherNavbar] Found classes:', classes.length)

      // Then, get sessions for each class and aggregate
      const allSessions: ActiveSession[] = []
      for (const cls of classes) {
        try {
          const sessionsRes = await teacherApi.getSessions(cls.id)
          const sessions = sessionsRes.data
          console.log(`[TeacherNavbar] Class "${cls.name}" has ${sessions.length} sessions`)

          // Filter for ACTIVE sessions only (note: backend uses lowercase "active")
          const activeSessions = sessions
            .filter((session: { status: string; title: string }) => {
              console.log(`[TeacherNavbar] Session "${session.title}" status:`, session.status)
              return session.status === 'active'  // Fixed: was 'ACTIVE', should be 'active'
            })
            .map((session: { id: string; title: string; student_count?: number; join_code?: string }) => ({
              id: session.id,
              name: session.title,
              className: cls.name,
              studentCount: session.student_count || 0,
              joinCode: session.join_code,
            }))

          console.log(`[TeacherNavbar] Found ${activeSessions.length} active sessions in class "${cls.name}"`)
          allSessions.push(...activeSessions)
        } catch (err) {
          console.error(`Failed to load sessions for class ${cls.id}`, err)
        }
      }

      console.log('[TeacherNavbar] Total active sessions loaded:', allSessions.length)
      setActiveSessions(allSessions)
    } catch (error) {
      console.error('Failed to load active sessions', error)
    }
  }

  const handleLogout = () => {
    console.log('[TeacherNavbar] Logout clicked')
    setShowDropdown(false)

    // Clear localStorage tokens
    localStorage.removeItem('teacher_token')
    localStorage.removeItem('teacher_selected_session')

    // Clear Zustand persisted auth store (THIS IS CRITICAL!)
    useAuthStore.getState().logout()

    console.log('[TeacherNavbar] Store cleared, navigating to /login')
    navigate('/login')
  }

  const getInitials = () => {
    if (profile.firstName && profile.lastName) {
      return `${profile.firstName[0]}${profile.lastName[0]}`.toUpperCase()
    }
    return profile.email?.slice(0, 2).toUpperCase() || '??'
  }

  const getAvatarColor = () => {
    const colors = [
      'bg-purple-500', 'bg-blue-500', 'bg-green-500',
      'bg-yellow-500', 'bg-red-500', 'bg-pink-500',
    ]
    const charCode = profile.email?.charCodeAt(0) || 0
    return colors[charCode % colors.length]
  }

  const isActive = (path: string) => location.pathname === path

  const { t } = useTranslation()

  const navItems = [
    { path: '/teacher', label: t('navbar.nav_support'), icon: MessageSquare },
    { path: '/teacher/classes', label: t('navbar.nav_classes'), icon: Users },
    { path: '/teacher/demo', label: 'Studentbot', icon: MonitorPlay },
    { path: '/teacher/documents', label: t('navbar.nav_documents'), icon: FileText },
    { path: '/teacher/ml-lab', label: 'ML Lab', icon: Brain },
  ]

  const handleNotificationClick = (notification: TeacherNotification) => {
    // Navigate to session if applicable
    if (notification.session_id) {
      if (notification.type === 'private_message' || notification.type === 'public_chat') {
        const sessionInfo = {
          id: notification.session_id,
          name: notification.session_name || t('navbar.no_session'),
          className: notification.class_name || t('navbar.nav_classes'),
        }
        onSessionChange?.(sessionInfo)
        localStorage.setItem('teacher_selected_session', JSON.stringify(sessionInfo))
        navigate(`/teacher/sessions/${notification.session_id}?tab=chat`)
      } else if (notification.type === 'task_submitted' || notification.type === 'quiz_completed') {
        navigate(`/teacher/sessions/${notification.session_id}?tab=tasks`)
      } else {
        navigate(`/teacher/sessions/${notification.session_id}`)
      }
      setShowDropdown(false) // Close profile dropdown if open
    }
  }



  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-white/98 border-b shadow-sm" style={accentVars}>
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo/Brand */}
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => navigate('/teacher')}>
              <LogoMark className="h-9 w-9" />
              <div className="flex items-center gap-2">
                <span className="pb-[1px] text-[18px] leading-[1.15] tracking-tight" style={{ fontFamily: '"SofiaPro"' }}>
                  <span className="font-bold text-[#2d2d2d]/85">
                    Golinelli
                  </span>
                  <span className="font-black text-[#e85c8d]">.ai</span>
                </span>
                <span className="text-[9px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded-md bg-amber-50 text-amber-500 border border-amber-200 leading-none">BETA</span>
              </div>
            </div>

            <div className="hidden md:flex items-center gap-0.5 h-10 bg-white p-0.5 rounded-2xl border border-slate-200 shadow-sm">
              {navItems.map((item) => (
                <Link key={item.path} to={item.path}>
                  <button
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[12px] transition-colors duration-150 ${isActive(item.path)
                      ? 'bg-[var(--teacher-accent)] text-white font-bold border border-[var(--teacher-accent-border)]/50 shadow-sm'
                      : 'font-normal text-slate-600 hover:bg-slate-100 hover:text-[var(--teacher-accent-text)] border border-transparent'
                      }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </button>
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-3">
              {/* Teacher Notifications (unified) */}
              <TeacherNotifications
                notifications={teacherNotifications}
                onClearAll={handleClearNotifications}
                onMarkAsRead={handleMarkAsRead}
                onNotificationClick={handleNotificationClick}
                onAlertAction={handleAlertAction}
              />

              {/* Session Selector */}
              <div className="relative flex items-center gap-2" ref={sessionsMenuRef}>
                <button
                  onClick={() => setShowSessionsMenu(!showSessionsMenu)}
                  className="hidden lg:flex items-center gap-1.5 h-auto py-1.5 px-2.5 rounded-xl border bg-white border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-colors duration-150 cursor-pointer shadow-sm"
                >
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${currentSession ? 'bg-green-500 animate-pulse shadow-sm shadow-green-300' : 'bg-slate-300'}`} />
                  <div className="text-left min-w-0">
                    <span className="text-[11px] font-semibold text-[var(--teacher-accent-text)] truncate max-w-[120px] block leading-tight">{currentSession ? currentSession.name : t('navbar.no_session')}</span>
                    {currentSession?.joinCode && (
                      <span className="text-[9px] font-mono font-bold tracking-widest leading-tight block" style={{ color: accentTheme.accent }}>{currentSession.joinCode}</span>
                    )}
                  </div>
                  <ChevronDown className={`h-3 w-3 ml-0.5 text-slate-400 transition-transform flex-shrink-0 ${showSessionsMenu ? 'rotate-180' : ''}`} />
                </button>
                <button
                  className={`hidden lg:flex items-center justify-center p-2.5 rounded-full border transition-colors duration-150 shadow-sm`}
                  style={chatSidebarOpen
                    ? { backgroundColor: accentTheme.accent, borderColor: accentTheme.accent, color: '#fff' }
                    : { backgroundColor: `${accentTheme.accent}18`, borderColor: `${accentTheme.accent}50`, color: accentTheme.text }}
                  onClick={onToggleChatSidebar}
                  title={chatSidebarOpen ? t('navbar.hide_class_chat') : t('navbar.show_class_chat')}
                >
                  <MessageSquare className="h-4 w-4" />
                </button>

                {/* Sessions Dropdown Menu */}
                {showSessionsMenu && (
                  <div className="absolute top-full right-0 mt-2 w-80 bg-white/80 backdrop-blur-lg rounded-2xl shadow-xl border border-slate-200 overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top-right z-50">
                    {/* Header */}
                    <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
                      <h3 className="font-bold text-slate-800">{t('navbar.sessions_title')}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">{t('navbar.select_session_hint')}</p>
                    </div>

                    {/* Sessions List */}
                    <div className="max-h-72 overflow-y-auto p-2">
                      {activeSessions.length === 0 ? (
                        <div className="text-center py-8">
                          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                            <Users className="h-6 w-6 text-slate-400" />
                          </div>
                          <p className="text-sm text-slate-500">{t('navbar.no_sessions')}</p>
                          <p className="text-xs text-slate-400 mt-1">{t('navbar.create_session_hint')}</p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {activeSessions.map((session) => {
                            const isSelected = currentSession?.id === session.id
                            return (
                              <button
                                key={session.id}
                                onClick={() => {
                                  const sessionInfo = { id: session.id, name: session.name, className: session.className, joinCode: session.joinCode }
                                  onSessionChange?.(sessionInfo)
                                  // Persist complete session info
                                  localStorage.setItem('teacher_selected_session', JSON.stringify(sessionInfo))
                                  setShowSessionsMenu(false)
                                  navigate(`/teacher/sessions/${session.id}`)
                                }}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-150 text-left group border ${isSelected
                                  ? 'bg-[var(--teacher-accent-soft)] border-[var(--teacher-accent-border)]/50 shadow-sm'
                                  : 'hover:bg-slate-100/50 border-transparent'
                                  }`}
                              >
                                <div className={`w-3 h-3 rounded-full flex-shrink-0 transition-colors ${isSelected ? 'bg-green-500 shadow-sm shadow-green-300' : 'bg-slate-300 group-hover:bg-slate-400'
                                  }`} />
                                <div className="flex-1 min-w-0">
                                  <p className={`text-sm font-medium truncate ${isSelected ? 'text-[var(--teacher-accent-text)]' : 'text-slate-700'}`}>
                                    {session.name}
                                  </p>
                                  <p className={`text-xs truncate ${isSelected ? 'text-slate-700' : 'text-slate-400'}`}>
                                    {session.className}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  {session.studentCount !== undefined && session.studentCount > 0 && (
                                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${isSelected
                                      ? 'bg-slate-200 text-slate-800'
                                      : 'bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-[var(--teacher-accent-text)]'
                                      }`}>
                                      {session.studentCount} {t('navbar.students_label')}
                                    </span>
                                  )}
                                  {isSelected && (
                                    <Check className="h-4 w-4 text-[var(--teacher-accent-text)]" />
                                  )}
                                </div>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Avatar Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="flex items-center gap-1 hover:bg-slate-100 rounded-full p-1 transition-colors border border-transparent hover:border-slate-200"
                  title={`${profile.firstName} ${profile.lastName}`}
                >
                  {profile.avatarUrl ? (
                    <img
                      src={profile.avatarUrl}
                      alt="Avatar"
                      className="w-8 h-8 rounded-full object-cover"
                      style={{ boxShadow: `0 0 0 2px ${accentTheme.accent}` }}
                    />
                  ) : (
                    <div className={`w-8 h-8 rounded-full ${getAvatarColor()} flex items-center justify-center text-white text-xs font-bold`} style={{ boxShadow: `0 0 0 2px ${accentTheme.accent}` }}>
                      {getInitials()}
                    </div>
                  )}
                  <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu - Modern Floating Style */}
                {showDropdown && (
                  <div className="absolute right-0 mt-2 w-64 bg-white/80 backdrop-blur-lg rounded-xl shadow-xl border border-slate-100 py-2 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                    <div className="px-4 py-3 border-b border-slate-50 mb-1">
                      <p className="text-sm font-semibold text-slate-900">
                        {profile.firstName} {profile.lastName}
                      </p>
                      <p className="text-xs text-slate-500 truncate mt-0.5">{profile.email}</p>
                    </div>
                    <button
                      onClick={() => {
                        setShowSettings(true)
                        setShowDropdown(false)
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-[var(--teacher-accent-text)] transition-colors"
                    >
                      <Settings className="h-4 w-4" />
                      {t('navbar.settings')}
                    </button>
                    <div className="h-px bg-slate-50 my-1"></div>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="h-4 w-4" />
                      {t('navbar.logout')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Mobile Nav Links */}
          <div className="md:hidden flex items-center gap-1 pb-3 overflow-x-auto scrollbar-hide">
            {navItems.map((item) => (
              <Link key={item.path} to={item.path}>
                <Button
                  size="sm"
                  variant="ghost"
                  className={`${isActive(item.path)
                    ? 'bg-[var(--teacher-accent)] text-white font-bold'
                    : 'text-slate-500 hover:text-[var(--teacher-accent-text)]'
                    }`}
                >
                  {item.label}
                </Button>
              </Link>
            ))}
          </div>
        </div>
      </nav>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          profile={profile}
          onSave={async (updated) => {
            // Optimistic update in React Query cache
            queryClient.setQueryData(TEACHER_PROFILE_KEY, updated)
            window.dispatchEvent(new CustomEvent('teacherProfileUpdated', { detail: updated }))
            setShowSettings(false)

            try {
              await teacherApi.updateProfile({
                first_name: updated.firstName,
                last_name: updated.lastName,
                avatar_url: updated.avatarUrl,
                ui_accent: updated.uiAccent,
              })
              // Refetch to sync canonical data
              invalidateProfile()
            } catch (err) {
              console.error('Failed to save profile:', err)
              invalidateProfile()
            }
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  )
}

// Settings Modal Component (unchanged logic, updated UI implicitly via global CSS)
interface SettingsModalProps {
  profile: TeacherProfile
  onSave: (profile: TeacherProfile) => Promise<void> | void
  onClose: () => void
}

function SettingsModal({ profile, onSave, onClose }: SettingsModalProps) {
  const { t } = useTranslation()
  const [formData, setFormData] = useState(profile)
  const [previewUrl, setPreviewUrl] = useState(profile.avatarUrl || '')
  const [isUploading, setIsUploading] = useState(false)
  const modalAccentTheme = getTeacherAccentTheme(formData.uiAccent)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      alert('Per favore seleziona un file immagine')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      alert('Il file deve essere inferiore a 2MB')
      return
    }
    // Show instant local preview
    setPreviewUrl(URL.createObjectURL(file))
    // Upload to MinIO via backend
    setIsUploading(true)
    try {
      const res = await teacherApi.uploadAvatar(file)
      setFormData(fd => ({ ...fd, avatarUrl: res.data.avatar_url }))
    } catch {
      alert('Errore durante il caricamento dell\'immagine')
    } finally {
      setIsUploading(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSave(formData)
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md shadow-2xl border border-slate-100 overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-50 bg-slate-50/50">
          <h2 className="text-lg font-bold text-slate-900">{t('navbar.settings_title')}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Avatar Upload */}
          <div className="flex flex-col items-center gap-4">
            <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
              {previewUrl ? (
                <img src={previewUrl} alt="Avatar" className="w-24 h-24 rounded-full object-cover shadow-md ring-4 ring-white" />
              ) : (
                <div className="w-24 h-24 rounded-full bg-slate-100 flex items-center justify-center text-slate-400 text-3xl font-semibold shadow-inner">
                  {formData.firstName?.charAt(0) || 'D'}
                  {formData.lastName?.charAt(0) || ''}
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <User className="text-white w-8 h-8" />
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => !isUploading && fileInputRef.current?.click()}
              className="text-xs"
              disabled={isUploading}
            >
              {isUploading ? 'Caricamento...' : t('navbar.change_photo')}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">{t('navbar.first_name')}</label>
              <input
                type="text"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent transition-all outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">{t('navbar.last_name')}</label>
              <input
                type="text"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent transition-all outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">{t('navbar.email')}</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-slate-400 focus:border-transparent transition-all outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">{t('navbar.language_label')}</label>
            <LanguageSwitcher variant="full" />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">{t('navbar.accent_color')}</label>
            <div className="grid grid-cols-5 gap-2">
              {(Object.values(TEACHER_ACCENTS)).map((accentOption) => {
                const isSelected = formData.uiAccent === accentOption.id
                return (
                  <button
                    key={accentOption.id}
                    type="button"
                    onClick={() => setFormData({ ...formData, uiAccent: accentOption.id })}
                    className={`relative h-10 rounded-lg border transition-all ${isSelected ? 'border-slate-500' : 'border-slate-200 hover:border-slate-300'}`}
                    style={{ backgroundColor: accentOption.soft }}
                    title={accentOption.label}
                  >
                    <span className="absolute inset-0 m-auto h-5 w-5 rounded-full" style={{ backgroundColor: accentOption.accent }} />
                    {isSelected && (
                      <Check className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-white text-slate-700 p-0.5 shadow" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>



          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="flex-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100">
              {t('common.cancel')}
            </Button>
            <Button type="submit" className="flex-1 text-white shadow-lg" style={{ backgroundColor: modalAccentTheme.accent }} disabled={isUploading}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
