import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import type { Customer, CustomerIn, IdCard } from '../api'
import { NotLoaded } from '../components/NotLoaded'
import { PhotoPicker } from '../components/PhotoPicker'
import { ReferrerPicker, type ReferrerSelection } from '../components/ReferrerPicker'
import { usePreview } from '../components/usePreview'
import { useSaveWithPhotos, type PhotoUpload } from '../components/useSaveWithPhotos'
import { Summary } from '../components/ConfirmDialog'
import { useConfirm } from '../components/useConfirm'
import { maskedAadhaar } from '../format'
import { normalisePhone } from '../phone'
import { customerChanges, customerQuery } from '../requests'
import { STALE_AFTER, useChange, useServerState, type ApiClient } from '../serverState'
import { ContactFields } from './customerForm/ContactFields'
import {
  idPhotoChangeNotes,
  idPhotoUploads,
  NO_ID_PHOTO_CHANGES,
  READ_FROM,
  sentAadhaar,
  typedLast4,
  type IdPhotoChange,
} from './customerForm/idCards'
import { IdNumberFields } from './customerForm/IdNumberFields'
import { IdPhotos } from './customerForm/IdPhotos'
import { PersonalDetailsFields } from './customerForm/PersonalDetailsFields'
import { useIdNumberReading } from './customerForm/useIdNumberReading'

const EMPTY = {
  name: '',
  address: '',
  phone_1: '',
  phone_2: '',
  email: '',
  aadhaar_last4: '',
  pan: '',
}

/** Create a new Customer, or edit one when the URL has an id. */
export function CustomerFormPage() {
  const { id } = useParams()
  const { client } = useServerState()
  const loaded = useQuery({ ...customerQuery(client, Number(id)), enabled: id !== undefined })
  if (id === undefined) return <CustomerForm existing={null} />
  if (!loaded.data) {
    return <NotLoaded error={loaded.error} missing={`Customer ${id}`} />
  }
  // Keyed so the form starts again from another Customer.
  return <CustomerForm key={id} existing={loaded.data} />
}

