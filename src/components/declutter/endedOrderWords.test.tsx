/**
 * An order cancelled after it was paid or claimed keeps a record on Buying, in words that fit it (audit 2 A2-4 /
 * B2-1, 2026-10-28, a2-42-buyer-noshow-done-p1-390): after a no-show closed a free order, the buyer's card left
 * Buying with no "cancelled" record. declutter_close_paid_order sets the lines to missed / cancelled_by_seller and
 * the order to refunded, so the line now lands under "Ended" with the unpaid-checkout words ("The time to check
 * out ran out. Nothing was charged."), which are false for a sale being refunded. Each kind now says what happened.
 *
 * @mutate src/components/declutter/BuyingOrders.tsx |   const closedAfterPaying = !!line.order_id && line.order_status === "refunded"; |   const closedAfterPaying = false;
 * @mutate src/components/declutter/DeclutterMineViews.tsx |           <SectionHeading title="Ended" /> |           <SectionHeading title="Ended before paying" />
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EndedLine } from "./BuyingOrders";
import { blankComments } from "@/test/helpers/blankNonCode";
import type { CartLine } from "@/lib/declutter/api";

const base: CartLine = {
  line_id: "l1", item_id: "i1", item_title: "Wicker basket", my_side: "buyer", seller_id: "s1", price_cents: 2000,
  status: "missed", checkout_by: "2026-10-27T00:00:00Z", order_id: null, order_status: null, handover: null,
  premium_cents: null, total_cents: null, porch_ok: true,
};

function words(over: Partial<CartLine>): string {
  const { unmount } = render(<ul><EndedLine line={{ ...base, ...over }} /></ul>);
  const text = screen.getByText(/\./, { selector: "p.text-muted-foreground, p.text-ds-13" }).textContent ?? "";
  unmount();
  return text;
}

describe("Ended on Buying: every kind of ended order says what happened (A2-4)", () => {
  it("a checkout that ran out, or a seller who called it off before paying: nothing was charged", () => {
    expect(words({ status: "missed" })).toBe("The time to check out ran out. Nothing was charged.");
    expect(words({ status: "cancelled_by_seller" })).toBe("The seller called off the sale. Nothing was charged.");
    // An expired checkout can carry its unpaid order: still the unpaid words.
    expect(words({ status: "missed", order_id: "o1", order_status: "superseded" })).toBe("The time to check out ran out. Nothing was charged.");
  });

  it("a free pickup cancelled after it was claimed (the no-show in the audit): cancelled, nothing charged", () => {
    expect(words({ status: "missed", order_id: "o1", order_status: "refunded", total_cents: 0, price_cents: 0 })).toBe("This free pickup was cancelled. Nothing was charged.");
    expect(words({ status: "cancelled_by_seller", order_id: "o1", order_status: "refunded", total_cents: 0, price_cents: 0 })).toBe("The seller cancelled this free pickup. Nothing was charged.");
  });

  it("a paid sale cancelled after paying: a refund is on its way, never \"Nothing was charged\"", () => {
    const buyerFault = words({ status: "missed", order_id: "o1", order_status: "refunded", total_cents: 2170 });
    expect(buyerFault).toBe("This sale was cancelled. Your refund is on its way to your card.");
    expect(words({ status: "cancelled_by_seller", order_id: "o1", order_status: "refunded", total_cents: 2170 })).toBe("The seller cancelled this sale. Your refund is on its way to your card.");
    expect(buyerFault).not.toMatch(/Nothing was charged|\$|fee/);
  });

  it("the section is headed \"Ended\", not \"Ended before paying\"", () => {
    const src = blankComments(readFileSync("src/components/declutter/DeclutterMineViews.tsx", "utf8"));
    expect(src).toContain('<SectionHeading title="Ended" />');
    expect(src).not.toContain("Ended before paying");
  });
});
