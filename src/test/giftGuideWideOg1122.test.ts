/**
 * Owner 2026-11-22, "Fix the preview on these links": she shared /gift-guides/her on Facebook and it came out as a SMALL
 * square thumbnail beside the title, because every guide's og:image was its 600x600 cover (the landing's 1200x630 card
 * got Facebook's big card). Every gift guides page with its own head now shares a 1200x630 card in its banner's style
 * (scripts/gift-guide-wide-og.py -> public/gift-guides/og-wide/<key>.jpg), declared 1200x630, with the file's content
 * hash as ?v= (src/lib/giftGuideWideOg.mjs) so a redrawn card is a new URL to Facebook's cache. og:title and
 * og:description are unchanged.
 *
 * @mutate api/share.ts |   if (wide) return wide; |   if (false) return wide;
 * @mutate api/share.ts | "gift-guides/kids": "kids", | "gift-guides/kidz": "kids",
 * @mutate api/share.ts | url.searchParams.has("who")); | false);
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WIDE_OG_VERSIONS } from "@/lib/giftGuideWideOg.mjs";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

const ORIGIN = "https://www.louisianahelpr.com";
const DIR = "public/gift-guides/og-wide";

async function headFor(query: string): Promise<string> {
  ensureOgShellSnapshot(resolve("."));
  const sharePath = ["..", "..", "api", "share"].join("/");
  const handler = (await import(/* @vite-ignore */ sharePath)).default as { fetch: (r: Request) => Promise<Response> };
  const html = await (await handler.fetch(new Request(`${ORIGIN}/api/share?${query}`))).text();
  return html.slice(0, html.indexOf("</head>"));
}

/** A JPEG's own [width, height], from its SOF0/SOF2 frame header. */
function jpegSize(buf: Buffer): [number, number] | null {
  let at = 2;
  while (at + 9 < buf.length) {
    const marker = buf[at + 1];
    if (marker === 0xc0 || marker === 0xc2) return [buf.readUInt16BE(at + 7), buf.readUInt16BE(at + 5)];
    at += 2 + buf.readUInt16BE(at + 2);
  }
  return null;
}

/** Each page the owner shares, its share-function query and its card. */
const PAGES: [string, string][] = [
  ["_og=page&_id=gift-guides/her", "her"],
  ["_og=page&_id=gift-guides/him", "him"],
  ["_og=page&_id=gift-guides/kids", "kids"],
  ["_og=page&_id=gift-guides/25-days-sponsors", "25-days-sponsors"],
  ["_og=page&_id=gift-guides/black-friday", "black-friday"],
  ["_og=page&_id=gift-guides/cyber-monday", "cyber-monday"],
  ["_og=page&_id=gift-guides/small-business-saturday", "small-business-saturday"],
  ["_og=page&_id=gift-guides/printables/gift-tags", "gift-tags"],
  ["_og=page&_id=gift-guides/printables/coloring-books", "coloring-books"],
  ["_og=page&_id=gift-guides/printables/banners", "banners"],
  ["_og=page&_id=gift-guides&who=her&budget=50", "find-a-gift"],
  ["_og=page&_id=gift-guides/swipe", "swipe"],
  ["_og=page&_id=gift-guides/draw-names", "draw-names"],
  ["_og=page&_id=gift-guides/planner", "planner"],
  ["_og=page&_id=gift-guides/my-list", "my-list"],
  ["_og=wishlist&_id=abc123defghi", "wish-list"],
  ["_og=page&_id=holidays", "holidays"],
];

describe("gift guide pages share a 1200x630 card (owner 2026-11-22)", () => {
  it("the version list matches the og-wide folder exactly (two-way), every page has its card", () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith(".jpg")).map((f) => f.slice(0, -4)).sort();
    expect(files.length).toBeGreaterThan(15); // 17 measured 2026-11-22
    expect(Object.keys(WIDE_OG_VERSIONS).sort(), "re-run scripts/gift-guide-wide-og.py").toEqual(files);
    expect(PAGES.map(([, k]) => k).sort()).toEqual(files);
  });

  it.each(Object.keys(WIDE_OG_VERSIONS))("%s.jpg is 1200x630, at most 150 KB, and its ?v= is its content hash", (key) => {
    const buf = readFileSync(`${DIR}/${key}.jpg`);
    expect(jpegSize(buf)).toEqual([1200, 630]);
    expect(buf.length).toBeLessThanOrEqual(150_000);
    expect(WIDE_OG_VERSIONS[key]).toBe(createHash("md5").update(buf).digest("hex").slice(0, 8));
  });

  it.each(PAGES)("%s previews with og-wide/%s.jpg at 1200x630 as its one og:image", async (query, key) => {
    const head = await headFor(query);
    const url = `${ORIGIN}/gift-guides/og-wide/${key}.jpg?v=${WIDE_OG_VERSIONS[key]}`;
    expect(head).toContain(`<meta property="og:image" content="${url}"`);
    expect(head).toContain('<meta property="og:image:type" content="image/jpeg"');
    expect(head).toContain('<meta property="og:image:width" content="1200"');
    expect(head).toContain('<meta property="og:image:height" content="630"');
    expect(head).toContain(`<meta name="twitter:image" content="${url}"`);
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(head.match(/<meta property="og:image" /g)).toHaveLength(1);
    expect(head).not.toContain('content="600"');
  });

  it("the landing without ?who= keeps its plaid card, and og:title stays as it was", async () => {
    const head = await headFor("_og=page&_id=gift-guides");
    expect(head).toContain(`<meta property="og:image" content="${ORIGIN}/gift-guides/landing-plaid-v5.jpg"`);
    const finder = await headFor("_og=page&_id=gift-guides&who=kids");
    expect(finder).toContain('<meta property="og:title" content="Holiday gift guides 2026"');
    const her = await headFor("_og=page&_id=gift-guides/her");
    expect(her).toContain('<meta property="og:title" content="Gifts for Her: holiday gift guide 2026"');
  });
});
