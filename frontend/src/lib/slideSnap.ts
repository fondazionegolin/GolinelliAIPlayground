/** Grid + smart-guide snapping for the slide editor. Pure logic, no React — operates purely on
 * unrotated bounding boxes (ignoring `rotation`), which is a standard, acceptable simplification. */

export interface GuideLine {
  orientation: 'vertical' | 'horizontal'
  /** x for vertical guides, y for horizontal guides, in slide (unrotated) coordinates. */
  position: number
  /** Bounded segment to draw, along the guide's own perpendicular axis. */
  from: number
  to: number
  /** 'spacing' marks an equal gap between two objects (drawn with a distance label); default is an alignment line. */
  kind?: 'align' | 'spacing'
  label?: string
}

export interface SnapCandidateBlock {
  x: number
  y: number
  width: number
  height: number
}

export interface SnapOptions {
  gridEnabled: boolean
  gridStep: number
  guidesEnabled: boolean
  /** Max distance (in slide units) for a smart guide to trigger. Default 5. */
  threshold?: number
}

export interface SnapResult {
  x: number
  y: number
  guides: GuideLine[]
}

interface AxisCandidate {
  /** Alignment value (edge/center coordinate) for this block along the axis. */
  value: number
  /** Extent of the block along the *other* axis, used to bound the drawn guide segment. */
  from: number
  to: number
}

function axisCandidates(block: SnapCandidateBlock, axis: 'x' | 'y'): AxisCandidate[] {
  if (axis === 'x') {
    return [
      { value: block.x, from: block.y, to: block.y + block.height },
      { value: block.x + block.width / 2, from: block.y, to: block.y + block.height },
      { value: block.x + block.width, from: block.y, to: block.y + block.height },
    ]
  }
  return [
    { value: block.y, from: block.x, to: block.x + block.width },
    { value: block.y + block.height / 2, from: block.x, to: block.x + block.width },
    { value: block.y + block.height, from: block.x, to: block.x + block.width },
  ]
}

function slideAxisCandidates(slideBounds: { width: number; height: number }, axis: 'x' | 'y'): AxisCandidate[] {
  if (axis === 'x') {
    return [
      { value: 0, from: 0, to: slideBounds.height },
      { value: slideBounds.width / 2, from: 0, to: slideBounds.height },
      { value: slideBounds.width, from: 0, to: slideBounds.height },
    ]
  }
  return [
    { value: 0, from: 0, to: slideBounds.width },
    { value: slideBounds.height / 2, from: 0, to: slideBounds.width },
    { value: slideBounds.height, from: 0, to: slideBounds.width },
  ]
}

function findBestSnap(
  moving: AxisCandidate[],
  others: AxisCandidate[],
  threshold: number,
): { delta: number; guide: { position: number; from: number; to: number } } | null {
  let best: { delta: number; guide: { position: number; from: number; to: number } } | null = null
  for (const m of moving) {
    for (const o of others) {
      const diff = o.value - m.value
      if (Math.abs(diff) <= threshold && (!best || Math.abs(diff) < Math.abs(best.delta))) {
        best = {
          delta: diff,
          guide: {
            position: o.value,
            from: Math.min(m.from, o.from),
            to: Math.max(m.to, o.to),
          },
        }
      }
    }
  }
  return best
}

type Axis = 'x' | 'y'
const startOf = (b: SnapCandidateBlock, axis: Axis) => axis === 'x' ? b.x : b.y
const sizeOf = (b: SnapCandidateBlock, axis: Axis) => axis === 'x' ? b.width : b.height
const crossStart = (b: SnapCandidateBlock, axis: Axis) => axis === 'x' ? b.y : b.x
const crossSize = (b: SnapCandidateBlock, axis: Axis) => axis === 'x' ? b.height : b.width
const overlapsCross = (a: SnapCandidateBlock, b: SnapCandidateBlock, axis: Axis) =>
  crossStart(a, axis) < crossStart(b, axis) + crossSize(b, axis) && crossStart(b, axis) < crossStart(a, axis) + crossSize(a, axis)

function spacingGuide(axis: Axis, from: number, to: number, cross: number): GuideLine {
  return {
    orientation: axis === 'x' ? 'horizontal' : 'vertical',
    position: cross, from, to, kind: 'spacing', label: String(Math.round(to - from)),
  }
}

/** Equal-spacing snap along one axis, Figma-style: the moving box snaps to the gap that already exists between
 * two other objects (placed beyond either of them) or to the middle of a gap (both gaps equal). */
