import type { BlockShapeType, ShapeSlideBlock } from '@/components/SlideEditor'

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
      style: { stroke: '#1e293b', strokeWidth: 2 },
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
      fill: '#e2e8f0',
      stroke: '#1e293b',
      strokeWidth: 2,
      ...(type === 'rectangle' ? { cornerRadius: 8 } : {}),
    },
  }
}
