import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import {
  School, Pencil, Check, X, ChevronDown, ChevronUp,
  Loader2, Plus, Building2, User,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

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

function TenantRow({ tenant, onRefresh }: { tenant: Tenant; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [limits, setLimits] = useState<EditLimitsState>({
    max_teachers: String(tenant.max_teachers),
    max_students_per_teacher: String(tenant.max_students_per_teacher),
    max_students_per_class: String(tenant.max_students_per_class),
    monthly_credit_pool: String(tenant.monthly_credit_pool),
    teacher_monthly_cap: String(tenant.teacher_monthly_cap),
  })
  const { toast } = useToast()
  const isSchool = tenant.tenant_type === 'SCHOOL'

  const saveMutation = useMutation({
    mutationFn: () => adminApi.updateTenantLimits(tenant.id, {
      max_teachers: parseInt(limits.max_teachers) || undefined,
      max_students_per_teacher: parseInt(limits.max_students_per_teacher) || undefined,
      max_students_per_class: parseInt(limits.max_students_per_class) || undefined,
      monthly_credit_pool: parseFloat(limits.monthly_credit_pool) || undefined,
      teacher_monthly_cap: parseFloat(limits.teacher_monthly_cap) || undefined,
    }),
    onSuccess: () => {
      toast({ title: 'Limiti aggiornati' })
      setEditing(false)
      onRefresh()
    },
    onError: () => toast({ title: 'Errore salvataggio', variant: 'destructive' }),
  })

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-3">
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: isSchool ? '#e85c8d18' : '#6366f118' }}>
          {isSchool
            ? <Building2 className="w-4 h-4 text-pink-500" />
            : <User className="w-4 h-4 text-indigo-500" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800 text-sm truncate">{tenant.name}</span>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${isSchool ? 'bg-pink-100 text-pink-600' : 'bg-indigo-100 text-indigo-600'}`}>
              {isSchool ? 'SCUOLA' : 'INDIVIDUALE'}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {isSchool && <LimitsBadge label="docenti" value={tenant.max_teachers} />}
            <LimitsBadge label="stud/classe" value={tenant.max_students_per_class} />
            <LimitsBadge label="stud/docente" value={tenant.max_students_per_teacher} />
            <LimitsBadge label={isSchool ? '€ pool/mese' : '€ studenti/mese'} value={`€${tenant.monthly_credit_pool}`} />
            {!isSchool && <LimitsBadge label="€ docente/mese" value={`€${tenant.teacher_monthly_cap}`} />}
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
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-700">Modifica limiti</span>
            {!editing
              ? <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-xs text-indigo-600 hover:underline"><Pencil className="w-3 h-3" /> Modifica</button>
              : <div className="flex gap-2">
                  <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
                    className="flex items-center gap-1 text-xs text-green-700 font-semibold hover:underline">
                    {saveMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Salva
                  </button>
                  <button onClick={() => setEditing(false)} className="flex items-center gap-1 text-xs text-slate-500 hover:underline">
                    <X className="w-3 h-3" /> Annulla
                  </button>
                </div>
            }
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {isSchool && (
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Max docenti</Label>
                {editing
                  ? <Input type="number" min={1} value={limits.max_teachers} onChange={e => setLimits(l => ({ ...l, max_teachers: e.target.value }))} className="h-8 text-sm" />
                  : <span className="text-sm font-semibold text-slate-800">{tenant.max_teachers}</span>}
              </div>
            )}
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Max stud/classe</Label>
              {editing
                ? <Input type="number" min={1} value={limits.max_students_per_class} onChange={e => setLimits(l => ({ ...l, max_students_per_class: e.target.value }))} className="h-8 text-sm" />
                : <span className="text-sm font-semibold text-slate-800">{tenant.max_students_per_class}</span>}
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">Max stud/docente</Label>
              {editing
                ? <Input type="number" min={1} value={limits.max_students_per_teacher} onChange={e => setLimits(l => ({ ...l, max_students_per_teacher: e.target.value }))} className="h-8 text-sm" />
                : <span className="text-sm font-semibold text-slate-800">{tenant.max_students_per_teacher}</span>}
            </div>
            <div>
              <Label className="text-xs text-slate-500 mb-1 block">{isSchool ? 'Pool crediti scuola €/mese' : 'Pool crediti studenti €/mese'}</Label>
              {editing
                ? <Input type="number" min={0} step={0.5} value={limits.monthly_credit_pool} onChange={e => setLimits(l => ({ ...l, monthly_credit_pool: e.target.value }))} className="h-8 text-sm" />
                : <span className="text-sm font-semibold text-slate-800">€{tenant.monthly_credit_pool}</span>}
            </div>
            {!isSchool && (
              <div>
                <Label className="text-xs text-slate-500 mb-1 block">Cap docente €/mese</Label>
                {editing
                  ? <Input type="number" min={0} step={0.5} value={limits.teacher_monthly_cap} onChange={e => setLimits(l => ({ ...l, teacher_monthly_cap: e.target.value }))} className="h-8 text-sm" />
                  : <span className="text-sm font-semibold text-slate-800">€{tenant.teacher_monthly_cap}</span>}
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
    max_teachers: '5', monthly_credit_pool: '10',
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
      monthly_credit_pool: parseFloat(form.monthly_credit_pool) || 10,
    }),
    onSuccess: () => {
      toast({ title: 'Scuola creata! Email di attivazione inviata all\'owner.' })
      setForm({ school_name: '', slug: '', owner_first_name: '', owner_last_name: '', owner_email: '', max_teachers: '5', monthly_credit_pool: '10' })
      onSuccess()
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Errore'
      toast({ title: msg, variant: 'destructive' })
    },
  })

  const autoSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
      <h3 className="text-sm font-bold text-slate-700 mb-4 flex items-center gap-2">
        <Building2 className="w-4 h-4 text-pink-500" /> Crea nuova scuola
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label className="text-xs text-slate-500 mb-1 block">Nome scuola *</Label>
          <Input value={form.school_name} onChange={e => {
            setForm(f => ({ ...f, school_name: e.target.value, slug: autoSlug(e.target.value) }))
          }} placeholder="IC Manzoni Milano" className="text-sm" />
        </div>
        <div>
          <Label className="text-xs text-slate-500 mb-1 block">Slug (URL) *</Label>
          <Input value={form.slug} onChange={e => setForm(f => ({ ...f, slug: e.target.value }))} placeholder="ic-manzoni-milano" className="text-sm" />
        </div>
        <div>
          <Label className="text-xs text-slate-500 mb-1 block">Nome owner *</Label>
          <Input value={form.owner_first_name} onChange={e => setForm(f => ({ ...f, owner_first_name: e.target.value }))} placeholder="Mario" className="text-sm" />
        </div>
        <div>
          <Label className="text-xs text-slate-500 mb-1 block">Cognome owner *</Label>
          <Input value={form.owner_last_name} onChange={e => setForm(f => ({ ...f, owner_last_name: e.target.value }))} placeholder="Rossi" className="text-sm" />
        </div>
        <div>
          <Label className="text-xs text-slate-500 mb-1 block">Email owner *</Label>
          <Input type="email" value={form.owner_email} onChange={e => setForm(f => ({ ...f, owner_email: e.target.value }))} placeholder="m.rossi@scuola.it" className="text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs text-slate-500 mb-1 block">Max docenti</Label>
            <Input type="number" min={1} value={form.max_teachers} onChange={e => setForm(f => ({ ...f, max_teachers: e.target.value }))} className="text-sm" />
          </div>
          <div>
            <Label className="text-xs text-slate-500 mb-1 block">Pool crediti €/mese</Label>
            <Input type="number" min={0} step={1} value={form.monthly_credit_pool} onChange={e => setForm(f => ({ ...f, monthly_credit_pool: e.target.value }))} className="text-sm" />
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !form.school_name || !form.owner_email}
          className="bg-pink-500 hover:bg-pink-600 text-white text-sm"
        >
          {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
          Crea scuola e invia invito
        </Button>
      </div>
    </div>
  )
}

