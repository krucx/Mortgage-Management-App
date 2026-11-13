import { useQuery } from '@tanstack/react-query'

/** The query options object a `useQuery` call for one setting group needs. */
export type SettingQuery<T> = Parameters<typeof useQuery<T, Error, T, string[]>>[0]

export type Status = { kind: 'saved' | 'error'; text: string } | null

/** What saving said, or else why the group could not be loaded. */
export const shownStatus = (status: Status, loadError: Error | null): Status =>
  status ?? (loadError ? { kind: 'error', text: loadError.message } : null)
