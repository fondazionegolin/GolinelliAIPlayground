export class DocumentExportImageError extends Error {}

async function officeImageBlob(blob: Blob): Promise<Blob> {
  if (!blob.type.includes('svg')) return blob
  // Office and Google need a bitmap fallback for SVG pictograms.
  const image = new Image()
  const objectUrl = URL.createObjectURL(blob)
  try {
    image.src = objectUrl
    await image.decode()
    const canvas = document.createElement('canvas')
    const scale = Math.min(2, 3840 / Math.max(image.naturalWidth || 300, image.naturalHeight || 300))
    canvas.width = Math.max(1, Math.round((image.naturalWidth || 300) * scale))
    canvas.height = Math.max(1, Math.round((image.naturalHeight || 300) * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new DocumentExportImageError('Impossibile convertire un’icona SVG')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result ? resolve(result) : reject(new DocumentExportImageError('Impossibile convertire un’icona SVG')), 'image/png'))
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

/** Make the exported copy self-contained while retaining the editor's original URLs. */
export async function embedExportImages(contentJson: string, authHeaders: Record<string, string> = {}): Promise<string> {
  const content = JSON.parse(contentJson)
  const cache = new Map<string, Promise<string>>()
  const embed = (source: string): Promise<string> => {
    if (!source || source.startsWith('data:') && !source.startsWith('data:image/svg')) return Promise.resolve(source)
    if (!cache.has(source)) cache.set(source, (async () => {
      const url = new URL(source, window.location.href)
      if (!['http:', 'https:', 'blob:'].includes(url.protocol) && !source.startsWith('data:image/svg')) throw new DocumentExportImageError('Formato immagine non esportabile')
      const local = url.origin === window.location.origin
      const response = await fetch(url.href, {
        headers: local ? authHeaders : {}, credentials: local ? 'same-origin' : 'omit',
        redirect: local ? 'error' : 'follow',
        signal: AbortSignal.timeout(20000),
      })
      if (!response.ok) throw new DocumentExportImageError('Impossibile caricare un’immagine per l’esportazione')
      const blob = await officeImageBlob(await response.blob())
      if (!blob.type.startsWith('image/')) throw new DocumentExportImageError('La risorsa non è un’immagine')
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new DocumentExportImageError('Impossibile incorporare un’immagine'))
        reader.readAsDataURL(blob)
      })
    })().catch(() => { throw new DocumentExportImageError('Impossibile incorporare un’immagine. Verifica che sia ancora accessibile o sostituiscila e riprova.') }))
    return cache.get(source)!
  }
  // Sequential traversal bounds memory for long decks; repeated assets are loaded only once.
  for (const slide of content.slides || []) {
    for (const block of slide.blocks || []) {
      if (block.type === 'image' && !block.hidden) block.content = await embed(block.content)
    }
  }
  for (const key of ['htmlContent', 'content']) {
    if (typeof content[key] !== 'string' || !content[key].includes('<img')) continue
    const doc = new DOMParser().parseFromString(content[key], 'text/html')
    for (const image of Array.from(doc.images)) image.setAttribute('src', await embed(image.getAttribute('src') || ''))
    content[key] = doc.body.innerHTML
  }
  if (content.header?.logoUrl) content.header.logoUrl = await embed(content.header.logoUrl)
  // Header/footer bands may contain logos, including multiple independently positioned items.
  const embedLogos = async (node: unknown): Promise<void> => {
    if (!node || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    for (const [key, value] of Object.entries(record)) {
      if ((key === 'logoUrl' || key === 'url' && record.type === 'logo') && typeof value === 'string') record[key] = await embed(value)
      else if (value && typeof value === 'object') await embedLogos(value)
    }
  }
  await embedLogos(content.headerFooter)
  return JSON.stringify(content)
}
