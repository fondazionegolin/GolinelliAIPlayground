import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { Copy, ExternalLink, Link2, Loader2, Maximize2, QrCode, ShieldCheck, Trash2, X } from 'lucide-react'

import { liveInteractionApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'

interface PublicLinkData {
  token: string
  access_code: string
  title: string
  status: string
}

export default function LiveInteractionPublicShareModal({ interactionId, title, onClose }: {
  interactionId: string
  title: string
  onClose: () => void
}) {
  const { toast } = useToast()
  const [link, setLink] = useState<PublicLinkData | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [presenting, setPresenting] = useState(false)
  const presentationRef = useRef<HTMLDivElement>(null)

  const createLink = useMutation({
    mutationFn: () => liveInteractionApi.enablePublicLink(interactionId),
    onSuccess: response => setLink(response.data as PublicLinkData),
    onError: (error: unknown) => {
      const detail = (error as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      toast({ title: detail || 'Impossibile creare il link pubblico', variant: 'destructive' })
    },
  })
  const revokeLink = useMutation({
    mutationFn: () => liveInteractionApi.disablePublicLink(interactionId),
    onSuccess: () => { toast({ title: 'Link pubblico revocato' }); onClose() },
    onError: () => toast({ title: 'Impossibile revocare il link', variant: 'destructive' }),
  })

  useEffect(() => { createLink.mutate() }, [interactionId]) // eslint-disable-line react-hooks/exhaustive-deps

  const publicUrl = link ? `${window.location.origin}/live/${link.token}` : ''

  useEffect(() => {
    if (!publicUrl) return
    QRCode.toDataURL(publicUrl, { width: 720, margin: 2, errorCorrectionLevel: 'H', color: { dark: '#111827', light: '#ffffff' } })
      .then(setQrDataUrl)
      .catch(() => toast({ title: 'Impossibile generare il QR code', variant: 'destructive' }))
  }, [publicUrl, toast])

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value)
    toast({ title: `${label} copiato` })
  }

  const present = async () => {
    setPresenting(true)
    window.setTimeout(() => presentationRef.current?.requestFullscreen?.().catch(() => {}), 50)
  }

  const content = (presentation: boolean) => (
    <div className={presentation ? 'flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-950 p-10 text-white' : ''}>
      <div className={presentation ? 'w-full max-w-6xl text-center' : ''}>
        <div className={presentation ? '' : 'flex items-start justify-between gap-4'}>
          <div className={presentation ? 'text-center' : ''}>
            <p className={`text-xs font-black uppercase tracking-[0.2em] ${presentation ? 'text-violet-300' : 'text-violet-600'}`}>Live Interaction</p>
            <h2 className={`${presentation ? 'mt-3 text-5xl' : 'mt-1 text-2xl'} font-black`}>{title}</h2>
            <p className={`mt-2 ${presentation ? 'text-xl text-white/70' : 'text-sm text-slate-500'}`}>Scansiona il QR code o apri il link. Non serve un account.</p>
          </div>
          {!presentation && <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100"><X className="h-5 w-5" /></button>}
        </div>

        {!link || !qrDataUrl ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Creo link e QR code…</div>
        ) : (
          <div className={presentation ? 'mt-10 grid grid-cols-[minmax(320px,500px)_1fr] items-center gap-14 text-left' : 'mt-6'}>
            <div className={`mx-auto overflow-hidden rounded-[32px] bg-white p-4 shadow-2xl ${presentation ? 'w-full' : 'w-64 border border-slate-200'}`}>
              <img src={qrDataUrl} alt="QR code per entrare nella sessione Live" className="aspect-square w-full" />
            </div>
            <div className={presentation ? 'space-y-7' : 'mt-5 space-y-3'}>
              <div className={`rounded-2xl ${presentation ? 'bg-white/10 p-6 ring-1 ring-white/15' : 'border border-slate-200 bg-slate-50 p-4'}`}>
                <p className={`text-xs font-black uppercase tracking-widest ${presentation ? 'text-white/50' : 'text-slate-400'}`}>Codice Live temporaneo</p>
                <p className={`${presentation ? 'mt-2 text-6xl text-amber-300' : 'mt-1 text-3xl text-violet-700'} font-black tracking-[0.18em]`}>{link.access_code}</p>
              </div>
              <div className={`rounded-2xl ${presentation ? 'bg-white/10 p-6 ring-1 ring-white/15' : 'border border-slate-200 p-4'}`}>
                <p className={`text-xs font-black uppercase tracking-widest ${presentation ? 'text-white/50' : 'text-slate-400'}`}>Link diretto</p>
                <p className={`mt-1 break-all font-mono ${presentation ? 'text-xl text-violet-200' : 'text-sm text-slate-700'}`}>{publicUrl}</p>
              </div>
              <div className={`flex items-center gap-2 ${presentation ? 'text-base text-emerald-300' : 'text-xs text-emerald-700'}`}><ShieldCheck className="h-5 w-5" /> Gli ospiti entrano con un nickname e sono controllati dal master.</div>
            </div>
          </div>
        )}
      </div>
      {presentation && <button onClick={() => { document.exitFullscreen?.().catch(() => {}); setPresenting(false) }} className="fixed right-6 top-6 rounded-full bg-white/10 p-3 text-white/70 hover:bg-white/20 hover:text-white" aria-label="Chiudi presentazione"><X className="h-6 w-6" /></button>}
    </div>
  )

  if (presenting) return <div ref={presentationRef} className="fixed inset-0 z-[80] overflow-auto">{content(true)}</div>

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="w-full max-w-xl rounded-3xl bg-white p-6 shadow-2xl" onMouseDown={event => event.stopPropagation()}>
        {content(false)}
        {link && <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button tone="neutral" surface="outline" density="compact" onClick={() => copy(publicUrl, 'Link')}><Copy className="h-4 w-4" /> Link</Button>
          <Button tone="neutral" surface="outline" density="compact" onClick={() => copy(link.access_code, 'Codice Live')}><QrCode className="h-4 w-4" /> Codice</Button>
          <Button tone="neutral" surface="outline" density="compact" onClick={() => window.open(publicUrl, '_blank', 'noopener,noreferrer')}><ExternalLink className="h-4 w-4" /> Apri</Button>
          <Button tone="accent" surface="solid" density="compact" onClick={present}><Maximize2 className="h-4 w-4" /> Presenta</Button>
        </div>}
        {link && <button type="button" onClick={() => revokeLink.mutate()} disabled={revokeLink.isPending} className="mx-auto mt-4 flex items-center gap-1.5 text-xs font-bold text-rose-600 hover:text-rose-800 disabled:opacity-50"><Trash2 className="h-3.5 w-3.5" /> {revokeLink.isPending ? 'Revoca…' : 'Revoca link pubblico'}</button>}
        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400"><Link2 className="h-3.5 w-3.5" /> Link e codice scadono alla chiusura o alla revoca. Una nuova pubblicazione genera un codice diverso.</p>
      </div>
    </div>
  )
}
