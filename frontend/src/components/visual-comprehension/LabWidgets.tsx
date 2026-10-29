import { useEffect, useId, useMemo, useState } from 'react'
import type { DrawingLayout, Frame } from './blackboard'
import { MathError, contour, judge, parseEquation, samples, type Equation } from './mathExpr'
import type { ExerciseWidget, ExplorerWidget, LabWidget, LabWindow } from './types'
import { SolidCard } from './SolidCard'
import { tl } from '@/i18n/tl'

/** The Lab: interactive cards placed to the right of the source and its boards, independent of the step-by-step tour. */
export type LabLayout = { width: number; height: number; cards: Array<{ widget: LabWidget; frame: Frame }>; area: Frame | null }

export function labLayout(base: DrawingLayout, widgets: LabWidget[]): LabLayout {
  if (!widgets.length) return { width: base.width, height: base.height, cards: [], area: null }
  const unit = Math.max(base.image.width, base.image.height)
  const gap = unit * .06, width = unit * .78, height = width * 1.1
  const x = base.width + gap * 1.5
  const cards = [...widgets].reverse().map((widget, i) => ({ widget, frame: { x, y: i * (height + gap), width, height } }))
  const bottom = cards.length * (height + gap) - gap
  return { width: x + width, height: Math.max(base.height, bottom), cards, area: { x, y: 0, width, height: bottom } }
}

type Curve = { eq: Equation; env: Record<string, number>; color: string; dashed?: boolean; width?: number }

function niceStep(span: number) {
  const raw = span / 8, power = 10 ** Math.floor(Math.log10(raw)), m = raw / power
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * power
}

/** Cartesian plot of explicit (y = f(x)) or implicit (F(x, y) = 0) equations, computed by the safe math engine. */
function LabPlot({ window: w, curves, height }: { window: LabWindow; curves: Curve[]; height: number }) {
  const W = 1000, H = Math.round(W * height), m = { l: 46, r: 18, t: 16, b: 34 }
  const px = (x: number) => m.l + (x - w.x_min) / (w.x_max - w.x_min) * (W - m.l - m.r)
  const py = (y: number) => H - m.b - (y - w.y_min) / (w.y_max - w.y_min) * (H - m.t - m.b)
  const sx = niceStep(w.x_max - w.x_min), sy = niceStep(w.y_max - w.y_min)
  const ticks = (a: number, b: number, s: number) => Array.from({ length: Math.floor(b / s) - Math.ceil(a / s) + 1 }, (_, i) => (Math.ceil(a / s) + i) * s)
  const paths = useMemo(() => curves.map(c => {
    try {
      if (c.eq.explicit) return samples(c.eq.explicit, c.env, { x0: w.x_min, x1: w.x_max, y0: w.y_min, y1: w.y_max })
        .map(run => run.map(([x, y], i) => `${i ? 'L' : 'M'}${px(x).toFixed(1)} ${py(y).toFixed(1)}`).join('')).join('')
      return contour(c.eq.f, c.env, { x0: w.x_min, x1: w.x_max, y0: w.y_min, y1: w.y_max })
        .map(([x1, y1, x2, y2]) => `M${px(x1).toFixed(1)} ${py(y1).toFixed(1)}L${px(x2).toFixed(1)} ${py(y2).toFixed(1)}`).join('')
    } catch { return '' }
  }), [curves, w.x_min, w.x_max, w.y_min, w.y_max]) // eslint-disable-line react-hooks/exhaustive-deps
  const zeroX = Math.min(Math.max(0, w.x_min), w.x_max), zeroY = Math.min(Math.max(0, w.y_min), w.y_max)
  const clip = `vc-lab-clip-${useId().replace(/:/g, '')}`
  return <svg viewBox={`0 0 ${W} ${H}`} className="vc-lab-plot" role="img" aria-label={tl("Grafico")}>
    <defs><clipPath id={clip}><rect x={m.l} y={m.t} width={W - m.l - m.r} height={H - m.t - m.b} /></clipPath></defs>
    {ticks(w.x_min, w.x_max, sx).map(x => <g key={`x${x}`}><path d={`M${px(x)} ${m.t}V${H - m.b}`} stroke="#eef0f5" /><text x={px(x)} y={H - m.b + 22} textAnchor="middle" className="vc-lab-tick">{Number(x.toFixed(6))}</text></g>)}
    {ticks(w.y_min, w.y_max, sy).map(y => <g key={`y${y}`}><path d={`M${m.l} ${py(y)}H${W - m.r}`} stroke="#eef0f5" /><text x={m.l - 8} y={py(y) + 5} textAnchor="end" className="vc-lab-tick">{Number(y.toFixed(6))}</text></g>)}
    <path d={`M${m.l} ${py(zeroY)}H${W - m.r}M${px(zeroX)} ${m.t}V${H - m.b}`} stroke="#64748b" strokeWidth="1.6" />
    {/* The target is a soft wide track: the student's curve has to land on it (a dash pattern would restart on every contour piece). */}
    <g clipPath={`url(#${clip})`}>{curves.map((c, i) => paths[i] && <path key={i} d={paths[i]} fill="none" stroke={c.color} strokeWidth={c.dashed ? 14 : c.width ?? 3.2}
      strokeOpacity={c.dashed ? .35 : 1} strokeLinecap="round" strokeLinejoin="round" />)}</g>
  </svg>
}

