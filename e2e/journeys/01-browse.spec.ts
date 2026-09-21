import type { APIRequestContext, Page } from "@playwright/test";

import { ANON, SUPABASE_URL, announceUncovered, test, expect, assertHealthy, getSession, newUserContext, sessionsAvailable } from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle } from "./scenarios";

/**
 * Journey 1 — discovery.
 *
 * GUEST (web): the list, a job, and the sign-in prompt. The web guest title bar
 * deliberately has NO search / filter / sort / map (owner's call, recorded at
 * DashboardGuest.tsx "no route to the map at all"), so this journey asserts
 * that absence rather than pretending to drive it, and drives search, filter,
 * sort and map as a SIGNED-IN visitor, where they live.
 */

const rotation = rotationFor(0);

/**
 * THE FUNDED FLOOR — read from the view BEFORE the UI is blamed for an empty feed.
 *
 * This journey used to fail "guest Browse listed no jobs" and leave the reader
 * to work out why. It cost a full investigation to learn the answer was not the
 * app at all: prod had 115 `open` jobs and every one of them sat at
 * payment_status='abandoned', while `open_jobs_browse` admits a row only at
 * payment_status IN ('escrow','payout_pending','released') (read live with
 * pg_get_viewdef). The view was right, the app was right, and a logged-out
 * visitor really did see an empty marketplace.
 *
 * So the count is taken from the same view the feed reads, as anon, first:
 *   floor = 0  → prod itself is dark. Failed here, in one line, naming the
 *                cause, instead of 45s later as a mystery UI red. The uptime
 *                probe calls this DOWN too (scripts/uptime-check.mjs).
 *   floor > 0  → any empty feed after this is the CLIENT dropping rows the
 *                database served, which is a completely different bug.
 *
 * This journey still does not OWN a fixture of its own, because a poster token
 * cannot create one: `enforce_poster_jobs_money_lock` (verified live) refuses
 * any payment_status write where auth.uid() = jobs.customer_id, so reaching
 * 'escrow' needs the Stripe-sandbox checkout leg. See the report in
 * docs/OPEN.md — until that lands, this is the honest diagnosis, not a guarantee.
 */
async function fundedFloor(api: APIRequestContext): Promise<number> {
  const res = await api.get(`${SUPABASE_URL}/rest/v1/open_jobs_browse?select=id`, {
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, Prefer: "count=exact", Range: "0-0" },
  });
  expect(res.ok(), `open_jobs_browse is not readable as a guest (HTTP ${res.status()}) — the marketplace cannot render for anyone logged out`).toBeTruthy();
  const total = Number((res.headers()["content-range"] ?? "").split("/")[1]);
  expect(Number.isFinite(total), "open_jobs_browse returned no exact count").toBeTruthy();
  return total;
}

const guestTitle = scenarioTitle({ journey: "browse", persona: "new", state: "approved", rotation, outcome: "smooth" });
/**
 * Leave the filter sheet closed, whether or not the app closed it itself.
 *
 * Picking a Feed view CLOSES the sheet on its own — verified live on prod
 * (local preview, WebKit, 2026-09-15: the dialog was gone within 100ms of the
 * "Map" tap). The old line read `if (await d.isVisible()) await
 * d.getByRole(close).click()`, which is a race with exactly that: the read can
 * land in the last visible frame, and the click then waits 20s for a button
 * that detached ("element was detached from the DOM, retrying" — e2e-journeys
 * 34927100318, both engines). Waiting for "hidden" first makes a sheet that
 * closes itself the fast path, and still fails if a sheet refuses to close.
 */
async function closeFilterSheet(page: Page) {
  const sheet = page.getByRole("dialog");
  if (await sheet.isHidden().catch(() => true)) return;
  const closedItself = await sheet
    .waitFor({ state: "hidden", timeout: 1_500 })
    .then(() => true)
    .catch(() => false);
  if (closedItself) return;
  await sheet.getByRole("button", { name: /close filters|show .*|done|apply/i }).first().click();
  await expect(sheet, "the filter sheet would not close").toBeHidden({ timeout: 10_000 });
}

// Shown able to fail on the guest marketplace's own identity: the spec asserts
// an <h1> reading "Browse Jobs" is visible, because a guest who cannot see the
// page heading cannot tell the marketplace rendered at all. Retitling the
// PublicHeaderPage reds it.
// @mutate src/pages/DashboardGuest.tsx | title="Browse Jobs"\n      width="public" | title="Find Work"\n      width="public"

