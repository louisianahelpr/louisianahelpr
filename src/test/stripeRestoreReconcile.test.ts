/**
 * DR-006: after a database restore to T, Stripe still holds every charge,
 * transfer and refund since T; the database does not. A transfer in that gap
 * is a helper the payout crons would pay twice. scripts/check-stripe-restore-drift.mjs
 * lists Stripe's objects since T and looks each up by id; these pin its halves.
 *
 *   1. INVENTORY (class): every Stripe-id-looking column in types.ts is matched
 *      (DB_ID_COLUMNS) or excluded with a reason (NOT_MATCHED), both ways.
 *   2. Grading, on shapes read from Stripe TEST mode on 2026-09-25 (100
 *      PaymentIntents, 49 transfers, 100 refunds in 14 days; metadata job_id /
 *      transfer_group job_<id> / refund payment_intent).
 *   3. Read-only and test-mode by default.
 *
 * @mutate scripts/lib/stripeRestoreReconcile.mjs |     { table: "payout_transfers", column: "stripe_transfer_id" },\n |
 * @mutate scripts/lib/stripeRestoreReconcile.mjs |     { table: "declutter_orders", column: "stripe_payment_intent_id" },\n |
 * @mutate scripts/lib/stripeRestoreReconcile.mjs |     { table: "declutter_refunds", column: "stripe_refund_ref" },\n |
 * @mutate scripts/lib/stripeRestoreReconcile.mjs |       if (ID_PREFIX[kind].test(String(v))) ids.add(String(v)); |       if (true) ids.add(String(v));
 * @mutate scripts/lib/stripeRestoreReconcile.mjs |     if (dbIds.has(o.id)) { |     if (true) {
 * @mutate scripts/lib/stripeRestoreReconcile.mjs |     if (!/^(sk\|rk)_test_/.test(key)) throw | if (false) throw
 * @mutate scripts/lib/stripeRestoreReconcile.mjs |   if (md.kind === "platform_topup" \|\| | if (false &&
 * @mutate scripts/lib/stripeRestoreReconcile.mjs |   if (pi?.id && Object.hasOwn(KNOWN_ONE_OFF_PIS, pi.id)) | if (false)
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CANDIDATE_COLUMN,
  DB_ID_COLUMNS,
  collectDbIds,
  NOT_MATCHED,
  gradeKind,
  isStripeList,
  keyForMode,
  parseSince,
} from "../../scripts/lib/stripeRestoreReconcile.mjs";
import { blankComments } from "./helpers/blankNonCode";
import { publicTableColumns } from "./helpers/publicTableColumns";

describe("Stripe id inventory (class, from types.ts)", () => {
  const columns = publicTableColumns();
  const candidates = columns.filter((c) => CANDIDATE_COLUMN.test(c.split(".")[1]) && !/(enabled|verified)/.test(c));
  const matched = Object.values(DB_ID_COLUMNS).flat().map((c) => `${c.table}.${c.column}`);

  it("found the money columns (cannot pass vacuously)", () => {
    expect(candidates.length).toBeGreaterThan(20);
    expect(matched.length).toBeGreaterThanOrEqual(10);
  });

  it("every Stripe-id column is matched or excluded with a reason", () => {
    expect(candidates.filter((c) => !matched.includes(c) && !(c in NOT_MATCHED))).toEqual([]);
  });

  it("both lists name only columns that exist, and do not overlap", () => {
    expect([...matched, ...Object.keys(NOT_MATCHED)].filter((c) => !columns.includes(c))).toEqual([]);
    expect(matched.filter((c) => c in NOT_MATCHED)).toEqual([]);
  });
});

describe("gradeKind", () => {
  it("a transfer Stripe made after T with no payout_transfers row is the finding", () => {
    const tr = { id: "tr_after", amount: 4250, created: 1790000000, reversed: false, transfer_group: "job_j1", destination: "acct_1", metadata: { job_id: "j1", helper_id: "h1" } };
    const g = gradeKind("transfer", [tr, { ...tr, id: "tr_known" }], new Set(["tr_known"]));
    expect(g.matched).toBe(1);
    expect(g.missing).toHaveLength(1);
    expect(g.missing[0].id).toBe("tr_after");
    expect(g.missing[0].hint).toContain("job_id=j1");
    expect(g.missing[0].hint).toContain("transfer_group=job_j1");
  });

  it("an abandoned checkout is not money; a boost, onboarding fee or subscription is listed, never graded missing", () => {
    const g = gradeKind(
      "payment_intent",
      [
        { id: "pi_abandoned", status: "requires_payment_method", metadata: {} },
        { id: "pi_boost", status: "succeeded", amount: 500, created: 1, metadata: { kind: "job_boost", job_id: "j1" } },
        { id: "pi_sub", status: "succeeded", amount: 999, created: 1, invoice: "in_1", metadata: {} },
        { id: "pi_onb", status: "succeeded", amount: 500, created: 1, metadata: { kind: "onboarding_fee" } },
        { id: "pi_topup", status: "succeeded", amount: 50000, created: 1, metadata: { kind: "platform_topup" } },
        { id: "pi_topup_old", status: "succeeded", amount: 50000, created: 1, description: "TEST-mode platform balance top-up (stripe-test-topup.yml)", metadata: {} },
        { id: "pi_3UIpdrKp2H4b7tEC1666cTsf", status: "succeeded", amount: 50000, created: 1, metadata: {} },
        { id: "pi_job", status: "requires_capture", amount: 10000, created: 1, metadata: { job_id: "j2" } },
      ],
      new Set(),
    );
    expect(g.ignored).toBe(1);
    expect(g.unlinkable.map((u) => u.id)).toEqual(["pi_boost", "pi_sub", "pi_onb", "pi_topup", "pi_topup_old", "pi_3UIpdrKp2H4b7tEC1666cTsf"]);
    expect(g.missing.map((m) => m.id)).toEqual(["pi_job"]);
  });

  it("a failed refund is not money moved; a succeeded one with no row is", () => {
    const g = gradeKind("refund", [
      { id: "re_failed", status: "failed" },
      { id: "re_ok", status: "succeeded", amount: 100, created: 1, payment_intent: "pi_1" },
    ], new Set());
    expect(g.ignored).toBe(1);
    expect(g.missing.map((m) => m.id)).toEqual(["re_ok"]);
  });
});

describe("Declutter and Shops money is in the restore check (Q2230, before the Declutter switch goes past testers)", () => {
  // What the database holds after the restore, column by column (the script reads these same columns).
  const rows: Record<string, unknown[]> = {
    "declutter_orders.stripe_payment_intent_id": ["pi_DclOrderKept"],
    "declutter_refunds.stripe_payment_intent_id": ["pi_DclSupersededKept"],
    "declutter_refunds.stripe_refund_ref": ["re_DclKept", "manual-placeholder"],
    "declutter_hand_refunds.stripe_refund_id": ["pyr_DclHandKept"],
    "declutter_payouts.stripe_transfer_id": ["tr_DclSellerKept"],
    "helpr_task_payouts.stripe_transfer_id": ["tr_DclHelprKept"],
    "shop_orders.stripe_payment_intent_id": ["pi_ShopKept"],
    "shop_payouts.stripe_transfer_id": ["tr_ShopKept"],
  };
  const pi = (id: string) => ({ id, status: "succeeded", amount: 2500, created: 1790000000, metadata: { kind: "declutter_order" } });

  it("every Declutter / Shops money column is matched, and a hand refund table without an id column pages by its key", () => {
    const matched = Object.values(DB_ID_COLUMNS).flat().map((c) => `${c.table}.${c.column}`);
    for (const c of [
      "declutter_orders.stripe_payment_intent_id", "declutter_refunds.stripe_payment_intent_id", "declutter_refunds.stripe_refund_ref",
      "declutter_hand_refunds.stripe_payment_intent_id", "declutter_hand_refunds.stripe_refund_id",
      "declutter_delivery_refunds.stripe_payment_intent_id", "declutter_delivery_refunds.stripe_refund_ref",
      "declutter_payouts.stripe_transfer_id", "helpr_task_payouts.stripe_transfer_id",
      "shop_orders.stripe_payment_intent_id", "shop_payouts.stripe_transfer_id",
    ]) {
      expect(matched, c).toContain(c);
      expect(c in NOT_MATCHED, `${c} is still excluded`).toBe(false);
    }
    expect(Object.values(DB_ID_COLUMNS).flat().filter((c) => c.table === "declutter_hand_refunds").map((c) => c.orderBy)).toEqual(["stripe_refund_id", "stripe_refund_id"]);
  });

  it("a Declutter PaymentIntent, refund or payout Stripe made after T with no row is MISSING; the kept ones match", () => {
    const pis = collectDbIds("payment_intent", rows).ids;
    const g = gradeKind("payment_intent", [pi("pi_DclOrderKept"), pi("pi_DclSupersededKept"), pi("pi_ShopKept"), pi("pi_DclLost")], pis);
    expect(g.matched).toBe(3);
    expect(g.missing.map((m) => m.id)).toEqual(["pi_DclLost"]);

    const re = collectDbIds("refund", rows);
    const refund = (id: string) => ({ id, status: "succeeded", amount: 2500, created: 1790000000, payment_intent: "pi_DclOrderKept" });
    const gr = gradeKind("refund", [refund("re_DclKept"), refund("pyr_DclHandKept"), refund("re_DclLost")], re.ids);
    expect(gr.matched).toBe(2);
    expect(gr.missing.map((m) => m.id)).toEqual(["re_DclLost"]);

    const tr = collectDbIds("transfer", rows).ids;
    const transfer = (id: string) => ({ id, amount: 2000, created: 1790000000, reversed: false, destination: "acct_seller" });
    const gt = gradeKind("transfer", [transfer("tr_DclSellerKept"), transfer("tr_DclHelprKept"), transfer("tr_ShopKept"), transfer("tr_DclLost")], tr);
    expect(gt.missing.map((m) => m.id)).toEqual(["tr_DclLost"]);
  });

  it("a value that is not a Stripe id of its kind never matches and is listed", () => {
    const re = collectDbIds("refund", rows);
    expect(re.ids.has("manual-placeholder")).toBe(false);
    expect(re.rejected).toEqual(["declutter_refunds.stripe_refund_ref = manual-placeholder"]);
    // A refund id is never taken for a PaymentIntent, nor the other way round.
    expect(collectDbIds("payment_intent", { "declutter_orders.stripe_payment_intent_id": ["re_x"] }).ids.size).toBe(0);
  });

  it("the script reads the columns through collectDbIds and pages by orderBy", () => {
    const src = blankComments(readFileSync(resolve(__dirname, "../../scripts/check-stripe-restore-drift.mjs"), "utf8"));
    expect(src).toContain("const { ids, rejected } = collectDbIds(kind, values);");
    expect(src).toContain("&order=${orderBy ?? \"id\"}.asc&");
  });
});

describe("safety", () => {
  it("uses the test key by default and refuses a key of the other mode", () => {
    expect(keyForMode("test", { STRIPE_TEST_SECRET_KEY: "sk_test_x" })).toBe("sk_test_x");
    expect(() => keyForMode("test", { STRIPE_TEST_SECRET_KEY: "sk_live_x" })).toThrow(/not a test-mode key/);
    expect(() => keyForMode("live", { STRIPE_SECRET_KEY: "sk_test_x" })).toThrow(/live-mode key/);
    expect(() => keyForMode("test", {})).toThrow(/not set/);
    // No default mode: after launch a silent "test" would read the sandbox.
    expect(() => keyForMode("", { STRIPE_TEST_SECRET_KEY: "sk_test_x" })).toThrow(/--mode is required/);
  });

  it("needs a restore point", () => {
    expect(() => parseSince("")).toThrow(/--since is required/);
    expect(parseSince("2026-09-24T09:37:00Z")).toBe(Date.parse("2026-09-24T09:37:00Z") / 1000);
    expect(parseSince("1790000000")).toBe(1790000000);
    expect(() => parseSince("yesterday")).toThrow(/not a time/);
  });

  it("recognises only a real Stripe list", () => {
    expect(isStripeList({ object: "list", data: [], has_more: false })).toBe(true);
    expect(isStripeList([])).toBe(false);
    expect(isStripeList({ data: [] })).toBe(false);
  });

  it("the script only ever GETs (no Stripe or database write)", () => {
    const code = blankComments(readFileSync(resolve(__dirname, "../../scripts/check-stripe-restore-drift.mjs"), "utf8"));
    expect(code).not.toMatch(/method:\s*["'`](POST|PUT|PATCH|DELETE)/i);
    expect(code).toMatch(/fetch\(url, \{ headers, signal/);
  });
});
