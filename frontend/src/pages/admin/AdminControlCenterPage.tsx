import type { ComponentType } from 'react'
import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
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
import { Activity, DollarSign, Users, Zap } from 'lucide-react'

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
  provider_breakdown: Array<{ provider: string; cost: number }>
  model_breakdown: Array<{ model: string; cost: number }>
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

type TeacherStatus = {
  id: string
  first_name?: string | null
  last_name?: string | null
  email: string
  institution?: string | null
  is_verified: boolean
  last_login_at?: string | null
  period_cost: number
  period_calls: number
}

type RealtimeStatus = {
  online_students: number
  online_teachers: number
  online_total: number
  recent_students_2m: number
  recent_active_teachers_10m: number
  sessions_active: Array<{ session_id: string; online_students: number }>
  users_online: Array<{ sid: string; type: 'teacher' | 'student'; id: string; name: string; email?: string | null; session_id?: string }>
  generated_at: string
}

type TemplateEntry = {
  label: string
  description: string
  placeholders: string[]
  subject: string
  html: string
  text: string
}

type EmailTemplatesPayload = Record<string, TemplateEntry>
type TemplateHistoryResponse = {
  template_key: string
  items: Array<{
    id: string
    version: number
    subject: string
    html: string
    text: string
    created_at?: string | null
    updated_by?: { id?: string | null; email?: string | null; name?: string | null }
  }>
}

const formatCurrency = (value: number) => `€ ${Number(value || 0).toFixed(2)}`

const formatDateTime = (raw?: string | null) => {
  if (!raw) return 'N/D'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return 'N/D'
  return date.toLocaleString('it-IT')
}

