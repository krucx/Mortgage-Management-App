import type { Page } from '@playwright/test';

/** Header that pins the backend's request-scoped QA clock (QA_MODE=true). */
export const QA_CLOCK_HEADER = 'X-QA-Clock';
export const QA_CLOCK_NOW_HEADER = 'X-QA-Clock-Now';

export function qaClockHeaders(day: string, now?: string): Record<string, string> {
  const headers: Record<string, string> = { [QA_CLOCK_HEADER]: day };
  if (now) headers[QA_CLOCK_NOW_HEADER] = now;
  return headers;
}

/**
 * Pin the clock for every request made by `page` for the duration of `fn`, and the browser's
 * own clock to the same moment so screens that default to today (Date received) agree.
 */
export async function withClock<T>(page: Page, day: string, now: string | undefined, fn: () => Promise<T>): Promise<T> {
  await page.clock.setFixedTime(new Date(now ?? `${day}T10:30:00`));
  await page.setExtraHTTPHeaders(qaClockHeaders(day, now));
  try {
    return await fn();
  } finally {
    await page.setExtraHTTPHeaders({});
  }
}
