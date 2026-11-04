import api from '@/lib/api'

export const PROTOCOL_KINDS = {
  quiz: 'Quiz / modulo', teacherbot: 'Teacherbot', document: 'Documento', sheet: 'Foglio di calcolo',
  presentation: 'Presentazione', dispensa: 'Dispensa', html_page: 'Pagina interattiva', image: 'Immagine',
} as const
export type ProtocolKind = keyof typeof PROTOCOL_KINDS
export interface ProtocolTask {
  id: string; kind: ProtocolKind; title: string; instructions: string; rationale: string
  source_names: string[]; depends_on: string[]
}
export interface ProtocolPlan { title: string; objective: string; assumptions: string[]; tasks: ProtocolTask[] }
export interface ProtocolQuestion {
  question: string; type?: 'mcq' | 'open' | 'scale'; options: string[]; correctIndex?: number
  sampleAnswer?: string; explanation?: string; min?: number; max?: number; minLabel?: string; maxLabel?: string
}
export interface ProtocolData {
  title?: string; description?: string; name?: string; system_prompt?: string; knowledge?: string; text?: string; html?: string
  questions?: ProtocolQuestion[]; rows?: (string | number)[][]; slides?: { title: string; body: string; notes?: string }[]
  image_url?: string; image_mime?: string
}
export interface ProtocolResult {
  status: 'pending' | 'running' | 'ready' | 'saved' | 'error' | 'blocked'
  data?: ProtocolData; error?: string; resource?: { id: string; url: string; knowledge_mode?: string }
}
export interface ProtocolState {
  phase: 'plan' | 'running' | 'review'; revision: number; plan: ProtocolPlan; results: Record<string, ProtocolResult>
  source_names: string[]; warnings: string[]; job_id?: string
}
export interface ProtocolMessage { id: string; content: string; created_at: string; protocol: ProtocolState }

export function isProtocolRequest(text: string, hasFiles = false): boolean {
  if (/\b(?:non|senza|no|without)\s+(?:(?:voglio|vorrei|usare|la|modalità|modalita|agentica)\s+){0,3}(?:agentic\w*|agenti|esegui\w*)/i.test(text)) return false
  if (/\b(?:come funziona|cos[’']?è|cosa significa|spiega\w*|what is)\b/i.test(text)) return false
  const execute = /\b(?:avvia\w*|esegui\w*|produci\w*|crea\w*|genera\w*|prepara\w*|vai|attiva\w*|realizza\w*|run|execute)\b/i.test(text)
  if (execute && /\b(?:modalit[àa]\s+agentica|agenti\s+(?:specializzati|in parallelo)|agentic\s+mode)\b/i.test(text)) return true
  if (/\b(?:veditela|vedetela|pensaci|occupatene)\s+tu\b/i.test(text) && (hasFiles || /protocollo|attività|materiali|tutto/i.test(text))) return true
  return execute && /\bprotocollo\b/i.test(text) && /\b(?:esegui\w*|attua\w*|realizza\w*|produci\w*)\b|tutti\s+i\s+materiali/i.test(text)
}

export const protocolApi = {
  plan: (conversationId: string, prompt: string, files: File[]) => {
    const form = new FormData()
    form.append('conversation_id', conversationId); form.append('prompt', prompt)
    files.forEach(file => form.append('files', file))
    return api.post<{ user_message: { id: string; content: string; created_at: string }; assistant_message: ProtocolMessage }>(
      '/llm/teacher/protocol/plan', form, { timeout: 240000 })
  },
  get: (id: string) => api.get<ProtocolMessage>(`/llm/teacher/protocol/${id}`),
  run: (id: string, revision: number, plan?: ProtocolPlan, retryTaskId?: string, instructions?: string) =>
    api.post<ProtocolMessage>(`/llm/teacher/protocol/${id}/run`, { revision, plan, retry_task_id: retryTaskId, instructions }),
  stop: (id: string) => api.post(`/llm/teacher/protocol/${id}/stop`),
  review: (id: string, taskId: string, revision: number, data: ProtocolData, save: boolean) =>
    api.put<ProtocolMessage>(`/llm/teacher/protocol/${id}/tasks/${taskId}`, { revision, data, save }, { timeout: 90000 }),
}
