import { FileSpreadsheet, FileText, Globe2, MonitorPlay, PenTool, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type DocumentKind = 'presentation' | 'document' | 'sheet' | 'canvas' | 'pdf' | 'web'

type ParsedForKind = {
  type?: string
  slides?: unknown
  data?: unknown
  items?: unknown
  htmlContent?: string
  content?: string
  source?: { extension?: string }
}

const KIND_META: Record<DocumentKind, { icon: LucideIcon; it: string; en: string; badge: string; soft: string }> = {
  document: { icon: FileText, it: 'Documento', en: 'Document', badge: 'bg-emerald-600 text-white', soft: 'bg-emerald-50 text-emerald-600' },
  presentation: { icon: MonitorPlay, it: 'Presentazione', en: 'Presentation', badge: 'bg-indigo-600 text-white', soft: 'bg-indigo-50 text-indigo-600' },
  sheet: { icon: FileSpreadsheet, it: 'Tabella', en: 'Table', badge: 'bg-sky-600 text-white', soft: 'bg-sky-50 text-sky-600' },
  canvas: { icon: PenTool, it: 'Lavagna', en: 'Board', badge: 'bg-amber-500 text-white', soft: 'bg-amber-50 text-amber-600' },
  pdf: { icon: FileText, it: 'PDF', en: 'PDF', badge: 'bg-rose-600 text-white', soft: 'bg-rose-50 text-rose-600' },
  web: { icon: Globe2, it: 'Pagina web', en: 'Web page', badge: 'bg-fuchsia-600 text-white', soft: 'bg-fuchsia-50 text-fuchsia-600' },
}

/** Resolves what a stored document really is from its content, falling back to the declared type. */
export function resolveDocumentKind(content: ParsedForKind, declared: DocumentKind): DocumentKind {
  if (content.source?.extension?.toLowerCase().replace(/^\./, '') === 'pdf' && !Array.isArray(content.slides)) return 'pdf'
  if (content.type === 'presentation_v2' || Array.isArray(content.slides)) return 'presentation'
  if (content.type === 'sheet_v1' || Array.isArray(content.data)) return 'sheet'
  if (content.type === 'canvas_v1' || Array.isArray(content.items)) return 'canvas'
  if (/^\s*(?:<!doctype\s+html|<html)/i.test(content.htmlContent || content.content || '')) return 'web'
  return declared
}

export function documentKindMeta(kind: DocumentKind) {
  return KIND_META[kind] || KIND_META.document
}

interface DocumentTypeBadgeProps {
  kind: DocumentKind
  /** Original file extension for imported files (pdf, docx, pptx…): shown next to the type. */
  extension?: string
  className?: string
}

export default function DocumentTypeBadge({ kind, extension, className = '' }: DocumentTypeBadgeProps) {
  const { i18n } = useTranslation()
  const isEnglish = i18n.resolvedLanguage?.startsWith('en') ?? false
  const meta = documentKindMeta(kind)
  const Icon = meta.icon
  const label = isEnglish ? meta.en : meta.it
  const ext = extension?.replace(/^\./, '').toUpperCase()
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-1 text-[10px] font-bold leading-none shadow-sm ${meta.badge} ${className}`}>
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{ext && ext !== label.toUpperCase() ? `${label} · ${ext}` : label}</span>
    </span>
  )
}
