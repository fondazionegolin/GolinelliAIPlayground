import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input } from '@/design'
import { Mic, Loader2 } from '@/components/icons'
import { voiceLabApi, type LabItem } from '@/lib/voiceLab'
import { tl } from '@/i18n/tl'

// Original reading passages: enough varied speech for at least thirty seconds at a natural pace.
const PASSAGES = [
  'Questa mattina ho aperto la finestra e ho ascoltato i suoni della città. Una bicicletta passava lentamente, mentre da un cortile arrivava il profumo del pane appena sfornato. Mi sono chiesto quante piccole scoperte ci aspettino ogni giorno, quando troviamo il tempo di guardarci intorno. In laboratorio succede qualcosa di simile: partiamo da una domanda semplice, osserviamo con attenzione e proviamo una strada nuova. A volte il primo tentativo funziona, altre volte serve fermarsi e ricominciare. Non è un problema: anche un errore può suggerire una buona idea. Ora immagino di raccontare questa esperienza a una classe, con una voce chiara e tranquilla. Faccio una breve pausa, respiro e continuo. Quale sarà la prossima domanda? Forse nascerà da un dettaglio che nessuno aveva ancora notato. È proprio questa curiosità a rendere interessante il nostro viaggio.',
  'Immaginiamo di camminare lungo un sentiero che attraversa un bosco. La luce filtra tra le foglie e disegna forme diverse sul terreno. Più avanti incontriamo un piccolo ponte di legno: sotto scorre un ruscello, limpido e veloce. Ci fermiamo ad ascoltarlo, senza fretta. Ogni suono ha un ritmo, ogni parola porta con sé un significato. Quando spieghiamo qualcosa agli altri, possiamo scegliere un tono accogliente, fare una domanda e lasciare spazio alla risposta. Perché il cielo cambia colore al tramonto? Come fa un seme a diventare un albero? Sono domande che aprono nuove possibilità. Continuiamo il percorso, alternando passi brevi e passi più decisi. All’uscita del bosco ci aspetta una piazza piena di persone e di storie. Ognuno ha qualcosa da condividere, e la nostra voce può aiutare a farlo con chiarezza, attenzione e un pizzico di meraviglia.',
]

/** PCM WAV gives recordings a reliable duration, including browsers whose WebM has no duration metadata. */
async function recordingFile(blob: Blob): Promise<{ file: File; seconds: number }> {
  const context = new AudioContext()
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer())
    const samples = audio.length, channels = audio.numberOfChannels
    const buffer = new ArrayBuffer(44 + samples * 2), view = new DataView(buffer)
    const string = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)) }
    string(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); string(8, 'WAVE'); string(12, 'fmt ')
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
    view.setUint32(24, audio.sampleRate, true); view.setUint32(28, audio.sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
    string(36, 'data'); view.setUint32(40, samples * 2, true)
    const data = Array.from({ length: channels }, (_, i) => audio.getChannelData(i))
    for (let i = 0; i < samples; i++) {
      const value = Math.max(-1, Math.min(1, data.reduce((sum, channel) => sum + channel[i], 0) / channels))
      view.setInt16(44 + i * 2, value * (value < 0 ? 0x8000 : 0x7fff), true)
    }
    return { file: new File([buffer], 'la-mia-voce.wav', { type: 'audio/wav' }), seconds: audio.duration }
  } finally { await context.close() }
}

