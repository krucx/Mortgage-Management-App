import { Link } from 'react-router'
import type { PersonSummary } from '../api'
import { personPath } from '../paths'

export function ReferrerBadge({ person }: { person: Pick<PersonSummary, 'kind'> }) {
  return person.kind === 'referrer' ? <span className="badge">Referrer</span> : null
}

export function PersonLink({ person }: { person: PersonSummary }) {
  return (
    <Link to={personPath(person)}>
      {person.name}
      <ReferrerBadge person={person} />
    </Link>
  )
}

/** People as a comma-separated run of links, for use inside a sentence. */
export function PeopleInline({ people }: { people: PersonSummary[] }) {
  return people.map((person, index) => (
    <span key={`${person.kind}-${person.id}`}>
      {index > 0 && ', '}
      <PersonLink person={person} />
    </span>
  ))
}

export function PersonList({ people, empty }: { people: PersonSummary[]; empty: string }) {
  if (people.length === 0) return <p className="hint">{empty}</p>
  return (
    <ul className="plain">
      {people.map((person) => (
        <li key={`${person.kind}-${person.id}`}>
          <PersonLink person={person} />
        </li>
      ))}
    </ul>
  )
}
