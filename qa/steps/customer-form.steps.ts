import { expect, type Page } from '@playwright/test';
import type { DataTable } from 'playwright-bdd';
import { Given, Then, When } from './fixtures';
import { newPhone } from './lender';
import { customerNamed, referrerNamed } from './people';

// The New and Edit Customer form: its fields, ID Photos and the numbers read from them,
// the Referrer picker, the confirm and the photo uploads after a save.

/** What the form sent while the scenario had it open, to check what left the laptop. */
const sent = new WeakMap<Page, { method: string; url: string; body: string }[]>();

function record(page: Page) {
  const requests: { method: string; url: string; body: string }[] = [];
  sent.set(page, requests);
  page.on('request', (request) => {
    if (request.url().includes('/api/')) {
      requests.push({ method: request.method(), url: request.url(), body: request.postData() ?? '' });
    }
  });
}

/** A form field by the start of its label: a Customer's own fields come before the
 * Referrer picker's Name and Address. */
function field(page: Page, label: string) {
  return page.getByLabel(new RegExp(`^${label}`)).first();
}

/** The status line under a field: a refusal or a warning. */
function fieldStatus(page: Page, label: string) {
  return page.locator('label', { hasText: new RegExp(`^${label}`) }).locator('.status');
}

function referrerPicker(page: Page) {
  return page.getByRole('group', { name: 'Referrer' });
}

const ID_PHOTO = { 'Aadhaar card': /^Aadhaar card photo/, 'PAN card': /^PAN card photo/ } as const;
type IdCard = keyof typeof ID_PHOTO;

/** A photo of `text` in large black letters, clear enough for the form's reader. */
async function photoOf(page: Page, text: string) {
  const png = await page.evaluate((text) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 240;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'black';
    ctx.font = 'bold 80px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 40, canvas.height / 2);
    return canvas.toDataURL('image/png').split(',')[1];
  }, text);
  return { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
}

async function addIdPhoto(page: Page, card: IdCard, text: string) {
  await page
    .getByRole('group', { name: ID_PHOTO[card] })
    .locator('input[type="file"]')
    .setInputFiles(await photoOf(page, text));
}

async function startNewCustomer(page: Page, name: string, path = '/customers/new') {
  record(page);
  await page.goto(path);
  await field(page, 'Name').fill(name);
  await field(page, 'Address').fill('1 Test Street');
  await field(page, 'Contact number 1').fill(newPhone('9'));
}

/** Save: the button waits for the backend's check of what would be saved. */
async function save(page: Page) {
  const button = page.getByRole('button', { name: 'Save', exact: true });
  await expect(button).toBeEnabled({ timeout: 15_000 });
  await button.click();
}

async function confirm(page: Page) {
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm and save' }).click();
}

async function fillIn(page: Page, details: DataTable) {
  for (const [label, value] of details.raw()) {
    await field(page, label).fill(value);
  }
}

When('the Lender starts a new Customer {string}', async ({ page }, name: string) => {
  await startNewCustomer(page, name);
});

When('the Lender starts a new Customer {string} to lend to', async ({ page }, name: string) => {
  await startNewCustomer(page, name, '/customers/new?next=mortgage');
});

When('enters their details:', async ({ page }, details: DataTable) => {
  await fillIn(page, details);
});

When(/^types "(.*)" as the (Aadhaar Number|PAN)$/, async ({ page }, value: string, label: string) => {
  await field(page, label).fill(value);
});

When('enters the Contact number 1 of {string}', async ({ page, lender }, name: string) => {
  await field(page, 'Contact number 1').fill((await customerNamed(lender, name)).phone);
});

When('enters the Contact number 1 of {string} as their Contact number 2', async ({ page, lender }, name: string) => {
  await field(page, 'Contact number 2').fill((await customerNamed(lender, name)).phone);
  await field(page, 'Contact number 2').blur();
});

When('enters the phone of the Standalone Referrer {string}', async ({ page, lender }, name: string) => {
  await field(page, 'Contact number 1').fill((await referrerNamed(lender, name)).phone);
});

When('adds their photo, Aadhaar card photo and PAN card photo', async ({ page }) => {
  await page.locator('.photo-picker input[type="file"]').setInputFiles(await photoOf(page, 'Customer'));
  await addIdPhoto(page, 'Aadhaar card', 'Aadhaar card');
  await addIdPhoto(page, 'PAN card', 'PAN card');
});

When('adds an Aadhaar card photo that reads {string}', async ({ page }, text: string) => {
  await addIdPhoto(page, 'Aadhaar card', text);
});

When('adds a PAN card photo that reads {string}', async ({ page }, text: string) => {
  await addIdPhoto(page, 'PAN card', text);
});

When('the Lender saves the Customer', async ({ page }) => {
  await save(page);
});

When('the Lender saves the Customer and confirms', async ({ page }) => {
  await save(page);
  await confirm(page);
});

When('the Lender retries the photo upload', async ({ page }) => {
  await page.getByRole('button', { name: 'Retry photo upload' }).click();
});

When(
  'the Lender adds a Customer {string} with the Aadhaar Number {string}',
  async ({ page }, name: string, aadhaar: string) => {
    await startNewCustomer(page, name);
    await field(page, 'Aadhaar Number').fill(aadhaar);
    await save(page);
    await confirm(page);
    await expect(page).toHaveURL(/\/customers\/\d+$/);
  },
);

