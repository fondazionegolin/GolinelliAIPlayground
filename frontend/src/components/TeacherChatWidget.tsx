import { useState, useEffect } from 'react'
import { MessageSquare, X, Loader2, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { teacherApi, chatApi } from '@/lib/api'
import ChatSidebar from '@/components/ChatSidebar'

interface Session {
  id: string
  title: string
  status: string
  class_name?: string 
}

interface TeacherChatWidgetProps {
  isOpen: boolean
  onClose: () => void
}

export function TeacherChatWidget({ isOpen, onClose }: TeacherChatWidgetProps) {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(localStorage.getItem('teacher_last_chat_session'))
  const [loading, setLoading] = useState(false)
  const [teacherProfile, setTeacherProfile] = useState<{id: string, name: string} | null>(null)

  useEffect(() => {
    if (isOpen) {
      loadSessions()
      loadProfile()
    }
  }, [isOpen])

  const loadProfile = async () => {
    try {
      const res = await teacherApi.getProfile()
      setTeacherProfile({
        id: res.data.id,
        name: `${res.data.first_name} ${res.data.last_name}`
      })
    } catch (e) { console.error(e) }
  }

  const loadSessions = async () => {
    setLoading(true)
    try {
      const classesRes = await teacherApi.getClasses()
      const classes = classesRes.data
      
      let allSessions: Session[] = []
      for (const cls of classes) {
        const sessionsRes = await teacherApi.getSessions(cls.id)
        const classSessions = sessionsRes.data.map((s: any) => ({
          ...s,
          class_name: cls.name
        }))
        allSessions = [...allSessions, ...classSessions]
      }
      setSessions(allSessions)
    } catch (e) {
      console.error("Failed to load sessions", e)
    } finally {
      setLoading(false)
    }
  }

  const handleSessionChange = (sessionId: string) => {
    setSelectedSessionId(sessionId)
    localStorage.setItem('teacher_last_chat_session', sessionId)
  }

  const handleClearChat = async () => {
    if (!selectedSessionId) return
    if (confirm('Sei sicuro di voler cancellare tutti i messaggi della chat pubblica di questa sessione?')) {
      try {
        await chatApi.clearSessionMessages(selectedSessionId)
        // Force refresh by toggling session selection or via ChatSidebar prop if available
        // For now, reloading session might be needed, or we rely on socket updates if implemented.
        // A simple hack is to reset selectedSessionId momentarily
        const current = selectedSessionId
        setSelectedSessionId(null)
        setTimeout(() => setSelectedSessionId(current), 100)
      } catch (e) {
        console.error("Failed to clear chat", e)
        alert('Errore durante la cancellazione della chat')
      }
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      
      {/* Sidebar */}
      <div className="relative w-full max-w-md h-full bg-white shadow-2xl animate-in slide-in-from-right duration-300 flex flex-col border-l border-slate-200">
        
        {/* Header */}
        <div className="p-4 border-b border-orange-100 bg-orange-50 flex items-center justify-between">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="bg-orange-100 p-2 rounded-lg shrink-0">
              <MessageSquare className="h-5 w-5 text-orange-600" />
            </div>
            <div className="flex-1 min-w-0">
              <label className="text-xs font-bold text-orange-800 uppercase tracking-wide block mb-1">
                Chat Classe
              </label>
              <select
                value={selectedSessionId || ''}
                onChange={(e) => handleSessionChange(e.target.value)}
                className="w-full bg-white border border-orange-200 rounded-md py-1.5 px-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-orange-500/20 cursor-pointer"
              >
                <option value="" disabled>Seleziona una sessione...</option>
                {sessions.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.class_name ? `${s.class_name} - ` : ''}{s.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-1 ml-2 shrink-0">
            {selectedSessionId && (
              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-red-50 hover:text-red-600" onClick={handleClearChat} title="Svuota chat">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-red-50 hover:text-red-500" onClick={onClose}>
              <X className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden relative bg-slate-50/50">
          {loading && sessions.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
              <Loader2 className="h-8 w-8 animate-spin text-orange-600" />
            </div>
          ) : selectedSessionId && teacherProfile ? (
            <ChatSidebar
              sessionId={selectedSessionId}
              userType="teacher"
              currentUserId={teacherProfile.id}
              currentUserName={teacherProfile.name}
              isMobileView={true} // Using mobile view to fit full height without double headers if any
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 p-8 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4">
                <MessageSquare className="h-8 w-8 text-slate-300" />
              </div>
              <h3 className="font-semibold text-slate-600 mb-1">Nessuna sessione selezionata</h3>
              <p className="text-sm">Seleziona una classe dal menu in alto per visualizzare la chat.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
