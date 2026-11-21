import { expect, type Page } from '@playwright/test';
import type { DataTable } from 'playwright-bdd';
import { Given, Then, When, type Day, type Money } from './fixtures';
import { buttons, labels, tile } from './selectors';

// The Mortgages list, New Mortgage (and the Calculator's Lend this), a Mortgage's page and
// Edit Mortgage.

const PHOTO = {
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
};
const photos = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ ...PHOTO, name: `photo-${i + 1}.png` }));

/** As the app shows paise: "₹1,00,000", "₹1,234.50". */
const shownINR = (paise: number) =>
  `₹${new Intl.NumberFormat('en-IN', paise % 100 ? { minimumFractionDigits: 2 } : { maximumFractionDigits: 0 }).format(paise / 100)}`;

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
const STATUS = { Active: 'active', Redeemed: 'redeemed', 'Waived off': 'waived', Forfeited: 'forfeited' } as const;

/** The Owed today each scenario's confirmation showed, to hold the saved Mortgage to. */
const confirmedOwed = new WeakMap<Page, string>();

// Given

Given('{string} is a Customer', async ({ lender }, name: string) => {
  await lender.addCustomer(name);
});

Given(
  'was also lent {money} on {day} against a {jewellery}',
  async ({ lender }, amount: Money, day: Day, description: string) => {
    await lender.lend(lender.customer!, { amount: amount.paise, description, day: day.iso });
  },
);

Given(
  '{string} was lent {money} on {day} against {int} Gold rings',
  async ({ lender }, name: string, amount: Money, day: Day, count: number) => {
    const customer = await lender.addCustomer(name, day.iso);
    for (let i = 0; i < count; i++) {
      await lender.lend(customer, { amount: amount.paise, description: 'Gold ring', day: day.iso });
    }
  },
);

// Made on its own first day: a Term Change starts on an Accrual Date, today or later.
Given('its Terms change to {float}% a month from {day}', async ({ lender }, rate: number, day: Day) => {
  await lender.post(
    `/api/mortgages/${lender.mortgage!.id}/term-changes`,
    { effective_on: day.iso, monthly_rate_bps: Math.round(rate * 100) },
    day.iso,
  );
});

// The Mortgages list

function listed(page: Page) {
  return page.locator('table tbody tr');
}

async function openList(page: Page, query = '') {
  await page.goto(`/mortgages${query}`);
  await expect(page.getByRole('heading', { name: 'Mortgages', exact: true })).toBeVisible();
}

// The status radios follow the URL, so they are checked once it changes, not on the click.
async function chooseStatus(page: Page, status: string) {
  const radio = page.getByRole('radio', { name: status, exact: true });
  await radio.click();
  await expect(radio).toBeChecked();
}

When('the Lender opens the Mortgages list', async ({ page }) => {
  await openList(page);
});

When(
  /^the Lender lists the (Active|Redeemed|Waived off|Forfeited) Mortgages$/,
  async ({ page }, status: string) => {
    await openList(page);
    await chooseStatus(page, status);
  },
);

When('the Lender lists the Mortgages of every status', async ({ page }) => {
  await openList(page);
  await chooseStatus(page, 'All');
});

When(
  new RegExp(`^the Lender lists the Mortgages closed in (${MONTHS.join('|')}) (\\d{4})$`),
  async ({ page }, month: string, year: string) => {
    await openList(page);
    await chooseStatus(page, 'All');
    const m = String(MONTHS.indexOf(month) + 1).padStart(2, '0');
    await page.getByLabel('Closed in').fill(`${year}-${m}`);
  },
);

When('the Lender lists the Mortgages of {string}', async ({ page, lender }, name: string) => {
  lender.customer = await lender.customerNamed(name);
  await openList(page, `?customer=${lender.customer.id}`);
});

When('the Lender shows every Customer', async ({ page }) => {
  await page.getByRole('button', { name: 'Show every Customer' }).click();
  await expect(page.locator('.filter-note')).toBeHidden();
});

When('the Lender filters the Mortgages list by {string}', async ({ page }, text: string) => {
  await openList(page);
  await page.getByRole('searchbox', { name: 'Filter Mortgages' }).fill(text);
});

