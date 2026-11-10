import { useEffect, useState } from 'react'
import { Check, Image as ImageIcon, Loader2, Sparkles } from '@/components/icons'
import { tl } from '@/i18n/tl'

/** An image slot that still has only its prompt: the prompt is shown (and editable) on the slide, and the picture
 *  is generated from here on demand. `status` comes from the editor, which runs the generation. */
export function SlideImagePlaceholder({ prompt, status, error, readOnly, onPromptChange, onGenerate }: {
  prompt: string
  status?: 'busy' | 'error'
  error?: string
  readOnly?: boolean
  onPromptChange?: (prompt: string) => void
  onGenerate?: (prompt: string) => void
}) {
  const [draft, setDraft] = useState(prompt)
  useEffect(() => setDraft(prompt), [prompt])
  const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onDoubleClick: (e: React.MouseEvent) => e.stopPropagation() }
  const busy = status === 'busy'
  const commit = () => { if (draft.trim() && draft.trim() !== prompt) onPromptChange?.(draft.trim()) }
  return (
    <div className="flex h-full w-full flex-col gap-2 overflow-hidden rounded-[inherit] border-2 border-dashed border-violet-300 bg-gradient-to-br from-violet-50 to-sky-50 p-3 text-slate-700">
      <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-violet-700">
        <ImageIcon className="h-3.5 w-3.5" />{tl("Immagine da generare")}
      </div>
      {readOnly || !onGenerate
        ? <p className="min-h-0 flex-1 overflow-auto text-[12px] leading-snug">{prompt}</p>
        : <textarea {...stop} value={draft} disabled={busy} onChange={(e) => setDraft(e.target.value)} onBlur={commit} maxLength={1200}
            aria-label={tl("Prompt dell’immagine")}
            className="min-h-0 flex-1 resize-none rounded-lg border-0 bg-white/70 px-2 py-1.5 text-[12px] leading-snug outline-none focus:ring-2 focus:ring-violet-300" />}
      {status === 'error' && <p className="text-[11px] font-semibold text-rose-600" role="alert">{error || tl("Immagine non generata: riprova.")}</p>}
      {!readOnly && onGenerate && (
        <button type="button" {...stop} disabled={busy || !draft.trim()} onClick={() => { commit(); onGenerate(draft.trim()) }}
          className="flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-bold text-white shadow-sm hover:bg-violet-700 disabled:opacity-60">
          {busy ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />{tl("Genero l’immagine…")}</> : <><Sparkles className="h-3.5 w-3.5" />{status === 'error' ? tl("Riprova") : tl("Genera immagine")}</>}
        </button>
      )}
    </div>
  )
}

/** Brief confirmation shown on a picture once it has really been generated and placed. */
export function GeneratedBadge() {
  return (
    <span className="pointer-events-none absolute left-2 top-2 z-10 flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white shadow" role="status">
      <Check className="h-3 w-3" />{tl("Immagine generata")}
    </span>
  )
}
