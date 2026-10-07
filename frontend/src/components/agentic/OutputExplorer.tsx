import { Fragment, lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { BarChart3, Braces, Check, Copy, Download, FileSpreadsheet, Gauge, RotateCcw, X } from '@/components/icons'
import { Button } from '@/design'

export type TableValue = { columns?: string[]; rows: Array<Record<string, unknown>>; rowCount?: number }
export type PlotValue = { kind: 'scatter' | 'histogram' | 'scatter3d'; x: number[]; xEnd?: number[]; y: number[]; z?: number[]; color?: unknown[]; labels?: Record<string, string>; title?: string }

export type ExplorerTarget =
  | { kind: 'plot'; title: string; plot: PlotValue }
  | { kind: 'metrics'; title: string; metrics: Record<string, unknown> }
  | { kind: 'raw'; title: string; value: unknown }

export function isTable(value: unknown): value is TableValue { return Boolean(value && typeof value === 'object' && Array.isArray((value as TableValue).rows)) }
export function isPlot(value: unknown): value is PlotValue { return Boolean(value && typeof value === 'object' && ['scatter', 'histogram', 'scatter3d'].includes(String((value as PlotValue).kind)) && Array.isArray((value as PlotValue).x) && Array.isArray((value as PlotValue).y)) }
export function formatCompact(value: unknown) { if (value === null || value === undefined || value === '') return '—'; if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(3); if (typeof value === 'object') return JSON.stringify(value); return String(value) }

const Plot = lazy(() => import('react-plotly.js'))

const PALETTES: Record<string, string[]> = {
  Piattaforma: ['#7c3aed', '#06b6d4', '#f59e0b', '#f43f5e', '#22c55e', '#3b82f6', '#a855f7', '#737373'],
  Tenue: ['#737373', '#a3a3a3', '#0ea5e9', '#14b8a6', '#f472b6', '#fb923c', '#a78bfa', '#525252'],
  Contrasto: ['#111827', '#dc2626', '#2563eb', '#16a34a', '#d97706', '#9333ea', '#0891b2', '#be185d'],
}

const METRIC_LABELS: Record<string, string> = { clusters: 'Cluster', rows: 'Righe', inertia: 'Inerzia', silhouette: 'Silhouette', davies_bouldin: 'Davies–Bouldin', r2: 'R²', rmse: 'RMSE', mae: 'MAE', accuracy: 'Accuracy', precision: 'Precisione', recall: 'Recall', f1: 'F1', cv_mean: 'CV media' }

/** Full-screen, operational explorer for any node output that is not a table (tables open in the spreadsheet). */
export function OutputExplorerModal({ target, onClose, onOpenTable }: { target: ExplorerTarget; onClose: () => void; onOpenTable: (title: string, table: TableValue) => void }) {
  useEffect(() => {
    // Esc closes only when no spreadsheet opened from here is stacked on top.
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.querySelector('[data-modal-stack]')) onClose() }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [onClose])
  const Icon = target.kind === 'plot' ? BarChart3 : target.kind === 'metrics' ? Gauge : Braces
  const subtitle = target.kind === 'plot' ? 'Explorer interattivo del grafico' : target.kind === 'metrics' ? 'Metriche calcolate dal nodo' : 'Output completo del nodo'
  return <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/60 p-2 backdrop-blur-sm md:p-5" role="dialog" aria-modal="true" aria-label={target.title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <div className="flex h-[96vh] w-[98vw] max-w-[1800px] flex-col overflow-hidden rounded-2xl bg-neutral-100 shadow-2xl">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-5 py-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><Icon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-black">{target.title}</h2><p className="text-[10px] text-slate-500">{subtitle} · Esc per chiudere</p></div>
        <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-100" aria-label="Chiudi"><X className="h-4 w-4" /></button>
      </header>
      <div className="min-h-0 flex-1">
        {target.kind === 'plot' && <PlotExplorer title={target.title} plot={target.plot} onOpenTable={onOpenTable} />}
        {target.kind === 'metrics' && <MetricsExplorer metrics={target.metrics} />}
        {target.kind === 'raw' && <RawExplorer value={target.value} />}
      </div>
    </div>
  </div>
}

