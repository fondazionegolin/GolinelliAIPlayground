/** Grid + smart-guide snapping for the slide editor. Pure logic, no React — operates purely on
 * unrotated bounding boxes (ignoring `rotation`), which is a standard, acceptable simplification. */

export interface GuideLine {
  orientation: 'vertical' | 'horizontal'
  /** x for vertical guides, y for horizontal guides, in slide (unrotated) coordinates. */
  position: number
  /** Bounded segment to draw, along the guide's own perpendicular axis. */
  from: number
  to: number
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

  return { x, y, guides }
}
