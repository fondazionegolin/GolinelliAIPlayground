import { useState } from 'react'
import { Circle, Eye, EyeOff, GripVertical, Image as ImageIcon, Lock, Minus, Square, Type, Unlock } from 'lucide-react'
import type { SlideBlock } from '@/components/SlideEditor'
import { reorderBlockLayer, toggleBlockHidden, toggleBlockLocked } from '@/lib/slideBlocks'

interface SlideLayersPanelProps {
  blocks: SlideBlock[]
  onChange: (blocks: SlideBlock[]) => void
  selectedBlockId: string | null
  onSelectBlock: (id: string | null) => void
}

const TYPE_ICON: Record<SlideBlock['type'], typeof Type> = {
  text: Type,
  image: ImageIcon,
  rectangle: Square,
  ellipse: Circle,
  line: Minus,
}

function blockLabel(block: SlideBlock): string {
  if (block.type === 'text') {
    const plain = block.content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return plain ? plain.slice(0, 40) : 'Testo vuoto'
  }
  if (block.type === 'image') return 'Immagine'
  if (block.type === 'rectangle') return 'Rettangolo'
  if (block.type === 'ellipse') return 'Ellisse'
  return 'Linea'
}

/** Per-slide layer list: select-through-occlusion, lock/hide toggles, drag reorder. Mirrors the canvas context menu's layer actions (shared helpers in lib/slideBlocks) so both stay in sync. */
export function SlideLayersPanel({ blocks, onChange, selectedBlockId, onSelectBlock }: SlideLayersPanelProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const topToBottom = blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => (b.block.zIndex ?? b.index) - (a.block.zIndex ?? a.index))

  const handleDrop = (targetId: string) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null)
      setDragOverId(null)
      return
    }
    const order = blocks
      .map((block, index) => ({ block, index }))
      .sort((a, b) => (a.block.zIndex ?? a.index) - (b.block.zIndex ?? b.index))
      .map(({ block }) => block)
    const targetIndex = order.findIndex(b => b.id === targetId)
    onChange(reorderBlockLayer(blocks, draggingId, targetIndex))
    setDraggingId(null)
    setDragOverId(null)
  }

  if (!blocks.length) {
    return <div className="px-3 py-6 text-center text-xs text-slate-400">Nessun oggetto in questa slide.</div>
  }

  return (
    <div className="flex flex-col gap-0.5 p-1.5">
      {topToBottom.map(({ block }) => {
        const Icon = TYPE_ICON[block.type]
        const isSelected = selectedBlockId === block.id
        return (
          <div
            key={block.id}
            draggable
            onDragStart={() => setDraggingId(block.id)}
            onDragOver={(e) => { e.preventDefault(); setDragOverId(block.id) }}
            onDragLeave={() => setDragOverId(current => current === block.id ? null : current)}
            onDrop={() => handleDrop(block.id)}
            onDragEnd={() => { setDraggingId(null); setDragOverId(null) }}
            onClick={() => onSelectBlock(block.id)}
            className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm cursor-pointer transition-colors ${
              isSelected ? 'bg-blue-50 text-blue-900 ring-1 ring-blue-300' : 'hover:bg-slate-100 text-slate-700'
            } ${dragOverId === block.id && draggingId !== block.id ? 'border-t-2 border-blue-400' : 'border-t-2 border-transparent'} ${block.hidden ? 'opacity-50' : ''}`}
          >
            <GripVertical className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-400" />
            <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="flex-1 truncate">{blockLabel(block)}</span>
            <button
              type="button"
              title={block.locked ? 'Sblocca' : 'Blocca'}
              className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              onClick={(e) => { e.stopPropagation(); onChange(toggleBlockLocked(blocks, block.id)) }}
            >
              {block.locked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />}
            </button>
            <button
              type="button"
              title={block.hidden ? 'Mostra' : 'Nascondi'}
              className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
              onClick={(e) => {
                e.stopPropagation()
                onChange(toggleBlockHidden(blocks, block.id))
                if (isSelected && !block.hidden) onSelectBlock(null)
              }}
            >
              {block.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5 opacity-0 group-hover:opacity-100" />}
            </button>
          </div>
        )
      })}
    </div>
  )
}
