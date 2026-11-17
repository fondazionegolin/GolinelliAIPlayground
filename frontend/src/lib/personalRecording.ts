/**
 * Personal recording of the teacher (navbar «REC»): microphone, optionally the system/tab audio, captured in the
 * browser, uploaded in segments and transcribed after stop. It lives in a store so it keeps running while the
 * recordings dialog is closed or the teacher navigates elsewhere.
 */
import { create } from 'zustand'
import { voiceCallsApi, type CallRecording, type RecordingPipeline } from '@/lib/api'
import { CallRecorder } from '@/lib/callRecorder'
import { useAuthStore } from '@/stores/auth'
import { tl } from '@/i18n/tl'

export type RecordingSource = 'mic' | 'mic+system'

type State = {
  status: 'idle' | 'starting' | 'recording' | 'stopping'
  source: RecordingSource
  recordingId: string | null
  startedAt: number | null
  error: string | null
  /** Last recording closed by this browser: lets the UI open it right away. */
  lastClosed: CallRecording | null
  start: (source: RecordingSource, pipeline?: RecordingPipeline) => Promise<void>
  stop: () => Promise<void>
  clearError: () => void
}

let recorder: CallRecorder | null = null
let streams: MediaStream[] = []
let wakeLock: { release: () => Promise<void> } | null = null
let beforeUnload: ((event: BeforeUnloadEvent) => void) | null = null

/** System audio needs getDisplayMedia with audio: desktop Chromium only (not on phones, not on Safari/Firefox). */
export function systemAudioSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getDisplayMedia && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}

export function recordingSupported(): boolean {
  return CallRecorder.supported() && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

function releaseCapture() {
  for (const stream of streams) stream.getTracks().forEach((track) => track.stop())
  streams = []
  recorder = null
  if (wakeLock) { void wakeLock.release().catch(() => undefined); wakeLock = null }
  if (beforeUnload) { window.removeEventListener('beforeunload', beforeUnload); beforeUnload = null }
}

export const usePersonalRecording = create<State>((set, get) => ({
  status: 'idle',
  source: 'mic',
  recordingId: null,
  startedAt: null,
  error: null,
  lastClosed: null,
  clearError: () => set({ error: null }),

  start: async (source, pipeline) => {
    if (get().status !== 'idle') return
    set({ status: 'starting', error: null, source })
    try {
      if (!recordingSupported()) throw new Error(tl("Questo browser non supporta la registrazione audio"))
      const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      streams.push(mic)
      let system: MediaStream | null = null
      if (source === 'mic+system') {
        // Chrome needs a video request to offer «share audio»; the video track is not recorded.
        system = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
        streams.push(system)
        if (!system.getAudioTracks().length) {
          throw new Error(tl("Nessun audio condiviso: nella finestra di condivisione scegli una scheda e attiva «Condividi audio»"))
        }
      }
      const { data } = await voiceCallsApi.startPersonalRecording(pipeline)
      const user = useAuthStore.getState().user
      const name = tl("Docente")
      const capture = new CallRecorder((blob, meta) => voiceCallsApi.uploadSegment(data.id, blob, meta).then(() => undefined))
      capture.onError = (message) => set({ error: message })
      capture.start(data.started_at ? Date.parse(data.started_at) : Date.now())
      capture.addTrack('mic', `teacher:${user?.id ?? 'me'}`, name, mic.getAudioTracks()[0])
      if (system) {
        const track = system.getAudioTracks()[0]
        capture.addTrack('system', 'system:audio', tl("Audio di sistema"), track)
        // The teacher stopped sharing from the browser bar: keep recording the microphone only.
        system.getVideoTracks().forEach((video) => { video.onended = () => capture.removeTrack('system') })
        track.onended = () => capture.removeTrack('system')
      }
      recorder = capture
      try { wakeLock = await (navigator as any).wakeLock?.request('screen') ?? null } catch { wakeLock = null } // phones: keep the screen on
      beforeUnload = (event) => { event.preventDefault(); event.returnValue = '' }
      window.addEventListener('beforeunload', beforeUnload)
      set({ status: 'recording', recordingId: data.id, startedAt: data.started_at ? Date.parse(data.started_at) : Date.now() })
    } catch (err: any) {
      releaseCapture()
      const denied = err?.name === 'NotAllowedError'
      set({
        status: 'idle',
        error: err?.response?.data?.detail || (denied ? tl("Permesso negato: consenti l'accesso al microfono (o alla condivisione audio) al browser") : err?.message) || tl("Impossibile avviare la registrazione"),
      })
    }
  },

  stop: async () => {
    const { status, recordingId } = get()
    if (status !== 'recording' || !recordingId || !recorder) return
    set({ status: 'stopping' })
    try {
      await recorder.stop()
      const { data } = await voiceCallsApi.stopRecording(recordingId)
      set({ lastClosed: data })
    } catch (err: any) {
      set({ error: err?.response?.data?.detail || tl("Impossibile chiudere la registrazione") })
    } finally {
      releaseCapture()
      set({ status: 'idle', recordingId: null, startedAt: null })
    }
  },
}))
