import { expect, type Page } from '@playwright/test';
import { Then, When, type Money } from './fixtures';
import type { Lender } from './lender';
import { shownDay, shownINR, shownPercent } from './shown';

// The Projection panel on a Mortgage page, checked against the API's Projection.

const HORIZONS = [3, 6, 12];

type Point = { months: number; on: string; principal: number; unpaid_interest: number; outstanding: number; loan_to_value: number | null };
type Series = { points: Point[]; paid_off_on: string | null };
type Projection = { baseline: Series; what_if: Series | null; collateral_value: number | null };

function table(page: Page) {
  return page.locator('table', { has: page.getByText('No more Payments', { exact: true }) });
}

function projection(lender: Lender, monthly?: Money): Promise<Projection> {
  return lender.get(`/api/mortgages/${lender.mortgage!.id}/projection`, monthly ? { monthly_payment: String(monthly.paise) } : {});
}

/** The row `label` of the group headed `group` reads `cell` of each horizon's point. */
async function expectRow(page: Page, group: string, label: string, points: Point[], cell: (p: Point) => string) {
  const values = HORIZONS.map((months) => cell(points.find((p) => p.months === months)!));
  // Each group's rows follow its heading row; the first row after it with this label is its own.
  const row = table(page)
    .locator('tr.projection-group', { hasText: group })
    .locator(`xpath=following-sibling::tr[td[1][normalize-space()="${label}"]][1]`);
  await expect(row.locator('td.num')).toHaveText(values);
}

async function expectGroup(page: Page, group: string, points: Point[]) {
  await expectRow(page, group, 'Principal', points, (p) => shownINR(p.principal));
  await expectRow(page, group, 'Unpaid interest', points, (p) => shownINR(p.unpaid_interest));
  await expectRow(page, group, 'Outstanding', points, (p) => shownINR(p.outstanding));
}

Then(
  'its Projection shows in 3, 6 and 12 months what it owes with no more Payments',
  async ({ page, lender }) => {
    const { baseline } = await projection(lender);
    const heads = table(page).locator('thead th.num');
    await expect(heads).toHaveText(
      HORIZONS.map((months) => `In ${months} months${shownDay(baseline.points.find((p) => p.months === months)!.on)}`),
    );
    await expectGroup(page, 'No more Payments', baseline.points);
  },
);

Then('its Projection has no Loan-to-Value until there is a Collateral Value', async ({ page }) => {
  await expect(page.getByText('Loan-to-Value appears once there is a Collateral Value.')).toBeVisible();
  await expect(table(page).getByRole('row', { name: 'Loan-to-Value — — —' })).toBeVisible();
});

Then('its Projection shows its Loan-to-Value in 3, 6 and 12 months', async ({ page, lender }) => {
  const { baseline, collateral_value } = await projection(lender);
  expect(collateral_value).not.toBeNull();
  await expect(page.getByText('Loan-to-Value appears once there is a Collateral Value.')).toBeHidden();
  await expectRow(page, 'No more Payments', 'Loan-to-Value', baseline.points, (p) => shownPercent(p.loan_to_value!));
});

When('the Lender asks what if they pay {money} every month', async ({ page }, monthly: Money) => {
  await page.getByLabel('What if they pay every month (₹), on each Accrual Date').fill(monthly.typed);
  await expect(table(page).getByText(`Paying ${monthly.shown} a month`, { exact: true })).toBeVisible();
});

Then(
  'its Projection also shows what it owes paying {money} a month',
  async ({ page, lender }, monthly: Money) => {
    const { what_if } = await projection(lender, monthly);
    await expectGroup(page, `Paying ${monthly.shown} a month`, what_if!.points);
  },
);

Then(
  'its Projection gives the day it would be paid off paying {money} a month',
  async ({ page, lender }, monthly: Money) => {
    const { what_if } = await projection(lender, monthly);
    expect(what_if!.paid_off_on).not.toBeNull();
    await expect(
      page.getByText(`Paying ${monthly.shown} a month, it would be paid off on ${shownDay(what_if!.paid_off_on!)}.`),
    ).toBeVisible();
  },
);

Then('its Projection says it would not be paid off within ten years', async ({ page }) => {
  await expect(page.getByText('At that amount it would not be paid off within ten years.')).toBeVisible();
});
