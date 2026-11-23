import type { Customer, IdCard } from '../../api'
import { customerChanges } from '../../requests'
import type { ApiClient } from '../../serverState'
import type { PhotoUpload } from '../../components/useSaveWithPhotos'
import { findAadhaarLast4, findPan } from '../../idNumbers'

/** An ID Photo as the form will leave it: kept, replaced by a new one, or removed. */
export type IdPhotoChange = { kind: 'keep' } | { kind: 'new'; photo: Blob } | { kind: 'remove' }

export const ID_CARDS: { card: IdCard; label: string; urlOf: (c: Customer) => string | null }[] = [
  {
    card: 'aadhaar',
    label: 'Aadhaar card photo (the masked front)',
    urlOf: (c) => c.aadhaar_photo_url,
  },
  { card: 'pan', label: 'PAN card photo', urlOf: (c) => c.pan_photo_url },
]

/** The field each card's number goes in, and how it is found in the card's text. */
export const READ_FROM: Record<
  IdCard,
  { field: 'aadhaar_last4' | 'pan'; find: (text: string) => string | null }
> = {
  aadhaar: { field: 'aadhaar_last4', find: findAadhaarLast4 },
  pan: { field: 'pan', find: findPan },
}

const CARD_NAMES: Record<IdCard, string> = { aadhaar: 'Aadhaar', pan: 'PAN' }

export const NO_ID_PHOTO_CHANGES: Record<IdCard, IdPhotoChange> = {
  aadhaar: { kind: 'keep' },
  pan: { kind: 'keep' },
}

/** The last 4 digits of an Aadhaar Number as typed (whole, masked or the 4 alone). */
export const typedLast4 = (typed: string) => typed.replace(/\D/g, '').slice(-4)

/** What is sent for an Aadhaar Number as typed: only its last 4 digits when it is whole
 *  or masked, so the full number never leaves the form; anything else as typed, for the
 *  backend to refuse. */
export function sentAadhaar(typed: string): string | null {
  const digits = typed.replace(/\D/g, '')
  if (!typed.trim()) return null
  return digits.length === 4 || digits.length === 12 ? digits.slice(-4) : typed
}

/** The ID Photo changes in words, for the confirmation: "Aadhaar new", "PAN removed". */
export function idPhotoChangeNotes(changes: Record<IdCard, IdPhotoChange>): string[] {
  return ID_CARDS.flatMap(({ card }) => {
    const change = changes[card]
    return change.kind === 'keep'
      ? []
      : [`${CARD_NAMES[card]} ${change.kind === 'new' ? 'new' : 'removed'}`]
  })
}

/** The uploads and removals the ID Photo changes need once the Customer is saved. */
export function idPhotoUploads(changes: Record<IdCard, IdPhotoChange>): PhotoUpload[] {
  return ID_CARDS.flatMap(({ card }): PhotoUpload[] => {
    const change = changes[card]
    if (change.kind === 'new')
      return [
        {
          key: change.photo,
          send: (c: ApiClient, id: number) =>
            customerChanges.replaceIdPhoto(c, id, card, change.photo),
        },
      ]
    if (change.kind === 'remove')
      return [
        {
          key: `${card} removed`,
          send: (c: ApiClient, id: number) => customerChanges.removeIdPhoto(c, id, card),
        },
      ]
    return []
  })
}
