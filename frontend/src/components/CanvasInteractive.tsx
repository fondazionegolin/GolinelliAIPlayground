import { useState } from 'react'
import type { CanvasItem } from './CollaborativeCanvas'
import { shadeTopFor, shapeStrokeFor } from './canvasColors'
import { tl } from '@/i18n/tl'
import { answerHash } from './canvasFigures'

const HAND = "'Patrick Hand', 'Segoe Print', 'Comic Sans MS', cursive"

/** Interactive learning cards placed on the board (by the assistant): a quiz, a flashcard, an open question checked
 *  against an answer key. Answers are written into the item (`answers`, keyed by participant) when the viewer may edit
 *  the board, so the whole group (and the board report) sees them; otherwise the feedback stays local. */

type Quiz = Extract<CanvasItem, { type: 'quiz' }>
type Flash = Extract<CanvasItem, { type: 'flashcard' }>
type Check = Extract<CanvasItem, { type: 'check' }>
export type CheckResult = { ok: boolean; feedback: string }

type Common = {
  /** Stable key of the viewer (user id) and their display name. */
  viewer: { key: string; name: string }
  /** Whether answers can be stored on the board. */
  canRecord: boolean
  onRecord: (patch: Partial<CanvasItem>) => void
}

const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onDoubleClick: (e: React.MouseEvent) => e.stopPropagation() }

function Shell({ color, badge, stats, children }: { color: string; badge: string; stats?: string; children: React.ReactNode }) {
  const tone = shapeStrokeFor(color)
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl text-slate-900"
      style={{ background: `linear-gradient(180deg, ${shadeTopFor(color, 0.55)} 0%, ${color} 100%)`, boxShadow: `inset 0 0 0 1.5px ${tone}66, 0 4px 14px -6px ${tone}66` }}>
      <div className="flex items-center gap-2 px-3 pt-2.5 cursor-grab">
        <span className="rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-white" style={{ background: tone }}>{badge}</span>
        {stats && <span className="ml-auto text-[10px] font-semibold text-slate-600">{stats}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-3 pt-2">{children}</div>
    </div>
  )
}

function statsOf(answers: Record<string, { ok: boolean }> | undefined): string | undefined {
  const list = Object.values(answers || {})
  if (!list.length) return undefined
  const right = list.filter((a) => a.ok).length
  return tl("{0} risposte · {1}% corrette", String(list.length), String(Math.round((right / list.length) * 100)))
}

export function QuizCard({ item, viewer, canRecord, onRecord }: Common & { item: Quiz }) {
  const recorded = item.answers?.[viewer.key]
  const [choice, setChoice] = useState<number | null>(recorded?.choice ?? null)
  const answered = choice !== null
  const correct = new Set(item.correct)
  const pick = (index: number) => {
    if (answered) return
    setChoice(index)
    if (canRecord) onRecord({ answers: { ...(item.answers || {}), [viewer.key]: { name: viewer.name, choice: index, ok: correct.has(index), at: Date.now() } } } as Partial<CanvasItem>)
  }
  return (
    <Shell color={item.color} badge={tl("Quiz")} stats={statsOf(item.answers)}>
      <p className="mb-2 text-sm font-bold leading-snug">{item.question}</p>
      <div className="grid gap-1.5">
        {item.options.map((option, index) => {
          const state = !answered ? 'idle' : correct.has(index) ? 'right' : index === choice ? 'wrong' : 'idle'
          return (
            <button key={index} type="button" {...stop} onClick={() => pick(index)} disabled={answered}
              className={`flex items-start gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] leading-snug transition-colors ${
                state === 'right' ? 'bg-emerald-100 text-emerald-900 ring-1 ring-emerald-400' : state === 'wrong' ? 'bg-rose-100 text-rose-900 ring-1 ring-rose-300' : 'bg-white/75 hover:bg-white'} ${answered ? 'cursor-default' : ''}`}>
              <span className="mt-px shrink-0 font-black text-slate-500">{String.fromCharCode(65 + index)}</span>
              <span className="flex-1">{option}</span>
              {state === 'right' && <span aria-hidden>✓</span>}
              {state === 'wrong' && <span aria-hidden>✗</span>}
            </button>
          )
        })}
      </div>
      {answered && (
        <div className="mt-2 rounded-xl bg-white/70 px-2.5 py-2 text-[12px] leading-snug" role="status">
          <strong className={correct.has(choice!) ? 'text-emerald-700' : 'text-rose-700'}>{correct.has(choice!) ? tl("Corretto") : tl("Non è corretto.")}</strong>
          {item.explanation && <span className="ml-1 text-slate-700">{item.explanation}</span>}
          <button type="button" {...stop} onClick={() => setChoice(null)} className="ml-2 font-semibold text-slate-500 underline">{tl("Riprova")}</button>
          {!canRecord && <span className="mt-1 block text-[10px] text-slate-500">{tl("Risposta non registrata: la lavagna è in sola lettura.")}</span>}
        </div>
      )}
    </Shell>
  )
}

