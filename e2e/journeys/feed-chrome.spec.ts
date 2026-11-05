import type { BrowserContext, Page, Request } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { test, expect, getSession, isUserWrite, newUserContext, sessionsAvailable } from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle } from "./scenarios";
import { measureLayout, settleAnimations } from "../happy-path/auditRoutes";
import { AXE_TAGS } from "../happy-path/axeTags";

/**
 * Journey — THE JOB FEED'S CHROME (Jobs > Browse), on the real backend.
 *
 * Moved here from the mocked e2e/happy-path/home-chrome.spec.ts (Q1035: every
 * mocked spec is migrated to prod or retired, one at a time). The checks are the
 * same; the signed-in tests use the shared test Helpr on prod, the guest tests a
 * real signed-out visitor. Read-only: any user write fails the test, and the
 * filter-sheet test puts the view back on List before it ends.
 *
 * The section skeleton every section shares (owner, final section decisions
 * 2026-10-19), asserted POSITIONALLY because "the controls are present" is true
 * of every arrangement and catches none of the regressions:
 *
 *   top bar      phone: section chips + bell + photo; desktop: "Jobs" title in the global top bar
 *   tabs         [Browse | Posted | Working] then search, Filters and the gear at the row's end
 *
 * One difference from the mocked spec: on desktop the Browse tab's job count is
 * `\d*`, not `\d+`, because the real count can be zero on prod.
 */

/** The feed's header-row action icons, in row order. Accessible names, not
 *  classes.
 *
 *  ONE, not two. The phone brand row is emblem + filter + bell now (owner:
 *  "phone view and ios should just be logo filter and notification, everything
 *  else there somehow folds into filter"). Search joined the sheet alongside
 *  the map toggle and saved searches — it had to, because the row physically
 *  did not fit: measured at 375 (mocked spec, 2026-09) the cluster wanted 386px against a card edge at
 *  334, and the overflow was silently eating the emblem and then the bell. */
const ACTION_ICON_NAMES = [
  /^Filters/,
];

/** Controls that must NOT be back in the header row — they live in the sheet. */
const MOVED_OUT_OF_ROW = [
  /^(Show map view|Show list view)$/,
  /^Saved searches$/,
];


async function trackWrites(ctx: BrowserContext): Promise<string[]> {
  const writes: string[] = [];
  ctx.on("request", (req: Request) => {
    if (isUserWrite(req.method(), req.url())) writes.push(`${req.method()} ${req.url().slice(0, 140)}`);
  });
  return writes;
}

async function gotoBrowseSurface(
  page: Page,
  url: string,
  opts: { width: number; height: number; theme: "light" | "dark" },
) {
  await page.setViewportSize({ width: opts.width, height: opts.height });
  await page.addInitScript((theme) => {
    try {
      localStorage.setItem("helpr.onboarding_tour_dismissed_at", new Date().toISOString());
    } catch { /* storage unavailable */ }
    const set = () => document.documentElement?.setAttribute("data-theme", theme);
    if (document.documentElement) set();
    else document.addEventListener("DOMContentLoaded", set, { once: true });
  }, opts.theme);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.evaluate((theme) => {
    document.documentElement.setAttribute("data-theme", theme);
  }, opts.theme);
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  // Wait for the LOADED branch, not just first paint: Filters on the signed-in feed, the h1 on guest /browse.
  await Promise.race([
    page.getByRole("button", { name: /^Filters/ }).waitFor({ timeout: 30_000 }),
    page.getByRole("heading", { level: 1 }).waitFor({ timeout: 30_000 }),
  ]);
  await settleAnimations(page);
}