function ExplorerCard({ widget }: { widget: ExplorerWidget }) {
  const initial = Object.fromEntries(widget.params.map(p => [p.name, p.value]))
  const [values, setValues] = useState<Record<string, number>>(initial)
  const eq = useMemo(() => { try { return parseEquation(widget.equation) } catch { return null } }, [widget.equation])
  const fmt = (v: number) => Number(v.toFixed(3)).toLocaleString('it-IT')
  return <>
    <div className="vc-lab-formula">{widget.formula || widget.equation}</div>
    {eq ? <LabPlot window={widget.window} curves={[{ eq, env: values, color: '#3e63dd' }]} height={.58} /> : <p className="vc-lab-error">{tl("Equazione non leggibile.")}</p>}
    {widget.params.map(p => <label key={p.name} className="vc-lab-row"><span>{p.label}</span>
      <input type="range" min={p.min} max={p.max} step={p.step} value={values[p.name]} aria-label={tl("Parametro {0}", p.label)}
        onChange={e => { const v = Number(e.target.value); setValues(old => ({ ...old, [p.name]: v })) }} />
      <output>{fmt(values[p.name])}</output></label>)}
    <div className="vc-lab-foot">{widget.note && <p>{widget.note}</p>}<button type="button" onClick={() => setValues(initial)}>{tl("Ripristina")}</button></div>
  </>
}

const BLANK = /\[([a-zA-Z][a-zA-Z0-9]{0,7})\]/g
const SUP: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' }
/** Template text as it is written on paper: x^2 → x², * → ·, - → −. */
const pretty = (text: string) => text.replace(/\^(\d)/g, (_, d: string) => SUP[d]).replace(/\*/g, '·').replace(/-/g, '−')

