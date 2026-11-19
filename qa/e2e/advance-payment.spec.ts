import { test, expect } from '@playwright/test';
import { withClock } from './clock';
import { tile } from './selectors';

// Golden book, 15 Nov 2025: Ramesh's 2025-Ramesh-GoldChain has had both parts of its Advance applied.
const CHAIN = '2025-Ramesh-GoldChain';

test.describe('advance payment', () => {
  test('syncs Amount received with the rows, previews the schedule and records it', async ({ page }) => {
    await withClock(page, '2025-11-15', undefined, async () => {
      await page.goto('/payments/new?customer=1&mortgage=2');
      const received = page.getByRole('spinbutton', { name: /^Amount received/ });
      const row = page.getByRole('row', { name: new RegExp(`Include ${CHAIN}`) });

      // Amount received → the row's Allocation.
      await received.fill('3000');
      await expect(row.getByRole('cell', { name: '₹3,000', exact: true })).toBeVisible();

      // The row's Advance → Amount received.
      await received.fill('');
      await row.getByRole('spinbutton', { name: `Advance for ${CHAIN}` }).fill('1500');
      await row.getByRole('combobox', { name: `Months for ${CHAIN}` }).selectOption('3');
      await expect(received).toHaveValue('1500');

      // Schedule preview: three ₹500 parts on the next Accrual Dates.
      const preview = page.getByRole('region', { name: `Advance on ${CHAIN}` });
      await expect(preview.getByRole('heading')).toHaveText(`Advance on ${CHAIN}: ₹1,500 over 3 months`);
      for (const day of ['5 Dec 2025', '5 Jan 2026', '5 Feb 2026']) {
        await expect(preview.getByRole('row', { name: new RegExp(`^${day} ₹500 `) })).toBeVisible();
      }

      await page.getByRole('button', { name: 'Record Payment' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Confirm and save' }).click();
      await expect(page).toHaveURL(/\/payments\/\d+/);

      // The Mortgage page holds the Advance, part by part.
      await page.goto('/mortgages/2');
      await expect(tile(page, 'Advance held')).toHaveText('₹1,500');
      await expect(page.getByRole('row', { name: /^5 Feb 2026 ₹500 Upcoming/ })).toBeVisible();
    });
  });
});
