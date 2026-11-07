import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SandpackProvider,
  SandpackPreview,
  SandpackLayout,
  SandpackConsole,
  useSandpack,
  type SandpackFiles,
} from '@codesandbox/sandpack-react'

export type GeneratedFile = {
  path: string
  content: string
  language?: string
}

export type SandpackRuntimeError = {
  message: string
  path?: string
  line?: number
  column?: number
  /** `infra` = the Sandpack bundler itself could not start (network/CDN/timeout): never a bug in the generated code. */
  kind: 'compile' | 'runtime' | 'console' | 'infra'
}

import { buildMlStub, ML_RUNTIME_VERSION, type MlRuntimeModel } from '@/lib/mlRuntimeStub'
import { tl } from '@/i18n/tl'

type Props = {
  /** React/Vite projects: a file tree bundled by Sandpack's react-ts template. Ignored when
   * `staticHtml` is set. */
  files?: GeneratedFile[]
  /** Plain HTML/CSS/JS projects (e.g. p5.js sketches): one self-contained HTML document — the
   * exact string the legacy srcDoc preview used to render directly. Sandpack's `static` template
   * serves it as-is (no bundler) from Sandpack's own isolated bundler origin, which is what lets
   * getUserMedia/camera actually work: a `sandbox`ed `srcDoc` iframe has an opaque origin and
   * browsers refuse camera/mic there no matter what `allow` says, but Sandpack's preview iframe
   * is a real cross-origin document, so `allow="camera; microphone; ..."` (already set by
   * sandpack-client on every Sandpack preview, any template) actually takes effect. */
  staticHtml?: string
  /** ML Lab models attached to the project: exposed to the app as window.GolinelliML. */
  mlModels?: MlRuntimeModel[]
  /** Called whenever the running project emits compile/runtime errors (drives the agentic fix loop). */
  onErrors?: (errors: SandpackRuntimeError[]) => void
  /** Called once the project mounts and renders without errors. */
  onReady?: () => void
  showConsole?: boolean
  /** Inspector "ask the AI about this section" overlay (mirrors the legacy preview). */
  enableInspector?: boolean
  /** Keep page-style previews vertically scrollable on touch devices. */
  forceVerticalScroll?: boolean
  className?: string
}

// Platform-owned files: the model never controls these. They wire the real React entry point and
// reinject the window.GolinelliAI bridge so generated apps can still call the platform AI runtime.
// Keeping html + entry + bridge out of the model's hands also blocks external-CDN injection.
const ENTRY_PATH = '/index.tsx'
const HTML_PATH = '/public/index.html'
const BRIDGE_PATH = '/golinelli-bridge.ts'
const EMPTY_MODELS: MlRuntimeModel[] = []

// The platform bridge, plus (when ML Lab models are attached) the window.GolinelliML stub.
function buildBridgeSource(enableInspector: boolean, mlModels: MlRuntimeModel[] = []): string {
  const base = buildBaseBridgeSource(enableInspector, window.location.origin)
  return mlModels.length ? `${base}\n${buildMlStub(mlModels, window.location.origin)}\n` : base
}

const buildHtmlDocument = (forceVerticalScroll: boolean) => `<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${forceVerticalScroll ? '<style>html,body,#root{min-height:100%}html,body{overflow-x:hidden!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch;touch-action:pan-y}</style>' : ''}
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`

