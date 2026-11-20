import type { APIRequestContext } from '@playwright/test';
import { qaClockHeaders } from './clock';

/** Thin helpers around the backend API for seeding data in E2E specs. */
export async function apiPost(
  request: APIRequestContext,
  path: string,
  body: unknown,
  headers?: Record<string, string>,
) {
  const res = await request.post(path, { data: body, headers });
  if (!res.ok()) throw new Error(`POST ${path} failed: ${res.status()} ${await res.text()}`);
  return res.json();
}

export async function createCustomer(
  request: APIRequestContext,
  customer: { name: string; address: string; phone_1: string },
) {
  return apiPost(request, '/api/customers', customer);
}

export async function createMortgage(request: APIRequestContext, mortgage: Record<string, unknown>) {
  return apiPost(request, '/api/mortgages', mortgage);
}

/** Record a Payment for one Mortgage on the pinned QA day; amounts in paise. */
export async function recordPayment(
  request: APIRequestContext,
  day: string,
  payment: { customer_id: number; mortgage_id: number; amount?: number; advance?: number; months?: number },
) {
  const { customer_id, mortgage_id, amount = 0, advance = 0, months } = payment;
  return apiPost(
    request,
    '/api/payments',
    {
      customer_id,
      paid_on: day,
      amount: amount + advance,
      method: 'cash',
      allocations: [{ mortgage_id, amount, ...(advance ? { advance, months } : {}) }],
    },
    qaClockHeaders(day),
  );
}
