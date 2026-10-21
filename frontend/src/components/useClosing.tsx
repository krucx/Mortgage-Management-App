import type { Closure, ForfeitAllIn, Mortgage, RedeemAllIn, WaiveAllIn } from '../api'
import { changes, previews, type PreviewRequest } from '../requests'
import { keys, useLedgerChange, useServerState, type ApiClient } from '../serverState'
import type { ConfirmOptions } from './ConfirmDialog'
import { useProposedChange } from './useProposedChange'

/** A Closure the Lender proposes: Redeeming, Waiving off or Forfeiting one or more
 *  Mortgages on a date. */
export type Closing =
  | { kind: 'redeem'; redeem: RedeemAllIn }
  | { kind: 'waive'; waive: WaiveAllIn }
  | { kind: 'forfeit'; forfeit: ForfeitAllIn }

type Requests = {
  preview: () => PreviewRequest
  save: (client: ApiClient) => Promise<Mortgage[]>
}

/** Each kind's Preview and save, for a Closing of that kind. */
function requestsFor(closing: Closing): Requests {
  switch (closing.kind) {
    case 'redeem':
      return {
        preview: () => previews.redeemAll(closing.redeem),
        save: (client) => changes.redeemAll(client, closing.redeem),
      }
    case 'waive':
      return {
        preview: () => previews.waiveAll(closing.waive),
        save: (client) => changes.waiveAll(client, closing.waive),
      }
    case 'forfeit':
      return {
        preview: () => previews.forfeitAll(closing.forfeit),
        save: (client) => changes.forfeitAll(client, closing.forfeit),
      }
  }
}

/**
 * Closing Mortgages, one or several at once: the Preview of `closing` as it is drafted,
 * the confirmation, and one save that closes all of them or (if the backend refuses
 * any) none, keeping each closed Mortgage as it now is. Each Mortgage's Closure, as it
 * would be, comes from the Preview (and from no earlier draft's), so the
 * page works none of its figures out. The closing rules are the backend's alone: its
 * refusal shows in the Preview and keeps Save disabled.
 */
export function useClosing({
  closing,
  confirm,
  saved,
}: {
  /** What to close, or null while the draft can't be saved. */
  closing: Closing | null
  /** The confirmation asked for; null when the page's own dialog has asked already. */
  confirm: ((closing: Closing) => ConfirmOptions) | null
  /** Given the Mortgages as they are once closed. */
  saved: (closed: Mortgage[]) => void
}) {
  const { queryClient } = useServerState()
  const changeLedger = useLedgerChange()
  const proposed = useProposedChange({
    change: closing,
    preview: (closing) => requestsFor(closing).preview(),
    confirm,
    save: (closing) =>
      changeLedger(
        (client) => requestsFor(closing).save(client),
        (closed) => closed.forEach((m) => queryClient.setQueryData(keys.mortgage(m.id), m)),
      ),
    saved,
  })
  // Only the Preview of this draft: while a newer one loads, nothing is shown.
  const current = proposed.preview.loading ? [] : (proposed.preview.previews ?? [])
  const closures = new Map(current.map((p) => [p.mortgage_id, p.after.closure]))
  return {
    ...proposed,
    /** The Mortgage's Closure as the Preview has it; undefined until it is worked out. */
    closureOf: (mortgageId: number): Closure | null | undefined => closures.get(mortgageId),
  }
}
