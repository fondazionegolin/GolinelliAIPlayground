import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { X, Loader2, Users, UserRound, Check, Globe } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { teacherbotsApi, teacherApi } from '@/lib/api'

interface TeacherbotShareModalProps {
  teacherbotId: string
  teacherbotName: string
  onClose: () => void
}

interface TeacherClass {
  id: string
  name: string
}

interface TeacherSession {
  id: string
  title?: string
  name?: string
}

interface LiveStudent {
  id: string
  nickname: string
}

interface Publication {
  id: string
  class_id: string | null
  class_name: string | null
  student_id: string | null
  student_nickname: string | null
  is_active: boolean
}

type Tab = 'class' | 'student'

export default function TeacherbotShareModal({ teacherbotId, teacherbotName, onClose }: TeacherbotShareModalProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('class')
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null)
  const [studentClassId, setStudentClassId] = useState<string | null>(null)
  const [studentSessionId, setStudentSessionId] = useState<string | null>(null)

  const publicationsQuery = useQuery({
    queryKey: ['teacherbot-publications', teacherbotId],
    queryFn: async () => (await teacherbotsApi.getPublications(teacherbotId)).data as Publication[],
  })

  const classesQuery = useQuery({
    queryKey: ['teacher-classes'],
    queryFn: async () => (await teacherApi.getClasses()).data as TeacherClass[],
  })

  const sessionsQuery = useQuery({
    queryKey: ['teacher-sessions', studentClassId],
    queryFn: async () => (await teacherApi.getSessions(studentClassId!)).data as TeacherSession[],
    enabled: !!studentClassId,
  })

  const sessionLiveQuery = useQuery({
    queryKey: ['teacher-session-live', studentSessionId],
    queryFn: async () => (await teacherApi.getSessionLive(studentSessionId!)).data as { students: LiveStudent[] },
    enabled: !!studentSessionId,
  })

  const publishClassMutation = useMutation({
    mutationFn: (classId: string) => teacherbotsApi.publish(teacherbotId, classId),
    onSuccess: () => {
      toast({ title: 'Condiviso con la classe' })
      queryClient.invalidateQueries({ queryKey: ['teacherbot-publications', teacherbotId] })
      setSelectedClassId(null)
    },
    onError: (error: any) => {
      toast({ title: 'Errore', description: error?.response?.data?.detail || 'Condivisione non riuscita', variant: 'destructive' })
    },
  })

  const publishStudentMutation = useMutation({
    mutationFn: (studentId: string) => teacherbotsApi.publishToStudent(teacherbotId, studentId),
    onSuccess: () => {
      toast({ title: 'Condiviso con lo studente' })
      queryClient.invalidateQueries({ queryKey: ['teacherbot-publications', teacherbotId] })
    },
    onError: (error: any) => {
      toast({ title: 'Errore', description: error?.response?.data?.detail || 'Condivisione non riuscita', variant: 'destructive' })
    },
  })

  const unpublishMutation = useMutation({
    mutationFn: (publicationId: string) => teacherbotsApi.unpublish(teacherbotId, publicationId),
    onSuccess: () => {
      toast({ title: 'Condivisione rimossa' })
      queryClient.invalidateQueries({ queryKey: ['teacherbot-publications', teacherbotId] })
    },
    onError: () => {
      toast({ title: 'Errore', description: 'Impossibile rimuovere la condivisione', variant: 'destructive' })
    },
  })

  const publications = publicationsQuery.data || []
  const classPublications = publications.filter(p => p.is_active && p.class_id)
  const studentPublications = publications.filter(p => p.is_active && p.student_id)
  const publishedClassIds = new Set(classPublications.map(p => p.class_id))
  const sharedStudentIds = new Set(studentPublications.map(p => p.student_id))

  return createPortal(
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[85vh] flex flex-col">
        <div className="flex justify-between items-center mb-4 flex-shrink-0">
          <h3 className="text-lg font-bold text-slate-800 truncate">Condividi — {teacherbotName}</h3>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="flex gap-1 rounded-xl border border-slate-200 p-1 mb-4 flex-shrink-0">
          <button
            onClick={() => setTab('class')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'class' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <Users className="h-3.5 w-3.5" />
            Classe
          </button>
          <button
            onClick={() => setTab('student')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'student' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-50'}`}
          >
            <UserRound className="h-3.5 w-3.5" />
            Studenti
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {tab === 'class' ? (
            <>
              <p className="text-sm text-slate-600 mb-4">
                Rendi il teacherbot disponibile a tutti gli studenti di una classe, in tutte le sue sessioni.
              </p>

              {classPublications.length > 0 && (
                <div className="mb-4 space-y-2">
                  {classPublications.map(pub => (
                    <div key={pub.id} className="flex items-center justify-between p-3 bg-green-50 rounded-xl border border-green-200">
                      <span className="text-sm text-green-700 flex items-center gap-2">
                        <Check className="h-4 w-4" />
                        {pub.class_name}
                      </span>
                      <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => unpublishMutation.mutate(pub.id)}>
                        Rimuovi
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {classesQuery.isLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
              ) : (
                <div className="space-y-2 max-h-52 overflow-y-auto mb-4">
                  {classesQuery.data?.filter(c => !publishedClassIds.has(c.id)).map(cls => (
                    <button
                      key={cls.id}
                      type="button"
                      onClick={() => setSelectedClassId(cls.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${selectedClassId === cls.id ? 'border-slate-900/40 bg-slate-900/5' : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'}`}
                    >
                      <div className="font-medium text-slate-800">{cls.name}</div>
                    </button>
                  ))}
                  {classesQuery.data?.filter(c => !publishedClassIds.has(c.id)).length === 0 && (
                    <p className="text-center text-sm text-slate-400 py-4">Già condiviso con tutte le classi</p>
                  )}
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  onClick={() => selectedClassId && publishClassMutation.mutate(selectedClassId)}
                  disabled={!selectedClassId || publishClassMutation.isPending}
                >
                  {publishClassMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Globe className="h-4 w-4 mr-2" />}
                  Condividi con la classe
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-slate-600 mb-4">
                Condividi solo con studenti specifici, all'interno di una sessione.
              </p>

              {studentPublications.length > 0 && (
                <div className="mb-4 space-y-2">
                  {studentPublications.map(pub => (
                    <div key={pub.id} className="flex items-center justify-between p-3 bg-green-50 rounded-xl border border-green-200">
                      <span className="text-sm text-green-700 flex items-center gap-2">
                        <Check className="h-4 w-4" />
                        {pub.student_nickname}
                      </span>
                      <Button variant="ghost" size="sm" className="text-red-600 hover:bg-red-50" onClick={() => unpublishMutation.mutate(pub.id)}>
                        Rimuovi
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 mb-3">
                <select
                  value={studentClassId || ''}
                  onChange={(e) => { setStudentClassId(e.target.value || null); setStudentSessionId(null) }}
                  className="text-sm border border-slate-200 rounded-lg px-2 py-2 bg-white"
                >
                  <option value="">Seleziona classe…</option>
                  {classesQuery.data?.map(cls => (
                    <option key={cls.id} value={cls.id}>{cls.name}</option>
                  ))}
                </select>
                <select
                  value={studentSessionId || ''}
                  onChange={(e) => setStudentSessionId(e.target.value || null)}
                  disabled={!studentClassId || sessionsQuery.isLoading}
                  className="text-sm border border-slate-200 rounded-lg px-2 py-2 bg-white disabled:opacity-50"
                >
                  <option value="">Seleziona sessione…</option>
                  {sessionsQuery.data?.map(session => (
                    <option key={session.id} value={session.id}>{session.title || session.name}</option>
                  ))}
                </select>
              </div>

              {studentSessionId && (
                sessionLiveQuery.isLoading ? (
                  <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {sessionLiveQuery.data?.students.filter(s => !sharedStudentIds.has(s.id)).map(student => (
                      <div key={student.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-200">
                        <span className="text-sm text-slate-700">{student.nickname}</span>
                        <Button
                          size="sm"
                          onClick={() => publishStudentMutation.mutate(student.id)}
                          disabled={publishStudentMutation.isPending}
                        >
                          Condividi
                        </Button>
                      </div>
                    ))}
                    {sessionLiveQuery.data?.students.filter(s => !sharedStudentIds.has(s.id)).length === 0 && (
                      <p className="text-center text-sm text-slate-400 py-4">Nessuno studente disponibile in questa sessione</p>
                    )}
                  </div>
                )
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}
