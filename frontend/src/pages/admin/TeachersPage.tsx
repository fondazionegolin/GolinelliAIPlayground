import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi, creditsApi } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import {
  Check, X, Clock, Key, Copy, UserPlus, Mail, Trash2,
  GraduationCap, Search, ChevronDown, ChevronUp,
  Users, BookOpen, Euro, LogIn, Pencil,
} from 'lucide-react'

/* ─── types ──────────────────────────────────────────── */
interface TeacherRequest {
  id: string
  email: string
  first_name: string
  last_name: string
  status: string
  tenant_id: string
  created_at: string
}

interface TeacherStatus {
  id: string
  first_name?: string | null
  last_name?: string | null
  email: string
  institution?: string | null
  is_verified: boolean
  last_login_at?: string | null
  created_at?: string | null
  period_cost: number
  period_calls: number
  session_count: number
  total_student_count: number
  monthly_cap: number
  monthly_usage: number
  limit_id?: string | null
}

interface ResetResult {
  email: string
  temporary_password: string
}

/* ─── helpers ─────────────────────────────────────────── */
const formatCurrency = (v: number) => `€ ${Number(v || 0).toFixed(2)}`
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
  return d.toLocaleString('it-IT', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/* ─── main component ──────────────────────────────────── */
export default function TeachersPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [search, setSearch] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteFirstName, setInviteFirstName] = useState('')
  const [inviteLastName, setInviteLastName] = useState('')
  const [inviteSchool, setInviteSchool] = useState('')
  const [bulkInviteText, setBulkInviteText] = useState('')
  const [resetResult, setResetResult] = useState<ResetResult | null>(null)
  const [approvalResult, setApprovalResult] = useState<{ email: string; email_sent: boolean } | null>(null)
  const [days] = useState(30)
  const [editingCapId, setEditingCapId] = useState<string | null>(null)
  const [editingCapValue, setEditingCapValue] = useState('')

  /* ── queries ── */
  const { data: requests, isLoading: loadingRequests } = useQuery<TeacherRequest[]>({
    queryKey: ['teacher-requests'],
    queryFn: async () => (await adminApi.getTeacherRequests()).data,
  })

  const { data: teachersStatus, isLoading: loadingTeachers } = useQuery<{ items: TeacherStatus[] }>({
    queryKey: ['admin-teacher-status', days],
    queryFn: async () => (await adminApi.getTeachersStatus(days)).data,
  })

  const { data: invitations } = useQuery<any[]>({
    queryKey: ['admin-platform-invitations'],
    queryFn: async () => (await creditsApi.getInvitations()).data,
  })

  /* ── mutations ── */
  const approveMutation = useMutation({
    mutationFn: (id: string) => adminApi.approveTeacher(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['teacher-requests'] })
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-status'] })
      setApprovalResult({ email: res.data.email, email_sent: res.data.email_sent })
    },
    onError: () => toast({ variant: 'destructive', title: 'Errore approvazione' }),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => adminApi.rejectTeacher(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacher-requests'] })
      toast({ title: 'Richiesta rifiutata' })
    },
  })

  const resetMutation = useMutation({
    mutationFn: (userId: string) => adminApi.resetPassword(userId),
    onSuccess: (res) => {
      setResetResult({ email: res.data.email, temporary_password: res.data.temporary_password })
    },
    onError: () => toast({ variant: 'destructive', title: 'Errore reset password' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => adminApi.deleteUser(userId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-status'] })
      toast({ title: 'Docente eliminato', description: res.data.message })
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Errore', description: error.response?.data?.detail })
    },
  })

  const inviteMutation = useMutation({
    mutationFn: (p: { email: string; firstName?: string; lastName?: string; school?: string }) =>
      creditsApi.inviteTeacher(p.email, p.firstName, p.lastName, p.school),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-platform-invitations'] })
      toast({ title: 'Invito inviato' })
      setInviteEmail(''); setInviteFirstName(''); setInviteLastName(''); setInviteSchool('')
      setShowInvite(false)
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: 'Invito fallito', description: error.response?.data?.detail })
    },
  })

  const bulkInviteMutation = useMutation({
    mutationFn: async (rows: Array<{ email: string; firstName?: string; lastName?: string; school?: string }>) => {
      const results = await Promise.allSettled(
        rows.map((r) => creditsApi.inviteTeacher(r.email, r.firstName, r.lastName, r.school))
      )
      const failed = results.filter((r) => r.status === 'rejected').length
      return { total: rows.length, failed, success: rows.length - failed }
    },
    onSuccess: ({ total, success, failed }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-platform-invitations'] })
      toast({ title: 'Inviti inviati', description: `${success}/${total} riusciti${failed ? `, ${failed} falliti` : ''}` })
      setBulkInviteText('')
    },
  })

  const setCreditLimitMutation = useMutation({
    mutationFn: ({ teacherId, cap }: { teacherId: string; cap: number }) =>
      adminApi.setTeacherCreditLimit(teacherId, cap),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-status'] })
      setEditingCapId(null)
      toast({ title: 'Limite aggiornato' })
    },
    onError: () => toast({ variant: 'destructive', title: 'Errore aggiornamento limite' }),
  })

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    toast({ title: 'Copiato!' })
  }

  /* ── derived ── */
  const pending = requests?.filter((r) => r.status === 'pending') || []
  const teachers = (teachersStatus?.items || []).filter((t) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      [t.first_name, t.last_name, t.email, t.institution].join(' ').toLowerCase().includes(q)
    )
  })

  const parsedBulkRows = bulkInviteText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const p = l.split(/[;,]/).map((s) => s.trim())
      return { email: p[0] || '', firstName: p[1] || undefined, lastName: p[2] || undefined, school: p[3] || undefined }
    })
    .filter((r) => r.email.includes('@'))

  /* ── render ── */
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Docenti</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {teachers.length} docenti attivi
            {pending.length > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-amber-600 font-medium">
                · <Clock className="h-3.5 w-3.5" /> {pending.length} in attesa
              </span>
            )}
          </p>
        </div>
        <Button
          onClick={() => setShowInvite((v) => !v)}
          className="gap-2 flex-shrink-0"
          style={{ backgroundColor: '#e85c8d' }}
        >
          <UserPlus className="h-4 w-4" />
          Invita docente
          {showInvite ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Approval result banner */}
      {approvalResult && (
        <div
          className={`flex items-start gap-3 rounded-xl border px-4 py-3 ${
            approvalResult.email_sent
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          <Check className="h-5 w-5 mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <strong>Docente approvato:</strong>{' '}
            {approvalResult.email_sent
              ? `Email di attivazione inviata a ${approvalResult.email}`
              : `Attenzione: email non inviata a ${approvalResult.email}. Verifica SMTP.`}
          </div>
          <button onClick={() => setApprovalResult(null)} className="opacity-60 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Reset password result */}
      {resetResult && (
        <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
          <Key className="h-5 w-5 text-emerald-600 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-emerald-800 mb-2">Password resettata</p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <div className="flex items-center justify-between rounded-lg bg-white border border-emerald-200 px-3 py-1.5">
                <span className="text-xs text-slate-500">Email</span>
                <div className="flex items-center gap-1">
                  <code className="text-xs font-mono text-slate-800">{resetResult.email}</code>
                  <button onClick={() => copyToClipboard(resetResult.email)} className="p-0.5 text-slate-400 hover:text-slate-700">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-white border border-emerald-200 px-3 py-1.5">
                <span className="text-xs text-slate-500">Password</span>
                <div className="flex items-center gap-1">
                  <code className="text-xs font-mono text-slate-800">{resetResult.temporary_password}</code>
                  <button onClick={() => copyToClipboard(resetResult.temporary_password)} className="p-0.5 text-slate-400 hover:text-slate-700">
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          <button onClick={() => setResetResult(null)} className="opacity-60 hover:opacity-100">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Invite Panel */}
      {showInvite && (
        <div className="rounded-xl border border-[#e85c8d]/30 bg-rose-50/50 p-5 space-y-4">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Mail className="h-4 w-4 text-[#e85c8d]" />
            Invita un docente
          </h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Single invite */}
            <div className="md:col-span-1 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Email *</Label>
                <Input
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="docente@scuola.it"
                  className="h-8 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Nome</Label>
                  <Input value={inviteFirstName} onChange={(e) => setInviteFirstName(e.target.value)} className="h-8 text-sm" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Cognome</Label>
                  <Input value={inviteLastName} onChange={(e) => setInviteLastName(e.target.value)} className="h-8 text-sm" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Scuola</Label>
                <Input value={inviteSchool} onChange={(e) => setInviteSchool(e.target.value)} placeholder="Istituto…" className="h-8 text-sm" />
              </div>
              <Button
                className="w-full h-8 text-sm"
                style={{ backgroundColor: '#e85c8d' }}
                disabled={!inviteEmail.trim() || inviteMutation.isPending}
                onClick={() =>
                  inviteMutation.mutate({
                    email: inviteEmail.trim(),
                    firstName: inviteFirstName.trim() || undefined,
                    lastName: inviteLastName.trim() || undefined,
                    school: inviteSchool.trim() || undefined,
                  })
                }
              >
                <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                {inviteMutation.isPending ? 'Invio…' : 'Invia invito'}
              </Button>
            </div>

            {/* Bulk invite */}
            <div className="md:col-span-2 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs">Invito multiplo (CSV)</Label>
                <span className="text-[11px] text-slate-500">{parsedBulkRows.length} validi</span>
              </div>
              <textarea
                value={bulkInviteText}
                onChange={(e) => setBulkInviteText(e.target.value)}
                className="w-full min-h-28 rounded-lg border border-slate-200 bg-white p-3 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-[#e85c8d]"
                placeholder={'email;nome;cognome;scuola\nmaria@scuola.it;Maria;Rossi;Liceo Galilei'}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={parsedBulkRows.length === 0 || bulkInviteMutation.isPending}
                  onClick={() => bulkInviteMutation.mutate(parsedBulkRows)}
                >
                  {bulkInviteMutation.isPending ? 'Invio…' : `Invia ${parsedBulkRows.length} inviti`}
                </Button>
              </div>
            </div>
          </div>

          {/* Invite history */}
          {(invitations || []).length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-600 mb-2">Inviti recenti</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-xs">
                  <thead>
                    <tr className="text-left text-[11px] uppercase text-slate-400 border-b">
                      <th className="pb-1.5 font-medium">Email</th>
                      <th className="pb-1.5 font-medium">Stato</th>
                      <th className="pb-1.5 font-medium">Creato</th>
                      <th className="pb-1.5 font-medium">Scadenza</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(invitations || []).slice(0, 10).map((inv: any) => (
                      <tr key={inv.id} className="border-t border-slate-100">
                        <td className="py-1.5">{inv.email}</td>
                        <td className="py-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                            inv.status === 'accepted' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {inv.status}
                          </span>
                        </td>
                        <td className="py-1.5 text-slate-500">{formatDate(inv.created_at)}</td>
                        <td className="py-1.5 text-slate-500">{formatDate(inv.expires_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── PENDING APPROVALS BLOCK ────────────────────── */}
      {!loadingRequests && pending.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-600" />
            <h3 className="font-semibold text-amber-800">
              {pending.length} richiesta{pending.length > 1 ? 'e' : ''} in attesa di approvazione
            </h3>
          </div>
          <div className="space-y-2">
            {pending.map((req) => (
              <div
                key={req.id}
                className="flex items-center justify-between gap-4 rounded-lg bg-white border border-amber-200 px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                    <GraduationCap className="h-4 w-4 text-amber-700" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-800 truncate">
                      {req.first_name} {req.last_name}
                    </p>
                    <p className="text-xs text-slate-500 truncate">{req.email}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-xs text-slate-400 hidden sm:block">
                    {formatDate(req.created_at)}
                  </span>
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => approveMutation.mutate(req.id)}
                    disabled={approveMutation.isPending}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Approva
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 border-red-300 text-red-600 hover:bg-red-50"
                    onClick={() => rejectMutation.mutate(req.id)}
                    disabled={rejectMutation.isPending}
                  >
                    <X className="h-3.5 w-3.5" />
                    Rifiuta
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TEACHERS TABLE ─────────────────────────────── */}
      <div className="space-y-3">
        {/* Search bar */}
        <div className="relative max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca docente…"
            className="pl-9 h-9 text-sm"
          />
        </div>

        {/* Table card */}
        <Card>
          <CardContent className="p-0">
            {loadingTeachers ? (
              <div className="py-12 text-center text-slate-400 text-sm">Caricamento…</div>
            ) : teachers.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-sm">Nessun docente trovato</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-[11px] uppercase text-slate-400">
                      <th className="px-4 py-3 text-left font-medium">Docente</th>
                      <th className="px-3 py-3 text-left font-medium">Scuola</th>
                      <th className="px-3 py-3 text-left font-medium">
                        <span className="flex items-center gap-1">
                          <LogIn className="h-3.5 w-3.5" />
                          Ultimo accesso
                        </span>
                      </th>
                      <th className="px-3 py-3 text-center font-medium">
                        <span className="flex items-center justify-center gap-1">
                          <BookOpen className="h-3.5 w-3.5" />
                          Sessioni
                        </span>
                      </th>
                      <th className="px-3 py-3 text-center font-medium">
                        <span className="flex items-center justify-center gap-1">
                          <Users className="h-3.5 w-3.5" />
                          Studenti
                        </span>
                      </th>
                      <th className="px-3 py-3 text-left font-medium">
                        <span className="flex items-center gap-1">
                          <Euro className="h-3.5 w-3.5" />
                          Crediti mensili
                        </span>
                      </th>
                      <th className="px-4 py-3 text-right font-medium">Azioni</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teachers.map((teacher) => (
                      <tr
                        key={teacher.id}
                        className="border-t border-slate-100 hover:bg-slate-50 transition-colors"
                      >
                        {/* Name / email / badge */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-[#1a1a2e]/10 flex items-center justify-center flex-shrink-0">
                              <GraduationCap className="h-4 w-4 text-[#1a1a2e]" />
                            </div>
                            <div>
                              <p className="font-semibold text-slate-800 leading-tight">
                                {[teacher.first_name, teacher.last_name].filter(Boolean).join(' ') || '—'}
                              </p>
                              <p className="text-xs text-slate-400">{teacher.email}</p>
                            </div>
                            {teacher.is_verified ? (
                              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-medium hidden sm:inline">
                                verificato
                              </span>
                            ) : (
                              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-medium hidden sm:inline">
                                non verificato
                              </span>
                            )}
                          </div>
                        </td>

                        {/* School */}
                        <td className="px-3 py-3 text-slate-600 text-xs max-w-[120px] truncate">
                          {teacher.institution || '—'}
                        </td>

                        {/* Last login */}
                        <td className="px-3 py-3 text-xs text-slate-500 whitespace-nowrap">
                          {formatDateTime(teacher.last_login_at)}
                        </td>

                        {/* Sessions */}
                        <td className="px-3 py-3 text-center">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold">
                            {teacher.session_count}
                          </span>
                        </td>

                        {/* Students */}
                        <td className="px-3 py-3 text-center">
                          <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-50 text-emerald-700 text-xs font-semibold">
                            {teacher.total_student_count}
                          </span>
                        </td>

                        {/* Credits with limit editing */}
                        <td className="px-3 py-3 min-w-[140px]">
                          {editingCapId === teacher.id ? (
                            <div className="flex items-center gap-1">
                              <span className="text-xs text-slate-400">€</span>
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                className="w-16 h-6 border border-slate-300 rounded px-1 text-xs focus:outline-none focus:ring-1 focus:ring-[#1a1a2e]"
                                value={editingCapValue}
                                onChange={(e) => setEditingCapValue(e.target.value)}
                                autoFocus
                              />
                              <button
                                className="text-emerald-600 hover:text-emerald-800"
                                onClick={() => {
                                  const cap = parseFloat(editingCapValue)
                                  if (!isNaN(cap) && cap >= 0) {
                                    setCreditLimitMutation.mutate({ teacherId: teacher.id, cap })
                                  }
                                }}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button
                                className="text-slate-400 hover:text-slate-700"
                                onClick={() => setEditingCapId(null)}
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-slate-700">
                                  {formatCurrency(teacher.monthly_usage)}
                                </span>
                                <span className="text-[10px] text-slate-400">/</span>
                                <span className="text-xs text-slate-500">{formatCurrency(teacher.monthly_cap)}</span>
                                <button
                                  className="ml-0.5 text-slate-300 hover:text-slate-600 transition-colors"
                                  onClick={() => {
                                    setEditingCapId(teacher.id)
                                    setEditingCapValue(String(teacher.monthly_cap))
                                  }}
                                  title="Modifica limite"
                                >
                                  <Pencil className="h-3 w-3" />
                                </button>
                              </div>
                              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden w-24">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    teacher.monthly_cap > 0 && teacher.monthly_usage / teacher.monthly_cap > 0.85
                                      ? 'bg-red-400'
                                      : teacher.monthly_cap > 0 && teacher.monthly_usage / teacher.monthly_cap > 0.6
                                      ? 'bg-amber-400'
                                      : 'bg-emerald-400'
                                  }`}
                                  style={{
                                    width: teacher.monthly_cap > 0
                                      ? `${Math.min(100, (teacher.monthly_usage / teacher.monthly_cap) * 100)}%`
                                      : '0%'
                                  }}
                                />
                              </div>
                            </div>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                              onClick={() => resetMutation.mutate(teacher.id)}
                              disabled={resetMutation.isPending}
                              title="Reset password"
                            >
                              <Key className="h-3.5 w-3.5 mr-1" />
                              <span className="hidden lg:inline">Reset PWD</span>
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
                              onClick={() => {
                                if (confirm(`Elimina ${teacher.email}?`)) deleteMutation.mutate(teacher.id)
                              }}
                              disabled={deleteMutation.isPending}
                              title="Elimina docente"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
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
