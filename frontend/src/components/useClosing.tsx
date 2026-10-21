import type { Closure, ForfeitAllIn } from '../api'
import { changes, previews } from '../requests'
import { useLedgerChange } from '../serverState'
import type { ConfirmOptions } from './ConfirmDialog'
import { useProposedChange } from './useProposedChange'

/** A Closure the Lender proposes: for now, Forfeiting one or more Mortgages on a date. */
export type Closing = { kind: 'forfeit'; forfeit: ForfeitAllIn }

/**
 * Closing Mortgages, one or several at once: the Preview of `closing` as it is drafted,
 * the confirmation, and one save that closes all of them or (if the backend refuses
 * any) none. Each Mortgage's Closure, as it would be, comes from the Preview, so the
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
  confirm: (closing: Closing) => ConfirmOptions
  saved: () => void
}) {
  const changeLedger = useLedgerChange()
  const proposed = useProposedChange({
    change: closing,
    preview: (closing) => previews.forfeitAll(closing.forfeit),
    confirm,
    save: (closing) => changeLedger((client) => changes.forfeitAll(client, closing.forfeit)),
    saved,
  })
  const closures = new Map(
    (proposed.preview.previews ?? []).map((p) => [p.mortgage_id, p.after.closure]),
  )
  return {
    ...proposed,
    /** The Mortgage's Closure as the Preview has it; undefined until it is worked out. */
    closureOf: (mortgageId: number): Closure | null | undefined => closures.get(mortgageId),
  }
}
