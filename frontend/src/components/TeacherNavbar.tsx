import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { User, Settings, LogOut, ChevronDown, Users, MessageSquare, FileText, Check, Brain } from 'lucide-react'
import { Button } from './ui/button'
import { teacherApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import TeacherNotifications, { TeacherNotification } from './TeacherNotifications'
import { useSocket } from '@/hooks/useSocket'

interface TeacherProfile {
  firstName: string
  lastName: string
  email: string
  avatarUrl?: string
}

interface SessionInfo {
  id: string
  name: string
  className: string
}

interface ActiveSession {
  id: string
  name: string
  className: string
  studentCount?: number
}

interface TeacherNavbarProps {
  currentSession?: SessionInfo | null
  onSessionChange?: (session: SessionInfo) => void
}

export function TeacherNavbar({ currentSession, onSessionChange }: TeacherNavbarProps) {
  const location = useLocation()
  const navigate = useNavigate()

  const [profile, setProfile] = useState<TeacherProfile>({ firstName: '', lastName: '', email: '', avatarUrl: '' })
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [showSessionsMenu, setShowSessionsMenu] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const sessionsMenuRef = useRef<HTMLDivElement>(null)

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
        const newNotification: TeacherNotification = {
          id: latestNotification.id,
          type: notificationData.type as TeacherNotification['type'],
          session_id: notificationData.session_id || '',
          session_name: notificationData.session_name,
          class_name: notificationData.class_name,
          student_id: notificationData.student_id || '',
          nickname: notificationData.nickname || 'Studente',
          message: notificationData.message || latestNotification.text,
          preview: notificationData.preview,
          task_title: notificationData.task_title,
          quiz_answers: notificationData.quiz_answers,
          quiz_score: notificationData.quiz_score,
          timestamp: notificationData.timestamp || new Date().toISOString(),
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

  useEffect(() => {
    loadProfile()
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

  const loadProfile = async () => {
    try {
      const res = await teacherApi.getProfile()
      setProfile({
        firstName: res.data.first_name || '',
        lastName: res.data.last_name || '',
        email: res.data.email,
        avatarUrl: res.data.avatar_url || '',
      })
    } catch (error) {
      console.error('Failed to load profile', error)
    }
  }

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
            .filter((session: { status: string }) => {
              console.log(`[TeacherNavbar] Session "${session.title}" status:`, session.status)
              return session.status === 'active'  // Fixed: was 'ACTIVE', should be 'active'
            })
            .map((session: { id: string; title: string; student_count?: number }) => ({
              id: session.id,
              name: session.title,
              className: cls.name,
              studentCount: session.student_count || 0,
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

  const navItems = [
    { path: '/teacher', label: 'Supporto', icon: MessageSquare },
    { path: '/teacher/classes', label: 'Classi', icon: Users },
    { path: '/teacher/documents', label: 'Documenti', icon: FileText },
    { path: '/teacher/ml-lab', label: 'ML Lab', icon: Brain },
  ]

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-md border-b shadow-md" style={{ backgroundColor: '#1e293b', borderBottomColor: '#3b82f6', boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.3)' }}>
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo/Brand */}
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/teacher')}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center shadow-lg" style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)', boxShadow: '0 4px 6px -1px rgba(59, 130, 246, 0.4)' }}>
                <span className="text-white font-bold text-sm">G</span>
              </div>
              <span className="font-bold text-lg tracking-tight hidden sm:inline" style={{ color: '#ffffff' }}>Golinelli<span style={{ color: '#3b82f6' }}>AI</span></span>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1 p-1 rounded-xl border shadow-sm" style={{ backgroundColor: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.2)' }}>
              {navItems.map((item) => (
                <Link key={item.path} to={item.path}>
                  <button
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${isActive(item.path)
                      ? 'shadow-md'
                      : ''
                      }`}
                    style={{
                      backgroundColor: isActive(item.path) ? '#3b82f6' : 'transparent',
                      color: isActive(item.path) ? '#ffffff' : '#cbd5e1',
                    }}
                    onMouseEnter={(e) => {
                      if (!isActive(item.path)) {
                        e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.15)'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isActive(item.path)) {
                        e.currentTarget.style.backgroundColor = 'transparent'
                      }
                    }}
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
              />

              {/* Session Selector */}
              <div className="relative" ref={sessionsMenuRef}>
                <button
                  onClick={() => setShowSessionsMenu(!showSessionsMenu)}
                  className="hidden lg:flex items-center gap-3 px-4 py-2.5 rounded-xl border-2 transition-all duration-200 cursor-pointer"
                  style={{
                    backgroundColor: currentSession ? '#3b82f6' : 'transparent',
                    borderColor: '#3b82f6',
                    color: currentSession ? '#ffffff' : '#cbd5e1',
                  }}
                >
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${currentSession ? 'bg-green-400 animate-pulse shadow-sm shadow-green-300' : 'bg-white/50'}`} />
                  <div className="text-left min-w-0">
                    <p className="text-xs font-semibold truncate leading-tight" style={{ color: currentSession ? '#ffffff' : '#cbd5e1' }}>{currentSession ? currentSession.name : 'Nessuna sessione'}</p>
                    <p className="text-[10px] truncate leading-tight" style={{ color: currentSession ? 'rgba(255, 255, 255, 0.8)' : 'rgba(203, 213, 225, 0.7)' }}>{currentSession ? currentSession.className : 'Avvia una sessione'}</p>
                  </div>
                  <ChevronDown className={`h-3 w-3 ml-1 transition-transform flex-shrink-0 ${showSessionsMenu ? 'rotate-180' : ''}`} style={{ color: currentSession ? '#ffffff' : '#cbd5e1' }} />
                </button>

                {/* Sessions Dropdown Menu */}
                {showSessionsMenu && (
                  <div className="absolute right-0 mt-2 w-80 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150 origin-top-right z-50">
                    {/* Header */}
                    <div className="px-5 py-4 border-b border-slate-100" style={{ backgroundColor: '#fef3c7' }}>
                      <h3 className="font-bold text-slate-800">Sessioni Disponibili</h3>
                      <p className="text-xs text-slate-500 mt-0.5">Seleziona la sessione di lavoro</p>
                    </div>

                    {/* Sessions List */}
                    <div className="max-h-72 overflow-y-auto p-2">
                      {activeSessions.length === 0 ? (
                        <div className="text-center py-8">
                          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-3">
                            <Users className="h-6 w-6 text-slate-400" />
                          </div>
                          <p className="text-sm text-slate-500">Nessuna sessione disponibile</p>
                          <p className="text-xs text-slate-400 mt-1">Crea una nuova sessione dalla pagina Classi</p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          {activeSessions.map((session) => {
                            const isSelected = currentSession?.id === session.id
                            return (
                              <button
                                key={session.id}
                                onClick={() => {
                                  const sessionInfo = { id: session.id, name: session.name, className: session.className }
                                  onSessionChange?.(sessionInfo)
                                  // Persist complete session info
                                  localStorage.setItem('teacher_selected_session', JSON.stringify(sessionInfo))
                                  setShowSessionsMenu(false)
                                  navigate(`/teacher/sessions/${session.id}`)
                                }}
                                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-150 text-left group ${isSelected
                                  ? 'bg-cyan-100 border-2 border-cyan-300'
                                  : 'hover:bg-slate-50 border-2 border-transparent'
                                  }`}
                              >
                                <div className={`w-3 h-3 rounded-full flex-shrink-0 transition-colors ${isSelected ? 'bg-green-500 shadow-sm shadow-green-300' : 'bg-slate-300 group-hover:bg-cyan-300'
                                  }`} />
                                <div className="flex-1 min-w-0">
                                  <p className={`text-sm font-medium truncate ${isSelected ? 'text-cyan-800' : 'text-slate-700'}`}>
                                    {session.name}
                                  </p>
                                  <p className={`text-xs truncate ${isSelected ? 'text-cyan-600' : 'text-slate-400'}`}>
                                    {session.className}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2">
                                  {session.studentCount !== undefined && session.studentCount > 0 && (
                                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${isSelected
                                      ? 'bg-cyan-200 text-cyan-700'
                                      : 'bg-slate-100 text-slate-500 group-hover:bg-cyan-100 group-hover:text-cyan-600'
                                      }`}>
                                      {session.studentCount} studenti
                                    </span>
                                  )}
                                  {isSelected && (
                                    <Check className="h-5 w-5 text-cyan-600" />
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
                  className="flex items-center gap-3 rounded-full pl-1 pr-3 py-1 transition-colors border border-transparent"
                  style={{ backgroundColor: 'transparent' }}
                  onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'}
                  onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                >
                  {profile.avatarUrl ? (
                    <img
                      src={profile.avatarUrl}
                      alt="Avatar"
                      className="w-8 h-8 rounded-full object-cover border-2" style={{ borderColor: '#3b82f6' }}
                    />
                  ) : (
                    <div className={`w-8 h-8 rounded-full ${getAvatarColor()} flex items-center justify-center text-white text-xs font-bold border-2`} style={{ borderColor: '#3b82f6' }}>
                      {getInitials()}
                    </div>
                  )}
                  <div className="hidden md:block text-left">
                    <p className="text-xs font-medium leading-none" style={{ color: '#cbd5e1' }}>{profile.firstName}</p>
                  </div>
                  <ChevronDown className={`h-3 w-3 transition-transform ${showDropdown ? 'rotate-180' : ''}`} style={{ color: '#cbd5e1' }} />
                </button>

                {/* Dropdown Menu - Modern Floating Style */}
                {showDropdown && (
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-100 py-2 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
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
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
                      onMouseEnter={(e) => e.currentTarget.style.color = '#3b82f6'}
                      onMouseLeave={(e) => e.currentTarget.style.color = '#475569'}
                    >
                      <Settings className="h-4 w-4" />
                      Impostazioni account
                    </button>
                    <div className="h-px bg-slate-50 my-1"></div>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                    >
                      <LogOut className="h-4 w-4" />
                      Esci
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
                    ? 'bg-cyan-100 text-cyan-700 font-semibold'
                    : 'text-slate-500 hover:text-cyan-600'
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
            try {
              await teacherApi.updateProfile({
                first_name: updated.firstName,
                last_name: updated.lastName,
                avatar_url: updated.avatarUrl
              })
              setProfile(updated)
              setShowSettings(false)
            } catch (err) {
              console.error('Failed to save profile:', err)
              alert('Errore nel salvataggio del profilo')
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
  const [formData, setFormData] = useState(profile)
  const [previewUrl, setPreviewUrl] = useState(profile.avatarUrl || '')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('image/')) {
        alert('Per favore seleziona un file immagine')
        return
      }
      if (file.size > 5 * 1024 * 1024) {
        alert('Il file deve essere inferiore a 5MB')
        return
      }

      const reader = new FileReader()
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string
        setPreviewUrl(dataUrl)
        setFormData({ ...formData, avatarUrl: dataUrl })
      }
      reader.readAsDataURL(file)
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
          <h2 className="text-lg font-bold text-slate-900">Impostazioni Profilo</h2>
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
              onClick={() => fileInputRef.current?.click()}
              className="text-xs"
            >
              Cambia Foto
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Nome</label>
              <input
                type="text"
                value={formData.firstName}
                onChange={(e) => setFormData({ ...formData, firstName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Cognome</label>
              <input
                type="text"
                value={formData.lastName}
                onChange={(e) => setFormData({ ...formData, lastName: e.target.value })}
                className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Email</label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
              required
            />
          </div>



          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="flex-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100">
              Annulla
            </Button>
            <Button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-500/30">
              Salva Modifiche
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}