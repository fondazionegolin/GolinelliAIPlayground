import { useEffect, useLayoutEffect } from 'react'
import { create } from 'zustand'

export type UiTheme = 'light' | 'dark'

// Device-local cache so index.html can paint the right theme before React boots;
// the server profile (users.ui_theme / session_students.ui_theme) stays the source of truth.
const CACHE_KEY = 'ui_theme'

function readCachedTheme(): UiTheme {
  try {
    return localStorage.getItem(CACHE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

interface UiThemeState {
  theme: UiTheme
  /** True while an authenticated teacher/student area is mounted: dark mode only applies there. */
  scoped: boolean
  setTheme: (theme: UiTheme) => void
}

export const useUiThemeStore = create<UiThemeState>((set) => ({
  theme: readCachedTheme(),
  scoped: false,
  setTheme: (theme) => {
    try {
      localStorage.setItem(CACHE_KEY, theme)
    } catch {
      /* storage blocked: theme still applies for this page */
    }
    set({ theme })
  },
}))

function syncDocumentTheme({ theme, scoped }: UiThemeState) {
  const dark = scoped && theme === 'dark'
  const root = document.documentElement
  root.classList.toggle('dark', dark)
  root.style.colorScheme = dark ? 'dark' : ''
}

useUiThemeStore.subscribe(syncDocumentTheme)

const AUTH_AREA_PATH = /^\/(teacher|student)(\/|$)/

/** Route-level guard: outside the authenticated areas (landing, admin, public links) drop any
 *  dark class painted early by index.html, e.g. after a /teacher → /login redirect. */
export function useUiThemeRouteGuard(pathname: string) {
  useLayoutEffect(() => {
    if (!AUTH_AREA_PATH.test(pathname)) syncDocumentTheme(useUiThemeStore.getState())
  }, [pathname])
}

/** Mount in an authenticated area shell: enables the user's theme while mounted, and adopts
 *  the server-side preference once it is known. */
export function useUiThemeScope(serverTheme?: UiTheme | null) {
  useLayoutEffect(() => {
    useUiThemeStore.setState({ scoped: true })
    return () => useUiThemeStore.setState({ scoped: false })
  }, [])

  useEffect(() => {
    if (serverTheme === 'light' || serverTheme === 'dark') {
      useUiThemeStore.getState().setTheme(serverTheme)
    }
  }, [serverTheme])
}
