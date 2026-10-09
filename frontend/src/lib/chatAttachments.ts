import api, { llmApi } from '@/lib/api'

export interface MessageAttachment {
  name: string
  kind: 'image' | 'file'
  /** Image thumbnail: data URL (fresh upload) or server path (reloaded history). */
  url?: string
}

const THUMB_SIDE = 320

function imageThumbnail(file: File): Promise<string | undefined> {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const scale = Math.min(1, THUMB_SIDE / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.75))
      } catch {
        resolve(undefined)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(undefined)
    }
    img.src = objectUrl
  })
}

/** Small self-contained thumbnails (data URLs) so they survive localStorage caches and reloads. */
export async function buildMessageAttachments(files: File[]): Promise<MessageAttachment[]> {
  return Promise.all(
    files.map(async (file): Promise<MessageAttachment> => {
      if (file.type.startsWith('image/')) {
        return { name: file.name, kind: 'image', url: await imageThumbnail(file) }
      }
      try {
        const formData = new FormData()
        formData.append('file', file)
        const { data } = await api.post<{ thumbnail_url?: string }>('/llm/files/preview', formData)
        return { name: file.name, kind: 'file', url: data.thumbnail_url }
      } catch {
        return { name: file.name, kind: 'file' }
      }
    }),
  )
}

/** Rebuild attachments from the backend `content_json.files` of a saved message. */
export function attachmentsFromContentJson(contentJson: any): MessageAttachment[] | undefined {
  const files = Array.isArray(contentJson) ? contentJson : contentJson?.files
  if (!Array.isArray(files) || files.length === 0) return undefined
  return files.map((f: any): MessageAttachment => ({
    name: String(f.filename ?? f.name ?? 'file'),
    kind: String(f.mime_type ?? '').startsWith('image/') ? 'image' : 'file',
    url: typeof f.url === 'string' ? f.url : undefined,
  }))
}

const GENERATED_IMAGE_RE = /!\[[^\]]*\]\(([^)\s]+)\)/

/**
 * Text-only follow-up ("togli lo sfondo"): when a picture appears in the recent conversation,
 * the backend intent router decides whether the message edits it. If so, the most recent
 * picture is returned as a File so the edit continues in line, without re-attaching it.
 */
export async function implicitEditImage(
  messages: { role: string; content: string }[],
  text: string,
): Promise<File | null> {
  const recent = messages.slice(-6)
  let url: string | undefined
  for (let i = recent.length - 1; i >= 0 && !url; i--) {
    if (recent[i].role === 'assistant') url = GENERATED_IMAGE_RE.exec(recent[i].content)?.[1]
  }
  if (!url || !text.trim()) return null
  try {
    const { data } = await llmApi.routeIntent(text, recent.map(m => ({ role: m.role, content: m.content })))
    if (data?.intent !== 'edit_image' || data?.image !== 'previous') return null
    const res = await fetch(url)
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) return null
    return new File([blob], 'immagine-precedente.' + (blob.type.split('/')[1] || 'png'), { type: blob.type })
  } catch {
    return null
  }
}
