import { useEffect, useMemo, useRef, useState } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/design'
import { tl } from '@/i18n/tl'

/** `¶` marks where the caret lands after inserting; `{}` pairs are the slots Tab jumps through. */
interface Snippet { label: string; tex: string; insert: string; title: string }

const s = (tex: string, insert: string, title: string, label = tex): Snippet => ({ label, tex, insert, title })

const GROUPS: { id: string; label: string; items: Snippet[] }[] = [
  { id: 'base', label: tl("Base"), items: [
    s('\\frac{a}{b}', '\\frac{¶}{}', tl("Frazione")),
    s('x^{n}', '^{¶}', tl("Potenza")),
    s('x_{i}', '_{¶}', tl("Pedice")),
    s('\\sqrt{x}', '\\sqrt{¶}', tl("Radice quadrata")),
    s('\\sqrt[n]{x}', '\\sqrt[¶]{}', tl("Radice n-esima")),
    s('|x|', '\\left|\\, ¶ \\,\\right|', tl("Valore assoluto")),
    s('(\\;)', '\\left( ¶ \\right)', tl("Parentesi adattabili")),
    s('\\binom{n}{k}', '\\binom{¶}{}', tl("Coefficiente binomiale")),
    s('\\overline{x}', '\\overline{¶}', tl("Sopralineato")),
    s('\\vec{v}', '\\vec{¶}', tl("Vettore")),
    s('\\hat{x}', '\\hat{¶}', tl("Cappuccio")),
    s('x\\cdot y', '\\cdot ', tl("Prodotto")),
  ] },
  { id: 'calc', label: tl("Analisi"), items: [
    s('\\sum_{i=1}^{n}', '\\sum_{i=1}^{n} ¶', tl("Sommatoria")),
    s('\\prod_{i=1}^{n}', '\\prod_{i=1}^{n} ¶', tl("Produttoria")),
    s('\\int', '\\int ¶ \\, dx', tl("Integrale indefinito")),
    s('\\int_{a}^{b}', '\\int_{¶}^{} \\, dx', tl("Integrale definito")),
    s('\\iint', '\\iint_{¶} \\, dA', tl("Integrale doppio")),
    s('\\oint', '\\oint ¶ \\, d\\ell', tl("Integrale di linea")),
    s('\\lim_{x\\to a}', '\\lim_{x \\to ¶} ', tl("Limite")),
    s('\\frac{dy}{dx}', '\\frac{d¶}{dx}', tl("Derivata")),
    s('\\frac{\\partial f}{\\partial x}', '\\frac{\\partial ¶}{\\partial x}', tl("Derivata parziale")),
    s('\\nabla', '\\nabla ', tl("Nabla")),
    s('f\'(x)', "f'(x)", tl("Derivata (apice)")),
    s('\\Big|_{a}^{b}', '\\Big|_{¶}^{}', tl("Valutato tra")),
  ] },
  { id: 'rel', label: tl("Relazioni"), items: [
    ...[['\\le', tl("Minore o uguale")], ['\\ge', tl("Maggiore o uguale")], ['\\ne', tl("Diverso")], ['\\approx', tl("Circa uguale")], ['\\equiv', tl("Equivalente")], ['\\pm', tl("Più o meno")],
      ['\\times', tl("Per")], ['\\div', tl("Diviso")], ['\\infty', tl("Infinito")], ['\\in', tl("Appartiene")], ['\\notin', tl("Non appartiene")], ['\\subset', tl("Sottoinsieme")],
      ['\\cup', tl("Unione")], ['\\cap', tl("Intersezione")], ['\\emptyset', tl("Insieme vuoto")], ['\\to', tl("Freccia")], ['\\Rightarrow', tl("Implica")], ['\\Leftrightarrow', tl("Se e solo se")],
      ['\\forall', tl("Per ogni")], ['\\exists', tl("Esiste")], ['\\propto', tl("Proporzionale")], ['\\perp', tl("Perpendicolare")], ['\\parallel', tl("Parallelo")], ['\\angle', tl("Angolo")],
      ['^\\circ', tl("Gradi")], ['\\%', tl("Percentuale")], ['\\mathbb{R}', tl("Numeri reali")], ['\\mathbb{N}', tl("Numeri naturali")], ['\\mathbb{Z}', tl("Numeri interi")], ['\\mathbb{Q}', tl("Numeri razionali")],
    ].map(([tex, title]) => s(tex, `${tex} `, title)),
  ] },
  { id: 'greek', label: 'αβγ', items: [
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'theta', 'lambda', 'mu', 'pi', 'rho', 'sigma', 'tau', 'phi', 'omega', 'Delta', 'Sigma', 'Omega', 'Phi', 'Pi', 'Theta',
  ].map(name => s(`\\${name}`, `\\${name} `, name)) },
  { id: 'fn', label: tl("Funzioni"), items: [
    ...['sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'log', 'ln', 'exp', 'max', 'min', 'det'].map(name => s(`\\${name}`, `\\${name}(¶)`, name)),
    s('\\log_{b}', '\\log_{¶}()', tl("Logaritmo in base")),
    s('e^{x}', 'e^{¶}', tl("Esponenziale")),
  ] },
  { id: 'matrix', label: tl("Matrici"), items: [
    s('\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', '\\begin{pmatrix} ¶ & \\\\ & \\end{pmatrix}', tl("Matrice 2×2")),
    s('\\begin{pmatrix}a&b&c\\\\d&e&f\\\\g&h&i\\end{pmatrix}', '\\begin{pmatrix} ¶ & & \\\\ & & \\\\ & & \\end{pmatrix}', tl("Matrice 3×3")),
    s('\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}', '\\begin{vmatrix} ¶ & \\\\ & \\end{vmatrix}', tl("Determinante 2×2")),
    s('\\begin{cases}x\\\\y\\end{cases}', '\\begin{cases} ¶ \\\\ \\end{cases}', tl("Sistema / casi")),
    s('\\begin{pmatrix}x\\\\y\\end{pmatrix}', '\\begin{pmatrix} ¶ \\\\ \\end{pmatrix}', tl("Vettore colonna")),
    s('\\begin{aligned}a&=b\\\\&=c\\end{aligned}', '\\begin{aligned} ¶ &= \\\\ &= \\end{aligned}', tl("Passaggi allineati")),
  ] },
]

function render(tex: string, display: boolean): { html: string; error: string | null } {
  if (!tex.trim()) return { html: '', error: null }
  try { return { html: katex.renderToString(tex, { displayMode: display, throwOnError: true, strict: 'ignore', trust: false }), error: null } }
  catch (error) { return { html: '', error: (error as Error).message.replace(/^KaTeX parse error:\s*/, '') } }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** LaTeX already wrapped in `$…$` / `$$…$$`, ready to drop in the chat input. */
  onInsert: (markdown: string) => void
}

export function MathEditorDialog({ open, onOpenChange, onInsert }: Props) {
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const [tex, setTex] = useState('')
  const [display, setDisplay] = useState(true)
  const [group, setGroup] = useState(GROUPS[0].id)
  const preview = useMemo(() => render(tex, display), [tex, display])

  useEffect(() => { if (open) setTimeout(() => areaRef.current?.focus(), 60) }, [open])

  const insertSnippet = (snippet: Snippet) => {
    const area = areaRef.current
    const start = area?.selectionStart ?? tex.length
    const end = area?.selectionEnd ?? tex.length
    const selected = tex.slice(start, end)
    // A selection fills the first slot, so «x+1» + «frazione» gives \frac{x+1}{}.
    const body = selected ? snippet.insert.replace('¶', selected) : snippet.insert
    const caret = selected ? -1 : body.indexOf('¶')
    const clean = body.replace('¶', '')
    const next = tex.slice(0, start) + clean + tex.slice(end)
    setTex(next)
    const pos = caret >= 0 ? start + caret : start + clean.length
    requestAnimationFrame(() => { area?.focus(); area?.setSelectionRange(pos, pos) })
  }

  /** Tab jumps to the next empty `{}`, `[]` or `&` slot so complex formulas are filled without the mouse. */
  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab' || event.shiftKey) return
    const from = event.currentTarget.selectionEnd
    const rest = tex.slice(from)
    const slot = rest.search(/\{\}|\[\]/)
    if (slot >= 0) { event.preventDefault(); const pos = from + slot + 1; event.currentTarget.setSelectionRange(pos, pos) }
  }

  const confirm = () => {
    if (!tex.trim() || preview.error) return
    onInsert(display ? `\n$$\n${tex.trim()}\n$$\n` : ` $${tex.trim()}$ `)
    setTex('')
    onOpenChange(false)
  }

  const active = GROUPS.find(g => g.id === group) ?? GROUPS[0]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{tl("Editor di formule")}</DialogTitle>
          <DialogDescription>{tl("Scegli i simboli, compila gli spazi vuoti con Tab e inserisci la formula nel messaggio.")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap gap-1" role="tablist">
          {GROUPS.map(item => (
            <Button key={item.id} type="button" role="tab" aria-selected={group === item.id} tone="neutral" surface={group === item.id ? 'soft' : 'ghost'} density="compact" onClick={() => setGroup(item.id)}>
              {item.label}
            </Button>
          ))}
        </div>

        <div className="grid max-h-44 grid-cols-6 gap-1.5 overflow-y-auto sm:grid-cols-8">
          {active.items.map(item => {
            const html = katex.renderToString(item.tex, { throwOnError: false, strict: 'ignore' })
            return (
              <button key={`${item.tex}-${item.title}`} type="button" title={item.title} aria-label={item.title} onClick={() => insertSnippet(item)}
                className="flex h-11 items-center justify-center overflow-hidden rounded-xl bg-[var(--ds-control)] px-1 text-[13px] transition-colors hover:bg-[var(--ds-control-hover)] focus-visible:outline-none focus-visible:shadow-[var(--focus-shadow)]">
                <span dangerouslySetInnerHTML={{ __html: html }} />
              </button>
            )
          })}
        </div>

        <textarea
          ref={areaRef}
          value={tex}
          onChange={event => setTex(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          spellCheck={false}
          placeholder={tl("Scrivi o componi la formula in LaTeX, es. \\frac{a+b}{2}")}
          className="ds-field w-full resize-y rounded-[var(--control-radius)] border-0 px-3 py-2 font-mono text-sm outline-none"
          aria-label={tl("Codice LaTeX")}
        />

        <div className="min-h-[84px] overflow-x-auto rounded-2xl bg-[var(--ds-canvas)] px-4 py-3 text-center" aria-live="polite">
          {preview.error
            ? <p className="text-left text-xs font-semibold text-red-600">{tl("Formula non valida:")} {preview.error}</p>
            : tex.trim()
              ? <span dangerouslySetInnerHTML={{ __html: preview.html }} />
              : <p className="text-xs text-[var(--text-secondary)]">{tl("L'anteprima della formula compare qui.")}</p>}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            <Button type="button" tone="neutral" surface={display ? 'soft' : 'ghost'} density="compact" onClick={() => setDisplay(true)}>{tl("A blocco")}</Button>
            <Button type="button" tone="neutral" surface={!display ? 'soft' : 'ghost'} density="compact" onClick={() => setDisplay(false)}>{tl("Nel testo")}</Button>
          </div>
          <div className="flex-1" />
          <Button type="button" tone="neutral" surface="ghost" density="compact" onClick={() => setTex('')} disabled={!tex}>{tl("Svuota")}</Button>
          <Button type="button" tone="accent" surface="solid" density="compact" onClick={confirm} disabled={!tex.trim() || !!preview.error}>{tl("Inserisci nel messaggio")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
