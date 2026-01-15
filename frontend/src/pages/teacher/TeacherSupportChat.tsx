import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { 
  Send, Loader2, Bot, Trash2, Download, Settings,
  FileText, ClipboardList, Users, BarChart3, Lightbulb,
  History, ChevronDown
} from 'lucide-react'
import { llmApi } from '@/lib/api'
import ReactMarkdown from 'react-markdown'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts'

const CHART_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

// Component to render enhanced message with charts
function EnhancedMessage({ content }: { content: string }) {
  // Parse markdown tables and convert to chart data
  const parseTableData = (text: string) => {
    const tableRegex = /\|(.+)\|[\r\n]+\|[-:\s|]+\|[\r\n]+((?:\|.+\|[\r\n]*)+)/g
    const tables: { headers: string[]; rows: string[][] }[] = []
    let match
    
    while ((match = tableRegex.exec(text)) !== null) {
      const headers = match[1].split('|').map(h => h.trim()).filter(h => h)
      const rowsText = match[2].trim().split('\n')
      const rows = rowsText.map(row => 
        row.split('|').map(cell => cell.trim()).filter(cell => cell)
      )
      tables.push({ headers, rows })
    }
    return tables
  }

  // Extract statistics from content
  const extractStats = (text: string) => {
    const stats: { label: string; value: number; total?: number }[] = []
    
    // Look for patterns like "X su Y" or "X/Y"
    const ratioRegex = /(\d+)\s*(?:su|\/)\s*(\d+)/g
    let match
    while ((match = ratioRegex.exec(text)) !== null) {
      const context = text.substring(Math.max(0, match.index - 50), match.index)
      const label = context.split(/[.!?\n]/).pop()?.trim() || 'Valore'
      stats.push({ label: label.slice(-30), value: parseInt(match[1]), total: parseInt(match[2]) })
    }
    return stats
  }

  const tables = parseTableData(content)
  const stats = extractStats(content)

  // Convert table to chart data if it has numeric values
  const getChartData = (table: { headers: string[]; rows: string[][] }) => {
    if (table.rows.length === 0) return null
    
    // Check if there are numeric columns
    const numericColIndices = table.headers.map((_, i) => {
      const hasNumbers = table.rows.some(row => !isNaN(parseFloat(row[i])))
      return hasNumbers ? i : -1
    }).filter(i => i >= 0)

    if (numericColIndices.length === 0) return null

    return table.rows.map(row => {
      const item: Record<string, string | number> = { name: row[0] }
      numericColIndices.forEach(i => {
        if (i > 0) {
          item[table.headers[i]] = parseFloat(row[i]) || 0
        }
      })
      return item
    })
  }

  // Render stats cards
  const renderStatsCards = () => {
    if (stats.length === 0) return null
    
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-4">
        {stats.slice(0, 4).map((stat, i) => (
          <div key={i} className="bg-white border rounded-lg p-3 text-center shadow-sm">
            <div className="text-2xl font-bold text-blue-600">
              {stat.value}{stat.total ? `/${stat.total}` : ''}
            </div>
            <div className="text-xs text-gray-500 truncate">{stat.label}</div>
            {stat.total && (
              <div className="mt-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 rounded-full" 
                  style={{ width: `${(stat.value / stat.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    )
  }

  // Render charts for tables
  const renderCharts = () => {
    return tables.map((table, i) => {
      const chartData = getChartData(table)
      if (!chartData || chartData.length === 0) return null

      const numericKeys = Object.keys(chartData[0]).filter(k => k !== 'name')
      
      // Use pie chart for single value, bar chart for multiple
      if (chartData.length <= 6 && numericKeys.length === 1) {
        const pieData = chartData.map((item, idx) => ({
          name: item.name as string,
          value: item[numericKeys[0]] as number,
          fill: CHART_COLORS[idx % CHART_COLORS.length]
        }))

        return (
          <div key={i} className="my-4 bg-white border rounded-lg p-4">
            <h4 className="text-sm font-semibold mb-3 text-gray-700">Distribuzione</h4>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={40}
                    outerRadius={70}
                    dataKey="value"
                    label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )
      }

      return (
        <div key={i} className="my-4 bg-white border rounded-lg p-4">
          <h4 className="text-sm font-semibold mb-3 text-gray-700">Riepilogo Dati</h4>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                <Legend />
                {numericKeys.map((key, idx) => (
                  <Bar key={key} dataKey={key} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )
    })
  }

  // Download this message as text/markdown
  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `risposta-${new Date().toISOString().slice(0,10)}.md`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      {renderStatsCards()}
      {renderCharts()}
      <div className="prose prose-sm max-w-none prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-1 prose-table:my-4 prose-hr:my-4">
        <ReactMarkdown
          components={{
            h1: ({ children }) => <h1 className="text-xl font-bold text-gray-900 border-b pb-2 mb-4">{children}</h1>,
            h2: ({ children }) => <h2 className="text-lg font-semibold text-gray-800 mt-6 mb-3">{children}</h2>,
            h3: ({ children }) => <h3 className="text-base font-semibold text-gray-700 mt-4 mb-2">{children}</h3>,
            p: ({ children }) => <p className="text-gray-700 leading-relaxed my-3">{children}</p>,
            ul: ({ children }) => <ul className="list-disc pl-5 my-3 space-y-1">{children}</ul>,
            ol: ({ children }) => <ol className="list-decimal pl-5 my-3 space-y-1">{children}</ol>,
            li: ({ children }) => <li className="text-gray-700">{children}</li>,
            strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
            table: ({ children }) => (
              <div className="overflow-x-auto my-4">
                <table className="min-w-full border-collapse border border-gray-300 rounded-lg overflow-hidden">
                  {children}
                </table>
              </div>
            ),
            thead: ({ children }) => <thead className="bg-blue-50">{children}</thead>,
            th: ({ children }) => <th className="border border-gray-300 px-4 py-2 text-left font-semibold text-gray-800">{children}</th>,
            td: ({ children }) => <td className="border border-gray-300 px-4 py-2 text-gray-700">{children}</td>,
            blockquote: ({ children }) => (
              <blockquote className="border-l-4 border-blue-500 pl-4 py-2 my-4 bg-blue-50 rounded-r-lg italic text-gray-700">
                {children}
              </blockquote>
            ),
            code: ({ children }) => (
              <code className="bg-gray-100 px-1.5 py-0.5 rounded text-sm font-mono text-gray-800">{children}</code>
            ),
            hr: () => <hr className="my-6 border-gray-200" />,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
      <div className="flex justify-end pt-2 border-t border-gray-200 mt-4">
        <button
          onClick={handleDownload}
          className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-blue-600 transition-colors"
        >
          <Download className="h-3.5 w-3.5" />
          Scarica risposta
        </button>
      </div>
    </div>
  )
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

const AVAILABLE_MODELS = [
  { id: 'gpt-4o', name: 'GPT-4o', description: 'Più potente, ideale per documenti complessi' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', description: 'Veloce e economico' },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', description: 'Ottimo per testi lunghi' },
]

// System prompt is configured in backend for teacher_support profile

const QUICK_ACTIONS = [
  { icon: ClipboardList, label: 'Crea esercizio', prompt: 'Aiutami a creare un nuovo esercizio per la mia classe su ' },
  { icon: FileText, label: 'Compila PEI', prompt: 'Guidami nella compilazione di un Piano Educativo Individualizzato (PEI) per uno studente con ' },
  { icon: BarChart3, label: 'Sintesi valutazioni', prompt: 'Fammi una sintesi delle valutazioni e dei risultati della mia classe ' },
  { icon: Lightbulb, label: 'Brainstorming', prompt: 'Ho bisogno di idee per una lezione su ' },
  { icon: Users, label: 'Relazione classe', prompt: 'Aiutami a scrivere una relazione sulla classe per ' },
]

export default function TeacherSupportChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [selectedModel, setSelectedModel] = useState('gpt-4o-mini')
  const [showModelSelector, setShowModelSelector] = useState(false)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Load conversations from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('teacher_support_conversations')
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        setConversations(parsed.map((c: Conversation) => ({
          ...c,
          createdAt: new Date(c.createdAt),
          messages: c.messages.map(m => ({ ...m, timestamp: new Date(m.timestamp) }))
        })))
      } catch (e) {
        console.error('Failed to parse conversations:', e)
      }
    }
  }, [])

  // Save conversations to localStorage
  useEffect(() => {
    if (conversations.length > 0) {
      localStorage.setItem('teacher_support_conversations', JSON.stringify(conversations))
    }
  }, [conversations])

  const handleSend = async () => {
    if (!inputText.trim() || isLoading) return

    const userMessage: Message = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: inputText.trim(),
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInputText('')
    setIsLoading(true)

    try {
      // Build history from previous messages
      const history = messages.map(m => ({
        role: m.role,
        content: m.content
      }))
      
      // Determine provider based on model
      const provider = selectedModel.includes('claude') ? 'anthropic' : 'openai'
      
      // Call teacher chat endpoint directly
      const response = await llmApi.teacherChat(
        userMessage.content,
        history,
        'teacher_support',
        provider,
        selectedModel
      )

      const assistantMessage: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: response.data?.response || 'Mi dispiace, si è verificato un errore.',
        timestamp: new Date()
      }

      setMessages(prev => [...prev, assistantMessage])

      // Update or create local conversation for history
      if (currentConversationId) {
        setConversations(prev => prev.map(c => 
          c.id === currentConversationId 
            ? { ...c, messages: [...c.messages, userMessage, assistantMessage] }
            : c
        ))
      } else {
        const newConv: Conversation = {
          id: `conv-${Date.now()}`,
          title: userMessage.content.slice(0, 50) + (userMessage.content.length > 50 ? '...' : ''),
          messages: [userMessage, assistantMessage],
          createdAt: new Date()
        }
        setConversations(prev => [newConv, ...prev])
        setCurrentConversationId(newConv.id)
      }
    } catch (err) {
      console.error('Chat error:', err)
      const errorMessage: Message = {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: 'Mi dispiace, si è verificato un errore nella comunicazione. Riprova.',
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const startNewConversation = () => {
    setMessages([])
    setCurrentConversationId(null)
  }

  const loadConversation = (conv: Conversation) => {
    setMessages(conv.messages)
    setCurrentConversationId(conv.id)
    setShowHistory(false)
  }

  const deleteConversation = (convId: string) => {
    setConversations(prev => prev.filter(c => c.id !== convId))
    if (currentConversationId === convId) {
      startNewConversation()
    }
  }

  const handleQuickAction = (prompt: string) => {
    setInputText(prompt)
  }

  const exportChat = () => {
    const content = messages.map(m => 
      `[${m.role === 'user' ? 'Tu' : 'Assistente'}] ${m.content}`
    ).join('\n\n')
    
    const blob = new Blob([content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chat-supporto-${new Date().toISOString().split('T')[0]}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="h-[calc(100vh-4rem)] flex gap-4">
      {/* Sidebar - History */}
      <div className={`${showHistory ? 'w-72' : 'w-0'} transition-all overflow-hidden bg-white rounded-lg border`}>
        <div className="p-4 border-b flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2">
            <History className="h-4 w-4" />
            Cronologia
          </h3>
          <Button variant="ghost" size="sm" onClick={startNewConversation}>
            Nuova
          </Button>
        </div>
        <div className="p-2 space-y-1 max-h-[calc(100%-60px)] overflow-y-auto">
          {conversations.length === 0 ? (
            <p className="text-sm text-gray-500 p-2">Nessuna conversazione</p>
          ) : (
            conversations.map(conv => (
              <div 
                key={conv.id}
                className={`p-2 rounded cursor-pointer hover:bg-gray-100 group ${
                  currentConversationId === conv.id ? 'bg-blue-50' : ''
                }`}
                onClick={() => loadConversation(conv)}
              >
                <p className="text-sm font-medium truncate">{conv.title}</p>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    {conv.createdAt.toLocaleDateString('it-IT')}
                  </p>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="opacity-0 group-hover:opacity-100 h-6 w-6 p-0"
                    onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); }}
                  >
                    <Trash2 className="h-3 w-3 text-red-500" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <Card className="flex-1 flex flex-col">
        <CardHeader className="border-b py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Bot className="h-5 w-5 text-blue-600" />
              Supporto Docente
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setShowHistory(!showHistory)}
              >
                <History className="h-4 w-4" />
              </Button>
              
              <div className="relative">
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowModelSelector(!showModelSelector)}
                  className="flex items-center gap-1"
                >
                  <Settings className="h-4 w-4" />
                  {AVAILABLE_MODELS.find(m => m.id === selectedModel)?.name}
                  <ChevronDown className="h-3 w-3" />
                </Button>
                {showModelSelector && (
                  <div className="absolute right-0 top-full mt-1 bg-white border rounded-lg shadow-lg z-10 w-64">
                    {AVAILABLE_MODELS.map(model => (
                      <div
                        key={model.id}
                        className={`p-3 cursor-pointer hover:bg-gray-50 ${
                          selectedModel === model.id ? 'bg-blue-50' : ''
                        }`}
                        onClick={() => { setSelectedModel(model.id); setShowModelSelector(false); }}
                      >
                        <p className="font-medium text-sm">{model.name}</p>
                        <p className="text-xs text-gray-500">{model.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {messages.length > 0 && (
                <Button variant="ghost" size="sm" onClick={exportChat}>
                  <Download className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-4">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center">
              <Bot className="h-16 w-16 text-blue-200 mb-4" />
              <h3 className="text-lg font-semibold text-gray-700 mb-2">
                Come posso aiutarti oggi?
              </h3>
              <p className="text-sm text-gray-500 text-center mb-6 max-w-md">
                Sono il tuo assistente personale per la didattica. Posso aiutarti con esercizi, 
                documenti scolastici, valutazioni e molto altro.
              </p>
              
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-w-2xl">
                {QUICK_ACTIONS.map((action, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    className="h-auto py-3 px-4 flex flex-col items-center gap-2"
                    onClick={() => handleQuickAction(action.prompt)}
                  >
                    <action.icon className="h-5 w-5 text-blue-600" />
                    <span className="text-xs">{action.label}</span>
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] p-3 rounded-lg ${
                      msg.role === 'user'
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <EnhancedMessage content={msg.content} />
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}
                    <p className={`text-xs mt-1 ${msg.role === 'user' ? 'text-blue-200' : 'text-gray-400'}`}>
                      {msg.timestamp.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 p-3 rounded-lg">
                    <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </CardContent>

        <div className="p-4 border-t">
          <div className="flex gap-2">
            <Input
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Scrivi un messaggio..."
              className="flex-1"
              disabled={isLoading}
            />
            <Button onClick={handleSend} disabled={!inputText.trim() || isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
