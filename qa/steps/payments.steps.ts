import { expect } from '@playwright/test';
import type { DataTable } from 'playwright-bdd';
import { Given, Then, When, type Day, type Money } from './fixtures';

// Payments, their Receipts and Voids.

Given('paid {money} on it on {day}', async ({ lender }, amount: Money, day: Day) => {
  await lender.pay(lender.customer!, [{ mortgage: lender.mortgage!, cash: amount.paise }], { day: day.iso });
});

Then('it has a Receipt', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Receipt' })).toBeVisible();
});

Then(
  'its Receipt is addressed to {string} and names the {string}',
  async ({ page }, customer: string, jewellery: string) => {
    await expect(page.getByRole('heading', { name: 'Receipt' })).toBeVisible();
    const receipt = page.locator('.receipt-panel');
    await expect(receipt).toContainText(`Namaste ${customer}`);
    await expect(receipt).toContainText(jewellery);
  },
);

Then('its Receipt does not name {mortgage}', async ({ page }, mortgage: string) => {
  await expect(page.locator('.receipt-panel')).not.toContainText(mortgage);
});

When('the Lender prints the Receipt', async ({ page }) => {
  await page.getByRole('link', { name: 'Print or save as PDF' }).click();
  await expect(page).toHaveURL(/\/payments\/\d+\/receipt$/);
  await expect(page.getByText('Payment receipt')).toBeVisible();
});

Then('the printable Receipt lists:', async ({ page }, lines: DataTable) => {
  for (const [line] of lines.raw()) {
    await expect(page.getByText(line)).toBeVisible();
  }
});

When('the Lender voids it because {string}', async ({ page }, reason: string) => {
  await page.getByRole('button', { name: 'Void…' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason (kept on record)').fill(reason);
  await dialog.getByRole('button', { name: 'Void Payment' }).click();
});

Then('it shows {string} with the reason {string}', async ({ page }, heading: string, reason: string) => {
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  await expect(page.getByText(new RegExp(`Voided .*: ${reason}\\. It is kept on record`))).toBeVisible();
});

Then('it has no Receipt and cannot be voided again', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Receipt' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Void…' })).toBeHidden();
});
