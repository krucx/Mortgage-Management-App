import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { PURITIES, type Purity, type SimulationIn, type Terms } from '../api'
import {
  anyProblem,
  collateralOf,
  filledIn,
  problems,
  refusalOf,
  SPANS,
  termsLabel,
  type Inputs,
  type Run,
  type Span,
} from '../calculator'
import { FieldProblem } from '../components/FieldProblem'
import { JewelleryValue } from '../components/JewelleryValue'
import { PlannedPayments } from '../components/PlannedPayments'
import { SimulationResults } from '../components/SimulationResults'
import { TermsFields } from '../components/TermsFields'
import { useDebounced } from '../components/useDebounced'
import { useUrlFilters } from '../components/useUrlFilters'
import { addMonths, todayIso } from '../format'
import { lendThisLink } from '../lendThis'
import { rupeesToPaise } from '../money'
import { settings, simulationQuery } from '../requests'
import { useServerState } from '../serverState'
import { draftFromParams, draftParams, fromDraft, toDraft, type TermsDraft } from '../terms'

/** The inputs, kept in the page's URL so a refresh or a bookmark keeps them; anything
 *  not there yet is a fresh Calculator's: today, a year on, the Default Terms. */
function useInputs(defaultTerms: Terms | undefined): [Inputs, (changes: Partial<Inputs>) => void] {
  const [params, setParams] = useUrlFilters()
  const today = todayIso()
  const span = Number(params.get('span')) as Span
  const purity = Number(params.get('purity')) as Purity
  const lumps = params.get('lumps')
  const inputs: Inputs = {
    amount: params.get('amount') ?? '',
    start: params.get('start') ?? today,
    closed: params.get('closed') ?? addMonths(today, 12),
    terms: draftFromParams(params) ?? (defaultTerms ? toDraft(defaultTerms) : null),
    span: SPANS.includes(span) ? span : 12,
    monthly: params.get('monthly') ?? '',
    // "2026-06-01:20000,2026-09-01:5000", a row not filled in yet as ":"
    lumps:
      lumps === null
        ? []
        : lumps.split(',').map((lump) => {
            const [on = '', amount = ''] = lump.split(':')
            return { on, amount }
          }),
    compared: draftFromParams(params, '2'),
    net: params.get('net') ?? '',
    purity: PURITIES.includes(purity) ? purity : 22,
    value: params.get('value') ?? '',
  }
  // Every input goes into the URL at once, so a bookmark keeps today's dates too; those
  // left empty are left out.
  function change(changes: Partial<Inputs>) {
    const next = { ...inputs, ...changes }
    setParams({
      amount: next.amount,
      start: next.start,
      closed: next.closed,
      span: String(next.span),
      ...(next.terms && draftParams(next.terms)),
      monthly: next.monthly || null,
      lumps: next.lumps.length
        ? next.lumps.map((lump) => `${lump.on}:${lump.amount}`).join(',')
        : null,
      ...draftParams(next.compared, '2'),
      net: next.net || null,
      purity: next.net ? String(next.purity) : null,
      value: next.value || null,
    })
  }
  return [inputs, change]
}

/**
 * Size up a loan as a Simulation: an amount, dates, Terms and perhaps planned Payments,
 * worked out by the same ledger engine as a real Mortgage, closed on the chosen date;
 * perhaps alongside a second set of Terms. Nothing is stored.
 */
