import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import {
  Building2, CheckCircle2, ExternalLink, FileCheck2, KeyRound, Loader2, LockKeyhole, Scale, Search, ShieldCheck, Users,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { AppBackground } from '@/components/ui/AppBackground'
import { LogoMark } from '@/components/LogoMark'
import { schoolInviteApi, type LegalDocInfo, type RegistrySchool } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { tl } from '@/i18n/tl'

function errorDetail(err: unknown, fallback: string) {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback
}

function SchoolSummary({ school }: { school: RegistrySchool }) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <div className="min-w-0">
          <p className="font-bold text-slate-900">{school.name}</p>
          <p className="text-slate-600">
            {[school.address, school.cap, school.comune, school.province && `(${school.province})`].filter(Boolean).join(' ')}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {tl("Codice meccanografico")} <span className="font-mono font-semibold">{school.code}</span>
            {' · '}{school.kind === 'STATALE' ? tl("Scuola statale") : tl("Scuola paritaria")} {tl("· verificato sul registro MIM")}
          </p>
        </div>
      </div>
    </div>
  )
}

function StepTitle({ n, icon: Icon, title }: { n: number; icon: typeof Building2; title: string }) {
  return (
    <CardTitle className="flex items-center gap-3 text-base">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--logo-pink)] text-xs font-bold text-white">{n}</span>
      <Icon className="h-4 w-4 text-muted-foreground" />
      {title}
    </CardTitle>
  )
}

/** Contratto d'adozione del Dirigente: testo leggibile in pagina + dichiarazione esplicita. */
function ContractBlock({ doc, school, checked, onChange }: {
  doc: LegalDocInfo
  school: RegistrySchool | null
  checked: boolean
  onChange: (v: boolean) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['school-invite-contract', school?.code, school?.name],
    queryFn: async () => (await schoolInviteApi.document('deployer-agreement', {
      school_name: school?.name, code: school?.code,
    })).data,
  })
  return (
    <div className="overflow-hidden rounded-xl border-2 border-[var(--logo-pink)]/40 bg-[var(--logo-pink-06)]">
      <div className="flex items-start gap-3 border-b border-[var(--logo-pink)]/20 px-4 py-3">
        <Scale className="mt-0.5 h-5 w-5 shrink-0 text-[var(--logo-pink)]" />
        <div className="min-w-0">
          <p className="text-sm font-bold text-gray-900">{doc.title}</p>
          <p className="text-xs text-gray-600">
            {tl("Contratto con cui l'istituto adotta la piattaforma e assume il ruolo di")} <em>deployer</em> {tl("e di titolare del trattamento dei dati degli studenti (informativa privacy v2.0). Va accettato dal Dirigente in qualità di legale rappresentante · v.")} {doc.version}
          </p>
        </div>
      </div>
      <div className="max-h-64 overflow-y-auto bg-white px-4 py-3 text-sm leading-relaxed text-gray-700 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-sm [&_h3]:font-semibold [&_li]:mb-1 [&_p]:my-1.5 [&_ul]:ml-5 [&_ul]:list-disc">
        {isLoading
          ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
          : <div dangerouslySetInnerHTML={{ __html: data?.html ?? '' }} />}
      </div>
      <label className="flex cursor-pointer items-start gap-3 border-t border-[var(--logo-pink)]/20 bg-white px-4 py-3">
        <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--logo-pink)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="text-sm text-gray-800">
          <strong>{tl("Dichiaro di avere i poteri di rappresentanza dell'istituto e accetto il contratto d'uso")}</strong>
          {school ? <> {tl("per")} <strong>{school.name}</strong></> : null}.
        </span>
      </label>
    </div>
  )
}

type Organization = { name: string; comune: string; province: string }

function OrganizationSummary({ org }: { org: { name: string; comune: string | null; province: string | null } }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
      <div className="flex items-start gap-3">
        <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
        <div className="min-w-0">
          <p className="font-bold text-slate-900">{org.name}</p>
          {(org.comune || org.province) && <p className="text-slate-600">{[org.comune, org.province && `(${org.province})`].filter(Boolean).join(' ')}</p>}
          <p className="mt-1 text-xs text-slate-500">{tl("Organizzazione fuori dal registro MIM")}</p>
        </div>
      </div>
    </div>
  )
}

