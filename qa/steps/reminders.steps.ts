import { expect, type Page } from '@playwright/test';
import { Then, When, type Day } from './fixtures';

function reminderRows(page: Page, customer: string) {
  return page.getByRole('row').filter({ has: page.getByRole('link', { name: customer, exact: true }) });
}

/** The Customer's Reminder rows, paging through the list (twenty a page, and every work
 * scenario queues one) until they show or the last page is reached. */
async function findReminder(page: Page, customer: string) {
  const rows = reminderRows(page, customer);
  const next = page.getByRole('button', { name: 'Next' });
  const at = page.getByText(/^Page \d+ of \d+$/);
  while ((await rows.count()) === 0 && (await next.isVisible()) && (await next.isEnabled())) {
    const shown = await at.textContent();
    await next.click();
    await expect(at).not.toHaveText(shown!);
  }
  return rows;
}

When('the Lender opens the Reminders page on {day}', async ({ page, lender }, day: Day) => {
  await lender.on(day.iso);
  await page.goto('/reminders');
  // Loaded: either the table or the empty-list hint.
  await expect(page.getByRole('table').or(page.getByText('No Reminders here.'))).toBeVisible();
});

Then('no Reminder is listed for {string}', async ({ page }, customer: string) => {
  await expect(await findReminder(page, customer)).toHaveCount(0);
});

Then('a Reminder to {string} for {day} is to send', async ({ page }, customer: string, day: Day) => {
  const reminder = await findReminder(page, customer);
  await expect(reminder).toHaveCount(1);
  await expect(reminder).toContainText(day.shown);
  await expect(reminder).toContainText('to send');
});
