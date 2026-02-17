import { Routes, Route, Link, useLocation, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import {
  Building2, LogOut,
  UserCheck, UserCog, Gauge
} from 'lucide-react'
import TenantsPage from './TenantsPage'
import TeacherRequestsPage from './TeacherRequestsPage'
import UsersPage from './UsersPage'
import AdminControlCenterPage from './AdminControlCenterPage'
import { AppBackground } from '@/components/ui/AppBackground'

const navItems = [
  { path: '/admin', label: 'Cruscotto', icon: Gauge, exact: true },
  { path: '/admin/teacher-requests', label: 'Richieste Docenti', icon: UserCheck },
  { path: '/admin/users', label: 'Utenti', icon: UserCog },
  { path: '/admin/tenants', label: 'Tenant', icon: Building2 },
]

export default function AdminDashboard() {
  const { logout } = useAuthStore()
  const location = useLocation()

  return (
    <AppBackground className="min-h-screen flex">
      <aside className="w-64 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-xl font-bold text-primary">EduAI Admin</h1>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = item.exact
              ? location.pathname === item.path
              : location.pathname.startsWith(item.path)
            return (
              <Link key={item.path} to={item.path}>
                <Button
                  variant={isActive ? 'secondary' : 'ghost'}
                  className="w-full justify-start"
                >
                  <item.icon className="h-4 w-4 mr-2" />
                  {item.label}
                </Button>
              </Link>
            )
          })}
        </nav>

        <div className="p-4 border-t">
          <Button variant="ghost" className="w-full justify-start text-red-600" onClick={logout}>
            <LogOut className="h-4 w-4 mr-2" />
            Esci
          </Button>
        </div>
      </aside>

      <main className="flex-1 p-8">
        <Routes>
          <Route index element={<AdminControlCenterPage />} />
          <Route path="overview" element={<Navigate to="/admin" replace />} />
          <Route path="tenants" element={<TenantsPage />} />
          <Route path="teacher-requests" element={<TeacherRequestsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="usage" element={<AdminControlCenterPage />} />
          <Route path="credits" element={<AdminControlCenterPage />} />
        </Routes>
      </main>
    </AppBackground>
  )
}
