import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import type { Customer, CustomerIn, IdCard, PersonSummary } from '../api'
import { PeopleInline, PersonLink } from '../components/PersonLink'
import { Photo } from '../components/Photo'
import { PhotoPicker } from '../components/PhotoPicker'
import { PhotoSource } from '../components/PhotoSource'
import { ReferrerPicker, type ReferrerSelection } from '../components/ReferrerPicker'
import { useNumberOwner } from '../components/useNumberOwner'
import { usePreview } from '../components/usePreview'
import { Summary } from '../components/ConfirmDialog'
import { useConfirm } from '../components/useConfirm'
import { maskedAadhaar } from '../format'
import { findAadhaarLast4, findPan } from '../idNumbers'
import { readText } from '../ocr'
import { normalisePhone } from '../phone'
import { customerChanges, customerQuery, searchQuery } from '../requests'
import { STALE_AFTER, useChange, useServerState } from '../serverState'

const EMPTY = { name: '', address: '', phone_1: '', phone_2: '', email: '', aadhaar_last4: '', pan: '' }

/** An ID Photo as the form will leave it: kept, replaced by a new one, or removed. */
type IdPhotoChange = { kind: 'keep' } | { kind: 'new'; photo: Blob } | { kind: 'remove' }
const ID_CARDS: { card: IdCard; label: string; urlOf: (c: Customer) => string | null }[] = [
  { card: 'aadhaar', label: 'Aadhaar card photo (the masked front)', urlOf: (c) => c.aadhaar_photo_url },
  { card: 'pan', label: 'PAN card photo', urlOf: (c) => c.pan_photo_url },
]
/** The field each card's number goes in, and how it is found in the card's text. */
const READ_FROM: Record<IdCard, { field: 'aadhaar_last4' | 'pan'; find: (text: string) => string | null }> = {
  aadhaar: { field: 'aadhaar_last4', find: findAadhaarLast4 },
  pan: { field: 'pan', find: findPan },
}
const CARD_NAMES: Record<IdCard, string> = { aadhaar: 'Aadhaar', pan: 'PAN' }

/** The last 4 digits of an Aadhaar Number as typed (whole, masked or the 4 alone). */
const typedLast4 = (typed: string) => typed.replace(/\D/g, '').slice(-4)

/** What is sent for an Aadhaar Number as typed: only its last 4 digits when it is whole
 *  or masked, so the full number never leaves the form; anything else as typed, for the
 *  backend to refuse. */
