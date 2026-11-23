import { expect, test } from 'vitest'
import {
  idPhotoChangeNotes,
  idPhotoUploads,
  NO_ID_PHOTO_CHANGES,
  sentAadhaar,
  typedLast4,
} from '../src/pages/customerForm/idCards'

test('only the last 4 digits of a whole or masked Aadhaar Number are sent', () => {
  expect(sentAadhaar('')).toBeNull()
  expect(sentAadhaar('1234')).toBe('1234')
  expect(sentAadhaar('1234 5678 9012')).toBe('9012')
  expect(sentAadhaar('XXXX XXXX 9012')).toBe('9012')
  expect(sentAadhaar('12345')).toBe('12345') // left for the backend to refuse
})

test('the last 4 digits as typed', () => {
  expect(typedLast4('XXXX-XXXX-3456')).toBe('3456')
})

test('ID Photo changes are described and uploaded, kept ones are not', () => {
  const photo = new Blob(['x'])
  const changes = { aadhaar: { kind: 'new' as const, photo }, pan: { kind: 'remove' as const } }
  expect(idPhotoChangeNotes(changes)).toEqual(['Aadhaar new', 'PAN removed'])
  expect(idPhotoUploads(changes)).toHaveLength(2)
  expect(idPhotoChangeNotes(NO_ID_PHOTO_CHANGES)).toEqual([])
  expect(idPhotoUploads(NO_ID_PHOTO_CHANGES)).toEqual([])
})
