import { test, expect, assertHealthy, getSession, newUserContext, sessionsAvailable } from "./fixtures";
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

const guestTitle = scenarioTitle({ journey: "browse", persona: "new", state: "approved", rotation, outcome: "smooth" });
test(guestTitle, async ({ browser, journey }) => {
  test.skip(filteredOut(guestTitle), "SCENARIO pins another scenario");
  const ctx = await newUserContext(browser, null, { rotation });
  const page = journey.track("guest", await ctx.newPage());

  await test.step("guest opens Browse and sees real jobs", async () => {
    await page.goto("/browse");
    await expect(page.getByRole("heading", { name: "Browse Jobs", level: 1 })).toBeVisible({ timeout: 45_000 });
    const cards = page.getByRole("heading", { level: 2 });
    await expect(cards.first()).toBeVisible({ timeout: 45_000 });
    expect(await cards.count(), "guest Browse listed no jobs").toBeGreaterThan(0);
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
    const box = page.getByRole("searchbox", { name: "Search jobs" });
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
    const closeBtn = sheet.getByRole("button", { name: /close filters|show .*|done|apply/i }).first();
    if (await sheet.isVisible()) await closeBtn.click();
    await expect(sheet).toBeHidden({ timeout: 10_000 });
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
    const close2 = page.getByRole("dialog").getByRole("button", { name: /close filters|show .*|done|apply/i }).first();
    if (await page.getByRole("dialog").isVisible()) await close2.click();
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
    const d = page.getByRole("dialog");
    if (await d.isVisible()) await d.getByRole("button", { name: /close filters|show .*|done|apply/i }).first().click();
    await expect(page.locator("[class*='mapkit'], canvas, [aria-label*='map' i]").first(), "the map view never rendered").toBeVisible({ timeout: 45_000 });
    await assertHealthy(page, "map view", { settleMs: 30_000 });
    await journey.milestone(page, "map-view");
    await page.getByRole("button", { name: "Filters" }).first().click();
    await page.getByRole("dialog").getByRole("group", { name: "Feed view" }).getByRole("button", { name: "List" }).click();
    // leave the account the way we found it: list view, no filters
    const clear = page.getByRole("dialog").getByRole("button", { name: /clear|reset/i }).first();
    if (await clear.isVisible().catch(() => false)) await clear.click();
    await page.waitForTimeout(500);
    if (await page.getByRole("dialog").isVisible()) await page.keyboard.press("Escape");
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
