import { useState } from 'react'
import { FileSpreadsheet, Hash, Type, Calendar, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'

export interface SheetInfo {
  name: string
  rows: number
  columns: string[]
  column_types: Record<string, 'number' | 'text' | 'date'>
  stats: Record<string, { min: number; max: number; mean: number; nulls?: number }>
  sample: string[][]
}

export interface DataFilePreview {
  filename: string
  type: string
  mime_type?: string
  size_bytes?: number
  // xlsx
  sheets?: SheetInfo[]
  active_sheet?: SheetInfo
  // csv
  rows?: number
  columns?: string[]
  column_types?: Record<string, string>
  stats?: Record<string, { min: number; max: number; mean: number }>
  sample?: string[][]
  // json
  records?: number
  keys?: string[]
  // common
  suggested_prompts?: string[]
  error?: string
}

interface DataFileCardProps {
  preview: DataFilePreview
  compact?: boolean
}

const TYPE_ICON: Record<string, React.ReactNode> = {
  number: <Hash className="h-3 w-3 text-blue-500" />,
  text: <Type className="h-3 w-3 text-slate-400" />,
  date: <Calendar className="h-3 w-3 text-green-500" />,
}

function formatSize(bytes?: number) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function DataFileCard({ preview, compact = false }: DataFileCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [activeSheet, setActiveSheet] = useState(0)

  const sheet: SheetInfo | undefined =
    preview.sheets?.[activeSheet] ??
    (preview.type === 'csv'
      ? {
          name: preview.filename,
          rows: preview.rows ?? 0,
          columns: preview.columns ?? [],
          column_types: (preview.column_types as Record<string, 'number' | 'text' | 'date'>) ?? {},
          stats: preview.stats ?? {},
          sample: preview.sample ?? [],
        }
      : undefined)

  if (preview.error) {
    return (
      <div className="flex items-center gap-2 text-xs text-orange-600 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
        <AlertCircle className="h-4 w-4 flex-shrink-0" />
        <span className="truncate">{preview.filename}</span>
        <span className="text-orange-400">— anteprima non disponibile</span>
      </div>
    )
  }

  // JSON or other non-spreadsheet
  if (!sheet && preview.type === 'json') {
    return (
      <div className="flex items-center gap-2 text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
        <FileSpreadsheet className="h-4 w-4 text-slate-500 flex-shrink-0" />
        <div className="min-w-0">
          <div className="font-medium text-slate-700 truncate">{preview.filename}</div>
          <div className="text-slate-400">
            {preview.records != null ? `${preview.records} oggetti` : ''}
            {preview.keys?.length ? ` · ${preview.keys.slice(0, 5).join(', ')}` : ''}
          </div>
        </div>
      </div>
    )
  }

  if (!sheet) return null

  const shownColumns = compact ? sheet.columns.slice(0, 5) : sheet.columns.slice(0, 12)
  const hasStats = Object.keys(sheet.stats || {}).length > 0

  return (
    <div className="rounded-xl border border-slate-200 bg-white text-xs shadow-sm overflow-hidden w-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200">
        <FileSpreadsheet className="h-4 w-4 text-emerald-600 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="font-semibold text-slate-700 truncate block">{preview.filename}</span>
          <span className="text-slate-400">
            {sheet.rows.toLocaleString()} righe · {sheet.columns.length} colonne
            {preview.size_bytes ? ` · ${formatSize(preview.size_bytes)}` : ''}
          </span>
        </div>
        {(preview.sheets?.length ?? 0) <= 1 && hasStats && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-slate-400 hover:text-slate-600 flex-shrink-0"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>

      {/* Sheet tabs */}
      {(preview.sheets?.length ?? 0) > 1 && (
        <div className="flex gap-0 border-b border-slate-200 overflow-x-auto">
          {preview.sheets!.map((s, i) => (
            <button
              key={s.name}
              onClick={() => setActiveSheet(i)}
              className={`px-3 py-1.5 text-xs whitespace-nowrap border-r border-slate-100 transition-colors ${
                i === activeSheet
                  ? 'bg-white text-slate-800 font-medium'
                  : 'bg-slate-50 text-slate-500 hover:bg-white'
              }`}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}

      {/* Column chips */}
      <div className="px-3 py-2 flex flex-wrap gap-1">
        {shownColumns.map(col => (
          <span
            key={col}
            className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 rounded-full px-2 py-0.5"
          >
            {TYPE_ICON[sheet.column_types?.[col] ?? 'text'] ?? TYPE_ICON.text}
            <span className="max-w-[80px] truncate">{col}</span>
          </span>
        ))}
        {sheet.columns.length > shownColumns.length && (
          <span className="bg-slate-100 text-slate-400 rounded-full px-2 py-0.5">
            +{sheet.columns.length - shownColumns.length}
          </span>
        )}
      </div>

      {/* Stats (expandable) */}
      {expanded && hasStats && (
        <div className="px-3 pb-2 grid grid-cols-2 gap-1">
          {Object.entries(sheet.stats).slice(0, 6).map(([col, s]) => (
            <div key={col} className="bg-blue-50 rounded-lg px-2 py-1.5">
              <div className="text-blue-600 font-medium truncate">{col}</div>
              <div className="text-slate-500 space-x-2">
                <span>min {s.min}</span>
                <span>max {s.max}</span>
                <span>avg {s.mean}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sample rows */}
      {expanded && sheet.sample.length > 0 && (
        <div className="px-3 pb-2 overflow-x-auto">
          <table className="text-[10px] text-slate-600 w-full border-collapse">
            <thead>
              <tr className="bg-slate-50">
                {sheet.columns.slice(0, 6).map(col => (
                  <th key={col} className="px-1.5 py-1 text-left font-medium text-slate-500 border border-slate-200 max-w-[80px] truncate">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.sample.slice(0, 3).map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                  {row.slice(0, 6).map((cell, ci) => (
                    <td key={ci} className="px-1.5 py-1 border border-slate-100 max-w-[80px] truncate">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
