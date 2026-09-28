import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/design/primitives/Button'
import { IconButton } from '@/design/primitives/IconButton'
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical,
  ArrowDownToLine, Box, Circle, Cloud, CloudOff, Download, Grid3x3, Loader2, Share2, Cone, Copy, Cylinder, Donut, Eye, FileDown, FilePlus2, FileUp, FlipHorizontal2, FlipVertical2,
  FolderOpen, Group, Home, Layers, Maximize, Pyramid, Redo2, Sparkles, Star, Torus, Trash2, Triangle, Type, Undo2, Ungroup,
  type LucideIcon,
} from 'lucide-react'
import SolidModelerViewport, { type ViewName, type ViewportApi } from './SolidModelerViewport'
import SolidModelerAIPanel from './SolidModelerAIPanel'
import SolidModelShareDialog from './SolidModelShareDialog'
import { useSolidProject, type SaveStatus } from './useSolidProject'
import { exportSTL, objectGeometry, scaleOf, worldBox } from './geometry'
import {
  alignObjects, createPrimitive, dropToPlate, duplicateObjects, groupObjects, mirrorObjects, ungroupObject, type AlignMode,
} from './sceneOps'
import type { PrimitiveDef, PrimitiveKind, PrimitiveObject, SceneObject, Vec3 } from './types'
import { COLOR_SWATCHES, KIND_LABEL, PRIMITIVES } from './types'