function ExerciseCard({ widget, onAsk }: { widget: ExerciseWidget; onAsk?: (text: string) => void }) {
  const target = useMemo(() => parseEquation(widget.target), [widget.target])
  const parts = useMemo(() => widget.template ? widget.template.split(BLANK) : [], [widget.template])  // odd indexes are blank names
  const [blanks, setBlanks] = useState<Record<string, string>>({})
  const [free, setFree] = useState('')
  const [hints, setHints] = useState(0)
  const [solution, setSolution] = useState(false)
  // The student gets there first: the solution opens only after trying and using every hint.
  const [tried, setTried] = useState(false)
  const attemptText = widget.template
    ? (parts.every((part, i) => i % 2 === 0 || (blanks[part] ?? '').trim()) ? parts.map((part, i) => i % 2 ? `(${blanks[part]})` : part).join('') : '')
    : free
  const [debounced, setDebounced] = useState('')
  useEffect(() => { const t = setTimeout(() => setDebounced(attemptText), 250); return () => clearTimeout(t) }, [attemptText])
  type Result = { attempt: Equation; verdict: ReturnType<typeof judge> } | { error: string } | null
  const result = useMemo((): Result => {
    if (!debounced.trim()) return null
    try {
      const attempt = parseEquation(debounced)
      return { attempt, verdict: judge(attempt, target) }
    } catch (e) { return { error: e instanceof MathError ? e.message : tl("Non riesco a leggere l'equazione.") } }
  }, [debounced, target])
  const curves: Curve[] = [
    ...(widget.show_target || solution ? [{ eq: target, env: {}, color: '#94a3b8', dashed: true, width: 3 }] : []),
    ...(result && 'attempt' in result && result.attempt ? [{ eq: result.attempt, env: {}, color: result.verdict.correct ? '#2b9a66' : '#3e63dd' }] : []),
  ]
  const solved = !!(result && 'verdict' in result && result.verdict.correct)
  useEffect(() => { if (result && 'verdict' in result) setTried(true) }, [result])
  return <>
    <p className="vc-lab-prompt">{widget.prompt}</p>
    <LabPlot window={widget.window} curves={curves} height={.5} />
    <div className="vc-lab-legend">{(widget.show_target || solution) && <span><i className="vc-dash" />{tl("da trovare")}</span>}<span><i className="vc-solid" />{tl("la tua")}</span></div>
    <div className="vc-lab-input" aria-label={tl("La tua equazione")}>
      {widget.template ? parts.map((part, i) => i % 2 === 0 ? <span key={i}>{pretty(part)}</span>
        : <input key={i} value={blanks[part] ?? ''} aria-label={tl("Casella {0}", part)} placeholder="?" size={Math.max(2, (blanks[part] ?? '').length + 1)}
          onChange={e => { const v = e.target.value; setBlanks(old => ({ ...old, [part]: v })) }} />)
        : <input className="vc-lab-free" value={free} placeholder={tl("Scrivi l'equazione, es. y = 2x^2 - 3")} aria-label={tl("Equazione")}
          onChange={e => setFree(e.target.value)} />}
    </div>
    {result && <p className={`vc-lab-feedback ${'error' in result ? 'vc-fb-error' : solved ? 'vc-fb-ok' : 'vc-fb-no'}`} role="status">
      {'error' in result ? result.error : result.verdict.message}</p>}
    {hints > 0 && <ul className="vc-lab-hints">{widget.hints.slice(0, hints).map((h, i) => <li key={i}>{h}</li>)}</ul>}
    {(solved || solution) && widget.explanation && <p className="vc-lab-explanation">{solution && !solved && <strong>{widget.target} · </strong>}{widget.explanation}</p>}
    <div className="vc-lab-foot">
      {hints < widget.hints.length && !solved && <button type="button" onClick={() => setHints(h => h + 1)}>{tl("Suggerimento")}</button>}
      {!solved && !solution && tried && hints >= widget.hints.length && <button type="button" onClick={() => setSolution(true)}>{tl("Mostra soluzione")}</button>}
      {onAsk && attemptText.trim() && <button type="button" onClick={() => onAsk(tl("Esercizio «{0}»: ho scritto {1}.", widget.title, attemptText) +
        (result && 'verdict' in result ? tl(" La lavagna dice: {0}", result.verdict.message) : '') + ' Aiutami a capire.')}>{tl("Chiedi al tutor")}</button>}
    </div>
  </>
}

/**
 * The interactive cards, drawn on the canvas as HTML. Pointer events stay inside a card: typing, dragging a slider or
 * selecting text must not pan the canvas.
 */
export function LabCards({ lab, unit, onAsk }: { lab: LabLayout; unit: number; onAsk?: (text: string) => void }) {
  if (!lab.area) return null
  return <g className="vc-lab">
    <text x={lab.area.x} y={lab.area.y - unit * .018} fontSize={unit * .024} fontWeight={600} fill="#64748b" fontFamily="ui-sans-serif, system-ui, sans-serif">{tl("Laboratorio")}</text>
    {lab.cards.map(({ widget, frame }) => <foreignObject key={widget.id} {...frame}>
      <div className="vc-lab-card" style={{ fontSize: frame.width / 34 }} data-widget-id={widget.id}
        onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
        <div className="vc-lab-head"><span>{widget.kind === 'explorer' ? tl("Esplora") : widget.kind === 'solid' ? tl("Solido 3D") : tl("Esercizio")}</span><strong>{widget.title}</strong></div>
        {widget.kind === 'explorer' ? <ExplorerCard widget={widget} /> : widget.kind === 'solid' ? <SolidCard widget={widget} onAsk={onAsk} />
          : <ExerciseCard widget={widget} onAsk={onAsk} />}
      </div>
    </foreignObject>)}
  </g>
}