test(guestTitle, async ({ browser, request, journey }) => {
  test.skip(filteredOut(guestTitle), "SCENARIO pins another scenario");
  const ctx = await newUserContext(browser, null, { rotation });
  const page = journey.track("guest", await ctx.newPage());

  let floor = 0;
  await test.step("prod is serving a funded marketplace at all", async () => {
    floor = await fundedFloor(request);
    if (floor === 0) {
      announceUncovered(
        "Guest marketplace is DARK",
        "open_jobs_browse returned 0 rows: every open job is unfunded (payment_status not in escrow/payout_pending/released), " +
          "so a logged-out visitor sees an empty marketplace. This is a PROD DATA condition, not a UI regression — do not go " +
          "looking in the browse components. Fund a job (Stripe test mode) or restore the seeded funded rows.",
      );
    }
    expect(floor, "open_jobs_browse served 0 rows — prod's guest marketplace is empty; see the note above, this journey owns no fixture of its own").toBeGreaterThan(0);
  });

  await test.step("guest opens Browse and sees real jobs", async () => {
    await page.goto("/browse");
    await expect(page.getByRole("heading", { name: "Browse Jobs", level: 1 })).toBeVisible({ timeout: 45_000 });
    const cards = page.getByRole("heading", { level: 2 });
    await expect(cards.first()).toBeVisible({ timeout: 45_000 });
    expect(await cards.count(), `open_jobs_browse served ${floor} row(s) but guest Browse rendered none — the CLIENT dropped rows the database returned`).toBeGreaterThan(0);
    await assertHealthy(page, "guest /browse");
    expect(await page.getByRole("button", { name: "Filters" }).count(), "guest web Browse is designed without a filter button").toBe(0);
    await journey.milestone(page, "guest-browse");
  });

  await test.step("guest taps a job and is asked to create an account, keeping the job", async () => {
    // By design (DashboardGuest.tsx: signupUrlFor(`/jobs/${job.id}`)): a guest
    // tap goes to sign-up carrying the job, so the job opens after signing in.
    await page.getByRole("heading", { level: 2 }).first().click();
    await expect(page, "tapping a job as a guest did not prompt sign-up").toHaveURL(/\/signup\?redirect=%2Fjobs%2F[0-9a-f-]{36}/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: /create account/i })).toBeVisible({ timeout: 20_000 });
    await assertHealthy(page, "guest sign-up prompt");
    await journey.milestone(page, "guest-signup-prompt");
  });

  await test.step("guest switches to Log In and the job intent survives", async () => {
    await page.getByRole("link", { name: /^log in$/i }).or(page.getByRole("button", { name: /^log in$/i })).last().click();
    await expect(page).toHaveURL(/\/login/, { timeout: 20_000 });
    await expect(page.getByRole("textbox", { name: /email/i }).first()).toBeVisible({ timeout: 20_000 });
    await assertHealthy(page, "guest log in");
    await journey.milestone(page, "guest-login");
  });
  await ctx.close();
});

