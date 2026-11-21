import { expect } from '@playwright/test';
import { Given, Then, When, type Day, type Money } from './fixtures';
import { newPhone } from './lender';
import { buttons, labels } from './selectors';

// 1x1 PNG used for the Customer photo upload.
const PHOTO = {
  name: 'photo.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
};

When('the Lender adds a Customer {string} with a photo', async ({ page }, name: string) => {
  await page.goto('/customers/new?next=mortgage');
  await page.getByLabel(labels.customerName).fill(name);
  await page.getByLabel(labels.customerAddress).fill('1 Test Street');
  await page.getByLabel(labels.customerPhone1).fill(newPhone('9'));
  await page.locator('input[type="file"]').first().setInputFiles(PHOTO);

  await expect(page.getByRole('button', { name: buttons.saveCustomer })).toBeEnabled({ timeout: 15_000 });
  await page.getByRole('button', { name: buttons.saveCustomer }).click();
  await page.getByRole('button', { name: buttons.confirmAndSave }).click();
  await expect(page).toHaveURL(/\/mortgages\/new\?customer=\d+/);
});

When(
  'lends them {money} against a {float} gram piece with {float} grams of gold',
  async ({ page }, amount: Money, gross: number, net: number) => {
    await page.getByLabel(labels.mortgageAmount).fill(amount.typed);
    await page.getByLabel(labels.mortgageDescription).fill(`QA${Math.random().toString(36).slice(2, 8)}`);
    await page.getByLabel('Gross weight (grams)').fill(String(gross));
    await page.getByLabel('Net weight, gold only (grams)').fill(String(net));

    // The Mortgage Name is suggested; wait for it.
    const create = page.getByRole('button', { name: buttons.createMortgage });
    await expect(create).toBeEnabled({ timeout: 15_000 });
    await create.click();
    await page.getByRole('button', { name: buttons.confirmAndSave }).click();
    await expect(page).toHaveURL(/\/mortgages\/\d+/, { timeout: 15_000 });
  },
);

Then("the new Mortgage's page names {string}", async ({ page }, name: string) => {
  await expect(page.getByText(name)).toBeVisible();
});

Given(
  '{string} was lent {money} on {day} against a {jewellery}',
  async ({ lender }, name: string, amount: Money, day: Day, description: string) => {
    const customer = await lender.addCustomer(name, day.iso);
    lender.mortgage = await lender.post(
      '/api/mortgages',
      {
        customer_id: customer.id,
        start_date: day.iso,
        amount_lent: amount.paise,
        description,
        gross_weight_mg: 6_000,
        net_weight_mg: 5_500,
        purity_karat: 22,
        lent_through: 'upi',
      },
      day.iso,
    );
  },
);
