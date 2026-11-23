import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import {
  PURITIES,
  type Customer,
  type Mortgage,
  type MortgageIn,
  type PaymentMethod,
  type Purity,
  type Terms,
} from '../api'
import { NewMortgageForecast } from '../components/ChangeForecasts'
import { CustomerChooser } from '../components/CustomerChooser'
import { Summary } from '../components/ConfirmDialog'
import { MortgageTable } from '../components/MortgageTable'
import { PaymentMethodSelect } from '../components/PaymentMethodSelect'
import { Photo } from '../components/Photo'
import { PhotoSource } from '../components/PhotoSource'
import { TermsFields } from '../components/TermsFields'
import { FieldProblem } from '../components/FieldProblem'
import { useDebounced } from '../components/useDebounced'
import { useDraft } from '../components/useDraft'
import { useSaveWithPhotos } from '../components/useSaveWithPhotos'
import { useProposedChange } from '../components/useProposedChange'
import { usePaymentMethods } from '../components/usePaymentMethods'
import { WeightFields } from '../components/WeightFields'
import { formatDate, todayIso } from '../format'
import { carriedIn, type Carried } from '../lendThis'
import { formatINR, rupeesToPaise } from '../money'
import {
  addMortgagePhoto,
  createMortgage,
  customerQuery,
  everyMortgageQuery,
  previews,
  settings,
  suggestedNameQuery,
} from '../requests'
import { STALE_AFTER, useLedgerChange, useServerState } from '../serverState'
import { formatRate, fromDraft, INTEREST_MODES, toDraft } from '../terms'
import { gramsToMg, netAboveGross } from '../weight'
import { RupeeInput } from '../components/RupeeInput'

/**
 * Create a Mortgage: pick (or create) the Customer, see their Active Mortgages,
 * then enter the new one, perhaps starting from a Simulation's figures.
 */
export function NewMortgagePage() {
  const [params, setParams] = useSearchParams()
  const customerId = Number(params.get('customer')) || undefined
  // The Customer comes and goes; whatever else the page was opened with stays.
  function setCustomer(id: number | null) {
    const next = new URLSearchParams(params)
    if (id === null) next.delete('customer')
    else next.set('customer', String(id))
    setParams(next)
  }
  const query = params.toString()
  // Kept while the URL is, so the form's Terms start from it only once
  const carried = useMemo(() => carriedIn(new URLSearchParams(query)), [query])
  const { client } = useServerState()
  const customer = useQuery({
    ...customerQuery(client, customerId ?? 0),
    enabled: !!customerId,
  }).data

  return (
    <section className="card wide">
      <h2>New Mortgage</h2>
      {customerId && customer?.id === customerId ? (
        <>
          <CustomerSummary customer={customer} onChange={() => setCustomer(null)} />
          <MortgageForm customer={customer} carried={carried} />
        </>
      ) : (
        <CustomerChooser
          onChoose={setCustomer}
          footer={
            <p className="hint">
              Not a Customer yet? <Link to="/customers/new?next=mortgage">Add a new Customer</Link>{' '}
              first.
            </p>
          }
        />
      )}
    </section>
  )
}

function CustomerSummary({ customer, onChange }: { customer: Customer; onChange: () => void }) {
  const { client } = useServerState()
  const listed = useQuery(everyMortgageQuery(client, { customerId: customer.id, status: 'active' }))
  // None shown if they can't be had: they are only a reminder here.
  const active = listed.data?.items ?? (listed.error ? [] : null)
  const activeTotal = listed.data?.total ?? 0

  return (
    <div className="stack">
      <div className="row spread">
        <div className="row">
          {customer.photo_url ? (
            <img src={customer.photo_url} alt="" className="thumb" />
          ) : (
            <span className="thumb placeholder" />
          )}
          <span>
            <Link to={`/customers/${customer.id}`}>
              <strong>{customer.name}</strong>
            </Link>
            <br />
            <span className="hint">{customer.phone_1}</span>
          </span>
        </div>
        <button type="button" className="secondary small" onClick={onChange}>
          Change Customer
        </button>
      </div>
      <h3>Active Mortgages</h3>
      {active === null ? (
        <p>Loading…</p>
      ) : active.length === 0 ? (
        <p className="hint">None yet.</p>
      ) : (
        <>
          <MortgageTable rows={active} showCustomer={false} />
          {activeTotal > active.length && (
            <p className="hint">
              Showing {active.length} of {activeTotal}.{' '}
              <Link to={`/customers/${customer.id}`}>See all on the Customer page</Link>
            </p>
          )}
        </>
      )}
    </div>
  )
}

