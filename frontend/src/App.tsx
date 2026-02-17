import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { Toaster } from '@/components/ui/toaster'

import LandingPage from '@/pages/LandingPage'
import StudentJoinPage from '@/pages/StudentJoinPage'
import TeacherRequestPage from '@/pages/TeacherRequestPage'
import ActivatePage from '@/pages/ActivatePage'
import AdminDashboard from '@/pages/admin/AdminDashboard'
import TeacherDashboard from '@/pages/teacher/TeacherDashboard'
import StudentDashboard from '@/pages/student/StudentDashboard'

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
      <Routes>
        <Route path="/login" element={<LandingPage />} />
        <Route path="/join" element={<StudentJoinPage />} />
        <Route path="/teacher-request" element={<TeacherRequestPage />} />
        <Route path="/activate/:token" element={<ActivatePage />} />
        
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
            <ProtectedRoute allowedRoles={['TEACHER']}>
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
      <Toaster />
    </>
  )
}

export default App
