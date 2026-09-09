import express from 'express'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const appRoot = path.resolve(__dirname, '..')
const port = Number(process.env.PORT || 8090)
const maxCodeChars = Number(process.env.MAX_CODE_CHARS || 40000)
const compileTimeoutMs = Number(process.env.PXT_COMPILE_TIMEOUT_MS || 180000)
const adafruitRoot = path.join(appRoot, 'node_modules', 'pxt-adafruit')
const targetProjectsRoot = path.join(adafruitRoot, 'projects')

function resolvePxtCli() {
  const candidates = [
    path.join(appRoot, 'node_modules', 'pxt-core', 'built', 'pxt.js'),
    path.join(adafruitRoot, 'node_modules', 'pxt-core', 'built', 'pxt.js'),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

const pxtCli = resolvePxtCli()
const app = express()
app.use(express.json({ limit: '256kb' }))

function runPxt(projectDir, args) {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [pxtCli, ...args],
      {
        cwd: projectDir,
        timeout: compileTimeoutMs,
        env: {
          ...process.env,
          PXT_HOME: process.env.PXT_HOME || '/tmp/pxt-home',
          PXT_NODOCKER: '1',
        },
        maxBuffer: 1024 * 1024 * 8,
      },
      (error, stdout, stderr) => {
        const output = `${stdout || ''}${stderr || ''}`.trim()
        if (error) {
          const wrapped = new Error(error.message)
          wrapped.output = output
          wrapped.code = error.code
          reject(wrapped)
          return
        }
        resolve(output)
      }
    )
  })
}

function validateCode(code) {
  if (typeof code !== 'string' || !code.trim()) {
    return 'Il campo code deve contenere codice MakeCode TypeScript.'
  }
  if (code.length > maxCodeChars) {
    return `Il codice supera il limite di ${maxCodeChars} caratteri.`
  }
  return null
}

async function writeProject(projectDir, code) {
  await fs.mkdir(projectDir, { recursive: true })
  await fs.writeFile(
    path.join(projectDir, 'pxt.json'),
    JSON.stringify(
      {
        name: path.basename(projectDir),
        dependencies: {
          'circuit-playground': '*',
          serial: '*',
        },
        files: ['main.ts'],
      },
      null,
      2
    )
  )
  await fs.writeFile(path.join(projectDir, 'main.ts'), code, 'utf8')
}

app.get('/health', async (_req, res) => {
  try {
    await fs.access(adafruitRoot)
    await fs.access(pxtCli)
    res.json({ ok: true, target: 'pxt-adafruit', pxt_cli: pxtCli })
  } catch (error) {
    res.status(503).json({ ok: false, error: error instanceof Error ? error.message : 'PXT non disponibile' })
  }
})

app.post('/compile/circuitplayground', async (req, res) => {
  const code = req.body?.code
  const validationError = validateCode(code)
  if (validationError) {
    res.status(400).json({ ok: false, error: validationError })
    return
  }

  const projectName = `eduai-${randomUUID()}`
  const projectDir = path.join(targetProjectsRoot, projectName)
  const logs = []

  try {
    await writeProject(projectDir, code.trim())
    logs.push(await runPxt(projectDir, ['install']))
    logs.push(await runPxt(projectDir, ['build']))

    const uf2Path = path.join(projectDir, 'built', 'binary.uf2')
    const uf2 = await fs.readFile(uf2Path)
    res.json({
      ok: true,
      board: 'circuitplayground',
      filename: 'circuit-playground-express.uf2',
      mime_type: 'application/octet-stream',
      size_bytes: uf2.length,
      uf2_base64: uf2.toString('base64'),
      logs: logs.filter(Boolean).join('\n\n').slice(-12000),
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'Compilazione non riuscita.'
    const output = error?.output ? String(error.output) : logs.filter(Boolean).join('\n\n')
    res.status(422).json({
      ok: false,
      error: detail,
      logs: output.slice(-12000),
    })
  } finally {
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => undefined)
  }
})

app.listen(port, () => {
  console.log(`PXT compiler listening on :${port}`)
})
