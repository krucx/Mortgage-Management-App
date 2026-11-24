import { expect, type Page } from '@playwright/test';
import type { DataTable } from 'playwright-bdd';
import { Given, Then, When, type Day, type Money } from './fixtures';
import type { Lender } from './lender';
import { buttons, tile } from './selectors';

// The payment form's Advance fields, and the Advances panel on a Mortgage page.

/** A row of the Advances panel, named as the screen reads it: an Upcoming part offers
 * Cancel…, a cancelled one its own Receipt. */
function partRow(page: Page, due: string, amount: string, status: string) {
  const action = status === 'Upcoming' ? ' Cancel…' : status.startsWith('Cancelled') ? ' Receipt' : '';
  return page.getByRole('row', { name: `${due} ${amount} ${status}${action}` });
}

/** Opens the Cancel dialog of the Upcoming part due on `due`. */
async function startCancelling(page: Page, due: Day) {
  await page
    .getByRole('row', { name: new RegExp(`^${due.shown} `) })
    .getByRole('button', { name: 'Cancel…' })
    .click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

function received(page: Page) {
  return page.getByRole('spinbutton', { name: /^Amount received/ });
}

function allocationRow(page: Page, mortgage: string) {
  return page.getByRole('row', { name: new RegExp(`Include ${mortgage}`) });
}

When(
  'the Lender starts a Payment from {string} for {mortgage}',
  async ({ page, lender }, name: string, mortgage: string) => {
    lender.customer = await lender.customerNamed(name);
    lender.mortgage = await lender.mortgageNamed(mortgage);
    await page.goto(`/payments/new?customer=${lender.customer.id}&mortgage=${lender.mortgage.id}`);
  },
);

When('enters {money} as the Amount received', async ({ page }, amount: Money) => {
  await received(page).fill(amount.typed);
});

When('the Lender clears the Amount received', async ({ page }) => {
  await received(page).fill('');
});

When(
  'enters an Advance of {money} over {int} months for {mortgage}',
  async ({ page }, amount: Money, months: number, mortgage: string) => {
    const row = allocationRow(page, mortgage);
    await row.getByRole('spinbutton', { name: `Advance for ${mortgage}` }).fill(amount.typed);
    await row.getByRole('combobox', { name: `Months for ${mortgage}` }).selectOption(String(months));
  },
);

Then('{mortgage} is allocated {money}', async ({ page }, mortgage: string, amount: Money) => {
  await expect(allocationRow(page, mortgage).getByRole('cell', { name: amount.shown, exact: true })).toBeVisible();
});

Then('the Amount received is {money}', async ({ page }, amount: Money) => {
  await expect(received(page)).toHaveValue(amount.typed);
});

Then(
  'the preview shows {string} in parts of {money} on:',
  async ({ page }, heading: string, part: Money, days: DataTable) => {
    const preview = page.getByRole('region', { name: heading.split(':')[0] });
    await expect(preview.getByRole('heading')).toHaveText(heading);
    for (const [day] of days.raw()) {
      await expect(preview.getByRole('row', { name: new RegExp(`^${day} ${part.shown} `) })).toBeVisible();
    }
  },
);

When('the Lender records the Payment', async ({ page }) => {
  await page.getByRole('button', { name: 'Record Payment' }).click();
  await page.getByRole('dialog').getByRole('button', { name: buttons.confirmAndSave }).click();
  await expect(page).toHaveURL(/\/payments\/\d+/);
});

Given(
  'paid an Advance of {money} over {int} months on it on {day}',
  async ({ lender }, advance: Money, months: number, day: Day) => {
    await lender.pay(lender.customer!, [{ mortgage: lender.mortgage!, advance: advance.paise, months }], { day: day.iso });
  },
);

Then('it holds an Advance of {money}', async ({ page }, amount: Money) => {
  await expect(tile(page, 'Advance held')).toHaveText(amount.shown);
});

Then('its parts are:', async ({ page }, parts: DataTable) => {
  for (const { due, amount, status } of parts.hashes()) {
    await expect(partRow(page, due, amount, status)).toBeVisible();
  }
});

Then('its part on {day} of {money} is {word}', async ({ page }, due: Day, amount: Money, status: string) => {
  await expect(partRow(page, due.shown, amount.shown, status)).toBeVisible();
});

Then('its Ledger shows Advance Instalment {int} of {int} on {day}', async ({ page }, n: number, of: number, day: Day) => {
  await expect(page.getByRole('row', { name: new RegExp(`^${day.shown} Advance Instalment ${n} of ${of}`) })).toBeVisible();
});

When('the Lender starts to cancel the part on {day}', async ({ page }, due: Day) => {
  await startCancelling(page, due);
});

When('the Lender cancels the part on {day}', async ({ page }, due: Day) => {
  await startCancelling(page, due);
  // Wait for the cancellation to be stored: the next step opens another page.
  const cancelled = page.waitForResponse((r) => r.request().method() === 'POST' && /\/advance-instalments\/\d+\/cancel$/.test(r.url()));
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel this Advance Instalment' }).click();
  expect((await cancelled).ok()).toBe(true);
});

Then('the page shows the Receipt for the part due {day}', async ({ page }, due: Day) => {
  await expect(page.getByRole('heading', { name: `Receipt for the part due ${due.shown}` })).toBeVisible();
});

// Filling, judging and refusing Advances on the payment form

/** The scenario's Customer's Active Mortgage of that name as the form lists it, on the scenario's day. */
async function listed(lender: Lender, name: string) {
  const { items } = await lender.get('/api/mortgages', {
    customer_id: String(lender.customer!.id),
    status: 'active',
    as_of: lender.day!,
    paged: 'false',
  });
  return items.find((m: { name: string }) => m.name === name);
}

function advanceField(page: Page, mortgage: string) {
  return page.getByRole('spinbutton', { name: `Advance for ${mortgage}` });
}

/** What pays the Mortgage in full on the scenario's day: its Outstanding less the Advance held. */
async function toPayInFull(lender: Lender) {
  const mortgage = await lender.get(`/api/mortgages/${lender.mortgage!.id}`);
  return mortgage.outstanding.total - mortgage.advance_held;
}

When('picks {int} months for {mortgage}', async ({ page }, months: number, mortgage: string) => {
  await allocationRow(page, mortgage).getByRole('combobox', { name: `Months for ${mortgage}` }).selectOption(String(months));
});

When('fills the Advance for {mortgage}', async ({ page }, mortgage: string) => {
  await allocationRow(page, mortgage).getByRole('button', { name: /^Fill \d+ ×/ }).click();
});

Then("the Advance for {mortgage} is {int} months' interest", async ({ page, lender }, mortgage: string, months: number) => {
  const { month_interest } = await listed(lender, mortgage);
  await expect(advanceField(page, mortgage)).toHaveValue(String((months * month_interest) / 100));
});

Then('the Amount received is the Advance for {mortgage}', async ({ page }, mortgage: string) => {
  await expect(received(page)).toHaveValue(await advanceField(page, mortgage).inputValue());
});

Then('the schedule for {mortgage} reads {string}', async ({ page }, mortgage: string, verdict: string) => {
  await expect(page.getByRole('region', { name: `Advance on ${mortgage}` })).toContainText(verdict);
});

When('the Lender pays the unpaid interest of {mortgage}', async ({ page }, mortgage: string) => {
  await allocationRow(page, mortgage).getByRole('button', { name: /^Pay the unpaid interest/ }).click();
});

Then('the Amount for {mortgage} is its unpaid interest', async ({ page, lender }, mortgage: string) => {
  const { unpaid_interest } = await listed(lender, mortgage);
  expect(unpaid_interest).toBeGreaterThan(0);
  await expect(page.getByRole('spinbutton', { name: `Amount for ${mortgage}` })).toHaveValue(String(unpaid_interest / 100));
});

Then('the Amount received is its unpaid interest and the Advance of {money}', async ({ page, lender }, advance: Money) => {
  const { unpaid_interest } = await listed(lender, lender.mortgage!.name);
  await expect(received(page)).toHaveValue(String((unpaid_interest + advance.paise) / 100));
});

Then("the Advance for {mortgage} can't be entered: {string}", async ({ page }, mortgage: string, why: string) => {
  await expect(advanceField(page, mortgage)).toBeDisabled();
  await expect(advanceField(page, mortgage)).toHaveAttribute('title', why);
});

Then(
  'a Payment paying the whole of it with an Advance of {money} is refused: {string}',
  async ({ lender }, advance: Money, reason: string) => {
    const whole = await toPayInFull(lender);
    const refusal = await lender.refusal('post', '/api/payments', {
      customer_id: lender.customer!.id,
      paid_on: lender.day,
      amount: whole + advance.paise,
      method: 'upi',
      allocations: [{ mortgage_id: lender.mortgage!.id, amount: whole, advance: advance.paise, months: 2 }],
    });
    expect(refusal).toBe(`${lender.mortgage!.name}: ${reason}`);
  },
);

When('the Lender sets the Amount for {mortgage} to what pays it in full', async ({ page, lender }, mortgage: string) => {
  await page.getByRole('spinbutton', { name: `Amount for ${mortgage}` }).fill(String((await toPayInFull(lender)) / 100));
});

Then('the Preview refuses it, saying {string}', async ({ page }, reason: string) => {
  await expect(page.locator('.status.error')).toContainText(reason);
});

Then('a Payment of {money} on it on {day} is refused, saying {string}', async ({ lender }, amount: Money, day: Day, reason: string) => {
  const refusal = await lender.refusal('post', '/api/payments', {
    customer_id: lender.customer!.id,
    paid_on: day.iso,
    amount: amount.paise,
    method: 'upi',
    allocations: [{ mortgage_id: lender.mortgage!.id, amount: amount.paise }],
  });
  expect(refusal).toContain(reason);
});

// The Advances panel and the Ledger

Then(
  'its Advance received {day} is {money} over {int} months',
  async ({ page }, received: Day, amount: Money, months: number) => {
    await expect(page.getByText(`Received ${received.shown} · ${amount.shown} over ${months} months`)).toBeVisible();
  },
);

Then('its Ledger lists Advance Instalment {int} of {int} due {day} as Upcoming', async ({ page }, n: number, of: number, day: Day) => {
  await expect(page.getByRole('row', { name: new RegExp(`^${day.shown} Advance Instalment ${n} of ${of} Upcoming`) })).toBeVisible();
});

Then('it holds no Advance', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Terms' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Advances' })).toBeHidden();
  await expect(tile(page, 'Advance held')).toBeHidden();
});

