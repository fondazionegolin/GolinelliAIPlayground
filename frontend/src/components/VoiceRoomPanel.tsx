import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Socket } from 'socket.io-client'
import {
  Hand,
  Loader2,
  Mic,
  MicOff,
  PictureInPicture2,
  Phone,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
  LogOut,
  MessageSquare,
  Users,
  Pin,
  PinOff,
  Sparkles,
} from '@/components/icons'

import { Button } from '@/components/ui/button'
import { voiceApi, voiceCallsApi } from '@/lib/api'
import { CallRecorder } from '@/lib/callRecorder'
import { tl } from '@/i18n/tl'

type VoiceQueueItem = {
  student_id: string
  nickname?: string
  avatar_url?: string
}

type VoiceRoomState = {
  session_id: string | null
  call_id?: string | null
  active: boolean
  teacher_id?: string
  active_speaker_id?: string | null
  active_speaker?: VoiceQueueItem | null
  active_speaker_ids?: string[]
  active_speakers?: VoiceQueueItem[]
  queue: VoiceQueueItem[]
  /** Set while the call is being recorded (shown to everyone). */
  recording?: { id: string; started_at: string } | null
  /** Tile a moderator put in focus for everyone (LiveKit identity + track source). */
  spotlight?: { identity: string; source: string; name?: string } | null
  updated_at?: string
}

type VoiceParticipant = {
  id: string
  name: string
  role: 'teacher' | 'student'
  local?: boolean
}

type MediaTile = {
  id: string
  participantIdentity: string
  participantName: string
  source: 'camera' | 'screen' | 'unknown'
  stream: MediaStream
  local?: boolean
}

interface VoiceRoomPanelProps {
  /** Session voice room (class chat sidebar). Ignored when `callId` is set. */
  sessionId?: string
  /** Invite-link call room: the socket must already have joined it (`voice_call_join`). */
  callId?: string
  /** Whether this teacher may start/stop the room and give the floor (default: every teacher). */
  canModerate?: boolean
  /** `page`: full-width videoconference layout used by /call/:code. */
  variant?: 'sidebar' | 'page'
  /** Page variant: content of the «Chat» tab of the right column (e.g. the class chat). */
  chatPanel?: ReactNode
  /** Page variant: shown in the stage while the call has not started yet. */
  waitingHint?: string
  /** Page variant: «Esci» button. */
  onLeave?: () => void
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

function StreamVideo({ stream, className = 'h-full w-full object-cover', muted = false }: { stream: MediaStream; className?: string; muted?: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.srcObject = stream
    video.muted = muted
    video.playsInline = true
    video.autoplay = true
    void video.play().catch(() => {})
    return () => {
      video.srcObject = null
    }
  }, [muted, stream])

  return <video ref={videoRef} className={className} />
}

