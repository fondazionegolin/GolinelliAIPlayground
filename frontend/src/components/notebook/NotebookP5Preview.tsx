import { AlertCircle } from '@/components/icons'
import { NOTEBOOK_LIBRARIES } from './notebookLibraries'
import { buildMlStub, type MlRuntimeModel } from '@/lib/mlRuntimeStub'

interface P5File {
  name: string
  source: string
}

interface Props {
  files: P5File[]
  livePreview: boolean
  previewNonce: number
  runtimeError: string | null
  onRuntimeMessage: (message: string | null) => void
  onIframeLoad?: (win: Window | null) => void
  activeLibraries?: string[]  // library IDs to inject
  /** ML Lab models attached to the sketch: exposed as window.GolinelliML. */
  mlModels?: MlRuntimeModel[]
  /** attached ML models are still being fetched: running now would hit «GolinelliML is not defined». */
  mlLoading?: boolean
  /** how many attached models could not be loaded (deleted, or not trained yet) */
  mlMissing?: number
}

const P5_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.3/p5.min.js'

function buildPreviewDoc(files: P5File[], activeLibraries: string[], mlModels: MlRuntimeModel[] = []) {
  // Defined before any sketch code runs; it lazy-loads the ML runtime from the platform (same origin as this app).
  const mlStub = mlModels.length ? `<script>${buildMlStub(mlModels, window.location.origin).replace(/<\/script/gi, '<\\/script')}</script>` : ''
  const isEmpty = files.every((f) => !f.source.trim())

  // Resolve CDN URLs for active libraries (in order, preserving multi-script libs)
  const libScriptTags = activeLibraries.flatMap((id) => {
    const lib = NOTEBOOK_LIBRARIES.find((l) => l.id === id)
    if (!lib) return []
    return lib.cdnUrls.map((url) => `    <script src="${url}" crossorigin="anonymous"></script>`)
  }).join('\n')

  // NOTE: no try/{ } wrapper around the sketch. A function declaration inside a block is hoisted to the global scope
  // only when it is a plain function: `async function setup()` stayed block-scoped, so p5 never found it.
  // Runtime errors (and syntax errors) are reported by the window.onerror / unhandledrejection handlers below.
  const scriptBlocks = files.map((f) => {
    const escaped = f.source.replace(/<\/script>/gi, '<\\/script>')
    return `
    <script>
      // ── ${f.name} ──
${escaped}
    </script>`
  }).join('\n')

  return `<!doctype html>
<html lang="it">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #ffffff;
        overflow: auto;
      }
      canvas {
        display: block;
      }
      .empty {
        padding: 1.5rem;
        color: #a3a3a3;
        font-family: system-ui, sans-serif;
        font-size: 0.875rem;
      }
    </style>
  </head>
  <body>
    <div id="app"></div>
    <div id="empty" class="empty" style="display:none">
      Inserisci uno sketch p5.js con setup() e draw() per vedere l'anteprima.
    </div>
    <script>
      const notifyParent = (type, payload) => {
        window.parent.postMessage({ source: 'p5-preview', type, payload }, '*')
      }
      window.onerror = function(message, source, lineno, colno, error) {
        var stack = error && error.stack ? '\\n' + error.stack : ''
        var text = String(message)
        // The browser hides the details of errors that come from scripts it cannot inspect.
        if (text === 'Script error.' && !error) text = 'Errore in una libreria esterna: il browser non ne espone i dettagli. Controlla di aver usato le funzioni nel modo giusto (es. variabili non ancora inizializzate in draw()).'
        var where = lineno ? ' (riga ' + lineno + ':' + colno + ')' : ''
        notifyParent('runtime-error', text + where + stack)
      }
      // Le Promise rifiutate senza .catch() (comuni con async/await in librerie come
      // MediaPipe/ml5) non passano da window.onerror: senza questo listener sparivano
      // in silenzio e la console non segnalava nulla allo studente.
      window.addEventListener('unhandledrejection', function(event) {
        var reason = event.reason
        var message = reason instanceof Error ? (reason.message + (reason.stack ? '\\n' + reason.stack : '')) : String(reason)
        notifyParent('runtime-error', 'Promise non gestita: ' + message)
      })
      // Camera diagnostics: the browser's own message ("Invalid security origin") says nothing about the cause.
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const nativeGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        navigator.mediaDevices.getUserMedia = function(constraints) {
          return nativeGum(constraints).catch(function(error) {
            var name = error && error.name ? error.name : 'Error'
            var hint = name === 'NotAllowedError' || name === 'SecurityError'
              ? 'Il browser ha negato la webcam: consenti la fotocamera per questo sito (icona del lucchetto nella barra degli indirizzi) e riprova. Se l\u2019anteprima è in un riquadro isolato, la webcam non è disponibile.'
              : name === 'NotFoundError' ? 'Nessuna webcam trovata.' : name === 'NotReadableError' ? 'La webcam è usata da un\u2019altra applicazione.' : ''
            notifyParent('runtime-error', 'Webcam non accessibile (' + name + ': ' + (error && error.message ? error.message : '') + '). ' + hint + ' [contesto sicuro: ' + window.isSecureContext + ', origine: ' + window.location.origin + ']')
            throw error
          })
        }
      }
      const _origError = console.error.bind(console)
      console.error = function(...args) {
        _origError(...args)
        notifyParent('runtime-error', args.map((a) => (a instanceof Error ? (a.message + (a.stack ? '\\n' + a.stack : '')) : (typeof a === 'object' ? JSON.stringify(a) : String(a)))).join(' '))
      }
      const _origLog = console.log.bind(console)
      console.log = function(...args) {
        _origLog(...args)
        notifyParent('console', { level: 'log', args: args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))) })
      }
      const _origWarn = console.warn.bind(console)
      console.warn = function(...args) {
        _origWarn(...args)
        notifyParent('console', { level: 'warn', args: args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))) })
      }
      ${isEmpty ? "document.getElementById('empty').style.display = 'block'" : ''}
      window.addEventListener('message', function(e) {
        if (!e.data || e.data.source !== 'p5-control') return
        if (e.data.action === 'stop' && typeof noLoop === 'function') noLoop()
        if (e.data.action === 'play' && typeof loop === 'function') loop()
      })
    </script>
    <script src="${P5_CDN}" crossorigin="anonymous"></script>
${libScriptTags}
    ${mlStub}
    ${isEmpty ? '' : scriptBlocks}
    <script>
      notifyParent('ready', null)
    </script>
  </body>
</html>`
}

