import { Extension } from '@tiptap/core'
import { LEGACY_ENTER_INDENT } from '@/lib/documentComposition'

type StyleAttribute = { attribute: string; cssProperty: string; parse: (value: string) => string | null; keepOnSplit?: boolean }

const lengthValue = (value: string) => (/^-?[\d.]+(px|pt|em|rem|cm|mm|in)$/i.test(value.trim()) ? value.trim() : null)
const lineHeightValue = (value: string) => (/^[\d.]+(px|pt|em|%)?$/i.test(value.trim()) ? value.trim() : null)

const ATTRIBUTES: StyleAttribute[] = [
  { attribute: 'lineHeight', cssProperty: 'line-height', parse: lineHeightValue },
  // Enter starts a clean paragraph: spacing and first-line indent of the previous one are not carried over
  // (they used to pile up as an unexpected margin on every new line). Line spacing is kept.
  { attribute: 'spaceBefore', cssProperty: 'margin-top', parse: lengthValue, keepOnSplit: false },
  { attribute: 'spaceAfter', cssProperty: 'margin-bottom', parse: lengthValue, keepOnSplit: false },
  { attribute: 'textIndent', cssProperty: 'text-indent', parse: lengthValue, keepOnSplit: false },
]

/**
 * Paragraph-level spacing for the word processor: line spacing, space before/after and first-line
 * indent. Stored as inline CSS (line-height, margin-top, margin-bottom, text-indent) on paragraphs and
 * headings so it round-trips through the saved HTML and the DOCX/PDF export.
 */
export const ParagraphFormatExtension = Extension.create({
  name: 'paragraphFormat',
  addGlobalAttributes() {
    return [{
      types: ['paragraph', 'heading'],
      attributes: Object.fromEntries(ATTRIBUTES.map(({ attribute, cssProperty, parse, keepOnSplit = true }) => [attribute, {
        default: null,
        keepOnSplit,
        parseHTML: (element: HTMLElement) => {
          const raw = element.style.getPropertyValue(cssProperty)
          // Indents added automatically by the old Enter behaviour are dropped when the document is opened.
          if (attribute === 'textIndent' && raw.trim() === LEGACY_ENTER_INDENT) return null
          return raw ? parse(raw) : null
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const value = attributes[attribute]
          return value ? { style: `${cssProperty}: ${value}` } : {}
        },
      }])),
    }]
  },
})
