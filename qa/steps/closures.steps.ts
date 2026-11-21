import { expect, type Locator, type Page } from '@playwright/test';
import { Given, Then, When, type Day, type Money } from './fixtures';
import type { Lender } from './lender';
import { shownINR } from './shown';

// Closing (Redeem, Waive off, Forfeit) and reopening the Mortgage the scenario has open.

/** The Closure form on the Mortgage page, and its quote and fields. */
const panel = (page: Page) => page.locator('.close-panel');
const saveClosure = (page: Page) => panel(page).locator('button[type=submit]');
const row = (page: Page, label: string) =>
  panel(page).locator('.summary-row', { has: page.getByRole('term').getByText(label, { exact: true }) });

type Quote = {
  principal: number;
  unpaid_interest: number;
  interest_to_date: number;
  total: number;
  advance_held: number;
  to_pay: number;
};

/** The quote for closing the scenario's Mortgage on `day`, as the backend works it out. */
const quoteOn = (lender: Lender, day: string): Promise<Quote> =>
  lender.get(`/api/mortgages/${lender.mortgage!.id}/outstanding-on-closure`, { on: day });

/** The quote for the date the form holds. */
async function quoted(page: Page, lender: Lender) {
  return quoteOn(lender, await panel(page).locator('input[type=date]').inputValue());
}

/** What a rupee field holds, in paise. */
async function heldIn(field: Locator) {
  return Math.round(Number(await field.inputValue()) * 100);
}

const receivedNow = (page: Page) => page.getByRole('spinbutton', { name: /^Received now/ });
const recoveredAmount = (page: Page) => page.getByRole('spinbutton', { name: /^Recovered Amount/ });

When('the Lender starts to redeem it', async ({ page }) => {
  await page.getByRole('button', { name: 'Redeem…' }).click();
});

Then('the Redemption takes off the {money} Advance held', async ({ page }, advance: Money) => {
  await expect(page.getByText(`− ${advance.shown}`)).toBeVisible();
});

When('the Lender redeems it with a final Payment by UPI', async ({ page }) => {
  await page.getByLabel('Final Payment method').selectOption({ label: 'UPI' });
  await page.getByRole('button', { name: /^Redeem for ₹/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm Redemption' }).click();
});

Then('its Closure reads {string}', async ({ page }, text: string) => {
  await expect(page.locator('.close-panel')).toContainText(text);
});

When('the Lender reopens it because {string}', async ({ page }, reason: string) => {
  await page.getByRole('button', { name: 'Reopen…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason (kept on record)').fill(reason);
  await dialog.getByRole('button', { name: 'Reopen' }).click();
});

Then('it is Active', async ({ page, lender }) => {
  await expect(page.getByRole('heading', { name: `${lender.mortgage!.name} active` })).toBeVisible();
});

// The quote

When('the Lender chooses {day} as the Closure date', async ({ page }, day: Day) => {
  await panel(page).locator('input[type=date]').fill(day.iso);
});

Then('the quote is what the app works out for {day}', async ({ page, lender }, day: Day) => {
  const quote = await quoteOn(lender, day.iso);
  await expect(row(page, 'Principal').getByRole('definition')).toHaveText(shownINR(quote.principal));
  await expect(row(page, 'Unpaid interest').getByRole('definition')).toHaveText(shownINR(quote.unpaid_interest));
  await expect(row(page, 'Interest to Date').getByRole('definition')).toContainText(shownINR(quote.interest_to_date));
  await expect(row(page, `Outstanding on ${day.shown}`).getByRole('definition')).toHaveText(shownINR(quote.total));
});

Then('the quote shows an Advance held to take off, and what is left "To pay"', async ({ page, lender }) => {
  const quote = await quoted(page, lender);
  expect(quote.advance_held).toBeGreaterThan(0);
  await expect(row(page, 'Advance held').getByRole('definition')).toHaveText(`− ${shownINR(quote.advance_held)}`);
  await expect(row(page, 'To pay').getByRole('definition')).toHaveText(shownINR(quote.to_pay));
});

// Redeeming

When('pays the final Payment by UPI with the reference {string}', async ({ page }, reference: string) => {
  await page.getByLabel('Final Payment method').selectOption({ label: 'UPI' });
  await page.getByLabel('Reference (optional)').fill(reference);
});

When('the Lender saves the Closure', async ({ page }) => {
  await saveClosure(page).click();
});

When('the Lender confirms the Closure', async ({ page }) => {
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /^Confirm (Redemption|Waiver|Forfeiture)$/ }).click();
  await expect(dialog).toBeHidden();
});

Then('the Lender is warned of the final Payment in cash', async ({ page, lender }) => {
  const { to_pay } = await quoted(page, lender);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { level: 2 })).toHaveText(`${shownINR(to_pay)} in cash`);
  await expect(dialog.getByRole('button', { name: 'Go back' })).toBeVisible();
});

