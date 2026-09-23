import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect, assertHealthy, getSession, newUserContext, sessionsAvailable } from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle } from "./scenarios";

/**
 * Journey — EVERY Profile tab renders into the SAME box.
 *
 * ORIGINAL REPORT (owner, 2026-09-19): "do you see how gift card and home
 * history does not have that side spacing gap on the sides of the content?
 * none of the other profile tabs should it either. this also suggests they do
 * not share the same shell."
 *
 * MEASURED FIRST, AS INSTRUCED — and the premise did not reproduce. At HEAD,
 * all 25 tabs render into an identical content box: [24, 1168] inside a
 * [0, 1192] `.app-shell-frame` at 1440, and [20, 355] of 375 on a phone —
 * gift_card and home_history included, because both are `?tab=` panels inside
 * ProfileTabPanels, not separate routes (`/gift-card` and `/home-history` were
 * `<Navigate>` redirects into the tab, since deleted). There is no second shell and no extra
 * gutter to remove, and CHANGING the padding would have split Profile from
 * Dashboard / Posts / Jobs / Messages, which is precisely the VN-37 attempt
 * documented and reverted in Profile.tsx.
 *
 * So this is the check the report earns instead of a fix: the parity that
 * currently holds, PINNED, measured in a real browser against the real
 * backend. A static test cannot see it — src/components/profile/
 * profileTabShell.test.ts already asserts the wrapper STRINGS match, and
 * matching strings are not matching pixels once a tab's own component adds a
 * container, a `max-w-*` or a bleed.
 *
 * THE INVENTORY IS THE APP'S OWN: the `Tab` union is parsed out of
 * src/pages/profile/types.ts, so a tab added tomorrow is walked tomorrow
 * without anyone remembering to list it here. The floor below fails loudly if
 * that parse ever returns nothing.
 *
 * WHAT IS ALLOWED TO DIFFER: what a tab puts INSIDE its box. Wrapped's
 * centred inner column and Analytics' charts are content decisions. What may
 * not differ is the box itself.
 */

