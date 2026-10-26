import type { DrawingScene } from './blackboard'

export type Box = { x: number; y: number; width: number; height: number }
export type Region = { id: string; label: string; text: string; box: Box; confidence: 'high' | 'medium' | 'low' }
export type Overlay = {
  kind: 'highlight' | 'underline' | 'arrow' | 'spotlight' | 'zoom' | 'crop' | 'label'
  region_id: string
  to_region_id?: string | null
  label: string
  color: 'violet' | 'cyan' | 'amber' | 'rose'
}
export type VisualStep = { title: string; action: string; explanation: string; overlays: Overlay[]; question: string; answer: string; hint: string }
export type VisualLesson = {
  objective?: string
  grounding: { subject: string; overview: string; regions: Region[]; warnings: string[] }
  lesson: { title: string; summary: string; steps: VisualStep[] }
}
export type SourceImage = { url: string; name: string; width: number; height: number }
export type ChatMessage = { role: 'user' | 'assistant'; content: string }
export type TutorAction = 'answer' | 'hint' | 'simplify' | 'question'
export type TutorReply = { outcome: 'correct' | 'retry' | 'hint' | 'clarify'; feedback: string; context: VisualLesson; completed_steps: number }

export const COLORS = { violet: '#a78bfa', cyan: '#22d3ee', amber: '#fbbf24', rose: '#fb7185' }

/** A part of the source marked by the student; coordinates are percentages of the image. */
export type Selection = { shape: 'rect' | 'lasso' | 'scribble' | 'brush'; box: Box; points: Array<[number, number]>; brush: number }
export type SavedVisualMessage = {
  id: string; request_id: string; role: 'user' | 'assistant'; content: string
  status: 'pending' | 'sent' | 'failed'; created_at: string; error?: string | null
  focus?: { overlays: Overlay[]; drawing?: DrawingScene; review?: DrawingReview; drawing_failed?: boolean }
  selection?: Selection
  /** Quick choices the tutor asked before acting (answered by clicking). */
  questions?: Array<{ question: string; options: string[] }>
  widgets?: LabWidget[]
}
export type DrawingReview = {
  applied: number; failed: boolean; verdict?: 'ok' | 'fix'; notes?: string[]
  scores?: { legibility: number; alignment: number; clarity: number; restraint: number }
}
export type LabWindow = { x_min: number; x_max: number; y_min: number; y_max: number }
export type ExplorerWidget = {
  id: string; kind: 'explorer'; title: string; equation: string; formula: string; note: string; window: LabWindow
  params: Array<{ name: string; label: string; min: number; max: number; step: number; value: number }>
}
export type ExerciseWidget = {
  id: string; kind: 'exercise'; title: string; prompt: string; target: string; template: string; show_target: boolean
  hints: string[]; explanation: string; window: LabWindow
}
/** Interactive objects on the board, kept by the session independently of the drawings' steps. */
export type LabWidget = ExplorerWidget | ExerciseWidget
export type VisualSessionItem = {
  id: string; title: string; image_name: string; image_width: number; image_height: number
  updated_at: string; revision: number; busy: boolean; message_count: number
}
export type DialogueState = {
  objective?: string; complete?: boolean; memory?: string; overlays?: Overlay[]; drawing?: DrawingScene; widgets?: LabWidget[]
  coverage?: Array<{ id: string; title: string; scope: string; source_unit_ids: string[]; status: string; evidence: string }>
}
export type SavedVisualSession = VisualSessionItem & {
  image_url: string; messages: SavedVisualMessage[]; draft: string
  dialogue: DialogueState; inventory: { grounding: VisualLesson['grounding']; units: unknown[] } | null
}
