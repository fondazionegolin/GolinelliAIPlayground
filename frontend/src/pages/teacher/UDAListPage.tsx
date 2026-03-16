import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { udaApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { ArrowLeft, Plus, BookOpen, Loader2, Trash2, CheckCircle, Clock } from 'lucide-react'

interface Uda {
  id: string
  title: string
  status: string
  uda_phase: string
  children: { id: string }[]
  created_at: string
}

const PHASE_LABELS: Record<string, string> = {
  briefing: 'Briefing',
  kb: 'Knowledge Base',
  plan: 'Piano',
  generating: 'Generazione...',
  review: 'In revisione',
  published: 'Pubblicata',
}

export default function UDAListPage() {
  const { classId } = useParams<{ classId: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [newTitle, setNewTitle] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const { data: udas = [], isLoading } = useQuery<Uda[]>({
    queryKey: ['udas', classId],
    queryFn: async () => {
      const res = await udaApi.listUdas(classId!)
      return res.data
    },
    enabled: !!classId,
  })

  const createMutation = useMutation({
    mutationFn: () => udaApi.createUda(classId!, newTitle.trim()),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['udas', classId] })
      setNewTitle('')
      setShowCreate(false)
      navigate(`/teacher/classes/${classId}/uda/${res.data.id}`)
    },
    onError: () => toast({ title: 'Errore creazione UDA', variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (udaId: string) => udaApi.deleteUda(classId!, udaId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['udas', classId] }),
    onError: () => toast({ title: 'Errore eliminazione', variant: 'destructive' }),
  })

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => navigate(-1)} className="h-8 w-8 p-0">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Unità Didattiche</h1>
              <p className="text-sm text-slate-500 mt-0.5">Crea e gestisci le UDA della tua classe</p>
            </div>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Nuova UDA
          </Button>
        </div>

        <div className="space-y-4">
        {/* Create form */}
        {showCreate && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
            <h3 className="text-sm font-semibold text-slate-800">Nuova Unità Didattica</h3>
            <input
              autoFocus
              type="text"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--teacher-accent,#6366f1)]/30 focus:border-[var(--teacher-accent,#6366f1)] transition-colors"
              placeholder="Es: Il laghetto delle rane scomparse"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && newTitle.trim() && createMutation.mutate()}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => { setShowCreate(false); setNewTitle('') }}>
                Annulla
              </Button>
              <Button
                size="sm"
                disabled={!newTitle.trim() || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
                Crea
              </Button>
            </div>
          </div>
        )}

        {/* UDA list */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-slate-300" />
          </div>
        ) : udas.length === 0 && !showCreate ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-200 text-center py-16">
            <BookOpen className="h-10 w-10 mx-auto text-slate-300 mb-4" />
            <h3 className="font-semibold text-slate-600 mb-1">Nessuna UDA ancora</h3>
            <p className="text-sm text-slate-400 max-w-sm mx-auto mb-5">
              Un'Unità Didattica raggruppa documenti, quiz, esercizi e presentazioni in una cartella tematica per i tuoi studenti.
            </p>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Crea la prima UDA
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {udas.map(uda => (
              <div
                key={uda.id}
                className="bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
                onClick={() => navigate(`/teacher/classes/${classId}/uda/${uda.id}`)}
              >
                <div className="p-5 flex items-center gap-4">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    uda.status === 'published' ? 'bg-green-100' : 'bg-indigo-100'
                  }`}>
                    {uda.status === 'published'
                      ? <CheckCircle className="h-5 w-5 text-green-600" />
                      : <BookOpen className="h-5 w-5 text-indigo-600" />
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-800 truncate">{uda.title}</h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        uda.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {PHASE_LABELS[uda.uda_phase] || uda.uda_phase}
                      </span>
                      {uda.children.length > 0 && (
                        <span className="text-xs text-slate-400">{uda.children.length} contenuti</span>
                      )}
                      <span className="text-xs text-slate-300 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {new Date(uda.created_at).toLocaleDateString('it-IT')}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-slate-300 hover:text-red-400"
                    onClick={e => {
                      e.stopPropagation()
                      if (confirm('Eliminare questa UDA e tutti i suoi contenuti?')) {
                        deleteMutation.mutate(uda.id)
                      }
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  )
}