const ICONS: Record<PrimitiveKind | 'group', LucideIcon> = {
  box: Box, cylinder: Cylinder, sphere: Circle, cone: Cone, pyramid: Pyramid, hemisphere: Circle,
  wedge: Triangle, torus: Torus, tube: Donut, star: Star, text: Type, group: Group,
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'modello'

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
      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</span>
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
  const [snap, setSnap] = useState(1)
  const [panel, setPanel] = useState<'shape' | 'ai'>('ai')
  const [hover, setHover] = useState<string | null>(null)
  const [projectsOpen, setProjectsOpen] = useState(false)
  const [shareId, setShareId] = useState<string | null>(null)
  const [aiHighlight, setAiHighlight] = useState<string[]>([])
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
    setHist({ past: [], present, future: [] })
    setSelection([])
    setTimeout(() => viewport.current?.setView('home'), 0)
  }, [])
  const snapshot = useCallback(() => viewport.current?.snapshot() ?? null, [])
  const project = useSolidProject({ objects, resetScene, snapshot, student })

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

  const selected = useMemo(() => objects.filter(o => selection.includes(o.id)), [objects, selection])
  const single = selected.length === 1 ? selected[0] : null

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
    if (!targets.some(o => !o.hole)) return
    download(exportSTL(targets), `${slug(project.name)}.stl`)
  }

  // ── Keyboard ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      else if (k === 'escape') setSelection([])
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
    <div className="flex h-full min-h-0 flex-col bg-slate-50">
      {/* Toolbar */}
      <div className="flex flex-nowrap items-center gap-1 border-b border-slate-200 bg-white/90 px-3 py-1.5">
        {leading && <><div className="flex shrink-0 items-center gap-1">{leading}</div><Divider /></>}
        <div className="relative flex min-w-0 items-center gap-1">
          <ToolButton icon={FolderOpen} label="Progetti" onClick={() => setProjectsOpen(o => !o)} />
          <input
            value={project.name}
            onChange={e => project.setName(e.target.value)}
            title="Nome del progetto"
            className="w-28 min-w-0 rounded-full border border-transparent bg-transparent px-2 py-1 text-sm font-black text-slate-900 hover:border-slate-200 focus:border-[color:var(--selection-border-hover)] focus:outline-none xl:w-44"
          />
          <SaveBadge status={project.status} />
          {projectsOpen && (
            <div className="absolute left-0 top-10 z-30 w-80 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
              <button type="button" onClick={() => { setProjectsOpen(false); void project.newProject() }} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-bold text-blue-700 hover:bg-blue-50">
                <FilePlus2 className="h-4 w-4" /> Nuovo progetto
              </button>
              {project.legacy.length > 0 && (
                <div className="mt-1 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">
                  <p>{project.legacy.length} progetti sono salvati solo in questo browser.</p>
                  <div className="mt-1 flex gap-2">
                    <button type="button" onClick={() => void project.importLegacy()} className="font-bold text-amber-800 underline">Importali sul server</button>
                    <button type="button" onClick={project.dismissLegacy} className="text-amber-700">Ignora</button>
                  </div>
                </div>
              )}
              <div className="my-1 h-px bg-slate-100" />
              <div className="max-h-80 overflow-y-auto">
                {project.projectsLoading && <p className="px-2 py-3 text-xs text-slate-400">Carico…</p>}
                {!project.projectsLoading && !project.projects.length && <p className="px-2 py-3 text-xs text-slate-400">Nessun progetto salvato.</p>}
                {project.projects.map(p => (
                  <div key={p.id} className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs ${p.id === project.projectId ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
                    <button type="button" onClick={() => { setProjectsOpen(false); void project.openProject(p.id) }} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                      <span className="h-9 w-14 shrink-0 overflow-hidden rounded-md bg-slate-100">
                        {p.thumbnail ? <img src={p.thumbnail} alt="" className="h-full w-full object-cover" /> : <Box className="m-auto mt-2 h-5 w-5 text-slate-300" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate font-bold text-slate-800">{p.name}</span>
                        <span className="block text-[10px] text-slate-400">
                          {p.object_count} oggetti · {new Date(p.updated_at).toLocaleString('it-IT')}
                          {(p.public_enabled || p.shared_class_ids.length > 0) && ' · condiviso'}
                        </span>
                      </span>
                    </button>
                    <button type="button" title="Elimina progetto" onClick={() => { if (window.confirm(`Eliminare "${p.name}"? Anche i link condivisi smetteranno di funzionare.`)) void project.deleteProject(p.id) }} className="rounded p-1 text-slate-400 opacity-0 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <Divider />
        <ToolButton icon={Undo2} label="Annulla" shortcut="Ctrl+Z" onClick={undo} disabled={!hist.past.length} />
        <ToolButton icon={Redo2} label="Ripeti" shortcut="Ctrl+Y" onClick={redo} disabled={!hist.future.length} />
        <Divider />
        <ToolButton icon={Group} label="Raggruppa" shortcut="Ctrl+G" onClick={doGroup} disabled={selection.length < 2} />
        <ToolButton icon={Ungroup} label="Separa" shortcut="Ctrl+Shift+G" onClick={doUngroup} disabled={single?.kind !== 'group'} />
        <ToolButton icon={Copy} label="Duplica" shortcut="Ctrl+D" onClick={doDuplicate} disabled={!selection.length} />
        <ToolButton icon={ArrowDownToLine} label="Appoggia" shortcut="D" onClick={doDrop} disabled={!selection.length} />
        <ToolButton icon={FlipHorizontal2} label="Specchia X" onClick={() => doMirror(0)} disabled={!selection.length} />
        <ToolButton icon={FlipVertical2} label="Specchia Y" onClick={() => doMirror(1)} disabled={!selection.length} />
        <ToolButton icon={Trash2} label="Elimina" shortcut="Canc" onClick={doDelete} disabled={!selection.length} />
        {selection.length > 1 && (
          <>
            <Divider />
            <ToolButton icon={AlignStartVertical} label="Allinea sx" onClick={() => doAlign(0, 'min')} />
            <ToolButton icon={AlignCenterVertical} label="Centra X" onClick={() => doAlign(0, 'center')} />
            <ToolButton icon={AlignEndVertical} label="Allinea dx" onClick={() => doAlign(0, 'max')} />
            <ToolButton icon={AlignStartHorizontal} label="Allinea fronte" onClick={() => doAlign(1, 'min')} />
            <ToolButton icon={AlignCenterHorizontal} label="Centra Y" onClick={() => doAlign(1, 'center')} />
            <ToolButton icon={AlignEndHorizontal} label="Allinea retro" onClick={() => doAlign(1, 'max')} />
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <input ref={fileInput} type="file" accept="application/json,.json" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = '' }} />
          <ToolButton icon={FileUp} label="Importa JSON" onClick={() => fileInput.current?.click()} />
          <ToolButton icon={FileDown} label="Esporta JSON" onClick={exportJson} disabled={!objects.length} />
          {!student && <Button
            type="button"
            onClick={() => void openShare()}
            title="Condividi con la classe o con un link / QR code"
            tone="accent"
            surface={project.current && (project.current.public_enabled || project.current.shared_class_ids.length) ? 'soft' : 'solid'}
            density="compact"
            className="ml-1 rounded-full"
          >
            <Share2 /> Condividi
          </Button>}
          <Button
            type="button"
            onClick={doExportSTL}
            disabled={!objects.some(o => !o.hole)}
            title={selected.length ? 'Esporta STL della selezione' : 'Esporta STL della scena'}
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
        <aside className="flex w-52 shrink-0 flex-col border-r border-slate-200 bg-white/80">
          <p className="px-3 pb-1 pt-3 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Forme base</p>
          <div className="grid grid-cols-3 gap-1.5 px-2">
            {PRIMITIVES.map((def, i) => {
              const Icon = ICONS[def.kind]
              return (
                <button
                  key={`${def.kind}-${i}`}
                  type="button"
                  draggable
                  onDragStart={e => { e.dataTransfer.setData('application/x-solid-primitive', String(i)); e.dataTransfer.effectAllowed = 'copy' }}
                  onClick={() => addPrimitive(def)}
                  title={`${def.label} — clic per aggiungere al centro o trascina sul piano`}
                  className={`flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border text-[10px] font-bold leading-tight transition hover:-translate-y-0.5 hover:shadow ${
                    def.hole ? 'border-dashed border-slate-300 bg-slate-50 text-slate-500' : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  <Icon className="h-6 w-6" style={{ color: def.hole ? '#94a3b8' : def.color }} strokeWidth={2.2} />
                  <span className="px-0.5 text-center">{def.label}</span>
                </button>
              )
            })}
          </div>
          <p className="flex items-center gap-1.5 px-3 pb-1 pt-4 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400"><Layers className="h-3 w-3" /> Oggetti ({objects.length})</p>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {objects.length === 0 && <p className="px-1 text-[11px] leading-4 text-slate-400">Scena vuota: aggiungi una forma o chiedi all'assistente AI.</p>}
            {objects.map(o => {
              const Icon = ICONS[o.kind]
              const sel = selection.includes(o.id)
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={e => setSelection(e.shiftKey || e.ctrlKey || e.metaKey ? (sel ? selection.filter(s => s !== o.id) : [...selection, o.id]) : [o.id])}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[11px] ${sel ? 'bg-blue-50 font-bold text-blue-800' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: o.hole ? 'repeating-linear-gradient(45deg,#94a3b8 0 2px,#fff 2px 4px)' : o.color }} />
                  <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="truncate">{o.name}</span>
                </button>
              )
            })}
          </div>
        </aside>

        {/* Viewport */}
        <main className="relative min-w-0 flex-1">
          <SolidModelerViewport
            objects={objects}
            selection={selection}
            snap={snap}
            highlightIds={aiHighlight}
            onSelect={ids => { setSelection(ids); setAiHighlight([]) }}
            onChange={apply}
            onDropPrimitive={addPrimitive}
            onHover={info => setHover(h => (h === info ? h : info))}
            apiRef={viewport}
          />
          <label className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/90 py-1 pl-3 pr-1 text-[11px] font-bold text-slate-500 shadow-sm backdrop-blur-sm">
            <Grid3x3 className="h-3.5 w-3.5" /> Griglia
            <select value={snap} onChange={e => setSnap(Number(e.target.value))} className="rounded-full border-0 bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700 focus:outline-none">
              {[0, 0.5, 1, 2, 5, 10].map(v => <option key={v} value={v}>{v === 0 ? 'libera' : `${v} mm`}</option>)}
            </select>
          </label>
          <div className="absolute right-3 top-3 flex flex-col gap-1 rounded-full border border-slate-200 bg-white/90 p-1 shadow-sm backdrop-blur-sm">
            {([['home', Home, 'Vista iniziale'], ['top', Eye, 'Dall\'alto'], ['front', Box, 'Fronte'], ['right', Cylinder, 'Lato'], ['fit', Maximize, 'Inquadra (F)']] as const).map(([v, Icon, label]) => (
              <IconButton key={v} type="button" title={label} aria-label={label} onClick={() => setView(v)} tone="neutral" surface="ghost" size="sm" className="rounded-full">
                <Icon />
              </IconButton>
            ))}
          </div>
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-140px)] rounded-lg bg-white/85 px-2.5 py-1.5 text-[10.5px] leading-4 text-slate-500 shadow-sm">
            {hover ? <span className="font-bold text-slate-800">{hover}</span> : (
              <>Sinistro: ruota vista / trascina oggetto · Destro: sposta vista · Rotella: zoom · Maniglie: ridimensiona (Shift = proporzionale) · Anelli: ruota (Shift = 1°)</>
            )}
          </div>
        </main>

        {/* Right panel */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white/85">
          <div className="flex gap-1 border-b border-slate-200 p-1.5">
            {([['shape', 'Forma', Box], ['ai', 'Assistente AI', Sparkles]] as const).map(([id, label, Icon]) => (
              <button key={id} type="button" onClick={() => setPanel(id)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-black ${panel === id ? (id === 'ai' ? 'bg-violet-600 text-white' : 'bg-slate-900 text-white') : 'text-slate-600 hover:bg-slate-100'}`}>
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>

          <div className={`min-h-0 flex-1 ${panel === 'ai' ? 'flex flex-col' : 'hidden'}`}>
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
                apply(scene, false)
              }}
            />
          </div>

          {panel === 'shape' && (
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!selected.length && (
                <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs leading-5 text-slate-500">
                  Seleziona un oggetto per modificarne dimensioni, posizione, colore e tipo (solido o foro).
                  Shift+clic per selezionare più oggetti e raggrupparli.
                </p>
              )}
              {selected.length > 1 && (
                <div className="space-y-2 text-xs text-slate-600">
                  <p className="font-black text-slate-900">{selected.length} oggetti selezionati</p>
                  <p>Raggruppa per unire i solidi e sottrarre i fori (Ctrl+G).</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => updateSelected(o => ({ ...o, hole: false }))} className="flex-1 rounded-lg border border-slate-200 py-1.5 font-bold hover:bg-slate-50">Tutti solidi</button>
                    <button type="button" onClick={() => updateSelected(o => ({ ...o, hole: true }))} className="flex-1 rounded-lg border border-dashed border-slate-300 py-1.5 font-bold hover:bg-slate-50">Tutti fori</button>
                  </div>
                  <button type="button" onClick={doGroup} className="w-full rounded-lg bg-slate-900 py-2 font-bold text-white hover:bg-slate-800">Raggruppa</button>
                </div>
              )}
              {single && singleExtent && (
                <div className="space-y-4">
                  <div>
                    <input
                      value={single.name}
                      onChange={e => apply(objects.map(o => (o.id === single.id ? { ...o, name: e.target.value } : o)), false)}
                      className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm font-black text-slate-900 focus:border-blue-400 focus:outline-none"
                    />
                    <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {KIND_LABEL[single.kind]}{single.kind === 'group' ? ` · ${single.children.length} parti` : ''}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-1.5">
                    <button type="button" onClick={() => updateSelected(o => ({ ...o, hole: false }))} className={`rounded-lg py-2 text-xs font-black ${!single.hole ? 'bg-slate-900 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>Solido</button>
                    <button type="button" onClick={() => updateSelected(o => ({ ...o, hole: true }))} className={`rounded-lg py-2 text-xs font-black ${single.hole ? 'bg-slate-500 text-white' : 'border border-dashed border-slate-300 text-slate-600 hover:bg-slate-50'}`}>Foro</button>
                  </div>

                  {!single.hole && (
                    <div>
                      <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">Colore</p>
                      <div className="flex flex-wrap gap-1.5">
                        {COLOR_SWATCHES.map(c => (
                          <button key={c} type="button" title={c} onClick={() => updateSelected(o => ({ ...o, color: c }))} className={`h-6 w-6 rounded-full border ${single.color === c ? 'ring-2 ring-blue-500 ring-offset-1' : 'border-slate-300'}`} style={{ background: c }} />
                        ))}
                        <input type="color" value={single.color} onChange={e => updateSelected(o => ({ ...o, color: e.target.value }))} className="h-6 w-8 cursor-pointer rounded border border-slate-200" />
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="mb-1 text-[10px] font-black uppercase tracking-wider text-slate-500">Dimensioni</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['Larg. X', 'Prof. Y', 'Alt. Z'] as const).map((l, i) => (
                        <NumField key={l} label={l} value={singleExtent[i]} min={0.1} suffix="mm" onCommit={v => setExtent(i, v)} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-black uppercase tracking-wider text-slate-500">Posizione (centro)</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['X', 'Y', 'Z'] as const).map((l, i) => (
                        <NumField key={l} label={l} value={single.position[i]} suffix="mm" onCommit={v => updateSelected(o => { const p = [...o.position] as Vec3; p[i] = v; return { ...o, position: p } })} />
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] text-slate-400">Base a z = {baseZ} mm {Math.abs(baseZ) > 0.01 && <button type="button" onClick={doDrop} className="font-bold text-blue-600 hover:underline">appoggia sul piano</button>}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-[10px] font-black uppercase tracking-wider text-slate-500">Rotazione</p>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['X', 'Y', 'Z'] as const).map((l, i) => (
                        <NumField key={l} label={l} value={single.rotation[i]} step={15} suffix="°" onCommit={v => updateSelected(o => { const r = [...o.rotation] as Vec3; r[i] = v; return { ...o, rotation: r } })} />
                      ))}
                    </div>
                  </div>

                  {single.kind !== 'group' && <ParamsEditor key={single.id} obj={single} onParam={setParam} />}
                  {single.kind === 'group' && (
                    <div className="rounded-lg bg-slate-50 p-2 text-[11px] leading-4 text-slate-500">
                      Scala: {scaleOf(single).map(s => s.toFixed(2)).join(' × ')}. Separa il gruppo (Ctrl+Shift+G) per modificare le singole parti.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </aside>
      </div>
      {shareId && <SolidModelShareDialog modelId={shareId} name={project.name} onClose={() => setShareId(null)} />}
    </div>
  )
}

function SaveBadge({ status }: { status: SaveStatus }) {
  const map: Record<SaveStatus, { label: string; cls: string; icon: LucideIcon | null }> = {
    idle: { label: 'Non salvato', cls: 'text-slate-400', icon: null },
    dirty: { label: 'Modifiche…', cls: 'text-slate-400', icon: null },
    saving: { label: 'Salvataggio…', cls: 'text-slate-500', icon: Loader2 },
    saved: { label: 'Salvato', cls: 'text-emerald-600', icon: Cloud },
    error: { label: 'Errore salvataggio', cls: 'text-rose-600', icon: CloudOff },
  }
  const { label, cls, icon: Icon } = map[status]
  return (
    <span className={`hidden items-center gap-1 text-[10px] font-bold lg:inline-flex ${cls}`}>
      {Icon && <Icon className={`h-3 w-3 ${status === 'saving' ? 'animate-spin' : ''}`} />} {label}
    </span>
  )
}

function ParamsEditor({ obj, onParam }: { obj: PrimitiveObject; onParam: (k: keyof PrimitiveObject['params'], v: number | string) => void }) {
  const p = obj.params
  const slider = (key: keyof PrimitiveObject['params'], label: string, min: number, max: number, step: number, def: number) => (
    <label key={key} className="block">
      <span className="flex justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
        {label} <span className="text-slate-600">{(p[key] as number | undefined) ?? def}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={(p[key] as number | undefined) ?? def} onChange={e => onParam(key, Number(e.target.value))} className="w-full accent-blue-600" />
    </label>
  )
  const rows: JSX.Element[] = []
  if (obj.kind === 'cylinder' || obj.kind === 'cone') rows.push(slider('sides', 'Lati', 3, 64, 1, 32))
  if (obj.kind === 'cone') rows.push(slider('topRatio', 'Raggio superiore', 0, 1, 0.05, 0))
  if (obj.kind === 'box') rows.push(slider('radius', 'Raccordo spigoli', 0, 0.49, 0.01, 0))
  if (obj.kind === 'torus') rows.push(slider('thickness', 'Spessore anello', 0.05, 0.45, 0.01, 0.2))
  if (obj.kind === 'tube') rows.push(slider('wall', 'Spessore parete', 0.05, 0.45, 0.01, 0.12))
  if (obj.kind === 'star') rows.push(slider('points', 'Punte', 3, 12, 1, 5), slider('inner', 'Raggio interno', 0.2, 0.9, 0.05, 0.5))
  if (obj.kind === 'text') {
    rows.push(
      <label key="text" className="block">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Testo</span>
        <input defaultValue={p.text ?? ''} maxLength={24} onBlur={e => onParam('text', e.target.value || 'Testo')} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} className="mt-0.5 w-full rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold" />
      </label>,
    )
  }
  if (!rows.length) return null
  return (
    <div>
      <p className="mb-1 text-[10px] font-black uppercase tracking-wider text-slate-500">Parametri forma</p>
      <div className="space-y-2">{rows}</div>
    </div>
  )
}
