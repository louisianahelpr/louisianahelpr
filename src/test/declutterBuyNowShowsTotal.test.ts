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
 *
 * A1-B2 (2026-10-29) added a first purchase's one-time setup fee to every such
 * label. Owner 2026-11-20: a Declutter purchase never carries the setup fee
 * (declutter_start_checkout freezes setup_fee_cents = 0), so no label adds it
 * or names it, even for a member who still owes it for Jobs.
 *
 * BuyerTotal (lead-approved, 2026-10-29): ONE shared <BuyerTotal priceCents/>
 * (src/components/declutter/BuyerTotal.tsx) builds every buyer-total figure:
 * the Buy now label, "You pay if the seller says yes", ("Total with pickup", until DB-5 removed its sheet),
 * "You pay with pickup" and the offer What next's "$X for pickup". The class:
 * no bare buyNowTotalCents( in src/components outside it, and every one of
 * those four screens renders it.
 *
 * @mutate src/components/declutter/BuyerTotal.tsx | {formatPrice(buyNowTotalCents(priceCents) + addCents)}{suffix} | {formatPrice(priceCents + addCents)}{suffix}
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | burnt-sienna))]"><BuyerTotal priceCents={takeCents} /> | burnt-sienna))]">{takeCents}
 * @mutate src/components/declutter/OfferSentWhatNext.tsx | <BuyerTotal priceCents={cents} className={MONEY} /> | <Money cents={cents} />
 * @mutate src/components/declutter/DeclutterOfferPanel.tsx | <BuyerTotal priceCents={cents} /> | {cents}
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

  it("inventory: every data-buy-total '<amount>' figure in the app prints buyNowTotalCents", () => {
    const files = walkSource([join(REPO, "src")]).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));
    expect(files.length).toBeGreaterThan(500);
    const labels: { file: string; expr: string }[] = [];
    for (const f of files) {
      const src = blankComments(readSource(f) ?? "");
      for (const m of src.matchAll(/data-buy-total=[^>]*>\s*\{([^{}]*(?:\([^{}]*\))?[^{}]*)\}/g)) labels.push({ file: relative(REPO, f), expr: m[1] });
    }
    expect(labels.length).toBeGreaterThan(0);
    const bare = labels.filter((l) => !/buyNowTotalCents\(/.test(l.expr));
    expect(bare, bare.map((b) => `${b.file}: {${b.expr}}`).join("\n")).toEqual([]);
  });

  it("owner 2026-11-20: no Buy-now total adds or names the setup fee", () => {
    const files = walkSource([join(REPO, "src")]).filter((f) => /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f));
    expect(files.length).toBeGreaterThan(500);
    const problems: string[] = [];
    let labels = 0;
    for (const f of files) {
      const src = blankComments(readSource(f) ?? "");
      const found = [...src.matchAll(/data-buy-total=[^>]*>\s*\{([^{}]*(?:\([^{}]*\))?[^{}]*)\}/g)];
      if (found.length === 0) continue;
      labels += found.length;
      const rel = relative(REPO, f);
      if (/useFirstPayoutFee(?:Cents|Known)\(|setup.fee/i.test(src)) problems.push(`${rel}: reads or names the setup fee`);
    }
    expect(labels).toBeGreaterThan(0);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("BuyerTotal: no bare buyNowTotalCents( in src/components outside BuyerTotal.tsx, and the four buyer-total screens use it", () => {
    const files = walkSource([join(REPO, "src", "components")]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(300);
    const bare: string[] = [];
    for (const f of files) {
      const rel = relative(REPO, f);
      if (rel === join("src", "components", "declutter", "BuyerTotal.tsx")) continue;
      // Owner 11-27: the cards' one price (fee included) is the one-item total WITHOUT the per-account setup fee (lead
      // 11-07), on purpose; guarded by src/test/declutterOnePriceFeeIncluded.test.tsx. It is not a Buy-now figure.
      if (rel === join("src", "components", "declutter", "BuyerPrice.tsx")) continue;
      const src = blankComments(readSource(f) ?? "");
      if (/\bbuyNowTotalCents\(/.test(src)) bare.push(rel);
    }
    expect(bare, `build the figure with <BuyerTotal priceCents/> instead:\n${bare.join("\n")}`).toEqual([]);
    // The buyer-total screens (lead 2026-10-29): each renders BuyerTotal beside its label.
    const SITES: [string, string][] = [
      ["DeclutterOfferPanel.tsx", '<span className="sr-only">{t("decl.buy.now")} ·</span>'],
      ["DeclutterOfferPanel.tsx", '{t("offer.youPayIfYes")}'],
      // "Total with pickup" left with the Buy now reserve sheet (DB-5, 2026-10-30: Buy now goes straight to checkout).
      // DB-4 (2026-10-30): the way words follow the seller's ticks (pickupWords.ts), so the label is built, not literal.
      ["DeclutterOffersSection.tsx", '{t("dof.youPay", { phrase: totalPhrase('],
      ["OfferSentWhatNext.tsx", "{forPhrase(way)}"],
    ];
    for (const [file, label] of SITES) {
      const src = blankComments(readSource(join(REPO, "src", "components", "declutter", file)) ?? "");
      const at = src.indexOf(label);
      expect(at, `${file}: "${label}" not found`).toBeGreaterThan(-1);
      const near = src.slice(Math.max(0, at - 160), at + 260);
      expect(near, `${file}: "${label}" is not built by <BuyerTotal`).toMatch(/<BuyerTotal\s+priceCents=/);
    }
  });
});
