import { describe, expect, it } from 'vitest'
import { nextSort, sortFromParam, sortToParam, tickedFirst } from '../src/sort'

describe('nextSort', () => {
  it('sorts by a new column in its first direction', () => {
    expect(nextSort(null, { column: 'name' })).toEqual({ column: 'name', descending: false })
    expect(nextSort(null, { column: 'amount', firstDescending: true })).toEqual({
      column: 'amount',
      descending: true,
    })
  })

  it('reverses the sorted column when clicked again', () => {
    const byName = { column: 'name', descending: false }
    expect(nextSort(byName, { column: 'name' })).toEqual({ column: 'name', descending: true })
    expect(nextSort({ column: 'name', descending: true }, { column: 'name' })).toEqual(byName)
  })

  it('starts afresh on another column', () => {
    expect(nextSort({ column: 'name', descending: true }, { column: 'address' })).toEqual({
      column: 'address',
      descending: false,
    })
  })
})

describe('the sort in the URL', () => {
  it('is the column, with a leading minus when descending', () => {
    expect(sortToParam({ column: 'amount', descending: true })).toBe('-amount')
    expect(sortToParam({ column: 'name', descending: false })).toBe('name')
    expect(sortFromParam('-amount', ['amount'])).toEqual({ column: 'amount', descending: true })
    expect(sortFromParam('name', ['name'])).toEqual({ column: 'name', descending: false })
  })

  it('is ignored when missing or not one of the list’s columns', () => {
    expect(sortFromParam(null, ['name'])).toBeNull()
    expect(sortFromParam('-phone', ['name'])).toBeNull()
  })
})

describe('tickedFirst', () => {
  it('moves the ticked Mortgages to the top, each group keeping its order', () => {
    const rows = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
    expect(tickedFirst(rows, new Set([4, 2])).map((m) => m.id)).toEqual([2, 4, 1, 3])
  })
})
