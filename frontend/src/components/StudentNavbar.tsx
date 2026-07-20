import { useState, useRef, useEffect, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, Settings, LogOut, ChevronDown, Bot, Brain, Award, FileEdit, FileText, Menu, X, MessageSquare, Mic, FileCode2, MonitorPlay, BookOpen, Code2, KanbanSquare } from 'lucide-react'
import { Button } from './ui/button'
import { LogoMark } from './LogoMark'
import { studentApi } from '@/lib/api'
import { DEFAULT_STUDENT_ACCENT, getStudentAccentTheme, saveStudentAccent, type StudentAccentId } from '@/lib/studentAccent'
import { NavTab } from '@/components/ui/NavTab'
import { useTranslation } from 'react-i18next'
import { LanguageSwitcher } from '@/components/LanguageSwitcher'
import { useAuthStore } from '@/stores/auth'
import { NavbarCalendarClock } from './NavbarCalendarClock'
import WhatsNewModal from './WhatsNewModal'
import { buildAccentNavbarStyle, buildAccentNavClusterStyle } from '@/lib/navbarGlass'
import { CreditBalancePill } from './CreditBalancePill'
import { StudentNotificationBell } from './StudentNotificationBell'
import { ServerHealthIndicator } from './ServerHealthIndicator'

interface StudentProfile {
  id?: string
  nickname: string
  avatarUrl?: string
  uiAccent?: StudentAccentId
}

interface StudentNavbarProps {
  activeModule?: string | null
  onNavigate?: (module: string | null) => void
  sessionTitle?: string
  sessionId?: string
  joinCode?: string
  chatSidebarOpen?: boolean
  onToggleChatSidebar?: () => void
  accent?: StudentAccentId
  onAccentChange?: (accent: StudentAccentId) => void
  enabledModules?: string[]
  chatAvailable?: boolean
  pendingTasksCount?: number
}

