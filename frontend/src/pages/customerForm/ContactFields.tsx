import { useState } from 'react'
import type { PersonSummary } from '../../api'
import { PeopleInline, PersonLink } from '../../components/PersonLink'
import { useNumberOwner } from '../../components/useNumberOwner'
import { normalisePhone } from '../../phone'
import { searchQuery } from '../../requests'
import { useServerState } from '../../serverState'

/** Contact number 1 (the Primary Number, checked for who already owns it), Contact number 2
 *  (warned when shared) and Email. */
export function ContactFields({
  phone1,
  phone2,
  email,
  customerId,
  onChange,
}: {
  phone1: string
  phone2: string
  email: string
  /** The Customer being edited or just saved; undefined for a new one. */
  customerId: number | undefined
  onChange: (field: 'phone_1' | 'phone_2' | 'email', value: string) => void
}) {
  const { client, queryClient } = useServerState()
  const [phone2Shared, setPhone2Shared] = useState<PersonSummary[]>([])

  // Contact number 1 is the Primary Number: it identifies the person.
  const numberOwner = useNumberOwner(phone1)
  const ownerIsSelf = numberOwner?.kind === 'customer' && numberOwner.id === customerId

  /** Contact number 2 may be shared (e.g. a family phone): warn, never block. */
  async function checkPhone2() {
    // Stored numbers are exactly 10 digits, so searching a complete number is an exact match.
    const phone = normalisePhone(phone2)
    const others = phone
      ? (await queryClient.fetchQuery(searchQuery(client, phone)).catch(() => [])).filter(
          (hit) => hit.kind === 'customer' && hit.id !== customerId,
        )
      : []
    setPhone2Shared(others)
  }

  return (
    <>
      <label>
        Contact number 1
        <input
          inputMode="tel"
          required
          value={phone1}
          onChange={(event) => onChange('phone_1', event.target.value)}
        />
        {numberOwner?.kind === 'customer' && !ownerIsSelf && (
          <span className="status error">
            Already belongs to Customer <PersonLink person={numberOwner} />
          </span>
        )}
        {numberOwner?.kind === 'referrer' && customerId === undefined && (
          <span className="status warning">
            Belongs to <PersonLink person={numberOwner} />. Saving makes them this Customer, and the
            people they referred move with them.
          </span>
        )}
      </label>
      <label>
        Contact number 2 (optional)
        <input
          inputMode="tel"
          value={phone2}
          onChange={(event) => onChange('phone_2', event.target.value)}
          onBlur={checkPhone2}
        />
        {phone2Shared.length > 0 && (
          <span className="status warning">
            Also used by <PeopleInline people={phone2Shared} />
          </span>
        )}
      </label>
      <label>
        Email (optional)
        <input
          type="email"
          value={email}
          onChange={(event) => onChange('email', event.target.value)}
        />
      </label>
    </>
  )
}
