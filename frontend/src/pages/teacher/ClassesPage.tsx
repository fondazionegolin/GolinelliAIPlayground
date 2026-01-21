import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { teacherApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { 
  Plus, Users, Play, Edit2, Check, X, Loader2, 
  Pause, Square, Clock,
  MonitorPlay,
  ArrowRight,
  School
} from 'lucide-react'
import { TeacherNavbar } from '@/components/TeacherNavbar'


interface ClassData {
  id: string
  name: string
  created_at: string
  session_count?: number
}

interface SessionData {
  id: string
  title: string
  status: 'active' | 'paused' | 'finished'
  created_at: string
  active_students_count?: number
}

export default function ClassesPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [newClassName, setNewClassName] = useState('')
  const [showNewForm, setShowNewForm] = useState(false)

  const { data: classes, isLoading } = useQuery<ClassData[]>({
    queryKey: ['classes'],
    queryFn: async () => {
      const res = await teacherApi.getClasses()
      return res.data
    },
  })

  const createMutation = useMutation({
    mutationFn: (name: string) => teacherApi.createClass(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setNewClassName('')
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
      createMutation.mutate(newClassName.trim())
    }
  }

  return (
    <>
      <TeacherNavbar />
      <div className="pt-20 min-h-screen bg-slate-50/50 pb-20">
        <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-8">
          
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
            <div className="space-y-6">
              {classes.map((cls) => (
                <ClassContainer key={cls.id} classData={cls} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}

function ClassContainer({ classData }: { classData: ClassData }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(classData.name)
  const [isCreatingSession, setIsCreatingSession] = useState(false)

  // Fetch active sessions for this class
  const { data: sessionsResponse } = useQuery({
    queryKey: ['sessions', classData.id],
    queryFn: () => teacherApi.getSessions(classData.id),
    refetchInterval: 3000 // Frequent polling for real-time dashboard feel
  })

  const sessions = (sessionsResponse?.data || []) as SessionData[]
  // Show active and paused sessions prominently. Finished sessions are hidden or can be shown in history.
  const activeSessions = sessions.filter(s => s.status !== 'finished')
  
  // Sort: active first, then paused
  activeSessions.sort((a, b) => {
    if (a.status === 'active' && b.status !== 'active') return -1;
    if (a.status !== 'active' && b.status === 'active') return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const updateMutation = useMutation({
    mutationFn: (name: string) => teacherApi.updateClass(classData.id, name),
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
      // Navigate immediately to the new session control panel
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
    if (editName.trim() && editName !== classData.name) {
      updateMutation.mutate(editName.trim())
    } else {
      setIsEditing(false)
    }
  }

  return (
    <Card className="overflow-hidden border-slate-200 shadow-sm hover:shadow-md transition-shadow duration-300 bg-white group">
      {/* Class Header Section */}
      <div className="bg-slate-50/50 border-b border-slate-100 p-4 md:p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white rounded-lg border border-slate-200 shadow-sm">
              <School className="h-6 w-6 text-violet-600" />
            </div>
            
            {isEditing ? (
              <div className="flex gap-2 items-center">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  autoFocus
                  className="h-10 text-lg font-bold bg-white min-w-[300px]"
                />
                <Button size="sm" onClick={handleSaveEdit} className="h-10 w-10 p-0 bg-green-600 hover:bg-green-700">
                  <Check className="h-5 w-5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setIsEditing(false)} className="h-10 w-10 p-0">
                  <X className="h-5 w-5" />
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group/title">
                <h2 className="text-xl md:text-2xl font-bold text-slate-800 truncate cursor-default">
                  {classData.name}
                </h2>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setIsEditing(true)}
                  className="opacity-0 group-hover/title:opacity-100 transition-opacity h-8 w-8 p-0 text-slate-400 hover:text-slate-600"
                >
                  <Edit2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
          <p className="text-slate-500 text-sm mt-1 ml-14">
            Creata il {new Date(classData.created_at).toLocaleDateString('it-IT')} • {sessions.length} sessioni totali
          </p>
        </div>

        <Button 
          onClick={() => {
            setIsCreatingSession(true)
            createSessionMutation.mutate()
          }}
          disabled={isCreatingSession}
          className="bg-white hover:bg-violet-50 text-violet-700 border border-violet-200 shadow-sm"
        >
          {isCreatingSession ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Play className="h-4 w-4 mr-2 fill-current" />
          )}
          Nuova Sessione
        </Button>
      </div>

      {/* Active Sessions List */}
      <CardContent className="p-0">
        {activeSessions.length > 0 ? (
          <div className="divide-y divide-slate-100">
            {activeSessions.map((session) => (
              <div 
                key={session.id}
                className="p-4 md:p-5 hover:bg-slate-50/80 transition-colors flex flex-col md:flex-row md:items-center gap-4 group/session"
              >
                {/* Session Status & Info */}
                <div 
                  className="flex-1 min-w-0 cursor-pointer"
                  onClick={() => navigate(`/teacher/sessions/${session.id}`)}
                >
                  <div className="flex items-center gap-3 mb-2">
                    {session.status === 'active' ? (
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                      </span>
                    ) : (
                      <span className="flex h-3 w-3 rounded-full bg-amber-400"></span>
                    )}
                    <h3 className="text-lg font-semibold text-slate-900 group-hover/session:text-violet-700 transition-colors flex items-center gap-2">
                      {session.title}
                      <ArrowRight className="h-4 w-4 opacity-0 -ml-2 group-hover/session:opacity-100 group-hover/session:ml-0 transition-all text-violet-400" />
                    </h3>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
                    <span className="flex items-center gap-1.5 bg-slate-100/50 px-2 py-1 rounded">
                      <Clock className="h-3.5 w-3.5" />
                      Avviata alle {new Date(session.created_at).toLocaleTimeString('it-IT', {hour: '2-digit', minute:'2-digit'})}
                    </span>
                    <span className="flex items-center gap-1.5 bg-slate-100/50 px-2 py-1 rounded">
                      <Users className="h-3.5 w-3.5" />
                      <strong className="text-slate-700">{session.active_students_count || 0}</strong> studenti connessi
                    </span>
                  </div>
                </div>

                {/* Quick Controls */}
                <div className="flex items-center gap-2 self-start md:self-center bg-white p-1 rounded-lg border border-slate-100 shadow-sm">
                  {session.status === 'active' ? (
                    <Button 
                      size="sm" 
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateSessionStatusMutation.mutate({ id: session.id, status: 'paused' });
                      }}
                      className="text-amber-600 hover:text-amber-700 hover:bg-amber-50 h-9"
                    >
                      <Pause className="h-4 w-4 mr-2" />
                      Pausa
                    </Button>
                  ) : (
                    <Button 
                      size="sm" 
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation();
                        updateSessionStatusMutation.mutate({ id: session.id, status: 'active' });
                      }}
                      className="text-green-600 hover:text-green-700 hover:bg-green-50 h-9"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      Riprendi
                    </Button>
                  )}
                  
                  <div className="w-px h-6 bg-slate-200 mx-1"></div>

                  <Button 
                    size="sm" 
                    variant="ghost"
                    onClick={(e) => {
                      e.stopPropagation();
                      if(confirm('Terminare definitivamente questa sessione?')) {
                        updateSessionStatusMutation.mutate({ id: session.id, status: 'finished' });
                      }
                    }}
                    className="text-red-500 hover:text-red-600 hover:bg-red-50 h-9 px-3"
                    title="Termina Sessione"
                  >
                    <Square className="h-4 w-4 fill-current scale-90" />
                  </Button>
                </div>

                {/* Main Action Button */}
                <Button 
                  onClick={() => navigate(`/teacher/sessions/${session.id}`)}
                  className="bg-violet-600 hover:bg-violet-700 text-white shadow-sm shadow-violet-200 h-11 px-6 hidden md:flex"
                >
                  <MonitorPlay className="h-4 w-4 mr-2" />
                  Apri Pannello
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-8 text-center bg-slate-50/30">
            <p className="text-slate-500 italic">Nessuna sessione attiva al momento.</p>
            <Button 
              variant="link" 
              onClick={() => {
                setIsCreatingSession(true)
                createSessionMutation.mutate()
              }}
              className="text-violet-600 mt-1 h-auto p-0 font-medium"
            >
              Avvia subito una lezione
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
