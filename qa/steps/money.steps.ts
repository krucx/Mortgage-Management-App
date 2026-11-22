import { expect, type Page } from '@playwright/test';
import { defineParameterType, type DataTable } from 'playwright-bdd';
import { Given, Then, type Day, type Money } from './fixtures';
import type { Lender, Named, Terms } from './lender';
import { tile } from './selectors';

// The canonical money scenarios (features/money.feature): Mortgages lent on Terms of their
// own, and the exact figures the Mortgage page, the Closure quote and the printable Receipt
// show. Every figure checked here is written in the feature, worked out by hand.

const MODES = { simple: 'simple', 'compounded yearly': 'compounded_yearly', 'compounded monthly': 'compounded_monthly' } as const;
const RULES = { 'pro-rata': 'pro_rata', 'a full month': 'full_month', nothing: 'nothing' } as const;

/** A Mortgage's Interest Mode and Part-Month Rule, as in "simple, with nothing for a part month". */
defineParameterType({
  name: 'terms',
  regexp: /(simple|compounded yearly|compounded monthly), with (pro-rata|a full month|nothing) for a part month/,
  transformer: (mode: string, rule: string): Omit<Terms, 'monthly_rate_bps'> => ({
    interest_mode: MODES[mode as keyof typeof MODES],
    part_month_rule: RULES[rule as keyof typeof RULES],
  }),
});

/** The scenario's Mortgages by their jewellery, to pay one Payment across them. */
const lent = new WeakMap<Lender, Map<string, Named>>();

async function lendOn(
  lender: Lender,
  customer: Named,
  amount: Money,
  day: Day,
  jewellery: string,
  percent: number,
  terms: Omit<Terms, 'monthly_rate_bps'>,
) {
  const mortgage = await lender.lend(customer, {
    amount: amount.paise,
    description: jewellery,
    day: day.iso,
    terms: { monthly_rate_bps: Math.round(percent * 100), ...terms },
  });
  if (!lent.has(lender)) lent.set(lender, new Map());
  lent.get(lender)!.set(jewellery, mortgage);
}

/** "₹2,600" → paise. */
const paiseOf = (shown: string) => Number(shown.replace(/[₹,]/g, '')) * 100;

/** A text as a pattern that matches it whatever the whitespace between its words: an
 * empty table cell adds a space to a row's name. */
const spaced = (text: string) =>
  new RegExp(text.split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));

// Given

Given(
  '{string} was lent {money} on {day} against a {jewellery} at {float}% a month, {terms}',
  async ({ lender }, name: string, amount: Money, day: Day, jewellery: string, percent: number, terms: Omit<Terms, 'monthly_rate_bps'>) => {
    const customer = await lender.addCustomer(name, day.iso);
    await lendOn(lender, customer, amount, day, jewellery, percent, terms);
  },
);

Given(
  'was also lent {money} on {day} against a {jewellery} at {float}% a month, {terms}',
  async ({ lender }, amount: Money, day: Day, jewellery: string, percent: number, terms: Omit<Terms, 'monthly_rate_bps'>) => {
    await lendOn(lender, lender.customer!, amount, day, jewellery, percent, terms);
  },
);

Given('paid {money} on {day}, allocated:', async ({ lender }, total: Money, day: Day, allocations: DataTable) => {
  const mortgages = lent.get(lender)!;
  const cash = allocations.raw().map(([jewellery, amount]) => ({ mortgage: mortgages.get(jewellery)!, cash: paiseOf(amount) }));
  expect(cash.reduce((sum, a) => sum + a.cash, 0), 'the allocations add up to the Payment').toBe(total.paise);
  await lender.pay(lender.customer!, cash, { day: day.iso });
});

// Then

/** A tile of the Mortgage page; its Outstanding tile is named for its date. */
function tileOf(page: Page, label: string) {
  return label === 'Outstanding'
    ? page.locator('.tile', { hasText: 'Outstanding on' }).locator('strong')
    : tile(page, label);
}

Then('its tiles read:', async ({ page }, tiles: DataTable) => {
  for (const [label, value] of tiles.raw()) {
    await expect(tileOf(page, label), label).toHaveText(value);
  }
});

Then('the Closure quote reads:', async ({ page }, rows: DataTable) => {
  const panel = page.locator('.close-panel');
  for (const [label, value] of rows.raw()) {
    const row = panel.locator('.summary-row', { has: page.getByRole('term').getByText(label, { exact: true }) });
    await expect(row.getByRole('definition'), label).toContainText(value);
  }
});

Then('the printable Receipt has the line {string}', async ({ page }, line: string) => {
  await expect(page.getByRole('row', { name: spaced(line) })).toBeVisible();
});
