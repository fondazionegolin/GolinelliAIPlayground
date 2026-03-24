import { useState, useRef, useCallback } from 'react'
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
  Users, BookOpen, Euro, LogIn, Pencil, ShieldCheck,
  Upload, Tag, MessageSquare, Send, AlertCircle, CheckCircle2, Loader2,
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

interface CsvRow {
  id: string      // local key
  email: string
  firstName: string
  lastName: string
  school: string
  selected: boolean
  status: 'idle' | 'sending' | 'sent' | 'error'
  errorMsg?: string
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
  const [resetResult, setResetResult] = useState<ResetResult | null>(null)
  // CSV import flow
  const [csvRows, setCsvRows] = useState<CsvRow[]>([])
  const [groupTag, setGroupTag] = useState('')
  const [customMessage, setCustomMessage] = useState('')
  const [showMessage, setShowMessage] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [isSendingAll, setIsSendingAll] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
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
    refetchInterval: 20_000,   // poll ogni 20s per aggiornamenti real-time
    staleTime: 10_000,
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

  const promoteMutation = useMutation({
    mutationFn: (userId: string) => adminApi.promoteToAdmin(userId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-status'] })
      toast({ title: 'Ruolo aggiornato', description: res.data.message })
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
      const detail = error.response?.data?.detail
      const description = Array.isArray(detail)
        ? detail.map((e: any) => e.msg ?? String(e)).join(', ')
        : typeof detail === 'string' ? detail : 'Errore sconosciuto'
      toast({ variant: 'destructive', title: 'Invito fallito', description })
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

  /* ── CSV helpers ── */
  const parseCsv = useCallback((text: string) => {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return
    // Detect header row
    const firstLower = lines[0].toLowerCase()
    const hasHeader = firstLower.includes('email') || firstLower.includes('nome') || firstLower.includes('first')
    const dataLines = hasHeader ? lines.slice(1) : lines
    // Detect separator
    const sep = lines[0].includes(';') ? ';' : ','
    // Detect column order from header (or assume email,nome,cognome,scuola)
    let colEmail = 0, colFirst = 1, colLast = 2, colSchool = 3
    if (hasHeader) {
      const headers = lines[0].split(sep).map(h => h.trim().toLowerCase())
      // NOTE: 'cognome'.includes('nome') === true, so check cognome BEFORE nome and use exact/negative matches
      const ei = headers.findIndex(h => h.includes('email') || h === 'e-mail')
      const li = headers.findIndex(h => h.includes('cognome') || h === 'last_name' || h === 'last' || h === 'surname')
      const fi = headers.findIndex(h => (h === 'nome' || h === 'first_name' || h === 'first' || h === 'name') && !h.includes('cognome'))
      const si = headers.findIndex(h => h.includes('scuola') || h.includes('school') || h.includes('istituto'))
      colEmail = ei >= 0 ? ei : 0
      colFirst = fi >= 0 ? fi : (li === 1 ? 2 : 1)   // fallback avoids colliding with lastName col
      colLast  = li >= 0 ? li : (fi === 2 ? 1 : 2)
      colSchool = si >= 0 ? si : 3
    }
    const rows: CsvRow[] = dataLines
      .map((line, i) => {
        const parts = line.split(sep).map(p => p.trim().replace(/^["']|["']$/g, ''))
        const email = parts[colEmail] || ''
        if (!email.includes('@')) return null
        return {
          id: `row-${i}-${email}`,
          email,
          firstName: parts[colFirst] || '',
          lastName: parts[colLast] || '',
          school: parts[colSchool] || '',
          selected: true,
          status: 'idle' as const,
        }
      })
      .filter(Boolean) as CsvRow[]
    setCsvRows(rows)
  }, [])

  const handleFileUpload = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = e => parseCsv(e.target?.result as string)
    reader.readAsText(file, 'utf-8')
  }, [parseCsv])

  const updateRow = (id: string, patch: Partial<CsvRow>) =>
    setCsvRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r))

  const sendSingleRow = async (row: CsvRow) => {
    updateRow(row.id, { status: 'sending' })
    try {
      await creditsApi.inviteTeacher(row.email, row.firstName || undefined, row.lastName || undefined, row.school || undefined, groupTag || undefined, customMessage || undefined)
      updateRow(row.id, { status: 'sent' })
      queryClient.invalidateQueries({ queryKey: ['admin-platform-invitations'] })
    } catch (err: any) {
      updateRow(row.id, { status: 'error', errorMsg: err?.response?.data?.detail || 'Errore' })
    }
  }

  const sendAllSelected = async () => {
    const toSend = csvRows.filter(r => r.selected && r.status === 'idle')
    if (toSend.length === 0) return
    setIsSendingAll(true)
    for (const row of toSend) {
      await sendSingleRow(row)
    }
    setIsSendingAll(false)
    toast({ title: 'Inviti completati', description: `${toSend.length} inviti inviati` })
  }

  const toggleSelectAll = (checked: boolean) =>
    setCsvRows(prev => prev.map(r => r.status === 'idle' ? { ...r, selected: checked } : r))

  /* ── derived ── */
  const pending = requests?.filter((r) => r.status === 'pending') || []
  const teachers = (teachersStatus?.items || []).filter((t) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      [t.first_name, t.last_name, t.email, t.institution].join(' ').toLowerCase().includes(q)
    )
  })