export function FlashCard({ item, viewer, canRecord, onRecord }: Common & { item: Flash }) {
  const [back, setBack] = useState(false)
  const mine = item.answers?.[viewer.key]
  const rate = (ok: boolean) => { if (canRecord) onRecord({ answers: { ...(item.answers || {}), [viewer.key]: { name: viewer.name, ok, at: Date.now() } } } as Partial<CanvasItem>) }
  return (
    <Shell color={item.color} badge={back ? tl("Risposta") : tl("Flashcard")} stats={statsOf(item.answers)}>
      <button type="button" {...stop} onClick={() => setBack((v) => !v)} className="flex min-h-[60%] w-full items-center justify-center rounded-xl bg-white/60 px-3 py-3 text-center transition-colors hover:bg-white/80" aria-label={tl("Gira la carta")}>
        <span className={back ? 'text-[13px] leading-snug' : 'text-base font-bold leading-snug'}>{back ? item.back : item.front}</span>
      </button>
      <div className="mt-2 flex items-center gap-1.5 text-[11px]">
        <span className="text-slate-500">{back ? tl("Lo sapevi?") : tl("Clic per girare")}</span>
        {back && <>
          <button type="button" {...stop} onClick={() => rate(true)} className={`ml-auto rounded-full px-2 py-0.5 font-semibold ${mine?.ok === true ? 'bg-emerald-500 text-white' : 'bg-white/80 text-emerald-700'}`}>{tl("Sì")}</button>
          <button type="button" {...stop} onClick={() => rate(false)} className={`rounded-full px-2 py-0.5 font-semibold ${mine?.ok === false ? 'bg-amber-500 text-white' : 'bg-white/80 text-amber-700'}`}>{tl("Da ripassare")}</button>
        </>}
      </div>
    </Shell>
  )
}

/** Local fallback when no AI validator is available: share of the answer key's meaningful words found in the answer. */
export function keywordCheck(expected: string, answer: string): CheckResult {
  const words = (s: string) => new Set(s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 3))
  const key = words(expected), given = words(answer)
  if (!key.size) return { ok: answer.trim().length > 0, feedback: '' }
  const hit = [...key].filter((w) => given.has(w) || [...given].some((g) => g.startsWith(w.slice(0, 5)))).length / key.size
  return hit >= 0.5 ? { ok: true, feedback: tl("La risposta contiene gli elementi chiave.") } : { ok: false, feedback: tl("Mancano alcuni elementi chiave: rileggi la domanda e riprova.") }
}

