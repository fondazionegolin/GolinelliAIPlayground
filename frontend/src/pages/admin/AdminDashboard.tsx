import { Routes, Route, useLocation, useNavigate, Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuthStore } from '@/stores/auth'
import { AppBackground } from '@/components/ui/AppBackground'
import { LogOut, LayoutDashboard, GraduationCap, BarChart3, Mail, School } from 'lucide-react'
import AdminOverviewPage from './AdminControlCenterPage'
import TeachersPage from './TeachersPage'
import ClassesPage from './ClassesPage'
import UsersPage from './UsersPage'
import TeacherRequestsPage from './TeacherRequestsPage'
const navItems = [
  { path: '/admin', label: 'Panoramica', icon: LayoutDashboard, exact: true },
  { path: '/admin/teachers', label: 'Docenti', icon: GraduationCap, exact: false },
  { path: '/admin/classes', label: 'Classi', icon: School, exact: false },
  { path: '/admin/costs', label: 'Costi', icon: BarChart3, exact: false },
  { path: '/admin/email', label: 'Email', icon: Mail, exact: false },
]

export default function AdminDashboard() {
  const { logout } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <AppBackground className="min-h-screen flex flex-col">
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
              Golinelli<span style={{ color: '#e85c8d' }}>.ai</span>
            </span>
            <span
              className="text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: '#e85c8d' }}
            >
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
                      className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                      style={{ backgroundColor: '#e85c8d' }}
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                </button>
              )
            })}
          </div>

          <div className="flex-1" />

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
          {/* Legacy redirects */}
          <Route path="teacher-requests" element={<Navigate to="/admin/teachers" replace />} />
          <Route path="users" element={<Navigate to="/admin/teachers" replace />} />
          <Route path="tenants" element={<Navigate to="/admin" replace />} />
          <Route path="overview" element={<Navigate to="/admin" replace />} />
          <Route path="usage" element={<Navigate to="/admin/costs" replace />} />
          <Route path="credits" element={<Navigate to="/admin/costs" replace />} />
        </Routes>
      </main>
    </AppBackground>
  )
}
