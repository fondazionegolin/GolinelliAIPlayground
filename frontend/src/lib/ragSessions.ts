export interface RagSessionChunk {
  id: string
  chunk_index: number
  text: string
  page?: number
  document_id: string
  document_title: string
  score?: number
}

export interface RagSessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  sourceChunks?: RagSessionChunk[]
}

export interface RagSession {
  id: string
  name: string
  messages: RagSessionMessage[]
  selectedDocIds: string[]
  searchMode?: 'hybrid' | 'vector' | 'keyword'
  createdAt: string
  updatedAt: string
}

const STORAGE_KEY = 'student_rag_sessions'
const TEACHER_STORAGE_KEY = 'teacher_rag_sessions'

export function makeRagSessionStore(storageKey: string) {
  const get = (): RagSession[] => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '[]')
    } catch { return [] }
  }
  return {
    get,
    save(session: RagSession): void {
      const sessions = get()
      const idx = sessions.findIndex((s) => s.id === session.id)
      if (idx >= 0) sessions[idx] = session
      else sessions.unshift(session)
      try { localStorage.setItem(storageKey, JSON.stringify(sessions.slice(0, 50))) } catch { /* quota */ }
    },
    remove(id: string): void {
      try { localStorage.setItem(storageKey, JSON.stringify(get().filter((s) => s.id !== id))) } catch { /* noop */ }
    },
  }
}

const studentStore = makeRagSessionStore(STORAGE_KEY)
export const teacherRagSessionStore = makeRagSessionStore(TEACHER_STORAGE_KEY)

export const getRagSessions = studentStore.get
export const saveRagSession = studentStore.save
export const deleteRagSession = studentStore.remove

export function createRagSession(): RagSession {
  return {
    id: crypto.randomUUID(),
    name: 'Nuova sessione',
    messages: [],
    selectedDocIds: [],
    searchMode: 'hybrid',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}
