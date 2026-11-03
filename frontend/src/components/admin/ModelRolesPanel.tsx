import { SearchableSelect } from '@/components/ui/searchable-select'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, RotateCcw, Sparkles } from '@/components/icons'
import { adminApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { tl } from '@/i18n/tl'

type Provider = 'openai' | 'anthropic' | 'deepseek' | 'openrouter' | 'gemini' | 'ollama'
interface Candidate {
  id: string; provider: Provider; model_id: string; display_name: string; kind: string
  input_usd: number | null; output_usd: number | null; price_note: string | null
  quality_score: number | null; ready: boolean; recommended: boolean; status: string
}
interface Role {
  id: string; group: 'chat' | 'vision' | 'image' | 'voice'; label: string; description: string; kind: string; where: string[]
  current: { provider: Provider; model_id: string; display_name: string; model: Candidate | null }
  default: { provider: Provider; model_id: string }
  overridden: boolean; updated_by: string | null; updated_at: string | null
  candidates: Candidate[]
}
interface RolesResponse { roles: Role[]; fixed: Array<{ label: string; model: string; reason: string }> }

const PROVIDER_LABEL: Record<Provider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', deepseek: 'DeepSeek', openrouter: 'OpenRouter', gemini: 'Gemini', ollama: 'Ollama' }
const GROUPS: Array<{ id: Role['group'][]; title: string; hint: string }> = [
  { id: ['chat'], title: tl("Chatbot e generazione di testo"), hint: tl("Chat di sessione, docente, tutor dei Notebook, Vibe Lab, ricerca nei documenti") },
  { id: ['vision'], title: tl("Visione"), hint: tl("Analisi di immagini, PDF e anteprime") },
  { id: ['image'], title: tl("Generazione di immagini"), hint: tl("Generatore di piattaforma e flussi agentici") },
  { id: ['voice'], title: tl("Voce e tempo reale"), hint: tl("Interrogazione vocale, indagine, trascrizione e dettatura") },
]

const money = (value: number) => `$${value < 1 ? value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : value.toFixed(2).replace(/\.00$/, '')}`
export function priceLabel(model: Pick<Candidate, 'kind' | 'input_usd' | 'output_usd' | 'price_note'> | null): string {
  if (!model) return '—'
  if (model.kind === 'text') return model.input_usd !== null && model.output_usd !== null ? tl("{0} / {1} per 1M token", money(model.input_usd), money(model.output_usd)) : tl("prezzo mancante")
  if (model.kind === 'image' && model.input_usd !== null) return tl("{0} per immagine", money(model.input_usd))
  return model.price_note || tl("vedi listino")
}
const unusable = (role: Role, c: Candidate) => !c.ready ? tl("chiave API mancante") : (role.kind === 'text' && (c.input_usd === null || c.output_usd === null)) || (role.kind === 'image' && c.input_usd === null) ? tl("prezzo mancante") : null
const optionText = (role: Role, c: Candidate) => {
  const reason = unusable(role, c)
  const parts = [c.display_name, c.kind === 'text' ? (c.input_usd !== null && c.output_usd !== null ? `${money(c.input_usd)}/${money(c.output_usd)}` : null) : c.kind === 'image' ? (c.input_usd !== null ? `${money(c.input_usd)}/img` : null) : null,
    c.quality_score ? `Q${c.quality_score}` : null, c.recommended ? tl("★ consigliato") : null, reason ? `(${reason})` : null]
  return parts.filter(Boolean).join(' · ')
}

export default function ModelRolesPanel() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [pending, setPending] = useState<Record<string, string>>({})
  const query = useQuery<RolesResponse>({ queryKey: ['admin', 'ai-model-roles'], queryFn: async () => (await adminApi.getModelRoles()).data })

  const done = (data: RolesResponse) => { qc.setQueryData(['admin', 'ai-model-roles'], data); void qc.invalidateQueries({ queryKey: ['admin', 'ai-models'] }) }
  const assign = useMutation({
    mutationFn: async ({ role, value }: { role: string; value: string }) => { const [provider, ...rest] = value.split('|'); return (await adminApi.assignModelRole(role, { provider, model_id: rest.join('|') })).data as RolesResponse },
    onSuccess: (data, vars) => {
      done(data)
      setPending((current) => { const next = { ...current }; delete next[vars.role]; return next })
      toast({ title: tl("Modello aggiornato"), description: tl("Attivo subito: gli altri processi del server si allineano entro 30 secondi.") })
    },
    onError: (err: any) => toast({ variant: 'destructive', title: tl("Modello non applicato"), description: err?.response?.data?.detail || tl("Riprova tra poco.") }),
  })
  const reset = useMutation({
    mutationFn: async (role: string) => (await adminApi.resetModelRole(role)).data as RolesResponse,
    onSuccess: (data) => { done(data); toast({ title: tl("Ripristinato il modello predefinito") }) },
    onError: () => toast({ variant: 'destructive', title: tl("Ripristino non riuscito") }),
  })

  if (query.isLoading || !query.data) return <div className="admin-panel flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>

  return (
    <section className="admin-panel">
      <div className="admin-panel-head !block">
        <h2 className="text-sm font-semibold text-slate-900">{tl("Modelli in uso nella piattaforma")}</h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          {tl("Ogni riga è una funzione del sito e mostra il modello che sta usando adesso. Scegli un modello dalla tendina e premi")} <b>{tl("Applica")}</b>{tl(": il cambio vale per tutta la piattaforma, senza deploy. I modelli di testo vengono provati con una chiamata prima di essere attivati, così un errore non blocca le chat. ★ indica i migliori per qualità in rapporto al costo (tra quelli con punteggio).")}
        </p>
      </div>
      <div className="divide-y divide-[var(--admin-line)]">
        {GROUPS.map((group) => {
          const roles = query.data.roles.filter((role) => group.id.includes(role.group))
          if (!roles.length) return null
          return (
            <div key={group.title} className="px-4 py-4">
              <h3 className="admin-eyebrow">{group.title} <span className="font-normal normal-case tracking-normal text-slate-500">· {group.hint}</span></h3>
              <div className="mt-3 space-y-3">
                {roles.map((role) => {
                  const value = pending[role.id] ?? `${role.current.provider}|${role.current.model_id}`
                  const changed = value !== `${role.current.provider}|${role.current.model_id}`
                  const byProvider = (Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => ({ p, items: role.candidates.filter((c) => c.provider === p) })).filter((g) => g.items.length)
                  const known = role.candidates.some((c) => `${c.provider}|${c.model_id}` === `${role.current.provider}|${role.current.model_id}`)
                  const busy = (assign.isPending && assign.variables?.role === role.id) || (reset.isPending && reset.variables === role.id)
                  return (
                    <div key={role.id} className="grid gap-3 rounded-md border border-[var(--admin-line)] bg-[var(--admin-surface-2)] p-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.35fr)] lg:items-center">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{role.label}</p>
                        <p className="text-[11px] leading-4 text-slate-500">{role.description}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">{role.where.map((place) => <span key={place} className="admin-badge admin-badge-neutral">{place}</span>)}</div>
                      </div>
                      <div className="min-w-0 text-xs">
                        <p className="admin-eyebrow">{tl("In uso ora")}</p>
                        <p className="truncate font-semibold text-slate-900" title={role.current.model_id}>{role.current.display_name}</p>
                        <p className="text-[11px] text-slate-500">{PROVIDER_LABEL[role.current.provider]} · {priceLabel(role.current.model)}{role.current.model?.quality_score ? ` · Q${role.current.model.quality_score}` : ''}</p>
                        {role.overridden && <p className="mt-0.5 text-[11px] font-semibold text-[var(--admin-accent)]">{tl("Personalizzato")}{role.updated_by ? ` da ${role.updated_by}` : ''}</p>}
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <SearchableSelect value={value} disabled={busy} label={tl("Modello per {0}", role.label)}
                          onChange={(next) => setPending((current) => ({ ...current, [role.id]: next }))}
                          options={[
                            ...(!known ? [{ value: `${role.current.provider}|${role.current.model_id}`, label: role.current.display_name }] : []),
                            ...byProvider.flatMap(({ p, items }) => items.map((c) => ({ value: `${c.provider}|${c.model_id}`,
                              label: c.display_name, description: `${PROVIDER_LABEL[p]} · ${optionText(role, c)}`,
                              searchText: c.model_id, disabled: !!unusable(role, c) }))),
                          ]} />

                        <div className="flex flex-wrap items-center gap-2">
                          {changed && (
                            <>
                              <Button tone="accent" surface="solid" density="compact" onClick={() => assign.mutate({ role: role.id, value })} disabled={busy}>
                                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} {tl("Applica")}
                              </Button>
                              <button type="button" onClick={() => setPending((current) => { const next = { ...current }; delete next[role.id]; return next })} className="text-[11px] font-semibold text-slate-500 hover:text-slate-800">{tl("Annulla")}</button>
                            </>
                          )}
                          {!changed && role.overridden && (
                            <button type="button" onClick={() => reset.mutate(role.id)} disabled={busy} className="flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-slate-800">
                              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} {tl("Ripristina predefinito (")}{role.default.model_id})
                            </button>
                          )}
                          {!changed && !role.overridden && role.candidates.some((c) => c.recommended && `${c.provider}|${c.model_id}` !== `${role.current.provider}|${role.current.model_id}`) && (
                            <span className="flex items-center gap-1 text-[11px] text-amber-700"><Sparkles className="h-3 w-3" /> {tl("Esistono alternative ★ con miglior qualità/prezzo")}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        <div className="px-4 py-4">
          <h3 className="admin-eyebrow">{tl("Non modificabili da qui")}</h3>
          <ul className="mt-2 grid gap-2 text-[11px] text-slate-500 md:grid-cols-3">
            {query.data.fixed.map((item) => <li key={item.label} className="rounded-md border border-[var(--admin-line)] bg-[var(--admin-surface-2)] p-2"><b className="text-slate-800">{item.label}</b> · <span className="font-mono">{item.model}</span><br />{item.reason}</li>)}
          </ul>
        </div>
      </div>
    </section>
  )
}
