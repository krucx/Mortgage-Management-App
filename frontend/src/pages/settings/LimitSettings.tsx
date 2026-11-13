import { formatINR } from '../../money'
import { settings } from '../../requests'
import { useServerState } from '../../serverState'
import { OptionalNumberSetting } from './OptionalNumberSetting'
import { DAYS, RUPEES } from './units'

/** At what amount the Lender is warned before lending or receiving cash; cleared, never. */
export function CashLimitSettings() {
  const { client } = useServerState()
  return (
    <OptionalNumberSetting
      unit={RUPEES}
      heading="Cash Limit"
      hint={
        <>
          Lending or receiving this much or more in cash asks you first: Government of India rules
          ask for UPI or bank transfer instead. Nothing is refused. Leave it empty for no warning.
        </>
      }
      inputLabel="Warn at cash of (₹), or more"
      dialogTitle="Change the Cash Limit?"
      summaryLabel="Warn at cash of"
      neverText="Never: no warning for cash"
      confirmedSuffix=" or more"
      field="cash_limit"
      query={settings.cashLimit(client)}
      save={settings.saveCashLimit}
    />
  )
}

const DISCOUNT_CONFIRMATION_DEFAULT_PAISE = 500_00 // mirrors the backend default

/** How much Discount requires an extra confirmation; cleared, no threshold. */
export function DiscountConfirmationSettings() {
  const { client } = useServerState()
  return (
    <OptionalNumberSetting
      unit={RUPEES}
      heading="Discount confirmation"
      hint={
        <>
          Ask before recording a per-Mortgage Discount greater than this amount. The default is{' '}
          {formatINR(DISCOUNT_CONFIRMATION_DEFAULT_PAISE)}. This is a confirmation guideline;
          Discounts are still capped at the remaining Outstanding. Leave it empty to skip the extra
          confirmation.
        </>
      }
      inputLabel="Ask when Discount exceeds (₹)"
      dialogTitle="Change the Discount confirmation limit?"
      summaryLabel="Ask for confirmation over"
      neverText="Never"
      confirmedSuffix=""
      field="discount_confirmation_limit"
      query={settings.discountConfirmationLimit(client)}
      save={settings.saveDiscountConfirmationLimit}
    />
  )
}

/** How many days late a Payment may still be dated as if paid on time; empty or 0, none. */
export function GracePeriodSettings() {
  const { client } = useServerState()
  return (
    <OptionalNumberSetting
      unit={DAYS}
      heading="Grace Period"
      hint={
        <>
          A Payment received this many days or fewer after an Accrual Date may be dated the day
          before it, as if paid on time. The same for every Mortgage; 3 days unless changed. Leave
          it empty or 0 for no Grace.
        </>
      }
      inputLabel="Grace Period (days)"
      dialogTitle="Change the Grace Period?"
      summaryLabel="Grace Period"
      neverText="None: no Grace"
      confirmedSuffix=""
      field="grace_period_days"
      query={settings.gracePeriod(client)}
      save={settings.saveGracePeriod}
    />
  )
}