// The bridge runs inside the Sandpack preview iframe. It speaks the same postMessage protocol the
// legacy srcDoc preview used (golinelli-coding-preview -> golinelli-coding-host), so the existing
// parent handler in StudentCodingLabModule picks it up unchanged.
function buildBaseBridgeSource(enableInspector: boolean, platformOrigin: string): string {
  return `// AUTO-GENERATED platform bridge. Do not edit.
const PLATFORM_ORIGIN: string = ${JSON.stringify(platformOrigin)}
const ML_RUNTIME_VERSION: string = ${JSON.stringify(ML_RUNTIME_VERSION)}
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void; onDelta?: (text: string) => void }>()
window.addEventListener('message', (event: MessageEvent) => {
  const data: any = event.data || {}
  if (data.source !== 'golinelli-coding-host') return
  // Host-initiated request: screenshot of the running app for the visual review.
  if (data.action === 'capture') {
    const root = document.documentElement
    const answer = (payload: any) => window.parent.postMessage({ source: 'golinelli-coding-preview', id: data.id, action: 'captureResult', payload }, '*')
    import('html2canvas')
      .then(({ default: html2canvas }) => html2canvas(document.body, {
        backgroundColor: null,
        useCORS: true,
        logging: false,
        scale: Math.min(1, 1280 / Math.max(1, root.clientWidth)),
        height: Math.min(root.scrollHeight, 2200),
        windowHeight: Math.min(root.scrollHeight, 2200),
      }))
      .then((canvas: HTMLCanvasElement) => answer({ ok: true, image: canvas.toDataURL('image/jpeg', 0.72) }))
      .catch((error: any) => answer({ ok: false, error: (error && error.message) || 'Screenshot non riuscito.' }))
    return
  }
  if (!pending.has(data.id)) return
  const entry = pending.get(data.id)!
  // Streaming calls receive partial frames before the final reply.
  if (data.partial) { if (entry.onDelta && typeof data.delta === 'string') entry.onDelta(data.delta); return }
  pending.delete(data.id)
  data.ok ? entry.resolve(data.result) : entry.reject(new Error(data.error || 'Chiamata AI non riuscita.'))
})
function callHost(action: string, payload: any, timeoutMs = 60000, onDelta?: (text: string) => void): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = 'coding_' + Date.now() + '_' + Math.random().toString(36).slice(2)
    pending.set(id, { resolve, reject, onDelta })
    window.parent.postMessage({ source: 'golinelli-coding-preview', id, action, payload }, '*')
    setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      reject(new Error('La chiamata AI ha impiegato troppo tempo.'))
    }, timeoutMs)
  })
}
// --- Camera / microphone ------------------------------------------------------------------------
// Every getUserMedia call (ours or the app's own) goes through requestMedia: relaxed-constraint retry,
// Italian messages that tell the user what to do, and the permission state posted to the host page,
// which shows browser-specific guidance OUTSIDE the iframe (where the real permission prompt lives).
const MEDIA_MESSAGES: Record<string, string> = {
  NotAllowedError: 'Permesso negato. Consenti fotocamera/microfono dall’icona accanto all’indirizzo del browser, poi premi di nuovo il pulsante.',
  SecurityError: 'Il browser blocca fotocamera e microfono in questa pagina.',
  NotFoundError: 'Nessuna fotocamera o microfono trovati su questo dispositivo.',
  NotReadableError: 'Il dispositivo è già usato da un’altra app o scheda: chiudila e riprova.',
  OverconstrainedError: 'Il dispositivo non supporta le impostazioni richieste.',
  AbortError: 'L’accesso al dispositivo è stato interrotto: riprova.',
}
const nativeGetUserMedia = navigator.mediaDevices && navigator.mediaDevices.getUserMedia
  ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  : null
function mediaKind(constraints: any): string {
  if (constraints && constraints.video && constraints.audio) return 'camera+microphone'
  return constraints && constraints.video ? 'camera' : 'microphone'
}
function notifyMedia(kind: string, state: string, errorName = '') {
  window.parent.postMessage({ source: 'golinelli-coding-preview', id: 'media_' + Date.now(), action: 'mediaStatus', payload: { kind, state, error: errorName } }, '*')
}
function mediaError(name: string, message: string) {
  const error: any = new Error(message)
  error.name = name
  error.isMediaPermission = true
  return error
}
// The platform vision runtime (MediaPipe + models) is a script served by the platform origin; loaded on first use.
// Served with a long cache lifetime, so the URL carries a version and a runtime that predates the tracker API
// (an older cached copy) is transparently re-fetched with a cache-busting query.
let visionRuntime: Promise<any> | null = null
function injectVisionRuntime(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.onload = () => {
      const runtime = (window as any).GolinelliMLRuntime
      if (!runtime) { reject(new Error('Motore di visione non disponibile.')); return }
      resolve(runtime)
    }
    script.onerror = () => reject(new Error('Impossibile caricare il motore di visione della piattaforma: controlla la connessione e riprova.'))
    document.head.appendChild(script)
  })
}
function loadVisionRuntime(): Promise<any> {
  const existing = (window as any).GolinelliMLRuntime
  if (existing && existing.tracker) { existing.setAssetBase(PLATFORM_ORIGIN); return Promise.resolve(existing) }
  if (!visionRuntime) {
    const base = PLATFORM_ORIGIN + '/lib/goliai-ml.js'
    visionRuntime = injectVisionRuntime(base + '?v=' + ML_RUNTIME_VERSION)
      .then((runtime: any) => {
        if (runtime.tracker) return runtime
        delete (window as any).GolinelliMLRuntime
        return injectVisionRuntime(base + '?v=' + ML_RUNTIME_VERSION + '&t=' + Date.now())
      })
      .then((runtime: any) => {
        if (!runtime.tracker) throw new Error('Motore di visione non aggiornato: ricarica la pagina.')
        runtime.setAssetBase(PLATFORM_ORIGIN)
        return runtime
      })
      .catch((error: any) => { visionRuntime = null; throw error })
  }
  return visionRuntime
}
// Live streams handed to the app. Generated apps often get the stream before their <video> exists (it is
// mounted later, on a "camera active" state) or keep it in state without ever attaching it: the picture stays
// black. The platform therefore attaches the live camera stream to any <video> that has no source by itself,
// as soon as one appears, and keeps it playing.
let liveStreams: MediaStream[] = []
function pruneStreams() {
  liveStreams = liveStreams.filter((stream) => stream.getVideoTracks().some((track) => track.readyState === 'live'))
}
function videoWantsStream(video: HTMLVideoElement): boolean {
  if (video.srcObject || video.getAttribute('src') || video.currentSrc) return false
  if (video.querySelector('source')) return false
  return video.autoplay || video.hasAttribute('autoplay') || video.playsInline || video.hasAttribute('playsinline') || video.muted
}
function pumpVideos() {
  pruneStreams()
  const stream = liveStreams.length ? liveStreams[liveStreams.length - 1] : null
  if (!stream) return
  document.querySelectorAll('video').forEach((video) => {
    if (videoWantsStream(video)) {
      try {
        video.muted = true
        video.playsInline = true
        video.setAttribute('playsinline', '')
        video.srcObject = stream
      } catch (e) { /* ignore */ }
    }
    if (video.srcObject && liveStreams.indexOf(video.srcObject as MediaStream) >= 0 && video.paused) {
      video.muted = true
      const started = video.play()
      if (started && started.catch) started.catch(() => undefined)
    }
  })
}
function trackStream(stream: MediaStream) {
  if (!stream || !stream.getVideoTracks || !stream.getVideoTracks().length) return
  if (liveStreams.indexOf(stream) < 0) liveStreams.push(stream)
  pumpVideos()
}
if (typeof MutationObserver !== 'undefined') {
  let scheduled = false
  new MutationObserver(() => {
    if (scheduled || !liveStreams.length) return
    scheduled = true
    requestAnimationFrame(() => { scheduled = false; pumpVideos() })
  }).observe(document.documentElement, { childList: true, subtree: true })
}
window.setInterval(() => { if (liveStreams.length) pumpVideos() }, 700)
async function requestMedia(constraints: any): Promise<MediaStream> {
  const kind = mediaKind(constraints)
  if (!nativeGetUserMedia) {
    notifyMedia(kind, 'unsupported')
    throw mediaError('NotSupportedError', 'Questo browser non permette l’accesso a fotocamera e microfono: usa Chrome, Edge, Firefox o Safari aggiornati.')
  }
  notifyMedia(kind, 'prompt')
  try {
    const stream = await nativeGetUserMedia(constraints)
    notifyMedia(kind, 'granted')
    trackStream(stream)
    return stream
  } catch (first: any) {
    let error: any = first
    if (error && ['OverconstrainedError', 'NotReadableError', 'AbortError', 'TypeError'].indexOf(error.name) >= 0) {
      try {
        const stream = await nativeGetUserMedia({ video: !!constraints.video, audio: !!constraints.audio })
        notifyMedia(kind, 'granted')
        trackStream(stream)
        return stream
      } catch (retry: any) { error = retry }
    }
    const name = (error && error.name) || 'Error'
    notifyMedia(kind, name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error', name)
    throw mediaError(name, MEDIA_MESSAGES[name] || (error && error.message) || 'Accesso al dispositivo non riuscito.')
  }
}
if (nativeGetUserMedia) {
  try { (navigator.mediaDevices as any).getUserMedia = (constraints: any) => requestMedia(constraints || { video: true }) } catch (e) { /* read-only in some browsers */ }
}
;(window as any).GolinelliAI = {
  // Ready-made vision (face + facial features, hands, body pose), self-hosted by the platform and run locally.
  ml: {
    tracker: (kind: string, options: any = {}) => loadVisionRuntime().then((runtime: any) => runtime.tracker(kind, options)),
    face: (options: any = {}) => loadVisionRuntime().then((runtime: any) => runtime.tracker('face', options)),
    hand: (options: any = {}) => loadVisionRuntime().then((runtime: any) => runtime.tracker('hand', options)),
    pose: (options: any = {}) => loadVisionRuntime().then((runtime: any) => runtime.tracker('pose', options)),
  },
  media: {
    camera: (options: any = {}) => requestMedia({
      video: { facingMode: options.facingMode || 'user', width: { ideal: options.width || 1280 }, height: { ideal: options.height || 720 } },
      audio: false,
    }),
    microphone: () => requestMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }),
    cameraAndMicrophone: (options: any = {}) => requestMedia({ video: { facingMode: options.facingMode || 'user' }, audio: true }),
    attach: (video: HTMLVideoElement | null, stream: MediaStream) => {
      // The element may not be mounted yet: the stream is tracked, so it is attached the moment a <video> appears.
      if (!video) { if (stream) trackStream(stream); return Promise.resolve(undefined) }
      video.playsInline = true
      video.muted = true
      video.autoplay = true
      video.srcObject = stream
      return video.play().catch(() => undefined)
    },
    stop: (stream?: MediaStream | null) => { if (stream) stream.getTracks().forEach((track) => track.stop()) },
  },
  chat: ({ content, history = [], profileKey = 'tutor', provider, model }: any = {}) =>
    callHost('chat', { content, history, profileKey, provider, model }),
  generateImage: (args: any = {}) => {
    const payload = typeof args === 'string'
      ? { prompt: args, provider: 'gpt-image-2-2026-04-21' }
      : { prompt: args.prompt, provider: args.provider || 'gpt-image-2-2026-04-21' }
    const notify = (status: string, message: string, result?: any) => {
      if (typeof args === 'object' && typeof args.onStatus === 'function') args.onStatus({ status, message, result })
      window.dispatchEvent(new CustomEvent('golinelli:image-status', { detail: { status, message, result } }))
    }
    notify('generating', 'Genero l’immagine…')
    return callHost('generateImage', payload, 180000)
      .then((result) => {
        notify('ready', 'Immagine pronta.', result)
        return result
      })
      .catch((error) => {
        notify('error', error?.message || 'Generazione immagine non riuscita.')
        throw error
      })
  },
  saveData: ({ key, value }: any = {}) => callHost('saveData', { key, value }),
  loadData: ({ key }: any = {}) => callHost('loadData', { key }),
  deleteData: ({ key }: any = {}) => callHost('deleteData', { key }),
  // Streaming chat: onToken receives the growing text; resolves with the full response.
  chatStream: ({ content, history = [], system, onToken }: any = {}) => {
    let text = ''
    return callHost('chatStream', { content, history, system }, 120000, (delta: string) => {
      text += delta
      if (typeof onToken === 'function') onToken(text, delta)
    })
  },
  // Structured output: returns an already-parsed object shaped like the schema/example given.
  json: ({ prompt, schema, history = [] }: any = {}) => callHost('json', { prompt, schema, history }, 90000),
  // Image understanding: image = data URL (file input / canvas) or https URL.
  vision: ({ image, prompt }: any = {}) => callHost('vision', { image, prompt }, 90000),
  me: () => callHost('me', {}),
  // State shared by EVERYONE using this app in the session (polls, boards, multiplayer games).
  // append() adds to a list server-side, so simultaneous users never overwrite each other.
  shared: {
    get: (key: string) => callHost('sharedGet', { key }).then((result: any) => result ? result.value : null),
    set: (key: string, value: any) => callHost('sharedSet', { key, value }).then((result: any) => result ? result.value : value),
    append: (key: string, item: any) => callHost('sharedAppend', { key, value: item }).then((result: any) => result ? result.value : []),
    subscribe: (key: string, callback: (value: any) => void, options: any = {}) => {
      let lastStamp: string | null = null
      let stopped = false
      const tick = () => {
        if (stopped) return
        callHost('sharedGet', { key })
          .then((result: any) => {
            const stamp = result && result.updated_at ? String(result.updated_at) : ''
            if (stamp !== lastStamp) { lastStamp = stamp; callback(result ? result.value : null) }
          })
          .catch(() => {})
          .finally(() => { if (!stopped) setTimeout(tick, Math.max(1000, options.intervalMs || 2000)) })
      }
      tick()
      return () => { stopped = true }
    },
  },
  // Speech runs locally in the browser (Web Speech API): no server round trip, no credits.
  speak: (text: string, options: any = {}) => new Promise<void>((resolve, reject) => {
    const synth = (window as any).speechSynthesis
    if (!synth) { reject(new Error('Sintesi vocale non supportata da questo browser.')); return }
    const utterance = new SpeechSynthesisUtterance(String(text || ''))
    utterance.lang = options.lang || 'it-IT'
    utterance.rate = options.rate || 1
    utterance.pitch = options.pitch || 1
    utterance.onend = () => resolve()
    utterance.onerror = (event: any) => reject(new Error(event.error || 'Lettura non riuscita.'))
    synth.cancel()
    synth.speak(utterance)
  }),
  stopSpeaking: () => { const synth = (window as any).speechSynthesis; if (synth) synth.cancel() },
  listen: (options: any = {}) => new Promise<string>((resolve, reject) => {
    const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!Recognition) { reject(new Error('Riconoscimento vocale non supportato da questo browser (usa Chrome o Edge).')); return }
    const recognition = new Recognition()
    recognition.lang = options.lang || 'it-IT'
    recognition.interimResults = typeof options.onPartial === 'function'
    recognition.maxAlternatives = 1
    let finalText = ''
    recognition.onresult = (event: any) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript
        if (event.results[i].isFinal) finalText += chunk
        else interim += chunk
      }
      if (typeof options.onPartial === 'function') options.onPartial(finalText + interim)
    }
    recognition.onerror = (event: any) => reject(new Error(event.error === 'not-allowed' ? 'Permesso microfono negato.' : (event.error || 'Ascolto non riuscito.')))
    recognition.onend = () => resolve(finalText.trim())
    recognition.start()
  }),
}
// Uncaught errors and rejected promises are what break an app AFTER it compiles: report them to the
// host so the observe->fix loop can see them (fire-and-forget, deduplicated, capped).
const reportedErrors = new Set<string>()
function reportRuntimeError(message: string) {
  const text = String(message || '').trim()
  if (!text || reportedErrors.has(text) || reportedErrors.size > 20) return
  reportedErrors.add(text)
  window.parent.postMessage({ source: 'golinelli-coding-preview', id: 'err_' + Date.now() + '_' + reportedErrors.size, action: 'reportError', payload: { message: text } }, '*')
}
// The platform ErrorBoundary / blank-page detector (index.tsx) report through this hook.
;(window as any).__golinelliReport = reportRuntimeError
window.addEventListener('error', (event: ErrorEvent) => {
  const where = event.filename ? ' (' + event.filename.split('/').pop() + ':' + event.lineno + ')' : ''
  reportRuntimeError((event.message || 'Errore JavaScript') + where)
})
window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
  const reason: any = event.reason
  if (reason && (reason.isMediaPermission || reason.name === 'NotAllowedError' || reason.name === 'SecurityError')) return
  reportRuntimeError('Promise non gestita: ' + (reason && reason.message ? reason.message : String(reason)))
})
export const ENABLE_INSPECTOR = ${enableInspector ? 'true' : 'false'}
export {}
`
}

