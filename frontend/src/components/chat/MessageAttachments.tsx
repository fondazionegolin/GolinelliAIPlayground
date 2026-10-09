import { FileText, FileSpreadsheet, FileImage, File as FileIcon } from '@/components/icons'
import type { MessageAttachment } from '@/lib/chatAttachments'

function iconFor(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (['xls', 'xlsx', 'csv', 'tsv'].includes(ext)) return FileSpreadsheet
  if (['pdf', 'doc', 'docx', 'txt', 'md', 'ppt', 'pptx', 'odt'].includes(ext)) return FileText
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'heic'].includes(ext)) return FileImage
  return FileIcon
}

/** Thumbnails of the files sent with a user message (image preview, or a typed file card). */
export function MessageAttachments({ attachments, className = '' }: { attachments?: MessageAttachment[]; className?: string }) {
  if (!attachments || attachments.length === 0) return null
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {attachments.map((att, i) => {
        if (att.kind === 'image' && att.url) {
          return (
            <a key={i} href={att.url} target="_blank" rel="noreferrer" title={att.name}>
              <img
                src={att.url}
                alt={att.name}
                className="max-h-40 max-w-[240px] rounded-xl border border-black/10 object-cover shadow-sm"
              />
            </a>
          )
        }
        const Icon = iconFor(att.name)
        const ext = att.name.includes('.') ? att.name.split('.').pop()!.toUpperCase() : ''
        if (att.url) {
          return (
            <div key={i} title={att.name} className="w-28 overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm">
              <img src={att.url} alt={`Anteprima di ${att.name}`} className="h-32 w-full bg-slate-100 object-contain" />
              <div className="flex items-center gap-1.5 px-2 py-1.5 text-slate-700">
                <Icon className="h-4 w-4 shrink-0 text-slate-500" />
                <span className="truncate text-[11px] font-semibold">{att.name}</span>
              </div>
            </div>
          )
        }
        return (
          <div
            key={i}
            title={att.name}
            className="flex w-40 items-center gap-2 rounded-xl border border-black/10 bg-white/70 px-3 py-2 text-slate-700 shadow-sm"
          >
            <Icon className="h-6 w-6 shrink-0 text-slate-500" />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">{att.name}</p>
              {ext && <p className="text-[10px] text-slate-400">{ext}</p>}
            </div>
          </div>
        )
      })}
    </div>
  )
}