export function CheckCard({ item, viewer, canRecord, onRecord, onValidate }: Common & { item: Check; onValidate?: (question: string, expected: string, answer: string) => Promise<CheckResult> }) {
  const recorded = item.answers?.[viewer.key]
  const [text, setText] = useState(recorded?.text || '')
  const [result, setResult] = useState<CheckResult | null>(recorded ? { ok: recorded.ok, feedback: recorded.feedback || "" } : null)
  const [busy, setBusy] = useState(false)
  const [showKey, setShowKey] = useState(false)
  async function verify() {
    if (!text.trim() || busy) return
    setBusy(true)
    let next: CheckResult
    try { next = onValidate ? await onValidate(item.question, item.expected, text.trim()) : keywordCheck(item.expected, text) } catch { next = keywordCheck(item.expected, text) }
    setResult(next); setBusy(false)
    if (canRecord) onRecord({ answers: { ...(item.answers || {}), [viewer.key]: { name: viewer.name, text: text.trim().slice(0, 600), ok: next.ok, feedback: next.feedback.slice(0, 400), at: Date.now() } } } as Partial<CanvasItem>)
  }
  return (
    <Shell color={item.color} badge={tl("Verifica")} stats={statsOf(item.answers)}>
      <p className="mb-2 text-sm font-bold leading-snug">{item.question}</p>
      {item.hint && !result && <p className="mb-1.5 text-[11px] italic text-slate-600">{item.hint}</p>}
      <textarea {...stop} value={text} onChange={(e) => { setText(e.target.value); setResult(null) }} rows={3} maxLength={600}
        placeholder={tl("Scrivi la tua risposta…")} className="w-full resize-none rounded-xl border-0 bg-white/80 px-2.5 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-slate-400" />
      <div className="mt-1.5 flex items-center gap-2">
        <button type="button" {...stop} onClick={() => void verify()} disabled={!text.trim() || busy} className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-bold text-white disabled:opacity-40">{busy ? tl("Verifico…") : tl("Verifica")}</button>
        {result && !item.expected.startsWith('sealed:') && <button type="button" {...stop} onClick={() => setShowKey((v) => !v)} className="text-[11px] font-semibold text-slate-600 underline">{showKey ? tl("Nascondi la soluzione") : tl("Mostra la soluzione")}</button>}
      </div>
      {result && (
        <div className={`mt-2 rounded-xl px-2.5 py-1.5 text-[12px] leading-snug ${result.ok ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`} role="status">
          <strong>{result.ok ? tl("Ben fatto") : tl("Quasi…")}</strong> {result.feedback}
        </div>
      )}
      {showKey && <p className="mt-1.5 rounded-xl bg-white/70 px-2.5 py-1.5 text-[12px] text-slate-700"><strong>{tl("Soluzione:")}</strong> {item.expected}</p>}
    </Shell>
  )
}

type FillIn = Extract<CanvasItem, { type: 'fillin' }>

/**
 * A table the learner completes: the given cells are fixed, the blank ones are inputs. «Controlla» marks every blank cell
 * right or wrong (and shows the cell's hint when it is wrong) without ever showing a key: the board only holds salted hashes.
 */
