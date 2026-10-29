/** Contextual character illustrations for every teacher navigation section. */
const ART: Record<string, string> = {
  '/teacher': 'support',
  '/teacher/classes': 'classes',
  '/teacher/live-interaction': 'live-interaction',
  '/teacher/boards': 'boards',
  '/teacher/school': 'school',
  '/teacher/documents': 'documents',
  '/teacher/teacherbots': 'teacherbots',
  '/teacher/ai-3d': 'ai-3d',
  '/teacher/3d-lab': '3d-lab',
  '/teacher/coding': 'coding',
  '/teacher/notebooks': 'notebooks',
  '/teacher/ml-lab': 'ml-lab',
  '/teacher/toy-lm': 'toy-lm',
  '/teacher/files': 'files',
  '/teacher/agentic': 'agentic',
  '/teacher/video-studio': 'video-studio',
  '/teacher/visual-comprehension': 'visual-comprehension',
  '/teacher/feedback-board': 'feedback-board',
}

export function hasSectionArt(path: string) {
  return Object.prototype.hasOwnProperty.call(ART, path)
}

export function NavSectionArt({ path, className = '' }: { path: string; className?: string }) {
  const art = ART[path]
  if (!art) return null
  return (
    <span
      className={`flex shrink-0 items-center justify-center ${className}`}
      aria-hidden="true"
    >
      <img
        src={`/illustrations/nav/${art}.webp`}
        alt=""
        width={320}
        height={320}
        decoding="async"
        draggable={false}
        className="h-full w-full scale-[0.8] object-contain"
      />
    </span>
  )
}
