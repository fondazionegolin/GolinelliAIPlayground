// Drawing modes of the 2D sketch tools: which clicks each mode needs and how the shape previews while drawing.
import { tl } from '@/i18n/tl'
import {
  add, arcSweep, arcThrough, arcWithRadius, circleFrom3, dist, dot, len, mul, norm, polar, quadToCubic, sub,
  type P, type SketchEntity,
} from './geom2d'

export type DrawTool = 'line' | 'arc' | 'rect' | 'circle' | 'ellipse' | 'polygon' | 'curve'
export type ModeTool = 'rect' | 'circle' | 'arc' | 'curve'

export interface DrawModes { rect: string; circle: string; arc: string; curve: string }
export const DEFAULT_MODES: DrawModes = { rect: 'corner', circle: 'center', arc: 'ends', curve: 'bezier3' }

export const MODE_OPTIONS: Record<ModeTool, { id: string; label: string; hint: string }[]> = {
  rect: [
    { id: 'corner', label: tl("Due angoli opposti"), hint: tl("Primo angolo, poi l'angolo opposto") },
    { id: 'center', label: tl("Dal centro"), hint: tl("Centro, poi un angolo") },
    { id: 'three', label: tl("Tre punti (inclinato)"), hint: tl("Due punti del primo lato, poi la larghezza") },
  ],
  circle: [
    { id: 'center', label: tl("Centro e raggio"), hint: tl("Centro, poi un punto sulla circonferenza") },
    { id: 'diameter', label: tl("Due punti (diametro)"), hint: tl("Due punti opposti sulla circonferenza") },
    { id: 'three', label: tl("Tre punti"), hint: tl("Tre punti sulla circonferenza") },
  ],
  arc: [
    { id: 'ends', label: tl("Tre punti: estremi + curvatura"), hint: tl("Inizio, fine, poi un punto per curvare (o digita il raggio)") },
    { id: 'through', label: tl("Tre punti: passaggio intermedio"), hint: tl("Inizio, punto intermedio dell'arco, fine") },
    { id: 'center', label: tl("Centro, inizio, fine"), hint: tl("Centro, punto iniziale, poi l'angolo finale") },
  ],
  curve: [
    { id: 'bezier3', label: tl("Bézier cubica"), hint: tl("Inizio, due punti di controllo, fine") },
    { id: 'bezier2', label: tl("Bézier quadratica"), hint: tl("Inizio, un punto di controllo, fine") },
    { id: 'spline', label: tl("Spline per punti"), hint: tl("Clic su ogni punto, Invio o doppio clic per finire") },
  ],
}

/** Number of clicks that complete the shape ('chain' = open ended, finished with Enter / double click). */
export function drawNeed(tool: DrawTool, modes: DrawModes): number | 'chain' {
  switch (tool) {
    case 'line': return 'chain'
    case 'rect': return modes.rect === 'three' ? 3 : 2
    case 'circle': return modes.circle === 'three' ? 3 : 2
    case 'arc': return 3
    case 'curve': return modes.curve === 'spline' ? 'chain' : modes.curve === 'bezier3' ? 4 : 3
    default: return 2
  }
}

export interface Preview {
  ents: SketchEntity[]
  values: number[]
  labels: string[]
  units: string[]
  /** Point added to the draft when this step is not the last (honours typed values). */
  end?: P
  /** Dashed helper lines (control polygon, radius…). */
  guides?: [P, P][]
}

const DEG = Math.PI / 180

