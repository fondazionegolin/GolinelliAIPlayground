import { Extension } from '@tiptap/core'

/** Adds fontSize support to the TextStyle mark. Shared by RichTextEditor (document mode) and SlideTextBlock (slide mode) so both apply/read font size the same way. */
export const FontSizeExtension = Extension.create({
  name: 'fontSize',
  addGlobalAttributes() {
    return [{
      types: ['textStyle'],
      attributes: {
        fontSize: {
          default: null,
          parseHTML: (element: HTMLElement) => element.style.fontSize || null,
          renderHTML: (attributes: Record<string, unknown>) => {
            if (!attributes.fontSize) return {}
            return { style: `font-size: ${attributes.fontSize}` }
          },
        },
      },
    }]
  },
})
