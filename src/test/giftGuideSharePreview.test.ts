/**
 * A shared gift guide link previews with that guide's own cover (owner-approved 2026-11-18, Builder 7 item 1): the
 * /gift-guides/<slug> rewrite reaches api/share.ts, whose head gives the guide's name as og:title, its description,
 * and its share image as the ONE og:image and twitter:image: public/gift-guides/og/<slug>.jpg (600x600 JPEG, 11-18 PM),
 * else the WebP cover, else the shell's brand card (no broken image URL is ever served). Which files exist comes from
 * src/lib/giftGuideShareImages.mjs, two-way with the folders, so no image folder is bundled into the function.
 *
 * @mutate api/share.ts | const cover = giftGuideCover(id, page.ogTitle); | const cover = undefined;
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { COVER_WEBP_SLUGS, OG_JPG_SLUGS } from "@/lib/giftGuideShareImages.mjs";
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
    const og = inDir("public/gift-guides/og", ".jpg");
    const covers = inDir("public/gift-guides/covers", ".webp");
    expect(og.length).toBeGreaterThan(300);
    expect([...OG_JPG_SLUGS].sort(), "add or remove the slug in src/lib/giftGuideShareImages.mjs").toEqual(og);
    expect([...COVER_WEBP_SLUGS].sort(), "add or remove the slug in src/lib/giftGuideShareImages.mjs").toEqual(covers);
  });

  it.each(["mom", "dad", "store-amazon", "under-25"])("/gift-guides/%s previews with its own share JPG", async (slug) => {
    expect(existsSync(`public/gift-guides/og/${slug}.jpg`)).toBe(true);
    const head = await headFor(`gift-guides/${slug}`);
    const url = `${ORIGIN}/gift-guides/og/${slug}.jpg`;
    expect(head).toContain(`<meta property="og:image" content="${url}"`);
    expect(head).toContain('<meta property="og:image:type" content="image/jpeg"');
    expect(head).toContain('<meta property="og:image:width" content="600"');
    expect(head).toContain('<meta property="og:image:height" content="600"');
    expect(head).toContain(`<meta name="twitter:image" content="${url}"`);
    // Exactly one og:image: the guide's own, never also the brand fallback.
    expect(head.match(/<meta property="og:image" /g)).toHaveLength(1);
    expect(head).toMatch(/<meta property="og:title" content="[^"]*holiday gift guide 2026"/);
    expect(head).toMatch(/<meta property="og:description" content="[^"]*hand-picked holiday gift ideas/);
  });

  it("a guide with a WebP cover but no share JPG falls back to the cover", async () => {
    // @mutate api/share.ts |   if (COVER_WEBP_SLUGS.has(slug)) return |   if (false) return
    OG_JPG_SLUGS.delete("mom");
    try {
      const head = await headFor("gift-guides/mom");
      expect(head).toContain(`<meta property="og:image" content="${ORIGIN}/gift-guides/covers/mom.webp"`);
      expect(head).toContain('<meta property="og:image:type" content="image/webp"');
    } finally {
      OG_JPG_SLUGS.add("mom");
    }
  });

  it("the Mom guide's title is its name", async () => {
    const head = await headFor("gift-guides/mom");
    expect(head).toContain('<meta property="og:title" content="Gifts for Mom: holiday gift guide 2026"');
    expect(head).toContain('<meta property="og:image:alt" content="Gifts for Mom: holiday gift guide 2026"');
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

  it("the landing keeps the brand card", async () => {
    const head = await headFor("gift-guides");
    expect(head).not.toContain("/gift-guides/covers/");
    expect(head).not.toContain("/gift-guides/og/");
  });
});
