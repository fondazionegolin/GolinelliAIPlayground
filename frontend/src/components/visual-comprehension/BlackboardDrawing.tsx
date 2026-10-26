import { createContext, useContext, useEffect, useId, useMemo, useState, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import katex from 'katex'
import type { Region } from './types'
import { INKS, TEXT_INKS, boxInFrame, curveValue, edgePoints, liveFormula, sliderDefault, sliderKey, withParams, type DiagramData, type DrawingLayout, type DrawingMark, type DrawingScene, type Frame, type FretboardData, type PlotData, type RhythmData } from './blackboard'
import { fitText } from './sceneGeometry'
import { refineScene, type Refinement } from './sceneLint'
import { Lens, NumberLineWidget, calibratedPlot, extraPath, isCalibratedPlot, labelRectFor } from './ExtraMarks'
import { buildTimeline, type Timing } from './drawingTimeline'
import { arrowHead, bentPath, curlyBrace, rectExit, smoothPath } from './ink'
import { colorHint, inkMask, type RGB } from './inkMask'


/** Left-to-right reveal, one line after the other, like handwriting. */
function Reveal({ id, box, lines, timing, children }: { id: string; box: Frame; lines: Frame[]; timing?: Timing; children: ReactNode }) {
  if (!timing) return <>{children}</>
  const per = timing.duration / Math.max(1, lines.length)
  return <g clipPath={`url(#${id})`}>
    <defs><clipPath id={id}>{lines.map((line, i) => <motion.rect key={i} x={line.x} y={line.y} height={line.height} initial={{ width: 0 }} animate={{ width: line.width }}
      transition={{ duration: per, delay: timing.delay + i * per, ease: 'linear' }} />)}</clipPath></defs>
    {children}
    {!lines.length && <rect {...box} fill="none" />}
  </g>
}

/** Written results (digits, formulas, curves) stay, faded, after their step; pointers and highlights belong to one step only. */
const PERSISTENT = new Set(['text', 'number', 'formula', 'plot', 'numberline'])
const MinFont = createContext(0)
/** True when rendering a still (reviewer snapshot): widgets must not start from an animated empty state. */
const Still = createContext(false)

function WrappedText({ text, box, size, color = INKS.ink, center = false, halo = false, timing, clipId }: {
  text: string; box: Frame; size: number; color?: string; center?: boolean; halo?: boolean; timing?: Timing; clipId?: string
}) {
  const { font, lines } = fitText(text, box.width, box.height, size, useContext(MinFont))
  const x = center ? box.x + box.width / 2 : box.x
  const top = center ? box.y + (box.height - lines.length * font * 1.22) / 2 : box.y
  const pad = font * .4
  const rows = lines.map((line, i) => {
    const width = line.length * font * .55 + pad * 2
    return { x: (center ? x - width / 2 : x - pad), y: top + i * font * 1.22 - pad / 2, width, height: font * 1.22 + pad }
  })
  return <Reveal id={clipId || 'vc-text'} box={box} lines={rows} timing={timing}>
    <text fill={color} fontSize={font} textAnchor={center ? 'middle' : 'start'}
      {...(halo ? { stroke: '#fffefb', strokeWidth: font * .28, paintOrder: 'stroke', strokeLinejoin: 'round' as const } : {})}>{lines.map((line, i) => <tspan key={i} x={x} y={top + font + i * font * 1.22}>{line}</tspan>)}</text>
  </Reveal>
}


function PlotWidget({ data, prefix, aspect = .7 }: { data: PlotData; prefix: string; aspect?: number }) {
  const prefersReduced = useReducedMotion(), still = useContext(Still)
  const reduced = prefersReduced || still
  // The drawing follows the box's proportions, so a wide board gets a wide graph instead of a small centred one.
  const H = 1000 * Math.min(1.1, Math.max(.42, aspect))
  const left = 115, top = 65, width = 800, height = H - 180
  const px = (x: number) => left + (x - data.x_min) * width / (data.x_max - data.x_min)
  const py = (y: number) => top + height - (y - data.y_min) * height / (data.y_max - data.y_min)
  const zeroX = px(Math.min(data.x_max, Math.max(data.x_min, 0)))
  const zeroY = py(Math.min(data.y_max, Math.max(data.y_min, 0)))
  const label = (value: number) => Math.abs(value) < 1e-9 ? '0' : Number(value.toPrecision(3)).toString()
  return <svg viewBox={`0 0 1000 ${H}`} width="100%" height="100%" overflow="hidden" aria-label="Grafico cartesiano">
    <defs><clipPath id={`${prefix}-plot-clip`}><rect x={left} y={top} width={width} height={height} /></clipPath><marker id={`${prefix}-axis`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10Z" fill={INKS.ink} /></marker></defs>
    {Array.from({ length: 6 }, (_, i) => {
      const x = left + i * width / 5, y = top + i * height / 5
      return <g key={i} fontSize="23" fill={INKS.ink}><path d={`M${x} ${top}V${top + height}M${left} ${y}H${left + width}`} stroke="#d9dfeb" strokeWidth="1.5" /><text x={x} y={top + height + 38} textAnchor="middle">{label(data.x_min + i * (data.x_max - data.x_min) / 5)}</text><text x={left - 18} y={y + 8} textAnchor="end">{label(data.y_max - i * (data.y_max - data.y_min) / 5)}</text></g>
    })}
    <path d={`M${left} ${zeroY}H${left + width + 20}M${zeroX} ${top + height}V${top - 22}`} fill="none" stroke={INKS.ink} strokeWidth="3" markerEnd={`url(#${prefix}-axis)`} />
    <text x={left + width + 35} y={zeroY + 10} fontSize="27" fill={INKS.ink}>{data.x_label}</text><text x={zeroX + 15} y={top - 25} fontSize="27" fill={INKS.ink}>{data.y_label}</text>
    <g clipPath={`url(#${prefix}-plot-clip)`}>
      {data.curves.map((curve, i) => {
        let path = '', previous = false
        for (let j = 0; j <= 180; j++) {
          const x = data.x_min + j * (data.x_max - data.x_min) / 180, y = curveValue(curve, x)
          if (y === null) { previous = false; continue }
          path += `${previous ? 'L' : 'M'}${px(x)} ${py(y)} `; previous = true
        }
        return <motion.path key={i} d={path} fill="none" stroke={INKS[curve.color]} strokeWidth="5" strokeLinecap="round" initial={reduced ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1 }}><title>{curve.label}</title></motion.path>
      })}
      {data.series.map((series, i) => series.mode === 'line'
        ? <polyline key={i} points={series.points.map(p => `${px(p.x)},${py(p.y)}`).join(' ')} fill="none" stroke={INKS[series.color]} strokeWidth="4"><title>{series.label}</title></polyline>
        : <g key={i}>{series.points.map((p, j) => <circle key={j} cx={px(p.x)} cy={py(p.y)} r="7" fill={INKS[series.color]}><title>{`${series.label}: (${p.x}, ${p.y})`}</title></circle>)}</g>)}
    </g>
    {[...data.curves, ...data.series].filter(s => s.label).map((s, i) => <text key={i} x={left + 15} y={top + 35 + i * 32} fill={INKS[s.color]} fontSize="25">{s.label}</text>)}
  </svg>
}

function DiagramWidget({ data, prefix, color }: { data: DiagramData; prefix: string; color: string }) {
  const bounds = (id: string) => boxInFrame(data.nodes.find(n => n.id === id)!.box, { x: 0, y: 0, width: 1000, height: 700 })
  return <svg viewBox="0 0 1000 700" width="100%" height="100%" overflow="hidden" aria-label="Diagramma con nodi e collegamenti">
    <defs><marker id={`${prefix}-edge`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10Z" fill={color} /></marker></defs>
    {data.edges.map((edge, i) => {
      const [a, b] = edgePoints(bounds(edge.source), bounds(edge.target))
      return <g key={i}><path d={`M${a.x} ${a.y}L${b.x} ${b.y}`} fill="none" stroke={color} strokeWidth="3" markerEnd={`url(#${prefix}-edge)`} />{edge.label && <WrappedText text={edge.label} box={{ x: (a.x + b.x) / 2 - 90, y: (a.y + b.y) / 2 - 42, width: 180, height: 35 }} size={24} color={color} center />}</g>
    })}
    {data.nodes.map(node => {
      const b = bounds(node.id), cx = b.x + b.width / 2, cy = b.y + b.height / 2
      return <g key={node.id}>{node.shape === 'ellipse' ? <ellipse cx={cx} cy={cy} rx={b.width / 2} ry={b.height / 2} fill="white" stroke={color} strokeWidth="3" /> : node.shape === 'diamond' ? <path d={`M${cx} ${b.y}L${b.x + b.width} ${cy}L${cx} ${b.y + b.height}L${b.x} ${cy}Z`} fill="white" stroke={color} strokeWidth="3" /> : <rect {...b} rx="14" fill="white" stroke={color} strokeWidth="3" />}<WrappedText text={node.label} box={{ x: b.x + 10, y: b.y + 8, width: b.width - 20, height: b.height - 16 }} size={29} color={color} center /></g>
    })}
  </svg>
}

function FretboardWidget({ data, color }: { data: FretboardData; color: string }) {
  const left = 145, right = 855, top = 210, bottom = 980
  const x = (i: number) => left + i * (right - left) / 5
  const fretHeight = (bottom - top) / data.visible_frets
  return <svg viewBox="0 0 1000 1170" width="100%" height="100%" overflow="hidden" aria-label={`Diagramma di chitarra: ${data.label}`}>
    <WrappedText text={data.label} box={{ x: 30, y: 20, width: 940, height: 90 }} size={64} color={color} center />
    {Array.from({ length: data.visible_frets + 1 }, (_, i) => <path key={i} d={`M${left} ${top + i * fretHeight}H${right}`} stroke={INKS.ink} strokeWidth={i === 0 && data.start_fret === 1 ? 12 : 3} />)}
    {data.frets.map((fret, i) => <g key={i}>
      <path d={`M${x(i)} ${top}V${bottom}`} stroke={INKS.ink} strokeWidth={5.5 - i * .6} />
      <text x={x(i)} y="1045" textAnchor="middle" fontSize="35" fill={INKS.ink}>{data.tuning[i]}</text>
      <text x={x(i)} y="1095" textAnchor="middle" fontSize="28" fill="#788498">{6 - i}ª</text>
      {fret <= 0 ? <text x={x(i)} y="175" textAnchor="middle" fontSize="54" fill={fret < 0 ? INKS.red : INKS.ink}>{fret < 0 ? '×' : '○'}</text> : <>
        <circle cx={x(i)} cy={top + (fret - data.start_fret + .5) * fretHeight} r="48" fill={color} />
        <text x={x(i)} y={top + (fret - data.start_fret + .5) * fretHeight + 15} textAnchor="middle" fontSize="46" fill="white" fontWeight="700">{data.fingers[i] || ''}</text>
      </>}
    </g>)}
    {Array.from({ length: data.visible_frets }, (_, i) => <text key={i} x="70" y={top + (i + .5) * fretHeight + 10} textAnchor="middle" fill="#788498" fontSize="30">{data.start_fret + i}</text>)}
    <text x="500" y="1150" textAnchor="middle" fontSize="28" fill="#788498">Dita: 1 indice · 2 medio · 3 anulare · 4 mignolo</text>
  </svg>
}

function RhythmWidget({ data, color }: { data: RhythmData; color: string }) {
  const total = data.events.reduce((sum, e) => sum + e.beats, 0), left = 65, length = 870
  let time = 0
  return <svg viewBox="0 0 1000 520" width="100%" height="100%" overflow="hidden" aria-label="Note e conteggio ritmico">
    <text x="65" y="60" fontSize="34" fill={INKS.ink}>{data.beats_per_bar}/{data.beat_unit} · durata e conteggio</text>
    <path d={`M${left} 345H${left + length}`} stroke={INKS.ink} strokeWidth="3" />
    {Array.from({ length: Math.ceil(total) + 1 }, (_, i) => <g key={i}>
      <path d={`M${left + i * length / total} 330V365`} stroke={i % data.beats_per_bar === 0 ? color : '#929dab'} strokeWidth={i % data.beats_per_bar === 0 ? 4 : 2} />
      {i < total && <text x={left + i * length / total + 10} y="405" fontSize="32" fill={INKS.ink}>{i % data.beats_per_bar + 1}</text>}
    </g>)}
    {data.events.map((e, i) => {
      const start = time; time += e.beats
      const cx = left + (start + Math.min(e.beats / 2, .5)) * length / total
      const duration = e.beats * 4 / data.beat_unit
      const base = duration === 3 ? 2 : duration === 1.5 ? 1 : duration === .75 ? .5 : duration
      const flags = base < 1 ? Math.min(3, Math.round(-Math.log2(base))) : 0
      return <g key={i}>
        <WrappedText text={e.label} box={{ x: left + start * length / total, y: 90, width: e.beats * length / total, height: 65 }} size={34} color={color} center />
        {e.rest ? <path d={`M${cx + 10} 190l-20 35 25 35-24 28 16 25`} fill="none" stroke={color} strokeWidth="8" /> : <>
          <ellipse cx={cx} cy="270" rx="22" ry="15" transform={`rotate(-20 ${cx} 270)`} fill={base >= 2 ? 'white' : color} stroke={color} strokeWidth="5" />
          {base < 4 && <path d={`M${cx + 19} 267V160`} stroke={color} strokeWidth="5" />}
          {Array.from({ length: flags }, (_, flag) => <path key={flag} d={`M${cx + 19} ${160 + flag * 22}q55 30 15 65`} fill="none" stroke={color} strokeWidth="5" />)}
          {[3, 1.5, .75].includes(duration) && <circle cx={cx + 40} cy="265" r="6" fill={color} />}
        </>}
        <path d={`M${left + start * length / total + 6} 442H${left + time * length / total - 6}`} stroke={color} strokeWidth="5" strokeLinecap="round" />
        <text x={left + (start + e.beats / 2) * length / total} y="490" textAnchor="middle" fontSize="25" fill={color}>{e.beats} {e.beats === 1 ? 'battito' : 'battiti'}</text>
      </g>
    })}
  </svg>
}


const SYMBOLS: Record<string, string> = {
  cdot: '·', times: '×', sin: 'sin', cos: 'cos', tan: 'tan', log: 'log', ln: 'ln', exp: 'exp', varphi: 'φ', vartheta: 'ϑ', epsilon: 'ε', varepsilon: 'ε', rho: 'ρ', tau: 'τ', pm: '±', partial: '∂', hbar: 'ħ', Psi: 'Ψ', psi: 'ψ', Phi: 'Φ', phi: 'φ', pi: 'π', alpha: 'α', beta: 'β',
  gamma: 'γ', delta: 'δ', Delta: 'Δ', theta: 'θ', lambda: 'λ', mu: 'μ', sigma: 'σ', omega: 'ω', infty: '∞', sqrt: '√', leq: '≤', geq: '≥',
  neq: '≠', approx: '≈', to: '→', rightarrow: '→', int: '∫', sum: 'Σ', nabla: '∇', cdots: '…', ldots: '…',
}
const SUPERSCRIPT: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻', n: 'ⁿ' }

const ATOM = /^(\w+|\\[a-zA-Z]+)$/

/** Readable plain-text rendering of common LaTeX, for snapshots where KaTeX cannot run. */
export function plainMath(tex: string): string {
  let out = tex.replace(/^\${1,2}|\${1,2}$/g, '')
  for (let i = 0; i < 3; i++) out = out.replace(/\\d?frac\{([^{}]*)\}\{([^{}]*)\}/g, (_, a: string, b: string) => `${ATOM.test(a) ? a : `(${a})`}/${ATOM.test(b) ? b : `(${b})`}`)
  return out.replace(/\\hat\{(\w)\}/g, '$1\u0302').replace(/\\(text|mathrm|mathbf)\{([^{}]*)\}/g, '$2').replace(/\\([a-zA-Z]+)/g, (_, name: string) => SYMBOLS[name] ?? '')
    .replace(/\^\{?([0-9n-]+)\}?/g, (_, e: string) => [...e].map(c => SUPERSCRIPT[c] ?? c).join('')).replace(/\\[,;! ]/g, ' ').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim().normalize('NFC')
}

function Formula({ mark, box, size, color, timing, clipId, plain }: { mark: DrawingMark; box: Frame; size: number; color: string; timing?: Timing; clipId: string; plain?: boolean }) {
  // Snapshots are rasterised from an <img>, where KaTeX's stylesheet is unavailable: show readable plain math instead.
  if (plain) return <WrappedText text={plainMath(mark.text)} box={box} size={size} color={color} />
  try {
    const html = katex.renderToString(mark.text.replace(/^\${1,2}|\${1,2}$/g, ''), { throwOnError: true, trust: false, maxExpand: 300, maxSize: 20, output: 'htmlAndMathml' })
    return <Reveal id={clipId} box={box} lines={[box]} timing={timing}><foreignObject {...box}><div className="vc-board-formula" style={{ fontSize: size, color }} dangerouslySetInnerHTML={{ __html: html }} /></foreignObject></Reveal>
  } catch { return <WrappedText text={mark.text} box={box} size={size} color={color} timing={timing} clipId={clipId} /> }
}

/**
 * Lights up only the stroke of one colour inside a region (a curve, a line): a soft veil dims the rest of the region,
 * a blurred halo and the crisp stroke sit on top. Falls back to `fallback` (the focus ring) when no such ink exists.
 */
function InkHighlight({ src, rect, source, hint, unit, filter, reveal, fallback }: {
  src: string; rect: Frame; source: Frame; hint: RGB | null; unit: number; filter: string; reveal: object; fallback: ReactNode
}) {
  const [mask, setMask] = useState<{ url: string; color: RGB } | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    void inkMask(src, source, hint).then(result => { if (alive) setMask(result) })
    return () => { alive = false }
  }, [src, source.x, source.y, source.width, source.height, hint?.join()]) // eslint-disable-line react-hooks/exhaustive-deps
  if (mask === null) return <>{fallback}</>
  if (!mask) return null
  return <motion.g {...reveal} pointerEvents="none">
    <rect {...rect} rx={unit * .006} fill="#ffffff" fillOpacity=".55" />
    <image href={mask.url} {...rect} preserveAspectRatio="none" filter={filter} opacity=".85" />
    <image href={mask.url} {...rect} preserveAspectRatio="none" />
  </motion.g>
}

