/**
 * Q2225: admin-settle-ref-lookup, the read-only Stripe lookup behind "Mark settled by hand"
 * (HeldForReview). One case per warning, the admin gate, the row read AS THE CALLER, the
 * payee-decided key with one look under the other key (lead 11-03), and the audit row.
 * Runs the REAL function through the edge harness.
 *
 * @mutate supabase/functions/admin-settle-ref-lookup/index.ts |       if (row.payee_account && destination !== row.payee_account) { |       if (false) {
 * @mutate supabase/functions/admin-settle-ref-lookup/index.ts |       if (Number(t.amount) !== expected) { |       if (false) {
 * @mutate supabase/functions/admin-settle-ref-lookup/index.ts |       if (Number(t.amount_reversed ?? 0) > 0) { |       if (false) {
 * @mutate supabase/functions/admin-settle-ref-lookup/index.ts |       if (row.stripe_group && t.transfer_group && t.transfer_group !== row.stripe_group) { |       if (false) {
 * @mutate supabase/functions/admin-settle-ref-lookup/index.ts |       if (r.status === "failed" \|\| r.status === "canceled") { |       if (false) {
 * @mutate supabase/functions/admin-settle-ref-lookup/index.ts |       if (row.stripe_group?.startsWith("pi_") && pi !== row.stripe_group) { |       if (false) {
 * @mutate supabase/functions/admin-settle-ref-lookup/index.ts |         if (p.status === "failed" \|\| p.status === "canceled") { |         if (false) {
 * @mutate supabase/functions/admin-settle-ref-lookup/index.ts |         const p = await stripe.payouts.retrieve(ref, {}, { stripeAccount: row.payee_account }); |         const p = await stripe.payouts.retrieve(ref);
 * @mutate supabase/functions/admin-settle-ref-lookup/index.ts |   if (!isAdmin) return json({ error: "Forbidden" }, 403); |   void isAdmin;
 * @mutate supabase/functions/admin-settle-ref-lookup/index.ts |   const row = ((Array.isArray(held) ? held : []) as HeldRow[]).find((r) => r.kind === kind && r.id === id); |   const row = ((Array.isArray(held) ? held : []) as HeldRow[]).find((r) => r.id === id);
 * @mutate supabase/functions/admin-settle-ref-lookup/index.ts |         await readRef(otherStripe); |         throw e;
 * @mutate supabase/functions/admin-settle-ref-lookup/index.ts |       action: "settle_ref_lookup", |       action: "settle_ref_lookup_x",
 * @mutate supabase/functions/admin-settle-ref-lookup/index.ts | await userClient.rpc("admin_payouts_held_for_review"); | await admin.rpc("admin_payouts_held_for_review");
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const LIVE_KEY = "sk_live_real_money";
const TEST_KEY = "sk_test_sandbox";
const ADMIN = { id: "admin-1", email: "owner@test.com" };
const PAYEE = "55555555-5555-4555-8555-555555555555";
const ROW_ID = "66666666-6666-4666-8666-666666666666";

const payoutRow = (over: Record<string, unknown> = {}) => ({
  kind: "declutter", id: ROW_ID, payee_id: PAYEE, payee_account: "acct_payee", amount_cents: 4200,
  reason: "payout_account_rejected", held_at: "2026-11-01T00:00:00Z", stripe_group: "declutter_order_o1", gave_up: false, ...over,
});
const refundRow = (over: Record<string, unknown> = {}) => ({
  kind: "declutter_refund", id: ROW_ID, payee_id: PAYEE, payee_account: null, amount_cents: 1500,
  reason: "data_defect", held_at: "2026-11-01T00:00:00Z", stripe_group: "pi_order", gave_up: false, ...over,
});

async function call(body: Record<string, unknown>, headers: Record<string, string> = { Authorization: "Bearer admin-jwt" }) {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service",
    STRIPE_SECRET_KEY: LIVE_KEY, STRIPE_TEST_SECRET_KEY: TEST_KEY,
  });
  const fn = await loadEdgeFunction("admin-settle-ref-lookup");
  const res = await fn.fetch(fn.request({ headers, body }));
  return { status: res.status, body: JSON.parse(await res.text()) as { warnings?: Array<{ code: string; text: string }>; found?: Record<string, unknown>; error?: string } };
}
const codes = (b: { warnings?: Array<{ code: string }> }) => (b.warnings ?? []).map((w) => w.code);
const audits = () => scenario.writes.filter((w) => w.table === "admin_audit_log" && w.op === "insert").map((w) => w.payload as Record<string, unknown>);

describe("admin-settle-ref-lookup (Q2225)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
    stripeMock.__trackClients = true;
    scenario.authUser = ADMIN;
    scenario.rpc.has_role = true;
    scenario.rpc.admin_payouts_held_for_review = [payoutRow()];
    scenario.reads.test_accounts = { rows: [] };
    scenario.reads.profiles = { rows: [] };
    scenario.writeSelectRows["admin_audit_log:insert"] = [{ id: "audit-1" }];
  });

  describe("the gate", () => {
    it("no bearer: 401, nothing read", async () => {
      const { status } = await call({ kind: "declutter", id: ROW_ID, ref: "tr_abcdef1" }, {});
      expect(status).toBe(401);
      expect(stripeMock.__calls).toEqual([]);
    });
    it("a non-admin: 403, nothing read from Stripe, no audit", async () => {
      scenario.rpc.has_role = false;
      const { status } = await call({ kind: "declutter", id: ROW_ID, ref: "tr_abcdef1" });
      expect(status).toBe(403);
      expect(stripeMock.__calls).toEqual([]);
      expect(audits()).toEqual([]);
    });
    it("a failed role lookup: 503, never 403", async () => {
      scenario.rpcErrors = { has_role: { message: "connection reset" } };
      const { status } = await call({ kind: "declutter", id: ROW_ID, ref: "tr_abcdef1" });
      expect(status).toBe(503);
    });
    it("a ref that is not tr_/po_/re_: 400, nothing read", async () => {
      const { status } = await call({ kind: "declutter", id: ROW_ID, ref: "ch_abcdef1" });
      expect(status).toBe(400);
      expect(stripeMock.__calls).toEqual([]);
    });
    it("a row that is no longer held (or another kind with the same id): 404, nothing read", async () => {
      const { status } = await call({ kind: "shop", id: ROW_ID, ref: "tr_abcdef1" });
      expect(status).toBe(404);
      expect(stripeMock.__calls).toEqual([]);
    });
  });

  describe("a transfer (tr_)", () => {
    it("that matches: no warnings, read on the LIVE key for a real payee, and audited", async () => {
      stripeMock.transfers.retrieve.mockResolvedValue({ id: "tr_abcdef1", destination: "acct_payee", amount: 4200, amount_reversed: 0, transfer_group: "declutter_order_o1" });
      const { status, body } = await call({ kind: "declutter", id: ROW_ID, ref: "tr_abcdef1" });
      expect(status).toBe(200);
      expect(codes(body)).toEqual([]);
      expect(stripeMock.__calls.filter((c) => c.method === "transfers.retrieve").map((c) => c.key)).toEqual([LIVE_KEY]);
      expect(audits()).toEqual([expect.objectContaining({
        admin_id: "admin-1", action: "settle_ref_lookup", target_type: "declutter", target_id: ROW_ID,
        details: { ref: "tr_abcdef1", mode: "live", warnings: [] },
      })]);
      // The held row is read AS THE CALLER (the publishable-key client carrying the admin's JWT), so the
      // RPC's own has_role check applies; never on the service-role client.
      const read = (scenario.rpcCalls ?? []).find((c) => c.name === "admin_payouts_held_for_review");
      expect(scenario.clients?.[read!.client as number]?.key).toBe("anon");
    });
    it("to another account: other_destination", async () => {
      stripeMock.transfers.retrieve.mockResolvedValue({ destination: "acct_someone_else", amount: 4200, amount_reversed: 0, transfer_group: "declutter_order_o1" });
      const { body } = await call({ kind: "declutter", id: ROW_ID, ref: "tr_abcdef1" });
      expect(codes(body)).toEqual(["other_destination"]);
      expect(body.warnings![0].text).toContain("acct_someone_else");
    });
    it("for another amount: other_amount (against the amount the admin typed when sent)", async () => {
      stripeMock.transfers.retrieve.mockResolvedValue({ destination: "acct_payee", amount: 4200, amount_reversed: 0, transfer_group: "declutter_order_o1" });
      const { body } = await call({ kind: "declutter", id: ROW_ID, ref: "tr_abcdef1", amount_cents: 2000 });
      expect(codes(body)).toEqual(["other_amount"]);
      expect(body.warnings![0].text).toContain("$42.00");
      expect(body.warnings![0].text).toContain("$20.00");
    });
    it("reversed: reversed", async () => {
      stripeMock.transfers.retrieve.mockResolvedValue({ destination: "acct_payee", amount: 4200, amount_reversed: 4200, transfer_group: "declutter_order_o1" });
      const { body } = await call({ kind: "declutter", id: ROW_ID, ref: "tr_abcdef1" });
      expect(codes(body)).toEqual(["reversed"]);
    });
    it("in another transfer group: other_group", async () => {
      stripeMock.transfers.retrieve.mockResolvedValue({ destination: "acct_payee", amount: 4200, amount_reversed: 0, transfer_group: "declutter_order_o2" });
      const { body } = await call({ kind: "declutter", id: ROW_ID, ref: "tr_abcdef1" });
      expect(codes(body)).toEqual(["other_group"]);
    });
    it("a TEST payee is read on the TEST key", async () => {
      scenario.reads.test_accounts = { rows: [{ user_id: PAYEE }] };
      scenario.reads.profiles = { rows: [{ user_id: PAYEE, is_seed: true, email: "seller@example.com" }] };
      stripeMock.transfers.retrieve.mockResolvedValue({ destination: "acct_payee", amount: 4200, amount_reversed: 0, transfer_group: "declutter_order_o1" });
      await call({ kind: "declutter", id: ROW_ID, ref: "tr_abcdef1" });
      expect(stripeMock.__calls.filter((c) => c.method === "transfers.retrieve").map((c) => c.key)).toEqual([TEST_KEY]);
    });
  });

  describe("not in the payee's mode", () => {
    it("found under the other key: other_mode (not not_found), and the answer names the mode it is in", async () => {
      stripeMock.transfers.retrieve
        .mockRejectedValueOnce(Object.assign(new Error("No such transfer"), { code: "resource_missing", statusCode: 404 }))
        .mockResolvedValueOnce({ destination: "acct_payee", amount: 4200, amount_reversed: 0, transfer_group: "declutter_order_o1" });
      const { status, body } = await call({ kind: "declutter", id: ROW_ID, ref: "tr_abcdef1" });
      expect(status).toBe(200);
      expect(codes(body)).toEqual(["other_mode"]);
      expect(body.warnings![0].text).toContain("TEST mode");
      expect(body.found?.mode).toBe("test");
      expect(stripeMock.__calls.filter((c) => c.method === "transfers.retrieve").map((c) => c.key)).toEqual([LIVE_KEY, TEST_KEY]);
    });
    it("in neither mode: not_found", async () => {
      stripeMock.transfers.retrieve.mockRejectedValue(Object.assign(new Error("No such transfer"), { code: "resource_missing", statusCode: 404 }));
      const { body } = await call({ kind: "declutter", id: ROW_ID, ref: "tr_abcdef1" });
      expect(codes(body)).toEqual(["not_found"]);
    });
    it("a Stripe outage is a 502 telling the admin to check by hand, not a warning", async () => {
      stripeMock.transfers.retrieve.mockRejectedValue(Object.assign(new Error("api down"), { statusCode: 500 }));
      const { status, body } = await call({ kind: "declutter", id: ROW_ID, ref: "tr_abcdef1" });
      expect(status).toBe(502);
      expect(body.error).toContain("by hand");
    });
  });

  describe("a refund (re_)", () => {
    beforeEach(() => { scenario.rpc.admin_payouts_held_for_review = [refundRow()]; });
    it("that matches: no warnings", async () => {
      stripeMock.refunds.retrieve.mockResolvedValue({ amount: 1500, status: "succeeded", payment_intent: "pi_order" });
      const { body } = await call({ kind: "declutter_refund", id: ROW_ID, ref: "re_abcdef1" });
      expect(codes(body)).toEqual([]);
    });
    it("failed: failed", async () => {
      stripeMock.refunds.retrieve.mockResolvedValue({ amount: 1500, status: "failed", payment_intent: "pi_order" });
      const { body } = await call({ kind: "declutter_refund", id: ROW_ID, ref: "re_abcdef1" });
      expect(codes(body)).toEqual(["failed"]);
    });
    it("for another payment: other_payment", async () => {
      stripeMock.refunds.retrieve.mockResolvedValue({ amount: 1500, status: "succeeded", payment_intent: "pi_other" });
      const { body } = await call({ kind: "declutter_refund", id: ROW_ID, ref: "re_abcdef1" });
      expect(codes(body)).toEqual(["other_payment"]);
    });
  });

  describe("a bank payout (po_)", () => {
    it("is read on the payee's connected account; a failed one warns failed", async () => {
      stripeMock.payouts.retrieve.mockResolvedValue({ amount: 4200, status: "failed" });
      const { body } = await call({ kind: "declutter", id: ROW_ID, ref: "po_abcdef1" });
      expect(codes(body)).toEqual(["failed"]);
      expect(stripeMock.payouts.retrieve).toHaveBeenCalledWith("po_abcdef1", {}, { stripeAccount: "acct_payee" });
    });
    it("with no payout account on file: no_payee_account, nothing read", async () => {
      scenario.rpc.admin_payouts_held_for_review = [payoutRow({ payee_account: null })];
      const { body } = await call({ kind: "declutter", id: ROW_ID, ref: "po_abcdef1" });
      expect(codes(body)).toEqual(["no_payee_account"]);
      expect(stripeMock.payouts.retrieve).not.toHaveBeenCalled();
    });
  });
});
