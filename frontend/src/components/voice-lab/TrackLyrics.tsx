import { useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Button, IconButton, Textarea } from '@/design'
import { Copy, Loader2, X } from '@/components/icons'
import { useToast } from '@/components/ui/use-toast'
import { voiceLabApi } from '@/lib/voiceLab'
import { tl } from '@/i18n/tl'

interface LyricsTrack { id: string; title: string; item_id?: string; lyrics?: string }

/** Lyrics of the playing song: stored when the song was written with lyrics, otherwise transcribed on request. */
export function TrackLyrics({ track, canTranscribe, onClose }: { track: LyricsTrack; canTranscribe: boolean; onClose: () => void }) {
  const ref = track.item_id || track.id
  const [lyrics, setLyrics] = useState(track.lyrics || ''), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false), [draft, setDraft] = useState('')
  const qc = useQueryClient(), { toast } = useToast()
  useEffect(() => { setLyrics(track.lyrics || ''); setEditing(false) }, [track.id, track.lyrics])
  const refresh = () => { for (const key of ['audio-files', 'voice-lab-playlists', 'voice-lab-items']) void qc.invalidateQueries({ queryKey: [key] }) }
  const fail = (error: unknown, title: string) => toast({ variant: 'destructive', title, description: (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail || tl('Riprova tra poco.') })
  const transcribe = async () => {
    setBusy(true)
    try { const { data } = await voiceLabApi.transcribeLyrics(ref); setLyrics(data.lyrics); refresh(); toast({ title: tl('Testo trascritto'), description: tl('{0} crediti', data.credits.toLocaleString('it-IT', { maximumFractionDigits: 2 })) }) }
    catch (error) { fail(error, tl('Trascrizione non riuscita')) }
    finally { setBusy(false) }
  }
  const save = async () => {
    setBusy(true)
    try { const { data } = await voiceLabApi.saveLyrics(ref, draft); setLyrics(data.lyrics); setEditing(false); refresh() }
    catch (error) { fail(error, tl('Testo non salvato')) }
    finally { setBusy(false) }
  }
  const copy = async () => { try { await navigator.clipboard.writeText(lyrics); toast({ title: tl('Testo copiato') }) } catch { toast({ variant: 'destructive', title: tl('Copia non riuscita') }) } }
  return <section aria-label={tl('Testo di {0}', track.title)} className="flex min-w-0 flex-col gap-2">
    <div className="flex items-center gap-2">
      <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{tl('Testo')} · {track.title}</h3>
      {lyrics && !editing && <IconButton tone="neutral" surface="ghost" aria-label={tl('Copia il testo')} onClick={() => void copy()}><Copy /></IconButton>}
      <IconButton tone="neutral" surface="ghost" aria-label={tl('Torna ai brani')} onClick={onClose}><X /></IconButton>
    </div>
    {editing ? <Textarea aria-label={tl('Testo del brano')} className="max-h-60 min-h-48 flex-1" value={draft} maxLength={6000} onChange={e => setDraft(e.target.value)} />
      : lyrics ? <pre className="max-h-60 min-h-24 flex-1 overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-relaxed">{lyrics}</pre>
      : <p className="min-h-24 flex-1 text-sm text-[var(--text-secondary)]">{canTranscribe ? tl('Questo brano non ha un testo salvato. Puoi trascriverlo ascoltandolo: costa pochi crediti.') : tl('Questo brano non ha un testo.')}</p>}
    {canTranscribe && <div className="flex flex-wrap gap-2">
      {editing ? <>
        <Button tone="accent" surface="solid" density="compact" disabled={busy} onClick={() => void save()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{tl('Salva')}</Button>
        <Button tone="neutral" surface="ghost" density="compact" disabled={busy} onClick={() => setEditing(false)}>{tl('Annulla')}</Button>
      </> : <>
        <Button tone="neutral" surface="ghost" density="compact" disabled={busy} onClick={() => void transcribe()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{tl(lyrics ? 'Trascrivi di nuovo' : 'Trascrivi il testo')}</Button>
        <Button tone="neutral" surface="ghost" density="compact" disabled={busy} onClick={() => { setDraft(lyrics); setEditing(true) }}>{tl(lyrics ? 'Modifica' : 'Scrivi a mano')}</Button>
      </>}
    </div>}
  </section>
}
