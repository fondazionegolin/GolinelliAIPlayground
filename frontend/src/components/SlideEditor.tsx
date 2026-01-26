import { useState, useRef, useEffect } from 'react'

export interface SlideBlock {
  id: string
  type: 'text' | 'image'
  content: string
  x: number
  y: number
  width: number
  height: number
  style: {
    fontFamily?: string
    fontSize?: number
    color?: string
    backgroundColor?: string
    fontWeight?: string
    fontStyle?: string
    textDecoration?: string
    textAlign?: 'left' | 'center' | 'right' | 'justify'
    borderRadius?: number
    padding?: number
  }
}

interface SlideEditorProps {
  blocks: SlideBlock[]
  onChange: (blocks: SlideBlock[]) => void
  selectedBlockId: string | null
  onSelectBlock: (id: string | null) => void
  scale?: number
  readOnly?: boolean
}

export function SlideEditor({ 
  blocks, 
  onChange, 
  selectedBlockId, 
  onSelectBlock, 
  scale = 1, 
  readOnly = false 
}: SlideEditorProps) {
  const [dragState, setDragState] = useState<{
    isDragging: boolean
    isResizing: boolean
    handle?: string
    startX: number
    startY: number
    initialBlock: SlideBlock | null
  } | null>(null)
  
  const canvasRef = useRef<HTMLDivElement>(null)

  // Handle Canvas Click (Deselect)
  const handleCanvasClick = (e: React.MouseEvent) => {
    if (e.target === canvasRef.current) {
      onSelectBlock(null)
    }
  }

  // Handle Drag & Resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState || !dragState.initialBlock) return

      // Adjust delta by scale to ensure smooth movement regardless of zoom
      const deltaX = (e.clientX - dragState.startX) / scale
      const deltaY = (e.clientY - dragState.startY) / scale
      
      const newBlocks = blocks.map(b => {
        if (b.id !== dragState.initialBlock!.id) return b

        if (dragState.isDragging) {
          return {
            ...b,
            x: dragState.initialBlock!.x + deltaX,
            y: dragState.initialBlock!.y + deltaY
          }
        }

        if (dragState.isResizing && dragState.handle) {
          const init = dragState.initialBlock!
          let { x, y, width, height } = init

          switch (dragState.handle) {
            case 'se': width += deltaX; height += deltaY; break;
            case 'sw': width -= deltaX; height += deltaY; x += deltaX; break;
            case 'ne': width += deltaX; height -= deltaY; y += deltaY; break;
            case 'nw': width -= deltaX; height -= deltaY; x += deltaX; y += deltaY; break;
            case 'n': height -= deltaY; y += deltaY; break;
            case 's': height += deltaY; break;
            case 'e': width += deltaX; break;
            case 'w': width -= deltaX; x += deltaX; break;
          }

          // Constraints
          if (width < 20) width = 20
          if (height < 20) height = 20

          return { ...b, x, y, width, height }
        }
        return b
      })

      onChange(newBlocks)
    }

    const handleMouseUp = () => {
      setDragState(null)
    }

    if (dragState) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [dragState, blocks, onChange, scale])

  // Handle file drop for images
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    if (readOnly) return
    
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = (event) => {
        if (event.target?.result) {
          const newBlock: SlideBlock = {
            id: crypto.randomUUID(),
            type: 'image',
            content: event.target.result as string,
            x: e.nativeEvent.offsetX / scale,
            y: e.nativeEvent.offsetY / scale,
            width: 300,
            height: 200,
            style: {}
          }
          onChange([...blocks, newBlock])
          onSelectBlock(newBlock.id)
        }
      }
      reader.readAsDataURL(files[0])
    }
  }

  return (
    <div 
      ref={canvasRef}
      className="flex-1 relative overflow-hidden bg-white shadow-inner w-full h-full"
      onMouseDown={handleCanvasClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      style={{ 
        cursor: dragState?.isDragging ? 'grabbing' : 'default',
        backgroundImage: 'radial-gradient(#e2e8f0 1px, transparent 1px)',
        backgroundSize: '20px 20px'
      }}
    >
      {!blocks.length && !readOnly && (
        <div className="absolute inset-0 flex items-center justify-center text-slate-300 pointer-events-none select-none">
          <p>Trascina immagini qui o usa la barra strumenti</p>
        </div>
      )}

      {blocks.map(block => (
        <div
          key={block.id}
          className={`absolute group ${selectedBlockId === block.id ? 'ring-2 ring-blue-500 z-10' : 'hover:ring-1 hover:ring-slate-300'}`}
          style={{
            left: block.x,
            top: block.y,
            width: block.width,
            height: block.height,
            cursor: dragState?.isDragging ? 'grabbing' : 'grab',
            backgroundColor: block.style.backgroundColor || 'transparent',
            borderRadius: block.style.borderRadius,
            padding: block.style.padding
          }}
          onMouseDown={(e) => {
            if (readOnly) return
            e.stopPropagation()
            onSelectBlock(block.id)
            setDragState({
              isDragging: true,
              isResizing: false,
              startX: e.clientX,
              startY: e.clientY,
              initialBlock: block
            })
          }}
        >
          {/* Content */}
          {block.type === 'text' ? (
            <textarea
              value={block.content}
              onChange={(e) => {
                const newBlocks = blocks.map(b => b.id === block.id ? { ...b, content: e.target.value } : b)
                onChange(newBlocks)
              }}
              className="w-full h-full bg-transparent resize-none border-none focus:ring-0 p-0 cursor-text select-text"
              style={{
                fontFamily: block.style.fontFamily,
                fontSize: block.style.fontSize,
                color: block.style.color,
                fontWeight: block.style.fontWeight,
                fontStyle: block.style.fontStyle,
                textDecoration: block.style.textDecoration,
                textAlign: block.style.textAlign,
              }}
              onMouseDown={(e) => e.stopPropagation()} // Allow selecting text
            />
          ) : (
            <img 
              src={block.content} 
              alt="Block" 
              className="w-full h-full object-cover pointer-events-none select-none" 
            />
          )}

          {/* Resize Handles (only when selected) */}
          {selectedBlockId === block.id && !readOnly && (
            <>
              {['nw', 'ne', 'sw', 'se', 'n', 's', 'e', 'w'].map((handle) => (
                <div
                  key={handle}
                  className="absolute w-3 h-3 bg-white border border-blue-500 rounded-full z-20"
                  style={{
                    top: handle.includes('n') ? -6 : handle.includes('s') ? '100%' : '50%',
                    left: handle.includes('w') ? -6 : handle.includes('e') ? '100%' : '50%',
                    marginTop: handle.includes('s') ? -6 : handle.includes('n') ? 0 : -6,
                    marginLeft: handle.includes('e') ? -6 : handle.includes('w') ? 0 : -6,
                    cursor: `${handle}-resize`
                  }}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    setDragState({
                      isDragging: false,
                      isResizing: true,
                      handle,
                      startX: e.clientX,
                      startY: e.clientY,
                      initialBlock: block
                    })
                  }}
                />
              ))}
            </>
          )}
        </div>
      ))}
    </div>
  )
}