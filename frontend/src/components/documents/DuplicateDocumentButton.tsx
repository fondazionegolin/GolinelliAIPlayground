import { useRef, useState } from 'react'
import { Copy } from '@/components/icons'
import { IconButton } from '@/design'
import { tl } from '@/i18n/tl'

export default function DuplicateDocumentButton({ title, onDuplicate, className = '' }: {
  title: string
  onDuplicate: () => Promise<void>
  className?: string
}) {
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  return (
    <IconButton
      type="button" tone="neutral" surface="solid" disabled={busy}
      aria-label={`${tl('Duplica')}: ${title}`} title={tl('Duplica')}
      className={className}
      onClick={async event => {
        event.stopPropagation()
        if (lock.current) return
        lock.current = true
        setBusy(true)
        try { await onDuplicate() } finally { lock.current = false; setBusy(false) }
      }}
    >
      <Copy className="h-4 w-4" />
    </IconButton>
  )
}
