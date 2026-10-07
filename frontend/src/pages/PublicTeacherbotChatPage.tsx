import { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { Bot, Loader2, Lock, AlertTriangle } from '@/components/icons'
import { Button } from '@/components/ui/button'
import api, { publicTeacherbotApi } from '@/lib/api'
import { resolveTeacherbotIcon } from '@/lib/teacherbotIcons'

// The very same chat the logged-in students use: voice, inquiry, escape room, attachments, ...
const ChatbotModule = lazy(() => import('@/pages/student/ChatbotModule'))

interface LinkInfo {
  teacherbot_id: string
  name: string
  synopsis: string | null
  icon: string
  color: string
}

interface GuestSession {
  join_token: string
  student_id: string
  session_id: string
  teacherbot_id: string
}

const sessionKey = (token: string) => `public_bot_session:${token}`

function loadGuest(token: string): GuestSession | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(token))
    if (!raw) return null
    const guest = JSON.parse(raw) as GuestSession
    sessionStorage.setItem('public_bot_token', guest.join_token)
    return guest
  } catch {
    return null
  }
}

export default function PublicTeacherbotChatPage() {
  const { token = '' } = useParams()
  const [searchParams] = useSearchParams()
  const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [guest, setGuest] = useState<GuestSession | null>(() => loadGuest(token))
  const [code, setCode] = useState(() => (searchParams.get('code') || '').toUpperCase())
  const [entering, setEntering] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)
  const autoTried = useRef(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    publicTeacherbotApi.getLinkInfo(token)
      .then((res) => { if (active) setLinkInfo(res.data as LinkInfo) })
      .catch((err) => {
        if (!active) return
        setError(err?.response?.status === 410 ? 'Questo link è scaduto.' : 'Link non valido.')
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  // A stored guest token may have expired or the link been revoked: fall back to the gate.
  useEffect(() => {
    if (!guest) return
    let active = true
    api.get('/student/session').catch(() => {
      if (!active) return
      sessionStorage.removeItem(sessionKey(token))
      sessionStorage.removeItem('public_bot_token')
      setGuest(null)
    })
    return () => { active = false }
  }, [guest, token])

  const enter = useCallback(async (value: string) => {
    if (!value.trim()) return
    setEntering(true)
    setCodeError(null)
    try {
      const { data } = await publicTeacherbotApi.enter(token, value.trim())
      const session: GuestSession = {
        join_token: data.join_token, student_id: data.student_id, session_id: data.session_id, teacherbot_id: data.teacherbot_id,
      }
      sessionStorage.setItem('public_bot_token', session.join_token)
      sessionStorage.setItem(sessionKey(token), JSON.stringify(session))
      setGuest(session)
    } catch (err: any) {
      const status = err?.response?.status
      setCodeError(
        status === 401 ? 'Codice non corretto.'
          : status === 429 ? 'Troppi tentativi, riprova tra poco.'
          : status === 410 ? 'Questo link non è più disponibile.'
          : 'Impossibile entrare, riprova.'
      )
    } finally {
      setEntering(false)
    }
  }, [token])

  // Links shared as QR carry the code: enter straight away.
  useEffect(() => {
    if (autoTried.current || !linkInfo || guest || !code) return
    autoTried.current = true
    void enter(code)
  }, [linkInfo, guest, code, enter])

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>
  }

  if (error || !linkInfo) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-sm text-center">
          <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-amber-500" />
          <p className="text-lg font-semibold text-slate-800">{error || 'Link non valido.'}</p>
        </div>
      </div>
    )
  }

  if (guest) {
    return (
      <div className="h-screen w-screen overflow-hidden">
        <Suspense fallback={<div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}>
          <ChatbotModule
            sessionId={guest.session_id}
            studentId={guest.student_id}
            initialTeacherbotId={guest.teacherbot_id}
          />
        </Suspense>
      </div>
    )
  }

  const resolvedIcon = resolveTeacherbotIcon(linkInfo.icon)
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#181b1e] text-white">
          {resolvedIcon.kind === 'lucide' ? <resolvedIcon.Icon className="h-8 w-8" />
            : resolvedIcon.kind === 'emoji' ? <span className="text-3xl">{resolvedIcon.emoji}</span>
            : <Bot className="h-8 w-8" />}
        </div>
        <h1 className="text-xl font-bold text-slate-900">{linkInfo.name}</h1>
        {linkInfo.synopsis && <p className="mt-1 text-sm text-slate-500">{linkInfo.synopsis}</p>}
        <form
          className="mt-6 space-y-3"
          onSubmit={(e) => { e.preventDefault(); void enter(code) }}
        >
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="Codice di accesso"
              autoFocus
              className="w-full rounded-xl border border-slate-200 py-3 pl-9 pr-3 text-center font-mono text-lg tracking-widest outline-none focus:border-slate-400"
            />
          </div>
          {codeError && <p className="text-sm text-red-600">{codeError}</p>}
          <Button type="submit" disabled={entering || !code.trim()} className="w-full bg-[#181b1e] hover:bg-[#0f1113]">
            {entering ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Entra'}
          </Button>
        </form>
      </div>
    </div>
  )
}
