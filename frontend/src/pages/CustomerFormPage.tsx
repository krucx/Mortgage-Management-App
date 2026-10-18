import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import type { Customer, PersonSummary } from '../api'
import { PeopleInline, PersonLink } from '../components/PersonLink'
import { PhotoPicker } from '../components/PhotoPicker'
import { ReferrerPicker, type ReferrerSelection } from '../components/ReferrerPicker'
import { useNumberOwner } from '../components/useNumberOwner'
import { Summary } from '../components/ConfirmDialog'
import { useConfirm } from '../components/useConfirm'
import { normalisePhone } from '../phone'
import { customerChanges, customerQuery, searchQuery } from '../requests'
import { STALE_AFTER, useChange, useServerState } from '../serverState'

const EMPTY = { name: '', address: '', phone_1: '', phone_2: '' }

/** Create a new Customer, or edit one when the URL has an id. */
export function CustomerFormPage() {
  const { id } = useParams()
  const { client } = useServerState()
  const loaded = useQuery({ ...customerQuery(client, Number(id)), enabled: id !== undefined })
  if (id === undefined) return <CustomerForm existing={null} />
  if (!loaded.data) {
    return loaded.error ? <p className="status error">{loaded.error.message}</p> : <p>Loading…</p>
  }
  // Keyed so the form starts again from another Customer.
  return <CustomerForm key={id} existing={loaded.data} />
}

function CustomerForm({ existing }: { existing: Customer | null }) {
  const id = existing?.id
  // Set once a new Customer is created, so a retried Save (e.g. after a failed photo upload)
  // updates that Customer instead of creating a duplicate.
  const [createdId, setCreatedId] = useState<number>()
  const customerId = id ?? createdId
  const navigate = useNavigate()
  // ?next=mortgage: after saving a new Customer, carry on to their new Mortgage.
  const next = useSearchParams()[0].get('next')

  const [fields, setFields] = useState(() =>
    existing
      ? {
          name: existing.name,
          address: existing.address,
          phone_1: existing.phone_1,
          phone_2: existing.phone_2 ?? '',
        }
      : EMPTY,
  )
  const [referrer, setReferrer] = useState<ReferrerSelection>(
    existing?.referrer ? { kind: existing.referrer.kind, id: existing.referrer.id } : null,
  )
  const [referrerName, setReferrerName] = useState(existing?.referrer?.name)
  const [confirm, confirmDialog] = useConfirm()
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [phone2Shared, setPhone2Shared] = useState<PersonSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { client, queryClient } = useServerState()
  const changeCustomer = useChange(STALE_AFTER.customer)

  /** Warn (never block) when another Customer already uses this number. */
  // Contact number 1 is the Primary Number: it identifies the person.
  const numberOwner = useNumberOwner(fields.phone_1)
  const ownerIsSelf = numberOwner?.kind === 'customer' && numberOwner.id === customerId

  /** Contact number 2 may be shared (e.g. a family phone): warn, never block. */
  async function checkPhone2() {
    // Stored numbers are exactly 10 digits, so searching a complete number is an exact match.
    const phone = normalisePhone(fields.phone_2)
    const others = phone
      ? (await queryClient.fetchQuery(searchQuery(client, phone)).catch(() => [])).filter(
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
    const confirmed = await confirm({
      title: customerId === undefined ? 'Add this Customer?' : `Save changes to ${fields.name}?`,
      body: (
        <Summary
          rows={[
            ['Name', fields.name],
            ['Address', fields.address || '—'],
            ['Contact numbers', [fields.phone_1, fields.phone_2].filter(Boolean).join(', ')],
            [
              'Referrer',
              referrer === null
                ? '—'
                : referrer.kind === 'new'
                  ? `${referrerName} (new Referrer, ${referrer.phone})`
                  : referrerName,
            ],
            ['Photo', photo ? 'New photo' : existing?.photo_url ? 'Unchanged' : '—'],
          ]}
        />
      ),
    })
    if (!confirmed) return
    setSaving(true)
    setError(null)
    const customer = { ...fields, phone_2: fields.phone_2.trim() || null, referrer }
    try {
      let saved = await changeCustomer((client) =>
        customerChanges.save(client, customer, customerId),
      )
      setCreatedId(saved.id)
      const savedId = saved.id
      if (photo) {
        saved = await changeCustomer((client) => customerChanges.replacePhoto(client, savedId, photo))
      }
      navigate(
        next === 'mortgage' ? `/mortgages/new?customer=${saved.id}` : `/customers/${saved.id}`,
      )
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  const editing = id !== undefined

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
          onChange={(selection, name) => {
            setReferrer(selection)
            setReferrerName(name)
          }}
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
      {confirmDialog}
    </section>
  )
}
