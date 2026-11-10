import { useState } from 'react'
import { Check, Copy } from '@/components/icons'
import { useToast } from '@/components/ui/use-toast'
import { tl } from '@/i18n/tl'

/** Session join code in the navbar: yellow pill with black digits; a click copies it. */
export function SessionCodePill({ code, className = '', size = 'md' }: { code: string; className?: string; size?: 'sm' | 'md' }) {
  const { toast } = useToast()
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      // Clipboard API unavailable (http, old browser): fall back to a hidden textarea.
      const area = document.createElement('textarea')
      area.value = code
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    setCopied(true)
    toast({ title: tl("Codice sessione copiato"), description: code })
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button
      type="button"
      onClick={copy}
      title={tl("Copia il codice sessione")}
      aria-label={tl("Copia il codice sessione {0}", code)}
      className={`flex shrink-0 items-center rounded-full border-[1.5px] border-[var(--ds-session-code-line)] bg-[var(--ds-session-code-bg)] font-mono font-black text-[var(--ds-session-code-ink)] transition-[filter,transform] hover:bg-yellow-400/10 active:scale-95 ${size === 'sm' ? 'h-6 gap-1 px-2 text-[11px] tracking-[0.12em]' : 'h-9 gap-1.5 px-3 text-[15px] tracking-[0.18em]'} ${className}`}
    >
      {code}
      {copied ? <Check className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} /> : <Copy className={`${size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} opacity-60`} />}
    </button>
  )
}
