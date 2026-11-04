import { useBackgroundAudio } from '@/components/voice-lab/BackgroundAudio'
import { SectionHeading } from '@/design/primitives/SectionHeading'
import { useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mic, Headphones, Music, Download, Loader2, Plus, RefreshCw, Share2, Library, Trash2 } from '@/components/icons'
import { Button, IconButton, Input, Select, Textarea } from '@/design'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useToast } from '@/components/ui/use-toast'
import { voiceLabApi, type LabItem } from '@/lib/voiceLab'
import { AudioPlayer, type AudioLoader } from '@/components/voice-lab/AudioPlayer'
import { AudioShareDialog } from '@/components/voice-lab/AudioShareDialog'
import { PlaylistWorkspace } from '@/components/voice-lab/PlaylistWorkspace'
import { VoiceCreator } from '@/components/voice-lab/VoiceCreator'
import { useVoiceLabQuote } from '@/components/voice-lab/useVoiceLabQuote'
import '@/components/voice-lab/voice-lab.css'
import { tl } from '@/i18n/tl'
import { buildAccentNavClusterStyle } from '@/lib/navbarGlass'

type Workspace = 'voice' | 'music' | 'playlists' | 'library'
const WORKSPACES = [{ id: 'voice', label: 'Voce', icon: Mic }, { id: 'music', label: 'Musica', icon: Music }, { id: 'playlists', label: 'Playlist', icon: Headphones }] as const
const EXPRESSIONS = [{ label: 'Regolare', value: 1, hint: 'Una lettura uniforme e controllata.' },
  { label: 'Naturale', value: 0.5, hint: 'Un equilibrio tra continuità e variazioni espressive.' },
  { label: 'Espressiva', value: 0, hint: 'Più variazioni di ritmo e intonazione tra le frasi.' }]
const LANGUAGES = [['it', 'Italiano'], ['en', 'English'], ['fr', 'Français'], ['es', 'Español'], ['de', 'Deutsch'], ['pt', 'Português'], ['nl', 'Nederlands'], ['pl', 'Polski'], ['ja', '日本語'], ['zh', '中文'], ['ko', '한국어'], ['ar', 'العربية']]
const panel = 'ui-card min-w-0 rounded-[var(--card-radius)] p-5 text-[var(--text-primary)] sm:p-6'
const hint = 'text-sm leading-6 text-[var(--text-secondary)]'
const loadLabAudio: AudioLoader = async (track, signal) => (await voiceLabApi.content(track.id, signal)).data
const loadVoiceSample: AudioLoader = async track => track.id

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block min-w-0 space-y-2"><span className="block text-sm font-semibold text-[var(--text-primary)]">{label}</span>{children}</label>
}

