import { useState, useEffect, useRef } from 'react'

interface NoteConfig {
  text?: string
  color?: string
  font_size?: number
}

const NOTE_COLORS: Record<string, string> = {
  '#fef08a': '#1a1a00',
  '#bfdbfe': '#0f172a',
  '#bbf7d0': '#0f172a',
  '#fecaca': '#1a0000',
  '#e9d5ff': '#0f0a1a',
}

interface NoteWidgetProps {
  config: NoteConfig
  onConfigChange: (config: NoteConfig) => void
  readOnly?: boolean
}

export default function NoteWidget({ config, onConfigChange, readOnly = false }: NoteWidgetProps) {
  const [text, setText] = useState(config.text ?? '')
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bg = config.color || '#fef08a'
  const textColor = NOTE_COLORS[bg] ?? '#1a1a00'

  useEffect(() => { setText(config.text ?? '') }, [config.text])

  const handleChange = (v: string) => {
    if (readOnly) return
    setText(v)
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(() => {
      onConfigChange({ ...config, text: v })
    }, 800)
  }

  return (
    <div
      className="h-full flex flex-col rounded-2xl overflow-hidden"
      style={{ backgroundColor: bg }}
    >
      <textarea
        className="flex-1 w-full resize-none p-4 font-medium bg-transparent outline-none placeholder:opacity-40"
        style={{ color: textColor, fontSize: config.font_size ? `${config.font_size}px` : '16px' }}
        placeholder={readOnly ? '' : "Scrivi una nota..."}
        value={text}
        readOnly={readOnly}
        onChange={e => handleChange(e.target.value)}
      />
    </div>
  )
}
