// @vitest-environment jsdom
// Adding a Call Note from a Mortgage's Call Notes box.
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CallNotes } from '../src/components/CallNotes'
import { typedFakeServer as fakeServer } from './typedFakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function showCallNotes(routes: Record<string, unknown> = {}) {
  const server = fakeServer({
    'GET /api/mortgages/{mortgage_id}/call-notes': { items: [], total: 0, page: 1, page_size: 20 },
    ...routes,
  })
  showPage(server, '/mortgages/7', {
    '/mortgages/:id': <CallNotes mortgageId={7} mortgageName="2026GoldRing" />,
  })
  return server
}

const called = () => screen.getByRole('button', { name: 'Called' }) as HTMLButtonElement

test('a Call Note needs something written in it', async () => {
  showCallNotes()
  const note = await screen.findByLabelText('Call Note for 2026GoldRing')

  expect(called().disabled).toBe(true)
  fireEvent.change(note, { target: { value: '   ' } })
  expect(called().disabled).toBe(true)
  fireEvent.change(note, { target: { value: 'Will pay Friday' } })
  expect(called().disabled).toBe(false)
})

test('a Call Note the backend refuses shows its reason', async () => {
  showCallNotes({
    'POST /api/mortgages/{mortgage_id}/call-notes': () =>
      Response.json({ detail: '2026GoldRing: it is redeemed' }, { status: 422 }),
  })
  fireEvent.change(await screen.findByLabelText('Call Note for 2026GoldRing'), {
    target: { value: 'Collected the ring' },
  })

  fireEvent.click(called())
  fireEvent.click(
    within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save Call Note' }),
  )

  expect(await screen.findByText('2026GoldRing: it is redeemed')).toBeTruthy()
})

test('Call Notes come a page at a time, newest first', async () => {
  const note = (id: number) => ({
    id,
    called_on: '2026-04-20',
    note: `Note ${id}`,
    created_at: '2026-04-20T10:00:00',
  })
  const server = showCallNotes({
    'GET /api/mortgages/{mortgage_id}/call-notes': (request: Request) => {
      const page = Number(new URL(request.url).searchParams.get('page'))
      return {
        items: page === 1 ? [note(22), note(21)] : [note(2), note(1)],
        total: 22,
        page,
        page_size: 20,
      }
    },
  })

  expect(await screen.findByText('Note 22')).toBeTruthy()
  expect(screen.getByText('Showing 1–2 of 22')).toBeTruthy()

  fireEvent.click(screen.getByRole('button', { name: 'Next' }))

  expect(await screen.findByText('Note 1')).toBeTruthy()
  expect(screen.queryByText('Note 22')).toBeNull()
  expect(
    server.requests.filter((r) => r.endsWith('/call-notes') && r.startsWith('GET')),
  ).toHaveLength(2)
})
