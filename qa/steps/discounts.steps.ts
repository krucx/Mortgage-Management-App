import { expect, type Page } from '@playwright/test';
import { Given, Then, When, type Day, type Money } from './fixtures';
import type { Lender } from './lender';
import { shownINR } from './shown';

// Discounts: seeding a Payment that holds one, the confirmations it can ask for, what the
// Ledger and Favours Given show of it, and what it can't be recorded beside an Advance.

type Row = { id: number; name: string; outstanding_total: number; advance_held: number };

/** What each Mortgage owed just before the Payment that gave the Discount, by Lender. */
const owedBefore = new WeakMap<Lender, number>();

/** The scenario's Mortgage as the Mortgages list shows it on `day`. */
async function listed(lender: Lender, day = lender.day!): Promise<Row> {
  const { items } = await lender.get('/api/mortgages', { q: lender.mortgage!.name, as_of: day, paged: 'false' });
  return items.find((m: Row) => m.id === lender.mortgage!.id)!;
}

/** The scenario's Mortgage: what pays it in full, less the Advance held. */
const toPay = (m: Row) => m.outstanding_total - m.advance_held;

/** How far over the confirmation limit a large Discount goes: ₹100. */
const OVER_THE_LIMIT = 10_000;

/** A figure typed into a rupee field. */
const typed = (paise: number) => String(paise / 100);

/** "2025-11-15" as the backend's refusals spell a date: "15 Nov 2025". */
function refusedDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

function discountField(page: Page, mortgage: string) {
  return page.getByRole('spinbutton', { name: `Discount for ${mortgage}` });
}

/** Records a Payment of `cash` and `discount`. A sum at the Cash Limit or over goes by UPI:
 * recorded in cash it would raise the Cash Limit's warning in every Payment Preview another
 * scenario takes meanwhile, as the Preview counts the cash written since it began. */
async function pay(lender: Lender, day: Day, cash: number, discount: number, method: 'cash' | 'upi' = 'cash') {
  owedBefore.set(lender, (await listed(lender, day.iso)).outstanding_total);
  lender.payment = await lender.post(
    '/api/payments',
    {
      customer_id: lender.customer!.id,
      paid_on: day.iso,
      amount: cash,
      method,
      allocations: [{ mortgage_id: lender.mortgage!.id, amount: cash, discount }],
    },
    day.iso,
  );
}

Given('paid {money} and a Discount of {money} on it on {day}', async ({ lender }, cash: Money, discount: Money, day: Day) => {
  await pay(lender, day, cash.paise, discount.paise);
});

Given('paid its full Outstanding less a Discount of {money} on it on {day}', async ({ lender }, discount: Money, day: Day) => {
  const owed = toPay(await listed(lender, day.iso));
  await pay(lender, day, owed - discount.paise, discount.paise, 'upi');
});

Given('the Discount confirmation limit is cleared', async ({ page }) => {
  // The limit is one setting for the whole book: clearing it for real would change what
  // every scenario running alongside is asked. The backend marks a Discount over it in
  // each Payment Preview, so this browser sees none marked.
  await page.route('**/api/payments/preview', async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    for (const mortgage of body.mortgages ?? []) mortgage.over_threshold = false;
    await route.fulfill({ response, json: body });
  });
});

When('enters a Discount over the confirmation limit for {mortgage}', async ({ page, lender }, mortgage: string) => {
  const { discount_confirmation_limit: limit } = await lender.get('/api/settings/discount-confirmation-limit');
  expect(limit, 'a confirmation limit to go over').not.toBeNull();
  await discountField(page, mortgage).fill(typed(limit + OVER_THE_LIMIT));
});

When(
  'the Lender pays the full Outstanding less a Discount of {money} for {mortgage}',
  async ({ page, lender }, discount: Money, mortgage: string) => {
    const owed = toPay(await listed(lender));
    await page.getByRole('spinbutton', { name: /^Amount received/ }).fill(typed(owed - discount.paise));
    await discountField(page, mortgage).fill(discount.typed);
  },
);

Then('the Record Payment button reads {string}', async ({ page }, label: string) => {
  await expect(page.getByRole('button', { name: /^Record Payment/ })).toHaveText(label);
});

Then(
  'the Lender is asked to confirm a Discount over the limit, listing that Discount for {mortgage}',
  async ({ page, lender }, mortgage: string) => {
    const { discount_confirmation_limit: limit } = await lender.get('/api/settings/discount-confirmation-limit');
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(`Confirm a Discount over ${shownINR(limit)}?`);
    await expect(dialog.locator('.summary-row', { hasText: mortgage })).toContainText(shownINR(limit + OVER_THE_LIMIT));
  },
);

When('the Lender keeps editing', async ({ page }) => {
  await page.getByRole('dialog').getByRole('button', { name: 'Keep editing' }).click();
});

When('the Lender continues', async ({ page }) => {
  await page.getByRole('dialog').getByRole('button', { name: 'Continue' }).click();
});

Then(
  'the Lender is offered to reduce the Discount of {money} for {mortgage} to what is left after {money} cash',
  async ({ page, lender }, discount: Money, mortgage: string, cash: Money) => {
    const left = (await listed(lender)).outstanding_total - cash.paise;
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { level: 2 })).toHaveText('Reduce Discount to the remaining balance?');
    await expect(dialog.locator('.summary-row', { hasText: mortgage })).toContainText(`${discount.shown} → ${shownINR(left)}`);
  },
);

