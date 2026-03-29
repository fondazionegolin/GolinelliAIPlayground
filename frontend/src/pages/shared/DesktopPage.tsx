import { useEffect, useState, useCallback } from 'react'
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
import ClockWidget from '@/components/desktop/widgets/ClockWidget'
import NoteWidget from '@/components/desktop/widgets/NoteWidget'
import TasklistWidget from '@/components/desktop/widgets/TasklistWidget'
import CalendarWidget from '@/components/desktop/widgets/CalendarWidget'
import FileRefWidget from '@/components/desktop/widgets/FileRefWidget'
import ImageRefWidget from '@/components/desktop/widgets/ImageRefWidget'
import { useWindowSize } from '@/hooks/useWindowSize'

interface Widget {
  id: string
  desktop_id: string
  widget_type: string
  grid_x: number
  grid_y: number
  grid_w: number
  grid_h: number
  config_json: Record<string, unknown>
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
const MARGIN: [number, number] = [8, 8]

function widgetsToLayout(widgets: Widget[]): LayoutItem[] {
  return widgets.map(w => ({
    i: w.id,
    x: w.grid_x,
    y: w.grid_y,
    w: w.grid_w,
    h: w.grid_h,
    minW: 3,
    minH: 2,
  }))
}

function WidgetContent({
  widget,
  onConfigChange,
}: {
  widget: Widget
  onConfigChange: (config: Record<string, unknown>) => void
}) {
  switch (widget.widget_type) {
    case 'CLOCK':
      return <ClockWidget config={widget.config_json as Parameters<typeof ClockWidget>[0]['config']} />
    case 'NOTE':
      return (
        <NoteWidget
          config={widget.config_json as Parameters<typeof NoteWidget>[0]['config']}
          onConfigChange={onConfigChange as Parameters<typeof NoteWidget>[0]['onConfigChange']}
        />
      )
    case 'TASKLIST':
      return (
        <TasklistWidget
          config={widget.config_json as Parameters<typeof TasklistWidget>[0]['config']}
          onConfigChange={onConfigChange as Parameters<typeof TasklistWidget>[0]['onConfigChange']}
        />
      )
    case 'CALENDAR':
      return (
        <CalendarWidget
          config={widget.config_json as Parameters<typeof CalendarWidget>[0]['config']}
          onConfigChange={onConfigChange as Parameters<typeof CalendarWidget>[0]['onConfigChange']}
        />
      )
    case 'FILE_REF':
      return <FileRefWidget config={widget.config_json as Parameters<typeof FileRefWidget>[0]['config']} />
    case 'IMAGE_REF':
      return <ImageRefWidget config={widget.config_json as Parameters<typeof ImageRefWidget>[0]['config']} />
    default:
      return <div className="h-full flex items-center justify-center text-xs text-white/30">{widget.widget_type}</div>
  }
}

// Simple hook for container width
function useContainerWidth() {
  const { width } = useWindowSize()
  // Account for padding and sidebar: subtract ~80px for margins/padding
  return Math.max(600, width - 80)
}

export default function DesktopPage() {
  const qc = useQueryClient()
  const [activeDesktopId, setActiveDesktopId] = useState<string | null>(null)
  const [showWallpaper, setShowWallpaper] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const containerWidth = useContainerWidth()

  const { data: desktops = [], isLoading } = useQuery<Desktop[]>({
    queryKey: ['desktops'],
    queryFn: async () => {
      const res = await desktopApi.listDesktops()
      return res.data
    },
  })

  // Auto-select first desktop
  useEffect(() => {
    if (desktops.length > 0 && !activeDesktopId) {
      setActiveDesktopId(desktops[0].id)
    }
    if (activeDesktopId && !desktops.find(d => d.id === activeDesktopId)) {
      setActiveDesktopId(desktops[0]?.id ?? null)
    }
  }, [desktops, activeDesktopId])

  const activeDesktop = desktops.find(d => d.id === activeDesktopId)

  // --- Mutations ---
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
      desktopId: string
      widgetId: string
      data: { grid_x?: number; grid_y?: number; grid_w?: number; grid_h?: number; config_json?: Record<string, unknown> }
    }) => desktopApi.updateWidget(desktopId, widgetId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['desktops'] }),
  })

  const deleteWidget = useMutation({
    mutationFn: ({ desktopId, widgetId }: { desktopId: string; widgetId: string }) =>
      desktopApi.deleteWidget(desktopId, widgetId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['desktops'] }),
  })

  const handleLayoutChange = useCallback((layout: Layout) => {
    if (!activeDesktop) return
    ;[...layout].forEach(l => {
      const widget = activeDesktop.widgets.find(w => w.id === l.i)
      if (!widget) return
      if (widget.grid_x !== l.x || widget.grid_y !== l.y || widget.grid_w !== l.w || widget.grid_h !== l.h) {
        updateWidget.mutate({
          desktopId: activeDesktop.id,
          widgetId: l.i,
          data: { grid_x: l.x, grid_y: l.y, grid_w: l.w, grid_h: l.h },
        })
      }
    })
  }, [activeDesktop])

  const handleAddWidget = (widgetType: string, defaultConfig: Record<string, unknown>) => {
    if (!activeDesktopId) return
    const { w, h, ...config } = defaultConfig
    addWidget.mutate({
      desktopId: activeDesktopId,
      data: {
        widget_type: widgetType,
        grid_x: 0,
        grid_y: 0,
        grid_w: (w as number) ?? 4,
        grid_h: (h as number) ?? 3,
        config_json: config,
      },
    })
  }

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setIsDragOver(false)
    if (!activeDesktopId) return

    const noteData = e.dataTransfer.getData('desktop/note')
    const fileData = e.dataTransfer.getData('desktop/file') || e.dataTransfer.getData('application/x-session-file')

    if (noteData) {
      const parsed = JSON.parse(noteData)
      addWidget.mutate({
        desktopId: activeDesktopId,
        data: {
          widget_type: 'NOTE',
          grid_x: 0, grid_y: 0, grid_w: 4, grid_h: 4,
          config_json: { text: `${parsed.sender_name}: ${parsed.text}`, color: '#bfdbfe' },
        },
      })
    } else if (fileData) {
      const parsed = JSON.parse(fileData)
      const fileId = parsed.file_id ?? parsed.id
      addWidget.mutate({
        desktopId: activeDesktopId,
        data: {
          widget_type: parsed.mime_type?.startsWith('image/') ? 'IMAGE_REF' : 'FILE_REF',
          grid_x: 0, grid_y: 0, grid_w: 4, grid_h: 3,
          config_json: { file_id: fileId, filename: parsed.filename, mime_type: parsed.mime_type, url: parsed.url },
        },
      })
    }
  }, [activeDesktopId])

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
      <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-white/5">
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
            className="flex items-center gap-1.5 h-7 px-3 rounded-full bg-white/10 hover:bg-white/20 transition-colors text-xs text-white/70 hover:text-white"
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
        {activeDesktop && (
          <ReactGridLayout
            className="layout"
            layout={widgetsToLayout(activeDesktop.widgets) as Layout}
            width={containerWidth}
            gridConfig={{ cols: COLS, rowHeight: ROW_HEIGHT, margin: MARGIN }}
            dragConfig={{ enabled: true, handle: '.drag-handle' }}
            resizeConfig={{ enabled: true }}
            compactor={noCompactor}
            onLayoutChange={handleLayoutChange}
          >
            {activeDesktop.widgets.map(widget => (
              <div key={widget.id} className="overflow-hidden">
                <WidgetShell
                  widgetType={widget.widget_type}
                  onDelete={() => deleteWidget.mutate({ desktopId: activeDesktop.id, widgetId: widget.id })}
                >
                  <WidgetContent
                    widget={widget}
                    onConfigChange={(config) => {
                      updateWidget.mutate({
                        desktopId: activeDesktop.id,
                        widgetId: widget.id,
                        data: { config_json: config },
                      })
                    }}
                  />
                </WidgetShell>
              </div>
            ))}
          </ReactGridLayout>
        )}

        {activeDesktop?.widgets.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 pointer-events-none">
            <div className="text-white/10 text-6xl">✦</div>
            <p className="text-sm text-white/20">Aggiungi widget o trascina contenuti dalla chat</p>
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
        />
      )}
    </div>
  )
}
