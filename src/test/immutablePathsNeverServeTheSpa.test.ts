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
 * @mutate vercel.json | "source": "/((?!api/\|_vercel/\|assets/\|fonts/).*)" | "source": "/((?!api/\|_vercel/\|fonts/).*)"
 *
 * Q1737: and a missing file there is not cached at all. The header rule stamps
 * every response under those paths `immutable` for a year, found or not
 * (measured on www 2026-10-12: a missing chunk's 404 carried it), so a chunk
 * asked for in a deploy's propagation window could stay a cached 404. Every
 * immutable path rewrites a missing file to api/missing-file.ts (Vercel serves
 * a real file before any rewrite), which answers 404 `no-store`.
 * @mutate vercel.json |       "destination": "/api/missing-file" |       "destination": "/index.html"
 * @mutate vercel.json |       "source": "/(assets\|fonts)/(.*)", |       "source": "/(assets)/(.*)",
 * @mutate api/missing-file.ts |         "cache-control": "no-store", |         "cache-control": "public, max-age=31536000, immutable",
 * @mutate api/missing-file.ts |       status: 404, |       status: 200,
 * The live probe (scripts/probes/missing-asset-not-cached.mjs, hourly in prod-freshness.yml) grades what the
 * CDN sends; its grader must fail prod's measured answer:
 * @mutate scripts/probes/missing-asset-not-cached.mjs |   if (/\bimmutable\b/.test(cc)) problems.push("Cache-Control still says immutable");\n |
 * @mutate scripts/probes/missing-asset-not-cached.mjs |   if (!/\bno-store\b/.test(cc)) | if (false)
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import missingFile from "../../api/missing-file";
import { gradeMissingAsset } from "../../scripts/probes/missing-asset-not-cached.mjs";

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

describe("a missing immutable file is a 404 nobody caches (Q1737)", () => {
  const missingRewrites = (cfg.rewrites ?? []).filter((r) => r.destination === "/api/missing-file");

  it("every immutable path rewrites a missing file to api/missing-file, before the SPA catch-all", () => {
    expect(missingRewrites.length).toBeGreaterThanOrEqual(1);
    const rewrites = cfg.rewrites ?? [];
    const spaIndex = rewrites.findIndex((r) => r.destination === "/index.html");
    for (const src of immutableSources) {
      const missing = src.replace("(.*)", "missing-Q1737-x.js");
      const hit = rewrites.findIndex((r) => !/:[A-Za-z]/.test(r.source) && sourceToRegExp(r.source).test(missing));
      expect(hit, `${missing} reaches no rewrite`).toBeGreaterThanOrEqual(0);
      expect(rewrites[hit].destination, `${missing} must reach api/missing-file`).toBe("/api/missing-file");
      expect(hit, "before the SPA catch-all").toBeLessThan(spaIndex);
    }
  });

  it("api/missing-file answers 404 with no-store", async () => {
    const res = missingFile.fetch();
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("cache-control")).not.toMatch(/immutable|max-age=[1-9]/);
  });
});

describe("the live probe grades what the CDN sends (Q1737)", () => {
  it("fails prod's answer as measured 2026-10-15 (404 stamped immutable for a year)", () => {
    const problems = gradeMissingAsset({ status: 404, cacheControl: "public, max-age=31536000, immutable", body: "Not found" });
    expect(problems.join(" | ")).toMatch(/no-store/);
    expect(problems.join(" | ")).toMatch(/immutable/);
    expect(gradeMissingAsset({ status: 404, cacheControl: "no-store, immutable", body: "" }), "immutable is never allowed").not.toEqual([]);
  });
  it("fails the SPA page served in the file's place", () => {
    expect(gradeMissingAsset({ status: 200, cacheControl: "no-store", body: "<!DOCTYPE html><html></html>" })).toHaveLength(2);
  });
  it("passes api/missing-file's own answer", async () => {
    const res = missingFile.fetch();
    expect(gradeMissingAsset({ status: res.status, cacheControl: res.headers.get("cache-control"), body: await res.text() })).toEqual([]);
  });
});
