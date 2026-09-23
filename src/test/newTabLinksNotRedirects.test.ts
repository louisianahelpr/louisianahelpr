/**
 * Working-forwards change 1 (owner, 2026-09-12): a link that opens in a NEW TAB
 * must not point at a route that only redirects.
 *
 * A new tab cold-boots the whole app. The consent checkboxes on /complete-profile
 * opened /terms, /rules and /privacy in new tabs while those routes were
 * <Navigate> hops, so each tab loaded a redirect chain instead of the page; the
 * owner hit a broken screen there. 8570fdbef made them real routes. This keeps
 * any new-tab link from pointing at a redirect again. Redirect routes are read
 * from App.tsx, not listed here, so a new redirect is covered the day it lands.
 *
 * Proven able to fail 2026-09-21 by re-committing the original bug: turning
 * /rules back into a <Navigate> while the signup and complete-profile consent
 * checkboxes still open it with target="_blank" (1 failed, naming both files).
 * Reverted. A CONSTRUCT floor was added at the same time — the `hits` assertion
 * is "empty list", so it passed vacuously if `newTabHrefs` ever stopped
 * matching, which is the unfloored-inventory shape.
 *
 * @mutate src/App.tsx | <Route path="/rules" element={<RouteErrorBoundary>{routeEl(<PageTransition><Legal /></PageTransition>)}</RouteErrorBoundary>} /> | <Route path="/rules" element={<Navigate to="/legal?tab=rules" replace />} />
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function redirectRoutes(app: string): string[] {
  const out: string[] = [];
  // `routeEl(<XRedirect …>)` too, the shape the last redirect route
  // (/data-rights, deleted with Q194) was wrapped in.
  for (const m of app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{\s*(?:routeEl\(\s*)?<(\w+)[^}]*\}\s*\/>/g)) {
    if (m[2] === "Navigate" || /Redirect$/.test(m[2])) out.push(m[1]);
  }
  return out;
}

function newTabHrefs(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/<a\b[^>]*>/gs)) {
    const tag = m[0];
    if (!/target=["{]\s*["']?_blank/.test(tag)) continue;
    const href = /href=["']([^"']+)["']|href=\{["'`]([^"'`$]+)["'`]\}/.exec(tag);
    const h = href?.[1] ?? href?.[2];
    if (h && h.startsWith("/")) out.push(h.split(/[?#]/)[0]);
  }
  for (const m of src.matchAll(/window\.open\(\s*["'`](\/[^"'`?#$]*)/g)) out.push(m[1]);
  return out;
}

const toRe = (p: string) => new RegExp("^" + p.replace(/:[^/]+/g, "[^/]+").replace(/\*$/, ".*") + "$");

describe("new-tab links never target a redirect route", () => {
  it("detects the original /terms case", () => {
    const app = `<Route path="/terms" element={<Navigate to="/legal?tab=terms" replace />} />`;
    const page = `<a href="/terms" target="_blank" rel="noreferrer">Terms</a>`;
    const redirects = redirectRoutes(app).map(toRe);
    expect(newTabHrefs(page).filter((h) => redirects.some((r) => r.test(h)))).toEqual(["/terms"]);
  });

  it("no file in src/ opens a redirect route in a new tab", () => {
    const redirects = redirectRoutes(readFileSync("src/App.tsx", "utf8"));
    // App.tsx has NO redirect routes since Q194 (noLegacyRedirectRoutes.test.ts
    // forbids them), so an empty list is the true state, not a broken parser;
    // the parser is proven on the synthetic /terms case above and by the
    // @mutate, which puts a <Navigate> back on /rules.
    const res = redirects.map(toRe);
    const hits: string[] = [];
    const seen: string[] = [];
    (function walk(d: string) {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) {
          for (const h of newTabHrefs(readFileSync(p, "utf8"))) {
            seen.push(`${p} → ${h}`);
            if (res.some((r) => r.test(h))) hits.push(`${p} → ${h}`);
          }
        }
      }
    })("src");
    // CONSTRUCT FLOOR, not just a file-count one. The assertion below is
    // "empty list", so it passes vacuously the moment `newTabHrefs` stops
    // matching — a `<Link … target="_blank">` refactor, an href built by a
    // helper, a `window.open` moved behind a wrapper. The eight in-app new-tab
    // links live on the consent checkboxes (SignupStep1, CompleteProfile) and
    // TermsReconsentDialog — precisely the screens the original /terms bug hit.
    // If this floor goes red, the parser rotted; fix the parser, do not lower
    // the number. Raise it deliberately when links are added.
    expect(
      seen.length,
      "newTabHrefs() found (almost) no in-app new-tab link in all of src/ — the parser rotted, " +
        `so the assertion below is passing over an empty list. Found: ${seen.join(", ") || "nothing"}`,
    ).toBeGreaterThanOrEqual(6);
    expect(hits).toEqual([]);
  });
});
