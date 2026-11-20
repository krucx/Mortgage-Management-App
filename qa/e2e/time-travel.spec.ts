import { test, expect, type Page } from '@playwright/test';
import { qaClockHeaders, withClock } from './clock';
import { apiPost, recordPayment } from './seed';
import { tile } from './selectors';

// Its own Mortgage, lent 5 Sept 2025 with a ₹6,000 Advance over 2 months paid 10 Sept: the
// parts land on the 5 Oct and 5 Nov Accrual Dates. Golden-book Mortgages gain later Payments
// from other specs, which a view as of an earlier day would still count.
async function onDay(page: Page, mortgageId: number, day: string, check: () => Promise<void>) {
  await withClock(page, day, undefined, async () => {
    await page.goto(`/mortgages/${mortgageId}`);
    await expect(page.getByRole('heading', { name: 'Advances' })).toBeVisible();
    await check();
  });
}

test.describe('time travel', () => {
  test('Advance parts land on their Accrual Dates as the clock moves', async ({ page, request }) => {
    const phone = '8' + String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
    const customer = await apiPost(request, '/api/customers', {
      name: 'Time Travel Customer', address: '7 Clock Lane', phone_1: phone,
    }, qaClockHeaders('2025-09-05'));
    const mortgage = await apiPost(request, '/api/mortgages', {
      customer_id: customer.id, start_date: '2025-09-05', amount_lent: 3_000_000,
      description: 'Gold bracelet', gross_weight_mg: 6_000, net_weight_mg: 5_500, purity_karat: 22,
      lent_through: 'upi',
    }, qaClockHeaders('2025-09-05'));
    await recordPayment(request, '2025-09-10', {
      customer_id: customer.id, mortgage_id: mortgage.id, advance: 600_000, months: 2,
    });

    await onDay(page, mortgage.id, '2025-10-01', async () => {
      await expect(tile(page, 'Advance held')).toHaveText('₹6,000');
      await expect(page.getByRole('row', { name: '5 Oct 2025 ₹3,000 Upcoming Cancel…' })).toBeVisible();
      await expect(page.getByRole('row', { name: '5 Nov 2025 ₹3,000 Upcoming Cancel…' })).toBeVisible();
    });

    await onDay(page, mortgage.id, '2025-10-05', async () => {
      await expect(tile(page, 'Advance held')).toHaveText('₹3,000');
      await expect(page.getByRole('row', { name: '5 Oct 2025 ₹3,000 Applied' })).toBeVisible();
      await expect(page.getByRole('row', { name: /^5 Oct 2025 Advance Instalment 1 of 2/ })).toBeVisible();
    });

    await onDay(page, mortgage.id, '2025-11-06', async () => {
      await expect(tile(page, 'Advance held')).toHaveText('₹0');
      await expect(page.getByRole('row', { name: '5 Nov 2025 ₹3,000 Applied' })).toBeVisible();
      await expect(page.getByRole('row', { name: /^5 Nov 2025 Advance Instalment 2 of 2/ })).toBeVisible();
    });
  });
});
