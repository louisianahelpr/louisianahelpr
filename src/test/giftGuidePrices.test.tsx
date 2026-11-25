/**
 * Gift-guide prices (owner 11-18): "~$24" beside Shop on a pick whose price was checked in the last 30 days (holiday
 * audit 1121, High: the old 3-day limit blanked every price on Wed Nov 25, Black Friday week), and one
 * "Prices as of <day>, may change" note per list. The researched import (scripts/giftGuidePrice.mjs) still keeps no
 * Amazon price. AMAZON PRICES ON THE OWNER'S LISTS (owner 2026-11-21 ~12:05 PM, "each item also needs a price"; warned
 * in a pop-up that Amazon allows prices only from its PA-API feed and that showing them risks the Associates account,
 * she chose "Show Amazon prices anyway"): every Her, Him and Kids pick, Amazon ones included, carries the price captured
 * from her saved lists, and the page shows it like any other. An Amazon price anywhere else is still refused.
 *
 * @mutate scripts/giftGuidePrice.mjs |   if (store === "store-amazon" \|\| hosts.some(isAmazonHost)) return undefined; |   if (store === "store-amazon") return undefined;
 * @mutate scripts/giftGuidePrice.mjs |   if ([p.store, p.retailer, p.brand].some((x) => typeof x === "string" && /^amazon\b/i.test(x.trim()))) return undefined; |   if (false) return undefined;
 * @mutate scripts/giftGuidePrice.mjs |   if (now - at > PRICE_MAX_AGE_DAYS * DAY_MS \|\| at - now > DAY_MS / 24) return undefined; |   if (at - now > DAY_MS / 24) return undefined;
 * @mutate scripts/giftGuidePrice.mjs | p.price_currency !== "USD" \|\| !p.price_source | !p.price_source
 * @mutate src/components/giftGuides/PickPrice.tsx | => pickPriceShown(pick.price, pick.priceAt, today); | => pick.store !== "amazon" && pickPriceShown(pick.price, pick.priceAt, today);
 * @mutate src/lib/pickPriceShown.mjs |   return age >= 0 && age <= PRICE_MAX_AGE_DAYS; |   return age >= 0;
 * @mutate src/lib/pickPriceShown.mjs | export const PRICE_MAX_AGE_DAYS = 30; | export const PRICE_MAX_AGE_DAYS = 3;
 * @mutate src/pages/info/GiftGuides.tsx | (isOwnerList(guide.slug) \|\| themePage \|\| isDealTheme(guide.slug)) && priced ? { | (isOwnerList(guide.slug) \|\| themePage \|\| isDealTheme(guide.slug)) ? {
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx | <small className="gg-nm-meta"><PickPrice pick={pick} /></small> | <small className="gg-nm-meta">{null}</small>
 * @mutate src/pages/info/giftGuides/GiftGuideView.tsx |       <PricesAsOf picks={picks.slice(0, upTo)} /> |       {null}
 * @mutate src/content/giftGuideCatalog.ts | ...(p.price && p.priceAt ? { price: p.price, priceAt: p.priceAt, ...(p.priceFrom ? { priceFrom: p.priceFrom } : {}) } : {}), | ...(p.price && p.priceAt && store !== "amazon" ? { price: p.price, priceAt: p.priceAt, ...(p.priceFrom ? { priceFrom: p.priceFrom } : {}) } : {}),
 * @mutate scripts/giftGuideHimKids1121.mjs |     const shown = isAmazon(r) ? r.sortPrice : price; |     const shown = isAmazon(r) ? undefined : price;
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import { PRICE_RECHECKS } from "../../scripts/giftGuidePriceRecheck.mjs";
import { AMAZON_PRICES_AT_1124, amazonPrice1124 } from "../../scripts/giftGuideAmazonPrices1124.mjs";
import { HIM_KEEPS_1123, KIDS_KEEPS_1123, HIM_LINKS_1123, HIM_WALMART_1123, KIDS_LINKS_1123 } from "../../scripts/giftGuideHimKids1121.mjs";
import { HER_KEEPS_1123, HER_LINKS_1123 } from "../../scripts/giftGuideHer1121.mjs";
import { KEEPS_PRICE_AT } from "../../scripts/giftGuideOwnerKeeps1123.mjs";
import { HER_ADDS_1124, HIM_ADDS_1124, KIDS_ADDS_1124, OWNER_1124_PRICE_AT, RATE_SWITCHES_1124 } from "../../scripts/giftGuideOwner1124.mjs";
import { AMAZON_BEAUTY_1124_PRICE_AT, HER_AMAZON_BEAUTY_1124 } from "../../scripts/giftGuideAmazonBeauty1124.mjs";
import { HER_OWNER_1125_ROWS } from "../../scripts/giftGuideSteals1124.mjs";
/** Her owner pick 11-25 (the Festive Factory puzzle), priced on Target 11-25. */
const OWNER_1125_HREFS = new Set(HER_OWNER_1125_ROWS.map((r) => r[0]));
import { openPriceSections } from "./helpers/openPriceSections";
import { isThemeGuide } from "@/content/giftGuideLive.mjs";