type PlotSettings = {
  chart: 'scatter' | 'line' | 'bar' | 'area' | 'density' | 'scatter3d'
  title: string; xLabel: string; yLabel: string; zLabel: string
  groupByColor: boolean; markerSize: number; opacity: number
  xLog: boolean; yLog: boolean; grid: boolean; trend: boolean
  palette: string
  xMin: string; xMax: string; yMin: string; yMax: string
}

function initialSettings(plot: PlotValue): PlotSettings {
  return {
    chart: plot.kind === 'histogram' ? 'bar' : plot.kind === 'scatter3d' ? 'scatter3d' : 'scatter',
    title: plot.title || (plot.kind === 'histogram' ? 'Distribuzione' : 'Grafico'),
    xLabel: plot.labels?.x || 'x', yLabel: plot.labels?.y || (plot.kind === 'histogram' ? 'Conteggio' : 'y'), zLabel: plot.labels?.z || 'z',
    groupByColor: Boolean(plot.color?.length), markerSize: plot.kind === 'scatter3d' ? 4 : 8, opacity: .85,
    xLog: false, yLog: false, grid: true, trend: false, palette: 'Piattaforma',
    xMin: '', xMax: '', yMin: '', yMax: '',
  }
}

const numberOrNull = (value: string) => { if (!value.trim()) return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null }
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length)
const std = (values: number[]) => { const m = mean(values); return Math.sqrt(mean(values.map((value) => (value - m) ** 2))) }

