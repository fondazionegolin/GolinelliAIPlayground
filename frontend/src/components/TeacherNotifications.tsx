import { useState, useEffect, useRef } from 'react'
import { Bell, UserPlus, UserMinus, MessageSquare, ClipboardCheck, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface TeacherNotification {
  id: string
  type: 'student_joined' | 'student_left' | 'private_message' | 'task_submitted'
  session_id: string
  student_id: string
  nickname: string
  message: string
  preview?: string
  task_title?: string
  timestamp: string
  read: boolean
}

interface TeacherNotificationsProps {
  notifications: TeacherNotification[]
  onClearAll: () => void
  onMarkAsRead: (id: string) => void
}

const getNotificationIcon = (type: string) => {
  switch (type) {
    case 'student_joined':
      return <UserPlus className="h-3 w-3 text-green-500" />
    case 'student_left':
      return <UserMinus className="h-3 w-3 text-orange-500" />
    case 'private_message':
      return <MessageSquare className="h-3 w-3 text-blue-500" />
    case 'task_submitted':
      return <ClipboardCheck className="h-3 w-3 text-purple-500" />
    default:
      return <Bell className="h-3 w-3 text-gray-500" />
  }
}

const formatTime = (timestamp: string) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

export default function TeacherNotifications({ 
  notifications, 
  onClearAll,
  onMarkAsRead 
}: TeacherNotificationsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [newNotificationIds, setNewNotificationIds] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevNotificationsRef = useRef<TeacherNotification[]>([])

  // Track new notifications for animation
  useEffect(() => {
    const prevIds = new Set(prevNotificationsRef.current.map(n => n.id))
    const newIds = notifications
      .filter(n => !prevIds.has(n.id))
      .map(n => n.id)
    
    if (newIds.length > 0) {
      setNewNotificationIds(prev => new Set([...prev, ...newIds]))
      
      setTimeout(() => {
        setNewNotificationIds(prev => {
          const updated = new Set(prev)
          newIds.forEach(id => updated.delete(id))
          return updated
        })
      }, 3000)
    }
    
    prevNotificationsRef.current = notifications
  }, [notifications])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Auto-scroll to bottom when new notifications arrive
  useEffect(() => {
    if (listRef.current && isOpen) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [notifications, isOpen])

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    <div className="relative" ref={containerRef}>
      {/* Toggle Button */}
      <Button
        variant="ghost"
        size="sm"
        className="relative h-8 px-2"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] px-1 py-0.5 rounded-full min-w-[16px] text-center animate-pulse">
            {unreadCount}
          </span>
        )}
      </Button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white rounded-lg shadow-lg border z-50">
          {/* Header */}
          <div className="flex items-center justify-between p-2 border-b">
            <span className="text-sm font-medium text-gray-700">Notifiche ({notifications.length})</span>
            {notifications.length > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="h-6 px-2 text-xs text-gray-500 hover:text-gray-700"
                onClick={onClearAll}
              >
                <X className="h-3 w-3 mr-1" />
                Pulisci
              </Button>
            )}
          </div>

          {/* Notifications List */}
          <div 
            ref={listRef}
            className="max-h-64 overflow-y-auto"
          >
            {notifications.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">
                Nessuna notifica
              </p>
            ) : (
              <div className="p-1 space-y-1">
                {notifications.map((notification) => {
                  const isNew = newNotificationIds.has(notification.id)
                  return (
                    <div
                      key={notification.id}
                      className={`
                        flex items-start gap-2 p-2 rounded text-xs transition-all duration-300 cursor-pointer
                        ${isNew ? 'bg-red-50 animate-notification' : 'hover:bg-gray-50'}
                        ${!notification.read ? 'border-l-2 border-l-blue-500 pl-1.5' : ''}
                      `}
                      onClick={() => onMarkAsRead(notification.id)}
                    >
                      <div className="shrink-0 mt-0.5">
                        {getNotificationIcon(notification.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={`text-gray-700 leading-tight ${isNew ? 'font-medium text-red-700' : ''}`}>
                          {notification.message}
                        </p>
                        {notification.preview && (
                          <p className="text-gray-400 truncate mt-0.5 text-[10px]">
                            "{notification.preview}"
                          </p>
                        )}
                        <p className="text-gray-400 mt-0.5 text-[10px]">
                          {formatTime(notification.timestamp)}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CSS for animation */}
      <style>{`
        @keyframes notificationPulse {
          0% { background-color: rgb(254 242 242); }
          50% { background-color: rgb(254 226 226); }
          100% { background-color: transparent; }
        }
        .animate-notification {
          animation: notificationPulse 3s ease-out forwards;
        }
      `}</style>
    </div>
  )
}
