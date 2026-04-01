import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { teacherApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { TeachersManagementModal } from '@/components/TeachersManagementModal'
import {
  Plus, Users, Play, Edit2, Check, X, Loader2,
  Pause, Square, School, Share2, Clock,
  MoreVertical, UserPlus, MonitorPlay, BookOpen, ChevronRight
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
      createMutation.mutate({ name: newClassName.trim(), school_grade: newClassGrade })
    }
  }

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Le mie classi</h1>
            <p className="text-base text-slate-500 mt-1">Gestisci classi e sessioni di lavoro</p>
          </div>
          <Button
            onClick={() => setShowNewForm(v => !v)}
            className="bg-violet-600 hover:bg-violet-700 shrink-0"
          >
            <Plus className="h-4 w-4 mr-2" />
            Nuova Classe
          </Button>
        </div>

        {/* New Class Form */}
        {showNewForm && (
          <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">Crea nuova classe</h2>
            <form onSubmit={handleCreate}>
              <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-4 mb-4">
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">Nome della classe</label>
                  <Input
                    placeholder="es. 3A Informatica – A.S. 2025/26"
                    value={newClassName}
                    onChange={(e) => setNewClassName(e.target.value)}
                    autoFocus
                    className="h-10 bg-white"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 mb-1.5 block">Grado scolastico</label>
                  <select
                    value={newClassGrade}
                    onChange={(e) => setNewClassGrade(e.target.value)}
                    className="w-full h-10 bg-white border border-slate-200 rounded-md text-sm px-3 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  >
                    {SCHOOL_GRADE_OPTIONS.map((grade) => (
                      <option key={grade} value={grade}>{grade}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button type="submit" disabled={createMutation.isPending || !newClassName.trim()} className="bg-violet-600 hover:bg-violet-700">
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Crea Classe
                </Button>
                <Button type="button" variant="ghost" onClick={() => setShowNewForm(false)}>
                  Annulla
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white h-40 animate-pulse" />
            ))}
          </div>
        ) : !classes?.length ? (
          <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white py-20 text-center">
            <div className="w-16 h-16 bg-violet-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <School className="h-8 w-8 text-violet-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Nessuna classe</h3>
            <p className="text-slate-500 mb-6 max-w-sm mx-auto">
              Crea la tua prima classe per avviare sessioni con gli studenti.
            </p>
            <Button onClick={() => setShowNewForm(true)} variant="outline" className="border-violet-200 text-violet-700 hover:bg-violet-50">
              Crea la prima classe
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {classes.map((cls) => (
              <ClassCard key={cls.id} classData={cls} />
            ))}
          </div>
        )}

      </div>
    </div>
  )
}

