import { useLayoutEffect, type RefObject } from 'react'

/** Fit a textarea to its content, up to ~40% of the viewport (max 360px), then scroll inside it. */
export function autoGrow(el: HTMLTextAreaElement | null, maxPx?: number) {
  if (!el) return
  const max = maxPx ?? Math.max(120, Math.min(360, Math.round(window.innerHeight * 0.4)))
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, max)}px`
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
}

/** Re-fit whenever `value` changes, including programmatic changes (send, history recall, voice, suggestions). */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxPx?: number) {
  useLayoutEffect(() => {
    autoGrow(ref.current, maxPx)
  }, [ref, value, maxPx])
}
