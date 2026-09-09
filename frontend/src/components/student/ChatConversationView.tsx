import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Paperclip, X, File, Bot, User, ArrowLeft, Copy, Check, Minimize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { triggerHaptic } from '@/lib/haptics'
import { VoiceRecorder } from '@/components/VoiceRecorder'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { markdownCodeComponents } from '@/components/CodeBlock'
import EnvironmentalImpactPill from '@/components/chat/EnvironmentalImpactPill'
import type { TokenUsageJson } from '@/lib/environmentalImpact'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  provider?: string
  model?: string
  token_usage_json?: TokenUsageJson | null
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
  onMinimize?: () => void
}

export function ChatConversationView({
  conversationId: _conversationId,
  profileKey: _profileKey,
  profileName,
  profileIcon,
  profileColor = 'bg-slate-700',
  messages,
  onSend,
  onBack,
  isLoading,
  suggestedPrompts = [],
  isTeacherbot: _isTeacherbot = false,
  onMinimize,
}: ChatConversationViewProps) {
  // Get the appropriate color class for avatars
  const avatarColorClass = profileColor.startsWith('bg-')
    ? profileColor
    : `bg-${profileColor}-500`
  const [input, setInput] = useState('')
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([])
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [viewport, setViewport] = useState(() => ({
    height: typeof window === 'undefined' ? 0 : window.visualViewport?.height || window.innerHeight,
    offsetTop: typeof window === 'undefined' ? 0 : window.visualViewport?.offsetTop || 0,
  }))

  // Keep the whole chat inside the visible area when the mobile keyboard opens.
  // The header and composer remain fixed while only the message list scrolls.
  useEffect(() => {
    const visualViewport = window.visualViewport
    const syncViewport = () => setViewport({
      height: visualViewport?.height || window.innerHeight,
      offsetTop: visualViewport?.offsetTop || 0,
    })
    syncViewport()
    visualViewport?.addEventListener('resize', syncViewport)
    visualViewport?.addEventListener('scroll', syncViewport)
    window.addEventListener('resize', syncViewport)
    return () => {
      visualViewport?.removeEventListener('resize', syncViewport)
      visualViewport?.removeEventListener('scroll', syncViewport)
      window.removeEventListener('resize', syncViewport)
    }
  }, [])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
    }
  }, [])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!isLoading) {
      const container = messagesContainerRef.current
      if (container) {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
      }
    }
  }, [messages.length, isLoading])

  // Handle send
  const handleSend = useCallback(() => {
    if ((!input.trim() && attachedFiles.length === 0) || isLoading) return

    triggerHaptic('light')
    onSend(input.trim(), attachedFiles.map(f => f.file))
    setInput('')
    setAttachedFiles([])
    if (inputRef.current) inputRef.current.style.height = '44px'
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
    <div
      className="fixed inset-x-0 top-0 z-[80] flex min-h-0 flex-col overflow-hidden bg-slate-50"
      style={{ height: `${viewport.height}px`, transform: `translateY(${viewport.offsetTop}px)` }}
    >
      {/* Mobile Header */}
      <div className="flex h-16 flex-shrink-0 items-center gap-2.5 border-b border-slate-200 bg-white/95 px-3 shadow-sm backdrop-blur-xl">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            triggerHaptic('light')
            onBack()
          }}
          className="h-8 w-8 p-0 rounded-xl"
        >
          <ArrowLeft className="h-4 w-4 text-slate-700" />
        </Button>
        {profileIcon && (
          <div className={`w-8 h-8 rounded-xl ${avatarColorClass} flex items-center justify-center shadow-sm`}>
            <div className="text-white scale-75">{profileIcon}</div>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 text-sm truncate">{profileName}</h3>
          {isLoading && (
            <p className="text-[11px] text-slate-500">Sta scrivendo...</p>
          )}
        </div>
        {onMinimize && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              triggerHaptic('light')
              onMinimize()
            }}
            className="h-8 w-8 p-0 rounded-xl"
            title="Riduci a icona"
          >
            <Minimize2 className="h-4 w-4 text-slate-700" />
          </Button>
        )}
      </div>

      {/* Messages area */}
      <div
        ref={messagesContainerRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-4 md:space-y-4 md:px-6"
        style={{
          WebkitOverflowScrolling: 'touch',
          overflowAnchor: 'none',
        }}
      >
        {/* Empty state with suggestions */}
        {messages.length === 0 && (
          <div className="text-center py-5">
            <div className={`inline-flex items-center justify-center w-12 h-12 rounded-xl ${avatarColorClass} mb-3 shadow-md`}>
              {profileIcon ? (
                <div className="text-white scale-95">{profileIcon}</div>
              ) : (
                <Bot className="h-6 w-6 text-white" />
              )}
            </div>
            <h3 className="font-bold text-base text-slate-900 mb-1.5">Sono {profileName}</h3>
            <p className="text-slate-600 text-sm max-w-xs mx-auto mb-4">
              Come posso aiutarti oggi?
            </p>
            {suggestedPrompts.length > 0 && (
              <div className="flex flex-wrap gap-2 justify-center max-w-sm mx-auto">
                {suggestedPrompts.slice(0, 2).map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => {
                      triggerHaptic('selection')
                      setInput(prompt)
                      inputRef.current?.focus()
                    }}
                    className="px-3 py-2 bg-white border border-slate-200 rounded-xl text-sm text-slate-700 hover:bg-slate-50 active:bg-slate-100 transition-colors shadow-sm"
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
            <div className="bg-white border border-slate-100 shadow-sm rounded-xl rounded-bl-md px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-slate-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
                <span className="text-sm text-slate-400">Sto pensando...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Composer: part of the viewport flex layout, never underneath the keyboard. */}
      <div
        className="z-10 flex-shrink-0 border-t border-slate-200 bg-white/95 px-3 pt-2 shadow-[0_-8px_24px_rgba(15,23,42,0.05)] backdrop-blur-xl"
        style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
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
                    <img src={af.preview} alt="Preview" className="w-14 h-14 object-cover rounded-xl border" />
                  ) : (
                    <div className="w-14 h-14 bg-slate-100 rounded-xl border flex items-center justify-center">
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
            accept="image/*,.pdf,.pptx,.ppt,.txt,.md,.docx"
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
            className="h-10 w-10 p-0 rounded-xl text-slate-500 hover:text-sky-700 hover:bg-sky-50"
          >
            <Paperclip className="h-5 w-5" />
          </Button>

          {/* Voice input */}
          <div onPointerDown={() => inputRef.current?.blur()}>
            <VoiceRecorder
              compact
              onInsertText={(text) => {
                setInput((current) => `${current}${current.trim() ? ' ' : ''}${text}`)
                requestAnimationFrame(() => inputRef.current?.focus())
              }}
            />
          </div>

          {/* Text input */}
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onInput={(e) => {
              const element = e.currentTarget
              element.style.height = '44px'
              element.style.height = `${Math.min(element.scrollHeight, 112)}px`
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder={attachedFiles.length > 0 ? "Aggiungi una descrizione..." : "Scrivi un messaggio..."}
            disabled={isLoading}
            className="h-11 max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-100 px-4 py-2 text-[16px] leading-7 text-slate-900 transition-all focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-200"
          />

          {/* Send button */}
          <Button
            onClick={handleSend}
            disabled={(!input.trim() && attachedFiles.length === 0) || isLoading}
            size="sm"
            className="h-10 w-10 p-0 rounded-xl bg-slate-950 hover:bg-slate-800 shadow-md transition-all disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// Memoized message bubble for performance — exported for reuse in teacher history view
export const MessageBubble = memo(function MessageBubble({
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
      className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
      {/* Assistant avatar */}
      {!isUser && (
        <div className={`mt-0.5 h-7 w-7 rounded-lg ${avatarColorClass} flex items-center justify-center flex-shrink-0 shadow-sm`}>
          {profileIcon ? (
            <div className="text-white scale-[0.68]">{profileIcon}</div>
          ) : (
            <Bot className="h-4 w-4 text-white" />
          )}
        </div>
      )}

      {/* Message content */}
      <div
        className={`
          max-w-[92%] md:max-w-[80%] rounded-xl px-3.5 py-3 relative group
          ${isUser
            ? 'bg-slate-950 text-white rounded-br-md shadow-sm'
            : 'bg-white border border-slate-200 shadow-sm rounded-bl-md'
          }
        `}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-[16px] leading-7">{message.content}</p>
        ) : (
          <div className="chat-markdown prose prose-slate max-w-none text-[16px] leading-7">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0 text-[16px] leading-7 text-slate-800">{children}</p>,
                ...markdownCodeComponents(),
                ul: ({ children }) => <ul className="list-disc pl-4 mb-2 space-y-1.5">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal pl-4 mb-2 space-y-1.5">{children}</ol>,
                li: ({ children }) => <li className="text-[16px] leading-7 text-slate-800">{children}</li>,
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {/* Copy button for assistant messages */}
        {!isUser && (
          <>
            <div className="mt-3 flex items-center justify-between gap-3">
              <EnvironmentalImpactPill
                provider={message.provider}
                model={message.model}
                tokenUsage={message.token_usage_json}
              />
            </div>
            <button
              onClick={onCopy}
              className="absolute -bottom-2 -right-2 w-7 h-7 bg-white border border-slate-200 rounded-full flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shadow-sm"
            >
              {isCopied ? (
                <Check className="h-3.5 w-3.5 text-green-500" />
              ) : (
                <Copy className="h-3.5 w-3.5 text-slate-400" />
              )}
            </button>
          </>
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
