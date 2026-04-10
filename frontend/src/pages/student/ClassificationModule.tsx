import { useState, useRef, useCallback, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Camera, Type, Database, Play, Square, Trash2, Plus,
  Upload, Loader2, CheckCircle, XCircle, BarChart3, Info,
  TrendingUp, Tags, AlertCircle, Lightbulb, ArrowLeft,
  Sparkles, Download, Clipboard, ChevronRight, Paperclip, Share2, FolderOpen
} from 'lucide-react'
import * as tf from '@tensorflow/tfjs'
import { DataVisualizationPanel } from '@/components/DataVisualizationPanel'
import { chatApi } from '@/lib/api'
import { useToast } from '@/components/ui/use-toast'

// ─── Types ────────────────────────────────────────────────────────────────────

type ClassificationMode = 'images' | 'text' | 'data'

interface ImageClass {
  id: string
  name: string
  samples: string[] // base64 images
  color: string
}

interface TextSample {
  text: string
  label: string
}

interface DataRow {
  [key: string]: string | number
}

interface ColumnInfo {
  name: string
  type: 'numeric' | 'categorical'
  uniqueValues: number
  sampleValues: (string | number)[]
}

type TaskType = 'classification' | 'regression' | null

// ─── DatasetCreator types ──────────────────────────────────────────────────────

interface ColumnDef {
  id: string
  name: string
  type: 'numeric' | 'categorical' | 'boolean'
  categories: string
  min: number
  max: number
}

