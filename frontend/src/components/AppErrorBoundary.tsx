import { Component, type ErrorInfo, type ReactNode } from 'react'
import { tl } from '@/i18n/tl'

const RELOAD_KEY = 'app_chunk_reload_at'

/** A lazy section built before the latest deploy: its hashed chunk no longer exists on the server. */
export const isChunkLoadError = (error: unknown) => {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '')
  return /dynamically imported module|Importing a module script failed|error loading dynamically|ChunkLoadError|Failed to fetch dynamically|preload CSS/i.test(message)
}

/** Reload once to pick up the new build; never loop (one attempt per 30 s). */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
    if (Date.now() - last < 30_000) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch { /* storage blocked: reload anyway, the guard is best effort */ }
  window.location.reload()
  return true
}

type Props = { children: ReactNode; resetKey?: string }
type State = { error: Error | null }

/**
 * Last-resort guard around the routes: a render error in one section shows a recovery card instead of
 * unmounting the whole app (white page). Navigating to another section (resetKey) clears it.
 */
export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[AppErrorBoundary]', error, info.componentStack)
    if (isChunkLoadError(error)) reloadForNewBuild()
  }

  componentDidUpdate(previous: Props) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const stale = isChunkLoadError(error)
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">
            {stale ? tl("È disponibile una nuova versione") : tl("Questa sezione ha avuto un problema")}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-600">
            {stale
              ? tl("La piattaforma è stata aggiornata mentre la pagina era aperta. Ricarica per continuare.")
              : tl("Il resto della piattaforma funziona: ricarica la pagina o torna indietro.")}
          </p>
          {!stale && <p className="mt-3 break-words rounded-lg bg-slate-50 px-3 py-2 text-left font-mono text-[11px] text-slate-500">{error.message}</p>}
          <div className="mt-5 flex justify-center gap-2">
            <button type="button" onClick={() => window.history.back()} className="h-10 rounded-full border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              {tl("Indietro")}
            </button>
            <button type="button" onClick={() => window.location.reload()} className="h-10 rounded-full bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800">
              {tl("Ricarica")}
            </button>
          </div>
        </div>
      </div>
    )
  }
}
