import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  Activity,
  CalendarDays,
  Cpu,
  Download,
  GraduationCap,
  Mail,
  RefreshCw,
  TrendingUp,
  Users,
  Zap,
} from 'lucide-react'

type Granularity = 'day' | 'week' | 'month'

type AnalyticsRow = {
  bucket_start: string
  period_start: string
  period_end: string
  period_label: string
  active_users: number
  active_students: number
  connected_user_emails: string[]
  api_calls: number
  cost: number
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  avg_tokens_per_call: number
}

type PeakValue = {
  period_start: string | null
  period_end: string | null
  value: number
}

type AnalyticsReport = {
  filters: {
    start_date: string
    end_date: string
    granularity: Granularity
  }
  summary: {
    registered_users_scope: number
    registered_students_scope: number
    students_joined_period: number
    active_users_period: number
    active_students_period: number
    total_api_calls: number
    total_cost: number
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    average_active_users_per_bucket: number
    average_active_students_per_bucket: number
    average_api_calls_per_bucket: number
    average_tokens_per_bucket: number
    average_tokens_per_call: number
    peak_active_users: PeakValue
    peak_active_students: PeakValue
    peak_api_calls: PeakValue
    peak_tokens: PeakValue
    peak_cost: PeakValue
  }
  rows: AnalyticsRow[]
  provider_breakdown: Array<{ provider: string; calls: number; cost: number; total_tokens: number }>
  model_breakdown: Array<{ model: string; calls: number; cost: number; total_tokens: number }>
  top_users: Array<{
    user_id: string
    name: string
    email: string
    api_calls: number
    cost: number
    total_tokens: number
    active_days: number
    last_activity_at: string | null
  }>
  filter_options: {
    providers: string[]
    models: string[]
  }
}

type TeacherStatusResponse = {
  items: Array<{
    id: string
    first_name?: string | null
    last_name?: string | null
    email: string
    role: string
  }>
}

type AdminClassesResponse = {
  items: Array<{
    class_id: string
    class_name: string
    teacher_id: string
    teacher_email: string
    sessions: Array<{
      session_id: string
      title: string
      status: string
    }>
  }>
}

const numberFormatter = new Intl.NumberFormat('it-IT')
const compactFormatter = new Intl.NumberFormat('it-IT', { notation: 'compact', maximumFractionDigits: 1 })

const formatCurrency = (value: number) => `€ ${Number(value || 0).toFixed(2)}`
const formatNumber = (value: number) => numberFormatter.format(Math.round(Number(value || 0)))
const formatCompact = (value: number) => compactFormatter.format(Number(value || 0))

function toDateInput(value: Date) {
  return value.toISOString().slice(0, 10)
}

function shiftedDate(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toDateInput(date)
}

function formatPeriod(start?: string | null, end?: string | null) {
  if (!start) return '—'
  if (!end || start === end) return new Date(start).toLocaleDateString('it-IT')
  return `${new Date(start).toLocaleDateString('it-IT')} - ${new Date(end).toLocaleDateString('it-IT')}`
}

