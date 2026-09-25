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
 * @mutate scripts/lib/stripeRestoreReconcile.mjs |     if (dbIds.has(o.id)) { |     if (true) {
 * @mutate scripts/lib/stripeRestoreReconcile.mjs |     if (!/^(sk\|rk)_test_/.test(key)) throw | if (false) throw
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CANDIDATE_COLUMN,
  DB_ID_COLUMNS,
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

  it("an abandoned checkout is not money; a boost or subscription is listed, never graded missing", () => {
    const g = gradeKind(
      "payment_intent",
      [
        { id: "pi_abandoned", status: "requires_payment_method", metadata: {} },
        { id: "pi_boost", status: "succeeded", amount: 500, created: 1, metadata: { kind: "job_boost", job_id: "j1" } },
        { id: "pi_sub", status: "succeeded", amount: 999, created: 1, invoice: "in_1", metadata: {} },
        { id: "pi_job", status: "requires_capture", amount: 10000, created: 1, metadata: { job_id: "j2" } },
      ],
      new Set(),
    );
    expect(g.ignored).toBe(1);
    expect(g.unlinkable.map((u) => u.id)).toEqual(["pi_boost", "pi_sub"]);
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

describe("safety", () => {
  it("uses the test key by default and refuses a key of the other mode", () => {
    expect(keyForMode("test", { STRIPE_TEST_SECRET_KEY: "sk_test_x" })).toBe("sk_test_x");
    expect(() => keyForMode("test", { STRIPE_TEST_SECRET_KEY: "sk_live_x" })).toThrow(/not a test-mode key/);
    expect(() => keyForMode("live", { STRIPE_SECRET_KEY: "sk_test_x" })).toThrow(/live-mode key/);
    expect(() => keyForMode("test", {})).toThrow(/not set/);
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
