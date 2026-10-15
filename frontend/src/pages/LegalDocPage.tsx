import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from '@/components/icons'
import { schoolInviteApi } from '@/lib/api'

/** Testo pubblico dei documenti legali dell'onboarding istituti (/legal/:key). */
export default function LegalDocPage() {
  const { key = '' } = useParams<{ key: string }>()
  const [params] = useSearchParams()
  const school_name = params.get('school_name') || undefined
  const code = params.get('code') || undefined

  const { data, isLoading, error } = useQuery({
    queryKey: ['legal-doc', key, school_name, code],
    queryFn: async () => (await schoolInviteApi.document(key, { school_name, code })).data,
    retry: false,
  })

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-5 py-8 text-slate-800">
      {isLoading && <Loader2 className="mx-auto mt-16 h-6 w-6 animate-spin text-slate-400" />}
      {error && <p className="mt-16 text-center text-sm text-slate-500">Documento non disponibile.</p>}
      {data && (
        <article
          className="[&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-bold [&_h3]:mb-1 [&_h3]:mt-5 [&_h3]:font-semibold [&_li]:mb-1 [&_p]:my-2 [&_p]:leading-relaxed [&_ul]:ml-5 [&_ul]:list-disc text-sm"
          dangerouslySetInnerHTML={{ __html: data.html }}
        />
      )}
    </main>
  )
}
