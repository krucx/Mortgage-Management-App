import { daysBetween, lastAccrualDate } from '../../format'

export type Accrual = { on: string; within: boolean | null } // within: null with no Grace Period

/** A Mortgage's last Accrual Date by `receivedOn`, and whether that is within the Grace
 *  Period after it; null before its first. */
export function accrualOf(
  start: string,
  receivedOn: string,
  graceDays: number | null,
): Accrual | null {
  const on = lastAccrualDate(start, receivedOn)
  if (!on) return null
  return { on, within: graceDays === null ? null : daysBetween(on, receivedOn) <= graceDays }
}
