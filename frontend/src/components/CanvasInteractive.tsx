import { useState } from 'react'
import type { CanvasItem } from './CollaborativeCanvas'
import { shadeTopFor, shapeStrokeFor } from './canvasColors'
import { tl } from '@/i18n/tl'

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
          <strong className={correct.has(choice!) ? 'text-emerald-700' : 'text-rose-700'}>{correct.has(choice!) ? tl("Corretto!") : tl("Non è corretto.")}</strong>
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
        {result && <button type="button" {...stop} onClick={() => setShowKey((v) => !v)} className="text-[11px] font-semibold text-slate-600 underline">{showKey ? tl("Nascondi la soluzione") : tl("Mostra la soluzione")}</button>}
      </div>
      {result && (
        <div className={`mt-2 rounded-xl px-2.5 py-1.5 text-[12px] leading-snug ${result.ok ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'}`} role="status">
          <strong>{result.ok ? tl("Ben fatto!") : tl("Quasi…")}</strong> {result.feedback}
        </div>
      )}
      {showKey && <p className="mt-1.5 rounded-xl bg-white/70 px-2.5 py-1.5 text-[12px] text-slate-700"><strong>{tl("Soluzione:")}</strong> {item.expected}</p>}
    </Shell>
  )
}