When('the Lender opens its Final Payment from the Closure', async ({ page, lender }) => {
  await panel(page).getByRole('link', { name: /\(receipt\)$/ }).click();
  await expect(page).toHaveURL(/\/payments\/\d+$/);
  lender.payment = { id: Number(page.url().split('/').pop()) };
});

Then('the Payment is of what the Closure paid', async ({ page, lender }) => {
  const { closure } = await lender.get(`/api/mortgages/${lender.mortgage!.id}`);
  await expect(page.getByRole('heading', { name: `Payment of ${shownINR(closure.payment_amount)}` })).toBeVisible();
});

Then('its Closure lists {string} at {string}', async ({ page }, label: string, value: string) => {
  await expect(row(page, label).getByRole('definition')).toHaveText(value);
});

// Waiving off

When('the Lender starts to waive it off', async ({ page }) => {
  await page.getByRole('button', { name: 'Waive off…' }).click();
});

When('the Lender enters {money} as received now', async ({ page }, amount: Money) => {
  await receivedNow(page).fill(amount.typed);
});

When('the Lender enters what is owed as received now', async ({ page, lender }) => {
  await receivedNow(page).fill(String((await quoted(page, lender)).to_pay / 100));
});

Then('the Waived off amount is what the Outstanding leaves after what is received', async ({ page, lender }) => {
  const waived = (await quoted(page, lender)).to_pay - (await heldIn(receivedNow(page)));
  await expect(panel(page).locator('.status.warning')).toHaveText(`Waived off: ${shownINR(waived)}`);
});

When('the Lender gives {string} as the reason', async ({ page }, reason: string) => {
  await panel(page).getByLabel('Reason', { exact: true }).fill(reason);
});

Then('their Favours Given lists the Waived Amount on the {string}', async ({ page, lender }, jewellery: string) => {
  const { closure } = await lender.get(`/api/mortgages/${lender.mortgage!.id}`);
  const waived = shownINR(closure.waived_amount);
  const favours = page.getByRole('table', { name: 'Favours Given' });
  await expect(favours.getByRole('row', { name: new RegExp(`${jewellery} Waived off ${waived}$`) })).toBeVisible();
  await expect(favours.getByRole('row', { name: `Total ${waived}` })).toBeVisible();
});

// Forfeiting

When('the Lender starts to forfeit it', async ({ page }) => {
  await page.getByRole('button', { name: 'Forfeit…' }).click();
});

When('the Lender enters {money} as the Recovered Amount', async ({ page }, amount: Money) => {
  await recoveredAmount(page).fill(amount.typed);
});

When('the Lender gives {string} as the note', async ({ page }, note: string) => {
  await panel(page).getByLabel('Note').fill(note);
});

/** Recovered less what the Closure date leaves to pay: the Profit or Loss the app works out. */
async function resultOf(page: Page, lender: Lender) {
  return (await heldIn(recoveredAmount(page))) - (await quoted(page, lender)).to_pay;
}

