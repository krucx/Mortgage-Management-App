import { expect, type Page } from '@playwright/test';
import { Given, Then, When, type Day, type Money } from './fixtures';
import type { Lender } from './lender';
import { shownINR } from './shown';

// The payment form (/payments/new): choosing the Customer and Mortgages, the allocation
// modes, paying the full Outstanding, its problems, the Cash Limit's warning and saving.

type Row = { id: number; name: string; outstanding_total: number; advance_held: number };

/** The Customer's Active Mortgages with what each owed on `day` (default: the scenario's), as
 * the form lists them. */
async function activeOn(lender: Lender, day = lender.day!): Promise<Row[]> {
  const { items } = await lender.get('/api/mortgages', {
    customer_id: String(lender.customer!.id),
    status: 'active',
    as_of: day,
    paged: 'false',
  });
  return items;
}

/** What pays it in full: its Outstanding less the Advance held, as the form counts it. */
const toPay = (m: Row) => m.outstanding_total - m.advance_held;

function allocationRow(page: Page, mortgage: string) {
  return page.getByRole('row', { name: new RegExp(`Include ${mortgage}`) });
}

function include(page: Page, mortgage: string) {
  return page.getByRole('checkbox', { name: `Include ${mortgage}` });
}

function amountFor(page: Page, mortgage: string) {
  return page.getByRole('spinbutton', { name: `Amount for ${mortgage}` });
}

function percentageFor(page: Page, mortgage: string) {
  return page.getByRole('spinbutton', { name: `Percentage for ${mortgage}` });
}

function recordPayment(page: Page) {
  return page.getByRole('button', { name: /^Record Payment/ });
}

function dialog(page: Page) {
  return page.getByRole('dialog');
}

/** "2025-11-15" as the backend's refusals spell a date: "15 Nov 2025". */
function refusedDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

async function overpaid(lender: Lender, day: Day) {
  const owed = (await activeOn(lender, day.iso)).find((m) => m.id === lender.mortgage!.id)!;
  return `${lender.mortgage!.name}: the Payment on ${refusedDay(day.iso)} would be more than the ${shownINR(owed.outstanding_total)} owed then`;
}

Given('it was Redeemed on {day}', async ({ lender }, day: Day) => {
  await lender.post(`/api/mortgages/${lender.mortgage!.id}/redeem`, { redeemed_on: day.iso, method: 'upi' }, day.iso);
});

Given('the Cash Limit is cleared', async ({ page }) => {
  // The Cash Limit is one setting for the whole book: clearing it for real would change the
  // warnings every scenario running alongside sees. It is the screens' warning alone (the app
  // never refuses for it), so this browser reads it as cleared.
  await page.route('**/api/settings/cash-limit', (route) => route.fulfill({ json: { cash_limit: null } }));
});

When('the Lender starts to record a Payment', async ({ page }) => {
  await page.getByRole('link', { name: 'Record a Payment' }).click();
  await expect(page).toHaveURL(/\/payments\/new$/);
});

When('the Lender chooses the Customer {string}', async ({ page, lender }, name: string) => {
  lender.customer = await lender.customerNamed(name);
  await page.getByRole('searchbox', { name: 'Customer' }).fill(name);
  await page.getByRole('button', { name: new RegExp(`^${name} `) }).click();
  await expect(page).toHaveURL(new RegExp(`/payments/new\\?customer=${lender.customer.id}$`));
});

When('the Lender unticks {mortgage}', async ({ page }, mortgage: string) => {
  await include(page, mortgage).uncheck();
});

When('the Lender dates the Payment {day}', async ({ page }, day: Day) => {
  await page.getByLabel('Date received').fill(day.iso);
  await expect(page.getByRole('columnheader', { name: `Outstanding on ${day.shown}` })).toBeVisible();
});

When('the Lender pays by UPI', async ({ page }) => {
  await page.getByLabel('Method').selectOption({ label: 'UPI' });
});

When('enters a Discount of minus {money} for {mortgage}', async ({ page }, amount: Money, mortgage: string) => {
  await page.getByRole('spinbutton', { name: `Discount for ${mortgage}` }).fill(`-${amount.typed}`);
});

When('enters a Discount of {money} for {mortgage}', async ({ page }, amount: Money, mortgage: string) => {
  await page.getByRole('spinbutton', { name: `Discount for ${mortgage}` }).fill(amount.typed);
});

When('the Lender allocates by {word}', async ({ page }, mode: string) => {
  await page.getByRole('radio', { name: `By ${mode}` }).check();
});

When('the Lender sets the Amount for {mortgage} to {money}', async ({ page }, mortgage: string, amount: Money) => {
  await amountFor(page, mortgage).fill(amount.typed);
});

When('the Lender sets the Percentage for {mortgage} to {int}', async ({ page }, mortgage: string, percent: number) => {
  await percentageFor(page, mortgage).fill(String(percent));
});

When('the Lender pays the full Outstanding', async ({ page }) => {
  await page.getByRole('button', { name: /^Pay the full Outstanding/ }).click();
});

When('the Lender saves the Payment', async ({ page }) => {
  await expect(recordPayment(page)).toBeEnabled();
  await recordPayment(page).click();
  await expect(dialog(page)).toBeVisible();
});

When('the Lender confirms the Payment', async ({ page }) => {
  await dialog(page).getByRole('button', { name: 'Confirm and save' }).click();
});

When('the Lender redeems them', async ({ page }) => {
  await dialog(page).getByRole('button', { name: 'Redeem', exact: true }).click();
});

When('the Lender goes back', async ({ page }) => {
  await dialog(page).getByRole('button', { name: 'Go back' }).click();
});

