import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { creditsApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Check, History, Loader2, Pencil, Plus, Search, X } from '@/components/icons'
import { formatCreditAmount } from '@/lib/credits'
import { tl } from '@/i18n/tl'

type BudgetRow = {
  limit_id: string | null
  level: 'GLOBAL' | 'STUDENT_POOL' | 'TEACHER' | 'CLASS'
  tenant_id: string | null
  teacher_id: string | null
  class_id: string | null
  title: string
  subtitle: string
  teacher_name?: string | null
  school_name?: string | null
  cap_credits: number
  bonus_credits: number
  used_credits: number
  remaining_credits: number | null
  effective_cap_credits: number | null
  used_pct: number
  state: 'ok' | 'low' | 'exhausted' | 'unlimited'
  period_start?: string | null
  period_end: string | null
  /** Solo righe docente: il pool dei suoi studenti (null nei tenant scuola, dove vale il pool d'istituto). */
  student_pool?: BudgetRow | null
}

type Overview = {
  schools: BudgetRow[]
  student_pools: BudgetRow[]
  teachers: BudgetRow[]
  classes: BudgetRow[]
  counts: { exhausted: number; low: number }
}

type AlertItem = {
  id: string
  severity: 'LOW' | 'EXHAUSTED'
  message: string
  limit_id: string
  level: BudgetRow['level']
  tenant_id: string | null
  teacher_id: string | null
  class_id: string | null
  scope_title: string
  scope_subtitle: string
  cap_credits: number
  used_credits: number
  created_at: string
}

type RequestItem = {
  id: string
  status: 'pending' | 'approved' | 'rejected'
  requester_name: string
  requester_email: string
  credits: number
  reason: string | null
  limit_id: string | null
  level: BudgetRow['level']
  scope_title: string
  scope_subtitle: string
  remaining_credits: number | null
  created_at: string
  reviewed_at: string | null
  admin_notes: string | null
}

type TabKey = 'schools' | 'student_pools' | 'teachers' | 'classes'

const TABS: Array<{ key: TabKey; label: string; hint: string }> = [
  { key: 'schools', label: tl("Istituti"), hint: tl("Pool mensile condiviso della scuola") },
  { key: 'student_pools', label: tl("Pool studenti"), hint: tl("Pool degli studenti per docenti individuali") },
  { key: 'teachers', label: tl("Docenti"), hint: tl("Cap mensile personale di ogni docente") },
  { key: 'classes', label: tl("Classi"), hint: tl("Budget massimo mensile di una singola classe") },
]

const BUNDLE_PRESETS = [100, 500, 1000, 5000]

const STATE_STYLE: Record<BudgetRow['state'], { label: string; chip: string; bar: string }> = {
  ok: { label: 'Ok', chip: 'bg-emerald-50 text-emerald-700', bar: 'bg-emerald-500' },
  low: { label: tl("In esaurimento"), chip: 'bg-amber-50 text-amber-700', bar: 'bg-amber-500' },
  exhausted: { label: tl("Esauriti"), chip: 'bg-red-50 text-red-700', bar: 'bg-red-500' },
  unlimited: { label: tl("Nessun limite"), chip: 'bg-slate-100 text-slate-500', bar: 'bg-slate-300' },
}

function targetOf(row: BudgetRow) {
  return {
    limit_id: row.limit_id,
    level: row.level,
    tenant_id: row.tenant_id,
    teacher_id: row.teacher_id,
    class_id: row.class_id,
  }
}

function errorText(error: any, fallback: string) {
  const detail = error?.response?.data?.detail
  return typeof detail === 'string' ? detail : fallback
}

