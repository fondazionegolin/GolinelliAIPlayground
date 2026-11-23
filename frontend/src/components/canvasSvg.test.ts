import { describe, expect, it } from 'vitest'
import { fitSize, sanitizeSvg, svgFromText, svgSize } from './canvasSvg'

describe('canvasSvg', () => {
  it('strips scripts, handlers and external links', () => {
    const dirty = '<?xml version="1.0"?><svg viewBox="0 0 100 50"><script>alert(1)</script><rect onclick="x()" width="10" height="10"/><image href="https://evil.test/a.png"/><foreignObject><div/></foreignObject></svg>'
    const clean = sanitizeSvg(dirty)!
    expect(clean).not.toMatch(/script|onclick|evil|foreignObject/i)
    expect(clean).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(clean.startsWith('<svg')).toBe(true)
  })
  it('rejects non-svg text', () => { expect(sanitizeSvg('hello')).toBeNull() })
  it('reads the size from width/height or viewBox', () => {
    expect(svgSize('<svg width="200px" height="100"></svg>')).toEqual({ w: 200, h: 100 })
    expect(svgSize('<svg viewBox="0 0 640 480"></svg>')).toEqual({ w: 640, h: 480 })
  })
  it('builds a data url and fits the size', () => {
    const r = svgFromText('<svg viewBox="0 0 800 400"><circle r="5"/></svg>')!
    expect(r.src.startsWith('data:image/svg+xml')).toBe(true)
    expect(fitSize(r.w, r.h)).toEqual({ w: 420, h: 210 })
  })
})
