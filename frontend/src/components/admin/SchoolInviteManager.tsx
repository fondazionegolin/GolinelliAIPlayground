import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Building2, CheckCircle2, Copy, Link2, Loader2, Mail, RefreshCw, Search, Send, X,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { schoolOnboardingAdminApi, type RegistrySchool, type SchoolInvite } from '@/lib/api'

const STATUS: Record<SchoolInvite['status'], { label: string; cls: string }> = {
  PENDING: { label: 'In attesa', cls: 'bg-amber-100 text-amber-700' },
  COMPLETED: { label: 'Completato', cls: 'bg-emerald-100 text-emerald-700' },
  REVOKED: { label: 'Revocato', cls: 'bg-slate-100 text-slate-500' },
  EXPIRED: { label: 'Scaduto', cls: 'bg-red-100 text-red-600' },
}

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
          placeholder={placeholder || 'Cerca per nome, comune o codice meccanografico…'} />
        {isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
      </div>
      {debounced.length >= 2 && !isFetching && data?.length === 0 && (
        <p className="text-xs text-slate-500">Nessun risultato nel registro MIM.</p>
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
                {s.tenant && <span className="ml-1 font-semibold text-amber-600">· già presente: {s.tenant.tenant_name}</span>}
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

function InviteForm({ onDone }: { onDone: () => void }) {
  const { toast } = useToast()
  const [mode, setMode] = useState<'EMAIL' | 'SINGLE_USE_LINK'>('EMAIL')
  const [school, setSchool] = useState<RegistrySchool | null>(null)
  const [form, setForm] = useState({ email: '', first_name: '', last_name: '', custom_message: '', label: '' })
  const [created, setCreated] = useState<SchoolInvite | null>(null)

  const create = useMutation({
    mutationFn: async () => (await schoolOnboardingAdminApi.createInvite({
      mode,
      mechanographic_code: school?.code,
      email: mode === 'EMAIL' ? form.email.trim() : undefined,
      first_name: form.first_name.trim() || undefined,
      last_name: form.last_name.trim() || undefined,
      custom_message: form.custom_message.trim() || undefined,
      label: form.label.trim() || undefined,
      send_email: mode === 'EMAIL',
    })).data,
    onSuccess: (inv) => {
      setCreated(inv)
      onDone()
      if (inv.mode === 'EMAIL') {
        toast({
          title: inv.email_sent ? 'Invito inviato' : 'Invito creato, e-mail NON inviata',
          description: inv.email_sent ? inv.email ?? undefined : 'Controlla la configurazione SMTP o copia il link.',
          variant: inv.email_sent ? undefined : 'destructive',
        })
      }
    },
    onError: (e) => toast({ title: errorDetail(e, 'Creazione invito non riuscita'), variant: 'destructive' }),
  })

  const copy = (link: string | null) => {
    if (!link) return
    navigator.clipboard.writeText(link).then(() => toast({ title: 'Link copiato' }))
  }
  const canCreate = mode === 'SINGLE_USE_LINK' || /\S+@\S+\.\S+/.test(form.email)

  if (created) {
    return (
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {created.mode === 'EMAIL' ? `Invito per ${created.email}` : 'Link monouso creato'}
            {created.tenant_name ? ` · ${created.tenant_name}` : ''}. Scade il {new Date(created.expires_at).toLocaleDateString('it-IT')}.
          </span>
        </div>
        {created.link && (
          <div className="flex gap-2">
            <Input readOnly value={created.link} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button variant="outline" onClick={() => copy(created.link)}><Copy className="mr-1.5 h-4 w-4" />Copia</Button>
          </div>
        )}
        <Button variant="ghost" size="sm" onClick={() => { setCreated(null); setSchool(null); setForm({ email: '', first_name: '', last_name: '', custom_message: '', label: '' }) }}>
          Nuovo invito
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex w-fit gap-1 rounded-lg bg-slate-100 p-1">
        {([['EMAIL', 'Invio per e-mail', Mail], ['SINGLE_USE_LINK', 'Link monouso', Link2]] as const).map(([m, label, Icon]) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${mode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>
      <p className="text-xs text-slate-500">
        {mode === 'EMAIL'
          ? 'Il dirigente riceve una e-mail con il link personale; il link vale per un solo istituto e un solo accesso.'
          : 'Genera un link utilizzabile una sola volta, da inviare tu (es. dalla segreteria). Istituto e credenziali verranno compilati da chi apre il link, oppure li fissi tu qui sotto.'}
      </p>

      <div>
        <Label className="mb-1 block text-xs text-slate-500">
          Istituto dal registro MIM {mode === 'EMAIL' ? '*' : '(facoltativo)'}
        </Label>
        {school ? (
          <div className="flex items-start justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-sm">
              <p className="flex items-center gap-1.5 font-semibold text-slate-900"><CheckCircle2 className="h-4 w-4 text-emerald-600" />{school.name}</p>
              <p className="text-xs text-slate-600">
                <span className="font-mono">{school.code}</span> · {[school.address, school.comune, school.province].filter(Boolean).join(', ')}
              </p>
              {school.email && <p className="text-xs text-slate-500">E-mail istituzionale: {school.email}</p>}
            </div>
            <button type="button" onClick={() => setSchool(null)} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
          </div>
        ) : (
          <RegistrySearch onPick={(s) => {
            setSchool(s)
            if (!form.email && s.email && mode === 'EMAIL') setForm((f) => ({ ...f, email: s.email!.toLowerCase() }))
          }} />
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {mode === 'EMAIL' && (
          <div className="sm:col-span-2">
            <Label className="mb-1 block text-xs text-slate-500">E-mail del dirigente / responsabile *</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="text-sm" />
          </div>
        )}
        <div><Label className="mb-1 block text-xs text-slate-500">Nome (opzionale)</Label>
          <Input value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} className="text-sm" /></div>
        <div><Label className="mb-1 block text-xs text-slate-500">Cognome (opzionale)</Label>
          <Input value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} className="text-sm" /></div>
        <div className="sm:col-span-2"><Label className="mb-1 block text-xs text-slate-500">Messaggio nell'invito (opzionale)</Label>
          <Input value={form.custom_message} onChange={(e) => setForm((f) => ({ ...f, custom_message: e.target.value }))} className="text-sm" /></div>
        <div className="sm:col-span-2"><Label className="mb-1 block text-xs text-slate-500">Etichetta interna (opzionale)</Label>
          <Input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="es. richiesta dalla segreteria, bando 2026" className="text-sm" /></div>
      </div>

      <div className="flex justify-end">
        <Button onClick={() => create.mutate()} disabled={!canCreate || create.isPending || (mode === 'EMAIL' && !school)}
          className="bg-pink-500 text-white hover:bg-pink-600">
          {create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
          {mode === 'EMAIL' ? 'Crea e invia invito' : 'Genera link monouso'}
        </Button>
      </div>
    </div>
  )
}

export function SchoolInviteManager() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)

  const { data: invites = [], isLoading } = useQuery({
    queryKey: ['admin-school-invites'],
    queryFn: async () => (await schoolOnboardingAdminApi.listInvites()).data,
  })
  const { data: registry } = useQuery({
    queryKey: ['admin-school-registry-status'],
    queryFn: async () => (await schoolOnboardingAdminApi.registryStatus()).data,
  })
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin-school-invites'] })
    qc.invalidateQueries({ queryKey: ['admin-tenants'] })
  }

  const revoke = useMutation({
    mutationFn: (id: string) => schoolOnboardingAdminApi.revokeInvite(id),
    onSuccess: () => { toast({ title: 'Invito revocato' }); refresh() },
    onError: (e) => toast({ title: errorDetail(e, 'Errore'), variant: 'destructive' }),
  })
  const resend = useMutation({
    mutationFn: async (id: string) => (await schoolOnboardingAdminApi.resendInvite(id)).data,
    onSuccess: (r) => { toast({ title: r.email_sent ? 'E-mail reinviata' : 'E-mail non inviata', variant: r.email_sent ? undefined : 'destructive' }); refresh() },
    onError: (e) => toast({ title: errorDetail(e, 'Errore'), variant: 'destructive' }),
  })
  const sync = useMutation({
    mutationFn: async () => (await schoolOnboardingAdminApi.syncRegistry()).data,
    onSuccess: (r: { total: number }) => {
      toast({ title: 'Registro aggiornato', description: `${r.total.toLocaleString('it-IT')} istituti` })
      qc.invalidateQueries({ queryKey: ['admin-school-registry-status'] })
    },
    onError: (e) => toast({ title: errorDetail(e, 'Sincronizzazione non riuscita'), variant: 'destructive' }),
  })

  const pending = invites.filter((i) => i.status === 'PENDING')

  return (
    <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <Building2 className="h-4 w-4 text-pink-500" /> Inviti istituti
            {pending.length > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">{pending.length} in attesa</span>}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Registro MIM: {registry ? <>{registry.total.toLocaleString('it-IT')} istituti{registry.school_year ? ` · a.s. ${registry.school_year.slice(0, 4)}/${registry.school_year.slice(4)}` : ''}</> : '…'}
            {registry?.total === 0 && <span className="ml-1 font-semibold text-red-600">vuoto: sincronizza</span>}
            <button type="button" className="ml-2 font-semibold text-indigo-600 hover:underline disabled:opacity-50"
              disabled={sync.isPending} onClick={() => sync.mutate()}>
              {sync.isPending ? 'Aggiornamento…' : 'Aggiorna dal MIM'}
            </button>
          </p>
        </div>
        <Button onClick={() => setOpen((v) => !v)} variant={open ? 'outline' : 'default'}
          className={open ? '' : 'bg-pink-500 text-white hover:bg-pink-600'}>
          {open ? 'Chiudi' : 'Invita un istituto'}
        </Button>
      </div>

      {open && <div className="mt-4 border-t border-slate-100 pt-4"><InviteForm onDone={refresh} /></div>}

      {isLoading && <div className="mt-4 text-xs text-slate-400">Caricamento…</div>}
      {invites.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100">
          {invites.slice(0, 30).map((inv) => {
            const st = STATUS[inv.status]
            return (
              <li key={inv.id} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-800">
                    {inv.tenant_name || inv.label || 'Istituto da definire'}
                    {inv.mechanographic_code && <span className="ml-2 font-mono text-xs font-normal text-slate-500">{inv.mechanographic_code}</span>}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {inv.mode === 'EMAIL' ? <><Mail className="mr-1 inline h-3 w-3" />{inv.email}</> : <><Link2 className="mr-1 inline h-3 w-3" />Link monouso</>}
                    {inv.opened_at && inv.status === 'PENDING' && ' · aperto'}
                    {inv.label && inv.tenant_name ? ` · ${inv.label}` : ''}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                {inv.status === 'PENDING' && (
                  <div className="flex gap-1">
                    {inv.link && (
                      <Button size="sm" variant="outline" title="Copia link"
                        onClick={() => navigator.clipboard.writeText(inv.link!).then(() => toast({ title: 'Link copiato' }))}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {inv.mode === 'EMAIL' && (
                      <Button size="sm" variant="outline" title="Reinvia e-mail" disabled={resend.isPending} onClick={() => resend.mutate(inv.id)}>
                        <RefreshCw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" className="text-red-600" title="Revoca"
                      onClick={() => { if (window.confirm('Revocare questo invito?')) revoke.mutate(inv.id) }}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
