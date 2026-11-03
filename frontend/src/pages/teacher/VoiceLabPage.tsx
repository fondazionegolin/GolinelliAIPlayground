import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Mic, Headphones, Music, FileText, Sparkles, Users, Download, Loader2, Plus, Trash2, RefreshCw, Check, Volume2 } from '@/components/icons'
import { Button, Input, Select, Textarea } from '@/design'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { useToast } from '@/components/ui/use-toast'
import { voiceLabApi, type LabItem, type VoiceLabAction } from '@/lib/voiceLab'
import { tl } from '@/i18n/tl'

type Tool = VoiceLabAction | 'voices' | 'clone' | 'design' | 'library'
const TOOLS: { id: Tool; label: string; description: string; icon: typeof Mic }[] = [
  { id: 'tts', label: 'Testo in voce', description: 'Trasforma un testo in un audio con la voce che scegli.', icon: Mic },
  { id: 'dialogue', label: 'Dialoghi', description: 'Crea una conversazione con più personaggi e voci.', icon: Users },
  { id: 'voices', label: 'Voci disponibili', description: 'Ascolta le voci disponibili e ritrova quelle che hai creato.', icon: Headphones },
  { id: 'clone', label: 'Clona una voce', description: 'Crea e salva una voce a partire da campioni audio autorizzati.', icon: Plus },
  { id: 'design', label: 'Crea una voce', description: 'Descrivi una nuova voce, ascolta le proposte e salva la tua preferita.', icon: Sparkles },
  { id: 'convert', label: 'Cambia voce', description: 'Trasforma la voce di una registrazione mantenendone l’espressione.', icon: Volume2 },
  { id: 'transcribe', label: 'Trascrivi', description: 'Ottieni il testo di una registrazione, anche con più interlocutori.', icon: FileText },
  { id: 'isolate', label: 'Isola la voce', description: 'Riduci rumori e sottofondo per mettere in primo piano il parlato.', icon: Headphones },
  { id: 'sound_effects', label: 'Effetti sonori', description: 'Descrivi un suono e crea un effetto audio.', icon: Sparkles },
  { id: 'music', label: 'Musica', description: 'Genera un brano musicale da una descrizione.', icon: Music },
  { id: 'dubbing', label: 'Doppiaggio', description: 'Traduci e doppia una registrazione in un’altra lingua.', icon: Users },
  { id: 'alignment', label: 'Testo e tempi', description: 'Sincronizza un testo con la registrazione e ottieni i tempi delle parole.', icon: FileText },
  { id: 'library', label: 'La mia libreria', description: 'Audio, trascrizioni, anteprime e voci salvate nel tuo spazio.', icon: Headphones },
]
const LANGUAGES = [['it', 'Italiano'], ['en', 'English'], ['fr', 'Français'], ['es', 'Español'], ['de', 'Deutsch'], ['pt', 'Português'], ['nl', 'Nederlands'], ['pl', 'Polski'], ['ja', '日本語'], ['zh', '中文'], ['ko', '한국어'], ['ar', 'العربية']]
const fieldClass = 'block text-xs font-semibold text-[var(--text-primary)]'
const panelClass = 'rounded-2xl border border-[var(--border-color,#d8d6df)] bg-[var(--surface-elevated)] p-5'

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="block space-y-2"><span className={fieldClass}>{label}</span>{children}{hint && <span className="block text-xs leading-5 text-[var(--text-muted)]">{hint}</span>}</label>
}