Then('its Ledger shows no Advance Instalment', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Terms' })).toBeVisible();
  await expect(page.getByRole('row', { name: /Advance Instalment/ })).toHaveCount(0);
});

// Cancelling parts

When('the Lender keeps it', async ({ page }) => {
  await page.getByRole('dialog').getByRole('button', { name: 'Keep it' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});

When('the Lender opens the Receipt for the part due {day}', async ({ page }, due: Day) => {
  await page.getByRole('row', { name: new RegExp(`^${due.shown} `) }).getByRole('button', { name: 'Receipt' }).click();
});

When('the Lender prints the Receipt for the part', async ({ page }) => {
  await page.getByRole('link', { name: 'Print or save as PDF' }).click();
  await expect(page).toHaveURL(/\/payments\/\d+\/advance-instalments\/\d+\/receipt$/);
});

Then('the printable Receipt says {string}', async ({ page }, heading: string) => {
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
});

/** The id of the Advance Instalment of the scenario's Mortgage due on `due`. */
async function partDue(lender: Lender, due: Day): Promise<number> {
  const { advance_instalments } = await lender.get(`/api/mortgages/${lender.mortgage!.id}`);
  return advance_instalments.find((part: { on: string }) => part.on === due.iso).id;
}

/** The API path that cancels the part of the scenario's Mortgage due on `due`. */
async function cancelPath(lender: Lender, due: Day) {
  return `/api/mortgages/${lender.mortgage!.id}/advance-instalments/${await partDue(lender, due)}/cancel`;
}

Given('its part due {day} was cancelled on {day}', async ({ lender }, due: Day, on: Day) => {
  await lender.post(await cancelPath(lender, due), {}, on.iso);
});

Then('cancelling the part due {day} is refused: {string}', async ({ lender }, due: Day, reason: string) => {
  const refusal = await lender.refusal('post', await cancelPath(lender, due));
  expect(refusal).toBe(reason);
});

Then('waiving it with an Advance is refused', async ({ lender }) => {
  const refusal = await lender.refusal('post', `/api/mortgages/${lender.mortgage!.id}/waive`, {
    waived_on: lender.day,
    amount_paid: 0,
    method: 'cash',
    advance: 100,
  });
  // The Waiver takes no fields beyond its own: the backend names the extra one.
  expect(refusal).toEqual([expect.objectContaining({ type: 'extra_forbidden', loc: ['body', 'advance'] })]);
});
