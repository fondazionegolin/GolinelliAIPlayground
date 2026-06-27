import { lazy, Suspense, useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router-dom'
import {
  AlertCircle, BookOpen, Bot, CheckCircle, ChevronDown, ChevronUp, Cpu, FilePlus, Gamepad2, Loader2,
  Monitor, Music2, PackagePlus, Pause, PanelRight, Play, Plus, RotateCcw, Save, Sparkles, Square, Terminal, Trash2, Wrench, Zap,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { v4 as uuidv4 } from 'uuid'
import { notebooksApi } from '@/lib/api'
import { usePyodide } from '@/hooks/usePyodide'
import { markdownCodeComponents } from '@/components/CodeBlock'
import NotebookCell from '@/components/notebook/NotebookCell'
import NotebookMicrobitAgentChat from '@/components/notebook/NotebookMicrobitAgentChat'
import NotebookMicrobitSerialPanel from '@/components/notebook/NotebookMicrobitSerialPanel'
import CircuitPlaygroundPanel from '@/components/notebook/CircuitPlaygroundPanel'
import { useTranslation } from 'react-i18next'
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
const NotebookStrudelPreview = lazy(() => import('@/components/notebook/NotebookStrudelPreview'))
const NotebookGame2DPreview = lazy(() => import('@/components/notebook/NotebookGame2DPreview'))
import NotebookLibraryManager from '@/components/notebook/NotebookLibraryManager'
import type { StrudelPreviewHandle } from '@/components/notebook/NotebookStrudelPreview'

interface ConsoleEntry {
  id: string
  level: 'log' | 'warn' | 'error'
  args: string[]
  ts: number
}

function newCell(name?: string): Cell {
  return { id: uuidv4(), type: 'code', source: '', outputs: [], execution_count: null, name }
}

function isDeviceNotebook(projectType: NotebookProjectType) {
  return projectType === 'microbit' || projectType === 'circuitplayground'
}

function normalizeCells(projectType: NotebookProjectType, nextCells: Cell[]) {
  if (isDeviceNotebook(projectType)) {
    const cells = nextCells.length > 0 ? nextCells : [newCell('main.py')]
    return cells.slice(0, 1).map((cell) => ({
      ...cell,
      type: 'code' as const,
      name: cell.name ?? 'main.py',
    }))
  }
  if (projectType === 'game2d') {
    const cells = nextCells.length > 0 ? nextCells : [newCell('game.json')]
    return cells.slice(0, 1).map((cell) => ({
      ...cell,
      type: 'code' as const,
      name: cell.name ?? 'game.json',
    }))
  }
  if (projectType === 'p5js') {
    const cells = nextCells.length > 0 ? nextCells : [newCell('sketch.js')]
    return cells.map((cell, i) => ({
      ...cell,
      type: 'code' as const,
      name: cell.name ?? (i === 0 ? 'sketch.js' : `file${i}.js`),
    }))
  }
  if (projectType === 'strudel') {
    const cells = nextCells.length > 0 ? nextCells : [newCell()]
    return cells.slice(0, 1).map((cell) => ({ ...cell, type: 'code' as const }))
  }
  return nextCells.length > 0 ? nextCells : [newCell()]
}

interface Props {
  notebookIdOverride?: string
}

const STRUDEL_TEMPLATES = [
  {
    id: 'melodia',
    label: 'Melodia semplice',
    description: 'Melodia in do maggiore con onde triangolari',
    code: `note("c4 e4 g4 b4 a4 g4 e4 d4")
  .sound("triangle")
  .slow(2)
  .gain(0.7)`,
  },
  {
    id: 'arpeggio',
    label: 'Arpeggio ascendente',
    description: 'Note arpeggiate che salgono e scendono',
    code: `note("c4 e4 g4 c5 b4 g4 e4 c4")
  .sound("sine")
  .fast(1.5)
  .gain(0.6)`,
  },
  {
    id: 'accordi',
    label: 'Accordi lenti',
    description: 'Progressione armonica con accordi sovrapposti',
    code: `note("<[c3,e3,g3] [f3,a3,c4] [g3,b3,d4] [c3,e3,g3]>")
  .sound("triangle")
  .slow(4)
  .gain(0.5)`,
  },
  {
    id: 'basso-melodia',
    label: 'Basso + melodia',
    description: 'Due strati sovrapposti: linea di basso e melodia',
    code: `stack(
  note("c2 ~ f2 ~ g2 ~ f2 ~")
    .sound("sawtooth")
    .gain(0.4),
  note("c4 e4 g4 a4 g4 e4 d4 c4")
    .sound("triangle")
    .gain(0.6)
).slow(2)`,
  },
  {
    id: 'canone',
    label: 'Canone a due voci',
    description: 'Due voci che si inseguono a distanza di mezza battuta',
    code: `stack(
  note("c4 d4 e4 f4 g4 a4 b4 c5")
    .sound("sine")
    .slow(3),
  note("c4 d4 e4 f4 g4 a4 b4 c5")
    .sound("sine")
    .slow(3)
    .early(0.5)
    .gain(0.6)
)`,
  },
  {
    id: 'ritmo',
    label: 'Ritmo percussivo',
    description: 'Pattern ritmico con cassa, rullante e hi-hat',
    code: `s("bd ~ sd ~ bd bd sd ~, hh hh hh hh hh hh hh hh")
  .gain(0.8)`,
  },
]

const previewFallback = (
  <div className={`flex h-full min-h-[260px] items-center justify-center rounded-xl shadow-sm ${PASTEL_SURFACES.indigo}`}>
    <Loader2 className="h-6 w-6 animate-spin text-indigo-400" />
  </div>
)

export default function NotebookPage({ notebookIdOverride }: Props = {}) {
  const { i18n } = useTranslation()
  const isEnglish = i18n.resolvedLanguage?.startsWith('en') ?? false
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
  const [gameSplitRatio, setGameSplitRatio] = useState(0.48)
  const [gamePlaying, setGamePlaying] = useState(true)
  const [strudelSplitRatio, setStrudelSplitRatio] = useState(0.58)
  const [strudelPlaying, setStrudelPlaying] = useState(false)
  const [strudelError, setStrudelError] = useState<string | null>(null)
  const [isStrudelResizing, setIsStrudelResizing] = useState(false)
  const [strudelTemplatesOpen, setStrudelTemplatesOpen] = useState(false)
  const [chatSidebarOpen, setChatSidebarOpen] = useState(true)
  const [tutorSidebarWidth, setTutorSidebarWidth] = useState(340)
  const [isP5Resizing, setIsP5Resizing] = useState(false)
  const [isGameResizing, setIsGameResizing] = useState(false)
  const [isTutorResizing, setIsTutorResizing] = useState(false)
  const [renamingCellId, setRenamingCellId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [libraryManagerOpen, setLibraryManagerOpen] = useState(false)
  const p5IframeWindowRef = useRef<Window | null>(null)
  const gameIframeWindowRef = useRef<Window | null>(null)
  const strudelRef = useRef<StrudelPreviewHandle>(null)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const strudelAutoEvalTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const strudelPreviewTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
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
      libraries: notebookData.editor_settings?.libraries ?? [],
      microbit_language: notebookData.editor_settings?.microbit_language ?? 'python',
      device_language: notebookData.editor_settings?.device_language ?? notebookData.editor_settings?.microbit_language ?? 'python',
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
    if (projectType === 'p5js' || projectType === 'strudel' || isDeviceNotebook(projectType)) return
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
    if (projectType === 'p5js' || projectType === 'strudel' || isDeviceNotebook(projectType)) return
    setCells((prev) => {
      const next = prev.length <= 1 ? [newCell()] : prev.filter((cell) => cell.id !== id)
      scheduleSave(next)
      return next
    })
  }, [projectType, scheduleSave])

  const moveCell = useCallback((id: string, dir: 'up' | 'down') => {
    if (projectType === 'p5js' || projectType === 'strudel' || isDeviceNotebook(projectType)) return
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
  const gameSource = activeCell?.source ?? ''

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

  const handleGamePlay = useCallback(() => {
    setGamePlaying(true)
    setPreviewRuntimeError(null)
    setPreviewNonce((value) => value + 1)
  }, [])

  const handleGameStop = useCallback(() => {
    gameIframeWindowRef.current?.postMessage({ source: 'game2d-control', action: 'stop' }, '*')
    setGamePlaying(false)
  }, [])

  const handleStrudelPlay = useCallback(() => {
    if (!activeCell?.source.trim()) return
    setStrudelError(null)
    strudelRef.current?.evaluate(activeCell.source)
  }, [activeCell])

  const handleStrudelStop = useCallback(() => {
    strudelRef.current?.stop()
    setStrudelPlaying(false)
  }, [])

  const runAll = useCallback(async () => {
    if (projectType === 'p5js') {
      handleP5Play()
      return
    }
    if (projectType === 'strudel') {
      handleStrudelPlay()
      return
    }
    if (projectType === 'game2d') {
      handleGamePlay()
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
  }, [cells, execCounter, handleGamePlay, handleP5Play, projectType, pyRunCell, pyStatus, scheduleSave])

  const runCell = useCallback(async (id: string) => {
    if (projectType === 'p5js') {
      setActiveCellId(id)
      handleP5Play()
      return
    }
    if (projectType === 'game2d') {
      setActiveCellId(id)
      handleGamePlay()
      return
    }
    if (projectType === 'strudel') {
      setActiveCellId(id)
      handleStrudelPlay()
      return
    }
    await runPythonCell(id)
  }, [handleGamePlay, handleP5Play, handleStrudelPlay, projectType, runPythonCell])

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
    if (projectType !== 'game2d' || !editorSettings.live_preview || !gamePlaying) return
    if (previewTimer.current) clearTimeout(previewTimer.current)
    previewTimer.current = setTimeout(() => {
      setPreviewRuntimeError(null)
      setPreviewNonce((value) => value + 1)
    }, 320)
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current)
    }
  }, [editorSettings.live_preview, gamePlaying, gameSource, projectType])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!event.data) return
      if (event.data.source === 'p5-preview') {
        if (event.data.type === 'runtime-error') setPreviewRuntimeError(String(event.data.payload || (isEnglish ? 'Runtime error' : 'Errore di runtime')))
        if (event.data.type === 'ready') setPreviewRuntimeError(null)
        if (event.data.type === 'console') {
          const { level, args } = event.data.payload as { level: 'log' | 'warn' | 'error'; args: string[] }
          setConsoleEntries((prev) => [...prev, { id: uuidv4(), level, args, ts: Date.now() }])
          setConsoleOpen(true)
        }
      }
      if (event.data.source === 'strudel-preview') {
        if (event.data.type === 'error') setStrudelError(event.data.payload?.message || 'Errore')
        if (event.data.type === 'status') {
          setStrudelPlaying(event.data.payload?.playing || false)
          if (event.data.payload?.playing) setStrudelError(null)
        }
      }
      if (event.data.source === 'game2d-preview') {
        if (event.data.type === 'runtime-error') setPreviewRuntimeError(String(event.data.payload || (isEnglish ? 'Runtime error' : 'Errore di runtime')))
        if (event.data.type === 'ready') setPreviewRuntimeError(null)
        if (event.data.type === 'status' && typeof event.data.payload?.playing === 'boolean') {
          setGamePlaying(event.data.payload.playing)
        }
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Auto-eval strudel: when source changes while playing, queue eval at next bar boundary
  useEffect(() => {
    if (!strudelPlaying || !activeCell?.source.trim()) return
    if (strudelAutoEvalTimer.current) clearTimeout(strudelAutoEvalTimer.current)
    strudelAutoEvalTimer.current = setTimeout(() => {
      strudelRef.current?.evaluate(activeCell.source)
    }, 600)
    return () => {
      if (strudelAutoEvalTimer.current) clearTimeout(strudelAutoEvalTimer.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCell?.source])

  // Fast visual preview: update PROSSIMA bar within 150ms of typing while playing
  useEffect(() => {
    if (!strudelPlaying || !activeCell?.source.trim()) return
    if (strudelPreviewTimer.current) clearTimeout(strudelPreviewTimer.current)
    strudelPreviewTimer.current = setTimeout(() => {
      strudelRef.current?.preview(activeCell.source)
    }, 150)
    return () => {
      if (strudelPreviewTimer.current) clearTimeout(strudelPreviewTimer.current)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCell?.source])

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
        message: projectType === 'game2d'
          ? (isEnglish
              ? `Analyze this error in the Game 2D JSON schema or Phaser runner and explain the cause in a didactic way.\n\nError:\n${errorLines}\n\nJSON:\n${activeCell.source}`
              : `Analizza questo errore nello schema JSON Game 2D o nel runner Phaser e spiega la causa in modo didattico.\n\nErrore:\n${errorLines}\n\nJSON:\n${activeCell.source}`)
          : (isEnglish
              ? `Analyze this error in the p5.js code and explain the cause in a didactic way.\n\nError:\n${errorLines}\n\nCode:\n${activeCell.source}`
              : `Analizza questo errore nel codice p5.js e spiega la causa in modo didattico.\n\nErrore:\n${errorLines}\n\nCodice:\n${activeCell.source}`),
        current_cell_source: activeCell.source,
        last_output: errorLines,
        pending_proposals: [],
      })
      setConsoleAiResponse(res.data.response)
    } catch {
      setConsoleAiResponse(isEnglish ? 'I cannot analyze the error right now.' : 'Non riesco ad analizzare l\'errore in questo momento.')
    } finally {
      setConsoleAiLoading(false)
    }
  }, [activeCell, consoleEntries, isEnglish, notebookId, previewRuntimeError, projectType])

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

  const startStrudelResize = useCallback((startEvent: ReactPointerEvent<HTMLDivElement>) => {
    const startX = startEvent.clientX
    const startRatio = strudelSplitRatio

    beginHorizontalResize(
      startEvent,
      (clientX) => {
        const delta = (clientX - startX) / window.innerWidth
        setStrudelSplitRatio(Math.min(0.72, Math.max(0.34, startRatio + delta)))
      },
      () => setIsStrudelResizing(true),
      () => setIsStrudelResizing(false),
    )
  }, [beginHorizontalResize, strudelSplitRatio])

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

  const startGameResize = useCallback((startEvent: ReactPointerEvent<HTMLDivElement>) => {
    const startX = startEvent.clientX
    const startRatio = gameSplitRatio

    beginHorizontalResize(
      startEvent,
      (clientX) => {
        const delta = (clientX - startX) / window.innerWidth
        setGameSplitRatio(Math.min(0.68, Math.max(0.32, startRatio + delta)))
      },
      () => setIsGameResizing(true),
      () => setIsGameResizing(false),
    )
  }, [beginHorizontalResize, gameSplitRatio])

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
  const deviceLanguage = editorSettings.device_language ?? editorSettings.microbit_language ?? 'python'
  const deviceLabel = projectType === 'circuitplayground' ? 'Circuit Playground Express' : 'micro:bit'
  const deviceShortLabel = projectType === 'circuitplayground' ? 'Circuit Playground' : 'micro:bit'
  const deviceKind = projectType === 'circuitplayground' ? 'circuitplayground' : 'microbit'

  const projectTone: PastelTone = projectType === 'python'
    ? 'indigo'
    : isDeviceNotebook(projectType)
      ? 'sky'
    : projectType === 'strudel'
      ? 'violet'
      : projectType === 'game2d'
        ? 'cyan'
        : 'emerald'

  return (
    <>
    <div className="flex h-full min-h-0 gap-3 bg-slate-100 p-4">
      {/* ── Main notebook card ───────────────────────────────────────────── */}
      <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl text-slate-900 shadow-[0_18px_60px_rgba(15,23,42,0.10)] ${PASTEL_SURFACES[projectTone]}`}>
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
              title={isEnglish ? 'Edit title' : 'Modifica titolo'}
            >
              {title || (isEnglish ? 'Untitled notebook' : 'Notebook senza titolo')}
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
          ) : isDeviceNotebook(projectType) ? (
            <div className="flex items-center gap-1.5 text-[11px] text-sky-700">
              <Cpu className="h-3.5 w-3.5" />
              <span>{deviceShortLabel} · Web Serial</span>
            </div>
          ) : projectType === 'strudel' ? (
            <div className={`flex items-center gap-1.5 text-[11px] ${strudelPlaying ? 'text-violet-600' : 'text-slate-500'}`}>
              <Music2 className="h-3.5 w-3.5" />
              <span>{strudelPlaying ? '♪ Suonando' : 'Live Music'}</span>
            </div>
          ) : projectType === 'game2d' ? (
            <div className={`flex items-center gap-1.5 text-[11px] ${gamePlaying ? 'text-cyan-700' : 'text-slate-500'}`}>
              <Gamepad2 className="h-3.5 w-3.5" />
              <span>{isEnglish ? 'Phaser runner' : 'Runner Phaser'}</span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-700">
              <Monitor className="h-3.5 w-3.5" />
              <span>{isEnglish ? 'Interactive preview' : 'Preview interattiva'}</span>
            </div>
          )}

          <div className="flex items-center gap-1 text-[11px]">
            {saveStatus === 'saving' && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
            {saveStatus === 'saved' && <CheckCircle className="h-3 w-3 text-emerald-500" />}
            {saveStatus === 'unsaved' && <Save className="h-3 w-3 text-amber-400" />}
            <span className={saveStatus === 'unsaved' ? 'text-amber-500' : 'text-slate-500'}>
              {saveStatus === 'saving'
                ? (isEnglish ? 'Saving…' : 'Salvataggio…')
                : saveStatus === 'saved'
                  ? (isEnglish ? 'Saved' : 'Salvato')
                  : (isEnglish ? 'Unsaved' : 'Da salvare')}
            </span>
          </div>

          {notebookId && (
            <button
              onClick={() => setChatSidebarOpen((v) => !v)}
              title={chatSidebarOpen
                ? (isEnglish ? 'Close tutor sidebar' : 'Chiudi sidebar tutor')
                : (isEnglish ? 'Open tutor as sidebar' : 'Apri tutor come sidebar')}
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
            {isEnglish ? 'Theme' : 'Tema'}
            <select
              value={editorSettings.theme}
              onChange={(e) => updateEditorSettings({ theme: e.target.value as NotebookTheme })}
              className="rounded-lg border border-slate-300/80 bg-white/80 px-2 py-1.5 text-slate-700 outline-none"
            >
              <option value="dark">{isEnglish ? 'Dark' : 'Scuro'}</option>
              <option value="light">{isEnglish ? 'Light' : 'Chiaro'}</option>
              <option value="fancy">Fancy</option>
              <option value="dracula">Dracula</option>
              <option value="p5js">P5.js</option>
            </select>
          </label>

          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            {isEnglish ? 'Size' : 'Dimensione'}
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
            {isEnglish ? 'Font' : 'Font'}
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

          <label className="flex items-center gap-1.5 text-xs text-slate-500" title={`${isEnglish ? 'Font weight' : 'Peso font'}: ${fontWeight}`}>
            {isEnglish ? 'Weight' : 'Peso'}
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

          {(projectType === 'p5js' || projectType === 'game2d') && (
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

          {isDeviceNotebook(projectType) && projectType === 'circuitplayground' ? (
            <div className="rounded-lg border border-slate-300/80 bg-white/80 px-2 py-1.5 text-xs font-semibold text-slate-700">
              Linguaggio CircuitPython
            </div>
          ) : isDeviceNotebook(projectType) && (
            <label className="flex items-center gap-1.5 text-xs text-slate-500">
              Linguaggio
              <select
                value={deviceLanguage}
                onChange={(e) => updateEditorSettings({ device_language: e.target.value as 'python' | 'javascript' })}
                className="rounded-lg border border-slate-300/80 bg-white/80 px-2 py-1.5 text-slate-700 outline-none"
              >
                <option value="python">Python</option>
                <option value="javascript">JavaScript</option>
              </select>
            </label>
          )}

          <div className="flex-1" />

          <div className="flex items-center gap-1">
            {projectType === 'python' && (
              <button
                onClick={() => insertCellBelow(activeCellId ?? cells[cells.length - 1]?.id)}
                title={isEnglish ? 'Add cell' : 'Aggiungi cella'}
                className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs shadow-sm transition-colors ${PASTEL_SURFACES.slate}`}
              >
                <Plus className="h-3 w-3" />
                {isEnglish ? 'Cell' : 'Cella'}
              </button>
            )}
            {isDeviceNotebook(projectType) ? (
              <div className="rounded-xl bg-sky-100 px-3 py-1.5 text-xs font-semibold text-sky-700">
                Programma la scheda e leggi la seriale nel cruscotto
              </div>
            ) : projectType === 'strudel' ? (
              <>
                <div className="relative">
                  <button
                    onClick={() => setStrudelTemplatesOpen((v) => !v)}
                    title={isEnglish ? 'Ready-made patterns' : 'Modelli pronti'}
                    className="flex items-center gap-1 rounded-xl bg-violet-100 px-3 py-1.5 text-xs text-violet-700 shadow-sm transition-colors hover:bg-violet-200"
                  >
                    <BookOpen className="h-3 w-3" />
                    {isEnglish ? 'Templates' : 'Modelli'}
                    <ChevronDown className={`h-3 w-3 transition-transform ${strudelTemplatesOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {strudelTemplatesOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setStrudelTemplatesOpen(false)}
                      />
                      <div className="absolute left-0 top-full z-50 mt-1 w-60 overflow-hidden rounded-xl border border-violet-200 bg-white shadow-lg">
                        {STRUDEL_TEMPLATES.map((tpl) => (
                          <button
                            key={tpl.id}
                            onClick={() => {
                              if (activeCell) updateCell(activeCell.id, { source: tpl.code })
                              setStrudelTemplatesOpen(false)
                            }}
                            className="flex w-full flex-col gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-violet-50"
                          >
                            <span className="text-xs font-semibold text-slate-800">{tpl.label}</span>
                            <span className="text-[10px] text-slate-500">{tpl.description}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <button
                  onClick={handleStrudelPlay}
                  title={isEnglish ? 'Play (Shift+Enter)' : 'Suona (Shift+Enter)'}
                  className="flex items-center gap-1 rounded-xl bg-violet-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-violet-500"
                >
                  <Play className="h-3 w-3" />
                  Play
                </button>
                <button
                  onClick={handleStrudelStop}
                  disabled={!strudelPlaying}
                  title={isEnglish ? 'Stop' : 'Ferma'}
                  className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs shadow-sm transition-colors disabled:opacity-40 ${PASTEL_SURFACES.rose} ${PASTEL_ICON_TEXT.rose}`}
                >
                  <Pause className="h-3 w-3" />
                  Stop
                </button>
              </>
            ) : projectType === 'game2d' ? (
              <>
                <button
                  onClick={handleGamePlay}
                  title={isEnglish ? 'Run game' : 'Esegui gioco'}
                  className="flex items-center gap-1 rounded-xl bg-cyan-600 px-3 py-1.5 text-xs text-white transition-colors hover:bg-cyan-500"
                >
                  <Play className="h-3 w-3" />
                  Play
                </button>
                <button
                  onClick={handleGameStop}
                  disabled={!gamePlaying}
                  title={isEnglish ? 'Pause game' : 'Pausa gioco'}
                  className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs shadow-sm transition-colors disabled:opacity-40 ${PASTEL_SURFACES.rose} ${PASTEL_ICON_TEXT.rose}`}
                >
                  <Pause className="h-3 w-3" />
                  Pausa
                </button>
              </>
            ) : projectType === 'p5js' ? (
              <>
                <button
                  onClick={() => setLibraryManagerOpen((v) => !v)}
                  title="Gestisci librerie aggiuntive"
                  className={`flex items-center gap-1 rounded-xl px-3 py-1.5 text-xs shadow-sm transition-colors ${
                    (editorSettings.libraries ?? []).length > 0
                      ? 'bg-indigo-100 text-indigo-700 hover:bg-indigo-200'
                      : `${PASTEL_SURFACES.slate} ${PASTEL_ICON_TEXT.slate}`
                  }`}
                >
                  <PackagePlus className="h-3 w-3" />
                  Librerie
                  {(editorSettings.libraries ?? []).length > 0 && (
                    <span className="ml-0.5 rounded-full bg-indigo-600 px-1.5 py-0.5 text-[9px] font-bold text-white">
                      {(editorSettings.libraries ?? []).length}
                    </span>
                  )}
                </button>
                <button
                  onClick={handleP5Play}
                  title={isEnglish ? 'Run sketch' : 'Esegui sketch'}
                  className="flex items-center gap-1 rounded-xl bg-[#2196F3] px-3 py-1.5 text-xs text-white transition-colors hover:bg-[#1d84d8]"
                >
                  <Play className="h-3 w-3" />
                  Play
                </button>
                <button
                  onClick={handleP5Stop}
                  disabled={!p5Playing}
                  title={isEnglish ? 'Stop sketch' : 'Ferma sketch'}
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
                {isEnglish ? 'Run all' : 'Esegui tutto'}
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
                  {isEnglish ? 'Restart' : 'Restart'}
                </button>
              )
            )}
          </div>
        </div>

        {projectType === 'python' && pyStatus === 'loading' && (
          <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-700">
            {isEnglish
              ? 'Loading the Python runtime (Pyodide): the first start may take a few seconds.'
              : 'Caricamento del motore Python (Pyodide) in corso: la prima volta può richiedere qualche secondo.'}
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
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-slate-700">
                <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-indigo-600">
                  <Sparkles className="h-3.5 w-3.5" />
                  {isEnglish ? 'Learning Support' : 'Supporto Didattico'}
                </div>
                <p>{assistantSummary}</p>
              </div>
            </div>
          )}

          {isDeviceNotebook(projectType) ? (
            <div className="flex min-h-0 flex-1 p-4 gap-0 overflow-hidden">
              <div className={`flex min-h-0 flex-1 overflow-hidden rounded-xl shadow-sm ${PASTEL_SURFACES.slate}`}>
                <div className="flex min-h-0 min-w-0 flex-[1.15] flex-col overflow-hidden bg-slate-950">
                  <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5">
                    <Cpu className="h-3 w-3 text-sky-300" />
                    <span className="font-mono text-[10px] text-sky-200/70">
                      {deviceLanguage === 'javascript' ? 'main.js' : 'main.py'} · {deviceLabel}
                    </span>
                    <div className="flex-1" />
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                      single page
                    </span>
                  </div>
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
                      onRun={() => undefined}
                      onApplyProposal={(proposalId) => applyProposal(activeCell.id, proposalId)}
                      onRejectProposal={(proposalId) => rejectProposal(activeCell.id, proposalId)}
                    />
                  )}
                </div>

                <div className="w-2 flex-shrink-0 bg-slate-200" />

                <div className="min-h-0 min-w-[320px] flex-1 p-4">
                  {deviceKind === 'circuitplayground' ? (
                    <CircuitPlaygroundPanel
                      source={activeCell?.source ?? ''}
                      onReplaceSource={(source) => {
                        if (activeCell) updateCell(activeCell.id, { source })
                      }}
                    />
                  ) : (
                    <NotebookMicrobitSerialPanel
                      device={deviceKind}
                      source={activeCell?.source ?? ''}
                      onReplaceSource={(source) => {
                        if (activeCell) updateCell(activeCell.id, { source })
                      }}
                    />
                  )}
                </div>
              </div>
            </div>
          ) : projectType === 'strudel' ? (
            <div className="flex min-h-0 flex-1 p-4 gap-0 overflow-hidden">
              <div className={`flex min-h-0 flex-1 overflow-hidden rounded-xl shadow-sm ${PASTEL_SURFACES.slate}`}>
                {/* Left: editor */}
                <div
                  className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-slate-950"
                  style={{ flexBasis: `${strudelSplitRatio * 100}%` }}
                >
                  {/* Strudel header bar */}
                  <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5">
                    <Music2 className="h-3 w-3 text-violet-400" />
                    <span className="font-mono text-[10px] text-violet-300/60">strudel pattern</span>
                  </div>
                  {activeCell && (
                    <NotebookCell
                      cell={activeCell}
                      projectType="strudel"
                      theme={editorSettings.theme}
                      fontSize={editorSettings.font_size}
                      fontFamily={editorSettings.font_family}
                      fontWeight={fontWeight}
                      isRunning={false}
                      isActive
                      isCompact
                      showOutputs={false}
                      proposals={[]}
                      onActivate={() => setActiveCellId(activeCell.id)}
                      onChange={(source) => updateCell(activeCell.id, { source })}
                      onRun={handleStrudelPlay}
                    />
                  )}
                </div>

                {/* Resize handle */}
                <div
                  onPointerDown={startStrudelResize}
                  className={`group relative w-2 flex-shrink-0 cursor-col-resize touch-none ${isStrudelResizing ? 'bg-violet-200' : 'bg-slate-200 hover:bg-violet-200'}`}
                  title={isEnglish ? 'Resize editor and preview' : 'Ridimensiona editor e preview'}
                >
                  <div className={`absolute inset-0 m-auto h-14 w-1 rounded-full transition ${isStrudelResizing ? 'bg-violet-500' : 'bg-slate-400 group-hover:bg-violet-500'}`} />
                </div>

                {/* Right: Strudel preview */}
                <div className={`relative min-h-0 min-w-0 flex-1 ${isStrudelResizing ? 'pointer-events-none' : ''}`}>
                  <Suspense fallback={previewFallback}>
                    <NotebookStrudelPreview
                      ref={strudelRef}
                      runtimeError={strudelError}
                    />
                  </Suspense>
                </div>
              </div>
            </div>
          ) : projectType === 'game2d' ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
              <div className={`flex min-h-0 flex-1 overflow-hidden rounded-xl shadow-sm ${PASTEL_SURFACES.slate}`}>
                <div
                  className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-slate-950"
                  style={{ flexBasis: `${gameSplitRatio * 100}%` }}
                >
                  <div className="flex flex-shrink-0 items-center gap-2 border-b border-slate-800 bg-slate-900 px-3 py-1.5">
                    <Gamepad2 className="h-3 w-3 text-cyan-300" />
                    <span className="font-mono text-[10px] text-cyan-200/70">game.json · schema driven</span>
                  </div>
                  {activeCell && (
                    <NotebookCell
                      cell={activeCell}
                      projectType="game2d"
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

                <div
                  onPointerDown={startGameResize}
                  className={`group relative w-2 flex-shrink-0 cursor-col-resize touch-none ${isGameResizing ? 'bg-cyan-200' : 'bg-slate-200 hover:bg-cyan-200'}`}
                  title={isEnglish ? 'Resize schema and game preview' : 'Ridimensiona schema e anteprima gioco'}
                >
                  <div className={`absolute inset-0 m-auto h-14 w-1 rounded-full transition ${isGameResizing ? 'bg-cyan-500' : 'bg-slate-400 group-hover:bg-cyan-500'}`} />
                </div>

                <div className={`relative min-h-0 min-w-0 flex-1 p-4 ${isGameResizing ? 'pointer-events-none' : ''}`}>
                  <Suspense fallback={previewFallback}>
                    <NotebookGame2DPreview
                      source={gameSource}
                      livePreview={editorSettings.live_preview}
                      previewNonce={previewNonce}
                      runtimeError={previewRuntimeError}
                      onRuntimeMessage={setPreviewRuntimeError}
                      onIframeLoad={(win) => { gameIframeWindowRef.current = win }}
                    />
                  </Suspense>
                </div>
              </div>

              {previewRuntimeError && (
                <div className="flex-shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
                  <div className="flex items-center gap-2 px-4 py-2">
                    <Terminal className="h-3.5 w-3.5 text-slate-400" />
                    <span className="text-xs font-semibold text-slate-400">{isEnglish ? 'Runner diagnostics' : 'Diagnostica runner'}</span>
                    <span className="rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      runtime error
                    </span>
                    <div className="flex-1" />
                    <button
                      onClick={(e) => { e.stopPropagation(); analyzeConsoleError() }}
                      disabled={consoleAiLoading}
                      className="flex items-center gap-1 rounded-lg bg-cyan-600 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-cyan-500 disabled:opacity-50"
                    >
                      {consoleAiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
                      {isEnglish ? 'Analyze' : 'Analizza'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); proposeConsoleFix() }}
                      disabled={assistantLoading}
                      className="flex items-center gap-1 rounded-lg border border-emerald-700 bg-emerald-900/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-800/50 disabled:opacity-50"
                    >
                      {assistantLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                      {isEnglish ? 'Fix JSON' : 'Correggi JSON'}
                    </button>
                  </div>
                  <div className="border-t border-slate-800 px-4 py-2 font-mono text-xs text-red-400">
                    {previewRuntimeError}
                  </div>
                </div>
              )}
            </div>
          ) : projectType === 'p5js' ? (
            <div className="flex min-h-0 flex-1 flex-col p-4 gap-2">
              <div className={`flex min-h-0 flex-1 overflow-hidden rounded-xl shadow-sm ${PASTEL_SURFACES.slate}`}>
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
                            title={isEnglish ? 'Click to open · Double click to rename' : 'Click per aprire · Doppio click per rinominare'}
                          >
                            {cell.name ?? 'sketch.js'}
                          </button>
                        )}
                        {cells.length > 1 && cell.id === (activeCellId ?? cells[0]?.id) && (
                          <button
                            onClick={() => deleteP5File(cell.id)}
                            className="ml-0.5 rounded p-0.5 text-slate-500 transition-colors hover:text-red-400"
                            title={isEnglish ? 'Delete file' : 'Elimina file'}
                          >
                            <Trash2 className="h-2.5 w-2.5" />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={addP5File}
                      className="ml-1 rounded p-1 text-slate-500 transition-colors hover:text-teal-300"
                      title={isEnglish ? 'New file' : 'Nuovo file'}
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
                  title={isEnglish ? 'Resize editor and preview' : 'Ridimensiona editor e preview'}
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
                      activeLibraries={editorSettings.libraries ?? []}
                    />
                  </Suspense>
                </div>
              </div>

              {/* Console panel */}
              {(() => {
                const hasErrors = !!previewRuntimeError || consoleEntries.some((e) => e.level === 'error')
                return (
	                  <div className="flex-shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-950">
                    {/* Header row */}
                    <div className="flex items-center gap-2 px-4 py-2">
                      <button
                        onClick={() => setConsoleOpen((v) => !v)}
                        className="flex flex-1 items-center gap-2 text-left"
                      >
                        <Terminal className="h-3.5 w-3.5 text-slate-400" />
                        <span className="text-xs font-semibold text-slate-400">{isEnglish ? 'Console' : 'Console'}</span>
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
                          title={isEnglish ? 'Ask AI why this error happened' : 'Chiedi all\'AI perché c\'è l\'errore'}
                          className="flex items-center gap-1 rounded-lg bg-[#E91E63] px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-[#d61b5b] disabled:opacity-50"
                        >
                          {consoleAiLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
                          {isEnglish ? 'Analyze' : 'Analizza'}
                        </button>
                      )}
                      {hasErrors && (
                        <button
                          onClick={(e) => { e.stopPropagation(); proposeConsoleFix() }}
                          disabled={assistantLoading}
                          title={isEnglish ? 'Generate a code fix proposal' : 'Genera proposta di correzione del codice'}
                          className="flex items-center gap-1 rounded-lg border border-emerald-700 bg-emerald-900/40 px-2.5 py-1 text-[11px] font-semibold text-emerald-300 transition hover:bg-emerald-800/50 disabled:opacity-50"
                        >
                          {assistantLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
                          {isEnglish ? 'Fix' : 'Correggi'}
                        </button>
                      )}
                      {consoleEntries.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setConsoleEntries([]); setConsoleAiResponse(null) }}
                          className="text-[10px] text-slate-500 hover:text-slate-300"
                        >
                          {isEnglish ? 'Clear' : 'Pulisci'}
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
                            <p className="text-slate-600">{isEnglish ? 'No console output.' : 'Nessun output console.'}</p>
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
                              {isEnglish ? 'AI Analysis' : 'Analisi AI'}
                            </div>
                            {consoleAiLoading ? (
                              <div className="flex items-center gap-2 text-xs text-slate-400">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                {isEnglish ? 'Analyzing the error…' : 'Analizzo l\'errore…'}
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
                                {isEnglish ? 'Generate fix proposal' : 'Genera proposta di correzione'}
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
	                    <div className={`sticky bottom-4 mx-auto flex max-w-xl flex-col gap-3 rounded-xl bg-white/90 p-4 shadow-lg backdrop-blur-sm ${PASTEL_SURFACES[projectTone]}`}>
                    <div className="flex items-center gap-2 text-xs font-medium text-indigo-500">
                      <Terminal className="h-3.5 w-3.5" />
                      {isEnglish ? 'The program is asking for a value' : 'Il programma chiede un valore'}
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
                        placeholder={isEnglish ? 'Type your answer here…' : 'Scrivi qui la risposta…'}
                        className="flex-1 rounded-lg border border-slate-300/80 bg-white/85 px-3 py-1.5 font-mono text-sm text-slate-900 outline-none transition-colors focus:border-indigo-500"
                      />
                      <button
                        onClick={() => {
                          inputState.submit(inputValue)
                          setInputValue('')
                        }}
                        className="rounded-lg bg-[#E91E63] px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#d61b5b]"
                      >
                        {isEnglish ? 'Send' : 'Invia'}
                      </button>
                    </div>
                  </div>
                )}

                <button
                  onClick={() => insertCellBelow(cells[cells.length - 1]?.id)}
	                  className="flex w-full items-center justify-center gap-1 rounded-xl border-2 border-dashed border-slate-300 py-4 text-xs text-slate-500 transition-colors hover:border-indigo-400 hover:text-indigo-500"
                >
                  <Plus className="h-3.5 w-3.5" />
                  {isEnglish ? 'Add cell' : 'Aggiungi cella'}
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
            title={isEnglish ? 'Resize tutor sidebar' : 'Ridimensiona sidebar tutor'}
          >
            <div className={`absolute inset-0 m-auto h-14 w-1 rounded-full transition ${
              projectType === 'python'
                ? (isTutorResizing ? 'bg-[#d61b5b]' : 'bg-[#E91E63] group-hover:bg-[#d61b5b]')
                : (isTutorResizing ? 'bg-[#1d84d8]' : 'bg-[#2196F3] group-hover:bg-[#1d84d8]')
            }`} />
          </div>
	          <div className={`flex flex-1 flex-col gap-3 min-h-0 min-w-0 overflow-hidden rounded-xl shadow-sm ${PASTEL_SURFACES[projectTone]}`}>
            {isDeviceNotebook(projectType) && activeCell ? (
              <NotebookMicrobitAgentChat
                notebookId={notebookId}
                device={deviceKind}
                currentCellSource={activeCell.source}
                lastOutput={lastOutput}
                pendingProposals={assistantProposals[activeCell.id] || []}
                initialMessages={notebookData?.tutor_messages || []}
                onProposals={(summary, proposals) => {
                  setAssistantSummary(summary)
                  setAssistantProposals((prev) => ({ ...prev, [activeCell.id]: proposals }))
                }}
                onApplyProposal={(proposalId) => applyProposal(activeCell.id, proposalId)}
                onRejectProposal={(proposalId) => rejectProposal(activeCell.id, proposalId)}
              />
            ) : (
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
            )}
          </div>
        </div>
      )}

    </div>
    <NotebookLibraryManager
      open={libraryManagerOpen}
      onClose={() => setLibraryManagerOpen(false)}
      selectedLibraries={editorSettings.libraries ?? []}
      onToggleLibrary={(id) => {
        const current = editorSettings.libraries ?? []
        const next = current.includes(id) ? current.filter((l) => l !== id) : [...current, id]
        updateEditorSettings({ libraries: next })
        setPreviewNonce((n) => n + 1)
      }}
      onInsertTemplate={(code) => {
        if (activeCellId) {
          updateCell(activeCellId, { source: code })
          setPreviewNonce((n) => n + 1)
        }
        setLibraryManagerOpen(false)
      }}
    />
    </>
  )
}
