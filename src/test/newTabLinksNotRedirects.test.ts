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
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

function redirectRoutes(app: string): string[] {
  const out: string[] = [];
  for (const m of app.matchAll(/<Route\s+path="([^"]+)"\s+element=\{\s*<(\w+)[^}]*\}\s*\/>/g)) {
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
    expect(redirects.length, "parsed no redirect routes — the parser is broken, not the app clean").toBeGreaterThan(0);
    const res = redirects.map(toRe);
    const hits: string[] = [];
    (function walk(d: string) {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.tsx?$/.test(n) && !/\.test\./.test(n)) {
          for (const h of newTabHrefs(readFileSync(p, "utf8"))) if (res.some((r) => r.test(h))) hits.push(`${p} → ${h}`);
        }
      }
    })("src");
    expect(hits).toEqual([]);
  });
});
