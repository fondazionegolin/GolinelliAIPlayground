import { useRef, useState, type DragEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, LayoutGrid, List, Loader2, Upload } from '@/components/icons'
import { DropOverlay } from '@/components/ui/DropOverlay'
import { useFileDropHighlight } from '@/hooks/useFileDropHighlight'
import { useThumbnail } from '@/components/drive/useDriveThumbnail'
import { driveApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { DrivePreview } from '@/components/drive/DrivePreview'
import { CATEGORY_META, categoryOf, formatBytes, formatDate, iconFor, sortItems, type DriveFolderNode, type DriveItem, type DriveListing } from '@/components/drive/driveTypes'
import { filesFromUniversalDrag, hasUniversalFileDrag, setDriveItemsDrag } from '@/lib/dragFiles'

type ViewMode = 'grid' | 'list'
const VIEW_KEY = 'session_files_view'
const THUMB_MAX_BYTES = 8 * 1024 * 1024

const readView = (): ViewMode => {
  try { return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid' } catch { return 'grid' }
}

interface EntryProps {
  item: DriveItem
  onOpen: (item: DriveItem) => void
}

const dragProps = (item: DriveItem) => ({
  draggable: true,
  onDragStart: (event: DragEvent) => setDriveItemsDrag(event, [{ id: item.id, name: item.name, kind: item.kind, mime_type: item.mime_type }]),
})

const hint = (item: DriveItem) => (item.kind === 'folder' ? 'Apri cartella' : "Clic per l'anteprima · trascina per condividere")

function GridEntry({ item, onOpen }: EntryProps) {
  const category = categoryOf(item)
  const wantsThumb = item.kind === 'file' && category === 'image' && (item.size_bytes ?? 0) <= THUMB_MAX_BYTES
  const { ref, url } = useThumbnail(item, wantsThumb)
  const Icon = iconFor(item)
  const tone = item.kind === 'folder' && item.is_system ? 'var(--logo-violet)' : CATEGORY_META[category].tone
  return (
    <button
      type="button"
      {...dragProps(item)}
      onClick={() => onOpen(item)}
      title={hint(item)}
      className="group flex min-w-0 cursor-grab flex-col overflow-hidden rounded-2xl bg-[var(--ds-surface-raised)] text-left shadow-[var(--ds-shadow-1)] transition-shadow hover:shadow-[var(--ds-shadow-2)] active:cursor-grabbing"
    >
      <div ref={ref} className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-[var(--ds-control)]">
        {url
          ? <img src={url} alt="" draggable={false} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.04]" />
          : <Icon className="h-9 w-9" style={{ color: tone }} strokeWidth={1.5} />}
      </div>
      <div className="min-w-0 px-2.5 py-2">
        <p className="truncate text-[11px] font-bold text-foreground">{item.name}</p>
        <p className="truncate text-[10px] text-muted-foreground">{item.kind === 'folder' ? `${item.child_count ?? 0} elementi` : formatBytes(item.size_bytes)}</p>
      </div>
    </button>
  )
}

function ListEntry({ item, onOpen }: EntryProps) {
  const Icon = iconFor(item)
  const category = categoryOf(item)
  const tone = item.kind === 'folder' && item.is_system ? 'var(--logo-violet)' : CATEGORY_META[category].tone
  return (
    <button
      type="button"
      {...dragProps(item)}
      onClick={() => onOpen(item)}
      title={hint(item)}
      className="flex w-full cursor-grab items-center gap-2.5 rounded-xl bg-[var(--ds-surface-raised)] px-3 py-2 text-left shadow-[var(--ds-shadow-1)] transition-colors hover:bg-[var(--ds-control-hover)] active:cursor-grabbing"
    >
      <Icon className="h-4 w-4 shrink-0" style={{ color: tone }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-foreground">{item.name}</span>
        <span className="block truncate text-[10px] text-muted-foreground">
          {CATEGORY_META[category].label} · {item.kind === 'folder' ? `${item.child_count ?? 0} elementi` : formatBytes(item.size_bytes)} · {formatDate(item.updated_at)}
        </span>
      </span>
    </button>
  )
}

/**
 * Quick explorer of the session's drive folder, shown inside the class chat sidebar. Items can be dragged out
 * to any chat/chatbot/section, and files dropped on it are uploaded into the folder being browsed.
 */
export function SessionFilesExplorer({ sessionId, isTeacher = false }: { sessionId: string; isTeacher?: boolean }) {
  const [preview, setPreview] = useState<DriveItem | null>(null)
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [path, setPath] = useState<{ id: string; name: string }[]>([])
  const [view, setViewState] = useState<ViewMode>(readView)
  const { active: dragOver, dropHighlightProps, reset } = useFileDropHighlight()
  const fileInput = useRef<HTMLInputElement>(null)

  const tree = useQuery<DriveFolderNode[]>({
    queryKey: ['drive', 'tree'],
    queryFn: async () => (await driveApi.tree()).data,
  })
  const root = tree.data?.find((node) => node.session_id === sessionId && node.system_key === `session:${sessionId}`)
  const current = path.at(-1)?.id ?? root?.id ?? null

  const listing = useQuery<DriveListing>({
    queryKey: ['drive', 'session-quick', current],
    queryFn: async () => (await driveApi.list({ view: 'folder', parent_id: current })).data,
    enabled: !!current,
    refetchInterval: 15000,
  })
  const items = sortItems(listing.data?.items ?? [], 'name', true)

  const upload = async (files: File[]) => {
    if (!current || !files.length) return
    try {
      await driveApi.upload(files, current, files.map((file) => file.name))
      toast({ title: files.length > 1 ? `${files.length} file caricati` : `«${files[0].name}» caricato` })
      void queryClient.invalidateQueries({ queryKey: ['drive'] })
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Caricamento non riuscito', description: err?.response?.data?.detail || 'Riprova tra poco.' })
    }
  }

  const onDrop = async (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    reset()
    if (hasUniversalFileDrag(event.dataTransfer)) await upload(await filesFromUniversalDrag(event.dataTransfer))
    else await upload(Array.from(event.dataTransfer.files))
  }

  const openItem = (item: DriveItem) => {
    if (item.kind === 'folder') { setPath((prev) => [...prev, { id: item.id, name: item.name }]); return }
    setPreview(item)
  }

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col bg-[var(--ds-surface-muted)]"
      {...dropHighlightProps}
      onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = 'copy' }}
      onDrop={(event) => void onDrop(event)}
    >
      <DropOverlay active={dragOver} label="Rilascia per caricare" hint={`Nella cartella «${path.at(-1)?.name ?? 'File di sessione'}»`} />
      <div className="flex items-center gap-1 px-4 py-3 text-[11px] font-bold text-muted-foreground">
        <button type="button" onClick={() => setPath([])} className="rounded px-1 uppercase tracking-widest hover:text-foreground">File di sessione</button>
        {path.map((entry, index) => (
          <span key={entry.id} className="flex min-w-0 items-center gap-1">
            <ChevronRight className="h-3 w-3 shrink-0" />
            <button type="button" onClick={() => setPath(path.slice(0, index + 1))} className="truncate rounded px-1 hover:text-foreground">{entry.name}</button>
          </span>
        ))}
        <div className="ml-auto flex items-center rounded-lg p-0.5 ds-control" role="group" aria-label="Vista">
          {([['grid', LayoutGrid, 'Icone e anteprime'], ['list', List, 'Elenco con dettagli']] as const).map(([mode, ViewIcon, label]) => (
            <button
              key={mode}
              type="button"
              onClick={() => { setViewState(mode); try { localStorage.setItem(VIEW_KEY, mode) } catch { /* storage unavailable */ } }}
              title={label}
              aria-label={label}
              aria-pressed={view === mode}
              className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${view === mode ? 'bg-[var(--ds-popover-solid)] text-foreground shadow-[var(--ds-shadow-1)]' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <ViewIcon className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
        <button type="button" onClick={() => fileInput.current?.click()} disabled={!current} className="flex h-7 items-center gap-1 rounded-lg px-2 ds-control text-foreground disabled:opacity-40" title="Carica file nella sessione">
          <Upload className="h-3.5 w-3.5" />Carica
        </button>
        <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { void upload(Array.from(event.target.files || [])); event.target.value = '' }} />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {(tree.isLoading || listing.isLoading) && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}
        {!tree.isLoading && !root && <p className="px-2 py-8 text-center text-xs text-muted-foreground">Nessuna cartella per questa sessione.</p>}
        {!listing.isLoading && root && items.length === 0 && (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">Nessun file. Trascina qui i file da condividere o dai chatbot.</p>
        )}
        <div className={view === 'grid' ? 'grid grid-cols-2 gap-2' : 'space-y-1.5'}>
          {items.map((item) => (view === 'grid'
            ? <GridEntry key={item.id} item={item} onOpen={openItem} />
            : <ListEntry key={item.id} item={item} onOpen={openItem} />))}
        </div>
      </div>
      {preview && createPortal(<DrivePreview item={preview} items={items} isTeacher={isTeacher} onNavigate={setPreview} onClose={() => setPreview(null)} />, document.body)}
    </div>
  )
}