  const selectedCount = csvRows.filter(r => r.selected && r.status === 'idle').length
  const sentCount = csvRows.filter(r => r.status === 'sent').length
  const allIdleSelected = csvRows.filter(r => r.status === 'idle').length > 0 &&
    csvRows.filter(r => r.status === 'idle').every(r => r.selected)

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

      {/* ── INVITE PANEL ─────────────────────────────── */}
      {showInvite && (
        <div className="rounded-xl border border-[#e85c8d]/30 bg-rose-50/40 p-5 space-y-5">
          <h3 className="font-semibold text-slate-800 flex items-center gap-2">
            <Mail className="h-4 w-4 text-[#e85c8d]" />
            Importa docenti da CSV
          </h3>

          {/* ── single invite row ── */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Invito singolo</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-4">
              <div className="space-y-1">
                <Label className="text-xs">Email *</Label>
                <Input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="docente@scuola.it" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Nome</Label>
                <Input value={inviteFirstName} onChange={e => setInviteFirstName(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Cognome</Label>
                <Input value={inviteLastName} onChange={e => setInviteLastName(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Scuola</Label>
                <Input value={inviteSchool} onChange={e => setInviteSchool(e.target.value)} placeholder="Istituto…" className="h-8 text-sm" />
              </div>
            </div>
            <Button
              className="h-8 text-sm"
              style={{ backgroundColor: '#e85c8d' }}
              disabled={!inviteEmail.trim() || inviteMutation.isPending}
              onClick={() => inviteMutation.mutate({ email: inviteEmail.trim(), firstName: inviteFirstName.trim() || undefined, lastName: inviteLastName.trim() || undefined, school: inviteSchool.trim() || undefined })}
            >
              <UserPlus className="h-3.5 w-3.5 mr-1.5" />
              {inviteMutation.isPending ? 'Invio…' : 'Invia invito'}
            </Button>
          </div>

          {/* ── CSV import ── */}
          <div className="space-y-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Importazione CSV</p>

            {/* Drop zone */}
            {csvRows.length === 0 && (
              <div
                className={`relative rounded-xl border-2 border-dashed transition-colors cursor-pointer flex flex-col items-center justify-center gap-3 py-10 ${dragOver ? 'border-[#e85c8d] bg-rose-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => {
                  e.preventDefault()
                  setDragOver(false)
                  const f = e.dataTransfer.files[0]
                  if (f) handleFileUpload(f)
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 text-slate-300" />
                <div className="text-center">
                  <p className="text-sm font-medium text-slate-600">Trascina un CSV qui o clicca per sfogliare</p>
                  <p className="text-xs text-slate-400 mt-1">Colonne rilevate automaticamente: email, nome, cognome, scuola</p>
                  <p className="text-xs text-slate-400">Separatore: virgola o punto e virgola · Con o senza intestazione</p>
                </div>
                <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }} />
              </div>
            )}

            {/* Preview table */}
            {csvRows.length > 0 && (
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                {/* Toolbar */}
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 flex-wrap">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-slate-700">{csvRows.length} docenti importati</span>
                    {sentCount > 0 && <span className="text-xs text-emerald-600 font-medium">{sentCount} inviati</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setCsvRows([]); if (fileInputRef.current) fileInputRef.current.value = '' }}>
                      <X className="h-3.5 w-3.5 mr-1" />Annulla
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      style={{ backgroundColor: '#e85c8d' }}
                      disabled={selectedCount === 0 || isSendingAll}
                      onClick={sendAllSelected}
                    >
                      {isSendingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      {isSendingAll ? 'Invio in corso…' : `Invia ${selectedCount} selezionati`}
                    </Button>
                  </div>
                </div>

                {/* Group tag + custom message */}
                <div className="px-4 py-3 border-b border-slate-100 space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                      <Tag className="h-4 w-4 text-slate-400 flex-shrink-0" />
                      <Input
                        value={groupTag}
                        onChange={e => setGroupTag(e.target.value)}
                        placeholder="Gruppo / tag (es. sperimentazione torino)"
                        className="h-8 text-sm flex-1"
                      />
                    </div>
                    <button
                      onClick={() => setShowMessage(v => !v)}
                      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white hover:bg-slate-50 transition-colors"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      {showMessage ? 'Nascondi messaggio' : 'Messaggio personalizzato'}
                    </button>
                  </div>
                  {showMessage && (
                    <textarea
                      value={customMessage}
                      onChange={e => setCustomMessage(e.target.value)}
                      placeholder="Testo aggiuntivo che apparirà nell'email di invito (facoltativo)…"
                      className="w-full rounded-lg border border-slate-200 p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-[#e85c8d] min-h-[80px]"
                    />
                  )}
                </div>

                {/* Rows table */}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="text-[11px] uppercase text-slate-400 border-b border-slate-100">
                        <th className="px-4 py-2 text-left w-8">
                          <input type="checkbox" checked={allIdleSelected} onChange={e => toggleSelectAll(e.target.checked)} className="rounded" />
                        </th>
                        <th className="px-3 py-2 text-left font-medium">Email</th>
                        <th className="px-3 py-2 text-left font-medium">Nome</th>
                        <th className="px-3 py-2 text-left font-medium">Cognome</th>
                        <th className="px-3 py-2 text-left font-medium">Scuola</th>
                        <th className="px-3 py-2 text-center font-medium">Stato</th>
                        <th className="px-3 py-2 text-right font-medium">Azione</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map(row => (
                        <tr key={row.id} className={`border-t border-slate-100 ${row.status === 'sent' ? 'bg-emerald-50/40' : row.status === 'error' ? 'bg-red-50/40' : ''}`}>
                          <td className="px-4 py-2">
                            <input
                              type="checkbox"
                              checked={row.selected}
                              disabled={row.status !== 'idle'}
                              onChange={e => updateRow(row.id, { selected: e.target.checked })}
                              className="rounded"
                            />
                          </td>
                          <td className="px-3 py-2 text-xs font-mono text-slate-700">{row.email}</td>
                          <td className="px-3 py-2">
                            <input value={row.firstName} onChange={e => updateRow(row.id, { firstName: e.target.value })} disabled={row.status !== 'idle'} className="w-full text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-slate-300 rounded px-1" placeholder="—" />
                          </td>
                          <td className="px-3 py-2">
                            <input value={row.lastName} onChange={e => updateRow(row.id, { lastName: e.target.value })} disabled={row.status !== 'idle'} className="w-full text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-slate-300 rounded px-1" placeholder="—" />
                          </td>
                          <td className="px-3 py-2">
                            <input value={row.school} onChange={e => updateRow(row.id, { school: e.target.value })} disabled={row.status !== 'idle'} className="w-full text-xs border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-slate-300 rounded px-1" placeholder="—" />
                          </td>
                          <td className="px-3 py-2 text-center">
                            {row.status === 'idle' && <span className="text-xs text-slate-400">—</span>}
                            {row.status === 'sending' && <Loader2 className="h-4 w-4 animate-spin text-slate-400 mx-auto" />}
                            {row.status === 'sent' && <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />}
                            {row.status === 'error' && (
                              <span title={row.errorMsg}>
                                <AlertCircle className="h-4 w-4 text-red-400 mx-auto" />
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {row.status === 'idle' && (
                              <button
                                onClick={() => sendSingleRow(row)}
                                className="text-xs text-[#e85c8d] hover:text-[#c44a76] font-medium"
                              >
                                Invia
                              </button>
                            )}
                            {row.status === 'error' && (
                              <button onClick={() => { updateRow(row.id, { status: 'idle', errorMsg: undefined }); sendSingleRow({ ...row, status: 'idle' }) }} className="text-xs text-amber-600 hover:text-amber-800 font-medium">Riprova</button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Invite history — real-time (polls every 20s) */}
          {(invitations || []).length > 0 && (() => {
            // Build email→teacher map for cross-referencing login status
            const teacherByEmail: Record<string, TeacherStatus> = {}
            ;(teachersStatus?.items || []).forEach(t => { teacherByEmail[t.email.toLowerCase()] = t })
            return (
              <div className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Inviti recenti</p>
                  <span className="text-[10px] text-slate-400 flex items-center gap-1">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    aggiornamento automatico
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-xs">
                    <thead>
                      <tr className="text-left text-[11px] uppercase text-slate-400 border-b">
                        <th className="pb-1.5 font-medium">Docente</th>
                        <th className="pb-1.5 font-medium">Gruppo</th>
                        <th className="pb-1.5 font-medium">Invito</th>
                        <th className="pb-1.5 font-medium">Piattaforma</th>
                        <th className="pb-1.5 font-medium">Inviato</th>
                        <th className="pb-1.5 font-medium">Scadenza</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(invitations || []).slice(0, 20).map((inv: any) => {
                        const teacher = teacherByEmail[inv.email?.toLowerCase()]
                        const hasLoggedIn = !!teacher?.last_login_at
                        const isExpired = !inv.responded_at && new Date(inv.expires_at) < new Date()
                        return (
                          <tr key={inv.id} className="border-t border-slate-100">
                            <td className="py-2">
                              <div>
                                <p className="font-medium text-slate-700">{[inv.first_name, inv.last_name].filter(Boolean).join(' ') || '—'}</p>
                                <p className="text-[10px] text-slate-400 font-mono">{inv.email}</p>
                              </div>
                            </td>
                            <td className="py-2">
                              {inv.group_tag
                                ? <span className="px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 text-[10px] font-medium border border-indigo-100">{inv.group_tag}</span>
                                : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="py-2">
                              {inv.status === 'accepted'
                                ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-semibold">
                                    <CheckCircle2 className="h-3 w-3" />accettato
                                    {inv.responded_at && <span className="opacity-70 font-normal">· {formatDate(inv.responded_at)}</span>}
                                  </span>
                                : isExpired
                                  ? <span className="px-1.5 py-0.5 rounded-full bg-red-50 text-red-500 text-[10px] font-medium">scaduto</span>
                                  : <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-[10px] font-medium">in attesa</span>}
                            </td>
                            <td className="py-2">
                              {hasLoggedIn
                                ? <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-semibold">
                                    <LogIn className="h-3 w-3" />entrato
                                    <span className="opacity-70 font-normal">· {formatDate(teacher!.last_login_at)}</span>
                                  </span>
                                : <span className="text-slate-300 text-[10px]">mai</span>}
                            </td>
                            <td className="py-2 text-slate-500">{formatDate(inv.created_at)}</td>
                            <td className="py-2 text-slate-500">{formatDate(inv.expires_at)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          })()}
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
                                {teacher.period_cost > 0 && (
                                  <span className="text-[10px] text-indigo-500 font-medium ml-1" title={`Spesa effettiva (${teacher.period_calls} chiamate)`}>
                                    ({formatCurrency(teacher.period_cost)})
                                  </span>
                                )}
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
                              className="h-7 px-2 text-xs text-amber-600 hover:text-amber-800 hover:bg-amber-50"
                              onClick={() => {
                                if (confirm(`Promuovere ${teacher.email} ad amministratore? Non sarà più un docente.`))
                                  promoteMutation.mutate(teacher.id)
                              }}
                              disabled={promoteMutation.isPending}
                              title="Promuovi ad amministratore"
                            >
                              <ShieldCheck className="h-3.5 w-3.5" />
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
