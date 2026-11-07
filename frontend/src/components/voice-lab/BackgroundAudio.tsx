import { lazy, Suspense, createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Music, Play, SkipForward, Volume2, VolumeX, X, Upload, Plus, ArrowUp, ArrowDown, Trash2, Share2, Loader2 } from '@/components/icons'
import { MediaPauseIcon } from '@/components/icons/CustomIcons'
import { Button, IconButton, Input, Select } from '@/design'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useToast } from '@/components/ui/use-toast'
import { useAuthStore } from '@/stores/auth'
import { voiceLabApi, type ClassPlayback, type LabPlaylist } from '@/lib/voiceLab'
import { driveApi } from '@/lib/api'
import { AudioShareDialog } from './AudioShareDialog'
import { AudioCover } from './AudioCover'
import { saveBlob } from '@/components/drive/driveTypes'
import { DRIVE_ITEM_MIME, type DraggedDriveItem } from '@/lib/dragFiles'
import { safeMediaUrl } from '@/lib/media'
import { type AudioTrack, type AudioLoader } from '@/lib/audioPlayback'
import { tl } from '@/i18n/tl'

const NavbarMusicComposer = lazy(() => import('./NavbarMusicComposer').then(module => ({ default: module.NavbarMusicComposer })))

interface AudioContextValue {
  open: () => void
  sessionId?: string
  setSessionId: (id?: string) => void
  personal: LabPlaylist | null
  playback: ClassPlayback | null
  active: LabPlaylist | null
  index: number
  playing: boolean
  muted: boolean
  following: boolean
  needsGesture: boolean
  error: string
  retry: () => void
  busy: boolean
  position: number
  duration: number
  volume: number
  setVolume: (value: number) => void
  toggle: () => void
  mute: () => void
  seek: (position: number) => void
  choose: (index: number) => void
  remember: (playlist: LabPlaylist) => void
  playTracks: (tracks: AudioTrack[], load: AudioLoader, startIndex?: number) => void
  playFile: (track: AudioTrack) => void
  updateTrack: (ids: string[], data: { title: string; artist_name?: string | null }) => void
  setCover: (id: string, url: string | null) => void
  loading: boolean
  listen: (playlist: LabPlaylist) => void
  follow: () => void
  broadcast: (playlist: LabPlaylist, sessionId: string) => Promise<void>
  stopClass: () => Promise<void>
  addFiles: (files: File[]) => Promise<LabPlaylist | undefined>
  addIds: (ids: string[]) => Promise<LabPlaylist | undefined>
  drop: (event: DragEvent) => void
}
const AudioContext = createContext<AudioContextValue | null>(null)
export const useBackgroundAudio = () => {
  const value = useContext(AudioContext)
  if (!value) throw new Error('BackgroundAudioProvider is required')
  return value
}
/** «Classe · Sessione»: the same session title can exist in several classes. */
export const sessionLabel = (session: { name: string; class_id: string }, classes?: { id: string; name: string }[]) => {
  const cls = classes?.find(v => v.id === session.class_id)
  return cls ? `${cls.name} · ${session.name}` : session.name
}
const isAudio = (file: File) => file.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(file.name)
const clock = (value: number) => `${Math.floor(value / 60)}:${Math.floor(value % 60).toString().padStart(2, '0')}`

