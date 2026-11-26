import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Smartphone } from '@/components/icons'
import { solidModelerApi, type SolidModelSummary } from '@/lib/api'
import { ShareClassesPanel, ShareDialogShell, ShareLinkPanel } from '@/components/share/SharePanels'
import { publishArModel } from './arPublish'
import type { SceneObject } from './types'
import { tl } from '@/i18n/tl'

interface Props {
  modelId: string
  name: string
  onClose: () => void
}

export default function SolidModelShareDialog({ modelId, name, onClose }: Props) {
  const queryClient = useQueryClient()
  const [model, setModel] = useState<SolidModelSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scene, setScene] = useState<SceneObject[] | null>(null)
  const [arDirect, setArDirect] = useState(true)
  const [arState, setArState] = useState<'idle' | 'working' | 'ready'>('idle')

  const classes = useQuery({
    queryKey: ['solid-modeler-classes'],
    queryFn: async () => (await solidModelerApi.classes()).data,
  })

  useEffect(() => {
    solidModelerApi.get(modelId)
      .then(r => { setModel(r.data); setScene(r.data.scene as SceneObject[]) })
      .catch(() => setError(tl("Impossibile caricare il progetto")))
  }, [modelId])

  // Public link on: (re)build the GLB phones open in augmented reality from the saved scene.
  const isPublic = !!model?.public_enabled
  useEffect(() => {
    if (!isPublic || !scene) return
    let alive = true
    setArState('working')
    publishArModel(modelId, scene).then(() => { if (alive) setArState('ready') })
    return () => { alive = false }
  }, [isPublic, scene, modelId])

  const publicUrl = model?.public_enabled && model.public_token
    ? `${window.location.origin}/3d/${model.public_token}${arDirect ? '?ar=1' : ''}`
    : ''

  const update = async (data: { class_ids?: string[]; public_enabled?: boolean; regenerate_token?: boolean }) => {
    setBusy(true)
    setError(null)
    try {
      const res = await solidModelerApi.share(modelId, data)
      setModel(m => (m ? { ...m, ...res.data } : res.data))
      queryClient.invalidateQueries({ queryKey: ['solid-models'] })
    } catch (e: unknown) {
      setError((e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || tl("Condivisione non riuscita"))
    } finally {
      setBusy(false)
    }
  }

  const toggleClass = (id: string) => {
    if (!model) return
    const current = new Set(model.shared_class_ids)
    if (current.has(id)) current.delete(id)
    else current.add(id)
    update({ class_ids: [...current] })
  }

  return (
    <ShareDialogShell
      kicker={tl("Condividi modello 3D")}
      title={name}
      description={tl("Chi riceve il modello lo vede in 3D in sola lettura e può scaricare l'STL. Le modifiche che fai qui si vedono subito.")}
      onClose={onClose}
      loading={!model}
      error={error}
    >
      {model && (
        <>
          <ShareClassesPanel
            classes={classes.data}
            loading={classes.isLoading}
            selected={model.shared_class_ids}
            onToggle={toggleClass}
            busy={busy}
            description={tl("Gli studenti delle classi selezionate trovano il modello nella sezione \"Modelli 3D\" della loro sessione.")}
          />
          <ShareLinkPanel
            enabled={model.public_enabled}
            onToggle={() => update({ public_enabled: !model.public_enabled })}
            busy={busy}
            url={publicUrl}
            fileBase={name || 'modello'}
            qrAlt={tl("QR code del modello")}
            description={tl("Chiunque abbia il link o inquadri il QR code vede il modello, senza account. Dal telefono può posizionarlo nello spazio in realtà aumentata.")}
            onRegenerate={() => update({ regenerate_token: true })}
          >
            <label className="flex cursor-pointer items-start gap-2 rounded-xl bg-[var(--app-accent-soft)] px-3 py-2">
              <input type="checkbox" checked={arDirect} onChange={e => setArDirect(e.target.checked)} className="mt-0.5 h-3.5 w-3.5 accent-[var(--app-accent)]" />
              <span className="min-w-0 text-[11px] leading-4 text-[var(--text-primary)]">
                <span className="flex items-center gap-1 font-semibold"><Smartphone className="h-3.5 w-3.5 text-[var(--app-accent-text)]" /> {tl("Il QR apre la realtà aumentata")}</span>
                <span className="block text-[var(--text-secondary)]">
                  {arState === 'working' ? tl("Preparo il modello per AR…") : arState === 'ready' ? tl("Pronto: inquadra il QR col telefono, poi «Vedi nello spazio».") : tl("Inquadra il QR col telefono, poi «Vedi nello spazio».")}
                </span>
              </span>
            </label>
          </ShareLinkPanel>
        </>
      )}
    </ShareDialogShell>
  )
}
