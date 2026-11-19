import { defineConfig } from "@playwright/test";

// `scripts/qa-stack.sh test --mode` runs each subset on its own data: `fresh` specs (tagged
// @fresh) on none, `golden` ones on a newly seeded golden book. Unset runs them all.
const FRESH = /@fresh/;
const specs = process.env.QA_SPECS;

export default defineConfig({
  testDir: "./e2e",
  grep: specs === "fresh" ? FRESH : undefined,
  grepInvert: specs === "golden" ? FRESH : undefined,
  use: {
    baseURL: process.env.BASE_URL ?? "http://app:8000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium", viewport: { width: 1280, height: 720 } } },
    {
      name: "mobile",
      // Golden-book specs change the book, so they run once, at desktop width.
      testMatch: ["blank-slate.spec.ts", "responsive.spec.ts"],
      use: { browserName: "chromium", viewport: { width: 375, height: 667 } },
    },
  ],
});
