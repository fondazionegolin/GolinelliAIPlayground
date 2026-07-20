import { lazy, Suspense, useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { formatDistanceToNow } from 'date-fns'
import { it } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { teacherbotsApi } from '@/lib/api'
import { resolveTeacherbotIcon } from '@/lib/teacherbotIcons'
import TeacherbotForm from '@/components/teacher/TeacherbotForm'
import TeacherbotReportsPanel from '@/components/teacher/TeacherbotReportsPanel'
import TeacherbotShareLinksModal from '@/components/teacher/TeacherbotShareLinksModal'
import TeacherbotShareModal from '@/components/teacher/TeacherbotShareModal'
import {
  Bot, Plus, Settings, Eye, Trash2, FileText, Loader2, Wand2, Link2, Share2,
  LayoutGrid, List, X, Search, Sparkles, Globe, PencilLine, MessagesSquare,
} from 'lucide-react'

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

type DisplayMode = 'grid' | 'list'

const getCardBg = (color: string) => {
  const colorMap: Record<string, string> = {
    indigo: 'border-[rgba(123,105,201,0.18)] bg-[rgba(123,105,201,0.075)] hover:border-[rgba(123,105,201,0.30)] hover:bg-[rgba(123,105,201,0.11)]',
    blue: 'border-[rgba(62,169,244,0.18)] bg-[rgba(62,169,244,0.075)] hover:border-[rgba(62,169,244,0.30)] hover:bg-[rgba(62,169,244,0.11)]',
    green: 'border-[rgba(62,169,244,0.18)] bg-[rgba(62,169,244,0.075)] hover:border-[rgba(62,169,244,0.30)] hover:bg-[rgba(62,169,244,0.11)]',
    red: 'border-[rgba(254,0,77,0.18)] bg-[rgba(254,0,77,0.075)] hover:border-[rgba(254,0,77,0.28)] hover:bg-[rgba(254,0,77,0.11)]',
    purple: 'border-[rgba(123,105,201,0.18)] bg-[rgba(123,105,201,0.075)] hover:border-[rgba(123,105,201,0.30)] hover:bg-[rgba(123,105,201,0.11)]',
    pink: 'border-[rgba(254,0,77,0.18)] bg-[rgba(254,0,77,0.075)] hover:border-[rgba(254,0,77,0.28)] hover:bg-[rgba(254,0,77,0.11)]',
    orange: 'border-[rgba(123,105,201,0.18)] bg-[rgba(123,105,201,0.075)] hover:border-[rgba(123,105,201,0.30)] hover:bg-[rgba(123,105,201,0.11)]',
    teal: 'border-[rgba(62,169,244,0.18)] bg-[rgba(62,169,244,0.075)] hover:border-[rgba(62,169,244,0.30)] hover:bg-[rgba(62,169,244,0.11)]',
    cyan: 'border-[rgba(62,169,244,0.18)] bg-[rgba(62,169,244,0.075)] hover:border-[rgba(62,169,244,0.30)] hover:bg-[rgba(62,169,244,0.11)]',
  }
  return colorMap[color] || 'border-[rgba(23,21,27,0.10)] bg-[rgba(23,21,27,0.035)] hover:border-[rgba(23,21,27,0.16)] hover:bg-[rgba(23,21,27,0.055)]'
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

const STATUS_META: Record<string, { label: string; badge: string }> = {
  published: { label: 'Pubblicato', badge: 'border border-emerald-200 bg-emerald-100 text-emerald-800' },
  testing: { label: 'In test', badge: 'border border-amber-200 bg-amber-100 text-amber-800' },
  draft: { label: 'Bozza', badge: 'border border-slate-200 bg-slate-100 text-slate-600' },
  archived: { label: 'Archiviato', badge: 'border border-slate-200 bg-slate-100 text-slate-500' },
}

function statusMeta(status: string) {
  return STATUS_META[status] || STATUS_META.draft
}

export default function TeacherbotsPage() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [display, setDisplay] = useState<DisplayMode>('grid')
  const [search, setSearch] = useState('')
  const [formTarget, setFormTarget] = useState<'create' | string | null>(null)
  const [testTarget, setTestTarget] = useState<string | null>(null)
  const [reportsTarget, setReportsTarget] = useState<string | null>(null)
  const [shareBot, setShareBot] = useState<{ id: string; name: string } | null>(null)
  const [shareLinksBot, setShareLinksBot] = useState<{ id: string; name: string } | null>(null)

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

  const filtered = useMemo(() => {
    const all = teacherbots || []
    const q = search.trim().toLowerCase()
    const matching = q
      ? all.filter(bot => bot.name.toLowerCase().includes(q) || (bot.synopsis || '').toLowerCase().includes(q))
      : all
    return {
      published: matching.filter(bot => bot.status === 'published'),
      other: matching.filter(bot => bot.status !== 'published'),
    }
  }, [teacherbots, search])

  const totalCount = teacherbots?.length || 0
  const visibleCount = filtered.published.length + filtered.other.length

  const renderBotIcon = (icon: string) => {
    const resolved = resolveTeacherbotIcon(icon)
    if (resolved.kind === 'lucide') return <resolved.Icon className="h-5 w-5" />
    if (resolved.kind === 'emoji') return <span className="text-lg leading-none">{resolved.emoji}</span>
    return <Wand2 className="h-5 w-5" />
  }

  const renderActions = (bot: Teacherbot) => (
    <div className="flex items-center gap-1">
      <button
        className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${getIconColor(bot.color)}`}
        onClick={(e) => { e.stopPropagation(); setFormTarget(bot.id) }}
        title="Configura"
      >
        <Settings className="h-3.5 w-3.5" />
      </button>
      <button
        className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${getIconColor(bot.color)}`}
        onClick={(e) => { e.stopPropagation(); setTestTarget(bot.id) }}
        title="Testa"
      >
        <Eye className="h-3.5 w-3.5" />
      </button>
      {bot.enable_reporting && bot.conversation_count > 0 && (
        <button
          className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${getIconColor(bot.color)}`}
          onClick={(e) => { e.stopPropagation(); setReportsTarget(bot.id) }}
          title="Report"
        >
          <FileText className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${getIconColor(bot.color)}`}
        onClick={(e) => { e.stopPropagation(); setShareBot({ id: bot.id, name: bot.name }) }}
        title="Condividi con classe o studenti"
      >
        <Share2 className="h-3.5 w-3.5" />
      </button>
      <button
        className={`flex h-7 w-7 items-center justify-center rounded-lg transition-colors ${getIconColor(bot.color)}`}
        onClick={(e) => { e.stopPropagation(); setShareLinksBot({ id: bot.id, name: bot.name }) }}
        title="Link pubblico (fuori piattaforma)"
      >
        <Link2 className="h-3.5 w-3.5" />
      </button>
      <button
        className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500"
        onClick={(e) => { e.stopPropagation(); handleDelete(bot.id, bot.name) }}
        title="Elimina"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )

  const renderCard = (bot: Teacherbot) => {
    const status = statusMeta(bot.status)
    const updatedLabel = formatDistanceToNow(new Date(bot.updated_at), { addSuffix: true, locale: it })
    return (
      <div
        key={bot.id}
        onClick={() => setFormTarget(bot.id)}
        className={`group flex min-h-[220px] cursor-pointer flex-col justify-between rounded-[24px] border p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg ${getCardBg(bot.color)}`}
      >
        <div>
          <div className="flex items-start justify-between gap-3">
            <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${getIconColor(bot.color)}`}>
              {renderBotIcon(bot.icon)}
            </span>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${status.badge}`}>
              {status.label}
            </span>
          </div>
          <p className="mt-4 line-clamp-1 text-base font-extrabold leading-tight text-slate-950">{bot.name}</p>
          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-600">
            {bot.synopsis || 'Nessuna descrizione'}
          </p>
        </div>

        <div>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-200/70 pt-3 text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <MessagesSquare className="h-3 w-3" />
              {bot.conversation_count} conversazioni
            </span>
            <span className="truncate">{updatedLabel}</span>
          </div>
          <div className="mt-3">{renderActions(bot)}</div>
        </div>
      </div>
    )
  }

  const renderRow = (bot: Teacherbot) => {
    const status = statusMeta(bot.status)
    const updatedLabel = formatDistanceToNow(new Date(bot.updated_at), { addSuffix: true, locale: it })
    return (
      <div
        key={bot.id}
        onClick={() => setFormTarget(bot.id)}
        className={`group flex cursor-pointer items-center gap-4 rounded-2xl border p-4 shadow-sm transition-all hover:shadow-md ${getCardBg(bot.color)}`}
      >
        <span className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl ${getIconColor(bot.color)}`}>
          {renderBotIcon(bot.icon)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-extrabold leading-tight text-slate-950">{bot.name}</p>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${status.badge}`}>
              {status.label}
            </span>
          </div>
          <p className="truncate text-xs text-slate-600">{bot.synopsis || 'Nessuna descrizione'}</p>
        </div>
        <div className="hidden shrink-0 items-center gap-3 text-xs text-slate-500 sm:flex">
          <span className="flex items-center gap-1"><MessagesSquare className="h-3 w-3" />{bot.conversation_count}</span>
          <span className="w-24 truncate text-right">{updatedLabel}</span>
        </div>
        {renderActions(bot)}
      </div>
    )
  }

  const renderSection = (title: string, icon: React.ReactNode, bots: Teacherbot[]) => {
    if (bots.length === 0) return null
    return (
      <section className="mb-7">
        <div className="mb-3 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
          {icon}
          <h3 className="text-xs font-extrabold uppercase tracking-wide text-slate-700">{title}</h3>
          <span className="text-xs font-bold text-slate-400">{bots.length}</span>
        </div>
        {display === 'grid' ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {bots.map(renderCard)}
          </div>
        ) : (
          <div className="space-y-2">
            {bots.map(renderRow)}
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50">
      <div className="flex-1 overflow-y-auto">
        <section className="border-b border-slate-200 bg-white">
          <div className="mx-auto max-w-3xl px-4 py-8 text-center md:px-6">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400">
              {t('navbar.nav_teacherbots', 'Teacherbot')}
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-950">
              Crea, condividi, osserva
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Un teacherbot è un assistente AI personalizzato: gli dai un nome, una personalità e istruzioni (system prompt),
              e opzionalmente una base di conoscenza. Condividilo con un'intera classe, con singoli studenti, oppure genera
              un link pubblico utilizzabile anche fuori dalla piattaforma.
            </p>
            <Button size="lg" className="mt-6" onClick={() => setFormTarget('create')}>
              <Plus className="h-4 w-4 mr-2" />
              Nuovo teacherbot
            </Button>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 md:px-6">
          <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Bot className="h-4 w-4 text-slate-500" />
              <span>{search ? `${visibleCount} risultati` : `${totalCount} teacherbot`}</span>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-full md:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cerca teacherbot..."
                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-8 text-sm shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                    title="Pulisci ricerca"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
                <button
                  onClick={() => setDisplay('grid')}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${display === 'grid' ? 'bg-slate-900 text-white' : 'text-slate-400 hover:bg-slate-100'}`}
                  title="Griglia"
                >
                  <LayoutGrid className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setDisplay('list')}
                  className={`flex h-7 w-7 items-center justify-center rounded-md transition-colors ${display === 'list' ? 'bg-slate-900 text-white' : 'text-slate-400 hover:bg-slate-100'}`}
                  title="Elenco"
                >
                  <List className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : totalCount === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-[28px] bg-white py-24 text-center shadow-sm">
              <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-lg bg-indigo-50 ring-1 ring-indigo-100">
                <Sparkles className="h-8 w-8 text-indigo-500" />
              </div>
              <h3 className="text-lg font-bold text-slate-800 mb-1">Nessun teacherbot</h3>
              <p className="text-sm text-slate-500 mb-6 max-w-md">
                Crea il tuo primo assistente AI personalizzato per interagire con gli studenti.
              </p>
              <Button onClick={() => setFormTarget('create')}>
                <Plus className="h-4 w-4 mr-2" />
                Crea il tuo primo teacherbot
              </Button>
            </div>
          ) : visibleCount === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white px-4 py-16 text-center">
              <Search className="mx-auto h-8 w-8 text-slate-200 mb-3" />
              <p className="text-sm font-semibold text-slate-700">Nessun teacherbot corrisponde a &quot;{search}&quot;</p>
            </div>
          ) : (
            <>
              {renderSection('Pubblicati', <Globe className="h-4 w-4 text-emerald-600" />, filtered.published)}
              {renderSection('Bozze e in lavorazione', <PencilLine className="h-4 w-4 text-slate-500" />, filtered.other)}
            </>
          )}
        </div>
      </div>

      {/* Teacherbot config / create modal — centered */}
      {formTarget && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/40 p-2 backdrop-blur-sm md:p-5">
          <div className="h-[min(90vh,980px)] w-full max-w-[1560px] overflow-hidden rounded-2xl bg-white shadow-2xl">
            <TeacherbotForm
              teacherbotId={formTarget !== 'create' ? formTarget : undefined}
              onBack={() => setFormTarget(null)}
              onSaved={() => setFormTarget(null)}
            />
          </div>
        </div>
      )}

      {/* Test preview modal */}
      {testTarget && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-2 backdrop-blur-sm md:p-5">
          <div className="my-3 flex h-[min(94vh,1040px)] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl md:my-5">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <span className="text-xs font-semibold text-slate-500">Anteprima studente</span>
              <button onClick={() => setTestTarget(null)} className="rounded-lg p-1.5 hover:bg-slate-100">
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>
            <div className="flex-1 overflow-hidden">
              <Suspense fallback={
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
                </div>
              }>
                <ChatbotModule
                  sessionId="teacher-preview"
                  initialTeacherbotId={testTarget}
                  isTeacherPreview={true}
                />
              </Suspense>
            </div>
          </div>
        </div>
      )}

      {/* Reports modal */}
      {reportsTarget && (
        <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-black/40 p-2 backdrop-blur-sm md:p-5">
          <div className="my-3 h-[min(94vh,1040px)] w-full max-w-[1180px] overflow-hidden rounded-2xl bg-white shadow-2xl md:my-5">
            <TeacherbotReportsPanel teacherbotId={reportsTarget} onBack={() => setReportsTarget(null)} />
          </div>
        </div>
      )}

      {shareBot && (
        <TeacherbotShareModal
          teacherbotId={shareBot.id}
          teacherbotName={shareBot.name}
          onClose={() => setShareBot(null)}
        />
      )}

      {shareLinksBot && (
        <TeacherbotShareLinksModal
          teacherbotId={shareLinksBot.id}
          teacherbotName={shareLinksBot.name}
          onClose={() => setShareLinksBot(null)}
        />
      )}
    </div>
  )
}
