import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { teacherApi, studentApi } from '@/lib/api'
import { Eraser, Square, StickyNote, Type, ImagePlus, Table, Pencil, Frame } from 'lucide-react'

type CanvasRole = 'teacher' | 'student'
type Tool = 'select' | 'postit' | 'frame' | 'text' | 'pen'

type Point = { x: number; y: number }

type CanvasItem =
  | { id: string; type: 'postit'; x: number; y: number; w: number; h: number; text: string; color: string }
  | { id: string; type: 'frame'; x: number; y: number; w: number; h: number; text: string; color: string }
  | { id: string; type: 'text'; x: number; y: number; w: number; h: number; text: string; color: string }
  | { id: string; type: 'image'; x: number; y: number; w: number; h: number; src: string }
  | { id: string; type: 'table'; x: number; y: number; w: number; h: number; data: string[][] }
  | { id: string; type: 'path'; points: Point[]; color: string; width: number }

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

const COLORS = ['#0f172a', '#2563eb', '#059669', '#9333ea', '#dc2626', '#d97706']

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
      return { type: 'canvas_v1', items: parsed.items }
    }
  } catch {
    // no-op
  }
  return EMPTY_CANVAS
}

const toCsvTable = (rows: Array<Array<string | number | boolean | null>>): string[][] =>
  rows.map((row) => row.map((cell) => (cell == null ? '' : String(cell))))

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
  const drawingRef = useRef<{ points: Point[] } | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const lastSerializedRef = useRef<string>('')

  const [tool, setTool] = useState<Tool>('select')
  const [strokeColor, setStrokeColor] = useState('#2563eb')
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [canvasDoc, setCanvasDoc] = useState<CanvasDoc>(() => parseCanvasDoc(initialContent))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const canEdit = !readOnly

  const serializedDoc = useMemo(() => JSON.stringify(canvasDoc), [canvasDoc])

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

    pollTimerRef.current = window.setInterval(() => {
      void fetchRemoteCanvas()
    }, 1200)

    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current)
    }
  }, [fetchRemoteCanvas, sessionId])

  useEffect(() => {
    const socket = (window as any).socket
    if (!socket || !sessionId) return

    const onCanvasUpdated = (payload: any) => {
      if (payload?.session_id !== sessionId) return
      const incomingVersion = Number(payload?.version || 0)
      if (incomingVersion <= version) return
      const remote = parseCanvasDoc(payload?.content_json)
      const remoteSerialized = JSON.stringify(remote)
      setVersion(incomingVersion)
      if (remoteSerialized !== lastSerializedRef.current) {
        setCanvasDoc(remote)
        lastSerializedRef.current = remoteSerialized
      }
    }

    socket.on('canvas_updated', onCanvasUpdated)
    return () => socket.off('canvas_updated', onCanvasUpdated)
  }, [sessionId, version])

  useEffect(() => {
    onContentChange?.(serializedDoc)
    if (!canEdit) return
    if (serializedDoc === lastSerializedRef.current) return

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      void pushRemoteCanvas(serializedDoc)
    }, 260)

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [serializedDoc, canEdit, onContentChange, pushRemoteCanvas])

  const createItem = (type: Tool, x: number, y: number): CanvasItem | null => {
    const id = crypto.randomUUID()
    if (type === 'postit') {
      return { id, type: 'postit', x, y, w: 200, h: 180, text: 'Nuovo post-it', color: '#fef08a' }
    }
    if (type === 'frame') {
      return { id, type: 'frame', x, y, w: 300, h: 220, text: 'Frame', color: '#3b82f6' }
    }
    if (type === 'text') {
      return { id, type: 'text', x, y, w: 260, h: 120, text: 'Testo', color: '#0f172a' }
    }
    return null
  }

  const updateItem = (id: string, patch: Partial<CanvasItem>) => {
    setCanvasDoc((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item.id === id ? ({ ...item, ...patch } as CanvasItem) : item)),
    }))
  }

  const onCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canEdit) return
    if (tool === 'select' || tool === 'pen') return

    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left - 80
    const y = e.clientY - rect.top - 50
    const item = createItem(tool, Math.max(20, x), Math.max(20, y))
    if (!item) return
    setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, item] }))
    setSelectedId(item.id)
    setTool('select')
  }

  const onMouseDownItem = (e: React.MouseEvent, item: CanvasItem) => {
    e.stopPropagation()
    setSelectedId(item.id)
    if (!canEdit) return
    if (item.type === 'path') return

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    draggingRef.current = {
      id: item.id,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    }
  }

  const onMouseDownDraw = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!canEdit || tool !== 'pen') return
    const rect = e.currentTarget.getBoundingClientRect()
    drawingRef.current = {
      points: [{ x: e.clientX - rect.left, y: e.clientY - rect.top }],
    }
  }

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()

    if (drawingRef.current && tool === 'pen' && canEdit) {
      drawingRef.current.points.push({ x: e.clientX - rect.left, y: e.clientY - rect.top })
      return
    }

    if (!draggingRef.current || !canEdit) return
    const drag = draggingRef.current

    setCanvasDoc((prev) => ({
      ...prev,
      items: prev.items.map((item) => {
        if (item.id !== drag.id || item.type === 'path') return item
        return {
          ...item,
          x: Math.max(0, e.clientX - rect.left - drag.offsetX),
          y: Math.max(0, e.clientY - rect.top - drag.offsetY),
        } as CanvasItem
      }),
    }))
  }

  const onMouseUp = () => {
    draggingRef.current = null
    if (drawingRef.current && canEdit && drawingRef.current.points.length > 1) {
      const path: CanvasItem = {
        id: crypto.randomUUID(),
        type: 'path',
        points: drawingRef.current.points,
        color: strokeColor,
        width: strokeWidth,
      }
      setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, path] }))
    }
    drawingRef.current = null
  }

  const deleteSelected = () => {
    if (!selectedId || !canEdit) return
    setCanvasDoc((prev) => ({ ...prev, items: prev.items.filter((item) => item.id !== selectedId) }))
    setSelectedId(null)
  }

  const handleDropFiles = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!canEdit) return
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files || [])
    if (files.length === 0) return

    const rect = e.currentTarget.getBoundingClientRect()
    let x = Math.max(20, e.clientX - rect.left)
    let y = Math.max(20, e.clientY - rect.top)

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const imageBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(String(reader.result || ''))
          reader.onerror = reject
          reader.readAsDataURL(file)
        })
        const imageItem: CanvasItem = {
          id: crypto.randomUUID(),
          type: 'image',
          x,
          y,
          w: 320,
          h: 220,
          src: imageBase64,
        }
        setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, imageItem] }))
        y += 30
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
        setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, tableItem] }))
        y += 34
      }
    }
  }

  const renderPath = (item: Extract<CanvasItem, { type: 'path' }>) => {
    const d = item.points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
    return <path key={item.id} d={d} stroke={item.color} strokeWidth={item.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
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
          <Button size="sm" variant={tool === 'pen' ? 'default' : 'outline'} onClick={() => setTool('pen')}><Pencil className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" onClick={deleteSelected} disabled={!selectedId || !canEdit}><Eraser className="h-4 w-4" /></Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setStrokeColor(c)}
                className={`h-5 w-5 rounded-full border ${strokeColor === c ? 'ring-2 ring-slate-400' : ''}`}
                style={{ backgroundColor: c }}
                aria-label={`colore ${c}`}
              />
            ))}
          </div>
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
        </div>
      </div>

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
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDropFiles}
      >
        <svg className="pointer-events-none absolute inset-0 h-full w-full">{canvasDoc.items.filter((item) => item.type === 'path').map((item) => renderPath(item as Extract<CanvasItem, { type: 'path' }>))}</svg>

        {canvasDoc.items
          .filter((item) => item.type !== 'path')
          .map((item) => (
            <div
              key={item.id}
              className={`absolute ${selectedId === item.id ? 'ring-2 ring-blue-500' : ''}`}
              style={{
                left: (item as any).x,
                top: (item as any).y,
                width: (item as any).w,
                height: (item as any).h,
              }}
              onMouseDown={(e) => onMouseDownItem(e, item)}
            >
              {item.type === 'postit' && (
                <textarea
                  value={item.text}
                  onChange={(e) => updateItem(item.id, { text: e.target.value })}
                  className="h-full w-full resize-none rounded-md border-0 p-2 text-sm shadow"
                  style={{ background: item.color }}
                  disabled={!canEdit}
                />
              )}

              {item.type === 'frame' && (
                <div className="flex h-full w-full flex-col rounded-md border-2 border-dashed bg-white/75" style={{ borderColor: item.color }}>
                  <input
                    value={item.text}
                    onChange={(e) => updateItem(item.id, { text: e.target.value })}
                    className="w-full border-b border-dashed bg-transparent px-2 py-1 text-xs font-semibold"
                    disabled={!canEdit}
                  />
                </div>
              )}

              {item.type === 'text' && (
                <textarea
                  value={item.text}
                  onChange={(e) => updateItem(item.id, { text: e.target.value })}
                  className="h-full w-full resize-none rounded-md border border-slate-300 bg-white p-2 text-sm"
                  style={{ color: item.color }}
                  disabled={!canEdit}
                />
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
            </div>
          ))}
      </div>
    </div>
  )
}
