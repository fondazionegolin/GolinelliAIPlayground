import { useEffect, useMemo, useRef, useState } from 'react'
import { Compartment } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { Play, Trash2, Plus, GripVertical, Loader2, Sparkles, Check, X, Scissors, Copy, ArrowUpDown } from 'lucide-react'
import NotebookCellOutput from './NotebookCellOutput'
import { editorKeymap, getEditorExtensions, getNotebookThemeSurface, proposalDecorationExtension } from './editorConfig'
import type { Cell, NotebookCodeProposal, NotebookFontFamily, NotebookProjectType, NotebookTheme } from './types'

interface Props {
  cell: Cell
  projectType: NotebookProjectType
  theme: NotebookTheme
  fontSize: number
  fontFamily: NotebookFontFamily
  fontWeight?: number
  isRunning: boolean
  isActive: boolean
  isCompact?: boolean
  showOutputs?: boolean
  proposals?: NotebookCodeProposal[]
  onActivate: () => void
  onChange: (source: string) => void
  onRun: () => void
  onApplyProposal?: (proposalId: string) => void
  onRejectProposal?: (proposalId: string) => void
  onDelete?: () => void
  onInsertBelow?: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}

const severityStyles: Record<NotebookCodeProposal['severity'], string> = {
  error: 'border-red-500/30 bg-red-500/10 text-red-100',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
  info: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-100',
}

