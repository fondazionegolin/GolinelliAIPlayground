import { getApiAuthHeaders } from '@/lib/api'
import { readEventStream } from '@/lib/backgroundJobs'
import { agenticApi } from '@/lib/api'
import { tl } from '@/i18n/tl'

export type AssistantQuestion = { question: string; suggestions: string[] }
export type AssistantIntake = { understanding: string; assumptions: string[]; questions: AssistantQuestion[]; mode: 'data' | 'chatbot' }
export type AssistantAnswer = { question: string; answer: string }

export type AssistantNode = { id: string; instanceId: string; x: number; y: number; status: string; label?: string; config: Record<string, unknown> }
export type AssistantEdge = { id: string; from: string; to: string; sourcePort: string; targetPort: string }
export type AssistantOp =
  | { type: 'add_node'; node: AssistantNode }
  | { type: 'connect'; edge: AssistantEdge }
  | { type: 'replace_node'; node: AssistantNode }
  | { type: 'remove_edge'; edgeId: string }
  | { type: 'remove_node'; instanceId: string }
  | { type: 'set_config'; instanceId: string; config: Record<string, unknown>; label?: string | null }
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

export type AssistantEditResult = {
  graph: { nodes: AssistantNode[]; edges: AssistantEdge[] }
  ops: AssistantOp[]
  summary: string[]
  explanation: string
  warnings: string[]
  issues: AssistantIssue[]
  estimate: AssistantEstimate
}
export type AssistantHistoryTurn = { role: 'user' | 'assistant'; content: string }

export const apiDetail = (reason: any, fallback: string): string => {
  const detail = reason?.response?.data?.detail
  return typeof detail === 'string' ? detail : reason?.message || fallback
}

/** The long model calls stream `status`/`ping` while the model works and one final `result` (or `error`). */
async function streamAssistant<T>(url: string, body: unknown, onStatus: (message: string) => void, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: 'POST', credentials: 'include', signal,
    headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders() },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    let detail = ''
    try { detail = (await response.json())?.detail } catch { /* not JSON */ }
    throw new Error(typeof detail === 'string' && detail ? detail : tl("Richiesta non riuscita ({0})", response.status))
  }
  let result: T | null = null
  let failure = ''
  await readEventStream(response, 'sse', (event) => {
    if (event.type === 'status') onStatus(String(event.message || ''))
    else if (event.type === 'result') { result = event as unknown as T; return true }
    else if (event.type === 'error') { failure = String(event.message || tl("Errore dell’assistente")); return true }
  })
  if (failure) throw new Error(failure)
  if (!result) throw new Error(tl("La connessione si è interrotta prima della fine: riprova."))
  return result
}

export const streamAssistantPlan = (
  body: { intent: string; understanding: string; assumptions: string[]; answers: AssistantAnswer[]; previous_blueprint?: AssistantPlanResult['blueprint']; feedback?: string },
  onStatus: (message: string) => void, signal?: AbortSignal,
) => streamAssistant<AssistantPlanResult>(agenticApi.assistantPlanUrl, body, onStatus, signal)

export const streamAssistantEdit = (
  body: { graph: { nodes: unknown[]; edges: unknown[] }; instruction: string; selected?: string | null; history?: AssistantHistoryTurn[] },
  onStatus: (message: string) => void, signal?: AbortSignal,
) => streamAssistant<AssistantEditResult>(agenticApi.assistantEditUrl, body, onStatus, signal)

export const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))
