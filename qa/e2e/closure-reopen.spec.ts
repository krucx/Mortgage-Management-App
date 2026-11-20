import { test, expect } from '@playwright/test';
import { withClock } from './clock';
import { recordPayment } from './seed';
import { tile } from './selectors';

// Golden book, 15 Nov 2025: Meera's 2025-Meera-GoldNecklace (Mortgage 4) has no Advance; the
// test gives it one, then redeems and reopens it.
const DAY = '2025-11-15';

test.describe('closure and reopen', () => {
  test('a Redemption uses the upcoming Advance, and Reopen restores it', async ({ page, request }) => {
    await recordPayment(request, DAY, { customer_id: 3, mortgage_id: 4, advance: 200_000, months: 2 });

    await withClock(page, DAY, undefined, async () => {
      await page.goto('/mortgages/4');
      await expect(tile(page, 'Advance held')).toHaveText('₹2,000');

      await page.getByRole('button', { name: 'Redeem…' }).click();
      await expect(page.getByText('− ₹2,000')).toBeVisible();
      // UPI: the final Payment is over the cash limit.
      await page.getByLabel('Final Payment method').selectOption({ label: 'UPI' });
      await page.getByRole('button', { name: /^Redeem for ₹/ }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Confirm Redemption' }).click();

      await expect(page.locator('.close-panel')).toContainText('Redeemed on 15 Nov 2025');
      await expect(page.locator('.close-panel')).toContainText('₹2,000 of it from the Advance held');

      await page.getByRole('button', { name: 'Reopen…' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Reason (kept on record)').fill('Redeemed by mistake');
      await dialog.getByRole('button', { name: 'Reopen' }).click();

      await expect(page.getByRole('heading', { name: '2025-Meera-GoldNecklace active' })).toBeVisible();
      await expect(tile(page, 'Advance held')).toHaveText('₹2,000');
      await expect(page.getByRole('row', { name: '5 Dec 2025 ₹1,000 Upcoming Cancel…' })).toBeVisible();
      await expect(page.getByRole('row', { name: '5 Jan 2026 ₹1,000 Upcoming Cancel…' })).toBeVisible();
    });
  });
});
