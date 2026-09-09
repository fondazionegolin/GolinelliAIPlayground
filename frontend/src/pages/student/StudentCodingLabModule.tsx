import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { EditorView } from '@codemirror/view'
import CodeMirror from '@uiw/react-codemirror'
import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight,
  Bot,
  Brush,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Code2,
  Download,
  Eye,
  FileCode2,
  HelpCircle,
  Lightbulb,
  ListChecks,
  Loader2,
  Maximize2,
  MessageSquare,
  MonitorPlay,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Paperclip,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Share2,
  Sparkles,
  Smartphone,
  Wand2,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { codingApi, llmApi } from '@/lib/api'
import { editorKeymap, getEditorExtensions } from '@/components/notebook/editorConfig'
import { Button } from '@/components/ui/button'
import DesignSystemStudio from '@/components/coding/DesignSystemStudio'
import CodingSandpackPreview, { type SandpackRuntimeError } from '@/components/coding/CodingSandpackPreview'
import {
  WorkspaceExplorerBadge,
  WorkspaceExplorerHeader,
  WorkspaceExplorerItem,
  WorkspaceExplorerList,
  WorkspaceExplorerSidebar,
} from '@/components/WorkspaceExplorerSidebar'

// Compact markdown renderer for the agent's reasoning (headings, lists, bold, inline code).
// `dark` renders light text in a Courier monospace face for the live generation console.
function ReasoningMarkdown({ children, dark = false }: { children: string; dark?: boolean }) {
  return (
    <div
      className={`prose prose-sm max-w-none text-sm leading-relaxed [&_code]:rounded [&_code]:px-1 [&_h1]:mb-1 [&_h1]:mt-2 [&_h1]:text-base [&_h2]:mb-1 [&_h2]:mt-2 [&_h2]:text-base [&_h3]:mb-1 [&_h3]:mt-1.5 [&_h3]:text-sm [&_li]:my-0.5 [&_ol]:my-1 [&_ol]:pl-4 [&_p]:my-1 [&_strong]:font-bold [&_ul]:my-1 [&_ul]:pl-4 ${
        dark
          ? 'prose-invert font-code [&_code]:bg-white/10'
          : 'prose-slate [&_code]:bg-black/5'
      }`}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  )
}

type CodingProject = {
  id: string
  title: string
  slug: string
  template_key: string
  status: string
  visibility: string
  owner_display_name?: string | null
  owner_kind?: string | null
  is_owned_by_current_user?: boolean
  current_version_id?: string | null
  created_at: string
  updated_at: string
}

type CodingMessage = {
  id: string
  actor_type: string
  agent_name?: string | null
  role: string
  content: string
  metadata_json?: Record<string, unknown>
  created_at: string
}

type CodingVersion = {
  id: string
  version_number: number
  source_manifest_json?: {
    files?: GeneratedFile[]
    summary?: string
    collaboration?: {
      source_project_id?: string
      source_version_id?: string
      creator_student_id?: string | null
      forked_by_student_id?: string
    }
  }
  build_status: string
  review_status: string
  created_at: string
}

type CodingProjectDetail = CodingProject & {
  messages: CodingMessage[]
  versions: CodingVersion[]
}

type GeneratedFile = {
  path: string
  content: string
  language?: string
}

type CodingCommit = {
  id: string
  content: string
  status: string
  contributor_name: string
  files: GeneratedFile[]
  summary?: {
    total_lines?: number
    added?: number
    modified?: number
    removed?: number
  }
  created_at: string
}

type UpstreamStatus = {
  is_fork: boolean
  update_available: boolean
  source_project_id?: string
  source_title?: string
  source_version_id?: string
  source_version_number?: number
  known_source_version_id?: string
  file_count?: number
  total_lines?: number
  summary?: string
  source_missing?: boolean
}

type PreviewApiRequest = {
  source?: 'golinelli-coding-preview'
  id?: string
  action?: 'chat' | 'generateImage' | 'saveData' | 'loadData' | 'deleteData' | 'askAgent' | 'openExternalLink'
  payload?: Record<string, unknown>
}

type InterviewQuestion = { question: string; suggestions: string[] }
type ModelProvider = 'anthropic' | 'openai' | 'deepseek'
type ModelOption = { key: string; label: string; hint: string; provider: ModelProvider }

// Selectable generation models. Keys must match CODING_MODEL_CHOICES on the backend.
const MODEL_OPTIONS: ModelOption[] = [
  { key: 'sonnet', label: 'Sonnet 4.6', hint: 'Massima qualità', provider: 'anthropic' },
  { key: 'haiku', label: 'Haiku 4.5', hint: 'Più veloce', provider: 'anthropic' },
  { key: 'luna', label: 'GPT-5.6 Luna', hint: 'Veloce ed economico', provider: 'openai' },
  { key: 'deepseek-flash', label: 'DeepSeek V4 Flash', hint: 'Veloce ed economico', provider: 'deepseek' },
  { key: 'deepseek-pro', label: 'DeepSeek V4 Pro', hint: 'Qualità elevata', provider: 'deepseek' },
]
// Claude models are temporarily disabled for students: they may only generate with DeepSeek.
// (Backend enforces the same restriction in CODING_MODEL_CHOICES / _resolve_coding_model.)
const STUDENT_MODEL_KEYS = new Set(['deepseek-flash', 'deepseek-pro'])
const TEACHER_DEFAULT_MODEL_KEY = 'sonnet'
const STUDENT_DEFAULT_MODEL_KEY = 'deepseek-flash'
const STUDENT_FLASH_DEFAULT_MIGRATION_KEY = 'coding_student_flash_default_v1'
const PROJECT_MODEL_DATA_KEY = '_golinelli_generation_model'
function modelOptionsFor(isTeacher: boolean) {
  return isTeacher ? MODEL_OPTIONS : MODEL_OPTIONS.filter((option) => STUDENT_MODEL_KEYS.has(option.key))
}
function initialModelKey(isTeacher: boolean): string {
  const fallback = isTeacher ? TEACHER_DEFAULT_MODEL_KEY : STUDENT_DEFAULT_MODEL_KEY
  const stored = localStorage.getItem('coding_model_key') || ''
  if (!isTeacher && stored === 'deepseek-pro' && localStorage.getItem(STUDENT_FLASH_DEFAULT_MIGRATION_KEY) !== '1') {
    localStorage.setItem(STUDENT_FLASH_DEFAULT_MIGRATION_KEY, '1')
    localStorage.setItem('coding_model_key', STUDENT_DEFAULT_MODEL_KEY)
    return STUDENT_DEFAULT_MODEL_KEY
  }
  return modelOptionsFor(isTeacher).some((option) => option.key === stored) ? stored : fallback
}

const MODEL_PROVIDER_ASSETS: Record<ModelProvider, { src: string; alt: string }> = {
  anthropic: { src: '/icone_ai/anthropic.svg', alt: 'Anthropic' },
  openai: { src: '/icone_ai/OpenAI_logo_2025_(symbol).svg.png', alt: 'OpenAI' },
  deepseek: { src: '/icone_ai/deepseek-logo-icon.svg', alt: 'DeepSeek' },
}

function ModelProviderIcon({ provider, className = 'h-4 w-4' }: { provider: ModelProvider; className?: string }) {
  const asset = MODEL_PROVIDER_ASSETS[provider]
  return <img src={asset.src} alt={asset.alt} className={`${className} shrink-0 object-contain`} />
}

