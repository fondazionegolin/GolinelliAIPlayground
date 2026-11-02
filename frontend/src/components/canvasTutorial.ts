/**
 * The built-in tutorial: a row of numbered stations laid out on the board itself, joined by arrows, with live examples
 * (shapes, an annotated image, a formula, a graph, an animation) and empty frames to try things in.
 */
import type { CanvasItem } from './CollaborativeCanvas'
import { DEMOS } from './motion/library'

const STATION_W = 620
const STATION_H = 540
const GAP = 140

export const TUTORIAL_SIZE = { w: 8 * STATION_W + 7 * GAP, h: STATION_H }
export const TUTORIAL_TITLE = 'Guida alle lavagne intelligenti'

const id = () => crypto.randomUUID()
const style = (fontSize = 15, fontWeight: 'normal' | '600' = 'normal') => ({ fontFamily: 'Inter, system-ui, sans-serif', fontSize, fontWeight, fontStyle: 'normal' as const })

/** A right triangle with its sides unlabelled: the example for "attach an image" and its annotations. */
const TRIANGLE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="300" viewBox="0 0 480 300"><rect width="480" height="300" fill="#f8fafc"/>
<polygon points="60,250 380,250 380,60" fill="#dbeafe" stroke="#1e3a8a" stroke-width="4"/><rect x="352" y="222" width="28" height="28" fill="none" stroke="#1e3a8a" stroke-width="3"/>
<text x="220" y="282" font-size="22" fill="#334155" font-family="sans-serif">cateto</text><text x="392" y="160" font-size="22" fill="#334155" font-family="sans-serif">cateto</text>
<text x="170" y="140" font-size="22" fill="#334155" font-family="sans-serif" transform="rotate(-30 170 140)">ipotenusa</text></svg>`
const TRIANGLE_SRC = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(TRIANGLE_SVG)}`

