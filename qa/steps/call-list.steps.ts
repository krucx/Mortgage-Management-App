import { expect, type Locator, type Page } from '@playwright/test';
import type { DataTable } from 'playwright-bdd';
import { Given, Then, When, type Day, type Money } from './fixtures';
import { newPhone, type Lender } from './lender';
import { shownINR, shownPercent } from './shown';
import { dashboardFigure } from './selectors';

// The Call List, marking a Mortgage called, a Mortgage's Call Notes and the Call List
// thresholds in Settings. Figures are checked against what the API says of the same
// Mortgages on the same day, never worked out here.

const pagerText = (page: Page) => page.getByText(/^Page \d+ of \d+$/);

async function listLoaded(page: Page) {
  await expect(page.getByRole('table').or(page.getByText('Nobody to call today.'))).toBeVisible();
}

/** What `find` finds on the Call List, looked for page by page from page 1; null if nowhere. */
async function lookFor(page: Page, find: () => Locator): Promise<Locator | null> {
  await listLoaded(page);
  const at = pagerText(page);
  // From page 1, whatever an earlier lookup left: the page held is not in the URL.
  if ((await at.isVisible()) && !(await at.textContent())!.startsWith('Page 1 ')) {
    await page.reload();
    await listLoaded(page);
  }
  for (;;) {
    const found = find();
    if ((await found.count()) > 0) return found;
    const next = page.getByRole('button', { name: 'Next' });
    if (!(await next.isVisible()) || (await next.isDisabled())) return null;
    const shown = await at.textContent();
    await next.click();
    await expect(at).not.toHaveText(shown!);
  }
}

const rowOf = (page: Page, mortgage: string) => () =>
  page.getByRole('row').filter({ has: page.getByRole('link', { name: mortgage, exact: true }) });

const customerCell = (page: Page, customer: string) => () =>
  page.getByRole('cell').filter({ has: page.getByRole('link', { name: customer, exact: true }) });

async function listedRow(page: Page, mortgage: string) {
  const row = await lookFor(page, rowOf(page, mortgage));
  expect(row, `${mortgage} on the Call List`).not.toBeNull();
  return row!;
}

/** The Mortgage is listed for this reason alone (a marker's label is its full wording). */
async function expectListedFor(page: Page, mortgage: string, reason: string) {
  const row = await listedRow(page, mortgage);
  // Each marker is titled with its full wording.
  await expect(row.locator('span[title]')).toHaveCount(1);
  await expect(row.getByLabel(reason, { exact: true })).toBeVisible();
}

async function loanToValueOf(lender: Lender, mortgage: string) {
  const { id } = await lender.mortgageNamed(mortgage);
  return (await lender.get(`/api/mortgages/${id}`)).collateral.loan_to_value as number;
}

// Seeding

Given('{string} is a Customer with a second number', async ({ lender }, name: string) => {
  lender.customer = await lender.post('/api/customers', {
    name,
    address: '1 Test Street',
    phone_1: newPhone(),
    phone_2: newPhone('7'),
  });
});

Given(
  'was also lent {money} on {day} against a {jewellery} of {int} karat',
  async ({ lender }, amount: Money, day: Day, description: string, karat: number) => {
    await lender.lend(lender.customer!, { amount: amount.paise, description, day: day.iso, karat });
  },
);

const seeded = new WeakMap<Lender, number>();
const letters = (n: number) => String.fromCharCode(97 + Math.floor(n / 26)) + String.fromCharCode(97 + (n % 26));

Given(
  '{int} Customers were each lent {money} on {day} against a {jewellery}',
  async ({ lender }, count: number, amount: Money, day: Day, description: string) => {
    for (let i = 0; i < count; i++) {
      const n = seeded.get(lender) ?? 0;
      seeded.set(lender, n + 1);
      const customer = await lender.addCustomer(`Paged${letters(n)} Customer`, day.iso);
      await lender.lend(customer, { amount: amount.paise, description, day: day.iso });
    }
  },
);

Given('it was marked called with {string}', async ({ lender }, note: string) => {
  await lender.post(`/api/mortgages/${lender.mortgage!.id}/call-notes`, { note });
});

// Who is listed, and why

Then('{mortgage} is on the Call List for {string}', async ({ page }, mortgage: string, reason: string) => {
  await expectListedFor(page, mortgage, reason);
});

