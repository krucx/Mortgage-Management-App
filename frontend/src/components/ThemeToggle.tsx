import { useEffect, useState } from 'react'
import { applyTheme, chosenTheme, darkQuery, nextChoice, systemTheme, type Theme } from '../theme'

const SUN = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="4.5" />
    <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8" />
  </svg>
)
const MOON = (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
    <path d="M20.5 14.2A8.5 8.5 0 1 1 9.8 3.5a7 7 0 0 0 10.7 10.7Z" />
  </svg>
)

/** Switches between light and dark; until pressed, the browser's theme is followed. */
export function ThemeToggle() {
  const [choice, setChoice] = useState<Theme | null>(chosenTheme)
  const [system, setSystem] = useState<Theme>(systemTheme)

  useEffect(() => {
    const query = darkQuery()
    const follow = () => setSystem(query.matches ? 'dark' : 'light')
    query.addEventListener('change', follow)
    return () => query.removeEventListener('change', follow)
  }, [])

  const shown = choice ?? system
  const other = shown === 'dark' ? 'light' : 'dark'
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Switch to the ${other} theme`}
      title={`Switch to the ${other} theme${choice ? '' : ' (now following the browser)'}`}
      onClick={() => {
        const next = nextChoice(shown, system)
        applyTheme(next)
        setChoice(next)
      }}
    >
      {shown === 'dark' ? SUN : MOON}
    </button>
  )
}