export function VoiceRoomPanel({ sessionId = '', callId, canModerate, variant = 'sidebar', chatPanel, waitingHint, onLeave, userType, currentUserId, socket }: VoiceRoomPanelProps) {
  const [voiceState, setVoiceState] = useState<VoiceRoomState | null>(null)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [audioBlocked, setAudioBlocked] = useState(false)
  const [localAudioLevel, setLocalAudioLevel] = useState(0)
  const [remoteAudioLevel, setRemoteAudioLevel] = useState(0)
  const [roomParticipants, setRoomParticipants] = useState<VoiceParticipant[]>([])
  const [mediaTiles, setMediaTiles] = useState<MediaTile[]>([])
  const [localCameraEnabled, setLocalCameraEnabled] = useState(false)
  const [screenShareEnabled, setScreenShareEnabled] = useState(false)
  const [localCameraStream, setLocalCameraStream] = useState<MediaStream | null>(null)
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null)
  const [videoQuality, setVideoQuality] = useState<'low' | 'hi'>('hi')
  const [selectedTileId, setSelectedTileId] = useState<string | null>(null)
  const [sideTab, setSideTab] = useState<'chat' | 'people'>(chatPanel ? 'chat' : 'people')
  const [sideOpen, setSideOpen] = useState(true)
  /** Tile pinned by this viewer (`identity|source`): wins over the moderator's spotlight and the auto focus. */
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const audioSinkRef = useRef<HTMLDivElement>(null)
  const roomRef = useRef<any>(null)
  const localTrackRef = useRef<any>(null)
  const canPublishRef = useRef(false)
  const joiningRef = useRef(false)
  const publishingChangeRef = useRef<Promise<void> | null>(null)
  const remoteLevelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Recording (invite-link calls, moderators): remote audio tracks by key, and this browser's recorder if it captures.
  const remoteAudioRef = useRef(new Map<string, { identity: string; name: string; track: MediaStreamTrack }>())
  const recorderRef = useRef<{ id: string; recorder: CallRecorder } | null>(null)
  const [recordingBusy, setRecordingBusy] = useState(false)
  const [recordingClock, setRecordingClock] = useState(0)
  // WebAudio analyser for real-time local mic level (avoids LiveKit threshold issues)
  const levelMonitorRef = useRef<{ stop: () => void } | null>(null)

  const isTeacher = userType === 'teacher'
  const isModerator = isTeacher && (canModerate ?? true)
  const isPage = variant === 'page'
  const roomPayload = callId ? { call_id: callId } : { session_id: sessionId }
  const roomKey = callId ? `call-${callId}` : sessionId
  const currentVoiceState: VoiceRoomState = voiceState ?? {
    session_id: callId ? null : sessionId,
    call_id: callId ?? null,
    active: false,
    active_speaker_id: null,
    queue: [],
  }
  const isActive = currentVoiceState.active
  const activeSpeakerIds = currentVoiceState.active_speaker_ids ?? (currentVoiceState.active_speaker_id ? [currentVoiceState.active_speaker_id] : [])
  const activeSpeaker = currentVoiceState.active_speaker ?? null
  const activeSpeakers = currentVoiceState.active_speakers ?? (activeSpeaker ? [activeSpeaker] : [])
  const isSpeaker = activeSpeakerIds.includes(currentUserId)
  const isQueued = currentVoiceState.queue.some((item) => item.student_id === currentUserId)
  const canPublishMedia = isTeacher || isSpeaker
  const voiceParticipants = roomParticipants.length > 0
    ? [
      ...roomParticipants.map((participant) => ({
        ...participant,
        active: participant.role === 'teacher' ? isActive && activeSpeakerIds.length === 0 : activeSpeakerIds.includes(participant.id),
        queued: currentVoiceState.queue.some((item) => item.student_id === participant.id),
      })),
      ...currentVoiceState.queue
        .filter((item) => !roomParticipants.some((participant) => participant.id === item.student_id))
        .map((item) => ({
          id: item.student_id,
          name: item.nickname || tl("Studente"),
          role: 'student' as const,
          local: false,
          active: false,
          queued: true,
        })),
    ]
    : [
    { id: 'teacher', name: 'Docente', role: 'teacher' as const, local: isTeacher, active: isActive && activeSpeakerIds.length === 0, queued: false },
    ...activeSpeakers.map((speaker) => ({
      id: speaker.student_id,
      name: speaker.nickname || tl("Studente"),
      role: 'student' as const,
      local: speaker.student_id === currentUserId,
      active: true,
      queued: false,
    })),
    ...currentVoiceState.queue.map((item) => ({
      id: item.student_id,
      name: item.nickname || tl("Studente"),
      role: 'student' as const,
      local: item.student_id === currentUserId,
      active: false,
      queued: true,
    })),
  ]

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

  const getPublicationTileSource = (publication: any, Track?: any): MediaTile['source'] => {
    const source = publication?.source
    if (Track?.Source?.ScreenShare && source === Track.Source.ScreenShare) return 'screen'
    if (Track?.Source?.Camera && source === Track.Source.Camera) return 'camera'
    if (String(source).toLowerCase().includes('screen')) return 'screen'
    if (String(source).toLowerCase().includes('camera')) return 'camera'
    return 'unknown'
  }

  const readParticipantName = (participant: any) => participant?.name || participant?.identity || tl("Partecipante")

  /** Align the recorder with the audio tracks present now (own mic + every remote participant). */
  const syncRecorderTracks = useCallback(() => {
    const capture = recorderRef.current?.recorder
    if (!capture?.active) return
    const wanted = new Map(remoteAudioRef.current)
    const room = roomRef.current
    const localTrack: MediaStreamTrack | undefined = localTrackRef.current?.mediaStreamTrack
    if (room && localTrack) {
      wanted.set(`local:${localTrack.id}`, {
        identity: String(room.localParticipant?.identity || 'local'),
        name: String(room.localParticipant?.name || room.localParticipant?.identity || tl("Docente")),
        track: localTrack,
      })
    }
    for (const [key, item] of wanted) capture.addTrack(key, item.identity, item.name, item.track)
    for (const key of capture.trackKeys()) {
      if (!wanted.has(key)) capture.removeTrack(key)
    }
  }, [])

  const getCameraOptions = useCallback(() => {
    if (videoQuality === 'low') {
      return {
        capture: { resolution: { width: 426, height: 240, frameRate: 15 } },
        publish: { videoEncoding: { maxBitrate: 250_000, maxFramerate: 15 } },
      }
    }
    return {
      capture: { resolution: { width: 1280, height: 720, frameRate: 30 } },
      publish: { videoEncoding: { maxBitrate: 1_800_000, maxFramerate: 30 } },
    }
  }, [videoQuality])

  const getScreenShareOptions = () => ({
    capture: { resolution: { width: 1920, height: 1080, frameRate: 5 } },
    publish: { videoEncoding: { maxBitrate: 2_500_000, maxFramerate: 5 } },
  })

  const syncRoomParticipants = useCallback((room: any) => {
    const readParticipant = (participant: any, local = false): VoiceParticipant | null => {
      const identity = String(participant?.identity || '')
      if (!identity) return null
      const [rolePrefix, rawId] = identity.includes(':') ? identity.split(':') : ['student', identity]
      const role = rolePrefix === 'teacher' ? 'teacher' : 'student'
      return {
        id: rawId || identity,
        role,
        name: participant?.name || (role === 'teacher' ? tl("Docente") : tl("Studente")),
        local,
      }
    }

    const next = [
      readParticipant(room.localParticipant, true),
      ...Array.from(room.remoteParticipants?.values?.() ?? []).map((participant) => readParticipant(participant)),
    ].filter(Boolean) as VoiceParticipant[]

    setRoomParticipants(next)
  }, [])

  const clearVideoPreviews = useCallback(() => {
    setMediaTiles([])
    setLocalCameraEnabled(false)
    setScreenShareEnabled(false)
    setLocalCameraStream(null)
    setLocalScreenStream(null)
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
    setRoomParticipants([])
    clearVideoPreviews()
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
  }, [clearVideoPreviews, stopLocalTrack, stopLocalLevelMonitor])

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
      setError(err?.message || tl("Microfono non accessibile"))
      setIsPublishing(false)
    })
    await publishingChangeRef.current
  }, [isTeacher, stopLocalTrack, stopLocalLevelMonitor, startLocalLevelMonitor])

  const syncLocalVideoPublication = useCallback((sourceName: 'camera' | 'screen') => {
    const room = roomRef.current
    const Track = (window as any).LiveKitTrack
    const source = sourceName === 'screen' ? Track?.Source?.ScreenShare : Track?.Source?.Camera
    const publications = Array.from(room?.localParticipant?.videoTrackPublications?.values?.() ?? []) as any[]
    const publication = publications.find((pub) => source ? pub.source === source : String(pub.source).toLowerCase().includes(sourceName))
    const mediaStreamTrack: MediaStreamTrack | undefined = publication?.track?.mediaStreamTrack
    const stream = mediaStreamTrack ? new MediaStream([mediaStreamTrack]) : null
    if (sourceName === 'screen') setLocalScreenStream(stream)
    else setLocalCameraStream(stream)
  }, [])

  const toggleCamera = useCallback(async () => {
    const room = roomRef.current
    if (!room || !canPublishMedia || !canPublishRef.current) return
    try {
      const next = !localCameraEnabled
      const options = getCameraOptions()
      await room.localParticipant.setCameraEnabled(next, options.capture, options.publish)
      setLocalCameraEnabled(next)
      if (next) {
        requestAnimationFrame(() => syncLocalVideoPublication('camera'))
      } else {
        setLocalCameraStream(null)
      }
    } catch (err: any) {
      setError(err?.message || tl("Videocamera non accessibile"))
    }
  }, [canPublishMedia, getCameraOptions, localCameraEnabled, syncLocalVideoPublication])

  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current
    if (!room || !canPublishMedia || !canPublishRef.current) return
    try {
      const next = !screenShareEnabled
      const options = getScreenShareOptions()
      await room.localParticipant.setScreenShareEnabled(next, options.capture, options.publish)
      setScreenShareEnabled(next)
      if (next) {
        requestAnimationFrame(() => syncLocalVideoPublication('screen'))
      } else {
        setLocalScreenStream(null)
      }
    } catch (err: any) {
      setError(err?.message || tl("Condivisione schermo non disponibile"))
    }
  }, [canPublishMedia, screenShareEnabled, syncLocalVideoPublication])

  const stopLocalVideoPublishing = useCallback(async () => {
    const room = roomRef.current
    try {
      if (room?.localParticipant) {
        await Promise.allSettled([
          room.localParticipant.setCameraEnabled(false),
          room.localParticipant.setScreenShareEnabled(false),
        ])
      }
    } finally {
      setLocalCameraEnabled(false)
      setScreenShareEnabled(false)
      setLocalCameraStream(null)
      setLocalScreenStream(null)
    }
  }, [])

  const updateVideoQuality = useCallback(async (quality: 'low' | 'hi') => {
    setVideoQuality(quality)
    const room = roomRef.current
    if (!room || !localCameraEnabled || !canPublishMedia || !canPublishRef.current) return
    try {
      await room.localParticipant.setCameraEnabled(false)
      const capture = quality === 'low'
        ? { resolution: { width: 426, height: 240, frameRate: 15 } }
        : { resolution: { width: 1280, height: 720, frameRate: 30 } }
      const publish = quality === 'low'
        ? { videoEncoding: { maxBitrate: 250_000, maxFramerate: 15 } }
        : { videoEncoding: { maxBitrate: 1_800_000, maxFramerate: 30 } }
      await room.localParticipant.setCameraEnabled(true, capture, publish)
      requestAnimationFrame(() => syncLocalVideoPublication('camera'))
    } catch (err: any) {
      setError(err?.message || tl("Qualità video non aggiornata"))
    }
  }, [canPublishMedia, localCameraEnabled, syncLocalVideoPublication])

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
        callId ? voiceCallsApi.token(callId) : voiceApi.createLiveKitToken(sessionId),
      ])
      ;(window as any).LiveKitTrack = Track
      const { url, token, can_publish: canPublish, ice_servers: iceServers } = tokenResponse.data
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        // Inject external TURN credentials when provided by the backend (turn.golinelli.ai).
        ...(iceServers?.length ? { rtcConfig: { iceServers } } : {}),
      })

      room.on(RoomEvent.TrackSubscribed, (track: any, publication: any, participant: any) => {
        if (track.kind === Track.Kind.Audio) {
        if (track.mediaStreamTrack) {
          remoteAudioRef.current.set(`remote:${publication?.trackSid || track.sid}`, {
            identity: String(participant?.identity || 'remote'),
            name: readParticipantName(participant),
            track: track.mediaStreamTrack,
          })
          syncRecorderTracks()
        }
        const element = track.attach()
        element.autoplay = true
        element.playsInline = true
        element.dataset.livekitAudio = 'true'
        audioSinkRef.current?.appendChild(element)
        element.play().then(() => setAudioBlocked(false)).catch(() => setAudioBlocked(true))
          return
        }

        if (track.kind === Track.Kind.Video) {
          const tileId = publication?.trackSid || track.sid || `${participant?.identity || 'remote'}:${Date.now()}`
          const mediaStreamTrack: MediaStreamTrack | undefined = track.mediaStreamTrack
          if (!mediaStreamTrack) return
          setMediaTiles((prev) => [
            ...prev.filter((tile) => tile.id !== tileId),
            {
              id: tileId,
              participantIdentity: participant?.identity || tileId,
              participantName: readParticipantName(participant),
              source: getPublicationTileSource(publication, Track),
              stream: new MediaStream([mediaStreamTrack]),
            },
          ])
        }
      })

      room.on(RoomEvent.ParticipantConnected, () => syncRoomParticipants(room))
      room.on(RoomEvent.ParticipantDisconnected, () => syncRoomParticipants(room))

      room.on(RoomEvent.TrackSubscriptionFailed, (_trackSid: string, _participant: any, err: any) => {
        setError(err?.message || tl("Audio remoto non disponibile"))
      })

      room.on(RoomEvent.TrackUnsubscribed, (track: any, publication: any) => {
        if (track.kind === Track.Kind.Audio) {
          remoteAudioRef.current.delete(`remote:${publication?.trackSid || track.sid}`)
          syncRecorderTracks()
        }
        if (track.kind === Track.Kind.Video) {
          const sid = publication?.trackSid || track.sid
          setMediaTiles((prev) => prev.filter((tile) => tile.id !== sid))
        }
        track.detach().forEach((element: HTMLElement) => element.remove())
        setRemoteAudioLevel(0)
      })

      room.on(RoomEvent.LocalTrackUnpublished, (publication: any) => {
        const source = getPublicationTileSource(publication, Track)
        if (source === 'camera') {
          setLocalCameraEnabled(false)
          setLocalCameraStream(null)
        }
        if (source === 'screen') {
          setScreenShareEnabled(false)
          setLocalScreenStream(null)
        }
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
      syncRoomParticipants(room)
      await setLocalPublishing(desiredPublish)
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || tl("Connessione voce non riuscita"))
      await disconnectRoom()
    } finally {
      joiningRef.current = false
      setIsConnecting(false)
    }
  }, [callId, desiredPublish, disconnectRoom, isActive, sessionId, setLocalPublishing, syncRoomParticipants])

  useEffect(() => {
    if (!socket || (!sessionId && !callId)) return
    const handleState = (state: VoiceRoomState) => {
      if (callId ? state.call_id === callId : state.session_id === sessionId) setVoiceState(state)
    }
    socket.on('voice_room_state', handleState)
    socket.emit('voice_get_state', callId ? { call_id: callId } : { session_id: sessionId }, (state: VoiceRoomState & { error?: string }) => {
      if (state && !state.error) setVoiceState(state)
    })
    return () => { socket.off('voice_room_state', handleState) }
  }, [callId, sessionId, socket])

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
    if (!canPublishMedia && (localCameraEnabled || screenShareEnabled)) {
      void stopLocalVideoPublishing()
    }
    void setLocalPublishing(desiredPublish)
  }, [canPublishMedia, desiredPublish, disconnectRoom, isActive, joinRoom, localCameraEnabled, screenShareEnabled, setLocalPublishing, stopLocalVideoPublishing])

  useEffect(() => {
    if (callId) return
    window.dispatchEvent(new CustomEvent('golinelli:voice-room-state', {
      detail: { sessionId, active: isActive },
    }))
  }, [callId, isActive, sessionId])

  useEffect(() => () => {
    if (callId) return
    window.dispatchEvent(new CustomEvent('golinelli:voice-room-state', {
      detail: { sessionId, active: false },
    }))
  }, [callId, sessionId])

  useEffect(() => () => {
    if (remoteLevelTimerRef.current) clearTimeout(remoteLevelTimerRef.current)
    void disconnectRoom()
  }, [disconnectRoom])

  // ── Recording (invite-link calls) ─────────────────────────────────────────
  const recordingState = currentVoiceState.recording ?? null
  const capturingHere = !!recorderRef.current && recordingState?.id === recorderRef.current.id

  const stopRecording = useCallback(async () => {
    const current = recorderRef.current
    if (!current) return
    setRecordingBusy(true)
    recorderRef.current = null
    try {
      await current.recorder.stop()
      await voiceCallsApi.stopRecording(current.id)
    } catch (err: any) {
      setError(err?.response?.data?.detail || tl("Impossibile chiudere la registrazione"))
    } finally {
      setRecordingBusy(false)
    }
  }, [])

  const startRecording = useCallback(async () => {
    if (!callId || recorderRef.current) return
    if (!CallRecorder.supported()) {
      setError(tl("Questo browser non supporta la registrazione audio"))
      return
    }
    const consent = window.confirm(tl(
      "Avviare la registrazione?\n\nTutti i partecipanti vedranno l'indicatore REC. Conferma di averli informati e di rispettare le regole della scuola sulla registrazione (anche per gli studenti minorenni). Audio e trascrizione restano privati ai docenti della sessione."
    ))
    if (!consent) return
    setRecordingBusy(true)
    try {
      const { data } = await voiceCallsApi.startRecording(callId)
      const recorder = new CallRecorder((blob, meta) => voiceCallsApi.uploadSegment(data.id, blob, meta).then(() => undefined))
      recorder.onError = (message) => setError(message)
      recorder.start(data.started_at ? Date.parse(data.started_at) : Date.now())
      recorderRef.current = { id: data.id, recorder }
      syncRecorderTracks()
    } catch (err: any) {
      setError(err?.response?.data?.detail || tl("Impossibile avviare la registrazione"))
    } finally {
      setRecordingBusy(false)
    }
  }, [callId, syncRecorderTracks])

  // Own mic published/muted: keep the recorder on the current track.
  useEffect(() => { syncRecorderTracks() }, [isPublishing, isConnected, syncRecorderTracks])

  // Call ended for everyone, or another moderator stopped the recording: close the capture here.
  useEffect(() => {
    if (recorderRef.current && (!isActive || recordingState?.id !== recorderRef.current.id)) void stopRecording()
  }, [isActive, recordingState?.id, stopRecording])

  useEffect(() => {
    if (!recordingState?.started_at) { setRecordingClock(0); return }
    const started = Date.parse(recordingState.started_at)
    const tick = () => setRecordingClock(Math.max(0, Math.floor((Date.now() - started) / 1000)))
    tick()
    const timer = setInterval(tick, 1000)
    return () => clearInterval(timer)
  }, [recordingState?.started_at])

  useEffect(() => {
    if (!capturingHere) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [capturingHere])

  useEffect(() => () => { void recorderRef.current?.recorder.stop() }, [])

  const recordingLabel = `${Math.floor(recordingClock / 60).toString().padStart(2, '0')}:${(recordingClock % 60).toString().padStart(2, '0')}`

  const emitVoice = (event: string, payload: Record<string, unknown> = {}) => {
    if (!socket) return
    socket.emit(event, { ...roomPayload, ...payload }, (response: { error?: string }) => {
      if (response?.error) setError(response.error)
    })
  }

  const unlockRemoteAudio = () => {
    const elements = audioSinkRef.current?.querySelectorAll('audio') ?? []
    void Promise.all(Array.from(elements).map((el) => el.play()))
      .then(() => setAudioBlocked(false))
      .catch(() => setAudioBlocked(true))
  }

  const hasMedia = localCameraEnabled || screenShareEnabled || mediaTiles.length > 0
  const callTiles = [
    ...(localScreenStream ? [{
      id: 'local-screen',
      participantIdentity: String(roomRef.current?.localParticipant?.identity || 'local'),
      participantName: tl("Il tuo schermo"),
      source: 'screen' as const,
      stream: localScreenStream,
      local: true,
    }] : []),
    ...(localCameraStream ? [{
      id: 'local-camera',
      participantIdentity: String(roomRef.current?.localParticipant?.identity || 'local'),
      participantName: tl("La tua camera"),
      source: 'camera' as const,
      stream: localCameraStream,
      local: true,
    }] : []),
    ...mediaTiles,
  ]
  // Focus: what this viewer pinned › what a moderator put in evidence for everyone › a tile clicked in the
  // sidebar › automatically, whoever shares a screen (then any remote camera).
  const tileKey = (tile: { participantIdentity: string; source: string }) => `${tile.participantIdentity}|${tile.source}`
  const spotlight = currentVoiceState.spotlight ?? null
  const spotlightKey = spotlight ? `${spotlight.identity}|${spotlight.source}` : null
  const autoTile = callTiles.find((tile) => tile.source === 'screen' && !tile.local)
    ?? callTiles.find((tile) => tile.source === 'screen')
    ?? callTiles.find((tile) => !tile.local)
    ?? callTiles[0]
  const selectedTile = (pinnedKey ? callTiles.find((tile) => tileKey(tile) === pinnedKey) : undefined)
    ?? (spotlightKey ? callTiles.find((tile) => tileKey(tile) === spotlightKey) : undefined)
    ?? callTiles.find((tile) => tile.id === selectedTileId)
    ?? autoTile
    ?? null
  const focusReason: 'pinned' | 'spotlight' | 'auto' = selectedTile && pinnedKey === tileKey(selectedTile)
    ? 'pinned'
    : selectedTile && spotlightKey === tileKey(selectedTile) ? 'spotlight' : 'auto'
  const thumbnailTiles = selectedTile
    ? callTiles.filter((tile) => tile.id !== selectedTile.id)
    : callTiles

  const openVideoCallWindow = useCallback(() => {
    const popup = window.open('', `golinelli-videocall-${roomKey}`, 'popup=yes,width=1280,height=820')
    if (!popup) {
      setError(tl("Il browser ha bloccato la finestra della videocall"))
      return
    }

    popup.document.open()
    popup.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>Videocall classe</title>
          <style>
            * { box-sizing: border-box; }
            body { margin: 0; background: #050816; color: white; font-family: Inter, system-ui, sans-serif; }
            header { height: 64px; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; border-bottom: 1px solid rgba(255,255,255,.12); }
            h1 { margin: 0; font-size: 16px; }
            p { margin: 4px 0 0; color: rgba(255,255,255,.58); font-size: 12px; }
            .shell { height: calc(100vh - 64px); display: grid; grid-template-columns: minmax(0, 1fr) 280px; }
            main { min-width: 0; overflow: hidden; padding: 18px; display: grid; grid-template-rows: minmax(0, 1fr) auto; gap: 14px; }
            aside { border-left: 1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.03); padding: 18px; overflow: auto; }
            .stage { min-height: 0; overflow: hidden; border: 1px solid rgba(255,255,255,.12); border-radius: 22px; background: #000; box-shadow: 0 24px 70px rgba(0,0,0,.38); }
            .stage video { width: 100%; height: 100%; display: block; object-fit: contain; background: #000; }
            .strip { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; }
            .tile { width: 168px; flex: 0 0 168px; overflow: hidden; border: 1px solid rgba(255,255,255,.12); border-radius: 14px; background: #000; cursor: pointer; }
            .tile[data-active="true"] { border-color: #8b5cf6; box-shadow: 0 0 0 2px rgba(139,92,246,.35); }
            .tile video { width: 100%; aspect-ratio: 16 / 9; display: block; object-fit: cover; background: #000; }
            .label { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; border-top: 1px solid rgba(255,255,255,.10); font-size: 12px; font-weight: 700; }
            .pill { color: rgba(255,255,255,.75); text-transform: uppercase; font-size: 10px; letter-spacing: .05em; }
            .side-title { color: rgba(255,255,255,.45); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; margin-bottom: 14px; }
            .person { display: flex; align-items: center; gap: 10px; min-height: 38px; border-radius: 12px; background: rgba(255,255,255,.08); padding: 0 12px; margin-bottom: 8px; font-size: 14px; font-weight: 700; }
            .dot { width: 8px; height: 8px; border-radius: 999px; background: rgba(255,255,255,.25); flex: 0 0 auto; }
            .dot.live { background: #34d399; }
            .role { margin-left: auto; color: rgba(255,255,255,.55); font-size: 10px; text-transform: uppercase; }
            @media (max-width: 900px) { .shell { grid-template-columns: 1fr; } aside { display: none; } }
          </style>
        </head>
        <body>
          <header>
            <div>
              <h1>Videocall classe</h1>
              <p>Qualita camera: ${videoQuality.toUpperCase()} · Schermo max 5fps</p>
            </div>
          </header>
          <div class="shell">
          <main>
            <div id="stage" class="stage"></div>
            <div id="strip" class="strip"></div>
          </main>
          <aside>
            <div class="side-title">Partecipanti</div>
            ${voiceParticipants.map((participant) => `
              <div class="person">
                <span class="dot ${participant.role === 'teacher' || participant.active ? 'live' : ''}"></span>
                <span>${participant.role === 'teacher' ? 'Docente' : participant.name}</span>
                <span class="role">${participant.role === 'teacher' ? 'Docente' : participant.active ? 'Live' : participant.queued ? 'Richiede' : 'Connesso'}</span>
              </div>
            `).join('')}
          </aside>
          </div>
        </body>
      </html>
    `)
    popup.document.close()

    const stage = popup.document.getElementById('stage')
    const strip = popup.document.getElementById('strip')
    if (!stage || !strip) return
    const renderStage = (tile: typeof callTiles[number]) => {
      stage.innerHTML = ''
      const video = popup.document.createElement('video')
      video.srcObject = tile.stream
      video.autoplay = true
      video.playsInline = true
      video.muted = Boolean(tile.local)
      stage.appendChild(video)
      void video.play().catch(() => {})
    }
    if (selectedTile) renderStage(selectedTile)
    callTiles.forEach((tile) => {
      const wrapper = popup.document.createElement('div')
      wrapper.className = 'tile'
      wrapper.dataset.active = tile.id === selectedTile?.id ? 'true' : 'false'
      const video = popup.document.createElement('video')
      video.srcObject = tile.stream
      video.autoplay = true
      video.playsInline = true
      video.muted = Boolean(tile.local)
      const label = popup.document.createElement('div')
      label.className = 'label'
      label.innerHTML = `<span>${tile.participantName}</span><span class="pill">${tile.source === 'screen' ? 'Schermo' : 'Video'}</span>`
      wrapper.appendChild(video)
      wrapper.appendChild(label)
      wrapper.onclick = () => {
        Array.from(strip.querySelectorAll('.tile')).forEach((item) => ((item as HTMLElement).dataset.active = 'false'))
        wrapper.dataset.active = 'true'
        renderStage(tile)
      }
      strip.appendChild(wrapper)
      void video.play().catch(() => {})
    })
    popup.focus()
  }, [callTiles, selectedTile, roomKey, videoQuality, voiceParticipants])

  if (!voiceState?.active && !isTeacher && !isPage) return null

  // ── Status label ─────────────────────────────────────────────────────────
  const statusText = (() => {
    if (!isConnected) return isConnecting ? tl("Connessione...") : connectionStatus || tl("Pronto")
    if (isMuted) return tl("Microfono disattivato")
    if (isPublishing) {
      if (isTeacher) return activeSpeakerIds.length > 0 ? tl("{0} studenti in parola.", activeSpeakerIds.length) : tl("Voce docente attiva.")
      return tl("Sei in parola.")
    }
    return isTeacher || activeSpeakerIds.length === 0 ? tl("In ascolto.") : tl("Stai ascoltando la classe.")
  })()

  if (isPage) {
    const queued = voiceParticipants.filter((participant) => participant.queued)
    const controlButton = (active: boolean, danger = false) =>
      `flex h-12 min-w-12 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors disabled:opacity-40 ${
        danger ? 'bg-red-600 text-white hover:bg-red-700' : active ? 'bg-white text-slate-900 hover:bg-white/90' : 'bg-white/10 text-white hover:bg-white/20'
      }`
    const participantLabel = (participant: typeof voiceParticipants[number]) =>
      participant.role === 'teacher' && participant.id === 'teacher' ? tl("Docente") : participant.name

    return (
      <div className="flex min-h-0 flex-1 gap-3">
        <div ref={audioSinkRef} className="hidden" />

        {/* Stage + controls */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-3xl bg-slate-950 text-white">
          {recordingState && (
            <div className="pointer-events-none absolute bottom-20 left-1/2 z-10 -translate-x-1/2 rounded-full bg-red-600 px-3 py-1 text-xs font-bold tracking-wide shadow-lg">
              ● REC {recordingLabel} · {tl("La chiamata è registrata")}
            </div>
          )}
          {(error || audioBlocked) && (
            <div className="absolute inset-x-0 top-0 z-10 flex flex-col gap-1 p-3">
              {error && <div className="rounded-xl bg-red-600/90 px-3 py-2 text-xs font-semibold">{error}</div>}
              {audioBlocked && (
                <button type="button" onClick={unlockRemoteAudio} className="flex items-center gap-2 rounded-xl bg-amber-500/90 px-3 py-2 text-left text-xs font-semibold text-slate-950">
                  <VolumeX className="h-4 w-4" />{tl("Tocca qui per abilitare l'audio")}
                </button>
              )}
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
            {!isActive ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
                <Video className="h-12 w-12 text-white/30" />
                <p className="max-w-md text-lg font-semibold">
                  {isModerator ? tl("La videochiamata non è ancora iniziata") : tl("In attesa che il docente avvii la videochiamata")}
                </p>
                {waitingHint && <p className="max-w-md text-sm text-white/60">{waitingHint}</p>}
                {isModerator && (
                  <button type="button" onClick={() => emitVoice('voice_room_start')} className="flex h-12 items-center gap-2 rounded-full bg-emerald-500 px-6 text-sm font-bold text-white hover:bg-emerald-600">
                    <Phone className="h-4 w-4" />{tl("Avvia la videochiamata")}
                  </button>
                )}
              </div>
            ) : selectedTile ? (
              <>
                <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-black">
                  <StreamVideo stream={selectedTile.stream} muted={selectedTile.local} className="h-full w-full object-contain" />
                  <div className="absolute left-3 top-3 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-black/60 px-3 py-1 text-xs font-semibold">
                      {selectedTile.participantName} · {selectedTile.source === 'screen' ? tl("Schermo") : 'Video'}
                    </span>
                    {focusReason === 'spotlight' && (
                      <span className="flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-bold text-slate-950"><Sparkles className="h-3.5 w-3.5" />{tl("In evidenza per tutti")}</span>
                    )}
                    {focusReason === 'pinned' && (
                      <span className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-950"><Pin className="h-3.5 w-3.5" />{tl("Fissato da te")}</span>
                    )}
                  </div>
                  <div className="absolute right-3 top-3 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setPinnedKey(focusReason === 'pinned' ? null : tileKey(selectedTile))}
                      className="flex h-9 items-center gap-1.5 rounded-full bg-black/60 px-3 text-xs font-semibold hover:bg-black/80"
                      title={focusReason === 'pinned' ? tl("Torna alla vista automatica") : tl("Tieni questa vista al centro solo per te")}
                    >
                      {focusReason === 'pinned' ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                      {focusReason === 'pinned' ? tl("Sblocca") : tl("Fissa")}
                    </button>
                    {isModerator && (
                      <button
                        type="button"
                        onClick={() => emitVoice('voice_set_spotlight', focusReason === 'spotlight'
                          ? { identity: null }
                          : { identity: selectedTile.participantIdentity, source: selectedTile.source, name: selectedTile.participantName })}
                        className={`flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${focusReason === 'spotlight' ? 'bg-amber-400 text-slate-950 hover:bg-amber-300' : 'bg-black/60 hover:bg-black/80'}`}
                        title={tl("Mostra questa vista al centro a tutti i partecipanti")}
                      >
                        <Sparkles className="h-4 w-4" />
                        {focusReason === 'spotlight' ? tl("Togli evidenza") : tl("Evidenzia per tutti")}
                      </button>
                    )}
                  </div>
                </div>
                {thumbnailTiles.length > 0 && (
                  <div className="flex flex-shrink-0 gap-2 overflow-x-auto">
                    {thumbnailTiles.map((tile) => (
                      <button key={tile.id} type="button" onClick={() => setPinnedKey(tileKey(tile))} title={tl("Fissa al centro")} className="group relative aspect-video w-44 flex-shrink-0 overflow-hidden rounded-xl bg-black ring-1 ring-white/10 hover:ring-white/40">
                        <StreamVideo stream={tile.stream} muted={tile.local} />
                        <span className="absolute bottom-1.5 left-1.5 max-w-[80%] truncate rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold">{tile.participantName}</span>
                        {spotlightKey === tileKey(tile) && <Sparkles className="absolute right-1.5 top-1.5 h-4 w-4 text-amber-300" />}
                        <span className="absolute inset-0 hidden items-center justify-center bg-black/40 text-xs font-semibold group-hover:flex"><Pin className="mr-1 h-4 w-4" />{tl("Fissa")}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="grid min-h-0 flex-1 auto-rows-fr gap-3 overflow-y-auto" style={{ gridTemplateColumns: `repeat(${Math.min(4, Math.max(1, Math.ceil(Math.sqrt(voiceParticipants.length || 1))))}, minmax(0, 1fr))` }}>
                {voiceParticipants.map((participant) => {
                  const live = participant.role === 'teacher' || participant.active
                  return (
                    <div key={participant.id} className={`flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-2xl bg-white/5 ${participant.active ? 'ring-2 ring-emerald-400' : participant.queued ? 'ring-2 ring-amber-400' : ''}`}>
                      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-2xl font-bold">
                        {participantLabel(participant).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="max-w-[90%] truncate text-sm font-semibold">{participantLabel(participant)}{participant.local ? ` (${tl("tu")})` : ''}</span>
                      <span className="text-[11px] text-white/50">{participant.queued ? tl("Chiede la parola") : live ? (participant.role === 'teacher' ? tl("Docente") : tl("In parola")) : tl("In ascolto")}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Control bar */}
          <div className="flex flex-shrink-0 flex-wrap items-center justify-center gap-2 border-t border-white/10 px-3 py-3">
            {isActive && isConnected && isPublishing && (
              <button type="button" onClick={() => void toggleMute()} className={controlButton(!isMuted)} title={isMuted ? tl("Attiva microfono") : tl("Silenzia microfono")} aria-pressed={!isMuted}>
                {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                {!isMuted && <VUMeter level={localAudioLevel} />}
              </button>
            )}
            {isActive && !isTeacher && (
              <button type="button" onClick={() => emitVoice(isSpeaker || isQueued ? 'voice_cancel_request' : 'voice_request_speak')} className={controlButton(isSpeaker || isQueued)}>
                {isSpeaker || isQueued ? <X className="h-5 w-5" /> : <Hand className="h-5 w-5" />}
                <span>{isSpeaker ? tl("Termina intervento") : isQueued ? tl("Annulla richiesta") : tl("Chiedi la parola")}</span>
              </button>
            )}
            {isActive && canPublishMedia && (
              <>
                <button type="button" onClick={() => void toggleCamera()} disabled={!isConnected} className={controlButton(localCameraEnabled)} title={tl("Camera")} aria-pressed={localCameraEnabled}>
                  {localCameraEnabled ? <Video className="h-5 w-5" /> : <VideoOff className="h-5 w-5" />}
                </button>
                <button type="button" onClick={() => void toggleScreenShare()} disabled={!isConnected} className={controlButton(screenShareEnabled)} title={tl("Condividi schermo")} aria-pressed={screenShareEnabled}>
                  {screenShareEnabled ? <ScreenShareOff className="h-5 w-5" /> : <ScreenShare className="h-5 w-5" />}
                </button>
                <button type="button" onClick={() => void updateVideoQuality(videoQuality === 'hi' ? 'low' : 'hi')} className={controlButton(false)} title={tl("Qualità video")}>
                  <span className="text-xs font-bold">{videoQuality === 'hi' ? 'HD' : 'LOW'}</span>
                </button>
              </>
            )}
            {isActive && callTiles.length > 0 && (
              <button type="button" onClick={openVideoCallWindow} className={controlButton(false)} title={tl("Apri in una finestra")}>
                <PictureInPicture2 className="h-5 w-5" />
              </button>
            )}
            {isActive && callId && isModerator && (
              recordingState ? (
                <button type="button" disabled={recordingBusy} onClick={() => {
                  if (capturingHere) void stopRecording()
                  else if (window.confirm(tl("Un altro docente sta registrando dal suo browser. Fermare la registrazione per tutti?"))) void voiceCallsApi.stopRecording(recordingState.id).catch(() => setError(tl("Impossibile fermare la registrazione")))
                }} className={controlButton(false, true)} title={tl("Ferma la registrazione: trascrizione e riassunto partono subito")}>
                  {recordingBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <span className="h-3 w-3 rounded-sm bg-white" />}
                  <span>{tl("Stop")} {recordingLabel}</span>
                </button>
              ) : (
                <button type="button" disabled={recordingBusy || !isConnected} onClick={() => void startRecording()} className={controlButton(false)} title={tl("Registra: trascrizione con i nomi dei partecipanti, riassunto e analisi finiscono nella knowledge di sessione")}>
                  {recordingBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <span className="h-3 w-3 rounded-full bg-red-500" />}
                  <span>{tl("Registra")}</span>
                </button>
              )
            )}
            <span className="mx-1 hidden h-8 w-px bg-white/10 sm:block" />
            <button type="button" onClick={() => setSideOpen((open) => !open)} className={controlButton(sideOpen)} title={tl("Chat e partecipanti")} aria-pressed={sideOpen}>
              <MessageSquare className="h-5 w-5" />
              {queued.length > 0 && isModerator && <span className="rounded-full bg-amber-400 px-1.5 text-[10px] font-bold text-slate-950">{queued.length}</span>}
            </button>
            {isModerator && isActive && (
              <button type="button" onClick={() => { if (window.confirm(tl("Terminare la videochiamata per tutti?"))) emitVoice('voice_room_end') }} className={controlButton(false, true)}>
                <PhoneOff className="h-5 w-5" /><span>{tl("Termina per tutti")}</span>
              </button>
            )}
            {onLeave && (
              <button type="button" onClick={onLeave} className={controlButton(false, !isModerator || !isActive)} title={tl("Esci")}>
                <LogOut className="h-5 w-5" /><span>{tl("Esci")}</span>
              </button>
            )}
          </div>
        </div>

        {/* Right column: class chat / participants */}
        {sideOpen && (
          <aside className="flex w-full max-w-[380px] min-w-[300px] flex-col overflow-hidden rounded-3xl bg-[var(--ds-surface-raised)] shadow-[var(--shadow-sm)] max-lg:fixed max-lg:inset-y-3 max-lg:right-3 max-lg:z-40 max-lg:w-[calc(100%-1.5rem)]">
            <div className="flex flex-shrink-0 items-center gap-1 p-2">
              {chatPanel && (
                <button type="button" onClick={() => setSideTab('chat')} aria-pressed={sideTab === 'chat'} className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-xs font-semibold ${sideTab === 'chat' ? 'ds-selected' : 'text-[var(--text-secondary)] hover:bg-[var(--ds-surface-muted)]'}`}>
                  <MessageSquare className="h-4 w-4" />{tl("Chat di classe")}
                </button>
              )}
              <button type="button" onClick={() => setSideTab('people')} aria-pressed={sideTab === 'people' || !chatPanel} className={`flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-xs font-semibold ${sideTab === 'people' || !chatPanel ? 'ds-selected' : 'text-[var(--text-secondary)] hover:bg-[var(--ds-surface-muted)]'}`}>
                <Users className="h-4 w-4" />{tl("Partecipanti")} · {voiceParticipants.length}
              </button>
              <button type="button" onClick={() => setSideOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--text-secondary)] hover:bg-[var(--ds-surface-muted)] lg:hidden" aria-label={tl("Chiudi")}>
                <X className="h-4 w-4" />
              </button>
            </div>
            {chatPanel && (
              <div className={`min-h-0 flex-1 ${sideTab === 'chat' ? 'flex flex-col' : 'hidden'}`}>{chatPanel}</div>
            )}
            {(sideTab === 'people' || !chatPanel) && (
              <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
                {voiceParticipants.length === 0 && <p className="px-2 py-4 text-center text-xs text-[var(--text-secondary)]">{tl("Nessun partecipante connesso")}</p>}
                {voiceParticipants.map((participant) => (
                  <div key={participant.id} className="flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-[var(--ds-surface-muted)]">
                    <span className={`h-2 w-2 flex-shrink-0 rounded-full ${participant.role === 'teacher' || participant.active ? 'bg-emerald-500' : participant.queued ? 'bg-amber-400' : 'bg-slate-300'}`} />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--text-primary)]">{participantLabel(participant)}{participant.local ? ` (${tl("tu")})` : ''}</span>
                    {isModerator && participant.role === 'student' && participant.queued && (
                      <button type="button" onClick={() => emitVoice('voice_grant_speaker', { student_id: participant.id })} className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800 hover:bg-amber-200">{tl("Dai parola")}</button>
                    )}
                    {isModerator && participant.role === 'student' && participant.active && (
                      <button type="button" onClick={() => emitVoice('voice_revoke_speaker', { student_id: participant.id })} className="rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-bold text-emerald-800 hover:bg-emerald-200">{tl("Togli parola")}</button>
                    )}
                    {!(isModerator && participant.role === 'student' && (participant.queued || participant.active)) && (
                      <span className="text-[11px] text-[var(--text-secondary)]">{participant.role === 'teacher' ? tl("Docente") : participant.active ? tl("In parola") : participant.queued ? tl("Chiede la parola") : tl("In ascolto")}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>
    )
  }

  return (
    <div className="ds-semantic-info mx-3 mt-3 overflow-hidden rounded-2xl">
      <div ref={audioSinkRef} className="hidden" />

      {/* Header row */}
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${isActive ? 'animate-pulse bg-emerald-500 ring-2 ring-emerald-200' : 'bg-sky-300'}`} />
            <p
              className="inline-flex rounded-full text-xs font-bold uppercase tracking-wide text-[var(--logo-blue-strong)]"
              aria-label={tl("Chiamata: parla e condividi lo schermo con la tua classe.")}
            >
              {tl("Chiamata")}
            </p>
          </div>
          <p className="mt-0.5 text-[10px] leading-tight text-[var(--logo-blue-strong)]/80">
            {tl("Parla e condividi lo schermo con la tua classe")}
          </p>
          <p className="truncate text-[10px] text-[var(--logo-blue-strong)]/70">
            {isActive && activeSpeaker ? tl("{0} in parola", activeSpeaker.nickname || 'Studente') : isActive ? statusText : tl("Non attiva")}
          </p>
        </div>

        {isModerator ? (
          <Button
            size="sm"
            onClick={() => emitVoice(isActive ? 'voice_room_end' : 'voice_room_start')}
            className={`h-8 rounded-full bg-none px-3 text-xs font-bold shadow-sm ${isActive ? 'bg-white text-red-600 hover:bg-white/90' : 'bg-white text-[var(--app-accent-text)] hover:bg-white/90'}`}
          >
            {isActive ? <PhoneOff className="mr-1.5 h-3.5 w-3.5" /> : <Phone className="mr-1.5 h-3.5 w-3.5" />}
            {isActive ? tl("Chiudi") : tl("Avvia")}
          </Button>
        ) : !isTeacher ? (
          <Button
            size="sm"
            disabled={!isActive}
            onClick={() => emitVoice(
              isSpeaker || isQueued ? 'voice_cancel_request' : 'voice_request_speak',
            )}
            className={`h-8 rounded-full bg-none px-3 text-xs font-bold shadow-sm ${
              isQueued || isSpeaker
                ? 'border border-white/40 bg-white/15 text-white hover:bg-white/25'
                : 'bg-white text-[var(--app-accent-text)] hover:bg-white/90'
            }`}
          >
            {isSpeaker || isQueued ? <X className="mr-1.5 h-3.5 w-3.5" /> : <Hand className="mr-1.5 h-3.5 w-3.5" />}
            {isSpeaker ? tl("Termina") : isQueued ? tl("Annulla") : tl("Intervieni")}
          </Button>
        ) : null}
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
          <span>{tl("Tocca qui per abilitare l'audio")}</span>
        </button>
      )}

      {isActive && (
        <div className="space-y-2 px-3 py-2">
          <div className="rounded-xl border border-slate-100 bg-white px-2.5 py-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{tl("Utenti voce")}</span>
              <span className="text-[10px] font-semibold text-slate-400">{voiceParticipants.length}</span>
            </div>
            <div className="space-y-1">
              {voiceParticipants.map((participant) => (
                <div key={participant.id} className="flex items-center gap-2 rounded-lg px-1 py-1">
                  <span className={`h-2 w-2 rounded-full ${participant.role === 'teacher' || participant.active ? 'animate-pulse bg-emerald-500' : participant.queued ? 'bg-amber-400' : 'bg-slate-300'}`} />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">
                    {participant.role === 'teacher' && (!callId || participant.id === 'teacher') ? tl("Docente") : participant.name}
                  </span>
                  {isModerator && participant.role === 'student' && participant.queued && (
                    <button
                      type="button"
                      onClick={() => emitVoice('voice_grant_speaker', { student_id: participant.id })}
                      className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-700 hover:bg-amber-100"
                    >
                      {tl("Dai parola")}
                    </button>
                  )}
                  {isModerator && participant.role === 'student' && participant.active && (
                    <button
                      type="button"
                      onClick={() => emitVoice('voice_revoke_speaker', { student_id: participant.id })}
                      className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-700 hover:bg-emerald-100"
                    >
                      {tl("Togli")}
                    </button>
                  )}
                  {(!isModerator || participant.role === 'teacher' || (!participant.queued && !participant.active)) && (
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                      participant.role === 'teacher' || participant.active ? 'bg-emerald-50 text-emerald-700' : participant.queued ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {participant.role === 'teacher' ? tl("Docente") : participant.active ? 'Live' : participant.queued ? tl("Richiede") : participant.local ? 'Tu' : tl("Connesso")}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Status + VU meters + mute button */}
          <div className="flex items-center gap-2 rounded-xl bg-white px-2.5 py-2 text-[11px] text-slate-500">
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
                title={isMuted ? tl("Attiva microfono") : tl("Silenzia microfono")}
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

          {(canPublishMedia || hasMedia) && (
            <div className="space-y-2 rounded-xl border border-slate-100 bg-white p-2">
              {canPublishMedia && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void toggleCamera()}
                    disabled={!isConnected}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-bold transition-colors disabled:opacity-50 ${
                      localCameraEnabled
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {localCameraEnabled ? <Video className="h-3.5 w-3.5" /> : <VideoOff className="h-3.5 w-3.5" />}
                    Video
                  </button>

                  <button
                    type="button"
                    onClick={() => void toggleScreenShare()}
                    disabled={!isConnected}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[11px] font-bold transition-colors disabled:opacity-50 ${
                      screenShareEnabled
                        ? 'border-sky-200 bg-sky-50 text-sky-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {screenShareEnabled ? <ScreenShareOff className="h-3.5 w-3.5" /> : <ScreenShare className="h-3.5 w-3.5" />}
                    {tl("Schermo")}
                  </button>

                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="text-[10px] font-bold text-slate-500">{tl("Qualità")}</span>
                    <div className="inline-flex h-8 overflow-hidden rounded-full border border-slate-200 bg-white p-0.5">
                      {(['low', 'hi'] as const).map((quality) => (
                        <button
                          key={quality}
                          type="button"
                          onClick={() => void updateVideoQuality(quality)}
                          aria-pressed={videoQuality === quality}
                          aria-label={quality === 'low' ? tl("Qualità video ridotta") : tl("Qualità video alta")}
                          title={quality === 'low' ? tl("Qualità video ridotta") : tl("Qualità video alta")}
                          className={`rounded-full px-2.5 text-[10px] font-black uppercase transition-colors ${
                            videoQuality === quality
                              ? 'bg-[image:var(--selection-active-bg)] text-[var(--selection-active-text)]'
                              : 'text-slate-500 hover:bg-slate-100'
                          }`}
                        >
                          {quality}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {hasMedia && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Preview video</span>
                  <button
                    type="button"
                    onClick={openVideoCallWindow}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 text-[10px] font-bold text-slate-600 hover:bg-slate-100"
                  >
                    <PictureInPicture2 className="h-3 w-3" />
                    {tl("Finestra")}
                  </button>
                </div>
              )}

              {hasMedia && selectedTile && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setSelectedTileId(selectedTile.id)}
                    className="w-full overflow-hidden rounded-xl border border-violet-300 bg-slate-900 text-left shadow-sm"
                  >
                    <div className="aspect-video w-full">
                      <StreamVideo stream={selectedTile.stream} muted={selectedTile.local} />
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-white/10 px-2 py-1.5 text-[10px] font-semibold text-white/85">
                      <span className="truncate">{selectedTile.participantName}</span>
                      <span className="rounded-full bg-white/10 px-1.5 py-0.5 uppercase">
                        {selectedTile.source === 'screen' ? tl("Schermo") : 'Video'}
                      </span>
                    </div>
                  </button>

                  {thumbnailTiles.length > 0 && (
                    <div className={`flex gap-2 overflow-x-auto pb-1 ${isPage ? 'max-h-40' : 'max-h-24'}`}>
                      {thumbnailTiles.map((tile) => (
                        <button
                          key={tile.id}
                          type="button"
                          onClick={() => setSelectedTileId(tile.id)}
                          className={`${isPage ? 'w-48' : 'w-24'} flex-shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-900 text-left hover:border-violet-300`}
                        >
                          <div className="aspect-video w-full">
                        <StreamVideo stream={tile.stream} muted={tile.local} />
                      </div>
                          <div className="flex items-center justify-between gap-1 border-t border-white/10 px-1.5 py-1 text-[9px] font-semibold text-white/80">
                            <span className="truncate">{tile.participantName}</span>
                            <span className="rounded-full bg-white/10 px-1 py-0.5 uppercase">
                          {tile.source === 'screen' ? tl("Schermo") : 'Video'}
                        </span>
                      </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
