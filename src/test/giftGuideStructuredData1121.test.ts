/**
 * Structured data on the live gift guides (lead 11-21, owner pop-up "all of them"): api/share.ts's raw HTML for Her,
 * Him, Kids, the relationship views and the deals page carries a schema.org ItemList. A pick whose card shows a price
 * is a Product with its photo and one Offer at the SAME rounded dollars the card shows (src/lib/pickPriceShown.mjs is
 * the one rule both read); every other pick is a plain ListItem (a Product with no offers, review or rating is an error
 * in Google's Product rules). Never availability, rating or review: we show none of them.
 *
 * @mutate src/lib/seoBodies.mjs |       if (!pickPriceShown(x.price, x.priceAt, today)) return { "@type": "ListItem", position: i + 1, name, url: href }; |       if (!x.price) return { "@type": "ListItem", position: i + 1, name, url: href };
 * @mutate src/lib/seoBodies.mjs |           offers: { "@type": "Offer", price: shownDollars(x.price), priceCurrency: "USD", url: href }, |           offers: { "@type": "Offer", price: x.price, priceCurrency: "USD", url: href },
 * @mutate api/share.ts |       const list = dealsItemListLd(name, seoData()?.deals ?? [], today); |       const list = null;
 * @mutate src/prerender/seoData.ts |       const extra = { ...(p.image ? { image: p.image } : {}), ...(p.price && p.priceAt ? { price: p.price, priceAt: p.priceAt } : {}) }; |       const extra = {};
 * @mutate src/components/giftGuides/PickPrice.tsx | G.priceApprox(shownDollars(pick.price)) | G.priceApprox(Math.ceil(pick.price ?? 0))
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ensureOgShellSnapshot } from "./helpers/ogShellSnapshot";
import { buildSeoData } from "@/prerender/seoData";
import { giftGuideItemListLd, dealsItemListLd } from "@/lib/seoBodies.mjs";
import type { SeoData, SeoGuide } from "@/lib/seoBodies.mjs";
import { pickPriceShown, shownDollars } from "@/lib/pickPriceShown.mjs";
import { blankComments } from "./helpers/blankNonCode";

const ROOT = resolve(__dirname, "..", "..");
const ORIGIN = "https://www.louisianahelpr.com";
let handler: { fetch: (req: Request) => Promise<Response> };
let data: SeoData;
let today: string;

type Ld = Record<string, unknown>;
const jsonLd = (doc: string) => [...doc.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Ld);
const itemList = async (id: string) => {
  const res = await handler.fetch(new Request(`${ORIGIN}/api/share?_og=page&_id=${id}`));
  expect(res.status, id).toBe(200);
  return jsonLd(await res.text()).find((b) => b["@type"] === "ItemList");
};
const elements = (list: Ld | null | undefined) => (list?.itemListElement ?? []) as Ld[];
const products = (list: Ld | undefined) => elements(list).map((e) => e.item as Ld | undefined).filter((p): p is Ld => !!p && p["@type"] === "Product");

beforeAll(async () => {
  ensureOgShellSnapshot(ROOT);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline in this test"); }));
  data = await buildSeoData();
  // The day the newest price was checked: every price checked that day shows (age 0), as on the import's own day.
  const days = Object.values(data.guides).flatMap((g) => g.picks.map((p) => p[3]?.priceAt).filter((d): d is string => !!d)).sort();
  today = days[days.length - 1];
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${today}T18:00:00Z`)); // noon in Louisiana
  vi.doMock(resolve(ROOT, "scripts/generated/seo-data.js"), () => ({ SEO_DATA: data }));
  const sharePath = ["..", "..", "api", "share"].join("/");
  handler = (await import(/* @vite-ignore */ sharePath)).default;
}, 120_000);
afterAll(() => vi.useRealTimers());

