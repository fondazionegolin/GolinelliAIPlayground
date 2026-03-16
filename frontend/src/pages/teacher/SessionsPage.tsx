import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { teacherApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import {
  Plus, Play, Square, Users, Clock, Copy, Eye, Trash2,
  PlayCircle, ChevronDown
} from 'lucide-react'

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

const STATUS_CONFIG: Record<string, { label: string; dot: string; badge: string }> = {
  draft:  { label: 'Bozza',   dot: 'bg-slate-400',  badge: 'bg-slate-100 text-slate-600' },
  active: { label: 'Attiva',  dot: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700' },
  paused: { label: 'Pausa',   dot: 'bg-amber-500',   badge: 'bg-amber-100 text-amber-700' },
  ended:  { label: 'Terminata', dot: 'bg-red-400',   badge: 'bg-red-100 text-red-700' },
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
    queryFn: async () => (await teacherApi.getClasses()).data,
  })

  const { data: sessions, isLoading } = useQuery<SessionData[]>({
    queryKey: ['sessions', selectedClass],
    queryFn: async () => {
      if (!selectedClass) return []
      return (await teacherApi.getSessions(selectedClass)).data
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
      toast({ title: t('sessions.deleted'), variant: 'destructive' })
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

  const selectedClassData = classes?.find((cls) => cls.id === selectedClass)

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-8">

        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{t('sessions.title')}</h1>
            <p className="text-sm text-slate-500 mt-0.5">Gestisci le sessioni delle tue classi</p>
          </div>
          {selectedClass && (
            <Button onClick={() => setShowNewForm(true)} disabled={showNewForm} size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              {t('sessions.new_session')}
            </Button>
          )}
        </div>

        {/* Class Selector */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide block mb-3">
            {t('sessions.select_class')}
          </label>
          <div className="relative w-full sm:w-72">
            <select
              className="w-full appearance-none bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 pr-9 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[var(--teacher-accent,#6366f1)]/30 focus:border-[var(--teacher-accent,#6366f1)] transition-colors"
              value={selectedClass}
              onChange={(e) => setSelectedClass(e.target.value)}
            >
              <option value="">{t('sessions.select_class_default')}</option>
              {classes?.map((cls) => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}{cls.school_grade ? ` · ${cls.school_grade}` : ''}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          </div>
          {selectedClassData?.school_grade && (
            <p className="mt-2 text-xs text-slate-400">
              Anno scolastico: {selectedClassData.school_grade}
            </p>
          )}
        </div>

        {/* New Session Form */}
        {showNewForm && (
          <div className="bg-white rounded-xl border border-[var(--teacher-accent,#6366f1)]/20 p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Nuova sessione</h3>
            <form onSubmit={handleCreate} className="flex gap-3">
              <Input
                placeholder={t('sessions.title_placeholder')}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                autoFocus
                className="flex-1"
              />
              <Button type="submit" size="sm" disabled={createMutation.isPending || !newTitle.trim()}>
                {t('sessions.create_short')}
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => { setShowNewForm(false); setNewTitle('') }}>
                {t('common.cancel')}
              </Button>
            </form>
          </div>
        )}

        {/* Content */}
        {!selectedClass ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-200 py-16 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <Users className="h-6 w-6 text-slate-400" />
            </div>
            <h3 className="font-semibold text-slate-700 mb-1">{t('sessions.select_class')}</h3>
            <p className="text-sm text-slate-400 max-w-xs">{t('sessions.select_class_hint')}</p>
          </div>
        ) : isLoading ? (
          <div className="py-12 text-center text-sm text-slate-400">Caricamento...</div>
        ) : !sessions?.length ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-200 py-16 flex flex-col items-center text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-4">
              <Clock className="h-6 w-6 text-slate-400" />
            </div>
            <h3 className="font-semibold text-slate-700 mb-1">{t('sessions.empty_title')}</h3>
            <p className="text-sm text-slate-400 max-w-xs mb-5">{t('sessions.empty_body')}</p>
            <Button size="sm" onClick={() => setShowNewForm(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              {t('sessions.create_btn')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => {
              const sc = STATUS_CONFIG[session.status] ?? STATUS_CONFIG.draft
              const isActive = session.status === 'active'
              const isPaused = session.status === 'paused'
              const isDraft  = session.status === 'draft'
              const isEnded  = session.status === 'ended'

              return (
                <div
                  key={session.id}
                  className="bg-white rounded-xl border border-slate-200 px-5 py-4 flex flex-col sm:flex-row sm:items-center gap-4"
                >
                  {/* Left: status dot + info */}
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${sc.dot} ${isActive ? 'animate-pulse' : ''}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-sm font-semibold text-slate-800 truncate">{session.title}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${sc.badge}`}>
                          {sc.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-slate-400">
                        <span className="flex items-center gap-1">
                          Codice:
                          <code className="font-mono font-semibold text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded ml-1">
                            {session.join_code}
                          </code>
                          <button
                            onClick={() => copyCode(session.join_code)}
                            className="ml-0.5 text-slate-400 hover:text-slate-700 transition-colors"
                            title="Copia codice"
                          >
                            <Copy className="h-3 w-3" />
                          </button>
                        </span>
                        <span>{new Date(session.created_at).toLocaleDateString('it-IT')}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {isDraft && (
                      <Button
                        size="sm"
                        onClick={() => updateStatusMutation.mutate({ id: session.id, status: 'active' })}
                        disabled={updateStatusMutation.isPending}
                      >
                        <Play className="h-3.5 w-3.5 mr-1.5" />
                        {t('sessions.start_btn')}
                      </Button>
                    )}
                    {isActive && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => updateStatusMutation.mutate({ id: session.id, status: 'paused' })}
                          disabled={updateStatusMutation.isPending}
                        >
                          <Square className="h-3.5 w-3.5 mr-1.5" />
                          {t('sessions.pause_btn')}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => updateStatusMutation.mutate({ id: session.id, status: 'ended' })}
                          disabled={updateStatusMutation.isPending}
                        >
                          {t('sessions.end_btn')}
                        </Button>
                      </>
                    )}
                    {isPaused && (
                      <Button
                        size="sm"
                        onClick={() => updateStatusMutation.mutate({ id: session.id, status: 'active' })}
                        disabled={updateStatusMutation.isPending}
                      >
                        <PlayCircle className="h-3.5 w-3.5 mr-1.5" />
                        {t('sessions.resume_btn')}
                      </Button>
                    )}
                    {isEnded && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          if (confirm(t('sessions.delete_confirm'))) {
                            deleteMutation.mutate(session.id)
                          }
                        }}
                        disabled={deleteMutation.isPending}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                        {t('common.delete')}
                      </Button>
                    )}
                    <Link to={`/teacher/sessions/${session.id}`}>
                      <Button size="sm" variant="outline">
                        <Eye className="h-3.5 w-3.5 mr-1.5" />
                        {t('sessions.monitor_btn')}
                      </Button>
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
