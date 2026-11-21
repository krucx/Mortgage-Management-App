import { expect, type Page } from '@playwright/test';
import { Then, When, type Day } from './fixtures';

function reminderRows(page: Page, customer: string) {
  return page.getByRole('row').filter({ has: page.getByRole('link', { name: customer, exact: true }) });
}

When('the Lender opens the Reminders page on {day}', async ({ page, lender }, day: Day) => {
  await lender.on(day.iso);
  await page.goto('/reminders');
  // Loaded: either the table or the empty-list hint.
  await expect(page.getByRole('table').or(page.getByText('No Reminders here.'))).toBeVisible();
});

Then('no Reminder is listed for {string}', async ({ page }, customer: string) => {
  await expect(reminderRows(page, customer)).toHaveCount(0);
});

Then('a Reminder to {string} for {day} is to send', async ({ page }, customer: string, day: Day) => {
  const reminder = reminderRows(page, customer);
  await expect(reminder).toHaveCount(1);
  await expect(reminder).toContainText(day.shown);
  await expect(reminder).toContainText('to send');
});
