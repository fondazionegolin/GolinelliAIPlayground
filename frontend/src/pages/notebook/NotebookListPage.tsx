import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowLeft, BookOpen, CheckCircle, ChevronDown, ChevronUp, Cpu, FileCode2, Gamepad2, Layers3, Loader2, Music2, Plus, Share2, Sparkles, Trash2, X,
} from 'lucide-react'
import { notebooksApi, teacherApi, type NotebookAssignment } from '@/lib/api'
import { formatDistanceToNow } from 'date-fns'
import { enUS, it } from 'date-fns/locale'
import { useTranslation } from 'react-i18next'
import { Button } from '@/design/primitives/Button'
import type { NotebookProjectType } from '@/components/notebook/types'
import { useAuthStore } from '@/stores/auth'
import {
  WorkspaceExplorerBadge,
  WorkspaceExplorerHeader,
  WorkspaceExplorerItem,
  WorkspaceExplorerList,
  WorkspaceExplorerSidebar,
} from '@/components/WorkspaceExplorerSidebar'

interface NotebookMeta {
  id: string
  title: string
  project_type: NotebookProjectType
  cell_count: number
  created_at: string
  updated_at: string
}

type NotebookTemplate = {
  key: string
  projectType: NotebookProjectType
  title: string
  titleEn: string
  description: string
  descriptionEn: string
  chips: string[]
}

interface Props {
  /** If provided, called instead of navigate() — used in non-router contexts (student dashboard) */
  onOpen?: (notebookId: string) => void
  onBack?: () => void
}

