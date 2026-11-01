import type { Page } from "@playwright/test";

/**
 * Type into the JOB FEED's search, at any width (Q2205, 2026-10-19).
 *
 * The feed is Jobs > Browse (/jobs). On a phone its search is a "Search jobs"
 * icon at the end of the tabs row that opens in place (InlineListSearch, owner
 * 2026-10-28); on the desktop website it is the feed strip's expanding field
 * behind a "Search jobs" magnifier (BrowseSearchBar). This presses whichever
 * the width has.
 */
export async function searchFeed(page: Page, text: string, opts: { timeout?: number } = {}) {
  const trigger = page.locator("[data-feed-strip] [data-search-trigger]").first();
  const phoneTrigger = page.locator('[data-browse-phone-controls] button[data-jobs-search][aria-label="Search jobs"]').first();
  const field0 = page.locator('input[aria-label="Search jobs"]').filter({ visible: true }).first();
  // The feed can paint after this is called (lead 11-01: the prod canary checked both triggers before Browse had
  // drawn, pressed neither, then waited 60 s for a field nobody opened). Wait for any of the three first.
  await trigger.or(phoneTrigger).or(field0).first().waitFor({ state: "visible", timeout: opts.timeout ?? 60_000 });
  if (await trigger.isVisible().catch(() => false)) await trigger.click(opts);
  else if (await phoneTrigger.isVisible().catch(() => false)) await phoneTrigger.click(opts);
  const field = page.locator('input[aria-label="Search jobs"]').filter({ visible: true }).first();
  await field.waitFor({ state: "visible", timeout: opts.timeout ?? 60_000 });
  await field.fill(text);
}
