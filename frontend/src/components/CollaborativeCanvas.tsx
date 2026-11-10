import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ColorPicker } from '@/components/ui/ColorPicker'
import * as XLSX from 'xlsx'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { chatApi, teacherApi, studentApi } from '@/lib/api'
import {
  Eraser, StickyNote, Type, ImagePlus, Table, Pencil, Frame, MoveRight,
  RectangleHorizontal, Triangle, Circle, Square, Minus, ArrowRight, Undo2, Redo2, Maximize, Minimize,
  LayoutTemplate, Maximize2, MousePointer, Trash2, Users, Move, Sparkles,
} from '@/components/icons'
import { tl } from '@/i18n/tl'
import { BRAINSTORM_ACTIONS } from './canvasBrainstorm'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { FormulaEditor } from './FormulaEditor'
import { MotionFrame, MotionPlayer } from './motion/MotionStage'
import { CanvasShape } from './CanvasShape'
import { CheckCard, FlashCard, QuizCard, type CheckResult } from './CanvasInteractive'
import { canvasLabelColor, isToneStroke, shadeTopFor, shapeStrokeFor } from './canvasColors'
import { DEMOS } from './motion/library'
import { buildTutorial, TUTORIAL_SIZE } from './canvasTutorial'
import type { Scene } from './motion/spec'
import { CanvasMinimap, type MinimapItem } from './CanvasMinimap'
import { plainToLatex } from './canvasMath'
import { findFreeRect, graphFromFormula, makePath, normalizePath, applyAiOps, describeDoc, renderDocToPng, collectImages, plotGeometry, type AiOp, type SceneItem } from './canvasAi'

// ─── Types ────────────────────────────────────────────────────────────────────

type CanvasRole = 'teacher' | 'student'
type Tool = 'select' | 'hand' | 'postit' | 'frame' | 'text' | 'pen' | 'roundedRect' | 'triangle' | 'connector' | 'rect' | 'ellipse' | 'diamond' | 'star' | 'hexagon' | 'line' | 'arrow' | 'formula' | 'move'
const SHAPE_TOOLS: Tool[] = ['roundedRect', 'triangle', 'rect', 'ellipse']

type Point = { x: number; y: number }
type Anchor = 'top' | 'right' | 'bottom' | 'left'
const ANCHORS: Anchor[] = ['top', 'right', 'bottom', 'left']
type LockInfo = { userId: string; userType: string }
type Collaborator = { id: string; name: string; role: 'teacher' | 'student'; avatarUrl?: string }
type RemoteCursor = { userId: string; label: string; color: string; x: number; y: number; updatedAt: number }

/** `by`/`at`: who created the item and when (ms); `eb`/`et`: who last edited it. They feed the board report. */
/** `role`: sections made by an AI regrouping (and their summary text), reused by the next regrouping instead of duplicated. */
type CanvasItemBase = { id: string; parentFrameId?: string; ai?: boolean; by?: string; at?: number; eb?: string; et?: number; role?: 'cluster' | 'cluster-summary' }
type CanvasAnswer = { name: string; ok: boolean; at: number; choice?: number; text?: string; feedback?: string }

type CanvasTextStyle = {
  fontFamily: string
  fontSize: number
  fontWeight: 'normal' | '600'
  fontStyle: 'normal' | 'italic'
}

type CanvasBorderStyle = 'solid' | 'dashed' | 'hand-drawn'

type CanvasPositionedItemBase = CanvasItemBase & { x: number; y: number; w: number; h: number }

type CanvasItem =
  | (CanvasPositionedItemBase & { type: 'postit'; text: string; color: string; textStyle?: CanvasTextStyle })
  | (CanvasPositionedItemBase & { type: 'frame'; text: string; color: string; backgroundColor?: string; borderWidth?: number; borderStyle?: CanvasBorderStyle; textStyle?: CanvasTextStyle })
  | (CanvasPositionedItemBase & { type: 'text'; text: string; color: string; textStyle?: CanvasTextStyle })
  | (CanvasPositionedItemBase & { type: 'shape'; shape: 'rect' | 'rounded-rect' | 'ellipse' | 'diamond' | 'triangle' | 'star' | 'hexagon' | 'parallelogram'; fill: string; fillOpacity?: number; stroke: string; borderWidth?: number; borderStyle?: CanvasBorderStyle; text?: string; textColor?: string; textStyle?: CanvasTextStyle })
  | (CanvasItemBase & { type: 'connector'; fromId: string; fromAnchor: Anchor; toId: string; toAnchor: Anchor; color: string; width: number })
  | (CanvasPositionedItemBase & { type: 'line'; color: string; width: number; arrow?: boolean; flipX?: boolean; flipY?: boolean })
  | (CanvasPositionedItemBase & { type: 'animation'; scene: Scene })
  | (CanvasPositionedItemBase & { type: 'formula'; latex: string; src?: string; fontSize: number; color: string })
  | (CanvasPositionedItemBase & { type: 'plot'; expr: string; xMin: number; xMax: number; yMin: number; yMax: number; color: string; title?: string; marks?: Array<{ x: number; y: number; label?: string }> })
  | (CanvasPositionedItemBase & { type: 'image'; src: string })
  | (CanvasPositionedItemBase & { type: 'table'; data: string[][] })
  | (CanvasPositionedItemBase & { type: 'path'; points: Point[]; ow: number; oh: number; color: string; width: number })
  | (CanvasPositionedItemBase & { type: 'quiz'; question: string; options: string[]; correct: number[]; explanation?: string; color: string; answers?: Record<string, CanvasAnswer> })
  | (CanvasPositionedItemBase & { type: 'flashcard'; front: string; back: string; color: string; answers?: Record<string, CanvasAnswer> })
  | (CanvasPositionedItemBase & { type: 'check'; question: string; expected: string; hint?: string; color: string; answers?: Record<string, CanvasAnswer> })

type CanvasDoc = { type: 'canvas_v1'; items: CanvasItem[] }
export type { CanvasItem, CanvasDoc }

/** What the smart-canvas page can do to a mounted board. */
export interface CanvasHandle {
  /** Everything the model needs to read the board: pixels, structured scene, selection, pasted originals. */
  snapshot(): Promise<{ overview: string; images: string[]; imagesMeta: Array<{ id: string; width: number; height: number }>; items: SceneItem[]; selected: string[]; doc: CanvasDoc; fromAlias: Record<string, string> }>
  applyOps(ops: AiOp[]): { created: string[]; idMap: Record<string, string> }
  focusItems(ids: string[]): void
  getDoc(): CanvasDoc
  /** Lays the built-in tutorial out on the board (beside existing content) and zooms to its first station. */
  insertTutorial(): void
}

interface CollaborativeCanvasProps {
  sessionId?: string
  canvasName?: string
  role: CanvasRole
  title: string
  onTitleChange?: (title: string) => void
  initialContent?: string
  onContentChange?: (contentJson: string) => void
  readOnly?: boolean
  /** The viewer owns this shared board: they always edit it, whatever the students' edit flag says. */
  ownerCanWrite?: boolean
  /** Extra controls drawn at the right of the top bar (e.g. open the AI panel). */
  chrome?: React.ReactNode
  /** Fill the parent's height instead of the viewport-based default. */
  fill?: boolean
  /** Lets formula actions (solve, explain…) hand a request to the AI assistant. */
  onAssist?: (prompt: string, itemIds: string[]) => void
  /** Controls at the far left of the top bar (e.g. back to the list). */
  leading?: React.ReactNode
  /** Shows the «Guida» button, which lays the tutorial out on the board. */
  tutorial?: boolean
  /** Called once the board's content is loaded and ready to be edited. */
  onHydrated?: () => void
  /** Fires with the live value of the single students-can-write flag (the AI assistant follows it). */
  onPermissionChange?: (studentsCanWrite: boolean) => void
  /** Display name stamped on the items this viewer creates or edits (the board report tells who did what). */
  author?: string
  /** Checks an open answer of a «Verifica» card against its key (AI); without it a keyword match is used. */
  onValidateAnswer?: (question: string, expected: string, answer: string) => Promise<CheckResult>
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MIN_ZOOM = 0.15
const MAX_ZOOM = 3
const EMPTY_CANVAS: CanvasDoc = { type: 'canvas_v1', items: [] }

const DEFAULT_TEXT_STYLE: CanvasTextStyle = {
  fontFamily: 'Inter, system-ui, sans-serif',
  fontSize: 14,
  fontWeight: 'normal',
  fontStyle: 'normal',
}

const POSTIT_PALETTE = ['#fef9c3', '#fce7f3', '#dbeafe', '#dcfce7', '#ffedd5', '#ede9fe', '#fecaca', '#e0f2fe']
const COLLABORATOR_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2', '#4f46e5', '#be123c']

// ─── Template definitions ─────────────────────────────────────────────────────

function mkId() { return crypto.randomUUID() }

function collaboratorColor(userId: string): string {
  let hash = 0
  for (let index = 0; index < userId.length; index += 1) hash = ((hash << 5) - hash + userId.charCodeAt(index)) | 0
  return COLLABORATOR_COLORS[Math.abs(hash) % COLLABORATOR_COLORS.length]
}

function jwtSubject(token: string | null): string {
  if (!token) return ''
  try {
    const encoded = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/') || ''
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')
    return String(JSON.parse(atob(padded))?.sub || '')
  } catch {
    return ''
  }
}

function simplifyPoints(points: Point[], minimumDistance: number): Point[] {
  if (points.length <= 2) return points
  const simplified = [points[0]]
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = simplified[simplified.length - 1]
    const point = points[index]
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= minimumDistance) simplified.push(point)
  }
  simplified.push(points[points.length - 1])
  return simplified
}

const TEMPLATES = [
  {
    id: 'brainstorming',
    name: 'Brainstorming',
    description: 'Idea centrale con rami per esplorare un tema liberamente',
    emoji: '🧠',
    create(): CanvasDoc {
      const centerId = mkId()
      const center: CanvasItem = {
        id: centerId, type: 'frame', x: 540, y: 380, w: 300, h: 130,
        text: '💡 Tema centrale', color: '#7c3aed',
        textStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 16, fontWeight: '600' },
      }
      const satellites = [
        { x: 100, y: 160, text: 'Idea 1', color: '#fef9c3' },
        { x: 540, y: 80, text: 'Idea 2', color: '#fce7f3' },
        { x: 980, y: 160, text: 'Idea 3', color: '#dbeafe' },
        { x: 100, y: 600, text: 'Idea 4', color: '#dcfce7' },
        { x: 540, y: 680, text: 'Idea 5', color: '#ffedd5' },
        { x: 980, y: 600, text: 'Idea 6', color: '#ede9fe' },
      ]
      const postits: CanvasItem[] = satellites.map(({ x, y, text, color }) => ({
        id: mkId(), type: 'postit', x, y, w: 200, h: 140,
        text, color, textStyle: DEFAULT_TEXT_STYLE,
      }))
      const connectors: CanvasItem[] = postits.map((p) => ({
        id: mkId(), type: 'connector',
        fromId: centerId, fromAnchor: 'bottom',
        toId: p.id, toAnchor: 'top',
        color: '#a3a3a3', width: 2,
      }))
      return { type: 'canvas_v1', items: [center, ...postits, ...connectors] }
    },
  },
  {
    id: 'feedback',
    name: 'Feedback WWW / EBI',
    description: 'Cosa ha funzionato bene · Come migliorare',
    emoji: '💬',
    create(): CanvasDoc {
      const title: CanvasItem = {
        id: mkId(), type: 'text', x: 260, y: 40, w: 860, h: 60,
        text: 'Sessione di feedback', color: '#262626',
        textStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 22, fontWeight: '600' },
      }
      const wwwId = mkId(), ebiId = mkId()
      const www: CanvasItem = {
        id: wwwId, type: 'frame', x: 40, y: 130, w: 560, h: 560,
        text: '✅ Cosa ha funzionato bene', color: '#16a34a',
        textStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 14, fontWeight: '600' },
      }
      const ebi: CanvasItem = {
        id: ebiId, type: 'frame', x: 640, y: 130, w: 560, h: 560,
        text: '⚡ Come migliorare (EBI)', color: '#ea580c',
        textStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 14, fontWeight: '600' },
      }
      const wwwPostits: CanvasItem[] = [90, 260, 430].map((y) => ({
        id: mkId(), type: 'postit', x: 80, y, w: 480, h: 110,
        text: tl("Scrivi qui..."), color: '#dcfce7', textStyle: DEFAULT_TEXT_STYLE, parentFrameId: wwwId,
      }))
      const ebiPostits: CanvasItem[] = [90, 260, 430].map((y) => ({
        id: mkId(), type: 'postit', x: 680, y, w: 480, h: 110,
        text: tl("Scrivi qui..."), color: '#ffedd5', textStyle: DEFAULT_TEXT_STYLE, parentFrameId: ebiId,
      }))
      return { type: 'canvas_v1', items: [title, www, ebi, ...wwwPostits, ...ebiPostits] }
    },
  },
  {
    id: 'kwl',
    name: 'Tabella KWL',
    description: 'Conosco · Voglio sapere · Ho imparato',
    emoji: '📚',
    create(): CanvasDoc {
      const cols = [
        { x: 40, text: tl("🔵 Conosco già"), color: '#3ea9f4', postColor: '#dbeafe' },
        { x: 460, text: tl("🟡 Voglio sapere"), color: '#ca8a04', postColor: '#fef9c3' },
        { x: 880, text: tl("🟢 Ho imparato"), color: '#16a34a', postColor: '#dcfce7' },
      ]
      const items: CanvasItem[] = cols.flatMap(({ x, text, color, postColor }) => {
        const fId = mkId()
        const frame: CanvasItem = {
          id: fId, type: 'frame', x, y: 40, w: 380, h: 680,
          text, color, textStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 14, fontWeight: '600' },
        }
        const postits: CanvasItem[] = [100, 270, 440, 610].map((y) => ({
          id: mkId(), type: 'postit', x: x + 20, y, w: 340, h: 120,
          text: '', color: postColor, textStyle: DEFAULT_TEXT_STYLE, parentFrameId: fId,
        }))
        return [frame, ...postits]
      })
      return { type: 'canvas_v1', items }
    },
  },
  {
    id: 'swot',
    name: 'Analisi SWOT',
    description: 'Forze · Debolezze · Opportunità · Minacce',
    emoji: '📊',
    create(): CanvasDoc {
      const quads = [
        { x: 40, y: 40, text: tl("💪 Punti di forza"), color: '#16a34a', postColor: '#dcfce7' },
        { x: 520, y: 40, text: tl("⚠️ Debolezze"), color: '#dc2626', postColor: '#fee2e2' },
        { x: 40, y: 440, text: tl("🌟 Opportunità"), color: '#3ea9f4', postColor: '#dbeafe' },
        { x: 520, y: 440, text: tl("⚡ Minacce"), color: '#ea580c', postColor: '#ffedd5' },
      ]
      const items: CanvasItem[] = quads.flatMap(({ x, y, text, color, postColor }) => {
        const fId = mkId()
        return [
          { id: fId, type: 'frame', x, y, w: 440, h: 360, text, color, textStyle: { ...DEFAULT_TEXT_STYLE, fontWeight: '600' } } as CanvasItem,
          { id: mkId(), type: 'postit', x: x + 20, y: y + 80, w: 400, h: 250, text: '', color: postColor, textStyle: DEFAULT_TEXT_STYLE, parentFrameId: fId } as CanvasItem,
        ]
      })
      return { type: 'canvas_v1', items }
    },
  },
  {
    id: 'timeline',
    name: 'Timeline',
    description: 'Sequenza di fasi o eventi in ordine cronologico',
    emoji: '📅',
    create(): CanvasDoc {
      const labels = ['Fase 1', 'Fase 2', 'Fase 3', 'Fase 4', 'Fase 5']
      const frameIds: string[] = []
      const items: CanvasItem[] = []
      labels.forEach((label, i) => {
        const fId = mkId()
        frameIds.push(fId)
        items.push({ id: fId, type: 'frame', x: 40 + i * 300, y: 160, w: 260, h: 340, text: label, color: '#3ea9f4', textStyle: { ...DEFAULT_TEXT_STYLE, fontWeight: '600' } } as CanvasItem)
        items.push({ id: mkId(), type: 'postit', x: 60 + i * 300, y: 260, w: 220, h: 220, text: '', color: '#dbeafe', textStyle: DEFAULT_TEXT_STYLE, parentFrameId: fId } as CanvasItem)
      })
      for (let i = 0; i < frameIds.length - 1; i++) {
        items.push({ id: mkId(), type: 'connector', fromId: frameIds[i], fromAnchor: 'right', toId: frameIds[i + 1], toAnchor: 'left', color: '#737373', width: 2.5 } as CanvasItem)
      }
      return { type: 'canvas_v1', items }
    },
  },
  {
    id: 'rose-bud-thorn',
    name: 'Rosa · Bocciolo · Spina',
    description: 'Riflessione positiva, potenzialità e difficoltà',
    emoji: '🌹',
    create(): CanvasDoc {
      const cols = [
        { x: 40, text: tl("🌹 Rosa (positivo)"), color: '#e11d48', postColor: '#fce7f3' },
        { x: 460, text: tl("🌱 Bocciolo (potenziale)"), color: '#16a34a', postColor: '#dcfce7' },
        { x: 880, text: tl("🌵 Spina (difficoltà)"), color: '#78350f', postColor: '#fef3c7' },
      ]
      const items: CanvasItem[] = cols.flatMap(({ x, text, color, postColor }) => {
        const fId = mkId()
        const frame: CanvasItem = { id: fId, type: 'frame', x, y: 40, w: 380, h: 560, text, color, textStyle: { ...DEFAULT_TEXT_STYLE, fontWeight: '600' } }
        const postits: CanvasItem[] = [100, 290, 450].map((y) => ({
          id: mkId(), type: 'postit', x: x + 20, y, w: 340, h: 140, text: '', color: postColor, textStyle: DEFAULT_TEXT_STYLE, parentFrameId: fId,
        }))
        return [frame, ...postits]
      })
      return { type: 'canvas_v1', items }
    },
  },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ensureTextStyle = (item: CanvasItem): CanvasItem => {
  if (item.type !== 'postit' && item.type !== 'frame' && item.type !== 'text' && item.type !== 'shape') return item
  if (item.type === 'shape') {
    return {
      ...item,
      text: item.text || '',
      textColor: item.textColor || '#171717',
      borderWidth: item.borderWidth ?? 2.5,
      borderStyle: item.borderStyle || 'solid',
      textStyle: { ...DEFAULT_TEXT_STYLE, ...(item.textStyle || {}) },
    }
  }
  if (item.type === 'frame') {
    return {
      ...item,
      backgroundColor: item.backgroundColor || '#ffffff99',
      borderWidth: item.borderWidth ?? 2,
      borderStyle: item.borderStyle || 'dashed',
      textStyle: { ...DEFAULT_TEXT_STYLE, ...(item.textStyle || {}) },
    }
  }
  return { ...item, textStyle: { ...DEFAULT_TEXT_STYLE, ...(item.textStyle || {}) } } as CanvasItem
}

const apiByRole = {
  teacher: { getCanvas: teacherApi.getCanvas, updateCanvas: teacherApi.updateCanvas },
  student: { getCanvas: studentApi.getCanvas, updateCanvas: studentApi.updateCanvas },
}

const parseCanvasDoc = (raw: string | null | undefined): CanvasDoc => {
  if (!raw) return EMPTY_CANVAS
  try {
    const parsed = JSON.parse(raw)
    if (parsed?.type === 'canvas_v1' && Array.isArray(parsed.items)) {
      return { type: 'canvas_v1', items: parsed.items.map((item: CanvasItem) => normalizePath(ensureTextStyle(item))) }
    }
  } catch { /* no-op */ }
  return EMPTY_CANVAS
}

