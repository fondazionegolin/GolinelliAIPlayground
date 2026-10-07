import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { agenticApi } from '@/lib/api'
import { Button } from '@/design'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownCodeComponents } from '@/components/CodeBlock'
import { SpreadsheetEditor, type SheetCellStyles, type SheetChartConfig, type SheetDimensions } from '@/components/SpreadsheetEditor'
import { ArtifactPreviews, extractArtifacts, hasArtifacts, type NodeArtifacts } from '@/components/agentic/NodeArtifacts'
import { OutputExplorerModal, formatCompact, isPlot, isTable, type ExplorerTarget, type PlotValue, type TableValue } from '@/components/agentic/OutputExplorer'
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis } from 'recharts'
import {
  Activity, BarChart3, Braces, ChevronDown, ChevronRight,
  Database, FileSpreadsheet, GitBranch, GripVertical, Maximize2, MessageSquareText, MousePointer2,
  ArrowLeft, Cloud, CloudOff, Eraser, Network, Play, Save, Search,
  Sigma, Split, Square, Trash2, Undo2, X, ZoomIn, ZoomOut, Minus, Paperclip, Grid3x3, Crosshair, AlertTriangle,
} from '@/components/icons'
import { SidebarCollapseButton, SidebarRail, useSidebarCollapsed } from '@/components/SidebarRail'

// Generic platform nodes carry the union of their functions' ports/params: `showFor` lists the functions an item
// belongs to, `variants[fn]` overrides label/default/options/type for one function.
type PerFunction<T> = { showFor?: string[]; variants?: Record<string, Partial<T>> }
type Port = { name: string; type: string; label: string; required?: boolean } & PerFunction<{ name: string; type: string; label: string; required?: boolean }>
type PlatformFunction = { id: string; label: string; description: string; sideEffects?: string; longRunning?: boolean }
type Param = { name: string; type: string; label: string; default?: unknown; options?: string[]; optionLabels?: Record<string, string>; min?: number; max?: number; step?: number; required?: boolean; showFor?: string[]; variants?: Record<string, Partial<Param>> }
type NodeSpec = { id: string; label: string; category: string; description: string; inputs: Port[]; outputs: Port[]; params: Param[]; cachePolicy?: string; functions?: PlatformFunction[]; hidden?: boolean }
type NodeStatus = 'idle' | 'running' | 'complete' | 'waiting' | 'skipped' | 'error'
type CanvasNode = { id: string; instanceId: string; x: number; y: number; status: NodeStatus; config: Record<string, unknown> }
type Edge = { id: string; from: string; to: string; sourcePort: string; targetPort: string }
type NodeRun = { node_instance_id: string; visit?: number; label: string; status: string; output?: Record<string, unknown>; error?: string | null; duration_ms?: number | null }
type WorkflowRun = { id: string; status: string; output?: Record<string, unknown>; error?: string | null; nodes: NodeRun[] }
type TableEditorState = { chart: SheetChartConfig; styles: SheetCellStyles; dimensions: SheetDimensions }
// `detached` tables (e.g. data behind a chart) open in the spreadsheet for exploration only: nothing is written back.
type TableModalState = { nodeId: string; outputPort: string; nodeLabel: string; table: TableValue; editor?: Partial<TableEditorState>; detached?: boolean }

const makeSpec = (
  id: string, label: string, category: string, description: string,
  inputs: Array<[string, string, boolean?]>, outputs: Array<[string, string]>, params: Array<[string, string, string, unknown, string[]?]>,
): NodeSpec => ({
  id, label, category, description,
  inputs: inputs.map(([name, type, required = true]) => ({ name, type, label: name, required })),
  outputs: outputs.map(([name, type]) => ({ name, type, label: name })),
  params: params.map(([name, type, paramLabel, defaultValue, options]) => ({ name, type, label: paramLabel, default: defaultValue, options })),
})

const FALLBACK_SPECS: NodeSpec[] = [
  makeSpec('ai.generate_dataset', 'Genera dataset con AI', 'Sorgenti', 'Genera una tabella coerente tramite un LLM.', [], [['table', 'TABLE'], ['metadata', 'METRICS']], [['prompt', 'CODE', 'Descrizione dataset', 'Dataset realistico sui consumi energetici mensili di edifici scolastici'], ['columns', 'STRING', 'Colonne', 'mese,studenti,kwh,costo_euro'], ['rows', 'INTEGER', 'Righe', 30], ['provider', 'STRING', 'Provider', ''], ['model', 'STRING', 'Modello', '']]),
  makeSpec('csv.synthetic', 'Dataset sintetico', 'Sorgenti', 'Genera dati riproducibili.', [], [['table', 'TABLE']], [['kind', 'SELECT', 'Tipo', 'regression', ['regression', 'classification', 'blobs']], ['samples', 'INTEGER', 'Righe', 100], ['features', 'INTEGER', 'Feature', 3], ['seed', 'INTEGER', 'Seed', 42]]),
  makeSpec('data.custom_input', 'Tabella manuale', 'Sorgenti', 'Crea una tabella da JSON o CSV, anche caricando un file.', [], [['table', 'TABLE']], [['data', 'CODE', 'Dati', '[{"x":1,"y":2}]']]),
  makeSpec('data.saved_dataset', 'Dataset salvato', 'Sorgenti', 'Riusa un dataset già generato o caricato.', [], [['table', 'TABLE']], [['dataset_id', 'DATASET', 'Dataset', '']]),
  makeSpec('math.numeric_input', 'Valore numerico', 'Sorgenti', 'Immette un numero.', [], [['value', 'ANY']], [['value', 'NUMBER', 'Valore', 0]]),
  makeSpec('data.new_table', 'Nuova tabella da input', 'Sorgenti', 'Materializza in una nuova tabella i dati arrivati da un altro nodo.', [['table', 'TABLE']], [['table', 'TABLE']], [['columns', 'COLUMNS', 'Colonne da copiare', ''], ['rename', 'STRING', 'Rinomina (vecchio:nuovo)', ''], ['title', 'STRING', 'Nome della nuova tabella', 'Nuova tabella'], ['save_to_library', 'BOOLEAN', 'Salva nella libreria dataset', false]]),
  makeSpec('data.select', 'Seleziona colonne', 'Trasformazioni', 'Include o esclude colonne.', [['table', 'TABLE']], [['table', 'TABLE']], [['mode', 'SELECT', 'Modalità', 'include', ['include', 'exclude']], ['columns', 'COLUMNS', 'Colonne', '']]),
  makeSpec('data.filter', 'Filtra righe', 'Trasformazioni', 'Filtra con una query pandas.', [['table', 'TABLE']], [['table', 'TABLE']], [['expression', 'CODE', 'Espressione', '']]),
  makeSpec('data.split', 'Train / test split', 'Trasformazioni', 'Divide il dataset.', [['table', 'TABLE']], [['train', 'TABLE'], ['test', 'TABLE']], [['test_size', 'SLIDER', 'Quota test', .2], ['seed', 'INTEGER', 'Seed', 42]]),
  makeSpec('math.operation', 'Operazione', 'Matematica', 'Esegue un calcolo.', [['a', 'ANY'], ['b', 'ANY', false]], [['result', 'ANY']], [['operation', 'SELECT', 'Operazione', 'add', ['add', 'subtract', 'multiply', 'divide', 'power', 'sqrt']]]),
  makeSpec('ml.regression', 'Regressione', 'Machine Learning', 'Addestra un regressore.', [['train', 'TABLE']], [['model', 'MODEL'], ['metrics', 'METRICS'], ['predictions', 'TABLE']], [['target_column', 'COLUMN', 'Target', 'target'], ['feature_columns', 'COLUMNS', 'Feature', ''], ['algorithm', 'SELECT', 'Algoritmo', 'linear', ['linear', 'ridge', 'random_forest']], ['cv_folds', 'INTEGER', 'Cross validation', 5]]),
  makeSpec('ml.predict', 'Applica modello', 'Machine Learning', 'Predice su nuovi dati.', [['model', 'MODEL'], ['data', 'TABLE']], [['predictions', 'TABLE']], []),
  makeSpec('plot.2d', 'Grafico', 'Visualizzazioni', 'Scatter 2D, oppure 3D se imposti anche Z.', [['table', 'TABLE']], [['plot', 'ANY']], [['x', 'COLUMN', 'Asse X', 'feature_1'], ['y', 'COLUMN', 'Asse Y', 'prediction'], ['z', 'COLUMN', 'Asse Z (opzionale)', '']]),
  makeSpec('plot.histogram', 'Istogramma', 'Visualizzazioni', 'Visualizza una distribuzione.', [['table', 'TABLE']], [['plot', 'ANY']], [['column', 'COLUMN', 'Colonna', 'target'], ['bins', 'INTEGER', 'Intervalli', 20]]),
  makeSpec('chatbot.start', 'Inizio conversazione', 'Chatbot', 'Punto di ingresso del flusso.', [], [['next', 'ANY']], [['welcome_message', 'STRING', 'Messaggio di benvenuto', '']]),
  makeSpec('chatbot.say', 'Messaggio', 'Chatbot', 'Invia un messaggio.', [['trigger', 'ANY', false]], [['next', 'ANY']], [['message', 'STRING', 'Messaggio', 'Ciao!']]),
  makeSpec('chatbot.ask', 'Domanda', 'Chatbot', 'Attende la risposta reale.', [['trigger', 'ANY', false]], [['response', 'ANY']], [['question', 'STRING', 'Domanda', 'Come posso aiutarti?'], ['test_response', 'STRING', 'Risposta test', '']]),
  makeSpec('chatbot.if_contains', 'Contiene parole', 'Chatbot', 'Ramifica il dialogo.', [['text', 'ANY']], [['yes', 'ANY'], ['no', 'ANY']], [['keywords', 'STRING', 'Parole', 'urgente']]),
  makeSpec('llm_chatbot', 'Chatbot LLM', 'Chatbot', 'Risponde con un modello cloud usando fino a 3 contesti.', [['message', 'ANY', false], ['context_1', 'ANY', false], ['context_2', 'ANY', false], ['context_3', 'ANY', false]], [['response', 'ANY'], ['next', 'ANY']], [['system_prompt', 'CODE', 'Condizionamento di sistema', 'Sei un assistente utile.'], ['continuous', 'BOOLEAN', 'Iterazione continua', false], ['exit_phrases', 'STRING', 'Frasi di chiusura (esempi per il modello)', 'grazie, ok basta, basta così, sono soddisfatto, ho capito, fine, ciao'], ['max_turns', 'INTEGER', 'Turni massimi in iterazione continua', 20]]),
  makeSpec('chatbot.end', 'Fine conversazione', 'Chatbot', 'Chiude il ramo conversazionale.', [['trigger', 'ANY', false]], [['result', 'ANY']], [['message', 'STRING', 'Messaggio finale', 'Conversazione conclusa.']]),
  makeSpec('control.repeat_until', 'Ripeti finché', 'Controllo', 'Verifica un valore: se la condizione è soddisfatta prosegue, altrimenti «Ripeti» torna a un nodo precedente.', [['value', 'ANY']], [['ok', 'ANY'], ['repeat', 'ANY'], ['exhausted', 'ANY']], [['mode', 'SELECT', 'Condizione', 'contiene', ['contiene', 'uguale', 'verifica_ai', 'vero_falso']], ['expected', 'STRING', 'Valore atteso / criterio', '56'], ['max_attempts', 'INTEGER', 'Tentativi massimi', 3]]),
  makeSpec('control.if_else', 'IF / ELSE', 'Controllo', 'Attiva uno dei due rami.', [['condition', 'ANY']], [['yes', 'ANY'], ['no', 'ANY']], []),
]

const INLINE_PARAMS: Record<string, string[]> = {
  'platform.files': ['function'],
  'platform.documents': ['function'],
  'platform.images': ['function'],
  'platform.models3d': ['function'],
  'platform.live': ['function'],
  'data.select': ['columns'],
  'data.new_table': ['columns'],
  'chatbot.start': ['welcome_message'],
  'chatbot.say': ['message'],
  'chatbot.ask': ['question'],
  'chatbot.if_contains': ['keywords'],
  'chatbot.yes_no': [],
  'chatbot.multi_choice': ['question'],
  'chatbot.save_variable': ['variable_name'],
  'chatbot.end': ['message'],
  'llm_chatbot': ['system_prompt', 'continuous'],
  'control.repeat_until': ['mode', 'expected', 'max_attempts'],
  'control.compare_numbers': ['operator'],
}

const CATEGORY_STYLE: Record<string, { dot: string; soft: string; ink: string; icon: typeof Database }> = {
  Sorgenti: { dot: '#0369a1', soft: 'bg-sky-50 border-sky-200', ink: 'text-sky-700', icon: Database },
  Trasformazioni: { dot: '#0f766e', soft: 'bg-teal-50 border-teal-200', ink: 'text-teal-700', icon: Split },
  Testo: { dot: '#be185d', soft: 'bg-pink-50 border-pink-200', ink: 'text-pink-700', icon: Braces },
  Matematica: { dot: '#6d28d9', soft: 'bg-violet-50 border-violet-200', ink: 'text-violet-700', icon: Sigma },
  'Machine Learning': { dot: '#15803d', soft: 'bg-green-50 border-green-200', ink: 'text-green-700', icon: Network },
  Visualizzazioni: { dot: '#c2410c', soft: 'bg-orange-50 border-orange-200', ink: 'text-orange-700', icon: BarChart3 },
  Chatbot: { dot: '#4338ca', soft: 'bg-indigo-50 border-indigo-200', ink: 'text-indigo-700', icon: MessageSquareText },
  Controllo: { dot: '#a16207', soft: 'bg-yellow-50 border-yellow-200', ink: 'text-yellow-700', icon: GitBranch },
  Piattaforma: { dot: '#be123c', soft: 'bg-rose-50 border-rose-200', ink: 'text-rose-700', icon: Cloud },
}

// Nodes reuse the navbar pill material (luminous white surface, inset highlight, cluster shadow) plus a deeper
// drop shadow so they float above the canvas; the category color lives only in icon, label and run button.
const NODE_SHADOW = 'var(--ds-shadow-cluster), 0 18px 36px -14px rgba(88,88,92,.26)'
const PILL_STYLE = { backgroundColor: 'var(--ds-navbar-cluster)', backgroundImage: 'var(--ds-navbar-cluster-bg)', boxShadow: 'var(--ds-shadow-cluster)' }
const tint = (color: string, amount: number) => `color-mix(in srgb, ${color} ${amount}%, var(--mix-base))`
function nodeBoxShadow(status: NodeStatus, isSelected: boolean, accent: string, active: boolean): string {
  // "complete" is the normal resting state — no ring, so a finished canvas doesn't turn into a wall of outlines.
  if (active) return `0 0 0 2px ${accent}, 0 0 0 7px color-mix(in srgb, ${accent} 16%, transparent), 0 22px 44px -12px rgba(88,88,92,.34)`
  const ring = status === 'running' ? accent : status === 'waiting' ? '#f59e0b' : status === 'error' ? '#f43f5e' : isSelected ? '#404040' : null
  return ring ? `0 0 0 2px ${ring}, ${NODE_SHADOW}` : NODE_SHADOW
}

