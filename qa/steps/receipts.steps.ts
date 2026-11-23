import { expect, type Page } from '@playwright/test';
import { Given, Then, When, type Day, type Money } from './fixtures';
import type { Lender } from './lender';
import { newPhone } from './lender';
import { addCustomer, customerNamed } from './people';
import { shownINR } from './shown';
import { printableReceipt, whatsAppBubble } from './selectors';

// What a Payment's page, Receipt and Void show: its Allocations, the Receipt panel and its
// WhatsApp link, the printable Receipt, the Void dialog and what the app refuses to void.
// Figures are the ones the app holds (its API), never numbers of their own.

type Allocation = { mortgage_name: string; let_off: number | null };
type ReceiptLine = { description: string; paid: number; discount: number };
type Receipt = { text: string; phones: string[]; total_owed: number; lines: ReceiptLine[] };

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Text with its runs of whitespace as one space, as a bubble and the message compare. */
const flat = (text: string) => text.replace(/\s+/g, ' ').trim();

function receiptOf(lender: Lender): Promise<Receipt> {
  return lender.get(`/api/payments/${lender.payment!.id}/receipt`);
}

function bubble(page: Page) {
  return whatsAppBubble(page.locator('.receipt-panel'));
}

const printable = printableReceipt;

/** The Customer's numbers, primary first. */
async function numbersOf(lender: Lender): Promise<string[]> {
  const { phone_1, phone_2 } = await lender.get(`/api/customers/${lender.customer!.id}`);
  return [phone_1, phone_2].filter(Boolean);
}

/** The links the page asked window.open for, since the steps below stubbed it. */
function opened(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { opened: string[] }).opened);
}

/** The one Payment of the Customer the scenario is working on, found by `matches`. */
async function paymentOf(lender: Lender, matches: (payment: { id: number; amount: number }) => boolean) {
  const { items } = await lender.get('/api/payments', { q: lender.customer!.name });
  const found = items.filter(matches);
  if (found.length !== 1) throw new Error(`expected one Payment of ${lender.customer!.name}, found ${found.length}`);
  return found[0] as { id: number };
}

// Given

Given(
  'paid {money} with a Discount of {money} on it on {day}',
  async ({ lender }, cash: Money, discount: Money, day: Day) => {
    lender.payment = await lender.post(
      '/api/payments',
      {
        customer_id: lender.customer!.id,
        paid_on: day.iso,
        amount: cash.paise,
        method: 'cash',
        allocations: [{ mortgage_id: lender.mortgage!.id, amount: cash.paise, discount: discount.paise }],
      },
      day.iso,
    );
  },
);

Given('{string} is a Customer with two contact numbers', async ({ lender }, name: string) => {
  lender.customer = await addCustomer(lender, name, { phone_2: newPhone('7') });
});

Given(
  '{string} was lent {money} on {day} at {int}% a month, simple, with nothing for a part month',
  async ({ lender }, name: string, amount: Money, day: Day, percent: number) => {
    const customer = await lender.addCustomer(name, day.iso);
    lender.mortgage = await lender.post(
      '/api/mortgages',
      {
        customer_id: customer.id,
        start_date: day.iso,
        amount_lent: amount.paise,
        description: 'Gold chain',
        gross_weight_mg: 20_000,
        net_weight_mg: 19_000,
        purity_karat: 22,
        terms: { monthly_rate_bps: percent * 100, interest_mode: 'simple', part_month_rule: 'nothing' },
        lent_through: 'upi',
      },
      day.iso,
    );
  },
);

/** Dormant Mortgages are only left by back-dated Payments: recorded on `entered`, dated `paid`. */
Given(
  'paid {money} on it on {day}, entered on {day}',
  async ({ lender }, amount: Money, paid: Day, entered: Day) => {
    lender.payment = await lender.post(
      '/api/payments',
      {
        customer_id: lender.customer!.id,
        paid_on: paid.iso,
        amount: amount.paise,
        method: 'cash',
        allocations: [{ mortgage_id: lender.mortgage!.id, amount: amount.paise }],
      },
      entered.iso,
    );
  },
);

