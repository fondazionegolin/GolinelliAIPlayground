import { extractArtifacts, hasArtifacts, type NodeArtifacts } from '@/components/agentic/NodeArtifacts'
import { tl } from '@/i18n/tl'

export const isChatNode = (id: string) => id.startsWith('chatbot.') || id === 'llm_chatbot'

type RunLike = { nodes: Array<{ node_instance_id: string; label: string; status: string; output?: Record<string, unknown> }> }
type NodeLike = { id: string; instanceId: string; config: Record<string, unknown> }

export type ChatEntry = { role: 'bot' | 'user'; text: string; artifacts?: NodeArtifacts; label?: string }

export function buildChatLog(run: RunLike | null, nodes: NodeLike[]): ChatEntry[] {
  if (!run) return []
  const log: ChatEntry[] = []
  for (const item of run.nodes) {
    if (item.status === 'idle' || item.status === 'skipped') continue
    const node = nodes.find((candidate) => candidate.instanceId === item.node_instance_id)
    if (!node) continue
    const output = item.output || {}
    if (node.id === 'chatbot.start') { const welcome = String(node.config.welcome_message ?? '').trim(); if (welcome) log.push({ role: 'bot', text: welcome }) }
    else if (node.id === 'chatbot.say') log.push({ role: 'bot', text: String(output.message ?? node.config.message ?? '') })
    else if (node.id === 'llm_chatbot' && Array.isArray(output.history)) (output.history as Array<{ role: string; content: string }>).forEach((turn) => log.push({ role: turn.role === 'user' ? 'user' : 'bot', text: String(turn.content ?? '') }))
    else if (node.id === 'llm_chatbot') { const payload = output.response as { message?: string } | undefined; if (payload?.message) log.push({ role: 'bot', text: payload.message }) }
    else if (node.id === 'chatbot.end') log.push({ role: 'bot', text: String(node.config.message ?? output.result ?? '') })
    else if (node.id === 'chatbot.ask') {
      log.push({ role: 'bot', text: String(node.config.question ?? '') })
      if (item.status === 'completed' && output.response !== undefined) log.push({ role: 'user', text: String(output.response) })
    } else if (node.id === 'chatbot.multi_choice') {
      log.push({ role: 'bot', text: String(node.config.question ?? '') })
      if (item.status === 'completed') {
        const chosen = ['choice_1', 'choice_2', 'choice_3', 'choice_4'].findIndex((port) => output[port])
        if (chosen >= 0) log.push({ role: 'user', text: String(node.config[`option_${chosen + 1}`] ?? '') })
      }
    } else if (node.id === 'chatbot.yes_no' && item.status === 'completed') {
      log.push({ role: 'user', text: output.yes !== undefined && output.yes !== null ? tl("Sì") : 'No' })
    }
    // Any other node (image generation, documents, AI transforms…) that produced something visible is shown in the chat too.
    if (item.status === 'completed' && !isChatNode(node.id)) {
      const artifacts = extractArtifacts(output)
      const text = node.id === 'ai.transform' && typeof output.text === 'string' && !output.table && !output.slides ? output.text : ''
      if (hasArtifacts(artifacts) || text) log.push({ role: 'bot', text, label: item.label, artifacts: hasArtifacts(artifacts) ? artifacts : undefined })
    }
  }
  return log
}
