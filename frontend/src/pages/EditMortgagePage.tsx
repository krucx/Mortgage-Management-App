import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { PURITIES, type Mortgage, type MortgageEdit, type Purity } from '../api'
import { PreviewSection } from '../components/BeforeAfter'
import { Summary } from '../components/ConfirmDialog'
import { PaymentMethodSelect } from '../components/PaymentMethodSelect'
import { TermsFields } from '../components/TermsFields'
import { lentThroughName, usePaymentMethods } from '../components/usePaymentMethods'
import { useProposedChange } from '../components/useProposedChange'
import { WeightFields } from '../components/WeightFields'
import { formatDate, formatGrams, todayIso } from '../format'
import { formatINR, paiseToRupees, rupeesToPaise } from '../money'
import { changes, mortgageQuery, previews } from '../requests'
import { useMortgageChange, useServerState } from '../serverState'
import { gramsToMg, mgToGrams } from '../weight'
import { describeTerms, fromDraft, sameTerms, toDraft } from '../terms'

/** Correct a Mortgage's details; the Ledger is replayed from them. */
export function EditMortgagePage() {
  const id = Number(useParams().id)
  const { client } = useServerState()
  const loaded = useQuery(mortgageQuery(client, id))
  if (!loaded.data) {
    return loaded.error ? <p className="status error">{loaded.error.message}</p> : <p>Loading…</p>
  }
  // Keyed so the form starts again from another Mortgage's details.
  return <EditMortgageForm key={id} mortgage={loaded.data} />
}