export default function VoiceLabPage() {
  const audioPlayer = useBackgroundAudio()
  const [params, setParams] = useSearchParams()
  const [workspace, setWorkspace] = useState<Workspace>('voice')
  const [source, setSource] = useState<'text' | 'recording'>('text')
  const [text, setText] = useState('')
  const [voiceTitle, setVoiceTitle] = useState('')
  const [musicTitle, setMusicTitle] = useState('')
  const [musicPrompt, setMusicPrompt] = useState('')
  const [seconds, setSeconds] = useState(30)
  const [instrumental, setInstrumental] = useState(true)
  const [voice, setVoice] = useState('')
  const [model, setModel] = useState('')
  const [language, setLanguage] = useState('it')
  const [format, setFormat] = useState('mp3_44100_128')
  const [speed, setSpeed] = useState(1)
  const [stability, setStability] = useState(0.5)
  const [similarity, setSimilarity] = useState(0.75)
  const [file, setFile] = useState<File | null>(null)
  const [removeNoise, setRemoveNoise] = useState(false)
  const [creatingVoice, setCreatingVoice] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [playlistCandidate, setPlaylistCandidate] = useState('')
  const [librarySearch, setLibrarySearch] = useState('')
  const [previewName, setPreviewName] = useState('')
  const selectedId = params.get('item') || ''
  const qc = useQueryClient()
  const { toast } = useToast()
  const config = useQuery({ queryKey: ['voice-lab-config'], queryFn: async () => (await voiceLabApi.config()).data })
  const configured = !!config.data?.configured
  const voices = useQuery({ queryKey: ['voice-lab-voices'], queryFn: async () => (await voiceLabApi.voices()).data, enabled: configured, staleTime: 30000, retry: false })
  const models = useQuery({ queryKey: ['voice-lab-models'], queryFn: async () => (await voiceLabApi.models()).data, enabled: configured, staleTime: 300000, retry: false })
  const library = useQuery({ queryKey: ['voice-lab-items'], queryFn: async () => (await voiceLabApi.items()).data })
  const selected = useQuery({ queryKey: ['voice-lab-item', selectedId], enabled: !!selectedId, retry: false,
    queryFn: async () => {
      const item = (await voiceLabApi.item(selectedId)).data
      return item.kind === 'dubbing' && item.status === 'processing' ? (await voiceLabApi.refresh(selectedId)).data : item
    }, refetchInterval: query => query.state.data?.status === 'processing' ? 10000 : false })
  const refresh = () => {
    for (const key of ['voice-lab-items', 'voice-lab-voices', 'voice-lab-item', 'drive', 'credit-balance']) void qc.invalidateQueries({ queryKey: [key] })
  }
  const fail = (error: unknown) => {
    const detail = (error as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail
    toast({ variant: 'destructive', title: tl('Operazione non completata'), description: typeof detail === 'string' ? detail : tl('Controlla i dati e riprova.') })
  }
  const done = (item: LabItem) => {
    setParams({ item: item.id }); refresh()
    if (item.voice_id && item.kind === 'voice') { setVoice(item.voice_id); setWorkspace('voice') }
    toast({ title: item.kind === 'voice' ? tl('Voce pronta da usare') : tl('Audio salvato nella libreria e nei Files') })
  }
  const tool = workspace === 'voice' ? source === 'text' ? 'tts' : 'convert' : workspace
  const modelPool = (models.data || []).filter(m => tool === 'convert' ? m.conversion : m.tts)
  const activeModel = modelPool.find(m => m.model_id === model) || modelPool.find(m => m.model_id === config.data?.default_model) || modelPool[0]
  const chosenVoice = voices.data?.find(v => v.voice_id === voice)
  const quote = useVoiceLabQuote({ tool, text: workspace === 'music' ? musicPrompt : text, dialogue: [],
    model: workspace === 'voice' ? activeModel?.model_id || '' : '', seconds: workspace === 'music' ? seconds : 1, file: tool === 'convert' ? file : null, previewText: '', enabled: configured })
  const generate = useMutation({ mutationFn: async () => (await voiceLabApi.generate(workspace === 'music' ? {
    action: 'music', title: musicTitle.trim() || tl('Nuovo brano'), text: musicPrompt, seconds, instrumental,
  } : {
    action: source === 'text' ? 'tts' : 'convert', title: voiceTitle.trim() || tl('Nuovo audio'), text: source === 'text' ? text : '',
    voice_id: voice, model_id: activeModel?.model_id, language, output_format: format, speed, stability, similarity, remove_noise: removeNoise,
  }, workspace === 'voice' && source === 'recording' ? file : null)).data, onSuccess: done, onError: fail })
  const savePreview = useMutation({ mutationFn: async () => (await voiceLabApi.saveVoice(selectedId, previewName.trim())).data, onSuccess: done, onError: fail })
  const deleteVoice = useMutation({ mutationFn: (id: string) => voiceLabApi.deleteVoice(id), onSuccess: () => { setVoice(''); refresh() }, onError: fail })
  const busy = generate.isPending || savePreview.isPending
  const ready = configured && !busy && !!quote.data && !quote.loading && !quote.error && (workspace === 'music'
    ? !!musicPrompt.trim() && seconds >= 3 && seconds <= 600
    : !!chosenVoice && !!activeModel && (source === 'text' ? !!text.trim() && text.length <= Math.min(activeModel.max_characters || 5000, 20000) : !!file && file.size <= 50 * 1024 * 1024))

  async function download(item: LabItem) {
    try {
      const { data } = await voiceLabApi.content(item.id)
      const url = URL.createObjectURL(data), link = document.createElement('a')
      const ext = item.mime_type?.includes('json') ? 'json' : item.mime_type?.includes('wav') ? 'wav' : item.mime_type?.includes('ogg') ? 'ogg' : 'mp3'
      link.href = url; link.download = `${item.title}.${ext}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { fail(error) }
  }

  return <div className="voice-lab-workspace mx-auto max-w-[1280px] space-y-5 p-4 pb-12 md:p-7">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><SectionHeading section="/teacher/voice-lab" className="text-2xl font-bold text-[var(--text-primary)] md:text-3xl" subtitle={<>{tl('Crea una voce, genera musica e raccogli i tuoi audio in playlist.')}</>} subtitleClassName={`mt-1 ${hint}`}>Voice Lab</SectionHeading></div>
      <Button tone="neutral" surface="outline" aria-pressed={workspace === 'library'} disabled={busy} onClick={() => setWorkspace(workspace === 'library' ? 'voice' : 'library')}><Library className="h-4 w-4" />{tl('La mia libreria')}</Button>
    </header>
    <nav aria-label={tl('Strumenti Voice Lab')} className="voice-lab-tabs grid grid-cols-3 gap-1.5 p-1.5" style={buildAccentNavClusterStyle()}>
      {WORKSPACES.map(tab => <Button key={tab.id} tone="neutral" surface="ghost" disabled={busy} aria-current={workspace === tab.id ? 'page' : undefined}
        className={`!h-auto min-h-12 gap-2 py-3 ${workspace === tab.id ? 'ds-selected' : ''}`} onClick={() => setWorkspace(tab.id)}><tab.icon className="h-4 w-4" />{tl(tab.label)}</Button>)}
    </nav>
    {config.data && !configured && <p role="status" className={`${panel} ${hint}`}>{tl('La generazione audio non è ancora attiva. Chiedi all’amministratore di configurare ElevenLabs. La tua libreria e le playlist restano disponibili.')}</p>}
    {config.isError && <p role="alert" className={hint}>{tl('Impossibile verificare la connessione.')} <Button surface="ghost" onClick={() => void config.refetch()}>{tl('Riprova')}</Button></p>}
    {(voices.isError || models.isError) && <p role="alert" className={hint}>{tl('Impossibile caricare le voci.')} <Button surface="ghost" onClick={() => { void voices.refetch(); void models.refetch() }}>{tl('Riprova')}</Button></p>}
    <div className={`grid items-start gap-5 ${workspace === 'voice' || workspace === 'music' ? 'lg:grid-cols-[minmax(0,1fr)_340px]' : ''}`}>
      <section className={`${panel} space-y-6`}>
        {workspace === 'voice' ? <>
          <div><h2 className="text-xl font-bold">{tl('Crea il tuo audio')}</h2><p className={`mt-1 ${hint}`}>{tl('Inserisci un testo oppure carica una registrazione. Poi scegli la voce.')}</p></div>
          <fieldset disabled={busy} className="min-w-0 space-y-5">
            <div role="group" aria-label={tl('Tipo di input')} className="inline-flex max-w-full flex-wrap gap-1.5 p-1.5" style={buildAccentNavClusterStyle()}>
              <Button tone="neutral" surface="ghost" aria-pressed={source === 'text'} onClick={() => setSource('text')} className={source === 'text' ? 'ds-selected' : ''}>{tl('Da un testo')}</Button>
              <Button tone="neutral" surface="ghost" aria-pressed={source === 'recording'} onClick={() => setSource('recording')} className={source === 'recording' ? 'ds-selected' : ''}>{tl('Da una registrazione')}</Button>
            </div>
            {source === 'text' ? <Field label={tl('Testo da leggere')}>
              <Textarea rows={8} maxLength={Math.min(activeModel?.max_characters || 20000, 20000)} value={text} onChange={e => setText(e.target.value)} placeholder={tl('Scrivi o incolla qui il testo che vuoi ascoltare…')} />
              <span className="block text-right text-xs text-[var(--text-muted)]">{text.length.toLocaleString('it-IT')} / {Math.min(activeModel?.max_characters || 20000, 20000).toLocaleString('it-IT')} {tl('caratteri')}</span>
            </Field> : <Field label={tl('Registrazione audio')}><Input type="file" accept="audio/*,.mp3,.wav,.m4a,.flac" onChange={e => setFile(e.target.files?.[0] || null)} className="h-auto min-h-12 py-3" />
              <span className={`block ${hint}`}>{tl('Scegli un file fino a 50 MB. La nuova voce conserverà l’espressione della registrazione.')}</span>
              {file && file.size > 50 * 1024 * 1024 && <span role="alert" className="block text-sm text-[var(--brand-red-text)]">{tl('Il file supera 50 MB. Scegli una registrazione più breve.')}</span>}
            </Field>}
            <div className="flex flex-wrap items-end gap-3"><div className="min-w-0 flex-1"><Field label={tl('Voce')}><SearchableSelect value={voice} onChange={setVoice} label={tl('Scegli una voce')}
              options={(voices.data || []).map(v => ({ value: v.voice_id, label: v.name, description: v.owned ? tl('Creata da te') : v.description || v.category, searchText: v.voice_id }))} disabled={!configured || busy} /></Field></div>
              <Button tone="neutral" surface="outline" disabled={!configured} onClick={() => setCreatingVoice(true)}><Plus className="h-4 w-4" />{tl('Crea una voce')}</Button></div>
            {chosenVoice?.preview_url?.startsWith('https://') && <details className="text-sm"><summary className="cursor-pointer font-semibold text-[var(--text-secondary)]">{tl('Ascolta la voce scelta')}</summary><div className="mt-3"><AudioPlayer tracks={[{ id: chosenVoice.preview_url, title: chosenVoice.name }]} load={loadVoiceSample} queue={false} /></div></details>}
            {source === 'text' && <>
              <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold">{tl('Espressività')}</legend><div className="grid grid-cols-3 gap-1.5 p-1.5" style={buildAccentNavClusterStyle()}>{EXPRESSIONS.map(expression => <Button key={expression.value} tone="neutral" surface="ghost" aria-pressed={stability === expression.value}
                className={stability === expression.value ? 'ds-selected' : ''} onClick={() => setStability(expression.value)}>{tl(expression.label)}</Button>)}</div><p className={hint}>{tl(EXPRESSIONS.find(e => e.value === stability)!.hint)}</p></fieldset>
              <Field label={tl('Velocità · {0}×', speed.toFixed(2))}><input aria-label={tl('Velocità della voce')} className="voice-lab-range w-full" type="range" min="0.7" max="1.2" step="0.05" value={speed} onChange={e => setSpeed(Number(e.target.value))} /><span className="flex justify-between text-xs text-[var(--text-muted)]"><span>{tl('Più lenta')}</span><span>{tl('Più veloce')}</span></span></Field>
            </>}
            <details className="voice-lab-options rounded-[var(--control-radius)] p-4"><summary className="cursor-pointer text-sm font-semibold">{tl('Opzioni audio')}</summary><div className="mt-4 space-y-4">
              <Field label={tl('Titolo dell’audio (facoltativo)')}><Input maxLength={200} value={voiceTitle} onChange={e => setVoiceTitle(e.target.value)} placeholder={tl('Per esempio: Introduzione alla lezione')} /></Field>
              {source === 'text' && <Field label={tl('Lingua')}><Select value={language} onChange={e => setLanguage(e.target.value)}>{LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</Select></Field>}
              <Field label={tl('Modello vocale')}><SearchableSelect value={activeModel?.model_id || ''} onChange={setModel} label={tl('Scegli un modello')} options={modelPool.map(m => ({ value: m.model_id, label: m.name }))} disabled={!configured} /></Field>
              <Field label={tl('Formato audio')}><Select value={format} onChange={e => setFormat(e.target.value)}>{(config.data?.output_formats || ['mp3_44100_128']).map(f => <option key={f} value={f}>{f.startsWith('mp3') ? `MP3 · ${f.endsWith('192') ? '192' : '128'} kbps` : f.startsWith('wav') ? 'WAV · 44.1 kHz' : 'Opus · 128 kbps'}</option>)}</Select></Field>
              {source === 'text' ? <Field label={tl('Fedeltà alla voce · {0}%', Math.round(similarity * 100))}><input aria-label={tl('Fedeltà alla voce')} className="voice-lab-range w-full" type="range" min="0" max="1" step="0.05" value={similarity} onChange={e => setSimilarity(Number(e.target.value))} /></Field>
                : <label className="flex items-center gap-2 text-sm"><input className="voice-lab-check" type="checkbox" checked={removeNoise} onChange={e => setRemoveNoise(e.target.checked)} />{tl('Riduci il rumore di fondo')}</label>}
            </div></details>
          </fieldset>
        </> : workspace === 'music' ? <>
          <div><h2 className="text-xl font-bold">{tl('Crea un brano musicale')}</h2><p className={`mt-1 ${hint}`}>{tl('Descrivi l’atmosfera, gli strumenti e il ritmo che hai in mente.')}</p></div>
          <fieldset disabled={busy} className="space-y-5">
            <Field label={tl('Come deve suonare la musica?')}><Textarea rows={7} maxLength={4100} value={musicPrompt} onChange={e => setMusicPrompt(e.target.value)} placeholder={tl('Per esempio: musica calma con pianoforte e archi, senza canto, per accompagnare una lettura in classe.')} /></Field>
            <div className="grid gap-4 sm:grid-cols-2"><Field label={tl('Durata in secondi')}><Input type="number" min={3} max={600} value={Number.isFinite(seconds) ? seconds : ''} onChange={e => setSeconds(e.target.valueAsNumber)} /><span className="block text-xs text-[var(--text-muted)]">{tl('Da 3 secondi a 10 minuti.')}</span></Field>
              <Field label={tl('Titolo (facoltativo)')}><Input maxLength={200} value={musicTitle} onChange={e => setMusicTitle(e.target.value)} placeholder={tl('Dai un nome al brano')} /></Field></div>
            <label className="flex items-center gap-3 text-sm font-medium"><input className="voice-lab-check" type="checkbox" checked={instrumental} onChange={e => setInstrumental(e.target.checked)} />{tl('Solo strumenti, senza canto')}</label>
          </fieldset>
        </> : workspace === 'playlists' ? <>
          <div><h2 className="text-xl font-bold">{tl('Le tue playlist')}</h2><p className={`mt-1 ${hint}`}>{tl('Raccogli voci e musica, scegli l’ordine delle tracce e condividi con la classe.')}</p></div>
          <PlaylistWorkspace items={library.data || []} candidate={playlistCandidate} />
        </> : <>
          <div><h2 className="text-xl font-bold">{tl('La mia libreria')}</h2><p className={`mt-1 ${hint}`}>{tl('Ritrova le tue voci e gli audio salvati.')}</p></div>
          <Input aria-label={tl('Cerca nella libreria')} placeholder={tl('Cerca un audio o una voce…')} value={librarySearch} onChange={e => setLibrarySearch(e.target.value)} />
          {library.isLoading && <p role="status">{tl('Carico la libreria…')}</p>}
          {library.isError && <p role="alert">{tl('Impossibile caricare la libreria.')} <Button surface="ghost" onClick={() => void library.refetch()}>{tl('Riprova')}</Button></p>}
          <div className="grid gap-3 sm:grid-cols-2">{(library.data || []).filter(item => item.title.toLowerCase().includes(librarySearch.toLowerCase())).map(item => <article key={item.id} className="voice-lab-options space-y-3 rounded-[var(--control-radius)] p-4">
            <h3 className="font-semibold">{item.title}</h3><p className="text-xs text-[var(--text-muted)]">{tl(item.kind === 'voice' ? 'Voce personalizzata' : item.service === 'music' ? 'Musica' : item.kind === 'preview' ? 'Anteprima voce' : 'Audio')} · {new Date(item.created_at).toLocaleDateString('it-IT')}</p>
            <div className="flex flex-wrap gap-2"><Button density="compact" tone="neutral" surface="outline" onClick={() => { setParams({ item: item.id }); setWorkspace(item.service === 'music' ? 'music' : 'voice'); if (item.mime_type?.startsWith('audio/')) audioPlayer.playTracks([{ id: item.id, title: item.title, mime_type: item.mime_type }], loadLabAudio) }}>{tl(item.kind === 'voice' ? 'Apri voce' : 'Apri e ascolta')}</Button>
              {item.kind === 'voice' && <IconButton aria-label={tl('Elimina voce {0}', item.title)} tone="danger" surface="ghost" disabled={deleteVoice.isPending} onClick={() => { if (window.confirm(tl('Eliminare definitivamente la voce {0}?', item.title))) deleteVoice.mutate(item.id) }}><Trash2 className="h-4 w-4" /></IconButton>}</div>
          </article>)}</div>
          {!library.isLoading && !library.isError && !(library.data || []).filter(item => item.title.toLowerCase().includes(librarySearch.toLowerCase())).length && <p className={hint}>{tl(librarySearch ? 'Nessun risultato per questa ricerca.' : 'I tuoi primi audio compariranno qui.')}</p>}
        </>}
        {(workspace === 'voice' || workspace === 'music') && <div className="space-y-3">
          <QuoteDisplay quote={quote} />
          <Button tone="accent" surface="solid" disabled={!ready} onClick={() => generate.mutate()}>{generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : workspace === 'music' ? <Music className="h-4 w-4" /> : <Mic className="h-4 w-4" />}{tl(generate.isPending ? 'Generazione in corso…' : workspace === 'music' ? 'Genera musica' : 'Genera voce')}</Button>
          <p className="text-xs leading-5 text-[var(--text-muted)]">{tl('L’audio viene salvato automaticamente nei tuoi Files. Ascolto e download non consumano crediti.')}</p>
        </div>}
      </section>
      {(workspace === 'voice' || workspace === 'music') && <aside className={`${panel} space-y-4 lg:sticky lg:top-5`} aria-label={tl('Risultato Voice Lab')}>
        <div className="flex items-center justify-between gap-3"><h2 className="font-bold">{tl('Il tuo audio')}</h2>{selectedId && <IconButton tone="neutral" surface="ghost" aria-label={tl('Aggiorna risultato')} onClick={() => void selected.refetch()}><RefreshCw className={`h-4 w-4 ${selected.isFetching ? 'animate-spin' : ''}`} /></IconButton>}</div>
        {generate.isPending && <p role="status" className={hint}>{tl('Sto creando il tuo audio. Il risultato apparirà qui.')}</p>}
        {selected.isLoading && <Loader2 aria-label={tl('Caricamento audio')} className="h-5 w-5 animate-spin" />}
        {selected.isError && <p role="alert" className={hint}>{tl('Audio non disponibile. Prova ad aprirlo dalla libreria.')}</p>}
        {selected.data ? <>
          <h3 className="break-words text-lg font-semibold">{selected.data.title}</h3>
          {selected.data.status === 'processing' && <p role="status" className={hint}>{tl('Audio in lavorazione. Lo ritroverai nella libreria.')}</p>}
          {selected.data.status === 'failed' && <p role="alert" className={hint}>{tl('La generazione non è stata completata.')}</p>}
          {selected.data.mime_type?.startsWith('audio/') && <AudioPlayer key={selected.data.id} tracks={[{ id: selected.data.id, title: selected.data.title, mime_type: selected.data.mime_type }]} load={loadLabAudio} queue={false} />}
          {selected.data.kind === 'voice' && <><p className={hint}>{tl(selected.data.details.requires_verification ? 'La voce richiede la verifica nel tuo account ElevenLabs prima dell’uso.' : 'La tua voce è pronta. Selezionala per leggere il testo.')}</p><Button tone="neutral" surface="outline" disabled={!!selected.data.details.requires_verification} onClick={() => { setVoice(selected.data!.voice_id || ''); setSource('text') }}>{tl('Usa questa voce')}</Button></>}
          {selected.data.kind === 'preview' && !selected.data.details.saved_voice_id && <><Field label={tl('Nome della voce')}><Input value={previewName} maxLength={100} onChange={e => setPreviewName(e.target.value)} placeholder={tl('La mia voce narrante')} /></Field><Button disabled={busy || !previewName.trim()} onClick={() => savePreview.mutate()}>{tl('Salva questa voce')}</Button></>}
          {selected.data.details.transcript?.text && <p className="max-h-72 overflow-auto whitespace-pre-wrap text-sm">{selected.data.details.transcript.text}</p>}
          <div className="flex flex-col gap-2">
            {selected.data.content_url && <Button tone="neutral" surface="outline" fullWidth onClick={() => void download(selected.data!)}><Download className="h-4 w-4" />{tl('Scarica')}</Button>}
            {selected.data.mime_type?.startsWith('audio/') && <Button tone="neutral" surface="outline" fullWidth onClick={() => { setPlaylistCandidate(selected.data.details.drive_item_id || selectedId); setWorkspace('playlists') }}><Plus className="h-4 w-4" />{tl('Aggiungi a una playlist')}</Button>}
            {selected.data.details.drive_item_id && <Button tone="neutral" surface="outline" fullWidth onClick={() => setSharing(true)}><Share2 className="h-4 w-4" />{tl('Condividi con la classe')}</Button>}
          </div>
          {selected.data.details.credits !== undefined && <p className="text-xs text-[var(--text-muted)]">{tl('Consumo: {0} crediti', selected.data.details.credits.toLocaleString('it-IT', { maximumFractionDigits: 2 }))}</p>}
        </> : !selectedId && <div className="py-7 text-center"><Headphones className="mx-auto mb-3 h-9 w-9 text-[var(--text-secondary)]" /><p className={hint}>{tl('Genera il primo audio: qui potrai ascoltarlo, scaricarlo e aggiungerlo a una playlist.')}</p></div>}
      </aside>}
    </div>
    <VoiceCreator open={creatingVoice} configured={configured} onClose={() => setCreatingVoice(false)} onCreated={item => { done(item); setCreatingVoice(false) }} />
    {sharing && selected.data?.details.drive_item_id && <AudioShareDialog itemId={selected.data.details.drive_item_id} title={selected.data.title} onClose={() => setSharing(false)} />}
  </div>
}

function QuoteDisplay({ quote }: { quote: ReturnType<typeof useVoiceLabQuote> }) {
  return <div aria-live="polite" className="text-sm text-[var(--text-secondary)]">{quote.loading ? tl('Calcolo dei crediti…') : quote.error ? <span role="alert">{quote.error}</span> : quote.data
    ? tl('Costo stimato: {0} crediti', quote.data.credits.toLocaleString('it-IT', { maximumFractionDigits: 2 })) : tl('Completa i dati per calcolare i crediti.')}</div>
}
