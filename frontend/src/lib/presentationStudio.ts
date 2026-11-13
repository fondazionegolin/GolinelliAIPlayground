import api from '@/lib/api'
import type { SlideBlock } from '@/components/SlideEditor'
import { tl } from '@/i18n/tl'
import { getApiAuthHeaders } from '@/lib/api'
import { LANG_STORAGE_KEY, normalizeLanguageCode } from '@/i18n/i18n'
import { getResponseLength } from '@/lib/responseLength'
import { followJobStream, notifyJobsChanged, readEventStream } from '@/lib/backgroundJobs'

/** Presentation Studio: outline (AI) → style (curated templates) → deterministic render.
 * See backend/app/services/presentation_studio.py. */

export type StudioLayout =
  | 'cover' | 'section' | 'title_bullets' | 'two_column' | 'cards' | 'image_split'
  | 'big_stat' | 'timeline' | 'quote' | 'summary'
  | 'icon_cards' | 'image_full' | 'editorial'

export type StudioDensity = 'essenziale' | 'bilanciata' | 'dettagliata'

export interface StudioBrief {
  topic: string
  audience: string
  goal: string
  tone: string
  slide_count: number
  density: StudioDensity
  source_text: string
}

export interface OutlineSlide {
  id: string
  layout: StudioLayout
  title: string
  subtitle: string
  points: string[]
  points_right: string[]
  left_label: string
  right_label: string
  stat_value: string
  stat_label: string
  quote: string
  attribution: string
  image_prompt: string
  icons?: string[]
  notes: string
}

export interface StudioOutline {
  title: string
  subtitle: string
  audience: string
  core_message: string
  recommended_templates: { id: string; reason: string }[]
  slides: OutlineSlide[]
}

export interface ThemeOptions {
  font: 'theme' | 'leggibile' | 'serif' | 'moderno'
  accent: string | null
  large_text: boolean
  slide_numbers: boolean
  images: boolean
  /** Dark version of a light theme (same dark background on every slide). */
  dark: boolean
}

export interface ResolvedTheme {
  id: string
  name: string
  description: string
  brightness: 'light' | 'dark'
  moods: string[]
  motif: string
  cover: string
  colors: Record<string, string>
  fonts: { heading: string; body: string }
  options: ThemeOptions
}

/** What a deck stores: the theme id + options; colours are always re-resolved server-side. */
export interface DeckTheme { id: string; options: Partial<ThemeOptions> }

export interface QualityIssue {
  code: 'low_contrast' | 'low_contrast_inline' | 'off_canvas' | 'degenerate_shape' | 'invisible_shape' | 'empty_text' | 'overflow'
  slide_index: number
  block_id: string | null
  message: string
  fixed: boolean
}

export interface StudioSlide {
  id: string
  title: string
  speakerNotes?: string
  layout?: StudioLayout
  content?: Record<string, unknown>
  customized?: boolean
  blocks: SlideBlock[]
}

export interface RenderedDeck {
  title: string
  format: '16:9' | '4:3'
  theme: DeckTheme
  resolved_theme: ResolvedTheme
  slides: StudioSlide[]
  quality: QualityIssue[]
}

export const LAYOUT_LABELS: Record<StudioLayout, string> = {
  cover: tl("Copertina"),
  section: tl("Divisore di sezione"),
  title_bullets: tl("Titolo ed elenco"),
  cards: tl("Schede (2–4 concetti)"),
  icon_cards: tl("Schede con icone"),
  image_full: tl("Immagine a piena pagina"),
  editorial: tl("Editoriale su carta"),
  two_column: tl("Due colonne / confronto"),
  timeline: tl("Sequenza / processo"),
  big_stat: tl("Dato in evidenza"),
  quote: tl("Citazione"),
  image_split: tl("Testo e immagine"),
  summary: tl("Sintesi finale"),
}

