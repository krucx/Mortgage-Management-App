import { test, expect } from '@playwright/test';
import { withClock } from './clock';
import { recordPayment } from './seed';

const DAY = '2025-11-15';

test.describe('receipts and voids', () => {
  // Golden book: Payment 1 is Ramesh's ₹15,000 UPI Advance on his gold ring, received 10 Sept 2025.
  test('a Payment shows its Receipt, which names the jewellery and not the Mortgage', async ({ page }) => {
    await withClock(page, DAY, undefined, async () => {
      await page.goto('/payments/1');
      await expect(page.getByRole('heading', { name: 'Receipt' })).toBeVisible();
      const receipt = page.locator('.receipt-panel');
      await expect(receipt).toContainText('Namaste Ramesh Kumar');
      await expect(receipt).toContainText('Gold ring');
      await expect(receipt).not.toContainText('2025-Ramesh-GoldRing');

      await page.getByRole('link', { name: 'Print or save as PDF' }).click();
      await expect(page).toHaveURL(/\/payments\/1\/receipt$/);
      await expect(page.getByText('Payment receipt')).toBeVisible();
      for (const part of ['₹5,000 on 5 Oct 2025', '₹5,000 on 5 Nov 2025', '₹5,000 on 5 Dec 2025']) {
        await expect(page.getByText(part)).toBeVisible();
      }
    });
  });

  // Priya's 2025-Priya-GoldBangles (Mortgage 3) is Active again after its Reopen.
  test('a voided Payment stays on record with its reason and no Receipt', async ({ page, request }) => {
    const payment = await recordPayment(request, DAY, { customer_id: 2, mortgage_id: 3, amount: 100_000 });

    await withClock(page, DAY, undefined, async () => {
      await page.goto(`/payments/${payment.id}`);
      await expect(page.getByRole('heading', { name: 'Receipt' })).toBeVisible();

      await page.getByRole('button', { name: 'Void…' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Reason (kept on record)').fill('Entered twice');
      await dialog.getByRole('button', { name: 'Void Payment' }).click();

      await expect(page.getByRole('heading', { name: 'Payment of ₹1,000 voided' })).toBeVisible();
      await expect(page.getByText(/Voided .*: Entered twice\. It is kept on record/)).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Receipt' })).toBeHidden();
      await expect(page.getByRole('button', { name: 'Void…' })).toBeHidden();
    });
  });
});
