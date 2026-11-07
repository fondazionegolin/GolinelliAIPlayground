import { useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Clock, LockKeyhole } from '@/components/icons'
import { Button } from '@/design'
import { licenseApi } from '@/lib/api'
import { useAuthStore } from '@/stores/auth'
import { tl } from '@/i18n/tl'

/** Blocks the teacher area once the licence (own or school's) has expired. The API refuses the same requests with 403. */
export function LicenseGate() {
  const { user, isAuthenticated, logout } = useAuthStore()
  const location = useLocation()
  const inTeacherArea = location.pathname === '/teacher' || location.pathname.startsWith('/teacher/')
  const enabled = Boolean(isAuthenticated && user?.role === 'TEACHER' && inTeacherArea)
  const { data } = useQuery({ queryKey: ['license-me', user?.id], queryFn: async () => (await licenseApi.me()).data, enabled, staleTime: 60_000, refetchInterval: 10 * 60_000, retry: false })
  if (!enabled || data?.state !== 'expired') return null
  const date = data.expires_at ? new Intl.DateTimeFormat('it-IT', { dateStyle: 'long' }).format(new Date(data.expires_at)) : ''
  return <div role="alertdialog" aria-modal="true" aria-labelledby="license-expired-title" className="fixed inset-0 z-[500] flex items-center justify-center bg-[var(--ds-surface)] p-6 text-[var(--text-primary)]">
    <div className="max-w-md space-y-4 text-center">
      <LockKeyhole className="mx-auto h-10 w-10 text-[var(--text-secondary)]" />
      <h1 id="license-expired-title" className="text-2xl font-bold">{tl('La licenza è scaduta')}</h1>
      <p className="text-sm leading-6 text-[var(--text-secondary)]">
        {data.source === 'school' ? tl('La licenza del tuo istituto è scaduta') : tl('La tua licenza è scaduta')}{date ? tl(' il {0}', date) : ''}.{' '}
        {tl('I tuoi contenuti sono al sicuro. Contatta l’amministratore della piattaforma per rinnovarla e riprendere da dove avevi lasciato.')}
      </p>
      <Button tone="neutral" surface="outline" onClick={() => { logout(); window.location.assign('/login') }}><Clock className="h-4 w-4" />{tl('Esci')}</Button>
    </div>
  </div>
}
