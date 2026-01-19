import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { teacherApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { Plus, BookOpen, Users, Play, Edit2, Check, X, Loader2 } from 'lucide-react'
import { TeacherNavbar } from '@/components/TeacherNavbar'

interface ClassData {
  id: string
  name: string
  created_at: string
  session_count?: number
}

export default function ClassesPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [newClassName, setNewClassName] = useState('')
  const [showNewForm, setShowNewForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [creatingSessionForClass, setCreatingSessionForClass] = useState<string | null>(null)

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

  const updateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => 
      teacherApi.updateClass(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setEditingId(null)
      toast({ title: 'Classe aggiornata!' })
    },
  })

  const createSessionMutation = useMutation({
    mutationFn: ({ classId, title }: { classId: string; title: string }) =>
      teacherApi.createSession(classId, { title }),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      toast({ title: 'Sessione creata!' })
      setCreatingSessionForClass(null)
      // Navigate to the new session
      navigate(`/teacher/sessions/${response.data.id}`)
    },
    onError: () => {
      toast({ variant: 'destructive', title: 'Errore nella creazione della sessione' })
      setCreatingSessionForClass(null)
    },
  })

  const handleCreateSession = (classId: string, className: string) => {
    setCreatingSessionForClass(classId)
    const sessionTitle = `Sessione ${new Date().toLocaleDateString('it-IT')} - ${className}`
    createSessionMutation.mutate({ classId, title: sessionTitle })
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (newClassName.trim()) {
      createMutation.mutate(newClassName.trim())
    }
  }

  const startEdit = (cls: ClassData) => {
    setEditingId(cls.id)
    setEditName(cls.name)
  }

  const saveEdit = () => {
    if (editingId && editName.trim()) {
      updateMutation.mutate({ id: editingId, name: editName.trim() })
    }
  }

  return (
    <>
      <TeacherNavbar />
      <div className="pt-16 min-h-screen bg-slate-50">
        <div className="max-w-7xl mx-auto p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold">Le mie Classi</h2>
            <Button onClick={() => setShowNewForm(true)} disabled={showNewForm}>
              <Plus className="h-4 w-4 mr-2" />
              Nuova Classe
            </Button>
          </div>

      {showNewForm && (
        <Card className="mb-6">
          <CardContent className="pt-6">
            <form onSubmit={handleCreate} className="flex gap-3">
              <Input
                placeholder="Nome della classe (es. 3A Informatica)"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                autoFocus
              />
              <Button type="submit" disabled={createMutation.isPending}>
                Crea
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowNewForm(false)}>
                Annulla
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <p>Caricamento...</p>
      ) : !classes?.length ? (
        <Card>
          <CardContent className="py-12 text-center">
            <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold mb-2">Nessuna classe</h3>
            <p className="text-muted-foreground mb-4">
              Crea la tua prima classe per iniziare
            </p>
            <Button onClick={() => setShowNewForm(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Crea Classe
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {classes.map((cls) => (
            <Card key={cls.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                {editingId === cls.id ? (
                  <div className="flex gap-2">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      autoFocus
                    />
                    <Button size="sm" onClick={saveEdit}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingId(null)}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">{cls.name}</CardTitle>
                    <Button size="sm" variant="ghost" onClick={() => startEdit(cls)}>
                      <Edit2 className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                  <span className="flex items-center gap-1">
                    <Users className="h-4 w-4" />
                    {cls.session_count || 0} sessioni
                  </span>
                  <span>
                    Creata: {new Date(cls.created_at).toLocaleDateString('it-IT')}
                  </span>
                </div>
                <div className="flex gap-2">
                  <Link to={`/teacher/sessions?class=${cls.id}`} className="flex-1">
                    <Button variant="outline" className="w-full">
                      <Users className="h-4 w-4 mr-2" />
                      Sessioni
                    </Button>
                  </Link>
                  <Button
                    onClick={() => handleCreateSession(cls.id, cls.name)}
                    disabled={creatingSessionForClass === cls.id}
                  >
                    {creatingSessionForClass === cls.id ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Play className="h-4 w-4 mr-2" />
                    )}
                    Nuova
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
        </div>
      </div>
    </>
  )
}
