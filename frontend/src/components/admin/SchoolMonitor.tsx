import { Fragment, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2, Mail, Search } from '@/components/icons'
import { Input } from '@/components/ui/input'
import { formatCreditAmount, toCredits } from '@/lib/credits'
import { schoolOnboardingAdminApi, type InviteStage, type SchoolOverview, type SchoolPerson } from '@/lib/api'
import { tl } from '@/i18n/tl'

export const fmtDate = (iso: string | null | undefined, time = true) => iso
  ? new Date(iso).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric', ...(time ? { hour: '2-digit', minute: '2-digit' } : {}) })
  : '—'
const credits = (eur: number) => formatCreditAmount(toCredits(eur || 0))
const fullName = (p: { first_name: string | null; last_name: string | null }) => [p.first_name, p.last_name].filter(Boolean).join(' ') || '—'

export const STAGES: Record<InviteStage, { label: string; cls: string }> = {
  CREATED: { label: tl("Creato"), cls: 'bg-slate-100 text-slate-600' },
  EMAIL_SENT: { label: tl("E-mail inviata"), cls: 'bg-sky-100 text-sky-700' },
  EMAIL_FAILED: { label: tl("E-mail non inviata"), cls: 'bg-red-100 text-red-700' },
  EMAIL_READ: { label: tl("E-mail letta"), cls: 'bg-indigo-100 text-indigo-700' },
  LINK_OPENED: { label: tl("Link aperto"), cls: 'bg-violet-100 text-violet-700' },
  PARTIAL: { label: tl("Approvazione parziale"), cls: 'bg-amber-100 text-amber-800' },
  COMPLETED: { label: tl("Attivato"), cls: 'bg-emerald-100 text-emerald-700' },
  EXPIRED: { label: tl("Scaduto"), cls: 'bg-red-50 text-red-600' },
  REVOKED: { label: tl("Revocato"), cls: 'bg-slate-100 text-slate-500' },
}

const PERSON_STATES: Record<SchoolPerson['state'], { label: string; cls: string }> = {
  INVITED: { label: tl("Invitato"), cls: 'bg-sky-100 text-sky-700' },
  EXPIRED: { label: tl("Invito scaduto"), cls: 'bg-red-50 text-red-600' },
  TERMS_PENDING: { label: tl("Documenti da accettare"), cls: 'bg-amber-100 text-amber-800' },
  ACTIVE: { label: tl("Attivo"), cls: 'bg-emerald-100 text-emerald-700' },
  DEACTIVATED: { label: tl("Disattivato"), cls: 'bg-slate-100 text-slate-500' },
}

export function Pill({ label, cls, title }: { label: string; cls: string; title?: string }) {
  return <span title={title} className={`admin-nowrap inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>
}

/** What happened to an invitation e-mail, in one line: sent, read, or why it failed. */
export function EmailDelivery({ status, error, sentAt, openedAt, attempts }: {
  status: 'SENT' | 'FAILED' | null; error: string | null; sentAt: string | null; openedAt: string | null; attempts: number
}) {
  if (!status) return <span className="text-xs text-slate-400">{tl("Non inviata")}</span>
  if (status === 'FAILED') {
    return <span className="block text-xs text-red-700" title={error ?? undefined}>
      <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />{tl("Non inviata")}{attempts > 1 ? ` (${attempts} tentativi)` : ''}
      {error && <span className="mt-0.5 block text-[11px] leading-snug text-red-600/90">{error}</span>}
    </span>
  }
  return <span className="block text-xs text-slate-600">
    <Mail className="mr-1 inline h-3.5 w-3.5 text-sky-600" />{tl("Inviata")} {fmtDate(sentAt)}
    <span className={`block text-[11px] ${openedAt ? 'text-indigo-700' : 'text-slate-400'}`}>
      {openedAt ? tl("Letta {0}", fmtDate(openedAt)) : tl("Lettura non rilevata")}
    </span>
  </span>
}

function Documents({ person }: { person: SchoolPerson }) {
  return <ul className="space-y-1">
    {person.documents.map(d => <li key={d.key} className="flex items-start gap-2 text-xs">
      {d.current ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />}
      <span className="min-w-0">
        <span className="font-medium text-slate-700">{d.title}</span>
        <span className="block text-[11px] text-slate-500">
          {d.accepted_at ? tl("Accettato {0} · v. {1}", fmtDate(d.accepted_at), d.accepted_version) : tl("Non ancora accettato")}
          {d.accepted_at && !d.current && ` · da riaccettare (v. ${d.required_version})`}
        </span>
      </span>
    </li>)}
  </ul>
}

function Timeline({ school }: { school: SchoolOverview }) {
  const inv = school.invite
  if (!inv) return <p className="text-xs text-slate-500">{tl("Istituto creato senza invito di onboarding.")}</p>
  const total = school.principal?.documents.length || 4
  type Step = { label: string; at: string | null; note?: string | null; failed?: boolean }
  const steps: Step[] = [
    { label: tl("Invito creato"), at: inv.created_at, note: inv.mode === 'EMAIL' ? `per ${inv.email}` : tl("link monouso") },
    ...(inv.mode === 'EMAIL' ? [
      inv.email_status === 'FAILED'
        ? { label: tl("E-mail NON inviata"), at: null, note: inv.email_error, failed: true }
        : { label: tl("E-mail inviata"), at: inv.email_sent_at, note: inv.email_attempts ? `${inv.email_attempts} ${inv.email_attempts === 1 ? 'invio' : 'invii'}` : null },
      { label: tl("E-mail letta (stima)"), at: inv.email_opened_at },
    ] : []),
    { label: tl("Link aperto"), at: inv.opened_at, note: inv.open_count ? `${inv.open_count} aperture, ultima ${fmtDate(inv.last_opened_at)}` : null },
    { label: tl("Documenti spuntati"), at: inv.progress_at, note: `${inv.accepted.length}/${total}` },
    { label: tl("Attivazione completata"), at: inv.completed_at },
  ]
  return <ol className="space-y-2">
    {steps.map(({ label, at, note, failed }) => <li key={label} className="flex items-start gap-2.5 text-xs">
      <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${at ? 'bg-emerald-500' : failed ? 'bg-red-500' : 'bg-slate-300'}`} />
      <span className="min-w-0">
        <span className={`font-medium ${at ? 'text-slate-800' : 'text-slate-500'}`}>{label}</span>
        <span className="ml-1.5 text-slate-500">{at ? fmtDate(at) : '—'}</span>
        {note && <span className="block text-[11px] text-slate-500">{note}</span>}
      </span>
    </li>)}
  </ol>
}

