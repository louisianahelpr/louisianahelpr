/**
 * Q260: returning visitors saw a 404 on /browse or /login that "refreshed in".
 * The service worker once answered every navigation from a precached
 * index.html (vite-plugin-pwa's default navigateFallback), which registers a
 * NavigationRoute ahead of runtimeCaching, so a returning visit booted a stale
 * shell whose chunk hashes no longer existed. navigateFallback: "" (2026-08-10)
 * sends navigations to the NetworkFirst rule instead. Live 2026-09-23: 8
 * SW-served navigations to /browse and /login, Chromium + WebKit, all 200 with
 * no NotFound (review log, ~/.lh-shots/q260-*.png).
 *
 * @mutate vite.config.ts |         navigateFallback: "", |         navigateFallback: "index.html",
 * @mutate vite.config.ts |             urlPattern: ({ request }) => request.mode === "navigate",\n            handler: "NetworkFirst", |             urlPattern: ({ request }) => request.mode === "navigate",\n            handler: "CacheFirst",
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const cfg = blankComments(readFileSync(resolve(__dirname, "../../vite.config.ts"), "utf8"));

describe("service worker never answers a navigation from a stale shell (Q260)", () => {
  it("navigateFallback is disabled, so no NavigationRoute precedes runtimeCaching", () => {
    const m = [...cfg.matchAll(/navigateFallback\s*:\s*("[^"]*"|'[^']*'|[^,\n]+)/g)].map((x) => x[1].trim());
    expect(m).toEqual(['""']);
  });

  it("navigations are NetworkFirst, so a deploy lands on the next visit", () => {
    const rule = cfg.match(/urlPattern:\s*\(\{\s*request\s*\}\)\s*=>\s*request\.mode\s*===\s*"navigate",\s*handler:\s*"(\w+)"/);
    expect(rule?.[1]).toBe("NetworkFirst");
  });
});
