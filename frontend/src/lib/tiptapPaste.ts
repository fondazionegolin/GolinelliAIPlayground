import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { cleanPastedHtml } from '@/lib/pasteCleanup'
import { looksLikeMarkdown, renderMarkdownToHtml } from '@/lib/markdown'

/** Reads a pasted image and shrinks it (max 1400 px wide, JPEG/PNG) so documents stay light. */
function imageFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read'))
    reader.onload = () => {
      const image = new Image()
      image.onerror = () => resolve(String(reader.result))
      image.onload = () => {
        const scale = Math.min(1, 1400 / image.width)
        if (scale === 1 && file.size < 400_000) { resolve(String(reader.result)); return }
        const canvas = window.document.createElement('canvas')
        canvas.width = Math.round(image.width * scale)
        canvas.height = Math.round(image.height * scale)
        const context = canvas.getContext('2d')
        if (!context) { resolve(String(reader.result)); return }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88))
      }
      image.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Paste behaviour closer to Google Docs / Word:
 * - Ctrl+V: source formatting is kept where it carries meaning (bold, links, lists, tables, headings, highlights)
 *   but cleaned (no Word debris, source body font/size dropped so the text adopts the document's);
 * - Ctrl+Shift+V: plain text (ProseMirror default);
 * - Markdown pasted as plain text (e.g. from a chat) becomes real headings, lists and emphasis;
 * - images pasted from the clipboard are inserted (downscaled).
 */
export const SmartPaste = Extension.create({
  name: 'smartPaste',

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: new PluginKey('smartPaste'),
        props: {
          transformPastedHTML: (html) => cleanPastedHtml(html),
          handlePaste: (view, event) => {
            const data = event.clipboardData
            if (!data) return false
            const plainOnly = Boolean((view as unknown as { input?: { shiftKey?: boolean } }).input?.shiftKey)
            if (plainOnly) return false

            const html = data.getData('text/html')
            const text = data.getData('text/plain')

            const image = Array.from(data.files || []).find((file) => file.type.startsWith('image/'))
            if (image && !html.trim() && !text.trim()) {
              void imageFileToDataUrl(image).then((src) => { editor.chain().focus().setImage({ src }).run() })
              return true
            }
            if (!html.trim() && text && looksLikeMarkdown(text.trim())) {
              editor.chain().focus().insertContent(renderMarkdownToHtml(text.trim())).run()
              return true
            }
            return false
          },
        },
      }),
    ]
  },
})