export default function CreditsHubPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [tab, setTab] = useState<TabKey>('schools')
  const [search, setSearch] = useState('')
  const [onlyCritical, setOnlyCritical] = useState(false)
  const [bundleTarget, setBundleTarget] = useState<{ row: BudgetRow; requestId?: string } | null>(null)
  const [resetTarget, setResetTarget] = useState<BudgetRow | null>(null)

  const { data: overview, isLoading } = useQuery<Overview>({
    queryKey: ['admin-credits-overview'],
    queryFn: async () => (await creditsApi.adminOverview()).data,
    refetchInterval: 30000,
  })
  const { data: alerts = [] } = useQuery<AlertItem[]>({
    queryKey: ['admin-credits-alerts'],
    queryFn: async () => (await creditsApi.adminAlerts()).data,
    refetchInterval: 30000,
  })
  const { data: requests = [] } = useQuery<RequestItem[]>({
    queryKey: ['admin-credits-requests'],
    queryFn: async () => (await creditsApi.getRequests()).data,
    refetchInterval: 30000,
  })

  const refreshAll = () => {
    for (const key of ['admin-credits-overview', 'admin-credits-alerts', 'admin-credits-requests', 'admin-credits-badge']) {
      queryClient.invalidateQueries({ queryKey: [key] })
    }
  }

  const setCapMutation = useMutation({
    mutationFn: async ({ row, cap }: { row: BudgetRow; cap: number }) =>
      (await creditsApi.adminSetLimit({ ...targetOf(row), cap_credits: cap })).data,
    onSuccess: () => {
      toast({ title: tl("Cap aggiornato"), description: tl("Il nuovo budget è già attivo.") })
      refreshAll()
    },
    onError: (e: any) => toast({ title: tl("Errore"), description: errorText(e, tl("Impossibile salvare il cap")), variant: 'destructive' }),
  })

  const bundleMutation = useMutation({
    mutationFn: async ({ row, credits, note }: { row: BudgetRow; credits: number; note?: string }) =>
      (await creditsApi.adminForceBundle({ ...targetOf(row), credits, note })).data,
    onSuccess: (_d, vars) => {
      toast({ title: tl("Bundle accreditato"), description: tl("+{0} crediti disponibili da subito.", formatCreditAmount(vars.credits)) })
      setBundleTarget(null)
      refreshAll()
    },
    onError: (e: any) => toast({ title: tl("Errore"), description: errorText(e, tl("Impossibile accreditare il bundle")), variant: 'destructive' }),
  })

  const resetMutation = useMutation({
    mutationFn: async ({ row, cap, clearBonus }: { row: BudgetRow; cap?: number; clearBonus: boolean }) =>
      (await creditsApi.adminResetLimit({ ...targetOf(row), cap_credits: cap ?? null, clear_bonus: clearBonus })).data,
    onSuccess: () => {
      toast({ title: tl("Ciclo ripartito da oggi"), description: tl("Consumi azzerati: gli studenti vedono subito i nuovi crediti.") })
      setResetTarget(null)
      refreshAll()
    },
    onError: (e: any) => toast({ title: tl("Errore"), description: errorText(e, tl("Impossibile resettare il limite")), variant: 'destructive' }),
  })

  const reviewMutation = useMutation({
    mutationFn: async ({ id, status, credits }: { id: string; status: 'approved' | 'rejected'; credits?: number }) =>
      (await creditsApi.reviewRequest(id, status, undefined, credits)).data,
    onSuccess: (_d, vars) => {
      toast({ title: vars.status === 'approved' ? tl("Richiesta approvata") : tl("Richiesta rifiutata") })
      refreshAll()
    },
    onError: (e: any) => toast({ title: tl("Errore"), description: errorText(e, tl("Operazione non riuscita")), variant: 'destructive' }),
  })

  const pending = requests.filter((r) => r.status === 'pending')
  const resolvedRequests = requests.filter((r) => r.status !== 'pending').slice(0, 8)

  const rows = useMemo(() => {
    const source = overview?.[tab] ?? []
    const needle = search.trim().toLowerCase()
    return source
      .filter((row) => !onlyCritical || row.state === 'low' || row.state === 'exhausted')
      .filter((row) => {
        if (!needle) return true
        return [row.title, row.subtitle, row.teacher_name, row.school_name]
          .filter(Boolean)
          .some((v) => String(v).toLowerCase().includes(needle))
      })
      .sort((a, b) => {
        const rank = { exhausted: 0, low: 1, ok: 2, unlimited: 3 } as const
        return rank[a.state] - rank[b.state] || a.title.localeCompare(b.title, 'it')
      })
  }, [overview, tab, search, onlyCritical])

  const rowForAlert = (alert: AlertItem): BudgetRow => ({
    limit_id: alert.limit_id,
    level: alert.level,
    tenant_id: alert.tenant_id,
    teacher_id: alert.teacher_id,
    class_id: alert.class_id,
    title: alert.scope_title,
    subtitle: alert.scope_subtitle,
    cap_credits: alert.cap_credits,
    bonus_credits: 0,
    used_credits: alert.used_credits,
    remaining_credits: Math.max(alert.cap_credits - alert.used_credits, 0),
    effective_cap_credits: alert.cap_credits,
    used_pct: 0,
    state: alert.severity === 'EXHAUSTED' ? 'exhausted' : 'low',
    period_end: null,
  })

  const budgetRowProps = (row: BudgetRow) => ({
    row,
    saving: setCapMutation.isPending,
    onSaveCap: (cap: number) => setCapMutation.mutate({ row, cap }),
    onBundle: () => setBundleTarget({ row }),
    onReset: () => setResetTarget(row),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-slate-900">{tl("Crediti")}</h1>
        <p className="text-sm text-slate-500">
          {tl("Budget mensili in crediti per istituti, docenti e classi. Le modifiche sono immediate e visibili subito nel pool della piattaforma.")}
        </p>
      </div>

      {/* Alert in corso */}
      {alerts.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <h2 className="text-sm font-bold text-amber-900">
              {tl("Crediti in esaurimento (")}{alerts.length})
            </h2>
          </div>
          <div className="divide-y divide-amber-100 rounded-xl bg-white">
            {alerts.map((alert) => (
              <div key={alert.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                  alert.severity === 'EXHAUSTED' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                }`}>
                  {alert.severity === 'EXHAUSTED' ? tl("Esauriti") : tl("In esaurimento")}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{alert.scope_title}</p>
                  <p className="truncate text-xs text-slate-500">
                    {alert.scope_subtitle ? `${alert.scope_subtitle} · ` : ''}
                    {formatCreditAmount(alert.used_credits)} / {formatCreditAmount(alert.cap_credits)} {tl("crediti usati")}
                  </p>
                </div>
                <Button size="sm" onClick={() => setBundleTarget({ row: rowForAlert(alert) })}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> {tl("Forza bundle")}
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Richieste in attesa */}
      {pending.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-bold text-slate-900">{tl("Richieste di crediti da autorizzare (")}{pending.length})</h2>
          <div className="divide-y divide-slate-100">
            {pending.map((req) => (
              <RequestRow
                key={req.id}
                req={req}
                busy={reviewMutation.isPending}
                onApprove={(credits) => reviewMutation.mutate({ id: req.id, status: 'approved', credits })}
                onReject={() => reviewMutation.mutate({ id: req.id, status: 'rejected' })}
              />
            ))}
          </div>
        </section>
      )}

      {/* Budget */}
      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => {
              const count = overview?.[t.key]?.length ?? 0
              return (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  title={t.hint}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
                    tab === t.key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  {t.label} <span className="ml-1 text-xs opacity-60">{count}</span>
                </button>
              )
            })}
          </div>
          <div className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={onlyCritical} onChange={(e) => setOnlyCritical(e.target.checked)} />
              {tl("Solo critici")}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={tl("Cerca…")}
                className="h-8 w-52 pl-7 text-sm"
              />
            </div>
          </div>
        </div>

        <p className="px-4 pt-3 text-xs text-slate-500">{TABS.find((t) => t.key === tab)?.hint}{tl(". Cap 0 = nessun limite.")}</p>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-2">{tl("Ambito")}</th>
                <th className="px-3 py-2 w-56">{tl("Utilizzo")}</th>
                <th className="px-3 py-2 text-right">{tl("Cap mensile")}</th>
                <th className="px-3 py-2 text-right">Bundle</th>
                <th className="px-3 py-2 text-right">{tl("Residui")}</th>
                <th className="px-3 py-2">{tl("Rinnovo")}</th>
                <th className="px-3 py-2">{tl("Stato")}</th>
                <th className="px-4 py-2 text-right">{tl("Azioni")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">{tl("Caricamento…")}</td></tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">{tl("Nessun elemento.")}</td></tr>
              )}
              {rows.map((row) => {
                const key = `${row.level}-${row.limit_id ?? row.class_id ?? row.teacher_id ?? row.tenant_id}`
                return (
                  <Fragment key={key}>
                    <BudgetTableRow {...budgetRowProps(row)} />
                    {tab === 'teachers' && row.student_pool && (
                      <BudgetTableRow {...budgetRowProps(row.student_pool)} nested />
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {resolvedRequests.length > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-bold text-slate-900">{tl("Ultime richieste gestite")}</h2>
          <ul className="divide-y divide-slate-100 text-sm">
            {resolvedRequests.map((req) => (
              <li key={req.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                  req.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                }`}>{req.status === 'approved' ? tl("Approvata") : tl("Rifiutata")}</span>
                <span className="font-semibold text-slate-800">{req.requester_name}</span>
                <span className="text-slate-500">· {req.scope_title} · {formatCreditAmount(req.credits)} {tl("crediti")}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {resetTarget && (
        <ResetDialog
          row={resetTarget}
          busy={resetMutation.isPending}
          onClose={() => setResetTarget(null)}
          onConfirm={(cap, clearBonus) => resetMutation.mutate({ row: resetTarget, cap, clearBonus })}
        />
      )}

      {bundleTarget && (
        <BundleDialog
          row={bundleTarget.row}
          busy={bundleMutation.isPending}
          onClose={() => setBundleTarget(null)}
          onConfirm={(credits, note) => bundleMutation.mutate({ row: bundleTarget.row, credits, note })}
        />
      )}
    </div>
  )
}

const formatShortDate = (value?: string | null) =>
  value ? new Date(value).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : '—'

function BudgetTableRow({
  row, saving, onSaveCap, onBundle, onReset, nested = false,
}: {
  row: BudgetRow
  saving: boolean
  onSaveCap: (cap: number) => void
  onBundle: () => void
  onReset: () => void
  /** Riga figlia (pool studenti sotto il suo docente). */
  nested?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const style = STATE_STYLE[row.state]
  const pct = Math.min(Math.max(row.used_pct, 0), 100)
  const canBundle = row.cap_credits > 0

  const commit = () => {
    const value = Number(draft.replace(',', '.'))
    if (!Number.isFinite(value) || value < 0) return
    onSaveCap(value)
    setEditing(false)
  }

  return (
    <tr className={nested ? 'bg-slate-50/60 hover:bg-slate-100/60' : 'hover:bg-slate-50/70'}>
      <td className={`py-2.5 ${nested ? 'pl-10 pr-4' : 'px-4'}`}>
        {nested ? (
          <>
            <p className="font-semibold text-slate-700">↳ {tl("Pool studenti")}</p>
            <p className="truncate text-xs text-slate-500">{tl("Crediti condivisi dagli studenti di questo docente")}</p>
          </>
        ) : (
          <>
            <p className="font-semibold text-slate-900">{row.title}</p>
            <p className="truncate text-xs text-slate-500">
              {[row.subtitle, row.school_name && row.school_name !== row.subtitle ? row.school_name : null].filter(Boolean).join(' · ')}
            </p>
          </>
        )}
      </td>
      <td className="px-3 py-2.5">
        {row.state === 'unlimited' ? (
          <span className="text-xs text-slate-400">{formatCreditAmount(row.used_credits)} usati</span>
        ) : (
          <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div className={`h-full ${style.bar}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-1 text-[11px] tabular-nums text-slate-500">
              {formatCreditAmount(row.used_credits)} / {formatCreditAmount(row.effective_cap_credits)}
            </p>
          </div>
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums">
        {editing ? (
          <span className="inline-flex items-center gap-1">
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
              }}
              inputMode="decimal"
              className="h-7 w-24 text-right text-sm"
            />
            <button onClick={commit} disabled={saving} className="text-emerald-600" title={tl("Salva")}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </button>
            <button onClick={() => setEditing(false)} className="text-slate-400" title={tl("Annulla")}><X className="h-4 w-4" /></button>
          </span>
        ) : (
          <button
            onClick={() => { setDraft(String(row.cap_credits)); setEditing(true) }}
            className="group inline-flex items-center gap-1.5 font-semibold text-slate-800"
            title={tl("Modifica cap mensile")}
          >
            {row.cap_credits > 0 ? formatCreditAmount(row.cap_credits) : '∞'}
            <Pencil className="h-3 w-3 text-slate-300 group-hover:text-slate-600" />
          </button>
        )}
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-600">
        {row.bonus_credits > 0 ? `+${formatCreditAmount(row.bonus_credits)}` : '—'}
      </td>
      <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
        {row.remaining_credits === null ? '∞' : formatCreditAmount(row.remaining_credits)}
      </td>
      <td className="px-3 py-2.5 text-xs text-slate-500" title={row.period_start ? tl("Ciclo iniziato il {0}", formatShortDate(row.period_start)) : undefined}>
        {row.cap_credits > 0 ? formatShortDate(row.period_end) : '—'}
      </td>
      <td className="px-3 py-2.5">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${style.chip}`}>{style.label}</span>
      </td>
      <td className="whitespace-nowrap px-4 py-2.5 text-right">
        <Button
          size="sm"
          variant="outline"
          className="mr-1.5"
          onClick={onReset}
          title={tl("Azzera i consumi e riparti da oggi")}
        >
          <History className="mr-1 h-3.5 w-3.5" /> Reset
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!canBundle}
          onClick={onBundle}
          title={canBundle ? tl("Aggiungi un bundle di crediti, subito") : tl("Imposta prima un cap mensile")}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Bundle
        </Button>
      </td>
    </tr>
  )
}

function RequestRow({
  req, busy, onApprove, onReject,
}: {
  req: RequestItem
  busy: boolean
  onApprove: (credits: number) => void
  onReject: () => void
}) {
  const [credits, setCredits] = useState(String(req.credits))
  const parsed = Number(credits.replace(',', '.'))
  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-900">
          {req.requester_name} <span className="font-normal text-slate-500">· {req.scope_title}</span>
        </p>
        <p className="truncate text-xs text-slate-500">
          {req.scope_subtitle ? `${req.scope_subtitle} · ` : ''}
          {req.remaining_credits !== null ? tl("{0} crediti residui · ", formatCreditAmount(req.remaining_credits)) : ''}
          {req.reason || tl("Nessuna motivazione")}
        </p>
      </div>
      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        {tl("Crediti")}
        <Input
          value={credits}
          onChange={(e) => setCredits(e.target.value)}
          inputMode="decimal"
          className="h-8 w-24 text-right text-sm"
        />
      </label>
      <Button size="sm" disabled={busy || !(parsed > 0)} onClick={() => onApprove(parsed)}>
        <Check className="mr-1 h-3.5 w-3.5" /> {tl("Autorizza")}
      </Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={onReject}>{tl("Rifiuta")}</Button>
    </div>
  )
}

function BundleDialog({
  row, busy, onClose, onConfirm,
}: {
  row: BudgetRow
  busy: boolean
  onClose: () => void
  onConfirm: (credits: number, note?: string) => void
}) {
  const [credits, setCredits] = useState('500')
  const [note, setNote] = useState('')
  const parsed = Number(credits.replace(',', '.'))
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-slate-100 bg-white p-5 shadow-2xl">
        <h2 className="text-base font-bold text-slate-900">{tl("Forza un bundle di crediti")}</h2>
        <p className="mt-1 text-sm text-slate-500">
          {row.title}{row.subtitle ? ` · ${row.subtitle}` : ''}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {tl("Valido subito, anche a metà mese. I crediti del bundle non scadono al reset mensile: si usano dopo il cap ordinario.")}
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {BUNDLE_PRESETS.map((preset) => (
            <button
              key={preset}
              onClick={() => setCredits(String(preset))}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                Number(credits) === preset ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              +{formatCreditAmount(preset)}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3">
          <label className="text-xs font-medium text-slate-600">
            {tl("Crediti da aggiungere")}
            <Input value={credits} onChange={(e) => setCredits(e.target.value)} inputMode="decimal" className="mt-1 h-9" />
          </label>
          <label className="text-xs font-medium text-slate-600">
            {tl("Nota (opzionale)")}
            <Input value={note} onChange={(e) => setNote(e.target.value)} className="mt-1 h-9" placeholder={tl("es. Bundle acquistato — ordine #…")} />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>{tl("Annulla")}</Button>
          <Button disabled={busy || !(parsed > 0)} onClick={() => onConfirm(parsed, note.trim() || undefined)}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {tl("Accredita")} {parsed > 0 ? formatCreditAmount(parsed) : ''} {tl("crediti")}
          </Button>
        </div>
      </div>
    </div>
  )
}

function ResetDialog({
  row, busy, onClose, onConfirm,
}: {
  row: BudgetRow
  busy: boolean
  onClose: () => void
  onConfirm: (cap: number | undefined, clearBonus: boolean) => void
}) {
  const [cap, setCap] = useState(String(row.cap_credits))
  const [clearBonus, setClearBonus] = useState(false)
  const parsed = Number(cap.replace(',', '.'))
  const validCap = Number.isFinite(parsed) && parsed >= 0
  const capChanged = validCap && parsed !== row.cap_credits
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-slate-100 bg-white p-5 shadow-2xl">
        <h2 className="text-base font-bold text-slate-900">{tl("Reset e nuovo ciclo")}</h2>
        <p className="mt-1 text-sm text-slate-500">{row.title}{row.subtitle ? ` · ${row.subtitle}` : ''}</p>
        <p className="mt-2 text-xs text-slate-500">
          {tl("I consumi di questo ciclo ({0} crediti) tornano a zero e il ciclo mensile riparte da oggi: i crediti verranno riaccreditati ogni mese nello stesso giorno.", formatCreditAmount(row.used_credits))}
        </p>
        <div className="mt-4 grid gap-3">
          <label className="text-xs font-medium text-slate-600">
            {tl("Crediti mensili (cap)")}
            <Input value={cap} onChange={(e) => setCap(e.target.value)} inputMode="decimal" className="mt-1 h-9" />
            <span className="mt-1 block text-[11px] font-normal text-slate-400">{tl("Modificalo per cambiare l'importo riaccreditato ogni mese. 0 = nessun limite.")}</span>
          </label>
          {row.bonus_credits > 0 && (
            <label className="flex items-center gap-2 text-xs text-slate-600">
              <input type="checkbox" checked={clearBonus} onChange={(e) => setClearBonus(e.target.checked)} />
              {tl("Azzera anche i bundle residui (+{0})", formatCreditAmount(row.bonus_credits))}
            </label>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>{tl("Annulla")}</Button>
          <Button disabled={busy || !validCap} onClick={() => onConfirm(capChanged ? parsed : undefined, clearBonus)}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            {tl("Resetta da oggi")}
          </Button>
        </div>
      </div>
    </div>
  )
}