When('the Lender sorts the Mortgages list by {string}', async ({ page }, column: string) => {
  await openList(page);
  await page.getByRole('button', { name: column }).click();
});

When('the Lender sorts it by {string} again', async ({ page }, column: string) => {
  await page.getByRole('button', { name: column }).click();
});

When('the Lender turns to the next page', async ({ page }) => {
  await page.getByRole('button', { name: 'Next' }).click();
});

Then(
  /^the Mortgages listed are the (Active|Redeemed|Waived off|Forfeited) ones$/,
  async ({ page }, status: keyof typeof STATUS) => {
    await expect(page.getByRole('radio', { name: status })).toBeChecked();
    // The list shown is the one asked for once every row has its status.
    await expect
      .poll(async () => new Set(await listed(page).locator('.badge').allTextContents()))
      .toEqual(new Set([STATUS[status]]));
  },
);

Then('{mortgage} is listed', async ({ page }, name: string) => {
  await expect(listed(page).getByRole('link', { name, exact: true })).toBeVisible();
});

Then('{mortgage} is not listed', async ({ page }, name: string) => {
  await expect(listed(page).first()).toBeVisible();
  await expect(listed(page).getByRole('link', { name, exact: true })).toHaveCount(0);
});

Then('the list reads {string}', async ({ page }, hint: string) => {
  await expect(page.locator('p.hint', { hasText: hint })).toBeVisible();
});

Then('the list notes {string}', async ({ page }, note: string) => {
  await expect(page.locator('.filter-note')).toContainText(note);
});

Then('every Mortgage listed is for {string}', async ({ page }, customer: string) => {
  await expect
    .poll(async () => new Set(await listed(page).locator('td:nth-child(2)').allTextContents()))
    .toEqual(new Set([customer]));
});

Then(
  /^the Mortgages are listed by Principal lent, (largest|smallest) first$/,
  async ({ page }, first: string) => {
    const lent = async () =>
      (await listed(page).locator('td:nth-child(4)').allTextContents()).map((text) =>
        Number(text.replace(/[₹,]/g, '')),
      );
    await expect
      .poll(async () => {
        const amounts = await lent();
        const sorted = [...amounts].sort((a, b) => (first === 'largest' ? b - a : a - b));
        return amounts.length > 1 && amounts.join() === sorted.join() && amounts[0] !== amounts.at(-1);
      })
      .toBe(true);
  },
);

Then(
  'the list shows {int}–{int} of {int}, page {int} of {int}',
  async ({ page }, first: number, last: number, total: number, n: number, of: number) => {
    await expect(page.getByText(`Showing ${first}–${last} of ${total}`)).toBeVisible();
    await expect(page.getByText(`Page ${n} of ${of}`)).toBeVisible();
    await expect(listed(page)).toHaveCount(last - first + 1);
  },
);

// New Mortgage

async function openNewMortgage(page: Page, query = '') {
  await page.goto(`/mortgages/new${query}`);
  await expect(page.getByRole('heading', { name: 'New Mortgage' })).toBeVisible();
}

When('the Lender starts a new Mortgage', async ({ page }) => {
  await openNewMortgage(page);
});

When('the Lender starts a new Mortgage for {string}', async ({ page, lender }, name: string) => {
  lender.customer = await lender.customerNamed(name);
  await openNewMortgage(page, `?customer=${lender.customer.id}`);
  await expect(page.getByRole('heading', { name: 'Mortgage details' })).toBeVisible();
});

When('chooses the Customer {string}', async ({ page, lender }, name: string) => {
  lender.customer = await lender.customerNamed(name);
  await page.getByRole('searchbox', { name: 'Customer' }).fill(name);
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole('heading', { name: 'Mortgage details' })).toBeVisible();
});

When('adds the Customer first', async ({ page }) => {
  await page.getByRole('link', { name: 'Add a new Customer' }).click();
});

Then('the Customer form opens, to return to the new Mortgage', async ({ page }) => {
  await expect(page).toHaveURL(/\/customers\/new\?next=mortgage$/);
  await expect(page.getByLabel(labels.customerName)).toBeVisible();
});