export function CloneVoiceDialog({ configured, onClose, onCreated }: { configured: boolean; onClose: () => void; onCreated: (item: LabItem) => void }) {
  const [name, setName] = useState(''), [consent, setConsent] = useState(false), [passage, setPassage] = useState(0)
  const [recording, setRecording] = useState(false), [preparing, setPreparing] = useState(false), [elapsed, setElapsed] = useState(0)
  const [sample, setSample] = useState<File | null>(null), [url, setUrl] = useState(''), [error, setError] = useState('')
  const recorder = useRef<MediaRecorder | null>(null), stream = useRef<MediaStream | null>(null)
  const disposed = useRef(false), started = useRef(0)
  useEffect(() => {
    disposed.current = false
    return () => { disposed.current = true; recorder.current?.state === 'recording' && recorder.current.stop(); stream.current?.getTracks().forEach(track => track.stop()) }
  }, [])
  useEffect(() => { if (!sample) { setUrl(''); return }; const value = URL.createObjectURL(sample); setUrl(value); return () => URL.revokeObjectURL(value) }, [sample])
  useEffect(() => {
    if (!recording) return
    const timer = setInterval(() => { const seconds = (performance.now() - started.current) / 1000; setElapsed(seconds); if (seconds >= 120) recorder.current?.stop() }, 200)
    return () => clearInterval(timer)
  }, [recording])
  const start = async () => {
    if (preparing || recording) return
    setPreparing(true); setError(''); setSample(null); setElapsed(0)
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('unsupported')
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false })
      if (disposed.current) { media.getTracks().forEach(track => track.stop()); return }
      stream.current = media
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type))
      const current = new MediaRecorder(media, mimeType ? { mimeType } : undefined)
      recorder.current = current
      const chunks: Blob[] = []
      current.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      current.onerror = () => { media.getTracks().forEach(track => track.stop()); if (!disposed.current) { setRecording(false); setPreparing(false); setError(tl('Registrazione interrotta. Riprova.')) } }
      current.onstop = async () => {
        media.getTracks().forEach(track => track.stop())
        if (disposed.current) return
        setRecording(false); setPreparing(true)
        try {
          const result = await recordingFile(new Blob(chunks, { type: current.mimeType }))
          if (disposed.current) return
          setElapsed(result.seconds)
          if (result.seconds < 30) { setError(tl('La registrazione dura meno di 30 secondi. Registra di nuovo continuando a leggere.')); return }
          setSample(result.file)
        } catch { if (!disposed.current) setError(tl('Impossibile leggere la registrazione. Registra di nuovo.')) }
        finally { if (!disposed.current) setPreparing(false) }
      }
      current.start(); started.current = performance.now(); setRecording(true)
    } catch { stream.current?.getTracks().forEach(track => track.stop()); if (!disposed.current) setError(tl('Microfono non disponibile. Consenti l’accesso al microfono e riprova.')) }
    finally { if (!disposed.current) setPreparing(false) }
  }
  const clone = useMutation({ mutationFn: async () => (await voiceLabApi.clone(name.trim(), 'Voce personale registrata in Audio Lab', consent, false, [sample!], true)).data,
    onSuccess: onCreated, onError: () => setError(tl('Clonazione non completata. La registrazione è pronta: puoi riprovare.')) })
  return <Dialog open onOpenChange={open => { if (!open && !clone.isPending) onClose() }}>
    <DialogContent size="lg" showClose={!clone.isPending} className="max-h-[90dvh] overflow-y-auto text-[var(--text-primary)]">
      <DialogHeader><DialogTitle>{tl('Clona la tua voce')}</DialogTitle><DialogDescription>{tl('Leggi il testo per almeno 30 secondi, con il tuo tono naturale. La voce salvata sarà disponibile solo nel tuo spazio docente.')}</DialogDescription></DialogHeader>
      <div className="voice-lab-options max-h-48 overflow-y-auto rounded-2xl p-4 text-sm leading-relaxed" aria-label={tl('Testo da leggere per la registrazione')}>{tl(PASSAGES[passage])}</div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button density="compact" tone="neutral" surface="ghost" disabled={recording || preparing || clone.isPending} onClick={() => setPassage(p => (p + 1) % PASSAGES.length)}>{tl('Cambia testo')}</Button>
        <span role="timer" className="text-sm font-semibold tabular-nums">{Math.floor(elapsed)} s / 30 s {elapsed >= 30 ? '✓' : ''}</span>
        <Button tone={recording ? 'danger' : 'accent'} surface="solid" disabled={preparing || clone.isPending} onClick={() => recording ? recorder.current?.stop() : void start()}>{preparing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}{tl(recording ? 'Ferma registrazione' : sample ? 'Registra di nuovo' : 'REC · Registra')}</Button>
      </div>
      {recording && <p role="status" className="text-xs text-[var(--text-secondary)]">{tl(elapsed < 30 ? 'Registrazione in corso: continua a leggere fino ad almeno 30 secondi.' : 'Puoi fermare la registrazione oppure continuare a leggere.')}</p>}
      {url && <audio controls src={url} className="w-full" aria-label={tl('Ascolta la tua registrazione')} />}
      <label className="block space-y-2 text-sm font-semibold">{tl('Nome della voce')}<Input value={name} maxLength={100} disabled={clone.isPending} onChange={e => setName(e.target.value)} placeholder={tl('Per esempio: La mia voce')} /></label>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="voice-lab-check" checked={consent} disabled={clone.isPending} onChange={e => setConsent(e.target.checked)} />{tl('Confermo che questa è la mia voce e desidero clonarla.')}</label>
      {error && <p role="alert" className="text-sm text-[var(--brand-red-text)]">{error}</p>}
      <Button tone="accent" surface="solid" disabled={!configured || !sample || !name.trim() || !consent || recording || preparing || clone.isPending} onClick={() => clone.mutate()}>{clone.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{tl(clone.isPending ? 'Clonazione in corso…' : 'Clona e salva la voce')}</Button>
    </DialogContent>
  </Dialog>
}
