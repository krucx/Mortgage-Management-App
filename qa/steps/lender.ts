import type { APIRequestContext, Page } from '@playwright/test';

/** Header that pins the backend's request-scoped QA clock (QA_MODE=true). */
const QA_CLOCK_HEADER = 'X-QA-Clock';

/** The golden book's last day (qa/fixtures/golden_book.py), the only day golden scenarios
 * are set on: a later one would queue its Reminders for every scenario. */
export const GOLDEN_DAY = '2025-11-15';

export type Named = { id: number; name: string };

/** A Payment's Allocation to one Mortgage, in paise: cash paid now, and an Advance held
 * for its next `months` of interest. */
export type Allocation = { mortgage: Named; cash?: number; advance?: number; months?: number };

/** A Primary Number no other scenario uses, starting with `first`. */
export function newPhone(first = '8') {
  return first + String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, '0');
}

/**
 * The Lender in one scenario: the browser and the API on the scenario's QA clock, and the
 * Customer, Mortgage and Payment the scenario is working on (what "it" and "them" mean).
 * Golden-book records are found by name, never by id, and only read: a scenario that
 * changes data seeds its own Customer and Mortgages (addCustomer, lend, pay) on the work
 * app, each on the QA date it gives.
 */
export class Lender {
  day?: string; // YYYY-MM-DD; unset, the app's own clock
  customer?: Named;
  mortgage?: Named;
  payment?: { id: number };

  constructor(
    readonly page: Page,
    private readonly request: APIRequestContext,
    private readonly golden: boolean,
  ) {}

  /** Pin the clock for every later request, and the browser's own clock to the same day so
   * screens that default to today (Date received) agree. */
  async on(day: string) {
    if (this.golden && day !== GOLDEN_DAY) {
      throw new Error(`golden scenarios are set on ${GOLDEN_DAY}, not ${day}: seed the scenario's own data instead`);
    }
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
    if (this.golden) throw new Error(`the golden book is read-only: POST ${path} belongs in a scenario that seeds its own data`);
    const res = await this.request.post(path, { data: body, headers: this.headers(day) });
    if (!res.ok()) throw new Error(`POST ${path} failed: ${res.status()} ${await res.text()}`);
    return res.json();
  }

  /** PUT on the scenario's day. */
  async put(path: string, body: unknown) {
    if (this.golden) throw new Error(`the golden book is read-only: PUT ${path} belongs in a scenario that seeds its own data`);
    const res = await this.request.put(path, { data: body, headers: this.headers(this.day) });
    if (!res.ok()) throw new Error(`PUT ${path} failed: ${res.status()} ${await res.text()}`);
    return res.json();
  }

  /** Why the app refuses a POST or DELETE asked on the scenario's day; fails if it is carried out. */
  async refusal(method: 'post' | 'delete', path: string, body?: unknown): Promise<string> {
    if (this.golden) throw new Error(`the golden book is read-only: ${method.toUpperCase()} ${path} belongs in a scenario that seeds its own data`);
    const res = await this.request[method](path, { data: body, headers: this.headers(this.day) });
    if (res.ok()) throw new Error(`${method.toUpperCase()} ${path} was carried out, not refused`);
    return (await res.json()).detail;
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

  /** A new Customer on `day`, with a Primary Number no other scenario uses. Refused if a
   * Customer of that name exists: each scenario names its own, so finding one by name is
   * never ambiguous. */
  async addCustomer(name: string, day = this.day): Promise<Named> {
    const { items } = await this.get('/api/customers', { q: name });
    if (items.some((c: Named) => c.name === name)) throw new Error(`a Customer named ${name} exists: name this one apart`);
    this.customer = await this.post('/api/customers', { name, address: '1 Test Street', phone_1: newPhone() }, day);
    return this.customer!;
  }

  /** A Mortgage lent to `customer` on `day` against a piece of 6 grams (5.5 of `karat`
   * gold, 22 unless given); its Mortgage Name is the one the app suggests. Amount in paise. */
  async lend(
    customer: Named,
    { amount, description, day = this.day, karat = 22 }: { amount: number; description: string; day?: string; karat?: number },
  ) {
    this.mortgage = await this.post(
      '/api/mortgages',
      {
        customer_id: customer.id,
        start_date: day,
        amount_lent: amount,
        description,
        gross_weight_mg: 6_000,
        net_weight_mg: 5_500,
        purity_karat: karat,
        lent_through: 'upi',
      },
      day,
    );
    return this.mortgage!;
  }

  /** A cash Payment from `customer` on `day`, allocated across their Mortgages as the
   * payment form sends it. */
  async pay(customer: Named, allocations: Allocation[], { day = this.day }: { day?: string } = {}) {
    const sent = allocations.map(({ mortgage, cash = 0, advance = 0, months }) => ({
      mortgage_id: mortgage.id,
      amount: cash,
      ...(advance ? { advance, months } : {}),
    }));
    this.payment = await this.post(
      '/api/payments',
      {
        customer_id: customer.id,
        paid_on: day,
        amount: sent.reduce((sum, a) => sum + a.amount + (a.advance ?? 0), 0),
        method: 'cash',
        allocations: sent,
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
