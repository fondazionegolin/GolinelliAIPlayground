import { Fragment, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, ChevronDown, ChevronRight, ExternalLink, Folder, FolderOpen, Loader2, Pencil, RefreshCw, Search, Sparkles, X } from '@/components/icons'
import { adminApi, type ModelScope } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import ModelRolesPanel, { priceLabel } from '@/components/admin/ModelRolesPanel'
import { tl } from '@/i18n/tl'
import { AdminBadge, AdminEmpty, AdminNotice, AdminPageHeader, AdminSection, AdminStat, AdminStatGrid, AdminTabs } from '@/components/admin/AdminUI'

type Provider = 'openai' | 'anthropic' | 'deepseek' | 'openrouter' | 'gemini' | 'ollama'
type Kind = 'text' | 'image' | 'realtime' | 'transcribe' | 'video'
interface AiModel {
  id: string; kind: Kind; offered: boolean; scopes: ModelScope[]; price_note: string | null; provider: Provider; model_id: string; display_name: string; status: 'active' | 'available' | 'deprecated'
  input_usd: number | null; output_usd: number | null; cached_input_usd: number | null; context_window: number | null
  quality_score: number | null; quality_source: string | null; notes: string | null
  blended_usd: number | null; value_score: number | null
  proposed_input_usd: number | null; proposed_output_usd: number | null; proposed_at: string | null
  price_checked_at: string | null; seen_in_api: boolean | null; is_new: boolean
}
interface ScopeMeta { id: ModelScope; label: string; group: string; hint: string; providers: Provider[]; default: { provider: string; model_id: string } }
interface ScanSummary {
  new_models: Array<{ provider: string; model_id: string; name: string }>
  price_changes: Array<{ provider: string; model_id: string; old: Array<number | null>; new: number[] }>
  not_in_api: Array<{ provider: string; model_id: string }>
  auto_priced?: Array<{ provider: string; model_id: string; new: number[] }>
  errors: Record<string, string>
  pricing_unverified: string[]
}
interface ModelsResponse {
  models: AiModel[]; usd_to_eur: number; scopes: ScopeMeta[]
  last_scan: { ran_at: string; trigger: string; summary: ScanSummary } | null
  provider_keys: Record<Provider, boolean>; pricing_urls: Record<Provider, string>
}

const PROVIDERS: Record<Provider, { label: string; color: string }> = {
  openai: { label: 'OpenAI', color: '#10a37f' },
  anthropic: { label: 'Anthropic', color: '#d97757' },
  deepseek: { label: 'DeepSeek', color: '#4d6bfe' },
  gemini: { label: 'Gemini', color: '#4285f4' },
  ollama: { label: 'Ollama', color: '#334155' },
  openrouter: { label: 'OpenRouter', color: '#6366f1' },
}
const PROVIDER_ORDER = Object.keys(PROVIDERS) as Provider[]
const KINDS = [
  { id: 'text', label: tl("Testo e chat") },
  { id: 'image', label: tl("Immagini") },
  { id: 'voice', label: tl("Voce e trascrizione") },
  { id: 'video', label: 'Video' },
] as const
type KindGroup = typeof KINDS[number]['id']
const kindGroupOf = (kind: Kind): KindGroup => (kind === 'realtime' || kind === 'transcribe' ? 'voice' : kind)

// OpenRouter resells hundreds of models: they are filed under the company that makes them.
const VENDOR_LABEL: Record<string, string> = {
  openai: 'OpenAI', google: 'Google', qwen: 'Qwen', mistralai: 'Mistral', anthropic: 'Anthropic', 'z-ai': 'Z.ai', deepseek: 'DeepSeek',
  minimax: 'MiniMax', nvidia: 'NVIDIA', 'x-ai': 'xAI', moonshotai: 'Moonshot AI', 'meta-llama': 'Meta', meta: 'Meta', tencent: 'Tencent',
  cohere: 'Cohere', 'aion-labs': 'AionLabs', 'bytedance-seed': 'ByteDance', bytedance: 'ByteDance', openrouter: 'OpenRouter', alibaba: 'Alibaba',
  xiaomi: 'Xiaomi', amazon: 'Amazon', perplexity: 'Perplexity', microsoft: 'Microsoft', 'black-forest-labs': 'Black Forest Labs', kwaivgi: 'Kling',
}
const OTHER_VENDORS = '…'
const SMALL_VENDOR = 3
const vendorOf = (m: AiModel) => {
  const raw = m.model_id.split('/')[0].replace(/^~/, '')
  return VENDOR_LABEL[raw] ?? raw.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}
