import { useState, useRef, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { llmApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { 
  Send, Bot, User, GraduationCap, 
  Lightbulb, ClipboardCheck, ArrowLeft, Sparkles,
  Settings2, RefreshCw, Paperclip, X, File, Database, Download
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
  const [selectedProfile, setSelectedProfile] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<LLMModel | null>(null)
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
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
    const interval = setInterval(() => {
      currentIndex += chunkSize
      if (currentIndex >= fullContent.length) {
        currentIndex = fullContent.length
        clearInterval(interval)
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
      scrollToBottom()
    }, 15)
  }

  const currentProfile = profiles.find(p => p.key === selectedProfile)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  const sendMessageMutation = useMutation({
    mutationFn: async ({ content, files }: { content: string; files: globalThis.File[] }) => {
      let convId = conversationId
      if (!convId) {
        // Create conversation first
        const convRes = await llmApi.createConversation(
          sessionId, 
          selectedProfile || 'tutor',
          undefined,
          selectedModel?.provider,
          selectedModel?.model
        )
        convId = convRes.data.id
        setConversationId(convId)
      }
      
      // Use file upload endpoint if there are files
      if (files.length > 0) {
        const res = await llmApi.sendMessageWithFiles(convId!, content, files)
        return res.data
      }
      
      const res = await llmApi.sendMessage(convId!, content)
      return res.data
    },
    onSuccess: (data) => {
      const fullContent = data.content || data.assistant_message || 'Risposta ricevuta'
      const messageId = data.id || Date.now().toString()
      
      // Add empty message first for typewriter effect
      const assistantMessage: Message = {
        id: messageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, assistantMessage])
      setAttachedFiles([])
      
      // Start typewriter effect
      typewriterEffect(fullContent, messageId)
      
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
      files: attachedFiles.map(af => af.file) 
    })
    setInput('')
  }

  const handleNewChat = () => {
    setMessages([])
    setConversationId(null)
    setSelectedProfile(null)
    setSelectedModel(null)
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
    <div className="flex h-[650px] bg-gradient-to-b from-slate-50 to-white rounded-xl overflow-hidden shadow-sm border">
      {/* History Panel */}
      {showHistory && selectedProfile && (
        <div className="w-64 border-r bg-slate-50 flex flex-col">
          <div className="p-3 border-b bg-white">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold text-sm text-slate-700">Cronologia</h4>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowHistory(false)}
                className="h-6 w-6 p-0"
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
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
                <button
                  key={conv.id}
                  onClick={() => loadConversation(conv.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                    conversationId === conv.id 
                      ? 'bg-slate-200 text-slate-800' 
                      : 'hover:bg-slate-100 text-slate-600'
                  }`}
                >
                  <div className="truncate font-medium">{conv.title || 'Conversazione'}</div>
                  <div className="text-xs text-slate-400">
                    {new Date(conv.updated_at).toLocaleDateString('it-IT', { 
                      day: 'numeric', 
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit'
                    })}
                  </div>
                </button>
              ))}
            {conversations.filter(c => c.profile_key === selectedProfile).length === 0 && (
              <p className="text-xs text-slate-400 text-center py-4">
                Nessuna conversazione precedente
              </p>
            )}
          </div>
        </div>
      )}
      
      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
      {/* Modern Header */}
      <div className="flex items-center gap-3 px-4 py-3 bg-white border-b">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={handleNewChat}
          className="text-slate-500 hover:text-slate-700"
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
            {selectedModel ? selectedModel.name : 'Modello predefinito'}
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
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
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
                  ? 'bg-gradient-to-br from-slate-800 to-slate-900 text-white rounded-br-md' 
                  : 'bg-white border border-slate-100 shadow-sm rounded-bl-md'
              }`}>
                {message.role === 'assistant' ? (
                  <MessageContent 
                    content={message.content} 
                    onQuizSubmit={(answers) => {
                      setInput(answers)
                    }}
                  />
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{message.content}</p>
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
      <div className="p-4 bg-white border-t">
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
          
          <div className="flex-1 relative">
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
      </div>
      </div>
    </div>
  )
}

// MessageContent component that handles quiz and CSV rendering
function MessageContent({ content, onQuizSubmit }: { content: string; onQuizSubmit: (answers: string) => void }) {
  const { quiz, csv, textContent } = parseContentBlocks(content)
  
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
      {textContent && (
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
          {textContent}
        </ReactMarkdown>
      )}
      {csv && (
        <div className="mt-3 border border-purple-200 rounded-lg overflow-hidden">
          <div className="bg-purple-50 px-3 py-2 flex items-center justify-between">
            <span className="text-sm font-medium text-purple-700 flex items-center gap-2">
              <Database className="h-4 w-4" />
              Dataset CSV ({csv.split('\n').length - 1} righe)
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
function parseContentBlocks(content: string): { quiz: QuizData | null; csv: string | null; textContent: string } {
  let textContent = content
  let quiz: QuizData | null = null
  let csv: string | null = null
  
  // Extract quiz block
  const quizMatch = content.match(/```quiz\s*([\s\S]*?)```/)
  if (quizMatch) {
    try {
      quiz = JSON.parse(quizMatch[1].trim())
      textContent = textContent.replace(/```quiz[\s\S]*?```/, '').trim()
    } catch {
      // Invalid quiz JSON, ignore
    }
  }
  
  // Extract CSV block
  const csvMatch = content.match(/```csv\s*([\s\S]*?)```/)
  if (csvMatch) {
    csv = csvMatch[1].trim()
    textContent = textContent.replace(/```csv[\s\S]*?```/, '').trim()
  }
  
  return { quiz, csv, textContent }
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
