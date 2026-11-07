import { useEffect, useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input } from '@/design'
import { Loader2 } from '@/components/icons'
import { AdminBadge } from '@/components/admin/AdminUI'
import type { LicenseChange } from '@/lib/api'
import { tl } from '@/i18n/tl'

export interface LicenseInfo { own?: LicenseInfo; expires_at: string | null; auto_renew: boolean; state: 'none' | 'active' | 'expiring' | 'expired'; term_months?: number; source?: 'user' | 'school' | null }

const MODES = [
  { id: 'date', label: 'Scadenza fissa', hint: 'La licenza termina alla data scelta e non si rinnova da sola.' },
  { id: 'extend', label: 'Estendi', hint: 'Aggiunge mesi alla scadenza attuale (o a oggi, se già scaduta).' },
  { id: 'renew', label: '12 mesi con rinnovo', hint: 'Riparte da oggi per 12 mesi e si rinnova automaticamente ogni anno.' },
  { id: 'none', label: 'Nessuna scadenza', hint: 'La licenza non scade.' },
] as const

export const licenseDate = (value?: string | null) => value ? new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit' }).format(new Date(value)) : '—'

export function LicenseBadge({ license, compact = false }: { license?: LicenseInfo | null; compact?: boolean }) {
  if (!license || license.state === 'none') return <span className="text-xs text-slate-400">{tl('Nessuna scadenza')}</span>
  const tone = license.state === 'expired' ? 'danger' : license.state === 'expiring' ? 'warning' : 'success'
  const label = license.state === 'expired' ? tl('Scaduta') : licenseDate(license.expires_at)
  const sub = license.source === 'school' ? tl('Dall’istituto') : license.auto_renew ? tl('Rinnovo automatico') : tl('Scadenza fissa')
  return <span className="inline-flex flex-col items-start leading-tight">
    <AdminBadge tone={tone} title={license.expires_at ? new Date(license.expires_at).toLocaleString('it-IT') : undefined}>{license.state === 'expired' ? `${label} · ${licenseDate(license.expires_at)}` : label}</AdminBadge>
    {!compact && <span className="mt-0.5 text-[10px] text-slate-500">{sub}</span>}
  </span>
}

/** Set the licence term of one or many accounts/schools. */
export function LicenseDialog({ open, title, subtitle, current, pending, onClose, onSubmit }: {
  open: boolean; title: string; subtitle?: string; current?: LicenseInfo | null; pending?: boolean
  onClose: () => void; onSubmit: (change: LicenseChange) => void
}) {
  const [mode, setMode] = useState<LicenseChange['mode']>('date')
  const [date, setDate] = useState('')
  const [months, setMonths] = useState(12)
  useEffect(() => { if (open) { setMode(current?.auto_renew === false && current?.expires_at ? 'date' : 'renew'); setDate(current?.expires_at ? current.expires_at.slice(0, 10) : ''); setMonths(12) } }, [open, current])
  const valid = mode === 'date' ? !!date : mode === 'extend' ? months >= 1 && months <= 120 : true
  const submit = () => onSubmit(mode === 'date' ? { mode, expires_on: date } : mode === 'extend' ? { mode, months } : { mode })
  return <Dialog open={open} onOpenChange={value => { if (!value && !pending) onClose() }}>
    <DialogContent size="md" className="text-[var(--text-primary)]">
      <DialogHeader><DialogTitle>{title}</DialogTitle>{subtitle && <DialogDescription>{subtitle}</DialogDescription>}</DialogHeader>
      {current && <p className="text-sm text-[var(--text-secondary)]">{tl('Attuale')}: <LicenseBadge license={current} compact /></p>}
      <div role="radiogroup" aria-label={tl('Tipo di scadenza')} className="grid grid-cols-2 gap-2">
        {MODES.map(m => <Button key={m.id} tone="neutral" surface="ghost" role="radio" aria-checked={mode === m.id} className={mode === m.id ? 'ds-selected' : ''} onClick={() => setMode(m.id)}>{tl(m.label)}</Button>)}
      </div>
      <p className="text-sm text-[var(--text-secondary)]">{tl(MODES.find(m => m.id === mode)!.hint)}</p>
      {mode === 'date' && <label className="block space-y-2 text-sm font-semibold">{tl('Ultimo giorno di licenza')}<Input type="date" value={date} onChange={e => setDate(e.target.value)} /></label>}
      {mode === 'extend' && <div className="space-y-2 text-sm font-semibold">{tl('Mesi da aggiungere')}
        <div className="flex flex-wrap items-center gap-2">{[3, 6, 12, 24].map(n => <Button key={n} density="compact" tone="neutral" surface="ghost" className={months === n ? 'ds-selected' : ''} onClick={() => setMonths(n)}>{n}</Button>)}
          <Input type="number" min={1} max={120} value={months} onChange={e => setMonths(Number(e.target.value))} className="w-24" aria-label={tl('Mesi da aggiungere')} /></div></div>}
      <div className="flex justify-end gap-2">
        <Button tone="neutral" surface="ghost" disabled={pending} onClick={onClose}>{tl('Annulla')}</Button>
        <Button tone="accent" surface="solid" disabled={!valid || pending} onClick={submit}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}{tl('Applica')}</Button>
      </div>
    </DialogContent>
  </Dialog>
}
