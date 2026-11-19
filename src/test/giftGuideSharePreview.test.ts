/**
 * A shared gift guide link previews with that guide's own cover (owner-approved 2026-11-18, Builder 7 item 1): the
 * /gift-guides/<slug> rewrite reaches api/share.ts, whose head gives the guide's name as og:title, its description,
 * and its cover (public/gift-guides/covers/<slug>.webp, absolute www URL) as the ONE og:image and twitter:image. A
 * guide without a cover file keeps the shell's brand card (no broken image URL is ever served).
 *
 * @mutate api/share.ts | const cover = giftGuideCover(id, page.ogTitle); | const cover = undefined;
 */
import { existsSync, readFileSync } from "node:fs";
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
  it("vercel.json sends /gift-guides/<slug> to the share function, with the covers bundled", () => {
    const v = JSON.parse(readFileSync("vercel.json", "utf8")) as { rewrites: { source: string; destination: string }[]; functions: Record<string, { includeFiles?: string }> };
    expect(v.rewrites.find((r) => r.source === "/gift-guides/:slug")?.destination).toBe("/api/share?_og=page&_id=gift-guides/:slug");
    // The covers ship with the function, so its existence check is true on Vercel too.
    expect(v.functions["api/share.ts"]?.includeFiles ?? "").toContain("public/gift-guides/covers/**");
  });

  it.each(["mom", "dad", "store-amazon", "under-25"])("/gift-guides/%s previews with its own cover", async (slug) => {
    expect(existsSync(`public/gift-guides/covers/${slug}.webp`)).toBe(true);
    const head = await headFor(`gift-guides/${slug}`);
    const url = `${ORIGIN}/gift-guides/covers/${slug}.webp`;
    expect(head).toContain(`<meta property="og:image" content="${url}"`);
    expect(head).toContain('<meta property="og:image:type" content="image/webp"');
    expect(head).toContain('<meta property="og:image:width" content="480"');
    expect(head).toContain('<meta property="og:image:height" content="480"');
    expect(head).toContain(`<meta name="twitter:image" content="${url}"`);
    // Exactly one og:image: the guide's cover, never also the brand fallback.
    expect(head.match(/<meta property="og:image" /g)).toHaveLength(1);
    expect(head).toMatch(/<meta property="og:title" content="[^"]*holiday gift guide 2026"/);
    expect(head).toMatch(/<meta property="og:description" content="[^"]*hand-picked holiday gift ideas/);
  });

  it("the Mom guide's title is its name", async () => {
    const head = await headFor("gift-guides/mom");
    expect(head).toContain('<meta property="og:title" content="Gifts for Mom: holiday gift guide 2026"');
    expect(head).toContain('<meta property="og:image:alt" content="Gifts for Mom: holiday gift guide 2026"');
  });

  it("a guide with no cover file keeps the brand card", async () => {
    const slug = "store-atlas-coffee-club";
    expect(existsSync(`public/gift-guides/covers/${slug}.webp`)).toBe(false);
    const head = await headFor(`gift-guides/${slug}`);
    expect(head).toContain('<meta property="og:image" ');
    expect(head).not.toContain("/gift-guides/covers/");
  });

  it("a slug cannot reach a file outside the covers folder", async () => {
    expect(await headFor("gift-guides/..%2F..%2Fpackage")).not.toContain("/gift-guides/covers/");
  });

  it("the landing keeps the brand card", async () => {
    expect(await headFor("gift-guides")).not.toContain("/gift-guides/covers/");
  });
});
