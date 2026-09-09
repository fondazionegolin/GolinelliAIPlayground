import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { chatApi, teacherApi, studentApi } from '@/lib/api'
import {
  Eraser, StickyNote, Type, ImagePlus, Table, Pencil, Frame, MoveRight,
  RectangleHorizontal, Triangle, Undo2, Redo2, Maximize, Minimize,
  LayoutTemplate, Maximize2, MousePointer, Trash2, Users, Move,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

type CanvasRole = 'teacher' | 'student'
type Tool = 'select' | 'hand' | 'postit' | 'frame' | 'text' | 'pen' | 'roundedRect' | 'triangle' | 'connector'

type Point = { x: number; y: number }
type Anchor = 'top' | 'right' | 'bottom' | 'left'
const ANCHORS: Anchor[] = ['top', 'right', 'bottom', 'left']
type LockInfo = { userId: string; userType: string }

type CanvasItemBase = { id: string; parentFrameId?: string }

type CanvasTextStyle = {
  fontFamily: string
  fontSize: number
  fontWeight: 'normal' | '600'
  fontStyle: 'normal' | 'italic'
}

type CanvasPositionedItemBase = CanvasItemBase & { x: number; y: number; w: number; h: number }

type CanvasItem =
  | (CanvasPositionedItemBase & { type: 'postit'; text: string; color: string; textStyle?: CanvasTextStyle })
  | (CanvasPositionedItemBase & { type: 'frame'; text: string; color: string; textStyle?: CanvasTextStyle })
  | (CanvasPositionedItemBase & { type: 'text'; text: string; color: string; textStyle?: CanvasTextStyle })
  | (CanvasPositionedItemBase & { type: 'shape'; shape: 'rounded-rect' | 'triangle' | 'parallelogram'; fill: string; stroke: string })
  | (CanvasItemBase & { type: 'connector'; fromId: string; fromAnchor: Anchor; toId: string; toAnchor: Anchor; color: string; width: number })
  | (CanvasPositionedItemBase & { type: 'image'; src: string })
  | (CanvasPositionedItemBase & { type: 'table'; data: string[][] })
  | (CanvasItemBase & { type: 'path'; points: Point[]; color: string; width: number; parentFrameId?: string })

type CanvasDoc = { type: 'canvas_v1'; items: CanvasItem[] }

interface CollaborativeCanvasProps {
  sessionId?: string
  role: CanvasRole
  title: string
  onTitleChange?: (title: string) => void
  initialContent?: string
  onContentChange?: (contentJson: string) => void
  readOnly?: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_ZOOM = 0.15
const MAX_ZOOM = 3
const EMPTY_CANVAS: CanvasDoc = { type: 'canvas_v1', items: [] }

const DEFAULT_TEXT_STYLE: CanvasTextStyle = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 14,
  fontWeight: 'normal',
  fontStyle: 'normal',
}

const POSTIT_PALETTE = ['#fef9c3', '#fce7f3', '#dbeafe', '#dcfce7', '#ffedd5', '#ede9fe', '#fecaca', '#e0f2fe']

// ─── Template definitions ─────────────────────────────────────────────────────

function mkId() { return crypto.randomUUID() }

function simplifyPoints(points: Point[], minimumDistance: number): Point[] {
  if (points.length <= 2) return points
  const simplified = [points[0]]
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1]
    const point = points[index]
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= minimumDistance) simplified.push(point)
  }
  simplified.push(points[points.length - 1])
  return simplified
}

const TEMPLATES = [
  {
    id: 'brainstorming',
    name: 'Brainstorming',
    description: 'Idea centrale con rami per esplorare un tema liberamente',
    emoji: '🧠',
    create(): CanvasDoc {
      const centerId = mkId()
      const center: CanvasItem = {
        id: centerId, type: 'frame', x: 540, y: 380, w: 300, h: 130,
        text: '💡 Tema centrale', color: '#7c3aed',
        textStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 16, fontWeight: '600' },
      }
      const satellites = [
        { x: 100, y: 160, text: 'Idea 1', color: '#fef9c3' },
        { x: 540, y: 80, text: 'Idea 2', color: '#fce7f3' },
        { x: 980, y: 160, text: 'Idea 3', color: '#dbeafe' },
        { x: 100, y: 600, text: 'Idea 4', color: '#dcfce7' },
        { x: 540, y: 680, text: 'Idea 5', color: '#ffedd5' },
        { x: 980, y: 600, text: 'Idea 6', color: '#ede9fe' },
      ]
      const postits: CanvasItem[] = satellites.map(({ x, y, text, color }) => ({
        id: mkId(), type: 'postit', x, y, w: 200, h: 140,
        text, color, textStyle: DEFAULT_TEXT_STYLE,
      }))
      const connectors: CanvasItem[] = postits.map((p) => ({
        id: mkId(), type: 'connector',
        fromId: centerId, fromAnchor: 'bottom',
        toId: p.id, toAnchor: 'top',
        color: '#94a3b8', width: 2,
      }))
      return { type: 'canvas_v1', items: [center, ...postits, ...connectors] }
    },
  },
  {
    id: 'feedback',
    name: 'Feedback WWW / EBI',
    description: 'Cosa ha funzionato bene · Come migliorare',
    emoji: '💬',
    create(): CanvasDoc {
      const title: CanvasItem = {
        id: mkId(), type: 'text', x: 260, y: 40, w: 860, h: 60,
        text: 'Sessione di feedback', color: '#1e293b',
        textStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 22, fontWeight: '600' },
      }
      const wwwId = mkId(), ebiId = mkId()
      const www: CanvasItem = {
        id: wwwId, type: 'frame', x: 40, y: 130, w: 560, h: 560,
        text: '✅ Cosa ha funzionato bene', color: '#16a34a',
        textStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 14, fontWeight: '600' },
      }
      const ebi: CanvasItem = {
        id: ebiId, type: 'frame', x: 640, y: 130, w: 560, h: 560,
        text: '⚡ Come migliorare (EBI)', color: '#ea580c',
        textStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 14, fontWeight: '600' },
      }
      const wwwPostits: CanvasItem[] = [90, 260, 430].map((y) => ({
        id: mkId(), type: 'postit', x: 80, y, w: 480, h: 110,
        text: 'Scrivi qui...', color: '#dcfce7', textStyle: DEFAULT_TEXT_STYLE, parentFrameId: wwwId,
      }))
      const ebiPostits: CanvasItem[] = [90, 260, 430].map((y) => ({
        id: mkId(), type: 'postit', x: 680, y, w: 480, h: 110,
        text: 'Scrivi qui...', color: '#ffedd5', textStyle: DEFAULT_TEXT_STYLE, parentFrameId: ebiId,
      }))
      return { type: 'canvas_v1', items: [title, www, ebi, ...wwwPostits, ...ebiPostits] }
    },
  },
  {
    id: 'kwl',
    name: 'Tabella KWL',
    description: 'Conosco · Voglio sapere · Ho imparato',
    emoji: '📚',
    create(): CanvasDoc {
      const cols = [
        { x: 40, text: '🔵 Conosco già', color: '#3ea9f4', postColor: '#dbeafe' },
        { x: 460, text: '🟡 Voglio sapere', color: '#ca8a04', postColor: '#fef9c3' },
        { x: 880, text: '🟢 Ho imparato', color: '#16a34a', postColor: '#dcfce7' },
      ]
      const items: CanvasItem[] = cols.flatMap(({ x, text, color, postColor }) => {
        const fId = mkId()
        const frame: CanvasItem = {
          id: fId, type: 'frame', x, y: 40, w: 380, h: 680,
          text, color, textStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 14, fontWeight: '600' },
        }
        const postits: CanvasItem[] = [100, 270, 440, 610].map((y) => ({
          id: mkId(), type: 'postit', x: x + 20, y, w: 340, h: 120,
          text: '', color: postColor, textStyle: DEFAULT_TEXT_STYLE, parentFrameId: fId,
        }))
        return [frame, ...postits]
      })
      return { type: 'canvas_v1', items }
    },
  },
  {
    id: 'swot',
    name: 'Analisi SWOT',
    description: 'Forze · Debolezze · Opportunità · Minacce',
    emoji: '📊',
    create(): CanvasDoc {
      const quads = [
        { x: 40, y: 40, text: '💪 Punti di forza', color: '#16a34a', postColor: '#dcfce7' },
        { x: 520, y: 40, text: '⚠️ Debolezze', color: '#dc2626', postColor: '#fee2e2' },
        { x: 40, y: 440, text: '🌟 Opportunità', color: '#3ea9f4', postColor: '#dbeafe' },
        { x: 520, y: 440, text: '⚡ Minacce', color: '#ea580c', postColor: '#ffedd5' },
      ]
      const items: CanvasItem[] = quads.flatMap(({ x, y, text, color, postColor }) => {
        const fId = mkId()
        return [
          { id: fId, type: 'frame', x, y, w: 440, h: 360, text, color, textStyle: { ...DEFAULT_TEXT_STYLE, fontWeight: '600' } } as CanvasItem,
          { id: mkId(), type: 'postit', x: x + 20, y: y + 80, w: 400, h: 250, text: '', color: postColor, textStyle: DEFAULT_TEXT_STYLE, parentFrameId: fId } as CanvasItem,
        ]
      })
      return { type: 'canvas_v1', items }
    },
  },
  {
    id: 'timeline',
    name: 'Timeline',
    description: 'Sequenza di fasi o eventi in ordine cronologico',
    emoji: '📅',
    create(): CanvasDoc {
      const labels = ['Fase 1', 'Fase 2', 'Fase 3', 'Fase 4', 'Fase 5']
      const frameIds: string[] = []
      const items: CanvasItem[] = []
      labels.forEach((label, i) => {
        const fId = mkId()
        frameIds.push(fId)
        items.push({ id: fId, type: 'frame', x: 40 + i * 300, y: 160, w: 260, h: 340, text: label, color: '#3ea9f4', textStyle: { ...DEFAULT_TEXT_STYLE, fontWeight: '600' } } as CanvasItem)
        items.push({ id: mkId(), type: 'postit', x: 60 + i * 300, y: 260, w: 220, h: 220, text: '', color: '#dbeafe', textStyle: DEFAULT_TEXT_STYLE, parentFrameId: fId } as CanvasItem)
      })
      for (let i = 0; i < frameIds.length - 1; i++) {
        items.push({ id: mkId(), type: 'connector', fromId: frameIds[i], fromAnchor: 'right', toId: frameIds[i + 1], toAnchor: 'left', color: '#64748b', width: 2.5 } as CanvasItem)
      }
      return { type: 'canvas_v1', items }
    },
  },
  {
    id: 'rose-bud-thorn',
    name: 'Rosa · Bocciolo · Spina',
    description: 'Riflessione positiva, potenzialità e difficoltà',
    emoji: '🌹',
    create(): CanvasDoc {
      const cols = [
        { x: 40, text: '🌹 Rosa (positivo)', color: '#e11d48', postColor: '#fce7f3' },
        { x: 460, text: '🌱 Bocciolo (potenziale)', color: '#16a34a', postColor: '#dcfce7' },
        { x: 880, text: '🌵 Spina (difficoltà)', color: '#78350f', postColor: '#fef3c7' },
      ]
      const items: CanvasItem[] = cols.flatMap(({ x, text, color, postColor }) => {
        const fId = mkId()
        const frame: CanvasItem = { id: fId, type: 'frame', x, y: 40, w: 380, h: 560, text, color, textStyle: { ...DEFAULT_TEXT_STYLE, fontWeight: '600' } }
        const postits: CanvasItem[] = [100, 290, 450].map((y) => ({
          id: mkId(), type: 'postit', x: x + 20, y, w: 340, h: 140, text: '', color: postColor, textStyle: DEFAULT_TEXT_STYLE, parentFrameId: fId,
        }))
        return [frame, ...postits]
      })
      return { type: 'canvas_v1', items }
    },
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ensureTextStyle = (item: CanvasItem): CanvasItem => {
  if (item.type !== 'postit' && item.type !== 'frame' && item.type !== 'text') return item
  return { ...item, textStyle: { ...DEFAULT_TEXT_STYLE, ...(item.textStyle || {}) } } as CanvasItem
}

const apiByRole = {
  teacher: { getCanvas: teacherApi.getCanvas, updateCanvas: teacherApi.updateCanvas },
  student: { getCanvas: studentApi.getCanvas, updateCanvas: studentApi.updateCanvas },
}

const parseCanvasDoc = (raw: string | null | undefined): CanvasDoc => {
  if (!raw) return EMPTY_CANVAS
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.type === 'canvas_v1' && Array.isArray(parsed.items)) {
      return { type: 'canvas_v1', items: parsed.items.map((item: CanvasItem) => ensureTextStyle(item)) }
    }
  } catch { /* no-op */ }
  return EMPTY_CANVAS
}

