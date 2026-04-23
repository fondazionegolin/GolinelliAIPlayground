import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import ReactGridLayout from 'react-grid-layout'
import type { Layout, LayoutItem } from 'react-grid-layout'
import { noCompactor } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'
import { Plus, Palette, Loader2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { desktopApi } from '@/lib/api'
import WidgetShell from '@/components/desktop/WidgetShell'
import WallpaperPicker, { getWallpaperStyle } from '@/components/desktop/WallpaperPicker'
import WidgetPalette from '@/components/desktop/WidgetPalette'
import DesktopSwitcher from '@/components/desktop/DesktopSwitcher'
import DesktopWidgetContent from '@/components/desktop/DesktopWidgetContent'
import FileViewerModal from '@/components/ui/FileViewerModal'
import { useWindowSize } from '@/hooks/useWindowSize'

function useContainerWidth() {
  const { width } = useWindowSize()
  return Math.max(600, width - 80)
}

interface Widget {
  id: string
  desktop_id: string
  widget_type: string
  grid_x: number
  grid_y: number
  grid_w: number
  grid_h: number
  config_json: Record<string, unknown>
  is_locked?: boolean
}

interface Desktop {
  id: string
  title: string
  wallpaper_key: string
  sort_order: number
  widgets: Widget[]
}

const COLS = 24
const ROW_HEIGHT = 40
const MARGIN: [number, number] = [12, 12]

// ── Layout helpers ────────────────────────────────────────────────────────────

function collides(a: LayoutItem, b: LayoutItem): boolean {
  return !(a.x + a.w <= b.x || a.x >= b.x + b.w || a.y + a.h <= b.y || a.y >= b.y + b.h)
}

function findFreeSlot(layout: readonly LayoutItem[], w: number, h: number, cols: number): { x: number; y: number } {
  const maxY = layout.reduce((m, item) => Math.max(m, item.y + item.h), 0)
  for (let y = 0; y <= maxY + 1; y++) {
    for (let x = 0; x <= cols - w; x++) {
      const candidate = { i: '__new__', x, y, w, h }
      if (!layout.some(item => collides(candidate, item))) return { x, y }
    }
  }
  return { x: 0, y: maxY }
}

function widgetsToLayout(widgets: Widget[]): LayoutItem[] {
  return widgets.map(w => ({
    i: w.id,
    x: w.grid_x,
    y: w.grid_y,
    w: w.grid_w,
    h: w.grid_h,
    minW: 3,
    minH: 2,
    static: !!w.is_locked,
  }))
}

// ── Main component ────────────────────────────────────────────────────────────

export default function DesktopPage({
  sessionId,
  sessionName,
  userType = 'student',
  accentColor,
}: {
  sessionId?: string
  sessionName?: string
  userType?: 'teacher' | 'student'
  accentColor?: string
} = {}) {
  const qc = useQueryClient()
  const [activeDesktopId, setActiveDesktopId] = useState<string | null>(null)
  const [showWallpaper, setShowWallpaper] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [viewingFile, setViewingFile] = useState<{ url: string; filename: string; type?: string } | null>(null)
  const containerWidth = useContainerWidth()

  // Ref to layout just before a drag starts — used for swap logic
  const preDragLayout = useRef<LayoutItem[] | null>(null)

  const { data: desktops = [], isLoading } = useQuery<Desktop[]>({
    queryKey: ['desktops'],
    queryFn: async () => {
      const res = await desktopApi.listDesktops()
      return res.data
    },
  })

  useEffect(() => {
    if (desktops.length > 0 && !activeDesktopId) {
      setActiveDesktopId(desktops[0].id)
    }
    if (activeDesktopId && !desktops.find(d => d.id === activeDesktopId)) {
      setActiveDesktopId(desktops[0]?.id ?? null)
    }
  }, [desktops, activeDesktopId])

  const activeDesktop = desktops.find(d => d.id === activeDesktopId)

  // ── Mutations ────────────────────────────────────────────────────────────────

  const createDesktop = useMutation({
    mutationFn: (data: { title?: string; wallpaper_key?: string }) => desktopApi.createDesktop(data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['desktops'] })
      setActiveDesktopId(res.data.id)
    },
  })

  const updateDesktop = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { title?: string; wallpaper_key?: string } }) =>
      desktopApi.updateDesktop(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['desktops'] }),
  })

  const deleteDesktop = useMutation({
    mutationFn: (id: string) => desktopApi.deleteDesktop(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['desktops'] }),
  })

  const addWidget = useMutation({
    mutationFn: ({ desktopId, data }: {
      desktopId: string
      data: { widget_type: string; grid_x?: number; grid_y?: number; grid_w?: number; grid_h?: number; config_json?: Record<string, unknown> }
    }) => desktopApi.addWidget(desktopId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['desktops'] }),
  })

  const updateWidget = useMutation({
    mutationFn: ({ desktopId, widgetId, data }: {
      desktopId: string; widgetId: string
      data: { grid_x?: number; grid_y?: number; grid_w?: number; grid_h?: number; config_json?: Record<string, unknown> }
    }) => desktopApi.updateWidget(desktopId, widgetId, data),
    onMutate: async ({ desktopId, widgetId, data }) => {
      await qc.cancelQueries({ queryKey: ['desktops'] })
      const prev = qc.getQueryData<Desktop[]>(['desktops'])
      qc.setQueryData<Desktop[]>(['desktops'], old =>
        old ? old.map(d => d.id !== desktopId ? d : {
          ...d,
          widgets: d.widgets.map(w => w.id !== widgetId ? w : {
            ...w,
            ...(data.grid_x !== undefined ? { grid_x: data.grid_x } : {}),
            ...(data.grid_y !== undefined ? { grid_y: data.grid_y } : {}),
            ...(data.grid_w !== undefined ? { grid_w: data.grid_w } : {}),
            ...(data.grid_h !== undefined ? { grid_h: data.grid_h } : {}),
            ...(data.config_json !== undefined ? { config_json: data.config_json } : {}),
          })
        }) : old
      )
      return { prev }
    },
    onError: (_err, _vars, context) => {
      if (context?.prev) qc.setQueryData(['desktops'], context.prev)
    },
  })

  const deleteWidget = useMutation({
    mutationFn: ({ desktopId, widgetId }: { desktopId: string; widgetId: string }) =>
      desktopApi.deleteWidget(desktopId, widgetId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['desktops'] }),
  })

  // ── Smart drag: capture layout before drag starts ────────────────────────────

  const handleDragStart = useCallback((_layout: Layout, _oldItem: LayoutItem | null) => {
    if (activeDesktop) {
      preDragLayout.current = widgetsToLayout(activeDesktop.widgets)
    }
  }, [activeDesktop])

  // ── Smart drag: swap on stop ─────────────────────────────────────────────────

  const handleDragStop = useCallback((
    _layout: Layout,
    oldItem: LayoutItem | null,
    newItem: LayoutItem | null
  ) => {
    if (!activeDesktop || !newItem || !oldItem) return

    const currentLayout = widgetsToLayout(activeDesktop.widgets)

    // Find first item that the dragged widget overlaps at its new position (excluding itself)
    const newItemLayout: LayoutItem = { i: newItem.i, x: newItem.x, y: newItem.y, w: newItem.w, h: newItem.h }
    const overlapping = currentLayout.find(l => l.i !== newItem.i && collides(newItemLayout, l))

    // Save moved widget
    updateWidget.mutate({
      desktopId: activeDesktop.id,
      widgetId: newItem.i,
      data: { grid_x: newItem.x, grid_y: newItem.y, grid_w: newItem.w, grid_h: newItem.h },
    })

    if (overlapping) {
      // Try to swap: put overlapping widget at oldItem's position
      const swapCandidate: LayoutItem = {
        i: overlapping.i,
        x: oldItem.x,
        y: oldItem.y,
        w: overlapping.w,
        h: overlapping.h,
      }

      // Check if swap position is free (excluding both dragged item and the item being swapped)
      const rest = currentLayout.filter(l => l.i !== newItem.i && l.i !== overlapping.i)
      const swapFits = !rest.some(l => collides(swapCandidate, l))

      if (swapFits) {
        // Clean swap
        updateWidget.mutate({
          desktopId: activeDesktop.id,
          widgetId: overlapping.i,
          data: { grid_x: oldItem.x, grid_y: oldItem.y },
        })
      } else {
        // Find nearest free slot for the displaced widget
        const layoutWithoutBoth = currentLayout.filter(l => l.i !== newItem.i && l.i !== overlapping.i)
        const freeSlot = findFreeSlot(
          [...layoutWithoutBoth, newItemLayout],
          overlapping.w,
          overlapping.h,
          COLS
        )
        updateWidget.mutate({
          desktopId: activeDesktop.id,
          widgetId: overlapping.i,
          data: { grid_x: freeSlot.x, grid_y: freeSlot.y },
        })
      }
    }

    preDragLayout.current = null
  }, [activeDesktop, updateWidget])

  // ── Resize stop ──────────────────────────────────────────────────────────────

  const handleResizeStop = useCallback((
    _layout: Layout,
    _oldItem: LayoutItem | null,
    newItem: LayoutItem | null
  ) => {
    if (!activeDesktop || !newItem) return
    updateWidget.mutate({
      desktopId: activeDesktop.id,
      widgetId: newItem.i,
      data: { grid_x: newItem.x, grid_y: newItem.y, grid_w: newItem.w, grid_h: newItem.h },
    })
  }, [activeDesktop, updateWidget])

  // ── Add widget at free slot ──────────────────────────────────────────────────

  const handleAddWidget = useCallback((widgetType: string, defaultConfig: Record<string, unknown>) => {
    if (!activeDesktopId || !activeDesktop) return
    const { w, h, ...config } = defaultConfig
    const wNum = (w as number) ?? 4
    const hNum = (h as number) ?? 3
    const currentLayout = widgetsToLayout(activeDesktop.widgets)
    const { x, y } = findFreeSlot(currentLayout, wNum, hNum, COLS)
    addWidget.mutate({
      desktopId: activeDesktopId,
      data: { widget_type: widgetType, grid_x: x, grid_y: y, grid_w: wNum, grid_h: hNum, config_json: config },
    })
  }, [activeDesktopId, activeDesktop, addWidget])

  // ── Drop from chat ───────────────────────────────────────────────────────────

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
    if (!activeDesktopId || !activeDesktop) return

    const noteData = e.dataTransfer.getData('desktop/note')
    const fileData = e.dataTransfer.getData('desktop/file') || e.dataTransfer.getData('application/x-session-file')
    const currentLayout = widgetsToLayout(activeDesktop.widgets)

    if (noteData) {
      const parsed = JSON.parse(noteData)
      const { x, y } = findFreeSlot(currentLayout, 4, 4, COLS)
      addWidget.mutate({
        desktopId: activeDesktopId,
        data: {
          widget_type: 'NOTE',
          grid_x: x, grid_y: y, grid_w: 4, grid_h: 4,
          config_json: { text: `${parsed.sender_name}: ${parsed.text}`, color: '#bfdbfe' },
        },
      })
    } else if (fileData) {
      const parsed = JSON.parse(fileData)
      const fileId = parsed.file_id ?? parsed.id
      const isImage = parsed.mime_type?.startsWith('image/')
      const { x, y } = findFreeSlot(currentLayout, 4, isImage ? 4 : 3, COLS)
      addWidget.mutate({
        desktopId: activeDesktopId,
        data: {
          widget_type: isImage ? 'IMAGE_REF' : 'FILE_REF',
          grid_x: x, grid_y: y, grid_w: 4, grid_h: isImage ? 4 : 3,
          config_json: { file_id: fileId, filename: parsed.filename, mime_type: parsed.mime_type, url: parsed.url },
        },
      })
    }
  }, [activeDesktopId, activeDesktop, addWidget])

  // Dot grid style — computed unconditionally (hooks must not be called after early returns)
  const dotStyle = useMemo(() => {
    const cellW = (containerWidth - MARGIN[0] * (COLS + 1)) / COLS
    const dotStepX = cellW + MARGIN[0]
    const dotStepY = ROW_HEIGHT + MARGIN[1]
    return {
      backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.14) 1.5px, transparent 1.5px)',
      backgroundSize: `${dotStepX}px ${dotStepY}px`,
      backgroundPosition: `${MARGIN[0]}px ${MARGIN[1]}px`,
    }
  }, [containerWidth])

  const btnAccent = accentColor ?? (userType === 'teacher' ? '#6366f1' : '#8b5cf6')

  // ── Render ───────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-white/30" />
      </div>
    )
  }

  const bgStyle = activeDesktop ? getWallpaperStyle(activeDesktop.wallpaper_key) : '#0f172a'

  return (
    <div
      className="h-full flex flex-col overflow-hidden"
      style={{ background: bgStyle }}
      onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-white/5 bg-black/10 backdrop-blur-md">
        <DesktopSwitcher
          desktops={desktops}
          activeId={activeDesktopId ?? ''}
          onSwitch={setActiveDesktopId}
          onCreate={() => createDesktop.mutate({ title: `Desktop ${desktops.length + 1}` })}
          onRename={(id, title) => updateDesktop.mutate({ id, data: { title } })}
          onDelete={(id) => deleteDesktop.mutate(id)}
        />
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-1.5 h-7 px-3 rounded-full bg-white/5 hover:bg-white/10 transition-colors text-xs text-white/50 hover:text-white/80"
            onClick={() => setShowWallpaper(true)}
          >
            <Palette className="h-3.5 w-3.5" />
            Sfondo
          </button>
          <button
            className="flex items-center gap-1.5 h-7 px-3 rounded-full transition-colors text-xs text-white font-medium shadow-sm"
            style={{ background: btnAccent }}
            onClick={() => setShowPalette(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Widget
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div
        className={`flex-1 overflow-auto relative transition-all duration-200 ${isDragOver ? 'ring-2 ring-inset ring-cyan-400/40' : ''}`}
      >
        {/* Dot grid overlay */}
        <div className="absolute inset-0 pointer-events-none z-0" style={dotStyle} />

        {activeDesktop && (
          <ReactGridLayout
            className="layout"
            layout={widgetsToLayout(activeDesktop.widgets) as Layout}
            width={containerWidth}
            gridConfig={{ cols: COLS, rowHeight: ROW_HEIGHT, margin: MARGIN }}
            dragConfig={{ enabled: true, handle: '.drag-handle' }}
            resizeConfig={{ enabled: true }}
            compactor={noCompactor}
            onDragStart={handleDragStart}
            onDragStop={handleDragStop}
            onResizeStop={handleResizeStop}
          >
            {activeDesktop.widgets.map(widget => (
              <div key={widget.id} className="overflow-hidden">
                <WidgetShell
                  widgetType={widget.widget_type}
                  onDelete={() => deleteWidget.mutate({ desktopId: activeDesktop.id, widgetId: widget.id })}
                  locked={!!widget.is_locked}
                >
                  <DesktopWidgetContent
                    widget={widget}
                    onConfigChange={(config) => {
                      updateWidget.mutate({
                        desktopId: activeDesktop.id,
                        widgetId: widget.id,
                        data: { config_json: config },
                      })
                    }}
                    onOpenFile={setViewingFile}
                    userType={userType}
                    sessionName={sessionName}
                    readOnly={!!widget.is_locked}
                  />
                </WidgetShell>
              </div>
            ))}
          </ReactGridLayout>
        )}

        {activeDesktop?.widgets.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
            <div className="text-white/10 text-6xl select-none">✦</div>
            <p className="text-sm text-white/20">Aggiungi widget con il pulsante in alto, o trascina contenuti dalla chat</p>
          </div>
        )}
      </div>

      {/* Modals */}
      {showWallpaper && activeDesktop && (
        <WallpaperPicker
          current={activeDesktop.wallpaper_key}
          onSelect={(key) => {
            updateDesktop.mutate({ id: activeDesktop.id, data: { wallpaper_key: key } })
            setShowWallpaper(false)
          }}
          onClose={() => setShowWallpaper(false)}
        />
      )}

      {showPalette && (
        <WidgetPalette
          onAdd={handleAddWidget}
          onClose={() => setShowPalette(false)}
          sessionId={sessionId}
          sessionName={sessionName}
        />
      )}

      <FileViewerModal file={viewingFile} onClose={() => setViewingFile(null)} />
    </div>
  )
}
