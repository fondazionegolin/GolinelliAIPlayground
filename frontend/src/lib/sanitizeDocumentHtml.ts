import DOMPurify from 'dompurify'

// Separate instance: the default DOMPurify singleton carries the slide-text style hook
// (see sanitizeSlideHtml.ts), which would strip layout styles such as text-align from documents.
const documentPurify = DOMPurify(window)

/**
 * Sanitizes rich-text document HTML (TipTap output, imported files, student submissions) before
 * it is rendered with dangerouslySetInnerHTML in previews and read-only views. Keeps normal
 * formatting markup; drops scripts, event handlers, iframes, forms and javascript: URLs.
 */
export function sanitizeDocumentHtml(html: string): string {
  return documentPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed'],
  })
}
