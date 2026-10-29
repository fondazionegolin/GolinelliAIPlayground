import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle, Building2, CheckCircle2, Clock, Copy, Download, FileText, Loader2, Mail, Send, Trash2, UserPlus, Users,
} from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { schoolOwnerApi, type OwnerTeacher } from '@/lib/api'
import { tl } from '@/i18n/tl'

const STATE_LABEL: Record<OwnerTeacher['state'], { label: string; cls: string }> = {
  INVITED: { label: tl("Invito inviato"), cls: 'bg-amber-100 text-amber-700' },
  EXPIRED: { label: tl("Invito scaduto"), cls: 'bg-red-50 text-red-600' },
  TERMS_PENDING: { label: tl("Da accettare le condizioni"), cls: 'bg-sky-100 text-sky-700' },
  ACTIVE: { label: tl("Attivo"), cls: 'bg-emerald-100 text-emerald-700' },
  DEACTIVATED: { label: tl("Disattivato"), cls: 'bg-slate-100 text-slate-500' },
}

function errorDetail(err: unknown, fallback: string) {
  return (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback
}

function htmlToText(html: string) {
  const el = document.createElement('div')
  el.innerHTML = html.replace(/<\/(p|h2|h3|li|ul)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
  return (el.textContent || '').replace(/\n{3,}/g, '\n\n').trim()
}

export default function SchoolOwnerPanelPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '' })
  const [showNotice, setShowNotice] = useState(false)

  const { data: panel, isLoading, error } = useQuery({
    queryKey: ['school-owner-panel'],
    queryFn: async () => (await schoolOwnerApi.panel()).data,
    retry: false,
  })
  const { data: notice } = useQuery({
    queryKey: ['school-owner-notice'],
    queryFn: async () => (await schoolOwnerApi.familyNotice()).data,
    enabled: !!panel,
  })
  const refresh = () => qc.invalidateQueries({ queryKey: ['school-owner-panel'] })

  const invite = useMutation({
    mutationFn: async () => (await schoolOwnerApi.inviteTeacher(form)).data,
    onSuccess: (res) => {
      setForm({ first_name: '', last_name: '', email: '' })
      refresh()
      if (res.email_sent) toast({ title: tl("Invito inviato"), description: tl("Il docente riceverà una e-mail per scegliere la password.") })
      else {
        toast({ title: tl("Docente creato, e-mail non inviata"),
          description: `${res.email_error ?? ''} ${res.link ? 'Il link di attivazione è stato copiato: invialo tu al docente.' : ''}`.trim(), variant: 'destructive' })
        if (res.link) navigator.clipboard?.writeText(res.link).catch(() => undefined)
      }
    },
    onError: (e) => toast({ title: tl("Invito non riuscito"), description: errorDetail(e, tl("Riprova.")), variant: 'destructive' }),
  })
  const resend = useMutation({
    mutationFn: async (id: string) => (await schoolOwnerApi.resend(id)).data,
    onSuccess: (r) => {
      refresh()
      if (!r.email_sent && r.link) navigator.clipboard?.writeText(r.link).catch(() => undefined)
      toast({ title: r.email_sent ? tl("Invito reinviato") : tl("E-mail non inviata"),
        description: r.email_sent ? undefined : `${r.email_error ?? ''} ${r.link ? 'Link copiato negli appunti.' : ''}`.trim(), variant: r.email_sent ? undefined : 'destructive' })
    },
    onError: (e) => toast({ title: errorDetail(e, tl("Errore")), variant: 'destructive' }),
  })
  const remove = useMutation({
    mutationFn: (id: string) => schoolOwnerApi.remove(id),
    onSuccess: () => { toast({ title: tl("Docente disattivato, slot liberato") }); refresh() },
    onError: (e) => toast({ title: errorDetail(e, tl("Errore")), variant: 'destructive' }),
  })

  if (isLoading) return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  if (error || !panel) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm font-semibold text-slate-500">
        {errorDetail(error, tl("Pannello riservato al Dirigente dell'istituto."))}
      </div>
    )
  }

  const full = panel.used_slots >= panel.max_teachers
  const valid = form.first_name.trim() && form.last_name.trim() && /\S+@\S+\.\S+/.test(form.email)

  const downloadNotice = () => {
    if (!notice) return
    const blob = new Blob([`<!doctype html><meta charset="utf-8"><title>${notice.title}</title><body style="font-family:sans-serif;max-width:720px;margin:2rem auto;line-height:1.5">${notice.html}</body>`], { type: 'text/html' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `informativa-famiglie-${panel.school.mechanographic_code || 'istituto'}.html`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900 text-white"><Building2 className="h-5 w-5" /></div>
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-slate-900">{panel.school.name}</h1>
          <p className="text-sm text-slate-500">
            {panel.school.mechanographic_code
              ? <>{tl("Codice meccanografico")} <span className="font-mono font-semibold">{panel.school.mechanographic_code}</span>
                  {panel.school.registry_verified && <span className="ml-2 inline-flex items-center gap-1 text-emerald-600"><CheckCircle2 className="h-3.5 w-3.5" />{tl("verificato MIM")}</span>}</>
              : tl("Codice meccanografico non ancora associato")}
          </p>
        </div>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900"><Users className="h-4 w-4" /> {tl("Docenti della sperimentazione")}</h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${full ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-700'}`}>
            {panel.used_slots} / {panel.max_teachers}
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end">
          <div><Label className="mb-1 block text-xs text-slate-500">{tl("Nome")}</Label>
            <Input value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} disabled={full} /></div>
          <div><Label className="mb-1 block text-xs text-slate-500">{tl("Cognome")}</Label>
            <Input value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} disabled={full} /></div>
          <div><Label className="mb-1 block text-xs text-slate-500">E-mail</Label>
            <Input type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} disabled={full} /></div>
          <Button onClick={() => invite.mutate()} disabled={!valid || full || invite.isPending} className="bg-pink-500 text-white hover:bg-pink-600">
            {invite.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserPlus className="mr-2 h-4 w-4" />}{tl("Invita")}
          </Button>
        </div>
        {full && <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700"><AlertTriangle className="h-3.5 w-3.5" />{tl("Limite raggiunto: disattiva un docente per liberare uno slot.")}</p>}

        <ul className="mt-5 divide-y divide-slate-100">
          {panel.teachers.length === 0 && <li className="py-6 text-center text-sm text-slate-400">{tl("Nessun docente invitato.")}</li>}
          {panel.teachers.map((t) => {
            const st = STATE_LABEL[t.state]
            return (
              <li key={t.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900">{[t.first_name, t.last_name].filter(Boolean).join(' ') || t.email}</p>
                  <p className="flex items-center gap-1 truncate text-xs text-slate-500"><Mail className="h-3 w-3" />{t.email}</p>
                  {t.invite_email && t.state !== 'ACTIVE' && <p className={`mt-0.5 text-[11px] ${t.invite_email.status === 'FAILED' ? 'text-red-600' : 'text-slate-500'}`}>
                    {t.invite_email.status === 'FAILED' ? tl("E-mail d'invito non partita: usa «Reinvia» per riprovare o copiare il link.")
                      : t.invite_email.status === 'SENT' ? tl("E-mail inviata il {0}{1}", new Date(t.invite_email.sent_at!).toLocaleDateString('it-IT'), t.invite_email.opened_at ? ' · letta' : '') : tl("E-mail non ancora inviata")}
                  </p>}
                </div>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cls}`}>{st.label}</span>
                {(t.state === 'INVITED' || t.state === 'EXPIRED') && (
                  <Button size="sm" variant="outline" onClick={() => resend.mutate(t.id)} disabled={resend.isPending}>
                    <Send className="mr-1.5 h-3.5 w-3.5" />{tl("Reinvia")}
                  </Button>
                )}
                {t.state !== 'DEACTIVATED' && (
                  <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-700"
                    onClick={() => { if (window.confirm(tl("Disattivare {0}? Lo slot tornerà disponibile.", t.email))) remove.mutate(t.id) }}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
        <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {tl("Ogni docente riceve una e-mail, sceglie la password e accetta le condizioni d'uso e la dichiarazione d'uso del docente.")}
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900"><FileText className="h-4 w-4" /> {tl("Informativa per le famiglie")}</h2>
        <p className="mt-1 text-sm text-slate-600">
          {tl("Bozza dell'informativa sull'uso della piattaforma con i minori (rischi, privacy, titolare e responsabile). Completa le parti tra parentesi quadre e fai verificare il testo dal tuo DPO prima di distribuirla.")}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowNotice((v) => !v)}>{showNotice ? tl("Nascondi anteprima") : tl("Mostra anteprima")}</Button>
          <Button variant="outline" size="sm" disabled={!notice} onClick={() => {
            if (notice) navigator.clipboard.writeText(htmlToText(notice.html)).then(() => toast({ title: tl("Testo copiato") }))
          }}><Copy className="mr-1.5 h-3.5 w-3.5" />{tl("Copia testo")}</Button>
          <Button variant="outline" size="sm" disabled={!notice} onClick={downloadNotice}><Download className="mr-1.5 h-3.5 w-3.5" />{tl("Scarica HTML")}</Button>
        </div>
        {showNotice && notice && (
          <article
            className="mt-4 max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200 p-4 text-sm [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:mb-1 [&_p]:my-2 [&_ul]:ml-5 [&_ul]:list-disc"
            dangerouslySetInnerHTML={{ __html: notice.html }}
          />
        )}
      </section>
    </div>
  )
}
