import type { SlideBlock } from '@/components/SlideEditor'
import { applyBlockGroupReplacement } from '@/lib/slideBlocks'
import type { StudioSlide } from '@/lib/presentationStudio'

type PreviewSlide = StudioSlide & { backgroundColor?: string }

/** One slide as it is now and as it would be after the proposal (null = doesn't exist on that side). */
export interface SlidePair {
  /** 1-based position in the deck (the new position for added slides). */
  position: number
  before: PreviewSlide | null
  after: PreviewSlide | null
}

const signature = (slide: PreviewSlide | null) => slide ? JSON.stringify({ t: slide.title, b: slide.backgroundColor, k: slide.blocks }) : ''

/**
 * What a slide proposal will change, slide by slide, computed the same way the editor applies it — so the preview
 * is the real result. Only slides that differ are returned. Null when the proposal isn't about slides.
 */
export function slideProposalPairs(proposal: Record<string, unknown>, slides: PreviewSlide[], currentSlideIndex = 0): SlidePair[] | null {
  const context = (proposal.client_context && typeof proposal.client_context === 'object' ? proposal.client_context : {}) as Record<string, unknown>
  const slideIndex = typeof context.slide_index === 'number' ? context.slide_index : currentSlideIndex
  const changed = (pairs: SlidePair[]) => pairs.filter(pair => signature(pair.before) !== signature(pair.after))

  if (proposal.kind === 'slide_block' && proposal.replacement_block && typeof proposal.replacement_block === 'object') {
    const slide = slides[slideIndex]
    const blockId = typeof context.block_id === 'string' ? context.block_id : null
    if (!slide || !blockId) return null
    const replacement = proposal.replacement_block as SlideBlock
    const after = { ...slide, blocks: slide.blocks.map(block => block.id === blockId ? { ...replacement, id: block.id, zIndex: block.zIndex } as SlideBlock : block) }
    return changed([{ position: slideIndex + 1, before: slide, after }])
  }

  if (proposal.kind === 'slide_blocks' && Array.isArray(proposal.replacement_blocks)) {
    const slide = slides[slideIndex]
    const groupIds = Array.isArray(context.block_ids) ? context.block_ids.filter((id): id is string => typeof id === 'string') : []
    if (!slide || !groupIds.length) return null
    const after = { ...slide, blocks: applyBlockGroupReplacement(slide.blocks, groupIds, proposal.replacement_blocks as SlideBlock[]) }
    return changed([{ position: slideIndex + 1, before: slide, after }])
  }

  if (proposal.kind === 'slide' && proposal.replacement_slide && typeof proposal.replacement_slide === 'object') {
    const slide = slides[slideIndex]
    if (!slide) return null
    const after = { ...(proposal.replacement_slide as PreviewSlide), id: slide.id }
    return changed([{ position: slideIndex + 1, before: slide, after }])
  }

  if (proposal.kind === 'presentation' && proposal.replacement_presentation && typeof proposal.replacement_presentation === 'object') {
    const replacement = (proposal.replacement_presentation as { slides?: PreviewSlide[] }).slides
    if (!Array.isArray(replacement) || !replacement.length) return null
    const selectedIds = Array.isArray(context.selected_slide_ids) ? context.selected_slide_ids.filter((id): id is string => typeof id === 'string') : []
    if (selectedIds.length > 1) {
      return changed(selectedIds.flatMap((id, i) => {
        const index = slides.findIndex(slide => slide.id === id)
        const next = replacement[i]
        return index >= 0 && next ? [{ position: index + 1, before: slides[index], after: { ...next, id } }] : []
      }))
    }
    const byId = new Map(slides.map((slide, index) => [slide.id, { slide, index }]))
    const pairs: SlidePair[] = replacement.map((next, index) => ({ position: index + 1, before: byId.get(next.id)?.slide ?? null, after: next }))
    const kept = new Set(replacement.map(slide => slide.id))
    slides.forEach((slide, index) => { if (!kept.has(slide.id)) pairs.push({ position: index + 1, before: slide, after: null }) })
    return changed(pairs).sort((a, b) => a.position - b.position)
  }
  return null
}
