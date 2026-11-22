import { expect, type Page } from '@playwright/test';
import { Given, Then, When, type Day } from './fixtures';

// The Change Terms form and the Terms panel on a Mortgage page.

function fromDate(page: Page) {
  return page.getByLabel('From the Accrual Date');
}

function rate(page: Page) {
  return page.getByLabel('Monthly interest rate (%)');
}

function save(page: Page) {
  return page.getByRole('button', { name: 'Save Term Change' });
}

/** The Terms panel's line for the Term Change from `day`. */
function termChange(page: Page, day: Day) {
  return page.locator('.term-changes li', { hasText: `From ${day.shown}:` });
}

function bps(percent: number) {
  return Math.round(percent * 100);
}

Given(
  'on {day} its Terms were changed to {float}% a month from {day}',
  async ({ lender }, on: Day, percent: number, from: Day) => {
    await lender.post(
      `/api/mortgages/${lender.mortgage!.id}/term-changes`,
      { effective_on: from.iso, monthly_rate_bps: bps(percent) },
      on.iso,
    );
  },
);

Given(
  'on {day} its Part-Month Rule was changed to nothing from {day}',
  async ({ lender }, on: Day, from: Day) => {
    await lender.post(
      `/api/mortgages/${lender.mortgage!.id}/term-changes`,
      { effective_on: from.iso, part_month_rule: 'nothing' },
      on.iso,
    );
  },
);

When('the Lender starts to change its Terms', async ({ page }) => {
  await page.getByRole('link', { name: 'Change Terms…' }).click();
  await expect(page).toHaveURL(/\/mortgages\/\d+\/terms$/);
  await expect(fromDate(page)).toBeVisible();
});

Then('the Accrual Dates offered run from {string} to {string}', async ({ page }, first: string, last: string) => {
  const offered = fromDate(page).getByRole('option');
  await expect(offered.first()).toHaveText(first);
  await expect(offered.last()).toHaveText(last);
});

Then('the Terms are set to change from {day}', async ({ page }, day: Day) => {
  await expect(fromDate(page)).toHaveValue(day.iso);
});

Then('{day} is not offered', async ({ page }, day: Day) => {
  await expect(fromDate(page).getByRole('option').first()).toBeAttached();
  await expect(fromDate(page).locator(`option[value="${day.iso}"]`)).toHaveCount(0);
});

Then('there is no Preview until something differs', async ({ page }) => {
  await expect(page.getByText('Change the rate, Interest Mode or Part-Month Rule to see the effect.')).toBeVisible();
  await expect(save(page)).toBeDisabled();
});

When('the Lender sets the rate to {float}% a month', async ({ page }, percent: number) => {
  await rate(page).fill(String(percent));
});

When('the Lender picks {day} and sets the rate to {float}% a month', async ({ page }, day: Day, percent: number) => {
  await fromDate(page).selectOption(day.iso);
  await rate(page).fill(String(percent));
});

Then('the Preview shows what changes', async ({ page }) => {
  await expect(page.locator('.before-after')).toBeVisible();
  await expect(save(page)).toBeEnabled();
});

When('the Lender saves the Term Change', async ({ page }) => {
  await save(page).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

Then(
  'its Terms panel lists the Term Change from {day} to {float}% a month as coming',
  async ({ page }, day: Day, percent: number) => {
    const line = termChange(page, day);
    await expect(line).toContainText(`${percent}% a month`);
    await expect(line.getByText('coming', { exact: true })).toBeVisible();
    await expect(line.getByRole('button', { name: 'Remove' })).toBeVisible();
  },
);

Then(
  'its Terms panel lists the Term Change from {day} to {float}% a month, in effect',
  async ({ page }, day: Day, percent: number) => {
    const line = termChange(page, day);
    await expect(line).toContainText(`${percent}% a month`);
    await expect(line.getByText('coming', { exact: true })).toBeHidden();
    await expect(line.getByRole('button', { name: 'Remove' })).toBeHidden();
  },
);

Then('its Terms panel lists no Term Change', async ({ page }) => {
  await expect(page.getByRole('link', { name: 'Change Terms…' })).toBeVisible();
  await expect(page.locator('.term-changes li')).toHaveCount(0);
});

When('the Lender starts to remove the Term Change from {day}', async ({ page }, day: Day) => {
  await termChange(page, day).getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('dialog', { name: `Remove the Term Change from ${day.shown}?` })).toBeVisible();
});

Then('the dialog shows what changes', async ({ page }) => {
  await expect(page.getByRole('dialog').locator('.before-after')).toBeVisible();
});

Then(
  'removing the Term Change from {day} is refused: {string}',
  async ({ lender }, day: Day, reason: string) => {
    const { term_changes } = await lender.get(`/api/mortgages/${lender.mortgage!.id}`);
    const change = term_changes.find((c: { effective_on: string }) => c.effective_on === day.iso);
    expect(await lender.refusal('delete', `/api/mortgages/${lender.mortgage!.id}/term-changes/${change.id}`)).toBe(reason);
  },
);

Then(
  'changing its Terms to {float}% a month from {day} is refused: {string}',
  async ({ lender }, percent: number, from: Day, reason: string) => {
    const refused = await lender.refusal('post', `/api/mortgages/${lender.mortgage!.id}/term-changes`, {
      effective_on: from.iso,
      monthly_rate_bps: bps(percent),
    });
    expect(refused).toBe(reason);
  },
);

Then(
  'the Preview warns that its Advance Instalment on {day} would now reduce Principal',
  async ({ page, lender }, day: Day) => {
    const warning = page.getByRole('status').filter({ hasText: 'would now reduce Principal. You can still save.' });
    await expect(warning.getByRole('listitem')).toHaveText([new RegExp(`^${lender.mortgage!.name} on ${day.shown}: ₹`)]);
    await expect(save(page)).toBeEnabled();
  },
);
