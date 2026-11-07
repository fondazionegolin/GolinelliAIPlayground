import { useQuery } from '@tanstack/react-query'
import { Music } from '@/components/icons'
import { voiceLabApi } from '@/lib/voiceLab'

/** Cover images are private: fetch them with the app session and show them through an object URL. */
export function useCoverUrl(url?: string | null) {
  return useQuery({ queryKey: ['audio-cover', url], enabled: !!url, staleTime: Infinity, gcTime: 30 * 60 * 1000, retry: false,
    queryFn: async () => URL.createObjectURL((await voiceLabApi.cover(url!)).data) }).data
}

/** Square cover with a neutral placeholder when the track has none. */
export function AudioCover({ url, className = '', iconClassName = 'h-1/3 w-1/3' }: { url?: string | null; className?: string; iconClassName?: string }) {
  const src = useCoverUrl(url)
  return <div aria-hidden="true" className={`relative aspect-square shrink-0 overflow-hidden bg-[var(--ds-field-bg,#191b1e)] ${className}`}>
    {src ? <img src={src} alt="" draggable={false} className="h-full w-full object-cover" />
      : <div className="flex h-full w-full items-center justify-center text-[var(--text-secondary)]"><Music className={iconClassName} /></div>}
  </div>
}
