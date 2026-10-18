/**
 * Q1663 — a missing immutable file must 404, never come back as the SPA page.
 *
 * MEASURED 2026-10-12 on www (Vercel MCP fetch of an old chunk,
 * /assets/notificationFeed-B4je1ZJb.js): 200, content-type text/html,
 * content-disposition index.html, cache-control "public, max-age=31536000,
 * immutable". The catch-all rewrite `/((?!api/|_vercel/).*)` -> /index.html
 * also covered /assets/ and /fonts/, and the headers block stamps everything
 * under those paths immutable for a year. So a chunk a tab asks for in a
 * deploy's propagation window (Q199) is answered with HTML that the browser
 * and CDN may keep under that chunk's URL for a year, and Sentry symbolicates
 * old stacks against index.html (JAVASCRIPT-3F, -3G).
 *
 * The class, read from vercel.json itself: every header rule that marks a
 * path immutable names a prefix no rewrite to /index.html may match. A new
 * immutable path, or a widened catch-all, fails here.
 *
 * Q1737 (2026-10-17): the 404 itself must not carry the immutable header.
 * vercel.json's header rules stamp every response under /assets/ and /fonts/,
 * found or not (curl -sI on www, 2026-10-12 and 2026-10-17: 404 text/plain
 * with `public, max-age=31536000, immutable`). Each immutable prefix now has a
 * rewrite to api/missing-asset.ts, which only a path with no file reaches
 * (filesystem first), and whose own `no-store` beats the header rule
 * (MEASURED on a Vercel preview 2026-10-17 with this exact headers/rewrites
 * block: real /assets/ and /fonts/ files 200 immutable, missing ones 404
 * no-store). prod-freshness.yml re-measures it live after every deploy
 * (scripts/check-missing-asset-headers.mjs).
 *
 * @mutate vercel.json | "source": "/((?!api/\|_vercel/\|assets/\|fonts/).*)" | "source": "/((?!api/\|_vercel/\|fonts/).*)"
 * @mutate vercel.json | "source": "/fonts/(.*)",\n      "destination": "/api/missing-asset" | "source": "/fonts-gone/(.*)",\n      "destination": "/api/missing-asset"
 * @mutate api/missing-asset.ts | export const MISSING_ASSET_CACHE_CONTROL = "no-store"; | export const MISSING_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
 * @mutate api/missing-asset.ts |     status: 404, |     status: 200,
 * @mutate scripts/check-missing-asset-headers.mjs |   if (/\bimmutable\b/.test(v)) return false; |   if (/\bimmutable\b/.test(v)) return true;
 * @mutate scripts/check-missing-asset-headers.mjs |   if (!real) bad.push( |   if (false) bad.push(
 * @mutate .github/workflows/prod-freshness.yml |         run: node scripts/check-missing-asset-headers.mjs |         run: echo skipped
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "yaml";
import { missingAssetResponse } from "../../api/missing-asset";
import { cacheControlKeepsNothing, judgeMissingAssetHeaders } from "../../scripts/check-missing-asset-headers.mjs";

type Header = { source: string; headers: { key: string; value: string }[] };
type Rewrite = { source: string; destination: string };

const cfg = JSON.parse(readFileSync(resolve(__dirname, "../../vercel.json"), "utf8")) as {
  headers?: Header[];
  rewrites?: Rewrite[];
};

const immutableSources = (cfg.headers ?? [])
  .filter((h) => h.headers.some((x) => x.key.toLowerCase() === "cache-control" && /\bimmutable\b/.test(x.value)))
  .map((h) => h.source);

const spaRewrites = (cfg.rewrites ?? []).filter((r) => r.destination === "/index.html");

/** A Vercel source in the regex-group form this file uses, as a RegExp. */
function sourceToRegExp(source: string): RegExp {
  if (/:[A-Za-z]/.test(source)) throw new Error(`named-parameter source not handled by this guard: ${source}`);
  return new RegExp(`^${source}$`);
}

