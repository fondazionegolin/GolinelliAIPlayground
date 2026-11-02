import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BACKGROUNDS, BODIES, ELEMENTS, bounce, captionAt, color, envAt, frames, luminance, num, rng, tint, type Entity, type Env, type Frame, type Scene } from './spec'

const TAU = Math.PI * 2

type Ctx = { scene: Scene; env: Env; frames: Map<string, Frame>; ink: string; light: boolean; defs: Map<string, ReactNode> }

/** A sphere-shaded gradient (registered once per colour and light direction). */
function sphere(ctx: Ctx, base: string, lightDeg: number): string {
  const id = `sh-${base.replace('#', '')}-${Math.round(lightDeg)}`
  if (!ctx.defs.has(id)) {
    const a = (lightDeg * Math.PI) / 180
    ctx.defs.set(id, (
      <radialGradient key={id} id={id} cx="50%" cy="50%" r="62%" fx={`${50 + 24 * Math.cos(a)}%`} fy={`${50 + 24 * Math.sin(a)}%`}>
        <stop offset="0%" stopColor={tint(base, 0.6)} /><stop offset="55%" stopColor={base} /><stop offset="100%" stopColor={tint(base, -0.5)} />
      </radialGradient>
    ))
  }
  return `url(#${id})`
}

const transformOf = (f: Frame) => `translate(${f.x.toFixed(2)} ${f.y.toFixed(2)}) rotate(${f.rot.toFixed(2)}) scale(${f.scale.toFixed(4)})`

function paint(ctx: Ctx, e: Entity, fallbackFill: string | 'none', r = 0) {
  const { env } = ctx
  const fillRaw = e.fill === undefined ? fallbackFill : color(e.fill, env, fallbackFill)
  const stroke = e.stroke === undefined ? undefined : color(e.stroke, env, 'none')
  const fill = e.shade && fillRaw !== 'none' && r > 0 ? sphere(ctx, fillRaw, num(e.light, env, 225)) : fillRaw
  return { fill, stroke, strokeWidth: stroke ? num(e.strokeWidth, env, 2) : undefined, strokeDasharray: e.dash ? '6 5' : undefined }
}

function moonLit(r: number, phase: number): string {
  const f = ((phase % 1) + 1) % 1
  const waxing = f <= 0.5
  const c = Math.cos(TAU * (waxing ? f : 1 - f))
  const rx = Math.abs(c) * r
  const path = `M0 ${-r}A${r} ${r} 0 0 1 0 ${r}A${rx.toFixed(3)} ${r} 0 0 ${c > 0 ? 0 : 1} 0 ${-r}Z`
  return waxing ? path : `${path}`
}

function drawBody(ctx: Ctx, e: Entity, f: Frame) {
  const { env } = ctx
  const r = num(e.r, env, 40)
  const preset = BODIES[e.kind || 'generic'] || BODIES.generic
  const base = e.fill ? color(e.fill, env, preset.color) : preset.color
  const grad = sphere(ctx, base, num(e.light, env, 225))
  const bandless = e.kind !== 'jupiter'
  const waning = e.phase !== undefined && ((((num(e.phase, env, 0.5) % 1) + 1) % 1) > 0.5)
  return (
    <g key={e.id} transform={transformOf(f)} opacity={f.opacity}>
      {(e.glow || preset.glow) && <circle r={r * 1.6} fill={preset.glow || base} opacity={0.22} filter="url(#blur)" />}
      {preset.ring && <ellipse rx={r * 1.9} ry={r * 0.5} fill="none" stroke="#fde68a" strokeWidth={r * 0.18} opacity={0.55} transform="rotate(-18)" />}
      {e.phase === undefined ? <circle r={r} fill={grad} /> : (
        <>
          <circle r={r} fill="#1f2937" />
          <path d={moonLit(r, num(e.phase, env, 0.5))} fill={grad} transform={waning ? 'scale(-1 1)' : undefined} />
        </>
      )}
      {e.kind === 'earth' && <g opacity={0.8} fill="#4ade80"><ellipse cx={-r * 0.25} cy={-r * 0.2} rx={r * 0.3} ry={r * 0.22} /><ellipse cx={r * 0.3} cy={r * 0.25} rx={r * 0.22} ry={r * 0.3} /></g>}
      {e.kind === 'moon' && e.phase === undefined && <g fill="#9ca3af" opacity={0.5}><circle cx={-r * 0.3} cy={-r * 0.2} r={r * 0.16} /><circle cx={r * 0.25} cy={r * 0.3} r={r * 0.2} /></g>}
      {!bandless && <g stroke={preset.dark} strokeWidth={r * 0.1} opacity={0.35}><line x1={-r * 0.9} x2={r * 0.9} y1={-r * 0.3} y2={-r * 0.3} /><line x1={-r} x2={r} y1={r * 0.15} y2={r * 0.15} /></g>}
      {preset.ring && <path d={`M${-r * 1.9} 0A${r * 1.9} ${r * 0.5} 0 0 0 ${r * 1.9} 0`} fill="none" stroke="#fde68a" strokeWidth={r * 0.18} opacity={0.75} transform="rotate(-18)" />}
    </g>
  )
}

