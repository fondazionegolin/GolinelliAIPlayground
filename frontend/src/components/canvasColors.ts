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
