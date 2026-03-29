import { ReactNode } from 'react'
import { X, GripHorizontal } from 'lucide-react'

interface WidgetShellProps {
  children: ReactNode
  onDelete: () => void
  widgetType: string
  className?: string
}

const TYPE_BORDER: Record<string, string> = {
  NOTE: 'border-l-amber-300/60',
  TASKLIST: 'border-l-emerald-400/60',
  FILE_REF: 'border-l-cyan-400/60',
  IMAGE_REF: 'border-l-violet-400/60',
  CLOCK: 'border-l-white/20',
  CALENDAR: 'border-l-blue-400/60',
}

export default function WidgetShell({ children, onDelete, widgetType, className = '' }: WidgetShellProps) {
  const borderColor = TYPE_BORDER[widgetType] ?? 'border-l-white/20'

  return (
    <div
      className={`
        group/widget relative h-full
        bg-white/5 backdrop-blur-md
        border border-white/10 border-l-2 ${borderColor}
        rounded-2xl overflow-hidden
        shadow-lg shadow-black/20
        ${className}
      `}
    >
      {/* Drag handle strip */}
      <div
        className="drag-handle absolute top-0 inset-x-0 h-6 flex items-center justify-center cursor-grab active:cursor-grabbing opacity-0 group-hover/widget:opacity-100 transition-opacity z-10"
      >
        <GripHorizontal className="h-3 w-3 text-white/30" />
      </div>

      {/* Delete button */}
      <button
        className="absolute top-1 right-1 w-5 h-5 rounded-md bg-black/30 backdrop-blur-sm flex items-center justify-center opacity-0 group-hover/widget:opacity-100 transition-opacity z-10 hover:bg-red-500/70"
        onClick={e => { e.stopPropagation(); onDelete() }}
        title="Rimuovi widget"
      >
        <X className="h-3 w-3 text-white" />
      </button>

      {/* Content */}
      <div className="h-full">
        {children}
      </div>
    </div>
  )
}
