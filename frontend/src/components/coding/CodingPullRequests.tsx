import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/design'
import { Badge } from '@/design/primitives/Badge'
import { ChevronDown, ChevronRight, Loader2 } from '@/components/icons'
import { codingApi } from '@/lib/api'
import { lineDiff, diffStats, type DiffOp } from '@/components/notebook/inlineDiff'
import { tl } from '@/i18n/tl'

type FileLite = { path: string; content: string; language?: string | null }
type Change = { path: string; status: 'added' | 'modified' | 'deleted'; base: string | null; head: string | null }
type Conflict = { path: string; kind: string; base: string | null; ours: string | null; theirs: string | null }

export type PullRequest = {
  id: string
  title: string
  description: string
  status: 'open' | 'testing' | 'merged' | 'rejected' | 'closed'
  author_name: string
  has_test: boolean
  main_changed: boolean
  conflict_paths: string[]
  changed: { path: string; status: string }[]
  decision_note?: string | null
  previous_version_id?: string | null
  created_at: string
  changes?: Change[]
  conflicts?: Conflict[]
  test_files?: FileLite[] | null
}

const STATUS_LABEL: Record<PullRequest['status'], string> = {
  open: 'Da rivedere',
  testing: 'In prova',
  merged: 'Unita',
  rejected: 'Rifiutata',
  closed: 'Ritirata',
}

const FILE_STATUS: Record<string, string> = { added: 'nuovo', modified: 'modificato', deleted: 'eliminato' }

function errorText(err: any, fallback: string) {
  return err?.response?.data?.detail || fallback
}

/** Changed lines with two lines of context; unchanged stretches collapse into a gap marker. */
function DiffBlock({ before, after }: { before: string | null; after: string | null }) {
  const ops = useMemo<DiffOp[]>(() => lineDiff(before ?? '', after ?? ''), [before, after])
  const rows = useMemo(() => {
    const keep = new Array(ops.length).fill(false)
    ops.forEach((op, i) => {
      if (op.op === 'eq') return
      for (let k = Math.max(0, i - 2); k <= Math.min(ops.length - 1, i + 2); k++) keep[k] = true
    })
    const out: ({ gap: true } | (DiffOp & { gap?: false }))[] = []
    let gap = false
    ops.forEach((op, i) => {
      if (keep[i]) { out.push(op); gap = false }
      else if (!gap) { out.push({ gap: true }); gap = true }
    })
    return out
  }, [ops])
  return (
    <div className="max-h-72 overflow-auto rounded-lg bg-[var(--ds-field-bg)] py-1 font-mono text-[11px] leading-5">
      {rows.map((row, i) => 'gap' in row && row.gap ? (
        <div key={i} className="px-3 text-[var(--text-secondary)]">…</div>
      ) : (
        <div
          key={i}
          className={`whitespace-pre px-3 ${(row as DiffOp).op === 'add' ? 'bg-[rgba(34,197,94,0.16)]' : (row as DiffOp).op === 'del' ? 'bg-[rgba(239,68,68,0.16)] line-through decoration-[rgba(239,68,68,0.5)]' : ''}`}
        >
          {(row as DiffOp).op === 'add' ? '+ ' : (row as DiffOp).op === 'del' ? '− ' : '  '}{(row as DiffOp).text || ' '}
        </div>
      ))}
    </div>
  )
}

function FileChange({ change, defaultOpen }: { change: Change; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen))
  const stats = useMemo(() => diffStats(lineDiff(change.base ?? '', change.head ?? '')), [change.base, change.head])
  return (
    <div className="space-y-1.5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 text-left text-xs">
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="min-w-0 flex-1 truncate font-semibold text-[var(--text-primary)]">{change.path}</span>
        <span className="text-[var(--text-secondary)]">{tl(FILE_STATUS[change.status] || change.status)}</span>
        <span className="font-mono text-[11px] text-emerald-600">+{stats.added}</span>
        <span className="font-mono text-[11px] text-rose-600">−{stats.removed}</span>
      </button>
      {open && <DiffBlock before={change.base} after={change.head} />}
    </div>
  )
}