function TeachersTable({ teachers, max }: { teachers: SchoolPerson[]; max: number }) {
  if (!teachers.length) return <p className="text-xs text-slate-500">{tl("Il dirigente non ha ancora invitato docenti (massimo")} {max}).</p>
  return <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
    <table className="min-w-[980px] text-sm">
      <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
        <tr><th>{tl("Docente")}</th><th>{tl("Stato")}</th><th>{tl("E-mail d'invito")}</th><th>{tl("Invitato · attivato")}</th><th>{tl("Documenti")}</th>
          <th className="text-right">{tl("Classi")}</th><th className="text-right">{tl("Sessioni")}</th><th className="text-right">{tl("Studenti")}</th><th className="text-right">{tl("Crediti mese")}</th><th>{tl("Ultimo accesso")}</th></tr>
      </thead>
      <tbody>
        {teachers.map(t => <tr key={t.id} className="align-top">
          <td><span className="font-medium text-slate-800">{fullName(t)}</span><span className="block text-xs text-slate-500">{t.email}</span>
            {t.member && <span className="mt-0.5 block text-[11px] text-slate-400">{tl("membro aggiunto dall'admin")}</span>}</td>
          <td><Pill {...PERSON_STATES[t.state]} /></td>
          <td className="max-w-[260px]">{t.invite_email
            ? <EmailDelivery status={t.invite_email.status} error={t.invite_email.error} sentAt={t.invite_email.sent_at} openedAt={t.invite_email.opened_at} attempts={t.invite_email.attempts} />
            : <span className="text-xs text-slate-400">—</span>}</td>
          <td className="nowrap text-xs text-slate-600">{fmtDate(t.invited_at, false)}<span className="block text-slate-500">{t.activated_at ? fmtDate(t.activated_at, false) : tl("non attivato")}</span></td>
          <td className="min-w-[200px]"><Documents person={t} /></td>
          <td className="nowrap text-right">{t.classes}</td>
          <td className="nowrap text-right">{t.sessions}</td>
          <td className="nowrap text-right">{t.students}<span className="block text-[11px] text-slate-500">{t.students_active_7d} {tl("attivi 7 gg")}</span></td>
          <td className="nowrap text-right">{credits(t.credits_month)}</td>
          <td className="nowrap text-xs text-slate-600">{fmtDate(t.last_login_at)}</td>
        </tr>)}
      </tbody>
    </table>
  </div>
}

