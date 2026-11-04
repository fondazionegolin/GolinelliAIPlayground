import { useLayoutEffect, type RefObject } from 'react'

/**
 * Fit a textarea to its content, up to ~40% of the viewport (max 360px), then scroll inside it.
 * An empty field always collapses to its natural height (`rows`): a long placeholder that wraps while the
 * field is briefly narrow must never leave the box stretched.
 */
export function autoGrow(el: HTMLTextAreaElement | null, maxPx?: number) {
  if (!el) return
  if (!el.value) {
    el.style.height = ''
    el.style.overflowY = 'hidden'
    return
  }
  const max = maxPx ?? Math.max(120, Math.min(360, Math.round(window.innerHeight * 0.4)))
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, max)}px`
  el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
}

/**
 * Re-fit whenever `value` changes (including programmatic changes: send, history recall, voice, suggestions)
 * and whenever the field's width changes (sidebar toggles, mode switches, window resize): wrapping depends on
 * the width, so a height measured while the field was narrow would otherwise stay until a page reload.
 */
export function useAutoGrow(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxPx?: number) {
  useLayoutEffect(() => {
    autoGrow(ref.current, maxPx)
  }, [ref, value, maxPx])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      autoGrow(el, maxPx)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref, maxPx])
}