export function FillInTable({ item, viewer, canRecord, onRecord }: Common & { item: FillIn }) {
  const recorded = item.answers?.[viewer.key]
  const [values, setValues] = useState<Record<string, string>>(() => { try { return recorded?.text ? (JSON.parse(recorded.text) as Record<string, string>) : {} } catch { return {} } })
  const [marks, setMarks] = useState<Record<string, boolean> | null>(null)
  const blanks = item.rows.flatMap((r, ri) => r.cells.map((c, ci) => (c.h ? `${ri},${ci}` : null))).filter((k): k is string => !!k)
  const right = marks ? blanks.filter((k) => marks[k]).length : 0
  const filled = blanks.filter((k) => (values[k] || '').trim()).length

  const verify = () => {
    const next: Record<string, boolean> = {}
    item.rows.forEach((r, ri) => r.cells.forEach((c, ci) => {
      if (!c.h) return
      const k = `${ri},${ci}`, v = (values[k] || '').trim()
      next[k] = !!v && c.h.includes(answerHash(item.salt, v))
    }))
    setMarks(next)
    const all = blanks.every((k) => next[k])
    if (canRecord) onRecord({ answers: { ...(item.answers || {}), [viewer.key]: { name: viewer.name, ok: all, text: JSON.stringify(values).slice(0, 900), at: Date.now() } } } as Partial<CanvasItem>)
  }
  const wrongHints = marks ? item.rows.flatMap((r, ri) => r.cells.flatMap((c, ci) => (c.h && !marks[`${ri},${ci}`] && c.hint ? [{ where: `${r.label || tl("Riga {0}", String(ri + 1))} · ${item.columns[ci]}`, hint: c.hint }] : []))) : []
  const cols = item.columns.length + 1
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-2xl bg-white text-slate-900" style={{ boxShadow: 'inset 0 0 0 1.5px #cbd5e1, 0 4px 14px -6px rgba(15,23,42,.25)' }}>
      <div className="flex cursor-grab items-start gap-2 px-3.5 pt-3">
        <div className="min-w-0 flex-1">
          {item.title && <p className="text-sm font-semibold leading-snug">{item.title}</p>}
          {item.instruction && <p className="mt-0.5 text-[13px] leading-snug text-slate-600">{item.instruction}</p>}
        </div>
        {statsOf(item.answers) && <span className="shrink-0 text-[10px] font-semibold text-slate-500">{statsOf(item.answers)}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 pb-2 pt-2.5">
        <div className="grid gap-1.5" style={{ gridTemplateColumns: `minmax(64px, auto) repeat(${cols - 1}, minmax(52px, 1fr))` }}>
          <div className="rounded-lg bg-slate-100 px-2 py-1.5 text-center text-[12px] font-semibold text-slate-500">{item.corner || ''}</div>
          {item.columns.map((c, i) => <div key={i} className="rounded-lg px-2 py-1.5 text-center text-[13px] font-semibold" style={{ background: ['#dbeafe', '#dcfce7', '#fef9c3', '#fce7f3', '#ede9fe', '#ffedd5', '#e0f2fe', '#fecaca'][i % 8], fontFamily: HAND, fontStyle: 'italic' }}>{c}</div>)}
          {item.rows.map((r, ri) => (
            <div key={ri} className="contents">
              <div className="flex items-center justify-center rounded-lg bg-pink-50 px-2 py-1.5 text-center text-[13px] font-semibold" style={{ fontFamily: HAND, fontStyle: 'italic' }}>{r.label}</div>
              {r.cells.map((c, ci) => {
                const k = `${ri},${ci}`
                if (!c.h) return <div key={ci} className="flex items-center justify-center rounded-lg bg-slate-50 px-2 py-1.5 text-center text-[15px] shadow-[inset_0_0_0_1px_#e2e8f0]" style={{ fontFamily: HAND, fontStyle: 'italic' }}>{c.v}</div>
                const mark = marks ? marks[k] : undefined
                return (
                  <div key={ci} className="relative">
                    <input {...stop} value={values[k] || ''} disabled={!canRecord && false} inputMode="text" aria-label={`${r.label} ${item.columns[ci]}`}
                      onChange={(e) => { setValues((v) => ({ ...v, [k]: e.target.value })); setMarks((m) => (m ? { ...m, [k]: undefined as never } : m)) }}
                      onKeyDown={(e) => { if (e.key === 'Enter') verify() }}
                      placeholder="?" className={`h-full min-h-[34px] w-full rounded-lg px-2 py-1 text-center text-[16px] outline-none transition-colors placeholder:text-amber-500 ${mark === true ? 'bg-emerald-100 shadow-[inset_0_0_0_2px_#34d399]' : mark === false ? 'bg-rose-100 shadow-[inset_0_0_0_2px_#fb7185]' : 'bg-amber-50 shadow-[inset_0_0_0_2px_#fcd34d] focus:shadow-[inset_0_0_0_2px_#f59e0b]'}`}
                      style={{ fontFamily: HAND, fontStyle: 'italic' }} />
                    {mark !== undefined && <span aria-hidden className={`pointer-events-none absolute right-1 top-0.5 text-[11px] font-bold ${mark ? 'text-emerald-600' : 'text-rose-600'}`}>{mark ? '✓' : '✗'}</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="px-3.5 pb-3">
        <div className="flex items-center gap-2">
          <button type="button" {...stop} onClick={verify} disabled={!filled} className="rounded-full bg-slate-900 px-3.5 py-1.5 text-[12px] font-semibold text-white disabled:opacity-40">{tl("Controlla")}</button>
          {marks && (
            <span className={`rounded-full px-2.5 py-1 text-[12px] font-semibold ${right === blanks.length ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'}`} role="status">
              {right === blanks.length ? tl("Ben fatto: tutte giuste") : tl("{0} su {1} giuste: ricontrolla le caselle segnate", String(right), String(blanks.length))}
            </span>
          )}
          {!canRecord && <span className="text-[10px] text-slate-500">{tl("La correzione non viene registrata: lavagna in sola lettura.")}</span>}
        </div>
        {wrongHints.length > 0 && (
          <ul className="mt-1.5 space-y-0.5 text-[12px] leading-snug text-slate-700">
            {wrongHints.slice(0, 3).map((h, i) => <li key={i}><span className="font-semibold">{h.where}:</span> {h.hint}</li>)}
          </ul>
        )}
      </div>
    </div>
  )
}