function ClassCard({ classData }: { classData: ClassData }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(classData.name)
  const [editSchoolGrade, setEditSchoolGrade] = useState(classData.school_grade || SCHOOL_GRADE_OPTIONS[1])
  const [isCreatingSession, setIsCreatingSession] = useState(false)
  const [showSessionTitleDialog, setShowSessionTitleDialog] = useState(false)
  const [newSessionTitle, setNewSessionTitle] = useState('')
  const [showTeachersModal, setShowTeachersModal] = useState(false)

  const isShared = classData.role === 'invited'

  useEffect(() => {
    setEditName(classData.name)
    setEditSchoolGrade(classData.school_grade || SCHOOL_GRADE_OPTIONS[1])
  }, [classData.name, classData.school_grade])

  const { data: sessionsResponse } = useQuery({
    queryKey: ['sessions', classData.id],
    queryFn: () => teacherApi.getSessions(classData.id),
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
  })

  const sessions = (sessionsResponse?.data || []) as SessionData[]
  const activeSessions = sessions
    .filter(s => s.status !== 'finished')
    .sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1
      if (a.status !== 'active' && b.status === 'active') return 1
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

  const updateMutation = useMutation({
    mutationFn: (data: { name: string; school_grade?: string }) => teacherApi.updateClass(classData.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setIsEditing(false)
      toast({ title: 'Classe aggiornata' })
    },
  })

  const createSessionMutation = useMutation({
    mutationFn: (title: string) => teacherApi.createSession(classData.id, { title }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', classData.id] })
      toast({ title: 'Sessione avviata!' })
      setShowSessionTitleDialog(false)
      setNewSessionTitle('')
      navigate(`/teacher/sessions/${res.data.id}`)
    },
    onSettled: () => setIsCreatingSession(false)
  })

  const handleStartNewSession = () => {
    setNewSessionTitle(`Lezione del ${new Date().toLocaleDateString('it-IT')}`)
    setShowSessionTitleDialog(true)
  }

  const handleConfirmNewSession = () => {
    const title = newSessionTitle.trim() || `Lezione del ${new Date().toLocaleDateString('it-IT')}`
    setIsCreatingSession(true)
    createSessionMutation.mutate(title)
  }

  const updateSessionMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      teacherApi.updateSession(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', classData.id] })
    }
  })

  const handleSaveEdit = () => {
    const hasChanges = editName !== classData.name || editSchoolGrade !== (classData.school_grade || SCHOOL_GRADE_OPTIONS[1])
    if (editName.trim() && hasChanges) {
      updateMutation.mutate({ name: editName.trim(), school_grade: editSchoolGrade })
    } else {
      setIsEditing(false)
    }
  }

  const accentBorder = isShared ? 'border-cyan-200' : 'border-slate-200'
  const accentIcon = isShared ? 'bg-cyan-100 text-cyan-700' : 'bg-violet-100 text-violet-700'

  return (
    <>
      <div className={`rounded-xl border ${accentBorder} bg-white shadow-sm`}>

        {/* Card Header */}
        <div className="px-6 py-5 flex items-start gap-4 border-b border-slate-100">
          <div className={`p-2.5 rounded-lg shrink-0 ${accentIcon}`}>
            <School className="h-5 w-5" />
          </div>

          <div className="flex-1 min-w-0">
            {isEditing ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    autoFocus
                    className="h-9 text-base font-semibold bg-slate-50 max-w-sm"
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') setIsEditing(false) }}
                  />
                  <Button size="sm" onClick={handleSaveEdit} className="h-9 bg-green-600 hover:bg-green-700 px-3">
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} className="h-9 px-3">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <select
                  value={editSchoolGrade}
                  onChange={(e) => setEditSchoolGrade(e.target.value)}
                  className="h-9 px-2 text-sm rounded-md border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 max-w-xs"
                >
                  {SCHOOL_GRADE_OPTIONS.map((grade) => (
                    <option key={grade} value={grade}>{grade}</option>
                  ))}
                </select>
              </div>
            ) : (
              <>
                <h2 className="text-lg font-semibold text-slate-900 truncate">{classData.name}</h2>
                <div className="flex items-center flex-wrap gap-2 mt-1.5">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                    {classData.school_grade || 'Grado non impostato'}
                  </span>
                  {isShared ? (
                    <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-100">
                      <Share2 className="h-3 w-3" />
                      {classData.owner_name ? `di ${classData.owner_name}` : 'Condivisa'}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                      <Users className="h-3 w-3" />
                      Personale
                    </span>
                  )}
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(classData.created_at).toLocaleDateString('it-IT')}
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Header Actions */}
          {!isEditing && (
            <div className="flex items-center gap-2 shrink-0">
              {/* Stats */}
              <div className="hidden sm:flex items-center gap-3 text-sm mr-2">
                <span className="flex flex-col items-center">
                  <span className="text-base font-bold text-violet-600 leading-none">{activeSessions.length}</span>
                  <span className="text-[10px] text-slate-400 uppercase tracking-wide mt-0.5">Attive</span>
                </span>
                <span className="w-px h-8 bg-slate-200" />
                <span className="flex flex-col items-center">
                  <span className="text-base font-bold text-slate-600 leading-none">{sessions.length}</span>
                  <span className="text-[10px] text-slate-400 uppercase tracking-wide mt-0.5">Totali</span>
                </span>
              </div>

              <Button variant="outline" size="sm" onClick={() => setIsEditing(true)} className="hidden sm:flex gap-1.5">
                <Edit2 className="h-3.5 w-3.5" /> Rinomina
              </Button>
              <Button variant="outline" size="sm" onClick={() => setShowTeachersModal(true)} className="hidden sm:flex gap-1.5">
                <UserPlus className="h-3.5 w-3.5" /> Docenti
              </Button>

              {/* Mobile menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="sm:hidden h-9 w-9 p-0">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setIsEditing(true)}>
                    <Edit2 className="mr-2 h-4 w-4" /> Rinomina
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setShowTeachersModal(true)}>
                    <UserPlus className="mr-2 h-4 w-4" /> Gestisci docenti
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>

        {/* Sessions Body */}
        <div className="px-6 py-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
              <MonitorPlay className="h-4 w-4" />
              Sessioni attive
            </h3>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/teacher/classes/${classData.id}/uda`)}
                className="gap-1.5 text-indigo-600 border-indigo-200 hover:bg-indigo-50"
              >
                <BookOpen className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">UDA</span>
              </Button>
              <Button
                size="sm"
                onClick={handleStartNewSession}
                disabled={isCreatingSession}
                className="bg-violet-600 hover:bg-violet-700 gap-1.5"
              >
                {isCreatingSession
                  ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  : <Play className="h-3.5 w-3.5 fill-current" />}
                Nuova Sessione
              </Button>
            </div>
          </div>

          {activeSessions.length === 0 ? (
            <div className="flex items-center gap-3 py-4 text-slate-400">
              <div className="h-8 w-8 rounded-full border-2 border-dashed border-slate-200 flex items-center justify-center">
                <Play className="h-3.5 w-3.5 ml-0.5" />
              </div>
              <span className="text-sm">Nessuna sessione attiva — clicca <strong>Nuova Sessione</strong> per iniziare</span>
            </div>
          ) : (
            <div className="space-y-2">
              {activeSessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  onOpen={() => navigate(`/teacher/sessions/${session.id}`)}
                  onPause={() => updateSessionMutation.mutate({ id: session.id, status: 'paused' })}
                  onResume={() => updateSessionMutation.mutate({ id: session.id, status: 'active' })}
                  onStop={() => { if (confirm('Terminare la sessione?')) updateSessionMutation.mutate({ id: session.id, status: 'finished' }) }}
                />
              ))}
            </div>
          )}
        </div>

      </div>

      {showTeachersModal && (
        <TeachersManagementModal
          type="class"
          targetId={classData.id}
          targetName={classData.name}
          onClose={() => setShowTeachersModal(false)}
        />
      )}

      {/* New session title dialog */}
      {showSessionTitleDialog && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-100 p-6 w-full max-w-sm animate-in zoom-in-95 duration-150">
            <h3 className="text-base font-bold text-slate-800 mb-1">Nuova sessione</h3>
            <p className="text-sm text-slate-500 mb-4">Scegli un nome per questa sessione.</p>
            <Input
              autoFocus
              value={newSessionTitle}
              onChange={e => setNewSessionTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleConfirmNewSession(); if (e.key === 'Escape') setShowSessionTitleDialog(false) }}
              placeholder="Es: Lezione su Python"
              className="mb-4"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setShowSessionTitleDialog(false)}>Annulla</Button>
              <Button size="sm" onClick={handleConfirmNewSession} disabled={isCreatingSession} className="bg-violet-600 hover:bg-violet-700">
                {isCreatingSession ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                Crea sessione
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function SessionRow({ session, onOpen, onPause, onResume, onStop }: {
  session: SessionData
  onOpen: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
}) {
  const isActive = session.status === 'active'

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-slate-100 bg-slate-50/60 hover:bg-slate-50 hover:border-slate-200 transition-colors">
      {/* Status dot */}
      <div className="shrink-0">
        {isActive ? (
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500" />
          </span>
        ) : (
          <span className="flex h-2.5 w-2.5 rounded-full bg-amber-400" />
        )}
      </div>

      {/* Session info */}
      <div className="flex-1 min-w-0">
        <button
          onClick={onOpen}
          className="text-sm font-semibold text-slate-800 hover:text-violet-700 truncate block text-left"
        >
          {session.title}
        </button>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {new Date(session.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
          </span>
          {session.active_students_count !== undefined && (
            <span className="flex items-center gap-1">
              <Users className="h-3 w-3" />
              {session.active_students_count} studenti
            </span>
          )}
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${
            isActive ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {isActive ? 'Attiva' : 'In pausa'}
          </span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {isActive ? (
          <Button size="sm" variant="ghost" onClick={onPause} className="h-8 px-2.5 text-amber-600 hover:text-amber-700 hover:bg-amber-50 text-xs gap-1">
            <Pause className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Pausa</span>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={onResume} className="h-8 px-2.5 text-green-600 hover:text-green-700 hover:bg-green-50 text-xs gap-1">
            <Play className="h-3.5 w-3.5 fill-current" /> <span className="hidden sm:inline">Riprendi</span>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onStop} className="h-8 w-8 p-0 text-slate-300 hover:text-red-500 hover:bg-red-50">
          <Square className="h-3.5 w-3.5" />
        </Button>
        <Button size="sm" onClick={onOpen} className="h-8 px-3 bg-violet-600 hover:bg-violet-700 gap-1 text-xs ml-1">
          Apri <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}