/** Which outline fields each layout shows (mirrors presentation_layouts.LAYOUTS). */
export const LAYOUT_FIELDS: Record<StudioLayout, (keyof OutlineSlide)[]> = {
  cover: ['title', 'subtitle'],
  section: ['title', 'subtitle'],
  title_bullets: ['title', 'subtitle', 'points'],
  cards: ['title', 'points'],
  icon_cards: ['title', 'points', 'icons'],
  image_full: ['title', 'subtitle', 'image_prompt'],
  editorial: ['title', 'subtitle', 'points'],
  two_column: ['title', 'left_label', 'points', 'right_label', 'points_right'],
  timeline: ['title', 'points'],
  big_stat: ['stat_value', 'stat_label', 'subtitle'],
  quote: ['quote', 'attribution'],
  image_split: ['title', 'points', 'image_prompt'],
  summary: ['title', 'points'],
}

export const DEFAULT_THEME_OPTIONS: ThemeOptions = {
  font: 'theme', accent: null, large_text: false, slide_numbers: true, images: true, dark: false,
}

export const emptyOutlineSlide = (layout: StudioLayout = 'title_bullets'): OutlineSlide => ({
  id: crypto.randomUUID(), layout, title: '', subtitle: '', points: [], points_right: [], left_label: '', right_label: '',
  stat_value: '', stat_label: '', quote: '', attribution: '', image_prompt: '', icons: [], notes: '',
})

type Dims = { width: number; height: number }

/** Events of the multi-agent outline pipeline (backend presentation_agents.py), NDJSON. */
export type OutlineStreamEvent =
  | { type: 'phase'; phase: 'read' | 'plan' | 'revise'; label: string; progress: number }
  | { type: 'plan'; label: string; progress: number; title: string; slides: { index: number; layout: StudioLayout; title: string }[] }
  | { type: 'slide'; index: number; slide: OutlineSlide; degraded: boolean; label: string; progress: number }
  | { type: 'done'; progress: number; outline: StudioOutline; degraded: number; recovered_plan?: boolean }
  | { type: 'error'; detail?: string; message?: string }

export class OutlineStreamError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}

const streamHeaders = (): Record<string, string> => {
  let bearer: Record<string, string> = {}
  try {
    const token = JSON.parse(localStorage.getItem('eduai-auth') || 'null')?.state?.accessToken
    if (token) bearer = { Authorization: `Bearer ${token}` }
  } catch { /* no teacher session */ }
  const language = normalizeLanguageCode(localStorage.getItem(LANG_STORAGE_KEY))
  return {
    'Content-Type': 'application/json', ...bearer, ...getApiAuthHeaders(),
    'Accept-Language': language, 'X-App-Language': language, 'X-Response-Length': getResponseLength(),
  }
}

/** Start (or, with `replayJobId`, re-attach to) the streamed outline job and feed every event to `onEvent`.
 * The job keeps running server-side if the user leaves; the stream stays alive so proxies never time out. */
export async function streamOutline(
  data: { brief: StudioBrief; mode: 'create' | 'revise'; outline?: StudioOutline; instruction?: string; llm_provider?: string; llm_model?: string },
  onEvent: (event: OutlineStreamEvent) => void,
  opts: { signal?: AbortSignal; replayJobId?: string; onJobId?: (id: string) => void } = {},
): Promise<void> {
  const response = opts.replayJobId
    ? await followJobStream(opts.replayJobId, opts.signal)
    : await fetch('/api/v1/presentation-studio/outline-stream', {
      method: 'POST', credentials: 'include', signal: opts.signal, headers: streamHeaders(), body: JSON.stringify(data),
    })
  if (!response.ok || !response.body) {
    const body = await response.json().catch(() => null)
    throw new OutlineStreamError(typeof body?.detail === 'string' ? body.detail : tl("Errore {0}", response.status), response.status)
  }
  const jobId = response.headers.get('X-Job-Id')
  if (jobId) { opts.onJobId?.(jobId); notifyJobsChanged() }
  let finished = false
  await readEventStream(response, 'ndjson', (event) => {
    if (event?.type === 'error') throw new OutlineStreamError(String(event.detail || event.message || tl("Errore")))
    if (event?.type === 'done') finished = true
    onEvent(event as OutlineStreamEvent)
  })
  notifyJobsChanged()
  if (!finished) throw new OutlineStreamError(tl("Connessione interrotta: la generazione continua in background, riprova a riaprire tra poco."))
}

