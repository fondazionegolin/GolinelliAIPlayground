import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownUp, Check, ChevronDown, ChevronRight, Clock, Download, ExternalLink, Eye, FileUp, Folder, FolderInput,
  FolderPlus, FolderUp, HardDrive, LayoutGrid, List, Loader2, MoreVertical, Pencil, Plus, RefreshCw, RotateCcw,
  Share2, Star, Trash2, Upload, Users, X, Globe, Link2,
} from 'lucide-react'
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, SearchPill } from '@/design'
import { driveApi, type DriveView } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import {
  CATEGORY_META, FILTERS, canEdit, categoryOf, editorPathFor, formatBytes, formatDate, iconFor, sortItems,
  type DriveCategory, type DriveFolderNode, type DriveItem, type DriveListing, type SortKey,
} from './driveTypes'
import { DrivePreview, downloadDriveItem } from './DrivePreview'
import { DriveShareDialog } from './DriveShareDialog'
import { DriveMoveDialog } from './DriveMoveDialog'

const DRAG_MIME = 'application/x-golinelli-drive'
const UPLOAD_BATCH_BYTES = 150 * 1024 * 1024
const UPLOAD_BATCH_FILES = 40
const THUMB_MAX_BYTES = 6 * 1024 * 1024
const thumbCache = new Map<string, string>()

type Mode = 'teacher' | 'student'
interface UploadJob { id: string; label: string; progress: number; status: 'uploading' | 'done' | 'error'; error?: string }
interface PickedFile { file: File; path: string }

const VIEW_LABEL: Record<DriveView, string> = {
  folder: 'Il mio drive', recent: 'Recenti', starred: 'Speciali', trash: 'Cestino', shared: 'Condivisi con me', search: 'Risultati ricerca',
}

function readStored<T extends string>(key: string, fallback: T): T {
  try { return (localStorage.getItem(key) as T) || fallback } catch { return fallback }
}
function writeStored(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* per-device convenience only */ }
}

/** Walk dropped folders (webkitGetAsEntry) into files with their relative paths. */
async function collectDropped(dataTransfer: DataTransfer): Promise<PickedFile[]> {
  const entries = Array.from(dataTransfer.items || [])
    .map((entry) => (entry.kind === 'file' ? entry.webkitGetAsEntry?.() : null))
    .filter(Boolean) as FileSystemEntry[]
  if (!entries.length) return Array.from(dataTransfer.files).map((file) => ({ file, path: file.name }))
  const out: PickedFile[] = []
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
      out.push({ file, path: `${prefix}${file.name}` })
      return
    }
    const reader = (entry as FileSystemDirectoryEntry).createReader()
    const readBatch = () => new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
    let batch = await readBatch()
    while (batch.length) {
      for (const child of batch) await walk(child, `${prefix}${entry.name}/`)
      batch = await readBatch()
    }
  }
  for (const entry of entries) await walk(entry, '')
  return out
}

function useThumbnail(item: DriveItem, enabled: boolean) {
  const ref = useRef<HTMLDivElement>(null)
  const [url, setUrl] = useState<string | null>(() => item.thumbnail || thumbCache.get(item.id) || null)
  useEffect(() => {
    if (!enabled || url || !ref.current) return
    const node = ref.current
    let cancelled = false
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      driveApi.content(item.id).then((res) => {
        if (cancelled) return
        const objectUrl = URL.createObjectURL(res.data)
        thumbCache.set(item.id, objectUrl)
        setUrl(objectUrl)
      }).catch(() => undefined)
    }, { rootMargin: '200px' })
    observer.observe(node)
    return () => { cancelled = true; observer.disconnect() }
  }, [enabled, item.id, url])
  return { ref, url }
}

