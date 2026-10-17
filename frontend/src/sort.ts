// Sorting a list by one of its columns, kept in the page's URL like its filters.

/** The column a list is sorted by, and which way. */
export interface Sort<Column extends string = string> {
  column: Column
  descending: boolean
}

/** A sortable column: text sorts A→Z first; amounts and dates may start largest first. */
export interface SortableColumn<Column extends string = string> {
  column: Column
  firstDescending?: boolean
}

/** The sort after clicking `clicked`'s heading: by it, or reversed if already by it. */
export function nextSort<Column extends string>(
  current: Sort<Column> | null,
  clicked: SortableColumn<Column>,
): Sort<Column> {
  if (current?.column === clicked.column)
    return { column: clicked.column, descending: !current.descending }
  return { column: clicked.column, descending: clicked.firstDescending ?? false }
}

/** "-amount" for by amount, descending; "name" for by name. */
export function sortToParam(sort: Sort): string {
  return (sort.descending ? '-' : '') + sort.column
}

/** The sort in a URL parameter, or null (the list's own order) if it isn't one of `columns`. */
export function sortFromParam<Column extends string>(
  param: string | null,
  columns: readonly Column[],
): Sort<Column> | null {
  if (!param) return null
  const descending = param.startsWith('-')
  const column = columns.find((c) => c === (descending ? param.slice(1) : param))
  return column ? { column, descending } : null
}

/**
 * `rows` sorted in the browser, for lists sorted a page at a time: text ignoring case,
 * numbers by size, ties in the list's own order. With no sort, the list's own order.
 */
export function sortedBy<Row, Column extends string>(
  rows: Row[],
  sort: Sort<Column> | null,
  valueOf: Record<Column, (row: Row) => string | number>,
): Row[] {
  if (!sort) return rows
  const value = valueOf[sort.column]
  const direction = sort.descending ? -1 : 1
  return [...rows].sort((a, b) => {
    const [x, y] = [value(a), value(b)]
    const order =
      typeof x === 'number' && typeof y === 'number'
        ? x - y
        : String(x).localeCompare(String(y), undefined, { sensitivity: 'base' })
    return order * direction
  })
}

/** The ticked rows first, so the ones being acted on are together (e.g. the Mortgages
 *  a Payment is split across, or those to Forfeit); each group keeps its order. */
export function tickedFirst<Row extends { id: number }>(rows: Row[], ticked: Set<number>): Row[] {
  return [...rows.filter((row) => ticked.has(row.id)), ...rows.filter((row) => !ticked.has(row.id))]
}
