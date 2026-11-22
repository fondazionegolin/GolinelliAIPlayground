import { buildPreviewDoc } from './NotebookP5Preview'
import { p5NeedsCamera } from './p5Camera'
import type { MlRuntimeModel } from '@/lib/mlRuntimeStub'

export interface P5VerifyInput {
  files: { name: string; source: string }[]
  libraries: string[]
  mlModels?: MlRuntimeModel[]
}

export interface P5VerifyResult {
  /** Distinct runtime errors, in the order they appeared (empty = the sketch ran cleanly). */
  errors: string[]
  /** Frames drawn in the small window and after the full-screen resize (0 = draw() never ran). */
  framesSmall: number
  framesLarge: number
  seconds: number
}

const CHANNEL = 'p5-verify'
// Library logs that are not errors (MediaPipe/TFLite print their start-up info on stderr).
const NOISE = /^(INFO:|WARNING:|[IW]\d{4} |Created TensorFlow Lite|.*XNNPACK|.*gl_context)/i
const HEAVY_LIBRARIES = new Set(['ml5', 'mediapipe-hands', 'mediapipe-face'])

const FRAME_PROBE = `<script>
(function () {
  setInterval(function () {
    try { window.parent.postMessage({ source: '${CHANNEL}', type: 'frames', payload: typeof frameCount === 'number' ? frameCount : -1 }, '*') } catch (e) {}
  }, 250);
})();
</script>`

/**
 * Run a sketch for a few seconds in an invisible preview with a synthetic webcam, then resize it as a full screen
 * would (16:9, much larger) and keep running: setup, draw, the camera pipeline and windowResized() are all
 * exercised. Returns the runtime errors it produced. Never touches the real preview or the user's camera.
 */
export function verifyP5Sketch({ files, libraries, mlModels = [] }: P5VerifyInput): Promise<P5VerifyResult> {
  const heavy = mlModels.length > 0 || libraries.some((id) => HEAVY_LIBRARIES.has(id))
  const smallMs = heavy ? 6000 : 2500
  const largeMs = heavy ? 4000 : 2500
  const started = performance.now()

  return new Promise((resolve) => {
    const iframe = document.createElement('iframe')
    const needsSameOrigin = p5NeedsCamera(files, libraries, mlModels)
    iframe.setAttribute('sandbox', needsSameOrigin ? 'allow-scripts allow-same-origin' : 'allow-scripts')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.tabIndex = -1
    // In the viewport (off-screen iframes are throttled and would never draw) but invisible and inert.
    iframe.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:480px;border:0;opacity:0;pointer-events:none;z-index:-1;'

    const errors: string[] = []
    let frames = 0
    let framesSmall = 0
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow || !event.data || event.data.source !== CHANNEL) return
      if (event.data.type === 'frames') frames = Math.max(frames, Number(event.data.payload) || 0)
      if (event.data.type === 'runtime-error') {
        const text = String(event.data.payload || '').trim()
        if (!text || NOISE.test(text)) return
        const firstLine = text.split('\n')[0]
        if (!errors.some((e) => e.split('\n')[0] === firstLine)) errors.push(text.slice(0, 900))
      }
    }
    window.addEventListener('message', onMessage)

    const doc = buildPreviewDoc(files, libraries, mlModels, { channel: CHANNEL, syntheticCamera: true })
      .replace('</body>', `${FRAME_PROBE}</body>`)
    iframe.srcdoc = doc
    document.body.appendChild(iframe)

    window.setTimeout(() => {
      framesSmall = frames
      // Full-screen-like resize: larger and 16:9, so aspect-ratio and coordinate-space bugs show up.
      iframe.style.width = '1280px'
      iframe.style.height = '720px'
    }, smallMs)
    window.setTimeout(() => {
      window.removeEventListener('message', onMessage)
      iframe.remove()
      resolve({
        errors: errors.slice(0, 6),
        framesSmall,
        framesLarge: Math.max(0, frames - framesSmall),
        seconds: Math.round((performance.now() - started) / 100) / 10,
      })
    }, smallMs + largeMs)
  })
}

/** The runtime errors as a numbered list, sent back to the agent when the run failed. */
export function describeVerification(result: P5VerifyResult): string {
  return result.errors.map((e, i) => `${i + 1}. ${e}`).join('\n')
}
