/**
 * Local background removal for images pasted on the smart canvas. Nothing leaves the browser.
 *
 * The background colours are learned from the image border (up to three clusters, in CIE Lab), then a flood fill
 * grows from the border through every pixel that is close to one of them AND changes only gently from its
 * neighbour. The gradient guard lets it cross soft shadows or vignettes but stop at a real edge. What the fill
 * cannot reach is the subject: small islands are dropped, the edge is feathered one pixel.
 * It is meant for objects photographed or drawn on a plain-ish background; `confident` says when it was not.
 */

export interface CutoutResult {
  /** RGBA pixels, background transparent. */
  data: Uint8ClampedArray
  width: number
  height: number
  /** Share of the image kept as subject (0..1). */
  coverage: number
  /** False when the background was not plain enough (or nothing/everything was removed): the result needs a look. */
  confident: boolean
  /** Bounding box of the subject, in pixels. */
  box: { x: number; y: number; w: number; h: number }
}

type Lab = Float32Array

function srgbToLinear(c: number) {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
}

/** Converts RGBA bytes to an interleaved Lab buffer (L, a, b per pixel). */
export function toLab(rgba: ArrayLike<number>, count: number): Lab {
  const out = new Float32Array(count * 3)
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  for (let i = 0; i < count; i++) {
    const r = srgbToLinear(rgba[i * 4]), g = srgbToLinear(rgba[i * 4 + 1]), b = srgbToLinear(rgba[i * 4 + 2])
    const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
    const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b)
    const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
    out[i * 3] = 116 * y - 16
    out[i * 3 + 1] = 500 * (x - y)
    out[i * 3 + 2] = 200 * (y - z)
  }
  return out
}

const dist = (a: Lab, i: number, b: ArrayLike<number>, j: number) => {
  const dl = a[i] - b[j], da = a[i + 1] - b[j + 1], db = a[i + 2] - b[j + 2]
  return Math.sqrt(dl * dl + da * da + db * db)
}

interface Centroid { l: number; a: number; b: number; share: number; spread: number }

/** Learns up to three background colours from the border ring with a few k-means rounds. */
function borderCentroids(lab: Lab, w: number, h: number): Centroid[] {
  const ring = Math.max(2, Math.round(Math.min(w, h) * 0.012))
  const samples: number[] = []
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < ring || y < ring || x >= w - ring || y >= h - ring) samples.push((y * w + x) * 3)
    }
  }
  const step = Math.max(1, Math.floor(samples.length / 4000))
  const pts = samples.filter((_, i) => i % step === 0)
  const k = 3
  let centers: number[][] = []
  // farthest-point seeding: first the median-ish sample, then the sample farthest from the chosen ones
  centers.push([lab[pts[Math.floor(pts.length / 2)]], lab[pts[Math.floor(pts.length / 2)] + 1], lab[pts[Math.floor(pts.length / 2)] + 2]])
  while (centers.length < k) {
    let best = -1, bestD = -1
    for (const p of pts) {
      let d = Infinity
      for (const c of centers) d = Math.min(d, dist(lab, p, c, 0))
      if (d > bestD) { bestD = d; best = p }
    }
    if (best < 0 || bestD < 8) break
    centers.push([lab[best], lab[best + 1], lab[best + 2]])
  }
  const assign = new Int16Array(pts.length)
  for (let round = 0; round < 6; round++) {
    const sums = centers.map(() => [0, 0, 0, 0])
    pts.forEach((p, idx) => {
      let bi = 0, bd = Infinity
      centers.forEach((c, ci) => { const d = dist(lab, p, c, 0); if (d < bd) { bd = d; bi = ci } })
      assign[idx] = bi
      sums[bi][0] += lab[p]; sums[bi][1] += lab[p + 1]; sums[bi][2] += lab[p + 2]; sums[bi][3]++
    })
    centers = centers.map((c, ci) => (sums[ci][3] ? [sums[ci][0] / sums[ci][3], sums[ci][1] / sums[ci][3], sums[ci][2] / sums[ci][3]] : c))
  }
  const counts = centers.map(() => 0)
  const spreadSum = centers.map(() => 0)
  pts.forEach((p, idx) => { counts[assign[idx]]++; spreadSum[assign[idx]] += dist(lab, p, centers[assign[idx]], 0) })
  return centers
    .map((c, ci) => ({ l: c[0], a: c[1], b: c[2], share: counts[ci] / pts.length, spread: counts[ci] ? spreadSum[ci] / counts[ci] : 0 }))
    .filter((c) => c.share >= 0.08)
}