export function DriveBrowser({ mode }: { mode: Mode }) {
  const isTeacher = mode === 'teacher'
  const { toast } = useToast()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // Teachers navigate through the URL (back/forward, shareable); students keep it local because the
  // student dashboard reacts to every query-string change.
  const [searchParams, setSearchParams] = useSearchParams()
  const [localNav, setLocalNav] = useState<{ view: DriveView; folder: string | null }>({ view: 'shared', folder: null })
  const view = isTeacher ? ((searchParams.get('view') as DriveView) || 'folder') : localNav.view
  const folderId = isTeacher ? searchParams.get('folder') : localNav.folder
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [layout, setLayout] = useState<'grid' | 'list'>(() => readStored('drive:layout', 'grid'))
  const [sortKey, setSortKey] = useState<SortKey>(() => readStored('drive:sort', 'name'))
  const [sortAsc, setSortAsc] = useState(() => readStored('drive:asc', '1') === '1')
  const [filter, setFilter] = useState<'all' | DriveCategory>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const anchorRef = useRef<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; item: DriveItem } | null>(null)
  const [preview, setPreview] = useState<DriveItem | null>(null)
  const [shareItem, setShareItem] = useState<DriveItem | null>(null)
  const [moveIds, setMoveIds] = useState<string[] | null>(null)
  const [newFolderOpen, setNewFolderOpen] = useState(false)
  const [newMenuOpen, setNewMenuOpen] = useState(false)
  const [sortMenuOpen, setSortMenuOpen] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [uploads, setUploads] = useState<UploadJob[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const coarsePointer = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches, [])

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  const effectiveView: DriveView = debounced && isTeacher ? 'search' : folderId ? 'folder' : view
  const listingKey = ['drive', 'list', effectiveView, folderId, debounced] as const
  const listing = useQuery<DriveListing>({
    queryKey: listingKey,
    queryFn: async () => (await driveApi.list({ view: effectiveView, parent_id: effectiveView === 'folder' ? folderId : undefined, q: debounced || undefined })).data,
    placeholderData: (previous) => previous,
  })
  const tree = useQuery<DriveFolderNode[]>({
    queryKey: ['drive', 'tree'],
    queryFn: async () => (await driveApi.tree()).data,
    enabled: isTeacher,
    staleTime: 15_000,
  })
  const usage = useQuery<{ used_bytes: number; quota_bytes: number }>({
    queryKey: ['drive', 'usage'],
    queryFn: async () => (await driveApi.usage()).data,
    enabled: isTeacher,
  })

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ['drive'] }), [queryClient])

  // Deep link from the session quick panel: /teacher/files?session=<id> opens that session's folder.
  const sessionParam = isTeacher ? searchParams.get('session') : null
  useEffect(() => {
    if (!sessionParam || !tree.data) return
    const folder = tree.data.find((node) => node.session_id === sessionParam && node.system_key === `session:${sessionParam}`)
    setSearchParams(folder ? { folder: folder.id } : {}, { replace: true })
  }, [sessionParam, tree.data, setSearchParams])
  const role = listing.data?.role ?? (isTeacher ? 'owner' : null)
  const inTrash = effectiveView === 'trash'
  const writable = !inTrash && canEdit(role) && (effectiveView === 'folder' || effectiveView === 'search') && (isTeacher || !!folderId)

  const items = useMemo(() => {
    const raw = listing.data?.items ?? []
    const filtered = filter === 'all' ? raw : raw.filter((item) => categoryOf(item) === filter)
    if (effectiveView === 'recent' && sortKey === 'name' && sortAsc) return filtered // keep server recency order by default
    return sortItems(filtered, sortKey, sortAsc)
  }, [listing.data, filter, sortKey, sortAsc, effectiveView])
  const selectedItems = items.filter((item) => selected.has(item.id))

  useEffect(() => { setSelected(new Set()); setMenu(null); setRenamingId(null) }, [effectiveView, folderId, debounced])

  const go = (next: { view?: DriveView; folder?: string | null }) => {
    setQuery('')
    if (!isTeacher) {
      setLocalNav({ view: next.view ?? 'shared', folder: next.folder ?? null })
      return
    }
    const params = new URLSearchParams()
    if (next.folder) params.set('folder', next.folder)
    else if (next.view && next.view !== 'folder') params.set('view', next.view)
    setSearchParams(params)
  }

  const fail = (title: string) => (err: any) => toast({ variant: 'destructive', title, description: err?.response?.data?.detail || 'Riprova tra poco.' })

  // ── Actions ──────────────────────────────────────────────────────────────
  const open = (item: DriveItem) => {
    if (inTrash) return
    if (item.kind === 'folder') go({ folder: item.id })
    else setPreview(item)
  }
  const doTrash = async (targets: DriveItem[]) => {
    if (!targets.length) return
    try {
      await driveApi.trash(targets.map((item) => item.id))
      toast({ title: targets.length > 1 ? `${targets.length} elementi spostati nel cestino` : `«${targets[0].name}» spostato nel cestino` })
      setSelected(new Set())
      refresh()
    } catch (err) { fail('Eliminazione non riuscita')(err) }
  }
  const doRestore = async (targets: DriveItem[]) => {
    try { await driveApi.restore(targets.map((item) => item.id)); setSelected(new Set()); refresh() } catch (err) { fail('Ripristino non riuscito')(err) }
  }
  const doPurge = async (targets: DriveItem[]) => {
    if (!window.confirm(`Eliminare definitivamente ${targets.length > 1 ? `${targets.length} elementi` : `«${targets[0].name}»`}? L'operazione non si può annullare.`)) return
    try { await driveApi.purge(targets.map((item) => item.id)); setSelected(new Set()); refresh() } catch (err) { fail('Eliminazione non riuscita')(err) }
  }
  const doEmptyTrash = async () => {
    if (!window.confirm('Svuotare il cestino? Tutti gli elementi verranno eliminati definitivamente.')) return
    try { await driveApi.emptyTrash(); refresh() } catch (err) { fail('Operazione non riuscita')(err) }
  }
  const doStar = async (targets: DriveItem[], starred: boolean) => {
    try { await Promise.all(targets.map((item) => driveApi.update(item.id, { starred }))); refresh() } catch (err) { fail('Operazione non riuscita')(err) }
  }
  const doRename = async (item: DriveItem, name: string) => {
    setRenamingId(null)
    const clean = name.trim()
    if (!clean || clean === item.name) return
    try { await driveApi.update(item.id, { name: clean }); refresh() } catch (err) { fail('Rinomina non riuscita')(err) }
  }
  const doMove = async (ids: string[], parentId: string | null) => {
    const valid = ids.filter((id) => id !== parentId)
    if (!valid.length) return
    try {
      await driveApi.move(valid, parentId)
      toast({ title: valid.length > 1 ? `${valid.length} elementi spostati` : 'Elemento spostato' })
      setSelected(new Set())
      setMoveIds(null)
      refresh()
    } catch (err) { fail('Spostamento non riuscito')(err) }
  }
  const doDownload = async (targets: DriveItem[], format?: string) => {
    try {
      if (targets.length === 1) await downloadDriveItem(targets[0], format)
      else {
        const res = await driveApi.zip(targets.map((item) => item.id))
        const url = URL.createObjectURL(res.data)
        const link = Object.assign(document.createElement('a'), { href: url, download: 'golinelli-files.zip' })
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 2000)
      }
    } catch (err) { fail('Download non riuscito')(err) }
  }
  const createFolder = async (name: string) => {
    try {
      await driveApi.createFolder(name, folderId)
      setNewFolderOpen(false)
      refresh()
    } catch (err) { fail('Cartella non creata')(err) }
  }

  // ── Upload ───────────────────────────────────────────────────────────────
  const uploadFiles = useCallback(async (picked: PickedFile[], parentId: string | null) => {
    if (!picked.length) return
    const batches: PickedFile[][] = []
    let current: PickedFile[] = []
    let bytes = 0
    for (const entry of picked) {
      if (current.length && (bytes + entry.file.size > UPLOAD_BATCH_BYTES || current.length >= UPLOAD_BATCH_FILES)) {
        batches.push(current)
        current = []
        bytes = 0
      }
      current.push(entry)
      bytes += entry.file.size
    }
    if (current.length) batches.push(current)
    for (const batch of batches) {
      const id = `${Date.now()}-${Math.random()}`
      const label = batch.length === 1 ? batch[0].file.name : `${batch.length} file`
      setUploads((jobs) => [...jobs, { id, label, progress: 0, status: 'uploading' }])
      try {
        await driveApi.upload(batch.map((entry) => entry.file), parentId, batch.map((entry) => entry.path), (fraction) =>
          setUploads((jobs) => jobs.map((job) => (job.id === id ? { ...job, progress: fraction } : job))))
        setUploads((jobs) => jobs.map((job) => (job.id === id ? { ...job, progress: 1, status: 'done' } : job)))
      } catch (err: any) {
        setUploads((jobs) => jobs.map((job) => (job.id === id ? { ...job, status: 'error', error: err?.response?.data?.detail || 'Caricamento non riuscito' } : job)))
      }
      refresh()
    }
  }, [refresh])

  const onPickFiles = (list: FileList | null, useRelative: boolean) => {
    if (!list) return
    const picked = Array.from(list).map((file) => ({ file, path: useRelative ? ((file as any).webkitRelativePath || file.name) : file.name }))
    void uploadFiles(picked, folderId)
  }

  // ── Drag & drop ──────────────────────────────────────────────────────────
  const isInternalDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes(DRAG_MIME)
  const isFileDrag = (event: DragEvent) => Array.from(event.dataTransfer.types).includes('Files')

  const startDrag = (event: DragEvent, item: DriveItem) => {
    const ids = selected.has(item.id) ? Array.from(selected) : [item.id]
    const movable = items.filter((entry) => ids.includes(entry.id) && !entry.is_system && canEdit(entry.role)).map((entry) => entry.id)
    if (!movable.length || inTrash) { event.preventDefault(); return }
    event.dataTransfer.setData(DRAG_MIME, JSON.stringify(movable))
    event.dataTransfer.effectAllowed = 'move'
  }

  const dropOn = async (event: DragEvent, targetFolderId: string | null) => {
    event.preventDefault()
    event.stopPropagation()
    dragDepth.current = 0
    setDropActive(false)
    setDropTarget(null)
    if (isInternalDrag(event)) {
      const ids: string[] = JSON.parse(event.dataTransfer.getData(DRAG_MIME) || '[]')
      if (ids.length && !ids.includes(targetFolderId || '')) await doMove(ids, targetFolderId)
      return
    }
    if (isFileDrag(event)) {
      if (!isTeacher && !targetFolderId) return
      const picked = await collectDropped(event.dataTransfer)
      await uploadFiles(picked, targetFolderId)
    }
  }

  const folderDropProps = (targetId: string | null, allowed = true) => allowed ? {
    onDragOver: (event: DragEvent) => {
      if (!isInternalDrag(event) && !isFileDrag(event)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = isInternalDrag(event) ? 'move' : 'copy'
      setDropTarget(targetId ?? 'root')
    },
    onDragLeave: () => setDropTarget((current) => (current === (targetId ?? 'root') ? null : current)),
    onDrop: (event: DragEvent) => void dropOn(event, targetId),
  } : {}

  // ── Selection & keyboard ─────────────────────────────────────────────────
  const clickItem = (event: ReactMouseEvent, item: DriveItem) => {
    event.stopPropagation()
    setMenu(null)
    if (coarsePointer && !event.metaKey && !event.ctrlKey && !event.shiftKey) { open(item); return }
    if (event.shiftKey && anchorRef.current) {
      const ids = items.map((entry) => entry.id)
      const [a, b] = [ids.indexOf(anchorRef.current), ids.indexOf(item.id)].sort((x, y) => x - y)
      if (a >= 0) { setSelected(new Set(ids.slice(a, b + 1))); return }
    }
    if (event.metaKey || event.ctrlKey) {
      setSelected((current) => { const next = new Set(current); next.has(item.id) ? next.delete(item.id) : next.add(item.id); return next })
    } else {
      setSelected(new Set([item.id]))
    }
    anchorRef.current = item.id
  }

  const openMenu = (event: ReactMouseEvent, item: DriveItem) => {
    event.preventDefault()
    event.stopPropagation()
    if (!selected.has(item.id)) setSelected(new Set([item.id]))
    setMenu({ x: Math.min(event.clientX, window.innerWidth - 248), y: Math.min(event.clientY, window.innerHeight - 380), item })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (preview || shareItem || moveIds || newFolderOpen || renamingId) return
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(new Set(items.map((item) => item.id))) }
      else if (event.key === 'Escape') { setSelected(new Set()); setMenu(null) }
      else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedItems.length) {
        event.preventDefault()
        if (inTrash) void doPurge(selectedItems)
        else void doTrash(selectedItems.filter((item) => canEdit(item.role) && !item.is_system))
      } else if (event.key === 'F2' && selectedItems.length === 1 && canEdit(selectedItems[0].role) && !selectedItems[0].is_system) {
        event.preventDefault()
        setRenamingId(selectedItems[0].id)
      } else if (event.key === 'Enter' && selectedItems.length === 1) open(selectedItems[0])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    if (!menu && !newMenuOpen && !sortMenuOpen) return
    const close = () => { setMenu(null); setNewMenuOpen(false); setSortMenuOpen(false) }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    return () => { window.removeEventListener('click', close); window.removeEventListener('scroll', close, true) }
  }, [menu, newMenuOpen, sortMenuOpen])

  // ── Rendering helpers ────────────────────────────────────────────────────
  const breadcrumb = listing.data?.breadcrumb ?? []
  const sharedLabel = isTeacher ? VIEW_LABEL.shared : 'Condivisi con la classe'
  const rootLabel = isTeacher ? (folderId && breadcrumb.length && listing.data?.role !== 'owner' ? sharedLabel : VIEW_LABEL[folderId ? 'folder' : effectiveView]) : sharedLabel
  const rootView: DriveView = isTeacher ? (folderId && listing.data?.role !== 'owner' ? 'shared' : folderId ? 'folder' : effectiveView) : 'shared'
  const title = debounced && isTeacher ? `Risultati per «${debounced}»` : folderId ? breadcrumb[breadcrumb.length - 1]?.name ?? '' : effectiveView === 'shared' ? sharedLabel : VIEW_LABEL[effectiveView]

  const menuActions = (item: DriveItem) => {
    const targets = selected.has(item.id) && selectedItems.length > 1 ? selectedItems : [item]
    const single = targets.length === 1
    const editorPath = isTeacher && single ? editorPathFor(item) : null
    const isDoc = item.source_type === 'document' || item.source_type === 'presentation'
    const editableTargets = targets.filter((entry) => canEdit(entry.role) && !entry.is_system)
    const owned = targets.every((entry) => entry.role === 'owner')
    if (inTrash) {
      return [
        { icon: RotateCcw, label: 'Ripristina', run: () => doRestore(targets) },
        { icon: Trash2, label: 'Elimina definitivamente', danger: true, run: () => doPurge(targets) },
      ]
    }
    return [
      single && { icon: item.kind === 'folder' ? Folder : Eye, label: item.kind === 'folder' ? 'Apri' : 'Anteprima', run: () => open(item) },
      editorPath && { icon: ExternalLink, label: "Apri nell'editor", run: () => navigate(editorPath) },
      { icon: Download, label: targets.length > 1 || item.kind === 'folder' ? 'Scarica come zip' : 'Scarica', run: () => doDownload(targets) },
      single && isDoc && { icon: FileUp, label: 'Esporta in PDF', run: () => doDownload(targets, 'pdf') },
      single && isDoc && { icon: FileUp, label: item.source_type === 'presentation' ? 'Esporta in PowerPoint' : 'Esporta in Word', run: () => doDownload(targets, item.source_type === 'presentation' ? 'pptx' : 'docx') },
      'divider',
      single && isTeacher && owned && { icon: Share2, label: 'Condividi', run: () => setShareItem(item) },
      single && editableTargets.length === 1 && { icon: Pencil, label: 'Rinomina', hint: 'F2', run: () => setRenamingId(item.id) },
      isTeacher && owned && editableTargets.length === targets.length && { icon: FolderInput, label: 'Sposta in…', run: () => setMoveIds(targets.map((entry) => entry.id)) },
      isTeacher && owned && { icon: Star, label: targets.every((entry) => entry.starred) ? 'Rimuovi da Speciali' : 'Aggiungi a Speciali', run: () => doStar(targets, !targets.every((entry) => entry.starred)) },
      editableTargets.length > 0 && 'divider',
      editableTargets.length > 0 && { icon: Trash2, label: 'Sposta nel cestino', hint: 'Canc', danger: true, run: () => doTrash(editableTargets) },
    ].filter(Boolean) as Array<'divider' | { icon: typeof Eye; label: string; hint?: string; danger?: boolean; run: () => unknown }>
  }

  const renderBadges = (item: DriveItem) => (
    <>
      {item.starred && <Star className="h-3 w-3 shrink-0 fill-amber-400 text-amber-400" aria-label="Speciale" />}
      {item.shared && <Users className="h-3 w-3 shrink-0 text-slate-400" aria-label="Condiviso" />}
      {item.public && <Globe className="h-3 w-3 shrink-0 text-slate-400" aria-label="Link pubblico" />}
      {item.kind === 'link' && <Link2 className="h-3 w-3 shrink-0 text-slate-400" aria-label="Collegato alla piattaforma" />}
    </>
  )

  const itemProps = (item: DriveItem) => ({
    draggable: !inTrash && !item.is_system && canEdit(item.role) && !coarsePointer,
    onDragStart: (event: DragEvent) => startDrag(event, item),
    onClick: (event: ReactMouseEvent) => clickItem(event, item),
    onDoubleClick: () => open(item),
    onContextMenu: (event: ReactMouseEvent) => openMenu(event, item),
    ...(item.kind === 'folder' && !inTrash ? folderDropProps(item.id, canEdit(item.role)) : {}),
  })

  // ── Layout ───────────────────────────────────────────────────────────────
  const navEntry = (target: DriveView, icon: ReactNode, label: string, dropId?: string | null) => {
    const active = !folderId && !debounced && effectiveView === target
    return (
      <button
        type="button"
        onClick={() => go({ view: target })}
        {...(dropId !== undefined ? folderDropProps(dropId) : {})}
        className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] font-semibold transition-colors ${active ? 'ds-selected text-[var(--selection-text)]' : 'text-slate-600 hover:bg-[var(--ds-control-hover)]'} ${dropTarget === 'root' && dropId === null ? 'ring-2 ring-[var(--app-accent)]' : ''}`}
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>
    )
  }

  const usedPct = usage.data ? Math.min(100, (usage.data.used_bytes / Math.max(usage.data.quota_bytes, 1)) * 100) : 0

  return (
    <div className="flex h-full min-h-0 w-full gap-4 p-3 md:p-4" onClick={() => setSelected(new Set())}>
      {/* Sidebar */}
      {isTeacher && (
        <aside className="ds-panel hidden w-64 shrink-0 flex-col rounded-[var(--card-radius)] p-3 lg:flex" onClick={(event) => event.stopPropagation()}>
          <div className="relative mb-3">
            <Button type="button" tone="accent" surface="solid" className="w-full justify-start gap-2 rounded-2xl" onClick={(event) => { event.stopPropagation(); setNewMenuOpen((value) => !value) }}>
              <Plus className="h-4 w-4" /> Nuovo
            </Button>
            {newMenuOpen && (
              <div className="ds-popover rounded-[var(--ds-radius-panel)] absolute left-0 right-0 top-full z-40 mt-2 p-1.5" onClick={(event) => event.stopPropagation()}>
                <MenuButton icon={FolderPlus} label="Nuova cartella" onClick={() => { setNewMenuOpen(false); setNewFolderOpen(true) }} />
                <MenuButton icon={Upload} label="Carica file" onClick={() => { setNewMenuOpen(false); fileInputRef.current?.click() }} />
                <MenuButton icon={FolderUp} label="Carica cartella" onClick={() => { setNewMenuOpen(false); folderInputRef.current?.click() }} />
              </div>
            )}
          </div>
          <nav className="flex flex-col gap-0.5">
            {navEntry('folder', <HardDrive className="h-4 w-4" />, 'Il mio drive', null)}
          </nav>
          <div className="mt-1 min-h-0 flex-1 overflow-y-auto pr-1">
            <FolderTree
              folders={tree.data ?? []}
              activeId={folderId}
              dropTarget={dropTarget}
              onOpen={(id) => go({ folder: id })}
              dropProps={(id) => folderDropProps(id)}
            />
          </div>
          <nav className="mt-2 flex flex-col gap-0.5 border-t border-slate-100 pt-2">
            {navEntry('shared', <Users className="h-4 w-4" />, 'Condivisi con me')}
            {navEntry('recent', <Clock className="h-4 w-4" />, 'Recenti')}
            {navEntry('starred', <Star className="h-4 w-4" />, 'Speciali')}
            {navEntry('trash', <Trash2 className="h-4 w-4" />, 'Cestino')}
          </nav>
          {usage.data && (
            <div className="mt-3 px-2">
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-[var(--app-accent)]" style={{ width: `${Math.max(usedPct, 1)}%` }} />
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500">{formatBytes(usage.data.used_bytes)} di {formatBytes(usage.data.quota_bytes)} utilizzati</p>
            </div>
          )}
        </aside>
      )}

      {/* Main */}
      <section
        className="ds-panel relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--card-radius)]"
        onDragEnter={(event) => { if (isFileDrag(event) && writable) { dragDepth.current += 1; setDropActive(true) } }}
        onDragLeave={() => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDropActive(false) }}
        onDragOver={(event) => { if (isFileDrag(event) && writable) event.preventDefault() }}
        onDrop={(event) => { if (writable) void dropOn(event, folderId) }}
      >
        <header className="flex flex-col gap-3 px-4 pb-2 pt-4 md:px-5" onClick={(event) => event.stopPropagation()}>
          <div className="flex flex-wrap items-center gap-3">
            <nav className="flex min-w-0 flex-1 items-center gap-1 text-sm" aria-label="Percorso">
              <button
                type="button"
                onClick={() => go({ view: rootView })}
                {...(rootView === 'folder' ? folderDropProps(null) : {})}
                className={`shrink-0 rounded-lg px-2 py-1 font-bold text-slate-500 hover:bg-slate-100 ${folderId ? '' : 'text-slate-900'} ${dropTarget === 'root' ? 'ring-2 ring-[var(--app-accent)]' : ''}`}
              >
                {folderId ? rootLabel : title}
              </button>
              {folderId && breadcrumb.map((crumb, index) => (
                <span key={crumb.id} className="flex min-w-0 items-center gap-1">
                  <ChevronRight className="h-4 w-4 shrink-0 text-slate-300" />
                  <button
                    type="button"
                    onClick={() => go({ folder: crumb.id })}
                    {...folderDropProps(crumb.id, index < breadcrumb.length - 1)}
                    className={`truncate rounded-lg px-2 py-1 ${index === breadcrumb.length - 1 ? 'font-bold text-slate-900' : 'font-semibold text-slate-500 hover:bg-slate-100'} ${dropTarget === crumb.id ? 'ring-2 ring-[var(--app-accent)]' : ''}`}
                  >
                    {crumb.name}
                  </button>
                </span>
              ))}
            </nav>
            {isTeacher && (
              <SearchPill value={query} onValueChange={setQuery} placeholder="Cerca nel drive" className="w-full sm:w-72" />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {selectedItems.length > 0 ? (
              <div className="flex flex-wrap items-center gap-1 rounded-2xl bg-[var(--app-accent-soft)] px-2 py-1">
                <button type="button" onClick={() => setSelected(new Set())} className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/70" aria-label="Deseleziona">
                  <X className="h-4 w-4" />
                </button>
                <span className="px-1 text-xs font-bold text-slate-700">{selectedItems.length} selezionati</span>
                {menuActions(selectedItems[0]).filter((action) => action !== 'divider' && !['Apri', 'Anteprima', 'Rinomina', 'Esporta in PDF', 'Esporta in Word', 'Esporta in PowerPoint', "Apri nell'editor"].includes(action.label)).map((action) => {
                  if (action === 'divider') return null
                  const Icon = action.icon
                  return (
                    <button key={action.label} type="button" onClick={() => void action.run()} title={action.label} aria-label={action.label}
                      className={`flex h-8 w-8 items-center justify-center rounded-full hover:bg-white/70 ${action.danger ? 'text-red-600' : 'text-slate-700'}`}>
                      <Icon className="h-4 w-4" />
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto scrollbar-hide">
                {FILTERS.map((entry) => (
                  <button key={entry.id} type="button" onClick={() => setFilter(entry.id)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${filter === entry.id ? 'ds-selected text-[var(--selection-text)]' : 'ds-control text-slate-600'}`}>
                    {entry.label}
                  </button>
                ))}
              </div>
            )}
            <div className="ml-auto flex items-center gap-1">
              {writable && (
                <div className="flex items-center gap-1 lg:hidden">
                  <IconTool icon={FolderPlus} label="Nuova cartella" onClick={() => setNewFolderOpen(true)} />
                  <IconTool icon={Upload} label="Carica file" onClick={() => fileInputRef.current?.click()} />
                </div>
              )}
              {!isTeacher && writable && (
                <div className="hidden items-center gap-1 lg:flex">
                  <IconTool icon={FolderPlus} label="Nuova cartella" onClick={() => setNewFolderOpen(true)} />
                  <IconTool icon={Upload} label="Carica file" onClick={() => fileInputRef.current?.click()} />
                </div>
              )}
              {inTrash && (listing.data?.items.length ?? 0) > 0 && (
                <Button type="button" density="compact" tone="danger" surface="soft" onClick={() => void doEmptyTrash()}>Svuota cestino</Button>
              )}
              <div className="relative">
                <IconTool icon={ArrowDownUp} label="Ordina" onClick={(event) => { event.stopPropagation(); setSortMenuOpen((value) => !value) }} />
                {sortMenuOpen && (
                  <div className="ds-popover rounded-[var(--ds-radius-panel)] absolute right-0 top-full z-40 mt-2 w-52 p-1.5" onClick={(event) => event.stopPropagation()}>
                    {([['name', 'Nome'], ['updated', 'Ultima modifica'], ['size', 'Dimensione'], ['type', 'Tipo']] as [SortKey, string][]).map(([key, label]) => (
                      <MenuButton key={key} icon={sortKey === key ? Check : undefined} label={label} onClick={() => { setSortKey(key); writeStored('drive:sort', key) }} />
                    ))}
                    <div className="my-1 h-px bg-slate-100" />
                    <MenuButton icon={sortAsc ? Check : undefined} label="Crescente" onClick={() => { setSortAsc(true); writeStored('drive:asc', '1') }} />
                    <MenuButton icon={!sortAsc ? Check : undefined} label="Decrescente" onClick={() => { setSortAsc(false); writeStored('drive:asc', '0') }} />
                  </div>
                )}
              </div>
              <IconTool icon={layout === 'grid' ? List : LayoutGrid} label={layout === 'grid' ? 'Vista elenco' : 'Vista griglia'}
                onClick={() => { const next = layout === 'grid' ? 'list' : 'grid'; setLayout(next); writeStored('drive:layout', next) }} />
              <IconTool icon={RefreshCw} label="Aggiorna" spinning={listing.isFetching}
                onClick={() => { void driveApi.list({ view: effectiveView, parent_id: folderId, sync: true }).finally(refresh) }} />
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 md:px-5">
          {listing.isLoading ? (
            <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : listing.isError ? (
            <EmptyState icon={X} title="Contenuto non disponibile" text="La cartella non esiste più o non hai accesso." />
          ) : items.length === 0 ? (
            <EmptyState
              icon={inTrash ? Trash2 : effectiveView === 'shared' ? Users : effectiveView === 'starred' ? Star : Folder}
              title={inTrash ? 'Il cestino è vuoto' : effectiveView === 'shared' ? 'Nessun file condiviso' : effectiveView === 'starred' ? 'Nessun elemento speciale' : debounced ? 'Nessun risultato' : filter !== 'all' ? 'Nessun elemento di questo tipo' : 'Questa cartella è vuota'}
              text={inTrash ? 'Gli elementi eliminati restano qui finché non svuoti il cestino.' : effectiveView === 'shared' ? (isTeacher ? 'Qui trovi ciò che i colleghi condividono con te.' : 'Qui trovi i materiali che il docente condivide con la classe.') : writable ? 'Trascina qui file o cartelle dal computer, oppure usa «Nuovo».' : ''}
            />
          ) : layout === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
              {items.map((item) => (
                <GridCard key={item.id} item={item} selected={selected.has(item.id)} dropping={dropTarget === item.id} renaming={renamingId === item.id}
                  onRename={(name) => void doRename(item, name)} onCancelRename={() => setRenamingId(null)} badges={renderBadges(item)}
                  onMenu={(event) => openMenu(event, item)} {...itemProps(item)} />
              ))}
            </div>
          ) : (
            <div role="table" className="text-sm">
              <div role="row" className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_120px] gap-3 bg-[var(--ds-surface)] px-3 py-2 text-[11px] font-black uppercase tracking-wider text-slate-400 md:grid-cols-[minmax(0,1fr)_140px_120px_96px_40px]">
                <span>Nome</span><span className="hidden md:block">Autore</span><span>Modificato</span><span className="hidden md:block">Dimensione</span><span />
              </div>
              {items.map((item) => (
                <ListRow key={item.id} item={item} selected={selected.has(item.id)} dropping={dropTarget === item.id} renaming={renamingId === item.id}
                  onRename={(name) => void doRename(item, name)} onCancelRename={() => setRenamingId(null)} badges={renderBadges(item)}
                  onMenu={(event) => openMenu(event, item)} {...itemProps(item)} />
              ))}
            </div>
          )}
        </div>

        {dropActive && (
          <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-[var(--card-radius)] border-2 border-dashed border-[var(--app-accent)] bg-[var(--app-accent-soft)]/80">
            <div className="flex flex-col items-center gap-2 text-[var(--app-accent-text)]">
              <Upload className="h-8 w-8" />
              <p className="text-sm font-bold">Rilascia per caricare in «{folderId ? breadcrumb[breadcrumb.length - 1]?.name : 'Il mio drive'}»</p>
            </div>
          </div>
        )}
      </section>

      <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => { onPickFiles(event.target.files, false); event.target.value = '' }} />
      <input ref={folderInputRef} type="file" multiple hidden {...{ webkitdirectory: '', directory: '' }} onChange={(event) => { onPickFiles(event.target.files, true); event.target.value = '' }} />

      {menu && (
        <div className="ds-popover rounded-[var(--ds-radius-panel)] fixed z-[70] w-60 p-1.5" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
          {menuActions(menu.item).map((action, index) => action === 'divider'
            ? <div key={`d${index}`} className="my-1 h-px bg-slate-100" />
            : <MenuButton key={action.label} icon={action.icon} label={action.label} hint={action.hint} danger={action.danger} onClick={() => { setMenu(null); void action.run() }} />)}
        </div>
      )}

      {uploads.length > 0 && (
        <UploadPanel jobs={uploads} onClose={() => setUploads((jobs) => jobs.filter((job) => job.status === 'uploading'))} />
      )}
      {preview && (
        <DrivePreview item={preview} items={items} isTeacher={isTeacher} onNavigate={setPreview} onClose={() => setPreview(null)}
          onShare={isTeacher ? (item) => { setPreview(null); setShareItem(item) } : undefined} />
      )}
      {shareItem && <DriveShareDialog item={shareItem} onClose={() => setShareItem(null)} onChanged={refresh} />}
      {moveIds && <DriveMoveDialog folders={tree.data ?? []} movingIds={moveIds} onClose={() => setMoveIds(null)} onConfirm={(parentId) => doMove(moveIds, parentId)} />}
      {newFolderOpen && <NewFolderDialog onClose={() => setNewFolderOpen(false)} onCreate={createFolder} />}
    </div>
  )
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function MenuButton({ icon: Icon, label, hint, danger, onClick }: { icon?: typeof Eye; label: string; hint?: string; danger?: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-[var(--ds-radius-control)] px-3 py-2 text-left text-[13px] font-medium transition-colors ${danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-[var(--ds-control-hover)]'}`}>
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{Icon && <Icon className="h-4 w-4" />}</span>
      <span className="flex-1 truncate">{label}</span>
      {hint && <span className="text-[10px] font-semibold text-slate-400">{hint}</span>}
    </button>
  )
}

function IconTool({ icon: Icon, label, onClick, spinning }: { icon: typeof Eye; label: string; onClick: (event: ReactMouseEvent) => void; spinning?: boolean }) {
  return (
    <button type="button" onClick={onClick} title={label} aria-label={label}
      className="ds-control flex h-9 w-9 items-center justify-center rounded-xl text-slate-600 hover:text-[var(--selection-text)]">
      <Icon className={`h-4 w-4 ${spinning ? 'animate-spin' : ''}`} />
    </button>
  )
}

function EmptyState({ icon: Icon, title, text }: { icon: typeof Eye; title: string; text: string }) {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100 text-slate-400"><Icon className="h-8 w-8" /></span>
      <p className="text-sm font-bold text-slate-700">{title}</p>
      {text && <p className="max-w-sm text-xs text-slate-500">{text}</p>}
    </div>
  )
}

