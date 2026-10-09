import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from '@/components/icons'
import { adminApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'

interface StudentChatbot { key: string; name: string; description: string; enabled: boolean }

export default function AdminChatbotsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['admin-student-chatbots'],
    queryFn: async () => (await adminApi.getStudentChatbots()).data as { profiles: StudentChatbot[] },
  })
  const save = useMutation({
    mutationFn: (keys: string[]) => adminApi.setStudentChatbots(keys),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-student-chatbots'] })
      queryClient.invalidateQueries({ queryKey: ['chatbot-profiles'] })
      toast({ title: 'Chatbot studenti aggiornati' })
    },
    onError: (e: any) => toast({ title: 'Errore', description: e?.response?.data?.detail || 'Salvataggio non riuscito', variant: 'destructive' }),
  })

  const profiles = data?.profiles ?? []
  const enabledKeys = profiles.filter((p) => p.enabled).map((p) => p.key)
  const toggle = (p: StudentChatbot) => {
    const next = p.enabled ? enabledKeys.filter((k) => k !== p.key) : [...enabledKeys, p.key]
    if (next.length === 0) {
      toast({ title: 'Serve almeno un chatbot', description: 'Lascia attivo almeno un chatbot generalista.', variant: 'destructive' })
      return
    }
    save.mutate(next)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-[#1a1a2e]">Chatbot studenti</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Scegli quali chatbot predefiniti trovano gli studenti in Spazio AI. Di base c'è un solo assistente generalista (Tutor AI):
          i chatbot specializzati o personalizzati vanno creati dai docenti nella sezione Teacherbot. Le conversazioni già avviate restano consultabili.
        </p>
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        {isLoading ? (
          <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {profiles.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <p className="font-bold text-[#1a1a2e]">{p.name}</p>
                  <p className="text-sm text-slate-500">{p.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={p.enabled}
                  aria-label={p.name}
                  disabled={save.isPending}
                  onClick={() => toggle(p)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${p.enabled ? 'bg-[#e85c8d]' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${p.enabled ? 'left-[22px]' : 'left-0.5'}`} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
