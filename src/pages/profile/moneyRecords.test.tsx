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
 * @mutate src/pages/profile/PayoutHistory.tsx | {data.bank_last4 ? `To bank ending ${data.bank_last4}` : "To your bank"} | {"To your bank"}
 * @mutate src/pages/profile/Receipts.tsx |     .filter((o) => o.paid_at && (o.status === "paid" \|\| o.status === "handed_over" \|\| o.status === "refunded")) |     .filter((o) => !!o.paid_at)
 * @mutate src/pages/profile/Receipts.tsx |           .eq("buyer_id", uid!) |           .eq("seller_id", uid!)
 * @mutate src/pages/profile/Receipts.tsx |   receipts.push(...orderReceipts(orders.data ?? [])); |
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("@/hooks/useCurrentUser", () => ({
  useCurrentUser: () => ({ user: { id: "user-1" }, profile: null, loading: false }),
}));

let invokes: unknown[] = [];
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
    rpc: () => Promise.resolve({ data: [], error: null }),
    functions: {
      invoke: (_fn: string, opts: { body: Record<string, unknown> }) => {
        invokes.push(opts.body);
        if (opts.body.payout_id) {
          return Promise.resolve({
            data: {
              id: "po_1aaaaaaaa", amount_cents: 9345, currency: "usd", status: "pending", arrival_date: 1792800000, created: 1792700000,
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
import Receipts, { orderReceipts } from "./Receipts";

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
    await screen.findByText("Fees owed");
    expect(text()).toContain("Taken from your next payout");
    expect(text()).toContain("$3.10");
    expect(text()).toContain("Available in January if you qualify");
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
