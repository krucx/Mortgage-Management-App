import { useMemo } from 'react'
import { nextSort, sortFromParam, sortToParam, type Sort, type SortableColumn } from '../sort'
import { useUrlFilters } from './useUrlFilters'

/** A list's sort and how to change it, as `useUrlSort` gives them. */
export interface Sorting<Column extends string> {
  sort: Sort<Column> | null
  sortBy: (clicked: SortableColumn<Column>) => void
}

/**
 * The sort of a list, kept in the page's URL (as `param`, e.g. "-amount") like its
 * filters, so a sorted list can be shared or bookmarked and survives a reload.
 * `onChange` runs on every change, e.g. to go back to page 1. `columns` should be a
 * constant, so the sort stays the same object until it changes.
 */
export function useUrlSort<Column extends string>(
  columns: readonly Column[],
  { param = 'sort', onChange }: { param?: string; onChange?: () => void } = {},
): Sorting<Column> {
  const [params, setFilters] = useUrlFilters()
  const raw = params.get(param)
  const sort = useMemo(() => sortFromParam(raw, columns), [raw, columns])
  return {
    sort,
    sortBy(clicked) {
      setFilters({ [param]: sortToParam(nextSort(sort, clicked)) })
      onChange?.()
    },
  }
}
