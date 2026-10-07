import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Settings2 } from '@/components/icons'
import { Switch } from '@/components/ui/switch'
import { getCompositionPrefs, setCompositionPrefs, subscribeCompositionPrefs, type CompositionPrefs } from '@/lib/documentComposition'

const OPTIONS: Array<{ key: keyof CompositionPrefs; title: string; hint: string }> = [
  { key: 'lists', title: 'Elenchi automatici', hint: '«- », «* », «• », «1. » o «1) » a inizio riga creano un elenco' },
  { key: 'capitalize', title: 'Maiuscola automatica', hint: 'A inizio paragrafo e dopo . ! ? (non dopo ecc., es., art. …)' },
  { key: 'typography', title: 'Tipografia', hint: 'Virgolette “ ” e apostrofo ’, puntini “…”, trattino lungo “ – ”, niente doppi spazi' },
  { key: 'indent', title: 'Rientro sui nuovi paragrafi', hint: 'Il paragrafo creato con Invio dopo un testo parte con un piccolo rientro (non dopo i titoli)' },
]

/** Switches for the automatic composition features of the word processor (stored per browser). */
export function CompositionMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const prefs = useSyncExternalStore(subscribeCompositionPrefs, getCompositionPrefs)

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={`flex h-8 w-8 items-center justify-center rounded-lg text-slate-700 transition hover:bg-slate-100 ${open ? 'bg-slate-200' : ''}`}
        title="Composizione automatica: elenchi, maiuscole, tipografia, rientro"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Settings2 className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-40 mt-2 w-72 space-y-1 rounded-xl border border-slate-200 bg-white p-2 shadow-xl" onMouseDown={(event) => event.preventDefault()}>
          <p className="px-2 pb-1 text-[10px] font-black uppercase tracking-wide text-slate-400">Composizione automatica</p>
          {OPTIONS.map(({ key, title, hint }) => (
            <label key={key} className="flex cursor-pointer items-start justify-between gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-50">
              <span className="min-w-0">
                <span className="block text-xs font-semibold text-slate-800">{title}</span>
                <span className="block text-[11px] leading-snug text-slate-500">{hint}</span>
              </span>
              <Switch checked={prefs[key]} onCheckedChange={(checked) => setCompositionPrefs({ ...prefs, [key]: checked })} />
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
