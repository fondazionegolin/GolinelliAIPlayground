import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  BookOpen,
  Check,
  ChevronRight,
  Clock,
  Copy,
  Edit2,
  MonitorPlay,
  Pause,
  Plus,
  School,
  Share2,
  Square,
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
import { PASTEL_SURFACES, type PastelTone } from '@/design/themes/pastelSurfaces'
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

export default function TeacherClassesSessionsManager({
  entryMode,
}: {
  entryMode: 'classes' | 'sessions'
}) {
  const { t, i18n } = useTranslation()
  const isEnglish = i18n.resolvedLanguage?.startsWith('en') ?? false
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
  const schoolGradeOptions = [
    t('classes.grade_primary2'),
    t('classes.grade_middle'),
    t('classes.grade_high1'),
    t('classes.grade_high2'),
    t('classes.grade_university'),
  ] as const
  const statusMeta: Record<string, { label: string; tone: string; dot: string }> = {
    draft: { label: t('sessions.status_draft'), tone: 'logo-ink', dot: 'bg-[var(--logo-ink)]' },
    active: { label: t('sessions.status_active'), tone: 'logo-blue', dot: 'bg-[var(--logo-blue)]' },
    paused: { label: t('sessions.status_paused'), tone: 'logo-violet', dot: 'bg-[var(--logo-violet)]' },
    finished: { label: t('sessions.status_ended'), tone: 'logo-pink', dot: 'bg-[var(--logo-pink)]' },
    ended: { label: t('sessions.status_ended'), tone: 'logo-pink', dot: 'bg-[var(--logo-pink)]' },
  }
  const [newClassGrade, setNewClassGrade] = useState<string>(schoolGradeOptions[1])
  const [isEditingClass, setIsEditingClass] = useState(false)
  const [editClassName, setEditClassName] = useState('')
  const [editClassGrade, setEditClassGrade] = useState<string>(schoolGradeOptions[1])
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
    setEditClassGrade(selectedClass.school_grade || schoolGradeOptions[1])
  }, [selectedClass, schoolGradeOptions])

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
      setNewClassGrade(schoolGradeOptions[1])
      setShowNewClassForm(false)
      const nextId = res.data.id
      setSelectedClassId(nextId)
      setSearchParams({ class: nextId }, { replace: true })
      toast({ title: t('classes.created_success') })
    },
    onError: () => {
      toast({ title: t('classes.create_error'), variant: 'destructive' })
    },
  })

  const updateClassMutation = useMutation({
    mutationFn: (data: { id: string; name: string; school_grade?: string }) =>
      teacherApi.updateClass(data.id, { name: data.name, school_grade: data.school_grade }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setIsEditingClass(false)
      toast({ title: t('classes.class_updated') })
    },
  })

  const createSessionMutation = useMutation({
    mutationFn: (data: { classId: string; title: string }) => teacherApi.createSession(data.classId, { title: data.title }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['sessions', selectedClassId] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setShowNewSessionDialog(false)
      setNewSessionTitle('')
      toast({ title: t('sessions.created') })
      navigate(`/teacher/sessions/${res.data.id}`)
    },
  })

  const updateSessionMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => teacherApi.updateSession(id, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', selectedClassId] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      toast({ title: t('sessions.status_updated') })
    },
  })

  const renameSessionMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => teacherApi.updateSession(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', selectedClassId] })
      setEditingTitleId(null)
      setEditingTitleValue('')
      toast({ title: isEnglish ? 'Session name updated' : 'Nome sessione aggiornato' })
    },
  })

  const orderedSessions = useMemo(() => {
    const sorted = [...sessions].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return [
      ...sorted.filter((session) => session.status === 'active'),
      ...sorted.filter((session) => session.status !== 'active'),
    ]
  }, [sessions])

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
      editClassGrade === (selectedClass.school_grade || schoolGradeOptions[1])
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
    const title = newSessionTitle.trim() || `${isEnglish ? 'Lesson of' : 'Lezione del'} ${new Date().toLocaleDateString(isEnglish ? 'en-GB' : 'it-IT')}`
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
    toast({ title: t('sessions.code_copied') })
  }

  const emptyTitle = entryMode === 'classes' ? t('classes.empty_title') : (isEnglish ? 'No class selected' : 'Nessuna classe selezionata')
  const emptyBody = entryMode === 'classes'
    ? t('classes.empty_body')
    : (isEnglish ? 'Select a class from the side menu to manage its sessions.' : 'Seleziona una classe dal menu laterale per gestire le sessioni in modo ordinato.')

  return (
    <div className="h-full w-full">
      <div
        className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-white lg:min-h-[680px] lg:flex-row"
        style={{
          borderColor: accentTheme.id === 'black' ? hexToRgba('#94a3b8', 0.28) : hexToRgba(accentTheme.accent, 0.2),
        }}
      >
        <aside
          className="w-full shrink-0 border-b bg-white lg:w-[22rem] lg:border-b-0 lg:border-r"
          style={{
            borderColor: accentTheme.id === 'black' ? hexToRgba('#94a3b8', 0.28) : hexToRgba(accentTheme.accent, 0.2),
          }}
        >
          <div
            className="border-b px-5 py-4"
            style={{
              borderBottomColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14),
              backgroundColor: accentTheme.id === 'black' ? 'rgba(255,255,255,0.92)' : hexToRgba(accentTheme.accent, 0.05),
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="max-w-[14rem]">
                <p className="text-[11px] font-semibold tracking-[0.08em]" style={{ color: accentTheme.text }}>
                  {isEnglish ? 'Teacher panel' : 'Pannello docente'}
                </p>
                <h1 className="mt-1 text-[17px] font-semibold tracking-[var(--letter-spacing-tight)] text-slate-950">{t('classes.title')}</h1>
                <p className="mt-1 text-[12px] leading-5 text-slate-600">
                  {isEnglish
                    ? 'Organise classes, invited teachers, and live sessions without leaving this view.'
                    : 'Organizza classi, docenti invitati e sessioni live senza uscire da questa vista.'}
                </p>
              </div>
              <Button
                onClick={() => setShowNewClassForm((value) => !value)}
                density="compact"
                tone="accent"
                surface="solid"
                className="shrink-0 rounded-lg"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {t('classes.new_class')}
              </Button>
            </div>
          </div>

          {showNewClassForm && (
            <div className="border-b px-6 py-5" style={{ borderBottomColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14) }}>
              <form onSubmit={handleCreateClass} className="space-y-3">
                <Input
                  placeholder={t('classes.class_name_placeholder')}
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
                  {schoolGradeOptions.map((grade) => (
                    <option key={grade} value={grade}>{grade}</option>
                  ))}
                </Select>
                <div className="flex items-center gap-2">
                  <Button type="submit" disabled={createClassMutation.isPending || !newClassName.trim()} tone="accent" surface="solid" className="rounded-lg">
                    {createClassMutation.isPending ? <Spinner className="mr-2" size="sm" tone="inverse" /> : null}
                    {t('classes.create_class')}
                  </Button>
                  <Button type="button" surface="ghost" tone="neutral" onClick={() => setShowNewClassForm(false)}>
                    {t('classes.cancel')}
                  </Button>
                </div>
              </form>
            </div>
          )}

          <div className="max-h-[28rem] overflow-y-auto px-3 pb-4 lg:max-h-[calc(100%-10rem)]">
            {isClassesLoading ? (
              <div className="space-y-3 px-2">
                {[1, 2, 3].map((item) => (
                  <div key={item} className="h-20 animate-pulse rounded-xl border border-slate-200 bg-white/80" />
                ))}
              </div>
            ) : classes.length === 0 ? (
              <EmptyStateCard
                icon={<School className="h-8 w-8 text-slate-300" />}
                title={emptyTitle}
                body={emptyBody}
                compact
              />
            ) : (
              <div className="space-y-2">
                {classes.map((cls) => {
                  const isSelected = cls.id === selectedClassId
                  const isShared = cls.role === 'invited'
                  const selectedCardStyle = {
                    backgroundColor: hexToRgba(accentTheme.accent, 0.08),
                    borderColor: hexToRgba(accentTheme.accent, 0.36),
                  }
                  const selectedIconStyle = {
                    backgroundColor: hexToRgba(accentTheme.accent, 0.14),
                    color: accentTheme.text,
                  }
                  const selectedPillStyle = {
                    backgroundColor: hexToRgba(accentTheme.accent, 0.12),
                    color: accentTheme.text,
                  }
                  return (
                    <button
                      key={cls.id}
                      onClick={() => handleSelectClass(cls.id)}
                      className={`group relative w-full overflow-hidden rounded-lg border px-3 py-3 text-left transition-all ${
                        isSelected
                          ? ''
                          : isShared
                            ? ''
                            : 'bg-white border-slate-300 hover:border-slate-400'
                      }`}
                      style={isSelected ? selectedCardStyle : isShared ? {
                        backgroundColor: hexToRgba(accentTheme.accent, 0.06),
                        borderColor: hexToRgba(accentTheme.accent, 0.22),
                      } : undefined}
                    >
                      <div className="flex items-start gap-2.5">
                        <div
                          className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                            isShared ? '' : isSelected ? '' : 'bg-slate-100 text-slate-600'
                          }`}
                          style={isSelected ? selectedIconStyle : isShared ? selectedIconStyle : undefined}
                        >
                          <School className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="block truncate text-sm font-semibold tracking-[-0.01em] text-slate-900">{cls.name}</span>
                              <span className="mt-1 block text-xs text-slate-500">{cls.school_grade || t('classes.not_set')}</span>
                            </div>
                            <ChevronRight className={`mt-1 h-4 w-4 shrink-0 text-slate-300 transition-transform ${isSelected ? 'translate-x-0.5' : 'group-hover:translate-x-0.5'}`} />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
                            <span className={`rounded-full px-2 py-0.5 font-medium ${
                              isShared ? '' : isSelected ? '' : 'bg-slate-100 text-slate-600'
                            }`} style={isSelected || isShared ? selectedPillStyle : undefined}>
                              {cls.session_count || 0} {isEnglish ? 'sessions' : 'sessioni'}
                            </span>
                            {isShared && (
                              <span
                                className="rounded-full px-2 py-0.5 font-medium ring-1"
                                style={{
                                  backgroundColor: hexToRgba(accentTheme.accent, 0.08),
                                  color: accentTheme.text,
                                  borderColor: hexToRgba(accentTheme.accent, 0.18),
                                }}
                              >
                                {cls.owner_name ? (isEnglish ? `by ${cls.owner_name}` : `di ${cls.owner_name}`) : (isEnglish ? 'Shared' : 'Condivisa')}
                              </span>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); navigate(`/teacher/classes/${cls.id}/uda`) }}
                              title={isEnglish ? 'Teaching Units (UDA)' : 'Unità Didattiche (UDA)'}
                              className="ml-auto flex items-center gap-1 rounded-full px-2 py-0.5 font-medium text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <BookOpen className="h-3 w-3" />
                              <span>UDA</span>
                            </button>
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

        <section className="min-w-0 flex-1 bg-white">
          {!selectedClass ? (
            <div className="flex h-full min-h-[420px] items-center justify-center px-6">
              <div className="w-full max-w-lg">
                <EmptyStateCard
                  icon={<Users className="h-7 w-7 text-slate-400" />}
                  title={emptyTitle}
                  body={emptyBody}
                />
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col">
              <div
                className="border-b px-5 py-4"
                style={{
                  borderBottomColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14),
                  backgroundColor: accentTheme.id === 'black' ? 'rgba(255,255,255,0.96)' : hexToRgba(accentTheme.accent, 0.04),
                }}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold tracking-[0.08em]" style={{ color: accentTheme.text }}>
                      {isEnglish ? 'Selected class' : 'Classe selezionata'}
                    </p>
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
                          {schoolGradeOptions.map((grade) => (
                            <option key={grade} value={grade}>{grade}</option>
                          ))}
                        </Select>
                        <IconButton onClick={handleSaveClass} disabled={updateClassMutation.isPending} title={isEnglish ? 'Save' : 'Salva'} tone="success" surface="ghost" size="default">
                          {updateClassMutation.isPending ? <Spinner size="sm" tone="success" /> : <Check className="h-4 w-4" />}
                        </IconButton>
                        <IconButton onClick={() => setIsEditingClass(false)} title={t('classes.cancel')} tone="neutral" surface="ghost" size="default">
                          <X className="h-4 w-4" />
                        </IconButton>
                      </div>
                    ) : (
                      <div className="mt-1">
                        <h2 className="truncate text-[20px] font-semibold leading-[1.1] tracking-[var(--letter-spacing-tight)] text-slate-950">
                          {selectedClass.name}
                        </h2>
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="rounded-full bg-white px-2 py-0.5 font-medium text-slate-600 ring-1 ring-slate-200/80">
                            {selectedClass.school_grade || '—'}
                          </span>
                          {selectedClass.role === 'invited' && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ring-1"
                              style={{
                                backgroundColor: hexToRgba(accentTheme.accent, 0.08),
                                color: accentTheme.text,
                                borderColor: hexToRgba(accentTheme.accent, 0.18),
                              }}
                            >
                              <Share2 className="h-2.5 w-2.5" />
                              {selectedClass.owner_name ? (isEnglish ? `by ${selectedClass.owner_name}` : `di ${selectedClass.owner_name}`) : (isEnglish ? 'Shared' : 'Condivisa')}
                            </span>
                          )}
                          <span className="text-slate-500">
                            <Clock className="mr-0.5 inline h-2.5 w-2.5" />
                            {new Date(selectedClass.created_at).toLocaleDateString(isEnglish ? 'en-GB' : 'it-IT')}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {!isEditingClass && (
                    <div className="flex shrink-0 items-center gap-2 self-start sm:pt-0.5">
                      <IconButton onClick={() => setIsEditingClass(true)} title={isEnglish ? 'Rename class' : 'Rinomina classe'} tone="neutral" surface="outline" size="default">
                        <Edit2 className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton onClick={() => setShowTeachersModal(true)} title={isEnglish ? 'Manage teachers' : 'Gestisci docenti'} tone="neutral" surface="outline" size="default">
                        <UserPlus className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton onClick={() => navigate(`/teacher/classes/${selectedClass.id}/uda`)} title="UDA" tone="neutral" surface="outline" size="default">
                        <BookOpen className="h-3.5 w-3.5" />
                      </IconButton>
                      <Button
                        density="compact"
                        tone="accent"
                        surface="solid"
                        onClick={() => {
                          setNewSessionTitle(`${isEnglish ? 'Lesson of' : 'Lezione del'} ${new Date().toLocaleDateString(isEnglish ? 'en-GB' : 'it-IT')}`)
                          setShowNewSessionDialog(true)
                        }}
                        className="rounded-lg"
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        {t('sessions.new_session')}
                      </Button>
                    </div>
                  )}
                </div>

              </div>

              <div className="flex-1 overflow-y-auto px-5 py-4">
                {isSessionsLoading ? (
                  <div className="space-y-4">
                    {[1, 2, 3].map((item) => (
                      <div key={item} className="h-32 animate-pulse rounded-xl border border-slate-200 bg-white/80" />
                    ))}
                  </div>
                ) : sessions.length === 0 ? (
                  <EmptyStateCard
                    icon={<MonitorPlay className="h-10 w-10 text-slate-300" />}
                    title={t('sessions.empty_title')}
                    body={isEnglish ? 'This class does not have any sessions yet. Create a new one from the top panel.' : 'Questa classe non ha ancora sessioni. Aprine una nuova dal pannello in alto.'}
                    tone="slate"
                  />
                ) : (
                  <SessionList
                    isEnglish={isEnglish}
                    statusMeta={statusMeta}
                    sessions={orderedSessions}
                    editingTitleId={editingTitleId}
                    editingTitleValue={editingTitleValue}
                    setEditingTitleId={setEditingTitleId}
                    setEditingTitleValue={setEditingTitleValue}
                    onRename={handleRenameSession}
                    onCopyCode={copyCode}
                    renamePending={renameSessionMutation.isPending}
                    updatePending={updateSessionMutation.isPending}
                    onStatusChange={(id, status) => updateSessionMutation.mutate({ id, status })}
                  />
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
            className="rounded-xl"
            style={{ borderColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14) }}
          >
            <DialogHeader>
              <DialogTitle>{t('sessions.new_session')}</DialogTitle>
              <DialogDescription>
                {isEnglish
                  ? <>You are working on <strong>{selectedClass.name}</strong>. Give the session a clear name.</>
                  : <>Stai lavorando su <strong>{selectedClass.name}</strong>. Dai un nome chiaro alla sessione.</>}
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
                placeholder={t('sessions.title_placeholder')}
              />
            </DialogBody>
            <DialogFooter>
              <Button surface="ghost" tone="neutral" onClick={() => setShowNewSessionDialog(false)}>
                {t('classes.cancel')}
              </Button>
              <Button onClick={handleCreateSession} disabled={createSessionMutation.isPending} tone="accent" surface="solid">
                {createSessionMutation.isPending ? <Spinner className="mr-2" size="sm" tone="inverse" /> : null}
                {t('sessions.create_btn')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

function EmptyStateCard({
  icon,
  title,
  body,
  compact = false,
  tone = 'slate',
}: {
  icon: React.ReactNode
  title: string
  body: string
  compact?: boolean
  tone?: PastelTone
}) {
  const iconToneClass =
    tone === 'cyan' || tone === 'blue' || tone === 'sky' || tone === 'teal' ? 'bg-[var(--logo-blue)] text-white' :
    tone === 'violet' || tone === 'amber' || tone === 'orange' ? 'bg-[var(--logo-violet)] text-white' :
    tone === 'rose' || tone === 'indigo' || tone === 'emerald' ? 'bg-[var(--logo-pink)] text-white' :
    'bg-[var(--logo-ink)] text-white'

  return (
    <Card
      surface="base"
      className={`${compact
        ? 'rounded-xl px-5 py-8 text-center'
        : 'rounded-2xl px-8 py-14 text-center'} ${PASTEL_SURFACES[tone]}`}
    >
      <div className={`mx-auto flex h-12 w-12 items-center justify-center rounded-xl ${iconToneClass}`}>
        {icon}
      </div>
      <h3 className="mt-4 text-lg font-semibold tracking-[var(--letter-spacing-tight)] text-slate-950">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{body}</p>
    </Card>
  )
}

function SessionList({
  isEnglish,
  statusMeta,
  sessions,
  editingTitleId,
  editingTitleValue,
  setEditingTitleId,
  setEditingTitleValue,
  onRename,
  onCopyCode,
  renamePending,
  updatePending,
  onStatusChange,
}: {
  isEnglish: boolean
  statusMeta: Record<string, { label: string; tone: string; dot: string }>
  sessions: SessionData[]
  editingTitleId: string | null
  editingTitleValue: string
  setEditingTitleId: (value: string | null) => void
  setEditingTitleValue: (value: string) => void
  onRename: (id: string) => void
  onCopyCode: (code?: string) => void
  renamePending: boolean
  updatePending: boolean
  onStatusChange: (id: string, status: string) => void
}) {
  if (sessions.length === 0) return null
  const activeCount = sessions.filter((session) => session.status === 'active').length
  const compactCount = sessions.length - activeCount

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1 px-0.5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h3 className="text-base font-semibold tracking-[var(--letter-spacing-tight)] text-slate-950">
            {isEnglish ? 'Sessions' : 'Sessioni'}
          </h3>
          <p className="text-xs text-slate-500">
            {activeCount > 0
              ? (isEnglish
                  ? `${activeCount} active expanded, ${compactCount} in compact list`
                  : `${activeCount} attiva in evidenza, ${compactCount} in elenco compatto`)
              : (isEnglish
                  ? `${sessions.length} sessions in compact list`
                  : `${sessions.length} sessioni in elenco compatto`)}
          </p>
        </div>
        <p className="text-[11px] font-medium text-slate-400">
          {isEnglish ? 'Click a row to open configuration' : 'Clicca una riga per aprire la configurazione'}
        </p>
      </div>

      <div className="space-y-2">
        {sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            editingTitleId={editingTitleId}
            editingTitleValue={editingTitleValue}
            setEditingTitleId={setEditingTitleId}
            setEditingTitleValue={setEditingTitleValue}
            onRename={onRename}
            onCopyCode={onCopyCode}
            renamePending={renamePending}
            updatePending={updatePending}
            onStatusChange={onStatusChange}
            statusMeta={statusMeta}
            isEnglish={isEnglish}
          />
        ))}
      </div>
    </div>
  )
}

function SessionRow({
  session,
  editingTitleId,
  editingTitleValue,
  setEditingTitleId,
  setEditingTitleValue,
  onRename,
  onCopyCode,
  renamePending,
  updatePending,
  onStatusChange,
  statusMeta,
  isEnglish,
}: {
  session: SessionData
  editingTitleId: string | null
  editingTitleValue: string
  setEditingTitleId: (value: string | null) => void
  setEditingTitleValue: (value: string) => void
  onRename: (id: string) => void
  onCopyCode: (code?: string) => void
  renamePending: boolean
  updatePending: boolean
  onStatusChange: (id: string, status: string) => void
  statusMeta: Record<string, { label: string; tone: string; dot: string }>
  isEnglish: boolean
}) {
  const meta = statusMeta[session.status] || statusMeta.draft
  const isActive = session.status === 'active'
  const isPaused = session.status === 'paused'
  const isDraft = session.status === 'draft'
  const isEnded = session.status === 'finished' || session.status === 'ended'

  const navigate = useNavigate()
  const createdAt = new Date(session.created_at).toLocaleDateString(isEnglish ? 'en-GB' : 'it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })

  if (isActive) {
    return (
      <Card
        surface="base"
        className="cursor-pointer overflow-hidden rounded-xl border border-[rgba(62,169,244,0.34)] bg-[rgba(62,169,244,0.08)] px-4 py-4 shadow-sm transition-all hover:border-[rgba(62,169,244,0.52)]"
        onClick={() => navigate(`/teacher/sessions/${session.id}`)}
      >
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1" onClick={e => e.stopPropagation()}>
              <div className="flex items-start gap-2.5">
                <div className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${meta.dot} animate-pulse shadow-sm shadow-[rgba(62,169,244,0.34)]`} />
                <div className="min-w-0 flex-1">
                  {editingTitleId === session.id ? (
                    <form className="flex min-w-0 flex-1 items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); onRename(session.id) }}>
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
                    <>
                      <div className="flex min-w-0 items-center gap-2">
                        <h4 className="truncate text-[18px] font-semibold tracking-[-0.01em] text-slate-950">{session.title}</h4>
                        <StatusBadge meta={meta} />
                        <IconButton
                          onClick={() => { setEditingTitleId(session.id); setEditingTitleValue(session.title) }}
                          className="shrink-0"
                          tone="neutral"
                          surface="ghost"
                          size="sm"
                          title={isEnglish ? 'Rename' : 'Rinomina'}
                        >
                          <Edit2 className="h-3 w-3" />
                        </IconButton>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-600">
                        <span>{createdAt}</span>
                        <span>{session.active_students_count ?? 0} {isEnglish ? 'active students' : 'studenti attivi'}</span>
                        {session.join_code ? (
                          <Button
                            onClick={() => onCopyCode(session.join_code)}
                            tone="neutral"
                            surface="soft"
                            density="compact"
                            className="inline-flex items-center gap-1 rounded-md font-mono text-[11px] font-semibold text-slate-700"
                          >
                            {session.join_code}
                            <Copy className="h-2.5 w-2.5" />
                          </Button>
                        ) : (
                          <span className="text-slate-400">{isEnglish ? 'Code unavailable' : 'Codice non disponibile'}</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2" onClick={e => e.stopPropagation()}>
              <Button tone="accent" surface="solid" density="compact" className="rounded-md" onClick={() => navigate(`/teacher/sessions/${session.id}`)}>
                <ChevronRight className="mr-1.5 h-3.5 w-3.5" />
                {isEnglish ? 'Configure session' : 'Configura sessione'}
              </Button>
            </div>
          </div>

          <div className="border-t border-[rgba(62,169,244,0.20)] pt-3" onClick={e => e.stopPropagation()}>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => onStatusChange(session.id, 'paused')} disabled={updatePending} tone="neutral" surface="outline" density="compact" className="rounded-md bg-white/80">
                <Pause className="mr-1.5 h-3.5 w-3.5" />
                {isEnglish ? 'Pause' : 'Pausa'}
              </Button>
              <Button onClick={() => onStatusChange(session.id, 'ended')} disabled={updatePending} tone="danger" surface="soft" density="compact" className="rounded-md">
                <Square className="mr-1.5 h-3.5 w-3.5" />
                {isEnglish ? 'Close' : 'Chiudi'}
              </Button>
            </div>
          </div>
        </div>
      </Card>
    )
  }

  // Compact row for non-active sessions — still shows control buttons
  return (
    <div className="group overflow-hidden rounded-lg border border-slate-200 bg-white transition-all hover:border-slate-300 hover:shadow-sm">
      <div
        className="grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2.5"
        onClick={() => navigate(`/teacher/sessions/${session.id}`)}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">{session.title}</span>
            <StatusBadge meta={meta} />
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 text-[11px] text-slate-500">
            <span>{createdAt}</span>
            <span>{session.active_students_count ?? 0} {isEnglish ? 'students' : 'studenti'}</span>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-slate-500" />
      </div>

      {!isEnded && (
        <div
          className="flex items-center gap-1.5 border-t border-slate-100 px-3 py-2"
          onClick={e => e.stopPropagation()}
        >
          {isPaused && (
            <Button
              onClick={() => onStatusChange(session.id, 'active')}
              disabled={updatePending}
              tone="accent"
              surface="soft"
              density="compact"
              className="rounded-md text-[11px]"
            >
              <MonitorPlay className="mr-1 h-3 w-3" />
              {isEnglish ? 'Resume' : 'Riprendi'}
            </Button>
          )}
          {isDraft && (
            <Button
              onClick={() => onStatusChange(session.id, 'active')}
              disabled={updatePending}
              tone="accent"
              surface="soft"
              density="compact"
              className="rounded-md text-[11px]"
            >
              <MonitorPlay className="mr-1 h-3 w-3" />
              {isEnglish ? 'Activate' : 'Attiva'}
            </Button>
          )}
          <Button
            onClick={() => onStatusChange(session.id, 'ended')}
            disabled={updatePending}
            tone="danger"
            surface="ghost"
            density="compact"
            className="rounded-md text-[11px]"
          >
            <Square className="mr-1 h-3 w-3" />
            {isEnglish ? 'Close' : 'Chiudi'}
          </Button>
        </div>
      )}
    </div>
  )
}

function StatusBadge({ meta }: { meta: { label: string; tone: string } }) {
  if (meta.tone.includes('blue')) {
    return <Badge tone="success" surface="soft" density="compact">{meta.label}</Badge>
  }
  if (meta.tone.includes('violet')) {
    return <Badge tone="warning" surface="soft" density="compact">{meta.label}</Badge>
  }
  if (meta.tone.includes('pink')) {
    return <Badge tone="danger" surface="soft" density="compact">{meta.label}</Badge>
  }
  return <Badge tone="neutral" surface="soft" density="compact">{meta.label}</Badge>
}
