import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  BookOpen,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Edit2,
  Eye,
  MonitorPlay,
  Pause,
  Play,
  PlayCircle,
  Plus,
  School,
  Share2,
  Square,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  IconButton,
  Input,
  Select,
  Spinner,
} from '@/design'
import { teacherApi } from '@/lib/api'
import { getTeacherAccentTheme } from '@/lib/teacherAccent'
import { hexToRgba } from '@/design/themes/colorUtils'
import { useTeacherProfile } from '@/hooks/useTeacherProfile'
import { TeachersManagementModal } from '@/components/TeachersManagementModal'
import { useToast } from '@/components/ui/use-toast'

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
  class_id: string
  title: string
  join_code?: string
  status: 'draft' | 'active' | 'paused' | 'finished' | 'ended'
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

const STATUS_META: Record<string, { label: string; tone: string; dot: string }> = {
  draft: { label: 'Bozza', tone: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  active: { label: 'Attiva', tone: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  paused: { label: 'In pausa', tone: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  finished: { label: 'Terminata', tone: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500' },
  ended: { label: 'Terminata', tone: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500' },
}

export default function TeacherClassesSessionsManager({
  entryMode,
}: {
  entryMode: 'classes' | 'sessions'
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: teacherProfile } = useTeacherProfile()
  const accentTheme = getTeacherAccentTheme(teacherProfile?.uiAccent)

  const [selectedClassId, setSelectedClassId] = useState(searchParams.get('class') || '')
  const [showNewClassForm, setShowNewClassForm] = useState(false)
  const [showTeachersModal, setShowTeachersModal] = useState(false)
  const [newClassName, setNewClassName] = useState('')
  const [newClassGrade, setNewClassGrade] = useState<string>(SCHOOL_GRADE_OPTIONS[1])
  const [isEditingClass, setIsEditingClass] = useState(false)
  const [editClassName, setEditClassName] = useState('')
  const [editClassGrade, setEditClassGrade] = useState<string>(SCHOOL_GRADE_OPTIONS[1])
  const [showNewSessionDialog, setShowNewSessionDialog] = useState(false)
  const [newSessionTitle, setNewSessionTitle] = useState('')
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editingTitleValue, setEditingTitleValue] = useState('')

  const { data: classes = [], isLoading: isClassesLoading } = useQuery<ClassData[]>({
    queryKey: ['classes'],
    queryFn: async () => (await teacherApi.getClasses()).data,
  })

  useEffect(() => {
    if (!classes.length) return
    const fromUrl = searchParams.get('class')
    const validFromUrl = fromUrl && classes.some((cls) => cls.id === fromUrl)
    if (validFromUrl) {
      setSelectedClassId(fromUrl)
      return
    }
    if (selectedClassId && classes.some((cls) => cls.id === selectedClassId)) return
    const fallbackId = classes[0].id
    setSelectedClassId(fallbackId)
    setSearchParams({ class: fallbackId }, { replace: true })
  }, [classes, searchParams, selectedClassId, setSearchParams])

  const selectedClass = classes.find((cls) => cls.id === selectedClassId) || null

  useEffect(() => {
    if (!selectedClass) return
    setEditClassName(selectedClass.name)
    setEditClassGrade(selectedClass.school_grade || SCHOOL_GRADE_OPTIONS[1])
  }, [selectedClass])

  const { data: sessions = [], isLoading: isSessionsLoading } = useQuery<SessionData[]>({
    queryKey: ['sessions', selectedClassId],
    queryFn: async () => {
      if (!selectedClassId) return []
      return (await teacherApi.getSessions(selectedClassId)).data
    },
    enabled: !!selectedClassId,
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
  })

  const createClassMutation = useMutation({
    mutationFn: (data: { name: string; school_grade?: string }) => teacherApi.createClass(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setNewClassName('')
      setNewClassGrade(SCHOOL_GRADE_OPTIONS[1])
      setShowNewClassForm(false)
      const nextId = res.data.id
      setSelectedClassId(nextId)
      setSearchParams({ class: nextId }, { replace: true })
      toast({ title: 'Classe creata con successo' })
    },
    onError: () => {
      toast({ title: 'Errore nella creazione', variant: 'destructive' })
    },
  })

  const updateClassMutation = useMutation({
    mutationFn: (data: { id: string; name: string; school_grade?: string }) =>
      teacherApi.updateClass(data.id, { name: data.name, school_grade: data.school_grade }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setIsEditingClass(false)
      toast({ title: 'Classe aggiornata' })
    },
  })

  const createSessionMutation = useMutation({
    mutationFn: (data: { classId: string; title: string }) => teacherApi.createSession(data.classId, { title: data.title }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', selectedClassId] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setShowNewSessionDialog(false)
      setNewSessionTitle('')
      toast({ title: 'Sessione creata' })
      navigate(`/teacher/sessions/${res.data.id}`)
    },
  })

  const updateSessionMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => teacherApi.updateSession(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', selectedClassId] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      toast({ title: 'Stato sessione aggiornato' })
    },
  })

  const renameSessionMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => teacherApi.updateSession(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', selectedClassId] })
      setEditingTitleId(null)
      setEditingTitleValue('')
      toast({ title: 'Nome sessione aggiornato' })
    },
  })

  const deleteSessionMutation = useMutation({
    mutationFn: (id: string) => teacherApi.deleteSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', selectedClassId] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      toast({ title: 'Sessione eliminata' })
    },
  })

  const groupedSessions = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return {
      open: sorted.filter((session) => session.status !== 'finished' && session.status !== 'ended'),
      archive: sorted.filter((session) => session.status === 'finished' || session.status === 'ended'),
    }
  }, [sessions])

  const summary = useMemo(() => ({
    totalClasses: classes.length,
    totalSessions: classes.reduce((sum, cls) => sum + (cls.session_count || 0), 0),
    activeSessions: groupedSessions.open.filter((session) => session.status === 'active').length,
    pausedSessions: groupedSessions.open.filter((session) => session.status === 'paused').length,
  }), [classes, groupedSessions])

  const handleSelectClass = (classId: string) => {
    setSelectedClassId(classId)
    setSearchParams({ class: classId }, { replace: true })
    setEditingTitleId(null)
    setIsEditingClass(false)
  }

  const handleCreateClass = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newClassName.trim()) return
    createClassMutation.mutate({ name: newClassName.trim(), school_grade: newClassGrade })
  }

  const handleSaveClass = () => {
    if (!selectedClass || !editClassName.trim()) {
      setIsEditingClass(false)
      return
    }
    const noChanges =
      editClassName.trim() === selectedClass.name &&
      editClassGrade === (selectedClass.school_grade || SCHOOL_GRADE_OPTIONS[1])
    if (noChanges) {
      setIsEditingClass(false)
      return
    }
    updateClassMutation.mutate({
      id: selectedClass.id,
      name: editClassName.trim(),
      school_grade: editClassGrade,
    })
  }

  const handleCreateSession = () => {
    if (!selectedClassId) return
    const title = newSessionTitle.trim() || `Lezione del ${new Date().toLocaleDateString('it-IT')}`
    createSessionMutation.mutate({ classId: selectedClassId, title })
  }

  const handleRenameSession = (sessionId: string) => {
    const title = editingTitleValue.trim()
    if (!title) return
    renameSessionMutation.mutate({ id: sessionId, title })
  }

  const copyCode = (code?: string) => {
    if (!code) return
    navigator.clipboard.writeText(code)
    toast({ title: 'Codice copiato' })
  }

  const emptyTitle = entryMode === 'classes' ? 'Nessuna classe' : 'Nessuna classe selezionata'
  const emptyBody = entryMode === 'classes'
    ? 'Crea la tua prima classe per iniziare a organizzare sessioni, docenti e attività.'
    : 'Seleziona una classe dal menu laterale per gestire le sessioni in modo ordinato.'

  return (
    <div className="p-6 md:p-8">
      <div
        className="mx-auto flex max-w-[1440px] flex-col overflow-hidden rounded-[28px] border bg-white/92 lg:h-[calc(100vh-9.5rem)] lg:min-h-[720px] lg:flex-row"
        style={{
          borderColor: accentTheme.id === 'black' ? hexToRgba('#94a3b8', 0.28) : hexToRgba(accentTheme.accent, 0.2),
        }}
      >
        <aside
          className="w-full shrink-0 border-b bg-white/96 lg:w-[23rem] lg:border-b-0 lg:border-r"
          style={{
            borderColor: accentTheme.id === 'black' ? hexToRgba('#94a3b8', 0.28) : hexToRgba(accentTheme.accent, 0.2),
          }}
        >
          <div
            className="border-b px-5 py-4"
            style={{
              borderBottomColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14),
              backgroundColor: accentTheme.id === 'black' ? 'rgba(255,255,255,0.96)' : hexToRgba(accentTheme.accent, 0.08),
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em]" style={{ color: accentTheme.text }}>
                  Classi
                </p>
                <h1 className="mt-0.5 text-base font-semibold text-slate-900">Gestione classi</h1>
              </div>
              <Button
                onClick={() => setShowNewClassForm((value) => !value)}
                density="compact"
                className="shrink-0 rounded-xl shadow-sm"
                style={{ backgroundColor: accentTheme.accent }}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Nuova
              </Button>
            </div>
          </div>

          {showNewClassForm && (
            <div className="border-b px-6 py-5" style={{ borderBottomColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14) }}>
              <form onSubmit={handleCreateClass} className="space-y-3">
                <Input
                  placeholder="es. 3A Informatica - A.S. 2025/26"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  surface="base"
                  className="border-white/0 bg-white"
                />
                <Select
                  value={newClassGrade}
                  onChange={(e) => setNewClassGrade(e.target.value)}
                  surface="base"
                >
                  {SCHOOL_GRADE_OPTIONS.map((grade) => (
                    <option key={grade} value={grade}>{grade}</option>
                  ))}
                </Select>
                <div className="flex items-center gap-2">
                  <Button type="submit" disabled={createClassMutation.isPending || !newClassName.trim()} className="rounded-xl" style={{ backgroundColor: accentTheme.accent }}>
                    {createClassMutation.isPending ? <Spinner className="mr-2" size="sm" tone="inverse" /> : null}
                    Crea
                  </Button>
                  <Button type="button" surface="ghost" tone="neutral" onClick={() => setShowNewClassForm(false)}>
                    Annulla
                  </Button>
                </div>
              </form>
            </div>
          )}

          <div className="px-5 py-3">
            <div
              className="grid grid-cols-3 gap-1.5 rounded-2xl border p-2"
              style={{
                borderColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.12),
                backgroundColor: accentTheme.id === 'black' ? 'rgba(255,255,255,0.94)' : hexToRgba(accentTheme.accent, 0.06),
              }}
            >
              <SummaryCell label="Classi" value={summary.totalClasses} />
              <SummaryCell label="Sessioni" value={summary.totalSessions} />
              <SummaryCell label="Attive" value={summary.activeSessions} />
            </div>
          </div>

          <div className="max-h-[28rem] overflow-y-auto px-4 pb-4 lg:max-h-[calc(100%-16rem)]">
            {isClassesLoading ? (
              <div className="space-y-3 px-2">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white/80" />
                ))}
              </div>
            ) : classes.length === 0 ? (
              <div className="rounded-[22px] border border-dashed border-slate-200 bg-white/70 px-5 py-10 text-center">
                <School className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-4 text-sm font-medium text-slate-600">{emptyTitle}</p>
                <p className="mt-1 text-sm text-slate-400">{emptyBody}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {classes.map((cls) => {
                  const isSelected = cls.id === selectedClassId
                  const isShared = cls.role === 'invited'
                  return (
                    <button
                      key={cls.id}
                      onClick={() => handleSelectClass(cls.id)}
                      className="w-full rounded-2xl border px-3 py-3 text-left transition-all hover:shadow-sm"
                      style={isSelected ? {
                        borderColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.15) : hexToRgba(accentTheme.accent, 0.22),
                        backgroundColor: accentTheme.id === 'black' ? 'rgba(255,255,255,0.96)' : hexToRgba(accentTheme.accent, 0.1),
                      } : {
                        borderColor: 'rgba(203,213,225,0.4)',
                        backgroundColor: 'rgba(255,255,255,0.72)',
                      }}
                    >
                      <div className="flex items-start gap-2.5">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl"
                          style={{
                            backgroundColor: isShared ? 'rgba(34,211,238,0.12)' : hexToRgba(accentTheme.accent, 0.12),
                            color: isShared ? '#0891b2' : accentTheme.text,
                          }}
                        >
                          <School className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-1">
                            <span className="truncate text-sm font-semibold text-slate-800">{cls.name}</span>
                            <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-300 transition-transform ${isSelected ? 'translate-x-0.5' : ''}`} />
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                            <span className="text-slate-400">{cls.school_grade || '—'}</span>
                            <span className="text-slate-200">·</span>
                            <span className="font-medium text-slate-500">{cls.session_count || 0} sess.</span>
                            {isShared && (
                              <span className="rounded-full bg-cyan-50 px-1.5 py-0.5 font-medium text-cyan-700">
                                {cls.owner_name ? `di ${cls.owner_name}` : 'Condivisa'}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </aside>

        <section className="min-w-0 flex-1 bg-white/70">
          {!selectedClass ? (
            <div className="flex h-full min-h-[420px] items-center justify-center px-6">
              <div className="max-w-md text-center">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100">
                  <Users className="h-7 w-7 text-slate-400" />
                </div>
                <h2 className="mt-5 text-xl font-semibold text-slate-900">{emptyTitle}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">{emptyBody}</p>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div
                className="border-b px-5 py-4 lg:px-6"
                style={{
                  borderBottomColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14),
                  backgroundColor: accentTheme.id === 'black' ? 'rgba(255,255,255,0.96)' : accentTheme.soft,
                }}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    {isEditingClass ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={editClassName}
                          onChange={(e) => setEditClassName(e.target.value)}
                          density="compact"
                          className="w-60 bg-white text-sm"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveClass()
                            if (e.key === 'Escape') setIsEditingClass(false)
                          }}
                        />
                        <Select
                          value={editClassGrade}
                          onChange={(e) => setEditClassGrade(e.target.value)}
                          density="compact"
                          className="text-xs"
                        >
                          {SCHOOL_GRADE_OPTIONS.map((grade) => (
                            <option key={grade} value={grade}>{grade}</option>
                          ))}
                        </Select>
                        <IconButton onClick={handleSaveClass} disabled={updateClassMutation.isPending} title="Salva" tone="success" surface="ghost" size="default">
                          {updateClassMutation.isPending ? <Spinner size="sm" tone="success" /> : <Check className="h-4 w-4" />}
                        </IconButton>
                        <IconButton onClick={() => setIsEditingClass(false)} title="Annulla" tone="neutral" surface="ghost" size="default">
                          <X className="h-4 w-4" />
                        </IconButton>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="truncate text-lg font-semibold text-slate-900">{selectedClass.name}</h2>
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="rounded-full bg-white/90 px-2 py-0.5 font-medium text-slate-500 ring-1 ring-slate-200">
                            {selectedClass.school_grade || '—'}
                          </span>
                          {selectedClass.role === 'invited' && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2 py-0.5 font-medium text-cyan-700 ring-1 ring-cyan-100">
                              <Share2 className="h-2.5 w-2.5" />
                              {selectedClass.owner_name ? `di ${selectedClass.owner_name}` : 'Condivisa'}
                            </span>
                          )}
                          <span className="text-slate-400">
                            <Clock className="mr-0.5 inline h-2.5 w-2.5" />
                            {new Date(selectedClass.created_at).toLocaleDateString('it-IT')}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {!isEditingClass && (
                    <div className="flex shrink-0 items-center gap-1.5">
                      <IconButton onClick={() => setIsEditingClass(true)} title="Rinomina classe" tone="neutral" surface="outline" size="default">
                        <Edit2 className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton onClick={() => setShowTeachersModal(true)} title="Gestisci docenti" tone="neutral" surface="outline" size="default">
                        <UserPlus className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton onClick={() => navigate(`/teacher/classes/${selectedClass.id}/uda`)} title="UDA" tone="neutral" surface="outline" size="default">
                        <BookOpen className="h-3.5 w-3.5" />
                      </IconButton>
                      <Button
                        density="compact"
                        onClick={() => {
                          setNewSessionTitle(`Lezione del ${new Date().toLocaleDateString('it-IT')}`)
                          setShowNewSessionDialog(true)
                        }}
                        className="rounded-xl shadow-sm"
                        style={{ backgroundColor: accentTheme.accent }}
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Nuova sessione
                      </Button>
                    </div>
                  )}
                </div>

                <div className="mt-3 grid grid-cols-4 gap-2">
                  <MetricCard label="Aperte" value={groupedSessions.open.length} accent={accentTheme} />
                  <MetricCard label="Attive" value={summary.activeSessions} accent={accentTheme} />
                  <MetricCard label="In pausa" value={summary.pausedSessions} accent={accentTheme} />
                  <MetricCard label="Archivio" value={groupedSessions.archive.length} accent={accentTheme} />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4 lg:px-6">
                {isSessionsLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((item) => (
                      <div key={item} className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white/80" />
                    ))}
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-200 bg-white/80 px-6 py-16 text-center">
                    <MonitorPlay className="mx-auto h-10 w-10 text-slate-300" />
                    <h3 className="mt-4 text-lg font-semibold text-slate-900">Nessuna sessione</h3>
                    <p className="mt-1 text-sm text-slate-500">Questa classe non ha ancora sessioni. Aprine una nuova dal pannello in alto.</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <SessionSection
                      title="Sessioni aperte"
                      sessions={groupedSessions.open}
                      accentTheme={accentTheme}
                      editingTitleId={editingTitleId}
                      editingTitleValue={editingTitleValue}
                      setEditingTitleId={setEditingTitleId}
                      setEditingTitleValue={setEditingTitleValue}
                      onRename={handleRenameSession}
                      onCopyCode={copyCode}
                      renamePending={renameSessionMutation.isPending}
                      updatePending={updateSessionMutation.isPending}
                      deletePending={deleteSessionMutation.isPending}
                      onStatusChange={(id, status) => updateSessionMutation.mutate({ id, status })}
                      onDelete={(id) => deleteSessionMutation.mutate(id)}
                    />
                    <SessionSection
                      title="Archivio"
                      sessions={groupedSessions.archive}
                      accentTheme={accentTheme}
                      editingTitleId={editingTitleId}
                      editingTitleValue={editingTitleValue}
                      setEditingTitleId={setEditingTitleId}
                      setEditingTitleValue={setEditingTitleValue}
                      onRename={handleRenameSession}
                      onCopyCode={copyCode}
                      renamePending={renameSessionMutation.isPending}
                      updatePending={updateSessionMutation.isPending}
                      deletePending={deleteSessionMutation.isPending}
                      onStatusChange={(id, status) => updateSessionMutation.mutate({ id, status })}
                      onDelete={(id) => deleteSessionMutation.mutate(id)}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {showTeachersModal && selectedClass && (
        <TeachersManagementModal
          type="class"
          targetId={selectedClass.id}
          targetName={selectedClass.name}
          onClose={() => setShowTeachersModal(false)}
        />
      )}

      {showNewSessionDialog && selectedClass && (
        <Dialog open={showNewSessionDialog} onOpenChange={setShowNewSessionDialog}>
          <DialogContent
            size="sm"
            surface="elevated"
            className="rounded-[24px]"
            style={{ borderColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14) }}
          >
            <DialogHeader>
              <DialogTitle>Nuova sessione</DialogTitle>
              <DialogDescription>
                Stai lavorando su <strong>{selectedClass.name}</strong>. Dai un nome chiaro alla sessione.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <Input
                autoFocus
                value={newSessionTitle}
                onChange={(e) => setNewSessionTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateSession()
                  if (e.key === 'Escape') setShowNewSessionDialog(false)
                }}
                className="bg-white"
                placeholder="Es. Ripasso sistemi operativi"
              />
            </DialogBody>
            <DialogFooter>
              <Button surface="ghost" tone="neutral" onClick={() => setShowNewSessionDialog(false)}>
                Annulla
              </Button>
              <Button onClick={handleCreateSession} disabled={createSessionMutation.isPending} style={{ backgroundColor: accentTheme.accent }}>
                {createSessionMutation.isPending ? <Spinner className="mr-2" size="sm" tone="inverse" /> : null}
                Crea sessione
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function SummaryCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/85 px-2 py-2 text-center">
      <div className="text-base font-semibold text-slate-900">{value}</div>
      <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">{label}</div>
    </div>
  )
}

function MetricCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent: { accent: string; soft: string; id: string }
}) {
  return (
    <Card
      surface="base"
      className="rounded-2xl px-3 py-2.5"
      style={{
        borderColor: accent.id === 'black' ? 'rgba(15,23,42,0.08)' : hexToRgba(accent.accent, 0.14),
        backgroundColor: accent.id === 'black' ? 'rgba(255,255,255,0.92)' : accent.soft,
      }}
    >
      <div className="text-[10px] uppercase tracking-[0.16em] text-slate-400">{label}</div>
      <div className="mt-0.5 text-xl font-semibold text-slate-900">{value}</div>
    </Card>
  )
}

function SessionSection({
  title,
  sessions,
  accentTheme,
  editingTitleId,
  editingTitleValue,
  setEditingTitleId,
  setEditingTitleValue,
  onRename,
  onCopyCode,
  renamePending,
  updatePending,
  deletePending,
  onStatusChange,
  onDelete,
}: {
  title: string
  sessions: SessionData[]
  accentTheme: { accent: string; text: string; soft: string; id: string }
  editingTitleId: string | null
  editingTitleValue: string
  setEditingTitleId: (value: string | null) => void
  setEditingTitleValue: (value: string) => void
  onRename: (id: string) => void
  onCopyCode: (code?: string) => void
  renamePending: boolean
  updatePending: boolean
  deletePending: boolean
  onStatusChange: (id: string, status: string) => void
  onDelete: (id: string) => void
}) {
  if (sessions.length === 0) return null

  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{title}</h3>

      <Card surface="base" className="overflow-hidden rounded-2xl border-slate-200 bg-white shadow-sm">
        <div className="hidden grid-cols-[minmax(0,2fr)_100px_90px_80px_60px_96px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400 lg:grid">
          <span>Sessione</span>
          <span>Stato</span>
          <span>Codice</span>
          <span>Creata</span>
          <span>Stud.</span>
          <span>Azioni</span>
        </div>
        <div className="divide-y divide-slate-100">
          {sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              accentTheme={accentTheme}
              editingTitleId={editingTitleId}
              editingTitleValue={editingTitleValue}
              setEditingTitleId={setEditingTitleId}
              setEditingTitleValue={setEditingTitleValue}
              onRename={onRename}
              onCopyCode={onCopyCode}
              renamePending={renamePending}
              updatePending={updatePending}
              deletePending={deletePending}
              onStatusChange={onStatusChange}
              onDelete={onDelete}
            />
          ))}
        </div>
      </Card>
    </div>
  )
}

function SessionRow({
  session,
  accentTheme,
  editingTitleId,
  editingTitleValue,
  setEditingTitleId,
  setEditingTitleValue,
  onRename,
  onCopyCode,
  renamePending,
  updatePending,
  deletePending,
  onStatusChange,
  onDelete,
}: {
  session: SessionData
  accentTheme: { accent: string; text: string; soft: string; id: string }
  editingTitleId: string | null
  editingTitleValue: string
  setEditingTitleId: (value: string | null) => void
  setEditingTitleValue: (value: string) => void
  onRename: (id: string) => void
  onCopyCode: (code?: string) => void
  renamePending: boolean
  updatePending: boolean
  deletePending: boolean
  onStatusChange: (id: string, status: string) => void
  onDelete: (id: string) => void
}) {
  const meta = STATUS_META[session.status] || STATUS_META.draft
  const isEnded = session.status === 'ended' || session.status === 'finished'
  const isPaused = session.status === 'paused'
  const isDraft = session.status === 'draft'
  const isActive = session.status === 'active'

  const navigate = useNavigate()

  return (
    <div
      className="px-4 py-3 lg:grid lg:grid-cols-[minmax(0,2fr)_100px_90px_80px_60px_96px] lg:items-center lg:gap-3 cursor-pointer hover:bg-slate-50/80 transition-colors"
      onClick={() => navigate(`/teacher/sessions/${session.id}`)}
    >
      {/* Title */}
      <div className="min-w-0" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2">
          <span className={`block h-2 w-2 shrink-0 rounded-full ${meta.dot} ${isActive ? 'animate-pulse' : ''}`} />
          {editingTitleId === session.id ? (
            <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={(e) => { e.preventDefault(); onRename(session.id) }}>
              <Input
                autoFocus
                value={editingTitleValue}
                onChange={(e) => setEditingTitleValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditingTitleId(null) }}
                density="compact"
                className="min-w-0 flex-1 bg-white text-sm text-slate-800"
              />
              <IconButton type="submit" disabled={renamePending} tone="success" surface="ghost" size="sm">
                {renamePending ? <Spinner size="sm" tone="success" /> : <Check className="h-3.5 w-3.5" />}
              </IconButton>
              <IconButton type="button" onClick={() => setEditingTitleId(null)} tone="neutral" surface="ghost" size="sm">
                <X className="h-3.5 w-3.5" />
              </IconButton>
            </form>
          ) : (
            <div className="flex min-w-0 items-center gap-1">
              <span className="truncate text-sm font-medium text-slate-800">{session.title}</span>
              <IconButton
                onClick={() => { setEditingTitleId(session.id); setEditingTitleValue(session.title) }}
                className="shrink-0"
                tone="neutral"
                surface="ghost"
                size="sm"
                title="Rinomina"
              >
                <Edit2 className="h-3 w-3" />
              </IconButton>
            </div>
          )}
        </div>
        {/* Mobile-only meta row */}
        <div className="ml-4 mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400 lg:hidden">
          <StatusBadge meta={meta} />
          {session.join_code && (
            <Button onClick={() => onCopyCode(session.join_code)} tone="neutral" surface="soft" density="compact" className="font-mono text-[11px]">
              {session.join_code}
            </Button>
          )}
          <span>{new Date(session.created_at).toLocaleDateString('it-IT')}</span>
        </div>
      </div>

      {/* Status */}
      <div className="hidden lg:block">
        <StatusBadge meta={meta} />
      </div>

      {/* Code */}
      <div className="hidden lg:block" onClick={e => e.stopPropagation()}>
        {session.join_code ? (
          <Button onClick={() => onCopyCode(session.join_code)} tone="neutral" surface="soft" density="compact" className="inline-flex items-center gap-1 font-mono text-[11px] font-semibold text-slate-600">
            {session.join_code}
            <Copy className="h-2.5 w-2.5" />
          </Button>
        ) : <span className="text-xs text-slate-300">—</span>}
      </div>

      {/* Date */}
      <div className="hidden text-xs text-slate-400 lg:block">
        {new Date(session.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })}
      </div>

      {/* Students */}
      <div className="hidden text-sm font-medium text-slate-600 lg:block">
        {session.active_students_count ?? 0}
      </div>

      {/* Actions — icon-only */}
      <div className="mt-3 flex items-center gap-1 lg:mt-0" onClick={e => e.stopPropagation()}>
        {isDraft && (
          <IconButton onClick={() => onStatusChange(session.id, 'active')} disabled={updatePending} title="Avvia sessione" size="sm"
            style={{ backgroundColor: accentTheme.accent, borderColor: accentTheme.accent }} className="text-white">
            <Play className="h-3.5 w-3.5" />
          </IconButton>
        )}
        {isActive && (
          <>
            <IconButton onClick={() => onStatusChange(session.id, 'paused')} disabled={updatePending} title="Metti in pausa" tone="neutral" surface="outline" size="sm">
              <Pause className="h-3.5 w-3.5" />
            </IconButton>
            <IconButton onClick={() => onStatusChange(session.id, 'ended')} disabled={updatePending} title="Chiudi sessione" tone="danger" surface="soft" size="sm">
              <Square className="h-3.5 w-3.5" />
            </IconButton>
          </>
        )}
        {isPaused && (
          <IconButton onClick={() => onStatusChange(session.id, 'active')} disabled={updatePending} title="Riprendi sessione" size="sm"
            style={{ backgroundColor: accentTheme.accent, borderColor: accentTheme.accent }} className="text-white">
            <PlayCircle className="h-3.5 w-3.5" />
          </IconButton>
        )}
        <Link to={`/teacher/sessions/${session.id}`} title="Apri sessione">
          <span className="pointer-events-none">
            <IconButton tone="neutral" surface="outline" size="sm">
              <Eye className="h-3.5 w-3.5" />
            </IconButton>
          </span>
        </Link>
        {isEnded && (
          <IconButton
            onClick={() => { if (confirm('Eliminare questa sessione?')) onDelete(session.id) }}
            disabled={deletePending} title="Elimina sessione"
            tone="danger"
            surface="soft"
            size="sm"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        )}
      </div>
    </div>
  )
}

function StatusBadge({ meta }: { meta: { label: string; tone: string } }) {
  if (meta.tone.includes('emerald')) {
    return <Badge tone="success" surface="soft" density="compact">{meta.label}</Badge>
  }
  if (meta.tone.includes('amber')) {
    return <Badge tone="warning" surface="soft" density="compact">{meta.label}</Badge>
  }
  if (meta.tone.includes('rose')) {
    return <Badge tone="danger" surface="soft" density="compact">{meta.label}</Badge>
  }
  return <Badge tone="neutral" surface="soft" density="compact">{meta.label}</Badge>
}
