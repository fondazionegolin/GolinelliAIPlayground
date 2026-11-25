import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Input, Select, Textarea } from '@/design'
import { Loader2, Music, Wand2 } from '@/components/icons'
import { useToast } from '@/components/ui/use-toast'
import { jobsApi, type BackgroundJob } from '@/lib/api'
import { cancelJob, notifyJobsChanged, waitForJob } from '@/lib/backgroundJobs'
import { voiceLabApi, type LabItem } from '@/lib/voiceLab'
import { tl } from '@/i18n/tl'
import { MusicPromptEditor } from './MusicPromptEditor'
import { useVoiceLabQuote } from './useVoiceLabQuote'
import { AudioCover } from './AudioCover'

/** Closing the popup only stops polling: the server job continues and is recovered on reopening. */
export function NavbarMusicComposer({ onPlay, onGenerated }: { onPlay: (item: LabItem) => void; onGenerated?: (item: LabItem) => void }) {
  const [prompt, setPrompt] = useState(''), [seconds, setSeconds] = useState(30)
  const [aiCover, setAiCover] = useState(true)
  const [sung, setSung] = useState(false), [lyrics, setLyrics] = useState(''), [language, setLanguage] = useState('it')
  const [brief, setBrief] = useState(''), [mood, setMood] = useState(''), [structure, setStructure] = useState('classic'), [instruction, setInstruction] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [pending, setPending] = useState(true), [job, setJob] = useState<BackgroundJob | null>(null)
  const [result, setResult] = useState<LabItem | null>(null)
  const controller = useRef(new AbortController())
  const qc = useQueryClient(), { toast } = useToast()
  const config = useQuery({ queryKey: ['voice-lab-config'], queryFn: async () => (await voiceLabApi.config()).data })
  const music = config.data?.music_model
  const maxSeconds = music?.max_seconds ?? 600
  const minSeconds = music?.min_seconds ?? 3
  const quote = useVoiceLabQuote({ tool: 'music', text: prompt, seconds, model: '', dialogue: [], file: null, previewText: '', enabled: !!config.data?.configured })
  const textLength = (prompt.trim() + (sung && lyrics.trim() ? '\n\nLyrics:\n' + lyrics.trim() : '')).length
  const addTag = (tag: string) => setLyrics(v => `${v.trimEnd()}${v.trim() ? '\n\n' : ''}[${tag}]\n`.slice(0, 3000))
  const writeLyrics = async () => {
    if (drafting || brief.trim().length < 3) return
    setDrafting(true)
    try {
      const { data } = await voiceLabApi.draftLyrics({ brief: brief.trim(), language, mood, structure, seconds: Number.isFinite(seconds) ? seconds : 30, current: lyrics, instruction })
      setLyrics(data.lyrics); setInstruction('')
      void qc.invalidateQueries({ queryKey: ['credit-balance'] })
    } catch (error) {
      const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
      toast({ variant: 'destructive', title: tl('Testo non creato'), description: typeof detail === 'string' ? detail : tl('Riprova tra poco.') })
    } finally { setDrafting(false) }
  }
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
    onGenerated?.(item)
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
      const { data } = await voiceLabApi.generate({ action: 'music', title: prompt.trim().slice(0, 80), text: prompt.trim(), seconds, instrumental: !sung, lyrics: sung ? lyrics.trim() : '', language, cover: aiCover ? 'ai' : 'none' })
      notifyJobsChanged()
      await follow(data.job_id, signal)
    } catch (error) { if (!signal.aborted) fail(error) }
    finally { if (!signal.aborted) { setPending(false); setJob(null) } }
  }
  return <div className="space-y-3 pt-2">
    <fieldset disabled={pending} className="min-w-0 space-y-3">
      <MusicPromptEditor value={prompt} onChange={setPrompt} disabled={pending} compact />
      <div className="space-y-2">
        <div role="group" aria-label={tl('Voce')} className="inline-flex gap-1 rounded-[var(--control-radius)] bg-[var(--ds-field-bg)] p-1">
          {[[false, 'Strumentale'], [true, 'Cantato']].map(([value, label]) => <Button key={String(value)} type="button" tone="neutral" surface="ghost" density="compact" aria-pressed={sung === value} className={sung === value ? 'ds-selected' : ''} onClick={() => setSung(value as boolean)}>{tl(label as string)}</Button>)}
        </div>
        {sung && <div className="space-y-3 rounded-2xl bg-[var(--ds-well)] p-3">
          <div className="space-y-2">
            <p className="text-xs font-semibold">{tl('Assistente testi')}</p>
            <Input aria-label={tl('Di cosa parla la canzone')} placeholder={tl('Di cosa parla? Es. una bambina e una scimmia che volano tra le stelle')} maxLength={800} value={brief} onChange={e => setBrief(e.target.value)} />
            <div className="grid gap-2 sm:grid-cols-2">
              <Select aria-label={tl('Lingua del testo')} density="compact" value={language} onChange={e => setLanguage(e.target.value)}>
                {[['it', 'Italiano'], ['en', 'Inglese'], ['es', 'Spagnolo'], ['fr', 'Francese'], ['de', 'Tedesco']].map(([id, name]) => <option key={id} value={id}>{tl(name)}</option>)}
              </Select>
              <Select aria-label={tl('Struttura')} density="compact" value={structure} onChange={e => setStructure(e.target.value)}>
                {[['classic', 'Strofe e ritornello'], ['short', 'Breve: strofa e ritornello'], ['ballad', 'Ballata'], ['rap', 'Rap'], ['nursery', 'Filastrocca'], ['anthem', 'Inno corale']].map(([id, name]) => <option key={id} value={id}>{tl(name)}</option>)}
              </Select>
            </div>
            <Input aria-label={tl('Atmosfera del testo')} placeholder={tl('Atmosfera (facoltativa): nostalgica, ironica, epica…')} maxLength={300} value={mood} onChange={e => setMood(e.target.value)} />
            {lyrics.trim() && <Input aria-label={tl('Cosa cambiare nel testo')} placeholder={tl('Cosa cambiare? Es. più corto, rime più semplici, un ritornello diverso')} maxLength={400} value={instruction} onChange={e => setInstruction(e.target.value)} />}
            <Button type="button" tone="neutral" surface="solid" density="compact" disabled={drafting || brief.trim().length < 3} onClick={() => void writeLyrics()}>
              {drafting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}{tl(drafting ? 'Scrivo il testo…' : lyrics.trim() ? 'Riscrivi il testo' : 'Scrivi il testo')}
            </Button>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-semibold" htmlFor="music-lyrics">{tl('Testo della canzone')}</label>
            <Textarea id="music-lyrics" className="min-h-40" maxLength={3000} placeholder={tl('Scrivi il testo qui oppure fallo preparare dall\'assistente. Usa [Strofa], [Ritornello] per guidare la struttura.')} value={lyrics} onChange={e => setLyrics(e.target.value)} />
            <div className="flex flex-wrap items-center gap-1">
              {['Strofa', 'Ritornello', 'Bridge', 'Finale'].map(tag => <Button key={tag} type="button" tone="neutral" surface="ghost" density="compact" onClick={() => addTag(tag)}>+ {tl(tag)}</Button>)}
              <span className={`ml-auto text-[11px] ${textLength > 4100 ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-secondary)]'}`}>{textLength}/4100</span>
            </div>
          </div>
        </div>}
      </div>
      <label className="block space-y-1 text-xs font-semibold">{tl('Durata in secondi')}<Input type="number" min={minSeconds} max={maxSeconds} step={1} disabled={!!music?.fixed_seconds} value={music?.fixed_seconds ?? (Number.isFinite(seconds) ? seconds : '')} onChange={e => setSeconds(e.target.valueAsNumber)} /></label>
      {music && <p className="text-[11px] text-[var(--text-secondary)]">{tl('Modello: {0} · {1}', music.label, music.price_note)}{music.fixed_seconds ? ` · ${tl('durata fissa {0} s', music.fixed_seconds)}` : ''}</p>}
      <details className="text-xs"><summary className="cursor-pointer text-[var(--text-secondary)]">{tl('Opzioni')}</summary><label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={aiCover} onChange={e => setAiCover(e.target.checked)} />{tl('Genera copertina')}</label></details>
    </fieldset>
    {!config.isLoading && !config.isError && !config.data?.configured && <p role="status" className="text-xs">{tl('La generazione musicale non è ancora configurata.')}</p>}
    {config.isError && <Button tone="neutral" surface="ghost" density="compact" onClick={() => void config.refetch()}>{tl('Riprova connessione')}</Button>}
    <p aria-live="polite" className="text-xs text-[var(--text-secondary)]">{quote.loading ? tl('Calcolo dei crediti…') : quote.error || (quote.data ? tl('Costo stimato{0}: {1} crediti', aiCover ? tl(' con copertina') : '', (quote.data.credits + (aiCover ? config.data?.cover_credits || 0 : 0)).toLocaleString('it-IT', { maximumFractionDigits: 2 })) : '')}</p>
    <Button tone="accent" surface="solid" disabled={pending || !config.data?.configured || !prompt.trim() || (sung && !lyrics.trim()) || textLength > 4100 || !Number.isInteger(seconds) || seconds < minSeconds || seconds > maxSeconds || !quote.data || quote.loading || !!quote.error} onClick={() => void generate()}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Music className="h-4 w-4" />}{tl(pending ? 'Generazione in corso…' : 'Genera musica')}
    </Button>
    {pending && <p role="status" className="text-xs text-[var(--text-secondary)]">{job?.progress_label || tl('Verifico le generazioni in corso…')} {tl('Puoi chiudere il player: il brano sarà salvato nella libreria.')}</p>}
    {job && <Button tone="neutral" surface="ghost" density="compact" onClick={() => void cancelJob(job.id)}>{tl('Annulla generazione')}</Button>}
    {result && <div className="flex items-center gap-2"><AudioCover url={result.cover_url} className="h-12 w-12 rounded-xl" /><span className="min-w-0 flex-1 truncate text-xs">{result.title}</span><Button tone="neutral" surface="ghost" density="compact" onClick={() => onPlay(result)}>{tl('Ascolta')}</Button></div>}
  </div>
}
