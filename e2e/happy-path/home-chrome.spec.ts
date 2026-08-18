import {
  test,
  expect,
  FAKE_HELPER,
  installSupabaseMocks,
  seedAuthedSession,
  type MockRule,
} from "./fixtures";
import { measureLayout, settleAnimations } from "./auditRoutes";
import type { Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdirSync } from "node:fs";

const SHOT_DIR = "/tmp/ui-review";
mkdirSync(SHOT_DIR, { recursive: true });

// Home's two rows of chrome, measured.
//
// The arrangement here was swapped twice in one day, so it is pinned by
// measurement rather than by comment:
//
//   row 1 (PageScaffold titleCard)  [emblem] ............ [job pill] [bell]
//   row 2 (BrowseTasksToolbar)      [h1 "Browse jobs"] ... [4 action icons]
//
// The 2026-08-17 build had the four icons in row 1 and the pill in row 2. The
// owner saw it on device and asked for the swap. Both halves are asserted
// POSITIONALLY (row 1's controls sit strictly above row 2's), because "the
// icons are present" was true in both arrangements and would not have caught
// the regression either way.
//
// The pill is also a SHORTCUT now — one tap goes where the label says, which
// is why both label states are clicked and the resulting URL is asserted.
// `/my-jobs?filter=in_progress` and `?filter=active` are the app's own
// existing deep links (see inProgressBadgeTarget); this spec is what proves
// they land somewhere real rather than on /activity's redirect (which drops
// the query string) or /jobs/:id (which bounces a signed-in user back to
// /dashboard).

/** The four feed action icons, in row order. Accessible names, not classes. */
const ACTION_ICON_NAMES = [
  /^(Show map view|Show list view)$/,
  /^Saved searches$/,
  /^Search jobs$/,
  /^Filters/,
];

/**
 * Override the `helper_upcoming_job` read so the pill renders its
 * accepted-but-not-started state. That query is the only `jobs` select whose
 * column list starts `id,title,date_needed` — matching on the select list
 * keeps this rule off the feed's own (much wider) job read.
 */
function upcomingJobRule(status: "accepted" | "in_progress"): MockRule {
  return {
    match: (url, method) =>
      method === "GET" &&
      url.pathname === "/rest/v1/jobs" &&
      (url.searchParams.get("select") ?? "").startsWith("id,title,date_needed"),
    handle: () => ({
      status: 200,
      body: [
        {
          id: "10000000-0000-4000-8000-0000000000ff",
          title: "Mow and edge a corner lot",
          date_needed: "2026-08-20",
          start_time: "09:00:00",
          status,
        },
      ],
    }),
  };
}

/**
 * The onboarding tour is a modal Radix dialog that auto-opens ~1.5s after load
 * for any account younger than two minutes — which every seeded session is.
 * While it is up, Radix marks the rest of the app `aria-hidden`, so EVERY
 * role-based locator in this file finds nothing and the failure reads as
 * "the chrome is missing". Suppressed, the same as `overlay-sweep` does, so
 * these routes are probed in their normal returning-user state.
 */
async function suppressOnboardingTour(page: Page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem(
        "helpr_onboarding",
        JSON.stringify({ completed: true, currentStep: 0, completedSteps: [], seen: true }),
      );
      localStorage.setItem("helpr.onboarding_tour_dismissed_at", new Date().toISOString());
    } catch { /* storage unavailable */ }
  });
}

async function gotoBrowseSurface(
  page: Page,
  url: string,
  opts: { width: number; height: number; theme: "light" | "dark" },
) {
  await page.setViewportSize({ width: opts.width, height: opts.height });
  await suppressOnboardingTour(page);
  await page.addInitScript((theme) => {
    const set = () => document.documentElement?.setAttribute("data-theme", theme);
    if (document.documentElement) set();
    else document.addEventListener("DOMContentLoaded", set, { once: true });
  }, opts.theme);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate((theme) => {
    document.documentElement.setAttribute("data-theme", theme);
  }, opts.theme);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  // Wait for the LOADED branch, not just first paint. The pending branch
  // renders the same title bar but no toolbar at all, so measuring too early
  // reports "the action icons are missing" when they simply have not mounted.
  await page.getByRole("button", { name: /^Search jobs$/ }).waitFor({ timeout: 20_000 });
  await settleAnimations(page);
}

