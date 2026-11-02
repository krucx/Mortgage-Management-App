// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { CallListPage as Listed } from '../src/api'
import { CallListPage } from '../src/pages/CallListPage'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const listed: Listed = {
  items: [
    {
      customer: { kind: 'customer', id: 2, name: 'Arjun Patel' },
      phone_1: '9820023456',
      phone_2: null,
      rows: [
        { mortgage_id: 4, mortgage_name: '2026-Arjun-GoldChain', reasons: ['accrues_today'], months_unpaid: 2, loan_to_value: 0.35, outstanding: 4_680_000, called: null },
        { mortgage_id: 3, mortgage_name: '2025-Arjun-GoldRingRuby', reasons: ['months_unpaid', 'loan_to_value'], months_unpaid: 15, loan_to_value: 1.045, outstanding: 8_483_100, called: { id: 1, called_on: '2026-10-19', note: 'Will pay after Diwali', created_at: '2026-10-19T10:00:00' } },
      ],
    },
    {
      customer: { kind: 'customer', id: 6, name: 'Sunita Rao' },
      phone_1: '9860067890',
      phone_2: '9810099999',
      rows: [
        { mortgage_id: 8, mortgage_name: '2026-Sunita-Mangalsutra', reasons: ['months_unpaid'], months_unpaid: 3, loan_to_value: 0.37, outstanding: 3_500_000, called: null },
      ],
    },
  ],
  mortgages: 3,
  total: 2,
  page: 1,
  page_size: 20,
}

const show = () =>
  showPage(fakeServer({ 'GET /api/call-list': listed }), '/call-list', { '/call-list': <CallListPage /> })

/** The cell holding a Customer, beside each of their Mortgages' rows. */
const customerCell = (name: string) =>
  screen.getByRole('link', { name }).closest('td') as HTMLTableCellElement

test('each Customer appears once, beside all their Mortgages, with their count, total and ways to reach them', async () => {
  show()
  await screen.findByRole('link', { name: 'Arjun Patel' })

  const arjun = customerCell('Arjun Patel')
  expect(arjun.rowSpan).toBe(2)
  expect(within(arjun).getByRole('link', { name: '2 Mortgages' }).getAttribute('href')).toBe('/mortgages?customer=2')
  expect(within(arjun).getByText('₹1,31,631')).toBeTruthy()
  expect(within(arjun).getByRole('link', { name: 'Call 9820023456' }).getAttribute('href')).toBe('tel:+919820023456')
  expect(within(arjun).getByRole('button', { name: 'WhatsApp 9820023456' })).toBeTruthy()
  expect(within(customerCell('Sunita Rao')).getByRole('link', { name: 'Call 9810099999' })).toBeTruthy()

  // Every Mortgage is its own row, always shown.
  for (const name of ['2026-Arjun-GoldChain', '2025-Arjun-GoldRingRuby', '2026-Sunita-Mangalsutra']) {
    expect(screen.getByRole('link', { name }).closest('tr')).toBeTruthy()
  }
  expect(screen.getAllByRole('row')).toHaveLength(1 + 3)
})

test('reasons show as status circles with short labels, and their full wording', async () => {
  show()
  await screen.findByRole('link', { name: 'Arjun Patel' })

  const ring = screen.getByRole('link', { name: '2025-Arjun-GoldRingRuby' }).closest('tr')!
  expect(within(ring).getByText('15 mo')).toBeTruthy()
  expect(within(ring).getByText('104.5%')).toBeTruthy()
  expect(within(ring).getByLabelText('15 months unpaid')).toBeTruthy()
  expect(within(ring).getByLabelText('Loan-to-Value 104.5%')).toBeTruthy()

  const chain = screen.getByRole('link', { name: '2026-Arjun-GoldChain' }).closest('tr')!
  expect(within(chain).getByLabelText('Accrues today')).toBeTruthy()
})