const authedTitle = scenarioTitle({ journey: "browse", persona: "helper-only", state: "approved", rotation, outcome: "smooth" });
test(authedTitle, async ({ browser, request, journey }) => {
  test.skip(filteredOut(authedTitle), "SCENARIO pins another scenario");
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);
  const helper = await getSession(request, "helper");
  const ctx = await newUserContext(browser, helper, { rotation });
  const page = journey.track("helper", await ctx.newPage());
  const cards = page.getByRole("button", { name: /^View .+ — \$/ });

  let total = 0;
  await test.step("signed-in Browse lists jobs", async () => {
    await page.goto("/dashboard");
    await expect(cards.first()).toBeVisible({ timeout: 60_000 });
    total = await cards.count();
    await assertHealthy(page, "/dashboard browse");
    await journey.milestone(page, "helper-browse");
  });

  await test.step("search narrows the feed", async () => {
    const firstName = (await cards.first().getAttribute("aria-label"))!.replace(/^View /, "").replace(/ — \$.*$/, "");
    const word = firstName.split(/\s+/).find((w) => w.length >= 5) ?? firstName.split(/\s+/)[0];
    await page.getByRole("button", { name: "Search jobs" }).first().click();
    // See the note on the combobox role in 02-marketplace.spec.ts: the field
    // is role="combobox" now (recent-searches popup), not searchbox.
    const box = page.getByRole("combobox", { name: "Search jobs" });
    await expect(box).toBeVisible();
    await box.fill("zzqxj-no-such-job");
    await expect(cards, "a nonsense search still listed jobs").toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText(/no jobs match|no (results|matches)/i).filter({ visible: true }).first(), "no empty-state copy for a search with no results").toBeVisible();
    await assertHealthy(page, "search with no results");
    await journey.milestone(page, "search-empty");
    await box.fill(word);
    await expect(cards.first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1_000);
    await assertHealthy(page, "search with a hit");
    await expect(cards.first(), "search hit rendered and then vanished").toBeInViewport();
    for (const label of await cards.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? ""))) {
      expect.soft(label.toLowerCase(), `search "${word}" returned a card whose title does not contain it`).toContain(word.toLowerCase());
    }
    await journey.milestone(page, "search-hit");
    await page.getByRole("button", { name: /close search|clear search/i }).first().click();
    await expect(page.getByRole("button", { name: "Filters" }).first()).toBeVisible();
    await expect(cards).toHaveCount(total, { timeout: 20_000 });
  });

  await test.step("filter by category, then sort by pay", async () => {
    await page.getByRole("button", { name: "Filters" }).first().click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await assertHealthy(page, "filter sheet");
    await journey.milestone(page, "filter-sheet");
    const sort = sheet.getByRole("group", { name: "Sort results" });
    await sort.getByRole("button", { name: /high/i }).first().click();
    await expect(sort.getByRole("button", { name: /high/i }).first()).toHaveAttribute("aria-pressed", "true");
    await closeFilterSheet(page);
    const prices = await cards.evaluateAll((els) =>
      els.map((e) => Number(/— \$([\d,]+)/.exec(e.getAttribute("aria-label") ?? "")?.[1]?.replace(/,/g, "") ?? "NaN")),
    );
    expect(prices.length).toBeGreaterThan(0);
    expect(prices, "Highest pay did not order the feed by price").toEqual([...prices].sort((a, b) => b - a));
    await journey.milestone(page, "sorted-by-pay");

    await page.getByRole("button", { name: "Filters" }).first().click();
    const cat = page.getByRole("dialog").getByRole("group", { name: "Filter by category" });
    await expect(cat).toBeVisible();
    await cat.getByRole("button", { name: /cleaning/i }).first().click();
    await closeFilterSheet(page);
    await expect(cards.first()).toBeVisible({ timeout: 20_000 });
    for (const label of await cards.evaluateAll((els) => els.map((e) => e.textContent ?? ""))) {
      expect.soft(label, "a non-Cleaning job survived the Cleaning filter").toMatch(/cleaning/i);
    }
    await assertHealthy(page, "category filter");
    await journey.milestone(page, "filtered-cleaning");
  });

  await test.step("switch to the map and back", async () => {
    await page.getByRole("button", { name: "Filters" }).first().click();
    const view = page.getByRole("dialog").getByRole("group", { name: "Feed view" });
    await view.getByRole("button", { name: "Map" }).click();
    await closeFilterSheet(page);
    await expect(page.locator("[class*='mapkit'], canvas, [aria-label*='map' i]").first(), "the map view never rendered").toBeVisible({ timeout: 45_000 });
    await assertHealthy(page, "map view", { settleMs: 30_000 });
    await journey.milestone(page, "map-view");
    await page.getByRole("button", { name: "Filters" }).first().click();
    await page.getByRole("dialog").getByRole("group", { name: "Feed view" }).getByRole("button", { name: "List" }).click();
    // Picking a view closes the sheet (see closeFilterSheet), so Clear All is
    // one more trip in — it used to be reachable in the same sheet visit.
    await closeFilterSheet(page);
    // leave the account the way we found it: list view, no filters
    await page.getByRole("button", { name: /^Filters/ }).first().click();
    const clear = page.getByRole("dialog").getByRole("button", { name: /clear|reset/i }).first();
    if (await clear.isVisible().catch(() => false)) await clear.click();
    await page.waitForTimeout(500);
    if (await page.getByRole("dialog").isVisible().catch(() => false)) await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 10_000 });
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    await expect(cards, "Clear All did not restore the full feed").toHaveCount(total, { timeout: 20_000 });
  });

  await test.step("open a job from signed-in Browse", async () => {
    await cards.first().click();
    await expect(page.getByRole("dialog").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("dialog").getByRole("button", { name: /apply|offer|interested/i }).first()).toBeVisible({ timeout: 20_000 });
    await assertHealthy(page, "signed-in job detail");
    await journey.milestone(page, "helper-job-detail");
  });
  await ctx.close();
});
