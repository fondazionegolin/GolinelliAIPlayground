import TeacherClassesSessionsManager, { type TeacherCurrentSession } from '@/components/teacher/TeacherClassesSessionsManager'

export default function ClassesPage({ currentSession }: { currentSession?: TeacherCurrentSession | null }) {
  return <TeacherClassesSessionsManager entryMode="classes" currentSession={currentSession} />
}
