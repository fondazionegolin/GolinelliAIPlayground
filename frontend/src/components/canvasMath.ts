/** Math helpers for formula items: plain text ("y = 3x^2 + 3") ⇄ LaTeX, and a sensible window for graphing a function. */
import { evaluate, parse, parseEquation, type Node } from './visual-comprehension/mathExpr'

const GREEK = new Set(['alpha', 'beta', 'gamma', 'delta', 'theta', 'lambda', 'mu', 'rho', 'sigma', 'tau', 'phi', 'omega'])
const PREC = { sum: 1, neg: 2, prod: 2, pow: 3, call: 4, atom: 5 }

const num = (v: number) => (Math.abs(v - Math.PI) < 1e-12 ? '\\pi' : String(Math.round(v * 1e9) / 1e9))

function prec(n: Node): number {
  if (n.t === 'num' || n.t === 'var') return PREC.atom
  if (n.t === 'call') return n.fn === 'sqrt' || n.fn === 'abs' || n.fn === 'exp' ? PREC.atom : PREC.call
  if (n.t === 'neg') return PREC.neg
  if (n.op === '/') return PREC.atom // \frac is self-delimited
  if (n.op === '^') return PREC.pow
  return n.op === '*' ? PREC.prod : PREC.sum
}

const wrap = (n: Node, min: number) => (prec(n) < min ? `\\left(${latex(n)}\\right)` : latex(n))

/** Implicit product (3x, 2(x+1)) reads better than 3\cdot x; numbers next to numbers keep the dot. */
const implicit = (a: Node, b: Node) => {
  const leftOk = a.t === 'num' || a.t === 'var' || (a.t === 'bin' && (a.op === '^' || a.op === '*'))
  const rightOk = b.t === 'var' || b.t === 'call' || (b.t === 'bin' && (b.op === '+' || b.op === '-' || (b.op === '^' && b.a.t === 'var')))
  return leftOk && rightOk
}

export function latex(n: Node): string {
  switch (n.t) {
    case 'num': return num(n.v)
    case 'var': return GREEK.has(n.name) ? `\\${n.name}` : n.name.length > 1 ? `\\mathrm{${n.name}}` : n.name
    case 'neg': return `-${wrap(n.a, PREC.prod)}`
    case 'call': {
      if (n.fn === 'sqrt') return `\\sqrt{${latex(n.a)}}`
      if (n.fn === 'abs') return `\\left|${latex(n.a)}\\right|`
      if (n.fn === 'exp') return `e^{${latex(n.a)}}`
      return `\\${n.fn === 'log' ? 'log' : n.fn}\\left(${latex(n.a)}\\right)`
    }
    case 'bin': {
      if (n.op === '/') return `\\frac{${latex(n.a)}}{${latex(n.b)}}`
      if (n.op === '^') return `${wrap(n.a, PREC.call)}^{${latex(n.b)}}`
      if (n.op === '+') return `${wrap(n.a, PREC.sum)}+${wrap(n.b, PREC.sum)}`
      if (n.op === '-') return `${wrap(n.a, PREC.sum)}-${wrap(n.b, PREC.prod)}`
      const left = wrap(n.a, PREC.prod)
      const right = n.b.t === 'bin' && (n.b.op === '+' || n.b.op === '-') ? `\\left(${latex(n.b)}\\right)` : wrap(n.b, PREC.prod)
      return implicit(n.a, n.b) ? `${left}${right}` : `${left}\\cdot ${right}`
    }
  }
}

const RELATIONS: Array<[RegExp, string]> = [[/<=|≤/, '\\le '], [/>=|≥/, '\\ge '], [/!=|≠/, '\\ne '], [/=/, '=']]

/** True when the text is already LaTeX (backslashes or braces) rather than plain math. */
export const looksLikeLatex = (text: string) => /[\\{}]/.test(text)

/** "y = 3x^2 + 3" → "y=3x^{2}+3". Null when the text is not plain math this parser understands. */
export function plainToLatex(text: string): string | null {
  const source = text.trim()
  if (!source) return null
  try {
    const hit = RELATIONS.map(([re, tex]) => ({ m: re.exec(source), tex })).filter((r) => r.m).sort((a, b) => a.m!.index - b.m!.index)[0]
    if (!hit) return latex(parse(source))
    const [left, right] = [source.slice(0, hit.m!.index), source.slice(hit.m!.index + hit.m![0].length)]
    if (!left.trim() || !right.trim()) return null
    return `${latex(parse(left))}${hit.tex}${latex(parse(right))}`
  } catch { return null }
}

/** The explicit function y = f(x) behind a plain-text formula, if there is one. */
export function explicitFunction(plain: string | undefined): Node | null {
  if (!plain) return null
  try {
    const eq = parseEquation(plain)
    return eq.explicit
  } catch { return null }
}

const nice = (v: number, up: boolean) => {
  const mag = 10 ** Math.floor(Math.log10(Math.max(Math.abs(v), 1e-9)))
  const unit = mag / 2
  return (up ? Math.ceil(v / unit) : Math.floor(v / unit)) * unit
}

/** A window that shows the interesting part: x around 0 (wider for trigonometry), y from the sampled range without asymptote spikes. */
export function graphWindow(f: Node, plain: string): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const trig = /sin|cos|tan/.test(plain)
  const xMin = trig ? -2 * Math.PI : -5, xMax = trig ? 2 * Math.PI : 5
  const ys: number[] = []
  for (let i = 0; i <= 200; i += 1) {
    const x = xMin + ((xMax - xMin) * i) / 200
    try { const y = evaluate(f, { x }); if (Number.isFinite(y)) ys.push(y) } catch { /* outside the domain */ }
  }
  if (ys.length < 5) return { xMin, xMax, yMin: -5, yMax: 5 }
  ys.sort((a, b) => a - b)
  let lo = Math.min(ys[Math.floor(ys.length * 0.03)], 0), hi = Math.max(ys[Math.ceil(ys.length * 0.97) - 1], 0)
  if (hi - lo < 2) { lo -= 1; hi += 1 }
  const pad = (hi - lo) * 0.12
  return { xMin: trig ? Number(xMin.toFixed(2)) : xMin, xMax: trig ? Number(xMax.toFixed(2)) : xMax, yMin: nice(lo - pad, false), yMax: nice(hi + pad, true) }
}
