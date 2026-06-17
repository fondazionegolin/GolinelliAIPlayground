import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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

const WORLD_W = 5000
const WORLD_H = 4000
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

const moveFrameWithChildren = (items: CanvasItem[], frameId: string, nx: number, ny: number): CanvasItem[] => {
  const frame = items.find((i) => i.id === frameId)
  if (!frame || !isFrame(frame)) return items
  const dx = nx - frame.x, dy = ny - frame.y
  const descendants = new Set(collectFrameDescendants(items, frameId))
  return items.map((item) => {
    if (item.id === frameId) return { ...item, x: nx, y: ny }
    if (descendants.has(item.id)) {
      if (isPath(item)) return { ...item, points: item.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) }
      if (!isPositioned(item)) return item
      return { ...item, x: item.x + dx, y: item.y + dy } as CanvasItem
    }
    return item
  })
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
  const draggingRef = useRef<{ id: string; offsetX: number; offsetY: number; pendingX?: number; pendingY?: number } | null>(null)
  const pendingDragRef = useRef<{ id: string; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null)
  const resizingRef = useRef<{ id: string; startX: number; startY: number; startW: number; startH: number; pendingW?: number; pendingH?: number } | null>(null)
  const drawingRef = useRef<{ points: Point[] } | null>(null)
  const panningRef = useRef<{ startMouseX: number; startMouseY: number; startPanX: number; startPanY: number } | null>(null)
  const dragCreateRef = useRef<{ tool: Tool; startX: number; startY: number; currentX: number; currentY: number } | null>(null)
  const skipNextClickRef = useRef(false)
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
  const lockTimestampsRef = useRef<Record<string, number>>({})
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const undoRedoRef = useRef(false)
  const deleteSelectedRef = useRef<() => void>(() => { /* noop */ })
  const versionRef = useRef(0)

  // Canvas state
  const [tool, setTool] = useState<Tool>('select')
  const [strokeColor, setStrokeColor] = useState('#3ea9f4')
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [newPostitColor, setNewPostitColor] = useState('#fef9c3')
  const [newShapeFill, setNewShapeFill] = useState('#bae6fd')
  const [newShapeStroke, setNewShapeStroke] = useState('#0369a1')
  const [canvasDoc, setCanvasDoc] = useState<CanvasDoc>(() => parseCanvasDoc(initialContent))
  const [selectedId, setSelectedId] = useState<string | null>(null)
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
  const selectedItem = useMemo(
    () => (selectedId ? canvasDoc.items.find((i) => i.id === selectedId) || null : null),
    [canvasDoc.items, selectedId],
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

  // ─── Coordinate conversion ─────────────────────────────────────────────────

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    if (!containerRef.current) return { x: 0, y: 0 }
    const rect = containerRef.current.getBoundingClientRect()
    return { x: (clientX - rect.left - pan.x) / zoom, y: (clientY - rect.top - pan.y) / zoom }
  }, [pan, zoom])

  // ─── History ───────────────────────────────────────────────────────────────

  const pushHistory = useCallback(() => {
    if (undoRedoRef.current) return
    const state = latestSerializedRef.current
    const h = historyRef.current.slice(0, historyIndexRef.current + 1)
    h.push(state)
    if (h.length > 60) h.shift()
    historyRef.current = h
    historyIndexRef.current = h.length - 1
    setHistoryIndex(historyIndexRef.current)
  }, [])

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
    // push remote asynchronously
    if (sessionId && !readOnly && (role === 'teacher' || studentsCanWrite)) {
      void apiByRole[role].updateCanvas(sessionId, { title, content_json: state }).then((res) => {
        setVersion(Number(res.data?.version || 0))
        lastSerializedRef.current = state
      })
    }
  }, [role, sessionId, readOnly, studentsCanWrite, title])

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
    if (sessionId && !readOnly && (role === 'teacher' || studentsCanWrite)) {
      void apiByRole[role].updateCanvas(sessionId, { title, content_json: state }).then((res) => {
        setVersion(Number(res.data?.version || 0))
        lastSerializedRef.current = state
      })
    }
  }, [role, sessionId, readOnly, studentsCanWrite, title])

  // ─── Viewport ─────────────────────────────────────────────────────────────

  const applyZoom = useCallback((factor: number, originX?: number, originY?: number) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const ox = originX ?? rect.width / 2
    const oy = originY ?? rect.height / 2
    setZoom((prev) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev * factor))
      setPan((p) => {
        const wx = (ox - p.x) / prev
        const wy = (oy - p.y) / prev
        return { x: ox - wx * next, y: oy - wy * next }
      })
      return next
    })
  }, [])

  const zoomIn = useCallback(() => applyZoom(1.2), [applyZoom])
  const zoomOut = useCallback(() => applyZoom(1 / 1.2), [applyZoom])

  const fitToScreen = useCallback(() => {
    if (!containerRef.current) return
    const positioned = canvasDoc.items.filter(isPositioned)
    if (positioned.length === 0) {
      setPan({ x: 220, y: 140 }); setZoom(1); return
    }
    const minX = Math.min(...positioned.map((i) => i.x)) - 80
    const minY = Math.min(...positioned.map((i) => i.y)) - 80
    const maxX = Math.max(...positioned.map((i) => i.x + i.w)) + 80
    const maxY = Math.max(...positioned.map((i) => i.y + i.h)) + 80
    const rect = containerRef.current.getBoundingClientRect()
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY)) * 0.9))
    setZoom(newZoom)
    setPan({ x: (rect.width - (maxX - minX) * newZoom) / 2 - minX * newZoom, y: (rect.height - (maxY - minY) * newZoom) / 2 - minY * newZoom })
  }, [canvasDoc.items])

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
      setVersion(Number(res.data?.version || version + 1))
      lastSerializedRef.current = nextSerialized
    } catch (error: any) {
      if (error?.response?.status === 409) { await fetchRemoteCanvas(); return }
      console.error('Canvas update failed', error)
    }
  }, [canEdit, fetchRemoteCanvas, role, sessionId, title, version])

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
      setVersion(incomingVersion)
      if (remoteSerialized !== lastSerializedRef.current) { setCanvasDoc(remote); lastSerializedRef.current = remoteSerialized }
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
    socket.on('canvas_updated', onCanvasUpdated)
    socket.on('canvas_item_lock', onItemLock)
    socket.on('canvas_item_unlock', onItemUnlock)
    return () => { socket.off('canvas_updated', onCanvasUpdated); socket.off('canvas_item_lock', onItemLock); socket.off('canvas_item_unlock', onItemUnlock) }
  }, [sessionId])

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
    onContentChange?.(serializedDoc)
    if (!canEdit) return
    if (serializedDoc === lastSerializedRef.current) return
    if (isInteractingRef.current || undoRedoRef.current) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => { void pushRemoteCanvas(serializedDoc) }, 300)
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current) }
  }, [serializedDoc, canEdit, onContentChange, pushRemoteCanvas])

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isTyping = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable
      if (e.key === ' ' && !isTyping) { e.preventDefault(); spaceHeldRef.current = true }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }
      if (isTyping) return
      if (e.key === 'Escape') { setSelectedId(null); setEditingId(null); setTool('select'); setContextMenu(null) }
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
  }, [undo, redo, canEdit])

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
    window.requestAnimationFrame(() => {
      void pushRemoteCanvas(latestSerializedRef.current)
      pushHistory()
      if (hadRemote) void fetchRemoteCanvas()
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
      const items = prev.items.map((item) => (item.id === id ? ({ ...item, ...patch } as CanvasItem) : item))
      const nextItems = items.map((item) => {
        if (item.id !== id || !isPositioned(item)) return item
        return { ...item, parentFrameId: getParentFrameId(item, items) } as CanvasItem
      })
      return { ...prev, items: nextItems }
    })
  }

  const deleteSelected = useCallback(() => {
    if (!selectedId || !canEdit) return
    if (isLockedByOther(selectedId)) return
    beginInteraction()
    setCanvasDoc((prev) => {
      const selected = prev.items.find((i) => i.id === selectedId)
      const removedIds = new Set<string>()
      if (selected && isFrame(selected)) {
        collectFrameDescendants(prev.items, selected.id).forEach((id) => removedIds.add(id))
        removedIds.add(selected.id)
      } else if (selected) {
        removedIds.add(selected.id)
      }
      const remaining = prev.items.filter((i) => !removedIds.has(i.id))
      return { ...prev, items: remaining.filter((i) => !isConnector(i) || (!removedIds.has((i as any).fromId) && !removedIds.has((i as any).toId))) }
    })
    emitUnlock(selectedId)
    setSelectedId(null)
    setEditingId(null)
    endInteraction()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, canEdit])

  // Keep ref in sync
  deleteSelectedRef.current = deleteSelected

  // ─── Z-order & duplicate ─────────────────────────────────────────────────

  const reorderItem = useCallback((id: string, action: 'front' | 'back' | 'forward' | 'backward') => {
    if (!canEdit) return
    beginInteraction()
    setCanvasDoc((prev) => {
      const idx = prev.items.findIndex((i) => i.id === id)
      if (idx === -1) return prev
      const items = [...prev.items]
      if (action === 'front' && idx < items.length - 1) items.push(items.splice(idx, 1)[0])
      else if (action === 'back' && idx > 0) items.unshift(items.splice(idx, 1)[0])
      else if (action === 'forward' && idx < items.length - 1) { [items[idx], items[idx + 1]] = [items[idx + 1], items[idx]] }
      else if (action === 'backward' && idx > 0) { [items[idx - 1], items[idx]] = [items[idx], items[idx - 1]] }
      else return prev
      return { ...prev, items }
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
    setEditingId(null)
    setShowTemplates(false)
    endInteraction()
  }

  // ─── Context menu ─────────────────────────────────────────────────────────

  const openContextMenu = (e: React.MouseEvent, itemId: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ screenX: e.clientX, screenY: e.clientY, itemId })
    if (itemId) { setSelectedId(itemId); setEditingId(null) }
  }

  const closeContextMenu = () => setContextMenu(null)

  // ─── Mouse / touch handlers ───────────────────────────────────────────────

  const onCanvasClick = (_e: React.MouseEvent<HTMLDivElement>) => {
    if (panningRef.current) return
    if (tool === 'hand') return
    // Items stop propagation on onClick — a click reaching here is on the background
    if (skipNextClickRef.current) { skipNextClickRef.current = false; return }
    if (tool === 'select' || tool === 'pen' || tool === 'connector') {
      setSelectedId(null); setEditingId(null)
    }
    // Shape tools: item creation is handled in onMouseUp via dragCreate
  }

  const onMouseDownItem = (e: React.MouseEvent, item: CanvasItem) => {
    e.stopPropagation()
    setSelectedId(item.id)
    if (isTextEditable(item) && e.detail >= 2) { setEditingId(item.id); return }
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

  const onContainerMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (spaceHeldRef.current || tool === 'hand' || e.button === 1) {
      e.preventDefault()
      panningRef.current = { startMouseX: e.clientX, startMouseY: e.clientY, startPanX: pan.x, startPanY: pan.y }
      setIsPanning(true)
      return
    }
    if (!canEdit) return
    if (tool === 'pen') {
      beginInteraction()
      const wp = toWorld(e.clientX, e.clientY)
      drawingRef.current = { points: [wp] }
      setPreviewPoints([wp])
      return
    }
    // Drag-to-create for shape/content tools
    if (tool !== 'select' && tool !== 'connector') {
      const wp = toWorld(e.clientX, e.clientY)
      dragCreateRef.current = { tool, startX: wp.x, startY: wp.y, currentX: wp.x, currentY: wp.y }
    }
  }

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    // Panning
    if (panningRef.current) {
      const { startMouseX, startMouseY, startPanX, startPanY } = panningRef.current
      setPan({ x: startPanX + (e.clientX - startMouseX), y: startPanY + (e.clientY - startMouseY) })
      return
    }

    const wp = toWorld(e.clientX, e.clientY)

    // Connector drag preview
    if (connectorDrag) {
      setConnectorDrag((prev) => (prev ? { ...prev, toPoint: wp } : prev))
      return
    }

    // Pen drawing (RAF throttled)
    if (drawingRef.current && tool === 'pen' && canEdit) {
      drawingRef.current.points.push(wp)
      if (!rafDrawRef.current) {
        rafDrawRef.current = window.requestAnimationFrame(() => {
          rafDrawRef.current = null
          setPreviewPoints([...(drawingRef.current?.points || [])])
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
          if (w > 6 || h > 6) setPreviewCreate({ x, y, w: Math.max(w, 20), h: Math.max(h, 20) })
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
        emitLock(candidate.id)
        draggingRef.current = { id: candidate.id, offsetX: candidate.offsetX, offsetY: candidate.offsetY }
        pendingDragRef.current = null
      }
    }

    // Resize (RAF throttled) — store pending size in ref, apply in RAF
    if (resizingRef.current && canEdit) {
      const resize = resizingRef.current
      resize.pendingW = Math.max(80, resize.startW + (e.clientX - resize.startX) / zoom)
      resize.pendingH = Math.max(60, resize.startH + (e.clientY - resize.startY) / zoom)
      if (!resizeRafRef.current) {
        resizeRafRef.current = window.requestAnimationFrame(() => {
          resizeRafRef.current = null
          const r = resizingRef.current
          if (!r || r.pendingW === undefined) return
          setCanvasDoc((prev) => ({
            ...prev,
            items: prev.items.map((item) =>
              item.id !== r.id || !isPositioned(item) ? item : { ...item, w: r.pendingW!, h: r.pendingH! } as CanvasItem,
            ),
          }))
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
          const nx = Math.max(0, drag.pendingX - drag.offsetX)
          const ny = Math.max(0, drag.pendingY - drag.offsetY)
          setCanvasDoc((prev) => {
            const target = prev.items.find((i) => i.id === drag.id)
            if (!target || !isPositioned(target)) return prev
            const moved = isFrame(target)
              ? moveFrameWithChildren(prev.items, target.id, nx, ny)
              : prev.items.map((item) =>
                  item.id !== drag.id || !isPositioned(item) ? item : { ...item, x: nx, y: ny } as CanvasItem,
                )
            return { ...prev, items: moved }
          })
        })
      }
    }
  }

  const onMouseUp = () => {
    // Cancel any pending RAF updates
    if (dragRafRef.current) { window.cancelAnimationFrame(dragRafRef.current); dragRafRef.current = null }
    if (resizeRafRef.current) { window.cancelAnimationFrame(resizeRafRef.current); resizeRafRef.current = null }

    if (panningRef.current) { panningRef.current = null; setIsPanning(false); return }

    if (connectorDrag) {
      if (connectorDrag.hoverTarget && connectorDrag.hoverTarget.id !== connectorDrag.fromId) {
        beginInteraction()
        const connector: CanvasItem = {
          id: mkId(), type: 'connector',
          fromId: connectorDrag.fromId, fromAnchor: connectorDrag.fromAnchor,
          toId: connectorDrag.hoverTarget.id, toAnchor: connectorDrag.hoverTarget.anchor,
          color: '#334155', width: 2,
        }
        setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, connector] }))
        setSelectedId(connector.id)
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
      const item = createItemAtBounds(dc.tool, Math.max(0, itemX), Math.max(0, itemY), itemW, itemH)
      if (item) {
        beginInteraction()
        setCanvasDoc((prev) => {
          const parentFrameId = getParentFrameId(item, prev.items)
          return { ...prev, items: [...prev.items, { ...item, parentFrameId }] }
        })
        setSelectedId(item.id)
        setEditingId(null)
        setTool('select')
        skipNextClickRef.current = true
        endInteraction()
      }
      return
    }

    const dragId = draggingRef.current?.id
    const resizedId = resizingRef.current?.id
    const hadPendingDrag = Boolean(pendingDragRef.current)
    draggingRef.current = null
    resizingRef.current = null
    pendingDragRef.current = null

    let didMutate = false
    if (drawingRef.current && canEdit && drawingRef.current.points.length > 1) {
      didMutate = true
      const path: CanvasItem = { id: mkId(), type: 'path', points: drawingRef.current.points, color: strokeColor, width: strokeWidth }
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
    if (dragId) {
      emitUnlock(dragId)
      didMutate = true
      setCanvasDoc((prev) => ({
        ...prev,
        items: prev.items.map((item) => {
          if (!isPositioned(item)) return item
          return { ...item, parentFrameId: getParentFrameId(item, prev.items, isFrame(item) ? item.id : undefined) } as CanvasItem
        }),
      }))
    }
    if (resizedId && resizedId !== dragId) { emitUnlock(resizedId); didMutate = true }
    if (didMutate) endInteraction()
    if (hadPendingDrag) setEditingId(null)
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
        setPan((prev) => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }))
      }
    }
    el.addEventListener('wheel', onNativeWheel, { passive: false })
    return () => el.removeEventListener('wheel', onNativeWheel)
  }, [applyZoom])

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
    let ox = Math.max(20, wp.x), oy = Math.max(20, wp.y)

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
    const from = canvasDoc.items.find((i) => i.id === item.fromId)
    const to = canvasDoc.items.find((i) => i.id === item.toId)
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
    const from = canvasDoc.items.find((i) => i.id === connectorDrag.fromId)
    if (!from || !isPositioned(from)) return null
    const p1 = getAnchorPoint(from, connectorDrag.fromAnchor)
    const p2 = connectorDrag.hoverTarget
      ? (() => { const t = canvasDoc.items.find((i) => i.id === connectorDrag.hoverTarget?.id); return t && isPositioned(t) ? getAnchorPoint(t, connectorDrag.hoverTarget!.anchor) : connectorDrag.toPoint })()
      : connectorDrag.toPoint
    const d1 = anchorDirection(connectorDrag.fromAnchor)
    const tAnchor: Anchor = connectorDrag.hoverTarget?.anchor || (Math.abs(p2.x - p1.x) > Math.abs(p2.y - p1.y) ? (p2.x >= p1.x ? 'left' : 'right') : p2.y >= p1.y ? 'top' : 'bottom')
    const d2 = anchorDirection(tAnchor)
    const curve = Math.max(36, Math.min(180, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.35))
    const c1 = { x: p1.x + d1.x * curve, y: p1.y + d1.y * curve }
    const c2 = { x: p2.x + d2.x * curve, y: p2.y + d2.y * curve }
    return <path d={`M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`} stroke="#3ea9f4" strokeWidth={2.5} strokeDasharray="6 4" fill="none" markerEnd="url(#canvas-arrow)" />
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
          style={{ cursor }}
          onMouseDown={(e) => { closeContextMenu(); onContainerMouseDown(e) }}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onClick={onCanvasClick}
          onContextMenu={(e) => openContextMenu(e, null)}
          onDragEnter={(e) => { e.preventDefault(); if (canEdit) setIsDropActive(true) }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDropActive(false) }}
          onDragOver={(e) => { e.preventDefault(); if (canEdit) { e.dataTransfer.dropEffect = 'copy'; setIsDropActive(true) } }}
          onDrop={handleDropFiles}
        >
          {/* World layer */}
          <div
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
              position: 'absolute',
              width: WORLD_W,
              height: WORLD_H,
              backgroundImage: 'radial-gradient(circle at 1px 1px, rgba(148,163,184,0.3) 1px, transparent 0)',
              backgroundSize: '24px 24px',
            }}
          >
            {/* SVG: connectors & paths */}
            <svg className="pointer-events-none absolute inset-0 h-full w-full">
              <defs>
                <marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
                </marker>
              </defs>
              {canvasDoc.items.filter(isConnector).map((item) => renderConnector(item as Extract<CanvasItem, { type: 'connector' }>))}
              {canvasDoc.items.filter(isPath).map((item) => renderPath(item as Extract<CanvasItem, { type: 'path' }>))}
              {renderConnectorPreview()}
              {previewPoints.length > 1 && (
                <path d={previewPoints.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')} stroke={strokeColor} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>

            {/* Drag-to-create ghost */}
            {previewCreate && (
              <div
                className="pointer-events-none absolute rounded border-2 border-dashed border-blue-500 bg-blue-100/20"
                style={{ left: previewCreate.x, top: previewCreate.y, width: previewCreate.w, height: previewCreate.h }}
              />
            )}

            {/* Items */}
            {canvasDoc.items.filter((item) => !isPath(item) && !isConnector(item)).map((item) => {
              const lockedByOther = isLockedByOther(item.id)
              const isEditing = editingId === item.id
              if (!isPositioned(item)) return null
              return (
                <div
                  key={item.id}
                  className={`absolute ${selectedId === item.id ? 'ring-2 ring-blue-500 ring-offset-1' : ''} ${lockedByOther ? 'opacity-60' : ''}`}
                  style={{
                    left: item.x, top: item.y, width: item.w, height: item.h,
                    zIndex: selectedId === item.id ? 100 : item.type === 'frame' ? 1 : 10,
                  }}
                  onMouseDown={(e) => onMouseDownItem(e, item)}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => openContextMenu(e, item.id)}
                  onDoubleClick={() => {
                    if (!canEdit || lockedByOther) return
                    if (isTextEditable(item)) { setEditingId(item.id); setSelectedId(item.id) }
                  }}
                >
                  {item.type === 'postit' && (
                    <textarea
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
                      {canEdit && ANCHORS.map((anchor) => {
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
                            className={`absolute h-3.5 w-3.5 rounded-full border shadow-sm ${isSource ? 'border-blue-600 bg-blue-500' : isHoverTarget ? 'border-blue-500 bg-blue-100' : 'border-slate-400 bg-white'}`}
                            style={pointStyle}
                            onMouseDown={(e) => {
                              e.stopPropagation()
                              if (!canEdit) return
                              if (tool !== 'connector') setTool('connector')
                              setConnectorDrag({ fromId: item.id, fromAnchor: anchor, toPoint: getAnchorPoint(item, anchor) })
                            }}
                            onMouseEnter={() => setConnectorDrag((prev) => prev ? (prev.fromId === item.id && prev.fromAnchor === anchor ? prev : { ...prev, hoverTarget: { id: item.id, anchor } }) : prev)}
                            onMouseLeave={() => setConnectorDrag((prev) => prev?.hoverTarget?.id === item.id && prev.hoverTarget.anchor === anchor ? { ...prev, hoverTarget: undefined } : prev)}
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
                  {canEdit && !lockedByOther && (item.type === 'postit' || item.type === 'frame' || item.type === 'text' || item.type === 'shape' || item.type === 'image') && (
                    <button
                      type="button"
                      className="absolute bottom-0.5 right-0.5 h-3 w-3 cursor-se-resize rounded-sm border border-slate-400 bg-white/80 shadow"
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        if (!isPositioned(item) || isLockedByOther(item.id)) return
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
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50" onClick={() => { setSelectedId(contextMenu.itemId!); deleteSelected(); closeContextMenu() }}>
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
