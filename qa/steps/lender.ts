import type { APIRequestContext, Page } from '@playwright/test';

/** Header that pins the backend's request-scoped QA clock (QA_MODE=true). */
export const QA_CLOCK_HEADER = 'X-QA-Clock';

export type Named = { id: number; name: string };

/**
 * The Lender in one scenario: the browser and the API on the scenario's QA clock, and the
 * Customer, Mortgage and Payment the scenario is working on (what "it" and "them" mean).
 * Golden-book records are found by name, never by id.
 */
export class Lender {
  day?: string; // YYYY-MM-DD; unset, the app's own clock
  customer?: Named;
  mortgage?: Named;
  payment?: { id: number };

  constructor(
    readonly page: Page,
    private readonly request: APIRequestContext,
  ) {}

  /** Pin the clock for every later request, and the browser's own clock to the same day so
   * screens that default to today (Date received) agree. */
  async on(day: string) {
    this.day = day;
    await this.page.clock.setFixedTime(new Date(`${day}T10:30:00`));
    await this.page.setExtraHTTPHeaders({ [QA_CLOCK_HEADER]: day });
  }

  async get(path: string, params: Record<string, string> = {}) {
    const res = await this.request.get(path, { params, headers: this.headers(this.day) });
    if (!res.ok()) throw new Error(`GET ${path} failed: ${res.status()} ${await res.text()}`);
    return res.json();
  }

  /** POST on `day` (default: the scenario's day). */
  async post(path: string, body: unknown, day = this.day) {
    const res = await this.request.post(path, { data: body, headers: this.headers(day) });
    if (!res.ok()) throw new Error(`POST ${path} failed: ${res.status()} ${await res.text()}`);
    return res.json();
  }

  async customerNamed(name: string): Promise<Named> {
    return only(await this.get('/api/customers', { q: name }), (c) => c.name === name, name);
  }

  async mortgageNamed(name: string): Promise<Named> {
    return only(await this.get('/api/mortgages', { q: name, paged: 'false' }), (m) => m.name === name, name);
  }

  async paymentWithReference(reference: string): Promise<{ id: number }> {
    return only(await this.get('/api/payments', { q: reference }), (p) => p.reference === reference, reference);
  }

  /** A new Customer, with a Primary Number no other scenario uses. */
  async addCustomer(name: string, day?: string): Promise<Named> {
    const phone_1 = '8' + String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
    this.customer = await this.post('/api/customers', { name, address: '1 Test Street', phone_1 }, day);
    return this.customer!;
  }

  /** A Payment from `customer` to `mortgage`, as the payment form sends it; amounts in paise. */
  async pay(
    customer: Named,
    mortgage: Named,
    { amount = 0, advance = 0, months, day = this.day }: { amount?: number; advance?: number; months?: number; day?: string },
  ) {
    this.payment = await this.post(
      '/api/payments',
      {
        customer_id: customer.id,
        paid_on: day,
        amount: amount + advance,
        method: 'cash',
        allocations: [{ mortgage_id: mortgage.id, amount, ...(advance ? { advance, months } : {}) }],
      },
      day,
    );
    return this.payment!;
  }

  private headers(day?: string): Record<string, string> {
    return day ? { [QA_CLOCK_HEADER]: day } : {};
  }
}

function only<T extends { id: number }>(page: { items: T[] }, matches: (item: any) => boolean, what: string): T {
  const found = page.items.filter(matches);
  if (found.length !== 1) throw new Error(`expected one match for ${what}, found ${found.length}`);
  return found[0];
}
