/**
 * Show a page of a list, unless it came back empty past the first page (its last item
 * was just Approved, Redeemed, marked called…): then step back a page instead of
 * showing "Showing 21–20 of 20".
 */
export function showOrStepBack<Page extends { items: unknown[]; page: number }>(
  result: Page,
  show: (page: Page) => void,
  setPage: (page: number) => void,
) {
  if (result.items.length === 0 && result.page > 1) setPage(result.page - 1)
  else show(result)
}
