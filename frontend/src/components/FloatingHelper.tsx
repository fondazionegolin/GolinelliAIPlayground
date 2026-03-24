import { useState, useEffect, useRef } from 'react'
import { MessageSquarePlus, X, Send, Loader2, CheckCircle } from 'lucide-react'
import { feedbackApi } from '@/lib/api'

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

export interface FloatingHelperProps {
  module?: string | null
}

export function FloatingHelper(_props: FloatingHelperProps = {}) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus()
    }
    if (!open) {
      setMessage('')
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

  return (
    <>
      {/* Floating button — orange glassy */}
      <button
        onClick={() => setOpen(v => !v)}
        className={`fixed bottom-20 left-4 sm:bottom-5 sm:left-5 z-40 w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200 hover:scale-105 ${
          open
            ? 'bg-orange-500 text-white shadow-lg shadow-orange-200'
            : 'bg-white/70 backdrop-blur-md border-2 border-orange-400 text-orange-500 shadow-md shadow-orange-100 hover:bg-orange-50/80'
        }`}
        title="Segnala un problema"
        aria-label="Apri feedback"
      >
        {open ? <X className="h-5 w-5" /> : <MessageSquarePlus className="h-5 w-5" />}
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed bottom-36 left-4 sm:bottom-20 sm:left-5 z-40 w-80 bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden animate-in slide-in-from-bottom-4 duration-200">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-50 flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: '#fce7f3' }}>
              <MessageSquarePlus className="h-3.5 w-3.5" style={{ color: '#e85c8d' }} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 leading-tight">Segnala un problema</h2>
              <p className="text-[11px] text-slate-400">Descrivi il comportamento inatteso</p>
            </div>
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
                placeholder="Descrivi cosa è successo... (Ctrl+Invio per inviare)"
                rows={4}
                className="w-full text-sm text-slate-800 placeholder:text-slate-300 border border-slate-200 rounded-xl px-3 py-2.5 resize-none focus:outline-none focus:ring-2 focus:ring-pink-200 focus:border-pink-300 transition-all"
                disabled={status === 'loading'}
              />

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
    </>
  )
}
