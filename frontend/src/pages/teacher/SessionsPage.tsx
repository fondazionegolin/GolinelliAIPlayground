import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { teacherApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/use-toast'
import { Plus, Play, Square, Users, Clock, Copy, Eye, Trash2 } from 'lucide-react'

interface ClassData {
  id: string
  name: string
  school_grade?: string | null
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
  const { t } = useTranslation()
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
      toast({ title: t('sessions.created') })
    },
  })

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      teacherApi.updateSession(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      toast({ title: t('sessions.status_updated') })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => teacherApi.deleteSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      toast({ title: t('sessions.deleted'), variant: "destructive" })
    },
  })

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code)
    toast({ title: t('sessions.code_copied') })
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
      draft: t('sessions.status_draft'),
      active: t('sessions.status_active'),
      paused: t('sessions.status_paused'),
      ended: t('sessions.status_ended'),
    }
    return (
      <span className={`px-2 py-1 rounded text-xs font-medium ${styles[status] || styles.draft}`}>
        {labels[status] || status}
      </span>
    )
  }

  const selectedClassData = classes?.find((cls) => cls.id === selectedClass)

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto space-y-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold">{t('sessions.title')}</h2>
            {selectedClass && (
              <Button onClick={() => setShowNewForm(true)} disabled={showNewForm}>
                <Plus className="h-4 w-4 mr-2" />
                {t('sessions.new_session')}
              </Button>
            )}
          </div>

      <div className="mb-6">
        <label className="text-sm font-medium mb-2 block">{t('sessions.select_class')}</label>
        <select
          className="w-full md:w-64 p-2 border rounded-md"
          value={selectedClass}
          onChange={(e) => setSelectedClass(e.target.value)}
        >
          <option value="">{t('sessions.select_class_default')}</option>
          {classes?.map((cls) => (
            <option key={cls.id} value={cls.id}>
              {cls.name}{cls.school_grade ? ` • ${cls.school_grade}` : ''}
            </option>
          ))}
        </select>
        {selectedClassData && (
          <p className="mt-2 text-xs text-slate-600">
            {t('sessions.class_grade', { grade: selectedClassData.school_grade || t('classes.not_set') })}
          </p>
        )}
      </div>

      {!selectedClass ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Users className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold mb-2">{t('sessions.select_class')}</h3>
            <p className="text-muted-foreground">
              {t('sessions.select_class_hint')}
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
                    placeholder={t('sessions.title_placeholder')}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    autoFocus
                  />
                  <Button type="submit" disabled={createMutation.isPending}>
                    {t('sessions.create_short')}
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setShowNewForm(false)}>
                    {t('common.cancel')}
                  </Button>
                </form>
              </CardContent>
            </Card>
          )}

          {isLoading ? (
            <p>{t('common.loading')}</p>
          ) : !sessions?.length ? (
            <Card>
              <CardContent className="py-12 text-center">
                <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="font-semibold mb-2">{t('sessions.empty_title')}</h3>
                <p className="text-muted-foreground mb-4">
                  {t('sessions.empty_body')}
                </p>
                <Button onClick={() => setShowNewForm(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  {t('sessions.create_btn')}
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
                        <span className="font-medium">{t('sessions.code_label')}</span>
                        <code className="bg-gray-100 px-2 py-1 rounded font-mono">
                          {session.join_code}
                        </code>
                        <Button size="sm" variant="ghost" onClick={() => copyCode(session.join_code)}>
                          <Copy className="h-4 w-4" />
                        </Button>
                      </div>
                      <span>
                        {t('sessions.created_at')} {new Date(session.created_at).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      {session.status === 'draft' && (
                        <Button
                          onClick={() => updateStatusMutation.mutate({ id: session.id, status: 'active' })}
                          disabled={updateStatusMutation.isPending}
                        >
                          <Play className="h-4 w-4 mr-2" />
                          {t('sessions.start_btn')}
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
                            {t('sessions.pause_btn')}
                          </Button>
                          <Button
                            variant="destructive"
                            onClick={() => updateStatusMutation.mutate({ id: session.id, status: 'ended' })}
                            disabled={updateStatusMutation.isPending}
                          >
                            {t('sessions.end_btn')}
                          </Button>
                        </>
                      )}
                      {session.status === 'paused' && (
                        <Button
                          onClick={() => updateStatusMutation.mutate({ id: session.id, status: 'active' })}
                          disabled={updateStatusMutation.isPending}
                        >
                          <Play className="h-4 w-4 mr-2" />
                          {t('sessions.resume_btn')}
                        </Button>
                      )}
                      {session.status === 'ended' && (
                        <Button
                          variant="destructive"
                          onClick={() => {
                            if (confirm(t('sessions.delete_confirm'))) {
                              deleteMutation.mutate(session.id)
                            }
                          }}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {t('common.delete')}
                        </Button>
                      )}
                      <Link to={`/teacher/sessions/${session.id}`}>
                        <Button variant="outline">
                          <Eye className="h-4 w-4 mr-2" />
                          {t('sessions.monitor_btn')}
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
      </div>
  )
}
