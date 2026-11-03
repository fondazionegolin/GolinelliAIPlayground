import api from '@/lib/api'

export type VoiceLabAction = 'tts' | 'dialogue' | 'convert' | 'transcribe' | 'isolate' | 'sound_effects' | 'music' | 'alignment' | 'dubbing'
export interface LabVoice { voice_id: string; name: string; description: string; category?: string; preview_url?: string; owned: boolean; item_id?: string }
export interface LabModel { model_id: string; name: string; tts: boolean; conversion: boolean; max_characters: number }
export interface LabItem {
  id: string; title: string; kind: 'audio' | 'transcript' | 'preview' | 'voice' | 'dubbing'; service: string
  voice_id?: string; status: string; mime_type?: string; created_at: string; content_url?: string
  details: { text?: string; description?: string; characters?: number; requires_verification?: boolean; saved_voice_id?: string
    transcript?: { text?: string; words?: { text: string; start: number; end: number; speaker_id?: string }[] } }
}
export interface LabConfig { configured: boolean; default_model: string; max_upload_mb: number; output_formats: string[] }

export const voiceLabApi = {
  config: () => api.get<LabConfig>('/voice-lab/config'),
  voices: () => api.get<LabVoice[]>('/voice-lab/voices'),
  models: () => api.get<LabModel[]>('/voice-lab/models'),
  items: () => api.get<LabItem[]>('/voice-lab/items'),
  item: (id: string) => api.get<LabItem>(`/voice-lab/items/${id}`),
  content: (id: string, signal?: AbortSignal) => api.get<Blob>(`/voice-lab/items/${id}/content`, { responseType: 'blob', signal }),
  refresh: (id: string) => api.post<LabItem>(`/voice-lab/items/${id}/refresh`, undefined, { timeout: 360000 }),
  generate: (data: Record<string, unknown>, file?: File | null) => {
    const form = new FormData()
    form.append('payload', JSON.stringify(data))
    if (file) form.append('file', file)
    return api.post<LabItem>('/voice-lab/generate', form, { timeout: 360000 })
  },
  clone: (name: string, description: string, consent: boolean, removeNoise: boolean, files: File[]) => {
    const form = new FormData()
    form.append('name', name); form.append('description', description); form.append('consent', String(consent)); form.append('remove_noise', String(removeNoise))
    files.forEach((file) => form.append('files', file))
    return api.post<LabItem>('/voice-lab/voices/clone', form, { timeout: 360000 })
  },
  design: (description: string, text: string, remixVoiceId?: string) => api.post<LabItem[]>('/voice-lab/voices/design', {
    description, text, remix_voice_id: remixVoiceId || undefined,
  }, { timeout: 360000 }),
  saveVoice: (previewId: string, name: string) => api.post<LabItem>('/voice-lab/voices/save', { preview_id: previewId, name }, { timeout: 360000 }),
  deleteVoice: (id: string) => api.delete(`/voice-lab/voices/${id}`),
}
