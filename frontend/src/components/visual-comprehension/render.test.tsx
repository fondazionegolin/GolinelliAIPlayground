import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import BlackboardDrawing from './BlackboardDrawing'
import { getDrawingLayout, type DrawingMark, type DrawingScene, type ScenePoint } from './blackboard'
import type { Region } from './types'

const W = 1000, H = 700
const page = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="white"/>
<polygon points="150,560 850,560 420,130" fill="none" stroke="#333" stroke-width="5"/>
<text x="470" y="610" font-size="34" font-family="sans-serif">AB = 7 cm</text><text x="110" y="590" font-size="34" font-family="sans-serif">A</text>
<text x="860" y="590" font-size="34" font-family="sans-serif">B</text><text x="405" y="105" font-size="34" font-family="sans-serif">C</text>
<text x="40" y="60" font-size="30" font-family="sans-serif">Calcola l'area del triangolo ABC.</text></svg>`
const url = 'data:image/svg+xml;base64,' + Buffer.from(page).toString('base64')
const region = (id: string, x: number, y: number, width: number, height: number, text: string): Region => ({ id, label: id, text, box: { x, y, width, height }, confidence: 'high' })
const regions = [region('base', 12, 78, 76, 13, 'AB = 7 cm'), region('vA', 9, 78, 6, 8, 'A'), region('vB', 85, 78, 6, 8, 'B'), region('vC', 39, 13, 6, 8, 'C'), region('ask', 3, 4, 50, 8, "Calcola l'area del triangolo ABC.")]
const pt = (id: string, over: Partial<ScenePoint>): ScenePoint => ({ id, kind: 'xy', space: 'image', x: null, y: null, region: null, element: null, at: 'center', refs: [], t: null, dx: 0, dy: 0, ...over })
const mark = (id: string, kind: DrawingMark['kind'], over: Partial<DrawingMark> = {}): DrawingMark => ({
  id, kind, space: 'image', box: null, points: [], text: '', color: 'ink', fill: 'none', font_size: 3.5, stroke_width: .3, step: 0,
  from_region_id: null, to_element_id: null, plot: null, diagram: null, fretboard: null, rhythm: null, ...over,
})

const triangle: DrawingScene = {
  title: 'Altezza del triangolo', layout: 'overlay', steps: ['Evidenzio la base', 'Traccio l’altezza', 'Calcolo l’area'],
  points: [
    pt('A', { kind: 'region', region: 'vA', at: 'center', dy: -1 }), pt('B', { kind: 'region', region: 'vB', at: 'center', dy: -1 }),
    pt('C', { kind: 'region', region: 'vC', at: 'bottom' }), pt('H', { kind: 'foot', refs: ['C', 'A', 'B'] }),
    pt('mid', { kind: 'midpoint', refs: ['A', 'B'] }),
  ],
  elements: [
    mark('hl', 'highlight', { from_region_id: 'base', color: 'amber' }),
    mark('h', 'dimension', { anchors: ['C', 'H'], text: 'h', color: 'red', step: 1, stroke_width: .35 }),
    mark('ra', 'right_angle', { anchors: ['C', 'H', 'B'], color: 'red', step: 1, radius: 3 }),
    mark('al', 'arc', { anchors: ['B', 'A', 'C'], text: 'α', color: 'blue', step: 1, radius: 6 }),
    mark('tk', 'tick', { anchors: ['A', 'mid'], count: 1, color: 'green', step: 1 }),
    mark('note', 'callout', { target: 'H', text: 'piede dell’altezza', color: 'red', step: 1 }),
    mark('calc', 'formula', { text: 'A=\\frac{b\\cdot h}{2}', box: { x: 62, y: 4, width: 34, height: 12 }, color: 'blue', step: 2, font_size: 5 }),
    mark('lens', 'lens', { from_region_id: 'vC', box: { x: 70, y: 28, width: 24, height: 24 }, color: 'violet', step: 2 }),
  ],
}

const numberLine: DrawingScene = {
  title: 'Somma a salti', layout: 'overlay', steps: ['Parto da 8', 'Salto di 5'], elements: [
    mark('nl', 'numberline', { box: { x: 4, y: 55, width: 92, height: 38 }, color: 'ink', numberline: { min: 6, max: 16, step: 1,
      marks: [{ value: 8, label: '8', color: 'blue' }, { value: 13, label: '13', color: 'red' }], jumps: [{ start: 8, end: 13, label: '+5', color: 'red' }] } }),
    mark('pl', 'polygon', { anchors: [], points: [{ x: 10, y: 10 }, { x: 30, y: 10 }, { x: 20, y: 30 }], fill: 'soft', color: 'green' }),
    mark('c', 'circle', { points: [{ x: 70, y: 25 }, { x: 80, y: 25 }], color: 'violet' }),
  ],
}

function render(scene: DrawingScene) {
  const layout = getDrawingLayout(W, H, scene)
  const body = renderToStaticMarkup(<BlackboardDrawing scene={scene} layout={layout} regions={regions} visibleStep={99} image={{ url, width: W, height: H }} scale={1} />)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" width="${layout.width}" height="${layout.height}"><rect width="100%" height="100%" fill="white"/><image href="${url}" x="${layout.image.x}" y="${layout.image.y}" width="${W}" height="${H}"/>${body}</svg>`
}

describe('scene rendering', () => {
  it.each([['triangle', triangle], ['numberline', numberLine]] as const)('renders every v2 tool in %s', (name, scene) => {
    const svg = render(scene)
    for (const m of scene.elements) expect(svg).toContain(`data-drawing-id="${m.id}"`)
    expect(svg).not.toContain('NaN')
    if (process.env.VC_PREVIEW_DIR) { mkdirSync(process.env.VC_PREVIEW_DIR, { recursive: true }); writeFileSync(join(process.env.VC_PREVIEW_DIR, `${name}.svg`), svg) }
  })

  it('builds up step by step: earlier marks stay, the new turn starts from what was kept', () => {
    const layout = getDrawingLayout(W, H, triangle)
    const at = (scene: DrawingScene, step: number) => renderToStaticMarkup(<BlackboardDrawing scene={scene} layout={layout} regions={regions} visibleStep={step}
      image={{ url, width: W, height: H }} scale={1} />)
    const second = at(triangle, 2)
    for (const id of ['hl', 'h', 'ra', 'calc']) expect(second).toContain(`data-drawing-id="${id}"`)
    expect(at(triangle, 0)).not.toContain('data-drawing-id="calc"')  // later steps wait their turn
    const next: DrawingScene = { ...triangle, steps: ['Ora tocca a te'], elements: [
      ...triangle.elements.filter(m => m.step === 1).map(m => ({ ...m, step: 0, carried: true })),
      mark('ask', 'formula', { text: 'A = ?', box: { x: 62, y: 20, width: 30, height: 10 }, color: 'blue' }),
    ] }
    const kept = at(next, 0)
    expect(kept).toContain('data-drawing-id="h"')
    expect(kept).toContain('data-drawing-id="ask"')
  })
})
