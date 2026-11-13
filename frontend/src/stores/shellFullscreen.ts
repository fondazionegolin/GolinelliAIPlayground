import { useEffect } from 'react'
import { create } from 'zustand'

/**
 * Platform-wide fullscreen (not browser fullscreen): the page frame fills the window and the navbar collapses to a
 * strip of section ticks that reveals the real navbar as an overlay on hover. State lives on <body>
 * (`data-shell-fullscreen`, `data-shell-peek`) so plain CSS and `--shell-nav-h` follow it.
 */
interface ShellFullscreenState {
  active: boolean
  peek: boolean
  setActive: (active: boolean) => void
  toggle: () => void
  setPeek: (peek: boolean) => void
}

export const useShellFullscreen = create<ShellFullscreenState>((set, get) => ({
  active: false,
  peek: false,
  setActive: (active) => {
    set({ active, peek: false })
  },
  toggle: () => get().setActive(!get().active),
  setPeek: (peek) => set({ peek }),
}))

/** Mount once near the app root: mirrors the store on <body>. */
export function useShellFullscreenSync() {
  const active = useShellFullscreen((s) => s.active)
  const peek = useShellFullscreen((s) => s.peek)

  useEffect(() => {
    const body = document.body
    if (active) body.dataset.shellFullscreen = '1'
    else delete body.dataset.shellFullscreen
    return () => { delete body.dataset.shellFullscreen }
  }, [active])

  useEffect(() => {
    const body = document.body
    if (active && peek) body.dataset.shellPeek = '1'
    else delete body.dataset.shellPeek
    return () => { delete body.dataset.shellPeek }
  }, [active, peek])
}
