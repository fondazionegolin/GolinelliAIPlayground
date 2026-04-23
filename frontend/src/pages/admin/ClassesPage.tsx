import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  ChevronRight, GraduationCap, Users, BookOpen,
  Search, Euro, Clock, Wifi,
} from 'lucide-react'

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
}

/* ─── helpers ───────────────────────────────────────── */
const formatCurrency = (v: number) => `€ ${Number(v || 0).toFixed(3)}`
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
  active: 'bg-emerald-100 text-emerald-700',
  draft: 'bg-slate-100 text-slate-500',
  closed: 'bg-red-100 text-red-600',
  archived: 'bg-slate-100 text-slate-400',
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
      cls.sessions.some((s) => s.title.toLowerCase().includes(q))
    )
  })

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Classi & Sessioni</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {allClasses.length} classi · {totalSessions} sessioni · {totalStudents} studenti totali
          </p>
        </div>
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca classi, docenti…"
            className="pl-9 h-9 text-sm"
          />
        </div>
      </div>

      {/* Summary pills */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 flex items-center gap-2.5">
          <BookOpen className="h-5 w-5 text-indigo-500 flex-shrink-0" />
          <div>
            <p className="text-[11px] text-slate-500">Sessioni</p>
            <p className="text-lg font-bold text-slate-900">{totalSessions}</p>
          </div>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-center gap-2.5">
          <Users className="h-5 w-5 text-emerald-500 flex-shrink-0" />
          <div>
            <p className="text-[11px] text-slate-500">Studenti</p>
            <p className="text-lg font-bold text-slate-900">{totalStudents}</p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 flex items-center gap-2.5">
          <Euro className="h-5 w-5 text-slate-500 flex-shrink-0" />
          <div>
            <p className="text-[11px] text-slate-500">Costo totale</p>
            <p className="text-lg font-bold text-slate-900">{formatCurrency(totalCost)}</p>
          </div>
        </div>
      </div>

      {/* Class list */}
      {isLoading ? (
        <div className="py-16 text-center text-slate-400 text-sm">Caricamento…</div>
      ) : filteredClasses.length === 0 ? (
        <div className="py-16 text-center text-slate-400 text-sm">Nessuna classe trovata</div>
      ) : (
        <div className="space-y-2">
          {filteredClasses.map((cls) => {
            const isClassOpen = expandedClasses.has(cls.class_id)
            return (
              <Card key={cls.class_id} className="overflow-hidden">
                {/* Class header */}
                <button
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-slate-50 transition-colors text-left"
                  onClick={() => toggleClass(cls.class_id)}
                >
                  <div className={`transition-transform ${isClassOpen ? 'rotate-90' : ''}`}>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="w-9 h-9 rounded-xl bg-[#1a1a2e]/10 flex items-center justify-center flex-shrink-0">
                    <BookOpen className="h-4 w-4 text-[#1a1a2e]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-slate-800">{cls.class_name}</span>
                      {cls.school_grade && (
                        <span className="text-[11px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
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
                  <div className="flex items-center gap-4 flex-shrink-0 text-xs text-slate-500">
                    <span className="flex items-center gap-1">
                      <BookOpen className="h-3.5 w-3.5" />
                      {cls.session_count}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {cls.sessions.reduce((a, s) => a + s.student_count, 0)}
                    </span>
                    <span className="flex items-center gap-1 font-medium text-slate-700">
                      <Euro className="h-3.5 w-3.5" />
                      {formatCurrency(cls.sessions.reduce((a, s) => a + s.period_cost, 0))}
                    </span>
                  </div>
                </button>

                {/* Sessions */}
                {isClassOpen && (
                  <div className="border-t border-slate-100 bg-slate-50/60">
                    {cls.sessions.length === 0 ? (
                      <p className="px-8 py-4 text-xs text-slate-400">Nessuna sessione</p>
                    ) : (
                      cls.sessions.map((sess) => {
                        const isSessOpen = expandedSessions.has(sess.session_id)
                        return (
                          <div key={sess.session_id} className="border-b border-slate-100 last:border-0">
                            {/* Session row */}
                            <button
                              className="w-full flex items-center gap-3 px-8 py-3 hover:bg-slate-100/70 transition-colors text-left"
                              onClick={() => toggleSession(sess.session_id)}
                            >
                              <div className={`transition-transform ${isSessOpen ? 'rotate-90' : ''}`}>
                                <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-slate-700">{sess.title}</span>
                                  <span
                                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                      STATUS_BADGE[sess.status] || 'bg-slate-100 text-slate-500'
                                    }`}
                                  >
                                    {sess.status}
                                  </span>
                                </div>
                                <span className="text-[11px] text-slate-400 font-mono">
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
                                  <p className="text-xs text-slate-400 py-2">Nessuno studente</p>
                                ) : (
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="text-[10px] uppercase text-slate-400 border-b border-slate-200">
                                        <th className="pb-1.5 text-left font-medium">Nickname</th>
                                        <th className="pb-1.5 text-left font-medium">
                                          <span className="flex items-center gap-1">
                                            <Clock className="h-3 w-3" />
                                            Iscritto
                                          </span>
                                        </th>
                                        <th className="pb-1.5 text-left font-medium">
                                          <span className="flex items-center gap-1">
                                            <Wifi className="h-3 w-3" />
                                            Ultimo accesso
                                          </span>
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {sess.students.map((stu) => (
                                        <tr key={stu.id} className="border-t border-slate-100">
                                          <td className="py-1.5 font-medium text-slate-700">{stu.nickname}</td>
                                          <td className="py-1.5 text-slate-500">{formatDate(stu.created_at)}</td>
                                          <td className="py-1.5 text-slate-500">{formatDateTime(stu.last_seen_at)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
