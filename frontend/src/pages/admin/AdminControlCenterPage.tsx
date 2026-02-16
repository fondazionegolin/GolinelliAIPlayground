import { useMemo, useState } from 'react'
import type { ComponentType } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, creditsApi } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
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
import { Activity, DollarSign, Mail, Users, UserPlus, Zap } from 'lucide-react'

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
  created_at?: string | null
  last_login_at?: string | null
  period_cost: number
  period_calls: number
}

type RealtimeStatus = {
  online_students: number
  online_teachers: number
  online_total: number
  sessions_active: Array<{ session_id: string; online_students: number }>
  generated_at: string
}

const formatCurrency = (value: number) => `€ ${Number(value || 0).toFixed(2)}`

const formatDateTime = (raw?: string | null) => {
  if (!raw) return 'N/D'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return 'N/D'
  return date.toLocaleString()
}

export default function AdminControlCenterPage() {
  const queryClient = useQueryClient()
  const [days, setDays] = useState(30)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteFirstName, setInviteFirstName] = useState('')
  const [inviteLastName, setInviteLastName] = useState('')
  const [inviteSchool, setInviteSchool] = useState('')
  const [bulkInviteText, setBulkInviteText] = useState('')

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
    refetchInterval: 5000,
  })

  const { data: invitations } = useQuery<any[]>({
    queryKey: ['admin-platform-invitations'],
    queryFn: async () => (await creditsApi.getInvitations()).data,
  })

  const inviteMutation = useMutation({
    mutationFn: async (payload: { email: string; firstName?: string; lastName?: string; school?: string }) =>
      creditsApi.inviteTeacher(payload.email, payload.firstName, payload.lastName, payload.school),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-platform-invitations'] })
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard-overview'] })
    },
  })

  const bulkInviteMutation = useMutation({
    mutationFn: async (rows: Array<{ email: string; firstName?: string; lastName?: string; school?: string }>) => {
      await Promise.allSettled(
        rows.map((row) => creditsApi.inviteTeacher(row.email, row.firstName, row.lastName, row.school))
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-platform-invitations'] })
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard-overview'] })
    },
  })

  const dailyHistory = overview?.daily_history || []
  const providerBreakdown = overview?.provider_breakdown || []
  const modelBreakdown = overview?.model_breakdown || []
  const summary = overview?.summary

  const teacherStatusRows = teachersStatus?.items || []
  const topConsumerRows = topConsumers?.items || []
  const invitationRows = invitations || []

  const parsedBulkRows = useMemo(() => {
    return bulkInviteText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/[;,]/).map((part) => part.trim())
        return {
          email: parts[0] || '',
          firstName: parts[1] || undefined,
          lastName: parts[2] || undefined,
          school: parts[3] || undefined,
        }
      })
      .filter((row) => row.email.includes('@'))
  }, [bulkInviteText])

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Cruscotto Admin</h2>
          <p className="text-sm text-slate-600">Controllo docenti, consumi API, costi e stato realtime della piattaforma.</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="period-days" className="text-xs text-slate-600">Periodo</Label>
          <Input
            id="period-days"
            type="number"
            min={1}
            max={180}
            value={days}
            onChange={(e) => setDays(Math.max(1, Math.min(180, Number(e.target.value || 30))))}
            className="h-8 w-24"
          />
          <span className="text-xs text-slate-500">giorni</span>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid h-auto grid-cols-1 gap-2 md:grid-cols-3">
          <TabsTrigger value="dashboard">Cruscotto</TabsTrigger>
          <TabsTrigger value="teachers">Docenti</TabsTrigger>
          <TabsTrigger value="costs">Costi & Consumi</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Utenti Online" value={`${realtime?.online_total || 0}`} hint={`Studenti ${realtime?.online_students || 0} · Docenti ${realtime?.online_teachers || 0}`} icon={Activity} />
            <MetricCard title="Costo Periodo" value={formatCurrency(summary?.total_cost_period || 0)} hint={`${summary?.period_days || days} giorni`} icon={DollarSign} />
            <MetricCard title="Chiamate API" value={`${summary?.total_api_calls_period || 0}`} hint="nel periodo selezionato" icon={Zap} />
            <MetricCard title="Docenti Attivi" value={`${summary?.active_teachers_period || 0}`} hint={`inviti pending: ${summary?.pending_invites || 0}`} icon={Users} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Andamento Chiamate e Costi</CardTitle>
                <CardDescription>Trend giornaliero chiamate API e spesa.</CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={dailyHistory}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis yAxisId="left" />
                    <YAxis yAxisId="right" orientation="right" />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="calls" stroke="#0f766e" strokeWidth={2} dot={false} name="Chiamate" />
                    <Line yAxisId="right" type="monotone" dataKey="cost" stroke="#1d4ed8" strokeWidth={2} dot={false} name="Costo" />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sessioni Online Ora</CardTitle>
                <CardDescription>Aggiornamento ogni 5 secondi.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {(realtime?.sessions_active || []).slice(0, 8).map((session) => (
                  <div key={session.session_id} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                    <span className="font-mono text-xs text-slate-600">{session.session_id.slice(0, 8)}</span>
                    <Badge variant="secondary">{session.online_students} online</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Top Consumatori API</CardTitle>
              <CardDescription>Docenti che stanno consumando di piu nel periodo.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead className="text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="pb-2">Docente</th>
                      <th className="pb-2">Scuola</th>
                      <th className="pb-2">Chiamate</th>
                      <th className="pb-2">Costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topConsumerRows.map((consumer) => (
                      <tr key={consumer.teacher_id} className="border-t border-slate-100">
                        <td className="py-2">
                          <div className="font-medium text-slate-900">{consumer.name}</div>
                          <div className="text-xs text-slate-500">{consumer.email}</div>
                        </td>
                        <td className="py-2 text-slate-700">{consumer.institution || 'N/D'}</td>
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

        <TabsContent value="teachers" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Invita Docente</CardTitle>
                <CardDescription>Invio mail diretta con registrazione guidata.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label>Email</Label>
                  <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="docente@scuola.it" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label>Nome</Label>
                    <Input value={inviteFirstName} onChange={(e) => setInviteFirstName(e.target.value)} placeholder="Nome" />
                  </div>
                  <div className="space-y-1">
                    <Label>Cognome</Label>
                    <Input value={inviteLastName} onChange={(e) => setInviteLastName(e.target.value)} placeholder="Cognome" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Scuola</Label>
                  <Input value={inviteSchool} onChange={(e) => setInviteSchool(e.target.value)} placeholder="Istituto..." />
                </div>
                <Button
                  className="w-full"
                  disabled={!inviteEmail || inviteMutation.isPending}
                  onClick={() => {
                    inviteMutation.mutate({
                      email: inviteEmail.trim(),
                      firstName: inviteFirstName.trim() || undefined,
                      lastName: inviteLastName.trim() || undefined,
                      school: inviteSchool.trim() || undefined,
                    })
                    setInviteEmail('')
                    setInviteFirstName('')
                    setInviteLastName('')
                    setInviteSchool('')
                  }}
                >
                  <Mail className="mr-2 h-4 w-4" /> Invia Invito
                </Button>
              </CardContent>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Invito Multiplo Rapido</CardTitle>
                <CardDescription>Una riga per docente: `email;nome;cognome;scuola`.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <textarea
                  value={bulkInviteText}
                  onChange={(e) => setBulkInviteText(e.target.value)}
                  className="min-h-40 w-full rounded-md border border-slate-300 p-3 text-sm"
                  placeholder={'maria@scuola.it;Maria;Rossi;Liceo Galilei\nluca@scuola.it;Luca;Bianchi;ITIS Marconi'}
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">{parsedBulkRows.length} inviti pronti</span>
                  <Button
                    disabled={parsedBulkRows.length === 0 || bulkInviteMutation.isPending}
                    onClick={() => {
                      bulkInviteMutation.mutate(parsedBulkRows)
                      setBulkInviteText('')
                    }}
                  >
                    <UserPlus className="mr-2 h-4 w-4" /> Invia Inviti Multipli
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Status Docenti</CardTitle>
              <CardDescription>Verifica account, ultimo accesso e consumi API per docente.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] text-sm">
                  <thead className="text-left text-xs uppercase text-slate-500">
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
                      <tr key={teacher.id} className="border-t border-slate-100">
                        <td className="py-2">
                          <div className="font-medium">{[teacher.first_name, teacher.last_name].filter(Boolean).join(' ') || teacher.email}</div>
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

          <Card>
            <CardHeader>
              <CardTitle>Storico Inviti</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[840px] text-sm">
                  <thead className="text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="pb-2">Email</th>
                      <th className="pb-2">Stato</th>
                      <th className="pb-2">Creato</th>
                      <th className="pb-2">Scadenza</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invitationRows.map((invitation: any) => (
                      <tr key={invitation.id} className="border-t border-slate-100">
                        <td className="py-2">{invitation.email}</td>
                        <td className="py-2"><Badge variant="outline">{invitation.status}</Badge></td>
                        <td className="py-2">{formatDateTime(invitation.created_at)}</td>
                        <td className="py-2">{formatDateTime(invitation.expires_at)}</td>
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
            <Card>
              <CardHeader>
                <CardTitle>Costi per Provider</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {providerBreakdown.map((item) => (
                  <div key={item.provider} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                    <span className="capitalize">{item.provider}</span>
                    <span className="font-semibold">{formatCurrency(item.cost)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Costi per Modello</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {modelBreakdown.map((item) => (
                  <div key={item.model} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                    <span className="font-mono text-xs">{item.model}</span>
                    <span className="font-semibold">{formatCurrency(item.cost)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Storico Costi e Chiamate</CardTitle>
              <CardDescription>Vista completa del periodo selezionato.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="pb-2">Data</th>
                      <th className="pb-2">Chiamate</th>
                      <th className="pb-2">Costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyHistory.map((row) => (
                      <tr key={row.date} className="border-t border-slate-100">
                        <td className="py-2">{row.date}</td>
                        <td className="py-2">{row.calls}</td>
                        <td className="py-2 font-semibold">{formatCurrency(row.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
}: {
  title: string
  value: string
  hint: string
  icon: ComponentType<{ className?: string }>
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-slate-700">{title}</CardTitle>
        <Icon className="h-4 w-4 text-slate-500" />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold text-slate-900">{value}</div>
        <p className="mt-1 text-xs text-slate-500">{hint}</p>
      </CardContent>
    </Card>
  )
}
