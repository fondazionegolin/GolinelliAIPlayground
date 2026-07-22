import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Check,
  Archive,
  ChevronRight,
  Clock,
  Copy,
  Edit2,
  FileText,
  LayoutGrid,
  List,
  MonitorPlay,
  Pause,
  Plus,
  RotateCcw,
  School,
  Search,
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
import { PASTEL_ICON_BACKGROUNDS, PASTEL_ICON_TEXT, PASTEL_SURFACES, type PastelTone } from '@/design/themes/pastelSurfaces'
import { useTeacherProfile } from '@/hooks/useTeacherProfile'
import { TeachersManagementModal } from '@/components/TeachersManagementModal'
import { InvitationsPanel } from '@/components/InvitationsPanel'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/stores/auth'

interface ClassData {
  id: string
  name: string
  school_grade?: string | null
  created_at: string
  session_count?: number
  role?: 'owner' | 'invited'
  owner_name?: string
  archived_at?: string | null
  school_tenant_id?: string | null
  school_name?: string | null
}

interface SchoolData { id: string; name: string; slug: string }

interface SessionData {
  id: string
  class_id: string
  created_by_teacher_id?: string | null
  title: string
  join_code?: string
  status: 'draft' | 'active' | 'paused' | 'finished' | 'ended'
  created_at: string
  active_students_count?: number
  deleted_at?: string | null
  deleted_by_id?: string | null
  purge_after?: string | null
}

export interface TeacherCurrentSession {
  id: string
  name: string
  className: string
  joinCode?: string
}

interface CurrentSessionLiveData {
  session: {
    id: string
    class_id: string
    title: string
    join_code?: string
    status: SessionData['status']
    class_name: string
  }
  students?: unknown[]
}