Then('it is on the Call List for {string}', async ({ page, lender }, reason: string) => {
  await expectListedFor(page, lender.mortgage!.name, reason);
});

Then('{mortgage} is on the Call List for its Loan-to-Value', async ({ page, lender }, mortgage: string) => {
  await expectListedFor(page, mortgage, `Loan-to-Value ${shownPercent(await loanToValueOf(lender, mortgage))}`);
});

Then('it is on the Call List as accruing today', async ({ page, lender }) => {
  await expectListedFor(page, lender.mortgage!.name, 'Accrues today');
});

Then('the Call List legend names Months Unpaid, Loan-to-Value too high and Accrues today', async ({ page }) => {
  const legend = page.getByRole('list', { name: 'What the markers mean' });
  for (const name of ['Months Unpaid', 'Loan-to-Value too high', 'Accrues today']) {
    await expect(legend.getByText(name, { exact: true })).toBeVisible();
  }
});

// Groups

type Group = {
  customer: { id: number; name: string };
  rows: { mortgage_id: number; mortgage_name: string }[];
};

async function groupOf(lender: Lender, customer: string): Promise<Group> {
  for (let page = 1; ; page++) {
    const listed = await lender.get('/api/call-list', { page: String(page) });
    const group = listed.items.find((g: Group) => g.customer.name === customer);
    if (group) return group;
    if (page * listed.page_size >= listed.total) throw new Error(`${customer} is not on the Call List`);
  }
}

Then(
  '{string} is one group of {int} Mortgages, owing what the app works out for them',
  async ({ page, lender }, customer: string, count: number) => {
    const group = await groupOf(lender, customer);
    expect(group.rows).toHaveLength(count);
    let owed = 0;
    for (const row of group.rows) owed += (await lender.get(`/api/mortgages/${row.mortgage_id}`)).outstanding.total;
    const cell = await lookFor(page, customerCell(page, customer));
    expect(cell, `${customer} on the Call List`).not.toBeNull();
    await expect(cell!).toHaveCount(1);
    await expect(cell!.getByRole('link', { name: `${count} Mortgages`, exact: true })).toHaveAttribute(
      'href',
      `/mortgages?customer=${group.customer.id}`,
    );
    await expect(cell!).toContainText(shownINR(owed));
    for (const row of group.rows) await expect(rowOf(page, row.mortgage_name)()).toHaveCount(1);
  },
);

const numbers = (lender: Lender) => lender.get(`/api/customers/${lender.customer!.id}`) as Promise<{ phone_1: string; phone_2: string }>;

Then('their Call and WhatsApp links reach both of their numbers', async ({ page, lender }) => {
  const { phone_1, phone_2 } = await numbers(lender);
  const cell = (await lookFor(page, customerCell(page, lender.customer!.name)))!;
  // The links are what is checked, not WhatsApp itself: window.open is noted, not carried out.
  await page.evaluate(() => {
    const w = window as unknown as { opened: string[] };
    w.opened = [];
    window.open = (url) => {
      w.opened.push(String(url));
      return null;
    };
  });
  for (const phone of [phone_1, phone_2]) {
    await expect(cell.getByRole('link', { name: `Call ${phone}`, exact: true })).toHaveAttribute('href', `tel:+91${phone}`);
    await cell.getByRole('button', { name: `WhatsApp ${phone}`, exact: true }).click();
    const opened = await page.evaluate(() => (window as unknown as { opened: string[] }).opened);
    const link = new URL(opened[opened.length - 1]);
    expect(`${link.origin}${link.pathname}`).toBe('https://api.whatsapp.com/send/');
    expect(link.searchParams.get('phone')).toBe(`91${phone}`);
  }
});

When('the Lender follows their Mortgages link', async ({ page, lender }) => {
  const cell = (await lookFor(page, customerCell(page, lender.customer!.name)))!;
  await cell.getByRole('link', { name: /^\d+ Mortgages?$/ }).click();
  await expect(page.getByRole('heading', { name: 'Mortgages', exact: true })).toBeVisible();
});

// Order and sorting

type Shown = { name: string; outstanding: string };

