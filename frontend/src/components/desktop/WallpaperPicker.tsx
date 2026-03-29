import { X, Check } from 'lucide-react'

export interface Wallpaper {
  key: string
  label: string
  value: string  // CSS background value
}

export const WALLPAPERS: Wallpaper[] = [
  { key: 'gradient_midnight', label: 'Notte', value: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)' },
  { key: 'gradient_aurora', label: 'Aurora', value: 'linear-gradient(135deg, #0d1117 0%, #0d4a4a 40%, #1a3a5c 100%)' },
  { key: 'gradient_nebula', label: 'Nebula', value: 'linear-gradient(135deg, #16001e 0%, #2d1b69 40%, #11172a 100%)' },
  { key: 'gradient_forest', label: 'Foresta', value: 'linear-gradient(135deg, #0a1628 0%, #0d3b2e 50%, #071a1a 100%)' },
  { key: 'gradient_sunset', label: 'Tramonto', value: 'linear-gradient(135deg, #1a0a2e 0%, #3d1a00 40%, #1a0d00 100%)' },
  { key: 'gradient_ocean', label: 'Oceano', value: 'linear-gradient(135deg, #020b18 0%, #0a2a4a 50%, #001f3a 100%)' },
  { key: 'gradient_rose', label: 'Rosa', value: 'linear-gradient(135deg, #1a0a1a 0%, #3d1a2e 50%, #200a1a 100%)' },
  { key: 'gradient_ember', label: 'Brace', value: 'linear-gradient(135deg, #1a0500 0%, #3a0f00 50%, #1a0800 100%)' },
  { key: 'gradient_slate', label: 'Ardesia', value: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)' },
  { key: 'gradient_teal', label: 'Smeraldo', value: 'linear-gradient(135deg, #042f2e 0%, #0d4a3a 50%, #021b1a 100%)' },
  { key: 'gradient_indigo', label: 'Indaco', value: 'linear-gradient(135deg, #0a0a2e 0%, #1a1a5a 50%, #0a0a1e 100%)' },
  { key: 'gradient_violet', label: 'Viola', value: 'linear-gradient(135deg, #130a2e 0%, #2e1a5a 50%, #0a0520 100%)' },
  { key: 'gradient_pine', label: 'Pino', value: 'linear-gradient(135deg, #0a1a0a 0%, #1a3a1a 50%, #051005 100%)' },
  { key: 'gradient_graphite', label: 'Grafite', value: 'linear-gradient(135deg, #111111 0%, #1f1f1f 50%, #0a0a0a 100%)' },
  { key: 'gradient_cobalt', label: 'Cobalto', value: 'linear-gradient(135deg, #000d1a 0%, #002a4a 50%, #001020 100%)' },
  // Solid darks
  { key: 'solid_black', label: 'Nero', value: '#0a0a0a' },
  { key: 'solid_navy', label: 'Blu', value: '#0d1b2a' },
  { key: 'solid_dark_green', label: 'Verde', value: '#0a1a0a' },
  { key: 'solid_dark_purple', label: 'Porpora', value: '#150a2e' },
  { key: 'solid_dark_red', label: 'Rosso', value: '#1a0505' },
  { key: 'solid_charcoal', label: 'Antracite', value: '#1c1c1e' },
  { key: 'solid_dark_teal', label: 'Teal', value: '#042b2b' },
  { key: 'solid_dark_slate', label: 'Blu scuro', value: '#0f1923' },
]

interface WallpaperPickerProps {
  current: string
  onSelect: (key: string) => void
  onClose: () => void
}

export function getWallpaperStyle(key: string): string {
  return WALLPAPERS.find(w => w.key === key)?.value ?? WALLPAPERS[0].value
}

export default function WallpaperPicker({ current, onSelect, onClose }: WallpaperPickerProps) {
  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="relative bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-2xl p-6 w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold text-white/80">Scegli sfondo</h3>
          <button
            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5 text-white/60" />
          </button>
        </div>

        <div className="mb-2 text-[10px] text-white/30 uppercase tracking-wider">Gradienti</div>
        <div className="grid grid-cols-5 gap-2 mb-4">
          {WALLPAPERS.filter(w => w.key.startsWith('gradient')).map(w => (
            <button
              key={w.key}
              title={w.label}
              className={`relative h-12 rounded-xl border-2 transition-all ${current === w.key ? 'border-white/60 scale-95' : 'border-transparent hover:border-white/20'}`}
              style={{ background: w.value }}
              onClick={() => onSelect(w.key)}
            >
              {current === w.key && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Check className="h-3.5 w-3.5 text-white drop-shadow" />
                </div>
              )}
            </button>
          ))}
        </div>

        <div className="mb-2 text-[10px] text-white/30 uppercase tracking-wider">Tinte unite</div>
        <div className="grid grid-cols-8 gap-2">
          {WALLPAPERS.filter(w => w.key.startsWith('solid')).map(w => (
            <button
              key={w.key}
              title={w.label}
              className={`relative h-8 rounded-lg border-2 transition-all ${current === w.key ? 'border-white/60' : 'border-transparent hover:border-white/20'}`}
              style={{ background: w.value }}
              onClick={() => onSelect(w.key)}
            >
              {current === w.key && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Check className="h-3 w-3 text-white drop-shadow" />
                </div>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
