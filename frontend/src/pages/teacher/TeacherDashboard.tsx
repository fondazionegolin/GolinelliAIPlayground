import { Routes, Route } from 'react-router-dom'
import ClassesPage from './ClassesPage'
import SessionsPage from './SessionsPage'
import SessionLivePage from './SessionLivePage'
import TeacherSupportChat from './TeacherSupportChat'

export default function TeacherDashboard() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Routes>
        <Route index element={<TeacherSupportChat />} />
        <Route path="classes" element={<ClassesPage />} />
        <Route path="sessions" element={<SessionsPage />} />
        <Route path="sessions/:sessionId" element={<SessionLivePage />} />
      </Routes>
    </div>
  )
}
