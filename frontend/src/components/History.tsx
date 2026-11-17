import {
  keepPreviousData,
  useQuery,
  type QueryKey,
  type UseQueryOptions,
} from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { usePaymentMethods, type PaymentMethodNames } from './usePaymentMethods'
import {
  type AuditEntry,
  type HistoryPage,
  type InterestMode,
  type PartMonthRule,
  type PaymentMethod,
} from '../api'
import { formatRate, INTEREST_MODES, PART_MONTH_RULES } from '../terms'
import { formatDate, formatDateTime, formatGrams, maskedAadhaar } from '../format'
import { formatINR } from '../money'
import { Pager } from './Pager'
import { ScrollPopup } from './ScrollPopup'

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  address: 'Address',
  phone_1: 'Contact number 1',
  phone_2: 'Contact number 2',
  referrer: 'Referrer',
  email: 'Email',
  aadhaar_last4: 'Aadhaar Number',
  pan: 'PAN',
  start_date: 'Start date',
  amount_lent: 'Principal lent',
  description: 'Jewellery',
  gross_weight_mg: 'Gross weight',
  net_weight_mg: 'Net weight',
  purity_karat: 'Purity',
  lent_through: 'Lent Through',
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
function formatValue(
  field: string,
  value: string | null,
  methods: PaymentMethodNames | null = null,
): string {
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
    case 'aadhaar_last4':
      return maskedAadhaar(value)
    case 'method':
    case 'lent_through':
      return methods?.[value as PaymentMethod] ?? value
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
  waived: 'Waived off',
  forfeited: 'Forfeited',
  reopened: 'reopened',
  photo_added: 'photo added',
  photo_removed: 'photo removed',
  term_change_added: 'Term Change added',
  term_change_removed: 'Term Change removed',
}

/** One change: the audit log keeps a row per field, written together. */
type Change = AuditEntry[]

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
          <span className="hint">{formatValue(e.field ?? '', e.old_value, methods)}</span> →{' '}
          {formatValue(e.field ?? '', e.new_value, methods)}
        </span>
      ))
    if (from)
      detail = (
        <>
          {' '}
          from {formatDate(from)}
          {detail}
        </>
      )
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

/** Asks for one page of a History. */
type HistoryQuery<Key extends QueryKey> = (
  page: number,
) => UseQueryOptions<HistoryPage, Error, HistoryPage, Key>

/** A Customer's or Mortgage's change history, newest first. */
export function History<Key extends QueryKey>({
  query,
  showMortgage = false,
  title,
}: {
  query: HistoryQuery<Key>
  /** Name the Mortgage in its entries (on a Customer's page, which has several). */
  showMortgage?: boolean
  /** Heading of the complete-history popup. */
  title: string
}) {
  const { data: latest, error } = useQuery(query(1))
  const [open, setOpen] = useState(false)
  const methods = usePaymentMethods()

  if (!latest) return error ? <p className="status error">{error.message}</p> : null
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
      {latest.total === 0 ? (
        <p className="hint">No changes yet.</p>
      ) : (
        list(latest.items.slice(0, HISTORY_SHOWN))
      )}
      {latest.total > HISTORY_SHOWN && (
        <div className="row">
          <span className="hint">
            Showing the latest {HISTORY_SHOWN} of {latest.total} changes.
          </span>
          <button type="button" className="secondary small" onClick={() => setOpen(true)}>
            Show complete history
          </button>
        </div>
      )}
      {open && (
        <ScrollPopup title={title} onClose={() => setOpen(false)}>
          <CompleteHistory query={query} list={list} />
        </ScrollPopup>
      )}
    </div>
  )
}

/** Every change, a page at a time, with the pager above so a new page starts at its top.
 *  Not useListPage: its pages are kept under the lists, but History's must stay under
 *  its Customer or Mortgage, so whatever makes them stale makes their History stale. */
function CompleteHistory<Key extends QueryKey>({
  query,
  list,
}: {
  query: HistoryQuery<Key>
  list: (shown: Change[]) => ReactNode
}) {
  const [page, setPage] = useState(1)
  const { data: shown, error } = useQuery({ ...query(page), placeholderData: keepPreviousData })

  if (!shown) return error ? <p className="status error">{error.message}</p> : null
  return (
    <div className="stack">
      <Pager
        page={shown.page}
        pageSize={shown.page_size}
        total={shown.total}
        shown={shown.items.length}
        onPage={setPage}
      />
      {list(shown.items)}
    </div>
  )
}
