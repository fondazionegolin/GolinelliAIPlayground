import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/design/primitives/Dialog'
import { Input } from '@/design/primitives/Input'
import { Button } from '@/design'
import { AlertCircle, Check, Loader2, Wand2 } from '@/components/icons'
import { codingApi } from '@/lib/api'
import { tl } from '@/i18n/tl'

type ChecklistItem = { id: string; text: string; status: 'done' | 'partial' | 'missing'; why?: string }
type GeneratedFileLike = { path: string; content: string; language?: string }

// «Rifinisci»: the spec's functions as a checklist with their state in the current code; «Vai!» closes one item,
// the footer button runs the whole review (optionally steered by a free-text focus).
export default function RefineDialog({ open, projectId, files, onClose, onGo }: {
  open: boolean
  projectId: string
  files: GeneratedFileLike[]
  onClose: () => void
  onGo: (focus: string) => void
}) {
  const [items, setItems] = useState<ChecklistItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [focus, setFocus] = useState('')

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setItems(null); setFailed(false); setLoading(true)
    codingApi.refineChecklist(projectId, files.map((f) => ({ path: f.path, content: f.content })))
      .then((res) => { if (!cancelled) setItems((res.data?.items || []) as ChecklistItem[]) })
      .catch(() => { if (!cancelled) setFailed(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, projectId])

  const todo = (items || []).filter((item) => item.status !== 'done')
  const done = (items || []).length - todo.length
  const go = (text: string) => { onGo(text); setFocus('') }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent size="md" surface="base" className="max-h-[88vh] overflow-hidden !grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle>{tl("Rifinisci il progetto")}</DialogTitle>
          <DialogDescription>
            {tl("Ecco cosa prevede la specifica e a che punto è. Scegli un obiettivo e premi Vai!, oppure rifinisci tutto: provo l'app in un browser vero e correggo i difetti. La versione attuale resta salvata.")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto pr-1">
          {loading && (
            <p className="flex items-center gap-2 py-6 text-sm text-[var(--text-secondary)]"><Loader2 className="h-4 w-4 animate-spin" />{tl("Controllo a che punto è il progetto...")}</p>
          )}
          {failed && <p className="py-4 text-sm text-[var(--text-secondary)]">{tl("Non riesco a calcolare la checklist ora: puoi comunque rifinire tutto il progetto.")}</p>}
          {items && items.length === 0 && <p className="py-4 text-sm text-[var(--text-secondary)]">{tl("La specifica non elenca funzioni da controllare.")}</p>}
          {items && items.length > 0 && (
            <>
              <p className="mb-2 text-xs font-bold text-[var(--text-secondary)]">{done}/{items.length} {tl("obiettivi completati")}</p>
              <ul className="space-y-2">
                {items.map((item) => {
                  const complete = item.status === 'done'
                  return (
                    <li key={item.id} className="flex items-center gap-3 rounded-xl bg-[var(--ds-surface-muted)] px-3 py-2.5">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${complete ? 'bg-emerald-500 text-white' : item.status === 'partial' ? 'bg-amber-400 text-white' : 'bg-rose-500 text-white'}`}>
                        {complete ? <Check className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={`text-sm font-semibold leading-snug ${complete ? 'text-[var(--text-secondary)]' : 'text-[var(--text-primary)]'}`}>
                          <span className="mr-1.5 text-[11px] font-black text-[var(--text-secondary)]">{item.id}</span>{item.text}
                        </p>
                        {!complete && (
                          <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                            {item.status === 'partial' ? tl("Incompleto") : tl("Mancante")}{item.why ? ` · ${item.why}` : ''}
                          </p>
                        )}
                      </div>
                      {!complete && (
                        <Button type="button" size="sm" tone="accent" surface="solid" onClick={() => go(`Funzioni da completare: ${item.id}`)}>{tl("Vai!")}</Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>

        <DialogFooter className="!flex-col !items-stretch gap-2">
          <Input value={focus} onChange={(event) => setFocus(event.target.value)} placeholder={tl("Oppure scrivi su cosa concentrarti, es. più bello su telefono")} maxLength={300} aria-label={tl("Su cosa vuoi che mi concentri?")} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>{tl("Chiudi")}</Button>
            {todo.length > 1 && !focus.trim() && (
              <Button type="button" variant="outline" onClick={() => go(`Funzioni da completare: ${todo.map((i) => i.id).join(', ')}`)}>{tl("Completa tutte le mancanti")}</Button>
            )}
            <Button type="button" tone="accent" surface="solid" onClick={() => go(focus.trim())}><Wand2 className="h-4 w-4" /> {focus.trim() ? tl("Vai con questa richiesta") : tl("Rifinisci tutto")}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
