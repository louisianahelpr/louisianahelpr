/**
 * A gift guide cover shows only products that are in that guide right now (owner 11-20: "The covers need to have
 * correct pictures": the Dad cover still showed a HEYDUDE slide she had removed, and store covers drew bestseller
 * photos of products the page never listed), and never an Amazon photo (Amazon images are never edited, so they are
 * never cut out for a cover). scripts/check-gift-cover-in-guide.mjs reads the cover manifest against each guide's picks.
 *
 * @mutate scripts/check-gift-cover-in-guide.mjs |       if (!named.length) out.push(`${slug}: "${item.name}" is not in the guide`); |       if (false) out.push(`${slug}: "${item.name}" is not in the guide`);
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MANIFEST, coverStrays, isAmazonPhoto } from "../../scripts/check-gift-cover-in-guide.mjs";

type Item = { name: string; key?: string; image?: string };
type Manifest = Record<string, { section?: string; items: Item[] }>;
type Pick = { name: string; image?: string; href?: string; store?: string };
const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;

const mug: Pick = { name: "Camp Mug", image: "https://shop.example/mug.jpg", href: "https://shop.example/mug" };
const guide = (picks: Pick[]) => () => picks;

describe("gift guide covers show only their own guide's products", () => {
  it("every product on every cover is in that guide, with the guide's photo, and is not an Amazon photo", () => {
    expect(Object.values(manifest).reduce((n, c) => n + c.items.length, 0)).toBeGreaterThan(100);
    expect(coverStrays(manifest)).toEqual([]);
  });

  it("flags a cover product the guide no longer lists (the removed slide)", () => {
    const cover = { dad: { items: [{ name: "HEYDUDE Austin Lift Leather Mule", image: "https://shop.example/slide.jpg" }] } };
    expect(coverStrays(cover, guide([mug]))).toEqual(['dad: "HEYDUDE Austin Lift Leather Mule" is not in the guide']);
  });

  it("flags a cover photo the guide does not use for that product", () => {
    expect(coverStrays({ a: { items: [{ name: "Camp Mug", image: "https://other.example/x.jpg" }] } }, guide([mug]))).toEqual(['a: "Camp Mug" shows a photo the guide does not use']);
    expect(coverStrays({ a: { items: [{ name: "Camp Mug" }] } }, guide([mug]))).toEqual(['a: "Camp Mug" has no photo in the manifest']);
  });

  it("flags an Amazon photo or an Amazon pick on a cover", () => {
    const amz: Pick = { name: "Kindle", image: "https://m.media-amazon.com/images/I/x.jpg", href: "https://www.amazon.com/dp/X" };
    expect(coverStrays({ a: { items: [{ name: "Kindle", image: amz.image }] } }, guide([amz]))).toEqual(['a: "Kindle" is an Amazon photo']);
    const sold: Pick = { ...mug, store: "store-amazon" };
    expect(coverStrays({ a: { items: [{ name: "Camp Mug", image: mug.image }] } }, guide([sold]))).toEqual(['a: "Camp Mug" is an Amazon photo']);
    expect(isAmazonPhoto("https://images-na.ssl-images-amazon.com/x.jpg")).toBe(true);
    expect(isAmazonPhoto("https://notamazon.example/x.jpg")).toBe(false);
  });

  it("lets an Amazon-linked pick on only through the owner's non-Amazon stand-in photo (scripts/gift-guide-cover-pins.json)", () => {
    // Owner 11-21: an Amazon-linked pick may be on its cover with the same product's photo from another store, cut out.
    const amz: Pick = { name: "YETI Rambler", image: "https://m.media-amazon.com/images/I/y.jpg", href: "https://www.amazon.com/dp/Y", store: "store-amazon" };
    const cutout = "https://www.louisianahelpr.com/gift-guides/cutouts/yeti.webp";
    expect(coverStrays({ a: { items: [{ name: "YETI Rambler", image: cutout }] } }, guide([amz]), { a: { "YETI Rambler": cutout } })).toEqual([]);
    expect(coverStrays({ a: { items: [{ name: "YETI Rambler", image: cutout }] } }, guide([amz]), {})).toEqual(['a: "YETI Rambler" shows a photo the guide does not use']);
    expect(coverStrays({ a: { items: [{ name: "YETI Rambler", image: amz.image }] } }, guide([amz]), { a: { "YETI Rambler": amz.image! } })).toEqual(['a: "YETI Rambler" is an Amazon photo']);
  });

  it("passes a cover whose products are all in the guide", () => {
    expect(coverStrays({ a: { items: [{ name: "Camp Mug", image: mug.image }] } }, guide([mug]))).toEqual([]);
  });
});