// Platform-owned bootstrap. Two guarantees the model cannot break:
// 1) a render exception shows a readable panel (and is reported to the fix loop) instead of a white page;
// 2) a page that mounts but paints nothing is reported as "blank" after a short grace period.
const PLATFORM_ENTRY = `import './golinelli-bridge'
import './styles.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

const report = (message: string) => { try { (window as any).__golinelliReport?.(message) } catch (e) { /* ignore */ } }

class PlatformErrorBoundary extends React.Component<{ children?: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    const where = (info && info.componentStack ? info.componentStack : '').split('\\n').slice(0, 4).join(' ').trim()
    report('Errore durante il rendering: ' + (error && error.message ? error.message : String(error)) + (where ? ' | ' + where : ''))
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: '#7f1d1d', background: '#fef2f2', minHeight: '100vh', boxSizing: 'border-box' }}>
        <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>L'app si è fermata per un errore</h2>
        <p style={{ margin: '0 0 12px', fontSize: 14 }}>Sto cercando di correggerla in automatico.</p>
        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#fee2e2', padding: 12, borderRadius: 8, margin: 0 }}>{String(this.state.error && this.state.error.message || this.state.error)}</pre>
      </div>
    )
  }
}

const rootEl = document.getElementById('root')!
createRoot(rootEl).render(<React.StrictMode><PlatformErrorBoundary><App /></PlatformErrorBoundary></React.StrictMode>)

function looksBlank(): boolean {
  if (rootEl.querySelector('canvas,svg,img,video,iframe,input,textarea,select,button')) return false
  return !(rootEl.innerText || '').trim()
}
let blankReported = false
const checkBlank = () => {
  if (blankReported || !looksBlank()) return
  blankReported = true
  report("Pagina bianca: l'app si monta ma non mostra nessun contenuto visibile (App restituisce null/vuoto, un caricamento che non finisce, oppure dati mancanti al primo render). Il primo render deve mostrare subito contenuto con dati di esempio.")
}
window.setTimeout(checkBlank, 3500)
window.setTimeout(checkBlank, 9000)
`

