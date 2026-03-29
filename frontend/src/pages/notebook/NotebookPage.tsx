import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Play, RotateCcw, ArrowLeft, Save, Loader2,
  CheckCircle, AlertCircle, Cpu, Zap, Square, Terminal
} from 'lucide-react'
import { notebooksApi } from '@/lib/api'
import { usePyodide } from '@/hooks/usePyodide'
import NotebookCell, { type Cell } from '@/components/notebook/NotebookCell'
import NotebookTutorChat from '@/components/notebook/NotebookTutorChat'
import { v4 as uuidv4 } from 'uuid'

function newCell(): Cell {
  return { id: uuidv4(), type: 'code', source: '', outputs: [], execution_count: null }
}

interface Props {
  notebookIdOverride?: string
  onBack?: () => void
}

export default function NotebookPage({ notebookIdOverride, onBack }: Props = {}) {
  const { notebookId: notebookIdParam } = useParams<{ notebookId: string }>()
  const notebookId = notebookIdOverride ?? notebookIdParam
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { status: pyStatus, error: pyError, runCell: pyRunCell, restartKernel, inputState } = usePyodide()

  const [cells, setCells] = useState<Cell[]>([])
  const [activeCellId, setActiveCellId] = useState<string | null>(null)
  const [runningCellId, setRunningCellId] = useState<string | null>(null)
  const [execCounter, setExecCounter] = useState(0)
  const [title, setTitle] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved')
  const [inputValue, setInputValue] = useState('')
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Fetch notebook
  const { isLoading, data: notebookData } = useQuery({
    queryKey: ['notebook', notebookId],
    queryFn: async () => {
      const res = await notebooksApi.get(notebookId!)
      return res.data as { title: string; cells: Cell[] }
    },
    enabled: !!notebookId,
  })

  useEffect(() => {
    if (notebookData) {
      setTitle(notebookData.title)
      setCells(notebookData.cells?.length > 0 ? notebookData.cells : [newCell()])
    }
  }, [notebookData])

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (data: { title?: string; cells?: Cell[] }) =>
      notebooksApi.update(notebookId!, data),
    onSuccess: () => {
      setSaveStatus('saved')
      queryClient.invalidateQueries({ queryKey: ['notebooks'] })
    },
    onError: () => setSaveStatus('unsaved'),
  })

  // Debounced auto-save
  const scheduleSave = useCallback((updatedCells: Cell[], updatedTitle?: string) => {
    setSaveStatus('unsaved')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      setSaveStatus('saving')
      saveMutation.mutate({ cells: updatedCells, title: updatedTitle ?? title })
    }, 1500)
  }, [title, saveMutation])

  // Cell operations
  const updateCell = useCallback((id: string, patch: Partial<Cell>) => {
    setCells(prev => {
      const next = prev.map(c => c.id === id ? { ...c, ...patch } : c)
      if (patch.source !== undefined) scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const insertCellBelow = useCallback((afterId?: string) => {
    const cell = newCell()
    setCells(prev => {
      if (!afterId) return [...prev, cell]
      const idx = prev.findIndex(c => c.id === afterId)
      const next = [...prev]
      next.splice(idx + 1, 0, cell)
      return next
    })
    setActiveCellId(cell.id)
  }, [])

  const deleteCell = useCallback((id: string) => {
    setCells(prev => {
      if (prev.length <= 1) return [newCell()]
      const next = prev.filter(c => c.id !== id)
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const moveCell = useCallback((id: string, dir: 'up' | 'down') => {
    setCells(prev => {
      const idx = prev.findIndex(c => c.id === id)
      if (dir === 'up' && idx === 0) return prev
      if (dir === 'down' && idx === prev.length - 1) return prev
      const next = [...prev]
      const swap = dir === 'up' ? idx - 1 : idx + 1
      ;[next[idx], next[swap]] = [next[swap], next[idx]]
      scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  // Run a single cell
  const runCell = useCallback(async (id: string) => {
    if (pyStatus !== 'ready' || runningCellId) return
    const cell = cells.find(c => c.id === id)
    if (!cell || !cell.source.trim()) return

    setRunningCellId(id)
    const outputs = await pyRunCell(cell.source)
    const count = execCounter + 1
    setExecCounter(count)

    setCells(prev => {
      const next = prev.map(c =>
        c.id === id ? { ...c, outputs, execution_count: count } : c
      )
      scheduleSave(next)
      return next
    })
    setRunningCellId(null)
  }, [pyStatus, runningCellId, cells, execCounter, pyRunCell, scheduleSave])

  // Run all cells sequentially
  const runAll = useCallback(async () => {
    if (pyStatus !== 'ready') return
    let counter = execCounter
    for (const cell of cells) {
      if (!cell.source.trim()) continue
      setRunningCellId(cell.id)
      const outputs = await pyRunCell(cell.source)
      counter++
      const c = counter
      setCells(prev => prev.map(cc =>
        cc.id === cell.id ? { ...cc, outputs, execution_count: c } : cc
      ))
      setRunningCellId(null)
    }
    setExecCounter(counter)
    setCells(prev => { scheduleSave(prev); return prev })
  }, [pyStatus, cells, execCounter, pyRunCell, scheduleSave])

  // Focus input field whenever a Python input() prompt appears
  useEffect(() => {
    if (inputState) {
      setInputValue('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [inputState])

  const handleRestart = () => {
    restartKernel()
    setExecCounter(0)
    setRunningCellId(null)
    setCells(prev => prev.map(c => ({ ...c, outputs: [], execution_count: null })))
  }

  const handleStop = () => {
    // Restart kernel (terminates worker = aborts running cell)
    restartKernel()
    setRunningCellId(null)
  }

  const handleTitleSave = () => {
    setEditingTitle(false)
    scheduleSave(cells, title)
  }

  // Current active cell for tutor context
  const activeCell = cells.find(c => c.id === activeCellId)
  const lastOutput = activeCell?.outputs
    .map(o => o.text || `${o.ename}: ${o.evalue}`)
    .filter(Boolean)
    .join('\n') || ''

  const pyStatusIcon = {
    idle: <Cpu className="h-3 w-3 text-slate-500" />,
    loading: <Loader2 className="h-3 w-3 animate-spin text-amber-400" />,
    ready: <Zap className="h-3 w-3 text-emerald-400" />,
    error: <AlertCircle className="h-3 w-3 text-red-400" />,
  }[pyStatus]

  const pyStatusText = {
    idle: 'Kernel non avviato',
    loading: 'Avvio kernel Python…',
    ready: 'Kernel pronto',
    error: pyError || 'Errore kernel',
  }[pyStatus]

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-[#13151a] text-white overflow-hidden relative">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-[#1a1d23] border-b border-[#2a2d36] flex-shrink-0">
        <button
          onClick={() => onBack ? onBack() : navigate(-1)}
          className="text-slate-400 hover:text-white transition-colors"
          title="Torna alla lista"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>

        {/* Title */}
        {editingTitle ? (
          <input
            ref={titleRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={e => e.key === 'Enter' && handleTitleSave()}
            className="text-sm font-semibold bg-[#21242c] border border-indigo-500/50 rounded px-2 py-0.5 text-white outline-none flex-1 max-w-xs"
            autoFocus
          />
        ) : (
          <button
            onClick={() => setEditingTitle(true)}
            className="text-sm font-semibold text-slate-200 hover:text-white transition-colors truncate max-w-xs"
            title="Modifica titolo"
          >
            {title || 'Notebook senza titolo'}
          </button>
        )}

        <div className="flex-1" />

        {/* Kernel status */}
        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
          {pyStatusIcon}
          <span>{pyStatusText}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => insertCellBelow(activeCellId ?? cells[cells.length - 1]?.id)}
            title="Aggiungi cella"
            className="flex items-center gap-1 text-xs text-slate-300 hover:text-white bg-[#21242c] hover:bg-[#2a2d36] border border-[#2a2d36] px-2 py-1 rounded-lg transition-colors"
          >
            <Plus className="h-3 w-3" />
            Cella
          </button>
          <button
            onClick={runAll}
            disabled={pyStatus !== 'ready' || !!runningCellId}
            title="Esegui tutto"
            className="flex items-center gap-1 text-xs text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 px-2 py-1 rounded-lg transition-colors"
          >
            <Play className="h-3 w-3" />
            Esegui tutto
          </button>
          {runningCellId ? (
            <button
              onClick={handleStop}
              title="Interrompi esecuzione"
              className="flex items-center gap-1 text-xs text-red-300 hover:text-red-100 bg-red-900/40 hover:bg-red-900/60 border border-red-700/40 px-2 py-1 rounded-lg transition-colors"
            >
              <Square className="h-3 w-3 fill-current" />
              Stop
            </button>
          ) : (
            <button
              onClick={handleRestart}
              disabled={pyStatus !== 'ready'}
              title="Riavvia kernel"
              className="flex items-center gap-1 text-xs text-slate-300 hover:text-white bg-[#21242c] hover:bg-[#2a2d36] border border-[#2a2d36] px-2 py-1 rounded-lg transition-colors"
            >
              <RotateCcw className="h-3 w-3" />
              Restart
            </button>
          )}
        </div>

        {/* Save indicator */}
        <div className="flex items-center gap-1 text-[11px]">
          {saveStatus === 'saving' && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
          {saveStatus === 'saved' && <CheckCircle className="h-3 w-3 text-emerald-500" />}
          {saveStatus === 'unsaved' && <Save className="h-3 w-3 text-amber-400" />}
          <span className={saveStatus === 'unsaved' ? 'text-amber-400' : 'text-slate-500'}>
            {saveStatus === 'saving' ? 'Salvataggio…' : saveStatus === 'saved' ? 'Salvato' : 'Modifiche non salvate'}
          </span>
        </div>
      </div>

      {/* Pyodide loading banner */}
      {pyStatus === 'loading' && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 text-amber-300 text-xs flex-shrink-0">
          <Loader2 className="h-3 w-3 animate-spin" />
          Caricamento del motore Python (Pyodide) in corso — la prima volta può richiedere qualche secondo…
        </div>
      )}
      {pyStatus === 'error' && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-300 text-xs flex-shrink-0">
          <AlertCircle className="h-3 w-3" />
          {pyError}
        </div>
      )}

      {/* Cells */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4">
        {cells.map((cell) => (
          <NotebookCell
            key={cell.id}
            cell={cell}
            isRunning={runningCellId === cell.id}
            isActive={activeCellId === cell.id}
            onActivate={() => setActiveCellId(cell.id)}
            onChange={source => updateCell(cell.id, { source })}
            onRun={() => runCell(cell.id)}
            onDelete={() => deleteCell(cell.id)}
            onInsertBelow={() => insertCellBelow(cell.id)}
            onMoveUp={() => moveCell(cell.id, 'up')}
            onMoveDown={() => moveCell(cell.id, 'down')}
          />
        ))}

        {/* input() prompt — shown when Python code calls input() */}
        {inputState && (
          <div className="sticky bottom-4 mx-auto max-w-xl bg-[#1a1d23] border border-indigo-500/60 rounded-xl shadow-2xl shadow-indigo-900/40 p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-indigo-300 text-xs font-medium">
              <Terminal className="h-3.5 w-3.5" />
              Il programma chiede un valore
            </div>
            {inputState.prompt && (
              <p className="font-mono text-sm text-emerald-300 bg-[#13151a] rounded px-3 py-1.5">
                {inputState.prompt}
              </p>
            )}
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { inputState.submit(inputValue); setInputValue('') }
                }}
                placeholder="Scrivi qui la risposta…"
                className="flex-1 bg-[#13151a] border border-[#2a2d36] focus:border-indigo-500 rounded-lg px-3 py-1.5 text-sm text-white font-mono outline-none transition-colors"
              />
              <button
                onClick={() => { inputState.submit(inputValue); setInputValue('') }}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-4 py-1.5 rounded-lg font-medium transition-colors"
              >
                Invia
              </button>
            </div>
          </div>
        )}

        {/* Add cell button at bottom */}
        <button
          onClick={() => insertCellBelow(cells[cells.length - 1]?.id)}
          className="w-full border-2 border-dashed border-[#2a2d36] hover:border-indigo-500/50 rounded-xl py-3 text-slate-600 hover:text-indigo-400 text-xs transition-colors flex items-center justify-center gap-1"
        >
          <Plus className="h-3.5 w-3.5" />
          Aggiungi cella
        </button>
      </div>

      {/* Floating tutor */}
      {notebookId && (
        <NotebookTutorChat
          notebookId={notebookId}
          notebookTitle={title}
          currentCellSource={activeCell?.source}
          lastOutput={lastOutput}
        />
      )}
    </div>
  )
}
