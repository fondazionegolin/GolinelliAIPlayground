import { useState, useRef, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import {
  Send, Bot, Paperclip, X, Trash2, Plus, File, Image as ImageIcon, Loader2,
  Database, Download, ChevronDown, ChevronRight, Edit3, Check, MessageCircle, Sparkles,
  Palette, FileText, CheckSquare, MessageSquare
} from 'lucide-react'
import { llmApi, teacherApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { useQuery } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { ContentEditorModal } from '@/components/ContentEditorModal'
import TeacherbotsPanel from '@/components/teacher/TeacherbotsPanel'

// Constants
const AVAILABLE_MODELS = [
  { id: 'gpt-5-mini', name: 'GPT-5 Mini', provider: 'openai' },
  { id: 'gpt-5-nano', name: 'GPT-5 Nano', provider: 'openai' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic' },
  { id: 'mistral-nemo', name: 'Mistral Nemo', provider: 'ollama' },
  { id: 'deepseek-r1:8b', name: 'DeepSeek R1', provider: 'ollama' },
]

const AGENT_MODES = [
  { id: 'default', label: 'Chat' },
  // { id: 'web_search', label: 'Web Search' },  // Hidden - not mature yet
  { id: 'report', label: 'Report' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'image', label: 'Immagine' },
  { id: 'dataset', label: 'Dataset' },
] as const

// Explicitly include web_search in type even though it's hidden from UI
type AgentMode = typeof AGENT_MODES[number]['id'] | 'web_search'

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
}

interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: Date
}

interface AttachedFile {
  file: globalThis.File
  preview?: string
  type: 'image' | 'document'
}

interface WebSearchProgress {
  status: string
  sources: Array<{
    index: number
    title: string
    url: string
    status: 'fetching' | 'done' | 'error'
    content_length?: number
    error?: string
  }>
  intent?: string
  confidence?: number
}

export default function TeacherSupportChat() {
  const { toast } = useToast()
  const [activeTab, setActiveTab] = useState<'chat' | 'teacherbots'>('chat')
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [defaultModel, setDefaultModel] = useState(localStorage.getItem('default_model') || AVAILABLE_MODELS[0].id)
  const [selectedModel, setSelectedModel] = useState(localStorage.getItem('default_model') || AVAILABLE_MODELS[0].id)
  const [showModelMenu, setShowModelMenu] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [, setConversationCache] = useState<Record<string, Message[]>>({})
  const conversationCacheRef = useRef<Record<string, Message[]>>({})
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [agentMode, setAgentMode] = useState<AgentMode>('default')
  const [imageProvider, setImageProvider] = useState<'dall-e' | 'flux-schnell'>('flux-schnell')
  const [imageSize, setImageSize] = useState<string>('1024x1024')
  const [chatBg, setChatBg] = useState<string>('')
  const [showBgPalette, setShowBgPalette] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [webSearchProgress, setWebSearchProgress] = useState<WebSearchProgress | null>(null)
  const modelMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (modelMenuRef.current && !modelMenuRef.current.contains(event.target as Node)) {
        setShowModelMenu(false)
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
      title: "Modello predefinito aggiornato",
      description: `Il modello predefinito è ora ${AVAILABLE_MODELS.find(m => m.id === id)?.name}`
    })
  }

  // Model Icons Components
  const ModelIcon = ({ provider, modelId: _modelId, className = "h-4 w-4" }: { provider: string, modelId?: string, className?: string }) => {
    if (provider === 'openai') {
      return (
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 3.5687-2.0594.2152-.1245v2.967A4.5422 4.5422 0 0 1 13.26 22.4292zm-6.6-4.5936a4.4255 4.4255 0 0 1-1.3976-2.5833l2.8436 1.6413.2199.1245.5415 3.129a4.5707 4.5707 0 0 1-2.2074-2.3115zm-2.4349-7.5941a4.5279 4.5279 0 0 1 2.3734-2.145l1.6746 2.8953-.2152.1245-3.5687 2.0594a4.5089 4.5089 0 0 1-.2641-2.9342zm11.9705-3.5687a4.5184 4.5184 0 0 1 2.2122 2.3163l-2.8436-1.646-.2152-.1245-.5415-3.1238a4.5327 4.5327 0 0 1 1.3881 2.578zm2.4349 7.5893a4.5231 4.5231 0 0 1-2.3686 2.1402l-1.6746-2.8905.2152-.1245 3.5687-2.0594a4.4994 4.4994 0 0 1 .2593 2.9342zm-3.5355 4.3035l-1.6841-2.8953a1.4727 1.4727 0 0 0 2.217.0095l-1.6373 2.9048a1.5155 1.5155 0 0 0 1.1044-.019zM6.9234 10.9788l1.6841 2.8953a1.487 1.487 0 0 0 0-2.588L6.9234 8.3908a1.5583 1.5583 0 0 0 0 2.588zm2.0981-6.101l1.6373 2.9048a1.487 1.487 0 0 0 2.217-.0095l-3.3213-1.9216a1.5964 1.5964 0 0 0-.533 1.0263z" fill="currentColor" />
        </svg>
      )
    }
    if (provider === 'anthropic') {
      return (
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
          <path d="M17.4224 18.2526H19.7618L13.7844 4H10.1983L4.22095 18.2526H6.57762L7.90076 14.8687H16.082L17.4224 18.2526ZM8.79093 12.6378L11.973 4.54897L15.1913 12.6378H8.79093Z" fill="currentColor" />
        </svg>
      )
    }
    if (provider === 'ollama') { // Generic or Mistral/DeepSeek if specific provider key matches
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2v10l5-5" />
        </svg>
      )
    }
    // DeepSeek & Mistral specific overrides if provider is ollama but id contains string?
    // Let's refine based on explicit ID or enhanced provider map?
    return <Bot className={className} />
  }


  const [imageGenerationProgress, setImageGenerationProgress] = useState<{
    status: string
    step: 'connecting' | 'enhancing' | 'generating' | 'done' | 'error'
    provider?: string
    enhancedPrompt?: string
  } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const baseBgSwatches = [
    { label: 'Slate scuro', color: '#0f172a' },
    { label: 'Grigio scuro', color: '#1f2937' },
    { label: 'Viola scuro', color: '#2e1065' },
    { label: 'Giallo', color: '#facc15' },
  ]

  const paletteColors = useMemo(() => {
    const colors: string[] = []
    for (let i = 0; i < 256; i += 1) {
      const hue = (i % 16) * (360 / 16)
      const light = 20 + Math.floor(i / 16) * (60 / 15)
      colors.push(`hsl(${hue}, 55%, ${light}%)`)
    }
    return colors
  }, [])

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
      const stored = localStorage.getItem('teacherChatBg')
      if (stored) setChatBg(stored)
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
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Publish Modal State
  const [publishModal, setPublishModal] = useState<{ isOpen: boolean, type: 'quiz' | 'dataset', data: any }>({
    isOpen: false,
    type: 'quiz',
    data: null
  })

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
            allSessions.push({ id: s.id, name: s.title || s.name, class_name: cls.name })
          })
        } catch (e) { } // Ignore errors for individual session fetches
      }
      return allSessions
    },
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
      } catch (e) {
        console.error('Failed to load conversations from server:', e)
        // Fallback to localStorage for offline/error cases
        const saved = localStorage.getItem('teacher_support_conversations')
        if (saved) {
          try {
            const parsed = JSON.parse(saved)
            setConversations(parsed.map((c: Conversation) => ({
              ...c,
              createdAt: new Date(c.createdAt),
              messages: c.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) }))
            })))
          } catch (parseErr) { console.error(parseErr) }
        }
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

  // Load messages when selecting a conversation
  useEffect(() => {
    const loadMessages = async () => {
      if (!currentConversationId) return
      try {
        const cachedMessages = conversationCacheRef.current[currentConversationId]
        if (cachedMessages && cachedMessages.length > 0) {
          setMessages(cachedMessages)
        }

        const response = await teacherApi.getConversation(currentConversationId)
        const conv = response.data
        if (conv?.messages) {
          const serverMessages = conv.messages.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: new Date(m.created_at)
          }))

          const localMessages = cachedMessages || []
          const localLast = localMessages[localMessages.length - 1]?.timestamp?.getTime() || 0
          const serverLast = serverMessages[serverMessages.length - 1]?.timestamp?.getTime() || 0
          const shouldReplace =
            (serverMessages.length > localMessages.length) ||
            (serverMessages.length === localMessages.length && serverLast >= localLast) ||
            localMessages.length === 0

          if (shouldReplace) {
            setMessages(serverMessages)
            setConversationCache(prev => {
              const next = { ...prev, [currentConversationId]: serverMessages }
              conversationCacheRef.current = next
              return next
            })
          }
        }
      } catch (e) {
        console.error('Failed to load messages:', e)
      }
    }
    loadMessages()
  }, [currentConversationId])

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
    const newFiles: AttachedFile[] = files.map(file => {
      const isImage = file.type.startsWith('image/')
      const attached: AttachedFile = {
        file,
        type: isImage ? 'image' : 'document',
      }
      if (isImage) {
        attached.preview = URL.createObjectURL(file)
      }
      return attached
    })
    setAttachedFiles(prev => [...prev, ...newFiles])
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files))
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
          const isImage = fileObj.type.startsWith('image/')
          setAttachedFiles(prev => [...prev, { file: fileObj, type: isImage ? 'image' : 'document', preview: isImage ? URL.createObjectURL(fileObj) : undefined }])
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
      setAttachedFiles(prev => [...prev, { file: fileObj, type: 'document' as const }])
      return
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFiles(Array.from(e.dataTransfer.files))
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
        model: model
      })
    } catch (e) {
      console.error('Failed to save messages:', e)
    }

    return convId
  }

  const handleSend = async () => {
    if ((!inputText.trim() && attachedFiles.length === 0) || isLoading) return

    const filesInfo = attachedFiles.length > 0 ? ` [Allegati: ${attachedFiles.map(f => f.file.name).join(', ')}]` : ''
    let messageContent = inputText.trim() || 'Analizza questi documenti'

    // Handle specific agent modes
    if (inputText.trim() && agentMode !== 'default' && agentMode !== 'image') {
      const prefixes = {
        web_search: 'RICERCA WEB:',
        report: 'GENERA REPORT:',
        dataset: 'GENERA DATASET:',
        quiz: 'GENERA QUIZ:',
      }
      // Only append prefix if not already present
      // @ts-ignore
      const prefix = prefixes[agentMode] || ''
      if (prefix && !messageContent.startsWith(prefix)) {
        messageContent = `${prefix} ${messageContent}`
      }
    }

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: messageContent + filesInfo,
      timestamp: new Date()
    }

    const convId = await ensureConversation(messageContent)
    setMessages(prev => [...prev, userMessage])
    setInputText('')
    const currentFiles = [...attachedFiles]
    setAttachedFiles([])
    setIsLoading(true)

    try {
      if (agentMode === 'image') {
        // IMAGE GENERATION FLOW
        const providerLabel = imageProvider === 'dall-e' ? 'DALL-E 3' : 'Flux Schnell'

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

Descrizione utente: "${messageContent}"

REGOLE IMPORTANTI:
- Scrivi SOLO il prompt in inglese, nient'altro.
- Sii molto descrittivo: specifica stile artistico, illuminazione, composizione, colori e dettagli tecnici.
- NON scrivere spiegazioni, commenti o altro testo.
- NON creare quiz, domande o contenuti didattici.
- Rispondi SOLO con il prompt ottimizzato per la generazione dell'immagine.`

        // IMPORTANTE: Usa il profilo 'tutor' invece di 'teacher_support' per evitare l'intent classification
        // che potrebbe interpretare la richiesta come generazione di quiz
        const expansionResponse = await llmApi.teacherChat(
          expansionPrompt,
          [],
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
            timestamp: new Date()
          }
          // IMPORTANTE: Aggiorna anche messages per mostrare subito l'immagine nella chat
          setMessages(prev => [...prev, assistantMessage])

          // Save to server
          await saveMessageToServer(convId, userMessage, assistantMessage, selectedModel)
        } else {
          throw new Error("Nessuna URL immagine ricevuta")
        }

      } else if (agentMode === 'web_search' || agentMode === 'quiz' || agentMode === 'dataset') {
        // STREAMING WEB SEARCH, QUIZ or DATASET FLOW - Always use Claude Haiku
        const history = messages.map(m => ({ role: m.role, content: m.content }))

        // Initialize progress state
        setWebSearchProgress({ status: 'Inizializzazione...', sources: [] })

        try {
          const response = await fetch('/api/v1/llm/teacher/chat-stream', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            credentials: 'include', // Send cookies for authentication
            body: JSON.stringify({
              content: messageContent,
              history,
              provider: 'anthropic',
              model: 'claude-haiku-4-5-20251001'
            })
          })

          if (!response.ok) throw new Error('Stream request failed')

          const reader = response.body?.getReader()
          const decoder = new TextDecoder()
          let finalContent = ''

          if (reader) {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break

              const chunk = decoder.decode(value)
              const lines = chunk.split('\n')

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6))

                    if (data.type === 'status') {
                      setWebSearchProgress(prev => ({
                        ...prev!,
                        status: data.message
                      }))
                    } else if (data.type === 'intent') {
                      setWebSearchProgress(prev => ({
                        ...prev!,
                        intent: data.intent,
                        confidence: data.confidence
                      }))
                    } else if (data.type === 'source') {
                      setWebSearchProgress(prev => {
                        const sources = [...(prev?.sources || [])]
                        const existingIdx = sources.findIndex(s => s.index === data.index)
                        if (existingIdx >= 0) {
                          sources[existingIdx] = data
                        } else {
                          sources.push(data)
                        }
                        return { ...prev!, sources }
                      })
                    } else if (data.type === 'done') {
                      finalContent = data.content
                    } else if (data.type === 'error') {
                      throw new Error(data.message)
                    }
                  } catch (e) {
                    // Skip invalid JSON
                  }
                }
              }
            }
          }

          // Clear progress and show result
          setWebSearchProgress(null)

          const assistantMessage: Message = {
            id: `resp-${Date.now()}`,
            role: 'assistant',
            content: finalContent || 'Nessun risultato dalla generazione.',
            timestamp: new Date()
          }

          setMessages(prev => [...prev, assistantMessage])

          // Save to server
          await saveMessageToServer(convId, userMessage, assistantMessage, 'claude-haiku-4-5-20251001')
        } catch (e) {
          setWebSearchProgress(null)
          throw e
        }
      } else {
        // STANDARD CHAT FLOW
        const history = messages.map(m => ({ role: m.role, content: m.content }))
        const modelInfo = AVAILABLE_MODELS.find(m => m.id === selectedModel)

        let response;
        if (currentFiles.length > 0) {
          response = await llmApi.teacherChatWithFiles(
            messageContent,
            history,
            'teacher_support',
            modelInfo?.provider || 'openai',
            selectedModel,
            currentFiles.map(f => f.file),
            imageProvider,
            imageSize
          )
        } else {
          response = await llmApi.teacherChat(
            userMessage.content,
            history,
            'teacher_support',
            modelInfo?.provider || 'openai',
            selectedModel,
            imageProvider,
            imageSize
          )
        }

        const assistantMessage: Message = {
          id: `resp-${Date.now()}`,
          role: 'assistant',
          content: response.data?.response || 'Errore nella risposta.',
          timestamp: new Date()
        }

        setMessages(prev => [...prev, assistantMessage])

        // Save to server
        await saveMessageToServer(convId, userMessage, assistantMessage, selectedModel)
      }
    } catch (e) {
      console.error(e)
      setImageGenerationProgress(null)
      toast({ title: "Errore", description: "Impossibile completare la richiesta.", variant: "destructive" })
      const errorMsg: Message = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: "Si è verificato un errore durante la generazione. Riprova.",
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
  }

  const handlePublish = async (sessionId: string) => {
    if (!publishModal.data) return

    try {
      let contentJson = ""
      let taskType = ""
      let title = ""
      let numQuestions = 0

      if (publishModal.type === 'quiz') {
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
        numQuestions = publishModal.data.questions?.length || 0
      } else {
        contentJson = JSON.stringify({
          type: 'exercise',
          text: `Analizza il seguente dataset CSV:\n\n${publishModal.data}`
        })
        taskType = 'exercise'
        title = "Analisi Dataset CSV"
      }

      // Create the task
      await teacherApi.createTask(sessionId, {
        title,
        description: `Compito creato da AI Support (${publishModal.type})`,
        task_type: taskType,
        content_json: contentJson
      })

      // Send notification to class chat
      const notificationMessage = publishModal.type === 'quiz'
        ? `**Nuovo Quiz Pubblicato!**\n\n**${title}**\n${numQuestions} domande\n\nVai alla sezione **Compiti** per completarlo!`
        : `**Nuovo Compito Pubblicato!**\n\n**${title}**\n\nVai alla sezione **Compiti** per completarlo!`

      try {
        await teacherApi.sendClassMessage(sessionId, notificationMessage)
      } catch (chatErr) {
        console.warn("Could not send chat notification:", chatErr)
      }

      toast({ title: "Compito pubblicato!", description: "Notifica inviata agli studenti", className: "bg-green-500 text-white" })
      setPublishModal({ isOpen: false, type: 'quiz', data: null })
    } catch (e) {
      console.error(e)
      toast({ title: "Errore pubblicazione", variant: "destructive" })
    }
  }

  return (
    <>

      <div className="h-full flex flex-col p-0">
        <div className="flex-1 flex h-full">
          <div
            className="flex flex-col h-full bg-slate-50 font-sans w-full overflow-hidden"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {/* Tab Navigation */}
            <div className="flex items-center gap-1 px-4 pt-4 pb-2 bg-white border-b border-slate-100">
              <button
                onClick={() => setActiveTab('chat')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'chat'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'text-slate-500 hover:bg-slate-100'
                  }`}
              >
                <MessageCircle className="h-4 w-4" />
                Chat AI
              </button>
              <button
                onClick={() => setActiveTab('teacherbots')}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === 'teacherbots'
                  ? 'bg-indigo-100 text-indigo-700'
                  : 'text-slate-500 hover:bg-slate-100'
                  }`}
              >
                <Sparkles className="h-4 w-4" />
                Teacherbots
              </button>
            </div>

            {/* Teacherbots Tab Content */}
            {activeTab === 'teacherbots' ? (
              <div className="flex-1 overflow-y-auto p-6">
                <TeacherbotsPanel />
              </div>
            ) : (
              /* Chat Tab Content */
              <div className="flex flex-1 overflow-hidden">

                {/* SIDEBAR - History */}
                <aside className={`${isSidebarCollapsed ? 'w-12' : 'w-64'} bg-slate-50 border-r border-slate-200 flex flex-col hidden md:flex transition-all duration-300 flex-shrink-0 rounded-l-2xl`}>
                  <div className={`p-4 border-b border-slate-100 flex items-center ${isSidebarCollapsed ? 'justify-center' : 'justify-between'}`}>
                    {!isSidebarCollapsed && <h2 className="text-sm font-semibold text-slate-800 tracking-tight">Cronologia</h2>}
                    <div className="flex gap-1">
                      {!isSidebarCollapsed && (
                        <Button variant="ghost" size="sm" onClick={handleNewChat} className="h-8 w-8 p-0 hover:bg-slate-100" title="Nuova chat">
                          <Plus className="h-4 w-4 text-slate-600" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                        className="h-8 w-8 p-0 hover:bg-slate-100"
                        title={isSidebarCollapsed ? "Espandi cronologia" : "Comprimi cronologia"}
                      >
                        {isSidebarCollapsed ? <ChevronRight className="h-4 w-4 text-slate-600" /> : <ChevronDown className="h-4 w-4 text-slate-400 rotate-90" />}
                      </Button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 space-y-1">
                    {!isSidebarCollapsed ? (
                      conversations.map(conv => (
                        <button
                          key={conv.id}
                          onClick={() => { setCurrentConversationId(conv.id); }}
                          className={`w-full text-left p-3 rounded-lg text-sm transition-all group ${currentConversationId === conv.id
                            ? 'bg-[#4f46e5]/10 text-[#4f46e5] font-medium'
                            : 'text-slate-600 hover:bg-slate-50'
                            }`}
                        >
                          <div className="truncate">{conv.title}</div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-slate-400">{conv.createdAt.toLocaleDateString()}</span>
                            <button
                              className="text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-opacity p-1"
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
                                  if (currentConversationId === conv.id) handleNewChat()
                                }
                              }}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="flex flex-col gap-2 items-center">
                        <Button variant="ghost" size="icon" onClick={handleNewChat} title="Nuova chat" className="p-0">
                          <Plus className="h-5 w-5 text-[#4f46e5]" />
                        </Button>
                        {conversations.map(conv => (
                          <div
                            key={conv.id}
                            className={`w-2 h-2 rounded-full cursor-pointer ${currentConversationId === conv.id ? 'bg-[#4f46e5]' : 'bg-slate-300'}`}
                            title={conv.title}
                            onClick={() => { setCurrentConversationId(conv.id); }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </aside>

                {/* MAIN CHAT AREA */}
                <main
                  className="flex-1 flex flex-col relative overflow-hidden"
                  style={chatBg ? { backgroundColor: chatBg } : undefined}
                >

                  <header className="px-3 py-2 md:px-4 md:py-3 border-b border-indigo-100/50 bg-white/80 backdrop-blur-sm sticky top-0 z-10 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center shadow-md bg-indigo-600">
                        <Bot className="h-4 w-4 text-white translate-y-[1px]" />
                      </div>
                      <div>
                        <h1 className="text-sm font-bold text-slate-800">Supporto Docente AI</h1>
                        <p className="text-xs text-slate-500">
                          {(agentMode === 'quiz' || agentMode === 'dataset' || agentMode === 'web_search')
                            ? 'Claude Haiku'
                            : AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name}
                        </p>
                      </div>
                    </div>

                      <div className="flex items-center gap-4">
                        <div className="flex items-center gap-3 animate-in fade-in slide-in-from-right-4 duration-300">
                        {/* Generatore */}
                        {agentMode === 'image' && (
                          <>
                            <div className="flex items-center bg-slate-100/80 rounded-full p-1 border border-slate-200">
                              <button
                                onClick={() => setImageProvider('flux-schnell')}
                                className={`px-3 py-1 text-xs rounded-full transition-all flex items-center gap-1 ${imageProvider === 'flux-schnell'
                                  ? 'bg-white shadow-sm text-indigo-600 font-bold'
                                  : 'text-slate-500 hover:text-slate-700'
                                  }`}
                              >
                                ⚡ Flux
                              </button>
                              <button
                                onClick={() => setImageProvider('dall-e')}
                                className={`px-3 py-1 text-xs rounded-full transition-all flex items-center gap-1 ${imageProvider === 'dall-e'
                                  ? 'bg-white shadow-sm text-indigo-600 font-bold'
                                  : 'text-slate-500 hover:text-slate-700'
                                  }`}
                              >
                                🎨 DALL-E
                              </button>
                            </div>

                            {/* Formato */}
                            <div className="relative">
                              <select
                                value={imageSize}
                                onChange={(e) => setImageSize(e.target.value)}
                                className="text-xs bg-slate-100/80 border border-slate-200 rounded-full px-3 py-1.5 text-slate-600 focus:ring-2 focus:ring-indigo-500 focus:border-transparent cursor-pointer hover:bg-slate-50 outline-none appearance-none pr-8"
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


                        {(agentMode === 'quiz' || agentMode === 'dataset' || agentMode === 'web_search') ? (
                          <div className="text-xs bg-purple-100 text-purple-700 rounded-full px-3 py-1.5 font-medium border border-purple-200">
                            Claude Haiku (fisso)
                          </div>
                        ) : (
                          agentMode !== 'image' && (
                            <div className="relative" ref={modelMenuRef}>
                              <button
                                onClick={() => setShowModelMenu(!showModelMenu)}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-full text-xs font-bold text-white transition-all shadow-md shadow-indigo-200 group"
                              >
                                <div className="p-0.5 bg-white/20 rounded-md">
                                  <ModelIcon provider={AVAILABLE_MODELS.find(m => m.id === selectedModel)?.provider || ''} modelId={selectedModel} className="h-3 w-3" />
                                </div>
                                <span>{AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name}</span>
                                <ChevronDown className={`h-3 w-3 text-indigo-200 transition-transform ${showModelMenu ? 'rotate-180' : ''}`} />
                              </button>

                              {/* Dropdown */}
                              {showModelMenu && (
                                <div className="absolute top-full right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-slate-100 py-1 z-[100] animate-in fade-in zoom-in-95 duration-100 overflow-visible ring-1 ring-black/5">
                                  <div className="px-4 py-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-50/50 border-b border-slate-100 mb-1 flex justify-between items-center">
                                    <span>Seleziona Modello</span>
                                    <span className="text-[9px] font-normal text-slate-400">Default</span>
                                  </div>
                                  {AVAILABLE_MODELS.map(m => (
                                    <div
                                      key={m.id}
                                      className={`flex items-center justify-between px-3 py-2.5 mx-1 rounded-lg hover:bg-slate-50 transition-colors cursor-pointer group ${selectedModel === m.id ? 'bg-indigo-50/50' : ''}`}
                                      onClick={() => {
                                        setSelectedModel(m.id)
                                        setShowModelMenu(false)
                                      }}
                                    >
                                      <div className="flex items-center gap-3">
                                        <div className={`p-2 rounded-lg ${selectedModel === m.id ? 'bg-indigo-100 ring-1 ring-indigo-200' : 'bg-slate-100 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors'}`}>
                                          <ModelIcon provider={m.provider} modelId={m.id} className="h-5 w-5" />
                                        </div>
                                        <div className="flex flex-col">
                                          <span className={`text-sm font-bold ${selectedModel === m.id ? 'text-indigo-900' : 'text-slate-700'}`}>
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
                                        <div className={`w-4 h-4 rounded border flex items-center justify-center transition-all duration-200 ${defaultModel === m.id
                                          ? 'bg-indigo-600 border-indigo-600 shadow-sm'
                                          : 'border-slate-300 text-transparent hover:border-indigo-400 mx-auto'
                                          }`}>
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
                        <div className="flex items-center gap-1">
                          {baseBgSwatches.map((swatch) => (
                            <button
                              key={swatch.label}
                              onClick={() => setChatBg(swatch.color)}
                              title={swatch.label}
                              className={`h-5 w-5 rounded-full border border-slate-200 shadow-sm transition-transform hover:scale-105 ${chatBg === swatch.color ? 'ring-2 ring-indigo-500 ring-offset-2' : ''}`}
                              style={{ backgroundColor: swatch.color }}
                            />
                          ))}
                        </div>
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
                            <div className="absolute right-0 top-10 z-30 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
                              <div className="grid grid-cols-8 gap-1">
                                {paletteColors.map((color, idx) => (
                                  <button
                                    key={`${color}-${idx}`}
                                    onClick={() => {
                                      setChatBg(color)
                                      setShowBgPalette(false)
                                    }}
                                    className="h-5 w-5 rounded border border-slate-100 hover:scale-110 transition-transform"
                                    style={{ backgroundColor: color }}
                                    title={color}
                                  />
                                ))}
                              </div>
                              <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                                <span>Jolly 256</span>
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
                          )}
                        </div>
                      </div>
                    </div>
                  </header>

                  <div
                    className={`flex-1 overflow-y-auto px-3 py-3 md:px-4 md:py-6 space-y-3 md:space-y-6 ${chatBgIsDark ? 'text-white' : ''}`}
                    style={{ WebkitOverflowScrolling: 'touch', scrollBehavior: 'smooth' }}
                  >
                    {messages.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center opacity-50">
                        <Bot className="h-12 w-12 text-slate-300 mb-4" />
                        <p className="text-slate-400 font-medium">Inizia una nuova conversazione</p>
                      </div>
                    ) : (
                      messages.map((msg) => (
                        <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          {msg.role === 'assistant' && (
                            <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center flex-shrink-0">
                              <Bot className="h-4 w-4 text-[#4f46e5]" />
                            </div>
                          )}
                          <div className={`max-w-[75%] space-y-1 ${msg.role === 'user' ? 'items-end flex flex-col' : 'items-start'}`}>
                            <div className={`px-5 py-3.5 text-sm leading-relaxed shadow-sm ${msg.role === 'user'
                              ? `${chatBgIsDark ? 'bg-white/20 text-white border border-white/20' : 'bg-[#4f46e5] !text-white'} font-medium rounded-2xl rounded-tr-sm`
                              : `${chatBgIsDark ? 'bg-white/10 text-white border border-white/15' : 'bg-white text-slate-800 border border-slate-200'} rounded-2xl rounded-tl-sm ${chatBgIsDark ? 'prose prose-invert' : ''}`
                              }`}>
                              {msg.role === 'assistant' ? (
                                <MessageContent
                                  content={msg.content}
                                  onPublish={(type, data) => setPublishModal({ isOpen: true, type, data })}
                                  onEdit={(type, data) => setEditorModal({ isOpen: true, type, data })}
                                  toast={toast}
                                  darkMode={chatBgIsDark}
                                />
                              ) : (
                                <ReactMarkdown className={`prose prose-sm max-w-none prose-p:leading-relaxed prose-pre:bg-slate-800 prose-pre:text-slate-100 [&_*]:!text-white [&_strong]:font-bold`}>
                                  {convertEmoticons(msg.content)}
                                </ReactMarkdown>
                              )}
                            </div>
                            <span className={`text-[10px] px-1 ${chatBgIsDark ? 'text-white/70' : 'text-slate-400'}`}>{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        </div>
                      ))
                    )}
                    {isLoading && !webSearchProgress && !imageGenerationProgress && (
                      <div className="flex gap-4 justify-start">
                        <div className="w-8 h-8 rounded-full bg-white border border-slate-200 flex items-center justify-center">
                          <Bot className="h-4 w-4 text-[#4f46e5]" />
                        </div>
                        <div className={`${chatBgIsDark ? 'bg-white/10 border border-white/15' : 'bg-white border border-slate-200'} px-4 py-3 rounded-2xl rounded-tl-sm shadow-sm`}>
                          <Loader2 className={`h-4 w-4 animate-spin ${chatBgIsDark ? 'text-white' : 'text-[#4f46e5]'}`} />
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

                    {/* Web Search/Quiz Progress Panel */}
                    {webSearchProgress && (
                      <div className="flex gap-4 justify-start">
                        <div className="w-8 h-8 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center flex-shrink-0">
                          <svg className="h-4 w-4 text-blue-600 animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </div>
                        <div className="flex-1 max-w-[75%] bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 px-5 py-4 rounded-2xl rounded-tl-sm shadow-sm">
                          <div className="flex items-center gap-2 mb-3">
                            <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                            <span className="font-medium text-blue-800 text-sm">{webSearchProgress.status}</span>
                          </div>

                          {webSearchProgress.intent && (
                            <div className="text-xs text-blue-600 mb-3 bg-blue-100 px-2 py-1 rounded inline-block">
                              Modalità: {webSearchProgress.intent} (confidenza: {Math.round((webSearchProgress.confidence || 0) * 100)}%)
                            </div>
                          )}

                          {webSearchProgress.sources.length > 0 && (
                            <div className="space-y-2 mt-3 border-t border-blue-200 pt-3">
                              <div className="text-xs font-medium text-blue-700 mb-2">📰 Fonti in fase di lettura:</div>
                              {webSearchProgress.sources.map((source) => (
                                <div key={source.index} className="flex items-start gap-2 text-xs">
                                  {source.status === 'fetching' && (
                                    <Loader2 className="h-3 w-3 animate-spin text-blue-500 mt-0.5 flex-shrink-0" />
                                  )}
                                  {source.status === 'done' && (
                                    <svg className="h-3 w-3 text-green-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  )}
                                  {source.status === 'error' && (
                                    <svg className="h-3 w-3 text-red-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <div className="font-medium text-slate-700 truncate">{source.title}</div>
                                    <a href={source.url} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline truncate block">
                                      {source.url.substring(0, 50)}...
                                    </a>
                                    {source.status === 'done' && source.content_length && (
                                      <span className="text-green-600">✓ {source.content_length} caratteri estratti</span>
                                    )}
                                    {source.status === 'error' && source.error && (
                                      <span className="text-red-500">✗ {source.error}</span>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>

                  <div className="p-4 bg-white border-t border-slate-200">
                    <div className="max-w-4xl mx-auto">

                      <div className="flex gap-2 mb-3 flex-wrap">
                        {AGENT_MODES.map(m => {
                          const icon = m.id === 'default'
                            ? <MessageSquare className="h-3.5 w-3.5" />
                            : m.id === 'report'
                              ? <FileText className="h-3.5 w-3.5" />
                              : m.id === 'quiz'
                                ? <CheckSquare className="h-3.5 w-3.5" />
                                : m.id === 'image'
                                  ? <ImageIcon className="h-3.5 w-3.5" />
                                  : <Database className="h-3.5 w-3.5" />

                          return (
                            <button
                              key={m.id}
                              onClick={() => setAgentMode(m.id)}
                              className={`text-xs px-4 py-1.5 rounded-full font-medium transition-all flex items-center gap-1.5 ${agentMode === m.id
                                ? 'bg-[#4f46e5] text-white shadow-md shadow-indigo-200'
                                : 'text-slate-500 hover:bg-slate-100'
                                }`}
                            >
                              {icon}
                              {m.label}
                            </button>
                          )
                        })}
                      </div>

                      {attachedFiles.length > 0 && (
                        <div className="flex flex-wrap gap-2 mb-2">
                          {attachedFiles.map((f, i) => (
                            <div key={i} className="bg-slate-100 px-3 py-1.5 rounded-full text-xs flex items-center gap-2 text-slate-600 border border-slate-200">
                              {f.type === 'image' ? <ImageIcon className="h-3 w-3" /> : <File className="h-3 w-3" />}
                              <span className="max-w-[150px] truncate">{f.file.name}</span>
                              <button onClick={() => removeFile(i)} className="text-slate-400 hover:text-red-500">
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Input Pill Container */}
                      <div className="relative flex items-end gap-2 bg-white border-2 border-[#4f46e5]/40 rounded-[2rem] p-1.5 pl-3 focus-within:border-[#4f46e5] focus-within:ring-4 focus-within:ring-[#4f46e5]/10 transition-all shadow-sm">
                        <input type="file" ref={fileInputRef} className="hidden" multiple onChange={handleFileSelect} />

                        <Button
                          variant="ghost" size="icon" className="h-9 w-9 text-slate-400 hover:text-[#4f46e5] hover:bg-indigo-50 rounded-full flex-shrink-0"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Paperclip className="h-5 w-5" />
                        </Button>

                        <textarea
                          value={inputText}
                          onChange={(e) => setInputText(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                          placeholder="Scrivi o trascina file qui..."
                          className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none outline-none resize-none py-2.5 text-sm text-slate-700 placeholder:text-slate-400 max-h-32 min-h-[44px]"
                          rows={1}
                          style={{ overflow: 'hidden' }}
                          onInput={(e) => {
                            const target = e.target as HTMLTextAreaElement;
                            target.style.height = 'auto';
                            target.style.height = `${Math.min(target.scrollHeight, 128)}px`;
                          }}
                        />

                        <Button
                          onClick={handleSend}
                          disabled={(!inputText.trim() && attachedFiles.length === 0) || isLoading}
                          className={`h-9 w-9 rounded-full transition-all flex-shrink-0 ${(!inputText.trim() && attachedFiles.length === 0)
                            ? 'bg-slate-200 text-slate-400'
                            : 'bg-[#4f46e5] hover:bg-[#4338ca] text-white shadow-md'
                            }`}
                          size="icon"
                        >
                          <Send className="h-4 w-4 ml-0.5" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </main>
              </div>
            )}
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
                Scegli la sessione in cui pubblicare questo {publishModal.type === 'quiz' ? 'quiz' : 'dataset'} come attività per gli studenti.
              </p>

              <div className="space-y-3 mb-6 max-h-60 overflow-y-auto">
                {classesData?.map((session: any) => (
                  <button
                    key={session.id}
                    onClick={() => handlePublish(session.id)}
                    className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50 transition-all flex items-center justify-between group"
                  >
                    <div>
                      <div className="font-semibold text-sm group-hover:text-indigo-700">{session.name}</div>
                      <div className="text-xs text-slate-500">{session.class_name}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-indigo-500" />
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

function parseContentBlocks(content: string): { quiz: QuizData | null; csv: string | null; textContent: string; isGenerating: boolean; generationType: string | null } {
  let textContent = content
  let quiz: QuizData | null = null
  let csv: string | null = null
  let isGenerating = false
  let generationType: string | null = null

  // Check for generation indicators
  const generatingImagePattern = /genero|creo.*immagine|sto.*generando.*immagine|genera.*immagine/i
  const generatingCsvPattern = /genero|creo.*dataset|sto.*generando.*csv|genera.*csv/i
  const generatingQuizPattern = /genero|creo|preparo.*quiz|sto.*generando.*quiz/i

  const hasBase64Image = content.includes('data:image') && content.includes('base64')
  if (hasBase64Image) {
    return { quiz, csv, textContent, isGenerating: false, generationType: null }
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
    try {
      quiz = JSON.parse(quizMatch[1].trim())
      textContent = textContent.replace(/```quiz[\s\S]*?```/, '').trim()
      isGenerating = false
    } catch (e) {
      if (quizMatch[1].includes('{')) {
        isGenerating = true
        generationType = 'quiz'
      }
    }
  }

  // Extract CSV
  const csvMatch = content.match(/```csv\s*([\s\S]*?)```/)
  if (csvMatch) {
    csv = csvMatch[1].trim()
    textContent = textContent.replace(/```csv[\s\S]*?```/, '').trim()
    isGenerating = false
  }

  return { quiz, csv, textContent, isGenerating, generationType }
}

function MessageContent({ content, onPublish, onEdit, toast, darkMode = false }: { content: string; onPublish: (type: 'quiz' | 'dataset', data: any) => void; onEdit: (type: 'quiz' | 'dataset', data: any) => void; toast: any; darkMode?: boolean }) {
  const { quiz, csv, textContent, isGenerating, generationType } = parseContentBlocks(content)
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
            code: ({ className, children, ...props }) => {
              const isInline = !className
              return isInline ? (
                <code className={`${darkMode ? 'bg-white/10 text-white' : 'bg-slate-100 text-cyan-600'} px-1.5 py-0.5 rounded text-xs font-mono`} {...props}>
                  {children}
                </code>
              ) : (
                <code className="block bg-slate-900 text-slate-100 p-3 rounded-lg text-xs font-mono overflow-x-auto my-2" {...props}>
                  {children}
                </code>
              )
            },
            pre: ({ children }) => <>{children}</>,
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
          <pre className="bg-slate-900 text-slate-100 p-3 text-xs font-mono overflow-x-auto max-h-48">
            {csv.split('\n').slice(0, 10).join('\n')}
            {csv.split('\n').length > 10 && '\n...'}
          </pre>
        </div>
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
    </div>
  )
}

// Interactive Quiz Component
function InteractiveQuiz({ quiz, onSubmitAnswers }: { quiz: QuizData; onSubmitAnswers: (answers: string) => void }) {
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [submitted, setSubmitted] = useState(false)
  const [showExplanations, setShowExplanations] = useState(false)

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
