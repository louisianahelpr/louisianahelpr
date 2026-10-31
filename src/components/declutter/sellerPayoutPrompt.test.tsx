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
 * @mutate src/components/declutter/DeclutterMineViews.tsx |     <SellerPayoutPrompt />\n |
 * @mutate src/components/declutter/SellerPayoutPrompt.tsx |     titles.push(...s.titles); |     if (!titles.length) titles.push(...s.titles);
 * @mutate src/components/declutter/SellerPayoutPrompt.tsx |     s.titles.push(l.item_title); |     if (!s.titles.length) s.titles.push(l.item_title);
 * @mutate src/components/declutter/SellerPayoutPrompt.tsx |   return `${titles[0]}, ${titles[1]} and ${titles.length - 2} more`; |   return `${titles[0]}, ${titles[1]} and more`;
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

import { SellerPayoutPrompt, declutterMoneyWaiting, soldWords } from "./SellerPayoutPrompt";

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

  // Audit 1030 DC-14: two sales, $42 in the title, and the body named only the first item.
  it("two sales waiting: the amount sums both and the words name both", async () => {
    state.cart = [SOLD, { ...SOLD, line_id: "l2", item_id: "i2", item_title: "Blue enamel mug", price_cents: 1000, order_id: "o2" }];
    show();
    expect(await screen.findByText("Set up payouts to get your $42.")).toBeInTheDocument();
    expect(screen.getByText(/You sold Oak rocking chair and Blue enamel mug\./)).toBeInTheDocument();
  });

  it("every item in the money is named or counted, and a paid-out sale is not", () => {
    const two = { ...SOLD, line_id: "l2", item_id: "i2", item_title: "Lamp", order_id: "o2" };
    const three = { ...SOLD, line_id: "l3", item_id: "i3", item_title: "Rug", order_id: "o2" };
    expect(declutterMoneyWaiting([SOLD, two, three] as never, []).titles).toEqual(["Oak rocking chair", "Lamp", "Rug"]);
    expect(declutterMoneyWaiting([SOLD, two] as never, [{ ...PAYOUT, status: "succeeded" }] as never).titles).toEqual(["Lamp"]);
    const words: [string[], string][] = [
      [["A"], "A"], [["A", "B"], "A and B"], [["A", "B", "C"], "A, B and C"], [["A", "B", "C", "D"], "A, B and 2 more"], [["A", "B", "C", "D", "E"], "A, B and 3 more"],
    ];
    expect(words.length).toBeGreaterThan(3);
    for (const [t, w] of words) expect(soldWords(t)).toBe(w);
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
    // AUD31-4 (4c8920f168): the sold group is built once as `sold` so it can come first; the prompt opens it
    // (blankComments leaves the JSX comment as an empty {}).
    expect(dash).toMatch(/const sold = show\("sold"\) && <>\s*(?:\{\s*\}\s*)?<SellerPayoutPrompt \/>/);
  });
});
