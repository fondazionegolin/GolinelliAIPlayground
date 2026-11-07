import api from '@/lib/api'
import { tl } from '@/i18n/tl'

export const VIBE_MAX_IMAGES = 3
export const VIBE_MAX_DOCS = 4
const MAX_DATA_URL_CHARS = 1_900_000 // server rejects > 2M chars
export const VIBE_DOC_ACCEPT = '.pdf,.doc,.docx,.pptx,.xlsx,.xls,.csv,.txt,.md,.json,.html,.css,.js,.jsx,.ts,.tsx,.py,.xml,.yaml,.yml'

export interface VibeDocument { name: string; text: string; truncated?: boolean }

export const isImageFile = (file: File) => file.type.startsWith('image/')

/** Downscales a screenshot to a JPEG data URL small enough for the generate endpoint. */
export function imageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        let side = 1600
        let quality = 0.82
        for (let i = 0; i < 6; i += 1) {
          const scale = Math.min(1, side / Math.max(img.width, img.height))
          const canvas = document.createElement('canvas')
          canvas.width = Math.max(1, Math.round(img.width * scale))
          canvas.height = Math.max(1, Math.round(img.height * scale))
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('canvas')
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
          const url = canvas.toDataURL('image/jpeg', quality)
          if (url.length <= MAX_DATA_URL_CHARS) return resolve(url)
          side = Math.round(side * 0.75)
          quality = Math.max(0.5, quality - 0.08)
        }
        reject(new Error(tl("Immagine troppo grande.")))
      } catch (err) {
        reject(err)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error(tl("Immagine non leggibile.")))
    }
    img.src = objectUrl
  })
}

/** Server-side text extraction (PDF, Word, PowerPoint, Excel, CSV, text/code); personal data is masked there. */
export async function extractDocument(file: File): Promise<VibeDocument> {
  const form = new FormData()
  form.append('file', file)
  const { data } = await api.post<{ filename: string; text: string; truncated: boolean }>('/coding/ai/extract-document', form, { timeout: 120000 })
  return { name: data.filename || file.name, text: data.text, truncated: data.truncated }
}
