import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import QRCode from 'qrcode'
import { ArrowLeft, CheckCircle2, ChevronDown, Clock3, Loader2, LockKeyhole, Maximize2, PackageOpen, Play, Square, Trophy, Users } from '@/components/icons'
import { liveInteractionApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'
import AchievementIcon from '@/components/live/AchievementIcon'
import LiveInteractionPublicShareModal from '@/components/teacher/LiveInteractionPublicShareModal'
import { EscapeRoomEditDialog } from '@/pages/teacher/LiveInteractionBuilderPage'

interface Interaction {
  id: string
  title: string
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED'
  slides_json: unknown[]
  escape_config?: { narrative_intro?: string; mission?: string }
  started_at?: string | null
}

interface Participant {
  student_id: string
  student_nickname: string
  current_step: number
  total_steps: number
  attempts: number
  inventory: Array<{ name: string; icon: string }>
  duration_seconds: number
  completed: boolean
  rank?: number
  answers: Array<{ step_index: number; value: string; correct: boolean; submitted_at: string }>
}

interface Challenge {
  false_statement: string
  prompt: string
  accepted_answers: string[]
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export default function LiveEscapeRoomControl({ interaction, onBack }: { interaction: Interaction; onBack: () => void }) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [, forceTick] = useState(0)
  const { data: results, refetch } = useQuery({
    queryKey: ['live-interaction-results', interaction.id, 'escape'],
    queryFn: () => liveInteractionApi.results(interaction.id).then(response => response.data),
    refetchInterval: interaction.status === 'CLOSED' ? false : 2000,
  })

  // Lobby: open the public link as soon as the teacher lands on a draft room,
  // so the QR is visible and students can join before the start.
  const [publicCode, setPublicCode] = useState('')
  const [publicUrl, setPublicUrl] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [showShare, setShowShare] = useState(false)
  const [showEdit, setShowEdit] = useState(false)

  useEffect(() => {
    if (interaction.status !== 'DRAFT') return
    let cancelled = false
    liveInteractionApi.enablePublicLink(interaction.id)
      .then(response => {
        if (cancelled) return
        setPublicCode(response.data.access_code)
        setPublicUrl(`${window.location.origin}/live/${response.data.token}`)
      })
      .catch(() => toast({ title: 'Impossibile creare il link pubblico', variant: 'destructive' }))
    return () => { cancelled = true }
  }, [interaction.id, interaction.status]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!publicUrl) return
    QRCode.toDataURL(publicUrl, { width: 480, margin: 2, errorCorrectionLevel: 'H', color: { dark: '#111827', light: '#ffffff' } })
      .then(setQrDataUrl)
      .catch(() => {})
  }, [publicUrl])

  useEffect(() => {
    if (interaction.status !== 'ACTIVE') return
    const id = window.setInterval(() => forceTick(value => value + 1), 1000)
    return () => window.clearInterval(id)
  }, [interaction.status])

  const start = useMutation({
    mutationFn: () => liveInteractionApi.start(interaction.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['live-interaction', interaction.id] })
      await refetch()
    },
    onError: () => toast({ title: 'Impossibile avviare la sessione', variant: 'destructive' }),
  })
  const end = useMutation({
    mutationFn: () => liveInteractionApi.end(interaction.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['live-interaction', interaction.id] })
      await refetch()
    },
  })

  const participants: Participant[] = results?.participants || []
  const challenges: Challenge[] = results?.challenges || []
  const completed = participants.filter(item => item.completed).length
  const totalStudents = results?.total_students || 0
  const liveSeconds = interaction.started_at ? Math.max(0, Math.floor((Date.now() - new Date(interaction.started_at).getTime()) / 1000)) : 0

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="h-4 w-4" /> Lista</button>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold text-slate-900">{interaction.title}</h1>
        <span className={`rounded-full px-3 py-1 text-sm font-semibold ${interaction.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' : interaction.status === 'CLOSED' ? 'bg-slate-100 text-slate-600' : 'bg-amber-100 text-amber-700'}`}>{interaction.status === 'ACTIVE' ? '● LIVE' : interaction.status === 'CLOSED' ? 'Completata' : 'Bozza'}</span>
      </div>

      {interaction.status === 'DRAFT' ? (
        <section className="overflow-hidden rounded-3xl bg-gradient-to-br from-violet-700 via-indigo-700 to-slate-900 p-6 text-white shadow-xl sm:p-10">
          <div className="grid items-center gap-8 md:grid-cols-[minmax(220px,300px)_1fr]">
            <div className="mx-auto w-full max-w-[300px]">
              <div className="overflow-hidden rounded-3xl bg-white p-3 shadow-2xl">
                {qrDataUrl
                  ? <img src={qrDataUrl} alt="QR code per entrare nell'escape room" className="aspect-square w-full" />
                  : <div className="flex aspect-square w-full items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>}
              </div>
              <button onClick={() => setShowShare(true)} disabled={!publicUrl} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20 disabled:opacity-50"><Maximize2 className="h-4 w-4" /> Proietta QR a schermo intero</button>
            </div>
            <div className="text-center md:text-left">
              <LockKeyhole className="mx-auto h-10 w-10 text-violet-200 md:mx-0" />
              <h2 className="mt-3 text-3xl font-black">La stanza è pronta</h2>
              <p className="mt-2 max-w-xl text-white/70">{interaction.escape_config?.mission || `${interaction.slides_json.length} indizi con inventario e classifica finale.`}</p>
              {publicCode && <p className="mt-4 text-xs font-bold uppercase tracking-widest text-white/50">Codice Live <span className="ml-2 text-2xl font-black tracking-[0.18em] text-amber-300">{publicCode}</span></p>}
              {publicUrl && <p className="mt-1 break-all font-mono text-sm text-violet-200">{publicUrl}</p>}
              <div className="mt-5 rounded-2xl bg-white/10 p-4 ring-1 ring-white/15">
                <p className="flex items-center justify-center gap-2 text-sm font-bold md:justify-start"><Users className="h-4 w-4" /> {participants.length} {participants.length === 1 ? 'studente pronto' : 'studenti pronti'}</p>
                <div className="mt-3 flex max-h-40 flex-wrap justify-center gap-2 overflow-y-auto md:justify-start">
                  {participants.map(item => <span key={item.student_id} className="rounded-full bg-white/15 px-3 py-1 text-sm font-semibold">{item.student_nickname}</span>)}
                  {participants.length === 0 && <span className="text-sm text-white/60">In attesa che gli studenti scansionino il QR…</span>}
                </div>
              </div>
              <button onClick={() => setShowEdit(true)} className="mt-5 block text-sm font-semibold text-white/80 underline-offset-2 hover:text-white hover:underline md:text-left">Modifica indizi o rigenera il set ({interaction.slides_json.length})</button>
              <button onClick={() => start.mutate()} disabled={start.isPending} className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-white px-7 py-3.5 font-bold text-violet-700 shadow-lg disabled:opacity-60">{start.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />} Via! Avvia l'escape room</button>
            </div>
          </div>
          {showEdit && <EscapeRoomEditDialog interactionId={interaction.id} onClose={() => setShowEdit(false)} />}
          {showShare && <LiveInteractionPublicShareModal interactionId={interaction.id} title={interaction.title} onClose={() => setShowShare(false)} />}
        </section>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric icon={Users} label="Partecipanti" value={`${participants.length}/${totalStudents}`} />
            <Metric icon={CheckCircle2} label="Completate" value={`${completed}/${totalStudents}`} />
            <Metric icon={Clock3} label="Tempo sessione" value={formatTime(results?.ended_at ? Math.floor((new Date(results.ended_at).getTime() - new Date(results.started_at).getTime()) / 1000) : liveSeconds)} />
            <Metric icon={PackageOpen} label="Indizi" value={String(results?.total_steps || interaction.slides_json.length)} />
          </section>

          {interaction.status === 'ACTIVE' && <div className="flex justify-end"><button onClick={() => end.mutate()} disabled={end.isPending} className="flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white"><Square className="h-4 w-4" /> Chiudi e calcola classifica</button></div>}

          <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4"><Trophy className="h-5 w-5 text-amber-500" /><h2 className="font-bold text-slate-900">{interaction.status === 'CLOSED' ? 'Classifica finale' : 'Avanzamento in tempo reale'}</h2></div>
            <div className="divide-y divide-slate-100">
              {participants.map((item, index) => (
                <div key={item.student_id} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-4">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 font-bold text-slate-600">{item.completed ? item.rank || index + 1 : '—'}</span>
                  <div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate font-semibold text-slate-800">{item.student_nickname}</span>{item.completed && <CheckCircle2 className="h-4 w-4 text-emerald-500" />}</div><div className="mt-1 flex items-center gap-3 text-xs text-slate-500"><span>{item.current_step}/{item.total_steps} indizi</span><span>{item.attempts} tentativi</span><span className="flex gap-1">{item.inventory.map((object, i) => <AchievementIcon key={i} icon={object.icon} index={i} size={18} title={object.name} />)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-violet-500" style={{ width: `${item.total_steps ? item.current_step / item.total_steps * 100 : 0}%` }} /></div></div>
                  <span className="font-mono text-sm font-bold text-slate-700">{formatTime(item.duration_seconds)}</span>
                  {interaction.status === 'CLOSED' && (
                    <details className="group col-span-3 mt-1 rounded-xl border border-slate-200 bg-slate-50/70">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-sm font-semibold text-violet-700 marker:hidden">
                        Domande e risposte <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                      </summary>
                      <div className="space-y-4 border-t border-slate-200 px-4 py-4">
                        {challenges.map((challenge, stepIndex) => {
                          const answers = (item.answers || []).filter(answer => answer.step_index === stepIndex)
                          return (
                            <div key={stepIndex} className="rounded-xl border border-slate-200 bg-white p-3">
                              <p className="text-xs font-bold uppercase tracking-wide text-violet-700">Indizio {stepIndex + 1}</p>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{challenge.false_statement}</p>
                              {challenge.prompt && <p className="mt-1 text-xs text-slate-500">{challenge.prompt}</p>}
                              {answers.length > 0 ? (
                                <ul className="mt-3 space-y-1.5">
                                  {answers.map((answer, answerIndex) => (
                                    <li key={answerIndex} className="flex items-start gap-2 text-sm">
                                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${answer.correct ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{answer.correct ? 'Corretta' : 'Errata'}</span>
                                      <span className="min-w-0 whitespace-pre-wrap break-words text-slate-700">{answer.value}</span>
                                    </li>
                                  ))}
                                </ul>
                              ) : <p className="mt-2 text-xs text-slate-500">{stepIndex <= item.current_step && item.attempts > 0 ? 'Risposte non disponibili per questa sessione.' : 'Nessuna risposta.'}</p>}
                            </div>
                          )
                        })}
                      </div>
                    </details>
                  )}
                </div>
              ))}
              {participants.length === 0 && <p className="p-10 text-center text-sm text-slate-400">In attesa che gli studenti entrino nella stanza…</p>}
            </div>
          </section>
        </>
      )}
    </div>
  )
}

function Metric({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><Icon className="h-5 w-5 text-violet-600" /><p className="mt-3 text-2xl font-black text-slate-900">{value}</p><p className="text-xs text-slate-500">{label}</p></div>
}
