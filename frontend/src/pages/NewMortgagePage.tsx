import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { api, PURITIES, type Customer, type MortgageIn, type MortgageRow, type Purity } from '../api'
import { NewMortgageForecast } from '../components/ChangeForecasts'
import { CustomerChooser } from '../components/CustomerChooser'
import { Summary } from '../components/ConfirmDialog'
import { MortgageTable } from '../components/MortgageTable'
import { Photo } from '../components/Photo'
import { PhotoSource } from '../components/PhotoSource'
import { TermsFields } from '../components/TermsFields'
import { useConfirm } from '../components/useConfirm'
import { useDebounced } from '../components/useDebounced'
import { formatDate, todayIso } from '../format'
import { formatINR, rupeesToPaise } from '../money'
import { formatRate, fromDraft, INTEREST_MODES, toDraft, type TermsDraft } from '../terms'

/**
 * Create a Mortgage: pick (or create) the Customer, see their Active Mortgages,
 * then enter the new one.
 */
export function NewMortgagePage() {
  const [params, setParams] = useSearchParams()
  const customerId = Number(params.get('customer')) || undefined
  const [customer, setCustomer] = useState<Customer | null>(null)

  useEffect(() => {
    if (customerId) api.getCustomer(customerId).then(setCustomer, () => setCustomer(null))
  }, [customerId])

  return (
    <section className="card wide">
      <h2>New Mortgage</h2>
      {customerId && customer?.id === customerId ? (
        <>
          <CustomerSummary customer={customer} onChange={() => setParams({})} />
          <MortgageForm customer={customer} />
        </>
      ) : (
        <CustomerChooser
          onChoose={(id) => setParams({ customer: String(id) })}
          footer={
            <p className="hint">
              Not a Customer yet?{' '}
              <Link to="/customers/new?next=mortgage">Add a new Customer</Link> first.
            </p>
          }
        />
      )}
    </section>
  )
}

function CustomerSummary({ customer, onChange }: { customer: Customer; onChange: () => void }) {
  const [active, setActive] = useState<MortgageRow[] | null>(null)
  const [activeTotal, setActiveTotal] = useState(0)

  useEffect(() => {
    api
      .listMortgages(1, '', { customerId: customer.id, status: 'active', paged: false })
      .then((page) => {
        setActive(page.items)
        setActiveTotal(page.total)
      })
      .catch(() => setActive([]))
  }, [customer.id])

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

const gramsToMg = (grams: string) => Math.round(Number(grams) * 1000)

function MortgageForm({ customer }: { customer: Customer }) {
  const navigate = useNavigate()
  const [fields, setFields] = useState({
    start_date: todayIso(),
    amountLent: '',
    description: '',
    gross: '',
    net: '',
    purity: 22 as Purity,
  })
  const [terms, setTerms] = useState<TermsDraft | null>(null)
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [photos, setPhotos] = useState<{ blob: Blob; url: string }[]>([])
  // Set once created, so a retried Save (e.g. after a failed photo upload) doesn't duplicate it.
  const [createdId, setCreatedId] = useState<number>()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirm, confirmDialog] = useConfirm()

  useEffect(() => {
    api.getDefaultTerms().then((defaults) => setTerms(toDraft(defaults)))
  }, [])

  // Suggest the Mortgage Name until the Lender types their own.
  const description = useDebounced(fields.description, 250)
  useEffect(() => {
    if (nameEdited || !fields.start_date) return
    api
      .suggestMortgageName(customer.id, fields.start_date, description)
      .then((suggestion) => setName(suggestion.name))
      .catch(() => {})
  }, [customer.id, fields.start_date, description, nameEdited])

  const set = (field: keyof typeof fields) => (value: string) =>
    setFields({ ...fields, [field]: value })

  async function save(event: FormEvent) {
    event.preventDefault()
    if (!terms) return
    const chosenTerms = fromDraft(terms)
    const asked: MortgageIn = {
      customer_id: customer.id,
      name: name.trim() || null,
      start_date: fields.start_date,
      amount_lent: rupeesToPaise(fields.amountLent),
      description: fields.description,
      gross_weight_mg: gramsToMg(fields.gross),
      net_weight_mg: gramsToMg(fields.net),
      purity_karat: fields.purity,
      terms: chosenTerms,
    }
    if (createdId === undefined) {
      const confirmed = await confirm({
        title: `Create Mortgage ${name}?`,
        body: (
          <>
            <Summary
              rows={[
                ['Customer', customer.name],
                ['Start date', formatDate(fields.start_date)],
                ['Amount lent', formatINR(rupeesToPaise(fields.amountLent))],
                ['Jewellery', fields.description],
                ['Weight', `${fields.gross} g gross, ${fields.net} g net, ${fields.purity}K`],
                [
                  'Terms',
                  `${formatRate(chosenTerms.monthly_rate_bps)} a month · ` +
                    INTEREST_MODES[chosenTerms.interest_mode],
                ],
                ['Photos', String(photos.length)],
              ]}
            />
            <NewMortgageForecast mortgage={asked} />
          </>
        ),
      })
      if (!confirmed) return
    }
    setSaving(true)
    setError(null)
    const pending = [...photos] // photos still to upload
    try {
      let id = createdId
      if (id === undefined) {
        const created = await api.createMortgage(asked)
        id = created.id
        setCreatedId(id)
      }
      while (pending.length) {
        await api.addMortgagePhoto(id, pending[0].blob)
        pending.shift()
      }
      navigate(`/mortgages/${id}`)
    } catch (err) {
      setPhotos(pending) // keep only the photos that didn't upload
      setError(
        createdId === undefined
          ? (err as Error).message
          : `Mortgage saved, but a photo failed: ${(err as Error).message}`,
      )
      setSaving(false)
    }
  }

  const locked = createdId !== undefined

  return (
    <form onSubmit={save}>
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
          <input
            type="number"
            required
            min="1"
            step="0.01"
            disabled={locked}
            value={fields.amountLent}
            onChange={(event) => set('amountLent')(event.target.value)}
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
        <label>
          Gross weight (g)
          <input
            type="number"
            required
            min="0.001"
            step="0.001"
            disabled={locked}
            value={fields.gross}
            onChange={(event) => set('gross')(event.target.value)}
          />
        </label>
        <label>
          Net weight, gold only (g)
          <input
            type="number"
            required
            min="0.001"
            step="0.001"
            max={fields.gross || undefined}
            disabled={locked}
            value={fields.net}
            onChange={(event) => set('net')(event.target.value)}
          />
        </label>
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
        <button type="submit" disabled={saving || !terms}>
          {saving ? 'Saving…' : locked ? 'Retry photo upload' : 'Create Mortgage'}
        </button>
      </div>
      {error && <p className="status error">{error}</p>}
      {confirmDialog}
    </form>
  )
}
