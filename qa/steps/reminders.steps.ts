import { expect, type Locator, type Page } from '@playwright/test';
import { Then, When, type Day } from './fixtures';
import type { Lender } from './lender';
import { dashboardFigure, whatsAppBubble } from './selectors';

// The Reminders page: who is listed under which tab, sending on WhatsApp, skipping, and the
// Reminder settings and Dashboard figure that shape the queue. What a Reminder says is checked
// against the message the API gives for the same Reminder, never worded here.

type Reminder = {
  id: number;
  customer: { name: string };
  accrues_on: string;
  status: string;
  message: string;
  phones: string[];
  mortgages: { name: string }[];
};

const flat = (text: string) => text.replace(/\s+/g, ' ').trim();
const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The Reminder the scenario last opened, for what follows ("the Reminder"). */
const current = new WeakMap<Page, { customer: string; day: Day }>();

/** The Customer's Reminder for `day`, whatever its status, as the API has it. */
async function reminderOf(lender: Lender, customer: string, day: Day): Promise<Reminder> {
  for (let page = 1; ; page++) {
    const { items, total, page_size } = await lender.get('/api/reminders', { page: String(page) });
    const found = items.filter((r: Reminder) => r.customer.name === customer && r.accrues_on === day.iso);
    if (found.length > 0) return found[0];
    if (page * page_size >= total) throw new Error(`no Reminder to ${customer} for ${day.shown}`);
  }
}

function reminderRows(page: Page, customer: string) {
  return page.getByRole('row').filter({ has: page.getByRole('link', { name: customer, exact: true }) });
}

/** The Customer's Reminder rows, paging from page 1 through the list (twenty a page, and every
 * work scenario queues one) until they show or the last page is reached. */
async function findReminder(page: Page, customer: string) {
  const rows = reminderRows(page, customer);
  const next = page.getByRole('button', { name: 'Next' });
  const at = page.getByText(/^Page \d+ of \d+$/);
  // From page 1, whatever an earlier lookup left: the page held is not in the URL.
  if ((await at.isVisible()) && !(await at.textContent())!.startsWith('Page 1 ')) {
    await page.reload();
    await expect(page.getByRole('table')).toBeVisible();
  }
  while ((await rows.count()) === 0 && (await next.isVisible()) && (await next.isEnabled())) {
    const shown = await at.textContent();
    await next.click();
    await expect(at).not.toHaveText(shown!);
  }
  return rows;
}

/** The one row of the Customer's Reminder for `day`, on whatever page it is. */
async function reminderRow(page: Page, customer: string, day: Day) {
  const row = (await findReminder(page, customer)).filter({ hasText: day.shown });
  await expect(row).toHaveCount(1);
  current.set(page, { customer, day });
  return row;
}

const listLoaded = (page: Page) => expect(page.getByRole('table').or(page.getByText('No Reminders here.'))).toBeVisible();

const badge = (row: Locator) => row.locator('.badge');

When('the Lender opens the Reminders page on {day}', async ({ page, lender }, day: Day) => {
  await lender.on(day.iso);
  await page.goto('/reminders');
  await listLoaded(page);
});

// The API's status for each tab; "All" asks for none.
const TAB_STATUS: Record<string, string | undefined> = {
  'To approve': 'awaiting_approval',
  'To send': 'queued',
  Sent: 'sent',
  Skipped: 'skipped',
  All: undefined,
};

When('the Lender opens the Reminders tab {string}', async ({ page, lender }, tab: string) => {
  const status = TAB_STATUS[tab];
  await page.getByRole('radio', { name: tab, exact: true }).click();
  await expect(page.getByRole('radio', { name: tab, exact: true })).toBeChecked();
  // The page keeps the previous tab's list on screen until the new one arrives, so a table or
  // an empty note being visible says nothing about this tab. Wait for the list to show what
  // the API holds for it, on page 1, before anything looks for a row.
  const { total } = await lender.get('/api/reminders', status ? { status, page: '1' } : { page: '1' });
  if (total === 0) await expect(page.getByText('No Reminders here.')).toBeVisible();
  else await expect(pagerText(page)).toHaveText(new RegExp(`^Showing 1–\\d+ of ${total}$`));
  if (status) await expect(page.locator('tbody .badge:not(.reminder-' + status + ')')).toHaveCount(0);
});

Then('no Reminder is listed for {string}', async ({ page }, customer: string) => {
  await expect(await findReminder(page, customer)).toHaveCount(0);
});

