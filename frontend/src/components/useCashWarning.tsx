import type { ReactNode } from 'react'
import { formatINR } from '../money'
import { settings } from '../requests'
import { useServerState } from '../serverState'
import { useConfirm } from './useConfirm'

/** What the rules ask for by UPI or bank transfer, whatever Cash Limit the Lender sets. */
const RULE_FROM = 2_000_000

/**
 * The Cash Limit's warning (never a refusal): `await warnCash(cash)` is true to go on,
 * asking first when the largest of the sums a change writes in cash (as its Preview
 * says) is at or above the Cash Limit. "Go back" is the default. Without a Cash Limit
 * (cleared, or not to be had) it never asks.
 */
export function useCashWarning(): [(cash: number[]) => Promise<boolean>, ReactNode] {
  const { client, queryClient } = useServerState()
  const [confirm, dialog] = useConfirm()

  async function warnCash(cash: number[]) {
    if (cash.length === 0) return true
    const largest = Math.max(...cash)
    let limit: number | null
    try {
      limit = (await queryClient.fetchQuery(settings.cashLimit(client))).cash_limit
    } catch {
      return true
    }
    if (limit === null || largest < limit) return true
    return confirm({
      title: `${formatINR(largest)} in cash`,
      body: (
        <p>
          Government of India rules ask for {formatINR(RULE_FROM)} or more to be lent or received
          by UPI or bank transfer, not cash.
        </p>
      ),
      cancelLabel: 'Go back',
      confirmLabel: 'Record in cash anyway',
    })
  }

  return [warnCash, dialog]
}
