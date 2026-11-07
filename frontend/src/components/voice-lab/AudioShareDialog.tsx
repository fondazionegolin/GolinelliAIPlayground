import { useEffect, useState } from 'react'
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/design'
import { driveApi, type DriveShareTarget } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { tl } from '@/i18n/tl'

type ShareSession = { id: string; name: string; class_id: string }

/** Audio is shared with individual sessions, never with a whole class. */
export function AudioShareDialog({ itemId, title, onClose }: { itemId: string; title: string; onClose: () => void }) {
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([])
  const [sessions, setSessions] = useState<ShareSession[]>([])
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
      setClasses(targets.data.classes); setSessions(targets.data.sessions || []); setShares(existing.data.shares)
      setSelected(existing.data.shares.filter((v: DriveShareTarget) => v.target_type === 'session').map((v: DriveShareTarget) => v.target_id!))
    }).catch(() => { if (active) setError(true) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [itemId])
  const save = async () => {
    setSaving(true)
    try {
      // Keep colleague grants and sessions outside the displayed choices; whole-class grants are dropped.
      const sessionIds = new Set(sessions.map((v) => v.id))
      const preserved = shares.filter((v) => v.target_type === 'teacher' || (v.target_type === 'session' && !sessionIds.has(v.target_id || '')))
      const wanted: DriveShareTarget[] = selected.filter((id) => sessionIds.has(id)).map((id) => shares.find((v) => v.target_type === 'session' && v.target_id === id) || { target_type: 'session', target_id: id, role: 'viewer' })
      await driveApi.putShares(itemId, [...preserved, ...wanted])
      toast({ title: tl('Condivisione aggiornata'), description: tl('Gli studenti delle sessioni scelte trovano gli audio nei Files condivisi: possono ascoltarli e scaricarli.') }); onClose()
    } catch { toast({ title: tl('Condivisione non salvata'), variant: 'destructive' }) }
    finally { setSaving(false) }
  }
  const label = (session: ShareSession) => { const cls = classes.find((v) => v.id === session.class_id); return cls ? `${cls.name} · ${session.name}` : session.name }
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose() }}><DialogContent size="sm">
    <DialogHeader><DialogTitle>{tl('Condividi con una sessione')}</DialogTitle></DialogHeader>
    <DialogBody className="space-y-4"><p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="text-xs text-[var(--text-secondary)]">{tl('Le sessioni selezionate possono ascoltare e scaricare. Le playlist condivise includono anche le tracce che aggiungerai in seguito. Non è possibile condividere con un’intera classe.')}</p>
      {loading ? <p role="status">{tl('Caricamento sessioni…')}</p> : error ? <p role="alert">{tl('Impossibile caricare i permessi. Chiudi e riprova.')}</p> : sessions.length ? <div className="max-h-64 space-y-2 overflow-auto">{sessions.map((session) => <label key={session.id} className="ds-control flex cursor-pointer items-center gap-3 rounded-[var(--control-radius)] p-3 text-sm text-[var(--text-primary)]">
        <input type="checkbox" className="voice-lab-check" checked={selected.includes(session.id)} onChange={(e) => setSelected((v) => e.target.checked ? [...v, session.id] : v.filter((id) => id !== session.id))} />{label(session)}
      </label>)}</div> : <p className="text-sm">{tl('Non hai ancora sessioni disponibili.')}</p>}
    </DialogBody><DialogFooter><Button tone="neutral" surface="ghost" disabled={saving} onClick={onClose}>{tl('Annulla')}</Button><Button disabled={loading || error || saving} onClick={() => void save()}>{tl('Salva condivisione')}</Button></DialogFooter>
  </DialogContent></Dialog>
}
