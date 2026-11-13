import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { Check, Copy, Download, ExternalLink, Globe, Loader2, RefreshCw, Users } from '@/components/icons'
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/design'
import { tl } from '@/i18n/tl'
import { agenticSharingApi, type WorkflowShareState } from '@/lib/api'

const detail = (e: unknown) => (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail

/** Who can run this workflow: whole classes, single sessions, and anyone with the link or QR code. */
export default function WorkflowShareDialog({ workflowId, title, onClose }: { workflowId: string; title: string; onClose: () => void }) {
  const [share, setShare] = useState<WorkflowShareState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)

  const targets = useQuery({ queryKey: ['workflow-share-targets'], queryFn: async () => (await agenticSharingApi.targets()).data })
  useEffect(() => {
    agenticSharingApi.getShare(workflowId).then((r) => setShare(r.data)).catch((e) => setError(detail(e) || tl("Impossibile caricare la condivisione")))
  }, [workflowId])

  const publicUrl = share?.public_enabled && share.public_token ? `${window.location.origin}/dataflow/${share.public_token}` : ''
  useEffect(() => {
    if (!publicUrl) { setQr(''); return }
    QRCode.toDataURL(publicUrl, { width: 640, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#171717', light: '#ffffff' } }).then(setQr).catch(() => setQr(''))
  }, [publicUrl])

  const update = async (data: Parameters<typeof agenticSharingApi.updateShare>[1]) => {
    setBusy(true); setError(null)
    try { setShare((await agenticSharingApi.updateShare(workflowId, data)).data) }
    catch (e) { setError(detail(e) || tl("Condivisione non riuscita")) }
    finally { setBusy(false) }
  }
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id])

  const sessionsByClass = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof targets.data>['sessions']>()
    for (const session of targets.data?.sessions ?? []) groups.set(session.class_name, [...(groups.get(session.class_name) ?? []), session])
    return [...groups.entries()]
  }, [targets.data])

  const copy = async () => { await navigator.clipboard.writeText(publicUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }
  const downloadQr = () => {
    const a = document.createElement('a')
    a.href = qr
    a.download = `qr-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'workflow'}.png`
    a.click()
  }

  const row = (on: boolean, label: string, hint: string | undefined, onClick: () => void) => (
    <button key={label + hint} type="button" disabled={busy} onClick={onClick} aria-pressed={on}
      className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-bold transition ${on ? 'bg-violet-100 text-violet-900' : 'bg-[var(--surface-muted)] text-[var(--text-primary)] hover:bg-[var(--surface-base)]'}`}>
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-violet-600 bg-violet-600 text-white' : 'border-slate-300'}`}>{on && <Check className="h-3 w-3" />}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[10px] font-semibold text-[var(--text-secondary)]">{hint}</span>}
    </button>
  )

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tl("Condividi workflow")} · {title}</DialogTitle>
          <DialogDescription>{tl("Chi lo riceve lo esegue come un'app (o ci chatta, se è un chatbot) senza poterlo modificare. I workflow che leggono i tuoi file o dataset privati non si possono condividere.")}</DialogDescription>
        </DialogHeader>

        {!share ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--text-secondary)]">{error ?? <><Loader2 className="h-4 w-4 animate-spin" /> {tl("Carico…")}</>}</div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            <section className="space-y-3">
              <p className="flex items-center gap-2 text-sm font-black text-[var(--text-primary)]"><Users className="h-4 w-4 text-sky-600" /> {tl("Classi e sessioni")}</p>
              <p className="text-[11px] leading-4 text-[var(--text-secondary)]">{tl("Gli studenti li trovano in «Workflow condivisi». Le AI che usano sono a carico del loro limite di sessione.")}</p>
              {targets.isLoading && <p className="text-xs text-[var(--text-secondary)]">{tl("Carico le classi…")}</p>}
              {targets.data?.classes.length === 0 && <p className="text-xs text-[var(--text-secondary)]">{tl("Non hai classi attive.")}</p>}
              <div className="space-y-1.5">
                <p className="text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]">{tl("Tutta la classe")}</p>
                {targets.data?.classes.map((c) => row(share.shared_class_ids.includes(c.id), c.name, c.school_grade ?? undefined, () => update({ class_ids: toggle(share.shared_class_ids, c.id) })))}
              </div>
              {sessionsByClass.length > 0 && (
                <div className="max-h-52 space-y-2 overflow-y-auto pr-1">
                  <p className="text-[10px] font-black uppercase tracking-wider text-[var(--text-secondary)]">{tl("Solo una sessione")}</p>
                  {sessionsByClass.map(([className, sessions]) => (
                    <div key={className} className="space-y-1">
                      <p className="text-[10px] font-bold text-[var(--text-secondary)]">{className}</p>
                      {sessions.map((s) => row(share.shared_session_ids.includes(s.id), s.title, undefined, () => update({ session_ids: toggle(share.shared_session_ids, s.id) })))}
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-black text-[var(--text-primary)]"><Globe className="h-4 w-4 text-violet-600" /> {tl("Link diretto")}</p>
                <Button onClick={() => update({ public_enabled: !share.public_enabled })} disabled={busy} aria-pressed={share.public_enabled}
                  tone={share.public_enabled ? 'accent' : 'neutral'} surface={share.public_enabled ? 'solid' : 'outline'} density="compact" className="rounded-full">
                  {share.public_enabled ? tl("Attivo") : tl("Disattivo")}
                </Button>
              </div>
              <p className="text-[11px] leading-4 text-[var(--text-secondary)]">{tl("Chiunque abbia il link o inquadri il QR lo usa, senza account. Le AI usate sono a carico dei tuoi crediti: le richieste per link sono limitate.")}</p>
              {publicUrl && (
                <div className="space-y-3">
                  <div className="mx-auto w-44 rounded-xl bg-white p-2">
                    {qr ? <img src={qr} alt={tl("QR code del workflow")} className="aspect-square w-full" /> : <div className="flex aspect-square items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>}
                  </div>
                  <div className="flex items-center gap-1 rounded-xl bg-[var(--surface-muted)] px-3 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-primary)]">{publicUrl}</span>
                    <button type="button" title={tl("Copia link")} onClick={copy} className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--surface-base)]">{copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button onClick={() => window.open(publicUrl, '_blank', 'noreferrer')} tone="neutral" surface="outline" density="compact" className="rounded-full"><ExternalLink className="h-3.5 w-3.5" /> {tl("Apri")}</Button>
                    <Button onClick={downloadQr} disabled={!qr} tone="neutral" surface="outline" density="compact" className="rounded-full"><Download className="h-3.5 w-3.5" /> QR PNG</Button>
                    <Button onClick={() => { if (window.confirm(tl("Il link attuale smetterà di funzionare. Continuare?"))) update({ regenerate_token: true }) }} disabled={busy} tone="neutral" surface="outline" density="compact" className="rounded-full"><RefreshCw className="h-3.5 w-3.5" /> {tl("Nuovo link")}</Button>
                  </div>
                </div>
              )}
            </section>
            {error && <p className="text-xs font-semibold text-rose-600 md:col-span-2">{error}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
