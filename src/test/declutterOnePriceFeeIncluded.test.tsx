/**
 * Owner 11-27-2026 ~5:20 PM (polish audit #2, "One price, fee included"): every Declutter card, similar item, seller
 * tile, offer tile, map card, the landing grid and the item page show ONE price for a buyer, the total with the buyer
 * fee in it ("$26.95" for a $25 item), and no second "$25 / $26.95 incl. fee" line. Checkout still itemizes. It
 * replaces the 11-07 rule (list price + a small "$X.XX incl. fee" line, PriceInclFee, deleted). The figure is
 * buyNowTotalCents (checkoutAmounts, the rule declutter_start_checkout freezes), so the card always equals checkout.
 *
 * The class, from source: every place in src that prints a live item's price (`itemPriceLabel(x.current_price_cents)`
 * or `formatPrice(x.current_price_cents)`) is a seller-side, trade or share screen listed in NOT_A_BUYER_PRICE with
 * why (exact both ways), or the item page's seller branch (`isSeller ? itemPriceLabel(...)`). Every buyer screen builds
 * its figure with buyerPriceLabel, and no screen draws an "incl. fee" line under a card price any more.
 *
 * @mutate src/components/declutter/BuyerPrice.tsx |   return priceCents > 0 ? oneItemTotalDollars(priceCents) : free; |   return priceCents > 0 ? `$${(priceCents / 100).toFixed(2)}` : free;
 * @mutate src/components/declutter/DeclutterItemCard.tsx |               {buyerPriceLabel(item.current_price_cents)}\n |               {formatPrice(item.current_price_cents)}\n
 * @mutate src/components/declutter/SellingNowRow.tsx | {buyerPriceLabel(it.current_price_cents)}</p> | {itemPriceLabel(it.current_price_cents)}</p>
 * @mutate src/components/landing/FreshDeclutterStrip.tsx |               {buyerPriceLabel(it.current_price_cents)}\n |               {itemPriceLabel(it.current_price_cents)}\n
 * @mutate src/components/declutter/DeclutterItemView.tsx | {isSeller ? itemPriceLabel(it.current_price_cents) : buyerPriceLabel(it.current_price_cents)} | {itemPriceLabel(it.current_price_cents)}
 */
import { describe, expect, it } from "vitest";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { buyerPriceLabel, oneItemTotalDollars } from "@/components/declutter/BuyerPrice";
import { checkoutAmounts } from "@/lib/declutter/money";

const REPO = resolve(__dirname, "..", "..");

/** Files that print a live item's bare list price where no buyer is reading a card price. Exact both ways. */
const NOT_A_BUYER_PRICE: Record<string, string> = {
  "src/components/declutter/DeclutterTakenDown.tsx": "the seller's own taken-down notice",
  "src/components/declutter/DeclutterShareCard.tsx": "share text and the seller's share card (the link opens the item page, which shows the buyer price)",
  "src/components/declutter/DeclutterManageListing.tsx": "the seller's own listing tools",
  "src/components/declutter/DeclutterWantedReplies.tsx": "a seller picking one of their own listings to answer a Wanted post",
  "src/components/declutter/DeclutterTradeOffers.tsx": "a trade: both items are $0 lines, no fee is charged",
  "src/components/declutter/DeclutterOfferTrade.tsx": "a trade picker of the buyer's own listings: no fee is charged",
  "src/components/declutter/DeclutterBundleRequests.tsx": "a bundle request picker: the seller prices the bundle afterwards, so no item total is charged as shown",
  "src/components/declutter/DeclutterOffersSection.tsx": "an offer row: offers are pre-fee amounts, and the buyer's total there is BuyerTotal",
};

/** The buyer screens the owner named (and the screens that show the same listing price): each builds buyerPriceLabel. */
const BUYER_SCREENS = [
  "src/components/declutter/DeclutterItemCard.tsx",
  "src/components/declutter/DeclutterItemView.tsx",
  "src/components/declutter/DeclutterMap.tsx",
  "src/components/declutter/MovingSaleBanner.tsx",
  "src/components/declutter/SellingNowRow.tsx",
  "src/components/declutter/DeclutterWatching.tsx",
  "src/components/landing/FreshDeclutterStrip.tsx",
  "src/pages/u/PublicProfilePage.tsx",
  "src/pages/home/homeDashboard/ForSaleNearYou.tsx",
  "src/pages/search/SearchPage.tsx",
];

