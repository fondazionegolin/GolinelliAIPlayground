import { useEffect, useState } from 'react'
import { Loader2 } from '@/components/icons'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/design'
import { tl } from '@/i18n/tl'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 1-based position the slide will take. */
  position: number
  total: number
  themed: boolean
  busy: boolean
  onCreate: (description: string) => void
}

/** «Nuova slide»: where it goes and, optionally, a short description of what it should contain. */
export function NewSlideDialog({ open, onOpenChange, position, total, themed, busy, onCreate }: Props) {
  const [description, setDescription] = useState('')
  useEffect(() => { if (open) setDescription('') }, [open])
  const submit = () => { if (!busy) onCreate(description.trim()) }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next) }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{tl("Nuova slide")}</DialogTitle>
          <DialogDescription>
            {position > total ? tl("Sarà aggiunta in fondo, come slide {0}.", position) : tl("Sarà inserita come slide {0}, prima di quella attuale.", position)}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor="new-slide-description" className="text-sm font-semibold">{tl("Cosa deve contenere? (facoltativo)")}</label>
          <Textarea
            id="new-slide-description"
            autoFocus
            rows={4}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit() } }}
            placeholder={tl("Es. «Tre rischi dell'uso dell'AI in classe, con un esempio per ciascuno»")}
          />
          <p className="text-xs text-[var(--text-secondary)]">
            {themed
              ? tl("La slide usa lo stesso tema delle altre. Senza descrizione resta vuota, pronta da compilare.")
              : tl("Questa presentazione non ha un tema: la slide sarà vuota, con lo stesso sfondo della precedente.")}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>{tl("Annulla")}</Button>
          <Button type="button" disabled={busy} onClick={submit}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {description.trim() && themed ? tl("Crea e scrivi") : tl("Crea slide")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