function sentAadhaar(typed: string): string | null {
  const digits = typed.replace(/\D/g, '')
  if (!typed.trim()) return null
  return digits.length === 4 || digits.length === 12 ? digits.slice(-4) : typed
}

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
  const [idPhotos, setIdPhotos] = useState<Record<IdCard, IdPhotoChange>>({
    aadhaar: { kind: 'keep' },
    pan: { kind: 'keep' },
  })
  // Each card's number: being read from its new ID Photo, or filled in from it (until
  // edited); and the photo each card's reading is for, so a superseded one is dropped.
  const [read, setRead] = useState<Record<IdCard, 'reading' | 'read' | null>>({
    aadhaar: null,
    pan: null,
  })
  const readingFor = useRef<Record<IdCard, Blob | null>>({ aadhaar: null, pan: null })
  // The fields as they now stand, for a reading that finishes after more typing.
  const typed = useRef(fields)
  useEffect(() => {
    typed.current = fields
  }, [fields])

  /** Read the number on a new ID Photo into its field, only if the field is still empty
   *  when the reading is done: a suggestion, never over what was typed. */
  async function readNumber(card: IdCard, photo: Blob) {
    const { field, find } = READ_FROM[card]
    readingFor.current[card] = photo
    setRead((now) => ({ ...now, [card]: 'reading' }))
    let found: string | null = null
    try {
      found = find(await readText(photo))
    } catch {
      // Unreadable or the reader unavailable: the field stays as it was.
    }
    if (readingFor.current[card] !== photo) return // replaced or removed meanwhile
    readingFor.current[card] = null
    const fill = found !== null && !typed.current[field].trim()
    if (fill) setFields((now) => ({ ...now, [field]: found }))
    setRead((now) => ({ ...now, [card]: fill ? 'read' : null }))
  }
  /** Typing in a card's number field: it is the Lender's own from then on. */
  const typedOver = (card: IdCard) => setRead((now) => ({ ...now, [card]: null }))
  const readHint = (card: IdCard) =>
    read[card] === 'reading' ? (
      <span className="hint">Reading the photo…</span>
    ) : (
      read[card] === 'read' && <span className="status warning">Read from the photo: check it.</span>
    )
  const [phone2Shared, setPhone2Shared] = useState<PersonSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { client, queryClient } = useServerState()
  const changeCustomer = useChange(STALE_AFTER.customer)

  // Contact number 1 is the Primary Number: it identifies the person.
  const numberOwner = useNumberOwner(fields.phone_1)
  const ownerIsSelf = numberOwner?.kind === 'customer' && numberOwner.id === customerId

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
  const idPhotoChanges = ID_CARDS.flatMap(({ card }) => {
    const change = idPhotos[card]
    return change.kind === 'keep' ? [] : [`${CARD_NAMES[card]} ${change.kind === 'new' ? 'new' : 'removed'}`]
  })
  const check = usePreview(asked && customerChanges.preview(asked, customerId))
  const unchecked = asked !== null && (check.loading || check.error !== null)

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
    if (unchecked) return
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
    setSaving(true)
    setError(null)
    const customer = { ...details, referrer }
    try {
      let saved = await changeCustomer((client) =>
        customerChanges.save(client, customer, customerId),
      )
      setCreatedId(saved.id)
      const savedId = saved.id
      if (photo) {
        saved = await changeCustomer((client) => customerChanges.replacePhoto(client, savedId, photo))
      }
      for (const { card } of ID_CARDS) {
        const change = idPhotos[card]
        if (change.kind === 'new') {
          saved = await changeCustomer((client) =>
            customerChanges.replaceIdPhoto(client, savedId, card, change.photo),
          )
        } else if (change.kind === 'remove') {
          saved = await changeCustomer((client) => customerChanges.removeIdPhoto(client, savedId, card))
        }
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
      {numberOwner?.kind === 'referrer' && customerId === undefined && (
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
            <label>
              Email (optional)
              <input
                type="email"
                value={fields.email}
                onChange={(event) => setFields({ ...fields, email: event.target.value })}
              />
            </label>
          </div>
        </div>

        <div className="grid-2">
          <div className="stack">
            <label>
              Aadhaar Number: last 4 digits (optional)
              <input
                inputMode="numeric"
                placeholder="1234"
                aria-describedby="aadhaar-hint"
                value={fields.aadhaar_last4}
                onChange={(event) => {
                  setFields({ ...fields, aadhaar_last4: event.target.value })
                  typedOver('aadhaar')
                }}
              />
            </label>
            {readHint('aadhaar')}
            <span className="hint" id="aadhaar-hint">
              Only the last 4 digits are kept. Ask for the Customer's masked Aadhaar.
            </span>
          </div>
          <div className="stack">
            <label>
              PAN (optional)
              <input
                placeholder="ABCDE1234F"
                value={fields.pan}
                onChange={(event) => {
                  setFields({ ...fields, pan: event.target.value.toUpperCase() })
                  typedOver('pan')
                }}
              />
            </label>
            {readHint('pan')}
          </div>
        </div>
        <div className="grid-2">
          {ID_CARDS.map(({ card, label, urlOf }) => (
            <IdPhotoPicker
              key={card}
              label={label}
              currentUrl={existing ? urlOf(existing) : null}
              change={idPhotos[card]}
              onChange={(change) => {
                setIdPhotos({ ...idPhotos, [card]: change })
                if (change.kind === 'new') void readNumber(card, change.photo)
                else {
                  readingFor.current[card] = null // a reading under way is dropped
                  setRead((now) => ({ ...now, [card]: null }))
                }
              }}
            />
          ))}
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
          <button type="submit" disabled={saving || unchecked}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="secondary" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
        {check.error && <p className="status error">{check.error}</p>}
        {error && <p className="status error">{error}</p>}
      </form>
      {confirmDialog}
    </section>
  )
}

/** One ID Photo on the form: the current or newly chosen photo, a way to choose one,
 *  and Remove. Nothing is uploaded or removed until Save. */
function IdPhotoPicker({
  label,
  currentUrl,
  change,
  onChange,
}: {
  label: string
  currentUrl: string | null
  change: IdPhotoChange
  onChange: (change: IdPhotoChange) => void
}) {
  const [preview, setPreview] = useState<string | null>(null)
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])
  const shown = change.kind === 'remove' ? null : change.kind === 'new' ? preview : currentUrl
  return (
    <fieldset className="stack id-photo-picker">
      <legend>{label}</legend>
      <Photo url={shown} alt={label} />
      <PhotoSource
        onPhotos={([photo]) => {
          setPreview(URL.createObjectURL(photo))
          onChange({ kind: 'new', photo })
        }}
      />
      {shown && (
        <div>
          <button type="button" className="secondary small" onClick={() => onChange({ kind: 'remove' })}>
            Remove
          </button>
        </div>
      )}
    </fieldset>
  )
}