export default function AdminControlCenterPage() {
  const [days, setDays] = useState(30)
  const [activeTab, setActiveTab] = useState('dashboard')
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const { data: overview } = useQuery<OverviewData>({
    queryKey: ['admin-dashboard-overview', days],
    queryFn: async () => (await adminApi.getDashboardOverview(days)).data,
  })

  const { data: topConsumers } = useQuery<{ items: TopConsumer[] }>({
    queryKey: ['admin-top-consumers', days],
    queryFn: async () => (await adminApi.getTopConsumers(days, 25)).data,
  })

  const { data: teachersStatus } = useQuery<{ items: TeacherStatus[] }>({
    queryKey: ['admin-teacher-status', days],
    queryFn: async () => (await adminApi.getTeachersStatus(days)).data,
  })

  const { data: realtime } = useQuery<RealtimeStatus>({
    queryKey: ['admin-realtime-status'],
    queryFn: async () => (await adminApi.getRealtimeStatus()).data,
    refetchInterval: 3000,
  })

  const { data: emailTemplates } = useQuery<EmailTemplatesPayload>({
    queryKey: ['admin-email-templates'],
    queryFn: async () => (await adminApi.getEmailTemplates()).data,
  })

  const [templateKey, setTemplateKey] = useState('teacher_activation')
  const [templateDrafts, setTemplateDrafts] = useState<EmailTemplatesPayload>({})
  const { data: templateHistory } = useQuery<TemplateHistoryResponse>({
    queryKey: ['admin-email-templates-history', templateKey],
    queryFn: async () => (await adminApi.getEmailTemplateHistory(templateKey, 15)).data,
    enabled: Boolean(templateKey),
  })

  const saveTemplatesMutation = useMutation({
    mutationFn: async () =>
      adminApi.updateEmailTemplates(templateDrafts as any),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-email-templates'] })
      await queryClient.invalidateQueries({ queryKey: ['admin-email-templates-history', templateKey] })
      toast({ title: 'Template email aggiornati' })
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Errore salvataggio template',
        description: error?.response?.data?.detail || 'Impossibile salvare',
      })
    },
  })
  const resetTemplateMutation = useMutation({
    mutationFn: async () => adminApi.resetEmailTemplate(templateKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-email-templates'] })
      await queryClient.invalidateQueries({ queryKey: ['admin-email-templates-history', templateKey] })
      toast({ title: 'Template ripristinato ai valori predefiniti' })
    },
    onError: (error: any) => {
      toast({
        variant: 'destructive',
        title: 'Errore ripristino',
        description: error?.response?.data?.detail || 'Impossibile ripristinare',
      })
    },
  })

  useEffect(() => {
    if (!emailTemplates) return
    setTemplateDrafts(emailTemplates)
    if (!emailTemplates[templateKey]) {
      const firstKey = Object.keys(emailTemplates)[0]
      if (firstKey) setTemplateKey(firstKey)
    }
  }, [emailTemplates])

  const selectedTemplate = templateDrafts[templateKey]

  const updateSelectedTemplate = (patch: Partial<TemplateEntry>) => {
    if (!selectedTemplate) return
    setTemplateDrafts((prev) => ({
      ...prev,
      [templateKey]: {
        ...prev[templateKey],
        ...patch,
      },
    }))
  }

  const summary = overview?.summary
  const dailyHistory = overview?.daily_history || []
  const providerBreakdown = overview?.provider_breakdown || []
  const modelBreakdown = overview?.model_breakdown || []
  const topConsumerRows = topConsumers?.items || []
  const teacherStatusRows = teachersStatus?.items || []

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-800 bg-slate-900 px-5 py-4 text-white">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-xl font-bold">Cruscotto Operativo Admin</h2>
            <p className="text-sm text-slate-300">Monitor realtime di utenti, costi API, consumi per docente e storico utilizzo.</p>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="period-days" className="text-xs text-slate-300">Periodo</Label>
            <Input
              id="period-days"
              type="number"
              min={1}
              max={180}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(180, Number(e.target.value || 30))))}
              className="h-8 w-24 border-slate-600 bg-slate-800 text-white"
            />
            <span className="text-xs text-slate-300">giorni</span>
          </div>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid h-auto grid-cols-1 gap-2 bg-transparent p-0 md:grid-cols-4">
          <TabsTrigger value="dashboard" className="border border-slate-300 bg-white data-[state=active]:bg-slate-900 data-[state=active]:text-white">Cruscotto</TabsTrigger>
          <TabsTrigger value="teachers" className="border border-slate-300 bg-white data-[state=active]:bg-slate-900 data-[state=active]:text-white">Docenti</TabsTrigger>
          <TabsTrigger value="costs" className="border border-slate-300 bg-white data-[state=active]:bg-slate-900 data-[state=active]:text-white">Costi & Consumi</TabsTrigger>
          <TabsTrigger value="emails" className="border border-slate-300 bg-white data-[state=active]:bg-slate-900 data-[state=active]:text-white">Email</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Online Socket" value={`${realtime?.online_total || 0}`} hint={`S ${realtime?.online_students || 0} · D ${realtime?.online_teachers || 0}`} icon={Activity} color="sky" />
            <MetricCard title="Attivi Recenti" value={`${realtime?.recent_students_2m || 0}`} hint={`Docenti attivi 10m: ${realtime?.recent_active_teachers_10m || 0}`} icon={Users} color="emerald" />
            <MetricCard title="Chiamate API" value={`${summary?.total_api_calls_period || 0}`} hint={`${summary?.period_days || days} giorni`} icon={Zap} color="violet" />
            <MetricCard title="Costo Periodo" value={formatCurrency(summary?.total_cost_period || 0)} hint={`Docenti attivi: ${summary?.active_teachers_period || 0}`} icon={DollarSign} color="amber" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2 border-slate-300">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Andamento chiamate/costi</CardTitle>
                <CardDescription className="text-xs">Realtime refresh + storico giornaliero.</CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyHistory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="calls" stroke="#0ea5e9" strokeWidth={2.5} dot={false} name="Chiamate" />
                    <Line yAxisId="right" type="monotone" dataKey="cost" stroke="#f59e0b" strokeWidth={2.5} dot={false} name="Costo" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card className="border-slate-300">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Sessioni connesse</CardTitle>
                <CardDescription className="text-xs">Aggiornamento ogni 3s</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(realtime?.sessions_active || []).slice(0, 8).map((session) => (
                  <div key={session.session_id} className="flex items-center justify-between rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5">
                    <span className="font-mono text-[11px] text-slate-700">{session.session_id.slice(0, 8)}</span>
                    <Badge className="bg-slate-900">{session.online_students}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="border-slate-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Utenti connessi in realtime</CardTitle>
              <CardDescription className="text-xs">Elenco live socket (docenti e studenti)</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="text-left text-xs uppercase text-slate-600">
                    <tr>
                      <th className="pb-2">Tipo</th>
                      <th className="pb-2">Nome</th>
                      <th className="pb-2">Email</th>
                      <th className="pb-2">Sessione</th>
                      <th className="pb-2">Socket ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(realtime?.users_online || []).map((u) => (
                      <tr key={u.sid} className="border-t border-slate-200">
                        <td className="py-2">
                          <Badge variant={u.type === 'teacher' ? 'default' : 'secondary'}>
                            {u.type === 'teacher' ? 'docente' : 'studente'}
                          </Badge>
                        </td>
                        <td className="py-2">{u.name}</td>
                        <td className="py-2 text-xs text-slate-600">{u.email || 'N/D'}</td>
                        <td className="py-2 font-mono text-xs">{u.session_id || 'N/D'}</td>
                        <td className="py-2 font-mono text-xs">{u.sid.slice(0, 12)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="teachers">
          <Card className="border-slate-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Status Docenti</CardTitle>
              <CardDescription className="text-xs">Stato account, ultimo login, consumi e costo nel periodo.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-sm">
                  <thead className="text-left text-xs uppercase text-slate-600">
                    <tr>
                      <th className="pb-2">Docente</th>
                      <th className="pb-2">Scuola</th>
                      <th className="pb-2">Verifica</th>
                      <th className="pb-2">Ultimo Login</th>
                      <th className="pb-2">Chiamate</th>
                      <th className="pb-2">Costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teacherStatusRows.map((teacher) => (
                      <tr key={teacher.id} className="border-t border-slate-200">
                        <td className="py-2">
                          <div className="font-semibold text-slate-900">{[teacher.first_name, teacher.last_name].filter(Boolean).join(' ') || teacher.email}</div>
                          <div className="text-xs text-slate-500">{teacher.email}</div>
                        </td>
                        <td className="py-2">{teacher.institution || 'N/D'}</td>
                        <td className="py-2">
                          <Badge variant={teacher.is_verified ? 'default' : 'secondary'}>
                            {teacher.is_verified ? 'verificato' : 'in attesa'}
                          </Badge>
                        </td>
                        <td className="py-2">{formatDateTime(teacher.last_login_at)}</td>
                        <td className="py-2">{teacher.period_calls}</td>
                        <td className="py-2 font-semibold">{formatCurrency(teacher.period_cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="costs" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card className="border-slate-300">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Costo per provider</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {providerBreakdown.map((item) => (
                  <div key={item.provider} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                    <span className="capitalize">{item.provider}</span>
                    <span className="font-semibold">{formatCurrency(item.cost)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="border-slate-300">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Costo per modello</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {modelBreakdown.map((item) => (
                  <div key={item.model} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                    <span className="font-mono text-xs">{item.model}</span>
                    <span className="font-semibold">{formatCurrency(item.cost)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card className="border-slate-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Top consumatori API</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-left text-xs uppercase text-slate-600">
                    <tr>
                      <th className="pb-2">Docente</th>
                      <th className="pb-2">Scuola</th>
                      <th className="pb-2">Chiamate</th>
                      <th className="pb-2">Costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topConsumerRows.map((consumer) => (
                      <tr key={consumer.teacher_id} className="border-t border-slate-200">
                        <td className="py-2">
                          <div className="font-semibold">{consumer.name}</div>
                          <div className="text-xs text-slate-500">{consumer.email}</div>
                        </td>
                        <td className="py-2">{consumer.institution || 'N/D'}</td>
                        <td className="py-2">{consumer.calls}</td>
                        <td className="py-2 font-semibold">{formatCurrency(consumer.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="emails" className="space-y-4">
          <Card className="border-slate-300">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Messaggi Automatici & Disclaimer</CardTitle>
              <CardDescription className="text-xs">
                Editor per i casi d'uso automatici: conferma utente, invito, cambio password e disclaimer beta in login.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Caso d'uso</Label>
                <select
                  className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                  value={templateKey}
                  onChange={(e) => setTemplateKey(e.target.value)}
                >
                  {Object.entries(templateDrafts).map(([key, tpl]) => (
                    <option key={key} value={key}>
                      {tpl.label}
                    </option>
                  ))}
                </select>
                {selectedTemplate && (
                  <p className="text-xs text-slate-600">{selectedTemplate.description}</p>
                )}
                {selectedTemplate?.placeholders?.length ? (
                  <p className="text-xs text-slate-600">
                    Variabili: {selectedTemplate.placeholders.join(', ')}
                  </p>
                ) : null}
              </div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label>Oggetto</Label>
                    <Input value={selectedTemplate?.subject || ''} onChange={(e) => updateSelectedTemplate({ subject: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>HTML (supporta CSS inline e blocchi style)</Label>
                    <Textarea
                      className="min-h-[260px] font-mono text-xs"
                      value={selectedTemplate?.html || ''}
                      onChange={(e) => updateSelectedTemplate({ html: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Testo piano (fallback)</Label>
                    <Textarea
                      className="min-h-[140px] font-mono text-xs"
                      value={selectedTemplate?.text || ''}
                      onChange={(e) => updateSelectedTemplate({ text: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="rounded-md border border-slate-300 bg-white">
                    <div className="border-b border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700">Anteprima live</div>
                    <div className="max-h-[420px] overflow-auto p-3">
                      <div
                        className="prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: selectedTemplate?.html || '<p>Nessun contenuto HTML</p>' }}
                      />
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-300 bg-slate-50 p-3">
                    <p className="mb-2 text-xs font-semibold text-slate-700">Storico versioni</p>
                    <div className="max-h-[240px] space-y-1.5 overflow-auto">
                      {(templateHistory?.items || []).map((item) => (
                        <div key={item.id} className="rounded border border-slate-200 bg-white px-2 py-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold">v{item.version}</span>
                            <span className="text-slate-500">{formatDateTime(item.created_at)}</span>
                          </div>
                          <p className="truncate text-[11px] text-slate-600">{item.updated_by?.email || item.updated_by?.name || 'sistema'}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex justify-between gap-2">
                <Button
                  variant="outline"
                  onClick={() => resetTemplateMutation.mutate()}
                  disabled={resetTemplateMutation.isPending}
                >
                  {resetTemplateMutation.isPending ? 'Ripristino...' : 'Ripristina Default'}
                </Button>
                <Button
                  onClick={() => saveTemplatesMutation.mutate()}
                  disabled={saveTemplatesMutation.isPending || (templateKey !== 'beta_disclaimer' && !selectedTemplate?.subject?.trim())}
                >
                  {saveTemplatesMutation.isPending ? 'Salvataggio...' : 'Salva Template'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
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
    sky: 'border-sky-300 bg-sky-50 text-sky-950',
    emerald: 'border-emerald-300 bg-emerald-50 text-emerald-950',
    violet: 'border-violet-300 bg-violet-50 text-violet-950',
    amber: 'border-amber-300 bg-amber-50 text-amber-950',
  }
  return (
    <Card className={colorClasses[color]}>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-semibold">{title}</CardTitle>
        <Icon className="h-4 w-4 opacity-80" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        <p className="mt-1 text-xs opacity-80">{hint}</p>
      </CardContent>
    </Card>
  )
}