/** Where an explorable plot and its controls go: under the plot if the board has room, else in a strip reserved at its bottom. */
function explorerLayout(given: Frame, frame: Frame, plot: PlotData, onBoard: boolean): { plot: Frame; controls: Frame; font: number } {
  // On a board the explorable plot is the protagonist: it takes the whole board, whatever box the model chose.
  const inset = Math.min(frame.width, frame.height) * .05
  const box = onBoard ? { x: frame.x + inset, y: frame.y + inset, width: frame.width - inset * 2, height: frame.height - inset * 2 } : given
  const sliders = plot.sliders?.length ?? 0
  const font = Math.min(Math.max(box.width / 40, frame.width / 75), frame.width / 48)
  const width = Math.min(box.width, font * 30)
  const height = font * (2.6 + sliders * 2 + (plot.formula ? 1.4 : 0))
  const gap = font * .6
  if (box.y + box.height + gap + height <= frame.y + frame.height) {
    return { plot: box, controls: { x: box.x + (box.width - width) / 2, y: box.y + box.height + gap, width, height }, font }
  }
  const plotHeight = Math.max(box.height * .45, box.height - height - gap)
  return { plot: { ...box, height: plotHeight }, controls: { x: box.x + (box.width - width) / 2, y: box.y + plotHeight + gap, width, height }, font }
}

