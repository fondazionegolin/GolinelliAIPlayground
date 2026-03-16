import type { ComponentType } from 'react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import { Activity, DollarSign, Zap, Wifi } from 'lucide-react'

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

const formatCurrency = (value: number) => `€ ${Number(value || 0).toFixed(2)}`
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
  const dailyHistory = overview?.daily_history || []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Panoramica</h1>
          <p className="text-sm text-slate-500 mt-0.5">Monitor realtime — utenti online, API, costi.</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="period-days" className="text-xs text-slate-500 whitespace-nowrap">Periodo</Label>
          <Input
            id="period-days"
            type="number"
            min={1}
            max={180}
            value={days}
            onChange={(e) => setDays(Math.max(1, Math.min(180, Number(e.target.value || 30))))}
            className="h-8 w-20 text-sm"
          />
          <span className="text-xs text-slate-500">giorni</span>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <MetricCard
          title="Online ora"
          value={`${realtime?.online_total || 0}`}
          hint={`Studenti ${realtime?.online_students || 0} · Docenti ${realtime?.online_teachers || 0}`}
          icon={Wifi}
          color="sky"
        />
        <MetricCard
          title="Attivi recenti"
          value={`${realtime?.recent_students_2m || 0}`}
          hint={`Docenti 10min: ${realtime?.recent_active_teachers_10m || 0}`}
          icon={Activity}
          color="emerald"
        />
        <MetricCard
          title="Chiamate API"
          value={`${summary?.total_api_calls_period || 0}`}
          hint={`Ultimi ${summary?.period_days || days} giorni`}
          icon={Zap}
          color="violet"
        />
        <MetricCard
          title="Costo periodo"
          value={formatCurrency(summary?.total_cost_period || 0)}
          hint={`Docenti attivi: ${summary?.active_teachers_period || 0}`}
          icon={DollarSign}
          color="amber"
        />
      </div>

      {/* Chart + Sessions */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Chiamate e costi giornalieri</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyHistory}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="calls"
                  stroke="#0ea5e9"
                  strokeWidth={2}
                  dot={false}
                  name="Chiamate"
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="cost"
                  stroke="#e85c8d"
                  strokeWidth={2}
                  dot={false}
                  name="Costo €"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Sessioni attive</CardTitle>
            <CardDescription className="text-xs">Aggiornamento ogni 3s</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1.5 max-h-56 overflow-y-auto">
            {(realtime?.sessions_active || []).length === 0 ? (
              <p className="text-xs text-slate-400 py-2">Nessuna sessione attiva</p>
            ) : (
              (realtime?.sessions_active || []).map((session) => (
                <div
                  key={session.session_id}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5"
                >
                  <span className="font-mono text-[11px] text-slate-600">
                    {session.session_id.slice(0, 8)}…
                  </span>
                  <Badge className="bg-[#1a1a2e] text-white text-[10px]">
                    {session.online_students} studenti
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Online Users Table */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Utenti connessi in realtime</CardTitle>
          <CardDescription className="text-xs">Lista live socket (docenti e studenti)</CardDescription>
        </CardHeader>
        <CardContent>
          {(realtime?.users_online || []).length === 0 ? (
            <p className="text-xs text-slate-400 py-3">Nessun utente connesso</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase text-slate-400 border-b border-slate-100">
                    <th className="pb-2 font-medium">Tipo</th>
                    <th className="pb-2 font-medium">Nome</th>
                    <th className="pb-2 font-medium">Email</th>
                    <th className="pb-2 font-medium">Sessione</th>
                    <th className="pb-2 font-medium">Socket ID</th>
                  </tr>
                </thead>
                <tbody>
                  {(realtime?.users_online || []).map((u) => (
                    <tr key={u.sid} className="border-t border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="py-2">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                            u.type === 'teacher'
                              ? 'bg-[#1a1a2e]/10 text-[#1a1a2e]'
                              : 'bg-emerald-100 text-emerald-800'
                          }`}
                        >
                          {u.type === 'teacher' ? 'docente' : 'studente'}
                        </span>
                      </td>
                      <td className="py-2 font-medium text-slate-800">{u.name}</td>
                      <td className="py-2 text-xs text-slate-500">{u.email || '—'}</td>
                      <td className="py-2 font-mono text-xs text-slate-500">{u.session_id || '—'}</td>
                      <td className="py-2 font-mono text-xs text-slate-400">{u.sid.slice(0, 12)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function MetricCard({
  title,
  value,
  hint,
  icon: Icon,
  color,
}: {
  title: string
  value: string
  hint: string
  icon: ComponentType<{ className?: string }>
  color: 'sky' | 'emerald' | 'violet' | 'amber'
}) {
  const colorClasses: Record<string, string> = {
    sky: 'border-sky-200 bg-sky-50',
    emerald: 'border-emerald-200 bg-emerald-50',
    violet: 'border-violet-200 bg-violet-50',
    amber: 'border-amber-200 bg-amber-50',
  }
  const iconClasses: Record<string, string> = {
    sky: 'text-sky-600',
    emerald: 'text-emerald-600',
    violet: 'text-violet-600',
    amber: 'text-amber-600',
  }
  return (
    <Card className={`border ${colorClasses[color]}`}>
      <CardHeader className="flex flex-row items-center justify-between pb-1 pt-4 px-4">
        <CardTitle className="text-xs font-semibold text-slate-600">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${iconClasses[color]}`} />
      </CardHeader>
      <CardContent className="px-4 pb-4">
        <div className="text-2xl font-bold text-slate-900">{value}</div>
        <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>
      </CardContent>
    </Card>
  )
}
