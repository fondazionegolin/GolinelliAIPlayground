'use strict'
const fs = require('fs')
const path = require('path')
const { openPage } = require('./page')

const VIEWPORTS = [
  { name: 'mobile', width: 390, height: 844, mobile: true, shot: true },
  { name: 'tablet', width: 820, height: 1180, shot: false },
  { name: 'desktop', width: 1366, height: 820, shot: true },
]
const AXE = fs.readFileSync(path.join(__dirname, '..', 'node_modules', 'axe-core', 'axe.min.js'), 'utf8')

async function measure(page, viewport) {
  return page.evaluate((vw) => {
    const doc = document.documentElement
    const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' }
    const label = (el) => (el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''))
    const text = (document.body.innerText || '').trim()
    const overflowing = []
    if (doc.scrollWidth > window.innerWidth + 1) {
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.right > window.innerWidth + 2 && visible(el)) { overflowing.push(label(el) + ' (' + Math.round(r.right) + 'px)'); if (overflowing.length >= 5) break }
      }
    }
    const interactive = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab]')].filter(visible)
    const small = vw.mobile ? interactive.filter((el) => { const r = el.getBoundingClientRect(); return r.width < 32 || r.height < 32 }).map(label).slice(0, 6) : []
    const tinyText = [...document.querySelectorAll('p, span, li, td, a, button, label, h1, h2, h3, h4, small')].filter((el) => visible(el) && el.childElementCount === 0 && (el.textContent || '').trim().length > 2 && parseFloat(getComputedStyle(el).fontSize) < 11).length
    const images = [...document.querySelectorAll('img')].filter(visible)
    const media = images.length + document.querySelectorAll('svg, canvas, video').length
    return {
      textLength: text.length, blank: text.length < 15 && media === 0, crash: window.__qaCrash || null,
      scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth, overflowX: doc.scrollWidth > window.innerWidth + 1, overflowing,
      pageHeight: doc.scrollHeight, interactive: interactive.length, smallTapTargets: small, tinyTextCount: tinyText,
      images: images.length, brokenImages: images.filter((img) => img.complete && img.naturalWidth === 0).length,
      headings: document.querySelectorAll('h1, h2, h3').length, h1: document.querySelectorAll('h1').length,
      bodyBackground: getComputedStyle(document.body).backgroundColor, fontFamily: getComputedStyle(document.body).fontFamily.slice(0, 80),
    }
  }, viewport)
}

async function axeScan(page) {
  try {
    await page.evaluate(AXE)
    const result = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }, resultTypes: ['violations'] })
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, count: v.nodes.length,
        nodes: v.nodes.slice(0, 3).map((n) => ({ target: (n.target || []).join(' ').slice(0, 120), html: String(n.html || '').slice(0, 140) })) }))
    })
    return result.filter((v) => v.impact === 'critical' || v.impact === 'serious' || v.id === 'color-contrast').slice(0, 14)
  } catch (error) {
    return [{ id: 'axe-failed', impact: 'minor', help: String(error.message || error).slice(0, 120), count: 0, nodes: [] }]
  }
}

async function screenshot(page) {
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  const width = await page.evaluate(() => window.innerWidth)
  const buffer = await page.screenshot({ type: 'jpeg', quality: 55, fullPage: true, clip: { x: 0, y: 0, width, height: Math.max(200, Math.min(height, 2600)) }, timeout: 10000 }).catch(() => null)
  if (!buffer) return null
  return { image: 'data:image/jpeg;base64,' + buffer.toString('base64'), pageHeight: height }
}

async function inspectViewport(browser, bundle, viewport) {
  const { context, page, errors } = await openPage(browser, bundle, viewport)
  try {
    const metrics = await measure(page, viewport)
    const axe = await axeScan(page)
    const shot = viewport.shot ? await screenshot(page) : null
    return { name: viewport.name, width: viewport.width, ...metrics, axe, screenshot: shot ? shot.image : null,
      consoleErrors: errors.console.slice(0, 8), pageErrors: errors.page.slice(0, 8) }
  } finally {
    await context.close().catch(() => {})
  }
}

// What a user sees change when something is clicked: visible text, the whole markup (class changes count), hash and field values.
const snapshot = (page) => page.evaluate(() => {
  const html = document.body.innerHTML
  let sum = 0
  for (let i = 0; i < html.length && i < 300000; i++) sum = (sum * 31 + html.charCodeAt(i)) >>> 0
  return { text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 6000), nodes: sum, hash: location.hash,
    value: [...document.querySelectorAll('input, select, textarea')].map((el) => el.value + (el.checked ? '1' : '')).join('|') }
})

