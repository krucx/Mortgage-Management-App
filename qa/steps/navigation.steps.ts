import { expect } from '@playwright/test';
import { Then, When } from './fixtures';

// The header (links, title, version, theme switch) and the page for an unknown address.

const PAGES = ['Dashboard', 'Payments', 'Customers', 'Mortgages', 'Calculator', 'Call List', 'Reminders', 'Closures', 'Settings'];

When('the Lender opens the address {string}', async ({ page }, address: string) => {
  await page.goto(address);
});

When('the Lender follows the {string} link in the header', async ({ page }, link: string) => {
  await page.getByRole('navigation').getByRole('link', { name: new RegExp(`^${link}( |$)`) }).click();
});

When('the Lender follows the title in the header', async ({ page }) => {
  await page.getByRole('banner').getByRole('heading', { level: 1 }).getByRole('link').click();
});

When('the Lender follows {string} from the page', async ({ page }, link: string) => {
  await page.getByRole('main').getByRole('link', { name: link, exact: true }).click();
});

When('the Lender reloads the page', async ({ page }) => {
  await page.reload();
});

When('the Lender switches the theme', async ({ page }) => {
  await page.getByRole('button', { name: /^Switch to the (light|dark) theme$/ }).click();
});

Then('no link in the header is highlighted', async ({ page }) => {
  await expect(page.getByRole('navigation').locator('[aria-current="page"]')).toHaveCount(0);
});

Then('only the {string} link in the header is highlighted', async ({ page }, link: string) => {
  await expect(page.getByRole('navigation').locator('[aria-current="page"]')).toHaveText([link]);
});

Then('the header links to every page', async ({ page }) => {
  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('link')).toHaveText(PAGES);
});

Then('the header names the version the app is running', async ({ page, lender }) => {
  const version = page.getByRole('banner').locator('sup.version');
  await expect(version).toHaveText(/^v\d+\.\d+\.\d+/);
  const number = (await version.innerText()).slice(1);
  await expect(version).toHaveAttribute('title', `Version ${number}`);
  expect((await lender.get('/api/update')).running).toBe(number);
});

Then('the header offers to switch to the {word} theme', async ({ page }, theme: string) => {
  await expect(page.getByRole('button', { name: `Switch to the ${theme} theme` })).toBeVisible();
});

Then('the dark theme is shown', async ({ page }) => {
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

Then('no theme is chosen', async ({ page }) => {
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
});

Then(
  'the page says {string} and that nothing was found at {string}',
  async ({ page }, title: string, address: string) => {
    await expect(page.getByRole('heading', { name: title, level: 2 })).toBeVisible();
    await expect(page.getByRole('main')).toContainText(`Nothing was found at ${address}.`);
  },
);
