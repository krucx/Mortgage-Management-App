import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, type Customer, type PersonSummary } from '../api'
import { PeopleInline, PersonLink } from '../components/PersonLink'
import { PhotoPicker } from '../components/PhotoPicker'
import { ReferrerPicker, type ReferrerSelection } from '../components/ReferrerPicker'
import { useNumberOwner } from '../components/useNumberOwner'
import { normalisePhone } from '../phone'

const EMPTY = { name: '', address: '', phone_1: '', phone_2: '' }

/** Create a new Customer, or edit one when the URL has an id. */
export function CustomerFormPage() {
  const { id } = useParams()
  // Set once a new Customer is created, so a retried Save (e.g. after a failed photo upload)
  // updates that Customer instead of creating a duplicate.
  const [createdId, setCreatedId] = useState<number>()
  const customerId = id ? Number(id) : createdId
  const navigate = useNavigate()

  const [existing, setExisting] = useState<Customer | null>(null)
  const [fields, setFields] = useState(EMPTY)
  const [referrer, setReferrer] = useState<ReferrerSelection>(null)
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [phone2Shared, setPhone2Shared] = useState<PersonSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    api
      .getCustomer(Number(id))
      .then((customer) => {
        setExisting(customer)
        setFields({
          name: customer.name,
          address: customer.address,
          phone_1: customer.phone_1,
          phone_2: customer.phone_2 ?? '',
        })
        setReferrer(customer.referrer && { kind: customer.referrer.kind, id: customer.referrer.id })
      })
      .catch((err: Error) => setError(err.message))
  }, [id])

  /** Warn (never block) when another Customer already uses this number. */
  // Contact number 1 is the Primary Number: it identifies the person.
  const numberOwner = useNumberOwner(fields.phone_1)
  const ownerIsSelf = numberOwner?.kind === 'customer' && numberOwner.id === customerId

  /** Contact number 2 may be shared (e.g. a family phone): warn, never block. */
  async function checkPhone2() {
    // Stored numbers are exactly 10 digits, so searching a complete number is an exact match.
    const phone = normalisePhone(fields.phone_2)
    const others = phone
      ? (await api.search(phone).catch(() => [])).filter(
          (hit) => hit.kind === 'customer' && hit.id !== customerId,
        )
      : []
    setPhone2Shared(others)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (referrer === 'unpicked') {
      setError('Pick the Referrer from the search results, or choose "None".')
      return
    }
    setSaving(true)
    setError(null)
    const customer = { ...fields, phone_2: fields.phone_2.trim() || null, referrer }
    try {
      let saved =
        customerId === undefined
          ? await api.createCustomer(customer)
          : await api.updateCustomer(customerId, customer)
      setCreatedId(saved.id)
      if (photo) saved = await api.replaceCustomerPhoto(saved.id, photo)
      navigate(`/customers/${saved.id}`)
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  const editing = id !== undefined
  if (editing && !existing && !error) return <p>Loading…</p>

  const phone1Field = (
    <label>
      Contact number 1
      <input
        inputMode="tel"
        required
        value={fields.phone_1}
        onChange={(event) => setFields({ ...fields, phone_1: event.target.value })}
      />
      {numberOwner?.kind === 'customer' && !ownerIsSelf && (
        <span className="status error">
          Already belongs to Customer <PersonLink person={numberOwner} />
        </span>
      )}
      {numberOwner?.kind === 'referrer' && (
        <span className="status warning">
          Belongs to <PersonLink person={numberOwner} />. Saving makes them this Customer, and
          the people they referred move with them.
        </span>
      )}
    </label>
  )

  const phone2Field = (
    <label>
      Contact number 2 (optional)
      <input
        inputMode="tel"
        value={fields.phone_2}
        onChange={(event) => setFields({ ...fields, phone_2: event.target.value })}
        onBlur={checkPhone2}
      />
      {phone2Shared.length > 0 && (
        <span className="status warning">
          Also used by <PeopleInline people={phone2Shared} />
        </span>
      )}
    </label>
  )

  return (
    <section className="card">
      <h2>{editing ? `Edit ${existing?.name ?? 'Customer'}` : 'New Customer'}</h2>
      <form onSubmit={save}>
        <div className="with-photo">
          <PhotoPicker currentUrl={existing?.photo_url ?? null} onChange={setPhoto} />
          <div className="stack">
            <label>
              Name
              <input
                required
                value={fields.name}
                onChange={(event) => setFields({ ...fields, name: event.target.value })}
              />
            </label>
            <label>
              Address
              <textarea
                rows={2}
                value={fields.address}
                onChange={(event) => setFields({ ...fields, address: event.target.value })}
              />
            </label>
            {phone1Field}
            {phone2Field}
          </div>
        </div>

        <ReferrerPicker
          initial={existing?.referrer ?? null}
          excludeCustomerId={customerId}
          onChange={setReferrer}
        />

        <div className="row">
          <button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="secondary" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
        {error && <p className="status error">{error}</p>}
      </form>
    </section>
  )
}
