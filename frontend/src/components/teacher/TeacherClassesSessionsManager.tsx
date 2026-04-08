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
  Loader2,
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
import { teacherApi } from '@/lib/api'
import { getTeacherAccentTheme } from '@/lib/teacherAccent'
import { useTeacherProfile } from '@/hooks/useTeacherProfile'
import { TeachersManagementModal } from '@/components/TeachersManagementModal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

function hexToRgba(hex: string, opacity: number) {
  const normalized = hex.replace('#', '')
  const full = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized
  const bigint = parseInt(full, 16)
  const r = (bigint >> 16) & 255
  const g = (bigint >> 8) & 255
  const b = bigint & 255
  return `rgba(${r}, ${g}, ${b}, ${opacity})`
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
    <div className="p-5 md:p-8">
      <div
        className="mx-auto flex max-w-[1440px] flex-col overflow-hidden rounded-[28px] border bg-white/82 shadow-sm backdrop-blur-xl lg:h-[calc(100vh-9.5rem)] lg:min-h-[720px] lg:flex-row"
        style={{
          borderColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14),
        }}
      >
        <aside
          className="w-full shrink-0 border-b bg-white/92 lg:w-[23rem] lg:border-b-0 lg:border-r"
          style={{
            borderColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14),
          }}
        >
          <div
            className="border-b px-6 py-6"
            style={{
              borderBottomColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14),
              backgroundColor: accentTheme.id === 'black' ? 'rgba(255,255,255,0.96)' : hexToRgba(accentTheme.accent, 0.08),
            }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: accentTheme.text }}>
              {entryMode === 'classes' ? 'Classi' : 'Sessioni'}
            </p>
            <h1 className="mt-2 text-xl font-semibold text-slate-900">Gestione classi</h1>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Una sola classe per volta, menu laterale stabile e gestione sessioni più leggibile.
            </p>
            <Button
              onClick={() => setShowNewClassForm((value) => !value)}
              className="mt-4 w-full justify-center rounded-xl text-white shadow-sm"
              style={{ backgroundColor: accentTheme.accent }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Nuova classe
            </Button>
          </div>

          {showNewClassForm && (
            <div className="border-b px-6 py-5" style={{ borderBottomColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14) }}>
              <form onSubmit={handleCreateClass} className="space-y-3">
                <Input
                  placeholder="es. 3A Informatica - A.S. 2025/26"
                  value={newClassName}
                  onChange={(e) => setNewClassName(e.target.value)}
                  className="border-white/0 bg-white"
                />
                <select
                  value={newClassGrade}
                  onChange={(e) => setNewClassGrade(e.target.value)}
                  className="h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm focus:outline-none"
                >
                  {SCHOOL_GRADE_OPTIONS.map((grade) => (
                    <option key={grade} value={grade}>{grade}</option>
                  ))}
                </select>
                <div className="flex items-center gap-2">
                  <Button type="submit" disabled={createClassMutation.isPending || !newClassName.trim()} className="rounded-xl text-white" style={{ backgroundColor: accentTheme.accent }}>
                    {createClassMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Crea
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setShowNewClassForm(false)}>
                    Annulla
                  </Button>
                </div>
              </form>
            </div>
          )}

          <div className="px-6 py-5">
            <div
              className="grid grid-cols-3 gap-2 rounded-[22px] border p-3"
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

          <div className="max-h-[28rem] overflow-y-auto px-4 pb-5 lg:max-h-[calc(100%-18rem)]">
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
                      className="w-full rounded-[22px] border px-4 py-4 text-left transition-all hover:shadow-sm"
                      style={isSelected ? {
                        borderColor: accentTheme.id === 'black' ? hexToRgba('#ffffff', 0.12) : hexToRgba(accentTheme.accent, 0.16),
                        backgroundColor: accentTheme.id === 'black' ? 'rgba(255,255,255,0.96)' : hexToRgba(accentTheme.accent, 0.1),
                      } : {
                        borderColor: 'rgba(255,255,255,0)',
                        backgroundColor: 'rgba(255,255,255,0.72)',
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
                          style={{
                            backgroundColor: isShared ? 'rgba(34,211,238,0.12)' : hexToRgba(accentTheme.accent, 0.12),
                            color: isShared ? '#0891b2' : accentTheme.text,
                          }}
                        >
                          <School className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold text-slate-800">{cls.name}</span>
                            <ChevronRight className={`h-4 w-4 shrink-0 text-slate-300 transition-transform ${isSelected ? 'translate-x-0.5' : ''}`} />
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{cls.school_grade || 'Grado non impostato'}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                            <span className="rounded-full bg-white/85 px-2 py-0.5 font-medium text-slate-500">
                              {cls.session_count || 0} sessioni
                            </span>
                            <span className={`rounded-full px-2 py-0.5 font-medium ${isShared ? 'bg-cyan-50 text-cyan-700' : 'bg-slate-100 text-slate-500'}`}>
                              {isShared ? (cls.owner_name ? `di ${cls.owner_name}` : 'Condivisa') : 'Personale'}
                            </span>
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
                className="border-b px-6 py-6 lg:px-8"
                style={{
                  borderBottomColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14),
                  backgroundColor: accentTheme.id === 'black' ? 'rgba(255,255,255,0.96)' : accentTheme.soft,
                }}
              >
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em]" style={{ color: accentTheme.text }}>
                      Classe selezionata
                    </p>
                    {isEditingClass ? (
                      <div className="mt-3 space-y-3">
                        <Input
                          value={editClassName}
                          onChange={(e) => setEditClassName(e.target.value)}
                          className="h-11 max-w-xl bg-white"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveClass()
                            if (e.key === 'Escape') setIsEditingClass(false)
                          }}
                        />
                        <select
                          value={editClassGrade}
                          onChange={(e) => setEditClassGrade(e.target.value)}
                          className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm focus:outline-none"
                        >
                          {SCHOOL_GRADE_OPTIONS.map((grade) => (
                            <option key={grade} value={grade}>{grade}</option>
                          ))}
                        </select>
                        <div className="flex items-center gap-2">
                          <Button onClick={handleSaveClass} disabled={updateClassMutation.isPending} className="rounded-xl text-white" style={{ backgroundColor: accentTheme.accent }}>
                            {updateClassMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                            Salva
                          </Button>
                          <Button variant="ghost" onClick={() => setIsEditingClass(false)}>
                            <X className="mr-2 h-4 w-4" />
                            Annulla
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <h2 className="mt-2 truncate text-2xl font-semibold text-slate-900">{selectedClass.name}</h2>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                          <span className="rounded-full px-2.5 py-1 font-medium text-slate-600" style={{ backgroundColor: 'rgba(255,255,255,0.9)' }}>
                            {selectedClass.school_grade || 'Grado non impostato'}
                          </span>
                          {selectedClass.role === 'invited' ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-cyan-100 bg-cyan-50 px-2.5 py-1 font-medium text-cyan-700">
                              <Share2 className="h-3 w-3" />
                              {selectedClass.owner_name ? `Classe di ${selectedClass.owner_name}` : 'Classe condivisa'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 font-medium text-slate-500">
                              <Users className="h-3 w-3" />
                              Classe personale
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 text-slate-400">
                            <Clock className="h-3 w-3" />
                            Creata il {new Date(selectedClass.created_at).toLocaleDateString('it-IT')}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {!isEditingClass && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button variant="outline" onClick={() => setIsEditingClass(true)} className="rounded-xl border-white/0 bg-white/85">
                        <Edit2 className="mr-2 h-4 w-4" />
                        Rinomina classe
                      </Button>
                      <Button variant="outline" onClick={() => setShowTeachersModal(true)} className="rounded-xl border-white/0 bg-white/85">
                        <UserPlus className="mr-2 h-4 w-4" />
                        Docenti
                      </Button>
                      <Button variant="outline" onClick={() => navigate(`/teacher/classes/${selectedClass.id}/uda`)} className="rounded-xl border-white/0 bg-white/85">
                        <BookOpen className="mr-2 h-4 w-4" />
                        UDA
                      </Button>
                      <Button onClick={() => {
                        setNewSessionTitle(`Lezione del ${new Date().toLocaleDateString('it-IT')}`)
                        setShowNewSessionDialog(true)
                      }} className="rounded-xl text-white shadow-sm" style={{ backgroundColor: accentTheme.accent }}>
                        <Plus className="mr-2 h-4 w-4" />
                        Nuova sessione
                      </Button>
                    </div>
                  )}
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  <MetricCard label="Sessioni aperte" value={groupedSessions.open.length} accent={accentTheme} />
                  <MetricCard label="Attive ora" value={summary.activeSessions} accent={accentTheme} />
                  <MetricCard label="In pausa" value={summary.pausedSessions} accent={accentTheme} />
                  <MetricCard label="Archivio" value={groupedSessions.archive.length} accent={accentTheme} />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-6 py-6 lg:px-8">
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
                      subtitle="Bozze, sessioni attive e sessioni in pausa della classe selezionata."
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
                      subtitle="Sessioni concluse, mantenute in una sezione separata e più leggibile."
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[24px] border bg-white p-6 shadow-xl" style={{ borderColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14) }}>
            <h3 className="text-lg font-semibold text-slate-900">Nuova sessione</h3>
            <p className="mt-1 text-sm text-slate-500">Stai lavorando su <strong>{selectedClass.name}</strong>. Dai un nome chiaro alla sessione.</p>
            <Input
              autoFocus
              value={newSessionTitle}
              onChange={(e) => setNewSessionTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateSession()
                if (e.key === 'Escape') setShowNewSessionDialog(false)
              }}
              className="mt-4 bg-white"
              placeholder="Es. Ripasso sistemi operativi"
            />
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowNewSessionDialog(false)}>
                Annulla
              </Button>
              <Button onClick={handleCreateSession} disabled={createSessionMutation.isPending} className="text-white" style={{ backgroundColor: accentTheme.accent }}>
                {createSessionMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Crea sessione
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl bg-white/85 px-3 py-3 text-center">
      <div className="text-lg font-semibold text-slate-900">{value}</div>
      <div className="text-[11px] uppercase tracking-[0.16em] text-slate-400">{label}</div>
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
    <div
      className="rounded-[20px] border px-4 py-4"
      style={{
        borderColor: accent.id === 'black' ? 'rgba(15,23,42,0.08)' : hexToRgba(accent.accent, 0.14),
        backgroundColor: accent.id === 'black' ? 'rgba(255,255,255,0.92)' : accent.soft,
      }}
    >
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  )
}

