// Copies the MediaPipe Tasks Vision WebAssembly runtime out of node_modules into public/, so hand tracking is
// self-hosted (no CDN). Runs before `dev` and `build`; the copied files are not committed.
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const target = join(root, 'public', 'vendor', 'mediapipe', 'wasm')
const files = ['vision_wasm_internal.js', 'vision_wasm_internal.wasm', 'vision_wasm_nosimd_internal.js', 'vision_wasm_nosimd_internal.wasm']

if (!existsSync(source)) {
  console.warn('[ml-assets] @mediapipe/tasks-vision not installed: hand tracking will be unavailable')
  process.exit(0)
}
mkdirSync(target, { recursive: true })
for (const file of files) copyFileSync(join(source, file), join(target, file))
console.log(`[ml-assets] copied ${files.length} MediaPipe wasm files to public/vendor/mediapipe/wasm`)
