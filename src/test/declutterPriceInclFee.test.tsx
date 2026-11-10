/**
 * Owner 11-07 ~5:10 PM (Vinted review, Declutter only): every Declutter card and the item page show the item price
 * with a small "$X.XX incl. fee" line under it ("$3.00" with "$3.85 incl. fee"), built by the SAME rule checkout
 * charges (buyNowTotalCents = checkoutAmounts, which declutter_start_checkout freezes), so the two never disagree.
 * Free items show only "Free".
 *
 * The class, from source: every place in src that prints a live item's price for a buyer
 * (`itemPriceLabel(<x>.current_price_cents)` in JSX) renders <PriceInclFee priceCents={<x>.current_price_cents}/>
 * beside it (right after it, or, since owner pick 2 of 11-08 made the incl.-fee price the bold one on Browse cards,
 * right before it with the base price small and grey after), unless the file is in NOT_A_BUYER_PRICE below with why (seller's own screens, share text, a
 * screen-reader label). That list is exact both ways.
 *
 * @mutate src/components/declutter/PriceInclFee.tsx | {exactDollars(buyNowTotalCents(priceCents))}{" "} | {exactDollars(priceCents)}{" "}
 * @mutate src/components/declutter/PriceInclFee.tsx |   if (!(priceCents > 0)) return null; |   if (priceCents < 0) return null;
 * @mutate src/components/declutter/DeclutterItemCard.tsx | <PriceInclFee priceCents={item.current_price_cents} className={`text-ds-11 | <PriceInclFee priceCents={item.price_cents} className={`text-ds-11
 * @mutate src/components/declutter/DeclutterItemView.tsx |             <PriceInclFee priceCents={it.current_price_cents} | {null}            <PriceInclFee priceCents={0}
 * @mutate src/components/declutter/MovingSaleBanner.tsx | <PriceInclFee priceCents={it.current_price_cents} className="block text-ds-12 font-medium tabular-nums text-muted-foreground" /> | {null}
 */
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { PriceInclFee } from "@/components/declutter/PriceInclFee";
import { checkoutAmounts } from "@/lib/declutter/money";

const REPO = resolve(__dirname, "..", "..");

/** Files that print a live item's price where no buyer is deciding to pay it. Exact both ways. */
const NOT_A_BUYER_PRICE: Record<string, string> = {
  "src/components/declutter/DeclutterTakenDown.tsx": "the seller's own taken-down notice",
  "src/components/declutter/DeclutterShareCard.tsx": "share text and the seller's share card (the link opens the item page, which shows it)",
  "src/components/declutter/DeclutterManageListing.tsx": "the seller's own listing tools",
  "src/components/declutter/DeclutterWantedReplies.tsx": "a seller picking one of their own listings to answer a Wanted post",
  "src/components/declutter/DeclutterTradeOffers.tsx": "a trade: both items are $0 lines, no fee is charged",
  "src/components/declutter/DeclutterBundleRequests.tsx": "a bundle request picker: the seller prices the bundle afterwards, so no item total is charged as shown",
};

function sites(): { file: string; at: number; who: string; src: string }[] {
  const files = walkSource([join(REPO, "src")]).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));
  expect(files.length).toBeGreaterThan(500);
  const out: { file: string; at: number; who: string; src: string }[] = [];
  for (const f of files) {
    const src = blankComments(readSource(f) ?? "");
    // In JSX ({itemPriceLabel(x.current_price_cents)}), not inside a template string or an aria label.
    for (const m of src.matchAll(/(?<!\$)\{itemPriceLabel\((\w+(?:\.\w+)*)\.current_price_cents\)\}/g)) {
      out.push({ file: relative(REPO, f).split("\\").join("/"), at: m.index!, who: m[1], src });
    }
  }
  return out;
}

