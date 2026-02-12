import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { chatApi, teacherApi, studentApi } from '@/lib/api'
import { Eraser, Square, StickyNote, Type, ImagePlus, Table, Pencil, Frame, MoveRight, RectangleHorizontal, Triangle } from 'lucide-react'

type CanvasRole = 'teacher' | 'student'
type Tool = 'select' | 'postit' | 'frame' | 'text' | 'pen' | 'roundedRect' | 'triangle' | 'parallelogram' | 'connector'

type Point = { x: number; y: number }
type Anchor = 'top' | 'right' | 'bottom' | 'left'

type LockInfo = {
  userId: string
  userType: string
}

type CanvasItemBase = {
  id: string
  parentFrameId?: string
}

type CanvasTextStyle = {
  fontFamily: string
  fontSize: number
  fontWeight: 'normal' | '600'
  fontStyle: 'normal' | 'italic'
}

type CanvasPositionedItemBase = CanvasItemBase & {
  x: number
  y: number
  w: number
  h: number
}

type CanvasItem =
  | (CanvasPositionedItemBase & { type: 'postit'; text: string; color: string; textStyle?: CanvasTextStyle })
  | (CanvasPositionedItemBase & { type: 'frame'; text: string; color: string; textStyle?: CanvasTextStyle })
  | (CanvasPositionedItemBase & { type: 'text'; text: string; color: string; textStyle?: CanvasTextStyle })
  | (CanvasPositionedItemBase & { type: 'shape'; shape: 'rounded-rect' | 'triangle' | 'parallelogram'; fill: string; stroke: string })
  | (CanvasItemBase & { type: 'connector'; fromId: string; fromAnchor: Anchor; toId: string; toAnchor: Anchor; color: string; width: number })
  | (CanvasPositionedItemBase & { type: 'image'; src: string })
  | (CanvasPositionedItemBase & { type: 'table'; data: string[][] })
  | (CanvasItemBase & { type: 'path'; points: Point[]; color: string; width: number; parentFrameId?: string })

type CanvasDoc = {
  type: 'canvas_v1'
  items: CanvasItem[]
}

interface CollaborativeCanvasProps {
  sessionId?: string
  role: CanvasRole
  title: string
  onTitleChange?: (title: string) => void
  initialContent?: string
  onContentChange?: (contentJson: string) => void
  readOnly?: boolean
}

const EMPTY_CANVAS: CanvasDoc = {
  type: 'canvas_v1',
  items: [],
}

const DEFAULT_TEXT_STYLE: CanvasTextStyle = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 14,
  fontWeight: 'normal',
  fontStyle: 'normal',
}

const ensureTextStyle = (item: CanvasItem) => {
  if (item.type !== 'postit' && item.type !== 'frame' && item.type !== 'text') return item
  return {
    ...item,
    textStyle: {
      ...DEFAULT_TEXT_STYLE,
      ...(item.textStyle || {}),
    },
  } as CanvasItem
}

const apiByRole = {
  teacher: {
    getCanvas: teacherApi.getCanvas,
    updateCanvas: teacherApi.updateCanvas,
  },
  student: {
    getCanvas: studentApi.getCanvas,
    updateCanvas: studentApi.updateCanvas,
  },
}

const parseCanvasDoc = (raw: string | null | undefined): CanvasDoc => {
  if (!raw) return EMPTY_CANVAS
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.type === 'canvas_v1' && Array.isArray(parsed.items)) {
      return { type: 'canvas_v1', items: parsed.items.map((item: CanvasItem) => ensureTextStyle(item)) }
    }
  } catch {
    // no-op
  }
  return EMPTY_CANVAS
}

const toCsvTable = (rows: Array<Array<string | number | boolean | null>>): string[][] =>
  rows.map((row) => row.map((cell) => (cell == null ? '' : String(cell))))

const isFrame = (item: CanvasItem): item is Extract<CanvasItem, { type: 'frame' }> => item.type === 'frame'
const isPath = (item: CanvasItem): item is Extract<CanvasItem, { type: 'path' }> => item.type === 'path'
const isConnector = (item: CanvasItem): item is Extract<CanvasItem, { type: 'connector' }> => item.type === 'connector'
const isShape = (item: CanvasItem): item is Extract<CanvasItem, { type: 'shape' }> => item.type === 'shape'

const isPositioned = (item: CanvasItem): item is Exclude<CanvasItem, { type: 'path' | 'connector' }> => !isPath(item) && !isConnector(item)

const getAnchorPoint = (item: Exclude<CanvasItem, { type: 'path' | 'connector' }>, anchor: Anchor): Point => {
  if (anchor === 'top') return { x: item.x + item.w / 2, y: item.y }
  if (anchor === 'right') return { x: item.x + item.w, y: item.y + item.h / 2 }
  if (anchor === 'bottom') return { x: item.x + item.w / 2, y: item.y + item.h }
  return { x: item.x, y: item.y + item.h / 2 }
}

const nearestAnchorForPoint = (item: Exclude<CanvasItem, { type: 'path' | 'connector' }>, localX: number, localY: number): Anchor => {
  const cx = item.w / 2
  const cy = item.h / 2
  const dx = localX - cx
  const dy = localY - cy
  if (Math.abs(dx) > Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'bottom' : 'top'
}

const extractImageUrlsFromHtml = (html: string): string[] => {
  const matches = [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)]
  return matches.map((m) => String(m[1] || '').trim()).filter(Boolean)
}

