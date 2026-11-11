/**
 * Audit 11-10 F364: order rows hid the refund outcome. A part refund (agreed, not in full) and a declined refund both
 * read "Handed over. It's yours."; an open one said "You asked for a refund" with no deadline. The standing line now
 * names the money and who is waiting: "Partly refunded: $12 back to your card." (or on its way), "Handed over. The
 * seller said no to your refund.", and the open one carries the seller's answer-by day. Not done: the asked-for amount
 * (declutter_refund_requests has no asked-cents column; refund_cents is the paid-back amount).
 *
 * @mutate src/components/declutter/BuyingOrders.tsx | case "declined": return "Handed over. The seller said no to your refund."; |
 * @mutate src/components/declutter/BuyingOrders.tsx | return request.refund_status === "succeeded" ? `Partly refunded: ${back} back to your card.` : `Partly refunded: ${back} is on its way back to your card.`; | return `Partly refunded: ${back} back to your card.`;
 * @mutate src/components/declutter/BuyingOrders.tsx | if (status === "agreed" && !inFull && request?.refund_cents) { | if (false) {
 * @mutate src/components/declutter/BuyingOrders.tsx | case "open": return request?.answer_by | case "open": return null && request?.answer_by
 */
import { describe, expect, it } from "vitest";
import { refundStanding } from "./BuyingOrders";

const base = { status: "agreed", returned_at: null } as const;

describe("F364: the order row says what the refund came to", () => {
  it("a part refund names the money back, paid or on its way", () => {
    expect(refundStanding("agreed", false, { ...base, refund_cents: 1200, refund_status: "succeeded" })).toBe("Partly refunded: $12 back to your card.");
    expect(refundStanding("agreed", false, { ...base, refund_cents: 1200, refund_status: "pending" })).toBe("Partly refunded: $12 is on its way back to your card.");
  });

  it("a full refund still reads as before; a part refund with no amount yet stays quiet", () => {
    expect(refundStanding("agreed", true, { ...base, refund_cents: 4334, refund_status: "succeeded" })).toMatch(/refund/i);
    expect(refundStanding("agreed", false, { ...base, refund_cents: null, refund_status: null })).toBeNull();
  });

  it("a declined refund says the seller said no", () => {
    expect(refundStanding("declined", false, { ...base, status: "declined" })).toBe("Handed over. The seller said no to your refund.");
  });

  it("an open refund carries the seller's answer-by day; without one, the old line", () => {
    const words = refundStanding("open", false, { ...base, status: "open", answer_by: "2026-11-15T23:00:00Z" });
    expect(words).toMatch(/^Handed over\. You asked for a refund; the seller has until .*15.* to answer\.$/);
    expect(refundStanding("open", false, { ...base, status: "open" })).toBe("Handed over. You asked for a refund.");
  });
});
