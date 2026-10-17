import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { PAYMENT_METHODS, type AuditEntry, type PaymentMethod } from '../api'
import { formatDate, formatDateTime, formatGrams } from '../format'
import { formatINR } from '../money'

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
      return formatDate(value)
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

function describe(change: Change, showMortgage: boolean) {
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
  if (first.action === 'edited' || first.action === 'reopened') {
    detail = change
      .filter((e) => e.field)
      .map((e, index) => (
        <span key={e.id}>
          {index === 0 ? ': ' : '; '}
          {FIELD_LABELS[e.field ?? ''] ?? e.field}{' '}
          <span className="hint">{formatValue(e.field ?? '', e.old_value)}</span> →{' '}
          {formatValue(e.field ?? '', e.new_value)}
        </span>
      ))
  } else if (first.action === 'voided') {
    detail = <span className="hint"> · {valueOf('void_reason')}</span>
  } else if (first.action === 'created' && first.entity === 'payment') {
    detail = (
      <span className="hint">
        {' '}
        · {formatValue('amount', valueOf('amount'))}{' '}
        {PAYMENT_METHODS[valueOf('method') as PaymentMethod] ?? ''}
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

/** A Customer's or Mortgage's change history, newest first; reloads when `refresh` changes. */
export function History({
  load,
  refresh,
  showMortgage = false,
}: {
  load: () => Promise<AuditEntry[]>
  refresh?: unknown
  /** Name the Mortgage in its entries (on a Customer's page, which has several). */
  showMortgage?: boolean
}) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    load().then(setEntries, (err: Error) => setError(err.message))
  }, [load, refresh])

  if (error) return <p className="status error">{error}</p>
  if (entries === null) return null
  const changes = groupChanges(entries)
  const shown = open ? changes : changes.slice(0, 5)
  return (
    <div className="stack">
      <ul className="history">
        {shown.map((change) => (
          <li key={change[0].id}>
            <span className="hint">{formatDateTime(change[0].at)}</span>{' '}
            {describe(change, showMortgage)}
          </li>
        ))}
      </ul>
      {changes.length > shown.length && (
        <div>
          <button type="button" className="secondary small" onClick={() => setOpen(true)}>
            Show all {changes.length}
          </button>
        </div>
      )}
    </div>
  )
}
