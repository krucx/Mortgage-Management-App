import { expect, type Page } from '@playwright/test';
import type { DataTable } from 'playwright-bdd';
import { Given, Then, When, type Day, type Money } from './fixtures';
import type { Lender } from './lender';
import { shownINR } from './shown';

// The Grace Period on the payment form (the Last Accrual Date's colour, its "Date it"
// choices and tooltip), a Grace Payment where it shows afterwards, and what the app refuses.
// Every figure let off is the one the app works out for the draft (POST /api/payments/grace-offer),
// never a number of its own: hand-computed figures belong to the canonical scenarios.

type Offer = { paid_on: string; let_off: number };

/** A date as the Grace choices spell it: "4 Oct 2025" → "4 Oct". */
const dayMonth = (day: Day) => day.shown.replace(/ \d{4}$/, '');

/** The Grace the app offers a cash Payment of `total` paise received on the scenario's day,
 * shared equally by the Customer's Active Mortgages. */
async function offersFor(lender: Lender, total: number): Promise<Offer[]> {
  const { items } = await lender.get('/api/mortgages', {
    customer_id: String(lender.customer!.id),
    status: 'active',
    as_of: lender.day!,
    paged: 'false',
  });
  return lender.post('/api/payments/grace-offer', {
    customer_id: lender.customer!.id,
    paid_on: lender.day,
    amount: total,
    method: 'cash',
    allocations: items.map((m: { id: number }) => ({ mortgage_id: m.id, amount: total / items.length })),
  });
}

async function offerDated(lender: Lender, total: Money, day: Day): Promise<Offer> {
  const offer = (await offersFor(lender, total.paise)).find((o) => o.paid_on === day.iso);
  expect(offer, `the app offers no Grace dated ${day.shown} for ${total.shown}`).toBeDefined();
  return offer!;
}

function allocationRow(page: Page, mortgage: string) {
  return page.getByRole('row', { name: new RegExp(`Include ${mortgage}`) });
}

function graceTip(page: Page) {
  return page.locator('.reason-tip.grace');
}

/** What a Grace Payment's date reads like on its page, Ledger and the like. */
const graced = (paid: Day, received: Day, letOff: number) =>
  `${paid.shown} · received ${received.shown} · Grace, ${shownINR(letOff)} let off`;

