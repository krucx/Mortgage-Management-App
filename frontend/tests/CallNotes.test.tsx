// @vitest-environment jsdom
// Adding a Call Note from a Mortgage's Call Notes box.
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { CallNotes } from '../src/components/CallNotes'
import { fakeServer } from './fakeServer'
import { showPage } from './showPage'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function showCallNotes(routes: Record<string, unknown> = {}) {
  const server = fakeServer({ 'GET /api/mortgages/7/call-notes': [], ...routes })
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
    'POST /api/mortgages/7/call-notes': () =>
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