export function buildTutorial(origin: { x: number; y: number }): CanvasItem[] {
  const items: CanvasItem[] = []
  const add = (item: unknown) => { items.push(item as CanvasItem); return (item as CanvasItem).id }

  const textHeight = (t: string, size: number, w: number) =>
    Math.ceil(t.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil((line.length * size * 0.54) / Math.max(w - 20, 40))), 0) * size * 1.5 + 18)
  const text = (x: number, y: number, w: number, t: string, size = 15, color = '#334155', weight: 'normal' | '600' = 'normal') =>
    add({ id: id(), type: 'text', x, y, w, h: textHeight(t, size, w), text: t, color, textStyle: style(size, weight) })
  const note = (x: number, y: number, w: number, h: number, t: string, color = '#fef9c3') =>
    add({ id: id(), type: 'postit', x, y, w, h, text: t, color, textStyle: style(14) })
  const frame = (x: number, y: number, w: number, h: number, title: string, color: string, dashed = false, solidBg = '#ffffffee') =>
    add({ id: id(), type: 'frame', x, y, w, h, text: title, color, backgroundColor: solidBg, borderWidth: 2, borderStyle: dashed ? 'dashed' : 'solid', textStyle: style(14, '600') })
  const shape = (x: number, y: number, w: number, h: number, kind: string, label: string, fill: string, stroke: string) =>
    add({ id: id(), type: 'shape', shape: kind, x, y, w, h, fill, stroke, borderWidth: 2.5, borderStyle: 'solid', text: label, textColor: '#171717', textStyle: style(15) })

  const stations: string[] = []
  const station = (n: number, title: string, color: string) => {
    const x = origin.x + (n - 1) * (STATION_W + GAP), y = origin.y
    const fid = frame(x, y, STATION_W, STATION_H, `${n} · ${title}`, color)
    stations.push(fid)
    return { x, y, fid }
  }

  // 1 ─ Welcome
  {
    const s = station(1, 'Benvenuto', '#e85c8d')
    text(s.x + 24, s.y + 52, 570, 'Lavagna intelligente', 24, '#1a1a2e', '600')
    text(s.x + 24, s.y + 96, 570, 'Uno spazio infinito dove disegni, scrivi, incolli immagini e formule, con un assistente AI che legge tutto quello che c’è sulla lavagna.', 16)
    text(s.x + 24, s.y + 190, 570, '• Zoom: rotella del mouse (o pizzico sul touch)\n• Spostare la vista: tieni premuta la barra spaziatrice e trascina, oppure lo strumento H\n• In basso a destra la mappa mostra dove sei: clicca per saltare in un punto\n• Ctrl+Z annulla, Ctrl+Y ripete', 15)
    note(s.x + 24, s.y + 380, 270, 110, 'Ogni riquadro è una tappa. Segui le frecce → verso destra.', '#fce7f3')
    note(s.x + 320, s.y + 380, 270, 110, 'Puoi sempre cancellare questa guida: selezionala e premi Elimina.', '#e0f2fe')
  }

  // 2 ─ Tools
  {
    const s = station(2, 'Gli strumenti', '#6366f1')
    text(s.x + 24, s.y + 52, 570, 'A sinistra trovi gli strumenti. Le scorciatoie in breve:', 16, '#1a1a2e', '600')
    text(s.x + 24, s.y + 90, 570, 'V seleziona · G manina (sposta gli elementi selezionati) · H sposta la vista\nP post-it · T testo · F sezione · R / O forme · L linea · A freccia\nD penna · M formula · C collega due elementi', 14)
    const a = shape(s.x + 40, s.y + 190, 130, 70, 'rounded-rect', 'Idea', '#dbeafe', '#1e3a8a')
    const b = shape(s.x + 240, s.y + 190, 130, 70, 'ellipse', 'Dubbio', '#fef9c3', '#854d0e')
    const c = shape(s.x + 440, s.y + 180, 130, 90, 'diamond', 'Scelta', '#dcfce7', '#166534')
    add({ id: id(), type: 'connector', fromId: a, fromAnchor: 'right', toId: b, toAnchor: 'left', color: '#475569', width: 2 })
    add({ id: id(), type: 'connector', fromId: b, fromAnchor: 'right', toId: c, toAnchor: 'left', color: '#475569', width: 2 })
    text(s.x + 24, s.y + 290, 570, 'Prova: trascina una forma, ridimensionala dal quadratino, doppio clic per scrivere dentro. Con la manina (G) sposti più elementi insieme.', 14)
    frame(s.x + 24, s.y + 370, 570, 130, 'Prova qui', '#94a3b8', true, '#ffffff99')
  }

  // 3 ─ Images
  {
    const s = station(3, 'Allegare un’immagine', '#0d9488')
    text(s.x + 24, s.y + 52, 570, 'Incolla uno screenshot con Ctrl+V, oppure trascina un file (PNG, JPG) sulla lavagna: compare al centro della vista e lo sposti e ridimensioni come vuoi.', 15)
    const imgX = s.x + 40, imgY = s.y + 140, w = 360, h = 225, k = w / 480
    add({ id: id(), type: 'image', x: imgX, y: imgY, w, h, src: TRIANGLE_SRC })
    // what the assistant's annotations look like
    add({ id: id(), type: 'shape', shape: 'rect', x: imgX + 330 * k, y: imgY + 205 * k, w: 70 * k, h: 70 * k, fill: '#facc15', fillOpacity: 0.3, stroke: '#dc2626', borderWidth: 2.5, borderStyle: 'solid', text: '', textColor: '#171717', textStyle: style(14) })
    add({ id: id(), type: 'shape', shape: 'ellipse', x: imgX + 330 * k + 78 * k, y: imgY + 180 * k, w: 26, h: 26, fill: '#dc2626', stroke: '#dc2626', borderWidth: 1, borderStyle: 'solid', text: '1', textColor: '#ffffff', textStyle: style(14, '600') })
    add({ id: id(), type: 'line', x: imgX + 100 * k, y: imgY + 40 * k, w: 70, h: 50, arrow: true, color: '#dc2626', width: 3 })
    text(imgX + 0, imgY + 4, 120, 'ipotenusa', 14, '#dc2626', '600')
    note(s.x + 420, s.y + 150, 175, 130, '1 = l’angolo retto, evidenziato dall’assistente.', '#fef9c3')
    text(s.x + 24, s.y + 385, 570, 'Poi chiedi: «Evidenzia l’ipotenusa e numera i lati». L’assistente marca le parti con riquadri trasparenti, frecce e numeri, e li puoi spostare.', 14)
    frame(s.x + 420, s.y + 300, 175, 70, 'Incolla qui (Ctrl+V)', '#94a3b8', true, '#ffffff99')
  }

  // 4 ─ Assistant
  {
    const s = station(4, 'Aprire l’assistente', '#e85c8d')
    shape(s.x + 24, s.y + 56, 190, 48, 'rounded-rect', '✦ Assistente', '#e85c8d', '#be185d')
    text(s.x + 232, s.y + 56, 370, 'In alto a destra della lavagna: apre e chiude la chat laterale.', 15, '#1a1a2e', '600')
    text(s.x + 24, s.y + 130, 570, '• Scrivi la richiesta e premi Invio (Maiusc+Invio per andare a capo)\n• L’assistente vede l’intera lavagna, le immagini incollate, le formule e quello che hai modificato dall’ultima volta\n• Seleziona un elemento prima di scrivere per dire di cosa parli: i contenuti nuovi compaiono accanto a lui\n• Ctrl+Z annulla ciò che ha disegnato', 15)
    note(s.x + 24, s.y + 400, 270, 100, 'Le risposte lunghe vengono scritte nel pannello; i disegni sulla lavagna.', '#e0f2fe')
    note(s.x + 320, s.y + 400, 270, 100, 'Agli studenti l’assistente si attiva quando il docente permette di modificare la lavagna.', '#fce7f3')
  }

  // 5 ─ Questions
  {
    const s = station(5, 'Che domande fare', '#f59e0b')
    const groups: Array<[string, string, string, string]> = [
      ['Capire', 'Cosa vedi sulla lavagna?', 'Spiegami questa immagine passo passo', '#dbeafe'],
      ['Annotare', 'Evidenzia le parti importanti dell’immagine', 'Numera i componenti e dammi una legenda', '#dcfce7'],
      ['Matematica', 'Risolvi passo passo la formula selezionata', 'Disegna il grafico di y = x² − 4', '#fef9c3'],
      ['Organizzare', 'Riassumi tutto in uno schema', 'Cosa ho cambiato finora?', '#fce7f3'],
    ]
    groups.forEach(([name, q1, q2, color], i) => {
      const gx = s.x + 24 + (i % 2) * 295, gy = s.y + 56 + Math.floor(i / 2) * 200
      text(gx, gy, 270, name, 17, '#1a1a2e', '600')
      note(gx, gy + 36, 270, 68, `«${q1}»`, color)
      note(gx, gy + 112, 270, 68, `«${q2}»`, color)
    })
    text(s.x + 24, s.y + 465, 570, 'Più sei preciso, meglio risponde: dì cosa vuoi ottenere e per chi (es. «per una classe seconda»).', 14, '#854d0e')
  }

  // 6 ─ Formulas & graphs
  {
    const s = station(6, 'Formule e grafici', '#2563eb')
    add({ id: id(), type: 'formula', x: s.x + 24, y: s.y + 52, w: 250, h: 84, latex: 'y=x^{2}-4', src: 'y = x^2 - 4', fontSize: 30, color: '#0f172a' })
    add({ id: id(), type: 'plot', x: s.x + 290, y: s.y + 52, w: 310, h: 250, expr: 'x^2 - 4', xMin: -4, xMax: 4, yMin: -6, yMax: 12, color: '#dc2626', title: 'y = x² − 4', marks: [{ x: 0, y: -4, label: 'V(0, −4)' }, { x: 2, y: 0, label: '(2, 0)' }, { x: -2, y: 0, label: '(−2, 0)' }] })
    text(s.x + 24, s.y + 150, 250, '← doppio clic: la scrivi come a mano (y = x^2 - 4) o in LaTeX, con la tavolozza dei simboli', 13)
    text(s.x + 24, s.y + 315, 570, '• «Disegna il grafico» (nell’editor o nella barra) crea il grafico accanto, già con la finestra giusta\n• «Risolvi con l’assistente» scrive i passaggi come formule, una sotto l’altra\n• Un testo come «y=3x^2+3» diventa formula con «Trasforma in formula»\n• Il grafico si ricalcola se lo ridimensioni', 14)
  }

  // 7 ─ Explanations & animations
  {
    const s = station(7, 'Spiegazioni e animazioni', '#7c3aed')
    const demo = DEMOS.find((d) => d.key === 'enzyme') || DEMOS[0]
    add({ id: id(), type: 'animation', x: s.x + 24, y: s.y + 52, w: 320, h: 180, scene: demo.scene })
    text(s.x + 360, s.y + 48, 240, 'Passa il mouse sull’animazione: pausa, scorrimento, velocità.', 14, '#5b21b6', '600')
    text(s.x + 24, s.y + 244, 365, 'L’assistente può oggi:\n• spiegare con testi, schemi e frecce collegate\n• annotare immagini e scrivere formule\n• tracciare grafici di funzioni\n• creare animazioni scientifiche: chimica, biochimica, fisica, astronomia', 14)
    text(s.x + 24, s.y + 395, 570, 'Per un’animazione scrivi: «Fammi un’animazione di come un enzima abbassa l’energia di attivazione». Servono circa 1-2 minuti. Poi: «rallenta», «aggiungi le etichette». Il pulsante «Animazioni» nella barra apre esempi pronti.', 14)
    note(s.x + 410, s.y + 262, 185, 90, 'In arrivo: modelli 3D interattivi ed esportazione video.', '#e0f2fe')
  }

  // 8 ─ Together
  {
    const s = station(8, 'Lavorare insieme', '#16a34a')
    text(s.x + 24, s.y + 52, 570, 'Se la lavagna è condivisa con una sessione:', 16, '#1a1a2e', '600')
    text(s.x + 24, s.y + 90, 570, '• In alto vedi le icone di chi è connesso: un clic porta al suo cursore\n• I cursori degli altri hanno il loro nome\n• Il docente decide con un interruttore se gli studenti possono modificare\n• Col tasto destro, il docente usa «Richiama gli studenti qui» per portare tutti sullo stesso punto\n• Quando gli studenti possono modificare, hanno anche l’assistente', 15)
    note(s.x + 24, s.y + 360, 570, 100, 'Fatto! Ora prova: incolla un’immagine, apri l’assistente e chiedi «Cosa vedi?». Puoi eliminare questa guida quando vuoi, o riaprirla dal pulsante «Guida».', '#dcfce7')
  }

  // Children belong to the smallest frame around their centre, so moving a station moves what is inside it.
  const frames = items.filter((i) => i.type === 'frame') as Array<Extract<CanvasItem, { type: 'frame' }>>
  items.forEach((item, index) => {
    if (item.type === 'frame' && stations.includes(item.id)) return
    if (item.type === 'connector') return
    const b = item as { x: number; y: number; w: number; h: number }
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2
    const parent = frames.filter((f) => f.id !== item.id && cx > f.x && cx < f.x + f.w && cy > f.y && cy < f.y + f.h && f.w * f.h > b.w * b.h).sort((a, c) => a.w * a.h - c.w * c.h)[0]
    if (parent) items[index] = { ...item, parentFrameId: parent.id } as CanvasItem
  })

  // Arrows between stations
  for (let i = 0; i < stations.length - 1; i += 1) {
    add({ id: id(), type: 'connector', fromId: stations[i], fromAnchor: 'right', toId: stations[i + 1], toAnchor: 'left', color: '#e85c8d', width: 4 })
  }
  return items
}
