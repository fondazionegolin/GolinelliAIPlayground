import { formatInternalCredits, toCredits } from '@/lib/credits'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AdminBadge, AdminEmpty, AdminPageHeader, AdminSection, AdminStat, AdminStatGrid } from '@/components/admin/AdminUI'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts'
import { Activity, DollarSign, Zap, Wifi } from '@/components/icons'
import { tl } from '@/i18n/tl'

type OverviewData = {
  summary: {
    total_sessions: number
    total_students: number
    llm_messages_period: number
    total_cost_period: number
    total_api_calls_period: number
    active_teachers_period: number
    pending_invites: number
    period_days: number
  }
  daily_history: Array<{ date: string; cost: number; calls: number }>
}

type RealtimeStatus = {
  online_students: number
  online_teachers: number
  online_total: number
  recent_students_2m: number
  recent_active_teachers_10m: number
  sessions_active: Array<{ session_id: string; online_students: number }>
  users_online: Array<{
    sid: string
    type: 'teacher' | 'student'
    id: string
    name: string
    email?: string | null
    session_id?: string
  }>
  generated_at: string
}

const formatCurrency = (value: number) => formatInternalCredits(value)
export default function AdminOverviewPage() {
  const [days, setDays] = useState(30)

  const { data: overview } = useQuery<OverviewData>({
    queryKey: ['admin-dashboard-overview', days],
    queryFn: async () => (await adminApi.getDashboardOverview(days)).data,
  })

  const { data: realtime } = useQuery<RealtimeStatus>({
    queryKey: ['admin-realtime-status'],
    queryFn: async () => (await adminApi.getRealtimeStatus()).data,
    refetchInterval: 15000,
    refetchOnWindowFocus: false,
  })

  const summary = overview?.summary
  const dailyHistory = (overview?.daily_history || []).map((d) => ({ ...d, cost: toCredits(d.cost) }))

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={tl("Panoramica")}
        description={tl("Monitor realtime — utenti online, API, costi.")}
        actions={
          <div className="flex items-center gap-2">
            <Label htmlFor="period-days" className="whitespace-nowrap text-xs text-[var(--admin-ink-2)]">{tl("Periodo")}</Label>
            <Input
              id="period-days"
              type="number"
              min={1}
              max={180}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(180, Number(e.target.value || 30))))}
              className="h-8 w-20 text-sm"
            />
            <span className="text-xs text-[var(--admin-ink-2)]">{tl("giorni")}</span>
          </div>
        }
      />

      <AdminStatGrid>
        <AdminStat
          label={tl("Online ora")}
          value={`${realtime?.online_total || 0}`}
          hint={tl("Studenti {0} · Docenti {1}", realtime?.online_students || 0, realtime?.online_teachers || 0)}
          icon={Wifi}
        />
        <AdminStat
          label={tl("Attivi recenti")}
          value={`${realtime?.recent_students_2m || 0}`}
          hint={tl("Docenti 10min: {0}", realtime?.recent_active_teachers_10m || 0)}
          icon={Activity}
        />
        <AdminStat
          label={tl("Chiamate API")}
          value={`${summary?.total_api_calls_period || 0}`}
          hint={tl("Ultimi {0} giorni", summary?.period_days || days)}
          icon={Zap}
        />
        <AdminStat
          label={tl("Costo periodo")}
          value={formatCurrency(summary?.total_cost_period || 0)}
          hint={tl("Docenti attivi: {0}", summary?.active_teachers_period || 0)}
          icon={DollarSign}
        />
      </AdminStatGrid>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <AdminSection title={tl("Chiamate e costi giornalieri")} className="xl:col-span-2" bodyClassName="h-72 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dailyHistory}>
              <CartesianGrid stroke="#eceef1" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#5f6470' }} tickLine={false} axisLine={{ stroke: '#cfd4dc' }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11, fill: '#5f6470' }} tickLine={false} axisLine={false} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11, fill: '#5f6470' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e5ea', fontSize: 12 }} />
              <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
              <Line yAxisId="left" type="monotone" dataKey="calls" stroke="#55449c" strokeWidth={2} dot={false} name="Chiamate" />
              <Line yAxisId="right" type="monotone" dataKey="cost" stroke="#9aa0aa" strokeWidth={2} dot={false} name="Crediti consumati" />
            </LineChart>
          </ResponsiveContainer>
        </AdminSection>

        <AdminSection title={tl("Sessioni attive")} description={tl("Aggiornamento ogni 3s")} flush>
          <div className="max-h-72 overflow-y-auto">
            {(realtime?.sessions_active || []).length === 0 ? (
              <AdminEmpty>{tl("Nessuna sessione attiva")}</AdminEmpty>
            ) : (
              (realtime?.sessions_active || []).map((session) => (
                <div key={session.session_id} className="flex items-center justify-between border-b border-[var(--admin-line)] px-4 py-2 last:border-b-0">
                  <span className="font-mono text-xs text-[var(--admin-ink-2)]">{session.session_id.slice(0, 8)}…</span>
                  <span className="text-xs font-semibold text-[var(--admin-ink)] tabular-nums">
                    {session.online_students} {tl("studenti")}
                  </span>
                </div>
              ))
            )}
          </div>
        </AdminSection>
      </div>

      <AdminSection title={tl("Utenti connessi in realtime")} description={tl("Lista live socket (docenti e studenti)")} flush>
        {(realtime?.users_online || []).length === 0 ? (
          <AdminEmpty>{tl("Nessun utente connesso")}</AdminEmpty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr>
                  <th>{tl("Tipo")}</th>
                  <th>{tl("Nome")}</th>
                  <th>{tl("Email")}</th>
                  <th>{tl("Sessione")}</th>
                  <th>Socket ID</th>
                </tr>
              </thead>
              <tbody>
                {(realtime?.users_online || []).map((u) => (
                  <tr key={u.sid}>
                    <td>
                      <AdminBadge tone={u.type === 'teacher' ? 'accent' : 'neutral'}>
                        {u.type === 'teacher' ? tl("docente") : tl("studente")}
                      </AdminBadge>
                    </td>
                    <td className="font-medium">{u.name}</td>
                    <td className="text-xs text-[var(--admin-ink-2)]">{u.email || '—'}</td>
                    <td className="font-mono text-xs text-[var(--admin-ink-2)]">{u.session_id || '—'}</td>
                    <td className="font-mono text-xs text-[var(--admin-ink-3)]">{u.sid.slice(0, 12)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </AdminSection>
    </div>
  )
}
