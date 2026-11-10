import api from '@/lib/api'

export type VoiceLabAction = 'tts' | 'dialogue' | 'convert' | 'transcribe' | 'isolate' | 'sound_effects' | 'music' | 'alignment' | 'dubbing'
export interface LabVoice { voice_id: string; name: string; description: string; category?: string; preview_url?: string; owned: boolean; item_id?: string }
export interface LabModel { model_id: string; name: string; tts: boolean; conversion: boolean; max_characters: number }
export interface LabItem {
  id: string; title: string; artist_name?: string | null; kind: 'audio' | 'transcript' | 'preview' | 'voice' | 'dubbing'; service: string
  voice_id?: string; status: string; mime_type?: string; created_at: string; content_url?: string; cover_url?: string | null
  details: { drive_item_id?: string; credits?: number; duration_seconds?: number; pricing?: LabQuote; text?: string; description?: string; characters?: number; requires_verification?: boolean; saved_voice_id?: string
    transcript?: { text?: string; words?: { text: string; start: number; end: number; speaker_id?: string }[] } }
}
export interface LabQuote { credits: number; quantity: number; unit: 'characters' | 'seconds'; pricing_basis: string; source: string }
export interface LabPlaylist { id: string; title: string; folder_id: string; tracks: { id: string; source_item_id: string; title: string; artist_name?: string | null; mime_type: string; cover_url?: string | null }[] }
export interface AudioFile { id: string; title: string; artist_name?: string | null; mime_type: string; owned: boolean; shared: boolean; cover_url?: string | null }
export interface ClassPlayback { session_id: string; teacher_id: string; playlist: LabPlaylist; index: number; position: number; paused: boolean; updated_at: number; server_time: number; revision: string }
export interface MusicModel { provider: string; model: string; label: string; fixed_seconds: number | null; min_seconds?: number; max_seconds: number; price_note: string }
export interface LabConfig { configured: boolean; cover_credits: number; default_model: string; max_upload_mb: number; output_formats: string[]; music_model?: MusicModel }

export const voiceLabApi = {
  audioFiles: () => api.get<AudioFile[]>('/voice-lab/audio-files'),
  shareAudioClass: (id: string) => api.post(`/voice-lab/audio-files/${id}/share-class`),
  sessionPlayback: (params: { session_id?: string }) => api.get<ClassPlayback | null>('/voice-lab/session-playback', { params }),
  setSessionPlayback: (sessionId: string, data: { playlist_id: string | null; index?: number; position?: number; paused?: boolean; expected_revision?: string }) => api.put<ClassPlayback | null>(`/voice-lab/session-playback/${sessionId}`, data),
  sessionContent: (sessionId: string, trackId: string, signal?: AbortSignal) => api.get<Blob>(`/voice-lab/session-playback/${sessionId}/tracks/${trackId}/content`, { responseType: 'blob', signal }),
  quote: (data: { action: string; characters: number; seconds: number; model: string }, signal?: AbortSignal) => api.post<LabQuote>('/voice-lab/quote', data, { signal }),
  playlists: () => api.get<LabPlaylist[]>('/voice-lab/playlists'),
  playlist: (id: string) => api.get<LabPlaylist>(`/voice-lab/playlists/${id}`),
  createPlaylist: (title: string, track_ids: string[]) => api.post<LabPlaylist>('/voice-lab/playlists', { title, track_ids }),
  updatePlaylist: (id: string, title: string, track_ids: string[]) => api.put<LabPlaylist>(`/voice-lab/playlists/${id}`, { title, track_ids }),
  deletePlaylist: (id: string) => api.delete(`/voice-lab/playlists/${id}`),
  config: () => api.get<LabConfig>('/voice-lab/config'),
  voices: () => api.get<LabVoice[]>('/voice-lab/voices'),
  models: () => api.get<LabModel[]>('/voice-lab/models'),
  items: () => api.get<LabItem[]>('/voice-lab/items'),
  cover: (url: string) => api.get<Blob>(url, { responseType: 'blob' }),
  generateCover: (id: string) => api.post<LabItem>(`/voice-lab/items/${id}/cover/generate`, undefined, { timeout: 120000 }),
  uploadCover: (id: string, file: File) => { const form = new FormData(); form.append('file', file); return api.post<LabItem>(`/voice-lab/items/${id}/cover`, form) },
  deleteCover: (id: string) => api.delete<LabItem>(`/voice-lab/items/${id}/cover`),
  rename: (id: string, title: string) => api.patch<LabItem>(`/voice-lab/items/${id}`, { title }),
  item: (id: string) => api.get<LabItem>(`/voice-lab/items/${id}`),
  content: (id: string, signal?: AbortSignal) => api.get<Blob>(`/voice-lab/items/${id}/content`, { responseType: 'blob', signal }),
  refresh: (id: string) => api.post<LabItem>(`/voice-lab/items/${id}/refresh`, undefined, { timeout: 360000 }),
  generate: (data: Record<string, unknown>, file?: File | null) => {
    const form = new FormData()
    form.append('payload', JSON.stringify(data))
    if (file) form.append('file', file)
    // Generation runs as a background job: the answer is the job to follow, the item arrives in its result.
    return api.post<{ job_id: string; status: string }>('/voice-lab/generate', form, { timeout: 60000 })
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
