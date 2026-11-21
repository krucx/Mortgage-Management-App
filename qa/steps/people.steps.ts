import { expect, type Locator, type Page } from '@playwright/test';
import type { DataTable } from 'playwright-bdd';
import { Given, Then, When } from './fixtures';
import { newPhone } from './lender';
import { addCustomer, customerNamed } from './people';

// The Customers list, a Customer's page, a Referrer's page, and what the backend refuses.

/** The names in the Customers list, in its order. */
function listedNames(page: Page) {
  return page.getByRole('table').locator('tbody tr td:nth-child(2)');
}

/** The value beside `label` on a Customer's or Referrer's page. */
function detail(page: Page, label: string) {
  return page.locator(`dt:text-is("${label}") + dd`);
}

/** The people under a heading, such as "Customers they referred". */
function peopleUnder(page: Page, heading: string) {
  return page.locator(`h3:text-is("${heading}") + ul li`);
}

/** Exactly `names`, in order; a Referrer's link also reads "Referrer". */
async function expectPeople(people: Locator, names: string[]) {
  await expect(people).toHaveCount(names.length);
  await expect(people).toContainText(names);
}

function activeMortgages(page: Page) {
  return page.locator('table:not(.favours):not(details table) tbody tr td:first-child');
}

async function openCustomers(page: Page) {
  if (new URL(page.url(), 'http://qa').pathname !== '/customers') await page.goto('/customers');
}

// Seeding

Given('{string} is a Customer', async ({ lender }, name: string) => {
  await lender.addCustomer(name);
});

Given('{string} is a Customer with the PAN {string}', async ({ lender }, name: string, pan: string) => {
  await addCustomer(lender, name, { pan });
});

Given('{string} is a Customer who referred {string}', async ({ lender }, name: string, referred: string) => {
  const referrer = await lender.addCustomer(name);
  await addCustomer(lender, referred, { referrer: { kind: 'customer', id: referrer.id } });
});

Given(
  '{string} is a Standalone Referrer who referred {string}',
  async ({ lender }, name: string, referred: string) => {
    await addCustomer(lender, referred, { referrer: { kind: 'new', name, address: '', phone: newPhone('7') } });
  },
);

Given('{int} Customers named {string} and a number', async ({ lender }, count: number, name: string) => {
  for (let n = 1; n <= count; n++) await addCustomer(lender, `${name} ${n}`);
});

// The Customers list

When('the Lender filters the Customers list by {string}', async ({ page }, query: string) => {
  await openCustomers(page);
  await page.getByRole('searchbox', { name: 'Filter Customers' }).fill(query);
});

When('shows only Customers with an Active Mortgage', async ({ page }) => {
  // The tick is kept in the URL: it shows once the page has read it back.
  const only = page.getByRole('checkbox', { name: 'Only Customers with an Active Mortgage' });
  await only.click();
  await expect(only).toBeChecked();
});

When('the Lender sorts the list by {string}', async ({ page }, column: string) => {
  await page.getByRole('columnheader').getByRole('button', { name: column, exact: true }).click();
});

When('sorts it the other way', async ({ page }) => {
  await page.locator('th[aria-sort] button').click();
});

When('the Lender starts to delete {string} from the Customers list', async ({ page }, name: string) => {
  await openCustomers(page);
  await page.getByRole('searchbox', { name: 'Filter Customers' }).fill(name);
  await expect(listedNames(page)).toHaveText([name]);
  await page.getByRole('row', { name: new RegExp(name) }).getByRole('button', { name: 'Delete' }).click();
});

When('the Lender confirms the delete', async ({ page }) => {
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
});

Then('the Customers listed are:', async ({ page }, names: DataTable) => {
  await expect(listedNames(page)).toHaveText(names.raw().map(([name]) => name));
});

Then('the first Customer listed is {string}', async ({ page }, name: string) => {
  await expect(listedNames(page).first()).toHaveText(name);
});

Then('the Matching Referrers are:', async ({ page }, names: DataTable) => {
  await expectPeople(
    peopleUnder(page, 'Matching Referrers'),
    names.raw().map(([name]) => name),
  );
});

Then('no Matching Referrers are shown', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Matching Referrers' })).toBeHidden();
});

Then('the list says {string}', async ({ page }, text: string) => {
  await expect(page.locator('section.card').getByText(text, { exact: true })).toBeVisible();
});

Then('the pager reads {string}', async ({ page }, text: string) => {
  await expect(page.getByText(text, { exact: true })).toBeVisible();
});

Then('{int} Customer(s) is/are listed', async ({ page }, count: number) => {
  await expect(listedNames(page)).toHaveCount(count);
});

// A Customer's page, and a Referrer's

When('the Lender opens the Customer {string}', async ({ page, lender }, name: string) => {
  lender.customer = await customerNamed(lender, name);
  await page.goto(`/customers/${lender.customer.id}`);
  await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
});

When('the Lender opens their Referrer', async ({ page }) => {
  await detail(page, 'Referred by').getByRole('link').click();
});

