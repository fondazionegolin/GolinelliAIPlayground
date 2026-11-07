import { useState, useRef, useCallback } from 'react'
import { formatInternalCredits, toCredits, fromCredits } from '@/lib/credits'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi, creditsApi, type LicenseChange } from '@/lib/api'
import { LicenseBadge, LicenseDialog, type LicenseInfo } from '@/components/admin/LicenseDialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/design'
import { useToast } from '@/components/ui/use-toast'
import {
  Check, X, Clock, Key, UserPlus, Mail, Trash2,
  GraduationCap, Search, ChevronDown, ChevronUp, ChevronsUpDown,
  Zap, LogIn, Pencil, ShieldCheck,
  Upload, Tag, MessageSquare, Send, AlertCircle, CheckCircle2, Loader2, Download,
  Building2, UserMinus, MoreVertical,
} from '@/components/icons'
import { tl } from '@/i18n/tl'
import { AdminBadge, AdminEmpty, AdminNotice, AdminPageHeader } from '@/components/admin/AdminUI'

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
  role?: string
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
  tenant_id?: string | null
  tenant_name?: string | null
  tenant_type?: string | null
  license?: LicenseInfo
  schools: Array<{ id: string; name: string; slug: string }>
}

interface SchoolTenant {
  id: string
  name: string
  tenant_type: string
  status: string
}

interface ResetResult {
  email: string
  email_sent: boolean
}

interface CsvRow {
  id: string
  email: string
  firstName: string
  lastName: string
  school: string
  selected: boolean
  status: 'idle' | 'sending' | 'sent' | 'error'
  errorMsg?: string
}

