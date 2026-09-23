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
