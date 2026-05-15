import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, BookOpen, Trash2, Loader2, FileCode2, Sparkles, X, Search,
} from 'lucide-react'
import { notebooksApi } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'
import { enUS, it } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'
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
  card: 'border border-slate-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/30',
  iconBg: 'bg-indigo-50',
  icon: 'text-indigo-700',
  badge: 'border border-indigo-200 bg-indigo-50 text-indigo-700',
}
const P5JS_STYLES = {
  card: 'border border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30',
  iconBg: 'bg-emerald-50',
  icon: 'text-emerald-700',
  badge: 'border border-emerald-200 bg-emerald-50 text-emerald-700',
}

function NotebookCard({
  notebook,
  onOpen,
  onDelete,
  isDeleting,
  isEnglish,
}: {
  notebook: NotebookMeta
  onOpen: () => void
  onDelete: (e: React.MouseEvent) => void
  isDeleting: boolean
  isEnglish: boolean
}) {
  const s = notebook.project_type === 'python' ? PYTHON_STYLES : P5JS_STYLES

  return (
    <motion.div
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.97 }}
      onClick={onOpen}
      className={`group relative flex min-h-[132px] cursor-pointer flex-col justify-between rounded-lg p-4 text-left transition-all ${s.card}`}
    >
      {/* Delete button */}
      <button
        onClick={onDelete}
        disabled={isDeleting}
        className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-1 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all"
        title={isEnglish ? 'Delete' : 'Elimina'}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${s.iconBg} ${s.icon}`}>
        {notebook.project_type === 'python'
          ? <FileCode2 className="h-6 w-6" />
          : <Sparkles className="h-6 w-6" />}
      </div>

      <div className="min-w-0">
        <span className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">
          {notebook.title}
        </span>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.badge}`}>
            {notebook.project_type === 'python' ? 'Python' : 'p5.js'}
          </span>
          <span className="text-[10px] text-slate-400">
            {formatDistanceToNow(new Date(notebook.updated_at), { addSuffix: true, locale: isEnglish ? enUS : it })}
          </span>
        </div>
      </div>
    </motion.div>
  )
}

