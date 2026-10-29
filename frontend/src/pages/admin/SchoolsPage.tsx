import { useState } from 'react'
import { toCredits, fromCredits, formatCreditAmount } from '@/lib/credits'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import {
  School, Pencil, Check, X, ChevronDown, ChevronUp,
  Loader2, Plus, Building2, User,
} from '@/components/icons'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { EmailHealthBanner, SchoolInviteManager, RegistrySearch } from '@/components/admin/SchoolInviteManager'
import { SchoolMonitor } from '@/components/admin/SchoolMonitor'
import { schoolOnboardingAdminApi } from '@/lib/api'
import { tl } from '@/i18n/tl'

interface Tenant {
  id: string
  name: string
  slug: string
  status: string
  tenant_type: string
  created_at: string
  owner_user_id: string | null
  max_teachers: number
  max_students_per_teacher: number
  max_students_per_class: number
  monthly_credit_pool: number
  teacher_monthly_cap: number
  mechanographic_code?: string | null
  registry_verified?: boolean
}

interface EditLimitsState {
  max_teachers: string
  max_students_per_teacher: string
  max_students_per_class: string
  monthly_credit_pool: string
  teacher_monthly_cap: string
}

function LimitsBadge({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
      <span className="font-semibold">{value}</span> {label}
    </span>
  )
}

function RegistryLink({ tenant, onRefresh }: { tenant: Tenant; onRefresh: () => void }) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const link = useMutation({
    mutationFn: (code: string) => schoolOnboardingAdminApi.linkTenant(tenant.id, code),
    onSuccess: () => { toast({ title: tl("Meccanografico associato") }); setOpen(false); onRefresh() },
    onError: (e: unknown) => toast({
      title: (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || tl("Associazione non riuscita"),
      variant: 'destructive',
    }),
  })
  const unlink = useMutation({
    mutationFn: () => schoolOnboardingAdminApi.unlinkTenant(tenant.id),
    onSuccess: () => { toast({ title: tl("Associazione rimossa") }); onRefresh() },
  })
  return (
    <div className="mb-4 pb-4 border-b border-slate-200">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-slate-700">{tl("Registro MIM")}</span>
        {tenant.mechanographic_code
          ? <button onClick={() => unlink.mutate()} className="text-xs text-slate-500 hover:underline">{tl("Scollega")}</button>
          : <button onClick={() => setOpen(o => !o)} className="text-xs text-indigo-600 hover:underline">{open ? tl("Annulla") : tl("Associa codice meccanografico")}</button>}
      </div>
      {tenant.mechanographic_code
        ? <p className="text-sm text-slate-600 mt-1">{tl("Codice")} <span className="font-mono font-semibold">{tenant.mechanographic_code}</span> {tl("certificato sul registro delle scuole.")}</p>
        : <p className="text-xs text-slate-500 mt-1">{tl("Questo istituto non è ancora mappato a un codice meccanografico.")}</p>}
      {open && !tenant.mechanographic_code && (
        <div className="mt-3"><RegistrySearch placeholder={tl("Cerca «{0}» nel registro…", tenant.name)} onPick={(s) => link.mutate(s.code)} /></div>
      )}
    </div>
  )
}