/** A Customer's rows on the Call List, in the order shown. */
async function mortgagesOf(page: Page, customer: string): Promise<Shown[]> {
  const cell = await lookFor(page, customerCell(page, customer));
  expect(cell, `${customer} on the Call List`).not.toBeNull();
  return cell!.evaluate((td) => {
    const rows: { name: string; outstanding: string }[] = [];
    let tr: Element | null = td.closest('tr');
    do {
      if (!tr!.classList.contains('call-noting')) {
        const cells = [...tr!.children].filter((c) => !c.classList.contains('call-customer'));
        rows.push({ name: cells[0].textContent!.trim(), outstanding: cells[2].textContent!.trim() });
      }
      tr = tr!.nextElementSibling;
    } while (tr && !tr.classList.contains('group-start'));
    return rows;
  });
}

Then(
  'the Call List lists the Mortgages of {string} in this order:',
  async ({ page }, customer: string, order: DataTable) => {
    const expected = order.raw().slice(1).map(([name]) => name);
    await expect.poll(async () => (await mortgagesOf(page, customer)).map((m) => m.name)).toEqual(expected);
  },
);

When('the Lender sorts the Call List by {string}', async ({ page }, column: string) => {
  const heading = page.getByRole('columnheader', { name: new RegExp(`^${column}`) });
  const before = await heading.getAttribute('aria-sort');
  await heading.getByRole('button').click();
  await expect(heading).not.toHaveAttribute('aria-sort', before ?? /^$/);
  await expect(heading).toHaveAttribute('aria-sort', /ascending|descending/);
});

async function expectSorted(page: Page, customer: string, by: (m: Shown) => string | number, direction: 1 | -1) {
  await expect
    .poll(async () => {
      const keys = (await mortgagesOf(page, customer)).map(by);
      return keys.length > 1 && keys.every((key, i) => i === 0 || (keys[i - 1] < key ? -1 : keys[i - 1] > key ? 1 : 0) * direction <= 0);
    })
    .toBe(true);
}

Then('the Mortgages of {string} are listed by Mortgage, A to Z', async ({ page }, customer: string) => {
  await expectSorted(page, customer, (m) => m.name.toLowerCase(), 1);
});

Then('the Mortgages of {string} are listed by Mortgage, Z to A', async ({ page }, customer: string) => {
  await expectSorted(page, customer, (m) => m.name.toLowerCase(), -1);
});

Then('the Mortgages of {string} are listed by Outstanding, largest first', async ({ page }, customer: string) => {
  await expectSorted(page, customer, (m) => Number(m.outstanding.replace(/[^\d.]/g, '')), -1);
});

// Paging

const pagesSeen = new WeakMap<Page, Map<number, string[]>>();

Then('the Call List shows its first twenty Customers', async ({ page }) => {
  await listLoaded(page);
  // Each Customer once, with a link to all their Mortgages.
  await expect(page.getByRole('link', { name: /^\d+ Mortgages?$/ })).toHaveCount(20);
  await expect(page.getByText(/^Showing 1–20 of \d+$/)).toBeVisible();
});

Then('every Customer on it has all their Mortgages on the same page', async ({ page }) => {
  const seen = pagesSeen.get(page) ?? new Map<number, string[]>();
  pagesSeen.set(page, seen);
  const last = Math.max(0, ...seen.keys());
  // The page asked for has arrived once the pager moves on.
  await expect
    .poll(async () => Number((await pagerText(page).textContent())!.match(/^Page (\d+)/)![1]))
    .toBeGreaterThan(last);
  const current = Number((await pagerText(page).textContent())!.match(/^Page (\d+)/)![1]);
  const groups = await page.getByRole('table').locator('tbody').evaluate((body) => {
    const found: { customer: string; says: number; shown: number }[] = [];
    for (const tr of body.children) {
      // A Customer's first row holds their cell, which spans all their rows.
      const customerCell = tr.querySelector('td[rowspan]');
      if (customerCell) {
        const says = customerCell.querySelector('a[href^="/mortgages?customer="]')!.textContent!.match(/^(\d+)/)![1];
        found.push({
          customer: customerCell.querySelector('strong')!.textContent!.trim(),
          says: Number(says),
          shown: 1,
        });
      } else if (!tr.querySelector('form')) {
        // Not the row marking one of them called.
        found[found.length - 1].shown++;
      }
    }
    return found;
  });
  expect(groups.length).toBeGreaterThan(0);
  for (const group of groups) expect(group.shown, `${group.customer}'s rows on page ${current}`).toBe(group.says);
  seen.set(current, groups.map((group) => group.customer));
});

