import { useState, useMemo, Suspense, lazy } from 'react'

const Plot = lazy(() => import('react-plotly.js'))

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ColumnMeta {
  name: string
  type: 'numeric' | 'categorical'
}

type DataRow = Record<string, string | number>
type VizMode = 'scatter' | 'regression' | 'kmeans' | 'knn' | 'scatter3d'
type EncodingMap = Record<string, number>   // category → integer

interface Props {
  /** Raw CSV string — parsed internally */
  csvText?: string
  /** Already-parsed rows */
  rows?: DataRow[]
  /** Column metadata */
  columns?: ColumnMeta[]
}

// ─── Palette ─────────────────────────────────────────────────────────────────

const PALETTE = [
  '#7c3aed', '#0ea5e9', '#10b981', '#f59e0b',
  '#ef4444', '#6366f1', '#14b8a6', '#f43f5e', '#84cc16',
]

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCsv(text: string): { rows: DataRow[]; columns: ColumnMeta[] } | null {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return null
  const sep = lines[0].includes(';') ? ';' : ','
  const headers = lines[0].split(sep).map(h => h.trim().replace(/"/g, ''))
  const rows: DataRow[] = []

  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(sep).map(v => v.trim().replace(/"/g, ''))
    if (vals.length !== headers.length) continue
    const row: DataRow = {}
    headers.forEach((h, idx) => {
      const v = vals[idx]
      row[h] = isNaN(Number(v)) || v === '' ? v : Number(v)
    })
    rows.push(row)
  }
  if (rows.length === 0) return null

  const columns: ColumnMeta[] = headers.map(name => {
    const vals = rows.map(r => r[name])
    const numericCount = vals.filter(v => !isNaN(Number(v)) && v !== '').length
    return { name, type: numericCount > vals.length * 0.8 ? 'numeric' : 'categorical' }
  })
  return { rows, columns }
}

// ─── Algorithms ───────────────────────────────────────────────────────────────

function linearRegression(xs: number[], ys: number[]) {
  const n = xs.length
  const sx = xs.reduce((a, b) => a + b, 0)
  const sy = ys.reduce((a, b) => a + b, 0)
  const sxy = xs.reduce((s, x, i) => s + x * ys[i], 0)
  const sxx = xs.reduce((s, x) => s + x * x, 0)
  const denom = n * sxx - sx * sx
  if (denom === 0) return null
  const slope = (n * sxy - sx * sy) / denom
  const intercept = (sy - slope * sx) / n
  const yMean = sy / n
  const ssTot = ys.reduce((s, y) => s + (y - yMean) ** 2, 0)
  const ssRes = xs.reduce((s, x, i) => s + (ys[i] - (slope * x + intercept)) ** 2, 0)
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot
  return { slope, intercept, r2 }
}

function kMeans(
  pts: { x: number; y: number }[],
  k: number,
  maxIter = 120,
): { assignments: number[]; centroids: { x: number; y: number }[] } | null {
  if (pts.length < k || k < 1) return null
  // K-means++ initialization
  const centroids: { x: number; y: number }[] = [{ ...pts[Math.floor(Math.random() * pts.length)] }]
  while (centroids.length < k) {
    const d2 = pts.map(p =>
      Math.min(...centroids.map(c => (p.x - c.x) ** 2 + (p.y - c.y) ** 2))
    )
    const sum = d2.reduce((a, b) => a + b, 0)
    let rand = Math.random() * sum
    let picked = false
    for (let i = 0; i < pts.length; i++) {
      rand -= d2[i]
      if (rand <= 0) { centroids.push({ ...pts[i] }); picked = true; break }
    }
    if (!picked) centroids.push({ ...pts[Math.floor(Math.random() * pts.length)] })
  }

  const assignments = new Array(pts.length).fill(0)
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false
    for (let i = 0; i < pts.length; i++) {
      let minD = Infinity, best = 0
      for (let j = 0; j < k; j++) {
        const d = (pts[i].x - centroids[j].x) ** 2 + (pts[i].y - centroids[j].y) ** 2
        if (d < minD) { minD = d; best = j }
      }
      if (assignments[i] !== best) { assignments[i] = best; changed = true }
    }
    if (!changed) break
    for (let j = 0; j < k; j++) {
      const cl = pts.filter((_, i) => assignments[i] === j)
      if (cl.length > 0) {
        centroids[j].x = cl.reduce((s, p) => s + p.x, 0) / cl.length
        centroids[j].y = cl.reduce((s, p) => s + p.y, 0) / cl.length
      }
    }
  }
  return { assignments, centroids }
}

function knnPredict(
  trainPts: { x: number; y: number }[],
  trainLabels: number[],
  tx: number, ty: number, k: number,
): number {
  const dists = trainPts
    .map((p, i) => ({ d: (p.x - tx) ** 2 + (p.y - ty) ** 2, l: trainLabels[i] }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
  const votes: Record<number, number> = {}
  for (const { l } of dists) votes[l] = (votes[l] || 0) + 1
  return Number(Object.entries(votes).sort((a, b) => b[1] - a[1])[0][0])
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DataVisualizationPanel({ csvText, rows: rowsProp, columns: columnsProp }: Props) {
  const parsed = useMemo(() => {
    if (rowsProp && columnsProp) return { rows: rowsProp, columns: columnsProp }
    if (csvText) return parseCsv(csvText)
    return null
  }, [csvText, rowsProp, columnsProp])

  const rows = parsed?.rows ?? []
  const cols = parsed?.columns ?? []

  const numericCols  = cols.filter(c => c.type === 'numeric').map(c => c.name)
  const catCols      = cols.filter(c => c.type === 'categorical').map(c => c.name)
  const allCols      = cols.map(c => c.name)

  // ── label-encoding state ───────────────────────────────────────────────────
  const [encodedSet, setEncodedSet] = useState<Set<string>>(new Set())

  const toggleEncoding = (col: string) =>
    setEncodedSet(prev => {
      const next = new Set(prev)
      next.has(col) ? next.delete(col) : next.add(col)
      return next
    })

  // Per-column encoding maps  {col → {category → integer}}
  const encodingMaps = useMemo((): Record<string, EncodingMap> => {
    const maps: Record<string, EncodingMap> = {}
    for (const col of encodedSet) {
      const unique = [...new Set(rows.map(r => String(r[col])))].sort()
      maps[col] = Object.fromEntries(unique.map((v, i) => [v, i]))
    }
    return maps
  }, [rows, encodedSet])

  // Rows enriched with encoded columns   (e.g. "species" → "species_enc")
  const effectiveRows = useMemo((): DataRow[] => {
    if (encodedSet.size === 0) return rows
    return rows.map(row => {
      const out: DataRow = { ...row }
      for (const [col, map] of Object.entries(encodingMaps)) {
        out[`${col}_enc`] = map[String(row[col])] ?? 0
      }
      return out
    })
  }, [rows, encodingMaps, encodedSet])

  // Numeric column list extended with encoded columns
  const effectiveNumericCols = useMemo(
    () => [...numericCols, ...[...encodedSet].map(c => `${c}_enc`)],
    [numericCols, encodedSet],
  )

  const [xFeat, setXFeat] = useState(() => numericCols[0] ?? '')
  const [yFeat, setYFeat] = useState(() => numericCols[1] ?? numericCols[0] ?? '')
  const [zFeat, setZFeat] = useState(() => numericCols[2] ?? numericCols[1] ?? numericCols[0] ?? '')
  const [colorFeat, setColorFeat] = useState('')
  const [mode, setMode] = useState<VizMode>('scatter')
  const [kVal, setKVal] = useState(3)

  // Validate selected features against effective (possibly extended) columns
  const safeX = effectiveNumericCols.includes(xFeat) ? xFeat : (effectiveNumericCols[0] ?? '')
  const safeY = effectiveNumericCols.includes(yFeat) ? yFeat : (effectiveNumericCols[1] ?? effectiveNumericCols[0] ?? '')
  const safeZ = effectiveNumericCols.includes(zFeat) ? zFeat : (effectiveNumericCols[2] ?? effectiveNumericCols[1] ?? effectiveNumericCols[0] ?? '')

  // ── core point cloud ───────────────────────────────────────────────────────
  const points = useMemo(
    () =>
      effectiveRows
        .map(row => ({
          x: Number(row[safeX]),
          y: Number(row[safeY]),
          z: Number(row[safeZ]),
          label: colorFeat ? String(row[colorFeat]) : '',
        }))
        .filter(p => isFinite(p.x) && isFinite(p.y)),
    [effectiveRows, safeX, safeY, safeZ, colorFeat],
  )

  const xVals = points.map(p => p.x)
  const yVals = points.map(p => p.y)
  const zVals = points.map(p => p.z)
  const labelVals = points.map(p => p.label)
  const uniqueLabels = useMemo(() => [...new Set(labelVals)].filter(Boolean), [labelVals])
  const labelToIdx = useMemo(
    () => Object.fromEntries(uniqueLabels.map((l, i) => [l, i])),
    [uniqueLabels],
  )

  // ── scatter traces ─────────────────────────────────────────────────────────
  const scatterTraces = useMemo((): object[] => {
    if (colorFeat && uniqueLabels.length > 0 && uniqueLabels.length <= 20) {
      return uniqueLabels.map((lbl, i) => {
        const pts = points.filter(p => p.label === lbl)
        return {
          type: 'scatter', mode: 'markers', name: lbl,
          x: pts.map(p => p.x), y: pts.map(p => p.y),
          marker: { color: PALETTE[i % PALETTE.length], size: 7, opacity: 0.85, line: { width: 0.5, color: '#fff' } },
        }
      })
    }
    // Single-color scatter (no class or too many classes)
    const markerColor = colorFeat && uniqueLabels.length > 20
      ? xVals.map((_, i) => i)  // gradient by index when too many classes
      : PALETTE[0]
    return [{
      type: 'scatter', mode: 'markers', name: 'Dati',
      x: xVals, y: yVals,
      marker: {
        color: markerColor,
        ...(typeof markerColor !== 'string' ? { colorscale: 'Viridis', showscale: false } : {}),
        size: 7, opacity: 0.85, line: { width: 0.5, color: '#fff' },
      },
    }]
  }, [points, colorFeat, uniqueLabels, xVals, yVals])

  // ── regression ────────────────────────────────────────────────────────────
  const regResult = useMemo(
    () => (mode === 'regression' ? linearRegression(xVals, yVals) : null),
    [mode, xVals, yVals],
  )
  const regTrace = useMemo((): object | null => {
    if (!regResult) return null
    const xMin = Math.min(...xVals), xMax = Math.max(...xVals)
    const pad = (xMax - xMin) * 0.05
    return {
      type: 'scatter', mode: 'lines',
      name: `y = ${regResult.slope.toFixed(3)}x + ${regResult.intercept.toFixed(3)} (R²=${regResult.r2.toFixed(3)})`,
      x: [xMin - pad, xMax + pad],
      y: [(xMin - pad) * regResult.slope + regResult.intercept, (xMax + pad) * regResult.slope + regResult.intercept],
      line: { color: '#ef4444', width: 2.5, dash: 'dash' },
    }
  }, [regResult, xVals])

  // ── k-means ───────────────────────────────────────────────────────────────
  const kmeansResult = useMemo(
    () => (mode === 'kmeans' ? kMeans(points, kVal) : null),
    [mode, points, kVal],
  )
  const kmeansTraces = useMemo((): object[] => {
    if (!kmeansResult) return []
    const { assignments, centroids } = kmeansResult
    const clusterTraces = centroids.map((_, j) => {
      const cl = points.filter((__, i) => assignments[i] === j)
      return {
        type: 'scatter', mode: 'markers', name: `Cluster ${j + 1}`,
        x: cl.map(p => p.x), y: cl.map(p => p.y),
        marker: { color: PALETTE[j % PALETTE.length], size: 7, opacity: 0.85 },
      }
    })
    return [
      ...clusterTraces,
      {
        type: 'scatter', mode: 'markers', name: 'Centroidi',
        x: centroids.map(c => c.x), y: centroids.map(c => c.y),
        marker: {
          symbol: 'star', size: 18,
          color: centroids.map((_, j) => PALETTE[j % PALETTE.length]),
          line: { color: '#fff', width: 1.5 },
        },
      },
    ]
  }, [kmeansResult, points])

  // ── k-nn boundary ─────────────────────────────────────────────────────────
  const canKNN = colorFeat !== '' && uniqueLabels.length >= 2 && uniqueLabels.length <= 10

  const knnBgTraces = useMemo((): object[] => {
    if (mode !== 'knn' || !canKNN || points.length === 0) return []
    const numericLabels = points.map(p => labelToIdx[p.label] ?? 0)
    const xMin = Math.min(...xVals), xMax = Math.max(...xVals)
    const yMin = Math.min(...yVals), yMax = Math.max(...yVals)
    const xPad = (xMax - xMin) * 0.12, yPad = (yMax - yMin) * 0.12
    const G = 40
    const gxs = Array.from({ length: G }, (_, i) => xMin - xPad + (xMax - xMin + 2 * xPad) * i / (G - 1))
    const gys = Array.from({ length: G }, (_, i) => yMin - yPad + (yMax - yMin + 2 * yPad) * i / (G - 1))

    const bgByClass: { gx: number[]; gy: number[] }[] = uniqueLabels.map(() => ({ gx: [], gy: [] }))
    for (const gy of gys) {
      for (const gx of gxs) {
        const pred = knnPredict(points, numericLabels, gx, gy, kVal)
        const entry = bgByClass[pred]
        if (entry) { entry.gx.push(gx); entry.gy.push(gy) }
      }
    }
    return bgByClass.map((pts, classIdx) => ({
      type: 'scatter', mode: 'markers',
      x: pts.gx, y: pts.gy,
      marker: { color: PALETTE[classIdx % PALETTE.length], size: 10, opacity: 0.18, symbol: 'square' },
      showlegend: false, hoverinfo: 'skip',
      name: `knn_bg_${classIdx}`,
    }))
  }, [mode, canKNN, points, kVal, uniqueLabels, labelToIdx, xVals, yVals])

  // ── scatter 3D ────────────────────────────────────────────────────────────
  const scatter3dTraces = useMemo((): object[] => {
    if (mode !== 'scatter3d') return []
    if (colorFeat && uniqueLabels.length > 0 && uniqueLabels.length <= 20) {
      return uniqueLabels.map((lbl, i) => {
        const pts = points.filter(p => p.label === lbl)
        return {
          type: 'scatter3d', mode: 'markers', name: lbl,
          x: pts.map(p => p.x), y: pts.map(p => p.y), z: pts.map(p => p.z),
          marker: { color: PALETTE[i % PALETTE.length], size: 5, opacity: 0.85 },
        }
      })
    }
    return [{
      type: 'scatter3d', mode: 'markers', name: 'Dati',
      x: xVals, y: yVals, z: zVals,
      marker: { color: zVals, colorscale: 'Viridis', size: 5, opacity: 0.85, showscale: true },
    }]
  }, [mode, points, colorFeat, uniqueLabels, xVals, yVals, zVals])

  // ── compose final traces ──────────────────────────────────────────────────
  const traces = useMemo((): object[] => {
    if (mode === 'scatter3d') return scatter3dTraces
    if (mode === 'kmeans') return kmeansTraces
    if (mode === 'regression') return [...scatterTraces, ...(regTrace ? [regTrace] : [])]
    if (mode === 'knn') return [...knnBgTraces, ...scatterTraces]
    return scatterTraces
  }, [mode, scatter3dTraces, kmeansTraces, scatterTraces, regTrace, knnBgTraces])

  // ── layout ────────────────────────────────────────────────────────────────
  const layout = useMemo(() => {
    const base = {
      height: 420,
      margin: { l: 65, r: 30, t: 30, b: 60 },
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: '#f8fafc',
      font: { family: 'Inter, ui-sans-serif, sans-serif', size: 12 },
      legend: { font: { size: 11 } },
    }
    if (mode === 'scatter3d') {
      return {
        ...base,
        scene: {
          xaxis: { title: safeX },
          yaxis: { title: safeY },
          zaxis: { title: safeZ },
        },
      }
    }
    return {
      ...base,
      xaxis: { title: safeX, gridcolor: '#e2e8f0', zeroline: false, automargin: true },
      yaxis: { title: safeY, gridcolor: '#e2e8f0', zeroline: false, automargin: true },
    }
  }, [mode, safeX, safeY, safeZ])

  if (rows.length === 0) return null
  if (numericCols.length === 0 && catCols.length === 0) {
    return (
      <div className="mt-4 border border-violet-200 rounded-xl bg-white p-4 text-sm text-slate-500 text-center">
        Nessuna colonna trovata nel dataset.
      </div>
    )
  }
  if (effectiveNumericCols.length === 0) {
    return (
      <div className="mt-4 border border-violet-200 rounded-xl bg-white p-4 space-y-3">
        <p className="text-sm text-slate-600 font-medium">
          Dataset interamente categorico — codifica almeno una colonna per visualizzarla:
        </p>
        <div className="flex flex-wrap gap-2">
          {catCols.map(col => (
            <button
              key={col}
              onClick={() => toggleEncoding(col)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                encodedSet.has(col)
                  ? 'bg-violet-600 text-white border-violet-600'
                  : 'bg-white text-violet-700 border-violet-300 hover:bg-violet-50'
              }`}
            >
              {encodedSet.has(col) ? `✓ ${col}_enc` : `+ ${col}`}
            </button>
          ))}
        </div>
      </div>
    )
  }

  const modeLabels: Record<VizMode, string> = {
    scatter: '● Scatter',
    regression: '↗ Regressione',
    kmeans: '⬡ K-means',
    knn: '◈ K-NN Boundary',
    scatter3d: '⬢ 3D',
  }

  return (
    <div className="mt-4 border border-violet-200 rounded-xl bg-white overflow-hidden shadow-sm">
      {/* ── header / controls ── */}
      <div className="bg-violet-50 px-4 py-3 border-b border-violet-100 space-y-3">
        <p className="text-xs font-semibold text-violet-800 tracking-wide uppercase">
          Esplorazione Dati — {rows.length} campioni · {numericCols.length} num
          {catCols.length > 0 && ` · ${catCols.length} cat`}
          {encodedSet.size > 0 && ` · ${encodedSet.size} codificate`}
        </p>

        {/* ── label encoding section (shown only when there are categorical cols) ── */}
        {catCols.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs text-violet-600 font-medium">
              Encoding (Label) — attiva per usare colonne categoriche sugli assi:
            </p>
            <div className="flex flex-wrap gap-1.5">
              {catCols.map(col => {
                const active = encodedSet.has(col)
                const map    = encodingMaps[col]
                return (
                  <div key={col} className="flex flex-col gap-0.5">
                    <button
                      onClick={() => toggleEncoding(col)}
                      className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${
                        active
                          ? 'bg-violet-600 text-white border-violet-600'
                          : 'bg-white text-violet-600 border-violet-300 hover:bg-violet-50'
                      }`}
                    >
                      {active ? `✓ ${col}_enc` : `+ ${col}`}
                    </button>
                    {active && map && (
                      <div className="text-[10px] text-slate-500 leading-tight pl-1 max-w-[160px]">
                        {Object.entries(map).slice(0, 6).map(([v, i]) => `${v}=${i}`).join(', ')}
                        {Object.keys(map).length > 6 && ' …'}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* feature selectors */}
        <div className="flex flex-wrap gap-3">
          {[
            { label: 'Asse X', val: safeX, set: setXFeat },
            { label: 'Asse Y', val: safeY, set: setYFeat },
            ...(mode === 'scatter3d' ? [{ label: 'Asse Z', val: safeZ, set: setZFeat }] : []),
          ].map(({ label, val, set }) => (
            <label key={label} className="flex items-center gap-1.5 text-xs text-violet-700">
              <span className="font-medium">{label}:</span>
              <select
                value={val}
                onChange={e => set(e.target.value)}
                className="border border-violet-200 rounded px-2 py-0.5 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
              >
                {effectiveNumericCols.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          ))}
          {mode !== 'scatter3d' && mode !== 'kmeans' && (
            <label className="flex items-center gap-1.5 text-xs text-violet-700">
              <span className="font-medium">Colore per:</span>
              <select
                value={colorFeat}
                onChange={e => setColorFeat(e.target.value)}
                className="border border-violet-200 rounded px-2 py-0.5 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-violet-400"
              >
                <option value="">— nessuno —</option>
                {allCols.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          )}
        </div>

        {/* mode tabs + K slider */}
        <div className="flex flex-wrap items-center gap-1.5">
          {(Object.keys(modeLabels) as VizMode[]).map(m => {
            const disabled =
              (m === 'knn' && !canKNN) ||
              (m === 'scatter3d' && effectiveNumericCols.length < 3)
            return (
              <button
                key={m}
                disabled={disabled}
                onClick={() => setMode(m)}
                title={
                  m === 'knn' && !canKNN
                    ? 'Seleziona una colonna per "Colore per" con 2–10 classi'
                    : m === 'scatter3d' && effectiveNumericCols.length < 3
                    ? 'Servono almeno 3 colonne numeriche (o codifica colonne categoriche)'
                    : ''
                }
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  mode === m
                    ? 'bg-violet-600 text-white shadow'
                    : disabled
                    ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    : 'bg-white text-violet-700 border border-violet-200 hover:bg-violet-50'
                }`}
              >
                {modeLabels[m]}
              </button>
            )
          })}
          {(mode === 'kmeans' || mode === 'knn') && (
            <label className="flex items-center gap-2 ml-2 text-xs text-violet-700 font-medium">
              K = {kVal}
              <input
                type="range"
                min={2}
                max={Math.min(8, Math.max(2, Math.floor(points.length / 3)))}
                value={kVal}
                onChange={e => setKVal(Number(e.target.value))}
                className="w-24 accent-violet-600"
              />
            </label>
          )}
        </div>
      </div>

      {/* ── info bar ── */}
      {mode === 'regression' && regResult && (
        <div className="px-4 py-1.5 bg-red-50 border-b border-red-100 text-xs text-red-700 flex gap-5 font-mono">
          <span>ŷ = {regResult.slope.toFixed(4)}·x + {regResult.intercept.toFixed(4)}</span>
          <span>R² = {regResult.r2.toFixed(4)}</span>
        </div>
      )}
      {mode === 'knn' && !canKNN && (
        <div className="px-4 py-1.5 bg-amber-50 border-b border-amber-100 text-xs text-amber-700">
          ⚠️ Seleziona una colonna in <em>Colore per</em> con 2–10 classi per attivare K-NN.
        </div>
      )}
      {mode === 'kmeans' && (
        <div className="px-4 py-1.5 bg-violet-50 border-b border-violet-100 text-xs text-violet-700">
          K-means++ — {kVal} cluster su {points.length} punti
        </div>
      )}

      {/* ── plot ── */}
      <div className="p-3">
        <Suspense fallback={
          <div className="h-96 flex items-center justify-center text-slate-400 text-sm animate-pulse">
            Caricamento grafico…
          </div>
        }>
          <Plot
            data={traces as any}
            layout={layout as any}
            config={{
              responsive: true,
              displayModeBar: true,
              displaylogo: false,
            }}
            style={{ width: '100%', height: '420px' }}
            useResizeHandler
          />
        </Suspense>
      </div>
    </div>
  )
}