const shortName = (m: AiModel) => (m.provider === 'openrouter' ? m.display_name.replace(/^[^:]{1,40}:\s*/, '') : m.display_name)

const STATUS_LABEL = { active: tl("Attivo"), available: tl("Rilevato"), deprecated: tl("Dismesso") } as const
const usd = (value: number | null | undefined, digits = 2) => (value === null || value === undefined ? '—' : `$${value.toFixed(value < 1 ? Math.max(digits, 3) : digits)}`)
const dateLabel = (value?: string | null) => (value ? new Date(value).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : '—')
const priced = (m: AiModel) => m.input_usd !== null && m.output_usd !== null
const inUse = (m: AiModel) => m.scopes.length > 0

type SortKey = 'value' | 'quality' | 'cost' | 'name'
interface Draft { input_usd: string; output_usd: string; quality_score: string; status: AiModel['status'] }
const toNumber = (text: string) => (text.trim() === '' ? null : Number(text.replace(',', '.')))

/** Folder of the catalogue tree: kind group / provider / (OpenRouter only) vendor; «inuse» lists every enabled model. */
const IN_USE = 'inuse'
function folderOf(m: AiModel, smallVendors: Set<string>) {
  const base = `${kindGroupOf(m.kind)}/${m.provider}`
  if (m.provider !== 'openrouter') return base
  const vendor = vendorOf(m)
  return `${base}/${smallVendors.has(`${kindGroupOf(m.kind)}:${vendor}`) ? OTHER_VENDORS : vendor}`
}