for (const [i, variant] of [
  { tag: "375-light", width: 375, height: 812, theme: "light" as const },
  { tag: "375-dark", width: 375, height: 812, theme: "dark" as const },
  { tag: "1440-light", width: 1440, height: 900, theme: "light" as const },
  { tag: "1440-dark", width: 1440, height: 900, theme: "dark" as const },
].entries()) {
  const rotation = rotationFor(10 + i);
  const title = scenarioTitle({ journey: `feed-chrome-${variant.tag}`, persona: "helper-only", state: "approved", rotation, outcome: "smooth" });
  test(title, async ({ browser, request, journey }) => {
    test.skip(filteredOut(title), "SCENARIO pins another scenario");
    const avail = sessionsAvailable();
    test.skip(!avail.ok, avail.why);
    const session = await getSession(request, "helper");
    const ctx = await newUserContext(browser, session, { desktop: variant.width >= 900 });
    const writes = await trackWrites(ctx);
    try {
      const page = journey.track("helper", await ctx.newPage());
      await gotoBrowseSurface(page, "/jobs", variant);

      // --- fits the screen ------------------------------------------------
      const layout = await measureLayout(page);
      expect(layout.overflowOffenders, `overflow offenders @ ${variant.tag}`).toEqual([]);
      expect(layout.overflowPx, `documentElement overflow @ ${variant.tag}`).toBeLessThanOrEqual(0);
      expect(layout.h1Count, `h1 count (texts: ${layout.h1Texts.join(" | ")})`).toBe(1);
      expect(layout.smallTapTargets, `sub-44px controls @ ${variant.tag}`).toEqual([]);

      const isDesktopWeb = variant.width >= 900;

      // --- the top bar: title, then bell · profile on a phone; on the desktop website the
      // title sits IN the global top bar, left of the bell and photo (ONE header row,
      // owner 2026-10-21: PageTitleBar portals into DesktopTopNav's slot) ---
      const bar = isDesktopWeb ? page.locator("[data-desktop-title-slot]") : page.getByTestId("app-top-bar");
      await expect(bar).toBeVisible();
      // Phone (Q2359, owner 2026-10-22, the Explore header): no visible title; the bar IS the section chips with the
      // bell and the photo, and the page's h1 is the section's name, screen-reader only. No "+" (the bottom bar's
      // center "+" creates). Desktop keeps the visible "Jobs" title and its soft "+ Post a job" beside the bell (owner
      // 2026-10-28: "add the post a job ... buttons back on the top nav maybe just make it the lighter green").
      if (isDesktopWeb) await expect(bar.getByRole("heading", { level: 1, name: "Jobs" })).toBeVisible();
      else {
        await expect(bar.getByRole("heading", { level: 1, name: "Jobs" })).toHaveCount(1);
        await expect(bar.getByTestId("explore-switcher")).toBeVisible();
      }
      await expect(page.getByTestId("section-add"), `the section + on desktop only @ ${variant.tag}`).toHaveCount(isDesktopWeb ? 1 : 0);
      if (!isDesktopWeb) {
        await expect(page.getByTestId("explore-switcher").getByRole("radio", { name: "Jobs" })).toHaveAttribute("aria-checked", "true");
        // All four section chips fit without scrolling from 375 up (owner 2026-10-28: "Homes" was cut off; 320 may
        // still scroll). src/test/exploreChipsFitAPhone.test.ts holds the levers.
        const chipsOverflow = await page.getByTestId("explore-switcher").getByRole("radiogroup").evaluate((el) => el.scrollWidth - el.clientWidth);
        expect(chipsOverflow, `the four chips fit @ ${variant.tag}`).toBeLessThanOrEqual(0);
      }
      const anchor = isDesktopWeb ? (await bar.getByRole("heading", { level: 1 }).boundingBox())! : (await bar.getByTestId("top-bar-bell").boundingBox())!;
      // Desktop website (Q2221): the bar keeps the title; the bell lives in the desktop
      // header and Profile in the rail, so neither repeats here.
      let barBottom = anchor.y + anchor.height;
      if (isDesktopWeb) {
        await expect(bar.getByTestId("top-bar-bell"), `no second bell @ ${variant.tag}`).toHaveCount(0);
        await expect(bar.getByTestId("top-bar-profile"), `no avatar in the bar @ ${variant.tag}`).toHaveCount(0);
        // ONE row: the title and the header's photo share a line.
        const photo = (await page.getByTestId("desktop-top-profile").boundingBox())!;
        expect(Math.abs(anchor.y + anchor.height / 2 - (photo.y + photo.height / 2)), `the title is level with the photo @ ${variant.tag}`).toBeLessThan(8);
        const add = (await bar.getByTestId("section-add").boundingBox())!;
        expect(Math.abs(add.y + add.height / 2 - (photo.y + photo.height / 2)), `the + is level with the photo @ ${variant.tag}`).toBeLessThan(8);
        expect(add.x + add.width, `the + sits left of the photo @ ${variant.tag}`).toBeLessThanOrEqual(photo.x);
        barBottom = Math.max(barBottom, photo.y + photo.height);
      } else {
        const bellBox = (await bar.getByTestId("top-bar-bell").boundingBox())!;
        const profile = (await bar.getByTestId("top-bar-profile").boundingBox())!;
        expect(bellBox.x + bellBox.width, `the bell sits just left of the profile @ ${variant.tag}`).toBeLessThanOrEqual(profile.x + 1);
        for (const [name, box] of [["profile", profile]] as const) {
          expect(Math.abs(box.y + box.height / 2 - (bellBox.y + bellBox.height / 2)), `${name} shares the bar with the bell`).toBeLessThan(6);
        }
        barBottom = bellBox.y + bellBox.height;
      }

      // THE PILL IS GONE, on every width (owner, pointing at it: "remove").
      await expect(
        page.getByRole("button", { name: /^In progress: / }),
        "the feed's chrome carries no in-progress pill on any width",
      ).toHaveCount(0);

      // --- the tabs: Browse leftmost and selected -------------------------
      const tabs = page.getByRole("tablist", { name: "Jobs & Posts" });
      // Desktop: Browse carries its job count beside its label (owner 2026-10-28: "move the 1 next to browse").
      await expect(tabs.getByRole("tab")).toHaveText([isDesktopWeb ? /^Browse\d*$/ : "Browse", "Posted", "Working"]);
      await expect(tabs.getByRole("tab", { name: "Browse" })).toHaveAttribute("aria-selected", "true");
      const tabsBox = (await tabs.boundingBox())!;
      expect(tabsBox.y, "the tabs sit under the top bar").toBeGreaterThanOrEqual(barBottom - 1);

      // --- search + Filters at the END OF THE TABS ROW on every width, then the gear (owner 2026-10-28, desktop: "the
      // search filter and map up onto the other line above to save space"; phone: "search and filter should be next to
      // gear"). No separate "Search jobs" row: the search is an icon that opens in place. ---
      const tabsRow = (await page.getByTestId("section-tabs").boundingBox())!;
      await expect(page.getByTestId("browse-compact-search"), `no search row @ ${variant.tag}`).toHaveCount(0);
      const searchIcon = page.getByTestId("section-tabs").getByRole("button", { name: "Search jobs" });
      await expect(searchIcon, `the search icon @ ${variant.tag}`).toBeVisible();
      const order: number[] = [(await searchIcon.boundingBox())!.x];
      for (const name of ACTION_ICON_NAMES) {
        const icon = page.getByRole("button", { name }).first();
        await expect(icon, `action icon ${name} @ ${variant.tag}`).toBeVisible();
        const box = (await icon.boundingBox())!;
        expect(box.y, `action icon ${name} sits in the tabs row`).toBeGreaterThanOrEqual(tabsRow.y - 1);
        expect(box.y + box.height, `action icon ${name} sits in the tabs row`).toBeLessThanOrEqual(tabsRow.y + tabsRow.height + 1);
        expect(box.x, `action icon ${name} sits right of the tabs`).toBeGreaterThan(tabsBox.x);
        order.push(box.x);
      }
      // The Jobs settings gear is the LAST control at the tabs row's right end, on every width, never in the top bar
      // (owner 2026-10-28, desktop: "move gear down with the other icons").
      const gear = page.getByRole("button", { name: "Jobs settings" });
      await expect(gear, `one gear @ ${variant.tag}`).toHaveCount(1);
      await expect(bar.getByRole("button", { name: "Jobs settings" }), `no gear in the top bar @ ${variant.tag}`).toHaveCount(0);
      const gearBox = (await gear.boundingBox())!;
      expect(gearBox.y, `the gear sits in the tabs row @ ${variant.tag}`).toBeGreaterThanOrEqual(tabsRow.y - 1);
      expect(gearBox.y + gearBox.height, `the gear sits in the tabs row @ ${variant.tag}`).toBeLessThanOrEqual(tabsRow.y + tabsRow.height + 1);
      expect(gearBox.x + gearBox.width, `the gear ends the tabs row @ ${variant.tag}`).toBeGreaterThan(tabsRow.x + tabsRow.width - 2);
      order.push(gearBox.x);
      // Every tab fits beside them, none scrolled out of sight (375: 218px of tabs in a 191px track before the
      // tighter phone gap, "Working" cut to "Work").
      expect(await tabs.evaluate((el) => el.scrollWidth - el.clientWidth), `every tab fits @ ${variant.tag}`).toBeLessThanOrEqual(0);
      expect(order, `search, Filters, then the gear, left to right @ ${variant.tag}`).toEqual([...order].sort((x, y) => x - y));
      // The search opens IN PLACE, in the tabs row (owner 2026-10-27: "search should just open where its at").
      await searchIcon.click();
      const field = page.getByTestId("section-tabs").locator('input[aria-label="Search jobs"]');
      await expect(field, `the field opens in the tabs row @ ${variant.tag}`).toBeVisible();
      const fieldBox = (await field.boundingBox())!;
      expect(fieldBox.y + fieldBox.height, `the field stays in the tabs row @ ${variant.tag}`).toBeLessThanOrEqual(tabsRow.y + tabsRow.height + 1);
      await page.keyboard.press("Escape");
      for (const name of MOVED_OUT_OF_ROW) {
        await expect(
          page.getByRole("button", { name }),
          `${name} belongs in the filter sheet, not the header row`,
        ).toHaveCount(0);
      }

      // --- a11y -----------------------------------------------------------
      const axe = await new AxeBuilder({ page })
        .withTags(AXE_TAGS)
        .analyze();
      expect(
        axe.violations.map((v) => `${v.id} (${v.impact}, ${v.nodes.length} nodes)`),
        `axe @ ${variant.tag}`,
      ).toEqual([]);

      await journey.milestone(page, `feed-chrome-${variant.tag}`);
      expect(writes, "the feed chrome check is read-only, but these user writes went out").toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}

const sheetRotation = rotationFor(14);
const sheetTitle = scenarioTitle({ journey: "feed-filter-sheet", persona: "helper-only", state: "approved", rotation: sheetRotation, outcome: "smooth" });
test(sheetTitle, async ({ browser, request, journey }) => {
  test.skip(filteredOut(sheetTitle), "SCENARIO pins another scenario");
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);
  const session = await getSession(request, "helper");
  const ctx = await newUserContext(browser, session);
  const writes = await trackWrites(ctx);
  try {
    const page = journey.track("helper", await ctx.newPage());
    await gotoBrowseSurface(page, "/jobs", { width: 375, height: 812, theme: "light" });

    await page.getByRole("button", { name: /^Filters/ }).first().click();

    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();

    // View choice — a labelled List / Map pair, not a filter chip, and Map is
    // still a real destination: picking it closes the sheet and swaps the feed.
    await expect(sheet.getByRole("radio", { name: "List" })).toBeVisible();
    const mapChoice = sheet.getByRole("radio", { name: "Map" });
    await expect(mapChoice).toBeVisible();
    await expect(mapChoice).toHaveAttribute("aria-checked", "false");

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
    await page.getByRole("dialog").getByRole("radio", { name: "Map" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await settleAnimations(page);
    await page.getByRole("button", { name: /^Filters/ }).first().click();
    await expect(
      page.getByRole("dialog").getByRole("radio", { name: "Map" }),
    ).toHaveAttribute("aria-checked", "true");

    // Put the view back on List: the shared Helpr's next journey expects the list.
    await page.getByRole("dialog").getByRole("radio", { name: "List" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(writes, "the filter sheet check is read-only, but these user writes went out").toEqual([]);
  } finally {
    await ctx.close();
  }
});

for (const [i, width] of [320, 375, 1440].entries()) {
  const rotation = rotationFor(15 + i);
  const title = scenarioTitle({ journey: `guest-browse-chrome-${width}`, persona: "new", state: "approved", rotation, outcome: "smooth" });
  test(title, async ({ browser, journey }) => {
    test.skip(filteredOut(title), "SCENARIO pins another scenario");
    const ctx = await newUserContext(browser, null, { desktop: width >= 900 });
    const writes = await trackWrites(ctx);
    try {
      const page = journey.track("guest", await ctx.newPage());
      await gotoBrowseSurface(page, "/browse", { width, height: width === 320 ? 640 : 812, theme: "light" });

      const layout = await measureLayout(page);
      expect(layout.overflowOffenders, `guest overflow offenders @ ${width}`).toEqual([]);
      expect(layout.overflowPx, `guest overflow @ ${width}`).toBeLessThanOrEqual(0);
      expect(layout.h1Count, `guest h1 count (${layout.h1Texts.join(" | ")})`).toBe(1);
      expect(layout.smallTapTargets, `guest sub-44px controls @ ${width}`).toEqual([]);

      // Both CTAs intact — never collapsed to icons, never behind a menu.
      //
      // Asserted as LINKS, not buttons. Guest /browse renders through
      // `PublicHeaderPage` on web now, so these two CTAs are the marketing
      // Navbar's — `<Button asChild><Link>`, which is an `<a>` and therefore
      // `role="link"`. They used to be the old guest header's own buttons. The
      // intent of the assertion is unchanged and is the thing worth keeping: both
      // CTAs are visible, side by side, not collapsed behind a menu or an icon.
      // (Role is what moved; the accessible NAME did not need touching —
      // getByRole matches it case-insensitively, so "Log in" still matches the
      // rendered "Log in".)
      await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Join free" })).toBeVisible();

      // NO Search and NO Filters on the guest surface. This assertion has now
      // been flipped twice, so the history matters more than the assertion:
      //
      //   Aug 2026  — pulled from the guest surface (owner: they "take up too
      //               much space at the top").
      //   2026-09-07 — owner reversed it ("/browse can have the filters",
      //               c7bce404e) and this spec was updated to require them.
      //   2026-09-11 — removed again (8321d4344) because guest /browse and the
      //               native app are ONE surface and diverging them would give
      //               the phone-sized website a control the app does not have.
      //               Owner CONFIRMED this directly when asked, choosing "keep
      //               them off, update the test" over restoring them. That ruling
      //               SUPERSEDES 2026-09-07.
      //
      // So do not flip this back on the strength of the c7bce404e commit message
      // alone — it is the older decision. Ask first.
      for (const name of ACTION_ICON_NAMES) {
        await expect(
          page.getByRole("button", { name }).first(),
          `guest brand row must NOT carry ${name} @ ${width} — removed 2026-09-11, owner-confirmed`,
        ).toBeHidden();
      }

      // The inline List/Map toggle is GONE, and that is deliberate (owner,
      // 2026-08-19: "Don't give the list or map option in the guest page like
      // this. Remove it and move jobs up"). The map is reached the agreed way
      // instead — through the Filters sheet, whose trigger the guest row now
      // carries (asserted above). If the inline row reappears here, someone
      // has re-added it instead of using the sheet.
      await expect(
        page.getByRole("radiogroup", { name: "Feed view" }),
        `guest List/Map toggle was removed on purpose @ ${width}`,
      ).toHaveCount(0);

      await journey.milestone(page, `guest-browse-chrome-${width}`);
      expect(writes, "guest /browse is read-only, but these user writes went out").toEqual([]);
    } finally {
      await ctx.close();
    }
  });
}

// PROOF THIS SPEC CAN FAIL — blind the View choice to its own state.
//
// The List ⇄ Map pair moved INTO the filter sheet, and this spec is what
// proves the move did not lose it: both chips reachable, Map a real
// destination (picking it closes the sheet and swaps the feed), and
// `aria-pressed` reporting which view you are actually in when you come back.
//
// `active` is that last fact. Pinning it false leaves both chips present,
// labelled, tappable and still switching the feed — so "the control is there"
// and "the map renders" both stay true — while the sheet silently stops
// telling anyone, sighted or not, which view is selected. Only the
// round-trip assertion (`aria-pressed` === "true" after picking Map) sees it.
//
// NOT the desktop toolbar's map button (Dashboard.tsx `aria-pressed={mapVisible}`):
// that is a different control on a surface this spec never opens, and mutating
// it came back SURVIVED — correctly, since nothing here measures it.
// (Board 24, 2026-10-20: the View is the shared SegmentedControl, so the selected state is `aria-checked`.)
// @mutate src/components/dashboard/browseTasksToolbar/BrowseViewToggle.tsx |       value={view} |       value={"list"}
