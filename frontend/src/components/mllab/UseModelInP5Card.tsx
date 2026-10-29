import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Brain, FileCode2, Sparkles, X } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { MODE_LABEL, type Mode } from '@/lib/mlFeatures'
import { tl } from '@/i18n/tl'

const VIOLET = '#7b69c9'
const BLUE = '#3ea9f4'

/** Mini replicas of the real screens, so the steps look like what the user will actually see. */
function StepArt({ step, name }: { step: 1 | 2 | 3; name: string }) {
  if (step === 1) return (
    <div className="flex h-full items-center justify-center gap-2">
      {['Python', 'p5.js', 'micro:bit'].map((label) => (
        <span key={label} className={`flex h-14 w-16 items-end justify-center rounded-xl pb-1.5 text-[10px] font-bold ${label === 'p5.js' ? 'text-white shadow-lg ring-4 ring-sky-200 dark:ring-sky-400/30' : 'bg-slate-200/70 text-slate-400 dark:bg-white/10'}`} style={label === 'p5.js' ? { background: BLUE } : undefined}>{label}</span>
      ))}
    </div>
  )
  if (step === 2) return (
    <div className="flex h-full flex-col justify-center gap-2.5 px-3">
      <div className="flex items-center gap-1.5 rounded-xl bg-slate-100 px-2.5 py-2 dark:bg-white/10">
        <span className="h-2 w-2 rounded-full bg-rose-300" /><span className="h-2 w-2 rounded-full bg-amber-300" /><span className="h-2 w-2 rounded-full bg-emerald-300" />
        <span className="ml-1 rounded-md bg-slate-200 px-2 py-1 text-[10px] font-bold text-slate-400 dark:bg-white/10">{tl("Esegui")}</span>
        <span className="flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-bold text-white shadow-md ring-4 ring-violet-200 dark:ring-violet-400/30" style={{ background: VIOLET }}><Brain className="h-3 w-3" /> {tl("Modelli")}</span>
      </div>
      <div className="space-y-1.5 px-1"><span className="block h-1.5 w-3/4 rounded-full bg-slate-200 dark:bg-white/10" /><span className="block h-1.5 w-1/2 rounded-full bg-slate-200 dark:bg-white/10" /></div>
    </div>
  )
  return (
    <div className="flex h-full flex-col justify-center gap-2 px-3">
      <div className="flex items-center gap-2 rounded-xl bg-violet-50 p-2 ring-2 ring-violet-200 dark:bg-violet-500/10">
        <span className="ds-squircle flex h-7 w-7 items-center justify-center text-white" style={{ background: VIOLET }}><Brain className="h-4 w-4" /></span>
        <span className="truncate text-[11px] font-bold text-slate-800 dark:text-slate-100">{name}</span>
      </div>
      <span className="flex items-center justify-center gap-1 rounded-xl py-2 text-[10px] font-bold text-white shadow-md ring-4 ring-violet-200 dark:ring-violet-400/30" style={{ background: VIOLET }}><Sparkles className="h-3 w-3" /> {tl("Crea uno sketch pronto")}</span>
    </div>
  )
}

/** Shown once a model is trained: how to bring it into a p5.js sketch, with a shortcut to the Notebook module. */
export default function UseModelInP5Card({ name, mode }: { name: string; mode: Mode }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const isTeacher = useLocation().pathname.startsWith('/teacher')
  const goToNotebooks = () => {
    if (isTeacher) navigate('/teacher/notebooks')
    else window.dispatchEvent(new CustomEvent('student-open-module', { detail: 'notebook' }))
  }
  const steps: Array<{ n: 1 | 2 | 3; title: string; text: string }> = [
    { n: 1, title: tl("Apri un quaderno p5.js"), text: tl("Nel Notebook crea un nuovo progetto di tipo p5.js, oppure aprine uno già esistente.") },
    { n: 2, title: tl("Premi «Modelli»"), text: tl("Lo trovi nella barra in alto dell’editor, accanto ai pulsanti di esecuzione.") },
    { n: 3, title: tl("Scegli il tuo modello"), text: tl("Seleziona «{0}», provalo dal vivo e premi «Crea uno sketch pronto»: il codice è già scritto.", name) },
  ]

  return (
    <>
      <div className="space-y-3 rounded-3xl p-5" style={{ background: 'color-mix(in srgb, #7b69c9 9%, transparent)' }}>
        <div className="flex items-center gap-3">
          <span className="ds-squircle flex h-11 w-11 shrink-0 items-center justify-center text-white" style={{ background: VIOLET }}><Sparkles className="h-5 w-5" /></span>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">{tl("Il modello è pronto: usalo per creare!")}</h2>
            <p className="text-xs leading-5 text-slate-600 dark:text-slate-300">{tl("Con p5.js puoi trasformare il riconoscimento (")}{MODE_LABEL[mode].toLowerCase()}{tl(") in giochi, animazioni, musica e arte interattiva.")}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button tone="accent" surface="solid" density="compact" onClick={goToNotebooks}><FileCode2 className="h-4 w-4" /> {tl("Vai al Notebook p5.js")}</Button>
          <Button tone="neutral" surface="outline" density="compact" onClick={() => setOpen(true)}>{tl("Come si usa?")}</Button>
        </div>
      </div>

      {open && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onMouseDown={() => setOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-4xl overflow-y-auto rounded-[2rem] bg-white p-8 shadow-2xl dark:bg-slate-900 sm:p-10" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={tl("Usare il modello in p5.js")}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{tl("Porta il modello in uno sketch p5.js")}</h2>
                <p className="mt-1.5 text-sm text-slate-500 dark:text-slate-400">{tl("Tre passi, nel Notebook. Il modello che hai appena addestrato è già salvato e ti aspetta nell’elenco.")}</p>
              </div>
              <button onClick={() => setOpen(false)} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/10" aria-label={tl("Chiudi")}><X className="h-5 w-5" /></button>
            </div>
            <ol className="mt-8 grid gap-4 md:grid-cols-3">
              {steps.map((step) => (
                <li key={step.n} className="flex flex-col gap-4 rounded-3xl bg-slate-50 p-4 dark:bg-white/5">
                  <div className="h-32 overflow-hidden rounded-2xl bg-white dark:bg-slate-900"><StepArt step={step.n} name={name} /></div>
                  <div>
                    <span className="mb-1.5 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold text-white" style={{ background: VIOLET }}>{step.n}</span>
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">{step.title}</h3>
                    <p className="mt-1 text-sm leading-snug text-slate-600 dark:text-slate-300">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex gap-3 rounded-3xl p-5" style={{ background: 'color-mix(in srgb, #f59e0b 12%, transparent)' }}>
              <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <p className="text-sm leading-6 text-slate-700 dark:text-slate-200"><b>{tl("Ricorda:")}</b> {tl("il modello non finisce qui. Puoi riusarlo tutte le volte che vuoi per creare")} <b>{tl("script visivi")}</b> {tl("in p5.js che reagiscono a ciò che riconosce, per scopi creativi: un disegno che cambia colore con un gesto, un personaggio che segue i tuoi movimenti, un suono per ogni espressione.")}</p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button tone="neutral" surface="outline" onClick={() => setOpen(false)}>{tl("Chiudi")}</Button>
              <Button tone="accent" surface="solid" onClick={() => { setOpen(false); goToNotebooks() }}><FileCode2 className="h-4 w-4" /> {tl("Vai al Notebook p5.js")}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