function Detail({ school }: { school: SchoolOverview }) {
  const p = school.principal
  const place = school.registry ?? school.organization
  return <div className="grid gap-4 bg-slate-50/70 p-4 lg:grid-cols-3">
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">{tl("Percorso d'invito")}</h4>
      <Timeline school={school} />
      {school.invites_count > 1 && <p className="mt-3 text-[11px] text-slate-500">{school.invites_count} {tl("inviti in totale per questo istituto.")}</p>}
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">{tl("Dirigente / referente")}</h4>
      {p ? <>
        <p className="font-semibold text-slate-800">{fullName(p)}</p>
        <a href={`mailto:${p.email}`} className="text-sm text-indigo-700 hover:underline">{p.email}</a>
        <p className="mt-1 text-xs text-slate-500">{tl("Attivato")} {fmtDate(p.activated_at)} {tl("· ultimo accesso")} {fmtDate(p.last_login_at)}</p>
        <div className="mt-3"><Documents person={p} /></div>
      </> : <>
        <p className="text-sm text-slate-600">{tl("Non ancora attivato.")}</p>
        {school.invite && <p className="mt-1 text-xs text-slate-500">{tl("Invitato:")} {[school.invite.first_name, school.invite.last_name].filter(Boolean).join(' ') || '—'}
          {school.invite.email && <> · <a href={`mailto:${school.invite.email}`} className="text-indigo-700 hover:underline">{school.invite.email}</a></>}</p>}
      </>}
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h4 className="mb-3 text-xs font-bold uppercase tracking-wide text-slate-500">{tl("Istituto")}</h4>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-slate-500">{tl("Codice")}</dt><dd className="font-mono">{school.mechanographic_code || tl("fuori registro MIM")}</dd>
        {place && <><dt className="text-slate-500">{tl("Luogo")}</dt><dd>{[school.registry?.address, place.comune, place.province].filter(Boolean).join(', ') || '—'}</dd></>}
        {school.registry && <><dt className="text-slate-500">{tl("Tipo")}</dt><dd>{school.registry.kind === 'STATALE' ? tl("Statale") : tl("Paritaria")}</dd></>}
        {school.registry?.email && <><dt className="text-slate-500">E-mail</dt><dd><a className="text-indigo-700 hover:underline" href={`mailto:${school.registry.email}`}>{school.registry.email}</a></dd></>}
        {school.registry?.pec && <><dt className="text-slate-500">PEC</dt><dd>{school.registry.pec}</dd></>}
        <dt className="text-slate-500">{tl("Creato")}</dt><dd>{fmtDate(school.created_at, false)}</dd>
        <dt className="text-slate-500">{tl("Classi")}</dt><dd>{school.stats.classes} · {school.stats.sessions} {tl("sessioni")}</dd>
        <dt className="text-slate-500">{tl("Crediti")}</dt><dd>{credits(school.stats.credits_month)} {tl("questo mese ·")} {credits(school.stats.credits_total)} totali</dd>
      </dl>
    </section>
    <section className="lg:col-span-3">
      <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">{tl("Docenti dell'istituto (")}{school.teachers.length} {tl("· massimo")} {school.max_teachers} {tl("invitati dal dirigente)")}</h4>
      <TeachersTable teachers={school.teachers} max={school.max_teachers} />
    </section>
  </div>
}

type Filter = 'all' | 'active' | 'pending' | 'problems'

