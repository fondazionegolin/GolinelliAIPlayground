import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Building2, CheckCircle2, Copy, Link2, Loader2, Mail, RefreshCw, Search, Send, ShieldCheck, X,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { schoolOnboardingAdminApi, type RegistrySchool, type SchoolInvite } from '@/lib/api'
import { EmailDelivery, Pill, STAGES, fmtDate } from './SchoolMonitor'
import { tl } from '@/i18n/tl'

/** Total documents the principal accepts (3 base + the deployer agreement). */
const DOCUMENTS = 4

function errorDetail(err: unknown, fallback: string) {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback
}

/** Ricerca nel registro MIM con selezione di una scuola (usata per invito e collegamento tenant). */
export function RegistrySearch({ onPick, placeholder }: { onPick: (s: RegistrySchool) => void; placeholder?: string }) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(id)
  }, [q])
  const { data, isFetching } = useQuery({
    queryKey: ['admin-registry-search', debounced],
    queryFn: async () => (await schoolOnboardingAdminApi.searchRegistry(debounced)).data,
    enabled: debounced.length >= 2,
  })
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} className="pl-9 text-sm"
          placeholder={placeholder || tl("Cerca per nome, comune o codice meccanografico…")} />
        {isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
      </div>
      {debounced.length >= 2 && !isFetching && data?.length === 0 && (
        <p className="text-xs text-slate-500">{tl("Nessun risultato nel registro MIM.")}</p>
      )}
      <ul className="max-h-64 space-y-1 overflow-y-auto">
        {(data ?? []).map((s) => (
          <li key={s.code}>
            <button type="button" onClick={() => onPick(s)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left hover:border-slate-400">
              <span className="block text-sm font-semibold text-slate-800">{s.name}</span>
              <span className="block text-xs text-slate-500">
                <span className="font-mono">{s.code}</span> · {[s.comune, s.province].filter(Boolean).join(', ')} ·{' '}
                {s.kind === 'STATALE' ? 'statale' : 'paritaria'}
                {s.tenant && <span className="ml-1 font-semibold text-amber-600">{tl("· già presente:")} {s.tenant.tenant_name}</span>}
              </span>
              {s.plessi.length > 1 && (
                <span className="mt-0.5 block truncate text-[11px] text-slate-400">{s.plessi.slice(0, 3).join(' · ')}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

type Source = 'registry' | 'manual'
const EMPTY = { email: '', first_name: '', last_name: '', custom_message: '', label: '', organization_name: '', organization_comune: '', organization_province: '' }

function InviteForm({ onDone }: { onDone: () => void }) {
  const { toast } = useToast()
  const [mode, setMode] = useState<'EMAIL' | 'SINGLE_USE_LINK'>('EMAIL')
  const [source, setSource] = useState<Source>('registry')
  const [school, setSchool] = useState<RegistrySchool | null>(null)
  const [form, setForm] = useState(EMPTY)
  const [created, setCreated] = useState<SchoolInvite | null>(null)
  const set = (key: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [key]: e.target.value }))

  const create = useMutation({
    mutationFn: async () => (await schoolOnboardingAdminApi.createInvite({
      mode,
      mechanographic_code: source === 'registry' ? school?.code : undefined,
      email: mode === 'EMAIL' ? form.email.trim() : undefined,
      first_name: form.first_name.trim() || undefined,
      last_name: form.last_name.trim() || undefined,
      custom_message: form.custom_message.trim() || undefined,
      label: form.label.trim() || undefined,
      send_email: mode === 'EMAIL',
      ...(source === 'manual' ? {
        organization_name: form.organization_name.trim(),
        organization_comune: form.organization_comune.trim() || undefined,
        organization_province: form.organization_province.trim() || undefined,
      } : {}),
    })).data,
    onSuccess: (inv) => {
      setCreated(inv)
      onDone()
      if (inv.mode === 'EMAIL') {
        toast({
          title: inv.email_sent ? tl("Invito inviato") : tl("Invito creato, e-mail NON inviata"),
          description: inv.email_sent ? inv.email ?? undefined : inv.email_error || tl("Copia il link e invialo tu."),
          variant: inv.email_sent ? undefined : 'destructive',
        })
      }
    },
    onError: (e) => toast({ title: errorDetail(e, tl("Creazione invito non riuscita")), variant: 'destructive' }),
  })

  const copy = (link: string | null) => {
    if (!link) return
    navigator.clipboard.writeText(link).then(() => toast({ title: tl("Link copiato") }))
  }
  const emailOk = mode === 'SINGLE_USE_LINK' || /\S+@\S+\.\S+/.test(form.email)
  const schoolOk = source === 'registry' ? (mode === 'SINGLE_USE_LINK' || !!school) : form.organization_name.trim().length >= 2
  const reset = () => { setCreated(null); setSchool(null); setForm(EMPTY) }

  if (created) {
    return (
      <div className="space-y-3">
        <div className={`flex items-start gap-2 rounded-lg p-3 text-sm ${created.mode === 'EMAIL' && !created.email_sent ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>
          {created.mode === 'EMAIL' && !created.email_sent ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          <span>
            {created.mode === 'EMAIL' ? tl("Invito per {0}", created.email) : tl("Link monouso creato")}
            {created.tenant_name ? ` · ${created.tenant_name}` : ''}{tl(". Scade il")} {fmtDate(created.expires_at, false)}.
            {created.mode === 'EMAIL' && !created.email_sent && <span className="mt-1 block text-xs">{created.email_error || tl("E-mail non inviata.")} {tl("Copia il link qui sotto e invialo manualmente.")}</span>}
          </span>
        </div>
        {created.link && (
          <div className="flex gap-2">
            <Input readOnly value={created.link} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button tone="neutral" surface="outline" onClick={() => copy(created.link)}><Copy className="mr-1.5 h-4 w-4" />{tl("Copia")}</Button>
          </div>
        )}
        <Button tone="neutral" surface="ghost" onClick={reset}>{tl("Nuovo invito")}</Button>
      </div>
    )
  }

  const toggle = <T extends string>(value: T, current: T, onPick: (v: T) => void, label: string, Icon?: typeof Mail) =>
    <button key={value} type="button" onClick={() => onPick(value)}
      className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${current === value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
      {Icon && <Icon className="h-3.5 w-3.5" />}{label}
    </button>

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3">
        <div className="flex w-fit gap-1 rounded-lg bg-slate-100 p-1">
          {toggle('EMAIL', mode, setMode, tl("Invio per e-mail"), Mail)}
          {toggle('SINGLE_USE_LINK', mode, setMode, tl("Link monouso"), Link2)}
        </div>
        <div className="flex w-fit gap-1 rounded-lg bg-slate-100 p-1">
          {toggle<Source>('registry', source, setSource, tl("Dal registro MIM"), Building2)}
          {toggle<Source>('manual', source, setSource, tl("Fuori registro (a mano)"))}
        </div>
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        {mode === 'EMAIL'
          ? tl("Il referente riceve una e-mail con il link personale: vale per un solo istituto e un solo accesso. Vedrai qui se l’e-mail è partita, se è stata letta e a che punto è l’accettazione.")
          : tl("Genera un link utilizzabile una sola volta, da inviare tu (es. dalla segreteria). Se non fissi l’istituto, chi apre il link lo sceglie dal registro o lo scrive a mano.")}
        {source === 'manual' && tl(" Fuori registro: scuole estere, enti di formazione, organizzazioni non presenti nell’anagrafe MIM.")}
      </p>

      {source === 'registry' ? (
        <div>
          <Label className="mb-1.5 block text-xs text-slate-500">{tl("Istituto dal registro MIM")} {mode === 'EMAIL' ? '*' : '(facoltativo)'}</Label>
          {school ? (
            <div className="flex items-start justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <div className="min-w-0 text-sm">
                <p className="flex items-center gap-1.5 font-semibold text-slate-900"><CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />{school.name}</p>
                <p className="text-xs text-slate-600"><span className="font-mono">{school.code}</span> · {[school.address, school.comune, school.province].filter(Boolean).join(', ')}</p>
                {school.email && <p className="text-xs text-slate-500">{tl("E-mail istituzionale:")} {school.email}</p>}
              </div>
              <button type="button" aria-label={tl("Togli istituto")} onClick={() => setSchool(null)} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <RegistrySearch onPick={(s) => {
              setSchool(s)
              if (!form.email && s.email && mode === 'EMAIL') setForm((f) => ({ ...f, email: s.email!.toLowerCase() }))
            }} />
          )}
          <p className="mt-1.5 text-xs text-slate-500">{tl("Non lo trovi?")} <button type="button" className="font-semibold text-indigo-700 hover:underline" onClick={() => setSource('manual')}>{tl("Inseriscilo a mano")}</button>.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <div><Label className="mb-1.5 block text-xs text-slate-500">{tl("Nome dell’istituto o dell’organizzazione *")}</Label>
            <Input value={form.organization_name} onChange={set('organization_name')} placeholder={tl("es. Liceo Europeo di Lugano")} className="text-sm" /></div>
          <div><Label className="mb-1.5 block text-xs text-slate-500">{tl("Comune / città")}</Label>
            <Input value={form.organization_comune} onChange={set('organization_comune')} className="text-sm" /></div>
          <div><Label className="mb-1.5 block text-xs text-slate-500">{tl("Provincia / paese")}</Label>
            <Input value={form.organization_province} onChange={set('organization_province')} className="text-sm" /></div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {mode === 'EMAIL' && (
          <div className="sm:col-span-2">
            <Label className="mb-1.5 block text-xs text-slate-500">{tl("E-mail del dirigente / referente *")}</Label>
            <Input type="email" value={form.email} onChange={set('email')} className="text-sm" />
          </div>
        )}
        <div><Label className="mb-1.5 block text-xs text-slate-500">{tl("Nome del referente")}</Label><Input value={form.first_name} onChange={set('first_name')} className="text-sm" /></div>
        <div><Label className="mb-1.5 block text-xs text-slate-500">{tl("Cognome del referente")}</Label><Input value={form.last_name} onChange={set('last_name')} className="text-sm" /></div>
        <div className="sm:col-span-2"><Label className="mb-1.5 block text-xs text-slate-500">{tl("Messaggio nell’invito")}</Label><Input value={form.custom_message} onChange={set('custom_message')} className="text-sm" /></div>
        <div className="sm:col-span-2"><Label className="mb-1.5 block text-xs text-slate-500">{tl("Etichetta interna")}</Label>
          <Input value={form.label} onChange={set('label')} placeholder={tl("es. richiesta dalla segreteria, bando 2026")} className="text-sm" /></div>
      </div>

      <div className="flex justify-end">
        <Button tone="accent" surface="solid" onClick={() => create.mutate()} disabled={!emailOk || !schoolOk || create.isPending}>
          {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          {mode === 'EMAIL' ? tl("Crea e invia invito") : tl("Genera link monouso")}
        </Button>
      </div>
    </div>
  )
}

/** Whether the platform can send e-mail at all: checked by logging in to the SMTP server, nothing is sent. */
export function EmailHealthBanner() {
  const qc = useQueryClient()
  const { data, isFetching } = useQuery({
    queryKey: ['admin-email-health'],
    queryFn: async () => (await schoolOnboardingAdminApi.emailHealth()).data,
    staleTime: 60_000,
  })
  const recheck = async () => qc.setQueryData(['admin-email-health'], (await schoolOnboardingAdminApi.emailHealth(true)).data)
  if (!data) return null
  return (
    <div className={`flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 text-sm ${data.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-900'}`}>
      {data.ok ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{data.ok ? tl("Invio e-mail operativo") : tl("Le e-mail non partono")}</p>
        <p className="text-xs opacity-90">{data.ok ? tl("Mittente {0} via {1} · verificato {2}", data.sender, data.host, fmtDate(data.checked_at)) : data.error}</p>
        {!data.ok && <p className="mt-1 text-xs opacity-90">{tl("Finché non è risolto gli inviti restano validi: copia il link dalla tabella e invialo tu.")}</p>}
      </div>
      <Button tone="neutral" surface="outline" density="compact" onClick={() => void recheck()} disabled={isFetching}>
        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} />{tl("Verifica")}
      </Button>
    </div>
  )
}

type InviteFilter = 'open' | 'all' | 'problems'

export function SchoolInviteManager() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<InviteFilter>('open')

  const { data: invites = [], isLoading } = useQuery({
    queryKey: ['admin-school-invites'],
    queryFn: async () => (await schoolOnboardingAdminApi.listInvites()).data,
    refetchInterval: 60_000,
  })
  const { data: registry } = useQuery({
    queryKey: ['admin-school-registry-status'],
    queryFn: async () => (await schoolOnboardingAdminApi.registryStatus()).data,
  })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-school-invites'] })
    qc.invalidateQueries({ queryKey: ['admin-school-overview'] })
    qc.invalidateQueries({ queryKey: ['admin-tenants'] })
  }

  const revoke = useMutation({
    mutationFn: (id: string) => schoolOnboardingAdminApi.revokeInvite(id),
    onSuccess: () => { toast({ title: tl("Invito revocato") }); refresh() },
    onError: (e) => toast({ title: errorDetail(e, tl("Errore")), variant: 'destructive' }),
  })
  const resend = useMutation({
    mutationFn: async (id: string) => (await schoolOnboardingAdminApi.resendInvite(id)).data,
    onSuccess: (r) => {
      toast({ title: r.email_sent ? tl("E-mail reinviata") : tl("E-mail non inviata"), description: r.email_sent ? undefined : r.email_error ?? undefined,
        variant: r.email_sent ? undefined : 'destructive' })
      refresh()
    },
    onError: (e) => toast({ title: errorDetail(e, tl("Errore")), variant: 'destructive' }),
  })
  const sync = useMutation({
    mutationFn: async () => (await schoolOnboardingAdminApi.syncRegistry()).data,
    onSuccess: (r: { total: number }) => {
      toast({ title: tl("Registro aggiornato"), description: `${r.total.toLocaleString('it-IT')} istituti` })
      qc.invalidateQueries({ queryKey: ['admin-school-registry-status'] })
    },
    onError: (e) => toast({ title: errorDetail(e, tl("Sincronizzazione non riuscita")), variant: 'destructive' }),
  })

  const pending = invites.filter((i) => i.status === 'PENDING')
  const shown = invites.filter(i => filter === 'all' ? true : filter === 'open' ? i.status === 'PENDING'
    : i.stage === 'EMAIL_FAILED' || i.stage === 'EXPIRED')

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Building2 className="h-4 w-4 text-pink-500" /> {tl("Inviti istituti")}
            {pending.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">{pending.length} {tl("in attesa")}</span>}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {tl("Registro MIM:")} {registry ? <>{registry.total.toLocaleString('it-IT')} istituti{registry.school_year ? ` · a.s. ${registry.school_year.slice(0, 4)}/${registry.school_year.slice(4)}` : ''}</> : '…'}
            {registry?.total === 0 && <span className="ml-1 font-semibold text-red-600">{"vuoto: sincronizza"}</span>}
            <button type="button" className="ml-2 font-semibold text-indigo-600 hover:underline disabled:opacity-50" disabled={sync.isPending} onClick={() => sync.mutate()}>
              {sync.isPending ? tl("Aggiornamento…") : tl("Aggiorna dal MIM")}
            </button>
          </p>
        </div>
        <Button tone={open ? 'neutral' : 'accent'} surface={open ? 'outline' : 'solid'} onClick={() => setOpen((v) => !v)}>
          {open ? tl("Chiudi") : tl("Invita un istituto")}
        </Button>
      </div>

      {open && <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><InviteForm onDone={refresh} /></div>}

      <div className="flex gap-1 rounded-lg bg-slate-100 p-1 w-fit">
        {([['open', tl("In corso ({0})", pending.length)], ['problems', tl("Problemi")], ['all', tl("Tutti ({0})", invites.length)]] as const).map(([key, label]) =>
          <button key={key} type="button" onClick={() => setFilter(key)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${filter === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{label}</button>)}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-[1180px] text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
            <tr><th>{tl("Istituto")}</th><th>{tl("Referente")}</th><th>{tl("Stato")}</th><th>E-mail</th><th>{tl("Link")}</th><th>{tl("Accettazione")}</th><th>{tl("Creato · scade")}</th><th className="text-right">{tl("Azioni")}</th></tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className="py-6 text-center text-slate-400">{tl("Caricamento…")}</td></tr>}
            {!isLoading && !shown.length && <tr><td colSpan={8} className="py-6 text-center text-slate-400">{tl("Nessun invito in questo elenco.")}</td></tr>}
            {shown.map((inv) => (
              <tr key={inv.id} className="align-top">
                <td className="max-w-[280px]">
                  <span className="font-semibold text-slate-800">{inv.tenant_name || inv.organization?.name || tl("Da scegliere al primo accesso")}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {inv.mechanographic_code ? <span className="font-mono">{inv.mechanographic_code}</span> : (inv.tenant_name || inv.organization) && <Pill label={tl("fuori registro")} cls="bg-amber-50 text-amber-700" />}
                    {inv.organization?.comune && <span>{inv.organization.comune}{inv.organization.province ? ` (${inv.organization.province})` : ''}</span>}
                    {inv.label && <span className="italic">{inv.label}</span>}
                  </span>
                </td>
                <td className="max-w-[240px]">
                  <span className="text-slate-800">{[inv.first_name, inv.last_name].filter(Boolean).join(' ') || '—'}</span>
                  <span className="block text-xs text-slate-500">{inv.email ? <a className="hover:underline" href={`mailto:${inv.email}`}>{inv.email}</a> : <><Link2 className="mr-1 inline h-3 w-3" />{tl("link monouso")}</>}</span>
                </td>
                <td><Pill {...STAGES[inv.stage]} /></td>
                <td className="max-w-[280px]">{inv.mode === 'EMAIL'
                  ? <EmailDelivery status={inv.email_status} error={inv.email_error} sentAt={inv.email_sent_at} openedAt={inv.email_opened_at} attempts={inv.email_attempts} />
                  : <span className="text-xs text-slate-400">{tl("Inviato da te")}</span>}</td>
                <td className="nowrap text-xs text-slate-600">{inv.opened_at ? <>{tl("Aperto")} {fmtDate(inv.opened_at)}<span className="block text-slate-500">{inv.open_count} {inv.open_count === 1 ? 'apertura' : 'aperture'}</span></> : <span className="text-slate-400">{tl("Non aperto")}</span>}</td>
                <td className="nowrap text-xs">
                  {inv.completed_at ? <span className="text-emerald-700">{tl("Completata")} {fmtDate(inv.completed_at)}</span>
                    : <span className={inv.accepted.length ? 'text-amber-800' : 'text-slate-400'}>{inv.accepted.length}/{DOCUMENTS} {tl("documenti")}
                      {inv.progress_at && <span className="block text-slate-500">{fmtDate(inv.progress_at)}</span>}</span>}
                </td>
                <td className="nowrap text-xs text-slate-600">{fmtDate(inv.created_at, false)}<span className="block text-slate-500">scade {fmtDate(inv.expires_at, false)}</span></td>
                <td>
                  {inv.status === 'PENDING' && (
                    <div className="flex justify-end gap-1.5">
                      {inv.link && <Button tone="neutral" surface="outline" density="compact" title={tl("Copia link")}
                        onClick={() => navigator.clipboard.writeText(inv.link!).then(() => toast({ title: tl("Link copiato") }))}><Copy className="h-3.5 w-3.5" /></Button>}
                      {inv.mode === 'EMAIL' && <Button tone="neutral" surface="outline" density="compact" title={tl("Reinvia e-mail")} disabled={resend.isPending}
                        onClick={() => resend.mutate(inv.id)}><RefreshCw className="h-3.5 w-3.5" /></Button>}
                      <Button tone="danger" surface="ghost" density="compact" title={tl("Revoca")}
                        onClick={() => { if (window.confirm(tl("Revocare questo invito?"))) revoke.mutate(inv.id) }}><X className="h-3.5 w-3.5" /></Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