function MortgageForm({ customer, carried }: { customer: Customer; carried: Carried }) {
  const navigate = useNavigate()
  const [fields, setFields] = useState({
    start_date: carried.start,
    amountLent: carried.amount,
    description: '',
    gross: '',
    net: '',
    purity: 22 as Purity,
    lentThrough: 'cash' as PaymentMethod, // the usual way, so the one to change from
  })
  const methods = usePaymentMethods()
  const { client } = useServerState()
  const changeLedger = useLedgerChange()
  const defaultTerms = useQuery({
    ...settings.defaultTerms(client),
    enabled: carried.terms === null,
  }).data
  const [terms, setTerms] = useDraft(carried.terms ?? defaultTerms, toDraft)
  const [typedName, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [photos, setPhotos] = useState<{ blob: Blob; url: string }[]>([])
  // Created once: a retried Save (after a failed photo) sends only the photos left.
  const created = useSaveWithPhotos<Mortgage>({
    noun: 'Mortgage',
    stale: STALE_AFTER.mortgagePhoto,
  })
  const locked = created.savedId !== undefined

  // Suggest the Mortgage Name until the Lender types their own.
  const description = useDebounced(fields.description, 250)
  const suggested = useQuery({
    ...suggestedNameQuery(client, {
      customerId: customer.id,
      startDate: fields.start_date,
      description,
    }),
    // Not once created: the name it was created with stays shown for a photo retry.
    enabled: !nameEdited && !locked && fields.start_date !== '',
    placeholderData: (previous) => previous,
  })
  const name = nameEdited ? typedName : (suggested.data?.name ?? '')
  // The suggestion is for the form as it stands, not an earlier description or date,
  // so the name confirmed and saved is never one the Lender has typed past.
  const nameReady =
    nameEdited ||
    (suggested.isSuccess && !suggested.isPlaceholderData && description === fields.description)

  const set = (field: keyof typeof fields) => (value: string) =>
    setFields({ ...fields, [field]: value })

  // What saving would send, once every field it needs is filled in: whether what is typed
  // can stand, the backend says through its Preview.
  const chosenTerms = terms !== null && terms.ratePercent !== '' ? fromDraft(terms) : null
  const asked: (MortgageIn & { terms: Terms }) | null =
    chosenTerms !== null &&
    nameReady &&
    name.trim() !== '' &&
    fields.start_date !== '' &&
    fields.amountLent !== '' &&
    fields.description.trim() !== '' &&
    fields.gross !== '' &&
    fields.net !== '' &&
    !netAboveGross(fields)
      ? {
          customer_id: customer.id,
          name: name.trim(),
          start_date: fields.start_date,
          amount_lent: rupeesToPaise(fields.amountLent),
          description: fields.description,
          gross_weight_mg: gramsToMg(fields.gross),
          net_weight_mg: gramsToMg(fields.net),
          purity_karat: fields.purity,
          lent_through: fields.lentThrough,
          terms: chosenTerms,
        }
      : null

  const { preview, submit, saving, canSave, error, confirmDialog } = useProposedChange({
    change: asked,
    // Warned from its Preview, as every change is: what it would lend in cash. Once
    // created, a retry only sends the photos left: nothing more to preview or confirm.
    preview: (mortgage) => (locked ? null : previews.newMortgage(mortgage)),
    confirm: locked
      ? null
      : (mortgage) => ({
          title: `Create Mortgage ${mortgage.name}?`,
          body: (
            <>
              <Summary
                rows={[
                  ['Customer', customer.name],
                  ['Start date', formatDate(mortgage.start_date)],
                  ['Amount lent', formatINR(mortgage.amount_lent)],
                  ['Lent Through', methods?.[fields.lentThrough] ?? ''],
                  ['Jewellery', mortgage.description],
                  [
                    'Weight',
                    `${fields.gross} grams gross, ${fields.net} grams net, ${fields.purity}K`,
                  ],
                  [
                    'Terms',
                    `${formatRate(mortgage.terms.monthly_rate_bps)} a month · ` +
                      INTEREST_MODES[mortgage.terms.interest_mode],
                  ],
                  ['Photos', String(photos.length)],
                ]}
              />
              <NewMortgageForecast mortgage={mortgage} />
            </>
          ),
        }),
    save: async (mortgage) => {
      try {
        return await created.run(
          // A new Mortgage changes what the lending book is owed.
          () => changeLedger((client) => createMortgage(client, mortgage)),
          photos.map(({ blob }) => ({
            key: blob,
            send: (client, id) => addMortgagePhoto(client, id, blob),
          })),
        )
      } catch (err) {
        setPhotos((all) => all.filter(({ blob }) => !created.isSent(blob))) // the ones left
        throw err
      }
    },
    saved: (id) => navigate(`/mortgages/${id}`),
  })

  return (
    <form onSubmit={submit}>
      <h3>Mortgage details</h3>
      <div className="grid-2">
        <label>
          Start date
          <input
            type="date"
            required
            max={todayIso()}
            disabled={locked}
            value={fields.start_date}
            onChange={(event) => set('start_date')(event.target.value)}
          />
        </label>
        <label>
          Principal lent (₹)
          <RupeeInput
            required
            min="1"
            disabled={locked}
            value={fields.amountLent}
            onChange={(event) => set('amountLent')(event.target.value)}
          />
        </label>
        <label>
          Lent Through
          <PaymentMethodSelect
            methods={methods}
            value={fields.lentThrough}
            onChange={(lentThrough) => setFields({ ...fields, lentThrough })}
            required
          />
        </label>
      </div>
      <label>
        Description of the jewellery
        <textarea
          rows={2}
          required
          disabled={locked}
          placeholder="e.g. Gold chain with pendant, 2 rings"
          value={fields.description}
          onChange={(event) => set('description')(event.target.value)}
        />
      </label>
      <div className="grid-3">
        <WeightFields
          value={fields}
          onChange={(weights) => setFields({ ...fields, ...weights })}
          disabled={locked}
        />
        <label>
          Purity
          <select
            disabled={locked}
            value={fields.purity}
            onChange={(event) =>
              setFields({ ...fields, purity: Number(event.target.value) as Purity })
            }
          >
            {PURITIES.map((karat) => (
              <option key={karat} value={karat}>
                {karat}K
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        Mortgage Name
        <input
          required
          disabled={locked}
          value={name}
          onChange={(event) => {
            setName(event.target.value)
            setNameEdited(true)
          }}
        />
        <FieldProblem
          problem={
            !nameEdited &&
            suggested.isError &&
            `No Mortgage Name could be suggested (${suggested.error.message}): type one.`
          }
        />
        <span className="hint">
          Must start with the start year. A number is added if the name is already taken.
        </span>
      </label>

      <fieldset disabled={locked}>
        <legend>Terms</legend>
        {terms ? <TermsFields value={terms} onChange={setTerms} /> : <p>Loading…</p>}
      </fieldset>

      <fieldset>
        <legend>Photos</legend>
        {photos.length > 0 && (
          <div className="gallery">
            {photos.map((photo, index) => (
              <div key={photo.url} className="gallery-item">
                <Photo url={photo.url} alt={`Photo ${index + 1}`} />
                <button
                  type="button"
                  className="danger small"
                  onClick={() => setPhotos(photos.filter((p) => p !== photo))}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <PhotoSource
          multiple
          onPhotos={(blobs) =>
            setPhotos([
              ...photos,
              ...blobs.map((blob) => ({ blob, url: URL.createObjectURL(blob) })),
            ])
          }
        />
      </fieldset>

      <div className="row">
        <button type="submit" disabled={!canSave}>
          {saving ? 'Saving…' : locked ? 'Retry photo upload' : 'Create Mortgage'}
        </button>
      </div>
      {(error ?? preview.error) && <p className="status error">{error ?? preview.error}</p>}
      {confirmDialog}
    </form>
  )
}