export default function AdminModelsPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [view, setView] = useState<'catalog' | 'sections' | 'value' | 'roles'>('catalog')
  const [search, setSearch] = useState('')
  const [folder, setFolder] = useState(IN_USE)
  const [open, setOpen] = useState<Set<string>>(() => new Set(['text']))
  const [scope, setScope] = useState<ModelScope>('chat')
  const [sort, setSort] = useState<SortKey>('name')
  const [showDeprecated, setShowDeprecated] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)

  const query = useQuery<ModelsResponse>({ queryKey: ['admin', 'ai-models'], queryFn: async () => (await adminApi.getAiModels()).data })
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'ai-models'] })
    void qc.invalidateQueries({ queryKey: ['scoped-models'] })
  }
  const fail = (title: string) => (err: any) => toast({ variant: 'destructive', title, description: err?.response?.data?.detail || tl("Riprova tra poco.") })

  const scan = useMutation({
    mutationFn: async () => (await adminApi.scanAiModels()).data as ScanSummary,
    onSuccess: (summary) => {
      refresh()
      const parts = [tl("{0} nuovi modelli", summary.new_models.length), tl("{0} variazioni di prezzo", summary.price_changes.length)]
      toast({ title: tl("Controllo completato"), description: parts.join(' · ') })
    },
    onError: fail(tl("Controllo non riuscito")),
  })
  const save = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Record<string, unknown> }) => adminApi.updateAiModel(id, data),
    onSuccess: () => { setEditing(null); setDraft(null); refresh() },
    onError: fail(tl("Salvataggio non riuscito")),
  })
  const act = useMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'apply' | 'dismiss' | 'ack' }) =>
      kind === 'apply' ? adminApi.applyAiModelProposal(id) : kind === 'dismiss' ? adminApi.dismissAiModelProposal(id) : adminApi.acknowledgeAiModel(id),
    onSuccess: (_, vars) => { refresh(); if (vars.kind === 'apply') toast({ title: tl("Prezzo applicato"), description: tl("I costi in crediti usano subito il nuovo listino.") }) },
    onError: fail(tl("Operazione non riuscita")),
  })
  const applyAll = useMutation({
    mutationFn: async () => (await adminApi.applyAllAiModelProposals()).data as { applied: number },
    onSuccess: (result) => { refresh(); toast({ title: tl("Prezzi applicati"), description: tl("{0} modelli aggiornati al nuovo listino.", result.applied) }) },
    onError: fail(tl("Operazione non riuscita")),
  })
  const enable = useMutation({
    mutationFn: ({ ids, scope: target, enabled }: { ids: string[]; scope: ModelScope; enabled: boolean }) => adminApi.setAiModelsScope(ids, target, enabled),
    onSuccess: (response) => {
      refresh()
      const skipped = (response.data?.skipped ?? []) as string[]
      if (skipped.length) toast({ title: tl("Alcuni modelli non sono stati abilitati"), description: tl("{0}: serve un listino, il modello non deve essere dismesso e il provider deve essere adatto alla sezione.", skipped.join(', ')) })
    },
    onError: fail(tl("Operazione non riuscita")),
  })

  const data = query.data
  const all = useMemo(() => data?.models ?? [], [data])
  const scopes = data?.scopes ?? []
  const scopeMeta = scopes.find((s) => s.id === scope)
  const scopeLabel = (id: string) => scopes.find((s) => s.id === id)?.label ?? id

  // Tree: counts per folder; OpenRouter vendors with few models are merged into «Altri produttori».
  const tree = useMemo(() => {
    const shown = all.filter((m) => showDeprecated || m.status !== 'deprecated')
    const perVendor = new Map<string, number>()
    for (const m of shown) if (m.provider === 'openrouter') perVendor.set(`${kindGroupOf(m.kind)}:${vendorOf(m)}`, (perVendor.get(`${kindGroupOf(m.kind)}:${vendorOf(m)}`) ?? 0) + 1)
    const small = new Set([...perVendor].filter(([, n]) => n < SMALL_VENDOR).map(([key]) => key))
    const counts = new Map<string, number>()
    for (const m of shown) {
      const path = folderOf(m, small).split('/')
      path.forEach((_, i) => { const key = path.slice(0, i + 1).join('/'); counts.set(key, (counts.get(key) ?? 0) + 1) })
    }
    const vendors = (group: KindGroup) => [...counts.keys()].filter((k) => k.startsWith(`${group}/openrouter/`)).map((k) => k.split('/')[2])
      .sort((a, b) => (a === OTHER_VENDORS ? 1 : b === OTHER_VENDORS ? -1 : (counts.get(`${group}/openrouter/${b}`)! - counts.get(`${group}/openrouter/${a}`)!) || a.localeCompare(b)))
    return { shown, counts, small, vendors, inUse: shown.filter(inUse).length }
  }, [all, showDeprecated])

  const searching = search.trim().length > 0
  const listed = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = tree.shown.filter((m) => searching
      ? `${m.display_name} ${m.model_id} ${m.provider}`.toLowerCase().includes(q)
      : folder === IN_USE ? inUse(m) : (folderOf(m, tree.small) + '/').startsWith(`${folder}/`))
    const key = (m: AiModel) => sort === 'value' ? m.value_score ?? -1 : sort === 'quality' ? m.quality_score ?? -1 : sort === 'cost' ? -(m.blended_usd ?? Infinity) : 0
    return [...list].sort((a, b) => sort === 'name' ? shortName(a).localeCompare(shortName(b)) : key(b) - key(a))
  }, [tree, folder, search, searching, sort])

  const proposals = all.filter((m) => m.proposed_input_usd !== null)
  const fresh = all.filter((m) => m.is_new)
  const ranking = all.filter((m) => m.kind === 'text' && m.status !== 'deprecated' && m.value_score).sort((a, b) => b.value_score! - a.value_score!).slice(0, 10)
  const bestValue = ranking[0]?.value_score ?? 1
  const summary = data?.last_scan?.summary

  const eligible = (m: AiModel) => m.kind === 'text' && m.status !== 'deprecated' && priced(m) && (!scopeMeta?.providers.length || scopeMeta.providers.includes(m.provider))
  const listedEligible = listed.filter(eligible)
  const listedOn = listedEligible.filter((m) => m.scopes.includes(scope))
  const toggleFolder = (key: string) => setOpen((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const pick = (key: string, expand = false) => {
    setFolder(key)
    setSearch('')
    if (expand) setOpen((current) => new Set(current).add(key))
  }

  const startEdit = (m: AiModel) => {
    setEditing(m.id)
    setDraft({ input_usd: m.input_usd?.toString() ?? '', output_usd: m.output_usd?.toString() ?? '', quality_score: m.quality_score?.toString() ?? '', status: m.status })
  }
  const commit = (m: AiModel) => {
    if (!draft) return
    const body: Record<string, unknown> = { input_usd: toNumber(draft.input_usd), output_usd: toNumber(draft.output_usd), quality_score: toNumber(draft.quality_score), status: draft.status }
    if (draft.quality_score !== (m.quality_score?.toString() ?? '') && !m.quality_source) body.quality_source = tl("Inserito manualmente")
    save.mutate({ id: m.id, data: body })
  }

  const folderLabel = folder === IN_USE ? tl("Abilitati in almeno una sezione") : folder.split('/').map((part, i) =>
    i === 0 ? KINDS.find((k) => k.id === part)?.label : i === 1 ? PROVIDERS[part as Provider]?.label : part === OTHER_VENDORS ? tl("Altri produttori") : part).join(' › ')
  const wide = searching || folder === IN_USE || folder.split('/').length < 2

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={tl("Modelli")}
        description={<span className="block max-w-3xl">{tl("Catalogo dei modelli con il listino (USD per 1M token) usato per i crediti. Sfoglia le cartelle, scegli la sezione da configurare e spunta i modelli che quella sezione può offrire. Il controllo automatico gira ogni 24 ore: nuove uscite e variazioni di prezzo restano proposte finché non le approvi.")}</span>}
        actions={
          <Button tone="accent" surface="solid" onClick={() => scan.mutate()} disabled={scan.isPending}>
            {scan.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {tl("Controlla ora")}
          </Button>
        }
      />

      <AdminStatGrid>
        <AdminStat label={tl("Ultimo controllo")} value={dateLabel(data?.last_scan?.ran_at)} hint={data?.last_scan ? (data.last_scan.trigger === 'scheduled' ? 'automatico' : 'manuale') : tl("mai eseguito")} />
        <AdminStat label={tl("Nuovi modelli")} value={String(fresh.length)} hint={tl("da rivedere")} tone={fresh.length ? 'warning' : 'neutral'} />
        <AdminStat label={tl("Variazioni di prezzo")} value={String(proposals.length)} hint={tl("in attesa di approvazione")} tone={proposals.length ? 'warning' : 'neutral'} />
        <AdminStat label={tl("Non più nelle API")} value={String(summary?.not_in_api.length ?? 0)} hint={tl("modelli attivi non restituiti dal provider")} tone={summary?.not_in_api.length ? 'warning' : 'neutral'} />
      </AdminStatGrid>

      {summary?.auto_priced && summary.auto_priced.length > 0 && (
        <AdminNotice tone="success" className="text-xs">
          <b>{tl("Prezzo preso in automatico dal listino ufficiale (modelli che ne erano privi):")}</b>{' '}
          {summary.auto_priced.map((item) => `${item.model_id} ${usd(item.new[0])}/${usd(item.new[1])}`).join(' · ')}
        </AdminNotice>
      )}
      {summary && Object.keys(summary.errors).length > 0 && (
        <AdminNotice tone="warning" icon={AlertTriangle}>
          <div className="space-y-1 text-xs">
            <p className="font-semibold">{tl("Alcune verifiche non sono riuscite")}</p>
            {Object.entries(summary.errors).map(([name, message]) => (
              <p key={name}><b>{PROVIDERS[name as Provider]?.label ?? name}:</b> {message}{' '}
                {data && <a href={data.pricing_urls[name as Provider]} target="_blank" rel="noreferrer" className="underline">{tl("apri il listino ufficiale")}</a>}</p>
            ))}
          </div>
        </AdminNotice>
      )}
      {proposals.length > 0 && (
        <section className="admin-panel border-l-[3px] border-l-amber-600">
          <div className="admin-panel-head flex-wrap">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Sparkles className="h-4 w-4 text-amber-700" /> {tl("Variazioni di prezzo rilevate sui listini ufficiali")}</h2>
            <Button tone="accent" surface="solid" density="compact" onClick={() => applyAll.mutate()} disabled={applyAll.isPending}><Check className="h-3.5 w-3.5" /> {tl("Applica tutte")} ({proposals.length})</Button>
          </div>
          <div className="divide-y divide-[var(--admin-line)]">
            {proposals.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-xs">
                <span className="min-w-[10rem] font-semibold text-slate-900">{m.display_name}</span>
                <span className="text-slate-500">attuale {usd(m.input_usd)} / {usd(m.output_usd)}</span>
                <span className="font-semibold text-amber-700">{tl("→ nuovo")} {usd(m.proposed_input_usd)} / {usd(m.proposed_output_usd)}</span>
                <span className="ml-auto flex gap-2">
                  <Button tone="accent" surface="solid" density="compact" onClick={() => act.mutate({ id: m.id, kind: 'apply' })} disabled={act.isPending}><Check className="h-3.5 w-3.5" /> {tl("Applica")}</Button>
                  <Button tone="neutral" surface="outline" density="compact" onClick={() => act.mutate({ id: m.id, kind: 'dismiss' })} disabled={act.isPending}>{tl("Ignora")}</Button>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <AdminTabs value={view} onChange={setView} options={[['catalog', tl("Catalogo")], ['sections', tl("Modelli per sezione")], ['value', tl("Qualità / costo")], ['roles', tl("Funzioni della piattaforma")]]} />

      {view === 'catalog' && (
        <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <nav className="admin-panel self-start p-2 text-[13px] lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto" aria-label={tl("Cartelle del catalogo")}>
            <FolderRow label={tl("Abilitati")} count={tree.inUse} depth={0} strong active={!searching && folder === IN_USE} onClick={() => pick(IN_USE)} />
            <div className="my-2 border-t border-[var(--admin-line)]" />
            {KINDS.map((group) => {
              const groupCount = tree.counts.get(group.id) ?? 0
              if (!groupCount) return null
              return (
                <div key={group.id}>
                  <FolderRow label={group.label} count={groupCount} depth={0} strong expandable expanded={open.has(group.id)}
                    active={!searching && folder === group.id} onToggle={() => toggleFolder(group.id)} onClick={() => pick(group.id, true)} />
                  {open.has(group.id) && PROVIDER_ORDER.map((provider) => {
                    const key = `${group.id}/${provider}`
                    const count = tree.counts.get(key) ?? 0
                    if (!count) return null
                    const vendors = provider === 'openrouter' ? tree.vendors(group.id) : []
                    return (
                      <Fragment key={key}>
                        <FolderRow label={PROVIDERS[provider].label} count={count} depth={1} dot={PROVIDERS[provider].color}
                          expandable={vendors.length > 0} expanded={open.has(key)} onToggle={() => toggleFolder(key)}
                          active={!searching && folder === key} onClick={() => pick(key, vendors.length > 0)} />
                        {open.has(key) && vendors.map((vendor) => (
                          <FolderRow key={vendor} label={vendor === OTHER_VENDORS ? tl("Altri produttori") : vendor} count={tree.counts.get(`${key}/${vendor}`) ?? 0} depth={2}
                            active={!searching && folder === `${key}/${vendor}`} onClick={() => pick(`${key}/${vendor}`)} />
                        ))}
                      </Fragment>
                    )
                  })}
                </div>
              )
            })}
            <label className="mt-2 flex items-center gap-2 border-t border-[var(--admin-line)] px-2 pt-2.5 text-xs text-slate-600">
              <input type="checkbox" className="accent-[var(--admin-accent)]" checked={showDeprecated} onChange={(e) => setShowDeprecated(e.target.checked)} /> {tl("Mostra dismessi")}
            </label>
          </nav>

          <section className="admin-panel min-w-0">
            <div className="admin-panel-head flex-wrap">
              <div className="min-w-0">
                <p className="admin-eyebrow">{searching ? tl("Risultati della ricerca") : tl("Cartella")}</p>
                <h2 className="truncate text-sm font-semibold text-slate-900">{searching ? `«${search.trim()}»` : folderLabel} <span className="font-normal tabular-nums text-slate-500">· {listed.length}</span></h2>
              </div>
              <div className="relative w-full sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tl("Cerca in tutto il catalogo…")} aria-label={tl("Cerca modello nel catalogo")} className="h-9 pl-9 text-sm" />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[var(--admin-line)] px-4 py-2.5 text-xs">
              <label className="flex items-center gap-2 font-medium text-slate-700">{tl("Sezione da configurare")}
                <select value={scope} onChange={(e) => setScope(e.target.value as ModelScope)} className="h-8 rounded-md border border-[var(--admin-line-strong)] bg-white px-2 font-semibold text-[var(--admin-accent)]">
                  {scopes.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              </label>
              {scopeMeta?.hint && <span className="text-slate-500">{scopeMeta.hint}</span>}
              <span className="ml-auto flex flex-wrap items-center gap-2">
                <span className="tabular-nums text-slate-600">{listedOn.length} / {listedEligible.length} {tl("abilitati qui")}</span>
                <Button tone="neutral" surface="outline" density="compact" disabled={enable.isPending || listedOn.length === listedEligible.length}
                  onClick={() => enable.mutate({ ids: listedEligible.filter((m) => !m.scopes.includes(scope)).map((m) => m.id), scope, enabled: true })}>{tl("Abilita tutti")}</Button>
                <Button tone="neutral" surface="outline" density="compact" disabled={enable.isPending || listedOn.length === 0}
                  onClick={() => enable.mutate({ ids: listedOn.map((m) => m.id), scope, enabled: false })}>{tl("Disabilita tutti")}</Button>
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label={tl("Ordina per")} className="h-8 rounded-md border border-[var(--admin-line-strong)] bg-white px-2">
                  <option value="name">{tl("Nome")}</option><option value="value">{tl("Qualità / costo")}</option><option value="quality">{tl("Qualità")}</option><option value="cost">{tl("Più economici")}</option>
                </select>
              </span>
            </div>

            {query.isLoading ? <AdminEmpty><Loader2 className="mx-auto h-5 w-5 animate-spin" /></AdminEmpty>
              : listed.length === 0 ? <AdminEmpty>{folder === IN_USE && !searching ? tl("Nessun modello abilitato: apri una cartella e spunta i modelli.") : tl("Nessun modello.")}</AdminEmpty>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[56rem] text-left text-xs">
                    <thead>
                      <tr>
                        <th className="w-10" title={scopeMeta?.label}>{tl("Qui")}</th>
                        <th>{tl("Modello")}</th><th className="text-right">Input $/1M</th><th className="text-right">Output $/1M</th>
                        <th className="text-right">{tl("Qualità")}</th><th className="text-right">{tl("Qualità/$")}</th><th>{tl("Stato")}</th><th>{tl("Abilitato in")}</th><th />
                      </tr>
                    </thead>
                    <tbody>
                      {listed.map((m) => {
                        const isEditing = editing === m.id && draft
                        const can = eligible(m)
                        const on = m.scopes.includes(scope)
                        const why = m.kind !== 'text' ? tl("Solo i modelli di testo compaiono nei menu") : m.status === 'deprecated' ? tl("Modello dismesso") : !priced(m) ? tl("Imposta prima il listino") : tl("Provider non adatto a questa sezione")
                        return (
                          <Fragment key={m.id}>
                            <tr>
                              <td>
                                <input type="checkbox" className="h-4 w-4 accent-[var(--admin-accent)] disabled:opacity-30" checked={on} disabled={enable.isPending || (!on && !can)}
                                  title={!can && !on ? why : undefined} onChange={(e) => enable.mutate({ ids: [m.id], scope, enabled: e.target.checked })}
                                  aria-label={tl("Abilita {0} in {1}", m.display_name, scopeMeta?.label ?? scope)} />
                              </td>
                              <td>
                                <p className="font-semibold text-slate-900">{wide ? m.display_name : shortName(m)}
                                  {m.is_new && <button onClick={() => act.mutate({ id: m.id, kind: 'ack' })} title={tl("Segna come visto")} className="admin-badge admin-badge-accent ml-2">{tl("Nuovo")}</button>}
                                  {m.seen_in_api === false && m.status === 'active' && <span title={tl("Il provider non lo restituisce più: potrebbe essere stato ritirato")} className="admin-badge admin-badge-warning ml-2">{tl("Non in API")}</span>}
                                </p>
                                <p className="truncate font-mono text-[11px] text-slate-500">{wide && `${PROVIDERS[m.provider].label} · `}{m.model_id}</p>
                              </td>
                              {isEditing ? (
                                <>
                                  <td className="text-right"><Input value={draft.input_usd} onChange={(e) => setDraft({ ...draft, input_usd: e.target.value })} className="ml-auto h-8 w-20 text-right text-xs" inputMode="decimal" /></td>
                                  <td className="text-right"><Input value={draft.output_usd} onChange={(e) => setDraft({ ...draft, output_usd: e.target.value })} className="ml-auto h-8 w-20 text-right text-xs" inputMode="decimal" /></td>
                                  <td className="text-right"><Input value={draft.quality_score} onChange={(e) => setDraft({ ...draft, quality_score: e.target.value })} className="ml-auto h-8 w-16 text-right text-xs" inputMode="decimal" placeholder="0-100" /></td>
                                  <td className="text-right text-slate-400">—</td>
                                  <td><select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as AiModel['status'] })} className="h-8 rounded-md border border-[var(--admin-line-strong)] bg-white px-1.5 text-xs">
                                    {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                                  <td />
                                  <td className="whitespace-nowrap text-right">
                                    <button onClick={() => commit(m)} disabled={save.isPending} className="rounded-md p-1.5 text-[var(--admin-accent)] hover:bg-[var(--admin-accent-soft)]" aria-label={tl("Salva")}><Check className="h-4 w-4" /></button>
                                    <button onClick={() => { setEditing(null); setDraft(null) }} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100" aria-label={tl("Annulla")}><X className="h-4 w-4" /></button>
                                  </td>
                                </>
                              ) : (
                                <>
                                  {m.kind === 'text' ? (
                                    <>
                                      <td className="text-right tabular-nums">{usd(m.input_usd)}</td>
                                      <td className="text-right tabular-nums">{usd(m.output_usd)}</td>
                                      <td className="text-right tabular-nums" title={m.quality_source ?? undefined}>{m.quality_score ?? '—'}</td>
                                      <td className="text-right font-semibold tabular-nums">{m.value_score ?? '—'}</td>
                                    </>
                                  ) : <td colSpan={4} className="text-slate-500">{priceLabel(m)}</td>}
                                  <td><AdminBadge tone={m.status === 'active' ? 'success' : 'neutral'}>{STATUS_LABEL[m.status]}</AdminBadge></td>
                                  <td className="max-w-[16rem]">
                                    {m.scopes.length ? <span className="flex flex-wrap gap-1">{m.scopes.map((s) => <AdminBadge key={s} tone={s === scope ? 'accent' : 'neutral'}>{scopeLabel(s)}</AdminBadge>)}</span> : <span className="text-slate-400">—</span>}
                                  </td>
                                  <td className="whitespace-nowrap text-right">
                                    <button onClick={() => startEdit(m)} className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={tl("Modifica")} title={tl("Modifica listino, qualità e stato")}><Pencil className="h-3.5 w-3.5" /></button>
                                  </td>
                                </>
                              )}
                            </tr>
                            {m.status === 'available' && m.input_usd === null && m.kind === 'text' && (
                              <tr className="bg-[var(--admin-surface-2)]"><td colSpan={9} className="py-1.5 text-[11px] text-slate-700">
                                {tl("Modello rilevato senza prezzo: inserisci il listino (matita) per poterlo abilitare")}
                                {data && <> {tl("oppure consulta")} <a href={data.pricing_urls[m.provider]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">{tl("il listino")} <ExternalLink className="h-3 w-3" /></a></>}.
                              </td></tr>
                            )}
                          </Fragment>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            <p className="border-t border-[var(--admin-line)] px-4 py-3 text-[11px] leading-5 text-slate-500">
              {tl("Prezzi DeepSeek: tariffa di picco (nelle ore fuori picco costa la metà), così i budget non vengono sottostimati. La colonna «Qualità» è un punteggio 0–100 da fonti esterne (es. Artificial Analysis Intelligence Index): è indicativo e modificabile, passa il mouse per vedere la fonte. Il controllo legge i listini ufficiali (")}{data && PROVIDER_ORDER.map((p, i) => <Fragment key={p}>{i > 0 && ', '}<a href={data.pricing_urls[p]} target="_blank" rel="noreferrer" className="underline">{PROVIDERS[p].label}</a></Fragment>)}).
            </p>
          </section>
        </div>
      )}

      {view === 'sections' && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {scopes.map((s) => {
            const enabled = all.filter((m) => m.scopes.includes(s.id)).sort((a, b) => a.provider.localeCompare(b.provider) || a.display_name.localeCompare(b.display_name))
            const fallback = all.find((m) => m.provider === s.default.provider && m.model_id === s.default.model_id)
            return (
              <AdminSection key={s.id} title={s.label} description={s.hint || undefined}
                actions={<Button tone="neutral" surface="outline" density="compact" onClick={() => { setScope(s.id); pick('text', true); setView('catalog') }}>{tl("Aggiungi")}</Button>}>
                <p className="mb-2 text-[11px] text-slate-500">{tl("Predefinito:")} <b className="text-slate-800">{fallback?.display_name ?? s.default.model_id}</b> <span className="text-slate-400">{tl("(si cambia in Funzioni della piattaforma)")}</span></p>
                {enabled.length ? (
                  <ul className="divide-y divide-[var(--admin-line)] rounded-md border border-[var(--admin-line)]">
                    {enabled.map((m) => (
                      <li key={m.id} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PROVIDERS[m.provider].color }} title={PROVIDERS[m.provider].label} />
                        <span className="min-w-0 flex-1 truncate font-medium text-slate-800" title={m.model_id}>{m.display_name}</span>
                        <span className="tabular-nums text-slate-500">{usd(m.input_usd)}/{usd(m.output_usd)}</span>
                        <button type="button" onClick={() => enable.mutate({ ids: [m.id], scope: s.id, enabled: false })} disabled={enable.isPending} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={tl("Togli {0}", m.display_name)}><X className="h-3.5 w-3.5" /></button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="rounded-md border border-dashed border-[var(--admin-line-strong)] px-3 py-4 text-center text-xs text-slate-500">{tl("Nessun modello abilitato: gli utenti usano solo il predefinito e il menu resta nascosto.")}</p>}
              </AdminSection>
            )
          })}
        </div>
      )}

      {view === 'value' && (
        <AdminSection title={tl("Migliori per qualità in rapporto al costo")} description={tl("Punteggio di qualità diviso il costo per 1M di token (mix 3 token in ingresso : 1 in uscita). Barra più lunga = più qualità per ogni dollaro. Conta solo i modelli con un punteggio di qualità.")}>
          {ranking.length ? (
            <div className="space-y-1.5">
              {ranking.map((m, index) => (
                <div key={m.id} className="grid grid-cols-[1.25rem_minmax(0,14rem)_1fr_auto] items-center gap-2 text-xs">
                  <span className="font-semibold tabular-nums text-slate-400">{index + 1}</span>
                  <span className="truncate font-semibold text-slate-800" title={m.model_id}>{m.display_name}</span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-[#eceef1]"><span className="block h-full rounded-full bg-[var(--admin-accent)]" style={{ width: `${Math.max(4, (m.value_score! / bestValue) * 100)}%` }} /></span>
                  <span className="whitespace-nowrap text-[11px] text-slate-500">Q{m.quality_score} · {usd(m.blended_usd)}/1M · <b className="text-slate-900">{m.value_score}</b></span>
                </div>
              ))}
            </div>
          ) : <p className="py-6 text-center text-xs text-slate-400">{tl("Inserisci un punteggio di qualità nella tabella (matita) per vedere la classifica.")}</p>}
        </AdminSection>
      )}

      {view === 'roles' && <ModelRolesPanel />}
    </div>
  )
}

function FolderRow({ label, count, depth, active, onClick, onToggle, expandable = false, expanded = false, strong = false, dot }: {
  label: string; count: number; depth: number; active: boolean; onClick: () => void
  onToggle?: () => void; expandable?: boolean; expanded?: boolean; strong?: boolean; dot?: string
}) {
  const Icon = active ? FolderOpen : Folder
  return (
    <div className={`flex items-center rounded-md ${active ? 'bg-[var(--admin-accent-soft)] text-[var(--admin-accent)]' : 'text-slate-700 hover:bg-[var(--admin-surface-2)]'}`} style={{ paddingLeft: `${depth * 0.85}rem` }}>
      <button type="button" onClick={onToggle} disabled={!expandable} tabIndex={expandable ? 0 : -1} aria-label={expanded ? tl("Chiudi cartella") : tl("Apri cartella")}
        className={`flex h-7 w-6 shrink-0 items-center justify-center ${expandable ? 'text-slate-400 hover:text-slate-700' : 'invisible'}`}>
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      <button type="button" onClick={onClick} aria-current={active ? 'true' : undefined} className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left">
        {dot ? <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: dot }} /> : <Icon className="h-3.5 w-3.5 shrink-0 opacity-70" />}
        <span className={`min-w-0 flex-1 truncate ${strong ? 'font-semibold' : ''}`}>{label}</span>
        <span className="text-[11px] tabular-nums text-slate-400">{count}</span>
      </button>
    </div>
  )
}