// The Payment page

When('the Lender records another Payment for the same Customer', async ({ page }) => {
  await page.getByRole('link', { name: 'Record another Payment for same customer' }).click();
  await expect(page).toHaveURL(/\/payments\/new\?customer=\d+$/);
});

/** A column of the Allocations table, by its heading. */
function columnHeading(page: Page, heading: string) {
  return page.getByRole('columnheader', { name: heading, exact: true });
}

Then('its Allocations table has a {string} column', async ({ page }, heading: string) => {
  await expect(page.getByRole('heading', { name: 'Allocations' })).toBeVisible();
  await expect(columnHeading(page, heading)).toBeVisible();
});

Then('its Allocations table has no {string} column', async ({ page }, heading: string) => {
  await expect(page.getByRole('heading', { name: 'Allocations' })).toBeVisible();
  await expect(columnHeading(page, heading)).toHaveCount(0);
});

/** The cell of the Mortgage's row under `heading`. */
async function allocationCell(page: Page, mortgage: string, heading: string) {
  const table = page.getByRole('table').filter({ has: columnHeading(page, 'Allocation') });
  const headings = await table.locator('thead th').allTextContents();
  const row = table.getByRole('row', { name: new RegExp(`^${escaped(mortgage)} `) });
  return row.locator('td').nth(headings.indexOf(heading));
}

Then('its Allocation to {mortgage} shows {money} under {string}', async ({ page }, mortgage: string, amount: Money, heading: string) => {
  await expect(await allocationCell(page, mortgage, heading)).toHaveText(amount.shown);
});

Then(
  'its Allocation to {mortgage} shows what the Payment let off under {string}',
  async ({ page, lender }, mortgage: string, heading: string) => {
    const { allocations } = await lender.get(`/api/payments/${lender.payment!.id}`);
    const { let_off } = allocations.find((a: Allocation) => a.mortgage_name === mortgage);
    expect(let_off).toBeGreaterThan(0);
    await expect(await allocationCell(page, mortgage, heading)).toHaveText(shownINR(let_off));
  },
);

// The Receipt panel and WhatsApp

Then('the WhatsApp preview shows the Receipt the app wrote, with its heading in bold', async ({ page, lender }) => {
  const { text } = await receiptOf(lender);
  await expect(bubble(page).locator('strong').first()).toHaveText('Payment received');
  // As WhatsApp shows it: the *bold* and ```monospace``` markers gone, the words the same.
  const shown = flat(text.replaceAll('```', '').replace(/\*([^*\n]+)\*/g, '$1'));
  await expect.poll(async () => flat(await bubble(page).innerText())).toBe(shown);
});

Then('the preview has a card for each jewellery paid', async ({ page, lender }) => {
  const { lines } = await receiptOf(lender);
  expect(lines.length).toBeGreaterThan(1);
  for (const { description } of lines) {
    await expect(bubble(page).locator('pre', { hasText: description })).toHaveCount(1);
  }
});

Then('the preview names no Mortgage Name', async ({ page, lender }) => {
  const { allocations } = await lender.get(`/api/payments/${lender.payment!.id}`);
  expect(allocations.length).toBeGreaterThan(0);
  await expect(bubble(page)).toBeVisible();
  for (const { mortgage_name } of allocations) {
    await expect(bubble(page)).not.toContainText(mortgage_name);
  }
});

Then('the WhatsApp preview begins {string}', async ({ page }, start: string) => {
  await expect(bubble(page)).toHaveText(new RegExp(`^${escaped(start)}`));
});

When('the Lender sends the Receipt on WhatsApp', async ({ page }) => {
  // The link is what is checked, not WhatsApp itself: window.open is noted, not carried out.
  await page.evaluate(() => {
    const w = window as unknown as { opened: string[] };
    w.opened = [];
    window.open = (url) => {
      w.opened.push(String(url));
      return null;
    };
  });
  await page.getByRole('button', { name: 'Send on WhatsApp' }).click();
});

