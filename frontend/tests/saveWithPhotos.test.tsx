// @vitest-environment jsdom
// Saving a record, then uploading its photos: what a retry sends again, and what it says.
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, test, vi } from 'vitest'
import { ServerStateProvider } from '../src/components/ServerStateProvider'
import { useSaveWithPhotos, type PhotoUpload } from '../src/components/useSaveWithPhotos'
import { createServerState } from '../src/serverState'
import { fakeServer } from './fakeServer'

afterEach(cleanup)

const record = { id: 7 }

function saving(id?: number) {
  const state = createServerState({ fetch: fakeServer({}).fetch, retry: false })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <ServerStateProvider state={state}>{children}</ServerStateProvider>
  )
  return renderHook(() => useSaveWithPhotos<typeof record>({ noun: 'Mortgage', stale: [], id }), {
    wrapper,
  })
}

/** An upload that fails the first `failures` times it is sent, recording each send. */
function upload(name: string, sent: string[], failures = 0): PhotoUpload {
  let left = failures
  return {
    key: name,
    send: async (_, id) => {
      sent.push(`${name} for ${id}`)
      if (left-- > 0) throw new Error('Network error')
    },
  }
}

test('a retry uploads only the photos that failed, and does not save the record again', async () => {
  const save = vi.fn(async () => record)
  const sent: string[] = []
  const uploads = [upload('front', sent), upload('back', sent, 1), upload('clasp', sent)]
  const { result } = saving()

  await act(() => result.current.run(save, uploads))
  expect(sent).toEqual(['front for 7', 'back for 7'])
  sent.length = 0
  const saved = await act(() => result.current.run(save, uploads))

  expect(sent).toEqual(['back for 7', 'clasp for 7'])
  expect(save).toHaveBeenCalledTimes(1)
  expect(saved).toBe(7)
  expect(result.current.error).toBeNull()
})

test('a photo failing on the first save says the record was saved', async () => {
  const { result } = saving()

  const saved = await act(() =>
    result.current.run(async () => record, [upload('front', [], 1)]),
  )

  expect(saved).toBeUndefined()
  expect(result.current.error).toBe('Mortgage saved, but a photo failed: Network error')
  expect(result.current.savedId).toBe(7)
})

test('a refused save shows its reason, and is tried again on a retry', async () => {
  const save = vi
    .fn<() => Promise<typeof record>>()
    .mockRejectedValueOnce(new Error('Start date cannot be in the future'))
    .mockResolvedValue(record)
  const sent: string[] = []
  const { result } = saving()

  await act(() => result.current.run(save, [upload('front', sent)]))
  expect(result.current.error).toBe('Start date cannot be in the future')
  expect(sent).toEqual([])
  await act(() => result.current.run(save, [upload('front', sent)]))

  expect(save).toHaveBeenCalledTimes(2)
  expect(sent).toEqual(['front for 7'])
})

test("adding photos to a record that is already there names no save in the error", async () => {
  const { result } = saving(7)

  await act(() => result.current.run(null, [upload('front', [], 1)]))

  expect(result.current.error).toBe('Network error')
})
