// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
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

const ramesh = customer(1, 'Ramesh Kumar')
/** The backend for a list of one Customer, `ramesh`, whose delete Preview answers `deletePreview`. */
function customersServer(deletePreview: () => Response) {
  return fakeServer({
    'GET /api/customers': { items: [ramesh], total: 1, page: 1, page_size: 20 },
    'GET /api/customers/1': { ...ramesh, referred: [], shares_phone_with: null },
    'POST /api/customers/1/delete-preview': deletePreview,
    'DELETE /api/customers/1': () => new Response(null, { status: 204 }),
  })
}

test("deleting a Customer the backend won't delete shows why, and asks nothing", async () => {
  const server = customersServer(() =>
    Response.json({ detail: 'A Customer with Mortgages cannot be deleted' }, { status: 409 }),
  )
  showPage(server, '/customers', { '/customers': <CustomersPage /> })

  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))

  expect(await screen.findByText('A Customer with Mortgages cannot be deleted')).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(server.requests).not.toContain('DELETE /api/customers/1')
})

test('deleting a Customer the backend would delete asks first, then deletes', async () => {
  const server = customersServer(() => new Response(null, { status: 204 }))
  showPage(server, '/customers', { '/customers': <CustomersPage /> })

  fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('This cannot be undone.')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

  await vi.waitFor(() => expect(server.requests).toContain('DELETE /api/customers/1'))
})

test('the Customers filter has a name', async () => {
  showPage(customersServer(() => new Response(null, { status: 204 })), '/customers', {
    '/customers': <CustomersPage />,
  })

  expect(await screen.findByRole('searchbox', { name: 'Filter Customers' })).toBeTruthy()
})
