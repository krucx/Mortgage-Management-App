import { test, expect } from '@playwright/test';
import { labels, buttons } from './selectors';

// 1x1 PNG used for the customer photo upload.
const PHOTO = {
  name: 'photo.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
};

test.describe('blank slate', () => {
  test('creates a customer with a photo and a first mortgage', async ({ page }) => {
    await page.goto('/customers/new?next=mortgage');

    await page.getByLabel(labels.customerName).fill('Blank Slate Customer');
    await page.getByLabel('Address').fill('1 Test Street');
    const phone = '9' + String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
    await page.getByLabel('Contact number 1').fill(phone);

    // Upload a customer photo.
    await page.locator('input[type="file"]').first().setInputFiles(PHOTO);

    await expect(page.getByRole('button', { name: buttons.saveCustomer })).toBeEnabled({ timeout: 15_000 });
    await page.getByRole('button', { name: buttons.saveCustomer }).click();
    await page.getByRole('button', { name: buttons.confirmAndSave }).click();

    await expect(page).toHaveURL(/\/mortgages\/new\?customer=\d+/);

    const token = Math.random().toString(36).slice(2, 8);
    await page.getByLabel(labels.mortgageAmount).fill('10000');
    await page.getByLabel(labels.mortgageDescription).fill(`QA${token}`);
    await page.getByLabel('Gross weight (grams)').fill('5');
    await page.getByLabel('Net weight, gold only (grams)').fill('4.5');

    // The Mortgage Name is auto-suggested; wait for it to be ready.
    const create = page.getByRole('button', { name: buttons.createMortgage });
    await expect(create).toBeEnabled({ timeout: 15_000 });

    await create.click();
    await page.getByRole('button', { name: buttons.confirmAndSave }).click();

    await expect(page).toHaveURL(/\/mortgages\/\d+/, { timeout: 15_000 });
    await expect(page.getByText('Blank Slate Customer')).toBeVisible();
  });
});