export function BackgroundAudioProvider({ children }: { children: ReactNode }) {
  const { user, studentSession } = useAuthStore()
  const identity = studentSession ? `student:${studentSession.student_id}` : user ? `teacher:${user.id}` : ''
  const qc = useQueryClient(), { toast } = useToast()
  const [sessionId, setSessionId] = useState<string>()
  const [castSessionId, setCastSessionId] = useState<string>()
  const [personal, setPersonal] = useState<LabPlaylist | null>(null)
  const [personalIndex, setPersonalIndex] = useState(0)
  const [personalPlaying, setPersonalPlaying] = useState(false)
  const [following, setFollowing] = useState(true)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(.35)
  const [panelOpen, setPanelOpen] = useState(false)
  // The popup hangs right under the navbar music icon, whatever the viewport width.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
  useLayoutEffect(() => {
    if (!panelOpen) return
    const place = () => {
      const trigger = document.querySelector<HTMLElement>('[data-music-trigger]')
      const rect = trigger?.getBoundingClientRect()
      if (!rect || !rect.width) { setAnchor(null); return }
      const width = document.documentElement.clientWidth
      const panelWidth = document.querySelector<HTMLElement>('[data-audio-panel]')?.getBoundingClientRect().width || Math.min(560, width - 24)
      const right = Math.max(12, Math.min(Math.round(width - rect.right - 8), width - panelWidth - 12))
      setAnchor({ top: Math.round(rect.bottom + 8), right })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [panelOpen])
  const [needsGesture, setNeedsGesture] = useState(false)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [loading, setLoading] = useState(false)
  const [sourceVersion, setSourceVersion] = useState(0)
  const personalLoader = useRef<AudioLoader | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [position, setPosition] = useState(0), [duration, setDuration] = useState(0)
  const audio = useRef<HTMLAudioElement>(null)
  const personalRef = useRef(personal); personalRef.current = personal
  const classQuery = useQuery({ queryKey: ['class-playback', identity, castSessionId, studentSession?.session_id || sessionId],
    queryFn: async () => (await voiceLabApi.sessionPlayback({ session_id: studentSession?.session_id || castSessionId || sessionId })).data,
    enabled: !!identity && (!!studentSession || !!sessionId || !!castSessionId), retry: false,
    // Position is extrapolated from server_time, so a slow poll is enough; idle (no class audio) polls even less, hidden tabs not at all.
    refetchInterval: q => document.hidden ? false : q.state.data ? 3000 : 10000, refetchIntervalInBackground: false })
  const denied = [401, 403, 404].includes((classQuery.error as any)?.response?.status)
  const playback = denied ? null : classQuery.data || null
  const classActive = following && !!playback
  const active = classActive ? playback.playlist : personal
  const index = classActive ? playback.index : personalIndex
  const playing = classActive ? !playback.paused : personalPlaying
  const track = active?.tracks[index]
  const controlClass = !!user && !studentSession && classActive
  const playbackRef = useRef(playback); playbackRef.current = playback
  const sourceKey = `${sourceVersion}:${retry}:${identity}:${classActive ? playback.session_id : 'personal'}:${track?.id || ''}`
  const desired = useRef({ playing, muted, classActive, playback }); desired.current = { playing, muted, classActive, playback }
  const currentSource = useRef('')

  useEffect(() => {
    setPersonal(null); setPersonalIndex(0); setPersonalPlaying(false); setFollowing(true)
    setCastSessionId(undefined); setPanelOpen(false); setError(''); setNeedsGesture(false); personalLoader.current = null
    try { setMuted(localStorage.getItem(`audio-muted:${identity}`) === 'true') } catch { setMuted(false) }
    audio.current?.pause()
  }, [identity])
  useEffect(() => { if (identity) localStorage.setItem(`audio-muted:${identity}`, String(muted)) }, [identity, muted])
  useEffect(() => { if (audio.current) audio.current.volume = volume }, [volume])
  useEffect(() => {
    if (!panelOpen) return
    const outside = (event: MouseEvent) => {
      if (!(event.target as Element)?.closest('[data-audio-panel], [data-music-trigger], [data-audio-overlay]')) setPanelOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { setPanelOpen(false); document.querySelector<HTMLButtonElement>('[data-music-trigger]')?.focus() }
    }
    document.addEventListener('click', outside, true); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('click', outside, true); document.removeEventListener('keydown', escape) }
  }, [panelOpen])


  const attemptPlay = useCallback(() => {
    if (!audio.current) return
    void audio.current.play().then(() => setNeedsGesture(false)).catch((e: DOMException) => {
      if (e.name === 'NotAllowedError') setNeedsGesture(true)
      else if (e.name !== 'AbortError') setError(tl('Impossibile riprodurre questa traccia. Riprova o scegli un altro file.'))
    })
  }, [])
  const targetPosition = (state: ClassPlayback) => state.position + (state.paused ? 0 : Math.max(0, state.server_time - state.updated_at))
  useEffect(() => {
    const el = audio.current
    if (!el) return
    el.pause(); el.removeAttribute('src'); el.load(); setPosition(0); setDuration(0); setError(''); setNeedsGesture(false); setLoading(false)
    currentSource.current = ''
    if (!track || !identity) return
    const controller = new AbortController(); let url = ''
    setLoading(true)
    const load = classActive ? voiceLabApi.sessionContent(playback.session_id, track.id, controller.signal).then(r => r.data)
      : personalLoader.current ? personalLoader.current(track, controller.signal) : driveApi.content(track.id, controller.signal).then(r => r.data)
    void load.then(data => {
      if (controller.signal.aborted) return
      if (typeof data === 'string' && !safeMediaUrl(data)) throw new Error('Invalid audio URL')
      const src = typeof data === 'string' ? data : (url = URL.createObjectURL(data))
      currentSource.current = sourceKey; el.src = src; el.load()
    }).catch(() => { if (!controller.signal.aborted) { setLoading(false); setError(tl('Audio non disponibile. Verifica l’accesso al file e riprova.')) } })
    const ready = () => {
      setLoading(false)
      setDuration(Number.isFinite(el.duration) ? el.duration : 0)
      const state = desired.current
      if (state.classActive && state.playback) el.currentTime = Math.min(targetPosition(state.playback), Math.max(0, el.duration - .1))
      if (state.playing && !state.muted) attemptPlay()
    }
    el.addEventListener('loadedmetadata', ready)
    return () => { controller.abort(); el.removeEventListener('loadedmetadata', ready); el.pause(); el.removeAttribute('src'); el.load(); if (url) URL.revokeObjectURL(url) }
  // Only a different track/source reloads the blob; polling and page navigation keep the same audio element.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, attemptPlay])
  useEffect(() => {
    const el = audio.current
    if (!el || currentSource.current !== sourceKey || el.readyState < 1) return
    if (classActive && playback) {
      const target = Math.min(targetPosition(playback), Math.max(0, el.duration - .1))
      if (Math.abs(el.currentTime - target) > 2) el.currentTime = target
    }
    if (playing && !muted) attemptPlay(); else el.pause()
  }, [playing, muted, playback?.revision, playback?.server_time, sourceKey, attemptPlay, classActive])

  const fail = (e: any) => { toast({ variant: 'destructive', title: tl('Operazione non completata'), description: e?.response?.data?.detail || tl('Riprova tra poco.') }) }
  const publish = async (state: ClassPlayback, next: { index?: number; position?: number; paused?: boolean; playlist_id?: string | null }) => {
    try {
      const { data } = await voiceLabApi.setSessionPlayback(state.session_id, { playlist_id: state.playlist.id, index: state.index,
        paused: state.paused, position: muted ? targetPosition(state) : audio.current?.currentTime || 0, expected_revision: state.revision, ...next })
      qc.setQueryData(classQueryKey, data)
      await qc.invalidateQueries({ queryKey: ['class-playback'] })
    } catch (e) { fail(e); void classQuery.refetch() }
  }
  // Use the identical key for immediate local feedback after a class command.
  const classQueryKey = ['class-playback', identity, castSessionId, studentSession?.session_id || sessionId]
  const broadcast = async (playlist: LabPlaylist, targetSession: string) => {
    const { data } = await voiceLabApi.setSessionPlayback(targetSession, { playlist_id: playlist.id })
    setCastSessionId(targetSession); setFollowing(true); setMuted(false)
    qc.setQueryData(['class-playback', identity, targetSession, studentSession?.session_id || sessionId], data)
    void qc.invalidateQueries({ queryKey: ['class-playback'] })
  }
  const listen = (playlist: LabPlaylist) => {
    personalLoader.current = null; setSourceVersion(v => v + 1)
    setPersonal(playlist); personalRef.current = playlist; setPersonalIndex(0); setFollowing(false); setPersonalPlaying(true); setMuted(false); setPanelOpen(true)
  }
  const playTracks = (tracks: AudioTrack[], load: AudioLoader, startIndex = 0) => {
    if (!tracks.length) return
    personalLoader.current = load; setSourceVersion(v => v + 1)
    const queue: LabPlaylist = { id: '', folder_id: '', title: tracks[0].title,
      tracks: tracks.map(v => ({ ...v, source_item_id: v.id, mime_type: v.mime_type || 'audio/mpeg' })) }
    setPersonal(queue); personalRef.current = queue; setPersonalIndex(Math.max(0, Math.min(startIndex, tracks.length - 1)))
    setFollowing(false); setPersonalPlaying(true); setMuted(false); setPanelOpen(true)
  }
  const playFile = (track: AudioTrack) => {
    listen({ id: '', folder_id: '', title: track.title, tracks: [{ ...track, source_item_id: track.id, mime_type: track.mime_type || 'audio/mpeg' }] })
  }
  const choose = (next: number) => {
    if (!active || next < 0 || next >= active.tracks.length) return
    if (controlClass && playback) void publish(playback, { index: next, position: 0, paused: false })
    else if (!classActive) { setPersonalIndex(next); setPersonalPlaying(true) }
  }
  const toggle = () => {
    if (needsGesture && !muted && playing) { attemptPlay(); return }
    if (controlClass && playback) void publish(playback, { paused: !playback.paused })
    else if (classActive) setMuted(!muted)
    else { setMuted(false); setPersonalPlaying(!personalPlaying); if (!personalPlaying) attemptPlay() }
  }
  const append = async (ids: string[]) => {
    const current = personalLoader.current ? null : personalRef.current
    const trackIds = [...new Set([...(current?.tracks.map(v => v.source_item_id) || []), ...ids])]
    const own = qc.getQueryData<LabPlaylist[]>(['voice-lab-playlists', identity])?.some(v => v.id === current?.id)
    const selectedIds = current && !own ? [...new Set([...current.tracks.map(v => v.id), ...ids])] : trackIds
    const { data } = current && own ? await voiceLabApi.updatePlaylist(current.id, current.title, selectedIds) : await voiceLabApi.createPlaylist(tl('Playlist rapida'), selectedIds)
    personalLoader.current = null; setPersonal(data); personalRef.current = data
    if (!active || !playing) { setFollowing(false); setPersonalPlaying(true); setPersonalIndex(0); setMuted(false) }
    void qc.invalidateQueries({ queryKey: ['voice-lab-playlists'] }); void qc.invalidateQueries({ queryKey: ['drive'] })
    return data
  }
  const addIds = async (ids: string[]) => {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setPanelOpen(true)
    try { return await append(ids) } catch (e) { fail(e) } finally { busyRef.current = false; setBusy(false) }
  }
  const addFiles = async (files: File[]) => {
    if (busyRef.current) return
    if (!files.length || files.some(f => !isAudio(f))) { toast({ variant: 'destructive', title: tl('Scegli file audio, per esempio MP3, WAV o M4A.') }); return }
    busyRef.current = true; setBusy(true); setPanelOpen(true)
    try {
      const { data } = await driveApi.upload(files, null, files.map(f => f.name))
      const result = await append(data.items.map((v: { id: string }) => v.id))
      void qc.invalidateQueries({ queryKey: ['audio-files'] })
      toast({ title: tl('Audio aggiunti alla playlist e salvati nei Files') }); return result
    } catch (e) { fail(e) } finally { busyRef.current = false; setBusy(false) }
  }
  const drop = (event: DragEvent) => {
    event.preventDefault(); event.stopPropagation(); setPanelOpen(true)
    const raw = event.dataTransfer.getData(DRIVE_ITEM_MIME)
    if (raw) {
      try { const refs = JSON.parse(raw) as DraggedDriveItem[]; void addIds(refs.filter(v => v.kind === 'file').map(v => v.id)) } catch { toast({ variant: 'destructive', title: tl('Trascinamento non valido') }) }
    } else void addFiles(Array.from(event.dataTransfer.files))
  }
  const contextValue: AudioContextValue = { open: () => setPanelOpen(v => !v), sessionId, setSessionId, personal, playback, active, index, playing, muted, following,
    needsGesture, error, retry: () => setRetry(v => v + 1), busy, position, duration, volume, setVolume, toggle, mute: () => setMuted(v => !v),
    seek: (value) => { if (controlClass && playback) void publish(playback, { position: value }); else if (!classActive && audio.current) audio.current.currentTime = value },
    choose, listen, playFile, playTracks, loading,
    updateTrack: (ids, data) => setPersonal(prev => { if (!prev) return prev; const next = { ...prev, tracks: prev.tracks.map(v => ids.includes(v.id) || ids.includes(v.source_item_id) ? { ...v, ...data } : v) }; personalRef.current = next; return next }),
    setCover: (id, url) => setPersonal(prev => { if (!prev) return prev; const next = { ...prev, tracks: prev.tracks.map(v => v.id === id || v.source_item_id === id ? { ...v, cover_url: url } : v) }; personalRef.current = next; return next }), remember: value => {
      const currentId = personalRef.current?.tracks[personalIndex]?.id
      setPersonalIndex(Math.max(0, value.tracks.findIndex(v => v.id === currentId)))
      setPersonal(value); personalRef.current = value
    }, follow: () => { setFollowing(true); setMuted(false); attemptPlay() }, broadcast,
    stopClass: async () => { if (playback) { await voiceLabApi.setSessionPlayback(playback.session_id, { playlist_id: null }); qc.setQueryData(classQueryKey, null); void qc.invalidateQueries({ queryKey: ['class-playback'] }) } }, addFiles, addIds, drop }
  return <AudioContext.Provider value={contextValue}>
    {children}
    <audio ref={audio} data-background-audio preload="auto" onTimeUpdate={e => setPosition(e.currentTarget.currentTime)} onError={() => { if (audio.current?.getAttribute('src')) setError(tl('Formato audio non riproducibile. Prova un altro file.')) }} onEnded={() => {
      if (classActive) return // The server timeline advances the class even when the teacher is muted or disconnected.
      else if (index + 1 < (active?.tracks.length || 0)) setPersonalIndex(index + 1)
      else setPersonalPlaying(false)
    }} />
    {identity && panelOpen && createPortal(<div className="fixed right-0 top-0 z-[200]">
      <section data-audio-panel role="dialog" aria-modal="false" aria-label={tl('Musica e playlist')} style={anchor ? { top: anchor.top, right: anchor.right, maxHeight: `calc(100dvh - ${anchor.top + 12}px)` } : undefined} className={`ds-popover absolute w-[min(35rem,calc(100vw-1.5rem))] overflow-y-auto rounded-3xl p-3 text-[var(--text-primary)] ${anchor ? '' : 'right-3 top-[calc(4.25rem+env(safe-area-inset-top))] max-h-[calc(100dvh-5rem)]'}`} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }} onDrop={drop}>
        <div className="mb-3 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-bold"><Music className="h-4 w-4" />{tl('Player audio')}</h2><IconButton autoFocus tone="neutral" surface="ghost" aria-label={tl('Chiudi')} onClick={() => setPanelOpen(false)}><X /></IconButton></div>
        <NavbarAudioPanel />
      </section>
    </div>, document.body)}
  </AudioContext.Provider>
}

export function NavbarMusicButton({ sessionId }: { sessionId?: string }) {
  const player = useBackgroundAudio()
  useEffect(() => { if (sessionId) player.setSessionId(sessionId) }, [sessionId, player.setSessionId])
  return <IconButton data-music-trigger tone="neutral" surface="ghost" aria-label={tl('Apri musica e playlist')} title={tl('Musica e playlist · trascina qui i tuoi audio')} className="relative shrink-0" onClick={player.open}
    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }} onDrop={player.drop}>
    <Music className="h-4 w-4" />{(player.playing || player.needsGesture) && <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--text-secondary)]" />}
  </IconButton>
}

