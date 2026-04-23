import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { Toaster } from '@/components/ui/toaster'
import { CookieBanner } from '@/components/CookieBanner'
import { Loader2 } from 'lucide-react'

import LandingPage from '@/pages/LandingPage'
import StudentJoinPage from '@/pages/StudentJoinPage'
import TeacherRequestPage from '@/pages/TeacherRequestPage'
import ActivatePage from '@/pages/ActivatePage'
import ResetPasswordPage from '@/pages/ResetPasswordPage'
import PrivacyPage from '@/pages/PrivacyPage'

const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'))
const TeacherDashboard = lazy(() => import('@/pages/teacher/TeacherDashboard'))
const StudentDashboard = lazy(() => import('@/pages/student/StudentDashboard'))

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles: string[] }) {
  const { user, isAuthenticated } = useAuthStore()
  
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  
  if (user && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />
  }
  
  return <>{children}</>
}

function App() {
  const { user, studentSession } = useAuthStore()
  
  const getDefaultRoute = (): string | null => {
    if (studentSession) return '/student'
    if (user?.role === 'ADMIN') return '/admin'
    if (user?.role === 'TEACHER') return '/teacher'
    // If not authenticated, we stay on the landing page
    return null 
  }
  
  return (
    <>
      <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-slate-950"><Loader2 className="h-8 w-8 animate-spin text-white/70" /></div>}>
        <Routes>
          <Route path="/login" element={<LandingPage />} />
          <Route path="/join" element={<StudentJoinPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/teacher-request" element={<TeacherRequestPage />} />
          <Route path="/activate/:token" element={<ActivatePage />} />
          <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
          
          <Route
            path="/admin/*"
            element={
              <ProtectedRoute allowedRoles={['ADMIN']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          
          <Route
            path="/teacher/*"
            element={
              <ProtectedRoute allowedRoles={['TEACHER', 'ADMIN']}>
                <TeacherDashboard />
              </ProtectedRoute>
            }
          />
          
          <Route path="/student/*" element={<StudentDashboard />} />
          
          <Route 
            path="/" 
            element={
              getDefaultRoute() ? (
                <Navigate to={getDefaultRoute()!} replace />
              ) : (
                <LandingPage />
              )
            } 
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
      <Toaster />
      <CookieBanner />
    </>
  )
}

export default App
