import { useState } from 'react'
import { toCredits, fromCredits, formatCreditAmount } from '@/lib/credits'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi, type LicenseChange } from '@/lib/api'
import { LicenseBadge, LicenseDialog, type LicenseInfo } from '@/components/admin/LicenseDialog'
import { useToast } from '@/components/ui/use-toast'
import {
  Pencil, Check, X, ChevronDown, ChevronUp,
  Loader2, Plus, Building2, User,
} from '@/components/icons'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { EmailHealthBanner, SchoolInviteManager, RegistrySearch } from '@/components/admin/SchoolInviteManager'
import { SchoolMonitor } from '@/components/admin/SchoolMonitor'
import { schoolOnboardingAdminApi } from '@/lib/api'
import { tl } from '@/i18n/tl'
import { AdminBadge, AdminEmpty, AdminPageHeader, AdminTabs } from '@/components/admin/AdminUI'

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
  license?: LicenseInfo
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
    <AdminBadge className="!font-normal">
      <span className="font-semibold text-slate-900 tabular-nums">{value}</span> {label}
    </AdminBadge>
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
          : <button onClick={() => setOpen(o => !o)} className="text-xs font-medium text-[var(--admin-accent)] hover:underline">{open ? tl("Annulla") : tl("Associa codice meccanografico")}</button>}
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

  const [licenseOpen, setLicenseOpen] = useState(false)
  const licenseMutation = useMutation({
    mutationFn: (change: LicenseChange) => adminApi.setTenantLicense(tenant.id, change),
    onSuccess: () => { toast({ title: tl("Licenza dell'istituto aggiornata") }); setLicenseOpen(false); onRefresh() },
    onError: (error: any) => toast({ title: tl("Errore salvataggio"), description: error.response?.data?.detail, variant: 'destructive' }),
  })
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
    <div className="admin-panel mb-2">
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md border border-[var(--admin-line)] bg-[var(--admin-surface-2)]">
          {isSchool
            ? <Building2 className="h-4 w-4 text-slate-600" />
            : <User className="h-4 w-4 text-slate-600" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">{tenant.name}</span>
            <AdminBadge tone={isSchool ? 'accent' : 'neutral'}>
              {isSchool ? tl("SCUOLA") : 'INDIVIDUALE'}
            </AdminBadge>
            {isSchool && (
              tenant.mechanographic_code
                ? <AdminBadge tone="success" className="font-mono" title={tl("Codice meccanografico verificato sul registro MIM")}>
                    {tenant.mechanographic_code}
                  </AdminBadge>
                : <AdminBadge tone="warning">{tl("senza meccanografico")}</AdminBadge>
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
        <button type="button" className="group flex flex-shrink-0 items-center gap-1.5 text-left" title={tl("Modifica scadenza della licenza dell'istituto")}
          onClick={(e) => { e.stopPropagation(); setLicenseOpen(true) }}>
          <LicenseBadge license={tenant.license} />
          <Pencil className="h-3 w-3 text-slate-300 group-hover:text-slate-600" />
        </button>
        <span className="flex-shrink-0 text-xs text-slate-500 tabular-nums">
          {new Date(tenant.created_at).toLocaleDateString('it-IT')}
        </span>
        {expanded ? <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />}
      </div>

      <LicenseDialog open={licenseOpen} title={tl("Licenza di {0}", tenant.name)} subtitle={isSchool ? tl("Quando scade, tutti i docenti dell'istituto perdono l'accesso, anche se la loro licenza personale è ancora valida.") : undefined}
        current={tenant.license} pending={licenseMutation.isPending} onClose={() => setLicenseOpen(false)} onSubmit={change => licenseMutation.mutate(change)} />

      {/* Expanded: limit editor */}
      {expanded && (
        <div className="border-t border-[var(--admin-line)] bg-[var(--admin-surface-2)] px-4 py-4">
          {isSchool && <RegistryLink tenant={tenant} onRefresh={onRefresh} />}
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700">{tl("Modifica limiti")}</span>
            {!editing
              ? <Button tone="neutral" surface="outline" density="compact" onClick={() => setEditing(true)}><Pencil className="h-3 w-3" /> {tl("Modifica")}</Button>
              : <div className="flex gap-2">
                  <Button tone="neutral" surface="ghost" density="compact" onClick={() => setEditing(false)}>
                    <X className="h-3 w-3" /> {tl("Annulla")}
                  </Button>
                  <Button tone="accent" surface="solid" density="compact" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} {tl("Salva")}
                  </Button>
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
    <div className="admin-panel p-5">
      <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
        <Building2 className="h-4 w-4 text-slate-500" /> {tl("Crea nuova scuola")}
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
    <div className="space-y-5">
      <AdminPageHeader
        title={tl("Scuole")}
        description={<span className="tabular-nums">{schools.length} {tl("istituti ·")} {individuals.length} {tl("docenti individuali")}</span>}
        actions={<AdminTabs value={tab} onChange={setTab} options={[['monitor', tl("Monitoraggio")], ['invites', tl("Inviti")], ['tenants', tl("Tenant e limiti")]]} />}
      />

      <EmailHealthBanner />

      {tab === 'monitor' && <SchoolMonitor />}
      {tab === 'invites' && <SchoolInviteManager />}
      {tab === 'tenants' && <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <AdminTabs value={filter} onChange={setFilter} options={[['all', tl("Tutti")], ['SCHOOL', tl("Scuole")], ['INDIVIDUAL', tl("Individuali")]]} />
          <Button onClick={() => setShowCreate(s => !s)} tone="neutral" surface="outline" className="gap-2 text-sm">
            <Plus className="h-4 w-4" />{tl("Crea scuola senza onboarding")}
          </Button>
        </div>
        {showCreate && <CreateSchoolForm onSuccess={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['admin-tenants'] }) }} />}
        {isLoading && <div className="flex items-center justify-center py-12 text-sm text-slate-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> {tl("Caricamento…")}</div>}
        {!isLoading && filtered.length === 0 && <AdminEmpty>{tl("Nessun tenant trovato")}</AdminEmpty>}
        {filtered.map(tenant => (
          <TenantRow key={tenant.id} tenant={tenant} onRefresh={() => qc.invalidateQueries({ queryKey: ['admin-tenants'] })} />
        ))}
      </div>}
    </div>
  )
}
