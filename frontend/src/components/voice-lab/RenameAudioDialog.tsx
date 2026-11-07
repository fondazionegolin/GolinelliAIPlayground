import { useEffect, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input } from '@/design'
import { voiceLabApi, type LabItem } from '@/lib/voiceLab'
import { useBackgroundAudio } from './BackgroundAudio'
import { tl } from '@/i18n/tl'

export function RenameAudioDialog({ item, onClose }: { item: LabItem | null; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const qc = useQueryClient(), player = useBackgroundAudio()
  const rename = useMutation({ mutationFn: async ({ item, title }: { item: LabItem; title: string }) => (await voiceLabApi.rename(item.id, title)).data,
    onSuccess: updated => {
      qc.setQueryData(['voice-lab-item', updated.id], updated)
      qc.setQueryData<LabItem[]>(['voice-lab-items'], rows => rows?.map(row => row.id === updated.id ? updated : row))
      player.updateTrack([updated.id, updated.details.drive_item_id || ''], { title: updated.title, artist_name: updated.artist_name })
      for (const key of ['voice-lab-items', 'audio-files', 'voice-lab-playlists', 'class-playback', 'drive']) void qc.invalidateQueries({ queryKey: [key] })
      onClose()
    } })
  useEffect(() => { setTitle(item?.title || ''); rename.reset() }, [item?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const detail = (rename.error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
  return <Dialog open={!!item} onOpenChange={open => { if (!open) onClose() }}><DialogContent size="sm">
    <DialogHeader><DialogTitle>{tl('Rinomina brano')}</DialogTitle></DialogHeader>
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (item && title.trim() && !rename.isPending) rename.mutate({ item, title: title.trim() }) }}>
      <label className="block space-y-2 text-sm font-semibold">{tl('Titolo del brano')}<Input autoFocus value={title} maxLength={200} disabled={rename.isPending} onChange={e => setTitle(e.target.value)} /></label>
      {rename.isError && <p role="alert" className="text-sm text-[var(--text-secondary)]">{typeof detail === 'string' ? detail : tl('Impossibile aggiornare il titolo. Riprova.')}</p>}
      <div className="flex justify-end gap-2"><Button type="button" tone="neutral" surface="ghost" onClick={onClose}>{tl('Annulla')}</Button><Button type="submit" tone="accent" surface="solid" disabled={!title.trim() || rename.isPending}>{tl(rename.isPending ? 'Salvataggio…' : 'Salva')}</Button></div>
    </form>
  </DialogContent></Dialog>
}
