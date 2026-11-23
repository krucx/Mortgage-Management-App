import { useEffect, useRef, useState } from 'react'
import type { IdCard } from '../../api'
import { readText } from '../../ocr'
import { READ_FROM, type IdNumberField, type Reading } from './idCards'

/** Reading each ID Photo's number into its field (OCR). `current` gives a field's value as it
 *  now stands, `fill` puts a number in its field. */
export function useIdNumberReading(
  current: (field: IdNumberField) => string,
  fill: (field: IdNumberField, value: string) => void,
) {
  // Each card's number: being read from its new ID Photo, or filled in from it (until
  // edited); and the photo each card's reading is for, so a superseded one is dropped.
  const [read, setRead] = useState<Record<IdCard, Reading>>({ aadhaar: null, pan: null })
  const readingFor = useRef<Record<IdCard, Blob | null>>({ aadhaar: null, pan: null })
  // The latest accessors, for a reading that finishes after more typing.
  const latest = useRef({ current, fill })
  useEffect(() => {
    latest.current = { current, fill }
  })

  /** Read the number on a new ID Photo into its field, only if the field is still empty
   *  when the reading is done: a suggestion, never over what was typed. */
  async function readNumber(card: IdCard, photo: Blob) {
    const { field, find } = READ_FROM[card]
    readingFor.current[card] = photo
    setRead((now) => ({ ...now, [card]: 'reading' }))
    let found: string | null = null
    try {
      found = find(await readText(photo))
    } catch {
      // Unreadable or the reader unavailable: the field stays as it was.
    }
    if (readingFor.current[card] !== photo) return // replaced or removed meanwhile
    readingFor.current[card] = null
    const value = found !== null && !latest.current.current(field).trim() ? found : null
    if (value !== null) latest.current.fill(field, value)
    setRead((now) => ({ ...now, [card]: value !== null ? 'read' : null }))
  }

  /** Typing in a card's number field: it is the Lender's own from then on. */
  const typedOver = (card: IdCard) => setRead((now) => ({ ...now, [card]: null }))

  /** The card's photo was removed: a reading under way is dropped. */
  function dropReading(card: IdCard) {
    readingFor.current[card] = null
    setRead((now) => ({ ...now, [card]: null }))
  }

  return { read, readNumber, typedOver, dropReading }
}
