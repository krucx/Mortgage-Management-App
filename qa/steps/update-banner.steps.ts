import { expect } from '@playwright/test';
import { Given, Then, When } from './fixtures';

// The banner a newer release brings, with /api/update stubbed in the browser.

const RUNNING = '1.0.0';

Given('version {string} is released with the notes {string}', async ({ page }, version: string, notes: string) => {
  await page.route('**/api/update', (route) => route.fulfill({ json: { running: RUNNING, available: { version, notes } } }));
});

When('version {string} is released after that, with the notes {string}', async ({ page }, version: string, notes: string) => {
  await page.route('**/api/update', (route) => route.fulfill({ json: { running: RUNNING, available: { version, notes } } }));
});

Given('no newer release is out', async ({ page }) => {
  await page.route('**/api/update', (route) => route.fulfill({ json: { running: RUNNING, available: null } }));
});

When("the Lender opens What's new in the banner", async ({ page }) => {
  await page.getByRole('region', { name: 'Update' }).getByText("What's new").click();
});

When('the Lender chooses Later', async ({ page }) => {
  await page.getByRole('region', { name: 'Update' }).getByRole('button', { name: 'Later' }).click();
});

Then('the update banner says {string}', async ({ page }, text: string) => {
  await expect(page.getByRole('region', { name: 'Update' })).toContainText(text);
});

Then("the banner's notes list {string}", async ({ page }, note: string) => {
  await expect(page.getByRole('region', { name: 'Update' }).getByRole('listitem')).toHaveText([note]);
});

Then('no update banner is shown', async ({ page }) => {
  // The page has loaded, and so has its answer, before the banner can be said to be absent.
  await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('region', { name: 'Update' })).toHaveCount(0);
});
