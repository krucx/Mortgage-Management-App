import { expect, type Page } from '@playwright/test';
import { Given, Then, When, type Day, type Money } from './fixtures';
import type { Lender } from './lender';
import { confirm } from './selectors';
import { shownINR as rupees, shownPercent as percent } from './shown';

// Gold Rates in Settings, the Collateral Value panel on a Mortgage page, and the Call List
// rows listed for their Loan-to-Value. Figures are checked against what the API says of the
// same Mortgage on the same day, never worked out here.

type Collateral = { value: number; source: 'gold_rate' | 'manual'; loan_to_value: number };

/** Collateral Value · Loan-to-Value, as the confirmation's Now and After rows show them. */
const shown = (c: Collateral) => `${rupees(c.value)} · ${percent(c.loan_to_value)}`;

/** What each page last showed of its Mortgage's Collateral, to tell whether it changed. */
const lastSeen = new WeakMap<Page, { text: string; collateral: Collateral }>();

/** The After row of the last confirmation of a value set by hand, checked once it is saved. */
const previewed = new WeakMap<Page, string>();

async function collateralOf(lender: Lender): Promise<Collateral | null> {
  return (await lender.get(`/api/mortgages/${lender.mortgage!.id}`)).collateral;
}

/** The Collateral Value panel: the block under the Mortgage page's "Collateral Value". */
function panel(page: Page) {
  return page.getByRole('heading', { name: 'Collateral Value', level: 3 }).locator('xpath=following-sibling::div[1]');
}

function goldRates(page: Page) {
  return page.locator('section', { has: page.getByRole('heading', { name: 'Gold Rates', level: 2 }) });
}

function rateInput(page: Page, karat: number) {
  return goldRates(page).getByRole('spinbutton', { name: `${karat}K Gold Rate (₹ a gram)` });
}

async function clearGoldRates(page: Page) {
  const inputs = goldRates(page).getByRole('spinbutton');
  await expect(inputs.first()).toBeVisible();
  for (const input of await inputs.all()) await input.fill('');
}