function escapeCsv(value: string | number) {
  const raw = String(value ?? '')
  if (!/[",\n]/.test(raw)) return raw
  return `"${raw.replace(/"/g, '""')}"`
}

export default function CostsPage() {
  const [startDate, setStartDate] = useState(() => shiftedDate(-29))
  const [endDate, setEndDate] = useState(() => shiftedDate(0))
  const [granularity, setGranularity] = useState<Granularity>('day')
  const [teacherId, setTeacherId] = useState('')
  const [classId, setClassId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [provider, setProvider] = useState('')
  const [model, setModel] = useState('')
  const [includeEmpty, setIncludeEmpty] = useState(true)
  const [teacherReportDownloading, setTeacherReportDownloading] = useState(false)

  const reportParams = useMemo(() => ({
    start_date: startDate,
    end_date: endDate,
    granularity,
    teacher_id: teacherId || undefined,
    class_id: classId || undefined,
    session_id: sessionId || undefined,
    provider: provider.trim() || undefined,
    model: model.trim() || undefined,
    include_empty: includeEmpty,
  }), [classId, endDate, granularity, includeEmpty, model, provider, sessionId, startDate, teacherId])

  const { data: report, isLoading, isFetching, refetch } = useQuery<AnalyticsReport>({
    queryKey: ['admin-analytics-report', reportParams],
    queryFn: async () => (await adminApi.getAnalyticsReport(reportParams)).data,
  })

  const { data: teachers } = useQuery<TeacherStatusResponse>({
    queryKey: ['admin-teacher-status', 180],
    queryFn: async () => (await adminApi.getTeachersStatus(180)).data,
  })

  const { data: classes } = useQuery<AdminClassesResponse>({
    queryKey: ['admin-classes'],
    queryFn: async () => (await adminApi.getAdminClasses()).data,
  })

  const classOptions = classes?.items || []
  const sessionOptions = useMemo(() => {
    return classOptions
      .flatMap((item) => item.sessions.map((session) => ({
        ...session,
        class_id: item.class_id,
        class_name: item.class_name,
      })))
      .filter((session) => !classId || session.class_id === classId)
  }, [classId, classOptions])

  const rows = report?.rows || []
  const summary = report?.summary
  const providerOptions = report?.filter_options?.providers || []
  const modelOptions = report?.filter_options?.models || []

  const exportCsv = () => {
    if (rows.length === 0) return
    const header = [
      'periodo_inizio',
      'periodo_fine',
      'utenti_attivi',
      'studenti_connessi',
      'chiamate_api',
      'prompt_tokens',
      'completion_tokens',
      'total_tokens',
      'media_token_chiamata',
      'costo',
      'email_utenti_connessi',
    ]
    const body = rows.map((row) => [
      row.period_start,
      row.period_end,
      row.active_users,
      row.active_students,
      row.api_calls,
      row.prompt_tokens,
      row.completion_tokens,
      row.total_tokens,
      row.avg_tokens_per_call,
      row.cost.toFixed(4),
      row.connected_user_emails.join('; '),
    ].map(escapeCsv).join(','))
    const blob = new Blob([[header.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `admin-analytics-${startDate}-${endDate}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const downloadTeacherUsageReport = async () => {
    setTeacherReportDownloading(true)
    try {
      const response = await adminApi.downloadTeacherUsageReport({
        start_date: startDate,
        end_date: endDate,
        include_inactive: true,
      })
      const blob = new Blob([response.data], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `admin-usage-docenti-${startDate}-${endDate}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } finally {
      setTeacherReportDownloading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Analytics & Consumi</h1>
          <p className="mt-0.5 text-sm text-slate-500">Reportistica per periodo, utenti, studenti, token e picchi.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
            Aggiorna
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            CSV
          </button>
          <button
            type="button"
            onClick={downloadTeacherUsageReport}
            disabled={teacherReportDownloading}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-emerald-700 px-3 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            {teacherReportDownloading ? 'Download...' : 'Report docenti'}
          </button>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <CalendarDays className="h-4 w-4 text-slate-500" />
            Filtri report
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="analytics-start" className="text-xs text-slate-500">Da</Label>
              <Input id="analytics-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="analytics-end" className="text-xs text-slate-500">A</Label>
              <Input id="analytics-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="analytics-granularity" className="text-xs text-slate-500">Raggruppamento</Label>
              <select
                id="analytics-granularity"
                value={granularity}
                onChange={(e) => setGranularity(e.target.value as Granularity)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-200"
              >
                <option value="day">Giorno</option>
                <option value="week">Settimana</option>
                <option value="month">Mese</option>
              </select>
            </div>
            <div className="flex items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <input
                id="analytics-empty"
                type="checkbox"
                checked={includeEmpty}
                onChange={(e) => setIncludeEmpty(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              <Label htmlFor="analytics-empty" className="text-sm text-slate-600">Periodi vuoti</Label>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="analytics-teacher" className="text-xs text-slate-500">Utente</Label>
              <select
                id="analytics-teacher"
                value={teacherId}
                onChange={(e) => {
                  setTeacherId(e.target.value)
                  setClassId('')
                  setSessionId('')
                }}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-200"
              >
                <option value="">Tutti</option>
                {(teachers?.items || []).map((teacher) => {
                  const name = [teacher.first_name, teacher.last_name].filter(Boolean).join(' ') || teacher.email
                  return (
                    <option key={teacher.id} value={teacher.id}>
                      {name} ({teacher.email})
                    </option>
                  )
                })}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="analytics-class" className="text-xs text-slate-500">Classe</Label>
              <select
                id="analytics-class"
                value={classId}
                onChange={(e) => {
                  setClassId(e.target.value)
                  setSessionId('')
                }}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-200"
              >
                <option value="">Tutte</option>
                {classOptions.map((item) => (
                  <option key={item.class_id} value={item.class_id}>
                    {item.class_name} ({item.teacher_email})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="analytics-session" className="text-xs text-slate-500">Sessione</Label>
              <select
                id="analytics-session"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-200"
              >
                <option value="">Tutte</option>
                {sessionOptions.map((session) => (
                  <option key={session.session_id} value={session.session_id}>
                    {session.title} · {session.class_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="analytics-provider" className="text-xs text-slate-500">Provider</Label>
                <Input
                  id="analytics-provider"
                  list="analytics-provider-options"
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder="tutti"
                  className="h-9 text-sm"
                />
                <datalist id="analytics-provider-options">
                  {providerOptions.map((item) => <option key={item} value={item} />)}
                </datalist>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="analytics-model" className="text-xs text-slate-500">Modello</Label>
                <Input
                  id="analytics-model"
                  list="analytics-model-options"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="tutti"
                  className="h-9 text-sm"
                />
                <datalist id="analytics-model-options">
                  {modelOptions.map((item) => <option key={item} value={item} />)}
                </datalist>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <MetricTile
          icon={Users}
          label="Utenti attivi"
          value={formatNumber(summary?.active_users_period || 0)}
          hint={`${formatNumber(summary?.registered_users_scope || 0)} nel perimetro`}
          tone="slate"
        />
        <MetricTile
          icon={GraduationCap}
          label="Studenti connessi"
          value={formatNumber(summary?.active_students_period || 0)}
          hint={`${formatNumber(summary?.students_joined_period || 0)} nuovi nel periodo`}
          tone="emerald"
        />
        <MetricTile
          icon={Cpu}
          label="Token"
          value={formatCompact(summary?.total_tokens || 0)}
          hint={`${formatCompact(summary?.average_tokens_per_bucket || 0)} media`}
          tone="indigo"
        />
        <MetricTile
          icon={Zap}
          label="Chiamate"
          value={formatNumber(summary?.total_api_calls || 0)}
          hint={`${formatNumber(summary?.average_api_calls_per_bucket || 0)} media`}
          tone="sky"
        />
        <MetricTile
          icon={TrendingUp}
          label="Costo"
          value={formatCurrency(summary?.total_cost || 0)}
          hint={formatPeriod(report?.filters?.start_date, report?.filters?.end_date)}
          tone="amber"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Activity className="h-4 w-4 text-slate-500" />
              Andamento periodo
            </CardTitle>
          </CardHeader>
          <CardContent className="h-72">
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-400">Caricamento...</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={rows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="period_label" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(value: number) => numberFormatter.format(Number(value || 0))} />
                  <Legend />
                  <Line yAxisId="left" type="monotone" dataKey="active_users" stroke="#0f766e" strokeWidth={2} dot={false} name="Utenti" />
                  <Line yAxisId="left" type="monotone" dataKey="active_students" stroke="#2563eb" strokeWidth={2} dot={false} name="Studenti" />
                  <Line yAxisId="right" type="monotone" dataKey="total_tokens" stroke="#9333ea" strokeWidth={2} dot={false} name="Token" />
                  <Line yAxisId="right" type="monotone" dataKey="api_calls" stroke="#f59e0b" strokeWidth={2} dot={false} name="Chiamate" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Picchi e medie</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <PeakRow label="Picco utenti" value={summary?.peak_active_users.value || 0} period={formatPeriod(summary?.peak_active_users.period_start, summary?.peak_active_users.period_end)} />
            <PeakRow label="Picco studenti" value={summary?.peak_active_students.value || 0} period={formatPeriod(summary?.peak_active_students.period_start, summary?.peak_active_students.period_end)} />
            <PeakRow label="Picco token" value={summary?.peak_tokens.value || 0} period={formatPeriod(summary?.peak_tokens.period_start, summary?.peak_tokens.period_end)} compact />
            <PeakRow label="Media token/chiamata" value={summary?.average_tokens_per_call || 0} period="Periodo" compact />
            <PeakRow label="Costo massimo" value={summary?.peak_cost.value || 0} period={formatPeriod(summary?.peak_cost.period_start, summary?.peak_cost.period_end)} currency />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Mail className="h-4 w-4 text-slate-500" />
            Tabella report
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-400">Nessun dato nel periodo selezionato</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[11px] uppercase text-slate-400">
                    <th className="px-4 py-3 font-medium">Periodo</th>
                    <th className="px-3 py-3 text-right font-medium">Utenti</th>
                    <th className="px-3 py-3 text-right font-medium">Studenti</th>
                    <th className="px-3 py-3 text-right font-medium">Chiamate</th>
                    <th className="px-3 py-3 text-right font-medium">Token</th>
                    <th className="px-3 py-3 text-right font-medium">Costo</th>
                    <th className="px-4 py-3 font-medium">Email utenti connessi</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.bucket_start} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{formatPeriod(row.period_start, row.period_end)}</td>
                      <td className="px-3 py-3 text-right text-slate-700">{formatNumber(row.active_users)}</td>
                      <td className="px-3 py-3 text-right text-slate-700">{formatNumber(row.active_students)}</td>
                      <td className="px-3 py-3 text-right text-slate-700">{formatNumber(row.api_calls)}</td>
                      <td className="px-3 py-3 text-right font-mono text-xs text-slate-600">{formatNumber(row.total_tokens)}</td>
                      <td className="px-3 py-3 text-right font-semibold text-slate-800">{formatCurrency(row.cost)}</td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {row.connected_user_emails.length === 0 ? '—' : row.connected_user_emails.join(', ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <BreakdownTable
          title="Provider"
          items={(report?.provider_breakdown || []).map((item) => ({
            key: item.provider,
            calls: item.calls,
            tokens: item.total_tokens,
            cost: item.cost,
          }))}
        />
        <BreakdownTable
          title="Modelli"
          items={(report?.model_breakdown || []).slice(0, 12).map((item) => ({
            key: item.model,
            calls: item.calls,
            tokens: item.total_tokens,
            cost: item.cost,
          }))}
        />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Utenti per consumo token</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {(report?.top_users || []).length === 0 ? (
              <p className="px-4 py-6 text-xs text-slate-400">Nessun dato</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-[11px] uppercase text-slate-400">
                      <th className="px-4 py-3 font-medium">Utente</th>
                      <th className="px-3 py-3 text-right font-medium">Token</th>
                      <th className="px-4 py-3 text-right font-medium">Costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(report?.top_users || []).slice(0, 10).map((user) => (
                      <tr key={user.user_id} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{user.name}</p>
                          <p className="text-xs text-slate-400">{user.email}</p>
                        </td>
                        <td className="px-3 py-3 text-right font-mono text-xs text-slate-600">{formatNumber(user.total_tokens)}</td>
                        <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatCurrency(user.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function MetricTile({
  icon: Icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: typeof Users
  label: string
  value: string
  hint: string
  tone: 'slate' | 'emerald' | 'indigo' | 'sky' | 'amber'
}) {
  const toneClasses: Record<typeof tone, string> = {
    slate: 'border-slate-200 bg-slate-50 text-slate-600',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
    sky: 'border-sky-200 bg-sky-50 text-sky-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
  }
  return (
    <div className={`rounded-lg border px-4 py-3 ${toneClasses[tone]}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500">{label}</p>
        <Icon className="h-4 w-4 flex-shrink-0" />
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-0.5 text-[11px] text-slate-500">{hint}</p>
    </div>
  )
}

function PeakRow({
  label,
  value,
  period,
  compact,
  currency,
}: {
  label: string
  value: number
  period: string
  compact?: boolean
  currency?: boolean
}) {
  const formatted = currency ? formatCurrency(value) : compact ? formatCompact(value) : formatNumber(value)
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div>
        <p className="text-xs font-medium text-slate-700">{label}</p>
        <p className="text-[11px] text-slate-400">{period}</p>
      </div>
      <p className="text-sm font-bold text-slate-900">{formatted}</p>
    </div>
  )
}

function BreakdownTable({
  title,
  items,
}: {
  title: string
  items: Array<{ key: string; calls: number; tokens: number; cost: number }>
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <p className="px-4 py-6 text-xs text-slate-400">Nessun dato</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[11px] uppercase text-slate-400">
                  <th className="px-4 py-3 font-medium">Nome</th>
                  <th className="px-3 py-3 text-right font-medium">Chiamate</th>
                  <th className="px-3 py-3 text-right font-medium">Token</th>
                  <th className="px-4 py-3 text-right font-medium">Costo</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.key} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="max-w-[180px] truncate px-4 py-3 font-mono text-xs text-slate-700">{item.key}</td>
                    <td className="px-3 py-3 text-right text-xs text-slate-600">{formatNumber(item.calls)}</td>
                    <td className="px-3 py-3 text-right font-mono text-xs text-slate-600">{formatNumber(item.tokens)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatCurrency(item.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
