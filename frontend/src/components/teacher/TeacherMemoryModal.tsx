import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Brain, Check, Loader2, Plus, Trash2, X } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { teacherMemoryApi } from '@/lib/api'

interface MemoryItem { id: string; kind: string; text: string; source: 'chat' | 'manual'; pinned: boolean; updated_at: string }
interface MemoryResponse { enabled: boolean; items: MemoryItem[]; max_items: number }
const KIND_LABEL: Record<string, string> = { preference: 'Preferenza', style: 'Stile', subject: 'Materia', project: 'Progetto', fact: 'Informazione' }

/** What the teacher's assistant remembers: learned automatically from chats, always visible, editable and deletable. */
export default function TeacherMemoryModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { toast } = useToast()
  const [draft, setDraft] = useState('')
  const key = ['teacher-memory']
  const query = useQuery<MemoryResponse>({ queryKey: key, queryFn: async () => (await teacherMemoryApi.get()).data })
  const refresh = () => qc.invalidateQueries({ queryKey: key })
  const fail = (err: any) => toast({ variant: 'destructive', title: 'Operazione non riuscita', description: err?.response?.data?.detail || 'Riprova tra poco.' })
  const toggle = useMutation({ mutationFn: (enabled: boolean) => teacherMemoryApi.setEnabled(enabled), onSuccess: refresh, onError: fail })
  const add = useMutation({ mutationFn: (text: string) => teacherMemoryApi.add(text), onSuccess: () => { setDraft(''); void refresh() }, onError: fail })
  const remove = useMutation({ mutationFn: (id: string) => teacherMemoryApi.remove(id), onSuccess: refresh, onError: fail })
  const pin = useMutation({ mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => teacherMemoryApi.update(id, { pinned }), onSuccess: refresh, onError: fail })
  const clear = useMutation({ mutationFn: () => teacherMemoryApi.clear(), onSuccess: () => { void refresh(); toast({ title: 'Memoria cancellata' }) }, onError: fail })
  const data = query.data

  return createPortal(
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col rounded-3xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Memoria dell'assistente">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
          <div className="flex gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700"><Brain className="h-5 w-5" /></span>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Memoria dell'assistente</h2>
              <p className="mt-0.5 text-xs leading-5 text-slate-500">
                L'assistente impara dalle tue conversazioni e conosce le tue sessioni e attività, così in ogni nuova chat parte già sapendo chi sei e cosa stai facendo.
                Qui vedi tutto ciò che ricorda: puoi correggerlo, fissarlo o cancellarlo. Non memorizza dati degli studenti.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100" aria-label="Chiudi"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3 text-sm">
          <span className="font-semibold text-slate-700">Usa la memoria nelle chat</span>
          <button
            type="button" role="switch" aria-checked={!!data?.enabled} disabled={!data || toggle.isPending}
            onClick={() => data && toggle.mutate(!data.enabled)}
            className={`relative h-6 w-11 rounded-full transition-colors ${data?.enabled ? 'bg-violet-600' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${data?.enabled ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-5">
          {query.isLoading && <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-violet-600" /></div>}
          {data && data.items.length === 0 && (
            <p className="rounded-2xl bg-slate-50 p-5 text-center text-sm text-slate-500">Ancora nessuna voce. Parlando con l'assistente di materie, preferenze e progetti, la memoria si riempirà da sola; puoi anche aggiungere tu una nota qui sotto.</p>
          )}
          {data?.items.map((item) => (
            <div key={item.id} className="group flex items-start gap-3 rounded-2xl border border-slate-200 p-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-slate-800">{item.text}</p>
                <p className="mt-1 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <span>{KIND_LABEL[item.kind] ?? item.kind}</span><span>·</span><span>{item.source === 'manual' ? 'scritta da te' : 'appresa dalle chat'}</span>
                </p>
              </div>
              <button onClick={() => pin.mutate({ id: item.id, pinned: !item.pinned })} title={item.pinned ? 'Fissata: non verrà modificata automaticamente' : 'Fissa: impedisce modifiche automatiche'}
                className={`rounded-lg px-2 py-1 text-[10px] font-bold ${item.pinned ? 'bg-violet-100 text-violet-700' : 'text-slate-400 hover:bg-slate-100'}`}>{item.pinned ? 'Fissata' : 'Fissa'}</button>
              <button onClick={() => remove.mutate(item.id)} className="rounded-lg p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-600" aria-label="Elimina"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>

        <div className="space-y-3 border-t border-slate-100 p-5">
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); if (draft.trim().length >= 3) add.mutate(draft.trim()) }}>
            <input value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={400} placeholder="Ricordati che… (es. Insegno italiano in seconda superiore)"
              className="h-10 flex-1 rounded-xl border border-slate-200 px-3 text-sm focus:border-violet-400 focus:outline-none" />
            <Button type="submit" disabled={draft.trim().length < 3 || add.isPending} className="gap-1">{add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Aggiungi</Button>
          </form>
          {data && data.items.length > 0 && (
            <button onClick={() => { if (window.confirm('Cancellare tutta la memoria dell\'assistente? L\'operazione non si può annullare.')) clear.mutate() }} disabled={clear.isPending}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /> Cancella tutta la memoria</button>
          )}
          <p className="flex items-center gap-1.5 text-[10px] text-slate-400"><Check className="h-3 w-3" /> Solo tu vedi questa memoria. Fino a {data?.max_items ?? 60} voci apprese; le più vecchie non fissate vengono sostituite.</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
