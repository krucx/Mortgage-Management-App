import { createBdd, defineParameterType, test as base } from 'playwright-bdd';
import { Lender } from './lender';

export const test = base.extend<{ lender: Lender }>({
  lender: async ({ page, request }, use) => {
    await use(new Lender(page, request));
  },
});

export const { Given, When, Then } = createBdd(test);

// The app's own spellings: "5 Sept 2025", "₹1,00,000".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

/** A day as the screens show it (`shown`) and as the API takes it (`iso`). */
export type Day = { shown: string; iso: string };

defineParameterType({
  name: 'day',
  regexp: new RegExp(`\\d{1,2} (?:${MONTHS.join('|')}) \\d{4}`),
  transformer: (shown: string): Day => {
    const [d, month, year] = shown.split(' ');
    const m = String(MONTHS.indexOf(month) + 1).padStart(2, '0');
    return { shown, iso: `${year}-${m}-${d.padStart(2, '0')}` };
  },
});

/** An amount as the screens show it (`shown`), as typed into a form (`typed`) and in paise. */
export type Money = { shown: string; typed: string; paise: number };

defineParameterType({
  name: 'money',
  regexp: /₹[\d,]+/,
  transformer: (shown: string): Money => {
    const typed = shown.slice(1).replaceAll(',', '');
    return { shown, typed, paise: Number(typed) * 100 };
  },
});

/** A Mortgage Name, such as 2025-Ramesh-GoldRing. */
defineParameterType({ name: 'mortgage', regexp: /\d{4}-[A-Za-z]+-[A-Za-z]+/ });

/** A piece of jewellery, such as "Gold bracelet". */
defineParameterType({ name: 'jewellery', regexp: /Gold [a-z]+/ });
