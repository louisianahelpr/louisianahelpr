/**
 * Q2082 (a), owner pop-up 2026-10-18 ("J3"): when a refund keeps the card fee
 * or a late-cancel fee, the sales tax Stripe attributes to that kept part is
 * kept from the refund too. We never pay it.
 *
 * Stripe Tax reverses a refund's tax in proportion to what the refund returns
 * (Checkout refunds, and the flat-amount reversal _visitTaxReversal.ts makes for
 * a recurring visit), so after a refund R of a charge T that carried tax X the
 * tax still collected is X x (T - R) / T. These tests prove, for every cent
 * amount in a sweep, that the extra amount refundToPayerCents keeps is never
 * less than the tax Stripe leaves collected on what is kept (we never pay it)
 * and never more than that plus one cent (the poster is not overcharged).
 *
 * Every refund path that prices with refundToPayerCents must hand it the
 * charge's tax: the inventory below reads every call from source and fails on
 * one that passes no `taxCents`.
 *
 * @mutate supabase/functions/_shared/refundAmount.ts |   const ceilingCents = Math.max(0, captured - keptCents - taxKeptCents); |   const ceilingCents = Math.max(0, captured - keptCents);
 * @mutate supabase/functions/_shared/refundAmount.ts |   return Math.min(tax, Math.ceil((kept * tax) / (captured - tax))); |   return Math.min(tax, Math.floor((kept * tax) / captured));
 * @mutate supabase/functions/_shared/refundAmount.ts |   if (typeof t === "number" && Number.isFinite(t) && t > 0) return cents(t); |   if (typeof t === "number" && Number.isFinite(t)) return cents(t);
 * @mutate supabase/functions/_shared/refundAmount.ts |     return cents(page?.data?.[0]?.total_details?.amount_tax ?? 0); |     return 0;
 * @mutate supabase/functions/_shared/refundAmount.ts |   const keptInBase = Math.max(0, keptCents - (captured - taxBase)); |   const keptInBase = keptCents;
 * @mutate supabase/functions/create-payment/index.ts |             alreadyRefundedCents,\n            taxCents: await chargeTaxCentsFor(stripe, pi), |             alreadyRefundedCents,
 * @mutate supabase/functions/void-cancelled-payments/index.ts |               alreadyRefundedCents: chargeRefundedCents,\n              taxCents: await chargeTaxCentsFor(stripe, pi), |               alreadyRefundedCents: chargeRefundedCents, taxCents: 0,
 * @mutate supabase/functions/_shared/posterCancelSplit.ts |     alreadyRefundedCents: c.alreadyRefundedCents,\n    taxCents: c.taxCents, |     alreadyRefundedCents: c.alreadyRefundedCents,
 */
import { describe, it, expect } from "vitest";
import { readFileSync, statSync } from "node:fs";
// Outside src/ it is node's own readdirSync (src/test/noSrcDirectoryWalksInTests.test.ts).
import { readdirSync } from "./helpers/trackedFiles";
import { join } from "node:path";
import { blankComments } from "./helpers/blankNonCode";
import { chargeTaxCents, chargeTaxCentsFor, refundToPayerCents, taxOnKeptCents } from "../../supabase/functions/_shared/refundAmount";

/** What Stripe leaves collected after refunding `refund` of a charge `captured` that carried `tax` (proportional reversal). */
function taxLeftCollected(captured: number, tax: number, refund: number): number {
  return (tax * (captured - refund)) / captured;
}

