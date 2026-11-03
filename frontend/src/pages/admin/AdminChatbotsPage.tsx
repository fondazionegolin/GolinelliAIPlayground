import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2, X } from '@/components/icons'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { adminApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import { tl } from '@/i18n/tl'
import { AdminPageHeader } from '@/components/admin/AdminUI'

interface StudentChatbot { key: string; name: string; description: string; enabled: boolean }
interface StarterBot { id: string; name: string; synopsis?: string }
interface StarterConfig { candidates: StarterBot[]; student: StarterBot[]; teacher: StarterBot[] }

export default function AdminChatbotsPage() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const starters = useQuery<StarterConfig>({ queryKey: ['admin-default-teacherbots'], queryFn: async () => (await adminApi.getDefaultTeacherbots()).data })
  const saveStarters = useMutation({
    mutationFn: (next: { student: string[]; teacher: string[] }) => adminApi.setDefaultTeacherbots(next),
    onSuccess: (response) => {
      queryClient.setQueryData(['admin-default-teacherbots'], response.data)
      void queryClient.invalidateQueries({ queryKey: ['teacher-default-teacherbots'] })
      void queryClient.invalidateQueries({ queryKey: ['student-teacherbots'] })
      toast({ title: tl("Teacherbot iniziali aggiornati") })
    },
    onError: (error: any) => toast({ variant: 'destructive', title: tl("Salvataggio non riuscito"), description: error?.response?.data?.detail }),
  })
  const changeStarters = (audience: 'student' | 'teacher', ids: string[]) => {
    if (!starters.data) return
    saveStarters.mutate({ student: starters.data.student.map((b) => b.id), teacher: starters.data.teacher.map((b) => b.id), [audience]: ids })
  }
  const { data, isLoading } = useQuery({
    queryKey: ['admin-student-chatbots'],
    queryFn: async () => (await adminApi.getStudentChatbots()).data as { profiles: StudentChatbot[] },
  })
  const save = useMutation({
    mutationFn: (keys: string[]) => adminApi.setStudentChatbots(keys),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-student-chatbots'] })
      queryClient.invalidateQueries({ queryKey: ['chatbot-profiles'] })
      toast({ title: tl("Chatbot studenti aggiornati") })
    },
    onError: (e: any) => toast({ title: tl("Errore"), description: e?.response?.data?.detail || tl("Salvataggio non riuscito"), variant: 'destructive' }),
  })

  const profiles = data?.profiles ?? []
  const enabledKeys = profiles.filter((p) => p.enabled).map((p) => p.key)
  const toggle = (p: StudentChatbot) => {
    const next = p.enabled ? enabledKeys.filter((k) => k !== p.key) : [...enabledKeys, p.key]
    if (next.length === 0) {
      toast({ title: tl("Serve almeno un chatbot"), description: tl("Lascia attivo almeno un chatbot generalista."), variant: 'destructive' })
      return
    }
    save.mutate(next)
  }

  return (
    <div className="space-y-5">
      <AdminPageHeader
        title={tl("Chatbot iniziali")}
        description={<span className="block max-w-3xl">{tl("Scegli quali chatbot predefiniti trovano gli studenti in Spazio AI. Di base c'è un solo assistente generalista (Tutor AI): i chatbot specializzati o personalizzati vanno creati dai docenti nella sezione Teacherbot. Le conversazioni già avviate restano consultabili.")}</span>}
      />
      <section className="admin-panel p-5">
        <h2 className="font-bold text-[var(--admin-ink)]">{tl("Teacherbot per tutti")}</h2>
        <p className="mb-4 mt-1 text-sm text-[var(--admin-ink-2)]">{tl("Scegli tra i teacherbot creati con il tuo account admin. Saranno disponibili automaticamente per tutti gli utenti del gruppo, senza pubblicazioni per classe. I docenti possono usarli senza modificare la tua configurazione.")}</p>
        {starters.isError && <p role="alert">{tl("Impossibile caricare i teacherbot iniziali.")}</p>}
        {(['student', 'teacher'] as const).map((audience) => {
          const selected = starters.data?.[audience] || []
          return <div key={audience} className="mb-5 last:mb-0">
            <h3 className="mb-2 text-sm font-semibold text-[var(--admin-ink)]">{audience === 'student' ? tl("Studenti") : tl("Docenti")}</h3>
            <SearchableSelect label={tl("Aggiungi un teacherbot")} value="" disabled={saveStarters.isPending || starters.isLoading}
              onChange={(id) => changeStarters(audience, [...selected.map((b) => b.id), id])}
              options={(starters.data?.candidates || []).filter((b) => !selected.some((s) => s.id === b.id)).map((b) => ({ value: b.id, label: b.name, description: b.synopsis }))} />
            <div className="mt-2 flex flex-wrap gap-2">{selected.map((bot) => <span key={bot.id} className="flex items-center gap-2 rounded-lg bg-[var(--admin-tint)] px-3 py-2 text-sm text-[var(--admin-ink)]">{bot.name}<button type="button" aria-label={tl("Rimuovi {0}", bot.name)} disabled={saveStarters.isPending} onClick={() => changeStarters(audience, selected.filter((b) => b.id !== bot.id).map((b) => b.id))}><X className="h-3.5 w-3.5" /></button></span>)}</div>
            {!selected.length && <p className="mt-2 text-xs text-[var(--admin-ink-2)]">{tl("Nessun teacherbot aggiuntivo selezionato.")}</p>}
          </div>
        })}
      </section>
      <section className="admin-panel">
        {isLoading ? (
          <div className="flex justify-center p-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : (
          <ul className="divide-y divide-[var(--admin-line)]">
            {profiles.map((p) => (
              <li key={p.key} className="flex items-center justify-between gap-4 px-4 py-3.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--admin-ink)]">{p.name}</p>
                  <p className="text-sm text-[var(--admin-ink-2)]">{p.description}</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={p.enabled}
                  aria-label={p.name}
                  disabled={save.isPending}
                  onClick={() => toggle(p)}
                  className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${p.enabled ? 'bg-[var(--admin-accent)]' : 'bg-slate-300'}`}
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
