/**
 * D2-6 (audit 1b #6, prod 2026-10-29): a sale refunded in full read "$0 after the buyer's refund. Nothing to pay out:
 * this sale covered an amount you owed from an earlier refund", though nothing owed was taken. The $0 reason now comes
 * from the payout row: refunded_cents (the refund) and debt_cents (what owed was actually taken).
 *
 * @mutate src/lib/declutter/payoutWords.ts |   if ((p.refunded_cents ?? 0) >= sale) return "Nothing to pay out: the buyer was refunded for this sale."; |
 * @mutate src/lib/declutter/payoutWords.ts |   if (p.debt_cents > 0) return "Nothing to pay out: this sale covered an amount you owed from an earlier refund."; |
 * @mutate src/lib/declutter/payoutWords.ts |   const sale = p.items_cents + (p.delivery_cents ?? 0); |   const sale = p.items_cents + (p.delivery_cents ?? 0) + 1;
 * @mutate src/lib/declutter/payoutWords.ts | p.debt_cents > 0 ? ` after the buyer's refund and ${formatPrice(p.debt_cents)} you owed` : | false ? "" :
 */
import { describe, expect, it } from "vitest";
import { payoutBreakdown, payoutStatusWords } from "./payoutWords";

const row = (over: Partial<{ status: "pending" | "succeeded" | "failed" | "nothing_due"; items_cents: number; delivery_cents: number; refunded_cents: number; debt_cents: number }> = {}) => ({
  status: "nothing_due" as const, items_cents: 2000, delivery_cents: 0, refunded_cents: 0, debt_cents: 0, ...over,
});

describe("D2-6: the $0 payout says why, from the payout row", () => {
  it("refunded in full (the audit's case): the refund, never an amount owed", () => {
    const p = row({ refunded_cents: 2000 });
    expect(payoutStatusWords(p)).toBe("Nothing to pay out: the buyer was refunded for this sale.");
    expect(payoutBreakdown(p)).toBe(" after the buyer's refund");
  });

  it("a seller delivery refunded in full counts its rate too", () => {
    expect(payoutStatusWords(row({ delivery_cents: 500, refunded_cents: 2500 }))).toBe("Nothing to pay out: the buyer was refunded for this sale.");
    expect(payoutStatusWords(row({ delivery_cents: 500, refunded_cents: 2000 }))).not.toMatch(/refunded for this sale/);
  });

  it("an earlier amount owed that this sale covered", () => {
    expect(payoutStatusWords(row({ debt_cents: 2000 }))).toBe("Nothing to pay out: this sale covered an amount you owed from an earlier refund.");
  });

  it("a part refund plus an amount owed: both named, each from what was taken", () => {
    const p = row({ refunded_cents: 1931, debt_cents: 69 });
    expect(payoutStatusWords(p)).toBe("Nothing to pay out: this sale covered an amount you owed from an earlier refund.");
    expect(payoutBreakdown(p)).toBe(" after the buyer's refund and $0.69 you owed");
  });

  it("other statuses keep their words; nothing owed and no refund says only that", () => {
    expect(payoutStatusWords(row({ status: "pending" }))).toMatch(/^We send it once the sale is final/);
    expect(payoutStatusWords(row())).toBe("Nothing to pay out.");
    expect(payoutBreakdown(row({ status: "succeeded", debt_cents: 150 }))).toBe(" ($20 minus $1.50 you owed)");
  });
});
