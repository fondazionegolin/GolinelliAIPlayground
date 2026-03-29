import { X, Clock, Calendar, StickyNote, CheckSquare, FileText, Image } from 'lucide-react'

interface WidgetPaletteProps {
  onAdd: (widgetType: string, defaultConfig: Record<string, unknown>) => void
  onClose: () => void
}

const PALETTE_ITEMS = [
  {
    type: 'CLOCK',
    label: 'Orologio',
    description: 'Orologio digitale animato',
    icon: Clock,
    color: 'text-cyan-400',
    bg: 'bg-cyan-400/10',
    defaultConfig: { style: 'digital', show_seconds: true, show_date: true },
    defaultSize: { w: 6, h: 3 },
  },
  {
    type: 'CALENDAR',
    label: 'Calendario',
    description: 'Calendario mensile con note',
    icon: Calendar,
    color: 'text-blue-400',
    bg: 'bg-blue-400/10',
    defaultConfig: { notes: {} },
    defaultSize: { w: 6, h: 5 },
  },
  {
    type: 'NOTE',
    label: 'Post-it',
    description: 'Nota libera colorata',
    icon: StickyNote,
    color: 'text-amber-400',
    bg: 'bg-amber-400/10',
    defaultConfig: { text: '', color: '#fef08a' },
    defaultSize: { w: 4, h: 4 },
  },
  {
    type: 'TASKLIST',
    label: 'Lista compiti',
    description: 'Lista di attività con checkbox',
    icon: CheckSquare,
    color: 'text-emerald-400',
    bg: 'bg-emerald-400/10',
    defaultConfig: { title: 'Da fare', items: [] },
    defaultSize: { w: 5, h: 5 },
  },
  {
    type: 'FILE_REF',
    label: 'Riferimento file',
    description: 'Link rapido a un documento',
    icon: FileText,
    color: 'text-violet-400',
    bg: 'bg-violet-400/10',
    defaultConfig: { filename: 'File', mime_type: '' },
    defaultSize: { w: 4, h: 3 },
  },
  {
    type: 'IMAGE_REF',
    label: 'Immagine',
    description: 'Immagine con anteprima',
    icon: Image,
    color: 'text-pink-400',
    bg: 'bg-pink-400/10',
    defaultConfig: { url: '', filename: '' },
    defaultSize: { w: 5, h: 4 },
  },
]

export default function WidgetPalette({ onAdd, onClose }: WidgetPaletteProps) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="relative bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-sm"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold text-white/80">Aggiungi widget</h3>
          <button
            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5 text-white/60" />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          {PALETTE_ITEMS.map(item => {
            const Icon = item.icon
            return (
              <button
                key={item.type}
                className="flex items-center gap-3 p-3 rounded-xl hover:bg-white/5 transition-colors text-left group"
                onClick={() => {
                  onAdd(item.type, { ...item.defaultConfig, ...item.defaultSize })
                  onClose()
                }}
              >
                <div className={`w-9 h-9 rounded-xl ${item.bg} flex items-center justify-center flex-shrink-0`}>
                  <Icon className={`h-4.5 w-4.5 ${item.color}`} />
                </div>
                <div>
                  <div className="text-sm font-medium text-white/80 group-hover:text-white transition-colors">
                    {item.label}
                  </div>
                  <div className="text-xs text-white/35">{item.description}</div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
