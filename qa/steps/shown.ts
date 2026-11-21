// Figures and dates as the screens spell them, for steps that check a screen against the API.

const dates = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const rupees = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const rupeesAndPaise = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "2025-09-05" → "5 Sept 2025". */
export const shownDay = (iso: string) => dates.format(new Date(`${iso}T00:00:00Z`));

/** Paise → "₹1,36,000" (or "₹12.50" with paise). */
export function shownINR(paise: number) {
  const sign = paise < 0 ? '-' : '';
  const absolute = Math.abs(paise);
  return `${sign}₹${(absolute % 100 === 0 ? rupees : rupeesAndPaise).format(absolute / 100)}`;
}

/** 0.4567 → "45.7%". */
export const shownPercent = (ratio: number) => `${(ratio * 100).toLocaleString('en-IN', { maximumFractionDigits: 1 })}%`;
