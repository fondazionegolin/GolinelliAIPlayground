import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, Settings, LogOut, ChevronDown, Bot, Brain, Award, Home, MessageSquare, X } from 'lucide-react'
import { Button } from './ui/button'
import { studentApi } from '@/lib/api'
import ChatSidebar, { ChatMessage } from '@/components/ChatSidebar'

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
  onNotificationClick?: (notification: ChatMessage) => void
}

export function StudentNavbar({ activeModule, onNavigate, sessionTitle, joinCode, sessionId, onNotificationClick }: StudentNavbarProps) {
  const navigate = useNavigate()
  const [showDropdown, setShowDropdown] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

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
      'bg-indigo-500',
      'bg-blue-500',
      'bg-violet-500',
      'bg-fuchsia-500',
      'bg-rose-500',
      'bg-cyan-500'
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
    { key: 'self_assessment', label: 'Compiti', icon: Award },
  ]

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#E0F2FE] border-b border-sky-200 shadow-md shadow-sky-100/50">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14">
            {/* Logo/Brand & Session Info */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 cursor-pointer" onClick={() => onNavigate?.(null)}>
                <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-sky-400 to-blue-500 flex items-center justify-center shadow-lg shadow-sky-400/30">
                  <span className="text-white font-bold text-xs">G</span>
                </div>
                <span className="font-bold text-slate-900 text-sm tracking-tight hidden sm:inline">Golinelli<span className="text-sky-600">AI</span></span>
              </div>
              
              {sessionTitle && (
                <div className="hidden sm:flex flex-col border-l border-sky-200 pl-4 h-8 justify-center">
                  <span className="text-xs font-bold text-slate-700 leading-none">{sessionTitle}</span>
                  <span className="text-[10px] font-bold text-sky-600 leading-none mt-0.5">Codice: {joinCode}</span>
                </div>
              )}
            </div>

            {/* Desktop Navigation */}
            {onNavigate && (
              <div className="hidden md:flex items-center gap-1 bg-white/50 p-1 rounded-lg border border-sky-100 shadow-sm">
                {navItems.map((item) => (
                  <button
                    key={item.label}
                    onClick={() => onNavigate(item.key)}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-all duration-200 ${
                      activeModule === item.key
                        ? 'bg-sky-500 text-white shadow-md shadow-sky-200'
                        : 'text-slate-600 hover:bg-sky-200/50 hover:text-sky-700'
                    }`}
                  >
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                  </button>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              {/* Chat Trigger */}
              {sessionId && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsChatOpen(true)}
                  className={`rounded-full h-9 w-9 transition-colors ${
                    isChatOpen 
                      ? 'bg-sky-100 text-sky-600' 
                      : 'text-slate-500 hover:bg-sky-50 hover:text-sky-600'
                  }`}
                  title="Chat di classe"
                >
                  <MessageSquare className="h-5 w-5" />
                </Button>
              )}

              {/* Avatar Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="flex items-center gap-2 hover:bg-sky-600/10 rounded-full pl-1 pr-2 py-1 transition-colors border border-transparent hover:border-sky-700/20"
                >
                  {profile.avatarUrl ? (
                    <img
                      src={profile.avatarUrl}
                      alt="Avatar"
                      className="w-7 h-7 rounded-full object-cover ring-2 ring-sky-600"
                    />
                  ) : (
                    <div className={`w-7 h-7 rounded-full ${getAvatarColor()} flex items-center justify-center text-white text-[10px] font-bold ring-2 ring-sky-600`}>
                      {getInitials()}
                    </div>
                  )}
                  <div className="hidden md:block text-left">
                    <p className="text-xs font-bold text-slate-900 leading-none">{profile.nickname}</p>
                  </div>
                  <ChevronDown className={`h-3 w-3 text-slate-700 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
                </button>

                {/* Dropdown Menu */}
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
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-indigo-600 transition-colors"
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

      {/* Chat Overlay */}
      {isChatOpen && sessionId && profile.id && (
        <div className="fixed inset-0 z-[60] flex justify-end">
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => setIsChatOpen(false)} />
          <div className="relative w-full max-w-md h-full bg-white shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col border-l border-slate-200">
            <div className="p-4 border-b border-sky-100 bg-sky-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="bg-sky-100 p-2 rounded-lg">
                  <MessageSquare className="h-5 w-5 text-sky-600" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-800">Chat di Classe</h3>
                  <p className="text-xs text-sky-600 font-medium">Sessione: {sessionTitle || joinCode}</p>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-red-50 hover:text-red-500" onClick={() => setIsChatOpen(false)}>
                <X className="h-5 w-5" />
              </Button>
            </div>
            <div className="flex-1 overflow-hidden relative">
              <ChatSidebar
                sessionId={sessionId}
                userType="student"
                currentUserId={profile.id}
                currentUserName={profile.nickname}
                isMobileView={true}
                onNotificationClick={onNotificationClick}
              />
            </div>
          </div>
        </div>
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
            <p className="text-xs text-slate-500 text-center">
              JPG, PNG o GIF (max 5MB)
            </p>
          </div>

          {/* Nickname (read-only) */}
          <div>
            <label className="block text-sm font-semibold text-slate-900 mb-2">
              Nickname
            </label>
            <input
              type="text"
              value={formData.nickname}
              disabled
              className="w-full px-4 py-2.5 border border-slate-200 rounded-lg bg-slate-50 text-slate-500 cursor-not-allowed"
            />
            <p className="text-xs text-slate-500 mt-1">
              Il nickname non può essere modificato
            </p>
          </div>

          {/* Buttons */}
          <div className="flex gap-3 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1"
            >
              Annulla
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 text-white shadow-lg shadow-indigo-500/20"
            >
              Salva
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}