/**
 * Sliders of an explorable plot, on the canvas right under the plot (or over its lower edge when the board is full).
 * Pointer events stay inside: dragging a slider must not pan the canvas.
 */
function PlotControls({ mark, area, font, values, onParam, appear }: {
  mark: DrawingMark; area: Frame; font: number; values?: Record<string, number>; onParam: (id: string, key: string, value: number | null) => void; appear: object
}) {
  const plot = mark.plot!, sliders = plot.sliders!
  const live = withParams(plot, values).curves
  const shown = [...new Set(sliders.map(s => s.curve))]
  const fmt = (v: number) => Number(v.toFixed(3)).toLocaleString('it-IT')
  return <motion.g {...appear}>
    <foreignObject {...area}>
      <div className="vc-canvas-explorer" style={{ fontSize: font }} onPointerDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
        <div className="vc-cx-head"><strong>{plot.formula || 'Parametri'}</strong>
          {values && <button type="button" onClick={() => onParam(mark.id, '*', null)}>Ripristina</button>}</div>
        {shown.map(i => <div key={i} className="vc-cx-live">{liveFormula(live[i])}</div>)}
        {sliders.map(s => {
          const key = sliderKey(s), value = values?.[key] ?? sliderDefault(plot, s)
          return <label key={key} className="vc-cx-row"><span>{s.label}</span>
            <input type="range" min={s.min} max={s.max} step={s.step} value={value} aria-label={`Parametro ${s.label}`}
              onChange={e => onParam(mark.id, key, Number(e.target.value))} />
            <output>{fmt(value)}</output></label>
        })}
      </div>
    </foreignObject>
  </motion.g>
}

