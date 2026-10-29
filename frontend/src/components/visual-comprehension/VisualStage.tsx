import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { COLORS, type LabWidget, type SourceImage, type Region, type Overlay, type Selection, type StudentNote } from './types'
import { LabCards, labLayout } from './LabWidgets'
import { Maximize2, Minimize2, ZoomIn, ZoomOut, Eye, EyeOff, Play, Pause, ChevronLeft, ChevronRight, Expand, ImageIcon, Loader2, Hand, Lasso, Square, Pencil, Brush, MessageCircle, StickyNote, X } from '@/components/icons'
import BlackboardDrawing from './BlackboardDrawing'
import CanvasWorld from './CanvasWorld'
import { boxInFrame, getDrawingLayout, type DrawingLayout, type DrawingScene, type Frame } from './blackboard'
import { refineScene, type Refinement } from './sceneLint'
import { tl } from '@/i18n/tl'

type Camera = { x: number; y: number; w: number; h: number }

/** Rect the camera should show for a step: what the scene asks for, otherwise the marks drawn in that step. */
function focusRect(scene: DrawingScene, review: Refinement, layout: DrawingLayout, step: number): Frame | null {
  const g = review.geometry
  const asked = scene.focus?.find(f => f.step === step)?.target
  if (asked === 'all') return { x: 0, y: 0, width: layout.width, height: layout.height }
  if (asked && layout.frames[asked]) return layout.frames[asked]
  const region = asked ? g.regionRect(asked) : null
  if (region) return region
  const marks = scene.elements.filter(m => asked ? m.id === asked : m.step === step && !m.carried)
  const rects = marks.map(m => m.kind === 'spotlight' && m.from_region_id ? g.regionRect(m.from_region_id) : g.bounds(m)).filter((r): r is Frame => !!r)
  if (!rects.length) return null
  const x = Math.min(...rects.map(r => r.x)), y = Math.min(...rects.map(r => r.y))
  return { x, y, width: Math.max(...rects.map(r => r.x + r.width)) - x, height: Math.max(...rects.map(r => r.y + r.height)) - y }
}

const ease = (t: number) => t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2

type Tool = 'pan' | Selection['shape'] | 'note'
const MARK = '#ff2bd6'
const BRUSH = 2.8  // % of the image width
const TOOLS: Array<{ tool: Tool; label: string }> = [
  { tool: 'pan', label: tl("Sposta e ingrandisci") }, { tool: 'rect', label: tl("Seleziona con un rettangolo") }, { tool: 'lasso', label: tl("Seleziona a mano libera (lazo)") },
  { tool: 'scribble', label: tl("Scarabocchia sulla parte") }, { tool: 'brush', label: tl("Colora la zona con il pennello") },
  { tool: 'note', label: tl("Scrivi una tua idea sul canvas") },
]

const toolIcon = (tool: Tool) => tool === 'pan' ? <Hand /> : tool === 'rect' ? <Square /> : tool === 'lasso' ? <Lasso /> : tool === 'scribble' ? <Pencil />
  : tool === 'note' ? <StickyNote /> : <Brush />

/** Keeps freehand paths small enough to send: at most `max` points, evenly sampled. */
function thin(points: Array<[number, number]>, max = 600): Array<[number, number]> {
  if (points.length <= max) return points
  const step = points.length / max
  return Array.from({ length: max }, (_, i) => points[Math.floor(i * step)])
}

