import { expect, type Locator, type Page } from '@playwright/test';
import { defineParameterType } from 'playwright-bdd';
import { Given, Then, When, type Day, type Money } from './fixtures';
import type { Lender } from './lender';

// The Settings screen: each section on its own, what saving says, and Backups. Settings are
// one value for the whole book, so these scenarios run last on the @fresh app (settings.feature).

/** A section of Settings, found by its heading. */
const section = (page: Page, heading: string) =>
  page.locator('section.card', { has: page.getByRole('heading', { name: heading, exact: true }) });

/** The sections of one optional number: the heading, and the label of the number. */
const NUMBERS = {
  'Cash Limit': { heading: 'Cash Limit', input: 'Warn at cash of (₹), or more' },
  'Discount confirmation limit': { heading: 'Discount confirmation', input: 'Ask when Discount exceeds (₹)' },
  'Grace Period': { heading: 'Grace Period', input: 'Grace Period (days)' },
} as const;
type Setting = keyof typeof NUMBERS;

defineParameterType({ name: 'setting', regexp: /Cash Limit|Discount confirmation limit|Grace Period/ });

/** Types into a section, presses its Save and waits for the confirmation it asks for. */
async function startSaving(page: Page, heading: string, type: (card: Locator) => Promise<void>) {
  const card = section(page, heading);
  await type(card);
  await card.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

When('the Lender opens Settings', async ({ page }) => {
  await page.goto('/settings');
  await expect(section(page, 'Default Terms').getByLabel('Monthly interest rate (%)')).toBeVisible();
});

Then('the {string} section says {string}', async ({ page }, heading: string, text: string) => {
  await expect(section(page, heading).locator('.status')).toHaveText(text);
});

Then('the {string} section says nothing', async ({ page }, heading: string) => {
  await expect(section(page, heading)).toBeVisible();
  await expect(section(page, heading).locator('.status')).toHaveCount(0);
});

// Default Terms

When('the Lender sets the Default Terms to {float}% a month', async ({ page }, percent: number) => {
  await startSaving(page, 'Default Terms', (card) => card.getByLabel('Monthly interest rate (%)').fill(String(percent)));
});

Then('the new Mortgage form offers the Terms {float}% a month', async ({ page }, percent: number) => {
  await expect(page.getByLabel('Monthly interest rate (%)')).toHaveValue(String(percent));
});

Then('its Terms are {float}% a month', async ({ page }, percent: number) => {
  await expect(page.getByRole('heading', { name: /^2025-/ }).first()).toBeVisible();
  await expect(page.getByText(new RegExp(`^${percent}% a month`)).first()).toBeVisible();
});

// The Cash Limit, the Discount confirmation limit and the Grace Period

When('the Lender sets the {setting} to {money}', async ({ page }, setting: Setting, amount: Money) => {
  await startSaving(page, NUMBERS[setting].heading, (card) => card.getByLabel(NUMBERS[setting].input).fill(amount.typed));
});

When('the Lender sets the Grace Period to {int} days', async ({ page }, days: number) => {
  await startSaving(page, NUMBERS['Grace Period'].heading, (card) => card.getByLabel(NUMBERS['Grace Period'].input).fill(String(days)));
});

When('the Lender clears the {setting}', async ({ page }, setting: Setting) => {
  await startSaving(page, NUMBERS[setting].heading, (card) => card.getByLabel(NUMBERS[setting].input).fill(''));
});

When('lends it in cash', async ({ page }) => {
  await page.getByLabel('Lent Through').selectOption({ label: 'Cash' });
});

// The WhatsApp messages

const messages = (page: Page) => section(page, 'WhatsApp messages');
const receiptPanel = (page: Page) => messages(page).locator('.receipt-panel').nth(0);

/** The Receipt template a scenario found, to hold it to. */
const originalReceipt = new WeakMap<Lender, string>();

When('the Lender writes {string} as the Receipt template', async ({ page, lender }, template: string) => {
  originalReceipt.set(lender, (await lender.get('/api/settings/messages')).receipt_template);
  await receiptPanel(page).locator('textarea').fill(template);
});

When('the Lender saves the WhatsApp messages', async ({ page }) => {
  const answered = page.waitForResponse((r) => r.url().includes('/api/settings/messages') && r.request().method() === 'PUT');
  await messages(page).getByRole('button', { name: 'Save', exact: true }).click();
  await answered;
});

Then('the Receipt preview shows {string} in bold and {string} in italics', async ({ page }, bold: string, italic: string) => {
  await expect(receiptPanel(page).locator('.whatsapp strong')).toHaveText(bold);
  await expect(receiptPanel(page).locator('.whatsapp em')).toHaveText(italic);
});

Then('the Receipt template lists the placeholders the app can fill', async ({ page, lender }) => {
  const { receipt } = await lender.get('/api/settings/messages/placeholders');
  expect(receipt.length).toBeGreaterThan(0);
  await expect(receiptPanel(page).locator('.hint')).toContainText(`Placeholders: ${receipt.map((name: string) => `{${name}}`).join(' ')}.`);
});

Then('the Receipt template is not saved', async ({ lender }) => {
  expect((await lender.get('/api/settings/messages')).receipt_template).toBe(originalReceipt.get(lender));
});

// Backups: the status lines are what the app reports, so the ones that need a state the
// shared book is not in (none yet, failed, running, password-protected) are reported to this
// browser only; the Backups the app takes, and how many it keeps, are real.

type BackupStatus = {
  running: boolean;
  encrypted: boolean;
  last_backup_at: string | null;
  last_backup_file: string | null;
  last_error: string | null;
};

const reported = new WeakMap<Page, Partial<BackupStatus>>();

async function report(page: Page, changes: Partial<BackupStatus>) {
  const already = reported.get(page);
  reported.set(page, { ...already, ...changes });
  if (already) return;
  await page.route('**/api/backups', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), ...reported.get(page) } });
  });
}

