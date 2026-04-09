import { Cloud, Droplets, Zap } from 'lucide-react'

const ENVIRONMENTAL_IMPACT = {
  energyWh: 0.24,
  co2Grams: 0.03,
  waterMl: 0.26,
  waterDrops: 5,
} as const

interface EnvironmentalImpactPillProps {
  darkMode?: boolean
  className?: string
}

type MetricItemProps = {
  icon: React.ReactNode
  label: string
  value: string
}

function MetricItem({ icon, label, value }: MetricItemProps) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/75 text-slate-700 shadow-sm ring-1 ring-black/5">
        {icon}
      </span>
      <span className="max-w-0 overflow-hidden text-xs opacity-0 transition-all duration-200 ease-out group-hover:max-w-[9rem] group-hover:opacity-100 group-focus-within:max-w-[9rem] group-focus-within:opacity-100">
        <span className="font-medium">{value}</span>
        <span className="ml-1 opacity-70">{label}</span>
      </span>
    </div>
  )
}

export default function EnvironmentalImpactPill({
  darkMode = false,
  className = '',
}: EnvironmentalImpactPillProps) {
  return (
    <div
      className={[
        'group inline-flex w-fit items-center gap-2 overflow-hidden rounded-full border px-2 py-1 transition-all duration-200 ease-out',
        darkMode
          ? 'border-white/15 bg-white/10 text-white/85'
          : 'border-emerald-200/80 bg-emerald-50/90 text-emerald-900',
        className,
      ].join(' ')}
      title="Stima media per richiesta AI"
      aria-label="Stima media di acqua, energia e CO2 per richiesta AI"
    >
      <MetricItem
        icon={<Droplets className="h-3.5 w-3.5" />}
        value={`${ENVIRONMENTAL_IMPACT.waterMl.toFixed(2)} ml`}
        label={`acqua (${ENVIRONMENTAL_IMPACT.waterDrops} gocce)`}
      />
      <MetricItem
        icon={<Zap className="h-3.5 w-3.5" />}
        value={`${ENVIRONMENTAL_IMPACT.energyWh.toFixed(2)} Wh`}
        label="energia"
      />
      <MetricItem
        icon={<Cloud className="h-3.5 w-3.5" />}
        value={`${ENVIRONMENTAL_IMPACT.co2Grams.toFixed(2)} g`}
        label="CO2"
      />
    </div>
  )
}
