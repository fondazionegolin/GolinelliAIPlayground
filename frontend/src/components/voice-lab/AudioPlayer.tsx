import { Play } from '@/components/icons'
import { Button } from '@/design'
import { useBackgroundAudio } from './BackgroundAudio'
import type { AudioTrack, AudioLoader } from '@/lib/audioPlayback'
import { tl } from '@/i18n/tl'

export type { AudioTrack, AudioLoader } from '@/lib/audioPlayback'

/** An entry point to the persistent navbar player, never a second audio element. */
export function AudioPlayer({ tracks, load, queue = true }: { tracks: AudioTrack[]; load: AudioLoader; queue?: boolean }) {
  const player = useBackgroundAudio()
  if (!tracks.length) return <p className="text-sm text-[var(--text-secondary)]">{tl('Aggiungi delle tracce per iniziare ad ascoltare.')}</p>
  return <div className="space-y-1 text-[var(--text-primary)]">
    {(queue ? tracks : tracks.slice(0, 1)).map((track, index) => <Button key={track.id} tone="neutral" surface="solid" className="max-w-full !justify-start" aria-label={tl('Riproduci {0}', track.title)} onClick={() => player.playTracks(tracks, load, index)}>
      <Play className="h-4 w-4 shrink-0" /><span className="truncate">{track.title}</span>
    </Button>)}
  </div>
}
