import { Extension } from '@tiptap/core'

type StyleAttribute = { attribute: string; cssProperty: string; parse: (value: string) => string | null }

const lengthValue = (value: string) => (/^-?[\d.]+(px|pt|em|rem|cm|mm|in)$/i.test(value.trim()) ? value.trim() : null)
const lineHeightValue = (value: string) => (/^[\d.]+(px|pt|em|%)?$/i.test(value.trim()) ? value.trim() : null)

const ATTRIBUTES: StyleAttribute[] = [
  { attribute: 'lineHeight', cssProperty: 'line-height', parse: lineHeightValue },
  { attribute: 'spaceBefore', cssProperty: 'margin-top', parse: lengthValue },
  { attribute: 'spaceAfter', cssProperty: 'margin-bottom', parse: lengthValue },
  { attribute: 'textIndent', cssProperty: 'text-indent', parse: lengthValue },
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
      attributes: Object.fromEntries(ATTRIBUTES.map(({ attribute, cssProperty, parse }) => [attribute, {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const raw = element.style.getPropertyValue(cssProperty)
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