export function CalculatorPage() {
  const { client } = useServerState()
  const navigate = useNavigate()
  const [inputs, change] = useInputs(useQuery(settings.defaultTerms(client)).data)
  const goldRates = useQuery(settings.goldRates(client)).data
  const problem = problems(inputs)
  const { amount, start, closed, terms, span, monthly, lumps, compared } = inputs
  const valid = amount !== '' && terms !== null && !anyProblem(problem)
  const sent = filledIn(lumps)
  const ask = (under: TermsDraft): SimulationIn => ({
    amount_lent: rupeesToPaise(amount),
    start_date: start,
    closed_on: closed,
    terms: fromDraft(under),
    span_months: span,
    ...(monthly && { monthly_payment: rupeesToPaise(monthly) }),
    lump_sums: sent.map((lump) => ({ on: lump.on, amount: rupeesToPaise(lump.amount) })),
  })
  const asked = valid ? [ask(terms), ...(compared ? [ask(compared)] : [])] : null
  // Asked for once the inputs stop changing; compared by value, as typed.
  const settledText = useDebounced(asked && JSON.stringify(asked), 300)
  const settled: SimulationIn[] | null = settledText && JSON.parse(settledText)
  const [firstAsked, secondAsked] = settled ?? []
  const first = useQuery({
    ...simulationQuery(client, firstAsked!),
    enabled: !!firstAsked,
    placeholderData: keepPreviousData,
  })
  const second = useQuery({
    ...simulationQuery(client, secondAsked!),
    enabled: !!secondAsked,
    placeholderData: keepPreviousData,
  })
  const rows = sent.map((lump) => lump.row)
  const refusal = refusalOf(first.error, rows) ?? refusalOf(second.error, rows)
  const error = refusal ? null : (first.error ?? (settled?.[1] ? second.error : null))
  const runs: Run[] | null =
    settled && first.data && (!settled[1] || second.data)
      ? [first.data, ...(settled[1] ? [second.data!] : [])].map((simulation, index) => ({
          simulation,
          label: termsLabel(settled[index].terms, settled[1 - index]?.terms ?? null),
        }))
      : null
  const future = start > todayIso()

  function lend() {
    navigate(lendThisLink(amount, start, terms!))
  }

  return (
    <section className="card wide">
      <h2>Calculator</h2>
      <p className="hint">
        A Simulation: what a loan would come to, worked out exactly as a Mortgage's Ledger
        would be. Nothing is saved.
      </p>
      <div className="stack">
        <label>
          Amount lent (₹)
          <input
            type="number"
            min="1"
            step="1"
            placeholder="e.g. 100000"
            value={amount}
            onChange={(event) => change({ amount: event.target.value })}
          />
          <FieldProblem problem={problem.amount} />
        </label>
        <label>
          Start date
          <input
            type="date"
            value={start}
            onChange={(event) => change({ start: event.target.value })}
          />
          <FieldProblem problem={problem.start} />
        </label>
        <label>
          Closed on
          <input
            type="date"
            value={closed}
            onChange={(event) => change({ closed: event.target.value })}
          />
          <FieldProblem problem={problem.closed} />
        </label>
        {terms && (
          <TermsFields
            value={terms}
            onChange={(draft) => change({ terms: draft })}
            rateProblem={problem.rate}
          />
        )}

        {compared ? (
          <fieldset>
            <legend>Compared with</legend>
            <TermsFields
              value={compared}
              onChange={(draft) => change({ compared: draft })}
              rateProblem={problem.comparedRate}
            />
            <button
              type="button"
              className="secondary small"
              onClick={() => change({ compared: null })}
            >
              Remove the compared Terms
            </button>
          </fieldset>
        ) : (
          terms && (
            <div className="row">
              <button
                type="button"
                className="secondary small"
                onClick={() => change({ compared: terms })}
              >
                Compare other Terms
              </button>
            </div>
          )
        )}

        <PlannedPayments
          inputs={inputs}
          problem={problem}
          change={change}
          refusal={refusal}
          runs={runs}
        />

        <JewelleryValue inputs={inputs} change={change} goldRates={goldRates} />
      </div>

      {!valid ? (
        <p className="hint">Enter an amount to see what it would come to.</p>
      ) : refusal ? null : error ? (
        <p className="status error">{error.message}</p>
      ) : !runs ? (
        <p>Working it out…</p>
      ) : (
        <SimulationResults
          runs={runs}
          amountLent={settled![0].amount_lent}
          closedOn={settled![0].closed_on}
          planned={!!(settled![0].monthly_payment || settled![0].lump_sums?.length)}
          collateral={collateralOf(inputs, goldRates)?.value ?? null}
          span={span}
          onSpan={(months) => change({ span: months })}
          lend={
            <div className="row">
              <button
                type="button"
                disabled={future}
                title={future ? "Can't lend before the start date" : undefined}
                onClick={lend}
              >
                Lend this
              </button>
              {future ? (
                <span className="hint">Can't lend before the start date</span>
              ) : (
                <span className="hint">
                  Opens New Mortgage with this amount, start date and Terms
                  {runs.length > 1 && ` (${runs[0].label})`}.
                </span>
              )}
            </div>
          }
        />
      )}
    </section>
  )
}