Then('a Reminder to {string} for {day} is to send', async ({ page }, customer: string, day: Day) => {
  await expect(badge(await reminderRow(page, customer, day))).toHaveText('to send');
});

Then('a Reminder to {string} for {day} is to approve', async ({ page }, customer: string, day: Day) => {
  await expect(badge(await reminderRow(page, customer, day))).toHaveText('to approve');
});

Then('a Reminder to {string} for {day} is sent', async ({ page }, customer: string, day: Day) => {
  await expect(badge(await reminderRow(page, customer, day))).toHaveText(/^sent /);
});

Then('a Reminder to {string} for {day} is sent on {day}', async ({ page }, customer: string, day: Day, sent: Day) => {
  // The QA clock's noon, when the request gives no time.
  await expect(badge(await reminderRow(page, customer, day))).toHaveText(`sent ${sent.shown}, 12:00`);
});

Then('a Reminder to {string} for {day} is skipped', async ({ page }, customer: string, day: Day) => {
  await expect(badge(await reminderRow(page, customer, day))).toHaveText('skipped');
});

Then(
  'the Reminder to {string} for {day} covers {mortgage} and {mortgage}, and no other Mortgage',
  async ({ page }, customer: string, day: Day, first: string, second: string) => {
    const row = await reminderRow(page, customer, day);
    await expect(row.locator('td').nth(2).getByRole('link')).toHaveText([first, second]);
  },
);

// Paging and sorting

const pagerText = (page: Page) => page.getByText(/^Showing \d+–\d+ of \d+$/);

Then('the Reminders show their first twenty', async ({ page }) => {
  await expect(page.locator('tbody tr')).toHaveCount(20);
  await expect(pagerText(page)).toHaveText(/^Showing 1–20 of \d+$/);
  await expect(page.getByText(/^Page 1 of [2-9]\d*$/)).toBeVisible();
});

Then('the Reminders show a second page', async ({ page }) => {
  await expect(page.getByText(/^Page 2 of \d+$/)).toBeVisible();
  await expect(pagerText(page)).toHaveText(/^Showing 21–\d+ of \d+$/);
  expect(await page.locator('tbody tr').count()).toBeGreaterThan(0);
});

When('the Lender goes to the previous page of Reminders', async ({ page }) => {
  await page.getByRole('button', { name: 'Previous' }).click();
});

/** True when the keys run in one direction (more than one, or there is nothing to see). */
function inOrder(keys: string[], direction: 1 | -1) {
  return keys.length > 1 && keys.every((key, i) => i === 0 || (keys[i - 1] < key ? -1 : keys[i - 1] > key ? 1 : 0) * direction <= 0);
}

async function expectListedBy(page: Page, column: number, direction: 1 | -1) {
  await expect
    .poll(async () => {
      // The first link of each row's cell: its Customer, or its first Mortgage.
      const keys = await page
        .locator('tbody tr')
        .evaluateAll((rows, at) => rows.map((row) => row.children[at].querySelector('a')?.textContent ?? ''), column - 1);
      return inOrder(keys.map((key) => key.toLowerCase()), direction);
    })
    .toBe(true);
}

Then('the Reminders are listed by Customer, A to Z', async ({ page }) => expectListedBy(page, 1, 1));
Then('the Reminders are listed by Customer, Z to A', async ({ page }) => expectListedBy(page, 1, -1));
Then('the Reminders are listed by Mortgage, A to Z', async ({ page }) => expectListedBy(page, 3, 1));

// Sending, skipping and reading a Reminder

/** The links the page asked window.open for: window.open is noted, not carried out. */
async function noteWhatsApp(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { opened: string[] };
    w.opened = [];
    window.open = (url) => {
      w.opened.push(String(url));
      return null;
    };
  });
}

async function numbersOf(lender: Lender): Promise<string[]> {
  const { phone_1, phone_2 } = await lender.get(`/api/customers/${lender.customer!.id}`);
  return [phone_1, phone_2].filter(Boolean);
}

const dialog = (page: Page) => page.getByRole('dialog');

When('the Lender starts to send the Reminder to {string} for {day}', async ({ page }, customer: string, day: Day) => {
  await (await reminderRow(page, customer, day)).getByRole('button', { name: 'Send on WhatsApp' }).click();
  await expect(dialog(page)).toBeVisible();
});

Then('the Reminder can be sent to either of their numbers', async ({ page, lender }) => {
  const numbers = await numbersOf(lender);
  expect(numbers).toHaveLength(2);
  await expect(dialog(page).getByLabel('Send to').locator('option')).toHaveText(numbers);
});

