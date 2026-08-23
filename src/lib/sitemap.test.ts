// public/sitemap.xml is hand-maintained, so it silently drifts when a route is
// removed or turned into a redirect (the /how-it-works and /community pages
// were both retired — a stale sitemap entry would keep pointing crawlers at a
// redirect). These tests pin the invariants that matter for SEO health:
//   1. every <loc> is an absolute https URL and unique,
//   2. no path that App.tsx now serves as a <Navigate> redirect is listed
//      (the redirect set is DERIVED from the route table, not hardcoded, so
//      this guard tracks the source of truth automatically), and
//   3. the core public content pages are present.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const sitemap = readFileSync(resolve(ROOT, "public/sitemap.xml"), "utf8");
const appTsx = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8");

const ORIGIN = "https://www.louisianahelpr.com";

/** Every <loc> value in the sitemap, as an absolute URL string. */
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);

/** The pathname portion of each <loc> ("/" stays "/"). */
const sitemapPaths = locs.map((loc) => new URL(loc).pathname);

/** Redirect-only paths: `<Route path="X" element={<Navigate ... />}`. */
const redirectPaths = [
  ...appTsx.matchAll(/path="([^"]+)"\s+element=\{<Navigate\b/g),
].map((m) => m[1]);

describe("sitemap.xml", () => {
  it("lists at least the core public pages", () => {
    expect(locs.length).toBeGreaterThan(0);
    // `/for-business` was removed from this list on 2026-08-23 together with
    // its <url> entry. The route itself is gated on `BUSINESS_ENABLED` in
    // App.tsx (false since 2026-08-20), so the page 404s — advertising it to
    // crawlers pointed them at a dead URL and kept a "Business" result in
    // search for a product with no page. Re-add both when the flag flips back.
    for (const path of ["/", "/jobs", "/help", "/legal"]) {
      expect(sitemapPaths).toContain(path);
    }
  });

  it("uses absolute https URLs on the canonical origin", () => {
    for (const loc of locs) {
      expect(loc.startsWith(`${ORIGIN}/`)).toBe(true);
    }
  });

  it("has no duplicate URLs", () => {
    expect(new Set(locs).size).toBe(locs.length);
  });

  it("never points crawlers at a route App.tsx redirects away", () => {
    const leaked = sitemapPaths.filter((p) => redirectPaths.includes(p));
    expect(leaked).toEqual([]);
  });
});
