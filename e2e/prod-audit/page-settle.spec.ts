/**
 * EVERY PAGE ARRIVES IN ONE SETTLED PAINT (Q169, owner 2026-09-23).
 *
 * "The public browse-jobs page loads, jumps, more cards appear, it loads
 * again, and more jobs load; they don't all load together ... that jumping
 * happens a lot on new pages." Wanted: a correctly sized placeholder, then all
 * of the content at once, nothing shifting.
 *
 * For every non-redirect route in src/App.tsx (deriveRouteSet, the same
 * inventory the press sweep walks — never a hand list), at 375 and 1440, on
 * this commit's preview build against prod data (public routes as a guest,
 * protected ones as the shared poster account), a cold load must:
 *   - accumulate CLS below CLS_BUDGET, and
 *   - bring its repeated content (cards, rows, list items) in ONE wave.
 * The measurement is scripts/audit/measure-page-settle.mjs's own settlePage(),
 * so this budget and the audit table are one number.
 *
 * KNOWN is the exact set still over budget when this landed, each with its
 * measured number: the check fails on a new breach AND on a KNOWN entry that
 * has come within budget (delete it — a stale allowance hides the next
 * regression).
 *
 * Proven red: before the Q169 fixes, /post-job at 375 measured CLS 0.3188 and
 * /browse at 375 0.0416, both outside KNOWN.
 */
// @mutate src/pages/postjob/EntryChoice.tsx |   if (!entryReady) return <EntryChoiceSkeleton />; |
import { test, expect } from "@playwright/test";
import { newUserContext, sessionFor, POSTER_ID, HELPER_ID, SUPABASE_URL, ANON } from "./harness";
// @ts-expect-error -- plain Node ESM with no .d.mts (same as src/test/pressEveryControlRoutes.test.ts)
import { deriveRouteSet } from "../../scripts/audit/press-every-control.mjs";
import { SETTLE_INIT, settlePage } from "../../scripts/audit/measure-page-settle.mjs";
import { PLACEHOLDER_SEL } from "../../scripts/audit/measure-loading-states.mjs";

export const CLS_BUDGET = 0.02;
const WIDTHS = [375, 1440] as const;

/** `${width} ${url}` → what it measured when this landed. Exact, two-way. */
// @two-way e2e/prod-audit/page-settle.spec.ts:KNOWN entries now within budget: delete them
const KNOWN: Record<string, string> = {
};

interface RouteRow { url: string; personas: string[]; redirect: boolean }

for (const width of WIDTHS) {
  test(`every route settles in one paint at ${width}px (CLS < ${CLS_BUDGET}, one content wave)`, async ({ browser, request }) => {
    test.setTimeout(25 * 60_000);
    const routes = (deriveRouteSet({ seedJobId: "test", helperId: HELPER_ID, customerId: POSTER_ID, adminViews: [] }) as RouteRow[])
      .filter((r) => !r.redirect && !r.personas.every((p) => p === "admin"))
      // /jobs/:id needs a real job and redirects every signed-in viewer; it is
      // covered through /my-posts and /dashboard, where it lands.
      .filter((r) => !r.url.startsWith("/jobs/"));
    // Floor: the inventory is read from App.tsx and Profile's Tab union. Far
    // fewer than this means the parser broke, not that the app shrank.
    expect(routes.length).toBeGreaterThan(40);

    const session = await sessionFor(request, "poster");
    const prof = await request.get(`${SUPABASE_URL}/rest/v1/profiles?select=senior_mode&user_id=eq.${POSTER_ID}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${session.access_token}` },
    });
    expect(prof.ok(), "read the poster's own profile").toBe(true);
    const seniorMode = !!(await prof.json())[0]?.senior_mode;
    const breaches: Record<string, string> = {};
    for (const r of routes) {
      const signedIn = r.personas.includes("customer") && r.personas.includes("helper");
      const ctx = await newUserContext(browser, signedIn ? session : null, { desktop: width === 1440 });
      await ctx.addInitScript(SETTLE_INIT, PLACEHOLDER_SEL);
      // A RETURNING device: the account's Senior Mode flag is cached after
      // any visit (src/lib/simpleMode.ts), so the first paint is already the
      // right text size. Seeded from the live profile, not assumed. A device's
      // very FIRST visit still grows once when the profile lands; that case
      // is Q200 (docs/OPEN.md), not measured here.
      if (signedIn) {
        await ctx.addInitScript((on: boolean) => {
          try { localStorage.setItem("helpr_profile_senior_mode", on ? "1" : "0"); } catch { /* storage blocked */ }
        }, seniorMode);
      }
      const page = await ctx.newPage();
      await page.setViewportSize({ width, height: width < 800 ? 812 : 900 });
      const m = await settlePage(page, new URL(r.url, test.info().project.use.baseURL).toString(), { quietMs: 2500, maxMs: 15000 });
      await ctx.close();
      expect(m.error, `${r.url} failed to load: ${m.error}`).toBeUndefined();
      if ((m.cls ?? 0) >= CLS_BUDGET || m.waves > 1) {
        breaches[`${width} ${r.url}`] = `cls=${m.cls} waves=${m.waves}`;
      }
    }
    const known = Object.fromEntries(Object.entries(KNOWN).filter(([k]) => k.startsWith(`${width} `)));
    const added = Object.keys(breaches).filter((k) => !(k in known));
    const cleared = Object.keys(known).filter((k) => !(k in breaches));
    expect(added.map((k) => `${k}: ${breaches[k]}`), "new pages that jump or arrive in waves").toEqual([]);
    expect(cleared, "KNOWN entries now within budget: delete them").toEqual([]);
  });
}