// Canvas dots are 24px apart; the snap step is expressed in dots (½, 1, 5, 10) or disabled.
const GRID = 24
const SNAP_STEPS = [0, .5, 1, 5, 10] as const
const snapValue = (value: number, dots: number) => dots ? Math.round(value / (GRID * dots)) * GRID * dots : value
const REPLAY_STEP_MS = 650
const readStored = (key: string) => { try { return window.localStorage.getItem(key) } catch { return null } }
const writeStored = (key: string, value: string) => { try { window.localStorage.setItem(key, value) } catch { /* storage unavailable */ } }
const typesCompatible = (from: string, to: string) => from === to || from === 'ANY' || to === 'ANY'
// First node(s) of a dialogue: a legacy «Inizio conversazione», else chat nodes that no other dialogue node leads into.
const isChatNode = (id: string) => id.startsWith('chatbot.') || id === 'llm_chatbot'
function dialogueEntryIds(nodes: CanvasNode[], edges: Edge[]): string[] {
  const legacy = nodes.filter((node) => node.id === 'chatbot.start')
  if (legacy.length) return legacy.map((node) => node.instanceId)
  const byId = new Map(nodes.map((node) => [node.instanceId, node]))
  return nodes.filter((node) => isChatNode(node.id) && !edges.some((edge) => edge.to === node.instanceId && edge.sourcePort !== 'repeat' && isFlowNode(byId.get(edge.from)?.id || ''))).map((node) => node.instanceId)
}
const isFlowNode = (id: string) => id.startsWith('chatbot.') || id.startsWith('control.') || id === 'llm_chatbot'
// «Ripeti» of a repeat-until node is the only port allowed to point backwards and close a loop.
const LOOP_NODE = 'control.repeat_until'
const LOOP_PORT = 'repeat'

// Port dots are colored by data type so compatible ends are recognisable before dragging.
const TYPE_COLOR: Record<string, string> = { TABLE: '#0d9488', MODEL: '#16a34a', METRICS: '#ea580c', PARAMS: '#7c3aed', SERIES: '#0284c7', ARRAY_3D: '#db2777', ANY: '#737373' }

const DATAFLOW_CSS = `
@keyframes dfHalo { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--df-accent) 40%, transparent); } 50% { box-shadow: 0 0 0 9px color-mix(in srgb, var(--df-accent) 0%, transparent), 0 0 30px color-mix(in srgb, var(--df-accent) 30%, transparent); } }
.df-halo { animation: dfHalo 1.3s ease-in-out infinite; }
/* Running node: layered accent glow, lightened so it stays visible on dark canvases, pulsing in size and opacity. */
@keyframes dfRunGlow {
  0%, 100% { opacity: .55; box-shadow: 0 0 0 2px var(--df-glow), 0 0 14px 2px var(--df-glow), 0 0 34px 8px color-mix(in srgb, var(--df-glow) 55%, transparent); }
  50% { opacity: 1; box-shadow: 0 0 0 3px var(--df-glow), 0 0 26px 7px var(--df-glow), 0 0 70px 20px color-mix(in srgb, var(--df-glow) 65%, transparent); }
}
.df-running-glow { --df-glow: color-mix(in srgb, var(--df-accent) 72%, white); animation: dfRunGlow 1s ease-in-out infinite; }
@keyframes dfFlow { to { stroke-dashoffset: -28; } }
.df-flow { stroke-dasharray: 9 5; animation: dfFlow .6s linear infinite; }
@keyframes dfPort { 50% { outline-color: rgba(124,58,237,0); outline-offset: 5px; } }
.df-port-target { outline: 3px solid rgba(124,58,237,.4); outline-offset: 1px; animation: dfPort .9s ease-in-out infinite; }
/* Squircle: smooth superellipse corners where supported, a plain round corner elsewhere. */
.df-squircle { border-radius: 22px; }
.df-squircle-top { border-radius: 22px 22px 0 0; }
.df-squircle-sm { border-radius: 14px; }
@supports (corner-shape: squircle) {
  .df-squircle { border-radius: 40px; corner-shape: squircle; }
  .df-squircle-top { border-radius: 40px 40px 0 0; corner-shape: squircle; }
  .df-squircle-sm { border-radius: 24px; corner-shape: squircle; }
}
@media (prefers-reduced-motion: reduce) { .df-halo, .df-flow, .df-port-target { animation: none; } .df-running-glow { animation: none; opacity: 1; } .df-travel { display: none; } }
`

const NODE_WIDTH = 300
// Fallback geometry, used only until the real port positions have been measured from the DOM.
const PORT_TOP = 61
const PORT_HEIGHT = 28
const nodeWidth = (spec: NodeSpec) => spec.category === 'Visualizzazioni' ? 430 : spec.id === 'ml.kmeans_clustering' ? 500 : NODE_WIDTH
const defaults = (spec: NodeSpec) => Object.fromEntries(spec.params.map((param) => [param.name, param.default ?? '']))
const functionOf = (spec: NodeSpec, config: Record<string, unknown>) =>
  spec.functions ? String(config.function || spec.params.find((param) => param.name === 'function')?.default || spec.functions[0]?.id || '') : ''
// The spec a node shows for its selected function: only that function's ports and params, with per-function overrides applied.
function effectiveSpec(spec: NodeSpec, config: Record<string, unknown>): NodeSpec {
  if (!spec.functions) return spec
  const fn = functionOf(spec, config)
  const pick = <T extends { showFor?: string[]; variants?: Record<string, Partial<T>> }>(items: T[]): T[] =>
    items.filter((item) => !item.showFor || item.showFor.includes(fn)).map((item) => ({ ...item, ...(item.variants?.[fn] || {}) }))
  const current = spec.functions.find((item) => item.id === fn)
  return { ...spec, inputs: pick(spec.inputs), outputs: pick(spec.outputs), params: pick(spec.params),
    description: current ? `${current.label}. ${current.description}${current.longRunning ? ' (operazione lunga)' : ''}` : spec.description }
}

function template(specs: NodeSpec[]) {
  const make = (id: string, instanceId: string, x: number, y: number): CanvasNode => ({ id, instanceId, x, y, status: 'idle', config: defaults(specs.find((item) => item.id === id)!) })
  return {
    nodes: [make('csv.synthetic', 'synthetic-1', 80, 260), make('data.split', 'split-1', 450, 260), make('ml.regression', 'regression-1', 820, 120), make('ml.predict', 'predict-1', 1190, 330), make('plot.2d', 'plot-1', 1560, 330)],
    edges: [
      { id: 'e1', from: 'synthetic-1', to: 'split-1', sourcePort: 'table', targetPort: 'table' },
      { id: 'e2', from: 'split-1', to: 'regression-1', sourcePort: 'train', targetPort: 'train' },
      { id: 'e3', from: 'regression-1', to: 'predict-1', sourcePort: 'model', targetPort: 'model' },
      { id: 'e4', from: 'split-1', to: 'predict-1', sourcePort: 'test', targetPort: 'data' },
      { id: 'e5', from: 'predict-1', to: 'plot-1', sourcePort: 'predictions', targetPort: 'table' },
    ] as Edge[],
  }
}

