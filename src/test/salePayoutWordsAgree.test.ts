/**
 * Deep audit 11-22 #51: a $50 payout Louisiana Helpr settled by hand read "You get $50, paid on Sat, Nov 7" on the
 * Selling card and "Not sent yet" on Money > Declutter sales. For EVERY payout status the app words (PAYOUT_STATUSES,
 * from payoutStatusWords' own table), the two screens agree: the Money row says "Paid <day>" exactly when the card
 * says "paid on <day>", and both read payoutWentOut.
 *
 * @mutate src/lib/declutter/salePayouts.ts |   if (payoutWentOut(r.status)) { |   if (r.status === "succeeded") {
 * @mutate src/components/declutter/declutterPayoutWords.ts |   const paidOut = payoutWentOut(payout.status); |   const paidOut = payout.status === "succeeded";
 * @mutate src/lib/declutter/payoutWords.ts | export const payoutWentOut = (status: MyPayout["status"]) => status === "succeeded" \|\| status === "settled_by_hand"; | export const payoutWentOut = (status: MyPayout["status"]) => status === "succeeded";
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { payoutLine } from "@/components/declutter/declutterPayoutWords";
import { salePayoutWords, type SalePayout } from "@/lib/declutter/salePayouts";
import { PAYOUT_STATUSES, payoutWentOut } from "@/lib/declutter/payoutWords";

const EXECUTED = "2026-11-07T18:00:00Z";
const row = (status: SalePayout["status"]): SalePayout => ({
  order_id: "o1", title: "Coffee table", items_cents: 5000, delivery_cents: 0, refunded_cents: 0, debt_cents: 0, amount_cents: 5000,
  status, executed_at: payoutWentOut(status) ? EXECUTED : null, attempts: 0,
});

describe("#51: the sale card and Money > Declutter sales agree on every payout status", () => {
  it("Paid on one screen exactly when paid on the other", () => {
    expect(PAYOUT_STATUSES.length).toBeGreaterThan(5);
    const seen: string[] = [];
    for (const status of PAYOUT_STATUSES) {
      if (status === "nothing_due") continue; // Money > Declutter sales leaves these out (fetchMySalePayouts)
      const money = salePayoutWords(row(status));
      const card = payoutLine(row(status), false, { handedOverAt: "2026-11-06T18:00:00Z", now: Date.parse("2026-11-22T12:00:00Z") });
      const moneyPaid = money.startsWith("Paid");
      const cardPaid = /, paid on [^.]*\.$/.test(card) && !/unless/.test(card);
      expect(moneyPaid, `${status}: "${money}" vs "${card}"`).toBe(cardPaid);
      expect(moneyPaid, status).toBe(payoutWentOut(status));
      seen.push(status);
    }
    expect(seen).toContain("settled_by_hand");
    expect(salePayoutWords(row("settled_by_hand"))).toBe("Paid Nov 7");
    expect(salePayoutWords(row("held_for_review"))).toBe("On hold");
  });
});