/** The link WhatsApp was last opened with: its address, the number and the message. */
async function whatsAppLink(page: Page) {
  const links = await opened(page);
  expect(links).toHaveLength(1);
  const link = new URL(links[0]);
  expect(`${link.origin}${link.pathname}`).toBe('https://api.whatsapp.com/send/');
  return link.searchParams;
}

Then(
  'WhatsApp opens on api.whatsapp.com for {string} with the Receipt text',
  async ({ page, lender }, name: string) => {
    const { phone } = await customerNamed(lender, name);
    const link = await whatsAppLink(page);
    expect(link.get('phone')).toBe(`91${phone}`);
    expect(link.get('text')).toBe((await receiptOf(lender)).text);
  },
);

Then('the Lender is told to press Send in WhatsApp', async ({ page }) => {
  await expect(page.getByText('WhatsApp opened: press Send there.')).toBeVisible();
});

Then('the Lender can send the Receipt to either of their numbers', async ({ page, lender }) => {
  const numbers = await numbersOf(lender);
  expect(numbers).toHaveLength(2);
  await expect(page.getByLabel('Send to').locator('option')).toHaveText(numbers);
});

When('the Lender chooses to send to their second number', async ({ page, lender }) => {
  await page.getByLabel('Send to').selectOption((await numbersOf(lender))[1]);
});

Then('WhatsApp opens for their first number', async ({ page, lender }) => {
  expect((await whatsAppLink(page)).get('phone')).toBe(`91${(await numbersOf(lender))[0]}`);
});

Then('WhatsApp opens for their second number', async ({ page, lender }) => {
  const link = await whatsAppLink(page);
  expect(link.get('phone')).toBe(`91${(await numbersOf(lender))[1]}`);
  expect(link.get('text')).toBe((await receiptOf(lender)).text);
});

When('the Lender changes the Receipt template in Settings to {string}', async ({ page }, template: string) => {
  await page.goto('/settings');
  const messages = page.locator('section', { has: page.getByRole('heading', { name: 'WhatsApp messages' }) });
  // The Receipt's is the first of the two templates.
  await messages.locator('textarea').first().fill(template);
  await messages.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(messages.getByText('Saved.')).toBeVisible();
});

// The printable Receipt

Then(
  'the printable Receipt is from {string} for what the Payment received',
  async ({ page, lender }, customer: string) => {
    const { amount } = await lender.get(`/api/payments/${lender.payment!.id}`);
    await expect(printable(page).locator('.summary-row', { hasText: 'Received from' })).toContainText(customer);
    await expect(printable(page).locator('.summary-row', { hasText: 'Amount' })).toContainText(shownINR(amount));
  },
);

Then('the printable Receipt lists the {string}', async ({ page }, jewellery: string) => {
  await expect(printable(page).locator('tbody tr td:first-child', { hasText: new RegExp(`^${escaped(jewellery)}$`) })).toHaveCount(1);
});

Then('the printable Receipt does not name {mortgage}', async ({ page }, mortgage: string) => {
  await expect(printable(page)).toBeVisible();
  await expect(printable(page)).not.toContainText(mortgage);
});

Then('the printable Receipt has the column {string}', async ({ page }, heading: string) => {
  await expect(printable(page).getByRole('columnheader', { name: heading, exact: true })).toBeVisible();
});

Then('the Receipt page is headed {string}', async ({ page }, heading: string) => {
  await expect(printable(page).getByRole('heading', { level: 2 })).toHaveText(heading);
});

Then(
  'the printable Receipt says it was applied on {day}, from the Advance part due {day}',
  async ({ page }, applied: Day, due: Day) => {
    await expect(printable(page)).toContainText(`Applied ${applied.shown}, from the Advance part due ${due.shown}`);
  },
);

Then("the printable Receipt has a line for each of the Payment's Mortgages", async ({ page, lender }) => {
  const { lines } = await receiptOf(lender);
  expect(lines.length).toBeGreaterThan(1);
  await expect(printable(page).locator('tbody tr')).toHaveCount(lines.length);
  for (const { description } of lines) {
    await expect(printable(page).locator('tbody tr td:first-child', { hasText: new RegExp(`^${escaped(description)}$`) })).toHaveCount(1);
  }
});

