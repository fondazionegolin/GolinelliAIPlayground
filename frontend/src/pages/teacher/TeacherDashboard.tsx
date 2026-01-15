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
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      <aside className="w-full md:w-64 bg-white border-b md:border-b-0 md:border-r flex flex-col shrink-0">
        <div className="p-4 border-b">
          <div className="flex items-center gap-3">
            <img 
              src="/golinelli-logo.svg" 
              alt="Golinelli" 
              className="h-8 w-auto object-contain"
              style={{ maxWidth: '40px' }}
            />
            <h1 className="text-xl font-bold text-primary">Golinelli AI</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1 truncate">{user?.email}</p>
        </div>
        
        <nav className="flex-1 p-2 md:p-4 flex md:flex-col gap-1 overflow-x-auto md:overflow-x-visible">
          {navItems.map((item) => {
            const isActive = item.exact 
              ? location.pathname === item.path
              : location.pathname.startsWith(item.path)
            return (
              <Link key={item.path} to={item.path} className="shrink-0">
                <Button
                  variant={isActive ? 'secondary' : 'ghost'}
                  className="w-full justify-start whitespace-nowrap"
                  size="sm"
                >
                  <item.icon className="h-4 w-4 mr-2 shrink-0" />
                  <span className="hidden md:inline">{item.label}</span>
                </Button>
              </Link>
            )
          })}
        </nav>

        <div className="p-2 md:p-4 border-t">
          <Button variant="ghost" className="w-full justify-start text-red-600" size="sm" onClick={logout}>
            <LogOut className="h-4 w-4 mr-2 shrink-0" />
            <span className="hidden md:inline">Esci</span>
          </Button>
        </div>
      </aside>

      <main className="flex-1 p-4 md:p-8 overflow-auto">
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