function SessionSection({
  title,
  subtitle,
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
  subtitle: string
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
    <div className="space-y-3">
      <div>
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>

      <div className="overflow-hidden rounded-[24px] border bg-white/88 shadow-sm" style={{ borderColor: accentTheme.id === 'black' ? 'rgba(15,23,42,0.08)' : hexToRgba(accentTheme.accent, 0.12) }}>
        <div className="hidden grid-cols-[minmax(0,2.2fr)_120px_120px_120px_120px_260px] gap-4 border-b px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400 lg:grid">
          <span>Sessione</span>
          <span>Stato</span>
          <span>Codice</span>
          <span>Creata</span>
          <span>Studenti</span>
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
      </div>
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

  return (
    <div className="px-5 py-4 lg:grid lg:grid-cols-[minmax(0,2.2fr)_120px_120px_120px_120px_260px] lg:items-center lg:gap-4">
      <div className="min-w-0">
        <div className="flex items-start gap-3">
          <div className="mt-1 shrink-0">
            <span className={`block h-2.5 w-2.5 rounded-full ${meta.dot} ${isActive ? 'animate-pulse' : ''}`} />
          </div>
          <div className="min-w-0">
            {editingTitleId === session.id ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  onRename(session.id)
                }}
              >
                <input
                  autoFocus
                  value={editingTitleValue}
                  onChange={(e) => setEditingTitleValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setEditingTitleId(null)
                  }}
                  className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-800 focus:outline-none"
                />
                <button type="submit" disabled={renamePending} className="rounded-md p-2 text-emerald-600 hover:bg-emerald-50">
                  {renamePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                </button>
                <button type="button" onClick={() => setEditingTitleId(null)} className="rounded-md p-2 text-slate-400 hover:bg-slate-100">
                  <X className="h-4 w-4" />
                </button>
              </form>
            ) : (
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold text-slate-800">{session.title}</span>
                <button
                  onClick={() => {
                    setEditingTitleId(session.id)
                    setEditingTitleValue(session.title)
                  }}
                  className="rounded-md p-1 text-slate-300 transition-colors hover:bg-slate-100 hover:text-slate-600"
                  title="Rinomina sessione"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400 lg:hidden">
              <span className={`rounded-full px-2 py-0.5 font-medium ${meta.tone}`}>{meta.label}</span>
              {session.join_code ? (
                <button onClick={() => onCopyCode(session.join_code)} className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-slate-600">
                  {session.join_code}
                </button>
              ) : null}
              <span>{new Date(session.created_at).toLocaleDateString('it-IT')}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 lg:mt-0">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${meta.tone}`}>{meta.label}</span>
      </div>

      <div className="mt-3 text-sm text-slate-600 lg:mt-0">
        {session.join_code ? (
          <button onClick={() => onCopyCode(session.join_code)} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 font-mono text-xs font-semibold text-slate-600 hover:bg-slate-200">
            {session.join_code}
            <Copy className="h-3 w-3" />
          </button>
        ) : (
          <span className="text-xs text-slate-300">-</span>
        )}
      </div>

      <div className="mt-3 text-sm text-slate-500 lg:mt-0">
        {new Date(session.created_at).toLocaleDateString('it-IT')}
      </div>

      <div className="mt-3 text-sm text-slate-500 lg:mt-0">
        {session.active_students_count ?? 0}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 lg:mt-0 lg:justify-start">
        {isDraft && (
          <Button size="sm" onClick={() => onStatusChange(session.id, 'active')} disabled={updatePending} className="rounded-xl text-white" style={{ backgroundColor: accentTheme.accent }}>
            <Play className="mr-1.5 h-3.5 w-3.5" />
            Avvia
          </Button>
        )}
        {isActive && (
          <>
            <Button size="sm" variant="outline" onClick={() => onStatusChange(session.id, 'paused')} disabled={updatePending} className="rounded-xl bg-white/90">
              <Pause className="mr-1.5 h-3.5 w-3.5" />
              Pausa
            </Button>
            <Button size="sm" variant="outline" onClick={() => onStatusChange(session.id, 'ended')} disabled={updatePending} className="rounded-xl border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100">
              <Square className="mr-1.5 h-3.5 w-3.5" />
              Chiudi
            </Button>
          </>
        )}
        {isPaused && (
          <Button size="sm" onClick={() => onStatusChange(session.id, 'active')} disabled={updatePending} className="rounded-xl text-white" style={{ backgroundColor: accentTheme.accent }}>
            <PlayCircle className="mr-1.5 h-3.5 w-3.5" />
            Riprendi
          </Button>
        )}
        <Link to={`/teacher/sessions/${session.id}`}>
          <Button size="sm" variant="outline" className="rounded-xl bg-white/90">
            <Eye className="mr-1.5 h-3.5 w-3.5" />
            Apri
          </Button>
        </Link>
        {isEnded && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (confirm('Eliminare definitivamente questa sessione?')) onDelete(session.id)
            }}
            disabled={deletePending}
            className="rounded-xl border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Elimina
          </Button>
        )}
      </div>
    </div>
  )
}