function InlineRename({ value, onCommit, onCancel, className = '' }: { value: string; onCommit: (name: string) => void; onCancel: () => void; className?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const input = ref.current
    if (!input) return
    input.focus()
    const dot = value.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 ? dot : value.length)
  }, [value])
  return (
    <input ref={ref} defaultValue={value} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(event.currentTarget.value)
        else if (event.key === 'Escape') onCancel()
      }}
      onBlur={(event) => onCommit(event.currentTarget.value)}
      className={`w-full rounded-md bg-white px-1.5 py-0.5 text-[13px] font-semibold text-slate-800 shadow-[var(--ds-shadow-focus)] outline-none ${className}`} />
  )
}

type ItemViewProps = {
  item: DriveItem
  selected: boolean
  dropping: boolean
  renaming: boolean
  badges: ReactNode
  onRename: (name: string) => void
  onCancelRename: () => void
  onMenu: (event: ReactMouseEvent) => void
} & Record<string, unknown>

function ItemIcon({ item, size }: { item: DriveItem; size: 'sm' | 'lg' }) {
  const Icon = iconFor(item)
  // Automatic class/session folders are tinted violet, like in the sidebar tree.
  const tone = item.kind === 'folder' && item.is_system ? 'var(--logo-violet)' : CATEGORY_META[categoryOf(item)].tone
  return <Icon className={size === 'lg' ? 'h-10 w-10' : 'h-5 w-5 shrink-0'} style={{ color: tone }} strokeWidth={size === 'lg' ? 1.5 : 2} />
}