const SKIP_CLICK = /elimin|cancell|svuota|reset|azzera|logout|esci|chiudi|rimuov|delete/i

// Use the app like a user: fill the fields, then press every visible control once and see whether anything happens.
async function crawl(browser, bundle, deadlineMs) {
  const { context, page, errors } = await openPage(browser, bundle, VIEWPORTS[2])
  const report = { clicked: 0, filled: 0, deadControls: [], crashes: [], errorsAfterClick: [], states: 0, controls: [], stateShots: [] }
  const seenStates = new Set()
  const started = Date.now()
  const noteState = async () => { const s = await snapshot(page).catch(() => null); if (s) seenStates.add(s.text.slice(0, 400)); return s }
  try {
    await noteState()
    const fillAll = async () => {
      const fields = await page.$$('input:not([type=hidden]):not([type=file]):not([disabled]), textarea:not([disabled]), select:not([disabled])')
      for (const field of fields.slice(0, 14)) {
        try {
          if (!(await field.isVisible())) continue
          const tag = await field.evaluate((el) => el.tagName.toLowerCase())
          const type = (await field.getAttribute('type')) || 'text'
          if (tag === 'select') { const opts = await field.evaluate((el) => [...el.options].map((o) => o.value)); if (opts.length > 1) await field.selectOption(opts[1], { timeout: 800 }); }
          else if (type === 'checkbox' || type === 'radio') await field.check({ timeout: 800 }).catch(() => {})
          else if (type === 'range') await field.evaluate((el) => { el.value = String(Math.round((Number(el.min || 0) + Number(el.max || 100)) / 2)); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })) })
          else if (type === 'number') await field.fill('3', { timeout: 800 })
          else if (type === 'email') await field.fill('prova@example.com', { timeout: 800 })
          else if (type === 'date') await field.fill('2026-01-15', { timeout: 800 })
          else await field.fill('Prova', { timeout: 800 })
          report.filled++
        } catch (_) { /* field not fillable: ignore */ }
      }
    }
    const tried = new Set()
    for (let round = 0; round < 40 && Date.now() - started < deadlineMs; round++) {
      await fillAll()
      const controls = await page.$$('button:not([disabled]), [role=button], [role=tab], a[href^="#"], a:not([href]), summary')
      let target = null, name = ''
      for (const control of controls) {
        if (!(await control.isVisible().catch(() => false))) continue
        name = ((await control.innerText().catch(() => '')) || (await control.getAttribute('aria-label').catch(() => '')) || '').replace(/\s+/g, ' ').trim().slice(0, 50) || '(senza testo)'
        const key = name + '|' + (await control.evaluate((el) => el.tagName + (el.getAttribute('class') || '')).catch(() => ''))
        if (tried.has(key) || SKIP_CLICK.test(name)) continue
        tried.add(key); target = control; break
      }
      if (!target) break
      const before = await snapshot(page).catch(() => null)
      const errorsBefore = errors.console.length + errors.page.length
      try { await target.scrollIntoViewIfNeeded({ timeout: 800 }).catch(() => {}); await target.click({ timeout: 1500 }) } catch (_) { continue }
      await page.waitForTimeout(350)
      report.clicked++
      const knownBefore = seenStates.size
      const after = await noteState()
      if (seenStates.size > knownBefore && report.stateShots.length < 3) {
        const buffer = await page.screenshot({ type: 'jpeg', quality: 50, fullPage: false, timeout: 8000 }).catch(() => null)
        if (buffer) report.stateShots.push({ after: name, screenshot: 'data:image/jpeg;base64,' + buffer.toString('base64') })
      }
      const crash = await page.evaluate(() => window.__qaCrash || null).catch(() => null)
      if (crash) { report.crashes.push({ control: name, message: crash.message }); await page.evaluate(() => { window.__qaCrash = null }).catch(() => {}); break }
      const newErrors = errors.console.slice(errorsBefore).concat(errors.page.slice(Math.max(0, errorsBefore - errors.console.length)))
      if (newErrors.length) report.errorsAfterClick.push({ control: name, errors: newErrors.slice(0, 2) })
      const same = before && after && before.text === after.text && before.nodes === after.nodes && before.hash === after.hash && before.value === after.value
      report.controls.push({ name, changed: !same })
      if (same) report.deadControls.push(name)
    }
    report.states = seenStates.size
  } finally {
    await context.close().catch(() => {})
  }
  return report
}

module.exports = { inspectViewport, crawl, VIEWPORTS }