// Sandpack's default bundler timeout is 40s; a cold start with a heavy dependency (three, tensorflow,
// phaser...) needs longer. Mirrors HEAVY_PACKAGES in backend/app/services/vibe_contract.py.
const HEAVY_PACKAGES = new Set([
  'three', '@react-three/fiber', '@react-three/drei', 'phaser', 'pixi.js', 'p5', 'tone', 'ml5', 'onnxruntime-web',
  '@xenova/transformers', '@mediapipe/tasks-vision', '@vladmandic/face-api', 'mathjs', 'd3', 'leaflet', 'react-leaflet',
])
const isHeavyDependency = (name: string) => HEAVY_PACKAGES.has(name) || name.startsWith('@tensorflow')
const INFRA_ERROR = /couldn.?t connect to server|sandpack cannot connect|TIME_OUT|bundler.*time|failed to fetch dynamically imported|network ?error/i
const MAX_INFRA_RETRIES = 2

function normalizePath(path: string): string {
  const trimmed = path.trim().replace(/^\.\//, '')
  return trimmed.startsWith('/') ? trimmed : '/' + trimmed
}

const BARE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'".\/][^'"]*)['"]/g
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
const NOT_PACKAGES = new Set(['react', 'react-dom', 'fs', 'path', 'os', 'crypto', 'child_process', 'http', 'https', 'net', 'stream', 'zlib', 'util', 'url', 'events', 'buffer', 'process'])

