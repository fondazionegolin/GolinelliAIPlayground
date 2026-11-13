import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/design'
import { filesApi } from '@/lib/api'
import {
  chooseGoogleAccount, GoogleWorkspaceError, googleWorkspaceFormat, loadGoogleIdentity, uploadGoogleWorkspace,
  type GoogleWorkspaceAccount, type GoogleWorkspaceExport,
} from '@/lib/googleWorkspace'
import { tl } from '@/i18n/tl'
import { DocumentExportImageError } from '@/lib/documentExport'

function errorMessage(error: unknown): string {
  if (error instanceof DocumentExportImageError) return tl('Impossibile incorporare un’immagine. Verifica che sia ancora accessibile o sostituiscila e riprova.')
  if (error instanceof GoogleWorkspaceError) {
    switch (error.code) {
      case 'load': return tl('Impossibile aprire Google. Consenti i popup e riprova.')
      case 'permission': return tl('Per esportare, autorizza la creazione dei file su Google Drive.')
      case 'account': return tl('Impossibile verificare l’account Google. Selezionalo di nuovo.')
      case 'expired': return tl('L’autorizzazione Google è scaduta. Seleziona di nuovo l’account.')
      case 'conversion': return tl('Google non ha completato la conversione. Riprova o scarica il file Office.')
    }
  }
  return tl('Esportazione non riuscita. Controlla la connessione e i permessi del tuo account Google.')
}

export function GoogleWorkspaceExportDialog({ target, onClose }: {
  target: GoogleWorkspaceExport
  onClose: () => void
}) {
  const [clientId, setClientId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'account' | 'export' | null>(null)
  const [account, setAccount] = useState<GoogleWorkspaceAccount | null>(null)
  const [error, setError] = useState('')
  const [resultUrl, setResultUrl] = useState('')
  const locked = useRef(false)
  const product = target.kind === 'slides' ? 'Google Slides' : 'Google Docs'

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const { data } = await filesApi.googleWorkspaceConfig()
        if (!data.client_id) {
          if (active) setError(tl('L’esportazione Google non è ancora attiva. Contatta l’amministratore della piattaforma.'))
          return
        }
        await loadGoogleIdentity()
        if (active) setClientId(data.client_id)
      } catch {
        if (active) setError(tl('Impossibile caricare il collegamento Google. Chiudi e riprova.'))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  const chooseAccount = async () => {
    if (locked.current) return
    locked.current = true
    setBusy('account')
    setError('')
    setAccount(null)
    try {
      // No await before this call: keep Google's popup inside the button's user gesture.
      setAccount(await chooseGoogleAccount(clientId))
    } catch (cause) {
      if (!(cause instanceof GoogleWorkspaceError && cause.code === 'cancelled')) setError(errorMessage(cause))
    } finally {
      locked.current = false
      setBusy(null)
    }
  }

  const exportDocument = async () => {
    if (!account || locked.current) return
    locked.current = true
    setBusy('export')
    setError('')
    // Reserve a tab on the click, before conversion/upload, to avoid popup blocking.
    const tab = window.open('about:blank', '_blank')
    if (tab) tab.opener = null
    try {
      const document = target.getDocument()
      const format = googleWorkspaceFormat(target.kind)
      const response = await filesApi.exportDocument({ ...document, target_format: format.extension })
      const url = await uploadGoogleWorkspace(target.kind, document.title, response.data, account)
      setResultUrl(url)
      setAccount(null)
      if (tab && !tab.closed) tab.location.replace(url)
    } catch (cause) {
      tab?.close()
      if (cause instanceof GoogleWorkspaceError && cause.code === 'expired') setAccount(null)
      setError(errorMessage(cause))
    } finally {
      locked.current = false
      setBusy(null)
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !locked.current) onClose() }}>
      <DialogContent size="sm" showClose={!busy}>
        <DialogHeader>
          <DialogTitle>{tl('Esporta in {0}', product)}</DialogTitle>
          <DialogDescription>
            {tl('Scegli l’account Google in cui creare una copia modificabile. Il file verrà salvato in Il mio Drive e aperto in {0}.', product)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm text-[var(--text-primary)]" aria-busy={loading || !!busy}>
          {loading && <p role="status">{tl('Caricamento Google…')}</p>}
          {!resultUrl && account && (
            <div className="ds-panel min-w-0 p-3">
              <p className="truncate font-semibold">{account.name}</p>
              <p className="break-all text-[var(--text-secondary)]">{account.email}</p>
            </div>
          )}
          {!resultUrl && clientId && (
            <Button surface="outline" disabled={!!busy} onClick={() => void chooseAccount()}>
              {busy === 'account' ? tl('Selezione account…') : account ? tl('Cambia account Google') : tl('Scegli account Google')}
            </Button>
          )}
          {!resultUrl && <p className="text-xs text-[var(--text-secondary)]">
            {tl('Testi, immagini e formattazione vengono trasferiti tramite il formato Office. Alcuni elementi avanzati possono variare nella conversione Google.')}
          </p>}
          {error && <p role="alert" className="text-sm text-[var(--text-primary)]">{error}</p>}
          {busy === 'export' && <p role="status">{tl('Esportazione e conversione in corso…')}</p>}
          {resultUrl && <p role="status">{tl('Copia creata nel tuo Google Drive.')}</p>}
        </div>
        <DialogFooter>
          <Button surface="ghost" disabled={!!busy} onClick={onClose}>{tl('Chiudi')}</Button>
          {resultUrl ? (
            <Button asChild tone="accent" surface="solid">
              <a href={resultUrl} target="_blank" rel="noopener noreferrer">{tl('Apri in {0}', product)}</a>
            </Button>
          ) : (
            <Button tone="accent" surface="solid" disabled={!account || !!busy} onClick={() => void exportDocument()}>
              {tl('Esporta e apri')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
