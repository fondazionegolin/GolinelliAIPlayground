import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Paperclip, X, File, Bot, User, ArrowLeft, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { triggerHaptic } from '@/lib/haptics'
import { useKeyboard } from '@/hooks/useMobile'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface AttachedFile {
  file: File
  preview?: string
  type: 'image' | 'document'
}

interface ChatConversationViewProps {
  conversationId: string | null
  profileKey: string
  profileName: string
  profileIcon?: React.ReactNode
  profileColor?: string
  messages: Message[]
  onSend: (content: string, files?: File[]) => void
  onBack: () => void
  isLoading: boolean
  suggestedPrompts?: string[]
  isTeacherbot?: boolean
}

export function ChatConversationView({
  conversationId: _conversationId,
  profileKey: _profileKey,
  profileName,
  profileIcon,
  profileColor = 'bg-gradient-to-br from-sky-500 to-blue-600',
  messages,
  onSend,
  onBack,
  isLoading,
  suggestedPrompts = [],
  isTeacherbot: _isTeacherbot = false,
}: ChatConversationViewProps) {
  // Get the appropriate color class for avatars
  const avatarColorClass = profileColor.startsWith('bg-')
    ? profileColor
    : `bg-${profileColor}-500`
  const [input, setInput] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { isOpen: isKeyboardOpen, height: keyboardHeight } = useKeyboard()
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!isLoading) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, isLoading])

  // Handle send
  const handleSend = useCallback(() => {
    if ((!input.trim() && attachedFiles.length === 0) || isLoading) return

    triggerHaptic('light')
    onSend(input.trim(), attachedFiles.map(f => f.file))
    setInput('')
    setAttachedFiles([])
  }, [input, attachedFiles, isLoading, onSend])

  // Handle file selection
  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files) return

    Array.from(files).forEach(file => {
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
  }, [])

  // Copy message to clipboard
  const handleCopy = useCallback((id: string, content: string) => {
    navigator.clipboard.writeText(content)
    triggerHaptic('light')
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Mobile Header */}
      <div className="md:hidden flex-shrink-0 bg-white border-b border-slate-200 px-3 py-2 flex items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            triggerHaptic('light')
            onBack()
          }}
          className="h-9 w-9 p-0 rounded-full"
        >
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </Button>
        {profileIcon && (
          <div className={`w-9 h-9 rounded-xl ${avatarColorClass} flex items-center justify-center shadow-md`}>
            <div className="text-white scale-75">{profileIcon}</div>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-800 text-sm truncate">{profileName}</h3>
          {isLoading && (
            <p className="text-xs text-sky-500">Sta scrivendo...</p>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div
        className="flex-1 overflow-y-auto px-3 py-4 space-y-4"
        style={{
          paddingBottom: isKeyboardOpen ? keyboardHeight + 80 : 80,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {/* Empty state with suggestions */}
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className={`inline-flex items-center justify-center w-16 h-16 rounded-2xl ${avatarColorClass} mb-4 shadow-lg`}>
              {profileIcon ? (
                <div className="text-white scale-110">{profileIcon}</div>
              ) : (
                <Bot className="h-8 w-8 text-white" />
              )}
            </div>
            <h3 className="font-bold text-lg text-slate-800 mb-2">Ciao! Sono {profileName}</h3>
            <p className="text-slate-500 text-sm max-w-xs mx-auto mb-6">
              Come posso aiutarti oggi?
            </p>
            {suggestedPrompts.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center max-w-sm mx-auto">
                {suggestedPrompts.slice(0, 3).map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => {
                      triggerHaptic('selection')
                      setInput(prompt)
                      inputRef.current?.focus()
                    }}
                    className="px-3 py-2 bg-white border border-slate-200 rounded-full text-sm text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-colors shadow-sm"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Messages */}
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            profileIcon={profileIcon}
            avatarColorClass={avatarColorClass}
            isCopied={copiedId === message.id}
            onCopy={() => handleCopy(message.id, message.content)}
          />
        ))}

        {/* Loading indicator */}
        {isLoading && (
          <div className="flex gap-3">
            <div className={`w-9 h-9 rounded-xl ${avatarColorClass} flex items-center justify-center shadow-md flex-shrink-0`}>
              {profileIcon ? (
                <div className="text-white scale-75">{profileIcon}</div>
              ) : (
                <Bot className="h-5 w-5 text-white" />
              )}
            </div>
            <div className="bg-white border border-slate-100 shadow-sm rounded-2xl rounded-bl-md px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-sky-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-sm text-slate-400">Sto pensando...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area - Fixed at bottom */}
      <div
        className={`
          fixed left-0 right-0 bg-white border-t border-slate-200 px-3 py-2 z-40
          transition-all duration-200
          ${isKeyboardOpen ? 'bottom-0' : 'bottom-[calc(3.5rem+env(safe-area-inset-bottom))]'}
        `}
      >
        {/* Attached files preview */}
        <AnimatePresence>
          {attachedFiles.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="flex gap-2 mb-2 overflow-x-auto pb-2"
            >
              {attachedFiles.map((af, idx) => (
                <div key={idx} className="relative flex-shrink-0">
                  {af.type === 'image' && af.preview ? (
                    <img src={af.preview} alt="Preview" className="w-14 h-14 object-cover rounded-lg border" />
                  ) : (
                    <div className="w-14 h-14 bg-slate-100 rounded-lg border flex items-center justify-center">
                      <File className="h-6 w-6 text-slate-400" />
                    </div>
                  )}
                  <button
                    onClick={() => {
                      triggerHaptic('light')
                      setAttachedFiles(prev => prev.filter((_, i) => i !== idx))
                    }}
                    className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center shadow-md"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Input row */}
        <div className="flex items-center gap-2">
          {/* Attachment button */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.txt,.md"
            multiple
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files)}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              triggerHaptic('selection')
              fileInputRef.current?.click()
            }}
            className="h-10 w-10 p-0 rounded-full text-slate-500 hover:text-sky-600 hover:bg-sky-50"
          >
            <Paperclip className="h-5 w-5" />
          </Button>

          {/* Text input */}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={attachedFiles.length > 0 ? "Aggiungi una descrizione..." : "Scrivi un messaggio..."}
            disabled={isLoading}
            className="flex-1 px-4 py-2.5 bg-slate-100 border-0 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 transition-all"
          />

          {/* Send button */}
          <Button
            onClick={handleSend}
            disabled={(!input.trim() && attachedFiles.length === 0) || isLoading}
            size="sm"
            className="h-10 w-10 p-0 rounded-full bg-gradient-to-br from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 shadow-md transition-all disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// Memoized message bubble for performance
const MessageBubble = memo(function MessageBubble({
  message,
  profileIcon,
  avatarColorClass = 'bg-gradient-to-br from-sky-500 to-blue-600',
  isCopied,
  onCopy,
}: {
  message: Message
  profileIcon?: React.ReactNode
  avatarColorClass?: string
  isCopied: boolean
  onCopy: () => void
}) {
  const isUser = message.role === 'user'

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {/* Assistant avatar */}
      {!isUser && (
        <div className={`w-9 h-9 rounded-xl ${avatarColorClass} flex items-center justify-center flex-shrink-0 shadow-md`}>
          {profileIcon ? (
            <div className="text-white scale-75">{profileIcon}</div>
          ) : (
            <Bot className="h-5 w-5 text-white" />
          )}
        </div>
      )}

      {/* Message content */}
      <div
        className={`
          max-w-[80%] rounded-2xl px-4 py-3 relative group
          ${isUser
            ? 'bg-gradient-to-br from-sky-500 to-blue-600 text-white rounded-br-md shadow-md'
            : 'bg-white border border-slate-100 shadow-sm rounded-bl-md'
          }
        `}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="prose prose-sm prose-slate max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0 text-sm">{children}</p>,
                code: ({ className, children, ...props }) => {
                  const isInline = !className
                  return isInline ? (
                    <code className="bg-slate-100 px-1.5 py-0.5 rounded text-sky-600 text-xs font-mono" {...props}>
                      {children}
                    </code>
                  ) : (
                    <code className="block bg-slate-900 text-slate-100 p-3 rounded-lg text-xs font-mono overflow-x-auto my-2" {...props}>
                      {children}
                    </code>
                  )
                },
                pre: ({ children }) => <>{children}</>,
                ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
                li: ({ children }) => <li className="text-sm">{children}</li>,
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {/* Copy button for assistant messages */}
        {!isUser && (
          <button
            onClick={onCopy}
            className="absolute -bottom-2 -right-2 w-7 h-7 bg-white border border-slate-200 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity shadow-sm"
          >
            {isCopied ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5 text-slate-400" />
            )}
          </button>
        )}
      </div>

      {/* User avatar */}
      {isUser && (
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center flex-shrink-0 shadow-md">
          <User className="h-5 w-5 text-white" />
        </div>
      )}
    </motion.div>
  )
})

export default ChatConversationView