/* ─── helpers ─────────────────────────────────────────── */
const formatCurrency = (v: number) => formatInternalCredits(v)
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
const escapeCsv = (value: string | number) => {
  const raw = String(value ?? '')
  if (!/[",\n]/.test(raw)) return raw
  return `"${raw.replace(/"/g, '""')}"`
}

type TeacherSortField = 'name' | 'institution' | 'license' | 'last_login_at' | 'session_count' | 'total_student_count'
type TeacherFilter = 'all' | 'no_school' | 'expired' | 'expiring' | 'no_license'
const hasSchool = (t: TeacherStatus) => (t.schools || []).length > 0

function SortIcon({ field, sortField, sortDirection }: { field: TeacherSortField; sortField: TeacherSortField; sortDirection: 'asc' | 'desc' }) {
  if (sortField !== field) return <ChevronsUpDown className="h-3 w-3 opacity-40" />
  return sortDirection === 'asc' ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />
}

/* ─── main component ──────────────────────────────────── */
export default function TeachersPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [search, setSearch] = useState('')
  const [showInvite, setShowInvite] = useState(false)
  const [showInvitations, setShowInvitations] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteFirstName, setInviteFirstName] = useState('')
  const [inviteLastName, setInviteLastName] = useState('')
  const [inviteSchool, setInviteSchool] = useState('')
  const [licenseEnd, setLicenseEnd] = useState('') // optional fixed licence end for new invites; empty = 12 months, auto-renewing
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
  const [hardDeleteId, setHardDeleteId] = useState<string | null>(null)
  const [hardDeleteEmail, setHardDeleteEmail] = useState('')
  const [sortField, setSortField] = useState<TeacherSortField>('name')
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<Set<string>>(new Set())
  const [bulkSchoolId, setBulkSchoolId] = useState('')
  const [bulkCap, setBulkCap] = useState('')
  const [filter, setFilter] = useState<TeacherFilter>('all')
  const [licenseTarget, setLicenseTarget] = useState<{ ids: string[]; title: string; subtitle?: string; current?: LicenseInfo | null } | null>(null)
  const [assignRowId, setAssignRowId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)

  const toggleSort = (field: TeacherSortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDirection('asc')
    }
  }

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
    refetchInterval: 20_000,
    staleTime: 10_000,
  })

  const { data: tenantRows } = useQuery<SchoolTenant[]>({
    queryKey: ['admin-tenants'],
    queryFn: async () => (await adminApi.getTenants()).data,
  })

  /* ── mutations ── */
  const approveMutation = useMutation({
    mutationFn: (id: string) => adminApi.approveTeacher(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['teacher-requests'] })
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-status'] })
      setApprovalResult({ email: res.data.email, email_sent: res.data.email_sent })
    },
    onError: () => toast({ variant: 'destructive', title: tl("Errore approvazione") }),
  })

  const rejectMutation = useMutation({
    mutationFn: (id: string) => adminApi.rejectTeacher(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacher-requests'] })
      toast({ title: tl("Richiesta rifiutata") })
    },
  })

  const resetMutation = useMutation({
    mutationFn: (userId: string) => adminApi.resetPassword(userId),
    onSuccess: (res) => {
      setResetResult({ email: res.data.email, email_sent: res.data.email_sent })
    },
    onError: () => toast({ variant: 'destructive', title: tl("Errore reset password") }),
  })

  const deleteMutation = useMutation({
    mutationFn: (userId: string) => adminApi.deleteUser(userId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-status'] })
      toast({ title: tl("Docente eliminato"), description: res.data.message })
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: tl("Errore"), description: error.response?.data?.detail })
    },
  })

  const promoteMutation = useMutation({
    mutationFn: (userId: string) => adminApi.promoteToAdmin(userId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-status'] })
      toast({ title: tl("Ruolo aggiornato"), description: res.data.message })
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: tl("Errore"), description: error.response?.data?.detail })
    },
  })

  const demoteMutation = useMutation({
    mutationFn: (userId: string) => adminApi.demoteAdmin(userId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-status'] })
      toast({ title: tl("Ruolo aggiornato"), description: res.data.message })
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: tl("Errore"), description: error.response?.data?.detail })
    },
  })

  const inviteMutation = useMutation({
    mutationFn: (p: { email: string; firstName?: string; lastName?: string; school?: string }) =>
      creditsApi.inviteTeacher(p.email, p.firstName, p.lastName, p.school, undefined, undefined, licenseEnd || undefined),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['admin-platform-invitations'] })
      if (res?.data?.email_sent === false) {
        toast({
          variant: 'destructive',
          title: tl("Invito creato, ma email NON inviata"),
          description: tl("Controlla la configurazione SMTP (password app Google scaduta?). Usa \"Reinvia\" dopo aver sistemato."),
        })
      } else {
        toast({ title: tl("Invito inviato") })
      }
      setInviteEmail(''); setInviteFirstName(''); setInviteLastName(''); setInviteSchool('')
      setShowInvite(false)
    },
    onError: (error: any) => {
      const detail = error.response?.data?.detail
      const description = Array.isArray(detail)
        ? detail.map((e: any) => e.msg ?? String(e)).join(', ')
        : typeof detail === 'string' ? detail : tl("Errore sconosciuto")
      const normalizedEmail = inviteEmail.trim().toLowerCase()
      const existingTeacher = (teachersStatus?.items || []).find((teacher) => teacher.email.toLowerCase() === normalizedEmail)
      toast({
        variant: 'destructive',
        title: tl("Invito fallito"),
        description: existingTeacher
          ? tl("{0}. Per questa email usa \"Reinvia accesso\".", description)
          : description,
      })
    },
  })

  const resendInvitationMutation = useMutation({
    mutationFn: (invitationId: string) => creditsApi.resendInvitation(invitationId),
    onSuccess: (res: any) => {
      queryClient.invalidateQueries({ queryKey: ['admin-platform-invitations'] })
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-status'] })
      if (res?.data?.email_sent === false) {
        toast({
          variant: 'destructive',
          title: tl("Invito aggiornato, ma email NON inviata"),
          description: tl("SMTP non configurato correttamente (password app Google scaduta?)."),
        })
      } else {
        toast({ title: tl("Invito reinviato") })
      }
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: tl("Reinvio fallito"), description: error.response?.data?.detail || tl("Impossibile reinviare l'invito") })
    },
  })

  const deleteInvitationMutation = useMutation({
    mutationFn: (invitationId: string) => creditsApi.deleteInvitation(invitationId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-platform-invitations'] })
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-status'] })
      toast({ title: tl("Invito rimosso"), description: res.data?.message })
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: tl("Rimozione fallita"), description: error.response?.data?.detail || tl("Impossibile rimuovere l'invito") })
    },
  })

  const setCreditLimitMutation = useMutation({
    mutationFn: ({ teacherId, cap }: { teacherId: string; cap: number }) =>
      adminApi.setTeacherCreditLimit(teacherId, fromCredits(cap)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-status'] })
      setEditingCapId(null)
      toast({ title: tl("Limite aggiornato") })
    },
    onError: () => toast({ variant: 'destructive', title: tl("Errore aggiornamento limite") }),
  })

  const bulkSchoolMutation = useMutation({
    mutationFn: (action: 'add' | 'remove') =>
      adminApi.updateTeacherSchoolsBulk(Array.from(selectedTeacherIds), bulkSchoolId, action),
    onSuccess: (res, action) => {
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-status'] })
      toast({
        title: action === 'add' ? tl("Inviti inviati") : tl("Docenti rimossi"),
        description: action === 'add' ? tl("{0} docenti notificati via piattaforma ed email", res.data.changed) : tl("{0} appartenenze aggiornate", res.data.changed),
      })
    },
    onError: (error: any) => toast({
      variant: 'destructive', title: tl("Operazione non riuscita"),
      description: error.response?.data?.detail || tl("Errore aggiornamento istituti"),
    }),
  })

  const licenseMutation = useMutation({
    mutationFn: ({ ids, change }: { ids: string[]; change: LicenseChange }) => adminApi.setUserLicenses(ids, change),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-status'] })
      setLicenseTarget(null)
      toast({ title: tl("Licenza aggiornata"), description: tl("{0} docenti aggiornati", res.data.changed) })
    },
    onError: (error: any) => toast({ variant: 'destructive', title: tl("Operazione non riuscita"), description: error.response?.data?.detail || tl("Errore aggiornamento licenza") }),
  })

  const assignMutation = useMutation({
    mutationFn: ({ ids, schoolId }: { ids: string[]; schoolId: string }) => adminApi.updateTeacherSchoolsBulk(ids, schoolId, 'assign'),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-status'] })
      setAssignRowId(null)
      toast({ title: tl("Istituto assegnato"), description: tl("{0} docenti aggiornati", res.data.selected) })
    },
    onError: (error: any) => toast({ variant: 'destructive', title: tl("Operazione non riuscita"), description: error.response?.data?.detail || tl("Errore assegnazione istituto") }),
  })

  const bulkCapMutation = useMutation({
    mutationFn: (cap: number) =>
      adminApi.setTeacherCreditLimitsBulk(Array.from(selectedTeacherIds), fromCredits(cap)),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-status'] })
      setBulkCap('')
      toast({ title: tl("Limiti mensili aggiornati"), description: tl("{0} docenti aggiornati", res.data.updated) })
    },
    onError: (error: any) => toast({
      variant: 'destructive', title: tl("Operazione non riuscita"),
      description: error.response?.data?.detail || tl("Errore aggiornamento limiti"),
    }),
  })

  const hardDeleteMutation = useMutation({
    mutationFn: ({ userId, confirmEmail }: { userId: string; confirmEmail: string }) =>
      adminApi.hardDeleteUser(userId, confirmEmail),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['admin-teacher-status'] })
      queryClient.invalidateQueries({ queryKey: ['admin-platform-invitations'] })
      setHardDeleteId(null)
      setHardDeleteEmail('')
      toast({ title: tl("Utente eliminato definitivamente"), description: res.data.message })
    },
    onError: (error: any) => {
      toast({ variant: 'destructive', title: tl("Eliminazione fallita"), description: error.response?.data?.detail })
    },
  })

  /* ── CSV helpers ── */
  const parseCsv = useCallback((text: string) => {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return
    const firstLower = lines[0].toLowerCase()
    const hasHeader = firstLower.includes('email') || firstLower.includes('nome') || firstLower.includes('first')
    const dataLines = hasHeader ? lines.slice(1) : lines
    const sep = lines[0].includes(';') ? ';' : ','
    let colEmail = 0, colFirst = 1, colLast = 2, colSchool = 3
    if (hasHeader) {
      const headers = lines[0].split(sep).map(h => h.trim().toLowerCase())
      const ei = headers.findIndex(h => h.includes('email') || h === 'e-mail')
      const li = headers.findIndex(h => h.includes('cognome') || h === 'last_name' || h === 'last' || h === 'surname')
      const fi = headers.findIndex(h => (h === 'nome' || h === 'first_name' || h === 'first' || h === 'name') && !h.includes('cognome'))
      const si = headers.findIndex(h => h.includes('scuola') || h.includes('school') || h.includes('istituto'))
      colEmail = ei >= 0 ? ei : 0
      colFirst = fi >= 0 ? fi : (li === 1 ? 2 : 1)
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
      await creditsApi.inviteTeacher(row.email, row.firstName || undefined, row.lastName || undefined, row.school || undefined, groupTag || undefined, customMessage || undefined, licenseEnd || undefined)
      updateRow(row.id, { status: 'sent' })
      queryClient.invalidateQueries({ queryKey: ['admin-platform-invitations'] })
    } catch (err: any) {
      updateRow(row.id, { status: 'error', errorMsg: err?.response?.data?.detail || tl("Errore") })
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
    toast({ title: tl("Inviti completati"), description: tl("{0} inviti inviati", toSend.length) })
  }

  const toggleSelectAll = (checked: boolean) =>
    setCsvRows(prev => prev.map(r => r.status === 'idle' ? { ...r, selected: checked } : r))

  /* ── derived ── */
  const pending = requests?.filter((r) => r.status === 'pending') || []
  const allTeachers = teachersStatus?.items || []
  const filterCounts: Record<TeacherFilter, number> = {
    all: allTeachers.length,
    no_school: allTeachers.filter(t => (t.role || '').toUpperCase() !== 'ADMIN' && !hasSchool(t)).length,
    expired: allTeachers.filter(t => t.license?.state === 'expired').length,
    expiring: allTeachers.filter(t => t.license?.state === 'expiring').length,
    no_license: allTeachers.filter(t => (t.role || '').toUpperCase() !== 'ADMIN' && (!t.license || t.license.state === 'none')).length,
  }
  const teachers = allTeachers
    .filter((t) => {
      if (filter === 'no_school' && (hasSchool(t) || (t.role || '').toUpperCase() === 'ADMIN')) return false
      if (filter === 'expired' && t.license?.state !== 'expired') return false
      if (filter === 'expiring' && t.license?.state !== 'expiring') return false
      if (filter === 'no_license' && !((t.role || '').toUpperCase() !== 'ADMIN' && (!t.license || t.license.state === 'none'))) return false
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return [t.first_name, t.last_name, t.email, t.institution, ...(t.schools || []).map(s => s.name)].join(' ').toLowerCase().includes(q)
    })
    .sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1
      switch (sortField) {
        case 'institution':
          return dir * ((a.schools || []).map(s => s.name).join(', ') || a.institution || '').localeCompare((b.schools || []).map(s => s.name).join(', ') || b.institution || '')
        case 'license': {
          const ta = a.license?.expires_at ? new Date(a.license.expires_at).getTime() : Infinity
          const tb = b.license?.expires_at ? new Date(b.license.expires_at).getTime() : Infinity
          return dir * (ta === tb ? 0 : ta < tb ? -1 : 1)
        }
        case 'last_login_at':
          return dir * ((a.last_login_at ? new Date(a.last_login_at).getTime() : 0) - (b.last_login_at ? new Date(b.last_login_at).getTime() : 0))
        case 'session_count':
          return dir * (a.session_count - b.session_count)
        case 'total_student_count':
          return dir * (a.total_student_count - b.total_student_count)
        case 'name':
        default: {
          const nameA = [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email
          const nameB = [b.first_name, b.last_name].filter(Boolean).join(' ') || b.email
          return dir * nameA.localeCompare(nameB)
        }
      }
    })

  const exportTeachersCsv = () => {
    if (teachers.length === 0) return
    const header = [
      'nome', 'cognome', 'email', tl("ruolo"), 'verificato', 'scuola',
      'ultimo_accesso', 'data_registrazione', tl("sessioni"), tl("studenti"),
      'scadenza_licenza', 'rinnovo_automatico', 'limite_mensile_crediti', 'utilizzo_mensile_crediti', 'consumo_periodo_crediti', 'chiamate_periodo',
    ]
    const body = teachers.map((t) => [
      t.first_name || '',
      t.last_name || '',
      t.email,
      t.role || 'teacher',
      t.is_verified ? 'si' : 'no',
      (t.schools || []).map(school => school.name).join('; ') || t.institution || '',
      t.last_login_at || '',
      t.created_at || '',
      t.session_count,
      t.total_student_count,
      t.license?.expires_at ? t.license.expires_at.slice(0, 10) : '',
      t.license?.expires_at ? (t.license.auto_renew ? 'si' : 'no') : '',
      toCredits(t.monthly_cap).toFixed(0),
      toCredits(t.monthly_usage).toFixed(1),
      toCredits(t.period_cost).toFixed(1),
      t.period_calls,
    ].map(escapeCsv).join(','))
    const blob = new Blob(['﻿' + [header.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `docenti-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const selectedCount = csvRows.filter(r => r.selected && r.status === 'idle').length
  const selectedTeachersCount = selectedTeacherIds.size
  const selectableTeachers = teachers.filter(t => (t.role || '').toUpperCase() !== 'ADMIN')
  const allVisibleTeachersSelected = selectableTeachers.length > 0 && selectableTeachers.every(t => selectedTeacherIds.has(t.id))
  const schoolTenants = (tenantRows || []).filter(t => t.tenant_type === 'SCHOOL' && t.status === 'active')
  const sentCount = csvRows.filter(r => r.status === 'sent').length
  const allIdleSelected = csvRows.filter(r => r.status === 'idle').length > 0 &&
    csvRows.filter(r => r.status === 'idle').every(r => r.selected)
  const normalizedInviteEmail = inviteEmail.trim().toLowerCase()
  const inviteTargetTeacher = (teachersStatus?.items || []).find((teacher) => teacher.email.toLowerCase() === normalizedInviteEmail)
  const teacherByEmail: Record<string, TeacherStatus> = {}
  ;(teachersStatus?.items || []).forEach((teacher) => {
    teacherByEmail[teacher.email.toLowerCase()] = teacher
  })

  // Only show pending/expired invitations — accepted ones are already in the teachers table
  const pendingOnlyInvitations = (invitations || []).filter((inv: any) => {
    const teacher = teacherByEmail[inv.email?.toLowerCase()]
    const hasLoggedIn = !!teacher?.last_login_at
    return !(inv.status === 'accepted' || hasLoggedIn)
  })

  const filteredInvitations = pendingOnlyInvitations.filter((inv: any) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return [inv.email, inv.first_name, inv.last_name, inv.group_tag].join(' ').toLowerCase().includes(q)
  })

  /* ── render ── */
  return (
    <div className="space-y-6">
      {/* Header */}
      <AdminPageHeader
        eyebrow={tl("Amministrazione utenti")}
        title={tl("Docenti")}
        description={
          <span className="tabular-nums">
            {teachers.length} {tl("docenti attivi")}
            {pending.length > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 font-medium text-amber-700">
                · <Clock className="h-3.5 w-3.5" /> {pending.length} {tl("in attesa")}
              </span>
            )}
          </span>
        }
        actions={
          <>
            <Button tone="neutral" surface="outline" onClick={exportTeachersCsv} disabled={teachers.length === 0}>
              <Download className="h-4 w-4" />
              {tl("Esporta CSV")}
            </Button>
            <Button tone="accent" surface="solid" onClick={() => setShowInvite((v) => !v)}>
              <UserPlus className="h-4 w-4" />
              {tl("Invita docente")}
              {showInvite ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </Button>
          </>
        }
      />

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={tl("Cerca docente o invitato…")}
          className="pl-9 text-sm"
        />
      </div>

      {/* Approval result banner */}
      {approvalResult && (
        <AdminNotice tone={approvalResult.email_sent ? 'success' : 'warning'} icon={Check} onClose={() => setApprovalResult(null)}>
          <strong>{tl("Docente approvato:")}</strong>{' '}
          {approvalResult.email_sent
            ? tl("Email di attivazione inviata a {0}", approvalResult.email)
            : tl("Attenzione: email non inviata a {0}. Verifica SMTP.", approvalResult.email)}
        </AdminNotice>
      )}

      {/* Reset password result */}
      {resetResult && (
        <AdminNotice tone={resetResult.email_sent ? 'success' : 'warning'} icon={Key} onClose={() => setResetResult(null)}>
          <div>
            <p className="mb-0.5 font-semibold">
              {resetResult.email_sent ? tl("Link di reset inviato") : tl("Reset generato — email non inviata")}
            </p>
            <p className="text-slate-700">
              {resetResult.email_sent
                ? <>{tl("Il docente riceverà un'email su")} <strong>{resetResult.email}</strong> {tl("con il link per impostare la nuova password (valido 24 h).")}</>
                : <>{tl("Verifica la configurazione SMTP. Email non recapitata a")} {resetResult.email}.</>
              }
            </p>
          </div>
        </AdminNotice>
      )}

      {/* ── INVITE PANEL ─────────────────────────────── */}
      {showInvite && (
        <div className="admin-panel space-y-5 p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Mail className="h-4 w-4 text-slate-500" />
            {tl("Invita docenti")}
          </h3>

          {/* ── single invite row ── */}
          <div className="space-y-3 rounded-md border border-[var(--admin-line)] bg-[var(--admin-surface-2)] p-4">
            <p className="admin-eyebrow">{tl("Invito singolo")}</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-5">
              <div className="space-y-1">
                <Label className="text-xs">{tl("Email *")}</Label>
                <Input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="docente@scuola.it" className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tl("Nome")}</Label>
                <Input value={inviteFirstName} onChange={e => setInviteFirstName(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tl("Cognome")}</Label>
                <Input value={inviteLastName} onChange={e => setInviteLastName(e.target.value)} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tl("Scuola")}</Label>
                <Input value={inviteSchool} onChange={e => setInviteSchool(e.target.value)} placeholder={tl("Istituto…")} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{tl("Scadenza licenza")}</Label>
                <Input type="date" value={licenseEnd} onChange={e => setLicenseEnd(e.target.value)} className="h-8 text-sm" title={tl("Vuoto = 12 mesi con rinnovo automatico")} />
              </div>
            </div>
            {inviteTargetTeacher ? (
              <div className="rounded-md border border-[var(--admin-line-strong)] bg-white px-3 py-2 text-xs text-slate-700">
                {tl("Questa email appartiene già al docente")}{' '}
                <strong>{[inviteTargetTeacher.first_name, inviteTargetTeacher.last_name].filter(Boolean).join(' ') || inviteTargetTeacher.email}</strong>{tl(". Usa")} <strong>{tl("Reinvia accesso")}</strong> {tl("invece di creare un nuovo invito.")}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                tone="accent"
                surface="solid"
                disabled={!inviteEmail.trim() || !!inviteTargetTeacher || inviteMutation.isPending}
                onClick={() => inviteMutation.mutate({ email: inviteEmail.trim(), firstName: inviteFirstName.trim() || undefined, lastName: inviteLastName.trim() || undefined, school: inviteSchool.trim() || undefined })}
              >
                <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                {inviteMutation.isPending ? tl("Invio…") : tl("Invia invito")}
              </Button>
              {inviteTargetTeacher ? (
                <Button
                  type="button"
                  tone="neutral"
                  surface="outline"
                  disabled={resetMutation.isPending}
                  onClick={() => resetMutation.mutate(inviteTargetTeacher.id)}
                >
                  <Key className="mr-1.5 h-3.5 w-3.5" />
                  {resetMutation.isPending ? tl("Invio link…") : tl("Reinvia accesso")}
                </Button>
              ) : null}
            </div>
          </div>

          {/* ── CSV import ── */}
          <div className="space-y-4">
            <p className="admin-eyebrow">{tl("Importazione CSV")}</p>

            {/* Drop zone */}
            {csvRows.length === 0 && (
              <div
                className={`relative rounded-md border-2 border-dashed transition-colors cursor-pointer flex flex-col items-center justify-center gap-3 py-10 ${dragOver ? 'border-[var(--admin-accent)] bg-[var(--admin-accent-soft)]' : 'border-[var(--admin-line-strong)] bg-white hover:border-slate-400'}`}
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
                  <p className="text-sm font-medium text-slate-600">{tl("Trascina un CSV qui o clicca per sfogliare")}</p>
                  <p className="text-xs text-slate-400 mt-1">{tl("Colonne rilevate automaticamente: email, nome, cognome, scuola")}</p>
                  <p className="text-xs text-slate-400">{tl("Separatore: virgola o punto e virgola · Con o senza intestazione")}</p>
                </div>
                <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFileUpload(f) }} />
              </div>
            )}

            {/* Preview table */}
            {csvRows.length > 0 && (
              <div className="overflow-hidden rounded-md border border-[var(--admin-line)] bg-white">
                {/* Toolbar */}
                <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 flex-wrap">
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-semibold text-slate-700">{csvRows.length} {tl("docenti importati")}</span>
                    {sentCount > 0 && <span className="text-xs text-emerald-700 font-medium">{sentCount} inviati</span>}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button tone="neutral" surface="outline" density="compact" onClick={() => { setCsvRows([]); if (fileInputRef.current) fileInputRef.current.value = '' }}>
                      <X className="h-3.5 w-3.5 mr-1" />{tl("Annulla")}
                    </Button>
                    <Button
                      tone="accent"
                      surface="solid"
                      density="compact"
                      disabled={selectedCount === 0 || isSendingAll}
                      onClick={sendAllSelected}
                    >
                      {isSendingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                      {isSendingAll ? tl("Invio in corso…") : tl("Invia {0} selezionati", selectedCount)}
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
                        placeholder={tl("Gruppo / tag (es. sperimentazione torino)")}
                        className="h-8 text-sm flex-1"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="h-4 w-4 text-slate-400 flex-shrink-0" />
                      <Input type="date" value={licenseEnd} onChange={e => setLicenseEnd(e.target.value)} className="h-8 w-40 text-sm" title={tl("Scadenza licenza (vuoto = 12 mesi con rinnovo automatico)")} aria-label={tl("Scadenza licenza")} />
                    </div>
                    <button
                      onClick={() => setShowMessage(v => !v)}
                      className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white hover:bg-slate-50 transition-colors"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      {showMessage ? tl("Nascondi messaggio") : tl("Messaggio personalizzato")}
                    </button>
                  </div>
                  {showMessage && (
                    <textarea
                      value={customMessage}
                      onChange={e => setCustomMessage(e.target.value)}
                      placeholder={tl("Testo aggiuntivo che apparirà nell'email di invito (facoltativo)…")}
                      className="w-full rounded-lg border border-slate-200 p-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-slate-300 min-h-[80px]"
                    />
                  )}
                </div>

                {/* Rows table */}
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr>
                        <th className="px-4 py-2 text-left w-8">
                          <input type="checkbox" checked={allIdleSelected} onChange={e => toggleSelectAll(e.target.checked)} className="rounded" />
                        </th>
                        <th className="px-3 py-2 text-left font-medium">{tl("Email")}</th>
                        <th className="px-3 py-2 text-left font-medium">{tl("Nome")}</th>
                        <th className="px-3 py-2 text-left font-medium">{tl("Cognome")}</th>
                        <th className="px-3 py-2 text-left font-medium">{tl("Scuola")}</th>
                        <th className="px-3 py-2 text-center font-medium">{tl("Stato")}</th>
                        <th className="px-3 py-2 text-right font-medium">{tl("Azione")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {csvRows.map(row => (
                        <tr key={row.id} className={row.status === 'error' ? 'bg-red-50/50' : ''}>
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
                            {row.status === 'sent' && <CheckCircle2 className="h-4 w-4 text-emerald-700 mx-auto" />}
                            {row.status === 'error' && (
                              <span title={row.errorMsg}>
                                <AlertCircle className="h-4 w-4 text-red-600 mx-auto" />
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {row.status === 'idle' && (
                              <button
                                onClick={() => sendSingleRow(row)}
                                className="text-xs font-semibold text-[var(--admin-accent)] hover:underline"
                              >
                                {tl("Invia")}
                              </button>
                            )}
                            {row.status === 'error' && (
                              <button onClick={() => { updateRow(row.id, { status: 'idle', errorMsg: undefined }); sendSingleRow({ ...row, status: 'idle' }) }} className="text-xs text-amber-700 hover:underline font-semibold">{tl("Riprova")}</button>
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
        </div>
      )}

      {/* ── INVITI IN ATTESA (pending/scaduti) ─────────── */}
      {pendingOnlyInvitations.length > 0 && (
        <div className="admin-panel">
          <div>
            <div className="admin-panel-head">
              <button
                onClick={() => setShowInvitations(v => !v)}
                className="flex items-center gap-2 text-left group"
              >
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {tl("Inviti in attesa")}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {filteredInvitations.length} {tl("risultati")}
                    {search.trim() ? ` per "${search}"` : tl(" · {0} non ancora accettati", pendingOnlyInvitations.length)}
                  </p>
                </div>
                {showInvitations
                  ? <ChevronUp className="h-4 w-4 text-slate-400 ml-2" />
                  : <ChevronDown className="h-4 w-4 text-slate-400 ml-2" />}
              </button>
              <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--admin-accent)] animate-pulse" />
                {tl("aggiornamento automatico")}
              </span>
            </div>

            {showInvitations && (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-xs">
                  <thead>
                    <tr>
                      <th className="pb-1.5 font-medium">{tl("Docente")}</th>
                      <th className="pb-1.5 font-medium">{tl("Gruppo")}</th>
                      <th className="pb-1.5 font-medium">{tl("Stato")}</th>
                      <th className="pb-1.5 font-medium">{tl("Inviato")}</th>
                      <th className="pb-1.5 font-medium">{tl("Scadenza")}</th>
                      <th className="pb-1.5 text-right font-medium">{tl("Azioni")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInvitations.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-sm text-slate-400">
                          {tl("Nessun invito trovato")}
                        </td>
                      </tr>
                    ) : (
                      filteredInvitations.slice(0, 50).map((inv: any) => {
                        const isExpired = !inv.responded_at && new Date(inv.expires_at) < new Date()
                        return (
                          <tr key={inv.id}>
                            <td className="py-2">
                              <div>
                                <p className="font-medium text-slate-700">{[inv.first_name, inv.last_name].filter(Boolean).join(' ') || '—'}</p>
                                <p className="font-mono text-[11px] text-slate-500">{inv.email}</p>
                              </div>
                            </td>
                            <td className="py-2">
                              {inv.group_tag
                                ? <AdminBadge>{inv.group_tag}</AdminBadge>
                                : <span className="text-slate-300">—</span>}
                            </td>
                            <td className="py-2">
                              {isExpired
                                ? <AdminBadge tone="danger">scaduto</AdminBadge>
                                : <AdminBadge tone="warning">{tl("in attesa")}</AdminBadge>}
                            </td>
                            <td className="py-2 text-slate-500">{formatDate(inv.created_at)}</td>
                            <td className="py-2 text-slate-500">{formatDate(inv.expires_at)}</td>
                            <td className="py-2 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  tone="neutral"
                                  surface="outline"
                                  density="compact"
                                  onClick={() => resendInvitationMutation.mutate(inv.id)}
                                  disabled={resendInvitationMutation.isPending || deleteInvitationMutation.isPending}
                                >
                                  <Send className="h-3 w-3" />
                                  {tl("Reinvia")}
                                </Button>
                                <Button
                                  tone="danger"
                                  surface="ghost"
                                  density="compact"
                                  onClick={() => {
                                    if (confirm(tl("Rimuovere l'invito per {0}? L'account verrà disattivato.", inv.email)))
                                      deleteInvitationMutation.mutate(inv.id)
                                  }}
                                  disabled={deleteInvitationMutation.isPending || resendInvitationMutation.isPending}
                                >
                                  <Trash2 className="h-3 w-3" />
                                  {tl("Rimuovi")}
                                </Button>
                              </div>
                            </td>
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PENDING APPROVALS BLOCK ────────────────────── */}
      {!loadingRequests && pending.length > 0 && (
        <div className="admin-panel border-l-[3px] border-l-amber-600">
          <div className="admin-panel-head !justify-start">
            <Clock className="h-4 w-4 text-amber-700" />
            <h3 className="text-sm font-semibold text-slate-900">
              {pending.length} {tl("richiesta")}{pending.length > 1 ? 'e' : ''} {tl("in attesa di approvazione")}
            </h3>
          </div>
          <div className="divide-y divide-[var(--admin-line)]">
            {pending.map((req) => (
              <div
                key={req.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-[var(--admin-line)] bg-[var(--admin-surface-2)]">
                    <GraduationCap className="h-4 w-4 text-slate-600" />
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
                    tone="accent"
                    surface="solid"
                    density="compact"
                    onClick={() => approveMutation.mutate(req.id)}
                    disabled={approveMutation.isPending}
                  >
                    <Check className="h-3.5 w-3.5" />
                    {tl("Approva")}
                  </Button>
                  <Button
                    tone="danger"
                    surface="outline"
                    density="compact"
                    onClick={() => rejectMutation.mutate(req.id)}
                    disabled={rejectMutation.isPending}
                  >
                    <X className="h-3.5 w-3.5" />
                    {tl("Rifiuta")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── TEACHERS TABLE ─────────────────────────────── */}
      <div className="space-y-3">
        {/* Clusters: filter the list, then act on the whole group with the header checkbox */}
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={tl("Filtra i docenti")}>
          {([
            ['all', tl("Tutti")], ['no_school', tl("Senza istituto")], ['expiring', tl("In scadenza (30 gg)")],
            ['expired', tl("Scaduti")], ['no_license', tl("Senza scadenza")],
          ] as Array<[TeacherFilter, string]>).map(([id, label]) => (
            <Button key={id} tone="neutral" surface="ghost" density="compact" aria-pressed={filter === id}
              className={filter === id ? 'ds-selected' : ''} onClick={() => setFilter(id)}>
              {label}<span className="ml-1.5 text-[10px] tabular-nums text-slate-500">{filterCounts[id]}</span>
            </Button>
          ))}
        </div>

        {selectedTeachersCount > 0 && (
          <div className="admin-panel border-[var(--admin-accent)] bg-[var(--admin-accent-soft)] p-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span className="text-sm font-semibold text-[var(--admin-accent)]">
                {selectedTeachersCount} {selectedTeachersCount === 1 ? tl("docente selezionato") : tl("docenti selezionati")}
              </span>
              <Button tone="accent" surface="solid" density="compact"
                onClick={() => setLicenseTarget({ ids: Array.from(selectedTeacherIds), title: tl("Licenza di {0} docenti", selectedTeachersCount), subtitle: tl("La stessa scadenza verrà applicata a tutti i docenti selezionati.") })}>
                <Clock className="mr-1.5 h-3.5 w-3.5" />{tl("Imposta scadenza")}
              </Button>
              <div className="flex flex-wrap items-center gap-1.5">
                <select value={bulkSchoolId} onChange={(e) => setBulkSchoolId(e.target.value)} aria-label={tl("Istituto")}
                  className="h-8 min-w-[200px] rounded-md border border-[var(--admin-line-strong)] bg-white px-2 text-xs text-slate-900">
                  <option value="">{tl("Istituto…")}</option>
                  {schoolTenants.map(school => <option key={school.id} value={school.id}>{school.name}</option>)}
                </select>
                <Button tone="accent" surface="solid" density="compact" disabled={!bulkSchoolId || assignMutation.isPending}
                  title={tl("Aggiunge subito i docenti all'istituto, senza invito da accettare")}
                  onClick={() => assignMutation.mutate({ ids: Array.from(selectedTeacherIds), schoolId: bulkSchoolId })}>
                  <Building2 className="mr-1.5 h-3.5 w-3.5" />{tl("Assegna")}
                </Button>
                <Button tone="neutral" surface="outline" density="compact" disabled={!bulkSchoolId || bulkSchoolMutation.isPending}
                  title={tl("Invia un invito che il docente deve accettare")} onClick={() => bulkSchoolMutation.mutate('add')}>
                  {tl("Invita")}
                </Button>
                <Button tone="neutral" surface="ghost" density="compact" disabled={!bulkSchoolId || bulkSchoolMutation.isPending} onClick={() => bulkSchoolMutation.mutate('remove')}>
                  {tl("Rimuovi")}
                </Button>
              </div>
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-500">cr.</span>
                <Input type="number" min="0" step="10" value={bulkCap} onChange={(e) => setBulkCap(e.target.value)} placeholder={tl("Limite/mese")} className="h-8 w-28 bg-white text-xs" />
                <Button tone="neutral" surface="outline" density="compact"
                  disabled={bulkCap === '' || Number.isNaN(Number(bulkCap)) || Number(bulkCap) < 0 || bulkCapMutation.isPending}
                  onClick={() => bulkCapMutation.mutate(Number(bulkCap))}>{tl("Applica")}</Button>
              </div>
              <button type="button" className="ml-auto text-xs font-medium text-slate-600 hover:text-slate-900" onClick={() => setSelectedTeacherIds(new Set())}>
                {tl("Deseleziona")}
              </button>
            </div>
          </div>
        )}

        <div className="admin-panel">
          {loadingTeachers ? (
            <AdminEmpty>{tl("Caricamento…")}</AdminEmpty>
          ) : teachers.length === 0 ? (
            <AdminEmpty>{tl("Nessun docente trovato")}</AdminEmpty>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] table-fixed text-[13px]">
                <thead>
                  <tr className="text-left text-xs">
                    <th className="w-9 py-2.5 pl-3 font-medium">
                      <input type="checkbox" className="rounded" checked={allVisibleTeachersSelected}
                        onChange={(e) => {
                          const next = new Set(selectedTeacherIds)
                          selectableTeachers.forEach(teacher => e.target.checked ? next.add(teacher.id) : next.delete(teacher.id))
                          setSelectedTeacherIds(next)
                        }}
                        aria-label={tl("Seleziona tutti i docenti visibili")} />
                    </th>
                    <th className="px-3 py-2.5 font-semibold">
                      <button type="button" onClick={() => toggleSort('name')} className="flex items-center gap-1 hover:text-slate-600">{tl("Docente")}<SortIcon field="name" sortField={sortField} sortDirection={sortDirection} /></button>
                    </th>
                    <th className="w-[22%] px-3 py-2.5 font-semibold">
                      <button type="button" onClick={() => toggleSort('institution')} className="flex items-center gap-1 hover:text-slate-600">{tl("Istituto")}<SortIcon field="institution" sortField={sortField} sortDirection={sortDirection} /></button>
                    </th>
                    <th className="w-[150px] px-3 py-2.5 font-semibold">
                      <button type="button" onClick={() => toggleSort('license')} className="flex items-center gap-1 hover:text-slate-600"><Clock className="h-3.5 w-3.5" />{tl("Scadenza")}<SortIcon field="license" sortField={sortField} sortDirection={sortDirection} /></button>
                    </th>
                    <th className="w-[150px] px-3 py-2.5 font-semibold">
                      <button type="button" onClick={() => toggleSort('last_login_at')} className="flex items-center gap-1 hover:text-slate-600"><LogIn className="h-3.5 w-3.5" />{tl("Attività")}<SortIcon field="last_login_at" sortField={sortField} sortDirection={sortDirection} /></button>
                    </th>
                    <th className="w-[150px] px-3 py-2.5 font-semibold"><span className="flex items-center gap-1"><Zap className="h-3.5 w-3.5" />{tl("Crediti/mese")}</span></th>
                    <th className="w-[96px] px-3 py-2.5 text-right font-medium">{tl("Azioni")}</th>
                  </tr>
                </thead>
                <tbody>
                  {teachers.map((teacher) => {
                    const isAdmin = (teacher.role || '').toUpperCase() === 'ADMIN'
                    const name = [teacher.first_name, teacher.last_name].filter(Boolean).join(' ') || '—'
                    const ratio = teacher.monthly_cap > 0 ? teacher.monthly_usage / teacher.monthly_cap : 0
                    return (
                      <tr key={teacher.id} className="align-middle transition-colors">
                        <td className="py-2 pl-3">
                          {!isAdmin && <input type="checkbox" className="rounded" checked={selectedTeacherIds.has(teacher.id)}
                            onChange={(e) => { const next = new Set(selectedTeacherIds); e.target.checked ? next.add(teacher.id) : next.delete(teacher.id); setSelectedTeacherIds(next) }}
                            aria-label={tl("Seleziona {0}", teacher.email)} />}
                        </td>

                        {/* Teacher */}
                        <td className="min-w-0 px-3 py-2">
                          <p className="flex min-w-0 items-center gap-1.5 font-semibold leading-tight text-slate-900">
                            <span className="truncate" title={name}>{name}</span>
                            {isAdmin && <AdminBadge tone="accent">admin</AdminBadge>}
                            {!isAdmin && !teacher.is_verified && <AdminBadge title={tl("Account non ancora verificato")}>{tl("non verificato")}</AdminBadge>}
                          </p>
                          <p className="truncate text-xs text-slate-500" title={teacher.email}>{teacher.email}</p>
                        </td>

                        {/* School */}
                        <td className="min-w-0 px-3 py-2 text-xs text-slate-600">
                          {assignRowId === teacher.id ? (
                            <div className="flex items-center gap-1">
                              <select autoFocus defaultValue="" aria-label={tl("Assegna istituto a {0}", name)}
                                onChange={(e) => { if (e.target.value) assignMutation.mutate({ ids: [teacher.id], schoolId: e.target.value }) }}
                                onKeyDown={(e) => { if (e.key === 'Escape') setAssignRowId(null) }}
                                className="h-7 min-w-0 flex-1 rounded-md border border-[var(--admin-line-strong)] bg-white px-1.5 text-xs text-slate-900">
                                <option value="">{tl("Scegli istituto…")}</option>
                                {schoolTenants.filter(sc => !(teacher.schools || []).some(x => x.id === sc.id)).map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
                              </select>
                              <button type="button" className="text-slate-400 hover:text-slate-700" onClick={() => setAssignRowId(null)} aria-label={tl("Annulla")}><X className="h-3.5 w-3.5" /></button>
                            </div>
                          ) : (
                            <div className="flex min-w-0 flex-wrap items-center gap-1">
                              {hasSchool(teacher) ? teacher.schools.map(school => <span key={school.id} className="admin-badge admin-badge-neutral max-w-full truncate" title={school.name}>{school.name}</span>)
                                : teacher.institution ? <span className="truncate" title={tl("Testo storico, non ancora collegato a un istituto")}>{teacher.institution}</span>
                                : <span className="text-slate-400">{tl("Nessun istituto")}</span>}
                              {!isAdmin && <button type="button" onClick={() => setAssignRowId(teacher.id)}
                                className="inline-flex h-5 items-center gap-0.5 rounded-full px-1.5 text-[10px] font-semibold text-[var(--admin-accent)] hover:bg-[var(--admin-accent-soft)]"
                                title={hasSchool(teacher) ? tl("Aggiungi un altro istituto") : tl("Assegna un istituto")}>
                                <UserPlus className="h-3 w-3" />{hasSchool(teacher) ? '' : tl("Assegna")}
                              </button>}
                            </div>
                          )}
                        </td>

                        {/* Licence */}
                        <td className="px-3 py-2">
                          {isAdmin ? <span className="text-xs text-slate-400">—</span> : (
                            <button type="button" className="group flex items-center gap-1.5 text-left" title={tl("Modifica scadenza")}
                              onClick={() => setLicenseTarget({ ids: [teacher.id], title: tl("Licenza di {0}", name), subtitle: teacher.license?.source === 'school' ? tl("Ora vale la scadenza dell'istituto, che è più vicina. Questa modifica riguarda solo la licenza personale.") : undefined, current: teacher.license?.own ?? teacher.license })}>
                              <LicenseBadge license={teacher.license} />
                              <Pencil className="h-3 w-3 text-slate-300 group-hover:text-slate-600" />
                            </button>
                          )}
                        </td>

                        {/* Activity */}
                        <td className="px-3 py-2 text-xs leading-tight">
                          <p className="whitespace-nowrap text-slate-700">{formatDateTime(teacher.last_login_at)}</p>
                          <p className="whitespace-nowrap tabular-nums text-slate-500" title={tl("Sessioni · studenti")}>{teacher.session_count} {tl("sess.")} · {teacher.total_student_count} {tl("stud.")}</p>
                        </td>

                        {/* Credits */}
                        <td className="px-3 py-2">
                          {editingCapId === teacher.id ? (
                            <div className="flex items-center gap-1">
                              <input type="number" min="0" step="10" autoFocus value={editingCapValue} onChange={(e) => setEditingCapValue(e.target.value)}
                                className="h-6 w-16 rounded border border-slate-300 px-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                              <button className="text-[var(--admin-accent)] hover:opacity-80" aria-label={tl("Salva")}
                                onClick={() => { const cap = parseFloat(editingCapValue); if (!isNaN(cap) && cap >= 0) setCreditLimitMutation.mutate({ teacherId: teacher.id, cap }) }}><Check className="h-3.5 w-3.5" /></button>
                              <button className="text-slate-400 hover:text-slate-700" aria-label={tl("Annulla")} onClick={() => setEditingCapId(null)}><X className="h-3.5 w-3.5" /></button>
                            </div>
                          ) : (
                            <button type="button" className="group w-full text-left" title={teacher.period_cost > 0 ? tl("Spesa effettiva ({0} chiamate): {1}", teacher.period_calls, formatCurrency(teacher.period_cost)) : tl("Modifica limite")}
                              onClick={() => { setEditingCapId(teacher.id); setEditingCapValue(String(toCredits(teacher.monthly_cap))) }}>
                              <span className="flex items-center gap-1 whitespace-nowrap text-xs tabular-nums text-slate-700">
                                {formatCurrency(teacher.monthly_usage)} <span className="text-slate-400">/</span> {formatCurrency(teacher.monthly_cap)}
                                <Pencil className="h-3 w-3 text-slate-300 group-hover:text-slate-600" />
                              </span>
                              <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-[#eceef1]">
                                <span className={`block h-full rounded-full ${ratio > 0.85 ? 'bg-red-600' : ratio > 0.6 ? 'bg-amber-500' : 'bg-[var(--admin-accent)]'}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                              </span>
                            </button>
                          )}
                        </td>

                        {/* Actions */}
                        <td className="px-3 py-2">
                          {hardDeleteId === teacher.id ? (
                            <div className="flex flex-wrap items-center justify-end gap-1">
                              <span className="mr-1 text-[10px] font-medium text-red-700">{tl("Digita email per confermare:")}</span>
                              <input type="email" autoFocus value={hardDeleteEmail} onChange={(e) => setHardDeleteEmail(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Escape') { setHardDeleteId(null); setHardDeleteEmail('') }
                                  if (e.key === 'Enter' && hardDeleteEmail.trim().toLowerCase() === teacher.email.toLowerCase()) hardDeleteMutation.mutate({ userId: teacher.id, confirmEmail: hardDeleteEmail.trim() })
                                }}
                                className="h-6 w-36 rounded border border-red-300 px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-red-400" placeholder={teacher.email} />
                              <button onClick={() => hardDeleteMutation.mutate({ userId: teacher.id, confirmEmail: hardDeleteEmail.trim() })}
                                disabled={hardDeleteEmail.trim().toLowerCase() !== teacher.email.toLowerCase() || hardDeleteMutation.isPending}
                                className="h-6 rounded bg-red-600 px-2 text-[10px] font-medium text-white hover:bg-red-700 disabled:opacity-40">{tl("Elimina")}</button>
                              <button onClick={() => { setHardDeleteId(null); setHardDeleteEmail('') }} className="h-6 rounded border border-slate-200 px-1.5 text-[10px] text-slate-500 hover:bg-slate-50">{tl("Annulla")}</button>
                            </div>
                          ) : (
                            <div className="relative flex items-center justify-end gap-0.5">
                              <Button tone="neutral" surface="ghost" density="icon" className="h-7 w-7 shrink-0" onClick={() => resetMutation.mutate(teacher.id)} disabled={resetMutation.isPending}
                                title={tl("Invia link reset password")} aria-label={tl("Invia link reset password")}><Key className="h-3.5 w-3.5" /></Button>
                              <Button tone="neutral" surface="ghost" density="icon" className="h-7 w-7 shrink-0" aria-haspopup="menu" aria-expanded={menuId === teacher.id}
                                title={tl("Altre azioni")} aria-label={tl("Altre azioni")} onClick={() => setMenuId(menuId === teacher.id ? null : teacher.id)}><MoreVertical className="h-3.5 w-3.5" /></Button>
                              {menuId === teacher.id && (
                                <>
                                  <div className="fixed inset-0 z-20" onClick={() => setMenuId(null)} />
                                  <div role="menu" className="ds-popover absolute right-0 top-8 z-30 w-60 rounded-xl p-1 text-left text-xs">
                                    {!isAdmin ? (
                                      <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-[var(--ds-control-hover)]" disabled={promoteMutation.isPending}
                                        onClick={() => { setMenuId(null); if (confirm(tl("Promuovere {0} ad amministratore? Non sarà più un docente.", teacher.email))) promoteMutation.mutate(teacher.id) }}>
                                        <ShieldCheck className="h-3.5 w-3.5" />{tl("Promuovi ad amministratore")}</button>
                                    ) : (
                                      <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-[var(--ds-control-hover)]" disabled={demoteMutation.isPending}
                                        onClick={() => { setMenuId(null); if (confirm(tl("Rimuovere i permessi di amministratore a {0}? Tornerà ad essere un docente.", teacher.email))) demoteMutation.mutate(teacher.id) }}>
                                        <UserMinus className="h-3.5 w-3.5" />{tl("Rimuovi permessi di amministratore")}</button>
                                    )}
                                    <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 hover:bg-[var(--ds-control-hover)]" disabled={deleteMutation.isPending}
                                      onClick={() => { setMenuId(null); if (confirm(tl("Disattivare {0}? L'account verrà nascosto ma resterà nel database.", teacher.email))) deleteMutation.mutate(teacher.id) }}>
                                      <X className="h-3.5 w-3.5" />{tl("Disattiva account")}</button>
                                    <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-red-700 hover:bg-red-50"
                                      onClick={() => { setMenuId(null); setHardDeleteId(teacher.id); setHardDeleteEmail('') }}>
                                      <Trash2 className="h-3.5 w-3.5" />{tl("Elimina definitivamente…")}</button>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <LicenseDialog open={!!licenseTarget} title={licenseTarget?.title || ''} subtitle={licenseTarget?.subtitle} current={licenseTarget?.current}
        pending={licenseMutation.isPending} onClose={() => setLicenseTarget(null)}
        onSubmit={change => licenseTarget && licenseMutation.mutate({ ids: licenseTarget.ids, change })} />
    </div>
  )
}
