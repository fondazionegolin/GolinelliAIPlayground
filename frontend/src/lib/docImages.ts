import type { DocImage } from '@/lib/docMarkdown'

const MAX_SIDE = 1280

export function newDocImageId(existing: DocImage[] = []): string {
  const used = new Set(existing.map(image => image.id))
  for (let n = existing.length + 1; ; n++) if (!used.has(`img${n}`)) return `img${n}`
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Immagine non leggibile'))
    img.src = src
  })
}

/** Downscale + JPEG-encode so the picture stays self-contained inside the shared HTML without bloating it. */
async function shrinkToDataUrl(src: string, keepPng = false): Promise<string> {
  const img = await loadImage(src)
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas non disponibile')
  if (!keepPng) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height) }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return keepPng ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85)
}

export async function fileToDocImageSrc(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try { return await shrinkToDataUrl(url, file.type === 'image/png' && file.size < 600_000) } finally { URL.revokeObjectURL(url) }
}

/** Remote/relative URL (AI-generated images) → data URL via fetch so the canvas is not tainted. */
export async function urlToDocImageSrc(url: string): Promise<string> {
  if (url.startsWith('data:')) return shrinkToDataUrl(url)
  const response = await fetch(url)
  if (!response.ok) throw new Error('Immagine non scaricabile')
  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  try { return await shrinkToDataUrl(objectUrl) } finally { URL.revokeObjectURL(objectUrl) }
}
