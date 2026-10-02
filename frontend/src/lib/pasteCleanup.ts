import { DOC_FONTS } from '@/lib/documentTextFormat'

/**
 * Cleans HTML from the clipboard (Word, Google Docs, web pages) so pasted text looks like it belongs to the
 * document instead of dragging its source along: inline styles are reduced to what carries meaning, the body
 * font/size/colour of the source are dropped (the text adopts the destination's), Word's fake lists become
 * real lists, and the usual debris (mso-*, classes, empty spans, &nbsp;) disappears.
 */

const DROP_TAGS = ['script', 'style', 'meta', 'link', 'title', 'head', 'xml', 'object', 'iframe', 'noscript', 'o\\:p', 'o:p']
const BLACKISH = /^(#0{3}(0{3})?|#1[0-9a-f]1[0-9a-f]1[0-9a-f]|#2[0-3]2[0-3]2[0-3]|black|windowtext|rgb\(\s*(0|[1-3]?\d)\s*,\s*(0|[1-3]?\d)\s*,\s*(0|[1-3]?\d)\s*\)|inherit|initial|currentcolor)$/i
/** Near-black (text) colours carry no meaning: the destination's text colour wins. */
function isDarkNeutral(value: string): boolean {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  let channels: number[] | null = null
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1]
    channels = [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16))
  } else {
    const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value.trim())
    if (rgb) channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  }
  return !!channels && Math.max(...channels) <= 0x55 && Math.max(...channels) - Math.min(...channels) <= 24
}
const NO_BACKGROUND = /^(transparent|inherit|initial|none|#fff(fff)?|white|rgba?\(\s*255\s*,\s*255\s*,\s*255(\s*,\s*[\d.]+)?\s*\)|window)$/i

const fontKey = (value: string) => value.split(',')[0].trim().replace(/^['"]|['"]$/g, '').toLowerCase()
const KNOWN_FONTS = new Map(DOC_FONTS.map((font) => [font.toLowerCase(), font]))

function pointsOf(value: string | undefined): number | null {
  const match = /^\s*([\d.]+)\s*(pt|px|em|rem)?\s*$/i.exec(value || '')
  if (!match) return null
  const number = Number(match[1])
  switch ((match[2] || 'px').toLowerCase()) {
    case 'pt': return number
    case 'px': return number * 0.75
    default: return number * 12
  }
}

function parseStyle(style: string | null): Record<string, string> {
  const result: Record<string, string> = {}
  for (const declaration of (style || '').split(';')) {
    const index = declaration.indexOf(':')
    if (index < 0) continue
    result[declaration.slice(0, index).trim().toLowerCase()] = declaration.slice(index + 1).trim()
  }
  return result
}

/** Most used value (by amount of text) of a style property: this is the source's "body" setting. */
function dominant(root: HTMLElement, property: 'font-size' | 'font-family'): string | null {
  const weight = new Map<string, number>()
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const length = (node.textContent || '').trim().length
    if (!length) continue
    let value: string | null = null
    for (let element = node.parentElement; element && element !== root.parentElement; element = element.parentElement) {
      const declared = parseStyle(element.getAttribute('style'))[property]
      if (declared) { value = property === 'font-size' ? String(pointsOf(declared)?.toFixed(1)) : fontKey(declared); break }
    }
    const key = value ?? '__none__'
    weight.set(key, (weight.get(key) ?? 0) + length)
  }
  let best: string | null = null
  let bestWeight = 0
  weight.forEach((amount, key) => { if (amount > bestWeight) { best = key; bestWeight = amount } })
  return best === '__none__' ? null : best
}

/** Word marks list paragraphs with mso-list and a fake marker span; rebuild real <ul>/<ol>. */
function rebuildWordLists(body: HTMLElement) {
  const doc = body.ownerDocument
  const isListParagraph = (element: Element) => element.tagName === 'P' && (/mso-list/i.test(element.getAttribute('style') || '') || /MsoListParagraph/i.test(element.getAttribute('class') || ''))
  let current: { list: HTMLElement; level: number }[] = []
  for (const paragraph of Array.from(body.querySelectorAll('p'))) {
    if (!isListParagraph(paragraph)) { current = []; continue }
    const levelMatch = /level(\d+)/i.exec(paragraph.getAttribute('style') || '')
    const level = levelMatch ? Number(levelMatch[1]) : 1
    // The marker lives in <span style="mso-list:Ignore">1.</span>; its text tells bullets from numbers.
    const marker = Array.from(paragraph.querySelectorAll('span')).find((span) => /mso-list\s*:\s*ignore/i.test(span.getAttribute('style') || ''))
    const markerText = (marker?.textContent || '').replace(/ /g, ' ').trim()
    const ordered = /^(\d+|[a-zA-Z]|[ivxlcdm]+)[.)]$/i.test(markerText)
    marker?.remove()
    const item = doc.createElement('li')
    const text = doc.createElement('p')
    text.innerHTML = paragraph.innerHTML
    item.appendChild(text)

    while (current.length && current[current.length - 1].level > level) current.pop()
    let top = current[current.length - 1]
    if (!top || top.level < level || top.list.tagName !== (ordered ? 'OL' : 'UL')) {
      const list = doc.createElement(ordered ? 'ol' : 'ul')
      if (top && top.level < level) top.list.lastElementChild?.appendChild(list)
      else paragraph.parentNode?.insertBefore(list, paragraph)
      if (top && top.level === level) current.pop()
      current.push({ list, level })
      top = current[current.length - 1]
    }
    top.list.appendChild(item)
    paragraph.remove()
  }
}

function cleanElementStyle(element: HTMLElement, drop: { size: string | null; family: string | null; singleFamily: boolean }) {
  const source = parseStyle(element.getAttribute('style'))
  const kept: string[] = []
  const isHeading = /^H[1-6]$/.test(element.tagName)
  const weight = source['font-weight']
  if (!isHeading && weight && (/^(bold|bolder|[6-9]00)$/i.test(weight))) kept.push('font-weight: 700')
  if (source['font-style'] === 'italic') kept.push('font-style: italic')
  const decoration = source['text-decoration'] || source['text-decoration-line']
  if (decoration && /underline|line-through/.test(decoration)) kept.push(`text-decoration: ${/underline/.test(decoration) ? 'underline' : 'line-through'}`)
  if (source.color && !BLACKISH.test(source.color) && !isDarkNeutral(source.color)) kept.push(`color: ${source.color}`)
  if (source['background-color'] && !NO_BACKGROUND.test(source['background-color'])) kept.push(`background-color: ${source['background-color']}`)
  // Headings take the destination's heading style; a single family across the paste is just the source's body font.
  if (source['font-family'] && !isHeading && !drop.singleFamily) {
    const key = fontKey(source['font-family'])
    const known = KNOWN_FONTS.get(key)
    if (known && key !== drop.family) kept.push(`font-family: ${known}`)
  }
  if (source['font-size'] && !isHeading) {
    const points = pointsOf(source['font-size'])
    if (points && String(points.toFixed(1)) !== drop.size && points >= 6 && points <= 72) kept.push(`font-size: ${Math.round(points * 2) / 2}pt`)
  }
  const align = source['text-align'] || element.getAttribute('align')
  if (align && /^(center|right|justify)$/i.test(align) && /^(P|H[1-6]|DIV|LI)$/.test(element.tagName)) kept.push(`text-align: ${align.toLowerCase()}`)
  const indent = pointsOf(source['text-indent'])
  if (indent && indent > 4 && indent < 80 && element.tagName === 'P') kept.push(`text-indent: ${Math.round(indent * 4 / 3)}px`)
  element.removeAttribute('class')
  element.removeAttribute('id')
  element.removeAttribute('lang')
  element.removeAttribute('dir')
  element.removeAttribute('align')
  if (kept.length) element.setAttribute('style', kept.join('; '))
  else element.removeAttribute('style')
}

export function cleanPastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body
  if (!body) return html
  for (const selector of DROP_TAGS) { try { body.querySelectorAll(selector).forEach((node) => node.remove()) } catch { /* invalid selector in this engine */ } }
  // Comments (Word conditionals, <!--StartFragment-->)
  const comments = doc.createTreeWalker(body, NodeFilter.SHOW_COMMENT)
  const toRemove: Node[] = []
  for (let node = comments.nextNode(); node; node = comments.nextNode()) toRemove.push(node)
  toRemove.forEach((node) => node.parentNode?.removeChild(node))

  // Google Docs wraps everything in <b id="docs-internal-guid-…" style="font-weight:normal">.
  body.querySelectorAll('b[id^="docs-internal-guid"]').forEach((wrapper) => wrapper.replaceWith(...Array.from(wrapper.childNodes)))

  rebuildWordLists(body)

  // Legacy <font> → span with style.
  body.querySelectorAll('font').forEach((font) => {
    const span = doc.createElement('span')
    const style: string[] = []
    const color = font.getAttribute('color')
    if (color) style.push(`color: ${color}`)
    const face = font.getAttribute('face')
    if (face) style.push(`font-family: ${face}`)
    if (style.length) span.setAttribute('style', style.join('; '))
    span.append(...Array.from(font.childNodes))
    font.replaceWith(span)
  })

  const families = new Set<string>()
  body.querySelectorAll<HTMLElement>('[style]').forEach((element) => {
    const family = parseStyle(element.getAttribute('style'))['font-family']
    if (family) families.add(fontKey(family))
  })
  const drop = { size: dominant(body, 'font-size'), family: dominant(body, 'font-family'), singleFamily: families.size <= 1 }
  body.querySelectorAll<HTMLElement>('*').forEach((element) => {
    if (element.tagName === 'A') {
      const href = element.getAttribute('href')
      for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name)
      if (href && !/^\s*javascript:/i.test(href)) element.setAttribute('href', href)
      return
    }
    if (element.tagName === 'IMG') {
      const src = element.getAttribute('src')
      for (const attribute of Array.from(element.attributes)) if (!['src', 'alt', 'width', 'height'].includes(attribute.name)) element.removeAttribute(attribute.name)
      if (!src) element.remove()
      return
    }
    if (/^(TD|TH)$/.test(element.tagName)) {
      for (const attribute of Array.from(element.attributes)) if (!['colspan', 'rowspan'].includes(attribute.name)) element.removeAttribute(attribute.name)
      return
    }
    if (/^(TABLE|THEAD|TBODY|TFOOT|TR|COLGROUP|COL|CAPTION)$/.test(element.tagName)) {
      for (const attribute of Array.from(element.attributes)) element.removeAttribute(attribute.name)
      return
    }
    cleanElementStyle(element, drop)
  })

  // Spans that no longer carry anything.
  body.querySelectorAll('span').forEach((span) => { if (!span.attributes.length) span.replaceWith(...Array.from(span.childNodes)) })
  // Non-breaking spaces pasted from Word/web become normal spaces.
  const texts = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT)
  for (let node = texts.nextNode(); node; node = texts.nextNode()) node.textContent = (node.textContent || '').replace(/ /g, ' ')
  // Empty paragraphs: keep at most one in a row (Word uses them as spacing).
  let emptyRun = 0
  Array.from(body.children).forEach((child) => {
    const empty = child.tagName === 'P' && !child.textContent?.trim() && !child.querySelector('img')
    emptyRun = empty ? emptyRun + 1 : 0
    if (empty && emptyRun > 1) child.remove()
  })
  body.querySelectorAll('span:empty, b:empty, i:empty, strong:empty, em:empty, u:empty').forEach((node) => node.remove())
  return body.innerHTML
}
