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
