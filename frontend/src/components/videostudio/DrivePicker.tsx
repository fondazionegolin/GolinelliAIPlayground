import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, FileVideo, Folder, Loader2 } from '@/components/icons'
import { Button, Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/design'
import { driveApi } from '@/lib/api'
import type { DriveItem } from '@/components/drive/driveTypes'
import { tl } from '@/i18n/tl'

/** Pick a video from the teacher's Files section (Drive). */
export function DrivePicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (item: DriveItem) => void }) {
  const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([])
  const parent = trail.length ? trail[trail.length - 1].id : null
  const listing = useQuery({
    queryKey: ['vs', 'drive', parent],
    queryFn: async () => (await driveApi.list({ view: 'folder', parent_id: parent })).data as { items: DriveItem[] },
    enabled: open,
  })
  const items = (listing.data?.items || []).filter((i) => i.kind === 'folder' || (i.mime_type || '').startsWith('video/'))
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent size="md">
        <DialogHeader><DialogTitle>{tl("Scegli un video dai tuoi file")}</DialogTitle></DialogHeader>
        <DialogBody className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
            {trail.length > 0 && <Button tone="neutral" surface="ghost" density="compact" onClick={() => setTrail(trail.slice(0, -1))}><ChevronLeft />{tl("Indietro")}</Button>}
            <span className="truncate">{['File', ...trail.map((t) => t.name)].join(' / ')}</span>
          </div>
          <div className="max-h-[50vh] space-y-1 overflow-y-auto">
            {listing.isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}
            {!listing.isLoading && items.length === 0 && <p className="py-8 text-center text-sm text-[var(--text-secondary)]">{tl("Nessun video in questa cartella.")}</p>}
            {items.map((item) => (
              <button key={item.id} type="button"
                onClick={() => item.kind === 'folder' ? setTrail([...trail, { id: item.id, name: item.name }]) : onPick(item)}
                className="ds-control flex w-full items-center gap-3 rounded-[var(--control-radius)] px-3 py-2 text-left text-sm">
                {item.kind === 'folder' ? <Folder className="h-4 w-4 text-[var(--logo-violet)]" /> : <FileVideo className="h-4 w-4 text-[var(--logo-blue)]" />}
                <span className="min-w-0 flex-1 truncate font-medium">{item.name}</span>
                {item.size_bytes ? <span className="text-[11px] text-[var(--text-muted)]">{(item.size_bytes / 1048576).toFixed(1)} MB</span> : null}
              </button>
            ))}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
