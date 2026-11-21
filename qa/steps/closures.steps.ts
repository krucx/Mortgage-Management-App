import { expect } from '@playwright/test';
import { Then, When, type Money } from './fixtures';

// Redeeming and reopening the Mortgage the scenario has open.

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
