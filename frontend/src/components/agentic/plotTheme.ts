import { useEffect, useState } from 'react'

const fallback = { ink: '#17151b', muted: '#6f477d', surface: '#ffffff', grid: '#e4e4e7' }
function readPlotTheme() {
  if (typeof document === 'undefined') return fallback
  const style = getComputedStyle(document.documentElement)
  const token = (name: string, defaultValue: string) => style.getPropertyValue(name).trim() || defaultValue
  return { ink: token('--text-primary', fallback.ink), muted: token('--text-secondary', fallback.muted),
    surface: token('--ds-popover-solid', fallback.surface), grid: token('--ds-choice-border', fallback.grid) }
}

/** Plotly renders its own SVG/WebGL styles, so CSS theme changes must reach its layout explicitly. */
export function usePlotTheme() {
  const [theme, setTheme] = useState(readPlotTheme)
  useEffect(() => {
    const update = () => setTheme(readPlotTheme())
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    return () => observer.disconnect()
  }, [])
  return theme
}