When('the Lender records it in cash anyway', async ({ page }) => {
  await dialog(page).getByRole('button', { name: 'Record in cash anyway' }).click();
});

Then('the Payment is from {string}', async ({ page }, name: string) => {
  await expect(page.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change Customer' })).toBeVisible();
});

Then('{mortgage} is ticked', async ({ page }, mortgage: string) => {
  await expect(include(page, mortgage)).toBeChecked();
});

Then('{mortgage} is not ticked', async ({ page }, mortgage: string) => {
  await expect(include(page, mortgage)).not.toBeChecked();
});

Then('the Lender is allocating equally', async ({ page }) => {
  await expect(page.getByRole('radio', { name: 'Equally (suggested)' })).toBeChecked();
});

Then('the Amount for {mortgage} is {money}', async ({ page }, mortgage: string, amount: Money) => {
  await expect(amountFor(page, mortgage)).toHaveValue(amount.typed);
});

Then('the Percentage for {mortgage} is {int}', async ({ page }, mortgage: string, percent: number) => {
  await expect(percentageFor(page, mortgage)).toHaveValue(String(percent));
});

Then('each Outstanding shown is what it owed on {day}', async ({ page, lender }, day: Day) => {
  const owed = await activeOn(lender, day.iso);
  expect(owed.length).toBeGreaterThan(1);
  for (const m of owed) {
    await expect(allocationRow(page, m.name).getByRole('cell', { name: shownINR(m.outstanding_total), exact: true })).toBeVisible();
  }
});

Then("each Mortgage's Amount is its whole Outstanding", async ({ page, lender }) => {
  for (const m of await activeOn(lender)) {
    await expect(amountFor(page, m.name)).toHaveValue(String(toPay(m) / 100));
  }
});

Then('no Discount or Advance is entered', async ({ page, lender }) => {
  for (const { name } of await activeOn(lender)) {
    await expect(page.getByRole('spinbutton', { name: `Discount for ${name}` })).toHaveValue('');
    await expect(page.getByRole('spinbutton', { name: `Advance for ${name}` })).toHaveValue('');
  }
});

Then("the full Outstanding can't be paid: {string}", async ({ page }, reason: string) => {
  await expect(page.getByRole('button', { name: /^Pay the full Outstanding/ })).toBeDisabled();
  await page.getByText("Can't pay it in full").hover();
  await expect(page.getByRole('tooltip')).toHaveText(reason);
});

Then('their Mortgage that owes nothing reads {string} and can\'t be ticked', async ({ page, lender }, hint: string) => {
  const dormant = (await activeOn(lender)).filter((m) => m.outstanding_total === 0);
  expect(dormant).toHaveLength(1);
  const { id, name } = dormant[0];
  await expect(page.getByRole('link', { name: `${name} ${hint} →` })).toHaveAttribute('href', `/mortgages/${id}/redeem`);
  await expect(include(page, name)).toHaveCount(0);
});

Then('the form says {string}', async ({ page }, problem: string) => {
  await expect(page.locator('.problems').getByText(problem, { exact: true })).toBeVisible();
});

Then('the form says the Allocations add up to what the Mortgages owe, not {money}', async ({ page, lender }, received: Money) => {
  const owed = (await activeOn(lender)).reduce((sum, m) => sum + toPay(m), 0);
  await expect(page.locator('.problems').getByText(`The Allocations add up to ${shownINR(owed)}, not ${received.shown}.`, { exact: true })).toBeVisible();
});

Then("the Payment can't be recorded", async ({ page }) => {
  await expect(recordPayment(page)).toBeDisabled();
});

Then('the confirmation asks {string}', async ({ page }, question: string) => {
  await expect(dialog(page).getByRole('heading', { level: 2 })).toHaveText(question);
});

Then('the Lender is warned {string}', async ({ page }, warning: string) => {
  await expect(dialog(page).getByRole('heading', { level: 2 })).toHaveText(warning);
  await expect(dialog(page).getByRole('button', { name: 'Go back' })).toBeVisible();
  await expect(dialog(page).getByRole('button', { name: 'Record in cash anyway' })).toBeVisible();
});

Then('the Payment is not recorded', async ({ page }) => {
  await expect(dialog(page)).toBeHidden();
  await expect(page).toHaveURL(/\/payments\/new\?/);
  await expect(recordPayment(page)).toBeEnabled();
});

Then('the Receipt page opens', async ({ page }) => {
  await expect(page).toHaveURL(/\/payments\/\d+\/receipt$/);
  await expect(page.getByText('Payment receipt')).toBeVisible();
});

Then(
  'a Payment of {money} on it on {day} is refused: {string}',
  async ({ lender }, amount: Money, day: Day, reason: string) => {
    expect(await lender.refusal('post', '/api/payments', cashPayment(lender, amount, day))).toBe(reason);
  },
);

Then('a Payment of {money} on it on {day} is refused as more than it owed then', async ({ lender }, amount: Money, day: Day) => {
  expect(await lender.refusal('post', '/api/payments', cashPayment(lender, amount, day))).toBe(await overpaid(lender, day));
});

Then('the Preview says it would be more than it owed on {day}', async ({ page, lender }, day: Day) => {
  await expect(page.locator('.status.error')).toHaveText(await overpaid(lender, day));
});

/** A cash Payment of `amount`, all of it to the scenario's Mortgage, on `day`. */
function cashPayment(lender: Lender, amount: Money, day: Day) {
  return {
    customer_id: lender.customer!.id,
    paid_on: day.iso,
    amount: amount.paise,
    method: 'cash',
    allocations: [{ mortgage_id: lender.mortgage!.id, amount: amount.paise }],
  };
}
