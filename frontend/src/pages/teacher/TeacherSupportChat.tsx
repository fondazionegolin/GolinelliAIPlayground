import { useState, useRef, useEffect, useMemo, type CSSProperties } from 'react'
import { useMobile } from '@/hooks/useMobile'
import { Button } from '@/components/ui/button'
import {
  Send, Bot, Paperclip, X, Trash2, Plus, File, Image as ImageIcon, Loader2,
  Database, Download, ChevronDown, ChevronRight, Edit3, Check, MessageCircle, Sparkles,
  Palette, FileText, CheckSquare, MessageSquare, Settings, RotateCcw, BarChart2, Layout
} from 'lucide-react'
import DocumentCanvas, { type GeneratedDoc } from '@/components/teacher/DocumentCanvas'
import { llmApi, teacherApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { markdownCodeComponents } from '@/components/CodeBlock'
import 'katex/dist/katex.min.css'
import { ContentEditorModal } from '@/components/ContentEditorModal'
import DataFileCard from '@/components/DataFileCard'
import { DataVisualizationPanel } from '@/components/DataVisualizationPanel'
import TeacherbotsPanel from '@/components/teacher/TeacherbotsPanel'
import TeacherbotForm from '@/components/teacher/TeacherbotForm'
import { DEFAULT_TEACHER_ACCENT, getTeacherAccentTheme } from '@/lib/teacherAccent'
import { useTeacherProfile } from '@/hooks/useTeacherProfile'
import { VoiceRecorder } from '@/components/VoiceRecorder'
import { useTranslation } from 'react-i18next'
import EnvironmentalImpactPill from '@/components/chat/EnvironmentalImpactPill'
import type { TokenUsageJson } from '@/lib/environmentalImpact'
import {
  parseBrochurePayload,
  parseDispensaPayload,
  parseReportPayload,
  type DispensaPayload,
  type DispensaSection,
  type DispensaExercise,
} from '@/components/teacher/reportTemplates'
import {
  PASTEL_ICON_BACKGROUNDS,
  PASTEL_ICON_TEXT,
  PASTEL_SURFACES,
} from '@/design/themes/pastelSurfaces'

// Constants
const FALLBACK_MODELS = [
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', provider: 'openai' },
  { id: 'gpt-5-nano', name: 'GPT-5 Nano', provider: 'openai' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'mistral-nemo', name: 'Mistral Nemo', provider: 'ollama' },
]

const AGENT_MODES = [
  { id: 'default', label: 'Chat' },
  // { id: 'web_search', label: 'Web Search' },  // Hidden - not mature yet
  { id: 'report', label: 'Report' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'image', label: 'Immagine' },
  { id: 'dataset', label: 'Dataset' },
  { id: 'analysis', label: 'Analisi' },
  { id: 'brochure', label: 'Brochure' },
  { id: 'dispensa', label: 'Dispensa' },
] as const

// Explicitly include hidden modes in type even though they're hidden from UI
type AgentMode = typeof AGENT_MODES[number]['id'] | 'web_search' | 'brochure' | 'dispensa'
// Width below which the chat history sidebar auto-collapses.
// Increase this value if you want earlier collapse.
const CHAT_HISTORY_COLLAPSE_BREAKPOINT = 1360

interface AvailableModel {
  id: string
  name: string
  provider: string
}

interface QuizQuestion {
  question: string
  options: string[]
  correctIndex: number
  explanation?: string
  points?: number
}

interface QuizData {
  title: string
  description?: string
  questions: QuizQuestion[]
  total_points?: number
  time_limit_minutes?: number
}

interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  provider?: string
  model?: string
  token_usage_json?: TokenUsageJson | null
}

interface Conversation {
  id: string
  title: string
  agentMode?: AgentMode
  messages: Message[]
  createdAt: Date
}

interface AttachedFile {
  file: globalThis.File
  preview?: string
  type: 'image' | 'document' | 'data'
  dataPreview?: import('@/components/DataFileCard').DataFilePreview
}

interface DispensaPlanSection {
  id: string
  title: string
  focus: string
}

interface DispensaPlan {
  title: string
  subtitle: string
  objectives: string[]
  sections: DispensaPlanSection[]
  estimatedPages?: string
  notes?: string[]
}

interface DispensaMetaPayload {
  title: string
  subtitle?: string
  abstract: string
  objectives?: string[]
}

interface DispensaAppendixPayload {
  exercises?: DispensaExercise[]
  references?: string[]
}

function parseDispensaPlan(raw: string): DispensaPlan | null {
  const match = raw.match(/```dispensa_plan\s*([\s\S]*?)```/i)
  const candidate = (match ? match[1] : raw).trim()
  try {
    const parsed = JSON.parse(candidate) as Partial<DispensaPlan>
    if (!parsed.title || !Array.isArray(parsed.sections) || parsed.sections.length === 0) return null
    return {
      title: parsed.title,
      subtitle: parsed.subtitle || parsed.title,
      objectives: Array.isArray(parsed.objectives) ? parsed.objectives.slice(0, 8).map(String) : [],
      sections: parsed.sections.slice(0, 10).map((section, index) => ({
        id: section.id || `s${index + 1}`,
        title: section.title || `Sezione ${index + 1}`,
        focus: section.focus || '',
      })),
      estimatedPages: parsed.estimatedPages,
      notes: Array.isArray(parsed.notes) ? parsed.notes.slice(0, 6).map(String) : [],
    }
  } catch {
    return null
  }
}

