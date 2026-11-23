import { expect, type Locator, type Page } from '@playwright/test';
import { Then, When, type Day } from './fixtures';
import type { Lender } from './lender';
import { shownDay, shownINR, shownPercent } from './shown';
import { dashboardFigure } from './selectors';

// The Dashboard: its figures are checked against what the app itself works out for the same
// day (GET /api/dashboard), so they hold whatever else the book holds. The golden book, which
// nothing changes, is the one they are read from.

type Dashboard = Record<string, any>;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-11" → "Nov 2025", as the Dashboard names a month. */
const monthName = (month: string) => `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

const book = (lender: Lender, range: { start?: string; end?: string } = {}): Promise<Dashboard> =>
  lender.get('/api/dashboard', {
    ...(range.start ? { start_date: range.start } : {}),
    ...(range.end ? { end_date: range.end } : {}),
  });

/** The Dashboard once its figures are up. */
async function loaded(page: Page) {
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 2 })).toBeVisible();
  await expect(asOf(page)).toBeVisible();
}

/** The line saying which day the figures are for. */
const asOf = (page: Page) => page.getByText(/^As of /);
const headline = (page: Page) => page.getByRole('link').filter({ hasText: 'Owed on Active Mortgages' });
const readsIn = (tile: Locator, text: string) => expect(tile.locator('strong')).toHaveText(text);

const startInput = (page: Page) => page.getByLabel('Activity start date');
const endInput = (page: Page) => page.getByLabel('Activity end date');

const address = (page: Page) => {
  const url = new URL(page.url());
  return url.pathname + url.search;
};

// Following a figure

When("the Lender follows the Dashboard's Owed headline", async ({ page }) => {
  await loaded(page);
  await headline(page).click();
});

When("the Lender follows the Dashboard's {string} figure", async ({ page }, label: string) => {
  await loaded(page);
  await dashboardFigure(page, label).click();
});

Then('the Lender is on {string}', async ({ page }, expected: string) => {
  await expect.poll(() => address(page)).toBe(expected);
});

Then('only Customers with an Active Mortgage are listed', async ({ page }) => {
  await expect(page.getByLabel('Only Customers with an Active Mortgage')).toBeChecked();
});

// The headline

Then('the Dashboard is as of {day}', async ({ page }, day: Day) => {
  await expect(asOf(page)).toHaveText(`As of ${day.shown}`);
});

Then('the Owed headline is the Principal Outstanding and the unpaid interest of the Active Mortgages', async ({ page, lender }) => {
  const b = await book(lender);
  const owed = headline(page);
  await expect(owed).toContainText('Owed on Active Mortgages');
  await expect(owed.locator('strong')).toHaveText(shownINR(b.principal_outstanding + b.unpaid_interest));
  const [mortgages, customers] = [b.active_mortgages, b.customers_with_active_mortgages];
  await expect(owed).toContainText(
    `across ${mortgages} Mortgage${mortgages === 1 ? '' : 's'} and ${customers} Customer${customers === 1 ? '' : 's'}`,
  );
});

Then('the tiles show the Principal Outstanding, Unpaid interest, Active Mortgages and Customers with Active Mortgages', async ({ page, lender }) => {
  const b = await book(lender);
  await readsIn(dashboardFigure(page, 'Principal Outstanding'), shownINR(b.principal_outstanding));
  await readsIn(dashboardFigure(page, 'Unpaid interest'), shownINR(b.unpaid_interest));
  await readsIn(dashboardFigure(page, 'Active Mortgages'), String(b.active_mortgages));
  await readsIn(dashboardFigure(page, 'Customers with Active Mortgages'), String(b.customers_with_active_mortgages));
});

// The activity timeframe

When('the Lender picks {word} {int} as the activity month', async ({ page }, month: string, year: number) => {
  const n = String(MONTHS.indexOf(month) + 1).padStart(2, '0');
  await page.getByLabel('Activity month').fill(`${year}-${n}`);
});

When('the Lender sets the activity from {day}', async ({ page }, day: Day) => {
  await startInput(page).fill(day.iso);
});

When('the Lender sets the activity to {day}', async ({ page }, day: Day) => {
  await endInput(page).fill(day.iso);
});

Then('the activity covers {day} to {day}', async ({ page }, start: Day, end: Day) => {
  await expect(startInput(page)).toHaveValue(start.iso);
  await expect(endInput(page)).toHaveValue(end.iso);
});

Then('the activity figures agree with the book', async ({ page, lender }) => {
  const range = { start: await startInput(page).inputValue(), end: await endInput(page).inputValue() };
  const b = await book(lender, range);
  const kpi = (label: string) => page.locator('.tile', { has: page.getByText(label, { exact: true }) }).locator('strong');
  await expect(kpi('Mortgage principal lent')).toHaveText(shownINR(b.principal_lent_in_period));
  await expect(kpi('Mortgage principal redeemed')).toHaveText(shownINR(b.principal_redeemed_in_period));
  await expect(kpi('Interest collected')).toHaveText(shownINR(b.interest_collected_in_period));
});

Then('the Dashboard says {string}', async ({ page }, text: string) => {
  await expect(page.getByRole('alert').filter({ hasText: text })).toBeVisible();
});

Then('the Dashboard has no date error', async ({ page }) => {
  await expect(page.getByRole('alert')).toHaveCount(0);
});

// Interest collected

Then('the Interest collected tiles agree with the book', async ({ page, lender }) => {
  const b = await book(lender);
  const [year, month] = [b.as_of.slice(0, 4), monthName(b.as_of.slice(0, 7))];
  await readsIn(dashboardFigure(page, `In ${month}`), shownINR(b.interest_collected_this_month));
  await readsIn(dashboardFigure(page, `Interest collected so far in ${year}`), shownINR(b.interest_collected_this_year));
});

Then('the Payments listed paid the interest that figure shows', async ({ page, lender }) => {
  const b = await book(lender);
  await expect(page.getByText(/ paying .* of interest/)).toContainText(`paying ${shownINR(b.interest_collected_this_month)} of interest`);
});

Then('the Payments listed paid the interest the app counts for {int}', async ({ page, lender }, year: number) => {
  const { interest_paid } = await lender.get('/api/payments', { year: String(year) });
  await expect(page.getByText(/ paying .* of interest/)).toContainText(`paying ${shownINR(interest_paid)} of interest`);
});

// Collateral

Then('the Collateral Value and Loan-to-Value tiles agree with the book', async ({ page, lender }) => {
  const b = await book(lender);
  expect(b.loan_to_value, 'the golden book has Collateral Values').not.toBeNull();
  await readsIn(dashboardFigure(page, 'Collateral Value'), shownINR(b.collateral_value));
  await readsIn(dashboardFigure(page, 'Loan-to-Value'), shownPercent(b.loan_to_value));
});

Then("the Dashboard's Loan-to-Value reads {string}", async ({ page }, reading: string) => {
  await readsIn(dashboardFigure(page, 'Loan-to-Value'), reading);
});

// Follow-up

Then("the Call List tile shows the number of Mortgages on today's Call List", async ({ page, lender }) => {
  const b = await book(lender);
  const tile = dashboardFigure(page, "On today's Call List");
  await readsIn(tile, String(b.call_list_count));
  await expect(tile).toContainText(b.call_list_count > 0 ? 'To phone today' : 'Nobody to call');
});

Then('the Reminders tile shows the number to send, and the number to approve', async ({ page, lender }) => {
  const b = await book(lender);
  expect(b.reminders_to_send, 'the golden book has a Reminder to send').toBeGreaterThan(0);
  expect(b.reminders_to_approve, 'the golden book has a Reminder to approve').toBeGreaterThan(0);
  const tile = dashboardFigure(page, 'Reminders to send');
  await readsIn(tile, String(b.reminders_to_send));
  await expect(tile).toContainText('To send on WhatsApp');
  await expect(tile).toContainText(`${b.reminders_to_approve} to approve`);
});

Then('the Reminders to send are shown', async ({ page }) => {
  await expect(page.getByRole('radio', { name: 'To send' })).toBeChecked();
});

// Closed this month

Then('the Closed in {word} {int} figures agree with the book', async ({ page, lender }, month: string, year: number) => {
  const b = await book(lender);
  await expect(page.getByRole('heading', { name: `Closed in ${month} ${year}`, level: 3 })).toBeVisible();
  await readsIn(dashboardFigure(page, 'Redeemed'), String(b.redeemed_this_month));
  const waived = dashboardFigure(page, 'Waived off');
  await readsIn(waived, String(b.waived_this_month));
  if (b.waived_this_month) await expect(waived).toContainText(`${shownINR(b.waived_amount_this_month)} let off`);
  const forfeited = dashboardFigure(page, 'Forfeited');
  await readsIn(forfeited, String(b.forfeited_this_month));
  if (b.forfeited_this_month) {
    const result = b.forfeiture_profit_loss_this_month;
    await expect(forfeited).toContainText(`${result >= 0 ? 'Profit' : 'Loss'} ${shownINR(Math.abs(result))}`);
  }
});

Then('as many Mortgages are listed as the book closed this month that way', async ({ page, lender }) => {
  const b = await book(lender);
  const closed = { redeemed: b.redeemed_this_month, waived: b.waived_this_month, forfeited: b.forfeited_this_month };
  const status = new URL(page.url()).searchParams.get('status') as keyof typeof closed;
  await expect(page.locator('table tbody tr')).toHaveCount(closed[status]);
});

// Looking ahead

Then('the Looking ahead table gives each of its figures for 3, 6 and 12 months, exact or estimate', async ({ page, lender }) => {
  const b = await book(lender);
  const table = page.getByRole('table', { name: 'Looking ahead' });
  const about = (n: number) => `about ${n.toLocaleString('en-IN', { maximumFractionDigits: 1 })}`;
  const rows: [string, 'exact' | 'estimate', (h: Dashboard) => string][] = [
    ['Interest the Active Mortgages will be charged', 'exact', (h) => shownINR(h.interest_accrued)],
    ['Payments received', 'estimate', (h) => `about ${shownINR(h.payments_estimate)}`],
    ['Principal lent', 'estimate', (h) => `about ${shownINR(h.principal_lent_estimate)}`],
    ['Mortgages Redeemed', 'estimate', (h) => about(h.redemptions_estimate)],
  ];
  expect(b.projections.map((h: Dashboard) => h.months)).toEqual([3, 6, 12]);
  for (const [i, h] of b.projections.entries()) {
    await expect(table.getByRole('columnheader').nth(i + 1)).toHaveText(`${h.months} months (to ${shownDay(h.on)})`);
  }
  for (const [label, kind, value] of rows) {
    const row = table.locator('tbody tr').filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${label}`) }) });
    // The row's heading: its figure's name, then whether it is exact or an estimate.
    await expect(row.getByRole('rowheader').locator('span')).toHaveText(kind);
    for (const [i, h] of b.projections.entries()) await expect(row.locator('td').nth(i)).toHaveText(value(h));
  }
});

Then('the Payments chart shows each month received and each coming month', async ({ page, lender }) => {
  const b = await book(lender);
  const chart = page.locator('figure', { has: page.getByRole('img', { name: /^Payments received in each of the last/ }) });
  await expect(chart.getByRole('img')).toHaveAttribute(
    'aria-label',
    `Payments received in each of the last ${b.payments_by_month.length} months, then estimates for the next ${b.coming_months.length}`,
  );
  // Each month's bar is named for what it shows: received, or an estimate to come.
  const received = chart.locator('g[aria-label$=" received"]');
  const coming = chart.locator('g[aria-label*="(estimate)"]');
  await expect(received).toHaveCount(b.payments_by_month.length);
  await expect(coming).toHaveCount(b.coming_months.length);
  for (const [i, m] of b.payments_by_month.entries()) {
    await expect(received.nth(i)).toHaveAttribute('aria-label', `${monthName(m.month)}: ${shownINR(m.amount)} received`);
  }
  for (const [i, m] of b.coming_months.entries()) {
    await expect(coming.nth(i)).toHaveAttribute(
      'aria-label',
      `${monthName(m.month)}: about ${shownINR(m.payments_estimate)} (estimate), ${shownINR(m.interest_charged)} interest charged`,
    );
  }
});