function tsxFiles(): string[] {
  const files = walkSource([join(REPO, "src")]).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));
  expect(files.length).toBeGreaterThan(500);
  return files;
}

describe("owner 11-27: Declutter shows one price, fee included", () => {
  it("the figure is the checkout total for one item, exact cents; a free item says Free", () => {
    for (const p of [300, 500, 1000, 1999, 2500, 4000, 12345]) {
      expect(buyerPriceLabel(p)).toBe(`$${(checkoutAmounts([p]).totalCents / 100).toFixed(2)}`);
      expect(oneItemTotalDollars(p)).toBe(buyerPriceLabel(p));
    }
    // The owner's own example: $25 -> $26.95 (5% + 70c).
    expect(buyerPriceLabel(2500)).toBe("$26.95");
    expect(buyerPriceLabel(0)).toBe("Free");
    expect(buyerPriceLabel(0, "Gratis")).toBe("Gratis");
  });

  it("inventory: no buyer screen prints a live item's bare list price", () => {
    const bare: string[] = [];
    const hitExempt = new Set<string>();
    let sites = 0;
    for (const f of tsxFiles()) {
      const rel = relative(REPO, f).split("\\").join("/");
      const src = blankComments(readSource(f) ?? "");
      for (const m of src.matchAll(/\b(?:itemPriceLabel|formatPrice)\(\w+(?:\.\w+)*\.current_price_cents\)/g)) {
        sites++;
        if (rel in NOT_A_BUYER_PRICE) { hitExempt.add(rel); continue; }
        // The item page's seller branch: the seller reads their own list price, with "Buyers pay $X with the fee" under it.
        if (/isSeller \? $/.test(src.slice(Math.max(0, m.index! - 11), m.index!))) continue;
        bare.push(`${rel}: ${m[0]}`);
      }
    }
    expect(sites).toBeGreaterThan(8);
    expect(bare, `show buyerPriceLabel(...) instead:\n${bare.join("\n")}`).toEqual([]);
    expect([...hitExempt].sort(), "NOT_A_BUYER_PRICE has an entry nobody hits").toEqual(Object.keys(NOT_A_BUYER_PRICE).sort());
  });

  it("every buyer screen builds its price with buyerPriceLabel, and none draws a second incl.-fee line", () => {
    for (const rel of BUYER_SCREENS) {
      const src = blankComments(readSource(join(REPO, rel)) ?? "");
      expect(src, `${rel} lost buyerPriceLabel`).toMatch(/\bbuyerPriceLabel\(/);
    }
    const twoPrices: string[] = [];
    for (const f of tsxFiles()) {
      const src = blankComments(readSource(f) ?? "");
      if (/<PriceInclFee\b|data-price-incl-fee|"ip\.inclFee"/.test(src)) twoPrices.push(relative(REPO, f));
    }
    expect(twoPrices, twoPrices.join("\n")).toEqual([]);
  });

  // @mutate src/components/declutter/DeclutterOfferPanel.tsx | data-offer-chip-amount="">{oneItemTotalDollars(chip)}</span> | data-offer-chip-amount="">{formatPrice(chip)}</span><span>{oneItemTotalDollars(chip)} incl. fee</span>
  it("offer tiles show one figure, the buyer's total with the fee in it", () => {
    const src = blankComments(readSource(join(REPO, "src/components/declutter/DeclutterOfferPanel.tsx")) ?? "");
    const at = src.indexOf("data-offer-chip={pct}");
    expect(at).toBeGreaterThan(-1);
    const tile = src.slice(at, src.indexOf("</ChoicePill>", at));
    expect(tile).toContain('data-offer-chip-amount="">{oneItemTotalDollars(chip)}</span>');
    expect(tile.match(/(?<!\$)\{(?:formatPrice|oneItemTotalDollars)\(chip\)\}/g)).toHaveLength(1);
  });
});