function CustomerForm({ existing }: { existing: Customer | null }) {
  const id = existing?.id
  // Saved once: a retried Save (after a failed photo) sends only the photos left, and
  // the Customer's details are locked, as they are already saved.
  const saved = useSaveWithPhotos<Customer>({ noun: 'Customer', stale: STALE_AFTER.customer })
  const customerId = id ?? saved.savedId
  const locked = saved.savedId !== undefined
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
          email: existing.email ?? '',
          aadhaar_last4: existing.aadhaar_last4 ?? '',
          pan: existing.pan ?? '',
        }
      : EMPTY,
  )
  const [referrer, setReferrer] = useState<ReferrerSelection>(
    existing?.referrer ? { kind: existing.referrer.kind, id: existing.referrer.id } : null,
  )
  const [referrerName, setReferrerName] = useState(existing?.referrer?.name)
  const [confirm, confirmDialog] = useConfirm()
  const [photo, setPhoto] = useState<Blob | null>(null)
  const [idPhotos, setIdPhotos] = useState<Record<IdCard, IdPhotoChange>>(NO_ID_PHOTO_CHANGES)
  const { read, readNumber, typedOver, dropReading } = useIdNumberReading(
    (field) => fields[field],
    (field, value) => setFields((now) => ({ ...now, [field]: value })),
  )
  const [error, setError] = useState<string | null>(null)
  const changeCustomer = useChange(STALE_AFTER.customer)

  // What saving would send, checked by the backend as it is typed: a save it would refuse
  // (e.g. someone else's Primary Number) can't be pressed, and its reason is shown.
  const details = {
    ...fields,
    phone_2: fields.phone_2.trim() || null,
    email: fields.email.trim() || null,
    aadhaar_last4: sentAadhaar(fields.aadhaar_last4),
    pan: fields.pan.trim() || null,
  }
  const asked: CustomerIn | null =
    referrer === 'unpicked' || !fields.name.trim() || !normalisePhone(fields.phone_1)
      ? null
      : { ...details, referrer }
  const idPhotoChanges = idPhotoChangeNotes(idPhotos)
  const check = usePreview(asked && customerChanges.preview(asked, customerId))
  const unchecked = asked !== null && (check.loading || check.error !== null)

  async function save(event: FormEvent) {
    event.preventDefault()
    if (unchecked) return
    if (referrer === 'unpicked') {
      setError('Pick the Referrer from the search results, or choose "None".')
      return
    }
    // Once saved, a retry only sends the photos left: nothing more to confirm.
    if (!locked) {
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
              ['Email', details.email ?? '—'],
              [
                'Aadhaar Number',
                details.aadhaar_last4 ? maskedAadhaar(typedLast4(details.aadhaar_last4)) : '—',
              ],
              ['PAN', details.pan?.toUpperCase() ?? '—'],
              ['ID Photos', idPhotoChanges.length ? idPhotoChanges.join(' · ') : 'Unchanged'],
            ]}
          />
        ),
      })
      if (!confirmed) return
    }
    setError(null)
    const customer = { ...details, referrer }
    const uploads: PhotoUpload[] = [
      ...(photo
        ? [
            {
              key: photo,
              send: (c: ApiClient, id: number) => customerChanges.replacePhoto(c, id, photo),
            },
          ]
        : []),
      ...idPhotoUploads(idPhotos),
    ]
    const savedId = await saved.run(
      () => changeCustomer((client) => customerChanges.save(client, customer, customerId)),
      uploads,
    )
    if (savedId === undefined) return
    navigate(next === 'mortgage' ? `/mortgages/new?customer=${savedId}` : `/customers/${savedId}`)
  }

  const editing = id !== undefined

  const setField = (field: keyof typeof EMPTY, value: string) =>
    setFields((now) => ({ ...now, [field]: value }))

  return (
    <section className="card">
      <h2>{editing ? `Edit ${existing?.name ?? 'Customer'}` : 'New Customer'}</h2>
      <form onSubmit={save}>
        <div className="with-photo">
          <PhotoPicker currentUrl={existing?.photo_url ?? null} onChange={setPhoto} />
          <fieldset className="unframed" disabled={locked}>
            <div className="stack">
              <PersonalDetailsFields
                name={fields.name}
                address={fields.address}
                onChange={setField}
              />
              <ContactFields
                phone1={fields.phone_1}
                phone2={fields.phone_2}
                email={fields.email}
                customerId={customerId}
                onChange={setField}
              />
            </div>
          </fieldset>
        </div>

        <fieldset className="unframed" disabled={locked}>
          <IdNumberFields
            aadhaar={fields.aadhaar_last4}
            pan={fields.pan}
            read={read}
            onChange={(card, value) => {
              setField(READ_FROM[card].field, value)
              typedOver(card)
            }}
          />
        </fieldset>
        <IdPhotos
          existing={existing}
          changes={idPhotos}
          onChange={(card, change) => {
            setIdPhotos((now) => ({ ...now, [card]: change }))
            if (change.kind === 'new') void readNumber(card, change.photo)
            else dropReading(card)
          }}
        />

        <fieldset className="unframed" disabled={locked}>
          <ReferrerPicker
            initial={existing?.referrer ?? null}
            excludeCustomerId={customerId}
            onChange={(selection, name) => {
              setReferrer(selection)
              setReferrerName(name)
            }}
          />
        </fieldset>

        <div className="row">
          <button type="submit" disabled={saved.saving || unchecked}>
            {saved.saving ? 'Saving…' : locked ? 'Retry photo upload' : 'Save'}
          </button>
          <button type="button" className="secondary" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
        {check.error && <p className="status error">{check.error}</p>}
        {(error ?? saved.error) && <p className="status error">{error ?? saved.error}</p>}
      </form>
      {confirmDialog}
    </section>
  )
}
