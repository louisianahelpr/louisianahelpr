/**
 * Owner 10-31: an iMessage link preview showed the H logo doubled and cut off. The square mark
 * (og-image-square.png, 1024x1024) was the SECOND og:image on every page, and iMessage may pick it and crop it.
 * The class: a page's link card offers anything but exactly one og:image, its own 1200x630 picture, or a
 * twitter:image that is the square mark.
 *
 * Read from the source shell (index.html serves "/" and "/jobs" as-is) and through the REAL api/share.ts handler for
 * /declutter, /browse, a Declutter item and a job link (the same import as sectionShareCards.test.ts). A Book me or
 * shop-logo link previews with the person's or shop's own photo (sharedLinksOwnPhoto.test.ts, shopPublicPage.test.ts);
 * those still carry exactly one og:image (counted there).
 *
 * @mutate index.html |     <meta property="og:site_name" content="Louisiana Helpr" /> |     <meta property="og:image" content="https://www.louisianahelpr.com/og-image-square.png" />\n    <meta property="og:image:width" content="1024" />\n    <meta property="og:image:height" content="1024" />\n    <meta property="og:site_name" content="Louisiana Helpr" />
 * @mutate index.html |     <meta name="twitter:image" content="https://www.louisianahelpr.com/og-image.png?v=h2" /> |     <meta name="twitter:image" content="https://www.louisianahelpr.com/og-image-square.png" />
 * @mutate api/share.ts |     ...(card ? { image: { url: `${SITE_ORIGIN}${card.path}`, type: "image/png", width: 1200, height: 630, alt: card.alt } } : {}), |     ...(card ? { image: { url: `${SITE_ORIGIN}${card.path}`, type: "image/png", width: 1024, height: 1024, alt: card.alt } } : {}),
 * @mutate scripts/build-og-shell.mjs |   if (!IMAGE_ORDER_GUARD.test(html) \|\| ogImageCount !== 1) { |   if (!IMAGE_ORDER_GUARD.test(html)) {
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";

const ITEM = "3f2a1b0c-1111-4222-8333-444455556666";
const PHOTO = "9a8b7c6d-1111-4222-8333-444455556666";
const JOB = "5e4d3c2b-1111-4222-8333-444455556666";

/** Every og:image block of a page: its url and the width/height that follow it, up to the next og:image. */
function ogImages(html: string): { url: string; width: string | undefined; height: string | undefined }[] {
  const parts = html.split('<meta property="og:image" content="').slice(1);
  return parts.map((p) => ({
    url: p.slice(0, p.indexOf('"')),
    width: p.match(/<meta property="og:image:width" content="(\d+)"/)?.[1],
    height: p.match(/<meta property="og:image:height" content="(\d+)"/)?.[1],
  }));
}

function expectOneWideCard(html: string, where: string) {
  const imgs = ogImages(html);
  expect(imgs.length, `${where}: og:image count`).toBe(1);
  expect(imgs[0], where).toMatchObject({ width: "1200", height: "630" });
  expect(imgs[0].url, where).not.toMatch(/square/);
  const twitter = [...html.matchAll(/<meta name="twitter:image" content="([^"]*)"/g)].map((m) => m[1]);
  expect(twitter, `${where}: twitter:image`).toEqual([imgs[0].url]);
  expect(html, where).not.toMatch(/<meta [^>]*content="[^"]*og-image-square/);
}

describe("every page offers exactly one link-card image, its own 1200x630 card (owner 10-31)", () => {
  it('the shell ("/" and "/jobs" are served from it as-is)', () => {
    expectOneWideCard(readFileSync(resolve("index.html"), "utf8"), "index.html");
  });

  it("the build refuses a shell with more than one og:image", () => {
    const src = readFileSync(resolve("scripts/build-og-shell.mjs"), "utf8");
    expect(src).toContain('const ogImageCount = (html.match(/<meta property="og:image" /g) ?? []).length;');
    expect(src).toContain("if (!IMAGE_ORDER_GUARD.test(html) || ogImageCount !== 1) {");
    expect(src).not.toContain("og-image-square");
  });

  describe("the share HTML api/share.ts writes", () => {
    let handler: { fetch: (req: Request) => Promise<Response> };
    beforeAll(async () => {
      vi.stubEnv("VITE_SUPABASE_URL", "https://example.supabase.co");
      vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "anon-key");
      vi.stubGlobal("fetch", async (url: string) => {
        const u = String(url);
        const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
        if (u.endsWith("/rest/v1/rpc/declutter_public_item_card")) {
          return json({ title: "Oak rocking chair", price_cents: 2500, area_label: "Mid-City, Baton Rouge", photo_id: PHOTO });
        }
        if (u.includes("/rest/v1/open_jobs_browse")) {
          return json([{ id: JOB, title: "Mow my lawn", category: "yard", budget: 60, location: "Baton Rouge", date_needed: null, pricing_mode: "fixed", expires_at: null, photos: [] }]);
        }
        throw new Error(`unexpected fetch ${u}`);
      });
      ensureOgShellSnapshot(resolve("."));
      const sharePath = ["..", "..", "api", "share"].join("/");
      handler = (await import(/* @vite-ignore */ sharePath)).default;
    });
    afterAll(() => {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    });

    const PAGES = [
      { where: "/declutter", q: "_og=page&_id=declutter" },
      { where: "/browse", q: "_og=page&_id=browse" },
      { where: "/declutter/item/:id", q: `_og=declutter&_id=${ITEM}` },
      { where: "/jobs/:id", q: `_og=job&_id=${JOB}` },
    ];

    it("covers the share routes (floor)", () => {
      expect(PAGES.length).toBeGreaterThan(3);
    });

    it.each(PAGES)("$where", async ({ where, q }) => {
      const res = await handler.fetch(new Request(`https://www.louisianahelpr.com/api/share?${q}`));
      expect(res.status, where).toBe(200);
      expectOneWideCard(await res.text(), where);
    });
  });
});
