// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CustomerFormPage } from '../src/pages/CustomerFormPage'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const refused = (detail: string) => () => Response.json({ detail }, { status: 409 })
const allowed = () => new Response(null, { status: 204 })

/** The Customer form (new, or editing Suresh, Customer 5), with 9829012345 belonging to
 *  `owner` and the backend's save Preview answering `preview`. */
function customerForm(owner: unknown, preview: () => Response, editing = false) {
  const server = fakeServer({
    'GET /api/people/by-phone': owner,
    'GET /api/search': [],
    'GET /api/customers/5': {
      id: 5,
      name: 'Suresh Kumar',
      address: '',
      phone_1: '9000000002',
      phone_2: null,
      photo_url: null,
      referrer: null,
      referred: [],
      shares_phone_with: null,
    },
    'POST /api/customers/preview': preview,
    'PUT /api/customers/5/preview': preview,
  })
  const at = editing ? '/customers/5/edit' : '/customers/new'
  showPage(server, at, {
    '/customers/new': <CustomerFormPage />,
    '/customers/:id/edit': <CustomerFormPage />,
  })
  return server
}

async function typeNumber() {
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Suresh Kumar' } })
  fireEvent.change(screen.getByLabelText('Contact number 1'), { target: { value: '9829012345' } })
}

const saveButton = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement

test("another Customer's Primary Number can't be saved, and nothing is asked", async () => {
  const server = customerForm(
    { kind: 'customer', id: 9, name: 'Ramesh Kumar' },
    refused('Contact number 1 9829012345 already belongs to Customer Ramesh Kumar'),
  )
  await typeNumber()

  expect(
    await screen.findByText(
      'Contact number 1 9829012345 already belongs to Customer Ramesh Kumar',
      {},
      { timeout: 2000 },
    ),
  ).toBeTruthy()
  expect(saveButton().disabled).toBe(true)
  fireEvent.submit(saveButton().closest('form')!)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(server.requests).not.toContain('POST /api/customers')
})

test("a new Customer on a Referrer's number can be saved: they become this Customer", async () => {
  customerForm({ kind: 'referrer', id: 2, name: 'Mohan Lal' }, allowed)
  await typeNumber()

  expect(await screen.findByText(/Saving makes them this Customer/)).toBeTruthy()
  await vi.waitFor(() => expect(saveButton().disabled).toBe(false), { timeout: 2000 })
  fireEvent.click(saveButton())
  expect(await screen.findByRole('dialog')).toBeTruthy()
})

test("an existing Customer can't be moved onto a Referrer's number, and nothing is asked", async () => {
  customerForm(
    { kind: 'referrer', id: 2, name: 'Mohan Lal' },
    refused('Contact number 1 9829012345 already belongs to Referrer Mohan Lal'),
    true,
  )
  await typeNumber()

  expect(
    await screen.findByText(
      'Contact number 1 9829012345 already belongs to Referrer Mohan Lal',
      {},
      { timeout: 2000 },
    ),
  ).toBeTruthy()
  expect(screen.queryByText(/Saving makes them this Customer/)).toBeNull()
  expect(saveButton().disabled).toBe(true)
})

test('the Referrer search has a name', async () => {
  customerForm(null, allowed)
  fireEvent.click(await screen.findByLabelText('Existing person'))

  expect(screen.getByRole('searchbox', { name: 'Search for the Referrer' })).toBeTruthy()
})
