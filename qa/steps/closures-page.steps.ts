import { expect, type Locator, type Page } from '@playwright/test';
import { Given, Then, When, type Day, type Money } from './fixtures';
import type { Lender } from './lender';
import { shownINR } from './shown';

// The Closures page: the Dormant list, the Mortgages to close, and closing several at once.
// Totals are checked against what the API works out for the same Mortgages and date.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];

const closuresTab = (page: Page) => page.getByRole('link', { name: /^Closures/ });
// By its label: its class is scoped to the Nav's CSS module, so it is no hook.
const dormantDot = (page: Page) => closuresTab(page).getByLabel(/ Dormant, to Redeem$/);
const panel = (page: Page) => page.locator('.close-panel');

/** The Mortgages-to-close table is the one with a Started column; the Dormant one has none. */
const toClose = (page: Page) =>
  page.locator('table').filter({ has: page.getByRole('columnheader', { name: /^Started/ }) });
const dormant = (page: Page) =>
  page.locator('table').filter({ hasNot: page.getByRole('columnheader', { name: /^Started/ }) });
const rowsOf = (table: Locator) => table.locator('tbody tr');
const columnOf = (table: Locator, n: number) => rowsOf(table).locator(`td:nth-child(${n})`);

/** Each list's pager: the Dormant one comes first when both show. */
const dormantPager = (page: Page) => page.locator('.row.spread').first();
const toClosePager = (page: Page) => page.locator('.row.spread').last();

const heading = (table: Locator, name: string) => table.getByRole('columnheader', { name: new RegExp(`^${name}`) });

function isSorted<T>(values: T[], order: (a: T, b: T) => number) {
  return values.length > 1 && values.every((value, i) => i === 0 || order(values[i - 1], value) <= 0);
}
const text = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const paise = (cell: string) => Math.round(Number(cell.match(/₹([\d,.]+)/)![1].replaceAll(',', '')) * 100);
const dayOf = (cell: string) => {
  const [d, month, year] = cell.trim().split(' ');
  return new Date(Number(year), MONTHS.indexOf(month), Number(d)).getTime();
};
const lowered = async (cells: Locator) => (await cells.allTextContents()).map((cell) => cell.trim().toLowerCase());

// Seeding

Given('{int} Customers were each left owing nothing by back-dated Payments', async ({ lender }, count: number) => {
  const terms = { monthly_rate_bps: 300, interest_mode: 'simple', part_month_rule: 'nothing' };
  for (let i = 0; i < count; i++) {
    const customer = await lender.addCustomer(`Dormantpage${String.fromCharCode(97 + Math.floor(i / 26))}${String.fromCharCode(97 + (i % 26))} Customer`, '2026-01-14');
    const mortgage = await lender.post(
      '/api/mortgages',
      {
        customer_id: customer.id,
        start_date: '2026-01-14',
        amount_lent: 100_000_00,
        description: 'Gold chain',
        gross_weight_mg: 20_000,
        net_weight_mg: 19_000,
        purity_karat: 22,
        terms,
        lent_through: 'upi',
      },
      '2026-01-14',
    );
    for (const [amount, paid] of [[3_000, '2026-04-15'], [50_000, '2026-04-10'], [56_000, '2026-04-09']] as const) {
      await lender.post(
        '/api/payments',
        {
          customer_id: customer.id,
          paid_on: paid,
          amount: amount * 100,
          method: 'cash',
          allocations: [{ mortgage_id: mortgage.id, amount: amount * 100 }],
        },
        '2026-04-20',
      );
    }
  }
});

// Opening, the tab and its dot

When('the Lender opens the Closures page', async ({ page }) => {
  await page.goto('/closures');
  await expect(page.getByRole('heading', { name: 'Closures', level: 2 })).toBeVisible();
  await expect(page.getByText('Loading…')).toHaveCount(0);
});

Then('the Closures tab shows a red dot, with the tooltip {string}', async ({ page }, tooltip: string) => {
  await expect(closuresTab(page)).toHaveAttribute('title', tooltip);
  await expect(dormantDot(page)).toBeVisible();
});

Then('the Closures tab has no red dot', async ({ page }) => {
  await expect(closuresTab(page)).toBeVisible();
  await expect(dormantDot(page)).toHaveCount(0);
});

// The Dormant list

When('the Lender notes the Mortgage that owes nothing', async ({ lender }) => {
  const { items } = await lender.get('/api/closures/dormant');
  expect(items).toHaveLength(1);
  lender.mortgage = { id: items[0].id, name: items[0].name };
});

Then('the Dormant section lists it, to Redeem', async ({ page, lender }) => {
  const row = rowsOf(dormant(page)).filter({ has: page.getByRole('link', { name: lender.mortgage!.name, exact: true }) });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('link', { name: 'Redeem…' })).toHaveAttribute('href', `/mortgages/${lender.mortgage!.id}/redeem`);
});

