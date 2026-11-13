import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Input, Select } from '@/design'
import { Copy, Download, ExternalLink, Share2 } from '@/components/icons'
import { HeaderIconButton } from './DocumentEditorHeader'
import { documentSharesApi, documentShareUrl, type DocumentShareLink, type DocumentShareSource, type SharePermission } from '@/lib/documentShares'
import { tl } from '@/i18n/tl'

export function DocumentShareButton({ getSource, disabled = false }: { getSource: () => Promise<DocumentShareSource>; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  return <>
    <HeaderIconButton label={tl('Condividi link e QR code')} disabled={disabled} onClick={() => setOpen(true)}><Share2 className="h-4 w-4" /></HeaderIconButton>
    {open && <DocumentShareDialog getSource={getSource} onClose={() => setOpen(false)} />}
  </>
}

function DocumentShareDialog({ getSource, onClose }: { getSource: () => Promise<DocumentShareSource>; onClose: () => void }) {
  const [source, setSource] = useState<DocumentShareSource | null>(null)
  const [links, setLinks] = useState<DocumentShareLink[]>([])
  const [permission, setPermission] = useState<SharePermission>('view')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [qr, setQr] = useState('')
  const mounted = useRef(true)
  const locked = useRef(false)
  const link = links.find(item => item.permission === permission)
  const url = link ? documentShareUrl(link.token) : ''

  useEffect(() => {
    mounted.current = true
    void (async () => {
      try {
        const saved = await getSource()
        const response = await documentSharesApi.list(saved)
        if (mounted.current) { setSource(saved); setLinks(response.data) }
      } catch {
        if (mounted.current) setError(tl('Impossibile preparare la condivisione. Salva il documento e riprova.'))
      } finally { if (mounted.current) setBusy(false) }
    })()
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    let active = true
    setQr('')
    if (url) void QRCode.toDataURL(url, { width: 640, margin: 2, errorCorrectionLevel: 'M', color: { dark: '#171717', light: '#ffffff' } })
      .then(value => { if (active) setQr(value) }).catch(() => { if (active) setError(tl('Impossibile generare il QR code. Puoi comunque copiare il link.')) })
    return () => { active = false }
  }, [url])

  const changeLink = async (revoke = false) => {
    if (!source || locked.current) return
    locked.current = true
    setBusy(true); setError(''); setStatus('')
    try {
      if (revoke && link) {
        await documentSharesApi.revoke(link.id)
        setLinks(items => items.filter(item => item.id !== link.id))
        setStatus(tl('Link revocato. Il vecchio QR code non dà più accesso al documento.'))
      } else {
        const response = await documentSharesApi.create(source, permission)
        setLinks(items => [...items.filter(item => item.permission !== permission), response.data])
        setStatus(tl('Link creato.'))
      }
    } catch { setError(tl('Impossibile aggiornare la condivisione. Riprova.')) }
    finally { locked.current = false; setBusy(false) }
  }

  return <Dialog open onOpenChange={value => { if (!value && !busy) onClose() }}>
    <DialogContent size="sm" showClose={!busy}>
      <DialogHeader>
        <DialogTitle>{tl('Condividi tramite link')}</DialogTitle>
        <DialogDescription>{tl('Chiunque abbia il link o il QR code può aprire il documento senza accedere.')}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4" aria-busy={busy}>
        <label className="grid gap-2 text-sm font-semibold">
          {tl('Accesso')}
          <Select aria-label={tl('Accesso')} value={permission} disabled={busy} onChange={event => { setPermission(event.target.value as SharePermission); setStatus(''); setError('') }}>
            <option value="view">{tl('Sola lettura')}</option>
            <option value="edit">{tl('Può modificare')}</option>
          </Select>
        </label>
        <p className="text-sm text-[var(--text-secondary)]">{permission === 'edit'
          ? tl('Le modifiche vengono salvate sul documento originale da chiunque abbia questo link.')
          : tl('Questo link permette di leggere il documento e presentare le slide. Le modifiche sono disabilitate.')}</p>
        {busy && <p role="status" className="text-sm">{tl('Preparazione condivisione…')}</p>}
        {url && <>
          <div className="flex min-w-0 gap-2">
            <Input value={url} readOnly aria-label={tl('Link di condivisione')} onFocus={event => event.target.select()} />
            <Button density="compact" aria-label={tl('Copia link')} onClick={() => void navigator.clipboard.writeText(url).then(() => setStatus(tl('Link copiato.'))).catch(() => setError(tl('Seleziona il link e copialo manualmente.')))}><Copy className="h-4 w-4" /></Button>
          </div>
          {qr && <img src={qr} alt={tl('QR code per aprire il documento')} className="mx-auto h-48 w-48 max-w-full rounded-xl" />}
          <div className="flex flex-wrap justify-center gap-2">
            {qr && <Button asChild surface="ghost" density="compact"><a href={qr} download={`documento-${permission}-qr.png`}><Download className="mr-2 h-4 w-4" />{tl('Scarica QR code')}</a></Button>}
            <Button asChild surface="ghost" density="compact"><a href={url} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-2 h-4 w-4" />{tl('Apri link')}</a></Button>
          </div>
        </>}
        {error && <p role="alert" className="text-sm">{error}</p>}
        {status && <p role="status" className="text-sm text-[var(--text-secondary)]">{status}</p>}
        <div className="flex justify-end gap-2">
          <Button surface="ghost" disabled={busy} onClick={onClose}>{tl('Chiudi')}</Button>
          {link ? <Button disabled={busy} onClick={() => void changeLink(true)}>{tl('Revoca link')}</Button>
            : <Button tone="accent" surface="solid" disabled={busy || !source} onClick={() => void changeLink()}>{tl('Crea link')}</Button>}
        </div>
      </div>
    </DialogContent>
  </Dialog>
}