test("a Mortgage is marked called on its own row; one called today says so with the note", async () => {
  show()
  await screen.findByRole('link', { name: 'Arjun Patel' })

  const ring = screen.getByRole('link', { name: '2025-Arjun-GoldRingRuby' }).closest('tr')!
  expect(within(ring).getByText('Called')).toBeTruthy()
  expect(within(ring).getByText('Will pay after Diwali')).toBeTruthy()

  const chain = screen.getByRole('link', { name: '2026-Arjun-GoldChain' }).closest('tr')!
  fireEvent.click(within(chain).getByRole('button', { name: 'Mark called…' }))
  expect(screen.getByLabelText('Call Note for 2026-Arjun-GoldChain')).toBeTruthy()
  // The Customer's cell still spans all their rows, the note's included.
  expect(customerCell('Arjun Patel').rowSpan).toBe(3)
})

// --- The Call List as a sheet for staff: exported, then imported with their Call Notes.

test('the Call List can be exported to Excel and to PDF', async () => {
  show()
  await screen.findByRole('link', { name: 'Arjun Patel' })

  const excel = screen.getByRole('link', { name: 'Export to Excel' })
  expect(excel.getAttribute('href')).toBe('/api/call-list/export.xlsx')
  expect(excel.hasAttribute('download')).toBe(true)
  expect(screen.getByRole('link', { name: 'Export to PDF' }).getAttribute('href')).toBe(
    '/api/call-list/export.pdf',
  )
})

const imported = {
  adding: [
    {
      mortgage_id: 4,
      mortgage_name: '2026-Arjun-GoldChain',
      customer_name: 'Arjun Patel',
      called_on: '2026-10-19',
      note: 'Paying Monday',
    },
  ],
  skipped_empty: 2,
  skipped_duplicates: 1,
}

function chooseSheet() {
  const sheet = new File(['xlsx'], 'call-list.xlsx')
  fireEvent.change(screen.getByLabelText('Import Call Notes from Excel'), {
    target: { files: [sheet] },
  })
}

test('an imported sheet shows a Preview of the Call Notes it adds, and adds them once confirmed', async () => {
  const uploaded: string[] = []
  const server = fakeServer({
    'GET /api/call-list': listed,
    'POST /api/call-list/import-preview': async (request: Request) => {
      uploaded.push(request.headers.get('content-type')?.split(';')[0] ?? '')
      return imported
    },
    'POST /api/call-list/import': imported,
  })
  showPage(server, '/call-list', { '/call-list': <CallListPage /> })
  await screen.findByRole('link', { name: 'Arjun Patel' })

  chooseSheet()
  const preview = await screen.findByRole('dialog', { name: 'Add 1 Call Note?' })
  expect(within(preview).getByText('2026-Arjun-GoldChain · Arjun Patel')).toBeTruthy()
  expect(within(preview).getByText('19 Oct 2026: Paying Monday')).toBeTruthy()
  expect(within(preview).getByText(/Left out: 2 rows without a Call Note, 1 already there\./)).toBeTruthy()
  expect(server.requests).not.toContain('POST /api/call-list/import')
  fireEvent.click(within(preview).getByRole('button', { name: 'Add 1 Call Note' }))

  expect(await screen.findByText('Added 1 Call Note.')).toBeTruthy()
  expect(server.requests).toContain('POST /api/call-list/import')
  expect(uploaded).toEqual(['multipart/form-data'])
})

test("a sheet the backend refuses imports nothing, and its reasons are shown", async () => {
  const server = fakeServer({
    'GET /api/call-list': listed,
    'POST /api/call-list/import-preview': Response.json(
      { detail: 'Nothing imported. 2026-Ramesh-Gone: no such Mortgage' },
      { status: 422 },
    ),
  })
  showPage(server, '/call-list', { '/call-list': <CallListPage /> })
  await screen.findByRole('link', { name: 'Arjun Patel' })

  chooseSheet()

  expect(await screen.findByText('Nothing imported. 2026-Ramesh-Gone: no such Mortgage')).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(server.requests).not.toContain('POST /api/call-list/import')
})
