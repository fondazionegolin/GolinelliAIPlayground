import { lazy, Suspense, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Plus, Settings, Eye, Trash2, FileText, Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { teacherbotsApi } from '@/lib/api'
import TeacherbotForm from './TeacherbotForm'
import TeacherbotReportsPanel from './TeacherbotReportsPanel'
const ChatbotModule = lazy(() => import('@/pages/student/ChatbotModule'))

interface Teacherbot {
  id: string
  name: string
  synopsis: string | null
  icon: string
  color: string
  status: string
  is_proactive: boolean
  enable_reporting: boolean
  created_at: string
  updated_at: string
  publication_count: number
  conversation_count: number
}

type ViewMode = 'list' | 'create' | 'edit' | 'test' | 'reports'

interface TeacherbotsPanelProps {
  /** Called when the user clicks the settings button on a bot.
   *  If provided the panel won't switch to edit view internally. */
  onOpenSettings?: (botId: string) => void
  /** Called when the user wants to create a new bot.
   *  If provided the panel won't switch to create view internally. */
  onCreateNew?: () => void
}

export default function TeacherbotsPanel({ onOpenSettings, onCreateNew }: TeacherbotsPanelProps = {}) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [selectedBot, setSelectedBot] = useState<string | null>(null)

  const { data: teacherbots, isLoading } = useQuery({
    queryKey: ['teacherbots'],
    queryFn: async () => {
      const res = await teacherbotsApi.list()
      return res.data as Teacherbot[]
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => teacherbotsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teacherbots'] })
      toast({ title: 'Teacherbot eliminato' })
    },
    onError: () => {
      toast({ title: 'Errore', description: 'Impossibile eliminare il teacherbot', variant: 'destructive' })
    },
  })

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Eliminare il teacherbot "${name}"? Questa azione non può essere annullata.`)) {
      deleteMutation.mutate(id)
    }
  }

  const handleEdit = (id: string) => {
    if (onOpenSettings) {
      onOpenSettings(id)
      return
    }
    setSelectedBot(id)
    setViewMode('edit')
  }

  const handleTest = (id: string) => {
    setSelectedBot(id)
    setViewMode('test')
  }

  const handleReports = (id: string) => {
    setSelectedBot(id)
    setViewMode('reports')
  }

  const handleBack = () => {
    setViewMode('list')
    setSelectedBot(null)
  }

  const handleSaved = () => {
    queryClient.invalidateQueries({ queryKey: ['teacherbots'] })
    setViewMode('list')
    setSelectedBot(null)
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      draft: 'bg-slate-100/50 text-slate-600 border-slate-200',
      testing: 'bg-amber-100/50 text-amber-700 border-amber-200',
      published: 'bg-green-100/50 text-green-700 border-green-200',
      archived: 'bg-gray-100/50 text-gray-500 border-gray-200',
    }
    const labels: Record<string, string> = {
      draft: 'Bozza',
      testing: 'In test',
      published: 'Pubblicato',
      archived: 'Archiviato',
    }
    return (
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border backdrop-blur-sm ${styles[status] || styles.draft}`}>
        {labels[status] || status}
      </span>
    )
  }

  const getCardBg = (color: string) => {
    const colorMap: Record<string, string> = {
      indigo: 'bg-indigo-50 border-indigo-100 hover:border-indigo-200',
      blue: 'bg-blue-50 border-blue-100 hover:border-blue-200',
      green: 'bg-emerald-50 border-emerald-100 hover:border-emerald-200',
      red: 'bg-red-50 border-red-100 hover:border-red-200',
      purple: 'bg-purple-50 border-purple-100 hover:border-purple-200',
      pink: 'bg-pink-50 border-pink-100 hover:border-pink-200',
      orange: 'bg-orange-50 border-orange-100 hover:border-orange-200',
      teal: 'bg-teal-50 border-teal-100 hover:border-teal-200',
      cyan: 'bg-cyan-50 border-cyan-100 hover:border-cyan-200',
    }
    return colorMap[color] || 'bg-slate-50 border-slate-100 hover:border-slate-200'
  }

  const getIconColor = (color: string) => {
    const colorMap: Record<string, string> = {
      indigo: 'text-indigo-400 hover:text-indigo-700 hover:bg-indigo-100',
      blue: 'text-blue-400 hover:text-blue-700 hover:bg-blue-100',
      green: 'text-emerald-400 hover:text-emerald-700 hover:bg-emerald-100',
      red: 'text-red-400 hover:text-red-700 hover:bg-red-100',
      purple: 'text-purple-400 hover:text-purple-700 hover:bg-purple-100',
      pink: 'text-pink-400 hover:text-pink-700 hover:bg-pink-100',
      orange: 'text-orange-400 hover:text-orange-700 hover:bg-orange-100',
      teal: 'text-teal-400 hover:text-teal-700 hover:bg-teal-100',
      cyan: 'text-cyan-400 hover:text-cyan-700 hover:bg-cyan-100',
    }
    return colorMap[color] || 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
  }

  if (viewMode === 'create') {
    return <TeacherbotForm onBack={handleBack} onSaved={handleSaved} />
  }

  if (viewMode === 'edit' && selectedBot) {
    return <TeacherbotForm teacherbotId={selectedBot} onBack={handleBack} onSaved={handleSaved} />
  }

  if (viewMode === 'test' && selectedBot) {
    return (
      <div className="h-full flex flex-col">
        <div className="flex items-center gap-2 mb-2 flex-shrink-0">
          <button onClick={handleBack} className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 transition-colors">
            ← Indietro
          </button>
          <span className="text-xs text-slate-400">Anteprima studente</span>
        </div>
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={
            <div className="flex h-full items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
            </div>
          }>
            <ChatbotModule
              sessionId="teacher-preview"
              initialTeacherbotId={selectedBot}
              isTeacherPreview={true}
            />
          </Suspense>
        </div>
      </div>
    )
  }

  if (viewMode === 'reports' && selectedBot) {
    return <TeacherbotReportsPanel teacherbotId={selectedBot} onBack={handleBack} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-center mb-3">
        <Button onClick={() => onCreateNew ? onCreateNew() : setViewMode('create')} className="bg-[#181b1e] hover:bg-[#0f1113] h-10 w-10 p-0 rounded-full" title="Nuovo teacherbot">
          <Plus className="h-5 w-5" />
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[#181b1e]" />
        </div>
      ) : teacherbots && teacherbots.length > 0 ? (
        <div className="space-y-2 px-1 py-1">
          {teacherbots.map((bot) => (
            <div
              key={bot.id}
              className={`rounded-xl border p-3.5 transition-all ${getCardBg(bot.color)}`}
            >
              {/* Status badge */}
              <div className="mb-1.5">{getStatusBadge(bot.status)}</div>
              {/* Name */}
              <p className="font-semibold text-sm text-slate-800 truncate leading-tight">{bot.name}</p>
              {/* Description */}
              <p className="text-[11px] text-slate-500 leading-snug line-clamp-2 mt-0.5">
                {bot.synopsis || 'Nessuna descrizione'}
              </p>
              {/* Action icons */}
              <div className="flex items-center gap-1 mt-2.5">
                <button
                  className={`h-7 w-7 flex items-center justify-center rounded-lg transition-colors ${getIconColor(bot.color)}`}
                  onClick={() => handleEdit(bot.id)}
                  title="Configura"
                >
                  <Settings className="h-3.5 w-3.5" />
                </button>
                <button
                  className={`h-7 w-7 flex items-center justify-center rounded-lg transition-colors ${getIconColor(bot.color)}`}
                  onClick={() => handleTest(bot.id)}
                  title="Testa"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
                {bot.enable_reporting && bot.conversation_count > 0 && (
                  <button
                    className={`h-7 w-7 flex items-center justify-center rounded-lg transition-colors ${getIconColor(bot.color)}`}
                    onClick={() => handleReports(bot.id)}
                    title="Report"
                  >
                    <FileText className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  className="ml-auto h-7 w-7 flex items-center justify-center rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                  onClick={() => handleDelete(bot.id, bot.name)}
                  title="Elimina"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 rounded-full bg-[#181b1e]/10 flex items-center justify-center mb-4">
            <Settings className="h-8 w-8 text-[#181b1e]" />
          </div>
          <h3 className="text-lg font-semibold text-slate-800 mb-2">Nessun Teacherbot</h3>
          <p className="text-sm text-slate-500 mb-4 max-w-md">
            Crea il tuo primo assistente AI personalizzato per interagire con gli studenti.
          </p>
          <Button onClick={() => onCreateNew ? onCreateNew() : setViewMode('create')} className="bg-[#181b1e] hover:bg-[#0f1113]">
            <Plus className="h-4 w-4 mr-2" />
            Crea il tuo primo Teacherbot
          </Button>
        </div>
      )}
    </div>
  )
}