function PlotExplorer({ title, plot, onOpenTable }: { title: string; plot: PlotValue; onOpenTable: (title: string, table: TableValue) => void }) {
  const [settings, setSettings] = useState<PlotSettings>(() => initialSettings(plot))
  const set = <K extends keyof PlotSettings>(key: K, value: PlotSettings[K]) => setSettings((current) => ({ ...current, [key]: value }))
  const isHistogram = plot.kind === 'histogram'
  const is3D = plot.kind === 'scatter3d'
  const colors = PALETTES[settings.palette] || PALETTES.Piattaforma

  // Points after the X/Y range filters: every view, stat and export works on the same subset.
  const points = useMemo(() => {
    const xMin = numberOrNull(settings.xMin); const xMax = numberOrNull(settings.xMax)
    const yMin = numberOrNull(settings.yMin); const yMax = numberOrNull(settings.yMax)
    return plot.x.map((x, index) => ({ x: Number(x), xEnd: plot.xEnd?.[index], y: Number(plot.y[index]), z: plot.z?.[index], group: String(plot.color?.[index] ?? 'Dati') }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      .filter((point) => (xMin === null || point.x >= xMin) && (xMax === null || point.x <= xMax) && (yMin === null || point.y >= yMin) && (yMax === null || point.y <= yMax))
  }, [plot, settings.xMin, settings.xMax, settings.yMin, settings.yMax])

  const groups = settings.groupByColor ? [...new Set(points.map((point) => point.group))] : ['Dati']
  const xs = points.map((point) => point.x); const ys = points.map((point) => point.y)
  const regression = useMemo(() => {
    if (xs.length < 2) return null
    const mx = mean(xs); const my = mean(ys)
    const sxx = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0)
    if (!sxx) return null
    const slope = xs.reduce((sum, x, index) => sum + (x - mx) * (ys[index] - my), 0) / sxx
    const intercept = my - slope * mx
    const ssTot = ys.reduce((sum, y) => sum + (y - my) ** 2, 0)
    const ssRes = ys.reduce((sum, y, index) => sum + (y - (slope * xs[index] + intercept)) ** 2, 0)
    return { slope, intercept, r2: ssTot ? 1 - ssRes / ssTot : 1 }
  }, [xs, ys])
  const correlation = useMemo(() => {
    if (xs.length < 2) return null
    const mx = mean(xs); const my = mean(ys)
    const cov = xs.reduce((sum, x, index) => sum + (x - mx) * (ys[index] - my), 0)
    const vx = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0); const vy = ys.reduce((sum, y) => sum + (y - my) ** 2, 0)
    return vx && vy ? cov / Math.sqrt(vx * vy) : null
  }, [xs, ys])

  const traces = useMemo(() => {
    if (settings.chart === 'scatter3d') {
      return groups.map((group, index) => {
        const subset = points.filter((point) => !settings.groupByColor || point.group === group)
        return { type: 'scatter3d', mode: 'markers', name: group, x: subset.map((p) => p.x), y: subset.map((p) => p.y), z: subset.map((p) => p.z),
          marker: { size: settings.markerSize, opacity: settings.opacity, color: settings.groupByColor ? colors[index % colors.length] : subset.map((p) => p.z), colorscale: settings.groupByColor ? undefined : 'Viridis', showscale: !settings.groupByColor } }
      })
    }
    if (isHistogram) {
      const labels = points.map((point) => point.xEnd !== undefined ? `${formatCompact(point.x)}–${formatCompact(point.xEnd)}` : formatCompact(point.x))
      if (settings.chart === 'line' || settings.chart === 'area') {
        return [{ type: 'scatter', mode: 'lines+markers', name: settings.yLabel, x: points.map((p) => p.x), y: ys, fill: settings.chart === 'area' ? 'tozeroy' : undefined,
          line: { color: colors[0], width: 2.5, shape: 'spline' }, marker: { size: settings.markerSize / 2, color: colors[0] }, opacity: settings.opacity }]
      }
      return [{ type: 'bar', name: settings.yLabel, x: labels, y: ys, marker: { color: points.map((_p, index) => colors[index % 2]), opacity: settings.opacity } }]
    }
    if (settings.chart === 'density') {
      return [
        { type: 'histogram2dcontour', x: xs, y: ys, colorscale: 'Blues', reversescale: false, showscale: true, contours: { coloring: 'heatmap' }, opacity: settings.opacity, name: 'Densità' },
        { type: 'scatter', mode: 'markers', x: xs, y: ys, name: 'Punti', marker: { size: 3, color: '#171717', opacity: .45 } },
      ]
    }
    const base = groups.map((group, index) => {
      const subset = points.filter((point) => !settings.groupByColor || point.group === group).sort((a, b) => settings.chart === 'scatter' ? 0 : a.x - b.x)
      const color = colors[index % colors.length]
      if (settings.chart === 'bar') return { type: 'bar', name: group, x: subset.map((p) => p.x), y: subset.map((p) => p.y), marker: { color, opacity: settings.opacity } }
      return { type: 'scatter', mode: settings.chart === 'scatter' ? 'markers' : 'lines+markers', name: group, x: subset.map((p) => p.x), y: subset.map((p) => p.y),
        fill: settings.chart === 'area' ? 'tozeroy' : undefined,
        line: { color, width: 2 }, marker: { size: settings.markerSize, color, opacity: settings.opacity, line: { width: 1, color: 'rgba(255,255,255,.8)' } } }
    })
    if (settings.trend && regression && xs.length) {
      const lo = Math.min(...xs); const hi = Math.max(...xs)
      base.push({ type: 'scatter', mode: 'lines', name: `Tendenza (R² ${regression.r2.toFixed(3)})`, x: [lo, hi], y: [regression.slope * lo + regression.intercept, regression.slope * hi + regression.intercept], line: { color: '#171717', width: 2 } } as never)
    }
    return base
  }, [colors, groups, isHistogram, points, regression, settings, xs, ys])

  const axis = (label: string, log: boolean, extra: Record<string, unknown> = {}) => ({ title: { text: label }, type: log ? 'log' : 'linear', showgrid: settings.grid, gridcolor: '#e5e5e5', zeroline: false, ...extra })
  const layout = settings.chart === 'scatter3d'
    ? { autosize: true, title: { text: settings.title }, margin: { l: 0, r: 0, t: 48, b: 0 }, paper_bgcolor: 'rgba(0,0,0,0)', showlegend: groups.length > 1,
        scene: { xaxis: { title: settings.xLabel, showgrid: settings.grid }, yaxis: { title: settings.yLabel, showgrid: settings.grid }, zaxis: { title: settings.zLabel, showgrid: settings.grid } } }
    : { autosize: true, title: { text: settings.title }, margin: { l: 64, r: 24, t: 56, b: 64 }, paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: '#ffffff', hovermode: 'closest', bargap: .08,
        showlegend: groups.length > 1 || settings.trend, legend: { orientation: 'h', y: -0.18 },
        xaxis: axis(settings.xLabel, settings.xLog, isHistogram && settings.chart === 'bar' ? { type: 'category' } : {}), yaxis: axis(settings.yLabel, settings.yLog) }

  const pointsTable = (): TableValue => {
    const columns = [settings.xLabel, ...(isHistogram && plot.xEnd ? [`${settings.xLabel}_fine`] : []), settings.yLabel, ...(is3D ? [settings.zLabel] : []), ...(plot.color?.length ? ['gruppo'] : [])]
    const rows = points.map((point) => Object.fromEntries([
      [settings.xLabel, point.x], ...(isHistogram && plot.xEnd ? [[`${settings.xLabel}_fine`, point.xEnd]] : []), [settings.yLabel, point.y],
      ...(is3D ? [[settings.zLabel, point.z]] : []), ...(plot.color?.length ? [['gruppo', point.group]] : []),
    ]))
    return { columns, rows, rowCount: rows.length }
  }
  const exportCsv = () => {
    const table = pointsTable(); const columns = table.columns || []
    const escape = (value: unknown) => { const text = value === undefined || value === null ? '' : String(value); return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text }
    const csv = [columns.join(','), ...table.rows.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `${settings.title || 'grafico'}.csv`; link.click(); URL.revokeObjectURL(url)
  }

  const chartOptions: Array<[PlotSettings['chart'], string]> = is3D
    ? [['scatter3d', 'Dispersione 3D'], ['scatter', 'Proiezione X/Y']]
    : isHistogram ? [['bar', 'Barre'], ['line', 'Linea'], ['area', 'Area']]
      : [['scatter', 'Dispersione'], ['line', 'Linea'], ['area', 'Area'], ['bar', 'Barre'], ['density', 'Densità']]
  const showMarkers = !isHistogram && settings.chart !== 'density' && settings.chart !== 'bar'

  return <div className="grid h-full min-h-0 grid-cols-1 lg:grid-cols-[18rem_minmax(0,1fr)]">
    <aside className="min-h-0 space-y-5 overflow-y-auto border-r border-slate-200 bg-white p-4 text-xs">
      <Section title="Visualizzazione">
        <div className="grid grid-cols-2 gap-1.5">{chartOptions.map(([id, label]) => <button key={id} type="button" onClick={() => set('chart', id)} className={`h-9 rounded-lg px-2 font-bold ${settings.chart === id ? 'ds-selected' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'}`}>{label}</button>)}</div>
        <Field label="Palette"><select value={settings.palette} onChange={(event) => set('palette', event.target.value)} className={INPUT}>{Object.keys(PALETTES).map((name) => <option key={name}>{name}</option>)}</select></Field>
        {plot.color?.length ? <Toggle label="Colora per gruppo" value={settings.groupByColor} onChange={(value) => set('groupByColor', value)} /> : null}
        <Toggle label="Griglia" value={settings.grid} onChange={(value) => set('grid', value)} />
        {!isHistogram && !is3D && <Toggle label="Linea di tendenza" value={settings.trend} onChange={(value) => set('trend', value)} />}
      </Section>
      <Section title="Stile">
        {showMarkers && <Range label="Dimensione punti" min={2} max={18} step={1} value={settings.markerSize} onChange={(value) => set('markerSize', value)} />}
        <Range label="Opacità" min={.2} max={1} step={.05} value={settings.opacity} onChange={(value) => set('opacity', value)} />
      </Section>
      <Section title="Assi">
        <Field label="Titolo"><input value={settings.title} onChange={(event) => set('title', event.target.value)} className={INPUT} /></Field>
        <Field label="Etichetta X"><input value={settings.xLabel} onChange={(event) => set('xLabel', event.target.value)} className={INPUT} /></Field>
        <Field label="Etichetta Y"><input value={settings.yLabel} onChange={(event) => set('yLabel', event.target.value)} className={INPUT} /></Field>
        {is3D && <Field label="Etichetta Z"><input value={settings.zLabel} onChange={(event) => set('zLabel', event.target.value)} className={INPUT} /></Field>}
        {settings.chart !== 'scatter3d' && <><Toggle label="Scala logaritmica X" value={settings.xLog} onChange={(value) => set('xLog', value)} /><Toggle label="Scala logaritmica Y" value={settings.yLog} onChange={(value) => set('yLog', value)} /></>}
      </Section>
      <Section title="Filtra intervallo">
        <div className="grid grid-cols-2 gap-1.5">
          <input value={settings.xMin} onChange={(event) => set('xMin', event.target.value)} placeholder="X min" className={INPUT} />
          <input value={settings.xMax} onChange={(event) => set('xMax', event.target.value)} placeholder="X max" className={INPUT} />
          <input value={settings.yMin} onChange={(event) => set('yMin', event.target.value)} placeholder="Y min" className={INPUT} />
          <input value={settings.yMax} onChange={(event) => set('yMax', event.target.value)} placeholder="Y max" className={INPUT} />
        </div>
      </Section>
      <div className="flex flex-col gap-2 border-t border-slate-100 pt-4">
        <Button type="button" onClick={() => onOpenTable(`${title} · dati del grafico`, pointsTable())} tone="neutral" surface="outline" density="compact" className="rounded-full"><FileSpreadsheet className="h-4 w-4" /> Apri dati nel foglio</Button>
        <Button type="button" onClick={exportCsv} tone="neutral" surface="outline" density="compact" className="rounded-full"><Download className="h-4 w-4" /> Esporta CSV</Button>
        <Button type="button" onClick={() => setSettings(initialSettings(plot))} tone="neutral" surface="ghost" density="compact" className="rounded-full"><RotateCcw className="h-4 w-4" /> Ripristina</Button>
      </div>
    </aside>
    <section className="flex min-h-0 flex-col gap-3 p-4">
      <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
        <Stat label={isHistogram ? 'Intervalli' : 'Punti'} value={points.length} />
        {isHistogram ? <>
          <Stat label="Totale" value={ys.reduce((sum, value) => sum + value, 0)} />
          <Stat label="Picco" value={ys.length ? Math.max(...ys) : '—'} />
          <Stat label="Da" value={xs.length ? Math.min(...xs) : '—'} />
          <Stat label="A" value={points.length ? Math.max(...points.map((point) => Number(point.xEnd ?? point.x))) : '—'} />
        </> : <>
          <Stat label={`Media ${settings.xLabel}`} value={xs.length ? mean(xs) : '—'} hint={xs.length ? `σ ${formatCompact(std(xs))}` : undefined} />
          <Stat label={`Media ${settings.yLabel}`} value={ys.length ? mean(ys) : '—'} hint={ys.length ? `σ ${formatCompact(std(ys))}` : undefined} />
          <Stat label="Intervallo X" value={xs.length ? `${formatCompact(Math.min(...xs))} – ${formatCompact(Math.max(...xs))}` : '—'} />
          <Stat label="Correlazione" value={correlation === null ? '—' : correlation} />
          {regression && <Stat label="Retta" value={`y = ${formatCompact(regression.slope)}x ${regression.intercept >= 0 ? '+' : '−'} ${formatCompact(Math.abs(regression.intercept))}`} hint={`R² ${regression.r2.toFixed(3)}`} />}
        </>}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-2xl bg-white shadow-[var(--ds-shadow-1)]">
        <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-slate-400">Caricamento explorer…</div>}>
          <Plot data={traces as never} layout={layout as never} config={{ displaylogo: false, responsive: true, toImageButtonOptions: { filename: settings.title || 'grafico', scale: 2 } }} style={{ width: '100%', height: '100%' }} useResizeHandler />
        </Suspense>
      </div>
    </section>
  </div>
}

function MetricsExplorer({ metrics }: { metrics: Record<string, unknown> }) {
  const scalars = Object.entries(metrics).filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))
  const nested = Object.entries(metrics).filter(([, value]) => value !== null && typeof value === 'object')
  return <div className="h-full overflow-y-auto p-5">
    {scalars.length > 0 && <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{scalars.map(([key, value]) => <div key={key} className="rounded-2xl bg-white p-4 shadow-[var(--ds-shadow-1)]"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{METRIC_LABELS[key] || key.replace(/_/g, ' ')}</p><p className="mt-1 break-words text-2xl font-black text-slate-900">{formatCompact(value)}</p></div>)}</div>}
    {nested.map(([key, value]) => <div key={key} className="mt-5 rounded-2xl bg-white p-4 shadow-[var(--ds-shadow-1)]"><p className="mb-3 text-[10px] font-black uppercase tracking-wider text-slate-400">{METRIC_LABELS[key] || key.replace(/_/g, ' ')}</p><StructuredValue value={value} /></div>)}
    {!scalars.length && !nested.length && <p className="text-sm text-slate-400">Nessuna metrica disponibile.</p>}
  </div>
}

