// Builds public/lib/goliai-ml.js (the ML runtime used by Vibe Lab previews). `--force` rebuilds even if it exists.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'public', 'lib', 'goliai-ml.js')
if (existsSync(output) && !process.argv.includes('--force')) process.exit(0)
const result = spawnSync('npx', ['vite', 'build', '--config', 'vite.ml-runtime.config.ts'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
if (result.status !== 0) { console.error('[ml-runtime] build failed'); process.exit(result.status ?? 1) }
