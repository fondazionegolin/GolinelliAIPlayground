import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { Toaster } from '@/components/ui/toaster'

import LoginPage from '@/pages/LoginPage'
import StudentJoinPage from '@/pages/StudentJoinPage'
import TeacherRequestPage from '@/pages/TeacherRequestPage'
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
  const { user, isAuthenticated, studentSession } = useAuthStore()
  
  const getDefaultRoute = () => {
    if (studentSession) return '/student'
    if (!isAuthenticated || !user) return '/login'
    if (user.role === 'ADMIN') return '/admin'
    if (user.role === 'TEACHER') return '/teacher'
    return '/login'
  }
  
  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/join" element={<StudentJoinPage />} />
        <Route path="/teacher-request" element={<TeacherRequestPage />} />
        
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
        
        <Route path="/" element={<Navigate to={getDefaultRoute()} replace />} />
        <Route path="*" element={<Navigate to={getDefaultRoute()} replace />} />
      </Routes>
      <Toaster />
    </>
  )
}

export default App
