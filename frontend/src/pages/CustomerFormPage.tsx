import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router'
import { api, type Customer, type PersonSummary } from '../api'
import { PeopleInline } from '../components/PersonLink'
import { PhotoPicker } from '../components/PhotoPicker'
import { ReferrerPicker, type ReferrerSelection } from '../components/ReferrerPicker'
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
  const [phoneWarnings, setPhoneWarnings] = useState<Record<string, PersonSummary[]>>({})
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
  async function checkPhone(field: 'phone_1' | 'phone_2') {
    // Only a complete number is checked; stored numbers are exactly 10 digits, so this is an exact match.
    const phone = normalisePhone(fields[field])
    const others = phone
      ? (await api.search(phone).catch(() => [])).filter(
          (hit) => hit.kind === 'customer' && hit.id !== customerId,
        )
      : []
    setPhoneWarnings((warnings) => ({ ...warnings, [field]: others }))
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

  const phoneField = (field: 'phone_1' | 'phone_2', label: string, required: boolean) => (
    <label>
      {label}
      <input
        inputMode="tel"
        required={required}
        value={fields[field]}
        onChange={(event) => setFields({ ...fields, [field]: event.target.value })}
        onBlur={() => checkPhone(field)}
      />
      {(phoneWarnings[field]?.length ?? 0) > 0 && (
        <span className="status warning">
          Also used by <PeopleInline people={phoneWarnings[field]} />
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
            {phoneField('phone_1', 'Contact number 1', true)}
            {phoneField('phone_2', 'Contact number 2 (optional)', false)}
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
