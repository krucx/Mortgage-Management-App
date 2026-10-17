import { useEffect, useState } from 'react'
import type { MortgagePreview } from '../api'

type Load = () => Promise<MortgagePreview[]>

/**
 * Loads a preview whenever `load` changes (debounced), ignoring answers that a newer
 * request has replaced. `load` is null when there is nothing to preview. The last
 * answer stays shown, marked `loading`, until the next one arrives.
 */
export function usePreview(load: Load | null, delay = 400) {
  const [answer, setAnswer] = useState<{
    for: Load
    previews: MortgagePreview[] | null
    error: string | null
  } | null>(null)

  useEffect(() => {
    if (!load) return
    let replaced = false
    const timer = setTimeout(() => {
      load().then(
        (previews) => !replaced && setAnswer({ for: load, previews, error: null }),
        (err: Error) =>
          !replaced && setAnswer({ for: load, previews: null, error: err.message }),
      )
    }, delay)
    return () => {
      replaced = true
      clearTimeout(timer)
    }
  }, [load, delay])

  if (!load) return { previews: null, error: null, loading: false }
  const current = answer?.for === load
  return {
    previews: answer?.previews ?? null,
    error: current ? (answer?.error ?? null) : null,
    loading: !current,
  }
}
