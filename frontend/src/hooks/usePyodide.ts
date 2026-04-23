import { useState, useEffect, useRef, useCallback } from 'react'

export type PyodideStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface CellOutput {
  output_type: 'stream' | 'error' | 'display_data' | 'execute_result'
  text?: string
  ename?: string
  evalue?: string
  traceback?: string[]
  data?: { 'image/png'?: string; 'text/plain'?: string }
}

/** Represents an active input() call waiting for the user to type something. */
export interface InputState {
  prompt: string
  submit: (value: string) => void
}

// ── Worker source (classic, uses importScripts — works in all environments) ──

const PYODIDE_VERSION = '0.26.4'
const PYODIDE_CDN = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`

const WORKER_SOURCE = /* javascript */ `
const PYODIDE_URL = '${PYODIDE_CDN}'

let pyodide = null
let inputSignal = null  // Int32Array over SharedArrayBuffer
let inputData   = null  // Uint8Array over SharedArrayBuffer
let micropipReady = false

const IMPORT_PACKAGE_MAP = {
    PIL: 'pillow',
    bs4: 'beautifulsoup4',
    sklearn: 'scikit-learn',
    skimage: 'scikit-image',
    yaml: 'pyyaml',
    cv2: 'opencv-python',
}

const FALLBACK_MICROPIP_PACKAGES = [
    'pandas',
    'sympy',
    'scipy',
    'seaborn',
    'statsmodels',
    'networkx',
    'openpyxl',
    'xlsxwriter',
    'pyyaml',
    'beautifulsoup4',
    'lxml',
    'requests',
    'pillow',
]