/** The Mortgage's row on the Dormant list, paging from page 1 until it shows; null if absent. */
async function dormantRow(page: Page, name: string) {
  const pager = dormantPager(page);
  await expect(rowsOf(dormant(page)).first()).toBeVisible();
  const row = rowsOf(dormant(page)).filter({ has: page.getByRole('link', { name, exact: true }) });
  for (;;) {
    if ((await row.count()) > 0) return row;
    const next = pager.getByRole('button', { name: 'Next' });
    if (!(await next.isVisible()) || (await next.isDisabled())) return null;
    const at = await pager.getByText(/^Page \d+ of \d+$/).textContent();
    await next.click();
    await expect(pager.getByText(/^Page \d+ of \d+$/)).not.toHaveText(at!);
  }
}

When('the Lender redeems it from the Closures page for ₹0', async ({ page, lender }) => {
  await page.goto('/closures');
  const row = await dormantRow(page, lender.mortgage!.name);
  expect(row, `${lender.mortgage!.name} on the Dormant list`).not.toBeNull();
  await row!.getByRole('link', { name: 'Redeem…' }).click();
  await panel(page).getByRole('button', { name: 'Redeem for ₹0' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Confirm Redemption' }).click();
  await expect(dialog).toBeHidden();
});

Then('it is Redeemed', async ({ lender }) => {
  await expect.poll(async () => (await lender.get(`/api/mortgages/${lender.mortgage!.id}`)).status).toBe('redeemed');
});

Then('it is no longer listed as Dormant', async ({ page, lender }) => {
  expect(await dormantRow(page, lender.mortgage!.name)).toBeNull();
});

Then('the Dormant section says {string}', async ({ page }, hint: string) => {
  await expect(page.getByText(hint, { exact: true })).toBeVisible();
});

Then('the Forfeit or Waive off section says {string}', async ({ page }, hint: string) => {
  await expect(page.getByText(hint, { exact: true })).toBeVisible();
});

// Sorting and paging

When('the Lender sorts the Dormant Mortgages by {string}', async ({ page }, column: string) => {
  await heading(dormant(page), column).getByRole('button').click();
});

When('the Lender sorts the Mortgages to close by {string}', async ({ page }, column: string) => {
  await heading(toClose(page), column).getByRole('button').click();
  await expect(heading(toClose(page), column)).toHaveAttribute('aria-sort', /ascending|descending/);
});

Then('the Dormant Mortgages are listed by Mortgage, A to Z', async ({ page }) => {
  await expect(heading(dormant(page), 'Mortgage')).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(async () => isSorted(await lowered(columnOf(dormant(page), 1)), text)).toBe(true);
});

Then('the Dormant Mortgages are listed by Mortgage, Z to A', async ({ page }) => {
  await expect(heading(dormant(page), 'Mortgage')).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(async () => isSorted(await lowered(columnOf(dormant(page), 1)), (a, b) => text(b, a))).toBe(true);
});

Then('the Dormant Mortgages are listed by Customer, A to Z', async ({ page }) => {
  await expect(heading(dormant(page), 'Customer')).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(async () => isSorted(await lowered(columnOf(dormant(page), 2)), text)).toBe(true);
});

Then('the Mortgages to close are listed by Started, newest first', async ({ page }) => {
  await expect(heading(toClose(page), 'Started')).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(async () => isSorted((await columnOf(toClose(page), 4).allTextContents()).map(dayOf), (a, b) => b - a)).toBe(true);
});

Then('the Mortgages to close are listed by Started, oldest first', async ({ page }) => {
  await expect(heading(toClose(page), 'Started')).toHaveAttribute('aria-sort', 'ascending');
  await expect.poll(async () => isSorted((await columnOf(toClose(page), 4).allTextContents()).map(dayOf), (a, b) => a - b)).toBe(true);
});

Then('the Mortgages to close are listed by Outstanding today, largest first', async ({ page }) => {
  await expect(heading(toClose(page), 'Outstanding today')).toHaveAttribute('aria-sort', 'descending');
  await expect.poll(async () => isSorted((await columnOf(toClose(page), 5).allTextContents()).map(paise), (a, b) => b - a)).toBe(true);
});

Then('the Dormant list shows its first twenty', async ({ page }) => {
  await expect(dormantPager(page).getByText(/^Showing 1–20 of \d+$/)).toBeVisible();
  await expect(rowsOf(dormant(page))).toHaveCount(20);
});

When('the Lender goes to the next page of Dormant', async ({ page }) => {
  await dormantPager(page).getByRole('button', { name: 'Next' }).click();
});

Then('the Dormant list shows the rest', async ({ page }) => {
  await expect(dormantPager(page).getByText(/^Showing 21–\d+ of \d+$/)).toBeVisible();
  await expect(dormantPager(page).getByText(/^Page 2 of \d+$/)).toBeVisible();
});

Then('the Mortgages to close show their first twenty', async ({ page }) => {
  await expect(toClosePager(page).getByText(/^Showing 1–20 of \d+$/)).toBeVisible();
  await expect(rowsOf(toClose(page))).toHaveCount(20);
});

When('the Lender goes to the next page of the Mortgages to close', async ({ page }) => {
  await toClosePager(page).getByRole('button', { name: 'Next' }).click();
});

Then('the Mortgages to close show their last page', async ({ page }) => {
  await expect(toClosePager(page).getByText(/^Showing 21–\d+ of \d+$/)).toBeVisible();
});

// Choosing Mortgages to close

When('the Lender chooses {mortgage} to close', async ({ page }, name: string) => {
  await toClose(page).getByRole('checkbox', { name: `Choose ${name}` }).check();
});

Then('{mortgage} is the first of the Mortgages to close', async ({ page }, name: string) => {
  const first = rowsOf(toClose(page)).first();
  await expect(first.getByRole('checkbox')).toBeChecked();
  await expect(first.getByRole('link', { name, exact: true })).toBeVisible();
});

When('the Lender chooses to waive the chosen off', async ({ page }) => {
  await page.getByRole('radio', { name: 'Waive off' }).check();
});

// The Forfeit and Waive off forms

/** The Mortgages the form lists, by name, and the date it holds. */
async function chosenOn(page: Page, lender: Lender) {
  const names = (await panel(page).locator('tbody tr td:first-child').allTextContents()).map((n) => n.trim());
  const day = await panel(page).locator('input[type=date]').inputValue();
  const owed = await Promise.all(
    names.map(async (name) => {
      const { id } = await lender.mortgageNamed(name);
      return (await lender.get(`/api/mortgages/${id}/outstanding-on-closure`, { on: day })).to_pay as number;
    }),
  );
  return { names, owed };
}

const paiseIn = async (field: Locator) => Math.round(Number(await field.inputValue()) * 100);

When('the Lender enters {money} as the Recovered Amount for {mortgage}', async ({ page }, amount: Money, name: string) => {
  await panel(page).getByRole('spinbutton', { name: `Recovered Amount for ${name}` }).fill(amount.typed);
});

When('the Lender enters {money} as received now for {mortgage}', async ({ page }, amount: Money, name: string) => {
  await panel(page).getByRole('spinbutton', { name: `Received now for ${name}` }).fill(amount.typed);
});

When('the Lender gives {string} as the reason for all', async ({ page }, reason: string) => {
  await panel(page).getByLabel('Reason (for all)').fill(reason);
});

Then('the Final Payments method is not asked for', async ({ page }) => {
  await expect(panel(page).getByLabel('Final Payments made by')).toHaveCount(0);
});

Then('the Final Payments method is asked for', async ({ page }) => {
  await expect(panel(page).getByLabel('Final Payments made by')).toBeVisible();
});

Then('the total is the profit or loss the app works out', async ({ page, lender }) => {
  const { names, owed } = await chosenOn(page, lender);
  let total = 0;
  for (const [i, name] of names.entries()) {
    total += (await paiseIn(panel(page).getByRole('spinbutton', { name: `Recovered Amount for ${name}` }))) - owed[i];
  }
  const label = total >= 0 ? 'Total profit' : 'Total loss';
  await expect(panel(page).getByText(`${label} ${shownINR(Math.abs(total))}`, { exact: true })).toBeVisible();
});

Then('the total waived is what the app works out', async ({ page, lender }) => {
  const { names, owed } = await chosenOn(page, lender);
  let total = 0;
  for (const [i, name] of names.entries()) {
    total += owed[i] - (await paiseIn(panel(page).getByRole('spinbutton', { name: `Received now for ${name}` })));
  }
  await expect(panel(page).getByText(`Total waived off ${shownINR(total)}`, { exact: true })).toBeVisible();
});

When('the Lender forfeits them', async ({ page }) => {
  await panel(page).getByRole('button', { name: /^Forfeit \d+$/ }).click();
});

When('the Lender waives them off', async ({ page }) => {
  await panel(page).getByRole('button', { name: /^Waive off \d+$/ }).click();
});

// What the book holds

Then('the book has {mortgage} as {string}', async ({ lender }, name: string, status: string) => {
  const { id } = await lender.mortgageNamed(name);
  await expect.poll(async () => (await lender.get(`/api/mortgages/${id}`)).status).toBe(status);
});

Then('forfeiting {mortgage} and {mortgage} on {day} is refused', async ({ lender }, one: string, other: string, day: Day) => {
  const mortgages = await Promise.all(
    [one, other].map(async (name) => ({ mortgage_id: (await lender.mortgageNamed(name)).id, recovered_amount: 100_000 })),
  );
  const refused = await lender.refusal('post', '/api/closures/forfeit', { forfeited_on: day.iso, note: '', mortgages });
  expect(refused).toContain('had not started on that date');
});
