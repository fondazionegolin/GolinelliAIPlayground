import { useState } from 'react'
import { formatInternalCredits } from '@/lib/credits'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { Input } from '@/components/ui/input'
import {
  ChevronRight, GraduationCap, Users, BookOpen,
  Search, Zap, Clock, Wifi, Building2,
} from '@/components/icons'
import { tl } from '@/i18n/tl'
import { AdminEmpty, AdminPageHeader, AdminStat, AdminStatGrid } from '@/components/admin/AdminUI'

/* ─── types ─────────────────────────────────────────── */
interface StudentInfo {
  id: string
  nickname: string
  created_at?: string | null
  last_seen_at?: string | null
}

interface SessionInfo {
  session_id: string
  title: string
  status: string
  join_code: string
  student_count: number
  period_cost: number
  students: StudentInfo[]
}

interface ClassInfo {
  class_id: string
  class_name: string
  school_grade?: string | null
  teacher_id: string
  teacher_name: string
  teacher_email: string
  session_count: number
  sessions: SessionInfo[]
  school_id?: string | null
  school_name?: string | null
}

/* ─── helpers ───────────────────────────────────────── */
const formatCurrency = (v: number) => formatInternalCredits(v, 2)
const formatDate = (raw?: string | null) => {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' })
}
const formatDateTime = (raw?: string | null) => {
  if (!raw) return '—'
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

const STATUS_BADGE: Record<string, string> = {
  active: 'admin-badge-success',
  draft: 'admin-badge-neutral',
  closed: 'admin-badge-danger',
  archived: 'admin-badge-neutral',
}

/* ─── main component ─────────────────────────────────── */
export default function ClassesPage() {
  const [search, setSearch] = useState('')
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set())
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set())

  const { data, isLoading } = useQuery<{ items: ClassInfo[] }>({
    queryKey: ['admin-classes'],
    queryFn: async () => (await adminApi.getAdminClasses()).data,
    staleTime: 30_000,
  })

  const toggleClass = (id: string) => {
    setExpandedClasses((prev) => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  const toggleSession = (id: string) => {
    setExpandedSessions((prev) => {
      const s = new Set(prev)
      s.has(id) ? s.delete(id) : s.add(id)
      return s
    })
  }

  const allClasses = data?.items || []
  const filteredClasses = allClasses.filter((cls) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      cls.class_name.toLowerCase().includes(q) ||
      cls.teacher_name.toLowerCase().includes(q) ||
      cls.teacher_email.toLowerCase().includes(q) ||
      (cls.school_name || '').toLowerCase().includes(q) ||
      cls.sessions.some((s) => s.title.toLowerCase().includes(q))
    )
  })
  const schoolGroups = Array.from(filteredClasses.reduce((groups, cls) => {
    const key = cls.school_id || 'unassigned'
    const group = groups.get(key) || { id: key, name: cls.school_name || tl("Senza istituto"), classes: [] as ClassInfo[] }
    group.classes.push(cls)
    groups.set(key, group)
    return groups
  }, new Map<string, { id: string; name: string; classes: ClassInfo[] }>()).values()).sort((a, b) => a.name.localeCompare(b.name))

  const totalSessions = allClasses.reduce((a, c) => a + c.session_count, 0)
  const totalStudents = allClasses.reduce(
    (a, c) => a + c.sessions.reduce((b, s) => b + s.student_count, 0),
    0
  )
  const totalCost = allClasses.reduce(
    (a, c) => a + c.sessions.reduce((b, s) => b + s.period_cost, 0),
    0
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <AdminPageHeader
        eyebrow={tl("Struttura didattica")}
        title={tl("Istituti, classi e sessioni")}
        description={<span className="tabular-nums">{allClasses.length} {tl("classi ·")} {totalSessions} {tl("sessioni ·")} {totalStudents} {tl("studenti totali")}</span>}
        actions={
          <div className="relative w-72 max-w-full">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tl("Cerca classi, docenti…")} className="pl-9 text-sm" />
          </div>
        }
      />

      <AdminStatGrid className="!grid-cols-1 sm:!grid-cols-3">
        <AdminStat label={tl("Sessioni")} value={totalSessions} icon={BookOpen} />
        <AdminStat label={tl("Studenti")} value={totalStudents} icon={Users} />
        <AdminStat label={tl("Costo totale")} value={formatCurrency(totalCost)} icon={Zap} />
      </AdminStatGrid>

      {/* Class list */}
      {isLoading ? (
        <AdminEmpty>{tl("Caricamento…")}</AdminEmpty>
      ) : filteredClasses.length === 0 ? (
        <AdminEmpty>{tl("Nessuna classe trovata")}</AdminEmpty>
      ) : (
        <div className="space-y-4">
          {schoolGroups.map((school) => (
            <section key={school.id} className="admin-panel">
              <div className="admin-panel-head">
                <div className="flex items-center gap-2.5">
                  <Building2 className="h-4 w-4 text-slate-500" />
                  <div><h2 className="text-sm font-semibold text-slate-900">{school.name}</h2><p className="text-[11px] text-slate-500">{school.classes.length} {tl("classi")}</p></div>
                </div>
              </div>
              <div className="divide-y divide-[var(--admin-line)]">
          {school.classes.map((cls) => {
            const isClassOpen = expandedClasses.has(cls.class_id)
            return (
              <div key={cls.class_id}>
                {/* Class header */}
                <button
                  className="grid w-full grid-cols-[20px_40px_minmax(240px,1fr)_minmax(260px,auto)] items-center gap-3 px-4 py-3 hover:bg-[var(--admin-surface-2)] transition-colors text-left"
                  onClick={() => toggleClass(cls.class_id)}
                >
                  <div className={`transition-transform ${isClassOpen ? 'rotate-90' : ''}`}>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-[var(--admin-line)] bg-[var(--admin-surface-2)]">
                    <BookOpen className="h-4 w-4 text-slate-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-900">{cls.class_name}</span>
                      {cls.school_grade && (
                        <span className="admin-badge admin-badge-neutral">
                          {cls.school_grade}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <GraduationCap className="h-3.5 w-3.5 text-slate-400" />
                      <span className="text-xs text-slate-500">{cls.teacher_name}</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs text-slate-400">{cls.teacher_email}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 flex-shrink-0 text-xs text-slate-600 tabular-nums">
                    <span className="flex items-center gap-1">
                      <BookOpen className="h-3.5 w-3.5" />
                      {cls.session_count}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {cls.sessions.reduce((a, s) => a + s.student_count, 0)}
                    </span>
                    <span className="flex items-center gap-1 font-medium text-slate-700">
                      <Zap className="h-3.5 w-3.5" />
                      {formatCurrency(cls.sessions.reduce((a, s) => a + s.period_cost, 0))}
                    </span>
                  </div>
                </button>

                {/* Sessions */}
                {isClassOpen && (
                  <div className="border-t border-[var(--admin-line)] bg-[var(--admin-surface-2)]">
                    {cls.sessions.length === 0 ? (
                      <p className="px-8 py-4 text-xs text-slate-400">{tl("Nessuna sessione")}</p>
                    ) : (
                      cls.sessions.map((sess) => {
                        const isSessOpen = expandedSessions.has(sess.session_id)
                        return (
                          <div key={sess.session_id} className="border-b border-[var(--admin-line)] last:border-0">
                            {/* Session row */}
                            <button
                              className="w-full flex items-center gap-3 px-8 py-2.5 hover:bg-white transition-colors text-left"
                              onClick={() => toggleSession(sess.session_id)}
                            >
                              <div className={`transition-transform ${isSessOpen ? 'rotate-90' : ''}`}>
                                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-slate-800">{sess.title}</span>
                                  <span
                                    className={`admin-badge ${STATUS_BADGE[sess.status] || 'admin-badge-neutral'}`}
                                  >
                                    {sess.status}
                                  </span>
                                </div>
                                <span className="text-[11px] text-slate-500 font-mono">
                                  codice: {sess.join_code}
                                </span>
                              </div>
                              <div className="flex items-center gap-4 flex-shrink-0 text-xs text-slate-500">
                                <span className="flex items-center gap-1">
                                  <Users className="h-3.5 w-3.5" />
                                  {sess.student_count} stud.
                                </span>
                                <span className={`font-medium ${sess.period_cost > 0 ? 'text-slate-700' : 'text-slate-400'}`}>
                                  {formatCurrency(sess.period_cost)}
                                </span>
                              </div>
                            </button>

                            {/* Students in session */}
                            {isSessOpen && (
                              <div className="px-12 pb-3">
                                {sess.students.length === 0 ? (
                                  <p className="text-xs text-slate-400 py-2">{tl("Nessuno studente")}</p>
                                ) : (
                                  <div className="overflow-x-auto rounded-md border border-[var(--admin-line)] bg-white"><table className="w-full min-w-[420px] text-xs">
                                    <thead>
                                      <tr>
                                        <th className="pb-1.5 text-left font-medium">Nickname</th>
                                        <th className="pb-1.5 text-left font-medium">
                                          <span className="flex items-center gap-1">
                                            <Clock className="h-3 w-3" />
                                            {tl("Iscritto")}
                                          </span>
                                        </th>
                                        <th className="pb-1.5 text-left font-medium">
                                          <span className="flex items-center gap-1">
                                            <Wifi className="h-3 w-3" />
                                            {tl("Ultimo accesso")}
                                          </span>
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {sess.students.map((stu) => (
                                        <tr key={stu.id}>
                                          <td className="py-1.5 font-medium text-slate-700">{stu.nickname}</td>
                                          <td className="py-1.5 text-slate-500">{formatDate(stu.created_at)}</td>
                                          <td className="py-1.5 text-slate-500">{formatDateTime(stu.last_seen_at)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table></div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>
            )
          })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
