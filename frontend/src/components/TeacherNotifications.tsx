import { useState, useEffect, useRef } from 'react'
import { Bell, UserPlus, UserMinus, MessageSquare, ClipboardCheck, X, Share2, CheckCircle2, XCircle, ShieldAlert, Eye, Ban, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface QuizAnswer {
  question_index: number
  question_text: string
  student_answer: string
  correct_answer: string
  is_correct: boolean
}

export interface TeacherNotification {
  id: string
  type: 'student_joined' | 'student_left' | 'private_message' | 'task_submitted' | 'public_chat' | 'assignment_shared' | 'quiz_completed' | 'content_alert'
  session_id: string
  session_name?: string
  class_name?: string
  student_id: string
  nickname: string
  message: string
  preview?: string
  task_title?: string
  quiz_answers?: QuizAnswer[]
  quiz_score?: { correct: number; total: number }
  // content_alert specific
  alert_id?: string
  alert_type?: 'vulgar' | 'sexual' | 'offensive' | 'threatening' | 'pii_detected'
  risk_score?: number
  timestamp: string
  read: boolean
  // alert action state (local UI only)
  alertStatus?: 'pending' | 'acknowledged' | 'blocked' | 'accepted'
}

interface TeacherNotificationsProps {
  notifications: TeacherNotification[]
  onClearAll: () => void
  onMarkAsRead: (id: string) => void
  onNotificationClick: (notification: TeacherNotification) => void
  onAlertAction?: (alertId: string, action: 'acknowledged' | 'blocked' | 'accepted') => void
}

const getNotificationIcon = (type: string) => {
  switch (type) {
    case 'student_joined':
      return <UserPlus className="h-3 w-3 text-green-500" />
    case 'student_left':
      return <UserMinus className="h-3 w-3 text-orange-500" />
    case 'private_message':
      return <MessageSquare className="h-3 w-3 text-blue-500" />
    case 'public_chat':
      return <MessageSquare className="h-3 w-3 text-cyan-500" />
    case 'task_submitted':
      return <ClipboardCheck className="h-3 w-3 text-purple-500" />
    case 'assignment_shared':
      return <Share2 className="h-3 w-3 text-indigo-500" />
    case 'quiz_completed':
      return <CheckCircle2 className="h-3 w-3 text-emerald-500" />
    case 'content_alert':
      return <ShieldAlert className="h-3 w-3 text-red-600 animate-pulse" />
    default:
      return <Bell className="h-3 w-3 text-gray-500" />
  }
}

const ALERT_TYPE_LABELS: Record<string, string> = {
  vulgar: 'Volgare',
  sexual: 'Sessuale',
  offensive: 'Offensivo',
  threatening: 'Minaccioso',
  pii_detected: 'Dati personali',
}

const formatTime = (timestamp: string) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

export default function TeacherNotifications({
  notifications,
  onClearAll,
  onMarkAsRead,
  onNotificationClick,
  onAlertAction,
}: TeacherNotificationsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [newNotificationIds, setNewNotificationIds] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const prevNotificationsRef = useRef<TeacherNotification[]>([])

  const hasUnreadAlerts = notifications.some(n => n.type === 'content_alert' && !n.read)

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
        className="relative h-8 w-8 p-0 flex items-center justify-center"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Bell className={`h-4 w-4 ${hasUnreadAlerts ? 'text-red-600 animate-bounce' : ''}`} />
        {unreadCount > 0 && (
          <span className={`absolute -top-1 -right-1 text-white text-[10px] px-1 py-0.5 rounded-full min-w-[16px] text-center animate-pulse ${hasUnreadAlerts ? 'bg-red-600 shadow-[0_0_6px_2px_rgba(220,38,38,0.7)]' : 'bg-red-500'}`}>
            {unreadCount}
          </span>
        )}
      </Button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-96 bg-white rounded-lg shadow-lg border z-50">
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
            className="max-h-96 overflow-y-auto"
          >
            {notifications.length === 0 ? (
              <p className="text-xs text-gray-400 text-center py-6">
                Nessuna notifica
              </p>
            ) : (
              <div className="p-1 space-y-1">
                {notifications.map((notification) => {
                  const isNew = newNotificationIds.has(notification.id)
                  const hasQuizDetails = notification.type === 'quiz_completed' && notification.quiz_answers
                  const isAlert = notification.type === 'content_alert'

                  return (
                    <div
                      key={notification.id}
                      className={`
                          p-2 rounded text-xs transition-all duration-300
                          ${isAlert
                            ? 'border border-red-200 bg-red-50 cursor-default'
                            : `cursor-pointer ${isNew ? 'bg-red-50 animate-notification' : 'hover:bg-gray-50'}`
                          }
                          ${!notification.read && !isAlert ? 'border-l-2 border-l-blue-500 pl-1.5' : ''}
                          ${isAlert && !notification.read ? 'border-l-2 border-l-red-600' : ''}
                        `}
                      onClick={() => {
                        if (!isAlert) {
                          onMarkAsRead(notification.id)
                          onNotificationClick(notification)
                          setIsOpen(false)
                        }
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <div className="shrink-0 mt-0.5">
                          {getNotificationIcon(notification.type)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`leading-tight font-medium ${isAlert ? 'text-red-700' : isNew ? 'text-red-700' : 'text-gray-700'}`}>
                            {notification.message}
                          </p>

                          {/* Alert type badge */}
                          {isAlert && notification.alert_type && (
                            <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-red-100 text-red-700 uppercase tracking-wide">
                              {ALERT_TYPE_LABELS[notification.alert_type] ?? notification.alert_type}
                              {notification.risk_score !== undefined && notification.risk_score > 0 && (
                                <span className="ml-1 opacity-70">· {Math.round(notification.risk_score * 100)}%</span>
                              )}
                            </span>
                          )}

                          {notification.session_name && (
                            <p className="text-gray-400 text-[10px] mt-0.5">
                              📍 {notification.class_name || 'Classe'} - {notification.session_name}
                            </p>
                          )}
                          {notification.preview && !hasQuizDetails && (
                            <p className="text-gray-400 truncate mt-0.5 text-[10px]">
                              "{notification.preview}"
                            </p>
                          )}
                          <p className="text-gray-400 mt-0.5 text-[10px]">
                            {formatTime(notification.timestamp)}
                          </p>
                        </div>
                      </div>

                      {/* Content Alert Actions */}
                      {isAlert && notification.alert_id && onAlertAction && (
                        <div className="mt-2 flex items-center gap-1 pl-5">
                          {notification.alertStatus === 'acknowledged' || notification.alertStatus === 'accepted' || notification.alertStatus === 'blocked' ? (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                              notification.alertStatus === 'blocked' ? 'bg-red-100 text-red-700' :
                              notification.alertStatus === 'accepted' ? 'bg-green-100 text-green-700' :
                              'bg-gray-100 text-gray-600'
                            }`}>
                              {notification.alertStatus === 'blocked' ? '🚫 Bloccato' :
                               notification.alertStatus === 'accepted' ? '✅ Accettato' :
                               '👁 Visto'}
                            </span>
                          ) : (
                            <>
                              <button
                                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
                                onClick={(e) => { e.stopPropagation(); onMarkAsRead(notification.id); onAlertAction(notification.alert_id!, 'acknowledged') }}
                                title="Segna come visto"
                              >
                                <Eye className="h-2.5 w-2.5" /> Visto
                              </button>
                              <button
                                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-green-100 hover:bg-green-200 text-green-700 transition-colors"
                                onClick={(e) => { e.stopPropagation(); onMarkAsRead(notification.id); onAlertAction(notification.alert_id!, 'accepted') }}
                                title="Accetta e ignora"
                              >
                                <Check className="h-2.5 w-2.5" /> Accetta
                              </button>
                              <button
                                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-red-100 hover:bg-red-200 text-red-700 transition-colors"
                                onClick={(e) => { e.stopPropagation(); onMarkAsRead(notification.id); onAlertAction(notification.alert_id!, 'blocked') }}
                                title="Blocca studente"
                              >
                                <Ban className="h-2.5 w-2.5" /> Blocca
                              </button>
                            </>
                          )}
                        </div>
                      )}

                      {/* Quiz Details */}
                      {hasQuizDetails && notification.quiz_answers && (
                        <div className="mt-2 pl-5 space-y-1.5 border-t pt-2">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-semibold text-gray-600">
                              Risultato: {notification.quiz_score?.correct || 0}/{notification.quiz_score?.total || notification.quiz_answers.length}
                            </span>
                          </div>
                          {notification.quiz_answers.map((answer, idx) => (
                            <div key={idx} className="text-[10px] space-y-0.5">
                              <div className="flex items-start gap-1">
                                {answer.is_correct ? (
                                  <CheckCircle2 className="h-2.5 w-2.5 text-green-500 mt-0.5 shrink-0" />
                                ) : (
                                  <XCircle className="h-2.5 w-2.5 text-red-500 mt-0.5 shrink-0" />
                                )}
                                <p className="text-gray-700 font-medium leading-tight">
                                  Q{answer.question_index + 1}: {answer.question_text}
                                </p>
                              </div>
                              <div className="pl-3.5">
                                <p className={answer.is_correct ? 'text-green-600' : 'text-red-600'}>
                                  <span className="font-medium">Risposta:</span> {answer.student_answer}
                                </p>
                                {!answer.is_correct && (
                                  <p className="text-green-600">
                                    <span className="font-medium">Corretta:</span> {answer.correct_answer}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
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
