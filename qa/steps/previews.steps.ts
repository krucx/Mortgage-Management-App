import { expect, type Page } from '@playwright/test';
import { Given, Then, type Day, type Money } from './fixtures';
import type { Lender } from './lender';
import { shownDay, shownINR } from './shown';

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

type Point = { months: number; on: string; principal: number; unpaid_interest: number; outstanding: number };
type Side = { outstanding: number; points: Point[] };
type TermChangePreview = { mortgages: { before: Side; after: Side }[] };

/** The backend's Preview of the Term Change the form holds: made and rolled back, never saved. */
async function termChangePreview(page: Page, lender: Lender) {
  const preview: TermChangePreview = await lender.post(`/api/mortgages/${lender.mortgage!.id}/term-changes/preview`, {
    effective_on: await page.getByLabel('From the Accrual Date').inputValue(),
    monthly_rate_bps: Math.round(Number(await page.getByLabel('Monthly interest rate (%)').inputValue()) * 100),
  });
  return preview.mortgages[0];
}

const at = (side: Side, months: number) => side.points.find((p) => p.months === months)!;

/** A difference as the Preview spells it: "+₹4,200", "−₹4,200" or "no change". */
const shownChange = (paise: number) => (paise === 0 ? 'no change' : `${paise > 0 ? '+' : '−'}${shownINR(Math.abs(paise))}`);

Then('the Preview shows the interest over the next 12 months, before and after', async ({ page, lender }) => {
  const { before, after } = await termChangePreview(page, lender);
  // With no Payments, what is owed grows only by interest.
  const interest = (side: Side) => {
    const owed = (p: Point) => p.principal + p.unpaid_interest;
    return owed(at(side, 12)) - owed(at(side, 0));
  };
  const [was, will] = [interest(before), interest(after)];
  await expect(headline(page, 'Interest over the next 12 months')).toHaveText(
    `Interest over the next 12 months${shownINR(was)} → ${shownINR(will)}${shownChange(will - was)}`,
  );
});

Then(
  'the Preview shows what is outstanding in 3, 6 and 12 months, now and after the change',
  async ({ page, lender }) => {
    const { before, after } = await termChangePreview(page, lender);
    const table = page.locator('.before-after table', { has: page.getByRole('columnheader', { name: 'After the change' }) });
    await expect(table.getByRole('columnheader')).toHaveText(['Outstanding', 'Now', 'After the change', 'Difference']);
    for (const months of [3, 6, 12]) {
      const [was, will] = [at(before, months), at(after, months)];
      await expect(table.getByRole('row', { name: new RegExp(`^In ${months} months `) }).locator('td')).toHaveText([
        `In ${months} months (${shownDay(was.on)})`,
        shownINR(was.outstanding),
        shownINR(will.outstanding),
        shownChange(will.outstanding - was.outstanding),
      ]);
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

Then(
  'each section shows what that Mortgage owes today, before and after the {money} allocated to it',
  async ({ page, lender }, share: Money) => {
    for (const { name, section } of await sections(page)) {
      await expect(page.getByRole('row', { name: new RegExp(`Include ${name}`) }).getByRole('cell', { name: share.shown, exact: true })).toBeVisible();
      // With no Discount, the Payment takes its share off what it owes now.
      const { outstanding }: Owed = await lender.get(`/api/mortgages/${(await lender.mortgageNamed(name)).id}`);
      await expect(section.locator('summary .hint')).toHaveText(
        `Owed today ${shownINR(outstanding.total)} → ${shownINR(outstanding.total - share.paise)}`,
      );
    }
  },
);

Then('each section lists the Payment on {day} as a Ledger step added', async ({ page }, day: Day) => {
  for (const { section } of await sections(page)) {
    if ((await section.getAttribute('open')) === null) await section.locator('summary').click();
    await expect(section.getByRole('row', { name: new RegExp(`^${day.shown} Payment \\(added\\)`) })).toBeVisible();
  }
});