function EditMortgageForm({ mortgage }: { mortgage: Mortgage }) {
  const id = mortgage.id
  const navigate = useNavigate()
  const [fields, setFields] = useState({
    name: mortgage.name,
    start_date: mortgage.start_date,
    amountLent: paiseToRupees(mortgage.amount_lent),
    description: mortgage.description,
    gross: mgToGrams(mortgage.gross_weight_mg),
    net: mgToGrams(mortgage.net_weight_mg),
    purity: mortgage.purity_karat as Purity,
    lentThrough: mortgage.lent_through,
    terms: toDraft(mortgage.starting_terms),
  })
  const methods = usePaymentMethods()
  const changeMortgage = useMortgageChange()
  const closed = mortgage.status !== 'active'
  // Locked once closed: a background refresh closing the Mortgage mid-edit must not
  // leave a stale draft of these behind to be shown or sent.
  const startDate = closed ? mortgage.start_date : fields.start_date
  const amountLent = closed ? paiseToRupees(mortgage.amount_lent) : fields.amountLent
  const termsDraft = closed ? toDraft(mortgage.starting_terms) : fields.terms

  const terms = fromDraft(termsDraft)
  const edited: MortgageEdit = {
    name: fields.name.trim(),
    start_date: startDate,
    amount_lent: rupeesToPaise(amountLent),
    description: fields.description,
    gross_weight_mg: gramsToMg(fields.gross),
    net_weight_mg: gramsToMg(fields.net),
    purity_karat: fields.purity,
    lent_through: fields.lentThrough,
    terms,
  }
  // Starting Terms, the start date and Principal change what is owed.
  const numbersChanged =
    Number(amountLent) > 0 &&
    (startDate !== mortgage.start_date ||
      edited.amount_lent !== mortgage.amount_lent ||
      !sameTerms(terms, mortgage.starting_terms))
  // Lent Through is previewed too, unshown, for what the edit would write in cash.
  const worthPreviewing =
    numbersChanged || (Number(amountLent) > 0 && fields.lentThrough !== mortgage.lent_through)

  const was = mortgage
  const edits: [string, string][] = [
    ['Name', was.name, edited.name],
    ['Start date', formatDate(was.start_date), formatDate(edited.start_date || was.start_date)],
    ['Principal lent', formatINR(was.amount_lent), formatINR(edited.amount_lent)],
    ['Jewellery', was.description, edited.description],
    ['Gross weight', formatGrams(was.gross_weight_mg), formatGrams(edited.gross_weight_mg)],
    ['Net weight', formatGrams(was.net_weight_mg), formatGrams(edited.net_weight_mg)],
    ['Purity', `${was.purity_karat}K`, `${edited.purity_karat}K`],
    ['Starting Terms', describeTerms(was.starting_terms), describeTerms(terms)],
    [
      'Lent Through',
      lentThroughName(methods, was.lent_through),
      lentThroughName(methods, edited.lent_through ?? null),
    ],
  ]
    .filter(([, before, after]) => before !== after)
    .map(([label, before, after]): [string, string] => [label, `${before} → ${after}`])

  const set = (field: keyof typeof fields) => (value: string) =>
    setFields({ ...fields, [field]: value })

  const { preview, submit, saving, canSave, error, confirmDialog } = useProposedChange({
    change: edits.length > 0 ? edited : null,
    preview: (edit) => (worthPreviewing ? previews.edit(id, edit) : null),
    confirm: () => ({
      title: `Save changes to ${was.name}?`,
      body: (
        <>
          <Summary rows={edits} />
          {numbersChanged && (
            <p className="hint">The Ledger and what is owed are replayed from these details.</p>
          )}
        </>
      ),
    }),
    save: (edit) => changeMortgage((client) => changes.edit(client, id, edit)),
    saved: () => navigate(`/mortgages/${id}`),
  })

  return (
    <section className="card wide">
      <h2>Edit {mortgage.name}</h2>
      <p className="hint">
        Customer cannot be changed here.
        {closed &&
          ` It is ${mortgage.status}, so its start date, Principal and Terms stay as ` +
            'they were; reopen it to change them.'}
      </p>
      <form onSubmit={submit}>
        <label>
          Mortgage Name
          <input required value={fields.name} onChange={(e) => set('name')(e.target.value)} />
        </label>
        <div className="grid-2">
          <label>
            Start date
            <input
              type="date"
              required
              max={todayIso()}
              disabled={closed}
              value={startDate}
              onChange={(e) => set('start_date')(e.target.value)}
            />
          </label>
          <label>
            Principal lent (₹)
            <input
              type="number"
              required
              min="1"
              step="0.01"
              disabled={closed}
              value={amountLent}
              onChange={(e) => set('amountLent')(e.target.value)}
            />
          </label>
        </div>
        <h3>Starting Terms</h3>
        <p className="hint">
          Correcting these replays the existing Payments from the start. Later Term Changes keep
          their dates.
        </p>
        <TermsFields
          value={termsDraft}
          onChange={(terms) => setFields({ ...fields, terms })}
          disabled={closed}
        />
        <label>
          Lent Through
          <PaymentMethodSelect
            methods={methods}
            value={fields.lentThrough}
            onChange={(lentThrough) => setFields({ ...fields, lentThrough })}
            placeholder="—"
          />
        </label>
        <label>
          Description of the jewellery
          <textarea
            rows={2}
            required
            value={fields.description}
            onChange={(e) => set('description')(e.target.value)}
          />
        </label>
        <div className="grid-3">
          <WeightFields
            value={fields}
            onChange={(weights) => setFields({ ...fields, ...weights })}
          />
          <label>
            Purity
            <select
              value={fields.purity}
              onChange={(e) => setFields({ ...fields, purity: Number(e.target.value) as Purity })}
            >
              {PURITIES.map((karat) => (
                <option key={karat} value={karat}>
                  {karat}K
                </option>
              ))}
            </select>
          </label>
        </div>
        {numbersChanged && (
          <>
            <h3>What changes</h3>
            <PreviewSection preview={preview} />
          </>
        )}
        <div className="row">
          <button type="submit" disabled={!canSave}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" className="secondary" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
        {error && <p className="status error">{error}</p>}
      </form>
      {confirmDialog}
    </section>
  )
}
