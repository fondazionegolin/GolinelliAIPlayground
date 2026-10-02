import {
  Box, File, FileArchive, FileAudio, FileCode2, FileImage, FileSpreadsheet, FileText, FileVideo, Folder,
  Presentation, type LucideIcon,
} from 'lucide-react'

export type DriveRole = 'owner' | 'editor' | 'viewer'

export interface DriveItem {
  id: string
  parent_id: string | null
  kind: 'folder' | 'file' | 'link'
  name: string
  source_type: 'upload' | 'chat' | 'document' | 'presentation' | 'solid_model' | null
  source_id: string | null
  mime_type: string | null
  size_bytes: number | null
  class_id: string | null
  session_id: string | null
  is_system: boolean
  starred: boolean
  shared: boolean
  public: boolean
  public_token: string | null
  trashed_at: string | null
  created_at: string | null
  updated_at: string | null
  created_by_student: string | null
  child_count: number | null
  thumbnail: string | null
  role: DriveRole | null
}

export interface DriveFolderNode {
  id: string
  parent_id: string | null
  name: string
  is_system: boolean
  class_id: string | null
  session_id: string | null
  system_key: string | null
}

export interface DriveListing {
  items: DriveItem[]
  breadcrumb: { id: string; name: string }[]
  role: DriveRole | null
  folder?: DriveItem
}

export type DriveCategory = 'folder' | 'document' | 'presentation' | 'image' | 'model3d' | 'pdf' | 'video' | 'audio' | 'sheet' | 'code' | 'archive' | 'other'

export function categoryOf(item: Pick<DriveItem, 'kind' | 'source_type' | 'mime_type' | 'name'>): DriveCategory {
  if (item.kind === 'folder') return 'folder'
  if (item.source_type === 'document') return 'document'
  if (item.source_type === 'presentation') return 'presentation'
  if (item.source_type === 'solid_model') return 'model3d'
  const mime = item.mime_type || ''
  const ext = item.name.split('.').pop()?.toLowerCase() || ''
  if (mime.startsWith('model/') || ['glb', 'gltf', 'stl', 'obj'].includes(ext)) return 'model3d'
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.includes('spreadsheet') || mime.includes('excel') || ['csv', 'xlsx', 'xls', 'ods'].includes(ext)) return 'sheet'
  if (mime.includes('presentation') || mime.includes('powerpoint') || ['ppt', 'pptx', 'odp'].includes(ext)) return 'presentation'
  if (mime.includes('word') || ['doc', 'docx', 'odt', 'rtf', 'md'].includes(ext)) return 'document'
  if (mime.includes('zip') || ['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'archive'
  if (['py', 'js', 'ts', 'tsx', 'html', 'css', 'json', 'ipynb', 'c', 'cpp', 'java', 'sb3'].includes(ext)) return 'code'
  if (mime.startsWith('text/')) return 'document'
  return 'other'
}

export const CATEGORY_META: Record<DriveCategory, { label: string; icon: LucideIcon; tone: string }> = {
  folder: { label: 'Cartella', icon: Folder, tone: 'var(--logo-blue)' },
  document: { label: 'Documento', icon: FileText, tone: '#2f6fed' },
  presentation: { label: 'Presentazione', icon: Presentation, tone: '#f08a24' },
  image: { label: 'Immagine', icon: FileImage, tone: 'var(--logo-pink)' },
  model3d: { label: 'Modello 3D', icon: Box, tone: 'var(--logo-violet)' },
  pdf: { label: 'PDF', icon: FileText, tone: '#e5484d' },
  video: { label: 'Video', icon: FileVideo, tone: '#d6409f' },
  audio: { label: 'Audio', icon: FileAudio, tone: '#12a594' },
  sheet: { label: 'Foglio di calcolo', icon: FileSpreadsheet, tone: '#30a46c' },
  code: { label: 'Codice', icon: FileCode2, tone: '#475569' },
  archive: { label: 'Archivio', icon: FileArchive, tone: '#a18072' },
  other: { label: 'File', icon: File, tone: '#64748b' },
}

export function iconFor(item: DriveItem): LucideIcon {
  if (item.kind === 'folder') return Folder
  return CATEGORY_META[categoryOf(item)].icon
}

export const FILTERS: { id: 'all' | DriveCategory; label: string }[] = [
  { id: 'all', label: 'Tutti' },
  { id: 'folder', label: 'Cartelle' },
  { id: 'document', label: 'Documenti' },
  { id: 'presentation', label: 'Presentazioni' },
  { id: 'image', label: 'Immagini' },
  { id: 'model3d', label: 'Modelli 3D' },
  { id: 'pdf', label: 'PDF' },
  { id: 'video', label: 'Video' },
]

export type SortKey = 'name' | 'updated' | 'size' | 'type'

export function sortItems(items: DriveItem[], key: SortKey, asc: boolean): DriveItem[] {
  const dir = asc ? 1 : -1
  return [...items].sort((a, b) => {
    // Folders always first, like every desktop file manager.
    if ((a.kind === 'folder') !== (b.kind === 'folder')) return a.kind === 'folder' ? -1 : 1
    let delta = 0
    if (key === 'updated') delta = (Date.parse(a.updated_at || '') || 0) - (Date.parse(b.updated_at || '') || 0)
    else if (key === 'size') delta = (a.size_bytes ?? 0) - (b.size_bytes ?? 0)
    else if (key === 'type') delta = categoryOf(a).localeCompare(categoryOf(b))
    if (delta === 0) delta = a.name.localeCompare(b.name, 'it', { numeric: true, sensitivity: 'base' })
    return delta * dir
  })
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toLocaleString('it-IT', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

export const canEdit = (role: DriveRole | null | undefined) => role === 'owner' || role === 'editor'

/** Deep link to the platform editor for a linked artifact (teacher side). */
export function editorPathFor(item: DriveItem): string | null {
  // Editors open only the teacher's own artifacts; student work is previewed/exported from the drive.
  if (!item.source_id || item.created_by_student) return null
  if (item.source_type === 'document' || item.source_type === 'presentation') return `/teacher/documents?open=${item.source_id}`
  if (item.source_type === 'solid_model') return `/teacher/3d-lab?model=${item.source_id}`
  return null
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** Filename from a Content-Disposition header (RFC 5987 aware). */
export function filenameFromDisposition(header: string | undefined, fallback: string): string {
  if (!header) return fallback
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (star) {
    try { return decodeURIComponent(star[1]) } catch { /* fall through */ }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain ? plain[1] : fallback
}
