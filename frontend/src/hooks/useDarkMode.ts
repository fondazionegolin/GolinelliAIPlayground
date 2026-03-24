import { useState, useEffect } from 'react'

function applyTheme(dark: boolean) {
  const html = document.documentElement
  if (dark) {
    html.classList.add('dark')
    html.setAttribute('data-theme', 'dark')
  } else {
    html.classList.remove('dark')
    html.removeAttribute('data-theme')
  }
  localStorage.setItem('dark_mode', String(dark))
}

export function useDarkMode() {
  const [isDark, setIsDark] = useState(
    () => document.documentElement.classList.contains('dark')
  )

  // Enable CSS transitions after first render (prevents flash on load)
  useEffect(() => {
    const t = setTimeout(() => {
      document.documentElement.classList.add('theme-ready')
    }, 100)
    return () => clearTimeout(t)
  }, [])

  const toggle = () => {
    setIsDark(prev => {
      const next = !prev
      applyTheme(next)
      return next
    })
  }

  return { isDark, toggle }
}
