// Finding the PAN and the Aadhaar Number (its last 4 digits) in the text read from an
// ID Photo. What is found is only a suggestion, for the Lender to check.

// Characters Tesseract often reads as their look-alikes, by what the place needs.
const AS_LETTER: Record<string, string> = { '0': 'O', '1': 'I', '2': 'Z', '5': 'S', '8': 'B' }
const AS_DIGIT: Record<string, string> = { O: '0', I: '1', L: '1', Z: '2', S: '5', B: '8' }

/** A 10-character word read as a PAN: 5 letters, 4 digits and a letter, look-alikes
 *  put right for their place; null if it can't be one. */
function asPan(word: string): string | null {
  if (word.length !== 10) return null
  const fixed = [...word.toUpperCase()]
    .map((c, i) => (i < 5 || i === 9 ? (AS_LETTER[c] ?? c) : (AS_DIGIT[c] ?? c)))
    .join('')
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(fixed) ? fixed : null
}

/** The PAN on a PAN card's text, or null: a word that is one, or two neighbouring words
 *  that are one together (a space read inside it). */
export function findPan(text: string): string | null {
  for (const line of text.split('\n')) {
    const words = line.split(/[^A-Za-z0-9]+/).filter(Boolean)
    const candidates = [...words, ...words.slice(1).map((word, i) => words[i] + word)]
    for (const candidate of candidates) {
      const pan = asPan(candidate)
      if (pan) return pan
    }
  }
  return null
}

/** The last 4 digits of the Aadhaar Number on an Aadhaar card's text, whole or masked
 *  (XXXX XXXX 1234), or null. Exactly 12 digits: a VID (16) or a phone number isn't one. */
export function findAadhaarLast4(text: string): string | null {
  for (const line of text.split('\n')) {
    if (/\bVID\b/i.test(line)) continue
    const masked = line.match(/(?<![\dX*] ?)[X*]{4} ?[X*]{4} ?(\d{4})(?! ?\d)/i)
    if (masked) return masked[1]
    const whole = line.match(/(?<!\d ?)\d{4} ?\d{4} ?(\d{4})(?! ?\d)/)
    if (whole) return whole[1]
  }
  return null
}