const gotoHome = (page: Page, opts: { width: number; height: number; theme: "light" | "dark" }) =>
  gotoBrowseSurface(page, "/dashboard", opts);

for (const variant of [
  { tag: "375-light", width: 375, height: 812, theme: "light" as const },
  { tag: "375-dark", width: 375, height: 812, theme: "dark" as const },
  { tag: "1440-light", width: 1440, height: 900, theme: "light" as const },
  { tag: "1440-dark", width: 1440, height: 900, theme: "dark" as const },
]) {
  test(`home chrome fits and is arranged correctly @ ${variant.tag}`, async ({
    context,
    page,
    baseURL,
  }) => {
    await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
    await installSupabaseMocks(page, { user: FAKE_HELPER, seed: true });
    await gotoHome(page, variant);

    // --- fits the screen ------------------------------------------------
    const layout = await measureLayout(page);
    expect(layout.overflowOffenders, `overflow offenders @ ${variant.tag}`).toEqual([]);
    expect(layout.overflowPx, `documentElement overflow @ ${variant.tag}`).toBeLessThanOrEqual(0);
    expect(layout.h1Count, `h1 count (texts: ${layout.h1Texts.join(" | ")})`).toBe(1);
    expect(layout.smallTapTargets, `sub-44px controls @ ${variant.tag}`).toEqual([]);

    // --- row 1: the pill sits with the bell -----------------------------
    const pill = page.getByRole("button", { name: /^In progress: / });
    const bell = page.getByRole("button", { name: "Notifications" });
    await expect(pill).toBeVisible();
    await expect(bell).toBeVisible();

    const pillBox = (await pill.boundingBox())!;
    const bellBox = (await bell.boundingBox())!;
    expect(pillBox.height, "pill tap target").toBeGreaterThanOrEqual(44);
    // Same row, and the pill ends before the bell begins — no overlap.
    expect(Math.abs(
      (pillBox.y + pillBox.height / 2) - (bellBox.y + bellBox.height / 2),
    ), "pill/bell vertical centres").toBeLessThan(4);
    expect(pillBox.x + pillBox.width, "pill right edge vs bell left edge")
      .toBeLessThanOrEqual(bellBox.x);

    // --- row 2: the four action icons, BELOW row 1 ----------------------
    // The List⇄Map toggle is deliberately absent on the desktop web: both
    // panes are on screen, so there is nothing to switch between.
    const isDesktop = variant.width >= 1024;
    const expected = isDesktop ? ACTION_ICON_NAMES.slice(1) : ACTION_ICON_NAMES;
    for (const name of expected) {
      const icon = page.getByRole("button", { name }).first();
      await expect(icon, `action icon ${name} @ ${variant.tag}`).toBeVisible();
      const box = (await icon.boundingBox())!;
      expect(box.height, `action icon ${name} tap target`).toBeGreaterThanOrEqual(44);
      expect(box.width, `action icon ${name} tap target`).toBeGreaterThanOrEqual(40);
      // THE assertion this spec exists for: every action icon is in the row
      // BELOW the pill, not beside it.
      expect(box.y, `action icon ${name} must sit below the brand row`)
        .toBeGreaterThanOrEqual(pillBox.y + pillBox.height);
    }
    if (isDesktop) {
      await expect(page.getByRole("button", { name: /^Show (map|list) view$/ }))
        .toHaveCount(0);
    }

    // --- a11y -----------------------------------------------------------
    const axe = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    expect(
      axe.violations.map((v) => `${v.id} (${v.impact}, ${v.nodes.length} nodes)`),
      `axe @ ${variant.tag}`,
    ).toEqual([]);

    await page.screenshot({
      path: `${SHOT_DIR}/home-chrome-${variant.tag}.png`,
      fullPage: false,
    });
  });
}