function SchoolPicker({ token, selected, onSelect, manual, onManual }: {
  token: string
  selected: RegistrySchool | null
  onSelect: (s: RegistrySchool | null) => void
  manual: Organization | null
  onManual: (org: Organization | null) => void
}) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(id)
  }, [q])

  const { data, isFetching } = useQuery({
    queryKey: ['school-invite-registry', token, debounced],
    queryFn: async () => (await schoolInviteApi.searchRegistry(token, debounced)).data,
    enabled: debounced.length >= 2 && !selected,
  })

  if (manual) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <div className="space-y-1.5"><Label>{tl("Nome dell'istituto o organizzazione")}</Label>
            <Input value={manual.name} onChange={(e) => onManual({ ...manual, name: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>{tl("Comune / città")}</Label>
            <Input value={manual.comune} onChange={(e) => onManual({ ...manual, comune: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>{tl("Provincia / paese")}</Label>
            <Input value={manual.province} onChange={(e) => onManual({ ...manual, province: e.target.value })} /></div>
        </div>
        <button type="button" onClick={() => onManual(null)} className="text-xs font-semibold text-slate-500 underline">
          {tl("Cerca invece nel registro delle scuole")}
        </button>
      </div>
    )
  }
  if (selected) {
    return (
      <div className="space-y-2">
        <SchoolSummary school={selected} />
        <button type="button" onClick={() => onSelect(null)} className="text-xs font-semibold text-slate-500 underline">
          {tl("Cambia istituto")}
        </button>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={tl("Nome dell'istituto, comune o codice meccanografico")}
          className="pl-9"
        />
        {isFetching && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />}
      </div>
      {debounced.length >= 2 && !isFetching && data && data.length === 0 && (
        <p className="text-sm text-slate-500">{tl("Nessun istituto trovato. Prova con il codice meccanografico (es. BOIC81800X).")}</p>
      )}
      <ul className="max-h-72 space-y-1.5 overflow-y-auto">
        {(data ?? []).map((s) => (
          <li key={s.code}>
            <button
              type="button"
              disabled={s.available === false}
              onClick={() => onSelect(s)}
              className="w-full rounded-lg border bg-white p-3 text-left transition hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="block text-sm font-semibold text-slate-900">{s.name}</span>
              <span className="block text-xs text-slate-500">
                <span className="font-mono">{s.code}</span> · {[s.comune, s.province].filter(Boolean).join(' (')}{s.province ? ')' : ''}
                {' · '}{s.kind === 'STATALE' ? 'statale' : 'paritaria'}
                {s.available === false && tl(" · già attivato")}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className="text-xs text-slate-500">
        {tl("Il tuo istituto o la tua organizzazione non è nel registro MIM?")}{' '}
        <button type="button" className="font-semibold text-[var(--logo-pink)] hover:underline" onClick={() => onManual({ name: q.trim(), comune: '', province: '' })}>
          {tl("Inseriscila a mano")}
        </button>
      </p>
    </div>
  )
}

export default function SchoolInvitePage() {
  const { token = '' } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const setUser = useAuthStore((s) => s.setUser)

  const { data: invite, isLoading, error } = useQuery({
    queryKey: ['school-invite', token],
    queryFn: async () => (await schoolInviteApi.get(token)).data,
    retry: false,
  })

  const [accepted, setAccepted] = useState<Record<string, boolean>>({})
  const [picked, setPicked] = useState<RegistrySchool | null>(null)
  const [manual, setManual] = useState<Organization | null>(null)
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', password: '', confirm: '' })

  // Ticks already saved (the principal came back later): restored, and every change is saved for the admin to follow.
  useEffect(() => {
    if (invite?.accepted?.length) setAccepted((a) => ({ ...Object.fromEntries(invite.accepted.map((k) => [k, true])), ...a }))
  }, [invite?.accepted?.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const acceptedKeys = Object.keys(accepted).filter((k) => accepted[k]).sort().join()
  useEffect(() => {
    if (!invite) return
    const timer = window.setTimeout(() => { void schoolInviteApi.progress(token, acceptedKeys ? acceptedKeys.split(',') : []).catch(() => undefined) }, 600)
    return () => clearTimeout(timer)
  }, [acceptedKeys]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!invite) return
    setForm((f) => ({
      ...f,
      first_name: f.first_name || invite.first_name || '',
      last_name: f.last_name || invite.last_name || '',
      email: f.email || invite.email || '',
    }))
  }, [invite])

  const school = invite?.school ?? picked
  const fixedOrganization = !invite?.school ? invite?.organization ?? null : null
  const hasSchool = !!school || !!fixedOrganization || (manual?.name.trim().length ?? 0) >= 2
  const allAccepted = useMemo(
    () => !!invite && invite.documents.every((d) => accepted[d.key]),
    [invite, accepted],
  )
  const passwordOk = form.password.length >= 8 && form.password === form.confirm
  const canSubmit = hasSchool && allAccepted && passwordOk && !!form.first_name.trim()
    && !!form.last_name.trim() && /\S+@\S+\.\S+/.test(form.email)

  const submit = useMutation({
    mutationFn: async () => (await schoolInviteApi.complete(token, {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      email: form.email.trim(),
      password: form.password,
      mechanographic_code: invite?.school || fixedOrganization || manual ? undefined : picked?.code,
      accepted_documents: Object.keys(accepted).filter((k) => accepted[k]),
      ...(manual && !fixedOrganization ? {
        organization_name: manual.name.trim(), organization_comune: manual.comune.trim() || undefined, organization_province: manual.province.trim() || undefined,
      } : {}),
    })).data,
    onSuccess: (res) => {
      setUser({ id: res.user_id, email: form.email.trim().toLowerCase(), role: res.role, tenant_id: res.tenant_id }, res.access_token)
      toast({ title: tl("Istituto attivato"), description: tl("Ora puoi invitare i docenti dal pannello.") })
      navigate(res.redirect || '/teacher/school', { replace: true })
    },
    onError: (e) => toast({ title: tl("Attivazione non riuscita"), description: errorDetail(e, tl("Riprova tra qualche secondo.")), variant: 'destructive' }),
  })

  const baseDocs = invite?.documents.filter((d) => d.key !== 'deployer_agreement') ?? []
  const contractDoc = invite?.documents.find((d) => d.key === 'deployer_agreement')
  const acceptedCount = invite ? invite.documents.filter((d) => accepted[d.key]).length : 0

  const shell = (children: React.ReactNode) => (
    <AppBackground className="min-h-screen p-4 py-8">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <div className="text-center">
          <div className="mb-2 flex items-center justify-center gap-4">
            <LogoMark className="h-12 w-12" />
            <span className="pb-[1px] text-left text-[28px] leading-[1.15] tracking-tight" style={{ fontFamily: 'var(--font-family-brand)' }}>
              <span className="font-bold text-[var(--logo-ink)]">Golinelli</span>
              <span className="font-black text-[var(--logo-pink)]">.ai</span>
            </span>
          </div>
        </div>
        {children}
      </div>
    </AppBackground>
  )

  if (isLoading) {
    return shell(
      <Card><CardContent className="flex flex-col items-center gap-4 pt-6">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">{tl("Caricamento dell'invito…")}</p>
      </CardContent></Card>,
    )
  }
  if (error || !invite) {
    return shell(
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive"><LockKeyhole className="h-5 w-5" />{tl("Invito non disponibile")}</CardTitle>
        </CardHeader>
        <CardContent><p className="text-muted-foreground">{errorDetail(error, tl("Il link non è valido."))}</p></CardContent>
      </Card>,
    )
  }

  return shell(
    <>
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-900">{tl("Invito alla sperimentazione")}</h1>
        <p className="mt-2 text-gray-600">
          {invite.first_name ? `Gentile ${invite.first_name} ${invite.last_name ?? ''}, ` : ''}
          {tl("attiva Golinelli.ai per")} {invite.school ? <strong>{invite.school.name}</strong> : fixedOrganization ? <strong>{fixedOrganization.name}</strong> : tl("il tuo istituto")}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{tl("Cos'è Golinelli.ai")}</CardTitle>
          <CardDescription className="leading-relaxed">{invite.platform_summary}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {invite.custom_message && (
            <p className="rounded-lg bg-muted p-3 text-sm text-gray-700">{invite.custom_message}</p>
          )}
          <ul className="grid gap-3 text-sm text-gray-700 sm:grid-cols-3">
            <li className="flex gap-2"><Users className="mt-0.5 h-4 w-4 shrink-0 text-[var(--logo-pink)]" /><span>{tl("Fino a")} <strong>{invite.max_teachers} {tl("docenti")}</strong> {tl("invitati da te")}</span></li>
            <li className="flex gap-2"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--logo-pink)]" /><span>{tl("Docente sempre in controllo (Teacher in the Loop)")}</span></li>
            <li className="flex gap-2"><FileCheck2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--logo-pink)]" /><span>{tl("Bozza di informativa per le famiglie inclusa")}</span></li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><StepTitle n={1} icon={Building2} title={tl("Il tuo istituto")} /></CardHeader>
        <CardContent>
          {invite.school
            ? <SchoolSummary school={invite.school} />
            : fixedOrganization
              ? <OrganizationSummary org={fixedOrganization} />
              : <SchoolPicker token={token} selected={picked} onSelect={setPicked} manual={manual} onManual={setManual} />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <StepTitle n={2} icon={FileCheck2} title={tl("Condizioni d'uso e contratto")} />
          <CardDescription>
            {tl("Per attivare l'istituto devi accettare")} {invite.documents.length} {tl("documenti. I primi tre sono le condizioni generali della piattaforma; l'ultimo è il")} <strong>{tl("contratto d'uso")}</strong> {tl("con cui l'istituto la adotta. Accettati:")} <strong>{acceptedCount}/{invite.documents.length}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="space-y-2">
            {baseDocs.map((d) => (
              <li key={d.key} className="flex items-start gap-3 rounded-lg border bg-white p-3">
                <input id={`doc-${d.key}`} type="checkbox" className="mt-1 h-4 w-4 accent-[var(--logo-pink)]"
                  checked={!!accepted[d.key]} onChange={(e) => setAccepted((a) => ({ ...a, [d.key]: e.target.checked }))} />
                <label htmlFor={`doc-${d.key}`} className="min-w-0 flex-1 cursor-pointer text-sm text-gray-800">
                  <span className="font-semibold">{d.title}</span>
                  <span className="ml-1 text-xs text-gray-400">v. {d.version}</span>
                  <span className="block text-xs text-gray-500">{d.accept_label}</span>
                </label>
                <a href={d.source_url} target="_blank" rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[var(--logo-pink)] hover:underline">
                  {tl("Leggi")} <ExternalLink className="h-3 w-3" />
                </a>
              </li>
            ))}
          </ul>
          {contractDoc && (
            <ContractBlock doc={contractDoc} school={school ?? (fixedOrganization || manual ? { name: (fixedOrganization?.name || manual?.name || '').trim() } as RegistrySchool : null)} checked={!!accepted[contractDoc.key]}
              onChange={(v) => setAccepted((a) => ({ ...a, [contractDoc.key]: v }))} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <StepTitle n={3} icon={KeyRound} title={tl("Il tuo accesso")} />
          <CardDescription>{tl("Sarà l'account con cui gestirai il pannello dell'istituto.")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><Label>{tl("Nome")}</Label>
              <Input value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} autoComplete="given-name" /></div>
            <div className="space-y-1.5"><Label>{tl("Cognome")}</Label>
              <Input value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} autoComplete="family-name" /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label>{tl("E-mail istituzionale")}</Label>
              <Input type="email" value={form.email} readOnly={!!invite.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} autoComplete="email" /></div>
            <div className="space-y-1.5"><Label>{tl("Password (min. 8 caratteri)")}</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} autoComplete="new-password" /></div>
            <div className="space-y-1.5"><Label>{tl("Ripeti password")}</Label>
              <Input type="password" value={form.confirm} onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))} autoComplete="new-password" /></div>
          </div>
          {form.confirm && form.password !== form.confirm && (
            <p className="mt-2 text-xs text-destructive">{tl("Le password non coincidono.")}</p>
          )}
          <Button onClick={() => submit.mutate()} disabled={!canSubmit || submit.isPending} className="mt-5 w-full">
            {submit.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {tl("Accetto il contratto e attivo l'istituto")}
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {!allAccepted ? tl("Accetta tutti i documenti per continuare ({0}/{1}). ", acceptedCount, invite.documents.length) : ''}
            {tl("L'accettazione viene registrata con data, ora e indirizzo IP.")}
          </p>
        </CardContent>
      </Card>
    </>,
  )
}
