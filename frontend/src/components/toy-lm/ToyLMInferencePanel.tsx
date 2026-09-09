import { useCallback, useState } from 'react'
import { ChevronRight, RefreshCw, Type } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface ToyLMGeneratePayload {
  seed: string
  max_tokens: number
  temperature: number
}

interface ToyLMInferencePanelProps {
  canGenerate: boolean
  unavailableMessage: string
  onGenerate: (payload: ToyLMGeneratePayload) => Promise<string>
}

export default function ToyLMInferencePanel({
  canGenerate,
  unavailableMessage,
  onGenerate,
}: ToyLMInferencePanelProps) {
  const [seedText, setSeedText] = useState('')
  const [temperature, setTemperature] = useState(0.8)
  const [maxTokens, setMaxTokens] = useState(200)
  const [generatedText, setGeneratedText] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState('')

  const handleGenerate = useCallback(async () => {
    if (!canGenerate || isGenerating) return
    setIsGenerating(true)
    setGeneratedText('')
    setError('')
    try {
      const generated = await onGenerate({
        seed: seedText,
        max_tokens: maxTokens,
        temperature,
      })
      setGeneratedText(generated)
    } catch (err) {
      setError((err as Error).message || 'Errore generazione')
    } finally {
      setIsGenerating(false)
    }
  }, [canGenerate, isGenerating, maxTokens, onGenerate, seedText, temperature])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Type className="h-4 w-4 text-[var(--logo-violet)]" />
        <span className="text-sm font-black">Genera testo</span>
      </div>

      {!canGenerate ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {unavailableMessage}
        </div>
      ) : (
        <>
          <textarea
            value={seedText}
            onChange={e => setSeedText(e.target.value)}
            rows={2}
            placeholder="Testo seme (seed)..."
            className="w-full resize-none rounded-xl border border-[var(--border-subtle)] bg-white p-2.5 font-mono text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--logo-violet)] focus:outline-none focus:ring-2 focus:ring-[var(--logo-violet-22)]"
          />
          <div className="grid grid-cols-2 gap-x-5 gap-y-2">
            <ParamSlider label="Temperatura" value={temperature} min={0.1} max={2.0} step={0.05} onChange={setTemperature} displayFn={v => v.toFixed(2)} />
            <ParamSlider label="Max caratteri" value={maxTokens} min={50} max={1000} step={25} onChange={setMaxTokens} />
          </div>
          <Button tone="accent" surface="solid" fullWidth density="compact" disabled={isGenerating} onClick={handleGenerate}>
            {isGenerating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
            {isGenerating ? 'Generazione...' : 'Genera autocomplete'}
          </Button>
          {error && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {error}
            </div>
          )}
          {generatedText && (
            <pre className="max-h-52 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-white p-3 font-mono text-[13px] leading-5 text-[var(--text-primary)]">
              <span className="font-bold text-[var(--logo-violet)]">{seedText}</span>
              {generatedText.slice(seedText.length)}
            </pre>
          )}
        </>
      )}
    </div>
  )
}

function ParamSlider({
  label, value, min, max, step, onChange, displayFn,
}: {
  label: string; value: number; min: number; max: number; step: number
  onChange: (v: number) => void; displayFn?: (v: number) => string
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <label className="text-xs font-medium text-[var(--text-secondary)]">{label}</label>
        <span className="font-mono text-xs font-bold text-[var(--logo-violet)]">{displayFn ? displayFn(value) : value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--logo-violet-10)] accent-[var(--logo-violet)]"
      />
    </div>
  )
}
