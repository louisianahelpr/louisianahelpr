/**
 * Cowork design audit 2026-10-20, D6: Declutter's "Buy now · $40" showed the
 * bare price, and the buyer met the 5% + 70c fee only at checkout ($42.70).
 * The class: every buy button that names an amount (inventory: every
 * data-buy-total "{...} total" label in src; board 4 made the button two lines,
 * "Buy now" over "$40.60 total"; "with fee" was dropped 2026-10-27, issue #3672:
 * members never see a fee name) names the CHECKOUT total, computed by
 * buyNowTotalCents, which is checkoutAmounts (src/lib/declutter/money.ts, the
 * rule declutter_start_checkout freezes, pinned to the server by
 * money.test.ts and posterJobFee.parity.test.ts), in exact cents (formatPrice, the cart's own formatter: "$42.70", "$28").
 *
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | {formatPrice(buyNowTotalCents(priceCents))} total</span> | {formatPrice(priceCents)} total</span>
 * @mutate src/lib/declutter/money.ts |   return checkoutAmounts([priceCents]).totalCents; |   return priceCents;
 */
import { describe, expect, it } from "vitest";
import { join, relative, resolve } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { walkSource, readSource } from "./helpers/walkSource";
import { buyNowTotalCents, checkoutAmounts } from "@/lib/declutter/money";
import { formatPrice } from "@/lib/declutter/distance";

const REPO = resolve(__dirname, "..", "..");

describe("D6: Buy now names what checkout will charge", () => {
  it("buyNowTotalCents is the checkout total, fee included, exact cents", () => {
    for (const p of [100, 199, 1000, 2550, 4000, 12345, 99999]) {
      expect(buyNowTotalCents(p)).toBe(checkoutAmounts([p]).totalCents);
      expect(buyNowTotalCents(p)).toBe(p + Math.round(p * 0.05) + 70);
    }
    expect(formatPrice(buyNowTotalCents(4000))).toBe("$42.70");
    expect(formatPrice(buyNowTotalCents(2000))).toBe("$21.70");
  });

  it("inventory: every data-buy-total '<amount> total' label in the app prints buyNowTotalCents", () => {
    const files = walkSource([join(REPO, "src")]).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));
    expect(files.length).toBeGreaterThan(500);
    const labels: { file: string; expr: string }[] = [];
    for (const f of files) {
      const src = blankComments(readSource(f) ?? "");
      for (const m of src.matchAll(/data-buy-total=[^>]*>\s*\{([^{}]*(?:\([^{}]*\))?[^{}]*)\}\s*total\b/g)) labels.push({ file: relative(REPO, f), expr: m[1] });
    }
    expect(labels.length).toBeGreaterThan(0);
    const bare = labels.filter((l) => !/buyNowTotalCents\(/.test(l.expr));
    expect(bare, bare.map((b) => `${b.file}: {${b.expr}} total`).join("\n")).toEqual([]);
  });
});
