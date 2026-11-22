import { useEffect, useRef, useState, type DragEvent } from 'react'
import { AnimatePresence, Reorder } from 'framer-motion'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, IconButton, Input } from '@/design'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { GripVertical, Music, Plus, Play, X } from '@/components/icons'
import { useAuthStore } from '@/stores/auth'
import { voiceLabApi, type LabItem, type LabPlaylist } from '@/lib/voiceLab'
import { DRIVE_ITEM_MIME, type DraggedDriveItem } from '@/lib/dragFiles'
import { useBackgroundAudio } from './BackgroundAudio'
import { AudioCover } from './AudioCover'
import { tl } from '@/i18n/tl'

const accepts = (event: DragEvent) => Array.from(event.dataTransfer.types).includes(DRIVE_ITEM_MIME)

/** Playlist as a block of covers: rows reorder live under the pointer (animated), tracks dropped from the library join the list. */
export function MusicPlaylistPanel({ items, candidate, onCandidateAdded }: { items: LabItem[]; candidate?: string; onCandidateAdded: () => void }) {
  const player = useBackgroundAudio(), qc = useQueryClient()
  const userId = useAuthStore(s => s.user?.id)
  const key = ['voice-lab-playlists', `teacher:${userId}`]
  const lists = useQuery({ queryKey: key, queryFn: async () => (await voiceLabApi.playlists()).data })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [ids, setIds] = useState<string[]>([])
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('')
  const [over, setOver] = useState(false)
  const lock = useRef(false)
  const selected = lists.data?.find(p => p.id === selectedId)
  const choose = (p?: LabPlaylist) => { setSelectedId(p?.id || ''); setTitle(p?.title || ''); setIds(p?.tracks.map(t => t.source_item_id) || []); setDirty(false); setError('') }
  useEffect(() => { if (selectedId === null && lists.data) choose(lists.data[0]) }, [lists.data, selectedId])
  const add = (extra: string[]) => { setIds(current => [...new Set([...current, ...extra])].slice(0, 200)); setDirty(true) }
  useEffect(() => {
    if (candidate && selectedId !== null) { add([candidate]); onCandidateAdded() }
  }, [candidate, selectedId, onCandidateAdded])
  const metadata = (id: string) => {
    const item = items.find(v => (v.details.drive_item_id || v.id) === id)
    return item || selected?.tracks.find(t => t.source_item_id === id)
  }
  const persist = async (): Promise<LabPlaylist | undefined> => {
    if (lock.current) return
    lock.current = true; setSaving(true); setError('')
    try {
      const name = title.trim() || tl('La mia playlist')
      const { data } = selectedId ? await voiceLabApi.updatePlaylist(selectedId, name, ids) : await voiceLabApi.createPlaylist(name, ids)
      qc.setQueryData<LabPlaylist[]>(key, (rows = []) => [data, ...rows.filter(p => p.id !== data.id)])
      choose(data)
      if (player.personal?.id === data.id) player.remember(data)
      void qc.invalidateQueries({ queryKey: ['drive'] })
      return data
    } catch { setError(tl('Playlist non salvata. Riprova: le tue modifiche sono ancora qui.')) }
    finally { lock.current = false; setSaving(false) }
  }
  const switchTo = async (p?: LabPlaylist) => { if (p && p.id === selectedId) return; if (dirty && !await persist()) return; choose(p) }
  const drop = (event: DragEvent) => {
    event.preventDefault(); setOver(false)
    if (saving) return
    try {
      const raw = event.dataTransfer.getData(DRIVE_ITEM_MIME)
      if (raw) add((JSON.parse(raw) as DraggedDriveItem[]).filter(v => v.kind === 'file' && v.mime_type?.startsWith('audio/')).map(v => v.id))
    } catch { setError(tl('Impossibile aggiungere questo brano.')) }
  }
  const seconds = ids.reduce((sum, id) => sum + (((metadata(id) as LabItem | undefined)?.details?.duration_seconds) || 0), 0)
  const summary = [ids.length === 1 ? tl('1 brano') : tl('{0} brani', ids.length), seconds ? `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')} min` : ''].filter(Boolean).join(' · ')

  return <aside className="ui-card min-w-0 space-y-3 rounded-[var(--card-radius)] p-4 lg:sticky lg:top-5" aria-label={tl('Playlist musicale')}>
    <div className="flex items-center gap-2">
      <Music className="h-5 w-5 shrink-0 text-[var(--text-secondary)]" />
      <div className="min-w-0 flex-1"><SearchableSelect label={tl('Scegli una playlist')} value={selectedId || ''} disabled={saving || lists.isLoading} options={(lists.data || []).map(p => ({ value: p.id, label: p.title }))} onChange={id => void switchTo(lists.data?.find(p => p.id === id))} /></div>
      <Button density="compact" tone="neutral" surface="ghost" disabled={saving} onClick={() => void switchTo()}><Plus className="h-3.5 w-3.5" />{tl('Nuova')}</Button>
    </div>
    <label className="block space-y-1"><span className="sr-only">{tl('Nome della playlist')}</span>
      <Input value={title} maxLength={200} disabled={saving} placeholder={tl('La mia playlist')} className="text-base font-semibold" onChange={e => { setTitle(e.target.value); setDirty(true) }} /></label>
    <p className="px-1 text-xs text-[var(--text-secondary)]">{summary}</p>

    <div onDragOver={e => { if (accepts(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true) } }} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) }} onDrop={drop}
      className={`ds-well rounded-2xl p-2 transition-shadow duration-150 ${over ? 'shadow-[0_0_0_2px_var(--app-accent)]' : ''}`}>
      {ids.length > 0 && <Reorder.Group as="ol" axis="y" values={ids} onReorder={next => { if (!saving) { setIds(next); setDirty(true) } }} aria-label={tl('Brani nella playlist')} className="max-h-[420px] space-y-1.5 overflow-y-auto pr-0.5">
        <AnimatePresence initial={false}>
          {ids.map((id, index) => {
            const track = metadata(id), name = track?.title || tl('Brano non più disponibile')
            return <Reorder.Item as="li" key={id} value={id} dragListener={!saving} layout="position" initial={{ opacity: 0, scale: .96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .94 }}
              whileDrag={{ scale: 1.03, zIndex: 20, boxShadow: '0 14px 32px rgba(0,0,0,.35)' }} transition={{ type: 'spring', stiffness: 520, damping: 38 }}
              className="ds-well-tile group relative flex cursor-grab touch-none select-none items-center gap-3 rounded-2xl p-2 active:cursor-grabbing">
              <GripVertical aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--text-muted)] opacity-60" />
              <AudioCover url={track?.cover_url} seed={name} className="w-12 rounded-xl" iconClassName="h-5 w-5" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold" title={name}><span className="mr-1.5 text-xs font-medium text-[var(--text-secondary)]">{index + 1}</span>{name}</p>
                {track?.artist_name && <p className="truncate text-xs text-[var(--text-secondary)]">{track.artist_name}</p>}
              </div>
              <IconButton size="sm" tone="neutral" surface="ghost" className="opacity-60 transition-opacity group-hover:opacity-100 focus-visible:opacity-100" aria-label={tl('Rimuovi {0} dalla playlist', name)} disabled={saving} onPointerDownCapture={e => e.stopPropagation()}
                onClick={() => { setIds(current => current.filter(v => v !== id)); setDirty(true) }}><X className="h-3.5 w-3.5" /></IconButton>
            </Reorder.Item>
          })}
        </AnimatePresence>
      </Reorder.Group>}
      <p className={`text-center text-xs text-[var(--text-secondary)] ${ids.length ? 'pt-2' : 'py-8'}`}>{tl(ids.length ? 'Trascina altri brani qui · riordina trascinando' : 'Trascina qui i brani dalla tua libreria')}</p>
    </div>

    {lists.isError && <p role="alert" className="text-xs">{tl('Impossibile caricare le playlist.')} <Button density="compact" surface="ghost" onClick={() => void lists.refetch()}>{tl('Riprova')}</Button></p>}
    {error && <p role="alert" className="text-xs text-[var(--brand-red-text)]">{error}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button density="compact" tone="accent" surface="solid" disabled={!ids.length || saving} onClick={() => void (async () => { const p = dirty || !selected ? await persist() : selected; if (p) player.listen(p) })()}><Play className="h-4 w-4" />{tl('Riproduci')}</Button>
      <Button density="compact" tone="neutral" surface="ghost" disabled={saving || (!dirty && !!selected)} onClick={() => void persist()}>{tl(saving ? 'Salvataggio…' : 'Salva')}</Button>
      {dirty && <span role="status" className="text-xs text-[var(--text-secondary)]">{tl('Modifiche da salvare')}</span>}
    </div>
  </aside>
}
