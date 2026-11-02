import { expect, test } from 'vitest'
import { findAadhaarLast4, findPan } from '../src/idNumbers'

// Text as Tesseract reads a PAN card: headings, a name, a date, and the PAN, sometimes
// with a letter misread as a digit or the other way round.
const panCard = `INCOME TAX DEPARTMENT GOVT. OF INDIA
Permanent Account Number Card
ABCPS1234K
MEERA SHARMA
Date of Birth
12/05/1985`

test.each([
  [panCard, 'ABCPS1234K'],
  ['Permanent Account Number\nabcps1234k', 'ABCPS1234K'],
  ['Permanent Account Number Card\nABCP5I234K', 'ABCPS1234K'], // S read as 5, 1 as I
  ['PAN: ABCPS 1234K', 'ABCPS1234K'],
])('the PAN is found in the text of a PAN card', (text, pan) => {
  expect(findPan(text)).toBe(pan)
})

test.each([
  ['the headings and a date', 'INCOME TAX DEPARTMENT\nGOVT OF INDIA\n12/05/1985'],
  ['a name run together', 'MEERASHARM A1234 SINGH\nSHARMA SINGHB 1234'],
])('no PAN in %s', (_, text) => {
  expect(findPan(text)).toBeNull()
})

const aadhaarCard = `Government of India
Meera Sharma
DOB: 12/05/1985
FEMALE
XXXX XXXX 4821
VID : 9123 4567 8901 2345`

test.each([
  [aadhaarCard, '4821'],
  ['Meera Sharma\nxxxx xxxx 4821', '4821'],
  ['Meera Sharma\n1234 5678 4821\nMera Aadhaar, Meri Pehchaan', '4821'],
  ['1234 5678 4821', '4821'],
])('the last 4 digits of the Aadhaar Number are found', (text, last4) => {
  expect(findAadhaarLast4(text)).toBe(last4)
})

test.each([
  ['a VID alone', 'VID : 9123 4567 8901 2345'],
  ['a VID wrapped onto its own line', 'Meera Sharma\nVID :\n9123 4567 8901 2345'],
  ['a phone number and a date', 'Mobile 9810012345\nDOB 12/05/1985'],
  ['nothing at all', ''],
])('no Aadhaar Number in %s', (_, text) => {
  expect(findAadhaarLast4(text)).toBeNull()
})
