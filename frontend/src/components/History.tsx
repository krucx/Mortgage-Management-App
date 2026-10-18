import { useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { usePaymentMethods, type PaymentMethodNames } from './usePaymentMethods'
import {
  type AuditEntry,
  type InterestMode,
  type PartMonthRule,
  type PaymentMethod,
} from '../api'
import { formatRate, INTEREST_MODES, PART_MONTH_RULES } from '../terms'
import { formatDate, formatDateTime, formatGrams } from '../format'
import { formatINR } from '../money'
import { ScrollPopup } from './ScrollPopup'

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  address: 'Address',
  phone_1: 'Contact number 1',
  phone_2: 'Contact number 2',
  referrer: 'Referrer',
  start_date: 'Start date',
  amount_lent: 'Principal lent',
  description: 'Jewellery',
  gross_weight_mg: 'Gross weight',
  net_weight_mg: 'Net weight',
  purity_karat: 'Purity',
  collateral_override: 'Collateral Value set by hand',
  status: 'Status',
  monthly_rate_bps: 'Monthly rate',
  interest_mode: 'Interest Mode',
  part_month_rule: 'Part-Month Rule',
  paid_on: 'Received',
  amount: 'Amount',
  method: 'Method',
  reference: 'Reference',
  effective_on: 'From',
}

/** A stored value as the Lender reads it. */
function formatValue(field: string, value: string | null): string {
  if (value === null || value === '') return '(none)'
  switch (field) {
    case 'amount_lent':
    case 'amount':
    case 'collateral_override':
      return formatINR(Number(value))
    case 'gross_weight_mg':
    case 'net_weight_mg':
      return formatGrams(Number(value))
    case 'purity_karat':
      return `${value}K`
    case 'start_date':
    case 'paid_on':
    case 'effective_on':
      return formatDate(value)
    case 'monthly_rate_bps':
      return formatRate(Number(value))
    case 'interest_mode':
      return INTEREST_MODES[value as InterestMode] ?? value
    case 'part_month_rule':
      return PART_MONTH_RULES[value as PartMonthRule] ?? value
    default:
      return value
  }
}

const ENTITY_LABELS: Record<AuditEntry['entity'], string> = {
  customer: 'Customer',
  mortgage: 'Mortgage',
  payment: 'Payment',
}

const ACTION_LABELS: Record<AuditEntry['action'], string> = {
  created: 'created',
  edited: 'edited',
  deleted: 'deleted',
  voided: 'voided',
  redeemed: 'Redeemed',
  forfeited: 'Forfeited',
  reopened: 'reopened',
  photo_added: 'photo added',
  photo_removed: 'photo removed',
  term_change_added: 'Term Change added',
  term_change_removed: 'Term Change removed',
}

/** One change: the audit log keeps a row per field, written together. */
type Change = AuditEntry[]

function groupChanges(entries: AuditEntry[]): Change[] {
  const changes: Change[] = []
  for (const entry of entries) {
    const last = changes.at(-1)?.[0]
    const same =
      last &&
      last.at === entry.at &&
      last.entity === entry.entity &&
      last.entity_id === entry.entity_id &&
      last.action === entry.action
    if (same) changes[changes.length - 1].push(entry)
    else changes.push([entry])
  }
  return changes
}

function describe(change: Change, showMortgage: boolean, methods: PaymentMethodNames | null) {
  const [first] = change
  const valueOf = (field: string) => change.find((e) => e.field === field)?.new_value ?? null
  const subject =
    first.entity === 'payment' ? (
      <Link to={`/payments/${first.entity_id}`}>Payment</Link>
    ) : first.entity === 'mortgage' && showMortgage ? (
      <>
        Mortgage <Link to={`/mortgages/${first.entity_id}`}>{first.mortgage_name}</Link>
      </>
    ) : (
      ENTITY_LABELS[first.entity]
    )
  let detail = null
  if (['edited', 'reopened', 'term_change_added'].includes(first.action)) {
    const from = valueOf('effective_on')
    detail = change
      .filter((e) => e.field && e.field !== 'effective_on')
      .map((e, index) => (
        <span key={e.id}>
          {index === 0 ? ': ' : '; '}
          {FIELD_LABELS[e.field ?? ''] ?? e.field}{' '}
          <span className="hint">{formatValue(e.field ?? '', e.old_value)}</span> →{' '}
          {formatValue(e.field ?? '', e.new_value)}
        </span>
      ))
    if (from) detail = <> from {formatDate(from)}{detail}</>
  } else if (first.action === 'voided') {
    detail = <span className="hint"> · {valueOf('void_reason')}</span>
  } else if (first.action === 'created' && first.entity === 'payment') {
    detail = (
      <span className="hint">
        {' '}
        · {formatValue('amount', valueOf('amount'))}{' '}
        {methods?.[valueOf('method') as PaymentMethod] ?? ''}
      </span>
    )
  }
  return (
    <>
      {subject} {ACTION_LABELS[first.action]}
      {detail}
      {first.note && <span className="hint"> · {first.note}</span>}
    </>
  )
}

/** Changes shown on the page; the rest are in the complete-history popup. */
const HISTORY_SHOWN = 5

/** A Customer's or Mortgage's change history, newest first. */
export function History<Key extends QueryKey>({
  query,
  showMortgage = false,
  title,
}: {
  query: UseQueryOptions<AuditEntry[], Error, AuditEntry[], Key>
  /** Name the Mortgage in its entries (on a Customer's page, which has several). */
  showMortgage?: boolean
  /** Heading of the complete-history popup. */
  title: string
}) {
  const { data: entries, error } = useQuery(query)
  const [open, setOpen] = useState(false)
  const methods = usePaymentMethods()

  if (!entries) return error ? <p className="status error">{error.message}</p> : null
  const changes = groupChanges(entries)
  const list = (shown: Change[]) => (
    <ul className="history">
      {shown.map((change) => (
        <li key={change[0].id}>
          <span className="hint">{formatDateTime(change[0].at)}</span>{' '}
          {describe(change, showMortgage, methods)}
        </li>
      ))}
    </ul>
  )
  return (
    <div className="stack">
      {changes.length === 0 ? <p className="hint">No changes yet.</p> : list(changes.slice(0, HISTORY_SHOWN))}
      {changes.length > HISTORY_SHOWN && (
        <div className="row">
          <span className="hint">
            Showing the latest {HISTORY_SHOWN} of {changes.length} changes.
          </span>
          <button type="button" className="secondary small" onClick={() => setOpen(true)}>
            Show complete history
          </button>
        </div>
      )}
      {open && (
        <ScrollPopup title={title} onClose={() => setOpen(false)}>
          {list(changes)}
        </ScrollPopup>
      )}
    </div>
  )
}
