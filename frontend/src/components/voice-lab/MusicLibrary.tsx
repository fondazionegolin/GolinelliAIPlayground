import { SearchPill } from '@/design/primitives/SearchPill'
import { useState } from 'react'
import { Button, IconButton } from '@/design'
import { Edit3, Loader2, Play, Sparkles } from '@/components/icons'
import { type LabItem } from '@/lib/voiceLab'
import { tl } from '@/i18n/tl'
import { AudioCover } from './AudioCover'
import { RenameAudioDialog } from './RenameAudioDialog'

export function MusicLibrary({ items, loading, error, retry, onOpen, onPlay, onCover, coverBusy, coveringId, coverCredits, configured }: {
  items: LabItem[]; loading: boolean; error: boolean; retry: () => void
  onOpen: (item: LabItem) => void; onPlay: (item: LabItem) => void; onCover: (id: string) => void
  coverBusy: boolean; coveringId?: string; coverCredits: number; configured: boolean
}) {
  const [search, setSearch] = useState(''), [renaming, setRenaming] = useState<LabItem | null>(null)
  const music = items.filter(item => item.kind === 'audio' && item.service === 'music')
  const rows = music.filter(item => `${item.title} ${item.artist_name || ''} ${item.details.text || ''}`.toLocaleLowerCase('it-IT').includes(search.toLocaleLowerCase('it-IT')))
  return <section className="ui-card space-y-4 rounded-[var(--card-radius)] p-5 sm:p-6" aria-label={tl('Libreria musicale')}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{tl('I tuoi brani')}</h2><SearchPill aria-label={tl('Cerca un brano musicale')} placeholder={tl('Cerca un brano…')} value={search} onValueChange={setSearch} className="w-full sm:w-64" /></div>
    {loading && <p role="status" className="text-sm">{tl('Caricamento…')}</p>}
    {error && <p role="alert" className="text-sm">{tl('Impossibile caricare i brani.')} <Button tone="neutral" surface="ghost" onClick={retry}>{tl('Riprova')}</Button></p>}
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{rows.map(item => <article key={item.id} className="min-w-0 space-y-3 rounded-2xl bg-[var(--ds-surface-muted)] p-3">
      <button type="button" className="block w-full rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" aria-label={tl('Apri {0}', item.title)} onClick={() => onOpen(item)}><AudioCover url={item.cover_url} className="w-full rounded-xl" /></button>
      <div className="flex items-start gap-1"><div className="min-w-0 flex-1"><h3 className="truncate font-semibold" title={item.title}>{item.title}</h3>{item.artist_name && <p aria-label={tl('Artista: {0}', item.artist_name)} className="mt-1 truncate text-xs text-[var(--text-secondary)]">{item.artist_name}</p>}</div><IconButton size="sm" tone="neutral" surface="ghost" aria-label={tl('Rinomina {0}', item.title)} onClick={() => setRenaming(item)}><Edit3 className="h-3.5 w-3.5" /></IconButton></div>
      <div className="flex flex-wrap gap-1"><Button tone="neutral" surface="ghost" density="compact" disabled={item.status !== 'ready'} onClick={() => onPlay(item)}><Play className="h-4 w-4" />{tl('Ascolta')}</Button>
        {!item.cover_url && <Button tone="neutral" surface="ghost" density="compact" title={tl('Circa {0} crediti', coverCredits.toLocaleString('it-IT', { maximumFractionDigits: 2 }))} disabled={!configured || coverBusy} onClick={() => onCover(item.id)}>{coveringId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{tl('Crea copertina')}</Button>}
      </div>
    </article>)}</div>
    {!loading && !error && !rows.length && <p className="py-4 text-sm text-[var(--text-secondary)]">{tl(search ? 'Nessun brano trovato.' : 'La musica che crei comparirà qui.')}</p>}
    <RenameAudioDialog item={renaming} onClose={() => setRenaming(null)} />
  </section>
}
