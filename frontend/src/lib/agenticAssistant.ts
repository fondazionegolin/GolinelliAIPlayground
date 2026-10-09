import { getApiAuthHeaders } from '@/lib/api'
import { readEventStream } from '@/lib/backgroundJobs'
import { agenticApi } from '@/lib/api'

export type AssistantQuestion = { question: string; suggestions: string[] }
export type AssistantIntake = { understanding: string; assumptions: string[]; questions: AssistantQuestion[]; mode: 'data' | 'chatbot' }
export type AssistantAnswer = { question: string; answer: string }

export type AssistantNode = { id: string; instanceId: string; x: number; y: number; status: string; label?: string; config: Record<string, unknown> }
export type AssistantEdge = { id: string; from: string; to: string; sourcePort: string; targetPort: string }
export type AssistantOp =
  | { type: 'add_node'; node: AssistantNode }
  | { type: 'connect'; edge: AssistantEdge }
  | { type: 'done'; graph: { nodes: AssistantNode[]; edges: AssistantEdge[] } }
export type AssistantIssue = { severity: 'error' | 'warning'; node: string | null; message: string }
export type AssistantEstimate = {
  credit_nodes: Array<{ node: string; type: string; function: string | null; times: number | null; long_running: boolean }>
  llm_calls: number | null
}
export type AssistantStep = { key: string; node: string; purpose?: string; config?: Record<string, unknown>; inputs?: Record<string, string> }
export type AssistantPlanResult = {
  title: string
  mode: 'data' | 'chatbot'
  blueprint: { title: string; mode: string; steps: AssistantStep[]; warnings: string[] }
  graph: { nodes: AssistantNode[]; edges: AssistantEdge[] }
  ops: AssistantOp[]
  estimate: AssistantEstimate
  warnings: string[]
  issues: AssistantIssue[]
  attempts: number
}

export const apiDetail = (reason: any, fallback: string): string => {
  const detail = reason?.response?.data?.detail
  return typeof detail === 'string' ? detail : reason?.message || fallback
}

/** The architect streams `status`/`ping` while the model works and one final `result` (or `error`). */
export async function streamAssistantPlan(
  body: { intent: string; understanding: string; assumptions: string[]; answers: AssistantAnswer[] },
  onStatus: (message: string) => void,
  signal?: AbortSignal,
): Promise<AssistantPlanResult> {
  const response = await fetch(agenticApi.assistantPlanUrl, {
    method: 'POST', credentials: 'include', signal,
    headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders() },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    let detail = ''
    try { detail = (await response.json())?.detail } catch { /* not JSON */ }
    throw new Error(typeof detail === 'string' && detail ? detail : `Richiesta non riuscita (${response.status})`)
  }
  let result: AssistantPlanResult | null = null
  let failure = ''
  await readEventStream(response, 'sse', (event) => {
    if (event.type === 'status') onStatus(String(event.message || ''))
    else if (event.type === 'result') { result = event as AssistantPlanResult; return true }
    else if (event.type === 'error') { failure = String(event.message || 'Errore dell’assistente'); return true }
  })
  if (failure) throw new Error(failure)
  if (!result) throw new Error('La connessione si è interrotta prima della fine: riprova.')
  return result
}

export const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