function parseJsonBlockLoose<T>(raw: string, blockName: string): T | null {
  const fenceRe = new RegExp("```" + blockName + "\\s*([\\s\\S]*?)(?:```|$)", 'i')
  const match = raw.match(fenceRe)
  const candidate = (match ? match[1] : raw)
    .replace(/```+$/g, '')
    .trim()
  try {
    return JSON.parse(candidate) as T
  } catch {
    return null
  }
}

function isAgentMode(value: string | null | undefined): value is AgentMode {
  if (!value) return false
  return AGENT_MODES.some((mode) => mode.id === value) || value === 'web_search'
}

async function consumeSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (data: any) => void
) {
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })

    let normalized = buffer.replace(/\r\n/g, '\n')
    let boundaryIndex = normalized.indexOf('\n\n')

    while (boundaryIndex !== -1) {
      const rawEvent = normalized.slice(0, boundaryIndex)
      buffer = normalized.slice(boundaryIndex + 2)

      const payload = rawEvent
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n')
        .trim()

      if (payload) {
        try {
          onEvent(JSON.parse(payload))
        } catch {
          // Ignore malformed partial events
        }
      }

      normalized = buffer.replace(/\r\n/g, '\n')
      boundaryIndex = normalized.indexOf('\n\n')
    }

    if (done) {
      const trailing = buffer.replace(/\r\n/g, '\n').trim()
      if (trailing.startsWith('data: ')) {
        const payload = trailing
          .split('\n')
          .filter((line) => line.startsWith('data: '))
          .map((line) => line.slice(6))
          .join('\n')
          .trim()
        if (payload) {
          try {
            onEvent(JSON.parse(payload))
          } catch {
            // Ignore malformed trailing events
          }
        }
      }
      break
    }
  }
}

function parseDispensaMetaPayload(raw: string): DispensaMetaPayload | null {
  const parsed = parseJsonBlockLoose<Partial<DispensaMetaPayload>>(raw, 'dispensa_meta')
  if (!parsed?.title || !parsed.abstract) return null
  return {
    title: parsed.title,
    subtitle: parsed.subtitle || parsed.title,
    abstract: parsed.abstract,
    objectives: Array.isArray(parsed.objectives) ? parsed.objectives.slice(0, 8).map(String) : [],
  }
}

function parseDispensaSectionPayload(raw: string): DispensaSection | null {
  const parsed = parseJsonBlockLoose<Partial<DispensaSection>>(raw, 'dispensa_section')
  if (!parsed?.title || !parsed.intro) return null
  return {
    id: parsed.id,
    title: parsed.title,
    intro: parsed.intro,
    blocks: Array.isArray(parsed.blocks)
      ? parsed.blocks.slice(0, 4).map((block) => ({
        kind: ['definition', 'theorem', 'example', 'warning', 'note'].includes(String(block.kind || ''))
          ? block.kind as 'definition' | 'theorem' | 'example' | 'warning' | 'note'
          : 'note',
        title: block.title || 'Approfondimento',
        content: block.content || '',
      }))
      : [],
    bulletPoints: Array.isArray(parsed.bulletPoints) ? parsed.bulletPoints.slice(0, 8).map(String) : [],
    summaryPoints: Array.isArray(parsed.summaryPoints) ? parsed.summaryPoints.slice(0, 6).map(String) : [],
    table: parsed.table && Array.isArray(parsed.table.columns) && Array.isArray(parsed.table.rows)
      ? {
          columns: parsed.table.columns.slice(0, 5).map(String),
          rows: parsed.table.rows.slice(0, 8).map((row) => Array.isArray(row) ? row.slice(0, 5).map(String) : []),
        }
      : undefined,
  }
}

function parseDispensaAppendixPayload(raw: string): DispensaAppendixPayload | null {
  const parsed = parseJsonBlockLoose<Partial<DispensaAppendixPayload>>(raw, 'dispensa_appendix')
  if (!parsed) return null
  return {
    exercises: Array.isArray(parsed.exercises)
      ? parsed.exercises.slice(0, 6).map((exercise) => ({
          title: exercise.title || 'Esercizio',
          prompt: exercise.prompt || '',
          solution: exercise.solution,
        }))
      : [],
    references: Array.isArray(parsed.references) ? parsed.references.slice(0, 10).map(String) : [],
  }
}

const REPORT_TYPE_OPTIONS = [
  {
    id: 'dashboard_classe',
    label: 'Dashboard Classe',
    description: 'panoramica completa della sessione con KPI, trend, ranking e azioni consigliate',
  },
  {
    id: 'apprendimenti',
    label: 'Apprendimenti',
    description: 'competenze emerse, apprendimenti, lacune e priorità didattiche',
  },
  {
    id: 'partecipazione',
    label: 'Partecipazione',
    description: 'engagement, chat, task, chatbot e livelli di coinvolgimento',
  },
  {
    id: 'classifiche',
    label: 'Classifiche',
    description: 'ranking, top performer, studenti costanti e studenti da recuperare',
  },
  {
    id: 'criticita',
    label: 'Criticità e Rischi',
    description: 'consegne mancanti, cali di attività, fragilità e interventi urgenti',
  },
] as const



export default function TeacherSupportChat() {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const { isMobile } = useMobile()
  const [activeTab, setActiveTab] = useState<'chat' | 'teacherbots'>('chat')
  const [botPanelTarget, setBotPanelTarget] = useState<'create' | string | null>(null)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const messagesRef = useRef<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [defaultModel, setDefaultModel] = useState(localStorage.getItem('default_model') || FALLBACK_MODELS[0].id)
  const [selectedModel, setSelectedModel] = useState(localStorage.getItem('default_model') || FALLBACK_MODELS[0].id)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [loadingConversations, setLoadingConversations] = useState(true)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [hasMoreMessages, setHasMoreMessages] = useState(false)
  const [oldestMessageId, setOldestMessageId] = useState<string | null>(null)
  const [isLoadingOlder, setIsLoadingOlder] = useState(false)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const currentConversationId_ref = useRef<string | null>(null)
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [, setConversationCache] = useState<Record<string, Message[]>>({})
  const conversationCacheRef = useRef<Record<string, Message[]>>({})
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [agentMode, setAgentMode] = useState<AgentMode>('default')
  const [imageProvider, setImageProvider] = useState<'dall-e' | 'gpt-image-1'>('dall-e')
  const [imageSize, setImageSize] = useState<string>('1024x1024')
  // Analysis mode: session/task picker
  const [analysisSessionId, setAnalysisSessionId] = useState<string>('')
  const [analysisTaskId, setAnalysisTaskId] = useState<string>('')
  const [chatBg, setChatBg] = useState<string>('')
  const [chatBgDefault, setChatBgDefault] = useState<string>('')
  const [showBgPalette, setShowBgPalette] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => window.innerWidth < CHAT_HISTORY_COLLAPSE_BREAKPOINT)
  const [activeDoc, setActiveDoc] = useState<GeneratedDoc | null>(null)
  const [showCanvas, setShowCanvas] = useState(false)
  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false)
  const [convsWithDocs, setConvsWithDocs] = useState<Set<string>>(new Set())
  const docCacheRef = useRef<Record<string, GeneratedDoc>>({})
  const [pendingDispensaPlan, setPendingDispensaPlan] = useState<DispensaPlan | null>(null)
  const [pendingDispensaRequest, setPendingDispensaRequest] = useState<string | null>(null)
  const [pendingDispensaFilesContext, setPendingDispensaFilesContext] = useState<string>('')
  const modelMenuRef = useRef<HTMLDivElement>(null)
  const modeMenuRef = useRef<HTMLDivElement>(null)

  const { data: availableModelsResponse } = useQuery({
    queryKey: ['llm-available-models'],
    queryFn: () => llmApi.getAvailableModels(),
    staleTime: 60_000,
  })
  const teacherProfileData = useTeacherProfile().data
  const availableModels = useMemo<AvailableModel[]>(() => {
    const modelsFromApi = (availableModelsResponse?.data?.models || [])
      .filter((m: { model?: string; name?: string; provider?: string }) => m?.model && m?.provider)
      .map((m: { model: string; name?: string; provider: string }) => ({
        id: m.model,
        name: m.name || m.model,
        provider: m.provider,
      }))

    if (modelsFromApi.length > 0) return modelsFromApi
    return FALLBACK_MODELS
  }, [availableModelsResponse])
  const accentTheme = useMemo(
    () => getTeacherAccentTheme(teacherProfileData?.uiAccent || DEFAULT_TEACHER_ACCENT),
    [teacherProfileData]
  )
  const teacherDisplayName = useMemo(() => {
    const first = teacherProfileData?.firstName?.trim() || ''
    const last = teacherProfileData?.lastName?.trim() || ''
    return [first, last].filter(Boolean).join(' ') || 'Docente'
  }, [teacherProfileData])
  const accentVars = useMemo(() => ({
    '--teacher-accent': accentTheme.accent,
    '--teacher-accent-text': accentTheme.text,
    '--teacher-accent-soft': accentTheme.soft,
    '--teacher-accent-soft-strong': accentTheme.softStrong,
    '--teacher-accent-border': accentTheme.border,
  }) as CSSProperties, [accentTheme])
  const selectedSoftStyle = useMemo(() => ({
    backgroundColor: `${accentTheme.accent}15`,
    color: accentTheme.text,
    borderColor: `${accentTheme.accent}40`,
    backdropFilter: 'blur(8px)',
  }) as CSSProperties, [accentTheme])
  const selectedSolidStyle = useMemo(() => ({
    backgroundColor: accentTheme.accent,
    color: '#ffffff',
  }) as CSSProperties, [accentTheme])
  const selectedModeMeta = useMemo(
    () => AGENT_MODES.find(m => m.id === agentMode) || AGENT_MODES[0],
    [agentMode]
  )

  useEffect(() => {
    const handleResize = () => {
      setIsSidebarCollapsed(window.innerWidth < CHAT_HISTORY_COLLAPSE_BREAKPOINT)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (!availableModels.length) return
    const hasSelected = availableModels.some(m => m.id === selectedModel)
    const hasDefault = availableModels.some(m => m.id === defaultModel)
    const firstModel = availableModels[0].id

    if (!hasSelected) {
      setSelectedModel(firstModel)
    }
    if (!hasDefault) {
      setDefaultModel(firstModel)
      localStorage.setItem('default_model', firstModel)
    }
  }, [availableModels, selectedModel, defaultModel])

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) {
        setShowModelMenu(false)
      }
      if (modeMenuRef.current && !modeMenuRef.current.contains(event.target as Node)) {
        setShowModeMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSetDefaultModel = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    // User wants "choose default via checkbox". 
    // Let's assume radio behavior for default (only one default).
    setDefaultModel(id) // Always set the clicked one as default
    localStorage.setItem('default_model', id)
    toast({
      title: t('teacher_chat.default_model_updated'),
      description: t('teacher_chat.default_model_now', { model: availableModels.find(m => m.id === id)?.name })
    })
  }

  // Model Icons Components
  const ModelIcon = ({ provider, modelId: _modelId, className = "h-4 w-4" }: { provider: string, modelId?: string, className?: string }) => {
    if (provider === 'openai') {
      return <img src="/icone_ai/OpenAI_logo_2025_(symbol).svg.png" alt="OpenAI" className={className} style={{ objectFit: 'contain' }} />
    }
    if (provider === 'anthropic') {
      return <img src="/icone_ai/anthropic.svg" alt="Anthropic" className={className} style={{ objectFit: 'contain' }} />
    }
    if (provider === 'deepseek') {
      return <img src="/icone_ai/deepseek-logo-icon.svg" alt="DeepSeek" className={className} style={{ objectFit: 'contain' }} />
    }
    return <Bot className={className} />
  }


  const [streamingStatus, setStreamingStatus] = useState<string | null>(null)
  const [showPromptEditor, setShowPromptEditor] = useState(false)
  const [promptEditorValue, setPromptEditorValue] = useState('')
  const [promptEditorDefault, setPromptEditorDefault] = useState('')
  const [promptEditorSaving, setPromptEditorSaving] = useState(false)
  const [imageGenerationProgress, setImageGenerationProgress] = useState<{
    status: string
    step: 'connecting' | 'enhancing' | 'generating' | 'done' | 'error'
    provider?: string
    enhancedPrompt?: string
  } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const paletteGroups = useMemo(() => ([
    {
      label: 'Toni di grigio',
      colors: ['#f8fafc', '#f1f5f9', '#e2e8f0', '#cbd5e1', '#94a3b8'],
    },
    {
      label: 'Toni di azzurro',
      colors: ['#eff6ff', '#dbeafe', '#bfdbfe', '#93c5fd', '#60a5fa'],
    },
    {
      label: 'Toni di verde',
      colors: ['#ecfdf5', '#d1fae5', '#a7f3d0', '#6ee7b7', '#34d399'],
    },
    {
      label: 'Toni di viola',
      colors: ['#f5f3ff', '#ede9fe', '#ddd6fe', '#c4b5fd', '#a78bfa'],
    },
  ]), [])

  const isDarkColor = (color: string) => {
    if (!color) return false
    if (color.startsWith('#')) {
      const hex = color.replace('#', '')
      const full = hex.length === 3
        ? hex.split('').map(c => c + c).join('')
        : hex
      const r = parseInt(full.substring(0, 2), 16) / 255
      const g = parseInt(full.substring(2, 4), 16) / 255
      const b = parseInt(full.substring(4, 6), 16) / 255
      const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
      return luminance < 0.45
    }
    if (color.startsWith('hsl')) {
      const match = color.match(/hsl\\(\\s*([\\d.]+),\\s*([\\d.]+)%?,\\s*([\\d.]+)%?\\s*\\)/i)
      if (match) {
        const lightness = parseFloat(match[3])
        return lightness < 45
      }
    }
    return false
  }

  const chatBgIsDark = chatBg ? isDarkColor(chatBg) : false

  useEffect(() => {
    try {
      const storedDefault = localStorage.getItem('teacherChatBgDefault')
      if (storedDefault) setChatBgDefault(storedDefault)
      const stored = localStorage.getItem('teacherChatBg')
      if (stored) {
        setChatBg(stored)
      } else if (storedDefault) {
        setChatBg(storedDefault)
      }
    } catch (e) {
      console.error('Failed to load chat background', e)
    }
  }, [])

  useEffect(() => {
    try {
      if (chatBg) {
        localStorage.setItem('teacherChatBg', chatBg)
      } else {
        localStorage.removeItem('teacherChatBg')
      }
    } catch (e) {
      console.error('Failed to save chat background', e)
    }
  }, [chatBg])

  useEffect(() => {
    const handleResize = () => {
      // Keep collapsed by default on desktop; force collapsed on narrower layouts.
      setIsSidebarCollapsed((prev) =>
        window.innerWidth < CHAT_HISTORY_COLLAPSE_BREAKPOINT ? true : prev
      )
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleSetDefaultChatBg = (color: string) => {
    try {
      localStorage.setItem('teacherChatBgDefault', color)
      setChatBgDefault(color)
    } catch (e) {
      console.error('Failed to save default chat background', e)
    }
  }
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Publish Modal State
  const [publishModal, setPublishModal] = useState<{ isOpen: boolean, type: 'quiz' | 'dataset', data: any }>({
    isOpen: false,
    type: 'quiz',
    data: null
  })
  const [publishMode, setPublishMode] = useState<'published' | 'draft'>('published')

  // Editor Modal State (for editing quiz before publishing)
  const [editorModal, setEditorModal] = useState<{ isOpen: boolean, type: 'quiz' | 'dataset', data: any }>({
    isOpen: false,
    type: 'quiz',
    data: null
  })

  // Fetch classes/sessions for publishing
  const { data: classesData } = useQuery({
    queryKey: ['teacher-classes-publish'],
    queryFn: async () => {
      const classesRes = await teacherApi.getClasses()
      const classes = classesRes.data || []
      const allSessions: any[] = []
      for (const cls of classes) {
        try {
          const sessionsRes = await teacherApi.getSessions(cls.id)
          const sessions = sessionsRes.data || []
          sessions.forEach((s: any) => {
            allSessions.push({
              id: s.id,
              title: s.title || s.name || 'Sessione senza titolo',
              class_name: cls.name,
              class_join_code: cls.join_code || null,
              status: s.status || 'attiva'
            })
          })
        } catch (e) { } // Ignore errors for individual session fetches
      }
      return allSessions
    },
  })

  // Tasks for selected analysis session
  const { data: analysisTasksData } = useQuery({
    queryKey: ['analysis-tasks', analysisSessionId],
    queryFn: async () => {
      const res = await teacherApi.getTasks(analysisSessionId)
      return (res.data || []) as Array<{ id: string; title: string; task_type: string; status: string }>
    },
    enabled: !!analysisSessionId && agentMode === 'analysis',
    staleTime: 30_000,
  })

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load conversations from server
  useEffect(() => {
    const loadConversations = async () => {
      try {
        const response = await teacherApi.getConversations()
        const serverConversations = response.data || []
        setConversations(serverConversations.map((c: any) => ({
          id: c.id,
          title: c.title || 'Nuova conversazione',
          agentMode: isAgentMode(c.agent_mode) ? c.agent_mode : 'default',
          messages: [], // Messages loaded on demand when selecting a conversation
          createdAt: new Date(c.created_at),
        })))

        const cached = localStorage.getItem('teacher_support_messages_cache')
        if (cached) {
          try {
            const parsed = JSON.parse(cached)
            const hydrated: Record<string, Message[]> = {}
            for (const [id, msgs] of Object.entries(parsed)) {
              hydrated[id] = (msgs as any[]).map(m => ({ ...m, timestamp: new Date(m.timestamp) }))
            }
            setConversationCache(hydrated)
            conversationCacheRef.current = hydrated
          } catch {
            // ignore cache parse errors
          }
        }

        // Load doc cache
        try {
          const docStored = localStorage.getItem('teacher_canvas_docs')
          if (docStored) {
            const parsed = JSON.parse(docStored) as Record<string, GeneratedDoc>
            docCacheRef.current = parsed
            setConvsWithDocs(new Set(Object.keys(parsed)))
          }
        } catch {
          // ignore
        }
      } catch (e) {
        console.error('Failed to load conversations from server:', e)
        // Fallback to localStorage for offline/error cases
        const saved = localStorage.getItem('teacher_support_conversations')
        if (saved) {
          try {
            const parsed = JSON.parse(saved)
            setConversations(parsed.map((c: Conversation) => ({
              ...c,
              agentMode: isAgentMode(c.agentMode) ? c.agentMode : 'default',
              createdAt: new Date(c.createdAt),
              messages: c.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) }))
            })))
          } catch (parseErr) { console.error(parseErr) }
        }
      } finally {
        setLoadingConversations(false)
      }
    }
    loadConversations()
  }, [])

  useEffect(() => {
    const savedCurrent = localStorage.getItem('teacher_support_current_conversation_id')
    if (savedCurrent) {
      setCurrentConversationId(savedCurrent)
    }
  }, [])

  useEffect(() => {
    if (currentConversationId) {
      localStorage.setItem('teacher_support_current_conversation_id', currentConversationId)
    } else {
      localStorage.removeItem('teacher_support_current_conversation_id')
    }
  }, [currentConversationId])

  // Load messages when selecting a conversation (last 30 only)
  useEffect(() => {
    currentConversationId_ref.current = currentConversationId
    if (!currentConversationId) {
      setHasMoreMessages(false)
      setOldestMessageId(null)
      setActiveDoc(null)
      setShowCanvas(false)
      return
    }
    // Restore canvas doc from local cache while we wait for server
    const localDoc = docCacheRef.current[currentConversationId]
    if (localDoc) {
      setActiveDoc(localDoc)
      setShowCanvas(true)
    } else {
      setActiveDoc(null)
      setShowCanvas(false)
    }
    const loadMessages = async () => {
      setLoadingMessages(true)
      setHasMoreMessages(false)
      setOldestMessageId(null)
      try {
        // Show cached while fetching
        const cachedMessages = conversationCacheRef.current[currentConversationId]
        if (cachedMessages && cachedMessages.length > 0) {
          setMessages(cachedMessages)
        }

        const response = await teacherApi.getConversation(currentConversationId)
        const conv = response.data
        if (conv?.messages && currentConversationId_ref.current === currentConversationId) {
          if (isAgentMode(conv.agent_mode)) {
            setAgentMode(conv.agent_mode)
          }
          const serverMessages = conv.messages.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: new Date(m.created_at),
            provider: m.provider,
            model: m.model,
            token_usage_json: m.token_usage_json,
          }))
          const localMessageCount = cachedMessages?.length || 0
          const hasLocalPendingMessages = localMessageCount > 0 && serverMessages.length <= localMessageCount
          if (!hasLocalPendingMessages) {
            setMessages(serverMessages)
            setHasMoreMessages(conv.has_more ?? false)
            setOldestMessageId(serverMessages[0]?.id ?? null)
            setConversations((prev) => prev.map((item) => (
              item.id === currentConversationId
                ? { ...item, title: conv.title || item.title, agentMode: isAgentMode(conv.agent_mode) ? conv.agent_mode : item.agentMode }
                : item
            )))
            setConversationCache(prev => {
              const next = { ...prev, [currentConversationId]: serverMessages }
              conversationCacheRef.current = next
              return next
            })
          }

          // Restore document from server (authoritative source)
          if (currentConversationId_ref.current === currentConversationId) {
            if (conv.document_json) {
              const serverDoc = conv.document_json as GeneratedDoc
              docCacheRef.current[currentConversationId] = serverDoc
              setConvsWithDocs(prev => new Set([...prev, currentConversationId]))
              setActiveDoc(serverDoc)
              setShowCanvas(true)
            } else if (!localDoc) {
              setActiveDoc(null)
              setShowCanvas(false)
            }
          }
        }
      } catch (e) {
        console.error('Failed to load messages:', e)
      } finally {
        if (currentConversationId_ref.current === currentConversationId) {
          setLoadingMessages(false)
        }
      }
    }
    loadMessages()
  }, [currentConversationId])

  // Load older messages when user scrolls to top
  const loadOlderMessages = async () => {
    if (!currentConversationId || !hasMoreMessages || isLoadingOlder || !oldestMessageId) return
    setIsLoadingOlder(true)
    try {
      const response = await teacherApi.getConversation(currentConversationId, oldestMessageId)
      const conv = response.data
      if (conv?.messages) {
        const older = conv.messages.map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.created_at),
          provider: m.provider,
          model: m.model,
          token_usage_json: m.token_usage_json,
        }))
        setMessages(prev => [...older, ...prev])
        setHasMoreMessages(conv.has_more ?? false)
        setOldestMessageId(older[0]?.id ?? oldestMessageId)
      }
    } catch (e) {
      console.error('Failed to load older messages:', e)
    } finally {
      setIsLoadingOlder(false)
    }
  }

  useEffect(() => { messagesRef.current = messages }, [messages])

  useEffect(() => {
    if (!currentConversationId) return
    setConversationCache(prev => {
      const next = { ...prev, [currentConversationId]: messages }
      conversationCacheRef.current = next
      localStorage.setItem('teacher_support_messages_cache', JSON.stringify(next))
      return next
    })
  }, [messages, currentConversationId])

  useEffect(() => {
    localStorage.setItem('teacher_support_conversations', JSON.stringify(conversations))
  }, [conversations])

  const addFiles = (files: globalThis.File[]) => {
    files.forEach(file => {
      const isImage = file.type.startsWith('image/')
      const isData = /\.(xlsx|xls|csv|json)$/i.test(file.name) ||
        file.type.includes('spreadsheet') || file.type.includes('excel') ||
        file.type === 'text/csv' || file.type === 'application/json'

      if (isImage) {
        setAttachedFiles(prev => [...prev, { file, type: 'image', preview: URL.createObjectURL(file) }])
        return
      }

      if (isData) {
        setAttachedFiles(prev => [...prev, { file, type: 'data' }])
        llmApi.filePreview(file)
          .then(res => {
            setAttachedFiles(prev =>
              prev.map(af => af.file === file ? { ...af, dataPreview: res.data } : af)
            )
          })
          .catch(() => {/* keep file without preview */})
        return
      }

      setAttachedFiles(prev => [...prev, { file, type: 'document' }])
    })
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files))
  }

  const handleInputPaste = (e: React.ClipboardEvent) => {
    const fileItems = Array.from(e.clipboardData.items).filter(item => item.kind === 'file')
    if (fileItems.length === 0) return
    e.preventDefault()
    const files = fileItems.map(item => item.getAsFile()).filter(Boolean) as globalThis.File[]
    if (files.length > 0) addFiles(files)
  }

  const removeFile = (index: number) => {
    setAttachedFiles(prev => {
      const newFiles = [...prev]
      if (newFiles[index].preview) {
        URL.revokeObjectURL(newFiles[index].preview!)
      }
      newFiles.splice(index, 1)
      return newFiles
    })
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()

    const sessionFileData = e.dataTransfer.getData('application/x-session-file')
    if (sessionFileData) {
      try {
        const data = JSON.parse(sessionFileData)
        let fileUrl = data.url as string
        const handleFile = (blob: Blob) => {
          const fileObj = new globalThis.File([blob], data.filename || 'file', {
            type: data.mime_type || blob.type || 'application/octet-stream'
          })
          addFiles([fileObj])
        }
        if (fileUrl.includes('/api/v1/files/') && fileUrl.endsWith('/download-url')) {
          fetch(fileUrl)
            .then(res => res.json())
            .then(json => fetch(json.download_url || json.url || fileUrl))
            .then(res => res.blob())
            .then(handleFile)
        } else {
          fetch(fileUrl)
            .then(res => res.blob())
            .then(handleFile)
        }
      } catch (err) {
        console.error('Failed to handle session file drop', err)
      }
      return
    }

    // Handle image from chatbot
    const imageData = e.dataTransfer.getData('application/x-chatbot-image')
    if (imageData) {
      const data = JSON.parse(imageData)
      fetch(data.url)
        .then(res => res.blob())
        .then(blob => {
          const fileObj = Object.assign(blob, {
            name: data.filename || `immagine_${Date.now()}.png`,
            lastModified: Date.now()
          }) as File
          setAttachedFiles(prev => [...prev, { file: fileObj, type: 'image' as const, preview: data.url }])
        })
      return
    }

    // Handle CSV from chatbot dataset generator
    const csvData = e.dataTransfer.getData('application/x-chatbot-csv')
    if (csvData) {
      const blob = new Blob([csvData], { type: 'text/csv' })
      const fileObj = Object.assign(blob, {
        name: `dataset_${Date.now()}.csv`,
        lastModified: Date.now()
      }) as File
      addFiles([fileObj])
      return
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files))
    }
  }

  const openConversation = (conversation: Conversation) => {
    setCurrentConversationId(conversation.id)
    if (conversation.agentMode && isAgentMode(conversation.agentMode)) {
      setAgentMode(conversation.agentMode)
    }
  }

  const syncConversationMode = async (conversationId: string, mode: AgentMode) => {
    setConversations((prev) => prev.map((conversation) => (
      conversation.id === conversationId
        ? { ...conversation, agentMode: mode }
        : conversation
    )))
    try {
      await teacherApi.updateConversation(conversationId, { agent_mode: mode })
    } catch (error) {
      console.error('Failed to persist conversation mode:', error)
    }
  }

  const ensureConversation = async (titleSeed: string) => {
    if (currentConversationId) return currentConversationId
    try {
      const response = await teacherApi.createConversation({
        title: titleSeed.substring(0, 50) + (titleSeed.length > 50 ? '...' : ''),
        agent_mode: agentMode
      })
      const convId = response.data.id
      setCurrentConversationId(convId)
      setConversations(prev => [{
        id: convId,
        title: response.data.title || 'Nuova conversazione',
        agentMode: isAgentMode(response.data.agent_mode) ? response.data.agent_mode : agentMode,
        messages: [],
        createdAt: new Date()
      }, ...prev])
      return convId
    } catch (e) {
      console.error('Failed to create conversation:', e)
      return null
    }
  }

  // Helper: Save message to server
  const saveMessageToServer = async (
    conversationId: string | null,
    userMsg: Message,
    assistantMsg: Message,
    model?: string
  ): Promise<string> => {
    let convId: string | null = conversationId

    // At this point convId is guaranteed to be a string
    if (!convId) return ''

    // Save messages
    try {
      await teacherApi.addMessage(convId, {
        role: userMsg.role,
        content: userMsg.content,
        model: model
      })
      await teacherApi.addMessage(convId, {
        role: assistantMsg.role,
        content: assistantMsg.content,
        model: assistantMsg.model || model,
        provider: assistantMsg.provider,
        token_usage_json: assistantMsg.token_usage_json ? { ...assistantMsg.token_usage_json } as Record<string, unknown> : undefined,
      })
    } catch (e) {
      console.error('Failed to save messages:', e)
    }

    return convId
  }

  const runStreamingRequest = async (
    content: string,
    history: Message[],
    opts?: {
      provider?: string
      model?: string
      mode?: AgentMode
      sessionId?: string
      onChunk?: (chunk: string) => void
      onStatus?: (status: string) => void
      onCalendarEvent?: (event: { id: string; title: string; event_date: string; event_time?: string; color: string }) => void
    }
  ): Promise<{ content: string; provider?: string; model?: string; token_usage_json?: TokenUsageJson | null }> => {
    const modelInfo = availableModels.find(m => m.id === selectedModel)
    try {
      const response = await fetch('/api/v1/llm/teacher/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          content,
          history: history.map(m => ({ role: m.role, content: m.content })),
          provider: opts?.provider ?? modelInfo?.provider ?? 'openai',
          model: opts?.model ?? selectedModel,
          agent_mode: opts?.mode ?? agentMode,
          session_id: opts?.sessionId ?? null,
        })
      })

      if (!response.ok) throw new Error('Stream request failed')

      const reader = response.body?.getReader()
      let finalContent = ''
      let finalProvider: string | undefined
      let finalModel: string | undefined
      let finalTokenUsage: TokenUsageJson | null = null

      if (reader) {
        await consumeSseStream(reader, (data) => {
          if (data.type === 'chunk') {
            finalContent += data.content
            opts?.onChunk?.(data.content)
          } else if (data.type === 'done') {
            if (data.content) finalContent = data.content
            finalProvider = data.provider
            finalModel = data.model
            finalTokenUsage = data.token_usage || null
          } else if (data.type === 'status') {
            opts?.onStatus?.(data.message)
          } else if (data.type === 'calendar_event_created') {
            opts?.onCalendarEvent?.(data.event)
          } else if (data.type === 'error') {
            throw new Error(data.message || 'Errore durante lo stream')
          }
        })
      }

      return {
        content: finalContent || 'Nessun risultato dalla generazione.',
        provider: finalProvider,
        model: finalModel,
        token_usage_json: finalTokenUsage,
      }
    } catch (e) {
      throw e
    }
  }

  const generateDocument = async (
    mode: 'brochure' | 'dispensa' | 'report',
    userRequest: string,
    chatHistory: Message[],
    filesContext: string,
    isEdit: boolean,
    currentDoc?: GeneratedDoc | null,
    approvedPlan?: DispensaPlan | null
  ): Promise<string> => {
    const historyContext = chatHistory
      .filter(m => m.role !== 'system')
      .slice(-6)
      .map(m => `${m.role === 'user' ? 'Utente' : 'Assistente'}: ${m.content.substring(0, 400)}`)
      .join('\n')

    let prompt: string
    const contextSection = [
      chatHistory.length > 1 ? `\nContesto della chat:\n${historyContext}` : '',
      filesContext ? `\nMateriale allegato:\n${filesContext}` : '',
    ].filter(Boolean).join('\n')

    if (mode === 'report') {
      const matchedReportType = REPORT_TYPE_OPTIONS.find((option) =>
        userRequest.toLowerCase().includes(option.label.toLowerCase()) || userRequest.toLowerCase().includes(option.id.replace('_', ' '))
      )
      const templateId = matchedReportType?.id || 'dashboard_classe'
      prompt = [
        'Compila SOLO i dati variabili di un report didattico. Il layout HTML/CSS/JS viene applicato dal sistema tramite template locale.',
        '',
        'TEMPLATE SELEZIONATO:',
        `- templateId: ${templateId}`,
        `- focus: ${matchedReportType?.description || 'panoramica completa della sessione con KPI, grafici, ranking e azioni'}`,
        '',
        'RISPOSTA OBBLIGATORIA:',
        '- Rispondi SOLO con un blocco ```report_data contenente un JSON valido',
        '- Nessun commento prima o dopo',
        '- Non generare HTML',
        '',
        'SCHEMA JSON OBBLIGATORIO:',
        `{
  "templateId": "${templateId}",
  "title": "titolo report",
  "subtitle": "sottotitolo sintetico",
  "summary": "sintesi esecutiva breve",
  "metrics": [
    {"label": "KPI", "value": "numero o testo breve", "trend": "trend breve", "detail": "contesto"}
  ],
  "charts": [
    {"id": "partecipazione", "title": "Titolo grafico", "type": "bar|line|doughnut|radar", "labels": ["A","B"], "values": [1,2], "description": "cosa mostra"}
  ],
  "leaderboard": [
    {"name": "Studente o categoria", "score": "valore", "detail": "spiegazione", "badge": "tag"}
  ],
  "strengths": ["punto di forza"],
  "risks": ["criticità"],
  "recommendations": ["azione consigliata"],
  "tables": [
    {"title": "Tabella opzionale", "columns": ["col1","col2"], "rows": [["v1","v2"]]}
  ],
  "assumptions": ["eventuale assunzione o limite"],
  "methodology": "nota metodologica breve"
}`,
        '',
        'VINCOLI DI COMPILAZIONE:',
        '- Massimo 6 KPI',
        '- Massimo 4 grafici',
        '- Massimo 10 righe in leaderboard',
        '- Ogni grafico deve avere labels e values della stessa lunghezza',
        '- Usa solo numeri realmente presenti o inferenze prudenti',
        '- Se un valore numerico non è disponibile, non inventarlo: usa tabelle, ranking qualitativi o KPI testuali',
        '- Inserisci in assumptions ciò che è stimato o incompleto',
        '',
        'DATI DA TRASFORMARE:',
        userRequest,
        '',
        chatHistory.length > 0 ? `CONTESTO CONVERSAZIONALE:\n${historyContext}` : '',
        filesContext ? `MATERIALE AGGIUNTIVO:\n${filesContext}` : '',
      ].filter(Boolean).join('\n')
    } else if (mode === 'brochure') {
      const currentPayload = isEdit && currentDoc ? parseBrochurePayload(currentDoc.content) : null
      prompt = [
        'Compila SOLO i dati variabili di una brochure. Il layout HTML/CSS è applicato dal sistema tramite template locale.',
        '',
        'RISPOSTA OBBLIGATORIA:',
        '- Rispondi SOLO con un blocco ```brochure_data contenente JSON valido',
        '- Nessun commento prima o dopo',
        '- Non generare HTML',
        '',
        'SCHEMA JSON OBBLIGATORIO:',
        `{
  "title": "titolo brochure",
  "subtitle": "sottotitolo",
  "palette": ["#1a1a2e", "#d97745", "#2c6b8a", "#7aa65a", "#f6efe7"],
  "heroBadge": "categoria",
  "heroAccent": "parola chiave opzionale",
  "heroDescription": "descrizione hero",
  "ctaPrimary": "CTA principale",
  "ctaSecondary": "CTA secondaria",
  "overviewTitle": "titolo panoramica",
  "overviewLead": "testo intro",
  "keyPoints": ["punto chiave"],
  "features": [{"icon": "✨", "title": "feature", "description": "descrizione"}],
  "benefits": ["beneficio"],
  "steps": ["passaggio"],
  "stats": [{"value": "42%", "label": "indicatore", "description": "contesto"}],
  "faq": [{"question": "domanda", "answer": "risposta"}],
  "closingTitle": "titolo finale",
  "closingText": "testo finale",
  "closingQuote": "citazione opzionale",
  "closingAuthor": "autore citazione"
}`,
        '',
        'VINCOLI DI COMPILAZIONE:',
        '- Massimo 6 keyPoints',
        '- Massimo 6 features',
        '- Massimo 8 benefits',
        '- Massimo 5 steps',
        '- Massimo 4 stats',
        '- Massimo 6 FAQ',
        '- Testi densi ma sintetici: niente boilerplate di layout',
        '',
        isEdit && currentDoc ? 'BROCHURE ATTUALE:' : '',
        isEdit && currentDoc
          ? currentPayload
            ? `\`\`\`brochure_data\n${JSON.stringify(currentPayload, null, 2)}\n\`\`\``
            : `\`\`\`html\n${currentDoc.content.substring(0, 10000)}\n\`\`\``
          : '',
        isEdit ? `MODIFICA RICHIESTA: ${userRequest}` : `TOPIC: ${userRequest}`,
        contextSection,
      ].filter(Boolean).join('\n')
    } else {
      const currentPayload = isEdit && currentDoc ? parseDispensaPayload(currentDoc.content) : null
      prompt = [
        'Compila SOLO i dati variabili di una dispensa universitaria destinata a composizione PDF in stile LaTeX. Il layout finale non va generato dal modello.',
        '',
        'RISPOSTA OBBLIGATORIA:',
        '- Rispondi SOLO con un blocco ```dispensa_data contenente JSON valido',
        '- Nessun commento prima o dopo',
        '- Non generare HTML o LaTeX',
        '',
        'SCHEMA JSON OBBLIGATORIO:',
        `{
  "title": "titolo dispensa",
  "subtitle": "sottotitolo",
  "abstract": "abstract iniziale",
  "objectives": ["obiettivo"],
  "sections": [
    {
      "id": "s1",
      "title": "titolo sezione",
      "intro": "testo introduttivo",
      "blocks": [{"kind": "definition|theorem|example|warning|note", "title": "titolo blocco", "content": "contenuto"}],
      "bulletPoints": ["punto"],
      "summaryPoints": ["takeaway"],
      "table": {"columns": ["col1", "col2"], "rows": [["v1", "v2"]]}
    }
  ],
  "exercises": [{"title": "esercizio", "prompt": "traccia", "solution": "soluzione opzionale"}],
  "references": ["riferimento"]
}`,
        '',
        'VINCOLI DI COMPILAZIONE:',
        '- Massimo 8 sections',
        '- Ogni section deve avere intro sostanziosa',
        '- Ogni section può avere fino a 4 blocks',
        '- Usa table solo se realmente utile',
        '- Massimo 6 exercises',
        '- Massimo 10 references',
        '- Non sprecare token in markup o boilerplate',
        '- Mantieni coerenza rigorosa con il planning approvato',
        '',
        approvedPlan ? 'PLANNING APPROVATO:' : '',
        approvedPlan ? `\`\`\`json\n${JSON.stringify(approvedPlan, null, 2)}\n\`\`\`` : '',
        isEdit && currentDoc ? 'DISPENSA ATTUALE:' : '',
        isEdit && currentDoc
          ? currentPayload
            ? `\`\`\`dispensa_data\n${JSON.stringify(currentPayload, null, 2)}\n\`\`\``
            : `\`\`\`html\n${currentDoc.content.substring(0, 10000)}\n\`\`\``
          : '',
        isEdit ? `MODIFICA RICHIESTA: ${userRequest}` : `ARGOMENTO: ${userRequest}`,
        contextSection,
      ].filter(Boolean).join('\n')
    }

    // Helper: stream a prompt and return the full content
    const streamPrompt = async (promptText: string, model = 'claude-sonnet-4-6'): Promise<string> => {
      const response = await fetch('/api/v1/llm/teacher/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          content: promptText,
          history: [],
          provider: 'anthropic',
          model,
          agent_mode: 'default',
        })
      })
      if (!response.ok) throw new Error('Stream request failed')
      const reader = response.body?.getReader()
      let out = ''
      if (reader) {
        await consumeSseStream(reader, (data) => {
          if (data.type === 'chunk') out += data.content || ''
          else if (data.type === 'done' && data.content) out = data.content
        })
      }
      return out.trim()
    }

    const streamPromptValidated = async <T,>(
      promptText: string,
      parse: (raw: string) => T | null,
      label: string,
      model = 'claude-sonnet-4-6',
      maxAttempts = 3
    ): Promise<T> => {
      let lastOutput = ''
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const effectivePrompt = attempt === 0
          ? promptText
          : [
              promptText,
              '',
              'ATTENZIONE: la risposta precedente era troncata o JSON non valido.',
              `Rigenera da zero l intero blocco ${label} completo e valido.`,
              'Se stai per terminare i token, chiudi comunque correttamente il JSON e il blocco markdown.',
              lastOutput ? `OUTPUT PRECEDENTE NON VALIDO:\n${lastOutput.slice(-6000)}` : '',
            ].filter(Boolean).join('\n')
        lastOutput = (await streamPrompt(effectivePrompt, model)).trim()
        const parsed = parse(lastOutput)
        if (parsed) return parsed
      }
      throw new Error(`Generazione ${label} non valida o troncata.`)
    }

    if (mode === 'dispensa' && approvedPlan && !isEdit) {
      const metaPrompt = [
        'Compila SOLO i metadati iniziali di una dispensa universitaria in JSON valido.',
        '',
        'RISPOSTA OBBLIGATORIA:',
        '- Rispondi SOLO con un blocco ```dispensa_meta contenente JSON valido',
        '- Nessun commento prima o dopo',
        '',
        'SCHEMA JSON OBBLIGATORIO:',
        `{
  "title": "titolo dispensa",
  "subtitle": "sottotitolo",
  "abstract": "abstract iniziale denso e completo",
  "objectives": ["obiettivo"]
}`,
        '',
        'VINCOLI:',
        '- Abstract ben scritto e completo ma entro 2200 caratteri',
        '- Obiettivi massimo 8',
        '- Se i token stanno finendo, chiudi sempre il JSON correttamente',
        '',
        `RICHIESTA: ${userRequest}`,
        `PLANNING APPROVATO:\n${JSON.stringify(approvedPlan, null, 2)}`,
        contextSection,
      ].filter(Boolean).join('\n')

      const meta = await streamPromptValidated(metaPrompt, parseDispensaMetaPayload, 'dispensa_meta')

      const sections: DispensaSection[] = []
      for (const [index, planSection] of approvedPlan.sections.entries()) {
        const sectionPrompt = [
          'Compila SOLO una sezione di dispensa universitaria in JSON valido.',
          '',
          'RISPOSTA OBBLIGATORIA:',
          '- Rispondi SOLO con un blocco ```dispensa_section contenente JSON valido',
          '- Nessun commento prima o dopo',
          '',
          'SCHEMA JSON OBBLIGATORIO:',
          `{
  "id": "${planSection.id || `s${index + 1}`}",
  "title": "titolo sezione",
  "intro": "testo introduttivo corposo",
  "blocks": [{"kind": "definition|theorem|example|warning|note", "title": "titolo blocco", "content": "contenuto"}],
  "bulletPoints": ["punto"],
  "summaryPoints": ["takeaway"],
  "table": {"columns": ["col1", "col2"], "rows": [["v1", "v2"]]}
}`,
          '',
          'VINCOLI:',
          '- Genera SOLO questa sezione',
          '- Intro sostanziosa e continua, niente placeholder',
          '- Massimo 4 blocks',
          '- Table solo se davvero utile',
          '- Non iniziare sezioni successive',
          '- Se i token stanno finendo, chiudi sempre il JSON correttamente',
          '',
          `TITOLO DISPENSA: ${approvedPlan.title}`,
          `SEZIONE DA GENERARE (${index + 1}/${approvedPlan.sections.length}): ${JSON.stringify(planSection, null, 2)}`,
          approvedPlan.notes?.length ? `NOTE EDITORIALI:\n${approvedPlan.notes.join('\n')}` : '',
          contextSection,
        ].filter(Boolean).join('\n')

        const section = await streamPromptValidated(sectionPrompt, parseDispensaSectionPayload, 'dispensa_section')
        sections.push({
          ...section,
          id: section.id || planSection.id || `s${index + 1}`,
          title: section.title || planSection.title,
        })
      }

      const appendixPrompt = [
        'Compila SOLO appendici finali di una dispensa universitaria in JSON valido.',
        '',
        'RISPOSTA OBBLIGATORIA:',
        '- Rispondi SOLO con un blocco ```dispensa_appendix contenente JSON valido',
        '- Nessun commento prima o dopo',
        '',
        'SCHEMA JSON OBBLIGATORIO:',
        `{
  "exercises": [{"title": "esercizio", "prompt": "traccia", "solution": "soluzione opzionale"}],
  "references": ["riferimento"]
}`,
        '',
        'VINCOLI:',
        '- Massimo 6 exercises',
        '- Massimo 10 references',
        '- Se non servono esercizi o riferimenti, restituisci array vuoti',
        '- Se i token stanno finendo, chiudi sempre il JSON correttamente',
        '',
        `RICHIESTA: ${userRequest}`,
        `TITOLO DISPENSA: ${approvedPlan.title}`,
        contextSection,
      ].filter(Boolean).join('\n')

      const appendix = await streamPromptValidated(appendixPrompt, parseDispensaAppendixPayload, 'dispensa_appendix')
      const fullPayload: DispensaPayload = {
        title: meta.title || approvedPlan.title,
        subtitle: meta.subtitle || approvedPlan.subtitle || approvedPlan.title,
        abstract: meta.abstract,
        objectives: meta.objectives?.length ? meta.objectives : approvedPlan.objectives,
        sections,
        exercises: appendix.exercises || [],
        references: appendix.references || [],
      }

      return `\`\`\`dispensa_data\n${JSON.stringify(fullPayload, null, 2)}\n\`\`\``
    }

    if (mode === 'brochure') {
      const payload = await streamPromptValidated(prompt, parseBrochurePayload, 'brochure_data')
      return `\`\`\`brochure_data\n${JSON.stringify(payload, null, 2)}\n\`\`\``
    }

    if (mode === 'dispensa') {
      const payload = await streamPromptValidated(prompt, parseDispensaPayload, 'dispensa_data')
      return `\`\`\`dispensa_data\n${JSON.stringify(payload, null, 2)}\n\`\`\``
    }

    return (await streamPrompt(prompt)).trim()
  }

  const generateDispensaPlan = async (
    userRequest: string,
    chatHistory: Message[],
    filesContext: string
  ): Promise<DispensaPlan | null> => {
    const historyContext = chatHistory
      .filter(m => m.role !== 'system')
      .slice(-6)
      .map(m => `${m.role === 'user' ? 'Utente' : 'Assistente'}: ${m.content.substring(0, 300)}`)
      .join('\n')

    const prompt = [
      'Progetta il planning completo di una dispensa PDF ben formattata, destinata a impaginazione LaTeX.',
      '',
      'RISPOSTA OBBLIGATORIA:',
      '- Rispondi SOLO con un blocco ```dispensa_plan contenente JSON valido',
      '- Nessun commento prima o dopo',
      '',
      'SCHEMA JSON OBBLIGATORIO:',
      `{
  "title": "titolo dispensa",
  "subtitle": "sottotitolo",
  "objectives": ["obiettivo"],
  "sections": [
    {"id": "s1", "title": "titolo sezione", "focus": "cosa deve coprire"}
  ],
  "estimatedPages": "es. 8-10",
  "notes": ["vincolo editoriale o didattico"]
}`,
      '',
      'VINCOLI:',
      '- Struttura l intero documento',
      '- Pianifica una progressione didattica chiara',
      '- Prevedi sezioni adatte a formule, codice, box di definizione, esempi e tabelle quando servono',
      '- Massimo 10 sezioni',
      '',
      `RICHIESTA: ${userRequest}`,
      historyContext ? `CONTESTO CHAT:\n${historyContext}` : '',
      filesContext ? `MATERIALE ALLEGATO:\n${filesContext}` : '',
    ].filter(Boolean).join('\n')

    const response = await fetch('/api/v1/llm/teacher/chat-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        content: prompt,
        history: [],
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        agent_mode: 'default',
      })
    })
    if (!response.ok) throw new Error('Planning request failed')
    const reader = response.body?.getReader()
    let out = ''
    if (reader) {
      await consumeSseStream(reader, (data) => {
        if (data.type === 'chunk') out += data.content || ''
        if (data.type === 'done' && data.content) out = data.content
      })
    }
    return parseDispensaPlan(out)
  }

  const handleSend = async (overrideInput?: string) => {
    const userInput = (overrideInput ?? inputText).trim()

    const canSendAnalysis = agentMode === 'analysis' && analysisTaskId
    if ((!userInput && attachedFiles.length === 0 && !canSendAnalysis) || isLoading) return

    const filesInfo = attachedFiles.length > 0 ? ` [Allegati: ${attachedFiles.map(f => f.file.name).join(', ')}]` : ''
    let messageContent = userInput || (agentMode === 'analysis' ? 'Analizza le risposte degli studenti' : 'Analizza questi documenti')

    if (userInput && agentMode !== 'default' && agentMode !== 'image') {
      const prefixes: Partial<Record<AgentMode, string>> = {
        web_search: 'RICERCA WEB:',
        report: 'GENERA REPORT:',
        dataset: 'GENERA DATASET:',
        quiz: 'GENERA QUIZ:',
      }
      const prefix = prefixes[agentMode]
      if (prefix && !messageContent.startsWith(prefix)) {
        messageContent = `${prefix} ${messageContent}`
      }
    }

    const convId = await ensureConversation(messageContent)
    if (!convId) return // Should not happen but safety first

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: messageContent + filesInfo,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])

    const existingCachedMessages = conversationCacheRef.current[convId] || []
    const nextConversationMessages = [...existingCachedMessages, userMessage]
    const nextConversationCache = { ...conversationCacheRef.current, [convId]: nextConversationMessages }
    conversationCacheRef.current = nextConversationCache
    localStorage.setItem('teacher_support_messages_cache', JSON.stringify(nextConversationCache))
    setConversationCache(nextConversationCache)

    if (overrideInput === undefined) setInputText('')
    const currentFiles = [...attachedFiles]
    setAttachedFiles([])
    setIsLoading(true)

    try {
      if (agentMode === 'image') {
        // IMAGE GENERATION FLOW
        const providerLabel = imageProvider === 'dall-e' ? 'DALL-E 3' : 'GPT Image 1'

        // Step 1: Show connecting status
        setImageGenerationProgress({
          status: `Connessione al server ${providerLabel}...`,
          step: 'connecting',
          provider: providerLabel
        })

        // Step 2: Prompt Enhancement
        setImageGenerationProgress({
          status: 'Ottimizzazione del prompt...',
          step: 'enhancing',
          provider: providerLabel
        })

        const expansionPrompt = `Sei un esperto Prompt Engineer. Il tuo compito e' scrivere un prompt dettagliato e ottimizzato per generare un'immagine con il modello ${providerLabel}.

Basati sulla conversazione precedente per capire se l'utente sta chiedendo una nuova immagine o modifiche a una esistente.

Descrizione utente: "${messageContent}"

REGOLE IMPORTANTI:
- Scrivi SOLO il prompt in inglese, nient'altro.
- Sii molto descrittivo: specifica stile artistico, illuminazione, composizione, colori e dettagli tecnici.
- NON scrivere spiegazioni, commenti o altro testo.
- NON creare quiz, domande o contenuti didattici.
- Rispondi SOLO con il prompt ottimizzato per la generazione dell'immagine.`

        // Use actual history for context
        const expansionHistory = messages.map(m => ({ role: m.role, content: m.content }))

        const expansionResponse = await llmApi.teacherChat(
          expansionPrompt,
          expansionHistory,
          'tutor',  // NON usare 'teacher_support' - ha uses_agent:true che attiva intent classification
          'openai',
          'gpt-5-mini'
        )

        const enhancedPrompt = expansionResponse.data?.response?.trim() || messageContent

        // Step 3: Show enhanced prompt and start generation
        setImageGenerationProgress({
          status: `Generazione immagine con ${providerLabel}...`,
          step: 'generating',
          provider: providerLabel,
          enhancedPrompt: enhancedPrompt
        })

        console.log("Generating image with prompt:", enhancedPrompt, "Provider:", imageProvider)
        const genResponse = await llmApi.generateImage(enhancedPrompt, imageProvider)
        const imageUrl = genResponse.data?.image_url
        console.log("Image URL received:", imageUrl ? imageUrl.substring(0, 50) + "..." : "None")

        // Clear progress
        setImageGenerationProgress(null)

        if (imageUrl) {
          const assistantMessage: Message = {
            id: `resp-${Date.now()}`,
            role: 'assistant',
            content: `**Immagine Generata**\n\n![Generata](${imageUrl})\n\n**Prompt Effettivo:**\n\`${enhancedPrompt}\``,
            timestamp: new Date(),
            provider: imageProvider === 'dall-e' || imageProvider === 'gpt-image-1' ? 'openai' : 'flux',
            model: imageProvider === 'dall-e' ? 'dall-e-3' : imageProvider,
            token_usage_json: { image_count: 1 },
          }
          // IMPORTANTE: Aggiorna anche messages per mostrare subito l'immagine nella chat
          setMessages(prev => [...prev, assistantMessage])
          queryClient.invalidateQueries({ queryKey: ['llm-environmental-footprint'] })

          // Save to server
          await saveMessageToServer(convId, userMessage, assistantMessage, selectedModel)
        } else {
          throw new Error("Nessuna URL immagine ricevuta")
        }

      } else if (agentMode === 'analysis') {
        if (!analysisSessionId || !analysisTaskId) {
          throw new Error('Seleziona una sessione e un compito prima di avviare l\'analisi.')
        }
        const taskTitle = analysisTasksData?.find(t => t.id === analysisTaskId)?.title || 'compito selezionato'
        const sessionTitle = (classesData || []).find((s: any) => s.id === analysisSessionId)?.title || 'sessione'

        // Show status in the streaming slot
        const assistantId = `resp-${Date.now()}`
        setMessages(prev => [...prev, { id: assistantId, role: 'assistant' as const, content: '', timestamp: new Date() }])
        setStreamingStatus(`Caricamento risposte per «${taskTitle}»...`)

        const res = await teacherApi.analyzeTask(analysisSessionId, analysisTaskId, userInput || undefined)
        const data = res.data
        const submissionSummary = `📋 *${data.submission_count} su ${data.total_students} studenti hanno consegnato «${data.task_title}» (sessione: ${sessionTitle})*\n\n`
        const fullContent = submissionSummary + (data.analysis || 'Nessuna analisi disponibile.')

        setStreamingStatus(null)
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: fullContent } : m))
        const finalMsg: Message = { id: assistantId, role: 'assistant', content: fullContent, timestamp: new Date() }
        queryClient.invalidateQueries({ queryKey: ['llm-environmental-footprint'] })
        await saveMessageToServer(convId, userMessage, finalMsg, selectedModel)

      } else if (agentMode === 'brochure' || agentMode === 'dispensa') {
        // DOCUMENT GENERATION/EDITING FLOW
        setIsGeneratingDoc(true)
        const filesContext = currentFiles.map(f => f.file.name).join(', ')
        const isEdit = showCanvas && activeDoc?.type === agentMode
        const docLabel = agentMode === 'brochure' ? 'Brochure' : 'Dispensa'

        const shouldPlanDispensa = agentMode === 'dispensa'
          && !isEdit
          && (!pendingDispensaPlan || !/^approva/i.test(userInput))

        if (shouldPlanDispensa) {
          const plan = await generateDispensaPlan(messageContent, messages, filesContext)
          setIsGeneratingDoc(false)
          if (!plan) {
            throw new Error('Planning dispensa non valido.')
          }
          setPendingDispensaPlan(plan)
          setPendingDispensaRequest(messageContent)
          setPendingDispensaFilesContext(filesContext)
          const planSummary = [
            `## Piano dispensa`,
            `**Titolo:** ${plan.title}`,
            plan.subtitle ? `**Sottotitolo:** ${plan.subtitle}` : '',
            plan.estimatedPages ? `**Stima pagine:** ${plan.estimatedPages}` : '',
            plan.objectives.length ? `**Obiettivi:** ${plan.objectives.join(' · ')}` : '',
            '',
            ...plan.sections.map((section, index) => `${index + 1}. **${section.title}**${section.focus ? ` — ${section.focus}` : ''}`),
          ].filter(Boolean).join('\n')
          const assistantMessage: Message = {
            id: `plan-${Date.now()}`,
            role: 'assistant',
            content: `${planSummary}\n\nApprova il piano per generare la dispensa PDF oppure modifica la richiesta per rigenerarlo.`,
            timestamp: new Date(),
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
          }
          setMessages(prev => [...prev, assistantMessage])
          await saveMessageToServer(convId, userMessage, assistantMessage, 'claude-sonnet-4-6')
          return
        }

        // Add live progress message
        const progressId = `progress-${Date.now()}`
        const progressSteps = isEdit
          ? ['✏️ Analizzando il documento corrente...', '🔄 Applicando le modifiche richieste...', '🎨 Rigenerando il contenuto...', '✅ Quasi pronto...']
          : agentMode === 'brochure'
            ? ['🎨 Progettando il layout e la palette colori...', '✍️ Generando le sezioni di contenuto...', '🖼️ Ottimizzando il design HTML...', '✅ Finalizzando la brochure...']
            : ['📚 Strutturando capitoli, box e layout HTML...', '✍️ Generando contenuto accademico con formule...', '🔍 Revisione critica del documento...', '✨ Migliorando e finalizzando la dispensa...']
        setMessages(prev => [...prev, { id: progressId, role: 'assistant' as const, content: progressSteps[0], timestamp: new Date() }])

        // Advance progress steps during generation
        let stepIdx = 0
        const progressTimer = setInterval(() => {
          stepIdx = Math.min(stepIdx + 1, progressSteps.length - 1)
          setMessages(prev => prev.map(m => m.id === progressId ? { ...m, content: progressSteps[stepIdx] } : m))
        }, 4000)

        try {
          const docContent = await generateDocument(
            agentMode,
            pendingDispensaPlan && agentMode === 'dispensa' && !isEdit
              ? (pendingDispensaRequest || messageContent)
              : messageContent,
            messages,
            pendingDispensaPlan && agentMode === 'dispensa' && !isEdit ? pendingDispensaFilesContext : filesContext,
            isEdit,
            activeDoc,
            pendingDispensaPlan && agentMode === 'dispensa' && !isEdit ? pendingDispensaPlan : null
          )

          clearInterval(progressTimer)

          const parsedDocPayload = agentMode === 'brochure'
            ? parseBrochurePayload(docContent)
            : parseDispensaPayload(docContent)

          const newDoc: GeneratedDoc = {
            type: agentMode,
            content: parsedDocPayload ? JSON.stringify(parsedDocPayload, null, 2) : docContent,
            version: isEdit ? (activeDoc?.version ?? 0) + 1 : 1,
            title: agentMode === 'dispensa' && pendingDispensaPlan ? pendingDispensaPlan.title : messageContent.substring(0, 60),
          }
          setActiveDoc(newDoc)
          setShowCanvas(true)
          if (agentMode === 'dispensa') {
            setPendingDispensaPlan(null)
            setPendingDispensaRequest(null)
            setPendingDispensaFilesContext('')
          }

          // Persist doc to server (primary) + localStorage (fallback/offline)
          docCacheRef.current[convId] = newDoc
          localStorage.setItem('teacher_canvas_docs', JSON.stringify(docCacheRef.current))
          setConvsWithDocs(prev => new Set([...prev, convId]))
          teacherApi.saveConversationDocument(convId, newDoc).catch((e) => {
            console.warn('Failed to save document to server:', e)
          })

          // Replace progress message with final result
          const finalContent = isEdit
            ? `✅ **${docLabel} aggiornata** (v${newDoc.version}) — le modifiche sono visibili nel canvas a destra.`
            : `✅ **${docLabel} generata** (v${newDoc.version}) — il documento è aperto nel canvas. Puoi chiedere modifiche continuando la chat.`
          setMessages(prev => prev.map(m => m.id === progressId ? { ...m, content: finalContent } : m))
          const assistantMessage: Message = { id: progressId, role: 'assistant', content: finalContent, timestamp: new Date(), provider: 'anthropic', model: 'claude-sonnet-4-6' }
          await saveMessageToServer(convId, userMessage, assistantMessage, 'claude-sonnet-4-6')
        } catch (e) {
          clearInterval(progressTimer)
          setMessages(prev => prev.filter(m => m.id !== progressId))
          throw e
        } finally {
          setIsGeneratingDoc(false)
        }
      } else if (agentMode === 'web_search' || agentMode === 'quiz' || agentMode === 'dataset' || agentMode === 'report') {
        const streamResult = await runStreamingRequest(messageContent, [...messages, userMessage])
        let assistantContent = streamResult.content
        const shouldBuildReportArtifact = agentMode === 'report'
          && !/```session_selector[\s\S]*?```/.test(streamResult.content)
          && !/```report_type_selector[\s\S]*?```/.test(streamResult.content)
          && !/```student_selector[\s\S]*?```/.test(streamResult.content)

        if (shouldBuildReportArtifact) {
          setIsGeneratingDoc(true)
          setStreamingStatus('🧩 Generazione dashboard interattiva...')
          try {
            const reportPayloadRaw = await generateDocument(
              'report',
              streamResult.content,
              [...messages, userMessage],
              '',
              false,
              null
            )
            const parsedPayload = parseReportPayload(reportPayloadRaw)
            const reportDoc: GeneratedDoc = {
              type: 'report',
              content: parsedPayload ? JSON.stringify(parsedPayload, null, 2) : reportPayloadRaw,
              version: currentConversationId === convId && activeDoc?.type === 'report'
                ? (activeDoc.version ?? 0) + 1
                : ((docCacheRef.current[convId]?.type === 'report' ? docCacheRef.current[convId].version : 0) + 1),
              title: userInput.substring(0, 80) || 'Report interattivo classe',
            }
            setActiveDoc(reportDoc)
            setShowCanvas(true)
            docCacheRef.current[convId] = reportDoc
            localStorage.setItem('teacher_canvas_docs', JSON.stringify(docCacheRef.current))
            setConvsWithDocs(prev => new Set([...prev, convId]))
            teacherApi.saveConversationDocument(convId, reportDoc).catch((e) => {
              console.warn('Failed to save report document to server:', e)
            })
            assistantContent = `${streamResult.content}\n\n✅ **Dashboard interattiva generata** — il report avanzato è aperto nel canvas.`
          } finally {
            setIsGeneratingDoc(false)
            setStreamingStatus(null)
          }
        }

        const assistantMessage: Message = {
          id: `resp-${Date.now()}`,
          role: 'assistant',
          content: assistantContent,
          timestamp: new Date(),
          provider: streamResult.provider,
          model: streamResult.model,
          token_usage_json: streamResult.token_usage_json,
        }
        setMessages(prev => [...prev, assistantMessage])
        queryClient.invalidateQueries({ queryKey: ['llm-environmental-footprint'] })
        await saveMessageToServer(convId, userMessage, assistantMessage, 'claude-haiku-4-5-20251001')
      } else {
        // STANDARD CHAT FLOW
        const history = messages.map(m => ({ role: m.role, content: m.content }))
        const modelInfo = availableModels.find(m => m.id === selectedModel)

        if (currentFiles.length > 0) {
          // Files: use non-streaming endpoint (files can't go over SSE JSON)
          const response = await llmApi.teacherChatWithFiles(
            messageContent,
            history,
            'teacher_support',
            modelInfo?.provider || 'openai',
            selectedModel,
            currentFiles.map(f => f.file),
            imageProvider,
            imageSize
          )
          const assistantMessage: Message = {
            id: `resp-${Date.now()}`,
            role: 'assistant',
            content: response.data?.response || 'Errore nella risposta.',
            timestamp: new Date(),
            provider: response.data?.provider,
            model: response.data?.model,
            token_usage_json: {
              prompt_tokens: response.data?.prompt_tokens,
              completion_tokens: response.data?.completion_tokens,
            },
          }
          setMessages(prev => [...prev, assistantMessage])
          queryClient.invalidateQueries({ queryKey: ['llm-environmental-footprint'] })
          await saveMessageToServer(convId, userMessage, assistantMessage, selectedModel)
        } else {
          // Text-only: use streaming endpoint for typewriter effect
          const assistantId = `resp-${Date.now()}`
          setMessages(prev => [...prev, { id: assistantId, role: 'assistant' as const, content: '', timestamp: new Date() }])

          const _sessionId = (() => {
            try { return JSON.parse(localStorage.getItem('teacher_selected_session') || 'null')?.id ?? undefined }
            catch { return undefined }
          })()

          // history already excludes the current user message — backend appends it via `content`
          const streamResult = await runStreamingRequest(messageContent, messages, {
            sessionId: _sessionId,
            onChunk: (chunk) => {
              setMessages(prev => prev.map(m =>
                m.id === assistantId ? { ...m, content: m.content + chunk } : m
              ))
            },
            onStatus: (status) => {
              setStreamingStatus(status)
            },
            onCalendarEvent: (evt) => {
              toast({
                title: '📅 Evento creato',
                description: `"${evt.title}" il ${evt.event_date}${evt.event_time ? ` alle ${evt.event_time.slice(0,5)}` : ''}`,
              })
            },
          })

          setStreamingStatus(null)

          // Always replace with clean final content (strips any CALENDAR_EVENT tags)
          setMessages(prev => prev.map(m =>
            m.id === assistantId ? {
              ...m,
              content: streamResult.content || m.content,
              provider: streamResult.provider,
              model: streamResult.model,
              token_usage_json: streamResult.token_usage_json,
            } : m
          ))
          queryClient.invalidateQueries({ queryKey: ['llm-environmental-footprint'] })

          const finalMsg: Message = {
            id: assistantId,
            role: 'assistant',
            content: streamResult.content,
            timestamp: new Date(),
            provider: streamResult.provider,
            model: streamResult.model,
            token_usage_json: streamResult.token_usage_json,
          }
          await saveMessageToServer(convId, userMessage, finalMsg, selectedModel)
        }
      }
    } catch (e: any) {
      console.error("Teacher support chat error:", e)
      if (e.response) {
        console.error("Server Error Data:", e.response.data)
        console.error("Server Error Status:", e.response.status)
        console.error("Server Error Headers:", e.response.headers)
      } else if (e.request) {
        console.error("No request response received:", e.request)
      } else {
        console.error("Error setting up request:", e.message)
      }
      
      setImageGenerationProgress(null)
      setStreamingStatus(null)
      toast({ title: "Errore", description: `Impossibile completare la richiesta: ${e.response?.data?.detail || e.message}`, variant: "destructive" })
      const errorMsg: Message = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: t('teacher_chat.generation_error_check_console'),
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMsg])
    } finally {
      setIsLoading(false)
      setImageGenerationProgress(null)
    }
  }

  const handleNewChat = () => {
    setMessages([])
    setCurrentConversationId(null)
    setAttachedFiles([])
    setActiveDoc(null)
    setShowCanvas(false)
  }

  const handleOpenPromptEditor = async () => {
    try {
      const res = await teacherApi.getSupportChatPrompt()
      const { custom_prompt, default_prompt } = res.data
      setPromptEditorDefault(default_prompt)
      setPromptEditorValue(custom_prompt ?? default_prompt)
      setShowPromptEditor(true)
    } catch {
      toast({ title: 'Errore', description: 'Impossibile caricare il prompt.', variant: 'destructive' })
    }
  }

  const handleSavePrompt = async () => {
    setPromptEditorSaving(true)
    try {
      const isDefault = promptEditorValue.trim() === promptEditorDefault.trim()
      await teacherApi.updateSupportChatPrompt(isDefault ? null : promptEditorValue)
      toast({ title: 'Prompt salvato', description: isDefault ? 'Ripristinato al prompt predefinito.' : 'Il tuo prompt personalizzato è attivo.' })
      setShowPromptEditor(false)
    } catch {
      toast({ title: 'Errore', description: 'Impossibile salvare il prompt.', variant: 'destructive' })
    } finally {
      setPromptEditorSaving(false)
    }
  }

  const handleClearAllConversations = async () => {
    if (!confirm('Eliminare tutta la cronologia del chatbot docente?')) return
    try {
      await teacherApi.deleteAllConversations()
      setConversations([])
      setMessages([])
      setCurrentConversationId(null)
      setActiveDoc(null)
      setShowCanvas(false)
      setConversationCache({})
      conversationCacheRef.current = {}
      docCacheRef.current = {}
      setConvsWithDocs(new Set())
      localStorage.removeItem('teacher_support_messages_cache')
      localStorage.removeItem('teacher_support_current_conversation_id')
      localStorage.removeItem('teacher_canvas_docs')
      toast({ title: 'Cronologia eliminata', description: 'Tutte le conversazioni del docente sono state rimosse.' })
    } catch (e) {
      console.error(e)
      toast({ title: 'Errore', description: 'Impossibile eliminare la cronologia completa.', variant: 'destructive' })
    }
  }

  const buildModeInvitation = (mode: AgentMode): string | null => {
    if (mode === 'dataset') {
      return 'Sei in modalità **Dataset**. Descrivi il dataset che vuoi generare: argomento, numero di colonne e righe, tipo di dati, eventuale correlazione tra variabili.'
    }
    if (mode === 'image') {
      return "Sei in modalità **Immagine**. Descrivi l'immagine che vuoi generare: soggetto, azione, sfondo, stile visivo."
    }
    if (mode === 'quiz') {
      return 'Sei in modalità **Quiz**. Descrivi il quiz che vuoi generare: argomento, numero di domande, opzioni per domanda, livello di difficoltà.'
    }
    if (mode === 'report') {
      const sessions = classesData || []
      return [
        'Per generare la reportistica devo prima sapere quale sessione analizzare e quale formato vuoi ottenere.',
        '',
        '```session_selector',
        JSON.stringify(sessions, null, 2),
        '```',
        '',
        '```report_type_selector',
        JSON.stringify(REPORT_TYPE_OPTIONS, null, 2),
        '```',
      ].join('\n')
    }
    if (mode === 'brochure') {
      return 'Sei in modalità **Brochure** 🎨 (Claude Sonnet 4.6). Descrivi il contenuto della brochure: argomento, punti chiave, pubblico target. Puoi allegare documenti o incollare link per arricchire il contenuto. Il documento sarà generato come file HTML graficamente ricco.'
    }
    if (mode === 'dispensa') {
      return 'Sei in modalità **Dispensa** 📄 (Claude Sonnet 4.6 + revisione critica). Descrivi il contenuto della dispensa universitaria: argomento, capitoli principali, livello di dettaglio. Il documento sarà generato come HTML ricco con formule MathJax, box definizioni/teoremi/esempi, tabelle e colori. Dopo la generazione viene eseguita automaticamente una revisione critica per migliorare la qualità.'
    }
    return null
  }

  const handleChangeAgentMode = (mode: AgentMode) => {
    setShowModeMenu(false)
    if (mode === agentMode && mode !== 'default') {
      // Re-click: show invitation again
      const inviteMsg = buildModeInvitation(mode)
      if (inviteMsg) {
        setMessages(prev => [...prev, {
          id: `invite-${Date.now()}`,
          role: 'assistant',
          content: inviteMsg,
          timestamp: new Date()
        }])
      }
      return
    }

    setAgentMode(mode)
    if (currentConversationId) {
      void syncConversationMode(currentConversationId, mode)
    }
    if (mode === 'dataset' || mode === 'image' || mode === 'report' || mode === 'quiz') {
      setAttachedFiles([])
      setInputText('')
    }

    const inviteMsg = buildModeInvitation(mode)
    if (inviteMsg) {
      setMessages(prev => [...prev, {
        id: `invite-${Date.now()}`,
        role: 'assistant',
        content: inviteMsg,
        timestamp: new Date()
      }])
    }
  }

  const handlePublish = async (sessionId: string) => {
    if (!publishModal.data) return

    try {
      let contentJson = ""
      let taskType = ""
      let title = ""

      if (publishModal.type === 'quiz') {
        if (!publishModal.data?.questions) {
          toast({ title: "Errore", description: "Quiz non valido", variant: "destructive" })
          return
        }
        contentJson = JSON.stringify({
          type: 'quiz',
          questions: publishModal.data.questions.map((q: any) => ({
            question: q.question,
            options: q.options,
            correctIndex: q.correctIndex,
            explanation: q.explanation
          }))
        })
        taskType = 'quiz'
        title = publishModal.data.title || "Nuovo Quiz"
      } else {
        contentJson = JSON.stringify({
          type: 'exercise',
          text: `Analizza il seguente dataset CSV:\n\n${publishModal.data}`
        })
        taskType = 'exercise'
        title = "Analisi Dataset CSV"
      }

      const taskRes = await teacherApi.createTask(sessionId, {
        title,
        description: `Compito creato da AI Support (${publishModal.type})`,
        task_type: taskType,
        content_json: contentJson
      })
      const createdTaskId = taskRes?.data?.id as string | undefined

      if (publishMode === 'published' && createdTaskId) {
        await teacherApi.updateTask(sessionId, createdTaskId, { new_status: 'published' })
      }

      toast({
        title: publishMode === 'published' ? "Compito pubblicato!" : "Compito salvato in bozza",
        description: publishMode === 'published' ? "Notifica automatica inviata agli studenti" : "Puoi pubblicarlo in seguito dal pannello sessione",
        className: "bg-green-500 text-white"
      })
      setPublishModal({ isOpen: false, type: 'quiz', data: null })
      setPublishMode('published')
    } catch (e) {
      console.error(e)
      toast({ title: "Errore pubblicazione", variant: "destructive" })
    }
  }


  return (
    <>
      <div className="h-full flex flex-col bg-transparent font-sans" style={accentVars} onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
        


        {/* Mobile history slide-over */}
        {isMobile && mobileHistoryOpen && (
          <div className="fixed inset-0 z-50 flex" onClick={() => setMobileHistoryOpen(false)}>
            <div className={`w-72 h-full shadow-2xl flex flex-col ${PASTEL_SURFACES.slate}`} onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b border-slate-200/70 flex items-center justify-between bg-white/55 backdrop-blur-sm">
                <h2 className="text-sm font-semibold text-slate-800">Cronologia</h2>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={handleNewChat} className={`h-8 w-8 p-0 ${PASTEL_ICON_BACKGROUNDS.indigo} hover:bg-indigo-200/80`}>
                    <Plus className={`h-4 w-4 ${PASTEL_ICON_TEXT.indigo}`} />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setMobileHistoryOpen(false)} className="h-8 w-8 p-0 hover:bg-white/70">
                    <X className="h-4 w-4 text-slate-400" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {conversations.map(conv => (
                  <button
                    key={conv.id}
                    onClick={() => { openConversation(conv); setMobileHistoryOpen(false) }}
                    className={`w-full text-left p-3 rounded-[18px] text-sm transition-all ${currentConversationId === conv.id ? 'font-medium border shadow-sm' : `${PASTEL_SURFACES.slate} text-slate-600 shadow-sm`}`}
                    style={currentConversationId === conv.id ? selectedSoftStyle : undefined}
                  >
                    <div className="truncate">{conv.title}</div>
                    <span className="text-xs text-slate-400">{conv.createdAt.toLocaleDateString()}</span>
                  </button>
                ))}
                {conversations.length === 0 && (
                  <p className="text-xs text-slate-400 text-center py-8">Nessuna conversazione</p>
                )}
              </div>
            </div>
            <div className="flex-1 bg-black/30 backdrop-blur-sm" />
          </div>
        )}

        {/* Main Content Area */}
        <div className={`flex-1 overflow-hidden ${isMobile ? 'px-0 pb-0' : 'px-4 pt-4 pb-4'}`}>
              <div className={`flex h-full ${isMobile ? '' : 'max-w-[1800px] mx-auto w-full'}`}>
                {/* Unified card: sidebar + chat together */}
                <div className={`flex-1 flex h-full overflow-hidden ${isMobile ? '' : 'bg-white rounded-[28px] border border-slate-200 shadow-sm'}`}>
                 {/* Sidebar — desktop only */}
                 <aside className={`${isMobile ? 'hidden' : ''} ${isSidebarCollapsed ? 'w-12' : 'w-64'} flex flex-col transition-all duration-300 flex-shrink-0 overflow-hidden border-r border-slate-200/70 bg-slate-50/60 backdrop-blur-sm`}>
                  {isSidebarCollapsed ? (
                    /* Collapsed: just expand button */
                    <div className="p-2 flex flex-col items-center gap-3 pt-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsSidebarCollapsed(false)}
                        className={`h-8 w-8 p-0 shadow-sm ${PASTEL_SURFACES.indigo}`}
                        title="Espandi"
                      >
                        <ChevronRight className={`h-4 w-4 ${PASTEL_ICON_TEXT.indigo}`} />
                      </Button>
                    </div>
                  ) : (
                    <>
                      {/* Section tabs — pill switcher */}
                      <div className="px-2.5 pt-2 pb-1.5 bg-white/60 border-b border-slate-200/70 shrink-0 flex items-center gap-1 backdrop-blur-sm">
                        <div className={`flex-1 flex items-center gap-1 p-1 rounded-[18px] shadow-sm ${PASTEL_SURFACES.slate}`}>
                          <button
                            onClick={() => setActiveTab('chat')}
                            className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold rounded-xl transition-all duration-200 shadow-sm ${activeTab === 'chat'
                              ? `${PASTEL_SURFACES.indigo} ${PASTEL_ICON_TEXT.indigo}`
                              : 'text-slate-400 hover:text-slate-500'}`}
                          >
                            <MessageCircle className="h-3 w-3" />
                            Cronologia
                          </button>
                          <button
                            onClick={() => setActiveTab('teacherbots')}
                            className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-[10px] font-bold rounded-xl transition-all duration-200 shadow-sm ${activeTab === 'teacherbots'
                              ? `${PASTEL_SURFACES.violet} ${PASTEL_ICON_TEXT.violet}`
                              : 'text-slate-400 hover:text-slate-500'}`}
                          >
                            <Sparkles className="h-3 w-3" />
                            Teacherbots
                          </button>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setIsSidebarCollapsed(true)}
                          className={`h-7 w-7 p-0 flex-shrink-0 shadow-sm ${PASTEL_SURFACES.slate}`}
                          title="Comprimi"
                        >
                          <ChevronDown className="h-4 w-4 text-slate-400 rotate-90" />
                        </Button>
                      </div>

                      {activeTab === 'chat' ? (
                        <>
                          {/* Action bar */}
                          <div className="px-3 py-2 flex gap-2 border-b border-slate-200/60 shrink-0 bg-white/30">
                            <Button variant="ghost" size="sm" onClick={handleNewChat} className={`h-8 w-8 p-0 shadow-sm ${PASTEL_SURFACES.indigo}`} title="Nuova chat">
                              <Plus className={`h-4 w-4 ${PASTEL_ICON_TEXT.indigo}`} />
                            </Button>
                            <Button variant="ghost" size="sm" onClick={handleClearAllConversations} className={`h-8 w-8 p-0 shadow-sm ${PASTEL_SURFACES.rose}`} title="Pulisci cronologia">
                              <Trash2 className={`h-4 w-4 ${PASTEL_ICON_TEXT.rose}`} />
                            </Button>
                          </div>
                          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
                            {conversations.map(conv => (
                              <button
                                key={conv.id}
                                onClick={() => { openConversation(conv) }}
                                className={`w-full text-left p-3 rounded-[18px] text-sm transition-all group ${currentConversationId === conv.id
                                  ? 'font-medium border shadow-sm'
                                  : `${PASTEL_SURFACES.slate} text-slate-600 shadow-sm`
                                  }`}
                                style={currentConversationId === conv.id ? selectedSoftStyle : undefined}
                              >
                                <div className="flex items-center gap-1 min-w-0">
                                  <span className="truncate flex-1">{conv.title}</span>
                                  {convsWithDocs.has(conv.id) && (
                                    <span title="Ha un documento generato"><Layout className="h-3 w-3 text-fuchsia-400 flex-shrink-0" /></span>
                                  )}
                                </div>
                                <div className="flex items-center justify-between mt-1">
                                  <span className="text-xs text-slate-400">{conv.createdAt.toLocaleDateString()}</span>
                                  <button
                                    className="text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                    style={{ color: currentConversationId === conv.id ? accentTheme.text : undefined }}
                                    onClick={async (e) => {
                                      e.stopPropagation()
                                      if (confirm('Eliminare questa conversazione?')) {
                                        try {
                                          await teacherApi.deleteConversation(conv.id)
                                        } catch (err) {
                                          console.error('Failed to delete conv:', err)
                                        }
                                        setConversations(prev => prev.filter(c => c.id !== conv.id))
                                        setConversationCache(prev => {
                                          const next = { ...prev }
                                          delete next[conv.id]
                                          conversationCacheRef.current = next
                                          localStorage.setItem('teacher_support_messages_cache', JSON.stringify(next))
                                          return next
                                        })
                                        // Remove doc from cache
                                        delete docCacheRef.current[conv.id]
                                        localStorage.setItem('teacher_canvas_docs', JSON.stringify(docCacheRef.current))
                                        setConvsWithDocs(prev => { const s = new Set(prev); s.delete(conv.id); return s })
                                        if (currentConversationId === conv.id) handleNewChat()
                                      }
                                    }}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </div>
                              </button>
                            ))}
                            {conversations.length === 0 && (
                              <p className="text-xs text-slate-400 text-center py-8">Nessuna conversazione</p>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="flex-1 overflow-y-auto px-3 py-2 bg-white/20">
                          <TeacherbotsPanel
                            onOpenSettings={(id) => setBotPanelTarget(id)}
                            onCreateNew={() => setBotPanelTarget('create')}
                          />
                        </div>
                      )}
                    </>
                  )}
                </aside>

                 {/* Chat Main + Canvas split */}
                 <div className="flex-1 flex overflow-hidden min-w-0">
                 <main className={`flex-1 flex flex-col relative overflow-hidden min-w-0`} style={chatBg ? { backgroundColor: chatBg } : undefined}>

                  {/* Support Chat Prompt Editor Modal */}
                  {showPromptEditor && (
                    <div className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
                      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ backgroundColor: accentTheme.accent }}>
                              <Settings className="h-4 w-4 text-white" />
                            </div>
                            <div>
                              <h2 className="text-sm font-bold text-slate-800">Personalizza il tuo Assistente</h2>
                              <p className="text-xs text-slate-500">Modifica il comportamento del chatbot di supporto docente</p>
                            </div>
                          </div>
                          <button onClick={() => setShowPromptEditor(false)} className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
                            <X className="h-4 w-4 text-slate-500" />
                          </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                          <p className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 border border-slate-200">
                            Questo è il <strong>system prompt</strong> del tuo assistente AI. Determina il suo comportamento, tono e capacità. Puoi personalizzarlo liberamente — le modifiche si applicano alle nuove conversazioni.
                          </p>
                          <textarea
                            value={promptEditorValue}
                            onChange={(e) => setPromptEditorValue(e.target.value)}
                            className="w-full h-80 text-xs font-mono border border-slate-200 rounded-xl p-4 resize-none focus:outline-none focus:ring-2 focus:border-transparent"
                            style={{ ['--tw-ring-color' as string]: accentTheme.border }}
                            placeholder="Inserisci qui il system prompt del tuo assistente..."
                            spellCheck={false}
                          />
                        </div>
                        <div className="px-6 py-4 border-t border-slate-200 flex items-center justify-between gap-3">
                          <button
                            onClick={() => setPromptEditorValue(promptEditorDefault)}
                            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Ripristina default
                          </button>
                          <div className="flex items-center gap-2">
                            <Button variant="outline" size="sm" onClick={() => setShowPromptEditor(false)}>
                              Annulla
                            </Button>
                            <Button
                              size="sm"
                              disabled={promptEditorSaving}
                              onClick={handleSavePrompt}
                              style={{ backgroundColor: accentTheme.accent, color: '#fff' }}
                            >
                              {promptEditorSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Salva'}
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Teacherbot config modal — full-screen centered modal */}
                  {botPanelTarget && (
                    <div className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-sm flex items-start justify-center overflow-y-auto p-6">
                      <div className="bg-white rounded-2xl w-full max-w-2xl my-8 shadow-2xl overflow-hidden">
                        <TeacherbotForm
                          teacherbotId={botPanelTarget !== 'create' ? botPanelTarget : undefined}
                          onBack={() => setBotPanelTarget(null)}
                          onSaved={() => setBotPanelTarget(null)}
                        />
                      </div>
                    </div>
                  )}

                  <header className="px-3 py-2 border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-10 flex items-center justify-between shrink-0">
                    {isMobile ? (
                      /* Mobile header — essential only */
                      <>
                        <button
                          onClick={() => setMobileHistoryOpen(true)}
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                        >
                          <MessageCircle className="h-4 w-4 text-slate-500" />
                          <span className="text-xs text-slate-500 font-medium">Storico</span>
                        </button>

                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center shadow-sm" style={{ backgroundColor: accentTheme.accent }}>
                            <Bot className="h-3.5 w-3.5 text-white" />
                          </div>
                          <span className="text-sm font-bold text-slate-800">AI Docente</span>
                        </div>

                        <button
                          onClick={handleNewChat}
                          className="flex items-center gap-1 px-2 py-1.5 rounded-lg hover:bg-slate-100 transition-colors"
                        >
                          <Plus className="h-4 w-4 text-slate-500" />
                          <span className="text-xs text-slate-500 font-medium">Nuova</span>
                        </button>
                      </>
                    ) : (
                      /* Desktop header — full controls */
                      <>
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center shadow-md" style={{ backgroundColor: accentTheme.accent }}>
                        <Bot className="h-4 w-4 text-white translate-y-[1px]" />
                      </div>
                      <div>
                        <h1 className="text-sm font-bold text-slate-800">Supporto Docente AI</h1>
                        <p className="text-xs text-slate-500">
                          {(agentMode === 'brochure' || agentMode === 'dispensa')
                            ? 'Claude Sonnet 4.6'
                            : (agentMode === 'quiz' || agentMode === 'dataset' || agentMode === 'web_search' || agentMode === 'report' || agentMode === 'analysis')
                            ? 'Claude Haiku'
                            : availableModels.find(m => m.id === selectedModel)?.name}
                        </p>
                      </div>
                      {/* Reopen canvas button — shown when a doc exists for this conversation but canvas is closed */}
                      {currentConversationId && convsWithDocs.has(currentConversationId) && !showCanvas && (
                        <button
                          onClick={() => {
                            const doc = docCacheRef.current[currentConversationId]
                            if (doc) { setActiveDoc(doc); setShowCanvas(true) }
                          }}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100 transition-colors"
                        >
                          <Layout className="h-3 w-3" />
                          Riapri documento
                        </button>
                      )}
                    </div>

                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3 animate-in fade-in slide-in-from-right-4 duration-300">
                        {/* Generatore */}
                        {agentMode === 'image' && (
                          <>
                            <div className="flex items-center bg-slate-100/80 rounded-full p-1 border border-slate-200">
                              {([
                                { id: 'dall-e', label: '🎨 DALL-E 3' },
                                { id: 'gpt-image-1', label: '✨ GPT Image 1' },
                              ] as { id: 'dall-e' | 'gpt-image-1'; label: string }[]).map((m) => (
                                <button
                                  key={m.id}
                                  onClick={() => setImageProvider(m.id)}
                                  className={`px-3 py-1 text-[10px] rounded-full transition-all flex items-center gap-1 ${imageProvider === m.id
                                    ? 'bg-white shadow-sm font-bold'
                                    : 'text-slate-500 hover:text-slate-700'
                                    }`}
                                  style={imageProvider === m.id ? { color: accentTheme.text } : undefined}
                                >
                                  {m.label}
                                </button>
                              ))}
                            </div>

                            {/* Formato */}
                            <div className="relative">
                              <select
                                value={imageSize}
                                onChange={(e) => setImageSize(e.target.value)}
                                className="text-xs bg-slate-100/80 border border-slate-200 rounded-full px-3 py-1.5 text-slate-600 focus:ring-2 focus:border-transparent cursor-pointer hover:bg-slate-50 outline-none appearance-none pr-8"
                                style={{ ['--tw-ring-color' as string]: accentTheme.border }}
                              >
                                <option value="1024x1024">1:1 Quadrato</option>
                                <option value="1024x768">4:3 Orizzontale</option>
                                <option value="768x1024">3:4 Verticale</option>
                                <option value="1280x720">16:9 Panorama</option>
                                <option value="720x1280">9:16 Portrait</option>
                              </select>
                              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 pointer-events-none" />
                            </div>
                          </>
                        )}


                        {(agentMode === 'brochure' || agentMode === 'dispensa') ? (
                          <span className="text-[10px] bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                            <img src="/icone_ai/anthropic.svg" className="h-3 w-3 object-contain" alt="Anthropic" />
                            Claude Sonnet 4.6
                          </span>
                        ) : (agentMode === 'quiz' || agentMode === 'dataset' || agentMode === 'web_search' || agentMode === 'report') ? (
                          <div className="text-xs rounded-full px-3 py-1.5 font-medium border bg-slate-100 text-slate-700 border-slate-200">
                            Claude Haiku (fisso)
                          </div>
                        ) : (
                          agentMode !== 'image' && (
                            <div className="relative" ref={modelMenuRef}>
                              <button
                                onClick={() => setShowModelMenu(!showModelMenu)}
                                className="flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold transition-all shadow-sm group hover:opacity-90 border"
                                style={selectedSoftStyle}
                              >
                                <div className="p-0.5 bg-white/20 rounded-md">
                                  <ModelIcon provider={availableModels.find(m => m.id === selectedModel)?.provider || ''} modelId={selectedModel} className="h-3 w-3" />
                                </div>
                                <span>{availableModels.find(m => m.id === selectedModel)?.name}</span>
                                <ChevronDown className={`h-3 w-3 transition-transform ${showModelMenu ? 'rotate-180' : ''}`} />
                              </button>

                              {/* Dropdown */}
                              {showModelMenu && (
                                <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-100 py-1 z-[100] animate-in fade-in zoom-in-95 duration-100 overflow-visible ring-1 ring-black/5">
                                  <div className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50/50 border-b border-slate-100 mb-1 flex justify-between items-center">
                                    <span>Seleziona Modello</span>
                                    <span className="text-[9px] font-normal text-slate-400">Default</span>
                                  </div>
                                  {availableModels.map(m => (
                                    <div
                                      key={m.id}
                                      className={`flex items-center justify-between px-3 py-2.5 mx-1 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer group border ${selectedModel === m.id ? '' : 'border-transparent'}`}
                                      style={selectedModel === m.id ? selectedSoftStyle : undefined}
                                      onClick={() => {
                                        setSelectedModel(m.id)
                                        setShowModelMenu(false)
                                      }}
                                    >
                                      <div className="flex items-center gap-3">
                                        <div
                                          className={`p-2 rounded-lg ${selectedModel === m.id ? 'ring-1' : 'bg-slate-100 transition-colors'}`}
                                          style={selectedModel === m.id
                                            ? { backgroundColor: accentTheme.softStrong, borderColor: accentTheme.border, color: accentTheme.text }
                                            : undefined}
                                        >
                                          <ModelIcon provider={m.provider} modelId={m.id} className="h-5 w-5" />
                                        </div>
                                        <div className="flex flex-col">
                                          <span className={`text-sm font-bold ${selectedModel === m.id ? '' : 'text-slate-700'}`} style={selectedModel === m.id ? { color: accentTheme.text } : undefined}>
                                            {m.name}
                                          </span>
                                          <span className="text-[10px] text-slate-400 capitalize font-medium">{m.provider}</span>
                                        </div>
                                      </div>

                                      {/* Default Checkbox */}
                                      <div
                                        className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-slate-100 transition-colors"
                                        onClick={(e) => handleSetDefaultModel(m.id, e)}
                                        title="Imposta come default"
                                      >
                                        <div
                                          className={`w-4 h-4 rounded border flex items-center justify-center transition-all duration-200 ${defaultModel === m.id
                                            ? 'shadow-sm'
                                            : 'border-slate-300 text-transparent mx-auto'
                                            }`}
                                          style={defaultModel === m.id ? selectedSolidStyle : undefined}
                                        >
                                          {defaultModel === m.id && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        )}
                      </div>

                      <div className="hidden lg:flex items-center gap-2 relative">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={handleOpenPromptEditor}
                          className="text-slate-500 hover:text-slate-700"
                          title="Personalizza il prompt del tuo assistente"
                        >
                          <Settings className="h-4 w-4" />
                        </Button>
                        <div className="relative">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowBgPalette((v) => !v)}
                            className="text-slate-500 hover:text-slate-700"
                            title="Scegli colore"
                          >
                            <Palette className="h-4 w-4" />
                          </Button>
                          {showBgPalette && (
                            <div className="absolute right-0 top-10 z-30 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl">
                              <div className="space-y-3">
                                {paletteGroups.map((group) => (
                                  <div key={group.label}>
                                    <div className="text-[10px] text-slate-400 mb-1">{group.label}</div>
                                    <div className="grid grid-cols-5 gap-1">
                                      {group.colors.map((color) => (
                                        <button
                                          key={`${group.label}-${color}`}
                                          onClick={() => {
                                            setChatBg(color)
                                            setShowBgPalette(false)
                                          }}
                                          className={`h-6 w-6 rounded-md border transition-transform hover:scale-105 ${chatBg === color ? 'ring-2 ring-offset-1' : ''}`}
                                          style={chatBg === color ? { backgroundColor: color, boxShadow: `0 0 0 2px ${accentTheme.accent}` } : { backgroundColor: color }}
                                          title={color}
                                        />
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                              <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                                <span>Palette ridotta</span>
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => chatBg && handleSetDefaultChatBg(chatBg)}
                                    className={`text-slate-500 hover:text-slate-700 ${chatBg ? '' : 'opacity-40 cursor-not-allowed'}`}
                                    disabled={!chatBg}
                                  >
                                    Imposta default
                                  </button>
                                  {chatBgDefault && (
                                    <button
                                      onClick={() => {
                                        setChatBg(chatBgDefault)
                                        setShowBgPalette(false)
                                      }}
                                      className="text-slate-500 hover:text-slate-700"
                                    >
                                      Usa default
                                    </button>
                                  )}
                                  <button
                                    onClick={() => {
                                      setChatBg('')
                                      setShowBgPalette(false)
                                    }}
                                    className="text-slate-500 hover:text-slate-700"
                                  >
                                    Reset
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                      </>
                    )}
                  </header>

                  {/* Mobile: agent mode pills row */}
                  {isMobile && (
                    <div className="flex gap-1.5 overflow-x-auto px-3 py-2 border-b border-slate-100 scrollbar-none shrink-0">
                      {AGENT_MODES.map(m => {
                        const isActive = agentMode === m.id
                        return (
                          <button
                            key={m.id}
                            onClick={() => handleChangeAgentMode(m.id)}
                            className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-semibold transition-colors border ${isActive ? 'text-white border-transparent shadow-sm' : 'text-slate-500 border-slate-200 bg-white hover:bg-slate-50'}`}
                            style={isActive ? { backgroundColor: accentTheme.accent, borderColor: accentTheme.accent } : undefined}
                          >
                            {m.id === 'image' ? t('teacher_chat.mode_image') : m.label}
                          </button>
                        )
                      })}
                    </div>
                  )}

                  <div
                    ref={chatScrollRef}
                    className={`flex-1 overflow-y-auto ${isMobile ? 'px-3 py-3' : 'px-4 py-6'} ${chatBgIsDark ? 'text-white' : ''}`}
                    style={{ WebkitOverflowScrolling: 'touch', scrollBehavior: 'smooth' }}
                    onScroll={(e) => {
                      if (e.currentTarget.scrollTop < 80 && hasMoreMessages && !isLoadingOlder) {
                        loadOlderMessages()
                      }
                    }}
                  >
                    {/* Load older indicator */}
                    {isLoadingOlder && (
                      <div className="flex justify-center py-3">
                        <div className="flex items-center gap-2 text-xs text-slate-400 bg-white/80 px-3 py-1.5 rounded-full border border-slate-100 shadow-sm">
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay: '150ms' }} />
                          <span className="w-1.5 h-1.5 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay: '300ms' }} />
                          <span className="ml-1">Caricamento messaggi precedenti</span>
                        </div>
                      </div>
                    )}
                    {hasMoreMessages && !isLoadingOlder && (
                      <div className="flex justify-center py-2">
                        <button onClick={loadOlderMessages} className="text-xs text-slate-400 hover:text-slate-600 underline">
                          Carica messaggi precedenti
                        </button>
                      </div>
                    )}
                    <div className="max-w-3xl mx-auto w-full space-y-3 md:space-y-6 min-h-full flex flex-col">
                    {messages.length === 0 ? (
                      (loadingConversations || loadingMessages) ? (
                        /* Buffering skeleton while conversations load */
                        <div className="h-full flex flex-col justify-end gap-4 pb-2 pointer-events-none select-none">
                          {/* Fake assistant messages */}
                          {[72, 52, 88, 44].map((w, i) => (
                            <div key={i} className={`flex gap-3 ${i % 2 === 1 ? 'justify-end' : 'justify-start'}`}>
                              {i % 2 === 0 && (
                                <div className="w-8 h-8 rounded-full bg-slate-100 animate-pulse flex-shrink-0" />
                              )}
                              <div className={`flex flex-col gap-1.5 ${i % 2 === 1 ? 'items-end' : 'items-start'}`}>
                                <div
                                  className="h-9 rounded-2xl bg-slate-100 animate-pulse"
                                  style={{ width: `${w * 3}px`, animationDelay: `${i * 120}ms` }}
                                />
                                <div
                                  className="h-3 rounded bg-slate-100 animate-pulse"
                                  style={{ width: `${w * 1.2}px`, animationDelay: `${i * 120 + 60}ms` }}
                                />
                              </div>
                              {i % 2 === 1 && (
                                <div className="w-8 h-8 rounded-full bg-slate-100 animate-pulse flex-shrink-0" />
                              )}
                            </div>
                          ))}
                          {/* Typing indicator */}
                          <div className="flex gap-3 justify-start">
                            <div className="w-8 h-8 rounded-full bg-slate-100 animate-pulse flex-shrink-0" />
                            <div className="bg-slate-100 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                              <span className="w-2 h-2 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay: '150ms' }} />
                              <span className="w-2 h-2 rounded-full bg-slate-300 animate-bounce" style={{ animationDelay: '300ms' }} />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center opacity-50">
                          <Bot className="h-12 w-12 text-slate-300 mb-4" />
                          <p className="text-slate-400 font-medium">Inizia una nuova conversazione</p>
                        </div>
                      )
                    ) : (
                      messages.map((msg) => (
                        <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          {msg.role === 'assistant' && (
                            <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center flex-shrink-0">
                              <Bot className="h-4 w-4 text-red-500" />
                            </div>
                          )}
                          <div className={`max-w-[75%] space-y-1 ${msg.role === 'user' ? 'items-end flex flex-col' : 'items-start'}`}>
                            <div className={`px-5 py-3 text-sm leading-relaxed shadow-sm backdrop-blur-md transition-all ${msg.role === 'user'
                              ? `${chatBgIsDark ? 'bg-white/20 text-white border border-white/20' : 'text-white border border-transparent shadow-md'} font-medium rounded-2xl rounded-tr-sm`
                              : `${chatBgIsDark ? 'bg-white/10 text-white border border-white/15' : 'bg-slate-50/60 text-slate-800 border border-slate-200/80'} rounded-2xl rounded-tl-sm ${chatBgIsDark ? 'prose prose-invert' : ''}`
                              }`}
                              style={msg.role === 'user' && !chatBgIsDark ? selectedSolidStyle : undefined}
                            >
                              {msg.role === 'assistant' ? (
                                <MessageContent
                                  content={msg.content}
                                  onPublish={(type, data) => {
                                    setPublishMode('published')
                                    setPublishModal({ isOpen: true, type, data })
                                  }}
                                  onEdit={(type, data) => setEditorModal({ isOpen: true, type, data })}
                                  onInput={(text) => {
                                    setInputText(text);
                                    // Automatically trigger send after selection
                                    setTimeout(() => handleSend(), 100);
                                  }}
                                  toast={toast}
                                  darkMode={chatBgIsDark}
                                />
                              ) : (
                                <ReactMarkdown className={`prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-slate-800 prose-pre:text-slate-100 ${msg.role === 'user' ? '[&_*]:!text-white' : ''} [&_strong]:font-bold`}>
                                  {convertEmoticons(msg.content)}
                                </ReactMarkdown>
                              )}
                              {/* Inline "Riapri documento" button for brochure/dispensa result messages */}
                              {msg.role === 'assistant' && /✅.*\*\*(Brochure|Dispensa)/.test(msg.content) && currentConversationId && convsWithDocs.has(currentConversationId) && (
                                <button
                                  onClick={() => {
                                    const doc = docCacheRef.current[currentConversationId!]
                                    if (doc) { setActiveDoc(doc); setShowCanvas(true) }
                                  }}
                                  className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700 hover:bg-fuchsia-100 transition-colors"
                                >
                                  <Layout className="h-3 w-3" />
                                  {showCanvas ? 'Documento aperto →' : 'Riapri documento'}
                                </button>
                              )}
                              {msg.role === 'assistant' && (
                                <EnvironmentalImpactPill
                                  darkMode={chatBgIsDark}
                                  className="mt-3"
                                  provider={msg.provider}
                                  model={msg.model}
                                  tokenUsage={msg.token_usage_json}
                                />
                              )}
                            </div>
                            <span className={`text-[10px] px-1 ${chatBgIsDark ? 'text-white/70' : 'text-slate-400'}`}>{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                      ))
                    )}
                    {isLoading && isGeneratingDoc && !imageGenerationProgress && !streamingStatus && (
                      <div className="flex gap-3 items-start">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={selectedSolidStyle ?? { backgroundColor: '#7c3aed' }}>
                          <Layout className="h-4 w-4 text-white" />
                        </div>
                        <div className="bg-white border border-slate-100 shadow-sm rounded-2xl px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
                            <span className="text-sm text-slate-500">Generazione documento con Claude Sonnet 4.6...</span>
                          </div>
                        </div>
                      </div>
                    )}
                    {isLoading && !isGeneratingDoc && !imageGenerationProgress && !streamingStatus && ( // eslint-disable-line
                      <div className="flex gap-4 justify-start">
                        <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center">
                          <Bot className="h-4 w-4 text-red-500" />
                        </div>
                        <div className={`${chatBgIsDark ? 'bg-white/10 border border-white/15' : 'bg-white border border-slate-200'} px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm`}>
                          <Loader2 className={`h-4 w-4 animate-spin ${chatBgIsDark ? 'text-white' : 'text-red-500'}`} />
                        </div>
                      </div>
                    )}
                    {streamingStatus && (
                      <div className="flex gap-4 justify-start">
                        <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center flex-shrink-0">
                          <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                        </div>
                        <div className={`${chatBgIsDark ? 'bg-white/10 border border-white/15' : 'bg-white border border-slate-200'} px-3 py-2 rounded-2xl rounded-tl-sm shadow-sm`}>
                          <span className="text-xs text-slate-500">{streamingStatus}</span>
                        </div>
                      </div>
                    )}

                    {/* Image Generation Progress Panel */}
                    {imageGenerationProgress && (
                      <div className="flex gap-4 justify-start">
                        <div className="w-8 h-8 rounded-full bg-violet-100 border border-violet-200 flex items-center justify-center flex-shrink-0">
                          <ImageIcon className="h-4 w-4 text-violet-600" />
                        </div>
                        <div className="flex-1 max-w-[75%] bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-200 px-5 py-4 rounded-2xl rounded-tl-sm shadow-sm">
                          <div className="flex items-center gap-2 mb-3">
                            <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
                            <span className="font-medium text-violet-800 text-sm">{imageGenerationProgress.status}</span>
                          </div>

                          {/* Progress Steps */}
                          <div className="space-y-2 mb-3">
                            {/* Step 1: Connessione */}
                            <div className={`flex items-center gap-2 text-xs ${imageGenerationProgress.step === 'connecting'
                              ? 'text-violet-700 font-medium'
                              : 'text-green-600'
                              }`}>
                              {imageGenerationProgress.step === 'connecting' ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                              <span>Connessione al server {imageGenerationProgress.provider}</span>
                            </div>
                            {/* Step 2: Ottimizzazione */}
                            <div className={`flex items-center gap-2 text-xs ${imageGenerationProgress.step === 'enhancing'
                              ? 'text-violet-700 font-medium'
                              : imageGenerationProgress.step === 'generating' || imageGenerationProgress.step === 'done'
                                ? 'text-green-600'
                                : 'text-slate-400'
                              }`}>
                              {imageGenerationProgress.step === 'enhancing' ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : imageGenerationProgress.step === 'generating' || imageGenerationProgress.step === 'done' ? (
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              ) : (
                                <div className="h-3 w-3 rounded-full border border-slate-300" />
                              )}
                              <span>Ottimizzazione prompt</span>
                            </div>
                            {/* Step 3: Generazione */}
                            <div className={`flex items-center gap-2 text-xs ${imageGenerationProgress.step === 'generating'
                              ? 'text-violet-700 font-medium'
                              : imageGenerationProgress.step === 'done'
                                ? 'text-green-600'
                                : 'text-slate-400'
                              }`}>
                              {imageGenerationProgress.step === 'generating' ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : imageGenerationProgress.step === 'done' ? (
                                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              ) : (
                                <div className="h-3 w-3 rounded-full border border-slate-300" />
                              )}
                              <span>Generazione immagine</span>
                            </div>
                          </div>

                          {/* Enhanced Prompt Preview */}
                          {imageGenerationProgress.enhancedPrompt && (
                            <div className="mt-3 border-t border-violet-200 pt-3">
                              <div className="text-xs font-medium text-violet-700 mb-1">Prompt ottimizzato:</div>
                              <div className="text-xs text-violet-600 bg-violet-100 px-2 py-1.5 rounded italic">
                                "{imageGenerationProgress.enhancedPrompt.substring(0, 150)}{imageGenerationProgress.enhancedPrompt.length > 150 ? '...' : ''}"
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                      <div ref={messagesEndRef} />
                    </div>
                  </div>

                  <div className={`${isMobile ? 'p-2' : 'p-4'} bg-white border-t border-slate-200`} style={isMobile ? { paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' } : undefined}>
                    <div className={isMobile ? '' : 'max-w-3xl mx-auto'}>

                      {agentMode === 'dispensa' && pendingDispensaPlan && (
                        <div className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold text-amber-800">Piano dispensa pronto</div>
                              <div className="text-[11px] text-amber-700 mt-1">
                                {pendingDispensaPlan.title} · {pendingDispensaPlan.sections.length} sezioni{pendingDispensaPlan.estimatedPages ? ` · ${pendingDispensaPlan.estimatedPages} pagine stimate` : ''}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  setPendingDispensaPlan(null)
                                  setPendingDispensaRequest(null)
                                  setPendingDispensaFilesContext('')
                                }}
                                className="px-2.5 py-1.5 rounded-lg border border-amber-300 text-[11px] font-semibold text-amber-800 hover:bg-amber-100"
                              >
                                Reset
                              </button>
                              <button
                                onClick={() => handleSend('Approva piano dispensa')}
                                disabled={isLoading}
                                className="px-2.5 py-1.5 rounded-lg bg-amber-600 text-white text-[11px] font-semibold hover:bg-amber-700 disabled:opacity-50"
                              >
                                Approva e genera PDF
                              </button>
                            </div>
                          </div>
                        </div>
                      )}

                      {attachedFiles.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {attachedFiles.map((f, i) => (
                            <div key={i} className="relative group">
                              {f.type === 'image' && f.preview ? (
                                <div className="bg-slate-50/50 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs flex items-center gap-2 text-slate-600 border border-slate-200 shadow-sm">
                                  <ImageIcon className="h-3 w-3" />
                                  <span className="max-w-[120px] truncate">{f.file.name}</span>
                                  <button onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-500"><X className="h-3 w-3" /></button>
                                </div>
                              ) : f.type === 'data' ? (
                                <div className="w-64 md:w-80">
                                  {f.dataPreview
                                    ? <DataFileCard preview={f.dataPreview} compact />
                                    : <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5 text-xs text-emerald-700">
                                        <Loader2 className="h-3 w-3 animate-spin" />
                                        <span className="truncate">{f.file.name}</span>
                                      </div>
                                  }
                                  <button onClick={() => removeFile(i)} className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full flex items-center justify-center z-10">
                                    <X className="h-2.5 w-2.5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="bg-slate-50/50 backdrop-blur-sm px-3 py-1.5 rounded-full text-xs flex items-center gap-2 text-slate-600 border border-slate-200 shadow-sm">
                                  <File className="h-3 w-3" />
                                  <span className="max-w-[120px] truncate">{f.file.name}</span>
                                  <button onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-500"><X className="h-3 w-3" /></button>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {attachedFiles.some(af => af.type === 'data' && af.dataPreview?.suggested_prompts?.length) && (
                        <div className="flex gap-1 mb-2 flex-wrap">
                          {attachedFiles
                            .filter(af => af.type === 'data' && af.dataPreview?.suggested_prompts?.length)
                            .flatMap(af => af.dataPreview!.suggested_prompts!.slice(0, 3))
                            .slice(0, 4)
                            .map((prompt, i) => (
                              <button
                                key={i}
                                onClick={() => setInputText(prompt)}
                                className="text-xs bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-full px-2.5 py-1 transition-colors"
                              >
                                {prompt}
                              </button>
                            ))}
                        </div>
                      )}

                      {/* Analysis mode: task picker */}
                      {agentMode === 'analysis' && (
                        <div className="mb-2 p-3 bg-violet-50 border border-violet-200 rounded-2xl animate-in fade-in slide-in-from-bottom-2 duration-200">
                          <div className="flex items-center gap-2 mb-2">
                            <BarChart2 className="h-3.5 w-3.5 text-violet-600" />
                            <span className="text-xs font-semibold text-violet-700">Analisi risposte studenti</span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <select
                              value={analysisSessionId}
                              onChange={e => { setAnalysisSessionId(e.target.value); setAnalysisTaskId('') }}
                              className="flex-1 min-w-[140px] text-xs border border-violet-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-violet-400"
                            >
                              <option value="">— Sessione —</option>
                              {(classesData || []).map((s: any) => (
                                <option key={s.id} value={s.id}>{s.class_name}: {s.title}</option>
                              ))}
                            </select>
                            <select
                              value={analysisTaskId}
                              onChange={e => setAnalysisTaskId(e.target.value)}
                              disabled={!analysisSessionId}
                              className="flex-1 min-w-[140px] text-xs border border-violet-200 rounded-lg px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50"
                            >
                              <option value="">— Compito/Quiz —</option>
                              {(analysisTasksData || [])
                                .filter(t => t.status === 'published' || t.status === 'closed')
                                .map(t => (
                                  <option key={t.id} value={t.id}>[{t.task_type}] {t.title}</option>
                                ))}
                            </select>
                          </div>
                          {analysisTaskId && (
                            <p className="mt-1.5 text-[10px] text-violet-500">
                              Scrivi una domanda specifica oppure invia per un'analisi completa
                            </p>
                          )}
                        </div>
                      )}

                      {/* Input Pill */}
                      <div className="relative flex items-center gap-1.5 bg-white border border-slate-200 shadow-sm rounded-[24px] p-1.5 focus-within:ring-2 focus-within:ring-slate-200 transition-all">
                        <input type="file" ref={fileInputRef} className="hidden" multiple
                          accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.txt,.csv,.xlsx,.xls,.json"
                          onChange={handleFileSelect} />

                        {/* Mode Selector — desktop only (mobile uses pills above) */}
                        {!isMobile && (
                          <div className="relative flex-shrink-0 mb-0.5" ref={modeMenuRef}>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="ai-mode-pill h-8 rounded-full px-3.5 text-slate-900 gap-1.5 ring-1 ring-white/70 hover:opacity-95"
                              onClick={() => setShowModeMenu(v => !v)}
                              title="Cambia modalità"
                            >
                              <span className="text-[11px] font-semibold">Modalita</span>
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                                selectedModeMeta.id === 'default'
                                  ? 'bg-slate-900 text-white'
                                  : selectedModeMeta.id === 'report'
                                    ? 'bg-blue-600 text-white'
                                    : selectedModeMeta.id === 'quiz'
                                      ? 'bg-amber-500 text-white'
                                      : selectedModeMeta.id === 'image'
                                        ? 'bg-fuchsia-600 text-white'
                                        : selectedModeMeta.id === 'dataset'
                                          ? 'bg-emerald-600 text-white'
                                          : selectedModeMeta.id === 'analysis'
                                            ? 'bg-violet-600 text-white'
                                            : selectedModeMeta.id === 'brochure'
                                              ? 'bg-rose-600 text-white'
                                              : 'bg-orange-600 text-white'
                              }`}>
                                {selectedModeMeta.label}
                              </span>
                              <ChevronDown className={`h-3 w-3 transition-transform ${showModeMenu ? 'rotate-180' : ''}`} />
                            </Button>
                            {showModeMenu && (
                              <div className="absolute bottom-10 left-0 z-40 w-48 rounded-xl border border-slate-200 bg-white/80 backdrop-blur-lg p-1.5 shadow-xl animate-in slide-in-from-bottom-2 fade-in duration-200">
                                {AGENT_MODES.map(m => {
                                  const icon = m.id === 'default'
                                    ? <MessageSquare className="h-3.5 w-3.5" />
                                    : m.id === 'report'
                                      ? <FileText className="h-3.5 w-3.5" />
                                      : m.id === 'quiz'
                                        ? <CheckSquare className="h-3.5 w-3.5" />
                                        : m.id === 'image'
                                          ? <ImageIcon className="h-3.5 w-3.5" />
                                  : m.id === 'analysis'
                                            ? <BarChart2 className="h-3.5 w-3.5" />
                                            : m.id === 'brochure'
                                              ? <Layout className="h-3.5 w-3.5" />
                                              : m.id === 'dispensa'
                                                ? <FileText className="h-3.5 w-3.5" />
                                            : <Database className="h-3.5 w-3.5" />
                                  const isSelected = agentMode === m.id
                                  return (
                                    <button
                                      key={m.id}
                                      onClick={() => handleChangeAgentMode(m.id)}
                                      className={`w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium transition-colors ${isSelected ? '' : 'text-slate-600 hover:bg-slate-100'}`}
                                      style={isSelected ? selectedSoftStyle : undefined}
                                    >
                                      {icon}
                                      {m.id === 'image' ? t('teacher_chat.mode_image') : m.label}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )}

                        <VoiceRecorder
                          onInsertText={(text) => setInputText((prev) => prev ? prev + ' ' + text : text)}
                        />

                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-full flex-shrink-0"
                          onClick={() => fileInputRef.current?.click()}
                          title="Allega"
                        >
                          <Paperclip className="h-4 w-4" />
                        </Button>

                        <textarea
                          value={inputText}
                          onChange={(e) => setInputText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                          onPaste={handleInputPaste}
                          placeholder={
                            agentMode === 'analysis'
                              ? (analysisTaskId ? 'Domanda specifica (opzionale)...' : 'Seleziona prima sessione e compito...')
                              : isMobile ? 'Scrivi...' : 'Scrivi o trascina file qui...'
                          }
                          className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none outline-none resize-none py-2 px-2 text-sm text-slate-800 placeholder:text-slate-400 max-h-32 min-h-[36px] leading-relaxed"
                          rows={1}
                          style={{ overflow: 'hidden' }}
                          onInput={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            target.style.height = 'auto';
                            target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
                          }}
                        />

                        {/* Mode tag — desktop only */}
                        <Button
                          onClick={() => { void handleSend() }}
                          disabled={((!inputText.trim() && attachedFiles.length === 0) && !(agentMode === 'analysis' && analysisTaskId)) || isLoading}
                          className={`h-9 w-9 rounded-full transition-all flex-shrink-0 ${((!inputText.trim() && attachedFiles.length === 0) && !(agentMode === 'analysis' && analysisTaskId))
                            ? 'bg-slate-100 text-slate-300'
                            : 'bg-slate-900 hover:bg-slate-800 text-white shadow-md'
                            }`}
                          size="icon"
                        >
                          <Send className="h-4 w-4 ml-0.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </main>
                {showCanvas && activeDoc && !isMobile && (
                  <div className="w-[55%] shrink-0 border-l border-slate-200 overflow-hidden">
                    <DocumentCanvas
                      doc={activeDoc}
                      onClose={() => setShowCanvas(false)}
                      authorName={teacherDisplayName}
                      sessions={(classesData || []).map((s: any) => ({ id: s.id, title: s.title, class_name: s.class_name }))}
                    />
                  </div>
                )}
                </div>{/* end chat+canvas flex */}
                </div>{/* end unified card */}
              </div>
        </div>
      </div>

      {/* Publish Task Modal */}
      {
        publishModal.isOpen && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[70] p-4 backdrop-blur-sm">
            <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-bold text-slate-800">Pubblica come Compito</h3>
                <Button variant="ghost" size="icon" onClick={() => setPublishModal({ ...publishModal, isOpen: false })}>
                  <X className="h-5 w-5" />
                </Button>
              </div>

              <p className="text-sm text-slate-600 mb-6">
                Scegli la sessione e la modalita di pubblicazione per questo {publishModal.type === 'quiz' ? 'quiz' : 'dataset'}.
              </p>

              <div className="mb-5 rounded-lg border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-700 mb-2">Modalita pubblicazione</div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setPublishMode('published')}
                    className={`text-xs px-3 py-1.5 rounded-full border ${publishMode === 'published' ? 'font-semibold' : 'text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                    style={publishMode === 'published' ? selectedSoftStyle : undefined}
                  >
                    Pubblica subito
                  </button>
                  <button
                    onClick={() => setPublishMode('draft')}
                    className={`text-xs px-3 py-1.5 rounded-full border ${publishMode === 'draft' ? 'font-semibold' : 'text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                    style={publishMode === 'draft' ? selectedSoftStyle : undefined}
                  >
                    Tieni in bozza
                  </button>
                </div>
              </div>

              <div className="space-y-3 mb-6 max-h-60 overflow-y-auto">
                {classesData?.map((session: any) => (
                  <button
                    key={session.id}
                    onClick={() => handlePublish(session.id)}
                    className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-red-400 hover:bg-red-50 transition-all flex items-center justify-between group"
                  >
                    <div>
                      <div className="font-semibold text-sm group-hover:text-red-700">{session.title}</div>
                      <div className="text-xs text-slate-500">
                        {session.class_name}
                        {session.class_join_code && (
                          <span className="ml-2 font-mono font-semibold text-slate-400">#{session.class_join_code}</span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-red-500" />
                  </button>
                ))}
                {(!classesData || classesData.length === 0) && (
                  <p className="text-center text-xs text-slate-400 py-4">Nessuna sessione attiva trovata.</p>
                )}
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setPublishModal({ ...publishModal, isOpen: false })}>Annulla</Button>
              </div>
            </div>
          </div>
        )
      }

      {/* Editor Modal for editing quiz before publishing */}
      {
        editorModal.isOpen && editorModal.data && (
          <ContentEditorModal
            content={editorModal.data}
            type={editorModal.type === 'quiz' ? 'quiz' : 'exercise'}
            onSave={(editedData) => {
              // After editing, open publish modal with edited data
              setEditorModal({ isOpen: false, type: 'quiz', data: null })
              setPublishMode('published')
              setPublishModal({ isOpen: true, type: editorModal.type, data: editedData })
            }}
            onCancel={() => setEditorModal({ isOpen: false, type: 'quiz', data: null })}
          />
        )
      }
    </>
  )
}


// Helpers
function convertEmoticons(text: string): string {
  const emoticons: Record<string, string> = {
    ':)': '😊', ':-)': '😊', '(:': '😊',
    ':D': '😄', ':-D': '😄', 'XD': '😆', 'xD': '😆',
    ':(': '😢', ':-(': '😢', '):': '😢',
    ';)': '😉', ';-)': '😉',
    ':P': '😛', ':-P': '😛', ':p': '😛', ':-p': '😛',
    ':O': '😮', ':-O': '😮', ':o': '😮', ':-o': '😮',
    '<3': '❤️', '</3': '💔',
    ':*': '😘', ':-*': '😘',
    ":'(": '😢', ":'-": '😢',
    ':S': '😕', ':-S': '😕',
    'B)': '😎', 'B-)': '😎',
    ':/': '😕', ':-/': '😕',
    ':3': '😺',
    'O:)': '😇', 'O:-)': '😇',
    '>:(': '😠', '>:-(': '😠',
    ':@': '😡',
    '^^': '😊', '^_^': '😊',
    '-_-': '😑', '-.-': '😑',
    'T_T': '😭', 'T.T': '😭',
    ':thumbsup:': '👍', ':thumbsdown:': '👎',
    ':fire:': '🔥', ':heart:': '❤️', ':star:': '⭐',
    ':ok:': '👌', ':wave:': '👋', ':clap:': '👏',
    ':100:': '💯', ':rocket:': '🚀', ':sparkles:': '✨',
  }

  let result = text
  // Sort by length descending to match longer emoticons first
  const sortedEmoticons = Object.entries(emoticons).sort((a, b) => b[0].length - a[0].length)
  for (const [emoticon, emoji] of sortedEmoticons) {
    result = result.split(emoticon).join(emoji)
  }
  return result
}

function extractBase64Images(content: string): { cleanContent: string; images: string[] } {
  const images: string[] = []
  let cleanContent = content
  // Correct regex to match markdown images with data URI: ![...](data:image...)
  const startPattern = /!\[[^\]]*\]\(data:image/g
  let match
  const matches: { start: number, end: number, url: string }[] = []

  while ((match = startPattern.exec(content)) !== null) {
    const urlStart = match.index + match[0].length - 'data:image'.length
    let depth = 1
    let i = match.index + match[0].length
    while (i < content.length && depth > 0) {
      if (content[i] === '(') depth++
      else if (content[i] === ')') depth--
      i++
    }
    if (depth === 0) {
      const url = content.substring(urlStart, i - 1)
      matches.push({ start: match.index, end: i, url })
    }
  }

  for (let i = matches.length - 1; i >= 0; i--) {
    images.unshift(matches[i].url)
    cleanContent = cleanContent.substring(0, matches[i].start) + cleanContent.substring(matches[i].end)
  }

  return { cleanContent: cleanContent.trim(), images }
}

function parseContentBlocks(content: string): { 
  quiz: QuizData | null; 
  csv: string | null; 
  textContent: string; 
  isGenerating: boolean; 
  generationType: string | null;
  sessionSelector: any[] | null;
  studentSelector: any[] | null;
  reportTypeSelector: any[] | null;
  actionMenu: any[] | null;
} {
  let textContent = content
  let quiz: QuizData | null = null
  let csv: string | null = null
  let sessionSelector: any[] | null = null
  let studentSelector: any[] | null = null
  let reportTypeSelector: any[] | null = null
  let actionMenu: any[] | null = null
  let isGenerating = false
  let generationType: string | null = null

  const tryParseQuizCandidate = (rawCandidate: string | undefined | null): QuizData | null => {
    if (!rawCandidate) return null
    try {
      const parsed = JSON.parse(rawCandidate.trim())
      if (parsed && Array.isArray(parsed.questions) && parsed.title) {
        return parsed as QuizData
      }
    } catch {
      return null
    }
    return null
  }

  // Check for generation indicators
  const generatingImagePattern = /genero|creo.*immagine|sto.*generando.*immagine|genera.*immagine/i
  const generatingCsvPattern = /genero|creo.*dataset|sto.*generando.*csv|genera.*csv/i
  const generatingQuizPattern = /genero|creo|preparo.*quiz|sto.*generando.*quiz/i

  const hasBase64Image = content.includes('data:image') && content.includes('base64')
  if (hasBase64Image) {
    return { quiz, csv, textContent, isGenerating: false, generationType: null, sessionSelector, studentSelector, reportTypeSelector, actionMenu }
  }

  const hasIncompleteQuiz = content.includes('```quiz') && !content.includes('```quiz')
    ? false
    : (content.match(/```quiz/g)?.length || 0) > (content.match(/```quiz[\s\S]*?```/g)?.length || 0)
  const hasIncompleteCsv = (content.match(/```csv/g)?.length || 0) > (content.match(/```csv[\s\S]*?```/g)?.length || 0)

  if (hasIncompleteQuiz || (generatingQuizPattern.test(content) && content.length < 200)) {
    isGenerating = true
    generationType = 'quiz'
    textContent = textContent.replace(/```quiz[\s\S]*$/, '').replace(/\{[\s\S]*$/, '').trim()
  } else if (hasIncompleteCsv || (generatingCsvPattern.test(content) && content.length < 200)) {
    isGenerating = true
    generationType = 'csv'
    textContent = textContent.replace(/```csv[\s\S]*$/, '').replace(/\{[\s\S]*$/, '').trim()
  } else if (generatingImagePattern.test(content) && content.length < 200) {
    isGenerating = true
    generationType = 'image'
  }

  // Extract quiz
  const quizMatch = content.match(/```quiz\s*([\s\S]*?)```/)
  if (quizMatch) {
    const parsed = tryParseQuizCandidate(quizMatch[1])
    if (parsed) {
      quiz = parsed
      textContent = textContent.replace(/```quiz[\s\S]*?```/, '').trim()
      isGenerating = false
    } else {
      if (quizMatch[1].includes('{')) {
        isGenerating = true
        generationType = 'quiz'
      }
    }
  }

  if (!quiz) {
    const jsonQuizMatch = content.match(/```json\s*([\s\S]*?)```/)
    const parsed = tryParseQuizCandidate(jsonQuizMatch?.[1])
    if (parsed) {
      quiz = parsed
      textContent = textContent.replace(/```json[\s\S]*?```/, '').trim()
      isGenerating = false
    }
  }

  if (!quiz) {
    const rawJsonMatch = content.match(/\{[\s\S]*"questions"[\s\S]*\}/)
    const parsed = tryParseQuizCandidate(rawJsonMatch?.[0])
    if (parsed) {
      quiz = parsed
      textContent = rawJsonMatch?.[0]
        ? textContent.replace(rawJsonMatch[0], '').trim()
        : textContent
      isGenerating = false
    }
  }

  // Extract CSV
  const csvMatch = content.match(/```csv\s*([\s\S]*?)```/)
  if (csvMatch) {
    csv = csvMatch[1].trim()
    textContent = textContent.replace(/```csv[\s\S]*?```/, '').trim()
    isGenerating = false
  }

  // Extract Session Selector
  const sessionMatch = content.match(/```session_selector\s*([\s\S]*?)```/)
  if (sessionMatch) {
    try {
      sessionSelector = JSON.parse(sessionMatch[1].trim())
      textContent = textContent.replace(/```session_selector[\s\S]*?```/, '').trim()
    } catch (e) { console.error("Error parsing session selector", e) }
  }

  // Extract Student Selector
  const studentMatch = content.match(/```student_selector\s*([\s\S]*?)```/)
  if (studentMatch) {
    try {
      studentSelector = JSON.parse(studentMatch[1].trim())
      textContent = textContent.replace(/```student_selector[\s\S]*?```/, '').trim()
    } catch (e) { console.error("Error parsing student selector", e) }
  }

  const reportTypeMatch = content.match(/```report_type_selector\s*([\s\S]*?)```/)
  if (reportTypeMatch) {
    try {
      reportTypeSelector = JSON.parse(reportTypeMatch[1].trim())
      textContent = textContent.replace(/```report_type_selector[\s\S]*?```/, '').trim()
    } catch (e) { console.error("Error parsing report type selector", e) }
  }

  // Extract Action Menu
  const actionMenuMatch = content.match(/```action_menu\s*([\s\S]*?)```/)
  if (actionMenuMatch) {
    try {
      actionMenu = JSON.parse(actionMenuMatch[1].trim())
      textContent = textContent.replace(/```action_menu[\s\S]*?```/, '').trim()
    } catch (e) { console.error("Error parsing action menu", e) }
  }

  return { quiz, csv, textContent, isGenerating, generationType, sessionSelector, studentSelector, reportTypeSelector, actionMenu }
}

function SessionSelector({ sessions, onSelect }: { sessions: any[], onSelect: (id: string) => void }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm my-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Seleziona Sessione</span>
        <span className="text-[10px] text-slate-400">{sessions.length} sessioni attive</span>
      </div>
      <div className="p-2 grid grid-cols-1 gap-1 max-h-60 overflow-y-auto">
        {sessions.map(s => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className="text-left px-3 py-2.5 rounded-lg hover:bg-red-50 hover:text-red-700 border border-transparent hover:border-red-200 transition-all group flex items-center justify-between"
          >
            <div>
              <div className="text-sm font-semibold">{s.title}</div>
              <div className="text-[10px] text-slate-400 group-hover:text-red-500">{s.class_name} • {s.status}</div>
            </div>
            <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-red-500" />
          </button>
        ))}
      </div>
    </div>
  )
}

function StudentSelector({ students, onSelect }: { students: any[], onSelect: (selectedIds: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([])
  
  const toggle = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id])
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm my-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Seleziona Studenti</span>
        <span className="text-[10px] text-slate-400">{students.length} studenti</span>
      </div>
      <div className="p-2 grid grid-cols-2 gap-2 max-h-60 overflow-y-auto">
        {students.map(s => (
          <div
            key={s.id}
            onClick={() => toggle(s.id)}
            className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
              selected.includes(s.id) ? 'bg-red-50 border-red-200 text-red-700' : 'bg-slate-50 border-slate-100 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <div className={`w-4 h-4 rounded border flex items-center justify-center ${selected.includes(s.id) ? 'bg-red-500 border-red-500' : 'bg-white border-slate-300'}`}>
              {selected.includes(s.id) && <Check className="h-2.5 w-2.5 text-white" />}
            </div>
            <div className="text-xs font-medium truncate">{s.nickname}</div>
          </div>
        ))}
      </div>
      <div className="p-3 border-t border-slate-100 bg-slate-50 flex justify-end">
        <Button 
          size="sm" 
          disabled={selected.length === 0}
          className="text-xs bg-red-600 hover:bg-red-700 text-white"
          onClick={() => onSelect(selected)}
        >
          Genera Report per {selected.length} {selected.length === 1 ? 'studente' : 'studenti'}
        </Button>
      </div>
    </div>
  )
}

function ActionMenu({ actions, onSelect }: { actions: any[], onSelect: (value: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 my-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {actions.map((action, idx) => (
        <button
          key={idx}
          onClick={() => onSelect(action.value)}
          className="flex items-center gap-2 px-3 py-2.5 bg-white border border-slate-200 rounded-xl hover:bg-red-50 hover:border-red-200 hover:text-red-700 text-sm font-medium transition-all shadow-sm group"
        >
          <span className="truncate">{action.label}</span>
        </button>
      ))}
    </div>
  )
}

function ReportConfigurator({
  sessions,
  reportTypes,
  onSubmit,
}: {
  sessions: any[]
  reportTypes: any[]
  onSubmit: (sessionId: string, reportTypeId: string) => void
}) {
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [selectedReportType, setSelectedReportType] = useState('')
  const selectedSession = sessions.find((s) => s.id === selectedSessionId)

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm my-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 flex items-center justify-between">
        <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">Configurazione Report</span>
        <span className="text-[10px] text-slate-400">Sessione + tipologia</span>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <div className="text-[11px] font-semibold text-slate-600 mb-2">Sessione</div>
          <div className="grid grid-cols-1 gap-2 max-h-52 overflow-y-auto">
            {sessions.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelectedSessionId(s.id)}
                className={`rounded-lg border px-3 py-2 text-left transition-all ${selectedSessionId === s.id ? 'bg-red-50 border-red-200 text-red-700' : 'border-slate-200 hover:bg-slate-50 text-slate-700'}`}
              >
                <div className="text-sm font-semibold">{s.title}</div>
                <div className="text-[10px] text-slate-400">{s.class_name} • {s.status}</div>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-semibold text-slate-600 mb-2">Tipo di report</div>
          <div className="grid grid-cols-1 gap-2">
            {reportTypes.map((option) => (
              <button
                key={option.id}
                onClick={() => setSelectedReportType(option.id)}
                className={`rounded-lg border px-3 py-2 text-left transition-all ${selectedReportType === option.id ? 'bg-blue-50 border-blue-200 text-blue-700' : 'border-slate-200 hover:bg-slate-50 text-slate-700'}`}
              >
                <div className="text-sm font-semibold">{option.label}</div>
                <div className="text-[11px] text-slate-500">{option.description}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="p-3 border-t border-slate-100 bg-slate-50 flex justify-end">
        <Button
          size="sm"
          disabled={!selectedSessionId || !selectedReportType || !selectedSession}
          className="text-xs bg-red-600 hover:bg-red-700 text-white"
          onClick={() => onSubmit(selectedSessionId, selectedReportType)}
        >
          Genera report avanzato
        </Button>
      </div>
    </div>
  )
}

function MessageContent({ content, onPublish, onEdit, onInput, toast, darkMode = false }: { 
  content: string; 
  onPublish: (type: 'quiz' | 'dataset', data: any) => void; 
  onEdit: (type: 'quiz' | 'dataset', data: any) => void; 
  onInput: (text: string) => void;
  toast: any; 
  darkMode?: boolean 
}) {
  const { quiz, csv, textContent, isGenerating, generationType, sessionSelector, studentSelector, reportTypeSelector, actionMenu } = parseContentBlocks(content)
  const { cleanContent, images } = extractBase64Images(textContent)

  if (isGenerating) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <div className={`flex items-center gap-2 ${darkMode ? 'text-cyan-200' : 'text-cyan-600'}`}>
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="font-medium">
            {generationType === 'image' && 'Generazione immagine in corso...'}
            {generationType === 'csv' && 'Generazione dataset in corso...'}
            {generationType === 'quiz' && 'Generazione quiz in corso...'}
            {!generationType && 'Elaborazione in corso...'}
          </span>
        </div>
      </div>
    )
  }

  const downloadCsv = (csvContent: string) => {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `dataset_${Date.now()}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className={`prose prose-sm max-w-none ${darkMode ? 'prose-invert text-white' : 'text-slate-800'} ${darkMode ? '' : 'prose-p:text-slate-700'}`}>
      {cleanContent && (
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
            ...markdownCodeComponents(darkMode),
            img: ({ src, alt, ...props }) => (
              <div
                className="relative group cursor-grab active:cursor-grabbing my-3 inline-block"
                draggable
                onDragStart={(e) => {
                  const imageData = JSON.stringify({
                    url: src,
                    filename: `immagine-generata-${Date.now()}.png`
                  })
                  e.dataTransfer.setData('text/plain', src || '')
                  e.dataTransfer.setData('application/x-chatbot-image', imageData)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
              >
                <img
                  src={src}
                  alt={alt || 'Immagine generata'}
                  className="max-w-full h-auto rounded-lg shadow-md"
                  {...props}
                />
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      if (src) {
                        const link = document.createElement('a')
                        link.href = src
                        link.download = `immagine_${Date.now()}.png`
                        document.body.appendChild(link)
                        link.click()
                        document.body.removeChild(link)
                      }
                    }}
                    className="bg-white/90 hover:bg-white p-2 rounded-lg shadow-md"
                    title="Scarica immagine"
                  >
                    <Download className="h-4 w-4 text-slate-700" />
                  </button>
                </div>
                <div className="absolute bottom-2 left-2 bg-violet-600/90 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                  Trascina nella chat di classe
                </div>
              </div>
            ),
          }}
        >
          {cleanContent}
        </ReactMarkdown>
      )}

      {images.length > 0 && (
        <div className="my-3 space-y-3">
          {images.map((imgSrc, idx) => (
            <div
              key={idx}
              className="relative group cursor-grab active:cursor-grabbing"
              draggable
              onDragStart={(e) => {
                const imageData = JSON.stringify({
                  url: imgSrc,
                  filename: `teacher-image-${Date.now()}.png`
                })
                e.dataTransfer.setData('text/plain', imgSrc)
                e.dataTransfer.setData('application/x-chatbot-image', imageData)
                e.dataTransfer.effectAllowed = 'copy'
              }}
            >
              <img src={imgSrc} alt="Generata" className="max-w-full h-auto rounded-lg shadow-md" />
              <button
                onClick={() => {
                  const link = document.createElement('a')
                  link.href = imgSrc
                  link.download = `immagine_${Date.now()}.png`
                  document.body.appendChild(link)
                  link.click()
                  document.body.removeChild(link)
                }}
                className="absolute top-2 right-2 bg-white/90 hover:bg-white p-2 rounded-lg shadow-md opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Download className="h-4 w-4 text-slate-700" />
              </button>
            </div>
          ))}
        </div>
      )}

      {csv && (
        <>
        <div
          className="mt-3 border border-purple-200 rounded-lg overflow-hidden cursor-grab"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-chatbot-csv', csv)
            e.dataTransfer.effectAllowed = 'copy'
          }}
        >
          <div className="bg-purple-50 px-3 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-purple-700 flex items-center gap-2">
              <Database className="h-4 w-4" />
              Dataset CSV ({csv.split('\n').length - 1} righe)
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-purple-300 text-purple-700 hover:bg-purple-100"
                onClick={() => onPublish('dataset', csv)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Pubblica
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-purple-300 text-purple-700 hover:bg-purple-100"
                onClick={() => downloadCsv(csv)}
              >
                <Download className="h-3 w-3 mr-1" />
                Scarica
              </Button>
            </div>
          </div>
          <pre className="bg-slate-900 text-slate-100 p-3 text-xs font-mono overflow-x-auto max-h-32">
            {csv.split('\n').slice(0, 6).join('\n')}
            {csv.split('\n').length > 6 && '\n...'}
          </pre>
        </div>
        <DataVisualizationPanel csvText={csv} />
        </>
      )}

      {quiz && (
        <div className="mt-3">
          <div className="bg-cyan-50 border border-cyan-200 rounded-t-lg px-4 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-cyan-700 flex items-center gap-2">
              📝 Quiz: {quiz.title}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-cyan-300 text-cyan-700 hover:bg-cyan-100"
                onClick={() => onEdit('quiz', quiz)}
              >
                <Edit3 className="h-3 w-3 mr-1" />
                Modifica
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs bg-cyan-600 hover:bg-cyan-700 text-white"
                onClick={() => onPublish('quiz', quiz)}
              >
                <Plus className="h-3 w-3 mr-1" />
                Pubblica
              </Button>
            </div>
          </div>
          <InteractiveQuiz quiz={quiz} onSubmitAnswers={(_ans) => {
            toast({ title: "Risposte verificate", description: "Hai completato il quiz in anteprima." })
          }} />
        </div>
      )}

      {sessionSelector && reportTypeSelector && (
        <ReportConfigurator
          sessions={sessionSelector}
          reportTypes={reportTypeSelector}
          onSubmit={(sessionId, reportTypeId) => {
            const session = sessionSelector.find(s => s.id === sessionId)
            const reportType = reportTypeSelector.find(r => r.id === reportTypeId)
            onInput(`Generami il report ${reportType?.label || reportTypeId} per la sessione: ${session?.title} (${sessionId})`)
          }}
        />
      )}

      {sessionSelector && !reportTypeSelector && (
        <SessionSelector 
          sessions={sessionSelector} 
          onSelect={(id) => {
            const session = sessionSelector.find(s => s.id === id);
            onInput(`Generami un report per la sessione: ${session?.title} (${id})`);
          }} 
        />
      )}

      {studentSelector && (
        <StudentSelector 
          students={studentSelector} 
          onSelect={(selectedIds) => {
            const names = studentSelector
              .filter(s => selectedIds.includes(s.id))
              .map(s => s.nickname)
              .join(', ');
            onInput(`Generami un report per questi studenti: ${names}`);
          }} 
        />
      )}

      {actionMenu && (
        <ActionMenu 
          actions={actionMenu} 
          onSelect={(value) => onInput(value)} 
        />
      )}
    </div>
  )
}

// Interactive Quiz Component
function InteractiveQuiz({ quiz, onSubmitAnswers }: { quiz: QuizData; onSubmitAnswers: (answers: string) => void }) {
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [submitted, setSubmitted] = useState(false)
  const [showExplanations, setShowExplanations] = useState(false)

  if (!quiz || !quiz.questions || !Array.isArray(quiz.questions)) {
    return null
  }

  const handleSelect = (questionIndex: number, optionIndex: number) => {
    if (submitted) return
    setAnswers(prev => ({ ...prev, [questionIndex]: optionIndex }))
  }

  const handleSubmit = () => {
    setSubmitted(true)
    setShowExplanations(true)

    // Format answers for sending to chatbot
    const answerText = quiz.questions.map((_, idx) => {
      const selected = answers[idx]
      const letter = selected !== undefined ? String.fromCharCode(65 + selected) : '?'
      return `${idx + 1}${letter}`
    }).join(', ')

    onSubmitAnswers(`Le mie risposte: ${answerText}`)
  }

  const score = quiz.questions.reduce((acc, q, idx) => {
    return acc + (answers[idx] === q.correctIndex ? 1 : 0)
  }, 0)

  const allAnswered = quiz.questions.every((_, idx) => answers[idx] !== undefined)

  return (
    <div className="bg-gradient-to-br from-cyan-50 to-sky-50 rounded-xl p-4 border border-cyan-200 shadow-sm">
      <h3 className="font-bold text-lg text-cyan-800 mb-4 flex items-center gap-2">
        📝 {quiz.title}
      </h3>

      <div className="space-y-4">
        {quiz.questions.map((q, qIndex) => {
          const isCorrect = answers[qIndex] === q.correctIndex
          const hasAnswered = answers[qIndex] !== undefined

          return (
            <div key={qIndex} className="bg-white rounded-lg p-4 shadow-sm border border-cyan-100">
              <p className="font-medium text-slate-800 mb-3">
                <span className="text-cyan-600 font-bold">{qIndex + 1}.</span> {q.question}
              </p>

              <div className="space-y-2">
                {q.options.map((option, optIndex) => {
                  const isSelected = answers[qIndex] === optIndex
                  const isCorrectOption = q.correctIndex === optIndex

                  let buttonClass = "w-full text-left px-4 py-2.5 rounded-lg border transition-all text-sm "

                  if (submitted) {
                    if (isCorrectOption) {
                      buttonClass += "bg-green-100 border-green-400 text-green-800 font-medium"
                    } else if (isSelected && !isCorrectOption) {
                      buttonClass += "bg-red-100 border-red-400 text-red-800"
                    } else {
                      buttonClass += "bg-slate-50 border-slate-200 text-slate-500"
                    }
                  } else if (isSelected) {
                    buttonClass += "bg-cyan-100 border-cyan-400 text-cyan-800 font-medium"
                  } else {
                    buttonClass += "bg-white border-slate-200 hover:border-cyan-300 hover:bg-cyan-50"
                  }

                  return (
                    <button
                      key={optIndex}
                      onClick={() => handleSelect(qIndex, optIndex)}
                      disabled={submitted}
                      className={buttonClass}
                    >
                      <span className="font-bold mr-3 text-xs opacity-60">{String.fromCharCode(65 + optIndex)})
                      </span>                      {option}
                      {submitted && isCorrectOption && <span className="ml-auto">✅</span>}
                      {submitted && isSelected && !isCorrectOption && <span className="ml-auto">❌</span>}
                    </button>
                  )
                })}
              </div>

              {showExplanations && hasAnswered && (
                <div className={`mt-3 p-3 rounded-lg text-xs ${isCorrect ? 'bg-green-50 text-green-800 border border-green-100' : 'bg-cyan-50 text-cyan-800 border border-cyan-100'}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    {isCorrect ? <div className="font-bold uppercase tracking-tighter">Corretto</div> : <div className="font-bold uppercase tracking-tighter">Spiegazione</div>}
                  </div>
                  {q.explanation}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {!submitted ? (
        <Button
          onClick={handleSubmit}
          disabled={!allAnswered}
          className={`mt-6 w-full py-6 rounded-xl font-bold text-base transition-all ${allAnswered
            ? 'bg-cyan-600 text-white hover:bg-cyan-700 shadow-lg shadow-cyan-200'
            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
            }`}
        >
          {allAnswered ? 'Verifica Risposte' : `Rispondi a tutte le domande (${Object.keys(answers).length}/${quiz.questions.length})`}
        </Button>
      ) : (
        <div className="mt-6 p-6 bg-white rounded-2xl shadow-inner border-2 border-cyan-100 text-center animate-in zoom-in duration-300">
          <div className="text-4xl font-black text-cyan-600 mb-1">
            {score} / {quiz.questions.length}
          </div>
          <div className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-4">Punteggio Finale</div>
          <p className="text-slate-600 italic">
            {score === quiz.questions.length ? '🥇 Risultato Perfetto! Ottimo lavoro.' : score >= quiz.questions.length / 2 ? '👏 Buon lavoro! Hai una buona base.' : '📚 Ti consiglio di ripassare l\'argomento.'}
          </p>
        </div>
      )}
    </div>
  )
}