afterEach(cleanup);

// Her 11-23 keeps (Amazon, and the ShopMy links made later that day), plus the Braun IPL she switched to the device alone
// (owner 11-23 ~12:52 PM "Switch only the Braun", read on amazon.com that day).
/** The 11-24 switches' new links and her Macy's adds, each priced on its store's page that night (scripts/giftGuideOwner1124.mjs). */
const OWNER_1124_HREFS = new Set([...Object.values(RATE_SWITCHES_1124).map((s) => s.href), ...[...HER_ADDS_1124, ...HIM_ADDS_1124, ...KIDS_ADDS_1124, ...HER_AMAZON_BEAUTY_1124].map((r) => r.href)]);
const KEEP_HREFS = new Set([...[...HER_KEEPS_1123, ...HIM_KEEPS_1123, ...KIDS_KEEPS_1123, ...HER_LINKS_1123, ...HIM_LINKS_1123, ...HIM_WALMART_1123, ...KIDS_LINKS_1123].map((r) => r.href), "https://www.amazon.com/dp/B07WYY6KKC?tag=louisianahelpr-20"]);

const CHUNKS: Record<string, PickChunk["picks"]> = Object.fromEntries(
  Object.entries(import.meta.glob<PickChunk>("../content/giftGuidePicks/*.json", { eager: true, import: "default" }))
    .map(([f, c]) => [f.replace(/^.*\/|\.json$/g, ""), c.picks] as const),
);
const AMAZON_HOST = /(^|\.)(amazon\.[a-z.]+|amzn\.to|a\.co)$/;
const NOW = Date.parse("2026-11-18T22:00:00Z");
const checked = { price: "24.99", price_currency: "USD", price_checked_at: "2026-11-18T15:30:00-06:00", price_source: "https://www.walmart.com/ip/1" };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
// Calendar days back from Louisiana's today, counted at noon UTC: subtracting n x 24 h from "now" crossed the Nov 1 DST
// change and, from 11 PM to midnight CST, landed one Louisiana day short (ago(31) read 30 days old and still showed).
const ago = (days: number) => new Date(Date.parse(`${today}T12:00:00Z`) - days * 86400000).toISOString().slice(0, 10);

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

/** The owner's own lists, where every pick (Amazon too) carries her captured price (owner 2026-11-21). */
const OWNER_LISTS = ["her", "him", "kids"];

