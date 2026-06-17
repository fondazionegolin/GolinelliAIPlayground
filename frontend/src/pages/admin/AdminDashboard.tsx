import { useState } from 'react'
import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuthStore } from '@/stores/auth'
import { AppBackground } from '@/components/ui/AppBackground'
import { LogOut, LayoutDashboard, GraduationCap, BarChart3, Mail, School, Bug, KeyRound, X, Loader2, BookOpen, Database, Building2, Menu, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { Button, IconButton } from '@/design'
import AdminOverviewPage from './AdminControlCenterPage'
import TeachersPage from './TeachersPage'
import ClassesPage from './ClassesPage'
import UsersPage from './UsersPage'
import TeacherRequestsPage from './TeacherRequestsPage'
import FeedbackPage from './FeedbackPage'
import AdminBackendPage from './AdminBackendPage'
import SchoolsPage from './SchoolsPage'

const navItems = [
  { path: '/admin', label: 'Panoramica', icon: LayoutDashboard, exact: true },
  { path: '/admin/schools', label: 'Scuole', icon: Building2, exact: false },
  { path: '/admin/teachers', label: 'Docenti', icon: GraduationCap, exact: false },
  { path: '/admin/classes', label: 'Classi', icon: School, exact: false },
  { path: '/admin/costs', label: 'Costi', icon: BarChart3, exact: false },
  { path: '/admin/email', label: 'Email', icon: Mail, exact: false },
  { path: '/admin/feedback', label: 'Feedback', icon: Bug, exact: false },
  { path: '/admin/backend', label: 'Backend', icon: Database, exact: false },
]

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  const mutation = useMutation({
    mutationFn: () => adminApi.changePassword(current, next),
    onSuccess: () => {
      toast({ title: 'Password aggiornata' })
      onClose()
    },
    onError: (e: any) => {
      toast({ title: 'Errore', description: e?.response?.data?.detail || 'Impossibile cambiare la password', variant: 'destructive' })
    },
  })

  const canSubmit = current && next && next === confirm && next.length >= 8

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-slate-100">
              <KeyRound className="h-4 w-4 text-slate-600" />
            </div>
            <h2 className="text-sm font-bold text-slate-900">Cambia password admin</h2>
          </div>
          <button onClick={onClose} className="text-slate-300 hover:text-slate-600 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {[
            { label: 'Password attuale', value: current, set: setCurrent, placeholder: '••••••••' },
            { label: 'Nuova password', value: next, set: setNext, placeholder: 'min. 8 caratteri' },
            { label: 'Conferma nuova password', value: confirm, set: setConfirm, placeholder: '••••••••' },
          ].map(({ label, value, set, placeholder }) => (
            <div key={label}>
              <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
              <input
                type="password"
                value={value}
                onChange={e => set(e.target.value)}
                placeholder={placeholder}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200 focus:border-slate-300"
              />
            </div>
          ))}
          {next && confirm && next !== confirm && (
            <p className="text-xs text-red-500">Le password non corrispondono</p>
          )}
          <button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900"
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Aggiorna password
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminDashboard() {
  const { logout } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()
  const [showChangePwd, setShowChangePwd] = useState(false)
  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.localStorage.getItem('admin-sidebar-expanded') !== 'false'
  })
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  const setExpanded = (value: boolean) => {
    setSidebarExpanded(value)
    window.localStorage.setItem('admin-sidebar-expanded', String(value))
  }

  const goTo = (path: string) => {
    navigate(path)
    setMobileSidebarOpen(false)
  }

  return (
    <AppBackground className="min-h-screen" gradient="#f8fafc">
      <div className="flex min-h-screen">
        <AdminSidebar
          expanded={sidebarExpanded}
          locationPath={location.pathname}
          onNavigate={goTo}
          onToggleExpanded={() => setExpanded(!sidebarExpanded)}
          onShowChangePassword={() => setShowChangePwd(true)}
          onLogout={logout}
        />

        {mobileSidebarOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-slate-950/35 backdrop-blur-sm" onClick={() => setMobileSidebarOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-[18rem] max-w-[calc(100vw-2rem)]">
              <AdminSidebar
                expanded
                mobile
                locationPath={location.pathname}
                onNavigate={goTo}
                onToggleExpanded={() => setMobileSidebarOpen(false)}
                onShowChangePassword={() => setShowChangePwd(true)}
                onLogout={logout}
              />
            </div>
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200/80 bg-white/85 px-4 backdrop-blur-xl lg:hidden">
            <IconButton
              tone="neutral"
              surface="outline"
              size="default"
              onClick={() => setMobileSidebarOpen(true)}
              title="Apri menu admin"
            >
              <Menu className="h-4 w-4" />
            </IconButton>
            <img src="/logo_new.png" alt="Golinelli.ai" className="h-7 w-auto" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-950">Pannello admin</p>
              <p className="text-[11px] text-slate-500">Golinelli.ai</p>
            </div>
          </header>

          <main className="w-full flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
            <div className="mx-auto w-full max-w-[1500px]">
              <Routes>
                <Route index element={<AdminOverviewPage />} />
                <Route path="schools" element={<SchoolsPage />} />
                <Route path="teachers" element={<TeachersPage />} />
                <Route path="classes" element={<ClassesPage />} />
                <Route path="costs" element={<UsersPage />} />
                <Route path="email" element={<TeacherRequestsPage />} />
                <Route path="feedback" element={<FeedbackPage />} />
                <Route path="backend" element={<AdminBackendPage />} />
                {/* Legacy redirects */}
                <Route path="teacher-requests" element={<Navigate to="/admin/teachers" replace />} />
                <Route path="users" element={<Navigate to="/admin/teachers" replace />} />
                <Route path="tenants" element={<Navigate to="/admin/schools" replace />} />
                <Route path="overview" element={<Navigate to="/admin" replace />} />
                <Route path="usage" element={<Navigate to="/admin/costs" replace />} />
                <Route path="credits" element={<Navigate to="/admin/costs" replace />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>

      {showChangePwd && <ChangePasswordModal onClose={() => setShowChangePwd(false)} />}
    </AppBackground>
  )
}

function AdminSidebar({
  expanded,
  mobile = false,
  locationPath,
  onNavigate,
  onToggleExpanded,
  onShowChangePassword,
  onLogout,
}: {
  expanded: boolean
  mobile?: boolean
  locationPath: string
  onNavigate: (path: string) => void
  onToggleExpanded: () => void
  onShowChangePassword: () => void
  onLogout: () => void
}) {
  const widthClass = expanded ? 'w-72' : 'w-[5.25rem]'

  return (
    <aside
      className={`${mobile ? 'flex' : 'sticky top-0 hidden lg:flex'} ${widthClass} h-screen shrink-0 flex-col border-r border-slate-200/80 bg-white/90 shadow-[var(--shadow-sm)] backdrop-blur-xl transition-[width] duration-200`}
    >
      <div className="flex h-16 items-center gap-3 border-b border-slate-100 px-4">
        <button
          type="button"
          onClick={() => onNavigate('/admin')}
          className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left ${expanded ? '' : 'justify-center'}`}
          title="Pannello admin"
        >
          <img src="/logo_new.png" alt="Golinelli.ai" className={`${expanded ? 'h-8 w-auto' : 'h-8 w-8 object-contain'} shrink-0`} />
          {expanded && (
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-bold text-slate-950">
                  Golinelli<span className="text-[var(--logo-pink)]">.ai</span>
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[9px] font-bold text-slate-500">ADMIN</span>
              </div>
              <p className="truncate text-[11px] text-slate-500">Centro di controllo</p>
            </div>
          )}
        </button>
        <IconButton
          tone="neutral"
          surface="ghost"
          size="sm"
          onClick={onToggleExpanded}
          title={mobile ? 'Chiudi menu' : expanded ? 'Mostra solo icone' : 'Mostra titoli'}
          className={expanded ? '' : 'hidden'}
        >
          {mobile ? <X className="h-4 w-4" /> : expanded ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
        </IconButton>
      </div>

      {!expanded && !mobile && (
        <div className="flex justify-center border-b border-slate-100 px-3 py-3">
          <IconButton
            tone="neutral"
            surface="outline"
            size="default"
            onClick={onToggleExpanded}
            title="Mostra titoli"
          >
            <PanelLeftOpen className="h-4 w-4" />
          </IconButton>
        </div>
      )}

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => {
          const isActive = item.exact
            ? locationPath === item.path
            : locationPath.startsWith(item.path)
          return (
            <button
              key={item.path}
              onClick={() => onNavigate(item.path)}
              className={`group relative flex h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium transition-all ${
                isActive
                  ? 'text-[var(--app-accent-text,var(--logo-pink))]'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'
              } ${expanded ? 'justify-start' : 'justify-center'}`}
              title={item.label}
            >
              {isActive && (
                <motion.span
                  layoutId={mobile ? 'admin-mobile-nav-indicator' : 'admin-sidebar-nav-indicator'}
                  className="absolute inset-0 rounded-xl border border-[rgba(254,0,77,0.18)] bg-[rgba(254,0,77,0.075)] shadow-[var(--shadow-sm)]"
                  transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                />
              )}
              <item.icon className="relative h-4 w-4 shrink-0" />
              {expanded && <span className="relative truncate">{item.label}</span>}
            </button>
          )
        })}
      </nav>

      <div className="border-t border-slate-100 p-3">
        <div className="space-y-1">
          <SidebarAction
            expanded={expanded}
            icon={BookOpen}
            label="Pannello docente"
            onClick={() => onNavigate('/teacher')}
          />
          <SidebarAction
            expanded={expanded}
            icon={KeyRound}
            label="Cambia password"
            onClick={onShowChangePassword}
          />
          <SidebarAction
            expanded={expanded}
            icon={LogOut}
            label="Esci"
            onClick={onLogout}
            danger
          />
        </div>
      </div>
    </aside>
  )
}

function SidebarAction({
  expanded,
  icon: Icon,
  label,
  onClick,
  danger = false,
}: {
  expanded: boolean
  icon: React.FC<{ className?: string }>
  label: string
  onClick: () => void
  danger?: boolean
}) {
  return (
    <Button
      tone={danger ? 'danger' : 'neutral'}
      surface="ghost"
      density="compact"
      onClick={onClick}
      title={label}
      className={`h-10 w-full rounded-xl px-3 ${expanded ? 'justify-start' : 'justify-center'} ${danger ? '' : 'text-slate-500'}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {expanded && <span className="truncate text-sm">{label}</span>}
    </Button>
  )
}