/** Three-way, item-level merge used when two collaborators save different
 * objects from the same canvas version. Local edits win only for objects that
 * changed locally; untouched remote work is retained. */
const mergeCanvasDocs = (base: CanvasDoc, local: CanvasDoc, remote: CanvasDoc): CanvasDoc => {
  const baseById = new Map(base.items.map((item) => [item.id, item]))
  const localById = new Map(local.items.map((item) => [item.id, item]))
  const changedLocally = new Set<string>()
  baseById.forEach((baseItem, id) => {
    const localItem = localById.get(id)
    if (!localItem || JSON.stringify(localItem) !== JSON.stringify(baseItem)) changedLocally.add(id)
  })
  localById.forEach((_item, id) => { if (!baseById.has(id)) changedLocally.add(id) })

  const merged = remote.items
    .filter((item) => !(changedLocally.has(item.id) && !localById.has(item.id)))
    .map((item) => changedLocally.has(item.id) ? localById.get(item.id) || item : item)
  const mergedIds = new Set(merged.map((item) => item.id))
  local.items.forEach((item) => {
    if (changedLocally.has(item.id) && !mergedIds.has(item.id)) merged.push(item)
  })
  return { type: 'canvas_v1', items: merged }
}

const toCsvTable = (rows: Array<Array<string | number | boolean | null>>): string[][] =>
  rows.map((row) => row.map((cell) => (cell == null ? '' : String(cell))))

const isFrame = (item: CanvasItem): item is Extract<CanvasItem, { type: 'frame' }> => item.type === 'frame'
const isPath = (item: CanvasItem): item is Extract<CanvasItem, { type: 'path' }> => item.type === 'path'
const isConnector = (item: CanvasItem): item is Extract<CanvasItem, { type: 'connector' }> => item.type === 'connector'
const isShape = (item: CanvasItem): item is Extract<CanvasItem, { type: 'shape' }> => item.type === 'shape'
const isTextEditable = (item: CanvasItem): item is Extract<CanvasItem, { type: 'postit' | 'frame' | 'text' }> =>
  item.type === 'postit' || item.type === 'frame' || item.type === 'text'
const isPositioned = (item: CanvasItem): item is Exclude<CanvasItem, { type: 'path' | 'connector' }> =>
  !isPath(item) && !isConnector(item)

const getAnchorPoint = (item: Exclude<CanvasItem, { type: 'path' | 'connector' }>, anchor: Anchor): Point => {
  if (anchor === 'top') return { x: item.x + item.w / 2, y: item.y }
  if (anchor === 'right') return { x: item.x + item.w, y: item.y + item.h / 2 }
  if (anchor === 'bottom') return { x: item.x + item.w / 2, y: item.y + item.h }
  return { x: item.x, y: item.y + item.h / 2 }
}

const anchorDirection = (anchor: Anchor): Point => {
  if (anchor === 'top') return { x: 0, y: -1 }
  if (anchor === 'right') return { x: 1, y: 0 }
  if (anchor === 'bottom') return { x: 0, y: 1 }
  return { x: -1, y: 0 }
}

const extractImageUrlsFromHtml = (html: string): string[] =>
  [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => String(m[1] || '').trim()).filter(Boolean)

const looksLikeImageUrl = (v: string) =>
  Boolean(v) && (v.startsWith('data:image/') || v.startsWith('blob:') || /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(v))

const isContainedInFrame = (c: { x: number; y: number; w: number; h: number }, f: Extract<CanvasItem, { type: 'frame' }>) =>
  c.x >= f.x && c.y >= f.y && c.x + c.w <= f.x + f.w && c.y + c.h <= f.y + f.h

const getParentFrameId = (item: CanvasItem, items: CanvasItem[], skipFrameId?: string): string | undefined => {
  if (!isPositioned(item)) return item.parentFrameId
  const containers = items.filter(isFrame).filter((f) => f.id !== item.id && f.id !== skipFrameId && isContainedInFrame(item, f))
  if (containers.length === 0) return undefined
  containers.sort((a, b) => a.w * a.h - b.w * b.h)
  return containers[0].id
}

const collectFrameDescendants = (items: CanvasItem[], frameId: string): string[] => {
  const result = new Set<string>()
  const queue = [frameId]
  while (queue.length > 0) {
    const cur = queue.shift() as string
    items.forEach((item) => {
      if (item.parentFrameId === cur && !result.has(item.id)) {
        result.add(item.id)
        if (isFrame(item)) queue.push(item.id)
      }
    })
  }
  return Array.from(result)
}

// ─── Tool button (module-level to avoid remount on parent re-render) ──────────

