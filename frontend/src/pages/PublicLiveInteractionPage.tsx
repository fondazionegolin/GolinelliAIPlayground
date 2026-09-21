import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { useParams } from 'react-router-dom'
import { Clock3, Gamepad2, Loader2, LockKeyhole, Radio, UserRound } from 'lucide-react'

import { liveInteractionApi } from '@/lib/api'
import LiveInteractionStudentOverlay from '@/components/LiveInteractionStudentOverlay'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { LogoMark } from '@/components/LogoMark'

interface PublicLiveInfo {
  title: string
  live_interaction_id: string
  interaction_type: 'slides' | 'escape_room'
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED'
  access_code: string
  session_id: string
  session_title: string
}

interface GuestSession {
  student_id: string
  session_id: string
  session_title: string
  nickname: string
  join_token: string
}

export default function PublicLiveInteractionPage() {
  const { token = '' } = useParams()
  const [guestSession, setGuestSession] = useState<GuestSession | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(`public_live_session:${token}`) || 'null') } catch { return null }
  })
  const [info, setInfo] = useState<PublicLiveInfo | null>(null)
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState('')
  const joined = Boolean(info && guestSession?.session_id === info.session_id)

  useEffect(() => {
    liveInteractionApi.getPublicInfo(token)
      .then(response => setInfo(response.data))
      .catch((requestError: { response?: { data?: { detail?: string } } }) => setError(requestError.response?.data?.detail || 'Link non valido o non più attivo'))
      .finally(() => setLoading(false))
  }, [token])

  const join = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!nickname.trim()) return
    setJoining(true)
    setError('')
    try {
      const response = await liveInteractionApi.joinPublic(token, nickname.trim())
      const { join_token, student_id, session_id, session_title } = response.data
      const session = { join_token, student_id, session_id, session_title, nickname: response.data.nickname }
      sessionStorage.setItem('public_live_token', join_token)
      sessionStorage.setItem(`public_live_session:${token}`, JSON.stringify(session))
      setGuestSession(session)
    } catch (requestError: unknown) {
      setError((requestError as { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Non è stato possibile entrare')
    } finally {
      setJoining(false)
    }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-slate-950"><Loader2 className="h-8 w-8 animate-spin text-violet-300" /></div>

  if (!info) return <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6"><div className="max-w-md rounded-3xl bg-white p-8 text-center"><LockKeyhole className="mx-auto h-10 w-10 text-rose-500" /><h1 className="mt-4 text-xl font-black text-slate-900">Sessione non disponibile</h1><p className="mt-2 text-sm text-slate-500">{error}</p></div></div>

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-slate-950 via-indigo-950 to-violet-950 p-4 text-white sm:p-8">
      <div className="pointer-events-none absolute inset-0 opacity-30" style={{ backgroundImage: 'radial-gradient(circle at 20% 20%, #8b5cf6 0, transparent 28%), radial-gradient(circle at 80% 70%, #2563eb 0, transparent 30%)' }} />
      <div className="relative mx-auto flex min-h-[calc(100vh-4rem)] max-w-xl items-center justify-center">
        <motion.main initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full overflow-hidden rounded-[32px] border border-white/15 bg-white/10 p-6 shadow-2xl backdrop-blur-xl sm:p-8">
          <div className="flex items-center gap-3"><LogoMark className="h-11 w-11" /><div><p className="text-xs font-black uppercase tracking-[0.18em] text-violet-300">Golinelli.ai Live</p><p className="text-sm text-white/60">{info.session_title}</p></div><span className="ml-auto rounded-full bg-white/10 px-3 py-1 font-mono text-sm font-black tracking-widest text-amber-300">{info.access_code}</span></div>
          <div className="my-7 h-px bg-white/10" />
          <div className="text-center">
            <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 2.2 }} className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-500 shadow-xl shadow-violet-950/40">{info.interaction_type === 'escape_room' ? <LockKeyhole className="h-8 w-8" /> : <Gamepad2 className="h-8 w-8" />}</motion.div>
            <p className="mt-5 text-xs font-black uppercase tracking-[0.2em] text-violet-300">{info.interaction_type === 'escape_room' ? 'Escape Room' : 'Sessione interattiva'}</p>
            <h1 className="mt-2 text-3xl font-black sm:text-4xl">{info.title}</h1>
          </div>

          {!joined ? (
            <form onSubmit={join} className="mt-8 space-y-4">
              <div><label className="mb-2 flex items-center gap-2 text-sm font-bold text-white/80"><UserRound className="h-4 w-4" /> Scegli il tuo nickname</label><Input autoFocus maxLength={20} value={nickname} onChange={event => setNickname(event.target.value)} placeholder="Come vuoi apparire al master?" className="h-12 border-white/15 bg-white/10 text-center text-lg font-bold text-white placeholder:text-white/30" /></div>
              {error && <p className="rounded-xl bg-rose-400/15 px-3 py-2 text-center text-sm text-rose-200">{error}</p>}
              <Button type="submit" disabled={!nickname.trim() || joining || info.status === 'CLOSED'} className="h-12 w-full bg-violet-500 text-base font-black hover:bg-violet-400">
                {joining ? <Loader2 className="h-5 w-5 animate-spin" /> : <Radio className="h-5 w-5" />} {joining ? 'Ingresso…' : 'Entra nella sessione'}
              </Button>
              <p className="text-center text-xs text-white/40">Nessun account o password necessari.</p>
            </form>
          ) : (
            <div className="mt-8 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-5 text-center">
              <span className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400/20"><Clock3 className="h-5 w-5 text-emerald-300" /></span>
              <p className="mt-3 font-black">Sei dentro, {guestSession?.nickname}!</p>
              <p className="mt-1 text-sm text-white/60">{info.status === 'ACTIVE' ? 'La sfida è attiva: preparati.' : info.status === 'CLOSED' ? 'La sessione è terminata.' : 'Attendi che il master avvii la sessione.'}</p>
              <div className="mt-4 flex items-center justify-center gap-2 text-xs font-bold text-emerald-300"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> Collegato al master</div>
            </div>
          )}
        </motion.main>
      </div>
      {joined && guestSession && <LiveInteractionStudentOverlay key={guestSession.student_id} sessionId={guestSession.session_id} interactionId={info.live_interaction_id} studentToken={guestSession.join_token} />}
    </div>
  )
}