// Declared dependencies (package.json) plus every npm package the code imports but package.json forgot:
// a missing library must never break the preview, so undeclared imports are installed automatically.
function parseDependencies(files: GeneratedFile[]): Record<string, string> {
  let declared: Record<string, string> = {}
  const pkg = files.find((f) => normalizePath(f.path) === '/package.json')
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg.content)
      declared = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) }
    } catch {
      declared = {}
    }
  }
  const inferred: Record<string, string> = {}
  for (const file of files) {
    if (!/\.(tsx?|jsx?)$/i.test(file.path)) continue
    for (const match of file.content.matchAll(BARE_IMPORT)) {
      const parts = match[1].split('/')
      const name = match[1].startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
      if (!NPM_NAME.test(name) || NOT_PACKAGES.has(name) || name.startsWith('node:') || name in declared) continue
      inferred[name] = 'latest'
    }
  }
  return { ...inferred, ...declared }
}

// Listens to the running bundler and forwards real compile/runtime errors to the parent so the
// agentic loop can read them and ask the model to fix the project.
function ErrorReporter({
  onErrors,
  onReady,
  onInfra,
}: {
  onErrors?: (errors: SandpackRuntimeError[]) => void
  onReady?: () => void
  onInfra?: (message: string) => void
}) {
  const { listen } = useSandpack()
  const reportedReady = useRef(false)

  useEffect(() => {
    const unsubscribe = listen((message: any) => {
      if (message.type === 'action' && message.action === 'show-error') {
        reportedReady.current = false
        const text = String(message.message || message.title || '')
        // "Couldn't connect to server / TIME_OUT" is the bundler failing to boot (network, CDN, heavy
        // dependencies), not a bug in the generated code: retry the runtime, never ask the model to "fix" it.
        if (INFRA_ERROR.test(`${message.title || ''} ${text}`)) {
          onInfra?.(text || String(message.title || ''))
          return
        }
        onErrors?.([
          {
            message: text || tl("Errore di compilazione."),
            path: message.path,
            line: message.line,
            column: message.column,
            kind: 'compile',
          },
        ])
        return
      }
      if (message.type === 'console' && Array.isArray(message.log)) {
        const errs = message.log
          .filter((entry: any) => entry.method === 'error')
          .map((entry: any) => ({
            message: Array.isArray(entry.data) ? entry.data.map(String).join(' ') : String(entry.data ?? ''),
            kind: 'console' as const,
          }))
          .filter((e: SandpackRuntimeError) => e.message && !/^%c/.test(e.message))
        if (errs.length) onErrors?.(errs)
        return
      }
      if (message.type === 'done' && !message.compilatonError) {
        if (!reportedReady.current) {
          reportedReady.current = true
          onReady?.()
        }
      }
    })
    return unsubscribe
  }, [listen, onErrors, onReady, onInfra])

  return null
}

