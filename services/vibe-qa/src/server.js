'use strict'
const http = require('http')
const { chromium } = require('playwright')
const { createWorkspace } = require('./workspace')
const { runTypecheck } = require('./typecheck')
const { bundleProject } = require('./bundle')
const { inspectViewport, crawl, VIEWPORTS } = require('./runtime')
const { runAcceptance } = require('./steps')

const PORT = Number(process.env.PORT || 8100)
const MAX_CONCURRENT = Number(process.env.QA_CONCURRENCY || 2)
const MAX_BODY = 12 * 1024 * 1024
let browser = null
let active = 0
const queue = []

async function getBrowser() {
  if (browser && browser.isConnected()) return browser
  browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] })
  return browser
}

async function withSlot(job) {
  if (active >= MAX_CONCURRENT) await new Promise((resolve) => queue.push(resolve))
  active++
  try { return await job() } finally { active--; const next = queue.shift(); if (next) next() }
}

async function qa(input) {
  const started = Date.now()
  const files = Array.isArray(input.files) ? input.files : []
  const ws = createWorkspace(files)
  const report = { ok: true, files: ws.written.length, typecheck: null, build: null, runtime: { ran: false }, crawl: null, acceptance: [] }
  try {
    const [types, bundle] = await Promise.all([runTypecheck(ws, files), bundleProject(ws, files)])
    report.typecheck = types
    report.build = { ok: bundle.ok, skipped: !!bundle.skipped, reason: bundle.reason || null, errors: bundle.errors || [] }
    if (!bundle.ok) { report.runtime = { ran: false, reason: bundle.skipped ? bundle.reason : 'build non riuscita' }; report.elapsedMs = Date.now() - started; return report }
    const b = await getBrowser()
    const viewports = []
    for (const viewport of VIEWPORTS) {
      try { viewports.push(await inspectViewport(b, bundle, viewport)) }
      catch (error) { viewports.push({ name: viewport.name, error: String(error.message || error).slice(0, 200) }) }
    }
    report.runtime = { ran: true, viewports }
    const budget = Number(input.budgetMs) || 70000
    const remaining = () => Math.max(5000, budget - (Date.now() - started))
    report.crawl = await crawl(b, bundle, Math.min(22000, remaining())).catch((error) => ({ error: String(error.message || error).slice(0, 200) }))
    if (Array.isArray(input.tests) && input.tests.length) report.acceptance = await runAcceptance(b, bundle, input.tests, remaining()).catch((error) => [{ id: 'runner', passed: false, error: String(error.message || error).slice(0, 200) }])
  } catch (error) {
    report.ok = false
    report.error = String(error && error.message || error).slice(0, 300)
  } finally {
    ws.cleanup()
  }
  report.elapsedMs = Date.now() - started
  return report
}

const server = http.createServer(async (req, res) => {
  const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
  if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true, active, queued: queue.length })
  if (req.method !== 'POST' || req.url !== '/qa') return send(404, { error: 'not found' })
  let size = 0
  const chunks = []
  req.on('data', (chunk) => { size += chunk.length; if (size > MAX_BODY) req.destroy(); else chunks.push(chunk) })
  req.on('end', async () => {
    let input
    try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch (_) { return send(400, { error: 'invalid json' }) }
    try { send(200, await withSlot(() => qa(input))) } catch (error) { send(500, { error: String(error && error.message || error) }) }
  })
})
server.listen(PORT, () => console.log('vibe-qa listening on ' + PORT))
process.on('SIGTERM', () => { if (browser) browser.close().catch(() => {}); process.exit(0) })
