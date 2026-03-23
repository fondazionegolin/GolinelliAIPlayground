import ClassificationModule from '../student/ClassificationModule'

export default function TeacherMLLabPage() {
  // Read the active session from localStorage (set by TeacherDashboard session selector)
  let sessionId: string | undefined
  try {
    const stored = localStorage.getItem('teacher_selected_session')
    if (stored) sessionId = JSON.parse(stored)?.id
  } catch { /* ignore */ }

  return <ClassificationModule sessionId={sessionId} />
}
