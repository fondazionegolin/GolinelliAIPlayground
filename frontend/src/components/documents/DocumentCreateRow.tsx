import type { ReactNode } from 'react'
import { FileUp, Loader2 } from '@/components/icons'

/** Small flat illustrations of the three things you can create: a page of text, a slide, a table. */
function PageArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true">
      <rect x="34" y="6" width="52" height="72" rx="5" fill="currentColor" opacity="0.12" />
      <rect x="40" y="14" width="26" height="5" rx="2.5" fill="currentColor" opacity="0.75" />
      <rect x="40" y="25" width="40" height="3" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="40" y="32" width="40" height="3" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="40" y="39" width="34" height="3" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="40" y="50" width="40" height="3" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="40" y="57" width="28" height="3" rx="1.5" fill="currentColor" opacity="0.35" />
      <path d="M92 52l10-10 6 6-10 10-8 2z" fill="currentColor" opacity="0.8" />
    </svg>
  )
}

function SlideArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true">
      <rect x="14" y="10" width="92" height="56" rx="6" fill="currentColor" opacity="0.12" />
      <rect x="22" y="19" width="38" height="6" rx="3" fill="currentColor" opacity="0.75" />
      <rect x="22" y="31" width="34" height="3" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="22" y="38" width="30" height="3" rx="1.5" fill="currentColor" opacity="0.35" />
      <rect x="64" y="30" width="34" height="28" rx="4" fill="currentColor" opacity="0.3" />
      <circle cx="74" cy="39" r="4" fill="currentColor" opacity="0.6" />
      <path d="M66 56l9-9 7 6 6-5 8 8z" fill="currentColor" opacity="0.55" />
      <rect x="52" y="70" width="16" height="4" rx="2" fill="currentColor" opacity="0.35" />
    </svg>
  )
}

function TableArt() {
  return (
    <svg viewBox="0 0 120 84" className="h-full w-full" aria-hidden="true">
      <rect x="18" y="12" width="84" height="60" rx="6" fill="currentColor" opacity="0.12" />
      <path d="M18 18a6 6 0 016-6h72a6 6 0 016 6v8H18z" fill="currentColor" opacity="0.55" />
      <g stroke="currentColor" strokeWidth="1.5" opacity="0.4">
        <path d="M18 42h84M18 57h84M46 26v46M74 26v46" />
      </g>
      <rect x="22" y="31" width="18" height="6" rx="2" fill="currentColor" opacity="0.5" />
      <rect x="50" y="46" width="18" height="6" rx="2" fill="currentColor" opacity="0.5" />
      <rect x="78" y="61" width="18" height="6" rx="2" fill="currentColor" opacity="0.5" />
    </svg>
  )
}

interface CreateCardProps { art: ReactNode; label: string; hint: string; tone: string; onClick: () => void }

function CreateCard({ art, label, hint, tone, onClick }: CreateCardProps) {
  return (
    <button type="button" onClick={onClick} className={`ui-card ui-card-interactive group flex flex-col items-center gap-2 p-4 text-center ${tone}`}>
      <span className="block h-20 w-28 transition-transform duration-200 group-hover:scale-105">{art}</span>
      <span className="block text-sm font-black leading-5 text-slate-950">{label}</span>
      <span className="block text-[11px] leading-4 text-slate-500">{hint}</span>
    </button>
  )
}

interface DocumentCreateRowProps {
  isEnglish: boolean
  importing: boolean
  dragActive: boolean
  onNewDocument: () => void
  onNewPresentation: () => void
  onNewSheet: () => void
  onBrowseFiles: () => void
}

/** Centered "create" row (document · presentation · table) plus a drop zone for importing files. */
export default function DocumentCreateRow({ isEnglish, importing, dragActive, onNewDocument, onNewPresentation, onNewSheet, onBrowseFiles }: DocumentCreateRowProps) {
  return (
    <section className="mx-auto w-full max-w-3xl space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <CreateCard art={<PageArt />} tone="bg-emerald-50/75 text-emerald-600" label={isEnglish ? 'New document' : 'Nuovo documento'} hint={isEnglish ? 'Write and format.' : 'Scrivi e impagina.'} onClick={onNewDocument} />
        <CreateCard art={<SlideArt />} tone="bg-indigo-50/75 text-indigo-500" label={isEnglish ? 'New presentation' : 'Nuova presentazione'} hint={isEnglish ? 'Outline, style, slides.' : 'Scaletta, stile, slide.'} onClick={onNewPresentation} />
        <CreateCard art={<TableArt />} tone="bg-cyan-50/75 text-cyan-600" label={isEnglish ? 'New table' : 'Nuova tabella'} hint={isEnglish ? 'Data and formulas.' : 'Dati e formule.'} onClick={onNewSheet} />
      </div>
      <button
        type="button"
        disabled={importing}
        onClick={onBrowseFiles}
        className={`flex w-full items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-4 py-4 text-center transition-colors disabled:cursor-wait disabled:opacity-60 ${dragActive ? 'border-sky-400 bg-sky-500/10 text-sky-500' : 'border-slate-300/70 text-slate-500 hover:border-sky-400/70 hover:text-sky-500'}`}
      >
        {importing ? <Loader2 className="h-5 w-5 shrink-0 animate-spin" /> : <FileUp className="h-5 w-5 shrink-0" />}
        <span className="text-sm font-semibold">
          {importing
            ? (isEnglish ? 'Importing…' : 'Importazione in corso…')
            : (isEnglish ? 'Drop files here to import them' : 'Trascina qui i file da importare')}
          <span className="ml-2 text-[11px] font-medium opacity-80">PDF · PPT · DOC · XLS · CSV</span>
        </span>
      </button>
    </section>
  )
}
