import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { showOrStepBack } from '../paging'
import type { Sort } from '../sort'
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
 * comes back empty, and the pager. Changing the sort, or `resetOn` (a tab or filter),
 * starts again at page 1. `fetchPage` should change only when what it fetches does
 * (wrap it in useCallback), and `columns` should be a constant. Only the latest
 * request is shown, so a quick second click never leaves the first sort on screen.
 */
export function useListPage<Column extends string, Listed extends ListedPage>(
  columns: readonly Column[],
  fetchPage: (page: number, sort: Sort<Column> | null) => Promise<Listed>,
  { sortParam, resetOn }: { sortParam?: string; resetOn?: unknown } = {},
): {
  listed: Listed | null
  sorting: Sorting<Column>
  error: string | null
  reload: () => Promise<void>
  pager: ReactNode
} {
  // The page, for the `resetOn` it was chosen with: any change of it starts at page 1.
  const [pageOf, setPageOf] = useState({ resetOn, page: 1 })
  const page = Object.is(pageOf.resetOn, resetOn) ? pageOf.page : 1
  const setPage = useCallback((next: number) => setPageOf({ resetOn, page: next }), [resetOn])
  const sorting = useUrlSort(columns, { param: sortParam, onChange: () => setPage(1) })
  const { sort } = sorting
  const [listed, setListed] = useState<Listed | null>(null)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)

  const reload = useCallback(() => {
    const request = ++latest.current
    return fetchPage(page, sort).then(
      (result) => {
        if (request !== latest.current) return
        setError(null)
        showOrStepBack(result, setListed, setPage)
      },
      (err: Error) => {
        if (request === latest.current) setError(err.message)
      },
    )
  }, [fetchPage, page, sort, setPage])

  useEffect(() => {
    reload()
  }, [reload])

  const pager = listed && (
    <Pager
      page={listed.page}
      pageSize={listed.page_size}
      total={listed.total}
      shown={listed.items.length}
      onPage={setPage}
    />
  )
  return { listed, sorting, error, reload, pager }
}