/** What the Payment the scenario opened let off, in paise: as saved, on all its Mortgages. */
async function letOffBy(lender: Lender): Promise<number> {
  const payment = await lender.get(`/api/payments/${lender.payment!.id}`);
  return payment.allocations.reduce((sum: number, a: { let_off: number | null }) => sum + (a.let_off ?? 0), 0);
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Given

Given(
  'paid {money} on it on {day} as a Grace Payment received on {day}',
  async ({ lender }, amount: Money, paid: Day, received: Day) => {
    lender.payment = await lender.post(
      '/api/payments',
      {
        customer_id: lender.customer!.id,
        paid_on: paid.iso,
        received_on: received.iso,
        amount: amount.paise,
        method: 'cash',
        allocations: [{ mortgage_id: lender.mortgage!.id, amount: amount.paise }],
      },
      received.iso,
    );
  },
);

Given('the Grace Period is set to none', async ({ page }) => {
  // The Grace Period is one setting for the whole book: changing it for real would change
  // the Grace every scenario running alongside offers. So this browser reads it as none,
  // and the app's offers as none too.
  await page.route('**/api/settings/grace-period', (route) => route.fulfill({ json: { grace_period_days: null } }));
  await page.route('**/api/payments/grace-offer', (route) => route.fulfill({ json: [] }));
});

// The payment form

When('the Lender chooses to date it {day} for {mortgage}', async ({ page }, day: Day, mortgage: string) => {
  await allocationRow(page, mortgage).getByRole('button', { name: new RegExp(`^Date it ${dayMonth(day)}`) }).click();
});

Then(
  'the Last Accrual Date of {mortgage} reads {string}, within the Grace Period',
  async ({ page }, mortgage: string, date: string) => {
    const accrual = allocationRow(page, mortgage).locator('.accrual');
    await expect(accrual).toHaveText(date);
    await expect(accrual).toHaveClass(/\bin-grace\b/);
  },
);

Then(
  'the Last Accrual Date of {mortgage} reads {string}, past the Grace Period',
  async ({ page }, mortgage: string, date: string) => {
    const accrual = allocationRow(page, mortgage).locator('.accrual');
    await expect(accrual).toHaveText(date);
    await expect(accrual).toHaveClass(/\bpast-grace\b/);
  },
);

Then('the Last Accrual Date of {mortgage} reads {string}, in no colour', async ({ page }, mortgage: string, date: string) => {
  const accrual = allocationRow(page, mortgage).locator('.accrual');
  await expect(accrual).toHaveText(date);
  await expect(accrual).toHaveAttribute('class', 'accrual');
});

Then('no Grace is offered', async ({ page }) => {
  await expect(page.getByRole('columnheader', { name: 'Last Accrual Date' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Date it / })).toHaveCount(0);
  await expect(graceTip(page)).toHaveCount(0);
});

Then(
  '{mortgage} offers to date it {day}, letting off what the app works out for {money}',
  async ({ page, lender }, mortgage: string, day: Day, total: Money) => {
    const offer = await offerDated(lender, total, day);
    await expect(allocationRow(page, mortgage).getByRole('button', { name: `Date it ${dayMonth(day)} · ${shownINR(offer.let_off)} let off` })).toBeVisible();
  },
);

Then('the Lender is told Grace lets off something, and to choose a date under Last Accrual Date', async ({ page }) => {
  await expect(page.locator('.hint', { hasText: 'lets off something: choose a date under Last Accrual Date.' })).toBeVisible();
});

Then('the Payment is dated {day} and received {day}', async ({ page }, paid: Day, received: Day) => {
  await expect(page.getByLabel('Date received')).toHaveValue(paid.iso);
  await expect(page.locator('.hint', { hasText: `Dated ${dayMonth(paid)}, received ${dayMonth(received)}` })).toBeVisible();
});

Then('the Payment is dated {day} with no Grace', async ({ page }, paid: Day) => {
  await expect(page.getByLabel('Date received')).toHaveValue(paid.iso);
  await expect(page.locator('.hint', { hasText: /^Dated .*, received / })).toHaveCount(0);
});

Then('Date it {day} is not offered for {mortgage}', async ({ page }, day: Day, mortgage: string) => {
  const choice = allocationRow(page, mortgage).getByRole('button', { name: new RegExp(`^Date it ${dayMonth(day)}`) });
  await expect(choice).toBeDisabled();
  await expect(choice).toHaveAttribute('title', 'Dated then, this Payment lets off nothing');
});

When('the Lender looks at the Grace tip', async ({ page }) => {
  await graceTip(page).hover();
  await expect(graceTip(page).getByRole('tooltip')).toBeVisible();
});

Then("the Grace tip shows each Mortgage's Accrual Date:", async ({ page }, accruals: DataTable) => {
  const calc = graceTip(page).getByRole('tooltip').locator('.grace-calc > span');
  const rows = accruals.raw();
  await expect(calc).toHaveCount(rows.length * 2);
  for (const [mortgage, accrual] of rows) {
    // Each Mortgage's name, then its Accrual Date beside it.
    const name = calc.filter({ hasText: new RegExp(`^${escaped(mortgage)}$`) });
    await expect(name.locator('xpath=following-sibling::span[1]')).toHaveText(accrual);
  }
});

Then(
  'the Grace tip offers, letting off what the app works out for {money}:',
  async ({ page, lender }, total: Money, choices: DataTable) => {
    const offers = await offersFor(lender, total.paise);
    const lines = graceTip(page).getByRole('tooltip').locator('.grace-choice-line');
    const rows = choices.raw();
    expect(offers).toHaveLength(rows.length);
    await expect(lines).toHaveCount(rows.length);
    for (const [i, [choice]] of rows.entries()) {
      await expect(lines.nth(i)).toHaveText(`${choice} · ${shownINR(offers[i].let_off)} let off`);
    }
  },
);

Then(
  'the confirmation lists a Grace of what dating {money} {day} lets off',
  async ({ page, lender }, total: Money, day: Day) => {
    const offer = await offerDated(lender, total, day);
    const row = page.getByRole('dialog').locator('.summary-row', { has: page.getByRole('term').getByText('Grace', { exact: true }) });
    await expect(row.getByRole('definition')).toHaveText(`${shownINR(offer.let_off)} let off`);
  },
);

// What the app refuses

Then(
  'a Payment of {money} received on {day} and dated {day} is refused: {string}',
  async ({ lender }, amount: Money, received: Day, paid: Day, reason: string) => {
    const refused = await lender.refusal('post', '/api/payments', {
      customer_id: lender.customer!.id,
      paid_on: paid.iso,
      received_on: received.iso,
      amount: amount.paise,
      method: 'cash',
      allocations: [{ mortgage_id: lender.mortgage!.id, amount: amount.paise }],
    });
    expect(refused).toBe(reason);
  },
);

Then(
  'a Payment of only an Advance of {money} over {int} months received on {day} and dated {day} is refused: {string}',
  async ({ lender }, advance: Money, months: number, received: Day, paid: Day, reason: string) => {
    const refused = await lender.refusal('post', '/api/payments', {
      customer_id: lender.customer!.id,
      paid_on: paid.iso,
      received_on: received.iso,
      amount: advance.paise,
      method: 'cash',
      allocations: [{ mortgage_id: lender.mortgage!.id, amount: 0, advance: advance.paise, months }],
    });
    expect(refused).toBe(reason);
  },
);

// A Grace Payment, where it shows

Then(
  'the Payment page dates it {day}, received {day}, with what it let off',
  async ({ page, lender }, paid: Day, received: Day) => {
    const date = page.locator('dt').filter({ hasText: /^Date$/ }).locator('xpath=following-sibling::dd[1]');
    await expect(date).toHaveText(graced(paid, received, await letOffBy(lender)));
  },
);

Then(
  'the Receipt says it was received on {day}, counted as paid on {day}',
  async ({ page }, received: Day, paid: Day) => {
    await expect(page.locator('section.receipt')).toContainText(`Received ${received.shown}, counted as paid on ${paid.shown} (Grace)`);
  },
);

Then('the Receipt lets off what the Payment did, Mortgage by Mortgage', async ({ page, lender }) => {
  const payment = await lender.get(`/api/payments/${lender.payment!.id}`);
  await expect(page.getByRole('columnheader', { name: 'Let off (Grace)' })).toBeVisible();
  for (const allocation of payment.allocations) {
    await expect(page.locator('section.receipt td.num', { hasText: new RegExp(`^${escaped(shownINR(allocation.let_off))}$`) }).first()).toBeVisible();
  }
});

Then('its Ledger dates its Grace Payment {day}, received {day}, with what it let off', async ({ page, lender }, paid: Day, received: Day) => {
  const { graces } = await lender.get(`/api/mortgages/${lender.mortgage!.id}`);
  expect(graces).toHaveLength(1);
  await expect(page.getByRole('row', { name: new RegExp(escaped(graced(paid, received, graces[0].let_off))) })).toBeVisible();
});

Then(
  'Favours Given lists the Grace of {string} dated {day}, received {day}, with what it let off',
  async ({ page, lender }, jewellery: string, paid: Day, received: Day) => {
    const row = page
      .getByRole('table', { name: 'Favours Given' })
      .getByRole('row', { name: new RegExp(`^${paid.shown} \\(received ${dayMonth(received)}\\) ${jewellery} Grace `) });
    await expect(row.getByRole('cell').last()).toHaveText(shownINR(await letOffBy(lender)));
  },
);
