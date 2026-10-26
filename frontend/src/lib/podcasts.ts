import api from '@/lib/api'

export interface PodcastOptions {
  voice_id: string
  duration_minutes: number
  language: string
  tone: string
  audience: string
  instructions: string
  speed: number
  stability: number
}
export const DEFAULT_PODCAST_OPTIONS: PodcastOptions = {
  voice_id: '', duration_minutes: 3, language: 'it', tone: 'didattico',
  audience: 'Studenti della scuola secondaria', instructions: '', speed: 1, stability: 0.5,
}

export function normalizePodcastOptions(options?: Partial<PodcastOptions>): PodcastOptions {
  return { ...DEFAULT_PODCAST_OPTIONS, ...options }
}

/** PostgreSQL JSONB does not preserve object key order. Compare the actual settings. */
export function podcastOptionsEqual(left?: Partial<PodcastOptions>, right?: Partial<PodcastOptions>): boolean {
  const a = normalizePodcastOptions(left)
  const b = normalizePodcastOptions(right)
  return (Object.keys(DEFAULT_PODCAST_OPTIONS) as (keyof PodcastOptions)[]).every(key => a[key] === b[key])
}

export interface PodcastState {
  phase: 'configure' | 'draft' | 'ready'
  prompt: string
  source_names: string[]
  options?: PodcastOptions
  script?: string
  audio_url?: string
  drive_item_id?: string
  filename?: string
}
export interface PodcastMessage { id: string; content: string; created_at?: string; podcast: PodcastState }
export interface PodcastVoice { voice_id: string; name: string; labels: Record<string, string>; preview_url?: string; description?: string }

export function isPodcastRequest(text: string) {
  if (/\b(riproduci|riprodurre|play|pausa|volume|scarica|apri|trascrivi|trascrivere)\b/i.test(text)) return false
  const artifact = /\bpodcast\b|riassunt\w*\s+(?:in\s+)?audio|sintes[ie]\s+(?:in\s+)?audio|\b(?:audio|audiolettura|audiolibro)\b/i.test(text)
  const action = /\b(crea\w*|genera\w*|prepara\w*|fai|fammi|trasforma\w*|converti\w*|vorrei|voglio|realizza\w*|riassumi|sintetizza|puoi|potresti|create|generate|make|summarize)\b/i.test(text)
  return artifact && (action || /^\s*(?:un\s+)?podcast\b/i.test(text))
}
export const podcastApi = {
  voices: () => api.get<{ voices: PodcastVoice[] }>('/podcasts/voices'),
  configure: (conversationId: string, prompt: string, files: File[]) => {
    const form = new FormData(); form.append('conversation_id', conversationId); form.append('prompt', prompt)
    files.forEach(f => form.append('files', f))
    return api.post<{ user_message: { id: string; content: string; created_at: string }; assistant_message: PodcastMessage }>('/podcasts/configure', form, { timeout: 120000 })
  },
  draft: (messageId: string, options: PodcastOptions) => api.post<PodcastMessage>(`/podcasts/${messageId}/draft`, options, { timeout: 240000 }),
  generate: (messageId: string, script: string) => api.post<PodcastMessage>(`/podcasts/${messageId}/generate`, { script }, { timeout: 600000 }),
}
