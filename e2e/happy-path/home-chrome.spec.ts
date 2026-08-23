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
//   row 2 (BrowseTasksToolbar)      [h1 "Browse jobs"] ... [search] [filters]
//
// The 2026-08-17 build had the icons in row 1 and the pill in row 2. The owner
// saw it on device and asked for the swap. Both halves are asserted
// POSITIONALLY (row 1's controls sit strictly above row 2's), because "the
// icons are present" was true in both arrangements and would not have caught
// the regression either way.
//
// Row 2 carried FOUR icons until the owner's next call — "move saved filters
// and map view into the filter option and move the rest up into the 1 column
// so it's the same size layout as jobs and post". So the map toggle and saved
// searches are inside the filter sheet now and row 2 is the same two-icon
// header My Posts renders. Both moved controls are asserted REACHABLE below
// (`the moved controls live in the filter sheet`) rather than merely absent
// from the row — losing them entirely would otherwise read as a pass.
//
// The pill is also a SHORTCUT now — one tap goes where the label says, which
// is why both label states are clicked and the resulting URL is asserted.
// `/my-jobs?filter=in_progress` and `?filter=active` are the app's own
// existing deep links (see inProgressBadgeTarget); this spec is what proves
// they land somewhere real rather than on /activity's redirect (which drops
// the query string) or /jobs/:id (which bounces a signed-in user back to
// /dashboard).

/** The feed's header-row action icons, in row order. Accessible names, not
 *  classes. Two, not four — see the note above. */
const ACTION_ICON_NAMES = [
  /^Search jobs$/,
  /^Filters/,
];

