import { test, expect } from "@playwright/test";

test("app answers /api/customers", async ({ request }) => {
  const res = await request.get("/api/customers");
  expect(res.ok()).toBeTruthy();
});