function drawParticles(ctx: Ctx, e: Entity, f: Frame) {
  const { env } = ctx
  const w = num(e.w, env, 200), h = num(e.h, env, 120), r = num(e.r, env, 4)
  const count = Math.min(Math.max(Math.round(e.count ?? 40), 1), 200)
  const speed = num(e.speed, env, 1)
  const spread = Math.min(Math.max(num(e.spread, env, 1), 0.02), 1)
  const rand = rng(e.seed ?? 7)
  const a = color(e.fill, env, '#38bdf8'), b = e.fill2 ? color(e.fill2, env, '#f97316') : a
  const mode = e.mode || 'brownian'
  const dots = []
  for (let i = 0; i < count; i += 1) {
    const u = rand(), v = rand(), p1 = rand() * TAU, p2 = rand() * TAU, p3 = rand() * TAU
    const f1 = 0.5 + rand() * 1.1, f2 = 0.5 + rand() * 1.1
    const t = env.t * speed
    let x: number, y: number
    if (mode === 'rise') { x = u * w + Math.sin(t * f1 + p1) * w * 0.03; y = h - (((v * h + t * 28) % h) + h) % h }
    else if (mode === 'flow') { x = (((u * w + t * 40) % w) + w) % w; y = v * h + Math.sin(t * f1 + p1) * h * 0.03 }
    else {
      x = bounce((u * spread * w + (Math.sin(t * f1 + p1) + 0.6 * Math.sin(t * f2 * 1.9 + p2)) * w * 0.12 * spread + Math.sin(t * 0.37 + p3) * w * 0.08) / w) * w * (mode === 'brownian' ? 1 : 1)
      y = bounce((v * h + (Math.cos(t * f2 + p2) + 0.6 * Math.sin(t * f1 * 1.7 + p3)) * h * 0.14) / h) * h
      x = Math.min(x, spread * w)
    }
    dots.push(<circle key={i} cx={x - w / 2} cy={y - h / 2} r={r} fill={i < count * (e.ratio ?? 0.5) ? a : b} />)
  }
  return <g key={e.id} transform={transformOf(f)} opacity={f.opacity}>{dots}</g>
}

function drawHelix(ctx: Ctx, e: Entity, f: Frame) {
  const { env } = ctx
  const w = num(e.w, env, 260), h = num(e.h, env, 90), turns = e.turns ?? 2.5, N = 56
  const spin = num(e.speed, env, 1.4) * env.t
  const c1 = color(e.stroke, env, '#60a5fa'), c2 = e.fill2 ? color(e.fill2, env, '#f472b6') : '#f472b6'
  const s1: string[] = [], s2: string[] = [], rungs = [], dots = []
  for (let i = 0; i <= N; i += 1) {
    const u = i / N, x = (u - 0.5) * w, ph = TAU * turns * u + spin
    const y1 = (Math.sin(ph) * h) / 2, y2 = -y1, z = Math.cos(ph)
    s1.push(`${x.toFixed(1)} ${y1.toFixed(1)}`); s2.push(`${x.toFixed(1)} ${y2.toFixed(1)}`)
    if (i % 3 === 0) {
      rungs.push(<line key={`r${i}`} x1={x} y1={y1} x2={x} y2={y2} stroke="#cbd5e1" strokeWidth={2.2} opacity={0.35 + 0.35 * Math.abs(z)} />)
      dots.push(<circle key={`a${i}`} cx={x} cy={y1} r={3 + z * 1.2} fill={c1} opacity={0.6 + 0.4 * z} />, <circle key={`b${i}`} cx={x} cy={y2} r={3 - z * 1.2} fill={c2} opacity={0.6 - 0.4 * z} />)
    }
  }
  return (
    <g key={e.id} transform={transformOf(f)} opacity={f.opacity} strokeLinecap="round" fill="none">
      {rungs}
      <polyline points={s1.join(' ')} stroke={c1} strokeWidth={4} /><polyline points={s2.join(' ')} stroke={c2} strokeWidth={4} />
      {dots}
    </g>
  )
}

