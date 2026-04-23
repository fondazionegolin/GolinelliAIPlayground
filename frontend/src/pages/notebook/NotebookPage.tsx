import { lazy, Suspense, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import {
  AlertCircle, Bot, CheckCircle, ChevronDown, ChevronUp, Cpu, FilePlus, Loader2,
  Monitor, Pause, PanelRight, Play, Plus, RotateCcw, Save, Sparkles, Square, Terminal, Trash2, Wrench, Zap,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { v4 as uuidv4 } from 'uuid'
import { notebooksApi } from '@/lib/api'
import { usePyodide } from '@/hooks/usePyodide'
import { markdownCodeComponents } from '@/components/CodeBlock'
import NotebookCell from '@/components/notebook/NotebookCell'
import {
  PASTEL_ICON_BACKGROUNDS,
  PASTEL_ICON_TEXT,
  PASTEL_SURFACES,
  type PastelTone,
} from '@/design/themes/pastelSurfaces'
import type {
  Cell,
  NotebookCodeProposal,
  NotebookDetail,
  NotebookEditorSettings,
  NotebookFontFamily,
  NotebookProjectType,
  NotebookTheme,
} from '@/components/notebook/types'

const NotebookTutorChat = lazy(() => import('@/components/notebook/NotebookTutorChat'))
const NotebookP5Preview = lazy(() => import('@/components/notebook/NotebookP5Preview'))

interface ConsoleEntry {
  id: string
  level: 'log' | 'warn' | 'error'
  args: string[]
  ts: number
}

function newCell(name?: string): Cell {
  return { id: uuidv4(), type: 'code', source: '', outputs: [], execution_count: null, name }
}

function normalizeCells(projectType: NotebookProjectType, nextCells: Cell[]) {
  if (projectType === 'p5js') {
    const cells = nextCells.length > 0 ? nextCells : [newCell('sketch.js')]
    return cells.map((cell, i) => ({
      ...cell,
      type: 'code' as const,
      name: cell.name ?? (i === 0 ? 'sketch.js' : `file${i}.js`),
    }))
  }
  return nextCells.length > 0 ? nextCells : [newCell()]
}

interface Props {
  notebookIdOverride?: string
}

const previewFallback = (
  <div className={`flex h-full min-h-[260px] items-center justify-center rounded-[24px] shadow-sm ${PASTEL_SURFACES.indigo}`}>
    <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
  </div>
)

export default function NotebookPage({ notebookIdOverride }: Props = {}) {
  const { notebookId: notebookIdParam } = useParams<{ notebookId: string }>()
  const notebookId = notebookIdOverride ?? notebookIdParam
  const queryClient = useQueryClient()

  const [cells, setCells] = useState<Cell[]>([])
  const [projectType, setProjectType] = useState<NotebookProjectType>('python')
  const [editorSettings, setEditorSettings] = useState<NotebookEditorSettings>({
    theme: 'dark',
    font_size: 14,
    font_family: 'jetbrains',
    live_preview: false,
    font_weight: 400,
  })
  const [activeCellId, setActiveCellId] = useState<string | null>(null)
  const [runningCellId, setRunningCellId] = useState<string | null>(null)
  const [execCounter, setExecCounter] = useState(0)
  const [title, setTitle] = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'saved' | 'unsaved' | 'saving'>('saved')
  const [inputValue, setInputValue] = useState('')
  const [previewNonce, setPreviewNonce] = useState(0)
  const [previewRuntimeError, setPreviewRuntimeError] = useState<string | null>(null)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [consoleOpen, setConsoleOpen] = useState(false)
  const [consoleAiLoading, setConsoleAiLoading] = useState(false)
  const [consoleAiResponse, setConsoleAiResponse] = useState<string | null>(null)
  const [assistantSummary, setAssistantSummary] = useState('')
  const [assistantLoading, setAssistantLoading] = useState(false)
  const [assistantProposals, setAssistantProposals] = useState<Record<string, NotebookCodeProposal[]>>({})
  const [p5SplitRatio, setP5SplitRatio] = useState(0.58)
  const [p5Playing, setP5Playing] = useState(true)
  const [chatSidebarOpen, setChatSidebarOpen] = useState(true)
  const [tutorSidebarWidth, setTutorSidebarWidth] = useState(340)
  const [isP5Resizing, setIsP5Resizing] = useState(false)
  const [isTutorResizing, setIsTutorResizing] = useState(false)
  const [renamingCellId, setRenamingCellId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const p5IframeWindowRef = useRef<Window | null>(null)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const renameRef = useRef<HTMLInputElement>(null)
  // True whenever there are local edits not yet confirmed saved — prevents
  // any background refetch from overwriting in-progress work.
  const isDirtyRef = useRef(false)

  const pyodideEnabled = projectType === 'python'
  const { status: pyStatus, error: pyError, runCell: pyRunCell, restartKernel, inputState } = usePyodide(pyodideEnabled)

  const { isLoading, data: notebookData } = useQuery({
    queryKey: ['notebook', notebookId],
    queryFn: async () => {
      const res = await notebooksApi.get(notebookId!)
      return res.data as NotebookDetail
    },
    enabled: !!notebookId,
    // Never auto-refetch while the editor is open — we own the source of truth.
    // Refetch only happens on initial mount (staleTime: 0 is fine for that).
    refetchOnWindowFocus: false,
    refetchOnMount: true,
    staleTime: Infinity,
  })

  useEffect(() => {
    if (!notebookData) return
    // Skip if the user has unsaved edits — server data is older than local state.
    if (isDirtyRef.current) return
    const nextProjectType = notebookData.project_type ?? 'python'
    const nextCells = normalizeCells(nextProjectType, notebookData.cells ?? [])
    const nextEditorSettings: NotebookEditorSettings = {
      theme: notebookData.editor_settings?.theme ?? (nextProjectType === 'p5js' ? 'dracula' : 'dark'),
      font_size: notebookData.editor_settings?.font_size ?? 14,
      font_family: notebookData.editor_settings?.font_family ?? 'jetbrains',
      live_preview: notebookData.editor_settings?.live_preview ?? (nextProjectType === 'p5js'),
      font_weight: notebookData.editor_settings?.font_weight ?? 400,
    }
    setTitle(notebookData.title)
    setProjectType(nextProjectType)
    setEditorSettings(nextEditorSettings)
    setCells(nextCells)
    setActiveCellId((prev) => (prev && nextCells.some((cell) => cell.id === prev) ? prev : nextCells[0]?.id ?? null))
  }, [notebookData])

  useEffect(() => () => {
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }, [])

  const saveMutation = useMutation({
    mutationFn: (data: { title?: string; cells?: Cell[]; editor_settings?: NotebookEditorSettings }) =>
      notebooksApi.update(notebookId!, {
        ...data,
        editor_settings: data.editor_settings as unknown as Record<string, unknown> | undefined,
      }),
    onSuccess: () => {
      isDirtyRef.current = false
      setSaveStatus('saved')
      // Only invalidate the list so the sidebar/list page stays fresh.
      // Do NOT invalidate ['notebook', notebookId] — that would re-fetch and
      // overwrite cells with server data while the user is still editing.
      queryClient.invalidateQueries({ queryKey: ['notebooks'] })
    },
    onError: () => setSaveStatus('unsaved'),
  })

  const scheduleSave = useCallback((updatedCells: Cell[], updatedTitle = title, updatedSettings = editorSettings) => {
    isDirtyRef.current = true
    setSaveStatus('unsaved')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      setSaveStatus('saving')
      saveMutation.mutate({
        cells: normalizeCells(projectType, updatedCells),
        title: updatedTitle,
        editor_settings: updatedSettings,
      })
    }, 2000)
  }, [editorSettings, projectType, saveMutation, title])

  const updateCell = useCallback((id: string, patch: Partial<Cell>) => {
    setCells((prev) => {
      const next = prev.map((cell) => (cell.id === id ? { ...cell, ...patch } : cell))
      if (patch.source !== undefined) scheduleSave(next)
      return next
    })
  }, [scheduleSave])

  const updateEditorSettings = useCallback((patch: Partial<NotebookEditorSettings>) => {
    setEditorSettings((prev) => {
      const next = { ...prev, ...patch }
      scheduleSave(cells, title, next)
      return next
    })
  }, [cells, scheduleSave, title])

  const replaceLineRange = useCallback((source: string, lineStart: number, lineEnd: number, replacement: string) => {
    const lines = source.split('\n')
    const replacementLines = replacement.replace(/\r\n/g, '\n').split('\n')
    lines.splice(Math.max(0, lineStart - 1), Math.max(1, lineEnd - lineStart + 1), ...replacementLines)
    return lines.join('\n')
  }, [])

  const insertCellBelow = useCallback((afterId?: string) => {
    if (projectType === 'p5js') return
    const cell = newCell()
    setCells((prev) => {
      if (!afterId) {
        const next = [...prev, cell]
        scheduleSave(next)
        return next
      }
      const idx = prev.findIndex((c) => c.id === afterId)
      const next = [...prev]
      next.splice(idx + 1, 0, cell)
      scheduleSave(next)
      return next
    })
    setActiveCellId(cell.id)
  }, [projectType, scheduleSave])

  const deleteCell = useCallback((id: string) => {
    if (projectType === 'p5js') return
    setCells((prev) => {
      const next = prev.length <= 1 ? [newCell()] : prev.filter((cell) => cell.id !== id)
      scheduleSave(next)
      return next
    })
  }, [projectType, scheduleSave])

  const moveCell = useCallback((id: string, dir: 'up' | 'down') => {
    if (projectType === 'p5js') return
    setCells((prev) => {
      const idx = prev.findIndex((c) => c.id === id)
      if (idx < 0) return prev
      if (dir === 'up' && idx === 0) return prev
      if (dir === 'down' && idx === prev.length - 1) return prev
      const next = [...prev]
      const swap = dir === 'up' ? idx - 1 : idx + 1
      ;[next[idx], next[swap]] = [next[swap], next[idx]]
      scheduleSave(next)
      return next
    })
  }, [projectType, scheduleSave])

  // p5js file management
  const addP5File = useCallback(() => {
    const idx = cells.length
    const cell = newCell(`file${idx}.js`)
    setCells((prev) => {
      const next = [...prev, cell]
      scheduleSave(next)
      return next
    })
    setActiveCellId(cell.id)
  }, [cells.length, scheduleSave])

  const deleteP5File = useCallback((id: string) => {
    setCells((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.filter((c) => c.id !== id)
      scheduleSave(next)
      return next
    })
    setActiveCellId((prev) => {
      if (prev === id) return cells.find((c) => c.id !== id)?.id ?? null
      return prev
    })
  }, [cells, scheduleSave])

  const commitRename = useCallback(() => {
    if (!renamingCellId || !renameValue.trim()) {
      setRenamingCellId(null)
      return
    }
    const name = renameValue.trim().endsWith('.js') ? renameValue.trim() : `${renameValue.trim()}.js`
    setCells((prev) => {
      const next = prev.map((c) => c.id === renamingCellId ? { ...c, name } : c)
      scheduleSave(next)
      return next
    })
    setRenamingCellId(null)
  }, [renamingCellId, renameValue, scheduleSave])

  const activeCell = cells.find((cell) => cell.id === activeCellId) ?? cells[0]
  const p5Files = cells.map((c) => ({ name: c.name ?? 'sketch.js', source: c.source }))
  const p5SourceKey = p5Files.map((f) => f.source).join('\n')

  const lastOutput = projectType === 'python'
    ? (activeCell?.outputs
      .map((output) => output.text || `${output.ename}: ${output.evalue}`)
      .filter(Boolean)
      .join('\n') || '')
    : (previewRuntimeError || '')

  const runPythonCell = useCallback(async (id: string) => {
    if (pyStatus !== 'ready' || runningCellId) return
    const cell = cells.find((item) => item.id === id)
    if (!cell || !cell.source.trim()) return

    setRunningCellId(id)
    const outputs = await pyRunCell(cell.source)
    const count = execCounter + 1
    setExecCounter(count)

    setCells((prev) => {
      const next = prev.map((item) => (item.id === id ? { ...item, outputs, execution_count: count } : item))
      scheduleSave(next)
      return next
    })
    setRunningCellId(null)
  }, [cells, execCounter, pyRunCell, pyStatus, runningCellId, scheduleSave])

  const handleP5Play = useCallback(() => {
    setP5Playing(true)
    setPreviewRuntimeError(null)
    setConsoleEntries([])
    setPreviewNonce((v) => v + 1)
  }, [])

  const handleP5Stop = useCallback(() => {
    p5IframeWindowRef.current?.postMessage({ source: 'p5-control', action: 'stop' }, '*')
    setP5Playing(false)
  }, [])

  const runAll = useCallback(async () => {
    if (projectType === 'p5js') {
      handleP5Play()
      return
    }
    if (pyStatus !== 'ready') return
    let counter = execCounter
    for (const cell of cells) {
      if (!cell.source.trim()) continue
      setRunningCellId(cell.id)
      const outputs = await pyRunCell(cell.source)
      counter += 1
      const currentCount = counter
      setCells((prev) => prev.map((item) =>
        item.id === cell.id ? { ...item, outputs, execution_count: currentCount } : item,
      ))
      setRunningCellId(null)
    }
    setExecCounter(counter)
    setCells((prev) => {
      scheduleSave(prev)
      return prev
    })
  }, [cells, execCounter, handleP5Play, projectType, pyRunCell, pyStatus, scheduleSave])

  const runCell = useCallback(async (id: string) => {
    if (projectType === 'p5js') {
      setActiveCellId(id)
      handleP5Play()
      return
    }
    await runPythonCell(id)
  }, [handleP5Play, projectType, runPythonCell])

  useEffect(() => {
    if (projectType !== 'p5js' || !editorSettings.live_preview || !p5Playing) return
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => {
      setPreviewRuntimeError(null)
      setConsoleEntries([])
      setPreviewNonce((value) => value + 1)
    }, 220)
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current)
    }
  }, [editorSettings.live_preview, p5Playing, p5SourceKey, projectType])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!event.data || event.data.source !== 'p5-preview') return
      if (event.data.type === 'runtime-error') setPreviewRuntimeError(String(event.data.payload || 'Errore di runtime'))
      if (event.data.type === 'ready') setPreviewRuntimeError(null)
      if (event.data.type === 'console') {
        const { level, args } = event.data.payload as { level: 'log' | 'warn' | 'error'; args: string[] }
        setConsoleEntries((prev) => [...prev, { id: uuidv4(), level, args, ts: Date.now() }])
        setConsoleOpen(true)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    if (inputState) {
      setInputValue('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [inputState])

  useEffect(() => {
    if (renamingCellId) setTimeout(() => renameRef.current?.focus(), 30)
  }, [renamingCellId])

  const handleRestart = () => {
    restartKernel()
    setExecCounter(0)
    setRunningCellId(null)
    setCells((prev) => prev.map((cell) => ({ ...cell, outputs: [], execution_count: null })))
  }

  const handleStop = () => {
    restartKernel()
    setRunningCellId(null)
  }

  const handleTitleSave = () => {
    setEditingTitle(false)
    scheduleSave(cells, title)
  }

  const applyProposal = useCallback((cellId: string, proposalId: string) => {
    const proposal = (assistantProposals[cellId] || []).find((item) => item.id === proposalId)
    if (!proposal) return
    setCells((prev) => {
      const next = prev.map((cell) => {
        if (cell.id !== cellId) return cell
        return {
          ...cell,
          source: replaceLineRange(cell.source, proposal.line_start, proposal.line_end, proposal.replacement),
        }
      })
      scheduleSave(next)
      return next
    })
    setAssistantProposals((prev) => ({
      ...prev,
      [cellId]: (prev[cellId] || []).filter((item) => item.id !== proposalId),
    }))
    setAssistantSummary('Ho preparato una proposta didattica applicata al codice. Se vuoi, chiedimi nel tutor perché questa modifica è utile.')
  }, [assistantProposals, replaceLineRange, scheduleSave])

  const rejectProposal = useCallback((cellId: string, proposalId: string) => {
    setAssistantProposals((prev) => ({
      ...prev,
      [cellId]: (prev[cellId] || []).filter((item) => item.id !== proposalId),
    }))
  }, [])

  const analyzeConsoleError = useCallback(async () => {
    if (!notebookId || !activeCell) return
    const errorLines = [
      previewRuntimeError,
      ...consoleEntries.filter((e) => e.level === 'error').map((e) => e.args.join(' ')),
    ].filter(Boolean).join('\n')
    if (!errorLines) return
    setConsoleAiLoading(true)
    setConsoleAiResponse(null)
    setConsoleOpen(true)
    try {
      const res = await notebooksApi.tutorChat(notebookId, {
        message: `Analizza questo errore nel codice p5.js e spiega la causa in modo didattico.\n\nErrore:\n${errorLines}\n\nCodice:\n${activeCell.source}`,
        current_cell_source: activeCell.source,
        last_output: errorLines,
        pending_proposals: [],
      })
      setConsoleAiResponse(res.data.response)
    } catch {
      setConsoleAiResponse('Non riesco ad analizzare l\'errore in questo momento.')
    } finally {
      setConsoleAiLoading(false)
    }
  }, [activeCell, consoleEntries, notebookId, previewRuntimeError])

  const proposeConsoleFix = useCallback(async () => {
    if (!notebookId || !activeCell) return
    setAssistantLoading(true)
    const errorLines = [
      previewRuntimeError,
      ...consoleEntries.filter((e) => e.level === 'error').map((e) => e.args.join(' ')),
    ].filter(Boolean).join('\n')
    try {
      const res = await notebooksApi.assist(notebookId, {
        current_cell_source: activeCell.source,
        last_output: errorLines,
      })
      setAssistantSummary(res.data.summary || '')
      setAssistantProposals((prev) => ({
        ...prev,
        [activeCell.id]: res.data.proposals || [],
      }))
    } catch {
      setAssistantSummary('Non riesco a proporre modifiche in questo momento.')
    } finally {
      setAssistantLoading(false)
    }
  }, [activeCell, consoleEntries, notebookId, previewRuntimeError])

  const beginHorizontalResize = useCallback((
    startEvent: ReactPointerEvent<HTMLDivElement>,
    onMove: (clientX: number) => void,
    onResizeStart: () => void,
    onResizeEnd: () => void,
  ) => {
    if (startEvent.button !== 0) return
    startEvent.preventDefault()

    const handle = startEvent.currentTarget
    let finished = false

    const handlePointerMove = (event: PointerEvent) => {
      onMove(event.clientX)
    }

    const finish = () => {
      if (finished) return
      finished = true
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      onResizeEnd()
      handle.removeEventListener('pointermove', handlePointerMove)
      handle.removeEventListener('pointerup', finish)
      handle.removeEventListener('pointercancel', finish)
      handle.removeEventListener('lostpointercapture', finish)
      window.removeEventListener('blur', finish)
      if (handle.hasPointerCapture?.(startEvent.pointerId)) {
        handle.releasePointerCapture(startEvent.pointerId)
      }
    }

    onResizeStart()
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    handle.setPointerCapture?.(startEvent.pointerId)
    handle.addEventListener('pointermove', handlePointerMove)
    handle.addEventListener('pointerup', finish)
    handle.addEventListener('pointercancel', finish)
    handle.addEventListener('lostpointercapture', finish)
    window.addEventListener('blur', finish)
  }, [])

  const startP5Resize = useCallback((startEvent: ReactPointerEvent<HTMLDivElement>) => {
    const startX = startEvent.clientX
    const startRatio = p5SplitRatio

    beginHorizontalResize(
      startEvent,
      (clientX) => {
        const delta = (clientX - startX) / window.innerWidth
        setP5SplitRatio(Math.min(0.72, Math.max(0.34, startRatio + delta)))
      },
      () => setIsP5Resizing(true),
      () => setIsP5Resizing(false),
    )
  }, [beginHorizontalResize, p5SplitRatio])

  const startTutorResize = useCallback((startEvent: ReactPointerEvent<HTMLDivElement>) => {
    const startX = startEvent.clientX
    const startWidth = tutorSidebarWidth

    beginHorizontalResize(
      startEvent,
      (clientX) => {
        const delta = startX - clientX
        setTutorSidebarWidth(Math.min(580, Math.max(280, startWidth + delta)))
      },
      () => setIsTutorResizing(true),
      () => setIsTutorResizing(false),
    )
  }, [beginHorizontalResize, tutorSidebarWidth])

  const pyStatusIcon = {
    idle: <Cpu className="h-3 w-3 text-slate-500" />,
    loading: <Loader2 className="h-3 w-3 animate-spin text-amber-400" />,
    ready: <Zap className="h-3 w-3 text-emerald-400" />,
    error: <AlertCircle className="h-3 w-3 text-red-400" />,
  }[pyStatus]

  const pyStatusText = {
    idle: 'Kernel fermo',
    loading: 'Avvio kernel Python…',
    ready: 'Kernel pronto',
    error: pyError || 'Errore kernel',
  }[pyStatus]

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
      </div>
    )
  }

  const fontWeight = editorSettings.font_weight ?? 400
  const projectTone: PastelTone = projectType === 'python' ? 'indigo' : 'emerald'

  return (
    <div className="flex h-full min-h-0 gap-3 bg-slate-100 p-4">
      {/* ── Main notebook card ───────────────────────────────────────────── */}
      <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-[28px] text-slate-900 shadow-[0_18px_60px_rgba(15,23,42,0.12)] ${PASTEL_SURFACES[projectTone]}`}>
        {/* Row 1: Title bar */}
        <div className="flex items-center gap-3 border-b border-slate-200/70 bg-white/60 px-4 py-3 backdrop-blur-sm">
          {editingTitle ? (
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => e.key === 'Enter' && handleTitleSave()}
              className="max-w-sm flex-1 rounded-xl border border-slate-300/80 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-900 outline-none"
              autoFocus
            />
          ) : (
            <button
              onClick={() => setEditingTitle(true)}
              className="max-w-sm truncate text-sm font-semibold text-slate-900 transition-colors hover:text-slate-700"
              title="Modifica titolo"
            >
              {title || 'Notebook senza titolo'}
            </button>
          )}

          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] ${
            `${PASTEL_ICON_BACKGROUNDS[projectTone]} ${PASTEL_ICON_TEXT[projectTone]}`
          }`}>
            {projectType}
          </span>

          <div className="flex-1" />

          {projectType === 'python' ? (
            <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
              {pyStatusIcon}
              <span>{pyStatusText}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-700">
              <Monitor className="h-3.5 w-3.5" />
              <span>Preview interattiva</span>
            </div>
          )}

          <div className="flex items-center gap-1 text-[11px]">
            {saveStatus === 'saving' && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
            {saveStatus === 'saved' && <CheckCircle className="h-3 w-3 text-emerald-500" />}
            {saveStatus === 'unsaved' && <Save className="h-3 w-3 text-amber-400" />}
            <span className={saveStatus === 'unsaved' ? 'text-amber-500' : 'text-slate-500'}>
              {saveStatus === 'saving' ? 'Salvataggio…' : saveStatus === 'saved' ? 'Salvato' : 'Da salvare'}
            </span>
          </div>

          {notebookId && (
            <button
              onClick={() => setChatSidebarOpen((v) => !v)}
              title={chatSidebarOpen ? 'Chiudi sidebar tutor' : 'Apri tutor come sidebar'}
              className={`rounded-xl p-1.5 transition-colors ${
                chatSidebarOpen
                  ? `${PASTEL_ICON_BACKGROUNDS[projectTone]} ${PASTEL_ICON_TEXT[projectTone]}`
                  : 'text-slate-400 hover:bg-white/70 hover:text-slate-700'
              }`}
            >
              <PanelRight className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Row 2: Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200/80 bg-white/45 px-4 py-2 backdrop-blur-sm">
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Tema
            <select
              value={editorSettings.theme}
              onChange={(e) => updateEditorSettings({ theme: e.target.value as NotebookTheme })}
              className="rounded-lg border border-slate-300/80 bg-white/80 px-2 py-1.5 text-slate-700 outline-none"
            >
              <option value="dark">Scuro</option>
              <option value="light">Chiaro</option>
              <option value="fancy">Fancy</option>
              <option value="dracula">Dracula</option>
              <option value="p5js">P5.js</option>
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Dimensione
            <select
              value={editorSettings.font_size}
              onChange={(e) => updateEditorSettings({ font_size: Number(e.target.value) })}
              className="rounded-lg border border-slate-300/80 bg-white/80 px-2 py-1.5 text-slate-700 outline-none"
            >
              {[12, 14, 16, 18, 20].map((size) => (
                <option key={size} value={size}>{size}px</option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            Font
            <select
              value={editorSettings.font_family}
              onChange={(e) => updateEditorSettings({ font_family: e.target.value as NotebookFontFamily })}
              className="rounded-lg border border-slate-300/80 bg-white/80 px-2 py-1.5 text-slate-700 outline-none"
            >
              <option value="jetbrains">JetBrains Mono</option>
              <option value="space">Space Mono</option>
              <option value="courier">Courier Prime</option>
              <option value="victor">Victor Mono</option>
              <option value="plex">IBM Plex Mono</option>
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-xs text-slate-500" title={`Peso font: ${fontWeight}`}>
            Peso
            <input
              type="range"
              min={100}
              max={900}
              step={100}
              value={fontWeight}
              onChange={(e) => updateEditorSettings({ font_weight: Number(e.target.value) })}
              className="w-20 accent-indigo-600"
            />
            <span className="w-7 text-right text-slate-400">{fontWeight}</span>
          </label>

          {projectType === 'p5js' && (
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={editorSettings.live_preview}
                onChange={(e) => updateEditorSettings({ live_preview: e.target.checked })}
                className="rounded border-slate-300 bg-white"
              />
              Live preview
            </label>
          )}

          <div className="flex-1" />

          <div className="flex items-center gap-1">
            {projectType === 'python' && (
              <button
                onClick={() => insertCellBelow(activeCellId ?? cells[cells.length - 1]?.id)}
                title="Aggiungi cella"
                className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs shadow-sm transition-colors ${PASTEL_SURFACES.slate}`}
              >
                <Plus className="h-3 w-3" />
                Cella
              </button>
            )}
            {projectType === 'p5js' ? (
              <>
                <button
                  onClick={handleP5Play}
                  title="Esegui sketch"
                  className="flex items-center gap-1 rounded-xl bg-[#2196F3] px-3 py-1.5 text-xs text-white transition-colors hover:bg-[#1d84d8]"
                >
                  <Play className="h-3 w-3" />
                  Play
                </button>
                <button
                  onClick={handleP5Stop}
                  disabled={!p5Playing}
                  title="Ferma sketch"
                  className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs shadow-sm transition-colors disabled:opacity-40 ${PASTEL_SURFACES.rose} ${PASTEL_ICON_TEXT.rose}`}
                >
                  <Pause className="h-3 w-3" />
                  Stop
                </button>
              </>
            ) : (
              <button
                onClick={runAll}
                disabled={pyStatus !== 'ready' || !!runningCellId}
                className="flex items-center gap-1 rounded-xl bg-[#E91E63] px-3 py-1.5 text-xs text-white transition-colors hover:bg-[#d61b5b] disabled:opacity-40"
              >
                <Play className="h-3 w-3" />
                Esegui tutto
              </button>
            )}
            {projectType === 'python' && (
              runningCellId ? (
                <button
                  onClick={handleStop}
                  className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs shadow-sm transition-colors ${PASTEL_SURFACES.rose} ${PASTEL_ICON_TEXT.rose}`}
                >
                  <Square className="h-3 w-3 fill-current" />
                  Stop
                </button>
              ) : (
                <button
                  onClick={handleRestart}
                  disabled={pyStatus !== 'ready'}
                  className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs shadow-sm transition-colors disabled:opacity-40 ${PASTEL_SURFACES.slate}`}
                >
                  <RotateCcw className="h-3 w-3" />
                  Restart
                </button>
              )
            )}
          </div>
        </div>

        {projectType === 'python' && pyStatus === 'loading' && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
            Caricamento del motore Python (Pyodide) in corso: la prima volta può richiedere qualche secondo.
          </div>
        )}
        {projectType === 'python' && pyStatus === 'error' && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
            {pyError}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          {assistantSummary && (
            <div className="px-4 pt-4">
              <div className="rounded-[24px] border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-slate-700">
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
                  <Sparkles className="h-3.5 w-3.5" />
                  Supporto Didattico
                </div>
                <p>{assistantSummary}</p>
              </div>
            </div>
          )}

          {projectType === 'p5js' ? (
            <div className="flex min-h-0 flex-1 flex-col p-4 gap-2">
              <div className={`flex min-h-0 flex-1 overflow-hidden rounded-[28px] shadow-sm ${PASTEL_SURFACES.slate}`}>
                {/* Left panel: file tabs + editor */}
                <div
                  className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-slate-950"
                  style={{ flexBasis: `${p5SplitRatio * 100}%` }}
                >
                  {/* File tabs */}
                  <div className="flex flex-shrink-0 items-center gap-1 overflow-x-auto border-b border-slate-800 bg-slate-900 px-2 py-1">
                    {cells.map((cell) => (
                      <div key={cell.id} className="flex flex-shrink-0 items-center">
                        {renamingCellId === cell.id ? (
                          <input
                            ref={renameRef}
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename()
                              if (e.key === 'Escape') setRenamingCellId(null)
                            }}
                            className="w-28 rounded bg-slate-700 px-2 py-0.5 font-mono text-xs text-slate-100 outline-none focus:ring-1 focus:ring-indigo-400"
                          />
                        ) : (
                          <button
                            onClick={() => setActiveCellId(cell.id)}
                            onDoubleClick={() => {
                              setRenamingCellId(cell.id)
                              setRenameValue(cell.name ?? 'sketch.js')
                            }}
                            className={`rounded-t px-3 py-1 font-mono text-xs transition-colors ${
                              cell.id === (activeCellId ?? cells[0]?.id)
                                ? 'bg-slate-950 text-teal-300'
                                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                            }`}
                            title="Click per aprire · Doppio click per rinominare"
                          >
                            {cell.name ?? 'sketch.js'}
                          </button>
                        )}
                        {cells.length > 1 && cell.id === (activeCellId ?? cells[0]?.id) && (
                          <button
                            onClick={() => deleteP5File(cell.id)}
                            className="ml-0.5 rounded p-0.5 text-slate-500 transition-colors hover:text-red-400"
                            title="Elimina file"
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={addP5File}
                      className="ml-1 rounded p-1 text-slate-500 transition-colors hover:text-teal-300"
                      title="Nuovo file"
                    >
                      <FilePlus className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Editor */}
                  {activeCell && (
                    <NotebookCell
                      cell={activeCell}
                      projectType={projectType}
                      theme={editorSettings.theme}
                      fontSize={editorSettings.font_size}
                      fontFamily={editorSettings.font_family}
                      fontWeight={fontWeight}
                      isRunning={false}
                      isActive
                      isCompact
                      showOutputs={false}
                      proposals={assistantProposals[activeCell.id] || []}
                      onActivate={() => setActiveCellId(activeCell.id)}
                      onChange={(source) => updateCell(activeCell.id, { source })}
                      onRun={() => runCell(activeCell.id)}
                      onApplyProposal={(proposalId) => applyProposal(activeCell.id, proposalId)}
                      onRejectProposal={(proposalId) => rejectProposal(activeCell.id, proposalId)}
                    />
                  )}
                </div>

                {/* Resize handle */}
                <div
                  onPointerDown={startP5Resize}
                  className={`group relative w-2 flex-shrink-0 cursor-col-resize touch-none ${isP5Resizing ? 'bg-indigo-200' : 'bg-slate-200 hover:bg-indigo-200'}`}
                  title="Ridimensiona editor e preview"
                >
                  <div className={`absolute inset-0 m-auto h-14 w-1 rounded-full transition ${isP5Resizing ? 'bg-indigo-500' : 'bg-slate-400 group-hover:bg-indigo-500'}`} />
                </div>

                {/* Right panel: preview */}
                <div className={`relative min-h-0 min-w-0 flex-1 p-4 ${isP5Resizing ? 'pointer-events-none' : ''}`}>
                  <Suspense fallback={previewFallback}>
                    <NotebookP5Preview
                      files={p5Files}
                      livePreview={editorSettings.live_preview}
                      previewNonce={previewNonce}
                      runtimeError={previewRuntimeError}
                      onRuntimeMessage={setPreviewRuntimeError}
                      onIframeLoad={(win) => { p5IframeWindowRef.current = win }}
                    />
                  </Suspense>
                </div>
              </div>

              {/* Console panel */}
              {(() => {
                const hasErrors = !!previewRuntimeError || consoleEntries.some((e) => e.level === 'error')
                return (
                  <div className="flex-shrink-0 overflow-hidden rounded-[20px] border border-slate-200 bg-slate-950">
                    {/* Header row */}
                    <div className="flex items-center gap-2 px-4 py-2">
                      <button
                        onClick={() => setConsoleOpen((v) => !v)}
                        className="flex flex-1 items-center gap-2 text-left"
                      >
                        <Terminal className="h-3.5 w-3.5 text-slate-400" />
                        <span className="text-xs font-semibold text-slate-400">Console</span>
                        {consoleEntries.length > 0 && (
                          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold text-white ${hasErrors ? 'bg-[#BA68C8]' : 'bg-[#E91E63]'}`}>
                            {consoleEntries.length}
                          </span>
                        )}
                        {previewRuntimeError && (
                          <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                            runtime error
                          </span>
                        )}
                        <div className="flex-1" />
                        {consoleOpen
                          ? <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
                          : <ChevronUp className="h-3.5 w-3.5 text-slate-500" />
                        }
                      </button>
                      {hasErrors && (
                        <button
                          onClick={(e) => { e.stopPropagation(); analyzeConsoleError() }}
                          disabled={consoleAiLoading}
                          title="Chiedi all'AI perché c'è l'errore"
                          className="flex items-center gap-1 rounded-lg bg-[#E91E63] px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-[#d61b5b] disabled:opacity-50"
                        >
                          {consoleAiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
                          Analizza
                        </button>
                      )}
                      {hasErrors && (
                        <button
                          onClick={(e) => { e.stopPropagation(); proposeConsoleFix() }}
                          disabled={assistantLoading}
                          title="Genera proposta di correzione del codice"
                          className="flex items-center gap-1 rounded-lg border border-emerald-700 bg-emerald-900/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-800/50 disabled:opacity-50"
                        >
                          {assistantLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                          Correggi
                        </button>
                      )}
                      {consoleEntries.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConsoleEntries([]); setConsoleAiResponse(null) }}
                          className="text-[10px] text-slate-500 hover:text-slate-300"
                        >
                          Pulisci
                        </button>
                      )}
                    </div>

                    {consoleOpen && (
                      <div className="border-t border-slate-800">
                        {/* Log entries */}
                        <div className="max-h-36 overflow-y-auto px-4 py-2 font-mono text-xs">
                          {previewRuntimeError && (
                            <div className="flex gap-2 py-0.5 text-red-400">
                              <span className="shrink-0 text-slate-600">runtime</span>
                              <span className="break-all">{previewRuntimeError}</span>
                            </div>
                          )}
                          {consoleEntries.length === 0 && !previewRuntimeError ? (
                            <p className="text-slate-600">Nessun output console.</p>
                          ) : (
                            consoleEntries.map((entry) => (
                              <div
                                key={entry.id}
                                className={`flex gap-2 py-0.5 ${
                                  entry.level === 'warn' ? 'text-amber-400' :
                                  entry.level === 'error' ? 'text-red-400' :
                                  'text-slate-300'
                                }`}
                              >
                                <span className="shrink-0 text-slate-600">{new Date(entry.ts).toLocaleTimeString()}</span>
                                <span className="break-all">{entry.args.join(' ')}</span>
                              </div>
                            ))
                          )}
                        </div>

                        {/* AI analysis response */}
                        {(consoleAiLoading || consoleAiResponse) && (
                          <div className="border-t border-slate-800 px-4 py-3">
                            <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-indigo-400">
                              <Bot className="h-3 w-3" />
                              Analisi AI
                            </div>
                            {consoleAiLoading ? (
                              <div className="flex items-center gap-2 text-xs text-slate-400">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Analizzo l'errore…
                              </div>
                            ) : (
                              <div className="prose prose-invert prose-sm max-w-none prose-p:my-1 prose-code:text-indigo-300 text-slate-300">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownCodeComponents(false)}>
                                  {consoleAiResponse!}
                                </ReactMarkdown>
                              </div>
                            )}
                            {consoleAiResponse && (
                              <button
                                onClick={() => { proposeConsoleFix(); setConsoleAiResponse(null) }}
                                disabled={assistantLoading}
                                className="mt-3 flex items-center gap-1.5 rounded-lg border border-emerald-700 bg-emerald-900/40 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-800/50 disabled:opacity-50"
                              >
                                {assistantLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                                Genera proposta di correzione
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })()}
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="space-y-4">
                {cells.map((cell) => (
                  <NotebookCell
                    key={cell.id}
                    cell={cell}
                    projectType={projectType}
                    theme={editorSettings.theme}
                    fontSize={editorSettings.font_size}
                    fontFamily={editorSettings.font_family}
                    fontWeight={fontWeight}
                    isRunning={runningCellId === cell.id}
                    isActive={activeCellId === cell.id}
                    proposals={assistantProposals[cell.id] || []}
                    onActivate={() => setActiveCellId(cell.id)}
                    onChange={(source) => updateCell(cell.id, { source })}
                    onRun={() => runCell(cell.id)}
                    onApplyProposal={(proposalId) => applyProposal(cell.id, proposalId)}
                    onRejectProposal={(proposalId) => rejectProposal(cell.id, proposalId)}
                    onDelete={() => deleteCell(cell.id)}
                    onInsertBelow={() => insertCellBelow(cell.id)}
                    onMoveUp={() => moveCell(cell.id, 'up')}
                    onMoveDown={() => moveCell(cell.id, 'down')}
                  />
                ))}

                {inputState && (
                    <div className={`sticky bottom-4 mx-auto flex max-w-xl flex-col gap-3 rounded-[24px] bg-white/90 p-4 shadow-lg backdrop-blur-sm ${PASTEL_SURFACES[projectTone]}`}>
                    <div className="flex items-center gap-2 text-xs font-medium text-indigo-500">
                      <Terminal className="h-3.5 w-3.5" />
                      Il programma chiede un valore
                    </div>
                    {inputState.prompt && (
                      <p className="rounded bg-slate-900 px-3 py-1.5 font-mono text-sm text-emerald-300">
                        {inputState.prompt}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            inputState.submit(inputValue)
                            setInputValue('')
                          }
                        }}
                        placeholder="Scrivi qui la risposta…"
                        className="flex-1 rounded-lg border border-slate-300/80 bg-white/85 px-3 py-1.5 font-mono text-sm text-slate-900 outline-none transition-colors focus:border-indigo-500"
                      />
                      <button
                        onClick={() => {
                          inputState.submit(inputValue)
                          setInputValue('')
                        }}
                        className="rounded-lg bg-[#E91E63] px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#d61b5b]"
                      >
                        Invia
                      </button>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => insertCellBelow(cells[cells.length - 1]?.id)}
                  className="flex w-full items-center justify-center gap-1 rounded-[24px] border-2 border-dashed border-slate-300 py-4 text-xs text-slate-500 transition-colors hover:border-indigo-400 hover:text-indigo-500"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Aggiungi cella
                </button>
              </div>
            </div>
          )}
        </div>

      </div>

      {/* ── Right sidebar panel ──────────────────────────────────────────── */}
      {chatSidebarOpen && notebookId && (
        <div className="hidden lg:flex shrink-0 min-h-0" style={{ width: tutorSidebarWidth }}>
          {/* Resize handle — left edge of sidebar */}
          <div
            onPointerDown={startTutorResize}
            className={`group relative w-2 flex-shrink-0 cursor-col-resize touch-none ${
              projectType === 'python'
                ? (isTutorResizing ? 'bg-[#f4b6cf]' : 'bg-[#f8d6e5] hover:bg-[#f4b6cf]')
                : (isTutorResizing ? 'bg-[#b5dbfb]' : 'bg-[#d9ecfd] hover:bg-[#b5dbfb]')
            }`}
            title="Ridimensiona sidebar tutor"
          >
            <div className={`absolute inset-0 m-auto h-14 w-1 rounded-full transition ${
              projectType === 'python'
                ? (isTutorResizing ? 'bg-[#d61b5b]' : 'bg-[#E91E63] group-hover:bg-[#d61b5b]')
                : (isTutorResizing ? 'bg-[#1d84d8]' : 'bg-[#2196F3] group-hover:bg-[#1d84d8]')
            }`} />
          </div>
          <div className={`flex flex-1 flex-col gap-3 min-h-0 min-w-0 overflow-hidden rounded-[28px] shadow-sm ${PASTEL_SURFACES[projectTone]}`}>
            <Suspense fallback={null}>
              <NotebookTutorChat
                notebookId={notebookId}
                notebookTitle={title}
                projectType={projectType}
                currentCellSource={activeCell?.source}
                lastOutput={lastOutput}
                pendingProposals={activeCell ? (assistantProposals[activeCell.id] || []) : []}
                initialMessages={notebookData?.tutor_messages || []}
                variant="sidebar"
              />
            </Suspense>
          </div>
        </div>
      )}

    </div>
  )
}
