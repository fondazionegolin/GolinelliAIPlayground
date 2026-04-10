import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, BookOpen, Trash2, Loader2, Clock, FileCode2, Sparkles } from 'lucide-react'
import { notebooksApi } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'
import { it } from 'date-fns/locale'
import type { NotebookProjectType } from '@/components/notebook/types'

interface NotebookMeta {
  id: string
  title: string
  project_type: NotebookProjectType
  cell_count: number
  created_at: string
  updated_at: string
}

interface Props {
  /** If provided, called instead of navigate() — used in non-router contexts (student dashboard) */
  onOpen?: (notebookId: string) => void
}

export default function NotebookListPage({ onOpen }: Props = {}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [newTitle, setNewTitle] = useState('')
  const [newProjectType, setNewProjectType] = useState<NotebookProjectType>('python')
  const [showCreate, setShowCreate] = useState(false)

  const openNotebook = (id: string) => onOpen ? onOpen(id) : navigate(`notebook/${id}`)

  const { data: notebooks, isLoading } = useQuery({
    queryKey: ['notebooks'],
    queryFn: async () => {
      const res = await notebooksApi.list()
      return res.data as NotebookMeta[]
    },
  })

  const createMutation = useMutation({
    mutationFn: ({ title, projectType }: { title: string; projectType: NotebookProjectType }) =>
      notebooksApi.create(title, projectType),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['notebooks'] })
      openNotebook(res.data.id)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => notebooksApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notebooks'] }),
  })

  const handleCreate = () => {
    createMutation.mutate({
      title: newTitle.trim() || (newProjectType === 'python' ? 'Nuovo Notebook Python' : 'Nuovo Sketch p5.js'),
      projectType: newProjectType,
    })
    setNewTitle('')
    setNewProjectType('python')
    setShowCreate(false)
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <FileCode2 className="h-6 w-6 text-indigo-600" />
            I miei Notebook
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Notebook Python e sketch p5.js con editor avanzato e tutor AI
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Nuovo notebook
        </button>
      </div>

      {/* Create dialog */}
      {showCreate && (
        <div className="mb-6 bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
          <p className="text-sm font-medium text-slate-700 mb-2">Titolo del notebook</p>
          <div className="mb-3 grid gap-2 md:grid-cols-2">
            {[
              {
                value: 'python' as const,
                title: 'Notebook Python',
                description: 'Celle eseguibili con Pyodide nel browser',
              },
              {
                value: 'p5js' as const,
                title: 'Sketch p5.js',
                description: 'Editor JavaScript creativo con preview affiancata',
              },
            ].map((option) => (
              <button
                key={option.value}
                onClick={() => setNewProjectType(option.value)}
                className={`rounded-xl border px-4 py-3 text-left transition ${
                  newProjectType === option.value
                    ? 'border-indigo-500 bg-indigo-50 shadow-sm'
                    : 'border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  {option.value === 'python' ? (
                    <FileCode2 className="h-4 w-4 text-indigo-600" />
                  ) : (
                    <Sparkles className="h-4 w-4 text-emerald-600" />
                  )}
                  <span className="text-sm font-semibold text-slate-800">{option.title}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">{option.description}</p>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              type="text"
              autoFocus
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="es. Analisi dati vendite"
              className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
            />
            <button
              onClick={handleCreate}
              disabled={createMutation.isPending}
              className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Crea'}
            </button>
            <button
              onClick={() => setShowCreate(false)}
              className="text-slate-500 hover:text-slate-700 px-3 py-2 rounded-lg text-sm transition-colors"
            >
              Annulla
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
        </div>
      ) : !notebooks || notebooks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
            <BookOpen className="h-8 w-8 text-indigo-400" />
          </div>
          <p className="text-slate-700 font-medium">Nessun notebook ancora</p>
          <p className="text-slate-400 text-sm mt-1">Crea il tuo primo notebook Python o sketch p5.js</p>
          <button
            onClick={() => setShowCreate(true)}
            className="mt-4 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <Plus className="h-4 w-4" />
            Crea notebook
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {notebooks.map(nb => (
            <div
              key={nb.id}
              className="group bg-white rounded-xl border border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer p-4 flex items-center gap-4"
              onClick={() => openNotebook(nb.id)}
            >
              <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center flex-shrink-0">
                {nb.project_type === 'python' ? (
                  <FileCode2 className="h-5 w-5 text-indigo-600" />
                ) : (
                  <Sparkles className="h-5 w-5 text-emerald-600" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-800 truncate">{nb.title}</p>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                    nb.project_type === 'python'
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'bg-emerald-50 text-emerald-700'
                  }`}>
                    {nb.project_type}
                  </span>
                  <span className="text-xs text-slate-400">
                    {nb.cell_count} {nb.cell_count === 1 ? 'cella' : 'celle'}
                  </span>
                  <span className="text-slate-300">·</span>
                  <span className="text-xs text-slate-400 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDistanceToNow(new Date(nb.updated_at), { addSuffix: true, locale: it })}
                  </span>
                </div>
              </div>
              <button
                onClick={e => {
                  e.stopPropagation()
                  if (confirm('Eliminare questo notebook?')) deleteMutation.mutate(nb.id)
                }}
                disabled={deleteMutation.isPending}
                className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-all p-1 rounded"
                title="Elimina"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
