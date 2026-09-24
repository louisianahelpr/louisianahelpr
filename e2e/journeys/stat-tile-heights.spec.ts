import type { Page } from "@playwright/test";
import { test, expect, assertHealthy, getSession, newUserContext, sessionsAvailable } from "./fixtures";
import type { Role } from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle } from "./scenarios";

/**
 * Journey — stat tiles in one row are one height.
 *
 * Original (OPEN.md, 2026-09-12 changed-screen sweep): on /user/:id at phone
 * width the AtAGlance tile "4.5 · 5 reviews" measured 58px beside "5 · Jobs
 * completed" at 70.3px, because the label wrapped in one tile and the tiles
 * were not stretched to their row.
 *
 * The CLASS, over the screen's OWN inventory: every direct child of every
 * grid inside a stat section ("At a glance") is grouped into rows by its top
 * edge, and each row's max − min height must be 0 (±0.5px sub-pixel); so must
 * the whole grid's, because the two-up phone layout wraps one visual row of
 * figures onto two grid rows, which is where the original 58/70.3 pair sat. Checked
 * at 375 and 1440, light and dark, for each signed-in test account's own
 * profile, and again with one label forced to wrap (the long-label case), so
 * a profile whose real copy happens to fit cannot hide the defect.
 */

const rotation = rotationFor(5);
const title = scenarioTitle({ journey: "stat-tile-heights", persona: "helper-only", state: "approved", rotation, outcome: "smooth" });

type RowReport = { top: number; heights: number[]; spread: number; labels: string[] };

const rows = (page: Page) =>
  page.evaluate(() => {
    const out: RowReport[] = [];
    for (const section of Array.from(document.querySelectorAll('section[aria-label="At a glance"]'))) {
      for (const grid of Array.from(section.querySelectorAll("*")).filter((el) => getComputedStyle(el).display === "grid")) {
        const byTop = new Map<number, HTMLElement[]>();
        for (const child of Array.from(grid.children) as HTMLElement[]) {
          const top = Math.round(child.getBoundingClientRect().top);
          byTop.set(top, [...(byTop.get(top) ?? []), child]);
        }
        for (const [top, kids] of byTop) {
          const heights = kids.map((k) => Math.round(k.getBoundingClientRect().height * 10) / 10);
          out.push({ top, heights, spread: Math.max(...heights) - Math.min(...heights), labels: kids.map((k) => (k.textContent ?? "").trim()) });
        }
        // The whole grid as one row too: at 375 the four tiles wrap two-up, and the
        // original report (58px vs 70.3px) was a tile in row 1 beside one in row 2.
        const all = Array.from(grid.children) as HTMLElement[];
        const heights = all.map((k) => Math.round(k.getBoundingClientRect().height * 10) / 10);
        if (byTop.size > 1) out.push({ top: -1, heights, spread: Math.max(...heights) - Math.min(...heights), labels: all.map((k) => (k.textContent ?? "").trim()) });
      }
    }
    return out;
  });

test(title, async ({ browser, request, journey }) => {
  test.skip(filteredOut(title), "SCENARIO pins another scenario");
  const avail = sessionsAvailable();
  test.skip(!avail.ok, avail.why);
  let measured = 0;
  const failures: string[] = [];
  for (const role of ["helper", "poster"] as Role[]) {
    const session = await getSession(request, role);
    for (const theme of ["light", "dark"] as const) {
      const ctx = await newUserContext(browser, session, { desktop: true });
      await ctx.addInitScript((t) => {
        try {
          localStorage.setItem("helpr-theme", t);
        } catch {
          /* storage blocked: theme falls back to system */
        }
      }, theme);
      const page = journey.track(`${role}-${theme}`, await ctx.newPage());
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
        await page.goto(`/user/${session.user.id}`);
        await assertHealthy(page, `/user/:id ${role}`);
        const section = page.locator('section[aria-label="At a glance"]').first();
        await expect(section).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(800);
        const tag = `${role}-${theme}-${width}`;
        await page.screenshot({ path: test.info().outputPath(`${tag}.png`) });
        const natural = await rows(page);
        // Long-label case: force the first tile's label to wrap onto several lines.
        await page.evaluate(() => {
          const grid = document.querySelector('section[aria-label="At a glance"] .grid');
          const label = grid?.firstElementChild?.lastElementChild;
          if (label) label.textContent = "A deliberately long label that wraps onto several lines";
        });
        const long = await rows(page);
        await section.screenshot({ path: test.info().outputPath(`${tag}-long.png`) });
        console.log(`[tiles] ${tag} natural=${JSON.stringify(natural.map((r) => [r.heights, r.labels]))} long=${JSON.stringify(long.map((r) => r.heights))}`);
        for (const [kind, set] of [["natural", natural], ["long", long]] as const) {
          for (const r of set) {
            measured++;
            if (r.heights.length > 1 && r.spread > 0.5) {
              failures.push(`${tag} ${kind}: heights ${r.heights.join(" / ")} (spread ${r.spread.toFixed(1)}px) for ${r.labels.join(" | ")}`);
            }
          }
        }
        if (width === 375) {
          const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          console.log(`[tiles] ${tag} overflowX=${overflow}`);
          expect(overflow, `${tag}: horizontal overflow at 375`).toBeLessThanOrEqual(0);
        }
      }
      await ctx.close();
    }
  }
  expect(measured, "no AtAGlance tile rows were found on any profile").toBeGreaterThan(0);
  expect(failures, "stat tiles in one row differ in height").toEqual([]);
});

// Breaking the row-stretch is the whole defect this journey was written for:
// without `auto-rows-fr` the two-up phone grid sizes each row to its own
// content, so the forced long label makes row 1 taller than row 2 and the
// whole-grid spread goes back past 0.5px — the original 58 vs 70.3px pair.
// @mutate src/pages/user/AtAGlanceCard.tsx | grid grid-cols-2 auto-rows-fr gap-2 sm:grid-cols-4 | grid grid-cols-2 gap-2 sm:grid-cols-4
