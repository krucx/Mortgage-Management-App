import { expect, type Page } from '@playwright/test';
import { Given, Then, When, type Day, type Money } from './fixtures';
import type { Lender } from './lender';
import { shownINR } from './shown';

// The Payments list: its filters, summary, badges, sorting and pager.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "October", 2025 → "2025-10", as the list's Month filter and the API take it. */
function monthOf(name: string, year: number) {
  return `${year}-${String(MONTHS.indexOf(name) + 1).padStart(2, '0')}`;
}

function rows(page: Page) {
  return page.locator('table tbody tr');
}

/** A column of the list, by its place: Date, Customer, Mortgages, Method, Amount. */
function column(page: Page, n: number) {
  return rows(page).locator(`td:nth-child(${n})`);
}

function withReference(page: Page, reference: string) {
  return rows(page).filter({ hasText: reference });
}

/** The row whose Amount (after any badges) is `amount`. */
function withAmount(page: Page, amount: Money) {
  return rows(page).filter({ has: page.locator('td.num', { hasText: new RegExp(`(^|\\s)${amount.shown}$`) }) });
}

function period(page: Page) {
  return page.getByRole('combobox', { name: /^Received/ });
}

function summary(page: Page) {
  return page.getByText(/ paying .* of interest/);
}

/** Its Amount in paise, after any badges: "voided ₹2,000" → 200000. */
function paise(cell: string) {
  return Math.round(Number(cell.match(/₹([\d,.]+)$/)![1].replaceAll(',', '')) * 100);
}

Given('paid {money} on it {int} times on {day}', async ({ lender }, amount: Money, times: number, day: Day) => {
  for (let i = 0; i < times; i++) {
    await lender.pay(lender.customer!, [{ mortgage: lender.mortgage!, cash: amount.paise }], { day: day.iso });
  }
});

Given(
  'paid {money} on it on {day}, voided because {string}',
  async ({ lender }, amount: Money, day: Day, reason: string) => {
    const payment = await lender.pay(lender.customer!, [{ mortgage: lender.mortgage!, cash: amount.paise }], { day: day.iso });
    await lender.post(`/api/payments/${payment.id}/void`, { reason }, day.iso);
  },
);

When('the Lender filters the Payments by {string}', async ({ page }, query: string) => {
  await page.getByRole('searchbox', { name: 'Filter Payments' }).fill(query);
});

When('the Lender lists the Payments received in {word} {int}', async ({ page }, month: string, year: number) => {
  await period(page).selectOption('month');
  await page.getByLabel('Month', { exact: true }).fill(monthOf(month, year));
});

When('the Lender lists the Payments received in the year {int}', async ({ page }, year: number) => {
  await period(page).selectOption('year');
  await page.getByLabel('Year', { exact: true }).selectOption(String(year));
});

When('the Lender lists the Payments received at any time', async ({ page }) => {
  await period(page).selectOption('any');
});

When('the Lender hides Voided Payments', async ({ page }) => {
  await page.getByLabel('Show Voided Payments').uncheck();
});

When('the Lender sorts the Payments by {word}', async ({ page }, heading: string) => {
  await page.getByRole('columnheader', { name: heading }).getByRole('button').click();
});

When('the Lender goes to the next page', async ({ page }) => {
  await page.getByRole('button', { name: 'Next' }).click();
});

// The list follows the filter after a pause, so these wait for every row to agree.

Then('every Payment listed is from {string}', async ({ page }, customer: string) => {
  await expect(rows(page).first()).toBeVisible();
  await expect.poll(async () => new Set(await column(page, 2).allTextContents())).toEqual(new Set([customer]));
});

Then('every Payment listed pays {mortgage}', async ({ page }, mortgage: string) => {
  await expect(rows(page).first()).toBeVisible();
  await expect.poll(async () => (await column(page, 3).allTextContents()).every((names) => names.split(', ').includes(mortgage))).toBe(true);
});

Then('every Payment listed was received in {word} {int}', async ({ page }, month: string, year: number) => {
  await expect(rows(page).first()).toBeVisible();
  await expect.poll(async () => (await column(page, 1).allTextContents()).every((day) => day.endsWith(` ${month} ${year}`))).toBe(true);
});

Then('the Payment {string} is listed', async ({ page }, reference: string) => {
  await expect(withReference(page, reference)).toHaveCount(1);
});

Then('only the Payment {string} is listed', async ({ page }, reference: string) => {
  await expect(rows(page)).toHaveCount(1);
  await expect(withReference(page, reference)).toHaveCount(1);
});

Then('only the Payment of {money} is listed', async ({ page }, amount: Money) => {
  await expect(rows(page)).toHaveCount(1);
  await expect(withAmount(page, amount)).toHaveCount(1);
});

Then('{int} Payments are listed', async ({ page }, count: number) => {
  await expect(rows(page)).toHaveCount(count);
});

Then('the Payment {string} is marked {string}', async ({ page }, reference: string, badge: string) => {
  await expect(withReference(page, reference).locator('.badge').getByText(badge, { exact: true })).toBeVisible();
});

Then('the Payment of {money} is marked {string}', async ({ page }, amount: Money, badge: string) => {
  await expect(withAmount(page, amount).locator('.badge').getByText(badge, { exact: true })).toBeVisible();
});

/** The summary says what the app has for the period: how many, and the interest paid. */
async function expectSummary(page: Page, lender: Lender, params: Record<string, string>) {
  const { total, interest_paid } = await lender.get('/api/payments', params);
  await expect(summary(page)).toHaveText(
    `${total} Payment${total === 1 ? '' : 's'}, paying ${shownINR(interest_paid)} of interest (Voided ones paid none)`,
  );
}

Then('the summary agrees with the Payments received in {word} {int}', async ({ page, lender }, month: string, year: number) => {
  await expectSummary(page, lender, { month: monthOf(month, year) });
});

Then('the summary agrees with the Payments received in the year {int}', async ({ page, lender }, year: number) => {
  await expectSummary(page, lender, { year: String(year) });
});

Then('the list has no summary', async ({ page }) => {
  await expect(summary(page)).toBeHidden();
});

Then('the Payments are listed by Amount, largest first', async ({ page }) => {
  await expect(page.getByRole('columnheader', { name: 'Amount' })).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(async () => isSorted((await column(page, 5).allTextContents()).map(paise), (a, b) => b - a)).toBe(true);
});

Then('the Payments are listed by Amount, smallest first', async ({ page }) => {
  await expect(page.getByRole('columnheader', { name: 'Amount' })).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(async () => isSorted((await column(page, 5).allTextContents()).map(paise), (a, b) => a - b)).toBe(true);
});

Then('the Payments are listed by Customer, A to Z', async ({ page }) => {
  await expect(page.getByRole('columnheader', { name: 'Customer' })).toHaveAttribute('aria-sort', 'ascending');
  const names = async () => (await column(page, 2).allTextContents()).map((name) => name.toLowerCase());
  await expect.poll(async () => isSorted(await names(), (a, b) => (a < b ? -1 : a > b ? 1 : 0))).toBe(true);
});

Then('the list shows {string} on {string}', async ({ page }, showing: string, of: string) => {
  await expect(page.getByText(showing, { exact: true })).toBeVisible();
  await expect(page.getByText(of, { exact: true })).toBeVisible();
});

/** Whether `values` are in `order`, and more than one, so the order says something. */
function isSorted<T>(values: T[], order: (a: T, b: T) => number) {
  return values.length > 1 && values.every((value, i) => i === 0 || order(values[i - 1], value) <= 0);
}
