import { Extension, InputRule } from '@tiptap/core'
import { getCompositionPrefs } from '@/lib/documentComposition'

/**
 * Word-style automatic lists for the document editor.
 * - Bullets: "- ", "* ", "+ " (StarterKit), "• " / "1) " (DocumentComposition) plus "– ", "— " here
 *   (macOS/iOS turn "-" into a dash). Follows the «Elenchi automatici» switch.
 * - Tab at the start of a paragraph turns it into a bulleted list; inside a list Tab / Shift+Tab
 *   indent / outdent the item. Tab never moves the focus out of the sheet.
 */
export const SmartLists = Extension.create({
  name: 'smartLists',
  priority: 1000,

  addInputRules() {
    const bullet = new InputRule({
      find: /^\s*([–—])\s$/,
      handler: ({ range, chain }) => {
        if (!getCompositionPrefs().lists) return null
        chain().deleteRange(range).toggleBulletList().run()
      },
    })
    return [bullet]
  },

  addKeyboardShortcuts() {
    const inList = () => this.editor.isActive('listItem')
    return {
      Tab: () => {
        if (!this.editor.isEditable) return false
        if (inList()) {
          // Cannot indent the first item of a list: keep the caret in the sheet anyway.
          this.editor.commands.sinkListItem('listItem')
          return true
        }
        const { $from, empty } = this.editor.state.selection
        if (!empty || this.editor.isActive('table')) return false
        if ($from.parent.type.name === 'paragraph' && $from.parentOffset === 0 && getCompositionPrefs().lists) {
          return this.editor.commands.toggleBulletList()
        }
        // Mid-line Tab: a real tab character (the sheet keeps white space), not a focus jump.
        if ($from.parent.isTextblock) return this.editor.commands.insertContent('\t')
        return false
      },
      'Shift-Tab': () => {
        if (!this.editor.isEditable || !inList()) return false
        if (!this.editor.commands.liftListItem('listItem')) return true
        return true
      },
    }
  },
})