export default function VisualStage({ image, regions, overlays: activeOverlays, focusKey, drawing, reviewing = false, selection = null, onSelect, onAskStep,
  widgets = [], focusWidget = null, onAskLab, notes = [], onNotes, onAskNotes }: {
  image: SourceImage; regions: Region[]; overlays: Overlay[]; focusKey: string; drawing?: DrawingScene; reviewing?: boolean
  selection?: Selection | null; onSelect?: (selection: Selection | null) => void; onAskStep?: (title: string, selection: Selection | null) => void
  /** Interactive cards of the session (the Lab), and a request to fly to one of them. */
  widgets?: LabWidget[]; focusWidget?: { id: string; nonce: number } | null; onAskLab?: (text: string) => void
  /** The student's notes on the canvas (intuitions, deductions, results), and how to change them or have them read. */
  notes?: StudentNote[]; onNotes?: (notes: StudentNote[]) => void; onAskNotes?: () => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const viewport = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })
  const [showOverlays, setShowOverlays] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [drawingStep, setDrawingStep] = useState(99)
  const [playing, setPlaying] = useState(false)
  const [replay, setReplay] = useState(0)
  const [animate, setAnimate] = useState(false)
  // The drawing of the session as opened is shown complete; every later one (new reply, "rivedi") is drawn live.
  const openedKey = useRef(focusKey)
  const shownDrawing = showOverlays ? drawing : undefined
  const layout = useMemo(() => getDrawingLayout(image.width, image.height, shownDrawing), [image.width, image.height, shownDrawing])
  const lab = useMemo(() => labLayout(layout, widgets), [layout, widgets])
  const world = useMemo(() => ({ x: 0, y: 0, width: lab.width, height: lab.height }), [lab])
  const worldSize = Math.max(layout.width, layout.height)

  // Camera: a world rect always at the viewport's aspect ratio, so screen↔world mapping is linear.
  const aspect = size.height / Math.max(1, size.width)
  const fit = useCallback((r: Frame, pad = .06): Camera => {
    const w0 = r.width * (1 + pad * 2), h0 = r.height * (1 + pad * 2)
    const w = Math.max(w0, h0 / aspect), h = w * aspect
    return { x: r.x + r.width / 2 - w / 2, y: r.y + r.height / 2 - h / 2, w, h }
  }, [aspect])
  const [camera, setCamera] = useState<Camera>(() => fit(world))
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const userMoved = useRef(false)
  const flight = useRef<number>()
  const reduced = useReducedMotion()
  const flyTo = useCallback((target: Camera, ms = 800) => {
    cancelAnimationFrame(flight.current!)
    if (reduced || ms <= 0) { setCamera(target); return }
    const from = cameraRef.current, start = performance.now()
    const tick = (now: number) => {
      const t = ease(Math.min(1, (now - start) / ms))
      setCamera({ x: from.x + (target.x - from.x) * t, y: from.y + (target.y - from.y) * t, w: from.w + (target.w - from.w) * t, h: from.h + (target.h - from.h) * t })
      if (t < 1) flight.current = requestAnimationFrame(tick)
    }
    flight.current = requestAnimationFrame(tick)
  }, [reduced])
  useEffect(() => () => cancelAnimationFrame(flight.current!), [])
  useEffect(() => { if (!userMoved.current) setCamera(fit(world)) }, [fit, world])

  useEffect(() => {
    if (!viewport.current) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(viewport.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const onFullscreen = () => setFullscreen(document.fullscreenElement === root.current)
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [])

  // Legibility is judged at the fit-all scale, so labels don't reflow while the user zooms.
  const fitScale = size.width / fit(world).w
  const review = useMemo(() => drawing ? refineScene(drawing, regions, layout, Math.max(.05, Math.round(fitScale * 20) / 20)) : null,
    [drawing, regions, layout, fitScale])

  // A new drawing opens on its first step and waits: the student decides when to move on.
  const startTour = useCallback(() => { userMoved.current = false; setDrawingStep(0); setAnimate(true); setReplay(v => v + 1); setPlaying(false) }, [])
  const play = useCallback(() => { userMoved.current = false; setDrawingStep(0); setAnimate(true); setReplay(v => v + 1); setPlaying(true) }, [])
  useEffect(() => {
    if (reviewing) return
    if (focusKey !== openedKey.current && drawing) startTour()
    else { setDrawingStep(99); setPlaying(false); setAnimate(false) }
  }, [focusKey, reviewing]) // eslint-disable-line react-hooks/exhaustive-deps
  const lastStep = drawing ? drawing.steps.length - 1 : 0
  // Next phase after the current one is fully drawn, with a short pause to let it sink in.
  const pause = useRef<number>()
  const onStepDone = useCallback(() => {
    if (!playing) return
    if (drawingStep >= lastStep) { setPlaying(false); if (!userMoved.current) flyTo(fit(world), 1100); return }
    pause.current = window.setTimeout(() => setDrawingStep(s => s + 1), 900)
  }, [playing, drawingStep, lastStep, flyTo, fit, world])
  useEffect(() => () => clearTimeout(pause.current), [drawingStep, playing])
  const goTo = useCallback((step: number) => {
    setPlaying(false); setAnimate(step <= lastStep); userMoved.current = false; setTourFolded(false)
    setDrawingStep(step)
    if (step > lastStep) flyTo(fit(world), 700)
  }, [lastStep, flyTo, fit, world])
  useEffect(() => {
    if (!drawing || !showOverlays) return
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.closest('input, textarea, select, [contenteditable="true"]'))) return
      const current = Math.min(drawingStep, lastStep + 1)
      if (e.key === 'ArrowRight' && current <= lastStep) { e.preventDefault(); goTo(current >= lastStep ? lastStep + 1 : current + 1) }
      if (e.key === 'ArrowLeft' && current > 0) { e.preventDefault(); goTo(Math.min(current, lastStep + 1) - 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawing, showOverlays, drawingStep, lastStep, goTo])
  // The camera follows the explanation like a presenter: each step flies to what is being drawn.
  useEffect(() => {
    if (!drawing || !review || drawingStep > lastStep || userMoved.current) return
    const rect = focusRect(drawing, review, layout, drawingStep)
    if (!rect) return
    const min = worldSize * .42
    const grown = { x: rect.x - Math.max(0, min - rect.width) / 2, y: rect.y - Math.max(0, min - rect.height) / 2, width: Math.max(rect.width, min), height: Math.max(rect.height, min) }
    // The step card covers the lower part of the canvas: frame the element in the free space above it.
    const card = Math.min(.42, 190 / Math.max(1, size.height))
    flyTo(fit({ ...grown, height: grown.height / (1 - card) }, .1))
  }, [drawingStep, replay]) // eslint-disable-line react-hooks/exhaustive-deps

  // The Lab lives outside the tour: flying to a card does not touch the steps, and the tour does not pull the camera away.
  const [tourFolded, setTourFolded] = useState(false)
  useEffect(() => {
    const card = focusWidget && lab.cards.find(c => c.widget.id === focusWidget.id)
    if (!card) return
    flyTo(fit(card.frame, .05), 800)
    userMoved.current = true
    setTourFolded(true)  // the Lab card needs the whole canvas; the tour waits folded in a pill
  }, [focusWidget?.nonce, lab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pan (drag), pinch (two pointers) and wheel/trackpad zoom around the cursor.
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const zoomAt = useCallback((factor: number, px: number, py: number) => {
    const cam = cameraRef.current
    const w = Math.min(worldSize * 8, Math.max(worldSize * .04, cam.w * factor)), h = w * aspect
    const anchor = { x: cam.x + px / size.width * cam.w, y: cam.y + py / size.height * cam.h }
    setCamera({ x: anchor.x - px / size.width * w, y: anchor.y - py / size.height * h, w, h })
  }, [aspect, size.width, size.height, worldSize])
  const takeControl = () => { userMoved.current = true; cancelAnimationFrame(flight.current!) }
  useEffect(() => {
    const el = viewport.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); takeControl()
      const r = el.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top
      const mouseWheel = e.deltaMode !== 0 || (Math.abs(e.deltaY) >= 50 && e.deltaX === 0)
      if (e.ctrlKey || e.metaKey || mouseWheel) zoomAt(Math.exp(e.deltaY * (e.ctrlKey ? .01 : .0015)), px, py)
      else { const cam = cameraRef.current; setCamera({ ...cam, x: cam.x + e.deltaX / size.width * cam.w, y: cam.y + e.deltaY / size.height * cam.h }) }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoomAt, size.width, size.height]) // eslint-disable-line react-hooks/exhaustive-deps
  // Marking tools: the stroke is collected in image percentages, clamped to the source card.
  const [tool, setTool] = useState<Tool>('pan')
  const [stroke, setStroke] = useState<Array<[number, number]> | null>(null)
  const toImage = (clientX: number, clientY: number): [number, number] => {
    const r = viewport.current!.getBoundingClientRect(), cam = cameraRef.current, img = layout.image
    const wx = cam.x + (clientX - r.left) / size.width * cam.w, wy = cam.y + (clientY - r.top) / size.height * cam.h
    return [Math.min(100, Math.max(0, (wx - img.x) / img.width * 100)), Math.min(100, Math.max(0, (wy - img.y) / img.height * 100))]
  }
  // Notes sit anywhere on the canvas; their position is kept in % of the image so it survives boards being added.
  const [editing, setEditing] = useState<string | null>(null)
  const toImageFree = (clientX: number, clientY: number): [number, number] => {
    const r = viewport.current!.getBoundingClientRect(), cam = cameraRef.current, img = layout.image
    const wx = cam.x + (clientX - r.left) / size.width * cam.w, wy = cam.y + (clientY - r.top) / size.height * cam.h
    return [Math.min(600, Math.max(-500, (wx - img.x) / img.width * 100)), Math.min(600, Math.max(-500, (wy - img.y) / img.height * 100))]
  }
  const placeNote = (clientX: number, clientY: number) => {
    if (!onNotes || notes.length >= 40) return
    const [x, y] = toImageFree(clientX, clientY)
    const id = `n${Date.now().toString(36)}`
    onNotes([...notes.filter(n => n.text.trim()), { id, x, y, text: '' }])
    setEditing(id)
  }
  const finishStroke = (points: Array<[number, number]>) => {
    setStroke(null)
    if (tool === 'pan' || tool === 'note' || points.length < 2) return
    const pad = tool === 'brush' ? BRUSH / 2 : tool === 'scribble' ? .6 : 0
    const xs = points.map(p => p[0]), ys = points.map(p => p[1])
    const x0 = Math.max(0, Math.min(...xs) - pad), y0 = Math.max(0, Math.min(...ys) - pad * image.width / image.height)
    const x1 = Math.min(100, Math.max(...xs) + pad), y1 = Math.min(100, Math.max(...ys) + pad * image.width / image.height)
    if (x1 - x0 < .8 && y1 - y0 < .8) return  // a click, not a marking
    const box = { x: x0, y: y0, width: Math.max(.5, x1 - x0), height: Math.max(.5, y1 - y0) }
    onSelect?.({ shape: tool as Selection['shape'], box, points: tool === 'rect' ? [] : thin(points), brush: tool === 'brush' ? BRUSH : 0 })
  }
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    if (tool === 'note') { placeNote(e.clientX, e.clientY); return }
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (tool !== 'pan' && pointers.current.size === 1) setStroke([toImage(e.clientX, e.clientY)])
    else setStroke(null)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    const all = [...pointers.current.entries()]
    if (stroke && all.length === 1) {
      const next = toImage(e.clientX, e.clientY), last = stroke[stroke.length - 1]
      if (Math.hypot(next[0] - last[0], next[1] - last[1]) > .25) setStroke(tool === 'rect' ? [stroke[0], next] : [...stroke, next])
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
      return
    }
    if (all.length === 1) {
      takeControl()
      const cam = cameraRef.current
      setCamera({ ...cam, x: cam.x - (e.clientX - prev.x) / size.width * cam.w, y: cam.y - (e.clientY - prev.y) / size.height * cam.h })
    } else if (all.length === 2) {
      takeControl()
      const other = all.find(([id]) => id !== e.pointerId)![1]
      const before = Math.hypot(prev.x - other.x, prev.y - other.y), after = Math.hypot(e.clientX - other.x, e.clientY - other.y)
      const r = viewport.current!.getBoundingClientRect()
      if (before > 0 && after > 0) zoomAt(before / after, (e.clientX + other.x) / 2 - r.left, (e.clientY + other.y) / 2 - r.top)
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (stroke) finishStroke(stroke)
  }
  const askThisStep = () => {
    if (!drawing || !review || drawingStep > lastStep) return
    const rect = focusRect(drawing, review, layout, drawingStep), img = layout.image
    const inside = rect && rect.x >= img.x - 1 && rect.y >= img.y - 1 && rect.x + rect.width <= img.x + img.width + 1 && rect.y + rect.height <= img.y + img.height + 1
    const box = rect && inside ? { x: (rect.x - img.x) / img.width * 100, y: (rect.y - img.y) / img.height * 100, width: rect.width / img.width * 100, height: rect.height / img.height * 100 } : null
    onAskStep?.(drawing.steps[drawingStep], box ? { shape: 'rect', box, points: [], brush: 0 } : null)
  }
  const zoomPercent = Math.round(fit(world).w / camera.w * 100)

  // Explorable plots: the student's slider values, per plot mark, reset with every new drawing.
  const [params, setParams] = useState<Record<string, Record<string, number>>>({})
  useEffect(() => { setParams({}) }, [focusKey])
  const onParam = useCallback((markId: string, key: string, value: number | null) => setParams(p => {
    if (value === null) { const next = { ...p }; delete next[markId]; return next }
    return { ...p, [markId]: { ...p[markId], [key]: value } }
  }), [])

  const id = useId().replace(/:/g, '')
  const [selected, setSelected] = useState<Region | null>(null)
  useEffect(() => { setSelected(null) }, [focusKey])
  const overlays = showOverlays && !drawing ? activeOverlays : []
  const dot = worldSize / 48

  return <div ref={root} className="vc-visual-stack">
    <div className="vc-canvas-toolbar"><div className="vc-tools" role="toolbar" aria-label={tl("Strumenti di selezione")}>
      {TOOLS.map(t => <button key={t.tool} aria-label={t.label} title={t.label} aria-pressed={tool === t.tool} className={tool === t.tool ? 'vc-tool-on' : ''}
        onClick={() => setTool(t.tool)}>{toolIcon(t.tool)}</button>)}
      {selection && <button className="vc-clear-selection" onClick={() => onSelect?.(null)}>{tl("Togli selezione")}</button>}
    </div><div>
      <button aria-label={showOverlays ? tl("Nascondi disegno") : tl("Mostra disegno")} aria-pressed={showOverlays} onClick={() => setShowOverlays(v => !v)}>{showOverlays ? <Eye /> : <EyeOff />}</button>
      <button aria-label={tl("Inquadra l'immagine")} onClick={() => { takeControl(); flyTo(fit(layout.image, .04), 600) }}><ImageIcon /></button>
      <button aria-label={tl("Adatta tutto")} onClick={() => { userMoved.current = false; flyTo(fit(world), 600) }}><Expand /></button>
      {lab.area && <button className="vc-lab-button" aria-label={tl("Vai al Laboratorio")} onClick={() => { takeControl(); setTourFolded(true); flyTo(fit(lab.area!, .04), 700) }}>{tl("Laboratorio")}</button>}
      <button aria-label={tl("Riduci")} onClick={() => { takeControl(); zoomAt(1.25, size.width / 2, size.height / 2) }}><ZoomOut /></button>
      <button className="vc-fit" aria-label={tl("Adatta tutto")} onClick={() => { userMoved.current = false; flyTo(fit(world), 600) }}>{zoomPercent}%</button>
      <button aria-label={tl("Ingrandisci")} onClick={() => { takeControl(); zoomAt(.8, size.width / 2, size.height / 2) }}><ZoomIn /></button>
      <button disabled={!document.fullscreenEnabled} aria-label={fullscreen ? tl("Esci da schermo intero") : tl("Canvas a schermo intero")} onClick={() => {
        const operation = fullscreen ? document.exitFullscreen() : root.current?.requestFullscreen()
        operation?.catch(() => undefined)
      }}>{fullscreen ? <Minimize2 /> : <Maximize2 />}</button>
    </div></div>
    <div ref={viewport} className={`vc-canvas-viewport vc-infinite ${tool !== 'pan' ? 'vc-marking' : ''}`} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={() => { userMoved.current = false; flyTo(fit(world), 600) }}>
      <svg viewBox={`${camera.x} ${camera.y} ${camera.w} ${camera.h}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet"
        className="vc-source-svg" role="img" aria-label={tl("Immagine: {0}", image.name)}>
        <defs>
          <pattern id={`${id}-dots`} width={dot} height={dot} patternUnits="userSpaceOnUse"><circle cx={dot / 2} cy={dot / 2} r={dot * .055} fill="#c3c8d4" /></pattern>
        </defs>
        <rect x={camera.x - camera.w} y={camera.y - camera.h} width={camera.w * 3} height={camera.h * 3} fill="#f6f7f9" />
        <rect x={camera.x - camera.w} y={camera.y - camera.h} width={camera.w * 3} height={camera.h * 3} fill={`url(#${id}-dots)`} />
        <CanvasWorld layout={layout} imageUrl={image.url} />
        {overlays.length > 0 && <ClassicOverlays overlays={overlays} regions={regions} layout={layout} focusKey={focusKey} onSelect={setSelected} />}
        {drawing && showOverlays && review && <BlackboardDrawing key={`${focusKey}-${replay}`} scene={drawing} layout={layout} regions={regions} visibleStep={drawingStep} animate={animate}
          image={image} review={review} onStepDone={playing ? onStepDone : undefined} params={params} onParam={onParam} />}
        <LabCards lab={lab} unit={worldSize} onAsk={onAskLab} />
        <SelectionMark selection={selection} stroke={stroke} tool={tool} frame={layout.image} />
        <NoteCards notes={notes} frame={layout.image} unit={worldSize} editing={editing} onEdit={setEditing}
          onChange={(id, text) => onNotes?.(notes.map(n => n.id === id ? { ...n, text } : n))}
          onDone={id => { setEditing(null); onNotes?.(notes.filter(n => n.id !== id || n.text.trim())) }}
          onDelete={id => { setEditing(null); onNotes?.(notes.filter(n => n.id !== id)) }} />
      </svg>
      {tool === 'note' && !editing && <div className="vc-marking-hint" role="status">{tl("Tocca dove vuoi scrivere la tua idea: un dato, una deduzione, un risultato")}</div>}
      {tool !== 'pan' && tool !== 'note' && !selection && !stroke && <div className="vc-marking-hint" role="status">{tool === 'rect' ? tl("Trascina un rettangolo") : tool === 'lasso' ? tl("Disegna un contorno chiuso") : tool === 'scribble' ? tl("Scarabocchia sopra la parte") : tl("Colora la zona che ti interessa")} {tl("sull’immagine")}</div>}
      {onAskNotes && notes.some(n => n.text.trim()) && !editing && <button className="vc-notes-ask" onPointerDown={e => e.stopPropagation()} onClick={onAskNotes}>
        <StickyNote />{tl("Fai leggere le mie idee al tutor (")}{notes.filter(n => n.text.trim()).length})</button>}
      {reviewing && <div className="vc-reviewing" role="status"><Loader2 className="animate-spin" />{tl("Revisione grafica in corso…")}</div>}
    </div>
    {drawing && showOverlays && !reviewing && tourFolded && <button className="vc-tour-pill" onClick={() => setTourFolded(false)}>
      <Play />{tl("Percorso ·")} {lastStep + 1} {lastStep ? 'passi' : 'passo'}</button>}
    {drawing && showOverlays && !reviewing && !tourFolded && (() => {
      const overview = drawingStep > lastStep, current = Math.min(drawingStep, lastStep)
      const note = drawing.notes?.[current]
      return <div className="vc-step-card" aria-live="polite">
        <div className="vc-step-head">
          <span className="vc-step-count">{overview ? tl("Panoramica") : tl("Passo {0} di {1}", current + 1, lastStep + 1)}</span>
          <div className="vc-step-dots">{drawing.steps.map((title, i) => <button key={i} aria-label={tl("Passo {0}: {1}", i + 1, title)} title={title}
            className={!overview && i === current ? 'vc-dot-on' : i < current && !overview ? 'vc-dot-done' : ''} onClick={() => goTo(i)} />)}</div>
          <button className="vc-step-auto" aria-label={tl("Riduci il percorso")} title={tl("Riduci")} onClick={() => setTourFolded(true)}><Minimize2 /></button>
          <button className="vc-step-auto" aria-label={playing ? tl("Ferma la guida automatica") : tl("Guida automatica")} title={playing ? tl("Ferma") : tl("Guida automatica")}
            onClick={() => { if (playing) setPlaying(false); else play() }}>{playing ? <Pause /> : <Play />}</button>
        </div>
        <h3>{overview ? drawing.title : drawing.steps[current]}</h3>
        {!overview && note && <p>{note}</p>}
        <div className="vc-step-actions">
          <button disabled={!overview && current === 0} onClick={() => goTo(overview ? lastStep : current - 1)}><ChevronLeft />{tl("Indietro")}</button>
          {!overview && onAskStep && <button onClick={askThisStep}><MessageCircle />{tl("Chiedi su questo")}</button>}
          {!overview && <button className="vc-step-ghost" onClick={() => goTo(lastStep + 1)}>{tl("Vedi tutto")}</button>}
          {overview ? <button className="vc-step-next" onClick={() => goTo(0)}>{tl("Dal primo passo")}</button>
            : <button className="vc-step-next" onClick={() => goTo(current + 1)}>{current < lastStep ? <>{tl("Avanti")}<ChevronRight /></> : tl("Fine")}</button>}
        </div>
      </div>
    })()}
    {selected && <div className="vc-canvas-tooltip" role="status"><div><strong>{selected.label}</strong>{selected.confidence === 'low' && <span> {tl("· Lettura incerta")}</span>}<p>{selected.text}</p></div><button aria-label={tl("Chiudi dettaglio")} onClick={() => setSelected(null)}>×</button></div>}
  </div>
}

/** Pointer overlays of sessions saved before drawings existed. */
function ClassicOverlays({ overlays, regions, layout, focusKey, onSelect }: {
  overlays: Overlay[]; regions: Region[]; layout: DrawingLayout; focusKey: string; onSelect: (r: Region) => void
}) {
  const id = useId().replace(/:/g, '')
  const reducedMotion = useReducedMotion()
  const { image } = layout
  const unit = Math.max(image.width, image.height) / 600
  const find = (key: string) => regions.find(r => r.id === key)
  const spotlights = overlays.filter(o => o.kind === 'spotlight').map(o => find(o.region_id)).filter((r): r is Region => !!r)
  const toPixels = (r: Region) => boxInFrame(r.box, image)
  return <motion.g key={focusKey} initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.45 }}>
    <defs>
      <mask id={`${id}-mask`}><rect {...image} fill="white" />{spotlights.map(r => <rect key={r.id} {...toPixels(r)} rx={unit * 4} fill="black" />)}</mask>
      {Object.entries(COLORS).map(([key, color]) => <marker key={key} id={`${id}-${key}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={color} /></marker>)}
    </defs>
    {spotlights.length > 0 && <rect {...image} fill="#080b18" fillOpacity="0.72" mask={`url(#${id}-mask)`} />}
    {overlays.map((o, i) => {
      const region = find(o.region_id)
      if (!region) return null
      const { x, y, width, height } = toPixels(region)
      const color = COLORS[o.color]
      const target = o.to_region_id ? find(o.to_region_id) : undefined
      const end = target ? toPixels(target) : undefined
      const cx = x + width / 2, cy = y + height / 2
      const endCx = end ? end.x + end.width / 2 : cx, endCy = end ? end.y + end.height / 2 : cy
      const labelY = y - image.y > unit * 22 ? y - unit * 11 : y + unit * 12
      const badgeX = Math.min(image.x + image.width - unit * 12, Math.max(image.x + unit * 12, x + unit * 10))
      return <g key={`${i}-${o.region_id}`} role="button" tabIndex={0} aria-label={o.label || region.label} className="vc-overlay" onClick={() => onSelect(region)}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(region) } }}>
        <title>{o.label || region.label}{region.confidence === 'low' ? ' — lettura incerta' : ''}</title>
        {o.kind === 'arrow' && end ? <motion.path d={`M ${cx} ${cy} Q ${(cx + endCx) / 2} ${(cy + endCy) / 2} ${endCx} ${endCy}`} fill="none" stroke={color} strokeWidth={unit * 2.7}
          markerEnd={`url(#${id}-${o.color}-arrow)`} initial={reducedMotion ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, delay: i * 0.12 }} />
          : o.kind === 'underline' ? <motion.path d={`M ${x} ${y + height} L ${x + width} ${y + height}`} stroke={color} strokeWidth={unit * 3.5} strokeLinecap="round"
            initial={reducedMotion ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, delay: i * 0.12 }} />
          : <rect x={x} y={y} width={width} height={height} rx={Math.min(unit * 4, width * 0.15, height * 0.15)} fill={color} fillOpacity={o.kind === 'highlight' ? 0.17 : 0.06} stroke={color}
            strokeWidth={Math.min(unit * 2, height / 12)} strokeDasharray={region.confidence === 'low' ? `${unit * 5} ${unit * 3}` : undefined} />}
        <circle cx={badgeX} cy={labelY} r={unit * 9} fill={color} stroke="#151827" strokeWidth={unit} />
        <text x={badgeX} y={labelY + unit * 3.4} textAnchor="middle" fontSize={unit * 10} fontWeight="800" fill="#151827">{i + 1}</text>
      </g>
    })}
  </motion.g>
}