function AudioPreview({ item }: { item: LabItem }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!item.content_url || !item.mime_type?.startsWith('audio/')) return
    const controller = new AbortController()
    let objectUrl = ''
    setUrl(''); setError(false)
    voiceLabApi.content(item.id, controller.signal).then(({ data }) => {
      if (controller.signal.aborted) return
      objectUrl = URL.createObjectURL(data); setUrl(objectUrl)
    }).catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [item.id, item.content_url, item.mime_type])
  if (error) return <p role="alert" className="text-sm text-[var(--text-primary)]">{tl('Impossibile caricare questo audio.')}</p>
  return url ? <audio controls src={url} className="w-full" preload="metadata" /> : <p className="flex items-center gap-2 text-xs text-[var(--text-muted)]"><Loader2 className="h-4 w-4 animate-spin" />{tl('Carico l’audio…')}</p>
}

export default function VoiceLabPage() {
  const [params, setParams] = useSearchParams()
  const [tool, setTool] = useState<Tool>('tts')
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [voice, setVoice] = useState('')
  const [model, setModel] = useState('')
  const [language, setLanguage] = useState('it')
  const [sourceLanguage, setSourceLanguage] = useState('auto')
  const [format, setFormat] = useState('mp3_44100_128')
  const [speed, setSpeed] = useState(1)
  const [stability, setStability] = useState(0.5)
  const [seconds, setSeconds] = useState(10)
  const [diarize, setDiarize] = useState(true)
  const [instrumental, setInstrumental] = useState(true)
  const [removeNoise, setRemoveNoise] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [samples, setSamples] = useState<File[]>([])
  const [consent, setConsent] = useState(false)
  const [voiceName, setVoiceName] = useState('')
  const [description, setDescription] = useState('')
  const [previewText, setPreviewText] = useState('')
  const [remix, setRemix] = useState(false)
  const [voiceSearch, setVoiceSearch] = useState('')
  const [librarySearch, setLibrarySearch] = useState('')
  const [previews, setPreviews] = useState<LabItem[]>([])
  const [dialogue, setDialogue] = useState([{ text: '', voice_id: '' }, { text: '', voice_id: '' }])
  const selectedId = params.get('item') || ''
  const qc = useQueryClient()
  const { toast } = useToast()
  const config = useQuery({ queryKey: ['voice-lab-config'], queryFn: async () => (await voiceLabApi.config()).data })
  const configured = !!config.data?.configured
  const voices = useQuery({ queryKey: ['voice-lab-voices'], queryFn: async () => (await voiceLabApi.voices()).data, enabled: configured, staleTime: 30000, retry: false })
  const models = useQuery({ queryKey: ['voice-lab-models'], queryFn: async () => (await voiceLabApi.models()).data, enabled: configured, staleTime: 300000, retry: false })
  const library = useQuery({ queryKey: ['voice-lab-items'], queryFn: async () => (await voiceLabApi.items()).data })
  const selected = useQuery({
    queryKey: ['voice-lab-item', selectedId], enabled: !!selectedId, retry: false,
    queryFn: async () => {
      const item = (await voiceLabApi.item(selectedId)).data
      return item.kind === 'dubbing' && item.status === 'processing' ? (await voiceLabApi.refresh(selectedId)).data : item
    },
    refetchInterval: (query) => query.state.data?.status === 'processing' ? 10000 : false,
  })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['voice-lab-items'] })
    void qc.invalidateQueries({ queryKey: ['voice-lab-voices'] })
    void qc.invalidateQueries({ queryKey: ['voice-lab-item'] })
  }
  const fail = (error: any) => toast({ variant: 'destructive', title: tl('Operazione non completata'), description: error?.response?.data?.detail || tl('Impossibile completare la richiesta. Riprova tra poco.') })
  const done = (item: LabItem) => {
    setParams({ item: item.id }); refresh()
    if (item.voice_id) setVoice(item.voice_id)
    toast({ title: item.kind === 'dubbing' ? tl('Doppiaggio avviato') : item.kind === 'voice' ? tl('Voce salvata') : tl('Risultato salvato nella libreria e nei Files') })
  }
  const generate = useMutation({ mutationFn: async () => (await voiceLabApi.generate({
    action: tool, title: title.trim() || tl(activeTool.label), text, voice_id: ['tts', 'convert'].includes(tool) ? voice || undefined : undefined,
    model_id: ['tts', 'convert'].includes(tool) ? activeModel?.model_id : undefined, language, source_language: sourceLanguage,
    output_format: format, speed, stability, seconds, instrumental, diarize, remove_noise: removeNoise,
    dialogue: tool === 'dialogue' ? dialogue : [],
  }, file)).data, onSuccess: done, onError: fail })
  const clone = useMutation({ mutationFn: async () => (await voiceLabApi.clone(voiceName, description, consent, removeNoise, samples)).data, onSuccess: done, onError: fail })
  const design = useMutation({ mutationFn: async () => (await voiceLabApi.design(description, previewText, remix ? voice : undefined)).data,
    onSuccess: (items) => { setPreviews(items); if (items[0]) setParams({ item: items[0].id }); refresh() }, onError: fail })
  const saveVoice = useMutation({ mutationFn: async (id: string) => (await voiceLabApi.saveVoice(id, voiceName)).data, onSuccess: done, onError: fail })
  const deleteVoice = useMutation({ mutationFn: (id: string) => voiceLabApi.deleteVoice(id), onSuccess: () => { setVoice(''); refresh() }, onError: fail })
  const busy = generate.isPending || clone.isPending || design.isPending || saveVoice.isPending
  const activeTool = TOOLS.find((t) => t.id === tool)!
  const modelPool = (models.data || []).filter((m) => tool === 'convert' ? m.conversion : m.tts)
  const activeModel = modelPool.find((m) => m.model_id === model) || modelPool.find((m) => m.model_id === config.data?.default_model) || modelPool[0]
  const voiceOptions = (voices.data || []).map((v) => ({ value: v.voice_id, label: v.name, description: v.owned ? tl('La mia voce') : v.description || v.category, searchText: v.voice_id }))
  const fileTool = ['convert', 'transcribe', 'isolate', 'alignment', 'dubbing'].includes(tool)
  const textTool = ['tts', 'sound_effects', 'music', 'alignment'].includes(tool)
  const canGenerate = configured && !busy && (!fileTool || !!file) && (!textTool || !!text.trim()) &&
    (!['tts', 'convert'].includes(tool) || !!voice) && (tool !== 'dialogue' || dialogue.every((v) => v.voice_id && v.text.trim()))

  async function download(item: LabItem) {
    try {
      const { data } = await voiceLabApi.content(item.id)
      const url = URL.createObjectURL(data)
      const link = document.createElement('a')
      link.href = url
      const ext = item.mime_type?.includes('json') ? 'json' : item.mime_type?.includes('wav') ? 'wav' : item.mime_type?.includes('ogg') ? 'ogg' : 'mp3'
      link.download = `${item.title}.${ext}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) { fail(error) }
  }

  return <div className="mx-auto max-w-[1480px] space-y-6 p-4 pb-12 md:p-7">
    <header className="relative flex min-h-[200px] items-center justify-between gap-4 overflow-hidden rounded-3xl border border-[var(--app-accent-border)] bg-[var(--app-accent-soft)] px-6 py-5 md:px-9">
      <div className="z-10 max-w-2xl">
        <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--app-accent)]">{tl('Crea · Solo docenti')}</span>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-[var(--text-primary)] md:text-4xl">Voice Lab</h1>
        <p className="mt-3 max-w-lg text-sm leading-6 text-[var(--text-primary)]">{tl('Dai voce alle tue idee. Crea audio, progetta voci e trasforma le registrazioni con gli strumenti ElevenLabs.')}</p>
        <p className="mt-2 text-xs text-[var(--text-muted)]">{tl('Le tue voci e i tuoi risultati rimangono nel tuo spazio personale.')}</p>
      </div>
      <img src="/illustrations/nav/voice-lab.webp" alt="" className="hidden h-52 w-52 shrink-0 object-contain sm:block lg:h-60 lg:w-60" />
    </header>
    {config.data && !configured && <div role="status" className={panelClass}><b>{tl('ElevenLabs non è ancora configurato.')}</b><p className="mt-1 text-sm text-[var(--text-muted)]">{tl('La sezione è pronta. Chiedi all’amministratore di attivare la connessione per usare gli strumenti audio.')}</p></div>}
    {config.isError && <p role="alert">{tl('Impossibile verificare la connessione a ElevenLabs.')}</p>}
    {(voices.isError || models.isError) && <div role="alert" className={panelClass}>{tl('Impossibile caricare voci o modelli. Verifica la connessione e i permessi della chiave ElevenLabs.')} <Button surface="ghost" onClick={() => { void voices.refetch(); void models.refetch() }}>{tl('Riprova')}</Button></div>}
    <div className="grid items-start gap-5 lg:grid-cols-[210px_minmax(0,1fr)] xl:grid-cols-[210px_minmax(0,1fr)_340px]">
      <nav aria-label={tl('Strumenti Voice Lab')} className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-1">
        {TOOLS.map((tab) => <button key={tab.id} type="button" aria-current={tool === tab.id ? 'page' : undefined} disabled={busy}
          onClick={() => { setTool(tab.id); if (tab.id === 'sound_effects') setSeconds((n) => Math.min(n, 30)); if (tab.id === 'music') setSeconds((n) => Math.max(n, 3)) }}
          className={`flex items-center gap-2 rounded-xl px-3 py-3 text-left text-xs font-semibold transition-colors ${tool === tab.id ? 'bg-[var(--app-accent-soft)] text-[var(--app-accent)] shadow-[inset_3px_0_0_var(--app-accent)]' : 'text-[var(--text-primary)] hover:bg-[var(--surface-muted)]'}`}>
          <tab.icon className="h-4 w-4 shrink-0" />{tl(tab.label)}
        </button>)}
      </nav>
      <section className={`${panelClass} min-w-0 space-y-5`}>
        <div><h2 className="text-xl font-bold text-[var(--text-primary)]">{tl(activeTool.label)}</h2><p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">{tl(activeTool.description)}</p></div>
        {tool === 'voices' ? <>
          <Input value={voiceSearch} onChange={(e) => setVoiceSearch(e.target.value)} placeholder={tl('Cerca una voce…')} aria-label={tl('Cerca una voce')} />
          {voices.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
          <div className="space-y-3">{(voices.data || []).filter((v) => `${v.name} ${v.description}`.toLowerCase().includes(voiceSearch.toLowerCase())).map((v) => <article key={v.voice_id} className="space-y-3 rounded-xl border border-[var(--border-color,#d8d6df)] p-4">
            <div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold text-[var(--text-primary)]">{v.name}</h3><p className="text-xs text-[var(--text-muted)]">{v.owned ? tl('Creata da te') : v.description || v.category}</p></div>{v.owned && <Check className="h-4 w-4 text-[var(--app-accent)]" />}</div>
            {v.preview_url?.startsWith('https://') && <audio controls src={v.preview_url} preload="none" className="w-full" />}
            <div className="flex gap-2"><Button density="compact" onClick={() => { setVoice(v.voice_id); setTool('tts') }}>{tl('Usa questa voce')}</Button>{v.owned && v.item_id && <Button density="compact" surface="ghost" disabled={deleteVoice.isPending} onClick={() => { if (window.confirm(tl('Eliminare definitivamente la voce {0}?', v.name))) deleteVoice.mutate(v.item_id!) }}><Trash2 className="h-3.5 w-3.5" />{tl('Elimina')}</Button>}</div>
          </article>)}</div>
          {configured && !voices.isLoading && !voices.data?.length && <p className="text-sm text-[var(--text-muted)]">{tl('Nessuna voce disponibile. Puoi crearne o clonarne una da questo laboratorio.')}</p>}
        </> : tool === 'library' ? <>
          <Input aria-label={tl('Cerca nella libreria')} placeholder={tl('Cerca nella libreria…')} value={librarySearch} onChange={(e) => setLibrarySearch(e.target.value)} />
          <div className="space-y-2">{(library.data || []).filter((item) => item.title.toLowerCase().includes(librarySearch.toLowerCase())).map((item) => <button type="button" key={item.id} onClick={() => setParams({ item: item.id })} className="flex w-full items-center justify-between gap-3 rounded-xl border border-[var(--border-color,#d8d6df)] p-4 text-left hover:bg-[var(--surface-muted)]"><span className="min-w-0"><b className="block truncate text-sm text-[var(--text-primary)]">{item.title}</b><span className="text-xs text-[var(--text-muted)]">{tl(TOOLS.find((t) => t.id === item.service)?.label || (item.kind === 'preview' ? 'Anteprima voce' : 'Voce'))} · {new Date(item.created_at).toLocaleDateString('it-IT')}</span></span><span className="text-[10px] text-[var(--text-muted)]">{item.status === 'processing' ? tl('In lavorazione') : item.status === 'failed' ? tl('Non riuscito') : tl('Salvato')}</span></button>)}</div>
          {!library.data?.length && <p className="text-sm text-[var(--text-muted)]">{tl('Qui troverai gli audio, le voci e le trascrizioni che crei.')}</p>}
        </> : tool === 'clone' ? <>
          <Field label={tl('Nome della nuova voce')}><Input maxLength={100} value={voiceName} onChange={(e) => setVoiceName(e.target.value)} placeholder={tl('Per esempio: La mia voce narrante')} /></Field>
          <Field label={tl('Descrizione')}><Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={3} /></Field>
          <Field label={tl('Campioni audio')} hint={tl('Da 1 a 10 registrazioni pulite della stessa voce, fino a 50 MB in totale.')}><input type="file" accept="audio/*,.mp3,.wav,.m4a,.flac" multiple onChange={(e) => setSamples(Array.from(e.target.files || []))} className="w-full text-sm text-[var(--text-primary)]" /></Field>
          {samples.length > 0 && <ul className="text-xs text-[var(--text-muted)]">{samples.map((f, i) => <li key={i}>{f.name}</li>)}</ul>}
          <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]"><input type="checkbox" checked={removeNoise} onChange={(e) => setRemoveNoise(e.target.checked)} />{tl('Riduci il rumore nei campioni')}</label>
          <label className="flex items-start gap-2 text-sm text-[var(--text-primary)]"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />{tl('Confermo di avere il diritto e il consenso a clonare questa voce.')}</label>
          <Button tone="accent" disabled={!configured || busy || !voiceName.trim() || !samples.length || samples.length > 10 || !consent} onClick={() => clone.mutate()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{tl('Clona e salva la voce')}</Button>
        </> : tool === 'design' ? <>
          <Field label={tl('Come deve suonare la voce?')} hint={tl('Descrivi timbro, età, accento, ritmo ed espressività. Almeno 20 caratteri.')}><Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={1000} rows={5} placeholder={tl('Una voce italiana calda e chiara, adulta, dal ritmo tranquillo, adatta a raccontare storie scientifiche.')} /></Field>
          <Field label={tl('Testo per le anteprime (facoltativo)')} hint={tl('Da 100 a 1000 caratteri. Se lo lasci vuoto viene creato automaticamente.')}><Textarea value={previewText} onChange={(e) => setPreviewText(e.target.value)} maxLength={1000} rows={3} /></Field>
          <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]"><input type="checkbox" checked={remix} onChange={(e) => setRemix(e.target.checked)} />{tl('Parti da una voce esistente (remix)')}</label>
          {remix && <SearchableSelect value={voice} onChange={setVoice} label={tl('Voce di partenza')} options={voiceOptions} />}
          <Button tone="accent" disabled={!configured || busy || description.trim().length < 20 || (!!previewText && previewText.length < 100) || (remix && !voice)} onClick={() => design.mutate()}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{tl('Crea le anteprime')}</Button>
          {previews.length > 0 && <div className="grid gap-2">{previews.map((preview, index) => <Button key={preview.id} surface="outline" onClick={() => setParams({ item: preview.id })}><Headphones className="h-4 w-4" />{tl('Ascolta proposta {0}', index + 1)}</Button>)}</div>}
        </> : <>
          <Field label={tl('Titolo del risultato')}><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={tl(activeTool.label)} /></Field>
          {['tts', 'convert'].includes(tool) && <Field label={tl('Voce')}><SearchableSelect value={voice} onChange={setVoice} label={tl('Scegli una voce')} options={voiceOptions} disabled={!configured || busy} /></Field>}
          {['tts', 'convert'].includes(tool) && <Field label={tl('Modello')}><SearchableSelect value={activeModel?.model_id || ''} onChange={setModel} label={tl('Scegli un modello')} options={modelPool.map((m) => ({ value: m.model_id, label: m.name, searchText: m.model_id }))} disabled={!configured || busy} /></Field>}
          {textTool && <Field label={tool === 'tts' ? tl('Testo da leggere') : tool === 'alignment' ? tl('Testo della registrazione') : tl('Descrizione')} hint={tool === 'tts' && activeModel ? tl('Fino a {0} caratteri per richiesta con questo modello.', activeModel.max_characters) : undefined}><Textarea rows={tool === 'tts' ? 9 : 5} maxLength={tool === 'music' ? 4100 : 20000} value={text} onChange={(e) => setText(e.target.value)} /><span className="block text-right text-[10px] text-[var(--text-muted)]">{text.length} {tl('caratteri')}</span></Field>}
          {tool === 'dialogue' && <div className="space-y-3">{dialogue.map((line, index) => <div key={index} className="space-y-2 rounded-xl bg-[var(--surface-muted)] p-3"><div className="flex items-center justify-between"><b className="text-xs text-[var(--text-primary)]">{tl('Battuta {0}', index + 1)}</b>{dialogue.length > 1 && <button type="button" aria-label={tl('Rimuovi battuta')} onClick={() => setDialogue((rows) => rows.filter((_, i) => i !== index))}><Trash2 className="h-3.5 w-3.5" /></button>}</div><SearchableSelect value={line.voice_id} label={tl('Scegli chi parla')} options={voiceOptions} onChange={(value) => setDialogue((rows) => rows.map((row, i) => i === index ? { ...row, voice_id: value } : row))} /><Textarea value={line.text} rows={3} onChange={(e) => setDialogue((rows) => rows.map((row, i) => i === index ? { ...row, text: e.target.value } : row))} /></div>)}<p className="text-xs text-[var(--text-muted)]">{dialogue.reduce((n, line) => n + line.text.length, 0)} / 2000 {tl('caratteri')}</p><Button surface="outline" disabled={dialogue.length >= 50} onClick={() => setDialogue((rows) => [...rows, { text: '', voice_id: '' }])}><Plus className="h-4 w-4" />{tl('Aggiungi battuta')}</Button></div>}
          {fileTool && <Field label={tl('Registrazione da caricare')} hint={tl('File audio o video, fino a 50 MB.')}><input type="file" accept="audio/*,video/*,.mp3,.wav,.m4a,.flac" onChange={(e) => setFile(e.target.files?.[0] || null)} className="w-full text-sm text-[var(--text-primary)]" />{file && <span className="block text-xs text-[var(--text-muted)]">{file.name}</span>}</Field>}
          {['tts', 'dialogue', 'transcribe', 'dubbing'].includes(tool) && <Field label={tool === 'dubbing' ? tl('Lingua di destinazione') : tl('Lingua')}><Select value={language} onChange={(e) => setLanguage(e.target.value)}>{LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</Select></Field>}
          {tool === 'dubbing' && <Field label={tl('Lingua della registrazione')}><Select value={sourceLanguage} onChange={(e) => setSourceLanguage(e.target.value)}><option value="auto">{tl('Rileva automaticamente')}</option>{LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</Select></Field>}
          {tool === 'tts' && <div className="grid gap-4 sm:grid-cols-2"><Field label={tl('Velocità: {0}×', speed.toFixed(2))}><input className="w-full accent-[var(--app-accent)]" type="range" min="0.7" max="1.2" step="0.05" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} /></Field><Field label={tl('Stabilità')}><Select value={stability} onChange={(e) => setStability(Number(e.target.value))}><option value={0}>{tl('Espressiva')}</option><option value={0.5}>{tl('Bilanciata')}</option><option value={1}>{tl('Stabile')}</option></Select></Field></div>}
          {['tts', 'convert', 'dialogue'].includes(tool) && <Field label={tl('Formato audio')}><Select value={format} onChange={(e) => setFormat(e.target.value)}>{(config.data?.output_formats || ['mp3_44100_128']).map((f) => <option key={f} value={f}>{f.startsWith('mp3') ? `MP3 · ${f.endsWith('192') ? '192' : '128'} kbps` : f.startsWith('wav') ? 'WAV · 44.1 kHz' : 'Opus · 128 kbps'}</option>)}</Select></Field>}
          {['music', 'sound_effects'].includes(tool) && <Field label={tl('Durata (secondi)')}><Input type="number" min={tool === 'music' ? 3 : 1} max={tool === 'music' ? 600 : 30} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} /></Field>}
          {tool === 'music' && <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]"><input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} />{tl('Solo musica strumentale')}</label>}
          {tool === 'transcribe' && <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]"><input type="checkbox" checked={diarize} onChange={(e) => setDiarize(e.target.checked)} />{tl('Distingui gli interlocutori')}</label>}
          {tool === 'convert' && <label className="flex items-center gap-2 text-sm text-[var(--text-primary)]"><input type="checkbox" checked={removeNoise} onChange={(e) => setRemoveNoise(e.target.checked)} />{tl('Riduci il rumore della registrazione')}</label>}
          <Button tone="accent" disabled={!canGenerate} onClick={() => generate.mutate()}>{generate.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}{tool === 'dubbing' ? tl('Avvia il doppiaggio') : tool === 'transcribe' ? tl('Trascrivi e salva') : tool === 'alignment' ? tl('Sincronizza e salva') : tl('Genera e salva')}</Button>
        </>}
        {busy && <p role="status" className="flex items-center gap-2 text-sm text-[var(--text-primary)]"><Loader2 className="h-4 w-4 animate-spin" />{tl('Richiesta in corso. Il risultato verrà salvato nella tua libreria.')}</p>}
        {!['voices', 'library'].includes(tool) && <p className="border-t border-[var(--border-color,#d8d6df)] pt-4 text-[11px] leading-5 text-[var(--text-muted)]">{tl('Le generazioni consumano la quota ElevenLabs dell’account collegato. Disponibilità di modelli, clonazione e formati dipendono dal piano attivo.')}</p>}
      </section>
      <aside className={`${panelClass} min-w-0 space-y-4 lg:col-start-2 xl:col-start-auto`} aria-label={tl('Risultato Voice Lab')}>
        <div className="flex items-center justify-between"><h2 className="font-bold text-[var(--text-primary)]">{tl('Ascolta e conserva')}</h2>{selectedId && <button type="button" onClick={() => void selected.refetch()} aria-label={tl('Aggiorna risultato')}><RefreshCw className={`h-4 w-4 ${selected.isFetching ? 'animate-spin' : ''}`} /></button>}</div>
        {selected.isLoading && <Loader2 className="h-5 w-5 animate-spin" />}
        {selected.isError && <p role="alert" className="text-sm text-[var(--text-muted)]">{tl('Risultato non disponibile. Scegli un altro elemento dalla libreria.')}</p>}
        {selected.data ? <>
          <h3 className="break-words text-lg font-semibold text-[var(--text-primary)]">{selected.data.title}</h3>
          {selected.data.status === 'processing' && <p role="status" className="text-sm text-[var(--text-primary)]">{tl('Il doppiaggio è in lavorazione. Puoi cambiare pagina: lo ritroverai nella libreria.')}</p>}
          {selected.data.status === 'failed' && <p role="alert" className="text-sm text-[var(--text-primary)]">{tl('ElevenLabs non ha completato il doppiaggio.')}</p>}
          {selected.data.mime_type?.startsWith('audio/') && <AudioPreview item={selected.data} />}
          {selected.data.kind === 'voice' && <p className="text-sm text-[var(--text-muted)]">{selected.data.details.requires_verification ? tl('Voce salvata. ElevenLabs richiede una verifica prima di poterla usare: completa la verifica nel tuo account ElevenLabs.') : tl('La voce è salvata e può essere scelta in Testo in voce, Dialoghi e Cambio voce.')}</p>}
          {selected.data.kind === 'voice' && selected.data.voice_id && <Button surface="outline" onClick={() => { setVoice(selected.data!.voice_id!); setTool('tts') }}>{tl('Usa questa voce')}</Button>}
          {selected.data.kind === 'preview' && <div className="space-y-3"><Field label={tl('Nome della voce da salvare')}><Input value={voiceName} onChange={(e) => setVoiceName(e.target.value)} maxLength={100} placeholder={tl('Dai un nome alla voce')} /></Field><Button tone="accent" disabled={busy || !voiceName.trim() || !!selected.data.details.saved_voice_id} onClick={() => saveVoice.mutate(selectedId)}>{selected.data.details.saved_voice_id ? tl('Voce già salvata') : tl('Salva questa voce')}</Button></div>}
          {selected.data.details.transcript?.text && <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-xl bg-[var(--surface-muted)] p-3 text-sm text-[var(--text-primary)]">{selected.data.details.transcript.text}</div>}
          {!!selected.data.details.transcript?.words?.length && <div className="max-h-60 overflow-auto rounded-xl border border-[var(--border-color,#d8d6df)]"><table className="w-full text-left text-xs text-[var(--text-primary)]"><thead><tr><th className="p-2">{tl('Parola')}</th><th className="p-2">{tl('Da')}</th><th className="p-2">{tl('A')}</th></tr></thead><tbody>{selected.data.details.transcript.words.filter((w) => w.text.trim()).map((w, index) => <tr key={index}><td className="p-2">{w.text}</td><td className="p-2 tabular-nums">{w.start.toFixed(2)}s</td><td className="p-2 tabular-nums">{w.end.toFixed(2)}s</td></tr>)}</tbody></table></div>}
          {selected.data.content_url && <Button surface="outline" fullWidth onClick={() => void download(selected.data!)}><Download className="h-4 w-4" />{tl('Scarica il file')}</Button>}
          {selected.data.details.characters ? <p className="text-xs text-[var(--text-muted)]">{tl('Consumo comunicato: {0} caratteri', selected.data.details.characters)}</p> : null}
        </> : !selectedId && <div className="py-7 text-center"><Headphones className="mx-auto mb-3 h-10 w-10 text-[var(--app-accent)]" /><p className="text-sm leading-6 text-[var(--text-muted)]">{tl('Il tuo prossimo audio comincia qui. Crea un risultato o scegli un elemento dalla libreria.')}</p></div>}
        <Button surface="ghost" fullWidth onClick={() => setTool('library')}>{tl('Apri la mia libreria')}</Button>
      </aside>
    </div>
  </div>
}
