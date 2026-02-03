import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Send, Bot, Loader2, RefreshCw } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { teacherbotsApi } from '@/lib/api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface TeacherbotTestChatProps {
  teacherbotId: string
  onBack: () => void
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export default function TeacherbotTestChat({ teacherbotId, onBack }: TeacherbotTestChatProps) {
  const { toast } = useToast()
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Load teacherbot info
  const { data: teacherbot, isLoading: isLoadingBot } = useQuery({
    queryKey: ['teacherbot', teacherbotId],
    queryFn: async () => {
      const res = await teacherbotsApi.get(teacherbotId)
      return res.data
    },
  })

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Add proactive message if enabled
  useEffect(() => {
    if (teacherbot?.is_proactive && teacherbot?.proactive_message && messages.length === 0) {
      setMessages([{
        id: 'proactive',
        role: 'assistant',
        content: teacherbot.proactive_message,
        timestamp: new Date(),
      }])
    }
  }, [teacherbot])

  const testMutation = useMutation({
    mutationFn: async (content: string) => {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      return teacherbotsApi.test(teacherbotId, content, history)
    },
    onSuccess: (response) => {
      const assistantMsg: Message = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.data.content,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, assistantMsg])
    },
    onError: () => {
      toast({ title: 'Errore', description: 'Impossibile testare il teacherbot', variant: 'destructive' })
    },
  })

  const handleSend = async () => {
    if (!inputText.trim() || isLoading) return

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputText.trim(),
      timestamp: new Date(),
    }

    setMessages(prev => [...prev, userMsg])
    setInputText('')
    setIsLoading(true)

    try {
      await testMutation.mutateAsync(userMsg.content)
    } finally {
      setIsLoading(false)
    }
  }

  const handleReset = () => {
    setMessages([])
    if (teacherbot?.is_proactive && teacherbot?.proactive_message) {
      setMessages([{
        id: 'proactive',
        role: 'assistant',
        content: teacherbot.proactive_message,
        timestamp: new Date(),
      }])
    }
  }

  const getColorClass = (color: string) => {
    const colorMap: Record<string, string> = {
      indigo: 'bg-indigo-500',
      blue: 'bg-blue-500',
      green: 'bg-green-500',
      red: 'bg-red-500',
      purple: 'bg-purple-500',
      pink: 'bg-pink-500',
      orange: 'bg-orange-500',
      teal: 'bg-teal-500',
      cyan: 'bg-cyan-500',
    }
    return colorMap[color] || 'bg-indigo-500'
  }

  if (isLoadingBot) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-4 mb-4">
        <Button variant="ghost" onClick={onBack} className="text-slate-600">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Indietro
        </Button>
        <div className="flex-1 flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg ${getColorClass(teacherbot?.color)} flex items-center justify-center`}>
            <Bot className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-slate-800">Test: {teacherbot?.name}</h2>
            <p className="text-xs text-slate-500">Prova il tuo teacherbot prima di pubblicarlo</p>
          </div>
        </div>
        <Button variant="outline" onClick={handleReset} className="text-slate-600">
          <RefreshCw className="h-4 w-4 mr-2" />
          Ricomincia
        </Button>
      </div>

      {/* Chat Area */}
      <div className="flex-1 bg-white rounded-xl border border-slate-200 flex flex-col overflow-hidden">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center opacity-50">
              <Bot className="h-12 w-12 text-slate-300 mb-4" />
              <p className="text-slate-400 font-medium">Inizia a conversare con il tuo bot</p>
              <p className="text-sm text-slate-400">Testa come risponde prima di pubblicarlo</p>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                {msg.role === 'assistant' && (
                  <div className={`w-8 h-8 rounded-lg ${getColorClass(teacherbot?.color)} flex items-center justify-center flex-shrink-0`}>
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                )}
                <div className={`max-w-[70%] px-4 py-3 rounded-2xl ${
                  msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-tr-sm'
                    : 'bg-slate-100 text-slate-800 rounded-tl-sm'
                }`}>
                  {msg.role === 'assistant' ? (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      className="prose prose-sm max-w-none prose-p:my-1"
                    >
                      {msg.content}
                    </ReactMarkdown>
                  ) : (
                    <p className="text-sm">{msg.content}</p>
                  )}
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex gap-3 justify-start">
              <div className={`w-8 h-8 rounded-lg ${getColorClass(teacherbot?.color)} flex items-center justify-center`}>
                <Bot className="h-4 w-4 text-white" />
              </div>
              <div className="bg-slate-100 px-4 py-3 rounded-2xl rounded-tl-sm">
                <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-slate-100">
          <div className="flex gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Scrivi un messaggio di test..."
              className="flex-1 px-4 py-2 border border-slate-200 rounded-full focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
              disabled={isLoading}
            />
            <Button
              onClick={handleSend}
              disabled={!inputText.trim() || isLoading}
              className="rounded-full bg-indigo-600 hover:bg-indigo-700"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Info Panel */}
      <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
        <p className="text-sm text-amber-800">
          <strong>Modalita Test:</strong> Questa chat e solo per testare il comportamento del tuo bot.
          Le conversazioni non vengono salvate e non generano report.
        </p>
      </div>
    </div>
  )
}