When('the Lender sends the Reminder on WhatsApp', async ({ page }) => {
  await noteWhatsApp(page);
  await dialog(page).getByRole('button', { name: 'Send on WhatsApp' }).click();
  // Marked sent once the dialog has closed.
  await expect(dialog(page)).toBeHidden();
});

When('the Lender sends the Reminder to {string} for {day}', async ({ page }, customer: string, day: Day) => {
  await (await reminderRow(page, customer, day)).getByRole('button', { name: 'Send on WhatsApp' }).click();
  await noteWhatsApp(page);
  await dialog(page).getByRole('button', { name: 'Send on WhatsApp' }).click();
  await expect(dialog(page)).toBeHidden();
});

Then('WhatsApp opens for their second number with the Reminder text', async ({ page, lender }) => {
  const { customer, day } = current.get(page)!;
  const links = await page.evaluate(() => (window as unknown as { opened: string[] }).opened);
  expect(links).toHaveLength(1);
  const link = new URL(links[0]);
  expect(`${link.origin}${link.pathname}`).toBe('https://api.whatsapp.com/send/');
  expect(link.searchParams.get('phone')).toBe(`91${(await numbersOf(lender))[1]}`);
  expect(link.searchParams.get('text')).toBe((await reminderOf(lender, customer, day)).message);
});

When('the Lender skips the Reminder to {string} for {day}', async ({ page }, customer: string, day: Day) => {
  const row = await reminderRow(page, customer, day);
  await row.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(row).toHaveCount(0);
});

