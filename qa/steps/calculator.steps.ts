import { expect, type Locator, type Page } from '@playwright/test';
import { Then, When, type Day, type Money } from './fixtures';
import type { Lender } from './lender';
import { shownDay, shownINR, shownPercent } from './shown';
import { tile } from './selectors';

// The Calculator: a Simulation worked out from what is on the screen, checked against the
// API's own Simulation of the same inputs. Nothing here is stored, so none of it seeds data.

type Terms = { monthly_rate_bps: number; interest_mode: string; part_month_rule: string };
type Sim = {
  on_closure: { on: string; total: number };
  interest_earned: number;
  first_month_interest: number;
  effective_annual_rate: number;
  paid_off_on: string | null;
  collateral_value: number | null;
  loan_to_value: number | null;
  points: { on: string }[];
  months: { on: string; principal: number; unpaid_interest: number }[];
};

const paise = (rupees: string) => Math.round(Number(rupees) * 100);
const dayMonth = (iso: string) => shownDay(iso).replace(/ \d{4}$/, '');
const percent2 = (ratio: number) => `${(ratio * 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}%`;
const change = (p: number) => (p === 0 ? 'no change' : `${p > 0 ? '+' : '−'}${shownINR(Math.abs(p))}`);

// The tucked-away sections: open one only if it is shut.
async function unfold(page: Page, summary: RegExp) {
  const section = page.locator('details', { has: page.locator('summary', { hasText: summary }) }).first();
  if (!(await section.evaluate((el: HTMLDetailsElement) => el.open))) await section.locator('summary').first().click();
}

const amountField = (page: Page) => page.getByLabel('Amount lent (₹)');
const compared = (page: Page) => page.getByRole('group', { name: 'Compared with' });

async function termsOf(where: Page | Locator): Promise<Terms> {
  return {
    monthly_rate_bps: Math.round(Number(await where.getByLabel('Monthly interest rate (%)').first().inputValue()) * 100),
    interest_mode: await where.getByLabel('Interest Mode').first().inputValue(),
    part_month_rule: await where.getByLabel('Part-Month Rule').first().inputValue(),
  };
}

/** Each planned Lump Sum's row: its date, amount and anything said about it. */
const lumpSums = (page: Page) => page.getByRole('group', { name: /^Lump Sum \d+$/ });

/** The Simulation the screen is asking for (the second, when other Terms are compared). */
async function asked(page: Page, second = false, span = 12) {
  const lumps = [];
  for (const row of await lumpSums(page).all()) {
    const on = await row.locator('input[type=date]').inputValue();
    const amount = await row.locator('input[type=number]').inputValue();
    if (on && amount) lumps.push({ on, amount: paise(amount) });
  }
  const monthly = await page.getByLabel('Monthly payment (₹)').inputValue();
  const mg = Math.round(Number(await page.getByLabel('Net weight, gold only (grams)').inputValue()) * 1000);
  const override = paise(await page.getByLabel('Collateral Value (₹)').inputValue());
  return {
    amount_lent: paise(await amountField(page).inputValue()),
    start_date: await page.getByLabel('Start date').inputValue(),
    closed_on: await page.getByLabel('Closed on').inputValue(),
    terms: await termsOf(second ? compared(page) : page),
    span_months: span,
    ...(monthly && { monthly_payment: paise(monthly) }),
    lump_sums: lumps,
    ...((mg || override) && {
      collateral: {
        net_weight_mg: mg,
        purity_karat: Number(await page.getByLabel('Purity').inputValue()),
        ...(override && { override }),
      },
    }),
  };
}

async function simulated(page: Page, lender: Lender, second = false, span = 12): Promise<Sim> {
  return lender.simulation(await asked(page, second, span));
}

const isCompared = (page: Page) => compared(page).isVisible();

// Opening, and the inputs

