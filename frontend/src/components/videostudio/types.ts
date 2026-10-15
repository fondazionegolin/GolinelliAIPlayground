export interface Entity { id: string; name: string; kind: string; description: string; sheet_key?: string; sheet_ver?: number }
export interface Shot {
  n: number; title: string; narration: string; visual: string; motion: string; entities: string[]
  status?: string; keyframe_key?: string; keyframe_ver?: number; video_key?: string; video_ver?: number; error?: string | null
}
export interface Script { title?: string; logline?: string; style_bible?: string; entities?: Entity[]; shots?: Shot[] }
export interface Project {
  id: string; title: string; style_key: string; aspect: string; language: string; target_shots: number
  status: string; phase_label: string | null; has_final: boolean; cost_usd: number; error: string | null
  running: boolean; updated_at: string | null; thumbnail?: string | null; shot_count?: number
  source_text?: string; brief?: string | null; script?: Script
}
export interface VideoStudioConfig {
  configured: boolean; image_model: string; image_cost_usd: number; shot_seconds: number
  styles: Array<{ key: string; label: string }>; aspects: string[]
}

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
  draft: 'Bozza', scripting: 'Scrivo la sceneggiatura', script_ready: 'Sceneggiatura pronta',
  storyboarding: 'Genero lo storyboard', storyboard_ready: 'Storyboard pronto', rendering: 'Montaggio',
  done: 'Completato', failed: 'Errore',
}

export const isBusy = (p?: Project) => !!p && (p.running || ['storyboarding', 'rendering', 'scripting'].includes(p.status))
