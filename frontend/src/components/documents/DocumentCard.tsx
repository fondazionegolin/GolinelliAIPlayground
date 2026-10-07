import type { ReactNode } from 'react'
import { Trash2 } from '@/components/icons'
import DocumentThumbnail from './DocumentThumbnail'
import type { DocumentKind } from './DocumentTypeBadge'

interface DocumentCardProps {
  title: string
  type: DocumentKind
  contentJson: string
  /** Secondary lines under the title (author, class, date…). */
  meta?: ReactNode
  /** Small status chip next to the title (e.g. "Bozza", "Correzione"). */
  status?: ReactNode
  onOpen: () => void
  onDelete?: () => void
  deleteLabel?: string
  className?: string
}

/**
 * Catalog tile: square preview that always states the file type, then title + meta.
 * The whole tile is one keyboard-reachable control; delete is a separate button.
 */
export default function DocumentCard({ title, type, contentJson, meta, status, onOpen, onDelete, deleteLabel = 'Elimina', className = '' }: DocumentCardProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={title}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onOpen() }
      }}
      className={`ui-card ui-card-interactive group relative flex min-w-0 cursor-pointer flex-col overflow-hidden bg-white/95 p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 ${className}`}
    >
      <DocumentThumbnail className="w-full shrink-0" contentJson={contentJson} type={type} title={title} />
      <div className="min-w-0 px-1.5 pb-1 pt-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-[13px] font-bold text-slate-800" title={title}>{title}</p>
          {status && <span className="shrink-0">{status}</span>}
        </div>
        {meta && <div className="mt-0.5 space-y-0.5 text-[11px] leading-4 text-slate-500">{meta}</div>}
      </div>
      {onDelete && (
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onDelete() }}
          aria-label={`${deleteLabel}: ${title}`}
          title={deleteLabel}
          className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-lg bg-white/95 text-slate-500 shadow-sm ring-1 ring-black/5 transition-all hover:text-red-600 focus-visible:opacity-100 md:h-8 md:w-8 md:opacity-0 md:group-hover:opacity-100"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