describe("an immutable path never falls through to the SPA page (Q1663)", () => {
  it("finds the immutable paths and the SPA rewrite (a scan that finds none checks nothing)", () => {
    expect(immutableSources.length).toBeGreaterThanOrEqual(2);
    expect(spaRewrites.length).toBeGreaterThanOrEqual(1);
  });

  it("no rewrite to /index.html matches a missing file under an immutable path", () => {
    const leaks: string[] = [];
    for (const src of immutableSources) {
      const missing = src.replace("(.*)", "missing-Q1663-x.js");
      for (const r of spaRewrites) {
        if (sourceToRegExp(r.source).test(missing)) leaks.push(`${missing} -> ${r.destination} (via ${r.source})`);
      }
    }
    expect(leaks, "a missing immutable file would be served as index.html and cached for a year").toEqual([]);
  });

  it("ordinary app routes still reach the SPA", () => {
    const re = sourceToRegExp(spaRewrites[spaRewrites.length - 1].source);
    for (const route of ["/home", "/jobs", "/messages/abc", "/profile/settings"]) expect(re.test(route), route).toBe(true);
    for (const route of ["/api/share", "/_vercel/insights/script.js"]) expect(re.test(route), route).toBe(false);
  });
});

describe("a missing immutable file 404s with nothing cacheable (Q1737)", () => {
  const MISSING_FN = "/api/missing-asset";

  it("every immutable prefix rewrites its missing files to the no-store 404", () => {
    const unhandled: string[] = [];
    for (const src of immutableSources) {
      for (const path of [src.replace("(.*)", "missing-Q1737-x.js"), src.replace("(.*)", "a/b/missing-Q1737-x.css")]) {
        // The FIRST rewrite that matches wins; it must be the missing-asset function.
        const first = (cfg.rewrites ?? []).find((r) => !/:[A-Za-z]/.test(r.source) && sourceToRegExp(r.source).test(path));
        if (first?.destination !== MISSING_FN) unhandled.push(`${path} -> ${first?.destination ?? "(no rewrite: platform 404 with the immutable header)"}`);
      }
    }
    expect(immutableSources.length).toBeGreaterThanOrEqual(2);
    expect(unhandled, "a missing immutable file would 404 with the year-long immutable header").toEqual([]);
  });

  it("the function answers 404 with no-store", async () => {
    const r = missingAssetResponse();
    expect(r.status).toBe(404);
    expect(cacheControlKeepsNothing(r.headers.get("cache-control"))).toBe(true);
    expect(await r.text()).toMatch(/Not Found/);
  });

  it("the live check's verdict: red on the measured prod 404, green on the measured preview", () => {
    const real = { path: "/assets/index-SPawCA1U.js", status: 200, cacheControl: "public, max-age=31536000, immutable" };
    // prod www, 2026-10-17 (before the fix)
    const prod = [{ path: "/assets/missing-Q1737-1.js", status: 404, cacheControl: "public, max-age=31536000, immutable" }];
    expect(judgeMissingAssetHeaders({ real, missing: prod })).toHaveLength(1);
    // preview with this vercel.json, 2026-10-17
    const preview = [
      { path: "/assets/missing-Q1737-1.js", status: 404, cacheControl: "no-store" },
      { path: "/fonts/missing-x.woff2", status: 404, cacheControl: "no-store" },
    ];
    expect(judgeMissingAssetHeaders({ real, missing: preview })).toEqual([]);
    // Fail closed: nothing measured, a lost immutable on the real file, an SPA 200.
    expect(judgeMissingAssetHeaders({ real: null, missing: preview })).not.toEqual([]);
    expect(judgeMissingAssetHeaders({ real, missing: [] })).not.toEqual([]);
    expect(judgeMissingAssetHeaders({ real: { ...real, cacheControl: "public, max-age=0, must-revalidate" }, missing: preview })).not.toEqual([]);
    expect(judgeMissingAssetHeaders({ real, missing: [{ ...preview[0], status: 200 }] })).not.toEqual([]);
    for (const v of ["", "public, max-age=600", "s-maxage=31536000", "max-age=0, immutable"]) expect(cacheControlKeepsNothing(v), v).toBe(false);
    for (const v of ["no-store", "public, max-age=0, must-revalidate", "no-cache"]) expect(cacheControlKeepsNothing(v), v).toBe(true);
  });

  it("prod-freshness re-measures it live once prod serves the commit", () => {
    const wf = parse(readFileSync(resolve(__dirname, "../../.github/workflows/prod-freshness.yml"), "utf8")) as {
      jobs: Record<string, { steps?: Array<{ name?: string; run?: string }> }>;
    };
    const steps = wf.jobs["served-commit"]?.steps ?? [];
    const wait = steps.findIndex((s) => s.name === "Wait for prod to serve this commit");
    const check = steps.findIndex((s) => (s.run ?? "").trim() === "node scripts/check-missing-asset-headers.mjs");
    expect(wait, "the freshness wait step moved").toBeGreaterThanOrEqual(0);
    expect(check, "no live missing-asset check after the deploy").toBeGreaterThan(wait);
  });
});