/** Three-way, item-level merge used when two collaborators save different
 * objects from the same canvas version. Local edits win only for objects that
 * changed locally; untouched remote work is retained. */
const mergeCanvasDocs = (base: CanvasDoc, local: CanvasDoc, remote: CanvasDoc): CanvasDoc => {
  const baseById = new Map(base.items.map((item) => [item.id, item]))
  const localById = new Map(local.items.map((item) => [item.id, item]))
  const changedLocally = new Set<string>()
  baseById.forEach((baseItem, id) => {
    const localItem = localById.get(id)
    if (!localItem || JSON.stringify(localItem) !== JSON.stringify(baseItem)) changedLocally.add(id)
  })
  localById.forEach((_item, id) => { if (!baseById.has(id)) changedLocally.add(id) })

  const merged = remote.items
    .filter((item) => !(changedLocally.has(item.id) && !localById.has(item.id)))
    .map((item) => {
      if (!changedLocally.has(item.id)) return item
      const mine = localById.get(item.id)
      if (!mine) return item
      const theirs = (item as { answers?: Record<string, unknown> }).answers, ours = (mine as { answers?: Record<string, unknown> }).answers
      return theirs || ours ? { ...mine, answers: { ...(theirs || {}), ...(ours || {}) } } as CanvasItem : mine
    })
  const mergedIds = new Set(merged.map((item) => item.id))
  local.items.forEach((item) => {
    if (changedLocally.has(item.id) && !mergedIds.has(item.id)) merged.push(item)
  })
  return { type: 'canvas_v1', items: merged }
}

const toCsvTable = (rows: Array<Array<string | number | boolean | null>>): string[][] =>
  rows.map((row) => row.map((cell) => (cell == null ? '' : String(cell))))

const isFrame = (item: CanvasItem): item is Extract<CanvasItem, { type: 'frame' }> => item.type === 'frame'
const isConnector = (item: CanvasItem): item is Extract<CanvasItem, { type: 'connector' }> => item.type === 'connector'
const isShape = (item: CanvasItem): item is Extract<CanvasItem, { type: 'shape' }> => item.type === 'shape'
const isTextEditable = (item: CanvasItem): item is Extract<CanvasItem, { type: 'postit' | 'frame' | 'text' | 'shape' }> =>
  item.type === 'postit' || item.type === 'frame' || item.type === 'text' || item.type === 'shape'
const isPositioned = (item: CanvasItem): item is Exclude<CanvasItem, { type: 'connector' }> =>
  !isConnector(item)

const getAnchorPoint = (item: Exclude<CanvasItem, { type: 'connector' }>, anchor: Anchor): Point => {
  if (anchor === 'top') return { x: item.x + item.w / 2, y: item.y }
  if (anchor === 'right') return { x: item.x + item.w, y: item.y + item.h / 2 }
  if (anchor === 'bottom') return { x: item.x + item.w / 2, y: item.y + item.h }
  return { x: item.x, y: item.y + item.h / 2 }
}

const anchorDirection = (anchor: Anchor): Point => {
  if (anchor === 'top') return { x: 0, y: -1 }
  if (anchor === 'right') return { x: 1, y: 0 }
  if (anchor === 'bottom') return { x: 0, y: 1 }
  return { x: -1, y: 0 }
}

