import api from '@/lib/api'
import type { SlideBlock } from '@/components/SlideEditor'
import { tl } from '@/i18n/tl'

/** Presentation Studio: outline (AI) → style (curated templates) → deterministic render.
 * See backend/app/services/presentation_studio.py. */

export type StudioLayout =
  | 'cover' | 'section' | 'title_bullets' | 'two_column' | 'cards' | 'image_split'
  | 'big_stat' | 'timeline' | 'quote' | 'summary'

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
  stat_value: '', stat_label: '', quote: '', attribution: '', image_prompt: '', notes: '',
})

type Dims = { width: number; height: number }

export const presentationStudioApi = {
  templates: () =>
    api.get<{ themes: ResolvedTheme[]; layouts: { id: StudioLayout; label: string; fields: string[] }[] }>('/presentation-studio/templates'),
  outline: (data: { brief: StudioBrief; mode?: 'create' | 'revise' | 'slide'; outline?: StudioOutline; instruction?: string; slide_index?: number }, signal?: AbortSignal) =>
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
