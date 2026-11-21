import { expect, type Page } from '@playwright/test';
import type { DataTable } from 'playwright-bdd';
import { Given, Then, When, type Day, type Money } from './fixtures';
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
  async ({ page, lender }, heading: string, part: Money, days: DataTable) => {
    const preview = page.getByRole('region', { name: `Advance on ${lender.mortgage!.name}` });
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
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel this Advance Instalment' }).click();
});

Then('the page shows the Receipt for the part due {day}', async ({ page }, due: Day) => {
  await expect(page.getByRole('heading', { name: `Receipt for the part due ${due.shown}` })).toBeVisible();
});