export const MAX_STUDIO_SOURCE_CHARS = 1_000_000
export const MAX_STUDIO_SOURCE_BYTES = 10 * 1024 * 1024
export const STUDIO_SOURCE_ACCEPT = '.md,.markdown,.txt,.text,.rst,.pdf,.docx'

/** Append atomically: a rejected upload must never erase or silently truncate existing notes. */
export function appendStudioSources(current: string, sources: { filename: string; text: string }[]): string {
  const combined = [current.trim(), ...sources.map(source => `# File: ${source.filename}\n\n${source.text}`)].filter(Boolean).join('\n\n---\n\n')
  if (combined.length > MAX_STUDIO_SOURCE_CHARS) throw new Error(tl("I materiali superano il limite di un milione di caratteri. Dividili in più presentazioni."))
  return combined
}

export const presentationStudioApi = {
  importSource: (file: File, signal?: AbortSignal) => {
    const form = new FormData()
    form.append('file', file)
    return api.post<{ filename: string; text: string; char_count: number; max_chars: number }>('/presentation-studio/source', form, {
      signal, timeout: 120000, headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  templates: () =>
    api.get<{ themes: ResolvedTheme[]; layouts: { id: StudioLayout; label: string; fields: string[] }[] }>('/presentation-studio/templates'),
  outline: (data: { brief: StudioBrief; mode?: 'create' | 'revise' | 'slide'; outline?: StudioOutline; instruction?: string; slide_index?: number; llm_provider?: string; llm_model?: string }, signal?: AbortSignal) =>
    api.post<StudioOutline>('/presentation-studio/outline', data, { signal, timeout: 240000 }),
  preview: (data: { outline: StudioOutline; theme_ids: string[]; options: Partial<ThemeOptions>; dims: Dims; slide_indexes: number[] }) =>
    api.post<{ previews: Record<string, StudioSlide[]> }>('/presentation-studio/preview', data),
  render: (data: { outline: StudioOutline; theme_id: string; options: Partial<ThemeOptions>; format: '16:9' | '4:3'; dims: Dims }) =>
    api.post<RenderedDeck>('/presentation-studio/render', data),
  retheme: (data: { slides: StudioSlide[]; theme_id: string; options: Partial<ThemeOptions>; dims: Dims }) =>
    api.post<{ theme: DeckTheme; resolved_theme: ResolvedTheme; slides: StudioSlide[]; quality: QualityIssue[] }>('/presentation-studio/retheme', data),
  image: (data: { prompt: string; deck_title: string; slide_title: string; theme?: DeckTheme | null }, signal?: AbortSignal) =>
    api.post<{ url: string }>('/presentation-studio/images', data, { signal, timeout: 180000 }),
  quality: (data: { slides: StudioSlide[]; theme?: DeckTheme | null; dims: Dims; fix: boolean }) =>
    api.post<{ issues: QualityIssue[]; slides: StudioSlide[] | null }>('/presentation-studio/quality', data),
  newSlide: (data: { description: string; deck_title: string; theme: DeckTheme; index: number; dims: Dims; context: { title: string; text: string }[] }) =>
    api.post<{ slide: StudioSlide }>('/presentation-studio/new-slide', data, { timeout: 120000 }),
}


/**
 * A new slide at `index`, in the deck's own look. Studio decks (they carry a theme) get a slide rendered in that
 * theme (written by the model from `description` when given) and the later slides are re-rendered so their
 * numbers stay right. Decks without a theme (imported/hand-made) get an empty slide that repeats the
 * neighbour's background so it doesn't stand out.
 */
export async function createSlideAt(
  deck: { title: string; theme?: DeckTheme | null; slides: StudioSlide[] },
  index: number,
  description: string,
  dims: Dims,
): Promise<{ slides: StudioSlide[]; themed: boolean }> {
  const at = Math.max(0, Math.min(index, deck.slides.length))
  let fresh: StudioSlide
  let themed = false
  if (deck.theme?.id) {
    const near = deck.slides.slice(Math.max(0, at - 3), at + 3).map(slide => ({
      title: slide.title,
      text: plainText(slide.blocks.filter(block => block.type === 'text').map(block => block.content).join(' ')).slice(0, 400),
    }))
    const { data } = await presentationStudioApi.newSlide({ description, deck_title: deck.title, theme: deck.theme, index: at, dims, context: near })
    fresh = data.slide
    themed = true
  } else {
    const model = deck.slides[Math.max(0, at - 1)] ?? deck.slides[0]
    const background = (model?.blocks || []).filter(block => block.locked && block.width >= dims.width * 0.9 && block.height >= dims.height * 0.85)
    fresh = {
      id: crypto.randomUUID(),
      title: `Slide ${at + 1}`,
      blocks: background.map(block => ({ ...block, id: crypto.randomUUID() })),
      ...((model as StudioSlide & { backgroundColor?: string })?.backgroundColor ? { backgroundColor: (model as StudioSlide & { backgroundColor?: string }).backgroundColor } : {}),
    } as StudioSlide
  }
  let slides = [...deck.slides.slice(0, at), fresh, ...deck.slides.slice(at)]
  if (themed && at < slides.length - 1) {
    try {
      const { data } = await presentationStudioApi.retheme({ slides, theme_id: deck.theme!.id, options: deck.theme!.options ?? {}, dims })
      const later = new Map(data.slides.map(slide => [slide.id, slide]))
      slides = slides.map((slide, position) => position > at && later.has(slide.id) ? later.get(slide.id)! : slide)
    } catch { /* numbering of later slides stays as it was */ }
  }
  return { slides, themed }
}

// ── Style questions → template ranking (deterministic, client-side) ──────────

export type StyleAnswers = {
  venue: 'lim' | 'buio' | 'stampa' | 'online' | null
  mood: 'istituzionale' | 'vivace' | 'essenziale' | 'accogliente' | null
  readability: 'standard' | 'alta'
}

export const STYLE_QUESTIONS = [
  {
    key: 'venue' as const,
    question: tl("Dove verrà mostrata?"),
    options: [
      { value: 'lim', label: tl("LIM / aula luminosa") },
      { value: 'buio', label: tl("Proiettore in sala buia") },
      { value: 'stampa', label: tl("Stampata o in PDF") },
      { value: 'online', label: tl("Condivisa online") },
    ],
  },
  {
    key: 'mood' as const,
    question: tl("Che atmosfera cerchi?"),
    options: [
      { value: 'istituzionale', label: tl("Istituzionale") },
      { value: 'vivace', label: tl("Vivace") },
      { value: 'essenziale', label: tl("Essenziale") },
      { value: 'accogliente', label: tl("Accogliente") },
    ],
  },
  {
    key: 'readability' as const,
    question: tl("Serve alta leggibilità (DSA, ipovisione, aula grande)?"),
    options: [
      { value: 'standard', label: 'Standard' },
      { value: 'alta', label: tl("Sì, alta leggibilità") },
    ],
  },
]

export function rankThemes(themes: ResolvedTheme[], answers: StyleAnswers, recommended: { id: string }[]): ResolvedTheme[] {
  const score = (theme: ResolvedTheme) => {
    let value = 0
    const aiRank = recommended.findIndex(item => item.id === theme.id)
    if (aiRank >= 0) value += 6 - aiRank * 1.5
    if (answers.venue === 'lim' || answers.venue === 'stampa') value += theme.brightness === 'light' ? 3 : -6
    if (answers.venue === 'buio') value += theme.brightness === 'dark' ? 4 : 0
    if (answers.venue === 'stampa' && theme.id === 'essenziale') value += 2
    if (answers.mood && theme.moods.includes(answers.mood)) value += 4
    if (answers.readability === 'alta') value += theme.id === 'alta_leggibilita' ? 6 : theme.moods.includes('leggibilita') ? 3 : 0
    return value
  }
  return [...themes].sort((a, b) => score(b) - score(a))
}

/** Options implied by the answers (the user can still change them). */
export function optionsFromAnswers(answers: StyleAnswers, current: ThemeOptions): ThemeOptions {
  return {
    ...current,
    dark: answers.venue === 'buio' ? true : answers.venue === 'lim' || answers.venue === 'stampa' ? false : current.dark,
    large_text: answers.readability === 'alta' ? true : current.large_text,
    font: answers.readability === 'alta' && current.font === 'theme' ? 'leggibile' : current.font,
  }
}

export const QUALITY_LABELS: Record<QualityIssue['code'], string> = {
  low_contrast: tl("Testo poco leggibile"),
  low_contrast_inline: tl("Colore del testo illeggibile"),
  off_canvas: tl("Oggetto fuori dalla slide"),
  degenerate_shape: tl("Forma vuota o minuscola"),
  invisible_shape: tl("Forma invisibile"),
  empty_text: tl("Casella di testo vuota"),
  overflow: tl("Testo che esce dalla casella"),
}

// ── Manual-edit tracking ─────────────────────────────────────────────────────

const plainText = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

/** What a user can visibly change by hand. Font size is excluded on purpose: the editor's own
 * overflow auto-fit adjusts it on load, which must not count as a manual edit. */
const blocksSignature = (blocks: SlideBlock[]) => JSON.stringify(blocks.map(block => [
  block.type, Math.round(block.x), Math.round(block.y), Math.round(block.width), Math.round(block.height), Boolean(block.hidden),
  block.type === 'text' ? plainText(block.content) : block.content,
  'color' in block.style ? block.style.color : null, 'fill' in block.style ? block.style.fill : null,
]))

/** Replace a slide's blocks; a Studio slide (layout + content) edited by hand becomes `customized`,
 * so later AI edits and theme switches preserve those edits instead of re-rendering from content. */
export function withSlideBlocks<T extends { blocks: SlideBlock[]; layout?: string; customized?: boolean }>(slide: T, blocks: SlideBlock[]): T {
  if (!slide.layout || slide.customized || blocksSignature(slide.blocks) === blocksSignature(blocks)) return { ...slide, blocks }
  return { ...slide, blocks, customized: true }
}


// ── Contextual images ────────────────────────────────────────────────────────

type ImageSlot = { slideId: string; slideTitle: string; blockId: string; prompt: string }

/** Image slots still showing the generated placeholder (prompt known, no real picture yet). */
export function pendingImageSlots(slides: StudioSlide[]): ImageSlot[] {
  return slides.flatMap(slide => slide.blocks
    .filter(block => block.type === 'image' && (block as SlideBlock & { imagePrompt?: string }).imagePrompt && block.content.includes('placehold.co'))
    .map(block => ({ slideId: slide.id, slideTitle: slide.title, blockId: block.id, prompt: String((block as SlideBlock & { imagePrompt?: string }).imagePrompt) })))
}

/** Generate the pending illustrations (3 at a time); `onImage` is called as each one arrives so the
 * caller can patch its own, possibly already edited, copy of the deck. Failures keep the placeholder. */
export async function generateDeckImages(
  slides: StudioSlide[],
  context: { deckTitle: string; theme?: DeckTheme | null },
  onImage: (slot: ImageSlot, url: string) => void,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<{ generated: number; failed: number }> {
  const slots = pendingImageSlots(slides)
  let next = 0
  let done = 0
  let failed = 0
  onProgress?.(0, slots.length)
  const worker = async () => {
    while (next < slots.length && !signal?.aborted) {
      const slot = slots[next++]
      try {
        const response = await presentationStudioApi.image({ prompt: slot.prompt, deck_title: context.deckTitle, slide_title: slot.slideTitle, theme: context.theme }, signal)
        onImage(slot, response.data.url)
      } catch (error: any) {
        failed += 1
        if (error?.response?.status === 402) next = slots.length // out of credits: stop trying
      }
      done += 1
      onProgress?.(done, slots.length)
    }
  }
  await Promise.all([worker(), worker(), worker()])
  return { generated: done - failed, failed }
}

export function withImage<T extends { id: string; blocks: SlideBlock[] }>(slides: T[], slideId: string, blockId: string, url: string): T[] {
  return slides.map(slide => slide.id !== slideId ? slide : {
    ...slide,
    blocks: slide.blocks.map(block => block.id === blockId && block.type === 'image' ? { ...block, content: url } : block),
  })
}
