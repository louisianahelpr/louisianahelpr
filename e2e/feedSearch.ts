import type { Page } from "@playwright/test";

/**
 * Type into the JOB FEED's search, at any width (Q2205, 2026-10-19).
 *
 * The feed is Jobs > Browse (/jobs). On a phone its search is the top bar's
 * always-open "Search jobs" field (SectionSearchBar, the Vinted header, owner
 * 11-08); on the desktop website it is the feed strip's expanding field behind
 * a "Search jobs" magnifier (BrowseSearchBar). This presses the magnifier when
 * the width has one.
 */
export async function searchFeed(page: Page, text: string, opts: { timeout?: number } = {}) {
  const trigger = page.locator("[data-feed-strip] [data-search-trigger]").first();
  const field0 = page.locator('input[aria-label="Search jobs"]').filter({ visible: true }).first();
  // The feed can paint after this is called (lead 11-01: the prod canary checked both triggers before Browse had
  // drawn, pressed neither, then waited 60 s for a field nobody opened). Wait for either first.
  await trigger.or(field0).first().waitFor({ state: "visible", timeout: opts.timeout ?? 60_000 });
  if (await trigger.isVisible().catch(() => false)) await trigger.click(opts);
  const field = page.locator('input[aria-label="Search jobs"]').filter({ visible: true }).first();
  await field.waitFor({ state: "visible", timeout: opts.timeout ?? 60_000 });
  await field.fill(text);
}
