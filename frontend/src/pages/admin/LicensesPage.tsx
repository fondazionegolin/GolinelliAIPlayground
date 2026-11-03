import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Clock, Loader2, Search } from '@/components/icons'
import { AdminBadge, AdminEmpty, AdminPageHeader, AdminStat, AdminStatGrid } from '@/components/admin/AdminUI'
import { adminApi } from '@/lib/api'
import { tl } from '@/i18n/tl'
import { LegalDocsManager } from './LegalDocsManager'

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
  return [item.teacher.first_name, item.teacher.last_name].filter(Boolean).join(' ') || item.teacher.email || tl("Docente")
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
      <AdminPageHeader
        eyebrow={tl("Licenze")}
        title={tl("Consensi licenza docenti")}
        description={tl("Stato delle accettazioni obbligatorie per Termini e licenza, AI Act DPIA e Privacy DPA.")}
      />

      <AdminStatGrid className="!grid-cols-1 sm:!grid-cols-3">
        <AdminStat label={tl("Docenti")} value={items.length} />
        <AdminStat label={tl("Licenza accettata")} value={licenseAcceptedCount} />
        <AdminStat label={tl("Completati")} value={completeCount} />
      </AdminStatGrid>

      <LegalDocsManager />

      <div className="admin-panel flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={tl("Cerca docente, email o istituto")}
            className="h-9 w-full rounded-md border border-[var(--admin-line-strong)] bg-white pl-9 pr-3 text-sm outline-none focus:border-[var(--admin-accent)] focus:ring-2 focus:ring-[var(--admin-accent-soft)]"
          />
        </div>
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-[var(--admin-ink-2)]">
          <input
            type="checkbox"
            checked={onlyLicenseAccepted}
            onChange={(event) => setOnlyLicenseAccepted(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-[var(--admin-accent)]"
          />
          {tl("Solo licenza accettata")}
        </label>
      </div>

      <div className="admin-panel">
        {isLoading ? (
          <div className="flex h-48 items-center justify-center text-sm text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {tl("Caricamento consensi")}
          </div>
        ) : filteredItems.length === 0 ? (
          <AdminEmpty>{tl("Nessun docente trovato")}</AdminEmpty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead>
                <tr>
                  <th>{tl("Docente")}</th>
                  <th>{tl("Ultimo accesso")}</th>
                  {(data?.required_documents || []).map((doc) => (
                    <th key={doc.key}>{doc.title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr key={item.teacher.id}>
                    <td>
                      <p className="font-semibold text-slate-900">{teacherName(item)}</p>
                      <p className="text-xs text-slate-500">{item.teacher.email || '—'}</p>
                      <p className="text-xs text-slate-400">{item.teacher.institution || '—'}</p>
                    </td>
                    <td className="nowrap text-slate-600">{formatDateTime(item.teacher.last_login_at)}</td>
                    {item.acceptances.map((acceptance) => (
                      <td key={acceptance.document_key}>
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

function StatusPill({ acceptedAt }: { acceptedAt?: string | null }) {
  return acceptedAt ? (
    <AdminBadge tone="success"><CheckCircle2 className="h-3 w-3" />{tl("Accettato")}</AdminBadge>
  ) : (
    <AdminBadge tone="warning"><Clock className="h-3 w-3" />{tl("In attesa")}</AdminBadge>
  )
}