interface CorrelationDef {
  id: string
  source: string
  target: string
  type: 'linear' | 'polynomial' | 'inverse' | 'exponential' | 'none'
  strength: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CLASS_COLORS = [
  'bg-rose-500',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
]

const DOT_COLORS = [
  'bg-rose-500',
  'bg-blue-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-purple-500',
  'bg-orange-500',
  'bg-teal-500',
]

// ─── Dataset generation algorithm ─────────────────────────────────────────────

function generateDataset(cols: ColumnDef[], rowCount: number, correlations: CorrelationDef[]): string {
  const colData: Record<string, (number | string)[]> = {}

  for (const col of cols) {
    if (col.type === 'numeric') {
      const min = col.min ?? 0
      const max = col.max ?? 100
      colData[col.name] = Array.from({ length: rowCount }, () =>
        parseFloat((min + Math.random() * (max - min)).toFixed(2))
      )
    } else if (col.type === 'categorical') {
      const cats = col.categories.split(',').map(s => s.trim()).filter(Boolean)
      const vals = cats.length ? cats : ['A', 'B', 'C']
      colData[col.name] = Array.from({ length: rowCount }, () =>
        vals[Math.floor(Math.random() * vals.length)]
      )
    } else {
      colData[col.name] = Array.from({ length: rowCount }, () =>
        Math.random() > 0.5 ? 'true' : 'false'
      )
    }
  }

  for (const corr of correlations) {
    if (corr.type === 'none') continue
    const sourceData = colData[corr.source] as number[]
    if (!sourceData) continue
    const s = corr.strength ?? 0.8
    const noiseAmp = (1 - s) * 30

    const srcMin = Math.min(...sourceData)
    const srcMax = Math.max(...sourceData)
    const srcRange = srcMax - srcMin || 1

    colData[corr.target] = sourceData.map(x => {
      const norm = (x - srcMin) / srcRange
      const noise = (Math.random() - 0.5) * 2 * noiseAmp
      let val: number
      switch (corr.type) {
        case 'linear':
          val = norm * 100 * s + noise
          break
        case 'polynomial':
          val = Math.pow(norm, 2) * 100 * s + noise
          break
        case 'inverse':
          val = norm > 0.01 ? (s * 100 / (norm * 10 + 0.5)) + noise : 100 + noise
          break
        case 'exponential':
          val = (Math.exp(norm * 3 * s) - 1) * 10 + noise
          break
        default:
          val = norm * 100 + noise
      }
      return parseFloat(Math.max(0, val).toFixed(2))
    })
  }

  const headers = cols.map(c => c.name)
  const rows: string[] = [headers.join(',')]
  for (let i = 0; i < rowCount; i++) {
    const row = cols.map(c => {
      const v = colData[c.name][i]
      const str = String(v)
      return str.includes(',') ? `"${str}"` : str
    })
    rows.push(row.join(','))
  }
  return rows.join('\n')
}

// ─── DatasetCreatorModal ───────────────────────────────────────────────────────

function DatasetCreatorModal({
  onUse,
  onClose,
}: {
  onUse: (csvData: string) => void
  onClose: () => void
}) {
  const [columns, setColumns] = useState<ColumnDef[]>([
    { id: uid(), name: 'feature_1', type: 'numeric', categories: '', min: 0, max: 100 },
    { id: uid(), name: 'feature_2', type: 'numeric', categories: '', min: 0, max: 100 },
    { id: uid(), name: 'label', type: 'categorical', categories: 'A,B,C', min: 0, max: 100 },
  ])
  const [rowCount, setRowCount] = useState(200)
  const [correlations, setCorrelations] = useState<CorrelationDef[]>([])
  const [generatedCsv, setGeneratedCsv] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const numericCols = columns.filter(c => c.type === 'numeric')

  const addColumn = () => {
    setColumns(prev => [...prev, {
      id: uid(),
      name: `col_${prev.length + 1}`,
      type: 'numeric',
      categories: '',
      min: 0,
      max: 100,
    }])
  }

  const removeColumn = (id: string) => {
    if (columns.length <= 1) return
    setColumns(prev => prev.filter(c => c.id !== id))
    setCorrelations(prev => prev.filter(corr => {
      const col = columns.find(c => c.id === id)
      if (!col) return true
      return corr.source !== col.name && corr.target !== col.name
    }))
  }

  const updateColumn = (id: string, patch: Partial<ColumnDef>) => {
    setColumns(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }

  const addCorrelation = () => {
    if (numericCols.length < 2) return
    setCorrelations(prev => [...prev, {
      id: uid(),
      source: numericCols[0].name,
      target: numericCols[1].name,
      type: 'linear',
      strength: 0.8,
    }])
  }

  const removeCorrelation = (id: string) => {
    setCorrelations(prev => prev.filter(c => c.id !== id))
  }

  const updateCorrelation = (id: string, patch: Partial<CorrelationDef>) => {
    setCorrelations(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c))
  }

  const handleGenerate = () => {
    const csv = generateDataset(columns, rowCount, correlations)
    setGeneratedCsv(csv)
  }

  const handleDownload = () => {
    if (!generatedCsv) return
    const blob = new Blob([generatedCsv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'dataset.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleCopy = async () => {
    if (!generatedCsv) return
    await navigator.clipboard.writeText(generatedCsv)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleUse = () => {
    if (!generatedCsv) return
    onUse(generatedCsv)
  }

  // Preview: first 5 data rows
  const previewRows = generatedCsv
    ? generatedCsv.split('\n').slice(0, 6)
    : []
  const previewHeaders = previewRows[0]?.split(',') ?? []
  const previewData = previewRows.slice(1).map(r => r.split(','))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backdropFilter: 'blur(4px)', backgroundColor: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="max-w-2xl w-full rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-emerald-100 flex items-center justify-center">
              <Sparkles className="h-4 w-4 text-emerald-600" />
            </div>
            <span className="font-bold text-slate-800">Crea Dataset</span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors"
          >
            <XCircle className="h-5 w-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-6">

          {/* Column Configurator */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Colonne</h3>
            <div className="space-y-2">
              {columns.map((col, idx) => (
                <div key={col.id} className="flex items-start gap-2 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <div className={`mt-2 w-3 h-3 rounded-full flex-shrink-0 ${DOT_COLORS[idx % DOT_COLORS.length]}`} />
                  <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <Input
                      value={col.name}
                      onChange={(e) => updateColumn(col.id, { name: e.target.value })}
                      placeholder="es. vendite"
                      className="h-8 text-sm"
                    />
                    <select
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
                      value={col.type}
                      onChange={(e) => updateColumn(col.id, { type: e.target.value as ColumnDef['type'] })}
                    >
                      <option value="numeric">Numerico</option>
                      <option value="categorical">Categorico</option>
                      <option value="boolean">Booleano</option>
                    </select>
                    {col.type === 'categorical' && (
                      <Input
                        value={col.categories}
                        onChange={(e) => updateColumn(col.id, { categories: e.target.value })}
                        placeholder="es. nord,sud,est,ovest"
                        className="h-8 text-sm sm:col-span-2"
                      />
                    )}
                    {col.type === 'numeric' && (
                      <div className="flex items-center gap-2 sm:col-span-2">
                        <span className="text-xs text-slate-500 whitespace-nowrap">Min</span>
                        <Input
                          type="number"
                          value={col.min}
                          onChange={(e) => updateColumn(col.id, { min: Number(e.target.value) })}
                          className="h-8 text-sm w-24"
                        />
                        <span className="text-xs text-slate-500 whitespace-nowrap">Max</span>
                        <Input
                          type="number"
                          value={col.max}
                          onChange={(e) => updateColumn(col.id, { max: Number(e.target.value) })}
                          className="h-8 text-sm w-24"
                        />
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => removeColumn(col.id)}
                    disabled={columns.length <= 1}
                    className="mt-1 p-1.5 rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={addColumn}
              className="mt-2 flex items-center gap-1.5 text-sm text-emerald-600 hover:text-emerald-700 font-medium"
            >
              <Plus className="h-4 w-4" />
              Aggiungi colonna
            </button>
          </div>

          {/* Row count */}
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Numero di righe</label>
            <Input
              type="number"
              min={10}
              max={5000}
              value={rowCount}
              onChange={(e) => setRowCount(Math.min(5000, Math.max(10, Number(e.target.value))))}
              className="w-40 h-8 text-sm"
            />
          </div>

          {/* Correlations */}
          {numericCols.length >= 2 && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 mb-3">Correlazioni statistiche</h3>
              {correlations.length === 0 && (
                <p className="text-xs text-slate-400 mb-2">Nessuna correlazione definita. I dati saranno casuali e indipendenti.</p>
              )}
              <div className="space-y-2">
                {correlations.map(corr => (
                  <div key={corr.id} className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-blue-50 border border-blue-100">
                    <select
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
                      value={corr.source}
                      onChange={(e) => updateCorrelation(corr.id, { source: e.target.value })}
                    >
                      {numericCols.map(c => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                    <span className="text-slate-400 text-sm font-medium">→</span>
                    <select
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
                      value={corr.target}
                      onChange={(e) => updateCorrelation(corr.id, { target: e.target.value })}
                    >
                      {numericCols.filter(c => c.name !== corr.source).map(c => (
                        <option key={c.id} value={c.name}>{c.name}</option>
                      ))}
                    </select>
                    <select
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-sm"
                      value={corr.type}
                      onChange={(e) => updateCorrelation(corr.id, { type: e.target.value as CorrelationDef['type'] })}
                    >
                      <option value="linear">Lineare</option>
                      <option value="polynomial">Polinomiale</option>
                      <option value="inverse">Inversa</option>
                      <option value="exponential">Esponenziale</option>
                      <option value="none">Nessuna</option>
                    </select>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0.1}
                        max={1.0}
                        step={0.1}
                        value={corr.strength}
                        onChange={(e) => updateCorrelation(corr.id, { strength: Number(e.target.value) })}
                        className="w-24"
                      />
                      <span className="text-xs text-slate-600 w-10">{Math.round(corr.strength * 100)}%</span>
                    </div>
                    <button
                      onClick={() => removeCorrelation(corr.id)}
                      className="p-1.5 rounded-lg hover:bg-red-50 text-slate-300 hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                onClick={addCorrelation}
                className="mt-2 flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                <Plus className="h-4 w-4" />
                Aggiungi correlazione
              </button>
            </div>
          )}

          {/* Generate button */}
          <Button onClick={handleGenerate} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white h-10">
            <Sparkles className="h-4 w-4 mr-2" />
            Genera Dataset
          </Button>

          {/* Preview & output */}
          {generatedCsv && (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-semibold text-slate-700 mb-2">Anteprima (prime 5 righe)</p>
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <div className="max-h-40 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          {previewHeaders.map((h, i) => (
                            <th key={i} className="px-3 py-2 text-left font-semibold text-slate-600 border-b border-slate-200">
                              {h.replace(/"/g, '')}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.map((row, ri) => (
                          <tr key={ri} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                            {row.map((cell, ci) => (
                              <td key={ci} className="px-3 py-1.5 text-slate-700">{cell.replace(/"/g, '')}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {rowCount} righe totali · {columns.length} colonne
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={handleDownload} className="gap-1.5">
                  <Download className="h-4 w-4" />
                  Scarica CSV
                </Button>
                <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5">
                  <Clipboard className="h-4 w-4" />
                  {copied ? 'Copiato!' : 'Copia CSV'}
                </Button>
                <Button size="sm" onClick={handleUse} className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white ml-auto">
                  <ChevronRight className="h-4 w-4" />
                  Usa nel classificatore
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── ID helper ────────────────────────────────────────────────────────────────

function uid(): string {
  return String(Date.now()) + String(Math.random()).slice(2, 8)
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ClassificationModule({ sessionId }: { sessionId?: string } = {}) {
  const { t } = useTranslation()
  const [mode, setMode] = useState<ClassificationMode | null>(null)
  const [showDatasetCreator, setShowDatasetCreator] = useState(false)
  const [pendingCsvData, setPendingCsvData] = useState<string | null>(null)

  const handleCsvFromCreator = (csvData: string) => {
    setPendingCsvData(csvData)
    setShowDatasetCreator(false)
  }

  if (!mode) {
    return (
      <>
        <MLLabHome
          onSelect={setMode}
          t={t}
        />
      </>
    )
  }

  return (
    <>
      {mode === 'images' && (
        <ImageClassification onBack={() => setMode(null)} sessionId={sessionId} />
      )}
      {mode === 'text' && (
        <TextClassification
          onBack={() => setMode(null)}
          onOpenDatasetCreator={() => setShowDatasetCreator(true)}
          pendingCsvData={pendingCsvData}
          onCsvConsumed={() => setPendingCsvData(null)}
        />
      )}
      {mode === 'data' && (
        <DataClassification
          onBack={() => setMode(null)}
          onOpenDatasetCreator={() => setShowDatasetCreator(true)}
          pendingCsvData={pendingCsvData}
          onCsvConsumed={() => setPendingCsvData(null)}
        />
      )}

      {showDatasetCreator && (
        <DatasetCreatorModal
          onUse={handleCsvFromCreator}
          onClose={() => setShowDatasetCreator(false)}
        />
      )}
    </>
  )
}

// ─── MLLabHome ────────────────────────────────────────────────────────────────

// Inline SVG illustrations for each mode
function ImagesIllustration() {
  return (
    <svg viewBox="0 0 200 130" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Background */}
      <rect width="200" height="130" rx="12" fill="#fff1f2" />
      {/* Camera body */}
      <rect x="60" y="35" width="80" height="60" rx="8" fill="#fb7185" opacity="0.9" />
      <rect x="68" y="42" width="64" height="46" rx="5" fill="#ffe4e6" />
      {/* Lens */}
      <circle cx="100" cy="65" r="16" fill="#f43f5e" />
      <circle cx="100" cy="65" r="11" fill="#fff1f2" />
      <circle cx="100" cy="65" r="7" fill="#f43f5e" opacity="0.6" />
      <circle cx="96" cy="61" r="2" fill="white" opacity="0.8" />
      {/* Shutter button */}
      <rect x="88" y="30" width="14" height="7" rx="3.5" fill="#fb7185" />
      {/* Flash */}
      <rect x="66" y="30" width="10" height="7" rx="3" fill="#fda4af" />
      {/* Classification labels floating */}
      <rect x="14" y="20" width="40" height="16" rx="8" fill="#f43f5e" opacity="0.15" />
      <text x="34" y="31" textAnchor="middle" fontSize="7" fill="#f43f5e" fontWeight="700">Gatto 🐱</text>
      <rect x="146" y="24" width="40" height="16" rx="8" fill="#f43f5e" opacity="0.15" />
      <text x="166" y="35" textAnchor="middle" fontSize="7" fill="#f43f5e" fontWeight="700">Cane 🐶</text>
      <rect x="14" y="95" width="44" height="16" rx="8" fill="#f43f5e" opacity="0.15" />
      <text x="36" y="106" textAnchor="middle" fontSize="7" fill="#f43f5e" fontWeight="700">Fiore 🌸</text>
      {/* Accuracy badge */}
      <rect x="136" y="95" width="50" height="18" rx="9" fill="#f43f5e" />
      <text x="161" y="107" textAnchor="middle" fontSize="8" fill="white" fontWeight="800">98% ✓</text>
    </svg>
  )
}

function TextIllustration() {
  return (
    <svg viewBox="0 0 200 130" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="130" rx="12" fill="#eff6ff" />
      {/* Document */}
      <rect x="30" y="20" width="100" height="90" rx="8" fill="white" />
      <rect x="30" y="20" width="100" height="90" rx="8" stroke="#bfdbfe" strokeWidth="1.5" />
      {/* Text lines */}
      <rect x="42" y="34" width="76" height="5" rx="2.5" fill="#bfdbfe" />
      <rect x="42" y="44" width="60" height="5" rx="2.5" fill="#bfdbfe" />
      <rect x="42" y="54" width="70" height="5" rx="2.5" fill="#bfdbfe" />
      <rect x="42" y="64" width="55" height="5" rx="2.5" fill="#dbeafe" />
      <rect x="42" y="74" width="65" height="5" rx="2.5" fill="#bfdbfe" />
      <rect x="42" y="84" width="50" height="5" rx="2.5" fill="#dbeafe" />
      {/* Highlight on "important" word */}
      <rect x="42" y="54" width="36" height="5" rx="2.5" fill="#3b82f6" opacity="0.4" />
      {/* Category badges */}
      <rect x="142" y="25" width="46" height="18" rx="9" fill="#3b82f6" />
      <text x="165" y="37" textAnchor="middle" fontSize="8" fill="white" fontWeight="700">Positivo</text>
      <rect x="145" y="50" width="40" height="18" rx="9" fill="#6366f1" opacity="0.85" />
      <text x="165" y="62" textAnchor="middle" fontSize="7.5" fill="white" fontWeight="700">Neutrale</text>
      <rect x="142" y="75" width="46" height="18" rx="9" fill="#ef4444" opacity="0.8" />
      <text x="165" y="87" textAnchor="middle" fontSize="8" fill="white" fontWeight="700">Negativo</text>
      {/* Connecting lines */}
      <line x1="130" y1="57" x2="142" y2="57" stroke="#3b82f6" strokeWidth="1" strokeDasharray="3,2" opacity="0.5" />
      <line x1="130" y1="69" x2="145" y2="62" stroke="#6366f1" strokeWidth="1" strokeDasharray="3,2" opacity="0.5" />
      <line x1="130" y1="77" x2="142" y2="82" stroke="#ef4444" strokeWidth="1" strokeDasharray="3,2" opacity="0.5" />
    </svg>
  )
}

function DataIllustration() {
  return (
    <svg viewBox="0 0 200 130" className="w-full h-full" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="130" rx="12" fill="#f0fdf4" />
      {/* Bar chart */}
      <rect x="25" y="90" width="20" height="30" rx="3" fill="#34d399" opacity="0.8" />
      <rect x="50" y="70" width="20" height="50" rx="3" fill="#10b981" opacity="0.9" />
      <rect x="75" y="50" width="20" height="70" rx="3" fill="#059669" />
      <rect x="100" y="65" width="20" height="55" rx="3" fill="#10b981" opacity="0.85" />
      <rect x="125" y="40" width="20" height="80" rx="3" fill="#059669" />
      {/* Trend line */}
      <polyline points="35,75 60,55 85,38 110,50 135,30" stroke="#6ee7b7" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* Data points */}
      <circle cx="35" cy="75" r="4" fill="white" stroke="#10b981" strokeWidth="2" />
      <circle cx="60" cy="55" r="4" fill="white" stroke="#10b981" strokeWidth="2" />
      <circle cx="85" cy="38" r="4" fill="white" stroke="#10b981" strokeWidth="2" />
      <circle cx="110" cy="50" r="4" fill="white" stroke="#10b981" strokeWidth="2" />
      <circle cx="135" cy="30" r="5" fill="#10b981" stroke="white" strokeWidth="2" />
      {/* Table snippet */}
      <rect x="150" y="20" width="40" height="90" rx="6" fill="white" stroke="#bbf7d0" strokeWidth="1.5" />
      <rect x="150" y="20" width="40" height="16" rx="6" fill="#bbf7d0" />
      <rect x="150" y="28" width="40" height="8" fill="#bbf7d0" />
      <text x="170" y="32" textAnchor="middle" fontSize="6" fill="#065f46" fontWeight="700">Feature</text>
      {[0,1,2,3,4].map(i => (
        <g key={i}>
          <rect x="152" y={40 + i*14} width="36" height="12" rx="2" fill={i % 2 === 0 ? '#f0fdf4' : 'white'} />
          <rect x="154" y={43 + i*14} width="14" height="5" rx="1.5" fill="#6ee7b7" />
          <rect x="172" y={43 + i*14} width="12" height="5" rx="1.5" fill="#a7f3d0" />
        </g>
      ))}
      {/* Accuracy badge */}
      <rect x="15" y="15" width="56" height="20" rx="10" fill="#10b981" />
      <text x="43" y="28" textAnchor="middle" fontSize="8.5" fill="white" fontWeight="800">Accuratezza</text>
      <rect x="19" y="37" width="48" height="16" rx="8" fill="#10b981" opacity="0.2" />
      <text x="43" y="48" textAnchor="middle" fontSize="9" fill="#059669" fontWeight="800">94.2%</text>
    </svg>
  )
}

function MLLabHome({
  onSelect,
  t,
}: {
  onSelect: (mode: ClassificationMode) => void
  t: (key: string) => string
}) {
  const modes = [
    {
      key: 'images' as const,
      icon: Camera,
      gradient: 'from-rose-500 to-pink-600',
      gradientLight: 'from-rose-50 to-pink-50',
      borderColor: 'border-rose-200',
      hoverBorder: 'hover:border-rose-400',
      accentColor: 'text-rose-600',
      badgeBg: 'bg-rose-100 text-rose-700',
      title: t('classification.mode_images'),
      description: t('classification.mode_images_desc'),
      features: ['Webcam in tempo reale', 'Addestramento in-browser', 'Fino a 10 classi'],
      illustration: ImagesIllustration,
    },
    {
      key: 'text' as const,
      icon: Type,
      gradient: 'from-blue-500 to-indigo-600',
      gradientLight: 'from-blue-50 to-indigo-50',
      borderColor: 'border-blue-200',
      hoverBorder: 'hover:border-blue-400',
      accentColor: 'text-blue-600',
      badgeBg: 'bg-blue-100 text-blue-700',
      title: t('classification.mode_text'),
      description: t('classification.mode_text_desc'),
      features: ['Analisi del sentiment', 'Dataset generabili via AI', 'Classificazione multiclasse'],
      illustration: TextIllustration,
    },
    {
      key: 'data' as const,
      icon: Database,
      gradient: 'from-emerald-500 to-teal-600',
      gradientLight: 'from-emerald-50 to-teal-50',
      borderColor: 'border-emerald-200',
      hoverBorder: 'hover:border-emerald-400',
      accentColor: 'text-emerald-600',
      badgeBg: 'bg-emerald-100 text-emerald-700',
      title: t('classification.mode_data'),
      description: t('classification.mode_data_desc'),
      features: ['Import CSV / Excel', 'Visualizzazione interattiva', 'Modello personalizzabile'],
      illustration: DataIllustration,
    },
  ]

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-50 via-white to-slate-50 p-6 md:p-10">
      <div className="max-w-6xl mx-auto">

        {/* Hero header */}
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-violet-100 to-indigo-100 border border-violet-200/60 mb-4">
            <Sparkles className="h-3.5 w-3.5 text-violet-600" />
            <span className="text-xs font-semibold text-violet-700 uppercase tracking-wide">Machine Learning Lab</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-3">
            {t('classification.title')}
          </h1>
          <p className="text-base text-slate-500 max-w-xl mx-auto leading-relaxed">
            {t('classification.subtitle')}
          </p>
        </motion.div>

        {/* Educational banner */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.1 }}
          className="mb-8 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 p-5 flex gap-4 shadow-lg shadow-indigo-200/50"
        >
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center">
            <Lightbulb className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-white mb-1.5">Come usare il ML Lab</p>
            <ul className="text-xs text-indigo-100 space-y-1">
              <li className="flex items-start gap-2">
                <span className="mt-1 inline-block w-1.5 h-1.5 rounded-full bg-indigo-300 flex-shrink-0" />
                Puoi <strong className="text-white mx-0.5">generare dataset</strong> nella sezione Chatbot (assistente Dataset Generator) e usarli qui per la classificazione testo e dati.
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-1 inline-block w-1.5 h-1.5 rounded-full bg-violet-300 flex-shrink-0" />
                Puoi <strong className="text-white mx-0.5">classificare immagini</strong> addestrando un modello direttamente dalla tua fotocamera in tempo reale!
              </li>
            </ul>
          </div>
        </motion.div>

        {/* Mode cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {modes.map((m, i) => {
            const Illustration = m.illustration
            return (
              <motion.div
                key={m.key}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.15 + i * 0.1 }}
                whileHover={{ y: -6, scale: 1.01 }}
                whileTap={{ scale: 0.97 }}
                onClick={() => onSelect(m.key)}
                className={`group relative rounded-2xl border-2 ${m.borderColor} ${m.hoverBorder} bg-white shadow-md hover:shadow-xl transition-all duration-300 cursor-pointer overflow-hidden`}
              >
                {/* Illustration area */}
                <div className={`relative h-44 bg-gradient-to-br ${m.gradientLight} p-4 overflow-hidden`}>
                  <div className="absolute inset-0 opacity-10">
                    <div className="absolute -top-4 -right-4 w-24 h-24 rounded-full bg-current" />
                    <div className="absolute -bottom-6 -left-6 w-32 h-32 rounded-full bg-current" />
                  </div>
                  <Illustration />
                </div>

                {/* Content */}
                <div className="p-5">
                  {/* Icon + title */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${m.gradient} flex items-center justify-center shadow-md`}>
                      <m.icon className="h-5 w-5 text-white" />
                    </div>
                    <h3 className="text-base font-bold text-slate-800 leading-tight">{m.title}</h3>
                  </div>

                  {/* Description */}
                  <p className="text-sm text-slate-500 leading-relaxed mb-4">{m.description}</p>

                  {/* Feature pills */}
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {m.features.map(f => (
                      <span key={f} className={`text-[11px] font-medium px-2.5 py-0.5 rounded-full ${m.badgeBg}`}>
                        {f}
                      </span>
                    ))}
                  </div>

                  {/* CTA */}
                  <div className={`flex items-center gap-1.5 text-sm font-semibold ${m.accentColor} group-hover:gap-2.5 transition-all duration-200`}>
                    Inizia ora
                    <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                  </div>
                </div>

                {/* Top-right badge */}
                <div className={`absolute top-3 right-3 w-8 h-8 rounded-full bg-gradient-to-br ${m.gradient} flex items-center justify-center shadow-lg opacity-80 group-hover:opacity-100 transition-opacity`}>
                  <m.icon className="h-4 w-4 text-white" />
                </div>
              </motion.div>
            )
          })}
        </div>

        {/* Footer note */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-8 text-xs text-slate-400 text-center flex items-center justify-center gap-1.5"
        >
          <Info className="h-3.5 w-3.5" />
          Il processing avviene interamente nel browser — nessun dato viene inviato al server.
        </motion.p>
      </div>
    </div>
  )
}

// ─── SubViewHeader ────────────────────────────────────────────────────────────

function SubViewHeader({
  icon: Icon,
  title,
  onBack,
  onOpenDatasetCreator,
  iconBg,
  iconColor,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  onBack: () => void
  onOpenDatasetCreator?: () => void
  iconBg: string
  iconColor: string
}) {
  return (
    <div className="flex items-center gap-3 mb-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 text-slate-500 hover:text-slate-700 flex-shrink-0">
        <ArrowLeft className="h-4 w-4" />
        ML Lab
      </Button>
      <div className="flex-1 flex items-center gap-2">
        <div className={`w-8 h-8 rounded-xl ${iconBg} ${iconColor} flex items-center justify-center`}>
          <Icon className="h-4 w-4" />
        </div>
        <h2 className="text-base font-bold text-slate-800">{title}</h2>
      </div>
      {onOpenDatasetCreator && (
        <Button size="sm" variant="outline" onClick={onOpenDatasetCreator} className="gap-1.5 flex-shrink-0">
          <Sparkles className="h-4 w-4" />
          Crea Dataset
        </Button>
      )}
    </div>
  )
}

// ─── ImageClassification ──────────────────────────────────────────────────────

function ImageClassification({ onBack, sessionId }: { onBack: () => void; sessionId?: string }) {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [classes, setClasses] = useState<ImageClass[]>([
    { id: '1', name: 'Classe 1', samples: [], color: CLASS_COLORS[0] },
    { id: '2', name: 'Classe 2', samples: [], color: CLASS_COLORS[1] },
  ])
  const [isCapturing, setIsCapturing] = useState<string | null>(null)
  const [isTraining, setIsTraining] = useState(false)
  const [model, setModel] = useState<tf.LayersModel | null>(null)
  const [isPredicting, setIsPredicting] = useState(false)
  const [predictions, setPredictions] = useState<{className: string, confidence: number}[]>([])
  const [isUploadingImages, setIsUploadingImages] = useState<string | null>(null)
  const [isSharingModel, setIsSharingModel] = useState(false)
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())
  const loadModelInputRef = useRef<HTMLInputElement>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const captureIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const predictionIntervalRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    const initWebcam = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 224, height: 224, facingMode: 'user' }
        })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
        }
      } catch (err) {
        console.error('Webcam error:', err)
      }
    }
    initWebcam()

    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks()
        tracks.forEach(track => track.stop())
      }
      if (captureIntervalRef.current) clearInterval(captureIntervalRef.current)
      if (predictionIntervalRef.current) clearInterval(predictionIntervalRef.current)
    }
  }, [])

  const captureFrame = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return null
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return null
    canvasRef.current.width = 64
    canvasRef.current.height = 64
    ctx.drawImage(videoRef.current, 0, 0, 64, 64)
    return canvasRef.current.toDataURL('image/jpeg', 0.5)
  }, [])

  const startCapturing = (classId: string) => {
    setIsCapturing(classId)
    captureIntervalRef.current = setInterval(() => {
      const frame = captureFrame()
      if (frame) {
        setClasses(prev => prev.map(c => {
          if (c.id === classId && c.samples.length < 100) {
            return { ...c, samples: [...c.samples, frame] }
          }
          return c
        }))
      }
    }, 100)
  }

  const stopCapturing = () => {
    setIsCapturing(null)
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current)
      captureIntervalRef.current = null
    }
  }

  const addClass = () => {
    if (classes.length >= 5) return
    const newId = String(classes.length + 1)
    setClasses([...classes, {
      id: newId,
      name: `Classe ${newId}`,
      samples: [],
      color: CLASS_COLORS[classes.length]
    }])
  }

  const removeClass = (id: string) => {
    if (classes.length <= 2) return
    setClasses(classes.filter(c => c.id !== id))
  }

  const clearSamples = (id: string) => {
    setClasses(classes.map(c => c.id === id ? { ...c, samples: [] } : c))
  }

  const updateClassName = (id: string, name: string) => {
    setClasses(classes.map(c => c.id === id ? { ...c, name } : c))
  }

  // ── Image file upload ────────────────────────────────────────────────────────

  const handleFileUpload = async (classId: string, files: FileList) => {
    const cls = classes.find(c => c.id === classId)
    if (!cls) return
    const remaining = 100 - cls.samples.length
    if (remaining <= 0) return
    const filesToProcess = Array.from(files).slice(0, remaining)
    setIsUploadingImages(classId)
    const newSamples: string[] = []
    for (const file of filesToProcess) {
      const base64 = await new Promise<string>((resolve) => {
        const img = new Image()
        const url = URL.createObjectURL(file)
        img.onload = () => {
          const canvas = document.createElement('canvas')
          canvas.width = 64
          canvas.height = 64
          const ctx = canvas.getContext('2d')!
          // Center-crop to square, then scale to 64x64
          const size = Math.min(img.width, img.height)
          const sx = (img.width - size) / 2
          const sy = (img.height - size) / 2
          ctx.drawImage(img, sx, sy, size, size, 0, 0, 64, 64)
          URL.revokeObjectURL(url)
          resolve(canvas.toDataURL('image/jpeg', 0.8))
        }
        img.src = url
      })
      newSamples.push(base64)
    }
    setClasses(prev => prev.map(c =>
      c.id === classId ? { ...c, samples: [...c.samples, ...newSamples].slice(0, 100) } : c
    ))
    setIsUploadingImages(null)
    toast({ title: `${newSamples.length} immagini aggiunte`, description: `Classe aggiornata con ${newSamples.length} nuovi campioni.` })
  }

  // ── Model save / share / load ────────────────────────────────────────────────

  const serializeModel = (): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!model) { reject(new Error('No model')); return }
      model.save(tf.io.withSaveHandler(async (artifacts) => {
        try {
          const weightBuffer = artifacts.weightData as ArrayBuffer
          const bytes = new Uint8Array(weightBuffer)
          let binary = ''
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
          const weightDataBase64 = btoa(binary)
          resolve(JSON.stringify({
            modelTopology: artifacts.modelTopology,
            weightSpecs: artifacts.weightSpecs,
            weightDataBase64,
            classNames: classes.map(c => c.name),
          }))
        } catch (e) { reject(e) }
        return { modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' as const } }
      })).catch(reject)
    })
  }

  const downloadModel = async () => {
    try {
      const json = await serializeModel()
      const name = `classificatore-${classes.map(c => c.name).join('-')}.tfmodel.json`
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = name; a.click()
      URL.revokeObjectURL(url)
    } catch { toast({ title: 'Errore salvataggio', variant: 'destructive' }) }
  }

  const shareModelToChat = async () => {
    if (!model || !sessionId) return
    setIsSharingModel(true)
    try {
      const json = await serializeModel()
      const name = `classificatore-${classes.map(c => c.name).join('-')}.tfmodel.json`
      const file = new File([json], name, { type: 'application/json' })
      const uploadRes = await chatApi.uploadFiles(sessionId, [file])
      const fileUrl: string = uploadRes.data.urls?.[0]
      await chatApi.sendSessionMessage(
        sessionId,
        `🤖 Modello ML condiviso: *${classes.map(c => c.name).join(' / ')}*\nScarica il file e importalo nel Lab ML per usarlo direttamente.`,
        [{ url: fileUrl, name, type: 'application/json' }]
      )
      toast({ title: 'Modello condiviso!', description: 'Il modello è stato inviato nella chat di classe.' })
    } catch { toast({ title: 'Errore condivisione', variant: 'destructive' }) }
    finally { setIsSharingModel(false) }
  }

  const loadModelFromFile = async (file: File) => {
    try {
      const text = await file.text()
      const data = JSON.parse(text)
      const binary = atob(data.weightDataBase64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const loadedModel = await tf.loadLayersModel(tf.io.fromMemory({
        modelTopology: data.modelTopology,
        weightSpecs: data.weightSpecs,
        weightData: bytes.buffer,
      }))
      setModel(loadedModel)
      setClasses((data.classNames as string[]).map((name, i) => ({
        id: String(i + 1), name, samples: [], color: CLASS_COLORS[i % CLASS_COLORS.length],
      })))
      toast({ title: 'Modello caricato!', description: `Classi: ${(data.classNames as string[]).join(', ')}` })
    } catch { toast({ title: 'Errore caricamento modello', description: 'File non valido o corrotto.', variant: 'destructive' }) }
  }

  const trainModel = async () => {
    const totalSamples = classes.reduce((sum, c) => sum + c.samples.length, 0)
    if (totalSamples < 10) {
      alert(t('classification.min_samples_image'))
      return
    }

    setIsTraining(true)

    try {
      const xs: number[][] = []
      const ys: number[] = []

      for (let classIdx = 0; classIdx < classes.length; classIdx++) {
        const cls = classes[classIdx]
        for (const sample of cls.samples) {
          const img = new Image()
          img.src = sample
          await new Promise(resolve => img.onload = resolve)

          const canvas = document.createElement('canvas')
          canvas.width = 64
          canvas.height = 64
          const ctx = canvas.getContext('2d')!
          ctx.drawImage(img, 0, 0, 64, 64)

          const imageData = ctx.getImageData(0, 0, 64, 64)
          const pixels: number[] = []
          for (let i = 0; i < imageData.data.length; i += 4) {
            pixels.push(imageData.data[i] / 255)
            pixels.push(imageData.data[i + 1] / 255)
            pixels.push(imageData.data[i + 2] / 255)
          }
          xs.push(pixels)
          ys.push(classIdx)
        }
      }

      const numClasses = classes.length
      const newModel = tf.sequential({
        layers: [
          tf.layers.dense({ inputShape: [64 * 64 * 3], units: 128, activation: 'relu' }),
          tf.layers.dropout({ rate: 0.2 }),
          tf.layers.dense({ units: 64, activation: 'relu' }),
          tf.layers.dense({ units: numClasses, activation: 'softmax' })
        ]
      })

      newModel.compile({
        optimizer: tf.train.adam(0.001),
        loss: 'sparseCategoricalCrossentropy',
        metrics: ['accuracy']
      })

      const xTensor = tf.tensor2d(xs)
      const yTensor = tf.tensor1d(ys, 'float32')

      await newModel.fit(xTensor, yTensor, {
        epochs: 20,
        batchSize: 16,
        shuffle: true,
        validationSplit: 0.1,
      })

      setModel(newModel)
      xTensor.dispose()
      yTensor.dispose()

    } catch (err) {
      console.error('Training error:', err)
      alert(t('classification.training_error'))
    } finally {
      setIsTraining(false)
    }
  }

  const startPrediction = () => {
    if (!model) return
    setIsPredicting(true)

    predictionIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || !canvasRef.current || !model) return

      const ctx = canvasRef.current.getContext('2d')
      if (!ctx) return

      canvasRef.current.width = 64
      canvasRef.current.height = 64
      ctx.drawImage(videoRef.current, 0, 0, 64, 64)

      const imageData = ctx.getImageData(0, 0, 64, 64)
      const pixels: number[] = []
      for (let i = 0; i < imageData.data.length; i += 4) {
        pixels.push(imageData.data[i] / 255)
        pixels.push(imageData.data[i + 1] / 255)
        pixels.push(imageData.data[i + 2] / 255)
      }

      const input = tf.tensor2d([pixels])
      const prediction = model.predict(input) as tf.Tensor
      const probs = await prediction.data()

      const results = classes.map((c, i) => ({
        className: c.name,
        confidence: probs[i] * 100
      }))
      setPredictions(results)
      input.dispose()
      prediction.dispose()
    }, 200)
  }

  const stopPrediction = () => {
    setIsPredicting(false)
    if (predictionIntervalRef.current) {
      clearInterval(predictionIntervalRef.current)
      predictionIntervalRef.current = null
    }
    setPredictions([])
  }

  const totalSamples = classes.reduce((sum, c) => sum + c.samples.length, 0)
  const topPrediction = predictions.length > 0
    ? predictions.reduce((a, b) => a.confidence > b.confidence ? a : b)
    : null

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        <SubViewHeader
          icon={Camera}
          title="Classificazione Immagini"
          onBack={onBack}
          iconBg="bg-rose-100"
          iconColor="text-rose-600"
        />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pb-20 lg:pb-0">
          {/* Webcam Panel */}
          <Card className="lg:col-span-1 rounded-xl border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Camera className="h-5 w-5" />
                Webcam
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="relative aspect-square bg-black rounded-xl overflow-hidden mb-4">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover"
                  style={{ transform: 'scaleX(-1)' }}
                />
                {isPredicting && topPrediction && (
                  <div
                    className="absolute bottom-0 left-0 right-0 p-2 backdrop-blur-md border-t border-white/20"
                    style={{
                      backgroundColor: (() => {
                        const colorClass = classes.find(c => c.name === topPrediction.className)?.color || ''
                        if (colorClass.includes('rose')) return 'rgba(244, 63, 94, 0.8)'
                        if (colorClass.includes('blue')) return 'rgba(59, 130, 246, 0.8)'
                        if (colorClass.includes('emerald')) return 'rgba(16, 185, 129, 0.8)'
                        if (colorClass.includes('amber')) return 'rgba(245, 158, 11, 0.8)'
                        if (colorClass.includes('purple')) return 'rgba(168, 85, 247, 0.8)'
                        return 'rgba(0,0,0,0.7)'
                      })()
                    }}
                  >
                    <div className="text-white text-sm font-bold flex items-center justify-between">
                      <span>{topPrediction.className}</span>
                      <span>{topPrediction.confidence.toFixed(1)}%</span>
                    </div>
                  </div>
                )}
              </div>
              <canvas ref={canvasRef} className="hidden" />

              {model ? (
                <div className="space-y-2">
                  <Button
                    className="w-full"
                    variant={isPredicting ? "destructive" : "default"}
                    onClick={isPredicting ? stopPrediction : startPrediction}
                  >
                    {isPredicting ? (
                      <><Square className="h-4 w-4 mr-2" /> {t('classification.stop')}</>
                    ) : (
                      <><Play className="h-4 w-4 mr-2" /> {t('classification.start')}</>
                    )}
                  </Button>
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={downloadModel} title="Scarica modello">
                      <Download className="h-4 w-4 mr-1" /> Scarica
                    </Button>
                    {sessionId && (
                      <Button variant="outline" className="flex-1" onClick={shareModelToChat} disabled={isSharingModel} title="Condividi in chat di classe">
                        {isSharingModel ? <Loader2 className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4 mr-1" />}
                        Condividi
                      </Button>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => { setModel(null); stopPrediction() }}
                  >
                    {t('classification.reset_model')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Button
                    className="w-full"
                    onClick={trainModel}
                    disabled={isTraining || totalSamples < 10}
                  >
                    {isTraining ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Training...</>
                    ) : (
                      <><BarChart3 className="h-4 w-4 mr-2" /> Addestra Modello ({totalSamples} samples)</>
                    )}
                  </Button>
                  <div className="relative">
                    <input
                      ref={loadModelInputRef}
                      type="file"
                      accept=".json,.tfmodel.json"
                      className="hidden"
                      onChange={e => { if (e.target.files?.[0]) loadModelFromFile(e.target.files[0]) }}
                    />
                    <Button variant="outline" className="w-full" onClick={() => loadModelInputRef.current?.click()}>
                      <FolderOpen className="h-4 w-4 mr-2" /> Carica modello
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Classes Panel */}
          <Card className="lg:col-span-2 rounded-xl border-slate-200">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Classi ({classes.length}/5)</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={addClass}
                  disabled={classes.length >= 5}
                >
                  <Plus className="h-4 w-4 mr-1" /> Aggiungi
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {classes.map((cls) => (
                <div key={cls.id} className="border border-slate-200 rounded-xl p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`w-4 h-4 rounded ${cls.color}`} />
                    <Input
                      value={cls.name}
                      onChange={(e) => updateClassName(cls.id, e.target.value)}
                      className="h-8 flex-1"
                    />
                    <span className="text-sm text-muted-foreground">
                      {cls.samples.length}/100
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => clearSamples(cls.id)}
                      disabled={cls.samples.length === 0}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    {classes.length > 2 && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeClass(cls.id)}
                      >
                        <XCircle className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 mb-2">
                    <Button
                      size="sm"
                      variant={isCapturing === cls.id ? "destructive" : "secondary"}
                      className="h-12 flex-1 touch-manipulation"
                      onMouseDown={() => startCapturing(cls.id)}
                      onMouseUp={stopCapturing}
                      onMouseLeave={stopCapturing}
                      onTouchStart={() => startCapturing(cls.id)}
                      onTouchEnd={stopCapturing}
                      disabled={cls.samples.length >= 100 || (isCapturing !== null && isCapturing !== cls.id)}
                    >
                      <Camera className="h-5 w-5 mr-2" />
                      {isCapturing === cls.id ? 'Rilascia...' : 'Tieni premuto'}
                    </Button>
                    <div className="relative">
                      <input
                        ref={el => { if (el) fileInputRefs.current.set(cls.id, el); else fileInputRefs.current.delete(cls.id) }}
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={e => { if (e.target.files) handleFileUpload(cls.id, e.target.files); e.target.value = '' }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-12 w-12"
                        title="Carica immagini da file"
                        onClick={() => fileInputRefs.current.get(cls.id)?.click()}
                        disabled={cls.samples.length >= 100 || isUploadingImages === cls.id}
                      >
                        {isUploadingImages === cls.id
                          ? <Loader2 className="h-4 w-4 animate-spin" />
                          : <Paperclip className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {cls.samples.map((sample, idx) => (
                      <img
                        key={idx}
                        src={sample}
                        alt={`Sample ${idx}`}
                        className="w-8 h-8 object-cover rounded border"
                      />
                    ))}
                    {cls.samples.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Nessun sample. Tieni premuto il pulsante per acquisire.
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Predictions Panel */}
          {isPredicting && predictions.length > 0 && (
            <Card className="lg:col-span-3 rounded-xl border-slate-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Risultati Classificazione</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {predictions.map((pred) => {
                    const classInfo = classes.find(c => c.name === pred.className)
                    const colorClass = classInfo ? classInfo.color : 'bg-gray-500'
                    const isTop = pred.className === topPrediction?.className

                    return (
                      <div key={pred.className} className={`flex items-center gap-3 ${isTop ? 'font-semibold' : ''}`}>
                        <span className="w-24 text-sm truncate">{pred.className}</span>
                        <div className="flex-1 bg-gray-200 rounded-full h-4 overflow-hidden">
                          <div
                            className={`h-full ${colorClass} transition-all duration-200`}
                            style={{ width: `${pred.confidence}%` }}
                          />
                        </div>
                        <span className="w-16 text-sm text-right">{pred.confidence.toFixed(1)}%</span>
                      </div>
                    )
                  })}
                </div>

                <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <div className="flex items-start gap-2">
                    <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5" />
                    <div className="text-xs text-amber-800">
                      <strong>Spiegazione:</strong> Il modello analizza i pixel dell'immagine (64x64, {64*64*3} valori RGB normalizzati)
                      attraverso una rete neurale con 2 layer densi. La classe "{topPrediction?.className}" ha la confidenza più alta
                      ({topPrediction?.confidence.toFixed(1)}%) perché i pattern visivi catturati sono più simili ai {classes.find(c => c.name === topPrediction?.className)?.samples.length || 0} samples
                      di training di quella classe.
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── TextClassification ───────────────────────────────────────────────────────

function TextClassification({
  onBack,
  onOpenDatasetCreator,
  pendingCsvData,
  onCsvConsumed,
}: {
  onBack: () => void
  onOpenDatasetCreator: () => void
  pendingCsvData?: string | null
  onCsvConsumed: () => void
}) {
  const [samples, setSamples] = useState<TextSample[]>([])
  const [isTraining, setIsTraining] = useState(false)
  const [model, setModel] = useState<tf.LayersModel | null>(null)
  const [testText, setTestText] = useState('')
  const [prediction, setPrediction] = useState<{label: string, confidence: number} | null>(null)
  const [labels, setLabels] = useState<string[]>([])
  const [vocabulary, setVocabulary] = useState<Map<string, number>>(new Map())
  const fileInputRef = useRef<HTMLInputElement>(null)

  const parseCsvSamples = (text: string) => {
    const lines = text.split('\n').filter((l: string) => l.trim())
    const newSamples: TextSample[] = []
    const uniqueLabels = new Set<string>()
    for (const line of lines) {
      const parts = line.includes(';') ? line.split(';') : line.split(',')
      if (parts.length >= 2) {
        const label = parts[parts.length - 1].trim().replace(/"/g, '')
        const txt = parts.slice(0, -1).join(',').trim().replace(/"/g, '')
        if (txt && label) {
          newSamples.push({ text: txt, label })
          uniqueLabels.add(label)
        }
      }
    }
    return { newSamples, uniqueLabels }
  }

  // Auto-load pending CSV
  useEffect(() => {
    if (!pendingCsvData) return
    const { newSamples, uniqueLabels } = parseCsvSamples(pendingCsvData)
    if (newSamples.length > 0) {
      setSamples(newSamples)
      setLabels(Array.from(uniqueLabels))
    }
    onCsvConsumed()
  }, [pendingCsvData]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      const { newSamples, uniqueLabels } = parseCsvSamples(text)
      setSamples(newSamples)
      setLabels(Array.from(uniqueLabels))
    }
    reader.readAsText(file)
  }

  const textToBoW = (text: string, vocab: Map<string, number>, vocabSize: number): number[] => {
    const bow = new Array(vocabSize).fill(0)
    const words = text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/)
    words.forEach(word => {
      const idx = vocab.get(word)
      if (idx !== undefined) {
        bow[idx] += 1
      }
    })
    const sum = bow.reduce((a: number, b: number) => a + b, 0)
    if (sum > 0) {
      for (let i = 0; i < bow.length; i++) {
        bow[i] = bow[i] / sum
      }
    }
    return bow
  }

  const trainModel = async () => {
    if (samples.length < 10 || labels.length < 2) {
      alert('Carica almeno 10 samples con almeno 2 etichette diverse')
      return
    }

    setIsTraining(true)

    try {
      const wordCounts = new Map<string, number>()
      samples.forEach(s => {
        const words = s.text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/)
        words.forEach(word => {
          if (word.length > 2) {
            wordCounts.set(word, (wordCounts.get(word) || 0) + 1)
          }
        })
      })

      const vocab = new Map<string, number>()
      let idx = 0
      wordCounts.forEach((count, word) => {
        if (count >= 2) {
          vocab.set(word, idx++)
        }
      })
      setVocabulary(vocab)

      const vocabSize = vocab.size
      if (vocabSize < 5) {
        alert('Vocabolario troppo piccolo. Carica più testi con parole diverse.')
        setIsTraining(false)
        return
      }

      const xs = samples.map(s => textToBoW(s.text, vocab, vocabSize))
      const labelToIdx = new Map(labels.map((l, i) => [l, i]))
      const ys = samples.map(s => labelToIdx.get(s.label) || 0)

      const newModel = tf.sequential({
        layers: [
          tf.layers.dense({ inputShape: [vocabSize], units: 64, activation: 'relu' }),
          tf.layers.dropout({ rate: 0.3 }),
          tf.layers.dense({ units: 32, activation: 'relu' }),
          tf.layers.dropout({ rate: 0.2 }),
          tf.layers.dense({ units: labels.length, activation: 'softmax' })
        ]
      })

      newModel.compile({
        optimizer: tf.train.adam(0.01),
        loss: 'sparseCategoricalCrossentropy',
        metrics: ['accuracy']
      })

      const xTensor = tf.tensor2d(xs)
      const yTensor = tf.tensor1d(ys, 'float32')

      await newModel.fit(xTensor, yTensor, {
        epochs: 50,
        batchSize: Math.min(16, Math.floor(samples.length / 2)),
        shuffle: true,
        validationSplit: 0.15,
        callbacks: {
          onEpochEnd: (epoch, logs) => {
            console.log(`Epoch ${epoch + 1}: loss=${logs?.loss?.toFixed(4)}, acc=${logs?.acc?.toFixed(4)}`)
          }
        }
      })

      setModel(newModel)
      xTensor.dispose()
      yTensor.dispose()

    } catch (err) {
      console.error('Training error:', err)
      alert('Errore durante il training: ' + (err as Error).message)
    } finally {
      setIsTraining(false)
    }
  }

  const predict = async () => {
    if (!model || !testText.trim()) return

    const bow = textToBoW(testText, vocabulary, vocabulary.size)
    const input = tf.tensor2d([bow])
    const pred = model.predict(input) as tf.Tensor
    const probs = await pred.data()

    const probsArray = Array.from(probs)
    const maxIdx = probsArray.indexOf(Math.max(...probsArray))
    setPrediction({
      label: labels[maxIdx],
      confidence: probs[maxIdx] * 100
    })

    input.dispose()
    pred.dispose()
  }

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        <SubViewHeader
          icon={Type}
          title="Classificazione Testo"
          onBack={onBack}
          onOpenDatasetCreator={onOpenDatasetCreator}
          iconBg="bg-blue-100"
          iconColor="text-blue-600"
        />

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Upload Panel */}
          <Card className="rounded-xl border-slate-200">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Carica Dataset
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div
                className="border-2 border-dashed rounded-xl p-6 text-center transition-colors"
                onDragOver={(e) => {
                  e.preventDefault()
                  e.currentTarget.classList.add('border-blue-500', 'bg-blue-50')
                }}
                onDragLeave={(e) => {
                  e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50')
                }}
                onDrop={async (e) => {
                  e.preventDefault()
                  e.currentTarget.classList.remove('border-blue-500', 'bg-blue-50')
                  const sessionFileData = e.dataTransfer.getData('application/x-session-file')
                  if (sessionFileData) {
                    try {
                      const data = JSON.parse(sessionFileData)
                      let fileUrl = data.url as string
                      if (fileUrl.includes('/api/v1/files/') && fileUrl.endsWith('/download-url')) {
                        const res = await fetch(fileUrl)
                        const json = await res.json()
                        fileUrl = json.download_url || json.url || fileUrl
                      }
                      const res = await fetch(fileUrl)
                      const blob = await res.blob()
                      const fileObj = new globalThis.File([blob], data.filename || 'file', {
                        type: data.mime_type || blob.type || 'application/octet-stream'
                      })
                      if (fileObj.name.endsWith('.csv') || fileObj.name.endsWith('.txt')) {
                        const reader = new FileReader()
                        reader.onload = (event) => {
                          const text = event.target?.result as string
                          const { newSamples, uniqueLabels } = parseCsvSamples(text)
                          if (newSamples.length > 0) {
                            setSamples(newSamples)
                            setLabels(Array.from(uniqueLabels))
                          }
                        }
                        reader.readAsText(fileObj)
                      }
                    } catch (err) {
                      console.error('Failed to handle session file drop', err)
                    }
                    return
                  }
                  const csvData = e.dataTransfer.getData('application/x-chatbot-csv')
                  if (csvData) {
                    const { newSamples, uniqueLabels } = parseCsvSamples(csvData)
                    if (newSamples.length > 0) {
                      setSamples(newSamples)
                      setLabels(Array.from(uniqueLabels))
                    }
                  } else {
                    const files = e.dataTransfer.files
                    if (files.length > 0) {
                      const file = files[0]
                      if (file.name.endsWith('.csv') || file.name.endsWith('.txt')) {
                        const reader = new FileReader()
                        reader.onload = (event) => {
                          const text = event.target?.result as string
                          const { newSamples, uniqueLabels } = parseCsvSamples(text)
                          if (newSamples.length > 0) {
                            setSamples(newSamples)
                            setLabels(Array.from(uniqueLabels))
                          }
                        }
                        reader.readAsText(file)
                      }
                    }
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" />
                  Seleziona CSV
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  Formato: testo,etichetta (una riga per sample)
                </p>
                <p className="text-xs text-blue-500 mt-1">
                  Puoi anche trascinare un CSV qui
                </p>
              </div>

              {samples.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium">
                    {samples.length} samples caricati
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {labels.map((label, idx) => (
                      <span
                        key={label}
                        className={`text-xs px-2 py-1 rounded ${CLASS_COLORS[idx % CLASS_COLORS.length]} text-white`}
                      >
                        {label}: {samples.filter(s => s.label === label).length}
                      </span>
                    ))}
                  </div>

                  <div className="max-h-40 overflow-y-auto border rounded-xl p-2 text-xs">
                    {samples.slice(0, 10).map((s, i) => (
                      <div key={i} className="flex gap-2 py-1 border-b last:border-0">
                        <span className="flex-1 truncate">{s.text}</span>
                        <span className="font-medium">{s.label}</span>
                      </div>
                    ))}
                    {samples.length > 10 && (
                      <p className="text-muted-foreground mt-1">
                        ...e altri {samples.length - 10} samples
                      </p>
                    )}
                  </div>

                  <Button
                    className="w-full"
                    onClick={trainModel}
                    disabled={isTraining || samples.length < 10}
                  >
                    {isTraining ? (
                      <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Training...</>
                    ) : (
                      <><BarChart3 className="h-4 w-4 mr-2" /> Addestra Modello</>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Test Panel */}
          <Card className="rounded-xl border-slate-200">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Type className="h-5 w-5" />
                Testa Classificazione
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {model ? (
                <>
                  <textarea
                    value={testText}
                    onChange={(e) => setTestText(e.target.value)}
                    placeholder="Inserisci un testo da classificare..."
                    className="w-full h-32 p-3 border rounded-xl resize-none text-sm"
                  />
                  <Button onClick={predict} disabled={!testText.trim()}>
                    Classifica
                  </Button>

                  {prediction && (
                    <div className="space-y-3">
                      <div className="p-4 bg-gray-50 rounded-xl">
                        <div className="flex items-center gap-2">
                          <CheckCircle className="h-5 w-5 text-green-500" />
                          <span className="font-bold">{prediction.label}</span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">
                          Confidenza: {prediction.confidence.toFixed(1)}%
                        </p>
                      </div>

                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl">
                        <div className="flex items-start gap-2">
                          <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5" />
                          <div className="text-xs text-amber-800">
                            <strong>Spiegazione:</strong> Il modello usa un approccio Bag-of-Words con {vocabulary.size} parole nel vocabolario.
                            Il testo inserito è stato convertito in un vettore di frequenze normalizzate, poi elaborato da una rete neurale
                            con 2 layer densi. La classe "{prediction.label}" è stata scelta perché le parole nel testo sono statisticamente
                            più associate a questa etichetta nei {samples.filter(s => s.label === prediction.label).length} esempi di training
                            di quella categoria.
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-center text-muted-foreground py-8">
                  Carica un dataset e addestra il modello per testare la classificazione
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ─── DataClassification ───────────────────────────────────────────────────────

function DataClassification({
  onBack,
  onOpenDatasetCreator,
  pendingCsvData,
  onCsvConsumed,
}: {
  onBack: () => void
  onOpenDatasetCreator: () => void
  pendingCsvData?: string | null
  onCsvConsumed: () => void
}) {
  const [data, setData] = useState<DataRow[]>([])
  const [columns, setColumns] = useState<ColumnInfo[]>([])
  const [targetColumn, setTargetColumn] = useState<string | null>(null)
  const [suggestedTask, setSuggestedTask] = useState<TaskType>(null)
  const [taskExplanation, setTaskExplanation] = useState<string>('')
  const [model, setModel] = useState<tf.LayersModel | null>(null)
  const [isTraining, setIsTraining] = useState(false)
  const [prediction, setPrediction] = useState<{ value: string | number; confidence: number; explanation: string } | null>(null)
  const [inputValues, setInputValues] = useState<Record<string, string>>({})
  const [labelEncoder, setLabelEncoder] = useState<Map<string, number>>(new Map())
  const [featureScalers, setFeatureScalers] = useState<{ min: number[]; max: number[] }>({ min: [], max: [] })
  const fileInputRef = useRef<HTMLInputElement>(null)

  const analyzeColumn = (values: (string | number)[]): ColumnInfo => {
    const uniqueValues = new Set(values)
    const numericCount = values.filter(v => !isNaN(Number(v)) && v !== '').length
    const isNumeric = numericCount > values.length * 0.8

    return {
      name: '',
      type: isNumeric ? 'numeric' : 'categorical',
      uniqueValues: uniqueValues.size,
      sampleValues: Array.from(uniqueValues).slice(0, 5)
    }
  }

  const parseCsvText = (text: string) => {
    const lines = text.split('\n').filter(l => l.trim())
    if (lines.length < 2) return null
    const separator = lines[0].includes(';') ? ';' : ','
    const headers = lines[0].split(separator).map(h => h.trim().replace(/"/g, ''))
    const parsedData: DataRow[] = []

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(separator).map(v => v.trim().replace(/"/g, ''))
      if (values.length !== headers.length) continue
      const row: DataRow = {}
      headers.forEach((h, idx) => {
        const val = values[idx]
        row[h] = isNaN(Number(val)) || val === '' ? val : Number(val)
      })
      parsedData.push(row)
    }
    if (parsedData.length === 0) return null

    const columnInfos: ColumnInfo[] = headers.map(header => {
      const vals = parsedData.map(row => row[header])
      const info = analyzeColumn(vals)
      info.name = header
      return info
    })
    return { parsedData, columnInfos }
  }

  const applyParsedDataset = (parsedData: DataRow[], columnInfos: ColumnInfo[]) => {
    setData(parsedData)
    setColumns(columnInfos)
    setTargetColumn(null)
    setSuggestedTask(null)
    setModel(null)
    setPrediction(null)
    setInputValues({})
  }

  // Auto-load pending CSV
  useEffect(() => {
    if (!pendingCsvData) return
    const parsed = parseCsvText(pendingCsvData)
    if (parsed) applyParsedDataset(parsed.parsedData, parsed.columnInfos)
    onCsvConsumed()
  }, [pendingCsvData]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      const parsed = parseCsvText(text)
      if (!parsed) return
      applyParsedDataset(parsed.parsedData, parsed.columnInfos)
    }
    reader.readAsText(file)
  }

  const selectTarget = (colName: string) => {
    setTargetColumn(colName)
    const col = columns.find(c => c.name === colName)
    if (!col) return

    if (col.type === 'categorical' || (col.type === 'numeric' && col.uniqueValues <= 10)) {
      setSuggestedTask('classification')
      setTaskExplanation(
        col.type === 'categorical'
          ? `La colonna "${colName}" contiene valori categoriali (${col.uniqueValues} categorie diverse). ` +
            `Questo indica un problema di **classificazione**: il modello imparerà a predire a quale categoria appartiene un nuovo dato.`
          : `La colonna "${colName}" è numerica ma ha solo ${col.uniqueValues} valori unici. ` +
            `Questo suggerisce un problema di **classificazione** (es. classi discrete come 0/1/2).`
      )
    } else {
      setSuggestedTask('regression')
      setTaskExplanation(
        `La colonna "${colName}" contiene valori numerici continui (${col.uniqueValues} valori unici). ` +
        `Questo indica un problema di **regressione**: il modello imparerà a predire un valore numerico.`
      )
    }
  }

  const trainModel = async () => {
    if (!targetColumn || data.length < 10) return
    setIsTraining(true)

    try {
      const featureCols = columns.filter(c => c.name !== targetColumn)
      const numericFeatures = featureCols.filter(c => c.type === 'numeric')
      const categoricalFeatures = featureCols.filter(c => c.type === 'categorical')

      const catEncoders: Map<string, Map<string, number>> = new Map()
      categoricalFeatures.forEach(col => {
        const encoder = new Map<string, number>()
        const uniqueVals = [...new Set(data.map(row => String(row[col.name])))]
        uniqueVals.forEach((val, idx) => encoder.set(val, idx))
        catEncoders.set(col.name, encoder)
      })

      const xs: number[][] = data.map(row => {
        const features: number[] = []
        numericFeatures.forEach(col => {
          features.push(Number(row[col.name]) || 0)
        })
        categoricalFeatures.forEach(col => {
          const encoder = catEncoders.get(col.name)!
          const oneHot = new Array(encoder.size).fill(0)
          const idx = encoder.get(String(row[col.name]))
          if (idx !== undefined) oneHot[idx] = 1
          features.push(...oneHot)
        })
        return features
      })

      const numNumeric = numericFeatures.length
      const mins: number[] = []
      const maxs: number[] = []
      for (let i = 0; i < numNumeric; i++) {
        const vals = xs.map(x => x[i])
        const min = Math.min(...vals)
        const max = Math.max(...vals)
        mins.push(min)
        maxs.push(max === min ? 1 : max)
        xs.forEach(x => {
          x[i] = max === min ? 0 : (x[i] - min) / (max - min)
        })
      }
      setFeatureScalers({ min: mins, max: maxs })

      let ys: number[]
      let numOutputs: number

      if (suggestedTask === 'classification') {
        const encoder = new Map<string, number>()
        const uniqueTargets = [...new Set(data.map(row => String(row[targetColumn])))]
        uniqueTargets.forEach((val, idx) => encoder.set(val, idx))
        setLabelEncoder(encoder)
        ys = data.map(row => encoder.get(String(row[targetColumn])) || 0)
        numOutputs = encoder.size
      } else {
        ys = data.map(row => Number(row[targetColumn]) || 0)
        const minY = Math.min(...ys)
        const maxY = Math.max(...ys)
        ys = ys.map(y => (y - minY) / (maxY - minY || 1))
        numOutputs = 1
      }

      const inputDim = xs[0].length
      const newModel = tf.sequential({
        layers: [
          tf.layers.dense({ inputShape: [inputDim], units: 32, activation: 'relu' }),
          tf.layers.dropout({ rate: 0.2 }),
          tf.layers.dense({ units: 16, activation: 'relu' }),
          suggestedTask === 'classification'
            ? tf.layers.dense({ units: numOutputs, activation: 'softmax' })
            : tf.layers.dense({ units: 1, activation: 'linear' })
        ]
      })

      newModel.compile({
        optimizer: tf.train.adam(0.01),
        loss: suggestedTask === 'classification' ? 'sparseCategoricalCrossentropy' : 'meanSquaredError',
        metrics: ['accuracy']
      })

      const xTensor = tf.tensor2d(xs)
      const yTensor = suggestedTask === 'classification'
        ? tf.tensor1d(ys, 'float32')
        : tf.tensor2d(ys.map(y => [y]))

      await newModel.fit(xTensor, yTensor, {
        epochs: 50,
        batchSize: Math.min(16, Math.floor(data.length / 2)),
        shuffle: true,
        validationSplit: 0.15,
      })

      setModel(newModel)
      xTensor.dispose()
      yTensor.dispose()

      const initInputs: Record<string, string> = {}
      featureCols.forEach(col => {
        initInputs[col.name] = col.type === 'numeric'
          ? String(col.sampleValues[0] || '0')
          : String(col.sampleValues[0] || '')
      })
      setInputValues(initInputs)

    } catch (err) {
      console.error('Training error:', err)
      alert('Errore durante il training: ' + (err as Error).message)
    } finally {
      setIsTraining(false)
    }
  }

  const predict = async () => {
    if (!model || !targetColumn) return

    const featureCols = columns.filter(c => c.name !== targetColumn)
    const numericFeatures = featureCols.filter(c => c.type === 'numeric')
    const categoricalFeatures = featureCols.filter(c => c.type === 'categorical')

    const features: number[] = []
    const featureExplanations: string[] = []

    numericFeatures.forEach((col, i) => {
      let val = Number(inputValues[col.name]) || 0
      featureExplanations.push(`${col.name}=${val}`)
      val = (val - featureScalers.min[i]) / (featureScalers.max[i] - featureScalers.min[i] || 1)
      features.push(val)
    })

    categoricalFeatures.forEach(col => {
      const uniqueVals = [...new Set(data.map(row => String(row[col.name])))]
      const oneHot = new Array(uniqueVals.length).fill(0)
      const idx = uniqueVals.indexOf(inputValues[col.name])
      if (idx >= 0) oneHot[idx] = 1
      featureExplanations.push(`${col.name}="${inputValues[col.name]}"`)
      features.push(...oneHot)
    })

    const input = tf.tensor2d([features])
    const pred = model.predict(input) as tf.Tensor
    const probs = await pred.data()

    if (suggestedTask === 'classification') {
      const probsArray = Array.from(probs)
      const maxIdx = probsArray.indexOf(Math.max(...probsArray))
      const lbls = Array.from(labelEncoder.keys())
      const predictedLabel = lbls[maxIdx]
      const confidence = probs[maxIdx] * 100

      const topFeatures = featureExplanations.slice(0, 3).join(', ')
      const explanation = `Spiegazione: Il modello ha analizzato ${featureCols.length} caratteristiche. ` +
        `Con i valori inseriti (${topFeatures}${featureCols.length > 3 ? '...' : ''}), ` +
        `la classe più probabile è "${predictedLabel}" con confidenza ${confidence.toFixed(1)}%. ` +
        `Le altre classi hanno probabilità: ${lbls.filter((_, i) => i !== maxIdx).map((l, i) =>
          `"${l}": ${(probsArray[i < maxIdx ? i : i + 1] * 100).toFixed(1)}%`
        ).join(', ')}.`

      setPrediction({ value: predictedLabel, confidence, explanation })
    } else {
      const targetVals = data.map(row => Number(row[targetColumn]))
      const minY = Math.min(...targetVals)
      const maxY = Math.max(...targetVals)
      const predictedValue = probs[0] * (maxY - minY) + minY

      const explanation = `Spiegazione: Il modello di regressione ha stimato il valore basandosi su ${featureCols.length} caratteristiche. ` +
        `Con i valori inseriti, la predizione è ${predictedValue.toFixed(2)}. ` +
        `Il range dei dati di training va da ${minY.toFixed(2)} a ${maxY.toFixed(2)}.`

      setPrediction({ value: predictedValue.toFixed(2), confidence: 100, explanation })
    }

    input.dispose()
    pred.dispose()
  }

  return (
    <div className="p-6 md:p-8">
      <div className="max-w-5xl mx-auto">
        <SubViewHeader
          icon={Database}
          title="Classificazione Dati"
          onBack={onBack}
          onOpenDatasetCreator={onOpenDatasetCreator}
          iconBg="bg-emerald-100"
          iconColor="text-emerald-600"
        />

        <div className="space-y-4">
          {/* Upload Panel */}
          <Card className="rounded-xl border-slate-200">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Carica Dataset CSV
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="border-2 border-dashed rounded-xl p-6 text-center transition-colors"
                onDragOver={(e) => {
                  e.preventDefault()
                  e.currentTarget.classList.add('border-emerald-500', 'bg-emerald-50')
                }}
                onDragLeave={(e) => {
                  e.currentTarget.classList.remove('border-emerald-500', 'bg-emerald-50')
                }}
                onDrop={async (e) => {
                  e.preventDefault()
                  e.currentTarget.classList.remove('border-emerald-500', 'bg-emerald-50')
                  const sessionFileData = e.dataTransfer.getData('application/x-session-file')
                  if (sessionFileData) {
                    try {
                      const dropData = JSON.parse(sessionFileData)
                      let fileUrl = dropData.url as string
                      if (fileUrl.includes('/api/v1/files/') && fileUrl.endsWith('/download-url')) {
                        const res = await fetch(fileUrl)
                        const json = await res.json()
                        fileUrl = json.download_url || json.url || fileUrl
                      }
                      const res = await fetch(fileUrl)
                      const blob = await res.blob()
                      const fileObj = new globalThis.File([blob], dropData.filename || 'file', {
                        type: dropData.mime_type || blob.type || 'application/octet-stream'
                      })
                      if (fileObj.name.endsWith('.csv')) {
                        const reader = new FileReader()
                        reader.onload = (event) => {
                          const text = event.target?.result as string
                          const parsed = parseCsvText(text)
                          if (parsed) applyParsedDataset(parsed.parsedData, parsed.columnInfos)
                        }
                        reader.readAsText(fileObj)
                      }
                    } catch (err) {
                      console.error('Failed to handle session file drop', err)
                    }
                    return
                  }
                  const csvData = e.dataTransfer.getData('application/x-chatbot-csv')
                  if (csvData) {
                    const parsed = parseCsvText(csvData)
                    if (parsed) applyParsedDataset(parsed.parsedData, parsed.columnInfos)
                  } else {
                    const files = e.dataTransfer.files
                    if (files.length > 0) {
                      const file = files[0]
                      if (file.name.endsWith('.csv')) {
                        const reader = new FileReader()
                        reader.onload = (event) => {
                          const text = event.target?.result as string
                          const parsed = parseCsvText(text)
                          if (parsed) applyParsedDataset(parsed.parsedData, parsed.columnInfos)
                        }
                        reader.readAsText(file)
                      }
                    }
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Button onClick={() => fileInputRef.current?.click()} className="w-full">
                  <Upload className="h-4 w-4 mr-2" />
                  Seleziona file CSV
                </Button>
                <p className="text-xs text-emerald-500 mt-2">
                  Puoi anche trascinare un CSV qui
                </p>
              </div>

              {data.length > 0 && (
                <div className="mt-4 p-3 bg-emerald-50 rounded-xl">
                  <p className="text-sm font-medium text-emerald-700">
                    Caricati {data.length} righe, {columns.length} colonne
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {columns.map(col => (
                      <span
                        key={col.name}
                        className={`text-xs px-2 py-1 rounded ${
                          col.type === 'numeric'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-purple-100 text-purple-700'
                        }`}
                      >
                        {col.name} ({col.type === 'numeric' ? 'num' : 'cat'})
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Advanced Visualization Panel */}
          {data.length > 0 && (
            <DataVisualizationPanel rows={data} columns={columns} />
          )}

          {/* Target Selection */}
          {data.length > 0 && (
            <Card className="rounded-xl border-slate-200">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Tags className="h-5 w-5" />
                  Seleziona Colonna Target
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-3">
                  Scegli la colonna che vuoi predire. Il sistema suggerirà automaticamente il tipo di analisi.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {columns.map(col => (
                    <Button
                      key={col.name}
                      variant={targetColumn === col.name ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => selectTarget(col.name)}
                      className="justify-start"
                    >
                      {col.type === 'numeric' ? (
                        <TrendingUp className="h-4 w-4 mr-2" />
                      ) : (
                        <Tags className="h-4 w-4 mr-2" />
                      )}
                      {col.name}
                    </Button>
                  ))}
                </div>

                {suggestedTask && (
                  <div className={`mt-4 p-4 rounded-xl ${
                    suggestedTask === 'classification'
                      ? 'bg-purple-50 border border-purple-200'
                      : 'bg-blue-50 border border-blue-200'
                  }`}>
                    <div className="flex items-start gap-2">
                      <Lightbulb className={`h-5 w-5 mt-0.5 ${
                        suggestedTask === 'classification' ? 'text-purple-600' : 'text-blue-600'
                      }`} />
                      <div>
                        <p className={`font-medium ${
                          suggestedTask === 'classification' ? 'text-purple-700' : 'text-blue-700'
                        }`}>
                          Suggerimento: {suggestedTask === 'classification' ? 'Classificazione' : 'Regressione'}
                        </p>
                        <p className="text-sm mt-1 text-gray-600">{taskExplanation}</p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Training */}
          {targetColumn && (
            <Card className="rounded-xl border-slate-200">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Play className="h-5 w-5" />
                  Training Modello
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={trainModel}
                  disabled={isTraining}
                  className="w-full"
                >
                  {isTraining ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Training in corso...
                    </>
                  ) : (
                    <>
                      <Play className="h-4 w-4 mr-2" />
                      Addestra Modello ({suggestedTask === 'classification' ? 'Classificazione' : 'Regressione'})
                    </>
                  )}
                </Button>

                {model && (
                  <div className="mt-4 p-3 bg-emerald-50 rounded-xl">
                    <p className="text-sm font-medium text-emerald-700 flex items-center gap-2">
                      <CheckCircle className="h-4 w-4" />
                      Modello addestrato con successo!
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Prediction */}
          {model && (
            <Card className="rounded-xl border-slate-200">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertCircle className="h-5 w-5" />
                  Predizione
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
                  {columns.filter(c => c.name !== targetColumn).map(col => (
                    <div key={col.name}>
                      <label className="text-xs font-medium text-gray-600">{col.name}</label>
                      {col.type === 'numeric' ? (
                        <Input
                          type="number"
                          value={inputValues[col.name] || ''}
                          onChange={(e) => setInputValues({ ...inputValues, [col.name]: e.target.value })}
                          className="mt-1"
                        />
                      ) : (
                        <select
                          className="w-full mt-1 p-2 border rounded text-sm"
                          value={inputValues[col.name] || ''}
                          onChange={(e) => setInputValues({ ...inputValues, [col.name]: e.target.value })}
                        >
                          {col.sampleValues.map(v => (
                            <option key={String(v)} value={String(v)}>{String(v)}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>

                <Button onClick={predict} className="w-full">
                  <Play className="h-4 w-4 mr-2" />
                  Predici
                </Button>

                {prediction && (
                  <div className="mt-4 space-y-3">
                    <div className={`p-4 rounded-xl ${
                      suggestedTask === 'classification'
                        ? 'bg-purple-50 border border-purple-200'
                        : 'bg-blue-50 border border-blue-200'
                    }`}>
                      <p className="text-lg font-bold">
                        {suggestedTask === 'classification' ? 'Classe predetta: ' : 'Valore predetto: '}
                        <span className={suggestedTask === 'classification' ? 'text-purple-700' : 'text-blue-700'}>
                          {prediction.value}
                        </span>
                      </p>
                      {suggestedTask === 'classification' && (
                        <p className="text-sm text-gray-600">
                          Confidenza: {prediction.confidence.toFixed(1)}%
                        </p>
                      )}
                    </div>

                    <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                      <div className="flex items-start gap-2">
                        <Info className="h-5 w-5 text-amber-600 mt-0.5" />
                        <div className="text-sm text-amber-800">
                          {prediction.explanation}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
