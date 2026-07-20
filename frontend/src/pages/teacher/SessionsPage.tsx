import TeacherClassesSessionsManager, { type TeacherCurrentSession } from '@/components/teacher/TeacherClassesSessionsManager'

export default function SessionsPage({ currentSession }: { currentSession?: TeacherCurrentSession | null }) {
  return <TeacherClassesSessionsManager entryMode="sessions" currentSession={currentSession} />
}
