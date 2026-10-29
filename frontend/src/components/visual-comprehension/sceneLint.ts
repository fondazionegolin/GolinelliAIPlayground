import type { Region } from './types'
import type { DrawingLayout, DrawingMark, DrawingScene, Frame } from './blackboard'
import { SceneGeometry, TEXT_KINDS, fitText, measureLabel, overlapArea, type XY } from './sceneGeometry'
import { isCalibratedPlot } from './ExtraMarks'
import { tl } from '@/i18n/tl'

export type Issue = {
  rule: 'too-small' | 'overlap-text' | 'covers-source' | 'out-of-bounds' | 'misaligned' | 'dense-step'
  id: string; detail: string; fixed: boolean
}
/** `minFont`: smallest legible font in world units at the reviewed scale; the renderer never shrinks text below it. */
export type Refinement = { geometry: SceneGeometry; shifts: Map<string, XY>; issues: Issue[]; minFont: number }

export const MIN_TEXT_PX = 11
const MAX_TEXT_PER_STEP = 10
const WIDGETS = new Set(['plot', 'diagram', 'fretboard', 'rhythm', 'numberline', 'lens', 'area_model'])
const DIRECTIONS: XY[] = [{ x: 1, y: -1 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: -1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 1 }]

type Item = { mark: DrawingMark; frame: Frame; rect: Frame; callout: boolean; brace?: boolean }
const area = (r: Frame) => Math.max(1e-6, r.width * r.height)
const move = (r: Frame, d: XY): Frame => ({ ...r, x: r.x + d.x, y: r.y + d.y })
const outside = (r: Frame, f: Frame) => area(r) - overlapArea(r, f)
/** Share of the smaller shape that is hidden: covering a whole vertex matters as much as covering a whole line of text. */
const covered = (r: Frame, z: Frame) => overlapArea(r, z) / Math.min(area(r), area(z))

/** Text extent inside its box (top-left aligned), as the renderer draws it. */
function textRect(geometry: SceneGeometry, m: DrawingMark, minFont = 0): Frame {
  const box = geometry.bounds(m)
  if (m.kind === 'formula') {
    // Rendered width of the math, not of the generous box the model asked for: fractions stack, commands vanish.
    const flat = m.text.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a: string, b: string) => a.length > b.length ? a : b)
      .replace(/\\(text|mathrm)\{([^{}]*)\}/g, '$2').replace(/\\[a-zA-Z]+/g, 'x').replace(/[{}^_$\\]/g, '')
    const size = geometry.fontSize(m), height = Math.min(box.height, size * (/\\frac/.test(m.text) ? 2.6 : 1.5))
    return { x: box.x, y: box.y + (box.height - height) / 2, width: Math.min(box.width, flat.length * size * .62), height }
  }
  const { font, lines } = fitText(m.text, box.width, box.height, geometry.fontSize(m), minFont)
  const longest = Math.max(1, ...lines.map(l => l.length))
  return { x: box.x, y: box.y, width: Math.max(Math.min(box.width, longest * font * .55 + font * .3), minFont ? longest * font * .55 : 0), height: Math.max(Math.min(box.height, lines.length * font * 1.22), minFont ? lines.length * font * 1.22 : 0) }
}

/**
 * Checks the composition like a layout reviewer and fixes what can be fixed deterministically:
 * raises tiny text, places callout labels clear of the source, nudges colliding text, snaps near-miss alignments.
 * `scale` is display pixels per layout unit at fit zoom.
 */
