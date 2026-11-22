import { expect } from '@playwright/test';
import { Given, Then, When } from './fixtures';

// Dialogs beyond what common.steps.ts closes and confirms: focus, and the reason dialog.

const reason = (page: import('@playwright/test').Page) => page.getByRole('dialog').getByLabel('Reason (kept on record)');
const voidPayment = (page: import('@playwright/test').Page) => page.getByRole('dialog').getByRole('button', { name: 'Void Payment' });

Given('the app refuses to void a Payment, saying {string}', async ({ page }, why: string) => {
  await page.route('**/api/payments/*/void', (route) => route.fulfill({ status: 409, json: { detail: why } }));
});

When('presses Enter', async ({ page }) => {
  await page.keyboard.press('Enter');
});

When('the Lender types the reason {string}', async ({ page }, text: string) => {
  await reason(page).fill(text);
});

When('presses Void Payment', async ({ page }) => {
  await voidPayment(page).click();
});

Then("the dialog's Cancel button is focused", async ({ page }) => {
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Cancel' })).toBeFocused();
});

Then('Void Payment cannot be pressed', async ({ page }) => {
  await expect(voidPayment(page)).toBeDisabled();
});

Then('Void Payment can be pressed', async ({ page }) => {
  await expect(voidPayment(page)).toBeEnabled();
});

Then('the dialog is still open', async ({ page }) => {
  await expect(page.getByRole('dialog')).toBeVisible();
});

Then('the reason still reads {string}', async ({ page }, text: string) => {
  await expect(reason(page)).toHaveValue(text);
});