Then('no Customer is on two pages', async ({ page }) => {
  const all = [...pagesSeen.get(page)!.values()].flat();
  expect(all.length).toBeGreaterThan(20);
  expect(new Set(all).size).toBe(all.length);
});

// Marking called

When('the Lender starts to mark {mortgage} called', async ({ page }, mortgage: string) => {
  await (await listedRow(page, mortgage)).getByRole('button', { name: /^(Mark called…|Again…)$/ }).click();
});

When('starts to mark it called', async ({ page, lender }) => {
  await (await listedRow(page, lender.mortgage!.name)).getByRole('button', { name: /^(Mark called…|Again…)$/ }).click();
});

Then("Called can't be pressed without a Call Note", async ({ page }) => {
  await expect(page.getByLabel(/^Call Note for /)).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Called', exact: true })).toBeDisabled();
});

When('the Lender types the Call Note {string}', async ({ page }, note: string) => {
  await page.getByLabel(/^Call Note for /).fill(note);
});

When('presses Called', async ({ page }) => {
  await page.getByRole('button', { name: 'Called', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

/** Saves the Call Note the open dialog confirms, and waits for the app to have stored it: the
 * dialog closes before the request is made. */
async function saveCallNote(page: Page) {
  const stored = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().includes('/call-notes'));
  await page.getByRole('dialog').getByRole('button', { name: 'Save Call Note' }).click();
  expect((await stored).ok()).toBe(true);
  await expect(page.getByRole('dialog')).toBeHidden();
}

When('the Lender saves the Call Note', async ({ page }) => {
  await saveCallNote(page);
});

When('the Lender marks {mortgage} called with {string}', async ({ page }, mortgage: string, note: string) => {
  await (await listedRow(page, mortgage)).getByRole('button', { name: /^(Mark called…|Again…)$/ }).click();
  await page.getByLabel(`Call Note for ${mortgage}`).fill(note);
  await page.getByRole('button', { name: 'Called', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(note);
  await saveCallNote(page);
});

Then('its row shows Called with {string}, and offers Again', async ({ page, lender }, note: string) => {
  const cell = (await listedRow(page, lender.mortgage!.name)).getByRole('cell').filter({ hasText: '✓ Called' });
  await expect(cell).toContainText('Called');
  await expect(cell).toContainText(note);
  await expect(cell.getByRole('button', { name: 'Again…' })).toBeVisible();
});

/** A Mortgage's Call Notes, one an item. */
const callNotes = (page: Page) => page.getByRole('list', { name: 'Call Notes' }).getByRole('listitem');

Then('its Call Notes list {string} on {day}', async ({ page }, note: string, day: Day) => {
  await expect(callNotes(page).filter({ hasText: day.shown }).filter({ hasText: note })).toBeVisible();
});

Then('its Call Notes list {int} Call Note', async ({ page }, count: number) => {
  await expect(callNotes(page)).toHaveCount(count);
});

// The thresholds in Settings

const thresholds = (page: Page) =>
  page.locator('section', { has: page.getByRole('heading', { name: 'Call List', level: 2 }) });

When('the Lender sets the Call List to {int} Months Unpaid in Settings', async ({ page }, months: number) => {
  await page.goto('/settings');
  const input = thresholds(page).getByRole('spinbutton', { name: 'Months Unpaid, or more' });
  await expect(input).toBeVisible();
  await input.fill(String(months));
  await thresholds(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

Then('the Call List thresholds are saved', async ({ page }) => {
  await expect(thresholds(page)).toContainText('Saved.');
});

// The Dashboard's figure

const noted = new WeakMap<Page, number>();


When("notes the Dashboard's {string} figure", async ({ page }, label: string) => {
  const value = dashboardFigure(page, label).locator('strong');
  await expect(value).toHaveText(/^\d+$/);
  noted.set(page, Number(await value.textContent()));
});

When('opens the Call List from that figure', async ({ page }) => {
  await dashboardFigure(page, "On today's Call List").click();
  await expect(page.getByRole('heading', { name: 'Call List', level: 2 })).toBeVisible();
});

Then('the Call List counts that many Mortgages', async ({ page }) => {
  const mortgages = noted.get(page)!;
  await listLoaded(page);
  if (mortgages === 0) await expect(page.getByText('Nobody to call today.')).toBeVisible();
  else await expect(page.getByText(new RegExp(`^${mortgages} Mortgages? for \\d+ Customers?$`))).toBeVisible();
});