export default function SchoolsPage() {
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
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center">
            <School className="w-5 h-5 text-pink-500" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Scuole & Licenze</h1>
            <p className="text-xs text-slate-500">
              {schools.length} scuole · {individuals.length} docenti individuali
            </p>
          </div>
        </div>
        <Button
          onClick={() => setShowCreate(s => !s)}
          className="bg-pink-500 hover:bg-pink-600 text-white text-sm gap-2"
        >
          <Plus className="w-4 h-4" />
          Nuova scuola
        </Button>
      </div>

      {showCreate && (
        <div className="mb-6">
          <CreateSchoolForm onSuccess={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['admin-tenants'] }) }} />
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5 p-1 bg-slate-100 rounded-xl w-fit">
        {(['all', 'SCHOOL', 'INDIVIDUAL'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all"
            style={filter === f ? { backgroundColor: '#e85c8d', color: 'white' } : { color: '#64748b' }}>
            {f === 'all' ? 'Tutti' : f === 'SCHOOL' ? '🏫 Scuole' : '👤 Individuali'}
          </button>
        ))}
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12 text-slate-400 text-sm">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Caricamento…
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-12 text-slate-400 text-sm">Nessun tenant trovato</div>
      )}

      {filtered.map(tenant => (
        <TenantRow
          key={tenant.id}
          tenant={tenant}
          onRefresh={() => qc.invalidateQueries({ queryKey: ['admin-tenants'] })}
        />
      ))}
    </div>
  )
}