export default function AgenticWorkflowStudioPage({ sessionId }: { sessionId?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { workflowId: routeWorkflowId } = useParams<{ workflowId: string }>()
  const { data: registryResponse } = useQuery({ queryKey: ['agentic-registry-v3'], queryFn: () => agenticApi.getRegistry(), staleTime: 60_000 })
  const specs = useMemo<NodeSpec[]>(() => registryResponse?.data?.nodes?.length ? registryResponse.data.nodes : FALLBACK_SPECS, [registryResponse])
  const initial = useMemo(() => template(FALLBACK_SPECS), [])
  const [nodes, setNodes] = useState<CanvasNode[]>(initial.nodes)
  const [edges, setEdges] = useState<Edge[]>(initial.edges)
  const [outputs, setOutputs] = useState<Record<string, Record<string, unknown>>>({})
  const [nodeErrors, setNodeErrors] = useState<Record<string, string>>({})
  const [selectedId, setSelectedId] = useState('synthetic-1')
  const [connecting, setConnecting] = useState<{ nodeId: string; port: string; type: string } | null>(null)
  const [connectionPoint, setConnectionPoint] = useState<{ x: number; y: number } | null>(null)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['Testo']))
  const [libraryCollapsed, setLibraryCollapsed] = useSidebarCollapsed('dataflow-library')
  const [zoom, setZoom] = useState(.8)
  const [pan, setPan] = useState({ x: 60, y: 60 })
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(['synthetic-1']))
  const [rubberBox, setRubberBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [chatWindow, setChatWindow] = useState(false)
  const [title, setTitle] = useState('Esperimento di regressione')
  const [workflowId, setWorkflowId] = useState<string | null>(routeWorkflowId || null)
  const [activeRun, setActiveRun] = useState<WorkflowRun | null>(null)
  const [running, setRunning] = useState(false)
  const [saveState, setSaveState] = useState<'loading' | 'dirty' | 'saving' | 'saved' | 'error'>('loading')
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [error, setError] = useState('')
  const [chatInput, setChatInput] = useState('')
  const [tableModal, setTableModal] = useState<TableModalState | null>(null)
  const [explorer, setExplorer] = useState<ExplorerTarget | null>(null)
  const [snapDots, setSnapDots] = useState<number>(() => { const stored = readStored('dataflow-snap'); const value = stored === null ? .5 : Number(stored); return (SNAP_STEPS as readonly number[]).includes(value) ? value : .5 })
  const [followRun, setFollowRun] = useState(() => readStored('dataflow-follow') !== '0')
  // Execution focus: the node being executed right now, and every node the current run has already reached.
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null)
  const [runTrail, setRunTrail] = useState<Set<string>>(new Set())
  const [cameraGlide, setCameraGlide] = useState(false)
  // Port centres measured from the DOM, relative to the node's top-left corner (`${node}::in|out::${port}`).
  const [anchors, setAnchors] = useState<Record<string, { x: number; y: number }>>({})
  const anchorSignatureRef = useRef('')
  const canvasRef = useRef<HTMLDivElement>(null)
  const replayedRef = useRef<{ runId: string; seen: Set<string> }>({ runId: '', seen: new Set() })
  const glideTimerRef = useRef<number | undefined>(undefined)
  const viewportRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ startX: number; startY: number; positions: Record<string, { x: number; y: number }>; moved: boolean; nodeId: string; shiftKey: boolean } | null>(null)
  const panRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)
  const rubberRef = useRef<{ startX: number; startY: number } | null>(null)
  const backgroundClickRef = useRef<{ x: number; y: number } | null>(null)
  const connectingRef = useRef<{ nodeId: string; port: string; type: string } | null>(null)
  // Where the drag that started the current connection began; `moved` = drag gesture rather than click-to-connect.
  const connectStartRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const stoppedRef = useRef(false)
  const snapshotRef = useRef({ title, nodes, edges, workflowId: routeWorkflowId || null as string | null })
  const hydratedRef = useRef(false)
  const dirtyRef = useRef(false)
  const savingRef = useRef(false)
  const lastSavedRef = useRef('')
  const saveNowRef = useRef<() => Promise<string | null>>(async () => null)

  const { data: datasetsResponse } = useQuery({ queryKey: ['agentic-datasets'], queryFn: () => agenticApi.listDatasets(), staleTime: 15_000 })
  const selected = nodes.find((node) => node.instanceId === selectedId)
  // Unknown ids (e.g. a node removed from the catalogue) degrade to an inert card instead of crashing the canvas.
  const specOf = (node: CanvasNode): NodeSpec => {
    const found = specs.find((item) => item.id === node.id) || FALLBACK_SPECS.find((item) => item.id === node.id)
    return found ? effectiveSpec(found, node.config)
      : { id: node.id, label: node.id, category: 'Controllo', description: 'Nodo non disponibile nel catalogo corrente.', inputs: [], outputs: [], params: [] }
  }
  const liveRef = useRef({ nodes, zoom, followRun })
  liveRef.current = { nodes, zoom, followRun }
  const focusMode = running || activeNodeId !== null || (chatWindow && activeRun?.status === 'waiting')

  useLayoutEffect(() => {
    const root = canvasRef.current
    if (!root) return
    const next: Record<string, { x: number; y: number }> = {}
    root.querySelectorAll<HTMLElement>('[data-anchor]').forEach((element) => {
      const article = element.closest<HTMLElement>('[data-node]')
      if (!article) return
      // offsetLeft/Top ignore CSS transforms (zoom, dot scaling), so these are exact unscaled canvas offsets.
      let x = element.offsetWidth / 2; let y = element.offsetHeight / 2
      let current: HTMLElement | null = element
      while (current && current !== article) { x += current.offsetLeft; y += current.offsetTop; current = current.offsetParent as HTMLElement | null }
      if (current === article) next[element.dataset.anchor!] = { x: x + article.clientLeft, y: y + article.clientTop }
    })
    const signature = JSON.stringify(next)
    if (signature !== anchorSignatureRef.current) { anchorSignatureRef.current = signature; setAnchors(next) }
  })

  const portPoint = (node: CanvasNode, direction: 'in' | 'out', portName: string) => {
    const measured = anchors[`${node.instanceId}::${direction}::${portName}`]
    if (measured) return { x: node.x + measured.x, y: node.y + measured.y }
    const spec = specOf(node); const list = direction === 'in' ? spec.inputs : spec.outputs
    const index = Math.max(0, list.findIndex((item) => item.name === portName))
    return { x: node.x + (direction === 'in' ? 0 : nodeWidth(spec)), y: node.y + PORT_TOP + index * PORT_HEIGHT + PORT_HEIGHT / 2 }
  }

  const focusCamera = (nodeId: string) => {
    const { nodes: currentNodes, zoom: currentZoom, followRun: follow } = liveRef.current
    const node = currentNodes.find((item) => item.instanceId === nodeId)
    if (!follow || !node || !viewportRef.current) return
    const rect = viewportRef.current.getBoundingClientRect()
    const centerX = node.x + nodeWidth(specOf(node)) / 2; const centerY = node.y + 110
    window.clearTimeout(glideTimerRef.current)
    setCameraGlide(true)
    setPan({ x: rect.width * .55 - centerX * currentZoom, y: rect.height * .45 - centerY * currentZoom })
    glideTimerRef.current = window.setTimeout(() => setCameraGlide(false), 600)
  }
  const stopGlide = () => { window.clearTimeout(glideTimerRef.current); setCameraGlide(false) }
  const selectedSpec = selected ? specOf(selected) : undefined
  const chatbotFlow = nodes.some((node) => node.id.startsWith('chatbot.') || node.id === 'llm_chatbot')
  const chatLog = useMemo(() => buildChatLog(activeRun, nodes), [activeRun, nodes])

  useEffect(() => {
    const isTyping = () => { const tag = (document.activeElement?.tagName || '').toLowerCase(); return tag === 'input' || tag === 'textarea' || (document.activeElement as HTMLElement)?.isContentEditable }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && connectingRef.current) { event.preventDefault(); cancelConnection(); return }
      if ((event.key === 'Delete' || event.key === 'Backspace') && !isTyping() && selectedIds.size) {
        setNodes((current) => current.filter((item) => !selectedIds.has(item.instanceId)))
        setEdges((current) => current.filter((edge) => !selectedIds.has(edge.from) && !selectedIds.has(edge.to)))
        setSelectedIds(new Set()); setSelectedId('')
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [selectedIds])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!routeWorkflowId) {
        hydratedRef.current = true; dirtyRef.current = true; setSaveState('dirty'); return
      }
      setSaveState('loading')
      try {
        const response = await agenticApi.getWorkflow(routeWorkflowId)
        if (cancelled) return
        const workflow = response.data
        const loadedNodes = Array.isArray(workflow.graph?.nodes) ? workflow.graph.nodes : []
        const loadedEdges = Array.isArray(workflow.graph?.edges) ? workflow.graph.edges : []
        setNodes(loadedNodes); setEdges(loadedEdges); setTitle(workflow.title); setWorkflowId(workflow.id)
        setSelectedId(loadedNodes[0]?.instanceId || '')
        lastSavedRef.current = JSON.stringify({ title: workflow.title, nodes: loadedNodes, edges: loadedEdges })
        dirtyRef.current = false; hydratedRef.current = true; setSaveState('saved')
      } catch (reason: any) {
        if (!cancelled) { setError(reason?.response?.data?.detail || 'Workflow non trovato'); setSaveState('error') }
      }
    }
    load()
    return () => { cancelled = true }
  }, [routeWorkflowId])

  useEffect(() => {
    snapshotRef.current = { title, nodes, edges, workflowId }
    if (!hydratedRef.current) return
    const signature = JSON.stringify({ title, nodes, edges })
    dirtyRef.current = signature !== lastSavedRef.current
    if (dirtyRef.current) setSaveState('dirty')
  }, [title, nodes, edges, workflowId])

  saveNowRef.current = async () => {
    if (!hydratedRef.current || savingRef.current || !dirtyRef.current) return snapshotRef.current.workflowId
    savingRef.current = true; setSaveState('saving')
    const snapshot = snapshotRef.current
    const payload = { title: snapshot.title.trim() || 'Workflow senza titolo', graph: { nodes: snapshot.nodes, edges: snapshot.edges } }
    try {
      const response = snapshot.workflowId ? await agenticApi.updateWorkflow(snapshot.workflowId, payload) : await agenticApi.createWorkflow(payload)
      const id = String(response.data.id)
      if (!snapshot.workflowId) { setWorkflowId(id); navigate(`/teacher/agentic/${id}`, { replace: true }) }
      lastSavedRef.current = JSON.stringify({ title: snapshot.title, nodes: snapshot.nodes, edges: snapshot.edges })
      dirtyRef.current = false; setSaveState('saved')
      return id
    } catch (reason: any) {
      setError(reason?.response?.data?.detail || 'Salvataggio non riuscito'); setSaveState('error'); return null
    } finally { savingRef.current = false }
  }

  useEffect(() => {
    const timer = window.setInterval(() => { void saveNowRef.current() }, 1000)
    return () => window.clearInterval(timer)
  }, [])

  const grouped = useMemo(() => {
    const search = query.trim().toLowerCase()
    return Object.keys(CATEGORY_STYLE).map((category) => ({
      category,
      items: specs.filter((item) => !item.hidden && item.category === category && (!search || `${item.label} ${item.description} ${item.id}`.toLowerCase().includes(search))),
    })).filter((group) => group.items.length)
  }, [query, specs])

  // Picks the best output→input pair between two nodes: exact type first, then ANY; required inputs first,
  // free inputs only, and flow ports that already continue elsewhere are skipped (one successor per flow port).
  const bestPortPair = (source: CanvasNode, targetSpec: NodeSpec, targetId: string | null, currentEdges = edges): { from: Port; to: Port } | null => {
    const sourceSpec = specOf(source)
    const inputs = [...targetSpec.inputs].filter((port) => !targetId || !currentEdges.some((edge) => edge.to === targetId && edge.targetPort === port.name))
      .sort((a, b) => Number(b.required !== false) - Number(a.required !== false))
    const outputs = sourceSpec.outputs.filter((port) => !isFlowNode(source.id) || !isFlowNode(targetSpec.id) || !currentEdges.some((edge) => edge.from === source.instanceId && edge.sourcePort === port.name))
    for (const exact of [true, false]) {
      for (const input of inputs) {
        const output = outputs.find((port) => exact ? port.type === input.type && port.type !== 'ANY' : typesCompatible(port.type, input.type))
        if (output) return { from: output, to: input }
      }
    }
    return null
  }

  const addNode = (id: string, x?: number, y?: number, autoWire = false) => {
    const spec = specs.find((item) => item.id === id)
    if (!spec) return
    const instanceId = `${id}-${Date.now()}`
    let px = x; let py = y
    let config: Record<string, unknown> = defaults(spec)
    let newEdge: Edge | null = null
    // Double-click from the library continues the flow: the new node lands right of the selected one, already wired.
    const anchor = autoWire ? nodes.find((item) => item.instanceId === selectedId) : undefined
    if (anchor) {
      px = anchor.x + nodeWidth(specOf(anchor)) + 110; py = anchor.y
      const pair = bestPortPair(anchor, effectiveSpec(spec, config), null)
      if (pair) {
        newEdge = { id: `edge-${Date.now()}`, from: anchor.instanceId, to: instanceId, sourcePort: pair.from.name, targetPort: pair.to.name }
        const inferred = inferOutputColumns(anchor.instanceId, pair.from.name)
        if (inferred.length) config = recommendedConfig({ id, instanceId, x: 0, y: 0, status: 'idle', config }, inferred)
      }
    }
    if (px === undefined || py === undefined) {
      const rect = viewportRef.current?.getBoundingClientRect()
      px = rect ? (rect.width / 2 - pan.x) / zoom - nodeWidth(spec) / 2 : 700
      py = rect ? (rect.height / 2 - pan.y) / zoom - 80 : 500
    }
    const node: CanvasNode = { id, instanceId, x: snapValue(px, snapDots), y: snapValue(py, snapDots), status: 'idle', config }
    setNodes((current) => [...current, node]); setSelectedId(instanceId); setSelectedIds(new Set([instanceId]))
    if (newEdge) setEdges((current) => [...current, newEdge!])
  }

  const datasetColumns = (datasetId: unknown): string[] => {
    const list: Array<{ id: string; columns?: string[] }> = datasetsResponse?.data || []
    return list.find((item) => item.id === String(datasetId || ''))?.columns || []
  }
  const parseRename = (raw: unknown) => Object.fromEntries(String(raw || '').split(',').map((chunk) => chunk.split(':').map((part) => part.trim())).filter((pair) => pair.length === 2 && pair[0] && pair[1]))

  const inferOutputColumns = (nodeId: string, sourcePort?: string, visited = new Set<string>()): string[] => {
    if (visited.has(nodeId)) return []
    visited.add(nodeId)
    const output = outputs[nodeId] || activeRun?.nodes.find((item) => item.node_instance_id === nodeId)?.output
    const direct = sourcePort && output ? output[sourcePort] : output && Object.values(output).find(isTable)
    if (isTable(direct)) return direct.columns?.length ? direct.columns : Object.keys(direct.rows[0] || {})
    const node = nodes.find((item) => item.instanceId === nodeId)
    if (!node) return []
    if (node.id === 'csv.synthetic') {
      const count = ['moons', 'circles'].includes(String(node.config.kind)) ? 2 : Math.max(2, Number(node.config.features) || 2)
      return [...Array.from({ length: count }, (_, index) => `feature_${index + 1}`), 'target']
    }
    if (node.id === 'ai.generate_dataset') return String(node.config.columns || '').split(',').map((value) => value.trim()).filter(Boolean)
    if (node.id === 'data.custom_input') {
      try {
        const parsed = JSON.parse(String(node.config.data || '[]'))
        const row = Array.isArray(parsed) ? parsed[0] : parsed
        if (row && typeof row === 'object') return Object.keys(row)
      } catch { /* CSV and invalid drafts are resolved after execution. */ }
    }
    if (node.id === 'math.evaluate') return ['x', 'y']
    if (node.id === 'data.saved_dataset') return datasetColumns(node.config.dataset_id)
    const upstreamOf = (port: string) => { const edge = edges.find((item) => item.to === nodeId && item.targetPort === port); return edge ? inferOutputColumns(edge.from, edge.sourcePort, new Set(visited)) : [] }
    const upstream = edges.find((edge) => edge.to === nodeId && ['table', 'train', 'data', 'table_1'].includes(edge.targetPort))
    let names = upstream ? inferOutputColumns(upstream.from, upstream.sourcePort, visited) : []
    const csv = (value: unknown) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
    const renamed = (list: string[], raw: unknown) => { const map = parseRename(raw); return list.map((name) => map[name] || name) }
    if (node.id === 'data.merge_columns') {
      const second = upstreamOf('table_2')
      names = node.config.merge_mode === 'vertical' ? [...names, ...second] : [...names, ...second.map((name) => names.includes(name) ? `${name}_2` : name)]
    }
    if (node.id === 'data.new_table') { const chosen = csv(node.config.columns).filter((name) => names.includes(name)); names = renamed(chosen.length ? chosen : names, node.config.rename) }
    if (node.id === 'data.rename_columns') names = renamed(names, node.config.rename)
    if (node.id === 'data.compute_column') names = [...names, String(node.config.name || 'nuova_colonna')]
    if (node.id === 'nlp.sentiment') names = [...names, 'polarity', 'sentiment']
    if (node.id === 'data.group_by' && names.length) {
      const group = names.includes(String(node.config.group_column)) ? String(node.config.group_column) : names[0]
      const values = csv(node.config.value_columns).filter((name) => names.includes(name) && name !== group)
      names = node.config.aggregation === 'count' ? [group, 'conteggio'] : [group, ...(values.length ? values : names.filter((name) => name !== group))]
    }
    if (node.id === 'data.select') {
      const selected = String(node.config.columns || '').split(',').map((value) => value.trim()).filter(Boolean)
      if (selected.length) names = node.config.mode === 'exclude' ? names.filter((name) => !selected.includes(name)) : names.filter((name) => selected.includes(name))
    }
    if ((node.id === 'ml.regression' || node.id === 'ml.classification') && sourcePort === 'predictions') names = [...names, 'prediction']
    if (node.id === 'ml.predict') names = [...names, 'prediction']
    if (node.id === 'ml.kmeans_clustering') names = [...names, 'cluster']
    return [...new Set(names)]
  }

  const specOfId = (id: string) => specs.find((item) => item.id === id) || FALLBACK_SPECS.find((item) => item.id === id)
  const inputColumnsFor = (node: CanvasNode): string[] => {
    const incoming = edges.filter((edge) => edge.to === node.instanceId)
    return [...new Set(incoming.flatMap((edge) => inferOutputColumns(edge.from, edge.sourcePort)))]
  }

  const recommendedConfig = (node: CanvasNode, available = inputColumnsFor(node)) => {
    if (!available.length) return node.config
    const config = { ...node.config }
    const choose = (name: string, fallback: string) => {
      if (!available.includes(String(config[name] || ''))) config[name] = fallback
    }
    if (node.id === 'plot.2d') {
      choose('x', available[0]); choose('y', available.find((name) => name !== config.x) || available[0])
      if (config.color && !available.includes(String(config.color))) config.color = ''
    } else if (node.id === 'plot.histogram' || node.id === 'data.sort') choose('column', available[0])
    else if (node.id === 'data.group_by') choose('group_column', available[0])
    else if (node.id === 'data.filter' && (!config.expression || String(config.expression).trim() === 'x > 0')) config.expression = `${available[0]} > 0`
    else if (['nlp.clean_text', 'nlp.sentiment'].includes(node.id)) choose('column', available.find((name) => /text|testo|comment|frase|message/i.test(name)) || available[0])
    else if (['ml.regression', 'ml.classification'].includes(node.id)) {
      const target = available.includes(String(config.target_column)) ? String(config.target_column) : (available.find((name) => /target|label|class|classe|y$/i.test(name)) || available[available.length - 1])
      config.target_column = target
      const selected = String(config.feature_columns || '').split(',').filter((name) => available.includes(name) && name !== target)
      config.feature_columns = (selected.length ? selected : available.filter((name) => name !== target)).join(',')
    } else if (node.id === 'data.split' && config.stratify_column && !available.includes(String(config.stratify_column))) config.stratify_column = ''
    else if (['data.select', 'data.transform', 'data.convert_to_number', 'ml.kmeans_clustering'].includes(node.id)) {
      const selected = String(config.columns || '').split(',').filter((name) => available.includes(name))
      if (!selected.length) config.columns = available.join(',')
    }
    // Generic pass for every other column parameter: drop names that no longer exist upstream.
    for (const param of specOfId(node.id)?.params || []) {
      const value = String(config[param.name] ?? '').trim()
      if (!value) continue
      if (param.type === 'COLUMNS') config[param.name] = value.split(',').map((name) => name.trim()).filter((name) => available.includes(name)).join(',')
      else if (param.type === 'COLUMN' && !available.includes(value)) config[param.name] = param.required === false ? '' : available[0]
    }
    return config
  }
  // Column parameters pointing at columns the upstream data no longer has (shown as a one-click fix on the node).
  const staleColumns = (node: CanvasNode, available: string[]): string[] => {
    if (!available.length) return []
    return [...new Set((specOfId(node.id)?.params || []).filter((param) => param.type === 'COLUMN' || param.type === 'COLUMNS')
      .flatMap((param) => String(node.config[param.name] ?? '').split(',').map((name) => name.trim()).filter(Boolean))
      .filter((name) => !available.includes(name)))]
  }

  const isLoopEdge = (edge: Edge) => edge.sourcePort === LOOP_PORT && nodes.find((item) => item.instanceId === edge.from)?.id === LOOP_NODE
  const connectTo = (nodeId: string, port: Port) => {
    const source = connectingRef.current
    if (!source || source.nodeId === nodeId) return
    if (!typesCompatible(source.type, port.type)) {
      setError(`Connessione non valida: ${source.type} non può entrare in ${port.type}`); cancelConnection(); return
    }
    const targetNode = nodes.find((item) => item.instanceId === nodeId)
    const loopEdge = nodes.find((item) => item.instanceId === source.nodeId)?.id === LOOP_NODE && source.port === LOOP_PORT
    if (loopEdge && !(targetNode && isFlowNode(targetNode.id))) { setError('«Ripeti» può tornare solo a un nodo del chatbot (es. Domanda o Messaggio)'); cancelConnection(); return }
    // Reject edges that would close a loop (target already reaches source downstream) — except «Ripeti», which exists for that.
    const forward = edges.filter((edge) => !isLoopEdge(edge))
    const reaches = (from: string, goal: string, seen = new Set<string>()): boolean => from === goal || (!seen.has(from) && (seen.add(from), forward.some((edge) => edge.from === from && reaches(edge.to, goal, seen))))
    if (!loopEdge && reaches(nodeId, source.nodeId)) { setError('Connessione non valida: creerebbe un ciclo. Per tornare indietro usa «Ripeti» del nodo Ripeti finché'); cancelConnection(); return }
    // Flow nodes can be entered from several places (first pass + «Ripeti»); data inputs keep a single source.
    const multiEntry = !!targetNode && isFlowNode(targetNode.id)
    setEdges((current) => [...current.filter((edge) => !(edge.to === nodeId && edge.targetPort === port.name && (!multiEntry || edge.from === source.nodeId))), {
      id: `edge-${Date.now()}`, from: source.nodeId, to: nodeId, sourcePort: source.port, targetPort: port.name,
    }])
    const inferred = inferOutputColumns(source.nodeId, source.port)
    if (inferred.length) setNodes((current) => current.map((node) => node.instanceId === nodeId ? { ...node, config: recommendedConfig(node, inferred) } : node))
    connectingRef.current = null; connectStartRef.current = null; setConnecting(null); setConnectionPoint(null); setError('')
  }
  function cancelConnection() {
    connectingRef.current = null; connectStartRef.current = null; setConnecting(null); setConnectionPoint(null)
  }
  // Drop target resolution by geometry, not by the element under the cursor: the nearest input handle within
  // reach wins, so releasing slightly off a 14px dot (or over the node body/label) still connects.
  const nearestInputPort = (clientX: number, clientY: number): { nodeId: string; port: Port } | null => {
    const source = connectingRef.current
    if (!source) return null
    let best: { nodeId: string; port: Port; distance: number } | null = null
    document.querySelectorAll<HTMLElement>('[data-port-in]').forEach((element) => {
      const [nodeId, portName] = (element.dataset.portIn || '').split('::')
      if (!nodeId || nodeId === source.nodeId) return
      const node = nodes.find((item) => item.instanceId === nodeId)
      const port = node && specOf(node).inputs.find((item) => item.name === portName)
      if (!port || !typesCompatible(source.type, port.type)) return
      // Measure from the dot itself (the button spans the whole label), so the nearest dot wins.
      const rect = (element.querySelector<HTMLElement>('[data-anchor]') || element).getBoundingClientRect()
      const distance = Math.hypot(clientX - (rect.left + rect.width / 2), clientY - (rect.top + rect.height / 2))
      if (distance <= 44 && (!best || distance < best.distance)) best = { nodeId, port, distance }
    })
    return best
  }
  // Releasing on a node's body (not on a dot) wires the best free compatible input automatically.
  const nodeBodyTarget = (clientX: number, clientY: number): { nodeId: string; port: Port } | null => {
    const source = connectingRef.current
    if (!source) return null
    const nodeId = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-node]')?.dataset.node
    const node = nodeId && nodeId !== source.nodeId ? nodes.find((item) => item.instanceId === nodeId) : undefined
    if (!node) return null
    const inputs = specOf(node).inputs
    const free = inputs.filter((port) => !edges.some((edge) => edge.to === node.instanceId && edge.targetPort === port.name))
    const port = free.find((item) => item.type === source.type && item.type !== 'ANY') || free.find((item) => typesCompatible(source.type, item.type)) || inputs.find((item) => typesCompatible(source.type, item.type))
    return port ? { nodeId: node.instanceId, port } : null
  }
  const startConnection = (nodeId: string, port: Port, clientX?: number, clientY?: number) => {
    const next = { nodeId, port: port.name, type: port.type }
    connectingRef.current = next; setConnecting(next); setError('')
    connectStartRef.current = clientX === undefined || clientY === undefined ? null : { x: clientX, y: clientY, moved: false }
    const node = nodes.find((item) => item.instanceId === nodeId)
    if (node) setConnectionPoint(portPoint(node, 'out', port.name))
  }

  useEffect(() => {
    if (!connecting) return
    const move = (event: PointerEvent) => {
      const start = connectStartRef.current
      if (start && !start.moved && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) start.moved = true
    }
    const release = (event: PointerEvent) => {
      if (!connectingRef.current) return
      const target = nearestInputPort(event.clientX, event.clientY) || nodeBodyTarget(event.clientX, event.clientY)
      if (target) { connectTo(target.nodeId, target.port); return }
      // A drag that ends on nothing cancels; a plain click keeps click-to-connect mode alive.
      if (connectStartRef.current?.moved) cancelConnection()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', release)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', release) }
  })

  const nodePointerDown = (event: ReactPointerEvent, node: CanvasNode, draggable: boolean) => {
    event.stopPropagation()
    const positions: Record<string, { x: number; y: number }> = {}
    if (draggable) {
      const alreadySelected = selectedIds.has(node.instanceId)
      const idsToMove = alreadySelected && selectedIds.size > 1 ? selectedIds : new Set([node.instanceId])
      nodes.forEach((item) => { if (idsToMove.has(item.instanceId)) positions[item.instanceId] = { x: item.x, y: item.y } })
    }
    dragRef.current = { startX: event.clientX, startY: event.clientY, positions, moved: false, nodeId: node.instanceId, shiftKey: event.shiftKey }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const beginMove = (event: ReactPointerEvent, node: CanvasNode) => nodePointerDown(event, node, true)
  const backgroundPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (!target.closest('[data-canvas-background]') || !viewportRef.current) return
    if (connectingRef.current) { cancelConnection(); return }
    stopGlide()
    if (event.button === 1) {
      panRef.current = { startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y }
    } else if (event.button === 0 && event.shiftKey) {
      const rect = viewportRef.current.getBoundingClientRect()
      const worldX = (event.clientX - rect.left - pan.x) / zoom
      const worldY = (event.clientY - rect.top - pan.y) / zoom
      rubberRef.current = { startX: worldX, startY: worldY }
      setRubberBox({ x: worldX, y: worldY, w: 0, h: 0 })
    } else if (event.button === 0) {
      panRef.current = { startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y }
      backgroundClickRef.current = { x: event.clientX, y: event.clientY }
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const pointerMove = (event: ReactPointerEvent) => {
    if (!viewportRef.current) return
    const rect = viewportRef.current.getBoundingClientRect()
    if (connectingRef.current) {
      setConnectionPoint({ x: (event.clientX - rect.left - pan.x) / zoom, y: (event.clientY - rect.top - pan.y) / zoom })
    }
    if (dragRef.current) {
      const drag = dragRef.current
      const dx = (event.clientX - drag.startX) / zoom
      const dy = (event.clientY - drag.startY) / zoom
      if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 4) drag.moved = true
      // Snap the grabbed node to the grid and move the rest of the selection by the same offset,
      // so a multi-selection keeps its internal layout.
      const primary = drag.positions[drag.nodeId]
      const offsetX = primary && snapDots ? snapValue(primary.x + dx, snapDots) - primary.x : dx
      const offsetY = primary && snapDots ? snapValue(primary.y + dy, snapDots) - primary.y : dy
      setNodes((current) => current.map((node) => {
        const base = drag.positions[node.instanceId]
        return base && (node.x !== base.x + offsetX || node.y !== base.y + offsetY) ? { ...node, x: base.x + offsetX, y: base.y + offsetY } : node
      }))
    } else if (panRef.current) {
      const panStart = panRef.current
      setPan({ x: panStart.panX + (event.clientX - panStart.startX), y: panStart.panY + (event.clientY - panStart.startY) })
      if (backgroundClickRef.current && (Math.abs(event.clientX - backgroundClickRef.current.x) + Math.abs(event.clientY - backgroundClickRef.current.y) > 4)) backgroundClickRef.current = null
    } else if (rubberRef.current) {
      const start = rubberRef.current
      const worldX = (event.clientX - rect.left - pan.x) / zoom
      const worldY = (event.clientY - rect.top - pan.y) / zoom
      setRubberBox({ x: Math.min(start.startX, worldX), y: Math.min(start.startY, worldY), w: Math.abs(worldX - start.startX), h: Math.abs(worldY - start.startY) })
    }
  }
  const stopPointer = () => {
    if (dragRef.current && !dragRef.current.moved) {
      const { nodeId, shiftKey } = dragRef.current
      if (shiftKey) setSelectedIds((current) => { const next = new Set(current); next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId); return next })
      else setSelectedIds(new Set([nodeId]))
      setSelectedId(nodeId)
    }
    if (rubberRef.current && rubberBox && (rubberBox.w > 4 || rubberBox.h > 4)) {
      const ids = nodes.filter((node) => {
        const spec = specOf(node)
        const w = nodeWidth(spec)
        const h = Math.max(spec.inputs.length, spec.outputs.length) * PORT_HEIGHT + PORT_TOP + 40
        return node.x < rubberBox.x + rubberBox.w && node.x + w > rubberBox.x && node.y < rubberBox.y + rubberBox.h && node.y + h > rubberBox.y
      }).map((node) => node.instanceId)
      setSelectedIds((current) => new Set([...current, ...ids]))
    }
    if (backgroundClickRef.current) setSelectedIds(new Set())
    backgroundClickRef.current = null
    rubberRef.current = null; setRubberBox(null)
    dragRef.current = null; panRef.current = null
  }
  const zoomBy = (factor: number) => {
    if (!viewportRef.current) return
    const rect = viewportRef.current.getBoundingClientRect()
    const cx = rect.width / 2; const cy = rect.height / 2
    const newZoom = Math.min(2.5, Math.max(.15, zoom * factor))
    const worldX = (cx - pan.x) / zoom; const worldY = (cy - pan.y) / zoom
    setPan({ x: cx - worldX * newZoom, y: cy - worldY * newZoom }); setZoom(newZoom)
  }
  const wheelZoom = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault()
    if (!viewportRef.current) return
    stopGlide()
    const rect = viewportRef.current.getBoundingClientRect()
    const mouseX = event.clientX - rect.left; const mouseY = event.clientY - rect.top
    const newZoom = Math.min(2.5, Math.max(.15, zoom * (event.deltaY < 0 ? 1.08 : 1 / 1.08)))
    const worldX = (mouseX - pan.x) / zoom; const worldY = (mouseY - pan.y) / zoom
    setPan({ x: mouseX - worldX * newZoom, y: mouseY - worldY * newZoom }); setZoom(newZoom)
  }

  const persist = async () => {
    if (dirtyRef.current) return saveNowRef.current()
    return snapshotRef.current.workflowId
  }
  const save = async () => {
    setError('')
    dirtyRef.current = true
    await saveNowRef.current()
  }

  const executeOne = async (node: CanvasNode) => {
    const resolved = { ...outputs }
    const visiting = new Set<string>()
    const executeResolved = async (currentNode: CanvasNode): Promise<Record<string, unknown>> => {
      if (resolved[currentNode.instanceId]) return resolved[currentNode.instanceId]
      if (visiting.has(currentNode.instanceId)) throw new Error('Il workflow contiene una connessione ciclica')
      visiting.add(currentNode.instanceId)
      const inputValues: Record<string, unknown> = {}
      for (const edge of edges.filter((item) => item.to === currentNode.instanceId && !isLoopEdge(item))) {
        const source = nodes.find((item) => item.instanceId === edge.from)
        if (!source) throw new Error('Una connessione fa riferimento a un nodo non più presente')
        const sourceOutput = resolved[source.instanceId] || await executeResolved(source)
        inputValues[edge.targetPort] = sourceOutput[edge.sourcePort]
      }
      setNodes((current) => current.map((item) => item.instanceId === currentNode.instanceId ? { ...item, status: 'running' } : item))
      setNodeErrors((current) => ({ ...current, [currentNode.instanceId]: '' }))
      try {
        const response = await agenticApi.executeNode({ id: currentNode.id, instanceId: currentNode.instanceId, config: currentNode.config }, inputValues)
        const result = response.data.output || {}
        resolved[currentNode.instanceId] = result
        setOutputs((current) => ({ ...current, [currentNode.instanceId]: result }))
        setNodes((current) => current.map((item) => item.instanceId === currentNode.instanceId ? { ...item, status: 'complete' } : item))
        return result
      } catch (reason: any) {
        const message = reason?.response?.data?.detail || reason?.message || 'Il nodo non può essere eseguito'
        setNodeErrors((current) => ({ ...current, [currentNode.instanceId]: message }))
        setNodes((current) => current.map((item) => item.instanceId === currentNode.instanceId ? { ...item, status: 'error' } : item))
        throw reason
      } finally { visiting.delete(currentNode.instanceId) }
    }
    try {
      await executeResolved(node)
    } catch { /* The failing node already exposes its actionable error inline. */ }
  }

  const setNodeStatus = (ids: string[], status: NodeStatus) => setNodes((current) => current.map((node) => ids.includes(node.instanceId) ? { ...node, status } : node))
  // While the server is working, light up where execution starts so the canvas never looks frozen.
  const focusPending = (ids: string[]) => {
    const present = ids.filter((id) => liveRef.current.nodes.some((node) => node.instanceId === id))
    if (!present.length) return
    setNodeStatus(present, 'running'); setActiveNodeId(present[0])
    setRunTrail((current) => new Set([...current, ...present])); focusCamera(present[0])
  }
  // Replays a run step by step: each newly reached node becomes the focused one, the camera follows it and the
  // edge it came from animates. Across chatbot turns only nodes not yet shown are replayed.
  const applyRun = async (run: WorkflowRun) => {
    setActiveRun(run)
    setOutputs((current) => ({ ...current, ...Object.fromEntries(run.nodes.filter((item) => item.output).map((item) => [item.node_instance_id, item.output!])) }))
    if (replayedRef.current.runId !== run.id) {
      replayedRef.current = { runId: run.id, seen: new Set() }
      const touched = new Set(run.nodes.map((item) => item.node_instance_id))
      setNodes((current) => current.map((node) => touched.has(node.instanceId) || node.status === 'running' ? node : { ...node, status: 'idle' }))
    }
    const seen = replayedRef.current.seen
    for (const item of run.nodes) {
      if (stoppedRef.current) break
      // Loops and continuous chats revisit nodes: a new pass or a new chat turn is a new step to show.
      const key = `${item.node_instance_id}:${item.visit ?? 0}:${item.status}:${String(item.output?.turns ?? '')}`
      if (seen.has(key)) continue
      seen.add(key)
      const status: NodeStatus = item.status === 'completed' ? 'complete' : item.status === 'failed' ? 'error' : item.status === 'waiting' ? 'waiting' : item.status === 'skipped' ? 'skipped' : 'idle'
      if (status === 'skipped') { setNodeStatus([item.node_instance_id], status); continue }
      setRunTrail((current) => new Set([...current, item.node_instance_id]))
      setActiveNodeId(item.node_instance_id); focusCamera(item.node_instance_id)
      setNodeStatus([item.node_instance_id], 'running')
      await new Promise((resolve) => setTimeout(resolve, REPLAY_STEP_MS))
      if (stoppedRef.current) break
      setNodeStatus([item.node_instance_id], status)
      if (item.status === 'failed' && item.error) setNodeErrors((current) => ({ ...current, [item.node_instance_id]: String(item.error) }))
    }
    const waitingFor = run.status === 'waiting' ? String(run.output?.waiting_for || '') : ''
    if (waitingFor && !stoppedRef.current) { setActiveNodeId(waitingFor); focusCamera(waitingFor); return }
    if (!stoppedRef.current) await new Promise((resolve) => setTimeout(resolve, 450))
    setActiveNodeId(null)
  }
  const clearFocus = () => { setActiveNodeId(null); setRunTrail(new Set()) }
  const run = async () => {
    setRunning(true); setError(''); stoppedRef.current = false
    const controller = new AbortController(); abortRef.current = controller
    try {
      const chatbotFlow = nodes.some((node) => node.id.startsWith('chatbot.') || node.id === 'llm_chatbot')
      const id = await persist(); if (!id) throw new Error('Il workflow non è stato salvato')
      setRunTrail(new Set()); setNodeErrors({})
      focusPending(chatbotFlow ? dialogueEntryIds(nodes, edges) : nodes.filter((node) => !edges.some((edge) => edge.to === node.instanceId)).map((node) => node.instanceId))
      const response = await agenticApi.createRun(id, {}, chatbotFlow ? sessionId : undefined, controller.signal)
      if (chatbotFlow) setChatWindow(true)
      await applyRun(response.data)
    }
    catch (reason: any) {
      if (reason?.code !== 'ERR_CANCELED') setError(reason?.response?.data?.detail || reason?.message || 'Esecuzione non riuscita')
      setNodes((current) => current.map((node) => node.status === 'running' ? { ...node, status: 'idle' } : node)); clearFocus()
    }
    finally { setRunning(false); abortRef.current = null }
  }
  const answer = async (value?: string) => {
    const content = (value ?? chatInput).trim()
    if (!activeRun || !content) return
    setRunning(true); stoppedRef.current = false
    const controller = new AbortController(); abortRef.current = controller
    const waitingFor = String(activeRun.output?.waiting_for || '')
    // The answered question is processed first: show that immediately while the server works.
    if (waitingFor) focusPending([waitingFor])
    try { const response = await agenticApi.provideInput(activeRun.id, content, controller.signal); setChatInput(''); await applyRun(response.data) }
    catch (reason: any) {
      if (reason?.code !== 'ERR_CANCELED') setError(reason?.response?.data?.detail || 'Risposta non inviata')
      if (waitingFor) { setNodeStatus([waitingFor], 'waiting'); setActiveNodeId(waitingFor) }
    }
    finally { setRunning(false); abortRef.current = null }
  }
  const stopWorkflow = async () => {
    stoppedRef.current = true
    abortRef.current?.abort()
    setRunning(false); clearFocus()
    setNodes((current) => current.map((node) => node.status === 'running' ? { ...node, status: 'idle' } : node))
    setNodes((current) => current.map((node) => node.status === 'waiting' ? { ...node, status: 'idle' } : node))
    setError('Esecuzione interrotta')
    if (activeRun) { try { const response = await agenticApi.stopRun(activeRun.id); setActiveRun(response.data) } catch { /* best effort */ } }
  }
  const reset = () => {
    const fresh = template(specs); setNodes(fresh.nodes); setEdges(fresh.edges); setOutputs({}); setNodeErrors({}); setSelectedId('synthetic-1'); setSelectedIds(new Set(['synthetic-1'])); setActiveRun(null); clearFocus()
  }
  const clearCanvas = () => {
    setNodes([]); setEdges([]); setOutputs({}); setNodeErrors({}); setSelectedId(''); setSelectedIds(new Set()); setActiveRun(null); cancelConnection(); clearFocus()
  }
  const updateNodeParam = (nodeId: string, name: string, value: unknown) => {
    const target = nodes.find((item) => item.instanceId === nodeId)
    const base = target && specs.find((item) => item.id === target.id)
    if (target && base?.functions && name === 'function') {
      // Switching function: adopt the new function's defaults for untouched params and drop links to ports that no longer exist.
      const before = effectiveSpec(base, target.config); const nextConfig: Record<string, unknown> = { ...target.config, function: value }; const after = effectiveSpec(base, nextConfig)
      for (const param of after.params) {
        const previous = before.params.find((item) => item.name === param.name)
        const current = nextConfig[param.name]
        if (current === undefined || current === '' || (previous && current === (previous.default ?? ''))) nextConfig[param.name] = param.default ?? ''
      }
      setNodes((current) => current.map((item) => item.instanceId === nodeId ? { ...item, status: 'idle', config: nextConfig } : item))
      setEdges((current) => current.filter((edge) => (edge.to !== nodeId || after.inputs.some((port) => port.name === edge.targetPort)) && (edge.from !== nodeId || after.outputs.some((port) => port.name === edge.sourcePort))))
      setOutputs((current) => { const next = { ...current }; delete next[nodeId]; return next })
      setNodeErrors((current) => ({ ...current, [nodeId]: '' }))
      return
    }
    setNodes((current) => current.map((item) => item.instanceId === nodeId ? { ...item, status: 'idle', config: { ...item.config, [name]: value } } : item))
    setOutputs((current) => { const next = { ...current }; delete next[nodeId]; return next })
    setNodeErrors((current) => ({ ...current, [nodeId]: '' }))
  }
  const saveTableToLibrary = async (node: CanvasNode) => {
    const output = outputs[node.instanceId]
    const table = output && (Object.values(output).find(isTable) as TableValue | undefined)
    if (!table) return
    const title = window.prompt('Nome del dataset da salvare nella libreria', specOf(node).label)
    if (!title || !title.trim()) return
    try { await agenticApi.createDataset({ title: title.trim(), table }); queryClient.invalidateQueries({ queryKey: ['agentic-datasets'] }) }
    catch (reason: any) { setError(reason?.response?.data?.detail || 'Salvataggio dataset non riuscito') }
  }
  const applyTableEdit = (modal: TableModalState, table: TableValue, editor: TableEditorState) => {
    const descendants = new Set<string>()
    const pending = [modal.nodeId]
    while (pending.length) {
      const parent = pending.shift()!
      for (const edge of edges.filter((item) => item.from === parent)) {
        if (!descendants.has(edge.to)) { descendants.add(edge.to); pending.push(edge.to) }
      }
    }
    setOutputs((current) => {
      const next = { ...current, [modal.nodeId]: { ...(current[modal.nodeId] || {}), [modal.outputPort]: table } }
      descendants.forEach((nodeId) => { delete next[nodeId] })
      return next
    })
    setNodeErrors((current) => {
      const next = { ...current, [modal.nodeId]: '' }
      descendants.forEach((nodeId) => { next[nodeId] = '' })
      return next
    })
    setNodes((current) => current.map((node) => {
      if (node.instanceId === modal.nodeId) {
        const config = { ...node.config, _tableEditor: editor, ...(node.id === 'data.custom_input' ? { data: JSON.stringify(table.rows, null, 2) } : {}) }
        return { ...node, config, status: 'complete' }
      }
      return descendants.has(node.instanceId) ? { ...node, status: 'idle' } : node
    }))
    setTableModal(null)
  }

  return <div className="flex h-full min-h-0 flex-col bg-neutral-100 text-slate-900">
    <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-2">
      <button onClick={() => navigate('/teacher/agentic')} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600" title="Torna ai workflow"><ArrowLeft className="h-4 w-4" /></button>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-950 text-white"><Network className="h-5 w-5" /></div>
      <div className="min-w-0"><div className="flex items-center gap-2"><h1 className="text-sm font-black md:text-base">Dataflow Studio</h1><span className="rounded-full bg-violet-100 px-2 py-0.5 text-[9px] font-black uppercase text-violet-700">Beta</span></div><label className="mt-1 flex items-center gap-1.5"><span className="text-[9px] font-black uppercase tracking-wide text-slate-400">Nome workflow</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Workflow senza titolo" className="w-56 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100" /></label></div>
      <div className="ml-auto flex items-center gap-2"><span className={`hidden items-center gap-1.5 text-[10px] font-bold md:flex ${saveState === 'error' ? 'text-rose-600' : saveState === 'dirty' ? 'text-amber-600' : 'text-slate-400'}`}>{saveState === 'error' ? <CloudOff className="h-3.5 w-3.5" /> : <Cloud className="h-3.5 w-3.5" />}{saveState === 'saving' ? 'Salvataggio…' : saveState === 'dirty' ? 'Modifiche non salvate' : saveState === 'loading' ? 'Caricamento…' : saveState === 'error' ? 'Errore salvataggio' : 'Salvato sul server'}</span><Button onClick={clearCanvas} tone="danger" surface="outline" density="compact" className="hidden rounded-full sm:flex"><Eraser className="h-4 w-4" /> Pulisci</Button><Button onClick={reset} tone="neutral" surface="outline" density="compact" className="hidden rounded-full lg:flex"><Undo2 className="h-4 w-4" /> Template</Button><Button onClick={save} tone="neutral" surface="outline" density="compact" className="rounded-full"><Save className="h-4 w-4" /> Salva</Button><Button onClick={run} disabled={running || !nodes.length} tone="accent" surface="solid" className="rounded-full">{running ? <Activity className="h-4 w-4 animate-pulse" /> : <Play className="h-4 w-4" />} Esegui tutto</Button>{(running || activeRun?.status === 'running' || activeRun?.status === 'waiting') && <Button onClick={stopWorkflow} tone="danger" surface="solid" className="rounded-full" title="Ferma l'esecuzione del workflow"><Square className="h-3.5 w-3.5" /> Stop</Button>}</div>
    </header>
    <div className="flex min-h-0 flex-1">
      {libraryCollapsed && (
        <SidebarRail
          className="max-sm:hidden"
          label="Node library"
          expandLabel="Espandi libreria nodi"
          onExpand={() => setLibraryCollapsed(false)}
          items={grouped.map(({ category }) => {
            const CategoryIcon = CATEGORY_STYLE[category].icon
            return {
              id: category,
              title: category,
              icon: <CategoryIcon className="h-4 w-4" />,
              marker: '',
              onClick: () => {
                setLibraryCollapsed(false)
                setCollapsed((current) => { const next = new Set(current); next.delete(category); return next })
              },
            }
          })}
        />
      )}
      <aside className={`flex w-[17rem] shrink-0 flex-col border-r border-slate-200 bg-white max-sm:hidden ${libraryCollapsed ? '!hidden' : ''}`}>
        <div className="border-b border-slate-100 p-4"><div className="flex items-center justify-between"><div><p className="text-[10px] font-black uppercase tracking-[.16em] text-slate-400">Node library</p><h2 className="mt-1 text-base font-black">Primitive dataflow</h2></div><div className="flex items-center gap-1"><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-bold text-slate-500">{specs.length}</span><SidebarCollapseButton onClick={() => setLibraryCollapsed(true)} label="Comprimi libreria nodi" /></div></div><div className="relative mt-3"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca nodo o tipo" className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 text-xs outline-none" /></div></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">{grouped.map(({ category, items }) => { const style = CATEGORY_STYLE[category]; const Icon = style.icon; const shut = collapsed.has(category); return <section key={category}><button onClick={() => setCollapsed((current) => { const next = new Set(current); next.has(category) ? next.delete(category) : next.add(category); return next })} className="flex h-9 w-full items-center gap-2 rounded-lg px-2 text-[11px] font-black uppercase tracking-wider text-slate-500 hover:bg-slate-50"><span className="h-2 w-2 rounded-full" style={{ background: style.dot }} /><span className="flex-1 text-left">{category}</span><span>{items.length}</span>{shut ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</button>{!shut && <div className="space-y-1 pb-2">{items.map((item) => <button key={item.id} draggable onDragStart={(event) => event.dataTransfer.setData('application/x-dataflow-node', item.id)} onDoubleClick={() => addNode(item.id, undefined, undefined, true)} title="Trascina sul canvas, oppure doppio clic per aggiungerlo e collegarlo al nodo selezionato" className="group flex w-full items-start gap-2.5 rounded-xl border border-transparent px-2 py-2.5 text-left hover:border-slate-200 hover:bg-slate-50"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: tint(style.dot, 13), color: style.dot }}><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-bold text-slate-700">{item.label}</span><span className="block line-clamp-2 text-[10px] leading-4 text-slate-400">{item.description}</span><span className="mt-1 block truncate text-[8px] font-bold text-slate-400">{item.inputs.map((port) => port.type).join(' + ') || 'SOURCE'} → {item.outputs.map((port) => port.type).join(' + ')}</span></span><GripVertical className="mt-1 h-3.5 w-3.5 text-slate-200" /></button>)}</div>}</section> })}</div>
      </aside>

      <main className="relative min-w-0 flex-1 overflow-hidden bg-[var(--ds-canvas)]">
        <style>{DATAFLOW_CSS}</style>
        <div className="absolute left-3 top-3 z-30 flex flex-wrap items-center gap-2">
          <div className="flex rounded-full p-1 text-slate-600" style={PILL_STYLE}><button onClick={() => zoomBy(1 / 1.2)} className="p-2" title="Riduci"><ZoomOut className="h-4 w-4" /></button><span className="w-11 py-2 text-center text-[10px] font-black">{Math.round(zoom * 100)}%</span><button onClick={() => zoomBy(1.2)} className="p-2" title="Ingrandisci"><ZoomIn className="h-4 w-4" /></button><button onClick={() => { setZoom(.75); setPan({ x: 60, y: 60 }) }} className="p-2" title="Vista iniziale"><Maximize2 className="h-4 w-4" /></button></div>
          <div className="flex items-center gap-0.5 rounded-full p-1" style={PILL_STYLE} role="radiogroup" aria-label="Passo della griglia magnetica"><Grid3x3 className="ml-2 mr-1 h-4 w-4 text-slate-400" aria-hidden />{SNAP_STEPS.map((step) => <button key={step} role="radio" aria-checked={snapDots === step} onClick={() => { setSnapDots(step); writeStored('dataflow-snap', String(step)) }} title={step ? `Sposta i nodi a passi di ${step === .5 ? 'mezzo pallino' : `${step} pallin${step === 1 ? 'o' : 'i'}`}` : 'Movimento libero'} className={`h-8 min-w-8 rounded-full px-2.5 text-[10px] font-black transition-colors ${snapDots === step ? 'bg-[var(--ds-choice-surface)] text-[var(--ds-choice-ink)]' : 'text-slate-500 hover:bg-slate-100/70'}`}>{step === 0 ? 'Off' : step === .5 ? '½' : step}</button>)}</div>
          <button onClick={() => { const next = !followRun; setFollowRun(next); writeStored('dataflow-follow', next ? '1' : '0') }} aria-pressed={followRun} title="Durante l'esecuzione la vista segue il nodo attivo" style={PILL_STYLE} className="flex h-10 items-center gap-2 rounded-full pl-3.5 pr-1.5 text-[11px] font-bold text-slate-700"><Crosshair className={`h-4 w-4 ${followRun ? 'text-violet-700' : 'text-slate-400'}`} /> Segui esecuzione<span className={`relative ml-1 h-6 w-10 rounded-full transition-colors ${followRun ? 'bg-violet-700' : 'bg-slate-200'}`}><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${followRun ? 'left-[18px]' : 'left-0.5'}`} /></span></button>
        </div>
        {connecting && <div className="absolute bottom-14 left-1/2 z-30 -translate-x-1/2 rounded-full bg-slate-950 px-3 py-2 text-[10px] font-bold text-white">Da {connecting.port} ({connecting.type}) · rilascia su una porta evidenziata o sul corpo di un nodo · <kbd className="rounded bg-white/15 px-1">Esc</kbd> o <button onClick={cancelConnection} className="text-white/70 underline">annulla</button></div>}
        {selectedIds.size > 1 && <div className="absolute bottom-14 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full bg-slate-950 px-3 py-2 text-[10px] font-bold text-white"><span>{selectedIds.size} nodi selezionati</span><button onClick={() => { setNodes((current) => current.filter((item) => !selectedIds.has(item.instanceId))); setEdges((current) => current.filter((edge) => !selectedIds.has(edge.from) && !selectedIds.has(edge.to))); setSelectedIds(new Set()); setSelectedId('') }} className="flex items-center gap-1 rounded-full bg-rose-500 px-2 py-1"><Trash2 className="h-3 w-3" /> Elimina</button><button onClick={() => setSelectedIds(new Set())} className="text-white/60">annulla</button></div>}
        <div
          ref={viewportRef}
          data-canvas-background
          className={`relative h-full select-none overscroll-contain ${panRef.current ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{ backgroundImage: 'radial-gradient(circle,var(--canvas-dot) 1.2px,transparent 1.2px)', backgroundSize: `${GRID * zoom}px ${GRID * zoom}px`, backgroundPosition: `${pan.x - GRID * zoom / 2}px ${pan.y - GRID * zoom / 2}px`, transition: cameraGlide ? 'background-position .55s cubic-bezier(.2,.8,.2,1)' : undefined, touchAction: 'none' }}
          onPointerDown={backgroundPointerDown}
          onPointerMove={pointerMove}
          onPointerUp={stopPointer}
          onPointerCancel={stopPointer}
          onWheel={wheelZoom}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            const worldX = (event.clientX - rect.left - pan.x) / zoom - NODE_WIDTH / 2
            const worldY = (event.clientY - rect.top - pan.y) / zoom - 28
            addNode(event.dataTransfer.getData('application/x-dataflow-node'), worldX, worldY)
          }}
        >
          <div ref={canvasRef} data-canvas-background className="absolute left-0 top-0 origin-top-left select-none" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transition: cameraGlide ? 'transform .55s cubic-bezier(.2,.8,.2,1)' : undefined }}>
            <svg className="absolute left-0 top-0 overflow-visible" style={{ width: 1, height: 1 }}>{edges.map((edge) => {
              const from = nodes.find((node) => node.instanceId === edge.from); const to = nodes.find((node) => node.instanceId === edge.to)
              if (!from || !to) return null
              const a = portPoint(from, 'out', edge.sourcePort); const b = portPoint(to, 'in', edge.targetPort)
              const bend = Math.max(70, Math.abs(b.x - a.x) * .42)
              const loop = isLoopEdge(edge)
              // A «Ripeti» edge usually points backwards: route it as a dashed arc under the nodes instead of through them.
              const backwards = loop && b.x < a.x + 40
              const path = backwards
                ? `M${a.x},${a.y} C${a.x + 170},${a.y + 240} ${b.x - 170},${b.y + 240} ${b.x},${b.y}`
                : `M${a.x},${a.y} C${a.x + bend},${a.y} ${b.x - bend},${b.y} ${b.x},${b.y}`
              const labelY = backwards ? (a.y + b.y) / 2 + 172 : (a.y + b.y) / 2 - 7
              // Live = the edge execution just travelled to reach the focused node; traversed = already walked in this run.
              const live = activeNodeId === edge.to && runTrail.has(edge.from)
              const traversed = focusMode && runTrail.has(edge.from) && runTrail.has(edge.to)
              const accent = (CATEGORY_STYLE[specOf(to).category] || CATEGORY_STYLE.Controllo).dot
              const related = edge.from === selectedId || edge.to === selectedId
              const stroke = live ? accent : traversed ? '#525252' : related ? '#404040' : loop ? '#a78bfa' : '#b8c1ce'
              return <g key={edge.id} className="group cursor-pointer" style={{ opacity: focusMode && !live && !traversed ? .3 : 1, transition: 'opacity .35s ease' }} onClick={(event) => { event.stopPropagation(); setEdges((current) => current.filter((item) => item.id !== edge.id)) }}><title>Clic per eliminare il collegamento</title><path d={path} fill="none" stroke="transparent" strokeWidth="14" className="pointer-events-stroke" /><path d={path} fill="none" stroke={stroke} strokeWidth={live ? 3 : traversed ? 2.5 : 2} strokeLinecap="round" strokeDasharray={loop && !live ? '7 6' : undefined} className={`pointer-events-none group-hover:stroke-rose-400 ${live ? 'df-flow' : ''}`} />{live && <circle r="5" fill={accent} className="df-travel pointer-events-none"><animateMotion dur={`${REPLAY_STEP_MS}ms`} repeatCount="indefinite" path={path} /></circle>}{(!focusMode || loop) && <text x={(a.x + b.x) / 2} y={labelY} textAnchor="middle" fill={loop ? '#7c3aed' : '#a3a3a3'} fontSize={loop ? 11 : 9} fontWeight="700" className="pointer-events-none">{loop ? '↺ ripeti' : `${edge.sourcePort} → ${edge.targetPort}`}</text>}</g>
            })}{connecting && connectionPoint && (() => {
              const from = nodes.find((node) => node.instanceId === connecting.nodeId)
              if (!from) return null
              const a = portPoint(from, 'out', connecting.port)
              const bend = Math.max(60, Math.abs(connectionPoint.x - a.x) * .42)
              return <g className="pointer-events-none"><path d={`M${a.x},${a.y} C${a.x + bend},${a.y} ${connectionPoint.x - bend},${connectionPoint.y} ${connectionPoint.x},${connectionPoint.y}`} fill="none" stroke={TYPE_COLOR[connecting.type] || '#525252'} strokeWidth="2.5" strokeDasharray="7 5" /><circle cx={connectionPoint.x} cy={connectionPoint.y} r="6" fill={TYPE_COLOR[connecting.type] || '#525252'} opacity=".85" /></g>
            })()}{rubberBox && <rect x={rubberBox.x} y={rubberBox.y} width={rubberBox.w} height={rubberBox.h} fill="rgba(124,58,237,.1)" stroke="#7c3aed" strokeWidth={1.5} strokeDasharray="4 3" />}</svg>

            {nodes.map((node) => {
              const spec = specOf(node); const style = CATEGORY_STYLE[spec.category] || CATEGORY_STYLE.Controllo; const Icon = style.icon; const portRows = Math.max(spec.inputs.length, spec.outputs.length); const output = outputs[node.instanceId]
              const isSelected = selectedIds.has(node.instanceId)
              const isActive = activeNodeId === node.instanceId || node.status === 'running'
              const isWaiting = node.status === 'waiting'
              const inTrail = runTrail.has(node.instanceId)
              const dimmed = focusMode && !isActive && !isWaiting
              const available = inputColumnsFor(node)
              const stale = staleColumns(node, available)
              const outputColumns = (port: Port) => port.type === 'TABLE' ? inferOutputColumns(node.instanceId, port.name) : []
              return <article data-node={node.instanceId} key={node.instanceId} onPointerDown={(event) => nodePointerDown(event, node, false)} className="df-squircle absolute overflow-visible" style={{ ...PILL_STYLE, left: node.x, top: node.y, width: nodeWidth(spec), boxShadow: nodeBoxShadow(node.status, isSelected, style.dot, isActive), opacity: dimmed ? (inTrail ? .8 : .4) : node.status === 'skipped' ? .55 : 1, filter: dimmed && !inTrail ? 'saturate(.3)' : undefined, zIndex: isActive || isWaiting ? 20 : isSelected ? 10 : undefined, transition: 'opacity .35s ease, filter .35s ease, box-shadow .25s ease', ['--df-accent' as string]: isWaiting ? '#f59e0b' : style.dot }}>
                {(isActive || isWaiting) && <span className="df-halo df-squircle pointer-events-none absolute inset-0" />}
                {node.status === 'running' && <span className="df-running-glow df-squircle pointer-events-none absolute inset-0" />}
                {(isActive || isWaiting) && <span className="pointer-events-none absolute -top-8 left-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold text-white" style={{ background: isWaiting ? '#f59e0b' : style.dot }}>{isWaiting ? <><MessageSquareText className="h-3 w-3" /> In attesa di risposta</> : <><Activity className="h-3 w-3" /> In esecuzione</>}</span>}
                <div>
                  <div onPointerDown={(event) => beginMove(event, node)} className="df-squircle-top flex h-14 cursor-grab items-center gap-3 px-3.5 shadow-[0_1px_0_rgba(120,120,124,0.10)] active:cursor-grabbing"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: tint(style.dot, 13), color: style.dot }}><Icon className="h-[18px] w-[18px]" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-800">{spec.label}</span><span className="block truncate text-[9px] font-black uppercase tracking-wider" style={{ color: style.dot }}>{spec.category}</span></span><button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); executeOne(node) }} disabled={node.status === 'running'} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-[filter] hover:brightness-95 disabled:opacity-60" style={{ background: tint(style.dot, 13), color: style.dot }} title="Esegui solo questo nodo" aria-label="Esegui solo questo nodo">{node.status === 'running' ? <Activity className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}</button></div>

                  <div className="py-1 shadow-[0_1px_0_rgba(120,120,124,0.10)]" style={{ minHeight: portRows * PORT_HEIGHT + 8 }}>{Array.from({ length: portRows }).map((_, index) => {
                    const input = spec.inputs[index]; const outputPort = spec.outputs[index]
                    const compatible = !!connecting && !!input && connecting.nodeId !== node.instanceId && typesCompatible(connecting.type, input.type)
                    const inputLinked = !!input && edges.some((edge) => edge.to === node.instanceId && edge.targetPort === input.name)
                    const columnsOut = outputPort ? outputColumns(outputPort) : []
                    return <div key={index} className="relative flex h-7 items-center justify-between text-[9px] font-bold text-slate-500">{input ? <button data-port-in={`${node.instanceId}::${input.name}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); if (connectingRef.current) connectTo(node.instanceId, input) }} title={`${input.label} · ${input.type}${input.required === false ? ' · opzionale' : ''}`} className={`flex h-full max-w-[48%] items-center gap-1.5 pl-3 text-left transition-opacity ${connecting && !compatible ? 'opacity-30' : ''} ${compatible ? 'text-slate-900' : ''}`}><span data-anchor={`${node.instanceId}::in::${input.name}`} className={`absolute left-[-7px] top-[calc(50%-7px)] z-10 h-3.5 w-3.5 rounded-full border-2 border-white ${compatible ? 'df-port-target' : ''}`} style={{ background: inputLinked || compatible ? TYPE_COLOR[input.type] || '#737373' : '#fff', boxShadow: `0 0 0 1.5px ${TYPE_COLOR[input.type] || '#737373'}`, scale: `${Math.max(1, 1 / zoom)}` }} /><span className="truncate">{input.label}</span>{input.required === false && <span className="text-[7px] font-semibold text-slate-300">opz.</span>}<code className="text-[7px]" style={{ color: TYPE_COLOR[input.type] || '#d4d4d4' }}>{input.type}</code></button> : <span />}{outputPort ? <button onPointerDown={(event) => { event.stopPropagation(); if (event.button === 0) startConnection(node.instanceId, outputPort, event.clientX, event.clientY) }} onClick={(event) => event.stopPropagation()} title={columnsOut.length ? `${outputPort.label} · ${outputPort.type}\nColonne: ${columnsOut.join(', ')}` : `${outputPort.label} · ${outputPort.type} — trascina su un nodo per collegare`} className="flex h-full max-w-[48%] cursor-crosshair items-center justify-end gap-1.5 pr-3 text-right"><code className="text-[7px]" style={{ color: TYPE_COLOR[outputPort.type] || '#d4d4d4' }}>{outputPort.type}{columnsOut.length ? ` · ${columnsOut.length} col` : ''}</code><span className="truncate">{outputPort.label}</span><span data-anchor={`${node.instanceId}::out::${outputPort.name}`} className={`absolute right-[-7px] top-[calc(50%-7px)] z-10 h-3.5 w-3.5 rounded-full border-2 border-white ${connecting?.nodeId === node.instanceId && connecting.port === outputPort.name ? 'ring-4 ring-slate-200' : ''}`} style={{ background: TYPE_COLOR[outputPort.type] || '#262626', boxShadow: `0 0 0 1.5px ${TYPE_COLOR[outputPort.type] || '#262626'}`, scale: `${Math.max(1, 1 / zoom)}` }} /></button> : <span />}</div>
                  })}</div>

                  {stale.length > 0 && <div className="flex items-center gap-2 border-b border-amber-100 bg-amber-50 px-3 py-1.5 text-[9px] font-bold text-amber-800" onPointerDown={(event) => event.stopPropagation()}><AlertTriangle className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">Colonne non trovate: {stale.join(', ')}</span><button type="button" onClick={() => setNodes((current) => current.map((item) => item.instanceId === node.instanceId ? { ...item, status: 'idle', config: recommendedConfig(item, available) } : item))} className="shrink-0 rounded-md bg-amber-500 px-2 py-0.5 text-white hover:bg-amber-600">Correggi</button></div>}

                  {(INLINE_PARAMS[node.id] || []).length > 0 && <div className="space-y-2 p-2.5 shadow-[0_1px_0_rgba(120,120,124,0.10)]" onPointerDown={(event) => event.stopPropagation()}>{(INLINE_PARAMS[node.id] || []).map((paramName) => { const param = spec.params.find((item) => item.name === paramName); if (!param) return null; return <ParamField key={param.name} param={param} value={node.config[param.name]} suggestedOptions={['COLUMN', 'COLUMNS'].includes(param.type) ? available : undefined} onChange={(value) => updateNodeParam(node.instanceId, param.name, value)} /> })}</div>}

                  <NodePreview output={output} error={nodeErrors[node.instanceId]} nodeLabel={spec.label} onOpenTable={(outputPort, table) => setTableModal({ nodeId: node.instanceId, outputPort, nodeLabel: spec.label, table, editor: node.config._tableEditor as Partial<TableEditorState> | undefined })} onExplore={setExplorer} />
                </div>
              </article>
            })}
          </div>
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 z-20 max-w-[calc(100%-9rem)] truncate rounded-full px-4 py-2 text-[10px] text-slate-500" style={PILL_STYLE}><MousePointer2 className="mr-1 inline h-3 w-3" /> Trascina lo sfondo per spostarti · Shift+trascina per selezione multipla · rotella per zoom · doppio clic in libreria aggiunge e collega al nodo selezionato · rilascia un collegamento sul corpo di un nodo per scegliere la porta automaticamente</div>
        {chatWindow && <FloatingChatWindow chatLog={chatLog} waitingInfo={activeRun?.status === 'waiting' ? { kind: String(activeRun.output?.kind || 'text'), options: Array.isArray(activeRun.output?.options) ? activeRun.output!.options as string[] : undefined } : null} chatInput={chatInput} setChatInput={setChatInput} onSend={answer} onClose={() => setChatWindow(false)} />}

        {error && <div className="absolute bottom-14 left-1/2 z-40 flex max-w-[min(40rem,90%)] -translate-x-1/2 items-center gap-3 rounded-full bg-rose-600 px-4 py-2 text-[11px] font-bold text-white shadow-lg"><span className="min-w-0 flex-1 truncate">{error}</span><button onClick={() => setError('')} aria-label="Chiudi errore"><X className="h-3.5 w-3.5" /></button></div>}
        {chatbotFlow && !chatWindow && <Button onClick={() => setChatWindow(true)} tone="neutral" surface="solid" density="compact" className="absolute bottom-3 right-3 z-30 rounded-full"><MessageSquareText className="h-4 w-4" /> Chat test</Button>}
      </main>

      {inspectorOpen && <aside className="flex w-[19rem] shrink-0 flex-col border-l border-slate-200 bg-white max-xl:hidden"><div className="flex h-16 items-center justify-between border-b border-slate-100 px-4"><div><p className="text-[10px] font-black uppercase text-slate-400">Inspector</p><h2 className="text-sm font-black">{selectedSpec?.label || 'Nessun nodo'}</h2></div><SidebarCollapseButton side="right" onClick={() => setInspectorOpen(false)} label="Comprimi inspector" /></div>{selected && selectedSpec ? <div className="min-h-0 flex-1 overflow-y-auto p-4"><p className="mb-4 rounded-xl bg-slate-50 p-3 text-[10px] leading-4 text-slate-600">{selectedSpec.description}</p>{inputColumnsFor(selected).length > 0 && <div className="mb-4 rounded-xl border border-violet-100 bg-violet-50 p-3"><div className="flex items-center justify-between"><p className="text-[9px] font-black uppercase tracking-wider text-violet-700">Schema input rilevato</p><Button onClick={() => setNodes((current) => current.map((item) => item.instanceId === selected.instanceId ? { ...item, status: 'idle', config: recommendedConfig(item) } : item))} tone="accent" surface="solid" density="compact" className="rounded-full !h-6 !px-2.5 text-[9px]">Auto-configura</Button></div><div className="mt-2 flex flex-wrap gap-1">{inputColumnsFor(selected).map((column) => <span key={column} className="rounded-md bg-white px-2 py-1 text-[9px] font-bold text-violet-700">{column}</span>)}</div></div>}<h3 className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">{(INLINE_PARAMS[selected.id] || []).length ? 'Parametri avanzati' : 'Contenuto e parametri'}</h3><div className="space-y-3">{(() => { const advancedParams = selectedSpec.params.filter((param) => !(INLINE_PARAMS[selected.id] || []).includes(param.name)); return advancedParams.length ? advancedParams.map((param) => <ParamField key={param.name} param={param} value={selected.config[param.name]} suggestedOptions={['COLUMN', 'COLUMNS'].includes(param.type) ? inputColumnsFor(selected) : undefined} onChange={(value) => updateNodeParam(selected.instanceId, param.name, value)} />) : <p className="rounded-xl border border-dashed p-3 text-[10px] text-slate-400">{(INLINE_PARAMS[selected.id] || []).length ? 'Gli altri parametri sono modificabili direttamente sul nodo.' : 'Questo nodo usa solo gli input collegati.'}</p> })()}</div><Button onClick={() => executeOne(selected)} tone="accent" surface="solid" fullWidth className="mt-5 rounded-full"><Play className="h-4 w-4" /> Esegui questo nodo</Button>{['data.custom_input', 'csv.synthetic'].includes(selected.id) && outputs[selected.instanceId] && <Button onClick={() => saveTableToLibrary(selected)} tone="neutral" surface="outline" fullWidth className="mt-2 rounded-full"><Save className="h-4 w-4" /> Salva in libreria dataset</Button>}{nodeErrors[selected.instanceId] &&<p className="mt-2 rounded-lg bg-rose-50 p-2 text-[10px] text-rose-700">{nodeErrors[selected.instanceId]}</p>}<h3 className="mb-2 mt-6 text-[10px] font-black uppercase tracking-wider text-slate-400">Porte</h3>{[...selectedSpec.inputs.map((port) => ({ ...port, direction: 'IN' })), ...selectedSpec.outputs.map((port) => ({ ...port, direction: 'OUT' }))].map((port) => <div key={`${port.direction}-${port.name}`} className="mb-1 flex rounded-lg border border-slate-100 p-2 text-[10px]"><b className="w-9 text-slate-400">{port.direction}</b><span className="flex-1 font-bold">{port.name}</span><code className="text-violet-600">{port.type}</code></div>)}</div> : null}{selected && <Button onClick={() => { setNodes((current) => current.filter((item) => item.instanceId !== selected.instanceId)); setEdges((current) => current.filter((edge) => edge.from !== selected.instanceId && edge.to !== selected.instanceId)); setSelectedId('') }} tone="danger" surface="ghost" className="m-3 rounded-full"><Trash2 className="h-4 w-4" /> Elimina nodo</Button>}</aside>}
      {!inspectorOpen && <SidebarRail className="max-xl:hidden" side="right" label="Inspector" expandLabel="Apri inspector" onExpand={() => setInspectorOpen(true)} />}
    </div>
    {explorer && <OutputExplorerModal target={explorer} onClose={() => setExplorer(null)} onOpenTable={(label, table) => setTableModal({ nodeId: '', outputPort: '', nodeLabel: label, table, detached: true })} />}
    {tableModal && <WorkflowTableModal modal={tableModal} onClose={() => setTableModal(null)} onApply={(table, editor) => { if (tableModal.detached) setTableModal(null); else applyTableEdit(tableModal, table, editor) }} />}
  </div>
}

function NodePreview({ output, error, nodeLabel, onOpenTable, onExplore }: { output?: Record<string, unknown>; error?: string; nodeLabel: string; onOpenTable: (outputPort: string, table: TableValue) => void; onExplore: (target: ExplorerTarget) => void }) {
  if (error) return <div className="m-2 rounded-lg bg-rose-50 p-2 text-[9px] leading-4 text-rose-700">{error}</div>
  if (!output) return <div className="m-2 flex h-12 items-center justify-center rounded-lg border border-dashed border-slate-200 text-[9px] text-slate-400">▶ Esegui il nodo per vedere l’anteprima</div>
  const values = Object.values(output)
  const tableEntries = Object.entries(output).filter(([, value]) => isTable(value)) as Array<[string, TableValue]>
  const plotEntry = Object.entries(output).find(([, value]) => isPlot(value)) as [string, PlotValue] | undefined
  const artifacts = extractArtifacts(output); const showArtifacts = hasArtifacts(artifacts)
  const metrics = (output.metrics && typeof output.metrics === 'object' ? output.metrics : showArtifacts ? undefined : values.find((value) => value && typeof value === 'object' && !Array.isArray(value) && !isTable(value) && !isPlot(value))) as Record<string, unknown> | undefined
  const openMetrics = metrics ? () => onExplore({ kind: 'metrics', title: `${nodeLabel} · metriche`, metrics }) : undefined
  const [firstTable, ...otherTables] = tableEntries
  // Stop pointer events here: the node captures the pointer for dragging, which would swallow clicks on previews.
  return <div className="overflow-hidden rounded-b-[22px] [corner-shape:squircle] supports-[corner-shape:squircle]:rounded-b-[40px]" onPointerDown={(event) => event.stopPropagation()}>
    {showArtifacts && <ArtifactPreviews artifacts={artifacts} nodeLabel={nodeLabel} />}
    {plotEntry && <div className="p-2"><MiniPlot plot={plotEntry[1]} metrics={metrics} onExplore={() => onExplore({ kind: 'plot', title: plotEntry[1].title || `${nodeLabel} · grafico`, plot: plotEntry[1] })} onOpenMetrics={openMetrics} /></div>}
    {!plotEntry && metrics && <MetricCards metrics={metrics} onOpen={openMetrics} />}
    {firstTable && <MiniTable table={firstTable[1]} label={firstTable[0]} onOpen={() => onOpenTable(firstTable[0], firstTable[1])} />}
    {otherTables.length > 0 && <div className="flex flex-wrap gap-1.5 px-2 pb-2">{otherTables.map(([port, table]) => <button key={port} type="button" onClick={() => onOpenTable(port, table)} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-bold text-slate-600 hover:bg-slate-200 hover:text-slate-900"><FileSpreadsheet className="h-3 w-3" /> {port} · {table.rowCount ?? table.rows.length} righe</button>)}</div>}
    {!plotEntry && !metrics && !tableEntries.length && !showArtifacts && <button type="button" onClick={() => onExplore({ kind: 'raw', title: `${nodeLabel} · output`, value: values.length === 1 ? values[0] : output })} className="group m-2 block max-h-24 w-[calc(100%-1rem)] overflow-hidden rounded-lg bg-slate-950 p-2 text-left text-[9px] leading-4 text-slate-100" title="Apri l’output completo"><span className="mb-1 flex items-center gap-1 text-[8px] font-bold uppercase text-slate-400 group-hover:text-white"><Maximize2 className="h-3 w-3" /> Apri output</span>{formatCompact(values[0])}</button>}
  </div>
}

function MiniTable({ table, label, onOpen }: { table: TableValue; label?: string; onOpen: () => void }) {
  const columns = (table.columns?.length ? table.columns : Object.keys(table.rows[0] || {})).slice(0, 4)
  return <button type="button" onClick={(event) => { event.stopPropagation(); onOpen() }} className="group block w-full p-2 text-left" title="Apri nell'editor di tabelle"><div className="mb-1 flex justify-between text-[8px] font-bold uppercase text-slate-400"><span className="flex items-center gap-1 group-hover:text-slate-900"><FileSpreadsheet className="h-3 w-3" /> Apri {label || 'tabella'} nel foglio</span><span>{table.rowCount ?? table.rows.length} righe</span></div><div className="overflow-hidden rounded-lg border border-slate-200 transition group-hover:border-violet-300 group-hover:ring-2 group-hover:ring-violet-100"><table className="w-full table-fixed text-[8px]"><thead className="bg-slate-100"><tr>{columns.map((column) => <th key={column} className="truncate px-1.5 py-1 text-left">{column}</th>)}</tr></thead><tbody>{table.rows.slice(0, 3).map((row, index) => <tr key={index} className="border-t border-slate-100">{columns.map((column) => <td key={column} className="truncate px-1.5 py-1 text-slate-600">{formatCompact(row[column])}</td>)}</tr>)}</tbody></table></div></button>
}

function MetricCards({ metrics, onOpen }: { metrics: Record<string, unknown>; onOpen?: () => void }) {
  const labels: Record<string, string> = { clusters: 'Cluster', rows: 'Righe', inertia: 'Inerzia', silhouette: 'Silhouette', davies_bouldin: 'Davies–Bouldin', r2: 'R²', rmse: 'RMSE', mae: 'MAE', accuracy: 'Accuracy', precision: 'Precisione', recall: 'Recall', f1: 'F1', cv_mean: 'CV media' }
  const entries = Object.entries(metrics).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) || value === null).slice(0, 8)
  const cards = <div className="grid grid-cols-2 gap-1.5 p-2 sm:grid-cols-3">{entries.map(([key, value]) => <div key={key} className="rounded-lg border border-slate-100 bg-slate-50 px-2 py-1.5"><p className="truncate text-[7px] font-black uppercase tracking-wide text-slate-400">{labels[key] || key.replace(/_/g, ' ')}</p><p className="mt-0.5 truncate text-[10px] font-black text-slate-700">{formatCompact(value)}</p></div>)}</div>
  if (!onOpen) return cards
  return <button type="button" onClick={(event) => { event.stopPropagation(); onOpen() }} className="group block w-full text-left" title="Apri tutte le metriche"><span className="flex items-center gap-1 px-2 pt-2 text-[8px] font-bold uppercase text-slate-400 group-hover:text-slate-900"><Maximize2 className="h-3 w-3" /> Apri metriche</span>{cards}</button>
}

const CHART_COLORS = ['#7c3aed', '#06b6d4', '#f59e0b', '#f43f5e', '#22c55e', '#3b82f6', '#a855f7', '#737373']

function compactTick(value: unknown) {
  const number = Number(value)
  if (!Number.isFinite(number)) return String(value)
  if (Math.abs(number) >= 1000) return `${(number / 1000).toFixed(1)}k`
  return Number.isInteger(number) ? String(number) : number.toFixed(2)
}

function MiniPlot({ plot, metrics, onExplore, onOpenMetrics }: { plot: PlotValue; metrics?: Record<string, unknown>; onExplore: () => void; onOpenMetrics?: () => void }) {
  if (plot.kind === 'scatter3d') return <Mini3DPlot plot={plot} metrics={metrics} onExplore={onExplore} onOpenMetrics={onOpenMetrics} />
  const points = plot.x.map((x, index) => ({ x: Number(x), y: Number(plot.y[index]), group: String(plot.color?.[index] ?? 'Dati') })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
  const groups = [...new Set(points.map((point) => point.group))]
  const xs = points.map((point) => point.x); const ys = points.map((point) => point.y)
  const meanX = xs.reduce((sum, value) => sum + value, 0) / Math.max(1, xs.length); const meanY = ys.reduce((sum, value) => sum + value, 0) / Math.max(1, ys.length)
  const covariance = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0)
  const varianceX = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0); const varianceY = points.reduce((sum, point) => sum + (point.y - meanY) ** 2, 0)
  const correlation = varianceX && varianceY ? covariance / Math.sqrt(varianceX * varianceY) : null
  const rangeLabel = (values: number[]) => values.length ? `${compactTick(Math.min(...values))}–${compactTick(Math.max(...values))}` : '—'
  const histogram = plot.x.map((start, index) => ({ bin: `${compactTick(start)}–${compactTick(plot.xEnd?.[index] ?? plot.x[index + 1] ?? start)}`, value: Number(plot.y[index]), start: Number(start) }))
  const tooltipStyle = { borderRadius: 10, border: '1px solid #e5e5e5', fontSize: 10, boxShadow: '0 10px 25px rgba(23,23,23,.12)' }
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-3 py-2.5"><div><p className="text-[11px] font-black text-slate-800">{plot.title || (plot.kind === 'histogram' ? 'Distribuzione' : 'Grafico')}</p><p className="mt-0.5 text-[8px] font-semibold text-slate-400">{plot.labels?.x || 'x'} · {plot.labels?.y || 'y'}</p></div><span className="flex items-center gap-1.5"><span className="rounded-full bg-slate-100 px-2 py-1 text-[8px] font-black text-slate-600">{plot.kind === 'histogram' ? `${histogram.length} intervalli` : `${points.length} punti`}</span><button type="button" onClick={(event) => { event.stopPropagation(); onExplore() }} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[8px] font-black text-white hover:bg-slate-700" title="Apri explorer interattivo"><Maximize2 className="h-3 w-3" /> Esplora</button></span></div>
    <div className="grid grid-cols-3 gap-px border-b border-slate-100 bg-slate-100">{plot.kind === 'histogram' ? <><ChartStat label="Totale" value={plot.y.reduce((sum, value) => sum + Number(value || 0), 0)} /><ChartStat label="Picco" value={Math.max(0, ...plot.y.map(Number))} /><ChartStat label="Intervallo" value={rangeLabel([...(plot.x || []), ...(plot.xEnd || [])].map(Number).filter(Number.isFinite))} /></> : <><ChartStat label="Intervallo X" value={rangeLabel(xs)} /><ChartStat label="Intervallo Y" value={rangeLabel(ys)} /><ChartStat label="Correlazione" value={correlation === null ? '—' : correlation.toFixed(3)} /></>}</div>
    <div className="h-[255px] w-full cursor-zoom-in bg-slate-50/60 px-1 pb-1 pt-3" onDoubleClick={onExplore} title="Doppio clic per aprire l’explorer">{plot.kind === 'histogram' ? <ResponsiveContainer width="100%" height="100%"><BarChart data={histogram} margin={{ top: 5, right: 12, bottom: 36, left: 4 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" /><XAxis dataKey="bin" interval="preserveStartEnd" angle={-28} textAnchor="end" tick={{ fontSize: 8, fill: '#737373' }} label={{ value: plot.labels?.x || 'Valore', position: 'insideBottom', offset: -28, fontSize: 9, fill: '#525252' }} /><YAxis allowDecimals={false} tick={{ fontSize: 8, fill: '#737373' }} width={34} label={{ value: plot.labels?.y || 'Conteggio', angle: -90, position: 'insideLeft', fontSize: 9, fill: '#525252' }} /><Tooltip contentStyle={tooltipStyle} formatter={(value) => [value, 'Conteggio']} labelFormatter={(label) => `Intervallo ${label}`} /><Bar dataKey="value" name="Conteggio" radius={[4, 4, 0, 0]}>{histogram.map((_entry, index) => <Cell key={index} fill={CHART_COLORS[index % 2]} />)}</Bar></BarChart></ResponsiveContainer> : <ResponsiveContainer width="100%" height="100%"><ScatterChart margin={{ top: 5, right: 15, bottom: 28, left: 2 }}><CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" /><XAxis type="number" dataKey="x" name={plot.labels?.x || 'x'} tickFormatter={compactTick} tick={{ fontSize: 8, fill: '#737373' }} label={{ value: plot.labels?.x || 'x', position: 'insideBottom', offset: -18, fontSize: 9, fill: '#525252' }} /><YAxis type="number" dataKey="y" name={plot.labels?.y || 'y'} tickFormatter={compactTick} tick={{ fontSize: 8, fill: '#737373' }} width={42} label={{ value: plot.labels?.y || 'y', angle: -90, position: 'insideLeft', fontSize: 9, fill: '#525252' }} /><Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={tooltipStyle} formatter={(value, name) => [compactTick(value), name]} />{groups.length > 1 && <Legend wrapperStyle={{ fontSize: 9, paddingTop: 6 }} />}{groups.map((group, index) => <Scatter key={group} name={group} data={points.filter((point) => point.group === group)} fill={CHART_COLORS[index % CHART_COLORS.length]} />)}</ScatterChart></ResponsiveContainer>}</div>
    {metrics && <MetricCards metrics={metrics} onOpen={onOpenMetrics} />}
  </div>
}

function ChartStat({ label, value }: { label: string; value: unknown }) {
  return <div className="bg-white px-2 py-1.5 text-center"><p className="text-[7px] font-black uppercase tracking-wide text-slate-400">{label}</p><p className="mt-0.5 truncate text-[9px] font-black text-slate-700">{formatCompact(value)}</p></div>
}

const Plot3D = lazy(() => import('react-plotly.js'))

function Mini3DPlot({ plot, metrics, onExplore, onOpenMetrics }: { plot: PlotValue; metrics?: Record<string, unknown>; onExplore: () => void; onOpenMetrics?: () => void }) {
  const groups = plot.color ? [...new Set(plot.color.map((value) => String(value)))] : []
  const traces = groups.length > 1
    ? groups.map((group, index) => {
        const indices = plot.color!.map((value, i) => String(value) === group ? i : -1).filter((i) => i >= 0)
        return { type: 'scatter3d', mode: 'markers', name: group,
          x: indices.map((i) => plot.x[i]), y: indices.map((i) => plot.y[i]), z: indices.map((i) => plot.z?.[i]),
          marker: { size: 4, color: CHART_COLORS[index % CHART_COLORS.length], opacity: .85 } }
      })
    : [{ type: 'scatter3d', mode: 'markers', name: 'Dati', x: plot.x, y: plot.y, z: plot.z,
        marker: { size: 4, color: plot.z, colorscale: 'Viridis', opacity: .85, showscale: true } }]
  return <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-3 py-2.5"><div><p className="text-[11px] font-black text-slate-800">{plot.title || 'Grafico 3D'}</p><p className="mt-0.5 text-[8px] font-semibold text-slate-400">{plot.labels?.x || 'x'} · {plot.labels?.y || 'y'} · {plot.labels?.z || 'z'}</p></div><span className="flex items-center gap-1.5"><span className="rounded-full bg-slate-100 px-2 py-1 text-[8px] font-black text-slate-600">{plot.x.length} punti</span><button type="button" onClick={(event) => { event.stopPropagation(); onExplore() }} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-900 px-2.5 py-1 text-[8px] font-black text-white hover:bg-slate-700" title="Apri explorer interattivo"><Maximize2 className="h-3 w-3" /> Esplora</button></span></div>
    <div className="h-[280px] w-full bg-slate-50/60" onPointerDown={(event) => event.stopPropagation()}>
      <Suspense fallback={<div className="flex h-full items-center justify-center text-[10px] text-slate-400">Caricamento vista 3D…</div>}>
        <Plot3D
          data={traces as any}
          layout={{ autosize: true, margin: { l: 0, r: 0, t: 0, b: 0 }, paper_bgcolor: 'rgba(0,0,0,0)',
            scene: { xaxis: { title: plot.labels?.x || 'x' }, yaxis: { title: plot.labels?.y || 'y' }, zaxis: { title: plot.labels?.z || 'z' } },
            showlegend: groups.length > 1, legend: { font: { size: 9 } } } as any}
          config={{ displaylogo: false, responsive: true }}
          style={{ width: '100%', height: '100%' }}
          useResizeHandler
        />
      </Suspense>
    </div>
    {metrics && <MetricCards metrics={metrics} onOpen={onOpenMetrics} />}
  </div>
}

const DEFAULT_TABLE_CHART: SheetChartConfig = { type: 'line', title: 'Grafico tabella', xCol: 0, yCol: 1, showRegression: true }

function tableToGrid(table: TableValue): string[][] {
  const columns = table.columns?.length ? table.columns : Object.keys(table.rows[0] || {})
  return [columns, ...table.rows.map((row) => columns.map((column) => {
    const value = row[column]
    if (value === null || value === undefined) return ''
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  }))]
}

function parseGridValue(value: string): unknown {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^(true|false)$/i.test(trimmed)) return trimmed.toLowerCase() === 'true'
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(trimmed) && !/^-?0\d+/.test(trimmed)) return Number(trimmed)
  return value
}

function gridToTable(grid: string[][], originalColumns: string[]): TableValue {
  let lastColumn = Math.max(0, originalColumns.length - 1)
  let lastRow = 0
  grid.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
    if (String(cell ?? '').trim()) { lastColumn = Math.max(lastColumn, columnIndex); lastRow = Math.max(lastRow, rowIndex) }
  }))
  const used = new Set<string>()
  const columns = Array.from({ length: lastColumn + 1 }, (_, index) => {
    const preferred = String(grid[0]?.[index] || originalColumns[index] || `colonna_${index + 1}`).trim() || `colonna_${index + 1}`
    let name = preferred; let suffix = 2
    while (used.has(name)) name = `${preferred}_${suffix++}`
    used.add(name); return name
  })
  const rows = grid.slice(1, lastRow + 1).filter((row) => row.slice(0, columns.length).some((cell) => String(cell ?? '').trim())).map((row) => Object.fromEntries(columns.map((column, index) => [column, parseGridValue(String(row[index] ?? ''))])))
  return { columns, rows, rowCount: rows.length }
}

function WorkflowTableModal({ modal, onClose, onApply }: { modal: TableModalState; onClose: () => void; onApply: (table: TableValue, editor: TableEditorState) => void }) {
  const originalColumns = modal.table.columns?.length ? modal.table.columns : Object.keys(modal.table.rows[0] || {})
  const [data, setData] = useState<string[][]>(() => tableToGrid(modal.table))
  const [chart, setChart] = useState<SheetChartConfig>(() => modal.editor?.chart || DEFAULT_TABLE_CHART)
  const [styles, setStyles] = useState<SheetCellStyles>(() => modal.editor?.styles || {})
  const [dimensions, setDimensions] = useState<SheetDimensions>(() => modal.editor?.dimensions || { columnWidths: [], rowHeights: [] })
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose])
  return <div data-modal-stack className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-950/60 p-2 backdrop-blur-sm md:p-5" role="dialog" aria-modal="true" aria-label={`Editor tabella ${modal.nodeLabel}`} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="flex h-[96vh] w-[98vw] max-w-[1800px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-neutral-100 shadow-2xl">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-100 text-cyan-700"><FileSpreadsheet className="h-5 w-5" /></span><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-black">{modal.nodeLabel} · Editor tabella</h2><p className="text-[10px] text-slate-500">{modal.table.rowCount ?? modal.table.rows.length} righe · {modal.detached ? 'vista di esplorazione, le modifiche non tornano al nodo' : 'modifiche applicate all’output corrente del nodo'}</p></div><button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-100" aria-label="Chiudi"><X className="h-4 w-4" /></button></header>
      <div className="min-h-0 flex-1 overflow-auto p-3"><SpreadsheetEditor data={data} onDataChange={setData} chartConfig={chart} onChartConfigChange={setChart} styles={styles} onStylesChange={setStyles} dimensions={dimensions} onDimensionsChange={setDimensions} /></div>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3"><p className="hidden text-[10px] text-slate-500 md:block">Se il nodo viene rieseguito, il risultato sarà calcolato nuovamente. Stili, grafico e dimensioni vengono salvati nel workflow.</p><div className="ml-auto flex gap-2"><Button type="button" onClick={onClose} tone="neutral" surface="outline" className="rounded-full">{modal.detached ? 'Chiudi' : 'Annulla'}</Button>{!modal.detached && <Button type="button" onClick={() => onApply(gridToTable(data, originalColumns), { chart, styles, dimensions })} tone="accent" surface="solid" className="rounded-full">Applica al nodo</Button>}</div></footer>
    </div>
  </div>
}

function ParamField({ param, value, suggestedOptions, onChange }: { param: Param; value: unknown; suggestedOptions?: string[]; onChange: (value: unknown) => void }) {
  const cls = 'h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-violet-300'
  const selected = String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
  const toggleColumn = (column: string) => onChange((selected.includes(column) ? selected.filter((item) => item !== column) : [...selected, column]).join(','))
  const readFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return
    const reader = new FileReader()
    reader.onload = () => onChange(String(reader.result || ''))
    reader.readAsText(file)
    event.target.value = ''
  }
  return <label className="block"><span className="mb-1 block text-[10px] font-bold text-slate-500">{param.label}</span>{param.type === 'BOOLEAN' ? <button type="button" onClick={() => onChange(!value)} className={`${cls} text-left font-bold`}>{value ? 'Attivo' : 'Disattivo'}</button> : param.type === 'SELECT' ? <select value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} className={cls}>{param.options?.map((option) => <option key={option} value={option}>{param.optionLabels?.[option] ?? option}</option>)}</select> : param.type === 'DATASET' ? <DatasetPicker value={String(value ?? '')} onChange={onChange} /> : param.type === 'COLUMN' && suggestedOptions?.length ? <select value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} className={cls}><option value="">{param.required === false ? 'Nessuna' : 'Seleziona una colonna'}</option>{suggestedOptions.map((option) => <option key={option} value={option}>{option}</option>)}</select> : param.type === 'COLUMNS' && suggestedOptions?.length ? <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-2">{suggestedOptions.map((option) => <button key={option} type="button" onClick={() => toggleColumn(option)} className={`rounded-full px-2 py-1 text-[9px] font-bold ${selected.includes(option) ? 'bg-violet-600 text-white' : 'bg-white text-slate-600'}`}>{option}</button>)}</div> : param.type === 'CODE' ? <div className="space-y-1"><textarea value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} rows={5} className={`${cls} h-auto py-2 font-mono`} /><label className="inline-flex cursor-pointer items-center gap-1 text-[9px] font-bold text-violet-600 hover:text-violet-700"><Paperclip className="h-3 w-3" /> Carica file (CSV/JSON/testo)<input type="file" accept=".csv,.json,.txt" onChange={readFile} className="hidden" /></label></div> : <input type={['NUMBER', 'INTEGER', 'SLIDER'].includes(param.type) ? 'number' : 'text'} min={param.min} max={param.max} step={param.step || (param.type === 'INTEGER' ? 1 : 'any')} value={String(value ?? '')} onChange={(event) => onChange(['NUMBER', 'INTEGER', 'SLIDER'].includes(param.type) ? Number(event.target.value) : event.target.value)} className={cls} />}</label>
}

function DatasetPicker({ value, onChange }: { value: string; onChange: (value: unknown) => void }) {
  const { data, isLoading } = useQuery({ queryKey: ['agentic-datasets'], queryFn: () => agenticApi.listDatasets(), staleTime: 15_000 })
  const datasets: Array<{ id: string; title: string; row_count: number; source: string }> = data?.data || []
  const cls = 'h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs outline-none focus:border-violet-300'
  if (isLoading) return <div className={`${cls} flex items-center text-slate-400`}>Caricamento libreria…</div>
  if (!datasets.length) return <p className="rounded-xl border border-dashed border-slate-200 p-2 text-[10px] text-slate-400">Nessun dataset salvato: generane uno con AI o carica un CSV per popolare la libreria.</p>
  return <select value={value} onChange={(event) => onChange(event.target.value)} className={cls}>
    <option value="">Seleziona un dataset…</option>
    {datasets.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.row_count} righe{item.source === 'ai' ? ' · AI' : ''}</option>)}
  </select>
}

function FloatingChatWindow({ chatLog, waitingInfo, chatInput, setChatInput, onSend, onClose }: { chatLog: ChatEntry[]; waitingInfo: { kind: string; options?: string[] } | null; chatInput: string; setChatInput: (value: string) => void; onSend: (value?: string) => void; onClose: () => void }) {
  const [pos, setPos] = useState({ x: 70, y: 90 })
  const [size, setSize] = useState({ w: 340, h: 460 })
  const [minimized, setMinimized] = useState(false)
  const dragRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null)
  const resizeRef = useRef<{ startX: number; startY: number; w: number; h: number } | null>(null)
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }) }, [chatLog.length])
  const onHeaderDown = (event: ReactPointerEvent) => { dragRef.current = { startX: event.clientX, startY: event.clientY, posX: pos.x, posY: pos.y }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) }
  const onResizeDown = (event: ReactPointerEvent) => { event.stopPropagation(); resizeRef.current = { startX: event.clientX, startY: event.clientY, w: size.w, h: size.h }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) }
  const onMove = (event: ReactPointerEvent) => {
    if (dragRef.current) { const drag = dragRef.current; setPos({ x: drag.posX + (event.clientX - drag.startX), y: drag.posY + (event.clientY - drag.startY) }) }
    if (resizeRef.current) { const resize = resizeRef.current; setSize({ w: Math.max(280, resize.w + (event.clientX - resize.startX)), h: Math.max(320, resize.h + (event.clientY - resize.startY)) }) }
  }
  const onUp = () => { dragRef.current = null; resizeRef.current = null }
  if (minimized) return <button onClick={() => setMinimized(false)} className="absolute z-50 flex h-14 w-14 items-center justify-center rounded-full bg-violet-600 text-white shadow-2xl" style={{ left: pos.x, top: pos.y }} title="Riapri test chatbot">
    <MessageSquareText className="h-6 w-6" />
    {waitingInfo && <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white bg-amber-400" />}
  </button>
  return <div className="absolute z-50 flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl" style={{ left: pos.x, top: pos.y, width: size.w, height: size.h }} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
    <div onPointerDown={onHeaderDown} className="flex shrink-0 cursor-grab items-center gap-2 bg-violet-600 px-3 py-2.5 text-white active:cursor-grabbing">
      <MessageSquareText className="h-4 w-4" /><p className="flex-1 text-xs font-black">Test chatbot</p><button onPointerDown={(event) => event.stopPropagation()} onClick={() => setMinimized(true)} title="Riduci a icona"><Minus className="h-4 w-4" /></button><button onPointerDown={(event) => event.stopPropagation()} onClick={onClose}><X className="h-4 w-4" /></button>
    </div>
    <div ref={logRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
      {chatLog.length === 0 && <p className="text-xs text-slate-400">In attesa dell'esecuzione del workflow…</p>}
      {chatLog.map((entry, index) => <div key={index} className={`flex ${entry.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`${entry.artifacts ? 'w-[80%]' : 'max-w-[80%]'} rounded-2xl px-3 py-2 text-xs ${entry.role === 'user' ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-800'}`}>{entry.label && <p className="mb-1 text-[9px] font-black uppercase tracking-wider text-slate-400">{entry.label}</p>}{entry.artifacts && <div className="-m-2"><ArtifactPreviews artifacts={entry.artifacts} nodeLabel={entry.label || 'Risultato'} /></div>}{entry.role === 'bot' ? entry.text && <ReactMarkdown remarkPlugins={[remarkGfm]} className="chat-markdown prose prose-xs max-w-none prose-p:my-1 prose-headings:my-1.5 prose-ul:my-1 prose-ol:my-1" components={markdownCodeComponents()}>{entry.text}</ReactMarkdown> : entry.text}</div></div>)}
    </div>
    {waitingInfo && waitingInfo.kind === 'choice' && waitingInfo.options?.length ? <div className="flex shrink-0 flex-wrap gap-2 border-t border-amber-100 bg-amber-50 p-3">{waitingInfo.options.map((option, index) => <Button key={index} onClick={() => onSend(option)} surface="solid" density="compact" className="rounded-full bg-amber-500 text-white hover:bg-amber-600">{option}</Button>)}</div> : waitingInfo ? <div className="flex shrink-0 gap-2 border-t border-amber-100 bg-amber-50 p-2"><input value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') onSend() }} placeholder="Scrivi come farebbe uno studente" className="h-9 flex-1 rounded-full border border-amber-200 px-3 text-xs" autoFocus /><Button onClick={() => onSend()} surface="solid" density="compact" className="rounded-full bg-amber-500 text-white hover:bg-amber-600">Invia</Button></div> : null}
    <div onPointerDown={onResizeDown} className="absolute bottom-1 right-1 h-4 w-4 cursor-nwse-resize"><svg viewBox="0 0 16 16" className="h-4 w-4 text-slate-300"><path d="M14 14L2 14M14 14L14 2M14 14L7 14M14 14L14 7" stroke="currentColor" strokeWidth="1.5" /></svg></div>
  </div>
}

type ChatEntry = { role: 'bot' | 'user'; text: string; artifacts?: NodeArtifacts; label?: string }

function buildChatLog(run: WorkflowRun | null, nodes: CanvasNode[]): ChatEntry[] {
  if (!run) return []
  const log: ChatEntry[] = []
  for (const item of run.nodes) {
    if (item.status === 'idle' || item.status === 'skipped') continue
    const node = nodes.find((candidate) => candidate.instanceId === item.node_instance_id)
    if (!node) continue
    const output = item.output || {}
    if (node.id === 'chatbot.start') { const welcome = String(node.config.welcome_message ?? '').trim(); if (welcome) log.push({ role: 'bot', text: welcome }) }
    else if (node.id === 'chatbot.say') log.push({ role: 'bot', text: String(output.message ?? node.config.message ?? '') })
    else if (node.id === 'llm_chatbot' && Array.isArray(output.history)) (output.history as Array<{ role: string; content: string }>).forEach((turn) => log.push({ role: turn.role === 'user' ? 'user' : 'bot', text: String(turn.content ?? '') }))
    else if (node.id === 'llm_chatbot') { const payload = output.response as { message?: string } | undefined; if (payload?.message) log.push({ role: 'bot', text: payload.message }) }
    else if (node.id === 'chatbot.end') log.push({ role: 'bot', text: String(node.config.message ?? output.result ?? '') })
    else if (node.id === 'chatbot.ask') {
      log.push({ role: 'bot', text: String(node.config.question ?? '') })
      if (item.status === 'completed' && output.response !== undefined) log.push({ role: 'user', text: String(output.response) })
    } else if (node.id === 'chatbot.multi_choice') {
      log.push({ role: 'bot', text: String(node.config.question ?? '') })
      if (item.status === 'completed') {
        const chosen = ['choice_1', 'choice_2', 'choice_3', 'choice_4'].findIndex((port) => output[port])
        if (chosen >= 0) log.push({ role: 'user', text: String(node.config[`option_${chosen + 1}`] ?? '') })
      }
    } else if (node.id === 'chatbot.yes_no' && item.status === 'completed') {
      log.push({ role: 'user', text: output.yes !== undefined && output.yes !== null ? 'Sì' : 'No' })
    }
    // Any other node (image generation, documents, AI transforms…) that produced something visible is shown in the chat too.
    if (item.status === 'completed' && !isChatNode(node.id)) {
      const artifacts = extractArtifacts(output)
      const text = node.id === 'ai.transform' && typeof output.text === 'string' && !output.table && !output.slides ? output.text : ''
      if (hasArtifacts(artifacts) || text) log.push({ role: 'bot', text, label: item.label, artifacts: hasArtifacts(artifacts) ? artifacts : undefined })
    }
  }
  return log
}

