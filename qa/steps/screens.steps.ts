import { expect } from '@playwright/test';
import { Given, Then, When, type Day } from './fixtures';

// The clock, opening screens, dialogs and the page width: steps any area uses.

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

When('presses Esc', async ({ page }) => {
  await page.keyboard.press('Escape');
});

When('clicks outside the dialog', async ({ page }) => {
  await page.mouse.click(5, 5);
});

When('closes the dialog with its ×', async ({ page }) => {
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
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
