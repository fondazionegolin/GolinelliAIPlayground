import { tl } from '@/i18n/tl'
export interface Entity { id: string; name: string; kind: string; description: string; sheet_key?: string; sheet_ver?: number }
export interface Shot {
  id: string; n: number; title: string; narration: string; visual: string; motion: string; entities: string[]
  source?: 'upload'; clone_of?: string; transition?: string; transition_dur?: number
  status?: string; keyframe_key?: string; keyframe_ver?: number; video_key?: string; video_ver?: number; error?: string | null
  clip_dur?: number; trim_in?: number; trim_out?: number
  audio_key?: string; audio_ver?: number; audio_dur?: number
  audio_in?: number; audio_out?: number; audio_offset?: number | null
}
export interface Script {
  title?: string; logline?: string; style_bible?: string; entities?: Entity[]; shots?: Shot[]
  render_settings?: { provider: 'local' | 'openrouter'; model?: string; duration?: number | null; resolution?: string }
  voice?: { voice_id: string; name: string }
}
/** File name of a stored media key, e.g. `video-studio/<id>/key_ab12.jpg` -> `key_ab12.jpg`. */
export const mediaName = (key?: string) => (key ? key.split('/').pop() || '' : '')
export interface Project {
  id: string; title: string; style_key: string; aspect: string; language: string; target_shots: number
  status: string; phase_label: string | null; has_final: boolean; cost_credits: number; error: string | null
  running: boolean; updated_at: string | null; thumbnail?: string | null; shot_count?: number
  source_text?: string; brief?: string | null; script?: Script
}
export interface VideoStudioConfig {
  openrouter_configured: boolean; voice_configured: boolean
  configured: boolean; image_model: string; image_credits: number; sheet_credits: number
  voice_credits_per_1000_chars: number; chars_per_second: number; shot_seconds: number
  styles: Array<{ key: string; label: string }>; aspects: string[]; transitions: Array<{ key: string; label: string }>
}

export interface VideoModel {
  id: string; name: string; supported_durations: number[]; supported_resolutions: string[]
  supported_aspect_ratios: string[]; default_resolution: string | null
  credits_per_second: Record<string, number>; has_audio: boolean
}
export interface VoiceOption { voice_id: string; name: string; preview_url?: string | null; labels?: Record<string, string> }

export const STYLE_SWATCH: Record<string, string> = {
  flat_2d: 'linear-gradient(135deg,#fde68a,#f472b6)',
  watercolor: 'linear-gradient(135deg,#bfdbfe,#fbcfe8)',
  pixar_3d: 'linear-gradient(135deg,#a78bfa,#38bdf8)',
  paper_cutout: 'linear-gradient(135deg,#fdba74,#86efac)',
  scientific: 'linear-gradient(135deg,#e2e8f0,#7dd3fc)',
  clay: 'linear-gradient(135deg,#fca5a5,#fcd34d)',
  documentary: 'linear-gradient(135deg,#334155,#0f766e)',
  isometric: 'linear-gradient(135deg,#c4b5fd,#fde68a)',
}

export const STATUS_LABEL: Record<string, string> = {
  draft: tl("Bozza"), scripting: tl("Scrivo la sceneggiatura"), script_ready: tl("Sceneggiatura pronta"),
  storyboarding: tl("Genero lo storyboard"), storyboard_ready: tl("Storyboard pronto"), rendering: tl("Montaggio"),
  done: tl("Completato"), failed: tl("Errore"),
}

/** Busy only while the server really runs a task: a stale "rendering" status must not lock the editor. */
export const isBusy = (p?: Project) => !!p && p.running
