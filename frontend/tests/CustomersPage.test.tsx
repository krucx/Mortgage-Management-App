// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { CustomerPage, CustomerRow } from '../src/api'
import { CustomersPage } from '../src/pages/CustomersPage'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const customer = (id: number, name: string): CustomerRow => ({
  id,
  name,
  address: '1 Test Lane',
  phone_1: `90000000${String(id).padStart(2, '0')}`,
  phone_2: null,
  photo_url: null,
  referrer: null,
})

/** 45 Customers, 20 to a page; the backend sorts them as asked. */
function customersPage(request: Request): CustomerPage {
  const query = new URL(request.url).searchParams
  const page = Number(query.get('page'))
  const sorted = query.get('sort') === 'name' && query.get('descending') !== 'true'
  const names = sorted ? ['Aarti', 'Bhavna'] : ['Zoya', 'Yash']
  return {
    items: names.map((name, i) => customer(page * 10 + i, `${name} (page ${page})`)),
    total: 45,
    page,
    page_size: 20,
  }
}

test('the Customers list is sorted on the server, and keeps its sort from page to page', async () => {
  const server = fakeServer({ 'GET /api/customers': customersPage, 'GET /api/search': [] })
  showPage(server, '/customers', { '/customers': <CustomersPage /> })

  expect(await screen.findByText('Zoya (page 1)')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: /^Name/ }))
  expect(await screen.findByText('Aarti (page 1)')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(await screen.findByText('Aarti (page 2)')).toBeTruthy()
  expect(screen.getByText('Page 2 of 3')).toBeTruthy()
})
