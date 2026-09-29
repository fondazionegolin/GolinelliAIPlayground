import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { Check, Copy, Download, ExternalLink, Globe, Loader2, RefreshCw, Users, X } from 'lucide-react'
import { solidModelerApi, type SolidModelSummary } from '@/lib/api'

interface Props {
  modelId: string
  name: string
  onClose: () => void
}

export default function SolidModelShareDialog({ modelId, name, onClose }: Props) {
  const queryClient = useQueryClient()
  const [model, setModel] = useState<SolidModelSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)

  const classes = useQuery({
    queryKey: ['solid-modeler-classes'],
    queryFn: async () => (await solidModelerApi.classes()).data,
  })

  useEffect(() => {
    solidModelerApi.get(modelId).then(r => setModel(r.data)).catch(() => setError('Impossibile caricare il progetto'))
  }, [modelId])

  const publicUrl = model?.public_enabled && model.public_token ? `${window.location.origin}/3d/${model.public_token}` : ''

  useEffect(() => {
    if (!publicUrl) { setQr(''); return }
    QRCode.toDataURL(publicUrl, { width: 640, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#171717', light: '#ffffff' } })
      .then(setQr)
      .catch(() => setQr(''))
  }, [publicUrl])

  const update = async (data: { class_ids?: string[]; public_enabled?: boolean; regenerate_token?: boolean }) => {
    setBusy(true)
    setError(null)
    try {
      const res = await solidModelerApi.share(modelId, data)
      setModel(m => (m ? { ...m, ...res.data } : res.data))
      queryClient.invalidateQueries({ queryKey: ['solid-models'] })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Condivisione non riuscita')
    } finally {
      setBusy(false)
    }
  }

  const toggleClass = (id: string) => {
    if (!model) return
    const current = new Set(model.shared_class_ids)
    if (current.has(id)) current.delete(id)
    else current.add(id)
    update({ class_ids: [...current] })
  }

  const copy = async () => {
    await navigator.clipboard.writeText(publicUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const downloadQr = () => {
    const a = document.createElement('a')
    a.href = qr
    a.download = `qr-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'modello'}.png`
    a.click()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-violet-600">Condividi modello 3D</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">{name}</h2>
            <p className="mt-1 text-xs text-slate-500">Chi riceve il modello lo vede in 3D in sola lettura e può scaricare l'STL. Le modifiche che fai qui si vedono subito.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>
        </div>

        {!model ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
            {error ?? <><Loader2 className="h-4 w-4 animate-spin" /> Carico…</>}
          </div>
        ) : (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <section className="rounded-xl border border-slate-200 p-4">
              <p className="flex items-center gap-2 text-sm font-black text-slate-900"><Users className="h-4 w-4 text-sky-600" /> Classi</p>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">Gli studenti delle classi selezionate trovano il modello nella sezione "Modelli 3D" della loro sessione.</p>
              <div className="mt-3 space-y-1.5">
                {classes.isLoading && <p className="text-xs text-slate-400">Carico le classi…</p>}
                {classes.data?.length === 0 && <p className="text-xs text-slate-400">Non hai classi attive.</p>}
                {classes.data?.map(c => {
                  const on = model.shared_class_ids.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={busy}
                      onClick={() => toggleClass(c.id)}
                      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs font-bold transition ${on ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-slate-200 text-slate-700 hover:bg-slate-50'}`}
                    >
                      <span className={`flex h-4 w-4 items-center justify-center rounded border ${on ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-300'}`}>{on && <Check className="h-3 w-3" />}</span>
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      {c.school_grade && <span className="text-[10px] font-semibold text-slate-400">{c.school_grade}</span>}
                    </button>
                  )
                })}
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-black text-slate-900"><Globe className="h-4 w-4 text-violet-600" /> Link diretto</p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={model.public_enabled}
                  disabled={busy}
                  onClick={() => update({ public_enabled: !model.public_enabled })}
                  className={`relative h-6 w-11 rounded-full transition ${model.public_enabled ? 'bg-violet-600' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${model.public_enabled ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-slate-500">Chiunque abbia il link o inquadri il QR code vede il modello, senza account.</p>
              {model.public_enabled && publicUrl && (
                <div className="mt-3 space-y-3">
                  <div className="mx-auto w-44 rounded-xl border border-slate-200 bg-white p-2">
                    {qr ? <img src={qr} alt="QR code del modello" className="aspect-square w-full" /> : <div className="flex aspect-square items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-300" /></div>}
                  </div>
                  <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-slate-700">{publicUrl}</span>
                    <button type="button" title="Copia link" onClick={copy} className="rounded p-1 text-slate-500 hover:bg-white">{copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"><ExternalLink className="h-3.5 w-3.5" /> Apri</a>
                    <button type="button" disabled={!qr} onClick={downloadQr} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"><Download className="h-3.5 w-3.5" /> QR PNG</button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => { if (window.confirm('Il link attuale smetterà di funzionare. Continuare?')) update({ regenerate_token: true }) }}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Nuovo link
                    </button>
                  </div>
                </div>
              )}
            </section>
            {error && <p className="text-xs font-semibold text-rose-600 md:col-span-2">{error}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
