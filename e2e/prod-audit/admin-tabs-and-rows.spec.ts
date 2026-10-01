/**
 * Admin People: the selected tab pill sits INSIDE its track with an even inset,
 * and the "Find a User" rows are not spaced apart by dead air.
 *
 * Owner, 2026-10-01, phone: on the admin User Profile dialog (Actions /
 * Overview / Jobs / Reviews / Docs / Emails) and the Users list tabs (All /
 * Active / Email / Banned) "the selected tab's pill does not fit its box", and
 * the user rows (App R., Audit W., Eli T.) had "too much vertical spacing".
 *
 * Measured, not read: as the shared admin account against prod, read-only (a
 * read firewall refuses every write), at 375 and 1440, light and dark:
 *   - the selected pill's rect against its track's rect: top/bottom/left
 *     insets must be >= 0 and top == bottom within 1px;
 *   - the vertical gap between consecutive user rows.
 * A screenshot of each state is kept.
 */
// Shown able to fail: a fixed 40px track lets the 44px active Radix trigger hang out of it.
// @mutate src/components/ui/tabs.tsx | "inline-flex h-auto min-h-10 | "inline-flex h-10
// Shown able to fail: a short label makes the selected segment narrower than it is tall.
// @mutate src/components/ui/SegmentedControl.tsx | <span className="min-w-[1.25rem] text-center">{option.label}</span> | <span>{option.label}</span>
// Shown able to fail: margins between virtual rows are not measured (gaps 8, 0, 0).
// @mutate src/components/admin/AdminUsers.tsx | itemClassName="pb-1" | className="space-y-2"
import { test, expect, webkit, type Browser, type Page } from "../prodTest";
import { newUserContext, sessionFor, SUPABASE_URL, type Session } from "./harness";
import { isConsentAcceptance } from "./harness";
import { isStorageSignPath } from "../readRpc";

/** The gap between two consecutive user rows, in px: `itemClassName="pb-1"`
 *  on AdminUsers' VirtualList. Every gap must be this, within 1px. */
export const ROW_GAP_PX = 4;

const READ_RPC = /\/rest\/v1\/rpc\/(get_|admin_get|admin_list|is_|has_|list_|count_|search_|check_)/;

let admin: Session;
test.beforeAll(async ({ request }) => {
  admin = await sessionFor(request, "admin");
});

type Inset = { top: number; bottom: number; left: number; right: number; pillW: number; pillH: number; track: string; pill: string };

async function pillInset(page: Page, trackSel: string, pillSel: string): Promise<Inset> {
  return page.evaluate(
    ([t, p]) => {
      const track = document.querySelector(t) as HTMLElement | null;
      const pill = track?.querySelector(p) as HTMLElement | null;
      if (!track || !pill) return { top: NaN, bottom: NaN, left: NaN, right: NaN, pillW: NaN, pillH: NaN, track: "missing", pill: "missing" };
      const a = track.getBoundingClientRect();
      const b = pill.getBoundingClientRect();
      const cs = getComputedStyle(track);
      // Insets are measured from the track's PADDING box edge (inside its border).
      const bt = parseFloat(cs.borderTopWidth) || 0;
      const bb = parseFloat(cs.borderBottomWidth) || 0;
      // Horizontal: a scroll strip may start scrolled; measure against the
      // first/last segment only when the pill is the first/last one.
      const first = track.querySelector(p.replace(/\[[^\]]*\]$/, "")) as HTMLElement | null;
      return {
        top: +(b.top - a.top - bt).toFixed(2),
        bottom: +(a.bottom - bb - b.bottom).toFixed(2),
        left: first === pill ? +(b.left - a.left).toFixed(2) : NaN,
        right: NaN,
        pillW: +b.width.toFixed(2),
        pillH: +b.height.toFixed(2),
        track: `${a.width.toFixed(1)}x${a.height.toFixed(1)}`,
        pill: `${b.width.toFixed(1)}x${b.height.toFixed(1)}`,
      };
    },
    [trackSel, pillSel] as const,
  );
}

// The phone is WebKit (the iOS app is a WKWebView), so 375 runs in both engines.
const RUNS = [
  { width: 375, engine: "chromium" },
  { width: 375, engine: "webkit" },
  { width: 1440, engine: "chromium" },
] as const;

