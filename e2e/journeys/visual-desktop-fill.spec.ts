import type { Request } from "@playwright/test";
import { test, expect, assertHealthy, getSession, isUserWrite, newUserContext, sessionsAvailable } from "./fixtures";
import { filteredOut, rotationFor, scenarioTitle } from "./scenarios";

/**
 * Journey — DESKTOP CONTENT FILLS THE VIEWPORT, on the real backend.
 *
 * Moved here from the mocked e2e/visual-audit/desktop-fill.spec.ts (Q1035:
 * every mocked spec is migrated to prod or retired, one at a time). The check
 * is the same: at 1440px every page in scope fills at least MIN_FILL_PCT of
 * the viewport with its main content column (LH audit standard §2, "No orphan
 * narrow column on wide web"). The signed-in rows are the shared test poster
 * signed in for real, so each page draws its own prod rows; the public rows
 * are a real guest.
 *
 * ONE TEST PER ROUTE on purpose: the request budget is per test, and one test
 * holding every load would put ~16 page loads into a single test.
 *
 * NOT PORTED: the /browse row. Its content column is the feed grid, which only
 * exists when prod has open jobs (open_jobs_browse held 0 rows at 05:00:21Z
 * 2026-11-05), so it would measure nothing. Its invariant (the feed grid is
 * never capped narrow) is pinned at source level in
 * src/test/guestFeedGridFillsDesktop.test.ts, which carries its @mutate.
 *
 * Read-only: it only opens screens. Any user write fails the test.
 *
 * If this fails on a page you just added, the fix is usually one of:
 *   1. Bump the container's `max-w-*` at the lg/xl breakpoints
 *      (canonical: `max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]`).
 *   2. Wrap a single-column card list into a responsive grid on lg+
 *      (canonical: `lg:grid lg:grid-cols-12 lg:gap-8` with `aside col-span-4`
 *      + `section col-span-8`).
 *   3. For focused-flow pages (auth screens), pass a `desktopBrandPanel`
 *      to `<AuthShell />`. Login, Signup, Forgot and Reset password are
 *      deliberately narrow and not measured here (see the mocked spec's history).
 */
// Breaks the defect class this spec exists for: the signed-in pages' shared
// content container capped narrow, so /profile and its tabs strand a column.
// @mutate src/pages/profile/Profile.tsx | <div className="container mx-auto px-5 lg:px-6 xl:px-6 pb-0 flex-1 | <div className="container max-w-sm mx-auto px-5 lg:px-6 xl:px-6 pb-0 flex-1

const DESKTOP_WIDTH = 1440;
const MIN_FILL_PCT = 65;

type Route = { path: string; auth: "anon" | "authed" };

const ROUTES: Route[] = [
  { path: "/", auth: "anon" },
  { path: "/help", auth: "anon" },
  { path: "/legal", auth: "anon" },
  { path: "/home", auth: "authed" },
  { path: "/posts", auth: "authed" },
  { path: "/jobs", auth: "authed" },
  { path: "/messages", auth: "authed" },
  { path: "/profile", auth: "authed" },
  { path: "/post-job", auth: "authed" },
  { path: "/profile?tab=pets", auth: "authed" },
  { path: "/profile?tab=analytics", auth: "authed" },
  { path: "/profile?tab=home_history", auth: "authed" },
  { path: "/profile?tab=work_record", auth: "authed" },
  { path: "/profile?tab=str_settings", auth: "authed" },
  { path: "/profile?tab=wrapped", auth: "authed" },
];

const slug = (p: string) => p.replace(/^\//, "").replace(/[?=&/]+/g, "-") || "landing";

ROUTES.forEach((route, i) => {
  const rotation = rotationFor(20 + i);
  const title = scenarioTitle({
    journey: `visual-desktop-fill-${slug(route.path)}`,
    persona: route.auth === "authed" ? "poster-only" : "new",
    state: "approved",
    rotation,
    outcome: "smooth",
  });

  test(`${title} · ${route.path} content >= ${MIN_FILL_PCT}% of ${DESKTOP_WIDTH}px`, async ({ browser, request, journey }) => {
    test.skip(filteredOut(title), "SCENARIO pins another scenario");
    const avail = sessionsAvailable();
    if (route.auth === "authed") test.skip(!avail.ok, avail.why);
    test.setTimeout(120_000);

    const session = route.auth === "authed" ? await getSession(request, "poster") : null;
    const ctx = await newUserContext(browser, session, { desktop: true });
    const writes: string[] = [];
    ctx.on("request", (req: Request) => {
      if (isUserWrite(req.method(), req.url()) || /\/rpc\/save_my_job_post_draft\b/.test(req.url())) {
        writes.push(`${req.method()} ${req.url().slice(0, 140)}`);
      }
    });
    try {
      const page = journey.track(route.auth === "authed" ? "poster" : "guest", await ctx.newPage());
      await page.setViewportSize({ width: DESKTOP_WIDTH, height: 900 });
      await page.goto(route.path);
      await assertHealthy(page, `${route.path} @ ${DESKTOP_WIDTH}`);

      const m = await page.evaluate(() => {
        const vw = window.innerWidth;
        const main = document.querySelector("main, #main-content") || document.body;
        const nodes = Array.from(main.querySelectorAll("h1, h2, .container, [class*='max-w-'], article, section"));
        let maxWidth = 0;
        for (const n of nodes) {
          const rect = n.getBoundingClientRect();
          if (rect.width > maxWidth && rect.width <= vw) maxWidth = rect.width;
        }
        return { vw, contentW: Math.round(maxWidth), pct: Math.round((maxWidth / vw) * 100), found: nodes.length };
      });
      console.log(`[desktop-fill] ${route.path} ${m.pct}% (${m.contentW}/${m.vw}px, ${m.found} candidates)`);
      expect(m.found, `${route.path}: no content element to measure`).toBeGreaterThan(0);
      expect(
        m.pct,
        `${route.path} filled only ${m.pct}% of ${m.vw}px viewport (contentW=${m.contentW}px). ` +
          `The LH audit standard forbids orphan narrow columns on desktop. See this spec's header for the fix.`,
      ).toBeGreaterThanOrEqual(MIN_FILL_PCT);
      await journey.milestone(page, `desktop-fill-${slug(route.path)}`);
      expect(writes, "the desktop-fill journey is read-only: no user writes").toEqual([]);
    } finally {
      await ctx.close().catch(() => {});
    }
  });
});
