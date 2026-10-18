import { hashKey, keepPreviousData, useQuery } from '@tanstack/react-query'
import { useCallback, useState, type ReactNode } from 'react'
import type { ListRequest } from '../requests'
import { keys, useServerState } from '../serverState'
import { Pager } from './Pager'
import { useUrlSort, type Sorting } from './useUrlSort'

/** What every page of a list carries. */
interface ListedPage {
  items: unknown[]
  total: number
  page: number
  page_size: number
}

/**
 * A list that comes a page at a time, sorted on the server across every page: the
 * sort (kept in the URL as `sortParam`), the page number, stepping back a page when one
 * comes back empty, and the pager. Changing the sort, or the list's filters, starts
 * again at page 1. The page shown stays until the next arrives, and only the latest
 * one asked for is shown, so a quick second click never leaves the first sort on screen.
 * `columns` should be a constant.
 */
export function useListPage<Column extends string, Listed extends ListedPage>(
  columns: readonly Column[],
  list: ListRequest<Column, Listed>,
  { sortParam }: { sortParam?: string } = {},
): {
  listed: Listed | null
  sorting: Sorting<Column>
  error: string | null
  pager: ReactNode
} {
  const { client } = useServerState()
  // The page, for the filters it was chosen with: other filters start at page 1.
  const listKey = hashKey(list.key)
  const [pageOf, setPageOf] = useState({ listKey, page: 1 })
  const page = pageOf.listKey === listKey ? pageOf.page : 1
  const setPage = useCallback((next: number) => setPageOf({ listKey, page: next }), [listKey])
  const sorting = useUrlSort(columns, { param: sortParam, onChange: () => setPage(1) })
  const { sort } = sorting
  const query = useQuery({
    queryKey: [...keys.lists, ...list.key, { page, sort }],
    queryFn: () => list.load(client, page, sort),
    placeholderData: keepPreviousData,
  })
  const listed = query.data ?? null

  // Its last item was just Approved, Redeemed, marked called…: step back a page
  // instead of showing "Showing 21–20 of 20".
  // (Set while rendering, as React allows for a component's own state.)
  const emptied = !query.isPlaceholderData && listed?.items.length === 0 && listed.page > 1
  if (emptied && page === listed.page) setPage(listed.page - 1)

  const pager = listed && !emptied && (
    <Pager
      page={listed.page}
      pageSize={listed.page_size}
      total={listed.total}
      shown={listed.items.length}
      onPage={setPage}
    />
  )
  return {
    listed,
    sorting,
    error: query.error?.message ?? null,
    pager,
  }
}