const looksLikeImageUrl = (value: string) => {
  if (!value) return false
  if (value.startsWith('data:image/')) return true
  if (value.startsWith('blob:')) return true
  return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(value)
}

const isContainedInFrame = (
  candidate: { x: number; y: number; w: number; h: number },
  frame: Extract<CanvasItem, { type: 'frame' }>
) =>
  candidate.x >= frame.x &&
  candidate.y >= frame.y &&
  candidate.x + candidate.w <= frame.x + frame.w &&
  candidate.y + candidate.h <= frame.y + frame.h

const getParentFrameId = (
  item: CanvasItem,
  items: CanvasItem[],
  skipFrameId?: string
): string | undefined => {
  if (!isPositioned(item)) return item.parentFrameId
  const frames = items.filter(isFrame).filter((f) => f.id !== item.id && f.id !== skipFrameId)
  const containers = frames.filter((f) => isContainedInFrame(item, f))
  if (containers.length === 0) return undefined
  containers.sort((a, b) => a.w * a.h - b.w * b.h)
  return containers[0].id
}

const collectFrameDescendants = (items: CanvasItem[], frameId: string): string[] => {
  const descendants = new Set<string>()
  const queue = [frameId]
  while (queue.length > 0) {
    const current = queue.shift() as string
    items.forEach((item) => {
      if (item.parentFrameId === current && !descendants.has(item.id)) {
        descendants.add(item.id)
        if (isFrame(item)) queue.push(item.id)
      }
    })
  }
  return Array.from(descendants)
}

const moveFrameWithChildren = (
  items: CanvasItem[],
  frameId: string,
  newX: number,
  newY: number
): CanvasItem[] => {
  const frame = items.find((item) => item.id === frameId)
  if (!frame || !isFrame(frame)) return items

  const dx = newX - frame.x
  const dy = newY - frame.y
  const descendants = new Set(collectFrameDescendants(items, frameId))

  return items.map((item) => {
    if (item.id === frameId) {
      return { ...item, x: newX, y: newY }
    }
    if (descendants.has(item.id)) {
      if (isPath(item)) {
        return {
          ...item,
          points: item.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        }
      }
      if (!isPositioned(item)) return item
      return { ...item, x: item.x + dx, y: item.y + dy }
    }
    return item
  })
}

