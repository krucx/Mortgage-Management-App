import { expect, type Locator, type Page } from '@playwright/test';
import { Then, When } from './fixtures';
import type { Lender } from './lender';

// A rupee amount field on any screen: found by its label, then stepped from the keyboard
// and the mouse wheel as the Lender does in a real browser.

const fieldOf = new WeakMap<Page, Locator>();

/** Opens `screen` on the scenario's Mortgage and brings `field` into view. */
const screens: Record<string, (page: Page, lender: Lender, field: string) => Promise<void>> = {
  'the New Mortgage': async (page, lender) => {
    await page.goto(`/mortgages/new?customer=${lender.customer!.id}`);
  },
  'the Edit Mortgage': async (page, lender) => {
    await page.goto(`/mortgages/${lender.mortgage!.id}/edit`);
  },
  'the Mortgage': async (page, lender, field) => {
    await page.goto(`/mortgages/${lender.mortgage!.id}`);
    const opens: Record<string, string> = {
      'Collateral Value': 'Set by hand…',
      'Received now': 'Waive off…',
      'Recovered Amount': 'Forfeit…',
    };
    await page.getByRole('button', { name: opens[field] }).click();
  },
  // Largest lent first, so the scenario's own Mortgage is on the first page.
  'the Closures page': async (page, lender, field) => {
    await page.goto('/closures?forfeit_sort=-lent');
    await page.getByRole('checkbox', { name: `Choose ${lender.mortgage!.name}` }).click();
    if (field === 'Received now') await page.getByRole('radio', { name: 'Waive off' }).click();
  },
};

When(
  /^the Lender finds the rupee field "([^"]+)" on (.+)$/,
  async ({ page, lender }, field: string, screen: string) => {
    await screens[screen](page, lender, field);
    const input = page.getByRole('spinbutton', { name: new RegExp(`^${field}`) });
    await expect(input).toBeEditable();
    fieldOf.set(page, input);
  },
);

When('types {float} into it', async ({ page }, rupees: number) => {
  await fieldOf.get(page)!.fill(rupees.toFixed(2));
});

When('the Lender presses its up arrow', async ({ page }) => {
  await fieldOf.get(page)!.press('ArrowUp');
});

When('the Lender scrolls down over it twice', async ({ page }) => {
  const input = fieldOf.get(page)!;
  await input.focus();
  // One notch at a time, over the field where it is now: a Preview arriving below it can
  // move the page under the mouse and lose a notch, so a notch that left the value as it
  // was is scrolled again.
  for (let i = 0; i < 2; i++) {
    const before = await input.inputValue();
    await expect(async () => {
      if ((await input.inputValue()) === before) {
        await input.hover();
        await page.mouse.wheel(0, 100);
      }
      await expect(input).not.toHaveValue(before, { timeout: 1000 });
    }).toPass();
  }
});

Then('the rupee field holds {float} and is valid', async ({ page }, rupees: number) => {
  const input = fieldOf.get(page)!;
  await expect.poll(async () => Number(await input.inputValue())).toBe(rupees);
  expect(await input.evaluate((element: HTMLInputElement) => element.validity.valid)).toBe(true);
});
