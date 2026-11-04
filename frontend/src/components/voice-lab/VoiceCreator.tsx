import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Textarea } from '@/design'
import { Loader2, Sparkles } from '@/components/icons'
import { voiceLabApi, type LabItem } from '@/lib/voiceLab'
import { AudioPlayer, type AudioLoader } from './AudioPlayer'
import { useVoiceLabQuote } from './useVoiceLabQuote'
import { tl } from '@/i18n/tl'
import { buildAccentNavClusterStyle } from '@/lib/navbarGlass'

const load: AudioLoader = async (track, signal) => (await voiceLabApi.content(track.id, signal)).data
const field = 'block space-y-2 text-sm font-semibold'

export function VoiceCreator({ open, configured, onClose, onCreated }: {
  open: boolean; configured: boolean; onClose: () => void; onCreated: (item: LabItem) => void
}) {
  const [mode, setMode] = useState<'description' | 'samples'>('description')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [samples, setSamples] = useState<File[]>([])
  const [consent, setConsent] = useState(false)
  const [previews, setPreviews] = useState<LabItem[]>([])
  const [error, setError] = useState('')
  const quote = useVoiceLabQuote({ tool: mode === 'description' ? 'design' : 'clone', text: '', dialogue: [],
    model: '', seconds: 1, file: null, previewText: '', enabled: open && configured })
  const fail = (error: unknown) => {
    const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
    setError(typeof detail === 'string' ? detail : tl('Impossibile creare la voce. Controlla i dati e riprova.'))
  }
  const design = useMutation({ mutationFn: async () => (await voiceLabApi.design(description, '')).data,
    onSuccess: items => { setPreviews(items); setError('') }, onError: fail })
  const save = useMutation({ mutationFn: async (id: string) => (await voiceLabApi.saveVoice(id, name.trim())).data, onSuccess: onCreated, onError: fail })
  const clone = useMutation({ mutationFn: async () => (await voiceLabApi.clone(name.trim(), description, consent, false, samples)).data, onSuccess: onCreated, onError: fail })
  const busy = design.isPending || save.isPending || clone.isPending
  const sampleBytes = samples.reduce((total, file) => total + file.size, 0)
  return <Dialog open={open} modal={false} onOpenChange={value => { if (!value && !busy) onClose() }}>
    <DialogContent size="lg" showClose={!busy} className="voice-lab-creator max-h-[90dvh] overflow-y-auto text-[var(--text-primary)]"
      onInteractOutside={event => { if ((event.target as Element)?.closest('[data-audio-panel], [data-music-trigger]')) event.preventDefault() }}>
      <DialogHeader><DialogTitle>{tl('Crea una voce')}</DialogTitle><DialogDescription>{tl('Descrivi la voce che immagini oppure parti da campioni audio. Potrai poi usarla per leggere qualsiasi testo.')}</DialogDescription></DialogHeader>
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        <div role="group" aria-label={tl('Come creare la voce')} className="inline-flex max-w-full flex-wrap gap-1.5 p-1.5" style={buildAccentNavClusterStyle()}>
          <Button tone="neutral" surface="ghost" aria-pressed={mode === 'description'} className={mode === 'description' ? 'ds-selected' : ''} onClick={() => { setMode('description'); setError('') }}>{tl('Da una descrizione')}</Button>
          <Button tone="neutral" surface="ghost" aria-pressed={mode === 'samples'} className={mode === 'samples' ? 'ds-selected' : ''} onClick={() => { setMode('samples'); setError('') }}>{tl('Da campioni audio')}</Button>
        </div>
        <label className={field}>{tl('Nome della voce')}<Input maxLength={100} value={name} onChange={e => setName(e.target.value)} placeholder={tl('Per esempio: La voce del laboratorio')} /></label>
        <label className={field}>{tl('Come deve suonare?')}<Textarea rows={4} maxLength={1000} value={description} onChange={e => setDescription(e.target.value)} placeholder={tl('Una voce italiana calda, adulta e sorridente, con tono vivace e ritmo tranquillo.')} /><span className="block text-xs font-normal text-[var(--text-secondary)]">{tl('Descrivi timbro, accento, tono e ritmo.')}</span></label>
        {mode === 'description' ? <>
          <p className="text-sm text-[var(--text-secondary)]">{tl('Creerò alcune anteprime: ascoltale e salva la voce che preferisci.')}</p>
          <p aria-live="polite" className="text-sm text-[var(--text-secondary)]">{quote.loading ? tl('Calcolo dei crediti…') : quote.error || (quote.data ? tl('Costo stimato delle anteprime: {0} crediti', quote.data.credits.toLocaleString('it-IT', { maximumFractionDigits: 2 })) : '')}</p>
          <Button disabled={!configured || !name.trim() || description.trim().length < 20 || !quote.data || quote.loading || !!quote.error} onClick={() => { setError(''); design.mutate() }}><Sparkles className="h-4 w-4" />{tl(previews.length ? 'Genera altre anteprime' : 'Crea le anteprime')}</Button>
          {previews.map((preview, index) => <div key={preview.id} className="voice-lab-options space-y-3 rounded-[var(--control-radius)] p-4">
            <p className="text-sm font-semibold">{tl('Proposta {0}', index + 1)}</p><AudioPlayer tracks={[{ id: preview.id, title: tl('Proposta {0}', index + 1), mime_type: preview.mime_type }]} load={load} queue={false} />
            <Button tone="neutral" surface="outline" disabled={!name.trim()} onClick={() => save.mutate(preview.id)}>{tl('Scegli e salva questa voce')}</Button>
          </div>)}
        </> : <>
          <label className={field}>{tl('Campioni audio')}<Input type="file" multiple accept="audio/*,.mp3,.wav,.m4a,.flac" className="h-auto min-h-12 py-3" onChange={e => setSamples(Array.from(e.target.files || []))} /><span className="block text-xs font-normal text-[var(--text-secondary)]">{tl('Da 1 a 10 registrazioni pulite della stessa voce, fino a 50 MB in totale.')}</span></label>
          {!!samples.length && <ul className="space-y-1 text-xs text-[var(--text-secondary)]">{samples.map((file, index) => <li key={index}>{file.name}</li>)}</ul>}
          {(samples.length > 10 || sampleBytes > 50 * 1024 * 1024) && <p role="alert" className="text-sm text-[var(--brand-red-text)]">{tl('Scegli al massimo 10 campioni, per un totale di 50 MB.')}</p>}
          <label className="flex items-start gap-3 text-sm"><input className="voice-lab-check" type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />{tl('Ho il diritto e il consenso a usare questi campioni per creare la voce.')}</label>
          <Button disabled={!configured || !name.trim() || !samples.length || samples.length > 10 || sampleBytes > 50 * 1024 * 1024 || !consent} onClick={() => { setError(''); clone.mutate() }}>{tl('Crea e salva la voce')}</Button>
        </>}
      </fieldset>
      {busy && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{tl('Creo la voce. Attendi il completamento…')}</p>}
      {error && <p role="alert" className="text-sm text-[var(--brand-red-text)]">{error}</p>}
    </DialogContent>
  </Dialog>
}
