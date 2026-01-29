import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence, PanInfo } from 'framer-motion'
import { Plus, Trash2, Search, MessageSquare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { triggerHaptic } from '@/lib/haptics'
import PullToRefresh from '@/components/ui/PullToRefresh'

interface ConversationHistory {
  id: string
  title: string
  profile_key: string
  updated_at: string
  last_message?: string
}

interface ChatConversationListProps {
  profileKey: string
  profileName: string
  profileIcon?: React.ReactNode
  conversations: ConversationHistory[]
  onSelectConversation: (id: string) => void
  onNewChat: () => void
  onDeleteConversation: (id: string) => void
  onRefresh?: () => Promise<void>
  isLoading?: boolean
}

// Helper to group conversations by date
function groupByDate(conversations: ConversationHistory[]): Record<string, ConversationHistory[]> {
  const groups: Record<string, ConversationHistory[]> = {}
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000)
  const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000)

  conversations.forEach(conv => {
    const date = new Date(conv.updated_at)
    const convDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

    let group: string
    if (convDate.getTime() === today.getTime()) {
      group = 'Oggi'
    } else if (convDate.getTime() === yesterday.getTime()) {
      group = 'Ieri'
    } else if (convDate.getTime() > weekAgo.getTime()) {
      group = 'Questa settimana'
    } else {
      group = 'Precedenti'
    }

    if (!groups[group]) {
      groups[group] = []
    }
    groups[group].push(conv)
  })

  return groups
}

// Format time for display
function formatTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (24 * 60 * 60 * 1000))

  if (diffDays === 0) {
    return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  } else if (diffDays === 1) {
    return 'Ieri'
  } else if (diffDays < 7) {
    return date.toLocaleDateString('it-IT', { weekday: 'short' })
  } else {
    return date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })
  }
}

