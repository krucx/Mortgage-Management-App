import { test, expect } from '@playwright/test';
import { withClock } from './clock';

// At the desktop width (1280px); there is no phone-width run yet.
const PAGES = [
  ['dashboard', '/'],
  ['customers', '/customers'],
  ['a Mortgage with an Advance', '/mortgages/1'],
  ['a Payment', '/payments/1'],
  ['the payment form', '/payments/new?customer=1'],
] as const;

test.describe('responsive layout', () => {
  for (const [name, path] of PAGES) {
    test(`${name} fits the viewport width`, async ({ page }) => {
      await withClock(page, '2025-11-15', undefined, async () => {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 2 }).first()).toBeVisible();
        await page.waitForLoadState('networkidle');
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBe(0);
      });
    });
  }
});
