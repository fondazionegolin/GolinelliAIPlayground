/**
 * Isolates the ink of one colour inside a region of the source (a curve, a line, a coloured label), so a highlight can
 * light up exactly that stroke instead of its bounding box. Browser-only: reads pixels through a canvas.
 */
export type RGB = [number, number, number]

// Same words the server uses to snap pins ("la curva blu", "retta rossa").
const COLOR_WORDS: Array<[string, RGB]> = [['blu', [45, 80, 225]], ['azzurr', [60, 150, 240]], ['ross', [215, 45, 55]], ['verd', [40, 155, 75]],
  ['giall', [225, 195, 30]], ['arancio', [240, 140, 25]], ['viola', [125, 60, 200]], ['rosa', [235, 100, 170]], ['ner', [25, 25, 25]]]
const INK = 38, MATCH = 120, MAX_SIDE = 1400

export function colorHint(...texts: Array<string | null | undefined>): RGB | null {
  const words = texts.filter(Boolean).join(' ').toLowerCase()
  return COLOR_WORDS.find(([word]) => words.includes(word))?.[1] ?? null
}

const cache = new Map<string, Promise<{ url: string; color: RGB } | null>>()
const images = new Map<string, Promise<HTMLImageElement>>()

function load(src: string): Promise<HTMLImageElement> {
  if (!images.has(src)) images.set(src, new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src }))
  return images.get(src)!
}

/** `box` is in source pixels. Resolves to a transparent PNG with only the matching ink, or null if there is none. */
export function inkMask(src: string, box: { x: number; y: number; width: number; height: number }, hint: RGB | null) {
  const key = [src, box.x, box.y, box.width, box.height, hint?.join()].join('|')
  if (!cache.has(key)) cache.set(key, compute(src, box, hint).catch(() => null))
  return cache.get(key)!
}

async function compute(src: string, box: { x: number; y: number; width: number; height: number }, hint: RGB | null) {
  const img = await load(src)
  const k = Math.min(1, MAX_SIDE / Math.max(box.width, box.height))
  const w = Math.max(1, Math.round(box.width * k)), h = Math.max(1, Math.round(box.height * k))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, box.x, box.y, box.width, box.height, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h)
  const px = data.data
  // Local background: median of the border, per channel.
  const border: number[][] = [[], [], []]
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) for (let c = 0; c < 3; c++) border[c].push(px[(y * w + x) * 4 + c])
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) for (let c = 0; c < 3; c++) border[c].push(px[(y * w + x) * 4 + c])
  const bg = border.map(values => values.sort((a, b) => a - b)[values.length >> 1])
  const isInk = (i: number) => Math.max(Math.abs(px[i] - bg[0]), Math.abs(px[i + 1] - bg[1]), Math.abs(px[i + 2] - bg[2])) > INK
  let color = hint
  if (!color) {  // no colour named: the most frequent saturated ink colour of the region
    const bins = new Map<string, { n: number; sum: RGB }>()
    for (let i = 0; i < px.length; i += 4) {
      if (!isInk(i) || Math.max(px[i], px[i + 1], px[i + 2]) - Math.min(px[i], px[i + 1], px[i + 2]) < 60) continue
      const bin = `${px[i] >> 5},${px[i + 1] >> 5},${px[i + 2] >> 5}`, entry = bins.get(bin) ?? { n: 0, sum: [0, 0, 0] }
      entry.n++; entry.sum[0] += px[i]; entry.sum[1] += px[i + 1]; entry.sum[2] += px[i + 2]; bins.set(bin, entry)
    }
    const top = [...bins.values()].sort((a, b) => b.n - a.n)[0]
    if (!top || top.n < 20) return null
    color = top.sum.map(v => Math.round(v / top.n)) as RGB
  }
  let matched = 0
  for (let i = 0; i < px.length; i += 4) {
    const hit = isInk(i) && Math.hypot(px[i] - color[0], px[i + 1] - color[1], px[i + 2] - color[2]) < MATCH
    if (hit) { matched++; px[i + 3] = 255 } else px[i + 3] = 0
  }
  if (matched < 20) return null
  ctx.putImageData(data, 0, 0)
  return { url: canvas.toDataURL('image/png'), color }
}
