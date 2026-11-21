import { expect, type Page } from '@playwright/test';
import { Workbook } from 'exceljs';
import type { DataTable } from 'playwright-bdd';
import { Then, When, type Day } from './fixtures';
import type { Lender } from './lender';

// The Call Sheet on the Call List: exporting it, writing Call Notes on the Excel sheet and
// importing it back. The sheet imported is cut down to the rows a scenario writes, in its order,
// so a row's number in the preview is its place in the table and the work app's other Mortgages
// never reach the counts.

const HEADINGS = ['Customer', 'Phone numbers', 'Mortgage Name', 'Jewellery', 'Why listed', 'Months Unpaid', 'Outstanding', 'Loan-to-Value', 'Last Call Note', 'Called on', 'Call Note'];

/** The export, and the sheet to import, of each scenario. */
const downloads = new WeakMap<Lender, { filename: string; body: Buffer<ArrayBufferLike> }>();
const sheets = new WeakMap<Lender, { name: string; mimeType: string; buffer: Buffer<ArrayBufferLike> }>();

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const preview = (page: Page) => page.getByRole('dialog');
const status = (page: Page) => page.locator('.status');

async function exportedWorkbook(lender: Lender) {
  const workbook = new Workbook();
  await workbook.xlsx.load(downloads.get(lender)!.body as never);
  return workbook.worksheets[0];
}

/** The exported row of each Mortgage Name, as its cells by heading. */
async function exportedRows(lender: Lender) {
  const sheet = await exportedWorkbook(lender);
  const headings = (sheet.getRow(1).values as unknown[]).slice(1).map(String);
  const rows = new Map<string, Record<string, unknown>[]>();
  sheet.eachRow((row, number) => {
    if (number === 1) return;
    const cells = Object.fromEntries(headings.map((heading, i) => [heading, row.getCell(i + 1).value]));
    const name = String(cells['Mortgage Name']);
    rows.set(name, [...(rows.get(name) ?? []), cells]);
  });
  return { headings, rows };
}

/** A Mortgage's row in the Call List the API serves (every page of it). */
async function listed(lender: Lender, name: string) {
  for (let page = 1; ; page++) {
    const { items, pages } = await lender.get('/api/call-list', { page: String(page) });
    const row = items.flatMap((group: any) => group.rows).find((r: any) => r.mortgage_name === name);
    if (row) return row;
    if (page >= pages) throw new Error(`${name} is not on the Call List`);
  }
}

const cellDate = (iso: string) => new Date(`${iso}T00:00:00Z`);

// Exporting

/** Clicks an export link, which downloads the sheet, then takes the sheet as the app makes it
 * on the scenario's QA date: a download carries no X-QA-Clock header, so the one the link gets
 * is dated by the real day. */
async function exportBy(page: Page, lender: Lender, link: string, kind: 'xlsx' | 'pdf') {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: link }).click()]);
  expect(download.suggestedFilename()).toMatch(new RegExp(`^call-list-\\d{4}-\\d{2}-\\d{2}\\.${kind}$`));
  const res = await page.request.get(`/api/call-list/export.${kind}`, { headers: { 'X-QA-Clock': lender.day! } });
  expect(res.ok()).toBe(true);
  const filename = /filename="(.+)"/.exec(res.headers()['content-disposition'])![1];
  downloads.set(lender, { filename, body: await res.body() });
}

When('the Lender exports the Call List to Excel', async ({ page, lender }) => {
  await exportBy(page, lender, 'Export to Excel', 'xlsx');
});

When('the Lender exports the Call List to PDF', async ({ page, lender }) => {
  await exportBy(page, lender, 'Export to PDF', 'pdf');
});

Then('the download is named {string}', async ({ lender }, name: string) => {
  expect(downloads.get(lender)!.filename).toBe(name);
});

Then('the download is a PDF', async ({ lender }) => {
  expect(downloads.get(lender)!.body.subarray(0, 5).toString()).toBe('%PDF-');
});

Then('the Excel sheet has the columns {string}', async ({ lender }, columns: string) => {
  expect((await exportedRows(lender)).headings).toEqual(columns.split(', '));
});

Then('the Excel sheet has one row for {mortgage}, as the Call List shows it', async ({ lender }, name: string) => {
  const found = (await exportedRows(lender)).rows.get(name) ?? [];
  expect(found, `rows for ${name}`).toHaveLength(1);
  const [row] = found;
  const on = await listed(lender, name);
  expect(row['Months Unpaid']).toBe(on.months_unpaid);
  expect(row['Outstanding']).toBe(Math.floor(on.outstanding / 100));
  expect(String(row['Why listed'])).toContain(`${on.months_unpaid} Months Unpaid`);
  expect(row['Called on']).toEqual(cellDate(lender.day!));
});

Then('the Call Note column is empty for {mortgage}', async ({ lender }, name: string) => {
  const [row] = (await exportedRows(lender)).rows.get(name)!;
  expect(row['Call Note'] ?? null).toBeNull();
});