When('the Lender opens the Message of the Reminder to {string} for {day}', async ({ page }, customer: string, day: Day) => {
  await (await reminderRow(page, customer, day)).getByRole('button', { name: 'Message', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
});

When('the Lender starts to review the Reminder to {string} for {day}', async ({ page }, customer: string, day: Day) => {
  await (await reminderRow(page, customer, day)).getByRole('button', { name: 'Review and approve' }).click();
  await expect(dialog(page)).toBeVisible();
});

When('the Lender approves the Reminder', async ({ page }) => {
  await dialog(page).getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(dialog(page)).toBeHidden();
});

/** The words of a message as the preview shows them: the markers gone, the words the same. */
const shownMessage = (text: string) => flat(text.replaceAll('```', '').replace(/\*([^*\n]+)\*/g, '$1'));

async function expectPreviewIsTheMessage(page: Page, lender: Lender) {
  const { customer, day } = current.get(page)!;
  const { message } = await reminderOf(lender, customer, day);
  expect(message).not.toBe('');
  const bubble = whatsAppBubble(dialog(page));
  await expect.poll(async () => flat(await bubble.innerText())).toBe(shownMessage(message));
}

Then('the WhatsApp preview shows the Reminder text the app wrote', async ({ page, lender }) => {
  await expectPreviewIsTheMessage(page, lender);
});

Then('the Message is the Reminder text the app sent', async ({ page, lender }) => {
  await expectPreviewIsTheMessage(page, lender);
});

Then('the Reminder preview begins {string}', async ({ page }, start: string) => {
  await expect(whatsAppBubble(dialog(page))).toHaveText(new RegExp(`^${escaped(start)}`));
});

const actions = { approving: 'approve', sending: 'sent', skipping: 'skip' } as const;

Then(
  'approving, sending or skipping the Reminder to {string} for {day} is refused: {string}',
  async ({ lender }, customer: string, day: Day, reason: string) => {
    const { id } = await reminderOf(lender, customer, day);
    for (const action of Object.values(actions)) {
      expect(await lender.refusal('post', `/api/reminders/${id}/${action}`)).toBe(reason);
    }
  },
);

// Mortgages that stop accruing

When('the Lender redeems it on {day}', async ({ lender }, day: Day) => {
  await lender.post(`/api/mortgages/${lender.mortgage!.id}/redeem`, { redeemed_on: day.iso, method: 'upi' }, day.iso);
});

// The Reminder settings

const messages = (page: Page) => page.locator('section', { has: page.getByRole('heading', { name: 'WhatsApp messages' }) });
const approveFirst = (page: Page) => messages(page).getByRole('checkbox', { name: 'Approve each Reminder before it can be sent' });
const reminderTemplate = (page: Page) => messages(page).locator('textarea').nth(1);

/** Saves the messages form, and waits for the app's answer. */
async function saveMessages(page: Page) {
  const answered = page.waitForResponse((r) => r.url().includes('/api/settings/messages') && r.request().method() === 'PUT');
  await messages(page).getByRole('button', { name: 'Save', exact: true }).click();
  await answered;
}

async function openSettings(page: Page) {
  await page.goto('/settings');
  await expect(approveFirst(page)).toBeVisible();
}

When('the Lender queues Reminders {int} day(s) before an Accrual Date in Settings', async ({ page }, days: number) => {
  await openSettings(page);
  await messages(page).getByRole('spinbutton', { name: 'Queue Reminders this many days before an Accrual Date' }).fill(String(days));
  await saveMessages(page);
  await expect(messages(page).getByText('Saved.')).toBeVisible();
});

When('the Lender needs Reminders approved first in Settings', async ({ page }) => {
  await openSettings(page);
  await approveFirst(page).check();
  await saveMessages(page);
  await expect(messages(page).getByText('Saved.')).toBeVisible();
});

When('the Lender no longer needs Reminders approved first in Settings', async ({ page }) => {
  await openSettings(page);
  await approveFirst(page).uncheck();
  await saveMessages(page);
  await expect(messages(page).getByText('Saved.')).toBeVisible();
});

/** The Reminder template a scenario found, to put back. */
const originalTemplate = new WeakMap<Lender, string>();

When('the Lender tries to save the Reminder template {string} in Settings', async ({ page, lender }, template: string) => {
  originalTemplate.set(lender, (await lender.get('/api/settings/messages')).reminder_template);
  await openSettings(page);
  await reminderTemplate(page).fill(template);
  await saveMessages(page);
});

When('the Lender changes the Reminder template in Settings to {string}', async ({ page }, template: string) => {
  await openSettings(page);
  await reminderTemplate(page).fill(template);
  await saveMessages(page);
  await expect(messages(page).getByText('Saved.')).toBeVisible();
});

When('the Lender puts the Reminder template back', async ({ lender }) => {
  const current = await lender.get('/api/settings/messages');
  await lender.put('/api/settings/messages', { ...current, reminder_template: originalTemplate.get(lender)! });
});

Then('Settings refuses it, saying {string}', async ({ page }, reason: string) => {
  await expect(messages(page).locator('.status.error')).toContainText(reason);
});

Then('the Reminder template is not saved', async ({ lender }) => {
  expect((await lender.get('/api/settings/messages')).reminder_template).toBe(originalTemplate.get(lender));
});

Then('the Reminder template lists the placeholders the app can fill', async ({ page, lender }) => {
  const { reminder } = await lender.get('/api/settings/messages/placeholders');
  expect(reminder.length).toBeGreaterThan(0);
  const hint = messages(page).locator('.receipt-panel').nth(1).locator('.hint');
  await expect(hint).toContainText(`Placeholders: ${reminder.map((name: string) => `{${name}}`).join(' ')}.`);
});

// The Dashboard's figure

const noted = new WeakMap<Page, { toSend: number; tab: string }>();

const figure = (page: Page) => dashboardFigure(page, 'Reminders to send');

When('notes the Reminders to send on the Dashboard', async ({ page }) => {
  const value = figure(page).locator('strong');
  await expect(value).toHaveText(/^\d+$/);
  noted.set(page, { toSend: Number(await value.textContent()), tab: 'queued' });
});

Then('the Dashboard says some Reminders are to approve', async ({ page }) => {
  await expect(figure(page)).toContainText(/· [1-9]\d* to approve/);
});

When('opens the Reminders from that figure', async ({ page }) => {
  // The figure links to the Reminders to approve only when none is to send.
  const toSend = Number(await figure(page).locator('strong').textContent());
  const toApprove = Number(/· (\d+) to approve/.exec((await figure(page).textContent()) ?? '')?.[1] ?? 0);
  noted.set(page, { toSend, tab: toSend === 0 && toApprove > 0 ? 'awaiting_approval' : 'queued' });
  await figure(page).click();
  await expect(page.getByRole('heading', { name: 'Reminders', level: 2 })).toBeVisible();
});

Then('the Reminders tab opened is the one the figure promised', async ({ page }) => {
  const { tab } = noted.get(page)!;
  await expect(page).toHaveURL(new RegExp(`status=${tab}`));
  await expect(page.getByRole('radio', { name: tab === 'queued' ? 'To send' : 'To approve', exact: true })).toBeChecked();
});

Then('the Reminders to send are that many', async ({ page }) => {
  const { toSend } = noted.get(page)!;
  await listLoaded(page);
  if (toSend === 0) await expect(page.getByText('No Reminders here.')).toBeVisible();
  else await expect(pagerText(page)).toHaveText(new RegExp(`^Showing 1–\\d+ of ${toSend}$`));
});