function GridCard({ item, selected, dropping, renaming, badges, onRename, onCancelRename, onMenu, ...rest }: ItemViewProps) {
  const category = categoryOf(item)
  const wantsThumb = item.kind === 'file' && category === 'image' && (item.size_bytes ?? 0) <= THUMB_MAX_BYTES
  const { ref, url } = useThumbnail(item, wantsThumb)
  const tone = CATEGORY_META[category].tone
  const sub = item.kind === 'folder'
    ? `${item.child_count ?? 0} ${item.child_count === 1 ? 'elemento' : 'elementi'}`
    : [item.created_by_student, formatDate(item.updated_at)].filter(Boolean).join(' · ')
  return (
    <div {...rest} ref={ref} role="button" tabIndex={0} aria-selected={selected}
      className={`group relative flex cursor-default select-none flex-col overflow-hidden rounded-2xl transition-all ${selected ? 'ds-selected' : 'ds-control hover:shadow-[var(--ds-shadow-2)]'} ${dropping ? 'ring-2 ring-[var(--app-accent)]' : ''}`}>
      <div className="relative flex h-28 items-center justify-center overflow-hidden" style={{ background: `color-mix(in srgb, ${tone} 9%, transparent)` }}>
        {url ? <img src={url} alt="" draggable={false} className="h-full w-full object-cover" /> : <ItemIcon item={item} size="lg" />}
        {item.is_system && <span className="absolute left-2 top-2 rounded-full bg-white/85 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-500">{item.session_id ? 'Sessione' : item.class_id ? 'Classe' : 'Auto'}</span>}
      </div>
      <div className="flex items-start gap-2 px-3 py-2.5">
        <ItemIcon item={item} size="sm" />
        <div className="min-w-0 flex-1">
          {renaming ? <InlineRename value={item.name} onCommit={onRename} onCancel={onCancelRename} /> : (
            <p className="truncate text-[13px] font-semibold text-slate-800" title={item.name}>{item.name}</p>
          )}
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-slate-500">{badges}<span className="truncate">{sub}</span></p>
        </div>
        <button type="button" onClick={onMenu} className="-mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-slate-400 opacity-0 hover:bg-slate-100 group-hover:opacity-100 focus:opacity-100" aria-label="Azioni">
          <MoreVertical className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}

function ListRow({ item, selected, dropping, renaming, badges, onRename, onCancelRename, onMenu, ...rest }: ItemViewProps) {
  return (
    <div {...rest} role="row" tabIndex={0} aria-selected={selected}
      className={`group grid cursor-default select-none grid-cols-[minmax(0,1fr)_120px] items-center gap-3 rounded-xl px-3 py-2 md:grid-cols-[minmax(0,1fr)_140px_120px_96px_40px] ${selected ? 'ds-selected' : 'hover:bg-[var(--ds-control-hover)]'} ${dropping ? 'ring-2 ring-[var(--app-accent)]' : ''}`}>
      <span className="flex min-w-0 items-center gap-3">
        <ItemIcon item={item} size="sm" />
        {renaming ? <InlineRename value={item.name} onCommit={onRename} onCancel={onCancelRename} /> : <span className="truncate font-semibold text-slate-800" title={item.name}>{item.name}</span>}
        <span className="flex shrink-0 items-center gap-1">{badges}</span>
      </span>
      <span className="hidden truncate text-xs text-slate-500 md:block">{item.created_by_student || (item.role === 'owner' ? 'Tu' : 'Docente')}</span>
      <span className="text-xs text-slate-500">{formatDate(item.updated_at)}</span>
      <span className="hidden text-xs text-slate-500 md:block">{item.kind === 'folder' ? `${item.child_count ?? 0} el.` : formatBytes(item.size_bytes)}</span>
      <button type="button" onClick={onMenu} className="hidden h-7 w-7 items-center justify-center rounded-full text-slate-400 opacity-0 hover:bg-slate-100 group-hover:opacity-100 md:flex" aria-label="Azioni">
        <MoreVertical className="h-4 w-4" />
      </button>
    </div>
  )
}

function FolderTree({ folders, activeId, dropTarget, onOpen, dropProps }: {
  folders: DriveFolderNode[]
  activeId: string | null
  dropTarget: string | null
  onOpen: (id: string) => void
  dropProps: (id: string) => Record<string, unknown>
}) {
  const children = useMemo(() => {
    const map = new Map<string | null, DriveFolderNode[]>()
    folders.forEach((folder) => { const list = map.get(folder.parent_id) ?? []; list.push(folder); map.set(folder.parent_id, list) })
    return map
  }, [folders])
  const parents = useMemo(() => new Map(folders.map((folder) => [folder.id, folder.parent_id])), [folders])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Reveal the active folder in the tree.
  useEffect(() => {
    if (!activeId) return
    setExpanded((current) => {
      const next = new Set(current)
      let cursor = parents.get(activeId) ?? null
      while (cursor) { next.add(cursor); cursor = parents.get(cursor) ?? null }
      return next
    })
  }, [activeId, parents])

  const render = (parentId: string | null, depth: number): ReactNode[] => (children.get(parentId) ?? []).map((folder) => {
    const kids = children.get(folder.id) ?? []
    const open = expanded.has(folder.id)
    const active = activeId === folder.id
    return (
      <div key={folder.id}>
        <div {...dropProps(folder.id)}
          className={`flex items-center rounded-lg pr-2 text-[13px] ${active ? 'ds-selected font-bold text-[var(--selection-text)]' : 'text-slate-600 hover:bg-[var(--ds-control-hover)]'} ${dropTarget === folder.id ? 'ring-2 ring-[var(--app-accent)]' : ''}`}
          style={{ paddingLeft: depth * 14 }}>
          <button type="button" aria-label={open ? 'Comprimi' : 'Espandi'}
            className={`flex h-7 w-6 shrink-0 items-center justify-center text-slate-400 ${kids.length ? '' : 'invisible'}`}
            onClick={() => setExpanded((current) => { const next = new Set(current); open ? next.delete(folder.id) : next.add(folder.id); return next })}>
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? '' : '-rotate-90'}`} />
          </button>
          <button type="button" onClick={() => onOpen(folder.id)} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left">
            <Folder className="h-4 w-4 shrink-0" style={{ color: folder.is_system ? 'var(--logo-violet)' : 'var(--logo-blue)' }} />
            <span className="truncate">{folder.name}</span>
          </button>
        </div>
        {open && render(folder.id, depth + 1)}
      </div>
    )
  })
  return <div className="flex flex-col gap-0.5 pl-1">{render(null, 0)}</div>
}

function UploadPanel({ jobs, onClose }: { jobs: UploadJob[]; onClose: () => void }) {
  const active = jobs.filter((job) => job.status === 'uploading').length
  return (
    <div className="ds-popover rounded-[var(--ds-radius-panel)] fixed bottom-4 right-4 z-[60] w-80 overflow-hidden" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between bg-slate-50/80 px-4 py-2.5">
        <p className="text-xs font-bold text-slate-700">{active ? `Caricamento di ${active} ${active === 1 ? 'gruppo' : 'gruppi'}…` : 'Caricamenti completati'}</p>
        {!active && (
          <button type="button" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200" aria-label="Chiudi">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="max-h-56 overflow-y-auto p-2">
        {jobs.map((job) => (
          <div key={job.id} className="px-2 py-1.5">
            <div className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-700">{job.label}</span>
              {job.status === 'done' && <Check className="h-3.5 w-3.5 text-emerald-600" />}
              {job.status === 'error' && <X className="h-3.5 w-3.5 text-red-600" />}
              {job.status === 'uploading' && <span className="text-[10px] text-slate-400">{Math.round(job.progress * 100)}%</span>}
            </div>
            {job.status === 'error' ? <p className="mt-0.5 text-[11px] text-red-600">{job.error}</p> : (
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-slate-200">
                <div className={`h-full rounded-full transition-[width] ${job.status === 'done' ? 'bg-emerald-500' : 'bg-[var(--app-accent)]'}`} style={{ width: `${Math.max(job.progress * 100, 3)}%` }} />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function NewFolderDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => Promise<void> }) {
  const [name, setName] = useState('Nuova cartella')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    try { await onCreate(name.trim()) } finally { setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Nuova cartella</DialogTitle></DialogHeader>
        <DialogBody>
          <input autoFocus value={name} onChange={(event) => setName(event.target.value)} onFocus={(event) => event.target.select()}
            onKeyDown={(event) => { if (event.key === 'Enter') void submit() }}
            className="ds-control h-11 w-full rounded-xl px-3 text-sm outline-none focus:shadow-[var(--ds-shadow-focus)]" />
        </DialogBody>
        <DialogFooter>
          <Button type="button" tone="neutral" surface="ghost" onClick={onClose}>Annulla</Button>
          <Button type="button" tone="accent" surface="solid" onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Crea
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