function TenantRow({ tenant, onRefresh }: { tenant: Tenant; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [limits, setLimits] = useState<EditLimitsState>({
    max_teachers: String(tenant.max_teachers),
    max_students_per_teacher: String(tenant.max_students_per_teacher),
    max_students_per_class: String(tenant.max_students_per_class),
    monthly_credit_pool: String(toCredits(tenant.monthly_credit_pool)),
    teacher_monthly_cap: String(toCredits(tenant.teacher_monthly_cap)),
  })
  const { toast } = useToast()
  const isSchool = tenant.tenant_type === 'SCHOOL'

  const saveMutation = useMutation({
    mutationFn: () => adminApi.updateTenantLimits(tenant.id, {
      max_teachers: parseInt(limits.max_teachers) || undefined,
      max_students_per_teacher: parseInt(limits.max_students_per_teacher) || undefined,
      max_students_per_class: parseInt(limits.max_students_per_class) || undefined,
      monthly_credit_pool: Number.isFinite(parseFloat(limits.monthly_credit_pool)) ? fromCredits(parseFloat(limits.monthly_credit_pool)) : undefined,
      teacher_monthly_cap: Number.isFinite(parseFloat(limits.teacher_monthly_cap)) ? fromCredits(parseFloat(limits.teacher_monthly_cap)) : undefined,
    }),
    onSuccess: () => {
      toast({ title: tl("Limiti aggiornati") })
      setEditing(false)
      onRefresh()
    },
    onError: () => toast({ title: tl("Errore salvataggio"), variant: 'destructive' }),
  })

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-3">
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: isSchool ? '#fe004d18' : '#6366f118' }}>
          {isSchool
            ? <Building2 className="w-4 h-4 text-pink-500" />
            : <User className="w-4 h-4 text-indigo-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800 text-sm truncate">{tenant.name}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isSchool ? 'bg-pink-100 text-pink-600' : 'bg-indigo-100 text-indigo-600'}`}>
              {isSchool ? tl("SCUOLA") : 'INDIVIDUALE'}
            </span>
            {isSchool && (
              tenant.mechanographic_code
                ? <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700" title={tl("Codice meccanografico verificato sul registro MIM")}>
                    {tenant.mechanographic_code}
                  </span>
                : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">{tl("senza meccanografico")}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {isSchool && <LimitsBadge label={tl("docenti")} value={tenant.max_teachers} />}
            <LimitsBadge label="stud/classe" value={tenant.max_students_per_class} />
            <LimitsBadge label="stud/docente" value={tenant.max_students_per_teacher} />
            <LimitsBadge label={isSchool ? tl("crediti pool/mese") : tl("crediti studenti/mese")} value={formatCreditAmount(toCredits(tenant.monthly_credit_pool))} />
            {!isSchool && <LimitsBadge label={tl("crediti docente/mese")} value={formatCreditAmount(toCredits(tenant.teacher_monthly_cap))} />}
          </div>
        </div>
        <span className="text-slate-400 text-xs flex-shrink-0">
          {new Date(tenant.created_at).toLocaleDateString('it-IT')}
        </span>
        {expanded ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />}
      </div>

      {/* Expanded: limit editor */}
      {expanded && (
        <div className="border-t border-slate-100 px-4 py-4 bg-slate-50">
          {isSchool && <RegistryLink tenant={tenant} onRefresh={onRefresh} />}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700">{tl("Modifica limiti")}</span>
            {!editing
              ? <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline"><Pencil className="w-3 h-3" /> {tl("Modifica")}</button>
              : <div className="flex gap-2">
                  <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
                    className="flex items-center gap-1 text-xs text-green-700 font-semibold hover:underline">
                    {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} {tl("Salva")}
                  </button>
                  <button onClick={() => setEditing(false)} className="flex items-center gap-1 text-xs text-slate-500 hover:underline">
                    <X className="w-3 h-3" /> {tl("Annulla")}
                  </button>
                </div>
            }
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {isSchool && (
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">{tl("Max docenti")}</Label>
                {editing
                  ? <Input type="number" min={1} value={limits.max_teachers} onChange={e => setLimits(l => ({ ...l, max_teachers: e.target.value }))} className="h-8 text-sm" />
                  : <span className="text-sm font-semibold text-slate-800">{tenant.max_teachers}</span>}
              </div>
            )}
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">{tl("Max stud/classe")}</Label>
              {editing
                ? <Input type="number" min={1} value={limits.max_students_per_class} onChange={e => setLimits(l => ({ ...l, max_students_per_class: e.target.value }))} className="h-8 text-sm" />
                : <span className="text-sm font-semibold text-slate-800">{tenant.max_students_per_class}</span>}
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">{tl("Max stud/docente")}</Label>
              {editing
                ? <Input type="number" min={1} value={limits.max_students_per_teacher} onChange={e => setLimits(l => ({ ...l, max_students_per_teacher: e.target.value }))} className="h-8 text-sm" />
                : <span className="text-sm font-semibold text-slate-800">{tenant.max_students_per_teacher}</span>}
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">{isSchool ? tl("Pool crediti scuola (crediti/mese)") : tl("Pool crediti studenti (crediti/mese)")}</Label>
              {editing
                ? <Input type="number" min={0} step={10} value={limits.monthly_credit_pool} onChange={e => setLimits(l => ({ ...l, monthly_credit_pool: e.target.value }))} className="h-8 text-sm" />
                : <span className="text-sm font-semibold text-slate-800">{formatCreditAmount(toCredits(tenant.monthly_credit_pool))} {tl("crediti")}</span>}
            </div>
            {!isSchool && (
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">{tl("Cap docente (crediti/mese)")}</Label>
                {editing
                  ? <Input type="number" min={0} step={10} value={limits.teacher_monthly_cap} onChange={e => setLimits(l => ({ ...l, teacher_monthly_cap: e.target.value }))} className="h-8 text-sm" />
                  : <span className="text-sm font-semibold text-slate-800">{formatCreditAmount(toCredits(tenant.teacher_monthly_cap))} {tl("crediti")}</span>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function CreateSchoolForm({ onSuccess }: { onSuccess: () => void }) {
  const [form, setForm] = useState({
    school_name: '', slug: '',
    owner_first_name: '', owner_last_name: '', owner_email: '',
    max_teachers: '5', monthly_credit_pool: '1000',
  })
  const { toast } = useToast()

  const mutation = useMutation({
    mutationFn: () => adminApi.createSchoolTenant({
      school_name: form.school_name,
      slug: form.slug,
      owner_first_name: form.owner_first_name,
      owner_last_name: form.owner_last_name,
      owner_email: form.owner_email,
      max_teachers: parseInt(form.max_teachers) || 5,
      monthly_credit_pool: fromCredits(parseFloat(form.monthly_credit_pool) || 1000),
    }),
    onSuccess: () => {
      toast({ title: tl("Scuola creata! Email di attivazione inviata all'owner.") })
      setForm({ school_name: '', slug: '', owner_first_name: '', owner_last_name: '', owner_email: '', max_teachers: '5', monthly_credit_pool: '1000' })
      onSuccess()
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || tl("Errore")
      toast({ title: msg, variant: 'destructive' })
    },
  })

  const autoSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
        <Building2 className="w-4 h-4 text-pink-500" /> {tl("Crea nuova scuola")}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-slate-500 mb-1 block">{tl("Nome scuola *")}</Label>
          <Input value={form.school_name} onChange={e => {
            setForm(f => ({ ...f, school_name: e.target.value, slug: autoSlug(e.target.value) }))
          }} placeholder="IC Manzoni Milano" className="text-sm" />
        </div>
        <div>
          <Label className="text-xs text-slate-500 mb-1 block">Slug (URL) *</Label>
          <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="ic-manzoni-milano" className="text-sm" />
        </div>
        <div>
          <Label className="text-xs text-slate-500 mb-1 block">{tl("Nome owner *")}</Label>
          <Input value={form.owner_first_name} onChange={e => setForm(f => ({ ...f, owner_first_name: e.target.value }))} placeholder="Mario" className="text-sm" />
        </div>
        <div>
          <Label className="text-xs text-slate-500 mb-1 block">{tl("Cognome owner *")}</Label>
          <Input value={form.owner_last_name} onChange={e => setForm(f => ({ ...f, owner_last_name: e.target.value }))} placeholder="Rossi" className="text-sm" />
        </div>
        <div>
          <Label className="text-xs text-slate-500 mb-1 block">{tl("Email owner *")}</Label>
          <Input type="email" value={form.owner_email} onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))} placeholder="m.rossi@scuola.it" className="text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-slate-500 mb-1 block">{tl("Max docenti")}</Label>
            <Input type="number" min={1} value={form.max_teachers} onChange={e => setForm(f => ({ ...f, max_teachers: e.target.value }))} className="text-sm" />
          </div>
          <div>
            <Label className="text-xs text-slate-500 mb-1 block">{tl("Pool crediti (crediti/mese)")}</Label>
            <Input type="number" min={0} step={1} value={form.monthly_credit_pool} onChange={e => setForm(f => ({ ...f, monthly_credit_pool: e.target.value }))} className="text-sm" />
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !form.school_name || !form.owner_email}
          tone="accent" surface="solid" className="text-sm"
        >
          {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
          {tl("Crea scuola e invia invito")}
        </Button>
      </div>
    </div>
  )
}

type Tab = 'monitor' | 'invites' | 'tenants'

export default function SchoolsPage() {
  const [tab, setTab] = useState<Tab>('monitor')
  const [showCreate, setShowCreate] = useState(false)
  const [filter, setFilter] = useState<'all' | 'SCHOOL' | 'INDIVIDUAL'>('all')
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['admin-tenants'],
    queryFn: () => adminApi.getTenants(),
  })

  const tenants: Tenant[] = (data?.data as Tenant[] | undefined) ?? []
  const filtered = filter === 'all' ? tenants : tenants.filter(t => t.tenant_type === filter)
  const schools = tenants.filter(t => t.tenant_type === 'SCHOOL')
  const individuals = tenants.filter(t => t.tenant_type !== 'SCHOOL')

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-pink-50">
            <School className="h-5 w-5 text-pink-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">{tl("Scuole")}</h1>
            <p className="text-xs text-slate-500">{schools.length} {tl("istituti ·")} {individuals.length} {tl("docenti individuali")}</p>
          </div>
        </div>
        <div className="flex gap-1 rounded-xl bg-white p-1 shadow-sm ring-1 ring-slate-200">
          {([['monitor', tl("Monitoraggio")], ['invites', tl("Inviti")], ['tenants', tl("Tenant e limiti")]] as const).map(([key, label]) =>
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${tab === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}
        </div>
      </div>

      <EmailHealthBanner />

      {tab === 'monitor' && <SchoolMonitor />}
      {tab === 'invites' && <SchoolInviteManager />}
      {tab === 'tenants' && <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex w-fit gap-1 rounded-xl bg-slate-100 p-1">
            {(['all', 'SCHOOL', 'INDIVIDUAL'] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${filter === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                {f === 'all' ? tl("Tutti") : f === 'SCHOOL' ? tl("Scuole") : tl("Individuali")}
              </button>
            ))}
          </div>
          <Button onClick={() => setShowCreate(s => !s)} tone="neutral" surface="outline" className="gap-2 text-sm">
            <Plus className="h-4 w-4" />{tl("Crea scuola senza onboarding")}
          </Button>
        </div>
        {showCreate && <CreateSchoolForm onSuccess={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['admin-tenants'] }) }} />}
        {isLoading && <div className="flex items-center justify-center py-12 text-sm text-slate-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> {tl("Caricamento…")}</div>}
        {!isLoading && filtered.length === 0 && <div className="py-12 text-center text-sm text-slate-400">{tl("Nessun tenant trovato")}</div>}
        {filtered.map(tenant => (
          <TenantRow key={tenant.id} tenant={tenant} onRefresh={() => qc.invalidateQueries({ queryKey: ['admin-tenants'] })} />
        ))}
      </div>}
    </div>
  )
}
