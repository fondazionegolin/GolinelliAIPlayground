import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow, type Locale } from 'date-fns'
import { enUS, it } from 'date-fns/locale'
import { Clock, Code2, Loader2, RotateCcw, Save, Sparkles, Trash2, History } from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import {
  notebooksApi,
  type NotebookVersionDetail,
  type NotebookVersionSource,
  type NotebookVersionSummary,
} from '@/lib/api'
import type { Cell, NotebookDetail } from './types'

interface Props {
  notebookId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onRestored: (detail: NotebookDetail) => void
  isEnglish?: boolean
}

const SOURCE_META: Record<NotebookVersionSource, { icon: typeof Save; label: string; labelEn: string; tint: string }> = {
  manual: { icon: Save, label: 'Manuale', labelEn: 'Manual', tint: 'text-[var(--logo-blue-strong)]' },
  ai: { icon: Sparkles, label: 'Proposta AI', labelEn: 'AI proposal', tint: 'text-[var(--logo-violet-strong)]' },
  auto: { icon: Clock, label: 'Automatico', labelEn: 'Auto', tint: 'text-slate-400' },
  rollback: { icon: RotateCcw, label: 'Ripristino', labelEn: 'Restore', tint: 'text-amber-500' },
}

export default function NotebookVersionHistoryModal({ notebookId, open, onOpenChange, onRestored, isEnglish = false }: Props) {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const locale = isEnglish ? enUS : it
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const versionsQuery = useQuery({
    queryKey: ['notebook-versions', notebookId],
    queryFn: async () => (await notebooksApi.listVersions(notebookId)).data,
    enabled: open && !!notebookId,
  })

  const previewQuery = useQuery({
    queryKey: ['notebook-version', notebookId, expandedId],
    queryFn: async () => (await notebooksApi.getVersion(notebookId, expandedId!)).data,
    enabled: open && !!expandedId,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['notebook-versions', notebookId] })

  const saveMutation = useMutation({
    mutationFn: () => notebooksApi.createVersion(notebookId, { label: isEnglish ? 'Manual save' : 'Salvataggio manuale', source: 'manual' }),
    onSuccess: () => {
      refresh()
      toast({ title: isEnglish ? 'Version saved' : 'Versione salvata' })
    },
    onError: () => toast({ title: isEnglish ? 'Could not save version' : 'Impossibile salvare la versione', variant: 'destructive' }),
  })

  const restoreMutation = useMutation({
    mutationFn: (versionId: string) => notebooksApi.restoreVersion(notebookId, versionId),
    onSuccess: (res) => {
      onRestored(res.data as NotebookDetail)
      refresh()
      toast({ title: isEnglish ? 'Version restored' : 'Versione ripristinata' })
      onOpenChange(false)
    },
    onError: () => toast({ title: isEnglish ? 'Restore failed' : 'Ripristino non riuscito', variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (versionId: string) => notebooksApi.deleteVersion(notebookId, versionId),
    onSuccess: () => refresh(),
  })

  const versions = versionsQuery.data ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] w-[92vw] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[var(--border-subtle)] px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4 text-[var(--logo-blue-strong)]" />
            {isEnglish ? 'Version history' : 'Cronologia versioni'}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {isEnglish
              ? 'Every checkpoint of this notebook. Restore any previous version — the current state is saved first.'
              : 'Ogni checkpoint di questo notebook. Ripristina una versione precedente: lo stato attuale viene salvato prima.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-base)] px-5 py-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
            {versions.length} {isEnglish ? 'versions' : 'versioni'}
          </span>
          <Button
            density="compact"
            tone="accent"
            surface="solid"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            {isEnglish ? 'Save current version' : 'Salva versione corrente'}
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {versionsQuery.isLoading ? (
            <div className="flex items-center justify-center py-10 text-slate-400">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : versions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--border-subtle)] px-4 py-10 text-center text-xs text-[var(--text-secondary)]">
              {isEnglish
                ? 'No versions yet. Save one now, or they will be created automatically as you work.'
                : 'Ancora nessuna versione. Salvane una ora, oppure verranno create automaticamente mentre lavori.'}
            </div>
          ) : (
            <ul className="space-y-2">
              {versions.map((version) => (
                <VersionRow
                  key={version.id}
                  version={version}
                  locale={locale}
                  isEnglish={isEnglish}
                  expanded={expandedId === version.id}
                  preview={expandedId === version.id ? previewQuery.data : undefined}
                  previewLoading={expandedId === version.id && previewQuery.isLoading}
                  onToggle={() => setExpandedId((prev) => (prev === version.id ? null : version.id))}
                  onRestore={() => restoreMutation.mutate(version.id)}
                  onDelete={() => deleteMutation.mutate(version.id)}
                  restoring={restoreMutation.isPending && restoreMutation.variables === version.id}
                />
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function VersionRow({
  version,
  locale,
  isEnglish,
  expanded,
  preview,
  previewLoading,
  onToggle,
  onRestore,
  onDelete,
  restoring,
}: {
  version: NotebookVersionSummary
  locale: Locale
  isEnglish: boolean
  expanded: boolean
  preview?: NotebookVersionDetail
  previewLoading: boolean
  onToggle: () => void
  onRestore: () => void
  onDelete: () => void
  restoring: boolean
}) {
  const meta = SOURCE_META[version.source] ?? SOURCE_META.manual
  const Icon = meta.icon
  const when = formatDistanceToNow(new Date(version.created_at), { addSuffix: true, locale })

  const codeCells = (preview?.cells as Cell[] | undefined)?.filter((cell) => cell.type === 'code') ?? []
  const codePreview = codeCells.map((cell) => cell.source).join('\n\n# ──────\n\n')

  return (
    <li className="rounded-xl border border-[var(--border-subtle)] bg-white">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-base)] ${meta.tint}`}>
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{version.label}</p>
          <p className="truncate text-[11px] text-[var(--text-secondary)]">
            {isEnglish ? meta.labelEn : meta.label} · {when} · {version.cell_count} {isEnglish ? 'cells' : 'celle'}
          </p>
        </div>
        <button
          onClick={onToggle}
          className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--surface-base)]"
          title={isEnglish ? 'Preview code' : 'Anteprima codice'}
        >
          <Code2 className="h-3.5 w-3.5" />
          {expanded ? (isEnglish ? 'Hide' : 'Nascondi') : (isEnglish ? 'Preview' : 'Anteprima')}
        </button>
        <Button density="compact" tone="success" surface="soft" onClick={onRestore} disabled={restoring}>
          {restoring ? <Loader2 className="animate-spin" /> : <RotateCcw />}
          {isEnglish ? 'Restore' : 'Ripristina'}
        </Button>
        <button
          onClick={onDelete}
          className="rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-[var(--logo-pink)]"
          title={isEnglish ? 'Delete version' : 'Elimina versione'}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-[var(--border-subtle)] p-3">
          {previewLoading ? (
            <div className="flex justify-center py-4 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : (
            <pre className="max-h-60 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-200">
              {codePreview || (isEnglish ? '(empty)' : '(vuoto)')}
            </pre>
          )}
        </div>
      )}
    </li>
  )
}
