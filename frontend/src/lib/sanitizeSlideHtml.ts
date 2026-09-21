import DOMPurify from 'dompurify'

const ALLOWED_STYLE_PROPERTIES = new Set(['color', 'font-family', 'font-weight', 'font-style', 'text-decoration', 'font-size'])

// DOMPurify only allows/strips the whole "style" attribute — it has no built-in per-property
// allowlist — so a hook filters individual declarations. Named + hooked once at module scope
// since DOMPurify hooks are global; the hook itself only ever touches `style` attributes.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!(node instanceof Element) || !node.hasAttribute('style')) return
  const style = node.getAttribute('style') || ''
  const kept = style
    .split(';')
    .map(declaration => {
      const [prop, ...rest] = declaration.split(':')
      const property = prop?.trim().toLowerCase()
      const value = rest.join(':').trim()
      return property && value && ALLOWED_STYLE_PROPERTIES.has(property) ? `${property}: ${value}` : null
    })
    .filter((declaration): declaration is string => Boolean(declaration))
    .join('; ')
  if (kept) node.setAttribute('style', kept)
  else node.removeAttribute('style')
})

/**
 * Sanitizes a slide text block's TipTap-authored HTML before it enters app state / gets
 * persisted. Mirrors the server-side allowlist (backend/app/services/slide_sanitizer.py) —
 * client-side sanitization is a UX/defense-in-depth layer, the server pass is the real trust
 * boundary since a modified client could otherwise smuggle arbitrary HTML into a saved deck
 * that other users later render via dangerouslySetInnerHTML.
 */
export function sanitizeSlideHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'strong', 'em', 'u', 'span', 'br'],
    ALLOWED_ATTR: ['style'],
  })
}
