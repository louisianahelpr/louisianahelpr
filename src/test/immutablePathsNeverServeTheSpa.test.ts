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
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