describe("a refund keeps the tax on what it keeps (owner, 2026-10-18)", () => {
  it("a $100 taxable job at 10.45%: the card fee's tax is kept, the rest of the tax comes back", () => {
    // budget 10000 + fee 570 taxed at 10.45% = 1105 tax; captured 11675.
    const r = refundToPayerCents({ capturedCents: 11675, actualFeeCents: 369, customerFeeCents: 0, taxCents: 1105 });
    expect(r.feeKeptCents).toBe(369);
    expect(r.taxKeptCents).toBe(Math.ceil((369 * 1105) / (11675 - 1105)));
    expect(r.taxKeptCents).toBe(39);
    expect(r.refundCents).toBe(11675 - 369 - 39);
    expect(taxLeftCollected(11675, 1105, r.refundCents)).toBeLessThanOrEqual(r.taxKeptCents);
  });

  it("a late-cancel fee and a setup fee carry their tax too", () => {
    const r = refundToPayerCents({ capturedCents: 6000, actualFeeCents: 200, setupFeeCents: 200, otherKeptCents: 1000, taxCents: 500 });
    const kept = 200 + 200 + 1000;
    expect(r.taxKeptCents).toBe(Math.ceil((kept * 500) / 5500));
    expect(r.ceilingCents).toBe(6000 - kept - r.taxKeptCents);
  });

  it("an untaxed charge keeps nothing extra (unchanged from before)", () => {
    const r = refundToPayerCents({ capturedCents: 2606, actualFeeCents: 106, taxCents: 0 });
    expect(r.taxKeptCents).toBe(0);
    expect(r.refundCents).toBe(2500);
    expect(refundToPayerCents({ capturedCents: 2606, actualFeeCents: 106 }).refundCents).toBe(2500);
  });

  it("sweep: never less than the tax Stripe leaves collected, never a cent more", () => {
    let n = 0;
    for (let captured = 500; captured <= 200000; captured += 997) {
      for (const rate of [0.0445, 0.0945, 0.1145, 0.15]) {
        const tax = Math.round((captured / (1 + rate)) * rate);
        for (const kept of [1, 60, 300, 1234, Math.floor(captured / 3)]) {
          if (kept >= captured - tax) continue;
          const r = refundToPayerCents({ capturedCents: captured, actualFeeCents: kept, taxCents: tax });
          const left = taxLeftCollected(captured, tax, r.refundCents);
          expect(r.taxKeptCents).toBeGreaterThanOrEqual(left - 1e-9);
          expect(r.taxKeptCents).toBeLessThanOrEqual(left + 1);
          expect(r.refundCents + r.feeKeptCents + r.taxKeptCents).toBe(captured);
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(3000);
  });

  it("never keeps more than the tax, nor more than the charge", () => {
    expect(taxOnKeptCents({ keptCents: 100000, taxCents: 50, capturedCents: 1000 })).toBe(50);
    expect(taxOnKeptCents({ keptCents: 10, taxCents: 1000, capturedCents: 1000 })).toBe(0);
    const r = refundToPayerCents({ capturedCents: 1000, actualFeeCents: 990, taxCents: 100 });
    expect(r.refundCents).toBe(0);
    expect(r.feeKeptCents + r.taxKeptCents).toBeLessThanOrEqual(1000);
  });

  it("chargeTaxCents reads the PI's own tax figure when above 0, else the stored visit tax", () => {
    // Shape read on test-mode pi_3URoagKp2H4b7tEC0kssV30f (2026-10-18) by a newer API version than the edge's basil.
    expect(chargeTaxCents({ amount_details: { tax: { total_tax_amount: 263 } } })).toBe(263);
    // A 0 on the PI is no figure (lh-money-escrow review of 461a6b724 #4): the stored visit tax wins.
    expect(chargeTaxCents({ amount_details: { tax: { total_tax_amount: 0 } } }, 50)).toBe(50);
    expect(chargeTaxCents({ amount_details: {} }, 87)).toBe(87);
    expect(chargeTaxCents(null)).toBe(0);
    expect(chargeTaxCents({}, null)).toBe(0);
  });

  it("chargeTaxCentsFor asks the Checkout Session (basil PIs carry no tax), and keeps no tax when it cannot", async () => {
    const lister = (amount_tax: number | null, fail = false) => ({
      checkout: { sessions: { list: async (p: { payment_intent: string; limit: number }) => {
        if (fail) throw new Error("stripe down");
        expect(p).toEqual({ payment_intent: "pi_1", limit: 1 });
        return { data: [{ total_details: { amount_tax } }] };
      } } },
    });
    expect(await chargeTaxCentsFor(lister(1105), { id: "pi_1", amount_details: { tip: {} } })).toBe(1105);
    expect(await chargeTaxCentsFor(lister(0), { id: "pi_1" })).toBe(0);
    expect(await chargeTaxCentsFor(lister(null), { id: "pi_1" })).toBe(0);
    expect(await chargeTaxCentsFor(lister(1105, true), { id: "pi_1" })).toBe(0);
    expect(await chargeTaxCentsFor({ checkout: { sessions: { list: async () => ({ data: [] }) } } }, { id: "pi_1" })).toBe(0);
    // The PI's own figure wins without a read.
    expect(await chargeTaxCentsFor(lister(1, true), { id: "pi_1", amount_details: { tax: { total_tax_amount: 263 } } })).toBe(263);
  });

  it("a legacy recurring visit: only the kept part inside the taxed labor carries tax (review of 461a6b724 #3)", () => {
    // labor 10000 + tax 945 taxed; a 500 card-cost fee line outside it; Stripe's fee 350 kept.
    const r = refundToPayerCents({ capturedCents: 11445, actualFeeCents: 350, taxCents: 945, taxBaseCents: 10945 });
    expect(r.taxKeptCents).toBe(0);
    expect(r.refundCents).toBe(11445 - 350);
    // Kept 700: 200 of it lies inside the taxed part.
    const s = refundToPayerCents({ capturedCents: 11445, actualFeeCents: 700, taxCents: 945, taxBaseCents: 10945 });
    expect(s.taxKeptCents).toBe(Math.ceil((200 * 945) / 10000));
  });

  it("a poster-fee recurring visit: its fee line is inside the tax transaction, so the base includes it (delta review of 2e397597d #1)", () => {
    // labor 10000 + poster fee 570, taxed together at ~9.45% = 999 tax; Stripe's fee 369.
    const r = refundToPayerCents({ capturedCents: 11569, actualFeeCents: 369, taxCents: 999, taxBaseCents: 10000 + 570 + 999 });
    expect(r.taxKeptCents).toBe(Math.ceil((369 * 999) / 10570));
    expect(r.taxKeptCents).toBeGreaterThan(0);
  });
});

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("every refundToPayerCents call that prices a refund passes the charge's tax", () => {
  // Calls that only read nonRefundableCents (the card fee + setup), never a
  // refund amount, so the tax on the kept part does not apply. EXACT both ways.
  // @two-way src/test/refundKeepsTaxOnKeptAmounts.test.ts:expect(missing).toEqual(NO_TAX_NEEDED)
  const NO_TAX_NEEDED: Record<string, number> = {
    // cardNonRefundableCents: prices a gift's shortfall from the card fee alone.
    "supabase/functions/void-cancelled-payments/index.ts": 1,
  };

  it("inventory", () => {
    const root = join(__dirname, "..", "..");
    const files = walk(join(root, "supabase", "functions")).filter((f) => !f.includes("/_shared/refundAmount.ts"));
    expect(files.length).toBeGreaterThan(200);
    const missing: Record<string, number> = {};
    let calls = 0;
    for (const f of files) {
      const src = blankComments(readFileSync(f, "utf8"));
      let i = src.indexOf("refundToPayerCents(");
      while (i !== -1) {
        // the argument object, up to the matching close paren
        let depth = 0;
        let j = i + "refundToPayerCents".length;
        for (; j < src.length; j++) {
          if (src[j] === "(") depth++;
          else if (src[j] === ")") { depth--; if (depth === 0) break; }
        }
        const args = src.slice(i, j);
        if (!src.slice(Math.max(0, i - 9), i).includes("function")) {
          calls++;
          if (!/\btaxCents\s*:/.test(args)) {
            const rel = f.slice(root.length + 1);
            missing[rel] = (missing[rel] ?? 0) + 1;
          }
        }
        i = src.indexOf("refundToPayerCents(", j);
      }
    }
    expect(calls).toBeGreaterThan(7);
    expect(missing).toEqual(NO_TAX_NEEDED);
  });

  // Boards 66/172 slice 2: the sweep's captured refund and the poster's cancel quote reach
  // refundToPayerCents through posterCancelSplit (checked above), so each caller must feed it the
  // charge's real tax: the sweep with chargeTaxCentsFor, the quote with checkoutChargeTaxCents.
  it("both posterCancelSplit callers pass the charge's tax", () => {
    const root = join(__dirname, "..", "..");
    const flat = (f: string) => blankComments(readFileSync(join(root, f), "utf8")).replace(/\s+/g, " ");
    expect(flat("supabase/functions/void-cancelled-payments/index.ts")).toMatch(
      /posterCancelSplit\(\{[^;]*state: "captured"[^;]*taxCents: await chargeTaxCentsFor\(stripe, pi\)/,
    );
    const quote = flat("supabase/functions/create-payment/index.ts");
    expect(quote).toContain("const taxCents = await checkoutChargeTaxCents(stripe, qPi);");
    expect(quote).toMatch(/posterCancelSplit\(\{[^;]*state: "captured"[^;]*taxCents \}/);
  });
});
