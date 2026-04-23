import type { CellOutput } from '@/hooks/usePyodide'

export type NotebookProjectType = 'python' | 'p5js'
export type NotebookTheme = 'dark' | 'light' | 'fancy' | 'dracula' | 'p5js'
export type NotebookFontFamily = 'jetbrains' | 'space' | 'courier' | 'victor' | 'plex'

export interface Cell {
  id: string
  type: 'code' | 'markdown'
  source: string
  name?: string
  outputs: CellOutput[]
  execution_count: number | null
}

export interface NotebookEditorSettings {
  theme: NotebookTheme
  font_size: number
  font_family: NotebookFontFamily
  live_preview: boolean
  font_weight?: number
}

export interface NotebookCodeProposal {
  id: string
  line_start: number
  line_end: number
  severity: 'error' | 'warning' | 'info'
  message: string
  replacement: string
  explanation: string
  teacher_note: string
}

export interface NotebookTutorMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface NotebookDetail {
  id: string
  title: string
  project_type: NotebookProjectType
  cells: Cell[]
  editor_settings: NotebookEditorSettings
  tutor_messages: NotebookTutorMessage[]
  created_at: string
  updated_at: string
}
