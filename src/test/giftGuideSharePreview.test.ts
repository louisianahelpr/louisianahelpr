/**
 * A shared gift guide link previews with that guide's own cover (owner-approved 2026-11-18, Builder 7 item 1): the
 * /gift-guides/<slug> rewrite reaches api/share.ts, whose head gives the guide's name as og:title, its description,
 * and its share image as the ONE og:image and twitter:image: public/gift-guides/og/<slug>.jpg (600x600 JPEG, 11-18 PM),
 * else the WebP cover, else the shell's brand card (no broken image URL is ever served). Which files exist comes from
 * src/lib/giftGuideShareImages.mjs, two-way with the folders, so no image folder is bundled into the function.
 *
 * @mutate api/share.ts | ?? giftGuideCover(id, page.ogTitle); | ?? undefined;
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { COVER_WEBP_SLUGS, OG_JPG_SLUGS } from "@/lib/giftGuideShareImages.mjs";
import { COVER_VERSIONS, OG_VERSIONS } from "@/lib/giftGuideCoverVersions.mjs";
import { WIDE_OG_VERSIONS } from "@/lib/giftGuideWideOg.mjs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

const ORIGIN = "https://www.louisianahelpr.com";

async function headFor(id: string): Promise<string> {
  ensureOgShellSnapshot(resolve("."));
  const sharePath = ["..", "..", "api", "share"].join("/");
  const handler = (await import(/* @vite-ignore */ sharePath)).default as { fetch: (r: Request) => Promise<Response> };
  const html = await (await handler.fetch(new Request(`${ORIGIN}/api/share?_og=page&_id=${id}`))).text();
  return html.slice(0, html.indexOf("</head>"));
}

