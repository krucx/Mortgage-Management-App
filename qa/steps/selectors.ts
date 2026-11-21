import { expect, type Page } from '@playwright/test';

/** Shared selectors for the mortgage app's forms. Prefer labels/roles over CSS. */
export const labels = {
  customerName: 'Name',
  customerAddress: 'Address',
  customerPhone1: 'Contact number 1',
  mortgageAmount: 'Principal lent (₹)',
  mortgageDescription: 'Description of the jewellery',
  mortgageName: 'Mortgage Name',
} as const;

export const buttons = {
  saveCustomer: 'Save',
  confirmAndSave: 'Confirm and save',
  createMortgage: 'Create Mortgage',
} as const;

/** The figure in a Mortgage page tile, such as `tile(page, 'Advance held')`. */
export function tile(page: Page, label: string) {
  return page.locator('.tile', { has: page.getByText(label, { exact: true }) }).locator('strong');
}

/** Confirms the open dialog, saving or removing what it asks about, and waits for it to close. */
export async function confirm(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: /^(Confirm and save|Remove)$/ }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}
