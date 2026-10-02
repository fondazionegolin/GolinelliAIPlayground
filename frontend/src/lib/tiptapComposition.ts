import { Extension, wrappingInputRule } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { COMPOSITION_INDENT, getCompositionPrefs } from '@/lib/documentComposition'

// Abbreviations that end with a full stop but do not end a sentence (it, en): no capital after them.
const ABBREVIATIONS = new Set([
  'ecc', 'es', 'cfr', 'pag', 'pagg', 'art', 'artt', 'sig', 'sigg', 'dott', 'prof', 'ing', 'avv', 'vs', 'cap', 'fig', 'tab', 'sez', 'lett',
  'e.g', 'i.e', 'n', 'nr', 'pp', 'p', 'ss', 'seg', 'segg', 'etc', 'eg', 'ie', 'dr', 'mr', 'mrs', 'ms', 'st', 'no', 'vol', 'vv', 'ca', 'c.a', 'tel',
])

const LETTER = /^\p{Ll}$/u
const OPENERS = /(^|[\s(\[{«“‘—–-])$/

/** The last word before the sentence-ending punctuation, lowercased ("ecc" in "… ecc. "). */
function wordBeforeStop(textBefore: string): string {
  const match = /([\p{L}.]+)[.!?…]+["”»)']?\s+$/u.exec(textBefore)
  return match ? match[1].toLowerCase().replace(/\.$/, '') : ''
}

function startsSentence(textBefore: string): boolean {
  if (textBefore.length === 0) return true
  // An ellipsis is often mid-sentence: only . ! ? end a sentence.
  if (!/[.!?]["”»)']?\s+$/.test(textBefore) || /\.\.\s+$/.test(textBefore)) return false
  if (/\d[.]\s+$/.test(textBefore)) return false // "punto 3. a" / list-like numbering
  return !ABBREVIATIONS.has(wordBeforeStop(textBefore))
}

const compositionKey = new PluginKey('documentComposition')

/**
 * Compositional niceties while typing, all switchable from the "Composizione" menu:
 * lists from "- " / "1. " / "1) " / "• ", automatic capitals, typographic quotes/dashes/ellipsis,
 * double-space guard and a small first-line indent on new paragraphs.
 */
export const DocumentComposition = Extension.create({
  name: 'documentComposition',
  // Run before the default Enter/list keymaps so the indent logic can claim the keystroke.
  priority: 1000,

  addInputRules() {
    const { bulletList, orderedList } = this.editor.schema.nodes
    const rules = []
    if (bulletList) {
      rules.push(wrappingInputRule({ find: /^\s*([•·▪‣◦])\s$/, type: bulletList }))
    }
    if (orderedList) {
      rules.push(wrappingInputRule({
        find: /^(\d+)\)\s$/,
        type: orderedList,
        getAttributes: (match) => ({ start: Number(match[1]) }),
        joinPredicate: (match, node) => node.childCount + node.attrs.start === Number(match[1]),
      }))
    }
    return rules.map((rule) => {
      // Respect the preference: the rule only fires when automatic lists are on.
      const handler = rule.handler
      rule.handler = (props) => (getCompositionPrefs().lists ? handler(props) : null)
      return rule
    })
  },

  addKeyboardShortcuts() {
    return {
      'Mod-\\': ({ editor }) => {
        const { empty } = editor.state.selection
        if (empty) return false
        editor.chain().focus().unsetAllMarks().run()
        return true
      },
      'Mod-Alt-h': ({ editor }) => (editor.isActive('importedHighlight')
        ? editor.chain().focus().unsetMark('importedHighlight').run()
        : editor.chain().focus().setMark('importedHighlight', { color: '#fef08a' }).run()),
      Enter: ({ editor }) => {
        if (!getCompositionPrefs().indent) return false
        const { $from, empty } = editor.state.selection
        const parent = $from.parent
        // Only a body paragraph with text, directly in the page (not headings, lists, table cells, quotes).
        if (!empty || parent.type.name !== 'paragraph' || $from.depth !== 1 || parent.content.size === 0) return false
        if ($from.parentOffset === 0) return false
        return editor.chain().splitBlock().updateAttributes('paragraph', { textIndent: COMPOSITION_INDENT }).run()
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: compositionKey,
        props: {
          handleTextInput(view, from, to, text) {
            const prefs = getCompositionPrefs()
            const { state } = view
            const $from = state.doc.resolve(from)
            if (!$from.parent.isTextblock) return false
            const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
            const insert = (value: string, start = from) => { view.dispatch(state.tr.insertText(value, start, to)); return true }

            if (prefs.typography) {
              if (text === ' ' && /\s$/.test(textBefore) && from === to) return true // no double spaces
              if (text === '"') return insert(OPENERS.test(textBefore) ? '“' : '”')
              if (text === "'") return insert(OPENERS.test(textBefore) ? '‘' : '’')
              if (text === '.' && textBefore.endsWith('..') && from === to) {
                // third dot: "..", "." → "…"
                view.dispatch(state.tr.insertText('…', from - 2, to))
                return true
              }
              if (text === ' ' && /\S\s-$/.test(textBefore)) {
                // "word - word" → "word – word" (a leading "- " starts a list instead and is not touched here)
                view.dispatch(state.tr.insertText('– ', from - 1, to))
                return true
              }
            }

            if (prefs.capitalize && LETTER.test(text) && startsSentence(textBefore)) {
              // Not for list-marker-like starts such as "a) " — only a real first letter of a sentence.
              return insert(text.toUpperCase())
            }
            return false
          },
        },
      }),
    ]
  },
})
