import { test, expect, type Page } from '@playwright/test';
import { withClock } from './clock';
import { tile } from './selectors';

// Golden book, 15 Nov 2025: Ramesh's 2025-Ramesh-GoldRing (Mortgage 1) has a ₹15,000 Advance
// over 3 months: the 5 Oct part cancelled, 5 Nov applied, 5 Dec upcoming. The last test
// cancels the 5 Dec part, so the tests run in order.
test.describe.configure({ mode: 'serial' });

const DAY = '2025-11-15';

async function openRing(page: Page) {
  await page.goto('/mortgages/1');
  await expect(page.getByRole('heading', { name: 'Advances' })).toBeVisible();
}

test.describe('advance panel and cancellation', () => {
  test('shows the Advance held and each part', async ({ page }) => {
    await withClock(page, DAY, undefined, async () => {
      await openRing(page);
      await expect(tile(page, 'Advance held')).toHaveText('₹5,000');
      await expect(page.getByRole('row', { name: '5 Oct 2025 ₹5,000 Cancelled on 20 Sept 2025 Receipt' })).toBeVisible();
      await expect(page.getByRole('row', { name: '5 Nov 2025 ₹5,000 Applied' })).toBeVisible();
      await expect(page.getByRole('row', { name: '5 Dec 2025 ₹5,000 Upcoming Cancel…' })).toBeVisible();
    });
  });

  test('the cancel dialog closes with Esc, a click outside and ×', async ({ page }) => {
    await withClock(page, DAY, undefined, async () => {
      await openRing(page);
      const cancel = page.getByRole('button', { name: 'Cancel…' });
      const dialog = page.getByRole('dialog');

      await cancel.click();
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();

      await cancel.click();
      await expect(dialog).toBeVisible();
      await page.mouse.click(5, 5);
      await expect(dialog).toBeHidden();

      await cancel.click();
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button', { name: 'Close' }).click();
      await expect(dialog).toBeHidden();

      await expect(page.getByRole('row', { name: /^5 Dec 2025 ₹5,000 Upcoming/ })).toBeVisible();
    });
  });

  test('cancelling a part applies it today and shows its own Receipt', async ({ page }) => {
    await withClock(page, DAY, undefined, async () => {
      await openRing(page);
      await page.getByRole('button', { name: 'Cancel…' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Cancel this Advance Instalment' }).click();

      await expect(page.getByRole('row', { name: '5 Dec 2025 ₹5,000 Cancelled on 15 Nov 2025 Receipt' })).toBeVisible();
      await expect(tile(page, 'Advance held')).toHaveText('₹0');
      await expect(page.getByRole('heading', { name: 'Receipt for the part due 5 Dec 2025' })).toBeVisible();
    });
  });
});
