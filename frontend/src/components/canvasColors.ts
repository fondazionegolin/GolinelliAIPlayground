/** Label ink for document fills; never depends on the surrounding application theme. */
export function canvasLabelColor(background: string, preferred = '#171717', opacity = 1): string {
  const rgba = (color: string): number[] | null => {
    if (color === 'transparent' || color === 'none') return [255, 255, 255, 0]
    if (color === 'white') return [255, 255, 255, 1]
    if (color === 'black') return [0, 0, 0, 1]
    const match = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(color)
    if (!match) return null
    const hex = match[1].length < 5 ? [...match[1]].map(c => c + c).join('') : match[1]
    return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)).concat(hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1)
  }
  const luminance = (rgb: number[]) => rgb.slice(0, 3).reduce((sum, c, i) => {
    const s = c / 255
    return sum + (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i]
  }, 0)
  const bg = rgba(background), ink = rgba(preferred)
  if (!bg || !ink) return preferred
  // The document paper is white. Account for translucent fills before choosing ink.
  const alpha = bg[3] * Math.max(0, Math.min(1, opacity))
  const paper = bg.slice(0, 3).map(c => c * alpha + 255 * (1 - alpha))
  const light = luminance(paper)
  const contrast = (value: number) => (Math.max(light, value) + 0.05) / (Math.min(light, value) + 0.05)
  const preferredLight = luminance(ink.slice(0, 3).map((c, i) => c * ink[3] + paper[i] * (1 - ink[3])))
  if (contrast(preferredLight) >= 4.5) return preferred
  if (contrast(luminance([23, 23, 23])) >= 4.5) return '#171717'
  return contrast(0) >= contrast(1) ? '#000000' : '#ffffff'
}

const parseHex = (color: string): [number, number, number] | null => {
  const match = /^#([\da-f]{3}|[\da-f]{6})([\da-f]{2})?$/i.exec(color || '')
  if (!match) return null
  const hex = match[1].length === 3 ? [...match[1]].map(c => c + c).join('') : match[1]
  return [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}
const toHex = (rgb: number[]) => `#${rgb.map(c => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')).join('')}`

function toHsl([r, g, b]: number[]): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn), l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === rn ? (gn - bn) / d + (gn < bn ? 6 : 0) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4
  return [h / 6, s, l]
}

function fromHsl([h, s, l]: number[]): number[] {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const hue = (t: number) => {
    const k = t < 0 ? t + 1 : t > 1 ? t - 1 : t
    return k < 1 / 6 ? p + (q - p) * 6 * k : k < 1 / 2 ? q : k < 2 / 3 ? p + (q - p) * (2 / 3 - k) * 6 : p
  }
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)].map(c => c * 255)
}

/** The default border of a filled figure: the same hue as its fill, a little darker (tone on tone). */
export function shapeStrokeFor(fill: string): string {
  const rgb = parseHex(fill)
  if (!rgb) return '#64748b'
  const [h, s, l] = toHsl(rgb)
  return toHex(fromHsl([h, Math.min(1, s * 1.05 + 0.04), l > 0.6 ? l - 0.24 : Math.max(0.08, l * 0.68)]))
}

/** Whether a border still follows its fill (so a new fill should bring a new tone along). */
export function isToneStroke(stroke: string, fill: string): boolean {
  return !stroke || stroke.toLowerCase() === shapeStrokeFor(fill).toLowerCase() || ['#0369a1', '#1e3a8a'].includes(stroke.toLowerCase())
}

/** The light top of a figure's soft vertical shading: its fill mixed with white. */
export function shadeTopFor(fill: string, amount = 0.45): string {
  const rgb = parseHex(fill)
  return rgb ? toHex(rgb.map(c => c + (255 - c) * amount)) : fill
}
