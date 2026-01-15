import { Routes, Route, Link, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { Button } from '@/components/ui/button'
import { 
  BookOpen, Users, LogOut, HeadphonesIcon
} from 'lucide-react'
import ClassesPage from './ClassesPage'
import SessionsPage from './SessionsPage'
import SessionLivePage from './SessionLivePage'
import TeacherSupportChat from './TeacherSupportChat'

const navItems = [
  { path: '/teacher', label: 'Supporto Docente', icon: HeadphonesIcon, exact: true },
  { path: '/teacher/classes', label: 'Classi', icon: BookOpen },
  { path: '/teacher/sessions', label: 'Sessioni', icon: Users },
]

export default function TeacherDashboard() {
  const { logout, user } = useAuthStore()
  const location = useLocation()

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <aside className="w-64 bg-white border-r flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <img src="/golinelli-logo.svg" alt="Golinelli" className="h-8 w-8" />
            <h1 className="text-xl font-bold text-primary">Golinelli AI</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1">{user?.email}</p>
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
          <Route index element={<TeacherSupportChat />} />
          <Route path="classes" element={<ClassesPage />} />
          <Route path="sessions" element={<SessionsPage />} />
          <Route path="sessions/:sessionId" element={<SessionLivePage />} />
        </Routes>
      </main>
    </div>
  )
}
