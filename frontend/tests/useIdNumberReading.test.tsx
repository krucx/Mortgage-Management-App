// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { useIdNumberReading } from '../src/pages/customerForm/useIdNumberReading'

const readText = vi.hoisted(() => vi.fn())
vi.mock('../src/ocr', () => ({ readText }))

afterEach(() => {
  cleanup()
  readText.mockReset()
})

const PHOTO = new Blob(['card'])

test('a number read from the photo fills an empty field and asks to be checked', async () => {
  readText.mockResolvedValue('ABCDE1234F')
  const fill = vi.fn()
  const { result } = renderHook(() => useIdNumberReading(() => '', fill))

  await act(() => result.current.readNumber('pan', PHOTO))

  expect(fill).toHaveBeenCalledWith('pan', 'ABCDE1234F')
  expect(result.current.read.pan).toBe('read')
})

test('a number already typed is never overwritten', async () => {
  readText.mockResolvedValue('ABCDE1234F')
  const fill = vi.fn()
  const { result } = renderHook(() => useIdNumberReading(() => 'ZZZZZ9999Z', fill))

  await act(() => result.current.readNumber('pan', PHOTO))

  expect(fill).not.toHaveBeenCalled()
  expect(result.current.read.pan).toBeNull()
})

test('a reading dropped meanwhile fills nothing', async () => {
  let finish: (text: string) => void = () => {}
  readText.mockReturnValue(new Promise<string>((resolve) => (finish = resolve)))
  const fill = vi.fn()
  const { result } = renderHook(() => useIdNumberReading(() => '', fill))

  let reading: Promise<void> = Promise.resolve()
  act(() => {
    reading = result.current.readNumber('pan', PHOTO)
  })
  expect(result.current.read.pan).toBe('reading')
  act(() => result.current.dropReading('pan'))
  await act(async () => {
    finish('ABCDE1234F')
    await reading
  })

  expect(fill).not.toHaveBeenCalled()
  expect(result.current.read.pan).toBeNull()
})

test('an unreadable photo leaves the field alone', async () => {
  readText.mockRejectedValue(new Error('no reader'))
  const fill = vi.fn()
  const { result } = renderHook(() => useIdNumberReading(() => '', fill))

  await act(() => result.current.readNumber('aadhaar', PHOTO))

  expect(fill).not.toHaveBeenCalled()
  expect(result.current.read.aadhaar).toBeNull()
})
