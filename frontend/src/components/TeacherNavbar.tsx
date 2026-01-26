import { useState, useRef, useEffect } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { User, Settings, LogOut, ChevronDown, Users, MessageSquare, FileText } from 'lucide-react'
import { Button } from './ui/button'
import { teacherApi } from '@/lib/api'
import { TeacherChatWidget } from './TeacherChatWidget'

interface TeacherProfile {
  firstName: string
  lastName: string
  email: string
  institution: string
  avatarUrl?: string
}

export function TeacherNavbar() {
  const navigate = useNavigate()
  const location = useLocation()
  const [showDropdown, setShowDropdown] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const [profile, setProfile] = useState<TeacherProfile>({
    firstName: 'Docente',
    lastName: '',
    email: '',
    institution: ''
  })

  // Load profile from API
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const response = await teacherApi.getProfile()
        const data = response.data
        setProfile({
          firstName: data.first_name || 'Docente',
          lastName: data.last_name || '',
          email: data.email || '',
          institution: data.institution || '',
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
    const first = profile.firstName?.charAt(0) || 'D'
    const last = profile.lastName?.charAt(0) || ''
    return (first + last).toUpperCase()
  }

  // Generate random color based on name (consistent)
  const getAvatarColor = () => {
    // Modern SaaS avatars are often neutral or branded, but we keep colors for differentiation
    const name = profile.firstName + profile.lastName
    const colors = [
      'bg-indigo-500',
      'bg-blue-500',
      'bg-violet-500',
      'bg-fuchsia-500',
      'bg-rose-500',
      'bg-cyan-500'
    ]
    const hash = name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
    return colors[hash % colors.length]
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('user')
    navigate('/login')
  }

  const isActive = (path: string) => location.pathname === path

  const navItems = [
    { path: '/teacher', label: 'Supporto', icon: MessageSquare },
    { path: '/teacher/classes', label: 'Classi', icon: Users },
    { path: '/teacher/documents', label: 'Documenti', icon: FileText },
  ]

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 z-50 bg-orange-50/80 backdrop-blur-md border-b border-orange-200 shadow-md shadow-orange-100/50">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo/Brand */}
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => navigate('/teacher')}>
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-400 to-red-500 flex items-center justify-center shadow-lg shadow-orange-400/30">
                <span className="text-white font-bold text-sm">G</span>
              </div>
              <span className="font-bold text-slate-900 text-lg tracking-tight hidden sm:inline">Golinelli<span className="text-orange-600">AI</span></span>
            </div>

            {/* Desktop Navigation */}
            <div className="hidden md:flex items-center gap-1 bg-white/50 p-1 rounded-xl border border-orange-100 shadow-sm">
              {navItems.map((item) => (
                <Link key={item.path} to={item.path}>
                  <button
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 ${
                      isActive(item.path)
                        ? 'bg-orange-500 text-white shadow-md shadow-orange-200'
                        : 'text-slate-600 hover:bg-orange-200/50 hover:text-orange-700'
                    }`}
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </button>
                </Link>
              ))}
            </div>

            <div className="flex items-center gap-2">
              {/* Chat Trigger */}
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsChatOpen(true)}
                className={`rounded-full h-10 w-10 transition-colors ${
                  isChatOpen 
                    ? 'bg-orange-100 text-orange-600' 
                    : 'text-slate-500 hover:bg-orange-50 hover:text-orange-600'
                }`}
                title="Chat di classe"
              >
                <MessageSquare className="h-5 w-5" />
              </Button>

              {/* Avatar Dropdown */}
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowDropdown(!showDropdown)}
                  className="flex items-center gap-3 hover:bg-orange-600/10 rounded-full pl-1 pr-3 py-1 transition-colors border border-transparent hover:border-orange-700/20"
                >
                  {profile.avatarUrl ? (
                    <img
                      src={profile.avatarUrl}
                      alt="Avatar"
                      className="w-8 h-8 rounded-full object-cover ring-2 ring-orange-600"
                    />
                  ) : (
                    <div className={`w-8 h-8 rounded-full ${getAvatarColor()} flex items-center justify-center text-white text-xs font-bold ring-2 ring-orange-600`}>
                      {getInitials()}
                    </div>
                  )}
                  <div className="hidden md:block text-left">
                      <p className="text-xs font-medium text-slate-900 leading-none">{profile.firstName}</p>
                  </div>
                  <ChevronDown className={`h-3 w-3 text-slate-700 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
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
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-50 hover:text-orange-600 transition-colors"
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
                  className={`${
                    isActive(item.path)
                      ? 'bg-orange-100 text-orange-700 font-semibold'
                      : 'text-slate-500 hover:text-orange-600'
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
                institution: updated.institution,
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
      
      <TeacherChatWidget isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />
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

          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase mb-1.5">Istituto</label>
            <input
              type="text"
              value={formData.institution}
              onChange={(e) => setFormData({ ...formData, institution: e.target.value })}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all outline-none"
              placeholder="Nome della scuola"
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
