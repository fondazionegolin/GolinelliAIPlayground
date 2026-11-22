/**
 * Agentic hand-off: the chats (teacher support, student chatbot) recognise that a request belongs to a platform
 * section (Presentation Studio, Vibe Lab, ML Lab, notebooks, ...), show an "open" card and, on click, send the
 * user there with the first brief. The destination picks the brief up once, on arrival, with `takeHandoff`.
 *
 * The brief travels in sessionStorage: it survives the route change / module switch and a reload of the tab, never
 * reaches other tabs or users, and expires after a few minutes so a stale brief cannot resurface later.
 */

export interface PlatformHandoff {
  available: true
  target: string
  label: string
  /** Teacher route; null for students. */
  route: string | null
  /** Student dashboard module key; null for teachers. */
  module: string | null
  needs_session?: boolean
  title: string
  brief: string
  /** Existing text carried over verbatim (the script the chat just wrote, attached documents). */
  source?: string
  hints: { variant?: string; mode?: string; classes?: string[]; name?: string; kind?: 'voice' | 'music' }
}

export interface HandoffDenied {
  available: false
  reason: string
  target?: string
  label?: string
  content: string
}

export type HandoffPlan = { content: string; handoff?: PlatformHandoff } & Partial<HandoffDenied>

const KEY_PREFIX = 'platform-handoff:'
const MAX_AGE_MS = 10 * 60 * 1000

interface Stored { handoff: PlatformHandoff; at: number; takenAt?: number }

/** Remember the brief for the destination; it will be read by `takeHandoff` when that section mounts. */
export function stashHandoff(handoff: PlatformHandoff): void {
  try {
    const entry: Stored = { handoff, at: Date.now() }
    sessionStorage.setItem(KEY_PREFIX + handoff.target, JSON.stringify(entry))
  } catch { /* storage unavailable: the destination simply opens empty */ }
}

// React StrictMode (dev) runs initialisers and effects twice: a brief taken a moment ago is served again.
const recentlyTaken = new Map<string, Stored>()
const REPLAY_MS = 2000

/** Read and remove the pending brief for any of ``targets`` (the freshest wins). */
export function takeHandoff(targets: string[]): PlatformHandoff | null {
  let best: Stored | null = null
  for (const target of targets) {
    const replay = recentlyTaken.get(target)
    if (replay?.takenAt && Date.now() - replay.takenAt < REPLAY_MS) {
      if (!best || replay.at > best.at) best = replay
      continue
    }
    try {
      const raw = sessionStorage.getItem(KEY_PREFIX + target)
      if (!raw) continue
      sessionStorage.removeItem(KEY_PREFIX + target)
      const entry = JSON.parse(raw) as Stored
      if (Date.now() - entry.at > MAX_AGE_MS || !entry.handoff?.brief) continue
      entry.takenAt = Date.now()
      recentlyTaken.set(target, entry)
      if (!best || entry.at > best.at) best = entry
    } catch { /* ignore a corrupt entry */ }
  }
  return best?.handoff ?? null
}

/** Handoff targets that open the Documents editor, and the editor kind each one asks for. */
export const DOCUMENT_TARGETS = ['presentation', 'document', 'spreadsheet'] as const
export const NOTEBOOK_TARGETS = ['p5js_project', 'python_notebook', 'microbit_project'] as const

/** Every destination that can be handed over to (the router also needs the ids for the student, who can lack a module). */
export const HANDOFF_TARGETS = [
  'presentation', 'document', 'spreadsheet', 'p5js_project', 'python_notebook', 'microbit_project', 'vibe_lab', 'ml_lab',
  'models3d', 'models3d_ai', 'dataflow', 'smart_canvas', 'boards',
] as const
export const TEACHER_ONLY_TARGETS = ['video_studio', 'audio_lab', 'live_interaction'] as const

export const isHandoffTarget = (tool: string): boolean =>
  (HANDOFF_TARGETS as readonly string[]).includes(tool) || (TEACHER_ONLY_TARGETS as readonly string[]).includes(tool)