test("the pill is a shortcut — 'In progress' opens that job", async ({
  context,
  page,
  baseURL,
}) => {
  await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
  await installSupabaseMocks(page, {
    user: FAKE_HELPER,
    seed: true,
    rules: [upcomingJobRule("in_progress")],
  });
  await gotoHome(page, { width: 375, height: 812, theme: "light" });

  const pill = page.getByRole("button", { name: /^In progress: Mow and edge a corner lot\./ });
  await expect(pill).toBeVisible();
  // The accessible name must say where it goes, not just what it is.
  await expect(pill).toHaveAttribute("aria-label", /open this job in My Jobs/);

  await pill.click();
  await page.waitForURL(/\/my-jobs\?filter=in_progress/, { timeout: 10_000 });
  expect(new URL(page.url()).pathname).toBe("/my-jobs");
  expect(new URL(page.url()).searchParams.get("filter")).toBe("in_progress");
});

test("the pill is a shortcut — 'Upcoming' opens the active list", async ({
  context,
  page,
  baseURL,
}) => {
  await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
  await installSupabaseMocks(page, {
    user: FAKE_HELPER,
    seed: true,
    rules: [upcomingJobRule("accepted")],
  });
  await gotoHome(page, { width: 375, height: 812, theme: "light" });

  const pill = page.getByRole("button", { name: /^Upcoming: Mow and edge a corner lot\./ });
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAttribute("aria-label", /open your active jobs/);

  await pill.click();
  // Activity's applied tab defaults to the "active" bucket and strips the
  // param when it matches that default, so the settled URL is bare /my-jobs
  // showing the active list — NOT /my-posts, which is where the old
  // /activity redirect used to dump this.
  await page.waitForURL(/\/my-jobs/, { timeout: 10_000 });
  expect(new URL(page.url()).pathname).toBe("/my-jobs");
  const filter = new URL(page.url()).searchParams.get("filter");
  expect(filter === null || filter === "active").toBe(true);
});

for (const width of [320, 375, 1440]) {
  test(`guest /browse still fits with both CTAs @ ${width}`, async ({ page }) => {
    await installSupabaseMocks(page, { seed: true });
    await gotoBrowseSurface(page, "/browse", {
      width,
      height: width === 320 ? 640 : 812,
      theme: "light",
    });

    const layout = await measureLayout(page);
    expect(layout.overflowOffenders, `guest overflow offenders @ ${width}`).toEqual([]);
    expect(layout.overflowPx, `guest overflow @ ${width}`).toBeLessThanOrEqual(0);
    expect(layout.h1Count, `guest h1 count (${layout.h1Texts.join(" | ")})`).toBe(1);
    expect(layout.smallTapTargets, `guest sub-44px controls @ ${width}`).toEqual([]);

    // Both CTAs intact — never collapsed to icons, never behind a menu.
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();

    // And the icons are down in the toolbar row on this surface too. Three,
    // not four: "Saved searches" is a signed-in feature (`user={null}`). The
    // List⇄Map toggle IS shown at every width here — the guest feed swaps the
    // whole panel between list and map, it has no desktop two-pane.
    const login = (await page.getByRole("button", { name: "Log in" }).boundingBox())!;
    for (const name of [ACTION_ICON_NAMES[0], ...ACTION_ICON_NAMES.slice(2)]) {
      const icon = page.getByRole("button", { name }).first();
      await expect(icon, `guest action icon ${name} @ ${width}`).toBeVisible();
      const box = (await icon.boundingBox())!;
      expect(box.height, `guest action icon ${name} tap target`).toBeGreaterThanOrEqual(44);
      expect(box.y, `guest action icon ${name} must sit below the brand row`)
        .toBeGreaterThanOrEqual(login.y + login.height);
    }

    await page.screenshot({ path: `${SHOT_DIR}/guest-chrome-${width}.png`, fullPage: false });
  });
}
