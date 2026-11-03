import { Extension } from '@tiptap/core'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'

type CssAttribute = [attribute: string, cssProperty: string]

function cssAttributes(entries: CssAttribute[]) {
  return Object.fromEntries(entries.map(([attribute, css]) => [attribute, {
    default: null,
    parseHTML: (element: HTMLElement) => element.style.getPropertyValue(css) || null,
    renderHTML: (attributes: Record<string, string | null>) => attributes[attribute] ? { style: `${css}: ${attributes[attribute]}` } : {},
  }]))
}

/** Formatting that PowerPoint carries and the base TipTap schema would drop on load: paragraph
 * spacing and indents, list markers, tracking, sub/superscript, highlight, numeric weights. */
export const SlideTypography = Extension.create({
  name: 'slideTypography',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: cssAttributes([
          ['lineHeight', 'line-height'], ['marginTop', 'margin-top'], ['marginBottom', 'margin-bottom'],
          ['marginLeft', 'margin-left'], ['marginRight', 'margin-right'], ['textIndent', 'text-indent'],
        ]),
      },
      {
        types: ['bulletList', 'orderedList'],
        attributes: cssAttributes([['listStyleType', 'list-style-type'], ['paddingLeft', 'padding-left']]),
      },
      {
        types: ['textStyle'],
        attributes: cssAttributes([
          ['letterSpacing', 'letter-spacing'], ['verticalAlign', 'vertical-align'],
          ['backgroundColor', 'background-color'], ['fontWeight', 'font-weight'],
        ]),
      },
    ]
  },
})

const rawStyle = {
  style: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('style'),
    renderHTML: (attributes: Record<string, string | null>) => attributes.style ? { style: attributes.style } : {},
  },
}

const StyledCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...rawStyle } } })
const StyledHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...rawStyle } } })
const StyledRow = TableRow.extend({ addAttributes() { return { ...this.parent?.(), ...rawStyle } } })

/** Imported PowerPoint tables: fills, borders and paddings live on the cells themselves. */
export const SlideTableExtensions = [Table.configure({ resizable: false }), StyledRow, StyledCell, StyledHeader]
