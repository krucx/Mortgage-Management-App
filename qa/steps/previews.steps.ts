import { expect, type Page } from '@playwright/test';
import { Given, Then, type Day, type Money } from './fixtures';
import type { Lender } from './lender';
import { shownINR } from './shown';

// The Preview a change form shows before saving (BeforeAfter), checked against the API.

type Owed = { outstanding: { total: number } };

/** A Preview headline tile: "₹X → ₹Y". */
function headline(scope: Page | ReturnType<Page['locator']>, label: string) {
  return scope.locator('.tile', { has: scope.getByText(label, { exact: true }) });
}

async function owedToday(lender: Lender, id: number) {
  const mortgage: Owed = await lender.get(`/api/mortgages/${id}`);
  return shownINR(mortgage.outstanding.total);
}

Given(
  'was also lent {money} on {day} against a {jewellery}',
  async ({ lender }, amount: Money, day: Day, description: string) => {
    await lender.lend(lender.customer!, { amount: amount.paise, description, day: day.iso });
  },
);

Then('the Preview shows it owes today what its page shows, before and after', async ({ page, lender }) => {
  const owed = await owedToday(lender, lender.mortgage!.id);
  // A coming Term Change leaves today alone.
  await expect(headline(page, 'Owed today')).toContainText(`${owed} → ${owed}`);
  await expect(headline(page, 'Owed today')).toContainText('no change');
});

Then('the Preview shows the interest over the next 12 months, before and after', async ({ page }) => {
  await expect(headline(page, 'Interest over the next 12 months')).toContainText(/₹[\d,]+ → ₹[\d,]+[+−]₹[\d,]+/);
});

Then(
  'the Preview shows what is outstanding in 3, 6 and 12 months, now and after the change',
  async ({ page }) => {
    const table = page.locator('.before-after table', { has: page.getByRole('columnheader', { name: 'After the change' }) });
    await expect(table.getByRole('columnheader')).toHaveText(['Outstanding', 'Now', 'After the change', 'Difference']);
    for (const months of [3, 6, 12]) {
      await expect(table.getByRole('row', { name: new RegExp(`^In ${months} months \\(.+\\) ₹[\\d,]+ ₹[\\d,]+ (no change|[+−]₹[\\d,]+)$`) })).toBeVisible();
    }
  },
);

Then('the Preview shows no change to the Ledger so far', async ({ page }) => {
  await expect(page.getByText('No change to the Ledger so far: only the months ahead differ.')).toBeVisible();
});

/** The Preview's sections, one per Mortgage: its Mortgage Name and the section. */
async function sections(page: Page) {
  const all = page.locator('details.tucked');
  await expect(all.first()).toBeVisible();
  const names = await all.locator('summary strong').allTextContents();
  return names.map((name) => ({ name, section: all.filter({ has: page.locator('summary strong', { hasText: name }) }) }));
}

Then('the Preview has a section for each of their Mortgages, the first open', async ({ page, lender }) => {
  const shown = await sections(page);
  // Each is a Mortgage the book holds.
  await Promise.all(shown.map(({ name }) => lender.mortgageNamed(name)));
  expect(shown).toHaveLength(2);
  await expect(shown[0].section).toHaveAttribute('open', '');
  await expect(shown[1].section).not.toHaveAttribute('open');
});

Then('each section shows what that Mortgage owes today, before and after', async ({ page, lender }) => {
  for (const { name, section } of await sections(page)) {
    // The Payment brings it down from what it owes now.
    const owed = await owedToday(lender, (await lender.mortgageNamed(name)).id);
    await expect(section.locator('summary')).toContainText(`Owed today ${owed} → ₹`);
  }
});

Then('each section lists the Payment on {day} as a Ledger step added', async ({ page }, day: Day) => {
  for (const { section } of await sections(page)) {
    if ((await section.getAttribute('open')) === null) await section.locator('summary').click();
    await expect(section.getByRole('row', { name: new RegExp(`^${day.shown} Payment \\(added\\)`) })).toBeVisible();
  }
});
