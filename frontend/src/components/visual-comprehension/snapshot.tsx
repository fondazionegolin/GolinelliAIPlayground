import { renderToStaticMarkup } from 'react-dom/server'
import BlackboardDrawing from './BlackboardDrawing'
import CanvasWorld from './CanvasWorld'
import { getDrawingLayout, type DrawingScene } from './blackboard'
import { refineScene } from './sceneLint'
import type { Region, SourceImage } from './types'
import { tl } from '@/i18n/tl'

const SHEET_WIDTH = 1600
const COLUMNS = 2

/**
 * Contact sheet of a guided drawing: one tile per step, each showing only what the student sees at that step
 * (plus faded results of earlier steps). Pure markup, so the reviewer snapshot and the eval harness share it.
 */
export function buildSheet(scene: DrawingScene, regions: Region[], source: string, width: number, height: number): { svg: string; width: number; height: number; issues: string[] } {
  const layout = getDrawingLayout(width, height, scene)
  const pad = Math.max(layout.width, layout.height) * .03
  const worldW = layout.width + pad * 2, worldH = layout.height + pad * 2
  const columns = Math.min(COLUMNS, scene.steps.length)
  const tileW = SHEET_WIDTH / columns, k = tileW / worldW, tileH = worldH * k, caption = 34
  const rows = Math.ceil(scene.steps.length / columns)
  const review = refineScene(scene, regions, layout, k)
  const tiles = scene.steps.map((title, step) => {
    const x = (step % columns) * tileW, y = Math.floor(step / columns) * (tileH + caption)
    return <g key={step}>
      <rect x={x} y={y} width={tileW} height={caption} fill="#1f2a3d" />
      <text x={x + 14} y={y + 23} fontSize={17} fill="#ffffff" fontFamily="ui-sans-serif, system-ui, sans-serif">{tl("Passo {0}/{1} · {2}", step + 1, scene.steps.length, title)}</text>
      <svg x={x} y={y + caption} width={tileW} height={tileH} viewBox={`${-pad} ${-pad} ${worldW} ${worldH}`}>
        <rect x={-pad} y={-pad} width={worldW} height={worldH} fill="#f6f7f9" />
        <CanvasWorld layout={layout} imageUrl={source} />
        <BlackboardDrawing scene={scene} layout={layout} regions={regions} visibleStep={step} image={{ url: source, width, height }} review={review} snapshot />
      </svg>
      <rect x={x} y={y} width={tileW} height={tileH + caption} fill="none" stroke="#ffffff" strokeWidth={4} />
    </g>
  })
  const sheetH = rows * (tileH + caption)
  const svg = renderToStaticMarkup(<svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${SHEET_WIDTH} ${sheetH}`} width={SHEET_WIDTH} height={Math.round(sheetH)}>
    <rect width={SHEET_WIDTH} height={sheetH} fill="#ffffff" />{tiles}
  </svg>)
  const issues = review.issues.map(i => `${i.fixed ? 'corretto' : 'aperto'} · ${i.rule} · ${i.id}: ${i.detail}`)
  return { svg, width: SHEET_WIDTH, height: Math.round(sheetH), issues }
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = src })
}

/** Source downscaled and inlined: an SVG rasterised from <img> cannot fetch blob URLs. */
async function inlineSource(url: string, width: number, height: number): Promise<string> {
  const img = await load(url)
  const k = Math.min(1, 1000 / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * k)); canvas.height = Math.max(1, Math.round(height * k))
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', .88)
}

/** PNG contact sheet of the drawing for the art-direction reviewer, with what the deterministic linter already noticed. */
export async function snapshotDrawing(scene: DrawingScene, regions: Region[], image: SourceImage): Promise<{ png: string; issues: string[] }> {
  const source = await inlineSource(image.url, image.width, image.height)
  const sheet = buildSheet(scene, regions, source, image.width, image.height)
  const img = await load("data:image/svg+xml;charset=utf-8," + encodeURIComponent(sheet.svg))
  const canvas = document.createElement('canvas')
  canvas.width = sheet.width; canvas.height = sheet.height
  canvas.getContext('2d')!.drawImage(img, 0, 0)
  return { png: canvas.toDataURL('image/png'), issues: sheet.issues }
}
