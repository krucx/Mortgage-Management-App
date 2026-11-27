// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { PersonSummary } from '../src/api'
import { CustomerFormPage } from '../src/pages/CustomerFormPage'
import { typedFakeServer as fakeServer } from './typedFakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})


const customer = {
  id: 5,
  name: 'Suresh Kumar',
  address: '',
  phone_1: '9000000002',
  phone_2: null,
  photo_url: null,
  referrer: null,
  referred: [],
  shares_phone_with: [],
  email: null,
  aadhaar_last4: null,
  pan: null,
  aadhaar_photo_url: null,
  pan_photo_url: null,
  advance_held: 0,
}

const refused = (detail: string) => () => Response.json({ detail }, { status: 409 })
const allowed = () => new Response(null, { status: 204 })

/** The Customer form (new, or editing Suresh, Customer 5), with 9829012345 belonging to
 *  `owner` and the backend's save Preview answering `preview`. */
function customerForm(owner: PersonSummary | null, preview: () => Response, editing = false) {
  const server = fakeServer({
    'GET /api/people/by-phone': owner,
    'GET /api/search': [],
    'GET /api/customers/{customer_id}': {
      id: 5,
      name: 'Suresh Kumar',
      advance_held: 0,
      address: '',
      phone_1: '9000000002',
      phone_2: null,
      photo_url: null,
      referrer: null,
      referred: [],
      shares_phone_with: [],
      email: null,
      aadhaar_last4: null,
      pan: null,
      aadhaar_photo_url: null,
      pan_photo_url: null,
    },
    'POST /api/customers/preview': preview,
    'PUT /api/customers/{customer_id}/preview': preview,
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

test("an Existing person with nobody picked says so beside the Referrer, and can't be saved", async () => {
  const server = customerForm(null, allowed)
  await typeNumber()
  fireEvent.click(screen.getByLabelText('Existing person'))

  expect(
    screen.getByText('Pick the Referrer from the search results, or choose "None".'),
  ).toBeTruthy()
  expect(saveButton().disabled).toBe(true)
  fireEvent.submit(saveButton().closest('form')!)
  expect(screen.queryByRole('dialog')).toBeNull()

  fireEvent.click(screen.getByLabelText('None'))
  expect(screen.queryByText(/Pick the Referrer/)).toBeNull()
  await vi.waitFor(() => expect(saveButton().disabled).toBe(false), { timeout: 2000 })
  expect(server.requests).not.toContain('POST /api/customers')
})

test("a Contact number 1 that isn't a mobile number says so beside it, and can't be saved", async () => {
  customerForm(null, allowed)
  fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'Suresh Kumar' } })
  const phone = screen.getByLabelText('Contact number 1')
  fireEvent.change(phone, { target: { value: '98290' } })

  expect(screen.getByText('Enter a 10-digit mobile number')).toBeTruthy()
  expect(saveButton().disabled).toBe(true)

  fireEvent.change(phone, { target: { value: '9829012345' } })
  expect(screen.queryByText('Enter a 10-digit mobile number')).toBeNull()
  await vi.waitFor(() => expect(saveButton().disabled).toBe(false), { timeout: 2000 })
})

test('a photo failing after the Customer is saved can be retried, sending only the photo, unasked', async () => {
  let photoFails = true
  const server = fakeServer({
    'GET /api/people/by-phone': null,
    'GET /api/search': [],
    'POST /api/customers/preview': allowed,
    'POST /api/customers': customer,
    'PUT /api/customers/{customer_id}/photo': () => {
      if (!photoFails) return customer
      photoFails = false
      return Response.json({ detail: 'The photo is too large' }, { status: 413 })
    },
    'GET /api/customers/{customer_id}': customer,
  })
  showPage(server, '/customers/new', { '/customers/new': <CustomerFormPage /> })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:photo' }))
  await typeNumber()
  const picker = document.querySelector('input[type="file"]') as HTMLInputElement
  fireEvent.change(picker, {
    target: { files: [new File(['x'], 'me.jpg', { type: 'image/jpeg' })] },
  })

  await vi.waitFor(() => expect(saveButton().disabled).toBe(false), { timeout: 2000 })
  fireEvent.click(saveButton())
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm and save' }))
  expect(
    await screen.findByText('Customer saved, but a photo failed: The photo is too large'),
  ).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Retry photo upload' }))

  expect(await screen.findByText('Now at /customers/5')).toBeTruthy()
  expect(server.requests.filter((r) => r === 'POST /api/customers')).toHaveLength(1)
  expect(server.requests.filter((r) => r === 'PUT /api/customers/{customer_id}/photo')).toHaveLength(2)
})

test('the Referrer search has a name', async () => {
  customerForm(null, allowed)
  fireEvent.click(await screen.findByLabelText('Existing person'))

  expect(screen.getByRole('searchbox', { name: 'Search for the Referrer' })).toBeTruthy()
})
