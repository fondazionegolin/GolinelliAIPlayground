/**
 * A small, safe math language for the interactive board: what a student types ("y = 3x^2 - 5", "x²/9 − y²/16 = 1")
 * is parsed into a tree and evaluated by this code only — never by `eval`. It also recognises what kind of curve an
 * equation draws (line, parabola, circle, ellipse, hyperbola, sinusoid…) so the board can say what the student drew.
 */

export type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: string }
  | { t: 'neg'; a: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { t: 'call'; fn: string; a: Node }

export const FUNCTIONS = ['sin', 'cos', 'tan', 'sqrt', 'abs', 'ln', 'log', 'exp'] as const
const NAMED = ['pi', 'phi', 'theta', 'alpha', 'beta', 'gamma', 'delta', 'lambda', 'omega', 'sigma', 'mu', 'rho', 'tau']
const GREEK: Record<string, string> = { 'π': 'pi', 'φ': 'phi', 'ϕ': 'phi', 'θ': 'theta', 'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'λ': 'lambda', 'ω': 'omega', 'σ': 'sigma', 'μ': 'mu', 'ρ': 'rho', 'τ': 'tau' }
const SUPERSCRIPTS: Record<string, string> = { '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' }

export class MathError extends Error {}

type Token = { k: 'num'; v: number } | { k: 'id'; v: string } | { k: 'op'; v: string }

function normalise(text: string): string {
  let s = text.trim().replace(/[−–]/g, '-').replace(/[×·∙]/g, '*').replace(/÷/g, '/').replace(/\*\*/g, '^')
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, m => '^' + [...m].map(c => SUPERSCRIPTS[c]).join(''))
  s = [...s].map(c => GREEK[c] ? ` ${GREEK[c]} ` : c).join('')
  return s.replace(/(\d),(\d)/g, '$1.$2')  // Italian decimal comma
}

function tokenize(text: string): Token[] {
  const s = normalise(text), out: Token[] = []
  for (let i = 0; i < s.length;) {
    const c = s[i]
    if (/\s/.test(c)) { i++; continue }
    if (/[\d.]/.test(c)) {
      const m = /^\d*\.?\d+(e[+-]?\d+)?|^\d+\.?/i.exec(s.slice(i))!
      out.push({ k: 'num', v: Number(m[0]) }); i += m[0].length; continue
    }
    if (/[a-zA-Z]/.test(c)) {
      const word = /^[a-zA-Z]+/.exec(s.slice(i))![0]
      // Known names are read whole; anything else is a product of single letters ("xy" = x·y, "2ax" = 2·a·x).
      let rest = word
      while (rest) {
        const known = [...FUNCTIONS, ...NAMED].sort((a, b) => b.length - a.length).find(n => rest.toLowerCase().startsWith(n))
        const piece = known ? rest.slice(0, known.length) : rest[0]
        out.push({ k: 'id', v: known ? known : piece }); rest = rest.slice(piece.length)
      }
      i += word.length; continue
    }
    if ('+-*/^()='.includes(c)) { out.push({ k: 'op', v: c }); i++; continue }
    throw new MathError(`Simbolo non riconosciuto: «${c}»`)
  }
  return out
}

/** Parses an expression (no "="). */
export function parse(text: string): Node {
  const tokens = tokenize(text)
  if (tokens.some(t => t.k === 'op' && t.v === '=')) throw new MathError('Qui va un\'espressione, senza «=»')
  let i = 0
  const peek = () => tokens[i], next = () => tokens[i++]
  const isOp = (v: string) => peek()?.k === 'op' && peek().v === v
  const startsFactor = () => { const t = peek(); return !!t && (t.k === 'num' || t.k === 'id' || (t.k === 'op' && t.v === '(')) }
  function expr(): Node {
    let a = term()
    while (isOp('+') || isOp('-')) { const op = next().v as '+' | '-'; a = { t: 'bin', op, a, b: term() } }
    return a
  }
  function term(): Node {
    let a = unary()
    for (;;) {
      if (isOp('*') || isOp('/')) { const op = next().v as '*' | '/'; a = { t: 'bin', op, a, b: unary() } }
      else if (startsFactor()) a = { t: 'bin', op: '*', a, b: power() }  // implicit product: 3x, 2(x+1), xy
      else return a
    }
  }
  function unary(): Node {
    if (isOp('-')) { next(); return { t: 'neg', a: unary() } }
    if (isOp('+')) { next(); return unary() }
    return power()
  }
  function power(): Node {
    const base = atom()
    if (isOp('^')) { next(); return { t: 'bin', op: '^', a: base, b: unary() } }
    return base
  }
  function atom(): Node {
    const t = next()
    if (!t) throw new MathError('L\'espressione è incompleta')
    if (t.k === 'num') return { t: 'num', v: t.v }
    if (t.k === 'id') {
      if ((FUNCTIONS as readonly string[]).includes(t.v)) {
        if (isOp('(')) { next(); const a = expr(); if (!isOp(')')) throw new MathError(`Manca una «)» dopo ${t.v}`); next(); return { t: 'call', fn: t.v, a } }
        return { t: 'call', fn: t.v, a: power() }  // sin x
      }
      return t.v === 'pi' ? { t: 'num', v: Math.PI } : t.v === 'e' ? { t: 'num', v: Math.E } : { t: 'var', name: t.v }
    }
    if (t.v === '(') { const a = expr(); if (!isOp(')')) throw new MathError('Manca una parentesi «)»'); next(); return a }
    throw new MathError(`«${t.v}» fuori posto`)
  }
  const tree = expr()
  if (i < tokens.length) throw new MathError(`«${(tokens[i] as { v: unknown }).v}» fuori posto`)
  return tree
}

export function variables(n: Node, out = new Set<string>()): Set<string> {
  if (n.t === 'var') out.add(n.name)
  else if (n.t === 'neg' || n.t === 'call') variables(n.a, out)
  else if (n.t === 'bin') { variables(n.a, out); variables(n.b, out) }
  return out
}

export function evaluate(n: Node, env: Record<string, number>): number {
  switch (n.t) {
    case 'num': return n.v
    case 'var': { const v = env[n.name]; if (v === undefined) throw new MathError(`Non so quanto vale «${n.name}»`); return v }
    case 'neg': return -evaluate(n.a, env)
    case 'call': {
      const a = evaluate(n.a, env)
      return n.fn === 'sin' ? Math.sin(a) : n.fn === 'cos' ? Math.cos(a) : n.fn === 'tan' ? Math.tan(a) : n.fn === 'sqrt' ? Math.sqrt(a)
        : n.fn === 'abs' ? Math.abs(a) : n.fn === 'exp' ? Math.exp(a) : n.fn === 'log' ? Math.log10(a) : Math.log(a)
    }
    case 'bin': {
      const a = evaluate(n.a, env), b = evaluate(n.b, env)
      return n.op === '+' ? a + b : n.op === '-' ? a - b : n.op === '*' ? a * b : n.op === '/' ? a / b : Math.pow(a, b)
    }
  }
}

/** An equation or a bare expression: "y = …" is explicit, anything else with x and y is the curve F(x, y) = 0. */
export type Equation = { text: string; f: Node; explicit: Node | null }

export function parseEquation(text: string): Equation {
  const sides = normalise(text).split('=')
  if (sides.length > 2) throw new MathError('Usa un solo «=»')
  if (sides.length === 1 || !sides[0].trim()) {
    const rhs = parse(sides[sides.length - 1])
    return { text, f: { t: 'bin', op: '-', a: { t: 'var', name: 'y' }, b: rhs }, explicit: variables(rhs).has('y') ? null : rhs }
  }
  if (!sides[1].trim()) throw new MathError('Manca il secondo membro dopo «=»')
  const left = parse(sides[0]), right = parse(sides[1])
  const explicit = left.t === 'var' && left.name === 'y' && !variables(right).has('y') ? right
    : right.t === 'var' && right.name === 'y' && !variables(left).has('y') ? left : null
  return { text, f: { t: 'bin', op: '-', a: left, b: right }, explicit }
}

// --- polynomials: enough algebra to recognise conics exactly -------------------------------------------------

type Poly = Map<string, number>  // "i,j" -> coefficient of x^i y^j
const key = (i: number, j: number) => `${i},${j}`

function polyOf(n: Node, env: Record<string, number>): Poly | null {
  switch (n.t) {
    case 'num': return new Map([[key(0, 0), n.v]])
    case 'var':
      if (n.name === 'x') return new Map([[key(1, 0), 1]])
      if (n.name === 'y') return new Map([[key(0, 1), 1]])
      return env[n.name] === undefined ? null : new Map([[key(0, 0), env[n.name]]])
    case 'neg': { const p = polyOf(n.a, env); return p && new Map([...p].map(([k, v]) => [k, -v])) }
    case 'call': return null
    case 'bin': {
      const a = polyOf(n.a, env), b = polyOf(n.b, env)
      if (!a || !b) return null
      if (n.op === '+' || n.op === '-') {
        const out = new Map(a)
        for (const [k, v] of b) out.set(k, (out.get(k) ?? 0) + (n.op === '+' ? v : -v))
        return out
      }
      if (n.op === '*') return multiply(a, b)
      const constant = b.size === 1 && b.has(key(0, 0)) ? b.get(key(0, 0))! : null
      if (n.op === '/') return constant ? new Map([...a].map(([k, v]) => [k, v / constant])) : null
      if (constant === null || !Number.isInteger(constant) || constant < 0 || constant > 4) return null
      let out: Poly = new Map([[key(0, 0), 1]])
      for (let i = 0; i < constant; i++) out = multiply(out, a)
      return out
    }
  }
}

function multiply(a: Poly, b: Poly): Poly {
  const out: Poly = new Map()
  for (const [ka, va] of a) for (const [kb, vb] of b) {
    const [i1, j1] = ka.split(',').map(Number), [i2, j2] = kb.split(',').map(Number)
    out.set(key(i1 + i2, j1 + j2), (out.get(key(i1 + i2, j1 + j2)) ?? 0) + va * vb)
  }
  return out
}

const clean = (p: Poly) => new Map([...p].filter(([, v]) => Math.abs(v) > 1e-9))
const degree = (p: Poly) => Math.max(0, ...[...p.keys()].map(k => k.split(',').map(Number).reduce((s, v) => s + v, 0)))
const fmt = (v: number) => Number(v.toFixed(2)).toLocaleString('it-IT')

export type Family = 'retta' | 'parabola' | 'circonferenza' | 'ellisse' | 'iperbole' | 'coppia di rette' | 'punto' | 'nessuna curva'
  | 'sinusoide' | 'esponenziale' | 'logaritmo' | 'radice' | 'valore assoluto' | 'polinomio' | 'costante' | 'curva'
export type Shape = { family: Family; article: string; facts: string[]; poly: Poly | null }

const ARTICLES: Record<Family, string> = {
  retta: 'una retta', parabola: 'una parabola', circonferenza: 'una circonferenza', ellisse: 'un\'ellisse', iperbole: 'un\'iperbole',
  'coppia di rette': 'una coppia di rette', punto: 'un punto', 'nessuna curva': 'nessuna curva', sinusoide: 'una sinusoide',
  esponenziale: 'un\'esponenziale', logaritmo: 'un logaritmo', radice: 'una radice', 'valore assoluto': 'un valore assoluto',
  polinomio: 'un polinomio', costante: 'una retta orizzontale', curva: 'una curva',
}

function calls(n: Node, out = new Set<string>()): Set<string> {
  if (n.t === 'call') { out.add(n.fn); calls(n.a, out) } else if (n.t === 'neg') calls(n.a, out)
  else if (n.t === 'bin') { calls(n.a, out); calls(n.b, out) }
  return out
}

/** What the equation draws, with a few facts a teacher would point out (axis, vertices, intercepts). */
export function classify(eq: Equation, env: Record<string, number> = {}): Shape {
  const poly = polyOf(eq.f, env)
  const make = (family: Family, facts: string[] = []): Shape => ({ family, article: ARTICLES[family], facts, poly: poly && clean(poly) })
  if (!poly) {
    const fns = calls(eq.f)
    if (fns.has('sin') || fns.has('cos')) return make('sinusoide')
    if (fns.has('exp')) return make('esponenziale')
    if (fns.has('ln') || fns.has('log')) return make('logaritmo')
    if (fns.has('sqrt')) return make('radice')
    if (fns.has('abs')) return make('valore assoluto')
    return make('curva')
  }
  const p = clean(poly), c = (i: number, j: number) => p.get(key(i, j)) ?? 0
  const deg = degree(p)
  if (deg === 0) return make('nessuna curva')
  if (deg === 1) {
    if (Math.abs(c(0, 1)) < 1e-9) return make('retta', [`verticale, x = ${fmt(-c(0, 0) / c(1, 0))}`])
    const m = -c(1, 0) / c(0, 1), q = -c(0, 0) / c(0, 1)
    return Math.abs(m) < 1e-9 ? make('costante', [`y = ${fmt(q)}`]) : make('retta', [`pendenza ${fmt(m)}`, `incontra l'asse y in ${fmt(q)}`])
  }
  if (deg > 2) return make(eq.explicit ? 'polinomio' : 'curva', [`di grado ${deg}`])
  const A = c(2, 0), B = c(1, 1), C = c(0, 2), D = c(1, 0), E = c(0, 1), F = c(0, 0)
  const disc = B * B - 4 * A * C
  if (Math.abs(disc) < 1e-9) {
    const facts = Math.abs(C) < 1e-9 && Math.abs(B) < 1e-9 && Math.abs(E) > 1e-9
      ? [`asse verticale`, `vertice in (${fmt(-D / (2 * A))}; ${fmt(-(F - D * D / (4 * A)) / E)})`]
      : Math.abs(A) < 1e-9 && Math.abs(B) < 1e-9 && Math.abs(D) > 1e-9 ? ['asse orizzontale'] : []
    return make('parabola', facts)
  }
  // Centre the conic (no rotation handled in the facts, the family is still exact).
  const det = 4 * A * C - B * B
  const x0 = (B * E - 2 * C * D) / det, y0 = (B * D - 2 * A * E) / det
  const k = A * x0 * x0 + B * x0 * y0 + C * y0 * y0 + D * x0 + E * y0 + F
  const centre = Math.abs(x0) > 1e-9 || Math.abs(y0) > 1e-9 ? [`centro in (${fmt(x0)}; ${fmt(y0)})`] : []
  if (disc < 0) {
    if (Math.abs(k) < 1e-12 || -k / A < 0) return make(Math.abs(k) < 1e-12 ? 'punto' : 'nessuna curva')
    if (Math.abs(A - C) < 1e-9 && Math.abs(B) < 1e-9) return make('circonferenza', [...centre, `raggio ${fmt(Math.sqrt(-k / A))}`])
    return make('ellisse', [...centre, ...(Math.abs(B) < 1e-9 ? [`semiassi ${fmt(Math.sqrt(-k / A))} e ${fmt(Math.sqrt(-k / C))}`] : [])])
  }
  if (Math.abs(k) < 1e-12) return make('coppia di rette', centre)
  const facts = [...centre]
  if (Math.abs(B) < 1e-9) {
    // a·(x−x0)² + c·(y−y0)² = −k: the branches cut the axis whose coefficient has the sign of −k.
    if (-k / A > 0) facts.push(`rami a sinistra e a destra`, `vertici in x = ${fmt(x0 - Math.sqrt(-k / A))} e x = ${fmt(x0 + Math.sqrt(-k / A))}`)
    else facts.push(`rami in alto e in basso`, `vertici in y = ${fmt(y0 - Math.sqrt(-k / C))} e y = ${fmt(y0 + Math.sqrt(-k / C))}`)
  } else facts.push('ruotata')
  return make('iperbole', facts)
}

/** Same curve? Exact for polynomials (proportional coefficients), sampled otherwise. */
export function sameCurve(a: Equation, b: Equation, envA: Record<string, number> = {}, envB: Record<string, number> = {}): boolean {
  const pa = polyOf(a.f, envA), pb = polyOf(b.f, envB)
  if (pa && pb) {
    const ca = clean(pa), cb = clean(pb), keys = new Set([...ca.keys(), ...cb.keys()])
    const ref = [...keys].find(k => Math.abs(cb.get(k) ?? 0) > 1e-9)
    if (!ref || Math.abs(ca.get(ref) ?? 0) < 1e-12) return false
    const ratio = (ca.get(ref) ?? 0) / cb.get(ref)!
    return [...keys].every(k => Math.abs((ca.get(k) ?? 0) - ratio * (cb.get(k) ?? 0)) < 1e-6 * Math.max(1, Math.abs(ca.get(k) ?? 0)))
  }
  if (a.explicit && b.explicit) {
    let compared = 0
    for (let x = -7.3; x <= 7.3; x += .37) {
      const va = safe(() => evaluate(a.explicit!, { ...envA, x })), vb = safe(() => evaluate(b.explicit!, { ...envB, x }))
      if (va === null && vb === null) continue
      if (va === null || vb === null || Math.abs(va - vb) > 1e-6 * Math.max(1, Math.abs(vb))) return false
      compared++
    }
    return compared > 5
  }
  return false
}

const safe = (f: () => number) => { try { const v = f(); return Number.isFinite(v) ? v : null } catch { return null } }

/** Feedback on an attempt, as a teacher would say it: what the student drew, and what differs from the target. */
export function judge(attempt: Equation, target: Equation, envAttempt: Record<string, number> = {}, envTarget: Record<string, number> = {}):
  { correct: boolean; message: string; drawn: Shape; wanted: Shape } {
  const drawn = classify(attempt, envAttempt), wanted = classify(target, envTarget)
  if (sameCurve(attempt, target, envAttempt, envTarget)) return { correct: true, message: `Esatto: è proprio ${wanted.article}${wanted.facts.length ? ` (${wanted.facts.join(', ')})` : ''}.`, drawn, wanted }
  if (drawn.family !== wanted.family) {
    return { correct: false, message: `Attenzione: stai disegnando ${drawn.article}${drawn.facts.length ? ` (${drawn.facts.join(', ')})` : ''}, non ${wanted.article}.`, drawn, wanted }
  }
  const diff = drawn.facts.filter(f => !wanted.facts.includes(f))
  const want = wanted.facts.filter(f => !drawn.facts.includes(f))
  if (diff.length && want.length) return { correct: false, message: `È ${drawn.article}, ma ${diff.join(', ')}; quella da trovare: ${want.join(', ')}.`, drawn, wanted }
  return { correct: false, message: `È ${drawn.article}, ma non coincide ancora con quella da trovare: confronta i punti in cui le due curve tagliano gli assi.`, drawn, wanted }
}

/** Points of F(x, y) = 0 inside the window, as polyline segments (marching squares on a grid). */
export function contour(f: Node, env: Record<string, number>, win: { x0: number; x1: number; y0: number; y1: number }, n = 140): Array<[number, number, number, number]> {
  const xs = Array.from({ length: n + 1 }, (_, i) => win.x0 + (win.x1 - win.x0) * i / n)
  const ys = Array.from({ length: n + 1 }, (_, j) => win.y0 + (win.y1 - win.y0) * j / n)
  const v = ys.map(y => xs.map(x => safe(() => evaluate(f, { ...env, x, y }))))
  const segments: Array<[number, number, number, number]> = []
  const lerp = (a: number, b: number, fa: number, fb: number) => a + (b - a) * fa / (fa - fb)
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = v[j][i], b = v[j][i + 1], c = v[j + 1][i + 1], d = v[j + 1][i]
    if (a === null || b === null || c === null || d === null) continue
    const pts: Array<[number, number]> = []
    if ((a > 0) !== (b > 0)) pts.push([lerp(xs[i], xs[i + 1], a, b), ys[j]])
    if ((b > 0) !== (c > 0)) pts.push([xs[i + 1], lerp(ys[j], ys[j + 1], b, c)])
    if ((c > 0) !== (d > 0)) pts.push([lerp(xs[i], xs[i + 1], d, c), ys[j + 1]])
    if ((d > 0) !== (a > 0)) pts.push([xs[i], lerp(ys[j], ys[j + 1], a, d)])
    // Sign changes across a pole (e.g. 1/x) are not part of the curve.
    if (pts.length >= 2 && Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)) < 1e3 * (Math.abs(win.x1 - win.x0) + 1)) {
      segments.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1]])
      if (pts.length === 4) segments.push([pts[2][0], pts[2][1], pts[3][0], pts[3][1]])
    }
  }
  return segments
}

/** Samples of y = f(x), split where the function leaves the window or is undefined. */
export function samples(f: Node, env: Record<string, number>, win: { x0: number; x1: number; y0: number; y1: number }, n = 400): Array<Array<[number, number]>> {
  const runs: Array<Array<[number, number]>> = []
  let run: Array<[number, number]> = []
  const span = win.y1 - win.y0
  for (let i = 0; i <= n; i++) {
    const x = win.x0 + (win.x1 - win.x0) * i / n, y = safe(() => evaluate(f, { ...env, x }))
    if (y === null || y < win.y0 - span || y > win.y1 + span) { if (run.length > 1) runs.push(run); run = []; continue }
    run.push([x, y])
  }
  if (run.length > 1) runs.push(run)
  return runs
}
