/**
 * Owner 11-07 (Vinted review, item 2): the Declutter checkout summary lists the item(s), the service fee, how the
 * buyer gets it (pickup Free), a one-time setup fee, and sales tax, EACH with a small info tip, then the Total. The
 * lines always add up to the Total (PayForSeller passes the fee as the total less every other line; its own cases are
 * in src/components/declutter/declutterTradeViews.test.tsx).
 *
 * @mutate src/components/declutter/DeclutterCheckoutSummary.tsx |         <InfoTip label={label}>{tip}</InfoTip> | {null}
 * @mutate src/components/declutter/DeclutterCheckoutSummary.tsx |       {way && !unpriced && ( |       {way && (
 * @mutate src/components/declutter/DeclutterCheckoutSummary.tsx | value={wayCents === 0 \|\| pickup ? | value={pickup ? exact(0) :
 * @mutate src/components/declutter/DeclutterCheckoutSummary.tsx | {exact(gift.onCardCents)} | {exact(payCents)}
 * Audit 11-10 F354: the Service fee tip says how the fee is worked out, per way, matching the fee the server charges.
 * @mutate src/components/declutter/DeclutterCheckoutSummary.tsx | tip={way === "seller_delivery" ? SUMMARY_TIPS.serviceFeeSellerDelivery : way === "ship" ? SUMMARY_TIPS.serviceFeeShip : SUMMARY_TIPS.serviceFee} /> | tip={SUMMARY_TIPS.serviceFee} />
 * @mutate src/components/declutter/DeclutterCheckoutSummary.tsx |   serviceFee: "$0.70 plus 5% of the items, | serviceFee: "It keeps Declutter running,
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CheckoutPriceSummary, SUMMARY_TIPS } from "@/components/declutter/DeclutterCheckoutSummary";
import { checkoutAmounts } from "@/lib/declutter/money";
import { sellerDeliveryAmounts } from "@/lib/declutter/sellerDelivery";

const cents = (el: Element | null) => Math.round(Number((el?.textContent ?? "").replace(/[^0-9.]/g, "") || "0") * 100);
const line = (k: string) => document.querySelector(`[data-summary-line="${k}"]`);

describe("owner 11-07: the checkout price summary", () => {
  it("porch pickup: item, service fee, pickup Free, sales tax, Total; every line has its info tip", async () => {
    render(<CheckoutPriceSummary itemCount={1} itemsCents={300} discountCents={0} way="porch" wayCents={0} serviceFeeCents={85}
      setupFeeCents={0} setupFeeKnown taxCents={0} payCents={385} />);
    const labels = [...document.querySelectorAll("dt")].map((d) => d.textContent);
    expect(labels).toEqual(["Item", "Service fee", "Pickup", "Sales tax", "Total"]);
    expect(line("way")?.querySelector("dd")?.textContent).toBe("Free");
    expect(line("total")?.querySelector("dd")?.textContent).toBe("$3.85");
    for (const l of ["Item", "Service fee", "Pickup", "Sales tax"]) expect(screen.getByRole("button", { name: `About ${l}` })).toBeInTheDocument();
    expect(cents(line("items")!.querySelector("dd")) + cents(line("service-fee")!.querySelector("dd")) + cents(line("tax")!.querySelector("dd")))
      .toBe(cents(line("total")!.querySelector("dd")));
    fireEvent.click(screen.getByRole("button", { name: "About Service fee" }));
    expect(await screen.findByText(SUMMARY_TIPS.serviceFee)).toBeInTheDocument();
  });

  it("F354: the Service fee tip says how it is worked out, and the words agree with the fee charged", async () => {
    // The tip's rule, checked against the preview of declutter_buyer_fee_cents: $0.70 + 5% ($2.45 on $35, $0.85 on $3).
    expect(SUMMARY_TIPS.serviceFee.startsWith("$0.70 plus 5% of the items, once per checkout")).toBe(true);
    expect(checkoutAmounts([3500]).premiumCents).toBe(70 + Math.round(3500 * 0.05));
    expect(checkoutAmounts([300]).premiumCents).toBe(85);
    expect(SUMMARY_TIPS.serviceFeeSellerDelivery.startsWith("$0.70 plus 5% of the items and the seller's delivery")).toBe(true);
    expect(sellerDeliveryAmounts(3000, 1000).premiumCents).toBe(70 + Math.round(4000 * 0.05));
    for (const t of [SUMMARY_TIPS.serviceFee, SUMMARY_TIPS.serviceFeeSellerDelivery, SUMMARY_TIPS.serviceFeeShip]) expect(t).toContain("The seller gets the full item price.");
    const { unmount } = render(<CheckoutPriceSummary itemCount={1} itemsCents={3000} discountCents={0} way="seller_delivery" wayCents={1000} serviceFeeCents={270}
      setupFeeCents={0} setupFeeKnown taxCents={0} payCents={4270} />);
    fireEvent.click(screen.getByRole("button", { name: "About Service fee" }));
    expect(await screen.findByText(SUMMARY_TIPS.serviceFeeSellerDelivery)).toBeInTheDocument();
    unmount();
    render(<CheckoutPriceSummary itemCount={1} itemsCents={3000} discountCents={0} way="ship" wayCents={900} serviceFeeCents={265}
      setupFeeCents={0} setupFeeKnown taxCents={0} payCents={4165} />);
    fireEvent.click(screen.getByRole("button", { name: "About Service fee" }));
    expect(await screen.findByText(SUMMARY_TIPS.serviceFeeShip)).toBeInTheDocument();
  });

  it("Helpr delivery priced: its own line with the amount; not priced yet: no line, the Total says + delivery", () => {
    const { rerender } = render(<CheckoutPriceSummary itemCount={2} itemsCents={700} discountCents={0} way="delivery" wayCents={4000} serviceFeeCents={105}
      setupFeeCents={200} setupFeeKnown taxCents={0} payCents={5005} />);
    expect(line("way")?.textContent).toBe("Helpr delivery$40.00");
    expect(line("setup-fee")?.textContent).toBe("One-time setup fee$2.00");
    const sum = ["items", "service-fee", "way", "setup-fee", "tax"].reduce((a, k) => a + cents(line(k)!.querySelector("dd")), 0);
    expect(sum).toBe(cents(line("total")!.querySelector("dd")));
    rerender(<CheckoutPriceSummary itemCount={2} itemsCents={700} discountCents={0} way="delivery" wayCents={null} serviceFeeCents={105}
      setupFeeCents={0} setupFeeKnown taxCents={0} payCents={805} />);
    expect(line("way")).toBeNull();
    expect(line("total")?.textContent).toBe("Total$8.05+ delivery");
  });

  it("lead money review 11-07: a gift card takes its part off and the summary ends with what goes on the card", () => {
    render(<CheckoutPriceSummary itemCount={1} itemsCents={4000} discountCents={0} way="porch" wayCents={0} serviceFeeCents={270}
      setupFeeCents={0} setupFeeKnown taxCents={0} payCents={4270} gift={{ fromGiftCents: 2500, onCardCents: 1770 }} />);
    expect(line("total")?.textContent).toBe("Total$42.70");
    expect(line("gift")?.textContent).toBe("Gift card−$25.00");
    expect(line("pay-by-card")?.textContent).toBe("Pay by card$17.70");
    expect(screen.getByRole("button", { name: "About Gift card" })).toBeInTheDocument();
    expect(cents(line("total")!.querySelector("dd")) - cents(line("gift")!.querySelector("dd"))).toBe(cents(line("pay-by-card")!.querySelector("dd")));
  });
});
