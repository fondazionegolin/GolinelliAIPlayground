import type { CellOutput } from '@/hooks/usePyodide'

export type NotebookProjectType = 'python' | 'p5js' | 'strudel' | 'game2d' | 'microbit' | 'circuitplayground'
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
  libraries?: string[]  // IDs of loaded extra libraries
  ml_model_ids?: string[]  // ML Lab projects attached to a p5.js sketch (window.GolinelliML)
  microbit_language?: 'python' | 'javascript'
  device_language?: 'python' | 'javascript'
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
  required_libraries?: string[]
  /** point-wise diff (changed blocks + context) computed by the agent pipeline; absent for legacy proposals */
  hunks?: NotebookDiffHunk[]
}

export interface NotebookDiffHunk {
  old_start: number
  old_end: number
  new_start: number
  new_end: number
  rows: Array<{ op: 'ctx' | 'add' | 'del'; text: string }>
}

export interface NotebookAgentMessageFile {
  path: string
  lines: number
  status: string
}

export interface NotebookAgentMessageMetadata {
  kind?: 'agent_progress' | 'agent_reasoning' | 'file_write_summary' | 'agent_feedback' | 'codegen_result'
  files?: NotebookAgentMessageFile[]
}

export interface NotebookTutorMessage {
  role: 'user' | 'assistant'
  content: string
  agent_name?: string
  metadata?: NotebookAgentMessageMetadata
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
