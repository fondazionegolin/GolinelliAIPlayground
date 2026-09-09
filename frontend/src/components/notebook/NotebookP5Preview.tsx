import { AlertCircle } from 'lucide-react'
import { NOTEBOOK_LIBRARIES } from './notebookLibraries'

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
}

const P5_CDN = 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.9.3/p5.min.js'

function buildPreviewDoc(files: P5File[], activeLibraries: string[]) {
  const isEmpty = files.every((f) => !f.source.trim())

  // Resolve CDN URLs for active libraries (in order, preserving multi-script libs)
  const libScriptTags = activeLibraries.flatMap((id) => {
    const lib = NOTEBOOK_LIBRARIES.find((l) => l.id === id)
    if (!lib) return []
    return lib.cdnUrls.map((url) => `    <script src="${url}" crossorigin="anonymous"></script>`)
  }).join('\n')

  const scriptBlocks = files.map((f) => {
    const escaped = f.source.replace(/<\/script>/gi, '<\\/script>')
    return `
    <script>
      // ── ${f.name} ──
      try {
        ${escaped}
      } catch (error) {
        notifyParent('runtime-error', error && error.message ? error.message : String(error))
      }
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
        color: #94a3b8;
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
        notifyParent('runtime-error', String(message) + ' (riga ' + lineno + ':' + colno + ')' + stack)
      }
      // Le Promise rifiutate senza .catch() (comuni con async/await in librerie come
      // MediaPipe/ml5) non passano da window.onerror: senza questo listener sparivano
      // in silenzio e la console non segnalava nulla allo studente.
      window.addEventListener('unhandledrejection', function(event) {
        var reason = event.reason
        var message = reason instanceof Error ? (reason.message + (reason.stack ? '\\n' + reason.stack : '')) : String(reason)
        notifyParent('runtime-error', 'Promise non gestita: ' + message)
      })
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
    <script src="${P5_CDN}"></script>
${libScriptTags}
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
}: Props) {
  // Libraries that require camera need relaxed sandbox + allow attribute
  const needsCamera = activeLibraries.some((id) => {
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
          </p>
        </div>
      </div>
      <div className="relative h-[calc(100%-49px)]">
        <iframe
          key={previewNonce}
          title="Anteprima p5.js"
          srcDoc={buildPreviewDoc(files, activeLibraries)}
          sandbox={needsCamera ? 'allow-scripts allow-same-origin' : 'allow-scripts'}
          allow={needsCamera ? 'camera; microphone' : undefined}
          className="h-full w-full border-0 bg-white"
          onLoad={(e) => {
            onRuntimeMessage(null)
            onIframeLoad?.((e.target as HTMLIFrameElement).contentWindow)
          }}
        />
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
