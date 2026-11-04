import { useEffect, useState } from 'react'
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/design'
import { driveApi, type DriveShareTarget } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { tl } from '@/i18n/tl'

export function AudioShareDialog({ itemId, title, onClose }: { itemId: string; title: string; onClose: () => void }) {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [shares, setShares] = useState<DriveShareTarget[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [saving, setSaving] = useState(false)
  const { toast } = useToast()
  useEffect(() => {
    let active = true
    Promise.all([driveApi.shareTargets(), driveApi.getShares(itemId)]).then(([targets, existing]) => {
      if (!active) return
      setClasses(targets.data.classes); setShares(existing.data.shares)
      setSelected(existing.data.shares.filter((v: DriveShareTarget) => v.target_type === 'class').map((v: DriveShareTarget) => v.target_id!))
    }).catch(() => { if (active) setError(true) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [itemId])
  const save = async () => {
    setSaving(true)
    try {
      // Preserve colleague/session grants and class grants outside the displayed choices.
      const classIds = new Set(classes.map((v) => v.id))
      const preserved = shares.filter((v) => v.target_type !== 'class' || !classIds.has(v.target_id || ''))
      const wanted: DriveShareTarget[] = selected.filter((id) => classIds.has(id)).map((id) => shares.find((v) => v.target_type === 'class' && v.target_id === id) || { target_type: 'class', target_id: id, role: 'viewer' })
      await driveApi.putShares(itemId, [...preserved, ...wanted])
      toast({ title: tl('Condivisione aggiornata'), description: tl('Gli studenti trovano gli audio nei Files condivisi: possono ascoltarli e scaricarli.') }); onClose()
    } catch { toast({ title: tl('Condivisione non salvata'), variant: 'destructive' }) }
    finally { setSaving(false) }
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose() }}><DialogContent size="sm">
    <DialogHeader><DialogTitle>{tl('Condividi con la classe')}</DialogTitle></DialogHeader>
    <DialogBody className="space-y-4"><p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="text-xs text-[var(--text-secondary)]">{tl('Le classi selezionate possono ascoltare e scaricare. Le playlist condivise includono anche le tracce che aggiungerai in seguito.')}</p>
      {loading ? <p role="status">{tl('Caricamento classi…')}</p> : error ? <p role="alert">{tl('Impossibile caricare i permessi. Chiudi e riprova.')}</p> : classes.length ? <div className="max-h-64 space-y-2 overflow-auto">{classes.map((cls) => <label key={cls.id} className="ds-control flex cursor-pointer items-center gap-3 rounded-[var(--control-radius)] p-3 text-sm text-[var(--text-primary)]">
        <input type="checkbox" className="voice-lab-check" checked={selected.includes(cls.id)} onChange={(e) => setSelected((v) => e.target.checked ? [...v, cls.id] : v.filter((id) => id !== cls.id))} />{cls.name}
      </label>)}</div> : <p className="text-sm">{tl('Non hai ancora classi disponibili.')}</p>}
    </DialogBody><DialogFooter><Button tone="neutral" surface="ghost" disabled={saving} onClick={onClose}>{tl('Annulla')}</Button><Button disabled={loading || error || saving} onClick={() => void save()}>{tl('Salva condivisione')}</Button></DialogFooter>
  </DialogContent></Dialog>
}
