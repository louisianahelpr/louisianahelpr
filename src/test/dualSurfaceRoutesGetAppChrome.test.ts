/**
 * CLASS GUARD: every route that renders through PublicLayout for a signed-in
 * visitor gets the app's navigation — the desktop rail + top bar AND the phone
 * dock.
 *
 * Q179 (2026-09-23 visual walk, measured on prod with poster-e2e): signed in,
 * /terms, /privacy and /rules rendered the app shell with NO rail, NO top bar
 * and NO bottom dock at 1440 and 375 — the only way out was the browser's Back
 * button. /help, /legal and /support had been added to both allow-lists by
 * hand in 2026-08-30; the other three routes of the SAME Legal page became real
 * routes on 2026-09-11 (8570fdbef) and were never named. Two hand lists that
 * have to agree with the route table are two places to forget.
 *
 * So the inventory is DERIVED from src/App.tsx: every <Route> whose page
 * component renders <PublicLayout> / <PublicHeaderPage> (so it swaps to the
 * AppShell when signed in), minus the ones that never show a signed-in visitor
 * that page (MarketingRedirect wrappers, a page that <Navigate>s away, and the
 * `*` catch-all). Each must be allowed by `isDesktopRailRoute` and covered by
 * the dock's `authPages`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "@/test/helpers/blankNonCode";
import { isDesktopRailRoute } from "@/lib/desktopNavRoutes";
import { authPages } from "@/components/mobileNav/mobileNavHelpers";

// @mutate src/lib/desktopNavRoutes.ts | "/terms", "/privacy", "/rules", | "/terms",
// @mutate src/components/mobileNav/mobileNavHelpers.ts | "/terms", "/privacy", "/rules"  // The six | "/terms"  // The six

const ROOT = resolve(__dirname, "..", "..");
const read = (f: string) => readFileSync(resolve(ROOT, f), "utf8");

function dualSurfaceRoutes(): string[] {
  const app = blankComments(read("src/App.tsx"));
  const modules = new Map<string, string>();
  for (const m of app.matchAll(/const (\w+) = (?:lazyWithPreload|lazy)\(\(\) => import\("\.\/([^"]+)"\)\)/g)) {
    modules.set(m[1], m[2]);
  }
  const out: string[] = [];
  for (const m of app.matchAll(/<Route path="([^"]+)" element=\{(.*)\} \/>/g)) {
    const [, path, element] = m;
    if (path === "*" || /MarketingRedirect/.test(element)) continue;
    for (const tag of element.matchAll(/<([A-Z]\w*)/g)) {
      const mod = modules.get(tag[1]);
      if (!mod) continue;
      const file = ["tsx", "ts"].map((x) => `src/${mod}.${x}`).find((f) => existsSync(resolve(ROOT, f)));
      if (!file) continue;
      const src = blankComments(read(file));
      if (!/<(PublicLayout|PublicHeaderPage)\b/.test(src)) continue;
      if (/<Navigate\b/.test(src)) continue; // signed-in visitors are sent elsewhere
      out.push(path);
    }
  }
  return [...new Set(out)];
}

describe("signed-in PublicLayout routes carry the app navigation (Q179)", () => {
  const routes = dualSurfaceRoutes();

  it("derives the dual-surface routes from App.tsx", () => {
    expect(routes.length).toBeGreaterThan(5);
    expect(routes).toEqual(expect.arrayContaining(["/help", "/support", "/legal", "/terms", "/privacy", "/rules"]));
  });

  it("every one is a desktop-rail route", () => {
    expect(routes.filter((r) => !isDesktopRailRoute(r))).toEqual([]);
  });

  it("every one shows the phone dock", () => {
    expect(routes.filter((r) => !authPages.some((p) => r.startsWith(p)))).toEqual([]);
  });
});

// @mutate src/lib/desktopNavRoutes.ts | const AUTH_PREFIX_EXCLUSIONS: string[] = ["/jobs/"]; | const AUTH_PREFIX_EXCLUSIONS: string[] = [];
describe("the Jobs tab (/jobs) and the public job page (/jobs/<id>) are told apart", () => {
  it("the rail shows on the Jobs tab but not on a job page", () => {
    expect(isDesktopRailRoute("/jobs")).toBe(true);
    expect(isDesktopRailRoute("/jobs/3f0c9a4e-0000-4000-8000-000000000000")).toBe(false);
  });
});

/**
 * CLASS GUARD, second half: every signed-in-only route (<ProtectedRoute> in
 * App.tsx) carries the app navigation too. 2026-10-15 (quotes lane screenshot
 * pass at 1440 and 375): /quotes, /quotes/request/:id and /quotes/send/:id
 * rendered with no rail, no top bar and no dock, because both allow-lists are
 * hand lists and a new feature's routes were never named in either. Derived
 * from the route table so the next feature cannot miss them the same way.
 *
 * NOT_APP_CHROME is exact both ways: every entry is a protected route that
 * really lacks that half today (measured on this branch 2026-10-15), so an
 * entry that starts getting the chrome must be removed.
 */
