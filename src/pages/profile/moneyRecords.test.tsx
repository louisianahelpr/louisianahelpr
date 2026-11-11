/**
 * Board 177 (You → Money): PAYOUT HISTORY, ONE PAYOUT, and RECEIPTS / FEES
 * OWED / TAX FORMS.
 *
 * Payout history lists the bank payouts stripe-payouts reads (Stripe's
 * status in the board's words, the arrival day, the amount); a row opens the
 * payout, whose lines and bank come from stripe-payouts' `payout_id` answer.
 * Receipts are the jobs this member paid for (the Spent half's rows and
 * figures) and the Declutter orders they paid for, then the fees the payout
 * runs will take, then the tax-form row.
 *
 * @mutate src/pages/profile/PayoutHistory.tsx |     case "paid": return "Sent"; |     case "paid": return "paid";
 * @mutate src/pages/profile/PayoutHistory.tsx | body: { payout_id: payoutId } | body: {}
 * @mutate src/pages/profile/PayoutHistory.tsx | {data.bank_last4 ? `bank ending ${data.bank_last4}` : "your bank"} | {"your bank"}
 * @mutate src/pages/profile/PayoutHistory.tsx | {data.status === "paid" ? "Sent to " : "To "} | {"Sent to "}
 * @mutate src/pages/profile/PayoutHistory.tsx |       {data.status === "failed" && ( |       {false && (
 * @mutate src/pages/profile/PayoutHistory.tsx |               {payoutStatusLabel(data.status)} |
 * @mutate src/pages/profile/PayoutHistory.tsx |       {next && ( |       {false && (
 * @mutate src/pages/profile/Receipts.tsx |     .filter((o) => o.paid_at && (o.status === "paid" \|\| o.status === "handed_over" \|\| o.status === "refunded")) |     .filter((o) => !!o.paid_at)
 * @mutate src/pages/profile/Receipts.tsx |           .eq("buyer_id", uid!) |           .eq("seller_id", uid!)
 * @mutate src/pages/profile/Receipts.tsx |   receipts.push(...orderReceipts(orders.data ?? [], titlesByOrder(cart.data ?? []), paid.data ?? null, back.data ?? null)); |
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";

// Payout setup OPEN here (owner pause of 2026-10-23 is the `payout_setup` switch):
// this file tests the setup flow itself; the paused state is
// src/components/payouts/payoutSetupPaused.test.tsx.
vi.mock("@/hooks/usePayoutSetupPaused", () => ({ usePayoutSetupPaused: () => false }));
vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "user-1" }, profile: null, loading: false }),
}));

let invokes: unknown[] = [];
let detailStatus = "pending";
let filters: [string, string, unknown][] = [];
const tables: Record<string, unknown[]> = {};

function builder(table: string) {
  const b: Record<string, unknown> = {};
  for (const op of ["select", "eq", "gt", "in", "not", "neq", "order", "limit"]) {
    b[op] = (col: string, v: unknown) => { filters.push([table, `${op}:${col}`, v]); return b; };
  }
  b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: tables[table] ?? [], error: null }).then(resolve);
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (t: string) => builder(t),
    // DB-13: declutter_my_cart gives a receipt its item names (the order card's read).
    // B96: declutter_my_paid_cents gives a receipt the card charge (the sale plus a first purchase's setup fee).
    rpc: (fn: string) => Promise.resolve({ data: fn === "declutter_my_cart" ? (tables.my_cart ?? []) : fn === "declutter_my_paid_cents" ? (tables.my_paid ?? []) : fn === "declutter_my_refunded_cents" ? (tables.my_refunded ?? []) : [], error: null }),
    functions: {
      invoke: (_fn: string, opts: { body: Record<string, unknown> }) => {
        invokes.push(opts.body);
        if (opts.body.payout_id) {
          return Promise.resolve({
            data: {
              id: "po_1aaaaaaaa", amount_cents: 9345, currency: "usd", status: detailStatus, arrival_date: 1792800000, created: 1792700000,
              bank_last4: "0193",
              lines: [
                { kind: "job", label: "Mow front and back yard", amount_cents: 3255, href: "/jobs/j1" },
                { kind: "sale", label: "Vintage film camera", amount_cents: 6400, href: "/declutter?view=selling" },
                { kind: "fee_owed", label: "Fee owed, paid back", amount_cents: -310, href: null },
              ],
            },
            error: null,
          });
        }
        return Promise.resolve({
          data: {
            connected: true, payouts_enabled: true, available: [], pending: [],
            payouts: [
              { id: "po_1aaaaaaaa", amount: 9345, currency: "usd", status: "pending", arrival_date: 1792800000, method: "standard", created: 1792700000, description: null },
              { id: "po_1bbbbbbbb", amount: 12810, currency: "usd", status: "paid", arrival_date: 1792195200, method: "standard", created: 1792100000, description: null },
            ],
          },
          error: null,
        });
      },
    },
  },
}));

import PayoutHistory from "./PayoutHistory";
import Receipts, { orderReceipts, receiptTitle, type PaidOrderRow } from "./Receipts";

let where = "";
function Where() {
  const l = useLocation();
  where = l.search;
  return null;
}
function renderAt(ui: React.ReactNode, search = "") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/profile${search}`]}>
        {ui}
        <Where />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const text = () => (document.body.textContent ?? "").replace(/\s+/g, " ");

beforeEach(() => {
  invokes = [];
  detailStatus = "pending";
  filters = [];
  for (const k of Object.keys(tables)) delete tables[k];
});

describe("payout history (board 177)", () => {
  it("lists each bank payout with its day, Stripe's status in plain words and its amount", async () => {
    renderAt(<PayoutHistory />, "?tab=payout_history");
    await screen.findByText("$93.45");
    expect(text()).toContain("Payout history");
    expect(text()).toContain("Scheduled");
    expect(text()).toContain("Sent");
    expect(text()).toContain("$128.10");
  });

  // A3-28 (audit 11-01): each row says its next step; a payout still on its way waits on the bank, a sent one says nothing.
  it("a payout not arrived yet says it waits on the bank; a sent one has no step", async () => {
    renderAt(<PayoutHistory />, "?tab=payout_history");
    await screen.findByText("$93.45");
    const waiting = document.querySelector('[data-payout-item="po_1aaaaaaaa"] [data-next-step]');
    expect(waiting?.getAttribute("data-next-step")).toBe("them");
    expect(waiting?.textContent).toMatch(/^Waiting on the bank · arrives about \w{3}, \w{3} \d{1,2}$/);
    expect(document.querySelector('[data-payout-item="po_1bbbbbbbb"] [data-next-step]')).toBeNull();
  });

  it("a row opens that payout: its lines, the bank it went to, and the total", async () => {
    renderAt(<PayoutHistory />, "?tab=payout_history");
    fireEvent.click(await screen.findByText("$93.45"));
    await waitFor(() => expect(where).toContain("payout=po_1aaaaaaaa"));
    await screen.findByText("To bank ending 0193");
    expect(invokes).toContainEqual({ payout_id: "po_1aaaaaaaa" });
    expect(text()).toContain("Mow front and back yard$32.55");
    expect(text()).toContain("Vintage film camera$64.00");
    expect(text()).toContain("Fee owed, paid back−$3.10");
    expect(text()).toMatch(/^.*Payout · .*$/);
  });

  // AUD31-54: a failed payout's detail read "To bank ending 6789 $39.00" with no status.
  it.each([
    ["failed", "To bank ending 0193", "Didn't go through", true],
    ["paid", "Sent to bank ending 0193", "Sent", false],
    ["in_transit", "To bank ending 0193", "On the way", false],
  ] as const)("a %s payout's detail says so: %s, %s", async (status, bank, label, fix) => {
    detailStatus = status;
    renderAt(<PayoutHistory />, "?tab=payout_history&payout=po_1aaaaaaaa");
    await screen.findByText(bank);
    expect(document.querySelector(`[data-payout-status="${status}"]`)?.textContent).toBe(label);
    const link = screen.queryByRole("link", { name: "Check your bank details" });
    if (fix) expect(link).toHaveAttribute("href", "/profile?tab=payment");
    else expect(link).toBeNull();
  });

  it("a malformed ?payout= is ignored, not sent", async () => {
    renderAt(<PayoutHistory />, "?tab=payout_history&payout=../../x");
    await screen.findByText("$93.45");
    expect(invokes.some((b) => (b as { payout_id?: unknown }).payout_id)).toBe(false);
  });
});

describe("receipts, fees owed, tax forms (board 177)", () => {
  it("lists the jobs paid for and the Declutter orders paid for, then the fees owed and the tax row", async () => {
    tables.jobs = [{
      id: "j1", title: "Pressure wash driveway", budget: 100, status: "completed", payment_status: "released",
      stripe_payment_intent_id: "pi_1", poster_completed_at: "2026-10-01T12:00:00Z", helper_completed_at: null, created_at: "2026-09-30T12:00:00Z",
    }];
    tables.declutter_orders = [{ id: "o1", status: "handed_over", total_cents: 2527, paid_at: "2026-10-05T12:00:00Z" }];
    tables.declutter_seller_fee_debts = [{ id: "d1", remaining_cents: 310 }];
    renderAt(<Receipts />, "?tab=receipts");
    await screen.findByText("Pressure wash driveway");
    expect(text()).toContain("$100.00");
    expect(text()).toContain("Declutter purchase");
    expect(text()).toContain("$25.27");
    expect(filters).toContainEqual(["declutter_orders", "eq:buyer_id", "user-1"]);
    await screen.findByText("Amounts owed");
    expect(text()).toContain("Taken from your next payout");
    expect(text()).toContain("$3.10");
    expect(text()).toContain("Available in January if you qualify");
  });

  // F090 (owner UI audit 11-09): a job receipt could not be opened. It opens to the day it was paid, the total and the
  // job. F091: a title typed in capitals or lower case reads in sentence case on receipts only.
  // @mutate src/pages/profile/Receipts.tsx |         lines: r.job ? refundLines ?? [] : undefined, |         lines: refundLines,
  // @mutate src/pages/profile/Receipts.tsx |   const shouting = letters.length > 1 && letters === letters.toUpperCase(); |   const shouting = false;
  it("F090/F091: a job receipt opens to the day paid, the total and the job; its title reads in sentence case", async () => {
    tables.jobs = [{
      id: "j7", title: "GIVE AWAY!!", budget: 40, status: "completed", payment_status: "released",
      stripe_payment_intent_id: "pi_7", poster_completed_at: "2026-10-01T12:00:00Z", helper_completed_at: null, created_at: "2026-09-30T12:00:00Z",
    }];
    renderAt(<Receipts />, "?tab=receipts");
    const toggle = await screen.findByRole("button", { name: /Give away!!/ });
    fireEvent.click(toggle);
    const detail = document.querySelector("[data-receipt-detail]")!;
    expect(detail.querySelector("[data-receipt-paid-on]")).not.toBeNull();
    expect(detail.textContent).toContain("Total$40.00");
    expect(screen.getByRole("link", { name: "See the job" })).toHaveAttribute("href", "/jobs/j7");
    expect(receiptTitle("clean my house")).toBe("Clean my house");
    expect(receiptTitle("TV mount in den")).toBe("TV mount in den");
    expect(receiptTitle("GIVE AWAY!!")).toBe("Give away!!");
  });

  // AUD31-55 (lead decision 10-31): a job refunded in full stays on Receipts, "Refunded in full", $0 net; a partly
  // refunded one says what came back. Jobs with nothing charged stay out.
  // @mutate src/pages/profile/Receipts.tsx |       if (r.cents <= 0 && !r.refundedInFull) continue; |       if (r.cents <= 0) continue;
  it("AUD31-55: a job refunded in full stays on Receipts as Refunded in full, $0.00", async () => {
    tables.jobs = [
      { id: "j1", title: "Gutter clean", budget: 80, status: "cancelled", payment_status: "refunded", stripe_payment_intent_id: "pi_1",
        poster_completed_at: null, helper_completed_at: null, created_at: "2026-09-30T12:00:00Z", cancelled_at: "2026-10-01T12:00:00Z" },
      { id: "j2", title: "Never paid", budget: 50, status: "cancelled", payment_status: "cancelled", stripe_payment_intent_id: null,
        poster_completed_at: null, helper_completed_at: null, created_at: "2026-09-30T12:00:00Z" },
    ];
    tables.payment_refunds = [{ job_id: "j1", amount_cents: 8000, stripe_payment_intent_id: "pi_1", source: "cancel_escrow" }];
    renderAt(<Receipts />, "?tab=receipts");
    await screen.findByText("Gutter clean");
    expect(text()).toMatch(/Gutter clean.*Refunded in full\s*\$0\.00/);
    expect(text()).not.toContain("Never paid");
  });

  // Audit 2026-10-30 DB-13: the receipt was bare ("Declutter purchase" and a total) and did nothing when tapped.
  // @mutate src/pages/profile/Receipts.tsx |         title: itemsTitle(titles.get(o.id)), |         title: "Declutter purchase",
  // @mutate src/pages/profile/Receipts.tsx |               if (!r.lines) return | if (true) return
  // F380 (owner 11-11): the fee is now its own "Service fee" line (it was words only), so the lines add up to the total.
  // @mutate src/pages/profile/Receipts.tsx |             { label: "Service fee", cents: o.premium_cents ?? 0 }, |
  it("DB-13: a Declutter receipt names its items and opens to its lines, the total and the order", async () => {
    tables.declutter_orders = [{ id: "o1", status: "handed_over", total_cents: 3540, paid_at: "2026-10-05T12:00:00Z",
      items_cents: 2200, premium_cents: 540, delivery_cents: 800, shipping_cents: 0, tax_cents: 0 }];
    tables.my_cart = [
      { line_id: "l1", order_id: "o1", item_title: "Blue mug", my_side: "buyer" },
      { line_id: "l2", order_id: "o1", item_title: "Green vase", my_side: "buyer" },
      { line_id: "l3", order_id: "o9", item_title: "Someone else's sale", my_side: "seller" },
    ];
    renderAt(<Receipts />, "?tab=receipts");
    const toggle = await screen.findByRole("button", { name: /Blue mug and 1 more/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.querySelector("[data-receipt-detail]")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const detail = document.querySelector("[data-receipt-detail]")!;
    expect(detail.textContent).toBe("Paid onOct 5, 2026Items$22.00Service fee$5.40Delivery$8.00Total paid$35.40See the order");
    expect(screen.getByRole("link", { name: "See the order" })).toHaveAttribute("href", "/declutter?view=buying");
    expect(text()).not.toContain("Someone else's sale");
  });

  // B96 (B93's DB-13 note): a first purchase's one-time account setup fee is charged outside total_cents, so the receipt
  // read ~$2 under what Stripe charged. It now shows the card charge (declutter_my_paid_cents) with the setup fee as
  // the cart's own words under the total. F380 (owner 11-11): the setup fee is its own line now, beside the service fee.
  // @mutate src/pages/profile/Receipts.tsx | null : netOfRefund(charged, refundedBack?.get(o.id)).cents, | null : netOfRefund(o.total_cents, refundedBack?.get(o.id)).cents,
  // @mutate src/pages/profile/Receipts.tsx |             { label: "One-time account setup fee", cents: setup }, |
  it("a first purchase's receipt shows what the card was charged, with the setup fee as its own line", async () => {
    tables.declutter_orders = [{ id: "o1", status: "paid", total_cents: 3220, paid_at: "2026-10-05T12:00:00Z",
      items_cents: 3000, premium_cents: 220, delivery_cents: 0, shipping_cents: 0, tax_cents: 0 }];
    tables.my_cart = [{ line_id: "l1", order_id: "o1", item_title: "Blue mug", my_side: "buyer" }];
    tables.my_paid = [{ order_id: "o1", paid_cents: 3420 }];
    renderAt(<Receipts />, "?tab=receipts");
    const toggle = await screen.findByRole("button", { name: /Blue mug/ });
    expect(toggle.textContent).toContain("$34.20");
    expect(toggle.textContent).not.toContain("$32.20");
    fireEvent.click(toggle);
    expect(document.querySelector("[data-receipt-detail]")!.textContent)
      .toBe("Paid onOct 5, 2026Items$30.00Service fee$2.20One-time account setup fee$2.00Total paid$34.20See the order");
    tables.my_paid = [];
  });

  it("without a setup fee (or before the card-charge read answers an order) the receipt is the order's total", () => {
    const o = { id: "a", status: "paid", total_cents: 3220, paid_at: "2026-10-01T00:00:00Z", items_cents: 3000, premium_cents: 220 };
    expect(orderReceipts([o], new Map(), new Map([["a", 3220]]))[0]).toMatchObject({ cents: 3220, lines: [{ label: "Items", cents: 3000 }, { label: "Service fee", cents: 220 }] });
    expect(orderReceipts([o], new Map(), null)[0].cents).toBe(3220);
    expect(orderReceipts([{ ...o, status: "refunded" }], new Map(), new Map([["a", 3420]]))[0].cents).toBeNull();
  });

  // F380 (audit 11-10; owner 11-11 ~12:25 AM): a Declutter receipt shows a "Service fee" line, and its lines add up to
  // exactly what the card was charged in each fee situation. Every figure is the order row's frozen column (the fee is
  // premium_cents, never a recomputed 5% + 70c) and the setup fee is the card charge (declutter_my_paid_cents) less
  // total_cents. The fixtures keep CHECK declutter_orders_total (20261020024605): total = items + premium + tax +
  // delivery + shipping.
  // @mutate src/pages/profile/Receipts.tsx |       const setup = Math.max(0, charged - o.total_cents); |       const setup = 0;
  // @mutate src/pages/profile/Receipts.tsx |             { label: "Delivery", cents: o.delivery_cents ?? 0 }, |
  // @mutate src/pages/profile/Receipts.tsx |             { label: "Shipping", cents: o.shipping_cents ?? 0 }, |
  // @mutate src/pages/profile/Receipts.tsx |       const known = o.items_cents != null && o.premium_cents != null; |       const known = o.items_cents != null;
  describe("F380: the receipt's lines add up to what was paid", () => {
    const at = "2026-10-01T00:00:00Z";
    const cases: { name: string; row: PaidOrderRow; paid: number; want: [string, number][] }[] = [
      { name: "plain pickup", paid: 2170,
        row: { id: "p", status: "paid", total_cents: 2170, paid_at: at, items_cents: 2000, premium_cents: 170, delivery_cents: 0, shipping_cents: 0, tax_cents: 0 },
        want: [["Items", 2000], ["Service fee", 170]] },
      { name: "Helpr delivery", paid: 5320,
        row: { id: "d", status: "handed_over", total_cents: 5320, paid_at: at, items_cents: 4500, premium_cents: 295, delivery_cents: 525, shipping_cents: 0, tax_cents: 0 },
        want: [["Items", 4500], ["Service fee", 295], ["Delivery", 525]] },
      { name: "shipping", paid: 3484,
        row: { id: "s", status: "paid", total_cents: 3484, paid_at: at, items_cents: 2500, premium_cents: 254, delivery_cents: 0, shipping_cents: 730, tax_cents: 0 },
        want: [["Items", 2500], ["Service fee", 254], ["Shipping", 730]] },
      { name: "first purchase with the setup fee", paid: 3420,
        row: { id: "f", status: "paid", total_cents: 3220, paid_at: at, items_cents: 3000, premium_cents: 220, delivery_cents: 0, shipping_cents: 0, tax_cents: 0 },
        want: [["Items", 3000], ["Service fee", 220], ["One-time account setup fee", 200]] },
    ];
    for (const c of cases) {
      it(c.name, () => {
        const r = orderReceipts([c.row], new Map(), new Map([[c.row.id, c.paid]]))[0];
        expect(r.lines!.map((l) => [l.label, l.cents])).toEqual(c.want);
        expect(r.chargedCents).toBe(c.paid);
        expect(r.lines!.reduce((sum, l) => sum + l.cents, 0)).toBe(c.paid);
        expect(r.cents).toBe(c.paid);
      });
    }

    it("an older read without the fee column shows only the total it can prove, never a guessed fee", () => {
      const r = orderReceipts([{ id: "o", status: "paid", total_cents: 2170, paid_at: at, items_cents: 2000 }], new Map(), new Map([["o", 2170]]))[0];
      expect(r.lines).toEqual([]);
      expect(r.chargedCents).toBe(2170);
    });

    it("a part refund shows under Total paid, and what stayed paid", async () => {
      tables.declutter_orders = [{ id: "o1", status: "handed_over", total_cents: 5320, paid_at: "2026-10-05T12:00:00Z",
        items_cents: 4500, premium_cents: 295, delivery_cents: 525, shipping_cents: 0, tax_cents: 0 }];
      tables.my_cart = [{ line_id: "l1", order_id: "o1", item_title: "Accent chair", my_side: "buyer" }];
      tables.my_paid = [{ order_id: "o1", paid_cents: 5320 }];
      tables.my_refunded = [{ order_id: "o1", refunded_cents: 525 }];
      renderAt(<Receipts />, "?tab=receipts");
      fireEvent.click(await screen.findByRole("button", { name: /Accent chair/ }));
      expect(document.querySelector("[data-receipt-detail]")!.textContent)
        .toBe("Paid onOct 5, 2026Items$45.00Service fee$2.95Delivery$5.25Total paid$53.20Refunded−$5.25You paid$47.95See the order");
      tables.my_paid = [];
      tables.my_refunded = [];
    });
  });

  it("an order counts only once it was paid (paid, handed over, or refunded and said so)", () => {
    const r = orderReceipts([
      { id: "a", status: "paid", total_cents: 100, paid_at: "2026-10-01T00:00:00Z" },
      { id: "b", status: "refunded", total_cents: 200, paid_at: "2026-10-02T00:00:00Z" },
      { id: "c", status: "awaiting_payment", total_cents: 300, paid_at: null },
      { id: "d", status: "expired", total_cents: 400, paid_at: "2026-10-03T00:00:00Z" },
    ]);
    expect(r.map((x) => [x.key, x.cents, x.note])).toEqual([["order-a", 100, ""], ["order-b", null, " · Refunded"]]);
  });
});
