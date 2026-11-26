import { useEffect, useState, type ReactNode } from 'react'
import QRCode from 'qrcode'
import { Check, Copy, Download, ExternalLink, Globe, Loader2, RefreshCw, Users } from '@/components/icons'
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/design'
import { tl } from '@/i18n/tl'

/**
 * Shared sharing UI (3D Lab, Dataflow workflows, …): a dialog with a «Classi» panel and a «Link diretto» panel
 * (switch, QR code, copy / open / download / new link). Each tool plugs in its own data and wording.
 */

export function ShareDialogShell({ kicker, title, description, onClose, loading, error, children }: {
  kicker: string
  title: string
  description: string
  onClose: () => void
  loading?: boolean
  error?: string | null
  children: ReactNode
}) {
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent size="lg" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <p className="text-[11px] font-semibold text-[var(--app-accent-text)]">{kicker}</p>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--text-secondary)]">
            {error ?? <><Loader2 className="h-4 w-4 animate-spin" /> {tl("Carico…")}</>}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {children}
            {error && <p className="text-xs font-semibold text-rose-600 md:col-span-2">{error}</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function SharePanel({ icon, title, action, description, children }: { icon: ReactNode; title: string; action?: ReactNode; description?: string; children?: ReactNode }) {
  return (
    <section className="rounded-2xl bg-[var(--ds-well)] p-4">
      <div className="flex min-h-8 items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]"><span className="text-[var(--app-accent-text)] [&_svg]:h-4 [&_svg]:w-4">{icon}</span> {title}</p>
        {action}
      </div>
      {description && <p className="mt-1 text-[11px] leading-4 text-[var(--text-secondary)]">{description}</p>}
      {children}
    </section>
  )
}

export function ShareChoiceRow({ on, label, hint, disabled, onClick }: { on: boolean; label: string; hint?: string | null; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={on}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-xs font-semibold transition ${on ? 'ds-accent-selected' : 'ds-well-tile text-[var(--text-primary)]'}`}
    >
      <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-current' : 'border-[var(--text-secondary)]/50'}`}>{on && <Check className="h-3 w-3" />}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-[10px] font-semibold opacity-70">{hint}</span>}
    </button>
  )
}

export function ShareClassesPanel({ classes, selected, onToggle, busy, loading, description, children }: {
  classes: { id: string; name: string; school_grade?: string | null }[] | undefined
  selected: string[]
  onToggle: (id: string) => void
  busy?: boolean
  loading?: boolean
  description: string
  children?: ReactNode
}) {
  return (
    <SharePanel icon={<Users />} title={tl("Classi")} description={description}>
      <div className="mt-3 space-y-1.5">
        {loading && <p className="text-xs text-[var(--text-secondary)]">{tl("Carico le classi…")}</p>}
        {classes?.length === 0 && <p className="text-xs text-[var(--text-secondary)]">{tl("Non hai classi attive.")}</p>}
        {classes?.map(c => <ShareChoiceRow key={c.id} on={selected.includes(c.id)} label={c.name} hint={c.school_grade} disabled={busy} onClick={() => onToggle(c.id)} />)}
      </div>
      {children}
    </SharePanel>
  )
}

export function ShareLinkPanel({ enabled, onToggle, busy, url, description, fileBase, qrAlt, onRegenerate, children }: {
  enabled: boolean
  onToggle: () => void
  busy?: boolean
  url: string
  description: string
  fileBase: string
  qrAlt: string
  onRegenerate: () => void
  /** Tool-specific options shown above the QR code (e.g. «Il QR apre la realtà aumentata»). */
  children?: ReactNode
}) {
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!url) { setQr(''); return }
    QRCode.toDataURL(url, { width: 640, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#171717', light: '#ffffff' } }).then(setQr).catch(() => setQr(''))
  }, [url])
  const copy = async () => { await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }
  const downloadQr = () => {
    const a = document.createElement('a')
    a.href = qr
    a.download = `qr-${fileBase.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'condivisione'}.png`
    a.click()
  }
  return (
    <SharePanel
      icon={<Globe />}
      title={tl("Link diretto")}
      description={description}
      action={
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={tl("Link diretto")}
          disabled={busy}
          onClick={onToggle}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${enabled ? 'bg-[var(--app-accent)]' : 'bg-[var(--text-secondary)]/35'}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      }
    >
      {enabled && url && (
        <div className="mt-3 space-y-3">
          {children}
          <div className="mx-auto w-44 rounded-2xl bg-white p-2">
            {qr ? <img src={qr} alt={qrAlt} className="aspect-square w-full" /> : <div className="flex aspect-square items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>}
          </div>
          <div className="ds-field flex items-center gap-1 px-3 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--text-primary)]">{url}</span>
            <button type="button" title={tl("Copia link")} onClick={() => void copy()} className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--ds-control-hover)]">{copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}</button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button onClick={() => window.open(url, '_blank', 'noreferrer')} tone="neutral" surface="outline" density="compact" className="rounded-full"><ExternalLink className="h-3.5 w-3.5" /> {tl("Apri")}</Button>
            <Button onClick={downloadQr} disabled={!qr} tone="neutral" surface="outline" density="compact" className="rounded-full"><Download className="h-3.5 w-3.5" /> QR PNG</Button>
            <Button onClick={() => { if (window.confirm(tl("Il link attuale smetterà di funzionare. Continuare?"))) onRegenerate() }} disabled={busy} tone="neutral" surface="outline" density="compact" className="rounded-full"><RefreshCw className="h-3.5 w-3.5" /> {tl("Nuovo link")}</Button>
          </div>
        </div>
      )}
    </SharePanel>
  )
}
