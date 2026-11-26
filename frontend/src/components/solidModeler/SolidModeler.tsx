import { SectionIllustration } from '@/design/primitives/SectionHeading'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button } from '@/design/primitives/Button'
import { IconButton } from '@/design/primitives/IconButton'
import {
  Camera, ChevronDown, ChevronLeft, ChevronRight, Folder, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical,
  ArrowDownToLine, Box, Circle, Cloud, CloudOff, Download, Grid3x3, Loader2, Share2, Smartphone, Cone, Copy, Cylinder, Donut, Eye, EyeOff, FileDown, FileUp, FlipHorizontal2, FlipVertical2,
  FolderOpen, Minimize, Search, Group, Home, Layers, Maximize, MousePointer2, Move, RotateCw, PencilLine, PenTool, Pyramid, Redo2, Sparkles, Star, Torus, Trash2, Triangle, Type, Undo2, Ungroup,
  type LucideIcon,
} from '@/components/icons'
import { shapePreviewUrl } from './shapePreview'
import SolidModelerViewport, { type FacePick, type PlanePick, type TransformMode, type ViewName, type ViewportApi } from './SolidModelerViewport'
import SketchEditor, { type RevolveRequest } from './sketch/SketchEditor'
import {
  applySketchExtrusion, applySketchRevolve, coplanarSketchRefs, materializeFeatures, depthThrough, faceFrame, findSketchOnPlane, planeOfSketch, planeReferences, regenerateFeatures, revolveFromSelection,
  sketchFromExtrusion, sketchRegionsOf, type RegionSel, smallestRegionAt, STANDARD_PLANES, toPlane, upsertSketch, type SketchPlane,
} from './sketch/plane'
import { analyzeSketch, interiorPoint, regionContains, type P, type SketchEntity } from './sketch/geom2d'
import SolidModelerAIPanel from './SolidModelerAIPanel'
import SolidModelShareDialog from './SolidModelShareDialog'
import SolidModelLibrary from './SolidModelLibrary'
import PresenceAvatars from '@/components/PresenceAvatars'
import { useResourcePresence } from '@/hooks/useResourcePresence'
import SolidModelArDialog from './SolidModelArDialog'
import SolidRenderDialog from './SolidRenderDialog'
import { MATERIALS } from './materials'
import { useSolidProject, type SaveStatus } from './useSolidProject'
import { editableEdges, edgeLength, resizeEdge, supportsEdgeFillet, exportSTL, objectGeometry, scaleOf, worldBox } from './geometry'
import {
  alignObjects, createPrimitive, dropToPlate, duplicateObjects, groupObjects, mirrorObjects, uid, ungroupObject, type AlignMode,
} from './sceneOps'
import type { GroupObject, PrimitiveDef, PrimitiveKind, PrimitiveObject, SceneObject, Vec3 } from './types'
import { COLOR_SWATCHES, KIND_LABEL, PRIMITIVES } from './types'
import { SidebarCollapseButton, SidebarRail, useSidebarCollapsed } from '@/components/SidebarRail'
import { tl } from '@/i18n/tl'

const ICONS: Record<PrimitiveKind | 'group', LucideIcon> = {
  polyhedron: Pyramid, box: Box, cylinder: Cylinder, sphere: Circle, cone: Cone, pyramid: Pyramid, hemisphere: Circle,
  wedge: Triangle, torus: Torus, tube: Donut, star: Star, text: Type, group: Group, extrusion: PenTool, sketch: PencilLine, revolve: Torus,
}

interface SketchSession {
  plane: SketchPlane
  refs: [P, P][]
  /** Edges of the solids on the plane: they close regions together with the strokes. */
  boundary: [P, P][]
  resume?: SketchEntity[]
  /** The sketch object that mirrors this session in the scene (created as soon as something is drawn). */
  sketchId?: string
  /** Open straight in the revolve tool. */
  startRevolve?: boolean
}

/** Top-level object that is, or contains, `id` (a face target may have been grouped meanwhile). */
function topLevelOf(objects: SceneObject[], id: string | undefined): SceneObject | null {
  if (!id) return null
  const contains = (o: SceneObject): boolean => o.id === id || (o.kind === 'group' && o.children.some(contains))
  return objects.find(contains) ?? null
}

/** Features (extrusion / revolve) whose sketch can be reopened from the current selection. */
function sketchEditables(obj: SceneObject | null): { obj: PrimitiveObject; group?: GroupObject }[] {
  if (!obj) return []
  const editable = (o: SceneObject): o is PrimitiveObject =>
    o.kind !== 'group' && ((o.kind === 'extrusion' && !!(o as PrimitiveObject).params.sketch) || !!(o as PrimitiveObject).params?.source)
  if (editable(obj)) return [{ obj }]
  if (obj.kind === 'group' && obj.scale.every(s => Math.abs(s - 1) < 1e-6)) return obj.children.filter(editable).map(c => ({ obj: c, group: obj }))
  return []
}

/** Set (or clear) the parametric link of one feature, wherever it sits (top level or a group child). */
function withSource(objects: SceneObject[], id: string, source: NonNullable<PrimitiveObject['params']['source']>): SceneObject[] {
  const apply1 = (o: SceneObject): SceneObject => {
    if (o.kind === 'group') return { ...o, children: o.children.map(apply1) }
    return o.id === id ? { ...o, params: { ...o.params, source } } : o
  }
  return objects.map(apply1)
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || tl("modello")

// ── Small inputs ───────────────────────────────────────────────────────────

function NumField({ label, value, onCommit, step = 1, min, suffix }: {
  label: string; value: number; onCommit: (v: number) => void; step?: number; min?: number; suffix?: string
}) {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = () => {
    if (draft === null) return
    const v = Number(draft.replace(',', '.'))
    if (Number.isFinite(v)) onCommit(min !== undefined ? Math.max(min, v) : v)
    setDraft(null)
  }
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[10px] font-semibold text-slate-400">{label}</span>
      <div className="flex items-center rounded-lg border border-slate-200 bg-white focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100">
        <input
          type="number"
          step={step}
          value={draft ?? String(Math.round(value * 100) / 100)}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setDraft(null) }}
          className="w-full min-w-0 bg-transparent px-2 py-1 text-xs font-semibold text-slate-900 outline-none"
        />
        {suffix && <span className="pr-1.5 text-[10px] text-slate-400">{suffix}</span>}
      </div>
    </label>
  )
}

/** Scale: a frame with a grab handle on each corner. */
const ScaleHandlesIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <rect x="5" y="5" width="14" height="14" />
    {[[2.5, 2.5], [18, 2.5], [2.5, 18], [18, 18]].map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="3.5" height="3.5" rx="0.5" fill="currentColor" />)}
  </svg>
)
/** Extrude: wireframe cube with its top face selected. */
const ExtrudeFaceIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M12 12v9M4 16.5l8 4.5 8-4.5V7.5" opacity="0.85" />
    <path d="M4 7.5v9" opacity="0.85" />
    <path d="M12 3 20 7.5 12 12 4 7.5Z" fill="currentColor" fillOpacity="0.4" />
  </svg>
)

const MODE_BUTTONS = [
  ['select', MousePointer2, tl("Seleziona"), 'Esc'],
  ['move', Move, tl("Muovi: frecce sugli assi, dischi sulle facce"), 'M'],
  ['rotate', RotateCw, tl("Ruota: anelli sui tre assi (Shift = passi di 1°)"), 'R'],
  ['scale', ScaleHandlesIcon, tl("Scala: angoli proporzionali, facce simmetriche"), 'S'],
  ['extrude', ExtrudeFaceIcon, tl("Estrudi: clic su una faccia (solido, sketch o linea chiusa), poi scrivi la quota"), 'E'],
] as const

