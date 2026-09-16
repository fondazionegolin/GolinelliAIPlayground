import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { MessageSquarePlus, X, Send, Loader2, CheckCircle, Image as ImageIcon } from 'lucide-react'
import { feedbackApi } from '@/lib/api'
import { useDraggableFloating } from '@/hooks/useDraggableFloating'

// Collect up to N recent console errors captured since page load
const capturedErrors: string[] = []
const _origError = window.console.error.bind(window.console)
window.console.error = (...args: unknown[]) => {
  try {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')
    if (capturedErrors.length < 20) capturedErrors.push(msg)
  } catch {
    // ignore serialization errors
  }
  _origError(...args)
}
window.addEventListener('error', (e) => {
  const msg = `${e.message} (${e.filename}:${e.lineno})`
  if (capturedErrors.length < 20) capturedErrors.push(msg)
})
window.addEventListener('unhandledrejection', (e) => {
  const msg = `Unhandled promise rejection: ${e.reason}`
  if (capturedErrors.length < 20) capturedErrors.push(msg)
})

function getBrowserInfo() {
  return {
    user_agent: navigator.userAgent,
    screen_width: window.screen.width,
    screen_height: window.screen.height,
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
    language: navigator.language,
    platform: navigator.platform,
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export interface FloatingHelperProps {
  module?: string | null
  /** Suppress the draggable floating button — used when the trigger lives elsewhere (e.g. the
   * mobile drawer, next to Logout). The modal itself still renders, driven by `open`/`onOpenChange`. */
  hideTrigger?: boolean
  /** Controlled open state. Omit for the default self-contained (desktop) behavior. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function FloatingHelper({ hideTrigger = false, open: controlledOpen, onOpenChange }: FloatingHelperProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = controlledOpen ?? internalOpen
  const setOpen = (value: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof value === 'function' ? (value as (prev: boolean) => boolean)(open) : value
    onOpenChange?.(next)
    if (controlledOpen === undefined) setInternalOpen(next)
  }
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [screenshot, setScreenshot] = useState<string | null>(null) // data URI
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { position, dragProps, consumeDragClick } = useDraggableFloating('floating-feedback', 'top-left', 48)
  const modalLeft = hideTrigger
    ? Math.max(12, (window.innerWidth - 320) / 2)
    : Math.min(Math.max(12, position.x), Math.max(12, window.innerWidth - 332))
  const modalTop = hideTrigger
    ? Math.max(12, (window.innerHeight - 420) / 2)
    : position.y + 60 + 420 <= window.innerHeight
      ? position.y + 60
      : Math.max(12, position.y - 420)

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus()
    }
    if (!open) {
      setMessage('')
      setScreenshot(null)
      if (status !== 'success') setStatus('idle')
    }
  }, [open])

  // Auto-close success state after a bit and reset
  useEffect(() => {
    if (status === 'success') {
      const t = setTimeout(() => {
        setOpen(false)
        setStatus('idle')
        setMessage('')
        setScreenshot(null)
      }, 2500)
      return () => clearTimeout(t)
    }
  }, [status])

  const handleSubmit = async () => {
    if (!message.trim() || status === 'loading') return
    setStatus('loading')
    try {
      await feedbackApi.submit({
        message: message.trim(),
        page_url: window.location.href,
        browser_info: getBrowserInfo(),
        console_errors: [...capturedErrors],
        screenshot_base64: screenshot ?? undefined,
      })
      setStatus('success')
    } catch {
      setStatus('error')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handlePaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items)
    const imageItem = items.find(item => item.kind === 'file' && item.type.startsWith('image/'))
    if (!imageItem) return
    e.preventDefault()
    const file = imageItem.getAsFile()
    if (!file) return
    try {
      const dataUrl = await fileToDataUrl(file)
      setScreenshot(dataUrl)
    } catch {
      // ignore
    }
  }

  return createPortal(
    <>
      {/* Draggable feedback button */}
      {!hideTrigger && (
        <button
          type="button"
          {...dragProps}
          onClick={() => {
            if (consumeDragClick()) return
            setOpen(v => !v)
          }}
          className={`fixed z-[65] flex h-12 w-12 touch-none select-none items-center justify-center rounded-2xl transition-all duration-200 hover:scale-105 ${
            open
              ? 'bg-orange-500 text-white shadow-lg shadow-orange-200'
              : 'bg-white/70 backdrop-blur-md border-2 border-orange-400 text-orange-500 shadow-md shadow-orange-100 hover:bg-orange-50/80'
          }`}
          style={{ left: position.x, top: position.y }}
          title="Segnala un problema · trascina in alto o in basso"
          aria-label="Apri feedback"
        >
          {open ? <X className="h-5 w-5" /> : <MessageSquarePlus className="h-5 w-5" />}
        </button>
      )}

      {/* Modal */}
      {open && (
        <div className="fixed z-[70] w-80 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl animate-in slide-in-from-top-4 duration-200" style={{ left: modalLeft, top: modalTop }}>
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-50 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#fce7f3' }}>
              <MessageSquarePlus className="h-3.5 w-3.5" style={{ color: '#e85c8d' }} />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-slate-900 leading-tight">Segnala un problema</h2>
              <p className="text-[11px] text-slate-400">Descrivi il comportamento inatteso</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              aria-label="Chiudi"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          {status === 'success' ? (
            <div className="flex flex-col items-center justify-center py-8 gap-2">
              <CheckCircle className="h-10 w-10 text-green-500" />
              <p className="text-sm font-semibold text-slate-800">Grazie per il feedback!</p>
              <p className="text-xs text-slate-400">La segnalazione è stata inviata.</p>
            </div>
          ) : (
            <div className="p-4 space-y-3">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={e => setMessage(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder="Descrivi cosa è successo... (Ctrl+Invio per inviare)"
                rows={4}
                className="w-full text-sm text-slate-800 placeholder:text-slate-300 border border-slate-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300 transition-all"
                disabled={status === 'loading'}
              />

              {/* Screenshot preview */}
              {screenshot && (
                <div className="relative rounded-lg overflow-hidden border border-slate-200">
                  <img src={screenshot} alt="Screenshot allegato" className="w-full object-cover max-h-32" />
                  <button
                    onClick={() => setScreenshot(null)}
                    className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}

              {!screenshot && (
                <p className="text-[10px] text-slate-300 flex items-center gap-1">
                  <ImageIcon className="h-3 w-3" />
                  Incolla uno screenshot con Ctrl+V
                </p>
              )}

              {status === 'error' && (
                <p className="text-xs text-red-500">Errore nell'invio. Riprova.</p>
              )}

              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-slate-300">
                  Raccoglie automaticamente info tecniche e log del browser
                </p>
                <button
                  onClick={handleSubmit}
                  disabled={!message.trim() || status === 'loading'}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ backgroundColor: '#e85c8d' }}
                >
                  {status === 'loading' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  Invia
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>,
    document.body,
  )
}