/* ── Python setup code ─────────────────────────────────────────────────── */
const SETUP_CODE = \`
import sys, io, base64, json, builtins

class _Capture:
    def __init__(self): self._b = []
    def write(self, s): self._b.append(str(s))
    def flush(self): pass
    def getvalue(self): return ''.join(self._b)
    def clear(self): self._b = []

_cap_out = _Capture()
_cap_err = _Capture()
sys.stdout = _cap_out
sys.stderr = _cap_err

import matplotlib
matplotlib.use('agg')
import matplotlib.pyplot as plt
import importlib

def _extract_imports(code):
    modules = []
    for raw in str(code).splitlines():
        line = raw.strip()
        if line.startswith('import '):
            payload = line[len('import '):]
            for part in payload.split(','):
                root = part.strip().split(' as ')[0].split('.')[0].strip()
                if root:
                    modules.append(root)
        elif line.startswith('from '):
            payload = line[len('from '):]
            root = payload.split(' import ')[0].split('.')[0].strip()
            if root:
                modules.append(root)
    ordered = []
    seen = set()
    for module in modules:
        if module not in seen:
            ordered.append(module)
            seen.add(module)
    return ordered

def _probe_import(module_name):
    try:
        importlib.import_module(module_name)
        return True
    except Exception:
        return False

def _collect():
    out = _cap_out.getvalue(); err = _cap_err.getvalue()
    _cap_out.clear(); _cap_err.clear()
    figs = []
    for n in plt.get_fignums():
        fig = plt.figure(n)
        buf = io.BytesIO()
        fig.savefig(buf, format='png', bbox_inches='tight', dpi=100)
        buf.seek(0)
        figs.append(base64.b64encode(buf.read()).decode('ascii'))
        plt.close(fig)
    return json.dumps({'out': out, 'err': err, 'figs': figs})
\`

const INPUT_OVERRIDE = \`
from js import _py_request_input, _py_wait_input

def _custom_input(prompt=''):
    _py_request_input(str(prompt) if prompt else '')
    result = _py_wait_input()
    return str(result) if result is not None else ''

builtins.input = _custom_input
\`

/* ── JS helpers exposed to Python via Pyodide JS bridge ─────────────────── */
self._py_request_input = function(prompt) {
    self.postMessage({ type: 'input_request', prompt: String(prompt) })
}

self._py_wait_input = function() {
    if (!inputSignal) {
        // SharedArrayBuffer not available — can't block worker for user input.
        // Post a visible error so the user understands why input() failed.
        self.postMessage({ type: 'input_unavailable' })
        return ''
    }
    // Block this worker thread until the main thread writes the user's input
    var result = Atomics.wait(inputSignal, 0, 0, 60000)
    if (result === 'timed-out') return ''
    // Read length field: Atomics.load avoids any SAB restriction on DataView
    var len = Atomics.load(new Int32Array(inputData.buffer, 0, 1), 0)
    // .slice() copies SAB data into a plain ArrayBuffer (Firefox rejects
    // TextDecoder.decode on SAB-backed views directly).
    var txt = new TextDecoder().decode(inputData.slice(4, 4 + len))
    Atomics.store(inputSignal, 0, 0)  // reset for next call
    return txt
}

/* ── Init ───────────────────────────────────────────────────────────────── */
async function init(sharedBuffers) {
    if (sharedBuffers) {
        inputSignal = new Int32Array(sharedBuffers.signal)
        inputData   = new Uint8Array(sharedBuffers.data)
    }
    try {
        importScripts(PYODIDE_URL + 'pyodide.js')
        pyodide = await loadPyodide({ indexURL: PYODIDE_URL })
        await pyodide.loadPackage(['matplotlib', 'numpy', 'micropip'])
        await pyodide.runPythonAsync(SETUP_CODE)
        await pyodide.runPythonAsync(INPUT_OVERRIDE)
        await pyodide.runPythonAsync('import micropip')
        micropipReady = true
        self.postMessage({ type: 'ready' })
    } catch (e) {
        self.postMessage({ type: 'init_error', message: String(e && e.message ? e.message : e) })
    }
}

async function ensureMicropipImports(code) {
    if (!pyodide || !micropipReady) return []
    let imports = []
    try {
        imports = pyodide.globals.get('_extract_imports')(code).toJs({ create_proxies: false }) || []
    } catch (_) {
        imports = []
    }
    if (!imports.length) return []

    const installed = []
    for (const moduleName of imports) {
        let alreadyAvailable = false
        try {
          alreadyAvailable = !!pyodide.globals.get('_probe_import')(moduleName)
        } catch (_) {
          alreadyAvailable = false
        }
        if (alreadyAvailable) continue

        const packageName = IMPORT_PACKAGE_MAP[moduleName] || moduleName
        const shouldTry = FALLBACK_MICROPIP_PACKAGES.includes(packageName) || moduleName === packageName
        if (!shouldTry) continue

        try {
            await pyodide.runPythonAsync(\`import micropip; await micropip.install("\${packageName}")\`)
            installed.push(packageName)
        } catch (error) {
            const msg = error && error.message ? error.message : String(error)
            self.postMessage({
                type: 'package_warning',
                package: packageName,
                module: moduleName,
                message: msg,
            })
        }
    }
    return installed
}

/* ── Run cell ───────────────────────────────────────────────────────────── */
async function runCell(id, code) {
    if (!pyodide) {
        self.postMessage({ type: 'done', id, outputs: [{ output_type: 'error', ename: 'KernelError', evalue: 'Kernel non pronto', traceback: [] }] })
        return
    }
    var outputs = []
    try {
        await pyodide.loadPackagesFromImports(code)
        const micropipInstalled = await ensureMicropipImports(code)
        var result = await pyodide.runPythonAsync(code)
        var raw  = pyodide.runPython('_collect()')
        var data = JSON.parse(raw)
        if (micropipInstalled.length) {
            outputs.push({ output_type: 'stream', text: '[runtime] Pacchetti caricati con micropip: ' + micropipInstalled.join(', ') + '\\n' })
        }
        if (data.out) outputs.push({ output_type: 'stream', text: data.out })
        if (data.err) outputs.push({ output_type: 'stream', text: '\\x1b[31m' + data.err + '\\x1b[0m' })
        for (var i = 0; i < data.figs.length; i++) {
            outputs.push({ output_type: 'display_data', data: { 'image/png': data.figs[i] } })
        }
        if (result !== undefined && result !== null) {
            var repr = String(result)
            if (repr !== 'None') outputs.push({ output_type: 'execute_result', text: repr })
        }
    } catch (e) {
        try {
            var raw2 = pyodide.runPython('_collect()')
            var d2 = JSON.parse(raw2)
            if (d2.out) outputs.push({ output_type: 'stream', text: d2.out })
            if (d2.err) outputs.push({ output_type: 'stream', text: '\\x1b[31m' + d2.err + '\\x1b[0m' })
        } catch (_) {}
        var msg   = e && e.message ? e.message : String(e)
        var lines = msg.split('\\n').filter(Boolean)
        var last  = lines[lines.length - 1] || msg
        var colon = last.indexOf(':')
        var ename  = colon > 0 ? last.slice(0, colon).trim() : 'Error'
        var evalue = colon > 0 ? last.slice(colon + 1).trim() : last
        outputs.push({ output_type: 'error', ename: ename, evalue: evalue, traceback: lines })
    }
    self.postMessage({ type: 'done', id: id, outputs: outputs })
}

/* ── Message handler ────────────────────────────────────────────────────── */
self.onmessage = async function(event) {
    var msg = event.data
    if      (msg.type === 'init') await init(msg.sharedBuffers)
    else if (msg.type === 'run')  await runCell(msg.id, msg.code)
}
`