/** Every school at a glance; a row opens the full story: invite, principal, teachers, activity. */
export function SchoolMonitor() {
  const { data = [], isLoading } = useQuery({
    queryKey: ['admin-school-overview'],
    queryFn: async () => (await schoolOnboardingAdminApi.schools()).data,
    refetchInterval: 60_000,
  })
  const [open, setOpen] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const problems = (s: SchoolOverview) => s.invite?.stage === 'EMAIL_FAILED' || s.invite?.stage === 'EXPIRED'
    || s.teachers.some(t => t.invite_email?.status === 'FAILED' || t.state === 'EXPIRED') || (!!s.principal && !s.principal.documents_complete)
  const shown = useMemo(() => data.filter(s => {
    const text = `${s.name} ${s.mechanographic_code ?? ''} ${s.principal?.email ?? s.invite?.email ?? ''} ${s.registry?.comune ?? s.organization?.comune ?? ''}`.toLowerCase()
    if (query && !text.includes(query.toLowerCase())) return false
    if (filter === 'active') return !!s.principal
    if (filter === 'pending') return !s.principal
    if (filter === 'problems') return problems(s)
    return true
  }), [data, query, filter]) // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => ({
    schools: data.length, active: data.filter(s => s.principal).length, teachers: data.reduce((n, s) => n + s.stats.teachers_active, 0),
    students: data.reduce((n, s) => n + s.stats.students, 0), problems: data.filter(problems).length,
  }), [data]) // eslint-disable-line react-hooks/exhaustive-deps

  return <section className="space-y-4">
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {([[tl("Istituti"), totals.schools], [tl("Attivati"), totals.active], [tl("Docenti attivi"), totals.teachers], [tl("Studenti"), totals.students], ['Da controllare', totals.problems]] as const)
        .map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className={`mt-1 text-2xl font-bold ${label === 'Da controllare' && value ? 'text-red-600' : 'text-slate-900'}`}>{value}</p>
        </div>)}
    </div>
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[240px] flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder={tl("Cerca istituto, codice, e-mail del referente, comune…")} className="pl-9 text-sm" />
      </div>
      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        {([['all', tl("Tutti")], ['active', tl("Attivati")], ['pending', tl("In attesa")], ['problems', 'Da controllare']] as const).map(([key, label]) =>
          <button key={key} type="button" onClick={() => setFilter(key)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold ${filter === key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{label}</button>)}
      </div>
    </div>
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-[1100px] text-sm">
        <thead className="bg-slate-50 text-left text-[11px] uppercase text-slate-500">
          <tr><th>{tl("Istituto")}</th><th>{tl("Dirigente / referente")}</th><th>{tl("Invito")}</th><th className="text-right">{tl("Docenti")}</th>
            <th className="text-right">{tl("Studenti")}</th><th className="text-right">{tl("Crediti mese")}</th><th>{tl("Ultima attività")}</th><th className="w-8" /></tr>
        </thead>
        <tbody>
          {isLoading && <tr><td colSpan={8} className="py-8 text-center text-slate-400"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" />{tl("Caricamento…")}</td></tr>}
          {!isLoading && !shown.length && <tr><td colSpan={8} className="py-8 text-center text-slate-400">{tl("Nessun istituto.")}</td></tr>}
          {shown.map(s => {
            const expanded = open === s.id, stage = s.invite?.stage
            const contact = s.principal ?? (s.invite ? { first_name: s.invite.first_name, last_name: s.invite.last_name, email: s.invite.email ?? '' } : null)
            return <Fragment key={s.id}>
              <tr className={`cursor-pointer hover:bg-slate-50 ${expanded ? 'bg-slate-50' : ''}`} onClick={() => setOpen(expanded ? null : s.id)}>
                <td className="max-w-[320px]">
                  <span className="font-semibold text-slate-900">{s.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {s.mechanographic_code ? <span className="font-mono">{s.mechanographic_code}</span> : <Pill label={tl("fuori registro")} cls="bg-amber-50 text-amber-700" />}
                    {(s.registry?.comune || s.organization?.comune) && <span>{s.registry?.comune || s.organization?.comune}{(s.registry?.province || s.organization?.province) ? ` (${s.registry?.province || s.organization?.province})` : ''}</span>}
                  </span>
                </td>
                <td className="max-w-[260px]">
                  {contact ? <><span className="text-slate-800">{fullName(contact)}</span><span className="block text-xs text-slate-500">{contact.email || '—'}</span></> : <span className="text-slate-400">—</span>}
                  {s.principal && !s.principal.documents_complete && <span className="mt-0.5 block text-[11px] font-semibold text-amber-700">{tl("Documenti da riaccettare")}</span>}
                </td>
                <td>
                  {stage ? <Pill {...STAGES[stage]} title={s.invite?.email_error ?? undefined} /> : <span className="text-xs text-slate-400">—</span>}
                  {s.invite && <span className="mt-1 block text-[11px] text-slate-500">
                    {stage === 'COMPLETED' ? tl("Attivato {0}", fmtDate(s.invite.completed_at, false)) : stage === 'PARTIAL' ? tl("{0} documenti spuntati", s.invite.accepted.length) : tl("Creato {0}", fmtDate(s.invite.created_at, false))}
                  </span>}
                </td>
                <td className="nowrap text-right">{s.stats.teachers_active}/{s.max_teachers}
                  {s.stats.teachers_pending > 0 && <span className="block text-[11px] text-slate-500">{s.stats.teachers_pending} {tl("in attesa")}</span>}</td>
                <td className="nowrap text-right">{s.stats.students}<span className="block text-[11px] text-slate-500">{s.stats.students_active_7d} {tl("attivi 7 gg")}</span></td>
                <td className="nowrap text-right">{credits(s.stats.credits_month)}</td>
                <td className="nowrap text-xs text-slate-600">{fmtDate(s.stats.last_activity_at)}</td>
                <td className="text-slate-400">{expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</td>
              </tr>
              {expanded && <tr><td colSpan={8} className="p-0"><Detail school={s} /></td></tr>}
            </Fragment>
          })}
        </tbody>
      </table>
    </div>
  </section>
}
