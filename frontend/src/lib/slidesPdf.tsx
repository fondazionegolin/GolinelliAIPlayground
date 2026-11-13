import { createRoot } from 'react-dom/client'
import { SlidePreview } from '@/components/documents/DocumentThumbnail'
import type { SlideBlock } from '@/components/SlideEditor'
import { ensureSlideFonts } from '@/lib/slideFonts'

type PdfSlide = { id?: string; title?: string; blocks?: SlideBlock[]; backgroundColor?: string }

const DIMENSIONS = { '16:9': { width: 960, height: 540 }, '4:3': { width: 800, height: 600 } }

const wait = (ms: number) => new Promise<void>(resolve => window.setTimeout(resolve, ms))

/**
 * Exports a deck to PDF through the browser's own print engine, drawing every page with the very same
 * renderer as the full-screen presenter (`SlidePreview`): same layering, titles, images, fonts and colours.
 * One slide per page, vector text, no server-side re-interpretation of the deck.
 */
export async function printSlidesAsPdf(slides: PdfSlide[], format: '16:9' | '4:3', title: string): Promise<void> {
  if (!slides.length) throw new Error('Nessuna slide da esportare')
  const { width, height } = DIMENSIONS[format] ?? DIMENSIONS['16:9']

  // Web fonts requested by the deck must be in the main document's <head> before it is cloned below.
  slides.forEach(slide => ensureSlideFonts(slide.blocks || []))
  await Promise.race([document.fonts.ready, wait(2500)])

  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;border:0;opacity:0;pointer-events:none;`
  document.body.appendChild(iframe)
  const doc = iframe.contentDocument
  const win = iframe.contentWindow
  if (!doc || !win) { iframe.remove(); throw new Error('Esportazione PDF non disponibile') }

  doc.open()
  doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>')
  doc.close()
  doc.title = title
  // Same stylesheets as the app (Tailwind utilities, fonts) so the slides look exactly as in the presenter.
  document.head.querySelectorAll('link[rel="stylesheet"], style').forEach(node => doc.head.appendChild(node.cloneNode(true)))
  const printStyle = doc.createElement('style')
  printStyle.textContent = `
    @page { size: ${width}px ${height}px; margin: 0; }
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; width: ${width}px; }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; animation: none !important; transition: none !important; }
    .pdf-page { position: relative; width: ${width}px; height: ${height}px; overflow: hidden; break-inside: avoid; page-break-after: always; break-after: page; }
    .pdf-page:last-child { page-break-after: auto; break-after: auto; }
  `
  doc.head.appendChild(printStyle)

  const container = doc.createElement('div')
  doc.body.appendChild(container)
  const root = createRoot(container)
  root.render(
    <>
      {slides.map((slide, index) => (
        <div key={slide.id || index} className="pdf-page">
          <SlidePreview content={{ format, slides: [slide] }} title={slide.title || title} backdrop="bg-white" />
        </div>
      ))}
    </>,
  )

  const cleanup = () => { root.unmount(); iframe.remove() }
  try {
    // Wait for layout, then for every image and font to be ready.
    await wait(300)
    // Images below the first page would stay unloaded (lazy) in this off-screen frame.
    Array.from(doc.images).forEach(image => { image.loading = 'eager' })
    const deadline = Date.now() + 15000
    const pending = () => Array.from(doc.images).filter(image => !image.complete)
    while (pending().length && Date.now() < deadline) await wait(150)
    await Promise.all(Array.from(doc.images).map(image => image.decode().catch(() => undefined)))
    await Promise.race([doc.fonts.ready, wait(2500)])
    await wait(200)

    await new Promise<void>(resolve => {
      win.addEventListener('afterprint', () => resolve(), { once: true })
      win.focus()
      win.print()
      // Browsers without afterprint still release the hidden frame.
      window.setTimeout(resolve, 120000)
    })
  } finally {
    cleanup()
  }
}