function CodingModelSelector({
  value,
  options,
  onChange,
  compact = false,
}: {
  value: string
  options: ModelOption[]
  onChange: (value: string) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.key === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  if (!selected) return null

  return (
    <div ref={rootRef} className={compact ? 'relative inline-block shrink-0' : 'relative min-w-0 flex-1'}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`${compact ? 'h-7 w-auto max-w-[190px] rounded-full px-2.5 text-xs' : 'h-11 w-full rounded-xl px-3 text-sm'} flex items-center gap-1.5 border border-[var(--logo-violet-22)] bg-[var(--logo-violet-10)] font-semibold text-[var(--logo-violet-strong)] outline-none transition hover:border-[var(--logo-violet)] focus-visible:ring-2 focus-visible:ring-[var(--logo-violet-22)]`}
        aria-haspopup="listbox"
        aria-expanded={open}
        title="Modello usato per generare il codice"
      >
        <ModelProviderIcon provider={selected.provider} className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        <span className="min-w-0 flex-1 truncate text-left">{compact ? selected.label : `${selected.label} · ${selected.hint}`}</span>
        <ChevronDown className={`${compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Seleziona il modello"
          className={`${compact ? 'bottom-full right-0 mb-2' : 'top-full left-0 mt-2'} absolute z-50 w-full min-w-[17rem] overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-white p-1.5 shadow-[var(--shadow-lg)]`}
        >
          {options.map((option) => {
            const active = option.key === selected.key
            return (
              <button
                key={option.key}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.key)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${active ? 'bg-[var(--logo-violet-10)] text-[var(--logo-violet-strong)]' : 'text-[var(--text-primary)] hover:bg-[var(--surface-subtle)]'}`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[color:var(--border-subtle)] bg-white">
                  <ModelProviderIcon provider={option.provider} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{option.label}</span>
                  <span className="block truncate text-xs text-[var(--text-muted)]">{MODEL_PROVIDER_ASSETS[option.provider].alt} · {option.hint}</span>
                </span>
                {active && <Check className="h-4 w-4 shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
// Resizes an image file/blob to a JPEG data URL capped at `maxDimension` on its longest side, so
// pasted screenshots stay a few hundred KB instead of multi-megabyte PNGs.
function downscaleImageToDataUrl(blob: Blob, maxDimension = 1280, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const objectUrl = URL.createObjectURL(blob)
    img.onload = () => {
      URL.revokeObjectURL(objectUrl)
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) { reject(new Error('canvas 2d context unavailable')); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('immagine non valida')) }
    img.src = objectUrl
  })
}

const CODING_TUTORIAL_STORAGE_KEY = 'coding_lab_tutorial_seen_v1'
function composeDescription(title: string, prompt: string, answersText: string) {
  const spec = answersText ? `\n## Specifiche dal colloquio\n${answersText}\n` : ''
  return `# ${title || 'Progetto'}\n\n## Istruzioni di progetto\n${prompt || 'Descrivi qui obiettivo e regole del progetto.'}\n${spec}\n## Richieste\n`
}

export default function StudentCodingLabModule({ sessionId, sharedProject, isTeacher = false }: { sessionId: string; sharedProject?: { projectId: string; nonce: number } | null; isTeacher?: boolean }) {
  const [projects, setProjects] = useState<CodingProject[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  // Kept in sync below so the message-bridge handler (mounted once, deps []) always reads the
  // currently active project instead of a stale closure value.
  const selectedProjectIdRef = useRef<string | null>(null)
  useEffect(() => { selectedProjectIdRef.current = selectedProjectId }, [selectedProjectId])
  const [projectDetail, setProjectDetail] = useState<CodingProjectDetail | null>(null)
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [message, setMessage] = useState('')
  // Screenshots pasted (Ctrl+V) or picked into the prompt box, downscaled client-side and sent as
  // data URLs — the backend describes them with a vision model so any codegen model can use them.
  const [attachedImages, setAttachedImages] = useState<{ id: string; dataUrl: string; name: string }[]>([])
  const attachmentFileInputRef = useRef<HTMLInputElement>(null)
  const MAX_ATTACHMENTS = 3
  const [files, setFiles] = useState<GeneratedFile[]>([])
  const [selectedPath, setSelectedPath] = useState('index.html')
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [sending, setSending] = useState(false)
  const [draftDirty, setDraftDirty] = useState(false)
  const [draftSaving, setDraftSaving] = useState(false)
  const [draftSavedAt, setDraftSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [projectListSearch, setProjectListSearch] = useState('')
  const [promptPanelOpen, setPromptPanelOpen] = useState(true)
  const [activeWorkbench, setActiveWorkbench] = useState<'code' | 'preview'>('preview')
  const [previewFullscreen, setPreviewFullscreen] = useState(false)
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [createPanelOpen, setCreatePanelOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [downloadingZip, setDownloadingZip] = useState(false)
  const [shareUrl, setShareUrl] = useState<string | null>(null)
  const [pendingCommits, setPendingCommits] = useState<CodingCommit[]>([])
  const [previewingCommitId, setPreviewingCommitId] = useState<string | null>(null)
  const [previewingVersionId, setPreviewingVersionId] = useState<string | null>(null)
  const [upstreamStatus, setUpstreamStatus] = useState<UpstreamStatus | null>(null)
  // Safety net: if the sandboxed preview iframe ever navigates away from its srcDoc
  // (e.g. generated JS does location.href = '...'), it would load the platform SPA at a
  // null origin and spam CORS/sessionStorage errors. We detect the extra load and remount.
  const [previewNonce, setPreviewNonce] = useState(0)
  const [fullscreenNonce, setFullscreenNonce] = useState(0)
  const previewLoads = useRef(0)
  const previewResets = useRef(0)
  const fullscreenLoads = useRef(0)
  const fullscreenResets = useRef(0)
  const previewLoadingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const detailLoadSeq = useRef(0)
  const [interviewQuestions, setInterviewQuestions] = useState<InterviewQuestion[] | null>(null)
  const [interviewAnswers, setInterviewAnswers] = useState<Record<number, string>>({})
  const [interviewing, setInterviewing] = useState(false)
  // Agentic auto-fix loop: real compile errors from the Sandpack runtime are fed back to the model
  // until the project builds clean (capped, so a stubborn error can't loop forever / burn credits).
  const [previewErrors, setPreviewErrors] = useState<SandpackRuntimeError[]>([])
  const [autoFixing, setAutoFixing] = useState(false)
  const autoFixAttempts = useRef(0)
  const MAX_AUTO_FIX = 2
  const [diffView, setDiffView] = useState<{ path: string; oldContent: string; newContent: string } | null>(null)
  const modelOptions = modelOptionsFor(isTeacher)
  const [modelKey, setModelKey] = useState<string>(() => initialModelKey(isTeacher))
  // Live generation feedback (streamed): reasoning chain, planned files, and per-file progress.
  const [liveReasoning, setLiveReasoning] = useState('')
  const [livePlan, setLivePlan] = useState<{ path: string; purpose: string }[]>([])
  const [liveFiles, setLiveFiles] = useState<{ path: string; lines: number; status: 'writing' | 'done' }[]>([])
  const [liveStatus, setLiveStatus] = useState('')
  const [showDesignStudio, setShowDesignStudio] = useState(false)
  const [designNotice, setDesignNotice] = useState<string | null>(null)
  const [imageJobStatus, setImageJobStatus] = useState<{ status: 'generating' | 'optimizing' | 'ready' | 'error'; message: string } | null>(null)
  const [showTutorial, setShowTutorial] = useState(false)
  const conversationEndRef = useRef<HTMLDivElement>(null)
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftRevision = useRef(0)

  const markDraftDirty = () => {
    draftRevision.current += 1
    setDraftDirty(true)
  }

  useEffect(() => {
    localStorage.setItem('coding_model_key', modelKey)
  }, [modelKey])

  useEffect(() => {
    if (localStorage.getItem(CODING_TUTORIAL_STORAGE_KEY) !== 'seen') {
      setShowTutorial(true)
    }
  }, [])

  const closeTutorial = () => {
    localStorage.setItem(CODING_TUTORIAL_STORAGE_KEY, 'seen')
    setShowTutorial(false)
  }

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  )
  const filteredProjects = useMemo(() => {
    const query = projectListSearch.trim().toLocaleLowerCase('it')
    if (!query) return projects
    return projects.filter((project) => [project.title, project.owner_display_name, project.template_key].filter(Boolean).join(' ').toLocaleLowerCase('it').includes(query))
  }, [projects, projectListSearch])
  const selectedFile = files.find((file) => file.path === selectedPath) ?? files[0] ?? null
  const selectedFileIsGeneratedDescription = selectedFile?.path === 'description.md'
  const isReactPreview = useMemo(() => isReactProject(files), [files])
  const previewHtml = useMemo(() => (isReactPreview ? '' : buildPreviewHtml(files, { enableInspector: true })), [files, isReactPreview])
  const fullscreenPreviewHtml = useMemo(() => (isReactPreview ? '' : buildPreviewHtml(files, { enableInspector: false })), [files, isReactPreview])
  const hasPreview = isReactPreview ? files.length > 0 : Boolean(previewHtml)
  const latestVersion = useMemo(() => [...(projectDetail?.versions || [])].sort((a, b) => b.version_number - a.version_number)[0], [projectDetail])
  const sortedVersions = useMemo(() => [...(projectDetail?.versions || [])].sort((a, b) => b.version_number - a.version_number), [projectDetail])
  const isFork = selectedProject?.status === 'fork' || Boolean(latestVersion?.source_manifest_json?.collaboration?.source_project_id)
  const filesSignature = useMemo(
    () => files.map((file) => `${file.path}:${file.content.length}:${file.content.charCodeAt(0) || 0}:${file.content.charCodeAt(file.content.length - 1) || 0}`).join('|'),
    [files],
  )
  const previewKey = `${selectedProjectId || 'new'}:${latestVersion?.id || selectedProject?.current_version_id || 'draft'}:${previewingCommitId || ''}:${previewingVersionId || ''}:${filesSignature}`
  // Identity key for the live Sandpack bundler: deliberately excludes filesSignature. Sandpack already
  // applies file-content changes reactively (see CodingSandpackPreview's `files` prop + recompileMode:
  // 'delayed'), so keying on content would force a full bundler/iframe remount on every keystroke —
  // wiping in-memory state and any data the generated app persisted. Only remount for a genuinely
  // different project/version/commit.
  const previewIdentityKey = `${selectedProjectId || 'new'}:${latestVersion?.id || selectedProject?.current_version_id || 'draft'}:${previewingCommitId || ''}:${previewingVersionId || ''}`

  // New preview content (or forced remount) resets the per-mount load counters.
  useEffect(() => { previewLoads.current = 0 }, [previewNonce])
  useEffect(() => { previewLoads.current = 0; previewResets.current = 0 }, [previewHtml])
  useEffect(() => {
    previewLoads.current = 0
    previewResets.current = 0
    fullscreenLoads.current = 0
    fullscreenResets.current = 0
    setPreviewErrors([])
  }, [previewKey])
  useEffect(() => { fullscreenLoads.current = 0 }, [fullscreenNonce])
  useEffect(() => { fullscreenLoads.current = 0; fullscreenResets.current = 0 }, [fullscreenPreviewHtml])
  useEffect(() => {
    if (previewLoadingTimer.current) clearTimeout(previewLoadingTimer.current)
    if (activeWorkbench !== 'preview' || !hasPreview) {
      setPreviewLoading(false)
      return
    }
    setPreviewLoading(true)
    previewLoadingTimer.current = setTimeout(() => setPreviewLoading(false), isReactPreview ? 4500 : 1800)
    return () => {
      if (previewLoadingTimer.current) clearTimeout(previewLoadingTimer.current)
    }
  }, [activeWorkbench, files, hasPreview, isReactPreview, previewNonce])

  const handlePreviewLoad = () => {
    previewLoads.current += 1
    setPreviewLoading(false)
    // The first load after each (re)mount is expected; any further load means the
    // sandboxed content navigated itself away — remount to restore the preview.
    if (previewLoads.current > 1 && previewResets.current < 5) {
      previewResets.current += 1
      setPreviewNonce((value) => value + 1)
    }
  }

  const handleFullscreenLoad = () => {
    fullscreenLoads.current += 1
    if (fullscreenLoads.current > 1 && fullscreenResets.current < 5) {
      fullscreenResets.current += 1
      setFullscreenNonce((value) => value + 1)
    }
  }

  const startNewProject = () => {
    detailLoadSeq.current += 1
    setSelectedProjectId(null)
    setProjectDetail(null)
    setFiles([])
    setSelectedPath('')
    setMessage('')
    setTitle('')
    setPrompt('')
    setCreatePanelOpen(true)
    setPromptPanelOpen(true)
    setActiveWorkbench('code')
    setShareUrl(null)
    setPendingCommits([])
    setPreviewingCommitId(null)
    setPreviewingVersionId(null)
    setUpstreamStatus(null)
    setInterviewQuestions(null)
    setInterviewAnswers({})
    setDraftDirty(false)
    setDraftSaving(false)
    setDraftSavedAt(null)
  }

  const handleStartNewProject = async () => {
    if (!selectedProjectId || creating || generating || draftSaving) return
    if (draftDirty && files.length > 0 && !previewingCommitId && !previewingVersionId) {
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
      setDraftSaving(true)
      try {
        const projectId = selectedProjectId
        const collaboration = latestVersion?.source_manifest_json?.collaboration
        const response = await codingApi.saveDraft(projectId, {
          parent_version_id: selectedProject?.current_version_id || null,
          source_manifest_json: {
            files,
            summary: 'Bozza salvata prima di creare un nuovo progetto.',
            ...(collaboration ? { collaboration } : {}),
          },
          artifact_manifest_json: {},
          build_status: 'ready',
          review_status: 'pending',
        })
        const versionId = response.data?.id
        const now = new Date().toISOString()
        setProjects((prev) => prev.map((project) => (
          project.id === projectId
            ? { ...project, current_version_id: versionId || project.current_version_id, updated_at: now }
            : project
        )))
      } catch (err: any) {
        setError(err?.response?.data?.detail || 'Salvataggio del progetto non riuscito. Riprova prima di crearne uno nuovo.')
        return
      } finally {
        setDraftSaving(false)
      }
    }
    startNewProject()
  }

  const loadProjects = async () => {
    setError(null)
    setLoading(true)
    try {
      const response = await codingApi.listProjects(sessionId)
      const nextProjects = response.data as CodingProject[]
      const urlProjectId = new URLSearchParams(window.location.search).get('project')
      setProjects(nextProjects)
      if (urlProjectId) {
        setSelectedProjectId(urlProjectId)
        setCreatePanelOpen(false)
        setActiveWorkbench('preview')
      } else if (selectedProjectId && !nextProjects.some((project) => project.id === selectedProjectId)) {
        startNewProject()
      } else if (!selectedProjectId) {
        setCreatePanelOpen(true)
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Impossibile caricare i progetti.')
    } finally {
      setLoading(false)
    }
  }

  const loadProjectDetail = async (projectId: string) => {
    const seq = ++detailLoadSeq.current
    setError(null)
    setProjectDetail(null)
    setFiles([])
    setSelectedPath('index.html')
    setPreviewingCommitId(null)
    setPreviewingVersionId(null)
    setPreviewErrors([])
    try {
      const [response, savedModelResponse] = await Promise.all([
        codingApi.getProject(projectId),
        codingApi.getProjectData(projectId, PROJECT_MODEL_DATA_KEY).catch((err: any) => {
          if (err?.response?.status !== 404) console.warn('Impossibile caricare il modello del progetto:', err)
          return null
        }),
      ])
      if (seq !== detailLoadSeq.current) return
      const detail = response.data as CodingProjectDetail
      const savedModelKey = savedModelResponse?.data?.value?.model_key
      if (
        typeof savedModelKey === 'string'
        && modelOptions.some((option) => option.key === savedModelKey)
      ) {
        setModelKey(savedModelKey)
      }
      setProjectDetail(detail)
      const latestFiles = [...(detail.versions || [])]
        .sort((a, b) => b.version_number - a.version_number)
        .find((version) => version.source_manifest_json?.files?.length)
        ?.source_manifest_json?.files
      if (latestFiles?.length) {
        setFiles(latestFiles)
        setSelectedPath(latestFiles.some((file) => file.path === selectedPath) ? selectedPath : latestFiles[0].path)
      } else {
        setFiles([])
      }
      setDraftDirty(false)
      setDraftSaving(false)
      setDraftSavedAt(null)
      setPreviewingCommitId(null)
      setPreviewingVersionId(null)
    } catch (err: any) {
      if (seq === detailLoadSeq.current) {
        setError(err?.response?.data?.detail || 'Impossibile caricare il progetto.')
      }
    }
  }

  const openProjectFromList = async (project: CodingProject) => {
    setCreatePanelOpen(false)
    setShareUrl(null)
    if (!project.is_owned_by_current_user && project.visibility === 'class_shared' && !isTeacher) {
      setLoading(true)
      setError(null)
      try {
        const response = await codingApi.forkProject(project.id)
        const forked = response.data as CodingProject
        setProjects((prev) => [forked, ...prev.filter((item) => item.id !== forked.id)])
        setSelectedProjectId(forked.id)
        setActiveWorkbench('preview')
        setShareUrl('Copia personale creata dal progetto condiviso.')
      } catch (err: any) {
        setError(err?.response?.data?.detail || 'Impossibile aprire il progetto condiviso.')
      } finally {
        setLoading(false)
      }
      return
    }
    if (project.id !== selectedProjectId) {
      detailLoadSeq.current += 1
      setProjectDetail(null)
      setFiles([])
      setSelectedPath('index.html')
      setPreviewingCommitId(null)
      setPreviewingVersionId(null)
      setPreviewErrors([])
    }
    setSelectedProjectId(project.id)
    setActiveWorkbench('preview')
  }

  const loadProjectCommits = async (projectId: string) => {
    try {
      const response = await codingApi.listCommits(projectId)
      setPendingCommits((response.data || []) as CodingCommit[])
    } catch {
      setPendingCommits([])
    }
  }

  const loadUpstreamStatus = async (projectId: string) => {
    try {
      const response = await codingApi.getUpstreamStatus(projectId)
      setUpstreamStatus(response.data as UpstreamStatus)
    } catch {
      setUpstreamStatus(null)
    }
  }

  useEffect(() => {
    setProjects([])
    startNewProject()
    loadProjects()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  useEffect(() => {
    if (selectedProjectId) {
      loadProjectDetail(selectedProjectId)
      loadProjectCommits(selectedProjectId)
      loadUpstreamStatus(selectedProjectId)
    } else {
      setProjectDetail(null)
      setPendingCommits([])
      setUpstreamStatus(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId])

  useEffect(() => {
    if (!selectedProjectId || isFork) return
    const interval = window.setInterval(() => {
      loadProjectCommits(selectedProjectId)
    }, 8000)
    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, isFork])

  useEffect(() => {
    if (!selectedProjectId || !isFork) return
    const interval = window.setInterval(() => {
      loadUpstreamStatus(selectedProjectId)
    }, 10000)
    return () => window.clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, isFork])

  useEffect(() => {
    return () => {
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!draftDirty || !selectedProjectId || files.length === 0 || generating || previewingCommitId || previewingVersionId) return
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)

    const projectId = selectedProjectId
    const filesSnapshot = files
    const revision = draftRevision.current
    const collaboration = latestVersion?.source_manifest_json?.collaboration
    draftSaveTimer.current = setTimeout(async () => {
      setDraftSaving(true)
      try {
        const response = await codingApi.saveDraft(projectId, {
          parent_version_id: selectedProject?.current_version_id || null,
          source_manifest_json: {
            files: filesSnapshot,
            summary: 'Bozza salvata automaticamente.',
            ...(collaboration ? { collaboration } : {}),
          },
          artifact_manifest_json: {},
          build_status: 'ready',
          review_status: 'pending',
        })
        const versionId = response.data?.id
        const now = new Date()
        setDraftSavedAt(now)
        if (revision === draftRevision.current) {
          setDraftDirty(false)
        }
        if (versionId) {
          setProjects((prev) => prev.map((project) => (
            project.id === projectId
              ? { ...project, current_version_id: versionId, updated_at: now.toISOString() }
              : project
          )))
        }
      } catch (err: any) {
        setError(err?.response?.data?.detail || 'Salvataggio bozza non riuscito.')
      } finally {
        setDraftSaving(false)
      }
    }, 1200)

    return () => {
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current)
    }
  }, [draftDirty, files, selectedProjectId, generating, previewingCommitId, previewingVersionId, selectedProject?.current_version_id, latestVersion?.id])

  useEffect(() => {
    if (!sharedProject?.projectId) return
    let cancelled = false
    const openSharedProject = async () => {
      setError(null)
      setLoading(true)
      try {
        const response = await codingApi.forkProject(sharedProject.projectId)
        if (cancelled) return
        const project = response.data as CodingProject
        setProjects((prev) => [project, ...prev.filter((item) => item.id !== project.id)])
        detailLoadSeq.current += 1
        setProjectDetail(null)
        setFiles([])
        setSelectedPath('index.html')
        setPreviewingCommitId(null)
        setPreviewingVersionId(null)
        setPreviewErrors([])
        setCreatePanelOpen(false)
        setPromptPanelOpen(true)
        setSelectedProjectId(project.id)
        setActiveWorkbench('preview')
        setShareUrl(project.status === 'fork' ? 'Copia personale creata. Puoi modificarla e inviare un commit al creatore.' : 'Hai aperto il tuo progetto condiviso.')
      } catch (err: any) {
        if (!cancelled) setError(err?.response?.data?.detail || 'Impossibile aprire il progetto condiviso.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    openSharedProject()
    return () => {
      cancelled = true
    }
  }, [sharedProject?.nonce])

  // Keep the conversation pinned to the latest message as it grows / while generating.
  useEffect(() => {
    conversationEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [projectDetail?.messages.length, generating])

  useEffect(() => {
    const handlePreviewApi = async (event: MessageEvent<PreviewApiRequest>) => {
      const data = event.data
      if (data?.source !== 'golinelli-coding-preview' || !data.id || !data.action) return

      const reply = (payload: Record<string, unknown>) => {
        event.source?.postMessage({
          source: 'golinelli-coding-host',
          id: data.id,
          ...payload,
        }, { targetOrigin: '*' })
      }

      try {
        if (data.action === 'chat') {
          const payload = data.payload || {}
          const response = await codingApi.aiChat({
            content: String(payload.content || ''),
            history: Array.isArray(payload.history) ? payload.history as { role: string; content: string }[] : [],
            profileKey: typeof payload.profileKey === 'string' ? payload.profileKey : 'tutor',
            provider: typeof payload.provider === 'string' ? payload.provider : undefined,
            model: typeof payload.model === 'string' ? payload.model : undefined,
          })
          reply({ ok: true, result: response.data })
          return
        }

        if (data.action === 'generateImage') {
          const payload = data.payload || {}
          // Vibe Lab always uses the OpenAI gpt-image model (same as the platform chatbots),
          // ignoring any provider the generated mini-app may pass.
          setImageJobStatus({ status: 'generating', message: 'Genero l’immagine sul server…' })
          const response = await llmApi.generateImage(String(payload.prompt || ''), 'gpt-image-2-2026-04-21')
          const result = response.data
          // The backend returns a path relative to the platform's own origin (e.g.
          // /uploads/generated/xxx.png). That resolves fine in the main app, but the sandboxed
          // preview iframe runs on a different origin (Sandpack's external bundler domain, or a
          // null origin for the legacy srcDoc preview) — a relative <img src> there 404s silently.
          // Resolve it against the platform's origin before handing it back to the sandbox.
          const imageUrl = typeof result?.image_url === 'string' && result.image_url.startsWith('/')
            ? `${window.location.origin}${result.image_url}`
            : result?.image_url
          setImageJobStatus({ status: 'optimizing', message: 'Ottimizzo e preparo il file…' })
          if (typeof imageUrl === 'string') {
            await waitForImageUrl(imageUrl)
          }
          setImageJobStatus({ status: 'ready', message: 'Immagine pronta.' })
          window.setTimeout(() => setImageJobStatus(null), 1800)
          reply({ ok: true, result: { ...result, image_url: imageUrl } })
          return
        }

        if (data.action === 'saveData' || data.action === 'loadData' || data.action === 'deleteData') {
          const projectId = selectedProjectIdRef.current
          if (!projectId) { reply({ ok: false, error: 'Nessun progetto attivo.' }); return }
          const key = String(data.payload?.key || '').trim()
          if (!key) { reply({ ok: false, error: 'Chiave dati mancante.' }); return }

          if (data.action === 'saveData') {
            const response = await codingApi.putProjectData(projectId, key, data.payload?.value ?? null)
            reply({ ok: true, result: response.data })
            return
          }
          if (data.action === 'deleteData') {
            await codingApi.deleteProjectData(projectId, key)
            reply({ ok: true, result: {} })
            return
          }
          try {
            const response = await codingApi.getProjectData(projectId, key)
            reply({ ok: true, result: response.data })
          } catch (err: any) {
            if (err?.response?.status === 404) { reply({ ok: true, result: { key, value: null } }); return }
            throw err
          }
          return
        }

        if (data.action === 'askAgent') {
          const payload = data.payload || {}
          const selector = String(payload.selector || '').trim()
          const tagName = String(payload.tagName || '').trim()
          const text = String(payload.text || '').trim()
          // Show only a readable reference in the prompt box — never the raw HTML.
          const label = text ? `«${text.slice(0, 120)}»` : (tagName ? `<${tagName}>` : 'elemento selezionato')
          const where = tagName ? `elemento <${tagName}>${selector ? `, ${selector}` : ''}` : selector
          const reference = where ? `Migliora questa sezione: ${label} (${where})` : `Migliora questa sezione: ${label}`
          setMessage((prev) => prev.trim() ? `${reference}\n${prev.trim()}` : reference)
          reply({ ok: true, result: { inserted: true } })
          return
        }

        if (data.action === 'openExternalLink') {
          const url = String(data.payload?.url || '')
          if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
          reply({ ok: true, result: {} })
          return
        }
      } catch (err: any) {
        if (data.action === 'generateImage') {
          setImageJobStatus({ status: 'error', message: err?.response?.data?.detail || err?.message || 'Generazione immagine non riuscita.' })
          window.setTimeout(() => setImageJobStatus(null), 5000)
        }
        reply({
          ok: false,
          error: err?.response?.data?.detail || err?.message || 'Chiamata AI non riuscita.',
        })
      }
    }

    window.addEventListener('message', handlePreviewApi)
    return () => window.removeEventListener('message', handlePreviewApi)
  }, [])

  // Step 1: interview the student before generating (always, per project setup).
  const handleStartInterview = async () => {
    if (!title.trim() || !prompt.trim()) return
    setInterviewing(true)
    setError(null)
    try {
      const response = await codingApi.interview({ title: title.trim(), prompt: prompt.trim() })
      const questions = (response.data?.questions || []) as InterviewQuestion[]
      if (questions.length) {
        setInterviewQuestions(questions)
        setInterviewAnswers({})
      } else {
        await createAndGenerate('')
      }
    } catch {
      // If the interview step fails, never block: generate directly.
      await createAndGenerate('')
    } finally {
      setInterviewing(false)
    }
  }

  const createAndGenerate = async (answersText: string) => {
    if (!title.trim() || !prompt.trim()) return
    setCreating(true)
    setError(null)
    try {
      const response = await codingApi.createProject({
        title: title.trim(),
        session_id: sessionId,
        template_key: 'vite-react',
        initial_prompt: prompt.trim(),
      })
      const project = response.data as CodingProject
      void codingApi.putProjectData(project.id, PROJECT_MODEL_DATA_KEY, { model_key: modelKey }).catch(() => {
        setError('Progetto creato, ma non è stato possibile salvare la preferenza del modello.')
      })
      setProjects((prev) => [project, ...prev.filter((item) => item.id !== project.id)])
      setSelectedProjectId(project.id)
      setCreatePanelOpen(false)
      setInterviewQuestions(null)
      const description = composeDescription(title.trim(), prompt.trim(), answersText)
      // Keep any context files the student added with "+ File"; refresh description.md.
      const initialFiles: GeneratedFile[] = [
        { path: 'description.md', content: description, language: 'markdown' },
        ...files.filter((file) => file.path !== 'description.md'),
      ]
      setFiles(initialFiles)
      const genPrompt = answersText ? `${prompt.trim()}\n\nDettagli dal colloquio:\n${answersText}` : prompt.trim()
      await generateCode(project.id, genPrompt, initialFiles)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Impossibile creare il progetto.')
    } finally {
      setCreating(false)
    }
  }

  const submitInterview = async () => {
    if (!interviewQuestions) return
    const answersText = interviewQuestions
      .map((item, index) => ({ q: item.question, a: (interviewAnswers[index] || '').trim() }))
      .filter((entry) => entry.a)
      .map((entry) => `- ${entry.q}\n  → ${entry.a}`)
      .join('\n')
    await createAndGenerate(answersText)
  }

  const handleModelChange = (nextModelKey: string) => {
    if (!modelOptions.some((option) => option.key === nextModelKey)) return
    setModelKey(nextModelKey)
    if (selectedProjectId) {
      void codingApi.putProjectData(selectedProjectId, PROJECT_MODEL_DATA_KEY, { model_key: nextModelKey }).catch(() => {
        setError('Non è stato possibile salvare il modello scelto per questo progetto.')
      })
    }
  }

  const generateCode = async (projectId: string, nextPrompt?: string, filesOverride?: GeneratedFile[], isAutoFix = false, attachmentsOverride?: string[]) => {
    setGenerating(true)
    setError(null)
    setLiveReasoning('')
    setLivePlan([])
    setLiveFiles([])
    setLiveStatus('Preparo il progetto e il contesto della richiesta…')
    // A fresh user-driven generation starts a new fix budget; an auto-fix iteration spends from it.
    if (!isAutoFix) {
      autoFixAttempts.current = 0
      setPreviewErrors([])
    }
    try {
      const baseFiles = filesOverride ?? files
      // Streamed (SSE) generation: keeps the connection alive while the LLM writes the app,
      // so a 90-180s generation survives the Cloudflare ~100s proxy timeout.
      const studentToken = localStorage.getItem('student_token')
      const response = await fetch(codingApi.generateProjectStreamUrl(projectId), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(studentToken ? { 'student-token': studentToken } : {}),
        },
        credentials: 'include',
        body: JSON.stringify({
          prompt: nextPrompt,
          files: baseFiles.length ? baseFiles : undefined,
          model_key: modelKey,
          attachments: attachmentsOverride?.length ? attachmentsOverride : undefined,
        }),
      })
      if (!response.ok || !response.body) throw new Error('La generazione non è partita.')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let generatedFiles: GeneratedFile[] | null = null
      let streamError: string | null = null
      let finished = false

      while (!finished) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        // SSE frames are separated by a blank line; each frame is a single `data: {json}` line.
        let sep: number
        while ((sep = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          const dataLine = frame.split('\n').find((line) => line.startsWith('data: '))
          if (!dataLine) continue
          let event: any
          try {
            event = JSON.parse(dataLine.slice(6))
          } catch {
            continue
          }
          if (event.type === 'reasoning') {
            setLiveStatus('L’architetto sta definendo struttura e modifiche…')
            setLiveReasoning((prev) => prev + (event.content || ''))
          } else if (event.type === 'status') {
            setLiveStatus(String(event.message || 'Elaborazione in corso…'))
          } else if (event.type === 'plan') {
            setLiveStatus(`Piano pronto: ${event.files?.length || 0} file da elaborare.`)
            setLivePlan((event.files || []) as { path: string; purpose: string }[])
            setLiveFiles((event.files || []).map((file: any) => ({ path: String(file.path), lines: 0, status: 'writing' as const })))
          } else if (event.type === 'file_start') {
            setLiveStatus(`Scrittura di ${String(event.path)}…`)
            setLiveFiles((prev) => prev.some((file) => file.path === event.path)
              ? prev
              : [...prev, { path: String(event.path), lines: 0, status: 'writing' as const }])
          } else if (event.type === 'file_progress') {
            setLiveStatus(`Scrittura di ${String(event.path)}: ${event.lines || 0} righe…`)
            setLiveFiles((prev) => prev.map((file) => file.path === event.path ? { ...file, lines: event.lines || file.lines } : file))
          } else if (event.type === 'file_done') {
            setLiveStatus(`${String(event.path)} completato (${event.lines || 0} righe).`)
            setLiveFiles((prev) => prev.map((file) => file.path === event.path ? { ...file, lines: event.lines || file.lines, status: 'done' as const } : file))
          } else if (event.type === 'done') {
            setLiveStatus('Versione pronta. Aggiorno progetto e anteprima…')
            generatedFiles = (event.files || []) as GeneratedFile[]
            finished = true
          } else if (event.type === 'error') {
            streamError = event.message || 'Generazione non riuscita.'
            finished = true
          }
          // 'chunk' events only keep the connection alive; visible progress is carried by status,
          // reasoning and per-file events.
        }
      }

      if (streamError) throw new Error(streamError)
      if (generatedFiles) {
        setFiles(generatedFiles)
        const preferred = generatedFiles.find((f) => f.path === 'App.tsx' || f.path === 'index.html')
        setSelectedPath(preferred?.path || generatedFiles[0]?.path || 'App.tsx')
      }
      await loadProjectDetail(projectId)
    } catch (err: any) {
      setError(err?.message || 'Generazione codice non riuscita.')
    } finally {
      setGenerating(false)
      setLiveReasoning('')
      setLivePlan([])
      setLiveFiles([])
      setLiveStatus('')
    }
  }

  // Feed real compile errors back to the model to repair the project (capped retry budget).
  const runAutoFix = async (errs: SandpackRuntimeError[]) => {
    if (!selectedProjectId || autoFixing || generating) return
    if (autoFixAttempts.current >= MAX_AUTO_FIX) return
    autoFixAttempts.current += 1
    setAutoFixing(true)
    try {
      const detail = errs.slice(0, 6).map((e) => `- ${e.path ? e.path + ': ' : ''}${e.message}`).join('\n')
      const prompt = `Il progetto non compila o va in errore. Correggi SOLO questi errori reali del runtime, lasciando invariato tutto il resto:\n${detail}`
      await generateCode(selectedProjectId, prompt, undefined, true)
    } finally {
      setAutoFixing(false)
    }
  }

  const handlePreviewErrors = (errs: SandpackRuntimeError[]) => {
    setPreviewErrors(errs)
    const compile = errs.filter((e) => e.kind === 'compile')
    if (compile.length && isReactPreview && !generating && !autoFixing && autoFixAttempts.current < MAX_AUTO_FIX) {
      void runAutoFix(compile)
    }
  }

  const handlePreviewReady = () => {
    setPreviewErrors([])
    setPreviewLoading(false)
  }

  const handleSendMessage = async () => {
    if (!selectedProjectId || !message.trim()) return
    setSending(true)
    setError(null)
    try {
      const nextPrompt = message.trim()
      const nextAttachments = attachedImages.map((a) => a.dataUrl)
      setMessage('')
      setAttachedImages([])
      // Show the student's message immediately; the generate-stream endpoint persists it as the
      // codegen request, and loadProjectDetail reconciles this optimistic bubble afterwards.
      const optimistic: CodingMessage = {
        id: `tmp-${Date.now()}`,
        actor_type: isTeacher ? 'teacher' : 'student',
        role: 'user',
        content: nextPrompt,
        created_at: new Date().toISOString(),
        metadata_json: nextAttachments.length ? { attachments: nextAttachments } : undefined,
      }
      setProjectDetail((prev) => prev ? { ...prev, messages: [...prev.messages, optimistic] } : prev)
      await generateCode(selectedProjectId, nextPrompt, undefined, false, nextAttachments)
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Impossibile salvare il messaggio.')
    } finally {
      setSending(false)
    }
  }

  const addAttachments = async (blobs: (File | Blob)[]) => {
    const room = Math.max(0, MAX_ATTACHMENTS - attachedImages.length)
    if (room <= 0) return
    const accepted = blobs.filter((b) => b.type.startsWith('image/')).slice(0, room)
    for (const blob of accepted) {
      try {
        const dataUrl = await downscaleImageToDataUrl(blob)
        setAttachedImages((prev) => prev.length >= MAX_ATTACHMENTS ? prev : [
          ...prev,
          { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, dataUrl, name: (blob as File).name || 'screenshot.png' },
        ])
      } catch {
        setError('Non è stato possibile leggere una delle immagini allegate.')
      }
    }
  }

  const handlePromptPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items || [])
    const imageFiles = items.filter((item) => item.type.startsWith('image/')).map((item) => item.getAsFile()).filter((f): f is File => !!f)
    if (imageFiles.length === 0) return
    event.preventDefault()
    void addAttachments(imageFiles)
  }

  const handleAttachmentFilePick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files || [])
    event.target.value = ''
    if (picked.length) void addAttachments(picked)
  }

  const removeAttachment = (id: string) => {
    setAttachedImages((prev) => prev.filter((a) => a.id !== id))
  }

  const saveCurrentFilesVersion = async (reason: string) => {
    if (!selectedProjectId || files.length === 0 || previewingCommitId || previewingVersionId) return
    const collaboration = latestVersion?.source_manifest_json?.collaboration
    const response = await codingApi.createVersion(selectedProjectId, {
      parent_version_id: selectedProject?.current_version_id || null,
      source_manifest_json: {
        files,
        summary: reason,
        ...(collaboration ? { collaboration } : {}),
      },
      artifact_manifest_json: {},
      build_status: 'ready',
      review_status: 'pending',
    })
    const versionId = response.data?.id
    setProjects((prev) => prev.map((project) => (
      project.id === selectedProjectId ? { ...project, current_version_id: versionId || project.current_version_id } : project
    )))
  }

  const handleShareProject = async () => {
    if (!selectedProjectId) return
    setPublishing(true)
    setError(null)
    try {
      await saveCurrentFilesVersion('Versione salvata prima della condivisione in classe.')
      await codingApi.shareToClass(selectedProjectId)
      setShareUrl('Progetto condiviso nella chat di classe. I compagni lo aprono nel Vibe Lab e lavorano su una copia.')
      await loadProjects()
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Condivisione non riuscita.')
    } finally {
      setPublishing(false)
    }
  }

  const handleDownloadZip = async () => {
    if (!selectedProjectId) return
    setDownloadingZip(true)
    setError(null)
    try {
      await saveCurrentFilesVersion('Versione salvata prima del download ZIP.')
      const response = await codingApi.downloadProjectZip(selectedProjectId)
      const blob = new Blob([response.data], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const safeTitle = (selectedProject?.title || 'coding-lab-app')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'coding-lab-app'
      link.href = url
      link.download = `${safeTitle}.zip`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setShareUrl('ZIP pronto: include sorgenti, Dockerfile, docker-compose.yml e README.')
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Download ZIP non riuscito.')
    } finally {
      setDownloadingZip(false)
    }
  }

  const handleCommitToCreator = async () => {
    if (!selectedProjectId) return
    setPublishing(true)
    setError(null)
    try {
      await saveCurrentFilesVersion('Versione salvata prima del commit al creatore.')
      await codingApi.commitToCreator(selectedProjectId)
      setShareUrl('Commit inviato al creatore. Potra provarlo e mergiarlo nel suo progetto.')
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Invio commit non riuscito.')
    } finally {
      setPublishing(false)
    }
  }

  const handleMergeCommit = async (commitId: string) => {
    if (!selectedProjectId) return
    setPublishing(true)
    setError(null)
    try {
      await codingApi.mergeCommit(selectedProjectId, commitId)
      await loadProjectDetail(selectedProjectId)
      await loadProjectCommits(selectedProjectId)
      setShareUrl('Commit mergiato nel progetto.')
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Merge non riuscito.')
    } finally {
      setPublishing(false)
    }
  }

  const handleRollbackVersion = async (versionId: string) => {
    if (!selectedProjectId) return
    setPublishing(true)
    setError(null)
    try {
      await codingApi.rollbackVersion(selectedProjectId, versionId)
      await loadProjectDetail(selectedProjectId)
      await loadUpstreamStatus(selectedProjectId)
      setShareUrl('Rollback completato. La versione scelta e` diventata una nuova versione corrente.')
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Rollback non riuscito.')
    } finally {
      setPublishing(false)
    }
  }

  const handlePullUpstream = async () => {
    if (!selectedProjectId) return
    setPublishing(true)
    setError(null)
    try {
      await codingApi.pullUpstream(selectedProjectId)
      await loadProjectDetail(selectedProjectId)
      await loadUpstreamStatus(selectedProjectId)
      setShareUrl('Copia aggiornata alla nuova versione del creatore. La tua versione precedente resta nello storico.')
    } catch (err: any) {
      setError(err?.response?.data?.detail || 'Aggiornamento dal creatore non riuscito.')
    } finally {
      setPublishing(false)
    }
  }

  // Show a red/green line diff of a changed file: old = previous saved version, new = latest.
  const handleShowFileDiff = (path: string) => {
    const newContent = sortedVersions[0]?.source_manifest_json?.files?.find((file) => file.path === path)?.content
      ?? files.find((file) => file.path === path)?.content
      ?? ''
    const oldContent = sortedVersions[1]?.source_manifest_json?.files?.find((file) => file.path === path)?.content ?? ''
    setDiffView({ path, oldContent, newContent })
  }

  const updateSelectedFile = (content: string) => {
    if (!selectedFile) return
    if (selectedFile.path === 'description.md') return
    setFiles((prev) => prev.map((file) => file.path === selectedFile.path ? { ...file, content } : file))
    if (selectedProjectId && !previewingCommitId && !previewingVersionId) markDraftDirty()
  }

  // Applies a design system from the studio to the open project: writes design-system.md into the
  // editor files (knowledge base → always fed to codegen as a binding visual contract).
  const applyDesignSystem = async (file: { path: string; content: string; language: string }, name: string) => {
    if (selectedProjectId || createPanelOpen) {
      // Apply to the open project / setup: replace or add design-system.md in the editor files.
      const nextFiles = [...files.filter((f) => f.path !== file.path), file]
      setFiles(nextFiles)
      // Safety net: persist the contract to the project NOW (a dedicated version) so it survives
      // reloads and is guaranteed to be fed to the next generation + design-system review pass —
      // not just held in local state.
      if (selectedProjectId && !previewingCommitId && !previewingVersionId) {
        try {
          const collaboration = latestVersion?.source_manifest_json?.collaboration
          const response = await codingApi.createVersion(selectedProjectId, {
            parent_version_id: selectedProject?.current_version_id || null,
            source_manifest_json: { files: nextFiles, summary: `Design system “${name}” applicato.`, ...(collaboration ? { collaboration } : {}) },
            artifact_manifest_json: {},
            build_status: 'ready',
            review_status: 'pending',
          })
          const versionId = response.data?.id
          if (versionId) {
            setProjects((prev) => prev.map((p) => (p.id === selectedProjectId ? { ...p, current_version_id: versionId } : p)))
          }
        } catch {
          // Non-blocking: it will still be sent with the next generation from local state.
        }
      }
    } else {
      // No project context yet: start a fresh project pre-loaded with this design system.
      startNewProject()
      setFiles([file])
    }
    setSelectedPath(file.path)
    setActiveWorkbench('code')
    setError(null)
    setDesignNotice(`Design system “${name}” applicato: la prossima generazione rispetterà palette, font e forme.`)
    window.setTimeout(() => setDesignNotice(null), 6000)
  }

  const addNewFile = () => {
    const raw = window.prompt('Nome del nuovo file (es. struttura.md, note.md). I file .md diventano knowledge base di progetto.')
    if (!raw) return
    const path = raw.trim().replace(/^\/+/, '')
    if (!path || path.includes('..')) return
    if (files.some((file) => file.path === path)) {
      setSelectedPath(path)
      setActiveWorkbench('code')
      return
    }
    const language = path.endsWith('.md') ? 'markdown'
      : path.endsWith('.css') ? 'css'
      : path.endsWith('.js') ? 'javascript'
      : path.endsWith('.html') ? 'html'
      : 'text'
    setFiles((prev) => [...prev, { path, content: '', language }])
    if (selectedProjectId && !previewingCommitId && !previewingVersionId) markDraftDirty()
    setSelectedPath(path)
    setActiveWorkbench('code')
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100 lg:flex-row">
      {showDesignStudio && (
        <DesignSystemStudio
          onClose={() => setShowDesignStudio(false)}
          onApply={applyDesignSystem}
        />
      )}
      <AnimatePresence>
        {showTutorial && (
          <CodingLabTutorialModal
            onClose={closeTutorial}
            onCreateProject={() => {
              closeTutorial()
              startNewProject()
              setCreatePanelOpen(true)
            }}
            onOpenDesignSystem={() => {
              closeTutorial()
              setShowDesignStudio(true)
            }}
          />
        )}
      </AnimatePresence>
      {designNotice && (
        <div className="fixed bottom-4 left-1/2 z-[80] -translate-x-1/2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-lg">
          {designNotice}
        </div>
      )}
      <WorkspaceExplorerSidebar>
        <WorkspaceExplorerHeader
          eyebrow={isTeacher ? 'Pannello docente' : 'Spazio studente'}
          title="Vibe Lab"
          description="Progetti, versioni e condivisioni in un unico explorer."
          action={(
            <Button
              type="button"
              onClick={handleStartNewProject}
              disabled={creating || generating || draftSaving}
              density="compact"
              tone="accent"
              surface="solid"
              className="h-9 w-9 shrink-0 rounded-full p-0"
              title="Nuovo progetto"
              aria-label="Nuovo progetto"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
          searchValue={projectListSearch}
          onSearchChange={setProjectListSearch}
          searchPlaceholder="Cerca progetti..."
          clearSearchLabel="Cancella ricerca progetti"
        />
        <WorkspaceExplorerList>
          {loading ? (
            <div className="flex h-24 items-center justify-center text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : projects.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-slate-400">Nessun progetto ancora.</p>
          ) : filteredProjects.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-slate-400">Nessun progetto corrisponde a “{projectListSearch}”.</p>
          ) : (
            <div className="space-y-2">
              {filteredProjects.map((project) => (
                <WorkspaceExplorerItem
                  key={project.id}
                  icon={<Code2 className="h-4 w-4" />}
                  title={project.title}
                  subtitle={`${project.owner_display_name || (project.owner_kind === 'teacher' ? 'Docente' : 'Studente')} · ${project.template_key}`}
                  selected={selectedProjectId === project.id}
                  onClick={() => openProjectFromList(project)}
                  badges={(
                    <>
                      <WorkspaceExplorerBadge>{new Date(project.updated_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit' })}</WorkspaceExplorerBadge>
                      {project.visibility === 'class_shared' && <WorkspaceExplorerBadge>Condiviso</WorkspaceExplorerBadge>}
                    </>
                  )}
                />
              ))}
            </div>
          )}
        </WorkspaceExplorerList>
        <div className="border-t border-slate-200/80 px-4 py-3">
          <Button
            type="button"
            onClick={() => setShowTutorial(true)}
            variant="outline"
            density="compact"
            className="w-full gap-1.5 rounded-xl text-xs font-bold"
            title="Tutorial Vibe Lab"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            Tutorial
          </Button>
        </div>
        <SidebarVersioningPanel
          selectedProject={selectedProject}
          isFork={isFork}
          upstreamStatus={upstreamStatus}
          sortedVersions={sortedVersions}
          pendingCommits={pendingCommits}
          publishing={publishing}
          onPullUpstream={handlePullUpstream}
          onRefreshCommits={() => selectedProjectId && loadProjectCommits(selectedProjectId)}
          onOpenVersion={(version) => {
            const versionFiles = version.source_manifest_json?.files || []
            setFiles(versionFiles)
            setSelectedPath(versionFiles[0]?.path || 'index.html')
            setPreviewingVersionId(version.id)
            setPreviewingCommitId(null)
            setActiveWorkbench('preview')
          }}
          onRollbackVersion={handleRollbackVersion}
          onOpenCommit={(commit) => {
            setFiles(commit.files)
            setSelectedPath(commit.files[0]?.path || 'index.html')
            setPreviewingCommitId(commit.id)
            setPreviewingVersionId(null)
            setActiveWorkbench('preview')
          }}
          onMergeCommit={handleMergeCommit}
        />
      </WorkspaceExplorerSidebar>

      <main className="flex min-w-0 flex-1 flex-col">
        {error && (
          <div className="border-b border-slate-200 bg-white px-4 py-2">
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {error}
            </div>
          </div>
        )}

        <div className={createPanelOpen
          ? 'flex min-h-0 flex-1 items-center justify-center overflow-y-auto bg-[var(--surface-subtle)] p-4 sm:p-8'
          : `${promptPanelOpen ? 'lg:grid-cols-[minmax(300px,0.7fr)_minmax(520px,1.3fr)]' : 'lg:grid-cols-[3.5rem_minmax(520px,1fr)]'} grid min-h-0 flex-1 grid-cols-1 overflow-hidden transition-[grid-template-columns]`
        }>
          <section className={createPanelOpen
            ? 'flex w-full max-w-2xl flex-col rounded-[28px] border border-[color:var(--border-subtle)] bg-white shadow-[var(--shadow-lg)]'
            : 'flex min-h-0 flex-col border-b border-slate-200 bg-white lg:border-b-0 lg:border-r'
          }>
            {!createPanelOpen && <PanelHeader
              icon={MessageSquare}
              title="Prompt"
              action={(
                <button
                  type="button"
                  onClick={() => setPromptPanelOpen((value) => !value)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                  title={promptPanelOpen ? 'Comprimi prompt' : 'Espandi prompt'}
                >
                  {promptPanelOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
                </button>
              )}
              compact={!promptPanelOpen}
            />}
            {promptPanelOpen ? (
            <>
            <div className={createPanelOpen ? 'space-y-3 p-5 sm:p-7' : 'flex-1 space-y-3 overflow-y-auto p-3'}>
              {createPanelOpen && (
              <div>
                <div className="mb-6 text-center">
                  <h2 className="text-xl font-black text-[var(--text-primary)]">Crea un nuovo progetto</h2>
                  <p className="mt-1 text-sm text-[var(--text-muted)]">Descrivi cosa vuoi realizzare: Vibe Lab preparerà il progetto per te.</p>
                </div>
                {selectedProject && (
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-bold text-slate-700">Nuovo progetto</p>
                      <p className="text-xs text-slate-500">Il progetto corrente resta nello storico.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCreatePanelOpen(false)}
                      className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-slate-700"
                      title="Chiudi"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
                <label className="mb-1 block text-xs font-bold text-slate-600">Titolo</label>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Dai un nome al progetto"
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
                <label className="mb-1 mt-3 block text-xs font-bold text-slate-600">Prompt iniziale</label>
                <textarea
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  rows={5}
                  placeholder="Descrivi l'app che vuoi creare, cosa deve fare e per chi è pensata..."
                  className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
                <div className="mb-1 mt-3 text-xs font-bold text-slate-600">Modello</div>
                <CodingModelSelector value={modelKey} options={modelOptions} onChange={handleModelChange} />
                {!interviewQuestions ? (
                  <button
                    type="button"
                    onClick={handleStartInterview}
                    disabled={interviewing || creating || !title.trim() || !prompt.trim()}
                    className="mt-3 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white transition disabled:opacity-40"
                  >
                    {interviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                    {interviewing ? 'Creo...' : 'Crea'}
                  </button>
                ) : (
                  <div className="mt-3 space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
                    <p className="text-xs font-bold text-indigo-900">Qualche domanda per capire meglio cosa vuoi</p>
                    {interviewQuestions.map((item, index) => (
                      <div key={index} className="space-y-1.5">
                        <p className="text-xs font-semibold text-slate-700">{item.question}</p>
                        {item.suggestions.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {item.suggestions.map((suggestion) => (
                              <button
                                key={suggestion}
                                type="button"
                                onClick={() => setInterviewAnswers((prev) => ({ ...prev, [index]: suggestion }))}
                                className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
                                  interviewAnswers[index] === suggestion
                                    ? 'border-indigo-500 bg-indigo-600 text-white'
                                    : 'border-indigo-200 bg-white text-indigo-700 hover:border-indigo-400'
                                }`}
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        )}
                        <input
                          value={interviewAnswers[index] || ''}
                          onChange={(event) => setInterviewAnswers((prev) => ({ ...prev, [index]: event.target.value }))}
                          placeholder="La tua risposta (opzionale)"
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs outline-none focus:border-indigo-400"
                        />
                      </div>
                    ))}
                    <div className="flex gap-2 pt-1">
                      <button
                        type="button"
                        onClick={submitInterview}
                        disabled={creating || generating}
                        className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 px-3 text-xs font-bold text-white transition disabled:opacity-40"
                      >
                        {creating || generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                        Genera progetto
                      </button>
                      <button
                        type="button"
                        onClick={() => createAndGenerate('')}
                        disabled={creating || generating}
                        className="inline-flex h-9 items-center justify-center rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:border-slate-400 disabled:opacity-40"
                      >
                        Salta e genera
                      </button>
                    </div>
                  </div>
                )}
              </div>
              )}

              {projectDetail && (
                <div className="space-y-2">
                  <h3 className="text-xs font-black uppercase tracking-wide text-[var(--text-muted)]">Conversazione</h3>
                  {projectDetail.messages.length === 0 ? (
                    <p className="rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-400">Nessun messaggio.</p>
                  ) : (
                    projectDetail.messages.map((item) => (
                      <ConversationBubble
                        key={item.id}
                        item={item}
                        onShowFileDiff={handleShowFileDiff}
                      />
                    ))
                  )}
                  {generating && (
                    <div className="sticky bottom-0 z-20 rounded-2xl border border-[color:var(--border-subtle)] bg-white/95 p-2 shadow-[var(--shadow-lg)] backdrop-blur-xl">
                      <LiveGenerationPanel status={liveStatus} reasoning={liveReasoning} plan={livePlan} files={liveFiles} />
                    </div>
                  )}
                  <div ref={conversationEndRef} />
                </div>
              )}
            </div>
            {!createPanelOpen && <div className="border-t border-slate-100 bg-white/90 p-3">
              <div className="mb-2 flex items-center justify-end gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Modello</span>
                <CodingModelSelector compact value={modelKey} options={modelOptions} onChange={handleModelChange} />
              </div>
              {attachedImages.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                  {attachedImages.map((att) => (
                    <div key={att.id} className="group relative h-14 w-14 overflow-hidden rounded-lg border border-slate-200">
                      <img src={att.dataUrl} alt={att.name} className="h-full w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => removeAttachment(att.id)}
                        className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-white opacity-80 hover:opacity-100"
                        title="Rimuovi allegato"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-center gap-2 rounded-[24px] border border-slate-200 bg-white px-3 py-2 shadow-sm transition-colors focus-within:border-slate-300">
                <input
                  ref={attachmentFileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={handleAttachmentFilePick}
                />
                <button
                  type="button"
                  onClick={() => attachmentFileInputRef.current?.click()}
                  disabled={!selectedProjectId || attachedImages.length >= MAX_ATTACHMENTS}
                  title="Allega uno screenshot (o incollalo con Ctrl+V nel campo di testo)"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 disabled:opacity-40"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      handleSendMessage()
                    }
                  }}
                  onPaste={handlePromptPaste}
                  disabled={!selectedProjectId}
                  rows={2}
                  placeholder="Chiedi una modifica al progetto..."
                  className="min-w-0 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-sm leading-snug text-slate-700 outline-none placeholder:text-slate-400 disabled:cursor-not-allowed disabled:text-slate-400"
                />
                <button
                  type="button"
                  onClick={handleSendMessage}
                  disabled={sending || !selectedProjectId || !message.trim()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--logo-violet-22)] bg-[var(--logo-violet-10)] text-[var(--logo-violet-strong)] transition-colors hover:bg-[var(--logo-violet-22)] disabled:opacity-40"
                >
                  {sending || generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </div>}
            </>
            ) : (
              <div className="hidden flex-1 items-center justify-center lg:flex">
                <button
                  type="button"
                  onClick={() => setPromptPanelOpen(true)}
                  className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-700"
                  title="Espandi prompt"
                >
                  <MessageSquare className="h-4 w-4" />
                </button>
              </div>
            )}
          </section>

          {!createPanelOpen && <section className={`flex min-h-0 flex-col ${activeWorkbench === 'code' ? 'bg-slate-950 text-slate-100' : 'bg-white text-slate-900'}`}>
            <div className={`flex min-h-12 items-center justify-between gap-3 border-b px-4 ${activeWorkbench === 'code' ? 'border-white/10 bg-slate-900' : 'border-slate-100 bg-white'}`}>
              <div className={`inline-flex shrink-0 rounded-[var(--selection-radius)] border p-1 ${activeWorkbench === 'code' ? 'border-white/10 bg-white/5' : 'border-slate-200 bg-slate-100'}`}>
                <CodingToolbarIconButton
                  icon={<FileCode2 className="h-4 w-4" />}
                  label="Codice"
                  active={activeWorkbench === 'code'}
                  onClick={() => setActiveWorkbench('code')}
                  dark={activeWorkbench === 'code'}
                />
                <CodingToolbarIconButton
                  icon={<Eye className="h-4 w-4" />}
                  label="Anteprima"
                  active={activeWorkbench === 'preview'}
                  onClick={() => setActiveWorkbench('preview')}
                  dark={activeWorkbench === 'code'}
                />
              </div>
              {activeWorkbench === 'code' && selectedProjectId && (
                <div className="ml-auto text-[11px] font-semibold text-slate-400">
                  {draftSaving
                    ? 'Salvataggio...'
                    : draftDirty
                      ? 'Modifiche non salvate'
                      : draftSavedAt
                        ? `Salvato ${draftSavedAt.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}`
                        : 'Salvato sul server'}
                </div>
              )}
              {activeWorkbench === 'preview' && hasPreview && (
                <div className="flex min-w-0 items-center gap-2 overflow-x-auto py-1">
                  <div className="inline-flex shrink-0 rounded-[var(--selection-radius)] border border-slate-200 bg-slate-100 p-1">
                    <CodingToolbarIconButton
                      icon={<MonitorPlay className="h-4 w-4" />}
                      label="Desktop"
                      active={previewDevice === 'desktop'}
                      onClick={() => setPreviewDevice('desktop')}
                      title="Anteprima desktop"
                    />
                    <CodingToolbarIconButton
                      icon={<Smartphone className="h-4 w-4" />}
                      label="Mobile"
                      active={previewDevice === 'mobile'}
                      onClick={() => setPreviewDevice('mobile')}
                      title="Anteprima mobile"
                    />
                  </div>
                  {isFork && (
                    <CodingToolbarIconButton
                      icon={publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                      label="Commit"
                      onClick={handleCommitToCreator}
                      disabled={!selectedProjectId || publishing}
                      tone="success"
                      title="Commit to creator"
                    />
                  )}
                  <CodingToolbarIconButton
                    icon={publishing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                    label="Condividi"
                    onClick={handleShareProject}
                    disabled={!selectedProjectId || publishing}
                    title="Condividi in classe"
                  />
                  <CodingToolbarIconButton
                    icon={downloadingZip ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    label="ZIP"
                    onClick={handleDownloadZip}
                    disabled={!selectedProjectId || downloadingZip || publishing}
                    title="Scarica sorgenti e Docker compose"
                  />
                  <CodingToolbarIconButton
                    icon={<Maximize2 className="h-4 w-4" />}
                    label="Schermo"
                    onClick={() => {
                      fullscreenLoads.current = 0
                      fullscreenResets.current = 0
                      setFullscreenNonce((value) => value + 1)
                      setPreviewFullscreen(true)
                    }}
                    title="Pagina intera"
                  />
                </div>
              )}
            </div>
            {activeWorkbench === 'preview' && shareUrl && (
              <div className="border-b border-[rgba(62,169,244,0.18)] bg-[rgba(62,169,244,0.075)] px-4 py-2 text-xs font-semibold text-[#1278bd]">
                {shareUrl}
              </div>
            )}
            {activeWorkbench === 'preview' && previewingCommitId && (
              <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-900">
                Stai testando una proposta di commit. Il codice originale non cambia finche non premi Merge.
              </div>
            )}
            {activeWorkbench === 'preview' && previewingVersionId && !previewingCommitId && (
              <div className="border-b border-sky-200 bg-sky-50 px-4 py-2 text-xs font-semibold text-sky-900">
                Stai visualizzando una versione storica. Usa Rollback per renderla la versione corrente.
              </div>
            )}
            {/* Both panels stay mounted and are toggled via CSS (not conditional rendering) so
                switching Code <-> Preview never tears down the live Sandpack bundler/iframe. */}
            <div className={activeWorkbench === 'code' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}>
              <div className="flex items-center gap-1 overflow-x-auto border-b border-white/10 bg-slate-900 p-2">
                {files.length === 0 && (
                  <span className="px-2 py-1 text-xs text-slate-500">Nessun file — aggiungi contesto o genera</span>
                )}
                {files.map((file) => (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setSelectedPath(file.path)}
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                      selectedFile?.path === file.path ? 'bg-white text-slate-950' : 'bg-white/5 text-slate-300 hover:bg-white/10'
                    }`}
                  >
                    <span>{file.path}</span>
                    {file.path === 'description.md' && (
                      <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase ${
                        selectedFile?.path === file.path ? 'bg-slate-200 text-slate-700' : 'bg-white/10 text-slate-400'
                      }`}>
                        auto
                      </span>
                    )}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={addNewFile}
                  title="Aggiungi file di contesto (knowledge base di progetto)"
                  className="ml-1 inline-flex shrink-0 items-center gap-1 rounded-lg border border-dashed border-white/20 bg-white/5 px-2 py-1.5 text-xs font-semibold text-slate-300 hover:bg-white/10"
                >
                  <Plus className="h-3.5 w-3.5" />
                  File
                </button>
              </div>
              <div className="min-h-0 flex-1 p-3">
                {selectedFile ? (
                  selectedFileIsGeneratedDescription ? (
                    <GeneratedDescriptionPreview file={selectedFile} />
                  ) : (
                    <HighlightedCodeEditor file={selectedFile} onChange={updateSelectedFile} />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-white/10 text-sm text-slate-500">
                    Crea un progetto per vedere il codice.
                  </div>
                )}
              </div>
            </div>
            <div className={activeWorkbench === 'preview' ? `flex min-h-0 flex-1 bg-slate-100 ${previewDevice === 'mobile' ? 'items-start justify-center overflow-auto p-4' : ''}` : 'hidden'}>
            {isReactPreview && files.length > 0 ? (
              <div className={`relative flex min-h-0 ${previewDevice === 'mobile' ? 'h-[844px] max-h-full w-[390px] max-w-full shrink-0 overflow-hidden rounded-[32px] border-[10px] border-slate-950 bg-white shadow-2xl ring-1 ring-slate-900/20' : 'flex-1'}`}>
                <CodingSandpackPreview
                  key={previewIdentityKey}
                  files={files}
                  enableInspector
                  className="h-full w-full"
                  onErrors={handlePreviewErrors}
                  onReady={handlePreviewReady}
                />
                {(autoFixing || (previewErrors.some((e) => e.kind === 'compile') && autoFixAttempts.current >= MAX_AUTO_FIX)) && (
                  <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-2">
                    <div className={`pointer-events-auto flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold shadow-lg ${autoFixing ? 'bg-blue-600 text-white' : 'bg-amber-500 text-white'}`}>
                      {autoFixing ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Correzione automatica degli errori… (tentativo {autoFixAttempts.current}/{MAX_AUTO_FIX})
                        </>
                      ) : (
                        <>
                          <X className="h-3.5 w-3.5" />
                          Errori residui non risolti automaticamente. Descrivi la correzione in chat.
                        </>
                      )}
                    </div>
                  </div>
                )}
                {imageJobStatus && <ImageJobStatusOverlay status={imageJobStatus.status} message={imageJobStatus.message} />}
                {previewLoading && <PreviewLoadingSplash />}
              </div>
            ) : previewHtml ? (
              <div className={`relative flex min-h-0 ${previewDevice === 'mobile' ? 'h-[844px] max-h-full w-[390px] max-w-full shrink-0 overflow-hidden rounded-[32px] border-[10px] border-slate-950 bg-white shadow-2xl ring-1 ring-slate-900/20' : 'flex-1'}`}>
                <iframe
                  key={`${previewKey}:${previewNonce}`}
                  title="Anteprima Vibe Lab"
                  srcDoc={previewHtml}
                  sandbox="allow-scripts allow-forms"
                  referrerPolicy="no-referrer"
                  onLoad={handlePreviewLoad}
                  className="min-h-0 flex-1 border-0 bg-white"
                />
                {imageJobStatus && <ImageJobStatusOverlay status={imageJobStatus.status} message={imageJobStatus.message} />}
                {previewLoading && <PreviewLoadingSplash />}
              </div>
            ) : (
            <div className="flex flex-1 items-center justify-center p-6">
              <div className="w-full max-w-sm rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
                <Bot className="mx-auto h-8 w-8 text-slate-400" />
                <h3 className="mt-3 text-sm font-bold text-slate-800">Preview non ancora generata</h3>
                <p className="mt-2 text-xs leading-relaxed text-slate-500">
                  Scrivi un prompt e genera una mini app. L'anteprima interattiva apparira qui.
                </p>
                {projectDetail?.versions?.[0] && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
                    Versione {projectDetail.versions[0].version_number} · build {projectDetail.versions[0].build_status}
                  </div>
                )}
              </div>
            </div>
            )}
            </div>
          </section>}
        </div>
      </main>
      {previewFullscreen && hasPreview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Eye className="h-4 w-4" />
              Anteprima
            </div>
            <button
              type="button"
              onClick={() => setPreviewFullscreen(false)}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              title="Chiudi anteprima"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {isReactPreview ? (
            <CodingSandpackPreview key={`fullscreen:${previewIdentityKey}`} files={files} enableInspector={false} className="min-h-0 flex-1" />
          ) : (
            <iframe
              key={`fullscreen:${previewKey}:${fullscreenNonce}`}
              title="Anteprima Vibe Lab a pagina intera"
              srcDoc={fullscreenPreviewHtml}
              sandbox="allow-scripts allow-forms"
              referrerPolicy="no-referrer"
              onLoad={handleFullscreenLoad}
              className="min-h-0 flex-1 border-0 bg-white"
            />
          )}
        </div>
      )}
      {diffView && (
        <DiffViewer
          path={diffView.path}
          oldContent={diffView.oldContent}
          newContent={diffView.newContent}
          onClose={() => setDiffView(null)}
          onOpenInEditor={() => {
            setSelectedPath(diffView.path)
            setActiveWorkbench('code')
            setDiffView(null)
          }}
        />
      )}
    </div>
  )
}

const CODING_TUTORIAL_STEPS = [
  {
    num: 0,
    icon: Code2,
    grad: 'from-sky-500 to-indigo-600',
    ring: 'ring-sky-300/40',
    glow: 'shadow-sky-500/25',
    label: 'Panoramica',
    title: 'Benvenuto nel Vibe Lab',
    desc: 'Qui trasformi un’idea in una mini app: descrivi il progetto, scegli uno stile, guarda l’anteprima e chiedi modifiche al chatbot finché il risultato funziona.',
    tips: ['Prompt e cronologia stanno al centro', 'I progetti e le versioni restano nella sidebar', 'Codice e anteprima si alternano a destra'],
    visual: () => (
      <div className="grid grid-cols-[0.72fr_1fr] gap-3">
        <div className="space-y-2 rounded-2xl bg-white/10 p-3">
          <div className="h-7 rounded-xl bg-white/20" />
          <div className="h-7 rounded-xl bg-sky-400/70" />
          <div className="h-16 rounded-xl border border-white/10 bg-white/10" />
        </div>
        <div className="space-y-3 rounded-2xl bg-white/10 p-3">
          <div className="flex gap-1.5">
            <div className="h-6 w-16 rounded-lg bg-indigo-400" />
            <div className="h-6 w-20 rounded-lg bg-white/15" />
          </div>
          <motion.div
            animate={{ scale: [1, 1.02, 1] }}
            transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
            className="h-28 rounded-2xl border border-white/10 bg-gradient-to-br from-white/20 to-white/5"
          />
        </div>
      </div>
    ),
  },
  {
    num: 1,
    icon: Plus,
    grad: 'from-fuchsia-500 to-rose-500',
    ring: 'ring-fuchsia-300/40',
    glow: 'shadow-fuchsia-500/25',
    label: 'Crea',
    title: 'Crea il primo progetto',
    desc: 'Premi Nuovo, dai un titolo chiaro e descrivi cosa deve fare la mini app. Il colloquio iniziale serve a chiarire obiettivo, interazioni e vincoli.',
    tips: ['Usa un titolo breve e riconoscibile', 'Descrivi l’utente finale', 'Indica cosa deve succedere al click, all’input o al download'],
    visual: () => (
      <div className="space-y-3">
        {['Titolo del progetto', 'Prompt iniziale', 'Domande di chiarimento'].map((item, index) => (
          <motion.div
            key={item}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.12, type: 'spring', stiffness: 260 }}
            className="flex items-center gap-3 rounded-2xl bg-white/10 px-3 py-2.5"
          >
            <span className={`flex h-7 w-7 items-center justify-center rounded-xl bg-gradient-to-br ${index === 0 ? 'from-fuchsia-400 to-rose-400' : index === 1 ? 'from-sky-400 to-indigo-400' : 'from-emerald-400 to-teal-400'} text-xs font-black text-white`}>
              {index + 1}
            </span>
            <span className="text-sm font-semibold text-white/85">{item}</span>
          </motion.div>
        ))}
      </div>
    ),
  },
  {
    num: 2,
    icon: Lightbulb,
    grad: 'from-amber-400 to-orange-500',
    ring: 'ring-amber-300/40',
    glow: 'shadow-amber-500/25',
    label: 'Prompt',
    title: 'Scrivi prompt efficaci',
    desc: 'Un buon prompt non dice solo “fammi una pagina bella”: specifica obiettivo, pubblico, contenuti, comportamento, stile e criteri di successo.',
    tips: ['Formula: obiettivo + utenti + schermate + dati + azioni + stile', 'Aggiungi esempi concreti di contenuto', 'Chiedi output verificabili: pulsanti, stati vuoti, errori, responsive'],
    visual: () => (
      <div className="space-y-2.5">
        {[
          ['Obiettivo', 'Crea un simulatore per...'],
          ['Interazioni', 'Input, bottone, risultato, reset'],
          ['Stile', 'Colori, tono, layout, accessibilità'],
          ['Vincoli', 'Niente login, funziona mobile'],
        ].map(([label, text], index) => (
          <motion.div
            key={label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="rounded-xl border border-white/10 bg-white/10 p-2.5"
          >
            <p className="text-xs font-black uppercase tracking-wide text-amber-200">{label}</p>
            <p className="mt-0.5 text-sm text-white/75">{text}</p>
          </motion.div>
        ))}
      </div>
    ),
  },
  {
    num: 3,
    icon: Brush,
    grad: 'from-violet-500 to-purple-600',
    ring: 'ring-violet-300/40',
    glow: 'shadow-violet-500/25',
    label: 'Design',
    title: 'Gestisci il Design System',
    desc: 'Il Design System crea regole condivise per palette, tipografia, bottoni, superfici e priorità visive. Applicalo prima di generare o durante l’iterazione.',
    tips: ['Scegli palette e tono in base al dominio del progetto', 'Mantieni contrasto e leggibilità', 'Salva il contratto di stile nel progetto'],
    visual: () => (
      <div className="space-y-3">
        <div className="grid grid-cols-5 gap-2">
          {['bg-fuchsia-400', 'bg-sky-400', 'bg-amber-300', 'bg-emerald-400', 'bg-violet-400'].map((color, index) => (
            <motion.div
              key={color}
              animate={{ y: [0, -3, 0] }}
              transition={{ repeat: Infinity, duration: 1.8, delay: index * 0.08 }}
              className={`h-9 rounded-xl ${color} shadow-lg`}
            />
          ))}
        </div>
        <div className="rounded-2xl bg-white/10 p-3">
          <div className="mb-2 h-3 w-24 rounded-full bg-white/35" />
          <div className="h-8 rounded-xl border border-white/15 bg-white/15" />
        </div>
      </div>
    ),
  },
  {
    num: 4,
    icon: MonitorPlay,
    grad: 'from-emerald-500 to-teal-600',
    ring: 'ring-emerald-300/40',
    glow: 'shadow-emerald-500/25',
    label: 'Test',
    title: 'Testa codice e anteprima',
    desc: 'Apri Anteprima per provare l’app come utente. Se serve, passa a Codice per controllare i file o usa Pagina intera per testare layout e interazioni.',
    tips: ['Controlla mobile e desktop', 'Prova stati vuoti, errori e casi limite', 'Usa le versioni per tornare indietro se una modifica non convince'],
    visual: () => (
      <div className="rounded-2xl bg-white/10 p-3">
        <div className="mb-3 flex gap-2">
          <span className="rounded-lg bg-white/15 px-3 py-1 text-xs font-bold text-white/55">Codice</span>
          <span className="rounded-lg bg-emerald-400 px-3 py-1 text-xs font-bold text-white">Anteprima</span>
        </div>
        <motion.div
          animate={{ opacity: [0.75, 1, 0.75] }}
          transition={{ repeat: Infinity, duration: 1.8 }}
          className="flex h-32 items-center justify-center rounded-2xl border border-white/10 bg-white/10"
        >
          <MonitorPlay className="h-10 w-10 text-emerald-200" />
        </motion.div>
      </div>
    ),
  },
  {
    num: 5,
    icon: MessageSquare,
    grad: 'from-blue-500 to-cyan-500',
    ring: 'ring-blue-300/40',
    glow: 'shadow-blue-500/25',
    label: 'Itera',
    title: 'Itera con il chatbot',
    desc: 'Dopo la prima generazione chiedi modifiche piccole e verificabili. Il chatbot aggiorna i file, mostra il lavoro degli agenti e salva nuove versioni.',
    tips: ['Una richiesta per volta funziona meglio', 'Scrivi cosa non va e come dovrebbe comportarsi', 'Esempio: “riduci il testo, aggiungi stato loading, migliora il contrasto del bottone”'],
    visual: () => (
      <div className="space-y-2">
        <div className="ml-auto max-w-[82%] rounded-2xl border border-sky-300/50 bg-sky-400/15 px-3 py-2 text-sm font-semibold text-sky-100">
          Aggiungi un filtro per categoria e uno stato vuoto.
        </div>
        <div className="max-w-[82%] rounded-2xl bg-white/10 px-3 py-2 text-sm text-white/75">
          Aggiorno componenti, stato e preview.
        </div>
        <div className="rounded-2xl border border-emerald-300/25 bg-emerald-400/15 p-2.5 text-xs font-bold text-emerald-100">
          File Writer: 4/4 file aggiornati
        </div>
      </div>
    ),
  },
]

function CodingLabTutorialModal({
  onClose,
  onCreateProject,
  onOpenDesignSystem,
}: {
  onClose: () => void
  onCreateProject: () => void
  onOpenDesignSystem: () => void
}) {
  const [active, setActive] = useState(0)
  const step = CODING_TUTORIAL_STEPS[active]
  const StepIcon = step.icon
  const Visual = step.visual
  const isLast = active === CODING_TUTORIAL_STEPS.length - 1

  const next = () => setActive((value) => Math.min(value + 1, CODING_TUTORIAL_STEPS.length - 1))
  const prev = () => setActive((value) => Math.max(value - 1, 0))

  return (
    <motion.div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/72 p-4 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label="Tutorial Vibe Lab"
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.97 }}
        transition={{ duration: 0.24 }}
        className="relative max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-indigo-950 shadow-2xl"
      >
        <div className="pointer-events-none absolute right-0 top-0 h-80 w-80 translate-x-20 -translate-y-24 rounded-full bg-sky-400/10 blur-2xl" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-72 w-72 -translate-x-16 translate-y-20 rounded-full bg-fuchsia-400/10 blur-2xl" />

        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/60 transition hover:bg-white/20 hover:text-white"
          title="Chiudi tutorial"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="relative grid max-h-[92vh] grid-cols-1 overflow-y-auto lg:grid-cols-[0.92fr_1.08fr]">
          <div className="flex flex-col p-6 md:p-8">
            <div className="mb-6">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-sky-300" />
                <span className="text-xs font-black uppercase tracking-widest text-sky-300">Tutorial Vibe Lab</span>
              </div>
              <h2 className="text-3xl font-black leading-tight text-white">
                Costruisci mini app con metodo
              </h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-white/55">
                Una guida rapida per partire, progettare lo stile, testare l’anteprima e iterare con richieste precise.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-3">
              {CODING_TUTORIAL_STEPS.map((item, index) => {
                const Icon = item.icon
                const selected = index === active
                return (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => setActive(index)}
                    className={`relative rounded-2xl p-3 text-left transition ${
                      selected ? `bg-white/15 ring-1 ${item.ring}` : 'bg-white/5 hover:bg-white/10'
                    }`}
                  >
                    <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${item.grad} ${selected ? `shadow-lg ${item.glow}` : ''}`}>
                      <Icon className="text-white" style={{ width: 18, height: 18 }} />
                    </div>
                    <p className={`text-xs font-black ${selected ? 'text-white' : 'text-white/50'}`}>{item.label}</p>
                    {selected && (
                      <motion.div
                        layoutId="coding-tutorial-step"
                        className={`absolute bottom-0 left-3 right-3 h-0.5 rounded-full bg-gradient-to-r ${item.grad}`}
                      />
                    )}
                  </button>
                )
              })}
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-4">
              <p className="mb-3 text-xs font-black uppercase tracking-widest text-white/45">Prompting efficace</p>
              <div className="grid gap-2">
                {['Obiettivo', 'Pubblico', 'Interazioni', 'Stile', 'Vincoli'].map((item, index) => (
                  <div key={item} className="flex items-center gap-2 text-sm text-white/70">
                    <CheckCircle2 className={`h-4 w-4 ${index < 2 ? 'text-sky-300' : index < 4 ? 'text-amber-300' : 'text-emerald-300'}`} />
                    <span>{item}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex min-h-[560px] flex-col border-t border-white/10 bg-white/[0.035] p-6 md:p-8 lg:border-l lg:border-t-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={active}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.22 }}
                className="flex flex-1 flex-col"
              >
                <div className={`mb-5 inline-flex w-fit items-center gap-2 rounded-full bg-gradient-to-r ${step.grad} px-3 py-1.5`}>
                  <span className="text-xs font-black text-white">{step.num === 0 ? 'SPLASH' : `STEP ${step.num}`}</span>
                  <StepIcon className="h-3.5 w-3.5 text-white/85" />
                </div>

                <h3 className="text-2xl font-black text-white">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/60">{step.desc}</p>

                <div className="my-6 rounded-3xl border border-white/10 bg-white/5 p-4">
                  <Visual />
                </div>

                <div className="grid gap-2">
                  {step.tips.map((tip) => (
                    <div key={tip} className="flex items-start gap-2 rounded-2xl bg-white/[0.07] px-3 py-2.5">
                      <ListChecks className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                      <p className="text-sm leading-snug text-white/72">{tip}</p>
                    </div>
                  ))}
                </div>
              </motion.div>
            </AnimatePresence>

            <div className="mt-6 flex flex-col gap-3 border-t border-white/10 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-1.5">
                {CODING_TUTORIAL_STEPS.map((_, index) => (
                  <button
                    key={index}
                    type="button"
                    onClick={() => setActive(index)}
                    className={`h-2 rounded-full transition-all ${index === active ? 'w-8 bg-white' : 'w-2 bg-white/25 hover:bg-white/45'}`}
                    title={`Vai allo step ${index + 1}`}
                  />
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={prev}
                  disabled={active === 0}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-bold text-white/65 transition hover:bg-white/10 disabled:opacity-35"
                >
                  Indietro
                </button>
                {step.num === 3 ? (
                  <button
                    type="button"
                    onClick={onOpenDesignSystem}
                    className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r ${step.grad} px-4 text-sm font-black text-white shadow-lg`}
                  >
                    Apri Design System
                    <Palette className="h-4 w-4" />
                  </button>
                ) : isLast ? (
                  <button
                    type="button"
                    onClick={onCreateProject}
                    className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r ${step.grad} px-4 text-sm font-black text-white shadow-lg`}
                  >
                    Crea progetto
                    <Wand2 className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={next}
                    className={`inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r ${step.grad} px-4 text-sm font-black text-white shadow-lg`}
                  >
                    Continua
                    <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function PreviewLoadingSplash() {
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[rgba(251,250,252,0.82)] backdrop-blur-sm">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/70 bg-white/90 px-8 py-7 text-center shadow-[var(--shadow-xl)]">
        <div className="coding-preview-cube" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="text-sm font-black text-[var(--text-primary)]">Caricamento anteprima</p>
          <p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">Preparo il sandbox del progetto</p>
        </div>
      </div>
    </div>
  )
}

function ImageJobStatusOverlay({ status, message }: { status: 'generating' | 'optimizing' | 'ready' | 'error'; message: string }) {
  const done = status === 'ready'
  const failed = status === 'error'
  return (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-30 flex justify-center px-3">
      <div className={`pointer-events-auto flex max-w-[min(92%,420px)] items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold shadow-lg backdrop-blur-xl ${
        failed
          ? 'border-rose-200 bg-rose-50/95 text-rose-700'
          : done
            ? 'border-emerald-200 bg-emerald-50/95 text-emerald-700'
            : 'border-sky-200 bg-white/95 text-sky-700'
      }`}>
        {failed ? (
          <X className="h-3.5 w-3.5 shrink-0" />
        ) : done ? (
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        ) : (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        )}
        <span className="truncate">{message}</span>
      </div>
    </div>
  )
}

function SidebarVersioningPanel({
  selectedProject,
  isFork,
  upstreamStatus,
  sortedVersions,
  pendingCommits,
  publishing,
  onPullUpstream,
  onRefreshCommits,
  onOpenVersion,
  onRollbackVersion,
  onOpenCommit,
  onMergeCommit,
}: {
  selectedProject: CodingProject | null
  isFork: boolean
  upstreamStatus: UpstreamStatus | null
  sortedVersions: CodingVersion[]
  pendingCommits: CodingCommit[]
  publishing: boolean
  onPullUpstream: () => void
  onRefreshCommits: () => void
  onOpenVersion: (version: CodingVersion) => void
  onRollbackVersion: (versionId: string) => void
  onOpenCommit: (commit: CodingCommit) => void
  onMergeCommit: (commitId: string) => void
}) {
  if (!selectedProject) {
    return null
  }

  return (
    <div className="hidden h-[34vh] min-h-[240px] max-h-[420px] shrink-0 flex-col border-t border-[color:var(--border-subtle)] bg-[var(--surface-muted)] p-3 text-[13px] lg:flex">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-black uppercase tracking-wide text-[var(--text-secondary)]">Versioning</h3>
          <p className="text-xs text-[var(--text-secondary)]">{sortedVersions.length} versioni · {pendingCommits.length} commit</p>
        </div>
        <Button
          type="button"
          onClick={onRefreshCommits}
          variant="ghost"
          size="icon"
          title="Aggiorna commit"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      </div>

      {isFork && upstreamStatus?.update_available && (
        <div className="mb-2 rounded-lg border border-[color:var(--border-subtle)] bg-[var(--surface-card)] p-2.5 shadow-sm">
          <p className="text-xs font-bold text-amber-950">Nuova v{upstreamStatus.source_version_number} del creatore</p>
          <p className="mt-0.5 text-[11px] text-amber-900/75">
            {upstreamStatus.file_count ?? 0} file · {upstreamStatus.total_lines ?? 0} righe
          </p>
          <Button
            type="button"
            onClick={onPullUpstream}
            disabled={publishing}
            tone="warning"
            surface="soft"
            density="compact"
            fullWidth
            className="mt-2 text-xs font-bold"
          >
            Aggiorna copia
          </Button>
        </div>
      )}

      {pendingCommits.length > 0 && (
        <div className="mb-3 shrink-0">
          <div className="mb-1 flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wide text-[var(--logo-blue-strong)]">Commit</h4>
            <span className="rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold text-sky-700">{pendingCommits.length}</span>
          </div>
          <div className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
            {pendingCommits.map((commit) => (
              <div key={commit.id} className="rounded-lg border border-[color:var(--border-subtle)] bg-[var(--surface-card)] p-2.5 shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-xs font-bold text-slate-900">{commit.contributor_name}</p>
                  <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase ${commit.status === 'merged' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                    {commit.status}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-500">{commit.files.length} file · {commit.summary?.total_lines ?? 0} righe</p>
                <div className="mt-2 flex gap-1">
                  <Button
                    type="button"
                    onClick={() => onOpenCommit(commit)}
                    variant="outline"
                    density="compact"
                    className="h-8 flex-1 text-[11px] font-bold"
                  >
                    Testa
                  </Button>
                  <Button
                    type="button"
                    onClick={() => onMergeCommit(commit.id)}
                    disabled={publishing || commit.status === 'merged'}
                    density="compact"
                    className="h-8 flex-1 text-[11px] font-bold"
                  >
                    Merge
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {sortedVersions.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-1 flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wide text-[var(--text-secondary)]">Versioni</h4>
            <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-bold text-slate-600">{sortedVersions.length}</span>
          </div>
          <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
            {sortedVersions.map((version) => (
              <CollapsibleVersionRow
                key={version.id}
                version={version}
                isCurrent={version.id === selectedProject.current_version_id}
                publishing={publishing}
                onOpen={() => onOpenVersion(version)}
                onRollback={() => onRollbackVersion(version.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CollapsibleVersionRow({
  version,
  isCurrent,
  publishing,
  onOpen,
  onRollback,
}: {
  version: CodingVersion
  isCurrent: boolean
  publishing: boolean
  onOpen: () => void
  onRollback: () => void
}) {
  const [open, setOpen] = useState(false)
  const versionFiles = version.source_manifest_json?.files || []
  const totalLines = versionFiles.reduce((sum, file) => sum + (file.content ? file.content.split('\n').length : 0), 0)

  return (
    <div className={`rounded-lg border shadow-sm ${isCurrent ? 'border-[color:var(--app-accent,var(--primary))] bg-[var(--surface-card)]' : 'border-[color:var(--border-subtle)] bg-[var(--surface-card)]'}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left"
      >
        <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="text-xs font-black text-slate-900">v{version.version_number}</span>
        {isCurrent && <span className="rounded-full bg-[var(--app-accent,var(--primary))] px-1.5 py-0.5 text-[8px] font-bold text-white">corrente</span>}
        <span className="ml-auto truncate text-[10px] text-slate-400">{versionFiles.length} file · {totalLines} righe</span>
      </button>
      {open && (
        <div className="px-2.5 pb-2.5">
          <p className="line-clamp-4 text-xs text-[var(--text-secondary)]">{version.source_manifest_json?.summary || 'Versione salvata'}</p>
          <div className="mt-2 flex gap-1">
            <Button
              type="button"
              onClick={onOpen}
              disabled={versionFiles.length === 0}
              variant="outline"
              density="compact"
              className="h-8 flex-1 text-[11px] font-bold"
            >
              Apri
            </Button>
            <Button
              type="button"
              onClick={onRollback}
              disabled={publishing || isCurrent || versionFiles.length === 0}
              density="compact"
              className="h-8 flex-1 text-[11px] font-bold"
            >
              <RotateCcw className="mr-1 inline h-3 w-3" />
              Rollback
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function LiveGenerationPanel({
  status,
  reasoning,
  plan,
  files,
}: {
  status: string
  reasoning: string
  plan: { path: string; purpose: string }[]
  files: { path: string; lines: number; status: 'writing' | 'done' }[]
}) {
  const reasoningRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    reasoningRef.current?.scrollTo({ top: reasoningRef.current.scrollHeight })
  }, [reasoning])

  const doneCount = files.filter((file) => file.status === 'done').length

  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 text-xs font-semibold leading-5 text-indigo-900" role="status" aria-live="polite">
        <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
        <span>{status || 'Avvio della generazione…'}</span>
      </div>
      <div className="rounded-2xl border border-amber-300/55 bg-amber-50/85 p-3 shadow-sm ring-1 ring-amber-100/80">
        <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-wide text-amber-800">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {reasoning ? "Architetto" : 'Sto progettando la struttura...'}
        </div>
        {reasoning && (
          <div ref={reasoningRef} className="h-48 overflow-y-auto rounded-xl border border-amber-200/80 bg-white/[0.82] p-3 text-slate-800">
            <ReasoningMarkdown>{reasoning}</ReasoningMarkdown>
          </div>
        )}
      </div>

      {files.length > 0 && (
        <div className="rounded-2xl border border-sky-300/60 bg-sky-50/90 p-3 shadow-sm ring-1 ring-sky-100/80">
          <div className="mb-2 flex items-center justify-between text-xs font-black uppercase tracking-wide text-sky-700">
            <span>File Writer</span>
            <span>{doneCount}/{files.length} file</span>
          </div>
          <div className="h-36 space-y-1 overflow-y-auto rounded-xl border border-sky-200/75 bg-white/[0.82] p-2 font-code">
            {files.map((file) => (
              <div key={file.path} className="flex items-center gap-2 text-sm text-slate-700">
                {file.status === 'done'
                  ? <Check className="h-3.5 w-3.5 shrink-0 text-sky-700" />
                  : <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-sky-400" />}
                <span className="min-w-0 flex-1 truncate">{file.path}</span>
                <span className="shrink-0 text-xs font-bold text-sky-700">{file.lines} ln</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {plan.length === 0 && files.length === 0 && reasoning && (
        <p className="px-1 text-xs text-slate-500">Sto definendo i file da creare...</p>
      )}
    </div>
  )
}

function ConversationBubble({ item, onShowFileDiff }: { item: CodingMessage; onShowFileDiff: (path: string) => void }) {
  const isUser = item.role === 'user' || item.actor_type === 'student' || item.actor_type === 'teacher'
  const kind = item.metadata_json?.kind
  const isFeedback = kind === 'agent_feedback' || kind === 'agent_progress' || kind === 'file_write_summary' || kind === 'agent_reasoning'
  const label = isUser ? 'Tu' : item.agent_name || 'Agente'

  if (isFeedback) {
    const isFileSummary = kind === 'file_write_summary'
    const isReasoning = kind === 'agent_reasoning'
    const changedFiles = Array.isArray(item.metadata_json?.files)
      ? item.metadata_json.files.filter((file: any) => file?.path && file?.status !== 'invariato' && file?.status !== 'rimosso')
      : []
    const tone = isFileSummary
      ? { border: 'border-sky-300/60 bg-sky-50/90 ring-1 ring-sky-100/80', label: 'text-sky-700', text: 'text-slate-700', inner: 'border-sky-200/75 bg-white/[0.82]' }
      : isReasoning
        ? { border: 'border-amber-300/55 bg-amber-50/85 ring-1 ring-amber-100/80', label: 'text-amber-800', text: 'text-slate-800', inner: 'border-amber-200/80 bg-white/[0.82]' }
        : { border: 'border-[color:var(--border-subtle)] bg-[var(--surface-muted)]', label: 'text-[color:var(--text-secondary)]', text: 'text-[color:var(--text-primary)]', inner: 'border-white/70 bg-white/70' }
    return (
      <div className={`rounded-xl border px-3 py-2.5 shadow-sm ${tone.border}`}>
        <div className={`mb-1.5 text-xs font-black uppercase tracking-wide ${tone.label}`}>
          {label}
        </div>
        {isReasoning ? (
          <div className={`h-48 overflow-y-auto rounded-xl border p-3 ${tone.inner} ${tone.text}`}>
            <ReasoningMarkdown>{item.content}</ReasoningMarkdown>
          </div>
        ) : (
          <p className={`max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed ${tone.text}`}>
            {item.content}
          </p>
        )}
        {isFileSummary && changedFiles.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {changedFiles.map((file: any) => (
              <button
                key={file.path}
                type="button"
                onClick={() => onShowFileDiff(String(file.path))}
                className="rounded-full border border-[rgba(62,169,244,0.24)] bg-white/75 px-2 py-1 text-xs font-bold text-[#1278bd] hover:border-[rgba(62,169,244,0.42)]"
                title="Mostra modifiche (rosso = prima, celeste = dopo)"
              >
                {file.path} · {file.lines} righe
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[92%] rounded-2xl px-3.5 py-3 shadow-sm ${
        isUser
          ? 'coding-user-bubble rounded-br-md text-[var(--logo-blue-strong)]'
          : 'rounded-bl-md border border-[color:var(--border-subtle)] bg-white text-[color:var(--text-primary)]'
      }`}>
        <div className={`mb-1 text-[11px] font-black uppercase tracking-wide ${isUser ? 'text-[var(--logo-blue-strong)]/70' : 'text-[color:var(--text-secondary)]'}`}>
          {label}
        </div>
        {Array.isArray(item.metadata_json?.attachments) && item.metadata_json.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {item.metadata_json.attachments.map((src: string, idx: number) => (
              <img key={idx} src={src} alt={`Allegato ${idx + 1}`} className="h-14 w-14 rounded-lg border border-white/40 object-cover" />
            ))}
          </div>
        )}
        <p className="whitespace-pre-wrap text-xs leading-relaxed">{item.content}</p>
      </div>
    </div>
  )
}

// The preview iframe has no network: strip external resources so older projects (saved before the
// server-side sanitizer) don't spam CORS/500/connection errors. External fonts/scripts are removed,
// external <img> get an inline placeholder, external CSS url()/@import are neutralised.
const PREVIEW_PLACEHOLDER_IMG = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect width='400' height='300' fill='%23e2e8f0'/%3E%3C/svg%3E"
function stripExternalRefs(content: string, kind: 'html' | 'css'): string {
  if (kind === 'html') {
    return content
      .replace(/<link\b[^>]*href=["']https?:\/\/[^"']+["'][^>]*>/gi, '')
      .replace(/<script\b[^>]*\bsrc=["']https?:\/\/[^"']+["'][^>]*>\s*<\/script>/gi, '')
      .replace(/(<img\b[^>]*?\bsrc=)["']https?:\/\/[^"']*["']/gi, `$1"${PREVIEW_PLACEHOLDER_IMG}"`)
  }
  return content
    .replace(/@import[^;]*https?:\/\/[^;]*;/gi, '')
    .replace(/url\(\s*["']?https?:\/\/[^)]*\)/gi, 'none')
}

// New projects are real React/Vite apps (rendered by Sandpack); legacy projects are static
// index.html/styles.css/script.js (rendered by the srcDoc preview). Detect by file shape.
function isReactProject(files: GeneratedFile[]): boolean {
  if (files.some((f) => /\.(tsx|jsx)$/i.test(f.path))) return true
  const pkg = files.find((f) => f.path.replace(/^\.?\//, '') === 'package.json')
  if (pkg && /"react"\s*:/.test(pkg.content)) return true
  return false
}

async function waitForImageUrl(url: string, timeoutMs = 12000): Promise<void> {
  if (!/^https?:\/\//i.test(url) && !url.startsWith('/')) return
  const started = Date.now()
  let delay = 250
  while (Date.now() - started < timeoutMs) {
    try {
      let response = await fetch(url, { method: 'HEAD', cache: 'no-store' })
      if (response.status === 405 || response.status === 501) {
        response = await fetch(url, { method: 'GET', cache: 'no-store' })
      }
      const contentType = response.headers.get('content-type') || ''
      if (response.ok && contentType.startsWith('image/')) return
    } catch {
      // Static files can lag behind the API response briefly; retry below.
    }
    await new Promise((resolve) => window.setTimeout(resolve, delay))
    delay = Math.min(delay + 250, 1500)
  }
}

function buildPreviewHtml(files: GeneratedFile[], options: { enableInspector?: boolean } = {}) {
  if (!files.length) return ''
  const clean = (file: GeneratedFile) => {
    const low = file.path.toLowerCase()
    if (low.endsWith('.css')) return stripExternalRefs(file.content, 'css')
    if (low.endsWith('.html') || low.endsWith('.htm')) return stripExternalRefs(file.content, 'html')
    return file.content
  }
  const byPath = new Map(files.map((file) => [file.path, clean(file)]))
  const html = byPath.get('index.html') || '<!doctype html><html><head></head><body><main id="app"></main></body></html>'
  const css = byPath.get('styles.css') || ''
  const js = byPath.get('script.js') || ''
  const htmlFiles = Object.fromEntries(
    files
      .filter((file) => file.path.endsWith('.html'))
      .map((file) => [file.path, stripExternalRefs(file.content, 'html')]),
  )
  const safeCss = css.replace(/<\/style/gi, '<\\/style')
  const safeJs = js.replace(/<\/script/gi, '<\\/script')
  const wrappedJs = safeJs ? `<script>(() => {\n${safeJs}\n})();<\/script>` : ''

  let output = html
    .replace(/<link[^>]+href=["']styles\.css["'][^>]*>/i, `<style data-golinelli-shared-css>${safeCss}</style>`)
    .replace(/<script[^>]+src=["']script\.js["'][^>]*>\s*<\/script>/i, wrappedJs)

  if (!/<style[\s>]/i.test(output) && safeCss) {
    output = output.replace(/<\/head>/i, `<style data-golinelli-shared-css>${safeCss}</style></head>`)
  }
  if (!/<script[\s>]/i.test(output) && wrappedJs) {
    output = output.replace(/<\/body>/i, `${wrappedJs}</body>`)
  }
  return injectPreviewRuntime(output, htmlFiles, safeCss, safeJs, options)
}

function injectPreviewRuntime(html: string, htmlFiles: Record<string, string>, css: string, js: string, options: { enableInspector?: boolean } = {}) {
  const sitePayload = JSON.stringify({ htmlFiles, css, js, enableInspector: options.enableInspector !== false }).replace(/</g, '\\u003c')
  const runtime = `<script>
(() => {
  const site = ${sitePayload};
  const pending = new Map();
  window.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.source !== 'golinelli-coding-host' || !pending.has(data.id)) return;
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    data.ok ? resolve(data.result) : reject(new Error(data.error || 'Chiamata AI non riuscita.'));
  });
  function callHost(action, payload, timeoutMs = 60000) {
    return new Promise((resolve, reject) => {
      const id = 'coding_' + Date.now() + '_' + Math.random().toString(36).slice(2);
      pending.set(id, { resolve, reject });
      window.parent.postMessage({ source: 'golinelli-coding-preview', id, action, payload }, '*');
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error('La chiamata AI ha impiegato troppo tempo.'));
      }, timeoutMs);
    });
  }
  window.GolinelliAI = {
    chat: ({ content, history = [], profileKey = 'tutor', provider, model } = {}) =>
      callHost('chat', { content, history, profileKey, provider, model }),
    generateImage: (args = {}) => {
      const payload = typeof args === 'string'
        ? { prompt: args, provider: 'gpt-image-2-2026-04-21' }
        : { prompt: args.prompt, provider: args.provider || 'gpt-image-2-2026-04-21' };
      const notify = (status, message, result) => {
        if (typeof args === 'object' && typeof args.onStatus === 'function') args.onStatus({ status, message, result });
        window.dispatchEvent(new CustomEvent('golinelli:image-status', { detail: { status, message, result } }));
      };
      notify('generating', 'Genero l’immagine…');
      return callHost('generateImage', payload, 180000)
        .then((result) => {
          notify('ready', 'Immagine pronta.', result);
          return result;
        })
        .catch((error) => {
          notify('error', error && error.message ? error.message : 'Generazione immagine non riuscita.');
          throw error;
        });
    },
    saveData: ({ key, value } = {}) => callHost('saveData', { key, value }),
    loadData: ({ key } = {}) => callHost('loadData', { key }),
    deleteData: ({ key } = {}) => callHost('deleteData', { key }),
  };
  function cssPathFor(node) {
    if (!node || node.nodeType !== 1) return '';
    const parts = [];
    let current = node;
    while (current && current.nodeType === 1 && current !== document.body) {
      let part = current.tagName.toLowerCase();
      if (current.id) {
        part += '#' + current.id;
        parts.unshift(part);
        break;
      }
      const className = String(current.className || '').trim().split(/\\s+/).filter(Boolean).slice(0, 2).join('.');
      if (className) part += '.' + className;
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }
  function initInspector() {
    if (!site.enableInspector || document.querySelector('.golinelli-agent-button')) return;
    if (!document.body) return;
    if (!document.getElementById('golinelli-agent-style')) {
      const style = document.createElement('style');
      style.id = 'golinelli-agent-style';
      style.textContent = '.golinelli-agent-target{outline:2px solid #2563eb!important;outline-offset:2px!important}.golinelli-agent-button{position:fixed;z-index:2147483647;display:none;align-items:center;gap:4px;border:none;border-radius:999px;background:#2563eb;color:#fff;box-shadow:0 6px 18px rgba(37,99,235,.45);padding:5px 9px;font:700 11px/1 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}.golinelli-agent-button:hover{background:#1d4ed8}';
      document.head.appendChild(style);
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'golinelli-agent-button';
    button.title = "Chiedi all'AI di migliorare questa sezione";
    button.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 2l1.9 5.4L19.3 9l-5.4 1.6L12 16l-1.9-5.4L4.7 9l5.4-1.6L12 2zm6.5 11l.95 2.55L22 16.5l-2.55.95L18.5 20l-.95-2.55L15 16.5l2.55-.95L18.5 13z"/></svg><span>AI</span>';
    document.body.appendChild(button);
    let target = null;
    const pickTarget = (node) => {
      const element = node?.closest?.('section, article, main, header, footer, nav, form, aside, div');
      if (!element || element === document.body || element === document.documentElement || element === button) return null;
      if (element.closest?.('.golinelli-agent-button')) return null;
      return element;
    };
    document.addEventListener('mousemove', (event) => {
      // While hovering the button itself, keep it (and the current target) visible so it
      // can actually be clicked — otherwise it hides the instant the cursor reaches it.
      if (event.target === button || event.target?.closest?.('.golinelli-agent-button')) return;
      const next = pickTarget(event.target);
      if (target && target !== next) target.classList.remove('golinelli-agent-target');
      target = next;
      if (!target) {
        button.style.display = 'none';
        return;
      }
      target.classList.add('golinelli-agent-target');
      // Pin the icon to the element's top-right corner so it stays put and is easy to click.
      button.style.display = 'inline-flex';
      const rect = target.getBoundingClientRect();
      const bw = button.offsetWidth || 52;
      const bh = button.offsetHeight || 24;
      let left = rect.right - bw - 6;
      let top = rect.top + 6;
      left = Math.max(6, Math.min(left, window.innerWidth - bw - 6));
      top = Math.max(6, Math.min(top, window.innerHeight - bh - 6));
      button.style.left = left + 'px';
      button.style.top = top + 'px';
    }, true);
    document.addEventListener('mouseleave', () => {
      if (target) target.classList.remove('golinelli-agent-target');
      target = null;
      button.style.display = 'none';
    });
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!target) return;
      const original = button.innerHTML;
      try {
        await callHost('askAgent', {
          selector: cssPathFor(target),
          tagName: target.tagName.toLowerCase(),
          text: (target.innerText || '').trim(),
          html: target.outerHTML || ''
        });
        button.textContent = '✓ Inserito';
        setTimeout(() => { button.innerHTML = original; }, 1200);
      } catch (err) {}
    });
  }
  function scheduleInspector() {
    if (!site.enableInspector) return;
    if (document.body) {
      requestAnimationFrame(initInspector);
      return;
    }
    document.addEventListener('DOMContentLoaded', initInspector, { once: true });
  }
  function previewPageCandidate(value) {
    const clean = String(value || '').replace(/^#/, '').replace(/^\\.\\//, '').split('#')[0].split('?')[0].replace(/^\\//, '');
    if (!clean || clean === '/') return '';
    return clean.endsWith('.html') ? clean : clean + '.html';
  }
  function normalizePreviewPath(raw) {
    let hashCandidate = '';
    let pathCandidate = '';
    try {
      const url = new URL(raw, window.location.href);
      hashCandidate = previewPageCandidate(url.hash.slice(1));
      pathCandidate = previewPageCandidate(url.pathname.split('/').pop() || '');
    } catch {}
    const rawHash = String(raw || '').split('#')[1] || '';
    hashCandidate = hashCandidate || previewPageCandidate(rawHash);
    pathCandidate = pathCandidate || previewPageCandidate(String(raw || '').split('#')[0]);
    if (hashCandidate && site.htmlFiles[hashCandidate]) return hashCandidate;
    if (pathCandidate && site.htmlFiles[pathCandidate]) return pathCandidate;
    return pathCandidate || '';
  }
  function runSharedScript() {
    if (!site.js) return;
    const script = document.createElement('script');
    script.textContent = '(() => {\\n' + site.js + '\\n})();';
    document.body.appendChild(script);
  }
  function runInlineScript(source) {
    if (!source) return;
    const script = document.createElement('script');
    script.textContent = source;
    document.body.appendChild(script);
  }
  function renderLinkedPreviewPage(path) {
    const nextPath = normalizePreviewPath(path);
    const nextHtml = site.htmlFiles[nextPath];
    if (!nextHtml) return false;
    const parser = new DOMParser();
    const doc = parser.parseFromString(nextHtml, 'text/html');
    document.title = doc.querySelector('title')?.textContent || document.title;
    document.querySelectorAll('[data-golinelli-page-head]').forEach((node) => node.remove());
    doc.head.querySelectorAll('style').forEach((node) => {
      const style = document.createElement('style');
      style.setAttribute('data-golinelli-page-head', 'true');
      style.textContent = node.textContent || '';
      document.head.appendChild(style);
    });
    if (site.css) {
      document.querySelector('style[data-golinelli-shared-css]')?.remove();
      const style = document.createElement('style');
      style.setAttribute('data-golinelli-shared-css', 'true');
      style.textContent = site.css;
      document.head.appendChild(style);
    }
    const inlineScripts = [];
    doc.querySelectorAll('script').forEach((node) => {
      const src = node.getAttribute('src') || '';
      if (/script\\.js$/i.test(src)) return;
      if (node.textContent) inlineScripts.push(node.textContent);
      node.remove();
    });
    document.body.innerHTML = doc.body.innerHTML;
    runSharedScript();
    inlineScripts.forEach(runInlineScript);
    initInspector();
    return true;
  }
  document.addEventListener('click', (event) => {
    const link = event.target?.closest?.('a[href]');
    if (!link) return;
    const href = link.getAttribute('href') || '';
    if (href.startsWith('mailto:') || href.startsWith('tel:')) return;
    if (href.startsWith('http://') || href.startsWith('https://')) {
      event.preventDefault();
      callHost('openExternalLink', { url: href }).catch(() => {});
      return;
    }
    // In-page hash navigation. A srcdoc iframe resolves an <a href="#x"> against the PARENT page
    // URL, so the default click would navigate the iframe to the platform (CORS/sessionStorage
    // spam). Prevent that and set the hash programmatically — that stays on about:srcdoc and still
    // fires hashchange, so hash-based routers keep working inside the sandbox.
    if (href.startsWith('#')) {
      event.preventDefault();
      const id = href.slice(1);
      if (id) {
        try { window.location.hash = id; } catch (e) {}
        const el = document.getElementById(id);
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }
    // Any other relative link: never let it navigate out of the sandbox.
    event.preventDefault();
    const nextPath = normalizePreviewPath(href);
    if (nextPath && site.htmlFiles[nextPath]) renderLinkedPreviewPage(nextPath);
  }, true);
  document.addEventListener('submit', (event) => { event.preventDefault(); }, true);
  // SPA routers using the History API with a path (e.g. pushState('/view')) would set the URL to
  // the parent origin and can trigger a navigation to the platform. Keep history hash-only.
  try {
    const _push = history.pushState.bind(history);
    const _replace = history.replaceState.bind(history);
    const safeUrl = (u) => (typeof u === 'string' && u.indexOf('#') === 0) ? u : null;
    history.pushState = function (s, t, u) { try { return _push(s, t, safeUrl(u)); } catch (e) {} };
    history.replaceState = function (s, t, u) { try { return _replace(s, t, safeUrl(u)); } catch (e) {} };
  } catch (e) {}
  const nativeOpen = window.open;
  window.open = function (url) {
    const target = typeof url === 'string' ? url : '';
    if (target.startsWith('http://') || target.startsWith('https://')) {
      callHost('openExternalLink', { url: target }).catch(() => {});
    }
    return null;
  };
  void nativeOpen;
  scheduleInspector();
})();
<\/script>`

  if (/<\/head>/i.test(html)) {
    return html.replace(/<\/head>/i, `${runtime}</head>`)
  }
  return `${runtime}${html}`
}

function GeneratedDescriptionPreview({ file }: { file: GeneratedFile }) {
  const lineCount = file.content.split('\n').length
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0f172a]">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-slate-900 px-3 py-2">
        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-100">
          markdown generato · {lineCount} ln
        </span>
        <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          Compilato dal prompt
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="mb-3 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs font-semibold leading-relaxed text-emerald-50">
          Questo documento si aggiorna automaticamente dal prompt e dalle risposte alle domande. Per cambiare il progetto, usa il prompt a sinistra.
        </div>
        <div className="rounded-lg border border-white/10 bg-slate-950/70 px-4 py-3 text-slate-100">
          <ReasoningMarkdown dark>{file.content}</ReasoningMarkdown>
        </div>
      </div>
    </div>
  )
}

function HighlightedCodeEditor({ file, onChange }: { file: GeneratedFile; onChange: (content: string) => void }) {
  const language = languageForFile(file)
  const lineCount = file.content.split('\n').length
  const extensions = useMemo(() => [
    ...getEditorExtensions('p5js', 'dark', 'jetbrains', editorKeymap(() => undefined), 450),
    EditorView.theme({
      '&': { height: '100%' },
      '.cm-editor': { height: '100%' },
      '.cm-scroller': { minHeight: '100%', overflow: 'auto' },
      '.cm-content': {
        minHeight: '100%',
        padding: '14px 0',
      },
      '.cm-line': {
        padding: '0 14px',
      },
    }),
  ], [])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0f172a]">
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-slate-900 px-3 py-2">
        <span className="rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 font-mono text-[10px] font-bold text-sky-100">
          {language} · {lineCount} ln
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">CodeMirror</span>
      </div>
      <CodeMirror
        value={file.content}
        onChange={onChange}
        extensions={extensions}
        height="100%"
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightSpecialChars: true,
          foldGutter: false,
          drawSelection: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          syntaxHighlighting: false,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: true,
          rectangularSelection: true,
          crosshairCursor: false,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          closeBracketsKeymap: true,
          defaultKeymap: true,
          searchKeymap: true,
          historyKeymap: true,
          foldKeymap: false,
          completionKeymap: true,
          lintKeymap: false,
        }}
        className="min-h-0 flex-1 text-[13px]"
        aria-label={`Modifica ${file.path}`}
      />
    </div>
  )
}

function languageForFile(file: GeneratedFile) {
  const language = (file.language || '').toLowerCase()
  if (language === 'javascript' || language === 'js') return 'javascript'
  if (language === 'typescript' || language === 'ts') return 'typescript'
  if (language === 'css') return 'css'
  if (language === 'html' || language === 'markup') return 'markup'
  if (language === 'json') return 'json'
  if (file.path.endsWith('.js')) return 'javascript'
  if (file.path.endsWith('.ts')) return 'typescript'
  if (file.path.endsWith('.css')) return 'css'
  if (file.path.endsWith('.html')) return 'markup'
  if (file.path.endsWith('.json')) return 'json'
  return 'text'
}

type DiffRow =
  | { collapsed: true; count: number }
  | { collapsed?: false; type: 'same' | 'add' | 'del'; text: string }

// Line-level diff (LCS) between the previous and latest version of a file.
function computeLineDiff(oldText: string, newText: string): { type: 'same' | 'add' | 'del'; text: string }[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length
  // Guard against pathological O(n*m) blow-ups on very large files.
  if (n > 2000 || m > 2000) {
    return [
      ...a.map((text) => ({ type: 'del' as const, text })),
      ...b.map((text) => ({ type: 'add' as const, text })),
    ]
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: { type: 'same' | 'add' | 'del'; text: string }[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i] })
      i++
    } else {
      out.push({ type: 'add', text: b[j] })
      j++
    }
  }
  while (i < n) out.push({ type: 'del', text: a[i++] })
  while (j < m) out.push({ type: 'add', text: b[j++] })
  return out
}

// Collapse long runs of unchanged lines, keeping a few lines of context around each change.
function buildDiffRows(oldText: string, newText: string): DiffRow[] {
  const diff = computeLineDiff(oldText, newText)
  const CONTEXT = 3
  const keep = new Array(diff.length).fill(false)
  diff.forEach((entry, index) => {
    if (entry.type !== 'same') {
      for (let k = Math.max(0, index - CONTEXT); k <= Math.min(diff.length - 1, index + CONTEXT); k++) keep[k] = true
    }
  })
  const rows: DiffRow[] = []
  let i = 0
  while (i < diff.length) {
    if (diff[i].type === 'same' && !keep[i]) {
      let count = 0
      while (i < diff.length && diff[i].type === 'same' && !keep[i]) {
        count++
        i++
      }
      rows.push({ collapsed: true, count })
    } else {
      rows.push({ type: diff[i].type, text: diff[i].text })
      i++
    }
  }
  return rows
}

function DiffViewer({
  path,
  oldContent,
  newContent,
  onClose,
  onOpenInEditor,
}: {
  path: string
  oldContent: string
  newContent: string
  onClose: () => void
  onOpenInEditor: () => void
}) {
  const rows = useMemo(() => buildDiffRows(oldContent, newContent), [oldContent, newContent])
  const hasChanges = rows.some((row) => !row.collapsed && row.type !== 'same')

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-950/50 p-4 backdrop-blur-sm">
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4">
          <div className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-900">
            <FileCode2 className="h-4 w-4 shrink-0" />
            <span className="truncate">{path}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              onClick={onOpenInEditor}
              variant="outline"
              density="compact"
              className="text-xs font-bold"
            >
              Apri nel codice
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
              title="Chiudi"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto bg-[#0f172a] py-2 font-mono text-[12px] leading-relaxed">
          {!hasChanges && (
            <div className="px-4 py-6 text-center text-xs text-slate-400">Nessuna differenza rispetto alla versione precedente.</div>
          )}
          {rows.map((row, index) =>
            row.collapsed ? (
              <div key={index} className="px-3 py-1 text-center text-[10px] text-slate-500">
                ··· {row.count} righe invariate ···
              </div>
            ) : (
              <div
                key={index}
                className={`flex ${row.type === 'add' ? 'bg-sky-500/15' : row.type === 'del' ? 'bg-rose-500/15' : ''}`}
              >
                <span
                  className={`w-5 shrink-0 select-none text-center ${row.type === 'add' ? 'text-sky-400' : row.type === 'del' ? 'text-rose-400' : 'text-slate-600'}`}
                >
                  {row.type === 'add' ? '+' : row.type === 'del' ? '-' : ' '}
                </span>
                <span
                  className={`whitespace-pre-wrap break-words ${row.type === 'add' ? 'text-sky-200' : row.type === 'del' ? 'text-rose-300' : 'text-slate-300'}`}
                >
                  {row.text || ' '}
                </span>
              </div>
            ),
          )}
        </div>
        <footer className="flex shrink-0 items-center gap-4 border-t border-slate-200 px-4 py-2 text-[11px] font-semibold">
          <span className="flex items-center gap-1.5 text-rose-600">
            <span className="h-2.5 w-2.5 rounded bg-rose-400" />
            Prima
          </span>
          <span className="flex items-center gap-1.5 text-sky-600">
            <span className="h-2.5 w-2.5 rounded bg-sky-400" />
            Dopo
          </span>
        </footer>
      </div>
    </div>
  )
}

function CodingToolbarIconButton({
  icon,
  label,
  active = false,
  disabled = false,
  onClick,
  title,
  tone = 'neutral',
  dark = false,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  title?: string
  tone?: 'neutral' | 'success'
  dark?: boolean
}) {
  const toneClasses = tone === 'success'
    ? 'text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800 focus-visible:bg-emerald-50'
    : dark
      ? 'text-slate-300 hover:bg-white/10 hover:text-white focus-visible:bg-white/10'
      : 'text-slate-500 hover:bg-white hover:text-slate-950 focus-visible:bg-white'
  const activeClasses = dark ? 'bg-white text-slate-950 shadow-sm' : 'bg-white text-slate-950 shadow-sm'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title || label}
      aria-label={title || label}
      className={`group inline-flex h-8 min-w-8 shrink-0 items-center justify-center overflow-hidden rounded-[var(--selection-radius)] text-xs font-bold transition-[max-width,padding,background-color,color,box-shadow] duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(62,169,244,0.45)] ${
        active
          ? `max-w-[11rem] px-3 ${activeClasses}`
          : `max-w-8 px-0 hover:max-w-[11rem] hover:px-3 focus-visible:max-w-[11rem] focus-visible:px-3 ${toneClasses}`
      } disabled:pointer-events-none disabled:max-w-8 disabled:px-0 disabled:opacity-45`}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span
        className={`overflow-hidden whitespace-nowrap transition-[max-width,margin,opacity] duration-300 ease-out ${
          active
            ? 'ml-2 max-w-[9rem] opacity-100'
            : 'ml-0 max-w-0 opacity-0 group-hover:ml-2 group-hover:max-w-[9rem] group-hover:opacity-100 group-focus-visible:ml-2 group-focus-visible:max-w-[9rem] group-focus-visible:opacity-100'
        }`}
      >
        {label}
      </span>
    </button>
  )
}

function PanelHeader({
  icon: Icon,
  title,
  dark = false,
  action,
  compact = false,
}: {
  icon: typeof Code2
  title: string
  dark?: boolean
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={`flex h-12 items-center gap-2 border-b ${compact ? 'justify-center px-2' : 'justify-between px-4'} ${dark ? 'border-white/10 bg-slate-900 text-white' : 'border-slate-100 bg-white text-slate-900'}`}>
      <div className={`flex min-w-0 items-center gap-2 ${compact ? 'sr-only' : ''}`}>
        <Icon className="h-4 w-4" />
        <h2 className="truncate text-sm font-bold">{title}</h2>
      </div>
      {action}
    </div>
  )
}
