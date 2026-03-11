import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, Legend,
} from 'recharts'
import { TrendingUp, Server, Cpu, GraduationCap } from 'lucide-react'

type OverviewData = {
  summary: { total_cost_period: number; total_api_calls_period: number; period_days: number }
  provider_breakdown: Array<{ provider: string; cost: number; calls: number }>
  model_breakdown: Array<{ model: string; cost: number; calls: number }>
  daily_history: Array<{ date: string; cost: number; calls: number }>
}

type TopConsumer = {
  teacher_id: string
  name: string
  email: string
  institution?: string | null
  cost: number
  calls: number
}

const formatCurrencyShort = (v: number) => `€ ${Number(v || 0).toFixed(2)}`

export default function CostsPage() {
  const [days, setDays] = useState(30)

  const { data: overview } = useQuery<OverviewData>({
    queryKey: ['admin-dashboard-overview', days],
    queryFn: async () => (await adminApi.getDashboardOverview(days)).data,
  })

  const { data: topConsumers } = useQuery<{ items: TopConsumer[] }>({
    queryKey: ['admin-top-consumers', days],
    queryFn: async () => (await adminApi.getTopConsumers(days, 25)).data,
  })

  const dailyHistory = overview?.daily_history || []
  const providerBreakdown = overview?.provider_breakdown || []
  const modelBreakdown = overview?.model_breakdown || []
  const topConsumerRows = topConsumers?.items || []
  const totalCost = overview?.summary?.total_cost_period || 0
  const totalCalls = overview?.summary?.total_api_calls_period || 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Costi & Consumi</h1>
          <p className="text-sm text-slate-500 mt-0.5">Breakdown per provider, modello e docente.</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="cost-days" className="text-xs text-slate-500 whitespace-nowrap">Periodo</Label>
          <Input
            id="cost-days"
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

      {/* Summary pills */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 flex items-center gap-3">
          <TrendingUp className="h-5 w-5 text-rose-500 flex-shrink-0" />
          <div>
            <p className="text-xs text-slate-500">Costo totale</p>
            <p className="text-xl font-bold text-slate-900">{formatCurrencyShort(totalCost)}</p>
          </div>
        </div>
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 flex items-center gap-3">
          <Cpu className="h-5 w-5 text-indigo-500 flex-shrink-0" />
          <div>
            <p className="text-xs text-slate-500">Chiamate API</p>
            <p className="text-xl font-bold text-slate-900">{totalCalls.toLocaleString('it-IT')}</p>
          </div>
        </div>
      </div>

      {/* Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold">Andamento giornaliero</CardTitle>
        </CardHeader>
        <CardContent className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={dailyHistory}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="calls" stroke="#6366f1" strokeWidth={2} dot={false} name="Chiamate" />
              <Line yAxisId="right" type="monotone" dataKey="cost" stroke="#e85c8d" strokeWidth={2} dot={false} name="Costo €" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Provider + Model breakdown */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Server className="h-4 w-4 text-slate-500" />
              Per provider
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {providerBreakdown.length === 0 ? (
              <p className="text-xs text-slate-400">Nessun dato</p>
            ) : (
              providerBreakdown.map((item) => {
                const pct = totalCost > 0 ? (item.cost / totalCost) * 100 : 0
                return (
                  <div key={item.provider} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium capitalize text-slate-700">{item.provider}</span>
                      <span className="font-semibold text-slate-900">{formatCurrencyShort(item.cost)}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#e85c8d]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Cpu className="h-4 w-4 text-slate-500" />
              Per modello
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {modelBreakdown.length === 0 ? (
              <p className="text-xs text-slate-400">Nessun dato</p>
            ) : (
              modelBreakdown.map((item) => (
                <div key={item.model} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <span className="font-mono text-xs text-slate-600 truncate max-w-[65%]">{item.model}</span>
                  <span className="text-xs font-semibold text-slate-800">{formatCurrencyShort(item.cost)}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Top consumers */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-slate-500" />
            Top consumatori — docenti
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {topConsumerRows.length === 0 ? (
            <p className="px-4 py-6 text-xs text-slate-400">Nessun dato</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-[11px] uppercase text-slate-400">
                    <th className="px-4 py-3 text-left font-medium">Docente</th>
                    <th className="px-3 py-3 text-left font-medium">Scuola</th>
                    <th className="px-3 py-3 text-right font-medium">Chiamate</th>
                    <th className="px-4 py-3 text-right font-medium">Costo</th>
                  </tr>
                </thead>
                <tbody>
                  {topConsumerRows.map((c, i) => (
                    <tr key={c.teacher_id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-bold flex items-center justify-center">
                            {i + 1}
                          </span>
                          <div>
                            <p className="font-medium text-slate-800">{c.name}</p>
                            <p className="text-xs text-slate-400">{c.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-xs text-slate-500">{c.institution || '—'}</td>
                      <td className="px-3 py-3 text-right text-xs text-slate-600">{c.calls.toLocaleString('it-IT')}</td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatCurrencyShort(c.cost)}</td>
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
