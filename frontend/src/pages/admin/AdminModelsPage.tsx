import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ExternalLink, Loader2, Pencil, RefreshCw, Sparkles, X } from '@/components/icons'
import { adminApi } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import ModelRolesPanel, { priceLabel } from '@/components/admin/ModelRolesPanel'

type Provider = 'openai' | 'anthropic' | 'deepseek'
interface AiModel {
  id: string; kind: 'text' | 'image' | 'realtime' | 'transcribe'; offered: boolean; price_note: string | null; provider: Provider; model_id: string; display_name: string; status: 'active' | 'available' | 'deprecated'
  input_usd: number | null; output_usd: number | null; cached_input_usd: number | null; context_window: number | null
  quality_score: number | null; quality_source: string | null; notes: string | null
  blended_usd: number | null; value_score: number | null
  proposed_input_usd: number | null; proposed_output_usd: number | null; proposed_at: string | null
  price_checked_at: string | null; seen_in_api: boolean | null; is_new: boolean
}
interface ScanSummary {
  new_models: Array<{ provider: string; model_id: string; name: string }>
  price_changes: Array<{ provider: string; model_id: string; old: Array<number | null>; new: number[] }>
  not_in_api: Array<{ provider: string; model_id: string }>
  errors: Record<string, string>
  pricing_unverified: string[]
}
interface ModelsResponse {
  models: AiModel[]; usd_to_eur: number
  last_scan: { ran_at: string; trigger: string; summary: ScanSummary } | null
  provider_keys: Record<Provider, boolean>; pricing_urls: Record<Provider, string>
}

const PROVIDERS: Record<Provider, { label: string; color: string }> = {
  anthropic: { label: 'Anthropic', color: '#d97757' },
  openai: { label: 'OpenAI', color: '#10a37f' },
  deepseek: { label: 'DeepSeek', color: '#4d6bfe' },
}
const STATUS_LABEL = { active: 'Attivo', available: 'Rilevato', deprecated: 'Dismesso' } as const
const usd = (value: number | null | undefined, digits = 2) => (value === null || value === undefined ? '—' : `$${value.toFixed(value < 1 ? Math.max(digits, 3) : digits)}`)
const dateLabel = (value?: string | null) => (value ? new Date(value).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '—')

type SortKey = 'value' | 'quality' | 'cost' | 'name'
interface Draft { input_usd: string; output_usd: string; quality_score: string; status: AiModel['status'] }
const toNumber = (text: string) => (text.trim() === '' ? null : Number(text.replace(',', '.')))