export function removeBackground(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): CutoutResult {
  const n = w * h
  const lab = toLab(rgba, n)
  const cents = borderCentroids(lab, w, h)
  const centerArr = cents.map((c) => [c.l, c.a, c.b])
  const maxSpread = Math.max(0, ...cents.map((c) => c.spread))
  // tolerance follows how noisy the background is (a studio sheet vs. a gradient wall)
  const tol = Math.min(42, Math.max(14, 11 + maxSpread * 2.4))
  const stepTol = Math.min(14, Math.max(5, 4 + maxSpread * 0.8))

  const bgDist = new Float32Array(n)
  for (let p = 0; p < n; p++) {
    let d = Infinity
    for (const c of centerArr) d = Math.min(d, dist(lab, p * 3, c, 0))
    bgDist[p] = d
  }

  const bg = new Uint8Array(n)
  const stack = new Int32Array(n)
  let sp = 0
  const push = (p: number) => { if (!bg[p]) { bg[p] = 1; stack[sp++] = p } }
  for (let x = 0; x < w; x++) { if (bgDist[x] < tol) push(x); if (bgDist[(h - 1) * w + x] < tol) push((h - 1) * w + x) }
  for (let y = 0; y < h; y++) { if (bgDist[y * w] < tol) push(y * w); if (bgDist[y * w + w - 1] < tol) push(y * w + w - 1) }
  while (sp > 0) {
    const p = stack[--sp]
    const x = p % w, y = (p - x) / w
    const visit = (q: number) => {
      if (bg[q] || bgDist[q] >= tol) return
      if (dist(lab, q * 3, lab, p * 3) > stepTol) return
      bg[q] = 1; stack[sp++] = q
    }
    if (x > 0) visit(p - 1)
    if (x < w - 1) visit(p + 1)
    if (y > 0) visit(p - w)
    if (y < h - 1) visit(p + w)
  }

  // subject = not background; keep the main component and the sizeable ones, drop specks
  const label = new Int32Array(n).fill(-1)
  const sizes: number[] = []
  for (let s = 0; s < n; s++) {
    if (bg[s] || label[s] >= 0) continue
    const id = sizes.length
    let size = 0
    sp = 0
    stack[sp++] = s; label[s] = id
    while (sp > 0) {
      const p = stack[--sp]
      size++
      const x = p % w
      if (x > 0 && !bg[p - 1] && label[p - 1] < 0) { label[p - 1] = id; stack[sp++] = p - 1 }
      if (x < w - 1 && !bg[p + 1] && label[p + 1] < 0) { label[p + 1] = id; stack[sp++] = p + 1 }
      if (p >= w && !bg[p - w] && label[p - w] < 0) { label[p - w] = id; stack[sp++] = p - w }
      if (p < n - w && !bg[p + w] && label[p + w] < 0) { label[p + w] = id; stack[sp++] = p + w }
    }
    sizes.push(size)
  }
  const biggest = Math.max(0, ...sizes)
  const keep = sizes.map((s) => s >= Math.max(biggest * 0.04, n * 0.0015))
  const fg = new Uint8Array(n)
  for (let p = 0; p < n; p++) fg[p] = label[p] >= 0 && keep[label[p]] ? 1 : 0

  // one-pixel feather: edge pixels get a partial alpha from their 3x3 neighbourhood
  const out = new Uint8ClampedArray(n * 4)
  let kept = 0
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x
      let acc = 0, cnt = 0
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          acc += fg[yy * w + xx]; cnt++
        }
      }
      let alpha = fg[p] ? (acc === cnt ? 255 : Math.round(255 * Math.max(0.35, acc / cnt))) : (acc ? Math.round(255 * Math.max(0, acc / cnt - 0.34)) : 0)
      if (alpha < 8) alpha = 0
      out[p * 4] = rgba[p * 4]; out[p * 4 + 1] = rgba[p * 4 + 1]; out[p * 4 + 2] = rgba[p * 4 + 2]; out[p * 4 + 3] = alpha
      if (fg[p]) {
        kept++
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  const coverage = kept / n
  const borderShare = cents.reduce((s, c) => s + c.share, 0)
  const confident = coverage > 0.03 && coverage < 0.92 && borderShare > 0.6 && maxSpread < 16
  const box = maxX >= 0 ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } : { x: 0, y: 0, w, h }
  return { data: out, width: w, height: h, coverage, confident, box }
}

export interface CutoutImage { src: string; width: number; height: number; coverage: number; confident: boolean }

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image'))
    img.src = src
  })
}

/** Cuts the subject out of an image URL / data URL; the PNG is cropped to the subject (with a small margin). */
export async function cutoutImage(src: string, maxSide = 1024): Promise<CutoutImage> {
  const img = await loadImage(src)
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas')
  ctx.drawImage(img, 0, 0, w, h)
  const result = removeBackground(ctx.getImageData(0, 0, w, h).data, w, h)
  const pad = Math.round(Math.max(w, h) * 0.02)
  const x = Math.max(0, result.box.x - pad), y = Math.max(0, result.box.y - pad)
  const cw = Math.min(w - x, result.box.w + pad * 2), ch = Math.min(h - y, result.box.h + pad * 2)
  const full = new ImageData(new Uint8ClampedArray(result.data), w, h)
  ctx.clearRect(0, 0, w, h)
  ctx.putImageData(full, 0, 0)
  const crop = document.createElement('canvas')
  crop.width = cw; crop.height = ch
  crop.getContext('2d')!.drawImage(canvas, x, y, cw, ch, 0, 0, cw, ch)
  return { src: crop.toDataURL('image/png'), width: cw, height: ch, coverage: result.coverage, confident: result.confident }
}
