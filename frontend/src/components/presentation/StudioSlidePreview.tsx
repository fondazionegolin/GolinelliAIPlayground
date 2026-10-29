import { memo, useMemo } from 'react'
import DocumentThumbnail from '@/components/documents/DocumentThumbnail'
import type { StudioSlide } from '@/lib/presentationStudio'

/** Read-only, exact render of one slide (same renderer as the documents grid). */
export const StudioSlidePreview = memo(function StudioSlidePreview({ slide, format }: { slide: StudioSlide; format: '16:9' | '4:3' }) {
  const contentJson = useMemo(() => JSON.stringify({ format, slides: [slide] }), [slide, format])
  return (
    <div className={`overflow-hidden rounded-md ${format === '4:3' ? 'aspect-[4/3]' : 'aspect-video'}`}>
      <DocumentThumbnail contentJson={contentJson} type="presentation" title={slide.title} showTypeBadge={false} className="h-full w-full" />
    </div>
  )
})
