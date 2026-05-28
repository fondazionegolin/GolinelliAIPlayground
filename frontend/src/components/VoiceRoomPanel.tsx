import { useCallback, useEffect, useRef, useState } from 'react'
import type { Socket } from 'socket.io-client'
import { Hand, Loader2, Mic, MicOff, Phone, PhoneOff, UserCheck, Volume2, VolumeX, X } from 'lucide-react'

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

const VU_BARS = 10

function VUMeter({ level, color = 'emerald' }: { level: number; color?: 'emerald' | 'sky' }) {
  const litClass = color === 'sky' ? 'bg-sky-400' : 'bg-emerald-500'
  return (
    <div className="flex h-4 items-end gap-[2px]" aria-hidden="true">
      {Array.from({ length: VU_BARS }).map((_, index) => {
        const lit = level > index / VU_BARS
        return (
          <span
            key={index}
            className={`w-[3px] rounded-sm transition-colors ${lit ? litClass : 'bg-slate-200'}`}
            style={{ height: `${5 + index}px` }}
          />
        )
      })}
    </div>
  )
}

export function VoiceRoomPanel({ sessionId, userType, currentUserId, socket }: VoiceRoomPanelProps) {
  const [voiceState, setVoiceState] = useState<VoiceRoomState | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [localAudioLevel, setLocalAudioLevel] = useState(0)
  const [remoteAudioLevel, setRemoteAudioLevel] = useState(0)
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const audioSinkRef = useRef<HTMLDivElement>(null)
  const roomRef = useRef<any>(null)
  const localTrackRef = useRef<any>(null)
  const canPublishRef = useRef(false)
  const joiningRef = useRef(false)
  const publishingChangeRef = useRef<Promise<void> | null>(null)
  const remoteLevelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // WebAudio analyser for real-time local mic level (avoids LiveKit threshold issues)
  const levelMonitorRef = useRef<{ stop: () => void } | null>(null)

  const isTeacher = userType === 'teacher'
  const currentVoiceState: VoiceRoomState = voiceState ?? {
    session_id: sessionId,
    active: false,
    active_speaker_id: null,
    queue: [],
  }
  const isActive = currentVoiceState.active
  const activeSpeakerId = currentVoiceState.active_speaker_id ?? null
  const isSpeaker = activeSpeakerId === currentUserId
  const isQueued = currentVoiceState.queue.some((item) => item.student_id === currentUserId)

  // FIX: teacher always publishes when the room is active — NOT muted out when a student speaks.
  // Student publishes only when granted the floor.
  const desiredPublish = isTeacher ? isActive : isSpeaker

  // ── Local mic level via WebAudio API (more reliable than LiveKit ActiveSpeakers) ──
  const startLocalLevelMonitor = useCallback((track: any) => {
    levelMonitorRef.current?.stop()
    levelMonitorRef.current = null
    const mediaStreamTrack: MediaStreamTrack | undefined = track?.mediaStreamTrack
    if (!mediaStreamTrack) return
    try {
      const ctx = new AudioContext()
      const source = ctx.createMediaStreamSource(new MediaStream([mediaStreamTrack]))
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 512
      analyser.smoothingTimeConstant = 0.8
      source.connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      let animId: number
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const rms = Math.sqrt(data.reduce((sum, v) => sum + v * v, 0) / data.length)
        setLocalAudioLevel(Math.min(1, rms / 60))
        animId = requestAnimationFrame(tick)
      }
      tick()
      levelMonitorRef.current = {
        stop: () => {
          cancelAnimationFrame(animId)
          void ctx.close()
        },
      }
    } catch {
      // AudioContext unavailable (e.g. SSR or browser restriction)
    }
  }, [])

  const stopLocalLevelMonitor = useCallback(() => {
    levelMonitorRef.current?.stop()
    levelMonitorRef.current = null
    setLocalAudioLevel(0)
  }, [])

  // ── Track teardown ────────────────────────────────────────────────────────
  const stopLocalTrack = useCallback(() => {
    const localTrack = localTrackRef.current
    localTrackRef.current = null
    if (!localTrack) return
    levelMonitorRef.current?.stop()
    levelMonitorRef.current = null
    setLocalAudioLevel(0)
    try {
      roomRef.current?.localParticipant?.unpublishTrack(localTrack)
      localTrack.stop()
    } catch {
      // ignore teardown failures
    }
  }, [])

  const disconnectRoom = useCallback(async () => {
    stopLocalTrack()
    stopLocalLevelMonitor()
    const room = roomRef.current
    roomRef.current = null
    canPublishRef.current = false
    setIsPublishing(false)
    setIsMuted(false)
    setIsConnected(false)
    setConnectionStatus(null)
    setLocalAudioLevel(0)
    setRemoteAudioLevel(0)
    if (remoteLevelTimerRef.current) {
      clearTimeout(remoteLevelTimerRef.current)
      remoteLevelTimerRef.current = null
    }
    if (room) {
      try {
        room.disconnect()
      } catch {
        // ignore teardown failures
      }
    }
    if (audioSinkRef.current) audioSinkRef.current.innerHTML = ''
    setAudioBlocked(false)
  }, [stopLocalTrack, stopLocalLevelMonitor])

  const setLocalPublishing = useCallback(async (enabled: boolean) => {
    const previous = publishingChangeRef.current
    const next = (previous ?? Promise.resolve()).then(async () => {
      const room = roomRef.current
      if (!room || !canPublishRef.current) {
        setIsPublishing(false)
        return
      }

      if (!enabled) {
        const localTrack = localTrackRef.current
        if (localTrack) {
          if (isTeacher && typeof localTrack.mute === 'function') {
            await localTrack.mute()
          } else {
            stopLocalTrack()
          }
        }
        stopLocalLevelMonitor()
        setIsMuted(false)
        setIsPublishing(false)
        return
      }

      // Unmute existing track if it was soft-muted
      if (localTrackRef.current) {
        if (typeof localTrackRef.current.unmute === 'function') {
          await localTrackRef.current.unmute()
        }
        setIsPublishing(true)
        startLocalLevelMonitor(localTrackRef.current)
        return
      }

      const { createLocalAudioTrack } = await import('livekit-client')
      const track = await createLocalAudioTrack({
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      })
      await room.localParticipant.publishTrack(track)
      localTrackRef.current = track
      setIsPublishing(true)
      startLocalLevelMonitor(track)
    })

    publishingChangeRef.current = next.catch((err) => {
      setError(err?.message || 'Microfono non accessibile')
      setIsPublishing(false)
    })
    await publishingChangeRef.current
  }, [isTeacher, stopLocalTrack, stopLocalLevelMonitor, startLocalLevelMonitor])

  // ── Manual mute toggle (does NOT disconnect — only silences the track) ───
  const toggleMute = useCallback(async () => {
    const track = localTrackRef.current
    if (!track) return
    if (isMuted) {
      await track.unmute()
      setIsMuted(false)
    } else {
      await track.mute()
      setIsMuted(true)
    }
  }, [isMuted])

  const joinRoom = useCallback(async () => {
    if (!isActive || joiningRef.current) return
    joiningRef.current = true
    setIsConnecting(true)
    setError(null)

    try {
      const [{ ConnectionState, Room, RoomEvent, Track }, tokenResponse] = await Promise.all([
        import('livekit-client'),
        voiceApi.createLiveKitToken(sessionId),
      ])
      const { url, token, can_publish: canPublish, ice_servers: iceServers } = tokenResponse.data
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        // Inject external TURN credentials when provided by the backend (turn.golinelli.ai).
        ...(iceServers?.length ? { rtcConfig: { iceServers } } : {}),
      })

      room.on(RoomEvent.TrackSubscribed, (track: any) => {
        if (track.kind !== Track.Kind.Audio) return
        const element = track.attach()
        element.autoplay = true
        element.playsInline = true
        element.dataset.livekitAudio = 'true'
        audioSinkRef.current?.appendChild(element)
        element.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true))
      })

      room.on(RoomEvent.TrackSubscriptionFailed, (_trackSid: string, _participant: any, err: any) => {
        setError(err?.message || 'Audio remoto non disponibile')
      })

      room.on(RoomEvent.TrackUnsubscribed, (track: any) => {
        track.detach().forEach((element: HTMLElement) => element.remove())
        setRemoteAudioLevel(0)
      })

      // Remote audio level via LiveKit events (local level handled by WebAudio above)
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers: any[]) => {
        const localIdentity = room.localParticipant.identity
        const remote = speakers.find((p) => p.identity !== localIdentity)
        const level = Math.max(0, Math.min(1, remote?.audioLevel ?? 0))
        setRemoteAudioLevel(level)
        if (remoteLevelTimerRef.current) clearTimeout(remoteLevelTimerRef.current)
        remoteLevelTimerRef.current = setTimeout(() => setRemoteAudioLevel(0), 600)
      })

      room.on(RoomEvent.ConnectionStateChanged, (state: string) => {
        setConnectionStatus(state)
        setIsConnected(state === ConnectionState.Connected)
      })

      room.on(RoomEvent.Reconnecting, () => setConnectionStatus('reconnecting'))
      room.on(RoomEvent.Reconnected, () => setConnectionStatus(ConnectionState.Connected))
      room.on(RoomEvent.Disconnected, () => {
        setIsConnected(false)
        setIsPublishing(false)
        setConnectionStatus('disconnected')
      })

      await room.connect(url, token)
      roomRef.current = room
      canPublishRef.current = Boolean(canPublish)
      setIsConnected(true)
      await setLocalPublishing(desiredPublish)
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Connessione voce non riuscita')
      await disconnectRoom()
    } finally {
      joiningRef.current = false
      setIsConnecting(false)
    }
  }, [desiredPublish, disconnectRoom, isActive, sessionId, setLocalPublishing])

  useEffect(() => {
    if (!socket || !sessionId) return
    const handleState = (state: VoiceRoomState) => {
      if (state.session_id === sessionId) setVoiceState(state)
    }
    socket.on('voice_room_state', handleState)
    socket.emit('voice_get_state', { session_id: sessionId }, (state: VoiceRoomState & { error?: string }) => {
      if (state && !state.error) setVoiceState(state)
    })
    return () => { socket.off('voice_room_state', handleState) }
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
    if (desiredPublish && !canPublishRef.current) {
      void disconnectRoom().then(() => joinRoom())
      return
    }
    void setLocalPublishing(desiredPublish)
  }, [desiredPublish, disconnectRoom, isActive, joinRoom, setLocalPublishing])

  useEffect(() => () => {
    if (remoteLevelTimerRef.current) clearTimeout(remoteLevelTimerRef.current)
    void disconnectRoom()
  }, [disconnectRoom])

  const emitVoice = (event: string, payload: Record<string, unknown> = {}) => {
    if (!socket) return
    socket.emit(event, { session_id: sessionId, ...payload }, (response: { error?: string }) => {
      if (response?.error) setError(response.error)
    })
  }

  const unlockRemoteAudio = () => {
    const elements = audioSinkRef.current?.querySelectorAll('audio') ?? []
    void Promise.all(Array.from(elements).map((el) => el.play()))
      .then(() => setAudioBlocked(false))
      .catch(() => setAudioBlocked(true))
  }

  if (!voiceState?.active && !isTeacher) return null

  // ── Status label ─────────────────────────────────────────────────────────
  const statusText = (() => {
    if (!isConnected) return isConnecting ? 'Connessione...' : connectionStatus || 'Pronto'
    if (isMuted) return 'Microfono disattivato'
    if (isPublishing) {
      if (isTeacher) return activeSpeakerId ? 'Uno studente sta parlando.' : 'Voce docente attiva.'
      return 'Sei in parola.'
    }
    return isTeacher || !activeSpeakerId ? 'In ascolto.' : 'Stai ascoltando il docente.'
  })()

  return (
    <div className="mx-3 mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div ref={audioSinkRef} className="hidden" />

      {/* Header row */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${isActive ? 'animate-pulse bg-emerald-500' : 'bg-slate-300'}`} />
            <p className="text-xs font-bold uppercase tracking-wide text-slate-700">Voce classe</p>
          </div>
          <p className="truncate text-[10px] text-slate-400">
            {isActive ? statusText : 'Non attiva'}
          </p>
        </div>

        {isTeacher ? (
          <Button
            size="sm"
            onClick={() => emitVoice(isActive ? 'voice_room_end' : 'voice_room_start')}
            className={`h-8 rounded-full px-3 text-xs ${isActive ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-800'}`}
          >
            {isActive ? <PhoneOff className="mr-1.5 h-3.5 w-3.5" /> : <Phone className="mr-1.5 h-3.5 w-3.5" />}
            {isActive ? 'Chiudi' : 'Avvia'}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!isActive}
            onClick={() => emitVoice(
              isSpeaker || isQueued ? 'voice_cancel_request' : 'voice_request_speak',
            )}
            className={`h-8 rounded-full px-3 text-xs ${
              isQueued || isSpeaker
                ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                : 'bg-slate-900 text-white hover:bg-slate-800'
            }`}
          >
            {isSpeaker || isQueued ? <X className="mr-1.5 h-3.5 w-3.5" /> : <Hand className="mr-1.5 h-3.5 w-3.5" />}
            {isSpeaker ? 'Termina' : isQueued ? 'Annulla' : 'Intervieni'}
          </Button>
        )}
      </div>

      {error && (
        <div className="border-b border-red-100 bg-red-50 px-3 py-2 text-[11px] text-red-700">
          {error}
        </div>
      )}

      {audioBlocked && (
        <button
          type="button"
          onClick={unlockRemoteAudio}
          className="flex w-full items-center gap-2 border-b border-amber-100 bg-amber-50 px-3 py-2 text-left text-[11px] text-amber-700 transition-colors hover:bg-amber-100"
        >
          <VolumeX className="h-3.5 w-3.5 flex-shrink-0" />
          <span>Tocca qui per abilitare l'audio</span>
        </button>
      )}

      {isActive && (
        <div className="space-y-2 px-3 py-2">

          {/* Status + VU meters + mute button */}
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            {/* Icon */}
            {isConnecting ? (
              <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin" />
            ) : isMuted ? (
              <MicOff className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
            ) : isPublishing ? (
              <Mic className="h-3.5 w-3.5 flex-shrink-0 text-emerald-600" />
            ) : (
              <Volume2 className="h-3.5 w-3.5 flex-shrink-0" />
            )}

            {/* Local mic VU meter (green) — real-time via WebAudio, visible when transmitting */}
            {isPublishing && !isMuted && isConnected && (
              <VUMeter level={localAudioLevel} color="emerald" />
            )}

            {/* Remote audio VU meter (sky) — visible when someone else is detected speaking */}
            {isConnected && remoteAudioLevel > 0.01 && (
              <VUMeter level={remoteAudioLevel} color="sky" />
            )}

            <span className="min-w-0 truncate">{statusText}</span>

            {/* Mute/unmute button — only when connected and actively publishing */}
            {isPublishing && isConnected && (
              <button
                type="button"
                onClick={() => void toggleMute()}
                title={isMuted ? 'Attiva microfono' : 'Silenzia microfono'}
                className={`ml-auto flex-shrink-0 rounded-full p-1 transition-colors ${
                  isMuted
                    ? 'bg-amber-100 text-amber-600 hover:bg-amber-200'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {isMuted
                  ? <MicOff className="h-3.5 w-3.5" />
                  : <Mic className="h-3.5 w-3.5" />
                }
              </button>
            )}
          </div>

          {/* Teacher: queue of students waiting to speak */}
          {isTeacher && currentVoiceState.queue.length > 0 && (
            <div className="space-y-1">
              {currentVoiceState.queue.map((item) => (
                <div
                  key={item.student_id}
                  className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5"
                >
                  <span className="truncate text-xs font-medium text-slate-700">
                    {item.nickname || 'Studente'}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => emitVoice('voice_grant_speaker', { student_id: item.student_id })}
                  >
                    <UserCheck className="mr-1 h-3.5 w-3.5" />
                    Dai parola
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Teacher: revoke active speaker */}
          {isTeacher && currentVoiceState.active_speaker_id && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-full text-xs"
              onClick={() => emitVoice('voice_revoke_speaker')}
            >
              <MicOff className="mr-1.5 h-3.5 w-3.5" />
              Togli parola
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