/** Renders matrices as grids, arrays of records as tables, objects as key/value lists. */
function StructuredValue({ value }: { value: unknown }): ReactNode {
  if (Array.isArray(value) && value.length && value.every(Array.isArray)) {
    return <div className="overflow-auto"><table className="text-xs"><tbody>{(value as unknown[][]).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className="border border-slate-100 px-3 py-2 text-center font-mono font-bold text-slate-700">{formatCompact(cell)}</td>)}</tr>)}</tbody></table></div>
  }
  if (Array.isArray(value) && value.length && value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) {
    const columns = [...new Set((value as Record<string, unknown>[]).flatMap((row) => Object.keys(row)))]
    return <div className="overflow-auto"><table className="w-full text-xs"><thead className="bg-slate-50"><tr>{columns.map((column) => <th key={column} className="px-3 py-2 text-left font-bold text-slate-500">{column}</th>)}</tr></thead><tbody>{(value as Record<string, unknown>[]).map((row, index) => <tr key={index} className="border-t border-slate-100">{columns.map((column) => <td key={column} className="px-3 py-2 text-slate-700">{formatCompact(row[column])}</td>)}</tr>)}</tbody></table></div>
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1.5 text-xs">{Object.entries(value as Record<string, unknown>).map(([key, item]) => <Fragment key={key}><dt className="font-bold text-slate-500">{key}</dt><dd className="min-w-0 break-words font-mono text-slate-800">{item && typeof item === 'object' ? JSON.stringify(item) : formatCompact(item)}</dd></Fragment>)}</dl>
  }
  return <pre className="whitespace-pre-wrap font-mono text-xs text-slate-800">{JSON.stringify(value, null, 2)}</pre>
}