describe("the guide ItemList (unit)", () => {
  const guide: SeoGuide = {
    name: "Gifts for Her",
    indexed: true,
    count: 4,
    picks: [
      ["Fresh price", "Amazon", "https://www.amazon.com/dp/X?tag=louisianahelpr-20", { image: "https://m.media-amazon.com/x.jpg", price: 23.6, priceAt: "2026-11-20" }],
      ["Stale price", "ShopMy", "https://go.shopmy.us/p-1", { image: "/gift-guides/c/a.webp", price: 40, priceAt: "2026-11-10" }],
      ["No price", "ShopMy", "https://go.shopmy.us/p-2"],
      ["Local photo", "ShopMy", "https://go.shopmy.us/p-3", { image: "/gift-guides/c/b.webp", price: 0.4, priceAt: "2026-11-21" }],
    ],
  };
  const ld = giftGuideItemListLd("her", guide, "2026-11-21");

  it("marks a priced pick as a Product with one Offer at the card's rounded dollars, and nothing invented", () => {
    const els = elements(ld);
    expect(els).toHaveLength(4);
    expect(els[0]).toEqual({
      "@type": "ListItem",
      position: 1,
      item: { "@type": "Product", name: "Fresh price", url: guide.picks[0][2], image: "https://m.media-amazon.com/x.jpg", offers: { "@type": "Offer", price: 24, priceCurrency: "USD", url: guide.picks[0][2] } },
    });
    // A site photo becomes absolute; a price under $1 reads "~$1" on the card, so $1 here.
    expect(els[3].item).toMatchObject({ image: `${ORIGIN}/gift-guides/c/b.webp`, offers: { price: 1 } });
    const text = JSON.stringify(ld);
    for (const banned of ["aggregateRating", "review", "availability", "ratingValue"]) expect(text).not.toContain(banned);
  });

  it("keeps a pick with no shown price (none, or older than the card allows) a plain ListItem, never a Product", () => {
    const els = elements(ld);
    expect(els[1]).toEqual({ "@type": "ListItem", position: 2, name: "Stale price", url: "https://go.shopmy.us/p-1" });
    expect(els[2]).toEqual({ "@type": "ListItem", position: 3, name: "No price", url: "https://go.shopmy.us/p-2" });
  });

  it("lists only the deals still showing today, as plain ListItems", () => {
    const d = dealsItemListLd("Deals", [["A", "https://a.example/x", ""], ["B", "https://b.example/x", "2026-11-20"], ["C", "javascript:alert(1)", ""]], "2026-11-21");
    expect(elements(d)).toEqual([{ "@type": "ListItem", position: 1, name: "A", url: "https://a.example/x" }]);
    expect(dealsItemListLd("Deals", [], "2026-11-21")).toBeNull();
  });
});

describe("api/share's raw HTML for the live guides", () => {
  const LIVE = ["her", "him", "kids", "mom", "wife", "dad", "husband"];

  it("carries an ItemList of Products whose offers match the cards' shown prices", async () => {
    let totalProducts = 0;
    for (const slug of LIVE) {
      const list = await itemList(`gift-guides/${slug}`);
      expect(list, slug).toBeDefined();
      const g = data.guides[slug];
      const shown = g.picks.filter((p) => pickPriceShown(p[3]?.price, p[3]?.priceAt, today));
      const ps = products(list);
      expect(ps.length, `${slug}: one Product per pick showing a price`).toBe(shown.length);
      for (const [i, p] of shown.entries()) {
        expect(ps[i].name).toBe(p[0]);
        expect((ps[i].offers as Ld).price).toBe(shownDollars(p[3]?.price));
        expect((ps[i].offers as Ld).priceCurrency).toBe("USD");
      }
      totalProducts += ps.length;
    }
    // Inventory floor: the owner's lists carry prices on most picks (measured 2026-11-21).
    expect(totalProducts).toBeGreaterThan(20);
  });

  it("puts an ItemList of the showing deals on the deals page", async () => {
    const list = await itemList("gift-guides/black-friday-cyber-monday");
    expect(elements(list).length).toBeGreaterThan(5);
    expect(products(list)).toHaveLength(0);
  });

  it("the card's price rule is the shared one", () => {
    const src = blankComments(readFileSync(resolve(ROOT, "src/components/giftGuides/PickPrice.tsx"), "utf8"));
    expect(src).toContain("pickPriceShown(pick.price, pick.priceAt, today)");
    expect(src).toContain("G.priceApprox(shownDollars(pick.price))");
  });
});
