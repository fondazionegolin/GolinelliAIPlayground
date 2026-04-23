import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, BookOpen, Trash2, Loader2, FileCode2, Sparkles, X, Search,
} from 'lucide-react'
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

const PYTHON_STYLES = {
  card: 'bg-indigo-50/80 border border-indigo-200/70 hover:border-indigo-300/80 hover:bg-indigo-50',
  iconBg: 'bg-indigo-100',
  icon: 'text-indigo-700',
  badge: 'bg-indigo-200 text-indigo-700',
}
const P5JS_STYLES = {
  card: 'bg-emerald-50/80 border border-emerald-200/70 hover:border-emerald-300/80 hover:bg-emerald-50',
  iconBg: 'bg-emerald-100',
  icon: 'text-emerald-700',
  badge: 'bg-emerald-200 text-emerald-700',
}

function NotebookCard({
  notebook,
  onOpen,
  onDelete,
  isDeleting,
}: {
  notebook: NotebookMeta
  onOpen: () => void
  onDelete: (e: React.MouseEvent) => void
  isDeleting: boolean
}) {
  const s = notebook.project_type === 'python' ? PYTHON_STYLES : P5JS_STYLES

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      onClick={onOpen}
      className={`aspect-square relative cursor-pointer rounded-2xl shadow-sm transition-all flex flex-col items-center justify-center p-4 backdrop-blur-sm ${s.card} group`}
    >
      {/* Delete button */}
      <button
        onClick={onDelete}
        disabled={isDeleting}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all"
        title="Elimina"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      <div className={`w-11 h-11 rounded-xl ${s.iconBg} ${s.icon} flex items-center justify-center mb-2.5`}>
        {notebook.project_type === 'python'
          ? <FileCode2 className="h-6 w-6" />
          : <Sparkles className="h-6 w-6" />}
      </div>

      <span className="text-xs font-semibold leading-tight text-center text-slate-800 line-clamp-2 px-1">
        {notebook.title}
      </span>

      <span className="text-[10px] text-slate-400 mt-1.5">
        {formatDistanceToNow(new Date(notebook.updated_at), { addSuffix: true, locale: it })}
      </span>
    </motion.div>
  )
}

