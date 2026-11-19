'use strict'
// Acceptance tests written by the product step: a tiny declarative DSL executed with real locators.
const { openPage } = require('./page')
const { VIEWPORTS } = require('./runtime')

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const rx = (s) => new RegExp(esc(s), 'i')

function locate(page, step) {
  if (step.selector) return page.locator(step.selector).first()
  const text = step.text || step.label || step.placeholder || step.name
  if (step.do === 'fill') {
    if (step.label) return page.getByLabel(rx(step.label)).first()
    if (step.placeholder) return page.getByPlaceholder(rx(step.placeholder)).first()
    return page.locator('input:not([type=hidden]), textarea').nth(Number(step.index || 0))
  }
  if (step.do === 'select' || step.do === 'check') return (step.label ? page.getByLabel(rx(step.label)) : page.locator(step.do === 'select' ? 'select' : 'input[type=checkbox], input[type=radio]')).first()
  return page.getByRole('button', { name: rx(text) }).or(page.getByRole('link', { name: rx(text) })).or(page.getByRole('tab', { name: rx(text) })).or(page.getByText(rx(text))).first()
}

async function runStep(page, step, timeout) {
  switch (step.do) {
    case 'click': await locate(page, step).click({ timeout }); break
    case 'fill': await locate(page, step).fill(String(step.value ?? ''), { timeout }); break
    case 'select': { const el = locate(page, step); await el.selectOption({ label: String(step.value) }, { timeout }).catch(() => el.selectOption(String(step.value), { timeout })); break }
    case 'check': await locate(page, step).check({ timeout }); break
    case 'press': await page.keyboard.press(String(step.key || 'Enter')); break
    case 'wait': await page.waitForTimeout(Math.min(Number(step.ms) || 300, 3000)); break
    case 'expectText': await page.getByText(rx(step.text)).first().waitFor({ state: 'visible', timeout }); break
    case 'expectNotText': { const n = await page.getByText(rx(step.text)).count(); if (n > 0 && (await page.getByText(rx(step.text)).first().isVisible())) throw new Error('testo ancora visibile: ' + step.text); break }
    case 'expectVisible': await (step.selector ? page.locator(step.selector) : page.getByText(rx(step.text))).first().waitFor({ state: 'visible', timeout }); break
    case 'expectCount': { const n = await page.locator(step.selector).count(); if (n < Number(step.min ?? 1)) throw new Error(`attesi almeno ${step.min ?? 1} elementi "${step.selector}", trovati ${n}`); break }
    default: throw new Error('azione sconosciuta: ' + step.do)
  }
  await page.waitForTimeout(150)
}

function describe(step) {
  return [step.do, step.text || step.label || step.placeholder || step.selector || step.key || '', step.value ?? ''].filter((v) => v !== '').join(' ')
}

async function runAcceptance(browser, bundle, tests, deadlineMs) {
  const results = []
  const started = Date.now()
  let shots = 0
  for (const test of (tests || []).slice(0, 12)) {
    if (Date.now() - started > deadlineMs) { results.push({ id: test.id, title: test.title, feature: test.feature, passed: false, skipped: true, error: 'tempo del QA esaurito' }); continue }
    const { context, page } = await openPage(browser, bundle, VIEWPORTS[2])
    const result = { id: test.id, title: test.title, feature: test.feature, passed: true, steps: (test.steps || []).length }
    try {
      for (const [index, step] of (test.steps || []).slice(0, 30).entries()) {
        try { await runStep(page, step, 3500) } catch (error) {
          result.passed = false; result.failedStep = index + 1; result.step = describe(step)
          result.error = String(error.message || error).split('\n')[0].slice(0, 200)
          break
        }
      }
      const crash = await page.evaluate(() => window.__qaCrash || null).catch(() => null)
      if (crash) { result.passed = false; result.error = (result.error ? result.error + ' | ' : '') + 'crash: ' + crash.message }
      // The screen a user lands on at the end of the flow: what the visual reviewer needs to judge quiz/results/detail pages.
      if (shots < 3) {
        const buffer = await page.screenshot({ type: 'jpeg', quality: 52, fullPage: false, timeout: 8000 }).catch(() => null)
        if (buffer) { result.screenshot = 'data:image/jpeg;base64,' + buffer.toString('base64'); shots++ }
      }
    } finally { await context.close().catch(() => {}) }
    results.push(result)
  }
  return results
}

module.exports = { runAcceptance }
