import { test, expect } from "@playwright/test";
import {
  FAKE_CUSTOMER,
  installSupabaseMocks,
  seedAuthedSession,
} from "../happy-path/fixtures";

// Desktop content-fill regression guard. Every page in scope must fill at
// least MIN_FILL_PCT of a 1440px viewport with its main content column.
// Catches the "orphan narrow column stranded in a wide viewport" defect
// class the LH audit standard specifically calls out (§2 Cross-cutting
// principles → "No orphan narrow column on wide web"). Fires when a page
// caps its container too small (`max-w-md`/`max-w-lg` mx-auto without a
// desktop widen) or a single-column layout doesn't split into two on lg+.
//
// If this fails on a page you just added, the fix is usually one of:
//   1. Bump the container's `max-w-*` at the lg/xl breakpoints
//      (canonical: `max-w-5xl lg:max-w-6xl xl:max-w-7xl 2xl:max-w-[90rem]`).
//   2. Wrap a single-column card list into a responsive grid on lg+
//      (canonical: `lg:grid lg:grid-cols-12 lg:gap-8` with `aside col-span-4`
//      + `section col-span-8`, matching Pets/Family/PayItForward/StrSettings).
//   3. For focused-flow pages (auth screens), pass a `desktopBrandPanel`
//      to `<AuthShell />` so the empty gutter becomes intentional brand
//      real estate instead of dead space.
const DESKTOP_WIDTH = 1440;
const MIN_FILL_PCT = 65;

interface Route {
  path: string;
  auth: "anon" | "authed";
  /** Set true for legitimately narrow focused flows (auth pages get a
      brand pane companion, so 65% still applies). Leave false for any
      real content page. */
  exempt?: boolean;
}

const ROUTES: Route[] = [
  // Public marketing
  { path: "/", auth: "anon" },
  { path: "/for-business", auth: "anon" },
  { path: "/subscription", auth: "anon" },
  { path: "/help", auth: "anon" },
  { path: "/legal", auth: "anon" },
  { path: "/jobs", auth: "anon" },
  // /data-rights is not listed: since 2026-08-18 it is a redirect into
  // /profile?tab=legal, so as an anon route it only ever measured the login
  // page. /profile in the authed block below carries the same content
  // container (`.container mx-auto px-5 lg:px-8 xl:px-12`) that the tab
  // panels render inside, so the fill number is already covered there.

  // Auth screens are deliberately narrow, so a widest-single-element fill
  // metric under-reports them by design — flag as exempt with the canonical
  // fix pattern documented in the file header above.
  //
  // The reason USED to be "they render the AuthBrandPane on lg+, so desktop is
  // TWO ~500px columns side by side". No screen does that any more: Login and
  // Signup dropped the pane when their headings absorbed the emblem, and
  // ForgotPassword / ResetPassword dropped it in the 2026-08-24 V4 pass (it was
  // rendering a second back chevron beside the title row's). Login and Signup
  // now fill the width with a real two-column card; ForgotPassword and
  // ResetPassword stay a centred max-w-sm column on purpose — stretching a
  // single email field to page-measure put it ~1900px edge-to-edge at 1440,
  // which is what the narrow cap was introduced to fix.
  { path: "/login", auth: "anon", exempt: true },
  { path: "/signup", auth: "anon", exempt: true },
  { path: "/forgot-password", auth: "anon", exempt: true },
  { path: "/reset-password", auth: "anon", exempt: true },

  // Authed core loop
  { path: "/dashboard", auth: "authed" },
  { path: "/my-posts", auth: "authed" },
  { path: "/my-jobs", auth: "authed" },
  { path: "/messages", auth: "authed" },
  { path: "/profile", auth: "authed" },
  { path: "/post-job", auth: "authed" },

  // Standalone features
  { path: "/pets", auth: "authed" },
  { path: "/pay-it-forward", auth: "authed" },
  { path: "/family", auth: "authed" },
  { path: "/analytics", auth: "authed" },
  { path: "/benefits", auth: "authed" },
  { path: "/home-history", auth: "authed" },
  { path: "/work-record", auth: "authed" },
  { path: "/str-settings", auth: "authed" },
  { path: "/wrapped", auth: "authed" },

  // Business
  { path: "/business/team", auth: "authed" },
  { path: "/business/billing", auth: "authed" },
  { path: "/business/contracts", auth: "authed" },
  { path: "/business/exports", auth: "authed" },
  { path: "/business/reports", auth: "authed" },
  { path: "/business/api", auth: "authed" },
  { path: "/business/onboarding", auth: "authed" },
];

test.describe("desktop content fills the viewport", () => {
  test.use({ viewport: { width: DESKTOP_WIDTH, height: 900 } });

  for (const route of ROUTES) {
    if (route.exempt) continue;
    test(`${route.path} — content ≥ ${MIN_FILL_PCT}% of ${DESKTOP_WIDTH}px viewport`, async ({ page, context }) => {
      await installSupabaseMocks(page);
      if (route.auth === "authed") {
        await seedAuthedSession(context, FAKE_CUSTOMER, "");
      }
      await page.goto(route.path);
      // Give the app a moment to hydrate + any lazy-loaded routes to swap in.
      await page.waitForLoadState("networkidle").catch(() => {});

      const measurement = await page.evaluate(() => {
        const vw = window.innerWidth;
        const main = document.querySelector("main, #main-content") || document.body;
        const nodes = Array.from(
          main.querySelectorAll("h1, h2, .container, [class*='max-w-'], article, section"),
        );
        let maxWidth = 0;
        for (const n of nodes) {
          const rect = n.getBoundingClientRect();
          if (rect.width > maxWidth && rect.width <= vw) maxWidth = rect.width;
        }
        return { vw, contentW: Math.round(maxWidth), pct: Math.round((maxWidth / vw) * 100) };
      });

      // Hard-coded reason so a CI failure tells the reader WHY, not just
      // "assertion failed on line 90".
      expect(
        measurement.pct,
        `${route.path} filled only ${measurement.pct}% of ${measurement.vw}px viewport (contentW=${measurement.contentW}px). ` +
          `The LH audit standard forbids orphan narrow columns on desktop. See the fix guidance in this spec's file header comment.`,
      ).toBeGreaterThanOrEqual(MIN_FILL_PCT);
    });
  }
});