Then('their Active Mortgages list {mortgage}', async ({ page }, name: string) => {
  const active = page.locator('h3', { hasText: 'Active Mortgages' }).locator('xpath=following-sibling::*[1]');
  await expect(active.getByRole('link', { name, exact: true })).toBeVisible();
});

When('the Lender describes the jewellery as {string}', async ({ page }, description: string) => {
  await page.getByLabel(labels.mortgageDescription).fill(description);
});

When('the Lender names it {string}', async ({ page }, name: string) => {
  await page.getByLabel(labels.mortgageName).fill(name);
});

Then(/^the Mortgage Name (?:suggested )?is (?:still )?"([^"]*)"$/, async ({ page }, name: string) => {
  await expect(page.getByLabel(labels.mortgageName)).toHaveValue(name);
});

When(
  'fills in {money} against a {jewellery}',
  async ({ page }, amount: Money, description: string) => {
    await page.getByLabel(labels.mortgageAmount).fill(amount.typed);
    await page.getByLabel(labels.mortgageDescription).fill(description);
    await page.getByLabel('Gross weight (grams)').fill('6');
    await page.getByLabel('Net weight, gold only (grams)').fill('5.5');
    await expect(page.getByLabel(labels.mortgageName)).not.toHaveValue('');
  },
);

When('enters a start date of {day}', async ({ page }, day: Day) => {
  await page.getByLabel('Start date').fill(day.iso);
});

When('enters a Principal lent of {money}', async ({ page }, amount: Money) => {
  await page.getByLabel(labels.mortgageAmount).fill(amount.typed);
});

When(
  'enters a gross weight of {float} grams and a net weight of {float} grams',
  async ({ page }, gross: number, net: number) => {
    await page.getByLabel('Gross weight (grams)').fill(String(gross));
    await page.getByLabel('Net weight, gold only (grams)').fill(String(net));
  },
);

When('lends it through UPI', async ({ page }) => {
  await page.getByLabel('Lent Through').selectOption({ label: 'UPI' });
});

When('uploads {int} photos of it', async ({ page }, count: number) => {
  await page.locator('input[type="file"]').setInputFiles(photos(count));
  await expect(page.getByRole('img', { name: `Photo ${count}` })).toBeVisible();
});

async function createMortgage(page: Page) {
  const create = page.getByRole('button', { name: buttons.createMortgage });
  await expect(create).toBeEnabled({ timeout: 15_000 });
  await create.click();
}

When('creates the Mortgage', async ({ page }) => {
  await createMortgage(page);
});

Then(
  'the new Mortgage cannot be created: its {string} is refused',
  async ({ page }, field: string) => {
    expect(await page.getByLabel(field).evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(false);
    await createMortgage(page);
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).toHaveURL(/\/mortgages\/new/);
  },
);

async function cashLimit(lender: { get: (path: string) => Promise<{ cash_limit: number }> }) {
  return (await lender.get('/api/settings/cash-limit')).cash_limit;
}

When('enters the Cash Limit as the Principal lent, in cash', async ({ page, lender }) => {
  await page.getByLabel(labels.mortgageAmount).fill(String((await cashLimit(lender)) / 100));
  await page.getByLabel('Lent Through').selectOption({ label: 'Cash' });
});

When('the Lender enters ₹1 under the Cash Limit as the Principal lent, in cash', async ({ page, lender }) => {
  await page.getByLabel(labels.mortgageAmount).fill(String((await cashLimit(lender)) / 100 - 1));
  await page.getByLabel('Lent Through').selectOption({ label: 'Cash' });
});

Then('the Lender is warned of the cash', async ({ page, lender }) => {
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveText(
    `${shownINR(await cashLimit(lender))} in cash`,
  );
});

When('the Lender goes back', async ({ page }) => {
  await page.getByRole('dialog').getByRole('button', { name: 'Go back' }).click();
});

Then('the new Mortgage is not created', async ({ page }) => {
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page).toHaveURL(/\/mortgages\/new/);
});

Then('the Lender is asked to confirm the new Mortgage', async ({ page }) => {
  await expect(page.getByRole('dialog').getByRole('heading', { name: /^Create Mortgage / })).toBeVisible();
});

function confirmationRow(page: Page, label: string) {
  return page.getByRole('dialog').locator('.summary-row', { has: page.locator('dt', { hasText: label }) });
}

