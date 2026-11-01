/**
 * Owner 10-31 ("Fix this"): a shared /declutter link previewed in iMessage as the bare H mark, twice, cut off, titled
 * only "Declutter on Louisiana Helpr". The class: a section page's link card is not its own 1200x630 picture (the
 * section's name and a line, the mark centred), or the declared og:image size is not the file's real size.
 *
 * Read through the REAL api/share.ts handler (the same import as declutterShareCard.test.ts), and each card's PNG
 * header from public/. An item link (/declutter/item/:id) keeps its own photo card: declutterShareCard.test.ts.
 *
 * @mutate api/share.ts |   declutter: { path: "/og-declutter.png?v=1", | declutterGone: { path: "/og-declutter.png?v=1",
 * @mutate api/share.ts |     ...(card ? { image: { url: `${SITE_ORIGIN}${card.path}`, type: "image/png", width: 1200, height: 630, alt: card.alt } } : {}), |     ...(card ? { image: { url: `${SITE_ORIGIN}${card.path}`, type: "image/png", width: 1024, height: 1024, alt: card.alt } } : {}),
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

/** Width and height from a PNG's IHDR chunk (bytes 16-23), so the declared size is checked against the real file. */
function pngSize(path: string): { width: number; height: number } {
  const b = readFileSync(resolve(path));
  expect(b.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const SECTIONS = [
  { id: "declutter", file: "og-declutter.png", title: "Declutter on Louisiana Helpr" },
  { id: "browse", file: "og-browse.png", title: "Browse local jobs — Helpr" },
];

describe("a section page's link card is its own 1200x630 picture", () => {
  let handler: { fetch: (req: Request) => Promise<Response> };
  beforeAll(async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("unexpected fetch: a section card needs no database read");
    });
    ensureOgShellSnapshot(resolve("."));
    const sharePath = ["..", "..", "api", "share"].join("/");
    handler = (await import(/* @vite-ignore */ sharePath)).default;
  });
  afterAll(() => vi.unstubAllGlobals());

  it("covers the sections (floor)", () => {
    expect(SECTIONS.length).toBeGreaterThan(1);
  });

  it.each(SECTIONS)("$id: og:image and twitter:image are its own card, 1200x630, with its title", async ({ id, file, title }) => {
    const html = await (await handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?_og=page&_id=${id}`))).text();
    const url = `https://www.louisianahelpr.com/${file}?v=1`;
    // The FIRST og:image block (every major consumer takes the first) is the section's card, sized truly.
    const first = html.indexOf('<meta property="og:image" ');
    const block = html.slice(first, html.indexOf('<meta property="og:image" ', first + 1));
    expect(block).toContain(`<meta property="og:image" content="${url}"`);
    expect(block).toContain('<meta property="og:image:type" content="image/png"');
    expect(block).toContain('<meta property="og:image:width" content="1200"');
    expect(block).toContain('<meta property="og:image:height" content="630"');
    expect(html).toContain(`<meta name="twitter:image" content="${url}"`);
    expect(html).toContain(`<meta property="og:title" content="${title}"`);
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image"');
    expect(pngSize(`public/${file}`)).toEqual({ width: 1200, height: 630 });
  });
});