// ── Hook ─────────────────────────────────────────────────────────────────────

export function usePyodide(enabled = true) {
  const [status, setStatus]    = useState<PyodideStatus>(enabled ? 'loading' : 'idle')
  const [error, setError]      = useState<string | null>(null)
  const [inputState, setInput] = useState<InputState | null>(null)

  const workerRef  = useRef<Worker | null>(null)
  const pendingRef = useRef(new Map<string, (outputs: CellOutput[]) => void>())
  const initedRef  = useRef(false)

  const createWorker = useCallback(() => {
    // Determine if SharedArrayBuffer is available (requires Cross-Origin Isolation)
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined'

    let signalBuf: SharedArrayBuffer | null = null
    let dataBuf:   SharedArrayBuffer | null = null

    if (hasSharedArrayBuffer) {
      signalBuf = new SharedArrayBuffer(4)          // Int32: 0=idle, 1=value ready
      dataBuf   = new SharedArrayBuffer(4 + 4096)   // Int32 length + UTF-8 payload
    }

    const blob   = new Blob([WORKER_SOURCE], { type: 'application/javascript' })
    const blobUrl = URL.createObjectURL(blob)
    const worker  = new Worker(blobUrl) // classic worker — importScripts works

    worker.onmessage = (ev) => {
      const msg = ev.data
      switch (msg.type) {
        case 'ready':
          setStatus('ready')
          setError(null)
          break

        case 'done': {
          const resolve = pendingRef.current.get(msg.id)
          if (resolve) { resolve(msg.outputs); pendingRef.current.delete(msg.id) }
          break
        }

        case 'package_warning':
          console.warn('[pyodide] package install warning', msg.package, msg.message)
          break

        case 'input_unavailable': {
          // SAB not available: resolve any pending cell with an explanatory error
          const pending = [...pendingRef.current.entries()]
          for (const [pid, res] of pending) {
            res([{ output_type: 'error', ename: 'RuntimeError', evalue: 'input() non disponibile: il sito non è in modalità Cross-Origin Isolated. Ricarica la pagina o contatta l\'amministratore.', traceback: [] }])
            pendingRef.current.delete(pid)
          }
          break
        }

        case 'input_request':
          if (!hasSharedArrayBuffer || !signalBuf || !dataBuf) break
          setInput({
            prompt: msg.prompt,
            submit: (value: string) => {
              const encoded = new TextEncoder().encode(value)
              const dv = new DataView(dataBuf!)
              dv.setInt32(0, encoded.length, true)
              new Uint8Array(dataBuf!).set(encoded, 4)
              Atomics.store(new Int32Array(signalBuf!), 0, 1)
              Atomics.notify(new Int32Array(signalBuf!), 0, 1)
              setInput(null)
            },
          })
          break

        case 'init_error':
          setStatus('error')
          setError(msg.message)
          break
      }
    }

    worker.onerror = (e) => {
      setStatus('error')
      setError(e.message || 'Errore nel worker Python')
    }

    worker.postMessage({
      type: 'init',
      sharedBuffers: signalBuf ? { signal: signalBuf, data: dataBuf } : null,
    })

    return worker
  }, [])

  useEffect(() => {
    if (!enabled) {
      workerRef.current?.terminate()
      workerRef.current = null
      pendingRef.current.clear()
      setInput(null)
      setError(null)
      setStatus('idle')
      initedRef.current = false
      return
    }
    if (initedRef.current) return
    initedRef.current = true
    setStatus('loading')
    workerRef.current = createWorker()
    return () => { workerRef.current?.terminate(); workerRef.current = null }
  }, [createWorker, enabled])

  const runCell = useCallback((code: string): Promise<CellOutput[]> =>
    new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2)
      pendingRef.current.set(id, resolve)
      workerRef.current?.postMessage({ type: 'run', id, code })
    }), [])

  const restartKernel = useCallback(() => {
    if (!enabled) return
    workerRef.current?.terminate()
    URL.revokeObjectURL  // no-op, just to hint GC
    pendingRef.current.clear()
    setInput(null)
    setStatus('loading')
    workerRef.current = createWorker()
  }, [createWorker, enabled])

  return { status, error, runCell, restartKernel, inputState }
}
