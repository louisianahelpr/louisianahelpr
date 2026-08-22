/**
 * The guest feed must NOT block its cards on decorative enrichment.
 *
 * DashboardGuest used to run one query that awaited the job list and THEN
 * awaited poster names + rating stats before resolving, so `isLoading` stayed
 * true for the whole chain. Measured on production: the page painted at 244ms,
 * the job list landed at ~1.3s, and the cards did not appear until ~2.3s. That
 * last second bought nothing the card renders — JobCard reads only the rating
 * badge, and only when reviewCount > 0.
 *
 * This pins the split: with the enrichment endpoints held open, the job cards
 * must still be on screen. If someone re-merges the two queries, the cards will
 * wait on the delayed request and this fails.
 */
import { test, expect, installSupabaseMocks } from "./fixtures";
import { SEED_JOBS } from "./seedData";

/** Long enough that a blocked feed cannot possibly beat it. */
const ENRICH_DELAY_MS = 5000;

test("guest job cards render while poster enrichment is still in flight", async ({ page }) => {
  await installSupabaseMocks(page, {
    seed: true,
    rules: [
      {
        // open_jobs_browse is a VIEW and is not in SEED_TABLES, so the feed
        // would otherwise render empty and this test would pass vacuously.
        match: (url, method) => method === "GET" && url.pathname === "/rest/v1/open_jobs_browse",
        handle: () => ({
          status: 200,
          body: (SEED_JOBS as Record<string, unknown>[])
            .filter((j) => j.status === "open")
            .slice(0, 6),
        }),
      },
    ],
  });

  // Hold the two enrichment calls open. Registered AFTER installSupabaseMocks
  // so this handler takes precedence for these paths.
  let enrichmentResolved = false;
  await page.route("**/rest/v1/rpc/get_safe_profiles*", async (route) => {
    await new Promise((r) => setTimeout(r, ENRICH_DELAY_MS));
    enrichmentResolved = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/reviews*", async (route) => {
    await new Promise((r) => setTimeout(r, ENRICH_DELAY_MS));
    enrichmentResolved = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/browse", { waitUntil: "domcontentloaded" });

  // The load-bearing assertion: a job title is visible LONG before the
  // enrichment request could have completed.
  const firstOpen = (SEED_JOBS as Record<string, unknown>[]).find((j) => j.status === "open");
  await expect(
    page.getByText(String(firstOpen!.title), { exact: false }).first(),
  ).toBeVisible({ timeout: ENRICH_DELAY_MS - 2000 });

  expect(
    enrichmentResolved,
    "cards rendered only after enrichment resolved — the queries have been re-merged",
  ).toBe(false);
});
