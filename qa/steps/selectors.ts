import { expect, type Locator, type Page } from '@playwright/test';

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

/** A WhatsApp message's preview, as the Customer will see it, within `scope`. */
export function whatsAppPreview(scope: Page | Locator) {
  return scope.locator('[aria-label="How the message will look in WhatsApp"]');
}

/** The chat bubble holding the message, within `scope`. */
export function whatsAppBubble(scope: Page | Locator) {
  return whatsAppPreview(scope).locator(':scope > div');
}

/** A Mortgage before and after an unsaved change (a Preview), within `scope`. */
export function beforeAfter(scope: Page | Locator) {
  return scope.getByRole('group', { name: 'Before and after' });
}

/** The printable Receipt's own section. */
export function printableReceipt(page: Page) {
  return page.locator('section', {
    has: page.getByRole('heading', { level: 2, name: /^(Payment receipt|Advance applied)$/ }),
  });
}

/** A Dashboard figure, which opens the list it was counted from. */
export function dashboardFigure(page: Page, label: string) {
  return page.getByRole('link').filter({ has: page.getByText(label, { exact: true }) });
}
