import { useState, useRef, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { llmApi, studentApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { 
  Send, Bot, User, GraduationCap, 
  Lightbulb, ClipboardCheck, ArrowLeft, Sparkles,
  Settings2, RefreshCw, Paperclip, X, File, Database, Download, Loader2,
  Trash2, ChevronLeft, ChevronRight, Menu
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface QuizQuestion {
  id: number
  question: string
  type: 'multiple_choice' | 'true_false'
  options: string[]
  correct: number
  explanation: string
}

interface QuizData {
  title: string
  questions: QuizQuestion[]
}

interface ChatbotProfile {
  key: string
  name: string
  description: string
  icon: string
  suggested_prompts: string[]
}

interface LLMModel {
  provider: string
  model: string
  name: string
  description: string
}

interface ChatbotModuleProps {
  sessionId: string
}

const PROFILE_ICONS: Record<string, React.ReactNode> = {
  'tutor': <GraduationCap className="h-6 w-6" />,
  'quiz': <ClipboardCheck className="h-6 w-6" />,
  'interview': <Bot className="h-6 w-6" />,
  'oral_exam': <User className="h-6 w-6" />,
  'dataset_generator': <Database className="h-6 w-6" />,
  'math_coach': <Lightbulb className="h-6 w-6" />,
}

const PROFILE_COLORS: Record<string, string> = {
  'tutor': 'bg-emerald-100 text-emerald-600 border-emerald-200',
  'quiz': 'bg-rose-100 text-rose-600 border-rose-200',
  'interview': 'bg-indigo-100 text-indigo-600 border-indigo-200',
  'oral_exam': 'bg-orange-100 text-orange-600 border-orange-200',
  'dataset_generator': 'bg-purple-100 text-purple-600 border-purple-200',
  'math_coach': 'bg-blue-100 text-blue-600 border-blue-200',
}

// Fallback profiles if API fails
const FALLBACK_PROFILES: ChatbotProfile[] = [
  { key: 'tutor', name: 'Tutor AI', description: 'Un tutor paziente che spiega concetti in modo chiaro', icon: 'graduation-cap', suggested_prompts: ['Spiegami questo concetto', 'Fammi un esempio'] },
  { key: 'quiz', name: 'Quiz Master', description: 'Crea quiz e verifica comprensione', icon: 'clipboard-check', suggested_prompts: ['Fammi un quiz', 'Verifica se ho capito'] },
  { key: 'interview', name: 'Intervista', description: 'Simula un personaggio storico', icon: 'mic', suggested_prompts: ['Voglio intervistare...', 'Sei Leonardo da Vinci'] },
  { key: 'oral_exam', name: 'Interrogazione', description: 'Simula un\'interrogazione scolastica', icon: 'user-check', suggested_prompts: ['Interrogami su...', 'Verifica la mia preparazione'] },
  { key: 'dataset_generator', name: 'Generatore Dataset', description: 'Genera dataset sintetici CSV', icon: 'database', suggested_prompts: ['Genera dataset sentiment', 'Crea CSV anagrafici'] },
  { key: 'math_coach', name: 'Math Coach', description: 'Mentor matematico con metodo Polya', icon: 'calculator', suggested_prompts: ['Ho un problema di matematica...', 'Puoi verificare se è giusto?'] },
]

interface ConversationHistory {
  id: string
  title: string
  profile_key: string
  updated_at: string
}

interface AttachedFile {
  file: globalThis.File
  preview?: string
  type: 'image' | 'document'
}

export default function ChatbotModule({ sessionId }: ChatbotModuleProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(true)
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<LLMModel | null>(null)
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const [imageProvider, setImageProvider] = useState<'dall-e' | 'flux-schnell'>('flux-schnell')
  const [imageSize, setImageSize] = useState<string>('1024x1024')
  const [verboseMode, setVerboseMode] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const isGeneratingRef = useRef(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch chatbot profiles
  const { data: profilesData } = useQuery({
    queryKey: ['chatbot-profiles'],
    queryFn: async () => {
      const res = await llmApi.getChatbotProfiles()
      return res.data as Record<string, ChatbotProfile>
    },
    staleTime: 1000 * 60 * 10, // 10 minutes
  })

  // Fetch available LLM models
  const { data: modelsData } = useQuery({
    queryKey: ['available-models'],
    queryFn: async () => {
      const res = await llmApi.getAvailableModels()
      return res.data as { models: LLMModel[]; default_provider: string; default_model: string }
    },
    staleTime: 1000 * 60 * 10,
  })

  // Fetch session data to get teacher's default model
  const { data: sessionData } = useQuery({
    queryKey: ['student-session'],
    queryFn: async () => {
      const res = await studentApi.getSession()
      return res.data as { session: { default_llm_provider?: string; default_llm_model?: string } }
    },
    staleTime: 1000 * 60 * 5,
  })

  // Fetch conversation history
  const { data: conversationsData, refetch: refetchConversations } = useQuery({
    queryKey: ['conversations', sessionId],
    queryFn: async () => {
      const res = await llmApi.getConversations(sessionId)
      return res.data as ConversationHistory[]
    },
    staleTime: 1000 * 60 * 2,
  })

  const profiles: ChatbotProfile[] = profilesData 
    ? Object.values(profilesData) 
    : FALLBACK_PROFILES

  // Typewriter effect function
  const typewriterEffect = (fullContent: string, messageId: string) => {
    let currentIndex = 0
    const chunkSize = 3 // Characters per tick
    isGeneratingRef.current = true
    const interval = setInterval(() => {
      currentIndex += chunkSize
      if (currentIndex >= fullContent.length) {
        currentIndex = fullContent.length
        clearInterval(interval)
        isGeneratingRef.current = false
        // Update the message with full content
        setMessages(prev => prev.map(m => 
          m.id === messageId ? { ...m, content: fullContent } : m
        ))
      } else {
        // Update message in real-time
        setMessages(prev => prev.map(m => 
          m.id === messageId ? { ...m, content: fullContent.substring(0, currentIndex) } : m
        ))
      }
      // Don't scroll during typewriter - it causes jumping
    }, 15)
  }

  const currentProfile = profiles.find(p => p.key === selectedProfile)

  const scrollToBottom = () => {
    // Only scroll if not generating (to prevent jumping during typewriter)
    if (!isGeneratingRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }

  useEffect(() => {
    // Only auto-scroll when a new message is added, not during updates
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1]
      // Scroll only for user messages or when generation is complete
      if (lastMessage.role === 'user' || !isGeneratingRef.current) {
        scrollToBottom()
      }
    }
  }, [messages.length])

  const sendMessageMutation = useMutation({
    mutationFn: async ({ content, files, existingHistory }: { content: string; files: globalThis.File[]; existingHistory?: Message[] }) => {
      let convId = conversationId
      if (!convId) {
        // Create conversation first - use teacher's default model if no model selected
        const modelProvider = selectedModel?.provider || sessionData?.session?.default_llm_provider
        const modelName = selectedModel?.model || sessionData?.session?.default_llm_model
        const convRes = await llmApi.createConversation(
          sessionId, 
          selectedProfile || 'tutor',
          undefined,
          modelProvider,
          modelName
        )
        convId = convRes.data.id
        setConversationId(convId)
        
        // If there's existing history (from model change), send it to backend
        if (existingHistory && existingHistory.length > 0 && convId) {
          for (const msg of existingHistory) {
            await llmApi.sendMessage(convId, msg.content, undefined, undefined, undefined)
          }
        }
      }
      
      // Use file upload endpoint if there are files
      if (files.length > 0) {
        const res = await llmApi.sendMessageWithFiles(convId!, content, files)
        return res.data
      }
      
      const res = await llmApi.sendMessage(convId!, content, imageProvider, imageSize, verboseMode)
      return res.data
    },
    onSuccess: (data) => {
      const fullContent = data.content || data.assistant_message || 'Risposta ricevuta'
      const messageId = data.id || Date.now().toString()
      
      // Check if content contains base64 image - skip typewriter for these
      const hasBase64Image = fullContent.includes('data:image') && fullContent.includes('base64')
      
      // Add message
      const assistantMessage: Message = {
        id: messageId,
        role: 'assistant',
        content: hasBase64Image ? fullContent : '', // Show full content immediately for images
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, assistantMessage])
      setAttachedFiles([])
      
      // Start typewriter effect only for non-image messages
      if (!hasBase64Image) {
        typewriterEffect(fullContent, messageId)
      }
      
      // Refetch conversations to update history
      refetchConversations()
    },
    onError: () => {
      const errorMessage: Message = {
        id: Date.now().toString(),
        role: 'assistant',
        content: 'Mi dispiace, si è verificato un errore. Riprova più tardi.',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    },
  })

  const handleSend = () => {
    if ((!input.trim() && attachedFiles.length === 0) || sendMessageMutation.isPending) return

    const filesInfo = attachedFiles.length > 0 
      ? ` [📎 ${attachedFiles.map(f => f.file.name).join(', ')}]` 
      : ''
    
    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: (input.trim() || 'Analizza questi documenti') + filesInfo,
      timestamp: new Date(),
    }
    setMessages((prev) => [...prev, userMessage])
    sendMessageMutation.mutate({ 
      content: input.trim(), 
      files: attachedFiles.map(af => af.file),
      existingHistory: !conversationId && messages.length > 0 ? messages : undefined
    })
    setInput('')
  }

  const handleNewChat = () => {
    setMessages([])
    setConversationId(null)
    setSelectedProfile(null)
    setSelectedModel(null)
    setMobileHistoryOpen(false)
  }

  const handleSelectProfile = (profileKey: string) => {
    setSelectedProfile(profileKey)
    setMessages([])
    setConversationId(null)
  }

  const handleChangeModel = (model: LLMModel | null) => {
    setSelectedModel(model)
    // Reset conversation to use new model, but keep messages as context
    setConversationId(null)
    setShowModelSelector(false)
  }

  // Profile selection screen
  if (!selectedProfile) {
    const availableModels = modelsData?.models || []
    
    return (
      <div className="p-6">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 mb-4">
            <Sparkles className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-2xl font-bold mb-2">Scegli il tuo assistente AI</h2>
          <p className="text-muted-foreground">
            Ogni modalità è progettata per aiutarti in modo diverso
          </p>
        </div>

        {/* Model Selection */}
        {availableModels.length > 0 && (
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <label className="text-sm font-medium mb-2 block">Modello AI</label>
            <select
              value={selectedModel ? `${selectedModel.provider}:${selectedModel.model}` : ''}
              onChange={(e) => {
                if (!e.target.value) {
                  setSelectedModel(null)
                } else {
                  const [provider, model] = e.target.value.split(':')
                  const found = availableModels.find(m => m.provider === provider && m.model === model)
                  setSelectedModel(found || null)
                }
              }}
              className="w-full px-3 py-2 border rounded-md text-sm"
            >
              <option value="">Modello predefinito</option>
              {availableModels.map((m) => (
                <option key={`${m.provider}:${m.model}`} value={`${m.provider}:${m.model}`}>
                  {m.name} - {m.description}
                </option>
              ))}
            </select>
            {selectedModel && (
              <p className="text-xs text-muted-foreground mt-1">
                Provider: {selectedModel.provider.toUpperCase()}
              </p>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {profiles.map((profile) => (
            <Card 
              key={profile.key}
              className={`cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02] border-2 ${PROFILE_COLORS[profile.key] || 'border-gray-200'}`}
              onClick={() => handleSelectProfile(profile.key)}
            >
              <CardHeader className="pb-2">
                <div className={`inline-flex items-center justify-center w-12 h-12 rounded-lg mb-2 ${PROFILE_COLORS[profile.key]?.split(' ').slice(0, 2).join(' ') || 'bg-gray-100'}`}>
                  {PROFILE_ICONS[profile.key] || <Bot className="h-6 w-6" />}
                </div>
                <CardTitle className="text-lg">{profile.name}</CardTitle>
                <CardDescription>{profile.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-1">
                  {profile.suggested_prompts.slice(0, 2).map((prompt, i) => (
                    <span key={i} className="text-xs px-2 py-1 bg-white/50 rounded-full">
                      {prompt}
                    </span>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  // Chat interface
  const availableModels = modelsData?.models || []
  const conversations = conversationsData || []

  // Load a previous conversation
  const loadConversation = async (convId: string) => {
    setConversationId(convId)
    try {
      const res = await llmApi.getMessages(convId)
      const loadedMessages: Message[] = res.data.map((m: { id: string; role: string; content: string; created_at: string }) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: new Date(m.created_at),
      }))
      setMessages(loadedMessages)
      // Find the profile from conversation
      const conv = conversations.find(c => c.id === convId)
      if (conv) {
        setSelectedProfile(conv.profile_key)
      }
    } catch (err) {
      console.error('Error loading conversation:', err)
    }
  }

  return (
    <div className="flex h-full md:h-[650px] flex-col md:flex-row bg-slate-50 md:bg-gradient-to-b md:from-slate-50 md:to-white md:rounded-xl overflow-hidden md:shadow-sm md:border relative">
      {/* Mobile History Overlay */}
      {selectedProfile && mobileHistoryOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileHistoryOpen(false)} />
          <div className="relative w-[85%] max-w-xs bg-white h-full shadow-2xl animate-in slide-in-from-left duration-200 flex flex-col">
            <div className="p-3 border-b bg-white flex justify-between items-center">
              <h4 className="font-semibold text-sm text-slate-700">Cronologia</h4>
              <Button variant="ghost" size="sm" onClick={() => setMobileHistoryOpen(false)}><X className="h-5 w-5" /></Button>
            </div>
            {/* Reusing logic via duplicate rendering for simplicity in this constraints */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              <button
                onClick={handleNewChat}
                className="w-full text-left px-3 py-2 rounded-lg text-sm bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Nuova chat
              </button>
              {conversations
                .filter(c => c.profile_key === selectedProfile)
                .map((conv) => (
                  <div
                    key={conv.id}
                    className={`group relative w-full text-left px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                      conversationId === conv.id 
                        ? 'bg-slate-200 text-slate-800' 
                        : 'hover:bg-slate-100 text-slate-600'
                    }`}
                    onClick={() => { loadConversation(conv.id); setMobileHistoryOpen(false); }}
                  >
                    <div className="truncate font-medium pr-6">{conv.title || 'Conversazione'}</div>
                    <div className="text-xs text-slate-400">
                      {new Date(conv.updated_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* Desktop History Panel */}
      {selectedProfile && (
        <div className={`hidden md:flex ${showHistory ? 'w-64' : 'w-8'} border-r bg-slate-50 flex-col transition-all duration-200`}>
          {showHistory ? (
            <>
              <div className="p-3 border-b bg-white">
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-sm text-slate-700">Cronologia</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowHistory(false)}
                    className="h-6 w-6 p-0"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowHistory(true)}
                className="h-full w-full p-0 rounded-none hover:bg-slate-100"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
          {showHistory && (
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              <button
                onClick={handleNewChat}
                className="w-full text-left px-3 py-2 rounded-lg text-sm bg-violet-100 text-violet-700 hover:bg-violet-200 transition-colors flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Nuova chat
              </button>
              {conversations
                .filter(c => c.profile_key === selectedProfile)
                .map((conv) => (
                  <div
                    key={conv.id}
                    className={`group relative w-full text-left px-3 py-2 rounded-lg text-sm transition-colors cursor-pointer ${
                      conversationId === conv.id 
                        ? 'bg-slate-200 text-slate-800' 
                        : 'hover:bg-slate-100 text-slate-600'
                    }`}
                    onClick={() => loadConversation(conv.id)}
                  >
                    <div className="truncate font-medium pr-6">{conv.title || 'Conversazione'}</div>
                    <div className="text-xs text-slate-400">
                      {new Date(conv.updated_at).toLocaleDateString('it-IT', { 
                        day: 'numeric', 
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit'
                      })}
                    </div>
                    <button
                      onClick={async (e) => {
                        e.stopPropagation()
                        if (confirm('Eliminare questa conversazione?')) {
                          await llmApi.deleteConversation(conv.id)
                          refetchConversations()
                          if (conversationId === conv.id) {
                            handleNewChat()
                          }
                        }
                      }}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-red-100 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Elimina conversazione"
                    >
                      <Trash2 className="h-3 w-3 text-red-500" />
                    </button>
                  </div>
                ))}
              {conversations.filter(c => c.profile_key === selectedProfile).length === 0 && (
                <p className="text-xs text-slate-400 text-center py-4">
                  Nessuna conversazione precedente
                </p>
              )}
            </div>
          )}
          {/* Delete all conversations button */}
          {showHistory && conversations.filter(c => c.profile_key === selectedProfile).length > 0 && (
            <div className="p-2 border-t bg-white">
              <button
                onClick={async () => {
                  if (confirm('Eliminare tutta la cronologia?')) {
                    await llmApi.deleteAllConversations(sessionId)
                    refetchConversations()
                    handleNewChat()
                  }
                }}
                className="w-full text-left px-3 py-2 rounded-lg text-xs text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
              >
                <Trash2 className="h-3 w-3" />
                Elimina tutta la cronologia
              </button>
            </div>
          )}
        </div>
      )}
      
      {/* Main Chat Area */}
      <div 
        className="flex-1 flex flex-col"
        onDragOver={(e) => {
          e.preventDefault()
          e.currentTarget.classList.add('ring-2', 'ring-violet-500', 'ring-inset')
        }}
        onDragLeave={(e) => {
          e.currentTarget.classList.remove('ring-2', 'ring-violet-500', 'ring-inset')
        }}
        onDrop={(e) => {
          e.preventDefault()
          e.currentTarget.classList.remove('ring-2', 'ring-violet-500', 'ring-inset')
          
          // Handle image from chatbot
          const imageData = e.dataTransfer.getData('application/x-chatbot-image')
          if (imageData) {
            fetch(imageData)
              .then(res => res.blob())
              .then(blob => {
                const fileObj = Object.assign(blob, { 
                  name: `immagine_${Date.now()}.png`,
                  lastModified: Date.now()
                }) as File
                setAttachedFiles(prev => [...prev, { file: fileObj, type: 'image' as const, preview: imageData }])
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
          
          // Handle external file drops
          const files = Array.from(e.dataTransfer.files)
          files.forEach(file => {
            const isImage = (file as File).type.startsWith('image/')
            const attached: AttachedFile = {
              file: file as File,
              type: isImage ? 'image' : 'document',
            }
            if (isImage) {
              const reader = new FileReader()
              reader.onload = (ev) => {
                attached.preview = ev.target?.result as string
                setAttachedFiles(prev => [...prev, attached])
              }
              reader.readAsDataURL(file as File)
            } else {
              setAttachedFiles(prev => [...prev, attached])
            }
          })
        }}
      >
      {/* Modern Header */}
      <div className="flex items-center gap-2 md:gap-3 px-3 py-2 md:px-4 md:py-3 bg-white border-b sticky top-0 z-20">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setMobileHistoryOpen(true)}
          className="md:hidden text-slate-500 -ml-2 h-9 w-9 p-0"
        >
          <Menu className="h-5 w-5" />
        </Button>
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={handleNewChat}
          className="text-slate-500 hover:text-slate-700 hidden md:flex"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md">
          {PROFILE_ICONS[selectedProfile] ? (
            <div className="text-white scale-90">{PROFILE_ICONS[selectedProfile]}</div>
          ) : (
            <Bot className="h-5 w-5 text-white" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-slate-800 truncate">{currentProfile?.name}</h3>
          <p className="text-xs text-slate-500 truncate">
            {selectedModel 
              ? selectedModel.name 
              : (sessionData?.session?.default_llm_provider && sessionData?.session?.default_llm_model
                  ? modelsData?.models?.find(m => m.provider === sessionData.session.default_llm_provider && m.model === sessionData.session.default_llm_model)?.name
                  : modelsData?.models?.find(m => m.provider === modelsData?.default_provider && m.model === modelsData?.default_model)?.name) || 'Modello AI'}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowModelSelector(!showModelSelector)}
          className="text-slate-500 hover:text-slate-700"
        >
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Model Selector Dropdown */}
      {showModelSelector && (
        <div className="px-4 py-3 bg-slate-50 border-b">
          <label className="text-xs font-medium text-slate-600 mb-2 block">Cambia modello AI</label>
          <select
            value={selectedModel ? `${selectedModel.provider}:${selectedModel.model}` : ''}
            onChange={(e) => {
              if (!e.target.value) {
                handleChangeModel(null)
              } else {
                const [provider, model] = e.target.value.split(':')
                const found = availableModels.find(m => m.provider === provider && m.model === model)
                handleChangeModel(found || null)
              }
            }}
            className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          >
            <option value="">Modello predefinito</option>
            {availableModels.map((m) => (
              <option key={`${m.provider}:${m.model}`} value={`${m.provider}:${m.model}`}>
                {m.name} ({m.provider})
              </option>
            ))}
          </select>
          {messages.length > 0 && (
            <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
              <RefreshCw className="h-3 w-3" />
              La cronologia verrà mantenuta come contesto
            </p>
          )}
          {/* Verbose mode toggle */}
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-slate-200">
            <span className="text-xs text-slate-600">Risposte esaustive</span>
            <button
              onClick={() => setVerboseMode(!verboseMode)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                verboseMode ? 'bg-violet-500' : 'bg-slate-300'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                  verboseMode ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            {verboseMode ? 'Risposte dettagliate e approfondite' : 'Risposte brevi e concise'}
          </p>
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-4 md:px-4 md:py-6 space-y-4 md:space-y-6 scroll-smooth pb-24 md:pb-6">
        {messages.length === 0 ? (
          <div className="text-center py-12">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-violet-500 to-purple-600 mb-6 shadow-lg">
              {PROFILE_ICONS[selectedProfile] ? (
                <div className="text-white scale-125">{PROFILE_ICONS[selectedProfile]}</div>
              ) : (
                <Bot className="h-10 w-10 text-white" />
              )}
            </div>
            <h3 className="font-bold text-xl text-slate-800 mb-2">Ciao! Sono {currentProfile?.name}</h3>
            <p className="text-slate-500 max-w-md mx-auto mb-8">
              {currentProfile?.description}
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-lg mx-auto">
              {currentProfile?.suggested_prompts.map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => setInput(suggestion)}
                  className="px-4 py-2 bg-white border border-slate-200 rounded-full text-sm text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {message.role === 'assistant' && (
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0 shadow-md">
                  {PROFILE_ICONS[selectedProfile] ? (
                    <div className="text-white scale-75">{PROFILE_ICONS[selectedProfile]}</div>
                  ) : (
                    <Bot className="h-5 w-5 text-white" />
                  )}
                </div>
              )}
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                message.role === 'user' 
                  ? 'bg-gradient-to-br from-violet-500 to-purple-600 text-white rounded-br-md shadow-md' 
                  : 'bg-gradient-to-br from-violet-50 to-purple-50 border border-violet-100 shadow-sm rounded-bl-md'
              }`}>
                {message.role === 'assistant' ? (
                  <MessageContent 
                    content={message.content} 
                    onQuizSubmit={(answers) => {
                      setInput(answers)
                    }}
                  />
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{convertEmoticons(message.content)}</p>
                )}
              </div>
              {message.role === 'user' && (
                <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center flex-shrink-0 shadow-md">
                  <User className="h-5 w-5 text-white" />
                </div>
              )}
            </div>
          ))
        )}
        {sendMessageMutation.isPending && (
          <div className="flex gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-md">
              {PROFILE_ICONS[selectedProfile] ? (
                <div className="text-white scale-75">{PROFILE_ICONS[selectedProfile]}</div>
              ) : (
                <Bot className="h-5 w-5 text-white" />
              )}
            </div>
            <div className="bg-white border border-slate-100 shadow-sm rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{animationDelay: '0ms'}}></span>
                  <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{animationDelay: '150ms'}}></span>
                  <span className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" style={{animationDelay: '300ms'}}></span>
                </div>
                <span className="text-sm text-slate-400">Sto pensando...</span>
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Modern Input area */}
      <div className="fixed bottom-[76px] left-4 right-4 z-40 rounded-2xl shadow-xl bg-white/95 backdrop-blur-sm border border-slate-200/60 p-2 md:p-4 md:static md:bottom-auto md:left-auto md:right-auto md:border-t md:z-auto md:rounded-none md:shadow-none md:bg-white md:border-x-0 md:border-b-0">
        {/* Attached files preview */}
        {attachedFiles.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {attachedFiles.map((af, idx) => (
              <div key={idx} className="relative group">
                {af.type === 'image' && af.preview ? (
                  <img src={af.preview} alt="Preview" className="w-16 h-16 object-cover rounded-lg border" />
                ) : (
                  <div className="w-16 h-16 bg-slate-100 rounded-lg border flex items-center justify-center">
                    <File className="h-6 w-6 text-slate-400" />
                  </div>
                )}
                <button
                  onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
                  className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
                <p className="text-xs text-slate-500 truncate w-16 mt-1">{af.file.name}</p>
              </div>
            ))}
          </div>
        )}
        
        <div className="flex gap-3 items-end">
          {/* Attachment button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.txt,.md"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || [])
              files.forEach(file => {
                const isImage = file.type.startsWith('image/')
                const attached: AttachedFile = {
                  file,
                  type: isImage ? 'image' : 'document',
                }
                if (isImage) {
                  const reader = new FileReader()
                  reader.onload = (ev) => {
                    attached.preview = ev.target?.result as string
                    setAttachedFiles(prev => [...prev, attached])
                  }
                  reader.readAsDataURL(file)
                } else {
                  setAttachedFiles(prev => [...prev, attached])
                }
              })
              e.target.value = ''
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            className="h-12 w-12 rounded-xl text-slate-500 hover:text-violet-600 hover:bg-violet-50"
          >
            <Paperclip className="h-5 w-5" />
          </Button>
          
          <div 
            className="flex-1 relative"
            onDragOver={(e) => {
              e.preventDefault()
              e.currentTarget.classList.add('ring-2', 'ring-violet-500', 'bg-violet-50')
            }}
            onDragLeave={(e) => {
              e.currentTarget.classList.remove('ring-2', 'ring-violet-500', 'bg-violet-50')
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.currentTarget.classList.remove('ring-2', 'ring-violet-500', 'bg-violet-50')
              
              // Handle image from chatbot
              const imageData = e.dataTransfer.getData('application/x-chatbot-image')
              if (imageData) {
                fetch(imageData)
                  .then(res => res.blob())
                  .then(blob => {
                    const fileObj = Object.assign(blob, { 
                      name: `immagine_${Date.now()}.png`,
                      lastModified: Date.now()
                    }) as File
                    setAttachedFiles(prev => [...prev, { file: fileObj, type: 'image' as const, preview: imageData }])
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
              
              // Handle external file drops
              const files = Array.from(e.dataTransfer.files)
              files.forEach(file => {
                const isImage = file.type.startsWith('image/')
                const attached: AttachedFile = {
                  file,
                  type: isImage ? 'image' : 'document',
                }
                if (isImage) {
                  const reader = new FileReader()
                  reader.onload = (ev) => {
                    attached.preview = ev.target?.result as string
                    setAttachedFiles(prev => [...prev, attached])
                  }
                  reader.readAsDataURL(file)
                } else {
                  setAttachedFiles(prev => [...prev, attached])
                }
              })
            }}
          >
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => {
                setInput(e.target.value)
                // Auto-resize
                e.target.style.height = 'auto'
                e.target.style.height = Math.min(e.target.scrollHeight, 150) + 'px'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={attachedFiles.length > 0 ? "Descrivi gli allegati o fai una domanda..." : "Scrivi un messaggio..."}
              disabled={sendMessageMutation.isPending}
              rows={1}
              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all"
              style={{ minHeight: '48px', maxHeight: '150px' }}
            />
          </div>
          <Button 
            onClick={handleSend} 
            disabled={(!input.trim() && attachedFiles.length === 0) || sendMessageMutation.isPending}
            className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700 shadow-md transition-all"
          >
            <Send className="h-5 w-5" />
          </Button>
        </div>
        
        {/* Image provider and format selectors */}
        <div className="flex items-center justify-center gap-4 mt-2 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Generatore:</span>
            <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
              <button
                onClick={() => setImageProvider('flux-schnell')}
                className={`px-2 py-1 text-xs rounded-md transition-all ${
                  imageProvider === 'flux-schnell' 
                    ? 'bg-white shadow text-violet-600 font-medium' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                ⚡ Flux
              </button>
              <button
                onClick={() => setImageProvider('dall-e')}
                className={`px-2 py-1 text-xs rounded-md transition-all ${
                  imageProvider === 'dall-e' 
                    ? 'bg-white shadow text-violet-600 font-medium' 
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                🎨 DALL-E
              </button>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Formato:</span>
            <select
              value={imageSize}
              onChange={(e) => setImageSize(e.target.value)}
              className="text-xs bg-slate-100 border-0 rounded-lg px-2 py-1 text-slate-600 focus:ring-1 focus:ring-violet-300"
            >
              <option value="1024x1024">1:1 Quadrato</option>
              <option value="1024x768">4:3 Orizzontale</option>
              <option value="768x1024">3:4 Verticale</option>
              <option value="1280x720">16:9 Panorama</option>
              <option value="720x1280">9:16 Portrait</option>
            </select>
          </div>
        </div>
      </div>
      </div>
    </div>
  )
}

// Convert text emoticons to emoji
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
    ":'(": '😢', ":'-(": '😢',
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

// Extract base64 images from markdown content
function extractBase64Images(content: string): { cleanContent: string; images: string[] } {
  const images: string[] = []
  let cleanContent = content
  
  // Find all markdown image patterns with data URLs
  // Use a simpler approach: find ![...](...) where the URL starts with data:image
  const startPattern = /!\[[^\]]*\]\(data:image/g
  let match
  const matches: {start: number, end: number, url: string}[] = []
  
  while ((match = startPattern.exec(content)) !== null) {
    const urlStart = match.index + match[0].length - 'data:image'.length
    // Find the closing parenthesis - it should be at the end of the base64 string
    let depth = 1
    let i = match.index + match[0].length
    while (i < content.length && depth > 0) {
      if (content[i] === '(') depth++
      else if (content[i] === ')') depth--
      i++
    }
    if (depth === 0) {
      const url = content.substring(urlStart, i - 1)
      matches.push({start: match.index, end: i, url})
    }
  }
  
  // Extract images and remove from content (reverse order to preserve indices)
  for (let i = matches.length - 1; i >= 0; i--) {
    images.unshift(matches[i].url)
    cleanContent = cleanContent.substring(0, matches[i].start) + cleanContent.substring(matches[i].end)
  }
  
  return { cleanContent: cleanContent.trim(), images }
}

// MessageContent component that handles quiz and CSV rendering
function MessageContent({ content, onQuizSubmit }: { content: string; onQuizSubmit: (answers: string) => void }) {
  const { quiz, csv, textContent, isGenerating, generationType } = parseContentBlocks(content)
  const { cleanContent, images } = extractBase64Images(textContent)
  
  // Show progress bar while generating quiz/image/csv
  if (isGenerating) {
    return (
      <div className="flex flex-col items-center gap-3 py-4">
        <div className="flex items-center gap-2 text-violet-600">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="font-medium">
            {generationType === 'quiz' && 'Generazione quiz in corso...'}
            {generationType === 'image' && 'Generazione immagine in corso...'}
            {generationType === 'csv' && 'Generazione dataset in corso...'}
            {!generationType && 'Elaborazione in corso...'}
          </span>
        </div>
        <div className="w-full max-w-xs bg-gray-200 rounded-full h-2 overflow-hidden">
          <div className="bg-violet-500 h-2 rounded-full animate-pulse" style={{ width: '60%' }}></div>
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
    <div className="prose prose-sm prose-slate max-w-none">
      {cleanContent && (
        <ReactMarkdown 
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            p: ({children}) => <p className="mb-2 last:mb-0">{children}</p>,
            code: ({className, children, ...props}) => {
              const isInline = !className
              return isInline ? (
                <code className="bg-slate-100 px-1.5 py-0.5 rounded text-violet-600 text-xs font-mono" {...props}>
                  {children}
                </code>
              ) : (
                <code className="block bg-slate-900 text-slate-100 p-3 rounded-lg text-xs font-mono overflow-x-auto my-2" {...props}>
                  {children}
                </code>
              )
            },
            pre: ({children}) => <>{children}</>,
            ul: ({children}) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
            ol: ({children}) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
            li: ({children}) => <li className="text-sm">{children}</li>,
            strong: ({children}) => <strong className="font-semibold text-slate-800">{children}</strong>,
            h1: ({children}) => <h1 className="text-lg font-bold mb-2 text-slate-800">{children}</h1>,
            h2: ({children}) => <h2 className="text-base font-bold mb-2 text-slate-800">{children}</h2>,
            h3: ({children}) => <h3 className="text-sm font-bold mb-1 text-slate-800">{children}</h3>,
            blockquote: ({children}) => <blockquote className="border-l-4 border-violet-300 pl-3 italic text-slate-600 my-2">{children}</blockquote>,
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
                e.dataTransfer.setData('text/plain', `[IMAGE]${imgSrc}`)
                e.dataTransfer.setData('application/x-chatbot-image', imgSrc)
                e.dataTransfer.effectAllowed = 'copy'
              }}
            >
              <img 
                src={imgSrc} 
                alt="Immagine generata" 
                className="max-w-full h-auto rounded-lg shadow-md"
                style={{ maxHeight: '400px' }}
                loading="lazy"
              />
              <div className="absolute bottom-2 left-2 bg-violet-500/90 text-white text-xs px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                Trascina nella chat di classe
              </div>
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
                title="Scarica immagine"
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
              <span className="text-xs text-purple-400">• Trascinabile</span>
            </span>
            <Button 
              size="sm" 
              variant="outline"
              className="h-7 text-xs border-purple-300 text-purple-700 hover:bg-purple-100"
              onClick={() => downloadCsv(csv)}
            >
              <Download className="h-3 w-3 mr-1" />
              Scarica CSV
            </Button>
          </div>
          <pre className="bg-slate-900 text-slate-100 p-3 text-xs font-mono overflow-x-auto max-h-48">
            {csv.split('\n').slice(0, 10).join('\n')}
            {csv.split('\n').length > 10 && '\n...'}
          </pre>
        </div>
      )}
      {quiz && (
        <div className="mt-3">
          <InteractiveQuiz quiz={quiz} onSubmitAnswers={onQuizSubmit} />
        </div>
      )}
    </div>
  )
}

// Parse quiz JSON and CSV from message content
function parseContentBlocks(content: string): { quiz: QuizData | null; csv: string | null; textContent: string; isGenerating: boolean; generationType: string | null } {
  let textContent = content
  let quiz: QuizData | null = null
  let csv: string | null = null
  let isGenerating = false
  let generationType: string | null = null
  
  // Detect if content contains incomplete JSON (generation in progress)
  // Look for patterns like ```quiz without closing ``` or partial JSON
  const hasIncompleteQuiz = content.includes('```quiz') && !content.includes('```quiz') 
    ? false 
    : (content.match(/```quiz/g)?.length || 0) > (content.match(/```quiz[\s\S]*?```/g)?.length || 0)
  const hasIncompleteCsv = (content.match(/```csv/g)?.length || 0) > (content.match(/```csv[\s\S]*?```/g)?.length || 0)
  const hasIncompleteJson = content.includes('{"') && !content.includes('"}') && content.length < 500
  
  // Check for generation indicators in text
  const generatingQuizPattern = /genero|creo|preparo.*quiz|sto.*generando.*quiz/i
  const generatingImagePattern = /genero|creo.*immagine|sto.*generando.*immagine|genera.*immagine/i
  const generatingCsvPattern = /genero|creo.*dataset|sto.*generando.*csv|genera.*csv/i
  
  // For messages with base64 images, never show "generating" state
  // The backend sends the complete message with the image, so we just render it
  const hasBase64Image = content.includes('data:image') && content.includes('base64')
  if (hasBase64Image) {
    // Don't detect as generating - just render the content as-is
    return { quiz, csv, textContent, isGenerating: false, generationType: null }
  }
  
  if (hasIncompleteQuiz || (generatingQuizPattern.test(content) && content.length < 200)) {
    isGenerating = true
    generationType = 'quiz'
    // Hide raw JSON during generation
    textContent = textContent.replace(/```quiz[\s\S]*$/, '').replace(/\{[\s\S]*$/, '').trim()
  } else if (hasIncompleteCsv || (generatingCsvPattern.test(content) && content.length < 200)) {
    isGenerating = true
    generationType = 'csv'
    textContent = textContent.replace(/```csv[\s\S]*$/, '').replace(/\{[\s\S]*$/, '').trim()
  } else if (generatingImagePattern.test(content) && content.length < 200) {
    isGenerating = true
    generationType = 'image'
  } else if (hasIncompleteJson) {
    isGenerating = true
    textContent = textContent.replace(/\{[\s\S]*$/, '').trim()
  }
  
  // Extract completed quiz block
  const quizMatch = content.match(/```quiz\s*([\s\S]*?)```/)
  if (quizMatch) {
    try {
      quiz = JSON.parse(quizMatch[1].trim())
      textContent = textContent.replace(/```quiz[\s\S]*?```/, '').trim()
      isGenerating = false // Generation complete
    } catch {
      // Invalid quiz JSON, might still be generating
      if (quizMatch[1].includes('{')) {
        isGenerating = true
        generationType = 'quiz'
        textContent = textContent.replace(/```quiz[\s\S]*?```/, '').trim()
      }
    }
  }
  
  // Extract CSV block
  const csvMatch = content.match(/```csv\s*([\s\S]*?)```/)
  if (csvMatch) {
    csv = csvMatch[1].trim()
    textContent = textContent.replace(/```csv[\s\S]*?```/, '').trim()
    isGenerating = false // Generation complete
  }
  
  // Clean up any remaining raw JSON from display
  textContent = textContent.replace(/```json[\s\S]*?```/g, '').trim()
  
  return { quiz, csv, textContent, isGenerating, generationType }
}

// Interactive Quiz Component
function InteractiveQuiz({ quiz, onSubmitAnswers }: { quiz: QuizData; onSubmitAnswers: (answers: string) => void }) {
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [submitted, setSubmitted] = useState(false)
  const [showExplanations, setShowExplanations] = useState(false)

  const handleSelect = (questionId: number, optionIndex: number) => {
    if (submitted) return
    setAnswers(prev => ({ ...prev, [questionId]: optionIndex }))
  }

  const handleSubmit = () => {
    setSubmitted(true)
    setShowExplanations(true)
    
    // Format answers for sending to chatbot
    const answerText = quiz.questions.map(q => {
      const selected = answers[q.id]
      const letter = selected !== undefined ? String.fromCharCode(65 + selected) : '?'
      return `${q.id}${letter}`
    }).join(', ')
    
    onSubmitAnswers(`Le mie risposte: ${answerText}`)
  }

  const score = quiz.questions.reduce((acc, q) => {
    return acc + (answers[q.id] === q.correct ? 1 : 0)
  }, 0)

  const allAnswered = quiz.questions.every(q => answers[q.id] !== undefined)

  return (
    <div className="bg-gradient-to-br from-violet-50 to-purple-50 rounded-xl p-4 border border-violet-200">
      <h3 className="font-bold text-lg text-violet-800 mb-4 flex items-center gap-2">
        📝 {quiz.title}
      </h3>
      
      <div className="space-y-4">
        {quiz.questions.map((q, qIndex) => {
          const isCorrect = answers[q.id] === q.correct
          const hasAnswered = answers[q.id] !== undefined
          
          return (
            <div key={q.id} className="bg-white rounded-lg p-4 shadow-sm">
              <p className="font-medium text-slate-800 mb-3">
                <span className="text-violet-600">{qIndex + 1}.</span> {q.question}
              </p>
              
              <div className="space-y-2">
                {q.options.map((option, optIndex) => {
                  const isSelected = answers[q.id] === optIndex
                  const isCorrectOption = q.correct === optIndex
                  
                  let buttonClass = "w-full text-left px-4 py-2 rounded-lg border transition-all text-sm "
                  
                  if (submitted) {
                    if (isCorrectOption) {
                      buttonClass += "bg-green-100 border-green-400 text-green-800"
                    } else if (isSelected && !isCorrectOption) {
                      buttonClass += "bg-red-100 border-red-400 text-red-800"
                    } else {
                      buttonClass += "bg-slate-50 border-slate-200 text-slate-500"
                    }
                  } else if (isSelected) {
                    buttonClass += "bg-violet-100 border-violet-400 text-violet-800"
                  } else {
                    buttonClass += "bg-white border-slate-200 hover:border-violet-300 hover:bg-violet-50"
                  }
                  
                  return (
                    <button
                      key={optIndex}
                      onClick={() => handleSelect(q.id, optIndex)}
                      disabled={submitted}
                      className={buttonClass}
                    >
                      <span className="font-medium mr-2">{String.fromCharCode(65 + optIndex)})</span>
                      {option}
                      {submitted && isCorrectOption && <span className="ml-2">✅</span>}
                      {submitted && isSelected && !isCorrectOption && <span className="ml-2">❌</span>}
                    </button>
                  )
                })}
              </div>
              
              {showExplanations && hasAnswered && (
                <div className={`mt-3 p-3 rounded-lg text-sm ${isCorrect ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
                  <strong>{isCorrect ? '✅ Corretto!' : '💡 Spiegazione:'}</strong> {q.explanation}
                </div>
              )}
            </div>
          )
        })}
      </div>
      
      {!submitted ? (
        <button
          onClick={handleSubmit}
          disabled={!allAnswered}
          className={`mt-4 w-full py-3 rounded-xl font-medium transition-all ${
            allAnswered 
              ? 'bg-gradient-to-r from-violet-500 to-purple-600 text-white hover:from-violet-600 hover:to-purple-700 shadow-md' 
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          {allAnswered ? 'Verifica Risposte' : `Rispondi a tutte le domande (${Object.keys(answers).length}/${quiz.questions.length})`}
        </button>
      ) : (
        <div className="mt-4 p-4 bg-white rounded-xl shadow-sm text-center">
          <p className="text-2xl font-bold text-violet-800">
            {score}/{quiz.questions.length}
          </p>
          <p className="text-slate-600">
            {score === quiz.questions.length ? '🎉 Perfetto!' : score >= quiz.questions.length / 2 ? '👍 Buon lavoro!' : '📚 Continua a studiare!'}
          </p>
        </div>
      )}
    </div>
  )
}