// `__dirname` does not exist in this ESM spec context — it threw at collection
// time, so the file reported "No tests found" rather than failing loudly.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Every `?tab=` value, from the union the router actually switches on. */
function tabsFromSource(): string[] {
  const src = readFileSync(resolve(ROOT, "src/pages/profile/types.ts"), "utf8");
  const union = src.match(/export type Tab\s*=\s*([^;]+);/)?.[1] ?? "";
  return [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

/**
 * The box a tab's CONTENT lands in, measured against `.app-shell-frame` — not
 * `<main>`, which is a full-width scroll wrapper (CLAUDE.md). Reported as the
 * gutter on each side so the number is the one the owner described.
 *
 * It measures the tab's OWN root element, inset by that element's own
 * padding — NOT the shared panel wrapper. Measuring the wrapper was tried
 * first and was vacuous: a `px-3` planted inside GiftCard.tsx (the exact
 * defect this guard exists to catch) moved every card 12px and the check
 * stayed green, because the wrapper it was reading never moves. A guard that
 * reads the box above the one that can change is not a guard.
 */
const measure = (page: Page) =>
  page.evaluate(() => {
    const frame = document.querySelector(".app-shell-frame");
    const fr = frame
      ? frame.getBoundingClientRect()
      : ({ left: 0, right: window.innerWidth } as DOMRect);
    // The panel every non-landing tab renders through; the landing tab has its
    // own pull-to-refresh wrapper, so fall back to the shared measure column.
    const panel =
      document.querySelector(".animate-ds-page-in") ?? document.querySelector(".page-measure");
    // The tab's own root inside that panel — this is the element a tab
    // component can give a padding or a max-width of its own.
    const root = (panel?.firstElementChild as HTMLElement | null) ?? (panel as HTMLElement | null);
    const rr = root?.getBoundingClientRect() ?? null;
    const cs = root ? getComputedStyle(root) : null;
    const padL = cs ? parseFloat(cs.paddingLeft) || 0 : 0;
    const padR = cs ? parseFloat(cs.paddingRight) || 0 : 0;
    const left = rr ? rr.left + padL : null;
    const right = rr ? rr.right - padR : null;
    return {
      frameLeft: Math.round(fr.left),
      frameRight: Math.round(fr.right),
      left: left === null ? null : Math.round(left),
      right: right === null ? null : Math.round(right),
      gutterLeft: left === null ? null : Math.round(left - fr.left),
      gutterRight: right === null ? null : Math.round(fr.right - right),
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      widerThanViewport: Array.from(document.querySelectorAll("body *")).filter(
        (el) => el.getBoundingClientRect().width > window.innerWidth + 1,
      ).length,
    };
  });

const rotation = rotationFor(6);
const title = scenarioTitle({ journey: "profile-tab-shell-parity", persona: "both", state: "approved", rotation, outcome: "smooth" });

test(title, async ({ browser, request, journey }) => {
  test.skip(filteredOut(title), "SCENARIO pins another scenario");
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);

  const tabs = tabsFromSource();
  // FLOOR: an empty or truncated inventory must fail, never pass quietly.
  expect(tabs.length, "no ?tab= values were parsed out of src/pages/profile/types.ts").toBeGreaterThanOrEqual(20);
  expect(tabs, "the two tabs the owner named must be in the inventory").toEqual(
    expect.arrayContaining(["gift_card", "home_history", "landing"]),
  );

  const session = await getSession(request, "poster");
  const failures: string[] = [];
  let measured = 0;

  for (const width of [1440, 375]) {
    const ctx = await newUserContext(browser, session, { desktop: width === 1440 });
    const page = journey.track(`w${width}`, await ctx.newPage());
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });

    const seen: Record<string, { gutterLeft: number | null; gutterRight: number | null }> = {};
    for (const tab of tabs) {
      await page.goto(`/profile?tab=${tab}`);
      await assertHealthy(page, `/profile?tab=${tab}`);
      await page.waitForTimeout(1200);
      const m = await measure(page);
      measured++;
      seen[tab] = { gutterLeft: m.gutterLeft, gutterRight: m.gutterRight };
      console.log(`[tab-shell] ${width} ${tab} gutters=${m.gutterLeft}/${m.gutterRight} box=[${m.left},${m.right}] frame=[${m.frameLeft},${m.frameRight}] ovf=${m.overflowX}`);

      if (m.left === null) failures.push(`${width} ${tab}: no content box found at all`);
      // Proof of fit, per tab, at both widths.
      if (m.overflowX > 0) failures.push(`${width} ${tab}: horizontal overflow ${m.overflowX}px`);
      if (m.widerThanViewport > 0) failures.push(`${width} ${tab}: ${m.widerThanViewport} element(s) wider than the viewport`);
      // No rail-width dead band: the frame already excludes the desktop rail,
      // so the two gutters must be equal — a page that re-inset itself would
      // show up here as a lopsided pair.
      if (m.gutterLeft !== null && m.gutterRight !== null && Math.abs(m.gutterLeft - m.gutterRight) > 1) {
        failures.push(`${width} ${tab}: content is not centred in the post-rail area (${m.gutterLeft} left vs ${m.gutterRight} right)`);
      }
    }

    // THE PARITY ITSELF: one gutter for every tab at this width.
    const distinct = [...new Set(Object.values(seen).map((g) => `${g.gutterLeft}/${g.gutterRight}`))];
    if (distinct.length !== 1) {
      const byGutter = Object.entries(seen)
        .map(([tab, g]) => `${tab}=${g.gutterLeft}/${g.gutterRight}`)
        .join(", ");
      failures.push(`${width}: ${distinct.length} different tab gutters (${distinct.join(" vs ")}) — ${byGutter}`);
    }
    await page.screenshot({ path: test.info().outputPath(`tabs-${width}.png`) });
    await ctx.close();
  }

  expect(measured, "no Profile tab was measured").toBeGreaterThanOrEqual(40);
  expect(failures, "Profile tabs do not all share one shell").toEqual([]);
});

// ProfileTabBody deliberately accepts NO className and NO style, so the
// original defect shape (a lane planting `px-3` in one tab's own copy of the
// wrapper div) is no longer expressible — and a mutation of the shared class
// moves all 25 tabs together, which PARITY alone cannot see. What it can see
// is the other half of the check: an asymmetric margin on the one box every
// tab renders into makes gutterLeft and gutterRight disagree by 24px on every
// tab at both widths, which is the "content is not centred in the post-rail
// area" leg. That is the single line the whole guard rests on.
// @mutate src/components/profile/ProfileTabBody.tsx | export const PROFILE_TAB_BODY_CLASS = "space-y-section"; | export const PROFILE_TAB_BODY_CLASS = "space-y-section ml-6";