export default function CodingSandpackPreview({
  files = [],
  staticHtml,
  mlModels = EMPTY_MODELS,
  onErrors,
  onReady,
  showConsole = false,
  enableInspector = true,
  forceVerticalScroll = false,
  className,
}: Props) {
  const dependencies = useMemo(() => parseDependencies(files), [files])
  const heavy = useMemo(() => Object.keys(dependencies).some(isHeavyDependency), [dependencies])
  const bundlerTimeOut = heavy ? 150_000 : 75_000
  // Bundler boot failures are retried by remounting the Sandpack provider (fresh iframe + fresh connection).
  const attempts = useRef(0)
  const [mountKey, setMountKey] = useState(0)
  const [infraFailure, setInfraFailure] = useState<string | null>(null)
  const retryTimer = useRef<number | null>(null)
  useEffect(() => () => { if (retryTimer.current) window.clearTimeout(retryTimer.current) }, [])
  const handleInfra = useCallback((message: string) => {
    if (attempts.current < MAX_INFRA_RETRIES) {
      attempts.current += 1
      if (retryTimer.current) window.clearTimeout(retryTimer.current)
      retryTimer.current = window.setTimeout(() => setMountKey((k) => k + 1), 1500)
    } else {
      setInfraFailure(message || 'TIME_OUT')
    }
  }, [])
  const handleReady = useCallback(() => {
    attempts.current = 0
    setInfraFailure(null)
    onReady?.()
  }, [onReady])
  const retryNow = () => {
    attempts.current = 0
    setInfraFailure(null)
    setMountKey((k) => k + 1)
  }

  const staticFiles = useMemo<SandpackFiles>(() => ({
    '/index.html': { code: forceVerticalScroll
      ? (staticHtml || '<!doctype html><html><head></head><body></body></html>').replace(/<\/head>/i, '<style>html,body{min-height:100%;overflow-x:hidden!important;overflow-y:auto!important;-webkit-overflow-scrolling:touch;touch-action:pan-y}</style></head>')
      : (staticHtml || '<!doctype html><html><head></head><body></body></html>') },
    '/package.json': { code: JSON.stringify({ dependencies: {}, main: '/index.html' }) },
  }), [forceVerticalScroll, staticHtml])

  const sandpackFiles = useMemo<SandpackFiles>(() => {
    const map: SandpackFiles = {}
    for (const file of files) {
      const path = normalizePath(file.path)
      // package.json deps are surfaced via customSetup; the file itself isn't needed by the bundler.
      if (path === '/package.json') continue
      map[path] = { code: file.content }
    }
    // Platform-owned wiring — always overrides whatever the model produced for these paths.
    map[BRIDGE_PATH] = { code: buildBridgeSource(enableInspector, mlModels), hidden: true }
    map[HTML_PATH] = { code: buildHtmlDocument(forceVerticalScroll), hidden: true }
    // styles.css is always present so the entry can import it unconditionally.
    if (!map['/styles.css']) map['/styles.css'] = { code: '', hidden: true }
    map[ENTRY_PATH] = { code: PLATFORM_ENTRY, hidden: true }
    return map
  }, [files, enableInspector, forceVerticalScroll, mlModels])

  return (
    <div className={`golinelli-sp ${className || ''}`}>
      {/* Sandpack ships a fixed default layout height; force the whole chain to fill our container. */}
      <style>{SANDPACK_FILL_CSS}</style>
      {infraFailure && (
        <div role="alert" style={{ position: 'absolute', inset: 0, zIndex: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'rgba(15,23,42,0.88)' }}>
          <div style={{ maxWidth: 420, textAlign: 'center', color: '#f8fafc', fontFamily: 'system-ui, sans-serif' }}>
            <p style={{ margin: '0 0 8px', fontWeight: 800, fontSize: 16 }}>{tl("L'anteprima non riesce ad avviarsi")}</p>
            <p style={{ margin: '0 0 14px', fontSize: 13, lineHeight: 1.5, color: '#cbd5e1' }}>
              {heavy
                ? tl("Il progetto usa librerie pesanti che il motore dell'anteprima scarica da internet: con una connessione lenta può non bastare il tempo. Non è un errore del tuo codice.")
                : tl("Il motore dell'anteprima non riesce a collegarsi alla rete. Non è un errore del tuo codice: controlla la connessione e riprova.")}
            </p>
            <button type="button" onClick={retryNow} style={{ border: 0, borderRadius: 999, padding: '10px 20px', fontWeight: 800, cursor: 'pointer', background: '#e85c8d', color: '#fff' }}>{tl("Riprova ad avviare")}</button>
          </div>
        </div>
      )}
      {staticHtml !== undefined ? (
        <SandpackProvider
          key={`static-${mountKey}`}
          template="static"
          files={staticFiles}
          options={{ recompileMode: 'delayed', recompileDelay: 400, bundlerTimeOut }}
        >
          <ErrorReporter onErrors={onErrors} onReady={handleReady} onInfra={handleInfra} />
          <SandpackLayout>
            <SandpackPreview showOpenInCodeSandbox={false} showRefreshButton />
            {showConsole && <SandpackConsole />}
          </SandpackLayout>
        </SandpackProvider>
      ) : (
        <SandpackProvider
          key={`react-${mountKey}`}
          template="react-ts"
          files={sandpackFiles}
          customSetup={{
            entry: ENTRY_PATH,
            dependencies: {
              react: '^18.2.0',
              'react-dom': '^18.2.0',
              // Used only by the bridge for the visual review screenshot.
              html2canvas: '^1.4.1',
              ...dependencies,
            },
          }}
          options={{ recompileMode: 'delayed', recompileDelay: 400, bundlerTimeOut }}
        >
          <ErrorReporter onErrors={onErrors} onReady={handleReady} onInfra={handleInfra} />
          <SandpackLayout>
            <SandpackPreview showOpenInCodeSandbox={false} showRefreshButton />
            {showConsole && <SandpackConsole />}
          </SandpackLayout>
        </SandpackProvider>
      )}
    </div>
  )
}

// Sandpack defaults the layout to ~300px (--sp-layout-height). These rules make the wrapper, layout,
// stack and preview iframe fill the parent so the preview is actually usable full-height.
const SANDPACK_FILL_CSS = `
.golinelli-sp { position: relative; display: flex; flex-direction: column; min-height: 0; }
.golinelli-sp .sp-wrapper { flex: 1; min-height: 0; display: flex; }
.golinelli-sp .sp-layout { flex: 1; min-height: 0; height: 100%; border: none; border-radius: 0; flex-direction: column; }
.golinelli-sp .sp-stack { min-height: 0; height: 100%; flex: 1; }
.golinelli-sp .sp-preview-container { flex: 1; min-height: 0; height: 100%; }
.golinelli-sp .sp-preview-iframe { flex: 1; min-height: 0; height: 100%; touch-action: pan-y; }
.golinelli-sp .sp-console { flex: 0 0 180px; min-height: 0; }
`.trim()