Then('their page shows:', async ({ page }, rows: DataTable) => {
  for (const [label, value] of rows.raw()) {
    await expect(detail(page, label)).toHaveText(value);
  }
});

Then('they were referred by {string}', async ({ page }, name: string) => {
  await expect(detail(page, 'Referred by')).toHaveText(name);
});

Then('they were referred by the Standalone Referrer {string}', async ({ page }, name: string) => {
  await expect(detail(page, 'Referred by').getByRole('link')).toHaveText(`${name}Referrer`);
});

Then('they were referred by nobody', async ({ page }) => {
  await expect(detail(page, 'Referred by')).toHaveText('—');
});

Then('the Customers they referred are:', async ({ page }, names: DataTable) => {
  await expectPeople(
    peopleUnder(page, 'Customers they referred'),
    names.raw().map(([name]) => name),
  );
});

Then('their ID Photos show the Aadhaar card and the PAN card', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'ID Photos' })).toBeVisible();
  for (const card of ['Aadhaar card', 'PAN card']) {
    const photo = page.getByRole('img', { name: card, exact: true });
    await expect(photo).toBeVisible();
    // Served, not only linked.
    await expect.poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
  }
});

Then('the page warns {string}', async ({ page }, text: string) => {
  await expect(page.locator('.status.warning')).toHaveText(text);
});

Then('their latest History entry is {string}, with:', async ({ page }, what: string, changes: DataTable) => {
  const latest = page.locator('ul.history li').first();
  await expect(latest).toContainText(`${what}: `);
  for (const [change] of changes.raw()) await expect(latest).toContainText(change);
});

Then('their Advance held is the total their Mortgages hold', async ({ page, lender }) => {
  const { items } = await lender.get('/api/mortgages', { customer_id: String(lender.customer!.id), paged: 'false' });
  let held = 0;
  for (const { id } of items) held += (await lender.get(`/api/mortgages/${id}`)).advance_held;
  expect(held).toBeGreaterThan(0);
  const paise = held % 100 === 0 ? 0 : 2;
  const rupees = new Intl.NumberFormat('en-IN', { minimumFractionDigits: paise, maximumFractionDigits: paise }).format(held / 100);
  await expect(detail(page, 'Advance held')).toHaveText(`₹${rupees}`);
});

Then('their Active Mortgages are:', async ({ page }, names: DataTable) => {
  await expect(activeMortgages(page)).toHaveText(names.raw().map(([name]) => name));
});

Then('they have no Active Mortgages', async ({ page }) => {
  await expect(page.getByText('No Active Mortgages.')).toBeVisible();
});

Then('they have no Closed Mortgages', async ({ page }) => {
  await expect(activeMortgages(page).first()).toBeVisible();
  await expect(page.locator('details.tucked')).toBeHidden();
});

Then('their Closed Mortgages are:', async ({ page }, names: DataTable) => {
  const closed = page.locator('details.tucked');
  await closed.locator('summary').click();
  await expect(closed.locator('summary')).toHaveText(`Closed (${names.raw().length})`);
  await expect(closed.locator('tbody tr td:first-child')).toHaveText(names.raw().map(([name]) => name));
});

Then('the Referrer page shows {string} with the phone {string}', async ({ page }, name: string, phone: string) => {
  await expect(page).toHaveURL(/\/referrers\/\d+$/);
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(`${name} Referrer`);
  await expect(detail(page, 'Phone')).toHaveText(phone);
});

// What the backend refuses, whatever sends it

const CUSTOMER_FIELDS: Record<string, string> = {
  Name: 'name',
  'Contact number 1': 'phone_1',
  Email: 'email',
  'Aadhaar Number': 'aadhaar_last4',
  PAN: 'pan',
};

/** The last refusal, for "it is refused". */
const refusals = new WeakMap<Page, { status: number; text: string }>();

When(
  /^a new Customer is sent with "(.*)" as their (Name|Contact number 1|Email|Aadhaar Number|PAN)$/,
  async ({ page, request }, value: string, label: string) => {
    const res = await request.post('/api/customers', {
      data: { name: 'Refused Customer', address: '1 Test Street', phone_1: newPhone(), [CUSTOMER_FIELDS[label]]: value },
    });
    refusals.set(page, { status: res.status(), text: await res.text() });
  },
);

When('{string} is sent as their own Referrer', async ({ page, request, lender }, name: string) => {
  const customer = await customerNamed(lender, name);
  const res = await request.put(`/api/customers/${customer.id}`, {
    data: { name, address: '1 Test Street', phone_1: customer.phone, referrer: { kind: 'customer', id: customer.id } },
  });
  refusals.set(page, { status: res.status(), text: await res.text() });
});

Then('it is refused: {string}', async ({ page }, reason: string) => {
  const refusal = refusals.get(page)!;
  expect([409, 422]).toContain(refusal.status);
  expect(refusal.text).toContain(reason);
});
