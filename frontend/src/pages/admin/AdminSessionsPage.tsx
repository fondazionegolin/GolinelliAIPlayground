import { Fragment, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, Check, ChevronDown, ChevronUp, Loader2, RefreshCw, Users } from '@/components/icons'
import { adminApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'

interface Person { id: string; name: string; email: string | null; role: 'owner' | 'co-teacher' | 'live-creator'; live_total: number; live_active: number }
interface SessionRow {
  id: string; title: string; join_code: string; status: string; created_at: string | null
  tenant: { id: string; name: string; max_students_per_class: number }
  owner: { id: string; name: string; email: string | null }
  teachers: Person[]
  registered: number; online: number; frozen: number; limit: number; full: boolean; near_full: boolean
  live_total: number; live_active: number; last_activity: string | null
}
interface Involvement { session_id: string; title: string; join_code: string; role: Person['role']; status: string; live_total: number; live_active: number; registered: number; online: number; limit: number }
interface TeacherRow {
  id: string; name: string; email: string; role: string; last_login_at: string | null; last_activity: string | null
  owned_sessions: number; other_sessions: number; live_total: number; live_active: number
  registered_students: number; online_students: number; at_capacity: number; involved: Involvement[]
}
interface Overview {
  generated_at: string; online_window_minutes: number; days: number
  totals: { active_sessions: number; online_students: number; full_sessions: number; near_full_sessions: number; teachers_active_24h: number; active_live_interactions: number }
  sessions: SessionRow[]; teachers: TeacherRow[]
}

const ROLE_LABEL: Record<Person['role'], string> = { owner: 'Proprietario', 'co-teacher': 'Co-docente', 'live-creator': 'Ha creato live' }
const STATUS_STYLE: Record<string, string> = { active: 'bg-emerald-50 text-emerald-700', paused: 'bg-amber-50 text-amber-700', ended: 'bg-slate-100 text-slate-500', draft: 'bg-sky-50 text-sky-700' }
const STATUS_LABEL: Record<string, string> = { active: 'Attiva', paused: 'In pausa', ended: 'Conclusa', draft: 'Bozza' }
const ago = (iso: string | null) => {
  if (!iso) return '—'
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return 'adesso'
  if (minutes < 60) return `${minutes} min fa`
  if (minutes < 1440) return `${Math.round(minutes / 60)} h fa`
  return `${Math.round(minutes / 1440)} g fa`
}

export default function AdminSessionsPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [days, setDays] = useState(30)
  const [onlyOpen, setOnlyOpen] = useState(true)
  const [view, setView] = useState<'sessions' | 'teachers'>('sessions')
  const [editing, setEditing] = useState<string | null>(null)
  const [limitDraft, setLimitDraft] = useState('300')
  const [openTeacher, setOpenTeacher] = useState<string | null>(null)

  const query = useQuery<Overview>({
    queryKey: ['admin', 'activity', days],
    queryFn: async () => (await adminApi.getActivity(days)).data,
    refetchInterval: 20000,
  })
  const raise = useMutation({
    mutationFn: ({ tenantId, limit }: { tenantId: string; limit: number }) => adminApi.updateTenantLimits(tenantId, { max_students_per_class: limit }),
    onSuccess: (_, vars) => {
      setEditing(null)
      void qc.invalidateQueries({ queryKey: ['admin', 'activity'] })
      toast({ title: 'Limite aggiornato', description: `Ora fino a ${vars.limit} studenti per sessione: vale subito per tutte le sessioni di questa organizzazione.` })
    },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Limite non aggiornato', description: err?.response?.data?.detail || 'Riprova tra poco.' }),
  })

  const data = query.data
  const sessions = (data?.sessions ?? []).filter((s) => !onlyOpen || s.status !== 'ended')
  const submitLimit = (tenantId: string) => {
    const limit = Number(limitDraft)
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000) { toast({ variant: 'destructive', title: 'Inserisci un numero tra 1 e 5000' }); return }
    raise.mutate({ tenantId, limit })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a2e]">Sessioni e attività dei docenti</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Chi sta davvero lavorando adesso: proprietari, co-docenti e chi ha creato live nelle sessioni di altri. Il limite di capienza conta gli studenti <b>connessi contemporaneamente</b> (connessione attiva o segnale negli ultimi {data?.online_window_minutes ?? 5} minuti), non tutti quelli entrati in passato: chi esce libera subito un posto.
            «Iscritti totali» è solo informativo. Si aggiorna ogni 20 secondi.
          </p>
        </div>
        <Button onClick={() => void query.refetch()} variant="outline" className="gap-2" disabled={query.isFetching}>
          {query.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Aggiorna
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Sessioni attive" value={data?.totals.active_sessions} />
        <Stat label="Studenti online" value={data?.totals.online_students} />
        <Stat label="Live in corso" value={data?.totals.active_live_interactions} />
        <Stat label="Docenti attivi (24 h)" value={data?.totals.teachers_active_24h} />
        <Stat label="Sessioni al limite" value={data ? data.totals.full_sessions + data.totals.near_full_sessions : undefined} tone={data && data.totals.full_sessions ? 'red' : data && data.totals.near_full_sessions ? 'amber' : undefined}
          hint={data ? `${data.totals.full_sessions} piene · ${data.totals.near_full_sessions} oltre il 90%` : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {([['sessions', 'Sessioni'], ['teachers', 'Docenti']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} className={`rounded-full px-4 py-1.5 font-bold ${view === id ? 'bg-[#1a1a2e] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{label}</button>
        ))}
        <label className="ml-auto flex items-center gap-1.5 text-slate-500">Periodo
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded-lg border border-slate-200 bg-white px-2 py-1">
            <option value={7}>7 giorni</option><option value={30}>30 giorni</option><option value={90}>90 giorni</option><option value={365}>1 anno</option>
          </select>
        </label>
        {view === 'sessions' && <label className="flex items-center gap-1.5 text-slate-500"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Solo non concluse</label>}
      </div>

      {query.isLoading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}

      {view === 'sessions' && data && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[60rem] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
              <tr><th className="px-3 py-2">Sessione</th><th className="px-3 py-2">Docenti coinvolti</th><th className="px-3 py-2">Connessi ora / limite</th><th className="px-3 py-2 text-right">Iscritti totali</th><th className="px-3 py-2 text-right">Live</th><th className="px-3 py-2">Ultima attività</th></tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const pct = Math.min(100, Math.round((s.online / Math.max(1, s.limit)) * 100))
                return (
                  <Fragment key={s.id}>
                    <tr className="border-t border-slate-100 align-top hover:bg-slate-50/60">
                      <td className="px-3 py-3">
                        <p className="font-bold text-slate-800">{s.title}</p>
                        <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400"><span className="font-mono">{s.join_code}</span><span className={`rounded-full px-2 py-0.5 font-bold ${STATUS_STYLE[s.status] ?? STATUS_STYLE.draft}`}>{STATUS_LABEL[s.status] ?? s.status}</span><span>{s.tenant.name}</span></p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {s.teachers.map((p) => (
                            <span key={`${p.id}-${p.role}`} title={`${p.email ?? ''} · ${ROLE_LABEL[p.role]}`} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${p.role === 'owner' ? 'bg-[#1a1a2e] text-white ring-[#1a1a2e]' : p.live_total ? 'bg-pink-50 text-pink-700 ring-pink-200' : 'bg-white text-slate-500 ring-slate-200'}`}>
                              {p.name}{p.role === 'owner' ? ' · proprietario' : ''}{p.live_total ? ` · ${p.live_total} live` : ''}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="min-w-[11rem] px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100"><span className={`block h-full rounded-full ${s.full ? 'bg-red-500' : s.near_full ? 'bg-amber-400' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} /></span>
                          <span className={`whitespace-nowrap font-bold tabular-nums ${s.full ? 'text-red-600' : 'text-slate-700'}`}>{s.online} / {s.limit}</span>
                        </div>
                        {s.full && <p className="mt-1 flex items-center gap-1 text-[10px] font-bold text-red-600"><AlertTriangle className="h-3 w-3" /> Piena: i nuovi studenti vengono rifiutati finché qualcuno esce</p>}
                        {s.frozen > 0 && <p className="mt-0.5 text-[10px] text-slate-400">{s.frozen} bloccati</p>}
                        {editing === s.id ? (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <Input value={limitDraft} onChange={(e) => setLimitDraft(e.target.value)} inputMode="numeric" className="h-7 w-20 text-xs" aria-label="Nuovo limite per sessione" />
                            {[100, 300, 500].map((n) => <button key={n} onClick={() => setLimitDraft(String(n))} className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-600 hover:bg-slate-200">{n}</button>)}
                            <Button size="sm" className="h-7 gap-1 bg-[#e85c8d] px-2 text-[11px] text-white hover:bg-[#d34d7d]" disabled={raise.isPending} onClick={() => submitLimit(s.tenant.id)}>
                              {raise.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Applica
                            </Button>
                            <button onClick={() => setEditing(null)} className="text-[10px] font-semibold text-slate-400 hover:text-slate-600">Annulla</button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditing(s.id); setLimitDraft(String(Math.max(300, s.limit * 2))) }} className={`mt-1 text-[10px] font-bold underline ${s.near_full ? 'text-[#e85c8d]' : 'text-slate-400 hover:text-slate-600'}`} title={`Il limite vale per tutta l'organizzazione «${s.tenant.name}»`}>Alza il limite</button>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{s.registered}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{s.live_active ? <b className="text-emerald-600">{s.live_active} in corso</b> : <span className="text-slate-400">{s.live_total} create</span>}</td>
                      <td className="px-3 py-3 text-slate-500">{ago(s.last_activity)}</td>
                    </tr>
                  </Fragment>
                )
              })}
              {sessions.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-slate-400">Nessuna sessione nel periodo.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {view === 'teachers' && data && (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full min-w-[56rem] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
              <tr><th className="px-3 py-2">Docente</th><th className="px-3 py-2 text-right">Sessioni proprie</th><th className="px-3 py-2 text-right">Su sessioni altrui</th><th className="px-3 py-2 text-right">Live create</th>
                <th className="px-3 py-2 text-right">Studenti iscritti / online</th><th className="px-3 py-2">Ultima attività</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {data.teachers.map((t) => (
                <Fragment key={t.id}>
                  <tr className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5"><p className="font-bold text-slate-800">{t.name}{t.role === 'ADMIN' && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-black text-slate-500">ADMIN</span>}</p><p className="text-[10px] text-slate-400">{t.email}</p></td>
                    <td className="px-3 text-right tabular-nums">{t.owned_sessions}</td>
                    <td className="px-3 text-right tabular-nums">{t.other_sessions ? <b className="text-[#e85c8d]">{t.other_sessions}</b> : 0}</td>
                    <td className="px-3 text-right tabular-nums">{t.live_total}{t.live_active > 0 && <span className="ml-1 font-bold text-emerald-600">({t.live_active} in corso)</span>}</td>
                    <td className="px-3 text-right tabular-nums">{t.registered_students} / <b>{t.online_students}</b></td>
                    <td className="px-3 text-slate-500" title={t.last_login_at ? `Ultimo accesso ${new Date(t.last_login_at).toLocaleString('it-IT')}` : undefined}>{ago(t.last_activity)}</td>
                    <td className="px-2 text-right">
                      {t.involved.length > 0 && <button onClick={() => setOpenTeacher(openTeacher === t.id ? null : t.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Dettaglio sessioni">{openTeacher === t.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>}
                    </td>
                  </tr>
                  {openTeacher === t.id && (
                    <tr className="bg-slate-50/70"><td colSpan={7} className="px-4 py-3">
                      <div className="grid gap-1.5 md:grid-cols-2">
                        {t.involved.map((item) => (
                          <div key={`${item.session_id}-${item.role}`} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-[11px] ring-1 ring-slate-200">
                            <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{item.title} <span className="font-mono text-[10px] font-normal text-slate-400">{item.join_code}</span></span>
                            <span className="text-slate-400">{ROLE_LABEL[item.role]}</span>
                            {item.live_total > 0 && <span className="font-bold text-pink-600">{item.live_total} live</span>}
                            <span className={`tabular-nums ${item.online >= item.limit ? 'font-bold text-red-600' : 'text-slate-500'}`}>{item.online}/{item.limit}</span>
                          </div>
                        ))}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
              {data.teachers.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-slate-400">Nessun docente attivo nel periodo.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="flex items-center gap-1.5 text-[11px] text-slate-400"><Activity className="h-3.5 w-3.5" /><Users className="h-3.5 w-3.5" /> «Su sessioni altrui» conta le sessioni in cui il docente è co-docente o ha creato una live senza esserne il proprietario.</p>
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value?: number; hint?: string; tone?: 'red' | 'amber' }) {
  const color = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-600' : 'text-[#1a1a2e]'
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${color}`}>{value ?? '—'}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  )
}
