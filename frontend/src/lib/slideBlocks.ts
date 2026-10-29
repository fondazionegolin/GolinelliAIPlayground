import type { BlockShapeType, ShapeSlideBlock, SlideBlock } from '@/components/SlideEditor'

/** Reassigns zIndex = array index for every block, keeping paint order gapless after any reorder. */
export function normalizeLayerOrder(blocks: SlideBlock[]): SlideBlock[] {
  return blocks.map((block, index) => ({ ...block, zIndex: index }))
}

export type LayerMoveAction = 'front' | 'back' | 'forward' | 'backward'

/** Moves one block front/back/forward/backward within paint order, shared by the canvas context menu and the layers panel. */
export function moveBlockLayer(blocks: SlideBlock[], blockId: string, action: LayerMoveAction): SlideBlock[] {
  const order = blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => (a.block.zIndex ?? a.index) - (b.block.zIndex ?? b.index))
    .map(({ block }) => block)
  const index = order.findIndex(block => block.id === blockId)
  if (index < 0) return blocks
  const [block] = order.splice(index, 1)
  const targetIndex =
    action === 'front' ? order.length :
    action === 'back' ? 0 :
    action === 'forward' ? Math.min(order.length, index + 1) :
    Math.max(0, index - 1)
  order.splice(targetIndex, 0, block)
  return normalizeLayerOrder(order)
}

/** Reorders blocks by moving one block to an arbitrary target index in paint order (used by layers-panel drag). */
export function reorderBlockLayer(blocks: SlideBlock[], blockId: string, targetIndex: number): SlideBlock[] {
  const order = blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => (a.block.zIndex ?? a.index) - (b.block.zIndex ?? b.index))
    .map(({ block }) => block)
  const fromIndex = order.findIndex(block => block.id === blockId)
  if (fromIndex < 0) return blocks
  const [block] = order.splice(fromIndex, 1)
  order.splice(Math.max(0, Math.min(order.length, targetIndex)), 0, block)
  return normalizeLayerOrder(order)
}

export function toggleBlockLocked(blocks: SlideBlock[], blockId: string): SlideBlock[] {
  return blocks.map(block => block.id === blockId ? { ...block, locked: !block.locked } : block)
}

export function toggleBlockHidden(blocks: SlideBlock[], blockId: string): SlideBlock[] {
  return blocks.map(block => block.id === blockId ? { ...block, hidden: !block.hidden } : block)
}

/** Shared default-construction for new shape blocks, used by both the teacher and student document pages. */
export function createShapeBlock(type: BlockShapeType, dims: { width: number; height: number }): ShapeSlideBlock {
  if (type === 'line') {
    return {
      id: crypto.randomUUID(),
      type: 'line',
      content: '',
      x: dims.width / 2 - 100,
      y: dims.height / 2,
      width: 200,
      height: 0,
      style: { stroke: '#262626', strokeWidth: 2 },
    }
  }

  return {
    id: crypto.randomUUID(),
    type,
    content: '',
    x: dims.width / 2 - 100,
    y: dims.height / 2 - 75,
    width: 200,
    height: 150,
    style: {
      fill: '#e5e5e5',
      stroke: '#262626',
      strokeWidth: 2,
      ...(type === 'rectangle' ? { cornerRadius: 8 } : {}),
    },
  }
}

const TEXT_STYLE_KEYS = new Set(['fontFamily', 'fontSize', 'color', 'fontWeight', 'fontStyle', 'textDecoration', 'textAlign', 'lineHeight', 'backgroundColor', 'padding', 'borderRadius'])
const SHAPE_STYLE_KEYS = new Set(['fill', 'stroke', 'strokeWidth', 'cornerRadius'])
/** Inline CSS property that would override each block-level text style. */
const INLINE_CSS: Record<string, string> = { fontFamily: 'font-family', fontSize: 'font-size', color: 'color', textAlign: 'text-align' }
/** Inline tags that would override each block-level text style. */
const INLINE_TAGS: Record<string, string[]> = { fontWeight: ['strong', 'b'], fontStyle: ['em', 'i'], textDecoration: ['u', 's'] }

/** Remove inline formatting for one property, so a style applied to the whole block really reaches
 * all of its text (a red span would otherwise stay red after colouring the block blue). */