export function refineScene(scene: DrawingScene, regions: Region[], layout: DrawingLayout, scale = 1): Refinement {
  const geometry = new SceneGeometry(scene, regions, layout)
  const issues: Issue[] = []
  const shifts = new Map<string, XY>()

  // 1. Legibility: nothing below MIN_TEXT_PX at the current display scale.
  for (const m of scene.elements) {
    if (!(TEXT_KINDS.has(m.kind) || m.kind === 'callout' || m.kind === 'dimension' || m.kind === 'arc')) continue
    const size = geometry.fontSize(m)
    if (size * scale < MIN_TEXT_PX) {
      geometry.fonts.set(m.id, MIN_TEXT_PX / Math.max(scale, 1e-6))
      issues.push({ rule: 'too-small', id: m.id, detail: tl("testo di {0}px alzato a {1}px", (size * scale).toFixed(1), MIN_TEXT_PX), fixed: true })
    }
  }

  const ordered = [...scene.elements].sort((a, b) => a.step - b.step)
  // Source content to keep visible: anything with text, and small regions (vertices, ticks, single symbols) even without it.
  const protectedZones = regions.filter(r => r.text.trim() || r.box.width * r.box.height < 150)
    .map(r => geometry.regionRect(r.id)).filter((z): z is Frame => !!z)
  const items: Item[] = []
  const obstacles: Frame[] = []
  const widgets: Array<{ id: string; rect: Frame; frame: Frame }> = []
  for (const m of ordered) {
    const frame = geometry.frame(m)
    if (TEXT_KINDS.has(m.kind)) items.push({ mark: m, frame, rect: textRect(geometry, m, MIN_TEXT_PX / Math.max(scale, 1e-6)), callout: false })
    else if (m.kind === 'callout') items.push({ mark: m, frame, rect: geometry.defaultLabel(m), callout: true })
    else if (m.kind === 'brace' && m.text) items.push({ mark: m, frame, rect: geometry.braceLabel(m)!.rect, callout: false, brace: true })
    else if (WIDGETS.has(m.kind) && !isCalibratedPlot(m)) { obstacles.push(geometry.bounds(m)); widgets.push({ id: m.id, rect: geometry.bounds(m), frame }) }
    else if (m.kind === 'dimension' || (m.kind === 'arc' && m.text)) obstacles.push(geometry.fixedLabel(m))
  }

  const zonesFor = (frame: Frame) => (frame === layout.image ? protectedZones : [])
  const cost = (rect: Frame, frame: Frame, placed: Frame[]) => {
    const a = area(rect)
    return outside(rect, frame) / a * 10
      + zonesFor(frame).reduce((sum, z) => sum + covered(rect, z), 0) * 3
      + placed.reduce((sum, p) => sum + overlapArea(rect, p) / a, 0) * 6
      + obstacles.reduce((sum, o) => sum + overlapArea(rect, o) / a, 0) * 4
  }

  // 2. Placement in drawing order, so earlier explanations keep their spot.
  const placed: Frame[] = []
  const final: Item[] = []
  for (const item of items) {
    const { mark: m, frame } = item
    const size = geometry.fontSize(m)
    if (item.callout) {
      const target = geometry.point(m.target!)
      const { width, height } = measureLabel(m.text, size, frame.width * .28)
      let best: { rect: Frame; score: number } | null = null
      DIRECTIONS.forEach((d, index) => [1.2, 2.2, 3.5].forEach(gap => {
        const g = gap * size
        const rect = { width, height, x: target.x + d.x * g + (d.x < 0 ? -width : d.x === 0 ? -width / 2 : 0), y: target.y + d.y * g + (d.y < 0 ? -height : d.y === 0 ? -height / 2 : 0) }
        const score = cost(rect, frame, placed) + gap * .02 + index * .004
        if (!best || score < best.score) best = { rect, score }
      }))
      const chosen = best as unknown as { rect: Frame; score: number }
      geometry.setLabel(m.id, chosen.rect)
      placed.push(chosen.rect); final.push({ ...item, rect: chosen.rect })
      continue
    }
    if (item.brace) {
      // A brace label slides outward along the brace's normal, or sideways, but stays attached to its tip.
      const { normal } = geometry.braceLabel(m)!
      let best = { rect: item.rect, score: cost(item.rect, frame, placed) }
      for (const out of [0, .8, 1.6, 2.6, 4]) for (const side of [0, -.6, .6, -1.2, 1.2]) {
        const r = move(item.rect, { x: normal.x * out * size - normal.y * side * item.rect.width, y: normal.y * out * size + normal.x * side * item.rect.width })
        const score = cost(r, frame, placed) + (out + Math.abs(side) * 2) * .015
        if (score < best.score - 1e-6) best = { rect: r, score }
      }
      geometry.setLabel(m.id, best.rect)
      if (best.rect !== item.rect) issues.push({ rule: 'overlap-text', id: m.id, detail: tl("etichetta della graffa spostata dalla punta ({0})", Math.round(Math.hypot(best.rect.x - item.rect.x, best.rect.y - item.rect.y))), fixed: true })
      placed.push(best.rect); final.push({ ...item, rect: best.rect })
      continue
    }
    const before = cost(item.rect, frame, placed)
    let rect = item.rect
    if (before > .05) {
      let best = { delta: { x: 0, y: 0 } as XY, score: before }
      for (const radius of [.8, 1.6, 2.6, 4, 6, 9, 13, 18]) {
        for (let k = 0; k < 16; k++) {
          const angle = k * Math.PI / 8, delta = { x: Math.cos(angle) * radius * size, y: Math.sin(angle) * radius * size }
          if (Math.hypot(delta.x, delta.y) > frame.width * .25) continue
          const score = cost(move(item.rect, delta), frame, placed) + radius * .01
          if (score < best.score) best = { delta, score }
        }
      }
      if (best.score < before * .7) {
        rect = move(item.rect, best.delta)
        shifts.set(m.id, best.delta)
        issues.push({ rule: 'overlap-text', id: m.id, detail: tl("testo spostato per non coprire la sorgente o altri segni"), fixed: true })
      }
    }
    placed.push(rect); final.push({ ...item, rect })
  }

  // 3. Alignment: snap near-miss left edges and tops (within 1.2% of the frame) when it costs nothing.
  const flow = final.filter(i => !i.callout && !i.brace)
  for (const axis of ['x', 'y'] as const) {
    const dim = axis === 'x' ? 'width' : 'height'
    flow.forEach((item, i) => {
      for (const other of flow.slice(0, i)) {
        const gap = other.rect[axis] - item.rect[axis]
        if (item.frame !== other.frame || Math.abs(gap) < 1e-6 || Math.abs(gap) > item.frame[dim] * .012) continue
        const delta = axis === 'x' ? { x: gap, y: 0 } : { x: 0, y: gap }
        const moved = move(item.rect, delta), rest = placed.filter(p => p !== item.rect)
        if (cost(moved, item.frame, rest) > cost(item.rect, item.frame, rest) + 1e-3) continue
        placed[placed.indexOf(item.rect)] = moved; item.rect = moved
        const prev = shifts.get(item.mark.id) ?? { x: 0, y: 0 }
        shifts.set(item.mark.id, { x: prev.x + delta.x, y: prev.y + delta.y })
        issues.push({ rule: 'misaligned', id: item.mark.id, detail: tl("allineato a {0}", other.mark.id), fixed: true })
        break
      }
    })
  }

  // 4. What is left is reported, not hidden.
  final.forEach((item, i) => {
    const others = final.slice(0, i).map(o => o.rect).concat(obstacles)
    if (others.some(o => overlapArea(item.rect, o) / area(item.rect) > .15)) issues.push({ rule: 'overlap-text', id: item.mark.id, detail: tl("resta sovrapposto ad altri segni"), fixed: false })
    if (zonesFor(item.frame).some(z => covered(item.rect, z) > .25)) issues.push({ rule: 'covers-source', id: item.mark.id, detail: tl("copre testo della sorgente"), fixed: false })
    if (outside(item.rect, item.frame) / area(item.rect) > .05) issues.push({ rule: 'out-of-bounds', id: item.mark.id, detail: tl("esce dall'area di disegno"), fixed: false })
  })
  for (const w of widgets) {
    if (zonesFor(w.frame).some(z => covered(w.rect, z) > .25)) issues.push({ rule: 'covers-source', id: w.id, detail: tl("il riquadro copre testo della sorgente: spostalo in uno spazio libero"), fixed: false })
  }
  const perStep = new Map<number, number>()
  for (const item of final) perStep.set(item.mark.step, (perStep.get(item.mark.step) ?? 0) + 1)
  for (const [step, count] of perStep) if (count > MAX_TEXT_PER_STEP) issues.push({ rule: 'dense-step', id: `step-${step}`, detail: tl("{0} scritte nello stesso passo", count), fixed: false })

  return { geometry, shifts, issues, minFont: MIN_TEXT_PX / Math.max(scale, 1e-6) }
}