export default function NotebookListPage({ onOpen }: Props = {}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newProjectType, setNewProjectType] = useState<NotebookProjectType>('python')

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

  const filtered = useMemo(() => {
    if (!notebooks) return { python: [], p5js: [] }
    const q = search.toLowerCase()
    const all = q ? notebooks.filter(n => n.title.toLowerCase().includes(q)) : notebooks
    return {
      python: all.filter(n => n.project_type === 'python'),
      p5js:   all.filter(n => n.project_type === 'p5js'),
    }
  }, [notebooks, search])

  const totalCount = (notebooks?.length ?? 0)

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center p-12">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
          <Loader2 className="h-8 w-8 text-slate-300" />
        </motion.div>
      </div>
    )
  }

  if (!notebooks || totalCount === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-12 text-center">
        <div className="w-20 h-20 rounded-full bg-slate-100 flex items-center justify-center mb-6">
          <BookOpen className="h-10 w-10 text-slate-300" />
        </div>
        <h3 className="text-xl font-bold text-slate-800 mb-2">Nessun notebook ancora</h3>
        <p className="text-slate-500 max-w-sm text-sm">
          Crea il tuo primo notebook Python o sketch p5.js
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="mt-6 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          Crea notebook
        </button>

        <AnimatePresence>
          {showCreate && (
            <CreateDialog
              newTitle={newTitle}
              setNewTitle={setNewTitle}
              newProjectType={newProjectType}
              setNewProjectType={setNewProjectType}
              onCreate={handleCreate}
              onCancel={() => setShowCreate(false)}
              isPending={createMutation.isPending}
            />
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col relative overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 md:p-6 pb-24">
        <div className="max-w-3xl mx-auto">

          {/* Header row */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-700">I miei Notebook</h2>
              <p className="text-xs text-slate-400">Python e p5.js</p>
            </div>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors shadow-sm"
            >
              <Plus className="h-3.5 w-3.5" />
              Nuovo
            </button>
          </div>

          {/* Search */}
          <div className="relative mb-5">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Cerca notebook..."
              className="w-full pl-9 pr-8 py-2 text-sm bg-white/80 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-300 placeholder:text-slate-400"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Python section */}
          {filtered.python.length > 0 && (
            <Section
              title="Python"
              icon={<FileCode2 className="h-3.5 w-3.5 text-indigo-600" />}
              iconBg="bg-indigo-50"
              notebooks={filtered.python}
              onOpen={openNotebook}
              onDelete={(id) => { if (confirm('Eliminare questo notebook?')) deleteMutation.mutate(id) }}
              isDeleting={deleteMutation.isPending}
            />
          )}

          {/* p5.js section */}
          {filtered.p5js.length > 0 && (
            <Section
              title="p5.js"
              icon={<Sparkles className="h-3.5 w-3.5 text-emerald-600" />}
              iconBg="bg-emerald-50"
              notebooks={filtered.p5js}
              onOpen={openNotebook}
              onDelete={(id) => { if (confirm('Eliminare questo sketch?')) deleteMutation.mutate(id) }}
              isDeleting={deleteMutation.isPending}
            />
          )}

          {search && filtered.python.length === 0 && filtered.p5js.length === 0 && (
            <p className="text-center text-sm text-slate-400 py-8">
              Nessun notebook corrisponde a &ldquo;{search}&rdquo;
            </p>
          )}
        </div>
      </div>

      {/* Create dialog */}
      <AnimatePresence>
        {showCreate && (
          <CreateDialog
            newTitle={newTitle}
            setNewTitle={setNewTitle}
            newProjectType={newProjectType}
            setNewProjectType={setNewProjectType}
            onCreate={handleCreate}
            onCancel={() => setShowCreate(false)}
            isPending={createMutation.isPending}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function Section({
  title, icon, iconBg, notebooks, onOpen, onDelete, isDeleting,
}: {
  title: string
  icon: React.ReactNode
  iconBg: string
  notebooks: NotebookMeta[]
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  isDeleting: boolean
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-5 h-5 rounded-md ${iconBg} flex items-center justify-center`}>{icon}</div>
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide">{title}</h3>
        <span className="text-xs text-slate-400">({notebooks.length})</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {notebooks.map(nb => (
          <NotebookCard
            key={nb.id}
            notebook={nb}
            onOpen={() => onOpen(nb.id)}
            onDelete={(e) => { e.stopPropagation(); onDelete(nb.id) }}
            isDeleting={isDeleting}
          />
        ))}
      </div>
    </div>
  )
}

function CreateDialog({
  newTitle, setNewTitle, newProjectType, setNewProjectType, onCreate, onCancel, isPending,
}: {
  newTitle: string
  setNewTitle: (v: string) => void
  newProjectType: NotebookProjectType
  setNewProjectType: (v: NotebookProjectType) => void
  onCreate: () => void
  onCancel: () => void
  isPending: boolean
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="w-full max-w-sm bg-white rounded-2xl shadow-2xl border border-white/40 p-5"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">Nuovo notebook</h3>
          <button onClick={onCancel} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Type selector */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {([
            { value: 'python' as const, label: 'Python', desc: 'Celle eseguibili', icon: <FileCode2 className="h-4 w-4" />, active: 'border-indigo-500 bg-indigo-50', inactive: 'border-slate-200 hover:border-slate-300' },
            { value: 'p5js' as const, label: 'p5.js', desc: 'Sketch creativi', icon: <Sparkles className="h-4 w-4" />, active: 'border-emerald-500 bg-emerald-50', inactive: 'border-slate-200 hover:border-slate-300' },
          ] as const).map(opt => (
            <button
              key={opt.value}
              onClick={() => setNewProjectType(opt.value)}
              className={`rounded-xl border px-3 py-2.5 text-left transition ${newProjectType === opt.value ? opt.active : opt.inactive}`}
            >
              <div className={`flex items-center gap-1.5 mb-0.5 ${newProjectType === opt.value ? (opt.value === 'python' ? 'text-indigo-700' : 'text-emerald-700') : 'text-slate-600'}`}>
                {opt.icon}
                <span className="text-sm font-semibold">{opt.label}</span>
              </div>
              <p className="text-xs text-slate-400">{opt.desc}</p>
            </button>
          ))}
        </div>

        {/* Title input */}
        <input
          type="text"
          autoFocus
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onCreate()}
          placeholder={newProjectType === 'python' ? 'es. Analisi dati vendite' : 'es. Simulazione fisica'}
          className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none mb-3"
        />

        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 px-3 py-2 rounded-xl text-sm text-slate-600 hover:bg-slate-100 transition-colors"
          >
            Annulla
          </button>
          <button
            onClick={onCreate}
            disabled={isPending}
            className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-2 rounded-xl text-sm font-semibold disabled:opacity-50 transition-colors"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Crea'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
