import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Clock, Loader2, Search, ShieldCheck } from 'lucide-react'
import { adminApi } from '@/lib/api'

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
  accepted_at: string | null
}

type LegalConsentItem = {
  teacher: {
    id: string
    first_name: string | null
    last_name: string | null
    email: string | null
    institution: string | null
    created_at: string | null
    last_login_at: string | null
  }
  acceptances: LegalAcceptance[]
}

type LegalConsentsResponse = {
  required_documents: LegalDocument[]
  items: LegalConsentItem[]
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('it-IT', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value))
}

function teacherName(item: LegalConsentItem) {
  return [item.teacher.first_name, item.teacher.last_name].filter(Boolean).join(' ') || item.teacher.email || 'Docente'
}

export default function LicensesPage() {
  const [query, setQuery] = useState('')
  const [onlyLicenseAccepted, setOnlyLicenseAccepted] = useState(false)
  const { data, isLoading } = useQuery<LegalConsentsResponse>({
    queryKey: ['admin-legal-consents'],
    queryFn: async () => (await adminApi.getLegalConsents()).data,
  })

  const items = data?.items || []
  const licenseKey = data?.required_documents?.[0]?.key || 'license_terms'
  const licenseAcceptedCount = items.filter((item) =>
    item.acceptances.some((acc) => acc.document_key === licenseKey && acc.accepted_at),
  ).length
  const completeCount = items.filter((item) => item.acceptances.every((acc) => acc.accepted_at)).length

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((item) => {
      const hasLicense = item.acceptances.some((acc) => acc.document_key === licenseKey && acc.accepted_at)
      if (onlyLicenseAccepted && !hasLicense) return false
      if (!q) return true
      return [
        teacherName(item),
        item.teacher.email,
        item.teacher.institution,
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(q))
    })
  }, [items, licenseKey, onlyLicenseAccepted, query])

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" />
            Licenze
          </div>
          <h1 className="text-2xl font-black text-slate-950">Consensi licenza docenti</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Stato delle accettazioni obbligatorie per Termini e licenza, AI Act DPIA e Privacy DPA.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Metric label="Docenti" value={items.length} />
          <Metric label="Licenza accettata" value={licenseAcceptedCount} />
          <Metric label="Completati" value={completeCount} />
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca docente, email o istituto"
            className="h-10 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-slate-300 focus:bg-white focus:ring-2 focus:ring-slate-100"
          />
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-600">
          <input
            type="checkbox"
            checked={onlyLicenseAccepted}
            onChange={(event) => setOnlyLicenseAccepted(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-300"
          />
          Solo licenza accettata
        </label>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center text-sm text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Caricamento consensi
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-12 text-center text-sm text-slate-400">Nessun docente trovato</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-bold">Docente</th>
                  <th className="px-4 py-3 font-bold">Ultimo accesso</th>
                  {(data?.required_documents || []).map((doc) => (
                    <th key={doc.key} className="px-4 py-3 font-bold">{doc.title}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredItems.map((item) => (
                  <tr key={item.teacher.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-4">
                      <p className="font-semibold text-slate-900">{teacherName(item)}</p>
                      <p className="text-xs text-slate-500">{item.teacher.email || '—'}</p>
                      <p className="text-xs text-slate-400">{item.teacher.institution || '—'}</p>
                    </td>
                    <td className="px-4 py-4 text-slate-600">{formatDateTime(item.teacher.last_login_at)}</td>
                    {item.acceptances.map((acceptance) => (
                      <td key={acceptance.document_key} className="px-4 py-4">
                        <StatusPill acceptedAt={acceptance.accepted_at} />
                        <p className="mt-1 text-xs text-slate-500">{formatDateTime(acceptance.accepted_at)}</p>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-xl font-black text-slate-950">{value}</p>
    </div>
  )
}

function StatusPill({ acceptedAt }: { acceptedAt?: string | null }) {
  if (acceptedAt) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Accettato
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700">
      <Clock className="h-3.5 w-3.5" />
      In attesa
    </span>
  )
}