When('the Lender edits {string} with:', async ({ page, lender }, name: string, details: DataTable) => {
  const customer = await customerNamed(lender, name);
  await page.goto(`/customers/${customer.id}`);
  await page.getByRole('link', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: `Edit ${name}` })).toBeVisible();
  await fillIn(page, details);
  await save(page);
  await expect(page.getByRole('dialog').getByRole('heading')).toHaveText(`Save changes to ${name}?`);
  await confirm(page);
  await expect(page).toHaveURL(new RegExp(`/customers/${customer.id}$`));
});

// The Referrer picker

When('picks {string} as their Referrer', async ({ page }, name: string) => {
  const picker = referrerPicker(page);
  await picker.getByRole('radio', { name: 'Existing person' }).check();
  await picker.getByRole('searchbox', { name: 'Search for the Referrer' }).fill(name);
  await picker.getByRole('button', { name: new RegExp(`^${name} · `) }).click();
  await expect(picker.getByText('Selected:')).toContainText(name);
});

When('chooses an Existing person as their Referrer but picks nobody', async ({ page }) => {
  await referrerPicker(page).getByRole('radio', { name: 'Existing person' }).check();
});

When('chooses None as their Referrer', async ({ page }) => {
  await referrerPicker(page).getByRole('radio', { name: 'None' }).check();
});

When(
  'adds a New Referrer {string} with the phone {string}',
  async ({ page }, name: string, phone: string) => {
    const picker = referrerPicker(page);
    await picker.getByRole('radio', { name: 'New Referrer' }).check();
    await picker.getByLabel('Name').fill(name);
    await picker.getByLabel('Phone').fill(phone);
  },
);

// What the form says

Then('the confirm lists:', async ({ page }, rows: DataTable) => {
  const summary = page.getByRole('dialog').locator('.summary');
  for (const [label, value] of rows.raw()) {
    await expect(summary.locator('.summary-row', { has: page.locator(`dt:text-is("${label}")`) }).locator('dd')).toHaveText(
      value,
    );
  }
});

Then('the New Mortgage form is for {string}', async ({ page }, name: string) => {
  await expect(page).toHaveURL(/\/mortgages\/new\?customer=\d+/);
  await expect(page.getByRole('heading', { name: 'New Mortgage' })).toBeVisible();
  await expect(page.getByText(name)).toBeVisible();
});

Then('Contact number 1 says {string}', async ({ page }, text: string) => {
  await expect(fieldStatus(page, 'Contact number 1')).toHaveText(text);
});

Then(
  'Contact number 1 warns that it belongs to the Referrer {string}, who becomes this Customer',
  async ({ page }, name: string) => {
    const warning = fieldStatus(page, 'Contact number 1');
    await expect(warning).toHaveClass(/warning/);
    await expect(warning.getByRole('link', { name: `${name}Referrer` })).toBeVisible();
    await expect(warning).toContainText('Saving makes them this Customer, and the people they referred move with them.');
  },
);

Then('Contact number 2 warns {string}', async ({ page }, text: string) => {
  await expect(fieldStatus(page, 'Contact number 2')).toHaveText(text);
  await expect(fieldStatus(page, 'Contact number 2')).toHaveClass(/warning/);
});

Then('the form says {string}', async ({ page }, text: string) => {
  await expect(page.locator('form .status.error')).toContainText(text);
});

Then('the Customer cannot be saved', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});

Then(/^the (Aadhaar Number|PAN) reads "(.*)", read from the photo$/, async ({ page }, label: string, value: string) => {
  await expect(field(page, label)).toHaveValue(value, { timeout: 60_000 });
  await expect(page.getByText('Read from the photo: check it.')).toBeVisible();
});

Then(/^the (?:Aadhaar Number|PAN) is no longer marked as read from the photo$/, async ({ page }) => {
  await expect(page.getByText('Read from the photo: check it.')).toBeHidden();
});

Then(/^the (Aadhaar Number|PAN) reads "(.*)" once the photo is read$/, async ({ page }, label: string, value: string) => {
  await expect(page.getByText('Reading the photo…')).toBeHidden({ timeout: 60_000 });
  await expect(field(page, label)).toHaveValue(value);
  await expect(page.getByText('Read from the photo: check it.')).toBeHidden();
});

Then('no more than the last 4 digits of {string} left the form', async ({ page }, typed: string) => {
  // Every check and save of the Customer sent the Aadhaar Number as its last 4 digits
  // (those sent before it was typed carry none).
  const aadhaars = (sent.get(page) ?? [])
    .filter(({ method, url }) => method !== 'GET' && /\/api\/customers(\/\d+)?(\/preview)?$/.test(new URL(url).pathname))
    .map(({ body }) => JSON.parse(body).aadhaar_last4)
    .filter((aadhaar) => aadhaar !== null);
  expect(aadhaars.length).toBeGreaterThan(0);
  for (const aadhaar of aadhaars) expect(aadhaar).toBe(typed.replace(/\D/g, '').slice(-4));
});

// Photo uploads

Given('the PAN card photo fails to upload the first time', async ({ page }) => {
  let failed = false;
  await page.route('**/api/customers/*/id-photos/pan', async (route) => {
    if (failed) return route.continue();
    failed = true;
    await route.fulfill({ status: 503, json: { detail: 'The photo could not be stored' } });
  });
});

Then(
  'the photo and the Aadhaar card photo were sent once, and the PAN card photo twice',
  async ({ page }) => {
    const puts = (path: string) =>
      (sent.get(page) ?? []).filter((request) => request.method === 'PUT' && new URL(request.url).pathname.endsWith(path))
        .length;
    expect(puts('/photo')).toBe(1);
    expect(puts('/id-photos/aadhaar')).toBe(1);
    expect(puts('/id-photos/pan')).toBe(2);
  },
);