/** Always-visible, translucent list of the scene in the viewport: folders (3D bodies / holes / sketches) of small buttons, collapsible. */
function SceneOutliner({ objects, selection, onSelect, onToggleHidden }: { objects: SceneObject[]; selection: string[]; onSelect: (ids: string[]) => void; onToggleHidden: (ids: string[], hidden: boolean) => void }) {
  const [open, setOpen] = useState(true)
  const [closed, setClosed] = useState<Record<string, boolean>>({})
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const anchor = useRef<string | null>(null)
  const q = query.trim().toLocaleLowerCase('it')
  const matches = (o: SceneObject) => !q || o.name.toLocaleLowerCase('it').includes(q) || KIND_LABEL[o.kind as keyof typeof KIND_LABEL]?.toLocaleLowerCase('it').includes(q)
  const folders = [
    { id: 'bodies', label: tl("Corpi 3D"), items: objects.filter(o => o.kind !== 'sketch' && !o.hole && matches(o)) },
    { id: 'holes', label: tl("Fori"), items: objects.filter(o => o.kind !== 'sketch' && o.hole && matches(o)) },
    { id: 'sketches', label: tl("Sketch"), items: objects.filter(o => o.kind === 'sketch' && matches(o)) },
  ].filter(f => f.items.length)
  // Visible order (folders top to bottom): the range for Shift + click.
  const order = folders.filter(f => !closed[f.id]).flatMap(f => f.items.map(o => o.id))
  const visibleIds = folders.flatMap(f => f.items.map(o => o.id))
  const clickItem = (e: React.MouseEvent, id: string) => {
    const from = anchor.current ?? selection[0] ?? null
    if (e.shiftKey && from && order.includes(from) && order.includes(id)) {
      const a = order.indexOf(from), b = order.indexOf(id)
      const range = order.slice(Math.min(a, b), Math.max(a, b) + 1)
      onSelect(e.ctrlKey || e.metaKey ? [...new Set([...selection, ...range])] : range)
      return
    }
    anchor.current = id
    if (e.shiftKey || e.ctrlKey || e.metaKey) onSelect(selection.includes(id) ? selection.filter(x => x !== id) : [...selection, id])
    else onSelect([id])
  }
  const chip = 'pointer-events-auto bg-[rgba(255,255,255,0.72)] text-[#374151] backdrop-blur-sm'
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} title={tl("Mostra gli oggetti")} aria-label={tl("Mostra gli oggetti")}
        className={`${chip} absolute left-3 top-14 z-10 flex items-center gap-1.5 rounded-full py-1 pl-2.5 pr-2 text-[11px] font-semibold text-[#4b5563] hover:bg-[rgba(255,255,255,0.92)]`}>
        <Layers className="h-3.5 w-3.5" /> {objects.length} <ChevronRight className="h-3.5 w-3.5" />
      </button>
    )
  }
  return (
    <div className="pointer-events-none absolute bottom-14 left-3 top-14 z-10 flex w-48 flex-col">
      <div className="mb-1 flex items-center justify-between">
        <p className={`${chip} flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold text-[#4b5563]`}><Layers className="h-3 w-3" /> {tl("Oggetti")} ({objects.length})</p>
        <button type="button" onClick={() => { setSearching(s => !s); if (searching) setQuery('') }} title={tl("Cerca tra gli oggetti")} aria-label={tl("Cerca tra gli oggetti")} aria-pressed={searching} className={`${chip} ml-auto mr-1 rounded-full p-1 text-[#4b5563] hover:bg-[rgba(255,255,255,0.92)] ${searching ? '!bg-[#2a2c33] !text-white' : ''}`}><Search className="h-3.5 w-3.5" /></button>
        <button type="button" onClick={() => setOpen(false)} title={tl("Comprimi gli oggetti")} aria-label={tl("Comprimi gli oggetti")} className={`${chip} rounded-full p-1 text-[#4b5563] hover:bg-[rgba(255,255,255,0.92)]`}><ChevronLeft className="h-3.5 w-3.5" /></button>
      </div>
      {searching && (
        <div className="pointer-events-auto mb-1 flex items-center gap-1">
          <input
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') { setSearching(false); setQuery('') } }}
            placeholder={tl("Cerca oggetti…")}
            aria-label={tl("Cerca oggetti")}
            className="ds-field min-w-0 flex-1 px-3 py-1.5 text-[11px] font-semibold"
          />
          <button type="button" disabled={!visibleIds.length} onClick={() => onSelect(visibleIds)} title={tl("Seleziona tutti i risultati")} className={`${chip} shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold text-[#4b5563] hover:bg-[rgba(255,255,255,0.92)] disabled:opacity-40`}>{tl("Tutti")} ({visibleIds.length})</button>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pb-2 pr-1">
        {q && !visibleIds.length && <p className={`${chip} rounded-xl px-2 py-1.5 text-[11px] text-[#4b5563]`}>{tl("Nessun oggetto trovato.")}</p>}
        {!objects.length && <p className={`${chip} rounded-xl px-2 py-1.5 text-[11px] leading-4 text-[#4b5563]`}>{tl("Scena vuota: aggiungi una forma, parti da uno sketch 2D o chiedi all'assistente AI.")}</p>}
        {folders.map(f => {
          const allHidden = f.items.every(o => o.hidden)
          return (
            <div key={f.id} className="mb-1.5">
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setClosed(c => ({ ...c, [f.id]: !c[f.id] }))} aria-expanded={!closed[f.id]} className={`${chip} flex min-w-0 flex-1 items-center gap-1 rounded-full px-2 py-1 text-left text-[10px] font-semibold text-[#4b5563] hover:bg-[rgba(255,255,255,0.92)]`}>
                  {closed[f.id] ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  <Folder className="h-3 w-3" /> <span className="truncate">{f.label}</span> <span className="ml-auto font-normal text-[#4b5563]">{f.items.length}</span>
                </button>
                <button type="button" title={allHidden ? tl("Mostra tutti") : tl("Nascondi tutti")} aria-label={allHidden ? tl("Mostra tutti") : tl("Nascondi tutti")} onClick={() => onToggleHidden(f.items.map(o => o.id), !allHidden)} className={`${chip} rounded-full p-1 text-[#4b5563] hover:bg-[rgba(255,255,255,0.92)]`}>
                  {allHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                </button>
              </div>
              {!closed[f.id] && (
                <div className="mt-0.5 flex flex-col gap-0.5 pl-2">
                  {f.items.map(o => {
                    const Icon = ICONS[o.kind]
                    const sel = selection.includes(o.id)
                    return (
                      <div key={o.id} className={`pointer-events-auto flex items-center rounded-full backdrop-blur-sm ${sel ? 'bg-[#2a2c33] text-white' : 'bg-[rgba(255,255,255,0.72)] text-[#374151] hover:bg-[rgba(255,255,255,0.92)]'} ${o.hidden ? 'opacity-55' : ''}`}>
                        <button
                          type="button"
                          title={o.name}
                          onClick={e => clickItem(e, o.id)}
                          className={`flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-2 text-left text-[11px] ${sel ? 'font-semibold' : ''}`}
                        >
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: o.hole ? '#a3a3a3' : o.color }} />
                          <Icon className="h-3 w-3 shrink-0 opacity-70" />
                          <span className="truncate">{o.name}</span>
                        </button>
                        <button type="button" title={o.hidden ? tl("Mostra") : tl("Nascondi")} aria-label={o.hidden ? tl("Mostra") : tl("Nascondi")} aria-pressed={!!o.hidden} onClick={() => onToggleHidden([o.id], !o.hidden)} className={`rounded-full p-1.5 ${sel ? "text-white/80 hover:text-white" : "text-[#4b5563] hover:text-[#111827]"}`}>
                          {o.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ToolButton({ icon: Icon, label, onClick, disabled, shortcut }: {
  icon: LucideIcon; label: string; onClick: () => void; disabled?: boolean; shortcut?: string
}) {
  return (
    <IconButton
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      tone="neutral"
      surface="ghost"
      size="sm"
      className="shrink-0 rounded-full"
    >
      <Icon />
    </IconButton>
  )
}

const Divider = () => <span className="mx-1 h-5 w-px shrink-0 bg-slate-200" />

// ── Main ───────────────────────────────────────────────────────────────────

/** `student`: session-student editor (own projects, no class/public sharing). */
export default function SolidModeler({ leading, student = false }: { leading?: ReactNode; student?: boolean }) {
  const [hist, setHist] = useState<{ past: SceneObject[][]; present: SceneObject[]; future: SceneObject[][] }>(
    () => ({ past: [], present: [], future: [] }),
  )
  const objects = hist.present
  const [selection, setSelection] = useState<string[]>([])
  const [edgeMode, setEdgeMode] = useState(false)
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null)
  const [snap, setSnap] = useState(1)
  const [panel, setPanel] = useState<'shape' | 'ai'>('ai')
  const [libraryCollapsed, setLibraryCollapsed] = useSidebarCollapsed('solid-modeler-library')
  const [hover, setHover] = useState<string | null>(null)
  const [inLibrary, setInLibrary] = useState(true)
  const [fullWindow, setFullWindow] = useState(false)
  const [shareId, setShareId] = useState<string | null>(null)
  const [arOpen, setArOpen] = useState<{ id: string | null } | null>(null)
  const [aiHighlight, setAiHighlight] = useState<string[]>([])
  const [sketch, setSketch] = useState<SketchSession | null>(null)
  const [pickingPlane, setPickingPlane] = useState(false)
  const [regionPick, setRegionPick] = useState<{ id: string; index: RegionSel } | null>(null)
  const [extrudeDepth, setExtrudeDepth] = useState('10')
  const [extrudeSym, setExtrudeSym] = useState(false)
  const [renderOpen, setRenderOpen] = useState(false)
  const [extrudeThrough, setExtrudeThrough] = useState(false)
  const [show3d, setShow3d] = useState(false)
  const [transformMode, setTransformMode] = useState<TransformMode>('select')
  const preview3d = useRef<ViewportApi | null>(null)
  const [revPreview, setRevPreview] = useState<RevolveRequest | null>(null)
  const lastSketchView = useRef<{ center: P; pxPerMm: number } | null>(null)
  const regenTimer = useRef<number | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const sketchRef = useRef<SketchSession | null>(null)
  const [sketchPanelHost, setSketchPanelHost] = useState<HTMLDivElement | null>(null)
  const [sketchToolsHost, setSketchToolsHost] = useState<HTMLDivElement | null>(null)
  const viewport = useRef<ViewportApi | null>(null)
  const objectsRef = useRef(objects)
  objectsRef.current = objects
  const runStartIds = useRef<Set<string>>(new Set())
  const fileInput = useRef<HTMLInputElement>(null)

  // ── History (single pure state: safe under StrictMode double-invoked updaters) ──
  const apply = useCallback((next: SceneObject[], record = true) => {
    setHist(h => record
      ? { past: [...h.past.slice(-99), h.present], present: next, future: [] }
      : { ...h, present: next })
  }, [])
  const undo = useCallback(() => {
    setHist(h => h.past.length
      ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
      : h)
  }, [])
  const redo = useCallback(() => {
    setHist(h => h.future.length
      ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
      : h)
  }, [])
  const resetScene = useCallback((present: SceneObject[]) => {
    setHist({ past: [], present: materializeFeatures(present), future: [] })
    setSelection([])
    setTimeout(() => viewport.current?.setView('home'), 0)
  }, [])
  const snapshot = useCallback(() => viewport.current?.snapshot() ?? null, [])
  // Deep link (e.g. from the Files drive): ?model=<id> opens that project instead of the last one.
  const [searchParams, setSearchParams] = useSearchParams()
  const [initialId] = useState(() => searchParams.get('model'))
  useEffect(() => {
    if (!searchParams.has('model')) return
    const next = new URLSearchParams(searchParams)
    next.delete('model')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])
  const project = useSolidProject({ objects, resetScene, snapshot, student, initialId })
  // Landing = library of saved projects; a deep link (?model=) goes straight to the editor.
  useEffect(() => { if (initialId) setInLibrary(false) }, [initialId])
  const inLibraryRef = useRef(true)
  inLibraryRef.current = inLibrary
  const openFromLibrary = async (id: string) => {
    await project.openProject(id)
    setInLibrary(false)
  }
  const newFromLibrary = async () => {
    await project.newProject()
    setInLibrary(false)
  }
  const goLibrary = async () => {
    setSketch(null)
    setPickingPlane(false)
    await project.save()
    setInLibrary(true)
  }
  const modelPresence = useResourcePresence('model3d', project.projectId, student ? 'student' : 'teacher')

  // Drop selection ids that no longer exist (undo, AI edits).
  useEffect(() => {
    setSelection(sel => {
      const next = sel.filter(id => objects.some(o => o.id === id))
      return next.length === sel.length ? sel : next
    })
  }, [objects])

  const openShare = async () => {
    const id = await project.ensureSaved()
    if (id) setShareId(id)
  }

  // Teachers and students get a public QR code for any phone (the project is saved first).
  const openAr = async () => {
    const id = await project.ensureSaved()
    if (id) setArOpen({ id })
  }

  const selected = useMemo(() => objects.filter(o => selection.includes(o.id)), [objects, selection])
  const single = selected.length === 1 ? selected[0] : null

  const activeEdge = edgeMode && selectedEdge && single ? editableEdges(single).find(e => e.id === selectedEdge) : undefined
  useEffect(() => { setSelectedEdge(null) }, [selection.join(',')])
  const commitEdgeLength = (id: string, value: number) => {
    if (!single) return
    const edge = editableEdges(single).find(e => e.id === id)
    if (edge) updateSelected(o => resizeEdge(o, edge, value))
  }

  // ── Operations ──
  const addPrimitive = useCallback((def: PrimitiveDef, at: [number, number] = [0, 0]) => {
    const obj = createPrimitive(def, at, objectsRef.current)
    apply([...objectsRef.current, obj])
    setSelection([obj.id])
    setPanel('shape')
  }, [apply])

  const updateSelected = (fn: (o: SceneObject) => SceneObject) =>
    apply(objects.map(o => (selection.includes(o.id) ? fn(o) : o)))

  const doDelete = () => { if (selection.length) { apply(objects.filter(o => !selection.includes(o.id))); setSelection([]) } }
  const doDuplicate = () => {
    if (!selection.length) return
    const r = duplicateObjects(objects, selection)
    apply(r.objects); setSelection(r.newIds)
  }
  const doGroup = () => {
    const r = groupObjects(objects, selection)
    if (r.groupId) { apply(r.objects); setSelection([r.groupId]) }
  }
  const doUngroup = () => {
    if (!single || single.kind !== 'group') return
    const r = ungroupObject(objects, single.id)
    apply(r.objects); setSelection(r.newIds)
  }
  const doDrop = () => selection.length && apply(dropToPlate(objects, selection))
  const doAlign = (axis: 0 | 1 | 2, mode: AlignMode) => apply(alignObjects(objects, selection, axis, mode))
  const doMirror = (axis: 0 | 1 | 2) => selection.length && apply(mirrorObjects(objects, selection, axis))
  const nudge = (d: Vec3) => updateSelected(o => ({ ...o, position: o.position.map((v, i) => Math.round((v + d[i]) * 100) / 100) as Vec3 }))

  const exportJson = () => download(new Blob([JSON.stringify({ format: 'golinelli-solid-modeler', version: 1, name: project.name, objects }, null, 2)], { type: 'application/json' }), `${slug(project.name)}.json`)
  const importJson = async (file: File) => {
    try {
      const data = JSON.parse(await file.text())
      const list = Array.isArray(data) ? data : data.objects
      if (!Array.isArray(list)) throw new Error('formato')
      apply([...objects, ...list]); setSelection(list.map((o: SceneObject) => o.id))
    } catch {
      window.alert('File non valido: serve un JSON esportato dal modellatore.')
    }
  }
  const doExportSTL = () => {
    const targets = selected.length ? selected : objects
    if (!targets.some(o => !o.hole && o.kind !== 'sketch')) return
    download(exportSTL(targets), `${slug(project.name)}.stl`)
  }

  // ── Sketch ──
  const sketchRefs = (list: SceneObject[], plane: SketchPlane, sketchId?: string): [P, P][] =>
    [...planeReferences(list, plane), ...coplanarSketchRefs(list, plane, sketchId)]
  /** Reopen an existing sketch: its strokes come back fully editable. */
  const openSketchObject = useCallback((obj: PrimitiveObject, startRevolve = false) => {
    const plane = planeOfSketch(obj)
    setPickingPlane(false)
    setEdgeMode(false)
    setSketch({ plane, refs: sketchRefs(objectsRef.current, plane, obj.id), boundary: planeReferences(objectsRef.current, plane), resume: obj.params.sketch?.entities ?? [], sketchId: obj.id, startRevolve })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const startSketch = useCallback((plane: SketchPlane) => {
    // One sketch per plane: drawing again on a plane that already has a sketch reopens it instead of stacking a new, empty one.
    const existing = findSketchOnPlane(objectsRef.current, plane)
    if (existing) {
      openSketchObject(existing)
      setNotice(tl("Su questo piano c'è già «{0}»: l'ho riaperto, puoi continuare a modificarlo.", existing.name))
      return
    }
    setPickingPlane(false)
    setSelection([])
    setEdgeMode(false)
    setSketch({ plane, refs: sketchRefs(objectsRef.current, plane), boundary: planeReferences(objectsRef.current, plane) })
  }, [openSketchObject]) // eslint-disable-line react-hooks/exhaustive-deps
  const onPickPlane = useCallback((pick: PlanePick) => {
    const obj = pick.objectId ? objectsRef.current.find(o => o.id === pick.objectId) : null
    startSketch(obj ? faceFrame(obj, pick.normal, pick.triangles) : STANDARD_PLANES.top)
  }, [startSketch])
  /** «Sketch 2D»: edit the selected sketch, otherwise choose a plane. */
  const sketchButton = () => {
    if (single?.kind === 'sketch') { openSketchObject(single); return }
    setSketch(null)
    setPickingPlane(p => !p)
  }
  const onSketchView = useCallback((center: P, pxPerMm: number) => {
    lastSketchView.current = { center, pxPerMm }
    if (sketch) viewport.current?.setSketchCamera({ plane: sketch.plane, center, pxPerMm })
  }, [sketch])
  useEffect(() => {
    if (!sketch) { viewport.current?.setSketchCamera(null); setRevPreview(null); setShow3d(false) }
  }, [sketch])
  useEffect(() => {
    if (!show3d) return
    const t = window.setTimeout(() => preview3d.current?.setView('home'), 60)
    return () => window.clearTimeout(t)
  }, [show3d])
  sketchRef.current = sketch
  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 7000)
    return () => clearTimeout(t)
  }, [notice])

  /** The sketch lives in the scene from the first stroke: every change is saved, whatever plane it is on. */
  const autosaveSketch = useCallback((entities: SketchEntity[]) => {
    const sk = sketchRef.current
    if (!sk) return
    const r = upsertSketch(objectsRef.current, sk.plane, entities, sk.sketchId, sk.boundary)
    if (r.objects !== objectsRef.current) apply(r.objects, (!sk.sketchId && !!r.id) || (!!sk.sketchId && !r.id))
    if (r.id !== (sk.sketchId ?? null)) setSketch(s => (s ? { ...s, sketchId: r.id ?? undefined } : s))
    // Models made from this sketch follow it while it is being edited (shortly after the last stroke).
    if (r.id) {
      const id = r.id
      if (regenTimer.current) window.clearTimeout(regenTimer.current)
      regenTimer.current = window.setTimeout(() => {
        const g = regenerateFeatures(objectsRef.current, id)
        if (g.updated) apply(g.objects, false)
      }, 350)
    }
  }, [apply])

  /** Leave sketch mode: the sketch stays faintly in the scene and the models made from it follow its new shape. */
  const finishSketch = (entities: SketchEntity[]) => {
    if (!sketch) return
    const r = upsertSketch(objectsRef.current, sketch.plane, entities, sketch.sketchId, sketch.boundary)
    let next = r.objects
    if (r.id) {
      const g = regenerateFeatures(next, r.id)
      next = g.objects
      if (g.updated) setNotice(g.updated === 1 ? tl("Aggiornata 1 parte collegata allo sketch.") : tl("Aggiornate {0} parti collegate allo sketch.", g.updated))
      if (g.lost.length) setNotice(tl("Non aggiornate (il profilo non esiste più): {0}", g.lost.join(', ')))
    }
    if (next !== objectsRef.current) apply(next)
    setSelection(r.id ? [r.id] : [])
    setRegionPick(null)
    setSketch(null)
    setPanel('shape')
  }
  /** «Modifica sketch» on an extrusion / revolve: opens the sketch it was made from (older extrusions get one made from their stored outline). */
  const editFeatureSketch = (obj: PrimitiveObject, group?: GroupObject) => {
    const src = obj.params.source
    const linked = src ? objects.find(o => o.id === src.sketchId && o.kind === 'sketch') as PrimitiveObject | undefined : undefined
    if (linked) { openSketchObject(linked); return }
    const t = sketchFromExtrusion(obj, group)
    if (!t) return
    const made = upsertSketch(objects, t.plane, t.entities)
    if (!made.id) return
    const linkedObjects = withSource(made.objects, obj.id, { sketchId: made.id, points: t.regionPoints, op: 'extrude', lo: t.lo, hi: t.hi })
    apply(linkedObjects)
    setPickingPlane(false)
    setEdgeMode(false)
    setSketch({ plane: t.plane, refs: planeReferences(linkedObjects, t.plane), boundary: planeReferences(linkedObjects, t.plane), resume: t.entities, sketchId: made.id })
  }
  const regionIndex = single && regionPick?.id === single.id ? regionPick.index : null
  /** One extrusion per selected sketch (all their closed profiles), same distance for all. */
  const extrudeMany = (t: number) => {
    let list = objects
    const made: string[] = []
    for (const o of selected) {
      if (o.kind !== 'sketch') continue
      const res = applySketchExtrusion(list, o.id, null, t, { symmetric: extrudeSym })
      if (res) { list = res.objects; made.push(...res.selectIds) }
    }
    if (!made.length) return
    apply(list)
    setSelection(made)
  }
  const revolveMessage = (error: string) => (error === 'crosses'
    ? tl("La forma attraversa l'asse: l'asse deve stare su un lato (o sul bordo) della forma.")
    : error === 'nothing' ? tl("Seleziona almeno un segmento o una curva da ruotare.") : tl("Impossibile creare il solido di rotazione."))
  const throughDepthOf = (sk: PrimitiveObject): number | null => {
    const target = topLevelOf(objects, sk.params.sketch?.target)
    return target ? depthThrough(target, planeOfSketch(sk)) : null
  }
  const runExtrude = (t: number) => {
    if (single?.kind !== 'sketch') return
    const res = applySketchExtrusion(objects, single.id, regionIndex, t, { symmetric: extrudeSym })
    if (!res) return
    apply(res.objects)
    setSelection(res.selectIds)
  }
  /** Revolve picked in the sketch editor: the solid is made and shown in 3D while the sketch stays open (hybrid mode). */
  const revolveFromEditor = (req: RevolveRequest): string | null => {
    const sk = sketchRef.current
    if (!sk) return null
    const up = upsertSketch(objectsRef.current, sk.plane, req.entities, sk.sketchId, sk.boundary)
    if (!up.id) return tl("Lo sketch è vuoto.")
    const res = applySketchRevolve(up.objects, up.id, req.ids, req.axis, req.angle, req.mode)
    if (!res) return tl("Impossibile creare il solido di rotazione.")
    if (res.error) return revolveMessage(res.error)
    apply(res.objects)
    setRevPreview(null)
    setShow3d(true)
    setNotice(tl("Solido di rotazione creato e collegato allo sketch: lo vedi nell'anteprima 3D."))
    return null
  }
  /** Live 3D preview of the revolve being set up (hybrid mode). Returns an error text when it cannot be built. */
  const previewRevolve = useCallback((req: RevolveRequest | null): string | null => {
    setRevPreview(req)
    if (!req) return null
    const sk = sketchRef.current
    if (!sk) return null
    const probe = upsertSketch(objectsRef.current, sk.plane, req.entities, sk.sketchId, sk.boundary)
    const obj = probe.id ? probe.objects.find(o => o.id === probe.id) as PrimitiveObject | undefined : undefined
    if (!obj) return null
    const made = revolveFromSelection(obj, req.ids, req.axis, req.angle, req.mode === 'cut', '#7c3aed', tl("Anteprima"))
    return typeof made === 'string' ? revolveMessage(made) : null
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const previewObject = useMemo<PrimitiveObject | null>(() => {
    if (!revPreview || !sketch) return null
    const probe = upsertSketch(objects, sketch.plane, revPreview.entities, sketch.sketchId)
    const skObj = probe.id ? probe.objects.find(o => o.id === probe.id) as PrimitiveObject | undefined : undefined
    if (!skObj) return null
    const made = revolveFromSelection(skObj, revPreview.ids, revPreview.axis, revPreview.angle, revPreview.mode === 'cut', '#7c3aed', tl("Anteprima"))
    return typeof made === 'string' ? null : { ...made, id: 'revolve-preview', hole: false }
  }, [revPreview, sketch, objects])
  /** Live preview of the typed extrusion distance (while dragging the arrow the viewport previews it itself). */
  const extrudePreview = useMemo(() => {
    if (transformMode !== 'extrude' || sketch || single?.kind !== 'sketch') return null
    if (objects.some(o => o.id === 'extrude-preview')) return null
    const t = Number(extrudeDepth.replace(',', '.'))
    if (!Number.isFinite(t) || Math.abs(t) < 0.05) return null
    return applySketchExtrusion(objects, single.id, regionIndex, t, { symmetric: extrudeSym, preview: true, dragId: 'extrude-preview' })?.objects ?? null
  }, [transformMode, sketch, single, objects, extrudeDepth, extrudeSym, regionIndex])
  const viewportObjects = useMemo(() => extrudePreview ?? (previewObject ? [...objects, previewObject] : objects), [objects, previewObject, extrudePreview])
  /** Extrude mode: any planar face of a solid becomes a (linked) sketch region ready to be extruded. */
  const onPickFace = useCallback((pick: FacePick) => {
    const list = objectsRef.current
    const obj = list.find(o => o.id === pick.objectId)
    if (!obj) return
    const facePlane = faceFrame(obj, pick.normal, pick.triangles)
    // A plane that already holds a sketch keeps ITS 2D frame: every coplanar face is expressed in that frame.
    const existing = findSketchOnPlane(list, facePlane)
    const plane = existing ? planeOfSketch(existing) : facePlane
    const at = toPlane(plane, pick.point).p
    const indexAt = (sk: PrimitiveObject) => {
      const r = smallestRegionAt(sketchRegionsOf(sk).regions, at)
      return r ? sketchRegionsOf(sk).regions.indexOf(r) : -1
    }
    // Shift / Ctrl + click: add (or remove) a coplanar face to the faces already picked, to extrude them together.
    const cur = regionPick ? list.find(o => o.id === regionPick.id && o.kind === 'sketch') as PrimitiveObject | undefined : undefined
    if (pick.additive && cur) {
      if (!existing || existing.id !== cur.id) { setNotice(tl("Per estrudere più facce insieme devono essere complanari (sullo stesso piano).")); return }
      const prevIdx = regionPick!.index == null ? [] : Array.isArray(regionPick!.index) ? regionPick!.index : [regionPick!.index]
      const prevPts = prevIdx.map(i => sketchRegionsOf(cur).regions[i]).filter(Boolean).map(r => interiorPoint(r.outer) as P)
      let sk = cur
      let work = list
      if (indexAt(sk) < 0) {
        const refs2 = planeReferences(list, plane)
        const flat2: SketchEntity[] = refs2.slice(0, 600).map(([a, b], i) => ({ id: `f${i}`, type: 'line', a, b }))
        const hit2 = smallestRegionAt(analyzeSketch(flat2).regions.filter(r => regionContains(r, at)), at)
        if (!hit2) { setNotice(tl("Questa faccia non ha un contorno chiuso che si possa estrudere.")); return }
        const add: SketchEntity[] = [hit2.outer, ...hit2.holes].map(pts => ({ id: uid('e'), type: 'polyline', pts: pts.map(q => [q[0], q[1]] as P), closed: true }) as SketchEntity)
        const made2 = upsertSketch(list, plane, [...(cur.params.sketch?.entities ?? []), ...add], cur.id, refs2)
        if (!made2.id) return
        work = made2.objects
        apply(work)
        sk = work.find(o => o.id === made2.id) as PrimitiveObject
      }
      const regs = sketchRegionsOf(sk).regions
      const idxOf = (pt: P) => { const r = smallestRegionAt(regs.filter(q => regionContains(q, pt)), pt); return r ? regs.indexOf(r) : -1 }
      const next = new Set(prevPts.map(idxOf).filter(i => i >= 0))
      const here = indexAt(sk)
      if (here >= 0) { if (next.has(here) && next.size > 1) next.delete(here); else next.add(here) }
      const arr = [...next].sort((a, b) => a - b)
      setSelection([sk.id])
      setRegionPick({ id: sk.id, index: arr.length === 1 ? arr[0] : arr })
      return
    }
    if (existing) {
      const i = indexAt(existing)
      if (i >= 0) { setSelection([existing.id]); setRegionPick({ id: existing.id, index: i }); return }
    }
    const refs = planeReferences(list, plane)
    const flat: SketchEntity[] = refs.slice(0, 600).map(([a, b], i) => ({ id: `f${i}`, type: 'line', a, b }))
    const hit = smallestRegionAt(analyzeSketch(flat).regions.filter(r => regionContains(r, at)), at)
    if (!hit) { setNotice(tl("Questa faccia non ha un contorno chiuso che si possa estrudere.")); return }
    const loops = [hit.outer, ...hit.holes]
    const entities: SketchEntity[] = loops.map(pts => ({ id: uid('e'), type: 'polyline', pts: pts.map(q => [q[0], q[1]] as P), closed: true }) as SketchEntity)
    const made = upsertSketch(list, plane, entities, undefined, refs)
    if (!made.id) return
    const next = made.objects.map(o => (o.id === made.id ? { ...o, name: tl("Faccia di {0}", obj.name) } : o))
    apply(next)
    setSelection([made.id])
    const sk = next.find(o => o.id === made.id) as PrimitiveObject
    setRegionPick({ id: made.id, index: Math.max(0, indexAt(sk)) })
  }, [apply, regionPick]) // eslint-disable-line react-hooks/exhaustive-deps
  /** A solid made from a sketch that is moved / rotated / scaled in 3D is no longer tied to it (else the next sketch edit would put it back). */
  const onViewportChange = useCallback((next: SceneObject[], record?: boolean) => {
    const prev = objectsRef.current
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6)
    let changed = false
    const out = next.map(o => {
      if (o.kind === 'group' || (o.kind !== 'revolve' && o.kind !== 'extrusion')) return o
      const po = prev.find(x => x.id === o.id)
      if (!po || po.kind === 'group' || !(o as PrimitiveObject).params?.source) return o
      if (same(po.position, o.position) && same(po.rotation, o.rotation) && same(po.size, (o as PrimitiveObject).size)) return o
      changed = true
      const { source: _unlinked, ...params } = (o as PrimitiveObject).params
      return { ...o, params } as PrimitiveObject
    })
    apply(changed ? out : next, record)
  }, [apply])

  // ── Keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inLibraryRef.current) return
      if (pickingPlane && e.key === 'Escape') { setPickingPlane(false); return }
      if (sketch || pickingPlane) return
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable="true"]')) return
      const mod = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      const step = snap || 1
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if ((mod && k === 'y') || (mod && k === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
      else if (mod && k === 'g' && e.shiftKey) { e.preventDefault(); doUngroup() }
      else if (mod && k === 'g') { e.preventDefault(); doGroup() }
      else if (mod && k === 'd') { e.preventDefault(); doDuplicate() }
      else if (mod && k === 'a') { e.preventDefault(); setSelection(objects.map(o => o.id)) }
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); doDelete() }
      else if (k === 'escape') { if (transformMode !== 'select') setTransformMode('select'); else if (selection.length) setSelection([]); else if (fullWindow) setFullWindow(false) }
      else if (e.key === 'Tab' && single && single.kind !== 'sketch') { e.preventDefault(); viewport.current?.focusDimensions() }
      else if (k === 'm' && !mod) setTransformMode(m => (m === 'move' ? 'select' : 'move'))
      else if (k === 'r' && !mod) setTransformMode(m => (m === 'rotate' ? 'select' : 'rotate'))
      else if (k === 's' && !mod) setTransformMode(m => (m === 'scale' ? 'select' : 'scale'))
      else if (k === 'e' && !mod) setTransformMode(m => (m === 'extrude' ? 'select' : 'extrude'))
      else if (k === 'd' && !mod) doDrop()
      else if (k === 'h' && !mod && selection.length) updateSelected(o => ({ ...o, hole: !o.hole }))
      else if (k === 'f' && !mod) viewport.current?.setView('fit')
      else if (e.key.startsWith('Arrow') && selection.length) {
        e.preventDefault()
        const s = e.shiftKey ? step * 10 : step
        const map: Record<string, Vec3> = mod
          ? { ArrowUp: [0, 0, s], ArrowDown: [0, 0, -s], ArrowLeft: [0, 0, 0], ArrowRight: [0, 0, 0] }
          : { ArrowUp: [0, s, 0], ArrowDown: [0, -s, 0], ArrowLeft: [-s, 0, 0], ArrowRight: [s, 0, 0] }
        nudge(map[e.key])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const setView = (v: ViewName) => viewport.current?.setView(v)

  // ── Inspector values ──
  const singleExtent: Vec3 | null = useMemo(() => {
    if (!single) return null
    if (single.kind !== 'group') return single.size
    const lb = objectGeometry(single).boundingBox
    if (!lb) return null
    return [0, 1, 2].map(i => (lb.max.getComponent(i) - lb.min.getComponent(i)) * single.scale[i]) as Vec3
  }, [single])

  const setExtent = (axis: number, value: number) => {
    if (!single || !singleExtent) return
    const v = Math.max(0.1, value)
    updateSelected(o => {
      if (o.kind === 'group') {
        const scale = [...o.scale] as Vec3
        scale[axis] = o.scale[axis] * (v / singleExtent[axis])
        return { ...o, scale }
      }
      const size = [...o.size] as Vec3
      size[axis] = v
      // keep the bottom on the same level when changing height
      const position = [...o.position] as Vec3
      if (axis === 2 && o.rotation[0] === 0 && o.rotation[1] === 0) position[2] += (v - o.size[2]) / 2
      return { ...o, size, position }
    })
  }

  const baseZ = single ? Math.round(worldBox(single).min.z * 100) / 100 : 0

  const setParam = (key: keyof PrimitiveObject['params'], value: number | string) =>
    updateSelected(o => (o.kind === 'group' ? o : { ...o, params: { ...o.params, [key]: value } }))

  return (
    <>
    {inLibrary && (
      <SolidModelLibrary
        projects={project.projects}
        loading={project.projectsLoading}
        onOpen={id => void openFromLibrary(id)}
        onNew={() => void newFromLibrary()}
        onDelete={p => { if (window.confirm(tl("Eliminare \"{0}\"? Anche i link condivisi smetteranno di funzionare.", p.name))) void project.deleteProject(p.id) }}
        legacyCount={project.legacy.length}
        onImportLegacy={() => void project.importLegacy()}
        onDismissLegacy={project.dismissLegacy}
        leading={leading}
      />
    )}
    <div className={`flex min-h-0 flex-col bg-slate-50 ${fullWindow && !inLibrary ? 'fixed inset-0 z-[55] h-screen' : 'h-full'} ${inLibrary ? 'hidden' : ''}`}>
      {/* Toolbar */}
      <div className="flex flex-nowrap items-center gap-1 border-b border-slate-200 bg-white/90 px-3 py-1.5">
        {leading && <><div className="flex shrink-0 items-center gap-1">{leading}</div><Divider /></>}
        <div className="relative flex min-w-0 items-center gap-1">
          <ToolButton icon={FolderOpen} label={tl("Progetti")} onClick={() => void goLibrary()} />
          <SectionIllustration section="/teacher/3d-lab" compact />
          <input
            value={project.name}
            onChange={e => project.setName(e.target.value)}
            title={tl("Nome del progetto")}
            className="w-28 min-w-0 rounded-full border border-transparent bg-transparent px-2 py-1 text-sm font-semibold text-slate-900 hover:border-slate-200 focus:border-[color:var(--selection-border-hover)] focus:outline-none xl:w-44"
          />
          <SaveBadge status={project.status} />
        </div>
        <Divider />
        <ToolButton icon={Undo2} label={tl("Annulla")} shortcut="Ctrl+Z" onClick={undo} disabled={!hist.past.length} />
        <ToolButton icon={Redo2} label={tl("Ripeti")} shortcut="Ctrl+Y" onClick={redo} disabled={!hist.future.length} />
        <Divider />
        {!sketch && (
          <>
            <div className="flex shrink-0 items-center gap-0.5" role="group" aria-label={tl("Modalità di modifica")}>
              {MODE_BUTTONS.map(([id, Icon, label, key]) => (
                <IconButton key={id} type="button" title={`${label} (${key})`} aria-label={label} aria-pressed={transformMode === id} onClick={() => setTransformMode(m => (m === id && id !== 'select' ? 'select' : id))} tone="neutral" surface="ghost" size="sm" className={`shrink-0 rounded-full ${transformMode === id ? 'ds-selected' : ''}`}>
                  <Icon />
                </IconButton>
              ))}
            </div>
            <Divider />
          </>
        )}
        <ToolButton icon={Group} label={tl("Raggruppa")} shortcut="Ctrl+G" onClick={doGroup} disabled={selection.length < 2} />
        <ToolButton icon={Ungroup} label={tl("Separa")} shortcut="Ctrl+Shift+G" onClick={doUngroup} disabled={single?.kind !== 'group'} />
        <ToolButton icon={Copy} label={tl("Duplica")} shortcut="Ctrl+D" onClick={doDuplicate} disabled={!selection.length} />
        <ToolButton icon={ArrowDownToLine} label={tl("Appoggia")} shortcut="D" onClick={doDrop} disabled={!selection.length} />
        <ToolButton icon={FlipHorizontal2} label={tl("Specchia X")} onClick={() => doMirror(0)} disabled={!selection.length} />
        <ToolButton icon={FlipVertical2} label={tl("Specchia Y")} onClick={() => doMirror(1)} disabled={!selection.length} />
        <ToolButton icon={Trash2} label={tl("Elimina")} shortcut="Canc" onClick={doDelete} disabled={!selection.length} />
        <Divider />
        {!sketch && <ToolButton icon={Camera} label={tl("Render: immagine con materiali, luci e ombre morbide")} onClick={() => setRenderOpen(true)} disabled={!objects.some(o => o.kind !== 'sketch' && !o.hole && !o.hidden)} />}
        {selection.length > 1 && (
          <>
            <Divider />
            <ToolButton icon={AlignStartVertical} label={tl("Allinea sx")} onClick={() => doAlign(0, 'min')} />
            <ToolButton icon={AlignCenterVertical} label={tl("Centra X")} onClick={() => doAlign(0, 'center')} />
            <ToolButton icon={AlignEndVertical} label={tl("Allinea dx")} onClick={() => doAlign(0, 'max')} />
            <ToolButton icon={AlignStartHorizontal} label={tl("Allinea fronte")} onClick={() => doAlign(1, 'min')} />
            <ToolButton icon={AlignCenterHorizontal} label={tl("Centra Y")} onClick={() => doAlign(1, 'center')} />
            <ToolButton icon={AlignEndHorizontal} label={tl("Allinea retro")} onClick={() => doAlign(1, 'max')} />
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }} />
          <ToolButton icon={fullWindow ? Minimize : Maximize} label={fullWindow ? tl("Esci dalla finestra intera (Esc)") : tl("Editor a tutta finestra")} onClick={() => setFullWindow(f => !f)} />
          <ToolButton icon={FileUp} label={tl("Importa JSON")} onClick={() => fileInput.current?.click()} />
          <ToolButton icon={FileDown} label={tl("Esporta JSON")} onClick={exportJson} disabled={!objects.length} />
          <Button
            type="button"
            onClick={() => void openAr()}
            disabled={!objects.some(o => !o.hole && o.kind !== 'sketch')}
            title={tl("Guarda il modello nello spazio con il telefono (QR code)")}
            tone="accent"
            surface="solid"
            density="compact"
            className="ml-1 rounded-full"
          >
            <Smartphone /> {tl("Visualizza in AR")}
          </Button>
          <PresenceAvatars people={modelPresence.others} className="ml-1" />
          {!student && <Button
            type="button"
            onClick={() => void openShare()}
            title={tl("Condividi con la classe o con un link / QR code")}
            tone="accent"
            surface={project.current && (project.current.public_enabled || project.current.shared_class_ids.length) ? 'soft' : 'outline'}
            density="compact"
            className="ml-1 rounded-full"
          >
            <Share2 /> {tl("Condividi")}
          </Button>}
          <Button
            type="button"
            onClick={doExportSTL}
            disabled={!objects.some(o => !o.hole && o.kind !== 'sketch')}
            title={selected.length ? tl("Esporta STL della selezione") : tl("Esporta STL della scena")}
            tone="neutral"
            surface="solid"
            density="compact"
            className="rounded-full"
          >
            <Download /> STL
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Library + object list */}
        {/* Left column: 3D shapes library, or the sketch tools while sketching (alternative views). */}
        {sketch && (
          <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white/80">
            <div ref={setSketchToolsHost} className="flex min-h-0 flex-1 flex-col" />
          </aside>
        )}
        {!sketch && libraryCollapsed && (
          <SidebarRail
            label={tl("Forme e oggetti")}
            expandLabel={tl("Espandi forme e oggetti")}
            onExpand={() => setLibraryCollapsed(false)}
            items={[{ id: 'sketch2d', title: tl("Sketch 2D"), icon: <PencilLine className="h-4 w-4 text-slate-700" />, marker: '', onClick: sketchButton }, ...PRIMITIVES.map((def, i) => {
              const PrimitiveIcon = ICONS[def.kind]
              return {
                id: `${def.kind}-${i}`,
                title: tl("{0} — clic per aggiungere al centro", def.label),
                icon: <ShapeThumb def={def} className="h-5 w-5" fallback={<PrimitiveIcon className="h-4 w-4 text-slate-700" />} />,
                marker: '',
                onClick: () => addPrimitive(def),
              }
            })]}
          />
        )}
        <aside className={`flex w-40 shrink-0 flex-col border-r border-slate-200 bg-white/80 ${libraryCollapsed || sketch ? 'hidden' : ''}`}>
          <div className="flex items-center justify-between pl-3 pr-1.5 pt-1.5">
            <p className="pt-1.5 text-[10px] font-semibold text-slate-400">{tl("Forme base")}</p>
            <SidebarCollapseButton onClick={() => setLibraryCollapsed(true)} label={tl("Comprimi le forme")} />
          </div>
          <button
            type="button"
            onClick={sketchButton}
            className={`mx-2 mb-2 flex items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] font-semibold leading-tight transition ${pickingPlane ? 'ds-accent-selected' : 'ds-accent-soft hover:brightness-95'}`}
          >
            <PencilLine className="h-5 w-5 shrink-0" />
            <span>{tl("Sketch 2D")}</span>
          </button>
          <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-1.5 overflow-y-auto px-2 pb-3">
            {PRIMITIVES.map((def, i) => {
              const Icon = ICONS[def.kind]
              return (
                <button
                  key={`${def.kind}-${i}`}
                  type="button"
                  draggable
                  onDragStart={e => { e.dataTransfer.setData('application/x-solid-primitive', String(i)); e.dataTransfer.effectAllowed = 'copy' }}
                  onClick={() => addPrimitive(def)}
                  title={tl("{0} — clic per aggiungere al centro o trascina sul piano", def.label)}
                  className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border text-[10px] font-semibold leading-tight transition hover:-translate-y-0.5 hover:shadow ${
                    def.hole ? 'border-dashed border-slate-300 bg-slate-50 text-slate-500' : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  <ShapeThumb def={def} className="h-9 w-9" fallback={<Icon className="h-6 w-6 text-slate-700" strokeWidth={2} />} />
                  <span className="px-0.5 text-center">{def.label}</span>
                </button>
              )
            })}
          </div>
        </aside>

        {/* Viewport */}
        <main className="relative min-w-0 flex-1">
          <SolidModelerViewport
            edgeMode={edgeMode}
            selectedEdge={selectedEdge}
            onSelectEdge={id => { setSelectedEdge(id); setPanel('shape') }}
            onEdgeLength={commitEdgeLength}
            objects={objects}
            selection={selection}
            snap={snap}
            highlightIds={aiHighlight}
            onSelect={ids => { setSelection(ids); setAiHighlight([]) }}
            onChange={onViewportChange}
            onPickFace={onPickFace}
            onExtrudeDepth={t => setExtrudeDepth(String(Math.round(t * 100) / 100))}
            onDropPrimitive={addPrimitive}
            onHover={info => setHover(h => (h === info ? h : info))}
            apiRef={viewport}
            pickPlane={pickingPlane}
            onPickPlane={onPickPlane}
            hiddenIds={sketch?.sketchId ? [sketch.sketchId] : undefined}
            onOpenSketch={id => { const o = objectsRef.current.find(x => x.id === id && x.kind === 'sketch'); if (o) openSketchObject(o as PrimitiveObject) }}
            sketchRegion={regionIndex}
            onSketchRegion={(id, index) => setRegionPick({ id, index })}
            transformMode={transformMode}
            dimensions={single && single.kind !== 'sketch' ? singleExtent : null}
            onDimension={(axis, value) => setExtent(axis, value)}
          />
          {sketch && (
            <SketchEditor
              key={`${sketch.plane.origin.join(',')}|${sketch.plane.n.join(',')}|${sketch.plane.x.join(',')}`}
              planeLabel={sketch.plane.label}
              refs={sketch.refs}
              boundary={sketch.boundary}
              resume={sketch.resume}
              panelHost={sketchPanelHost}
              onView={onSketchView}
              onChange={autosaveSketch}
              onFinish={finishSketch}
              onRevolve={revolveFromEditor}
              onPreview={previewRevolve}
              show3d={show3d}
              onShow3d={setShow3d}
              toolsHost={sketchToolsHost}
              startRevolve={sketch.startRevolve}
            />
          )}
          {sketch && show3d && (
            <div className="absolute bottom-14 right-3 z-20 h-64 w-96 max-w-[calc(100%-24px)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
              <SolidModelerViewport objects={viewportObjects} readOnly showSketches highlightIds={previewObject ? ['revolve-preview'] : []} apiRef={preview3d} />
              <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-600 shadow-sm">{tl("Anteprima 3D · trascina per ruotare")}</div>
              <button type="button" onClick={() => setShow3d(false)} title={tl("Chiudi anteprima 3D")} className="absolute right-2 top-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-semibold text-slate-500 shadow-sm hover:text-slate-800">✕</button>
            </div>
          )}
          {notice && (
            <div className="absolute bottom-14 left-1/2 z-20 max-w-[calc(100%-24px)] -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 shadow-lg">{notice}</div>
          )}
          {pickingPlane && (
            <div className="absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-24px)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-2xl border border-blue-200 bg-white/95 px-3 py-2 text-[11px] text-slate-600 shadow-lg backdrop-blur-sm">
              <span className="font-semibold text-slate-800">{tl("Scegli il piano dello sketch:")}</span>
              <span>{tl("clicca sul piano di lavoro o sulla faccia di un oggetto, oppure")}</span>
              {(['top', 'front', 'right'] as const).map(k => (
                <Button key={k} type="button" tone="neutral" surface="soft" density="compact" className="rounded-full" onClick={() => startSketch(STANDARD_PLANES[k])}>
                  {k === 'top' ? tl("XY (pianta)") : k === 'front' ? tl("XZ (fronte)") : tl("YZ (lato)")}
                </Button>
              ))}
              <Button type="button" tone="neutral" surface="ghost" density="compact" className="rounded-full" onClick={() => setPickingPlane(false)}>{tl("Annulla (Esc)")}</Button>
            </div>
          )}
          {!sketch && <>
          <label className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/90 py-1 pl-3 pr-1 text-[11px] font-semibold text-slate-500 shadow-sm backdrop-blur-sm">
            <Grid3x3 className="h-3.5 w-3.5" /> {tl("Griglia")}
            <select value={snap} onChange={e => setSnap(Number(e.target.value))} className="rounded-full border-0 bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 focus:outline-none">
              {[0, 0.5, 1, 2, 5, 10].map(v => <option key={v} value={v}>{v === 0 ? 'libera' : `${v} mm`}</option>)}
            </select>
          </label>
          <SceneOutliner objects={objects} selection={selection} onSelect={setSelection} onToggleHidden={(ids, hidden) => apply(objects.map(o => (ids.includes(o.id) ? { ...o, hidden: hidden || undefined } : o)))} />
          <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-full border border-slate-200 bg-white/90 p-1 shadow-sm backdrop-blur-sm">
            {([['home', Home, tl("Vista iniziale")], ['top', Eye, tl("Dall'alto")], ['front', Box, tl("Fronte")], ['right', Cylinder, tl("Lato")], ['fit', Maximize, tl("Inquadra (F)")]] as const).map(([v, Icon, label]) => (
              <IconButton key={v} type="button" title={label} aria-label={label} onClick={() => setView(v)} tone="neutral" surface="ghost" size="sm" className="rounded-full">
                <Icon />
              </IconButton>
            ))}
          </div>
          {transformMode === 'extrude' && (
            <div className="absolute bottom-14 left-1/2 z-10 flex -translate-x-1/2 items-center gap-2 rounded-2xl border border-slate-200 bg-white/95 px-3 py-2 text-[11px] shadow-md backdrop-blur-sm">
              {single?.kind === 'sketch' && sketchRegionsOf(single).regions.length > 0 ? (
                <>
                  <span className="font-semibold text-slate-700">{tl("Estrudi")}</span>
                  <input
                    value={extrudeDepth}
                    onChange={e => setExtrudeDepth(e.target.value)}
                    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') runExtrude(extrudeSym ? Math.abs(Number(extrudeDepth.replace(',', '.')) || 10) : Number(extrudeDepth.replace(',', '.')) || 10) }}
                    inputMode="decimal"
                    aria-label={tl("Quota di estrusione (negativa = verso il basso)")}
                    className="ds-field w-20 px-2 py-1 text-right text-[12px] font-semibold"
                  />
                  <span className="text-slate-500">mm</span>
                  <label className="flex items-center gap-1 font-semibold text-slate-600">
                    <input type="checkbox" checked={extrudeSym} onChange={e => setExtrudeSym(e.target.checked)} /> {tl("Simmetrico")}
                  </label>
                  <Button type="button" tone="accent" surface="solid" density="compact" className="rounded-full" onClick={() => runExtrude(Number(extrudeDepth.replace(',', '.')) || 10)}>{tl("Estrudi")}</Button>
                  <span className="max-w-[170px] leading-3 text-slate-400">{tl("Valori negativi: verso il basso")}</span>
                </>
              ) : (
                <span className="font-semibold text-slate-600">{tl("Clicca una faccia di un solido, di uno sketch o una linea chiusa da estrudere (Maiusc + clic: aggiungi facce complanari)")}</span>
              )}
            </div>
          )}
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-140px)] rounded-lg bg-white/85 px-2.5 py-1.5 text-[10.5px] leading-4 text-slate-500 shadow-sm">
            {hover ? <span className="font-semibold text-slate-800">{hover}</span> : (
              <>{tl("Sinistro: ruota vista / trascina oggetto · Destro: sposta vista · Rotella: zoom · M muovi · R ruota · S scala · Tab = quote · Shift + trascina = selezione multipla")}</>
            )}
          </div>
          </>}
        </main>

        {/* Right panel */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white/85">
          {sketch && <div ref={setSketchPanelHost} className="flex min-h-0 flex-1 flex-col" />}
          <div className={`flex gap-1 border-b border-slate-200 p-1.5 ${sketch ? 'hidden' : ''}`}>
            {([['shape', tl("Forma"), Box], ['ai', tl("Assistente AI"), Sparkles]] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" onClick={() => setPanel(id)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold ${panel === id ? (id === 'ai' ? 'bg-violet-600 text-white' : 'bg-slate-900 text-white') : 'text-slate-600 hover:bg-slate-100'}`}>
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>

          <div className={`min-h-0 flex-1 ${panel === 'ai' && !sketch ? 'flex flex-col' : 'hidden'}`}>
            <SolidModelerAIPanel
              student={student}
              projectId={project.projectId}
              ensureProjectId={project.ensureSaved}
              objects={objects}
              selection={selection}
              onRunStart={() => {
                runStartIds.current = new Set(objectsRef.current.map(o => o.id))
                apply(objectsRef.current, true)
              }}
              onScene={scene => {
                setAiHighlight(scene.filter(o => !runStartIds.current.has(o.id)).map(o => o.id))
                apply(materializeFeatures(scene), false)
              }}
            />
          </div>

          {panel === 'shape' && !sketch && (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!selected.length && (
                <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs leading-5 text-slate-500">
                  {tl("Seleziona un oggetto per modificarne dimensioni, posizione, colore e tipo (solido o foro). Shift+clic per selezionare più oggetti e raggrupparli.")}
                </p>
              )}
              {selected.some(o => o.kind !== 'sketch') && (() => {
                const solids = selected.filter(o => o.kind !== 'sketch')
                const ids = new Set(solids.map(o => o.material ?? 'plastic'))
                const current = ids.size === 1 ? [...ids][0] : null
                return (
                  <div className="mb-3 space-y-1.5">
                    <p className="text-[11px] font-semibold text-slate-700">{tl("Materiale")}</p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {MATERIALS.map(m => (
                        <button
                          key={m.id}
                          type="button"
                          title={m.label}
                          aria-pressed={current === m.id}
                          onClick={() => updateSelected(o => (o.kind === 'sketch' ? o : { ...o, material: m.id === 'plastic' ? undefined : m.id }))}
                          className={`flex flex-col items-center gap-1 rounded-xl p-1 text-[9.5px] font-semibold leading-tight text-slate-600 hover:bg-slate-100 ${current === m.id ? 'ds-selected' : ''}`}
                        >
                          <span className="h-8 w-8 rounded-full shadow-inner ring-1 ring-black/10" style={{ background: m.swatch }} />
                          <span className="max-w-full truncate">{m.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })()}
              {selected.length > 1 && (
                <div className="space-y-2 text-xs text-slate-600">
                  <p className="font-semibold text-slate-900">{selected.length} {tl("oggetti selezionati")}</p>
                  <p>{tl("Raggruppa per unire i solidi e sottrarre i fori (Ctrl+G).")}</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => updateSelected(o => ({ ...o, hole: false }))} className="flex-1 rounded-lg border border-slate-200 py-1.5 font-semibold hover:bg-slate-50">{tl("Tutti solidi")}</button>
                    <button type="button" onClick={() => updateSelected(o => ({ ...o, hole: true }))} className="flex-1 rounded-lg border border-dashed border-slate-300 py-1.5 font-semibold hover:bg-slate-50">{tl("Tutti fori")}</button>
                  </div>
                  <button type="button" onClick={doGroup} className="w-full rounded-lg bg-slate-900 py-2 font-semibold text-white hover:bg-slate-800">{tl("Raggruppa")}</button>
                  {selected.some(o => o.kind === 'sketch') && (
                    <div className="space-y-2 rounded-lg bg-slate-50 p-2">
                      <p className="text-[11px] font-semibold text-slate-700">{tl("Estrudi gli sketch selezionati ({0})", selected.filter(o => o.kind === 'sketch').length)}</p>
                      <NumField label={tl("Distanza (negativa = verso l'interno / foro)")} value={Number(extrudeDepth.replace(',', '.')) || 10} suffix="mm" step={1} onCommit={v => setExtrudeDepth(String(v))} />
                      <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                        <input type="checkbox" checked={extrudeSym} onChange={e => setExtrudeSym(e.target.checked)} /> {tl("Simmetrico")}
                      </label>
                      <Button type="button" tone="accent" surface="solid" density="compact" className="w-full rounded-full" onClick={() => extrudeMany(Number(extrudeDepth.replace(',', '.')) || 10)}>{tl("Estrudi tutti")}</Button>
                    </div>
                  )}
                </div>
              )}
              {single?.kind === 'sketch' && (() => {
                const info = sketchRegionsOf(single)
                const plane = planeOfSketch(single)
                return (
                  <div className="space-y-3">
                    <input
                      value={single.name}
                      onChange={e => apply(objects.map(o => (o.id === single.id ? { ...o, name: e.target.value } : o)), false)}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-semibold text-slate-900 focus:border-blue-400 focus:outline-none"
                    />
                    <p className="text-[11px] leading-4 text-slate-500">
                      {plane.label} · {info.regions.length === 1 ? tl("1 profilo chiuso") : tl("{0} profili chiusi", info.regions.length)}
                    </p>
                    <Button type="button" tone="neutral" surface="soft" density="compact" className="w-full rounded-full" onClick={() => openSketchObject(single)}>
                      <PencilLine /> {tl("Modifica sketch")}
                    </Button>
                    {info.regions.length > 0 ? (
                      <>
                        <div className="space-y-1.5 rounded-lg bg-slate-50 p-2">
                          <p className="text-[11px] font-semibold text-slate-700">{tl("Estrudi")}</p>
                          <p className="text-[11px] leading-4 text-slate-500">
                            {tl("Attiva «Estrudi» (E) nella barra 3D: la freccia sul profilo (o la quota scritta) crea un modello unito all'oggetto della faccia; con valori negativi ottieni una foratura. Clicca su un profilo per usare solo quello.")}
                          </p>
                          <p className="text-[11px] font-semibold text-blue-700">{regionIndex == null ? tl("Profili: tutti") : Array.isArray(regionIndex) ? tl("Profili: {0} facce complanari", regionIndex.length) : tl("Profilo {0}", regionIndex + 1)}</p>
                          <NumField label={tl("Distanza (negativa = verso l'interno / foro)")} value={Number(extrudeDepth.replace(',', '.')) || 10} suffix="mm" step={1} onCommit={v => setExtrudeDepth(String(v))} />
                          <div className="flex flex-wrap gap-x-3 gap-y-1">
                            <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                              <input type="checkbox" checked={extrudeSym} onChange={e => setExtrudeSym(e.target.checked)} /> {tl("Simmetrico")}
                            </label>
                            {throughDepthOf(single) != null && (
                              <label className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600">
                                <input type="checkbox" checked={extrudeThrough} onChange={e => setExtrudeThrough(e.target.checked)} /> {tl("Foro passante")}
                              </label>
                            )}
                          </div>
                          <Button type="button" tone="accent" surface="solid" density="compact" className="w-full rounded-full" onClick={() => runExtrude(extrudeThrough && throughDepthOf(single) != null ? -(throughDepthOf(single) ?? 0) : Number(extrudeDepth.replace(',', '.')) || 10)}>{tl("Estrudi")}</Button>
                        </div>
                        <div className="space-y-1.5 rounded-lg bg-slate-50 p-2">
                          <p className="text-[11px] font-semibold text-slate-700">{tl("Solido di rotazione")}</p>
                          <p className="text-[11px] leading-4 text-slate-500">{tl("Scegli i segmenti e le curve da ruotare, poi l'asse, direttamente nello sketch (con anteprima 3D).")}</p>
                          <Button type="button" tone="accent" surface="solid" density="compact" className="w-full rounded-full" onClick={() => openSketchObject(single, true)}>{tl("Rivoluziona…")}</Button>
                        </div>
                      </>
                    ) : (
                      <p className="rounded-lg border border-dashed border-orange-300 p-2 text-[11px] leading-4 text-orange-700">{tl("Nessun profilo chiuso: apri «Modifica sketch» e chiudi la forma per poterla estrudere o rivoluzionare.")}</p>
                    )}
                    <p className="text-[10px] leading-4 text-slate-400">{tl("Estrusioni e solidi di rotazione restano collegati allo sketch: modificandolo si aggiornano. Lo sketch non viene esportato (STL/AR). Elimina con Canc.")}</p>
                  </div>
                )
              })()}
              {single && singleExtent && single.kind !== 'sketch' && (
                <div className="space-y-4">
                  <div>
                    <input
                      value={single.name}
                      onChange={e => apply(objects.map(o => (o.id === single.id ? { ...o, name: e.target.value } : o)), false)}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-semibold text-slate-900 focus:border-blue-400 focus:outline-none"
                    />
                    <p className="mt-1 text-[10px] font-semibold text-slate-400">
                      {KIND_LABEL[single.kind]}{single.kind === 'group' ? ` · ${single.children.length} parti` : ''}
                    </p>
                  </div>

                  {sketchEditables(single).map(({ obj, group }) => (
                    <Button key={obj.id} type="button" tone="accent" surface="soft" density="compact" className="w-full rounded-full" onClick={() => editFeatureSketch(obj, group)}>
                      <PencilLine /> {group ? tl("Modifica sketch: {0}", obj.name) : tl("Modifica sketch")}
                    </Button>
                  ))}

                  <div className="space-y-2 rounded-lg bg-slate-50 p-2">
                    <button type="button" aria-pressed={edgeMode} onClick={() => setEdgeMode(v => !v)} className={`w-full rounded-lg px-2 py-2 text-xs font-semibold ${edgeMode ? 'bg-blue-600 text-white' : 'border bg-white text-slate-700'}`}>{edgeMode ? tl("Spigoli attivi") : tl("Seleziona spigoli")}</button>
                    {edgeMode && <p className="text-[11px] text-slate-500">{tl("Clicca uno spigolo e modifica la quota sulla forma. Gli spigoli paralleli agli assi modificano la relativa dimensione; quelli obliqui scalano il solido in proporzione.")}</p>}
                    {edgeMode && activeEdge && <>
                      <NumField label={tl("Lunghezza spigolo")} value={edgeLength(single, activeEdge)} min={0.1} suffix="mm" onCommit={v => commitEdgeLength(activeEdge.id, v)} />
                      {single.kind !== 'group' && supportsEdgeFillet(single.kind) && !(single.params.radius) && <NumField label={tl("Fillet dello spigolo (raggio)")} value={single.params.edgeFillets?.[activeEdge.id] ?? 0} min={0} step={0.1} suffix="mm" onCommit={v => updateSelected(o => o.kind === 'group' ? o : ({ ...o, params: { ...o.params, edgeFillets: { ...o.params.edgeFillets, [activeEdge.id]: Math.min(v, Math.min(...o.size) * 0.2, edgeLength(o, activeEdge) * 0.2) } } }))} />}
                      {single.kind !== 'group' && supportsEdgeFillet(single.kind) && !single.params.radius && <p className="text-[10px] text-slate-500">{tl("Raggio massimo:")} {Math.min(Math.min(...single.size) * 0.2, edgeLength(single, activeEdge) * 0.2).toFixed(2)} {tl("mm. Imposta 0 per rimuoverlo.")}</p>}
                      {(single.kind === 'group' || !supportsEdgeFillet(single.kind) || !!single.params.radius) && <p className="text-[11px] text-slate-500">{tl("Fillet singolo disponibile sui solidi convessi senza raccordo globale. Separa i gruppi per lavorare sulle singole parti.")}</p>}
                    </>}
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button type="button" onClick={() => updateSelected(o => ({ ...o, hole: false }))} className={`rounded-lg py-2 text-xs font-semibold ${!single.hole ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{tl("Solido")}</button>
                    <button type="button" onClick={() => updateSelected(o => ({ ...o, hole: true }))} className={`rounded-lg py-2 text-xs font-semibold ${single.hole ? 'bg-slate-500 text-white' : 'border border-dashed border-slate-300 text-slate-600 hover:bg-slate-50'}`}>{tl("Foro")}</button>
                  </div>

                  {!single.hole && (
                    <div>
                      <p className="mb-1 text-[10px] font-semibold text-slate-400">{tl("Colore")}</p>
                      <div className="flex flex-wrap gap-1.5">
                        {COLOR_SWATCHES.map(c => (
                          <button key={c} type="button" title={c} onClick={() => updateSelected(o => ({ ...o, color: c }))} className={`h-6 w-6 rounded-full border ${single.color === c ? 'ring-2 ring-blue-500 ring-offset-1' : 'border-slate-300'}`} style={{ background: c }} />
                        ))}
                        <input type="color" value={single.color} onChange={e => updateSelected(o => ({ ...o, color: e.target.value }))} className="h-6 w-8 cursor-pointer rounded border border-slate-200" />
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="mb-1 text-[10px] font-semibold text-slate-500">{tl("Dimensioni")}</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {([tl("Larg. X"), tl("Prof. Y"), tl("Alt. Z")] as const).map((l, i) => (
                        <NumField key={l} label={l} value={singleExtent[i]} min={0.1} suffix="mm" onCommit={v => setExtent(i, v)} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-semibold text-slate-500">{tl("Posizione (centro)")}</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['X', 'Y', 'Z'] as const).map((l, i) => (
                        <NumField key={l} label={l} value={single.position[i]} suffix="mm" onCommit={v => updateSelected(o => { const p = [...o.position] as Vec3; p[i] = v; return { ...o, position: p } })} />
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">{tl("Base a z =")} {baseZ} mm {Math.abs(baseZ) > 0.01 && <button type="button" onClick={doDrop} className="font-semibold text-blue-600 hover:underline">{tl("appoggia sul piano")}</button>}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-semibold text-slate-500">{tl("Rotazione")}</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['X', 'Y', 'Z'] as const).map((l, i) => (
                        <NumField key={l} label={l} value={single.rotation[i]} step={15} suffix="°" onCommit={v => updateSelected(o => { const r = [...o.rotation] as Vec3; r[i] = v; return { ...o, rotation: r } })} />
                      ))}
                    </div>
                  </div>

                  {single.kind !== 'group' && <ParamsEditor key={single.id} obj={single} onParam={setParam} />}
                  {single.kind === 'group' && (
                    <div className="rounded-lg bg-slate-50 p-2 text-[11px] leading-4 text-slate-500">
                      {tl("Scala:")} {scaleOf(single).map(s => s.toFixed(2)).join(' × ')}{tl(". Separa il gruppo (Ctrl+Shift+G) per modificare le singole parti.")}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
      {shareId && <SolidModelShareDialog modelId={shareId} name={project.name} onClose={() => setShareId(null)} />}
      {arOpen && <SolidModelArDialog modelId={arOpen.id} name={project.name} objects={objects} onClose={() => setArOpen(null)} />}
      <SolidRenderDialog open={renderOpen} onClose={() => setRenderOpen(false)} viewport={viewport} name={project.name} />
    </div>
    </>
  )
}

function SaveBadge({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, { label: string; cls: string; icon: LucideIcon | null }> = {
    idle: { label: tl("Non salvato"), cls: 'text-slate-400', icon: null },
    dirty: { label: tl("Modifiche…"), cls: 'text-slate-400', icon: null },
    saving: { label: tl("Salvataggio…"), cls: 'text-slate-500', icon: Loader2 },
    saved: { label: tl("Salvato"), cls: 'text-emerald-600', icon: Cloud },
    error: { label: tl("Errore salvataggio"), cls: 'text-rose-600', icon: CloudOff },
  }
  const { label, cls, icon: Icon } = map[status]
  return (
    <span className={`hidden items-center gap-1 text-[10px] font-semibold lg:inline-flex ${cls}`}>
      {Icon && <Icon className={`h-3 w-3 ${status === 'saving' ? 'animate-spin' : ''}`} />} {label}
    </span>
  )
}

function ParamsEditor({ obj, onParam }: { obj: PrimitiveObject; onParam: (k: keyof PrimitiveObject['params'], v: number | string) => void }) {
  const p = obj.params
  const slider = (key: keyof PrimitiveObject['params'], label: string, min: number, max: number, step: number, def: number) => (
    <label key={key} className="block">
      <span className="flex justify-between text-[10px] font-semibold text-slate-400">
        {label} <span className="text-slate-600">{(p[key] as number | undefined) ?? def}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={(p[key] as number | undefined) ?? def} onChange={e => onParam(key, Number(e.target.value))} className="w-full accent-blue-600" />
    </label>
  )
  const rows: JSX.Element[] = []
  if (obj.kind === 'polyhedron') rows.push(<NumField key="faces" label={tl("Numero di facce")} value={p.faces ?? 7} min={4} onCommit={v => onParam('faces', Math.min(64, Math.max(4, Math.round(v))))} />)
  if (obj.kind === 'cylinder' || obj.kind === 'cone') rows.push(slider('sides', tl("Lati"), 3, 64, 1, 32))
  if (obj.kind === 'cone') rows.push(slider('topRatio', tl("Raggio superiore"), 0, 1, 0.05, 0))
  if (obj.kind === 'box') rows.push(slider('radius', tl("Raccordo spigoli"), 0, 0.49, 0.01, 0))
  if (obj.kind === 'torus') rows.push(slider('thickness', tl("Spessore anello"), 0.05, 0.45, 0.01, 0.2))
  if (obj.kind === 'tube') rows.push(slider('wall', tl("Spessore parete"), 0.05, 0.45, 0.01, 0.12))
  if (obj.kind === 'star') rows.push(slider('points', tl("Punte"), 3, 12, 1, 5), slider('inner', tl("Raggio interno"), 0.2, 0.9, 0.05, 0.5))
  if (obj.kind === 'text') {
    rows.push(
      <label key="text" className="block">
        <span className="text-[10px] font-semibold text-slate-400">{tl("Testo")}</span>
        <input defaultValue={p.text ?? ''} maxLength={24} onBlur={e => onParam('text', e.target.value || 'Testo')} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold" />
      </label>,
    )
  }
  if (!rows.length) return null
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold text-slate-500">{tl("Parametri forma")}</p>
      <div className="space-y-2">{rows}</div>
    </div>
  )
}

/** 3D preview of a library shape, rendered from its real geometry (falls back to the icon without WebGL). */
function ShapeThumb({ def, className, fallback }: { def: PrimitiveDef; className: string; fallback: ReactNode }) {
  const url = useMemo(() => shapePreviewUrl(def), [def])
  return url ? <img src={url} alt="" draggable={false} className={`${className} select-none object-contain`} /> : <>{fallback}</>
}
