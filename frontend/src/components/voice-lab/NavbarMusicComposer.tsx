import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input } from '@/design'
import { Loader2, Music } from '@/components/icons'
import { useToast } from '@/components/ui/use-toast'
import { jobsApi, type BackgroundJob } from '@/lib/api'
import { cancelJob, notifyJobsChanged, waitForJob } from '@/lib/backgroundJobs'
import { voiceLabApi, type LabItem } from '@/lib/voiceLab'
import { tl } from '@/i18n/tl'
import { MusicPromptEditor } from './MusicPromptEditor'
import { useVoiceLabQuote } from './useVoiceLabQuote'
import { AudioCover } from './AudioCover'

/** Closing the popup only stops polling: the server job continues and is recovered on reopening. */
export function NavbarMusicComposer({ onPlay }: { onPlay: (item: LabItem) => void }) {
  const [prompt, setPrompt] = useState(''), [seconds, setSeconds] = useState(30)
  const [aiCover, setAiCover] = useState(true)
  const [pending, setPending] = useState(true), [job, setJob] = useState<BackgroundJob | null>(null)
  const [result, setResult] = useState<LabItem | null>(null)
  const controller = useRef(new AbortController())
  const qc = useQueryClient(), { toast } = useToast()
  const config = useQuery({ queryKey: ['voice-lab-config'], queryFn: async () => (await voiceLabApi.config()).data })
  const music = config.data?.music_model
  const maxSeconds = music?.max_seconds ?? 600
  const minSeconds = music?.min_seconds ?? 3
  const quote = useVoiceLabQuote({ tool: 'music', text: prompt, seconds, model: '', dialogue: [], file: null, previewText: '', enabled: !!config.data?.configured })
  const fail = (error: unknown) => {
    if (controller.current.signal.aborted) return
    const detail = (error as { response?: { data?: { detail?: unknown } }; message?: string })?.response?.data?.detail
    toast({ variant: 'destructive', title: tl('Musica non creata'), description: typeof detail === 'string' ? detail : (error as Error)?.message || tl('Riprova tra poco.') })
  }
  const follow = async (id: string, signal: AbortSignal) => {
    const finished = await waitForJob(id, update => { if (!signal.aborted) setJob(update) }, { signal, intervalMs: 1500 })
    if (signal.aborted) return
    notifyJobsChanged()
    if (finished.status === 'cancelled') return
    const item = finished.result?.item as LabItem | undefined
    if (finished.status !== 'succeeded' || !item) throw new Error(finished.error || tl('La generazione non è stata completata.'))
    setResult(item)
    for (const key of ['voice-lab-items', 'audio-files', 'drive', 'credit-balance']) void qc.invalidateQueries({ queryKey: [key] })
    void jobsApi.markSeen([id])
    toast({ title: tl('Brano salvato nella libreria e nei Files') })
    const coverError = (item.details as { cover_error?: string }).cover_error
    if (coverError) toast({ variant: 'destructive', title: tl('Copertina non creata'), description: coverError })
  }
  useEffect(() => {
    const current = controller.current = new AbortController()
    void (async () => {
      try {
        const running = (await jobsApi.list({ kind: 'audio_lab_music', active: true })).data.find(j => j.status === 'running' && j.live)
        if (current.signal.aborted) return
        if (running) await follow(running.id, current.signal)
      } catch (error) { if (!current.signal.aborted) fail(error) }
      finally { if (!current.signal.aborted) { setPending(false); setJob(null) } }
    })()
    return () => current.abort()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const generate = async () => {
    if (pending) return
    setPending(true); setResult(null)
    const signal = controller.current.signal
    try {
      const { data } = await voiceLabApi.generate({ action: 'music', title: prompt.trim().slice(0, 80), text: prompt.trim(), seconds, instrumental: true, cover: aiCover ? 'ai' : 'none' })
      notifyJobsChanged()
      await follow(data.job_id, signal)
    } catch (error) { if (!signal.aborted) fail(error) }
    finally { if (!signal.aborted) { setPending(false); setJob(null) } }
  }
  return <div className="space-y-3 pt-2">
    <fieldset disabled={pending} className="min-w-0 space-y-3">
      <MusicPromptEditor value={prompt} onChange={setPrompt} disabled={pending} compact />
      <label className="block space-y-1 text-xs font-semibold">{tl('Durata in secondi')}<Input type="number" min={minSeconds} max={maxSeconds} step={1} disabled={!!music?.fixed_seconds} value={music?.fixed_seconds ?? (Number.isFinite(seconds) ? seconds : '')} onChange={e => setSeconds(e.target.valueAsNumber)} /></label>
      {music && <p className="text-[11px] text-[var(--text-secondary)]">{tl('Modello: {0} · {1}', music.label, music.price_note)}{music.fixed_seconds ? ` · ${tl('durata fissa {0} s', music.fixed_seconds)}` : ''}</p>}
      <details className="text-xs"><summary className="cursor-pointer text-[var(--text-secondary)]">{tl('Opzioni')}</summary><label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={aiCover} onChange={e => setAiCover(e.target.checked)} />{tl('Genera copertina')}</label></details>
    </fieldset>
    {!config.isLoading && !config.isError && !config.data?.configured && <p role="status" className="text-xs">{tl('La generazione musicale non è ancora configurata.')}</p>}
    {config.isError && <Button tone="neutral" surface="ghost" density="compact" onClick={() => void config.refetch()}>{tl('Riprova connessione')}</Button>}
    <p aria-live="polite" className="text-xs text-[var(--text-secondary)]">{quote.loading ? tl('Calcolo dei crediti…') : quote.error || (quote.data ? tl('Costo stimato{0}: {1} crediti', aiCover ? tl(' con copertina') : '', (quote.data.credits + (aiCover ? config.data?.cover_credits || 0 : 0)).toLocaleString('it-IT', { maximumFractionDigits: 2 })) : '')}</p>
    <Button tone="accent" surface="solid" disabled={pending || !config.data?.configured || !prompt.trim() || !Number.isInteger(seconds) || seconds < minSeconds || seconds > maxSeconds || !quote.data || quote.loading || !!quote.error} onClick={() => void generate()}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music className="h-4 w-4" />}{tl(pending ? 'Generazione in corso…' : 'Genera musica')}
    </Button>
    {pending && <p role="status" className="text-xs text-[var(--text-secondary)]">{job?.progress_label || tl('Verifico le generazioni in corso…')} {tl('Puoi chiudere il player: il brano sarà salvato nella libreria.')}</p>}
    {job && <Button tone="neutral" surface="ghost" density="compact" onClick={() => void cancelJob(job.id)}>{tl('Annulla generazione')}</Button>}
    {result && <div className="flex items-center gap-2"><AudioCover url={result.cover_url} className="h-12 w-12 rounded-xl" /><span className="min-w-0 flex-1 truncate text-xs">{result.title}</span><Button tone="neutral" surface="ghost" density="compact" onClick={() => onPlay(result)}>{tl('Ascolta')}</Button></div>}
  </div>
}
