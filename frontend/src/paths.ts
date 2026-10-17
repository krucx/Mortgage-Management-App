import type { PersonSummary } from './api'

export function personPath(person: PersonSummary): string {
  return person.kind === 'customer' ? `/customers/${person.id}` : `/referrers/${person.id}`
}
