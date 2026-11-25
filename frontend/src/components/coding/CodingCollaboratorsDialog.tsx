import { useEffect, useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/design'
import { SearchPill } from '@/design/primitives/SearchPill'
import { Loader2 } from '@/components/icons'
import { codingApi } from '@/lib/api'
import { tl } from '@/i18n/tl'

type Candidate = { id: string; name: string }

/** Owner picks classmates by name to invite as collaborators of a Vibe Lab project. */
export function CodingCollaboratorsDialog({ open, projectId, onClose, onSaved }: {
  open: boolean
  projectId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [selected, setSelected] = useState<Record<string, 'invited' | 'active' | 'new'>>({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setSearch('')
    codingApi.listCollaborators(projectId)
      .then((response) => {
        if (cancelled) return
        setCandidates(response.data.candidates || [])
        const next: Record<string, 'invited' | 'active' | 'new'> = {}
        for (const item of response.data.collaborators || []) next[item.id] = item.status
        setSelected(next)
      })
      .catch((err) => { if (!cancelled) setError(err?.response?.data?.detail || tl("Impossibile caricare i compagni.")) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, projectId])

  const query = search.trim().toLocaleLowerCase('it')
  const visible = query ? candidates.filter((c) => c.name.toLocaleLowerCase('it').includes(query)) : candidates

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      await codingApi.replaceCollaborators(projectId, Object.keys(selected))
      onSaved()
      onClose()
    } catch (err: any) {
      setError(err?.response?.data?.detail || tl("Impossibile salvare i collaboratori."))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{tl("Collabora con i compagni")}</DialogTitle>
          <DialogDescription>
            {tl("Scegli chi invitare. Ricevono una notifica, entrano nel progetto e lavorano su una loro copia di lavoro. Le loro modifiche arrivano nel progetto principale solo se le accetti tu.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <SearchPill value={search} onValueChange={setSearch} placeholder={tl("Cerca un compagno")} aria-label={tl("Cerca un compagno")} className="w-full" />
          <div className="ds-well max-h-64 space-y-1 overflow-y-auto p-1">
            {loading ? (
              <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-[var(--app-accent)]" /></div>
            ) : visible.length === 0 ? (
              <p className="px-2 py-4 text-xs text-[var(--text-secondary)]">{candidates.length === 0 ? tl("Nessun altro compagno in questa sessione.") : tl("Nessun risultato.")}</p>
            ) : visible.map((person) => {
              const state = selected[person.id]
              return (
                <label key={person.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--ds-surface-muted)]">
                  <input
                    type="checkbox"
                    checked={Boolean(state)}
                    onChange={(event) => setSelected((prev) => {
                      const next = { ...prev }
                      if (event.target.checked) next[person.id] = 'new'
                      else delete next[person.id]
                      return next
                    })}
                  />
                  <span className="min-w-0 flex-1 truncate font-semibold">{person.name}</span>
                  {state === 'invited' && <span className="text-xs text-[var(--text-secondary)]">{tl("Invitato")}</span>}
                  {state === 'active' && <span className="text-xs text-[var(--text-secondary)]">{tl("Collabora")}</span>}
                </label>
              )
            })}
          </div>
          {error && <p className="text-xs font-semibold text-[var(--logo-pink)]">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{tl("Annulla")}</Button>
          <Button type="button" tone="accent" surface="solid" onClick={() => void save()} disabled={saving || loading}>
            {saving ? <Loader2 className="animate-spin" /> : null} {tl("Invita")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Shown to an invited student when they open the project card marked «Invito». */
export function CodingInviteDialog({ open, title, owner, busy, onAnswer, onClose }: {
  open: boolean
  title: string
  owner: string
  busy: boolean
  onAnswer: (decision: 'accept' | 'decline') => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{tl("Invito a collaborare")}</DialogTitle>
          <DialogDescription>
            {tl("{0} ti ha invitato a lavorare sul progetto «{1}». Se accetti, il progetto compare nella tua libreria con l'etichetta Collaboratore.", owner, title)}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onAnswer('decline')} disabled={busy}>{tl("Rifiuta")}</Button>
          <Button type="button" tone="accent" surface="solid" onClick={() => onAnswer('accept')} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : null} {tl("Accetta invito")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
