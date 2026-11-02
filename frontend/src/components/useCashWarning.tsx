import type { ReactNode } from 'react'
import type { PaymentMethod } from '../api'
import { formatINR } from '../money'
import { settings } from '../requests'
import { useServerState } from '../serverState'
import { useConfirm } from './useConfirm'

/** What the rules ask for by UPI or bank transfer, whatever Cash Limit the Lender sets. */
const RULE_FROM = 2_000_000

/** An amount lent or received, and how. */
export interface Cash {
  amount: number
  method: PaymentMethod
}

/**
 * The Cash Limit's warning (never a refusal): `await warnCash(cash)` is true to go on,
 * asking first when `cash` is in cash and at or above the Cash Limit. "Go back" is
 * the default. Without a Cash Limit (cleared, or not to be had) it never asks.
 */
export function useCashWarning(): [(cash: Cash | null) => Promise<boolean>, ReactNode] {
  const { client, queryClient } = useServerState()
  const [confirm, dialog] = useConfirm()

  async function warnCash(cash: Cash | null) {
    if (!cash || cash.method !== 'cash') return true
    let limit: number | null
    try {
      limit = (await queryClient.fetchQuery(settings.cashLimit(client))).cash_limit
    } catch {
      return true
    }
    if (limit === null || cash.amount < limit) return true
    return confirm({
      title: `${formatINR(cash.amount)} in cash`,
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
