import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronDown, FileText } from '@/components/icons'
import { tl } from '@/i18n/tl'

/** Class-chat card for a call summary/synthesis a teacher shared: title, the first lines, «Leggi tutto». */
export function CallSummaryCard({ data }: { data: Record<string, any> }) {
  const [open, setOpen] = useState(false)
  const content = String(data.content || '')
  return (
    <div className="ds-semantic-surface mx-2 rounded-xl bg-[rgba(123,105,201,0.065)] p-3">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#181b1e] text-white"><FileText className="h-4 w-4" /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase text-neutral-900">{tl("Dalla videochiamata")}</div>
          <p className="truncate text-xs font-semibold text-slate-800">{String(data.title || tl("Riassunto"))}</p>
          {data.recording_title && <p className="truncate text-[11px] text-slate-500">{String(data.recording_title)}</p>}
        </div>
      </div>
      <div className={`prose prose-sm mt-3 max-w-none text-[13px] text-slate-700 prose-headings:text-sm prose-strong:text-violet-700 ${open ? '' : 'max-h-24 overflow-hidden [mask-image:linear-gradient(#000_55%,transparent)]'}`}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
      <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 flex w-full items-center justify-center gap-1 rounded-lg py-1.5 text-xs font-semibold text-neutral-900 hover:bg-black/5">
        {open ? tl("Riduci") : tl("Leggi tutto")}<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
    </div>
  )
}
