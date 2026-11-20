/**
 * Gift-guide prices (owner 11-18): "~$24" beside Shop only on a NON-Amazon pick whose price fill_prices.py checked in
 * the last 3 days, and one "Prices as of <day>, may change" note per list. No Amazon pick ever carries or shows a price
 * (Associates rule), checked at the import (scripts/giftGuidePrice.mjs), in the generated chunks and on the page.
 *
 * @mutate scripts/giftGuidePrice.mjs |   if (store === "store-amazon" \|\| hosts.some(isAmazonHost)) return undefined; |   if (store === "store-amazon") return undefined;
 * @mutate scripts/giftGuidePrice.mjs |   if ([p.store, p.retailer, p.brand].some((x) => typeof x === "string" && /^amazon\b/i.test(x.trim()))) return undefined; |   if (false) return undefined;
 * @mutate scripts/giftGuidePrice.mjs |   if (now - at > PRICE_MAX_AGE_DAYS * DAY_MS \|\| at - now > DAY_MS / 24) return undefined; |   if (at - now > DAY_MS / 24) return undefined;
 * @mutate scripts/giftGuidePrice.mjs | p.price_currency !== "USD" \|\| !p.price_source | !p.price_source
 * @mutate src/components/giftGuides/PickPrice.tsx | !/^\d{4}-\d{2}-\d{2}$/.test(pick.priceAt) \|\| isAmazonPick(pick)) return false; | !/^\d{4}-\d{2}-\d{2}$/.test(pick.priceAt)) return false;
 * @mutate src/components/giftGuides/PickPrice.tsx |   return age >= 0 && age <= PRICE_MAX_AGE_DAYS; |   return age >= 0;
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |         <PickPrice pick={pick} /> |         {null}
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |       <PricesAsOf picks={picks.slice(0, upTo)} /> |       {null}
 * @mutate src/content/giftGuideCatalog.ts |     ...(p.price && p.priceAt && store !== "amazon" ? { price: p.price, priceAt: p.priceAt } : {}) }; |     }; void store;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PickChunk } from "@/content/giftGuidePicks";
import { TOP_PICKS } from "@/content/giftGuidePicks";
import { loadAllGuidePicks, type CatalogPick } from "@/content/giftGuideCatalog";

vi.mock("@/components/marketing/PublicHeaderPage", () => ({
  PublicHeaderPage: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
import GiftGuides from "@/pages/info/GiftGuides";
import { PickRow } from "@/pages/info/giftGuides/GiftGuideView";
import { PricesAsOf, showsPrice } from "@/components/giftGuides/PickPrice";
import { verifiedPrice } from "../../scripts/giftGuidePrice.mjs";

afterEach(cleanup);

const CHUNKS: Record<string, PickChunk["picks"]> = Object.fromEntries(
  Object.entries(import.meta.glob<PickChunk>("../content/giftGuidePicks/*.json", { eager: true, import: "default" }))
    .map(([f, c]) => [f.replace(/^.*\/|\.json$/g, ""), c.picks] as const),
);
const AMAZON_HOST = /(^|\.)(amazon\.[a-z.]+|amzn\.to|a\.co)$/;
const NOW = Date.parse("2026-11-18T22:00:00Z");
const checked = { price: "24.99", price_currency: "USD", price_checked_at: "2026-11-18T15:30:00-06:00", price_source: "https://www.walmart.com/ip/1" };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
const ago = (days: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date(Date.now() - days * 86400000));

describe("gift-guide prices: the import keeps only checked, fresh, non-Amazon prices", () => {
  it("a checked Walmart price comes through, rounded nowhere, with its Louisiana check day", () => {
    expect(verifiedPrice(checked, ["walmrt.us", "www.walmart.com"], "store-walmart", NOW)).toEqual({ price: 24.99, priceAt: "2026-11-18" });
    expect(verifiedPrice({ ...checked, price: 12 }, ["www.etsy.com"], "store-etsy", NOW)?.price).toBe(12);
  });
  it("no Amazon pick carries a price: by link host, plain link host, store page, store, retailer or brand", () => {
    expect(verifiedPrice(checked, ["www.amazon.com"], "store-amazon", NOW)).toBeUndefined();
    expect(verifiedPrice(checked, ["amzn.to", ""], null, NOW)).toBeUndefined();
    expect(verifiedPrice(checked, ["shopmy.us", "www.amazon.com"], null, NOW)).toBeUndefined();
    expect(verifiedPrice(checked, ["go.shopmy.us", "a.co"], null, NOW)).toBeUndefined();
    expect(verifiedPrice(checked, ["shopmy.us", ""], "store-amazon", NOW)).toBeUndefined();
    expect(verifiedPrice({ ...checked, retailer: "Amazon" }, ["shopmy.us", ""], null, NOW)).toBeUndefined();
    expect(verifiedPrice({ ...checked, brand: "Amazon Basics" }, ["shopmy.us", ""], null, NOW)).toBeUndefined();
  });
  it("an unchecked, stale, future, non-USD or unparseable price is dropped", () => {
    expect(verifiedPrice({ price: "14.25", price_currency: null, price_checked_at: undefined, price_source: null }, ["mavely.app.link"], "store-mud-pie", NOW)).toBeUndefined();
    expect(verifiedPrice({ ...checked, price_checked_at: "2026-11-14T15:00:00-06:00" }, ["www.walmart.com"], "store-walmart", NOW)).toBeUndefined();
    expect(verifiedPrice({ ...checked, price_checked_at: "2026-11-16T00:00:00-06:00" }, ["www.walmart.com"], "store-walmart", NOW)?.priceAt).toBe("2026-11-16");
    expect(verifiedPrice({ ...checked, price_checked_at: "2026-11-20T15:00:00-06:00" }, ["www.walmart.com"], "store-walmart", NOW)).toBeUndefined();
    expect(verifiedPrice({ ...checked, price_currency: "CAD" }, ["www.walmart.com"], "store-walmart", NOW)).toBeUndefined();
    expect(verifiedPrice({ ...checked, price_source: "" }, ["www.walmart.com"], "store-walmart", NOW)).toBeUndefined();
    expect(verifiedPrice({ ...checked, price: "about 20" }, ["www.walmart.com"], "store-walmart", NOW)).toBeUndefined();
    expect(verifiedPrice({ ...checked, price: "0" }, ["www.walmart.com"], "store-walmart", NOW)).toBeUndefined();
  });
});

describe("gift-guide prices: the generated chunks", () => {
  it("no Amazon pick in any chunk (or the Top 10) carries a price; every price has a check day", () => {
    const all = Object.entries(CHUNKS).flatMap(([slug, picks]) => picks.map((p) => ({ slug, p })));
    expect(Object.keys(CHUNKS).length).toBeGreaterThan(90); // 1120: ~65 guides + 30 store pages
    expect(all.length).toBeGreaterThan(1000);
    for (const { slug, p } of [...all, ...TOP_PICKS.map((p) => ({ slug: "top", p }))]) {
      if (p.price === undefined) continue;
      expect(AMAZON_HOST.test(new URL(p.href).hostname), `${slug}: ${p.name}`).toBe(false);
      expect(p.store, `${slug}: ${p.name}`).not.toBe("store-amazon");
      expect(slug, p.name).not.toBe("store-amazon");
      expect(p.price, p.name).toBeGreaterThan(0);
      expect(p.priceAt ?? "", p.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Amazon keeps its 15 best (owner's 10-15 per store page; lead 11-19, 1530 train).
    expect((CHUNKS["store-amazon"] ?? []).length).toBeGreaterThanOrEqual(10);
    expect((CHUNKS["store-amazon"] ?? []).length).toBeLessThanOrEqual(15);
    expect((CHUNKS["store-amazon"] ?? []).filter((p) => p.price !== undefined)).toEqual([]);
  });
});

const walmart: CatalogPick = { name: "Cozy throw", href: "https://walmrt.us/abc", store: "store-walmart", line: "", price: 24.4, priceAt: today };
const amazon: CatalogPick = { name: "Stanley cup", href: "https://www.amazon.com/dp/B0?tag=louisianahelpr-20", store: "amazon", line: "", price: 30, priceAt: today };
const row = (pick: CatalogPick) => render(<MemoryRouter><ol><PickRow pick={pick} /></ol></MemoryRouter>).container;

describe("gift-guide prices: the page", () => {
  it("a non-Amazon pick shows ~$24 beside Shop; an Amazon pick never shows a price, even one the data carries", () => {
    expect(row(walmart).querySelector("[data-gift-price]")?.textContent).toBe("~$24");
    cleanup();
    expect(row(amazon).querySelector("[data-gift-price]")).toBeNull();
    expect(showsPrice({ ...amazon, store: "store-walmart" })).toBe(false);
    expect(showsPrice({ ...walmart, store: "amazon" })).toBe(false);
  });
  it("a price older than 3 days on the day the page opens is hidden; one note per list, with the oldest day", () => {
    expect(showsPrice({ ...walmart, priceAt: ago(4) })).toBe(false);
    expect(showsPrice({ ...walmart, priceAt: ago(2) })).toBe(true);
    const day = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const { container } = render(<PricesAsOf picks={[walmart, { ...walmart, name: "b", priceAt: ago(1) }, amazon, { ...walmart, name: "c", priceAt: ago(9) }]} />);
    expect(container.querySelectorAll("[data-gift-prices-as-of]").length).toBe(1);
    expect(container.textContent).toBe(`Prices as of ${day(ago(1))}, may change`);
    cleanup();
    expect(render(<PricesAsOf picks={[amazon]} />).container.textContent).toBe("");
  });
});

describe("gift-guide prices: a real guide page", () => {
  it("a guide whose picks carry checked prices shows them beside Shop, with exactly one 'Prices as of' note", async () => {
    await loadAllGuidePicks();
    const priced = Object.entries(CHUNKS).find(([slug, picks]) => !slug.startsWith("store-") && picks.slice(0, 50).filter((p) => p.price !== undefined).length > 3);
    // Inventory floor: the import shipped prices (2,300 priced rows on 2026-11-18).
    expect(priced, "no guide with prices: re-run scripts/gift-guide-picks.mjs after fill_prices.py").toBeTruthy();
    // The page hides a price older than 3 days, so the clock is set to the check day (this test never goes stale).
    const day = priced![1].find((p) => p.priceAt)!.priceAt!;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${day}T18:00:00Z`));
    const { container } = render(
      <MemoryRouter initialEntries={[`/gift-guides/${priced![0]}`]}>
        <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findAllByText(/^~\$\d+$/);
    expect(container.querySelectorAll("[data-gift-price]").length).toBeGreaterThan(0); // one guide per product (owner 11-19)
    expect(container.querySelectorAll("[data-gift-prices-as-of]").length).toBe(1);
    vi.useRealTimers();
  });
});