for (const { width, engine } of RUNS) {
  for (const theme of ["light", "dark"] as const) {
    test(`admin people: pills sit inside their tracks, rows are tight (${width}, ${engine}, ${theme})`, async ({ browser: defaultBrowser }, info) => {
      test.setTimeout(3 * 60_000);
      const browser: Browser = engine === "chromium" ? defaultBrowser : await webkit.launch();
      try {
      const ctx = await newUserContext(browser, admin, { desktop: width === 1440 });
      await ctx.addInitScript((t) => {
        try {
          localStorage.setItem("theme", t);
          localStorage.setItem("helpr_onboarding", JSON.stringify({ completed: true, currentStep: 0, completedSteps: [] }));
        } catch {
          /* the landing assertion below fails visibly */
        }
      }, theme);
      await ctx.route(`${SUPABASE_URL}/**`, async (route) => {
        const req = route.request();
        const m = req.method();
        if (m === "GET" || m === "HEAD" || m === "OPTIONS" || READ_RPC.test(req.url()) || /\/auth\/v1\/(token|user)/.test(req.url())) return route.continue();
        // Signing mints a read link (the shared rule); list is a read too.
        const path = new URL(req.url()).pathname;
        if (isStorageSignPath(path) || /^\/storage\/v1\/object\/list\//.test(path)) return route.continue();
        if (isConsentAcceptance(m, new URL(req.url()).pathname, req.postData())) return route.continue();
        await route.abort("blockedbyclient").catch(() => {});
      });
      const page = await ctx.newPage();
      await page.emulateMedia({ colorScheme: theme });
      await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
      await page.goto("/admin?view=people");
      expect(new URL(page.url()).pathname, "the admin account was bounced off /admin").toBe("/admin");

      // ---- Users list tab strip (SegmentedControl, role=tab) ----
      const strip = '[role="tablist"][aria-label="Filter users by status"]';
      await expect(page.locator(strip)).toBeVisible({ timeout: 45_000 });
      const rows = page.locator('[aria-busy="false"] [role="button"].liquid-glass');
      await expect(rows.nth(2)).toBeVisible({ timeout: 45_000 });
      await page.waitForTimeout(800);
      const listInset = await pillInset(page, strip, '[role="tab"][aria-selected="true"]');

      const gaps = await rows.evaluateAll((els) =>
        els
          .map((e) => e.getBoundingClientRect())
          .sort((a, b) => a.top - b.top)
          .slice(0, 6)
          .map((r, i, all) => (i === 0 ? NaN : +(r.top - all[i - 1].bottom).toFixed(2)))
          .slice(1),
      );
      await page.screenshot({ path: info.outputPath(`admin-users-${width}-${engine}-${theme}.png`) });

      // ---- User Profile dialog tab strip (Radix Tabs) ----
      await rows.first().click();
      const dlgStrip = '[role="dialog"] [role="tablist"]';
      await expect(page.locator(dlgStrip)).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(600);
      const dlgInset = await pillInset(page, dlgStrip, '[role="tab"][data-state="active"]');
      await page.screenshot({ path: info.outputPath(`admin-user-dialog-${width}-${engine}-${theme}.png`) });

      const measure =
        `${width} ${engine} ${theme}: users-tabs inset t=${listInset.top} b=${listInset.bottom} l=${listInset.left} (track ${listInset.track}, pill ${listInset.pill}); ` +
        `dialog-tabs inset t=${dlgInset.top} b=${dlgInset.bottom} l=${dlgInset.left} (track ${dlgInset.track}, pill ${dlgInset.pill}); ` +
        `row gaps ${gaps.join(",")}`;
      info.annotations.push({ type: "measure", description: measure });
      console.log(`[admin-tabs-and-rows] ${measure}`);

      for (const [name, s] of [["Users list tabs", listInset], ["User Profile tabs", dlgInset]] as const) {
        expect(Number.isFinite(s.top), `${name}: track or selected pill not found`).toBe(true);
        expect(s.top, `${name}: the selected pill pokes out of the TOP of its track (${measure})`).toBeGreaterThanOrEqual(0);
        expect(s.bottom, `${name}: the selected pill pokes out of the BOTTOM of its track (${measure})`).toBeGreaterThanOrEqual(0);
        expect(Math.abs(s.top - s.bottom), `${name}: uneven top/bottom inset (${measure})`).toBeLessThanOrEqual(1);
        if (Number.isFinite(s.left)) expect(Math.abs(s.left - s.top), `${name}: side inset differs from top inset (${measure})`).toBeLessThanOrEqual(1.5);
      }
      // A round-ended pill narrower than it is tall is an upright oval that does
      // not sit concentric in its round-ended track ("All" measured 38.6 x 44).
      expect(listInset.pillW, `Users list tabs: the selected pill is narrower than it is tall (${measure})`).toBeGreaterThanOrEqual(listInset.pillH - 0.5);
      expect(gaps.length, "fewer than two user rows rendered: no gap was measured").toBeGreaterThan(0);
      for (const g of gaps) expect(Math.abs(g - ROW_GAP_PX), `a user-row gap of ${g}px, not ${ROW_GAP_PX}px (${measure})`).toBeLessThanOrEqual(1);
      await ctx.close();
      } finally {
        if (engine !== "chromium") await browser.close();
      }
    });
  }
}