When('the Lender opens the Calculator', async ({ page }) => {
  await page.goto('/calculator');
  await expect(page.getByRole('heading', { name: 'Calculator' })).toBeVisible();
  // The Default Terms have arrived once the rate shows
  await expect(page.getByLabel('Monthly interest rate (%)')).not.toHaveValue('');
});

When('the Lender enters {money} as the amount lent', async ({ page }, amount: Money) => {
  await amountField(page).fill(amount.typed);
});

When('the Lender starts it on {day}', async ({ page }, day: Day) => {
  await page.getByLabel('Start date').fill(day.iso);
});

When('the Lender closes it on {day}', async ({ page }, day: Day) => {
  await page.getByLabel('Closed on').fill(day.iso);
});

When('the Lender enters a Monthly interest rate of {float}%', async ({ page }, rate: number) => {
  await page.getByLabel('Monthly interest rate (%)').first().fill(String(rate));
});

When('the Lender picks {string} as its Interest Mode', async ({ page }, mode: string) => {
  await page.getByLabel('Interest Mode').first().selectOption({ label: mode });
});

When('the Lender reloads the Calculator', async ({ page }) => {
  await page.reload();
  await expect(amountField(page)).toBeVisible();
});

Then('the address keeps the amount, the dates and the rate', async ({ page }) => {
  const kept = new URL(page.url()).searchParams;
  expect(kept.get('amount')).toBe(await amountField(page).inputValue());
  expect(kept.get('start')).toBe('2025-11-01');
  expect(kept.get('closed')).toBe('2026-02-01');
  expect(kept.get('rate')).toBe('2.5');
});

Then(
  'the Calculator still holds {money} lent on {day}, closed on {day}, at {float}% a month',
  async ({ page }, amount: Money, start: Day, closed: Day, rate: number) => {
    await expect(amountField(page)).toHaveValue(amount.typed);
    await expect(page.getByLabel('Start date')).toHaveValue(start.iso);
    await expect(page.getByLabel('Closed on')).toHaveValue(closed.iso);
    await expect(page.getByLabel('Monthly interest rate (%)').first()).toHaveValue(String(rate));
  },
);

Then('it still compares {float}% a month', async ({ page }, rate: number) => {
  await expect(compared(page).getByLabel('Monthly interest rate (%)')).toHaveValue(String(rate));
});

Then('it still plans {money} a month', async ({ page }, monthly: Money) => {
  await expect(page.getByLabel('Monthly payment (₹)')).toHaveValue(monthly.typed);
});

// Results tiles, and the compared Terms

async function expectTiles(page: Page, lender: Lender) {
  const runs = [await simulated(page, lender)];
  if (await isCompared(page)) runs.push(await simulated(page, lender, true));
  const labels = [await termsLabel(page)];
  if (runs.length > 1) labels.push(await termsLabel(compared(page)));
  const figures: [string, (s: Sim) => number, (n: number) => string][] = [
    [`Outstanding on ${shownDay(runs[0].on_closure.on)}`, (s) => s.on_closure.total, shownINR],
    ['Total interest earned', (s) => s.interest_earned, shownINR],
    ["First month's interest", (s) => s.first_month_interest, shownINR],
    ['Effective annual rate', (s) => s.effective_annual_rate, percent2],
  ];
  for (const [caption, figure, format] of figures) {
    const text = runs.length === 1 ? format(figure(runs[0])) : runs.map((run, i) => `${labels[i]} ${format(figure(run))}`).join(' · ');
    await expect(tile(page, caption)).toHaveText(text);
  }
  return { runs, figures };
}

/** Terms as a tile names them: "2% Simple". */
async function termsLabel(where: Page | Locator) {
  const { monthly_rate_bps, interest_mode } = await termsOf(where);
  const mode = { simple: 'Simple', compounded_yearly: 'Yearly', compounded_monthly: 'Monthly' }[interest_mode];
  return `${monthly_rate_bps / 100}% ${mode}`;
}

Then('its tiles show what it comes to', async ({ page, lender }) => {
  await expectTiles(page, lender);
});