function RawExplorer({ value }: { value: unknown }) {
  const [copied, setCopied] = useState(false)
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ } }
  return <div className="flex h-full flex-col gap-3 p-5">
    <div className="flex justify-end"><Button type="button" onClick={copy} tone="neutral" surface="outline" density="compact" className="rounded-full">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copiato' : 'Copia'}</Button></div>
    {value && typeof value === 'object'
      ? <div className="min-h-0 flex-1 overflow-auto rounded-2xl bg-white p-4 shadow-[var(--ds-shadow-1)]"><StructuredValue value={value} /></div>
      : <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap rounded-2xl bg-slate-950 p-5 font-mono text-xs leading-6 text-slate-100">{text}</pre>}
  </div>
}

const INPUT = 'h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs outline-none focus:border-slate-400'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <div className="space-y-2"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{title}</p>{children}</div>
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-1"><span className="block text-[10px] font-bold text-slate-500">{label}</span>{children}</label>
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={value} onClick={() => onChange(!value)} className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left font-semibold text-slate-600 hover:bg-slate-50"><span>{label}</span><span className={`relative h-5 w-9 rounded-full transition-colors ${value ? 'bg-slate-900' : 'bg-slate-200'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${value ? 'left-[18px]' : 'left-0.5'}`} /></span></button>
}
function Range({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return <label className="block space-y-1"><span className="flex justify-between text-[10px] font-bold text-slate-500"><span>{label}</span><span>{value}</span></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-slate-900" /></label>
}
function Stat({ label, value, hint }: { label: string; value: unknown; hint?: string }) {
  return <div className="rounded-xl bg-white px-3 py-2 shadow-[var(--ds-shadow-1)]"><p className="truncate text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</p><p className="mt-0.5 truncate text-sm font-black text-slate-800">{formatCompact(value)}</p>{hint && <p className="truncate text-[9px] font-semibold text-slate-400">{hint}</p>}</div>
}