export default function TeacherClassesSessionsManager({
  entryMode,
  currentSession,
}: {
  entryMode: 'classes' | 'sessions'
  currentSession?: TeacherCurrentSession | null
}) {
  const { t, i18n } = useTranslation()
  const isEnglish = i18n.resolvedLanguage?.startsWith('en') ?? false
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: teacherProfile } = useTeacherProfile()
  const currentTeacherId = useAuthStore((state) => state.user?.id)
  // The selected class keeps a neutral accent; session status colours are handled separately.
  const accentTheme = { ...getTeacherAccentTheme(teacherProfile?.uiAccent), accent: '#64748b', text: '#334155' }

  const [selectedClassId, setSelectedClassId] = useState(searchParams.get('class') || '')
  const [showNewClassForm, setShowNewClassForm] = useState(false)
  const [showTeachersModal, setShowTeachersModal] = useState(false)
  const [classSearch, setClassSearch] = useState('')
  const [sessionSearch, setSessionSearch] = useState('')
  const [newClassName, setNewClassName] = useState('')
  const schoolGradeOptions = useMemo(() => [
    t('classes.grade_primary2'),
    t('classes.grade_middle'),
    t('classes.grade_high1'),
    t('classes.grade_high2'),
    t('classes.grade_university'),
  ], [t])
  const statusMeta: Record<string, { label: string; tone: string; dot: string }> = {
    draft: { label: t('sessions.status_draft'), tone: 'logo-ink', dot: 'bg-[var(--logo-ink)]' },
    active: { label: t('sessions.status_active'), tone: 'logo-violet', dot: 'bg-[var(--logo-violet)]' },
    paused: { label: t('sessions.status_paused'), tone: 'logo-pink', dot: 'bg-[var(--logo-pink)]' },
    finished: { label: t('sessions.status_ended'), tone: 'logo-pink', dot: 'bg-[var(--logo-pink)]' },
    ended: { label: t('sessions.status_ended'), tone: 'logo-pink', dot: 'bg-[var(--logo-pink)]' },
  }
  const [newClassGrade, setNewClassGrade] = useState<string>(schoolGradeOptions[1])
  const [newClassSchoolId, setNewClassSchoolId] = useState('')
  const [isEditingClass, setIsEditingClass] = useState(false)
  const [editClassName, setEditClassName] = useState('')
  const [editClassGrade, setEditClassGrade] = useState<string>(schoolGradeOptions[1])
  const [showNewSessionDialog, setShowNewSessionDialog] = useState(false)
  const [newSessionTitle, setNewSessionTitle] = useState('')
  const [sessionToTrash, setSessionToTrash] = useState<SessionData | null>(null)
  const [sessionToPermanentlyDelete, setSessionToPermanentlyDelete] = useState<SessionData | null>(null)
  const [showArchivedClasses, setShowArchivedClasses] = useState(false)
  const [editingTitleId, setEditingTitleId] = useState<string | null>(null)
  const [editingTitleValue, setEditingTitleValue] = useState('')
  const [sessionViewMode, setSessionViewMode] = useState<'grid' | 'list'>(() =>
    window.localStorage.getItem('teacher-session-view-mode') === 'list' ? 'list' : 'grid'
  )

  useEffect(() => {
    window.localStorage.setItem('teacher-session-view-mode', sessionViewMode)
  }, [sessionViewMode])

  const { data: allClasses = [], isLoading: isClassesLoading } = useQuery<ClassData[]>({
    queryKey: ['classes'],
    queryFn: async () => (await teacherApi.getClasses({ include_archived: true })).data,
  })
  const { data: teacherSchools = [] } = useQuery<SchoolData[]>({
    queryKey: ['teacher-schools'],
    queryFn: async () => (await teacherApi.getSchools()).data,
  })
  const classes = useMemo(() => allClasses.filter(cls => !cls.archived_at), [allClasses])
  const archivedClasses = useMemo(() => allClasses.filter(cls => cls.archived_at && cls.role === 'owner'), [allClasses])

  useEffect(() => {
    if (!newClassSchoolId && teacherSchools.length === 1) setNewClassSchoolId(teacherSchools[0].id)
  }, [newClassSchoolId, teacherSchools])

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
    if (!selectedClass || isEditingClass) return
    setEditClassName(selectedClass.name)
    setEditClassGrade(selectedClass.school_grade || schoolGradeOptions[1])
  }, [isEditingClass, selectedClass, schoolGradeOptions])

  const { data: sessions = [], isLoading: isSessionsLoading } = useQuery<SessionData[]>({
    queryKey: ['sessions', selectedClassId],
    queryFn: async () => {
      if (!selectedClassId) return []
      return (await teacherApi.getSessions(selectedClassId, { include_deleted: true })).data
    },
    enabled: !!selectedClassId,
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
  })

  const { data: currentSessionLive } = useQuery<CurrentSessionLiveData>({
    queryKey: ['session-live', currentSession?.id],
    queryFn: async () => (await teacherApi.getSessionLive(currentSession!.id)).data,
    enabled: !!currentSession?.id,
    refetchInterval: 10000,
    refetchOnWindowFocus: false,
  })

  const createClassMutation = useMutation({
    mutationFn: (data: { name: string; school_grade?: string; school_tenant_id?: string | null }) => teacherApi.createClass(data),
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
    mutationFn: (data: { id: string; name: string; school_grade?: string; school_tenant_id?: string | null }) =>
      teacherApi.updateClass(data.id, { name: data.name, school_grade: data.school_grade, school_tenant_id: data.school_tenant_id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setIsEditingClass(false)
      toast({ title: t('classes.class_updated') })
    },
  })

  const archiveClassMutation = useMutation({
    mutationFn: (classId: string) => teacherApi.archiveClass(classId),
    onSuccess: () => {
      setSelectedClassId('')
      setSearchParams({}, { replace: true })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      toast({ title: isEnglish ? 'Class archived' : 'Classe archiviata' })
    },
    onError: (error: any) => toast({ title: error?.response?.data?.detail || 'Termina tutte le sessioni prima di archiviare la classe', variant: 'destructive' }),
  })

  const restoreClassMutation = useMutation({
    mutationFn: (classId: string) => teacherApi.restoreClass(classId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      toast({ title: isEnglish ? 'Class restored' : 'Classe ripristinata' })
    },
  })

  const permanentlyDeleteClassMutation = useMutation({
    mutationFn: (classId: string) => teacherApi.permanentlyDeleteClass(classId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      toast({ title: isEnglish ? 'Class permanently deleted' : 'Classe eliminata definitivamente' })
    },
    onError: (error: any) => toast({ title: error?.response?.data?.detail || 'Impossibile eliminare la classe', variant: 'destructive' }),
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
      queryClient.invalidateQueries({ queryKey: ['session-live'] })
      toast({ title: t('sessions.status_updated') })
    },
  })

  const trashSessionMutation = useMutation({
    mutationFn: (sessionId: string) => teacherApi.deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', selectedClassId] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setSessionToTrash(null)
      toast({ title: isEnglish ? 'Session moved to trash' : 'Sessione spostata nel cestino' })
    },
    onError: (error: any) => toast({ title: error?.response?.data?.detail || 'Impossibile archiviare la sessione', variant: 'destructive' }),
  })

  const restoreSessionMutation = useMutation({
    mutationFn: (sessionId: string) => teacherApi.restoreSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', selectedClassId] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      toast({ title: isEnglish ? 'Session restored' : 'Sessione recuperata' })
    },
    onError: (error: any) => toast({ title: error?.response?.data?.detail || 'Impossibile recuperare la sessione', variant: 'destructive' }),
  })

  const permanentlyDeleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => teacherApi.permanentlyDeleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions', selectedClassId] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setSessionToPermanentlyDelete(null)
      toast({ title: isEnglish ? 'Session permanently deleted' : 'Sessione eliminata definitivamente' })
    },
    onError: (error: any) => toast({ title: error?.response?.data?.detail || 'Impossibile eliminare la sessione', variant: 'destructive' }),
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
    const sorted = sessions
      .filter((session) => !session.deleted_at)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return [
      ...sorted.filter((session) => session.status === 'active'),
      ...sorted.filter((session) => session.status !== 'active'),
    ]
  }, [sessions])

  const trashedSessions = useMemo(() => {
    return sessions
      .filter((session) => session.deleted_at)
      .sort((a, b) => {
        const aTime = new Date(a.deleted_at || a.created_at).getTime()
        const bTime = new Date(b.deleted_at || b.created_at).getTime()
        return bTime - aTime
      })
  }, [sessions])

  const filteredClasses = useMemo(() => {
    const query = classSearch.trim().toLowerCase()
    if (!query) return classes
    return classes.filter((cls) =>
      [cls.name, cls.school_grade, cls.owner_name, cls.school_name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(query)
    )
  }, [classSearch, classes])

  const groupedClasses = useMemo(() => {
    const groups = new Map<string, { id: string; name: string; classes: ClassData[] }>()
    filteredClasses.forEach((cls) => {
      const id = cls.school_tenant_id || 'unassigned'
      const name = cls.school_name || (isEnglish ? 'No institution' : 'Senza istituto')
      const group = groups.get(id) || { id, name, classes: [] }
      group.classes.push(cls)
      groups.set(id, group)
    })
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [filteredClasses, isEnglish])

  const filteredOrderedSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase()
    const sessionsWithoutCurrent = orderedSessions.filter((session) => session.id !== currentSession?.id)
    if (!query) return sessionsWithoutCurrent
    return sessionsWithoutCurrent.filter((session) =>
      [session.title, session.join_code, statusMeta[session.status]?.label]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query)
    )
  }, [currentSession?.id, orderedSessions, sessionSearch, statusMeta])

  const handleSelectClass = (classId: string) => {
    setSelectedClassId(classId)
    setSearchParams({ class: classId }, { replace: true })
    setEditingTitleId(null)
    setIsEditingClass(false)
  }

  const handleCreateClass = (e: React.FormEvent) => {
    e.preventDefault()
    if (!newClassName.trim()) return
    createClassMutation.mutate({ name: newClassName.trim(), school_grade: newClassGrade, school_tenant_id: newClassSchoolId || null })
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
      school_tenant_id: selectedClass.school_tenant_id || null,
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
    <div className="h-full w-full bg-slate-100">
      <div
        className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-slate-100 lg:min-h-[680px] lg:flex-row"
        style={{
          borderColor: accentTheme.id === 'black' ? hexToRgba('#94a3b8', 0.28) : hexToRgba(accentTheme.accent, 0.2),
        }}
      >
        <aside
          className="w-full shrink-0 border-b bg-white/80 lg:w-[19rem] lg:border-b-0 lg:border-r"
          style={{
            borderColor: accentTheme.id === 'black' ? hexToRgba('#94a3b8', 0.28) : hexToRgba(accentTheme.accent, 0.2),
          }}
        >
          <div
            className="border-b px-5 py-4"
            style={{
              borderBottomColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14),
              backgroundColor: 'rgba(255,255,255,0.88)',
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="max-w-[14rem]">
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {isEnglish ? 'Teacher panel' : 'Pannello docente'}
                </p>
                <h1 className="mt-1 text-[17px] font-semibold tracking-[var(--letter-spacing-tight)] text-slate-950">{t('classes.title')}</h1>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  {isEnglish
                    ? 'Classes, teachers, and live sessions in one explorer.'
                    : 'Classi, docenti e sessioni live in un explorer.'}
                </p>
              </div>
              <Button
                onClick={() => setShowNewClassForm((value) => !value)}
                density="compact"
                tone="accent"
                surface="solid"
                className="h-9 w-9 shrink-0 rounded-full p-0"
                title={t('classes.new_class')}
                aria-label={t('classes.new_class')}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <InvitationsPanel />
            </div>
            <div className={`relative mt-4 rounded-2xl px-3 py-2 shadow-sm ${PASTEL_SURFACES.slate}`}>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={classSearch}
                onChange={(e) => setClassSearch(e.target.value)}
                placeholder={isEnglish ? 'Search classes...' : 'Cerca classi...'}
                className="w-full rounded-lg border-0 bg-transparent py-2 pl-9 pr-8 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-0"
              />
              {classSearch && (
                <button
                  type="button"
                  onClick={() => setClassSearch('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-600"
                  aria-label={isEnglish ? 'Clear class search' : 'Cancella ricerca classi'}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {showNewClassForm && (
            <div className="border-b px-5 py-4" style={{ borderBottomColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14) }}>
              <form onSubmit={handleCreateClass} className="space-y-3">
                <div className="space-y-1.5">
                  <label htmlFor="new-class-name" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {isEnglish ? 'Class name' : 'Nome della classe'}
                  </label>
                  <div className="relative">
                    <School className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                    <Input
                      id="new-class-name"
                      placeholder={t('classes.class_name_placeholder')}
                      value={newClassName}
                      onChange={(e) => setNewClassName(e.target.value)}
                      surface="base"
                      className="h-12 border-slate-300 bg-white pl-11 text-base font-medium shadow-sm placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
                    />
                  </div>
                  <p className="text-xs leading-5 text-slate-500">
                    {isEnglish
                      ? 'Enter the name students and teachers will see in the class list.'
                      : "Inserisci il nome che studenti e docenti vedranno nell'elenco classi."}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">{isEnglish ? 'Institution' : 'Istituto'}</label>
                  <Select value={newClassSchoolId} onChange={(e) => setNewClassSchoolId(e.target.value)} surface="base">
                    <option value="">{isEnglish ? 'No institution' : 'Senza istituto'}</option>
                    {teacherSchools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
                  </Select>
                </div>
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
                  <Button type="submit" disabled={createClassMutation.isPending || !newClassName.trim()} tone="accent" surface="solid" className="rounded-full">
                    {createClassMutation.isPending ? <Spinner className="mr-2" size="sm" tone="inverse" /> : null}
                    {t('classes.create_class')}
                  </Button>
                  <Button type="button" surface="ghost" tone="neutral" onClick={() => setShowNewClassForm(false)} className="rounded-full">
                    {t('classes.cancel')}
                  </Button>
                </div>
              </form>
            </div>
          )}

          <div className="max-h-[28rem] overflow-y-auto px-4 py-4 lg:max-h-[calc(100%-10rem)]">
            {isClassesLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((item) => (
                  <div key={item} className={`h-20 animate-pulse rounded-[18px] shadow-sm ${PASTEL_SURFACES.slate}`} />
                ))}
              </div>
            ) : classes.length === 0 ? (
              <EmptyStateCard
                icon={<School className="h-8 w-8 text-slate-300" />}
                title={emptyTitle}
                body={emptyBody}
                compact
              />
            ) : filteredClasses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Search className="mb-3 h-8 w-8 text-slate-200" />
                <p className="text-sm text-slate-400">
                  {isEnglish ? 'No class matches ' : 'Nessuna classe corrisponde a '}<strong>"{classSearch}"</strong>
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                {groupedClasses.map((group) => (
                  <section key={group.id}>
                    <div className="mb-2 flex items-center justify-between px-1">
                      <span className="flex min-w-0 items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                        <School className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{group.name}</span>
                      </span>
                      <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold text-slate-600">{group.classes.length}</span>
                    </div>
                    <div className="space-y-2">
                {group.classes.map((cls) => {
                  const isSelected = cls.id === selectedClassId
                  const isShared = cls.role === 'invited'
                  const cardTone: PastelTone = isSelected ? 'violet' : isShared ? 'indigo' : 'slate'
                  return (
                    <button
                      key={cls.id}
                      onClick={() => handleSelectClass(cls.id)}
                      className={`group relative w-full overflow-hidden rounded-[18px] p-3 text-left shadow-sm transition-all ${PASTEL_SURFACES[cardTone]} ${isSelected ? 'ring-1 ring-[rgba(123,105,201,0.32)]' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${PASTEL_ICON_BACKGROUNDS[cardTone]} ${PASTEL_ICON_TEXT[cardTone]}`}
                        >
                          <School className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <span className="block truncate text-sm font-bold text-slate-800">{cls.name}</span>
                              <span className="mt-0.5 block text-[11px] text-slate-500">{cls.school_grade || t('classes.not_set')}</span>
                            </div>
                            <ChevronRight className={`mt-1 h-4 w-4 shrink-0 text-slate-300 transition-transform ${isSelected ? 'translate-x-0.5' : 'group-hover:translate-x-0.5'}`} />
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                            <span className="rounded-full bg-white/55 px-2 py-0.5 font-bold text-slate-500 ring-1 ring-white/70">
                              {cls.session_count || 0} {isEnglish ? 'sessions' : 'sessioni'}
                            </span>
                            {isShared && (
                              <span className="rounded-full bg-white/55 px-2 py-0.5 font-bold text-slate-500 ring-1 ring-white/70">
                                {cls.owner_name ? (isEnglish ? `by ${cls.owner_name}` : `di ${cls.owner_name}`) : (isEnglish ? 'Shared' : 'Condivisa')}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>
          <button type="button" onClick={() => setShowArchivedClasses(true)} className="mx-3 mb-3 flex w-[calc(100%-1.5rem)] items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
            <span className="flex items-center gap-2"><Archive className="h-3.5 w-3.5" />{isEnglish ? 'Class archive' : 'Archivio classi'}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5">{archivedClasses.length}</span>
          </button>
        </aside>

        <section className="min-w-0 flex-1 bg-slate-100">
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
                className="border-b px-5 py-3"
                style={{
                  borderBottomColor: accentTheme.id === 'black' ? hexToRgba('#0f172a', 0.08) : hexToRgba(accentTheme.accent, 0.14),
                  backgroundColor: 'rgba(255,255,255,0.88)',
                }}
              >
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
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
                        <div className="flex min-w-0 items-center gap-1.5">
                          <h2 className="truncate text-[20px] font-semibold leading-[1.1] tracking-[var(--letter-spacing-tight)] text-slate-950">
                            {selectedClass.name}
                          </h2>
                          <IconButton
                            onClick={() => setIsEditingClass(true)}
                            title={isEnglish ? 'Rename class' : 'Rinomina classe'}
                            tone="neutral"
                            surface="ghost"
                            size="sm"
                            className="shrink-0 rounded-full"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </IconButton>
                        </div>
                        <div className="mt-2.5 flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-2 py-0.5 font-bold text-white">
                            <School className="h-2.5 w-2.5" /> {selectedClass.school_name || (isEnglish ? 'No institution' : 'Senza istituto')}
                          </span>
                          <span className="rounded-full bg-white/80 px-2 py-0.5 font-bold text-slate-600 ring-1 ring-slate-200/80">
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
                    <div className="flex shrink-0 items-center gap-1.5">
                      <IconButton onClick={() => setShowTeachersModal(true)} title={isEnglish ? 'Manage teachers' : 'Gestisci docenti'} tone="neutral" surface="soft" size="default" className="rounded-full">
                        <UserPlus className="h-3.5 w-3.5" />
                      </IconButton>
                      {selectedClass.role === 'owner' && (
                        <IconButton
                          onClick={() => {
                            if (window.confirm(`Archiviare la classe "${selectedClass.name}"? Scomparirà dalla sidebar e resterà recuperabile.`)) archiveClassMutation.mutate(selectedClass.id)
                          }}
                          disabled={archiveClassMutation.isPending}
                          title={isEnglish ? 'Archive class' : 'Archivia classe'}
                          tone="danger"
                          surface="soft"
                          size="default"
                          className="rounded-full"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </IconButton>
                      )}
                      <Button
                        density="compact"
                        tone="accent"
                        surface="solid"
                        onClick={() => {
                          setNewSessionTitle(`${isEnglish ? 'Lesson of' : 'Lezione del'} ${new Date().toLocaleDateString(isEnglish ? 'en-GB' : 'it-IT')}`)
                          setShowNewSessionDialog(true)
                        }}
                        className="h-9 w-9 rounded-full p-0"
                        title={t('sessions.new_session')}
                        aria-label={t('sessions.new_session')}
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>

              </div>

              <CurrentSessionToolbarCard
                currentSession={currentSession}
                liveData={currentSessionLive}
                isEnglish={isEnglish}
                updatePending={updateSessionMutation.isPending}
                onCopyCode={copyCode}
                onStatusChange={(id, status) => updateSessionMutation.mutate({ id, status })}
              />

              <div className="flex-1 overflow-y-auto px-5 py-5">
                {isSessionsLoading ? (
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {[1, 2, 3].map((item) => (
                      <div key={item} className={`h-44 animate-pulse rounded-[24px] shadow-sm ${PASTEL_SURFACES.slate}`} />
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
                  <div className="space-y-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className={`relative w-full max-w-sm rounded-2xl px-3 py-2 shadow-sm ${PASTEL_SURFACES.slate}`}>
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <input
                          type="text"
                          value={sessionSearch}
                          onChange={(e) => setSessionSearch(e.target.value)}
                          placeholder={isEnglish ? 'Search sessions...' : 'Cerca sessioni...'}
                          className="w-full rounded-lg border-0 bg-transparent py-2 pl-9 pr-8 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                        />
                        {sessionSearch && (
                          <button
                            type="button"
                            onClick={() => setSessionSearch('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-600"
                            aria-label={isEnglish ? 'Clear session search' : 'Cancella ricerca sessioni'}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:justify-end">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                          {filteredOrderedSessions.length} {isEnglish ? 'sessions' : 'sessioni'}
                        </p>
                        <div className="flex items-center rounded-xl border border-slate-200 bg-white p-0.5 shadow-sm" role="group" aria-label={isEnglish ? 'Session view' : 'Vista sessioni'}>
                          <button
                            type="button"
                            onClick={() => setSessionViewMode('grid')}
                            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${sessionViewMode === 'grid' ? 'bg-violet-100 text-violet-700' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'}`}
                            title={isEnglish ? 'Grid view' : 'Vista griglia'}
                            aria-pressed={sessionViewMode === 'grid'}
                          >
                            <LayoutGrid className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setSessionViewMode('list')}
                            className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${sessionViewMode === 'list' ? 'bg-violet-100 text-violet-700' : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'}`}
                            title={isEnglish ? 'List view' : 'Vista elenco'}
                            aria-pressed={sessionViewMode === 'list'}
                          >
                            <List className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                    {filteredOrderedSessions.length === 0 && trashedSessions.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-16 text-center">
                        {sessionSearch ? (
                          <>
                            <Search className="mb-3 h-8 w-8 text-slate-200" />
                            <p className="text-sm text-slate-400">
                              {isEnglish ? 'No session matches ' : 'Nessuna sessione corrisponde a '}<strong>"{sessionSearch}"</strong>
                            </p>
                          </>
                        ) : (
                          <>
                            <MonitorPlay className="mb-3 h-8 w-8 text-slate-200" />
                            <p className="text-sm text-slate-400">
                              {isEnglish ? 'There are no other sessions in this class.' : 'Non ci sono altre sessioni in questa classe.'}
                            </p>
                          </>
                        )}
                      </div>
                    ) : (
                      <>
                        <SessionList
                          isEnglish={isEnglish}
                          statusMeta={statusMeta}
                          sessions={filteredOrderedSessions}
                          editingTitleId={editingTitleId}
                          editingTitleValue={editingTitleValue}
                          setEditingTitleId={setEditingTitleId}
                          setEditingTitleValue={setEditingTitleValue}
                          onRename={handleRenameSession}
                          onCopyCode={copyCode}
                          renamePending={renameSessionMutation.isPending}
                          updatePending={updateSessionMutation.isPending}
                          onStatusChange={(id, status) => updateSessionMutation.mutate({ id, status })}
                          onTrashSession={(session) => setSessionToTrash(session)}
                          currentTeacherId={currentTeacherId}
                          viewMode={sessionViewMode}
                        />
                        {trashedSessions.length > 0 && (
                          <SessionTrash
                            isEnglish={isEnglish}
                            sessions={trashedSessions}
                            onRestore={(sessionId) => restoreSessionMutation.mutate(sessionId)}
                            onPermanentDelete={(session) => setSessionToPermanentlyDelete(session)}
                            restorePending={restoreSessionMutation.isPending}
                            permanentDeletePending={permanentlyDeleteSessionMutation.isPending}
                            currentTeacherId={currentTeacherId}
                          />
                        )}
                      </>
                    )}
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

      <Dialog open={showArchivedClasses} onOpenChange={setShowArchivedClasses}>
        <DialogContent size="md" surface="elevated" className="rounded-xl !border-slate-200 !bg-white !opacity-100 !backdrop-blur-none">
          <DialogHeader>
            <DialogTitle>{isEnglish ? 'Class archive' : 'Archivio classi'}</DialogTitle>
            <DialogDescription>{isEnglish ? 'Restore a class or permanently delete all of its sessions and related data.' : 'Ripristina una classe oppure elimina definitivamente tutte le sessioni e i dati collegati.'}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="space-y-2">
              {archivedClasses.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  {isEnglish ? 'There are no archived classes.' : 'Non ci sono classi archiviate.'}
                </div>
              )}
              {archivedClasses.map(cls => (
                <div key={cls.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">{cls.name}</p>
                    <p className="text-xs text-slate-500">{cls.archived_at ? new Date(cls.archived_at).toLocaleDateString(isEnglish ? 'en-GB' : 'it-IT') : ''}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button density="compact" tone="neutral" surface="soft" onClick={() => restoreClassMutation.mutate(cls.id)} disabled={restoreClassMutation.isPending}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />{isEnglish ? 'Restore' : 'Ripristina'}</Button>
                    <Button density="compact" tone="danger" surface="ghost" onClick={() => {
                      if (window.confirm(`ATTENZIONE: eliminare definitivamente "${cls.name}" con tutte le sessioni, consegne, chat e documenti? L’azione non è annullabile.`)) permanentlyDeleteClassMutation.mutate(cls.id)
                    }} disabled={permanentlyDeleteClassMutation.isPending}><Trash2 className="mr-1.5 h-3.5 w-3.5" />{isEnglish ? 'Delete forever' : 'Elimina tutto'}</Button>
                  </div>
                </div>
              ))}
            </div>
          </DialogBody>
          <DialogFooter><Button surface="ghost" tone="neutral" onClick={() => setShowArchivedClasses(false)}>{isEnglish ? 'Close' : 'Chiudi'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

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

      <Dialog open={!!sessionToTrash} onOpenChange={(open) => { if (!open) setSessionToTrash(null) }}>
        <DialogContent size="sm" surface="elevated" className="rounded-xl !border-slate-200 !bg-white !opacity-100 !backdrop-blur-none">
          <DialogHeader>
            <DialogTitle>{isEnglish ? 'Archive session?' : 'Archiviare la sessione?'}</DialogTitle>
            <DialogDescription>
              {isEnglish
                ? <>The session <strong>{sessionToTrash?.title}</strong> will disappear from the session cards and move to the trash.</>
                : <>La sessione <strong>{sessionToTrash?.title}</strong> scomparirà dall’elenco e verrà spostata nell’archivio.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-900">
              {isEnglish
                ? 'Session data remains recoverable for 30 days. After that, the session is permanently removed and related database records are cleaned.'
                : sessionToTrash?.status === 'ended' || sessionToTrash?.status === 'finished'
                  ? 'I dati restano recuperabili per 30 giorni. La cancellazione definitiva richiederà una seconda conferma.'
                  : 'Prima di archiviarla devi terminare la sessione. Una sessione attiva o in pausa non può essere archiviata.'}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button surface="ghost" tone="neutral" onClick={() => setSessionToTrash(null)}>
              {t('classes.cancel')}
            </Button>
            <Button
              tone="danger"
              surface="solid"
              disabled={!sessionToTrash || trashSessionMutation.isPending || !['ended', 'finished'].includes(sessionToTrash.status)}
              onClick={() => sessionToTrash && trashSessionMutation.mutate(sessionToTrash.id)}
            >
              {trashSessionMutation.isPending ? <Spinner className="mr-2" size="sm" tone="inverse" /> : <Trash2 className="mr-2 h-4 w-4" />}
              {isEnglish ? 'Archive' : 'Archivia'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!sessionToPermanentlyDelete} onOpenChange={(open) => { if (!open) setSessionToPermanentlyDelete(null) }}>
        <DialogContent size="sm" surface="elevated" className="rounded-xl !border-slate-200 !bg-white !opacity-100 !backdrop-blur-none">
          <DialogHeader>
            <DialogTitle>{isEnglish ? 'Permanently delete?' : 'Eliminare definitivamente?'}</DialogTitle>
            <DialogDescription>
              {isEnglish
                ? <>This will permanently delete <strong>{sessionToPermanentlyDelete?.title}</strong> and clean its related data.</>
                : <>La sessione <strong>{sessionToPermanentlyDelete?.title}</strong> verrà eliminata definitivamente insieme a tutti i dati collegati.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button surface="ghost" tone="neutral" onClick={() => setSessionToPermanentlyDelete(null)}>
              {t('classes.cancel')}
            </Button>
            <Button
              tone="danger"
              surface="solid"
              disabled={!sessionToPermanentlyDelete || permanentlyDeleteSessionMutation.isPending}
              onClick={() => sessionToPermanentlyDelete && permanentlyDeleteSessionMutation.mutate(sessionToPermanentlyDelete.id)}
            >
              {permanentlyDeleteSessionMutation.isPending ? <Spinner className="mr-2" size="sm" tone="inverse" /> : <Trash2 className="mr-2 h-4 w-4" />}
              {isEnglish ? 'Delete forever' : 'Elimina per sempre'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function CurrentSessionToolbarCard({
  currentSession,
  liveData,
  isEnglish,
  updatePending,
  onCopyCode,
  onStatusChange,
}: {
  currentSession?: TeacherCurrentSession | null
  liveData?: CurrentSessionLiveData
  isEnglish: boolean
  updatePending: boolean
  onCopyCode: (code?: string) => void
  onStatusChange: (id: string, status: string) => void
}) {
  const navigate = useNavigate()

  if (!currentSession) {
    return null
  }

  const session = liveData?.session
  const sessionId = session?.id || currentSession.id
  const title = session?.title || currentSession.name
  const className = session?.class_name || currentSession.className
  const joinCode = session?.join_code || currentSession.joinCode
  const status = session?.status || 'active'
  const iconButtonClass = 'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/75 text-amber-900 ring-1 ring-amber-200 transition-all hover:bg-white hover:text-amber-950 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50'

  return (
    <div className="z-10 w-full border-b border-amber-300/80 bg-amber-100/95 px-5 py-2 shadow-sm backdrop-blur">
      <div className="mx-auto flex min-w-0 max-w-6xl items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(`/teacher/sessions/${sessionId}`)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-300/70 text-amber-900">
            <MonitorPlay className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-amber-800">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {isEnglish ? 'Current session' : 'Sessione corrente'}
            </span>
            <span className="block truncate text-[13px] font-bold leading-4 text-slate-900">{title}</span>
            <span className="hidden truncate text-[9px] leading-3 text-slate-500 min-[440px]:block">
              {className}
            </span>
          </span>
        </button>

        <div className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
          {joinCode && (
            <button
              type="button"
              onClick={() => onCopyCode(joinCode)}
              className="hidden h-8 items-center gap-1 rounded-full bg-white/75 px-2 font-mono text-[9px] font-bold text-amber-900 ring-1 ring-amber-200 transition-colors hover:bg-white sm:inline-flex"
              title={isEnglish ? 'Copy access code' : 'Copia codice di accesso'}
            >
              {joinCode}
              <Copy className="h-3 w-3" />
            </button>
          )}
          <button
            type="button"
            className={iconButtonClass}
            onClick={() => navigate(`/teacher/sessions/${sessionId}`)}
            title={isEnglish ? 'Open session' : 'Apri sessione'}
            aria-label={isEnglish ? 'Open session' : 'Apri sessione'}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <button
            type="button"
            className={iconButtonClass}
            onClick={() => navigate(`/teacher/sessions/${sessionId}?tab=documents`)}
            title={isEnglish ? 'Session documents' : 'Documenti della sessione'}
            aria-label={isEnglish ? 'Session documents' : 'Documenti della sessione'}
          >
            <FileText className="h-3.5 w-3.5" />
          </button>
          {status === 'active' ? (
            <button
              type="button"
              className={iconButtonClass}
              disabled={updatePending}
              onClick={() => onStatusChange(sessionId, 'paused')}
              title={isEnglish ? 'Pause session' : 'Metti in pausa'}
              aria-label={isEnglish ? 'Pause session' : 'Metti in pausa'}
            >
              <Pause className="h-3.5 w-3.5" />
            </button>
          ) : (status === 'paused' || status === 'draft') ? (
            <button
              type="button"
              className={iconButtonClass}
              disabled={updatePending}
              onClick={() => onStatusChange(sessionId, 'active')}
              title={status === 'paused' ? (isEnglish ? 'Resume session' : 'Riprendi sessione') : (isEnglish ? 'Activate session' : 'Attiva sessione')}
              aria-label={status === 'paused' ? (isEnglish ? 'Resume session' : 'Riprendi sessione') : (isEnglish ? 'Activate session' : 'Attiva sessione')}
            >
              <MonitorPlay className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
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
  onTrashSession,
  currentTeacherId,
  viewMode,
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
  onTrashSession: (session: SessionData) => void
  currentTeacherId?: string
  viewMode: 'grid' | 'list'
}) {
  if (sessions.length === 0) return null
  const activeCount = sessions.filter((session) => session.status === 'active').length

  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
          {isEnglish ? 'Class sessions' : 'Sessioni della classe'}
        </h3>
        <p className="mt-1 text-xs text-slate-500">
          {activeCount > 0
            ? (isEnglish ? `${activeCount} active sessions` : `${activeCount} sessioni attive`)
            : (isEnglish ? 'Compact overview by status' : 'Panoramica compatta differenziata per stato')}
        </p>
      </div>

      <div className={viewMode === 'grid' ? 'grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4' : 'flex flex-col gap-2'}>
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
            onTrashSession={onTrashSession}
            currentTeacherId={currentTeacherId}
            statusMeta={statusMeta}
            isEnglish={isEnglish}
            viewMode={viewMode}
          />
        ))}
      </div>
    </section>
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
  onTrashSession,
  currentTeacherId,
  statusMeta,
  isEnglish,
  viewMode,
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
  onTrashSession: (session: SessionData) => void
  currentTeacherId?: string
  statusMeta: Record<string, { label: string; tone: string; dot: string }>
  isEnglish: boolean
  viewMode: 'grid' | 'list'
}) {
  const meta = statusMeta[session.status] || statusMeta.draft
  const isActive = session.status === 'active'
  const isPaused = session.status === 'paused'
  const isDraft = session.status === 'draft'
  const iconTone: PastelTone = isPaused ? 'rose' : isActive ? 'violet' : 'slate'
  const cardColor = isActive ? '#7b69c9' : isPaused ? '#fe004d' : '#64748b'
  const cardOpacity = isActive ? 0.09 : isPaused ? 0.05 : 0.045
  const canDelete = Boolean(currentTeacherId && session.created_by_teacher_id === currentTeacherId)
  const deleteHint = canDelete
    ? (!['ended', 'finished'].includes(session.status)
      ? (isEnglish ? 'Stop the session before archiving it' : 'Termina la sessione prima di archiviarla')
      : (isEnglish ? 'Archive session' : 'Archivia sessione'))
    : (isEnglish ? 'Only the teacher who created this session can archive it' : 'Solo il docente che ha creato questa sessione può archiviarla')

  const navigate = useNavigate()
  const createdAt = new Date(session.created_at).toLocaleDateString(isEnglish ? 'en-GB' : 'it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })

  return (
    <Card
      surface="base"
      className={viewMode === 'list'
        ? 'group flex min-h-0 cursor-pointer flex-col gap-3 rounded-xl border p-3 transition-all hover:shadow-md sm:flex-row sm:items-center'
        : 'group flex min-h-[128px] cursor-pointer flex-col justify-between rounded-[18px] border p-3 transition-all hover:-translate-y-0.5 hover:shadow-md'}
      style={{
        backgroundColor: hexToRgba(cardColor, cardOpacity),
        borderColor: hexToRgba(cardColor, 0.13),
        boxShadow: `0 2px 8px ${hexToRgba(cardColor, 0.035)}`,
      }}
      onClick={() => navigate(`/teacher/sessions/${session.id}`)}
    >
      <div className={viewMode === 'list' ? 'flex min-w-0 flex-1 items-center gap-3' : ''}>
        <div className={viewMode === 'list' ? 'flex shrink-0 items-center gap-2' : 'mb-2 flex items-start justify-between gap-3'}>
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${PASTEL_ICON_BACKGROUNDS[iconTone]} ${PASTEL_ICON_TEXT[iconTone]}`}>
            <MonitorPlay className="h-4 w-4" />
          </div>
          <StatusBadge meta={meta} active={isActive} />
        </div>

        <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
          {editingTitleId === session.id ? (
            <form className="flex min-w-0 items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); onRename(session.id) }}>
              <Input
                autoFocus
                value={editingTitleValue}
                onChange={(e) => setEditingTitleValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditingTitleId(null) }}
                density="compact"
                className="min-w-0 flex-1 rounded-2xl bg-white text-sm text-slate-800"
              />
              <IconButton type="submit" disabled={renamePending} tone="success" surface="ghost" size="sm" className="rounded-full">
                {renamePending ? <Spinner size="sm" tone="success" /> : <Check className="h-3.5 w-3.5" />}
              </IconButton>
              <IconButton type="button" onClick={() => setEditingTitleId(null)} tone="neutral" surface="ghost" size="sm" className="rounded-full">
                <X className="h-3.5 w-3.5" />
              </IconButton>
            </form>
          ) : (
            <div className="flex min-w-0 items-start gap-2">
              <h4 className="min-w-0 flex-1 truncate text-sm font-bold text-slate-800">{session.title}</h4>
              <button
                type="button"
                onClick={() => { setEditingTitleId(session.id); setEditingTitleValue(session.title) }}
                className="rounded-full p-1 text-slate-400 opacity-0 transition-all hover:bg-white/70 hover:text-slate-700 group-hover:opacity-100"
                title={isEnglish ? 'Rename' : 'Rinomina'}
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        <div className={`${viewMode === 'list' ? 'ml-auto hidden shrink-0 lg:flex' : 'mt-2 flex'} flex-wrap items-center gap-1.5 text-[10px] text-slate-500`}>
          <span className="rounded-full bg-white/55 px-2 py-0.5 font-bold ring-1 ring-white/70">{createdAt}</span>
          <span className="rounded-full bg-white/55 px-2 py-0.5 font-bold ring-1 ring-white/70">
            {session.active_students_count ?? 0} {isActive ? (isEnglish ? 'active' : 'attivi') : (isEnglish ? 'students' : 'studenti')}
          </span>
          {session.join_code ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onCopyCode(session.join_code) }}
              className="inline-flex items-center gap-1 rounded-full bg-white/55 px-2 py-0.5 font-mono font-bold text-slate-600 ring-1 ring-white/70 transition-colors hover:bg-white/90"
            >
              {session.join_code}
              <Copy className="h-2.5 w-2.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div className={`${viewMode === 'list' ? 'mt-0 shrink-0' : 'mt-2.5'} flex flex-wrap items-center gap-1.5`} onClick={(e) => e.stopPropagation()}>
        <Button
          tone={isActive ? 'danger' : 'accent'}
          surface={isActive ? 'soft' : 'solid'}
          density="compact"
          className="h-8 w-8 rounded-full p-0"
          onClick={() => navigate(`/teacher/sessions/${session.id}`)}
          title={isEnglish ? 'Configure session' : 'Configura sessione'}
          aria-label={isEnglish ? 'Configure session' : 'Configura sessione'}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <Button
          tone="neutral"
          surface="soft"
          density="compact"
          className="h-8 w-8 rounded-full bg-white/70 p-0"
          onClick={() => navigate(`/teacher/sessions/${session.id}?tab=documents`)}
          title={isEnglish ? 'Session documents' : 'Documenti della sessione'}
          aria-label={isEnglish ? 'Session documents' : 'Documenti della sessione'}
        >
          <FileText className="h-3.5 w-3.5" />
        </Button>
        {isActive && (
          <Button onClick={() => onStatusChange(session.id, 'paused')} disabled={updatePending} tone="neutral" surface="soft" density="compact" className="h-8 w-8 rounded-full bg-white/70 p-0" title={isEnglish ? 'Pause session' : 'Metti in pausa'} aria-label={isEnglish ? 'Pause session' : 'Metti in pausa'}>
            <Pause className="h-3.5 w-3.5" />
          </Button>
        )}
        {(isActive || isPaused) && (
          <Button onClick={() => onStatusChange(session.id, 'ended')} disabled={updatePending} tone="danger" surface="soft" density="compact" className="h-8 w-8 rounded-full bg-white/70 p-0" title={isEnglish ? 'Stop session' : 'Termina sessione'} aria-label={isEnglish ? 'Stop session' : 'Termina sessione'}>
            <Square className="h-3.5 w-3.5" />
          </Button>
        )}
        {(isPaused || isDraft) && (
          <Button
            onClick={() => onStatusChange(session.id, 'active')}
            disabled={updatePending}
            tone="accent"
            surface="soft"
            density="compact"
            className="h-8 w-8 rounded-full bg-white/65 p-0"
            title={isPaused ? (isEnglish ? 'Resume session' : 'Riprendi sessione') : (isEnglish ? 'Activate session' : 'Attiva sessione')}
            aria-label={isPaused ? (isEnglish ? 'Resume session' : 'Riprendi sessione') : (isEnglish ? 'Activate session' : 'Attiva sessione')}
          >
            <MonitorPlay className="h-3.5 w-3.5" />
          </Button>
        )}
        <span className="inline-flex" title={deleteHint}>
          <Button
            onClick={() => onTrashSession(session)}
            disabled={!canDelete || updatePending || (!['ended', 'finished'].includes(session.status))}
            tone="danger"
            surface="ghost"
            density="compact"
            className="h-8 w-8 rounded-full p-0 disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={deleteHint}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </span>
      </div>
    </Card>
  )
}

function SessionTrash({
  isEnglish,
  sessions,
  onRestore,
  onPermanentDelete,
  restorePending,
  permanentDeletePending,
  currentTeacherId,
}: {
  isEnglish: boolean
  sessions: SessionData[]
  onRestore: (sessionId: string) => void
  onPermanentDelete: (session: SessionData) => void
  restorePending: boolean
  permanentDeletePending: boolean
  currentTeacherId?: string
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
            <Trash2 className="h-3.5 w-3.5" />
            {isEnglish ? 'Trash' : 'Cestino'}
          </h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {isEnglish
              ? 'Deleted or closed sessions remain recoverable for 30 days, then they are permanently cleaned.'
              : 'Le sessioni eliminate o terminate restano recuperabili per 30 giorni, poi vengono pulite definitivamente.'}
          </p>
        </div>
        <Badge tone="neutral" surface="soft" density="compact">
          {sessions.length}
        </Badge>
      </div>
      <div className="space-y-2">
        {sessions.map((session) => {
          const canDelete = Boolean(currentTeacherId && session.created_by_teacher_id === currentTeacherId)
          const ownerHint = isEnglish
            ? 'Only the teacher who created this session can manage it'
            : 'Solo il docente che ha creato questa sessione può gestirla'
          const deletedAt = session.deleted_at ? new Date(session.deleted_at) : null
          const purgeAfter = session.purge_after ? new Date(session.purge_after) : null
          const deletedText = deletedAt
            ? deletedAt.toLocaleDateString(isEnglish ? 'en-GB' : 'it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : (isEnglish ? 'closed session' : 'sessione terminata')
          const purgeText = purgeAfter
            ? purgeAfter.toLocaleDateString(isEnglish ? 'en-GB' : 'it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : (isEnglish ? '30 days after deletion' : "30 giorni dall'eliminazione")

          return (
            <div key={session.id} className="flex flex-col gap-3 rounded-xl bg-white px-3 py-3 shadow-sm ring-1 ring-slate-200/70 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{session.title}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {isEnglish ? 'Moved to trash' : 'Nel cestino'}: {deletedText} · {isEnglish ? 'Permanent cleanup' : 'Pulizia definitiva'}: {purgeText}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <span className="inline-flex" title={canDelete ? undefined : ownerHint}>
                  <Button
                    tone="neutral"
                    surface="soft"
                    density="compact"
                    className="rounded-full disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!canDelete || restorePending}
                    onClick={() => onRestore(session.id)}
                  >
                    {restorePending ? <Spinner className="mr-2" size="sm" tone="neutral" /> : <RotateCcw className="mr-1.5 h-3.5 w-3.5" />}
                    {isEnglish ? 'Restore' : 'Recupera'}
                  </Button>
                </span>
                <span className="inline-flex" title={canDelete ? undefined : ownerHint}>
                  <Button
                    tone="danger"
                    surface="ghost"
                    density="compact"
                    className="rounded-full disabled:cursor-not-allowed disabled:opacity-40"
                    disabled={!canDelete || permanentDeletePending}
                    onClick={() => onPermanentDelete(session)}
                  >
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    {isEnglish ? 'Delete forever' : 'Elimina per sempre'}
                  </Button>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function StatusBadge({ meta, active = false }: { meta: { label: string; tone: string }; active?: boolean }) {
  if (active) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-white/60 px-2 py-0.5 text-[11px] font-bold text-[#6753b7] ring-1 ring-white/70">
        <span className="h-1.5 w-1.5 rounded-full bg-[#7b69c9]" />
        {meta.label}
      </span>
    )
  }
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
