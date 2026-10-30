// Tells the Lender when a newer release is out, with its notes. On Windows, Install now
// opens mortgage-management://update, which runs Setup for it (Documentation/adr/0008).
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { updateStatusQuery } from '../requests'
import { useServerState } from '../serverState'

const PUT_OFF = 'mortgage-management.update-put-off'

/** Whether version `a` (x.y.z) is newer than `b`. */
function newer(a: string, b: string): boolean {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number))
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]
  return false
}

/** The version the Lender last put off with Later, on this device; private windows have none. */
function readPutOff(): string | null {
  try {
    return localStorage.getItem(PUT_OFF)
  } catch {
    return null
  }
}

function writePutOff(version: string) {
  try {
    localStorage.setItem(PUT_OFF, version)
  } catch {
    // Not kept: it shows again next time.
  }
}

const openInWindows = (link: string) => window.location.assign(link)
const reloadPage = () => window.location.reload()

export interface UpdateBannerProps {
  /** Opens the link that runs Setup; Windows asks the Lender the first time. */
  openLink?: (link: string) => void
  /** Loads the app afresh from the server, once the new version runs. */
  reload?: () => void
  /** Whether this is Windows, where Setup registers the link; elsewhere there is none. */
  onWindows?: boolean
  /** How often to look whether the new version runs, while updating. */
  checkEveryMs?: number
  /** How long updating may take before the Lender is told where to look: a database update
   *  takes a Backup first, and the new version may take minutes to start. */
  giveUpAfterMs?: number
}

/** A newer release's banner, unless there is none. */
export function UpdateBanner({
  openLink = openInWindows,
  reload = reloadPage,
  onWindows = navigator.userAgent.includes('Windows'),
  checkEveryMs = 3000,
  giveUpAfterMs = 20 * 60_000,
}: UpdateBannerProps) {
  const { client } = useServerState()
  const status = useQuery(updateStatusQuery(client)).data
  const available = status?.available
  const [phase, setPhase] = useState<'offered' | 'installing' | 'failed' | 'late'>('offered')
  const [putOff, setPutOff] = useState(readPutOff)
  const installing = phase === 'installing'

  // Setup stops the app, then starts the new version, or (if it failed) the one before.
  useEffect(() => {
    if (!installing || !status || !available) return
    let stopped = false
    let checking = false
    const timer = setInterval(() => {
      if (checking) return
      checking = true
      client
        .GET('/api/update')
        .then(
          ({ data, response }) => {
            if (!response.ok || !data) {
              stopped = true
            } else if (data.running !== status.running) {
              // A new version runs: the one offered, or a newer one released meanwhile.
              clearInterval(timer)
              reload()
            } else if (stopped) {
              clearInterval(timer)
              setPhase('failed')
            }
          },
          () => (stopped = true),
        )
        .finally(() => (checking = false))
    }, checkEveryMs)
    return () => clearInterval(timer)
  }, [installing, status, available, client, checkEveryMs, reload])

  useEffect(() => {
    if (!installing) return
    const timer = setTimeout(() => setPhase('late'), giveUpAfterMs)
    return () => clearTimeout(timer)
  }, [installing, giveUpAfterMs])

  if (!available || (putOff && !newer(available.version, putOff))) return null
  return (
    <section className="update-banner" aria-label="Update">
      <strong>Version {available.version} is available</strong>
      {installing && (
        <p role="status">
          Updating to version {available.version}… If Windows asks whether to open it, choose Open.
          Setup runs in a window of its own; the app reloads by itself once the new version runs.
        </p>
      )}
      {phase === 'failed' && (
        <p role="alert" className="status error">
          Update failed; still on {status?.running}. The Setup window says why.
        </p>
      )}
      {phase === 'late' && (
        <p role="alert" className="status error">
          The update hasn't finished. If a Setup window is open, it says how it is getting on; if
          there is none, install it again.
        </p>
      )}
      <details>
        <summary>What's new</summary>
        <p className="notes">{available.notes}</p>
      </details>
      {onWindows && !installing && (
        <button
          type="button"
          onClick={() => {
            openLink('mortgage-management://update')
            setPhase('installing')
          }}
        >
          Install now
        </button>
      )}
      {!installing && (
        <button
          type="button"
          className="secondary"
          onClick={() => {
            writePutOff(available.version)
            setPutOff(available.version)
          }}
        >
          Later
        </button>
      )}
    </section>
  )
}