const NOTEBOOK_STYLES: Record<NotebookProjectType, {
  card: string
  iconBg: string
  icon: string
  badge: string
  panel: string
  section: string
}> = {
  python: {
    card: 'border-[rgba(123,105,201,0.18)] bg-[rgba(123,105,201,0.075)] hover:border-[rgba(123,105,201,0.30)] hover:bg-[rgba(123,105,201,0.11)]',
    iconBg: 'bg-indigo-100 ring-1 ring-indigo-200',
    icon: 'text-indigo-700',
    badge: 'border border-indigo-200 bg-indigo-100 text-indigo-800',
    panel: 'border-indigo-200 bg-indigo-50/80 text-indigo-950',
    section: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  },
  p5js: {
    card: 'border-[rgba(62,169,244,0.18)] bg-[rgba(62,169,244,0.075)] hover:border-[rgba(62,169,244,0.30)] hover:bg-[rgba(62,169,244,0.11)]',
    iconBg: 'bg-emerald-100 ring-1 ring-emerald-200',
    icon: 'text-emerald-700',
    badge: 'border border-emerald-200 bg-emerald-100 text-emerald-800',
    panel: 'border-emerald-200 bg-emerald-50/80 text-emerald-950',
    section: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  strudel: {
    card: 'border-[rgba(123,105,201,0.18)] bg-[rgba(123,105,201,0.075)] hover:border-[rgba(123,105,201,0.30)] hover:bg-[rgba(123,105,201,0.11)]',
    iconBg: 'bg-violet-100 ring-1 ring-violet-200',
    icon: 'text-violet-700',
    badge: 'border border-violet-200 bg-violet-100 text-violet-800',
    panel: 'border-violet-200 bg-violet-50/80 text-violet-950',
    section: 'border-violet-200 bg-violet-50 text-violet-700',
  },
  game2d: {
    card: 'border-[rgba(254,0,77,0.18)] bg-[rgba(254,0,77,0.075)] hover:border-[rgba(254,0,77,0.28)] hover:bg-[rgba(254,0,77,0.11)]',
    iconBg: 'bg-cyan-100 ring-1 ring-cyan-200',
    icon: 'text-cyan-700',
    badge: 'border border-cyan-200 bg-cyan-100 text-cyan-800',
    panel: 'border-cyan-200 bg-cyan-50/80 text-cyan-950',
    section: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  },
  microbit: {
    card: 'border-[rgba(14,165,233,0.20)] bg-[rgba(14,165,233,0.08)] hover:border-[rgba(14,165,233,0.34)] hover:bg-[rgba(14,165,233,0.13)]',
    iconBg: 'bg-sky-100 ring-1 ring-sky-200',
    icon: 'text-sky-700',
    badge: 'border border-sky-200 bg-sky-100 text-sky-800',
    panel: 'border-sky-200 bg-sky-50/80 text-sky-950',
    section: 'border-sky-200 bg-sky-50 text-sky-700',
  },
  circuitplayground: {
    card: 'border-[rgba(16,185,129,0.20)] bg-[rgba(16,185,129,0.08)] hover:border-[rgba(16,185,129,0.34)] hover:bg-[rgba(16,185,129,0.13)]',
    iconBg: 'bg-emerald-100 ring-1 ring-emerald-200',
    icon: 'text-emerald-700',
    badge: 'border border-emerald-200 bg-emerald-100 text-emerald-800',
    panel: 'border-emerald-200 bg-emerald-50/80 text-emerald-950',
    section: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
}

const PROJECT_ORDER: NotebookProjectType[] = ['python', 'microbit', 'circuitplayground', 'p5js']

const READY_TEMPLATES: NotebookTemplate[] = [
  {
    key: 'python-data-detective',
    projectType: 'python',
    title: 'Detective dei dati',
    titleEn: 'Data detective',
    description: 'Dashboard testuale con dataset generato, barre, correlazione e previsione.',
    descriptionEn: 'Text dashboard with generated data, bars, correlation, and prediction.',
    chips: ['dati', 'grafici testuali', 'previsione'],
  },
  {
    key: 'microbit-mission-control',
    projectType: 'microbit',
    title: 'Mission Control micro:bit',
    titleEn: 'micro:bit Mission Control',
    description: 'Sensori, display LED, musica e cruscotto seriale in un solo esempio.',
    descriptionEn: 'Sensors, LED display, music, and serial dashboard in one example.',
    chips: ['sensori', 'LED', 'musica'],
  },
  {
    key: 'circuitplayground-sensor-party',
    projectType: 'circuitplayground',
    title: 'Sensor Party',
    titleEn: 'Sensor Party',
    description: 'NeoPixel animati da luce, suono, temperatura, accelerazione e gesture.',
    descriptionEn: 'NeoPixels driven by light, sound, temperature, acceleration, and gestures.',
    chips: ['NeoPixel', 'suono', 'gesture'],
  },
  {
    key: 'p5js-galaxy',
    projectType: 'p5js',
    title: 'Galassia interattiva',
    titleEn: 'Interactive galaxy',
    description: 'Animazione p5.js con stelle, orbite e parametri controllati dal mouse.',
    descriptionEn: 'p5.js animation with stars, orbits, and mouse-controlled parameters.',
    chips: ['animazione', 'mouse', 'visual'],
  },
]

function ProjectIcon({ type, className }: { type: NotebookProjectType; className: string }) {
  if (type === 'python') return <FileCode2 className={className} />
  if (type === 'microbit') return <Cpu className={className} />
  if (type === 'circuitplayground') return <Cpu className={className} />
  if (type === 'strudel') return <Music2 className={className} />
  if (type === 'game2d') return <Gamepad2 className={className} />
  return <Sparkles className={className} />
}

function getProjectLabel(type: NotebookProjectType) {
  if (type === 'python') return 'Python'
  if (type === 'microbit') return 'micro:bit'
  if (type === 'circuitplayground') return 'Circuit Playground'
  if (type === 'strudel') return 'Strudel'
  if (type === 'game2d') return 'Game 2D'
  return 'p5.js'
}

function getProjectDescription(type: NotebookProjectType, isEnglish: boolean) {
  if (type === 'python') return isEnglish ? 'Analysis, logic, data, experiments.' : 'Analisi, logica, dati, esperimenti.'
  if (type === 'microbit') return isEnglish ? 'Python or JavaScript for a connected micro:bit.' : 'Python o JavaScript per micro:bit collegata.'
  if (type === 'circuitplayground') return isEnglish ? 'MakeCode TypeScript for Circuit Playground Express.' : 'MakeCode TypeScript per Circuit Playground Express.'
  if (type === 'strudel') return isEnglish ? 'Music, rhythm, live coding.' : 'Musica, ritmo, live coding.'
  if (type === 'game2d') return isEnglish ? 'Schema-driven 2D games with Phaser.' : 'Giochi 2D a schema JSON con Phaser.'
  return isEnglish ? 'Creative sketches and simulations.' : 'Sketch creativi e simulazioni.'
}

function formatNotebookCount(count: number, isEnglish: boolean) {
  if (isEnglish) return count === 1 ? '1 notebook' : `${count} notebooks`
  return count === 1 ? '1 notebook' : `${count} notebook`
}

function formatCellCount(count: number, isEnglish: boolean) {
  if (isEnglish) return count === 1 ? '1 cell' : `${count} cells`
  return count === 1 ? '1 cella' : `${count} celle`
}

function NotebookCard({
  notebook,
  onOpen,
  onDelete,
  onAssign,
  isDeleting,
  isEnglish,
}: {
  notebook: NotebookMeta
  onOpen: () => void
  onDelete: (e: React.MouseEvent) => void
  onAssign?: (e: React.MouseEvent) => void
  isDeleting: boolean
  isEnglish: boolean
}) {
  const s = NOTEBOOK_STYLES[notebook.project_type]
  const updatedLabel = formatDistanceToNow(new Date(notebook.updated_at), { addSuffix: true, locale: isEnglish ? enUS : it })

  return (
    <motion.div
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      onClick={onOpen}
      className={`group relative flex min-h-[156px] cursor-pointer flex-col justify-between overflow-hidden rounded-[24px] border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${s.card}`}
    >
      <button
        onClick={onDelete}
        disabled={isDeleting}
        className="absolute right-2 top-2 rounded-lg p-1 text-slate-400 opacity-70 transition-all hover:bg-red-50 hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
        title={isEnglish ? 'Delete' : 'Elimina'}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {onAssign && (
        <button
          onClick={onAssign}
          className="absolute right-10 top-2 rounded-lg p-1 text-slate-400 opacity-70 transition-all hover:bg-indigo-50 hover:text-indigo-600 sm:opacity-0 sm:group-hover:opacity-100"
          title={isEnglish ? 'Assign to a session' : 'Assegna a una sessione'}
        >
          <Share2 className="h-3.5 w-3.5" />
        </button>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-lg ${s.iconBg} ${s.icon}`}>
          <ProjectIcon type={notebook.project_type} className="h-6 w-6" />
        </div>
        <span className={`mr-5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${s.badge}`}>
          {getProjectLabel(notebook.project_type)}
        </span>
      </div>

      <div className="mt-5 min-w-0">
        <span className="line-clamp-2 text-base font-extrabold leading-tight text-slate-950">
          {notebook.title}
        </span>
        <div className="mt-4 flex items-center justify-between gap-3 border-t-2 border-slate-300/90 pt-3">
          <span className="text-xs font-semibold text-slate-500">
            {formatCellCount(notebook.cell_count, isEnglish)}
          </span>
          <span className="truncate text-right text-xs text-slate-500">
            {updatedLabel}
          </span>
        </div>
      </div>
    </motion.div>
  )
}

export default function NotebookListPage({ onOpen, onBack }: Props = {}) {
  const { i18n } = useTranslation()
  const isEnglish = i18n.resolvedLanguage?.startsWith('en') ?? false
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newProjectType, setNewProjectType] = useState<NotebookProjectType>('python')
  const [templatesOpen, setTemplatesOpen] = useState(false)
  const [shareNotebook, setShareNotebook] = useState<NotebookMeta | null>(null)
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const studentSession = useAuthStore((state) => state.studentSession)
  const isStudent = Boolean(studentSession)

  const openNotebook = (id: string) => onOpen ? onOpen(id) : navigate(`notebook/${id}`)

  const { data: notebooks, isLoading } = useQuery({
    queryKey: ['notebooks'],
    queryFn: async () => {
      const res = await notebooksApi.list()
      return res.data as NotebookMeta[]
    },
  })

  const { data: assignments = [] } = useQuery({
    queryKey: ['notebook-assignments'],
    queryFn: async () => (await notebooksApi.listAssignments()).data,
  })

  const { data: sessionOptions = [] } = useQuery({
    queryKey: ['notebook-assignment-sessions'],
    enabled: !isStudent && Boolean(shareNotebook),
    queryFn: async () => {
      const classes = (await teacherApi.getClasses()).data as { id: string; name: string }[]
      const groups = await Promise.all(classes.map(async (class_) => ({
        class_,
        sessions: (await teacherApi.getSessions(class_.id)).data as { id: string; title?: string; name?: string }[],
      })))
      return groups.flatMap(({ class_, sessions }) => sessions.map(session => ({
        id: session.id,
        label: `${class_.name} · ${session.title || session.name || 'Sessione'}`,
      })))
    },
  })

  const createMutation = useMutation({
    mutationFn: ({ title, projectType, templateKey }: { title: string; projectType: NotebookProjectType; templateKey?: string }) =>
      notebooksApi.create(title, projectType, templateKey),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['notebooks'] })
      openNotebook(res.data.id)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => notebooksApi.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notebooks'] }),
  })

  const assignMutation = useMutation({
    mutationFn: () => notebooksApi.assign(shareNotebook!.id, selectedSessionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notebook-assignments'] })
      setShareNotebook(null)
      setSelectedSessionId('')
    },
  })

  const forkMutation = useMutation({
    mutationFn: (assignmentId: string) => notebooksApi.forkAssignment(assignmentId),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['notebooks'] })
      queryClient.invalidateQueries({ queryKey: ['notebook-assignments'] })
      openNotebook(res.data.notebook_id)
    },
  })

  const handleCreate = () => {
    const defaultTitle = newProjectType === 'python'
      ? (isEnglish ? 'New Python Notebook' : 'Nuovo Notebook Python')
      : newProjectType === 'microbit'
        ? (isEnglish ? 'New micro:bit Notebook' : 'Nuovo Notebook micro:bit')
      : newProjectType === 'circuitplayground'
        ? (isEnglish ? 'New Circuit Playground Notebook' : 'Nuovo Notebook Circuit Playground')
      : newProjectType === 'strudel'
        ? (isEnglish ? 'New Strudel Sketch' : 'Nuovo Sketch Strudel')
        : newProjectType === 'game2d'
          ? (isEnglish ? 'New 2D Game' : 'Nuovo Gioco 2D')
          : (isEnglish ? 'New p5.js Sketch' : 'Nuovo Sketch p5.js')
    createMutation.mutate({
      title: newTitle.trim() || defaultTitle,
      projectType: newProjectType,
    })
    setNewTitle('')
    setNewProjectType('python')
    setShowCreate(false)
  }

  const handleCreateFromTemplate = (template: NotebookTemplate) => {
    createMutation.mutate({
      title: isEnglish ? template.titleEn : template.title,
      projectType: template.projectType,
      templateKey: template.key,
    })
  }

  const filtered = useMemo(() => {
    if (!notebooks) return { python: [], microbit: [], circuitplayground: [], p5js: [], game2d: [], strudel: [] }
    const q = search.toLowerCase()
    const all = q ? notebooks.filter(n => n.title.toLowerCase().includes(q)) : notebooks
    return {
      python:  all.filter(n => n.project_type === 'python'),
      microbit: all.filter(n => n.project_type === 'microbit'),
      circuitplayground: all.filter(n => n.project_type === 'circuitplayground'),
      p5js:    all.filter(n => n.project_type === 'p5js'),
      game2d:  [],
      strudel: [],
    }
  }, [notebooks, search])

  const totalCount = notebooks
    ? notebooks.filter(n => PROJECT_ORDER.includes(n.project_type)).length
    : 0
  const visibleCount = filtered.python.length + filtered.microbit.length + filtered.circuitplayground.length + filtered.p5js.length
  const visibleNotebooks = PROJECT_ORDER.flatMap((type) => filtered[type])

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-50 p-12">
        <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
          <Loader2 className="h-8 w-8 text-slate-300" />
        </motion.div>
      </div>
    )
  }

  if ((!notebooks || totalCount === 0) && !(isStudent && assignments.length > 0)) {
    return (
      <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-slate-100 lg:flex-row">
        <WorkspaceExplorerSidebar>
          <WorkspaceExplorerHeader
            eyebrow={isStudent ? (isEnglish ? 'Student workspace' : 'Spazio studente') : (isEnglish ? 'Teacher panel' : 'Pannello docente')}
            title="Coding Lab"
            description={isEnglish ? 'Notebooks and coding projects in one explorer.' : 'Notebook e progetti di coding in un unico explorer.'}
            action={(
              <Button
                type="button"
                onClick={() => setShowCreate(true)}
                density="compact"
                tone="accent"
                surface="solid"
                className="h-9 w-9 shrink-0 rounded-full p-0"
                title={isEnglish ? 'New notebook' : 'Nuovo notebook'}
                aria-label={isEnglish ? 'New notebook' : 'Nuovo notebook'}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            )}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder={isEnglish ? 'Search notebooks...' : 'Cerca notebook...'}
            clearSearchLabel={isEnglish ? 'Clear notebook search' : 'Cancella ricerca notebook'}
          />
          <WorkspaceExplorerList>
            <p className="px-2 py-8 text-center text-xs leading-5 text-slate-400">
              {isEnglish ? 'No notebooks yet.' : 'Nessun notebook ancora.'}
            </p>
          </WorkspaceExplorerList>
        </WorkspaceExplorerSidebar>
        <main className="relative min-w-0 flex-1 overflow-y-auto bg-slate-50">
          {onBack && <NotebookBackButton isEnglish={isEnglish} onBack={onBack} className="absolute left-4 top-4 z-10" />}
        <section className="flex min-h-full items-center justify-center px-4 py-10 text-center md:px-6">
          <div className="w-full max-w-4xl">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
              <BookOpen className="h-9 w-9 text-indigo-500" />
            </div>
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Coding Lab</p>
            <h3 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              {isEnglish ? 'Start with a clear workspace' : 'Parti da uno spazio di lavoro chiaro'}
            </h3>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              {isEnglish
                ? 'Choose Python for analysis, micro:bit or Circuit Playground for connected physical computing, or p5.js for visual sketches. Each notebook keeps code, outputs, previews, and tutor help together.'
                : 'Scegli Python per analisi, micro:bit o Circuit Playground per physical computing collegato, oppure p5.js per sketch visuali. Ogni notebook tiene insieme codice, output, preview e supporto del tutor.'}
            </p>

            <PrimaryCreateButton
              isEnglish={isEnglish}
              onClick={() => setShowCreate(true)}
              className="mt-7"
            />

            <ReadyTemplateGallery
              templates={READY_TEMPLATES}
              isEnglish={isEnglish}
              onCreate={handleCreateFromTemplate}
              isPending={createMutation.isPending}
              open={templatesOpen}
              onToggle={() => setTemplatesOpen(value => !value)}
              className="mt-8"
            />

            <div className="mt-8 grid gap-3 md:grid-cols-4">
              {PROJECT_ORDER.map(type => (
                <ProjectSummary
                  key={type}
                  type={type}
                  count={0}
                  isEnglish={isEnglish}
                  showCount={false}
                />
              ))}
            </div>
          </div>
        </section>

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
        </main>
      </div>
    )
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-slate-100 lg:flex-row">
      <WorkspaceExplorerSidebar>
        <WorkspaceExplorerHeader
          eyebrow={isStudent ? (isEnglish ? 'Student workspace' : 'Spazio studente') : (isEnglish ? 'Teacher panel' : 'Pannello docente')}
          title="Coding Lab"
          description={isEnglish ? 'Notebooks and coding projects in one explorer.' : 'Notebook e progetti di coding in un unico explorer.'}
          action={(
            <Button
              type="button"
              onClick={() => setShowCreate(true)}
              density="compact"
              tone="accent"
              surface="solid"
              className="h-9 w-9 shrink-0 rounded-full p-0"
              title={isEnglish ? 'New notebook' : 'Nuovo notebook'}
              aria-label={isEnglish ? 'New notebook' : 'Nuovo notebook'}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={isEnglish ? 'Search notebooks...' : 'Cerca notebook...'}
          clearSearchLabel={isEnglish ? 'Clear notebook search' : 'Cancella ricerca notebook'}
        />
        <WorkspaceExplorerList>
          {visibleNotebooks.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs leading-5 text-slate-400">
              {search
                ? (isEnglish ? `No notebook matches “${search}”.` : `Nessun notebook corrisponde a “${search}”.`)
                : (isEnglish ? 'No notebooks yet.' : 'Nessun notebook ancora.')}
            </p>
          ) : (
            <div className="space-y-2">
              {visibleNotebooks.map((notebook) => (
                <WorkspaceExplorerItem
                  key={notebook.id}
                  icon={<ProjectIcon type={notebook.project_type} className="h-4 w-4" />}
                  title={notebook.title}
                  subtitle={getProjectLabel(notebook.project_type)}
                  onClick={() => openNotebook(notebook.id)}
                  badges={(
                    <>
                      <WorkspaceExplorerBadge>{formatCellCount(notebook.cell_count, isEnglish)}</WorkspaceExplorerBadge>
                      <WorkspaceExplorerBadge>{formatDistanceToNow(new Date(notebook.updated_at), { addSuffix: true, locale: isEnglish ? enUS : it })}</WorkspaceExplorerBadge>
                    </>
                  )}
                  trailing={(
                    <button
                      type="button"
                      disabled={deleteMutation.isPending}
                      onClick={() => { if (confirm(isEnglish ? 'Delete this notebook?' : 'Eliminare questo notebook?')) deleteMutation.mutate(notebook.id) }}
                      className="flex w-10 items-center justify-center border-l border-white/70 text-slate-400 hover:bg-red-50/80 hover:text-red-600"
                      aria-label={`${isEnglish ? 'Delete' : 'Elimina'} ${notebook.title}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                />
              ))}
            </div>
          )}
        </WorkspaceExplorerList>
      </WorkspaceExplorerSidebar>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-4 py-7 md:px-6 md:py-8">
            {onBack && <NotebookBackButton isEnglish={isEnglish} onBack={onBack} className="mb-4" />}
            <div className="mx-auto max-w-3xl text-center">
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">Coding Lab</p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                {isEnglish ? 'Build, run, understand' : 'Scrivi, esegui, capisci'}
              </h2>
              <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              {isEnglish
                  ? 'One focused place for code, outputs, connected boards, previews, and tutor hints. Pick the right format and keep every experiment easy to find.'
                  : 'Un posto ordinato per codice, output, schede collegate, preview e indizi del tutor. Scegli il formato giusto e ritrova subito ogni esperimento.'}
              </p>
              <PrimaryCreateButton
                isEnglish={isEnglish}
                onClick={() => setShowCreate(true)}
                className="mt-6"
              />
            </div>

            <ReadyTemplateGallery
              templates={READY_TEMPLATES}
              isEnglish={isEnglish}
              onCreate={handleCreateFromTemplate}
              isPending={createMutation.isPending}
              open={templatesOpen}
              onToggle={() => setTemplatesOpen(value => !value)}
              className="mt-7"
            />
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-4 pb-24 pt-5 md:px-6 md:pb-8">
          {isStudent && assignments.length > 0 && (
            <section className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50/70 p-4">
              <div className="mb-3">
                <h3 className="text-sm font-extrabold text-indigo-950">
                  {isEnglish ? 'Assigned by your teacher' : 'Assegnati dal docente'}
                </h3>
                <p className="mt-1 text-xs text-indigo-700">
                  {isEnglish ? 'Open your private copy. The teacher template will not change.' : 'Apri la tua copia privata: il template del docente non verrà modificato.'}
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {(assignments as NotebookAssignment[]).map(assignment => (
                  <div key={assignment.id} className="rounded-xl border border-indigo-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-extrabold text-slate-950">{assignment.title}</p>
                        <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">{assignment.project_type}</p>
                      </div>
                      {assignment.submitted_at && <CheckCircle className="h-4 w-4 shrink-0 text-emerald-500" />}
                    </div>
                    <Button
                      type="button"
                      tone="accent"
                      surface="soft"
                      density="compact"
                      className="mt-4 w-full"
                      disabled={forkMutation.isPending}
                      onClick={() => assignment.fork_notebook_id ? openNotebook(assignment.fork_notebook_id) : forkMutation.mutate(assignment.id)}
                    >
                      {assignment.fork_notebook_id
                        ? (isEnglish ? 'Open my copy' : 'Apri la mia copia')
                        : (isEnglish ? 'Create my copy' : 'Crea la mia copia')}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                <Layers3 className="h-4 w-4 text-slate-500" />
                <span>{search ? formatNotebookCount(visibleCount, isEnglish) : formatNotebookCount(totalCount, isEnglish)}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {isEnglish
                  ? 'Grouped by language so the workspace is easier to scan.'
                  : 'Raggruppati per linguaggio, così lo spazio è più facile da leggere.'}
              </p>
            </div>

          </div>

          {filtered.python.length > 0 && (
            <Section
              type="python"
              notebooks={filtered.python}
              onOpen={openNotebook}
              onDelete={(id) => { if (confirm(isEnglish ? 'Delete this notebook?' : 'Eliminare questo notebook?')) deleteMutation.mutate(id) }}
              onAssign={!isStudent ? (notebook) => setShareNotebook(notebook) : undefined}
              isEnglish={isEnglish}
              isDeleting={deleteMutation.isPending}
            />
          )}

          {filtered.microbit.length > 0 && (
            <Section
              type="microbit"
              notebooks={filtered.microbit}
              onOpen={openNotebook}
              onDelete={(id) => { if (confirm(isEnglish ? 'Delete this micro:bit notebook?' : 'Eliminare questo notebook micro:bit?')) deleteMutation.mutate(id) }}
              onAssign={!isStudent ? (notebook) => setShareNotebook(notebook) : undefined}
              isEnglish={isEnglish}
              isDeleting={deleteMutation.isPending}
            />
          )}

          {filtered.circuitplayground.length > 0 && (
            <Section
              type="circuitplayground"
              notebooks={filtered.circuitplayground}
              onOpen={openNotebook}
              onDelete={(id) => { if (confirm(isEnglish ? 'Delete this Circuit Playground notebook?' : 'Eliminare questo notebook Circuit Playground?')) deleteMutation.mutate(id) }}
              onAssign={!isStudent ? (notebook) => setShareNotebook(notebook) : undefined}
              isEnglish={isEnglish}
              isDeleting={deleteMutation.isPending}
            />
          )}

          {filtered.p5js.length > 0 && (
            <Section
              type="p5js"
              notebooks={filtered.p5js}
              onOpen={openNotebook}
              onDelete={(id) => { if (confirm(isEnglish ? 'Delete this sketch?' : 'Eliminare questo sketch?')) deleteMutation.mutate(id) }}
              onAssign={!isStudent ? (notebook) => setShareNotebook(notebook) : undefined}
              isEnglish={isEnglish}
              isDeleting={deleteMutation.isPending}
            />
          )}

          {filtered.game2d.length > 0 && (
            <Section
              type="game2d"
              notebooks={filtered.game2d}
              onOpen={openNotebook}
              onDelete={(id) => { if (confirm(isEnglish ? 'Delete this 2D game?' : 'Eliminare questo gioco 2D?')) deleteMutation.mutate(id) }}
              onAssign={!isStudent ? (notebook) => setShareNotebook(notebook) : undefined}
              isEnglish={isEnglish}
              isDeleting={deleteMutation.isPending}
            />
          )}

          {filtered.strudel.length > 0 && (
            <Section
              type="strudel"
              notebooks={filtered.strudel}
              onOpen={openNotebook}
              onDelete={(id) => { if (confirm(isEnglish ? 'Delete this sketch?' : 'Eliminare questo sketch?')) deleteMutation.mutate(id) }}
              onAssign={!isStudent ? (notebook) => setShareNotebook(notebook) : undefined}
              isEnglish={isEnglish}
              isDeleting={deleteMutation.isPending}
            />
          )}

          {search && visibleCount === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-10 text-center">
              <p className="text-sm font-semibold text-slate-700">
                {isEnglish ? `No notebook matches "${search}"` : `Nessun notebook corrisponde a "${search}"`}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {isEnglish ? 'Try a shorter title fragment.' : 'Prova con una parte più breve del titolo.'}
              </p>
            </div>
          )}
        </div>
      </main>

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

      {shareNotebook && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" onMouseDown={() => setShareNotebook(null)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onMouseDown={event => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-black text-slate-950">{isEnglish ? 'Assign notebook' : 'Assegna notebook'}</h3>
                <p className="mt-1 text-sm text-slate-500">{shareNotebook.title}</p>
              </div>
              <button className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" onClick={() => setShareNotebook(null)}><X className="h-4 w-4" /></button>
            </div>
            <p className="mt-4 text-xs leading-5 text-slate-600">
              {isEnglish ? 'Students receive an independent copy of this exact version.' : 'Gli studenti riceveranno una copia indipendente di questa versione esatta.'}
            </p>
            <select
              value={selectedSessionId}
              onChange={event => setSelectedSessionId(event.target.value)}
              className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-indigo-200"
            >
              <option value="">{isEnglish ? 'Choose a session…' : 'Scegli una sessione…'}</option>
              {sessionOptions.map(session => <option key={session.id} value={session.id}>{session.label}</option>)}
            </select>
            <Button
              type="button"
              tone="accent"
              surface="solid"
              className="mt-5 w-full"
              disabled={!selectedSessionId || assignMutation.isPending}
              onClick={() => assignMutation.mutate()}
            >
              {assignMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
              {isEnglish ? 'Publish this version' : 'Pubblica questa versione'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function NotebookBackButton({
  isEnglish,
  onBack,
  className = '',
}: {
  isEnglish: boolean
  onBack: () => void
  className?: string
}) {
  return (
    <Button
      type="button"
      tone="neutral"
      surface="soft"
      density="compact"
      onClick={onBack}
      className={className}
      title={isEnglish ? 'Back' : 'Indietro'}
    >
      <ArrowLeft className="h-4 w-4" />
      <span>{isEnglish ? 'Back' : 'Indietro'}</span>
    </Button>
  )
}

function ReadyTemplateGallery({
  templates,
  isEnglish,
  onCreate,
  isPending,
  open,
  onToggle,
  className = '',
}: {
  templates: NotebookTemplate[]
  isEnglish: boolean
  onCreate: (template: NotebookTemplate) => void
  isPending: boolean
  open: boolean
  onToggle: () => void
  className?: string
}) {
  return (
    <section className={className}>
      <button type="button" onClick={onToggle} className="mx-auto flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-extrabold text-amber-800 transition hover:bg-amber-100">
          <Sparkles className="h-3.5 w-3.5" />
          <span>{isEnglish ? 'Ready-made examples' : 'Modelli pronti'}</span>
          {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {open && <p className="mx-auto mt-2 max-w-2xl text-center text-xs leading-5 text-slate-500">
          {isEnglish
            ? 'Start from a working, editable example that already shows the main features.'
            : 'Parti da un esempio funzionante e modificabile che mostra subito le funzionalità principali.'}
      </p>}

      {open && <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {templates.map(template => {
          const s = NOTEBOOK_STYLES[template.projectType]
          return (
            <button
              key={template.key}
              type="button"
              disabled={isPending}
              onClick={() => onCreate(template)}
              className={`group flex min-h-[188px] flex-col justify-between rounded-lg border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg disabled:cursor-wait disabled:opacity-70 ${s.card}`}
            >
              <div>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${s.iconBg} ${s.icon}`}>
                    <ProjectIcon type={template.projectType} className="h-5 w-5" />
                  </span>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${s.badge}`}>
                    {getProjectLabel(template.projectType)}
                  </span>
                </div>
                <h3 className="text-sm font-black leading-tight text-slate-950">
                  {isEnglish ? template.titleEn : template.title}
                </h3>
                <p className="mt-2 text-xs leading-5 text-slate-600">
                  {isEnglish ? template.descriptionEn : template.description}
                </p>
              </div>
              <div className="mt-4">
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {template.chips.map(chip => (
                    <span key={chip} className="rounded-full bg-white/75 px-2 py-1 text-[10px] font-bold text-slate-600 ring-1 ring-slate-200/70">
                      {chip}
                    </span>
                  ))}
                </div>
                <span className="inline-flex h-9 w-full items-center justify-center rounded-full border border-slate-300 bg-white/80 px-3 text-xs font-extrabold text-slate-700 transition group-hover:bg-white">
                  {isEnglish ? 'Use this model' : 'Usa questo modello'}
                </span>
              </div>
            </button>
          )
        })}
      </div>}
    </section>
  )
}

function PrimaryCreateButton({
  isEnglish,
  onClick,
  className = '',
}: {
  isEnglish: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <Button
      tone="accent"
      surface="solid"
      density="roomy"
      onClick={onClick}
      className={className}
    >
      <Plus className="h-4 w-4" />
      <span>{isEnglish ? 'New notebook' : 'Nuovo notebook'}</span>
    </Button>
  )
}

function ProjectSummary({
  type,
  count,
  isEnglish,
  showCount = true,
}: {
  type: NotebookProjectType
  count: number
  isEnglish: boolean
  showCount?: boolean
}) {
  const s = NOTEBOOK_STYLES[type]

  return (
    <div className={`rounded-lg border p-4 text-left shadow-sm ${s.panel}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`flex h-9 w-9 items-center justify-center rounded-lg bg-white/80 ${s.icon}`}>
            <ProjectIcon type={type} className="h-5 w-5" />
          </span>
          <span className="text-sm font-extrabold">{getProjectLabel(type)}</span>
        </div>
        {showCount && (
          <span className="rounded-full bg-white/75 px-2.5 py-1 text-[11px] font-bold">
            {count}
          </span>
        )}
      </div>
      <p className="mt-3 text-xs leading-5 text-slate-600">
        {getProjectDescription(type, isEnglish)}
      </p>
    </div>
  )
}

function Section({
  type, notebooks, onOpen, onDelete, onAssign, isDeleting, isEnglish,
}: {
  type: NotebookProjectType
  notebooks: NotebookMeta[]
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onAssign?: (notebook: NotebookMeta) => void
  isDeleting: boolean
  isEnglish: boolean
}) {
  const s = NOTEBOOK_STYLES[type]

  return (
    <section className="mb-7">
      <div className="mb-3">
        <div className="flex items-center gap-3">
          <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 ${s.section}`}>
            <ProjectIcon type={type} className="h-4 w-4" />
            <h3 className="text-xs font-extrabold uppercase tracking-wide">{getProjectLabel(type)}</h3>
            <span className="text-xs font-bold opacity-75">{notebooks.length}</span>
          </div>
        </div>
        <p className="mt-1.5 text-xs text-slate-500">
          {getProjectDescription(type, isEnglish)}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {notebooks.map(nb => (
          <NotebookCard
            key={nb.id}
            notebook={nb}
            onOpen={() => onOpen(nb.id)}
            onDelete={(e) => { e.stopPropagation(); onDelete(nb.id) }}
            onAssign={onAssign ? (e) => { e.stopPropagation(); onAssign(nb) } : undefined}
            isDeleting={isDeleting}
            isEnglish={isEnglish}
          />
        ))}
      </div>
    </section>
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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className="w-full max-w-lg rounded-lg border border-white/40 bg-white p-5 shadow-2xl"
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-black text-slate-900">{isEnglish ? 'New notebook' : 'Nuovo notebook'}</h3>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {isEnglish ? 'Choose the workspace type, then name it.' : 'Scegli il tipo di spazio, poi dagli un nome.'}
            </p>
          </div>
          <button onClick={onCancel} className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-4">
          {PROJECT_ORDER.map(type => {
            const s = NOTEBOOK_STYLES[type]
            const selected = newProjectType === type

            return (
            <button
              key={type}
              onClick={() => setNewProjectType(type)}
              className={`rounded-lg border px-3 py-3 text-left transition focus:outline-none focus:ring-2 focus:ring-indigo-200 ${
                selected ? `${s.panel} ring-2 ring-slate-900/10` : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className={`mb-1 flex items-center gap-1.5 ${selected ? s.icon : 'text-slate-600'}`}>
                <ProjectIcon type={type} className="h-4 w-4" />
                <span className="text-sm font-bold">{getProjectLabel(type)}</span>
              </div>
              <p className="text-xs leading-4 text-slate-500">{getProjectDescription(type, isEnglish)}</p>
            </button>
            )
          })}
        </div>

        <input
          type="text"
          autoFocus
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onCreate()}
          placeholder={newProjectType === 'python'
            ? (isEnglish ? 'e.g. Sales data analysis' : 'es. Analisi dati vendite')
            : newProjectType === 'microbit'
              ? (isEnglish ? 'e.g. Light sensor dashboard' : 'es. Cruscotto sensore luce')
            : newProjectType === 'circuitplayground'
              ? (isEnglish ? 'e.g. NeoPixel sensor compass' : 'es. Bussola con NeoPixel e sensori')
            : newProjectType === 'strudel'
              ? (isEnglish ? 'e.g. My first beat' : 'es. Il mio primo beat')
              : newProjectType === 'game2d'
                ? (isEnglish ? 'e.g. Forest platformer' : 'es. Platform nella foresta')
                : (isEnglish ? 'e.g. Physics simulation' : 'es. Simulazione fisica')}
          className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-transparent focus:ring-2 focus:ring-indigo-500"
        />

        <div className="flex gap-2">
          <Button
            tone="neutral"
            surface="ghost"
            onClick={onCancel}
            className="flex-1"
          >
            {isEnglish ? 'Cancel' : 'Annulla'}
          </Button>
          <Button
            tone="accent"
            surface="solid"
            onClick={onCreate}
            disabled={isPending}
            className="flex-1 font-extrabold"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : (isEnglish ? 'Create' : 'Crea')}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
