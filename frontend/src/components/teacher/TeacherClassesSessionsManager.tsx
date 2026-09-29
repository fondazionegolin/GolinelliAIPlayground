import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import {
  Check,
  Archive,
  ArrowLeft,
  ChevronRight,
  Clock,
  Copy,
  Edit2,
  FileText,
  Folder,
  FolderOpen,
  MoreVertical,
  MonitorPlay,
  Pause,
  Play,
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
import { PASTEL_SURFACES, type PastelTone } from '@/design/themes/pastelSurfaces'
import { useTeacherProfile } from '@/hooks/useTeacherProfile'
import { TeachersManagementModal } from '@/components/TeachersManagementModal'
import { InvitationsPanel } from '@/components/InvitationsPanel'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/stores/auth'
import { useMobile } from '@/hooks/useMobile'

interface ClassData {
  id: string
  name: string
  school_grade?: string | null
  created_at: string
  session_count?: number
  role?: 'owner' | 'invited' | 'session_shared'
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
  co_teachers?: string[]
}

type SessionStatusFilter = 'all' | 'active' | 'paused' | 'draft' | 'ended'

export interface TeacherCurrentSession {
  id: string
  name: string
  className: string
  joinCode?: string
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
  const { isMobile } = useMobile()
  const currentTeacherId = useAuthStore((state) => state.user?.id)
  // The selected class keeps a neutral accent; session status colours are handled separately.
  const accentTheme = { ...getTeacherAccentTheme(teacherProfile?.uiAccent), accent: '#737373', text: '#404040' }

  const [selectedClassId, setSelectedClassId] = useState(searchParams.get('class') || '')
  const [showNewClassForm, setShowNewClassForm] = useState(false)
  const [showTeachersModal, setShowTeachersModal] = useState(false)
  const [classSearch, setClassSearch] = useState('')
  const [sessionSearch, setSessionSearch] = useState('')
  const [sessionStatusFilter, setSessionStatusFilter] = useState<SessionStatusFilter>('all')
  const [sessionDateFilter, setSessionDateFilter] = useState('')
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
  const [mobileSessionMenuId, setMobileSessionMenuId] = useState<string | null>(null)
  // Desktop folder view: which class folders are open (null until first data load picks defaults).
  const [expandedClassIds, setExpandedClassIds] = useState<Set<string> | null>(null)
  const [showEndedFor, setShowEndedFor] = useState<Set<string>>(() => new Set())
  const [showTrashFor, setShowTrashFor] = useState<Set<string>>(() => new Set())
  const [newSessionClassId, setNewSessionClassId] = useState('')
  const [editingClassId, setEditingClassId] = useState<string | null>(null)
  const [teachersClassId, setTeachersClassId] = useState<string | null>(null)

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
    if (isMobile) {
      setSelectedClassId('')
      return
    }
    const fallbackId = classes[0].id
    setSelectedClassId(fallbackId)
    setSearchParams({ class: fallbackId }, { replace: true })
  }, [classes, isMobile, searchParams, selectedClassId, setSearchParams])

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

  // Desktop shows every class as a folder, so it needs each class's sessions (same cache key as above).
  const classSessionQueries = useQueries({
    queries: classes.map((cls) => ({
      queryKey: ['sessions', cls.id],
      queryFn: async () => (await teacherApi.getSessions(cls.id, { include_deleted: true })).data as SessionData[],
      enabled: !isMobile,
      refetchInterval: 10000,
      refetchOnWindowFocus: false,
    })),
  })
  const sessionsByClass = new Map<string, { data: SessionData[]; isLoading: boolean }>()
  classes.forEach((cls, index) => {
    const query = classSessionQueries[index]
    sessionsByClass.set(cls.id, { data: query?.data ?? [], isLoading: query?.isLoading ?? true })
  })
  const allClassSessionsLoaded = classSessionQueries.every((query) => !query.isLoading)

  // First open: expand the class from the URL plus every class with a live session (fallback: the first class).
  useEffect(() => {
    if (expandedClassIds || isMobile || !classes.length || !allClassSessionsLoaded) return
    const initial = new Set<string>()
    const fromUrl = searchParams.get('class')
    if (fromUrl && classes.some((cls) => cls.id === fromUrl)) initial.add(fromUrl)
    classes.forEach((cls) => {
      if (currentSession?.id && sessionsByClass.get(cls.id)?.data.some((session) => session.id === currentSession.id)) initial.add(cls.id)
    })
    classes.forEach((cls) => {
      if (sessionsByClass.get(cls.id)?.data.some((session) => session.status === 'active' && !session.deleted_at)) initial.add(cls.id)
    })
    if (!initial.size) initial.add(classes[0].id)
    setExpandedClassIds(initial)
  }, [allClassSessionsLoaded, classes, currentSession?.id, expandedClassIds, isMobile, searchParams, sessionsByClass])

  const createClassMutation = useMutation({
    mutationFn: (data: { name: string; school_grade?: string; school_tenant_id?: string | null }) => teacherApi.createClass(data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setNewClassName('')
      setNewClassGrade(schoolGradeOptions[1])
      setShowNewClassForm(false)
      const nextId = res.data.id
      setSelectedClassId(nextId)
      setExpandedClassIds((prev) => new Set(prev ?? []).add(nextId))
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
      setEditingClassId(null)
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
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
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
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      queryClient.invalidateQueries({ queryKey: ['session-live'] })
      toast({ title: t('sessions.status_updated') })
    },
  })

  const trashSessionMutation = useMutation({
    mutationFn: (sessionId: string) => teacherApi.deleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setSessionToTrash(null)
      toast({ title: isEnglish ? 'Session moved to trash' : 'Sessione spostata nel cestino' })
    },
    onError: (error: any) => toast({ title: error?.response?.data?.detail || 'Impossibile archiviare la sessione', variant: 'destructive' }),
  })

  const restoreSessionMutation = useMutation({
    mutationFn: (sessionId: string) => teacherApi.restoreSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      toast({ title: isEnglish ? 'Session restored' : 'Sessione recuperata' })
    },
    onError: (error: any) => toast({ title: error?.response?.data?.detail || 'Impossibile recuperare la sessione', variant: 'destructive' }),
  })

  const permanentlyDeleteSessionMutation = useMutation({
    mutationFn: (sessionId: string) => teacherApi.permanentlyDeleteSession(sessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
      queryClient.invalidateQueries({ queryKey: ['classes'] })
      setSessionToPermanentlyDelete(null)
      toast({ title: isEnglish ? 'Session permanently deleted' : 'Sessione eliminata definitivamente' })
    },
    onError: (error: any) => toast({ title: error?.response?.data?.detail || 'Impossibile eliminare la sessione', variant: 'destructive' }),
  })

  const renameSessionMutation = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => teacherApi.updateSession(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] })
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

  const filteredOrderedSessions = useMemo(() => {
    const query = sessionSearch.trim().toLowerCase()
    return orderedSessions.filter((session) =>
      (!query || [session.title, session.join_code, statusMeta[session.status]?.label]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query)) &&
      (sessionStatusFilter === 'all' ||
        (sessionStatusFilter === 'ended'
          ? session.status === 'ended' || session.status === 'finished'
          : session.status === sessionStatusFilter)) &&
      (!sessionDateFilter || (() => {
        const date = new Date(session.created_at)
        const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        return localDate === sessionDateFilter
      })())
    )
  }, [orderedSessions, sessionDateFilter, sessionSearch, sessionStatusFilter, statusMeta])

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

  const handleSaveClass = (target: ClassData | null = selectedClass) => {
    if (!target || !editClassName.trim()) {
      setIsEditingClass(false)
      setEditingClassId(null)
      return
    }
    const noChanges =
      editClassName.trim() === target.name &&
      editClassGrade === (target.school_grade || schoolGradeOptions[1])
    if (noChanges) {
      setIsEditingClass(false)
      setEditingClassId(null)
      return
    }
    updateClassMutation.mutate({
      id: target.id,
      name: editClassName.trim(),
      school_grade: editClassGrade,
      school_tenant_id: target.school_tenant_id || null,
    })
  }

  const startEditClass = (cls: ClassData) => {
    setEditClassName(cls.name)
    setEditClassGrade(cls.school_grade || schoolGradeOptions[1])
    setEditingClassId(cls.id)
  }

  const openNewSession = (classId: string) => {
    setNewSessionClassId(classId)
    setNewSessionTitle(`${isEnglish ? 'Lesson of' : 'Lezione del'} ${new Date().toLocaleDateString(isEnglish ? 'en-GB' : 'it-IT')}`)
    setShowNewSessionDialog(true)
  }

  const handleCreateSession = () => {
    const classId = newSessionClassId || selectedClassId
    if (!classId) return
    const title = newSessionTitle.trim() || `${isEnglish ? 'Lesson of' : 'Lezione del'} ${new Date().toLocaleDateString(isEnglish ? 'en-GB' : 'it-IT')}`
    createSessionMutation.mutate({ classId, title })
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

  if (isMobile) {
    return (
      <div className="min-h-full w-full overflow-y-auto bg-neutral-100 px-4 pb-[max(2rem,env(safe-area-inset-bottom))] pt-4">
        {!selectedClass ? (
          <>
            <header className="flex items-start justify-between gap-4 px-1">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-600">Area docente</p>
                <h1 className="mt-1 text-3xl font-black tracking-tight text-slate-950">Le tue classi</h1>
                <p className="mt-1 text-sm font-medium text-slate-500">Scegli una classe per vedere e gestire le sessioni.</p>
              </div>
              <InvitationsPanel />
            </header>

            <div className="mt-5 flex gap-2">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">{isEnglish ? 'Search classes' : 'Cerca classi'}</span>
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  value={classSearch}
                  onChange={(event) => setClassSearch(event.target.value)}
                  placeholder={isEnglish ? 'Search classes...' : 'Cerca classi...'}
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-base font-semibold text-slate-800 shadow-sm outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100"
                />
              </label>
              <button
                type="button"
                onClick={() => setShowNewClassForm((open) => !open)}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg"
                aria-label={t('classes.new_class')}
              >
                {showNewClassForm ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
              </button>
            </div>

            {showNewClassForm && (
              <form onSubmit={handleCreateClass} className="mt-3 space-y-3 rounded-3xl border border-violet-100 bg-white p-4 shadow-sm">
                <h2 className="text-lg font-black text-slate-950">{t('classes.new_class')}</h2>
                <Input value={newClassName} onChange={(event) => setNewClassName(event.target.value)} placeholder={t('classes.class_name_placeholder')} className="h-12 bg-slate-50 text-base" />
                <Select value={newClassSchoolId} onChange={(event) => setNewClassSchoolId(event.target.value)} className="h-12 bg-slate-50">
                  <option value="">{isEnglish ? 'No institution' : 'Senza istituto'}</option>
                  {teacherSchools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
                </Select>
                <Select value={newClassGrade} onChange={(event) => setNewClassGrade(event.target.value)} className="h-12 bg-slate-50">
                  {schoolGradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                </Select>
                <button type="submit" disabled={!newClassName.trim() || createClassMutation.isPending} className="flex h-12 w-full items-center justify-center rounded-2xl bg-violet-600 px-5 text-sm font-black text-white disabled:opacity-50">
                  {createClassMutation.isPending ? <Spinner className="mr-2" size="sm" tone="inverse" /> : <Plus className="mr-2 h-4 w-4" />}
                  {t('classes.create_class')}
                </button>
              </form>
            )}

            <div className="mt-6 flex items-center justify-between px-1">
              <h2 className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{filteredClasses.length} {isEnglish ? 'classes' : 'classi'}</h2>
            </div>
            {isClassesLoading ? (
              <div className="mt-3 grid grid-cols-2 gap-3">{[1, 2, 3, 4].map(item => <div key={item} className="h-48 animate-pulse rounded-3xl bg-white" />)}</div>
            ) : filteredClasses.length === 0 ? (
              <div className="mt-3 rounded-3xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
                <School className="mx-auto h-9 w-9 text-slate-300" />
                <p className="mt-3 text-base font-black text-slate-800">{classes.length ? (isEnglish ? 'No results' : 'Nessun risultato') : t('classes.empty_title')}</p>
                <p className="mt-1 text-sm text-slate-500">{classes.length ? (isEnglish ? 'Try another search.' : 'Prova con un’altra ricerca.') : t('classes.empty_body')}</p>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3">
                {filteredClasses.map((cls, index) => (
                  <button
                    key={cls.id}
                    type="button"
                    onClick={() => handleSelectClass(cls.id)}
                    className="mobile-card-standard flex flex-col rounded-3xl bg-white p-4 text-left shadow-sm ring-1 ring-slate-100 transition-transform active:scale-[0.98]"
                  >
                    <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${index % 3 === 0 ? 'bg-sky-50 text-sky-700' : index % 3 === 1 ? 'bg-violet-50 text-violet-700' : 'bg-amber-50 text-amber-700'}`}>
                      <School className="h-5 w-5" />
                    </span>
                    <span className="mt-auto line-clamp-2 text-base font-black leading-tight text-slate-950">{cls.name}</span>
                    <span className="flex w-full items-center justify-between pt-2 text-xs font-black text-slate-600">
                      {cls.session_count || 0} {isEnglish ? 'sessions' : 'sessioni'}
                      <ChevronRight className="h-5 w-5" />
                    </span>
                  </button>
                ))}
              </div>
            )}
            <button type="button" onClick={() => setShowArchivedClasses(true)} className="mt-5 flex min-h-12 w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-600">
              <span className="flex items-center gap-2"><Archive className="h-5 w-5" />{isEnglish ? 'Class archive' : 'Archivio classi'}</span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs">{archivedClasses.length}</span>
            </button>
          </>
        ) : (
          <>
            <header className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => { setSelectedClassId(''); setSearchParams({}, { replace: true }) }}
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700"
                  aria-label={isEnglish ? 'Back to classes' : 'Torna alle classi'}
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <div className="min-w-0 flex-1 pt-1">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-600">{isEnglish ? 'Selected class' : 'Classe selezionata'}</p>
                  <h1 className="truncate text-2xl font-black text-slate-950">{selectedClass.name}</h1>
                  <p className="truncate text-sm font-semibold text-slate-400">{selectedClass.school_grade || t('classes.not_set')}</p>
                </div>
              </div>
              {selectedClass.role !== 'session_shared' && <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setShowTeachersModal(true)} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-100 px-3 text-xs font-black text-slate-700">
                  <UserPlus className="h-5 w-5" />
                  {isEnglish ? 'Teachers' : 'Docenti'}
                </button>
                <button type="button" onClick={() => setIsEditingClass((editing) => !editing)} className="flex h-12 items-center justify-center gap-2 rounded-2xl bg-slate-100 px-3 text-xs font-black text-slate-700">
                  <Edit2 className="h-5 w-5" />
                  {isEnglish ? 'Edit class' : 'Modifica classe'}
                </button>
              </div>}
              {isEditingClass && (
                <div className="mt-3 space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <Input value={editClassName} onChange={(event) => setEditClassName(event.target.value)} className="h-12 bg-white text-base" />
                  <Select value={editClassGrade} onChange={(event) => setEditClassGrade(event.target.value)} className="h-12 bg-white">
                    {schoolGradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                  </Select>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => handleSaveClass()} disabled={updateClassMutation.isPending} className="flex h-12 items-center justify-center rounded-xl bg-slate-950 px-3 text-xs font-black text-white disabled:opacity-50">{isEnglish ? 'Save' : 'Salva'}</button>
                    {selectedClass.role === 'owner' && <button type="button" onClick={() => { if (window.confirm(`Archiviare la classe \"${selectedClass.name}\"?`)) archiveClassMutation.mutate(selectedClass.id) }} disabled={archiveClassMutation.isPending} className="flex h-12 items-center justify-center rounded-xl bg-rose-50 px-3 text-xs font-black text-rose-600 disabled:opacity-50">{isEnglish ? 'Archive' : 'Archivia'}</button>}
                  </div>
                </div>
              )}
            </header>

            <div className="mt-5 flex gap-2">
              <label className="relative min-w-0 flex-1">
                <span className="sr-only">{isEnglish ? 'Search sessions' : 'Cerca sessioni'}</span>
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input value={sessionSearch} onChange={(event) => setSessionSearch(event.target.value)} placeholder={isEnglish ? 'Search sessions...' : 'Cerca sessioni...'} className="h-12 w-full rounded-2xl border border-slate-200 bg-white pl-12 pr-4 text-base font-semibold shadow-sm outline-none focus:border-violet-300 focus:ring-4 focus:ring-violet-100" />
              </label>
              {selectedClass.role !== 'session_shared' && <button
                type="button"
                onClick={() => openNewSession(selectedClass.id)}
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-lg"
                aria-label={t('sessions.new_session')}
              >
                <Plus className="h-5 w-5" />
              </button>}
            </div>

            <div className="mt-6 flex items-center justify-between px-1">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{isEnglish ? 'Class sessions' : 'Sessioni della classe'}</p>
                <h2 className="mt-1 text-2xl font-black text-slate-950">{filteredOrderedSessions.length} {isEnglish ? 'sessions' : 'sessioni'}</h2>
              </div>
            </div>

            {isSessionsLoading ? (
              <div className="mt-3 grid grid-cols-2 gap-3">{[1, 2, 3, 4].map(item => <div key={item} className="h-56 animate-pulse rounded-3xl bg-white" />)}</div>
            ) : filteredOrderedSessions.length === 0 ? (
              <div className="mt-3 rounded-3xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
                <MonitorPlay className="mx-auto h-9 w-9 text-slate-300" />
                <p className="mt-3 text-base font-black text-slate-800">{sessionSearch ? (isEnglish ? 'No results' : 'Nessun risultato') : t('sessions.empty_title')}</p>
                <p className="mt-1 text-sm text-slate-500">{isEnglish ? 'Create a session or change your search.' : 'Crea una sessione o modifica la ricerca.'}</p>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-3">
                {filteredOrderedSessions.map((session) => {
                  const isActive = session.status === 'active'
                  const isPaused = session.status === 'paused'
                  const isEnded = session.status === 'ended' || session.status === 'finished'
                  const meta = statusMeta[session.status] || statusMeta.draft
                  return (
                    <article key={session.id} className={`mobile-card-standard relative flex flex-col rounded-3xl p-4 shadow-sm ring-1 ${isActive ? 'bg-emerald-50 ring-emerald-200' : 'bg-white ring-slate-100'}`}>
                      <div className="flex items-start justify-between gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${isActive ? 'bg-emerald-100 text-emerald-700' : isPaused ? 'bg-amber-100 text-amber-700' : isEnded ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{meta.label}</span>
                        <button type="button" onClick={() => setMobileSessionMenuId(mobileSessionMenuId === session.id ? null : session.id)} className="flex h-11 w-11 -mr-2 -mt-2 items-center justify-center rounded-2xl text-slate-500" aria-label={isEnglish ? 'Session options' : 'Opzioni sessione'}>
                          <MoreVertical className="h-5 w-5" />
                        </button>
                      </div>
                      <h3 className="mt-3 line-clamp-2 text-base font-black leading-tight text-slate-950">{session.title}</h3>
                      <div className="mt-auto flex gap-2">
                        {session.join_code && (
                          <button type="button" onClick={() => copyCode(session.join_code)} className="flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl bg-slate-100 px-2 font-mono text-[11px] font-black text-slate-700">
                            <span className="truncate">{session.join_code}</span><Copy className="h-3.5 w-3.5 shrink-0" />
                          </button>
                        )}
                        <button type="button" onClick={() => navigate(`/teacher/sessions/${session.id}`)} className="flex min-h-10 min-w-0 flex-1 items-center justify-center gap-1 rounded-xl bg-slate-950 px-2 text-xs font-black text-white">
                          {isEnded ? 'Report' : (isEnglish ? 'Open' : 'Apri')}<ChevronRight className="h-4 w-4 shrink-0" />
                        </button>
                      </div>
                      {mobileSessionMenuId === session.id && (
                        <div className="absolute inset-x-2 top-12 z-20 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                          {(isActive || isPaused) && <button type="button" onClick={() => { updateSessionMutation.mutate({ id: session.id, status: isActive ? 'paused' : 'active' }); setMobileSessionMenuId(null) }} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-black text-slate-700 hover:bg-slate-50">{isActive ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{isActive ? (isEnglish ? 'Pause' : 'Metti in pausa') : (isEnglish ? 'Resume' : 'Riprendi')}</button>}
                          {session.status === 'draft' && <button type="button" onClick={() => { updateSessionMutation.mutate({ id: session.id, status: 'active' }); setMobileSessionMenuId(null) }} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-black text-slate-700 hover:bg-slate-50"><Play className="h-4 w-4" />{isEnglish ? 'Start' : 'Avvia'}</button>}
                          {(isActive || isPaused) && <button type="button" onClick={() => { updateSessionMutation.mutate({ id: session.id, status: 'ended' }); setMobileSessionMenuId(null) }} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-black text-slate-700 hover:bg-slate-50"><Square className="h-4 w-4" />{isEnglish ? 'Stop' : 'Termina'}</button>}
                          <button type="button" onClick={() => navigate(`/teacher/sessions/${session.id}?tab=documents`)} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-black text-slate-700 hover:bg-slate-50"><FileText className="h-4 w-4" />{isEnglish ? 'Documents' : 'Documenti'}</button>
                          {isEnded && session.created_by_teacher_id === currentTeacherId && <button type="button" onClick={() => { setSessionToTrash(session); setMobileSessionMenuId(null) }} className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-xs font-black text-rose-600 hover:bg-rose-50"><Trash2 className="h-4 w-4" />{isEnglish ? 'Archive' : 'Archivia'}</button>}
                        </div>
                      )}
                    </article>
                  )
                })}
              </div>
            )}
          </>
        )}

        {showTeachersModal && selectedClass && <TeachersManagementModal type="class" targetId={selectedClass.id} targetName={selectedClass.name} onClose={() => setShowTeachersModal(false)} />}

        <Dialog open={showNewSessionDialog} onOpenChange={setShowNewSessionDialog}>
          <DialogContent size="sm" surface="elevated" className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] rounded-3xl">
            <DialogHeader>
              <DialogTitle>{t('sessions.new_session')}</DialogTitle>
              <DialogDescription>{selectedClass?.name}</DialogDescription>
            </DialogHeader>
            <DialogBody><Input autoFocus value={newSessionTitle} onChange={(event) => setNewSessionTitle(event.target.value)} className="h-12 bg-white text-base" placeholder={t('sessions.title_placeholder')} /></DialogBody>
            <DialogFooter>
              <Button surface="ghost" tone="neutral" onClick={() => setShowNewSessionDialog(false)} className="min-h-11">{t('classes.cancel')}</Button>
              <Button onClick={handleCreateSession} disabled={createSessionMutation.isPending} tone="accent" surface="solid" className="min-h-11">{t('sessions.create_btn')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!sessionToTrash} onOpenChange={(open) => { if (!open) setSessionToTrash(null) }}>
          <DialogContent size="sm" surface="elevated" className="w-[calc(100vw-2rem)] rounded-3xl">
            <DialogHeader>
              <DialogTitle>{isEnglish ? 'Archive session?' : 'Archiviare la sessione?'}</DialogTitle>
              <DialogDescription>{sessionToTrash?.title}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button surface="ghost" tone="neutral" onClick={() => setSessionToTrash(null)} className="min-h-11">{t('classes.cancel')}</Button>
              <Button tone="danger" surface="solid" onClick={() => sessionToTrash && trashSessionMutation.mutate(sessionToTrash.id)} disabled={trashSessionMutation.isPending} className="min-h-11">{isEnglish ? 'Archive' : 'Archivia'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showArchivedClasses} onOpenChange={setShowArchivedClasses}>
          <DialogContent size="sm" surface="elevated" className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] rounded-3xl">
            <DialogHeader>
              <DialogTitle>{isEnglish ? 'Class archive' : 'Archivio classi'}</DialogTitle>
              <DialogDescription>{isEnglish ? 'Restore or permanently delete archived classes.' : 'Ripristina o elimina definitivamente le classi archiviate.'}</DialogDescription>
            </DialogHeader>
            <DialogBody>
              <div className="space-y-3">
                {archivedClasses.length === 0 && <p className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">{isEnglish ? 'No archived classes.' : 'Nessuna classe archiviata.'}</p>}
                {archivedClasses.map((cls) => (
                  <div key={cls.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <p className="truncate text-sm font-black text-slate-800">{cls.name}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => restoreClassMutation.mutate(cls.id)} className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-slate-100 px-2 text-xs font-black text-slate-700"><RotateCcw className="h-4 w-4" />{isEnglish ? 'Restore' : 'Ripristina'}</button>
                      <button type="button" onClick={() => { if (window.confirm(`${isEnglish ? 'Permanently delete' : 'Eliminare definitivamente'} \"${cls.name}\"?`)) permanentlyDeleteClassMutation.mutate(cls.id) }} className="flex min-h-11 items-center justify-center gap-1 rounded-xl bg-rose-50 px-2 text-xs font-black text-rose-600"><Trash2 className="h-4 w-4" />{isEnglish ? 'Delete' : 'Elimina'}</button>
                    </div>
                  </div>
                ))}
              </div>
            </DialogBody>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // ── Desktop folder model ──
  const searchQuery = classSearch.trim().toLowerCase()
  const isNarrowing = Boolean(searchQuery) || sessionStatusFilter !== 'all' || Boolean(sessionDateFilter)
  const statusRank: Record<string, number> = { active: 0, paused: 1, draft: 2, ended: 3, finished: 3 }
  const isEndedStatus = (status: string) => status === 'ended' || status === 'finished'
  const matchesSessionFilters = (session: SessionData) =>
    (sessionStatusFilter === 'all' ||
      (sessionStatusFilter === 'ended' ? isEndedStatus(session.status) : session.status === sessionStatusFilter)) &&
    (!sessionDateFilter || (() => {
      const date = new Date(session.created_at)
      const localDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      return localDate === sessionDateFilter
    })())

  let totalSessionCount = 0
  let liveSessionCount = 0
  const folders = classes
    .map((cls) => {
      const entry = sessionsByClass.get(cls.id)
      const all = entry?.data ?? []
      const live = all
        .filter((session) => !session.deleted_at)
        .sort((a, b) => (statusRank[a.status] ?? 9) - (statusRank[b.status] ?? 9) || new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      const trashed = all.filter((session) => session.deleted_at)
      const activeCount = live.filter((session) => session.status === 'active').length
      totalSessionCount += live.length
      liveSessionCount += activeCount
      const classMatches = !searchQuery || [cls.name, cls.school_grade, cls.owner_name, cls.school_name]
        .filter(Boolean).join(' ').toLowerCase().includes(searchQuery)
      const matching = live.filter((session) =>
        matchesSessionFilters(session) &&
        (classMatches || [session.title, session.join_code].filter(Boolean).join(' ').toLowerCase().includes(searchQuery)))
      // Ended sessions fold away unless the teacher is explicitly searching/filtering.
      const visibleSessions = isNarrowing ? matching : matching.filter((session) => !isEndedStatus(session.status))
      const endedSessions = isNarrowing ? [] : matching.filter((session) => isEndedStatus(session.status))
      const hasSessionFilter = sessionStatusFilter !== 'all' || Boolean(sessionDateFilter)
      const visible = hasSessionFilter ? matching.length > 0 : classMatches || matching.length > 0
      const hasCurrent = Boolean(currentSession?.id && live.some((session) => session.id === currentSession.id))
      return { cls, visibleSessions, endedSessions, trashed, activeCount, hasCurrent, total: live.length, isLoading: entry?.isLoading ?? true, visible }
    })
    .filter((folder) => folder.visible)
    .sort((a, b) => Number(b.hasCurrent) - Number(a.hasCurrent) || Number(b.activeCount > 0) - Number(a.activeCount > 0))

  const toggleInSet = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) =>
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const toggleClassFolder = (classId: string) => {
    setExpandedClassIds((prev) => {
      const next = new Set(prev ?? [])
      if (next.has(classId)) next.delete(classId)
      else {
        next.add(classId)
        setSearchParams({ class: classId }, { replace: true })
      }
      return next
    })
  }

  const teachersClass = classes.find((cls) => cls.id === teachersClassId) || null
  const newSessionClass = classes.find((cls) => cls.id === (newSessionClassId || selectedClassId)) || null

  const renderSessionLine = (session: SessionData) => (
    <SessionLine
      key={session.id}
      session={session}
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
      isCurrent={session.id === currentSession?.id}
      statusMeta={statusMeta}
      isEnglish={isEnglish}
    />
  )

  const statusFilterOptions: { id: SessionStatusFilter; label: string }[] = [
    { id: 'all', label: isEnglish ? 'All' : 'Tutte' },
    { id: 'active', label: t('sessions.status_active') },
    { id: 'paused', label: t('sessions.status_paused') },
    { id: 'draft', label: t('sessions.status_draft') },
    { id: 'ended', label: t('sessions.status_ended') },
  ]

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* ── Header: title, overview numbers, class-level actions ── */}
      <header className="ds-frame-header px-6 pb-5 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
              {isEnglish ? 'Teacher panel' : 'Pannello docente'}
            </p>
            <h1 className="mt-1 text-[22px] font-semibold tracking-[var(--letter-spacing-tight)] text-slate-950">{t('classes.title')}</h1>
            <p className="mt-1 text-sm text-slate-500">
              {isEnglish
                ? 'Each folder is a class: open it to see and run its sessions.'
                : 'Ogni cartella è una classe: aprila per vedere e gestire le sue sessioni.'}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <InvitationsPanel />
            <Button onClick={() => setShowArchivedClasses(true)} tone="neutral" surface="soft" density="compact" className="h-9 rounded-full px-3 text-xs font-bold">
              <Archive className="mr-1.5 h-3.5 w-3.5" />
              {isEnglish ? 'Class archive' : 'Archivio classi'}
              <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-[10px] text-slate-600">{archivedClasses.length}</span>
            </Button>
            <Button onClick={() => setShowNewClassForm((value) => !value)} tone="accent" surface="solid" density="compact" className="h-9 rounded-full px-4 text-xs font-bold">
              {showNewClassForm ? <X className="mr-1.5 h-3.5 w-3.5" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
              {t('classes.new_class')}
            </Button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs font-semibold">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-slate-600">
            <School className="h-3.5 w-3.5" />{classes.length} {isEnglish ? 'classes' : 'classi'}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-slate-600">
            <MonitorPlay className="h-3.5 w-3.5" />{totalSessionCount} {isEnglish ? 'sessions' : 'sessioni'}
          </span>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 ${liveSessionCount > 0 ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
            <span className={`h-2 w-2 rounded-full ${liveSessionCount > 0 ? 'animate-pulse bg-white' : 'bg-slate-300'}`} />
            {liveSessionCount} {isEnglish ? 'live now' : liveSessionCount === 1 ? 'attiva ora' : 'attive ora'}
          </span>
        </div>
      </header>

      {/* ── Toolbar: one search for classes and sessions, status filter ── */}
      <div className="flex flex-wrap items-center gap-3 px-6 pt-4">
        <div className="ds-control relative h-10 w-full max-w-md rounded-[23px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#90a5ba]" />
          <input
            type="text"
            value={classSearch}
            onChange={(e) => setClassSearch(e.target.value)}
            placeholder={isEnglish ? 'Search classes, sessions or codes...' : 'Cerca classi, sessioni o codici...'}
            className="h-full w-full rounded-[23px] border-0 bg-transparent pl-9 pr-9 text-xs text-slate-700 placeholder:text-[#9ca3b0] focus:outline-none focus:shadow-[var(--ds-shadow-focus)]"
          />
          {classSearch && (
            <button
              type="button"
              onClick={() => setClassSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-slate-400 transition-colors hover:bg-slate-200/70 hover:text-slate-600"
              aria-label={isEnglish ? 'Clear search' : 'Cancella ricerca'}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="ds-control flex items-center gap-0.5 rounded-full p-1" role="group" aria-label={isEnglish ? 'Filter by status' : 'Filtra per stato'}>
          {statusFilterOptions.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setSessionStatusFilter(option.id)}
              aria-pressed={sessionStatusFilter === option.id}
              className={`h-8 rounded-full px-3 text-xs font-bold transition-colors ${sessionStatusFilter === option.id ? 'ds-selected' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="ds-control relative flex h-10 items-center gap-2 rounded-full px-3 text-xs text-slate-500">
          <Clock className="h-3.5 w-3.5 shrink-0" />
          <span className="sr-only">{isEnglish ? 'Creation date' : 'Data di creazione'}</span>
          <input type="date" value={sessionDateFilter} onChange={(event) => setSessionDateFilter(event.target.value)} className="bg-transparent text-xs font-semibold text-slate-700 outline-none" />
          {sessionDateFilter && (
            <button type="button" onClick={() => setSessionDateFilter('')} className="rounded-full p-0.5 text-slate-400 hover:text-slate-700" aria-label={isEnglish ? 'Clear date' : 'Cancella data'}>
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>

        {!isNarrowing && folders.length > 0 && (
          <div className="ml-auto flex items-center gap-1 text-xs font-bold text-slate-500">
            <button type="button" onClick={() => setExpandedClassIds(new Set(folders.map((folder) => folder.cls.id)))} className="rounded-full px-2.5 py-1.5 hover:bg-slate-100 hover:text-slate-800">
              {isEnglish ? 'Expand all' : 'Espandi tutto'}
            </button>
            <span className="text-slate-300">·</span>
            <button type="button" onClick={() => setExpandedClassIds(new Set())} className="rounded-full px-2.5 py-1.5 hover:bg-slate-100 hover:text-slate-800">
              {isEnglish ? 'Collapse all' : 'Comprimi tutto'}
            </button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-8 pt-4">
        {showNewClassForm && (
          <form onSubmit={handleCreateClass} className="mb-4 rounded-2xl bg-[var(--ds-surface-muted)] p-4 shadow-[var(--ds-shadow-1)]">
            <p className="text-sm font-bold text-slate-900">{t('classes.new_class')}</p>
            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
              <label className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{isEnglish ? 'Class name' : 'Nome della classe'}</span>
                <Input autoFocus placeholder={t('classes.class_name_placeholder')} value={newClassName} onChange={(e) => setNewClassName(e.target.value)} surface="base" className="bg-white" />
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{isEnglish ? 'Institution' : 'Istituto'}</span>
                <Select value={newClassSchoolId} onChange={(e) => setNewClassSchoolId(e.target.value)} surface="base">
                  <option value="">{isEnglish ? 'No institution' : 'Senza istituto'}</option>
                  {teacherSchools.map((school) => <option key={school.id} value={school.id}>{school.name}</option>)}
                </Select>
              </label>
              <label className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{isEnglish ? 'Grade' : 'Grado'}</span>
                <Select value={newClassGrade} onChange={(e) => setNewClassGrade(e.target.value)} surface="base">
                  {schoolGradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                </Select>
              </label>
              <div className="flex items-center gap-2">
                <Button type="submit" disabled={createClassMutation.isPending || !newClassName.trim()} tone="accent" surface="solid" className="rounded-full">
                  {createClassMutation.isPending ? <Spinner className="mr-2" size="sm" tone="inverse" /> : null}
                  {t('classes.create_class')}
                </Button>
                <Button type="button" surface="ghost" tone="neutral" onClick={() => setShowNewClassForm(false)} className="rounded-full">
                  {t('classes.cancel')}
                </Button>
              </div>
            </div>
          </form>
        )}

        {isClassesLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((item) => <div key={item} className={`h-[72px] animate-pulse rounded-2xl ${PASTEL_SURFACES.slate}`} />)}
          </div>
        ) : classes.length === 0 ? (
          <div className="mx-auto max-w-lg pt-10">
            <EmptyStateCard icon={<School className="h-7 w-7" />} title={emptyTitle} body={emptyBody} />
          </div>
        ) : folders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="mb-3 h-8 w-8 text-slate-200" />
            <p className="text-sm text-slate-400">
              {isEnglish ? 'Nothing matches the current search or filters.' : 'Nessuna classe o sessione corrisponde a ricerca e filtri.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {folders.map(({ cls, visibleSessions, endedSessions, trashed, activeCount, hasCurrent, total, isLoading }) => {
              const expanded = isNarrowing || (expandedClassIds?.has(cls.id) ?? false)
              const isEditing = editingClassId === cls.id
              const showEnded = showEndedFor.has(cls.id)
              const showTrash = showTrashFor.has(cls.id)
              return (
                <section
                  key={cls.id}
                  className={`rounded-2xl transition-shadow ${expanded ? 'bg-[var(--ds-surface-raised)] shadow-[var(--ds-shadow-2)]' : 'bg-[var(--ds-surface-muted)] shadow-[var(--ds-shadow-1)] hover:shadow-[var(--ds-shadow-2)]'}`}
                >
                  {/* Folder header */}
                  <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleClassFolder(cls.id)}
                      aria-expanded={expanded}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <ChevronRight className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${hasCurrent ? 'bg-amber-100 text-yellow-700' : 'bg-slate-100 text-slate-500'}`}>
                        {expanded ? <FolderOpen className="h-5 w-5" strokeWidth={1.75} /> : <Folder className="h-5 w-5" strokeWidth={1.75} />}
                      </span>
                      <span className="min-w-0">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-[15px] font-bold text-slate-950">{cls.name}</span>
                          {hasCurrent && (
                            <span className="inline-flex shrink-0 items-center rounded-full bg-yellow-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-yellow-900">
                              {isEnglish ? 'Current session' : 'Sessione corrente'}
                            </span>
                          )}
                          {activeCount > 0 && (
                            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />
                              {activeCount === 1 ? (isEnglish ? 'Live' : 'Attiva') : `${activeCount} ${isEnglish ? 'live' : 'attive'}`}
                            </span>
                          )}
                        </span>
                        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500">
                          <span>{cls.school_grade || t('classes.not_set')}</span>
                          <span className="text-slate-300">·</span>
                          <span>{total} {isEnglish ? (total === 1 ? 'session' : 'sessions') : (total === 1 ? 'sessione' : 'sessioni')}</span>
                          {cls.school_name && (<><span className="text-slate-300">·</span><span className="truncate">{cls.school_name}</span></>)}
                          {cls.role === 'invited' && (
                            <><span className="text-slate-300">·</span><span className="inline-flex items-center gap-1"><Share2 className="h-3 w-3" />{cls.owner_name ? (isEnglish ? `by ${cls.owner_name}` : `di ${cls.owner_name}`) : (isEnglish ? 'Shared' : 'Condivisa')}</span></>
                          )}
                          {cls.role === 'session_shared' && (
                            <><span className="text-slate-300">·</span><span className="inline-flex items-center gap-1"><Share2 className="h-3 w-3" />{isEnglish ? `Sessions shared${cls.owner_name ? ` by ${cls.owner_name}` : ''}` : `Sessioni condivise${cls.owner_name ? ` da ${cls.owner_name}` : ''}`}</span></>
                          )}
                        </span>
                      </span>
                    </button>

                    {cls.role !== 'session_shared' && <div className="flex shrink-0 items-center gap-1">
                      <Button onClick={() => openNewSession(cls.id)} tone="accent" surface="soft" density="compact" className="h-8 rounded-full px-3 text-xs font-bold">
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        {t('sessions.new_session')}
                      </Button>
                      <IconButton onClick={() => startEditClass(cls)} title={isEnglish ? 'Rename class' : 'Rinomina classe'} tone="neutral" surface="ghost" size="sm" className="rounded-full">
                        <Edit2 className="h-3.5 w-3.5" />
                      </IconButton>
                      <IconButton onClick={() => setTeachersClassId(cls.id)} title={isEnglish ? 'Manage teachers' : 'Gestisci docenti'} tone="neutral" surface="ghost" size="sm" className="rounded-full">
                        <UserPlus className="h-3.5 w-3.5" />
                      </IconButton>
                      {cls.role === 'owner' && (
                        <IconButton
                          onClick={() => { if (window.confirm(`Archiviare la classe "${cls.name}"? Resterà recuperabile dall'archivio.`)) archiveClassMutation.mutate(cls.id) }}
                          disabled={archiveClassMutation.isPending}
                          title={isEnglish ? 'Archive class' : 'Archivia classe'}
                          tone="neutral"
                          surface="ghost"
                          size="sm"
                          className="rounded-full"
                        >
                          <Archive className="h-3.5 w-3.5" />
                        </IconButton>
                      )}
                    </div>}
                  </div>

                  {isEditing && (
                    <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pl-[4.25rem]">
                      <Input
                        autoFocus
                        value={editClassName}
                        onChange={(e) => setEditClassName(e.target.value)}
                        density="compact"
                        className="w-64 bg-white text-sm"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveClass(cls)
                          if (e.key === 'Escape') setEditingClassId(null)
                        }}
                      />
                      <Select value={editClassGrade} onChange={(e) => setEditClassGrade(e.target.value)} density="compact" className="text-xs">
                        {schoolGradeOptions.map((grade) => <option key={grade} value={grade}>{grade}</option>)}
                      </Select>
                      <IconButton onClick={() => handleSaveClass(cls)} disabled={updateClassMutation.isPending} title={isEnglish ? 'Save' : 'Salva'} tone="success" surface="ghost">
                        {updateClassMutation.isPending ? <Spinner size="sm" tone="success" /> : <Check className="h-4 w-4" />}
                      </IconButton>
                      <IconButton onClick={() => setEditingClassId(null)} title={t('classes.cancel')} tone="neutral" surface="ghost">
                        <X className="h-4 w-4" />
                      </IconButton>
                    </div>
                  )}

                  {/* Folder body: the class sessions */}
                  {expanded && (
                    <div className="mb-4 ml-7 mr-4 mt-1 border-l-2 border-slate-200/80 pl-4 md:ml-[2.6rem] md:pl-5">
                      {isLoading ? (
                        <div className="space-y-2">{[1, 2].map((item) => <div key={item} className="h-12 animate-pulse rounded-xl bg-slate-100" />)}</div>
                      ) : visibleSessions.length === 0 && endedSessions.length === 0 ? (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-4 text-sm text-slate-500">
                          <span>{isNarrowing ? (isEnglish ? 'No session matches.' : 'Nessuna sessione corrisponde.') : (isEnglish ? 'No sessions in this class yet.' : 'Questa classe non ha ancora sessioni.')}</span>
                          {!isNarrowing && (
                            <Button onClick={() => openNewSession(cls.id)} tone="accent" surface="soft" density="compact" className="h-8 rounded-full px-3 text-xs font-bold">
                              <Plus className="mr-1 h-3.5 w-3.5" />{isEnglish ? 'Create the first one' : 'Crea la prima'}
                            </Button>
                          )}
                        </div>
                      ) : (
                        <>
                          {visibleSessions.length > 0 && (
                            <>
                              <div className="hidden grid-cols-[6.5rem_minmax(0,1fr)_5.5rem_6.5rem_6.5rem_15rem] gap-3 px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 lg:grid">
                                <span>{isEnglish ? 'Status' : 'Stato'}</span>
                                <span>{isEnglish ? 'Session' : 'Sessione'}</span>
                                <span>{isEnglish ? 'Created' : 'Creata'}</span>
                                <span>{isEnglish ? 'Students' : 'Studenti'}</span>
                                <span>{isEnglish ? 'Code' : 'Codice'}</span>
                                <span className="text-right">{isEnglish ? 'Actions' : 'Azioni'}</span>
                              </div>
                              <div className="space-y-1.5">
                                {visibleSessions.map((session) => renderSessionLine(session))}
                              </div>
                            </>
                          )}
                          {endedSessions.length > 0 && (
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={() => toggleInSet(setShowEndedFor, cls.id)}
                                className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                                aria-expanded={showEnded}
                              >
                                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showEnded ? 'rotate-90' : ''}`} />
                                {isEnglish ? 'Ended sessions' : 'Sessioni terminate'} ({endedSessions.length})
                              </button>
                              {showEnded && <div className="mt-1.5 space-y-1.5">{endedSessions.map((session) => renderSessionLine(session))}</div>}
                            </div>
                          )}
                        </>
                      )}
                      {trashed.length > 0 && !isNarrowing && (
                        <div className="mt-2">
                          <button
                            type="button"
                            onClick={() => toggleInSet(setShowTrashFor, cls.id)}
                            className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            aria-expanded={showTrash}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {isEnglish ? 'Trash' : 'Cestino'} ({trashed.length})
                          </button>
                          {showTrash && (
                            <div className="mt-2">
                              <SessionTrash
                                isEnglish={isEnglish}
                                sessions={trashed}
                                onRestore={(sessionId) => restoreSessionMutation.mutate(sessionId)}
                                onPermanentDelete={(session) => setSessionToPermanentlyDelete(session)}
                                restorePending={restoreSessionMutation.isPending}
                                permanentDeletePending={permanentlyDeleteSessionMutation.isPending}
                                currentTeacherId={currentTeacherId}
                              />
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>

      {teachersClass && (
        <TeachersManagementModal
          type="class"
          targetId={teachersClass.id}
          targetName={teachersClass.name}
          onClose={() => setTeachersClassId(null)}
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

      {showNewSessionDialog && newSessionClass && (
        <Dialog open={showNewSessionDialog} onOpenChange={setShowNewSessionDialog}>
          <DialogContent
            size="sm"
            surface="elevated"
            className="rounded-xl"
            style={{ borderColor: accentTheme.id === 'black' ? hexToRgba('#171717', 0.08) : hexToRgba(accentTheme.accent, 0.14) }}
          >
            <DialogHeader>
              <DialogTitle>{t('sessions.new_session')}</DialogTitle>
              <DialogDescription>
                {isEnglish
                  ? <>You are working on <strong>{newSessionClass.name}</strong>. Give the session a clear name.</>
                  : <>Stai lavorando su <strong>{newSessionClass.name}</strong>. Dai un nome chiaro alla sessione.</>}
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

function SessionLine({
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
  isCurrent,
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
  onTrashSession: (session: SessionData) => void
  currentTeacherId?: string
  isCurrent: boolean
  statusMeta: Record<string, { label: string; tone: string; dot: string }>
  isEnglish: boolean
}) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const meta = statusMeta[session.status] || statusMeta.draft
  const isActive = session.status === 'active'
  const isPaused = session.status === 'paused'
  const isDraft = session.status === 'draft'
  const isEnded = session.status === 'ended' || session.status === 'finished'
  const canDelete = Boolean(currentTeacherId && session.created_by_teacher_id === currentTeacherId)
  const deleteHint = canDelete
    ? (!isEnded
      ? (isEnglish ? 'Stop the session before archiving it' : 'Termina la sessione prima di archiviarla')
      : (isEnglish ? 'Archive session' : 'Archivia sessione'))
    : (isEnglish ? 'Only the teacher who created this session can archive it' : 'Solo il docente che ha creato questa sessione può archiviarla')
  const createdAt = new Date(session.created_at).toLocaleDateString(isEnglish ? 'en-GB' : 'it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' })
  // Solid, saturated status badges carry the state; rows stay neutral.
  const statusStyle = isActive
    ? 'bg-emerald-500 text-white'
    : isPaused
      ? 'bg-orange-500 text-white'
      : isEnded
        ? 'bg-rose-500 text-white'
        : 'bg-slate-500 text-white'
  // Yellow is reserved for the session selected in the navbar (the one actually in use).
  const rowSurface = isCurrent
    ? 'bg-yellow-100 shadow-[0_0_0_1px_rgba(234,179,8,0.45),0_6px_16px_rgba(234,179,8,0.16)]'
    : 'bg-white/70 shadow-[0_0_0_1px_rgba(115,115,115,0.08)] hover:bg-white hover:shadow-[0_0_0_1px_rgba(115,115,115,0.14),var(--ds-shadow-1)]'
  const openSession = () => navigate(`/teacher/sessions/${session.id}`)

  return (
    <div
      className={`group relative grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-2.5 transition-all lg:grid-cols-[6.5rem_minmax(0,1fr)_5.5rem_6.5rem_6.5rem_15rem] ${rowSurface} ${isEnded ? 'opacity-80' : ''}`}
      aria-current={isCurrent ? 'true' : undefined}
      onClick={openSession}
    >
      <span className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold ${statusStyle}`}>
        {isActive && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-white" />}
        {meta.label}
      </span>

      <div className="min-w-0" onClick={(e) => { if (editingTitleId === session.id) e.stopPropagation() }}>
        {editingTitleId === session.id ? (
          <form className="flex min-w-0 items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); onRename(session.id) }}>
            <Input autoFocus value={editingTitleValue} onChange={(e) => setEditingTitleValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setEditingTitleId(null) }} density="compact" className="min-w-0 flex-1 rounded-xl bg-white text-sm text-slate-800" />
            <IconButton type="submit" disabled={renamePending} tone="success" surface="ghost" size="sm" className="rounded-full">
              {renamePending ? <Spinner size="sm" tone="success" /> : <Check className="h-3.5 w-3.5" />}
            </IconButton>
          </form>
        ) : (
          <span className="block min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              <span className={`truncate text-sm font-bold ${isEnded ? 'text-slate-500' : 'text-slate-950'}`}>{session.title}</span>
              {isCurrent && (
                <span className="shrink-0 rounded-full bg-yellow-400 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-yellow-900">
                  {isEnglish ? 'Current session' : 'Sessione corrente'}
                </span>
              )}
            </span>
            {(session.co_teachers?.length ?? 0) > 0 && (
              <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] font-semibold text-slate-500" title={session.co_teachers!.join(', ')}>
                <UserPlus className="h-3 w-3 shrink-0" />
                <span className="truncate">{isEnglish ? 'with' : 'con'} {session.co_teachers!.join(', ')}</span>
              </span>
            )}
          </span>
        )}
      </div>

      <span className="hidden text-xs font-semibold text-slate-500 lg:block">{createdAt}</span>
      <span className="hidden items-center gap-1.5 text-xs font-semibold text-slate-500 lg:flex">
        <Users className="h-3.5 w-3.5" />{session.active_students_count ?? 0}
      </span>
      <span className="hidden lg:block" onClick={(e) => e.stopPropagation()}>
        {session.join_code ? (
          <button type="button" onClick={() => onCopyCode(session.join_code)} className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 font-mono text-xs font-bold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900" title={isEnglish ? 'Copy code' : 'Copia codice'}>
            {session.join_code}<Copy className="h-3 w-3" />
          </button>
        ) : <span className="text-xs text-slate-300">—</span>}
      </span>

      <div className="relative flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
        {isActive && (
          <Button onClick={() => onStatusChange(session.id, 'paused')} disabled={updatePending} tone="neutral" surface="soft" density="compact" className="h-8 rounded-full bg-white px-3 text-xs font-bold">
            <Pause className="mr-1 h-3.5 w-3.5" /> {isEnglish ? 'Pause' : 'Pausa'}
          </Button>
        )}
        {(isPaused || isDraft) && (
          <Button onClick={() => onStatusChange(session.id, 'active')} disabled={updatePending} tone="neutral" surface="soft" density="compact" className="h-8 rounded-full bg-white px-3 text-xs font-bold">
            <Play className="mr-1 h-3.5 w-3.5" /> {isPaused ? (isEnglish ? 'Resume' : 'Riprendi') : (isEnglish ? 'Start' : 'Avvia')}
          </Button>
        )}
        <Button onClick={openSession} tone="neutral" surface="ghost" density="compact" className="h-8 rounded-full px-3 text-xs font-bold text-slate-600">
          {isEnded ? 'Report' : (isEnglish ? 'Open' : 'Apri')}
          <ChevronRight className="ml-0.5 h-3.5 w-3.5" />
        </Button>
        <button type="button" onClick={() => setMenuOpen((open) => !open)} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100" aria-label={isEnglish ? 'Session options' : 'Opzioni sessione'} aria-expanded={menuOpen}>
          <MoreVertical className="h-4 w-4" />
        </button>
        {menuOpen && (
          <div className="ds-popover absolute right-0 top-10 z-30 w-44 overflow-hidden rounded-xl p-1.5 text-xs">
            <button type="button" onClick={() => { setEditingTitleId(session.id); setEditingTitleValue(session.title); setMenuOpen(false) }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left font-semibold text-slate-700 hover:bg-slate-50">
              <Edit2 className="h-3.5 w-3.5" /> {isEnglish ? 'Rename' : 'Rinomina'}
            </button>
            <button type="button" onClick={() => navigate(`/teacher/sessions/${session.id}?tab=documents`)} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left font-semibold text-slate-700 hover:bg-slate-50">
              <FileText className="h-3.5 w-3.5" /> {isEnglish ? 'Documents' : 'Documenti'}
            </button>
            {session.join_code && (
              <button type="button" onClick={() => { onCopyCode(session.join_code); setMenuOpen(false) }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left font-semibold text-slate-700 hover:bg-slate-50 lg:hidden">
                <Copy className="h-3.5 w-3.5" /> {isEnglish ? 'Copy code' : 'Copia codice'}
              </button>
            )}
            {(isActive || isPaused) && (
              <button type="button" disabled={updatePending} onClick={() => { onStatusChange(session.id, 'ended'); setMenuOpen(false) }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                <Square className="h-3.5 w-3.5" /> {isEnglish ? 'Stop' : 'Termina'}
              </button>
            )}
            <button type="button" disabled={!canDelete || updatePending || !isEnded} onClick={() => { onTrashSession(session); setMenuOpen(false) }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40" title={deleteHint}>
              <Trash2 className="h-3.5 w-3.5" /> {isEnglish ? 'Archive' : 'Archivia'}
            </button>
          </div>
        )}
      </div>
    </div>
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
    <section className="rounded-2xl bg-slate-50 p-4">
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
