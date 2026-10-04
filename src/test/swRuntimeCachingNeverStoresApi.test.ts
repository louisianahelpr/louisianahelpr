/**
 * Q1174: signed-in responses must never reach Cache Storage.
 *
 * vite.config.ts used to route every `https://*.supabase.co/*` GET through
 * Workbox NetworkFirst into `api-cache` (50 entries, 300 s, as of 2026-10-03): the signed-in
 * user's rows (profile, applications, messages) were written to disk on every
 * load and survived sign-out. That rule is gone; this pins the whole
 * `workbox.runtimeCaching` list so it cannot come back, or be replaced by a
 * cross-origin rule that does the same thing.
 *
 * Two layers, both read from vite.config.ts with comments blanked:
 *  1. INVARIANTS that need no list: no rule's urlPattern names a host, a
 *     scheme, supabase or an API path; every rule that stores anything is
 *     navigation (the HTML shell, identical for everyone) or `sameOrigin`
 *     (hashed build assets and static images).
 *  2. The EXACT rule list (two-way): a new or changed rule fails here and has
 *     to be reviewed for what it stores.
 * The sign-out half (the legacy `api-cache` is deleted) is tested by behaviour
 * in src/lib/authSignOut.test.ts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";

const cfg = blankComments(readFileSync(resolve(__dirname, "../../vite.config.ts"), "utf8"));

/** The balanced `[...]` that follows `runtimeCaching:`, and its top-level `{...}` rules. */
function rules(): string[] {
  const at = cfg.indexOf("runtimeCaching:");
  if (at < 0) return [];
  const start = cfg.indexOf("[", at);
  const out: string[] = [];
  let depth = 0;
  let ruleStart = -1;
  for (let i = start; i < cfg.length; i++) {
    const c = cfg[i];
    if (c === "[" || c === "{" || c === "(") {
      if (depth === 1 && c === "{") ruleStart = i;
      depth++;
    } else if (c === "]" || c === "}" || c === ")") {
      depth--;
      if (depth === 1 && c === "}") out.push(cfg.slice(ruleStart, i + 1));
      if (depth === 0) break;
    }
  }
  return out;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const field = (rule: string, key: string) => {
  const m = rule.match(new RegExp(`${key}:\\s*([\\s\\S]*?),\\s*(?:handler|options|urlPattern|cacheName)\\b`));
  return m ? norm(m[1]) : "";
};
const summarize = (rule: string) => ({
  urlPattern: field(rule, "urlPattern"),
  handler: norm(rule.match(/handler:\s*("[^"]*")/)?.[1] ?? ""),
  cacheName: norm(rule.match(/cacheName:\s*("[^"]*")/)?.[1] ?? ""),
});

// @two-way src/test/swRuntimeCachingNeverStoresApi.test.ts:stale rule entry
// The complete runtimeCaching list. Every rule stores only the HTML shell (same for every
// user) or same-origin build assets/images; none touches a cross-origin or API URL.
const EXPECTED = [
  { urlPattern: '({ request }) => request.mode === "navigate"', handler: '"NetworkFirst"', cacheName: '"html-pages"' },
  {
    urlPattern:
      '({ url, sameOrigin }) => sameOrigin && /\\/assets\\/.*-[A-Za-z0-9_-]{8,}\\.(js|css|webp|png|jpg|jpeg|svg|woff2?)$/.test(url.pathname)',
    handler: '"StaleWhileRevalidate"',
    cacheName: '"static-assets"',
  },
  {
    urlPattern: "({ url, sameOrigin }) => sameOrigin && /\\.(png|webp|jpg|jpeg|svg|ico)$/.test(url.pathname)",
    handler: '"StaleWhileRevalidate"',
    cacheName: '"static-images"',
  },
];

// @mutate vite.config.ts |             handler: "StaleWhileRevalidate",\n            options: {\n              cacheName: "static-assets", |             handler: "NetworkFirst",\n            options: {\n              cacheName: "static-assets",
// @mutate vite.config.ts |           // NO rule for https://*.supabase.co/* (Q1174). |           {\n            urlPattern: /^https:\\/\\/.*\\.supabase\\.co\\/.*/i,\n            handler: "NetworkFirst",\n            options: { cacheName: "api-cache" },\n          },\n          // NO rule for https://*.supabase.co/* (Q1174).
// @mutate vite.config.ts |               sameOrigin && /\.(png\|webp\|jpg\|jpeg\|svg\|ico)$/.test(url.pathname), |               /\.(png\|webp\|jpg\|jpeg\|svg\|ico)$/.test(url.pathname),
describe("Q1174: the service worker never stores a signed-in response", () => {
  const all = rules();

  it("the inventory is real", () => {
    expect(all.length).toBeGreaterThan(2);
    expect(all.every((r) => /urlPattern:/.test(r) && /handler:/.test(r))).toBe(true);
  });

  it("no rule names a host, a scheme, supabase, or an API path", () => {
    const bad = all
      .map(summarize)
      .filter((r) => /supabase|https?:|\\\/\\\/|\/rest\/|\/auth\/|\/functions\/|\/storage\/|api-cache/i.test(r.urlPattern + r.cacheName))
      .map((r) => r.cacheName || r.urlPattern);
    expect(bad).toEqual([]);
  });

  it("every rule that stores anything is navigation or sameOrigin", () => {
    const bad = all
      .map(summarize)
      .filter((r) => r.handler !== '"NetworkOnly"')
      .filter((r) => !/request\.mode === "navigate"/.test(r.urlPattern) && !/\bsameOrigin\b/.test(r.urlPattern))
      .map((r) => r.cacheName);
    expect(bad).toEqual([]);
  });

  it("no rule caches the response of a request that carries credentials (no cacheWillUpdate-less api rule, no plugins)", () => {
    expect(all.filter((r) => /plugins:|fetchOptions|credentials/.test(r))).toEqual([]);
  });

  it("the rule list is exactly the reviewed one (two-way)", () => {
    expect(all.map(summarize)).toEqual(EXPECTED);
  });
});
