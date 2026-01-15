import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { 
  Building2, Users, BarChart3, LogOut, 
  LayoutDashboard, UserCheck, UserCog 
} from 'lucide-react'
import TenantsPage from './TenantsPage'
import TeacherRequestsPage from './TeacherRequestsPage'
import UsersPage from './UsersPage'
import UsagePage from './UsagePage'

const navItems = [
  { path: '/admin', label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { path: '/admin/tenants', label: 'Tenant', icon: Building2 },
  { path: '/admin/teacher-requests', label: 'Richieste Docenti', icon: UserCheck },
  { path: '/admin/users', label: 'Utenti', icon: UserCog },
  { path: '/admin/usage', label: 'Utilizzo', icon: BarChart3 },
]

export default function AdminDashboard() {
  const { logout } = useAuthStore()
  const location = useLocation()

  return (
    <div className="min-h-screen bg-gray-50 flex">
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
          <Route index element={<AdminHome />} />
          <Route path="tenants" element={<TenantsPage />} />
          <Route path="teacher-requests" element={<TeacherRequestsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="usage" element={<UsagePage />} />
        </Routes>
      </main>
    </div>
  )
}

function AdminHome() {
  return (
    <div>
      <h2 className="text-2xl font-bold mb-6">Dashboard Admin</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Link to="/admin/tenants">
          <div className="bg-white p-6 rounded-lg border hover:shadow-md transition-shadow">
            <Building2 className="h-8 w-8 text-primary mb-3" />
            <h3 className="font-semibold">Gestione Tenant</h3>
            <p className="text-sm text-muted-foreground">Crea e gestisci le scuole</p>
          </div>
        </Link>
        <Link to="/admin/teacher-requests">
          <div className="bg-white p-6 rounded-lg border hover:shadow-md transition-shadow">
            <Users className="h-8 w-8 text-primary mb-3" />
            <h3 className="font-semibold">Richieste Docenti</h3>
            <p className="text-sm text-muted-foreground">Approva nuovi docenti</p>
          </div>
        </Link>
        <Link to="/admin/usage">
          <div className="bg-white p-6 rounded-lg border hover:shadow-md transition-shadow">
            <BarChart3 className="h-8 w-8 text-primary mb-3" />
            <h3 className="font-semibold">Statistiche</h3>
            <p className="text-sm text-muted-foreground">Monitora l'utilizzo</p>
          </div>
        </Link>
      </div>
    </div>
  )
}
