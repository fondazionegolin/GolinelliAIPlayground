import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, Settings, LogOut, ChevronDown, Bot, Brain, Award, Home, FileEdit, Menu, X, MessageSquare } from 'lucide-react'
import { Button } from './ui/button'
import { studentApi } from '@/lib/api'

interface StudentProfile {
  id?: string
  nickname: string
  avatarUrl?: string
}

interface StudentNavbarProps {
  activeModule?: string | null
  onNavigate?: (module: string | null) => void
  sessionTitle?: string
  joinCode?: string
  sessionId?: string
  showChatToggle?: boolean
  onShowChatSidebar?: () => void
}

export function StudentNavbar({
  activeModule,
  onNavigate,
  sessionTitle,
  joinCode,
  showChatToggle = false,
  onShowChatSidebar
}: StudentNavbarProps) {
  const navigate = useNavigate()
  const [showDropdown, setShowDropdown] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const mobileMenuRef = useRef<HTMLDivElement>(null)

  const [profile, setProfile] = useState<StudentProfile>({
    nickname: 'Studente'
  })

  // Load profile from API
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const response = await studentApi.getProfile()
        const data = response.data
        setProfile({
          id: data.id,
          nickname: data.nickname || 'Studente',
          avatarUrl: data.avatar_url || undefined
        })
      } catch (err) {
        console.error('Failed to load profile:', err)
      }
    }
    loadProfile()
  }, [])

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
      'bg-violet-500',
      'bg-fuchsia-500',
      'bg-purple-500',
      'bg-pink-500',
      'bg-rose-500',
      'bg-indigo-500'
    ]
    const hash = profile.nickname.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return colors[hash % colors.length]
  }

  const handleLogout = () => {
    localStorage.removeItem('student_token')
    localStorage.removeItem('student_nickname')
    navigate('/student/join')
  }

  const navItems = [
    { key: null, label: 'Home', icon: Home },
    { key: 'chatbot', label: 'Chatbot', icon: Bot },
    { key: 'classification', label: 'ML Lab', icon: Brain },
    { key: 'documents', label: 'Documenti', icon: FileEdit },
    { key: 'self_assessment', label: 'Compiti', icon: Award },
  ]

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-fuchsia-50/80 backdrop-blur-md border-b border-fuchsia-200 shadow-md shadow-fuchsia-100/50">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo/Brand */}
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => onNavigate?.(null)}>
              <span className="font-semibold text-lg tracking-tight hidden sm:inline">
                <span className="text-slate-700/70">GOLINELLI</span>
                <span className="text-fuchsia-600">AI</span>
                <span className="text-slate-700/70">playground</span>
              </span>
            </div>

            {/* Mobile Menu Button - Hidden since MobileNav handles navigation */}
            {onNavigate && (
              <div className="hidden">
                <button
                  onClick={() => setShowMobileMenu(!showMobileMenu)}
                  className="p-2 rounded-lg hover:bg-fuchsia-100 transition-colors"
                >
                  {showMobileMenu ? <X className="h-5 w-5 text-fuchsia-600" /> : <Menu className="h-5 w-5 text-fuchsia-600" />}
                </button>
              </div>
            )}

            {/* Desktop Navigation */}
            {onNavigate && (
              <div className="hidden md:flex items-center gap-1 bg-white/50 p-1 rounded-xl border border-fuchsia-100 shadow-sm">
                {navItems.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => onNavigate(item.key)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${activeModule === item.key
                        ? 'bg-fuchsia-500 text-white shadow-md shadow-fuchsia-200'
                        : 'text-slate-600 hover:bg-fuchsia-200/50 hover:text-fuchsia-700'
                      }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              {/* Session Info - Always visible */}
              {sessionTitle && (
                <div className="hidden lg:flex items-center gap-3 px-4 py-2.5 rounded-xl border-2 bg-gradient-to-r from-fuchsia-50 to-purple-50 border-fuchsia-200">
                  <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse shadow-sm shadow-green-300" />
                  <div className="text-left min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-fuchsia-700 truncate max-w-[140px]">{sessionTitle}</span>
                      <span className="text-slate-300">|</span>
                      <span className="text-xs font-semibold text-slate-500 bg-white/60 px-2 py-0.5 rounded">{joinCode}</span>
                    </div>
                  </div>
                  {showChatToggle && (
                    <button
                      className="ml-2 h-8 w-8 rounded-full border border-fuchsia-200 bg-white text-fuchsia-600 hover:bg-fuchsia-100 transition"
                      onClick={onShowChatSidebar}
                      title="Apri chat di classe"
                    >
                      <MessageSquare className="h-4 w-4 mx-auto" />
                    </button>
                  )}
                </div>
              )}

              {/* Avatar Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="flex items-center gap-3 hover:bg-fuchsia-600/10 rounded-full pl-1 pr-3 py-1 transition-colors border border-transparent hover:border-fuchsia-700/20"
                >
                  {profile.avatarUrl ? (
                    <img
                      src={profile.avatarUrl}
                      alt="Avatar"
                      className="w-8 h-8 rounded-full object-cover ring-2 ring-fuchsia-600"
                    />
                  ) : (
                    <div className={`w-8 h-8 rounded-full ${getAvatarColor()} flex items-center justify-center text-white text-xs font-bold ring-2 ring-fuchsia-600`}>
                      {getInitials()}
                    </div>
                  )}
                  <div className="hidden md:block text-left">
                    <p className="text-xs font-medium text-slate-900 leading-none">{profile.nickname}</p>
                  </div>
                  <ChevronDown className={`h-3 w-3 text-slate-700 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu - Modern Floating Style */}
                {showDropdown && (
                  <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-100 py-2 animate-in fade-in zoom-in-95 duration-100 origin-top-right">
                    <div className="px-4 py-3 border-b border-slate-50 mb-1">
                      <p className="text-sm font-semibold text-slate-900">{profile.nickname}</p>
                      <p className="text-xs text-slate-500 mt-0.5">Studente</p>
                    </div>
                    <button
                      onClick={() => {
                        setShowSettings(true)
                        setShowDropdown(false)
                      }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-fuchsia-600 transition-colors"
                    >
                      <Settings className="h-4 w-4" />
                      Impostazioni
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

          {/* Mobile Menu Dropdown */}
          {showMobileMenu && (
            <div ref={mobileMenuRef} className="md:hidden absolute top-full left-0 right-0 bg-white border-b border-fuchsia-200 shadow-lg animate-in slide-in-from-top-2 duration-200">
              <div className="px-4 py-3 space-y-1">
                {navItems.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => {
                      onNavigate?.(item.key)
                      setShowMobileMenu(false)
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeModule === item.key
                        ? 'bg-fuchsia-100 text-fuchsia-700'
                        : 'text-slate-600 hover:bg-fuchsia-50 hover:text-fuchsia-700'
                      }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </nav>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          profile={profile}
          onSave={async (updated) => {
            try {
              await studentApi.updateProfile({
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

// Settings Modal Component
interface SettingsModalProps {
  profile: StudentProfile
  onSave: (profile: StudentProfile) => Promise<void> | void
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
              className="text-xs"
            >
              Cambia Avatar
            </Button>
          </div>

          {/* Nickname (read-only) */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Nickname</label>
            <input
              type="text"
              value={formData.nickname}
              disabled
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-500 cursor-not-allowed"
            />
            <p className="text-xs text-slate-400 mt-1">Il nickname non può essere modificato</p>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} className="flex-1 text-slate-500 hover:text-slate-700 hover:bg-slate-100">
              Annulla
            </Button>
            <Button type="submit" className="flex-1 bg-fuchsia-600 hover:bg-fuchsia-700 text-white shadow-lg shadow-fuchsia-500/30">
              Salva Modifiche
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
