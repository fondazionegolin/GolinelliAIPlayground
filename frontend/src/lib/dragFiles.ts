import { driveApi } from '@/lib/api'
import { filenameFromDisposition } from '@/components/drive/driveTypes'

/**
 * Universal in-app file drag & drop.
 *
 * Producers (chat attachments, the session files explorer, the Files drive) tag their drag with one of
 * these MIME types; any drop target can call `filesFromUniversalDrag` to turn it into real `File`s,
 * whatever section of the platform it came from.
 */
export const DRIVE_ITEM_MIME = 'application/x-drive-item'
export const SESSION_FILE_MIME = 'application/x-session-file'
export const DESKTOP_FILE_MIME = 'desktop/file'

export interface DraggedFileRef {
  filename: string
  mime_type?: string | null
  /** Direct (or `/files/.../download-url`) URL, for attachments that live outside the drive. */
  url?: string
}

export interface DraggedDriveItem {
  id: string
  name: string
  kind: 'folder' | 'file' | 'link'
  mime_type?: string | null
}

/** Tag a drag started from a plain file reference (e.g. a chat attachment). */
export function setFileDrag(event: { dataTransfer: DataTransfer }, ref: DraggedFileRef) {
  const payload = JSON.stringify(ref)
  event.dataTransfer.setData(SESSION_FILE_MIME, payload)
  event.dataTransfer.setData(DESKTOP_FILE_MIME, payload)
  event.dataTransfer.effectAllowed = 'copyMove'
}

/** Tag a drag started from drive items (their bytes need an authenticated fetch, so only ids travel). */
export function setDriveItemsDrag(event: { dataTransfer: DataTransfer }, items: DraggedDriveItem[]) {
  event.dataTransfer.setData(DRIVE_ITEM_MIME, JSON.stringify(items))
  event.dataTransfer.effectAllowed = 'copyMove'
}

export function hasUniversalFileDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  const types = Array.from(dataTransfer?.types || [])
  return types.includes(DRIVE_ITEM_MIME) || types.includes(SESSION_FILE_MIME) || types.includes(DESKTOP_FILE_MIME)
}

async function fileFromUrl(ref: DraggedFileRef): Promise<File | null> {
  if (!ref.url) return null
  let url = ref.url
  if (url.includes('/api/v1/files/') && url.endsWith('/download-url')) {
    const json = await (await fetch(url)).json()
    url = json.download_url || json.url || url
  }
  const blob = await (await fetch(url)).blob()
  return new File([blob], ref.filename || 'file', { type: ref.mime_type || blob.type || 'application/octet-stream' })
}

/** Resolve whatever the platform put in a drag into real files (folders are skipped). */
export async function filesFromUniversalDrag(dataTransfer: DataTransfer): Promise<File[]> {
  const files: File[] = []
  const driveRaw = dataTransfer.getData(DRIVE_ITEM_MIME)
  if (driveRaw) {
    const items = JSON.parse(driveRaw) as DraggedDriveItem[]
    for (const item of items) {
      if (item.kind === 'folder') continue
      // Linked platform artifacts (documents, presentations…) have no stored bytes: export them instead.
      const res = item.kind === 'file' ? await driveApi.content(item.id) : await driveApi.exportItem(item.id)
      const blob = res.data as Blob
      const name = item.kind === 'file' ? item.name : filenameFromDisposition(res.headers['content-disposition'], item.name)
      files.push(new File([blob], name, { type: (item.kind === 'file' && item.mime_type) || blob.type || 'application/octet-stream' }))
    }
    return files
  }
  const refRaw = dataTransfer.getData(SESSION_FILE_MIME) || dataTransfer.getData(DESKTOP_FILE_MIME)
  if (refRaw) {
    const file = await fileFromUrl(JSON.parse(refRaw) as DraggedFileRef)
    if (file) files.push(file)
  }
  return files
}
