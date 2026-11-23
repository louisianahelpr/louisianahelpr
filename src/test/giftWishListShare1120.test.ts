/**
 * The wish list's pages before JavaScript (api/share.ts), UX audit 2026-11-20:
 *   H2 /gift-guides/my-list answered the unknown-guide 404 on a direct load; it is the app's page, noindex, status 200.
 *   M1 a shared /gift-guides/list/<code> link previewed as the generic Helpr card; it has its own card, noindex in the
 *      head and the X-Robots-Tag header, the same for every list (it never shows a list's name).
 *
 * @mutate api/share.ts |     if (slug === MY_LIST_SLUG) return null; |     if (slug === "never") return null;
 * @mutate api/share.ts |   if (declared === "wishlist") return { kind: "wishlist", id: url.searchParams.get("_id") ?? "" }; |   if (declared === "never") return { kind: "wishlist", id: "" };
 * @mutate api/share.ts |     url: ok ? `${SITE_ORIGIN}/gift-guides/list/${code}` : `${SITE_ORIGIN}/gift-guides`,\n    robots: "noindex, nofollow", |     url: ok ? `${SITE_ORIGIN}/gift-guides/list/${code}` : `${SITE_ORIGIN}/gift-guides`,\n    robots: "index, follow",
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

const ORIGIN = "https://www.louisianahelpr.com";

async function fetchShare(query: string): Promise<Response> {
  ensureOgShellSnapshot(resolve("."));
  const sharePath = ["..", "..", "api", "share"].join("/");
  const handler = (await import(/* @vite-ignore */ sharePath)).default as { fetch: (r: Request) => Promise<Response> };
  return handler.fetch(new Request(`${ORIGIN}/api/share?${query}`));
}

describe("wish list pages before JavaScript (api/share.ts)", () => {
  it("vercel.json routes both pages ahead of the not-found catch-all", () => {
    const rewrites = (JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[] }).rewrites;
    const at = (src: string) => rewrites.findIndex((r) => r.source === src);
    expect(rewrites[at("/gift-guides/list/:code")]?.destination).toBe("/api/share?_og=wishlist&_id=:code");
    expect(at("/gift-guides/list/:code")).toBeLessThan(rewrites.length - 1);
    // /gift-guides/my-list is one segment: the /gift-guides/:slug rewrite sends it to the share function.
    expect(rewrites[at("/gift-guides/:slug")]?.destination).toBe("/api/share?_og=page&_id=gift-guides/:slug");
    expect(rewrites.length).toBeGreaterThan(50);
  });

  it("H2: /gift-guides/my-list is a 200 with a noindex head, never the unknown-guide 404", async () => {
    const res = await fetchShare("_og=page&_id=gift-guides/my-list");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<meta name="robots" content="noindex/);
    // (An unknown guide's 404 needs the built SEO data, which CI's unit shard has not built: guarded where that data is.)
  });

  it("M1: a shared list's link has its own noindex card with the gift guides' picture, the same for every code", async () => {
    const res = await fetchShare("_og=wishlist&_id=abc123defghi");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag") ?? "").toMatch(/noindex/);
    const head = (await res.text()).split("</head>")[0];
    expect(head).toContain('content="Someone shared their wish list with you"');
    expect(head).toMatch(/<meta name="robots" content="noindex, nofollow"/);
    // Owner 2026-11-22: its own 1200x630 "shared with you / Wish List" banner card (src/test/giftGuideWideOg1122.test.ts).
    expect(head).toContain("/gift-guides/og-wide/wish-list.jpg?v=");
    expect(head).toContain('<meta property="og:image:width" content="1200"');
    expect(head).toContain(`${ORIGIN}/gift-guides/list/abc123defghi`);
    // A malformed code never reaches og:url.
    const bad = (await (await fetchShare("_og=wishlist&_id=%3Cscript%3E")).text()).split("</head>")[0];
    expect(bad).not.toContain("script%3E");
    expect(bad).not.toContain("/gift-guides/list/<");
  });
});