/** Collaborator: «Proponi le modifiche». Opens (or updates) the pull request. */
export function ProposeChangesDialog({ open, mainProjectId, onClose, onCreated }: {
  open: boolean
  mainProjectId: string
  onClose: () => void
  onCreated: (pr: PullRequest) => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (open) { setTitle(''); setDescription(''); setError(null) } }, [open])

  const send = async () => {
    setBusy(true); setError(null)
    try {
      const response = await codingApi.createPullRequest(mainProjectId, { title: title.trim(), description: description.trim() })
      onCreated(response.data as PullRequest)
      onClose()
    } catch (err) {
      setError(errorText(err, tl("Impossibile inviare la proposta.")))
    } finally { setBusy(false) }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{tl("Proponi le modifiche")}</DialogTitle>
          <DialogDescription>{tl("Chi ha creato il progetto vedrà quali righe hai cambiato e potrà provarle prima di unirle. Se ne hai già inviata una ancora aperta, viene aggiornata.")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={200}
            placeholder={tl("Cosa hai cambiato? (titolo breve)")}
            aria-label={tl("Titolo della proposta")}
            className="h-10 w-full rounded-[var(--ds-radius-control)] bg-[var(--ds-field-bg)] px-3 text-sm text-[var(--text-primary)] outline-none"
          />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            placeholder={tl("Spiega in due righe perché (facoltativo)")}
            aria-label={tl("Descrizione della proposta")}
            className="w-full resize-none rounded-[var(--ds-radius-control)] bg-[var(--ds-field-bg)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none"
          />
          {error && <p className="text-xs font-semibold text-[var(--logo-pink)]">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{tl("Annulla")}</Button>
          <Button type="button" tone="accent" surface="solid" onClick={() => void send()} disabled={busy || !title.trim()}>
            {busy ? <Loader2 className="animate-spin" /> : null} {tl("Invia la proposta")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Proposals list + review. Creator: Prova → Unisci / Rifiuta. Contributor: sees status, can withdraw. */
export function PullRequestsPanel({ open, mainProjectId, isOwner, onClose, onPreview, onMerged, onRollback }: {
  open: boolean
  mainProjectId: string
  isOwner: boolean
  onClose: () => void
  onPreview: (files: FileLite[], prId: string) => void
  onMerged: () => void
  onRollback: (versionId: string) => Promise<void>
}) {
  const [list, setList] = useState<PullRequest[]>([])
  const [detail, setDetail] = useState<PullRequest | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')

  const loadList = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const response = await codingApi.listPullRequests(mainProjectId)
      setList(response.data as PullRequest[])
    } catch (err) {
      setError(errorText(err, tl("Impossibile caricare le proposte.")))
    } finally { setLoading(false) }
  }, [mainProjectId])

  useEffect(() => { if (open) { setDetail(null); setRejecting(false); void loadList() } }, [open, loadList])

  const openDetail = async (id: string) => {
    setBusy(true); setError(null)
    try { setDetail((await codingApi.getPullRequest(mainProjectId, id)).data as PullRequest) }
    catch (err) { setError(errorText(err, tl("Impossibile aprire la proposta."))) }
    finally { setBusy(false) }
  }

  const act = async (run: () => Promise<{ data: unknown }>, after?: (pr: PullRequest) => void) => {
    setBusy(true); setError(null)
    try {
      const pr = (await run()).data as PullRequest
      setDetail(pr)
      after?.(pr)
      void loadList()
    } catch (err: any) {
      setError(errorText(err, tl("Operazione non riuscita.")))
      // a 409 after a re-test returns the refreshed state: reload it
      if (err?.response?.status === 409 && detail) {
        try { setDetail((await codingApi.getPullRequest(mainProjectId, detail.id)).data as PullRequest) } catch { /* noop */ }
      }
    } finally { setBusy(false) }
  }

  const pr = detail
  const unresolved = pr?.conflicts || []
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{pr ? pr.title : isOwner ? tl("Proposte dei collaboratori") : tl("Le mie proposte")}</DialogTitle>
          <DialogDescription>
            {pr
              ? tl("di {0} · {1}", pr.author_name, tl(STATUS_LABEL[pr.status]))
              : isOwner
                ? tl("Rivedi le modifiche, provale senza toccare il progetto e poi uniscile.")
                : tl("Qui vedi cosa ne ha fatto chi ha creato il progetto.")}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
          {error && <p className="text-xs font-semibold text-[var(--logo-pink)]">{error}</p>}
          {!pr && (loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-[var(--app-accent)]" /></div>
          ) : list.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--text-secondary)]">{tl("Nessuna proposta per ora.")}</p>
          ) : (
            <div className="ds-well space-y-1 p-1">
              {list.map((item) => (
                <button key={item.id} type="button" onClick={() => void openDetail(item.id)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-[var(--ds-surface-muted)]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-[var(--text-primary)]">{item.title}</span>
                    <span className="block truncate text-xs text-[var(--text-secondary)]">{item.author_name} · {tl("{0} file", item.changed.length)}</span>
                  </span>
                  <Badge tone={item.status === 'merged' ? 'success' : item.status === 'open' || item.status === 'testing' ? 'accent' : 'neutral'} surface="soft" density="compact">{tl(STATUS_LABEL[item.status])}</Badge>
                </button>
              ))}
            </div>
          ))}

          {pr && (
            <>
              {pr.description && <p className="text-sm text-[var(--text-secondary)]">{pr.description}</p>}
              {pr.decision_note && <p className="text-xs text-[var(--text-secondary)]">{tl("Nota: {0}", pr.decision_note)}</p>}
              {pr.main_changed && (
                <p className="text-xs font-semibold text-amber-700">{tl("Il progetto principale è cambiato dopo la prova: rifai la prova prima di unire.")}</p>
              )}
              <div className="space-y-3">
                {(pr.changes || []).map((change, index) => <FileChange key={change.path} change={change} defaultOpen={index === 0} />)}
              </div>

              {isOwner && pr.status === 'testing' && unresolved.length > 0 && (
                <div className="space-y-3">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{tl("Conflitti da risolvere")}</p>
                  {unresolved.map((conflict) => (
                    <div key={conflict.path} className="ds-well space-y-2 p-3">
                      <p className="text-xs font-semibold text-[var(--text-primary)]">{conflict.path}</p>
                      <p className="text-xs text-[var(--text-secondary)]">{tl("Hai modificato le stesse righe del collaboratore. Il confronto sotto va dalla tua versione alla sua.")}</p>
                      <DiffBlock before={conflict.ours} after={conflict.theirs} />
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" density="compact" variant="outline" disabled={busy} onClick={() => void act(() => codingApi.resolvePullRequest(mainProjectId, pr.id, { path: conflict.path, choice: 'ours' }))}>{tl("Tieni la mia")}</Button>
                        <Button type="button" density="compact" variant="outline" disabled={busy} onClick={() => void act(() => codingApi.resolvePullRequest(mainProjectId, pr.id, { path: conflict.path, choice: 'theirs' }))}>{tl("Tieni la sua")}</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {isOwner && rejecting && (
                <div className="space-y-2">
                  <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder={tl("Perché? (facoltativo)")} aria-label={tl("Motivo del rifiuto")} className="w-full resize-none rounded-[var(--ds-radius-control)] bg-[var(--ds-field-bg)] px-3 py-2 text-sm outline-none" />
                  <div className="flex gap-2">
                    <Button type="button" density="compact" variant="outline" onClick={() => setRejecting(false)}>{tl("Annulla")}</Button>
                    <Button type="button" density="compact" tone="danger" disabled={busy} onClick={() => void act(() => codingApi.rejectPullRequest(mainProjectId, pr.id, note), () => setRejecting(false))}>{tl("Conferma rifiuto")}</Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          {pr ? (
            <>
              <Button type="button" variant="outline" onClick={() => { setDetail(null); void loadList() }}>{tl("Tutte le proposte")}</Button>
              {!isOwner && (pr.status === 'open' || pr.status === 'testing') && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => void act(() => codingApi.closePullRequest(mainProjectId, pr.id))}>{tl("Ritira")}</Button>
              )}
              {isOwner && (pr.status === 'open' || pr.status === 'testing') && !rejecting && (
                <>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => setRejecting(true)}>{tl("Rifiuta")}</Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void act(() => codingApi.testPullRequest(mainProjectId, pr.id), (next) => { if (next.test_files) onPreview(next.test_files, next.id) })}
                  >
                    {busy ? <Loader2 className="animate-spin" /> : null} {pr.status === 'testing' ? tl("Rifai la prova") : tl("Prova")}
                  </Button>
                  {pr.status === 'testing' && (
                    <>
                      {pr.test_files && <Button type="button" variant="outline" onClick={() => onPreview(pr.test_files as FileLite[], pr.id)}>{tl("Apri l'anteprima")}</Button>}
                      <Button type="button" tone="accent" surface="solid" disabled={busy || unresolved.length > 0 || pr.main_changed} onClick={() => void act(() => codingApi.mergePullRequest(mainProjectId, pr.id), () => onMerged())}>
                        {tl("Unisci al principale")}
                      </Button>
                    </>
                  )}
                </>
              )}
              {isOwner && pr.status === 'merged' && pr.previous_version_id && (
                <Button type="button" variant="outline" disabled={busy} onClick={() => { setBusy(true); void onRollback(pr.previous_version_id as string).then(() => { void loadList(); setDetail(null) }).finally(() => setBusy(false)) }}>
                  {tl("Annulla questo merge")}
                </Button>
              )}
            </>
          ) : (
            <Button type="button" variant="outline" onClick={onClose}>{tl("Chiudi")}</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
