/**
 * Holiday gift guides audit 1121, polish batch 6 (Audit-Holiday-Guides-PARTIAL-1121.json findings #7, #36, #57, #80,
 * #81). One guard per class, each shown red on the broken state:
 *   - #36 a product photo with a scene behind it is swapped for the same listing's own white-background photo
 *     (Amazon photos are never edited: Associates rules); the 3 with no clean Amazon shot are an exact owner exception
 *     (owner 2026-11-21: "Keep them as they are");
 *   - #7 a budget search ("under $25") lists priced gifts at or under it, cheapest first, never an unpriced or stale
 *     one, each result showing its price; "nurse" opens a live guide;
 *   - #57 the sales and codes read through one cleaner: no cut-off line, no row that is not a sale, no ALL CAPS run,
 *     no "Shop Now" or end date inside the words, brands spelled their way, and no bare "Holiday code";
 *   - #80 the deals copy does not claim each sale was checked by hand;
 *   - #81 every code carries its store link (affiliate, else the plain home page) and its box shows Shop.
 *
 * @mutate src/content/giftGuidePicks/kids.json | 71wfzJhV-aL | 41-YrWLVSgL
 * @mutate src/content/giftGuidePicks/her.json | 814X2uIfEUL | 51F+lcxZoPL
 * @mutate src/content/giftGuideCatalog.ts |     if (budget !== null && !(pickPriceShown(price, priceAt, today) && (price as number) <= budget)) return false; |     if (budget !== null && !pickPriceShown(price, priceAt, today)) return false;
 * @mutate src/content/giftGuideCatalog.ts |   { words: ["nurse", "nurses", "rn", "rns", "lpn", "lpns"], slugs: ["her", "him"] }, |
 * @mutate src/pages/info/giftGuides/GiftGuideShare.tsx |               const dollars = searchItemDollars(item); |               const dollars = null as number \| null;
 * @mutate src/pages/info/giftGuides/GiftGuideDealsAndCodes.tsx | const CLEAN_SALES = cleanSales(SALES); | const CLEAN_SALES = SALES;
 * @mutate src/pages/info/giftGuides/GiftGuideDealsAndCodes.tsx | const CLEAN_DEAL_CODES = cleanCodes(DEAL_CODES); | const CLEAN_DEAL_CODES = DEAL_CODES;
 * @mutate src/lib/giftGuideOfferCopy.mjs |   if (DANGLING.test(s)) return null; |
 * @mutate src/lib/giftGuideOfferCopy.mjs |   if (!IS_OFFER.test(s)) return null; |
 * @mutate src/lib/giftGuideOfferCopy.mjs |   s = unshout(s); |
 * @mutate src/content/giftGuideDeals.mjs |   featuredLine: "Sales from brands you already love, all in one place.", |   featuredLine: "Hand-checked sales from brands you already love, all in one place.",
 * @mutate src/pages/info/giftGuides/GiftGuideDealsAndCodes.tsx |           const shop = list.find((c) => c.href)?.href; |           const shop = undefined as string \| undefined;
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { queryBudget, searchGuides, searchItemDollars, searchItems, type SearchItem } from "@/content/giftGuideCatalog";
import { pickPriceShown } from "@/lib/pickPriceShown.mjs";
import { cleanCodes, cleanOffer, cleanSales } from "@/lib/giftGuideOfferCopy.mjs";
import { DEAL_CODES, SALES } from "@/content/giftGuidePicks";
import { discountCodes } from "@/content/giftGuides";
import { DEALS_WORDS, dealDay } from "@/content/giftGuideDeals.mjs";
import { DealsAndCodes } from "@/pages/info/giftGuides/GiftGuideDealsAndCodes";
import { GiftGuideTools } from "@/pages/info/giftGuides/GiftGuideShare";
import SEARCH_INDEX from "@/content/giftGuideSearchIndex.json";
import her from "@/content/giftGuidePicks/her.json";
import him from "@/content/giftGuidePicks/him.json";
import kids from "@/content/giftGuidePicks/kids.json";

type Pick = { name: string; image?: string };
const live: Record<string, Pick[]> = { her: (her as { picks: Pick[] }).picks, him: (him as { picks: Pick[] }).picks, kids: (kids as { picks: Pick[] }).picks };
const photoOf = (guide: string, name: string) => live[guide].find((p) => p.name === name)?.image ?? "";

describe("holiday audit 1121 #36: no product photo with a scene behind it", () => {
  // Each swapped photo: the same Amazon listing's own white-background image (checked by eye on its gallery contact
  // sheet, ~/.lh-shots/holiday-fixes-1121c/amz/<asin>-sheet.png), never an edited Amazon image.
  const SWAPPED: [guide: string, name: string, was: string, now: string][] = [
    ["her", "Personalized Floral Mama Quarter Zip Sweatshirt", "41LM2AYUzKL", "61ToqsYkTeL"], // collage of five garments
    ["her", "Anoumcy Leopard Barrel Joggers", "51F+lcxZoPL", "814X2uIfEUL"], // read as a camo print
    ["him", "Sperry Authentic Original Boat Shoe", "31w-q2iXR+L", "71pSnCJKOrL"], // filled half its frame
    ["kids", "Handmade Hamster Squishy Toy", "41-YrWLVSgL", "71wfzJhV-aL"], // blue backdrop shape
  ];
  // OWNER EXCEPTION (owner 2026-11-21, pop-up "Keep them as they are", relayed by the lead): these 3 listings have no
  // white-background photo in their gallery (every image is a scene, a model or a boxed tile) and an Amazon photo may
  // not be cut out, so they keep their photo as is. Exact both ways: each is still on its guide with that photo, and no
  // other pick joins the list without the owner.
  const OWNER_KEPT_SCENE_PHOTOS: [guide: string, name: string, photo: string][] = [
    ["her", "Yoosteel Birthstone Bracelet", "51PDHgtzHAL"],
    ["her", "Bedsure Bubble Faux Fur Christmas Throw Blanket", "91HJeXmiufL"],
    ["him", "Rolling Grill Basket Grilling Accessory", "51PJjbtCbVL"],
  ];

  it("shows each swapped pick's white-background photo, and the old scene photo nowhere", () => {
    expect(SWAPPED.length).toBeGreaterThan(3);
    const all = JSON.stringify(live);
    for (const [guide, name, was, now] of SWAPPED) {
      expect(photoOf(guide, name), name).toContain(`/images/I/${now}.`);
      expect(all, name).not.toContain(`/images/I/${was}.`);
    }
  });

  it("keeps exactly the 3 scene photos the owner chose to keep (2026-11-21)", () => {
    for (const [guide, name, photo] of OWNER_KEPT_SCENE_PHOTOS) expect(photoOf(guide, name), name).toContain(`/images/I/${photo}.`);
    expect(OWNER_KEPT_SCENE_PHOTOS).toHaveLength(3);
  });
});

describe("holiday audit 1121 #7: a budget search lists the gifts under it", () => {
  const items = SEARCH_INDEX as SearchItem[];
  const today = "2026-11-22";

  it("the search index carries each priced pick's price and check day", () => {
    const priced = items.filter((r) => typeof r[2] === "number" && typeof r[3] === "string");
    expect(priced.length).toBeGreaterThan(200);
  });

  it("'under $25' lists priced gifts at or under $25, cheapest first", () => {
    expect(queryBudget(["under", "$25"])).toBe(25);
    expect(queryBudget(["4", "year", "old"])).toBeNull();
    for (const q of ["under $25", "gifts under 50", "$15", "pajamas under 40"]) {
      const found = searchItems(items, q, 1000, today);
      expect(found.length, q).toBeGreaterThan(0);
      const cap = queryBudget(q.split(" "))!;
      for (const [name, , price, priceAt] of found) {
        expect(pickPriceShown(price, priceAt, today), `${q}: ${name}`).toBe(true);
        expect(price as number, `${q}: ${name}`).toBeLessThanOrEqual(cap);
      }
      const prices = found.map((r) => r[2] as number);
      expect(prices, q).toEqual([...prices].sort((a, b) => a - b));
    }
    // A price past PRICE_MAX_AGE_DAYS never answers a budget.
    expect(searchItems([["Old Price Thing", "her", 5, "2026-01-01"]], "under $25", 6, today)).toEqual([]);
  });

  it("'nurse' opens a live guide", () => {
    expect(searchGuides("nurse").map((g) => g.slug).filter((s) => ["her", "him"].includes(s)).length).toBeGreaterThan(0);
  });

  it("each item result shows its price", async () => {
    expect(searchItemDollars(["X", "her", 24.4, today], today)).toBe(24);
    render(<MemoryRouter><GiftGuideTools path="/gift-guides" title="Gift guides" /></MemoryRouter>);
    // Search is a magnifier icon until tapped (owner 11-21, "make search an icon always").
    fireEvent.click(screen.getByRole("button", { name: "Search gift guides" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "under $25" } });
    await screen.findAllByText((_, el) => el?.hasAttribute("data-gift-found-item") ?? false);
    const prices = [...document.querySelectorAll("[data-gift-found-price]")].map((e) => e.textContent);
    expect(prices.length).toBeGreaterThan(0);
    for (const p of prices) expect(p).toMatch(/^ · ~\$\d+$/);
  });
});

describe("holiday audit 1121 #57: sales and codes read as human copy", () => {
  const CUT_OFF = /\b(with|of|our|and|the|a|an|for|to|your)$/i;
  const SHOUT = /\b[A-Z]{3,}\b[\s:]+\b[A-Z]{3,}\b/;

  it("the cleaner drops cut-off lines and non-sales and fixes caps, Shop Now, inline end dates and spelling", () => {
    expect(cleanOffer("Theory: Enjoy exclusive savings on soft knits, luxe outerwear, and more of our")).toBeNull();
    expect(cleanOffer("Up to 40% off orders plus a free gift with")).toBeNull();
    expect(cleanOffer("The Gazelle Rhinestone Revival brings eye-catching sparkle to a classic silhouette")).toBeNull();
    expect(cleanOffer("Shop Home favorites every day at Marshalls.com, no Cyber Week coupons needed!")).toBeNull();
    expect(cleanOffer("BLACK FRIDAY SALE: Save up to 60% off on a great selection of home items!")).toBe("Black Friday sale: Save up to 60% off on a great selection of home items");
    expect(cleanOffer("Designer Sale Up to 50% OFF*. Shop Now!")).toBe("Designer Sale Up to 50% off");
    expect(cleanOffer("Save 30% on almost all Monica Vinader styles. Ends 11/30.")).toBe("Save 30% on almost all Monica Vinader styles");
    expect(cleanOffer("Up to 25% off HEYDUDE")).toBe("Up to 25% off HEYDUDE");
    expect(cleanOffer("50% off Battery Doorbell 2K Plus")).toBe("50% off Battery Doorbell 2K Plus");
  });

  it("every sale the page can show is clean", () => {
    const sales = cleanSales(SALES);
    expect(sales.length).toBeGreaterThan(80);
    for (const s of sales) {
      expect(s.offer, s.offer).not.toMatch(CUT_OFF);
      expect(s.offer, s.offer).not.toMatch(SHOUT);
      expect(s.offer, s.offer).not.toMatch(/shop now|ends \d{1,2}\/\d{1,2}|[!]$/i);
      expect(s.store).not.toBe("Lancome");
    }
    expect(sales.length).toBeLessThan(SALES.length);
  });

  it("no code says only 'Holiday code'", () => {
    const codes = cleanCodes(DEAL_CODES);
    expect(codes.length).toBeGreaterThan(2);
    for (const c of codes) expect(c.offer).not.toBe("Holiday code");
  });

  it("the Deals & codes box shows the cleaned words", () => {
    const { container } = render(<MemoryRouter><DealsAndCodes on="2026-11-22" /></MemoryRouter>);
    const allCodes = container.querySelector<HTMLButtonElement>("[data-gift-all-codes]");
    if (allCodes) fireEvent.click(allCodes);
    const text = container.textContent ?? "";
    expect(text.length).toBeGreaterThan(100);
    expect(text).not.toContain("Holiday code");
    expect(text).not.toMatch(/Shop Now|BLACK FRIDAY SALE|no Cyber Week coupons needed/);
  });
});

describe("holiday audit 1121 #80 and #81: deals copy claims and code links", () => {
  it("no deals copy says each sale was checked by hand", () => {
    const words = [DEALS_WORDS.featuredLine, dealDay("black-friday")?.description ?? "", dealDay("cyber-monday")?.description ?? ""].join(" ");
    expect(words.length).toBeGreaterThan(40);
    expect(words).not.toMatch(/hand-checked|checked each/i);
  });

  it("a code whose store has a link opens the store from its box", () => {
    const { container } = render(<MemoryRouter><DealsAndCodes on="2026-11-22" /></MemoryRouter>);
    const allCodes = container.querySelector<HTMLButtonElement>("[data-gift-all-codes]");
    if (allCodes) fireEvent.click(allCodes);
    const shop = container.querySelector<HTMLAnchorElement>(`[data-gift-code-shop="Lands' End"]`);
    expect(shop?.getAttribute("href")).toBe("https://mavely.app.link/1IAq8TqQa8b");
    expect(shop?.getAttribute("rel")).toContain("sponsored");
  });

  // Lead 11-21: every code gets its store link (affiliate, else the brand's plain home page), the owner's own included.
  // @mutate src/content/giftGuides.ts | offer: "10% off; stacks with eligible promotions", href: "https://cookmagnifique.com/" | offer: "10% off; stacks with eligible promotions"
  it("every code we list carries an https store link, and each store box shows Shop", () => {
    const codes = [...discountCodes, ...cleanCodes(DEAL_CODES)];
    expect(codes.length).toBeGreaterThan(15);
    for (const c of codes) expect(c.href, `${c.store} ${c.code}`).toMatch(/^https:\/\/[a-z0-9.-]+\.[a-z]+\//);
    const { container } = render(<MemoryRouter><DealsAndCodes on="2026-11-22" /></MemoryRouter>);
    const allCodes = container.querySelector<HTMLButtonElement>("[data-gift-all-codes]");
    if (allCodes) fireEvent.click(allCodes);
    const boxes = [...container.querySelectorAll("[data-gift-code-store]")];
    expect(boxes.length).toBeGreaterThan(5);
    for (const b of boxes) expect(b.querySelector("[data-gift-code-shop]"), b.getAttribute("data-gift-code-store") ?? "").not.toBeNull();
  });
});