When('the Lender compares other Terms at {float}% a month', async ({ page }, rate: number) => {
  await page.getByRole('button', { name: 'Compare other Terms' }).click();
  await compared(page).getByLabel('Monthly interest rate (%)').fill(String(rate));
});

Then('its tiles show both Terms, and how the second differs from the first', async ({ page, lender }) => {
  const { runs, figures } = await expectTiles(page, lender);
  expect(runs).toHaveLength(2);
  for (const [caption, figure] of figures.slice(0, 3)) {
    const difference = tile(page, caption).locator('xpath=following-sibling::span[@class="hint"]');
    await expect(difference).toHaveText(change(figure(runs[1]) - figure(runs[0])));
  }
});

When('the Lender removes the compared Terms', async ({ page }) => {
  await page.getByRole('button', { name: 'Remove the compared Terms' }).click();
});

Then('it compares no other Terms', async ({ page }) => {
  await expect(compared(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Compare other Terms' })).toBeVisible();
});

// Planned Payments

When('the Lender plans {money} a month', async ({ page }, monthly: Money) => {
  await unfold(page, /^Planned Payments$/);
  await page.getByLabel('Monthly payment (₹)').fill(monthly.typed);
});

When('the Lender plans a Lump Sum of {money} on {day}', async ({ page }, amount: Money, day: Day) => {
  await unfold(page, /^Planned Payments$/);
  await page.getByRole('button', { name: 'Add a Lump Sum' }).click();
  const row = lumpSums(page).last();
  await row.locator('input[type=date]').fill(day.iso);
  await row.locator('input[type=number]').fill(amount.typed);
});

/** The planned Lump Sum's row dated `day`. */
async function lumpSumOn(page: Page, day: Day) {
  for (const row of await lumpSums(page).all()) {
    if ((await row.locator('input[type=date]').inputValue()) === day.iso) return row;
  }
  throw new Error(`no Lump Sum is planned on ${day.shown}`);
}

Then('its Paid off tile gives the day it would be paid off', async ({ page, lender }) => {
  const { paid_off_on } = await simulated(page, lender);
  await expect(tile(page, 'Paid off')).toHaveText(paid_off_on ? shownDay(paid_off_on) : 'Not within 10 years');
});

Then('the Lump Sum on {day} is counted', async ({ page }, day: Day) => {
  const row = await lumpSumOn(page, day);
  await expect(row.locator('.hint')).toHaveCount(0);
  await expect(row.locator('.status')).toHaveCount(0);
});

Then('the Lump Sum on {day} reads {string}', async ({ page }, day: Day, hint: string) => {
  await expect(await lumpSumOn(page, day)).toContainText(hint);
});

Then('the Lump Sum on {day} is refused with what was owed that day', async ({ page, lender }, day: Day) => {
  const refused = (await lender.refusal('post', '/api/simulation', await asked(page))) as unknown as { owed: number; on: string };
  expect(refused.on).toBe(day.iso);
  await expect(await lumpSumOn(page, day)).toContainText(`Only ${shownINR(refused.owed)} owed on ${dayMonth(refused.on)}`);
});

Then('the Calculator says a Lump Sum is more than is owed', async ({ page }) => {
  await expect(page.getByText('A Lump Sum is more than is owed on its date: see Planned Payments.')).toBeVisible();
});

// Jewellery value

When('the Lender enters {float} grams of {int}K gold as the jewellery', async ({ page }, grams: number, karat: number) => {
  await unfold(page, /^Jewellery value$/);
  await page.getByLabel('Net weight, gold only (grams)').fill(String(grams));
  await page.getByLabel('Purity').selectOption({ label: `${karat}K` });
});

When('the Lender types {money} as the Collateral Value', async ({ page }, value: Money) => {
  await page.getByLabel('Collateral Value (₹)').fill(value.typed);
});

Then('the Calculator values the jewellery at the Gold Rate', async ({ page, lender }) => {
  const karat = Number(await page.getByLabel('Purity').inputValue());
  const rates: { purity_karat: number; rate_per_gram: number }[] = await lender.get('/api/settings/gold-rates');
  const rate = rates.find((r) => r.purity_karat === karat)!.rate_per_gram;
  const { collateral_value } = await simulated(page, lender);
  expect(collateral_value).not.toBeNull();
  await expect(page.getByText(`Collateral Value ${shownINR(collateral_value!)} at ${shownINR(rate)} a gram`)).toBeVisible();
});

Then('its Loan-to-Value is shown now and on the closed date', async ({ page, lender }) => {
  const sim = await simulated(page, lender);
  const { amount_lent, closed_on } = await asked(page);
  await expect(tile(page, 'Loan-to-Value now')).toHaveText(shownPercent(amount_lent / sim.collateral_value!));
  await expect(tile(page, `Loan-to-Value on ${shownDay(closed_on)}`)).toHaveText(shownPercent(sim.loan_to_value!));
});

Then(
  'the Calculator says there is no {int}K Gold Rate, so type a Collateral Value instead',
  async ({ page }, karat: number) => {
    await expect(page.getByText(`No Gold Rate set for ${karat}K: type a Collateral Value instead`)).toBeVisible();
  },
);

Then('it shows no Loan-to-Value', async ({ page }) => {
  await expect(tile(page, 'Outstanding on 15 Nov 2026')).toBeVisible();
  await expect(page.getByText('Loan-to-Value now', { exact: true })).toBeHidden();
});

// The Graph and Month by month

When('the Lender opens the Graph', async ({ page }) => {
  await expect(tile(page, 'Total interest earned')).not.toHaveText('₹0');
  await unfold(page, /^Graph$/);
});

When('the Lender sets the Graph span to {int} months', async ({ page }, months: number) => {
  await page.getByLabel('Graph span').selectOption({ label: `${months} months` });
});

Then('the Graph spans {int} months', async ({ page, lender }, months: number) => {
  const { points } = await simulated(page, lender, false, months);
  const [first, last] = [points[0].on, points[points.length - 1].on];
  await expect(page.getByRole('img', { name: `Outstanding from ${shownDay(first)} to ${shownDay(last)}` })).toBeVisible();
  await expect(page.getByLabel('Graph span')).toHaveValue(String(months));
});

When('the Lender opens Month by month', async ({ page }) => {
  await unfold(page, /^Month by month/);
});

Then('Month by month lists each month it worked out', async ({ page, lender }) => {
  const { months } = await simulated(page, lender);
  const rows = page.locator('details', { has: page.locator('summary', { hasText: /^Month by month/ }) }).locator('tbody tr');
  await expect(rows.locator('td:nth-child(1)')).toHaveText(months.map((m) => new RegExp(`^${shownDay(m.on)}`)));
  await expect(rows.locator('td:nth-child(5)')).toHaveText(months.map((m) => shownINR(m.principal)));
  await expect(rows.locator('td:nth-child(6)')).toHaveText(months.map((m) => shownINR(m.unpaid_interest)));
});

// Validation, and Lend this

Then('the Calculator asks for an amount', async ({ page }) => {
  await expect(page.getByText('Enter an amount to see what it would come to.')).toBeVisible();
});

Then('the Calculator asks for the marked inputs to be fixed', async ({ page }) => {
  await expect(page.getByText('Fix the inputs marked below to see what it would come to.')).toBeVisible();
});

Then('Lump Sum {int} says {string}', async ({ page }, row: number, problem: string) => {
  await expect(page.getByRole('group', { name: `Lump Sum ${row}`, exact: true })).toContainText(problem);
});

Then('Lend this is not offered', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Lend this' })).toBeDisabled();
});

Then('Lend this is offered', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Lend this' })).toBeEnabled({ timeout: 15_000 });
});

Then("the Calculator says it can't lend before the start date", async ({ page }) => {
  await expect(page.getByText("Can't lend before the start date")).toBeVisible();
});