Then('the result reads as a loss, as the app works it out', async ({ page, lender }) => {
  const result = await resultOf(page, lender);
  expect(result).toBeLessThan(0);
  await expect(panel(page).locator('.status.error', { hasText: `Loss of ${shownINR(-result)}` })).toBeVisible();
});

Then('the result reads as a profit, as the app works it out', async ({ page, lender }) => {
  const result = await resultOf(page, lender);
  expect(result).toBeGreaterThan(0);
  await expect(panel(page).locator('.status.saved', { hasText: `Profit of ${shownINR(result)}` })).toBeVisible();
});

// Reopening

When('the Lender notes its Final Payment', async ({ lender }) => {
  const { closure } = await lender.get(`/api/mortgages/${lender.mortgage!.id}`);
  lender.payment = { id: closure.payment_id };
});

When('the Lender starts to reopen it', async ({ page }) => {
  await page.getByRole('button', { name: 'Reopen…' }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: /^Reopen / })).toBeVisible();
});

Then('the Reopen Preview says its final Payment is voided', async ({ page }) => {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Its final Payment is voided, so it is no longer counted.');
  await expect(dialog.getByRole('heading', { name: 'What changes' })).toBeVisible();
});

Then('the Reopen Preview has no final Payment to void', async ({ page }) => {
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'What changes' })).toBeVisible();
  await expect(dialog).not.toContainText('final Payment');
});

When('the Lender reopens it giving the reason {string}', async ({ page }, reason: string) => {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason (kept on record)').fill(reason);
  await dialog.getByRole('button', { name: 'Reopen', exact: true }).click();
  await expect(dialog).toBeHidden();
});

Then('its final Payment is voided with the reason {string}', async ({ page, lender }, reason: string) => {
  await page.goto(`/payments/${lender.payment!.id}`);
  await expect(page.getByRole('heading', { level: 2, name: /^Payment of .* voided$/ })).toBeVisible();
  await expect(page.getByText(new RegExp(`Voided .*: ${reason}\\. It is kept on record`))).toBeVisible();
});

// Closures made behind the scenes

Given('it was Waived off on {day} with {money} received', async ({ lender }, day: Day, received: Money) => {
  await lender.post(
    `/api/mortgages/${lender.mortgage!.id}/waive`,
    { waived_on: day.iso, method: 'upi', amount_paid: received.paise, note: 'Let off' },
    day.iso,
  );
});

Given('it was Forfeited on {day} recovering {money}', async ({ lender }, day: Day, recovered: Money) => {
  await lender.post(
    `/api/mortgages/${lender.mortgage!.id}/forfeit`,
    { forfeited_on: day.iso, recovered_amount: recovered.paise },
    day.iso,
  );
});

// Refusals

Then('the Closure is refused: {string}', async ({ page }, reason: string) => {
  await expect(panel(page)).toContainText(reason);
  await expect(saveClosure(page)).toBeDisabled();
});

Then('the Closure is refused saying what is owed is covered, to Redeem it instead', async ({ page, lender }) => {
  const { to_pay } = await quoted(page, lender);
  await expect(panel(page)).toContainText(`${shownINR(to_pay)} covers the ${shownINR(to_pay)} owed: Redeem it instead`);
  await expect(saveClosure(page)).toBeDisabled();
});

Then('redeeming it on {day} is refused: {string}', async ({ lender }, day: Day, reason: string) => {
  const refused = await lender.refusal('post', `/api/mortgages/${lender.mortgage!.id}/redeem`, {
    redeemed_on: day.iso,
    method: 'upi',
  });
  expect(refused).toBe(reason);
});

// The Redeem page

When('the Lender opens its Redeem page', async ({ page, lender }) => {
  await page.goto(`/mortgages/${lender.mortgage!.id}/redeem`);
});

Then('the Redeem page is for redeeming it', async ({ page, lender }) => {
  await expect(page.getByRole('heading', { level: 2, name: `Redeem ${lender.mortgage!.name}` })).toBeVisible();
  await expect(panel(page)).toContainText('Redeem this Mortgage');
});

Then('the Redeem page says {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text)).toBeVisible();
});
