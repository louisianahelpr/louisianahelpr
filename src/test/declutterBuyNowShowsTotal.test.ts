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
 * A1-B2 (Declutter audit, prod 2026-10-29): the item page said "Buy now ·
 * $32.20 total" while Stripe charged $34.20, because a first purchase also
 * carries the one-time account setup fee (checkout's payCents adds
 * useFirstPayoutFeeCents; declutter-checkout charges total_cents +
 * setup_fee_cents). So every such label also adds the setup fee from that
 * hook, and its file says "+ any one-time setup fee" while the answer is
 * unknown (useFirstPayoutFeeKnown), never a figure $2 low.
 *
 * BuyerTotal (lead-approved, 2026-10-29): ONE shared <BuyerTotal priceCents/>
 * (src/components/declutter/BuyerTotal.tsx) builds every buyer-total figure:
 * the Buy now label, "You pay if the seller says yes", ("Total with pickup", until DB-5 removed its sheet),
 * "You pay with pickup" and the offer What next's "$X for pickup". The class:
 * no bare buyNowTotalCents( in src/components outside it, and every one of
 * those four screens renders it.
 *
 * @mutate src/components/declutter/BuyerTotal.tsx | {formatPrice(buyNowTotalCents(priceCents) + setupFeeCents + addCents)}{suffix} | {formatPrice(priceCents + setupFeeCents + addCents)}{suffix}
 * @mutate src/components/declutter/BuyerTotal.tsx | {formatPrice(buyNowTotalCents(priceCents) + setupFeeCents + addCents)}{suffix} | {formatPrice(buyNowTotalCents(priceCents) + addCents)}{suffix}
 * @mutate src/components/declutter/BuyerTotal.tsx |   const setupFeeCents = useFirstPayoutFeeCents(); |   const setupFeeCents = 0;
 * @mutate src/components/declutter/BuyerTotal.tsx | {!setupFeeKnown && <span data-buy-setup-fee-pending="" | {false && <span data-buy-setup-fee-pending=""
 * @mutate src/components/declutter/DeclutterOffersSection.tsx | burnt-sienna))]"><BuyerTotal priceCents={takeCents} /> | burnt-sienna))]">{takeCents}
 * @mutate src/components/declutter/OfferSentWhatNext.tsx | <BuyerTotal priceCents={cents} className={MONEY} pendingClassName="font-normal" /> | <Money cents={cents} />
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

  it("A1-B2: every Buy-now total adds the first purchase's setup fee, and says so while it is unknown", () => {
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
      // The fee variable must be the checkout hook's answer, not a constant.
      const feeVar = /const\s+(\w+)\s*=\s*useFirstPayoutFeeCents\(\)/.exec(src)?.[1];
      if (!feeVar) { problems.push(`${rel}: no useFirstPayoutFeeCents() read`); continue; }
      for (const m of found) if (!new RegExp(`buyNowTotalCents\\([^()]*\\)\\s*\\+\\s*${feeVar}\\b`).test(m[1])) problems.push(`${rel}: {${m[1]}} leaves out ${feeVar}`);
      const knownVar = /const\s+(\w+)\s*=\s*useFirstPayoutFeeKnown\(\)/.exec(src)?.[1];
      if (!knownVar || !new RegExp(`\\{!${knownVar}\\s*&&\\s*<span[^>]*>[^<]*(setup fee|SETUP_FEE_PENDING_WORDS)`).test(src)) problems.push(`${rel}: no "setup fee" words while useFirstPayoutFeeKnown() is false`);
    }
    expect(labels).toBeGreaterThan(0);
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("the pending words name the setup fee", () => {
    const src = readSource(join(REPO, "src", "components", "declutter", "BuyerTotal.tsx")) ?? "";
    expect(src).toMatch(/SETUP_FEE_PENDING_WORDS = "\+ any one-time setup fee"/);
  });

  it("BuyerTotal: no bare buyNowTotalCents( in src/components outside BuyerTotal.tsx, and the four buyer-total screens use it", () => {
    const files = walkSource([join(REPO, "src", "components")]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
    expect(files.length).toBeGreaterThan(300);
    const bare: string[] = [];
    for (const f of files) {
      const rel = relative(REPO, f);
      if (rel === join("src", "components", "declutter", "BuyerTotal.tsx")) continue;
      const src = blankComments(readSource(f) ?? "");
      if (/\bbuyNowTotalCents\(/.test(src)) bare.push(rel);
    }
    expect(bare, `build the figure with <BuyerTotal priceCents/> instead:\n${bare.join("\n")}`).toEqual([]);
    // The buyer-total screens (lead 2026-10-29): each renders BuyerTotal beside its label.
    const SITES: [string, string][] = [
      ["DeclutterOfferPanel.tsx", "Buy now</span>"],
      ["DeclutterOfferPanel.tsx", "You pay if the seller says yes"],
      // "Total with pickup" left with the Buy now reserve sheet (DB-5, 2026-10-30: Buy now goes straight to checkout).
      // DB-4 (2026-10-30): the way words follow the seller's ticks (pickupWords.ts), so the label is built, not literal.
      ["DeclutterOffersSection.tsx", "You pay {totalPhrase("],
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
