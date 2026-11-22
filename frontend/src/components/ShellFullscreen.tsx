import { useEffect, useState } from 'react'
import { useShellFullscreen } from '@/stores/shellFullscreen'
import { tl } from '@/i18n/tl'

const IDLE_BEFORE_HINT_MS = 10_000
const HINT_REPEAT_MS = 25_000

/** True once the user has been still for 10s, then pulses again every 25s while still idle. */
function useIdleHint(enabled: boolean): boolean {
  const [hint, setHint] = useState(false)
  useEffect(() => {
    if (!enabled) { setHint(false); return }
    let idleTimer: number | undefined
    let repeatTimer: number | undefined
    let stopTimer: number | undefined
    const clearAll = () => { window.clearTimeout(idleTimer); window.clearInterval(repeatTimer); window.clearTimeout(stopTimer) }
    const pulse = () => { setHint(true); stopTimer = window.setTimeout(() => setHint(false), 1400) }
    const arm = () => {
      clearAll()
      setHint(false)
      idleTimer = window.setTimeout(() => { pulse(); repeatTimer = window.setInterval(pulse, HINT_REPEAT_MS) }, IDLE_BEFORE_HINT_MS)
    }
    // Browsers fire synthetic pointermove events (no real movement) when layout/animations change under a
    // still cursor; those must not count as activity or the hint never shows.
    let lastX = NaN, lastY = NaN
    const onMove = (event: PointerEvent) => {
      if (event.screenX === lastX && event.screenY === lastY) return
      lastX = event.screenX; lastY = event.screenY
      arm()
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((name) => window.addEventListener(name, arm, { passive: true }))
    arm()
    return () => { clearAll(); window.removeEventListener('pointermove', onMove); events.forEach((name) => window.removeEventListener(name, arm)) }
  }, [enabled])
  return hint
}

/** Enter / leave platform fullscreen: a chunky arrow, up in normal mode, flipped in fullscreen. */
export function ShellFullscreenButton({ className = '' }: { className?: string }) {
  const active = useShellFullscreen((s) => s.active)
  const toggle = useShellFullscreen((s) => s.toggle)
  const hint = useIdleHint(!active)
  const label = active ? tl("Esci dallo schermo intero") : tl("Schermo intero")
  return (
    <button
      type="button"
      onClick={toggle}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`flex h-8 w-8 shrink-0 items-center justify-center bg-transparent text-slate-500 transition-colors hover:text-slate-900 ${className}`}
    >
      <span className={hint ? 'shell-arrow-bounce' : ''}>
        {/* Flat glyph: the navbar strip stays on top; the chevron under it points up to hide it, down to bring it back. */}
        <svg
          viewBox="0 0 16 16"
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 2.5h10" />
          <path
            d="M5 12l3-3 3 3"
            className="transition-transform duration-200 ease-out"
            style={{ transformOrigin: '8px 10.5px', transform: active ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </svg>
      </span>
    </button>
  )
}

let peekTimer: number | undefined
const openPeek = () => { window.clearTimeout(peekTimer); peekTimer = undefined; useShellFullscreen.getState().setPeek(true) }
const closePeekSoon = () => {
  if (peekTimer !== undefined) return
  peekTimer = window.setTimeout(() => { peekTimer = undefined; useShellFullscreen.getState().setPeek(false) }, 220)
}

/** Spread on the navbar root: hovering it keeps it open. Closing is driven by pointer movement over the page, never by leaving the window. */
export const shellNavPeekProps = { onMouseEnter: openPeek } as const

/**
 * In fullscreen: a single thin line at the top edge. Hovering it slides the real navbar in over the
 * page (overlay); leaving hides it again. Renders nothing otherwise.
 */
export function ShellNavHandle({ accent }: { accent: string }) {
  const active = useShellFullscreen((s) => s.active)
  const peek = useShellFullscreen((s) => s.peek)
  useEffect(() => {
    if (!active) return
    // The navbar closes only when the pointer moves over the page outside the navbar / handle.
    // Leaving the window (e.g. up to the browser's address bar) produces no movement over the
    // page, so the navbar stays open until the pointer comes back in.
    const onMove = (event: PointerEvent) => {
      if (!useShellFullscreen.getState().peek) return
      const target = event.target as Element | null
      if (target?.closest?.('.shell-nav, .shell-nav-handle')) openPeek()
      else closePeekSoon()
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    return () => window.removeEventListener('pointermove', onMove)
  }, [active])
  if (!active) return null
  // Progressive blur under the overlay navbar: stacked layers, each with a stronger blur that
  // fades out over a narrower band, so the page sharpens smoothly instead of in one step.
  const layers = [
    { blur: 1, mask: 'linear-gradient(to bottom, #000 0%, #000 30%, transparent 100%)' },
    { blur: 2, mask: 'linear-gradient(to bottom, #000 0%, #000 22%, transparent 78%)' },
    { blur: 4, mask: 'linear-gradient(to bottom, #000 0%, #000 18%, transparent 62%)' },
    { blur: 8, mask: 'linear-gradient(to bottom, #000 0%, #000 16%, transparent 48%)' },
    { blur: 14, mask: 'linear-gradient(to bottom, #000 0%, #000 16%, transparent 34%)' },
  ]
  return (
    <>
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-[89] h-44 transition-opacity duration-300"
      style={{ opacity: peek ? 1 : 0 }}
    >
      {layers.map((layer) => (
        <div
          key={layer.blur}
          className="absolute inset-0"
          style={{ backdropFilter: `blur(${layer.blur}px)`, WebkitBackdropFilter: `blur(${layer.blur}px)`, maskImage: layer.mask, WebkitMaskImage: layer.mask }}
        />
      ))}
    </div>
    <div
      className="shell-nav-handle fixed inset-x-0 top-0 z-[95] flex h-4 items-start justify-center"
      style={{ pointerEvents: peek ? 'none' : 'auto' }}
      onMouseEnter={openPeek}
      onFocus={openPeek}
      aria-hidden="true"
    >
      <div className="h-1 w-40 rounded-b-full transition-opacity" style={{ backgroundColor: accent, opacity: peek ? 0 : 0.7 }} />
    </div>
    </>
  )
}

/** A fixed layer at this z-index or above (drawers, side panels, dialogs, popups) owns the corner while it is open. */
const OVERLAY_MIN_Z = 30

/** True when something other than the navbar — a drawer, side panel, dialog or popup — sits under the corner box. */
function cornerIsCovered(box: DOMRect, self: Element): boolean {
  const inset = 2
  const points: Array<[number, number]> = [
    [box.left + box.width / 2, box.top + box.height / 2],
    [box.left + inset, box.top + inset],
    [box.right - inset, box.top + inset],
    [box.left + inset, box.bottom - inset],
    [box.right - inset, box.bottom - inset],
  ]
  for (const [x, y] of points) {
    if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) continue
    for (const element of document.elementsFromPoint(x, y)) {
      if (self.contains(element)) continue
      if (element.closest('.shell-nav, .shell-nav-handle')) break
      // Walk up to the nearest fixed layer and read the stacking level it establishes.
      let node: Element | null = element
      let fixed = false
      let z = 0
      while (node && node !== document.body) {
        const style = window.getComputedStyle(node)
        if (style.position === 'fixed') fixed = true
        const level = Number.parseInt(style.zIndex, 10)
        if (fixed && Number.isFinite(level)) z = Math.max(z, level)
        node = node.parentElement
      }
      if (fixed && z >= OVERLAY_MIN_Z) return true
      break // only the topmost element at each point matters
    }
  }
  return false
}

/**
 * Generic fullscreen button: fixed top-right beside the user icon, outside the navbar so it stays visible in fullscreen.
 * It never overlaps a panel: while any drawer, side panel, dialog or popup covers its corner (e.g. «Librerie» in the
 * Coding Lab, whose close X sits right there) the button steps aside, and comes back when the panel closes.
 */
export function ShellFullscreenCorner() {
  const [covered, setCovered] = useState(false)
  const [host, setHost] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!host) return
    let frame = 0
    const check = () => {
      frame = 0
      setCovered(cornerIsCovered(host.getBoundingClientRect(), host))
    }
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(check) }
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'data-state', 'open', 'hidden'] })
    window.addEventListener('resize', schedule)
    document.addEventListener('transitionend', schedule, true)
    document.addEventListener('animationend', schedule, true)
    schedule()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', schedule)
      document.removeEventListener('transitionend', schedule, true)
      document.removeEventListener('animationend', schedule, true)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [host])

  return (
    <div
      ref={setHost}
      className="fixed right-1.5 top-4 z-[96] hidden md:block"
      style={covered ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}
      aria-hidden={covered || undefined}
    >
      <ShellFullscreenButton />
    </div>
  )
}
