import { useQuery } from '@tanstack/react-query'
import { PlaylistEditor, useBackgroundAudio } from './BackgroundAudio'
import { voiceLabApi, type LabItem } from '@/lib/voiceLab'
import { Button } from '@/design'
import { tl } from '@/i18n/tl'

export function SharedPlaylistPlayer({ playlistId }: { playlistId: string }) {
  const player = useBackgroundAudio()
  const playlist = useQuery({ queryKey: ['voice-playlist', playlistId], queryFn: async () => (await voiceLabApi.playlist(playlistId)).data, retry: false })
  if (playlist.isLoading) return <p role="status">{tl('Carico la playlist…')}</p>
  if (!playlist.data || playlist.isError) return <p role="alert">{tl('Playlist non disponibile o accesso rimosso.')}</p>
  return <Button tone="neutral" surface="solid" onClick={() => player.listen(playlist.data!)}>{tl('Ascolta in sottofondo')}</Button>
}

export function PlaylistWorkspace({ candidate }: { items: LabItem[]; candidate?: string }) {
  return <PlaylistEditor candidate={candidate} />
}