export default function AdminModelsPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [provider, setProvider] = useState<Provider | 'all'>('all')
  const [kind, setKind] = useState<'text' | 'image' | 'voice'>('text')
  const [sort, setSort] = useState<SortKey>('value')
  const [showDeprecated, setShowDeprecated] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const query = useQuery<ModelsResponse>({ queryKey: ['admin', 'ai-models'], queryFn: async () => (await adminApi.getAiModels()).data })
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin', 'ai-models'] })
  const fail = (title: string) => (err: any) => toast({ variant: 'destructive', title, description: err?.response?.data?.detail || 'Riprova tra poco.' })

  const scan = useMutation({
    mutationFn: async () => (await adminApi.scanAiModels()).data as ScanSummary,
    onSuccess: (summary) => {
      void refresh()
      const parts = [`${summary.new_models.length} nuovi modelli`, `${summary.price_changes.length} variazioni di prezzo`]
      toast({ title: 'Controllo completato', description: parts.join(' · ') })
    },
    onError: fail('Controllo non riuscito'),
  })
  const save = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => adminApi.updateAiModel(id, data),
    onSuccess: () => { setEditing(null); setDraft(null); void refresh() },
    onError: fail('Salvataggio non riuscito'),
  })
  const act = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'apply' | 'dismiss' | 'ack' }) =>
      kind === 'apply' ? adminApi.applyAiModelProposal(id) : kind === 'dismiss' ? adminApi.dismissAiModelProposal(id) : adminApi.acknowledgeAiModel(id),
    onSuccess: (_, vars) => { void refresh(); if (vars.kind === 'apply') toast({ title: 'Prezzo applicato', description: 'I costi in crediti usano subito il nuovo listino.' }) },
    onError: fail('Operazione non riuscita'),
  })

  const offer = useMutation({
    mutationFn: ({ ids, offered }: { ids: string[]; offered: boolean }) => adminApi.setAiModelsOffered(ids, offered),
    onSuccess: (response) => {
      void refresh()
      const skipped = (response.data?.skipped ?? []) as string[]
      if (skipped.length) toast({ title: 'Alcuni modelli non sono stati modificati', description: `${skipped.join(', ')}: servono attivo e con prezzo (per nasconderlo: non è il modello predefinito).` })
    },
    onError: fail('Operazione non riuscita'),
  })

  const data = query.data
  const models = useMemo(() => {
    const list = (data?.models ?? []).filter((m) => (provider === 'all' || m.provider === provider) && (kind === 'voice' ? ['realtime', 'transcribe'].includes(m.kind) : m.kind === kind) && (showDeprecated || m.status !== 'deprecated'))
    const key = (m: AiModel) => sort === 'value' ? m.value_score ?? -1 : sort === 'quality' ? m.quality_score ?? -1 : sort === 'cost' ? -(m.blended_usd ?? Infinity) : 0
    return [...list].sort((a, b) => sort === 'name' ? a.display_name.localeCompare(b.display_name) : key(b) - key(a))
  }, [data, provider, sort, showDeprecated])

  const proposals = (data?.models ?? []).filter((m) => m.proposed_input_usd !== null)
  const fresh = (data?.models ?? []).filter((m) => m.is_new)
  const ranking = (data?.models ?? []).filter((m) => m.kind === 'text' && m.status !== 'deprecated' && m.value_score).sort((a, b) => b.value_score! - a.value_score!).slice(0, 8)
  const bestValue = ranking[0]?.value_score ?? 1
  const summary = data?.last_scan?.summary

  const startEdit = (m: AiModel) => {
    setEditing(m.id)
    setDraft({ input_usd: m.input_usd?.toString() ?? '', output_usd: m.output_usd?.toString() ?? '', quality_score: m.quality_score?.toString() ?? '', status: m.status })
  }
  const commit = (m: AiModel) => {
    if (!draft) return
    const body: Record<string, unknown> = { input_usd: toNumber(draft.input_usd), output_usd: toNumber(draft.output_usd), quality_score: toNumber(draft.quality_score), status: draft.status }
    if (draft.quality_score !== (m.quality_score?.toString() ?? '') && !m.quality_source) body.quality_source = 'Inserito manualmente'
    save.mutate({ id: m.id, data: body })
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-[#1a1a2e]">Modelli</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Catalogo dei modelli LLM di Anthropic, OpenAI e DeepSeek con listino prezzi ufficiale. I prezzi qui sotto sono quelli usati per calcolare i crediti
            (1 USD = {data?.usd_to_eur ?? '—'} EUR). Il controllo automatico gira ogni 24 ore: le nuove uscite e le variazioni di prezzo restano <b>proposte</b> finché non le approvi.
          </p>
        </div>
        <Button onClick={() => scan.mutate()} disabled={scan.isPending} className="gap-2 bg-[#e85c8d] text-white hover:bg-[#d34d7d]">
          {scan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Controlla ora
        </Button>
      </div>

      <ModelRolesPanel />

      {(() => {
        const selectable = (data?.models ?? []).filter((m) => m.kind === 'text' && m.status === 'active' && m.input_usd !== null && m.output_usd !== null)
        const shown = selectable.filter((m) => m.offered)
        const setMany = (list: AiModel[], offered: boolean) => offer.mutate({ ids: list.filter((m) => m.offered !== offered).map((m) => m.id), offered })
        return (
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="max-w-2xl">
                <h2 className="text-sm font-black text-slate-700">Modelli scelti nei selettori di chat</h2>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Spunta i modelli che docenti e studenti possono scegliere: nel selettore della chat docente, nel «Modello AI predefinito» della sessione e nel chatbot degli studenti.
                  Sono elencati solo i modelli attivi e con un prezzo (senza listino le chiamate non verrebbero addebitate). Il modello predefinito della piattaforma è sempre disponibile
                  e Gemini compare quando la sua chiave è configurata.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <span className="font-bold text-slate-500">{shown.length} di {selectable.length} nei selettori</span>
                <Button size="sm" variant="outline" disabled={offer.isPending || shown.length === selectable.length} onClick={() => setMany(selectable, true)}>Tutti</Button>
                <Button size="sm" variant="outline" disabled={offer.isPending || shown.length === 0} onClick={() => setMany(selectable, false)}>Nessuno</Button>
              </div>
            </div>
            {(Object.keys(PROVIDERS) as Provider[]).map((p) => {
              const list = selectable.filter((m) => m.provider === p)
              if (!list.length) return null
              return (
                <div key={p} className="mt-3">
                  <div className="mb-1.5 flex items-center gap-2 text-[11px] font-black uppercase tracking-wider text-slate-400">
                    <span className="h-2 w-2 rounded-full" style={{ background: PROVIDERS[p].color }} /> {PROVIDERS[p].label}
                    <button type="button" onClick={() => setMany(list, true)} disabled={offer.isPending} className="font-bold normal-case text-slate-400 underline hover:text-slate-600">tutti</button>
                    <button type="button" onClick={() => setMany(list, false)} disabled={offer.isPending} className="font-bold normal-case text-slate-400 underline hover:text-slate-600">nessuno</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {list.map((m) => (
                      <button key={m.id} type="button" aria-pressed={m.offered} disabled={offer.isPending}
                        onClick={() => offer.mutate({ ids: [m.id], offered: !m.offered })}
                        title={`${m.model_id} · ${usd(m.input_usd)} / ${usd(m.output_usd)} per 1M token`}
                        className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold transition ${m.offered ? 'border-[#e85c8d] bg-pink-50 text-[#b83b69]' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'}`}>
                        {m.offered ? <Check className="h-3 w-3" /> : <span className="h-3 w-3 rounded-full border border-slate-300" />}
                        {m.display_name}
                        <span className="font-normal text-slate-400">{usd(m.input_usd)}/{usd(m.output_usd)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </section>
        )
      })()}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ultimo controllo" value={dateLabel(data?.last_scan?.ran_at)} hint={data?.last_scan ? (data.last_scan.trigger === 'scheduled' ? 'automatico' : 'manuale') : 'mai eseguito'} />
        <Stat label="Nuovi modelli" value={String(fresh.length)} hint="da rivedere" tone={fresh.length ? 'pink' : undefined} />
        <Stat label="Variazioni di prezzo" value={String(proposals.length)} hint="in attesa di approvazione" tone={proposals.length ? 'amber' : undefined} />
        <Stat label="Non più nelle API" value={String(summary?.not_in_api.length ?? 0)} hint="modelli attivi non restituiti dal provider" tone={summary?.not_in_api.length ? 'amber' : undefined} />
      </div>

      {summary && Object.keys(summary.errors).length > 0 && (
        <div className="space-y-1 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
          <p className="flex items-center gap-1.5 font-bold"><AlertTriangle className="h-4 w-4" /> Alcune verifiche non sono riuscite</p>
          {Object.entries(summary.errors).map(([name, message]) => (
            <p key={name}><b>{PROVIDERS[name as Provider]?.label ?? name}:</b> {message}{' '}
              {data && <a href={data.pricing_urls[name as Provider]} target="_blank" rel="noreferrer" className="underline">apri il listino ufficiale</a>}</p>
          ))}
        </div>
      )}

      {proposals.length > 0 && (
        <section className="rounded-2xl border border-amber-200 bg-white p-4 shadow-sm">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-black text-slate-700"><Sparkles className="h-4 w-4 text-amber-500" /> Variazioni di prezzo rilevate sui listini ufficiali</h2>
          <div className="space-y-2">
            {proposals.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 text-xs">
                <span className="min-w-[10rem] font-bold text-slate-700">{m.display_name}</span>
                <span className="text-slate-500">attuale {usd(m.input_usd)} / {usd(m.output_usd)}</span>
                <span className="font-bold text-amber-700">→ nuovo {usd(m.proposed_input_usd)} / {usd(m.proposed_output_usd)}</span>
                <span className="ml-auto flex gap-2">
                  <Button size="sm" onClick={() => act.mutate({ id: m.id, kind: 'apply' })} disabled={act.isPending}><Check className="mr-1 h-3.5 w-3.5" /> Applica</Button>
                  <Button size="sm" variant="outline" onClick={() => act.mutate({ id: m.id, kind: 'dismiss' })} disabled={act.isPending}>Ignora</Button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-black text-slate-700">Migliori per qualità in rapporto al costo</h2>
        <p className="mb-3 text-xs text-slate-500">Punteggio di qualità diviso il costo per 1M di token (mix 3 token in ingresso : 1 in uscita). Barra più lunga = più qualità per ogni dollaro. Conta solo i modelli con un punteggio di qualità.</p>
        {ranking.length ? (
          <div className="space-y-1.5">
            {ranking.map((m, index) => (
              <div key={m.id} className="grid grid-cols-[1.25rem_minmax(0,11rem)_1fr_auto] items-center gap-2 text-xs">
                <span className="font-black text-slate-300">{index + 1}</span>
                <span className="truncate font-semibold text-slate-700" title={m.model_id}>{m.display_name}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${Math.max(4, (m.value_score! / bestValue) * 100)}%`, background: PROVIDERS[m.provider].color }} /></span>
                <span className="whitespace-nowrap text-[11px] text-slate-500">Q{m.quality_score} · {usd(m.blended_usd)}/1M · <b className="text-[#e85c8d]">{m.value_score}</b></span>
              </div>
            ))}
          </div>
        ) : <p className="py-6 text-center text-xs text-slate-400">Inserisci un punteggio di qualità nella tabella (matita) per vedere la classifica.</p>}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3 text-xs">
          {(['all', ...Object.keys(PROVIDERS)] as Array<Provider | 'all'>).map((p) => (
            <button key={p} onClick={() => setProvider(p)} className={`rounded-full px-3 py-1.5 font-bold ${provider === p ? 'bg-[#1a1a2e] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
              {p === 'all' ? 'Tutti' : PROVIDERS[p].label}
            </button>
          ))}
          <span className="mx-1 h-5 w-px bg-slate-200" />
          {([['text', 'Testo'], ['image', 'Immagini'], ['voice', 'Voce']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setKind(k)} className={`rounded-full px-3 py-1.5 font-bold ${kind === k ? 'bg-[#e85c8d] text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{label}</button>
          ))}
          <label className="ml-auto flex items-center gap-1.5 text-slate-500">Ordina per
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded-lg border border-slate-200 bg-white px-2 py-1">
              <option value="value">Qualità / costo</option><option value="quality">Qualità</option><option value="cost">Più economici</option><option value="name">Nome</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-slate-500"><input type="checkbox" checked={showDeprecated} onChange={(e) => setShowDeprecated(e.target.checked)} /> Mostra dismessi</label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wider text-slate-400">
              <tr><th className="px-3 py-2">Modello</th><th className="px-3 py-2 text-right">Input $/1M</th><th className="px-3 py-2 text-right">Output $/1M</th><th className="px-3 py-2 text-right">Costo mix</th>
                <th className="px-3 py-2 text-right">Qualità</th><th className="px-3 py-2 text-right">Qualità/$</th><th className="px-3 py-2">Stato</th><th className="px-3 py-2">Prezzo verificato</th><th className="px-3 py-2" /></tr>
            </thead>
            <tbody>
              {query.isLoading && <tr><td colSpan={9} className="py-10 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /></td></tr>}
              {models.map((m) => {
                const isEditing = editing === m.id && draft
                return (
                  <Fragment key={m.id}>
                    <tr className="border-t border-slate-100 hover:bg-slate-50/60">
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PROVIDERS[m.provider].color }} />
                          <div className="min-w-0">
                            <p className="font-bold text-slate-800">{m.display_name}
                              {m.is_new && <button onClick={() => act.mutate({ id: m.id, kind: 'ack' })} title="Segna come visto" className="ml-2 rounded-full bg-pink-100 px-2 py-0.5 text-[9px] font-black uppercase text-pink-700">Nuovo</button>}
                              {m.seen_in_api === false && m.status === 'active' && <span title="Il provider non lo restituisce più: potrebbe essere stato ritirato" className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[9px] font-black uppercase text-amber-700">Non in API</span>}
                            </p>
                            <p className="truncate font-mono text-[10px] text-slate-400">{m.model_id}</p>
                          </div>
                        </div>
                      </td>
                      {isEditing ? (
                        <>
                          <td className="px-2 text-right"><Input value={draft.input_usd} onChange={(e) => setDraft({ ...draft, input_usd: e.target.value })} className="ml-auto h-8 w-20 text-right text-xs" inputMode="decimal" /></td>
                          <td className="px-2 text-right"><Input value={draft.output_usd} onChange={(e) => setDraft({ ...draft, output_usd: e.target.value })} className="ml-auto h-8 w-20 text-right text-xs" inputMode="decimal" /></td>
                          <td className="px-3 text-right text-slate-400">—</td>
                          <td className="px-2 text-right"><Input value={draft.quality_score} onChange={(e) => setDraft({ ...draft, quality_score: e.target.value })} className="ml-auto h-8 w-16 text-right text-xs" inputMode="decimal" placeholder="0-100" /></td>
                          <td className="px-3 text-right text-slate-400">—</td>
                          <td className="px-2"><select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as AiModel['status'] })} className="h-8 rounded-lg border border-slate-200 bg-white px-1.5 text-xs">
                            {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                          <td />
                          <td className="whitespace-nowrap px-2 text-right">
                            <button onClick={() => commit(m)} disabled={save.isPending} className="rounded-lg p-1.5 text-emerald-600 hover:bg-emerald-50" aria-label="Salva"><Check className="h-4 w-4" /></button>
                            <button onClick={() => { setEditing(null); setDraft(null) }} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100" aria-label="Annulla"><X className="h-4 w-4" /></button>
                          </td>
                        </>
                      ) : (
                        <>
                          {m.kind === 'text' ? (
                            <>
                              <td className="px-3 text-right tabular-nums">{usd(m.input_usd)}</td>
                              <td className="px-3 text-right tabular-nums">{usd(m.output_usd)}</td>
                              <td className="px-3 text-right tabular-nums text-slate-500">{usd(m.blended_usd)}</td>
                              <td className="px-3 text-right tabular-nums" title={m.quality_source ?? undefined}>{m.quality_score ?? '—'}</td>
                              <td className="px-3 text-right font-bold tabular-nums text-[#e85c8d]">{m.value_score ?? '—'}</td>
                            </>
                          ) : (
                            <td colSpan={5} className="px-3 text-slate-500">{priceLabel(m)}</td>
                          )}
                          <td className="px-3"><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${m.status === 'active' ? 'bg-emerald-50 text-emerald-700' : m.status === 'available' ? 'bg-sky-50 text-sky-700' : 'bg-slate-100 text-slate-500'}`}>{STATUS_LABEL[m.status]}</span></td>
                          <td className="px-3 text-slate-400">{dateLabel(m.price_checked_at)}</td>
                          <td className="whitespace-nowrap px-2 text-right">
                            {m.kind === 'text' && (
                              <label className="mr-2 inline-flex cursor-pointer items-center gap-1 text-[10px] font-semibold text-slate-400" title="Mostra questo modello nei selettori di chat di docenti e studenti">
                                <input type="checkbox" checked={m.offered} onChange={(e) => save.mutate({ id: m.id, data: { offered: e.target.checked } })} /> Selettori
                              </label>
                            )}
                            <button onClick={() => startEdit(m)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Modifica"><Pencil className="h-3.5 w-3.5" /></button>
                          </td>
                        </>
                      )}
                    </tr>
                    {m.status === 'available' && m.input_usd === null && (
                      <tr className="bg-sky-50/50"><td colSpan={9} className="px-3 py-1.5 text-[11px] text-sky-800">
                        Nuovo modello rilevato dal provider senza prezzo: inserisci il listino (matita) per attivarlo nei calcoli
                        {data && <> oppure consulta <a href={data.pricing_urls[m.provider]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">il listino <ExternalLink className="h-3 w-3" /></a></>}.
                      </td></tr>
                    )}
                  </Fragment>
                )
              })}
              {!query.isLoading && models.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-slate-400">Nessun modello.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-4 py-3 text-[11px] leading-5 text-slate-400">
          Prezzi DeepSeek: tariffa di picco (nelle ore fuori picco costa la metà), così i budget non vengono sottostimati.
          La colonna «Qualità» è un punteggio 0–100 da fonti esterne (es. Artificial Analysis Intelligence Index): è indicativo e modificabile, passa il mouse per vedere la fonte.
          Il controllo legge i listini ufficiali ({data && (Object.keys(PROVIDERS) as Provider[]).map((p, i) => <Fragment key={p}>{i > 0 && ', '}<a href={data.pricing_urls[p]} target="_blank" rel="noreferrer" className="underline">{PROVIDERS[p].label}</a></Fragment>)}).
        </p>
      </section>
    </div>
  )
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'pink' | 'amber' }) {
  const color = tone === 'pink' ? 'text-[#e85c8d]' : tone === 'amber' ? 'text-amber-600' : 'text-[#1a1a2e]'
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-xl font-black ${color}`}>{value}</p>
      <p className="text-[11px] text-slate-400">{hint}</p>
    </div>
  )
}
