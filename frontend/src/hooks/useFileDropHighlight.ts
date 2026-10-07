import { useCallback, useRef, useState, type DragEvent } from 'react'
import { hasUniversalFileDrag } from '@/lib/dragFiles'

const CHATBOT_MIMES = ['application/x-chatbot-image', 'application/x-chatbot-document', 'application/x-chatbot-csv']

/** True for any drag the platform can turn into files: OS files, drive items, chat attachments, chatbot outputs. */
export function isFileLikeDrag(dataTransfer: DataTransfer | null | undefined): boolean {
  const types = Array.from(dataTransfer?.types || [])
  return types.includes('Files') || hasUniversalFileDrag(dataTransfer) || CHATBOT_MIMES.some((mime) => types.includes(mime))
}

/**
 * Drop-zone highlight that survives nested children (enter/leave pairs are counted) and never interferes
 * with the component's own drop handling: spread `dropHighlightProps` on the zone and render <DropOverlay active={active} />.
 */
export function useFileDropHighlight() {
  const [active, setActive] = useState(false)
  const depth = useRef(0)
  const reset = useCallback(() => { depth.current = 0; setActive(false) }, [])
  const dropHighlightProps = {
    onDragEnter: (event: DragEvent) => {
      if (!isFileLikeDrag(event.dataTransfer)) return
      depth.current += 1
      setActive(true)
    },
    onDragLeave: (event: DragEvent) => {
      if (!isFileLikeDrag(event.dataTransfer)) return
      depth.current -= 1
      if (depth.current <= 0) reset()
    },
    onDropCapture: reset,
    onDragEnd: reset,
  }
  return { active, dropHighlightProps, reset }
}
