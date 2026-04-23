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

export function getRagSessions(): RagSession[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch { return [] }
}

export function saveRagSession(session: RagSession): void {
  const sessions = getRagSessions()
  const idx = sessions.findIndex((s) => s.id === session.id)
  if (idx >= 0) sessions[idx] = session
  else sessions.unshift(session)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, 50)))
}

export function deleteRagSession(id: string): void {
  const sessions = getRagSessions().filter((s) => s.id !== id)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions))
}

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
