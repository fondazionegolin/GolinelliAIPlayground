import { useMemo, useState } from 'react'
import { ChevronRight, Folder, HardDrive, Loader2 } from '@/components/icons'
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/design'
import type { DriveFolderNode } from './driveTypes'

/** Folder picker for "Sposta in…". Folders being moved (and their subtrees) are not valid targets. */
export function DriveMoveDialog({
  folders, movingIds, onConfirm, onClose,
}: {
  folders: DriveFolderNode[]
  movingIds: string[]
  onConfirm: (parentId: string | null) => Promise<void>
  onClose: () => void
}) {
  const [target, setTarget] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const children = useMemo(() => {
    const map = new Map<string | null, DriveFolderNode[]>()
    folders.forEach((folder) => {
      const list = map.get(folder.parent_id) ?? []
      list.push(folder)
      map.set(folder.parent_id, list)
    })
    return map
  }, [folders])
  const blocked = useMemo(() => {
    const out = new Set(movingIds)
    const stack = [...movingIds]
    while (stack.length) {
      const id = stack.pop()!
      for (const child of children.get(id) ?? []) {
        if (!out.has(child.id)) { out.add(child.id); stack.push(child.id) }
      }
    }
    return out
  }, [children, movingIds])

  const renderLevel = (parentId: string | null, depth: number): JSX.Element[] =>
    (children.get(parentId) ?? []).filter((folder) => !blocked.has(folder.id)).flatMap((folder) => {
      const hasKids = (children.get(folder.id) ?? []).some((child) => !blocked.has(child.id))
      const open = expanded.has(folder.id)
      return [
        <div
          key={folder.id}
          className={`flex items-center gap-1 rounded-lg pr-2 ${target === folder.id ? 'ds-selected' : 'hover:bg-slate-50'}`}
          style={{ paddingLeft: depth * 16 + 4 }}
        >
          <button
            type="button"
            className={`flex h-7 w-6 items-center justify-center text-slate-400 ${hasKids ? '' : 'invisible'}`}
            onClick={() => setExpanded((current) => { const next = new Set(current); open ? next.delete(folder.id) : next.add(folder.id); return next })}
            aria-label={open ? 'Comprimi' : 'Espandi'}
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
          </button>
          <button type="button" onClick={() => setTarget(folder.id)} onDoubleClick={() => void confirm(folder.id)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-sm text-slate-700">
            <Folder className="h-4 w-4 shrink-0 text-[var(--logo-blue)]" />
            <span className="truncate">{folder.name}</span>
          </button>
        </div>,
        ...(open ? renderLevel(folder.id, depth + 1) : []),
      ]
    })

  const confirm = async (parentId: string | null) => {
    setBusy(true)
    try { await onConfirm(parentId) } finally { setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Sposta {movingIds.length > 1 ? `${movingIds.length} elementi` : 'elemento'} in…</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <div className="max-h-[50vh] overflow-y-auto rounded-xl bg-slate-50/60 p-1.5">
            <button
              type="button"
              onClick={() => setTarget(null)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm font-semibold text-slate-700 ${target === null ? 'ds-selected' : 'hover:bg-slate-50'}`}
            >
              <HardDrive className="h-4 w-4 text-slate-500" /> Il mio drive
            </button>
            {renderLevel(null, 0)}
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" tone="neutral" surface="ghost" onClick={onClose}>Annulla</Button>
          <Button type="button" tone="accent" surface="solid" disabled={busy} onClick={() => void confirm(target)}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Sposta qui
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
