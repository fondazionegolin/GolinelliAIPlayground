import { useEffect, useMemo, useRef, useState } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { explicitFunction, looksLikeLatex, plainToLatex } from './canvasMath'
import { tl } from '@/i18n/tl'

/** `|` marks where the caret lands after inserting. */
const PALETTE: Array<{ label: string; tex: string; group: string }> = [
  { group: 'base', label: 'a/b', tex: '\\frac{|}{}' }, { group: 'base', label: 'xⁿ', tex: '^{|}' }, { group: 'base', label: 'xₙ', tex: '_{|}' },
  { group: 'base', label: '√', tex: '\\sqrt{|}' }, { group: 'base', label: 'ⁿ√', tex: '\\sqrt[|]{}' }, { group: 'base', label: '( )', tex: '\\left(|\\right)' },
  { group: 'base', label: '|x|', tex: '\\left||\\right|' }, { group: 'base', label: 'Σ', tex: '\\sum_{i=1}^{n} |' }, { group: 'base', label: '∫', tex: '\\int_{a}^{b} | \\,dx' },
  { group: 'base', label: 'lim', tex: '\\lim_{x \\to |}' }, { group: 'base', label: 'log', tex: '\\log_{|}' }, { group: 'base', label: 'sin', tex: '\\sin\\left(|\\right)' },
  { group: 'op', label: '±', tex: '\\pm ' }, { group: 'op', label: '×', tex: '\\times ' }, { group: 'op', label: '÷', tex: '\\div ' }, { group: 'op', label: '≤', tex: '\\le ' },
  { group: 'op', label: '≥', tex: '\\ge ' }, { group: 'op', label: '≠', tex: '\\ne ' }, { group: 'op', label: '≈', tex: '\\approx ' }, { group: 'op', label: '∞', tex: '\\infty ' },
  { group: 'op', label: '→', tex: '\\to ' }, { group: 'op', label: '⇒', tex: '\\Rightarrow ' }, { group: 'op', label: '∈', tex: '\\in ' }, { group: 'op', label: '·', tex: '\\cdot ' },
  ...['α', 'β', 'γ', 'δ', 'θ', 'λ', 'μ', 'π', 'σ', 'φ', 'ω', 'Δ', 'Σ', 'Ω'].map((g) => ({
    group: 'greek', label: g, tex: `\\${{ α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', θ: 'theta', λ: 'lambda', μ: 'mu', π: 'pi', σ: 'sigma', φ: 'phi', ω: 'omega', Δ: 'Delta', Σ: 'Sigma', Ω: 'Omega' }[g]} `,
  })),
]

export type FormulaPatch = { latex: string; src?: string }

/** Floating editor for a formula: type plain math ("y = 3x^2 + 3") or LaTeX, with a symbol palette, live preview and smart actions. */
export function FormulaEditor({ latex, src, onChange, onClose, onGraph, onAssist }: {
  latex: string; src?: string
  onChange: (patch: FormulaPatch) => void
  onClose: () => void
  onGraph?: () => void
  onAssist?: (prompt: string) => void
}) {
  const [text, setText] = useState(src ?? latex)
  const area = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { area.current?.focus(); area.current?.select() }, [])

  const isLatex = looksLikeLatex(text)
  const converted = useMemo(() => (isLatex ? text : plainToLatex(text)), [isLatex, text])
  const html = useMemo(() => katex.renderToString(converted ?? text, { throwOnError: false, displayMode: true, trust: false }), [converted, text])
  const plain = isLatex ? undefined : text
  const canGraph = !!onGraph && !!explicitFunction(plain)

  const apply = (next: string) => {
    setText(next)
    if (looksLikeLatex(next)) onChange({ latex: next, src: undefined })
    else onChange({ latex: plainToLatex(next) ?? next, src: next })
  }

  const insert = (tex: string) => {
    const el = area.current
    if (!el) return
    const caret = tex.indexOf('|')
    const snippet = tex.replace('|', '')
    const start = el.selectionStart, end = el.selectionEnd
    const selected = el.value.slice(start, end)
    // Wrap the current selection into the first slot, e.g. select "x+1" then √ → \sqrt{x+1}
    const body = selected && caret >= 0 ? snippet.slice(0, caret) + selected + snippet.slice(caret) : snippet
    el.setRangeText(body, start, end, 'end')
    if (caret >= 0 && !selected) el.setSelectionRange(start + caret, start + caret)
    apply(el.value)
    el.focus()
  }

  const target = plain || converted || text
  const actions: Array<[string, string]> = [
    [tl("Risolvi passo passo"), `Risolvi passo passo: ${target}. Scrivi ogni passaggio come formula sotto la precedente, con un breve commento.`],
    [tl("Semplifica"), `Semplifica ${target}, mostrando i passaggi come formule.`],
    [tl("Spiega"), `Spiegami cosa significa ${target} e come si usa, con un esempio.`],
    [tl("Verifica"), `Controlla se ${target} è scritta correttamente e se i passaggi dell'utente sono giusti.`],
  ]

  return (
    <div className="absolute bottom-4 left-1/2 z-40 w-[min(680px,94%)] -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 text-slate-900 shadow-xl"
      onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); onClose() } }}>
      <div className="mb-2 flex flex-wrap items-center gap-1">
        {['base', 'op', 'greek'].map((group) => (
          <div key={group} className="flex flex-wrap items-center gap-0.5 border-r border-slate-100 pr-1.5 last:border-0">
            {PALETTE.filter((p) => p.group === group).map((p) => (
              <button key={p.label + p.tex} type="button" title={p.tex.replace('|', '…')} onMouseDown={(e) => e.preventDefault()} onClick={() => insert(p.tex)}
                className="h-7 min-w-7 rounded px-1.5 text-sm text-slate-700 hover:bg-slate-100">{p.label}</button>
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <textarea ref={area} value={text} onChange={(e) => apply(e.target.value)} rows={2} spellCheck={false} aria-label={tl("Formula")}
          placeholder={tl("Scrivi come a mano (y = 3x^2 + 3) oppure in LaTeX")}
          className="min-h-[56px] w-1/2 resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-[#e85c8d]" />
        <div className="flex min-h-[56px] flex-1 items-center justify-center overflow-x-auto rounded-lg bg-slate-50 px-2 text-slate-900" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
      {!isLatex && text.trim() !== '' && converted === null && (
        <p className="mt-1 text-[11px] text-amber-600">{tl("Non riconosco questa scrittura: usa i simboli sopra oppure scrivi in LaTeX (es. \\frac{a}{b}).")}</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {canGraph && <button type="button" onClick={onGraph} className="rounded-md bg-[#1a1a2e] px-2.5 py-1 text-xs font-bold text-white hover:opacity-90">{tl("Disegna il grafico")}</button>}
        {onAssist && actions.map(([label, prompt]) => (
          <button key={label} type="button" disabled={!text.trim()} onClick={() => { onClose(); onAssist(prompt) }}
            className="rounded-md border border-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40">{label}</button>
        ))}
        <button type="button" onClick={onClose} className="ml-auto rounded-md bg-[#e85c8d] px-3 py-1 text-xs font-bold text-white">{tl("Fatto")}</button>
      </div>
    </div>
  )
}
