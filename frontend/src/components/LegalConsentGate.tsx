import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink, FileCheck2, Loader2, LockKeyhole, Scale, ShieldCheck } from 'lucide-react'
import { authApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/components/ui/use-toast'

type LegalDocument = {
  key: string
  title: string
  version: string
  source_url: string
  accept_label: string
}

type LegalAcceptance = {
  document_key: string
  document_title: string
  document_version: string
  accepted_at: string
}

type LegalConsentStatus = {
  required: boolean
  complete: boolean
  required_documents: LegalDocument[]
  accepted: LegalAcceptance[]
}

const icons = [Scale, ShieldCheck, FileCheck2]

function formatVersion(version: string) {
  return version.replace('-', '/')
}

export function LegalConsentGate() {
  const { user, isAuthenticated } = useAuthStore()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const isLegalReadRoute = location.pathname === '/terms' || location.pathname === '/privacy'
  const shouldCheck = Boolean(isAuthenticated && user?.role === 'TEACHER' && !isLegalReadRoute)

  const { data, isLoading } = useQuery<LegalConsentStatus>({
    queryKey: ['legal-consents-me', user?.id],
    queryFn: async () => (await authApi.getLegalConsents()).data,
    enabled: shouldCheck,
    staleTime: 30_000,
  })

  const acceptedKeys = useMemo(
    () => new Set((data?.accepted || []).map((item) => item.document_key)),
    [data?.accepted],
  )
  const activeDocument = data?.required_documents.find((doc) => !acceptedKeys.has(doc.key))
  const activeIndex = activeDocument ? data?.required_documents.findIndex((doc) => doc.key === activeDocument.key) ?? 0 : 0
  const ActiveIcon = icons[activeIndex] || FileCheck2

  const acceptMutation = useMutation({
    mutationFn: (documentKey: string) => authApi.acceptLegalConsent(documentKey),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['legal-consents-me', user?.id] })
    },
    onError: (error: any) => {
      toast({
        title: 'Accettazione non registrata',
        description: error?.response?.data?.detail || 'Riprova tra qualche secondo.',
        variant: 'destructive',
      })
    },
  })

  if (!shouldCheck || !data?.required || data.complete || !activeDocument) return null

  const sourceHref = activeDocument.source_url
  const isPdf = sourceHref.toLowerCase().endsWith('.pdf')
  const viewerSrc = isPdf ? `${sourceHref}#toolbar=0&navpanes=0&scrollbar=0&view=FitH` : sourceHref

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true">
      <div className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
                <LockKeyhole className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Accettazione obbligatoria</p>
                <h2 className="text-lg font-bold text-slate-950">Documenti di licenza e privacy</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Completa i tre passaggi per accedere all'area docente.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {data.required_documents.map((doc, index) => {
                const done = acceptedKeys.has(doc.key)
                const current = doc.key === activeDocument.key
                return (
                  <div
                    key={doc.key}
                    className={`flex h-9 min-w-9 items-center justify-center rounded-full border text-xs font-bold ${
                      done
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : current
                          ? 'border-slate-900 bg-slate-900 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-400'
                    }`}
                    title={doc.title}
                  >
                    {done ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
                  </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[20rem_1fr]">
          <aside className="border-b border-slate-200 bg-slate-50/80 p-4 lg:border-b-0 lg:border-r">
            <div className="space-y-2">
              {data.required_documents.map((doc, index) => {
                const done = acceptedKeys.has(doc.key)
                const current = doc.key === activeDocument.key
                const StepIcon = icons[index] || FileCheck2
                return (
                  <div
                    key={doc.key}
                    className={`rounded-xl border p-3 ${
                      current ? 'border-slate-300 bg-white shadow-sm' : 'border-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <StepIcon className={`h-4 w-4 ${done ? 'text-emerald-600' : current ? 'text-slate-900' : 'text-slate-400'}`} />
                      <p className={`text-sm font-semibold ${done || current ? 'text-slate-900' : 'text-slate-400'}`}>
                        {doc.title}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">Versione {formatVersion(doc.version)}</p>
                  </div>
                )
              })}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col">
            <div className="border-b border-slate-200 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
                    <ActiveIcon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-slate-950">{activeDocument.title}</h3>
                    <p className="text-xs text-slate-500">Passaggio {activeIndex + 1} di {data.required_documents.length} · versione {formatVersion(activeDocument.version)}</p>
                  </div>
                </div>
                <a
                  href={sourceHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                >
                  Apri <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>

            <div className="min-h-[18rem] flex-1 bg-slate-100">
              {isLoading ? (
                <div className="flex h-full items-center justify-center text-slate-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Caricamento documenti
                </div>
              ) : (
                <iframe title={activeDocument.title} src={viewerSrc} className="h-full min-h-[42vh] w-full bg-white" />
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-relaxed text-slate-500">
                Il click registra data, versione del documento e dati tecnici essenziali per audit.
              </p>
              <button
                type="button"
                onClick={() => acceptMutation.mutate(activeDocument.key)}
                disabled={acceptMutation.isPending}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {acceptMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {activeDocument.accept_label}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