export function CollaborativeCanvas({
  sessionId,
  role,
  title,
  onTitleChange,
  initialContent,
  onContentChange,
  readOnly = false,
}: CollaborativeCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null)
  const resizingRef = useRef<{ id: string; startX: number; startY: number; startW: number; startH: number } | null>(null)
  const drawingRef = useRef<{ points: Point[] } | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const lastSerializedRef = useRef<string>('')
  const isInteractingRef = useRef(false)
  const latestSerializedRef = useRef('')
  const remoteWhileInteractingRef = useRef<string | null>(null)
  const rafDrawRef = useRef<number | null>(null)

  const [tool, setTool] = useState<Tool>('select')
  const [strokeColor, setStrokeColor] = useState('#2563eb')
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [newPostitColor, setNewPostitColor] = useState('#fef08a')
  const [newShapeFill, setNewShapeFill] = useState('#bae6fd')
  const [newShapeStroke, setNewShapeStroke] = useState('#0369a1')
  const [canvasDoc, setCanvasDoc] = useState<CanvasDoc>(() => parseCanvasDoc(initialContent))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [connectorDraft, setConnectorDraft] = useState<{ fromId: string; fromAnchor: Anchor } | null>(null)
  const [isDropActive, setIsDropActive] = useState(false)
  const [version, setVersion] = useState(0)
  const [previewPoints, setPreviewPoints] = useState<Point[]>([])
  const [locks, setLocks] = useState<Record<string, LockInfo>>({})
  const [socketConnected, setSocketConnected] = useState(false)

  const canEdit = !readOnly
  const selectedItem = useMemo(
    () => (selectedId ? canvasDoc.items.find((item) => item.id === selectedId) || null : null),
    [canvasDoc.items, selectedId]
  )
  const selectedTextStyle = useMemo(() => {
    if (!selectedItem || (selectedItem.type !== 'postit' && selectedItem.type !== 'frame' && selectedItem.type !== 'text')) return null
    return {
      ...DEFAULT_TEXT_STYLE,
      ...(selectedItem.textStyle || {}),
    }
  }, [selectedItem])

  const serializedDoc = useMemo(() => JSON.stringify(canvasDoc), [canvasDoc])

  useEffect(() => {
    latestSerializedRef.current = serializedDoc
  }, [serializedDoc])

  const currentUserId = useMemo(() => {
    const raw = role === 'student' ? localStorage.getItem('student_token') : localStorage.getItem('access_token')
    if (!raw) return ''
    try {
      const payload = JSON.parse(atob(raw.split('.')[1]))
      return String(payload?.sub || '')
    } catch {
      return ''
    }
  }, [role])

  useEffect(() => {
    const parsed = parseCanvasDoc(initialContent)
    const serialized = JSON.stringify(parsed)
    if (serialized !== serializedDoc) {
      setCanvasDoc(parsed)
      lastSerializedRef.current = serialized
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContent])

  const fetchRemoteCanvas = useCallback(async () => {
    if (!sessionId) return
    if (isInteractingRef.current) return

    try {
      const res = await apiByRole[role].getCanvas(sessionId)
      const remote = parseCanvasDoc(res.data?.content_json)
      const nextSerialized = JSON.stringify(remote)
      setVersion(Number(res.data?.version || 0))
      if (nextSerialized !== lastSerializedRef.current) {
        setCanvasDoc(remote)
        lastSerializedRef.current = nextSerialized
      }
    } catch (error) {
      console.error('Canvas fetch failed', error)
    }
  }, [role, sessionId])

  const pushRemoteCanvas = useCallback(
    async (nextSerialized: string) => {
      if (!sessionId || !canEdit) return
      try {
        const res = await apiByRole[role].updateCanvas(sessionId, {
          title,
          content_json: nextSerialized,
          base_version: version,
        })
        const nextVersion = Number(res.data?.version || version + 1)
        setVersion(nextVersion)
        lastSerializedRef.current = nextSerialized
      } catch (error: any) {
        if (error?.response?.status === 409) {
          await fetchRemoteCanvas()
          return
        }
        console.error('Canvas update failed', error)
      }
    },
    [canEdit, fetchRemoteCanvas, role, sessionId, title, version]
  )

  useEffect(() => {
    if (!sessionId) return
    void fetchRemoteCanvas()
  }, [fetchRemoteCanvas, sessionId])

  useEffect(() => {
    if (!sessionId) return
    if (pollTimerRef.current) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }

    if (!socketConnected) {
      pollTimerRef.current = window.setInterval(() => {
        if (!isInteractingRef.current) void fetchRemoteCanvas()
      }, 5000)
    }

    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current)
    }
  }, [fetchRemoteCanvas, sessionId, socketConnected])

  useEffect(() => {
    const socket = (window as any).socket
    if (!socket) return

    const onConnect = () => setSocketConnected(true)
    const onDisconnect = () => setSocketConnected(false)
    setSocketConnected(Boolean(socket.connected))

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [])

  useEffect(() => {
    const socket = (window as any).socket
    if (!socket || !sessionId) return

    const onCanvasUpdated = (payload: any) => {
      if (payload?.session_id !== sessionId) return
      const incomingVersion = Number(payload?.version || 0)
      if (incomingVersion <= version) return

      if (isInteractingRef.current) {
        remoteWhileInteractingRef.current = String(payload?.content_json || '')
        return
      }

      const remote = parseCanvasDoc(payload?.content_json)
      const remoteSerialized = JSON.stringify(remote)
      setVersion(incomingVersion)
      if (remoteSerialized !== lastSerializedRef.current) {
        setCanvasDoc(remote)
        lastSerializedRef.current = remoteSerialized
      }
    }

    const onItemLock = (payload: any) => {
      if (payload?.session_id !== sessionId) return
      const itemId = String(payload?.item_id || '')
      const userId = String(payload?.user_id || '')
      const userType = String(payload?.user_type || '')
      if (!itemId || !userId) return
      setLocks((prev) => ({ ...prev, [itemId]: { userId, userType } }))
    }

    const onItemUnlock = (payload: any) => {
      if (payload?.session_id !== sessionId) return
      const itemId = String(payload?.item_id || '')
      if (!itemId) return
      setLocks((prev) => {
        const next = { ...prev }
        delete next[itemId]
        return next
      })
    }

    socket.on('canvas_updated', onCanvasUpdated)
    socket.on('canvas_item_lock', onItemLock)
    socket.on('canvas_item_unlock', onItemUnlock)
    return () => {
      socket.off('canvas_updated', onCanvasUpdated)
      socket.off('canvas_item_lock', onItemLock)
      socket.off('canvas_item_unlock', onItemUnlock)
    }
  }, [sessionId, version])

  useEffect(() => {
    onContentChange?.(serializedDoc)
    if (!canEdit) return
    if (serializedDoc === lastSerializedRef.current) return
    if (isInteractingRef.current) return

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      void pushRemoteCanvas(serializedDoc)
    }, 300)

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [serializedDoc, canEdit, onContentChange, pushRemoteCanvas])

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

  const beginInteraction = () => {
    isInteractingRef.current = true
  }

  const endInteraction = () => {
    isInteractingRef.current = false
    void pushRemoteCanvas(latestSerializedRef.current)
    if (remoteWhileInteractingRef.current) {
      remoteWhileInteractingRef.current = null
      void fetchRemoteCanvas()
    }
  }

  const isLockedByOther = (itemId: string) => {
    const lock = locks[itemId]
    return Boolean(lock && lock.userId && lock.userId !== currentUserId)
  }

  const createItem = (type: Tool, x: number, y: number): CanvasItem | null => {
    const id = crypto.randomUUID()
    if (type === 'postit') {
      return { id, type: 'postit', x, y, w: 220, h: 180, text: 'Nuovo post-it', color: newPostitColor, textStyle: DEFAULT_TEXT_STYLE }
    }
    if (type === 'frame') {
      return { id, type: 'frame', x, y, w: 340, h: 250, text: 'Frame', color: '#3b82f6', textStyle: DEFAULT_TEXT_STYLE }
    }
    if (type === 'text') {
      return { id, type: 'text', x, y, w: 280, h: 130, text: 'Testo', color: '#0f172a', textStyle: DEFAULT_TEXT_STYLE }
    }
    if (type === 'roundedRect') {
      return { id, type: 'shape', shape: 'rounded-rect', x, y, w: 220, h: 140, fill: newShapeFill, stroke: newShapeStroke }
    }
    if (type === 'triangle') {
      return { id, type: 'shape', shape: 'triangle', x, y, w: 220, h: 160, fill: newShapeFill, stroke: newShapeStroke }
    }
    if (type === 'parallelogram') {
      return { id, type: 'shape', shape: 'parallelogram', x, y, w: 230, h: 140, fill: newShapeFill, stroke: newShapeStroke }
    }
    return null
  }

  const updateItem = (id: string, patch: Partial<CanvasItem>) => {
    if (isLockedByOther(id)) return
    setCanvasDoc((prev) => {
      const items = prev.items.map((item) => (item.id === id ? ({ ...item, ...patch } as CanvasItem) : item))
      const nextItems = items.map((item) => {
        if (item.id !== id || !isPositioned(item)) return item
        return {
          ...item,
          parentFrameId: getParentFrameId(item, items),
        } as CanvasItem
      })
      return { ...prev, items: nextItems }
    })
  }

  const onCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canEdit) return
    if (tool === 'select') {
      setSelectedId(null)
      setEditingId(null)
      return
    }
    if (tool === 'pen') return
    if (tool === 'connector') {
      setConnectorDraft(null)
      return
    }

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left - 80
    const y = e.clientY - rect.top - 50
    const item = createItem(tool, Math.max(20, x), Math.max(20, y))
    if (!item) return

    setCanvasDoc((prev) => {
      const parentFrameId = getParentFrameId(item, prev.items)
      return { ...prev, items: [...prev.items, { ...item, parentFrameId }] }
    })
    setSelectedId(item.id)
    setEditingId(null)
    setTool('select')
  }

  const onMouseDownItem = (e: React.MouseEvent, item: CanvasItem) => {
    e.stopPropagation()
    setSelectedId(item.id)
    if (tool === 'connector') {
      if (!canEdit || !isShape(item)) return
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      const localX = e.clientX - rect.left
      const localY = e.clientY - rect.top
      const anchor = nearestAnchorForPoint(item, localX, localY)
      if (!connectorDraft || connectorDraft.fromId === item.id) {
        setConnectorDraft({ fromId: item.id, fromAnchor: anchor })
        return
      }

      beginInteraction()
      const connector: CanvasItem = {
        id: crypto.randomUUID(),
        type: 'connector',
        fromId: connectorDraft.fromId,
        fromAnchor: connectorDraft.fromAnchor,
        toId: item.id,
        toAnchor: anchor,
        color: '#334155',
        width: 2,
      }
      setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, connector] }))
      setSelectedId(connector.id)
      setConnectorDraft(null)
      endInteraction()
      return
    }

    const tag = (e.target as HTMLElement).tagName
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON') return
    if (!canEdit) return
    if (isPath(item)) return
    if (isConnector(item)) return
    if (editingId === item.id) return
    if (isLockedByOther(item.id)) return

    beginInteraction()
    emitLock(item.id)

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    draggingRef.current = {
      id: item.id,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    }
  }

  const onMouseDownDraw = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canEdit || tool !== 'pen') return
    beginInteraction()
    const rect = e.currentTarget.getBoundingClientRect()
    drawingRef.current = {
      points: [{ x: e.clientX - rect.left, y: e.clientY - rect.top }],
    }
    setPreviewPoints(drawingRef.current.points)
  }

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()

    if (drawingRef.current && tool === 'pen' && canEdit) {
      drawingRef.current.points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      if (!rafDrawRef.current) {
        rafDrawRef.current = window.requestAnimationFrame(() => {
          rafDrawRef.current = null
          setPreviewPoints([...(drawingRef.current?.points || [])])
        })
      }
      return
    }

    if (resizingRef.current && canEdit) {
      const resize = resizingRef.current
      const minW = 140
      const minH = 90
      const nextW = Math.max(minW, resize.startW + (e.clientX - resize.startX))
      const nextH = Math.max(minH, resize.startH + (e.clientY - resize.startY))

      setCanvasDoc((prev) => {
        const resized = prev.items.map((item) => {
          if (item.id !== resize.id || !isPositioned(item)) return item
          return {
            ...item,
            w: nextW,
            h: nextH,
          } as CanvasItem
        })
        return { ...prev, items: resized }
      })
      return
    }

    if (!draggingRef.current || !canEdit) return
    const drag = draggingRef.current

    setCanvasDoc((prev) => {
      const target = prev.items.find((item) => item.id === drag.id)
      if (!target || !isPositioned(target)) return prev
      const nextX = Math.max(0, e.clientX - rect.left - drag.offsetX)
      const nextY = Math.max(0, e.clientY - rect.top - drag.offsetY)

      let moved = prev.items
      if (isFrame(target)) {
        moved = moveFrameWithChildren(prev.items, target.id, nextX, nextY)
      } else {
        moved = prev.items.map((item) => {
          if (item.id !== drag.id || !isPositioned(item)) return item
          return {
            ...item,
            x: nextX,
            y: nextY,
          } as CanvasItem
        })
      }

      const normalized = moved.map((item) => {
        if (!isPositioned(item)) return item
        if (item.id === drag.id) {
          return {
            ...item,
            parentFrameId: getParentFrameId(item, moved, isFrame(item) ? item.id : undefined),
          } as CanvasItem
        }
        return item
      })
      return { ...prev, items: normalized }
    })
  }

  const onMouseUp = () => {
    const dragId = draggingRef.current?.id
    const resizedId = resizingRef.current?.id
    draggingRef.current = null
    resizingRef.current = null

    if (drawingRef.current && canEdit && drawingRef.current.points.length > 1) {
      const path: CanvasItem = {
        id: crypto.randomUUID(),
        type: 'path',
        points: drawingRef.current.points,
        color: strokeColor,
        width: strokeWidth,
      }
      setCanvasDoc((prev) => {
        const parentFrame = prev.items.filter(isFrame).find((frame) => {
          const points = path.points
          if (points.length === 0) return false
          return points.every((p) => p.x >= frame.x && p.x <= frame.x + frame.w && p.y >= frame.y && p.y <= frame.y + frame.h)
        })
        const withParent = parentFrame ? { ...path, parentFrameId: parentFrame.id } : path
        return { ...prev, items: [...prev.items, withParent] }
      })
    }

    drawingRef.current = null
    setPreviewPoints([])
    if (rafDrawRef.current) {
      window.cancelAnimationFrame(rafDrawRef.current)
      rafDrawRef.current = null
    }

    if (dragId) emitUnlock(dragId)
    if (resizedId && resizedId !== dragId) emitUnlock(resizedId)

    endInteraction()
  }

  const deleteSelected = () => {
    if (!selectedId || !canEdit) return
    if (isLockedByOther(selectedId)) return
    beginInteraction()

    setCanvasDoc((prev) => {
      const selected = prev.items.find((item) => item.id === selectedId)
      const removedIds = new Set<string>()
      if (selected && isFrame(selected)) {
        const descendants = new Set(collectFrameDescendants(prev.items, selected.id))
        descendants.add(selected.id)
        descendants.forEach((id) => removedIds.add(id))
      } else if (selected) {
        removedIds.add(selected.id)
      }

      const remaining = prev.items.filter((item) => !removedIds.has(item.id))
      const withoutOrphanConnectors = remaining.filter((item) => {
        if (!isConnector(item)) return true
        return !removedIds.has(item.fromId) && !removedIds.has(item.toId)
      })
      return { ...prev, items: withoutOrphanConnectors }
    })

    emitUnlock(selectedId)
    setSelectedId(null)
    setEditingId(null)
    endInteraction()
  }

  const uploadImage = async (file: File) => {
    if (!sessionId) {
      throw new Error('Per caricare immagini su lavagna serve una sessione selezionata.')
    }
    const res = await chatApi.uploadFiles(sessionId, [file])
    const url = res.data?.urls?.[0]
    if (!url) throw new Error('Upload immagine non riuscito')
    return url as string
  }

  const handleDropFiles = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!canEdit) return
    e.preventDefault()
    setIsDropActive(false)
    const files = Array.from(e.dataTransfer.files || [])

    const uriListRaw = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    const uriCandidates = uriListRaw
      .split(/\s+/)
      .map((p) => p.trim())
      .filter((p) => p && !p.startsWith('#') && (p.startsWith('http://') || p.startsWith('https://') || p.startsWith('data:image/') || p.startsWith('blob:')))
    const htmlRaw = e.dataTransfer.getData('text/html')
    const htmlCandidates = htmlRaw ? extractImageUrlsFromHtml(htmlRaw) : []
    const droppedImageUrls = Array.from(new Set([...uriCandidates, ...htmlCandidates])).filter(looksLikeImageUrl)
    if (files.length === 0 && droppedImageUrls.length === 0) return

    beginInteraction()

    const rect = e.currentTarget.getBoundingClientRect()
    let x = Math.max(20, e.clientX - rect.left)
    let y = Math.max(20, e.clientY - rect.top)

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        try {
          const imageUrl = await uploadImage(file)
          const imageItem: CanvasItem = {
            id: crypto.randomUUID(),
            type: 'image',
            x,
            y,
            w: 320,
            h: 220,
            src: imageUrl,
          }
          setCanvasDoc((prev) => {
            const parentFrameId = getParentFrameId(imageItem, prev.items)
            return { ...prev, items: [...prev.items, { ...imageItem, parentFrameId }] }
          })
          y += 30
        } catch (error) {
          console.error(error)
        }
        continue
      }

      const lower = file.name.toLowerCase()
      if (lower.endsWith('.csv') || lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        const dataBuffer = await file.arrayBuffer()
        const workbook = XLSX.read(dataBuffer, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as Array<Array<string | number | boolean | null>>
        const normalized = toCsvTable(rows).slice(0, 20).map((row) => row.slice(0, 8))
        const tableItem: CanvasItem = {
          id: crypto.randomUUID(),
          type: 'table',
          x,
          y,
          w: 440,
          h: 280,
          data: normalized.length ? normalized : [['']],
        }
        setCanvasDoc((prev) => {
          const parentFrameId = getParentFrameId(tableItem, prev.items)
          return { ...prev, items: [...prev.items, { ...tableItem, parentFrameId }] }
        })
        y += 34
      }
    }

    for (const src of droppedImageUrls) {
      const imageItem: CanvasItem = {
        id: crypto.randomUUID(),
        type: 'image',
        x,
        y,
        w: 320,
        h: 220,
        src,
      }
      setCanvasDoc((prev) => {
        const parentFrameId = getParentFrameId(imageItem, prev.items)
        return { ...prev, items: [...prev.items, { ...imageItem, parentFrameId }] }
      })
      y += 30
    }

    endInteraction()
  }

  const renderPath = (item: Extract<CanvasItem, { type: 'path' }>) => {
    const d = item.points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    return <path key={item.id} d={d} stroke={item.color} strokeWidth={item.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
  }

  const renderConnector = (item: Extract<CanvasItem, { type: 'connector' }>) => {
    const from = canvasDoc.items.find((candidate) => candidate.id === item.fromId)
    const to = canvasDoc.items.find((candidate) => candidate.id === item.toId)
    if (!from || !to || !isPositioned(from) || !isPositioned(to)) return null
    const p1 = getAnchorPoint(from, item.fromAnchor)
    const p2 = getAnchorPoint(to, item.toAnchor)
    return (
      <line
        key={item.id}
        x1={p1.x}
        y1={p1.y}
        x2={p2.x}
        y2={p2.y}
        stroke={item.color}
        strokeWidth={item.width}
        markerEnd="url(#canvas-arrow)"
      />
    )
  }

  return (
    <div className="flex h-[calc(100vh-170px)] flex-col rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-3 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          <Input
            value={title}
            onChange={(e) => onTitleChange?.(e.target.value)}
            className="h-8 w-64 text-sm"
            placeholder="Titolo lavagna"
            disabled={!canEdit}
          />
          <span className="text-xs text-slate-500">Realtime</span>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant={tool === 'select' ? 'default' : 'outline'} onClick={() => setTool('select')}><Square className="h-4 w-4" /></Button>
          <Button size="sm" variant={tool === 'postit' ? 'default' : 'outline'} onClick={() => setTool('postit')}><StickyNote className="h-4 w-4" /></Button>
          <Button size="sm" variant={tool === 'frame' ? 'default' : 'outline'} onClick={() => setTool('frame')}><Frame className="h-4 w-4" /></Button>
          <Button size="sm" variant={tool === 'text' ? 'default' : 'outline'} onClick={() => setTool('text')}><Type className="h-4 w-4" /></Button>
          <Button size="sm" variant={tool === 'roundedRect' ? 'default' : 'outline'} onClick={() => setTool('roundedRect')}><RectangleHorizontal className="h-4 w-4" /></Button>
          <Button size="sm" variant={tool === 'triangle' ? 'default' : 'outline'} onClick={() => setTool('triangle')}><Triangle className="h-4 w-4" /></Button>
          <Button size="sm" variant={tool === 'parallelogram' ? 'default' : 'outline'} onClick={() => setTool('parallelogram')}>▱</Button>
          <Button size="sm" variant={tool === 'connector' ? 'default' : 'outline'} onClick={() => setTool('connector')}><MoveRight className="h-4 w-4" /></Button>
          <Button size="sm" variant={tool === 'pen' ? 'default' : 'outline'} onClick={() => setTool('pen')}><Pencil className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={deleteSelected} disabled={!selectedId || !canEdit}><Eraser className="h-4 w-4" /></Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs">
            <span className="text-slate-500">Post-it</span>
            <Input
              type="color"
              value={newPostitColor}
              onChange={(e) => setNewPostitColor(e.target.value)}
              className="h-7 w-9 cursor-pointer p-1"
              title="Colore nuovo post-it"
            />
          </div>
          <div className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs">
            <span className="text-slate-500">Forma</span>
            <Input type="color" value={newShapeFill} onChange={(e) => setNewShapeFill(e.target.value)} className="h-7 w-9 cursor-pointer p-1" title="Riempimento forma" />
            <Input type="color" value={newShapeStroke} onChange={(e) => setNewShapeStroke(e.target.value)} className="h-7 w-9 cursor-pointer p-1" title="Bordo forma" />
          </div>
          <Input
            type="color"
            value={strokeColor}
            onChange={(e) => setStrokeColor(e.target.value)}
            className="h-8 w-10 p-1"
          />
          <Input
            type="number"
            min={1}
            max={14}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value || 3))}
            className="h-8 w-14 px-2"
          />
          <div className="flex items-center gap-1 text-xs text-slate-500">
            <ImagePlus className="h-4 w-4" />
            <Table className="h-4 w-4" />
            <span>Drop</span>
          </div>
          {tool === 'connector' && (
            <span className="text-xs text-slate-600">
              {connectorDraft ? 'Seleziona la forma di arrivo' : 'Seleziona forma di partenza'}
            </span>
          )}
        </div>
      </div>
      {selectedItem && isShape(selectedItem) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <span className="text-slate-600">Forma</span>
          <div className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1">
            <span className="text-slate-500">Fill</span>
            <Input
              type="color"
              value={selectedItem.fill}
              onChange={(e) => updateItem(selectedItem.id, { fill: e.target.value })}
              className="h-7 w-9 cursor-pointer p-1"
              disabled={!canEdit || isLockedByOther(selectedItem.id)}
            />
          </div>
          <div className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1">
            <span className="text-slate-500">Stroke</span>
            <Input
              type="color"
              value={selectedItem.stroke}
              onChange={(e) => updateItem(selectedItem.id, { stroke: e.target.value })}
              className="h-7 w-9 cursor-pointer p-1"
              disabled={!canEdit || isLockedByOther(selectedItem.id)}
            />
          </div>
        </div>
      )}
      {selectedItem && isConnector(selectedItem) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <span className="text-slate-600">Connettore</span>
          <Input
            type="color"
            value={selectedItem.color}
            onChange={(e) => updateItem(selectedItem.id, { color: e.target.value })}
            className="h-8 w-10 p-1"
            disabled={!canEdit}
          />
          <Input
            type="number"
            min={1}
            max={8}
            value={selectedItem.width}
            onChange={(e) => updateItem(selectedItem.id, { width: Math.max(1, Math.min(8, Number(e.target.value || 2))) })}
            className="h-8 w-14 px-2"
            disabled={!canEdit}
          />
        </div>
      )}
      {selectedItem && selectedTextStyle && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <span className="text-slate-600">Testo</span>
          <select
            className="h-8 rounded border border-slate-300 px-2 text-xs"
            value={selectedTextStyle.fontFamily}
            onChange={(e) => updateItem(selectedItem.id, { textStyle: { ...selectedTextStyle, fontFamily: e.target.value } })}
            disabled={!canEdit || isLockedByOther(selectedItem.id)}
          >
            <option value="Inter, system-ui, sans-serif">Inter</option>
            <option value="Arial, sans-serif">Arial</option>
            <option value="Georgia, serif">Georgia</option>
            <option value="'Courier New', monospace">Courier</option>
          </select>
          <Input
            type="number"
            min={10}
            max={48}
            className="h-8 w-16 px-2 text-xs"
            value={selectedTextStyle.fontSize}
            onChange={(e) =>
              updateItem(selectedItem.id, {
                textStyle: { ...selectedTextStyle, fontSize: Math.max(10, Math.min(48, Number(e.target.value || 14))) },
              })
            }
            disabled={!canEdit || isLockedByOther(selectedItem.id)}
          />
          <Button
            size="sm"
            variant={selectedTextStyle.fontWeight === '600' ? 'default' : 'outline'}
            onClick={() =>
              updateItem(selectedItem.id, {
                textStyle: { ...selectedTextStyle, fontWeight: selectedTextStyle.fontWeight === '600' ? 'normal' : '600' },
              })
            }
            disabled={!canEdit || isLockedByOther(selectedItem.id)}
            className="h-8 px-2 text-xs"
          >
            B
          </Button>
          <Button
            size="sm"
            variant={selectedTextStyle.fontStyle === 'italic' ? 'default' : 'outline'}
            onClick={() =>
              updateItem(selectedItem.id, {
                textStyle: { ...selectedTextStyle, fontStyle: selectedTextStyle.fontStyle === 'italic' ? 'normal' : 'italic' },
              })
            }
            disabled={!canEdit || isLockedByOther(selectedItem.id)}
            className="h-8 px-2 text-xs italic"
          >
            I
          </Button>
          {selectedItem.type === 'postit' && (
            <div className="flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1">
              <span className="text-slate-500">Sfondo</span>
              <Input
                type="color"
                value={selectedItem.color}
                onChange={(e) => updateItem(selectedItem.id, { color: e.target.value })}
                className="h-7 w-9 cursor-pointer p-1"
                disabled={!canEdit || isLockedByOther(selectedItem.id)}
              />
            </div>
          )}
        </div>
      )}

      <div
        ref={canvasRef}
        className="relative flex-1 overflow-auto bg-white"
        style={{
          backgroundImage:
            'radial-gradient(circle at 1px 1px, rgba(148,163,184,0.35) 1px, transparent 0)',
          backgroundSize: '20px 20px',
        }}
        onClick={onCanvasClick}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onMouseDown={onMouseDownDraw}
        onDragEnter={(e) => {
          e.preventDefault()
          if (canEdit) setIsDropActive(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDropActive(false)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          if (canEdit) {
            e.dataTransfer.dropEffect = 'copy'
            setIsDropActive(true)
          }
        }}
        onDrop={handleDropFiles}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <defs>
            <marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#334155" />
            </marker>
          </defs>
          {canvasDoc.items.filter((item) => item.type === 'connector').map((item) => renderConnector(item as Extract<CanvasItem, { type: 'connector' }>))}
          {canvasDoc.items.filter((item) => item.type === 'path').map((item) => renderPath(item as Extract<CanvasItem, { type: 'path' }>))}
          {previewPoints.length > 1 && (
            <path
              d={previewPoints.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')}
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>
        {isDropActive && canEdit && (
          <div className="pointer-events-none absolute inset-4 z-20 rounded-xl border-2 border-dashed border-blue-400 bg-blue-50/70">
            <div className="flex h-full items-center justify-center text-sm font-medium text-blue-700">Rilascia qui immagini o file</div>
          </div>
        )}

        {canvasDoc.items
          .filter((item) => item.type !== 'path' && item.type !== 'connector')
          .map((item) => {
            const lockedByOther = isLockedByOther(item.id)
            const isEditing = editingId === item.id
            return (
              <div
                key={item.id}
                className={`absolute ${selectedId === item.id ? 'ring-2 ring-blue-500' : ''} ${lockedByOther ? 'opacity-70' : ''}`}
                style={{
                  left: isPositioned(item) ? item.x : 0,
                  top: isPositioned(item) ? item.y : 0,
                  width: isPositioned(item) ? item.w : 0,
                  height: isPositioned(item) ? item.h : 0,
                }}
                onMouseDown={(e) => onMouseDownItem(e, item)}
                onDoubleClick={() => {
                  if (!canEdit || lockedByOther) return
                  if (item.type === 'postit' || item.type === 'frame' || item.type === 'text') {
                    setEditingId(item.id)
                    setSelectedId(item.id)
                  }
                }}
              >
                {item.type === 'postit' && (
                  <textarea
                    value={item.text}
                    onFocus={() => emitLock(item.id)}
                    onBlur={() => emitUnlock(item.id)}
                    onChange={(e) => updateItem(item.id, { text: e.target.value })}
                    className="h-full w-full resize-none rounded-md border-0 p-2 text-sm shadow"
                    style={{
                      background: item.color,
                      fontFamily: item.textStyle?.fontFamily || DEFAULT_TEXT_STYLE.fontFamily,
                      fontSize: `${item.textStyle?.fontSize || DEFAULT_TEXT_STYLE.fontSize}px`,
                      fontWeight: item.textStyle?.fontWeight || DEFAULT_TEXT_STYLE.fontWeight,
                      fontStyle: item.textStyle?.fontStyle || DEFAULT_TEXT_STYLE.fontStyle,
                    }}
                    disabled={!canEdit || lockedByOther}
                    readOnly={!isEditing}
                    autoFocus={isEditing}
                    onBlurCapture={() => setEditingId((prev) => (prev === item.id ? null : prev))}
                  />
                )}

                {item.type === 'frame' && (
                  <div className="flex h-full w-full flex-col rounded-md border-2 border-dashed bg-white/75" style={{ borderColor: item.color }}>
                    <input
                      value={item.text}
                      onFocus={() => emitLock(item.id)}
                    onBlur={() => emitUnlock(item.id)}
                    onChange={(e) => updateItem(item.id, { text: e.target.value })}
                    className="w-full border-b border-dashed bg-transparent px-2 py-1 text-xs"
                    style={{
                      fontFamily: item.textStyle?.fontFamily || DEFAULT_TEXT_STYLE.fontFamily,
                      fontSize: `${item.textStyle?.fontSize || 12}px`,
                      fontWeight: item.textStyle?.fontWeight || DEFAULT_TEXT_STYLE.fontWeight,
                      fontStyle: item.textStyle?.fontStyle || DEFAULT_TEXT_STYLE.fontStyle,
                    }}
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
                    className="h-full w-full resize-none rounded-md border border-slate-300 bg-white p-2 text-sm"
                    style={{
                      color: item.color,
                      fontFamily: item.textStyle?.fontFamily || DEFAULT_TEXT_STYLE.fontFamily,
                      fontSize: `${item.textStyle?.fontSize || DEFAULT_TEXT_STYLE.fontSize}px`,
                      fontWeight: item.textStyle?.fontWeight || DEFAULT_TEXT_STYLE.fontWeight,
                      fontStyle: item.textStyle?.fontStyle || DEFAULT_TEXT_STYLE.fontStyle,
                    }}
                    disabled={!canEdit || lockedByOther}
                    readOnly={!isEditing}
                    autoFocus={isEditing}
                    onBlurCapture={() => setEditingId((prev) => (prev === item.id ? null : prev))}
                  />
                )}

                {item.type === 'shape' && (
                  <svg className="h-full w-full overflow-visible rounded-md" viewBox={`0 0 ${item.w} ${item.h}`}>
                    {item.shape === 'rounded-rect' && (
                      <rect x="3" y="3" width={Math.max(item.w - 6, 1)} height={Math.max(item.h - 6, 1)} rx="18" ry="18" fill={item.fill} stroke={item.stroke} strokeWidth="2.5" />
                    )}
                    {item.shape === 'triangle' && (
                      <polygon points={`${item.w / 2},4 ${item.w - 4},${item.h - 4} 4,${item.h - 4}`} fill={item.fill} stroke={item.stroke} strokeWidth="2.5" />
                    )}
                    {item.shape === 'parallelogram' && (
                      <polygon points={`24,4 ${item.w - 4},4 ${item.w - 24},${item.h - 4} 4,${item.h - 4}`} fill={item.fill} stroke={item.stroke} strokeWidth="2.5" />
                    )}
                  </svg>
                )}

                {item.type === 'image' && (
                  <img src={item.src} alt="canvas" className="h-full w-full rounded-md object-cover shadow" draggable={false} />
                )}

                {item.type === 'table' && (
                  <div className="h-full w-full overflow-auto rounded-md border bg-white">
                    <table className="min-w-full border-collapse text-xs">
                      <tbody>
                        {item.data.map((row, rowIdx) => (
                          <tr key={`${item.id}-r-${rowIdx}`}>
                            {row.map((cell, colIdx) => (
                              <td key={`${item.id}-c-${rowIdx}-${colIdx}`} className="border px-1 py-0.5">
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {canEdit && (item.type === 'postit' || item.type === 'frame' || item.type === 'text' || item.type === 'shape' || item.type === 'image') && !lockedByOther && (
                  <button
                    type="button"
                    className="absolute bottom-1 right-1 h-3 w-3 cursor-se-resize rounded-sm border border-slate-500 bg-white/90 shadow-sm"
                    onMouseDown={(e) => {
                      e.stopPropagation()
                      if (!isPositioned(item)) return
                      if (isLockedByOther(item.id)) return
                      beginInteraction()
                      emitLock(item.id)
                      draggingRef.current = null
                      resizingRef.current = {
                        id: item.id,
                        startX: e.clientX,
                        startY: e.clientY,
                        startW: item.w,
                        startH: item.h,
                      }
                    }}
                    title="Ridimensiona"
                  />
                )}
              </div>
            )
          })}
      </div>
    </div>
  )
}
