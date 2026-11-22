import { expect } from '@playwright/test';
import type { DataTable } from 'playwright-bdd';
import { Given, Then, When, type Day } from './fixtures';
import { confirm } from './selectors';

// Steps any area uses: the clock, opening screens, dialogs and their confirmations, and the
// page width. A generic step lives only here; each area adds its own steps in its own
// <area>.steps.ts, and no two steps share their text (see qa/README.md).

Given('today is {day}', async ({ lender }, day: Day) => {
  await lender.on(day.iso);
});

When('the Lender opens the Dashboard', async ({ page }) => {
  await page.goto('/');
});

When('the Lender opens the Customers list', async ({ page }) => {
  await page.goto('/customers');
});

When('the Lender opens {mortgage}', async ({ page, lender }, name: string) => {
  lender.mortgage = await lender.mortgageNamed(name);
  await page.goto(`/mortgages/${lender.mortgage.id}`);
});

When('the Lender opens the Mortgage on {day}', async ({ page, lender }, day: Day) => {
  await lender.on(day.iso);
  await page.goto(`/mortgages/${lender.mortgage!.id}`);
});

When('the Lender opens the Payments list', async ({ page }) => {
  await page.goto('/payments');
  await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
});

When('the Lender opens the Payment {string}', async ({ page, lender }, reference: string) => {
  lender.payment = await lender.paymentWithReference(reference);
  await page.goto(`/payments/${lender.payment.id}`);
});

When('the Lender opens that Payment', async ({ page, lender }) => {
  await page.goto(`/payments/${lender.payment!.id}`);
});

When('the Lender opens a new Payment from {string}', async ({ page, lender }, name: string) => {
  lender.customer = await lender.customerNamed(name);
  await page.goto(`/payments/new?customer=${lender.customer.id}`);
});

When('the Lender goes to the next page', async ({ page }) => {
  await page.getByRole('button', { name: 'Next' }).click();
});

When('presses Esc', async ({ page }) => {
  await page.keyboard.press('Escape');
});

When('clicks outside the dialog', async ({ page }) => {
  await page.mouse.click(5, 5);
});

When('closes the dialog with its ×', async ({ page }) => {
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
});

Then('the confirmation lists {string} at {string}', async ({ page }, label: string, value: string) => {
  const row = page.getByRole('dialog').locator('.summary-row', { has: page.getByRole('term').getByText(label, { exact: true }) });
  await expect(row.getByRole('definition')).toHaveText(value);
});

Then('the confirmation reads:', async ({ page }, rows: DataTable) => {
  const dialog = page.getByRole('dialog');
  for (const [label, value] of rows.raw()) {
    await expect(dialog.locator('.summary-row', { has: page.getByRole('term').getByText(label, { exact: true }) })).toContainText(value);
  }
});

Then('the confirmation says {string}', async ({ page }, text: string) => {
  await expect(page.getByRole('dialog')).toContainText(text);
});

When('the Lender confirms', async ({ page }) => {
  await confirm(page);
});

When('the Lender goes back', async ({ page }) => {
  await page.getByRole('dialog').getByRole('button', { name: 'Go back' }).click();
});

Then('the dialog is closed', async ({ page }) => {
  await expect(page.getByRole('dialog')).toBeHidden();
});

Then('the page fits its width', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
});

Then('the {string} field says {string}', async ({ page }, label: string, problem: string) => {
  await expect(page.locator('label', { hasText: label }).first()).toContainText(problem);
});
