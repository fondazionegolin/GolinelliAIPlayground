/**
 * SVG files on the board. They are kept inline as data URLs (nothing uploaded) and only ever shown through <img>, where
 * scripts never run; they are still cleaned so that the document stays safe if it is opened elsewhere (export, report).
 */

const MAX_SVG_CHARS = 2_500_000

/** Removes scripts, event handlers, foreign content and links to the outside world; makes sure the root has a namespace. */
export function sanitizeSvg(text: string): string | null {
  const start = text.search(/<svg[\s>]/i)
  if (start < 0 || text.length > MAX_SVG_CHARS) return null
  let svg = text.slice(start)
  const end = svg.toLowerCase().lastIndexOf('</svg>')
  if (end < 0) return null
  svg = svg.slice(0, end + 6)
  svg = svg
    .replace(/<script[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, '')
    .replace(/<!ENTITY[\s\S]*?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/\s(?:xlink:)?href\s*=\s*("\s*(?:javascript:|https?:|\/\/)[^"]*"|'\s*(?:javascript:|https?:|\/\/)[^']*')/gi, '')
    .replace(/url\(\s*['"]?\s*(?:https?:)?\/\/[^)]*\)/gi, 'none')
  if (!/<svg[^>]*\sxmlns\s*=/i.test(svg)) svg = svg.replace(/<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  return svg
}

export function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

/** Natural size from width/height or the viewBox (a bare SVG would otherwise come out as 150×150). */
export function svgSize(svg: string): { w: number; h: number } {
  const root = svg.match(/<svg[^>]*>/i)?.[0] || ''
  const num = (name: string) => { const m = root.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(px)?\\s*["']`, 'i')); return m ? parseFloat(m[1]) : NaN }
  const box = root.match(/viewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)\s*["']/i)
  const w = num('width'), h = num('height')
  if (w > 0 && h > 0) return { w, h }
  if (box && parseFloat(box[1]) > 0 && parseFloat(box[2]) > 0) return { w: parseFloat(box[1]), h: parseFloat(box[2]) }
  return { w: 320, h: 240 }
}

export const isSvgFile = (file: File) => file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)

/** A prepared board image from an SVG file or pasted markup: `null` when it is not a usable SVG. */
export async function svgFromFile(file: File): Promise<{ src: string; w: number; h: number } | null> {
  return svgFromText(await file.text())
}

export function svgFromText(text: string): { src: string; w: number; h: number } | null {
  const clean = sanitizeSvg(text)
  if (!clean) return null
  const { w, h } = svgSize(clean)
  return { src: svgToDataUrl(clean), w, h }
}

/** Fits the natural size into a comfortable first size on the board (longest side ≤ `max`). */
export function fitSize(w: number, h: number, max = 420): { w: number; h: number } {
  const k = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(40, Math.round(w * k)), h: Math.max(40, Math.round(h * k)) }
}
