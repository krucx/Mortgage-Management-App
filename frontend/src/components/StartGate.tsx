// The installed app (PWA) opens from its cached screens even when nothing runs on the
// laptop. Then, rather than pages that can't load, it offers (on Windows) to start the app
// through the mortgage-management:// link Setup registers (Documentation/adr/0008), and
// loads it as soon as it answers.
import { useEffect, useState, type ReactNode } from 'react'
import { useServerState, type ApiClient } from '../serverState'

/** Whether the backend answers: not when fetch itself fails, nor when what passes /api on
 *  says the backend behind it is down (5xx). */
async function backendAnswers(client: ApiClient): Promise<boolean> {
  try {
    const { response } = await client.GET('/api/payment-methods')
    return response.status < 500
  } catch {
    return false
  }
}

const openInWindows = (link: string) => window.location.assign(link)
const reloadPage = () => window.location.reload()

export interface StartGateProps {
  children: ReactNode
  /** Opens the link that starts the app; Windows asks the Lender the first time. */
  openLink?: (link: string) => void
  /** Loads the app afresh from the server, which may have a newer version than the cache. */
  reload?: () => void
  /** How often to look again whether the backend answers. */
  checkEveryMs?: number
  /** Whether this is Windows, where Setup registers the link; elsewhere there is none. */
  onWindows?: boolean
  /** How long starting may take before the Lender is told it hasn't worked: Docker Desktop
   *  can take minutes to start, and a database update takes a Backup first. */
  giveUpAfterMs?: number
}

/** The app, once the backend answers; until then, a screen that starts it. */
export function StartGate({
  children,
  openLink = openInWindows,
  reload = reloadPage,
  checkEveryMs = 2000,
  giveUpAfterMs = 5 * 60_000,
  onWindows = navigator.userAgent.includes('Windows'),
}: StartGateProps) {
  const { client } = useServerState()
  const [state, setState] = useState<'checking' | 'running' | 'stopped' | 'starting' | 'late'>(
    'checking',
  )

  useEffect(() => {
    void backendAnswers(client).then((running) => setState(running ? 'running' : 'stopped'))
  }, [client])

  // Stopped: look again now and then, and load the app once it answers.
  const stopped = state === 'stopped' || state === 'starting' || state === 'late'
  useEffect(() => {
    if (!stopped) return
    let checking = false
    const timer = setInterval(() => {
      if (checking) return
      checking = true
      void backendAnswers(client).then((running) => {
        checking = false
        if (running) {
          clearInterval(timer)
          reload()
        }
      })
    }, checkEveryMs)
    return () => clearInterval(timer)
  }, [stopped, client, checkEveryMs, reload])

  useEffect(() => {
    if (state !== 'starting') return
    const timer = setTimeout(() => setState('late'), giveUpAfterMs)
    return () => clearTimeout(timer)
  }, [state, giveUpAfterMs])

  const startApp = () => {
    openLink('mortgage-management://start')
    setState('starting')
  }

  if (state === 'running') return children
  if (state === 'checking') return null
  return (
    <main className="start-gate card">
      <h1>Mortgage Management</h1>
      {state === 'stopped' &&
        (onWindows ? (
          <>
            <p>The app isn't running on this laptop.</p>
            <button type="button" onClick={startApp}>
              Start Mortgage Management
            </button>
          </>
        ) : (
          <p role="status">
            The app isn't running. Start its server: this page loads the app as soon as it is
            running.
          </p>
        ))}
      {state === 'late' && (
        <>
          <p role="alert" className="status error">
            Mortgage Management hasn't started after a few minutes. Start it from the “Mortgage
            Management” shortcut on the Desktop to see what went wrong.
          </p>
          <button type="button" className="secondary" onClick={startApp}>
            Try again
          </button>
        </>
      )}
      {state === 'starting' && (
        <p role="status">
          Starting Mortgage Management… If Windows asks whether to open it, choose Open. This page
          loads the app as soon as it is running.
        </p>
      )}
    </main>
  )
}
