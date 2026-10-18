// Light or dark: the browser's theme unless the Lender has chosen one on this laptop.

export type Theme = 'light' | 'dark'

const KEY = 'theme'

/** The theme the Lender chose, or null to follow the browser. */
export function chosenTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(KEY)
    return stored === 'light' || stored === 'dark' ? stored : null
  } catch {
    return null
  }
}

/** The browser's own theme. */
export const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')
export const systemTheme = (): Theme => (darkQuery().matches ? 'dark' : 'light')

/**
 * What pressing the switch chooses: the other theme, or, when that is what the browser
 * would show anyway, nothing, so the page follows the browser again.
 */
export function nextChoice(shown: Theme, system: Theme): Theme | null {
  const other: Theme = shown === 'dark' ? 'light' : 'dark'
  return other === system ? null : other
}

/** Show `choice` (null: follow the browser) and remember it. */
export function applyTheme(choice: Theme | null): void {
  const root = document.documentElement
  if (choice) root.dataset.theme = choice
  else root.removeAttribute('data-theme')
  try {
    if (choice) localStorage.setItem(KEY, choice)
    else localStorage.removeItem(KEY)
  } catch {
    // Not remembered (e.g. storage blocked); it still applies until the page reloads.
  }
}
