/** Page setup of a text document (saved as content.page, honoured by DOCX/PDF export). */
export type PageSize = 'a4' | 'letter'
export type PageOrientation = 'portrait' | 'landscape'

export interface PageSetup {
  size: PageSize
  orientation: PageOrientation
}

export const DEFAULT_PAGE_SETUP: PageSetup = { size: 'a4', orientation: 'portrait' }

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
  return {
    size: value.size === 'letter' ? 'letter' : 'a4',
    orientation: value.orientation === 'landscape' ? 'landscape' : 'portrait',
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
