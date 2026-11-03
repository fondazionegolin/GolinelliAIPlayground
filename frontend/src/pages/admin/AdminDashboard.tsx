import { endSession } from '@/lib/session'
import { useState } from 'react'
import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom'
import { LogOut, LayoutDashboard, GraduationCap, BarChart3, Mail, School, KeyRound, X, Loader2, BookOpen, Database, Building2, Menu, PanelLeftClose, PanelLeftOpen, FileCheck2, KanbanSquare, Users, Bot, Activity, CreditCard } from '@/components/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { Button, IconButton } from '@/design'
import AdminOverviewPage from './AdminControlCenterPage'
import TeachersPage from './TeachersPage'
import ClassesPage from './ClassesPage'
import UsersPage from './UsersPage'
import TeacherRequestsPage from './TeacherRequestsPage'
import FeedbackBoardPage from './FeedbackBoardPage'
import AdminBackendPage from './AdminBackendPage'
import AdminModelsPage from './AdminModelsPage'
import AdminChatbotsPage from './AdminChatbotsPage'
import AdminSessionsPage from './AdminSessionsPage'
import SchoolsPage from './SchoolsPage'
import LicensesPage from './LicensesPage'
import StudentsPage from './StudentsPage'
import CreditsHubPage from './CreditsHubPage'
import { useSocket } from '@/hooks/useSocket'
import { usePlatformRealtimeSync } from '@/lib/realtimeEvents'
import './admin.css'
import { tl } from '@/i18n/tl'

