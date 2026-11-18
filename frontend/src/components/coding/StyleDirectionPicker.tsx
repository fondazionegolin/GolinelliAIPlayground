import { useEffect } from 'react'
import { tl } from '@/i18n/tl'

export type StyleOption = {
  id: string
  name: string
  tagline: string
  palette: { bg: string; surface: string; ink: string; muted: string; primary: string; accent: string }
  font_heading: string
  font_body: string
  radius: number
  answer: string
}

const FONT_LINK_ID = 'vibe-style-fonts'

// The preview cards are real mini compositions in the style's own fonts and colours, so the choice is visual.
function useStyleFonts(options: StyleOption[]) {
  useEffect(() => {
    if (!options.length || document.getElementById(FONT_LINK_ID)) return
    const families = Array.from(new Set(options.flatMap((o) => [o.font_heading, o.font_body])))
      .map((family) => `family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;700`)
      .join('&')
    const link = document.createElement('link')
    link.id = FONT_LINK_ID
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`
    document.head.appendChild(link)
  }, [options])
}

function StyleCard({ option, onPick }: { option: StyleOption; onPick: (option: StyleOption) => void }) {
  const { palette } = option
  const radius = Math.min(option.radius, 14)
  const outline = option.id === 'brutalista' || option.id === 'pop'
  return (
    <button
      type="button"
      onClick={() => onPick(option)}
      className="group flex flex-col overflow-hidden rounded-xl text-left ring-1 ring-black/10 transition hover:-translate-y-0.5 hover:ring-2 hover:ring-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      aria-label={`${option.name}: ${option.tagline}`}
    >
      <div className="relative h-24 w-full overflow-hidden p-2.5" style={{ background: palette.bg, color: palette.ink }}>
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-bold uppercase tracking-widest" style={{ fontFamily: `'${option.font_body}', sans-serif`, color: palette.muted }}>menu · info</span>
          <span className="h-1.5 w-6" style={{ background: palette.accent, borderRadius: radius }} />
        </div>
        <p className="mt-1.5 text-[22px] font-bold leading-[1.05]" style={{ fontFamily: `'${option.font_heading}', serif` }}>
          Aa <span style={{ color: palette.primary }}>Titolo</span>
        </p>
        <div className="mt-2 flex items-center gap-1.5">
          <span
            className="px-2 py-0.5 text-[9px] font-bold"
            style={{
              background: palette.primary, color: palette.bg === '#0f1a2b' || palette.bg === '#0e1116' ? '#0b0d12' : '#fff',
              borderRadius: radius, border: outline ? `2px solid ${palette.ink}` : 'none',
              boxShadow: outline ? `2px 2px 0 ${palette.ink}` : 'none', fontFamily: `'${option.font_body}', sans-serif`,
            }}
          >
            {tl("Scopri")}
          </span>
          <span className="h-3 w-10" style={{ background: palette.surface, borderRadius: radius, border: `1px solid ${palette.muted}55` }} />
        </div>
      </div>
      <div className="bg-white px-2.5 py-2">
        <p className="text-xs font-black text-slate-900">{option.name}</p>
        <p className="mt-0.5 text-[10.5px] leading-snug text-slate-500">{option.tagline}</p>
        <div className="mt-1.5 flex gap-1" aria-hidden="true">
          {[palette.bg, palette.surface, palette.primary, palette.accent, palette.ink].map((color, index) => (
            <span key={index} className="h-2.5 w-2.5 rounded-full ring-1 ring-black/15" style={{ background: color }} />
          ))}
        </div>
      </div>
    </button>
  )
}

export default function StyleDirectionPicker({ options, onPick, onSurprise }: {
  options: StyleOption[]
  onPick: (option: StyleOption) => void
  onSurprise: () => void
}) {
  useStyleFonts(options)
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {options.map((option) => <StyleCard key={option.id} option={option} onPick={onPick} />)}
      </div>
      <button
        type="button"
        onClick={onSurprise}
        className="rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-indigo-700 transition hover:border-indigo-400"
      >
        {tl("Scegli tu la direzione più adatta al soggetto")}
      </button>
    </div>
  )
}