describe("gift-guide prices: the generated chunks", () => {
  it("an Amazon price only on an owner-saved pick of Her, Him or Kids (or the Top 10's copy of one); every price has a check day", () => {
    const all = Object.entries(CHUNKS).flatMap(([slug, picks]) => picks.map((p) => ({ slug, p })));
    expect(Object.keys(CHUNKS).length).toBeGreaterThan(45); // follow-up 1120: ~30 guides + 26 store pages, measured 2026-11-20
    expect(all.length).toBeGreaterThan(760);
    let amazonPriced = 0;
    for (const { slug, p } of [...all, ...TOP_PICKS.map((p) => ({ slug: "top", p }))]) {
      if (p.price === undefined) continue;
      const amazon = AMAZON_HOST.test(new URL(p.href).hostname) || p.store === "store-amazon";
      if (amazon) {
        amazonPriced++;
        // A themed kids guide (owner 11-24) shows her Amazon finds with their price, like Her, Him and Kids.
        expect(OWNER_LISTS.includes(slug) || isThemeGuide(slug) || (slug === "top" && p.ownerPick === true), `${slug}: ${p.name}`).toBe(true);
        expect(p.ownerPick, `${slug}: ${p.name}`).toBe(true);
      }
      expect(slug, p.name).not.toBe("store-amazon");
      expect(p.price, p.name).toBeGreaterThan(0);
      expect(p.priceAt ?? "", p.name).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    // Two-way: every Her, Him and Kids pick is priced (owner 11-21: "each item also needs a price"); 0 unpriced,
    // and 97 Amazon picks carry a price (20 Her + 37 Him + 40 Kids, measured 2026-11-21).
    for (const slug of OWNER_LISTS) {
      expect(CHUNKS[slug].length, slug).toBeGreaterThan(30);
      // Checked 11-21 (her saves), 11-22 (the picks she sent on launch day, scripts/giftGuideOwnerAdds1122.mjs), 11-23 (her
      // under-$25 keeps, scripts/giftGuideOwnerKeeps1123.mjs, each listed there), 11-24 (the higher-commission switches, her
      // Macy's adds and her steals, scripts/giftGuideOwner1124.mjs; her Amazon beauty picks, scripts/giftGuideAmazonBeauty1124.mjs), or
      // the day a daily re-check read this link at this exact price (scripts/giftGuidePriceRecheck.mjs).
      const rechecked = (p: { href: string; price?: number; priceAt?: string }) => PRICE_RECHECKS[p.href]?.price === p.price && PRICE_RECHECKS[p.href]?.priceAt === p.priceAt;
      // Kids Black Friday sweep 11-24: an Amazon price re-read that day (scripts/giftGuideAmazonPrices1124.mjs), dated that day.
      const reread = (p: { href: string; price?: number; priceAt?: string }) => amazonPrice1124(p.href) === p.price && p.priceAt === AMAZON_PRICES_AT_1124;
      expect(CHUNKS[slug].filter((p) => !(typeof p.price === "number" && p.price > 0 && (p.priceAt === "2026-11-21" || p.priceAt === "2026-11-22" || (p.priceAt === KEEPS_PRICE_AT && KEEP_HREFS.has(p.href)) || (p.priceAt === OWNER_1124_PRICE_AT && OWNER_1124_HREFS.has(p.href)) || (p.priceAt === "2026-11-25" && OWNER_1125_HREFS.has(p.href)) || rechecked(p) || reread(p)))).map((p) => p.name), slug).toEqual([]);
    }
    expect(amazonPriced).toBeGreaterThan(90);
    expect(AMAZON_BEAUTY_1124_PRICE_AT).toBe(OWNER_1124_PRICE_AT);
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
  it("a pick shows ~$24 beside Shop, an Amazon one too (owner 11-21: \"Show Amazon prices anyway\"); no price, none shown", () => {
    expect(row(walmart).querySelector("[data-gift-price]")?.textContent).toBe("~$24");
    cleanup();
    expect(row(amazon).querySelector("[data-gift-price]")?.textContent).toBe("~$30");
    cleanup();
    expect(showsPrice({ ...walmart, store: "amazon" })).toBe(true);
    const unpriced: CatalogPick = { ...amazon, price: undefined };
    expect(row(unpriced).querySelector("[data-gift-price]")).toBeNull();
  });
  it("a price older than 30 days on the day the page opens is hidden; one note per list, with the oldest day", () => {
    expect(showsPrice({ ...walmart, priceAt: ago(31) })).toBe(false);
    expect(showsPrice({ ...walmart, priceAt: ago(29) })).toBe(true);
    expect(showsPrice({ ...walmart, priceAt: ago(4) })).toBe(true);
    const day = (ymd: string) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    const { container } = render(<PricesAsOf picks={[walmart, { ...walmart, name: "b", priceAt: ago(1) }, amazon, { ...walmart, name: "c", priceAt: ago(40) }]} />);
    expect(container.querySelectorAll("[data-gift-prices-as-of]").length).toBe(1);
    expect(container.textContent).toBe(`Prices as of ${day(ago(1))}, may change`);
    cleanup();
    expect(render(<PricesAsOf picks={[{ ...amazon, priceAt: ago(35) }]} />).container.textContent).toBe("");
  });
});

describe("gift-guide prices: Black Friday week (holiday audit 1121, High)", () => {
  // The live lists were all checked 2026-11-21; on the old 3-day limit, 0 of 47 Him rows showed a price on Nov 25.
  const LIVE = ["her", "him", "kids"];
  it("every Her, Him and Kids price checked on its newest day still shows through Cyber Monday and Dec 1", () => {
    for (const slug of LIVE) {
      const picks = CHUNKS[slug] ?? [];
      expect(picks.length, slug).toBeGreaterThan(30); // inventory floor: 36 / 47 / 56 picks on 2026-11-21
      const newest = picks.map((p) => p.priceAt ?? "").sort().slice(-1)[0]!;
      const plus = (n: number) => new Date(Date.parse(`${newest}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
      for (const day of [plus(4), plus(10), plus(14)]) {
        expect(picks.filter((p) => p.priceAt === newest && !showsPrice(p as CatalogPick, day)).map((p) => p.name), `${slug} on ${day}`).toEqual([]);
      }
    }
  });
  it("a list showing no price has no price sort (the sort control is gone, not left over an unpriced list)", async () => {
    await loadAllGuidePicks();
    vi.useFakeTimers({ toFake: ["Date"] });
    const at = (iso: string) => {
      vi.setSystemTime(new Date(iso));
      const r = render(
        <MemoryRouter initialEntries={["/gift-guides/him"]}>
          <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
        </MemoryRouter>,
      );
      const has = r.container.querySelector("[data-gift-sort-button]") !== null;
      cleanup();
      return has;
    };
    expect(at("2026-11-21T18:00:00Z")).toBe(true);
    expect(at("2027-03-01T18:00:00Z")).toBe(false);
    vi.useRealTimers();
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

  it("For Him (owner 11-21, all Amazon but two): every row shows its price, in the order low to high", async () => {
    await loadAllGuidePicks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-24T18:00:00Z")); // the newest check day (11-24 switches and Macy's adds, scripts/giftGuideOwner1124.mjs; was 11-23, the daily re-check)
    const { container } = render(
      <MemoryRouter initialEntries={["/gift-guides/him"]}>
        <Routes><Route path="/gift-guides/:slug" element={<GiftGuides />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findAllByText(/^~\$\d+$/);
    // Him holds all of the owner's men's saves (141, 11-21): the page shows 50 at a time behind "Show more".
    for (let b = screen.queryByRole("button", { name: /^Show more/ }); b; b = screen.queryByRole("button", { name: /^Show more/ })) {
      const more = b;
      act(() => { fireEvent.click(more); });
    }
    openPriceSections(container);
    const rows = [...container.querySelectorAll("li[data-gift-pick]")];
    expect(rows.length).toBe(CHUNKS.him.length);
    const shown = rows.map((li) => li.querySelector("[data-gift-price]")?.textContent ?? "none");
    expect(shown.filter((t) => t === "none")).toEqual([]);
    const dollars = shown.map((t) => Number(t.replace("~$", "")));
    expect(dollars).toEqual([...dollars].sort((a, b) => a - b));
    expect(container.querySelectorAll("[data-gift-prices-as-of]").length).toBe(1);
    vi.useRealTimers();
  });
});