function drawEntity(ctx: Ctx, e: Entity): ReactNode {
  const f = ctx.frames.get(e.id)
  if (!f || f.opacity < 0.004) return null
  const { env } = ctx
  const sw = num(e.strokeWidth, env, 2)
  switch (e.type) {
    case 'circle': { const r = num(e.r, env, 20); return <circle key={e.id} transform={transformOf(f)} opacity={f.opacity} r={Math.max(r, 0)} {...paint(ctx, e, '#60a5fa', r)} filter={e.glow ? 'url(#blur)' : undefined} /> }
    case 'atom': {
      const el = ELEMENTS[e.el || 'C'] || { color: '#94a3b8', r: 20, ink: '#fff' }
      const r = num(e.r, env, el.r), fill = e.fill ? color(e.fill, env, el.color) : el.color
      return (
        <g key={e.id} transform={transformOf(f)} opacity={f.opacity}>
          <circle r={r} fill={sphere(ctx, fill, num(e.light, env, 225))} stroke="#0f172a" strokeOpacity={0.25} strokeWidth={1.5} />
          <text textAnchor="middle" dominantBaseline="central" fontSize={Math.max(r * 0.95, 9)} fontWeight={700} fill={el.ink} fontFamily="system-ui, sans-serif">{e.text ?? e.el ?? 'C'}</text>
        </g>
      )
    }
    case 'rect': { const w = num(e.w, env, 80), h = num(e.h, env, 50); return <rect key={e.id} transform={transformOf(f)} opacity={f.opacity} x={-w / 2} y={-h / 2} width={Math.max(w, 0)} height={Math.max(h, 0)} rx={num(e.rx, env, 6)} {...paint(ctx, e, '#60a5fa')} /> }
    case 'ellipse': { const w = num(e.w, env, 80), h = num(e.h, env, 50); return <ellipse key={e.id} transform={transformOf(f)} opacity={f.opacity} rx={Math.max(w / 2, 0)} ry={Math.max(h / 2, 0)} {...paint(ctx, e, '#60a5fa')} /> }
    case 'orbit': { const w = num(e.w, env, 200), h = num(e.h, env, 200); return <ellipse key={e.id} transform={transformOf(f)} opacity={f.opacity * 0.7} rx={w / 2} ry={h / 2} fill="none" stroke={e.stroke ? color(e.stroke, env, '#64748b') : '#64748b'} strokeWidth={1.6} strokeDasharray={e.dash === false ? undefined : '5 6'} /> }
    case 'line':
    case 'arrow': {
      const x2 = num(e.x2, env, 60), y2 = num(e.y2, env, 0), stroke = color(e.stroke ?? e.fill, env, ctx.ink), len = Math.hypot(x2, y2) || 1
      const ux = x2 / len, uy = y2 / len, head = 8 + sw * 2
      return (
        <g key={e.id} transform={transformOf(f)} opacity={f.opacity} stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeDasharray={e.dash ? '6 5' : undefined}>
          <line x1={0} y1={0} x2={x2 - (e.type === 'arrow' ? ux * head * 0.6 : 0)} y2={y2 - (e.type === 'arrow' ? uy * head * 0.6 : 0)} />
          {e.type === 'arrow' && len > 4 && <polygon points={`${x2},${y2} ${x2 - ux * head - uy * head * 0.5},${y2 - uy * head + ux * head * 0.5} ${x2 - ux * head + uy * head * 0.5},${y2 - uy * head - ux * head * 0.5}`} fill={stroke} stroke="none" />}
        </g>
      )
    }
    case 'path': {
      const draw = e.draw === undefined ? 1 : Math.min(Math.max(num(e.draw, env, 1), 0), 1)
      const p = paint(ctx, e, 'none')
      return <path key={e.id} transform={transformOf(f)} opacity={f.opacity} d={e.d || ''} {...p} stroke={p.stroke ?? (p.fill === 'none' ? ctx.ink : undefined)} strokeWidth={p.strokeWidth ?? (p.fill === 'none' ? 2.5 : undefined)} pathLength={1} strokeDasharray={draw < 1 ? `${draw} 2` : p.strokeDasharray} strokeLinecap="round" strokeLinejoin="round" /> }
    case 'text': return <text key={e.id} transform={transformOf(f)} opacity={f.opacity} textAnchor={e.anchor || 'middle'} dominantBaseline="central" fontSize={num(e.size, env, 18)} fontWeight={e.bold ? 700 : 500} fill={color(e.fill, env, ctx.ink)} fontFamily="system-ui, sans-serif" style={{ whiteSpace: 'pre' }}>{e.text}</text>
    case 'body': return drawBody(ctx, e, f)
    case 'wave': {
      const w = num(e.w, env, 300), amp = num(e.amp, env, 24), lambda = Math.max(e.wavelength ?? 80, 4), speed = num(e.speed, env, 40)
      const pts: string[] = []
      for (let u = 0; u <= w; u += 3) pts.push(`${(u - w / 2).toFixed(1)} ${(amp * Math.sin((TAU * (u - speed * env.t)) / lambda)).toFixed(2)}`)
      return <polyline key={e.id} transform={transformOf(f)} opacity={f.opacity} points={pts.join(' ')} fill="none" stroke={color(e.stroke ?? e.fill, env, '#38bdf8')} strokeWidth={sw + 1} strokeLinecap="round" strokeLinejoin="round" />
    }
    case 'helix': return drawHelix(ctx, e, f)
    case 'particles': return drawParticles(ctx, e, f)
    case 'spring': {
      const x2 = num(e.x2, env, 100), y2 = num(e.y2, env, 0), len = Math.hypot(x2, y2) || 1, ux = x2 / len, uy = y2 / len
      const coils = Math.max(Math.round(e.coils ?? 8), 2), lead = Math.min(len * 0.12, 14), pts = [`0 0`, `${ux * lead} ${uy * lead}`]
      for (let i = 0; i < coils * 2; i += 1) {
        const s = lead + ((len - 2 * lead) * (i + 0.5)) / (coils * 2), side = i % 2 ? -1 : 1
        pts.push(`${ux * s - uy * 9 * side} ${uy * s + ux * 9 * side}`)
      }
      pts.push(`${x2 - ux * lead} ${y2 - uy * lead}`, `${x2} ${y2}`)
      return <polyline key={e.id} transform={transformOf(f)} opacity={f.opacity} points={pts.join(' ')} fill="none" stroke={color(e.stroke, env, ctx.ink)} strokeWidth={sw + 0.5} strokeLinejoin="round" strokeLinecap="round" />
    }
    default: return null
  }
}

