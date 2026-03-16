import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { teacherApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { TeachersManagementModal } from '@/components/TeachersManagementModal'
import {
  Plus, Users, Play, Edit2, Check, X, Loader2,
  Pause, Square,
  ArrowRight,
  School,
  Share2,
  Clock,
  MoreVertical,
  UserPlus,
  MonitorPlay,
  BookOpen
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"


interface ClassData {
  id: string
  name: string
  school_grade?: string | null
  created_at: string
  session_count?: number
  role?: 'owner' | 'invited'
  owner_name?: string
}

interface SessionData {
  id: string
  title: string
  status: 'active' | 'paused' | 'finished'
  created_at: string
  active_students_count?: number
}

const SCHOOL_GRADE_OPTIONS = [
  'II ciclo primaria',
  'Secondaria I grado',
  'Biennio Secondaria II grado',
  'Triennio Secondaria II grado',
  'Università',
] as const

export default function ClassesPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [newClassName, setNewClassName] = useState('')
  const [newClassGrade, setNewClassGrade] = useState<string>(SCHOOL_GRADE_OPTIONS[1])
  const [showNewForm, setShowNewForm] = useState(false)

  const { data: classes, isLoading } = useQuery<ClassData[]>({
    queryKey: ['classes'],
    queryFn: async () => {
      const res = await teacherApi.getClasses()
      return res.data
    },
  })

  const createMutation = useMutation({
    mutationFn: (data: { name: string; school_grade?: string }) => teacherApi.createClass(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setNewClassName('')
      setNewClassGrade(SCHOOL_GRADE_OPTIONS[1])
      setShowNewForm(false)
      toast({ title: 'Classe creata con successo!' })
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Errore nella creazione' })
    },
  })

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (newClassName.trim()) {
      createMutation.mutate({
        name: newClassName.trim(),
        school_grade: newClassGrade,
      })
    }
  }

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header Principale */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
              Gestione Classi e Sessioni
            </h1>
            <p className="text-slate-500 mt-2 text-lg">
              Monitora le tue classi e gestisci le sessioni attive da un unico pannello.
            </p>
          </div>
          <Button
            onClick={() => setShowNewForm(true)}
            disabled={showNewForm}
            size="lg"
            className="bg-violet-600 hover:bg-violet-700 shadow-md transition-all hover:scale-105 font-medium"
          >
            <Plus className="h-5 w-5 mr-2" />
            Nuova Classe
          </Button>
        </div>

        {showNewForm && (
          <Card className="border-2 border-violet-100 bg-white shadow-lg animate-in slide-in-from-top-4 duration-300">
            <CardContent className="pt-6">
              <form onSubmit={handleCreate} className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="text-sm font-semibold text-violet-900 mb-2 block">Nome della nuova classe</label>
                  <Input
                    placeholder="es. 3A Informatica - A.S. 2024/25"
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                    autoFocus
                    className="bg-slate-50 border-slate-200 focus-visible:ring-violet-500 text-lg h-12"
                  />
                </div>
                <div className="w-64">
                  <label className="text-sm font-semibold text-violet-900 mb-2 block">Grado scolastico</label>
                  <select
                    value={newClassGrade}
                    onChange={(e) => setNewClassGrade(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 focus-visible:ring-violet-500 rounded-md text-sm h-12 px-3"
                  >
                    {SCHOOL_GRADE_OPTIONS.map((grade) => (
                      <option key={grade} value={grade}>{grade}</option>
                    ))}
                  </select>
                </div>
                <Button type="submit" disabled={createMutation.isPending} size="lg" className="bg-violet-600 h-12 px-8">
                  Crea Classe
                </Button>
                <Button type="button" variant="ghost" size="lg" onClick={() => setShowNewForm(false)} className="h-12">
                  Annulla
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="grid gap-6">
            {[1, 2, 3].map(i => (
              <Card key={i} className="h-48 animate-pulse bg-slate-100" />
            ))}
          </div>
        ) : !classes?.length ? (
          <div className="text-center py-24 bg-white rounded-3xl border-2 border-dashed border-slate-200 shadow-sm">
            <div className="w-20 h-20 bg-violet-50 rounded-full flex items-center justify-center mx-auto mb-6">
              <School className="h-10 w-10 text-violet-400" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">Nessuna classe presente</h3>
            <p className="text-slate-500 mb-8 max-w-md mx-auto">
              Inizia creando la tua prima classe per poter avviare sessioni di lavoro con gli studenti.
            </p>
            <Button onClick={() => setShowNewForm(true)} variant="outline" size="lg" className="border-violet-200 text-violet-700 hover:bg-violet-50">
              Crea la tua prima classe
            </Button>
          </div>
        ) : (
          <div className="space-y-8">
            {classes.map((cls) => (
              <ClassContainer key={cls.id} classData={cls} />
            ))}
          </div>
        )}
      </div>
    </div >
  )
}

function ClassContainer({ classData }: { classData: ClassData }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(classData.name)
  const [editSchoolGrade, setEditSchoolGrade] = useState(classData.school_grade || SCHOOL_GRADE_OPTIONS[1])
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [showTeachersModal, setShowTeachersModal] = useState(false)

  const isShared = classData.role === 'invited'

  useEffect(() => {
    setEditName(classData.name)
    setEditSchoolGrade(classData.school_grade || SCHOOL_GRADE_OPTIONS[1])
  }, [classData.name, classData.school_grade])

  // Fetch active sessions for this class
  const { data: sessionsResponse } = useQuery({
    queryKey: ['sessions', classData.id],
    queryFn: () => teacherApi.getSessions(classData.id),
    refetchInterval: 3000 // Frequent polling for real-time dashboard feel
  })

  const sessions = (sessionsResponse?.data || []) as SessionData[]
  // Show active and active-paused sessions prominently.
  const activeSessions = sessions.filter(s => s.status !== 'finished')

  // Sort: active first, then paused
  activeSessions.sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const updateMutation = useMutation({
    mutationFn: (data: { name: string; school_grade?: string }) => teacherApi.updateClass(classData.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setIsEditing(false)
      toast({ title: 'Classe aggiornata' })
    },
  })

  const createSessionMutation = useMutation({
    mutationFn: () => {
      const title = `Lezione del ${new Date().toLocaleDateString('it-IT')}`
      return teacherApi.createSession(classData.id, { title })
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', classData.id] })
      toast({ title: 'Sessione avviata!' })
      navigate(`/teacher/sessions/${res.data.id}`)
    },
    onSettled: () => setIsCreatingSession(false)
  })

  const updateSessionStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string, status: string }) =>
      teacherApi.updateSession(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', classData.id] })
      toast({ title: 'Stato sessione aggiornato' })
    }
  })

  const handleSaveEdit = () => {
    const hasChanges = editName !== classData.name || editSchoolGrade !== (classData.school_grade || SCHOOL_GRADE_OPTIONS[1])
    if (editName.trim() && hasChanges) {
      updateMutation.mutate({
        name: editName.trim(),
        school_grade: editSchoolGrade,
      })
    } else {
      setIsEditing(false)
    }
  }

  const lastActiveSession = activeSessions.length > 0 ? activeSessions[0] : null
  const otherSessions = activeSessions.length > 1 ? activeSessions.slice(1) : []

  return (
    <>
      <div className={`rounded-2xl border bg-white shadow-sm transition-all duration-300 hover:shadow-md ${isShared ? 'border-cyan-200' : 'border-slate-200'}`}>
        {/* WIDE CARD LAYOUT */}
        <div className="flex flex-col lg:flex-row">

          {/* LEFT: Class Info & Stats */}
          <div className="p-6 lg:w-1/3 flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-slate-100 bg-slate-50/30 rounded-l-2xl">
            <div>
              <div className="flex items-start justify-between mb-4">
                <div className={`p-3 rounded-xl shadow-sm ${isShared ? 'bg-cyan-100 text-cyan-700' : 'bg-violet-100 text-violet-700'}`}>
                  <School className="h-8 w-8" />
                </div>
                {/* Mobile Actions Menu */}
                <div className="lg:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => setIsEditing(true)}>
                        <Edit2 className="mr-2 h-4 w-4" /> Rinomina
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setShowTeachersModal(true)}>
                        <Users className="mr-2 h-4 w-4" /> Docenti
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {isEditing ? (
                <div className="space-y-2 mb-2">
                  <div className="flex gap-2 items-center">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      autoFocus
                      className="h-9 text-lg font-bold bg-white"
                    />
                    <Button size="sm" onClick={handleSaveEdit} className="h-9 w-9 p-0 bg-green-600 hover:bg-green-700">
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} className="h-9 w-9 p-0">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <select
                    value={editSchoolGrade}
                    onChange={(e) => setEditSchoolGrade(e.target.value)}
                    className="w-full h-9 px-2 text-sm rounded-md border border-slate-200 bg-white"
                  >
                    {SCHOOL_GRADE_OPTIONS.map((grade) => (
                      <option key={grade} value={grade}>{grade}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <h2 className="text-2xl font-bold text-slate-800 mb-2">{classData.name}</h2>
              )}

              {!isEditing && (
                <div className="mb-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
                    Grado scolastico
                  </p>
                  <span className="inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                    {classData.school_grade || 'Non impostato'}
                  </span>
                </div>
              )}

              <div className="flex items-center gap-3 text-sm text-slate-500 mb-6">
                {isShared ? (
                  <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-cyan-50 text-cyan-700 font-medium border border-cyan-100">
                    <Share2 className="h-3.5 w-3.5" />
                    {classData.owner_name ? `di ${classData.owner_name}` : 'Condivisa'}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                    <Users className="h-3.5 w-3.5" />
                    Personale
                  </span>
                )}
                <span className="text-slate-400">•</span>
                <span>Creata: {new Date(classData.created_at).toLocaleDateString('it-IT')}</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                <span className="text-xs text-slate-400 uppercase font-semibold block mb-1">Sessioni Attive</span>
                <span className="text-2xl font-bold text-violet-600">{activeSessions.length}</span>
              </div>
              <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                <span className="text-xs text-slate-400 uppercase font-semibold block mb-1">Totali</span>
                <span className="text-2xl font-bold text-slate-700">{sessions.length}</span>
              </div>
            </div>

            <div className="hidden lg:flex gap-2 mt-6">
              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)} className="flex-1 border-slate-200">
                <Edit2 className="h-4 w-4 mr-2" /> Modifica
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowTeachersModal(true)} className="flex-1 border-slate-200">
                <UserPlus className="h-4 w-4 mr-2" /> Docenti
              </Button>
            </div>
          </div>

          {/* RIGHT: Content & Actions */}
          <div className="p-6 lg:w-2/3 flex flex-col">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-slate-700 flex items-center gap-2">
                <MonitorPlay className="h-5 w-5 text-violet-500" />
                Attività Recenti
              </h3>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => navigate(`/teacher/classes/${classData.id}/uda`)}
                  className="border-indigo-200 text-indigo-600 hover:bg-indigo-50"
                >
                  <BookOpen className="h-4 w-4 mr-2" />
                  UDA
                </Button>
                <Button
                  onClick={() => {
                    setIsCreatingSession(true)
                    createSessionMutation.mutate()
                  }}
                  disabled={isCreatingSession}
                  className="bg-violet-600 hover:bg-violet-700 shadow-violet-100 text-white"
                >
                  {isCreatingSession ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2 fill-current" />}
                  Nuova Sessione
                </Button>
              </div>
            </div>

            {/* Latest Active Session Highlight */}
            <div className="flex-1">
              {lastActiveSession ? (
                <div className="space-y-4">
                  <div className="bg-violet-50/50 border border-violet-100 rounded-xl p-4 transition-all hover:bg-violet-50 hover:border-violet-200 hover:shadow-sm group/main-session">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-3">
                        {lastActiveSession.status === 'active' ? (
                          <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                          </span>
                        ) : (
                          <span className="flex h-3 w-3 rounded-full bg-amber-400"></span>
                        )}
                        <div>
                          <h4
                            className="font-bold text-lg text-slate-800 cursor-pointer hover:text-violet-700 hover:underline"
                            onClick={() => navigate(`/teacher/sessions/${lastActiveSession.id}`)}
                          >
                            {lastActiveSession.title}
                          </h4>
                          <p className="text-sm text-slate-500 flex items-center gap-2 mt-0.5">
                            <Clock className="h-3.5 w-3.5" />
                            Avviata alle {new Date(lastActiveSession.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                      <Button onClick={() => navigate(`/teacher/sessions/${lastActiveSession.id}`)} size="sm" className="hidden lg:flex">
                        Apri Pannello <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    </div>

                    <div className="flex items-center gap-2 mt-4 pt-3 border-t border-violet-100/50">
                      <div className="flex items-center px-2 py-1 bg-white rounded border border-slate-100 text-xs font-medium text-slate-600">
                        <Users className="h-3.5 w-3.5 mr-1.5 text-violet-500" />
                        {lastActiveSession.active_students_count || 0} Studenti
                      </div>
                      <div className="ml-auto flex gap-1">
                        {/* Quick Actions */}
                        {lastActiveSession.status === 'active' ? (
                          <Button size="sm" variant="ghost" onClick={() => updateSessionStatusMutation.mutate({ id: lastActiveSession.id, status: 'paused' })} className="h-8 px-2 text-amber-600 hover:text-amber-700 hover:bg-amber-50">
                            <Pause className="h-3.5 w-3.5 mr-1" /> Pausa
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => updateSessionStatusMutation.mutate({ id: lastActiveSession.id, status: 'active' })} className="h-8 px-2 text-green-600 hover:text-green-700 hover:bg-green-50">
                            <Play className="h-3.5 w-3.5 mr-1" /> Riprendi
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => { if (confirm('Terminare?')) updateSessionStatusMutation.mutate({ id: lastActiveSession.id, status: 'finished' }) }} className="h-8 w-8 p-0 text-red-400 hover:text-red-600 hover:bg-red-50">
                          <Square className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Other Sessions List */}
                  {otherSessions.length > 0 && (
                    <div className="space-y-2 mt-4">
                      <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Altre sessioni attive</h4>
                      {otherSessions.map(os => (
                        <div key={os.id} className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors">
                          <div className="flex items-center gap-3 overflow-hidden">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${os.status === 'active' ? 'bg-green-500' : 'bg-amber-400'}`} />
                            <span className="font-medium text-slate-700 truncate">{os.title}</span>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/teacher/sessions/${os.id}`)} className="h-7 text-xs">
                            Apri
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="h-full flex flex-col items-center justify-center p-8 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                  <div className="p-3 bg-white rounded-full shadow-sm mb-3">
                    <Play className="h-6 w-6 text-slate-300 ml-1" />
                  </div>
                  <p className="text-slate-500 font-medium mb-1">Nessuna sessione attiva</p>
                  <p className="text-sm text-slate-400 text-center max-w-xs">
                    Avvia una nuova sessione per iniziare a lavorare con la classe.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Teachers Management Modal */}
      {showTeachersModal && (
        <TeachersManagementModal
          type="class"
          targetId={classData.id}
          targetName={classData.name}
          onClose={() => setShowTeachersModal(false)}
        />
      )}
    </>
  )
}