const extractImageUrlsFromHtml = (html: string): string[] =>
  [...html.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map((m) => String(m[1] || '').trim()).filter(Boolean)

const looksLikeImageUrl = (v: string) =>
  Boolean(v) && (v.startsWith('data:image/') || v.startsWith('blob:') || /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(v))

const isContainedInFrame = (c: { x: number; y: number; w: number; h: number }, f: Extract<CanvasItem, { type: 'frame' }>) =>
  c.x >= f.x && c.y >= f.y && c.x + c.w <= f.x + f.w && c.y + c.h <= f.y + f.h

const getParentFrameId = (item: CanvasItem, items: CanvasItem[], skipFrameId?: string): string | undefined => {
  if (!isPositioned(item)) return item.parentFrameId
  const containers = items.filter(isFrame).filter((f) => f.id !== item.id && f.id !== skipFrameId && isContainedInFrame(item, f))
  if (containers.length === 0) return undefined
  containers.sort((a, b) => a.w * a.h - b.w * b.h)
  return containers[0].id
}

const collectFrameDescendants = (items: CanvasItem[], frameId: string): string[] => {
  const result = new Set<string>()
  const queue = [frameId]
  while (queue.length > 0) {
    const cur = queue.shift() as string
    items.forEach((item) => {
      if (item.parentFrameId === cur && !result.has(item.id)) {
        result.add(item.id)
        if (isFrame(item)) queue.push(item.id)
      }
    })
  }
  return Array.from(result)
}

// ─── Tool button (module-level to avoid remount on parent re-render) ──────────

const GrabHandIcon = ({ className }: { className?: string }) => <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d="M8 12V6.5a1.5 1.5 0 0 1 3 0V11" /><path d="M11 10.5V5a1.5 1.5 0 0 1 3 0v5.5" /><path d="M14 10.5V6.5a1.5 1.5 0 0 1 3 0V14c0 4-2.5 6.5-6 6.5-2.4 0-3.7-1-5-3L4 14.2a1.4 1.4 0 0 1 2.3-1.6L8 14.5V12" /></svg>
const SigmaIcon = ({ className }: { className?: string }) => <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><path d="M18 5H6l6 7-6 7h12" /></svg>
const AnimationIcon = ({ className }: { className?: string }) => <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M10 8.5v5l4-2.5z" /><path d="M8 21h8" /></svg>
const MapIcon = ({ className }: { className?: string }) => <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2zM9 4v14M15 6v14" /></svg>

function ToolButton({
  activeTool,
  t,
  icon: Icon,
  label,
  onSetTool,
}: {
  activeTool: Tool
  t: Tool
  icon: React.ElementType
  label: string
  onSetTool: (t: Tool) => void
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={() => onSetTool(t)}
      className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm transition-colors ${
        activeTool === t ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
      }`}
    >
      <Icon className="h-4 w-4" />
    </button>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export const CollaborativeCanvas = forwardRef<CanvasHandle, CollaborativeCanvasProps>(function CollaborativeCanvas({
  sessionId,
  canvasName,
  role,
  title,
  onTitleChange,
  initialContent,
  onContentChange,
  readOnly = false,
  ownerCanWrite = false,
  chrome,
  fill = false,
  onAssist,
  onPermissionChange,
  leading,
  tutorial = false,
  onHydrated,
  author,
  onValidateAnswer,
}, handleRef) {
  const collaborationNameRef = useRef((canvasName || title || tl("Lavagna collaborativa")).trim())
  const [collaborationKey, setCollaborationKey] = useState(() => collaborationNameRef.current.toLocaleLowerCase().trim().replace(/\s+/g, ' ').slice(0, 240))
  // Refs
  const containerRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({})
  const previewPathRef = useRef<SVGPathElement | null>(null)
  const connectorPreviewRef = useRef<SVGPathElement | null>(null)
  const createPreviewRef = useRef<HTMLDivElement | null>(null)
  const marqueeElementRef = useRef<HTMLDivElement | null>(null)
  const textEditorRefs = useRef<Record<string, HTMLTextAreaElement | HTMLInputElement | null>>({})
  const startTextEditingRef = useRef<(itemId: string, seed?: string) => void>(() => {})
  const draggingRef = useRef<{ id: string; offsetX: number; offsetY: number; originX: number; originY: number; pendingX?: number; pendingY?: number; childIds: string[]; origins: Record<string, Point> } | null>(null)
  const pendingDragRef = useRef<{ id: string; offsetX: number; offsetY: number; startX: number; startY: number } | null>(null)
  const marqueeRef = useRef<{ start: Point; current: Point; additive: boolean } | null>(null)
  const resizingRef = useRef<{ id: string; startX: number; startY: number; startW: number; startH: number; pendingW?: number; pendingH?: number } | null>(null)
  const drawingRef = useRef<{ points: Point[] } | null>(null)
  const panningRef = useRef<{ startMouseX: number; startMouseY: number; startPanX: number; startPanY: number } | null>(null)
  const dragCreateRef = useRef<{ tool: Tool; startX: number; startY: number; currentX: number; currentY: number; parentFrameId?: string } | null>(null)
  const spaceHeldRef = useRef(false)
  const saveTimerRef = useRef<number | null>(null)
  const pollTimerRef = useRef<number | null>(null)
  const lastSerializedRef = useRef('')
  const isInteractingRef = useRef(false)
  const latestSerializedRef = useRef('')
  const remoteWhileInteractingRef = useRef<string | null>(null)
  const rafDrawRef = useRef<number | null>(null)
  const dragRafRef = useRef<number | null>(null)
  const resizeRafRef = useRef<number | null>(null)
  const panRafRef = useRef<number | null>(null)
  const viewportCommitTimerRef = useRef<number | null>(null)
  const historyTimerRef = useRef<number | null>(null)
  const contentChangeTimerRef = useRef<number | null>(null)
  const onContentChangeRef = useRef(onContentChange)
  const lockTimestampsRef = useRef<Record<string, number>>({})
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const undoRedoRef = useRef(false)
  const deleteSelectedRef = useRef<() => void>(() => { /* noop */ })
  const versionRef = useRef(0)
  const panRef = useRef({ x: 220, y: 140 })
  const zoomRef = useRef(1)
  const activePointerIdRef = useRef<number | null>(null)
  const pointersRef = useRef(new Map<number, Point>())
  const pinchRef = useRef<{ startDistance: number; worldX: number; worldY: number; startZoom: number } | null>(null)
  const pushRemoteCanvasRef = useRef<(serialized: string) => Promise<void>>(async () => {})
  const lastTransformEmitRef = useRef(0)
  const lastCursorEmitRef = useRef(0)
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const hydratedSessionRef = useRef<string | null>(null)

  // Canvas state
  const [tool, setTool] = useState<Tool>('select')
  const [strokeColor, setStrokeColor] = useState('#3ea9f4')
  const [strokeWidth, setStrokeWidth] = useState(3)
  const [newPostitColor, setNewPostitColor] = useState('#fef9c3')
  const [newShapeFill, setNewShapeFill] = useState('#bae6fd')
  // null = tone on tone: the border follows the fill, a little darker
  const [newShapeStrokeChoice, setNewShapeStroke] = useState<string | null>(null)
  const newShapeStroke = newShapeStrokeChoice ?? shapeStrokeFor(newShapeFill)
  const [canvasDoc, setCanvasDoc] = useState<CanvasDoc>(() => parseCanvasDoc(initialContent))
  // Ids already known (loaded or received): anything else that appears was made here, and gets this viewer as author.
  const seenIdsRef = useRef<Set<string> | null>(null)
  if (!seenIdsRef.current) seenIdsRef.current = new Set(canvasDoc.items.map((item) => item.id))
  const markSeen = (doc: CanvasDoc) => doc.items.forEach((item) => seenIdsRef.current!.add(item.id))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [connectorDrag, setConnectorDrag] = useState<{
    fromId: string; fromAnchor: Anchor; toPoint: Point; hoverTarget?: { id: string; anchor: Anchor }
  } | null>(null)
  const [isDropActive, setIsDropActive] = useState(false)
  const [version, setVersion] = useState(0)
  const [previewPoints, setPreviewPoints] = useState<Point[]>([])
  const [previewCreate, setPreviewCreate] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [locks, setLocks] = useState<Record<string, LockInfo>>({})
  const [socketConnected, setSocketConnected] = useState(false)
  const [remoteCursors, setRemoteCursors] = useState<Record<string, RemoteCursor>>({})

  // New: viewport & UI state
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 220, y: 140 })
  const [isPanning, setIsPanning] = useState(false)
  const [studentsCanWrite, setStudentsCanWrite] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [showMinimap, setShowMinimap] = useState(true)
  const [liveSocket, setLiveSocket] = useState<any>(() => (window as any).socket || null)
  const [online, setOnline] = useState<Collaborator[]>([])
  const [summon, setSummon] = useState<{ x: number; y: number; label: string; at: number } | null>(null)
  const [summonError, setSummonError] = useState('')
  useEffect(() => { if (!summonError) return; const t = window.setTimeout(() => setSummonError(''), 4000); return () => window.clearTimeout(t) }, [summonError])
  const onHydratedRef = useRef(onHydrated)
  onHydratedRef.current = onHydrated
  const onPermissionChangeRef = useRef(onPermissionChange)
  onPermissionChangeRef.current = onPermissionChange
  const [viewSize, setViewSize] = useState({ w: 800, h: 600 })
  const [showTemplates, setShowTemplates] = useState(false)
  const [showAnimations, setShowAnimations] = useState(false)
  const [showMore, setShowMore] = useState(false)
  const [historyIndex, setHistoryIndex] = useState(-1)
  const [contextMenu, setContextMenu] = useState<{ screenX: number; screenY: number; itemId: string | null } | null>(null)

  // Derived
  const canEdit = !readOnly && (role === 'teacher' || !sessionId || studentsCanWrite || ownerCanWrite)
  const serializedDoc = useMemo(() => JSON.stringify(canvasDoc), [canvasDoc])
  const itemById = useMemo(() => new Map(canvasDoc.items.map((item) => [item.id, item])), [canvasDoc.items])
  const connectorItems = useMemo(() => canvasDoc.items.filter(isConnector) as Array<Extract<CanvasItem, { type: 'connector' }>>, [canvasDoc.items])
  const positionedItems = useMemo(() => canvasDoc.items.filter(isPositioned), [canvasDoc.items])
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])
  // Frames are containers: by definition they always sit below every other element (larger frames under the ones
  // they contain), then the connector layer, then everything else in document order. «Porta avanti/indietro» reorders
  // inside each layer, never across it.
  const { itemZIndex, connectorLayerZ } = useMemo(() => {
    const order = new Map(canvasDoc.items.map((item, index) => [item.id, index]))
    const frames = canvasDoc.items.filter(isFrame).sort((a, b) => (b.w * b.h - a.w * a.h) || (order.get(a.id)! - order.get(b.id)!))
    const z = new Map<string, number>(frames.map((frame, index) => [frame.id, index + 1]))
    const base = frames.length + 2
    canvasDoc.items.forEach((item, index) => { if (!isFrame(item)) z.set(item.id, base + index) })
    return { itemZIndex: z, connectorLayerZ: frames.length + 1 }
  }, [canvasDoc.items])
  const selectedItem = useMemo(
    () => (selectedId ? itemById.get(selectedId) || null : null),
    [itemById, selectedId],
  )
  const editingFormula = useMemo(() => {
    const item = editingId ? canvasDoc.items.find((i) => i.id === editingId) : null
    return item && item.type === 'formula' ? item : null
  }, [canvasDoc.items, editingId])
  const selectedTextStyle = useMemo(() => {
    if (!selectedItem || !isTextEditable(selectedItem)) return null
    return { ...DEFAULT_TEXT_STYLE, ...(selectedItem.textStyle || {}) }
  }, [selectedItem])

  const currentUserId = useMemo(() => {
    const raw = role === 'student' ? localStorage.getItem('student_token') : localStorage.getItem('access_token')
    return jwtSubject(raw)
  }, [role])
  const viewer = useMemo(() => ({ key: currentUserId || author || 'me', name: author || (role === 'teacher' ? tl("Docente") : tl("Studente")) }), [author, currentUserId, role])

  useEffect(() => { latestSerializedRef.current = serializedDoc }, [serializedDoc])

  useEffect(() => {
    const seen = seenIdsRef.current!
    const fresh = canvasDoc.items.filter((item) => !seen.has(item.id))
    if (!fresh.length) return
    fresh.forEach((item) => seen.add(item.id))
    const stamp = new Set(fresh.filter((item) => !item.by).map((item) => item.id))
    if (!author || !stamp.size) return
    const now = Date.now()
    setCanvasDoc((prev) => ({ ...prev, items: prev.items.map((item) => (stamp.has(item.id) && !item.by ? { ...item, by: author, at: now } as CanvasItem : item)) }))
  }, [canvasDoc, author])
  useEffect(() => { onContentChangeRef.current = onContentChange }, [onContentChange])

  useEffect(() => {
    if (contentChangeTimerRef.current) window.clearTimeout(contentChangeTimerRef.current)
    contentChangeTimerRef.current = window.setTimeout(() => onContentChangeRef.current?.(serializedDoc), 120)
  }, [serializedDoc])

  useEffect(() => {
    if (historyRef.current.length === 0) {
      historyRef.current = [serializedDoc]
      historyIndexRef.current = 0
      setHistoryIndex(0)
    }
  }, [serializedDoc])

  useEffect(() => () => {
    if (rafDrawRef.current) window.cancelAnimationFrame(rafDrawRef.current)
    if (dragRafRef.current) window.cancelAnimationFrame(dragRafRef.current)
    if (resizeRafRef.current) window.cancelAnimationFrame(resizeRafRef.current)
    if (panRafRef.current) window.cancelAnimationFrame(panRafRef.current)
    if (viewportCommitTimerRef.current) window.clearTimeout(viewportCommitTimerRef.current)
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current)
    if (contentChangeTimerRef.current) window.clearTimeout(contentChangeTimerRef.current)
    onContentChangeRef.current?.(latestSerializedRef.current)
  }, [])

  const paintViewport = useCallback((nextPan = panRef.current, nextZoom = zoomRef.current) => {
    const world = worldRef.current
    if (!world) return
    world.style.transform = `translate3d(${nextPan.x}px, ${nextPan.y}px, 0) scale(${nextZoom})`
    world.style.setProperty('--canvas-zoom', String(nextZoom))
    const container = containerRef.current
    if (container) {
      container.style.backgroundSize = `${24 * nextZoom}px ${24 * nextZoom}px`
      container.style.backgroundPosition = `${nextPan.x}px ${nextPan.y}px`
    }
  }, [])

  useEffect(() => {
    panRef.current = pan
    zoomRef.current = zoom
    paintViewport(pan, zoom)
  }, [pan, paintViewport, zoom])

  // ─── Coordinate conversion ─────────────────────────────────────────────────

  const toWorld = useCallback((clientX: number, clientY: number): Point => {
    if (!containerRef.current) return { x: 0, y: 0 }
    const rect = containerRef.current.getBoundingClientRect()
    const currentPan = panRef.current
    const currentZoom = zoomRef.current
    return { x: (clientX - rect.left - currentPan.x) / currentZoom, y: (clientY - rect.top - currentPan.y) / currentZoom }
  }, [])

  // ─── History ───────────────────────────────────────────────────────────────

  const pushHistory = useCallback(() => {
    if (undoRedoRef.current) return
    const state = latestSerializedRef.current
    if (historyRef.current[historyIndexRef.current] === state) return
    const h = historyRef.current.slice(0, historyIndexRef.current + 1)
    h.push(state)
    if (h.length > 60) h.shift()
    historyRef.current = h
    historyIndexRef.current = h.length - 1
    setHistoryIndex(historyIndexRef.current)
  }, [])

  useEffect(() => {
    if (isInteractingRef.current || undoRedoRef.current || serializedDoc === lastSerializedRef.current) return
    if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current)
    historyTimerRef.current = window.setTimeout(pushHistory, 500)
    return () => { if (historyTimerRef.current) window.clearTimeout(historyTimerRef.current) }
  }, [pushHistory, serializedDoc])

  const undo = useCallback(() => {
    if (historyIndexRef.current <= 0) return
    undoRedoRef.current = true
    historyIndexRef.current -= 1
    setHistoryIndex(historyIndexRef.current)
    const state = historyRef.current[historyIndexRef.current]
    const doc = parseCanvasDoc(state)
    setCanvasDoc(doc)
    lastSerializedRef.current = state
    latestSerializedRef.current = state
    undoRedoRef.current = false
    void pushRemoteCanvasRef.current(state)
  }, [])

  const redo = useCallback(() => {
    if (historyIndexRef.current >= historyRef.current.length - 1) return
    undoRedoRef.current = true
    historyIndexRef.current += 1
    setHistoryIndex(historyIndexRef.current)
    const state = historyRef.current[historyIndexRef.current]
    const doc = parseCanvasDoc(state)
    setCanvasDoc(doc)
    lastSerializedRef.current = state
    latestSerializedRef.current = state
    undoRedoRef.current = false
    void pushRemoteCanvasRef.current(state)
  }, [])

  // ─── Viewport ─────────────────────────────────────────────────────────────

  const applyZoom = useCallback((factor: number, originX?: number, originY?: number) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const ox = originX ?? rect.width / 2
    const oy = originY ?? rect.height / 2
    const prevZoom = zoomRef.current
    const prevPan = panRef.current
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prevZoom * factor))
    const wx = (ox - prevPan.x) / prevZoom
    const wy = (oy - prevPan.y) / prevZoom
    const nextPan = { x: ox - wx * nextZoom, y: oy - wy * nextZoom }
    zoomRef.current = nextZoom
    panRef.current = nextPan
    paintViewport(nextPan, nextZoom)
    if (viewportCommitTimerRef.current) window.clearTimeout(viewportCommitTimerRef.current)
    viewportCommitTimerRef.current = window.setTimeout(() => {
      setZoom(zoomRef.current)
      setPan(panRef.current)
    }, 80)
  }, [paintViewport])

  const zoomIn = useCallback(() => applyZoom(1.2), [applyZoom])
  const zoomOut = useCallback(() => applyZoom(1 / 1.2), [applyZoom])

  const fitToScreen = useCallback(() => {
    if (!containerRef.current) return
    if (positionedItems.length === 0) {
      setPan({ x: 220, y: 140 }); setZoom(1); return
    }
    const minX = Math.min(...positionedItems.map((i) => i.x)) - 80
    const minY = Math.min(...positionedItems.map((i) => i.y)) - 80
    const maxX = Math.max(...positionedItems.map((i) => i.x + i.w)) + 80
    const maxY = Math.max(...positionedItems.map((i) => i.y + i.h)) + 80
    const rect = containerRef.current.getBoundingClientRect()
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY)) * 0.9))
    setZoom(newZoom)
    setPan({ x: (rect.width - (maxX - minX) * newZoom) / 2 - minX * newZoom, y: (rect.height - (maxY - minY) * newZoom) / 2 - minY * newZoom })
  }, [positionedItems])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => setViewSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const minimapItems = useMemo<MinimapItem[]>(() => canvasDoc.items.flatMap((item): MinimapItem[] => {
    const kind: MinimapItem['kind'] = item.ai ? 'ai' : item.type === 'frame' ? 'frame' : item.type === 'image' ? 'image' : item.type === 'plot' ? 'plot' : 'item'
    return isPositioned(item) ? [{ id: item.id, x: item.x, y: item.y, w: item.w, h: item.h, kind, selected: selectedIdSet.has(item.id) }] : []
  }), [canvasDoc.items, selectedIdSet])

  const graphSelectedFormula = useCallback((formula: Extract<CanvasItem, { type: 'formula' }>) => {
    const made = graphFromFormula(parseCanvasDoc(latestSerializedRef.current), formula)
    if (!made) return
    setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, ...made] }))
    setEditingId(null)
    setSelectedId(made[0].id); setSelectedIds([made[0].id])
    window.setTimeout(() => focusItemsRef.current([formula.id, made[0].id]), 50)
  }, [])

  // ─── AI handle ────────────────────────────────────────────────────────────

  const focusItems = useCallback((ids: string[]) => {
    const container = containerRef.current
    const targets = canvasDoc.items.filter((item) => ids.includes(item.id) && isPositioned(item))
    if (!container || targets.length === 0) return
    const boxes = targets as Array<Exclude<CanvasItem, { type: 'connector' }>>
    const minX = Math.min(...boxes.map((i) => i.x)) - 60, minY = Math.min(...boxes.map((i) => i.y)) - 60
    const maxX = Math.max(...boxes.map((i) => i.x + i.w)) + 60, maxY = Math.max(...boxes.map((i) => i.y + i.h)) + 60
    const rect = container.getBoundingClientRect()
    const nextZoom = Math.max(MIN_ZOOM, Math.min(1.2, Math.min(rect.width / (maxX - minX), rect.height / (maxY - minY))))
    setZoom(nextZoom)
    setPan({ x: (rect.width - (maxX - minX) * nextZoom) / 2 - minX * nextZoom, y: (rect.height - (maxY - minY) * nextZoom) / 2 - minY * nextZoom })
    setSelectedIds(ids); setSelectedId(ids[0] ?? null)
  }, [canvasDoc.items])

  const insertTutorialRef = useRef<() => void>(() => {})
  const focusItemsRef = useRef<(ids: string[]) => void>(() => {})
  focusItemsRef.current = focusItems
  insertTutorialRef.current = () => {
    const current = parseCanvasDoc(latestSerializedRef.current)
    const spot = findFreeRect(current, null, TUTORIAL_SIZE.w, TUTORIAL_SIZE.h, 160)
    const added = buildTutorial(spot)
    const next = { ...current, items: [...current.items, ...added] }
    latestSerializedRef.current = JSON.stringify(next)
    setCanvasDoc(next)
    window.setTimeout(() => focusItemsRef.current([added[0].id]), 120)
  }

  useImperativeHandle(handleRef, () => ({
    getDoc: () => parseCanvasDoc(latestSerializedRef.current),
    focusItems,
    insertTutorial: () => insertTutorialRef.current(),
    applyOps: (ops: AiOp[]) => {
      const current = parseCanvasDoc(latestSerializedRef.current)
      const result = applyAiOps(current, ops)
      latestSerializedRef.current = JSON.stringify(result.doc)
      setCanvasDoc(result.doc)
      return { created: result.created, idMap: result.idMap }
    },
    snapshot: async () => {
      const doc = parseCanvasDoc(latestSerializedRef.current)
      const { items, toAlias, fromAlias } = describeDoc(doc)
      const [overview, sent] = await Promise.all([renderDocToPng(doc, toAlias), collectImages(doc, selectedIds, toAlias)])
      return { overview, images: sent.map((i) => i.src), imagesMeta: sent.map((i) => i.meta), items, selected: selectedIds.map((id) => toAlias[id]).filter(Boolean), doc, fromAlias }
    },
  }), [focusItems, selectedIds])

  // ─── Remote canvas ────────────────────────────────────────────────────────

  const fetchRemoteCanvas = useCallback(async () => {
    if (!sessionId || isInteractingRef.current) return
    try {
      const res = await apiByRole[role].getCanvas(sessionId, collaborationNameRef.current)
      const remote = parseCanvasDoc(res.data?.content_json)
      const remoteVersion = Number(res.data?.version || 0)
      const hydrationKey = `${sessionId}:${collaborationKey}`
      const firstHydration = hydratedSessionRef.current !== hydrationKey
      const local = parseCanvasDoc(latestSerializedRef.current)
      if (!firstHydration && remoteVersion < versionRef.current) return
      hydratedSessionRef.current = hydrationKey
      versionRef.current = remoteVersion
      setVersion(remoteVersion)
      if (res.data?.students_can_write !== undefined) setStudentsCanWrite(Boolean(res.data.students_can_write))

      // A newly shared document can reach the student before its session-canvas
      // row is created. Never replace that visible document with the API's
      // version-0 empty placeholder.
      if (firstHydration && remoteVersion === 0 && remote.items.length === 0 && local.items.length > 0) return

      const hasUnsavedLocalChanges = !firstHydration
        && Boolean(latestSerializedRef.current)
        && latestSerializedRef.current !== lastSerializedRef.current
      const next = hasUnsavedLocalChanges
        ? mergeCanvasDocs(parseCanvasDoc(lastSerializedRef.current), local, remote)
        : remote
      const nextSerialized = JSON.stringify(next)
      markSeen(remote)
      if (nextSerialized !== lastSerializedRef.current) {
        setCanvasDoc(next)
        latestSerializedRef.current = nextSerialized
        lastSerializedRef.current = hasUnsavedLocalChanges ? JSON.stringify(remote) : nextSerialized
        if (firstHydration || historyRef.current.length === 0) {
          historyRef.current = [nextSerialized]
          historyIndexRef.current = 0
          setHistoryIndex(0)
        }
      }
      if (firstHydration) window.setTimeout(() => onHydratedRef.current?.(), 60)
    } catch { /* silent */ }
  }, [collaborationKey, role, sessionId])

  const pushRemoteCanvas = useCallback(async (nextSerialized: string) => {
    if (!sessionId || !canEdit) return
    const save = async () => {
      if (nextSerialized === lastSerializedRef.current) return
      const baseSerialized = lastSerializedRef.current
      try {
        const baseVersion = versionRef.current
        const res = await apiByRole[role].updateCanvas(sessionId, collaborationNameRef.current, { title, content_json: nextSerialized, base_version: baseVersion })
        const responseKey = String(res.data?.canvas_key || '')
        if (responseKey && responseKey !== collaborationKey) {
          collaborationNameRef.current = responseKey
          setCollaborationKey(responseKey)
        }
        const nextVersion = Number(res.data?.version || baseVersion + 1)
        versionRef.current = nextVersion
        setVersion(nextVersion)
        lastSerializedRef.current = nextSerialized
      } catch (error: any) {
        if (error?.response?.status === 409) {
          try {
            const current = await apiByRole[role].getCanvas(sessionId, collaborationNameRef.current)
            const remoteVersion = Number(current.data?.version || 0)
            const theirs = parseCanvasDoc(current.data?.content_json)
            markSeen(theirs)
            const merged = mergeCanvasDocs(parseCanvasDoc(baseSerialized), parseCanvasDoc(nextSerialized), theirs)
            const mergedSerialized = JSON.stringify(merged)
            const retry = await apiByRole[role].updateCanvas(sessionId, collaborationNameRef.current, { title, content_json: mergedSerialized, base_version: remoteVersion })
            const mergedVersion = Number(retry.data?.version || remoteVersion + 1)
            versionRef.current = mergedVersion
            setVersion(mergedVersion)
            lastSerializedRef.current = mergedSerialized
            // Do not roll back edits made while this request was in flight.
            if (latestSerializedRef.current === nextSerialized) {
              setCanvasDoc(merged)
              latestSerializedRef.current = mergedSerialized
            }
            return
          } catch (retryError) {
            console.error('Canvas merge failed', retryError)
            await fetchRemoteCanvas()
            return
          }
        }
        console.error('Canvas update failed', error)
      }
    }
    const queued = saveQueueRef.current.then(save, save)
    saveQueueRef.current = queued
    await queued
  }, [canEdit, collaborationKey, fetchRemoteCanvas, role, sessionId, title])
  pushRemoteCanvasRef.current = pushRemoteCanvas

  // Teacher only: toggle student write permission
  const toggleStudentsCanWrite = useCallback(async () => {
    if (role !== 'teacher' || !sessionId) return
    const next = !studentsCanWrite
    setStudentsCanWrite(next)
    try {
      const res = await teacherApi.updateCanvas(sessionId, collaborationNameRef.current, {
        title,
        content_json: latestSerializedRef.current || JSON.stringify(EMPTY_CANVAS),
        students_can_write: next,
      })
      if (res.data?.version !== undefined) setVersion(Number(res.data.version))
      lastSerializedRef.current = latestSerializedRef.current
    } catch {
      setStudentsCanWrite(!next) // revert on error
    }
  }, [role, sessionId, studentsCanWrite, title])

  // ─── Effects ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const parsed = parseCanvasDoc(initialContent)
    const serialized = JSON.stringify(parsed)
    markSeen(parsed)
    if (serialized !== serializedDoc) {
      setCanvasDoc(parsed)
      lastSerializedRef.current = serialized
      historyRef.current = [serialized]
      historyIndexRef.current = 0
      setHistoryIndex(0)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialContent])

  useEffect(() => {
    if (!sessionId) return
    void fetchRemoteCanvas()
  }, [fetchRemoteCanvas, sessionId])

  useEffect(() => {
    if (!sessionId) return
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current)
    if (!socketConnected) {
      pollTimerRef.current = window.setInterval(() => {
        if (!isInteractingRef.current) void fetchRemoteCanvas()
      }, 5000)
    }
    return () => { if (pollTimerRef.current) window.clearInterval(pollTimerRef.current) }
  }, [fetchRemoteCanvas, sessionId, socketConnected])

  // Other hooks (re)create the shared socket; follow it rather than reading it once.
  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = (window as any).socket || null
      setLiveSocket((prev: any) => (prev === current ? prev : current))
    }, 1500)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => { onPermissionChangeRef.current?.(studentsCanWrite) }, [studentsCanWrite])
  // A private board has nothing to load: it is ready as soon as it is mounted.
  useEffect(() => { if (!sessionId) { const timer = window.setTimeout(() => onHydratedRef.current?.(), 80); return () => window.clearTimeout(timer) } }, [sessionId])

  useEffect(() => {
    const socket = liveSocket
    if (!socket) return
    const onConnect = () => setSocketConnected(true)
    const onDisconnect = () => setSocketConnected(false)
    setSocketConnected(Boolean(socket.connected))
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    return () => { socket.off('connect', onConnect); socket.off('disconnect', onDisconnect) }
  }, [liveSocket])

  // Keep versionRef in sync so socket handler doesn't need version in its deps
  useEffect(() => { versionRef.current = version }, [version])

  useEffect(() => {
    const socket = liveSocket
    if (!socket || !sessionId) return
    const onCanvasUpdated = (payload: any) => {
      if (payload?.session_id !== sessionId || payload?.canvas_key !== collaborationKey) return
      // Process students_can_write unconditionally — must not be gated by version check
      if (payload?.students_can_write !== undefined) setStudentsCanWrite(Boolean(payload.students_can_write))
      const incomingVersion = Number(payload?.version || 0)
      if (incomingVersion <= versionRef.current) return
      if (isInteractingRef.current) { remoteWhileInteractingRef.current = String(payload?.content_json || ''); return }
      const remote = parseCanvasDoc(payload?.content_json)
      markSeen(remote)
      const remoteSerialized = JSON.stringify(remote)
      versionRef.current = incomingVersion
      setVersion(incomingVersion)
      if (remoteSerialized !== lastSerializedRef.current) {
        setCanvasDoc(remote)
        lastSerializedRef.current = remoteSerialized
        // Transient collaboration transforms are painted directly on the DOM
        // for smooth dragging. Never clear width/height here: they are also
        // React-owned inline styles, and removing them after React's commit
        // collapses every remote item until another render happens.
        const remoteItemsById = new Map(remote.items.filter(isPositioned).map((item) => [item.id, item]))
        window.requestAnimationFrame(() => Object.entries(itemRefs.current).forEach(([itemId, element]) => {
          if (!element) return
          const item = remoteItemsById.get(itemId)
          if (!item) return
          element.style.transform = ''
          element.style.width = `${item.w}px`
          element.style.height = `${item.h}px`
          element.dataset.canvasX = String(item.x)
          element.dataset.canvasY = String(item.y)
        }))
      }
    }
    const onItemLock = (payload: any) => {
      if (payload?.session_id !== sessionId || payload?.canvas_key !== collaborationKey) return
      const itemId = String(payload?.item_id || ''), userId = String(payload?.user_id || ''), userType = String(payload?.user_type || '')
      if (!itemId || !userId) return
      lockTimestampsRef.current[itemId] = Date.now()
      setLocks((prev) => ({ ...prev, [itemId]: { userId, userType } }))
    }
    const onItemUnlock = (payload: any) => {
      if (payload?.session_id !== sessionId || payload?.canvas_key !== collaborationKey) return
      const itemId = String(payload?.item_id || '')
      if (!itemId) return
      delete lockTimestampsRef.current[itemId]
      setLocks((prev) => { const next = { ...prev }; delete next[itemId]; return next })
    }
    const onItemTransform = (payload: any) => {
      if (payload?.session_id !== sessionId || payload?.canvas_key !== collaborationKey || String(payload?.user_id || '') === currentUserId) return
      const itemId = String(payload?.item_id || '')
      const transform = payload?.transform || {}
      const element = itemRefs.current[itemId]
      if (!element) return
      const baseX = Number(element.dataset.canvasX || 0)
      const baseY = Number(element.dataset.canvasY || 0)
      if (Number.isFinite(transform.x) && Number.isFinite(transform.y)) {
        element.style.transform = `translate3d(${Number(transform.x) - baseX}px, ${Number(transform.y) - baseY}px, 0)`
      }
      if (Number.isFinite(transform.w)) element.style.width = `${Number(transform.w)}px`
      if (Number.isFinite(transform.h)) element.style.height = `${Number(transform.h)}px`
    }
    const onCanvasCursor = (payload: any) => {
      if (payload?.session_id !== sessionId || payload?.canvas_key !== collaborationKey) return
      const userId = String(payload?.user_id || '')
      if (!userId || userId === currentUserId) return
      if (payload?.active === false) {
        setRemoteCursors((prev) => { const next = { ...prev }; delete next[userId]; return next })
        return
      }
      const x = Number(payload?.x), y = Number(payload?.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      setRemoteCursors((prev) => ({
        ...prev,
        [userId]: {
          userId,
          label: String(payload?.label || (payload?.user_type === 'teacher' ? tl("Docente") : tl("Studente"))),
          color: collaboratorColor(userId),
          x,
          y,
          updatedAt: Date.now(),
        },
      }))
    }
    socket.on('canvas_updated', onCanvasUpdated)
    socket.on('canvas_item_lock', onItemLock)
    socket.on('canvas_item_unlock', onItemUnlock)
    socket.on('canvas_item_transform', onItemTransform)
    socket.on('canvas_cursor', onCanvasCursor)
    return () => { socket.off('canvas_updated', onCanvasUpdated); socket.off('canvas_item_lock', onItemLock); socket.off('canvas_item_unlock', onItemUnlock); socket.off('canvas_item_transform', onItemTransform); socket.off('canvas_cursor', onCanvasCursor) }
  }, [collaborationKey, currentUserId, liveSocket, sessionId])

  // Auto-expire stale locks (60 s) — prevents permanently stuck "In uso" state
  useEffect(() => {
    const interval = window.setInterval(() => {
      const now = Date.now()
      const expired = Object.entries(lockTimestampsRef.current)
        .filter(([, ts]) => now - ts > 60_000)
        .map(([id]) => id)
      if (expired.length > 0) {
        expired.forEach((id) => delete lockTimestampsRef.current[id])
        setLocks((prev) => {
          const next = { ...prev }
          expired.forEach((id) => delete next[id])
          return next
        })
      }
      setRemoteCursors((prev) => {
        const active = Object.fromEntries(Object.entries(prev).filter(([, cursor]) => now - cursor.updatedAt < 12_000))
        return Object.keys(active).length === Object.keys(prev).length ? prev : active
      })
    }, 15_000)
    return () => window.clearInterval(interval)
  }, [])

  // Clear all locks on socket reconnect (prevents stale locks after disconnect)
  useEffect(() => {
    const socket = (window as any).socket
    if (!socket) return
    const onReconnect = () => {
      lockTimestampsRef.current = {}
      setLocks({})
    }
    socket.on('connect', onReconnect)
    return () => socket.off('connect', onReconnect)
  }, [])

  // Auto-save with debounce
  useEffect(() => {
    if (!canEdit) return
    if (serializedDoc === lastSerializedRef.current) return
    if (isInteractingRef.current || undoRedoRef.current) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => { void pushRemoteCanvas(serializedDoc) }, 300)
    return () => { if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current) }
  }, [serializedDoc, canEdit, pushRemoteCanvas])

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isTyping = target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable
      if (e.key === ' ' && !isTyping) { e.preventDefault(); spaceHeldRef.current = true }
      if (isTyping) return
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return }
      if (tool === 'move' && canEdit && selectedIds.length && e.key.startsWith('Arrow')) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        const moving = new Set(selectedIds)
        selectedIds.forEach((id) => { const it = itemById.get(id); if (it && isFrame(it)) collectFrameDescendants(canvasDoc.items, id).forEach((child) => moving.add(child)) })
        setCanvasDoc((prev) => ({ ...prev, items: prev.items.map((i) => (moving.has(i.id) && isPositioned(i) ? { ...i, x: i.x + dx, y: i.y + dy } : i)) }))
        return
      }
      const selected = selectedId ? itemById.get(selectedId) : null
      const startsTextEditing = canEdit && tool === 'select' && selected && isTextEditable(selected)
        && (e.key === 'Enter' || (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1))
      if (startsTextEditing) {
        e.preventDefault()
        startTextEditingRef.current(selected.id, e.key.length === 1 ? e.key : '')
        return
      }
      if (e.key === 'Escape') { setSelectedId(null); setSelectedIds([]); setEditingId(null); setTool('select'); setContextMenu(null) }
      if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) deleteSelectedRef.current()
      if (!e.ctrlKey && !e.metaKey) {
        if (e.key === 'v' || e.key === 'V') setTool('select')
        if (e.key === 'h' || e.key === 'H') setTool('hand')
        if (canEdit) {
          if (e.key === 'p' || e.key === 'P') setTool('postit')
          if (e.key === 'f' || e.key === 'F') setTool('frame')
          if (e.key === 't' || e.key === 'T') setTool('text')
          if (e.key === 'r' || e.key === 'R') setTool('roundedRect')
          if (e.key === 'g' || e.key === 'G') setTool('move')
          if (e.key === 'o' || e.key === 'O') setTool('ellipse')
          if (e.key === 'm' || e.key === 'M') setTool('formula')
          if (e.key === 'l' || e.key === 'L') setTool('line')
          if (e.key === 'a' || e.key === 'A') setTool('arrow')
          if (e.key === 'c' || e.key === 'C') setTool('connector')
          if (e.key === 'd' || e.key === 'D') setTool('pen')
        }
      }
    }
    const onKeyUp = (e: KeyboardEvent) => { if (e.key === ' ') spaceHeldRef.current = false }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
  }, [undo, redo, canEdit, itemById, selectedId, tool])

  // ─── Item lock helpers ────────────────────────────────────────────────────

  const emitLock = (itemId: string) => {
    const socket = (window as any).socket
    if (!socket || !sessionId) return
    socket.emit('canvas_item_lock', { session_id: sessionId, canvas_key: collaborationKey, item_id: itemId })
  }
  const emitUnlock = (itemId: string) => {
    const socket = (window as any).socket
    if (!socket || !sessionId) return
    socket.emit('canvas_item_unlock', { session_id: sessionId, canvas_key: collaborationKey, item_id: itemId })
  }
  const emitTransientTransforms = (updates: Array<{ itemId: string; transform: Partial<{ x: number; y: number; w: number; h: number }> }>) => {
    const now = performance.now()
    if (now - lastTransformEmitRef.current < 33) return
    lastTransformEmitRef.current = now
    const socket = (window as any).socket
    if (!socket?.connected || !sessionId) return
    updates.forEach(({ itemId, transform }) => socket.emit('canvas_item_transform', { session_id: sessionId, canvas_key: collaborationKey, item_id: itemId, transform }))
  }
  const emitTransientTransform = (itemId: string, transform: Partial<{ x: number; y: number; w: number; h: number }>) => {
    emitTransientTransforms([{ itemId, transform }])
  }
  // ─── Presence & "richiama qui" ──────────────────────────────────────────────

  useEffect(() => {
    const socket = liveSocket
    if (!socket || !sessionId) return
    // Avatars = people who have THIS board open right now (gateway "canvas_presence"), not the whole session.
    const toCollaborator = (u: any): Collaborator => ({ id: String(u.id), name: String(u.name || (u.role === 'teacher' ? 'Docente' : 'Studente')), role: u.role === 'teacher' ? 'teacher' : 'student', avatarUrl: u.avatar_url || undefined })
    const applyViewers = (list: any[]) => {
      const viewers = (list || []).map(toCollaborator).filter((u) => u.id !== currentUserId)
      setOnline(viewers)
      const ids = new Set(viewers.map((u) => u.id))
      setRemoteCursors((prev) => Object.fromEntries(Object.entries(prev).filter(([id]) => ids.has(id))))
    }
    const here = () => socket.emit('canvas_presence', { session_id: sessionId, canvas_key: collaborationKey, state: 'here' }, (response: { viewers?: any[] }) => {
      if (response?.viewers) applyViewers(response.viewers)
    })
    const join = () => { socket.emit('join_session', { session_id: sessionId }); here() }
    const onBoardPresence = (data: any) => {
      if (data?.session_id !== sessionId || data?.canvas_key !== collaborationKey) return
      applyViewers(data.viewers)
    }
    const onSummon = (payload: any) => {
      if (payload?.session_id !== sessionId || payload?.canvas_key !== collaborationKey || role === 'teacher') return
      const x = Number(payload.x), y = Number(payload.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) return
      setSummon({ x, y, label: String(payload.label || 'Docente'), at: Date.now() })
      const container = containerRef.current
      if (!container) return
      const from = { ...panRef.current }, fromZoom = zoomRef.current
      const toZoom = Math.max(fromZoom, 0.6)
      const target = { x: container.clientWidth / 2 - x * toZoom, y: container.clientHeight / 2 - y * toZoom }
      const started = performance.now()
      const step = (now: number) => {
        const t = Math.min((now - started) / 550, 1), e = 1 - (1 - t) ** 3
        const nextZoom = fromZoom + (toZoom - fromZoom) * e
        const nextPan = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e }
        zoomRef.current = nextZoom; panRef.current = nextPan
        paintViewport(nextPan, nextZoom)
        if (t < 1) window.requestAnimationFrame(step)
        else { setZoom(nextZoom); setPan(nextPan) }
      }
      window.requestAnimationFrame(step)
    }
    join()
    const refresh = window.setInterval(() => { if (socket.connected) here() }, 20000)
    socket.on('connect', join)
    socket.on('canvas_presence', onBoardPresence)
    socket.on('canvas_summon', onSummon)
    return () => {
      window.clearInterval(refresh)
      socket.emit('canvas_presence', { session_id: sessionId, canvas_key: collaborationKey, state: 'left' })
      socket.off('connect', join); socket.off('canvas_presence', onBoardPresence); socket.off('canvas_summon', onSummon)
    }
  }, [collaborationKey, currentUserId, liveSocket, paintViewport, role, sessionId])

  useEffect(() => {
    if (!summon) return
    const timer = window.setTimeout(() => setSummon(null), 4500)
    return () => window.clearTimeout(timer)
  }, [summon])

  const summonStudents = (clientX: number, clientY: number) => {
    const point = toWorld(clientX, clientY)
    const socket = liveSocket?.connected ? liveSocket : (window as any).socket
    if (!socket?.connected) { setSummonError(tl("Connessione in tempo reale assente: riprova tra qualche secondo.")); return }
    socket.emit('canvas_summon', { session_id: sessionId, canvas_key: collaborationKey, x: point.x, y: point.y }, (response: { error?: string } | undefined) => {
      if (response?.error) setSummonError(tl("Non è stato possibile richiamare gli studenti."))
    })
    setSummon({ x: point.x, y: point.y, label: tl("Docente"), at: Date.now() })
  }

  const goToCollaborator = (id: string) => {
    const cursor = remoteCursors[id]
    const container = containerRef.current
    if (!cursor || !container) return
    setPan({ x: container.clientWidth / 2 - cursor.x * zoomRef.current, y: container.clientHeight / 2 - cursor.y * zoomRef.current })
  }

  const emitCursor = (point: Point, active = true) => {
    const now = performance.now()
    if (active && now - lastCursorEmitRef.current < 50) return
    lastCursorEmitRef.current = now
    const socket = (window as any).socket
    if (!socket?.connected || !sessionId) return
    socket.emit('canvas_cursor', { session_id: sessionId, canvas_key: collaborationKey, x: point.x, y: point.y, active })
  }
  const isLockedByOther = (itemId: string) => {
    const lock = locks[itemId]
    return Boolean(lock && lock.userId && lock.userId !== currentUserId)
  }

  // ─── Interaction lifecycle ─────────────────────────────────────────────────

  const beginInteraction = () => { isInteractingRef.current = true }
  const endInteraction = () => {
    isInteractingRef.current = false
    const hadRemote = Boolean(remoteWhileInteractingRef.current)
    if (hadRemote) remoteWhileInteractingRef.current = null
    // Defer to after React flushes the latest state update into latestSerializedRef
    window.requestAnimationFrame(async () => {
      await pushRemoteCanvas(latestSerializedRef.current)
      pushHistory()
      if (hadRemote) remoteWhileInteractingRef.current = null
    })
  }

  // ─── Item creation ────────────────────────────────────────────────────────

  const DEFAULT_ITEM_SIZES: Partial<Record<Tool, [number, number]>> = {
    postit: [150, 130], frame: [360, 260], text: [280, 120], roundedRect: [220, 140], triangle: [220, 160],
    rect: [220, 140], ellipse: [200, 140], diamond: [200, 160], star: [180, 180], hexagon: [220, 150], line: [160, 0], arrow: [160, 0], formula: [380, 84],
  }

  const createItemAtBounds = (type: Tool, x: number, y: number, w: number, h: number): CanvasItem | null => {
    const id = mkId()
    if (type === 'postit') return { id, type: 'postit', x, y, w, h, text: '', color: newPostitColor, textStyle: DEFAULT_TEXT_STYLE }
    if (type === 'frame') return { id, type: 'frame', x, y, w, h, text: 'Frame', color: '#3ea9f4', backgroundColor: '#ffffff99', borderWidth: 2, borderStyle: 'dashed', textStyle: DEFAULT_TEXT_STYLE }
    if (type === 'text') return { id, type: 'text', x, y, w, h, text: 'Testo', color: '#171717', textStyle: DEFAULT_TEXT_STYLE }
    if (type === 'roundedRect') return { id, type: 'shape', shape: 'rounded-rect', x, y, w, h, fill: newShapeFill, stroke: newShapeStroke, borderWidth: 1.5, borderStyle: 'solid', text: '', textColor: '#171717', textStyle: DEFAULT_TEXT_STYLE }
    if (type === 'formula') return { id, type: 'formula', x, y, w, h, latex: '', fontSize: 28, color: '#0f172a' }
    const shapeByTool: Partial<Record<Tool, 'rect' | 'ellipse' | 'diamond' | 'star' | 'hexagon'>> = { rect: 'rect', ellipse: 'ellipse', diamond: 'diamond', star: 'star', hexagon: 'hexagon' }
    const extraShape = shapeByTool[type]
    if (extraShape) return { id, type: 'shape', shape: extraShape, x, y, w, h, fill: newShapeFill, stroke: newShapeStroke, borderWidth: 1.5, borderStyle: 'solid', text: '', textColor: '#171717', textStyle: DEFAULT_TEXT_STYLE }
    if (type === 'triangle') return { id, type: 'shape', shape: 'triangle', x, y, w, h, fill: newShapeFill, stroke: newShapeStroke, borderWidth: 1.5, borderStyle: 'solid', text: '', textColor: '#171717', textStyle: DEFAULT_TEXT_STYLE }
    return null
  }

  /** Answers to interactive cards: not blocked by someone else's text lock, merged per participant on conflicts. */
  const recordAnswer = (id: string, patch: Partial<CanvasItem>) => {
    setCanvasDoc((prev) => ({ ...prev, items: prev.items.map((item) => (item.id === id ? { ...item, ...patch } as CanvasItem : item)) }))
  }

  const updateItem = (id: string, patch: Partial<CanvasItem>) => {
    if (isLockedByOther(id)) return
    setCanvasDoc((prev) => {
      const target = prev.items.find((item) => item.id === id)
      if (!target) return prev
      const updated = { ...target, ...patch, ...(author && !('answers' in patch) ? { eb: author, et: Date.now() } : {}) } as CanvasItem
      const positionChanged = isPositioned(updated) && ('x' in patch || 'y' in patch || 'w' in patch || 'h' in patch)
      const nextItem = positionChanged ? { ...updated, parentFrameId: getParentFrameId(updated, prev.items) } as CanvasItem : updated
      return { ...prev, items: prev.items.map((item) => item.id === id ? nextItem : item) }
    })
  }

  const startTextEditing = (itemId: string, seed = '') => {
    if (!canEdit || isLockedByOther(itemId)) return
    setTool('select')
    setSelectedId(itemId)
    setSelectedIds([itemId])
    setEditingId(itemId)
    if (seed) {
      setCanvasDoc((prev) => ({
        ...prev,
        items: prev.items.map((item) => {
          if (item.id !== itemId || !isTextEditable(item)) return item
          const current = item.text === 'Testo' || item.text === 'Frame' ? '' : item.text
          return { ...item, text: `${current}${seed}` } as CanvasItem
        }),
      }))
    }
    window.requestAnimationFrame(() => {
      const editor = textEditorRefs.current[itemId]
      if (!editor) return
      editor.focus({ preventScroll: true })
      if (!seed && (editor.value === 'Testo' || editor.value === 'Frame')) editor.select()
      else {
        const end = editor.value.length
        editor.setSelectionRange(end, end)
      }
    })
  }
  startTextEditingRef.current = startTextEditing

  const deleteItems = (requestedIds: string[]) => {
    if (!canEdit || requestedIds.length === 0) return
    const deletableIds = requestedIds.filter((id) => !isLockedByOther(id))
    if (deletableIds.length === 0) return
    beginInteraction()
    setCanvasDoc((prev) => {
      const removedIds = new Set<string>()
      deletableIds.forEach((id) => {
        const selected = prev.items.find((item) => item.id === id)
        if (!selected) return
        if (isFrame(selected)) collectFrameDescendants(prev.items, selected.id).forEach((childId) => removedIds.add(childId))
        removedIds.add(selected.id)
      })
      const remaining = prev.items.filter((i) => !removedIds.has(i.id))
      return { ...prev, items: remaining.filter((i) => !isConnector(i) || (!removedIds.has((i as any).fromId) && !removedIds.has((i as any).toId))) }
    })
    deletableIds.forEach(emitUnlock)
    setSelectedId(null)
    setSelectedIds([])
    setEditingId(null)
    endInteraction()
  }

  const deleteSelected = useCallback(() => {
    deleteItems(selectedIds.length > 0 ? selectedIds : selectedId ? [selectedId] : [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, selectedIds, canEdit])

  // Keep ref in sync
  deleteSelectedRef.current = deleteSelected

  // ─── Z-order & duplicate ─────────────────────────────────────────────────

  const reorderItem = useCallback((id: string, action: 'front' | 'back' | 'forward' | 'backward') => {
    if (!canEdit) return
    beginInteraction()
    setCanvasDoc((prev) => {
      const target = prev.items.find((item) => item.id === id)
      if (!target) return prev
      const belongsToLayer = isPositioned(target)
        ? isPositioned
        : isConnector
      const layerItems = prev.items.filter(belongsToLayer)
      const idx = layerItems.findIndex((item) => item.id === id)
      if (idx === -1) return prev
      if (action === 'front' && idx < layerItems.length - 1) layerItems.push(layerItems.splice(idx, 1)[0])
      else if (action === 'back' && idx > 0) layerItems.unshift(layerItems.splice(idx, 1)[0])
      else if (action === 'forward' && idx < layerItems.length - 1) { [layerItems[idx], layerItems[idx + 1]] = [layerItems[idx + 1], layerItems[idx]] }
      else if (action === 'backward' && idx > 0) { [layerItems[idx - 1], layerItems[idx]] = [layerItems[idx], layerItems[idx - 1]] }
      else return prev
      let layerIndex = 0
      return { ...prev, items: prev.items.map((item) => belongsToLayer(item) ? layerItems[layerIndex++] : item) }
    })
    endInteraction()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit])

  const duplicateItem = useCallback((id: string) => {
    if (!canEdit) return
    beginInteraction()
    setCanvasDoc((prev) => {
      const item = prev.items.find((i) => i.id === id)
      if (!item) return prev
      const copy = { ...item, id: mkId() } as CanvasItem
      if (isPositioned(copy)) { (copy as any).x += 24; (copy as any).y += 24 }
      return { ...prev, items: [...prev.items, copy] }
    })
    endInteraction()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit])

  const forceUnlockItem = useCallback((id: string) => {
    delete lockTimestampsRef.current[id]
    setLocks((prev) => { const next = { ...prev }; delete next[id]; return next })
    const socket = (window as any).socket
    if (socket && sessionId) socket.emit('canvas_item_unlock', { session_id: sessionId, canvas_key: collaborationKey, item_id: id })
  }, [collaborationKey, sessionId])

  // ─── Templates ───────────────────────────────────────────────────────────

  const applyTemplate = (doc: CanvasDoc) => {
    beginInteraction()
    setCanvasDoc(doc)
    setSelectedId(null)
    setSelectedIds([])
    setEditingId(null)
    setShowTemplates(false)
    endInteraction()
  }

  // ─── Context menu ─────────────────────────────────────────────────────────

  const openContextMenu = (e: React.MouseEvent, itemId: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ screenX: e.clientX, screenY: e.clientY, itemId })
    if (itemId) { setSelectedId(itemId); setSelectedIds([itemId]); setEditingId(null) }
  }

  const closeContextMenu = () => setContextMenu(null)

  // ─── Mouse / touch handlers ───────────────────────────────────────────────

  const onPointerDownItem = (e: ReactPointerEvent, item: CanvasItem) => {
    e.stopPropagation()
    if (pinchRef.current) return
    if (e.button !== 0 && e.pointerType !== 'touch') return
    activePointerIdRef.current = e.pointerId

    // A frame is also a creation surface. Previously it swallowed the event,
    // forcing users to create on the empty canvas and move the item afterward.
    if (canEdit && isFrame(item) && tool !== 'select' && tool !== 'move' && tool !== 'hand' && tool !== 'connector') {
      e.preventDefault()
      containerRef.current?.setPointerCapture(e.pointerId)
      const wp = toWorld(e.clientX, e.clientY)
      if (tool === 'pen') {
        beginInteraction()
        drawingRef.current = { points: [wp] }
        setPreviewPoints([wp])
      } else {
        dragCreateRef.current = { tool, startX: wp.x, startY: wp.y, currentX: wp.x, currentY: wp.y, parentFrameId: item.id }
        setPreviewCreate({ x: wp.x, y: wp.y, w: 20, h: 20 })
      }
      return
    }

    const additiveSelection = e.shiftKey || e.ctrlKey || e.metaKey
    if (additiveSelection) {
      e.preventDefault()
      setEditingId(null)
      setSelectedIds((prev) => {
        const next = prev.includes(item.id) ? prev.filter((id) => id !== item.id) : [...prev, item.id]
        setSelectedId(next.at(-1) || null)
        return next
      })
      return
    }
    if (!selectedIdSet.has(item.id)) {
      setSelectedId(item.id)
      setSelectedIds([item.id])
    }
    const tag = (e.target as HTMLElement).tagName
    const isInteractiveTarget = tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT' || tag === 'BUTTON'
    if (isTextEditable(item) && editingId === item.id && isInteractiveTarget) return
    if (isTextEditable(item) && editingId !== item.id) { e.preventDefault(); setEditingId(null) }
    if (!canEdit || isConnector(item) || isLockedByOther(item.id)) return

    const wp = toWorld(e.clientX, e.clientY)
    const posItem = isPositioned(item) ? item : null
    pendingDragRef.current = {
      id: item.id,
      offsetX: posItem ? wp.x - posItem.x : 0,
      offsetY: posItem ? wp.y - posItem.y : 0,
      startX: e.clientX,
      startY: e.clientY,
    }
  }

  const onContainerPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (pinchRef.current) return
    activePointerIdRef.current = e.pointerId
    e.currentTarget.setPointerCapture(e.pointerId)
    if (spaceHeldRef.current || tool === 'hand' || e.button === 1 || e.pointerType === 'touch' && (tool === 'select' || tool === 'move')) {
      e.preventDefault()
      panningRef.current = { startMouseX: e.clientX, startMouseY: e.clientY, startPanX: panRef.current.x, startPanY: panRef.current.y }
      setIsPanning(true)
      return
    }
    if (!canEdit) return
    if (tool === 'select' || tool === 'move') {
      const wp = toWorld(e.clientX, e.clientY)
      marqueeRef.current = { start: wp, current: wp, additive: e.shiftKey || e.ctrlKey || e.metaKey }
      setEditingId(null)
      const marquee = marqueeElementRef.current
      if (marquee) {
        marquee.style.display = 'block'
        marquee.style.transform = `translate3d(${wp.x}px, ${wp.y}px, 0)`
        marquee.style.width = '0px'
        marquee.style.height = '0px'
      }
      return
    }
    if (tool === 'pen') {
      beginInteraction()
      const wp = toWorld(e.clientX, e.clientY)
      drawingRef.current = { points: [wp] }
      setPreviewPoints([wp])
      return
    }
    // Drag-to-create for shape/content tools
    if (tool !== 'connector') {
      const wp = toWorld(e.clientX, e.clientY)
      dragCreateRef.current = { tool, startX: wp.x, startY: wp.y, currentX: wp.x, currentY: wp.y }
      setPreviewCreate({ x: wp.x, y: wp.y, w: 20, h: 20 })
    }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    emitCursor(toWorld(e.clientX, e.clientY))
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [first, second] = Array.from(pointersRef.current.values())
      const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y))
      const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
      const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinchRef.current.startZoom * distance / pinchRef.current.startDistance))
      const rect = containerRef.current?.getBoundingClientRect()
      if (rect) {
        const localMid = { x: midpoint.x - rect.left, y: midpoint.y - rect.top }
        const nextPan = { x: localMid.x - pinchRef.current.worldX * nextZoom, y: localMid.y - pinchRef.current.worldY * nextZoom }
        zoomRef.current = nextZoom
        panRef.current = nextPan
        paintViewport(nextPan, nextZoom)
      }
      return
    }
    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return
    // Panning
    if (panningRef.current) {
      const { startMouseX, startMouseY, startPanX, startPanY } = panningRef.current
      const nextPan = { x: startPanX + (e.clientX - startMouseX), y: startPanY + (e.clientY - startMouseY) }
      panRef.current = nextPan
      if (!panRafRef.current) {
        panRafRef.current = window.requestAnimationFrame(() => {
          panRafRef.current = null
          paintViewport()
        })
      }
      return
    }

    const wp = toWorld(e.clientX, e.clientY)

    if (marqueeRef.current) {
      marqueeRef.current.current = wp
      const { start } = marqueeRef.current
      const x = Math.min(start.x, wp.x)
      const y = Math.min(start.y, wp.y)
      const width = Math.abs(wp.x - start.x)
      const height = Math.abs(wp.y - start.y)
      const marquee = marqueeElementRef.current
      if (marquee) {
        marquee.style.transform = `translate3d(${x}px, ${y}px, 0)`
        marquee.style.width = `${width}px`
        marquee.style.height = `${height}px`
      }
      return
    }

    // Connector drag preview
    if (connectorDrag) {
      if (connectorPreviewRef.current) {
        const from = itemById.get(connectorDrag.fromId)
        if (from && isPositioned(from)) {
          const p1 = getAnchorPoint(from, connectorDrag.fromAnchor)
          const d1 = anchorDirection(connectorDrag.fromAnchor)
          const curve = Math.max(36, Math.min(180, Math.hypot(wp.x - p1.x, wp.y - p1.y) * 0.35))
          const targetAnchor: Anchor = Math.abs(wp.x - p1.x) > Math.abs(wp.y - p1.y) ? (wp.x >= p1.x ? 'left' : 'right') : wp.y >= p1.y ? 'top' : 'bottom'
          const d2 = anchorDirection(targetAnchor)
          connectorPreviewRef.current.setAttribute('d', `M ${p1.x} ${p1.y} C ${p1.x + d1.x * curve} ${p1.y + d1.y * curve}, ${wp.x + d2.x * curve} ${wp.y + d2.y * curve}, ${wp.x} ${wp.y}`)
        }
      }
      connectorDrag.toPoint = wp
      return
    }

    // Pen drawing (RAF throttled)
    if (drawingRef.current && tool === 'pen' && canEdit) {
      const samples = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [e.nativeEvent]
      for (const sample of samples) {
        const point = toWorld(sample.clientX, sample.clientY)
        const previous = drawingRef.current.points[drawingRef.current.points.length - 1]
        if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) >= 1.25 / zoomRef.current) drawingRef.current.points.push(point)
      }
      if (!rafDrawRef.current) {
        rafDrawRef.current = window.requestAnimationFrame(() => {
          rafDrawRef.current = null
          const points = drawingRef.current?.points || []
          previewPathRef.current?.setAttribute('d', points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' '))
        })
      }
      return
    }

    // Drag-to-create preview (RAF throttled)
    if (dragCreateRef.current && canEdit) {
      const dc = dragCreateRef.current
      dc.currentX = wp.x
      dc.currentY = wp.y
      if (!dragRafRef.current) {
        dragRafRef.current = window.requestAnimationFrame(() => {
          dragRafRef.current = null
          const dc = dragCreateRef.current
          if (!dc) { setPreviewCreate(null); return }
          const x = Math.min(dc.startX, dc.currentX)
          const y = Math.min(dc.startY, dc.currentY)
          const w = Math.abs(dc.currentX - dc.startX)
          const h = Math.abs(dc.currentY - dc.startY)
          const preview = createPreviewRef.current
          if (preview && (w > 6 || h > 6)) {
            preview.style.transform = `translate3d(${x}px, ${y}px, 0)`
            preview.style.width = `${Math.max(w, 20)}px`
            preview.style.height = `${Math.max(h, 20)}px`
          }
        })
      }
      return
    }

    // Promote pendingDrag → active drag once threshold crossed
    if (!draggingRef.current && pendingDragRef.current && canEdit) {
      const candidate = pendingDragRef.current
      const moved = Math.hypot(e.clientX - candidate.startX, e.clientY - candidate.startY)
      if (moved > 2) {
        beginInteraction()
        const target = itemById.get(candidate.id)
        if (!target || !isPositioned(target)) { pendingDragRef.current = null; return }
        containerRef.current?.setPointerCapture(e.pointerId)
        const selectedRoots = selectedIdSet.has(candidate.id) ? selectedIds : [candidate.id]
        const movingIds = new Set<string>()
        selectedRoots.filter((id) => !isLockedByOther(id)).forEach((id) => {
          movingIds.add(id)
          const selected = itemById.get(id)
          if (selected && isFrame(selected)) collectFrameDescendants(canvasDoc.items, id).forEach((childId) => movingIds.add(childId))
        })
        const origins: Record<string, Point> = {}
        movingIds.forEach((id) => {
          const movingItem = itemById.get(id)
          if (movingItem && isPositioned(movingItem)) origins[id] = { x: movingItem.x, y: movingItem.y }
        })
        const childIds = Object.keys(origins).filter((id) => id !== candidate.id)
        Object.keys(origins).forEach(emitLock)
        draggingRef.current = { id: candidate.id, offsetX: candidate.offsetX, offsetY: candidate.offsetY, originX: target.x, originY: target.y, childIds, origins }
        pendingDragRef.current = null
      }
    }

    // Resize (RAF throttled) — store pending size in ref, apply in RAF
    if (resizingRef.current && canEdit) {
      const resize = resizingRef.current
      const resizingType = itemById.get(resize.id)?.type
      const isLine = resizingType === 'line' || resizingType === 'path'
      resize.pendingW = Math.max(isLine ? 4 : 80, resize.startW + (e.clientX - resize.startX) / zoomRef.current)
      resize.pendingH = Math.max(isLine ? 2 : 60, resize.startH + (e.clientY - resize.startY) / zoomRef.current)
      if (!resizeRafRef.current) {
        resizeRafRef.current = window.requestAnimationFrame(() => {
          resizeRafRef.current = null
          const r = resizingRef.current
          if (!r || r.pendingW === undefined) return
          const element = itemRefs.current[r.id]
          if (element) {
            element.style.width = `${r.pendingW}px`
            element.style.height = `${r.pendingH}px`
          }
          emitTransientTransform(r.id, { w: r.pendingW, h: r.pendingH })
        })
      }
      return
    }

    // Drag (RAF throttled) — store pending position in ref, apply in RAF
    if (draggingRef.current && canEdit) {
      const drag = draggingRef.current
      drag.pendingX = wp.x
      drag.pendingY = wp.y
      if (!dragRafRef.current) {
        dragRafRef.current = window.requestAnimationFrame(() => {
          dragRafRef.current = null
          const drag = draggingRef.current
          if (!drag || drag.pendingX === undefined || drag.pendingY === undefined) return
          const nx = drag.pendingX - drag.offsetX
          const ny = drag.pendingY - drag.offsetY
          const dx = nx - drag.originX
          const dy = ny - drag.originY
          ;[drag.id, ...drag.childIds].forEach((id) => {
            const element = itemRefs.current[id]
            if (element) element.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
          })
          emitTransientTransforms(Object.entries(drag.origins).map(([itemId, origin]) => ({
            itemId,
            transform: { x: origin.x + dx, y: origin.y + dy },
          })))
        })
      }
    }
  }

  const onPointerUp = (e?: ReactPointerEvent<HTMLDivElement>) => {
    if (e) pointersRef.current.delete(e.pointerId)
    if (pinchRef.current) {
      if (pointersRef.current.size < 2) {
        pinchRef.current = null
        activePointerIdRef.current = null
        setZoom(zoomRef.current)
        setPan(panRef.current)
        if (remoteWhileInteractingRef.current) {
          remoteWhileInteractingRef.current = null
          void fetchRemoteCanvas()
        }
      }
      if (e && e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      return
    }
    if (e && activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return
    if (e && e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    activePointerIdRef.current = null
    // Cancel any pending RAF updates
    if (dragRafRef.current) { window.cancelAnimationFrame(dragRafRef.current); dragRafRef.current = null }
    if (resizeRafRef.current) { window.cancelAnimationFrame(resizeRafRef.current); resizeRafRef.current = null }

    if (panningRef.current) {
      panningRef.current = null
      if (panRafRef.current) { window.cancelAnimationFrame(panRafRef.current); panRafRef.current = null; paintViewport() }
      setPan(panRef.current)
      setIsPanning(false)
      return
    }

    if (marqueeRef.current) {
      const { start, current, additive } = marqueeRef.current
      marqueeRef.current = null
      if (marqueeElementRef.current) marqueeElementRef.current.style.display = 'none'
      const left = Math.min(start.x, current.x)
      const right = Math.max(start.x, current.x)
      const top = Math.min(start.y, current.y)
      const bottom = Math.max(start.y, current.y)
      const isDragSelection = Math.hypot(right - left, bottom - top) * zoomRef.current > 3
      const hits = isDragSelection
        ? positionedItems.filter((item) => item.x < right && item.x + item.w > left && item.y < bottom && item.y + item.h > top).map((item) => item.id)
        : []
      const next = additive ? Array.from(new Set([...selectedIds, ...hits])) : hits
      setSelectedIds(next)
      setSelectedId(next.at(-1) || null)
      setEditingId(null)
      return
    }

    if (connectorDrag) {
      let target = connectorDrag.hoverTarget
      if (!target && e) {
        const releasePoint = toWorld(e.clientX, e.clientY)
        let nearest: { id: string; anchor: Anchor; distance: number } | null = null
        for (const item of positionedItems) {
          if (item.id === connectorDrag.fromId) continue
          for (const anchor of ANCHORS) {
            const point = getAnchorPoint(item, anchor)
            const distance = Math.hypot(point.x - releasePoint.x, point.y - releasePoint.y)
            if (distance <= 32 / zoomRef.current && (!nearest || distance < nearest.distance)) nearest = { id: item.id, anchor, distance }
          }
        }
        const nearestTarget = nearest as { id: string; anchor: Anchor; distance: number } | null
        if (nearestTarget) target = { id: nearestTarget.id, anchor: nearestTarget.anchor }
      }
      if (target && target.id !== connectorDrag.fromId) {
        beginInteraction()
        const connector: CanvasItem = {
          id: mkId(), type: 'connector',
          fromId: connectorDrag.fromId, fromAnchor: connectorDrag.fromAnchor,
          toId: target.id, toAnchor: target.anchor,
          color: '#404040', width: 2,
        }
        setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, connector] }))
        setSelectedId(connector.id)
        setSelectedIds([connector.id])
        endInteraction()
      }
      setConnectorDrag(null)
      pendingDragRef.current = null
      return
    }

    // Finalize drag-to-create
    if (dragCreateRef.current && canEdit) {
      const dc = dragCreateRef.current
      dragCreateRef.current = null
      setPreviewCreate(null)
      const dragW = Math.abs(dc.currentX - dc.startX)
      const dragH = Math.abs(dc.currentY - dc.startY)
      const MIN_DRAG = 15
      const [dw, dh] = DEFAULT_ITEM_SIZES[dc.tool] ?? [220, 160]
      let itemX: number, itemY: number, itemW: number, itemH: number
      if (dc.tool === 'line' || dc.tool === 'arrow') {
        const flipX = dc.currentX < dc.startX, flipY = dc.currentY < dc.startY
        const long = dragW > MIN_DRAG || dragH > MIN_DRAG
        const line: CanvasItem = { id: mkId(), type: 'line', x: long ? Math.min(dc.startX, dc.currentX) : dc.startX, y: long ? Math.min(dc.startY, dc.currentY) : dc.startY, w: long ? Math.max(dragW, 1) : dw, h: long ? Math.max(dragH, 1) : 1, flipX: long && flipX, flipY: long && flipY, arrow: dc.tool === 'arrow', color: newShapeStroke, width: 3 }
        beginInteraction()
        setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, line] }))
        setSelectedId(line.id); setSelectedIds([line.id]); setEditingId(null); setTool('select')
        endInteraction()
        return
      }
      if (dragW > MIN_DRAG || dragH > MIN_DRAG) {
        itemX = Math.min(dc.startX, dc.currentX)
        itemY = Math.min(dc.startY, dc.currentY)
        itemW = Math.max(dragW, 80)
        itemH = Math.max(dragH, 60)
      } else {
        itemX = dc.startX - dw / 2
        itemY = dc.startY - dh / 2
        itemW = dw; itemH = dh
      }
      const item = createItemAtBounds(dc.tool, itemX, itemY, itemW, itemH)
      if (item) {
        const requestedParent = dc.parentFrameId ? itemById.get(dc.parentFrameId) : null
        if (requestedParent && isFrame(requestedParent) && isPositioned(item)) {
          const padding = 12
          item.w = Math.min(item.w, Math.max(40, requestedParent.w - padding * 2))
          item.h = Math.min(item.h, Math.max(40, requestedParent.h - padding * 2))
          item.x = Math.max(requestedParent.x + padding, Math.min(item.x, requestedParent.x + requestedParent.w - item.w - padding))
          item.y = Math.max(requestedParent.y + padding, Math.min(item.y, requestedParent.y + requestedParent.h - item.h - padding))
        }
        beginInteraction()
        setCanvasDoc((prev) => {
          const parentFrameId = dc.parentFrameId || getParentFrameId(item, prev.items)
          return { ...prev, items: [...prev.items, { ...item, parentFrameId }] }
        })
        setSelectedId(item.id)
        setSelectedIds([item.id])
        if (isTextEditable(item)) startTextEditingRef.current(item.id)
        else setEditingId(item.type === 'formula' ? item.id : null)
        setTool('select')
        endInteraction()
      }
      return
    }

    const completedDrag = draggingRef.current
    const completedResize = resizingRef.current
    const dragId = completedDrag?.id
    const resizedId = completedResize?.id
    const clickedItemId = pendingDragRef.current?.id ?? null
    draggingRef.current = null
    resizingRef.current = null
    pendingDragRef.current = null

    let didMutate = false
    if (drawingRef.current && canEdit && drawingRef.current.points.length > 1) {
      didMutate = true
      const absolute = simplifyPoints(drawingRef.current.points, 1.5 / zoomRef.current)
      const path: CanvasItem = makePath(mkId(), absolute, strokeColor, strokeWidth)
      setCanvasDoc((prev) => {
        const parentFrame = prev.items.filter(isFrame).find((frame) => absolute.length > 0 && absolute.every((p) => p.x >= frame.x && p.x <= frame.x + frame.w && p.y >= frame.y && p.y <= frame.y + frame.h))
        return { ...prev, items: [...prev.items, parentFrame ? { ...path, parentFrameId: parentFrame.id } : path] }
      })
    }
    drawingRef.current = null
    setPreviewPoints([])
    if (rafDrawRef.current) { window.cancelAnimationFrame(rafDrawRef.current); rafDrawRef.current = null }

    // After drag ends, recompute parentFrameId with final positions
    if (dragId && completedDrag?.pendingX !== undefined && completedDrag.pendingY !== undefined) {
      ;[dragId, ...completedDrag.childIds].forEach(emitUnlock)
      didMutate = true
      const nx = completedDrag.pendingX - completedDrag.offsetX
      const ny = completedDrag.pendingY - completedDrag.offsetY
      const dx = nx - completedDrag.originX
      const dy = ny - completedDrag.originY
      const movedIds = new Set(Object.keys(completedDrag.origins))
      setCanvasDoc((prev) => {
        const moved = prev.items.map((item) => {
          const origin = completedDrag.origins[item.id]
          return origin && isPositioned(item) ? { ...item, x: origin.x + dx, y: origin.y + dy } as CanvasItem : item
        })
        return { ...prev, items: moved.map((item) => {
          if (!isPositioned(item)) return item
          if (!movedIds.has(item.id)) return item
          return { ...item, parentFrameId: getParentFrameId(item, moved, isFrame(item) ? item.id : undefined) } as CanvasItem
        }) }
      })
      window.requestAnimationFrame(() => [dragId, ...completedDrag.childIds].forEach((id) => { const element = itemRefs.current[id]; if (element) element.style.transform = '' }))
    }
    if (resizedId && resizedId !== dragId && completedResize?.pendingW !== undefined && completedResize.pendingH !== undefined) {
      emitUnlock(resizedId)
      didMutate = true
      setCanvasDoc((prev) => ({ ...prev, items: prev.items.map((item) => item.id === resizedId && isPositioned(item) ? { ...item, w: completedResize.pendingW!, h: completedResize.pendingH! } as CanvasItem : item) }))
    }
    if (didMutate) endInteraction()
    if (clickedItemId) {
      const clickedItem = itemById.get(clickedItemId)
      if (clickedItem && isTextEditable(clickedItem)) startTextEditingRef.current(clickedItemId)
      else setEditingId(null)
    }
  }

  const onPointerDownCapture = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointersRef.current.size !== 2) return
    containerRef.current?.setPointerCapture(e.pointerId)
    const [first, second] = Array.from(pointersRef.current.values())
    const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 }
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    if (draggingRef.current) {
      emitUnlock(draggingRef.current.id)
      ;[draggingRef.current.id, ...draggingRef.current.childIds].forEach((id) => { const element = itemRefs.current[id]; if (element) element.style.transform = '' })
    }
    if (resizingRef.current) {
      emitUnlock(resizingRef.current.id)
      const element = itemRefs.current[resizingRef.current.id]
      if (element) { element.style.width = `${resizingRef.current.startW}px`; element.style.height = `${resizingRef.current.startH}px` }
    }
    draggingRef.current = null
    pendingDragRef.current = null
    resizingRef.current = null
    panningRef.current = null
    drawingRef.current = null
    dragCreateRef.current = null
    marqueeRef.current = null
    if (marqueeElementRef.current) marqueeElementRef.current.style.display = 'none'
    setPreviewPoints([])
    setPreviewCreate(null)
    setIsPanning(false)
    isInteractingRef.current = false

    const localMid = { x: midpoint.x - rect.left, y: midpoint.y - rect.top }
    pinchRef.current = {
      startDistance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
      worldX: (localMid.x - panRef.current.x) / zoomRef.current,
      worldY: (localMid.y - panRef.current.y) / zoomRef.current,
      startZoom: zoomRef.current,
    }
    activePointerIdRef.current = null
  }

  // Native (non-passive) wheel listener — React 17+ registers wheel as passive by default,
  // which silently swallows preventDefault() and causes a render loop on every scroll event.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onNativeWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        applyZoom(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - rect.left, e.clientY - rect.top)
      } else {
        const nextPan = { x: panRef.current.x - e.deltaX, y: panRef.current.y - e.deltaY }
        panRef.current = nextPan
        paintViewport(nextPan, zoomRef.current)
        if (viewportCommitTimerRef.current) window.clearTimeout(viewportCommitTimerRef.current)
        viewportCommitTimerRef.current = window.setTimeout(() => setPan(panRef.current), 80)
      }
    }
    el.addEventListener('wheel', onNativeWheel, { passive: false })
    return () => el.removeEventListener('wheel', onNativeWheel)
  }, [applyZoom, paintViewport])

  // Pasting an image (screenshot, copied picture) drops it at the centre of the view.
  const pasteImagesRef = useRef<(files: File[]) => void>(() => {})
  pasteImagesRef.current = (files) => {
    if (!canEdit) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const centre = toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2)
    void (async () => {
      let offset = 0
      for (const file of files) {
        try {
          const src = await uploadImage(file)
          const natural = await new Promise<{ w: number; h: number }>((resolve) => {
            const probe = new Image(); probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight }); probe.onerror = () => resolve({ w: 4, h: 3 }); probe.src = src
          })
          const w = Math.min(520, natural.w), h = Math.max(40, Math.round(w * natural.h / Math.max(natural.w, 1)))
          const img: CanvasItem = { id: mkId(), type: 'image', x: centre.x - w / 2 + offset, y: centre.y - h / 2 + offset, w, h, src }
          setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, { ...img, parentFrameId: getParentFrameId(img, prev.items) }] }))
          setSelectedId(img.id); setSelectedIds([img.id])
          offset += 30
        } catch (err) { console.error(err) }
      }
    })()
  }
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.closest('input, textarea, [contenteditable="true"]'))) return
      const files = Array.from(event.clipboardData?.files || []).filter((file) => file.type.startsWith('image/'))
      if (!files.length) return
      event.preventDefault()
      pasteImagesRef.current(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // ─── Drop handler ─────────────────────────────────────────────────────────

  /** Boards without a chat session keep their images inline (downscaled), so the document stays self-contained. */
  const inlineImage = (file: File): Promise<string> => new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
      canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.88))
    }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(tl("Immagine non leggibile"))) }
    image.src = url
  })

  const uploadImage = async (file: File): Promise<string> => {
    if (!sessionId) return inlineImage(file)
    const res = await chatApi.uploadFiles(sessionId, [file])
    const url = res.data?.urls?.[0]
    if (!url) throw new Error(tl("Upload immagine non riuscito"))
    return String(url)
  }

  const handleDropFiles = async (e: React.DragEvent<HTMLDivElement>) => {
    if (!canEdit) return
    e.preventDefault()
    setIsDropActive(false)
    const files = Array.from(e.dataTransfer.files || [])
    const uriListRaw = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain')
    const uriCandidates = uriListRaw.split(/\s+/).map((p) => p.trim()).filter((p) => p && !p.startsWith('#') && looksLikeImageUrl(p))
    const htmlRaw = e.dataTransfer.getData('text/html')
    const htmlCandidates = htmlRaw ? extractImageUrlsFromHtml(htmlRaw) : []
    const droppedImageUrls = Array.from(new Set([...uriCandidates, ...htmlCandidates])).filter(looksLikeImageUrl)
    if (files.length === 0 && droppedImageUrls.length === 0) return

    beginInteraction()
    const wp = toWorld(e.clientX, e.clientY)
    let ox = wp.x, oy = wp.y

    for (const file of files) {
      if (file.type.startsWith('image/')) {
        try {
          const imageUrl = await uploadImage(file)
          const img: CanvasItem = { id: mkId(), type: 'image', x: ox, y: oy, w: 320, h: 220, src: imageUrl }
          setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, { ...img, parentFrameId: getParentFrameId(img, prev.items) }] }))
          oy += 30
        } catch (err) { console.error(err) }
        continue
      }
      const lower = file.name.toLowerCase()
      if (lower.endsWith('.csv') || lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
        const dataBuffer = await file.arrayBuffer()
        const workbook = XLSX.read(dataBuffer, { type: 'array' })
        const sheet = workbook.Sheets[workbook.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as Array<Array<string | number | boolean | null>>
        const normalized = toCsvTable(rows).slice(0, 20).map((row) => row.slice(0, 8))
        const tableItem: CanvasItem = { id: mkId(), type: 'table', x: ox, y: oy, w: 440, h: 280, data: normalized.length ? normalized : [['']] }
        setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, { ...tableItem, parentFrameId: getParentFrameId(tableItem, prev.items) }] }))
        oy += 34
      }
    }

    for (const src of droppedImageUrls) {
      const img: CanvasItem = { id: mkId(), type: 'image', x: ox, y: oy, w: 320, h: 220, src }
      setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, { ...img, parentFrameId: getParentFrameId(img, prev.items) }] }))
      oy += 30
    }

    endInteraction()
  }

  // ─── SVG renderers ────────────────────────────────────────────────────────

  const renderConnector = (item: Extract<CanvasItem, { type: 'connector' }>) => {
    const from = itemById.get(item.fromId)
    const to = itemById.get(item.toId)
    if (!from || !to || !isPositioned(from) || !isPositioned(to)) return null
    const p1 = getAnchorPoint(from, item.fromAnchor)
    const p2 = getAnchorPoint(to, item.toAnchor)
    const d1 = anchorDirection(item.fromAnchor)
    const d2 = anchorDirection(item.toAnchor)
    const curve = Math.max(36, Math.min(180, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.35))
    const c1 = { x: p1.x + d1.x * curve, y: p1.y + d1.y * curve }
    const c2 = { x: p2.x + d2.x * curve, y: p2.y + d2.y * curve }
    return (
      <path
        key={item.id}
        d={`M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`}
        stroke={item.color} strokeWidth={item.width} fill="none" strokeLinecap="round" strokeLinejoin="round"
        markerEnd="url(#canvas-arrow)"
      />
    )
  }

  const renderConnectorPreview = () => {
    if (!connectorDrag) return null
    const from = itemById.get(connectorDrag.fromId)
    if (!from || !isPositioned(from)) return null
    const p1 = getAnchorPoint(from, connectorDrag.fromAnchor)
    const p2 = connectorDrag.hoverTarget
      ? (() => { const t = itemById.get(connectorDrag.hoverTarget?.id || ''); return t && isPositioned(t) ? getAnchorPoint(t, connectorDrag.hoverTarget!.anchor) : connectorDrag.toPoint })()
      : connectorDrag.toPoint
    const d1 = anchorDirection(connectorDrag.fromAnchor)
    const tAnchor: Anchor = connectorDrag.hoverTarget?.anchor || (Math.abs(p2.x - p1.x) > Math.abs(p2.y - p1.y) ? (p2.x >= p1.x ? 'left' : 'right') : p2.y >= p1.y ? 'top' : 'bottom')
    const d2 = anchorDirection(tAnchor)
    const curve = Math.max(36, Math.min(180, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.35))
    const c1 = { x: p1.x + d1.x * curve, y: p1.y + d1.y * curve }
    const c2 = { x: p2.x + d2.x * curve, y: p2.y + d2.y * curve }
    return <path ref={connectorPreviewRef} d={`M ${p1.x} ${p1.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${p2.x} ${p2.y}`} stroke="#3ea9f4" strokeWidth={2.5} strokeDasharray="6 4" fill="none" markerEnd="url(#canvas-arrow)" />
  }

  // ─── Cursor ──────────────────────────────────────────────────────────────

  const cursor = isPanning
    ? 'grabbing'
    : (spaceHeldRef.current || tool === 'hand') ? 'grab'
    : tool === 'pen' ? 'crosshair'
    : tool === 'move' ? undefined
    : (tool === 'select' || tool === 'connector') ? 'default'
    : 'crosshair'  // shape/content creation tools

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div
      className={`flex flex-col overflow-hidden border border-slate-200 bg-white shadow-sm ${
        isFullscreen ? 'fixed inset-0 z-[9999] rounded-none' : fill ? 'h-full rounded-none border-0' : 'h-[calc(100vh-170px)] rounded-xl'
      }`}
    >
      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-slate-200 bg-white px-2 py-1.5">
        {leading}
        {/* Title */}
        <Input
          value={title}
          onChange={(e) => onTitleChange?.(e.target.value)}
          className="h-7 w-52 border-transparent text-sm shadow-none focus:border-slate-300"
          placeholder={tl("Titolo lavagna")}
          disabled={!canEdit}
        />

        <div className="mx-1 h-5 w-px bg-slate-200" />

        {/* Undo / Redo */}
        <button
          type="button"
          title={tl("Annulla (Ctrl+Z)")}
          onClick={undo}
          disabled={historyIndex <= 0}
          className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title={tl("Ripristina (Ctrl+Y)")}
          onClick={redo}
          disabled={historyIndex >= historyRef.current.length - 1}
          className="flex h-7 w-7 items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-30"
        >
          <Redo2 className="h-3.5 w-3.5" />
        </button>

        <div className="flex-1" />

        {/* Who is here: avatars (a dot says whether the live link is up) */}
        {sessionId && (
          <div className="flex items-center gap-1.5" aria-label={tl("Utenti connessi")}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${socketConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} title={socketConnected ? tl("Collaborazione in tempo reale attiva") : tl("Riconnessione in corso; le modifiche restano salvate localmente")} />
            {!socketConnected && <span className="text-[11px] font-semibold text-amber-700">Offline</span>}
            <div className="flex items-center -space-x-1.5">
              {online.slice(0, 4).map((u) => {
                const mine = u.id === currentUserId
                const color = collaboratorColor(u.id)
                return (
                  <button key={u.id} type="button" onClick={() => goToCollaborator(u.id)} disabled={mine || !remoteCursors[u.id]}
                    title={`${u.name}${u.role === 'teacher' ? ` · ${tl("Docente")}` : ''}${mine ? ` (${tl("tu")})` : ''}${remoteCursors[u.id] ? ` — ${tl("clicca per andare al cursore")}` : ''}`}
                    className="relative flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-white text-[10px] font-bold text-white shadow-sm disabled:cursor-default"
                    style={{ backgroundColor: color, boxShadow: u.role === 'teacher' ? `0 0 0 2px ${color}55` : undefined }}>
                    {u.avatarUrl ? <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" /> : u.name.slice(0, 2).toUpperCase()}
                  </button>
                )
              })}
              {online.length > 4 && <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-slate-200 text-[10px] font-bold text-slate-600">+{online.length - 4}</span>}
            </div>
          </div>
        )}

        {/* The single edit flag for students: only meaningful on a board shared with a session */}
        {role === 'teacher' && sessionId && (
          <button
            type="button"
            title={studentsCanWrite ? tl("Gli studenti possono modificare (e usare l'assistente) — clicca per disabilitare") : tl("Gli studenti guardano soltanto — clicca per permettere di modificare")}
            onClick={toggleStudentsCanWrite}
            className={`flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2 text-xs font-semibold transition-colors ${studentsCanWrite ? 'border-green-300 bg-green-50 text-green-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
          >
            <Users className="h-3.5 w-3.5" />
            {tl("Studenti")}
            <span className={`flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${studentsCanWrite ? 'bg-green-500' : 'bg-slate-300'}`}>
              <span className={`mx-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${studentsCanWrite ? 'translate-x-3' : 'translate-x-0'}`} />
            </span>
          </button>
        )}

        {/* Zoom */}
        <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-slate-200 bg-slate-50 px-1">
          <button type="button" onClick={zoomOut} aria-label={tl("Riduci")} className="flex h-6 w-6 items-center justify-center rounded text-xs text-slate-500 hover:bg-white">−</button>
          <span className="w-10 text-center text-xs tabular-nums text-slate-600">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={zoomIn} aria-label={tl("Ingrandisci")} className="flex h-6 w-6 items-center justify-center rounded text-xs text-slate-500 hover:bg-white">+</button>
        </div>

        {/* Everything else lives in one menu */}
        <div className="relative shrink-0">
          <button type="button" title={tl("Altro")} aria-label={tl("Altro")} aria-expanded={showMore} onClick={() => setShowMore((v) => !v)}
            className={`flex h-7 w-7 items-center justify-center rounded text-base font-black leading-none ${showMore ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'}`}>⋯</button>
          {showMore && (
            <>
              <div className="fixed inset-0 z-[9990]" onMouseDown={() => setShowMore(false)} />
              <div className="absolute right-0 top-8 z-[9991] w-60 rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                {[
                  ...(tutorial && canEdit ? [{ icon: <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#e85c8d] text-[10px] font-bold text-white">?</span>, label: tl("Guida: come funziona"), run: () => insertTutorialRef.current() }] : []),
                  ...(canEdit ? [{ icon: <AnimationIcon className="h-4 w-4" />, label: tl("Animazioni scientifiche"), run: () => setShowAnimations(true) }] : []),
                  ...(role === 'teacher' ? [{ icon: <LayoutTemplate className="h-4 w-4" />, label: tl("Template"), run: () => setShowTemplates(true) }] : []),
                  { icon: <MapIcon className="h-4 w-4" />, label: showMinimap ? tl("Nascondi la mappa") : tl("Mostra la mappa"), run: () => setShowMinimap((v) => !v) },
                  { icon: <Maximize2 className="h-4 w-4" />, label: tl("Adatta alla schermata"), run: fitToScreen },
                  { icon: isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />, label: isFullscreen ? tl("Esci da schermo intero") : tl("Schermo intero"), run: () => setIsFullscreen((v) => !v) },
                ].map((entry) => (
                  <button key={entry.label} type="button" onClick={() => { setShowMore(false); entry.run() }} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50">
                    <span className="flex h-4 w-4 items-center justify-center text-slate-500">{entry.icon}</span>{entry.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {chrome}
      </div>

      {/* ── Context property bar — always visible ───────────────────────── */}
      <div className={`flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1 text-xs transition-opacity duration-100 ${!selectedItem ? 'opacity-40 pointer-events-none' : ''}`} style={{ minHeight: 34 }}>
        {selectedItem ? (<>
          {selectedItem.type === 'formula' && (
            <>
              <span className="text-slate-500">{tl("Formula")}</span>
              <button type="button" onClick={() => setEditingId(selectedItem.id)} className="h-6 rounded border border-slate-200 bg-white px-2 font-semibold text-slate-700 hover:bg-slate-100">{tl("Modifica")}</button>
              <Input type="number" min={12} max={120} value={selectedItem.fontSize} onChange={(e) => updateItem(selectedItem.id, { fontSize: Math.max(12, Number(e.target.value || 28)) })} className="h-6 w-14 border-slate-200 px-1 text-center text-xs" title={tl("Dimensione")} />
              <ColorPicker value={selectedItem.color} onChange={(color) => updateItem(selectedItem.id, { color })} title={tl("Colore")} />
              {selectedItem.src && <button type="button" onClick={() => graphSelectedFormula(selectedItem)} className="h-6 rounded bg-[#1a1a2e] px-2 font-semibold text-white">{tl("Grafico")}</button>}
              {onAssist && <button type="button" onClick={() => onAssist(`Risolvi passo passo: ${selectedItem.src || selectedItem.latex}. Scrivi ogni passaggio come formula sotto la precedente.`, [selectedItem.id])} className="h-6 rounded border border-slate-200 bg-white px-2 font-semibold text-[#e85c8d] hover:bg-pink-50">{tl("Risolvi con l'assistente")}</button>}
            </>
          )}
          {selectedItem.type === 'text' && plainToLatex(selectedItem.text) && /[=^/]|sqrt/.test(selectedItem.text) && (
            <button type="button" onClick={() => {
              const latex = plainToLatex(selectedItem.text)!
              setCanvasDoc((prev) => ({ ...prev, items: prev.items.map((i) => i.id === selectedItem.id ? { id: i.id, parentFrameId: i.parentFrameId, type: 'formula', x: selectedItem.x, y: selectedItem.y, w: Math.max(selectedItem.w, 320), h: 84, latex, src: selectedItem.text.trim(), fontSize: 28, color: selectedItem.color } : i) }))
            }} className="h-6 rounded bg-[#1a1a2e] px-2 font-semibold text-white">{tl("Trasforma in formula")}</button>
          )}
          {isShape(selectedItem) && (
            <>
              <span className="text-slate-500">{tl("Forma")}</span>
              <div className="flex items-center gap-1">
                <span className="text-slate-500">Fill</span>
                <ColorPicker value={selectedItem.fill} onChange={(color) => updateItem(selectedItem.id, isToneStroke(selectedItem.stroke, selectedItem.fill) ? { fill: color, stroke: shapeStrokeFor(color) } : { fill: color })} disabled={!canEdit || isLockedByOther(selectedItem.id)} title={tl("Riempimento")} />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-slate-500">{tl("Bordo")}</span>
                <ColorPicker value={selectedItem.stroke} onChange={(color) => updateItem(selectedItem.id, { stroke: color })} disabled={!canEdit || isLockedByOther(selectedItem.id)} title={tl("Bordo")} />
              </div>
              <label className="flex items-center gap-1 text-slate-500">
                {tl("Spessore")}
                <Input type="number" min={0.5} max={16} step={0.5} value={selectedItem.borderWidth ?? 2.5} onChange={(e) => updateItem(selectedItem.id, { borderWidth: Math.max(0.5, Math.min(16, Number(e.target.value || 2.5))) })} className="h-6 w-14 border-slate-200 px-1" disabled={!canEdit || isLockedByOther(selectedItem.id)} />
              </label>
              <button type="button" onClick={() => updateItem(selectedItem.id, { borderStyle: selectedItem.borderStyle === 'hand-drawn' ? 'solid' : 'hand-drawn' })} className={`h-6 rounded border px-2 ${selectedItem.borderStyle === 'hand-drawn' ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-500'}`} disabled={!canEdit || isLockedByOther(selectedItem.id)}>
                {tl("Bordo a mano")}
              </button>
            </>
          )}
          {isFrame(selectedItem) && (
            <>
              <span className="text-slate-500">Frame</span>
              <label className="flex items-center gap-1 text-slate-500">{tl("Sfondo")} <ColorPicker value={(selectedItem.backgroundColor || '#ffffff').slice(0, 7)} onChange={(color) => updateItem(selectedItem.id, { backgroundColor: color })} disabled={!canEdit || isLockedByOther(selectedItem.id)} title={tl("Colore")} /></label>
              <label className="flex items-center gap-1 text-slate-500">{tl("Bordo")} <ColorPicker value={selectedItem.color} onChange={(color) => updateItem(selectedItem.id, { color: color })} disabled={!canEdit || isLockedByOther(selectedItem.id)} title={tl("Colore")} /></label>
              <label className="flex items-center gap-1 text-slate-500">{tl("Spessore")} <Input type="number" min={0.5} max={16} step={0.5} value={selectedItem.borderWidth ?? 2} onChange={(e) => updateItem(selectedItem.id, { borderWidth: Math.max(0.5, Math.min(16, Number(e.target.value || 2))) })} className="h-6 w-14 border-slate-200 px-1" disabled={!canEdit || isLockedByOther(selectedItem.id)} /></label>
              <button type="button" onClick={() => updateItem(selectedItem.id, { borderStyle: selectedItem.borderStyle === 'hand-drawn' ? 'dashed' : 'hand-drawn' })} className={`h-6 rounded border px-2 ${selectedItem.borderStyle === 'hand-drawn' ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-slate-200 bg-white text-slate-500'}`} disabled={!canEdit || isLockedByOther(selectedItem.id)}>{tl("Bordo a mano")}</button>
            </>
          )}
          {isConnector(selectedItem) && (
            <>
              <span className="text-slate-500">{tl("Connettore")}</span>
              <ColorPicker value={selectedItem.color} onChange={(color) => updateItem(selectedItem.id, { color: color })} disabled={!canEdit} title={tl("Colore")} />
              <Input type="number" min={1} max={8} value={selectedItem.width} onChange={(e) => updateItem(selectedItem.id, { width: Math.max(1, Math.min(8, Number(e.target.value || 2))) })} className="h-6 w-12 border-slate-200 px-1" disabled={!canEdit} />
            </>
          )}
          {selectedTextStyle && isTextEditable(selectedItem) && (
            <>
              <span className="text-slate-500">{tl("Testo")}</span>
              <select className="h-6 rounded border border-slate-200 bg-white px-1 text-xs" value={selectedTextStyle.fontFamily} onChange={(e) => updateItem(selectedItem.id, { textStyle: { ...selectedTextStyle, fontFamily: e.target.value } })} disabled={!canEdit || isLockedByOther(selectedItem.id)}>
                <option value="Inter, system-ui, sans-serif">Inter</option>
                <option value="Arial, sans-serif">Arial</option>
                <option value="Georgia, serif">Georgia</option>
                <option value="'Courier New', monospace">Courier</option>
              </select>
              <Input type="number" min={10} max={48} value={selectedTextStyle.fontSize} onChange={(e) => updateItem(selectedItem.id, { textStyle: { ...selectedTextStyle, fontSize: Math.max(10, Math.min(48, Number(e.target.value || 14))) } })} className="h-6 w-14 border-slate-200 px-1 text-xs" disabled={!canEdit || isLockedByOther(selectedItem.id)} />
              <button type="button" onClick={() => updateItem(selectedItem.id, { textStyle: { ...selectedTextStyle, fontWeight: selectedTextStyle.fontWeight === '600' ? 'normal' : '600' } })} className={`h-6 w-6 rounded border text-xs font-bold ${selectedTextStyle.fontWeight === '600' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white'}`} disabled={!canEdit || isLockedByOther(selectedItem.id)}>B</button>
              <button type="button" onClick={() => updateItem(selectedItem.id, { textStyle: { ...selectedTextStyle, fontStyle: selectedTextStyle.fontStyle === 'italic' ? 'normal' : 'italic' } })} className={`h-6 w-6 rounded border text-xs italic ${selectedTextStyle.fontStyle === 'italic' ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-200 bg-white'}`} disabled={!canEdit || isLockedByOther(selectedItem.id)}>I</button>
              {selectedItem.type === 'shape' && (
                <label className="flex items-center gap-1 text-slate-500">{tl("Colore")} <ColorPicker value={canvasLabelColor(selectedItem.fill, selectedItem.textColor, selectedItem.fillOpacity)} onChange={(color) => updateItem(selectedItem.id, { textColor: color })} disabled={!canEdit || isLockedByOther(selectedItem.id)} title={tl("Colore")} /></label>
              )}
              {selectedItem.type === 'postit' && (
                <div className="flex gap-1">
                  {POSTIT_PALETTE.map((c) => (
                    <button key={c} type="button" onClick={() => updateItem(selectedItem.id, { color: c })} className={`h-5 w-5 rounded border-2 ${selectedItem.color === c ? 'border-slate-800 scale-110' : 'border-transparent'}`} style={{ background: c }} />
                  ))}
                </div>
              )}
            </>
          )}
          {canEdit && (
            <button type="button" onClick={deleteSelected} className="ml-auto flex h-6 items-center gap-1 rounded px-2 text-red-500 hover:bg-red-50">
              <Trash2 className="h-3.5 w-3.5" /> {tl("Elimina")}
            </button>
          )}
        </>) : (
          <span className="text-[11px] text-slate-500 select-none">{tl("Seleziona un elemento per vedere le proprietà")}</span>
        )}
      </div>

      {/* ── Main area ────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* Left tool panel */}
        {canEdit && (
          <div className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-slate-200 bg-white py-2">
            <ToolButton activeTool={tool} t="select" icon={MousePointer} label={tl("Seleziona (V)")} onSetTool={setTool} />
            <ToolButton activeTool={tool} t="hand" icon={Move} label={tl("Sposta la vista (H)")} onSetTool={setTool} />
            <ToolButton activeTool={tool} t="move" icon={GrabHandIcon} label={tl("Sposta gli elementi: trascina quelli selezionati (G)")} onSetTool={setTool} />
            <div className="my-0.5 h-px w-7 bg-slate-200" />
            <ToolButton activeTool={tool} t="postit" icon={StickyNote} label={tl("Post-it — trascina per dimensionare (P)")} onSetTool={setTool} />
            <ToolButton activeTool={tool} t="frame" icon={Frame} label={tl("Frame — trascina per dimensionare (F)")} onSetTool={setTool} />
            <ToolButton activeTool={tool} t="text" icon={Type} label={tl("Testo (T)")} onSetTool={setTool} />
            <div className="my-0.5 h-px w-7 bg-slate-200" />
            <ToolButton activeTool={tool} t="roundedRect" icon={RectangleHorizontal} label={tl("Rettangolo — trascina per dimensionare (R)")} onSetTool={setTool} />
            <ToolButton activeTool={tool} t="rect" icon={Square} label={tl("Rettangolo a spigoli vivi")} onSetTool={setTool} />
            <ToolButton activeTool={tool} t="ellipse" icon={Circle} label={tl("Ellisse — trascina per dimensionare (O)")} onSetTool={setTool} />
            <ToolButton activeTool={tool} t="triangle" icon={Triangle} label={tl("Triangolo — trascina per dimensionare")} onSetTool={setTool} />
            <div className="my-0.5 h-px w-7 bg-slate-200" />
            <ToolButton activeTool={tool} t="line" icon={Minus} label={tl("Linea — trascina (L)")} onSetTool={setTool} />
            <ToolButton activeTool={tool} t="arrow" icon={ArrowRight} label={tl("Freccia libera — trascina (A)")} onSetTool={setTool} />
            <ToolButton activeTool={tool} t="formula" icon={SigmaIcon} label={tl("Formula matematica — trascina (M)")} onSetTool={setTool} />
            <div className="my-0.5 h-px w-7 bg-slate-200" />
            <ToolButton activeTool={tool} t="connector" icon={MoveRight} label={tl("Connettore — trascina da un punto di ancoraggio (C)")} onSetTool={setTool} />
            <ToolButton activeTool={tool} t="pen" icon={Pencil} label={tl("Penna libera (D)")} onSetTool={setTool} />
            <div className="my-0.5 h-px w-7 bg-slate-200" />
            <button type="button" title={tl("Elimina selezionato (Del)")} onClick={deleteSelected} disabled={!selectedId} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-30">
              <Eraser className="h-4 w-4" />
            </button>

            {/* Pen color/width (only when pen tool active) */}
            {tool === 'pen' && (
              <>
                <div className="my-0.5 h-px w-7 bg-slate-200" />
                <ColorPicker value={strokeColor} onChange={(color) => setStrokeColor(color)} title={tl("Colore penna")} />
                <Input type="number" min={1} max={14} value={strokeWidth} onChange={(e) => setStrokeWidth(Number(e.target.value || 3))} className="h-7 w-9 border-slate-200 px-1 text-center text-xs" title={tl("Spessore")} />
              </>
            )}

            {/* Post-it color (when postit tool active) */}
            {tool === 'postit' && (
              <>
                <div className="my-0.5 h-px w-7 bg-slate-200" />
                {POSTIT_PALETTE.slice(0, 4).map((c) => (
                  <button key={c} type="button" onClick={() => setNewPostitColor(c)} className={`mb-0.5 h-6 w-6 rounded border-2 ${newPostitColor === c ? 'border-slate-700' : 'border-transparent'}`} style={{ background: c }} />
                ))}
              </>
            )}

            {/* Shape color (when shape tool active) */}
            {(SHAPE_TOOLS.includes(tool) || tool === 'line' || tool === 'arrow') && (
              <>
                <div className="my-0.5 h-px w-7 bg-slate-200" />
                <ColorPicker value={newShapeFill} onChange={(color) => { setNewShapeFill(color); setNewShapeStroke(null) }} title={tl("Riempimento")} />
                <ColorPicker value={newShapeStroke} onChange={(color) => setNewShapeStroke(color)} title={tl("Bordo")} />
              </>
            )}
          </div>
        )}

        {/* Canvas container */}
        <div
          ref={containerRef}
          className={`relative flex-1 overflow-hidden ${tool === 'move' ? 'cursor-grab active:cursor-grabbing' : ''}`}
          style={{
            cursor,
            touchAction: 'none',
            overscrollBehavior: 'none',
            backgroundColor: '#ffffff',
            backgroundImage: 'radial-gradient(circle at 1px 1px, #d6d6d6 1px, transparent 0)',
            backgroundSize: `${24 * zoom}px ${24 * zoom}px`,
            backgroundPosition: `${pan.x}px ${pan.y}px`,
          }}
          onPointerDownCapture={onPointerDownCapture}
          onPointerDown={(e) => { closeContextMenu(); onContainerPointerDown(e) }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={() => emitCursor({ x: 0, y: 0 }, false)}
          onContextMenu={(e) => openContextMenu(e, null)}
          onDragEnter={(e) => { e.preventDefault(); if (canEdit) setIsDropActive(true) }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDropActive(false) }}
          onDragOver={(e) => { e.preventDefault(); if (canEdit) { e.dataTransfer.dropEffect = 'copy'; setIsDropActive(true) } }}
          onDrop={handleDropFiles}
        >
          {/* World layer */}
          <div
            ref={worldRef}
            // Document colours belong to the board, independently of the app theme.
            className="theme-keep text-slate-900"
            style={{
              colorScheme: 'light',
              color: '#171717',
              transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`,
              transformOrigin: '0 0',
              willChange: 'transform',
              position: 'absolute',
              width: 1,
              height: 1,
              overflow: 'visible',
            }}
          >
            {/* SVG: connectors & paths */}
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" style={{ width: 1, height: 1, overflow: 'visible', zIndex: connectorLayerZ }}>
              <defs>
                <marker id="canvas-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
                </marker>
              </defs>
              {connectorItems.map(renderConnector)}
              {renderConnectorPreview()}
              {previewPoints.length > 0 && (
                <path ref={previewPathRef} d="" stroke={strokeColor} strokeWidth={strokeWidth} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              )}
            </svg>

            {/* Painted directly during pointer movement to keep marquee selection smooth. */}
            <div
              ref={marqueeElementRef}
              className="pointer-events-none absolute hidden border border-blue-500 bg-blue-400/10"
              style={{ left: 0, top: 0, zIndex: 1_000_000 }}
            />

            {/* Drag-to-create ghost */}
            {previewCreate && (
              <div
                ref={createPreviewRef}
                className="pointer-events-none absolute rounded border-2 border-dashed border-blue-500 bg-blue-100/20"
                style={{ left: 0, top: 0, width: previewCreate.w, height: previewCreate.h, transform: `translate3d(${previewCreate.x}px, ${previewCreate.y}px, 0)` }}
              />
            )}

            {summon && (
              <div key={summon.at} className="pointer-events-none absolute left-0 top-0" style={{ transform: `translate3d(${summon.x}px, ${summon.y}px, 0)`, zIndex: 2_000_001 }}>
                <span className="absolute -left-10 -top-10 h-20 w-20 animate-ping rounded-full border-4 border-[#e85c8d]" />
                <span className="absolute -left-2 -top-2 h-4 w-4 rounded-full bg-[#e85c8d] ring-4 ring-white" />
              </div>
            )}
            {Object.values(remoteCursors).map((remoteCursor) => (
              <div
                key={remoteCursor.userId}
                className="pointer-events-none absolute left-0 top-0 transition-transform duration-75 ease-out"
                style={{ transform: `translate3d(${remoteCursor.x}px, ${remoteCursor.y}px, 0) scale(${1 / zoom})`, transformOrigin: '0 0', zIndex: 2_000_000 }}
              >
                <MousePointer className="h-6 w-6 -rotate-12 drop-shadow-md" style={{ color: remoteCursor.color, fill: remoteCursor.color, stroke: '#fff', strokeWidth: 1.5 }} />
                <span className="ml-4 -mt-0.5 block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold text-white shadow-md ring-2 ring-white" style={{ backgroundColor: remoteCursor.color }}>
                  {remoteCursor.label}
                </span>
              </div>
            ))}

            {/* Items */}
            {positionedItems.map((item) => {
              const lockedByOther = isLockedByOther(item.id)
              const isEditing = editingId === item.id
              if (!isPositioned(item)) return null
              return (
                <div
                  key={item.id}
                  ref={(element) => { itemRefs.current[item.id] = element }}
                  data-canvas-x={item.x}
                  data-canvas-y={item.y}
                  data-canvas-type={item.type}
                  className={`absolute ${selectedIdSet.has(item.id) ? (tool === 'move' ? 'ring-2 ring-pink-500 ring-offset-2' : 'ring-2 ring-blue-500 ring-offset-1') : ''} ${lockedByOther ? 'opacity-60' : ''}`}
                  style={{
                    left: item.x, top: item.y, width: item.w, height: item.h,
                    zIndex: itemZIndex.get(item.id) || 1,
                    pointerEvents: item.type === 'path' ? 'none' : undefined,
                    willChange: draggingRef.current?.id === item.id ? 'transform' : undefined,
                  }}
                  onPointerDown={(e) => onPointerDownItem(e, item)}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={() => { if (item.type === 'formula' && canEdit) { setSelectedId(item.id); setSelectedIds([item.id]); setEditingId(item.id) } }}
                  onContextMenu={(e) => openContextMenu(e, item.id)}
                >
                  {item.type === 'postit' && (
                    <textarea
                      ref={(element) => { textEditorRefs.current[item.id] = element }}
                      value={item.text}
                      onFocus={() => { beginInteraction(); emitLock(item.id) }}
                      onBlur={() => { emitUnlock(item.id); endInteraction() }}
                      onChange={(e) => updateItem(item.id, { text: e.target.value })}
                      className="h-full w-full resize-none rounded-xl p-2.5 text-sm"
                      style={{ background: `linear-gradient(180deg, ${shadeTopFor(item.color, 0.5)} 0%, ${item.color} 100%)`, boxShadow: `inset 0 0 0 1px ${shapeStrokeFor(item.color)}55, 0 2px 6px -2px ${shapeStrokeFor(item.color)}40`, color: canvasLabelColor(item.color), fontFamily: item.textStyle?.fontFamily || DEFAULT_TEXT_STYLE.fontFamily, fontSize: `${item.textStyle?.fontSize || 14}px`, fontWeight: item.textStyle?.fontWeight || 'normal', fontStyle: item.textStyle?.fontStyle || 'normal', border: 'none', outline: 'none' }}
                      disabled={!canEdit || lockedByOther}
                      readOnly={!isEditing}
                      autoFocus={isEditing}
                      onBlurCapture={() => setEditingId((prev) => (prev === item.id ? null : prev))}
                    />
                  )}

                  {item.type === 'frame' && (
                    <div
                      className="relative flex h-full w-full flex-col rounded-lg"
                      style={{
                        backgroundColor: item.backgroundColor || '#ffffff99',
                        borderColor: item.borderStyle === 'hand-drawn' ? 'transparent' : item.color,
                        borderWidth: item.borderStyle === 'hand-drawn' ? 0 : (item.borderWidth ?? 2),
                        borderStyle: item.borderStyle === 'solid' ? 'solid' : 'dashed',
                      }}
                    >
                      {item.borderStyle === 'hand-drawn' && (
                        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox={`0 0 ${item.w} ${item.h}`} preserveAspectRatio="none">
                          <defs>
                            <filter id={`rough-frame-${item.id}`} x="-8%" y="-8%" width="116%" height="116%">
                              <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="3" seed="7" result="noise" />
                              <feDisplacementMap in="SourceGraphic" in2="noise" scale="6" xChannelSelector="R" yChannelSelector="G" />
                            </filter>
                          </defs>
                          <rect x="3" y="3" width={Math.max(item.w - 6, 1)} height={Math.max(item.h - 6, 1)} rx="7" fill="none" stroke={item.color} strokeWidth={item.borderWidth ?? 2} filter={`url(#rough-frame-${item.id})`} />
                          <rect x="4" y="2" width={Math.max(item.w - 7, 1)} height={Math.max(item.h - 6, 1)} rx="7" fill="none" stroke={item.color} strokeWidth={Math.max(0.6, (item.borderWidth ?? 2) * 0.45)} opacity="0.45" />
                        </svg>
                      )}
                      <input
                        ref={(element) => { textEditorRefs.current[item.id] = element }}
                        value={item.text}
                        onFocus={() => { beginInteraction(); emitLock(item.id) }}
                        onBlur={() => { emitUnlock(item.id); endInteraction() }}
                        onChange={(e) => updateItem(item.id, { text: e.target.value })}
                        className="relative z-[1] w-full border-b border-dashed bg-transparent px-2 py-1 text-xs font-semibold"
                        style={{ borderColor: item.color, color: canvasLabelColor(item.backgroundColor || '#ffffff99', item.color), fontFamily: item.textStyle?.fontFamily || DEFAULT_TEXT_STYLE.fontFamily, fontSize: `${item.textStyle?.fontSize || 12}px`, fontWeight: item.textStyle?.fontWeight || '600', fontStyle: item.textStyle?.fontStyle || 'normal', outline: 'none' }}
                        disabled={!canEdit || lockedByOther}
                        readOnly={!isEditing}
                        autoFocus={isEditing}
                        onBlurCapture={() => setEditingId((prev) => (prev === item.id ? null : prev))}
                      />
                    </div>
                  )}

                  {item.type === 'text' && (
                    <textarea
                      ref={(element) => { textEditorRefs.current[item.id] = element }}
                      value={item.text}
                      onFocus={() => { beginInteraction(); emitLock(item.id) }}
                      onBlur={() => { emitUnlock(item.id); endInteraction() }}
                      onChange={(e) => updateItem(item.id, { text: e.target.value })}
                      className={`h-full w-full resize-none overflow-hidden rounded bg-transparent text-sm ${item.h < 44 ? 'px-1 py-0' : 'p-2'}`}
                      style={{ color: item.color, fontFamily: item.textStyle?.fontFamily || DEFAULT_TEXT_STYLE.fontFamily, fontSize: `${item.textStyle?.fontSize || 14}px`, fontWeight: item.textStyle?.fontWeight || 'normal', fontStyle: item.textStyle?.fontStyle || 'normal', border: 'none', outline: 'none' }}
                      disabled={!canEdit || lockedByOther}
                      readOnly={!isEditing}
                      autoFocus={isEditing}
                      onBlurCapture={() => setEditingId((prev) => (prev === item.id ? null : prev))}
                    />
                  )}

                  {item.type === 'shape' && (
                    <>
                      <CanvasShape item={item} />
                      <textarea
                        ref={(element) => { textEditorRefs.current[item.id] = element }}
                        value={item.text || ''}
                        aria-label={tl("Testo della figura")}
                        onFocus={() => { beginInteraction(); emitLock(item.id) }}
                        onBlur={() => { emitUnlock(item.id); endInteraction() }}
                        onChange={(e) => updateItem(item.id, { text: e.target.value })}
                        className="absolute inset-[12%] z-[1] resize-none bg-transparent text-center"
                        style={{
                          color: canvasLabelColor(item.fill, item.textColor, item.fillOpacity),
                          fontFamily: item.textStyle?.fontFamily || DEFAULT_TEXT_STYLE.fontFamily,
                          fontSize: `${item.textStyle?.fontSize || 14}px`,
                          fontWeight: item.textStyle?.fontWeight || 'normal',
                          fontStyle: item.textStyle?.fontStyle || 'normal',
                          border: 'none',
                          outline: 'none',
                          pointerEvents: isEditing ? 'auto' : 'none',
                        }}
                        disabled={!canEdit || lockedByOther}
                        readOnly={!isEditing}
                        autoFocus={isEditing}
                        onBlurCapture={() => setEditingId((prev) => (prev === item.id ? null : prev))}
                      />
                      {canEdit && selectedIdSet.has(item.id) && ANCHORS.map((anchor) => {
                        const isSource = connectorDrag?.fromId === item.id && connectorDrag.fromAnchor === anchor
                        const isHoverTarget = connectorDrag?.hoverTarget?.id === item.id && connectorDrag.hoverTarget.anchor === anchor
                        const pointStyle: React.CSSProperties =
                          anchor === 'top' ? { left: '50%', top: 0, transform: 'translate(-50%,-50%)' } :
                          anchor === 'right' ? { right: 0, top: '50%', transform: 'translate(50%,-50%)' } :
                          anchor === 'bottom' ? { left: '50%', bottom: 0, transform: 'translate(-50%,50%)' } :
                          { left: 0, top: '50%', transform: 'translate(-50%,-50%)' }
                        return (
                          <button
                            key={`${item.id}-${anchor}`}
                            type="button"
                            className={`absolute h-4 w-4 rounded-full border shadow-sm ${isSource ? 'border-blue-600 bg-blue-500' : isHoverTarget ? 'border-blue-500 bg-blue-100' : 'border-blue-500 bg-white'}`}
                            style={pointStyle}
                            onPointerDown={(e) => {
                              e.stopPropagation()
                              if (!canEdit) return
                              activePointerIdRef.current = e.pointerId
                              containerRef.current?.setPointerCapture(e.pointerId)
                              if (tool !== 'connector') setTool('connector')
                              setConnectorDrag({ fromId: item.id, fromAnchor: anchor, toPoint: getAnchorPoint(item, anchor) })
                            }}
                            onPointerEnter={() => setConnectorDrag((prev) => prev ? (prev.fromId === item.id && prev.fromAnchor === anchor ? prev : { ...prev, hoverTarget: { id: item.id, anchor } }) : prev)}
                            onPointerLeave={() => setConnectorDrag((prev) => prev?.hoverTarget?.id === item.id && prev.hoverTarget.anchor === anchor ? { ...prev, hoverTarget: undefined } : prev)}
                          />
                        )
                      })}
                    </>
                  )}

                  {item.type === 'path' && (
                    <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${item.ow} ${item.oh}`} preserveAspectRatio="none">
                      <path d={item.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('')} fill="none" stroke={item.color} strokeWidth={item.width} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                      {/* a fat invisible stroke: the thin line is easy to grab, the empty box around it is not */}
                      <path d={item.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join('')} fill="none" stroke="transparent" strokeWidth={Math.max(item.width + 12, 16)} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" style={{ pointerEvents: 'stroke' }} />
                    </svg>
                  )}

                  {item.type === 'animation' && <MotionPlayer scene={item.scene} />}

                  {item.type === 'formula' && (
                    <div className="flex h-full w-full items-center justify-center overflow-visible rounded-md" style={{ color: item.color, fontSize: item.fontSize }}>
                      {item.latex.trim()
                        ? <div dangerouslySetInnerHTML={{ __html: katex.renderToString(item.latex, { throwOnError: false, displayMode: true, trust: false }) }} />
                        : <span className="text-sm text-slate-500">{tl("Doppio clic per scrivere la formula")}</span>}
                    </div>
                  )}

                  {item.type === 'plot' && (() => {
                    const geo = plotGeometry(item)
                    return (
                      <svg className="h-full w-full overflow-visible rounded-md bg-white shadow-sm" viewBox={`0 0 ${item.w} ${item.h}`} style={{ border: '1.5px solid #64748b' }}>
                        {geo.grid.map(([x1, y1, x2, y2], i) => <line key={`g${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#e2e8f0" />)}
                        {geo.axes.map(([x1, y1, x2, y2], i) => <line key={`a${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#1e293b" strokeWidth={2} markerEnd="url(#canvas-arrow)" />)}
                        {geo.ticks.map((t, i) => <text key={`t${i}`} x={t.x} y={t.y} fontSize={11} fill="#475569" textAnchor={t.align} fontFamily="Inter, system-ui, sans-serif">{t.text}</text>)}
                        {geo.curves.map((c, i) => <path key={`c${i}`} d={c.map((p, k) => `${k ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('')} fill="none" stroke={item.color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />)}
                        {geo.marks.map((m, i) => <g key={`m${i}`}><circle cx={m.x} cy={m.y} r={4} fill={item.color} /><text x={m.x + 7} y={m.y - 7} fontSize={12} fill="#171717" fontFamily="Inter, system-ui, sans-serif">{m.label}</text></g>)}
                        {item.title && <text x={10} y={geo.titleY} fontSize={13} fontWeight={600} fill="#334155" fontFamily="Inter, system-ui, sans-serif">{item.title}</text>}
                      </svg>
                    )
                  })()}

                  {item.type === 'line' && (
                    <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${item.w} ${item.h}`} preserveAspectRatio="none">
                      <line x1={item.flipX ? item.w : 0} y1={item.flipY ? item.h : 0} x2={item.flipX ? 0 : item.w} y2={item.flipY ? 0 : item.h} stroke={item.color} strokeWidth={item.width} strokeLinecap="round" markerEnd={item.arrow ? 'url(#canvas-arrow)' : undefined} vectorEffect="non-scaling-stroke" />
                    </svg>
                  )}

                  {item.type === 'image' && <img src={item.src} alt="" className="h-full w-full rounded-md object-cover shadow-sm" draggable={false} />}

                  {item.type === 'table' && (
                    <div className="h-full w-full overflow-auto rounded-md border border-slate-200 bg-white text-slate-900 shadow-sm">
                      <table className="min-w-full border-collapse text-xs">
                        <tbody>
                          {item.data.map((row, ri) => (
                            <tr key={`${item.id}-r${ri}`}>
                              {row.map((cell, ci) => <td key={`${item.id}-c${ri}-${ci}`} className="border border-slate-100 px-1 py-0.5">{cell}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {item.type === 'quiz' && <QuizCard item={item} viewer={viewer} canRecord={canEdit} onRecord={(patch) => recordAnswer(item.id, patch)} />}
                  {item.type === 'flashcard' && <FlashCard item={item} viewer={viewer} canRecord={canEdit} onRecord={(patch) => recordAnswer(item.id, patch)} />}
                  {item.type === 'check' && <CheckCard item={item} viewer={viewer} canRecord={canEdit} onRecord={(patch) => recordAnswer(item.id, patch)} onValidate={onValidateAnswer} />}

                  {/* Move mode: a grab surface over the whole item, so nothing inside it (text, players, images) steals the drag */}
                  {tool === 'move' && canEdit && !lockedByOther && (
                    <div className={`absolute inset-0 z-[5] cursor-grab rounded-sm active:cursor-grabbing ${selectedIdSet.has(item.id) ? 'bg-pink-400/10 outline-dashed outline-2 outline-pink-500' : 'hover:bg-pink-400/10 hover:outline-dashed hover:outline-2 hover:outline-pink-300'}`} style={{ pointerEvents: 'auto' }} />
                  )}

                  {/* Resize handle */}
                  {canEdit && !lockedByOther && selectedId === item.id && isPositioned(item) && (
                    <button
                      type="button"
                      className="absolute -bottom-1 -right-1 z-10 h-2.5 w-2.5 cursor-se-resize rounded-[2px] border border-white bg-slate-950 shadow-sm"
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        if (!isPositioned(item) || isLockedByOther(item.id)) return
                        activePointerIdRef.current = e.pointerId
                        containerRef.current?.setPointerCapture(e.pointerId)
                        beginInteraction(); emitLock(item.id)
                        draggingRef.current = null
                        resizingRef.current = { id: item.id, startX: e.clientX, startY: e.clientY, startW: item.w, startH: item.h }
                      }}
                      title={tl("Ridimensiona")}
                    />
                  )}

                  {/* Lock badge — teacher can force-unlock */}
                  {lockedByOther && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-md bg-slate-100/40">
                      {role === 'teacher' ? (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); forceUnlockItem(item.id) }}
                          className="rounded bg-amber-600/80 px-2 py-0.5 text-xs text-white hover:bg-amber-700/90"
                          title={tl("Forza sblocco")}
                        >
                          {tl("🔒 Sblocca")}
                        </button>
                      ) : (
                        <span className="pointer-events-none rounded bg-slate-700/70 px-1.5 py-0.5 text-xs text-white">{tl("In uso")}</span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Drop overlay */}
          {summonError && (
            <div className="absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-full bg-rose-600 px-4 py-1.5 text-xs font-bold text-white shadow-lg" role="alert">{summonError}</div>
          )}
          {summon && role !== 'teacher' && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-40 -translate-x-1/2 rounded-full bg-[#1a1a2e] px-4 py-1.5 text-xs font-bold text-white shadow-lg" role="status">
              {summon.label} {tl("ti richiama qui")}
            </div>
          )}
          {showMinimap && (
            <div className="absolute bottom-3 right-3 z-30" onPointerDown={(e) => e.stopPropagation()}>
              <CanvasMinimap items={minimapItems} pan={pan} zoom={zoom} viewW={viewSize.w} viewH={viewSize.h}
                onJump={(wx, wy) => setPan({ x: viewSize.w / 2 - wx * zoomRef.current, y: viewSize.h / 2 - wy * zoomRef.current })} />
            </div>
          )}
          {canEdit && editingFormula && (
            <FormulaEditor key={editingFormula.id} latex={editingFormula.latex} src={editingFormula.src}
              onChange={(patch) => updateItem(editingFormula.id, patch)} onClose={() => setEditingId(null)}
              onGraph={() => graphSelectedFormula(editingFormula)}
              onAssist={onAssist ? (prompt) => onAssist(prompt, [editingFormula.id]) : undefined} />
          )}
          {tool === 'move' && canEdit && (
            <div className="pointer-events-none absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full bg-pink-600 px-4 py-1.5 text-xs font-bold text-white shadow-lg" role="status">
              <GrabHandIcon className="h-4 w-4" />
              {selectedIds.length ? tl("Modalità sposta · trascina gli elementi selezionati · frecce per spostare di precisione · Esc per uscire") : tl("Modalità sposta · seleziona con un clic o con un riquadro, poi trascina · Esc per uscire")}
            </div>
          )}
          {isDropActive && canEdit && (
            <div className="pointer-events-none absolute inset-4 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-blue-400 bg-blue-50/80">
              <div className="flex items-center gap-2 text-sm font-medium text-blue-700">
                <ImagePlus className="h-4 w-4" />
                {tl("Rilascia immagini o file CSV/XLSX")}
                <Table className="h-4 w-4" />
              </div>
            </div>
          )}

          {/* Connector hint */}
          {tool === 'connector' && connectorDrag && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-slate-800/80 px-3 py-1 text-xs text-white">
              {tl("Trascina verso un punto di connessione")}
            </div>
          )}

          {/* Student banner — different messages depending on state */}
          {role === 'student' && !canEdit && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-1.5 text-xs text-slate-500 shadow-md backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              {tl("Solo visualizzazione · il docente non ha ancora abilitato le modifiche")}
            </div>
          )}
          {role === 'student' && canEdit && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full border border-green-200 bg-green-50/95 px-4 py-1.5 text-xs text-green-700 shadow-md backdrop-blur-sm">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
              {tl("Modifica abilitata dal docente")}
            </div>
          )}

          {/* Connection status + zoom HUD */}
          <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
            <span className={`h-2 w-2 rounded-full ${socketConnected ? 'bg-green-400' : 'bg-amber-400'}`} title={socketConnected ? tl("Connesso in tempo reale") : tl("Modalità polling")} />
            <span className="text-xs text-slate-500">{Math.round(zoom * 100)}%</span>
          </div>
        </div>
      </div>

      {/* ── Context menu ────────────────────────────────────────────────── */}
      {contextMenu && (
        <div
          className="fixed z-[200] min-w-[180px] rounded-xl border border-slate-200 bg-white py-1 shadow-xl"
          style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {role === 'teacher' && sessionId && (
            <>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs font-semibold text-[#e85c8d] hover:bg-pink-50" onClick={() => { summonStudents(contextMenu.screenX, contextMenu.screenY); closeContextMenu() }}>
                <Users className="h-3 w-3" /> {tl("Richiama gli studenti qui")}
              </button>
              <div className="mx-2 my-1 h-px bg-slate-100" />
            </>
          )}
          {contextMenu.itemId && onAssist && (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#e85c8d]">{tl("Assistente · brainstorming")}</div>
              {BRAINSTORM_ACTIONS.map((action) => (
                <button key={action.key} type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-pink-50" onClick={() => {
                  const id = contextMenu.itemId!
                  closeContextMenu()
                  onAssist(action.prompt, selectedIdSet.has(id) ? selectedIds : [id])
                }}>
                  <Sparkles className="h-3 w-3 text-[#e85c8d]" /> {action.label}
                </button>
              ))}
              <div className="mx-2 my-1 h-px bg-slate-100" />
            </>
          )}
          {contextMenu.itemId ? (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{tl("Livello Z")}</div>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { reorderItem(contextMenu.itemId!, 'front'); closeContextMenu() }}>
                <span className="text-slate-500">⬆⬆</span> {tl("Porta in primo piano")}
              </button>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { reorderItem(contextMenu.itemId!, 'forward'); closeContextMenu() }}>
                <span className="text-slate-500">⬆</span> {tl("Porta avanti")}
              </button>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { reorderItem(contextMenu.itemId!, 'backward'); closeContextMenu() }}>
                <span className="text-slate-500">⬇</span> {tl("Manda indietro")}
              </button>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { reorderItem(contextMenu.itemId!, 'back'); closeContextMenu() }}>
                <span className="text-slate-500">⬇⬇</span> {tl("Manda in secondo piano")}
              </button>
              <div className="mx-2 my-1 h-px bg-slate-100" />
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">{tl("Azioni")}</div>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { duplicateItem(contextMenu.itemId!); closeContextMenu() }}>
                <span className="text-slate-500">⧉</span> {tl("Duplica")}
              </button>
              {isLockedByOther(contextMenu.itemId) && role === 'teacher' && (
                <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-amber-700 hover:bg-amber-50" onClick={() => { forceUnlockItem(contextMenu.itemId!); closeContextMenu() }}>
                  <span>🔓</span> {tl("Forza sblocco")}
                </button>
              )}
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50" onClick={() => { deleteItems([contextMenu.itemId!]); closeContextMenu() }}>
                <Trash2 className="h-3 w-3" /> {tl("Elimina")}
              </button>
            </>
          ) : (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">Canvas</div>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { fitToScreen(); closeContextMenu() }}>
                <Maximize2 className="h-3.5 w-3.5 text-slate-500" /> {tl("Adatta alla schermata")}
              </button>
              {role === 'teacher' && (
                <button type="button" className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50" onClick={() => { setShowTemplates(true); closeContextMenu() }}>
                  <LayoutTemplate className="h-3.5 w-3.5 text-slate-500" /> Template
                </button>
              )}
            </>
          )}
        </div>
      )}
      {/* Click-outside overlay to close context menu */}
      {contextMenu && (
        <div className="fixed inset-0 z-[199]" onMouseDown={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu() }} />
      )}

      {showAnimations && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowAnimations(false)}>
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b px-5 py-4">
              <h2 className="text-base font-semibold text-slate-800">{tl("Animazioni scientifiche")}</h2>
              <p className="text-sm text-slate-500">{tl("Scegli un esempio da inserire. Per crearne una nuova, chiedila all'assistente: «Fammi un'animazione di…».")}</p>
            </div>
            <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
              {DEMOS.map((demo) => (
                <button key={demo.key} type="button" className="overflow-hidden rounded-xl border border-slate-200 text-left transition hover:border-slate-400 hover:shadow-md"
                  onClick={() => {
                    const rect = containerRef.current?.getBoundingClientRect()
                    const centre = rect ? toWorld(rect.left + rect.width / 2, rect.top + rect.height / 2) : { x: 300, y: 200 }
                    const item: CanvasItem = { id: mkId(), type: 'animation', x: centre.x - 320, y: centre.y - 180, w: 640, h: 360, scene: demo.scene }
                    setCanvasDoc((prev) => ({ ...prev, items: [...prev.items, item] }))
                    setSelectedId(item.id); setSelectedIds([item.id]); setShowAnimations(false)
                  }}>
                  <MotionFrame scene={demo.scene} time={demo.scene.duration * 0.4} className="aspect-video w-full" />
                  <div className="p-3"><div className="text-sm font-bold text-slate-900">{demo.title}</div><div className="text-xs text-slate-500">{demo.description}</div></div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Templates modal ─────────────────────────────────────────────── */}
      {showTemplates && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowTemplates(false)}>
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b px-5 py-4">
              <h2 className="text-base font-semibold text-slate-800">{tl("Scegli un template")}</h2>
              <p className="text-sm text-slate-500">{tl("Il contenuto attuale della lavagna sarà sostituito.")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-3">
              {/* Blank */}
              <button
                type="button"
                onClick={() => applyTemplate(EMPTY_CANVAS)}
                className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-slate-200 p-4 text-center transition-colors hover:border-slate-400 hover:bg-slate-50"
              >
                <span className="text-2xl">📄</span>
                <span className="text-sm font-medium text-slate-700">{tl("Lavagna vuota")}</span>
                <span className="text-xs text-slate-500">{tl("Inizia da zero")}</span>
              </button>
              {TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  onClick={() => applyTemplate(tpl.create())}
                  className="flex flex-col items-center gap-2 rounded-xl border-2 border-slate-100 p-4 text-center transition-colors hover:border-blue-300 hover:bg-blue-50"
                >
                  <span className="text-2xl">{tpl.emoji}</span>
                  <span className="text-sm font-medium text-slate-700">{tpl.name}</span>
                  <span className="text-xs text-slate-500">{tpl.description}</span>
                </button>
              ))}
            </div>
            <div className="border-t px-5 py-3 text-right">
              <Button variant="ghost" size="sm" onClick={() => setShowTemplates(false)}>{tl("Annulla")}</Button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
})
