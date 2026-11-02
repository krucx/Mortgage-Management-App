// @vitest-environment jsdom
// A Customer's email, Aadhaar Number (last 4 digits), PAN and ID Photos.
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CustomerFormPage } from '../src/pages/CustomerFormPage'
import { CustomerPage } from '../src/pages/CustomerPage'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const suresh = {
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
  pan_photo_url: '/api/photos/customer-5-pan.jpg',
}

function form(sent: { route: string; body?: unknown }[]) {
  const record = (route: string) => async (request: Request) => {
    const json = request.headers.get('content-type')?.startsWith('application/json')
    sent.push({ route, body: json ? await request.json() : undefined })
    return suresh
  }
  const server = fakeServer({
    'GET /api/people/by-phone': { kind: 'customer', id: 5, name: 'Suresh Kumar' },
    'GET /api/search': [],
    'GET /api/customers/5': suresh,
    'PUT /api/customers/5/preview': () => new Response(null, { status: 204 }),
    'PUT /api/customers/5': record('PUT /api/customers/5'),
    'PUT /api/customers/5/id-photos/aadhaar': record('PUT aadhaar'),
    'DELETE /api/customers/5/id-photos/pan': record('DELETE pan'),
  })
  showPage(server, '/customers/5/edit', { '/customers/:id/edit': <CustomerFormPage /> })
  return server
}

test('the form takes an email, the Aadhaar Number, the PAN and ID Photos, and saves them', async () => {
  const sent: { route: string; body?: unknown }[] = []
  form(sent)

  fireEvent.change(await screen.findByLabelText('Email (optional)'), { target: { value: 'suresh@kumar.in' } })
  fireEvent.change(screen.getByLabelText('Aadhaar Number: last 4 digits (optional)'), {
    target: { value: '9012' },
  })
  fireEvent.change(screen.getByLabelText('PAN (optional)'), { target: { value: 'abcde1234f' } })
  const aadhaar = screen.getByRole('group', { name: 'Aadhaar card photo (the masked front)' })
  fireEvent.change(within(aadhaar).getByLabelText('Upload photo'), {
    target: { files: [new File(['jpg'], 'aadhaar.jpg', { type: 'image/jpeg' })] },
  })
  const pan = screen.getByRole('group', { name: 'PAN card photo' })
  fireEvent.click(within(pan).getByRole('button', { name: 'Remove' }))

  const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
  await vi.waitFor(() => expect(save.disabled).toBe(false), { timeout: 2000 })
  fireEvent.click(save)
  const dialog = await screen.findByRole('dialog')
  expect(within(dialog).getByText('XXXX XXXX 9012')).toBeTruthy()
  expect(within(dialog).getByText('Aadhaar new · PAN removed')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and save' }))

  expect(await screen.findByText('Now at /customers/5')).toBeTruthy()
  expect(sent.map((s) => s.route)).toEqual(['PUT /api/customers/5', 'PUT aadhaar', 'DELETE pan'])
  expect(sent[0].body).toMatchObject({ email: 'suresh@kumar.in', aadhaar_last4: '9012', pan: 'ABCDE1234F' })
})

test("the Customer page shows them, the Aadhaar Number masked, and the ID Photos to open", async () => {
  showPage(
    fakeServer({
      'GET /api/customers/5': {
        ...suresh,
        email: 'suresh@kumar.in',
        aadhaar_last4: '9012',
        pan: 'ABCDE1234F',
        aadhaar_photo_url: '/api/photos/customer-5-aadhaar.jpg',
      },
      'GET /api/mortgages': { items: [], total: 0, page: 1, page_size: 20 },
      'GET /api/customers/5/history': [],
    }),
    '/customers/5',
    { '/customers/:id': <CustomerPage /> },
  )

  expect(await screen.findByText('suresh@kumar.in')).toBeTruthy()
  expect(screen.getByText('XXXX XXXX 9012')).toBeTruthy()
  expect(screen.getByText('ABCDE1234F')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Aadhaar card' }).getAttribute('href')).toBe(
    '/api/photos/customer-5-aadhaar.jpg',
  )
  expect(screen.getByRole('img', { name: 'PAN card' })).toBeTruthy()
})