/** A label in a soft white pill: legible on photos and on boards, never a bare floating word. */
function Pill({ rect, text, size, color, timing, clipId, filter }: { rect: Frame; text: string; size: number; color: string; timing?: Timing; clipId: string; filter: string }) {
  return <g>
    <motion.rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} rx={Math.min(rect.height / 2, size * .9)} fill="#ffffff" fillOpacity=".94"
      stroke={color} strokeOpacity=".28" strokeWidth={size * .06} filter={filter}
      {...(timing ? { initial: { opacity: 0, scale: .92 }, animate: { opacity: 1, scale: 1 }, transition: { duration: .25, delay: timing.delay }, style: { transformBox: 'fill-box', transformOrigin: 'center' } } : {})} />
    <WrappedText text={text} box={rect} size={size} color={color} center timing={timing} clipId={clipId} />
  </g>
}

/**
 * Draws a scene. Steps before `visibleStep` are shown as they are; with `animate`, the marks of `visibleStep`
 * are drawn one after the other like a teacher at the board (pen included), then `onStepDone` fires.
 * `snapshot` renders the final state for the art-direction reviewer (no animation, plain formulas).
 */
export default function BlackboardDrawing({ scene, layout, regions, visibleStep, animate = false, image, scale = 1, onStepDone, review: given, snapshot = false, params, onParam }: {
  scene: DrawingScene; layout: DrawingLayout; regions: Region[]; visibleStep: number; animate?: boolean
  image?: { url: string; width: number; height: number }; scale?: number; onStepDone?: () => void; review?: Refinement; snapshot?: boolean
  /** Live slider values per plot mark id, and how to change them (controls are drawn on the canvas, under the plot). */
  params?: Record<string, Record<string, number>>
  onParam?: (markId: string, key: string, value: number | null) => void
}) {
  const prefix = useId().replace(/:/g, '')
  const reduced = useReducedMotion()
  // Fonts and label positions are decided once per scene/size, so playback never reflows.
  const computed = useMemo(() => given ? null : refineScene(scene, regions, layout, scale), [given, scene, regions, layout, scale])
  const { geometry, shifts, minFont } = (given ?? computed)!
  const stepwise = visibleStep < scene.steps.length
  const playing = animate && !reduced && stepwise && !snapshot
  const timeline = useMemo(() => playing ? buildTimeline(scene, geometry, visibleStep, shifts) : null, [playing, scene, geometry, visibleStep, shifts])
  useEffect(() => {
    if (!onStepDone) return
    const timer = window.setTimeout(onStepDone, (timeline?.total ?? 0) * 1000)
    return () => clearTimeout(timer)
  }, [timeline, onStepDone])
  const frame = (m: DrawingMark) => geometry.frame(m)
  const bounds = (m: DrawingMark): Frame => geometry.bounds(m)
  const unit = Math.max(layout.image.width, layout.image.height)
  const penSize = unit * .006
  const shadow = `url(#${prefix}-shadow)`
  const spotlights = stepwise && !snapshot ? scene.elements.filter(m => m.kind === 'spotlight' && m.step === visibleStep) : []
  return <Still.Provider value={snapshot}><MinFont.Provider value={minFont}><g className="vc-blackboard" aria-label={scene.title} fontFamily="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" fontWeight={600}>
    <defs>
      <filter id={`${prefix}-shadow`} x="-30%" y="-40%" width="160%" height="200%"><feDropShadow dx="0" dy={unit * .002} stdDeviation={unit * .003} floodColor="#0f172a" floodOpacity=".16" /></filter>
      <filter id={`${prefix}-feather`} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation={unit * .012} /></filter>
      <filter id={`${prefix}-glow`} x="-20%" y="-20%" width="140%" height="140%"><feMorphology operator="dilate" radius={unit * .0025} /><feGaussianBlur stdDeviation={unit * .004} /></filter>
    </defs>
    {scene.elements.filter(m => m.kind !== 'spotlight' && (!stepwise || m.step === visibleStep || (m.step < visibleStep && PERSISTENT.has(m.kind)))).map(m => {
      const f = frame(m), b = bounds(m), color = INKS[m.color], textColor = TEXT_INKS[m.color], size = geometry.fontSize(m)
      const stroke = Math.max(f.width, unit * .6) * m.stroke_width / 100
      const points = geometry.markPoints(m)
      const fill = m.fill === 'none' ? 'none' : m.fill === 'white' ? 'white' : color
      const timing = timeline?.timings.get(m.id)
      const shift = shifts.get(m.id)
      const label = labelRectFor(m, geometry)
      const clipId = `${prefix}-clip-${m.id}`
      // Strokes are drawn by the pen; for a callout the leader comes first, then the words.
      const strokeTiming = timing && (m.kind === 'callout' ? { delay: timing.delay, duration: Math.min(.35, timing.duration * .3) } : timing)
      const textTiming = timing && (m.kind === 'callout' ? { delay: timing.delay + Math.min(.35, timing.duration * .3), duration: timing.duration * .7 } : timing)
      // Hidden until the pen starts: a zero-length dash with round caps would otherwise show as a dot.
      const draw = () => strokeTiming ? {
        initial: { pathLength: 0, opacity: 0 }, animate: { pathLength: 1, opacity: 1 },
        transition: { pathLength: { duration: strokeTiming.duration, delay: strokeTiming.delay, ease: 'easeInOut' as const }, opacity: { duration: .01, delay: strokeTiming.delay } },
      } : {}
      const appear = timing ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: Math.min(.5, timing.duration), delay: timing.delay } } : {}
      const afterStroke = strokeTiming ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: .15, delay: strokeTiming.delay + strokeTiming.duration * .9 } } : {}
      const headSize = Math.max(stroke * 4.2, unit * .012)
      const heads: string[] = []
      let path = extraPath(m, geometry)
      let pill: Frame | null = null
      if (m.kind === 'line') path = `M${points[0].x} ${points[0].y}L${points[1].x} ${points[1].y}`
      if (m.kind === 'arrow') {
        const bent = bentPath(points[0], points[1], m.bend ?? .2)
        path = bent.d; heads.push(arrowHead(points[1], bent.control, headSize))
      }
      if (m.kind === 'polyline') path = m.sharp ? points.map((p, n) => `${n ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') : smoothPath(points)
      if (m.kind === 'dimension') { heads.push(arrowHead(points[1], points[0], headSize * .75), arrowHead(points[0], points[1], headSize * .75)) }
      let leader = ''
      if (m.kind === 'brace' && points.length === 2) {
        const length = Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
        path = curlyBrace(points[0], points[1], Math.min(Math.max(length * .09, size * .45), size * 1.4)).d
        const label = geometry.braceLabel(m)
        if (label) {
          pill = label.rect
          const exit = rectExit(label.rect, label.tip)
          // Pushed away by the placer: a hairline keeps the label tied to its brace.
          if (Math.hypot(exit.x - label.tip.x, exit.y - label.tip.y) > size * .9) leader = `M${label.tip.x} ${label.tip.y}L${exit.x} ${exit.y}`
        }
      }
      if (m.kind === 'callout' && m.target) {
        pill = b
        const target = geometry.point(m.target), start = rectExit(b, target)
        const side = (target.x - start.x) * (target.y - start.y) >= 0 ? 1 : -1
        path = bentPath(start, target, (m.bend ?? .2) * side).d
      }
      if (m.kind === 'connector') {
        const region = regions.find(r => r.id === m.from_region_id), target = scene.elements.find(e => e.id === m.to_element_id)
        const moved = target && shifts.get(target.id), end = target && (moved ? { ...bounds(target), x: bounds(target).x + moved.x, y: bounds(target).y + moved.y } : bounds(target))
        if (region && end) {
          const [a, z] = edgePoints(boxInFrame(region.box, layout.image), end)
          const bent = bentPath(a, z, m.bend ?? .25)
          path = bent.d; heads.push(arrowHead(z, bent.control, headSize))
        }
      }
      const region = m.from_region_id ? geometry.regionRect(m.from_region_id) : null
      const explorer = m.kind === 'plot' && m.box && m.plot?.sliders?.length && onParam && !snapshot ? explorerLayout(b, f, m.plot, f !== layout.image) : null
      return <g key={m.id} transform={shift ? `translate(${shift.x} ${shift.y})` : undefined} data-drawing-kind={m.kind} data-drawing-id={m.id}
        opacity={stepwise && m.step < visibleStep ? .38 : 1}>
        <title>{m.text || m.fretboard?.label || m.id}</title>
        {m.kind === 'highlight' && (() => {
          const regionInfo = m.from_region_id ? regions.find(r => r.id === m.from_region_id) : undefined
          const hint = colorHint(m.text, regionInfo?.label, regionInfo?.text)
          // A focus ring around the element: visible on any background, unlike a tinted marker on a same-coloured button.
          const pad = Math.max(stroke * 2.2, Math.min(b.width, b.height) * .14), r = Math.min((b.height + pad * 2) / 2, size * .7)
          const ring = { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2, rx: r }
          const ringMark = <g>
            <motion.rect {...ring} fill="none" stroke={color} strokeOpacity=".22" strokeWidth={stroke * 5} {...appear} />
            <motion.rect {...ring} fill={color} fillOpacity=".1" stroke={color} strokeWidth={stroke * 1.15} {...draw()} />
          </g>
          // A curve or a coloured stroke: light up its ink, not its bounding box.
          if (image && !snapshot && m.space === 'image' && (m.ink || hint)) {
            const source = { x: b.x - layout.image.x, y: b.y - layout.image.y, width: b.width, height: b.height }
            return <InkHighlight src={image.url} rect={b} source={source} hint={hint} unit={unit} filter={`url(#${prefix}-glow)`} reveal={appear} fallback={ringMark} />
          }
          return ringMark
        })()}
        {path && <motion.path d={path} fill={m.kind === 'polygon' ? fill : 'none'} fillOpacity={m.fill === 'soft' ? .12 : 1} stroke={color} strokeWidth={m.kind === 'callout' ? stroke * .8 : stroke}
          strokeOpacity={m.kind === 'callout' ? .85 : 1} strokeLinecap="round" strokeLinejoin="round" {...draw()} />}
        {leader && <motion.path d={leader} stroke={color} strokeOpacity=".5" strokeWidth={stroke * .6} strokeDasharray={`${stroke * 1.5} ${stroke * 1.5}`} fill="none" {...afterStroke} />}
        {heads.length > 0 && <motion.g {...afterStroke}>{heads.map((d, n) => <path key={n} d={d} fill={color} stroke={color} strokeWidth={stroke * .5} strokeLinejoin="round" />)}</motion.g>}
        {m.kind === 'callout' && m.target && (() => {
          const t = geometry.point(m.target)
          return <motion.g {...afterStroke}><circle cx={t.x} cy={t.y} r={stroke * 3.2} fill={color} fillOpacity=".18" /><circle cx={t.x} cy={t.y} r={stroke * 1.5} fill={color} stroke="white" strokeWidth={stroke * .6} /></motion.g>
        })()}
        {pill && m.text && <Pill rect={pill} text={m.text} size={size} color={textColor} timing={textTiming} clipId={clipId} filter={shadow} />}
        {m.kind === 'circle' && points.length === 2 && <motion.circle cx={points[0].x} cy={points[0].y} r={Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)} stroke={color} strokeWidth={stroke} fill={fill} fillOpacity={m.fill === 'soft' ? .12 : 1} {...draw()} />}
        {m.kind === 'lens' && region && image && <motion.g {...appear}><Lens region={region} box={b} image={{ url: image.url, frame: layout.image }} color={color} /></motion.g>}
        {m.kind === 'numberline' && m.numberline && <motion.svg {...b} overflow="hidden" {...appear}><NumberLineWidget data={m.numberline} color={color} /></motion.svg>}
        {label && m.text && m.kind !== 'callout' && <WrappedText text={m.text} box={label} size={size} color={textColor} center halo timing={textTiming} clipId={clipId} />}
        {m.kind === 'rectangle' && <motion.rect {...b} rx={Math.min(size * .5, b.height * .2)} stroke={color} strokeWidth={stroke} fill={fill} fillOpacity={m.fill === 'soft' ? .12 : 1} {...draw()} />}
        {m.kind === 'ellipse' && <motion.ellipse cx={b.x + b.width / 2} cy={b.y + b.height / 2} rx={b.width / 2} ry={b.height / 2} stroke={color} strokeWidth={stroke} fill={fill} fillOpacity={m.fill === 'soft' ? .12 : 1} {...draw()} />}
        {(m.kind === 'text' || m.kind === 'number') && <WrappedText text={m.text} box={b} size={size} color={textColor} halo={m.space === 'image'} timing={timing} clipId={clipId} />}
        {m.kind === 'formula' && <Formula mark={m} box={b} size={size} color={textColor} timing={timing} clipId={clipId} plain={snapshot} />}
        {isCalibratedPlot(m) && m.plot && (() => {
          const { curves, series } = calibratedPlot({ ...m, plot: withParams(m.plot, params?.[m.id]) }, geometry)
          return <>
            {curves.map((c, n) => <g key={n}><motion.path d={c.d} fill="none" stroke={c.color} strokeWidth={stroke * 1.3} strokeLinecap="round" strokeLinejoin="round" {...draw()} />
              {c.label && c.end && <WrappedText text={c.label} box={{ x: c.end.x + size * .4, y: c.end.y - size * 1.4, width: size * 9, height: size * 1.5 }} size={size} color={c.color} halo timing={textTiming} clipId={`${clipId}-c${n}`} />}</g>)}
            {series.map((s, n) => s.mode === 'line'
              ? <motion.path key={`s${n}`} d={smoothPath(s.points)} fill="none" stroke={s.color} strokeWidth={stroke} {...draw()} />
              : <motion.g key={`s${n}`} {...appear}>{s.points.map((p, k) => <circle key={k} cx={p.x} cy={p.y} r={stroke * 2.2} fill={s.color} stroke="white" strokeWidth={stroke * .6} />)}</motion.g>)}
          </>
        })()}
        {explorer && <PlotControls mark={m} area={explorer.controls} font={explorer.font} values={params?.[m.id]} onParam={onParam!} appear={appear} />}
        {['plot', 'diagram', 'fretboard', 'rhythm'].includes(m.kind) && m.box && <motion.svg {...(explorer?.plot ?? b)} overflow="hidden" {...appear}>
          {m.kind === 'plot' && m.plot && <PlotWidget data={withParams(m.plot, params?.[m.id])} prefix={`${prefix}-${m.id}`}
            aspect={(explorer?.plot ?? b).height / Math.max(1, (explorer?.plot ?? b).width)} />}
          {m.kind === 'diagram' && m.diagram && <DiagramWidget data={m.diagram} prefix={`${prefix}-${m.id}`} color={color} />}
          {m.kind === 'fretboard' && m.fretboard && <FretboardWidget data={m.fretboard} color={color} />}
          {m.kind === 'rhythm' && m.rhythm && <RhythmWidget data={m.rhythm} color={color} />}
        </motion.svg>}
      </g>
    })}
    {spotlights.map(m => {
      const hole = m.from_region_id ? geometry.regionRect(m.from_region_id) : bounds(m)
      if (!hole) return null
      const pad = unit * .015, far = unit * 20
      return <motion.g key={m.id} data-drawing-kind="spotlight" pointerEvents="none" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .6 }}>
        <defs><mask id={`${prefix}-spot-${m.id}`}><rect x={-far} y={-far} width={far * 2} height={far * 2} fill="white" />
          <rect x={hole.x - pad} y={hole.y - pad} width={hole.width + pad * 2} height={hole.height + pad * 2} rx={pad * 1.5} fill="black" filter={`url(#${prefix}-feather)`} /></mask></defs>
        <rect x={-far} y={-far} width={far * 2} height={far * 2} fill="#0b1020" fillOpacity=".42" mask={`url(#${prefix}-spot-${m.id})`} />
      </motion.g>
    })}
    {timeline?.pen && <motion.g key={`pen-${visibleStep}`} className="vc-pen" initial={{ x: timeline.pen.x[0], y: timeline.pen.y[0], opacity: 0 }}
      animate={{ x: timeline.pen.x, y: timeline.pen.y, opacity: timeline.pen.times.map((_, i, all) => i === 0 || i === all.length - 1 ? 0 : 1) }}
      transition={{ duration: timeline.total, times: timeline.pen.times, ease: 'easeInOut' }} pointerEvents="none">
      <circle r={penSize * 2.4} fill="#f0a020" fillOpacity=".2" />
      <circle r={penSize} fill="#1f2a3d" stroke="white" strokeWidth={penSize * .45} />
    </motion.g>}
  </g></MinFont.Provider></Still.Provider>
}
