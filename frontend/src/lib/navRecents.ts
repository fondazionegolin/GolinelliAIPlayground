import { agenticApi, boardsApi, codingApi, liveInteractionApi, notebooksApi, teacherApi, teacherbotsApi } from '@/lib/api'
import { tl } from '@/i18n/tl'

/** One quick-access entry shown on the right of a navbar submenu row. */
export interface NavRecent {
  id: string
  title: string
  /** Small grey line under the title (class, type, state…). */
  meta?: string
  /** ISO timestamp used for the relative "2 h fa" label and for ordering. */
  at?: string | null
  to: string
  /** Highlights the entry (running live session, session currently open…). */
  badge?: string
}

/** How a submenu row gets its recents: either a fetcher (run only while the menu is open) or ready-made entries. */
export interface NavRecentsSpec {
  queryKey: unknown[]
  limit: number
  fetch?: () => Promise<NavRecent[]>
  entries?: NavRecent[]
}

type Row = Record<string, any>
const time = (row: Row) => new Date(row.updated_at || row.created_at || 0).getTime()
const newest = (rows: Row[]) => [...rows].sort((a, b) => time(b) - time(a))
const at = (row: Row) => (row.updated_at || row.created_at || null) as string | null

export function relativeTime(iso?: string | null): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff)) return ''
  const minutes = Math.round(diff / 60000)
  if (minutes < 1) return 'ora'
  if (minutes < 60) return tl("{0} min fa", minutes)
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h fa`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} g fa`
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
}

const DOC_TYPE_LABEL: Record<string, string> = { presentation: tl("Presentazione"), sheet: tl("Tabella"), canvas: tl("Lavagna"), document: tl("Documento") }
const NOTEBOOK_TYPE_LABEL: Record<string, string> = { python: 'Python', p5js: 'p5.js', strudel: 'Strudel', game2d: tl("Gioco 2D"), microbit: 'micro:bit', circuitplayground: 'Circuit Playground' }

export const navRecentFetchers = {
  documents: async (): Promise<NavRecent[]> => {
    const [drafts, shared] = await Promise.all([
      teacherApi.listDocumentDrafts().then((r) => r.data as Row[]).catch(() => []),
      teacherApi.listSharedDocuments().then((r) => r.data as Row[]).catch(() => []),
    ])
    const seen = new Set<string>()
    return newest([...drafts, ...shared])
      .filter((row) => (seen.has(row.id) ? false : (seen.add(row.id), true)))
      .map((row) => ({
        id: row.id,
        title: row.title || tl("Senza titolo"),
        meta: DOC_TYPE_LABEL[row.doc_type] || tl("Documento"),
        at: at(row),
        to: `/teacher/documents?open=${row.id}`,
      }))
  },

  teacherbots: async (): Promise<NavRecent[]> =>
    newest((await teacherbotsApi.list()).data as Row[]).map((row) => ({
      id: row.id,
      title: row.name,
      meta: row.status === 'published' ? tl("Pubblicato") : row.status === 'testing' ? tl("In test") : tl("Bozza"),
      at: at(row),
      to: `/teacher/teacherbots?edit=${row.id}`,
    })),

  notebooks: async (): Promise<NavRecent[]> =>
    newest((await notebooksApi.list()).data as Row[]).map((row) => ({
      id: row.id,
      title: row.title || tl("Senza titolo"),
      meta: NOTEBOOK_TYPE_LABEL[row.project_type] || 'Notebook',
      at: at(row),
      to: `/teacher/notebooks/notebook/${row.id}`,
    })),

  coding: (sessionId?: string) => async (): Promise<NavRecent[]> => {
    if (!sessionId) return []
    return newest((await codingApi.listProjects(sessionId)).data as Row[]).map((row) => ({
      id: row.id,
      title: row.title || tl("Senza titolo"),
      meta: row.owner_display_name || undefined,
      at: at(row),
      to: `/teacher/coding?project=${row.id}`,
    }))
  },

  live: (sessionId?: string) => async (): Promise<NavRecent[]> => {
    if (!sessionId) return []
    const rows = (await liveInteractionApi.list(sessionId)).data as Row[]
    const pending = (row: Row) => row.status === 'ACTIVE' || (row.status === 'DRAFT' && row.interaction_type === 'escape_room' && row.public_enabled)
    // Sessions still running come first: they are the ones that need attention.
    return [...rows].sort((a, b) => Number(pending(b)) - Number(pending(a)) || time(b) - time(a)).map((row) => ({
      id: row.id,
      title: row.title,
      meta: row.interaction_type === 'escape_room' ? 'Escape room' : tl("Quiz"),
      at: at(row),
      badge: row.status === 'ACTIVE' ? tl("In corso") : pending(row) ? tl("Lobby aperta") : undefined,
      to: `/teacher/live-interaction/${row.id}/control`,
    }))
  },

  boards: (sessionId?: string) => async (): Promise<NavRecent[]> =>
    newest((await boardsApi.list(sessionId)).data as Row[]).map((row) => ({
      id: row.id,
      title: row.title,
      meta: row.framework ? String(row.framework).replace(/^./, (c) => c.toUpperCase()) : 'Board',
      at: at(row),
      to: `/teacher/boards?board=${row.id}`,
    })),

  workflows: async (): Promise<NavRecent[]> =>
    newest((await agenticApi.listWorkflows()).data as Row[]).map((row) => ({
      id: row.id,
      title: row.title || row.name || 'Workflow',
      at: at(row),
      to: `/teacher/agentic/${row.id}`,
    })),
}
