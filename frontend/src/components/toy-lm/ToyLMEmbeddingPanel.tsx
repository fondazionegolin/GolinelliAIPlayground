import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, ScatterChart, Sigma } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface ToyLMEmbeddingToken {
  index: number
  token: string
  vector: number[]
}

export interface ToyLMEmbeddingPayload {
  embeddingDim: number
  tokenMode?: 'word' | 'char'
  tokens: ToyLMEmbeddingToken[]
}

interface ToyLMEmbeddingPanelProps {
  canLoad: boolean
  unavailableMessage: string
  loadEmbeddings: () => Promise<ToyLMEmbeddingPayload>
}

interface Point extends ToyLMEmbeddingToken {
  x: number
  y: number
  sx: number
  sy: number
}

const SVG_W = 720
const SVG_H = 360
const PAD = 34

export default function ToyLMEmbeddingPanel({
  canLoad,
  unavailableMessage,
  loadEmbeddings,
}: ToyLMEmbeddingPanelProps) {
  const [payload, setPayload] = useState<ToyLMEmbeddingPayload | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [axisX, setAxisX] = useState(0)
  const [axisY, setAxisY] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)

  const fetchEmbeddings = useCallback(async () => {
    if (!canLoad || isLoading) return
    setIsLoading(true)
    setError('')
    try {
      const next = await loadEmbeddings()
      setPayload(next)
      setAxisX(0)
      setAxisY(Math.min(1, Math.max(next.embeddingDim - 1, 0)))
      setSelectedIndex(next.tokens[0]?.index ?? null)
    } catch (err) {
      setError((err as Error).message || 'Errore caricamento embedding')
    } finally {
      setIsLoading(false)
    }
  }, [canLoad, isLoading, loadEmbeddings])

  useEffect(() => {
    setPayload(null)
    setError('')
    setSelectedIndex(null)
    setQuery('')
  }, [loadEmbeddings])

  const dimOptions = useMemo(() => {
    const dim = payload?.embeddingDim ?? 0
    return Array.from({ length: dim }, (_, i) => i)
  }, [payload?.embeddingDim])

  const points = useMemo<Point[]>(() => {
    const tokens = payload?.tokens ?? []
    if (!tokens.length) return []

    const valuesX = tokens.map(t => t.vector[axisX] ?? 0)
    const valuesY = tokens.map(t => t.vector[axisY] ?? 0)
    const minX = Math.min(...valuesX)
    const maxX = Math.max(...valuesX)
    const minY = Math.min(...valuesY)
    const maxY = Math.max(...valuesY)
    const spanX = Math.max(maxX - minX, 1e-6)
    const spanY = Math.max(maxY - minY, 1e-6)
    const cx = SVG_W / 2
    const cy = SVG_H / 2

    return tokens.map(token => {
      const x = token.vector[axisX] ?? 0
      const y = token.vector[axisY] ?? 0
      const baseX = PAD + ((x - minX) / spanX) * (SVG_W - PAD * 2)
      const baseY = SVG_H - PAD - ((y - minY) / spanY) * (SVG_H - PAD * 2)
      return {
        ...token,
        x,
        y,
        sx: cx + (baseX - cx) * zoom,
        sy: cy + (baseY - cy) * zoom,
      }
    })
  }, [axisX, axisY, payload?.tokens, zoom])

  const filteredPoints = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return points
    return points.filter(point => tokenLabel(point.token).toLowerCase().includes(normalized))
  }, [points, query])

  const selectedToken = useMemo(
    () => payload?.tokens.find(token => token.index === selectedIndex) ?? null,
    [payload?.tokens, selectedIndex],
  )

  const nearest = useMemo(() => {
    if (!selectedToken || !payload?.tokens.length) return []
    return payload.tokens
      .filter(token => token.index !== selectedToken.index)
      .map(token => ({ token, score: cosine(selectedToken.vector, token.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
  }, [payload?.tokens, selectedToken])

  const selectedPoint = points.find(point => point.index === selectedIndex)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ScatterChart className="h-4 w-4 text-[var(--logo-violet)]" />
          <span className="text-sm font-black">Spazio embedding</span>
        </div>
        <Button tone="accent" surface={payload ? 'soft' : 'solid'} density="compact" disabled={!canLoad || isLoading} onClick={fetchEmbeddings}>
          <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          {payload ? 'Aggiorna' : 'Carica embedding'}
        </Button>
      </div>

      {!canLoad ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {unavailableMessage}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
          {error}
        </div>
      ) : !payload ? (
        <div className="rounded-xl border border-[var(--border-subtle)] bg-white px-3 py-4 text-center text-xs text-[var(--text-muted)]">
          Carica il checkpoint per esplorare i vettori dei token.
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_1.25fr]">
            <AxisSelect label="Asse X" value={axisX} options={dimOptions} onChange={setAxisX} />
            <AxisSelect label="Asse Y" value={axisY} options={dimOptions} onChange={setAxisY} />
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs font-medium text-[var(--text-secondary)]">Zoom</label>
                <span className="font-mono text-xs font-bold text-[var(--logo-violet)]">{zoom.toFixed(1)}x</span>
              </div>
              <input
                type="range"
                min={0.7}
                max={3}
                step={0.1}
                value={zoom}
                onChange={e => setZoom(parseFloat(e.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--logo-violet-10)] accent-[var(--logo-violet)]"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">Cerca token</label>
              <div className="flex items-center gap-2 rounded-xl border border-[var(--border-subtle)] bg-white px-2.5 py-1.5">
                <Search className="h-3.5 w-3.5 text-[var(--text-muted)]" />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-[var(--text-muted)]"
                  placeholder={payload.tokenMode === 'char' ? 'lettera, spazio, newline...' : 'parola o punteggiatura...'}
                />
              </div>
            </div>
          </div>

          {payload.tokenMode === 'char' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Questo checkpoint è stato addestrato in modalità caratteri: i punti rappresentano singole lettere. Per vedere parole nello spazio embedding crea un nuovo modello con tokenizzazione “Parole”.
            </div>
          )}

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_15rem]">
            <div className="overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-white">
              <svg viewBox={`0 0 ${SVG_W} ${SVG_H}`} className="block h-[260px] w-full sm:h-[320px]" role="img" aria-label="Proiezione degli embedding dei token">
                <rect x="0" y="0" width={SVG_W} height={SVG_H} fill="#ffffff" />
                <line x1={PAD} y1={SVG_H - PAD} x2={SVG_W - PAD} y2={SVG_H - PAD} stroke="#e2e8f0" />
                <line x1={PAD} y1={PAD} x2={PAD} y2={SVG_H - PAD} stroke="#e2e8f0" />
                <text x={SVG_W - PAD} y={SVG_H - 10} textAnchor="end" className="fill-slate-400 text-[11px]">dim {axisX + 1}</text>
                <text x={10} y={PAD - 12} className="fill-slate-400 text-[11px]">dim {axisY + 1}</text>

                {filteredPoints.map(point => {
                  const isSelected = point.index === selectedIndex
                  return (
                    <g key={point.index}>
                      <circle
                        cx={point.sx}
                        cy={point.sy}
                        r={isSelected ? 8 : 5}
                        className={`cursor-pointer transition-opacity ${isSelected ? 'fill-[var(--logo-violet)]' : 'fill-[var(--logo-violet)] opacity-45 hover:opacity-90'}`}
                        stroke={isSelected ? '#ffffff' : 'transparent'}
                        strokeWidth={2}
                        onClick={() => setSelectedIndex(point.index)}
                      />
                      {(isSelected || filteredPoints.length <= 42) && (
                        <text
                          x={point.sx + 8}
                          y={point.sy - 7}
                          className={`pointer-events-none text-[11px] ${isSelected ? 'fill-slate-950 font-bold' : 'fill-slate-500'}`}
                        >
                          {tokenLabel(point.token)}
                        </text>
                      )}
                    </g>
                  )
                })}

                {selectedPoint && (
                  <circle cx={selectedPoint.sx} cy={selectedPoint.sy} r={14} fill="none" stroke="#7b69c9" strokeDasharray="4 3" strokeWidth={1.5} />
                )}
              </svg>
            </div>

            <div className="rounded-xl border border-[var(--border-subtle)] bg-white p-3">
              <div className="mb-2 flex items-center gap-2">
                <Sigma className="h-3.5 w-3.5 text-[var(--logo-violet)]" />
                <span className="text-xs font-black">Token selezionato</span>
              </div>
              {selectedToken ? (
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-lg bg-[var(--logo-violet-10)] px-2 py-1 font-mono text-sm font-black text-[var(--logo-violet)]">
                        {tokenLabel(selectedToken.token)}
                      </span>
                      <span className="font-mono text-[11px] text-[var(--text-muted)]">#{selectedToken.index}</span>
                    </div>
                    <p className="mt-2 break-all font-mono text-[10px] leading-4 text-[var(--text-muted)]">
                      [{selectedToken.vector.slice(0, 8).map(v => v.toFixed(2)).join(', ')}{selectedToken.vector.length > 8 ? ', ...' : ''}]
                    </p>
                  </div>
                  <div>
                    <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">Vicini coseno</p>
                    <div className="space-y-1">
                      {nearest.map(({ token, score }) => (
                        <button
                          key={token.index}
                          type="button"
                          onClick={() => setSelectedIndex(token.index)}
                          className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left hover:bg-[var(--surface-elevated)]"
                        >
                          <span className="font-mono text-xs font-bold text-[var(--text-primary)]">{tokenLabel(token.token)}</span>
                          <span className="font-mono text-[10px] text-[var(--text-muted)]">{score.toFixed(3)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">Seleziona un punto nello spazio.</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-[11px] text-[var(--text-muted)]">
            <span>{payload.tokens.length} token</span>
            <span>·</span>
            <span>{payload.embeddingDim} dimensioni</span>
            <span>·</span>
            <span>{payload.tokenMode === 'char' ? 'caratteri' : 'parole e punteggiatura'}</span>
            <span>·</span>
            <span>vista 2D su dimensioni selezionabili</span>
          </div>
        </>
      )}
    </div>
  )
}

function AxisSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: number
  options: number[]
  onChange: (value: number) => void
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-[var(--text-secondary)]">{label}</label>
      <select
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full rounded-xl border border-[var(--border-subtle)] bg-white px-2.5 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--logo-violet)] focus:outline-none focus:ring-2 focus:ring-[var(--logo-violet-22)]"
      >
        {options.map(option => (
          <option key={option} value={option}>Dimensione {option + 1}</option>
        ))}
      </select>
    </div>
  )
}

function tokenLabel(token: string) {
  if (token === ' ') return 'spazio'
  if (token === '\n') return '\\n'
  if (token === '\t') return '\\t'
  if (!token) return '∅'
  return token.length > 18 ? `${token.slice(0, 17)}…` : token
}

function cosine(a: number[], b: number[]) {
  let dot = 0
  let normA = 0
  let normB = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1)
}
