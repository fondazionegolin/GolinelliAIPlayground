import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Bot, Loader2, Send, Lock, AlertTriangle, Wand2, Paperclip, X, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { publicTeacherbotApi } from '@/lib/api'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownCodeComponents } from '@/components/CodeBlock'
import { resolveTeacherbotIcon } from '@/lib/teacherbotIcons'
import { VoiceRecorder } from '@/components/VoiceRecorder'

interface LinkInfo {
  name: string
  synopsis: string | null
  icon: string
  color: string
  is_proactive: boolean
  proactive_message: string | null
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
}

const COLOR_MAP: Record<string, string> = {
  indigo: 'bg-[#181b1e]', blue: 'bg-blue-500', green: 'bg-green-500', red: 'bg-red-500',
  purple: 'bg-purple-500', pink: 'bg-pink-500', orange: 'bg-orange-500', teal: 'bg-teal-500', cyan: 'bg-cyan-500',
}
const getColorClass = (color?: string) => COLOR_MAP[color || ''] || 'bg-[#181b1e]'

const sessionKey = (token: string) => `teacherbot-share-conv:${token}`

export default function PublicTeacherbotChatPage() {
  const { token = '' } = useParams()
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [conversationId, setConversationId] = useState<string | null>(() => sessionStorage.getItem(sessionKey(token)))
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)

  const [messages, setMessages] = useState<Message[]>([])
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)
  const [attachedFiles, setAttachedFiles] = useState<File[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    publicTeacherbotApi.getLinkInfo(token)
      .then((res) => { if (active) setLinkInfo(res.data as LinkInfo) })
      .catch((err) => {
        if (!active) return
        const status = err?.response?.status
        setError(status === 410 ? 'Questo link è scaduto.' : 'Link non valido.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    if (!conversationId) return
    let active = true
    publicTeacherbotApi.getMessages(conversationId)
      .then((res) => {
        if (!active) return
        const history = (res.data as any[]).map((m) => ({ id: m.id, role: m.role, content: m.content }))
        setMessages(history)
      })
      .catch(() => {
        if (active) {
          sessionStorage.removeItem(sessionKey(token))
          setConversationId(null)
        }
      })
    return () => { active = false }
  }, [conversationId, token])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleVerify = async () => {
    if (!code.trim() || verifying) return
    setVerifying(true)
    setCodeError(null)
    try {
      const res = await publicTeacherbotApi.verifyCode(token, code.trim())
      const conv = res.data as { id: string }
      sessionStorage.setItem(sessionKey(token), conv.id)
      setConversationId(conv.id)
    } catch (err: any) {
      setCodeError(err?.response?.status === 401 ? 'Codice non valido.' : 'Impossibile verificare il codice.')
    } finally {
      setVerifying(false)
    }
  }

  const handleSend = async () => {
    if ((!inputText.trim() && attachedFiles.length === 0) || sending || !conversationId) return
    const content = inputText.trim()
    const files = attachedFiles
    setMessages((prev) => [...prev, {
      id: `user-${Date.now()}`,
      role: 'user',
      content: content || (files.length === 1 ? `📎 ${files[0].name}` : `📎 ${files.length} allegati`),
    }])
    setInputText('')
    setAttachedFiles([])
    setSending(true)
    try {
      const res = files.length > 0
        ? await publicTeacherbotApi.sendMessageWithFiles(conversationId, content, files)
        : await publicTeacherbotApi.sendMessage(conversationId, content)
      const msg = res.data as any
      setMessages((prev) => [...prev, { id: msg.id, role: 'assistant', content: msg.content }])
    } catch {
      setMessages((prev) => [...prev, { id: `error-${Date.now()}`, role: 'assistant', content: 'Si è verificato un errore. Riprova.' }])
    } finally {
      setSending(false)
    }
  }

  const handleFileInput = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    if (fileInputRef.current) fileInputRef.current.value = ''
    setAttachedFiles((prev) => [...prev, ...Array.from(fileList)].slice(0, 3))
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    )
  }

  if (error || !linkInfo) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="text-center max-w-sm">
          <AlertTriangle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
          <p className="text-slate-700 font-medium">{error || 'Link non valido.'}</p>
        </div>
      </div>
    )
  }

  const icon = resolveTeacherbotIcon(linkInfo.icon)
  const renderBotIcon = (className: string) => {
    if (icon.kind === 'lucide') return <icon.Icon className={className} />
    if (icon.kind === 'emoji') return <span className="leading-none">{icon.emoji}</span>
    return <Wand2 className={className} />
  }

  if (!conversationId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className={`w-14 h-14 rounded-xl ${getColorClass(linkInfo.color)} flex items-center justify-center mx-auto mb-4`}>
            {renderBotIcon('h-7 w-7 text-white')}
          </div>
          <h1 className="text-lg font-bold text-slate-800 mb-1">{linkInfo.name}</h1>
          {linkInfo.synopsis && <p className="text-sm text-slate-500 mb-6">{linkInfo.synopsis}</p>}

          <div className="flex items-center gap-2 justify-center text-slate-400 mb-3">
            <Lock className="h-4 w-4" />
            <span className="text-xs">Inserisci il codice di accesso</span>
          </div>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === 'Enter') handleVerify() }}
            placeholder="CODICE"
            className="w-full text-center tracking-[0.3em] font-mono font-semibold px-3 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#181b1e] focus:border-transparent mb-3"
            autoFocus
          />
          {codeError && <p className="text-sm text-red-500 mb-3">{codeError}</p>}
          <Button onClick={handleVerify} disabled={!code.trim() || verifying} className="w-full bg-[#181b1e] hover:bg-[#0f1113]">
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Entra'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">
      <div className="flex-shrink-0 border-b border-slate-200 bg-white px-4 py-3 flex items-center gap-3">
        <div className={`w-9 h-9 rounded-lg ${getColorClass(linkInfo.color)} flex items-center justify-center flex-shrink-0`}>
          {renderBotIcon('h-4.5 w-4.5 text-white')}
        </div>
        <div className="min-w-0">
          <h1 className="font-bold text-slate-800 text-sm truncate">{linkInfo.name}</h1>
          {linkInfo.synopsis && <p className="text-xs text-slate-400 truncate">{linkInfo.synopsis}</p>}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-3xl w-full mx-auto">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center opacity-50 py-12">
            <Bot className="h-12 w-12 text-slate-300 mb-4" />
            <p className="text-slate-400 font-medium">Inizia a conversare</p>
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className={`w-8 h-8 rounded-lg ${getColorClass(linkInfo.color)} flex items-center justify-center flex-shrink-0`}>
                  <Bot className="h-4 w-4 text-white" />
                </div>
              )}
              <div className={`max-w-[80%] px-4 py-3 rounded-2xl ${msg.role === 'user' ? 'bg-[#181b1e] text-white rounded-tr-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm'}`}>
                {msg.role === 'assistant' ? (
                  <ReactMarkdown remarkPlugins={[remarkGfm]} className="chat-markdown prose max-w-none prose-p:my-1" components={markdownCodeComponents()}>
                    {msg.content}
                  </ReactMarkdown>
                ) : (
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                )}
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="flex gap-3 justify-start">
            <div className={`w-8 h-8 rounded-lg ${getColorClass(linkInfo.color)} flex items-center justify-center`}>
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div className="bg-white border border-slate-200 px-4 py-3 rounded-2xl rounded-tl-sm">
              <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="flex-shrink-0 border-t border-slate-200 bg-white p-4">
        <div className="max-w-3xl mx-auto">
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachedFiles.map((file, idx) => (
                <div key={idx} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs text-slate-600">
                  <FileText className="h-3 w-3 flex-shrink-0" />
                  <span className="truncate max-w-[140px]">{file.name}</span>
                  <button
                    type="button"
                    onClick={() => setAttachedFiles((prev) => prev.filter((_, i) => i !== idx))}
                    className="text-slate-400 hover:text-red-500"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              accept=".pdf,.txt,.md,.csv,.pptx,.ppt,.py,.js,.ts,.html,.css,.json"
              onChange={(e) => handleFileInput(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending || attachedFiles.length >= 3}
              title="Allega documento"
              className="h-9 w-9 flex-shrink-0 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-40"
            >
              <Paperclip className="h-4 w-4" />
            </button>
            <VoiceRecorder
              onInsertText={(text) => setInputText((prev) => (prev ? `${prev} ${text}` : text))}
              transcribeUrl={`/api/v1/public/teacherbot-links/${token}/transcribe`}
              allowTranslate={false}
            />
            <textarea
              rows={1}
              value={inputText}
              onChange={(e) => {
                setInputText(e.target.value)
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = `${Math.min(el.scrollHeight, 140)}px`
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Scrivi un messaggio..."
              className="flex-1 resize-none px-4 py-2 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-[#181b1e] focus:border-transparent text-sm leading-6"
              disabled={sending}
            />
            <Button onClick={handleSend} disabled={(!inputText.trim() && attachedFiles.length === 0) || sending} className="rounded-full bg-[#181b1e] hover:bg-[#0f1113] flex-shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
