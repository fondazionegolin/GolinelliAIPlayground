import { useEffect, useMemo, useRef } from 'react'
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
  kind: 'compile' | 'runtime' | 'console'
}

import { buildMlStub, type MlRuntimeModel } from '@/lib/mlRuntimeStub'

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
  const base = buildBaseBridgeSource(enableInspector)
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
function buildBaseBridgeSource(enableInspector: boolean): string {
  return `// AUTO-GENERATED platform bridge. Do not edit.
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
    return stream
  } catch (first: any) {
    let error: any = first
    if (error && ['OverconstrainedError', 'NotReadableError', 'AbortError', 'TypeError'].indexOf(error.name) >= 0) {
      try {
        const stream = await nativeGetUserMedia({ video: !!constraints.video, audio: !!constraints.audio })
        notifyMedia(kind, 'granted')
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
  media: {
    camera: (options: any = {}) => requestMedia({
      video: { facingMode: options.facingMode || 'user', width: { ideal: options.width || 1280 }, height: { ideal: options.height || 720 } },
      audio: false,
    }),
    microphone: () => requestMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false }),
    cameraAndMicrophone: (options: any = {}) => requestMedia({ video: { facingMode: options.facingMode || 'user' }, audio: true }),
    attach: (video: HTMLVideoElement, stream: MediaStream) => {
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

function normalizePath(path: string): string {
  const trimmed = path.trim().replace(/^\.\//, '')
  return trimmed.startsWith('/') ? trimmed : '/' + trimmed
}

function parseDependencies(files: GeneratedFile[]): Record<string, string> {
  const pkg = files.find((f) => normalizePath(f.path) === '/package.json')
  if (!pkg) return {}
  try {
    const parsed = JSON.parse(pkg.content)
    return { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) }
  } catch {
    return {}
  }
}

// Listens to the running bundler and forwards real compile/runtime errors to the parent so the
// agentic loop can read them and ask the model to fix the project.
function ErrorReporter({
  onErrors,
  onReady,
}: {
  onErrors?: (errors: SandpackRuntimeError[]) => void
  onReady?: () => void
}) {
  const { listen } = useSandpack()
  const reportedReady = useRef(false)

  useEffect(() => {
    const unsubscribe = listen((message: any) => {
      if (message.type === 'action' && message.action === 'show-error') {
        reportedReady.current = false
        onErrors?.([
          {
            message: message.message || message.title || 'Errore di compilazione.',
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
  }, [listen, onErrors, onReady])

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
    map[ENTRY_PATH] = {
      code: `import './golinelli-bridge'
import './styles.css'
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
const root = createRoot(document.getElementById('root')!)
root.render(<React.StrictMode><App /></React.StrictMode>)
`,
      hidden: true,
    }
    return map
  }, [files, enableInspector, forceVerticalScroll, mlModels])

  return (
    <div className={`golinelli-sp ${className || ''}`}>
      {/* Sandpack ships a fixed default layout height; force the whole chain to fill our container. */}
      <style>{SANDPACK_FILL_CSS}</style>
      {staticHtml !== undefined ? (
        <SandpackProvider
          template="static"
          files={staticFiles}
          options={{ recompileMode: 'delayed', recompileDelay: 400 }}
        >
          <ErrorReporter onErrors={onErrors} onReady={onReady} />
          <SandpackLayout>
            <SandpackPreview showOpenInCodeSandbox={false} showRefreshButton />
            {showConsole && <SandpackConsole />}
          </SandpackLayout>
        </SandpackProvider>
      ) : (
        <SandpackProvider
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
          options={{ recompileMode: 'delayed', recompileDelay: 400 }}
        >
          <ErrorReporter onErrors={onErrors} onReady={onReady} />
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
.golinelli-sp { display: flex; flex-direction: column; min-height: 0; }
.golinelli-sp .sp-wrapper { flex: 1; min-height: 0; display: flex; }
.golinelli-sp .sp-layout { flex: 1; min-height: 0; height: 100%; border: none; border-radius: 0; flex-direction: column; }
.golinelli-sp .sp-stack { min-height: 0; height: 100%; flex: 1; }
.golinelli-sp .sp-preview-container { flex: 1; min-height: 0; height: 100%; }
.golinelli-sp .sp-preview-iframe { flex: 1; min-height: 0; height: 100%; touch-action: pan-y; }
.golinelli-sp .sp-console { flex: 0 0 180px; min-height: 0; }
`.trim()
