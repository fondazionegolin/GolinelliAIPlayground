'use strict'
const { BRIDGE } = require('./bridge')

const ORIGIN = 'http://qa.local'

function html(bundle) {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>QA</title><style>${bundle.css || ''}</style></head><body><div id="root"></div><script>${BRIDGE}</script><script>${String(bundle.js || '').replace(/<\/script>/gi, '<\\/script>')}</script></body></html>`
}

const NOISE = [/Failed to load resource/i, /net::ERR_/i, /favicon/i, /ResizeObserver loop/i, /Download the React DevTools/i, /fonts\.(googleapis|gstatic)/i, /tile\.openstreetmap/i, /ERR_FAILED/i]

// New isolated page serving the bundle at a stable origin; all other network is blocked (fast, deterministic).
async function openPage(browser, bundle, viewport, options = {}) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1,
    isMobile: !!viewport.mobile, hasTouch: !!viewport.mobile, locale: 'it-IT',
  })
  const page = await context.newPage()
  const errors = { console: [], page: [] }
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return
    const text = msg.text()
    if (NOISE.some((re) => re.test(text))) return
    errors.console.push(text.slice(0, 300))
  })
  page.on('pageerror', (err) => errors.page.push(String(err && err.message || err).slice(0, 300)))
  await page.route('**/*', (route) => {
    const url = route.request().url()
    if (url === ORIGIN + '/' || url.startsWith(ORIGIN + '/#') || url.startsWith(ORIGIN + '/?')) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html(bundle) })
    if (url.startsWith('data:') || url.startsWith(ORIGIN)) return route.fulfill({ status: 204, body: '' })
    // Web fonts are part of the design: let them load. Everything else stays offline (fast, deterministic).
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)) return route.continue()
    return route.abort()
  })
  await page.goto(ORIGIN + '/' + (options.hash || ''), { waitUntil: 'load', timeout: 15000 })
  await Promise.race([page.evaluate(() => document.fonts && document.fonts.ready), page.waitForTimeout(4000)]).catch(() => {})
  await page.waitForTimeout(options.settleMs ?? 900)
  return { context, page, errors }
}

module.exports = { openPage, ORIGIN }