function ToolButton({
  activeTool,
  t,
  icon: Icon,
  label,
  onSetTool,
}: {
  activeTool: Tool
  t: Tool
  icon: React.ElementType
  label: string
  onSetTool: (t: Tool) => void
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={() => onSetTool(t)}
      className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm transition-colors ${
        activeTool === t ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CollaborativeCanvas({
  sessionId,
  role,
  title,
  onTitleChange,
  initialContent,
  onContentChange,
  readOnly = false,
}: CollaborativeCanvasProps) {
  // Refs
  const containerRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const previewPathRef = useRef<SVGPathElement | null>(null)
  const connectorPreviewRef = useRef<SVGPathElement | null>(null)
  const createPreviewRef = useRef<HTMLDivElement | null>(null)
  const marqueeElementRef = useRef<HTMLDivElement | null>(null)
  const textEditorRefs = useRef<Record<string, HTMLTextAreaElement | HTMLInputElement | null>>({})
  const startTextEditingRef = useRef<(itemId: string, seed?: string) => void>(() => {})
  const draggingRef = useRef<{ id: string; offsetX: number; offsetY: number; originX: number; originY: number; pendingX?: number; pendingY?: number; childIds: string[]; origins: Record<string, Point> } | null>(null)
  const pendingDragRef = useRef<{ id: string; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null)
  const marqueeRef = useRef<{ start: Point; current: Point; additive: boolean } | null>(null)
  const resizingRef = useRef<{ id: string; startX: number; startY: number; startW: number; startH: number; pendingW?: number; pendingH?: number } | null>(null)
  const drawingRef = useRef<{ points: Point[] } | null>(null)
  const panningRef = useRef<{ startMouseX: number; startMouseY: number; startPanX: number; startPanY: number } | null>(null)
  const dragCreateRef = useRef<{ tool: Tool; startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const spaceHeldRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const lastSerializedRef = useRef('')
  const isInteractingRef = useRef(false)
  const latestSerializedRef = useRef('')
  const remoteWhileInteractingRef = useRef<string | null>(null)
  const rafDrawRef = useRef<number | null>(null)
  const dragRafRef = useRef<number | null>(null)
  const resizeRafRef = useRef<number | null>(null)
  const panRafRef = useRef<number | null>(null)
  const viewportCommitTimerRef = useRef<number | null>(null)
  const historyTimerRef = useRef<number | null>(null)
  const contentChangeTimerRef = useRef<number | null>(null)
  const onContentChangeRef = useRef(onContentChange)
  const lockTimestampsRef = useRef<Record<string, number>>({})
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const undoRedoRef = useRef(false)
  const deleteSelectedRef = useRef<() => void>(() => { /* noop */ })
  const versionRef = useRef(0)
  const panRef = useRef({ x: 220, y: 140 })
  const zoomRef = useRef(1)
  const activePointerIdRef = useRef<number | null>(null)
  const pointersRef = useRef(new Map<number, Point>())
  const pinchRef = useRef<{ startDistance: number; worldX: number; worldY: number; startZoom: number } | null>(null)
  const pushRemoteCanvasRef = useRef<(serialized: string) => Promise<void>>(async () => {})
  const lastTransformEmitRef = useRef(0)

  // Canvas state
  const [tool, setTool] = useState<Tool>('select')
  const [strokeColor, setStrokeColor] = useState('#3ea9f4')
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [newPostitColor, setNewPostitColor] = useState('#fef9c3')
  const [newShapeFill, setNewShapeFill] = useState('#bae6fd')
  const [newShapeStroke, setNewShapeStroke] = useState('#0369a1')
  const [canvasDoc, setCanvasDoc] = useState<CanvasDoc>(() => parseCanvasDoc(initialContent))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [connectorDrag, setConnectorDrag] = useState<{
    fromId: string; fromAnchor: Anchor; toPoint: Point; hoverTarget?: { id: string; anchor: Anchor }
  } | null>(null)
  const [isDropActive, setIsDropActive] = useState(false)
  const [version, setVersion] = useState(0)
  const [previewPoints, setPreviewPoints] = useState<Point[]>([])
  const [previewCreate, setPreviewCreate] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [locks, setLocks] = useState<Record<string, LockInfo>>({})
  const [socketConnected, setSocketConnected] = useState(false)

  // New: viewport & UI state
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 220, y: 140 })
  const [isPanning, setIsPanning] = useState(false)
  const [studentsCanWrite, setStudentsCanWrite] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [contextMenu, setContextMenu] = useState<{ screenX: number; screenY: number; itemId: string | null } | null>(null)

  // Derived
  const canEdit = !readOnly && (role === 'teacher' || studentsCanWrite)
  const serializedDoc = useMemo(() => JSON.stringify(canvasDoc), [canvasDoc])
  const itemById = useMemo(() => new Map(canvasDoc.items.map((item) => [item.id, item])), [canvasDoc.items])
  const connectorItems = useMemo(() => canvasDoc.items.filter(isConnector) as Array<Extract<CanvasItem, { type: 'connector' }>>, [canvasDoc.items])
  const pathItems = useMemo(() => canvasDoc.items.filter(isPath) as Array<Extract<CanvasItem, { type: 'path' }>>, [canvasDoc.items])
  const positionedItems = useMemo(() => canvasDoc.items.filter(isPositioned), [canvasDoc.items])
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const itemZIndex = useMemo(() => new Map(canvasDoc.items.map((item, index) => [item.id, index + 1])), [canvasDoc.items])
  const selectedItem = useMemo(
    () => (selectedId ? itemById.get(selectedId) || null : null),
    [itemById, selectedId],
  )
  const selectedTextStyle = useMemo(() => {
    if (!selectedItem || !isTextEditable(selectedItem)) return null
    return { ...DEFAULT_TEXT_STYLE, ...(selectedItem.textStyle || {}) }
  }, [selectedItem])

  const currentUserId = useMemo(() => {
    const raw = role === 'student' ? localStorage.getItem('student_token') : localStorage.getItem('access_token')
    if (!raw) return ''
    try { return String(JSON.parse(atob(raw.split('.')[1]))?.sub || '') } catch { return '' }
  }, [role])

  useEffect(() => { latestSerializedRef.current = serializedDoc }, [serializedDoc])
  useEffect(() => { onContentChangeRef.current = onContentChange }, [onContentChange])

  useEffect(() => {
    if (contentChangeTimerRef.current) window.clearTimeout(contentChangeTimerRef.current)
    contentChangeTimerRef.current = window.setTimeout(() => onContentChangeRef.current?.(serializedDoc), 120)
  }, [serializedDoc])

  useEffect(() => {
    if (historyRef.current.length === 0) {
      historyRef.current = [serializedDoc]
      historyIndexRef.current = 0
      setHistoryIndex(0)
    }
  }, [serializedDoc])

  useEffect(() => () => {
    if (rafDrawRef.current) window.cancelAnimationFrame(rafDrawRef.current)
    if (dragRafRef.current) window.cancelAnimationFrame(dragRafRef.current)
    if (resizeRafRef.current) window.cancelAnimationFrame(resizeRafRef.current)
    if (panRafRef.current) window.cancelAnimationFrame(panRafRef.current)
    if (viewportCommitTimerRef.current) window.clearTimeout(viewportCommitTimerRef.current)
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current)
    if (contentChangeTimerRef.current) window.clearTimeout(contentChangeTimerRef.current)
    onContentChangeRef.current?.(latestSerializedRef.current)
  }, [])

  const paintViewport = useCallback((nextPan = panRef.current, nextZoom = zoomRef.current) => {
    const world = worldRef.current
    if (!world) return
    world.style.transform = `translate3d(${nextPan.x}px, ${nextPan.y}px, 0) scale(${nextZoom})`
    const container = containerRef.current
    if (container) {
      container.style.backgroundSize = `${24 * nextZoom}px ${24 * nextZoom}px`
      container.style.backgroundPosition = `${nextPan.x}px ${nextPan.y}px`
    }
  }, [])

  useEffect(() => {
    panRef.current = pan
    zoomRef.current = zoom
    paintViewport(pan, zoom)
  }, [pan, paintViewport, zoom])

  // ─── Coordinate conversion ─────────────────────────────────────────────────

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    if (!containerRef.current) return { x: 0, y: 0 }
    const rect = containerRef.current.getBoundingClientRect()
    const currentPan = panRef.current
    const currentZoom = zoomRef.current
    return { x: (clientX - rect.left - currentPan.x) / currentZoom, y: (clientY - rect.top - currentPan.y) / currentZoom }
  }, [])

  // ─── History ───────────────────────────────────────────────────────────────

  const pushHistory = useCallback(() => {
    if (undoRedoRef.current) return
    const state = latestSerializedRef.current
    if (historyRef.current[historyIndexRef.current] === state) return
    const h = historyRef.current.slice(0, historyIndexRef.current + 1)
    h.push(state)
    if (h.length > 60) h.shift()
    historyRef.current = h
    historyIndexRef.current = h.length - 1
    setHistoryIndex(historyIndexRef.current)
  }, [])

  useEffect(() => {
    if (isInteractingRef.current || undoRedoRef.current || serializedDoc === lastSerializedRef.current) return
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current)
    historyTimerRef.current = window.setTimeout(pushHistory, 500)
    return () => { if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current) }
  }, [pushHistory, serializedDoc])

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return
    undoRedoRef.current = true
    historyIndexRef.current -= 1
    setHistoryIndex(historyIndexRef.current)
    const state = historyRef.current[historyIndexRef.current]
    const doc = parseCanvasDoc(state)
    setCanvasDoc(doc)
    lastSerializedRef.current = state
    latestSerializedRef.current = state
    undoRedoRef.current = false
    void pushRemoteCanvasRef.current(state)
  }, [])

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return
    undoRedoRef.current = true
    historyIndexRef.current += 1
    setHistoryIndex(historyIndexRef.current)
    const state = historyRef.current[historyIndexRef.current]
    const doc = parseCanvasDoc(state)
    setCanvasDoc(doc)
    lastSerializedRef.current = state
    latestSerializedRef.current = state
    undoRedoRef.current = false
    void pushRemoteCanvasRef.current(state)
  }, [])

  // ─── Viewport ─────────────────────────────────────────────────────────────

  const applyZoom = useCallback((factor: number, originX?: number, originY?: number) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const ox = originX ?? rect.width / 2
    const oy = originY ?? rect.height / 2
    const prevZoom = zoomRef.current
    const prevPan = panRef.current
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prevZoom * factor))
    const wx = (ox - prevPan.x) / prevZoom
    const wy = (oy - prevPan.y) / prevZoom
    const nextPan = { x: ox - wx * nextZoom, y: oy - wy * nextZoom }
    zoomRef.current = nextZoom
    panRef.current = nextPan
    paintViewport(nextPan, nextZoom)
    if (viewportCommitTimerRef.current) window.clearTimeout(viewportCommitTimerRef.current)
    viewportCommitTimerRef.current = window.setTimeout(() => {
      setZoom(zoomRef.current)
      setPan(panRef.current)
    }, 80)
  }, [paintViewport])

  const zoomIn = useCallback(() => applyZoom(1.2), [applyZoom])
  const zoomOut = useCallback(() => applyZoom(1 / 1.2), [applyZoom])

  const fitToScreen = useCallback(() => {
    if (!containerRef.current) return
    if (positionedItems.length === 0) {
      setPan({ x: 220, y: 140 }); setZoom(1); return
    }
    const minX = Math.min(...positionedItems.map((i) => i.x)) - 80
    const minY = Math.min(...positionedItems.map((i) => i.y)) - 80
    const maxX = Math.max(...positionedItems.map((i) => i.x + i.w)) + 80
    const maxY = Math.max(...positionedItems.map((i) => i.y + i.h)) + 80
    const rect = containerRef.current.getBoundingClientRect()
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY)) * 0.9))
    setZoom(newZoom)
    setPan({ x: (rect.width - (maxX - minX) * newZoom) / 2 - minX * newZoom, y: (rect.height - (maxY - minY) * newZoom) / 2 - minY * newZoom })
  }, [positionedItems])

  // ─── Remote canvas ────────────────────────────────────────────────────────

  const fetchRemoteCanvas = useCallback(async () => {
    if (!sessionId || isInteractingRef.current) return
    try {
      const res = await apiByRole[role].getCanvas(sessionId)
      const remote = parseCanvasDoc(res.data?.content_json)
      const nextSerialized = JSON.stringify(remote)
      setVersion(Number(res.data?.version || 0))
      if (res.data?.students_can_write !== undefined) setStudentsCanWrite(Boolean(res.data.students_can_write))
      if (nextSerialized !== lastSerializedRef.current) {
        setCanvasDoc(remote)
        lastSerializedRef.current = nextSerialized
        if (historyRef.current.length === 0) {
          historyRef.current = [nextSerialized]
          historyIndexRef.current = 0
          setHistoryIndex(0)
        }
      }
    } catch { /* silent */ }
  }, [role, sessionId])

  const pushRemoteCanvas = useCallback(async (nextSerialized: string) => {
    if (!sessionId || !canEdit) return
    try {
      const res = await apiByRole[role].updateCanvas(sessionId, { title, content_json: nextSerialized, base_version: version })
      const nextVersion = Number(res.data?.version || version + 1)
      versionRef.current = nextVersion
      setVersion(nextVersion)
      lastSerializedRef.current = nextSerialized
    } catch (error: any) {
      if (error?.response?.status === 409) {
        try {
          const current = await apiByRole[role].getCanvas(sessionId)
          const remoteVersion = Number(current.data?.version || 0)
          const merged = mergeCanvasDocs(
            parseCanvasDoc(lastSerializedRef.current),
            parseCanvasDoc(nextSerialized),
            parseCanvasDoc(current.data?.content_json),
          )
          const mergedSerialized = JSON.stringify(merged)
          const retry = await apiByRole[role].updateCanvas(sessionId, { title, content_json: mergedSerialized, base_version: remoteVersion })
          const mergedVersion = Number(retry.data?.version || remoteVersion + 1)
          versionRef.current = mergedVersion
          setVersion(mergedVersion)
          setCanvasDoc(merged)
          latestSerializedRef.current = mergedSerialized
          lastSerializedRef.current = mergedSerialized
          return
        } catch (retryError) {
          console.error('Canvas merge failed', retryError)
          await fetchRemoteCanvas()
          return
        }
      }
      console.error('Canvas update failed', error)
    }
  }, [canEdit, fetchRemoteCanvas, role, sessionId, title, version])
  pushRemoteCanvasRef.current = pushRemoteCanvas

  // Teacher only: toggle student write permission
  const toggleStudentsCanWrite = useCallback(async () => {
    if (role !== 'teacher' || !sessionId) return
    const next = !studentsCanWrite
    setStudentsCanWrite(next)
    try {
      const res = await teacherApi.updateCanvas(sessionId, {
        title,
        content_json: latestSerializedRef.current || JSON.stringify(EMPTY_CANVAS),
        students_can_write: next,
      })
      if (res.data?.version !== undefined) setVersion(Number(res.data.version))
      lastSerializedRef.current = latestSerializedRef.current
    } catch {
      setStudentsCanWrite(!next) // revert on error
    }
  }, [role, sessionId, studentsCanWrite, title])

  // ─── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const parsed = parseCanvasDoc(initialContent)
    const serialized = JSON.stringify(parsed)
    if (serialized !== serializedDoc) {
      setCanvasDoc(parsed)
      lastSerializedRef.current = serialized
      historyRef.current = [serialized]
      historyIndexRef.current = 0
      setHistoryIndex(0)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContent])

  useEffect(() => {
    if (!sessionId) return
    void fetchRemoteCanvas()
  }, [fetchRemoteCanvas, sessionId])

  useEffect(() => {
    if (!sessionId) return
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current)
    if (!socketConnected) {
      pollTimerRef.current = window.setInterval(() => {
        if (!isInteractingRef.current) void fetchRemoteCanvas()
      }, 5000)
    }
    return () => { if (pollTimerRef.current) window.clearInterval(pollTimerRef.current) }
  }, [fetchRemoteCanvas, sessionId, socketConnected])

  useEffect(() => {
    const socket = (window as any).socket
    if (!socket) return
    const onConnect = () => setSocketConnected(true)
    const onDisconnect = () => setSocketConnected(false)
    setSocketConnected(Boolean(socket.connected))
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect) }
  }, [])

  // Keep versionRef in sync so socket handler doesn't need version in its deps
  useEffect(() => { versionRef.current = version }, [version])

  useEffect(() => {
    const socket = (window as any).socket
    if (!socket || !sessionId) return
    const onCanvasUpdated = (payload: any) => {
      if (payload?.session_id !== sessionId) return
      // Process students_can_write unconditionally — must not be gated by version check
      if (payload?.students_can_write !== undefined) setStudentsCanWrite(Boolean(payload.students_can_write))
      const incomingVersion = Number(payload?.version || 0)
      if (incomingVersion <= versionRef.current) return
      if (isInteractingRef.current) { remoteWhileInteractingRef.current = String(payload?.content_json || ''); return }
      const remote = parseCanvasDoc(payload?.content_json)
      const remoteSerialized = JSON.stringify(remote)
      versionRef.current = incomingVersion
      setVersion(incomingVersion)
      if (remoteSerialized !== lastSerializedRef.current) {
        setCanvasDoc(remote)
        lastSerializedRef.current = remoteSerialized
        window.requestAnimationFrame(() => Object.values(itemRefs.current).forEach((element) => {
          if (!element) return
          element.style.transform = ''
          element.style.width = ''
          element.style.height = ''
        }))
      }
    }
    const onItemLock = (payload: any) => {
      if (payload?.session_id !== sessionId) return
      const itemId = String(payload?.item_id || ''), userId = String(payload?.user_id || ''), userType = String(payload?.user_type || '')
      if (!itemId || !userId) return
      lockTimestampsRef.current[itemId] = Date.now()
      setLocks((prev) => ({ ...prev, [itemId]: { userId, userType } }))
    }
    const onItemUnlock = (payload: any) => {
      if (payload?.session_id !== sessionId) return
      const itemId = String(payload?.item_id || '')
      if (!itemId) return
      delete lockTimestampsRef.current[itemId]
      setLocks((prev) => { const next = { ...prev }; delete next[itemId]; return next })
    }
    const onItemTransform = (payload: any) => {
      if (payload?.session_id !== sessionId || String(payload?.user_id || '') === currentUserId) return
      const itemId = String(payload?.item_id || '')
      const transform = payload?.transform || {}
      const element = itemRefs.current[itemId]
      if (!element) return
      const baseX = Number(element.dataset.canvasX || 0)
      const baseY = Number(element.dataset.canvasY || 0)
      if (Number.isFinite(transform.x) && Number.isFinite(transform.y)) {
        element.style.transform = `translate3d(${Number(transform.x) - baseX}px, ${Number(transform.y) - baseY}px, 0)`
      }
      if (Number.isFinite(transform.w)) element.style.width = `${Number(transform.w)}px`
      if (Number.isFinite(transform.h)) element.style.height = `${Number(transform.h)}px`
    }
    socket.on('canvas_updated', onCanvasUpdated)
    socket.on('canvas_item_lock', onItemLock)
    socket.on('canvas_item_unlock', onItemUnlock)
    socket.on('canvas_item_transform', onItemTransform)
    return () => { socket.off('canvas_updated', onCanvasUpdated); socket.off('canvas_item_lock', onItemLock); socket.off('canvas_item_unlock', onItemUnlock); socket.off('canvas_item_transform', onItemTransform) }
  }, [currentUserId, sessionId])

  // Auto-expire stale locks (60 s) — prevents permanently stuck "In uso" state
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now()
      const expired = Object.entries(lockTimestampsRef.current)
        .filter(([, ts]) => now - ts > 60_000)
        .map(([id]) => id)
      if (expired.length > 0) {
        expired.forEach((id) => delete lockTimestampsRef.current[id])
        setLocks((prev) => {
          const next = { ...prev }
          expired.forEach((id) => delete next[id])
          return next
        })
      }
    }, 15_000)
    return () => window.clearInterval(interval)
  }, [])

  // Clear all locks on socket reconnect (prevents stale locks after disconnect)
  useEffect(() => {
    const socket = (window as any).socket
    if (!socket) return
    const onReconnect = () => {
      lockTimestampsRef.current = {}
      setLocks({})
    }
    socket.on('connect', onReconnect)
    return () => socket.off('connect', onReconnect)
  }, [])

  // Auto-save with debounce
  useEffect(() => {
    if (!canEdit) return
    if (serializedDoc === lastSerializedRef.current) return
    if (isInteractingRef.current || undoRedoRef.current) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => { void pushRemoteCanvas(serializedDoc) }, 300)
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current) }
  }, [serializedDoc, canEdit, pushRemoteCanvas])

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isTyping = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable
      if (e.key === ' ' && !isTyping) { e.preventDefault(); spaceHeldRef.current = true }
      if (isTyping) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }
      const selected = selectedId ? itemById.get(selectedId) : null
      const startsTextEditing = canEdit && tool === 'select' && selected && isTextEditable(selected)
        && (e.key === 'Enter' || (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1))
      if (startsTextEditing) {
        e.preventDefault()
        startTextEditingRef.current(selected.id, e.key.length === 1 ? e.key : '')
        return
      }
      if (e.key === 'Escape') { setSelectedId(null); setSelectedIds([]); setEditingId(null); setTool('select'); setContextMenu(null) }
      if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) deleteSelectedRef.current()
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key === 'v' || e.key === 'V') setTool('select')
        if (e.key === 'h' || e.key === 'H') setTool('hand')
        if (canEdit) {
          if (e.key === 'p' || e.key === 'P') setTool('postit')
          if (e.key === 'f' || e.key === 'F') setTool('frame')
          if (e.key === 't' || e.key === 'T') setTool('text')
          if (e.key === 'r' || e.key === 'R') setTool('roundedRect')
          if (e.key === 'c' || e.key === 'C') setTool('connector')
          if (e.key === 'd' || e.key === 'D') setTool('pen')
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === ' ') spaceHeldRef.current = false }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
  }, [undo, redo, canEdit, itemById, selectedId, tool])

  // ─── Item lock helpers ────────────────────────────────────────────────────

  const emitLock = (itemId: string) => {
    const socket = (window as any).socket
    if (!socket || !sessionId) return
    socket.emit('canvas_item_lock', { session_id: sessionId, item_id: itemId })
  }
  const emitUnlock = (itemId: string) => {
    const socket = (window as any).socket
    if (!socket || !sessionId) return
    socket.emit('canvas_item_unlock', { session_id: sessionId, item_id: itemId })
  }
  const emitTransientTransforms = (updates: Array<{ itemId: string; transform: Partial<{ x: number; y: number; w: number; h: number }> }>) => {
    const now = performance.now()
    if (now - lastTransformEmitRef.current < 33) return
    lastTransformEmitRef.current = now
    const socket = (window as any).socket
    if (!socket?.connected || !sessionId) return
    updates.forEach(({ itemId, transform }) => socket.emit('canvas_item_transform', { session_id: sessionId, item_id: itemId, transform }))
  }
  const emitTransientTransform = (itemId: string, transform: Partial<{ x: number; y: number; w: number; h: number }>) => {
    emitTransientTransforms([{ itemId, transform }])
  }
  const isLockedByOther = (itemId: string) => {
    const lock = locks[itemId]
    return Boolean(lock && lock.userId && lock.userId !== currentUserId)
  }

  // ─── Interaction lifecycle ─────────────────────────────────────────────────

  const beginInteraction = () => { isInteractingRef.current = true }
  const endInteraction = () => {
    isInteractingRef.current = false
    const hadRemote = Boolean(remoteWhileInteractingRef.current)
    if (hadRemote) remoteWhileInteractingRef.current = null
    // Defer to after React flushes the latest state update into latestSerializedRef
    window.requestAnimationFrame(async () => {
      await pushRemoteCanvas(latestSerializedRef.current)
      pushHistory()
      if (hadRemote) remoteWhileInteractingRef.current = null
    })
  }

  // ─── Item creation ────────────────────────────────────────────────────────

  const DEFAULT_ITEM_SIZES: Partial<Record<Tool, [number, number]>> = {
    postit: [220, 180], frame: [360, 260], text: [280, 120], roundedRect: [220, 140], triangle: [220, 160],
  }

  const createItemAtBounds = (type: Tool, x: number, y: number, w: number, h: number): CanvasItem | null => {
    const id = mkId()
    if (type === 'postit') return { id, type: 'postit', x, y, w, h, text: '', color: newPostitColor, textStyle: DEFAULT_TEXT_STYLE }
    if (type === 'frame') return { id, type: 'frame', x, y, w, h, text: 'Frame', color: '#3ea9f4', textStyle: DEFAULT_TEXT_STYLE }
    if (type === 'text') return { id, type: 'text', x, y, w, h, text: 'Testo', color: '#0f172a', textStyle: DEFAULT_TEXT_STYLE }
    if (type === 'roundedRect') return { id, type: 'shape', shape: 'rounded-rect', x, y, w, h, fill: newShapeFill, stroke: newShapeStroke }
    if (type === 'triangle') return { id, type: 'shape', shape: 'triangle', x, y, w, h, fill: newShapeFill, stroke: newShapeStroke }
    return null
  }

  const updateItem = (id: string, patch: Partial<CanvasItem>) => {
    if (isLockedByOther(id)) return
    setCanvasDoc((prev) => {
      const target = prev.items.find((item) => item.id === id)
      if (!target) return prev
      const updated = { ...target, ...patch } as CanvasItem
      const positionChanged = isPositioned(updated) && ('x' in patch || 'y' in patch || 'w' in patch || 'h' in patch)
      const nextItem = positionChanged ? { ...updated, parentFrameId: getParentFrameId(updated, prev.items) } as CanvasItem : updated
      return { ...prev, items: prev.items.map((item) => item.id === id ? nextItem : item) }
    })
  }

  const startTextEditing = (itemId: string, seed = '') => {
    if (!canEdit || isLockedByOther(itemId)) return
    setTool('select')
    setSelectedId(itemId)
    setSelectedIds([itemId])
    setEditingId(itemId)
    if (seed) {
      setCanvasDoc((prev) => ({
        ...prev,
        items: prev.items.map((item) => {
          if (item.id !== itemId || !isTextEditable(item)) return item
          const current = item.text === 'Testo' || item.text === 'Frame' ? '' : item.text
          return { ...item, text: `${current}${seed}` } as CanvasItem
        }),
      }))
    }
    window.requestAnimationFrame(() => {
      const editor = textEditorRefs.current[itemId]
      if (!editor) return
      editor.focus({ preventScroll: true })
      if (!seed && (editor.value === 'Testo' || editor.value === 'Frame')) editor.select()
      else {
        const end = editor.value.length
        editor.setSelectionRange(end, end)
      }
    })
  }
  startTextEditingRef.current = startTextEditing

  const deleteItems = (requestedIds: string[]) => {
    if (!canEdit || requestedIds.length === 0) return
    const deletableIds = requestedIds.filter((id) => !isLockedByOther(id))
    if (deletableIds.length === 0) return
    beginInteraction()
    setCanvasDoc((prev) => {
      const removedIds = new Set<string>()
      deletableIds.forEach((id) => {
        const selected = prev.items.find((item) => item.id === id)
        if (!selected) return
        if (isFrame(selected)) collectFrameDescendants(prev.items, selected.id).forEach((childId) => removedIds.add(childId))
        removedIds.add(selected.id)
      })
      const remaining = prev.items.filter((i) => !removedIds.has(i.id))
      return { ...prev, items: remaining.filter((i) => !isConnector(i) || (!removedIds.has((i as any).fromId) && !removedIds.has((i as any).toId))) }
    })
    deletableIds.forEach(emitUnlock)
    setSelectedId(null)
    setSelectedIds([])
    setEditingId(null)
    endInteraction()
  }

  const deleteSelected = useCallback(() => {
    deleteItems(selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedIds, canEdit])

  // Keep ref in sync
  deleteSelectedRef.current = deleteSelected

  // ─── Z-order & duplicate ─────────────────────────────────────────────────

  const reorderItem = useCallback((id: string, action: 'front' | 'back' | 'forward' | 'backward') => {
    if (!canEdit) return
    beginInteraction()
    setCanvasDoc((prev) => {
      const target = prev.items.find((item) => item.id === id)
      if (!target) return prev
      const belongsToLayer = isPositioned(target)
        ? isPositioned
        : isPath(target)
          ? isPath
          : isConnector
      const layerItems = prev.items.filter(belongsToLayer)
      const idx = layerItems.findIndex((item) => item.id === id)
      if (idx === -1) return prev
      if (action === 'front' && idx < layerItems.length - 1) layerItems.push(layerItems.splice(idx, 1)[0])
      else if (action === 'back' && idx > 0) layerItems.unshift(layerItems.splice(idx, 1)[0])
      else if (action === 'forward' && idx < layerItems.length - 1) { [layerItems[idx], layerItems[idx + 1]] = [layerItems[idx + 1], layerItems[idx]] }
      else if (action === 'backward' && idx > 0) { [layerItems[idx - 1], layerItems[idx]] = [layerItems[idx], layerItems[idx - 1]] }
      else return prev
      let layerIndex = 0
      return { ...prev, items: prev.items.map((item) => belongsToLayer(item) ? layerItems[layerIndex++] : item) }
    })
    endInteraction()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit])

  const duplicateItem = useCallback((id: string) => {
    if (!canEdit) return
    beginInteraction()
    setCanvasDoc((prev) => {
      const item = prev.items.find((i) => i.id === id)
      if (!item) return prev
      const copy = { ...item, id: mkId() } as CanvasItem
      if (isPositioned(copy)) { (copy as any).x += 24; (copy as any).y += 24 }
      return { ...prev, items: [...prev.items, copy] }
    })
    endInteraction()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit])

  const forceUnlockItem = useCallback((id: string) => {
    delete lockTimestampsRef.current[id]
    setLocks((prev) => { const next = { ...prev }; delete next[id]; return next })
    const socket = (window as any).socket
    if (socket && sessionId) socket.emit('canvas_item_unlock', { session_id: sessionId, item_id: id })
  }, [sessionId])

  // ─── Templates ───────────────────────────────────────────────────────────

  const applyTemplate = (doc: CanvasDoc) => {
    beginInteraction()
    setCanvasDoc(doc)
    setSelectedId(null)
    setSelectedIds([])
    setEditingId(null)
    setShowTemplates(false)
    endInteraction()
  }

  // ─── Context menu ─────────────────────────────────────────────────────────

  const openContextMenu = (e: React.MouseEvent, itemId: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ screenX: e.clientX, screenY: e.clientY, itemId })
    if (itemId) { setSelectedId(itemId); setSelectedIds([itemId]); setEditingId(null) }
  }

  const closeContextMenu = () => setContextMenu(null)

  // ─── Mouse / touch handlers ───────────────────────────────────────────────

  const onPointerDownItem = (e: ReactPointerEvent, item: CanvasItem) => {
    e.stopPropagation()
    if (pinchRef.current) return
    if (e.button !== 0 && e.pointerType !== 'touch') return
    activePointerIdRef.current = e.pointerId
    const additiveSelection = e.shiftKey || e.ctrlKey || e.metaKey
    if (additiveSelection) {
      e.preventDefault()
      setEditingId(null)
      setSelectedIds((prev) => {
        const next = prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
        setSelectedId(next.at(-1) || null)
        return next
      })
      return
    }
    if (!selectedIdSet.has(item.id)) {
      setSelectedId(item.id)
      setSelectedIds([item.id])
    }
    if (isTextEditable(item) && e.detail >= 2) { startTextEditingRef.current(item.id); return }
    const tag = (e.target as HTMLElement).tagName
    const isInteractiveTarget = tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON'
    if (isTextEditable(item) && editingId === item.id && isInteractiveTarget) return
    if (isTextEditable(item) && editingId !== item.id) { e.preventDefault(); setEditingId(null) }
    if (!canEdit || isPath(item) || isConnector(item) || isLockedByOther(item.id)) return

    const wp = toWorld(e.clientX, e.clientY)
    const posItem = isPositioned(item) ? item : null
    pendingDragRef.current = {
      id: item.id,
      offsetX: posItem ? wp.x - posItem.x : 0,
      offsetY: posItem ? wp.y - posItem.y : 0,
      startX: e.clientX,
      startY: e.clientY,
    }
  }

  const onContainerPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pinchRef.current) return
    activePointerIdRef.current = e.pointerId
    e.currentTarget.setPointerCapture(e.pointerId)
    if (spaceHeldRef.current || tool === 'hand' || e.button === 1 || e.pointerType === 'touch' && tool === 'select') {
      e.preventDefault()
      panningRef.current = { startMouseX: e.clientX, startMouseY: e.clientY, startPanX: panRef.current.x, startPanY: panRef.current.y }
      setIsPanning(true)
      return
    }
    if (!canEdit) return
    if (tool === 'select') {
      const wp = toWorld(e.clientX, e.clientY)
      marqueeRef.current = { start: wp, current: wp, additive: e.shiftKey || e.ctrlKey || e.metaKey }
      setEditingId(null)
      const marquee = marqueeElementRef.current
      if (marquee) {
        marquee.style.display = 'block'
        marquee.style.transform = `translate3d(${wp.x}px, ${wp.y}px, 0)`
        marquee.style.width = '0px'
        marquee.style.height = '0px'
      }
      return
    }
    if (tool === 'pen') {
      beginInteraction()
      const wp = toWorld(e.clientX, e.clientY)
      drawingRef.current = { points: [wp] }
      setPreviewPoints([wp])
      return
    }
    // Drag-to-create for shape/content tools
    if (tool !== 'connector') {
      const wp = toWorld(e.clientX, e.clientY)
      dragCreateRef.current = { tool, startX: wp.x, startY: wp.y, currentX: wp.x, currentY: wp.y }
      setPreviewCreate({ x: wp.x, y: wp.y, w: 20, h: 20 })
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [first, second] = Array.from(pointersRef.current.values())
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchRef.current.startZoom * distance / pinchRef.current.startDistance))
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        const localMid = { x: midpoint.x - rect.left, y: midpoint.y - rect.top }
        const nextPan = { x: localMid.x - pinchRef.current.worldX * nextZoom, y: localMid.y - pinchRef.current.worldY * nextZoom }
        zoomRef.current = nextZoom
        panRef.current = nextPan
        paintViewport(nextPan, nextZoom)
      }
      return
    }
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return
    // Panning
    if (panningRef.current) {
      const { startMouseX, startMouseY, startPanX, startPanY } = panningRef.current
      const nextPan = { x: startPanX + (e.clientX - startMouseX), y: startPanY + (e.clientY - startMouseY) }
      panRef.current = nextPan
      if (!panRafRef.current) {
        panRafRef.current = window.requestAnimationFrame(() => {
          panRafRef.current = null
          paintViewport()
        })
      }
      return
    }

    const wp = toWorld(e.clientX, e.clientY)

    if (marqueeRef.current) {
      marqueeRef.current.current = wp
      const { start } = marqueeRef.current
      const x = Math.min(start.x, wp.x)
      const y = Math.min(start.y, wp.y)
      const width = Math.abs(wp.x - start.x)
      const height = Math.abs(wp.y - start.y)
      const marquee = marqueeElementRef.current
      if (marquee) {
        marquee.style.transform = `translate3d(${x}px, ${y}px, 0)`
        marquee.style.width = `${width}px`
        marquee.style.height = `${height}px`
      }
      return
    }

    // Connector drag preview
    if (connectorDrag) {
      if (connectorPreviewRef.current) {
        const from = itemById.get(connectorDrag.fromId)
        if (from && isPositioned(from)) {
          const p1 = getAnchorPoint(from, connectorDrag.fromAnchor)
          const d1 = anchorDirection(connectorDrag.fromAnchor)
          const curve = Math.max(36, Math.min(180, Math.hypot(wp.x - p1.x, wp.y - p1.y) * 0.35))
          const targetAnchor: Anchor = Math.abs(wp.x - p1.x) > Math.abs(wp.y - p1.y) ? (wp.x >= p1.x ? 'left' : 'right') : wp.y >= p1.y ? 'top' : 'bottom'
          const d2 = anchorDirection(targetAnchor)
          connectorPreviewRef.current.setAttribute('d', `M ${p1.x} ${p1.y} C ${p1.x + d1.x * curve} ${p1.y + d1.y * curve}, ${wp.x + d2.x * curve} ${wp.y + d2.y * curve}, ${wp.x} ${wp.y}`)
        }
      }
      connectorDrag.toPoint = wp
      return
    }

    // Pen drawing (RAF throttled)
    if (drawingRef.current && tool === 'pen' && canEdit) {
      const samples = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent]
      for (const sample of samples) {
        const point = toWorld(sample.clientX, sample.clientY)
        const previous = drawingRef.current.points[drawingRef.current.points.length - 1]
        if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 1.25 / zoomRef.current) drawingRef.current.points.push(point)
      }
      if (!rafDrawRef.current) {
        rafDrawRef.current = window.requestAnimationFrame(() => {
          rafDrawRef.current = null
          const points = drawingRef.current?.points || []
          previewPathRef.current?.setAttribute('d', points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' '))
        })
      }
      return
    }

    // Drag-to-create preview (RAF throttled)
    if (dragCreateRef.current && canEdit) {
      const dc = dragCreateRef.current
      dc.currentX = wp.x
      dc.currentY = wp.y
      if (!dragRafRef.current) {
        dragRafRef.current = window.requestAnimationFrame(() => {
          dragRafRef.current = null
          const dc = dragCreateRef.current
          if (!dc) { setPreviewCreate(null); return }
          const x = Math.min(dc.startX, dc.currentX)
          const y = Math.min(dc.startY, dc.currentY)
          const w = Math.abs(dc.currentX - dc.startX)
          const h = Math.abs(dc.currentY - dc.startY)
          const preview = createPreviewRef.current
          if (preview && (w > 6 || h > 6)) {
            preview.style.transform = `translate3d(${x}px, ${y}px, 0)`
            preview.style.width = `${Math.max(w, 20)}px`
            preview.style.height = `${Math.max(h, 20)}px`
          }
        })
      }
      return
    }

    // Promote pendingDrag → active drag once threshold crossed
    if (!draggingRef.current && pendingDragRef.current && canEdit) {
      const candidate = pendingDragRef.current
      const moved = Math.hypot(e.clientX - candidate.startX, e.clientY - candidate.startY)
      if (moved > 2) {
        beginInteraction()
        const target = itemById.get(candidate.id)
        if (!target || !isPositioned(target)) { pendingDragRef.current = null; return }
        containerRef.current?.setPointerCapture(e.pointerId)
        const selectedRoots = selectedIdSet.has(candidate.id) ? selectedIds : [candidate.id]
        const movingIds = new Set<string>()
        selectedRoots.filter((id) => !isLockedByOther(id)).forEach((id) => {
          movingIds.add(id)
          const selected = itemById.get(id)
          if (selected && isFrame(selected)) collectFrameDescendants(canvasDoc.items, id).forEach((childId) => movingIds.add(childId))
        })
        const origins: Record<string, Point> = {}
        movingIds.forEach((id) => {
          const movingItem = itemById.get(id)
          if (movingItem && isPositioned(movingItem)) origins[id] = { x: movingItem.x, y: movingItem.y }
        })
        const childIds = Object.keys(origins).filter((id) => id !== candidate.id)
        Object.keys(origins).forEach(emitLock)
        draggingRef.current = { id: candidate.id, offsetX: candidate.offsetX, offsetY: candidate.offsetY, originX: target.x, originY: target.y, childIds, origins }
        pendingDragRef.current = null
      }
    }

    // Resize (RAF throttled) — store pending size in ref, apply in RAF
    if (resizingRef.current && canEdit) {
      const resize = resizingRef.current
      resize.pendingW = Math.max(80, resize.startW + (e.clientX - resize.startX) / zoomRef.current)
      resize.pendingH = Math.max(60, resize.startH + (e.clientY - resize.startY) / zoomRef.current)
      if (!resizeRafRef.current) {
        resizeRafRef.current = window.requestAnimationFrame(() => {
          resizeRafRef.current = null
          const r = resizingRef.current
          if (!r || r.pendingW === undefined) return
          const element = itemRefs.current[r.id]
          if (element) {
            element.style.width = `${r.pendingW}px`
            element.style.height = `${r.pendingH}px`
          }
          emitTransientTransform(r.id, { w: r.pendingW, h: r.pendingH })
        })
      }
      return
    }

    // Drag (RAF throttled) — store pending position in ref, apply in RAF
    if (draggingRef.current && canEdit) {
      const drag = draggingRef.current
      drag.pendingX = wp.x
      drag.pendingY = wp.y
      if (!dragRafRef.current) {
        dragRafRef.current = window.requestAnimationFrame(() => {
          dragRafRef.current = null
          const drag = draggingRef.current
          if (!drag || drag.pendingX === undefined || drag.pendingY === undefined) return
          const nx = drag.pendingX - drag.offsetX
          const ny = drag.pendingY - drag.offsetY
          const dx = nx - drag.originX
          const dy = ny - drag.originY
          ;[drag.id, ...drag.childIds].forEach((id) => {
            const element = itemRefs.current[id]
            if (element) element.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
          })
          emitTransientTransforms(Object.entries(drag.origins).map(([itemId, origin]) => ({
            itemId,
            transform: { x: origin.x + dx, y: origin.y + dy },
          })))
        })
      }
    }
  }

  const onPointerUp = (e?: ReactPointerEvent<HTMLDivElement>) => {
    if (e) pointersRef.current.delete(e.pointerId)
    if (pinchRef.current) {
      if (pointersRef.current.size < 2) {
        pinchRef.current = null
        activePointerIdRef.current = null
        setZoom(zoomRef.current)
        setPan(panRef.current)
        if (remoteWhileInteractingRef.current) {
          remoteWhileInteractingRef.current = null
          void fetchRemoteCanvas()
        }
      }
      if (e && e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      return
    }
    if (e && activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return
    if (e && e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    activePointerIdRef.current = null
    // Cancel any pending RAF updates
    if (dragRafRef.current) { window.cancelAnimationFrame(dragRafRef.current); dragRafRef.current = null }
    if (resizeRafRef.current) { window.cancelAnimationFrame(resizeRafRef.current); resizeRafRef.current = null }

    if (panningRef.current) {
      panningRef.current = null
      if (panRafRef.current) { window.cancelAnimationFrame(panRafRef.current); panRafRef.current = null; paintViewport() }
      setPan(panRef.current)
      setIsPanning(false)
      return
    }

    if (marqueeRef.current) {
      const { start, current, additive } = marqueeRef.current
      marqueeRef.current = null
      if (marqueeElementRef.current) marqueeElementRef.current.style.display = 'none'
      const left = Math.min(start.x, current.x)
      const right = Math.max(start.x, current.x)
      const top = Math.min(start.y, current.y)
      const bottom = Math.max(start.y, current.y)
      const isDragSelection = Math.hypot(right - left, bottom - top) * zoomRef.current > 3
      const hits = isDragSelection
        ? positionedItems.filter((item) => item.x < right && item.x + item.w > left && item.y < bottom && item.y + item.h > top).map((item) => item.id)
        : []
      const next = additive ? Array.from(new Set([...selectedIds, ...hits])) : hits
      setSelectedIds(next)
      setSelectedId(next.at(-1) || null)
      setEditingId(null)
      return
    }

    if (connectorDrag) {
      let target = connectorDrag.hoverTarget
      if (!target && e) {
        const releasePoint = toWorld(e.clientX, e.clientY)
        let nearest: { id: string; anchor: Anchor; distance: number } | null = null
        for (const item of positionedItems) {
          if (item.id === connectorDrag.fromId) continue
          for (const anchor of ANCHORS) {
            const point = getAnchorPoint(item, anchor)
            const distance = Math.hypot(point.x - releasePoint.x, point.y - releasePoint.y)
            if (distance <= 32 / zoomRef.current && (!nearest || distance < nearest.distance)) nearest = { id: item.id, anchor, distance }
          }
        }
        const nearestTarget = nearest as { id: string; anchor: Anchor; distance: number } | null
        if (nearestTarget) target = { id: nearestTarget.id, anchor: nearestTarget.anchor }
      }
      if (target && target.id !== connectorDrag.fromId) {
        beginInteraction()
        const connector: CanvasItem = {
          id: mkId(), type: 'connector',
          fromId: connectorDrag.fromId, fromAnchor: connectorDrag.fromAnchor,
          toId: target.id, toAnchor: target.anchor,
          color: '#334155', width: 2,
        }
        setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, connector] }))
        setSelectedId(connector.id)
        setSelectedIds([connector.id])
        endInteraction()
      }
      setConnectorDrag(null)
      pendingDragRef.current = null
      return
    }

    // Finalize drag-to-create
    if (dragCreateRef.current && canEdit) {
      const dc = dragCreateRef.current
      dragCreateRef.current = null
      setPreviewCreate(null)
      const dragW = Math.abs(dc.currentX - dc.startX)
      const dragH = Math.abs(dc.currentY - dc.startY)
      const MIN_DRAG = 15
      const [dw, dh] = DEFAULT_ITEM_SIZES[dc.tool] ?? [220, 160]
      let itemX: number, itemY: number, itemW: number, itemH: number
      if (dragW > MIN_DRAG || dragH > MIN_DRAG) {
        itemX = Math.min(dc.startX, dc.currentX)
        itemY = Math.min(dc.startY, dc.currentY)
        itemW = Math.max(dragW, 80)
        itemH = Math.max(dragH, 60)
      } else {
        itemX = dc.startX - dw / 2
        itemY = dc.startY - dh / 2
        itemW = dw; itemH = dh
      }
      const item = createItemAtBounds(dc.tool, itemX, itemY, itemW, itemH)
      if (item) {
        beginInteraction()
        setCanvasDoc((prev) => {
          const parentFrameId = getParentFrameId(item, prev.items)
          return { ...prev, items: [...prev.items, { ...item, parentFrameId }] }
        })
        setSelectedId(item.id)
        setSelectedIds([item.id])
        if (isTextEditable(item)) startTextEditingRef.current(item.id)
        else setEditingId(null)
        setTool('select')
        endInteraction()
      }
      return
    }

    const completedDrag = draggingRef.current
    const completedResize = resizingRef.current
    const dragId = completedDrag?.id
    const resizedId = completedResize?.id
    const clickedItemId = pendingDragRef.current?.id ?? null
    draggingRef.current = null
    resizingRef.current = null
    pendingDragRef.current = null

    let didMutate = false
    if (drawingRef.current && canEdit && drawingRef.current.points.length > 1) {
      didMutate = true
      const path: CanvasItem = { id: mkId(), type: 'path', points: simplifyPoints(drawingRef.current.points, 1.5 / zoomRef.current), color: strokeColor, width: strokeWidth }
      setCanvasDoc((prev) => {
        const parentFrame = prev.items.filter(isFrame).find((frame) => {
          const pts = (path as any).points as Point[]
          return pts.length > 0 && pts.every((p) => p.x >= frame.x && p.x <= frame.x + frame.w && p.y >= frame.y && p.y <= frame.y + frame.h)
        })
        return { ...prev, items: [...prev.items, parentFrame ? { ...path, parentFrameId: parentFrame.id } : path] }
      })
    }
    drawingRef.current = null
    setPreviewPoints([])
    if (rafDrawRef.current) { window.cancelAnimationFrame(rafDrawRef.current); rafDrawRef.current = null }

    // After drag ends, recompute parentFrameId with final positions
    if (dragId && completedDrag?.pendingX !== undefined && completedDrag.pendingY !== undefined) {
      ;[dragId, ...completedDrag.childIds].forEach(emitUnlock)
      didMutate = true
      const nx = completedDrag.pendingX - completedDrag.offsetX
      const ny = completedDrag.pendingY - completedDrag.offsetY
      const dx = nx - completedDrag.originX
      const dy = ny - completedDrag.originY
      const movedIds = new Set(Object.keys(completedDrag.origins))
      setCanvasDoc((prev) => {
        const moved = prev.items.map((item) => {
          const origin = completedDrag.origins[item.id]
          return origin && isPositioned(item) ? { ...item, x: origin.x + dx, y: origin.y + dy } as CanvasItem : item
        })
        return { ...prev, items: moved.map((item) => {
          if (!isPositioned(item)) return item
          if (!movedIds.has(item.id)) return item
          return { ...item, parentFrameId: getParentFrameId(item, moved, isFrame(item) ? item.id : undefined) } as CanvasItem
        }) }
      })
      window.requestAnimationFrame(() => [dragId, ...completedDrag.childIds].forEach((id) => { const element = itemRefs.current[id]; if (element) element.style.transform = '' }))
    }
    if (resizedId && resizedId !== dragId && completedResize?.pendingW !== undefined && completedResize.pendingH !== undefined) {
      emitUnlock(resizedId)
      didMutate = true
      setCanvasDoc((prev) => ({ ...prev, items: prev.items.map((item) => item.id === resizedId && isPositioned(item) ? { ...item, w: completedResize.pendingW!, h: completedResize.pendingH! } as CanvasItem : item) }))
    }
    if (didMutate) endInteraction()
    if (clickedItemId) {
      const clickedItem = itemById.get(clickedItemId)
      if (clickedItem && isTextEditable(clickedItem)) startTextEditingRef.current(clickedItemId)
      else setEditingId(null)
    }
  }

  const onPointerDownCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointersRef.current.size !== 2) return
    containerRef.current?.setPointerCapture(e.pointerId)
    const [first, second] = Array.from(pointersRef.current.values())
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    if (draggingRef.current) {
      emitUnlock(draggingRef.current.id)
      ;[draggingRef.current.id, ...draggingRef.current.childIds].forEach((id) => { const element = itemRefs.current[id]; if (element) element.style.transform = '' })
    }
    if (resizingRef.current) {
      emitUnlock(resizingRef.current.id)
      const element = itemRefs.current[resizingRef.current.id]
      if (element) { element.style.width = `${resizingRef.current.startW}px`; element.style.height = `${resizingRef.current.startH}px` }
    }
    draggingRef.current = null
    pendingDragRef.current = null
    resizingRef.current = null
    panningRef.current = null
    drawingRef.current = null
    dragCreateRef.current = null
    marqueeRef.current = null
    if (marqueeElementRef.current) marqueeElementRef.current.style.display = 'none'
    setPreviewPoints([])
    setPreviewCreate(null)
    setIsPanning(false)
    isInteractingRef.current = false

    const localMid = { x: midpoint.x - rect.left, y: midpoint.y - rect.top }
    pinchRef.current = {
      startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      worldX: (localMid.x - panRef.current.x) / zoomRef.current,
      worldY: (localMid.y - panRef.current.y) / zoomRef.current,
      startZoom: zoomRef.current,
    }
    activePointerIdRef.current = null
  }

  // Native (non-passive) wheel listener — React 17+ registers wheel as passive by default,
  // which silently swallows preventDefault() and causes a render loop on every scroll event.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onNativeWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        applyZoom(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - rect.left, e.clientY - rect.top)
      } else {
        const nextPan = { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY }
        panRef.current = nextPan
        paintViewport(nextPan, zoomRef.current)
        if (viewportCommitTimerRef.current) window.clearTimeout(viewportCommitTimerRef.current)
        viewportCommitTimerRef.current = window.setTimeout(() => setPan(panRef.current), 80)
      }
    }
    el.addEventListener('wheel', onNativeWheel, { passive: false })
    return () => el.removeEventListener('wheel', onNativeWheel)
  }, [applyZoom, paintViewport])

  // ─── Drop handler ─────────────────────────────────────────────────────────

  const uploadImage = async (file: File): Promise<string> => {
    if (!sessionId) throw new Error('Sessione richiesta per caricare immagini')
    const res = await chatApi.uploadFiles(sessionId, [file])
    const url = res.data?.urls?.[0]
    if (!url) throw new Error('Upload immagine non riuscito')
    return String(url)
  }

  const handleDropFiles = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!canEdit) return
    e.preventDefault()
    setIsDropActive(false)
    const files = Array.from(e.dataTransfer.files || [])
    const uriListRaw = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    const uriCandidates = uriListRaw.split(/\s+/).map((p) => p.trim()).filter((p) => p && !p.startsWith('#') && looksLikeImageUrl(p))
    const htmlRaw = e.dataTransfer.getData('text/html')
    const htmlCandidates = htmlRaw ? extractImageUrlsFromHtml(htmlRaw) : []
    const droppedImageUrls = Array.from(new Set([...uriCandidates, ...htmlCandidates])).filter(looksLikeImageUrl)
    if (files.length === 0 && droppedImageUrls.length === 0) return

    beginInteraction()
    const wp = toWorld(e.clientX, e.clientY)
    let ox = wp.x, oy = wp.y

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        try {
          const imageUrl = await uploadImage(file)
          const img: CanvasItem = { id: mkId(), type: 'image', x: ox, y: oy, w: 320, h: 220, src: imageUrl }
          setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, { ...img, parentFrameId: getParentFrameId(img, prev.items) }] }))
          oy += 30
        } catch (err) { console.error(err) }
        continue
      }
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.csv') || lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        const dataBuffer = await file.arrayBuffer()
        const workbook = XLSX.read(dataBuffer, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as Array<Array<string | number | boolean | null>>
        const normalized = toCsvTable(rows).slice(0, 20).map((row) => row.slice(0, 8))
        const tableItem: CanvasItem = { id: mkId(), type: 'table', x: ox, y: oy, w: 440, h: 280, data: normalized.length ? normalized : [['']] }
        setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, { ...tableItem, parentFrameId: getParentFrameId(tableItem, prev.items) }] }))
        oy += 34
      }
    }

    for (const src of droppedImageUrls) {
      const img: CanvasItem = { id: mkId(), type: 'image', x: ox, y: oy, w: 320, h: 220, src }
      setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, { ...img, parentFrameId: getParentFrameId(img, prev.items) }] }))
      oy += 30
    }

    endInteraction()
  }

  // ─── SVG renderers ────────────────────────────────────────────────────────

  const renderPath = (item: Extract<CanvasItem, { type: 'path' }>) => {
    const d = item.points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    return <path key={item.id} d={d} stroke={item.color} strokeWidth={item.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  }

  const renderConnector = (item: Extract<CanvasItem, { type: 'connector' }>) => {
    const from = itemById.get(item.fromId)
    const to = itemById.get(item.toId)
    if (!from || !to || !isPositioned(from) || !isPositioned(to)) return null
    const p1 = getAnchorPoint(from, item.fromAnchor)
    const p2 = getAnchorPoint(to, item.toAnchor)
    const d1 = anchorDirection(item.fromAnchor)
    const d2 = anchorDirection(item.toAnchor)
    const curve = Math.max(36, Math.min(180, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.35))
    const c1 = { x: p1.x + d1.x * curve, y: p1.y + d1.y * curve }
    const c2 = { x: p2.x + d2.x * curve, y: p2.y + d2.y * curve }
    return (
      <path
        key={item.id}
        d={`M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`}
        stroke={item.color} strokeWidth={item.width} fill="none" strokeLinecap="round" strokeLinejoin="round"
        markerEnd="url(#canvas-arrow)"
      />
    )
  }

  const renderConnectorPreview = () => {
    if (!connectorDrag) return null
    const from = itemById.get(connectorDrag.fromId)
    if (!from || !isPositioned(from)) return null
    const p1 = getAnchorPoint(from, connectorDrag.fromAnchor)
    const p2 = connectorDrag.hoverTarget
      ? (() => { const t = itemById.get(connectorDrag.hoverTarget?.id || ''); return t && isPositioned(t) ? getAnchorPoint(t, connectorDrag.hoverTarget!.anchor) : connectorDrag.toPoint })()
      : connectorDrag.toPoint
    const d1 = anchorDirection(connectorDrag.fromAnchor)
    const tAnchor: Anchor = connectorDrag.hoverTarget?.anchor || (Math.abs(p2.x - p1.x) > Math.abs(p2.y - p1.y) ? (p2.x >= p1.x ? 'left' : 'right') : p2.y >= p1.y ? 'top' : 'bottom')
    const d2 = anchorDirection(tAnchor)
    const curve = Math.max(36, Math.min(180, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.35))
    const c1 = { x: p1.x + d1.x * curve, y: p1.y + d1.y * curve }
    const c2 = { x: p2.x + d2.x * curve, y: p2.y + d2.y * curve }
    return <path ref={connectorPreviewRef} d={`M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`} stroke="#3ea9f4" strokeWidth={2.5} strokeDasharray="6 4" fill="none" markerEnd="url(#canvas-arrow)" />
  }

  // ─── Cursor ──────────────────────────────────────────────────────────────

  const cursor = isPanning
    ? 'grabbing'
    : (spaceHeldRef.current || tool === 'hand') ? 'grab'
    : tool === 'pen' ? 'crosshair'
    : (tool === 'select' || tool === 'connector') ? 'default'
    : 'crosshair'  // shape/content creation tools

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className={`flex flex-col overflow-hidden border border-slate-200 bg-white shadow-sm ${
        isFullscreen ? 'fixed inset-0 z-[9999] rounded-none' : 'h-[calc(100vh-170px)] rounded-xl'
      }`}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-200 bg-white px-2 py-1.5">
        {/* Title */}
        <Input
          value={title}
          onChange={(e) => onTitleChange?.(e.target.value)}
          className="h-7 w-52 border-transparent text-sm shadow-none focus:border-slate-300"
          placeholder="Titolo lavagna"
          disabled={!canEdit}
        />

        <div className="mx-1 h-5 w-px bg-slate-200" />

        {/* Undo / Redo */}
        <button
          type="button"
          title="Annulla (Ctrl+Z)"
          onClick={undo}
          disabled={historyIndex <= 0}
          className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="Ripristina (Ctrl+Y)"
          onClick={redo}
          disabled={historyIndex >= historyRef.current.length - 1}
          className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </button>

        <div className="flex-1" />

        {/* Zoom controls */}
        <div className="flex items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 px-1">
          <button type="button" onClick={zoomOut} className="flex h-6 w-6 items-center justify-center rounded text-xs text-slate-500 hover:bg-white">−</button>
          <span className="w-12 text-center text-xs text-slate-600 tabular-nums">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={zoomIn} className="flex h-6 w-6 items-center justify-center rounded text-xs text-slate-500 hover:bg-white">+</button>
          <button type="button" onClick={fitToScreen} title="Adatta alla schermata" className="flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-white">
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mx-1 h-5 w-px bg-slate-200" />

        {/* Teacher-only actions */}
        {role === 'teacher' && (
          <>
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" onClick={() => setShowTemplates(true)}>
              <LayoutTemplate className="h-3.5 w-3.5" /> Template
            </Button>
            {/* Inline student write toggle — always visible for teacher */}
            <button
              type="button"
              title={studentsCanWrite ? 'Studenti possono modificare — clicca per disabilitare' : 'Clicca per permettere agli studenti di modificare'}
              onClick={toggleStudentsCanWrite}
              className={`flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-all ${
                studentsCanWrite
                  ? 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100'
                  : 'border-slate-200 text-slate-500 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{studentsCanWrite ? 'Studenti ON' : 'Studenti'}</span>
              <span
                className={`flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${studentsCanWrite ? 'bg-green-500' : 'bg-slate-300'}`}
              >
                <span className={`mx-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${studentsCanWrite ? 'translate-x-3' : 'translate-x-0'}`} />
              </span>
            </button>
          </>
        )}

        {/* Fullscreen */}
        <button
          type="button"
          title={isFullscreen ? 'Esci da schermo intero' : 'Schermo intero'}
          onClick={() => setIsFullscreen((v) => !v)}
          className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100"
        >
          {isFullscreen ? <Minimize className="h-3.5 w-3.5" /> : <Maximize className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* ── Context property bar — always visible ───────────────────────── */}
      <div className={`flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1 text-xs transition-opacity duration-100 ${!selectedItem ? 'opacity-40 pointer-events-none' : ''}`} style={{ minHeight: 34 }}>
        {selectedItem ? (<>
          {isShape(selectedItem) && (
            <>
              <span className="text-slate-500">Forma</span>
              <div className="flex items-center gap-1">
                <span className="text-slate-400">Fill</span>
                <Input type="color" value={selectedItem.fill} onChange={(e) => updateItem(selectedItem.id, { fill: e.target.value })} className="h-6 w-8 cursor-pointer border-slate-200 p-0.5" disabled={!canEdit || isLockedByOther(selectedItem.id)} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-slate-400">Bordo</span>
                <Input type="color" value={selectedItem.stroke} onChange={(e) => updateItem(selectedItem.id, { stroke: e.target.value })} className="h-6 w-8 cursor-pointer border-slate-200 p-0.5" disabled={!canEdit || isLockedByOther(selectedItem.id)} />
              </div>
            </>
          )}
          {isConnector(selectedItem) && (
            <>
              <span className="text-slate-500">Connettore</span>
              <Input type="color" value={selectedItem.color} onChange={(e) => updateItem(selectedItem.id, { color: e.target.value })} className="h-6 w-8 cursor-pointer border-slate-200 p-0.5" disabled={!canEdit} />
              <Input type="number" min={1} max={8} value={selectedItem.width} onChange={(e) => updateItem(selectedItem.id, { width: Math.max(1, Math.min(8, Number(e.target.value || 2))) })} className="h-6 w-12 border-slate-200 px-1" disabled={!canEdit} />
            </>
          )}
          {selectedTextStyle && isTextEditable(selectedItem) && (
            <>
              <span className="text-slate-500">Testo</span>
              <select className="h-6 rounded border border-slate-200 bg-white px-1 text-xs" value={selectedTextStyle.fontFamily} onChange={(e) => updateItem(selectedItem.id, { textStyle: { ...selectedTextStyle, fontFamily: e.target.value } })} disabled={!canEdit || isLockedByOther(selectedItem.id)}>
                <option value="Inter, system-ui, sans-serif">Inter</option>
                <option value="Arial, sans-serif">Arial</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="'Courier New', monospace">Courier</option>
              </select>
              <Input type="number" min={10} max={48} value={selectedTextStyle.fontSize} onChange={(e) => updateItem(selectedItem.id, { textStyle: { ...selectedTextStyle, fontSize: Math.max(10, Math.min(48, Number(e.target.value || 14))) } })} className="h-6 w-14 border-slate-200 px-1 text-xs" disabled={!canEdit || isLockedByOther(selectedItem.id)} />
              <button type="button" onClick={() => updateItem(selectedItem.id, { textStyle: { ...selectedTextStyle, fontWeight: selectedTextStyle.fontWeight === '600' ? 'normal' : '600' } })} className={`h-6 w-6 rounded border text-xs font-bold ${selectedTextStyle.fontWeight === '600' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white'}`} disabled={!canEdit || isLockedByOther(selectedItem.id)}>B</button>
              <button type="button" onClick={() => updateItem(selectedItem.id, { textStyle: { ...selectedTextStyle, fontStyle: selectedTextStyle.fontStyle === 'italic' ? 'normal' : 'italic' } })} className={`h-6 w-6 rounded border text-xs italic ${selectedTextStyle.fontStyle === 'italic' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white'}`} disabled={!canEdit || isLockedByOther(selectedItem.id)}>I</button>
              {selectedItem.type === 'postit' && (
                <div className="flex gap-1">
                  {POSTIT_PALETTE.map((c) => (
                    <button key={c} type="button" onClick={() => updateItem(selectedItem.id, { color: c })} className={`h-5 w-5 rounded border-2 ${selectedItem.color === c ? 'border-slate-800 scale-110' : 'border-transparent'}`} style={{ background: c }} />
                  ))}
                </div>
              )}
            </>
          )}
          {canEdit && (
            <button type="button" onClick={deleteSelected} className="ml-auto flex h-6 items-center gap-1 rounded px-2 text-red-500 hover:bg-red-50">
              <Trash2 className="h-3.5 w-3.5" /> Elimina
            </button>
          )}
        </>) : (
          <span className="text-[11px] text-slate-400 select-none">Seleziona un elemento per vedere le proprietà</span>
        )}
      </div>

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Left tool panel */}
        {canEdit && (
          <div className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-slate-200 bg-white py-2">
            <ToolButton activeTool={tool} t="select" icon={MousePointer} label="Seleziona (V)" onSetTool={setTool} />
            <ToolButton activeTool={tool} t="hand" icon={Move} label="Muovi canvas (H)" onSetTool={setTool} />
            <div className="my-0.5 h-px w-7 bg-slate-200" />
            <ToolButton activeTool={tool} t="postit" icon={StickyNote} label="Post-it — trascina per dimensionare (P)" onSetTool={setTool} />
            <ToolButton activeTool={tool} t="frame" icon={Frame} label="Frame — trascina per dimensionare (F)" onSetTool={setTool} />
            <ToolButton activeTool={tool} t="text" icon={Type} label="Testo (T)" onSetTool={setTool} />
            <div className="my-0.5 h-px w-7 bg-slate-200" />
            <ToolButton activeTool={tool} t="roundedRect" icon={RectangleHorizontal} label="Rettangolo — trascina per dimensionare (R)" onSetTool={setTool} />
            <ToolButton activeTool={tool} t="triangle" icon={Triangle} label="Triangolo — trascina per dimensionare" onSetTool={setTool} />
            <div className="my-0.5 h-px w-7 bg-slate-200" />
            <ToolButton activeTool={tool} t="connector" icon={MoveRight} label="Connettore — trascina da un punto di ancoraggio (C)" onSetTool={setTool} />
            <ToolButton activeTool={tool} t="pen" icon={Pencil} label="Penna libera (D)" onSetTool={setTool} />
            <div className="my-0.5 h-px w-7 bg-slate-200" />
            <button type="button" title="Elimina selezionato (Del)" onClick={deleteSelected} disabled={!selectedId} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-30">
              <Eraser className="h-4 w-4" />
            </button>

            {/* Pen color/width (only when pen tool active) */}
            {tool === 'pen' && (
              <>
                <div className="my-0.5 h-px w-7 bg-slate-200" />
                <Input type="color" value={strokeColor} onChange={(e) => setStrokeColor(e.target.value)} className="h-7 w-7 cursor-pointer rounded border-slate-200 p-0.5" title="Colore penna" />
                <Input type="number" min={1} max={14} value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value || 3))} className="h-7 w-9 border-slate-200 px-1 text-center text-xs" title="Spessore" />
              </>
            )}

            {/* Post-it color (when postit tool active) */}
            {tool === 'postit' && (
              <>
                <div className="my-0.5 h-px w-7 bg-slate-200" />
                {POSTIT_PALETTE.slice(0, 4).map((c) => (
                  <button key={c} type="button" onClick={() => setNewPostitColor(c)} className={`mb-0.5 h-6 w-6 rounded border-2 ${newPostitColor === c ? 'border-slate-700' : 'border-transparent'}`} style={{ background: c }} />
                ))}
              </>
            )}

            {/* Shape color (when shape tool active) */}
            {(tool === 'roundedRect' || tool === 'triangle') && (
              <>
                <div className="my-0.5 h-px w-7 bg-slate-200" />
                <Input type="color" value={newShapeFill} onChange={(e) => setNewShapeFill(e.target.value)} className="h-7 w-7 cursor-pointer rounded border-slate-200 p-0.5" title="Riempimento" />
                <Input type="color" value={newShapeStroke} onChange={(e) => setNewShapeStroke(e.target.value)} className="h-7 w-7 cursor-pointer rounded border-slate-200 p-0.5" title="Bordo" />
              </>
            )}
          </div>
        )}

        {/* Canvas container */}
        <div
          ref={containerRef}
          className="relative flex-1 overflow-hidden bg-slate-50"
          style={{
            cursor,
            touchAction: 'none',
            overscrollBehavior: 'none',
            backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(148,163,184,0.3) 1px, transparent 0)',
            backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
          onPointerDownCapture={onPointerDownCapture}
          onPointerDown={(e) => { closeContextMenu(); onContainerPointerDown(e) }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => openContextMenu(e, null)}
          onDragEnter={(e) => { e.preventDefault(); if (canEdit) setIsDropActive(true) }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDropActive(false) }}
          onDragOver={(e) => { e.preventDefault(); if (canEdit) { e.dataTransfer.dropEffect = 'copy'; setIsDropActive(true) } }}
          onDrop={handleDropFiles}
        >
          {/* World layer */}
          <div
            ref={worldRef}
            style={{
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              transformOrigin: '0 0',
              willChange: 'transform',
              position: 'absolute',
              width: 1,
              height: 1,
              overflow: 'visible',
            }}
          >
            {/* SVG: connectors & paths */}
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" style={{ width: 1, height: 1, overflow: 'visible' }}>
              <defs>
                <marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
                </marker>
              </defs>
              {connectorItems.map(renderConnector)}
              {pathItems.map(renderPath)}
              {renderConnectorPreview()}
              {previewPoints.length > 0 && (
                <path ref={previewPathRef} d="" stroke={strokeColor} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>

            {/* Painted directly during pointer movement to keep marquee selection smooth. */}
            <div
              ref={marqueeElementRef}
              className="pointer-events-none absolute hidden border border-blue-500 bg-blue-400/10"
              style={{ left: 0, top: 0, zIndex: 1_000_000 }}
            />

            {/* Drag-to-create ghost */}
            {previewCreate && (
              <div
                ref={createPreviewRef}
                className="pointer-events-none absolute rounded border-2 border-dashed border-blue-500 bg-blue-100/20"
                style={{ left: 0, top: 0, width: previewCreate.w, height: previewCreate.h, transform: `translate3d(${previewCreate.x}px, ${previewCreate.y}px, 0)` }}
              />
            )}

            {/* Items */}
            {positionedItems.map((item) => {
              const lockedByOther = isLockedByOther(item.id)
              const isEditing = editingId === item.id
              if (!isPositioned(item)) return null
              return (
                <div
                  key={item.id}
                  ref={(element) => { itemRefs.current[item.id] = element }}
                  data-canvas-x={item.x}
                  data-canvas-y={item.y}
                  className={`absolute ${selectedIdSet.has(item.id) ? 'ring-2 ring-blue-500 ring-offset-1' : ''} ${lockedByOther ? 'opacity-60' : ''}`}
                  style={{
                    left: item.x, top: item.y, width: item.w, height: item.h,
                    zIndex: itemZIndex.get(item.id) || 1,
                    willChange: draggingRef.current?.id === item.id ? 'transform' : undefined,
                  }}
                  onPointerDown={(e) => onPointerDownItem(e, item)}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => openContextMenu(e, item.id)}
                  onDoubleClick={() => {
                    if (!canEdit || lockedByOther) return
                    if (isTextEditable(item)) startTextEditingRef.current(item.id)
                  }}
                >
                  {item.type === 'postit' && (
                    <textarea
                      ref={(element) => { textEditorRefs.current[item.id] = element }}
                      value={item.text}
                      onFocus={() => emitLock(item.id)}
                      onBlur={() => emitUnlock(item.id)}
                      onChange={(e) => updateItem(item.id, { text: e.target.value })}
                      className="h-full w-full resize-none rounded-md p-2 text-sm shadow-sm"
                      style={{ background: item.color, fontFamily: item.textStyle?.fontFamily || DEFAULT_TEXT_STYLE.fontFamily, fontSize: `${item.textStyle?.fontSize || 14}px`, fontWeight: item.textStyle?.fontWeight || 'normal', fontStyle: item.textStyle?.fontStyle || 'normal', border: 'none', outline: 'none' }}
                      disabled={!canEdit || lockedByOther}
                      readOnly={!isEditing}
                      autoFocus={isEditing}
                      onBlurCapture={() => setEditingId((prev) => (prev === item.id ? null : prev))}
                    />
                  )}

                  {item.type === 'frame' && (
                    <div className="flex h-full w-full flex-col rounded-md border-2 border-dashed bg-white/60 backdrop-blur-sm" style={{ borderColor: item.color }}>
                      <input
                        ref={(element) => { textEditorRefs.current[item.id] = element }}
                        value={item.text}
                        onFocus={() => emitLock(item.id)}
                        onBlur={() => emitUnlock(item.id)}
                        onChange={(e) => updateItem(item.id, { text: e.target.value })}
                        className="w-full border-b border-dashed bg-transparent px-2 py-1 text-xs font-semibold"
                        style={{ borderColor: item.color, color: item.color, fontFamily: item.textStyle?.fontFamily || DEFAULT_TEXT_STYLE.fontFamily, fontSize: `${item.textStyle?.fontSize || 12}px`, fontWeight: item.textStyle?.fontWeight || '600', fontStyle: item.textStyle?.fontStyle || 'normal', outline: 'none' }}
                        disabled={!canEdit || lockedByOther}
                        readOnly={!isEditing}
                        autoFocus={isEditing}
                        onBlurCapture={() => setEditingId((prev) => (prev === item.id ? null : prev))}
                      />
                    </div>
                  )}

                  {item.type === 'text' && (
                    <textarea
                      ref={(element) => { textEditorRefs.current[item.id] = element }}
                      value={item.text}
                      onFocus={() => emitLock(item.id)}
                      onBlur={() => emitUnlock(item.id)}
                      onChange={(e) => updateItem(item.id, { text: e.target.value })}
                      className="h-full w-full resize-none rounded bg-transparent p-2 text-sm"
                      style={{ color: item.color, fontFamily: item.textStyle?.fontFamily || DEFAULT_TEXT_STYLE.fontFamily, fontSize: `${item.textStyle?.fontSize || 14}px`, fontWeight: item.textStyle?.fontWeight || 'normal', fontStyle: item.textStyle?.fontStyle || 'normal', border: 'none', outline: 'none' }}
                      disabled={!canEdit || lockedByOther}
                      readOnly={!isEditing}
                      autoFocus={isEditing}
                      onBlurCapture={() => setEditingId((prev) => (prev === item.id ? null : prev))}
                    />
                  )}

                  {item.type === 'shape' && (
                    <>
                      <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${item.w} ${item.h}`}>
                        {item.shape === 'rounded-rect' && <rect x="3" y="3" width={Math.max(item.w - 6, 1)} height={Math.max(item.h - 6, 1)} rx="16" ry="16" fill={item.fill} stroke={item.stroke} strokeWidth="2.5" />}
                        {item.shape === 'triangle' && <polygon points={`${item.w / 2},4 ${item.w - 4},${item.h - 4} 4,${item.h - 4}`} fill={item.fill} stroke={item.stroke} strokeWidth="2.5" />}
                        {item.shape === 'parallelogram' && <polygon points={`24,4 ${item.w - 4},4 ${item.w - 24},${item.h - 4} 4,${item.h - 4}`} fill={item.fill} stroke={item.stroke} strokeWidth="2.5" />}
                      </svg>
                      {canEdit && selectedIdSet.has(item.id) && ANCHORS.map((anchor) => {
                        const isSource = connectorDrag?.fromId === item.id && connectorDrag.fromAnchor === anchor
                        const isHoverTarget = connectorDrag?.hoverTarget?.id === item.id && connectorDrag.hoverTarget.anchor === anchor
                        const pointStyle: React.CSSProperties =
                          anchor === 'top' ? { left: '50%', top: 0, transform: 'translate(-50%,-50%)' } :
                          anchor === 'right' ? { right: 0, top: '50%', transform: 'translate(50%,-50%)' } :
                          anchor === 'bottom' ? { left: '50%', bottom: 0, transform: 'translate(-50%,50%)' } :
                          { left: 0, top: '50%', transform: 'translate(-50%,-50%)' }
                        return (
                          <button
                            key={`${item.id}-${anchor}`}
                            type="button"
                            className={`absolute h-4 w-4 rounded-full border shadow-sm ${isSource ? 'border-blue-600 bg-blue-500' : isHoverTarget ? 'border-blue-500 bg-blue-100' : 'border-blue-500 bg-white'}`}
                            style={pointStyle}
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              if (!canEdit) return
                              activePointerIdRef.current = e.pointerId
                              containerRef.current?.setPointerCapture(e.pointerId)
                              if (tool !== 'connector') setTool('connector')
                              setConnectorDrag({ fromId: item.id, fromAnchor: anchor, toPoint: getAnchorPoint(item, anchor) })
                            }}
                            onPointerEnter={() => setConnectorDrag((prev) => prev ? (prev.fromId === item.id && prev.fromAnchor === anchor ? prev : { ...prev, hoverTarget: { id: item.id, anchor } }) : prev)}
                            onPointerLeave={() => setConnectorDrag((prev) => prev?.hoverTarget?.id === item.id && prev.hoverTarget.anchor === anchor ? { ...prev, hoverTarget: undefined } : prev)}
                          />
                        )
                      })}
                    </>
                  )}

                  {item.type === 'image' && <img src={item.src} alt="" className="h-full w-full rounded-md object-cover shadow-sm" draggable={false} />}

                  {item.type === 'table' && (
                    <div className="h-full w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-sm">
                      <table className="min-w-full border-collapse text-xs">
                        <tbody>
                          {item.data.map((row, ri) => (
                            <tr key={`${item.id}-r${ri}`}>
                              {row.map((cell, ci) => <td key={`${item.id}-c${ri}-${ci}`} className="border border-slate-100 px-1 py-0.5">{cell}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Resize handle */}
                  {canEdit && !lockedByOther && selectedId === item.id && isPositioned(item) && (
                    <button
                      type="button"
                      className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-se-resize rounded-[2px] border border-white bg-slate-950 shadow-sm"
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        if (!isPositioned(item) || isLockedByOther(item.id)) return
                        activePointerIdRef.current = e.pointerId
                        containerRef.current?.setPointerCapture(e.pointerId)
                        beginInteraction(); emitLock(item.id)
                        draggingRef.current = null
                        resizingRef.current = { id: item.id, startX: e.clientX, startY: e.clientY, startW: item.w, startH: item.h }
                      }}
                      title="Ridimensiona"
                    />
                  )}

                  {/* Lock badge — teacher can force-unlock */}
                  {lockedByOther && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-md bg-slate-100/40">
                      {role === 'teacher' ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); forceUnlockItem(item.id) }}
                          className="rounded bg-amber-600/80 px-2 py-0.5 text-xs text-white hover:bg-amber-700/90"
                          title="Forza sblocco"
                        >
                          🔒 Sblocca
                        </button>
                      ) : (
                        <span className="pointer-events-none rounded bg-slate-700/70 px-1.5 py-0.5 text-xs text-white">In uso</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Drop overlay */}
          {isDropActive && canEdit && (
            <div className="pointer-events-none absolute inset-4 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-400 bg-blue-50/80">
              <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
                <ImagePlus className="h-4 w-4" />
                Rilascia immagini o file CSV/XLSX
                <Table className="h-4 w-4" />
              </div>
            </div>
          )}

          {/* Connector hint */}
          {tool === 'connector' && connectorDrag && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-slate-800/80 px-3 py-1 text-xs text-white">
              Trascina verso un punto di connessione
            </div>
          )}

          {/* Student banner — different messages depending on state */}
          {role === 'student' && !canEdit && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-1.5 text-xs text-slate-500 shadow-md backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              Solo visualizzazione · il docente non ha ancora abilitato le modifiche
            </div>
          )}
          {role === 'student' && canEdit && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border border-green-200 bg-green-50/95 px-4 py-1.5 text-xs text-green-700 shadow-md backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
              Modifica abilitata dal docente
            </div>
          )}

          {/* Connection status + zoom HUD */}
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${socketConnected ? 'bg-green-400' : 'bg-amber-400'}`} title={socketConnected ? 'Connesso in tempo reale' : 'Modalità polling'} />
            <span className="text-xs text-slate-400">{Math.round(zoom * 100)}%</span>
          </div>
        </div>
      </div>

      {/* ── Context menu ────────────────────────────────────────────────── */}
      {contextMenu && (
        <div
          className="fixed z-[200] min-w-[180px] rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
          style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {contextMenu.itemId ? (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Livello Z</div>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { reorderItem(contextMenu.itemId!, 'front'); closeContextMenu() }}>
                <span className="text-slate-400">⬆⬆</span> Porta in primo piano
              </button>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { reorderItem(contextMenu.itemId!, 'forward'); closeContextMenu() }}>
                <span className="text-slate-400">⬆</span> Porta avanti
              </button>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { reorderItem(contextMenu.itemId!, 'backward'); closeContextMenu() }}>
                <span className="text-slate-400">⬇</span> Manda indietro
              </button>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { reorderItem(contextMenu.itemId!, 'back'); closeContextMenu() }}>
                <span className="text-slate-400">⬇⬇</span> Manda in secondo piano
              </button>
              <div className="mx-2 my-1 h-px bg-slate-100" />
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Azioni</div>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { duplicateItem(contextMenu.itemId!); closeContextMenu() }}>
                <span className="text-slate-400">⧉</span> Duplica
              </button>
              {isLockedByOther(contextMenu.itemId) && role === 'teacher' && (
                <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50" onClick={() => { forceUnlockItem(contextMenu.itemId!); closeContextMenu() }}>
                  <span>🔓</span> Forza sblocco
                </button>
              )}
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50" onClick={() => { deleteItems([contextMenu.itemId!]); closeContextMenu() }}>
                <Trash2 className="h-3 w-3" /> Elimina
              </button>
            </>
          ) : (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Canvas</div>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { fitToScreen(); closeContextMenu() }}>
                <Maximize2 className="h-3.5 w-3.5 text-slate-400" /> Adatta alla schermata
              </button>
              {role === 'teacher' && (
                <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { setShowTemplates(true); closeContextMenu() }}>
                  <LayoutTemplate className="h-3.5 w-3.5 text-slate-400" /> Template
                </button>
              )}
            </>
          )}
        </div>
      )}
      {/* Click-outside overlay to close context menu */}
      {contextMenu && (
        <div className="fixed inset-0 z-[199]" onMouseDown={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu() }} />
      )}

      {/* ── Templates modal ─────────────────────────────────────────────── */}
      {showTemplates && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowTemplates(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b px-5 py-4">
              <h2 className="text-base font-semibold text-slate-800">Scegli un template</h2>
              <p className="text-sm text-slate-500">Il contenuto attuale della lavagna sarà sostituito.</p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3">
              {/* Blank */}
              <button
                type="button"
                onClick={() => applyTemplate(EMPTY_CANVAS)}
                className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-4 text-center transition-colors hover:border-slate-400 hover:bg-slate-50"
              >
                <span className="text-2xl">📄</span>
                <span className="text-sm font-medium text-slate-700">Lavagna vuota</span>
                <span className="text-xs text-slate-400">Inizia da zero</span>
              </button>
              {TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl.create())}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-slate-100 p-4 text-center transition-colors hover:border-blue-300 hover:bg-blue-50"
                >
                  <span className="text-2xl">{tpl.emoji}</span>
                  <span className="text-sm font-medium text-slate-700">{tpl.name}</span>
                  <span className="text-xs text-slate-400">{tpl.description}</span>
                </button>
              ))}
            </div>
            <div className="border-t px-5 py-3 text-right">
              <Button variant="ghost" size="sm" onClick={() => setShowTemplates(false)}>Annulla</Button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