Then("the printable Receipt's Total is what the Payment paid and what is still owed", async ({ page, lender }) => {
  const { lines, total_owed } = await receiptOf(lender);
  const total = printable(page).locator('tfoot tr');
  await expect(total.getByRole('rowheader')).toHaveText('Total');
  await expect(total.locator('td.num').first()).toHaveText(shownINR(lines.reduce((sum, line) => sum + line.paid, 0)));
  await expect(total.locator('td.num').last()).toHaveText(shownINR(total_owed));
});

When('the Lender opens the Receipt of the part cancelled that was due {day}', async ({ page }, due: Day) => {
  await page.getByRole('row', { name: new RegExp(`^${due.shown} `) }).getByRole('button', { name: 'Receipt' }).click();
  await page.getByRole('link', { name: 'Print or save as PDF' }).click();
  await expect(page).toHaveURL(/\/payments\/\d+\/advance-instalments\/\d+\/receipt$/);
});

// Voiding

When('the Lender starts to void it', async ({ page }) => {
  await page.getByRole('button', { name: 'Void…' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

Then('the Preview shows what the Mortgage owes today, before and after', async ({ page, lender }) => {
  const { mortgages } = await lender.post(`/api/payments/${lender.payment!.id}/void-preview`, {});
  const { before, after } = mortgages[0];
  expect(after.outstanding).toBeGreaterThan(before.outstanding);
  const owed = page.getByRole('dialog').locator('.tile', { has: page.getByText('Owed today', { exact: true }) });
  await expect(owed).toContainText(`${shownINR(before.outstanding)} → ${shownINR(after.outstanding)}`);
});

Then('the Preview lists the Payment on {day} as a Ledger step removed', async ({ page }, day: Day) => {
  await expect(page.getByRole('dialog').getByRole('row', { name: new RegExp(`^${day.shown} Payment \\(removed\\)`) })).toBeVisible();
});

Then('it can still be voided', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Void…' })).toBeVisible();
});

Then('it is badged {string}', async ({ page }, badge: string) => {
  await expect(page.locator('h2 .badge', { hasText: badge })).toBeVisible();
});

// What the app refuses to void

async function voidRefusal(lender: Lender, id: number) {
  return lender.refusal('post', `/api/payments/${id}/void`, { reason: 'Asked of the app directly' });
}

Then('voiding that Payment again is refused: {string}', async ({ lender }, reason: string) => {
  expect(await voidRefusal(lender, lender.payment!.id)).toBe(reason);
});

Then('voiding the Payment that Redeemed it is refused: {string}', async ({ lender }, reason: string) => {
  // Its only Payment: the Final Payment of the Redemption.
  const { id } = await paymentOf(lender, () => true);
  expect(await voidRefusal(lender, id)).toBe(reason);
});

Then('voiding the Payment of {money} is refused: {string}', async ({ lender }, amount: Money, reason: string) => {
  const { id } = await paymentOf(lender, (p) => p.amount === amount.paise);
  expect(await voidRefusal(lender, id)).toBe(reason);
});

// Dormant

async function dormantNames(lender: Lender): Promise<string[]> {
  const { items } = await lender.get('/api/closures/dormant');
  return items.map((m: { name: string }) => m.name);
}

Then('it is Dormant, owing nothing', async ({ lender }) => {
  const mortgage = await lender.get(`/api/mortgages/${lender.mortgage!.id}`);
  expect([mortgage.status, mortgage.outstanding.total]).toEqual(['active', 0]);
  expect(await dormantNames(lender)).toContain(lender.mortgage!.name);
});

Then('it owes again and is no longer Dormant', async ({ lender }) => {
  const mortgage = await lender.get(`/api/mortgages/${lender.mortgage!.id}`);
  expect(mortgage.outstanding.total).toBeGreaterThan(0);
  expect(await dormantNames(lender)).not.toContain(lender.mortgage!.name);
});
