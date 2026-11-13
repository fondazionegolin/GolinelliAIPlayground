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
    const events = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((name) => window.addEventListener(name, arm, { passive: true }))
    arm()
    return () => { clearAll(); events.forEach((name) => window.removeEventListener(name, arm)) }
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
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6 transition-transform duration-300 ease-out"
          style={{ transform: active ? 'rotate(180deg)' : 'rotate(0deg)' }}
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M5 15l7-7 7 7" />
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

/** Generic fullscreen button: fixed top-right beside the user icon, outside the navbar so it stays visible in fullscreen. */
export function ShellFullscreenCorner() {
  return (
    <div className="fixed right-1.5 top-4 z-[96] hidden md:block">
      <ShellFullscreenButton />
    </div>
  )
}
