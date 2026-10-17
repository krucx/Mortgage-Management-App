/**
 * Mirrors the backend rule: reduce an Indian mobile number to its 10 digits,
 * or null if it isn't one.
 */
export function normalisePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return digits.length === 10 ? digits : null
}
