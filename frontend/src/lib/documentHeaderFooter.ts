/** Page header / footer of a text document (saved as content.headerFooter, honoured by DOCX/PDF export). */
export type BandAlign = 'left' | 'center' | 'right'
export type BandItemType = 'logo' | 'text' | 'page'

/** One element of a band. `x` is its free horizontal position: 0 = flush left … 100 = flush right. */
export interface BandItem {
  id: string
  type: BandItemType
  x: number
  /** logo: image data URL and rendered height in CSS px. */
  url?: string
  height?: number
  /** text / page: content (text only) and character style. */
  text?: string
  fontFamily?: string
  sizePt?: number
  color?: string
  bold?: boolean
  italic?: boolean
}

export interface HeaderFooterBand {
  enabled: boolean
  /** Thin separator line between the band and the page body. */
  showRule: boolean
  /** Distance of the band from the page edge, in CSS pixels. */
  edgeOffset: number
  items: BandItem[]
}

export interface HeaderFooterConfig {
  header: HeaderFooterBand
  footer: HeaderFooterBand
}

export const MAX_BAND_ITEMS = 8
export const DEFAULT_TEXT_STYLE = { fontFamily: 'Arial', sizePt: 9, color: '#64748b', bold: false, italic: false }

export const newItemId = () => Math.random().toString(36).slice(2, 10)

export const DEFAULT_HEADER_BAND: HeaderFooterBand = { enabled: false, showRule: true, edgeOffset: 6, items: [] }
export const DEFAULT_FOOTER_BAND: HeaderFooterBand = { enabled: false, showRule: true, edgeOffset: 6, items: [] }
export const DEFAULT_HEADER_FOOTER: HeaderFooterConfig = { header: DEFAULT_HEADER_BAND, footer: DEFAULT_FOOTER_BAND }

const ALIGN_X: Record<BandAlign, number> = { left: 0, center: 50, right: 100 }
const clampX = (value: unknown, fallback = 0) => (typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : fallback)

function readItem(raw: unknown): BandItem | null {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<BandItem>
  const id = typeof value.id === 'string' && value.id ? value.id.slice(0, 16) : newItemId()
  const base = {
    id,
    x: clampX(value.x),
  }
  if (value.type === 'logo') {
    if (typeof value.url !== 'string' || !value.url.startsWith('data:image/')) return null
    return { ...base, type: 'logo', url: value.url, height: Math.min(120, Math.max(16, Number(value.height) || 36)) }
  }
  if (value.type === 'text' || value.type === 'page') {
    const text = value.type === 'text' ? (typeof value.text === 'string' ? value.text.slice(0, 200) : '') : undefined
    return {
      ...base,
      type: value.type,
      ...(text !== undefined ? { text } : {}),
      fontFamily: typeof value.fontFamily === 'string' && value.fontFamily ? value.fontFamily.slice(0, 60) : DEFAULT_TEXT_STYLE.fontFamily,
      sizePt: Math.min(48, Math.max(6, Number(value.sizePt) || DEFAULT_TEXT_STYLE.sizePt)),
      color: typeof value.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.color) ? value.color : DEFAULT_TEXT_STYLE.color,
      bold: value.bold === true,
      italic: value.italic === true,
    }
  }
  return null
}

/** Bands saved before free positioning stored one logo/text/page-number with a left/center/right slot. */
function migrateLegacyBand(value: Record<string, unknown>, defaultTextAlign: BandAlign): BandItem[] {
  const align = (candidate: unknown, fallback: BandAlign): BandAlign => (candidate === 'left' || candidate === 'center' || candidate === 'right' ? candidate : fallback)
  const items: BandItem[] = []
  if (typeof value.logoUrl === 'string' && value.logoUrl.startsWith('data:image/')) {
    items.push({
      id: newItemId(), type: 'logo', url: value.logoUrl, height: Math.min(120, Math.max(16, Number(value.logoHeight) || 36)),
      x: typeof value.logoX === 'number' ? clampX(value.logoX) : ALIGN_X[align(value.logoAlign, 'left')],
    })
  }
  if (typeof value.text === 'string' && value.text.trim()) {
    items.push({ id: newItemId(), type: 'text', text: value.text.slice(0, 200), x: ALIGN_X[align(value.textAlign, defaultTextAlign)], ...DEFAULT_TEXT_STYLE })
  }
  if (value.showPageNumber === true) {
    items.push({ id: newItemId(), type: 'page', x: ALIGN_X[align(value.pageNumberAlign, 'right')], ...DEFAULT_TEXT_STYLE })
  }
  return items
}