describe("owner 11-07: Declutter prices show the buyer's price incl. fee", () => {
  it("the figure is the checkout total for one item, exact cents; free shows nothing extra", () => {
    for (const p of [300, 500, 1000, 1999, 4000, 12345]) {
      const { container, unmount } = render(<PriceInclFee priceCents={p} />);
      const want = `$${(checkoutAmounts([p]).totalCents / 100).toFixed(2)} incl. fee`;
      expect(container.querySelector("[data-price-incl-fee]")?.textContent).toBe(want);
      unmount();
    }
    // The owner's own example: $3.00 -> $3.85.
    const { container } = render(<PriceInclFee priceCents={300} />);
    expect(container.textContent).toBe("$3.85 incl. fee");
    const free = render(<PriceInclFee priceCents={0} />);
    expect(free.container.innerHTML).toBe("");
  });

  it("inventory: every buyer-facing live price renders <PriceInclFee> for the same item beside it", () => {
    const all = sites();
    expect(all.length).toBeGreaterThan(8);
    const missing: string[] = [];
    const hitExempt = new Set<string>();
    const covered = new Set<string>();
    for (const s of all) {
      if (s.file in NOT_A_BUYER_PRICE) { hitExempt.add(s.file); continue; }
      // Beside it: within 900 characters after the price, or before it (owner pick 2, 11-08: the card leads with it).
      const after = s.src.slice(Math.max(0, s.at - 900), s.at + 900);
      const esc = s.who.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`<PriceInclFee\\s+priceCents=\\{${esc}\\.current_price_cents\\}`).test(after)) covered.add(s.file);
      else missing.push(`${s.file}: ${s.who}.current_price_cents has no <PriceInclFee> beside it`);
    }
    expect(missing, missing.join("\n")).toEqual([]);
    expect([...hitExempt].sort(), "NOT_A_BUYER_PRICE has an entry nobody hits").toEqual(Object.keys(NOT_A_BUYER_PRICE).sort());
    for (const f of [
      "src/components/declutter/DeclutterItemCard.tsx",
      "src/components/declutter/DeclutterItemView.tsx",
      "src/components/declutter/DeclutterMap.tsx",
      "src/components/declutter/MovingSaleBanner.tsx",
      "src/components/declutter/SellingNowRow.tsx",
      "src/components/landing/FreshDeclutterStrip.tsx",
    ]) expect(covered.has(f), `${f} lost its incl. fee line`).toBe(true);
  });

  // Owner 11-09 (10:35 PM, reverses owner pick 2 of 11-08): the LIST price is the big one and "$X.XX incl. fee" sits
  // UNDER it, smaller, on the item page and every card/strip. The class, from the same inventory: at every buyer-facing
  // site the list price comes first, and its <PriceInclFee> is never bold and never splits off a loud "incl. fee" label.
  // @mutate src/components/declutter/SellingNowRow.tsx | <PriceInclFee priceCents={it.current_price_cents} className="block text-ds-12 font-medium tabular-nums text-muted-foreground" /> | <PriceInclFee priceCents={it.current_price_cents} className="block text-ds-14 font-bold tabular-nums text-foreground" />
  it("the list price comes first and is the loud one; the incl.-fee line under it is small", () => {
    const all = sites().filter((s) => !(s.file in NOT_A_BUYER_PRICE));
    expect(all.length).toBeGreaterThan(6);
    const wrong: string[] = [];
    const files = new Set<string>();
    // Every <PriceInclFee> beside a list-price site: the nearest list price for the same item sits BEFORE it.
    const seen = new Set<string>();
    for (const s of all) {
      const esc = s.who.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const tagRe = new RegExp(`<PriceInclFee\\s+priceCents=\\{${esc}\\.current_price_cents\\}([^>]*)/>`, "g");
      for (const t of s.src.matchAll(tagRe)) {
        if (Math.abs(t.index! - s.at) >= 900 || seen.has(`${s.file}@${t.index}`)) continue;
        seen.add(`${s.file}@${t.index}`);
        files.add(s.file);
        const before = all.some((o) => o.file === s.file && o.who === s.who && o.at < t.index! && t.index! - o.at < 900);
        if (!before) wrong.push(`${s.file}: the incl.-fee price comes before the list price`);
        if (/\bfont-bold\b/.test(t[1])) wrong.push(`${s.file}: the incl.-fee price is bold`);
        if (/wordsClassName/.test(t[1])) wrong.push(`${s.file}: "incl. fee" is its own loud label`);
      }
    }
    expect(wrong, wrong.join("\n")).toEqual([]);
    expect(files.size).toBeGreaterThanOrEqual(7);
  });
});
