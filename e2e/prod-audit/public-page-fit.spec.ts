/**
 * A PUBLIC PAGE STARTS AT ITS TITLE AND ENDS AT ITS FOOTER (Q1312, owner
 * 2026-10-05: "Browse Jobs opens partly hidden on a phone ... a large blank gap
 * sits between the empty-state message and the footer").
 *
 * Measured on prod before the fix, /browse at 375 as a guest: the empty state
 * sat in a `min-h-screen` box (a loading reserve kept for CLS), so "Nothing
 * today, neighbor." floated ~270px under the title and ~320px of blank ran from
 * "Or Hire Someone for a Job" to the footer. The reserve is gone; the footer
 * now waits for the feed (PublicLayout `footer`), so there is nothing to hold
 * below the fold while it loads.
 *
 * For every guest route in src/App.tsx (deriveRouteSet, the inventory
 * page-settle and the press sweep walk, split as page-settle splits it),
 * loaded as a GUEST at 375 on this
 * commit's build against prod data, the routes that end in the site
 * <footer> (found at run time, not listed by hand) must:
 *   1. open at the top: document scrollTop 0 after the page settles, and the
 *      first <h1> fully below every fixed bar pinned to the top edge;
 *   2. end at the footer: when the page scrolls (so the layout's flex-1 is not
 *      just filling a short screen), the blank band between the last visible
 *      content and the footer is at most MAX_TAIL_GAP (one job card).
 */
// @mutate src/pages/home/DashboardGuest.tsx | const emptyWrapperClass = isNativePlatform ? "flex-1 min-h-full flex" : "flex"; | const emptyWrapperClass = isNativePlatform ? "flex-1 min-h-full flex" : "min-h-screen md:min-h-[50vh] flex";
import { test, expect } from "../prodTest";
import { newUserContext, POSTER_ID, HELPER_ID } from "./harness";
// @ts-expect-error -- plain Node ESM with no .d.mts (same as page-settle.spec.ts)
import { deriveRouteSet } from "../../scripts/audit/press-every-control.mjs";

/** One job card at 375 (JobCardSkeleton ~160px) plus its list gap, rounded up. */
export const MAX_TAIL_GAP = 200;

interface RouteRow { url: string; personas: string[]; redirect: boolean }

interface Fit {
  hasFooter: boolean;
  scrollTop: number;
  scrolls: boolean;
  h1Top: number | null;
  h1Text: string | null;
  barBottom: number;
  tailGap: number | null;
  lastContent: string | null;
}

/** Runs in the page. */
function measureFit(): Fit {
  const se = document.scrollingElement as HTMLElement;
  const footer = document.querySelector("footer");
  // Fixed bars pinned to the top edge (the marketing nav).
  let barBottom = 0;
  for (const el of document.querySelectorAll<HTMLElement>("body *")) {
    const cs = getComputedStyle(el);
    if (cs.position !== "fixed" || cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.top <= 1 && r.height > 0 && r.height < 200 && r.width > window.innerWidth / 2) barBottom = Math.max(barBottom, r.bottom);
  }
  const h1 = document.querySelector("h1");
  const visible = (el: Element) => {
    if (el.closest("[aria-hidden='true']")) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0 || cs.position === "fixed") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  let tailGap: number | null = null;
  let lastContent: string | null = null;
  if (footer) {
    const footerTop = footer.getBoundingClientRect().top + se.scrollTop;
    let last = 0;
    for (const el of document.querySelectorAll("body *")) {
      if (footer.contains(el) || !visible(el)) continue;
      const isLeafText = el.children.length === 0 && (el.textContent ?? "").trim().length > 0;
      const isMedia = ["IMG", "svg", "BUTTON", "INPUT", "TEXTAREA", "SELECT", "VIDEO", "CANVAS"].includes(el.tagName);
      if (!isLeafText && !isMedia) continue;
      const bottom = el.getBoundingClientRect().bottom + se.scrollTop;
      if (bottom <= footerTop && bottom > last) {
        last = bottom;
        lastContent = `${el.tagName} "${(el.textContent ?? "").trim().slice(0, 40)}"`;
      }
    }
    tailGap = Math.round(footerTop - last);
  }
  return {
    hasFooter: !!footer,
    scrollTop: Math.round(se.scrollTop),
    scrolls: se.scrollHeight > se.clientHeight + 1,
    h1Top: h1 ? Math.round(h1.getBoundingClientRect().top) : null,
    h1Text: h1 ? (h1.textContent ?? "").trim().slice(0, 40) : null,
    barBottom: Math.round(barBottom),
    tailGap,
    lastContent,
  };
}

test("every public page opens at its title and ends at its footer at 375 (guest)", async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  const routes = (deriveRouteSet({ seedJobId: "test", helperId: HELPER_ID, customerId: POSTER_ID, adminViews: [] }) as RouteRow[])
    .filter((r) => !r.redirect && !r.url.startsWith("/jobs/"))
    // The routes a guest can open: page-settle's own guest split (a route
    // whose personas are not both customer and helper), admin-only excluded.
    // Signed-in routes send a guest to /login, which is measured on its own.
    .filter((r) => !r.personas.every((p) => p === "admin") && !(r.personas.includes("customer") && r.personas.includes("helper")));
  // Floor: 17 guest routes on 2026-10-05, when this landed (the landing, auth pages, legal,
  // help, support, /browse, the 404).
  expect(routes.length).toBeGreaterThan(12);

  const withFooter: string[] = [];
  const problems: string[] = [];
  for (const r of routes) {
    const ctx = await newUserContext(browser, null);
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(new URL(r.url, test.info().project.use.baseURL).toString(), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    // Let the feed's arrival gate and any footer-after-content mount settle.
    await page.waitForTimeout(2500);
    const fit = await page.evaluate(measureFit);
    const at = new URL(page.url()).pathname + new URL(page.url()).search;
    await ctx.close();
    if (!fit.hasFooter) continue;
    withFooter.push(`${r.url} -> ${at}`);
    if (fit.scrollTop !== 0) problems.push(`${r.url}: opened scrolled to ${fit.scrollTop}px`);
    if (fit.h1Top !== null && fit.h1Top < fit.barBottom) {
      problems.push(`${r.url}: title "${fit.h1Text}" top ${fit.h1Top}px is under the ${fit.barBottom}px top bar`);
    }
    if (fit.scrolls && fit.tailGap !== null && fit.tailGap > MAX_TAIL_GAP) {
      problems.push(`${r.url}: ${fit.tailGap}px of blank between ${fit.lastContent} and the footer (max ${MAX_TAIL_GAP})`);
    }
    console.log(`[public-page-fit] ${r.url} -> ${at}: ${JSON.stringify(fit)}`);
  }
  // Floor: the landing, /browse, /help, the four legal pages and the 404 all
  // end in the site footer for a guest. Far fewer means the probe broke.
  expect(withFooter.length, `routes ending in the site footer: ${withFooter.join(", ")}`).toBeGreaterThan(5);
  expect(withFooter.some((w) => w.startsWith("/browse ")), "/browse is in the measured set").toBe(true);
  expect(problems).toEqual([]);
});
