/** A boundary is an insertion slot in the original deck, including the slot after its last slide. */
export function reorderSlides<T extends { id: string }>(slides: T[], movingIds: string[], boundary: number): T[] {
  const selected = new Set(movingIds)
  const moving = slides.filter(slide => selected.has(slide.id))
  if (!moving.length) return slides
  const slot = Math.max(0, Math.min(slides.length, boundary))
  const insertion = slides.slice(0, slot).filter(slide => !selected.has(slide.id)).length
  const remaining = slides.filter(slide => !selected.has(slide.id))
  const result = [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)]
  return result.every((slide, index) => slide === slides[index]) ? slides : result
}

const positionKey = (viewer: string, documentId: string) => `documents:last-slide:${viewer}:${documentId}`

export function rememberSlide(viewer: string, documentId: string, slideId: string, index: number) {
  try {
    localStorage.setItem(positionKey(viewer, documentId), JSON.stringify({ slideId, index }))
  } catch { /* Private browsing or full storage must not interrupt editing. */ }
}

export function recalledSlideIndex(viewer: string, documentId: string, slides: { id: string }[]): number {
  try {
    const saved = JSON.parse(localStorage.getItem(positionKey(viewer, documentId)) || 'null')
    if (!saved) return 0
    const found = slides.findIndex(slide => slide.id === saved.slideId)
    if (found >= 0) return found
    return Number.isInteger(saved.index) ? Math.max(0, Math.min(saved.index, slides.length - 1)) : 0
  } catch { return 0 }
}
