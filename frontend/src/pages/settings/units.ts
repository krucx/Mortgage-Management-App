import { formatINR, paiseToRupees, rupeesToPaise } from '../../money'

/** How a setting's number is typed and shown: a rupee amount kept in paise, or days. */
export type Unit = {
  toDraft: (value: number | null) => string
  fromDraft: (draft: string) => number | null
  show: (value: number) => string
  /** The least that can be typed. */
  min: string
}

export const RUPEES: Unit = {
  toDraft: paiseToRupees,
  fromDraft: (draft) => (draft === '' ? null : rupeesToPaise(draft)),
  show: formatINR,
  min: '1',
}

export const DAYS: Unit = {
  toDraft: (days) => (days === null ? '' : String(days)),
  fromDraft: (draft) => (draft === '' ? null : Number(draft)),
  show: (days) => (days === 1 ? '1 day' : `${days} days`),
  min: '0',
}