Then('the confirmation lists {string} as {string}', async ({ page }, label: string, value: string) => {
  await expect(confirmationRow(page, label).locator('dd')).toHaveText(value);
});

Then('the confirmation forecasts it with no Payments', async ({ page }) => {
  await expect(page.getByRole('dialog').getByText(/^Owed on .* with no Payments$/)).toBeVisible();
});

Then("the confirmation's Owed today is more than {money}", async ({ page }, principal: Money) => {
  const owed = confirmationRow(page, 'Owed today').locator('dd');
  await expect(owed).toHaveText(/^₹/);
  const shown = (await owed.textContent())!;
  expect(Number(shown.replace(/[₹,]/g, '')) * 100).toBeGreaterThan(principal.paise);
  confirmedOwed.set(page, shown);
});

When('the Lender confirms', async ({ page }) => {
  await page.getByRole('dialog').getByRole('button', { name: buttons.confirmAndSave }).click();
});

Then('the Mortgage\'s Outstanding is the Owed today it was confirmed with', async ({ page }) => {
  await expect(page).toHaveURL(/\/mortgages\/\d+$/);
  await expect(page.locator('.tile', { hasText: 'Outstanding on' }).locator('strong')).toHaveText(
    confirmedOwed.get(page)!,
  );
});

// Lend this

When(
  'the Lender works out {money} from {day} at {float}% a month on the Calculator',
  async ({ page }, amount: Money, start: Day, rate: number) => {
    await page.goto('/calculator');
    await page.getByLabel('Amount lent (₹)').fill(amount.typed);
    await page.getByLabel('Start date').fill(start.iso);
    await page.getByLabel('Monthly interest rate (%)').fill(String(rate));
  },
);

When('lends this', async ({ page }) => {
  const lend = page.getByRole('button', { name: 'Lend this' });
  await expect(lend).toBeEnabled({ timeout: 15_000 });
  await lend.click();
  await expect(page.getByRole('heading', { name: 'New Mortgage' })).toBeVisible();
});

Then(
  'the new Mortgage form starts from {money} on {day} at {float}% a month',
  async ({ page }, amount: Money, start: Day, rate: number) => {
    await expect(page.getByLabel(labels.mortgageAmount)).toHaveValue(amount.typed);
    await expect(page.getByLabel('Start date')).toHaveValue(start.iso);
    await expect(page.getByLabel('Monthly interest rate (%)')).toHaveValue(String(rate));
  },
);

// A Mortgage's page

Then('its tiles show what it owes today', async ({ page, lender }) => {
  const mortgage = await lender.get(`/api/mortgages/${lender.mortgage!.id}`);
  const { outstanding } = mortgage;
  await expect(page.locator('.tile', { hasText: 'Outstanding on' }).locator('strong')).toHaveText(
    shownINR(outstanding.total),
  );
  await expect(tile(page, 'Principal')).toHaveText(shownINR(outstanding.principal));
  await expect(tile(page, 'Unpaid interest')).toHaveText(shownINR(outstanding.unpaid_interest));
  await expect(tile(page, 'Advance held')).toHaveText(shownINR(mortgage.advance_held));
});

Then('its details read:', async ({ page }, details: DataTable) => {
  for (const [label, value] of details.raw()) {
    const term = page.locator('dt').filter({ hasText: new RegExp(`^${escaped(label)}$`) }).first();
    await expect(term.locator('xpath=following-sibling::dd[1]')).toHaveText(value);
  }
});

Then('its Ledger has a step {string}', async ({ page }, reading: string) => {
  // A row is named by its cells, a space between each.
  await expect(page.getByRole('row', { name: new RegExp(escaped(reading)) }).first()).toBeVisible();
});

Then('its Ledger shows its latest 8 steps', async ({ page, lender }) => {
  const { ledger } = await lender.get(`/api/mortgages/${lender.mortgage!.id}`);
  expect(ledger.length).toBeGreaterThan(8);
  await expect(page.getByText(`Showing the latest 8 of ${ledger.length} steps.`)).toBeVisible();
  await expect(page.locator('tr[class^="ledger-"]')).toHaveCount(8);
});