export default function NotebookCell({
  cell,
  projectType,
  theme,
  fontSize,
  fontFamily,
  fontWeight = 400,
  isRunning,
  isActive,
  isCompact = false,
  showOutputs = true,
  proposals = [],
  onActivate,
  onChange,
  onRun,
  onApplyProposal,
  onRejectProposal,
  onDelete,
  onInsertBelow,
  onMoveUp,
  onMoveDown,
}: Props) {
  const editorRef = useRef<ReactCodeMirrorRef>(null)
  const proposalCompartment = useRef(new Compartment())
  // Only track has/has-not selection as a boolean — no re-render on every mousemove
  const [hasSelection, setHasSelection] = useState(false)

  // Stable refs for callbacks so they never appear in useMemo deps
  const onRunRef = useRef(onRun)
  onRunRef.current = onRun
  const onInsertBelowRef = useRef(onInsertBelow)
  onInsertBelowRef.current = onInsertBelow

  // Created once — always calls the latest prop via refs
  const stableKeymap = useRef(editorKeymap(
    () => onRunRef.current(),
    () => onInsertBelowRef.current?.(),
  ))

  // Created once — setHasSelection from useState is already stable
  const updateListenerExt = useRef(
    EditorView.updateListener.of((update) => {
      if (update.selectionSet || update.docChanged) {
        setHasSelection(!update.state.selection.main.empty)
      }
    }),
  )

  const lineCount = cell.source.split('\n').length
  const editorHeight = isCompact
    ? '100%'
    : `${Math.max(120, Math.min(lineCount * 22 + 36, 460))}px`

  const applyWholeDocTransform = (transform: (source: string, from: number, to: number) => { source: string; anchor: number; head: number }) => {
    const view = editorRef.current?.view
    if (!view) return
    const main = view.state.selection.main
    if (main.empty) return
    const currentSource = view.state.doc.toString()
    const next = transform(currentSource, main.from, main.to)
    view.dispatch({
      changes: { from: 0, to: currentSource.length, insert: next.source },
      selection: { anchor: next.anchor, head: next.head },
    })
    onChange(next.source)
  }

  const deleteSelection = () => {
    const view = editorRef.current?.view
    if (!view) return
    const main = view.state.selection.main
    if (main.empty) return
    view.dispatch({
      changes: { from: main.from, to: main.to, insert: '' },
      selection: { anchor: main.from },
    })
    onChange(view.state.doc.toString())
  }

  const duplicateSelection = () => {
    const view = editorRef.current?.view
    if (!view) return
    const main = view.state.selection.main
    if (main.empty) return
    const text = view.state.sliceDoc(main.from, main.to)
    view.dispatch({
      changes: { from: main.to, insert: text },
      selection: { anchor: main.to, head: main.to + text.length },
    })
    onChange(view.state.doc.toString())
  }

  const moveSelectedLines = (direction: 'up' | 'down') => {
    applyWholeDocTransform((source, from, to) => {
      const startLineIndex = source.slice(0, from).split('\n').length - 1
      const endLineIndex = source.slice(0, to).split('\n').length - 1
      const lines = source.split('\n')

      if (direction === 'up' && startLineIndex === 0) return { source, anchor: from, head: to }
      if (direction === 'down' && endLineIndex >= lines.length - 1) return { source, anchor: from, head: to }

      const removed = lines.splice(startLineIndex, endLineIndex - startLineIndex + 1)
      const targetIndex = direction === 'up' ? startLineIndex - 1 : startLineIndex + 1
      lines.splice(targetIndex, 0, ...removed)

      const nextSource = lines.join('\n')
      const startOffset = lines.slice(0, targetIndex).reduce((sum, line) => sum + line.length + 1, 0)
      const length = removed.join('\n').length
      return { source: nextSource, anchor: startOffset, head: startOffset + length }
    })
  }

  // Extensions rebuilt ONLY when theme/font/projectType/fontWeight change.
  // onRun/onInsertBelow are accessed via stable refs, so they are NOT deps.
  // Proposal decorations live in a Compartment updated by useEffect below.
  // updateListener is a stable ref — never triggers a rebuild.
  const extensions = useMemo(
    () => [
      ...getEditorExtensions(
        projectType,
        theme,
        fontFamily,
        stableKeymap.current,
        fontWeight,
      ),
      // Compartment initialised with current proposals; kept in sync by useEffect
      proposalCompartment.current.of(
        proposalDecorationExtension(cell.source, proposals),
      ),
      updateListenerExt.current,
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fontFamily, fontWeight, projectType, theme],
  )

  // Update proposal decorations without rebuilding the entire extension list
  useEffect(() => {
    const view = editorRef.current?.view
    if (!view) return
    view.dispatch({
      effects: proposalCompartment.current.reconfigure(
        proposalDecorationExtension(cell.source, proposals),
      ),
    })
  }, [cell.source, proposals])
  const surface = getNotebookThemeSurface(theme)
  const isLight = theme === 'light'

  return (
    <div
      className={`group relative flex gap-2 rounded-2xl transition-all ${isCompact ? 'h-full' : ''} ${
        isActive ? 'ring-2 ring-indigo-500/60 shadow-lg shadow-indigo-500/10' : ''
      }`}
      onClick={onActivate}
    >
      {!isCompact && (
        <div className="flex w-8 flex-shrink-0 flex-col items-center gap-1 pt-2">
          <span className="w-full text-right font-mono text-[10px] leading-5 text-slate-500">
            {isRunning ? (
              <Loader2 className="ml-auto h-3 w-3 animate-spin text-indigo-400" />
            ) : (
              cell.execution_count !== null ? `[${cell.execution_count}]` : '[ ]'
            )}
          </span>
          <GripVertical className="mt-1 h-3 w-3 cursor-grab text-slate-600 opacity-0 group-hover:opacity-100" />
        </div>
      )}

      <div className={`min-w-0 flex-1 overflow-hidden rounded-2xl shadow-sm ${surface.shell} ${isCompact ? 'flex h-full flex-col' : ''}`}>
        <div className={`flex flex-shrink-0 items-center justify-between border-b px-3 py-2 ${surface.toolbar}`}>
          <span className={`font-mono text-[10px] ${surface.subtle}`}>
            {projectType === 'python' ? 'python' : 'p5js'} · ln {lineCount}
          </span>
          <div className="flex items-center gap-1">
            {hasSelection && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteSelection() }}
                  title="Elimina selezione"
                  className={`rounded p-1 transition-colors ${isLight ? 'text-slate-500 hover:bg-slate-200 hover:text-slate-800' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}
                >
                  <Scissors className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); duplicateSelection() }}
                  title="Duplica selezione"
                  className={`rounded p-1 transition-colors ${isLight ? 'text-slate-500 hover:bg-slate-200 hover:text-slate-800' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); moveSelectedLines('up') }}
                  title="Sposta blocco su"
                  className={`rounded p-1 transition-colors ${isLight ? 'text-slate-500 hover:bg-slate-200 hover:text-slate-800' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); moveSelectedLines('down') }}
                  title="Sposta blocco giù"
                  className={`rounded p-1 transition-colors ${isLight ? 'text-slate-500 hover:bg-slate-200 hover:text-slate-800' : 'text-slate-300 hover:bg-white/10 hover:text-white'}`}
                >
                  <ArrowUpDown className="h-3.5 w-3.5 rotate-180" />
                </button>
              </>
            )}
            {!isCompact && (
              <>
                <button
                  onClick={(e) => { e.stopPropagation(); onMoveUp?.() }}
                  title="Sposta su"
                  className={`px-1 text-[10px] transition-colors ${isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-500 hover:text-slate-200'}`}
                >
                  ▲
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onMoveDown?.() }}
                  title="Sposta giù"
                  className={`px-1 text-[10px] transition-colors ${isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-500 hover:text-slate-200'}`}
                >
                  ▼
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onInsertBelow?.() }}
                  title="Aggiungi cella sotto (Alt+Enter)"
                  className={`rounded p-0.5 transition-colors ${isLight ? 'text-slate-500 hover:text-slate-800' : 'text-slate-500 hover:text-slate-200'}`}
                >
                  <Plus className="h-3 w-3" />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete?.() }}
                  title="Elimina cella"
                  className={`rounded p-0.5 transition-colors ${isLight ? 'text-slate-500 hover:text-red-600' : 'text-slate-500 hover:text-red-400'}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </>
            )}
            {!isCompact && (
              <button
                onClick={(e) => { e.stopPropagation(); onRun() }}
                disabled={isRunning}
                title="Esegui (Shift+Enter)"
                className="ml-1 flex items-center gap-1 rounded-lg bg-indigo-600 px-2 py-1 text-[10px] text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
              >
                {isRunning ? (
                  <Loader2 className="h-2.5 w-2.5 animate-spin" />
                ) : (
                  <Play className="h-2.5 w-2.5" />
                )}
                Run
              </button>
            )}
          </div>
        </div>

        <CodeMirror
          ref={editorRef}
          value={cell.source}
          onChange={onChange}
          extensions={extensions}
          style={{ fontSize: `${fontSize}px`, ...(isCompact ? { flex: 1, minHeight: 0 } : {}) }}
          height={editorHeight}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            highlightSpecialChars: true,
            foldGutter: false,
            drawSelection: true,
            dropCursor: true,
            allowMultipleSelections: false,
            indentOnInput: true,
            syntaxHighlighting: false,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: false,
            rectangularSelection: false,
            crosshairCursor: false,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            closeBracketsKeymap: true,
            defaultKeymap: true,
            searchKeymap: false,
            historyKeymap: true,
            foldKeymap: false,
            completionKeymap: true,
            lintKeymap: false,
          }}
        />

        {proposals.length > 0 && (
          <div className={`border-t px-3 py-2 ${isLight ? 'border-slate-200 bg-slate-50' : 'border-white/5 bg-black/20'}`}>
            <div className={`mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] ${isLight ? 'text-slate-500' : 'text-slate-400'}`}>
              <Sparkles className="h-3.5 w-3.5 text-indigo-300" />
              Proposte AI da approvare
            </div>
            <div className="space-y-2">
              {proposals.map((proposal) => (
                <div
                  key={proposal.id}
                  className={`rounded-xl border px-3 py-2 text-xs ${severityStyles[proposal.severity]}`}
                >
                  <p className="font-semibold">
                    Righe {proposal.line_start}{proposal.line_end !== proposal.line_start ? `-${proposal.line_end}` : ''}: {proposal.message}
                  </p>
                  {proposal.teacher_note && (
                    <p className="mt-1 leading-relaxed text-white/90">{proposal.teacher_note}</p>
                  )}
                  {proposal.explanation && (
                    <p className="mt-1 leading-relaxed text-white/75">{proposal.explanation}</p>
                  )}
                  <pre className="mt-2 overflow-x-auto rounded-lg bg-black/20 p-2 font-mono text-[11px] text-white/90">
                    {proposal.replacement}
                  </pre>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); onApplyProposal?.(proposal.id) }}
                      className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[11px] font-semibold text-emerald-100 transition hover:bg-emerald-500/30"
                    >
                      <Check className="h-3 w-3" />
                      Applica
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); onRejectProposal?.(proposal.id) }}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-500/20 px-2.5 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-slate-500/30"
                    >
                      <X className="h-3 w-3" />
                      Rifiuta
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {showOutputs && <NotebookCellOutput outputs={cell.outputs} executionCount={cell.execution_count} />}
      </div>
    </div>
  )
}