export function ChatConversationList({
  profileKey,
  profileName,
  profileIcon,
  conversations,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  onRefresh,
  isLoading,
}: ChatConversationListProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [swipingId, setSwipingId] = useState<string | null>(null)
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [longPressId, setLongPressId] = useState<string | null>(null)

  // Filter conversations by profile and search
  const filteredConversations = conversations
    .filter(c => c.profile_key === profileKey)
    .filter(c => !searchQuery || c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())

  const groupedConversations = groupByDate(filteredConversations)
  const groupOrder = ['Oggi', 'Ieri', 'Questa settimana', 'Precedenti']

  const handleLongPressStart = useCallback((id: string) => {
    longPressTimerRef.current = setTimeout(() => {
      triggerHaptic('heavy')
      setLongPressId(id)
    }, 500)
  }, [])

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }
  }, [])

  const handleSwipe = useCallback((id: string, info: PanInfo) => {
    if (info.offset.x < -80) {
      setSwipingId(id)
    } else {
      setSwipingId(null)
    }
  }, [])

  const handleSwipeEnd = useCallback((id: string, info: PanInfo) => {
    if (info.offset.x < -120) {
      triggerHaptic('warning')
      onDeleteConversation(id)
    }
    setSwipingId(null)
  }, [onDeleteConversation])

  return (
    <div className="flex flex-col h-full bg-slate-50">
      {/* Header with profile info and new chat button */}
      <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            {profileIcon && (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-blue-600 flex items-center justify-center shadow-md">
                <div className="text-white scale-75">{profileIcon}</div>
              </div>
            )}
            <div>
              <h2 className="font-semibold text-slate-800">{profileName}</h2>
              <p className="text-xs text-slate-500">
                {filteredConversations.length} conversazion{filteredConversations.length === 1 ? 'e' : 'i'}
              </p>
            </div>
          </div>
          <Button
            onClick={() => {
              triggerHaptic('light')
              onNewChat()
            }}
            size="sm"
            className="bg-gradient-to-br from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white shadow-md rounded-full px-4"
          >
            <Plus className="h-4 w-4 mr-1" />
            Nuova
          </Button>
        </div>

        {/* Search bar */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cerca conversazioni..."
            className="w-full pl-9 pr-4 py-2 bg-slate-100 border-0 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>
      </div>

      {/* Conversation list with pull-to-refresh */}
      <PullToRefresh onRefresh={onRefresh} isLoading={isLoading}>
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
                <MessageSquare className="h-8 w-8 text-slate-300" />
              </div>
              <h3 className="font-medium text-slate-700 mb-1">Nessuna conversazione</h3>
              <p className="text-sm text-slate-500 mb-4">
                Inizia una nuova chat con {profileName}
              </p>
              <Button
                onClick={() => {
                  triggerHaptic('light')
                  onNewChat()
                }}
                className="bg-gradient-to-br from-sky-500 to-blue-600"
              >
                <Plus className="h-4 w-4 mr-2" />
                Nuova conversazione
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {groupOrder.map(group => {
                const convs = groupedConversations[group]
                if (!convs || convs.length === 0) return null

                return (
                  <div key={group}>
                    <div className="px-4 py-2 bg-slate-100/50 sticky top-0 z-10">
                      <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">
                        {group}
                      </span>
                    </div>
                    {convs.map((conv) => (
                      <ConversationItem
                        key={conv.id}
                        conversation={conv}
                        isSwiping={swipingId === conv.id}
                        isLongPressed={longPressId === conv.id}
                        onSelect={() => {
                          triggerHaptic('selection')
                          onSelectConversation(conv.id)
                        }}
                        onSwipe={(info) => handleSwipe(conv.id, info)}
                        onSwipeEnd={(info) => handleSwipeEnd(conv.id, info)}
                        onLongPressStart={() => handleLongPressStart(conv.id)}
                        onLongPressEnd={handleLongPressEnd}
                        onDelete={() => {
                          triggerHaptic('warning')
                          onDeleteConversation(conv.id)
                        }}
                        onCloseLongPress={() => setLongPressId(null)}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </PullToRefresh>

      {/* Long press menu overlay */}
      <AnimatePresence>
        {longPressId && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50"
            onClick={() => setLongPressId(null)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// Individual conversation item with swipe actions
function ConversationItem({
  conversation,
  isSwiping,
  isLongPressed,
  onSelect,
  onSwipe,
  onSwipeEnd,
  onLongPressStart,
  onLongPressEnd,
  onDelete,
  onCloseLongPress,
}: {
  conversation: ConversationHistory
  isSwiping: boolean
  isLongPressed: boolean
  onSelect: () => void
  onSwipe: (info: PanInfo) => void
  onSwipeEnd: (info: PanInfo) => void
  onLongPressStart: () => void
  onLongPressEnd: () => void
  onDelete: () => void
  onCloseLongPress: () => void
}) {
  return (
    <div className="relative overflow-hidden">
      {/* Delete action background */}
      <div className="absolute inset-y-0 right-0 w-24 bg-red-500 flex items-center justify-center">
        <Trash2 className="h-5 w-5 text-white" />
      </div>

      {/* Swipeable content */}
      <motion.div
        drag="x"
        dragConstraints={{ left: -120, right: 0 }}
        dragElastic={0.1}
        onDrag={(_, info) => onSwipe(info)}
        onDragEnd={(_, info) => onSwipeEnd(info)}
        animate={{ x: isSwiping ? -80 : 0 }}
        className="relative bg-white"
      >
        <button
          onClick={onSelect}
          onTouchStart={onLongPressStart}
          onTouchEnd={onLongPressEnd}
          onMouseDown={onLongPressStart}
          onMouseUp={onLongPressEnd}
          onMouseLeave={onLongPressEnd}
          className={`w-full text-left px-4 py-3 flex items-start gap-3 active:bg-slate-50 transition-colors ${
            isLongPressed ? 'bg-slate-100' : ''
          }`}
        >
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-100 to-blue-100 flex items-center justify-center flex-shrink-0">
            <MessageSquare className="h-5 w-5 text-sky-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-medium text-slate-800 truncate text-sm">
                {conversation.title || 'Nuova conversazione'}
              </h3>
              <span className="text-xs text-slate-400 flex-shrink-0">
                {formatTime(conversation.updated_at)}
              </span>
            </div>
            {conversation.last_message && (
              <p className="text-xs text-slate-500 truncate mt-0.5">
                {conversation.last_message}
              </p>
            )}
          </div>
        </button>

        {/* Long press menu */}
        <AnimatePresence>
          {isLongPressed && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="absolute top-full left-4 right-4 z-50 bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  onDelete()
                  onCloseLongPress()
                }}
                className="w-full text-left px-4 py-3 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"
              >
                <Trash2 className="h-4 w-4" />
                Elimina conversazione
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}

export default ChatConversationList