export default function NotebookP5Preview({
  files,
  livePreview,
  previewNonce,
  runtimeError,
  onRuntimeMessage,
  onIframeLoad,
  activeLibraries = [],
  mlModels = [],
  mlLoading = false,
  mlMissing = 0,
}: Props) {
  // Libraries (and ML Lab models) that need the camera get a relaxed sandbox + the allow attribute
  const usesCameraInCode = files.some((file) => /createCapture|getUserMedia|GolinelliML|GolinelliAI\.media|mediaDevices/.test(file.source))
  const needsCamera = mlModels.length > 0 || usesCameraInCode || activeLibraries.some((id) => {
    const lib = NOTEBOOK_LIBRARIES.find((l) => l.id === id)
    return lib?.requiresCamera ?? false
  })

  const activeLibNames = activeLibraries
    .map((id) => NOTEBOOK_LIBRARIES.find((l) => l.id === id)?.name)
    .filter(Boolean)

  return (
    <div className="h-full min-h-[360px] overflow-hidden rounded-none border-0 bg-white">
      <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
        <div>
          <p className="text-sm font-semibold text-slate-700">Preview p5.js</p>
          <p className="text-[11px] text-slate-400">
            {livePreview ? 'Aggiornamento live attivo' : 'Aggiornamento manuale'}
            {activeLibNames.length > 0 && (
              <span className="ml-2 text-indigo-500">· {activeLibNames.join(', ')}</span>
            )}
            {mlModels.length > 0 && <span className="ml-2 text-violet-500">· {mlModels.map((model) => model.name).join(', ')}</span>}
          </p>
        </div>
      </div>
      <div className="relative h-[calc(100%-49px)]">
        {mlLoading ? (
          <div className="flex h-full w-full items-center justify-center bg-white text-sm text-slate-500">Carico i modelli ML…</div>
        ) : (
          <iframe
            key={`${previewNonce}:${mlModels.map((model) => model.id).join(',')}`}
            title="Anteprima p5.js"
            srcDoc={buildPreviewDoc(files, activeLibraries, mlModels)}
            sandbox={needsCamera ? 'allow-scripts allow-same-origin' : 'allow-scripts'}
            allow={needsCamera ? 'camera; microphone' : undefined}
            className="h-full w-full border-0 bg-white"
            onLoad={(e) => {
              onRuntimeMessage(null)
              onIframeLoad?.((e.target as HTMLIFrameElement).contentWindow)
            }}
          />
        )}
        {!mlLoading && mlMissing > 0 && (
          <div className="absolute inset-x-4 top-3 z-10 rounded-xl bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 shadow ring-1 ring-amber-200">
            {mlMissing === 1 ? 'Un modello collegato non è disponibile' : `${mlMissing} modelli collegati non sono disponibili`}: riaprilo nel Lab ML (potrebbe essere stato eliminato o non ancora addestrato) oppure scollegalo da «Modelli».
          </div>
        )}
        {runtimeError && (
          <div className="absolute inset-x-4 bottom-4 rounded-xl border border-red-500/30 bg-red-950/85 px-4 py-3 text-sm text-red-100 backdrop-blur">
            <div className="mb-1 flex items-center gap-2 text-red-200">
              <AlertCircle className="h-4 w-4" />
              Errore di runtime nello sketch
            </div>
            <p className="font-mono text-xs leading-relaxed text-red-50">{runtimeError}</p>
          </div>
        )}
      </div>
    </div>
  )
}
