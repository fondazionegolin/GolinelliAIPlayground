import { Cloud, Droplets, Zap } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { llmApi } from '@/lib/api'
import {
  estimateEnvironmentalImpact,
  type EnvironmentalImpactMetrics,
  type TokenUsageJson,
} from '@/lib/environmentalImpact'

interface EnvironmentalImpactPillProps {
  darkMode?: boolean
  className?: string
  provider?: string | null
  model?: string | null
  tokenUsage?: TokenUsageJson | null
}

type MetricItemProps = {
  icon: React.ReactNode
  label: string
  value: string
}

function MetricItem({ icon, label, value }: MetricItemProps) {
  return (
    <div className="flex items-center">
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-white/75 text-slate-700 shadow-sm ring-1 ring-black/5">
        {icon}
      </span>
      {/* min-w-0 + max-w-0 force the element to 0 width in collapsed state */}
      <span className="min-w-0 max-w-0 overflow-hidden whitespace-nowrap text-xs opacity-0 ml-0 transition-all duration-200 ease-out group-hover:max-w-[8rem] group-hover:ml-1.5 group-hover:opacity-100 group-focus-within:max-w-[8rem] group-focus-within:ml-1.5 group-focus-within:opacity-100">
        <span className="font-medium">{value}</span>
        <span className="ml-1 opacity-70">{label}</span>
      </span>
    </div>
  )
}

function formatMetricValue(value: number, unit: string) {
  if (value >= 10) return `${value.toFixed(1)} ${unit}`
  if (value >= 1) return `${value.toFixed(2)} ${unit}`
  return `${value.toFixed(3)} ${unit}`
}

function TotalsSummary({ totals }: { totals: EnvironmentalImpactMetrics & { interaction_count?: number } }) {
  return (
    // max-w-0 in collapsed state prevents this wide text from stretching the pill width.
    // overflow-hidden clips it; on hover max-w-xs + max-h-14 reveal it.
    <div className="overflow-hidden text-[11px] opacity-0 max-h-0 max-w-0 transition-all duration-200 ease-out group-hover:mt-2 group-hover:max-h-14 group-hover:max-w-xs group-hover:opacity-100 group-focus-within:mt-2 group-focus-within:max-h-14 group-focus-within:max-w-xs group-focus-within:opacity-100">
      <div className="border-t border-current/10 pt-2 whitespace-nowrap">
        <span className="font-medium">Totale</span>
        <span className="mx-1 opacity-60">•</span>
        <span>{formatMetricValue(totals.water_ml, 'ml')}</span>
        <span className="mx-1 opacity-60">•</span>
        <span>{formatMetricValue(totals.energy_wh, 'Wh')}</span>
        <span className="mx-1 opacity-60">•</span>
        <span>{formatMetricValue(totals.co2_grams, 'g CO₂')}</span>
      </div>
    </div>
  )
}

export default function EnvironmentalImpactPill({
  darkMode = false,
  className = '',
  provider,
  model,
  tokenUsage,
}: EnvironmentalImpactPillProps) {
  const requestImpact = estimateEnvironmentalImpact(tokenUsage, provider, model)
  const { data } = useQuery({
    queryKey: ['llm-environmental-footprint'],
    queryFn: async () => (await llmApi.getEnvironmentalFootprint()).data,
    enabled: !!requestImpact,
    staleTime: 30_000,
  })

  if (!requestImpact) return null

  return (
    <div
      className={[
        // inline-flex already sizes to content — no w-fit needed
        'group inline-flex flex-col overflow-hidden rounded-2xl border px-1.5 py-1 transition-all duration-200 ease-out',
        darkMode
          ? 'border-white/15 bg-white/10 text-white/85'
          : 'border-emerald-200/80 bg-emerald-50/90 text-emerald-900',
        className,
      ].join(' ')}
      title="Stima del footprint AI della risposta e totale cumulativo utente"
    >
      {/* gap-2 between the 3 icon groups only — each icon is 24px */}
      <div className="flex items-center gap-2">
        <MetricItem
          icon={<Droplets className="h-3.5 w-3.5" />}
          value={formatMetricValue(requestImpact.water_ml, 'ml')}
          label={`acqua (${requestImpact.water_drops} gocce)`}
        />
        <MetricItem
          icon={<Zap className="h-3.5 w-3.5" />}
          value={formatMetricValue(requestImpact.energy_wh, 'Wh')}
          label="energia"
        />
        <MetricItem
          icon={<Cloud className="h-3.5 w-3.5" />}
          value={formatMetricValue(requestImpact.co2_grams, 'g')}
          label="CO2"
        />
      </div>
      {data?.totals && <TotalsSummary totals={data.totals} />}
    </div>
  )
}
