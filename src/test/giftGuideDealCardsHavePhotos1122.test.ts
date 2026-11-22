/**
 * Every deals-day card has a picture (owner 2026-11-22 #10: "for sales some things are missing pictures"). On the Black
 * Friday and Cyber Monday pages every card shows a real photo: a Top deals card its deal's own product photo
 * (src/content/giftGuideDeals.json `image`), a Discount codes or Sales card its store's photo
 * (src/content/giftGuideStorePhotos.ts: the store's own product cutout, or the brand's clean logo for a store-wide sale).
 * A card with no photo drew an empty card top (the name-only fallback). Checked for every day a day page can still show:
 * from the first day page's own day (codesDay: the day itself, or today once it has passed) through 40 days on, so a
 * code or sale that starts later is covered too and a passing day only ever shrinks the set; every local file exists.
 *
 * @mutate src/content/giftGuideStorePhotos.ts |   "Camp Snap": "camp-snap.webp", |
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEAL_EVENTS, codesDay, dealsIn, liveDeals, louisianaDay } from "@/content/giftGuideDeals.mjs";
import { STORE_PHOTO_FILES, storePhoto } from "@/content/giftGuideStorePhotos";
import { discountCodes } from "@/content/giftGuides";
import { DEAL_CODES } from "@/content/giftGuidePicks";
import { cleanCodes } from "@/lib/giftGuideOfferCopy.mjs";
import { codesOn, salesOn } from "@/pages/info/giftGuides/GiftGuideDealCards";

const ROOT = join(__dirname, "..", "..");
type Deal = { event: string; brand: string; image?: string; href: string };
const DEALS = JSON.parse(readFileSync(join(ROOT, "src", "content", "giftGuideDeals.json"), "utf8")) as Deal[];
const STORE_CODES = [...discountCodes, ...cleanCodes(DEAL_CODES)];
const DEAL_DAYS = DEAL_EVENTS.filter((e) => e.kind === "deals");

/** Every day from `from` through `to` (YYYY-MM-DD), inclusive. */
const daysFrom = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};
const today = louisianaDay(new Date());
const first = DEAL_DAYS.map((e) => codesDay(e, today)).sort()[0];
const horizon = new Date(`${first}T12:00:00Z`);
horizon.setUTCDate(horizon.getUTCDate() + 40);
const days = daysFrom(first, horizon.toISOString().slice(0, 10));

const localFile = (src: string) => join(ROOT, "public", src.replace(/^https:\/\/www\.louisianahelpr\.com/, ""));

describe("deals-day cards all have a picture (owner 11-22 #10)", () => {
  it("every Discount codes and Sales card's store has a photo, and the file is there", () => {
    expect(days.length).toBeGreaterThan(0);
    const stores = new Set<string>();
    for (const day of days) {
      for (const c of codesOn(day)) if (c.href) stores.add(c.store);
      for (const s of salesOn(day)) stores.add(s.store);
    }
    expect(stores.size).toBeGreaterThan(20);
    expect([...stores].filter((s) => !storePhoto(s)).sort()).toEqual([]);
    for (const s of stores) expect(existsSync(localFile(storePhoto(s)!)), `${s}: ${STORE_PHOTO_FILES[s]}`).toBe(true);
  });

  it("every Top deals card has its deal's photo, and a local photo file is there", () => {
    const shown = DEAL_DAYS.flatMap((e) => days.flatMap((day) => dealsIn(liveDeals(DEALS, day, STORE_CODES), e.id) as Deal[]));
    expect(shown.length).toBeGreaterThan(10);
    expect([...new Set(shown.filter((d) => !d.image).map((d) => `${d.event}: ${d.brand}`))].sort()).toEqual([]);
    for (const d of shown) if (d.image!.startsWith("/")) expect(existsSync(localFile(d.image!)), `${d.brand}: ${d.image}`).toBe(true);
  });
});
