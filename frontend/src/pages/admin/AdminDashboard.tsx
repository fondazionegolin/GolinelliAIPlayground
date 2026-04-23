import { useState } from 'react'
import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuthStore } from '@/stores/auth'
import { AppBackground } from '@/components/ui/AppBackground'
import { LogOut, LayoutDashboard, GraduationCap, BarChart3, Mail, School, Bug, KeyRound, X, Loader2, BookOpen, Database } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import AdminOverviewPage from './AdminControlCenterPage'
import TeachersPage from './TeachersPage'
import ClassesPage from './ClassesPage'
import UsersPage from './UsersPage'
import TeacherRequestsPage from './TeacherRequestsPage'
import FeedbackPage from './FeedbackPage'
import AdminBackendPage from './AdminBackendPage'

const navItems = [
  { path: '/admin', label: 'Panoramica', icon: LayoutDashboard, exact: true },
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

  return (
    <AppBackground className="min-h-screen flex flex-col" gradient="#f8fafc">
      {/* Top Navbar */}
      <nav className="bg-[#1a1a2e] border-b border-white/10 sticky top-0 z-50 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center h-14 gap-4">
          {/* Logo */}
          <div
            className="flex items-center gap-2.5 cursor-pointer flex-shrink-0"
            onClick={() => navigate('/admin')}
          >
            <img src="/logo_new.png" alt="Golinelli.ai" className="h-7 w-auto" />
            <span className="text-white font-bold text-base hidden sm:inline">
              Golinelli<span className="text-slate-400">.ai</span>
            </span>
            <span className="text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-slate-600">
              ADMIN
            </span>
          </div>

          {/* Separator */}
          <div className="w-px h-6 bg-white/20 hidden sm:block" />

          {/* Nav items */}
          <div className="flex items-center gap-0.5">
            {navItems.map((item) => {
              const isActive = item.exact
                ? location.pathname === item.path
                : location.pathname.startsWith(item.path)
              return (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`relative flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors rounded-lg ${
                    isActive ? 'text-white' : 'text-white/55 hover:text-white/85'
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  <span className="hidden md:inline">{item.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="admin-nav-indicator"
                      className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-white/60"
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                </button>
              )
            })}
          </div>

          <div className="flex-1" />

          {/* Switch to teacher panel */}
          <button
            onClick={() => navigate('/teacher')}
            className="flex items-center gap-1.5 text-white/55 hover:text-white text-sm transition-colors"
            title="Vai al pannello docente"
          >
            <BookOpen className="h-4 w-4" />
            <span className="hidden sm:inline text-xs">Docente</span>
          </button>

          {/* Change password */}
          <button
            onClick={() => setShowChangePwd(true)}
            className="flex items-center gap-1.5 text-white/55 hover:text-white text-sm transition-colors"
            title="Cambia password"
          >
            <KeyRound className="h-4 w-4" />
          </button>

          {/* Logout */}
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-white/55 hover:text-white text-sm transition-colors"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Esci</span>
          </button>
        </div>
      </nav>

      {/* Page content */}
      <main className="flex-1 max-w-7xl mx-auto w-full px-4 sm:px-6 py-6">
        <Routes>
          <Route index element={<AdminOverviewPage />} />
          <Route path="teachers" element={<TeachersPage />} />
          <Route path="classes" element={<ClassesPage />} />
          <Route path="costs" element={<UsersPage />} />
          <Route path="email" element={<TeacherRequestsPage />} />
          <Route path="feedback" element={<FeedbackPage />} />
          <Route path="backend" element={<AdminBackendPage />} />
          {/* Legacy redirects */}
          <Route path="teacher-requests" element={<Navigate to="/admin/teachers" replace />} />
          <Route path="users" element={<Navigate to="/admin/teachers" replace />} />
          <Route path="tenants" element={<Navigate to="/admin" replace />} />
          <Route path="overview" element={<Navigate to="/admin" replace />} />
          <Route path="usage" element={<Navigate to="/admin/costs" replace />} />
          <Route path="credits" element={<Navigate to="/admin/costs" replace />} />
        </Routes>
      </main>

      {showChangePwd && <ChangePasswordModal onClose={() => setShowChangePwd(false)} />}
    </AppBackground>
  )
}
