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

type Props = {
  files: GeneratedFile[]
  /** Called whenever the running project emits compile/runtime errors (drives the agentic fix loop). */
  onErrors?: (errors: SandpackRuntimeError[]) => void
  /** Called once the project mounts and renders without errors. */
  onReady?: () => void
  showConsole?: boolean
  /** Inspector "ask the AI about this section" overlay (mirrors the legacy preview). */
  enableInspector?: boolean
  className?: string
}

// Platform-owned files: the model never controls these. They wire the real React entry point and
// reinject the window.GolinelliAI bridge so generated apps can still call the platform AI runtime.
// Keeping html + entry + bridge out of the model's hands also blocks external-CDN injection.
const ENTRY_PATH = '/index.tsx'
const HTML_PATH = '/public/index.html'
const BRIDGE_PATH = '/golinelli-bridge.ts'

const HTML_DOC = `<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`

// The bridge runs inside the Sandpack preview iframe. It speaks the same postMessage protocol the
// legacy srcDoc preview used (golinelli-coding-preview -> golinelli-coding-host), so the existing
// parent handler in StudentCodingLabModule picks it up unchanged.
function buildBridgeSource(enableInspector: boolean): string {
  return `// AUTO-GENERATED platform bridge. Do not edit.
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>()
window.addEventListener('message', (event: MessageEvent) => {
  const data: any = event.data || {}
  if (data.source !== 'golinelli-coding-host' || !pending.has(data.id)) return
  const entry = pending.get(data.id)!
  pending.delete(data.id)
  data.ok ? entry.resolve(data.result) : entry.reject(new Error(data.error || 'Chiamata AI non riuscita.'))
})
function callHost(action: string, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = 'coding_' + Date.now() + '_' + Math.random().toString(36).slice(2)
    pending.set(id, { resolve, reject })
    window.parent.postMessage({ source: 'golinelli-coding-preview', id, action, payload }, '*')
    setTimeout(() => {
      if (!pending.has(id)) return
      pending.delete(id)
      reject(new Error('La chiamata AI ha impiegato troppo tempo.'))
    }, 45000)
  })
}
;(window as any).GolinelliAI = {
  chat: ({ content, history = [], profileKey = 'tutor', provider, model }: any = {}) =>
    callHost('chat', { content, history, profileKey, provider, model }),
  generateImage: ({ prompt, provider = 'gpt-image-1' }: any = {}) =>
    callHost('generateImage', { prompt, provider }),
}
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
  files,
  onErrors,
  onReady,
  showConsole = false,
  enableInspector = true,
  className,
}: Props) {
  const dependencies = useMemo(() => parseDependencies(files), [files])

  const sandpackFiles = useMemo<SandpackFiles>(() => {
    const map: SandpackFiles = {}
    for (const file of files) {
      const path = normalizePath(file.path)
      // package.json deps are surfaced via customSetup; the file itself isn't needed by the bundler.
      if (path === '/package.json') continue
      map[path] = { code: file.content }
    }
    // Platform-owned wiring — always overrides whatever the model produced for these paths.
    map[BRIDGE_PATH] = { code: buildBridgeSource(enableInspector), hidden: true }
    map[HTML_PATH] = { code: HTML_DOC, hidden: true }
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
  }, [files, enableInspector])

  return (
    <div className={`golinelli-sp ${className || ''}`}>
      {/* Sandpack ships a fixed default layout height; force the whole chain to fill our container. */}
      <style>{SANDPACK_FILL_CSS}</style>
      <SandpackProvider
        template="react-ts"
        files={sandpackFiles}
        customSetup={{
          entry: ENTRY_PATH,
          dependencies: {
            react: '^18.2.0',
            'react-dom': '^18.2.0',
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
.golinelli-sp .sp-preview-iframe { flex: 1; min-height: 0; height: 100%; }
.golinelli-sp .sp-console { flex: 0 0 180px; min-height: 0; }
`.trim()
