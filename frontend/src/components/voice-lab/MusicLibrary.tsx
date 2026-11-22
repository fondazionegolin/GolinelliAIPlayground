import { SearchPill } from '@/design/primitives/SearchPill'
import { useState } from 'react'
import { Button, IconButton } from '@/design'
import { Edit3, Loader2, Play, Plus, Sparkles } from '@/components/icons'
import { type LabItem } from '@/lib/voiceLab'
import { setDriveItemsDrag } from '@/lib/dragFiles'
import { tl } from '@/i18n/tl'
import { AudioCover } from './AudioCover'
import { RenameAudioDialog } from './RenameAudioDialog'

export function MusicLibrary({ items, loading, error, retry, onOpen, onPlay, onAdd, onCover, coverBusy, coveringId, coverCredits, configured }: {
  items: LabItem[]; loading: boolean; error: boolean; retry: () => void
  onOpen: (item: LabItem) => void; onPlay: (item: LabItem) => void; onAdd: (item: LabItem) => void; onCover: (id: string) => void
  coverBusy: boolean; coveringId?: string; coverCredits: number; configured: boolean
}) {
  const [search, setSearch] = useState(''), [renaming, setRenaming] = useState<LabItem | null>(null)
  const music = items.filter(item => item.kind === 'audio' && item.service === 'music')
  const rows = music.filter(item => `${item.title} ${item.artist_name || ''} ${item.details.text || ''}`.toLocaleLowerCase('it-IT').includes(search.toLocaleLowerCase('it-IT')))
  return <section className="ui-card voice-lab-music-library space-y-3 rounded-[var(--card-radius)] p-4" aria-label={tl('Libreria musicale')}>
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-base font-semibold">{tl('I tuoi brani')}</h2><p className="text-xs text-[var(--text-secondary)]">{tl('Trascina un brano nella playlist, oppure usa +')}</p></div><SearchPill aria-label={tl('Cerca un brano musicale')} placeholder={tl('Cerca un brano…')} value={search} onValueChange={setSearch} className="w-full sm:w-52" /></div>
    {loading && <p role="status" className="text-sm">{tl('Caricamento…')}</p>}
    {error && <p role="alert" className="text-sm">{tl('Impossibile caricare i brani.')} <Button tone="neutral" surface="ghost" onClick={retry}>{tl('Riprova')}</Button></p>}
    <div className="voice-lab-music-tracks ds-well overflow-y-auto rounded-2xl p-3"><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{rows.map(item => {
      const ready = item.status === 'ready'
      return <article key={item.id} draggable={ready} onDragStart={e => setDriveItemsDrag(e, [{ id: item.details.drive_item_id || item.id, name: item.title, kind: 'file', mime_type: item.mime_type }])} className="group min-w-0 cursor-grab space-y-2 active:cursor-grabbing">
        <div className="relative overflow-hidden rounded-2xl">
          <button type="button" className="block w-full text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={tl('Apri {0}', item.title)} onClick={() => onOpen(item)}><AudioCover url={item.cover_url} seed={item.title} className="w-full rounded-2xl transition-transform duration-200 group-hover:scale-[1.03]" iconClassName="h-8 w-8" /></button>
          <div className="pointer-events-none absolute inset-0 flex items-end justify-between gap-1 bg-gradient-to-t from-black/60 via-transparent to-transparent p-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
            <IconButton size="sm" tone="neutral" surface="glass" className="pointer-events-auto" aria-label={tl('Ascolta {0}', item.title)} disabled={!ready} onClick={() => onPlay(item)}>{ready ? <Play className="h-4 w-4" /> : <Loader2 className="h-4 w-4 animate-spin" />}</IconButton>
            <div className="pointer-events-auto flex gap-1">
              {!item.cover_url && <IconButton size="sm" tone="neutral" surface="glass" aria-label={tl('Crea copertina')} title={tl('Crea copertina · circa {0} crediti', coverCredits.toLocaleString('it-IT', { maximumFractionDigits: 2 }))} disabled={!configured || coverBusy} onClick={() => onCover(item.id)}>{coveringId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}</IconButton>}
              <IconButton size="sm" tone="neutral" surface="glass" aria-label={tl('Aggiungi {0} alla playlist', item.title)} title={tl('Aggiungi alla playlist')} disabled={!ready} onClick={() => onAdd(item)}><Plus className="h-4 w-4" /></IconButton>
            </div>
          </div>
        </div>
        <div className="flex min-w-0 items-start gap-1">
          <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-semibold" title={item.title}>{item.title}</h3>{item.artist_name && <p aria-label={tl('Artista: {0}', item.artist_name)} className="truncate text-xs text-[var(--text-secondary)]">{item.artist_name}</p>}</div>
          <IconButton size="sm" tone="neutral" surface="ghost" className="opacity-60 group-hover:opacity-100" aria-label={tl('Rinomina {0}', item.title)} onClick={() => setRenaming(item)}><Edit3 className="h-3.5 w-3.5" /></IconButton>
        </div>
      </article>
    })}</div></div>
    {!loading && !error && !rows.length && <p className="py-4 text-sm text-[var(--text-secondary)]">{tl(search ? 'Nessun brano trovato.' : 'La musica che crei comparirà qui.')}</p>}
    <RenameAudioDialog item={renaming} onClose={() => setRenaming(null)} />
  </section>
}
