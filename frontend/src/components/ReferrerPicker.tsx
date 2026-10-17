import { useState } from 'react'
import type { PersonSummary, ReferrerChoice } from '../api'
import { PersonLink, ReferrerBadge } from './PersonLink'
import { useNumberOwner } from './useNumberOwner'
import { useSearch } from './useSearch'

type Mode = 'none' | 'existing' | 'new'

/** What the picker currently says; 'unpicked' means "Existing person" with nobody chosen yet. */
export type ReferrerSelection = ReferrerChoice | null | 'unpicked'

/**
 * Who introduced this Customer: nobody, an existing Customer or standalone Referrer
 * (found by search), or a new standalone Referrer.
 */
export function ReferrerPicker({
  initial,
  excludeCustomerId,
  onChange,
}: {
  initial: PersonSummary | null
  excludeCustomerId?: number
  /** `name` is who the selection points at, for summaries. */
  onChange: (selection: ReferrerSelection, name?: string) => void
}) {
  const [mode, setMode] = useState<Mode>(initial ? 'existing' : 'none')
  const [picked, setPicked] = useState<PersonSummary | null>(initial)
  const [query, setQuery] = useState('')
  const [newReferrer, setNewReferrer] = useState({ name: '', address: '', phone: '' })
  // A new Referrer's number may already belong to someone; they are linked instead.
  const newNumberOwner = useNumberOwner(mode === 'new' ? newReferrer.phone : '')
  const hits = useSearch(query).filter(
    (hit) => !(hit.kind === 'customer' && hit.id === excludeCustomerId),
  )

  function switchMode(next: Mode) {
    setMode(next)
    if (next === 'none') onChange(null)
    if (next === 'existing')
      onChange(picked ? { kind: picked.kind, id: picked.id } : 'unpicked', picked?.name)
    if (next === 'new') onChange({ kind: 'new', ...newReferrer }, newReferrer.name)
  }

  function pick(person: PersonSummary) {
    setPicked(person)
    setQuery('')
    onChange({ kind: person.kind, id: person.id }, person.name)
  }

  function editNew(field: keyof typeof newReferrer, value: string) {
    const updated = { ...newReferrer, [field]: value }
    setNewReferrer(updated)
    onChange({ kind: 'new', ...updated }, updated.name)
  }

  return (
    <fieldset>
      <legend>Referrer</legend>
      <div className="row">
        {(
          [
            ['none', 'None'],
            ['existing', 'Existing person'],
            ['new', 'New Referrer'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="inline">
            <input
              type="radio"
              name="referrer-mode"
              checked={mode === value}
              onChange={() => switchMode(value)}
            />
            {label}
          </label>
        ))}
      </div>

      {mode === 'existing' && (
        <div className="stack">
          {picked && (
            <p>
              Selected: <strong>{picked.name}</strong>
              <ReferrerBadge person={picked} />
            </p>
          )}
          <input
            placeholder="Search Customers and Referrers by name or phone"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {hits.length > 0 && (
            <ul className="plain picker">
              {hits.map((hit) => (
                <li key={`${hit.kind}-${hit.id}`}>
                  <button type="button" className="link" onClick={() => pick(hit)}>
                    {hit.name} · {hit.phone}
                    <ReferrerBadge person={hit} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {mode === 'new' && (
        <div className="stack">
          <label>
            Name
            <input
              required
              value={newReferrer.name}
              onChange={(event) => editNew('name', event.target.value)}
            />
          </label>
          <label>
            Address
            <input
              value={newReferrer.address}
              onChange={(event) => editNew('address', event.target.value)}
            />
          </label>
          <label>
            Phone
            <input
              required
              inputMode="tel"
              value={newReferrer.phone}
              onChange={(event) => editNew('phone', event.target.value)}
            />
            {newNumberOwner && (
              <span className="status warning">
                This number belongs to <PersonLink person={newNumberOwner} />. They will be linked
                as the Referrer.
              </span>
            )}
          </label>
        </div>
      )}
    </fieldset>
  )
}