/**
 * The student's notes: small cards on the canvas, edited in place. Pointer events stay inside so typing never pans.
 * Enter saves, Shift+Enter starts a new line, Escape leaves (an empty note disappears).
 */
function NoteCards({ notes, frame, unit, editing, onEdit, onChange, onDone, onDelete }: {
  notes: StudentNote[]; frame: Frame; unit: number; editing: string | null; onEdit: (id: string) => void
  onChange: (id: string, text: string) => void; onDone: (id: string) => void; onDelete: (id: string) => void
}) {
  const width = unit * .2, font = unit * .016
  return <g className="vc-notes">{notes.map((n, i) => {
    const x = frame.x + n.x / 100 * frame.width, y = frame.y + n.y / 100 * frame.height
    const lines = Math.max(2, Math.ceil(n.text.length / 26) + (n.text.match(/\n/g)?.length ?? 0))
    const height = font * (2.6 + Math.min(10, lines) * 1.35)
    const open = editing === n.id
    return <foreignObject key={n.id} x={x} y={y} width={width} height={open ? Math.max(height, font * 9) : height} overflow="visible">
      <div className={`vc-note ${open ? 'vc-note-open' : ''}`} style={{ fontSize: font }} onPointerDown={e => e.stopPropagation()}
        onDoubleClick={e => e.stopPropagation()} onClick={() => { if (!open) onEdit(n.id) }}>
        <div className="vc-note-head"><span>{tl("La mia idea")} {i + 1}</span>
          <button type="button" aria-label={tl("Elimina la nota")} onClick={e => { e.stopPropagation(); onDelete(n.id) }}><X /></button></div>
        {open ? <textarea autoFocus value={n.text} maxLength={400} placeholder={tl("Scrivi qui: cosa noti, cosa deduci, il tuo risultato…")}
          aria-label={tl("Testo della nota")} onChange={e => onChange(n.id, e.target.value)} onBlur={() => onDone(n.id)}
          onKeyDown={e => { if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Escape') { e.preventDefault(); onDone(n.id) } }} />
          : <p>{n.text}</p>}
      </div>
    </foreignObject>
  })}</g>
}

/** The student's marking (saved or in progress), in magenta so it never looks like part of the tutor's drawing. */
function SelectionMark({ selection, stroke, tool, frame }: { selection: Selection | null; stroke: Array<[number, number]> | null; tool: Tool; frame: Frame }) {
  const at = ([x, y]: [number, number]) => `${frame.x + x / 100 * frame.width},${frame.y + y / 100 * frame.height}`
  const unit = Math.max(frame.width, frame.height)
  const line = unit * .004
  const shape = stroke ? tool : selection?.shape
  const points = stroke ?? selection?.points ?? []
  if (!shape || shape === 'pan') return null
  if (shape === 'rect') {
    const box = stroke ? (() => { const [a, b] = [stroke[0], stroke[stroke.length - 1]]; return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) } })() : selection!.box
    return <rect className="vc-selection" x={frame.x + box.x / 100 * frame.width} y={frame.y + box.y / 100 * frame.height} width={box.width / 100 * frame.width}
      height={box.height / 100 * frame.height} rx={line * 2} fill={MARK} fillOpacity=".1" stroke={MARK} strokeWidth={line} strokeDasharray={`${line * 3} ${line * 2}`} />
  }
  if (!points.length) return null
  const d = points.map(at).join(' ')
  if (shape === 'lasso') return <polygon className="vc-selection" points={d} fill={MARK} fillOpacity=".1" stroke={MARK} strokeWidth={line} strokeDasharray={`${line * 3} ${line * 2}`} strokeLinejoin="round" />
  const width = shape === 'brush' ? (selection?.brush || BRUSH) / 100 * frame.width : line * 1.4
  return <polyline points={d} fill="none" stroke={MARK} strokeOpacity={shape === 'brush' ? .35 : .9} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
}
