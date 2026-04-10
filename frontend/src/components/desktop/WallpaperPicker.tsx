import { useRef, useState } from 'react'
import { X, Upload, Check } from 'lucide-react'

// ── Palette generation ────────────────────────────────────────────────────────
// 16 columns × 16 rows = 256 colors
// Col 0 = grays, cols 1-15 = hues (dark→light per row)

function hslToHex(h: number, s: number, l: number): string {
  const ll = l / 100
  const a = (s / 100) * Math.min(ll, 1 - ll)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const c = ll - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
    return Math.round(255 * c).toString(16).padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

// 15 hues spread across the spectrum, emphasising logo area (navy ~225, pink ~330)
const PALETTE_HUES = [0, 18, 36, 54, 80, 110, 140, 170, 195, 210, 225, 248, 268, 295, 330]

function buildPalette(): string[] {
  const colors: string[] = []

  // Col 0 — 16 neutral grays (row 0 = darkest, row 15 = mid-light)
  for (let row = 0; row < 16; row++) {
    colors.push(hslToHex(0, 0, 4 + row * 5))  // 4% … 79%
  }

  // Cols 1-15 — pastel hues: high lightness, moderate saturation
  for (const hue of PALETTE_HUES) {
    for (let row = 0; row < 16; row++) {
      const l = 68 + row * 1.8     // 68% … 97% — always light/pastel
      const s = Math.min(52, 18 + row * 2.2)  // 18% → 52% — muted to soft
      colors.push(hslToHex(hue, s, Math.round(l)))
    }
  }

  return colors  // 16 + 15*16 = 256
}

export const PALETTE_256 = buildPalette()

// ── Legacy preset solids (kept for backward-compat with getWallpaperStyle) ────
export const SOLID_COLORS = [
  { key: 'solid_neutral', value: '#2c3240' },
  { key: 'solid_ink',     value: '#0a0a0a' },
  { key: 'solid_charcoal',value: '#1c1c1e' },
  { key: 'solid_graphite',value: '#2a2a2e' },
  { key: 'solid_slate',   value: '#0f172a' },
  { key: 'solid_navy',    value: '#0d1b2a' },
]

/** Returns the CSS background value for a wallpaper key. */
export function getWallpaperStyle(key: string): string {
  if (!key) return '#0f172a'
  if (key.startsWith('data:') || key.startsWith('url:')) {
    const url = key.startsWith('url:') ? key.slice(4) : key
    return `url(${url}) center/cover no-repeat`
  }
  // Any CSS color starting with # or hsl(...) etc.
  if (key.startsWith('#') || key.startsWith('hsl') || key.startsWith('rgb')) return key
  return SOLID_COLORS.find(c => c.key === key)?.value ?? '#0f172a'
}

// ── Image compression ─────────────────────────────────────────────────────────
async function compressImage(file: File, maxW = 1280, maxH = 720, quality = 0.72): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width, height } = img
      const ratio = Math.min(maxW / width, maxH / height, 1)
      width = Math.round(width * ratio)
      height = Math.round(height * ratio)
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    img.src = url
  })
}

// ── Component ─────────────────────────────────────────────────────────────────
interface WallpaperPickerProps {
  current: string
  onSelect: (key: string) => void
  onClose: () => void
}

export default function WallpaperPicker({ current, onSelect, onClose }: WallpaperPickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [compressing, setCompressing] = useState(false)
  const isCustomImage = current.startsWith('data:') || current.startsWith('url:')

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setCompressing(true)
    try {
      const dataUrl = await compressImage(file)
      onSelect(dataUrl)
    } catch {
      const reader = new FileReader()
      reader.onload = ev => { if (ev.target?.result) onSelect(ev.target.result as string) }
      reader.readAsDataURL(file)
    } finally {
      setCompressing(false)
    }
    e.target.value = ''
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="relative bg-[#1a1a2e] border border-white/10 rounded-2xl shadow-2xl p-5 w-full max-w-md"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-white/80">Scegli sfondo</h3>
          <button
            className="w-7 h-7 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5 text-white/60" />
          </button>
        </div>

        {/* 256-color palette — 16 cols × 16 rows */}
        <div className="mb-1 text-[10px] text-white/30 uppercase tracking-wider">Colori</div>
        <div
          className="grid gap-[3px] mb-4"
          style={{ gridTemplateColumns: 'repeat(16, 1fr)' }}
        >
          {PALETTE_256.map((color, idx) => {
            const isSelected = current === color
            return (
              <button
                key={idx}
                title={color}
                className={`relative aspect-square rounded-sm transition-all ${
                  isSelected ? 'ring-2 ring-white/70 scale-90 z-10' : 'hover:scale-110 hover:z-10'
                }`}
                style={{ background: color }}
                onClick={() => onSelect(color)}
              >
                {isSelected && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Check className="h-2 w-2 text-white drop-shadow" />
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* Image upload */}
        <div className="mb-1 text-[10px] text-white/30 uppercase tracking-wider">Immagine</div>
        <button
          disabled={compressing}
          className={`w-full flex items-center justify-center gap-2 h-11 rounded-xl border-2 transition-all text-xs font-medium ${
            isCustomImage
              ? 'border-white/40 text-white'
              : 'border-dashed border-white/20 bg-white/5 hover:bg-white/10 text-white/50'
          }`}
          style={isCustomImage ? {
            backgroundImage: getWallpaperStyle(current),
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          } : undefined}
          onClick={() => fileInputRef.current?.click()}
        >
          {compressing ? (
            <span className="text-white/60">Caricamento...</span>
          ) : !isCustomImage ? (
            <><Upload className="h-3.5 w-3.5" />Carica immagine</>
          ) : (
            <div className="bg-black/50 rounded-lg px-3 py-1 flex items-center gap-1.5">
              <Check className="h-3 w-3 text-white" />
              <span className="text-white text-[10px]">Cambia immagine</span>
            </div>
          )}
        </button>
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
      </div>
    </div>
  )
}
