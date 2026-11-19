import type { APIRequestContext } from '@playwright/test';

/** Thin helpers around the backend API for seeding data in E2E specs. */
export async function apiPost(request: APIRequestContext, path: string, body: unknown) {
  const res = await request.post(path, { data: body });
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