export function StudentNavbar({
  activeModule,
  onNavigate,
  sessionTitle,
  sessionId,
  joinCode,
  chatSidebarOpen = false,
  onToggleChatSidebar,
  accent = DEFAULT_STUDENT_ACCENT,
  onAccentChange,
  enabledModules,
  chatAvailable = true,
  pendingTasksCount = 0,
}: StudentNavbarProps) {
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const isPreviewMode = localStorage.getItem('_preview_mode') === 'true'

  const handleExitPreview = () => {
    const tokenBackup = localStorage.getItem('_teacher_token_backup')
    const userBackup = localStorage.getItem('_teacher_user_backup')
    if (tokenBackup && userBackup) {
      try {
        const user = JSON.parse(userBackup)
        useAuthStore.getState().setUser(user, tokenBackup)
      } catch {
        // fallback: just navigate
      }
    }
    localStorage.removeItem('_preview_mode')
    localStorage.removeItem('_teacher_token_backup')
    localStorage.removeItem('_teacher_user_backup')
    localStorage.removeItem('student_token')
    navigate('/teacher/demo')
  }
  const [showDropdown, setShowDropdown] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const [showWhatsNew, setShowWhatsNew] = useState(false)
  const [voiceActive, setVoiceActive] = useState(false)
  const [chatBadge, setChatBadge] = useState(0)
  const [documentsBadge, setDocumentsBadge] = useState(0)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)
  const activeModuleRef = useRef<string | null | undefined>(activeModule)
  const chatSidebarOpenRef = useRef(chatSidebarOpen)
  const profileIdRef = useRef<string | undefined>(undefined)

  useEffect(() => {
    activeModuleRef.current = activeModule
  }, [activeModule])

  useEffect(() => {
    chatSidebarOpenRef.current = chatSidebarOpen
  }, [chatSidebarOpen])

  // Teacher-shared documents are surfaced on the Documents nav item. Published
  // tasks use the authoritative pending-submission count passed by the dashboard.
  useEffect(() => {
    let socket: any = null
    const bumpDocuments = () => {
      if (activeModuleRef.current === 'documents') return
      setDocumentsBadge((n) => n + 1)
    }
    const attach = () => {
      const s = (window as any).socket
      if (s && s !== socket) {
        socket = s
        s.on('document_uploaded', bumpDocuments)
      }
    }
    attach()
    const iv = setInterval(attach, 1500)
    window.addEventListener('student-document-uploaded', bumpDocuments)
    return () => {
      clearInterval(iv)
      window.removeEventListener('student-document-uploaded', bumpDocuments)
      if (socket) {
        socket.off('document_uploaded', bumpDocuments)
      }
    }
  }, [])

  useEffect(() => {
    if (chatSidebarOpen) setChatBadge(0)
  }, [chatSidebarOpen])

  useEffect(() => {
    let socket: any = null
    const handleChatMessage = (data: { room_type?: string; message?: { sender_id?: string } }) => {
      if (data?.room_type !== 'PUBLIC' || chatSidebarOpenRef.current) return
      if (data.message?.sender_id && data.message.sender_id === profileIdRef.current) return
      setChatBadge((count) => count + 1)
    }
    const attach = () => {
      const nextSocket = (window as any).socket
      if (!nextSocket || nextSocket === socket) return
      if (socket) socket.off('chat_message', handleChatMessage)
      socket = nextSocket
      socket.on('chat_message', handleChatMessage)
    }
    attach()
    const interval = window.setInterval(attach, 1500)
    return () => {
      window.clearInterval(interval)
      if (socket) socket.off('chat_message', handleChatMessage)
    }
  }, [])

  useEffect(() => {
    if (activeModule === 'documents') setDocumentsBadge(0)
  }, [activeModule])

  const { t } = useTranslation()
  const [profile, setProfile] = useState<StudentProfile>({
    nickname: t('navbar.role_student')
  })
  const accentTheme = getStudentAccentTheme(accent)
  const accentVars = buildAccentNavbarStyle(accentTheme, {
    '--student-accent': accentTheme.accent,
    '--student-accent-soft': accentTheme.soft,
    '--student-accent-soft-strong': accentTheme.softStrong,
    '--student-accent-border': accentTheme.border,
    '--student-accent-text': accentTheme.text,
  }) as CSSProperties

  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--app-accent', accentTheme.accent)
    root.style.setProperty('--app-accent-text', accentTheme.text)
    root.style.setProperty('--app-accent-soft', accentTheme.soft)
    root.style.setProperty('--app-accent-soft-strong', accentTheme.softStrong)
    root.style.setProperty('--app-accent-border', accentTheme.border)
    root.style.setProperty('--app-body-bg', '#f1f3f5')
    root.style.setProperty('--surface-page', '#f1f3f5')
  }, [accentTheme])

  useEffect(() => {
    setVoiceActive(false)
    if (!sessionId) return

    const handleVoiceState = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; active?: boolean }>).detail
      if (detail?.sessionId === sessionId) {
        setVoiceActive(Boolean(detail.active))
      }
    }

    window.addEventListener('golinelli:voice-room-state', handleVoiceState)
    return () => window.removeEventListener('golinelli:voice-room-state', handleVoiceState)
  }, [sessionId])

  // Load profile from API
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const response = await studentApi.getProfile()
        const data = response.data
        setProfile({
          id: data.id,
          nickname: data.nickname || t('navbar.role_student'),
          avatarUrl: data.avatar_url || undefined,
          uiAccent: data.ui_accent || undefined,
        })
        profileIdRef.current = data.id
        if (data.ui_accent && onAccentChange) {
          const serverAccent = data.ui_accent as StudentAccentId
          onAccentChange(serverAccent)
          saveStudentAccent(serverAccent)
        }
      } catch (err) {
        console.error('Failed to load profile:', err)
      }
    }
    loadProfile()
  }, [onAccentChange])

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false)
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setShowMobileMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Generate avatar with initials
  const getInitials = () => {
    const words = profile.nickname.split(' ')
    if (words.length > 1) {
      return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase()
    }
    return profile.nickname.substring(0, 2).toUpperCase()
  }

  // Generate random color based on nickname (consistent)
  const getAvatarColor = () => {
    const colors = [
      'bg-[var(--logo-pink)]',
      'bg-[var(--logo-blue)]',
      'bg-[var(--logo-violet)]'
    ]
    const hash = profile.nickname.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return colors[hash % colors.length]
  }

  const handleLogout = () => {
    logout()
    localStorage.removeItem('student_nickname')
    navigate('/join')
  }

  const ALL_NAV_ITEMS = [
    { key: 'chatbot', label: t('navbar.nav_chatbot'), icon: Bot },
    { key: 'classification', label: t('navbar.nav_ml_lab'), icon: Brain },
    { key: 'documents', label: t('navbar.nav_documents'), icon: FileEdit },
    { key: 'self_assessment', label: t('navbar.nav_tasks'), icon: Award },
    { key: 'notebook', label: t('navbar.nav_notebook'), icon: FileCode2 },
    { key: 'coding', label: t('navbar.nav_coding_lab'), icon: Code2 },
    { key: 'boards', label: 'Board', icon: KanbanSquare },
  ]
  // Always show core modules; filter optional modules by session settings
  const ALWAYS_SHOWN = new Set(['chatbot', 'documents'])
  const navItems = enabledModules
    ? ALL_NAV_ITEMS.filter(item => ALWAYS_SHOWN.has(item.key) || enabledModules.includes(item.key))
    : ALL_NAV_ITEMS
  const getNavBadge = (key: string) => {
    if (key === 'self_assessment') return pendingTasksCount
    if (key === 'documents') return documentsBadge
    return 0
  }
  const handleNavigate = (key: string) => {
    if (key === 'documents') setDocumentsBadge(0)
    onNavigate?.(key)
  }

  return (
    <>
      {/* Preview mode banner */}
      {isPreviewMode && (
        <div className="fixed top-0 left-0 right-0 z-[60] bg-[var(--logo-violet)] text-white text-xs font-semibold flex items-center justify-center gap-3 py-1.5 px-4">
          <MonitorPlay className="h-3.5 w-3.5 flex-shrink-0" />
          <span>{t('navbar.preview_banner')}</span>
          <button
            onClick={handleExitPreview}
            className="ml-2 underline hover:no-underline font-bold"
          >
            {t('navbar.preview_exit')}
          </button>
        </div>
      )}
      <nav
        className={`fixed left-0 right-0 z-50 border-b ${isPreviewMode ? 'top-8' : 'top-0'}`}
        style={accentVars}
      >
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo/Brand */}
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => onNavigate?.(null)}>
              <LogoMark className="h-9 w-9" />
              <div className="flex items-center gap-1.5 pt-0.5">
                <span className="brand-wordmark">
                  Golinelli<span className="brand-wordmark-ai">.ai</span>
                </span>
                <ServerHealthIndicator />
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setShowWhatsNew(true)
                  }}
                  className="inline-flex items-center self-center transition-transform hover:-translate-y-px"
                >
                  <span className="brand-beta-badge">
                    BETA
                  </span>
                </button>
              </div>
            </div>

            {/* Mobile Menu Button - Hidden since MobileNav handles navigation */}
            {onNavigate && (
              <div className="hidden">
                <button
                  onClick={() => setShowMobileMenu(!showMobileMenu)}
                  className="p-2 rounded-lg hover:bg-[var(--student-accent-soft)] transition-colors"
                >
                  {showMobileMenu ? <X className="h-5 w-5 text-[var(--student-accent-text)]" /> : <Menu className="h-5 w-5 text-[var(--student-accent-text)]" />}
                </button>
              </div>
            )}

            {/* Desktop Navigation */}
            {onNavigate && (
              <div className="hidden xl:flex items-center gap-1 h-11 rounded-[var(--selection-radius)] border p-1" style={buildAccentNavClusterStyle(accentTheme)}>
                {(() => {
                  const activeIdx = navItems.findIndex(item => activeModule === item.key)
                  return navItems.map((item, idx) => (
                    <NavTab
                      key={item.label}
                      icon={item.icon}
                      label={item.label}
                      isActive={activeModule === item.key}
                      isAdjacent={Math.abs(idx - activeIdx) === 1}
                      onClick={() => handleNavigate(item.key)}
                      accentTextClass="text-[var(--student-accent-text)]"
                      badgeCount={getNavBadge(item.key)}
                    />
                  ))
                })()}
              </div>
            )}

            <div className="hidden xl:block h-8 w-px bg-slate-200/80 mx-1" />

            <div className="flex items-center gap-3">
              <div className="hidden h-11 items-center gap-1 rounded-[var(--selection-radius)] border p-1 lg:flex" style={buildAccentNavClusterStyle(accentTheme)}>
                {/* Date/time + mini calendar */}
                <NavbarCalendarClock
                  sessionId={sessionId}
                  accentColor={accentTheme.accent}
                  inNavCluster
                />

                {/* Session Info - Always visible */}
                {sessionTitle && (
                  <div
                    className="navbar-inline-control flex h-9 items-center gap-2 rounded-[var(--selection-radius)] px-3"
                    style={{ '--btn-tone': accentTheme.accent } as CSSProperties}
                  >
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse shadow-sm shadow-green-300" />
                    <div className="text-left min-w-0">
                      <span className="block max-w-[150px] truncate text-[11px] font-bold leading-tight text-[var(--student-accent-text)]">{sessionTitle}</span>
                      {joinCode && (
                        <span className="block text-[10px] font-mono font-black leading-tight tracking-widest" style={{ color: accentTheme.accent }}>{joinCode}</span>
                      )}
                    </div>
                  </div>
                )}

                {chatAvailable && onToggleChatSidebar && (
                  <button
                    className={`navbar-inline-control relative flex h-9 w-9 items-center justify-center rounded-[var(--selection-radius)] p-0 ${chatSidebarOpen ? 'navbar-inline-control-active' : ''}`}
                    style={{ '--btn-tone': accentTheme.accent } as CSSProperties}
                    onClick={onToggleChatSidebar}
                    title={chatSidebarOpen ? t('navbar.hide_class_chat') : t('navbar.show_class_chat')}
                  >
                    <MessageSquare className="h-4 w-4 flex-shrink-0" />
                    {voiceActive ? (
                      <span
                        className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-white ring-2 ring-white"
                        style={{ backgroundColor: accentTheme.accent }}
                      >
                        <span
                          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-40"
                          style={{ backgroundColor: accentTheme.accent }}
                        />
                        <Mic className="relative h-2.5 w-2.5" />
                      </span>
                    ) : chatBadge > 0 ? (
                      <span
                        className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ring-2 ring-white"
                        style={{ backgroundColor: accentTheme.accent }}
                      >
                        {chatBadge > 9 ? '9+' : chatBadge}
                      </span>
                    ) : null}
                  </button>
                )}

                <StudentNotificationBell accentColor={accentTheme.accent} onNavigate={onNavigate} />

                <CreditBalancePill audience="student" accentColor={accentTheme.accent} />
              </div>

              <div className="lg:hidden">
                <CreditBalancePill audience="student" accentColor={accentTheme.accent} />
              </div>

              {/* Avatar Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="group flex items-center gap-1 rounded-full border border-transparent p-1 transition-colors hover:bg-slate-100"
                  title={profile.nickname}
                >
                  {profile.avatarUrl ? (
                    <img
                      src={profile.avatarUrl}
                      alt="Avatar"
                      className="h-10 w-10 rounded-full object-cover transition-transform duration-200 group-hover:scale-110"
                      style={{ boxShadow: `0 0 0 2px ${accentTheme.accent}` }}
                    />
                  ) : (
                    <div
                      className={`h-10 w-10 rounded-full ${getAvatarColor()} flex items-center justify-center text-sm font-bold text-white transition-transform duration-200 group-hover:scale-110`}
                      style={{ boxShadow: `0 0 0 2px ${accentTheme.accent}` }}
                    >
                      {getInitials()}
                    </div>
                  )}
                  <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu - Modern Floating Style */}
                {showDropdown && (
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-100 py-2 animate-in fade-in zoom-in-95 duration-100 origin-top-right z-50">
                    <div className="px-4 py-3 border-b border-slate-50 mb-1">
                      <p className="text-sm font-semibold text-slate-900">{profile.nickname}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{t('navbar.role_student')}</p>
                    </div>
                    <button
                      onClick={() => {
                        setShowSettings(true)
                        setShowDropdown(false)
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-[var(--student-accent-text)] transition-colors"
                    >
                      <Settings className="h-4 w-4" />
                      {t('navbar.settings')}
                    </button>
                    <button
                      onClick={() => {
                        setShowDropdown(false)
                        if (onNavigate) {
                          onNavigate('wiki')
                        } else {
                          navigate('/student/wiki')
                        }
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-[var(--student-accent-text)] transition-colors"
                    >
                      <BookOpen className="h-4 w-4" />
                      {t('navbar.nav_wiki')}
                    </button>
                    <button
                      onClick={() => {
                        setShowDropdown(false)
                        navigate('/terms')
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-[var(--student-accent-text)] transition-colors"
                    >
                      <FileText className="h-4 w-4" />
                      Termini e condizioni
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

          {/* Mobile Menu Dropdown */}
          {showMobileMenu && (
            <div ref={mobileMenuRef} className="md:hidden absolute top-full left-0 right-0 bg-white border-b border-slate-200 shadow-lg animate-in slide-in-from-top-2 duration-200">
              <div className="px-4 py-3 space-y-1">
                {navItems.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      handleNavigate(item.key)
                      setShowMobileMenu(false)
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${activeModule === item.key
                        ? 'bg-[var(--student-accent-soft)] text-[var(--student-accent-text)]'
                        : 'text-slate-600 hover:bg-[var(--student-accent-soft)] hover:text-[var(--student-accent-text)]'
                      }`}
                  >
                    <span className="relative">
                      <item.icon className="h-4 w-4" />
                      {getNavBadge(item.key) > 0 && (
                        <span className="absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#fe004d] px-1 text-[10px] font-black leading-none text-white ring-2 ring-white">
                          {getNavBadge(item.key) > 9 ? '9+' : getNavBadge(item.key)}
                        </span>
                      )}
                    </span>
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </nav>

      {onNavigate && (
        <aside
          className={`fixed left-0 bottom-0 z-40 hidden w-16 border-r px-2 py-3 md:flex xl:hidden ${isPreviewMode ? 'top-24' : 'top-16'}`}
          style={accentVars}
          aria-label={t('navbar.nav_desktop')}
        >
          <div className="flex w-full flex-col items-center gap-1.5">
            {navItems.map((item) => {
              const Icon = item.icon
              const isActiveItem = activeModule === item.key
              return (
                <button
                  key={item.key}
                  onClick={() => handleNavigate(item.key)}
                  aria-label={item.label}
                  className="relative flex h-11 w-11 items-center justify-center rounded-xl border text-slate-600 transition-colors hover:bg-white/70 hover:text-[var(--student-accent-text)]"
                  style={isActiveItem
                    ? {
                        backgroundColor: accentTheme.accent,
                        borderColor: `${accentTheme.accent}45`,
                        color: '#fff',
                      }
                    : {
                        backgroundColor: 'rgba(255,255,255,0.56)',
                        borderColor: 'rgba(255,255,255,0.34)',
                      }}
                >
                  <Icon className="h-5 w-5" />
                  {getNavBadge(item.key) > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#fe004d] px-1 text-[10px] font-black leading-none text-white ring-2 ring-white">
                      {getNavBadge(item.key) > 9 ? '9+' : getNavBadge(item.key)}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </aside>
      )}
      {showWhatsNew && <WhatsNewModal onClose={() => setShowWhatsNew(false)} />}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          profile={profile}
          accent={accent}
          onSave={async (updated, nextAccent) => {
            // Optimistic Update
            setProfile(updated)
            onAccentChange?.(nextAccent)
            saveStudentAccent(nextAccent)
            window.dispatchEvent(new CustomEvent('studentAccentChanged'))
            setShowSettings(false)

            try {
              await studentApi.updateProfile({
                avatar_url: updated.avatarUrl,
                ui_accent: nextAccent,
              })
            } catch (err) {
              console.error('Failed to save profile:', err)
              // We could revert here, but for "fast" feeling, we'll just log
            }
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  )
}

// Settings Modal Component
interface SettingsModalProps {
  profile: StudentProfile
  accent: StudentAccentId
  onSave: (profile: StudentProfile, accent: StudentAccentId) => Promise<void> | void
  onClose: () => void
}

function SettingsModal({ profile, accent, onSave, onClose }: SettingsModalProps) {
  const { t } = useTranslation()
  const [formData, setFormData] = useState(profile)
  const [previewUrl, setPreviewUrl] = useState(profile.avatarUrl || '')
  const [selectedAccent] = useState<StudentAccentId>(accent)
  const selectedTheme = getStudentAccentTheme(selectedAccent)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (!file.type.startsWith('image/')) {
        alert(t('navbar.image_only_error'))
        return
      }
      if (file.size > 5 * 1024 * 1024) {
        alert(t('navbar.image_max_5mb'))
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
    onSave(formData, selectedAccent)
  }

  // Generate initials for preview
  const getInitials = () => {
    const words = formData.nickname.split(' ')
    if (words.length > 1) {
      return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase()
    }
    return formData.nickname.substring(0, 2).toUpperCase()
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl border border-slate-100 overflow-hidden animate-in zoom-in-95 duration-200">
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
                  {getInitials()}
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
              className="text-xs rounded-xl"
            >
              {t('navbar.change_photo')}
            </Button>
          </div>

          {/* Nickname (read-only) */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Nickname</label>
            <input
              type="text"
              value={formData.nickname}
              disabled
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-500 cursor-not-allowed"
            />
            <p className="text-xs text-slate-400 mt-1">{t('navbar.nickname_locked')}</p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">{t('navbar.language_label')}</label>
            <LanguageSwitcher variant="full" />
          </div>

          {/* Accent-color picker removed: the app now uses a single fixed brand palette. */}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="flex-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-xl">
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              className="flex-1 rounded-xl"
              style={{ '--btn-tone': selectedTheme.accent } as CSSProperties}
            >
              {t('common.save')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
