import { useEffect, useRef, useState, type DragEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, IconButton, Input } from '@/design'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { ArrowUp, ArrowDown, Plus, Play, X } from '@/components/icons'
import { useAuthStore } from '@/stores/auth'
import { voiceLabApi, type LabItem, type LabPlaylist } from '@/lib/voiceLab'
import { DRIVE_ITEM_MIME, type DraggedDriveItem } from '@/lib/dragFiles'
import { useBackgroundAudio } from './BackgroundAudio'
import { tl } from '@/i18n/tl'

const ORDER_MIME = 'application/x-audio-playlist-order'

export function MusicPlaylistPanel({ items, candidate, onCandidateAdded }: { items: LabItem[]; candidate?: string; onCandidateAdded: () => void }) {
  const player = useBackgroundAudio(), qc = useQueryClient()
  const userId = useAuthStore(s => s.user?.id)
  const key = ['voice-lab-playlists', `teacher:${userId}`]
  const lists = useQuery({ queryKey: key, queryFn: async () => (await voiceLabApi.playlists()).data })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [ids, setIds] = useState<string[]>([])
  const [dirty, setDirty] = useState(false), [saving, setSaving] = useState(false), [error, setError] = useState('')
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
  const move = (from: number, to: number) => {
    if (saving || from < 0 || from === to || to < 0 || to >= ids.length) return
    setIds(current => { const next = [...current]; const [id] = next.splice(from, 1); next.splice(to, 0, id); return next }); setDirty(true)
  }
  const drop = (event: DragEvent, to = ids.length - 1) => {
    event.preventDefault(); event.stopPropagation()
    if (saving) return
    try {
      const order = event.dataTransfer.getData(ORDER_MIME)
      if (order) { move(ids.indexOf(order), to); return }
      const raw = event.dataTransfer.getData(DRIVE_ITEM_MIME)
      if (raw) add((JSON.parse(raw) as DraggedDriveItem[]).filter(v => v.kind === 'file' && v.mime_type?.startsWith('audio/')).map(v => v.id))
    } catch { setError(tl('Impossibile aggiungere questo brano.')) }
  }
  return <aside className="ui-card min-w-0 space-y-3 rounded-[var(--card-radius)] p-4 lg:sticky lg:top-5" aria-label={tl('Playlist musicale')}>
    <div className="flex items-center justify-between gap-2"><h2 className="font-bold">{tl('La tua playlist')}</h2><Button density="compact" tone="neutral" surface="ghost" disabled={saving} onClick={() => void switchTo()}><Plus className="h-3.5 w-3.5" />{tl('Nuova')}</Button></div>
    <SearchableSelect label={tl('Scegli una playlist')} value={selectedId || ''} disabled={saving || lists.isLoading} options={(lists.data || []).map(p => ({ value: p.id, label: p.title }))} onChange={id => void switchTo(lists.data?.find(p => p.id === id))} />
    <label className="block space-y-1 text-xs font-semibold">{tl('Nome della playlist')}<Input value={title} maxLength={200} disabled={saving} placeholder={tl('La mia playlist')} onChange={e => { setTitle(e.target.value); setDirty(true) }} /></label>
    <div className="ds-well space-y-2 p-2" onDragOver={e => { if (Array.from(e.dataTransfer.types).some(t => t === DRIVE_ITEM_MIME || t === ORDER_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = e.dataTransfer.types.includes(ORDER_MIME) ? 'move' : 'copy' } }} onDrop={e => drop(e)}>
      <ol aria-label={tl('Brani nella playlist')} className="max-h-[240px] space-y-1 overflow-y-auto">{ids.map((id, index) => <li key={id} draggable={!saving} onDragStart={e => { e.dataTransfer.setData(ORDER_MIME, id); e.dataTransfer.effectAllowed = 'move' }} onDrop={e => drop(e, index)} className="ds-well-tile flex items-center gap-1 rounded-xl p-2">
        <span className="min-w-0 flex-1 truncate text-xs" title={metadata(id)?.title}>{index + 1}. {metadata(id)?.title || tl('Audio selezionato')}</span>
        <IconButton size="sm" tone="neutral" surface="ghost" aria-label={tl('Sposta in alto {0}', metadata(id)?.title || '')} disabled={saving || index === 0} onClick={() => move(index, index - 1)}><ArrowUp className="h-3.5 w-3.5" /></IconButton>
        <IconButton size="sm" tone="neutral" surface="ghost" aria-label={tl('Sposta in basso {0}', metadata(id)?.title || '')} disabled={saving || index === ids.length - 1} onClick={() => move(index, index + 1)}><ArrowDown className="h-3.5 w-3.5" /></IconButton>
        <IconButton size="sm" tone="neutral" surface="ghost" aria-label={tl('Rimuovi {0} dalla playlist', metadata(id)?.title || '')} disabled={saving} onClick={() => { setIds(current => current.filter(v => v !== id)); setDirty(true) }}><X className="h-3.5 w-3.5" /></IconButton>
      </li>)}</ol>
      <p className="py-3 text-center text-xs text-[var(--text-secondary)]">{tl(ids.length ? 'Trascina altri brani qui' : 'Trascina qui i brani generati')}</p>
    </div>
    {lists.isError && <p role="alert" className="text-xs">{tl('Impossibile caricare le playlist.')} <Button density="compact" surface="ghost" onClick={() => void lists.refetch()}>{tl('Riprova')}</Button></p>}
    {error && <p role="alert" className="text-xs text-[var(--brand-red-text)]">{error}</p>}
    <div className="flex flex-wrap items-center gap-2">
      <Button density="compact" tone="accent" surface="solid" disabled={!ids.length || saving} onClick={() => void (async () => { const p = dirty || !selected ? await persist() : selected; if (p) player.listen(p) })()}><Play className="h-4 w-4" />{tl('Riproduci')}</Button>
      <Button density="compact" tone="neutral" surface="ghost" disabled={saving || (!dirty && !!selected)} onClick={() => void persist()}>{tl(saving ? 'Salvataggio…' : 'Salva')}</Button>
    </div>
    {dirty && <p role="status" className="text-xs text-[var(--text-secondary)]">{tl('Modifiche da salvare · Riproduci salva anche la playlist.')}</p>}
  </aside>
}
