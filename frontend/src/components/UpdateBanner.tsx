// Tells the Lender when a newer release is out, with its notes. On Windows, Install now
// opens mortgage-management://update, which runs Setup for it (Documentation/adr/0008).
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type ReactNode } from 'react'
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

/** A line of release notes with its **bold**, `code` and [links](…) as they read. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{part.slice(1, -1)}</code>
    const link = /^\[([^\]]+)\]\([^)]+\)$/.exec(part)
    return link ? link[1] : part
  })
}

/** A release's notes (its changelog section, in Markdown) as headings, lists and paragraphs. */
function ReleaseNotes({ markdown }: { markdown: string }) {
  const blocks: ReactNode[] = []
  const lines = markdown.split(/\r?\n/)
  for (let i = 0; i < lines.length;) {
    if (lines[i].startsWith('```')) {
      const end = lines.findIndex((line, j) => j > i && line.startsWith('```'))
      const last = end === -1 ? lines.length : end
      blocks.push(<pre key={i}>{lines.slice(i + 1, last).join('\n')}</pre>)
      i = last + 1
      continue
    }
    if (!lines[i].trim()) {
      i++
      continue
    }
    const start = i
    const block: string[] = []
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('```'))
      block.push(lines[i++])
    const heading = /^#+\s+(.*)/.exec(block[0])
    if (heading) {
      blocks.push(<h4 key={start}>{inline(heading[1])}</h4>)
    } else if (block[0].startsWith('- ')) {
      // An item runs on over its indented lines.
      const items = block.reduce<string[]>(
        (all, line) =>
          line.startsWith('- ')
            ? [...all, line.slice(2)]
            : [...all.slice(0, -1), `${all.at(-1)} ${line.trim()}`],
        [],
      )
      blocks.push(
        <ul key={start}>
          {items.map((item, n) => (
            <li key={n}>{inline(item)}</li>
          ))}
        </ul>,
      )
    } else {
      blocks.push(<p key={start}>{inline(block.map((line) => line.trim()).join(' '))}</p>)
    }
  }
  return <div className="notes">{blocks}</div>
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
        <ReleaseNotes markdown={available.notes} />
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
