import { expect } from '@playwright/test';
import { Given, Then, When, type Day } from './fixtures';
import type { Lender } from './lender';

// The History of a Customer and a Mortgage: what the page lists, and what it takes to make
// each kind of entry (done through the app's API, on the day given).

const PHOTO = {
  name: 'jewellery.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
};

/** The photo a scenario added to its Mortgage, to remove again. */
const photoAdded = new WeakMap<Lender, number>();

Given('their address was changed {int} times', async ({ lender }, times: number) => {
  const { id, name, phone_1 } = await lender.customerNamed(lender.customer!.name);
  for (let i = 1; i <= times; i++) {
    // One day each: changes made at the same time would read as one change.
    await lender.on(new Date(Date.UTC(2025, 0, i)).toISOString().slice(0, 10));
    await lender.put(`/api/customers/${id}`, { name, phone_1, address: `${i} Test Street` });
  }
});

Given('its description was changed to {string} on {day}', async ({ lender }, description: string, day: Day) => {
  const m = await lender.get(`/api/mortgages/${lender.mortgage!.id}`);
  await lender.on(day.iso);
  await lender.put(`/api/mortgages/${m.id}`, {
    name: m.name,
    start_date: m.start_date,
    amount_lent: m.amount_lent,
    description,
    gross_weight_mg: m.gross_weight_mg,
    net_weight_mg: m.net_weight_mg,
    purity_karat: m.purity_karat,
    lent_through: m.lent_through,
  });
});

Given('a photo of it was added on {day}', async ({ lender }, day: Day) => {
  const { photos } = await lender.upload(`/api/mortgages/${lender.mortgage!.id}/photos`, 'photo', PHOTO, day.iso);
  photoAdded.set(lender, photos[0].id);
});

Given('that photo was removed on {day}', async ({ lender }, day: Day) => {
  await lender.on(day.iso);
  await lender.delete(`/api/mortgages/${lender.mortgage!.id}/photos/${photoAdded.get(lender)}`);
});

Given('its Term Change from {day} was removed on {day}', async ({ lender }, from: Day, on: Day) => {
  const { term_changes } = await lender.get(`/api/mortgages/${lender.mortgage!.id}`);
  const change = term_changes.find((c: { effective_on: string }) => c.effective_on === from.iso);
  await lender.on(on.iso);
  await lender.delete(`/api/mortgages/${lender.mortgage!.id}/term-changes/${change.id}`);
});

Given('it was reopened on {day} because {string}', async ({ lender }, day: Day, reason: string) => {
  await lender.post(`/api/mortgages/${lender.mortgage!.id}/reopen`, { reason }, day.iso);
});

// The History

const entries = (page: import('@playwright/test').Page) => page.locator('ul.history li');

Then('the History shows the latest {int} of {int} changes', async ({ page }, shown: number, total: number) => {
  await expect(entries(page)).toHaveCount(shown);
  await expect(page.getByText(`Showing the latest ${shown} of ${total} changes.`)).toBeVisible();
});

Then('the History shows only its latest {int} changes', async ({ page }, shown: number) => {
  await expect(entries(page)).toHaveCount(shown);
  await expect(page.getByText(new RegExp(`^Showing the latest ${shown} of \\d+ changes\\.$`))).toBeVisible();
});

When('the Lender shows the complete History', async ({ page }) => {
  await page.getByRole('button', { name: 'Show complete history' }).click();
  await expect(page.getByRole('dialog').locator('ul.history')).toBeVisible();
});

Then('the complete History lists {int} changes', async ({ page }, count: number) => {
  await expect(page.getByRole('dialog').locator('ul.history li')).toHaveCount(count);
});

Then('the complete History ends with {string}', async ({ page }, text: string) => {
  await expect(page.getByRole('dialog').locator('ul.history li').last()).toContainText(text);
});

Then('its History lists {string}', async ({ page }, text: string) => {
  await expect(entries(page).filter({ hasText: text }).first()).toBeVisible();
});

Then('its History lists {string}, with {string} linked', async ({ page }, text: string, link: string) => {
  await expect(entries(page).filter({ hasText: text }).first().getByRole('link', { name: link, exact: true })).toBeVisible();
});