function drawBond(ctx: Ctx, e: Entity): ReactNode {
  const a = e.a && ctx.frames.get(e.a), b = e.b && ctx.frames.get(e.b)
  const op = Math.max(0, Math.min(1, num(e.opacity, ctx.env, 1)))
  if (!a || !b || op < 0.004) return null
  const prog = Math.min(Math.max(num(e.progress, ctx.env, 1), 0), 1)
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len
  const order = Math.min(Math.max(e.order ?? 1, 1), 3), gap = 6, stroke = e.stroke ? color(e.stroke, ctx.env, ctx.ink) : ctx.light ? '#64748b' : '#cbd5e1'
  const lines = Array.from({ length: order }, (_, i) => {
    const off = (i - (order - 1) / 2) * gap
    return <line key={i} x1={a.x + nx * off} y1={a.y + ny * off} x2={a.x + dx * prog + nx * off} y2={a.y + dy * prog + ny * off} />
  })
  return <g key={e.id} opacity={op} stroke={stroke} strokeWidth={order > 1 ? 3.4 : 5} strokeLinecap="round">{lines}</g>
}

function stars(env: Env, w: number, h: number) {
  const rand = rng(11)
  return Array.from({ length: 70 }, (_, i) => {
    const x = rand() * w, y = rand() * h, r = 0.5 + rand() * 1.4, ph = rand() * TAU
    return <circle key={i} cx={x} cy={y} r={r} fill="#fff" opacity={0.35 + 0.35 * Math.sin(env.t * 1.5 + ph)} />
  })
}

