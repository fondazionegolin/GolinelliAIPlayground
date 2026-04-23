import { useState, useRef, KeyboardEvent } from 'react'
import { Plus, CheckSquare2, Square } from 'lucide-react'

interface TaskItem {
  text: string
  done: boolean
}

interface TasklistConfig {
  title?: string
  items?: TaskItem[]
}

interface TasklistWidgetProps {
  config: TasklistConfig
  onConfigChange: (config: TasklistConfig) => void
  readOnly?: boolean
}

export default function TasklistWidget({ config, onConfigChange, readOnly = false }: TasklistWidgetProps) {
  const items = config.items ?? []
  const [newText, setNewText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const save = (newItems: TaskItem[]) => {
    onConfigChange({ ...config, items: newItems })
  }

  const toggle = (i: number) => {
    if (readOnly) return
    const updated = items.map((item, idx) => idx === i ? { ...item, done: !item.done } : item)
    save(updated)
  }

  const addItem = () => {
    if (readOnly) return
    const t = newText.trim()
    if (!t) return
    save([...items, { text: t, done: false }])
    setNewText('')
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (readOnly) return
    if (e.key === 'Enter') addItem()
  }

  return (
    <div className="h-full flex flex-col p-3 gap-2 overflow-hidden">
      {config.title && (
        <div className="text-sm font-semibold text-white/60 uppercase tracking-wider px-1">
          {config.title}
        </div>
      )}
      <div className="flex-1 overflow-y-auto flex flex-col gap-1 min-h-0">
        {items.map((item, i) => (
          <button
            key={i}
          className="flex items-start gap-2 text-left hover:bg-white/5 rounded-lg px-2 py-1.5 transition-colors group w-full"
          onClick={() => toggle(i)}
          disabled={readOnly}
        >
            {item.done
              ? <CheckSquare2 className="h-4 w-4 text-emerald-400 flex-shrink-0 mt-0.5" />
              : <Square className="h-4 w-4 text-white/30 flex-shrink-0 mt-0.5 group-hover:text-white/60" />
            }
            <span
              className={`text-base leading-snug ${item.done ? 'line-through text-white/30' : 'text-white/80'}`}
            >
              {item.text}
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t border-white/10 pt-2">
        <input
          ref={inputRef}
          value={newText}
          onChange={e => setNewText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={readOnly ? '' : "Aggiungi un'attività..."}
          readOnly={readOnly}
          className="flex-1 bg-transparent text-sm text-white/70 placeholder:text-white/25 outline-none"
        />
        <button
          onClick={addItem}
          disabled={readOnly}
          className="w-5 h-5 rounded-md bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
        >
          <Plus className="h-3 w-3 text-white/60" />
        </button>
      </div>
    </div>
  )
}
