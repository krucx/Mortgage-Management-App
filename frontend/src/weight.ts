// Weights are held as integer milligrams; the Lender types grams.

/** Gross and net weight as typed, in grams. */
export interface Weights {
  gross: string
  net: string
}

/** What the Lender types in grams (e.g. "25.4") → milligrams; blank or invalid text is 0. */
export const gramsToMg = (grams: string) => Math.round(Number(grams) * 1000) || 0

/** Milligrams → grams as a form field holds them, e.g. 25400 → "25.4". */
export const mgToGrams = (mg: number) => String(mg / 1000)