function readBand(raw: unknown, defaults: HeaderFooterBand, defaultTextAlign: BandAlign): HeaderFooterBand {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const items = Array.isArray(value.items)
    ? value.items.map(readItem).filter((item): item is BandItem => item !== null).slice(0, MAX_BAND_ITEMS)
    : migrateLegacyBand(value, defaultTextAlign)
  return {
    enabled: value.enabled === true,
    showRule: value.showRule !== false,
    edgeOffset: typeof value.edgeOffset === 'number' && Number.isFinite(value.edgeOffset) ? Math.min(60, Math.max(0, value.edgeOffset)) : defaults.edgeOffset,
    items,
  }
}

export function readHeaderFooter(raw: unknown): HeaderFooterConfig {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<'header' | 'footer', unknown>>
  return { header: readBand(value.header, DEFAULT_HEADER_BAND, 'right'), footer: readBand(value.footer, DEFAULT_FOOTER_BAND, 'left') }
}

export const bandHasContent = (band: HeaderFooterBand) => band.enabled && band.items.some((item) => item.type !== 'text' || Boolean(item.text?.trim()))

/** Reads an image file and returns a compact data URL (max 480×160 px box, PNG when it has transparency, else JPEG). */
export function imageFileToLogoDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) { reject(new Error('Seleziona un file immagine')); return }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Impossibile leggere il file'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => reject(new Error('Immagine non valida'))
      image.onload = () => {
        const scale = Math.min(1, 480 / image.width, 160 / image.height)
        const canvas = window.document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(image.width * scale))
        canvas.height = Math.max(1, Math.round(image.height * scale))
        const context = canvas.getContext('2d')
        if (!context) { reject(new Error('Canvas non disponibile')); return }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        const keepsAlpha = file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/svg+xml' || file.type === 'image/gif'
        resolve(canvas.toDataURL(keepsAlpha ? 'image/png' : 'image/jpeg', 0.9))
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

/** Gap between the band's content and its separator line (px). Mirrored by the DOCX writer (w:space = 3 pt). */
export const RULE_GAP = 4
const PX_PER_PT = 96 / 72
/** Share of the font size below the baseline (Arial/Liberation Sans descent). */
const DESCENT = 0.212
/** Line box height as a share of the font size (Arial/Liberation Sans "normal" leading). */
const LINE_FACTOR = 1.15

export interface BandMetrics {
  /** Space under the baseline taken by the text on the line; logos sit on the baseline, like inline images in Word. */
  descent: number
  /** Tallest a logo can be without pushing the body down. */
  logoMax: number
  contentHeight: number
  /** Content + gap + separator line. */
  outerHeight: number
}

/**
 * Single source of truth for band geometry: the sheet, the dialog preview and the DOCX/PDF export all derive
 * sizes from this (see docx_writer._band_metrics), so a logo is the same size and in the same place everywhere.
 */
export function bandMetrics(band: HeaderFooterBand, marginVertical: number): BandMetrics {
  const texts = band.items.filter((item) => item.type === 'page' || (item.type === 'text' && item.text?.trim()))
  const sizes = texts.map((item) => (item.sizePt ?? DEFAULT_TEXT_STYLE.sizePt) * PX_PER_PT)
  const descent = sizes.length ? Math.max(...sizes) * DESCENT : 0
  const textHeight = sizes.length ? Math.max(...sizes) * LINE_FACTOR : 0
  const available = Math.max(24, marginVertical - band.edgeOffset - RULE_GAP - 2)
  const logoMax = Math.max(12, Math.floor(available - descent))
  const logos = band.items.filter((item) => item.type === 'logo').map((item) => Math.min(item.height ?? 36, logoMax))
  const contentHeight = Math.max(12, textHeight, logos.length ? Math.max(...logos) + descent : 0)
  return { descent, logoMax, contentHeight, outerHeight: contentHeight + RULE_GAP + (band.showRule ? 1 : 0) }
}
export const textLineHeight = LINE_FACTOR