async function saveGoldRates(page: Page) {
  await goldRates(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

/** The Mortgage's row on the Call List, looked for page by page; null if it is not listed. */
async function callListRow(page: Page, mortgage: string) {
  for (;;) {
    await expect(page.getByRole('table').or(page.getByText('Nobody to call today.'))).toBeVisible();
    const row = page.getByRole('row').filter({ has: page.getByRole('link', { name: mortgage, exact: true }) });
    if ((await row.count()) > 0) return row;
    const next = page.getByRole('button', { name: 'Next' });
    if (!(await next.isVisible()) || (await next.isDisabled())) return null;
    const shown = await page.getByText(/^Page \d+ of \d+$/).textContent();
    await next.click();
    await expect(page.getByText(/^Page \d+ of \d+$/)).not.toHaveText(shown!);
  }
}

Given('the {int}K Gold Rate is {money} a gram', async ({ lender }, karat: number, rate: Money) => {
  await lender.put('/api/settings/gold-rates', [{ purity_karat: karat, rate_per_gram: rate.paise }]);
});

Given(
  '{string} was lent {money} on {day} against a {jewellery} of {int} karat',
  async ({ lender }, name: string, amount: Money, day: Day, description: string, karat: number) => {
    const customer = await lender.addCustomer(name, day.iso);
    await lender.lend(customer, { amount: amount.paise, description, day: day.iso, karat });
  },
);

When('the Lender opens the Gold Rates in Settings', async ({ page }) => {
  await page.goto('/settings');
});

When('clears every Gold Rate', async ({ page }) => {
  await clearGoldRates(page);
});

Then('the Gold Rates cannot be saved', async ({ page }) => {
  await expect(goldRates(page).getByRole('button', { name: 'Save' })).toBeDisabled();
});

When('the Lender enters {money} as the {int}K Gold Rate', async ({ page }, rate: Money, karat: number) => {
  await rateInput(page, karat).fill(rate.typed);
});

When('saves the Gold Rates', async ({ page }) => {
  await saveGoldRates(page);
});

Then('the Gold Rates are saved', async ({ page }) => {
  await expect(goldRates(page).getByText('Saved. Collateral Values now use these rates.')).toBeVisible();
});

// Only the one rate is sent, so no other scenario's Gold Rate is written back.
When(
  'the Lender sets the {int}K Gold Rate to {money} in Settings',
  async ({ page }, karat: number, rate: Money) => {
    await page.goto('/settings');
    await clearGoldRates(page);
    await rateInput(page, karat).fill(rate.typed);
    await saveGoldRates(page);
    await confirm(page);
    await expect(goldRates(page).getByText('Saved. Collateral Values now use these rates.')).toBeVisible();
  },
);

Then('it is valued at the {int}K Gold Rate of {day}', async ({ page, lender }, karat: number, day: Day) => {
  // Just after a change is confirmed, the API may answer before it is saved: wait for it.
  await expect.poll(async () => (await collateralOf(lender))?.source).toBe('gold_rate');
  const collateral = await collateralOf(lender);
  await expect(panel(page)).toContainText(`${rupees(collateral!.value)} at the ${karat}K Gold Rate of ${day.shown}`);
  lastSeen.set(page, { text: (await panel(page).locator('p').first().textContent())!, collateral: collateral! });
});

Then('its Loan-to-Value is shown', async ({ page, lender }) => {
  const collateral = await collateralOf(lender);
  await expect(panel(page)).toContainText(`Loan-to-Value ${percent(collateral!.loan_to_value)}`);
});

Then('no Loan-to-Value is shown', async ({ page }) => {
  await expect(panel(page).locator('p').first()).toBeVisible();
  await expect(panel(page)).not.toContainText('Loan-to-Value');
});

Then('its Collateral Value and Loan-to-Value have changed', async ({ page, lender }) => {
  const before = lastSeen.get(page)!;
  const now = (await collateralOf(lender))!;
  expect(now.value).not.toBe(before.collateral.value);
  expect(now.loan_to_value).not.toBe(before.collateral.loan_to_value);
  await expect(panel(page).locator('p').first()).toContainText('Loan-to-Value');
  await expect(panel(page).locator('p').first()).not.toHaveText(before.text);
});

When('the Lender starts to set its Collateral Value by hand to {money}', async ({ page }, value: Money) => {
  await panel(page).getByRole('button', { name: 'Set by hand…' }).click();
  await panel(page).getByLabel('Collateral Value (₹)').fill(value.typed);
  await panel(page).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

Then(
  'the confirmation shows its Collateral Value and Loan-to-Value now, and {money} after',
  async ({ page }, value: Money) => {
    const dialog = page.getByRole('dialog');
    const row = (label: string) => dialog.locator('.summary-row', { has: page.getByText(label, { exact: true }) }).getByRole('definition');
    await expect(row('Now (value · Loan-to-Value)')).toHaveText(shown(lastSeen.get(page)!.collateral));
    await expect(row('After')).toContainText(`${value.shown} · `);
    previewed.set(page, (await row('After').textContent())!);
  },
);

Then('its Collateral Value is {money} set by hand on {day}', async ({ page, lender }, value: Money, day: Day) => {
  await expect.poll(async () => (await collateralOf(lender))?.value).toBe(value.paise);
  const collateral = await collateralOf(lender);
  expect(collateral?.source).toBe('manual');
  // The confirmation's After is what was saved, Loan-to-Value included.
  if (previewed.has(page)) expect(previewed.get(page)).toBe(shown(collateral!));
  await expect(panel(page)).toContainText(
    `${value.shown} set by hand on ${day.shown} · Loan-to-Value ${percent(collateral!.loan_to_value)}`,
  );
});

When('the Lender starts to use the Gold Rate again', async ({ page }) => {
  await panel(page).getByRole('button', { name: 'Use the Gold Rate' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

async function trySetByHand(page: Page, typed: string) {
  await panel(page).getByRole('button', { name: 'Set by hand…' }).click();
  await panel(page).getByLabel('Collateral Value (₹)').fill(typed);
  await panel(page).getByRole('button', { name: 'Save' }).click();
}

When('the Lender tries to set its Collateral Value by hand to {money}', async ({ page }, value: Money) => {
  await trySetByHand(page, value.typed);
});

When('the Lender tries to set its Collateral Value by hand to −{money}', async ({ page }, value: Money) => {
  await trySetByHand(page, `-${value.typed}`);
});

// The form refuses it before anything is asked or sent.
Then('the Collateral Value is refused and none is set by hand', async ({ page, lender }) => {
  const input = panel(page).getByLabel('Collateral Value (₹)');
  expect(await input.evaluate((el: HTMLInputElement) => el.validity.valid)).toBe(false);
  await expect(page.getByRole('dialog')).toBeHidden();
  expect((await collateralOf(lender))?.source).not.toBe('manual');
});

Then('its Collateral Value cannot be changed', async ({ page }) => {
  await expect(panel(page).locator('p').first()).toBeVisible();
  await expect(panel(page).getByRole('button')).toHaveCount(0);
});

Then('its Collateral Value can be set by hand', async ({ page }) => {
  await expect(panel(page).getByRole('button', { name: 'Set by hand…' })).toBeVisible();
});

Then(
  'it has no Collateral Value, and a hint to set the {int}K Gold Rate in Settings',
  async ({ page, lender }, karat: number) => {
    expect(await collateralOf(lender)).toBeNull();
    await expect(panel(page)).toContainText(`No Collateral Value yet: set the ${karat}K Gold Rate in Settings, or set a value by hand.`);
    await expect(panel(page).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  },
);

Then("the Dashboard's Collateral Value reads {string}", async ({ page }, note: string) => {
  const figure = page.getByRole('link').filter({ has: page.getByText('Collateral Value', { exact: true }) });
  await expect(figure).toContainText(note);
});

When('the Lender opens the Call List', async ({ page }) => {
  await page.goto('/call-list');
});

Then('it is not on the Call List', async ({ page, lender }) => {
  expect(await callListRow(page, lender.mortgage!.name)).toBeNull();
});

Then('it is on the Call List for its Loan-to-Value', async ({ page, lender }) => {
  const row = await callListRow(page, lender.mortgage!.name);
  expect(row, `${lender.mortgage!.name} on the Call List`).not.toBeNull();
  const collateral = await collateralOf(lender);
  await expect(row!.getByLabel(`Loan-to-Value ${percent(collateral!.loan_to_value)}`)).toBeVisible();
});