export function clearInlineFormatting(html: string, key: string): string {
  const css = INLINE_CSS[key]
  const tags = INLINE_TAGS[key]
  if (!css && !tags) return html
  const root = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').body.firstElementChild as HTMLElement | null
  if (!root) return html
  if (css) {
    root.querySelectorAll<HTMLElement>('[style]').forEach(element => {
      element.style.removeProperty(css)
      if (!element.getAttribute('style')?.trim()) element.removeAttribute('style')
    })
  }
  if (tags) {
    root.querySelectorAll(tags.join(',')).forEach(element => element.replaceWith(...Array.from(element.childNodes)))
    if (key === 'textDecoration') {
      root.querySelectorAll<HTMLElement>('[style]').forEach(element => element.style.removeProperty('text-decoration'))
    }
  }
  return root.innerHTML
}

/** Apply one toolbar style to every selected block it makes sense for (text keys to text blocks,
 * shape keys to shapes, rotation to everything); text blocks drop conflicting inline formatting. */
export function applyStyleToBlocks(blocks: SlideBlock[], ids: string[], key: string, value: unknown): SlideBlock[] {
  const targets = new Set(ids)
  return blocks.map(block => {
    if (!targets.has(block.id) || block.locked && ids.length > 1) return block
    if (key === 'rotation') return { ...block, rotation: Number(value) || 0 }
    if (SHAPE_STYLE_KEYS.has(key)) {
      if (block.type !== 'rectangle' && block.type !== 'ellipse' && block.type !== 'line') return block
      if (key === 'cornerRadius' && block.type !== 'rectangle') return block
      if (key === 'fill' && block.type === 'line') return block
      return { ...block, style: { ...block.style, [key]: value } } as SlideBlock
    }
    if (TEXT_STYLE_KEYS.has(key)) {
      if (key === 'backgroundColor' && block.type === 'image') return { ...block, style: { ...block.style, backgroundColor: value as string } }
      if (block.type !== 'text') return block
      return { ...block, content: clearInlineFormatting(block.content, key), style: { ...block.style, [key]: value } } as SlideBlock
    }
    return { ...block, style: { ...block.style, [key]: value } } as SlideBlock
  })
}

/** Assistant target for a multi-selection: the group travels as one functional unit (e.g. a
 * numbered timeline made of circles, labels and connectors), with the rest of the slide as layout
 * context. Embedded image data is replaced by a marker, since it is restored on apply anyway. */
export function blockGroupAssistTarget(slide: { title: string; blocks: SlideBlock[] }, slideIndex: number, ids: string[]) {
  const group = new Set(ids)
  const compact = (block: SlideBlock) => block.type === 'image' && block.content.length > 300 ? { ...block, content: '[immagine]' } : block
  return {
    blocks: slide.blocks.filter(block => group.has(block.id)).map(compact),
    block_ids: ids,
    other_blocks: slide.blocks
      .filter(block => !group.has(block.id) && !block.hidden)
      .map(block => ({ type: block.type, x: Math.round(block.x), y: Math.round(block.y), width: Math.round(block.width), height: Math.round(block.height), ...(block.locked ? { locked: true } : {}) })),
    slide_index: slideIndex,
    slide_title: slide.title,
  }
}

/** Replace a multi-selected group with the assistant's proposal. Returned blocks that carry a group
 * member's id keep its identity, layer, lock/visibility and image data; blocks without a known id are
 * new and painted above; group members missing from the proposal are removed. */
export function applyBlockGroupReplacement(blocks: SlideBlock[], groupIds: string[], replacement: SlideBlock[]): SlideBlock[] {
  const group = new Set(groupIds)
  const originals = new Map(blocks.filter(block => group.has(block.id)).map(block => [block.id, block]))
  const kept = new Map<string, SlideBlock>()
  const added: SlideBlock[] = []
  for (const next of replacement) {
    const original = next.id ? originals.get(next.id) : undefined
    if (!original || kept.has(original.id)) {
      added.push({ ...next, id: crypto.randomUUID() })
      continue
    }
    kept.set(original.id, {
      ...next,
      id: original.id,
      zIndex: original.zIndex,
      locked: original.locked,
      hidden: original.hidden,
      ...(original.type === 'image' && next.type === 'image' ? { content: original.content } : {}),
    } as SlideBlock)
  }
  const ordered = blocks
    .map((block, index) => ({ block, index }))
    .sort((a, b) => (a.block.zIndex ?? a.index) - (b.block.zIndex ?? b.index))
    .flatMap(({ block }) => !group.has(block.id) ? [block] : kept.has(block.id) ? [kept.get(block.id)!] : [])
  return normalizeLayerOrder([...ordered, ...added])
}
