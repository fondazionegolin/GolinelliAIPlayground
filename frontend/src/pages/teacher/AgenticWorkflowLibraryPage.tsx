import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { agenticApi } from '@/lib/api'
import { Activity, Clock3, MoreVertical, Network, Play, Plus, Search, Trash2 } from 'lucide-react'

type GraphNode = { id: string; instanceId: string; x?: number; y?: number }
type GraphEdge = { from: string; to: string }
type WorkflowItem = { id: string; title: string; version: number; status: string; graph: { nodes?: GraphNode[]; edges?: GraphEdge[] }; created_at: string; updated_at: string }

const CATEGORY_COLOR: Record<string, string> = {
  csv: '#0284c7', data: '#0891b2', math: '#7c3aed', ml: '#16a34a', plot: '#ea580c',
  chatbot: '#4f46e5', control: '#d97706', ai: '#db2777', llm_chatbot: '#4f46e5', nlp: '#db2777',
}

export default function AgenticWorkflowLibraryPage({ sessionId }: { sessionId?: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [runningId, setRunningId] = useState<string | null>(null)
  const [runStatus, setRunStatus] = useState<Record<string, string>>({})
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const { data, isLoading } = useQuery({ queryKey: ['agentic-workflows'], queryFn: () => agenticApi.listWorkflows(), refetchInterval: 5000 })
  const workflows = useMemo<WorkflowItem[]>(() => {
    const items = (data?.data || []) as WorkflowItem[]
    const search = query.trim().toLocaleLowerCase('it')
    return items.filter((item) => !search || item.title.toLocaleLowerCase('it').includes(search))
  }, [data, query])

  const runWorkflow = async (workflow: WorkflowItem) => {
    setRunningId(workflow.id); setRunStatus((current) => ({ ...current, [workflow.id]: 'running' }))
    try {
      const chatbotFlow = (workflow.graph.nodes || []).some((node) => node.id.startsWith('chatbot.') || node.id === 'llm_chatbot')
      if (chatbotFlow && !sessionId) throw new Error('Seleziona una sessione di classe attiva')
      const response = await agenticApi.createRun(workflow.id, {}, chatbotFlow ? sessionId : undefined)
      setRunStatus((current) => ({ ...current, [workflow.id]: response.data.status }))
    } catch (error: any) {
      setRunStatus((current) => ({ ...current, [workflow.id]: error?.response?.data?.detail || error?.message || 'failed' }))
    } finally { setRunningId(null) }
  }

  const deleteWorkflow = async (workflow: WorkflowItem) => {
    if (!window.confirm(`Eliminare “${workflow.title}”?`)) return
    await agenticApi.deleteWorkflow(workflow.id)
    setOpenMenu(null)
    await queryClient.invalidateQueries({ queryKey: ['agentic-workflows'] })
  }

  return <div className="h-full overflow-y-auto bg-[#f5f6f8]">
    <div className="mx-auto max-w-[1500px] px-5 py-7 md:px-8">
      <header className="mb-7 flex flex-wrap items-end gap-4">
        <div className="min-w-0 flex-1"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white"><Network className="h-5 w-5" /></span><div><p className="text-[10px] font-black uppercase tracking-[.18em] text-violet-600">Dataflow Studio · Beta</p><h1 className="text-2xl font-black tracking-tight text-slate-950">I tuoi workflow</h1></div></div><p className="mt-3 max-w-2xl text-sm text-slate-500">Costruisci pipeline di dati, machine learning, matematica e chatbot. Ogni modifica viene salvata automaticamente sul server.</p></div>
        <button onClick={() => navigate('/teacher/agentic/new')} className="ui-cta flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-black"><Plus className="h-4 w-4" /> Nuovo workflow</button>
      </header>

      <div className="ui-search mb-5 flex items-center gap-3 p-3"><Search className="ml-1 h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Cerca nei workflow…" className="min-w-0 flex-1 border-0 bg-transparent text-sm outline-none" /><span className="rounded-lg bg-white/70 px-2.5 py-1 text-[10px] font-black text-slate-500 shadow-[var(--ds-shadow-1)]">{workflows.length}</span></div>

      {isLoading ? <div className="flex h-64 items-center justify-center"><Activity className="h-6 w-6 animate-spin text-violet-500" /></div> : workflows.length ? <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{workflows.map((workflow) => <article key={workflow.id} className="ui-card ui-card-interactive group overflow-hidden">
        <button onClick={() => navigate(`/teacher/agentic/${workflow.id}`)} className="block w-full text-left"><WorkflowPreview graph={workflow.graph} /><div className="px-4 pb-3 pt-4"><div className="flex items-start gap-2"><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-black text-slate-900">{workflow.title}</h2><p className="mt-1 text-[10px] text-slate-400">v{workflow.version} · {workflow.graph.nodes?.length || 0} nodi · {workflow.graph.edges?.length || 0} connessioni</p></div><span className="rounded-full bg-violet-50 px-2 py-1 text-[8px] font-black uppercase text-violet-700">workflow</span></div></div></button>
        <div className="flex items-center gap-2 p-3 shadow-[0_-1px_0_rgba(148,163,184,0.10)]"><button onClick={() => runWorkflow(workflow)} disabled={runningId === workflow.id} className="ui-cta flex h-9 flex-1 items-center justify-center gap-2 rounded-xl text-[11px] font-black disabled:opacity-50">{runningId === workflow.id ? <Activity className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Esegui</button><button onClick={() => navigate(`/teacher/agentic/${workflow.id}`)} className="ds-control h-9 rounded-xl px-3 text-[11px] font-bold">Apri</button><div className="relative"><button onClick={() => setOpenMenu(openMenu === workflow.id ? null : workflow.id)} className="ds-control flex h-9 w-9 items-center justify-center rounded-xl"><MoreVertical className="h-4 w-4" /></button>{openMenu === workflow.id && <div className="ds-popover absolute bottom-11 right-0 z-20 w-40 rounded-xl p-1"><button onClick={() => deleteWorkflow(workflow)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs font-bold text-rose-600 hover:bg-rose-50"><Trash2 className="h-3.5 w-3.5" /> Elimina</button></div>}</div></div>
        <div className="flex items-center justify-between border-t border-slate-50 px-4 py-2 text-[9px] text-slate-400"><span className="flex items-center gap-1"><Clock3 className="h-3 w-3" /> {new Date(workflow.updated_at).toLocaleString('it-IT', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><span className={runStatus[workflow.id] === 'completed' ? 'font-bold text-emerald-600' : runStatus[workflow.id]?.includes('fail') ? 'font-bold text-rose-600' : ''}>{runStatus[workflow.id] || 'Salvato'}</span></div>
      </article>)}</div> : <div className="flex min-h-[22rem] flex-col items-center justify-center rounded-3xl border-2 border-dashed border-slate-200 bg-white text-center"><span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50 text-violet-600"><Network className="h-7 w-7" /></span><h2 className="mt-4 text-lg font-black">Nessun workflow</h2><p className="mt-1 max-w-sm text-sm text-slate-400">Crea il primo flusso e combina sorgenti, trasformazioni, modelli e visualizzazioni.</p><button onClick={() => navigate('/teacher/agentic/new')} className="mt-5 flex h-10 items-center gap-2 rounded-xl bg-slate-950 px-4 text-xs font-black text-white"><Plus className="h-4 w-4" /> Crea workflow</button></div>}
    </div>
  </div>
}

function WorkflowPreview({ graph }: { graph?: { nodes?: GraphNode[]; edges?: GraphEdge[] } }) {
  const nodes = graph?.nodes || []; const edges = graph?.edges || []
  if (!nodes.length) return <div className="flex h-44 items-center justify-center bg-gradient-to-br from-slate-100 to-violet-50"><Network className="h-10 w-10 text-violet-200" /></div>
  const xs = nodes.map((node) => Number(node.x || 0)); const ys = nodes.map((node) => Number(node.y || 0)); const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys)
  const point = (node: GraphNode) => ({ x: 30 + ((Number(node.x || 0) - minX) / (maxX - minX || 1)) * 260, y: 25 + ((Number(node.y || 0) - minY) / (maxY - minY || 1)) * 105 })
  return <div className="h-44 bg-[radial-gradient(circle,#d7dce5_1px,transparent_1px)] bg-[length:16px_16px] p-3"><svg viewBox="0 0 320 155" className="h-full w-full">{edges.map((edge, index) => { const from = nodes.find((node) => node.instanceId === edge.from); const to = nodes.find((node) => node.instanceId === edge.to); if (!from || !to) return null; const a = point(from); const b = point(to); return <path key={index} d={`M${a.x+14},${a.y+8} C${(a.x+b.x)/2},${a.y+8} ${(a.x+b.x)/2},${b.y+8} ${b.x},${b.y+8}`} fill="none" stroke="#a78bfa" strokeWidth="2" /> })}{nodes.slice(0, 18).map((node) => { const p = point(node); const prefix = node.id.includes('.') ? node.id.split('.')[0] : node.id; return <g key={node.instanceId}><rect x={p.x} y={p.y} width="30" height="18" rx="5" fill={CATEGORY_COLOR[prefix] || '#64748b'} /><circle cx={p.x+7} cy={p.y+9} r="2.5" fill="white" opacity=".9" /><rect x={p.x+12} y={p.y+6} width="12" height="2.5" rx="1" fill="white" opacity=".75" /></g> })}</svg></div>
}
