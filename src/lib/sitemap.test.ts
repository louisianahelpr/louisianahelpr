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
import { spawnSync } from "node:child_process";
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
    for (const path of ["/", "/browse", "/help", "/legal"]) {
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

  // The redirect guard above only catches paths that became a <Navigate>. It
  // does NOT catch a path that was deleted outright, which is how
  // /subscription sat in the sitemap while rendering the 404 page (verified in
  // a real browser: document.title "Page Not Found — Helpr", h1 "404"). The
  // real screen is /profile?tab=subscription. Assert every listed path is an
  // actually-registered route.
  it("only lists paths that App.tsx still registers as routes", () => {
    const registeredPaths = [...appTsx.matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
    const missing = sitemapPaths.filter(
      // "/" is registered as path="/"; every other entry must match exactly.
      (p) => !registeredPaths.includes(p),
    );
    expect(missing).toEqual([]);
  });

  // The two guards above grade the COMMITTED file. Nothing graded the
  // GENERATOR, so the two could disagree — and on 2026-09-09 they did, in
  // opposite directions: this suite asserted /browse must be listed while
  // scripts/generate-sitemap.mjs had started classifying it redirect-only,
  // so `Sitemap drift` went red on main and told the reader to regenerate,
  // which would have deleted a live 200 page from the sitemap and left this
  // suite red instead. Run the generator's own check so the file and the
  // thing that produces it can never drift apart again.
  it("agrees with scripts/generate-sitemap.mjs", () => {
    const run = spawnSync(process.execPath, [resolve(ROOT, "scripts/generate-sitemap.mjs"), "--check"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(`${run.stdout}${run.stderr}`.trim()).toContain("up to date");
    expect(run.status).toBe(0);
  });
});