// Writing Call Notes on the sheet

When('the Lender writes these Call Notes on the exported sheet:', async ({ lender }, table: DataTable) => {
  const { rows } = await exportedRows(lender);
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('Call List');
  sheet.addRow(HEADINGS);
  for (const line of table.hashes()) {
    const cells: Record<string, unknown> = { ...(rows.get(line['Mortgage'])?.[0] ?? { 'Called on': cellDate(lender.day!) }) };
    cells['Mortgage Name'] = line['Mortgage'] || null;
    if (line['Called on']) cells['Called on'] = /^\d{4}-\d{2}-\d{2}$/.test(line['Called on']) ? cellDate(line['Called on']) : line['Called on'];
    cells['Call Note'] = line['Call Note'] || null;
    sheet.addRow(HEADINGS.map((heading) => cells[heading] ?? null));
  }
  sheets.set(lender, { name: 'call-sheet.xlsx', mimeType: XLSX, buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
});

// Importing

When('the Lender chooses that sheet to import', async ({ page, lender }) => {
  await page.locator('input[type="file"]').setInputFiles(sheets.get(lender)!);
});

When('the Lender chooses a text file to import', async ({ page }) => {
  await page.locator('input[type="file"]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Called Ramesh: will pay') });
});

When('the Lender chooses a sheet with only the columns {string} to import', async ({ page }, columns: string) => {
  const workbook = new Workbook();
  workbook.addWorksheet('Call List').addRow(columns.split(', '));
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  await page.locator('input[type="file"]').setInputFiles({ name: 'few-columns.xlsx', mimeType: XLSX, buffer });
});

When('the Lender adds the Call Notes', async ({ page }) => {
  await preview(page).getByRole('button', { name: /^Add \d+ Call Notes?$/ }).click();
  await expect(preview(page)).toBeHidden();
});

When('the Lender shows them', async ({ page }) => {
  await status(page).getByRole('button', { name: 'Show them' }).click();
});

// What the preview and the status say

Then('the preview is adding {int} Call Note(s):', async ({ page }, count: number, table: DataTable) => {
  const dialog = preview(page);
  await expect(dialog.getByRole('heading', { level: 3, name: new RegExp(`^Adding ${count} Call Notes?$`) })).toBeVisible();
  const rows = dialog.locator('.summary-row');
  await expect(rows).toHaveCount(count);
  const wanted = table.hashes();
  for (const [i, line] of wanted.entries()) {
    await expect(rows.nth(i).locator('dt')).toHaveText(`${line['Mortgage']} · ${line['Customer']}`);
    await expect(rows.nth(i).locator('dd')).toHaveText(`${line['Called on']}: ${line['Call Note']}`);
  }
});

Then('the preview has nothing to add', async ({ page }) => {
  await expect(preview(page).getByRole('heading', { level: 3, name: 'Nothing to add' })).toBeVisible();
  await expect(preview(page).getByRole('button', { name: /^Add / })).toHaveCount(0);
});

Then('the preview leaves out these rows:', async ({ page }, table: DataTable) => {
  const dialog = preview(page);
  await expect(dialog.getByRole('heading', { level: 3, name: new RegExp(`Not imported: ${table.hashes().length} rows?$`) })).toBeVisible();
  await expectRows(dialog, table);
});

Then('the rows not imported are:', async ({ page }, table: DataTable) => {
  await expectRows(preview(page), table);
});

async function expectRows(dialog: ReturnType<typeof preview>, table: DataTable) {
  const rows = dialog.locator('table tbody tr');
  await expect(rows).toHaveCount(table.hashes().length);
  for (const [i, line] of table.hashes().entries()) {
    await expect(rows.nth(i).locator('td')).toHaveText([line['Row'], line['Mortgage Name'], line['Why']]);
  }
}

Then('the preview says it left out quietly {string}', async ({ page }, what: string) => {
  await expect(preview(page).getByText(/^Left out quietly:/)).toContainText(what);
});

Then('the status says {string}', async ({ page }, text: string) => {
  await expect(status(page)).toContainText(text);
});

// What was added

async function callNotesOf(lender: Lender, name: string): Promise<{ called_on: string; note: string }[]> {
  const { id } = await lender.mortgageNamed(name);
  return (await lender.get(`/api/mortgages/${id}/call-notes`)).items;
}

Then('{mortgage} has the Call Note {string} dated {day}', async ({ lender }, name: string, note: string, day: Day) => {
  const notes = await callNotesOf(lender, name);
  expect(notes.map((n) => [n.called_on, n.note])).toContainEqual([day.iso, note]);
});

Then('{mortgage} has no Call Notes', async ({ lender }, name: string) => {
  expect(await callNotesOf(lender, name)).toEqual([]);
});

Then('{mortgage} has {int} Call Note', async ({ lender }, name: string, count: number) => {
  expect(await callNotesOf(lender, name)).toHaveLength(count);
});
