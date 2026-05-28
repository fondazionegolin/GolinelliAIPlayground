import { useState } from 'react'
import { X, ChevronDown, ChevronRight, PackagePlus, Code2, Camera } from 'lucide-react'
import { NOTEBOOK_LIBRARIES, LIBRARY_CATEGORIES, type NotebookLibrary, type LibraryTemplate } from './notebookLibraries'

interface Props {
  open: boolean
  onClose: () => void
  selectedLibraries: string[]
  onToggleLibrary: (id: string) => void
  onInsertTemplate: (code: string) => void
}

const CATEGORY_ORDER: NotebookLibrary['category'][] = ['ml', 'physics', 'audio', 'graphics']

function TemplateCard({ template, onInsert }: { template: LibraryTemplate; onInsert: () => void }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">{template.name}</p>
          <p className="mt-0.5 text-[11px] text-slate-500 leading-relaxed">{template.description}</p>
        </div>
        <button
          onClick={onInsert}
          className="flex flex-shrink-0 items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700 transition-colors"
          title="Inserisci nella cella attiva"
        >
          <Code2 className="h-3 w-3" />
          Inserisci
        </button>
      </div>
    </div>
  )
}

function LibraryCard({
  library,
  selected,
  onToggle,
  onInsertTemplate,
}: {
  library: NotebookLibrary
  selected: boolean
  onToggle: () => void
  onInsertTemplate: (code: string) => void
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={`rounded-xl border transition-all ${selected ? 'border-indigo-300 bg-indigo-50/60' : 'border-slate-200 bg-white'}`}>
      <div className="p-3">
        <div className="flex items-start gap-3">
          <span className="text-2xl flex-shrink-0 leading-none mt-0.5">{library.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-800">{library.name}</span>
                {library.requiresCamera && (
                  <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                    <Camera className="h-2.5 w-2.5" />
                    webcam
                  </span>
                )}
              </div>
              <button
                onClick={onToggle}
                className={`flex-shrink-0 rounded-lg px-3 py-1 text-xs font-semibold transition-colors ${
                  selected
                    ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                {selected ? 'Rimuovi' : 'Aggiungi'}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-slate-500 leading-relaxed">{library.description}</p>
          </div>
        </div>

        {/* Templates section */}
        {selected && library.templates.length > 0 && (
          <div className="mt-3 pt-3 border-t border-indigo-200">
            <button
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700 hover:text-indigo-900 transition-colors"
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              {library.templates.length} template{library.templates.length > 1 ? 's' : ''} disponibili
            </button>
            {expanded && (
              <div className="mt-2 space-y-2">
                {library.templates.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    onInsert={() => onInsertTemplate(t.code)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function NotebookLibraryManager({
  open,
  onClose,
  selectedLibraries,
  onToggleLibrary,
  onInsertTemplate,
}: Props) {
  if (!open) return null

  const grouped = CATEGORY_ORDER.reduce<Record<string, NotebookLibrary[]>>((acc, cat) => {
    acc[cat] = NOTEBOOK_LIBRARIES.filter((l) => l.category === cat)
    return acc
  }, {})

  const activeCount = selectedLibraries.length

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" onClick={onClose}>
      <div
        className="relative h-full w-full max-w-sm overflow-y-auto bg-slate-50 shadow-2xl border-l border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex items-center gap-2">
            <PackagePlus className="h-4 w-4 text-indigo-600" />
            <span className="text-sm font-bold text-slate-800">Librerie</span>
            {activeCount > 0 && (
              <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold text-white">
                {activeCount} attiv{activeCount === 1 ? 'a' : 'e'}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Info banner */}
        <div className="mx-3 mt-3 rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2">
          <p className="text-[11px] text-indigo-700 leading-relaxed">
            Le librerie vengono caricate prima dello sketch. Le librerie con{' '}
            <span className="font-semibold">webcam</span> richiedono autorizzazione camera.
            Usa i <span className="font-semibold">template</span> come punto di partenza.
          </p>
        </div>

        {/* Library list grouped by category */}
        <div className="p-3 space-y-5">
          {CATEGORY_ORDER.map((cat) => {
            const libs = grouped[cat]
            if (!libs || libs.length === 0) return null
            return (
              <div key={cat}>
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                  {LIBRARY_CATEGORIES[cat]}
                </p>
                <div className="space-y-2">
                  {libs.map((lib) => (
                    <LibraryCard
                      key={lib.id}
                      library={lib}
                      selected={selectedLibraries.includes(lib.id)}
                      onToggle={() => onToggleLibrary(lib.id)}
                      onInsertTemplate={onInsertTemplate}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <div className="h-6" />
      </div>
    </div>
  )
}