/** Controls that must NOT be back in the header row — they live in the sheet. */
const MOVED_OUT_OF_ROW = [
  /^(Show map view|Show list view)$/,
  /^Saved searches$/,
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
  //
  // The two surfaces signal "loaded" differently and this used to wait only on
  // the authed one. /dashboard mounts the Search icon in its title bar;
  // /browse (guest) deliberately has NO title-bar icons — the search and
  // filter icons were removed because they ate the top of the screen for a
  // signed-out visitor.
  //
  // The guest signal used to be the inline List/Map toggle that replaced those
  // icons. That toggle was itself removed on 2026-08-19 (owner: "Don't give
  // the list or map option in the guest page like this. Remove it and move
  // jobs up"), so this waited 20s for an element the product no longer has.
  // The <h1> is the durable signal: DashboardGuest renders a skeleton with no
  // heading until its session check resolves, and the title card after.
  await Promise.race([
    page.getByRole("button", { name: /^Search jobs$/ }).waitFor({ timeout: 20_000 }),
    page.getByRole("heading", { level: 1 }).waitFor({ timeout: 20_000 }),
  ]);
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
    //
    // PHONE ONLY. The desktop website drops the in-progress pill from this row
    // (owner) — the job it points at is one click away in the side panel, and
    // the row up there is the app bar rather than the screen's only chrome.
    // Phone and native keep it: they have no app bar, so this row is the only
    // place a live commitment can ride.
    const isDesktopWeb = variant.width >= 900;
    const bell = page.getByRole("button", { name: "Notifications" });
    await expect(bell).toBeVisible();
    const bellBox = (await bell.boundingBox())!;

    if (!isDesktopWeb) {
      const pill = page.getByRole("button", { name: /^In progress: / });
      await expect(pill).toBeVisible();
      const pillBox = (await pill.boundingBox())!;
      expect(pillBox.height, "pill tap target").toBeGreaterThanOrEqual(44);
      // Same row, and the pill ends before the bell begins — no overlap.
      expect(Math.abs(
        (pillBox.y + pillBox.height / 2) - (bellBox.y + bellBox.height / 2),
      ), "pill/bell vertical centres").toBeLessThan(4);
      expect(pillBox.x + pillBox.width, "pill right edge vs bell left edge")
        .toBeLessThanOrEqual(bellBox.x);
    } else {
      await expect(
        page.getByRole("button", { name: /^In progress: / }),
        "the desktop app bar carries no in-progress pill",
      ).toHaveCount(0);
    }

    // --- the two action icons now live IN row 1, left of the bell -------
    // This spec used to assert the opposite (icons in a SECOND row below the
    // brand row). The owner moved them up beside the bell — "should be to the
    // left of the notification bell" — and the vacated row was removed, so the
    // feed starts directly under the title card. The assertion is inverted to
    // the new arrangement rather than relaxed: same-row is still proven by
    // centre alignment, and left-of-bell by a hard edge comparison.
    for (const name of ACTION_ICON_NAMES) {
      const icon = page.getByRole("button", { name }).first();
      await expect(icon, `action icon ${name} @ ${variant.tag}`).toBeVisible();
      const box = (await icon.boundingBox())!;
      expect(box.width, `action icon ${name} tap target`).toBeGreaterThanOrEqual(28);
      if (isDesktopWeb) {
        // On the desktop website these controls are not in the app bar at all —
        // they sit directly above the JOB CARDS, because they filter the list
        // and not the map beside it (owner). So the only geometry that holds
        // here is that they are BELOW the bar, which is exactly the move.
        expect(box.y, `action icon ${name} sits below the app bar`)
          .toBeGreaterThan(bellBox.y + bellBox.height - 1);
        continue;
      }
      expect(box.height, `action icon ${name} tap target`).toBeGreaterThanOrEqual(44);
      // Same row as the bell (vertical centres agree)...
      expect(
        Math.abs((box.y + box.height / 2) - (bellBox.y + bellBox.height / 2)),
        `action icon ${name} shares the brand row with the bell`,
      ).toBeLessThan(6);
      // ...and strictly to its LEFT, with no overlap.
      expect(box.x + box.width, `action icon ${name} sits left of the bell`)
        .toBeLessThanOrEqual(bellBox.x + 1);
    }
    // ...and the two that moved into the sheet are not back in the row.
    for (const name of MOVED_OUT_OF_ROW) {
      await expect(
        page.getByRole("button", { name }),
        `${name} belongs in the filter sheet, not the header row`,
      ).toHaveCount(0);
    }

    // The header row is the SAME height My Posts' header row is — one row of
    // chrome, not a band. Both are the shared <ScreenHeaderRow>, floored at
    // 44px by its own minHeight and by the HIG button rule.
    const searchBox = (await page
      .getByRole("button", { name: /^Search jobs$/ })
      .first()
      .boundingBox())!;
    const filtersBox = (await page
      .getByRole("button", { name: /^Filters/ })
      .first()
      .boundingBox())!;
    expect(
      Math.abs((searchBox.y + searchBox.height / 2) - (filtersBox.y + filtersBox.height / 2)),
      "search/filters share one row",
    ).toBeLessThan(4);

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

// The point of the move: neither control was dropped. Both are one tap
// further in, LABELLED, inside the sheet the sliders icon opens.
test("the moved controls live in the filter sheet", async ({ context, page, baseURL }) => {
  await seedAuthedSession(context, FAKE_HELPER, baseURL ?? "");
  await installSupabaseMocks(page, { user: FAKE_HELPER, seed: true });
  await gotoHome(page, { width: 375, height: 812, theme: "light" });

  await page.getByRole("button", { name: /^Filters/ }).first().click();

  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();

  // View choice — a labelled List / Map pair, not a filter chip, and Map is
  // still a real destination: picking it closes the sheet and swaps the feed.
  await expect(sheet.getByRole("button", { name: "List" })).toBeVisible();
  const mapChoice = sheet.getByRole("button", { name: "Map" });
  await expect(mapChoice).toBeVisible();
  await expect(mapChoice).toHaveAttribute("aria-pressed", "false");

  // Saved searches — a labelled row that opens the same dialog the bookmark
  // icon used to.
  // Case-INSENSITIVE: the app-wide Title Case pass (Apple HIG — buttons and
  // titles are Title Case) renamed this row and its dialog to "Saved
  // Searches", and a case-sensitive match reads a rename as a missing control.
  const savedRow = sheet.getByRole("button", { name: /saved searches/i });
  await expect(savedRow).toBeVisible();

  await savedRow.click();
  await expect(page.getByRole("heading", { name: /saved searches/i })).toBeVisible();
  // `.first()` because the dialog carries TWO controls named "Close" — its
  // footer button and Radix's own sr-only X. (Escape is not an option here:
  // this app's dialogs and sheets do not close on it, which predates this
  // spec and is not what it is measuring.)
  await page.getByRole("dialog").getByRole("button", { name: "Close" }).first().click();
  await expect(page.getByRole("heading", { name: /saved searches/i })).toHaveCount(0);

  // And back for the view switch — the map really renders.
  await page.getByRole("button", { name: /^Filters/ }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Map" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await settleAnimations(page);
  await page.getByRole("button", { name: /^Filters/ }).first().click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: "Map" }),
  ).toHaveAttribute("aria-pressed", "true");
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

    // The guest brand row carries NO action icons — this diverges from the
    // authed Home on purpose. Search and Filters were pulled from this surface
    // (owner: they "take up too much space at the top"): a signed-out visitor
    // has nothing saved to filter against and has not yet been given a reason
    // to narrow anything, so the icons spent the most valuable strip of the
    // screen on controls that answer a question they have not asked. The
    // authed row still asserts both icons (see the /dashboard test above), so
    // this is a deliberate difference, not a surface silently losing chrome.
    for (const name of ACTION_ICON_NAMES) {
      await expect(
        page.getByRole("button", { name }),
        `guest brand row must not carry ${name} @ ${width}`,
      ).toHaveCount(0);
    }

    // The inline List/Map toggle is GONE, and that is deliberate (owner,
    // 2026-08-19: "Don't give the list or map option in the guest page like
    // this. Remove it and move jobs up"). This used to assert the opposite.
    //
    // Asserted as an absence rather than deleted, because the recorded
    // consequence is worth pinning: the guest title bar has no filter icon,
    // and the filter sheet is where this control lives on every other
    // surface, so a signed-out visitor now has NO route to the map and `view`
    // is effectively pinned to "list". If the toggle reappears here, someone
    // has re-added the row instead of restoring map access the agreed way
    // (put the filter icon back in the guest title bar).
    await expect(
      page.getByRole("group", { name: "Feed view" }),
      `guest List/Map toggle was removed on purpose @ ${width}`,
    ).toHaveCount(0);

    await page.screenshot({ path: `${SHOT_DIR}/guest-chrome-${width}.png`, fullPage: false });
  });
}
