import { useMemo, useState } from 'react'
import { Check, Search, Shuffle, X } from 'lucide-react'
import {
  TEACHERBOT_ICON_LIBRARY, TEACHERBOT_EMOJI_LIBRARY,
  encodeLucideIcon, encodeEmojiIcon, resolveTeacherbotIcon,
} from '@/lib/teacherbotIcons'

interface TeacherbotIconPickerProps {
  value: string
  onChange: (value: string) => void
  /** Background used to preview icon tiles the same way they'll appear on the bot avatar. */
  swatchHex: string
}

export default function TeacherbotIconPicker({ value, onChange, swatchHex }: TeacherbotIconPickerProps) {
  const [tab, setTab] = useState<'icons' | 'emoji'>('icons')
  const [search, setSearch] = useState('')
  const resolved = resolveTeacherbotIcon(value)

  const filteredIcons = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return TEACHERBOT_ICON_LIBRARY
    return TEACHERBOT_ICON_LIBRARY.filter(({ label, key }) => label.toLowerCase().includes(q) || key.includes(q))
  }, [search])

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs font-semibold">
          <button
            type="button"
            onClick={() => setTab('icons')}
            className={`rounded-md px-2.5 py-1 transition-colors ${tab === 'icons' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Icone
          </button>
          <button
            type="button"
            onClick={() => setTab('emoji')}
            className={`rounded-md px-2.5 py-1 transition-colors ${tab === 'emoji' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Emoji
          </button>
          <button
            type="button"
            onClick={() => onChange('bot')}
            title="Icona automatica in base all'argomento del bot"
            className={`flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors ${resolved.kind === 'auto' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            <Shuffle className="h-3 w-3" />
            Automatica
          </button>
        </div>

        {tab === 'icons' && (
          <div className="relative min-w-[160px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cerca icona..."
              className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-7 text-xs outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-200"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {tab === 'icons' ? (
        filteredIcons.length > 0 ? (
          <div className="grid max-h-64 grid-cols-8 gap-2 overflow-y-auto rounded-lg border border-slate-100 bg-white p-3 sm:grid-cols-10 lg:grid-cols-12">
            {filteredIcons.map(({ key, Icon, label }) => {
              const isSelected = resolved.kind === 'lucide' && resolved.key === key
              return (
                <button
                  key={key}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={isSelected}
                  onClick={() => onChange(encodeLucideIcon(key))}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-lg border transition duration-150 ${
                    isSelected ? 'border-slate-900 shadow-sm' : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                  }`}
                  style={isSelected ? { backgroundColor: swatchHex } : undefined}
                >
                  <Icon className={`h-5 w-5 ${isSelected ? 'text-white' : 'text-slate-600'}`} />
                </button>
              )
            })}
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-200 bg-white text-xs text-slate-400">
            Nessuna icona corrisponde a &quot;{search}&quot;
          </div>
        )
      ) : (
        <div className="grid max-h-64 grid-cols-8 gap-2 overflow-y-auto rounded-lg border border-slate-100 bg-white p-3 sm:grid-cols-10 lg:grid-cols-12">
          {TEACHERBOT_EMOJI_LIBRARY.map((emoji) => {
            const isSelected = resolved.kind === 'emoji' && resolved.emoji === emoji
            return (
              <button
                key={emoji}
                type="button"
                aria-label={emoji}
                aria-pressed={isSelected}
                onClick={() => onChange(encodeEmojiIcon(emoji))}
                className={`flex h-10 w-10 items-center justify-center rounded-lg border text-lg transition duration-150 ${
                  isSelected ? 'border-slate-900 bg-slate-100 shadow-sm' : 'border-transparent hover:border-slate-200 hover:bg-slate-50'
                }`}
              >
                {isSelected ? (
                  <span className="relative">
                    {emoji}
                    <Check className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full bg-slate-900 text-white" />
                  </span>
                ) : emoji}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
