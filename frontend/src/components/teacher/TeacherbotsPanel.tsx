import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Plus, Bot, Settings, Eye, Trash2, Globe, FileText, Loader2 } from 'lucide-react'
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

export default function TeacherbotsPanel() {
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
      draft: 'bg-slate-100 text-slate-600',
      testing: 'bg-amber-100 text-amber-700',
      published: 'bg-green-100 text-green-700',
      archived: 'bg-gray-100 text-gray-500',
    }
    const labels: Record<string, string> = {
      draft: 'Bozza',
      testing: 'In test',
      published: 'Pubblicato',
      archived: 'Archiviato',
    }
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[status] || styles.draft}`}>
        {labels[status] || status}
      </span>
    )
  }

  const getColorClass = (color: string) => {
    const colorMap: Record<string, string> = {
      indigo: 'bg-indigo-500',
      blue: 'bg-blue-500',
      green: 'bg-green-500',
      red: 'bg-red-500',
      purple: 'bg-purple-500',
      pink: 'bg-pink-500',
      orange: 'bg-orange-500',
      teal: 'bg-teal-500',
      cyan: 'bg-cyan-500',
    }
    return colorMap[color] || 'bg-indigo-500'
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-bold text-slate-800">I tuoi Teacherbots</h2>
          <p className="text-sm text-slate-500">Crea assistenti AI personalizzati per i tuoi studenti</p>
        </div>
        <Button onClick={() => setViewMode('create')} className="bg-indigo-600 hover:bg-indigo-700">
          <Plus className="h-4 w-4 mr-2" />
          Nuovo Teacherbot
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        </div>
      ) : teacherbots && teacherbots.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {teacherbots.map((bot) => (
            <div
              key={bot.id}
              className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-lg hover:border-indigo-200 transition-all group"
            >
              <div className="flex items-start gap-3 mb-3">
                <div className={`w-10 h-10 rounded-lg ${getColorClass(bot.color)} flex items-center justify-center flex-shrink-0`}>
                  <Bot className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-slate-800 truncate">{bot.name}</h3>
                    {getStatusBadge(bot.status)}
                  </div>
                  <p className="text-sm text-slate-500 truncate">{bot.synopsis || 'Nessuna descrizione'}</p>
                </div>
              </div>

              <div className="flex items-center gap-4 text-xs text-slate-400 mb-4">
                {bot.is_proactive && (
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                    Proattivo
                  </span>
                )}
                {bot.enable_reporting && (
                  <span className="flex items-center gap-1">
                    <FileText className="h-3 w-3" />
                    Report
                  </span>
                )}
                {bot.publication_count > 0 && (
                  <span className="flex items-center gap-1">
                    <Globe className="h-3 w-3" />
                    {bot.publication_count} classi
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 pt-3 border-t border-slate-100">
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50"
                  onClick={() => handleEdit(bot.id)}
                >
                  <Settings className="h-4 w-4 mr-1" />
                  Modifica
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50"
                  onClick={() => handleTest(bot.id)}
                >
                  <Eye className="h-4 w-4 mr-1" />
                  Testa
                </Button>
                {bot.enable_reporting && bot.conversation_count > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 text-slate-600 hover:text-indigo-600 hover:bg-indigo-50"
                    onClick={() => handleReports(bot.id)}
                  >
                    <FileText className="h-4 w-4 mr-1" />
                    Report
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-slate-400 hover:text-red-600 hover:bg-red-50"
                  onClick={() => handleDelete(bot.id, bot.name)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center mb-4">
            <Bot className="h-8 w-8 text-indigo-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-800 mb-2">Nessun Teacherbot</h3>
          <p className="text-sm text-slate-500 mb-4 max-w-md">
            Crea il tuo primo assistente AI personalizzato per interagire con gli studenti.
          </p>
          <Button onClick={() => setViewMode('create')} className="bg-indigo-600 hover:bg-indigo-700">
            <Plus className="h-4 w-4 mr-2" />
            Crea il tuo primo Teacherbot
          </Button>
        </div>
      )}
    </div>
  )
}
