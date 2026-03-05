import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Plus, Bot, Settings, Eye, Trash2, FileText, Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { teacherbotsApi } from '@/lib/api'
import TeacherbotForm from './TeacherbotForm'
import TeacherbotTestChat from './TeacherbotTestChat'
import TeacherbotReportsPanel from './TeacherbotReportsPanel'

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
}

export default function TeacherbotsPanel({ onOpenSettings }: TeacherbotsPanelProps = {}) {
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

  const getColorClass = (color: string) => {
    const colorMap: Record<string, string> = {
      indigo: 'bg-[#181b1e]',
      blue: 'bg-blue-500',
      green: 'bg-green-500',
      red: 'bg-red-500',
      purple: 'bg-purple-500',
      pink: 'bg-pink-500',
      orange: 'bg-orange-500',
      teal: 'bg-teal-500',
      cyan: 'bg-cyan-500',
    }
    return colorMap[color] || 'bg-[#181b1e]'
  }

  if (viewMode === 'create') {
    return <TeacherbotForm onBack={handleBack} onSaved={handleSaved} />
  }

  if (viewMode === 'edit' && selectedBot) {
    return <TeacherbotForm teacherbotId={selectedBot} onBack={handleBack} onSaved={handleSaved} />
  }

  if (viewMode === 'test' && selectedBot) {
    return <TeacherbotTestChat teacherbotId={selectedBot} onBack={handleBack} />
  }

  if (viewMode === 'reports' && selectedBot) {
    return <TeacherbotReportsPanel teacherbotId={selectedBot} onBack={handleBack} />
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-bold text-slate-800">I tuoi Teacherbots</h2>
          <p className="text-xs text-slate-500">Assistenti personalizzati per la classe</p>
        </div>
        <Button onClick={() => setViewMode('create')} size="sm" className="bg-[#181b1e] hover:bg-[#0f1113] h-8 px-3 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1.5" />
          Nuovo
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[#181b1e]" />
        </div>
      ) : teacherbots && teacherbots.length > 0 ? (
        <div className="space-y-2 px-1">
          {teacherbots.map((bot) => (
            <div
              key={bot.id}
              className="rounded-xl border border-slate-200 bg-white/70 p-3 hover:border-[#181b1e]/25 hover:bg-white transition-all group"
            >
              <div className="flex items-center gap-2.5">
                <div className={`w-9 h-9 rounded-xl ${getColorClass(bot.color)} flex items-center justify-center flex-shrink-0 shadow-sm`}>
                  <Bot className="h-4.5 w-4.5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="font-semibold text-sm text-slate-800 truncate">{bot.name}</span>
                    {getStatusBadge(bot.status)}
                  </div>
                  <p className="text-[11px] text-slate-400 leading-tight line-clamp-2">
                    {bot.synopsis || 'Nessuna descrizione'}
                  </p>
                </div>
                <button
                  className="h-7 w-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-[#181b1e] hover:bg-slate-100 transition-colors flex-shrink-0"
                  onClick={() => handleEdit(bot.id)}
                  title="Configura"
                >
                  <Settings className="h-3.5 w-3.5" />
                </button>
              </div>
              {/* Secondary actions */}
              <div className="flex items-center gap-1 mt-2 pt-2 border-t border-slate-100">
                <button
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-slate-500 hover:text-[#181b1e] hover:bg-slate-100 transition-colors"
                  onClick={() => handleTest(bot.id)}
                >
                  <Eye className="h-3 w-3" />
                  Test
                </button>
                {bot.enable_reporting && bot.conversation_count > 0 && (
                  <button
                    className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-slate-500 hover:text-[#181b1e] hover:bg-slate-100 transition-colors"
                    onClick={() => handleReports(bot.id)}
                  >
                    <FileText className="h-3 w-3" />
                    Report
                  </button>
                )}
                <button
                  className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md text-[11px] text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                  onClick={() => handleDelete(bot.id, bot.name)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 rounded-full bg-[#181b1e]/10 flex items-center justify-center mb-4">
            <Bot className="h-8 w-8 text-[#181b1e]" />
          </div>
          <h3 className="text-lg font-semibold text-slate-800 mb-2">Nessun Teacherbot</h3>
          <p className="text-sm text-slate-500 mb-4 max-w-md">
            Crea il tuo primo assistente AI personalizzato per interagire con gli studenti.
          </p>
          <Button onClick={() => setViewMode('create')} className="bg-[#181b1e] hover:bg-[#0f1113]">
            <Plus className="h-4 w-4 mr-2" />
            Crea il tuo primo Teacherbot
          </Button>
        </div>
      )}
    </div>
  )
}