// @mutate src/lib/desktopNavRoutes.ts |   "/quotes",\n |   \n
// @mutate src/components/mobileNav/mobileNavHelpers.ts |   "/quotes",\n |   \n
// @two-way src/test/dualSurfaceRoutesGetAppChrome.test.ts:NOT_APP_CHROME is exact: every entry still lacks the half it names
const NOT_APP_CHROME: Record<string, { rail?: string; dock?: string }> = {
  "/complete-profile": {
    rail: "pre-existing on origin/main 35b616cf8 (finish-signup flow); not decided by this guard",
    dock: "pre-existing on origin/main 35b616cf8 (finish-signup flow); not decided by this guard",
  },
  "/payment-success": {
    rail: "pre-existing on origin/main 35b616cf8 (checkout return screen); not decided by this guard",
    dock: "pre-existing on origin/main 35b616cf8 (checkout return screen); not decided by this guard",
  },
  "/admin": { dock: "the admin console's own top bar is phone-only (desktopNavRoutes.ts NO_NAV_PREFIXES note)" },
  "/jobs/:id": { rail: "the public job page shares /jobs/ and is excluded on purpose (AUTH_PREFIX_EXCLUSIONS)" },
};

function protectedRoutes(): string[] {
  const app = blankComments(read("src/App.tsx"));
  const out: string[] = [];
  for (const m of app.matchAll(/<Route path="([^"]+)" element=\{(.*)\} \/>/g)) {
    if (/<ProtectedRoute\b/.test(m[2])) out.push(m[1]);
  }
  return [...new Set(out)];
}
const sample = (route: string) => route.replace(/:[A-Za-z]+/g, "3f0c9a4e-0000-4000-8000-000000000000");
const hasRail = (route: string) => isDesktopRailRoute(sample(route));
const hasDock = (route: string) => authPages.some((p) => sample(route).startsWith(p));

describe("signed-in-only routes carry the app navigation (quotes, 2026-10-15)", () => {
  const routes = protectedRoutes();

  it("derives the protected routes from App.tsx", () => {
    expect(routes.length).toBeGreaterThan(10);
    expect(routes).toEqual(expect.arrayContaining(["/quotes", "/quotes/request/:id", "/quotes/send/:id"]));
  });

  it("every one is a desktop-rail route, apart from the exact exceptions", () => {
    expect(routes.filter((r) => !hasRail(r) && !NOT_APP_CHROME[r]?.rail)).toEqual([]);
  });

  it("every one shows the phone dock, apart from the exact exceptions", () => {
    expect(routes.filter((r) => !hasDock(r) && !NOT_APP_CHROME[r]?.dock)).toEqual([]);
  });

  it("each exception is still a protected route that still lacks what it names (two-way)", () => {
    for (const [route, why] of Object.entries(NOT_APP_CHROME)) {
      expect(routes, route).toContain(route);
      if (why.rail) expect(hasRail(route), `${route} now has the rail: drop its rail exception`).toBe(false);
      if (why.dock) expect(hasDock(route), `${route} now has the dock: drop its dock exception`).toBe(false);
    }
  });
});