export default function NotebookListPage({ onOpen }: Props = {}) {
  const { i18n } = useTranslation()
  const isEnglish = i18n.resolvedLanguage?.startsWith('en') ?? false
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
      title: newTitle.trim() || (newProjectType === 'python'
        ? (isEnglish ? 'New Python Notebook' : 'Nuovo Notebook Python')
        : (isEnglish ? 'New p5.js Sketch' : 'Nuovo Sketch p5.js')),
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
      <div className="flex h-full flex-col items-center justify-center p-12 text-center">
        <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-xl bg-slate-100">
          <BookOpen className="h-10 w-10 text-slate-300" />
        </div>
        <h3 className="text-xl font-bold text-slate-800 mb-2">{isEnglish ? 'No notebooks yet' : 'Nessun notebook ancora'}</h3>
        <p className="max-w-md text-sm leading-6 text-slate-500">
          {isEnglish
            ? 'Create a Python or p5.js notebook to work step by step: write a cell, run it, inspect the output, and ask the Socratic AI tutor to guide you with questions and hints.'
            : 'Crea un notebook Python o p5.js per lavorare a piccoli passi: scrivi una cella, esegui, osserva l\'output e chiedi al tutor AI socratico di guidarti con domande e indizi.'}
        </p>
        <button
          onClick={() => setShowCreate(true)}
          className="mt-6 flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          {isEnglish ? 'Create notebook' : 'Crea notebook'}
        </button>

        <AnimatePresence>
          {showCreate && (
              <CreateDialog
                newTitle={newTitle}
                setNewTitle={setNewTitle}
                newProjectType={newProjectType}
                setNewProjectType={setNewProjectType}
                isEnglish={isEnglish}
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
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 pb-24 pt-0 md:px-6 md:pb-8 md:pt-0">
        <div className="w-full">
          <section className="mb-4 overflow-hidden border-b border-slate-200 bg-white">
            <div className="grid gap-0 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
              <div className="p-5 md:p-6">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Notebook</p>
                <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-950">
                  {isEnglish ? 'Code, output, and a Socratic AI tutor' : 'Codice, output e tutor AI socratico'}
                </h2>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
                  {isEnglish
                    ? 'Work through controlled experiments: write Python or p5.js code in cells, run it, inspect the output, and use the tutor to understand errors, alternatives, and next steps without getting the full solution immediately.'
                    : 'Lavora per tentativi controllati: scrivi codice in celle Python o p5.js, esegui, osserva l\'output e usa il tutor per capire errori, alternative e prossimi passi senza ricevere subito la soluzione completa.'}
                </p>
                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  {[
                    isEnglish
                      ? ['1', 'Write a cell', 'Draft a hypothesis or minimal code.']
                      : ['1', 'Scrivi una cella', 'Formula ipotesi o codice minimo.'],
                    isEnglish
                      ? ['2', 'Run and inspect', 'Read the output, error, or preview.']
                      : ['2', 'Esegui e osserva', 'Leggi output, errore o preview.'],
                    isEnglish
                      ? ['3', 'Ask the tutor', 'Get guiding questions and targeted hints.']
                      : ['3', 'Chiedi al tutor', 'Ricevi domande guida e indizi mirati.'],
                  ].map(([step, label, text]) => (
                    <div key={step} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="flex items-center gap-2">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">{step}</span>
                        <span className="text-xs font-bold text-slate-900">{label}</span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-500">{text}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border-t border-slate-200 bg-slate-50 p-5 lg:border-l lg:border-t-0">
                <div className="flex h-full flex-col justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{isEnglish ? 'Available' : 'Disponibili'}</p>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <FileCode2 className="h-4 w-4 text-indigo-700" />
                        <p className="mt-2 text-sm font-bold text-indigo-950">Python</p>
                        <p className="mt-1 text-xs text-indigo-800/70">{isEnglish ? 'Analysis, logic, data.' : 'Analisi, logica, dati.'}</p>
                      </div>
                      <div className="rounded-lg border border-slate-200 bg-white p-3">
                        <Sparkles className="h-4 w-4 text-emerald-700" />
                        <p className="mt-2 text-sm font-bold text-emerald-950">p5.js</p>
                        <p className="mt-1 text-xs text-emerald-800/70">{isEnglish ? 'Sketches and creativity.' : 'Sketch e creativita.'}</p>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowCreate(true)}
                    className="flex items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800"
                  >
                    <Plus className="h-4 w-4" />
                    {isEnglish ? 'New notebook' : 'Nuovo notebook'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={isEnglish ? 'Search notebooks...' : 'Cerca notebook...'}
              className="w-full rounded-lg border border-slate-200 bg-white/90 py-2 pl-9 pr-8 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300"
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
              onDelete={(id) => { if (confirm(isEnglish ? 'Delete this notebook?' : 'Eliminare questo notebook?')) deleteMutation.mutate(id) }}
              isEnglish={isEnglish}
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
              onDelete={(id) => { if (confirm(isEnglish ? 'Delete this sketch?' : 'Eliminare questo sketch?')) deleteMutation.mutate(id) }}
              isEnglish={isEnglish}
              isDeleting={deleteMutation.isPending}
            />
          )}

          {search && filtered.python.length === 0 && filtered.p5js.length === 0 && (
            <p className="text-center text-sm text-slate-400 py-8">
              {isEnglish ? `No notebook matches "${search}"` : `Nessun notebook corrisponde a "${search}"`}
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
            isEnglish={isEnglish}
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
  title, icon, iconBg, notebooks, onOpen, onDelete, isDeleting, isEnglish,
}: {
  title: string
  icon: React.ReactNode
  iconBg: string
  notebooks: NotebookMeta[]
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  isDeleting: boolean
  isEnglish: boolean
}) {
  return (
      <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-5 h-5 rounded-md ${iconBg} flex items-center justify-center`}>{icon}</div>
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide">{title}</h3>
        <span className="text-xs text-slate-400">({notebooks.length})</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {notebooks.map(nb => (
          <NotebookCard
            key={nb.id}
            notebook={nb}
            onOpen={() => onOpen(nb.id)}
            onDelete={(e) => { e.stopPropagation(); onDelete(nb.id) }}
            isDeleting={isDeleting}
            isEnglish={isEnglish}
          />
        ))}
      </div>
    </div>
  )
}

function CreateDialog({
  newTitle, setNewTitle, newProjectType, setNewProjectType, onCreate, onCancel, isPending, isEnglish,
}: {
  newTitle: string
  setNewTitle: (v: string) => void
  newProjectType: NotebookProjectType
  setNewProjectType: (v: NotebookProjectType) => void
  onCreate: () => void
  onCancel: () => void
  isPending: boolean
  isEnglish: boolean
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
        className="w-full max-w-sm rounded-xl border border-white/40 bg-white p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-800">{isEnglish ? 'New notebook' : 'Nuovo notebook'}</h3>
          <button onClick={onCancel} className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Type selector */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {([
            { value: 'python' as const, label: 'Python', desc: isEnglish ? 'Runnable cells' : 'Celle eseguibili', icon: <FileCode2 className="h-4 w-4" />, active: 'border-indigo-500 bg-indigo-50', inactive: 'border-slate-200 hover:border-slate-300' },
            { value: 'p5js' as const, label: 'p5.js', desc: isEnglish ? 'Creative sketches' : 'Sketch creativi', icon: <Sparkles className="h-4 w-4" />, active: 'border-emerald-500 bg-emerald-50', inactive: 'border-slate-200 hover:border-slate-300' },
          ] as const).map(opt => (
            <button
              key={opt.value}
              onClick={() => setNewProjectType(opt.value)}
	              className={`rounded-lg border px-3 py-2.5 text-left transition ${newProjectType === opt.value ? opt.active : opt.inactive}`}
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
          placeholder={newProjectType === 'python'
            ? (isEnglish ? 'e.g. Sales data analysis' : 'es. Analisi dati vendite')
            : (isEnglish ? 'e.g. Physics simulation' : 'es. Simulazione fisica')}
	          className="mb-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-indigo-500"
        />

        <div className="flex gap-2">
          <button
            onClick={onCancel}
	            className="flex-1 rounded-lg px-3 py-2 text-sm text-slate-600 transition-colors hover:bg-slate-100"
          >
            {isEnglish ? 'Cancel' : 'Annulla'}
          </button>
          <button
            onClick={onCreate}
            disabled={isPending}
	            className="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : (isEnglish ? 'Create' : 'Crea')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