When('the Lender opens the complete Ledger', async ({ page }) => {
  await page.getByRole('button', { name: 'Show complete Ledger' }).click();
});

Then('the complete Ledger shows every step', async ({ page, lender }) => {
  const { ledger, name } = await lender.get(`/api/mortgages/${lender.mortgage!.id}`);
  const popup = page.getByRole('dialog', { name: `Ledger of ${name}` });
  await expect(popup.locator('tr[class^="ledger-"]')).toHaveCount(ledger.length);
});

When('records a Payment on it', async ({ page }) => {
  await page.getByRole('link', { name: 'Record a Payment' }).click();
});

Then(
  'the Payment from {string} includes {mortgage}',
  async ({ page, lender }, customer: string, mortgage: string) => {
    const { id } = await lender.customerNamed(customer);
    await expect(page).toHaveURL(new RegExp(`/payments/new\\?customer=${id}&mortgage=${lender.mortgage!.id}$`));
    await expect(page.getByRole('checkbox', { name: `Include ${mortgage}` })).toBeChecked();
  },
);

When('the Lender adds a photo to it', async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles(photos(1));
});

When('the Lender deletes its photo', async ({ page }) => {
  await page.locator('.gallery-item').getByRole('button', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
});

Then(/^the Mortgage has (\d+|no) photos?$/, async ({ page }, count: string) => {
  await expect(page).toHaveURL(/\/mortgages\/\d+$/, { timeout: 15_000 });
  if (count === 'no') {
    await expect(page.getByText('No photos yet.')).toBeVisible();
  } else {
    await expect(page.locator('.gallery-item')).toHaveCount(Number(count));
  }
});

// Edit Mortgage

async function openEdit(page: Page, id: number) {
  await page.goto(`/mortgages/${id}/edit`);
  await expect(page.getByRole('heading', { name: /^Edit / })).toBeVisible();
}

When('the Lender edits the Mortgage on {day}', async ({ page, lender }, day: Day) => {
  await lender.on(day.iso);
  await openEdit(page, lender.mortgage!.id);
});

When('the Lender edits {mortgage}', async ({ page, lender }, name: string) => {
  lender.mortgage = await lender.mortgageNamed(name);
  await openEdit(page, lender.mortgage.id);
});

When('changes its start date to {day}', async ({ page }, day: Day) => {
  await page.getByLabel('Start date').fill(day.iso);
});

When('changes its Principal lent to {money}', async ({ page }, amount: Money) => {
  await page.getByLabel(labels.mortgageAmount).fill(amount.typed);
});

When('changes its starting Terms to {float}% a month', async ({ page }, rate: number) => {
  await page.getByLabel('Monthly interest rate (%)').fill(String(rate));
});

When('renames it {string}', async ({ page }, name: string) => {
  await page.getByLabel(labels.mortgageName).fill(name);
});

Then('the edit shows what changes', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'What changes' })).toBeVisible();
  await expect(page.locator('.before-after .tile', { hasText: 'Owed today' })).toBeVisible();
});

When('the Lender saves the changes', async ({ page }) => {
  const save = page.getByRole('button', { name: 'Save changes' });
  await expect(save).toBeEnabled();
  await save.click();
});

Then('the confirmation lists only:', async ({ page }, changes: DataTable) => {
  const rows = page.getByRole('dialog').locator('.summary-row');
  await expect(rows).toHaveCount(changes.raw().length);
  for (const [label, change] of changes.raw()) {
    await expect(confirmationRow(page, label).locator('dd')).toContainText(change);
  }
});

Then('its changes cannot be saved', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();
});

Then('the edit is refused: {string}', async ({ page }, reason: string) => {
  await expect(page.locator('.status.error', { hasText: reason })).toBeVisible();
});

Then('its start date, Principal and Terms are locked', async ({ page }) => {
  for (const field of ['Start date', labels.mortgageAmount, 'Monthly interest rate (%)', 'Interest Mode']) {
    await expect(page.getByLabel(field)).toBeDisabled();
  }
  await expect(page.getByLabel(/^Part-Month Rule/)).toBeDisabled();
});

Then('its Mortgage Name can still be changed', async ({ page }) => {
  await expect(page.getByLabel(labels.mortgageName)).toBeEnabled();
});
