import { describe, expect, it } from 'vitest'
import { nextSort, sortedBy, sortFromParam, sortToParam } from '../src/sort'

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

describe('sortedBy', () => {
  const rows = [
    { name: 'bina', owed: 300 },
    { name: 'Asha', owed: 100 },
    { name: 'chetan', owed: 200 },
  ]
  const valueOf = { name: (r: (typeof rows)[0]) => r.name, owed: (r: (typeof rows)[0]) => r.owed }

  it('sorts text ignoring case, and numbers by size, either way', () => {
    const names = (sorted: typeof rows) => sorted.map((r) => r.name)
    expect(names(sortedBy(rows, { column: 'name', descending: false }, valueOf))).toEqual([
      'Asha',
      'bina',
      'chetan',
    ])
    expect(names(sortedBy(rows, { column: 'owed', descending: true }, valueOf))).toEqual([
      'bina',
      'chetan',
      'Asha',
    ])
  })

  it('keeps the list’s own order with no sort', () => {
    expect(sortedBy(rows, null, valueOf)).toEqual(rows)
  })
})