describe("gift guide share preview (api/share.ts)", () => {
  it("vercel.json sends /gift-guides/<slug> to the share function, with no image folder bundled", () => {
    const v = JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[]; functions: Record<string, { includeFiles?: string }> };
    expect(v.rewrites.find((r) => r.source === "/gift-guides/:slug")?.destination).toBe("/api/share?_og=page&_id=gift-guides/:slug");
    // The function decides from the slug lists below, so the 14 MB of share JPGs stay out of its bundle.
    expect(v.functions["api/share.ts"]?.includeFiles ?? "").not.toContain("public/gift-guides");
  });

  it("the slug lists match the image folders exactly (two-way)", () => {
    const inDir = (dir: string, ext: string) => readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => f.slice(0, -ext.length)).sort();
    // landing.jpg is the landing's own 1200x630 card (holistic review 11-18 M7), no guide's: checked below.
    const og = inDir("public/gift-guides/og", ".jpg").filter((s) => s !== "landing");
    const covers = inDir("public/gift-guides/covers", ".webp");
    expect(og.length).toBeGreaterThan(45); // follow-up 1120: ~30 guides + 26 store pages, measured 2026-11-20 (54)
    expect([...OG_JPG_SLUGS].sort(), "add or remove the slug in src/lib/giftGuideShareImages.mjs").toEqual(og);
    expect([...COVER_WEBP_SLUGS].sort(), "add or remove the slug in src/lib/giftGuideShareImages.mjs").toEqual(covers);
  });

  // Owner 11-21: store-amazon is retired (src/content/giftGuideLive.mjs); Him took its place.
  // Owner 2026-11-22 ("Fix the preview on these links"): the 600x600 cover gave Facebook's small square thumbnail; each
  // live guide now shares its 1200x630 card (public/gift-guides/og-wide/<slug>.jpg; src/test/giftGuideWideOg1122.test.ts).
  it.each(["him", "her", "kids"])("/gift-guides/%s previews with its own 1200x630 share JPG", async (slug) => {
    expect(existsSync(`public/gift-guides/og-wide/${slug}.jpg`)).toBe(true);
    const head = await headFor(`gift-guides/${slug}`);
    // ?v= is the card's content hash (owner 11-21: a redrawn card is a new URL; src/lib/giftGuideWideOg.mjs).
    const url = `${ORIGIN}/gift-guides/og-wide/${slug}.jpg?v=${WIDE_OG_VERSIONS[slug]}`;
    expect(head).toContain(`<meta property="og:image" content="${url}"`);
    expect(head).toContain('<meta property="og:image:type" content="image/jpeg"');
    expect(head).toContain('<meta property="og:image:width" content="1200"');
    expect(head).toContain('<meta property="og:image:height" content="630"');
    expect(head).toContain(`<meta name="twitter:image" content="${url}"`);
    // Exactly one og:image: the guide's own, never also the brand fallback.
    expect(head.match(/<meta property="og:image" /g)).toHaveLength(1);
    expect(head).toMatch(/<meta property="og:title" content="[^"]*holiday gift guide 2026"/);
    // The description names the guide's own count and first picks (giftGuideDescription, SEO P1): "Gifts for Mom 2026: 42 hand-picked gift ideas, like …".
    // With the built SEO data it is the count and first picks; without it (CI builds none) the generic fallback.
    expect(head).toMatch(/<meta property="og:description" content="[^"]*(\d+ hand-picked gift ideas?, like |hand-picked holiday gift ideas)/);
  });

  it("a guide with no wide card falls back to its square share JPG, then to the WebP cover", async () => {
    // @mutate api/share.ts |   if (COVER_WEBP_SLUGS.has(slug)) return |   if (false) return
    const wide = WIDE_OG_VERSIONS.her;
    delete (WIDE_OG_VERSIONS as Record<string, string>).her;
    try {
      const jpg = await headFor("gift-guides/her");
      expect(jpg).toContain(`<meta property="og:image" content="${ORIGIN}/gift-guides/og/her.jpg?v=${OG_VERSIONS.her}"`);
      expect(jpg).toContain('<meta property="og:image:width" content="600"');
      OG_JPG_SLUGS.delete("her");
      const head = await headFor("gift-guides/her");
      expect(head).toContain(`<meta property="og:image" content="${ORIGIN}/gift-guides/covers/her.webp?v=${COVER_VERSIONS.her}"`);
      expect(head).toContain('<meta property="og:image:type" content="image/webp"');
    } finally {
      OG_JPG_SLUGS.add("her");
      (WIDE_OG_VERSIONS as Record<string, string>).her = wide;
    }
  });

  it("the Her guide's title is its name", async () => {
    const head = await headFor("gift-guides/her");
    expect(head).toContain('<meta property="og:title" content="Gifts for Her: holiday gift guide 2026"');
    expect(head).toContain('<meta property="og:image:alt" content="Gifts for Her: holiday gift guide 2026"');
  });

  it("a page with no cover file keeps the brand card", async () => {
    // Every guide has a cover since the covers round 2 (design review M2): a slug no guide uses has none.
    const slug = "store-no-such-store";
    expect(existsSync(`public/gift-guides/covers/${slug}.webp`) || existsSync(`public/gift-guides/og/${slug}.jpg`)).toBe(false);
    const head = await headFor(`gift-guides/${slug}`);
    expect(head).toContain('<meta property="og:image" ');
    expect(head).not.toContain("/gift-guides/covers/");
    expect(head).not.toContain("/gift-guides/og/");
  });

  it("a slug cannot reach a file outside the covers folder", async () => {
    const head = await headFor("gift-guides/..%2F..%2Fpackage");
    expect(head).not.toContain("/gift-guides/covers/");
    expect(head).not.toContain("/gift-guides/og/");
  });

  // Holistic review 11-18 M7: the landing shared the generic logo card; it now shares its own 1200x630 collage.
  // @mutate api/share.ts |   if (id === "gift-guides") return | if (id === "gift-guides-x") return
  // @mutate src/lib/publicPageMeta.mjs | ogTitle: "Holiday gift guides 2026", | ogTitle: "Holiday gift guides 2026 from Louisiana Helpr",
  it("the landing shares its own 1200x630 plaid holiday gift guides card, at most 150 KB", async () => {
    const head = await headFor("gift-guides");
    expect(head).toContain(`<meta property="og:image" content="${ORIGIN}/gift-guides/landing-plaid-v5.jpg"`);
    expect(head).toContain("Holiday gift guides from Louisiana Helpr");
    // Owner 2026-11-22: the link's headline is just "Holiday gift guides 2026" (og:title and twitter:title), the site's
    // name stays in og:site_name, and the page's own <title> is unchanged.
    expect(head).toContain('<meta property="og:title" content="Holiday gift guides 2026"');
    expect(head).toContain('<meta name="twitter:title" content="Holiday gift guides 2026"');
    expect(head).not.toContain("Holiday gift guides 2026 from Louisiana Helpr");
    expect(head).toContain('<meta property="og:site_name" content="Louisiana Helpr"');
    expect(head).toContain("<title>Holiday gift guides 2026 — Helpr</title>");
    expect(head).toContain(`<meta name="twitter:image" content="${ORIGIN}/gift-guides/landing-plaid-v5.jpg"`);
    expect(head).toContain('<meta property="og:image:type" content="image/jpeg"');
    expect(head).toContain('<meta property="og:image:width" content="1200"');
    expect(head).toContain('<meta property="og:image:height" content="630"');
    expect(head.match(/<meta property="og:image" /g)).toHaveLength(1);
    const jpg = readFileSync("public/gift-guides/landing-plaid-v5.jpg");
    expect(jpg.length).toBeLessThanOrEqual(150_000);
    // The JPEG's own size, from its SOF0/SOF2 frame header.
    let at = 2;
    let size: [number, number] | null = null;
    while (at < jpg.length && !size) {
      const marker = jpg[at + 1];
      const len = jpg.readUInt16BE(at + 2);
      if (marker === 0xc0 || marker === 0xc2) size = [jpg.readUInt16BE(at + 7), jpg.readUInt16BE(at + 5)];
      at += 2 + len;
    }
    expect(size).toEqual([1200, 630]);
  });
});
