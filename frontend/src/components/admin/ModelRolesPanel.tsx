import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, RotateCcw, Sparkles } from '@/components/icons'
import { adminApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'

type Provider = 'openai' | 'anthropic' | 'deepseek'
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

const PROVIDER_LABEL: Record<Provider, string> = { anthropic: 'Anthropic', openai: 'OpenAI', deepseek: 'DeepSeek' }
const GROUPS: Array<{ id: Role['group'][]; title: string; hint: string }> = [
  { id: ['chat'], title: 'Chatbot e generazione di testo', hint: 'Chat di sessione, docente, tutor dei Notebook, Vibe Lab, ricerca nei documenti' },
  { id: ['vision'], title: 'Visione', hint: 'Analisi di immagini, PDF e anteprime' },
  { id: ['image'], title: 'Generazione di immagini', hint: 'Generatore di piattaforma e flussi agentici' },
  { id: ['voice'], title: 'Voce e tempo reale', hint: 'Interrogazione vocale, indagine, trascrizione e dettatura' },
]

const money = (value: number) => `$${value < 1 ? value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '') : value.toFixed(2).replace(/\.00$/, '')}`
export function priceLabel(model: Pick<Candidate, 'kind' | 'input_usd' | 'output_usd' | 'price_note'> | null): string {
  if (!model) return '—'
  if (model.kind === 'text') return model.input_usd !== null && model.output_usd !== null ? `${money(model.input_usd)} / ${money(model.output_usd)} per 1M token` : 'prezzo mancante'
  if (model.kind === 'image' && model.input_usd !== null) return `${money(model.input_usd)} per immagine`
  return model.price_note || 'vedi listino'
}
const unusable = (role: Role, c: Candidate) => !c.ready ? 'chiave API mancante' : (role.kind === 'text' && (c.input_usd === null || c.output_usd === null)) || (role.kind === 'image' && c.input_usd === null) ? 'prezzo mancante' : null
const optionText = (role: Role, c: Candidate) => {
  const reason = unusable(role, c)
  const parts = [c.display_name, c.kind === 'text' ? (c.input_usd !== null && c.output_usd !== null ? `${money(c.input_usd)}/${money(c.output_usd)}` : null) : c.kind === 'image' ? (c.input_usd !== null ? `${money(c.input_usd)}/img` : null) : null,
    c.quality_score ? `Q${c.quality_score}` : null, c.recommended ? '★ consigliato' : null, reason ? `(${reason})` : null]
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
      toast({ title: 'Modello aggiornato', description: 'Attivo subito: gli altri processi del server si allineano entro 30 secondi.' })
    },
    onError: (err: any) => toast({ variant: 'destructive', title: 'Modello non applicato', description: err?.response?.data?.detail || 'Riprova tra poco.' }),
  })
  const reset = useMutation({
    mutationFn: async (role: string) => (await adminApi.resetModelRole(role)).data as RolesResponse,
    onSuccess: (data) => { done(data); toast({ title: 'Ripristinato il modello predefinito' }) },
    onError: () => toast({ variant: 'destructive', title: 'Ripristino non riuscito' }),
  })

  if (query.isLoading || !query.data) return <div className="flex justify-center rounded-2xl border border-slate-200 bg-white py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-black text-[#1a1a2e]">Modelli in uso nella piattaforma</h2>
        <p className="mt-1 max-w-3xl text-xs text-slate-500">
          Ogni riga è una funzione del sito e mostra il modello che sta usando adesso. Scegli un modello dalla tendina e premi <b>Applica</b>: il cambio vale per tutta la piattaforma, senza deploy.
          I modelli di testo vengono provati con una chiamata prima di essere attivati, così un errore non blocca le chat. ★ indica i migliori per qualità in rapporto al costo (tra quelli con punteggio).
        </p>
      </div>
      <div className="divide-y divide-slate-100">
        {GROUPS.map((group) => {
          const roles = query.data.roles.filter((role) => group.id.includes(role.group))
          if (!roles.length) return null
          return (
            <div key={group.title} className="px-5 py-4">
              <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-400">{group.title} <span className="font-medium normal-case tracking-normal text-slate-300">· {group.hint}</span></h3>
              <div className="mt-3 space-y-3">
                {roles.map((role) => {
                  const value = pending[role.id] ?? `${role.current.provider}|${role.current.model_id}`
                  const changed = value !== `${role.current.provider}|${role.current.model_id}`
                  const byProvider = (Object.keys(PROVIDER_LABEL) as Provider[]).map((p) => ({ p, items: role.candidates.filter((c) => c.provider === p) })).filter((g) => g.items.length)
                  const known = role.candidates.some((c) => `${c.provider}|${c.model_id}` === `${role.current.provider}|${role.current.model_id}`)
                  const busy = (assign.isPending && assign.variables?.role === role.id) || (reset.isPending && reset.variables === role.id)
                  return (
                    <div key={role.id} className="grid gap-3 rounded-xl bg-slate-50/70 p-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1.35fr)] lg:items-center">
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800">{role.label}</p>
                        <p className="text-[11px] leading-4 text-slate-500">{role.description}</p>
                        <div className="mt-1.5 flex flex-wrap gap-1">{role.where.map((place) => <span key={place} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500 ring-1 ring-slate-200">{place}</span>)}</div>
                      </div>
                      <div className="min-w-0 text-xs">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">In uso ora</p>
                        <p className="truncate font-bold text-slate-800" title={role.current.model_id}>{role.current.display_name}</p>
                        <p className="text-[11px] text-slate-500">{PROVIDER_LABEL[role.current.provider]} · {priceLabel(role.current.model)}{role.current.model?.quality_score ? ` · Q${role.current.model.quality_score}` : ''}</p>
                        {role.overridden && <p className="mt-0.5 text-[10px] font-bold text-[#e85c8d]">Personalizzato{role.updated_by ? ` da ${role.updated_by}` : ''}</p>}
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <select
                          value={value}
                          onChange={(event) => setPending((current) => ({ ...current, [role.id]: event.target.value }))}
                          disabled={busy}
                          className="h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-[#e85c8d] focus:outline-none"
                          aria-label={`Modello per ${role.label}`}
                        >
                          {!known && <option value={`${role.current.provider}|${role.current.model_id}`}>{role.current.display_name}</option>}
                          {byProvider.map(({ p, items }) => (
                            <optgroup key={p} label={PROVIDER_LABEL[p]}>
                              {items.map((c) => <option key={c.id} value={`${c.provider}|${c.model_id}`} disabled={!!unusable(role, c)}>{optionText(role, c)}</option>)}
                            </optgroup>
                          ))}
                        </select>
                        <div className="flex flex-wrap items-center gap-2">
                          {changed && (
                            <>
                              <Button size="sm" onClick={() => assign.mutate({ role: role.id, value })} disabled={busy} className="h-7 gap-1 bg-[#e85c8d] px-3 text-xs text-white hover:bg-[#d34d7d]">
                                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Applica
                              </Button>
                              <button type="button" onClick={() => setPending((current) => { const next = { ...current }; delete next[role.id]; return next })} className="text-[11px] font-semibold text-slate-400 hover:text-slate-600">Annulla</button>
                            </>
                          )}
                          {!changed && role.overridden && (
                            <button type="button" onClick={() => reset.mutate(role.id)} disabled={busy} className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-700">
                              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />} Ripristina predefinito ({role.default.model_id})
                            </button>
                          )}
                          {!changed && !role.overridden && role.candidates.some((c) => c.recommended && `${c.provider}|${c.model_id}` !== `${role.current.provider}|${role.current.model_id}`) && (
                            <span className="flex items-center gap-1 text-[11px] text-amber-600"><Sparkles className="h-3 w-3" /> Esistono alternative ★ con miglior qualità/prezzo</span>
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
        <div className="px-5 py-4">
          <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-400">Non modificabili da qui</h3>
          <ul className="mt-2 grid gap-2 text-[11px] text-slate-500 md:grid-cols-3">
            {query.data.fixed.map((item) => <li key={item.label} className="rounded-lg bg-slate-50 p-2"><b className="text-slate-700">{item.label}</b> · <span className="font-mono">{item.model}</span><br />{item.reason}</li>)}
          </ul>
        </div>
      </div>
    </section>
  )
}
