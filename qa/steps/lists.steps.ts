import { expect, type Page } from '@playwright/test';
import { Then, When } from './fixtures';

// What every list shares: the sort heading and its arrow, the address, the pager's ends and
// stepping back a page. Seeding and filtering live with the Customers list (people.steps.ts).

function sorted(page: Page) {
  return page.locator('th[aria-sort]');
}

When('the Lender opens the first Customer listed', async ({ page }) => {
  await page.getByRole('table').locator('tbody tr td:nth-child(2) a').first().click();
  await expect(page).toHaveURL(/\/customers\/\d+$/);
});

When("the Lender uses the browser's Back button", async ({ page }) => {
  await page.goBack();
});

When('the Lender deletes the one Customer on the page', async ({ page }) => {
  await page.getByRole('table').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
});

Then('no column is sorted', async ({ page }) => {
  await expect(sorted(page)).toHaveCount(0);
});

Then(
  'the list is sorted by {string}, {word}, with the arrow {word}',
  async ({ page }, column: string, direction: string, arrow: string) => {
    await expect(sorted(page)).toHaveCount(1);
    await expect(sorted(page)).toHaveAttribute('aria-sort', direction);
    await expect(sorted(page).getByRole('button')).toHaveText(`${column}${arrow}`);
  },
);

Then('the address keeps the Active Mortgage filter and the sort {string}', async ({ page }, sort: string) => {
  await expect(page).toHaveURL((url) => url.searchParams.get('sort') === sort && url.searchParams.get('active') === 'true');
});

Then('the list shows only Customers with an Active Mortgage', async ({ page }) => {
  await expect(page.getByRole('checkbox', { name: 'Only Customers with an Active Mortgage' })).toBeChecked();
});

Then('the pager only offers {string}', async ({ page }, offered: string) => {
  for (const button of ['Previous', 'Next']) {
    const pressed = page.getByRole('button', { name: button, exact: true });
    if (button === offered) await expect(pressed).toBeEnabled();
    else await expect(pressed).toBeDisabled();
  }
});