function spacingSnap(moving: SnapCandidateBlock, others: SnapCandidateBlock[], axis: Axis, threshold: number): { delta: number; guides: GuideLine[] } | null {
  const row = others.filter(o => overlapsCross(o, moving, axis)).sort((a, b) => startOf(a, axis) - startOf(b, axis)).slice(0, 60)
  if (!row.length) return null
  const pos = startOf(moving, axis)
  const size = sizeOf(moving, axis)
  const crossMid = (a: SnapCandidateBlock, b: SnapCandidateBlock) => {
    const lo = Math.max(crossStart(a, axis), crossStart(b, axis))
    const hi = Math.min(crossStart(a, axis) + crossSize(a, axis), crossStart(b, axis) + crossSize(b, axis))
    return hi > lo ? (lo + hi) / 2 : (crossStart(a, axis) + crossSize(a, axis) / 2)
  }
  const gaps: { g: number; a: SnapCandidateBlock; b: SnapCandidateBlock }[] = []
  for (let i = 0; i < row.length - 1; i++) {
    const a = row[i], b = row[i + 1]
    const g = startOf(b, axis) - (startOf(a, axis) + sizeOf(a, axis))
    if (g > 0.5 && overlapsCross(a, b, axis)) gaps.push({ g, a, b })
  }
  let best: { delta: number; guides: GuideLine[] } | null = null
  const consider = (target: number, build: () => GuideLine[]) => {
    const delta = target - pos
    if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, guides: build() }
  }
  for (const o of row) {
    const oStart = startOf(o, axis), oEnd = oStart + sizeOf(o, axis)
    for (const { g, a, b } of gaps) {
      // moving placed after o, or before o, with the same gap as the reference pair (never onto the pair itself)
      if (o !== a) consider(oEnd + g, () => [
        spacingGuide(axis, oEnd, oEnd + g, crossMid(o, moving)),
        spacingGuide(axis, startOf(a, axis) + sizeOf(a, axis), startOf(b, axis), crossMid(a, b)),
      ])
      if (o !== b) consider(oStart - g - size, () => [
        spacingGuide(axis, oStart - g, oStart, crossMid(o, moving)),
        spacingGuide(axis, startOf(a, axis) + sizeOf(a, axis), startOf(b, axis), crossMid(a, b)),
      ])
    }
  }
  for (let i = 0; i < row.length - 1; i++) {
    const a = row[i], c = row[i + 1]
    const aEnd = startOf(a, axis) + sizeOf(a, axis)
    const free = startOf(c, axis) - aEnd - size
    if (free <= 0.5) continue
    const g = free / 2
    consider(aEnd + g, () => [
      spacingGuide(axis, aEnd, aEnd + g, crossMid(a, moving)),
      spacingGuide(axis, aEnd + g + size, startOf(c, axis), crossMid(c, moving)),
    ])
  }
  return best
}

export function computeSnap(
  moving: SnapCandidateBlock,
  others: SnapCandidateBlock[],
  slideBounds: { width: number; height: number },
  options: SnapOptions,
): SnapResult {
  let { x, y } = moving
  const threshold = options.threshold ?? 5

  if (options.gridEnabled && options.gridStep > 0) {
    x = Math.round(x / options.gridStep) * options.gridStep
    y = Math.round(y / options.gridStep) * options.gridStep
  }

  const guides: GuideLine[] = []

  if (options.guidesEnabled) {
    const otherXCandidates = [...others.flatMap((o) => axisCandidates(o, 'x')), ...slideAxisCandidates(slideBounds, 'x')]
    const otherYCandidates = [...others.flatMap((o) => axisCandidates(o, 'y')), ...slideAxisCandidates(slideBounds, 'y')]

    const proposed = { ...moving, x, y }
    const movingXCandidates = axisCandidates(proposed, 'x')
    const movingYCandidates = axisCandidates(proposed, 'y')

    const xSnap = findBestSnap(movingXCandidates, otherXCandidates, threshold)
    if (xSnap) {
      x += xSnap.delta
      guides.push({ orientation: 'vertical', position: xSnap.guide.position, from: xSnap.guide.from, to: xSnap.guide.to })
    }

    const ySnap = findBestSnap(movingYCandidates, otherYCandidates, threshold)
    if (ySnap) {
      y += ySnap.delta
      guides.push({ orientation: 'horizontal', position: ySnap.guide.position, from: ySnap.guide.from, to: ySnap.guide.to })
    }
  }

  if (options.guidesEnabled) {
    const proposedBox = { ...moving, x, y }
    const alignedX = guides.some(guide => guide.orientation === 'vertical')
    const alignedY = guides.some(guide => guide.orientation === 'horizontal')
    if (!alignedX) {
      const gap = spacingSnap(proposedBox, others, 'x', threshold)
      if (gap) { x += gap.delta; guides.push(...gap.guides) }
    }
    if (!alignedY) {
      const gap = spacingSnap({ ...proposedBox, x }, others, 'y', threshold)
      if (gap) { y += gap.delta; guides.push(...gap.guides) }
    }
  }

  return { x, y, guides }
}
