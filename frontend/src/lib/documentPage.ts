/** Page setup of a text document (saved as content.page, honoured by DOCX/PDF export). */
export type PageSize = 'a4' | 'letter'
export type PageOrientation = 'portrait' | 'landscape'

export interface PageSetup {
  size: PageSize
  orientation: PageOrientation
  /** Document line spacing (multiple of the 16 px / 12 pt body size): it sets the baseline grid row. */
  lineSpacing: number
}

/** Body text size of the sheet (12 pt). */
export const DOC_BODY_PX = 16
export const DEFAULT_LINE_SPACING = 1.75
export const LINE_SPACING_OPTIONS = [1.15, 1.5, 1.75, 2, 2.5, 3]

export const DEFAULT_PAGE_SETUP: PageSetup = { size: 'a4', orientation: 'portrait', lineSpacing: DEFAULT_LINE_SPACING }

/** Height of one row of the baseline grid in CSS px (whole pixels, so 100 pages never accumulate rounding). */
export function documentRow(setup: Pick<PageSetup, 'lineSpacing'>): number {
  return Math.max(16, Math.round(DOC_BODY_PX * (setup.lineSpacing || DEFAULT_LINE_SPACING)))
}

/** Writing area of a sheet: a whole number of rows (the remainder is added to the bottom margin). */
export function documentUsableHeight(pageHeight: number, marginTop: number, marginBottom: number, row: number): number {
  const content = Math.max(row, pageHeight - marginTop - marginBottom)
  return Math.max(row, Math.floor(content / row + 1e-6) * row)
}

/** Ruling of one row: a hairline just under the baseline of 12 pt Arial set in a `row`-high line box. */
export function documentRulingBackground(row: number): string {
  const y = Math.min(row - 1, Math.round(row / 2 + 6.8))
  const rule = 'rgba(163, 163, 163, 0.38)'
  return `repeating-linear-gradient(to bottom, transparent 0, transparent ${y}px, ${rule} ${y}px, ${rule} ${y + 1}px, transparent ${y + 1}px, transparent ${row}px)`
}

// CSS pixels at 96 dpi.
const PAGE_SIZES: Record<PageSize, { width: number; height: number; label: string }> = {
  a4: { width: 794, height: 1123, label: 'A4' },
  letter: { width: 816, height: 1056, label: 'Letter' },
}

export const PAGE_SIZE_OPTIONS = (Object.keys(PAGE_SIZES) as PageSize[]).map((value) => ({ value, label: PAGE_SIZES[value].label }))

export function pageDimensions(setup: PageSetup): { width: number; height: number } {
  const { width, height } = PAGE_SIZES[setup.size] ?? PAGE_SIZES.a4
  return setup.orientation === 'landscape' ? { width: height, height: width } : { width, height }
}

export function readPageSetup(raw: unknown): PageSetup {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<PageSetup>
  const lineSpacing = Number(value.lineSpacing)
  return {
    size: value.size === 'letter' ? 'letter' : 'a4',
    orientation: value.orientation === 'landscape' ? 'landscape' : 'portrait',
    lineSpacing: Number.isFinite(lineSpacing) && lineSpacing >= 1 && lineSpacing <= 4 ? lineSpacing : DEFAULT_LINE_SPACING,
  }
}

const DOCUMENT_AGENT_PREF_KEY = 'documents.builderOpen'

/** Document Builder is shown by default on wide screens; the user's last open/close choice wins. */
export function readDocumentAgentPreference(): boolean {
  try {
    const stored = window.localStorage.getItem(DOCUMENT_AGENT_PREF_KEY)
    if (stored !== null) return stored === '1'
  } catch {
    /* storage unavailable */
  }
  return window.innerWidth >= 1280
}

export function saveDocumentAgentPreference(open: boolean) {
  try {
    window.localStorage.setItem(DOCUMENT_AGENT_PREF_KEY, open ? '1' : '0')
  } catch {
    /* storage unavailable */
  }
}

/**
 * Indexes of the top-level blocks that start a new sheet in the editor (the pagination widgets sit right before them).
 * Sent with the export so the PDF/DOCX breaks pages exactly where the sheet does.
 */
export function collectPageBreaks(root: HTMLElement | null | undefined): number[] {
  if (!root) return []
  const breaks: number[] = []
  let index = 0
  for (const child of Array.from(root.children)) {
    if (child.classList.contains('document-page-separator')) { breaks.push(index); continue }
    index += 1
  }
  return breaks
}

/** Adds the editor's page starts to a serialized document_v1 payload (other payload kinds pass through untouched). */
export function withPageBreaks(contentJson: string, root: HTMLElement | null | undefined): string {
  try {
    const content = JSON.parse(contentJson)
    if (!content || typeof content !== 'object' || typeof content.htmlContent !== 'string') return contentJson
    return JSON.stringify({ ...content, pageBreaks: collectPageBreaks(root) })
  } catch {
    return contentJson
  }
}
