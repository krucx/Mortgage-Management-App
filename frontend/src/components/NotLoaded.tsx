import { NotFound } from '../pages/NotFoundPage'
import { BackendError } from '../serverState'

/** What a page shows until its record has loaded: Loading…, then what went wrong, or the
 *  not-found screen (`No ${missing}`) when the backend has no such record. */
export function NotLoaded({ error, missing }: { error: Error | null; missing: string }) {
  if (!error) return <p>Loading…</p>
  if (error instanceof BackendError && error.status === 404) {
    return <NotFound title={`No ${missing}`} />
  }
  return <p className="status error">{error.message}</p>
}
