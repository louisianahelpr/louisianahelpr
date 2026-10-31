/**
 * Board 177, ONE PAYOUT: stripe-payouts answers what one bank payout carried.
 *
 * linesFor turns Stripe's balance transactions for the payout into the lines
 * the screen shows, named from the caller's own ledgers by the platform
 * transfer each `payment` came from (source.source_transfer). The lines must
 * always add up to the payout, whatever the ledgers name. The handler test
 * runs the REAL function: the payout id is format-checked, the Stripe reads
 * run on the CALLER's own connected account, never one from the body, and the
 * ledger reads are scoped to the caller as payee.
 *
 * @mutate supabase/functions/stripe-payouts/payoutDetail.ts |     if (bt.type === "payout") continue; |
 * @mutate supabase/functions/stripe-payouts/payoutDetail.ts |       else lines.push({ ...mine[0], amount_cents: bt.net }); |       else lines.push({ ...mine[0] });
 * @mutate supabase/functions/stripe-payouts/payoutDetail.ts | if (mine.length > 1 && parts === bt.net) | if (mine.length > 1)
 * @mutate supabase/functions/stripe-payouts/payoutDetail.ts |   if (payout.automatic === false) { |   if (false) {
 * @mutate supabase/functions/stripe-payouts/payoutDetail.ts |     if (owed <= 0 && setupFee <= 0) return [{ kind, label, amount_cents: 0, href }]; |     if (true) return [{ kind, label, amount_cents: 0, href }];
 * @mutate supabase/functions/stripe-payouts/payoutDetail.ts |     const owed = r.debt_cents - setupFee; |     const owed = r.debt_cents;
 * @mutate supabase/functions/stripe-payouts/payoutDetail.ts | const PAYOUT_ID = /^po_[A-Za-z0-9]{6,64}$/; | const PAYOUT_ID = /^po_/;
 * @mutate supabase/functions/stripe-payouts/payoutDetail.ts | admin.from("payout_transfers").select("stripe_transfer_id, job_id, jobs(title)").eq("helper_id", userId) | admin.from("payout_transfers").select("stripe_transfer_id, job_id, jobs(title)")
 * @mutate supabase/functions/stripe-payouts/index.ts |     if (!isPayoutId(payoutId)) { | if (false) {
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { blankComments } from "../helpers/blankNonCode";
import { isPayoutId, linesFor, payoutDetail, type PayoutLine } from "../../../supabase/functions/stripe-payouts/payoutDetail";

const ROOT = join(__dirname, "../../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// deno-lint-ignore no-explicit-any
const bt = (o: Record<string, unknown>) => o as any;
const payment = (tr: string | null, net: number) => bt({ type: "payment", net, amount: net, source: { id: "py_1", source_transfer: tr } });

describe("linesFor: what one payout carried", () => {
  const named = new Map<string, PayoutLine[]>([
    ["tr_job", [{ kind: "job", label: "Mow front and back yard", amount_cents: 0, href: "/jobs/j1" }]],
    ["tr_sale", [
      { kind: "sale", label: "Vintage film camera", amount_cents: 6400, href: "/declutter?tab=selling" },
      { kind: "fee_owed", label: "Fee owed, paid back", amount_cents: -310, href: null },
    ]],
  ]);

  it("names each transfer from the ledger, splits a sale and its fee, and adds up to the payout", () => {
    const lines = linesFor([
      payment("tr_job", 3255),
      payment("tr_sale", 6090),
      bt({ type: "payout", net: -9345, amount: -9345, source: { id: "po_1" } }),
    ], named);
    expect(lines.map((l) => [l.label, l.amount_cents])).toEqual([
      ["Mow front and back yard", 3255],
      ["Vintage film camera", 6400],
      ["Fee owed, paid back", -310],
    ]);
    expect(lines.reduce((s, l) => s + l.amount_cents, 0)).toBe(9345);
    expect(lines[0].href).toBe("/jobs/j1");
  });

  it("a single named line takes Stripe's net, not the ledger's figure", () => {
    const lines = linesFor([payment("tr_job", 1234)], named);
    expect(lines).toEqual([{ kind: "job", label: "Mow front and back yard", amount_cents: 1234, href: "/jobs/j1" }]);
  });

  it("keeps what no ledger claims, under a plain label, so the sum still holds", () => {
    const lines = linesFor([payment("tr_unknown", 500), payment(null, 250), bt({ type: "payment_refund", net: -200, source: { id: "pyr_1" } })], named);
    expect(lines.map((l) => [l.kind, l.label, l.amount_cents])).toEqual([
      ["other", "Payment", 500],
      ["other", "Payment", 250],
      ["reversal", "Taken back", -200],
    ]);
  });

  it("a split whose parts do not add up to what Stripe moved is one line at Stripe's net", () => {
    const lines = linesFor([payment("tr_sale", 6000)], named);
    expect(lines).toEqual([{ kind: "sale", label: "Vintage film camera", amount_cents: 6000, href: "/declutter?tab=selling" }]);
  });

  it("reads an expanded source_transfer object as well as an id", () => {
    const lines = linesFor([bt({ type: "payment", net: 900, source: { id: "py_2", source_transfer: { id: "tr_job" } } })], named);
    expect(lines[0].label).toBe("Mow front and back yard");
  });
});

describe("isPayoutId", () => {
  it("accepts a Stripe payout id and nothing else", () => {
    expect(isPayoutId("po_1QxYzAbCdEf")).toBe(true);
    for (const bad of ["", "po_", "tr_1QxYzAbCdEf", "po_1Qx/../x", "po_1QxYz AbCd", 42, null, undefined]) {
      expect(isPayoutId(bad)).toBe(false);
    }
  });
});

describe("payoutDetail reads the caller's own account and ledgers", () => {
  it("reads the payout and its transactions on the given account and names lines from rows scoped to the caller", async () => {
    const stripeCalls: [string, unknown, unknown][] = [];
    const stripe = {
      payouts: {
        retrieve: (id: string, params: unknown, opts: unknown) => {
          stripeCalls.push(["payouts.retrieve", { id, params }, opts]);
          return Promise.resolve({ id, amount: 3255, currency: "usd", status: "paid", arrival_date: 1, created: 0, destination: { id: "ba_1", last4: "0193" } });
        },
      },
      balanceTransactions: {
        list: (params: unknown, opts: unknown) => {
          stripeCalls.push(["balanceTransactions.list", params, opts]);
          return { autoPagingToArray: () => Promise.resolve([payment("tr_job", 3255), payment("tr_sale", 6090), bt({ type: "payout", net: -9345, source: { id: "po_1" } })]) };
        },
      },
    };
    const reads: [string, string, unknown][] = [];
    const rows: Record<string, unknown[]> = {
      payout_transfers: [{ stripe_transfer_id: "tr_job", job_id: "j1", jobs: { title: "Mow front and back yard" } }],
      // $3.10 owed plus the one-time $2 setup fee, which sits inside debt_cents.
      declutter_payouts: [{ stripe_transfer_id: "tr_sale", order_id: "o1", items_cents: 6600, debt_cents: 510, setup_fee_cents: 200, amount_cents: 6090 }],
      declutter_cart_items: [{ order_id: "o1", declutter_items: { title: "Vintage film camera" } }],
    };
    const admin = {
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = (col: string, v: unknown) => { reads.push([table, col, v]); return b; };
        b.in = () => b;
        b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve);
        return b;
      },
    };
    // deno-lint-ignore no-explicit-any
    const d = await payoutDetail(stripe as any, admin, "user-1", "acct_mine", "po_1aaaaaaaa");
    expect(d.bank_last4).toBe("0193");
    // A sale that paid a fee back is two lines, the sale's items and the fee, from the payout row's own parts.
    expect(d.lines).toEqual([
      { kind: "job", label: "Mow front and back yard", amount_cents: 3255, href: "/jobs/j1" },
      { kind: "sale", label: "Vintage film camera", amount_cents: 6600, href: "/declutter?tab=selling" },
      { kind: "fee_owed", label: "Fee owed, paid back", amount_cents: -310, href: null },
      { kind: "fee_owed", label: "One-time setup fee", amount_cents: -200, href: null },
    ]);
    expect(stripeCalls.map((c) => c[0])).toEqual(["payouts.retrieve", "balanceTransactions.list"]);
    expect(stripeCalls.length).toBeGreaterThan(1);
    for (const c of stripeCalls) expect(c[2]).toEqual({ stripeAccount: "acct_mine" });
    // Six ledgers plus the sale's line titles: every read is recorded.
    expect(reads.length).toBeGreaterThan(5);
    expect(stripeCalls.find((c) => c[0] === "balanceTransactions.list")?.[1]).toMatchObject({ payout: "po_1aaaaaaaa", expand: ["data.source"] });
    for (const [table, col] of [
      ["payout_transfers", "helper_id"], ["cancellation_fee_transfers", "helper_id"], ["declutter_payouts", "seller_id"],
      ["shop_payouts", "shop_orders.seller_id"], ["helpr_task_payouts", "helpr_id"], ["referral_credits", "user_id"],
    ]) expect(reads, table).toContainEqual([table, col, "user-1"]);
  });

  it("a manual payout (an instant cash-out) is one line and never asks Stripe to filter by it", async () => {
    let listed = false;
    const stripe = {
      payouts: { retrieve: () => Promise.resolve({ id: "po_1", amount: 4200, currency: "usd", status: "paid", arrival_date: 1, created: 0, destination: { last4: "4821" }, automatic: false }) },
      balanceTransactions: { list: () => { listed = true; return { autoPagingToArray: () => Promise.reject(new Error("Stripe: cannot filter by a manual payout")) }; } },
    };
    // deno-lint-ignore no-explicit-any
    const d = await payoutDetail(stripe as any, {}, "user-1", "acct_mine", "po_1aaaaaaaa");
    expect(listed).toBe(false);
    expect(d.lines).toEqual([{ kind: "other", label: "Instant cash-out", amount_cents: 4200, href: null }]);
    expect(d.bank_last4).toBe("4821");
  });

  it("a ledger read error throws instead of answering a wrong label", async () => {
    const stripe = {
      payouts: { retrieve: () => Promise.resolve({ id: "po_1", amount: 1, currency: "usd", status: "paid", arrival_date: 1, created: 0, destination: null }) },
      balanceTransactions: { list: () => ({ autoPagingToArray: () => Promise.resolve([payment("tr_x", 1)]) }) },
    };
    const admin = {
      from: () => {
        const b: Record<string, unknown> = {};
        b.select = () => b; b.eq = () => b; b.in = () => b;
        b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve);
        return b;
      },
    };
    // deno-lint-ignore no-explicit-any
    await expect(payoutDetail(stripe as any, admin, "user-1", "acct_mine", "po_1aaaaaaaa")).rejects.toBeTruthy();
  });
});

describe("stripe-payouts routes a payout_id to the detail on the caller's own account", () => {
  const src = blankComments(read("supabase/functions/stripe-payouts/index.ts"));
  it("format-checks the id and answers 400 on a bad one", () => {
    expect(src).toMatch(/if \(!isPayoutId\(payoutId\)\) \{[\s\S]{0,200}status: 400/);
  });
  it("reads the payout on accountId, the caller's own profile row, never the body", () => {
    expect(src).toMatch(/payoutDetail\(stripe, supabaseAdmin, user\.id, accountId, payoutId\)/);
    expect(src).not.toMatch(/body\??\.(stripe_account|account_id|accountId)/);
  });
});