/** One frame of the scene as a standalone SVG element. */
export function MotionFrame({ scene, time, caption, className }: { scene: Scene; time: number; caption?: boolean; className?: string }) {
  const env = envAt(scene, time)
  const fr = frames(scene, env)
  const bgPair = BACKGROUNDS[scene.background]
  const bgBase = bgPair ? bgPair[0] : scene.background || '#0b1026'
  const light = luminance(bgBase) > 0.55
  const ctx: Ctx = { scene, env, frames: fr, ink: light ? '#1e293b' : '#e2e8f0', light, defs: new Map() }
  const bonds = scene.entities.filter((e) => e.type === 'bond').map((e) => drawBond(ctx, e))
  const others = scene.entities.filter((e) => e.type !== 'bond').map((e) => drawEntity(ctx, e))
  const text = caption ? captionAt(scene, time) : ''
  return (
    <svg className={className} viewBox={`0 0 ${scene.width} ${scene.height}`} xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" role="img" aria-label={scene.title}>
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={bgPair ? bgPair[0] : bgBase} /><stop offset="100%" stopColor={bgPair ? bgPair[1] : bgBase} /></linearGradient>
        <filter id="blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9" /></filter>
        {[...ctx.defs.values()]}
      </defs>
      <rect width={scene.width} height={scene.height} fill="url(#bg)" />
      {scene.background === 'space' && stars(env, scene.width, scene.height)}
      {bonds}{others}
      {text && (() => {
        const lines: string[] = []
        for (const word of text.split(' ')) { const last = lines[lines.length - 1]; if (last !== undefined && last.length + word.length < 72) lines[lines.length - 1] = `${last} ${word}`; else lines.push(word) }
        const band = 18 + lines.length * 24
        return <g><rect x={0} y={scene.height - band} width={scene.width} height={band} fill="#000" opacity={0.55} />{lines.map((l, i) => <text key={i} x={scene.width / 2} y={scene.height - band + 21 + i * 24} textAnchor="middle" dominantBaseline="central" fontSize={19} fill="#fff" fontFamily="system-ui, sans-serif">{l}</text>)}</g>
      })()}
    </svg>
  )
}

const SPEEDS = [0.5, 1, 2]

/** Controls stay at screen size through the board's --canvas-zoom, outside the clipped scene. */
export function MotionPlayer({ scene, autoPlay = true }: { scene: Scene; autoPlay?: boolean }) {
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(autoPlay)
  const [speed, setSpeed] = useState(1)
  const clock = useRef({ t: 0, last: 0, emit: 0 })
  useEffect(() => { clock.current.t = 0; setTime(0) }, [scene])
  useEffect(() => {
    if (!playing) return
    let raf = 0
    clock.current.last = performance.now()
    const tick = (now: number) => {
      const c = clock.current
      c.t += ((now - c.last) / 1000) * speed
      c.last = now
      if (!scene.loop && c.t >= scene.duration) { c.t = scene.duration; setTime(c.t); setPlaying(false); return }
      if (now - c.emit > 33) { c.emit = now; setTime(c.t) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, scene])
  const caption = useMemo(() => captionAt(scene, time), [scene, time])
  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  const shown = scene.loop ? ((time % scene.duration) + scene.duration) % scene.duration : Math.min(time, scene.duration)
  return (
    <div className="relative h-full w-full rounded-lg bg-slate-900 shadow-sm" style={{ border: '1.5px solid #64748b' }}>
      <div className="relative h-full w-full overflow-hidden rounded-lg">
        <MotionFrame scene={scene} time={time} className="h-full w-full" />
        {caption && <div className="pointer-events-none absolute inset-x-0 bottom-2 mx-auto w-fit max-w-[92%] rounded-md bg-black/60 px-3 py-1.5 text-center text-[13px] leading-snug text-white">{caption}</div>}
      </div>
      <div role="group" aria-label="Controlli animazione" className="absolute left-0 top-full z-20 flex items-center gap-2 rounded-lg bg-slate-900 p-1 text-white shadow-sm"
        style={{ width: 'max(300px, calc(100% * var(--canvas-zoom, 1)))', transform: 'scale(calc(1 / var(--canvas-zoom, 1)))', transformOrigin: 'top left', marginTop: 'calc(4px / var(--canvas-zoom, 1))' }}
        onPointerDown={stop} onClick={stop} onDoubleClick={stop} onKeyDown={stop} onKeyUp={stop}>
        <button type="button" aria-label={playing ? 'Pausa' : 'Riproduci'} onClick={() => { if (!playing && !scene.loop && clock.current.t >= scene.duration) { clock.current.t = 0 } setPlaying((p) => !p) }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/90 text-slate-900">
          {playing ? <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><rect x="6" y="5" width="4" height="14" /><rect x="14" y="5" width="4" height="14" /></svg> : <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M7 4.5v15l13-7.5z" /></svg>}
        </button>
        <input type="range" aria-label="Posizione" min={0} max={scene.duration} step={0.02} value={shown} onChange={(e) => { const v = Number(e.target.value); clock.current.t = v; setTime(v) }} className="h-9 min-w-0 flex-1 accent-pink-400" />
        <span className="w-16 shrink-0 text-right text-[10px] tabular-nums text-white/80">{shown.toFixed(1)} / {scene.duration.toFixed(0)}s</span>
        <button type="button" aria-label="Velocità" onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])} className="h-9 min-w-9 shrink-0 rounded bg-white/20 px-1.5 text-xs font-bold text-white">{speed}×</button>
      </div>
    </div>
  )
}
