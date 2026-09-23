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
//      + `section col-span-8`, matching Pets/Family/GiftCard/StrSettings).
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
  /**
   * The element that actually holds this route's content, when the generic
   * scan cannot find it.
   *
   * The scan looks at `h1, h2, .container, [class*='max-w-'], article, section`.
   * /browse's content column is a plain `div.grid.md:grid-cols-2`
   * (DashboardGuest's FEED_GRID_CLASS) and matches none of them, so the widest
   * thing it ever found was a HEADING INSIDE A CARD: it reported 568px / 39%
   * while the feed grid measured 1344px — 93% of a 1440px viewport. /browse was
   * carried as a 39%-fill layout defect for days on that number, and the number
   * itself wandered (568, 568, 444, 568, 568 across five identical runs)
   * because it depended on which card heading happened to be widest.
   *
   * Widening the generic selector was tried and REJECTED: adding grid/flex
   * containers made the check insensitive — with the feed grid forced to
   * `max-w-sm` it still passed, because some other full-bleed grid was matched
   * instead. A check that cannot fail is worse than one that measures the wrong
   * element, so the route names its own container rather than the scan guessing
   * wider.
   */
  contentSelector?: string;
}

const ROUTES: Route[] = [
  // Public marketing
  { path: "/", auth: "anon" },
  // REMOVED 2026-09-21: /subscription. It is not a registered route — it
  // rendered the NotFound page, whose centred card fills 25% of 1440px, so
  // this row had been failing the desktop-fill standard on behalf of the 404
  // screen. Nobody saw it because nothing ran this spec (see the note below).
  { path: "/help", auth: "anon" },
  { path: "/legal", auth: "anon" },
  { path: "/browse", auth: "anon", contentSelector: "div[class*='md:grid-cols-2']" },
  // /data-rights is not listed: since 2026-08-18 it is a redirect into
  // /profile?tab=legal, so as an anon route it only ever measured the login
  // page. /profile in the authed block below carries the same content
  // container (`.container mx-auto px-5 lg:px-6 xl:px-6`) that the tab
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
  { path: "/profile?tab=pets", auth: "authed" },
  // REMOVED 2026-09-21: /family. Behind FAMILY_ENABLED, which is off, so the
  // route is unregistered and this measured the 404 screen at 25% too. The
  // same removal auditRoutes.ts made on 2026-08-23 and overlay-sweep's own
  // list needed on 2026-09-21 — a fourth copy of one catalog, rotting apart.
  // Restore with the flag.
  { path: "/profile?tab=analytics", auth: "authed" },
  { path: "/profile?tab=home_history", auth: "authed" },
  { path: "/profile?tab=work_record", auth: "authed" },
  { path: "/profile?tab=str_settings", auth: "authed" },
  { path: "/profile?tab=wrapped", auth: "authed" },

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

      const measurement = await page.evaluate((contentSelector) => {
        const vw = window.innerWidth;
        const main = document.querySelector("main, #main-content") || document.body;
        const nodes = contentSelector
          ? Array.from(main.querySelectorAll(contentSelector))
          : Array.from(
              main.querySelectorAll("h1, h2, .container, [class*='max-w-'], article, section"),
            );
        let maxWidth = 0;
        for (const n of nodes) {
          const rect = n.getBoundingClientRect();
          if (rect.width > maxWidth && rect.width <= vw) maxWidth = rect.width;
        }
        return {
          vw,
          contentW: Math.round(maxWidth),
          pct: Math.round((maxWidth / vw) * 100),
          found: nodes.length,
        };
      }, route.contentSelector ?? null);

      // A declared selector that matches nothing would measure 0 and fail with a
      // misleading reason, or (if it ever defaulted) pass on the wrong element.
      if (route.contentSelector) {
        expect(
          measurement.found,
          `${route.path} declares contentSelector ${route.contentSelector} and it matched NOTHING — ` +
            `the selector is stale, not the layout`,
        ).toBeGreaterThan(0);
      }

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

// The defect class this spec exists for: a content column stranded narrow in a
// wide viewport. Capping the guest feed grid drops /browse to 27% (384px of
// 1440). Registered against the MEASURED container deliberately — before the
// contentSelector above, this spec was reading a heading inside a card and
// reporting 39% whatever the layout did.
// @mutate src/components/GuestBrowseSkeleton.tsx | md:grid-cols-2 md:gap-4"; | md:grid-cols-2 md:gap-4 max-w-sm";
