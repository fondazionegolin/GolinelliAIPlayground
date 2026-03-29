import { useRef } from 'react'
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'
import { autocompletion } from '@codemirror/autocomplete'
import { keymap } from '@codemirror/view'
import { Play, Trash2, Plus, GripVertical, Loader2 } from 'lucide-react'
import type { CellOutput } from '@/hooks/usePyodide'
import NotebookCellOutput from './NotebookCellOutput'

export interface Cell {
  id: string
  type: 'code' | 'markdown'
  source: string
  outputs: CellOutput[]
  execution_count: number | null
}

interface Props {
  cell: Cell
  isRunning: boolean
  isActive: boolean
  onActivate: () => void
  onChange: (source: string) => void
  onRun: () => void
  onDelete: () => void
  onInsertBelow: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export default function NotebookCell({
  cell,
  isRunning,
  isActive,
  onActivate,
  onChange,
  onRun,
  onDelete,
  onInsertBelow,
  onMoveUp,
  onMoveDown,
}: Props) {
  const editorRef = useRef<ReactCodeMirrorRef>(null)

  const extraKeymap = keymap.of([
    {
      key: 'Shift-Enter',
      run: () => { onRun(); return true },
    },
    {
      key: 'Alt-Enter',
      run: () => { onRun(); onInsertBelow(); return true },
    },
  ])

  const lineCount = cell.source.split('\n').length
  const editorHeight = Math.max(60, Math.min(lineCount * 20 + 24, 400))

  return (
    <div
      className={`group relative flex gap-2 rounded-xl transition-all ${
        isActive ? 'ring-2 ring-indigo-500/60 shadow-lg shadow-indigo-500/10' : ''
      }`}
      onClick={onActivate}
    >
      {/* Left gutter */}
      <div className="flex flex-col items-center gap-1 pt-2 w-8 flex-shrink-0">
        {/* Execution count */}
        <span className="text-[10px] font-mono text-slate-500 w-full text-right leading-5">
          {isRunning ? (
            <Loader2 className="h-3 w-3 animate-spin text-indigo-400 ml-auto" />
          ) : (
            cell.execution_count !== null ? `[${cell.execution_count}]` : '[ ]'
          )}
        </span>
        {/* Drag handle — visible on hover */}
        <GripVertical className="h-3 w-3 text-slate-600 opacity-0 group-hover:opacity-100 mt-1 cursor-grab" />
      </div>

      {/* Cell body */}
      <div className="flex-1 min-w-0 rounded-xl overflow-hidden border border-[#2a2d36] shadow-sm">
        {/* Top bar */}
        <div className="flex items-center justify-between bg-[#21242c] px-3 py-1 border-b border-[#2a2d36]">
          <span className="text-[10px] text-slate-500 font-mono">python  ·  ln {lineCount}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => { e.stopPropagation(); onMoveUp() }}
              title="Sposta su"
              className="text-slate-600 hover:text-slate-300 text-[10px] px-1 transition-colors"
            >▲</button>
            <button
              onClick={(e) => { e.stopPropagation(); onMoveDown() }}
              title="Sposta giù"
              className="text-slate-600 hover:text-slate-300 text-[10px] px-1 transition-colors"
            >▼</button>
            <button
              onClick={(e) => { e.stopPropagation(); onInsertBelow() }}
              title="Aggiungi cella sotto (Alt+Enter)"
              className="text-slate-600 hover:text-slate-300 p-0.5 rounded transition-colors"
            >
              <Plus className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              title="Elimina cella"
              className="text-slate-600 hover:text-red-400 p-0.5 rounded transition-colors"
            >
              <Trash2 className="h-3 w-3" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onRun() }}
              disabled={isRunning}
              title="Esegui (Shift+Enter)"
              className="flex items-center gap-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-[10px] px-2 py-0.5 rounded transition-colors ml-1"
            >
              {isRunning ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : (
                <Play className="h-2.5 w-2.5" />
              )}
              Run
            </button>
          </div>
        </div>

        {/* CodeMirror editor */}
        <CodeMirror
          ref={editorRef}
          value={cell.source}
          onChange={onChange}
          theme={oneDark}
          extensions={[python(), autocompletion(), extraKeymap]}
          style={{ fontSize: '0.78rem' }}
          height={`${editorHeight}px`}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            highlightSpecialChars: true,
            foldGutter: false,
            drawSelection: true,
            dropCursor: true,
            allowMultipleSelections: false,
            indentOnInput: true,
            syntaxHighlighting: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: true,
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

        {/* Output area */}
        <NotebookCellOutput outputs={cell.outputs} executionCount={cell.execution_count} />
      </div>
    </div>
  )
}
