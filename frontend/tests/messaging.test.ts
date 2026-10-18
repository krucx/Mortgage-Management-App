// @vitest-environment jsdom
import { afterEach, expect, test, vi } from 'vitest'
import { sender } from '../src/messaging'

afterEach(() => vi.restoreAllMocks())

/** What `send` or `chat` opened. */
function opened(act: () => void): URL {
  const open = vi.spyOn(window, 'open').mockReturnValue(null)
  act()
  return new URL(open.mock.calls[0][0] as string)
}

test('a message opens in WhatsApp with every emoji intact, not through the wa.me redirect', () => {
  // wa.me redirects to api.whatsapp.com and turns emoji such as 🙏 and ✅ into "�" on the way.
  const text = 'Interest notice 🔔\nNamaste Sunita Rao,\nTotal owed: *₹35,700* ✅\nPlease get in touch 🙏'
  const url = opened(() => sender.send('9860067890', text))

  expect(url.hostname).toBe('api.whatsapp.com')
  expect(url.searchParams.get('phone')).toBe('919860067890')
  expect(url.searchParams.get('text')).toBe(text)
})

test('a chat opens with the number and no message', () => {
  const url = opened(() => sender.chat('9820023456'))

  expect(url.hostname).toBe('api.whatsapp.com')
  expect(url.searchParams.get('phone')).toBe('919820023456')
  expect(url.searchParams.has('text')).toBe(false)
})
