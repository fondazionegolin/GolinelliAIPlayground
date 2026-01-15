import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { teacherApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { Plus, Play, Square, Users, Clock, Copy, Eye } from 'lucide-react'

interface ClassData {
  id: string
  name: string
}

interface SessionData {
  id: string
  class_id: string
  title: string
  join_code: string
  status: string
  is_persistent: boolean
  starts_at: string | null
  ends_at: string | null
  created_at: string
}

export default function SessionsPage() {
  const [searchParams] = useSearchParams()
  const classFilter = searchParams.get('class')
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [selectedClass, setSelectedClass] = useState<string>(classFilter || '')
  const [showNewForm, setShowNewForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const { data: classes } = useQuery<ClassData[]>({
    queryKey: ['classes'],
    queryFn: async () => {
      const res = await teacherApi.getClasses()
      return res.data
    },
  })

  const { data: sessions, isLoading } = useQuery<SessionData[]>({
    queryKey: ['sessions', selectedClass],
    queryFn: async () => {
      if (!selectedClass) return []
      const res = await teacherApi.getSessions(selectedClass)
      return res.data
    },
    enabled: !!selectedClass,
  })

  const createMutation = useMutation({
    mutationFn: (data: { classId: string; title: string }) =>
      teacherApi.createSession(data.classId, { title: data.title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      setNewTitle('')
      setShowNewForm(false)
      toast({ title: 'Sessione creata!' })
    },
  })

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      teacherApi.updateSession(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      toast({ title: 'Stato sessione aggiornato!' })
    },
  })

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    toast({ title: 'Codice copiato!' })
  }

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedClass && newTitle.trim()) {
      createMutation.mutate({ classId: selectedClass, title: newTitle.trim() })
    }
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-800',
      active: 'bg-green-100 text-green-800',
      paused: 'bg-yellow-100 text-yellow-800',
      ended: 'bg-red-100 text-red-800',
    }
    const labels: Record<string, string> = {
      draft: 'Bozza',
      active: 'Attiva',
      paused: 'In pausa',
      ended: 'Terminata',
    }
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status] || styles.draft}`}>
        {labels[status] || status}
      </span>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Sessioni</h2>
        {selectedClass && (
          <Button onClick={() => setShowNewForm(true)} disabled={showNewForm}>
            <Plus className="h-4 w-4 mr-2" />
            Nuova Sessione
          </Button>
        )}
      </div>

      <div className="mb-6">
        <label className="text-sm font-medium mb-2 block">Seleziona Classe</label>
        <select
          className="w-full md:w-64 p-2 border rounded-md"
          value={selectedClass}
          onChange={(e) => setSelectedClass(e.target.value)}
        >
          <option value="">-- Seleziona una classe --</option>
          {classes?.map((cls) => (
            <option key={cls.id} value={cls.id}>
              {cls.name}
            </option>
          ))}
        </select>
      </div>

      {!selectedClass ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold mb-2">Seleziona una classe</h3>
            <p className="text-muted-foreground">
              Scegli una classe per vedere e gestire le sessioni
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {showNewForm && (
            <Card className="mb-6">
              <CardContent className="pt-6">
                <form onSubmit={handleCreate} className="flex gap-3">
                  <Input
                    placeholder="Titolo sessione (es. Lezione su Python)"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
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
          ) : !sessions?.length ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="font-semibold mb-2">Nessuna sessione</h3>
                <p className="text-muted-foreground mb-4">
                  Crea la prima sessione per questa classe
                </p>
                <Button onClick={() => setShowNewForm(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Crea Sessione
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {sessions.map((session) => (
                <Card key={session.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-lg">{session.title}</CardTitle>
                      {getStatusBadge(session.status)}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-6 text-sm text-muted-foreground mb-4">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">Codice:</span>
                        <code className="bg-gray-100 px-2 py-1 rounded font-mono">
                          {session.join_code}
                        </code>
                        <Button size="sm" variant="ghost" onClick={() => copyCode(session.join_code)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <span>
                        Creata: {new Date(session.created_at).toLocaleDateString('it-IT')}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      {session.status === 'draft' && (
                        <Button
                          onClick={() => updateStatusMutation.mutate({ id: session.id, status: 'active' })}
                          disabled={updateStatusMutation.isPending}
                        >
                          <Play className="h-4 w-4 mr-2" />
                          Avvia
                        </Button>
                      )}
                      {session.status === 'active' && (
                        <>
                          <Button
                            variant="outline"
                            onClick={() => updateStatusMutation.mutate({ id: session.id, status: 'paused' })}
                            disabled={updateStatusMutation.isPending}
                          >
                            <Square className="h-4 w-4 mr-2" />
                            Pausa
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => updateStatusMutation.mutate({ id: session.id, status: 'ended' })}
                            disabled={updateStatusMutation.isPending}
                          >
                            Termina
                          </Button>
                        </>
                      )}
                      {session.status === 'paused' && (
                        <Button
                          onClick={() => updateStatusMutation.mutate({ id: session.id, status: 'active' })}
                          disabled={updateStatusMutation.isPending}
                        >
                          <Play className="h-4 w-4 mr-2" />
                          Riprendi
                        </Button>
                      )}
                      <Link to={`/teacher/sessions/${session.id}`}>
                        <Button variant="outline">
                          <Eye className="h-4 w-4 mr-2" />
                          Monitora
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