/** Playback only. Editing, ordering and class broadcasts live in PlaylistWorkspace. */
function NavbarAudioPanel() {
  const player = useBackgroundAudio()
  const { user, studentSession } = useAuthStore()
  const identity = studentSession ? `student:${studentSession.student_id}` : `teacher:${user?.id}`
  const lists = useQuery({ queryKey: ['voice-lab-playlists', identity], queryFn: async () => (await voiceLabApi.playlists()).data })
  const library = useQuery({ queryKey: ['audio-files', identity], queryFn: async () => (await voiceLabApi.audioFiles()).data })
  const track = player.active?.tracks[player.index]
  const inClass = player.following && !!player.playback
  const mayChoose = !inClass || !studentSession
  const [showLibrary, setShowLibrary] = useState(false)
  const [creatingMusic, setCreatingMusic] = useState(false)
  const queue = player.active?.tracks || []
  const listIsQueue = !showLibrary && queue.length > 1
  const rows: AudioTrack[] = listIsQueue ? queue : (library.data || [])
  return <div className="space-y-2">
    <div className="grid gap-3 sm:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="relative mx-auto aspect-square w-full max-w-[16rem] overflow-hidden rounded-2xl bg-[#14151a] text-white sm:mx-0" data-audio-card>
        <AudioCover url={track?.cover_url} className="!absolute inset-0 !h-full !w-full" iconClassName="h-1/4 w-1/4" />
        {track ? <div className="absolute inset-x-0 bottom-0 space-y-1.5 bg-gradient-to-t from-black/85 via-black/60 to-transparent p-3 pt-10">
          <div className="min-w-0 text-center">
            <p className="truncate text-sm font-semibold" aria-live="polite">{track.title}</p>
            {track.artist_name && <p className="truncate text-xs text-white/80">{track.artist_name}</p>}
            <p className="truncate text-[11px] text-white/60">{inClass ? tl('Audio della classe') : queue.length > 1 ? tl('Traccia {0} di {1}', player.index + 1, queue.length) : tl('In riproduzione')}</p>
          </div>
          <div>
            <input aria-label={tl('Posizione nella traccia')} className="w-full" type="range" min="0" max={player.duration || 1} step="0.1" value={Math.min(player.position, player.duration || 0)} disabled={!mayChoose || !player.duration} onChange={e => player.seek(Number(e.target.value))} />
            <div className="flex justify-between text-[11px] tabular-nums text-white/60"><span>{clock(player.position)}</span><span>{clock(player.duration)}</span></div>
          </div>
          <div className="flex items-center justify-between gap-2" role="group" aria-label={tl('Controlli di riproduzione')}>
            <IconButton tone="neutral" surface="glass" aria-label={player.muted ? tl('Riattiva per me') : tl('Spegni per me')} aria-pressed={player.muted} onClick={player.mute}>{player.muted ? <VolumeX /> : <Volume2 />}</IconButton>
            <IconButton tone="neutral" surface="glass" aria-label={tl('Traccia precedente')} disabled={!mayChoose || player.index === 0} onClick={() => player.choose(player.index - 1)}><SkipForward className="-scale-x-100" /></IconButton>
            <IconButton tone="accent" surface="glass" aria-label={player.needsGesture ? tl('Attiva audio') : player.playing && !player.muted ? tl('Pausa') : tl('Riproduci')} onClick={player.toggle}>{player.loading ? <Loader2 className="animate-spin" /> : player.playing && !player.muted && !player.needsGesture ? <MediaPauseIcon /> : <Play className="fill-current" />}</IconButton>
            <IconButton tone="neutral" surface="glass" aria-label={tl('Traccia successiva')} disabled={!mayChoose || player.index + 1 >= queue.length} onClick={() => player.choose(player.index + 1)}><SkipForward /></IconButton>
          </div>
        </div> : <p className="absolute inset-x-0 bottom-0 p-3 text-center text-xs text-white/70">{tl('Scegli un brano o crea musica per iniziare.')}</p>}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        {/* menuClassName: the list opens inline; an absolute menu was clipped by the panel's overflow-y-auto. */}
        <SearchableSelect menuClassName="!static !mt-2 w-full" label={tl('Playlist')} value={showLibrary ? '' : player.personal?.id || ''} options={[{ value: '__library', label: tl('Tutti i brani') }, ...(lists.data || []).map(v => ({ value: v.id, label: v.title }))]} onChange={id => {
          if (id === '__library') { setShowLibrary(true); return }
          const playlist = lists.data?.find(v => v.id === id); if (playlist) { setShowLibrary(false); player.listen(playlist) }
        }} />
        <ol aria-label={listIsQueue ? tl('Tracce in riproduzione') : tl('Brani')} className="max-h-60 min-h-24 flex-1 space-y-0.5 overflow-y-auto">
          {rows.map((entry, i) => { const current = listIsQueue ? i === player.index : entry.id === track?.id
            return <li key={entry.id}><button type="button" className={`flex w-full items-center gap-2.5 rounded-xl p-1.5 text-left text-sm transition-colors hover:bg-[var(--ds-field-bg)] disabled:opacity-50 ${current ? 'ds-selected font-semibold' : ''}`} aria-label={tl('Riproduci {0}', entry.title)} aria-current={current ? 'true' : undefined} disabled={!mayChoose}
              onClick={() => { if (listIsQueue) player.choose(i); else { player.playFile(entry) } }}><AudioCover url={entry.cover_url} className="h-8 w-8 rounded-lg" iconClassName="h-4 w-4" /><span className="min-w-0"><span className="block truncate">{entry.title}</span>{entry.artist_name && <span className="block truncate text-xs font-normal text-[var(--text-secondary)]">{entry.artist_name}</span>}</span></button></li> })}
          {!rows.length && !library.isLoading && <li className="p-2 text-xs text-[var(--text-secondary)]">{tl('Nessun brano disponibile.')}</li>}
        </ol>
      </div>
    </div>
    {player.error && <div role="alert" className="text-xs text-[var(--text-secondary)]">{player.error}<Button tone="neutral" surface="ghost" onClick={player.retry}>{tl('Riprova audio')}</Button></div>}
    {(library.isError || lists.isError) && <Button tone="neutral" surface="ghost" onClick={() => { void library.refetch(); void lists.refetch() }}>{tl('Ricarica brani e playlist')}</Button>}
    <div className="flex flex-wrap items-center gap-2">
      {!studentSession && <Button tone="neutral" surface="ghost" density="compact" aria-expanded={creatingMusic} onClick={() => setCreatingMusic(v => !v)}><Music className="h-4 w-4" />{tl('Crea musica')}</Button>}
      {player.playback && !player.following && <Button tone="neutral" surface="ghost" density="compact" onClick={player.follow}>{tl('Ascolta la playlist di classe')}</Button>}
    </div>
    {creatingMusic && !studentSession && <Suspense fallback={<p role="status" className="text-xs">{tl('Caricamento…')}</p>}><NavbarMusicComposer onPlay={item => player.playTracks([{ id: item.id, title: item.title, artist_name: item.artist_name, mime_type: item.mime_type, cover_url: item.cover_url }], async (track, signal) => (await voiceLabApi.content(track.id, signal)).data)} /></Suspense>}
    {player.busy && <p role="status" className="text-xs">{tl('Caricamento audio…')}</p>}
  </div>
}

export function PlaylistEditor({ compact = false, candidate }: { compact?: boolean; candidate?: string }) {
  const player = useBackgroundAudio(), qc = useQueryClient(), { toast } = useToast()
  const student = useAuthStore(s => s.studentSession)
  const user = useAuthStore(s => s.user)
  const identity = student ? `student:${student.student_id}` : `teacher:${user?.id}`
  const lists = useQuery({ queryKey: ['voice-lab-playlists', identity], queryFn: async () => (await voiceLabApi.playlists()).data })
  const library = useQuery({ queryKey: ['audio-files', identity], queryFn: async () => (await voiceLabApi.audioFiles()).data })
  const classes = useQuery({ queryKey: ['drive', 'share-targets'], queryFn: async () => (await driveApi.shareTargets()).data, enabled: !student })
  const [selectedId, setSelectedId] = useState(''), [title, setTitle] = useState(''), [ids, setIds] = useState<string[]>([])
  const [addId, setAddId] = useState(candidate || ''), [castSession, setCastSession] = useState(''), [saving, setSaving] = useState(false), [dirty, setDirty] = useState(false)
  const [sharing, setSharing] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const selected = lists.data?.find(v => v.id === selectedId) || (player.personal?.id && player.personal.id === selectedId ? player.personal : undefined)
  const choose = (p?: LabPlaylist) => { setSelectedId(p?.id || ''); setTitle(p?.title || ''); setIds(p?.tracks.map(v => v.source_item_id) || []); setDirty(false) }
  useEffect(() => { if (candidate) setAddId(candidate) }, [candidate])
  useEffect(() => { if (compact && player.personal) choose(player.personal) }, [compact, player.personal])
  const fail = (e: any) => toast({ variant: 'destructive', title: tl('Operazione non completata'), description: e?.response?.data?.detail || tl('Riprova tra poco.') })
  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const { data } = selectedId ? await voiceLabApi.updatePlaylist(selectedId, title, ids) : await voiceLabApi.createPlaylist(title, ids)
      choose(data); if (player.personal?.id === data.id) player.remember(data); qc.setQueryData<LabPlaylist[]>(['voice-lab-playlists', identity], (rows = []) => [data, ...rows.filter(v => v.id !== data.id)])
      void qc.invalidateQueries({ queryKey: ['drive'] }); return data
    } catch (e) { fail(e) } finally { setSaving(false) }
  }
  const saved = async (action: (p: LabPlaylist) => void | Promise<void>) => {
    const value = dirty || !selected ? await save() : selected
    if (value) { try { await action(value) } catch (e) { fail(e) } }
  }
  const commitDrop = async (extra: string[]) => {
    const next = [...new Set([...ids, ...extra])]
    const name = title.trim() || tl('Playlist rapida')
    const { data } = selectedId ? await voiceLabApi.updatePlaylist(selectedId, name, next) : await voiceLabApi.createPlaylist(name, next)
    choose(data); player.remember(data)
    qc.setQueryData<LabPlaylist[]>(['voice-lab-playlists', identity], (rows = []) => [data, ...rows.filter(v => v.id !== data.id)])
    void qc.invalidateQueries({ queryKey: ['drive'] })
  }
  const quickDrop = async (extra: string[]) => {
    if (saving) return
    setSaving(true)
    try { await commitDrop(extra) } catch (e) { fail(e) } finally { setSaving(false) }
  }
  const upload = async (files: File[]) => {
    if (files.some(f => !isAudio(f))) { toast({ variant: 'destructive', title: tl('Scegli file audio, per esempio MP3, WAV o M4A.') }); return }
    setSaving(true)
    try {
      const { data } = await driveApi.upload(files, null, files.map(f => f.name))
      const uploadedIds = data.items.map((v: { id: string }) => v.id)
      if (compact) await commitDrop(uploadedIds)
      else { setIds(prev => [...new Set([...prev, ...uploadedIds])]); setDirty(true) }
      void qc.invalidateQueries({ queryKey: ['audio-files', identity] }); void qc.invalidateQueries({ queryKey: ['drive'] })
      toast({ title: tl('Audio caricati anche nei Files') })
    } catch (e) { fail(e) } finally { setSaving(false) }
  }
  return <div className="space-y-3" onDragOver={e => { e.preventDefault(); e.stopPropagation() }} onDrop={e => {
    e.preventDefault(); e.stopPropagation()
    try { const raw = e.dataTransfer.getData(DRIVE_ITEM_MIME); if (raw) { const refs = JSON.parse(raw) as DraggedDriveItem[]; const extra = refs.filter(v => v.kind === 'file').map(v => v.id); if (compact) void quickDrop(extra); else { setIds(prev => [...new Set([...prev, ...extra])]); setDirty(true) } } else void upload(Array.from(e.dataTransfer.files)) } catch (err) { fail(err) }
  }}>
    <div className="flex items-center gap-2"><div className="min-w-0 flex-1"><SearchableSelect label={tl('Apri una playlist')} value={selectedId} options={(lists.data || []).map(v => ({ value: v.id, label: v.title }))} onChange={id => choose(lists.data?.find(v => v.id === id))} /></div><Button tone="neutral" surface="ghost" onClick={() => choose()}><Plus />{tl('Nuova')}</Button></div>
    <label className="block space-y-1 text-xs font-semibold">{tl('Nome della playlist')}<Input value={title} maxLength={200} placeholder={tl('Musica per il laboratorio')} onChange={e => { setTitle(e.target.value); setDirty(true) }} /></label>
    <div className="flex items-center gap-2"><div className="min-w-0 flex-1"><SearchableSelect label={tl('Scegli un audio dai Files')} value={addId} options={(library.data || []).filter(v => !ids.includes(v.id)).map(v => ({ value: v.id, label: v.title, description: v.shared ? tl('Condiviso con te') : undefined }))} onChange={setAddId} /></div><IconButton tone="neutral" surface="solid" aria-label={tl('Aggiungi')} disabled={!addId || ids.includes(addId) || ids.length >= 200} onClick={() => { setIds(v => [...v, addId]); setAddId(''); setDirty(true) }}><Plus /></IconButton></div>
    <input ref={input} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac" multiple className="hidden" onChange={e => { if (e.target.files?.length) void upload(Array.from(e.target.files)); e.target.value = '' }} />
    <Button tone="neutral" surface="ghost" disabled={saving || player.busy} onClick={() => input.current?.click()}><Upload />{tl('Carica audio dal computer')}</Button>
    <p className="text-xs text-[var(--text-secondary)]">{tl('Trascina qui audio da Files o dal computer. I caricamenti saranno salvati nei Files.')}</p>
    {(lists.isError || library.isError) && <p role="alert" className="text-xs">{tl('Impossibile caricare gli audio o le playlist.')} <Button tone="neutral" surface="ghost" onClick={() => { void lists.refetch(); void library.refetch() }}>{tl('Riprova')}</Button></p>}
    <ol aria-label={tl('Ordine delle tracce')} className={`${compact ? 'max-h-44' : 'max-h-80'} space-y-1 overflow-y-auto`}>{ids.map((id, i) => <li key={id} className="ds-control flex items-center gap-1 rounded-2xl p-2">
      <span className="min-w-0 flex-1 truncate text-xs">{i + 1}. {library.data?.find(v => v.id === id)?.title || selected?.tracks.find(v => v.source_item_id === id)?.title || tl('Audio selezionato')}</span>
      <IconButton size="sm" tone="neutral" surface="ghost" aria-label={tl('Sposta in alto')} disabled={!i} onClick={() => { setIds(v => { const a = [...v]; [a[i], a[i - 1]] = [a[i - 1], a[i]]; return a }); setDirty(true) }}><ArrowUp /></IconButton>
      <IconButton size="sm" tone="neutral" surface="ghost" aria-label={tl('Sposta in basso')} disabled={i === ids.length - 1} onClick={() => { setIds(v => { const a = [...v]; [a[i], a[i + 1]] = [a[i + 1], a[i]]; return a }); setDirty(true) }}><ArrowDown /></IconButton>
      {student && library.data?.find(v => v.id === id)?.owned && <IconButton size="sm" tone="neutral" surface="ghost" aria-label={tl('Condividi audio con la classe')} onClick={() => void voiceLabApi.shareAudioClass(id).then(() => { toast({ title: tl('Audio condiviso con la classe') }); void qc.invalidateQueries({ queryKey: ['drive'] }) }).catch(fail)}><Share2 /></IconButton>}
      <IconButton size="sm" tone="neutral" surface="ghost" aria-label={tl('Rimuovi traccia')} onClick={() => { setIds(v => v.filter(x => x !== id)); setDirty(true) }}><X /></IconButton>
    </li>)}</ol>
    <div className="flex flex-wrap gap-2"><Button tone="neutral" surface="solid" disabled={!title.trim() || saving || player.busy} onClick={() => void save()}>{saving ? tl('Salvataggio…') : tl('Salva playlist')}</Button>
      <Button tone="neutral" surface="solid" disabled={!ids.length || !title.trim() || saving} onClick={() => void saved(player.listen)}><Play />{tl('Ascolta per me')}</Button>
      {selected && !compact && <Button tone="neutral" surface="ghost" onClick={() => void driveApi.zip([selected.folder_id]).then(({data}) => saveBlob(data, `${selected.title}.zip`)).catch(fail)}>{tl('Scarica ZIP')}</Button>}
      {selected && !compact && !student && <Button tone="neutral" surface="ghost" onClick={() => setSharing(true)}><Share2 />{tl('Condividi con una sessione')}</Button>}
      {selected && <IconButton tone="neutral" surface="ghost" aria-label={tl('Elimina playlist')} disabled={saving} onClick={() => { setSaving(true); void voiceLabApi.deletePlaylist(selected.id).then(() => { choose(); void qc.invalidateQueries({ queryKey: ['voice-lab-playlists', identity] }); void qc.invalidateQueries({ queryKey: ['drive'] }) }).catch(fail).finally(() => setSaving(false)) }}><Trash2 /></IconButton>}
    </div>
    {!student && <div className="space-y-2 pt-2"><Select aria-label={tl('Sessione per la musica')} value={castSession} onChange={e => setCastSession(e.target.value)}><option value="">{tl('Scegli la sessione')}</option>{(classes.data?.sessions || []).map((v: { id: string; name: string; class_id: string }) => <option key={v.id} value={v.id}>{sessionLabel(v, classes.data?.classes)}</option>)}</Select>
      <Button tone="neutral" surface="solid" disabled={!castSession || !ids.length || !title.trim() || saving} onClick={() => void saved(p => player.broadcast(p, castSession))}><Music />{tl('Riproduci nella sessione')}</Button></div>}
    {sharing && selected && <AudioShareDialog itemId={selected.folder_id} title={selected.title} onClose={() => setSharing(false)} />}
    {player.busy && <p role="status" className="text-xs">{tl('Aggiungo gli audio alla playlist…')}</p>}
  </div>
}
