import { Fragment, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, Check, ChevronDown, ChevronUp, Loader2, RefreshCw, Users } from '@/components/icons'
import { adminApi } from '@/lib/api'
import { Button } from '@/design'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import { tl } from '@/i18n/tl'
import { AdminBadge, AdminPageHeader, AdminStat, AdminStatGrid, AdminTabs, type AdminBadgeTone } from '@/components/admin/AdminUI'

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

const ROLE_LABEL: Record<Person['role'], string> = { owner: tl("Proprietario"), 'co-teacher': "Co-docente", 'live-creator': tl("Ha creato live") }
const STATUS_TONE: Record<string, AdminBadgeTone> = { active: 'success', paused: 'warning', ended: 'neutral', draft: 'neutral' }
const STATUS_LABEL: Record<string, string> = { active: tl("Attiva"), paused: tl("In pausa"), ended: tl("Conclusa"), draft: tl("Bozza") }
const ago = (iso: string | null) => {
  if (!iso) return '—'
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (minutes < 1) return tl("adesso")
  if (minutes < 60) return tl("{0} min fa", minutes)
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
      toast({ title: tl("Limite aggiornato"), description: tl("Ora fino a {0} studenti per sessione: vale subito per tutte le sessioni di questa organizzazione.", vars.limit) })
    },
    onError: (err: any) => toast({ variant: 'destructive', title: tl("Limite non aggiornato"), description: err?.response?.data?.detail || tl("Riprova tra poco.") }),
  })

  const data = query.data
  const sessions = (data?.sessions ?? []).filter((s) => !onlyOpen || s.status !== 'ended')
  const submitLimit = (tenantId: string) => {
    const limit = Number(limitDraft)
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000) { toast({ variant: 'destructive', title: tl("Inserisci un numero tra 1 e 5000") }); return }
    raise.mutate({ tenantId, limit })
  }

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title={tl("Sessioni e attività dei docenti")}
        description={
          <span className="block max-w-3xl">
            {tl("Chi sta davvero lavorando adesso: proprietari, co-docenti e chi ha creato live nelle sessioni di altri. Il limite di capienza conta gli studenti")} <b>{tl("connessi contemporaneamente")}</b> {tl("(connessione attiva o segnale negli ultimi")} {data?.online_window_minutes ?? 5} {tl("minuti), non tutti quelli entrati in passato: chi esce libera subito un posto. «Iscritti totali» è solo informativo. Si aggiorna ogni 20 secondi.")}
          </span>
        }
        actions={
          <Button onClick={() => void query.refetch()} tone="neutral" surface="outline" disabled={query.isFetching}>
            {query.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {tl("Aggiorna")}
          </Button>
        }
      />

      <AdminStatGrid className="sm:!grid-cols-3 lg:!grid-cols-5">
        <Stat label={tl("Sessioni attive")} value={data?.totals.active_sessions} />
        <Stat label={tl("Studenti online")} value={data?.totals.online_students} />
        <Stat label={tl("Live in corso")} value={data?.totals.active_live_interactions} />
        <Stat label={tl("Docenti attivi (24 h)")} value={data?.totals.teachers_active_24h} />
        <Stat label={tl("Sessioni al limite")} value={data ? data.totals.full_sessions + data.totals.near_full_sessions : undefined} tone={data && data.totals.full_sessions ? 'red' : data && data.totals.near_full_sessions ? 'amber' : undefined}
          hint={data ? tl("{0} piene · {1} oltre il 90%", data.totals.full_sessions, data.totals.near_full_sessions) : undefined} />
      </AdminStatGrid>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <AdminTabs value={view} onChange={setView} options={[['sessions', tl("Sessioni")], ['teachers', tl("Docenti")]]} />
        <label className="ml-auto flex items-center gap-1.5 text-[var(--admin-ink-2)]">{tl("Periodo")}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-8 rounded-md border border-[var(--admin-line-strong)] bg-white px-2">
            <option value={7}>{tl("7 giorni")}</option><option value={30}>{tl("30 giorni")}</option><option value={90}>{tl("90 giorni")}</option><option value={365}>{tl("1 anno")}</option>
          </select>
        </label>
        {view === 'sessions' && <label className="flex items-center gap-1.5 text-[var(--admin-ink-2)]"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> {tl("Solo non concluse")}</label>}
      </div>

      {query.isLoading && <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}

      {view === 'sessions' && data && (
        <div className="admin-panel overflow-x-auto">
          <table className="w-full min-w-[60rem] text-left text-xs">
            <thead>
              <tr><th className="px-3 py-2">{tl("Sessione")}</th><th className="px-3 py-2">{tl("Docenti coinvolti")}</th><th className="px-3 py-2">{tl("Connessi ora / limite")}</th><th className="px-3 py-2 text-right">{tl("Iscritti totali")}</th><th className="px-3 py-2 text-right">Live</th><th className="px-3 py-2">{tl("Ultima attività")}</th></tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const pct = Math.min(100, Math.round((s.online / Math.max(1, s.limit)) * 100))
                return (
                  <Fragment key={s.id}>
                    <tr className="border-t border-slate-100 align-top hover:bg-slate-50/60">
                      <td className="px-3 py-3">
                        <p className="text-[13px] font-semibold text-slate-900">{s.title}</p>
                        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500"><span className="font-mono">{s.join_code}</span><AdminBadge tone={STATUS_TONE[s.status] ?? 'neutral'}>{STATUS_LABEL[s.status] ?? s.status}</AdminBadge><span>{s.tenant.name}</span></p>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {s.teachers.map((p) => (
                            <span key={`${p.id}-${p.role}`} title={`${p.email ?? ''} · ${ROLE_LABEL[p.role]}`} className={`admin-badge ${p.role === 'owner' ? 'admin-badge-accent' : 'admin-badge-neutral'}`}>
                              {p.name}{p.role === 'owner' ? ' · proprietario' : ''}{p.live_total ? ` · ${p.live_total} live` : ''}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="min-w-[11rem] px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#eceef1]"><span className={`block h-full rounded-full ${s.full ? 'bg-red-600' : s.near_full ? 'bg-amber-500' : 'bg-[var(--admin-accent)]'}`} style={{ width: `${pct}%` }} /></span>
                          <span className={`whitespace-nowrap font-bold tabular-nums ${s.full ? 'text-red-600' : 'text-slate-700'}`}>{s.online} / {s.limit}</span>
                        </div>
                        {s.full && <p className="mt-1 flex items-center gap-1 text-[10px] font-bold text-red-600"><AlertTriangle className="h-3 w-3" /> {tl("Piena: i nuovi studenti vengono rifiutati finché qualcuno esce")}</p>}
                        {s.frozen > 0 && <p className="mt-0.5 text-[10px] text-slate-400">{s.frozen} bloccati</p>}
                        {editing === s.id ? (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <Input value={limitDraft} onChange={(e) => setLimitDraft(e.target.value)} inputMode="numeric" className="h-7 w-20 text-xs" aria-label={tl("Nuovo limite per sessione")} />
                            {[100, 300, 500].map((n) => <button key={n} onClick={() => setLimitDraft(String(n))} className="rounded border border-[var(--admin-line)] bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 hover:bg-[var(--admin-surface-2)]">{n}</button>)}
                            <Button tone="accent" surface="solid" density="compact" disabled={raise.isPending} onClick={() => submitLimit(s.tenant.id)}>
                              {raise.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} {tl("Applica")}
                            </Button>
                            <button onClick={() => setEditing(null)} className="text-[10px] font-semibold text-slate-400 hover:text-slate-600">{tl("Annulla")}</button>
                          </div>
                        ) : (
                          <button onClick={() => { setEditing(s.id); setLimitDraft(String(Math.max(300, s.limit * 2))) }} className={`mt-1 text-[11px] font-semibold underline underline-offset-2 ${s.near_full ? 'text-[var(--admin-accent)]' : 'text-slate-500 hover:text-slate-800'}`} title={tl("Il limite vale per tutta l'organizzazione «{0}»", s.tenant.name)}>{tl("Alza il limite")}</button>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{s.registered}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-slate-600">{s.live_active ? <b className="text-emerald-700">{s.live_active} {tl("in corso")}</b> : <span className="text-slate-400">{s.live_total} create</span>}</td>
                      <td className="px-3 py-3 text-slate-500">{ago(s.last_activity)}</td>
                    </tr>
                  </Fragment>
                )
              })}
              {sessions.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-slate-400">{tl("Nessuna sessione nel periodo.")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {view === 'teachers' && data && (
        <div className="admin-panel overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-xs">
            <thead>
              <tr><th className="px-3 py-2">{tl("Docente")}</th><th className="px-3 py-2 text-right">{tl("Sessioni proprie")}</th><th className="px-3 py-2 text-right">{tl("Su sessioni altrui")}</th><th className="px-3 py-2 text-right">{tl("Live create")}</th>
                <th className="px-3 py-2 text-right">{tl("Studenti iscritti / online")}</th><th className="px-3 py-2">{tl("Ultima attività")}</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {data.teachers.map((t) => (
                <Fragment key={t.id}>
                  <tr className="border-t border-slate-100 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5"><p className="text-[13px] font-semibold text-slate-900">{t.name}{t.role === 'ADMIN' && <AdminBadge className="ml-1.5">ADMIN</AdminBadge>}</p><p className="text-[11px] text-slate-500">{t.email}</p></td>
                    <td className="px-3 text-right tabular-nums">{t.owned_sessions}</td>
                    <td className="px-3 text-right tabular-nums">{t.other_sessions ? <b>{t.other_sessions}</b> : 0}</td>
                    <td className="px-3 text-right tabular-nums">{t.live_total}{t.live_active > 0 && <span className="ml-1 font-semibold text-emerald-700">({t.live_active} {tl("in corso)")}</span>}</td>
                    <td className="px-3 text-right tabular-nums">{t.registered_students} / <b>{t.online_students}</b></td>
                    <td className="px-3 text-slate-500" title={t.last_login_at ? tl("Ultimo accesso {0}", new Date(t.last_login_at).toLocaleString('it-IT')) : undefined}>{ago(t.last_activity)}</td>
                    <td className="px-2 text-right">
                      {t.involved.length > 0 && <button onClick={() => setOpenTeacher(openTeacher === t.id ? null : t.id)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label={tl("Dettaglio sessioni")}>{openTeacher === t.id ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</button>}
                    </td>
                  </tr>
                  {openTeacher === t.id && (
                    <tr className="bg-[var(--admin-surface-2)]"><td colSpan={7} className="px-4 py-3">
                      <div className="grid gap-1.5 md:grid-cols-2">
                        {t.involved.map((item) => (
                          <div key={`${item.session_id}-${item.role}`} className="flex items-center gap-2 rounded-md border border-[var(--admin-line)] bg-white px-3 py-2 text-[11px]">
                            <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{item.title} <span className="font-mono text-[10px] font-normal text-slate-400">{item.join_code}</span></span>
                            <span className="text-slate-400">{ROLE_LABEL[item.role]}</span>
                            {item.live_total > 0 && <span className="font-semibold text-slate-800">{item.live_total} live</span>}
                            <span className={`tabular-nums ${item.online >= item.limit ? 'font-bold text-red-600' : 'text-slate-500'}`}>{item.online}/{item.limit}</span>
                          </div>
                        ))}
                      </div>
                    </td></tr>
                  )}
                </Fragment>
              ))}
              {data.teachers.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-slate-400">{tl("Nessun docente attivo nel periodo.")}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><Activity className="h-3.5 w-3.5" /><Users className="h-3.5 w-3.5" /> {tl("«Su sessioni altrui» conta le sessioni in cui il docente è co-docente o ha creato una live senza esserne il proprietario.")}</p>
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value?: number; hint?: string; tone?: 'red' | 'amber' }) {
  return <AdminStat label={label} value={value ?? '—'} hint={hint} tone={tone === 'red' ? 'danger' : tone === 'amber' ? 'warning' : 'neutral'} />
}