type NavItem = { path: string; label: string; icon: React.FC<{ className?: string }>; exact: boolean }

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: tl("Generale"),
    items: [{ path: '/admin', label: tl("Panoramica"), icon: LayoutDashboard, exact: true }],
  },
  {
    label: tl("Utenti e scuole"),
    items: [
      { path: '/admin/schools', label: tl("Scuole"), icon: Building2, exact: false },
      { path: '/admin/teachers', label: tl("Docenti"), icon: GraduationCap, exact: false },
      { path: '/admin/classes', label: tl("Classi"), icon: School, exact: false },
      { path: '/admin/students', label: tl("Studenti"), icon: Users, exact: false },
      { path: '/admin/sessions', label: tl("Sessioni"), icon: Activity, exact: false },
      { path: '/admin/licenses', label: tl("Licenze"), icon: FileCheck2, exact: false },
    ],
  },
  {
    label: tl("Consumi"),
    items: [
      { path: '/admin/credits', label: tl("Crediti"), icon: CreditCard, exact: false },
      { path: '/admin/costs', label: tl("Costi"), icon: BarChart3, exact: false },
      { path: '/admin/models', label: tl("Modelli"), icon: Bot, exact: false },
      { path: '/admin/chatbots', label: 'Chatbot', icon: Bot, exact: false },
    ],
  },
  {
    label: tl("Sistema"),
    items: [
      { path: '/admin/email', label: tl("Email"), icon: Mail, exact: false },
      { path: '/admin/feedback-board', label: 'Board Feedback', icon: KanbanSquare, exact: false },
      { path: '/admin/backend', label: 'Backend', icon: Database, exact: false },
    ],
  },
]

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')

  const mutation = useMutation({
    mutationFn: () => adminApi.changePassword(current, next),
    onSuccess: () => {
      toast({ title: tl("Password aggiornata") })
      onClose()
    },
    onError: (e: any) => {
      toast({ title: tl("Errore"), description: e?.response?.data?.detail || tl("Impossibile cambiare la password"), variant: 'destructive' })
    },
  })

  const canSubmit = current && next && next === confirm && next.length >= 8

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/40" onClick={onClose} />
      <div className="relative w-full max-w-sm overflow-hidden rounded-[0.625rem] border border-[#e2e5ea] bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-[#e2e5ea] bg-[#f8f9fb] px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-900">{tl("Cambia password admin")}</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 transition-colors hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-5">
          {[
            { label: tl("Password attuale"), value: current, set: setCurrent, placeholder: '••••••••' },
            { label: tl("Nuova password"), value: next, set: setNext, placeholder: tl("min. 8 caratteri") },
            { label: tl("Conferma nuova password"), value: confirm, set: setConfirm, placeholder: '••••••••' },
          ].map(({ label, value, set, placeholder }) => (
            <div key={label}>
              <label className="mb-1 block text-xs font-medium text-slate-700">{label}</label>
              <input
                type="password"
                value={value}
                onChange={e => set(e.target.value)}
                placeholder={placeholder}
                className="w-full rounded-md border border-[#cfd4dc] px-3 py-2 text-sm focus:border-[var(--logo-violet-strong)] focus:outline-none focus:ring-2 focus:ring-[rgba(123,105,201,0.18)]"
              />
            </div>
          ))}
          {next && confirm && next !== confirm && (
            <p className="text-xs text-red-700">{tl("Le password non corrispondono")}</p>
          )}
          <Button
            tone="accent"
            surface="solid"
            fullWidth
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {tl("Aggiorna password")}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function AdminDashboard() {
  const queryClient = useQueryClient()
  useSocket('')
  usePlatformRealtimeSync(queryClient)
  const logout = () => { void endSession() }
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
    <div className="admin-root h-screen">
      <div className="flex h-screen">
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
            <div className="absolute inset-0 bg-slate-950/35" onClick={() => setMobileSidebarOpen(false)} />
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

        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--admin-line)] bg-white px-4 lg:hidden">
            <IconButton
              tone="neutral"
              surface="outline"
              size="default"
              onClick={() => setMobileSidebarOpen(true)}
              title={tl("Apri menu admin")}
            >
              <Menu className="h-4 w-4" />
            </IconButton>
            <img src="/logo_new.png" alt="Golinelli.ai" className="h-7 w-auto" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-950">{tl("Pannello admin")}</p>
              <p className="text-[11px] text-[var(--admin-ink-3)]">Golinelli.ai</p>
            </div>
          </header>

          <main className="w-full flex-1 px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
            <div className="admin-shell mx-auto w-full max-w-[1440px] space-y-0">
              <Routes>
                <Route index element={<AdminOverviewPage />} />
                <Route path="schools" element={<SchoolsPage />} />
                <Route path="teachers" element={<TeachersPage />} />
                <Route path="licenses" element={<LicensesPage />} />
                <Route path="classes" element={<ClassesPage />} />
                <Route path="students" element={<StudentsPage />} />
                <Route path="credits" element={<CreditsHubPage />} />
                <Route path="costs" element={<UsersPage />} />
                <Route path="email" element={<TeacherRequestsPage />} />
                <Route path="feedback" element={<Navigate to="/admin/feedback-board" replace />} />
                <Route path="feedback-board" element={<FeedbackBoardPage />} />
                <Route path="sessions" element={<AdminSessionsPage />} />
                <Route path="models" element={<AdminModelsPage />} />
                <Route path="chatbots" element={<AdminChatbotsPage />} />
                <Route path="backend" element={<AdminBackendPage />} />
                {/* Legacy redirects */}
                <Route path="teacher-requests" element={<Navigate to="/admin/teachers" replace />} />
                <Route path="users" element={<Navigate to="/admin/teachers" replace />} />
                <Route path="tenants" element={<Navigate to="/admin/schools" replace />} />
                <Route path="overview" element={<Navigate to="/admin" replace />} />
                <Route path="usage" element={<Navigate to="/admin/costs" replace />} />
              </Routes>
            </div>
          </main>
        </div>
      </div>

      {showChangePwd && <ChangePasswordModal onClose={() => setShowChangePwd(false)} />}
    </div>
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
  const widthClass = expanded ? 'w-60' : 'w-[4.25rem]'
  const { data: notifications } = useQuery({
    queryKey: ['admin-notifications'],
    queryFn: async () => (await adminApi.getNotifications()).data as { items: Record<string, { count: number; urgent: boolean }> },
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  })

  const renderItem = (item: NavItem) => {
    const isActive = item.exact ? locationPath === item.path : locationPath.startsWith(item.path)
    const count = notifications?.items[item.path]?.count ?? 0
    return (
      <button
        key={item.path}
        type="button"
        onClick={() => onNavigate(item.path)}
        aria-current={isActive ? 'page' : undefined}
        className={`admin-nav-item relative flex h-9 w-full items-center gap-2.5 px-2.5 text-[13px] font-medium transition-colors ${expanded ? 'justify-start' : 'justify-center'}`}
        title={item.label}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {expanded && <span className="truncate">{item.label}</span>}
        {count > 0 && (
          <span
            className={`flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[var(--logo-pink)] px-1 text-[10px] font-semibold text-white ${expanded ? 'ml-auto' : 'absolute right-0.5 top-0.5 h-4 min-w-4 text-[9px]'}`}
            title={tl("Richiede attenzione")}
          >
            {count}
          </span>
        )}
      </button>
    )
  }

  return (
    <aside
      className={`admin-sidebar ${mobile ? 'flex' : 'sticky top-0 hidden lg:flex'} ${widthClass} h-screen shrink-0 flex-col transition-[width] duration-200`}
    >
      <div className="flex h-14 items-center gap-2 border-b border-[var(--admin-line)] px-3">
        <button
          type="button"
          onClick={() => onNavigate('/admin')}
          className={`flex min-w-0 flex-1 items-center gap-2.5 text-left ${expanded ? '' : 'justify-center'}`}
          title={tl("Pannello admin")}
        >
          <img src="/logo_new.png" alt="Golinelli.ai" className="h-7 w-7 shrink-0 object-contain" />
          {expanded && (
            <div className="min-w-0 leading-tight">
              <span className="block truncate text-sm font-semibold text-[var(--admin-ink)]">
                Golinelli<span className="text-[var(--logo-pink)]">.ai</span>
              </span>
              <span className="block truncate text-[11px] text-[var(--admin-ink-3)]">{tl("Amministrazione")}</span>
            </div>
          )}
        </button>
        {expanded && (
          <IconButton
            tone="neutral"
            surface="ghost"
            size="sm"
            onClick={onToggleExpanded}
            title={mobile ? tl("Chiudi menu") : tl("Mostra solo icone")}
          >
            {mobile ? <X className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </IconButton>
        )}
      </div>

      {!expanded && !mobile && (
        <div className="flex justify-center border-b border-[var(--admin-line)] py-2">
          <IconButton tone="neutral" surface="ghost" size="sm" onClick={onToggleExpanded} title={tl("Mostra titoli")}>
            <PanelLeftOpen className="h-4 w-4" />
          </IconButton>
        </div>
      )}

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {navGroups.map((group, index) => (
          <div key={group.label} className={!expanded && index > 0 ? 'mt-2 border-t border-[var(--admin-line)] pt-2' : ''}>
            {expanded ? <p className="admin-sidebar-section">{group.label}</p> : index === 0 && <div className="h-3" />}
            <div className="space-y-0.5">{group.items.map(renderItem)}</div>
          </div>
        ))}
      </nav>

      <div className="space-y-0.5 border-t border-[var(--admin-line)] p-3">
        <SidebarAction expanded={expanded} icon={BookOpen} label={tl("Pannello docente")} onClick={() => onNavigate('/teacher')} />
        <SidebarAction expanded={expanded} icon={KeyRound} label={tl("Cambia password")} onClick={onShowChangePassword} />
        <SidebarAction expanded={expanded} icon={LogOut} label={tl("Esci")} onClick={onLogout} danger />
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
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={`admin-nav-item flex h-9 w-full items-center gap-2.5 px-2.5 text-[13px] font-medium transition-colors ${expanded ? 'justify-start' : 'justify-center'} ${danger ? '!text-[var(--logo-pink)]' : ''}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {expanded && <span className="truncate">{label}</span>}
    </button>
  )
}
