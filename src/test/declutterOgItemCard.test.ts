/**
 * Owner 11-20 (site polish E): a shared Declutter item link (Facebook, iMessage) previewed its first photo cover-cropped
 * to 1200x630 by shop-photo, which cut a portrait photo to a thin middle band, and a square crop of that cut it again.
 * Now api/share.ts points the item page's ONE og:image at api/og-item.ts, which draws a 1200x630 PNG with the WHOLE
 * photo inside the centre 630x630 square (what a 1:1 crop keeps) on a faded fill of the same photo (no bars at 1.91:1).
 *
 *  - og-item renders a real 1200x630 PNG at the canonical URL only (?id=<item>&p=<cover>&v=<style>); any other query is
 *    a 302 there; any miss (bad id, item gone, no photo, slow read) is a 302 to the brand image, never a 500;
 *  - the photo is fetched only through shop-photo kind=declutter by the item's CURRENT cover id (no URL from the
 *    request is ever fetched);
 *  - the tree: the contain image is exactly the centre square, the cover image fills the card behind it.
 *
 * @mutate api/og-item.ts |       if (!isUuid(itemId)) return fallback(); |
 * @mutate api/og-item.ts |       if (url.search !== canonical.slice(canonical.indexOf("?"))) { |       if (false) {
 * @mutate api/og-item.ts |       if (!cover) return fallback(); |       if (!cover) return new Response("x", { status: 500 });
 * @mutate api/og-item.ts | { position: "absolute", left: (OG_ITEM_WIDTH - side) / 2, top: 0, width: side, height: side, objectFit: "contain" } | { position: "absolute", left: 0, top: 0, width: OG_ITEM_WIDTH, height: OG_ITEM_HEIGHT, objectFit: "cover" }
 * @mutate api/share.ts |   const url = ogItemImageUrl(SITE_ORIGIN, itemId, id); |   const url = `${SUPABASE_URL}/functions/v1/shop-photo?id=${id}&kind=declutter&w=1200&og=1`;
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { OG_ITEM_STYLE, ogItemImageUrl, ogItemPhotoUrl } from "@/lib/ogItemCard.mjs";
import { blankComments } from "./helpers/blankNonCode";

const SB = "https://example.supabase.co";
const ITEM = "3f2a1b0c-1111-4222-8333-444455556666";
const PHOTO = "9a8b7c6d-1111-4222-8333-444455556666";
/** A 1x1 PNG (valid, so the renderer accepts the photo). */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");
const CANON = `?id=${ITEM}&p=${PHOTO}&v=${OG_ITEM_STYLE}`;

function og(query: string, answer: unknown = { title: "Lamp", price_cents: 8500, area_label: null, photo_id: PHOTO }, rpcStatus = 200) {
  const out = execFileSync(process.execPath, [resolve("src/test/helpers/ogItemRun.mjs")], {
    encoding: "utf8",
    input: JSON.stringify({ query, answer, rpcStatus, sb: SB, photo: PIXEL.toString("base64"), photoType: "image/png", fn: resolve("api/og-item.ts") }),
    timeout: 60_000,
  });
  const r = JSON.parse(out.trim().split("\n").pop() as string) as { status: number; headers: Record<string, string>; png: string; fetched: string[] };
  return { ...r, headers: new Headers(r.headers), body: Buffer.from(r.png, "base64") };
}

describe("site polish E: a Declutter item's link image is safe at 1:1 and 1.91:1", () => {
  it("draws a real 1200x630 PNG at the canonical URL, from the cover fetched through shop-photo by id", () => {
    const r = og(CANON);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/png");
    expect(r.headers.get("vercel-cdn-cache-control")).toBe("public, s-maxage=600, stale-while-revalidate=600");
    expect(r.body.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect([r.body.readUInt32BE(16), r.body.readUInt32BE(20)]).toEqual([1200, 630]);
    expect(r.fetched).toEqual([`${SB}/rest/v1/rpc/declutter_public_item_card`, `${SB}/functions/v1/shop-photo?id=${PHOTO}&kind=declutter&w=640`]);
  }, 60_000);

  it("any other query is a 302 to the canonical URL; a changed cover moves the canonical URL", () => {
    for (const q of [`?id=${ITEM}`, `?id=${ITEM}&p=${PHOTO}&v=old`, `${CANON}&x=1`, `?id=${ITEM.toUpperCase()}&p=${PHOTO}&v=${OG_ITEM_STYLE}`]) {
      const r = og(q);
      expect(r.status, q).toBe(302);
      expect(r.headers.get("location"), q).toBe(`https://www.louisianahelpr.com/api/og-item${CANON}`);
      expect(r.body.byteLength, q).toBe(0);
    }
    const other = "11111111-2222-4333-8444-555555555555";
    const r = og(CANON, { title: "Lamp", price_cents: 8500, area_label: null, photo_id: other });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(`https://www.louisianahelpr.com/api/og-item?id=${ITEM}&p=${other}&v=${OG_ITEM_STYLE}`);
  }, 60_000);

  it("any miss is a 302 to the brand image, never CDN-cached; a bad id is not even looked up", () => {
    const brand = "https://www.louisianahelpr.com/og-image.png?v=h3";
    for (const [answer, status] of [[null, 200], [{ title: "Lamp", price_cents: 1, area_label: null, photo_id: null }, 200], [{ message: "boom" }, 500]] as const) {
      const r = og(CANON, answer, status);
      expect(r.status).toBe(302);
      expect(r.headers.get("location")).toBe(brand);
      expect(r.headers.get("vercel-cdn-cache-control")).toBeNull();
    }
    for (const q of ["?id=not-an-id", "?id=../../etc", `?id=${ITEM}${"&x=1".repeat(60)}`]) {
      const r = og(q);
      expect(r.status, q).toBe(302);
      expect(r.headers.get("location"), q).toBe(brand);
      expect(r.fetched, q).toEqual([]);
    }
  }, 60_000);

  it("the photo is whole inside the centre square (what a 1:1 crop keeps); a faded cover fills the card behind it", () => {
    const src = blankComments(readFileSync(resolve("api/og-item.ts"), "utf8")).replace(/\s+/g, " ");
    expect(src).toContain('{ position: "absolute", left: (OG_ITEM_WIDTH - side) / 2, top: 0, width: side, height: side, objectFit: "contain" }');
    expect(src).toContain("const side = OG_ITEM_HEIGHT;");
    expect(src).toMatch(/objectFit: "cover", opacity: 0\.25 \}/);
    expect(ogItemImageUrl("https://x", "nope", PHOTO)).toBeNull();
    expect(ogItemPhotoUrl(SB, "nope")).toBeNull();
  });
});