When('the Lender reduces the Discount', async ({ page }) => {
  await page.getByRole('dialog').getByRole('button', { name: 'Reduce and continue' }).click();
});

Then('the Discount for {mortgage} is what is left after {money} cash', async ({ page, lender }, mortgage: string, cash: Money) => {
  const left = (await listed(lender)).outstanding_total - cash.paise;
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect.poll(async () => Math.round(Number(await discountField(page, mortgage).inputValue()) * 100)).toBe(left);
});

Then("its Ledger shows the Payment's Discount of {money}, split between interest and Principal", async ({ page, lender }, discount: Money) => {
  const { ledger } = await lender.get(`/api/mortgages/${lender.mortgage!.id}`);
  const steps = ledger.filter((s: { event: string; discount: number }) => s.event === 'payment' && s.discount > 0);
  expect(steps).toHaveLength(1);
  const [step] = steps;
  expect(step.discount).toBe(discount.paise);
  expect(step.discount_interest_paid + step.discount_principal_paid).toBe(step.discount);
  const split = `${shownINR(step.discount_interest_paid)} Discount to interest, ${shownINR(step.discount_principal_paid)} Discount to Principal`;
  const row = page.locator('tr.ledger-payment', { hasText: split });
  await expect(row.getByRole('cell').nth(3)).toHaveText(discount.shown);
});

Then('its Ledger has no Payment', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  await expect(page.locator('tr.ledger-payment')).toHaveCount(0);
});

Then('it owes what it did before that Payment', async ({ lender }) => {
  expect((await listed(lender)).outstanding_total).toBe(owedBefore.get(lender));
});

Then('their Favours Given lists a Discount of {money} on the {string}', async ({ page }, discount: Money, jewellery: string) => {
  const favours = page.getByRole('table', { name: 'Favours Given' });
  await expect(favours.getByRole('row', { name: new RegExp(`${jewellery} Discount ${discount.shown}$`) })).toBeVisible();
  await expect(favours.getByRole('row', { name: `Total ${discount.shown}` })).toBeVisible();
});

Then('their page lists no Favours Given', async ({ page, lender }) => {
  await expect(page.getByRole('heading', { name: lender.customer!.name, level: 2 })).toBeVisible();
  // Favours Given is a separate query: nothing shows while it loads, as when there are none.
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: 'Favours Given' })).toHaveCount(0);
});

// An Advance beside a Discount

Then('the Preview says {string}', async ({ page }, reading: string) => {
  await expect(page.locator('.status.error')).toHaveText(reading);
});

Then('the Payment can be recorded', async ({ page }) => {
  await expect(page.getByRole('button', { name: /^Record Payment/ })).toBeEnabled();
});

When('enters a Discount leaving {money} owed for {mortgage}', async ({ page, lender }, left: Money, mortgage: string) => {
  await discountField(page, mortgage).fill(typed((await listed(lender)).outstanding_total - left.paise));
});

/** A cash-free Payment of a Discount that leaves `left` owed, and an Advance if given. */
async function discountOnly(lender: Lender, left: Money, advance?: { amount: Money; months: number }) {
  const discount = (await listed(lender)).outstanding_total - left.paise;
  return {
    customer_id: lender.customer!.id,
    paid_on: lender.day!,
    amount: advance?.amount.paise ?? 0,
    method: 'cash',
    allocations: [
      { mortgage_id: lender.mortgage!.id, amount: 0, discount, ...(advance && { advance: advance.amount.paise, months: advance.months }) },
    ],
  };
}

Then(
  'a Payment with an Advance of {money} over {int} months and a Discount leaving {money} owed is refused: {string}',
  async ({ lender }, advance: Money, months: number, left: Money, reason: string) => {
    expect(await lender.refusal('post', '/api/payments', await discountOnly(lender, left, { amount: advance, months }))).toBe(reason);
  },
);

/** What the app says of a Discount leaving `left` owed beside Advance Instalments still
 * upcoming that hold `held`: the most it can take, and the latest part to cancel first. */
async function holdingTooMuch(lender: Lender, held: Money, left: Money, part: Day, pays: Money) {
  const taking = (await listed(lender)).outstanding_total - left.paise;
  return (
    `${lender.mortgage!.name}: this would leave its upcoming Advance Instalments holding ${held.shown}, ` +
    `more than the ${left.shown} it would owe on ${refusedDay(lender.day!)}. ` +
    `Take at most ${shownINR(taking - (held.paise - left.paise))}, or cancel the Advance Instalments on ${refusedDay(part.iso)} first, ` +
    `which pay ${pays.shown} of it at once, and take that much less`
  );
}

Then(
  'the Preview says the Advance Instalments would hold {money}, more than the {money} it would owe; cancel the part on {day} first, which pays {money}',
  async ({ page, lender }, held: Money, left: Money, part: Day, pays: Money) => {
    await expect(page.locator('.status.error')).toHaveText(await holdingTooMuch(lender, held, left, part, pays));
  },
);

Then(
  'a Discount leaving {money} owed is refused: the Advance Instalments would hold {money}; cancel the part on {day} first, which pays {money}',
  async ({ lender }, left: Money, held: Money, part: Day, pays: Money) => {
    expect(await lender.refusal('post', '/api/payments', await discountOnly(lender, left))).toBe(
      await holdingTooMuch(lender, held, left, part, pays),
    );
  },
);
