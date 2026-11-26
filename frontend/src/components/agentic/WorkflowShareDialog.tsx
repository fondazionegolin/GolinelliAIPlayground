import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ShareChoiceRow, ShareClassesPanel, ShareDialogShell, ShareLinkPanel } from '@/components/share/SharePanels'
import { tl } from '@/i18n/tl'
import { agenticSharingApi, type WorkflowShareState } from '@/lib/api'

const detail = (e: unknown) => (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail

/** Who can run this workflow: whole classes, single sessions, and anyone with the link or QR code. */
export default function WorkflowShareDialog({ workflowId, title, onClose }: { workflowId: string; title: string; onClose: () => void }) {
  const [share, setShare] = useState<WorkflowShareState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const targets = useQuery({ queryKey: ['workflow-share-targets'], queryFn: async () => (await agenticSharingApi.targets()).data })
  useEffect(() => {
    agenticSharingApi.getShare(workflowId).then((r) => setShare(r.data)).catch((e) => setError(detail(e) || tl("Impossibile caricare la condivisione")))
  }, [workflowId])

  const publicUrl = share?.public_enabled && share.public_token ? `${window.location.origin}/dataflow/${share.public_token}` : ''
  const update = async (data: Parameters<typeof agenticSharingApi.updateShare>[1]) => {
    setBusy(true); setError(null)
    try { setShare((await agenticSharingApi.updateShare(workflowId, data)).data) }
    catch (e) { setError(detail(e) || tl("Condivisione non riuscita")) }
    finally { setBusy(false) }
  }
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((item) => item !== id) : [...list, id])

  const sessionsByClass = useMemo(() => {
    const groups = new Map<string, NonNullable<typeof targets.data>['sessions']>()
    for (const session of targets.data?.sessions ?? []) groups.set(session.class_name, [...(groups.get(session.class_name) ?? []), session])
    return [...groups.entries()]
  }, [targets.data])

  return (
    <ShareDialogShell
      kicker={tl("Condividi workflow")}
      title={title}
      description={tl("Chi lo riceve lo esegue come un'app (o ci chatta, se è un chatbot) senza poterlo modificare. I workflow che leggono i tuoi file o dataset privati non si possono condividere.")}
      onClose={onClose}
      loading={!share}
      error={error}
    >
      {share && (
        <>
          <ShareClassesPanel
            classes={targets.data?.classes}
            loading={targets.isLoading}
            selected={share.shared_class_ids}
            onToggle={(id) => update({ class_ids: toggle(share.shared_class_ids, id) })}
            busy={busy}
            description={tl("Gli studenti li trovano in «Workflow condivisi». Le AI che usano sono a carico del loro limite di sessione.")}
          >
            {sessionsByClass.length > 0 && (
              <div className="mt-4 max-h-52 space-y-2 overflow-y-auto pr-1">
                <p className="text-[10px] font-semibold text-[var(--text-secondary)]">{tl("Solo una sessione")}</p>
                {sessionsByClass.map(([className, sessions]) => (
                  <div key={className} className="space-y-1">
                    <p className="text-[10px] font-semibold text-[var(--text-secondary)]">{className}</p>
                    {sessions.map((s) => <ShareChoiceRow key={s.id} on={share.shared_session_ids.includes(s.id)} label={s.title} disabled={busy} onClick={() => update({ session_ids: toggle(share.shared_session_ids, s.id) })} />)}
                  </div>
                ))}
              </div>
            )}
          </ShareClassesPanel>
          <ShareLinkPanel
            enabled={share.public_enabled}
            onToggle={() => update({ public_enabled: !share.public_enabled })}
            busy={busy}
            url={publicUrl}
            fileBase={title || 'workflow'}
            qrAlt={tl("QR code del workflow")}
            description={tl("Chiunque abbia il link o inquadri il QR lo usa, senza account. Le AI usate sono a carico dei tuoi crediti: le richieste per link sono limitate.")}
            onRegenerate={() => update({ regenerate_token: true })}
          />
        </>
      )}
    </ShareDialogShell>
  )
}