const backups = (page: Page) => section(page, 'Backups');

/** The newest Backup's file when a scenario began, to tell a new one from it. */
const lastFile = new WeakMap<Lender, string | null>();

async function noteBackups(lender: Lender) {
  lastFile.set(lender, (await lender.get('/api/backups')).last_backup_file);
}

Given('no Backup has been taken yet', async ({ page }) => {
  await report(page, { last_backup_at: null, last_backup_file: null, last_error: null, running: false });
});

Given('the last Backup was taken on {day} as {string}', async ({ page }, day: Day, file: string) => {
  await report(page, { last_backup_at: `${day.iso}T10:30:00`, last_backup_file: file, last_error: null, running: false });
});

Given('the last Backup failed with {string}', async ({ page }, reason: string) => {
  await report(page, { last_backup_at: null, last_backup_file: null, last_error: reason, running: false });
});

Given('Backups are password-protected', async ({ page }) => {
  await report(page, { encrypted: true });
});

Given('a Backup is running', async ({ page }) => {
  await report(page, { running: true });
});

Given('the app keeps the last {int} Backups', async ({ lender }, keep: number) => {
  await lender.put('/api/settings/backups', { keep });
});

Given('the Backups taken so far are noted', async ({ lender }) => {
  await noteBackups(lender);
});

Then('Backups says {string}', async ({ page }, text: string) => {
  await expect(backups(page)).toContainText(text);
});

Then('Backups does not say {string}', async ({ page }, text: string) => {
  await expect(backups(page).getByRole('button', { name: 'Back up now' })).toBeVisible();
  await expect(backups(page)).not.toContainText(text);
});

Then('Back up now is available', async ({ page }) => {
  await expect(backups(page).getByRole('button', { name: 'Back up now' })).toBeEnabled();
});

Then('Back up now is disabled', async ({ page }) => {
  await expect(backups(page).getByRole('button', { name: 'Back up now' })).toBeDisabled();
});

When('the Lender starts a Backup now', async ({ page, lender }) => {
  await noteBackups(lender);
  await backups(page).getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

When('the Lender cancels the Backup', async ({ page }) => {
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
});

When('the Lender confirms the Backup', async ({ page }) => {
  await page.getByRole('dialog').getByRole('button', { name: 'Back up', exact: true }).click();
});

Then('no new Backup is taken', async ({ lender }) => {
  expect((await lender.get('/api/backups')).last_backup_file).toBe(lastFile.get(lender));
});

Then('a new Backup is taken', async ({ lender }) => {
  await expect
    .poll(
      async () => {
        const status = await lender.get('/api/backups');
        return !status.running && status.last_backup_file !== null && status.last_backup_file !== lastFile.get(lender);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
});

Then('Backups lists it as the last Backup', async ({ page, lender }) => {
  const { last_backup_file: file } = await lender.get('/api/backups');
  await expect(backups(page)).toContainText(`Last Backup`);
  await expect(backups(page)).toContainText(file);
});

When('the Lender sets Backups to keep the last {int}', async ({ page }, keep: number) => {
  await startSaving(page, 'Backups', (card) => card.getByLabel('Keep the last').fill(String(keep)));
});

Then('Backups are kept to the last {int}', async ({ lender }, keep: number) => {
  expect((await lender.get('/api/backups')).keep).toBe(keep);
});
