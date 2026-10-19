import type { Page } from "@playwright/test";

/**
 * Type into the JOB FEED's search, at any width (Q2205, 2026-10-19).
 *
 * The feed is Jobs > Browse (/jobs). On a phone its search is one permanent
 * row (BrowseCompactSearchRow: the field is always there, no trigger); on the
 * desktop website it is the feed strip's expanding field behind a "Search
 * jobs" magnifier (BrowseSearchBar). Specs that searched the old /home feed
 * pressed that magnifier at every width; this does whichever the width has.
 */
export async function searchFeed(page: Page, text: string, opts: { timeout?: number } = {}) {
  const trigger = page.locator("[data-feed-strip] [data-search-trigger]").first();
  if (await trigger.isVisible().catch(() => false)) await trigger.click(opts);
  const field = page.locator('input[aria-label="Search jobs"]').filter({ visible: true }).first();
  await field.waitFor({ state: "visible", timeout: opts.timeout ?? 60_000 });
  await field.fill(text);
}
