import { useEffect, useId, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, Select, Textarea } from '@/design'
import { AudioPlayer } from '@/components/media/MediaPlayer'
import { Download, GripVertical, Headphones, Loader2 } from '@/components/icons'
import { setDriveItemsDrag, setFileDrag } from '@/lib/dragFiles'
import { normalizePodcastOptions, podcastApi, podcastOptionsEqual, type PodcastMessage, type PodcastState } from '@/lib/podcasts'
import { tl } from '@/i18n/tl'

const labelClass = 'block text-xs font-semibold text-[var(--text-primary)]'
const hintClass = 'text-xs leading-relaxed text-[var(--text-secondary)]'

export function PodcastPanel({ messageId, state, onUpdate }: { messageId: string; state: PodcastState; onUpdate: (message: PodcastMessage) => void }) {
  const queryClient = useQueryClient()
  const id = useId()
  const [options, setOptions] = useState(() => normalizePodcastOptions(state.options))
  const savedOptions = useRef(normalizePodcastOptions(state.options))
  const [script, setScript] = useState(state.script || '')
  const [busy, setBusy] = useState<'draft' | 'generate' | null>(null)
  const [error, setError] = useState('')
  const voices = useQuery({ queryKey: ['podcast-voices'], queryFn: async () => (await podcastApi.voices()).data.voices,
    enabled: state.phase !== 'ready', staleTime: 300000, retry: false })
  useEffect(() => { if (!options.voice_id && voices.data?.length) setOptions(o => ({ ...o, voice_id: voices.data![0].voice_id })) }, [voices.data, options.voice_id])
  useEffect(() => { if (state.script) setScript(state.script) }, [state.script])
  useEffect(() => {
    const incoming = normalizePodcastOptions(state.options)
    const previous = savedOptions.current
    // Refresh restored server settings without discarding local form edits.
    setOptions(current => podcastOptionsEqual(current, previous) ? incoming : current)
    savedOptions.current = incoming
  }, [state.options])
  const voice = voices.data?.find(v => v.voice_id === options.voice_id)
  const dirty = Boolean(state.options && !podcastOptionsEqual(options, state.options))
  const messageError = (e: unknown) => {
    const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
    return typeof detail === 'string' ? detail : tl("Operazione non riuscita. Controlla le impostazioni e riprova.")
  }
  const prepare = async () => {
    setBusy('draft'); setError('')
    try {
      const { data } = await podcastApi.draft(messageId, options)
      setOptions(normalizePodcastOptions(data.podcast.options))
      onUpdate(data)
    } catch (e) { setError(messageError(e)) } finally { setBusy(null) }
  }
  const generate = async () => {
    if (dirty || busy || !script.trim()) return
    setBusy('generate'); setError('')
    try {
      onUpdate((await podcastApi.generate(messageId, script)).data)
      void queryClient.invalidateQueries({ queryKey: ['drive'] })
      void queryClient.invalidateQueries({ queryKey: ['credit-balance'] })
    } catch (e) { setError(messageError(e)) } finally { setBusy(null) }
  }
  const shareable = state.phase === 'ready' && Boolean(state.audio_url)
  return <section aria-label={tl("Configurazione podcast")} draggable={shareable}
    onDragStart={event => {
      event.stopPropagation()
      // Keep native controls, text selection and links usable inside the draggable card.
      if (!shareable || (event.target as HTMLElement).closest('audio,button,a,input,textarea,select,summary')) {
        event.preventDefault()
        return
      }
      const name = state.filename || 'Podcast.mp3'
      if (state.drive_item_id) setDriveItemsDrag(event, [{ id: state.drive_item_id, name, kind: 'file', mime_type: 'audio/mpeg' }])
      else setFileDrag(event, { filename: name, mime_type: 'audio/mpeg', url: state.audio_url })
    }}
    className={`not-prose ds-panel mt-3 w-[min(520px,100%)] min-w-0 rounded-[var(--ds-radius-panel)] p-4 text-[var(--text-primary)] sm:p-5 ${shareable ? 'cursor-grab active:cursor-grabbing' : ''}`}>

    <header className="flex items-start gap-3">
      <span className="ds-control flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--ds-radius-control)]"><Headphones className="h-5 w-5" /></span>
      <div className="min-w-0">
        <h3 className="font-emphasis text-sm font-bold">{state.phase === 'ready' ? tl("Il tuo podcast") : tl("Crea un podcast audio")}</h3>
        <p className={`mt-1 ${hintClass}`}>{state.prompt}</p>
      </div>
    </header>
    {state.source_names?.length > 0 && <p className={`mt-3 ${hintClass}`}>{tl("Fonti:")} {state.source_names.join(', ')}</p>}
    {state.phase === 'ready' && state.audio_url ? <div className="mt-4 space-y-3">
      <AudioPlayer src={state.audio_url} title={state.filename || 'Podcast'} />
      <Button asChild tone="accent" surface="solid" density="compact"><a href={`${state.audio_url}?download=true`} download={state.filename}><Download />{tl("Scarica MP3")}</a></Button>
      <p className={`flex items-center gap-1.5 ${hintClass}`}><GripVertical className="h-4 w-4 shrink-0" />{tl("Trascina questo podcast nella chat di classe per condividerlo.")}</p>
      <p className={hintClass}>{tl("Salvato anche nei tuoi Files.")}</p>
      <details className="ds-control rounded-[var(--ds-radius-control)] p-3"><summary className="cursor-pointer text-xs font-semibold">{tl("Leggi il testo")}</summary><p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{state.script}</p></details>
    </div> : <>
      {voices.isLoading && <p role="status" className={`mt-3 ${hintClass}`}>{tl("Caricamento delle voci…")}</p>}
      {voices.isError && <div role="alert" className="mt-3 text-xs text-[var(--logo-pink)]">{messageError(voices.error)} <Button type="button" surface="link" density="compact" onClick={() => void voices.refetch()}>{tl("Riprova")}</Button></div>}
      {voices.data?.length === 0 && <p className={`mt-3 ${hintClass}`}>{tl("Nessuna voce disponibile nell’account ElevenLabs.")}</p>}
      <fieldset disabled={Boolean(busy)} className="mt-4 min-w-0 space-y-4 disabled:opacity-70">
        <div className="space-y-1.5">
          <label htmlFor={`${id}-voice`} className={labelClass}>{tl("Voce")}</label>
          <Select id={`${id}-voice`} aria-label={tl("Voce del podcast")} density="compact" value={options.voice_id} onChange={e => setOptions({ ...options, voice_id: e.target.value })}>
            <option value="" disabled>{tl("Scegli una voce")}</option>
            {voices.data?.map(v => <option key={v.voice_id} value={v.voice_id}>{v.name}{v.labels.language ? ` · ${v.labels.language}` : ''}</option>)}
          </Select>
        </div>
        {voice?.preview_url && <details className="ds-control rounded-[var(--ds-radius-control)] p-3"><summary className="cursor-pointer text-xs font-semibold">{tl("Ascolta un campione di")} {voice.name}</summary><div className="mt-2"><AudioPlayer src={voice.preview_url} title={tl("Campione · {0}", voice.name)} /></div></details>}
        <div className="grid grid-cols-1 gap-4 min-[360px]:grid-cols-2">
          <div className="min-w-0 space-y-1.5"><label htmlFor={`${id}-duration`} className={labelClass}>{tl("Durata indicativa")}</label><Select id={`${id}-duration`} aria-label={tl("Durata del podcast")} density="compact" value={options.duration_minutes} onChange={e => setOptions({ ...options, duration_minutes: Number(e.target.value) })}>{[1, 3, 5, 10].map(n => <option key={n} value={n}>{tl("Circa")} {n} {n === 1 ? 'minuto' : tl("minuti")}</option>)}</Select></div>
          <div className="min-w-0 space-y-1.5"><label htmlFor={`${id}-language`} className={labelClass}>{tl("Lingua")}</label><Select id={`${id}-language`} density="compact" value={options.language} onChange={e => setOptions({ ...options, language: e.target.value })}>{[['it', tl("Italiano")], ['en', tl("Inglese")], ['fr', tl("Francese")], ['es', tl("Spagnolo")], ['de', tl("Tedesco")]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></div>
        </div>
        <div className="space-y-1.5"><label htmlFor={`${id}-tone`} className={labelClass}>{tl("Stile")}</label><Select id={`${id}-tone`} density="compact" value={options.tone} onChange={e => setOptions({ ...options, tone: e.target.value })}>{[['didattico', tl("Spiegazione didattica")], ['conversazionale', tl("Conversazionale")], ['narrativo', tl("Racconto narrativo")]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select></div>
        <div className="space-y-1.5"><label htmlFor={`${id}-audience`} className={labelClass}>{tl("A chi è rivolto?")}</label><Input id={`${id}-audience`} density="compact" maxLength={200} value={options.audience} onChange={e => setOptions({ ...options, audience: e.target.value })} /></div>
        <details className="ds-control rounded-[var(--ds-radius-control)] p-3"><summary className="cursor-pointer text-xs font-semibold">{tl("Personalizza la narrazione")}</summary><div className="mt-4 space-y-4">
          <div className="space-y-2"><label htmlFor={`${id}-speed`} className={labelClass}>{tl("Velocità:")} {options.speed.toFixed(1)}×</label><input id={`${id}-speed`} aria-label={tl("Velocità della narrazione")} type="range" min="0.7" max="1.2" step="0.1" value={options.speed} onChange={e => setOptions({ ...options, speed: Number(e.target.value) })} className="block w-full accent-[var(--app-accent)]" /></div>
          <div className="space-y-2"><label htmlFor={`${id}-stability`} className={labelClass}>{tl("Voce più espressiva ↔ più regolare")}</label><input id={`${id}-stability`} aria-label={tl("Regolarità della voce")} type="range" min="0" max="1" step="0.1" value={options.stability} onChange={e => setOptions({ ...options, stability: Number(e.target.value) })} className="block w-full accent-[var(--app-accent)]" /></div>
          <div className="space-y-1.5"><label htmlFor={`${id}-instructions`} className={labelClass}>{tl("Indicazioni aggiuntive")}</label><Textarea id={`${id}-instructions`} density="compact" rows={3} maxLength={2000} placeholder={tl("Ad esempio: usa esempi concreti e concludi con tre concetti da ricordare")} value={options.instructions} onChange={e => setOptions({ ...options, instructions: e.target.value })} className="font-normal" /></div>
        </div></details>
        <Button type="button" tone="neutral" surface="soft" density="compact" onClick={() => void prepare()} disabled={!options.voice_id || !voices.data?.length}>{state.phase === 'draft' ? tl("Aggiorna anteprima del testo") : tl("Prepara anteprima del testo")}</Button>
      </fieldset>
      {state.phase === 'draft' && <div className="mt-5 space-y-3">
        <div className="ds-divider h-px" />
        <div className="space-y-2"><label htmlFor={`${id}-script`} className={labelClass}>{tl("Testo da leggere")}</label><Textarea id={`${id}-script`} aria-label={tl("Testo del podcast")} disabled={Boolean(busy)} value={script} onChange={e => setScript(e.target.value)} rows={8} maxLength={14000} className="min-h-48 font-normal leading-relaxed" /></div>
        <p className="text-[11px] leading-relaxed text-[var(--text-secondary)]">{script.trim().split(/\s+/).filter(Boolean).length} {tl("parole · durata indicativa. Puoi modificare il testo prima della generazione.")}</p>
        {dirty && <p role="status" className={hintClass}>{tl("Hai modificato le impostazioni: aggiorna l’anteprima per applicarle.")}</p>}
        <Button type="button" tone="accent" surface="solid" density="compact" onClick={() => void generate()} disabled={Boolean(busy) || dirty || !script.trim()}><Headphones />{tl("Genera audio MP3")}</Button>
      </div>}
    </>}
    {busy && <p role="status" className={`mt-4 flex items-center gap-2 ${hintClass}`}><Loader2 className="h-4 w-4 animate-spin" />{busy === 'draft' ? tl("Preparo il testo dalle tue fonti…") : tl("Creo l’audio con ElevenLabs. Può richiedere qualche minuto…")}</p>}
    {error && <p role="alert" className="mt-3 text-xs text-[var(--logo-pink)]">{error}</p>}
  </section>
}
