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
        {
          mortgage_id: 4,
          mortgage_name: '2026-Arjun-GoldChain',
          reasons: ['accrues_today'],
          months_unpaid: 2,
          loan_to_value: 0.35,
          outstanding: 4_680_000,
          called: null,
        },
        {
          mortgage_id: 3,
          mortgage_name: '2025-Arjun-GoldRingRuby',
          reasons: ['months_unpaid', 'loan_to_value'],
          months_unpaid: 15,
          loan_to_value: 1.045,
          outstanding: 8_483_100,
          called: {
            id: 1,
            called_on: '2026-10-19',
            note: 'Will pay after Diwali',
            created_at: '2026-10-19T10:00:00',
          },
        },
      ],
    },
    {
      customer: { kind: 'customer', id: 6, name: 'Sunita Rao' },
      phone_1: '9860067890',
      phone_2: '9810099999',
      rows: [
        {
          mortgage_id: 8,
          mortgage_name: '2026-Sunita-Mangalsutra',
          reasons: ['months_unpaid'],
          months_unpaid: 3,
          loan_to_value: 0.37,
          outstanding: 3_500_000,
          called: null,
        },
      ],
    },
  ],
  mortgages: 3,
  total: 2,
  page: 1,
  page_size: 20,
}

const show = () =>
  showPage(fakeServer({ 'GET /api/call-list': listed }), '/call-list', {
    '/call-list': <CallListPage />,
  })

/** The cell holding a Customer, beside each of their Mortgages' rows. */
const customerCell = (name: string) =>
  screen.getByRole('link', { name }).closest('td') as HTMLTableCellElement

test('each Customer appears once, beside all their Mortgages, with their count, total and ways to reach them', async () => {
  show()
  await screen.findByRole('link', { name: 'Arjun Patel' })

  const arjun = customerCell('Arjun Patel')
  expect(arjun.rowSpan).toBe(2)
  expect(within(arjun).getByRole('link', { name: '2 Mortgages' }).getAttribute('href')).toBe(
    '/mortgages?customer=2',
  )
  expect(within(arjun).getByText('₹1,31,631')).toBeTruthy()
  expect(within(arjun).getByRole('link', { name: 'Call 9820023456' }).getAttribute('href')).toBe(
    'tel:+919820023456',
  )
  expect(within(arjun).getByRole('button', { name: 'WhatsApp 9820023456' })).toBeTruthy()
  expect(
    within(customerCell('Sunita Rao')).getByRole('link', { name: 'Call 9810099999' }),
  ).toBeTruthy()

  // Every Mortgage is its own row, always shown.
  for (const name of [
    '2026-Arjun-GoldChain',
    '2025-Arjun-GoldRingRuby',
    '2026-Sunita-Mangalsutra',
  ]) {
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

test('a Mortgage is marked called on its own row; one called today says so with the note', async () => {
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
  not_imported: [
    { row: 7, mortgage_name: '2026-Ravi-Gone', note: 'Moved away', reason: 'no such Mortgage' },
    { row: 9, mortgage_name: null, note: 'Called, busy', reason: 'no Mortgage Name' },
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

function showImporting(preview: unknown, saved: unknown = preview) {
  const server = fakeServer({
    'GET /api/call-list': listed,
    'POST /api/call-list/import-preview': async (request: Request) => {
      expect(request.headers.get('content-type')?.split(';')[0]).toBe('multipart/form-data')
      return preview
    },
    'POST /api/call-list/import': saved,
  })
  showPage(server, '/call-list', { '/call-list': <CallListPage /> })
  return server
}

/** Click the dimmed page around an open pop-up. */
const clickOutside = (dialog: HTMLElement) =>
  fireEvent.click(dialog, { clientX: 5000, clientY: 5000 })

test('an imported sheet shows what it adds and each row it leaves out, in a pop-up on the page', async () => {
  const server = showImporting(imported)
  await screen.findByRole('link', { name: 'Arjun Patel' })

  chooseSheet()
  const preview = await screen.findByRole('dialog', {
    name: 'Import Call Notes from call-list.xlsx',
  })
  expect(within(preview).getByText('Adding 1 Call Note')).toBeTruthy()
  expect(within(preview).getByText('2026-Arjun-GoldChain · Arjun Patel')).toBeTruthy()
  expect(within(preview).getByText('19 Oct 2026: Paying Monday')).toBeTruthy()
  expect(within(preview).getByText('Not imported: 2 rows')).toBeTruthy()
  const ravi = within(preview).getByText('Row 7').closest('tr')!
  expect(within(ravi).getByText('2026-Ravi-Gone')).toBeTruthy()
  expect(within(ravi).getByText('no such Mortgage')).toBeTruthy()
  expect(
    within(within(preview).getByText('Row 9').closest('tr')!).getByText('“Called, busy”'),
  ).toBeTruthy()
  expect(
    within(preview).getByText('Left out quietly: 2 rows without a Call Note · 1 already there'),
  ).toBeTruthy()

  clickOutside(preview)
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(server.requests).not.toContain('POST /api/call-list/import')
})

test('adding saves the rows it can, and the rows left out can be shown again in a pop-up', async () => {
  const server = showImporting(imported)
  await screen.findByRole('link', { name: 'Arjun Patel' })

  chooseSheet()
  const preview = await screen.findByRole('dialog', {
    name: 'Import Call Notes from call-list.xlsx',
  })
  fireEvent.click(within(preview).getByRole('button', { name: 'Add 1 Call Note' }))

  expect(await screen.findByText(/Added 1 Call Note\. 2 rows not imported/)).toBeTruthy()
  expect(server.requests).toContain('POST /api/call-list/import')
  fireEvent.click(screen.getByRole('button', { name: 'Show them' }))
  const list = await screen.findByRole('dialog', { name: 'Not imported: 2 rows' })
  expect(within(list).getByText('Row 7')).toBeTruthy()
  fireEvent.click(within(list).getByRole('button', { name: 'Close' }))
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

test('a sheet with nothing to add says so, lists why, and offers no Add', async () => {
  showImporting({ ...imported, adding: [] })
  await screen.findByRole('link', { name: 'Arjun Patel' })

  chooseSheet()
  const preview = await screen.findByRole('dialog', {
    name: 'Import Call Notes from call-list.xlsx',
  })
  expect(within(preview).getByText('Nothing to add')).toBeTruthy()
  expect(within(preview).getByText('Row 7')).toBeTruthy()
  expect(within(preview).queryByRole('button', { name: /^Add/ })).toBeNull()
})

test("a file that isn't a Call Sheet is refused, and the reason shown", async () => {
  const server = fakeServer({
    'GET /api/call-list': listed,
    'POST /api/call-list/import-preview': Response.json(
      { detail: 'This file is not an Excel sheet (.xlsx)' },
      { status: 422 },
    ),
  })
  showPage(server, '/call-list', { '/call-list': <CallListPage /> })
  await screen.findByRole('link', { name: 'Arjun Patel' })

  chooseSheet()

  expect(await screen.findByText('This file is not an Excel sheet (.xlsx)')).toBeTruthy()
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(server.requests).not.toContain('POST /api/call-list/import')
})
