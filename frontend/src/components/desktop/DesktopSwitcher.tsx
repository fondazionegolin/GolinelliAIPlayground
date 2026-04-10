import { useState, useRef, KeyboardEvent } from 'react'
import { Plus, X } from 'lucide-react'

interface Desktop {
  id: string
  title: string
}

interface DesktopSwitcherProps {
  desktops: Desktop[]
  activeId: string
  onSwitch: (id: string) => void
  onCreate: () => void
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  maxDesktops?: number
}

export default function DesktopSwitcher({
  desktops,
  activeId,
  onSwitch,
  onCreate,
  onRename,
  onDelete,
  maxDesktops = 10,
}: DesktopSwitcherProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const startEdit = (d: Desktop) => {
    setEditingId(d.id)
    setEditValue(d.title)
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  const commitEdit = (id: string) => {
    const v = editValue.trim()
    if (v && v !== desktops.find(d => d.id === id)?.title) {
      onRename(id, v)
    }
    setEditingId(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === 'Enter') commitEdit(id)
    if (e.key === 'Escape') setEditingId(null)
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {desktops.map(d => (
        <div
          key={d.id}
          className={`group/tab flex items-center gap-1.5 h-7 px-3 rounded-full cursor-pointer transition-all
            ${d.id === activeId
              ? 'bg-white/15 text-white/90'
              : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70'}
          `}
          onClick={() => onSwitch(d.id)}
          onDoubleClick={() => startEdit(d)}
        >
          {editingId === d.id ? (
            <input
              ref={inputRef}
              value={editValue}
              className="bg-transparent outline-none text-xs w-20 text-white/90"
              onChange={e => setEditValue(e.target.value)}
              onBlur={() => commitEdit(d.id)}
              onKeyDown={e => onKeyDown(e, d.id)}
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <span className="text-xs font-medium">{d.title}</span>
          )}
          {desktops.length > 1 && d.id === activeId && (
            <button
              className="w-3.5 h-3.5 rounded-full flex items-center justify-center opacity-0 group-hover/tab:opacity-100 hover:bg-white/20 transition-opacity"
              onClick={e => { e.stopPropagation(); onDelete(d.id) }}
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </div>
      ))}

      {desktops.length < maxDesktops && (
        <button
          className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center transition-colors"
          onClick={onCreate}
          title="Nuovo desktop"
        >
          <Plus className="h-3.5 w-3.5 text-white/40" />
        </button>
      )}
    </div>
  )
}
