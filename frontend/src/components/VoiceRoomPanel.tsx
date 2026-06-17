import { useCallback, useEffect, useRef, useState } from 'react'
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
} from 'lucide-react'

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
  active_speaker?: VoiceQueueItem | null
  active_speaker_ids?: string[]
  active_speakers?: VoiceQueueItem[]
  queue: VoiceQueueItem[]
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

export function VoiceRoomPanel({ sessionId, userType, currentUserId, socket }: VoiceRoomPanelProps) {
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
          name: item.nickname || 'Studente',
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
      name: speaker.nickname || 'Studente',
      role: 'student' as const,
      local: speaker.student_id === currentUserId,
      active: true,
      queued: false,
    })),
    ...currentVoiceState.queue.map((item) => ({
      id: item.student_id,
      name: item.nickname || 'Studente',
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

  const readParticipantName = (participant: any) => participant?.name || participant?.identity || 'Partecipante'

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
        name: participant?.name || (role === 'teacher' ? 'Docente' : 'Studente'),
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
      setError(err?.message || 'Microfono non accessibile')
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
      setError(err?.message || 'Videocamera non accessibile')
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
      setError(err?.message || 'Condivisione schermo non disponibile')
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
      setError(err?.message || 'Qualità video non aggiornata')
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
        voiceApi.createLiveKitToken(sessionId),
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
        setError(err?.message || 'Audio remoto non disponibile')
      })

      room.on(RoomEvent.TrackUnsubscribed, (track: any, publication: any) => {
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
      setError(err?.response?.data?.detail || err?.message || 'Connessione voce non riuscita')
      await disconnectRoom()
    } finally {
      joiningRef.current = false
      setIsConnecting(false)
    }
  }, [desiredPublish, disconnectRoom, isActive, sessionId, setLocalPublishing, syncRoomParticipants])

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
    if (!canPublishMedia && (localCameraEnabled || screenShareEnabled)) {
      void stopLocalVideoPublishing()
    }
    void setLocalPublishing(desiredPublish)
  }, [canPublishMedia, desiredPublish, disconnectRoom, isActive, joinRoom, localCameraEnabled, screenShareEnabled, setLocalPublishing, stopLocalVideoPublishing])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('golinelli:voice-room-state', {
      detail: { sessionId, active: isActive },
    }))
  }, [isActive, sessionId])

  useEffect(() => () => {
    window.dispatchEvent(new CustomEvent('golinelli:voice-room-state', {
      detail: { sessionId, active: false },
    }))
  }, [sessionId])

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

  const hasMedia = localCameraEnabled || screenShareEnabled || mediaTiles.length > 0
  const callTiles = [
    ...(localScreenStream ? [{
      id: 'local-screen',
      participantName: 'Il tuo schermo',
      source: 'screen' as const,
      stream: localScreenStream,
      local: true,
    }] : []),
    ...(localCameraStream ? [{
      id: 'local-camera',
      participantName: 'La tua camera',
      source: 'camera' as const,
      stream: localCameraStream,
      local: true,
    }] : []),
    ...mediaTiles,
  ]
  const selectedTile = callTiles.find((tile) => tile.id === selectedTileId) ?? callTiles[0] ?? null
  const thumbnailTiles = selectedTile
    ? callTiles.filter((tile) => tile.id !== selectedTile.id)
    : callTiles

  const openVideoCallWindow = useCallback(() => {
    const popup = window.open('', `golinelli-videocall-${sessionId}`, 'popup=yes,width=1280,height=820')
    if (!popup) {
      setError('Il browser ha bloccato la finestra della videocall')
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
  }, [callTiles, selectedTile, sessionId, videoQuality, voiceParticipants])

  if (!voiceState?.active && !isTeacher) return null

  // ── Status label ─────────────────────────────────────────────────────────
  const statusText = (() => {
    if (!isConnected) return isConnecting ? 'Connessione...' : connectionStatus || 'Pronto'
    if (isMuted) return 'Microfono disattivato'
    if (isPublishing) {
      if (isTeacher) return activeSpeakerIds.length > 0 ? `${activeSpeakerIds.length} studenti in parola.` : 'Voce docente attiva.'
      return 'Sei in parola.'
    }
    return isTeacher || activeSpeakerIds.length === 0 ? 'In ascolto.' : 'Stai ascoltando la classe.'
  })()

  return (
    <div
      className="mx-3 mt-3 overflow-hidden rounded-2xl border"
      style={{
        background:
          'linear-gradient(135deg, var(--app-accent) 0%, color-mix(in srgb, var(--app-accent) 80%, #000) 100%)',
        borderColor: 'color-mix(in srgb, var(--app-accent) 55%, #000)',
        boxShadow: '0 12px 28px color-mix(in srgb, var(--app-accent) 32%, transparent)',
      }}
    >
      <div ref={audioSinkRef} className="hidden" />

      {/* Header row */}
      <div className="flex items-center justify-between gap-2 border-b border-white/15 px-3 py-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${isActive ? 'animate-pulse bg-emerald-300 ring-2 ring-emerald-300/40' : 'bg-white/50'}`} />
            <p className="text-xs font-bold uppercase tracking-wide text-white">Voce classe</p>
          </div>
          <p className="truncate text-[10px] text-white/75">
            {isActive && activeSpeaker ? `${activeSpeaker.nickname || 'Studente'} in parola` : isActive ? statusText : 'Non attiva'}
          </p>
        </div>

        {isTeacher ? (
          <Button
            size="sm"
            onClick={() => emitVoice(isActive ? 'voice_room_end' : 'voice_room_start')}
            className={`h-8 rounded-full bg-none px-3 text-xs font-bold shadow-sm ${isActive ? 'bg-white text-red-600 hover:bg-white/90' : 'bg-white text-[var(--app-accent-text)] hover:bg-white/90'}`}
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
            className={`h-8 rounded-full bg-none px-3 text-xs font-bold shadow-sm ${
              isQueued || isSpeaker
                ? 'border border-white/40 bg-white/15 text-white hover:bg-white/25'
                : 'bg-white text-[var(--app-accent-text)] hover:bg-white/90'
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
          <div className="rounded-xl border border-slate-100 bg-white px-2.5 py-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Utenti voce</span>
              <span className="text-[10px] font-semibold text-slate-400">{voiceParticipants.length}</span>
            </div>
            <div className="space-y-1">
              {voiceParticipants.map((participant) => (
                <div key={participant.id} className="flex items-center gap-2 rounded-lg px-1 py-1">
                  <span className={`h-2 w-2 rounded-full ${participant.role === 'teacher' || participant.active ? 'animate-pulse bg-emerald-500' : participant.queued ? 'bg-amber-400' : 'bg-slate-300'}`} />
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700">
                    {participant.role === 'teacher' ? 'Docente' : participant.name}
                  </span>
                  {isTeacher && participant.role === 'student' && participant.queued && (
                    <button
                      type="button"
                      onClick={() => emitVoice('voice_grant_speaker', { student_id: participant.id })}
                      className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-bold uppercase text-amber-700 hover:bg-amber-100"
                    >
                      Dai parola
                    </button>
                  )}
                  {isTeacher && participant.role === 'student' && participant.active && (
                    <button
                      type="button"
                      onClick={() => emitVoice('voice_revoke_speaker', { student_id: participant.id })}
                      className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-700 hover:bg-emerald-100"
                    >
                      Togli
                    </button>
                  )}
                  {(!isTeacher || participant.role === 'teacher' || (!participant.queued && !participant.active)) && (
                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ${
                      participant.role === 'teacher' || participant.active ? 'bg-emerald-50 text-emerald-700' : participant.queued ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {participant.role === 'teacher' ? 'Docente' : participant.active ? 'Live' : participant.queued ? 'Richiede' : participant.local ? 'Tu' : 'Connesso'}
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
                    Schermo
                  </button>

                  <div className="ml-auto inline-flex h-8 overflow-hidden rounded-full border border-slate-200 bg-white p-0.5">
                    {(['low', 'hi'] as const).map((quality) => (
                      <button
                        key={quality}
                        type="button"
                        onClick={() => void updateVideoQuality(quality)}
                        className={`rounded-full px-2.5 text-[10px] font-black uppercase transition-colors ${
                          videoQuality === quality
                            ? 'bg-slate-900 text-white'
                            : 'text-slate-500 hover:bg-slate-100'
                        }`}
                      >
                        {quality}
                      </button>
                    ))}
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
                    Finestra
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
                        {selectedTile.source === 'screen' ? 'Schermo' : 'Video'}
                      </span>
                    </div>
                  </button>

                  {thumbnailTiles.length > 0 && (
                    <div className="flex max-h-24 gap-2 overflow-x-auto pb-1">
                      {thumbnailTiles.map((tile) => (
                        <button
                          key={tile.id}
                          type="button"
                          onClick={() => setSelectedTileId(tile.id)}
                          className="w-24 flex-shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-900 text-left hover:border-violet-300"
                        >
                          <div className="aspect-video w-full">
                        <StreamVideo stream={tile.stream} muted={tile.local} />
                      </div>
                          <div className="flex items-center justify-between gap-1 border-t border-white/10 px-1.5 py-1 text-[9px] font-semibold text-white/80">
                            <span className="truncate">{tile.participantName}</span>
                            <span className="rounded-full bg-white/10 px-1 py-0.5 uppercase">
                          {tile.source === 'screen' ? 'Schermo' : 'Video'}
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
