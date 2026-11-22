import { useQuery } from '@tanstack/react-query'
import { Music } from '@/components/icons'
import { voiceLabApi } from '@/lib/voiceLab'

/** Cover images are private: fetch them with the app session and show them through an object URL. */
export function useCoverUrl(url?: string | null) {
  return useQuery({ queryKey: ['audio-cover', url], enabled: !!url, staleTime: Infinity, gcTime: 30 * 60 * 1000, retry: false,
    queryFn: async () => URL.createObjectURL((await voiceLabApi.cover(url!)).data) }).data
}

/** Deterministic colour pair from the title, so tracks without a cover still look like distinct records. */
function placeholderGradient(seed: string) {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const hue = hash % 360
  return `linear-gradient(135deg, hsl(${hue} 42% 38%), hsl(${(hue + 48) % 360} 48% 22%))`
}

/** Square cover; without one it shows a coloured tile derived from `seed` (the track title) instead of a blank box. */
export function AudioCover({ url, className = '', iconClassName = 'h-1/3 w-1/3', seed }: { url?: string | null; className?: string; iconClassName?: string; seed?: string }) {
  const src = useCoverUrl(url)
  return <div aria-hidden="true" style={!src && seed ? { backgroundImage: placeholderGradient(seed) } : undefined} className={`relative aspect-square shrink-0 overflow-hidden bg-[var(--ds-field-bg,#191b1e)] ${className}`}>
    {src ? <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
      : <div className={`flex h-full w-full items-center justify-center ${seed ? 'text-white/70' : 'text-[var(--text-secondary)]'}`}><Music className={iconClassName} /></div>}
  </div>
}
