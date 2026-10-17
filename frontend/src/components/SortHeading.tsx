import type { ReactNode } from 'react'
import type { Sorting } from './useUrlSort'

/** A column heading that sorts the list: once by it, again to reverse; an arrow shows
 *  the sorted column and its direction. */
export function SortHeading<Column extends string>({
  className,
  ...button
}: SortButtonProps<Column> & { className?: string }) {
  const sorted = button.sorting.sort?.column === button.column ? button.sorting.sort : null
  return (
    <th
      className={className}
      aria-sort={sorted ? (sorted.descending ? 'descending' : 'ascending') : undefined}
    >
      <SortButton {...button} />
    </th>
  )
}

type SortButtonProps<Column extends string> = {
  sorting: Sorting<Column>
  column: Column
  firstDescending?: boolean
  children: ReactNode
}

/** A heading's sort button on its own, for a sort that is not a table column. */
export function SortButton<Column extends string>({
  sorting: { sort, sortBy },
  column,
  firstDescending,
  children,
}: SortButtonProps<Column>) {
  const sorted = sort?.column === column ? sort : null
  return (
    <button
      type="button"
      className={sorted ? 'sort-heading sorted' : 'sort-heading'}
      onClick={() => sortBy({ column, firstDescending })}
    >
      {children}
      <span className="sort-arrow" aria-hidden="true">
        {sorted ? (sorted.descending ? '▼' : '▲') : '↕'}
      </span>
    </button>
  )
}
