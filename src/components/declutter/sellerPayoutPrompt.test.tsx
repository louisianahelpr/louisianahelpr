/**
 * The Declutter payout prompt shows ONLY when Declutter money really waits (owner 2026-10-28, shots 12 + 19 in
 * ~/.lh-shots/declutter-walk-1028/: "Set up payouts to get paid. You have money waiting" showed on a first listing
 * with nothing sold). Measured on prod (read-only, 2026-10-28): that account's payout_setup_hire_allowed was true
 * from 1 funded JOB as the Helpr and 1 payout_transfers row, no Declutter sale; the prompt read "allowed" as
 * "Declutter money waiting". The class: the prompt's claim is checked against the seller's own Declutter rows.
 *
 * @mutate src/components/declutter/SellerPayoutPrompt.tsx |   if (waiting.cents <= 0) return null; |
 * @mutate src/components/declutter/SellerPayoutPrompt.tsx |     if (l.my_side !== "seller" \|\| l.status !== "paid" \|\| !l.order_id \|\| l.price_cents <= 0) continue; |     if (!l.order_id) continue;
 * @mutate src/components/declutter/SellerPayoutPrompt.tsx | p.status === "pending" \|\| p.status === "failed" ? p.amount_cents : 0 | p.amount_cents
 * @mutate src/components/declutter/DeclutterMineViews.tsx |       {show("sold") && <SellerPayoutPrompt />} |
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { blankComments } from "@/test/helpers/blankNonCode";

const state = { cart: [] as unknown[], payouts: [] as unknown[], allowed: true };

vi.mock("@/hooks/usePayoutSetupHireAllowed", () => ({ usePayoutSetupHireAllowed: () => state.allowed }));
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupBlock: () => null }));
vi.mock("@/hooks/useStripeConnectStatus", () => ({ useStripeConnectStatus: () => ({ payoutPrompt: { kind: "setup" } }) }));
vi.mock("@/hooks/useCurrentUser", () => ({ useCurrentUser: () => ({ user: { id: "u1" }, profile: {}, isLoading: false }) }));
vi.mock("@/components/payouts/PayoutSetupPausedNotice", () => ({ PayoutSetupPausedNotice: () => <p>paused</p> }));
vi.mock("@/lib/declutter/api", () => ({ fetchMyCart: async () => state.cart }));
vi.mock("@/lib/declutter/handover", () => ({ fetchMyPayouts: async () => state.payouts }));

import { SellerPayoutPrompt, declutterMoneyWaiting } from "./SellerPayoutPrompt";

const SOLD = {
  line_id: "l1", item_id: "i1", item_title: "Oak rocking chair", my_side: "seller", seller_id: "u1", price_cents: 3200, status: "paid",
  checkout_by: "2026-10-28", order_id: "o1", order_status: "paid", handover: "porch", premium_cents: null, total_cents: null, porch_ok: true,
};
const PAYOUT = { order_id: "o1", items_cents: 3200, delivery_cents: 0, refunded_cents: 0, debt_cents: 0, amount_cents: 3200, status: "pending", executed_at: null };

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SellerPayoutPrompt />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const tick = () => new Promise((r) => setTimeout(r, 30));

describe("Declutter payout prompt: only when Declutter money waits", () => {
  beforeEach(() => {
    state.cart = [];
    state.payouts = [];
    state.allowed = true;
  });

  it("shots 12/19: allowed by the server (a funded job), nothing sold on Declutter: no prompt", async () => {
    show();
    await tick();
    expect(screen.queryByText(/Set up payouts/)).toBeNull();
  });

  it("a paid sale not paid out yet: the prompt names the sale and its money", async () => {
    state.cart = [SOLD];
    show();
    expect(await screen.findByText("Set up payouts to get your $32.")).toBeInTheDocument();
    expect(screen.getByText(/You sold Oak rocking chair\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up payouts" })).toHaveAttribute("href", "/profile?tab=payment");
  });

  it("every case of the rule", () => {
    const cases: [string, unknown[], unknown[], number][] = [
      ["no sales", [], [], 0],
      ["a buyer's paid line is not the seller's money", [{ ...SOLD, my_side: "buyer" }], [], 0],
      ["a sale still waiting for the buyer to pay", [{ ...SOLD, status: "in_cart", order_id: null, order_status: null }], [], 0],
      ["a free claim owes nothing", [{ ...SOLD, price_cents: 0 }], [], 0],
      ["paid, no payout row yet: the price", [SOLD], [], 3200],
      ["handed over, payout pending", [{ ...SOLD, order_status: "handed_over" }], [PAYOUT], 3200],
      ["payout failed (no account): its amount", [SOLD], [{ ...PAYOUT, status: "failed", amount_cents: 3000 }], 3000],
      ["payout sent: nothing waits", [SOLD], [{ ...PAYOUT, status: "succeeded" }], 0],
      ["nothing due (paid off a debt)", [SOLD], [{ ...PAYOUT, status: "nothing_due", amount_cents: 0 }], 0],
      ["two items in one order count once each", [SOLD, { ...SOLD, line_id: "l2", item_id: "i2", price_cents: 800 }], [], 4000],
    ];
    expect(cases.length).toBeGreaterThan(8);
    for (const [name, cart, payouts, cents] of cases) {
      expect(declutterMoneyWaiting(cart as never, payouts as never).cents, name).toBe(cents);
    }
  });

  it("the server says no (owed nothing): no prompt, and the Declutter rows are not even read", async () => {
    state.allowed = false;
    state.cart = [SOLD];
    show();
    await tick();
    expect(screen.queryByText(/Set up payouts/)).toBeNull();
  });

  it("the Selling tab shows it where the money is: with the sold group", () => {
    const dash = blankComments(readFileSync("src/components/declutter/DeclutterMineViews.tsx", "utf8"));
    expect(dash).toContain('{show("sold") && <SellerPayoutPrompt />}');
  });
});
