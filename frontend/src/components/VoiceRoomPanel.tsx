import { useCallback, useEffect, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'
import { Mic, MicOff, Phone, PhoneOff, Hand, Loader2, Volume2, UserCheck, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { voiceApi } from '@/lib/api'

type VoiceQueueItem = {
  student_id: string
  nickname?: string
  avatar_url?: string
}

type VoiceRoomState = {
  session_id: string
  active: boolean
  teacher_id?: string
  active_speaker_id?: string | null
  queue: VoiceQueueItem[]
  updated_at?: string
}

interface VoiceRoomPanelProps {
  sessionId: string
  userType: 'teacher' | 'student'
  currentUserId: string
  socket: Socket | null
}

export function VoiceRoomPanel({ sessionId, userType, currentUserId, socket }: VoiceRoomPanelProps) {
  const [voiceState, setVoiceState] = useState<VoiceRoomState | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const audioSinkRef = useRef<HTMLDivElement>(null)
  const roomRef = useRef<any>(null)
  const localTrackRef = useRef<any>(null)
  const canPublishRef = useRef(false)
  const joiningRef = useRef(false)

  const isTeacher = userType === 'teacher'
  const currentVoiceState: VoiceRoomState = voiceState ?? {
    session_id: sessionId,
    active: false,
    active_speaker_id: null,
    queue: [],
  }
  const isActive = currentVoiceState.active
  const isSpeaker = currentVoiceState.active_speaker_id === currentUserId
  const isQueued = currentVoiceState.queue.some((item) => item.student_id === currentUserId)
  const desiredPublish = isTeacher ? isActive : isSpeaker

  const disconnectRoom = useCallback(async () => {
    const localTrack = localTrackRef.current
    localTrackRef.current = null
    if (localTrack) {
      try {
        roomRef.current?.localParticipant?.unpublishTrack(localTrack)
        localTrack.stop()
      } catch {
        // ignore teardown failures
      }
    }

    const room = roomRef.current
    roomRef.current = null
    canPublishRef.current = false
    setIsPublishing(false)
    setIsConnected(false)
    if (room) {
      try {
        room.disconnect()
      } catch {
        // ignore teardown failures
      }
    }
    if (audioSinkRef.current) audioSinkRef.current.innerHTML = ''
  }, [])

  const joinRoom = useCallback(async () => {
    if (!isActive || joiningRef.current) return
    joiningRef.current = true
    setIsConnecting(true)
    setError(null)

    try {
      const [{ Room, RoomEvent, Track, createLocalAudioTrack }, tokenResponse] = await Promise.all([
        import('livekit-client'),
        voiceApi.createLiveKitToken(sessionId),
      ])
      const { url, token, can_publish: canPublish } = tokenResponse.data
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
      })

      room.on(RoomEvent.TrackSubscribed, (track: any) => {
        if (track.kind !== Track.Kind.Audio) return
        const element = track.attach()
        element.autoplay = true
        element.dataset.livekitAudio = 'true'
        audioSinkRef.current?.appendChild(element)
      })

      room.on(RoomEvent.TrackUnsubscribed, (track: any) => {
        track.detach().forEach((element: HTMLElement) => element.remove())
      })

      room.on(RoomEvent.Disconnected, () => {
        setIsConnected(false)
        setIsPublishing(false)
      })

      await room.connect(url, token)
      roomRef.current = room
      canPublishRef.current = Boolean(canPublish)
      setIsConnected(true)

      if (canPublish) {
        const track = await createLocalAudioTrack({
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        })
        await room.localParticipant.publishTrack(track)
        localTrackRef.current = track
        setIsPublishing(true)
      }
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Voice connection failed')
      await disconnectRoom()
    } finally {
      joiningRef.current = false
      setIsConnecting(false)
    }
  }, [disconnectRoom, isActive, sessionId])

  useEffect(() => {
    if (!socket || !sessionId) return

    const handleState = (state: VoiceRoomState) => {
      if (state.session_id === sessionId) setVoiceState(state)
    }

    socket.on('voice_room_state', handleState)
    socket.emit('voice_get_state', { session_id: sessionId }, (state: VoiceRoomState & { error?: string }) => {
      if (state && !state.error) setVoiceState(state)
    })

    return () => {
      socket.off('voice_room_state', handleState)
    }
  }, [sessionId, socket])

  useEffect(() => {
    if (!isActive) {
      void disconnectRoom()
      return
    }

    if (!roomRef.current) {
      void joinRoom()
      return
    }

    if (desiredPublish !== canPublishRef.current) {
      void disconnectRoom().then(() => joinRoom())
    }
  }, [desiredPublish, disconnectRoom, isActive, joinRoom])

  useEffect(() => () => {
    void disconnectRoom()
  }, [disconnectRoom])

  const emitVoice = (event: string, payload: Record<string, unknown> = {}) => {
    if (!socket) return
    socket.emit(event, { session_id: sessionId, ...payload }, (response: { error?: string }) => {
      if (response?.error) setError(response.error)
    })
  }

  if (!voiceState?.active && !isTeacher) {
    return null
  }

  return (
    <div className="mx-3 mt-3 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div ref={audioSinkRef} className="hidden" />
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-slate-100">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
            <p className="text-xs font-bold text-slate-700 uppercase tracking-wide">Voce classe</p>
          </div>
          <p className="text-[10px] text-slate-400 truncate">
            {isActive
              ? isConnected
                ? isPublishing
                  ? 'Microfono attivo'
                  : 'In ascolto'
                : isConnecting
                  ? 'Connessione...'
                  : 'Pronto'
              : 'Non attiva'}
          </p>
        </div>

        {isTeacher ? (
          <Button
            size="sm"
            onClick={() => emitVoice(isActive ? 'voice_room_end' : 'voice_room_start')}
            className={`h-8 rounded-full px-3 text-xs ${isActive ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-800'}`}
          >
            {isActive ? <PhoneOff className="h-3.5 w-3.5 mr-1.5" /> : <Phone className="h-3.5 w-3.5 mr-1.5" />}
            {isActive ? 'Chiudi' : 'Avvia'}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!isActive || isSpeaker}
            onClick={() => emitVoice(isQueued ? 'voice_cancel_request' : 'voice_request_speak')}
            className={`h-8 rounded-full px-3 text-xs ${isQueued ? 'bg-slate-100 text-slate-700 hover:bg-slate-200' : 'bg-slate-900 hover:bg-slate-800 text-white'}`}
          >
            {isQueued ? <X className="h-3.5 w-3.5 mr-1.5" /> : <Hand className="h-3.5 w-3.5 mr-1.5" />}
            {isSpeaker ? 'In parola' : isQueued ? 'Annulla' : 'Intervieni'}
          </Button>
        )}
      </div>

      {error && (
        <div className="px-3 py-2 text-[11px] text-red-700 bg-red-50 border-b border-red-100">
          {error}
        </div>
      )}

      {isActive && (
        <div className="px-3 py-2 space-y-2">
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            {isConnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isPublishing ? <Mic className="h-3.5 w-3.5 text-emerald-600" /> : <Volume2 className="h-3.5 w-3.5" />}
            <span>
              {isSpeaker
                ? 'Puoi parlare ora.'
                : currentVoiceState.active_speaker_id
                  ? 'Uno studente sta parlando.'
                  : isTeacher
                    ? 'Nessuno studente in parola.'
                    : 'Stai ascoltando il docente.'}
            </span>
          </div>

          {isTeacher && currentVoiceState.queue.length > 0 && (
            <div className="space-y-1">
              {currentVoiceState.queue.map((item) => (
                <div key={item.student_id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
                  <span className="truncate text-xs font-medium text-slate-700">{item.nickname || 'Studente'}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => emitVoice('voice_grant_speaker', { student_id: item.student_id })}
                  >
                    <UserCheck className="h-3.5 w-3.5 mr-1" />
                    Dai parola
                  </Button>
                </div>
              ))}
            </div>
          )}

          {isTeacher && currentVoiceState.active_speaker_id && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-full text-xs"
              onClick={() => emitVoice('voice_revoke_speaker')}
            >
              <MicOff className="h-3.5 w-3.5 mr-1.5" />
              Togli parola
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