export function drawPreview(tool: DrawTool, modes: DrawModes, draft: P[], cur: P, locked: (number | null)[], sides: number): Preview | null {
  if (!draft.length) return null
  const a = draft[draft.length - 1]
  const lineLike = (label: string): Preview => {
    const v = sub(cur, a)
    const L = locked[0] ?? len(v)
    const theta = locked[1] != null ? locked[1] * DEG : len(v) > 1e-9 ? Math.atan2(v[1], v[0]) : 0
    const b = polar(a, Math.abs(L), theta)
    let deg = theta / DEG
    deg = ((deg + 180) % 360 + 360) % 360 - 180
    return { ents: [{ id: 'preview', type: 'line', a, b }], values: [Math.abs(L), deg], labels: [label, tl("Angolo")], units: ['mm', '°'], end: b }
  }
  const guide = (p: P, q: P): [P, P][] => [[p, q]]
  const k = draft.length
  switch (tool) {
    case 'line':
      return lineLike(tl("Lunghezza"))

    case 'rect': {
      if (modes.rect === 'center') {
        const d = sub(cur, draft[0])
        const hw = locked[0] != null ? Math.abs(locked[0]) / 2 : Math.abs(d[0])
        const hh = locked[1] != null ? Math.abs(locked[1]) / 2 : Math.abs(d[1])
        return { ents: [{ id: 'preview', type: 'rect', a: [draft[0][0] - hw, draft[0][1] - hh], b: [draft[0][0] + hw, draft[0][1] + hh] }], values: [hw * 2, hh * 2], labels: [tl("Larghezza"), tl("Altezza")], units: ['mm', 'mm'] }
      }
      if (modes.rect === 'three') {
        if (k === 1) return lineLike(tl("Lato"))
        const [p0, p1] = draft
        const u = norm(sub(p1, p0))
        const nrm: P = [-u[1], u[0]]
        const w = locked[0] != null ? (Math.sign(dot(sub(cur, p0), nrm)) || 1) * Math.abs(locked[0]) : dot(sub(cur, p0), nrm)
        const q0 = add(p1, mul(nrm, w)), q1 = add(p0, mul(nrm, w))
        return { ents: [{ id: 'preview', type: 'polyline', pts: [p0, p1, q0, q1], closed: true }], values: [Math.abs(w)], labels: [tl("Larghezza")], units: ['mm'] }
      }
      const d = sub(cur, draft[0])
      const w = locked[0] != null ? (Math.sign(d[0]) || 1) * Math.abs(locked[0]) : d[0]
      const h = locked[1] != null ? (Math.sign(d[1]) || 1) * Math.abs(locked[1]) : d[1]
      return { ents: [{ id: 'preview', type: 'rect', a: draft[0], b: add(draft[0], [w, h]) }], values: [Math.abs(w), Math.abs(h)], labels: [tl("Larghezza"), tl("Altezza")], units: ['mm', 'mm'] }
    }

    case 'circle': {
      if (modes.circle === 'diameter') {
        const v = sub(cur, draft[0])
        const D = locked[0] != null ? Math.abs(locked[0]) : len(v)
        const dir = len(v) > 1e-9 ? norm(v) : ([1, 0] as P)
        const p1 = add(draft[0], mul(dir, D))
        return { ents: [{ id: 'preview', type: 'circle', c: mul(add(draft[0], p1), 0.5), r: D / 2 }], values: [D], labels: [tl("Diametro")], units: ['mm'], guides: guide(draft[0], p1) }
      }
      if (modes.circle === 'three') {
        if (k === 1) return { ents: [{ id: 'preview', type: 'line', a, b: cur }], values: [dist(a, cur)], labels: [], units: [] }
        const c = circleFrom3(draft[0], draft[1], cur)
        if (!c) return { ents: [{ id: 'preview', type: 'line', a: draft[0], b: cur }], values: [], labels: [], units: [] }
        return { ents: [{ id: 'preview', type: 'circle', c: c.c, r: c.r }], values: [c.r * 2], labels: [], units: [], guides: [] }
      }
      const r = locked[0] != null ? Math.abs(locked[0]) / 2 : dist(cur, draft[0])
      return { ents: [{ id: 'preview', type: 'circle', c: draft[0], r }], values: [r * 2], labels: [tl("Diametro")], units: ['mm'], guides: guide(draft[0], cur) }
    }

    case 'ellipse': {
      const d = sub(cur, draft[0])
      const rx = locked[0] != null ? Math.abs(locked[0]) : Math.abs(d[0])
      const ry = locked[1] != null ? Math.abs(locked[1]) : Math.abs(d[1])
      return { ents: [{ id: 'preview', type: 'ellipse', c: draft[0], rx, ry, rot: 0 }], values: [rx, ry], labels: [tl("Semiasse X"), tl("Semiasse Y")], units: ['mm', 'mm'] }
    }

    case 'polygon': {
      const d = sub(cur, draft[0])
      const r = locked[0] != null ? Math.abs(locked[0]) : len(d)
      const rot = len(d) > 1e-9 ? Math.atan2(d[1], d[0]) : Math.PI / 2
      return { ents: [{ id: 'preview', type: 'polygon', c: draft[0], r, n: sides, rot }], values: [r], labels: [tl("Raggio")], units: ['mm'] }
    }

    case 'arc': {
      if (modes.arc === 'center') {
        if (k === 1) return lineLike(tl("Raggio"))
        const c = draft[0], s = draft[1]
        const r = dist(c, s)
        const a0 = Math.atan2(s[1] - c[1], s[0] - c[0])
        const a1 = locked[0] != null ? a0 + locked[0] * DEG : Math.atan2(cur[1] - c[1], cur[0] - c[0])
        if (r < 1e-6) return null
        return { ents: [{ id: 'preview', type: 'arc', c, r, a0, a1 }], values: [arcSweep(a0, a1) / DEG], labels: [tl("Ampiezza")], units: ['°'], guides: [[c, s], [c, polar(c, r, a1)]] }
      }
      if (modes.arc === 'through') {
        if (k === 1) return { ents: [{ id: 'preview', type: 'line', a, b: cur }], values: [dist(a, cur)], labels: [], units: [] }
        const arc = arcThrough('preview', draft[0], cur, draft[1])
        if (!arc) return { ents: [{ id: 'preview', type: 'line', a: draft[0], b: cur }], values: [], labels: [], units: [] }
        return { ents: [arc], values: [arc.r], labels: [tl("Raggio")], units: ['mm'] }
      }
      if (k === 1) return lineLike(tl("Corda"))
      const [p0, p1] = draft
      const arc = locked[0] != null ? arcWithRadius('preview', p0, p1, cur, locked[0]) : arcThrough('preview', p0, p1, cur)
      if (!arc) return { ents: [{ id: 'preview', type: 'line', a: p0, b: p1 }], values: [dist(p0, p1) / 2], labels: [tl("Raggio")], units: ['mm'] }
      return { ents: [arc], values: [arc.r], labels: [tl("Raggio")], units: ['mm'] }
    }

    case 'curve': {
      if (modes.curve === 'spline') {
        const pts = [...draft, cur]
        return { ents: [{ id: 'preview', type: 'spline', pts }], values: [], labels: [], units: [], guides: pts.slice(0, -1).map((p, i) => [p, pts[i + 1]] as [P, P]) }
      }
      if (modes.curve === 'bezier2') {
        if (k === 1) return { ents: [{ id: 'preview', type: 'line', a, b: cur }], values: [], labels: [], units: [] }
        const pts = quadToCubic(draft[0], draft[1], cur)
        return { ents: [{ id: 'preview', type: 'bezier', pts }], values: [], labels: [], units: [], guides: [[draft[0], draft[1]], [draft[1], cur]] }
      }
      if (k === 1) return { ents: [{ id: 'preview', type: 'line', a, b: cur }], values: [], labels: [], units: [] }
      const pts: [P, P, P, P] = k === 2 ? [draft[0], draft[1], cur, cur] : [draft[0], draft[1], draft[2], cur]
      const guides: [P, P][] = k === 2 ? [[draft[0], draft[1]], [draft[1], cur]] : [[draft[0], draft[1]], [draft[2], cur]]
      return { ents: [{ id: 'preview', type: 'bezier', pts }], values: [], labels: [], units: [], guides }
    }
  }
}
