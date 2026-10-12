/**
 * Q1732 (OWNER DECISION 2026-10-12): the admin button that un-sticks a decided
 * dispute whose Stripe TEST-mode refund or transfer is already recorded in our
 * books. execute-dispute-split, action "clear_test_mode_records"
 * (supabase/functions/execute-dispute-split/clearTestModeRecords.ts).
 *
 * Pinned here, on the REAL function source through the edge harness:
 *   - every recorded id is asked about at Stripe, and ONLY "a similar object
 *     exists in test mode" lets the clear run; a live object or an unreadable
 *     one refuses with nothing changed;
 *   - the clear gets exactly the checked set, on the service client;
 *   - supersede runs on the ADMIN's own client (their JWT), never the service one;
 *   - idempotent: an already-superseded dispute does nothing;
 *   - the branch never touches the dispute's execution record (no markFailed).
 * The database half: src/test/pglite/testModeDisputeLedgerClears.pglite.mjs.
 *
 * @mutate supabase/functions/execute-dispute-split/clearTestModeRecords.ts |       if (isTestObjectUnderLiveKey(e)) { |       if (true) {
 * @mutate supabase/functions/execute-dispute-split/clearTestModeRecords.ts |     // Stripe returned it under the LIVE key: real money moved. Never cleared here.\n    return { |     // Stripe returned it under the LIVE key: real money moved. Never cleared here.\n    if (found) continue;\n    return {
 * @mutate supabase/functions/execute-dispute-split/clearTestModeRecords.ts |   if (transferRows.some((t) => !t.stripe_transfer_id)) { |   if (false) {
 * @mutate supabase/functions/execute-dispute-split/clearTestModeRecords.ts |   const { data: newDisputeId, error: supErr } = await adminClient.rpc( |   const { data: newDisputeId, error: supErr } = await supabaseAdmin.rpc(
 * @mutate supabase/functions/execute-dispute-split/clearTestModeRecords.ts |   if (clearErr) { |   if (false) {
 * @mutate supabase/functions/execute-dispute-split/clearTestModeRecords.ts |   if (dispute.status === "superseded") { |   if (false) {
 * @mutate supabase/functions/execute-dispute-split/clearTestModeRecords.ts |   if (reason.length < 10) { |   if (false) {
 * @mutate supabase/functions/execute-dispute-split/index.ts |     if (body.action !== CLEAR_TEST_MODE_ACTION) return json({ error: "unknown action" }, 400); |     if (false) return json({ error: "unknown action" }, 400);
 * Money review of 6b2434f20: #1 a cleared decision is never split again; #2 the
 * escrow itself must be a test object; #3 nothing recorded is refused (no loop).
 * @mutate supabase/functions/execute-dispute-split/index.ts |   if ((dispute.execution_error ?? "").startsWith(TEST_MODE_CLEARED_MARKER)) { |   if (false) {
 * @mutate supabase/functions/execute-dispute-split/clearTestModeRecords.ts |     return { status: 409, body: { error: `this job's payment ${escrowId} is LIVE money | return { status: 200, body: { error: `this job's payment ${escrowId} is LIVE money
 * @mutate supabase/functions/execute-dispute-split/clearTestModeRecords.ts |   if (!escrowKind \|\| !escrowId) { |   if (false) {
 * @mutate supabase/functions/execute-dispute-split/clearTestModeRecords.ts |   if (refundIds.length === 0 && transferIds.length === 0 && !alreadyCleared) { |   if (false) {
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { testModeUnderLiveKey, captureTestModeSkips } from "../helpers/testModeUnderLiveKey";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const ADMIN = { id: "admin-1", email: "admin@test.com" };
const AUTH = { Authorization: "Bearer admin-jwt" };
const DISPUTE_ID = "11111111-1111-4111-8111-111111111111";
const NEW_DISPUTE_ID = "22222222-2222-4222-8222-222222222222";
const RE = "re_test_recorded";
const TR = "tr_test_recorded";
const REASON = "checked at Stripe: both ids are test-mode objects";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_live_abc",
  });
  return loadEdgeFunction("execute-dispute-split");
}

function seedStuck(dispute: Record<string, unknown> = {}) {
  scenario.authUser = ADMIN;
  scenario.rpc.has_role = true;
  scenario.reads.disputes = {
    rows: [{ id: DISPUTE_ID, job_id: "job-1", status: "decided", execution_refund_id: RE, execution_transfer_id: null, ...dispute }],
  };
  scenario.reads.jobs = { rows: [{ id: "job-1", stripe_payment_intent_id: "pi_test_old", stripe_session_id: null }] };
  scenario.reads.payment_refunds = { rows: [{ stripe_refund_id: RE }] };
  scenario.reads.payout_transfers = { rows: [{ stripe_transfer_id: TR, status: "paid" }] };
  scenario.rpc.clear_test_mode_dispute_ledger = { action: "cleared", refunds_removed: 1, transfers_removed: 1 };
  scenario.rpc.rpc_supersede_dispute_decision = NEW_DISPUTE_ID;
  stripeMock.refunds.retrieve.mockRejectedValue(testModeUnderLiveKey("refund", RE));
  stripeMock.transfers.retrieve.mockRejectedValue(testModeUnderLiveKey("transfer", TR));
  stripeMock.paymentIntents.retrieve.mockRejectedValue(testModeUnderLiveKey("payment_intent", "pi_test_old"));
}

async function press(h: EdgeHarness, body: Record<string, unknown> = {}) {
  const res = await h.fetch(h.request({
    method: "POST",
    headers: AUTH,
    body: { dispute_id: DISPUTE_ID, action: "clear_test_mode_records", reason: REASON, ...body },
  }));
  return { status: res.status, body: JSON.parse(await res.text()) as Record<string, any> };
}
const calls = (name: string) => (scenario.rpcCalls ?? []).filter((c) => c.name === name);
/** The Authorization header the client an RPC ran on was built with. */
const authOf = (clientIndex: number | undefined) =>
  ((scenario.clients?.[clientIndex ?? -1]?.options as { global?: { headers?: Record<string, string> } } | undefined)
    ?.global?.headers?.Authorization) ?? null;

describe("execute-dispute-split: clear_test_mode_records (Q1732)", () => {
  let h: EdgeHarness;
  let skips: ReturnType<typeof captureTestModeSkips>;
  beforeEach(async () => {
    resetSupabaseMock();
    resetStripeMock();
    resetSharedMocks();
    skips = captureTestModeSkips();
    h = await load();
  });
  afterEach(() => {
    skips.restore();
    resetEnv();
  });

  it("every recorded id is a Stripe test object: clears exactly that set, then supersedes AS THE ADMIN", async () => {
    seedStuck();
    const r = await press(h);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ action: "superseded", new_dispute_id: NEW_DISPUTE_ID });
    expect(stripeMock.refunds.retrieve).toHaveBeenCalledWith(RE);
    expect(stripeMock.transfers.retrieve).toHaveBeenCalledWith(TR);
    const clear = calls("clear_test_mode_dispute_ledger");
    expect(clear).toHaveLength(1);
    expect(clear[0].args).toEqual({ _admin: ADMIN.id, _dispute_id: DISPUTE_ID, _refund_ids: [RE], _transfer_ids: [TR], _reason: REASON });
    expect(authOf(clear[0].client)).toBeNull(); // the service client
    const sup = calls("rpc_supersede_dispute_decision");
    expect(sup).toHaveLength(1);
    expect(authOf(sup[0].client)).toBe("Bearer admin-jwt");
    expect((sup[0].args as { _reason: string })._reason).toContain(REASON);
    expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith("pi_test_old");
    expect(skips.lines().map((l) => l.object).sort()).toEqual(["payment_intent", "refund", "transfer"]);
    // It settles nothing, so it never rewrites the dispute's execution record.
    expect(scenario.writes.filter((w) => w.table === "disputes")).toEqual([]);
  });

  it("a recorded refund Stripe returns under the LIVE key is real money: refused, nothing cleared", async () => {
    seedStuck();
    stripeMock.refunds.retrieve.mockResolvedValue({ id: RE, object: "refund", amount: 5000 });
    const r = await press(h);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/LIVE money/);
    expect(calls("clear_test_mode_dispute_ledger")).toHaveLength(0);
    expect(calls("rpc_supersede_dispute_decision")).toHaveLength(0);
  });

  it("a live transfer is refused too", async () => {
    seedStuck();
    stripeMock.transfers.retrieve.mockResolvedValue({ id: TR, object: "transfer" });
    const r = await press(h);
    expect(r.status).toBe(409);
    expect(calls("clear_test_mode_dispute_ledger")).toHaveLength(0);
  });

  it("an id Stripe cannot answer about (not the test-mode error) is refused as unknown: retry, nothing cleared", async () => {
    seedStuck();
    stripeMock.refunds.retrieve.mockRejectedValue(Object.assign(new Error("No such refund: 're_x'"), { code: "resource_missing", statusCode: 404 }));
    const r = await press(h);
    expect(r.status).toBe(502);
    expect(calls("clear_test_mode_dispute_ledger")).toHaveLength(0);
  });

  it("a money-moving transfer row with no Stripe id cannot be checked: refused before any Stripe call", async () => {
    seedStuck();
    scenario.reads.payout_transfers = { rows: [{ stripe_transfer_id: null, status: "pending" }] };
    const r = await press(h);
    expect(r.status).toBe(409);
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled();
    expect(calls("clear_test_mode_dispute_ledger")).toHaveLength(0);
  });

  it("the stamps are checked as well as the ledger rows", async () => {
    seedStuck({ execution_transfer_id: "tr_test_stamp" });
    const r = await press(h);
    expect(r.status).toBe(200);
    expect(stripeMock.transfers.retrieve).toHaveBeenCalledWith("tr_test_stamp");
    expect((calls("clear_test_mode_dispute_ledger")[0].args as { _transfer_ids: string[] })._transfer_ids).toEqual([TR, "tr_test_stamp"].sort());
  });

  it("pressed again after it went through: already_superseded, nothing called", async () => {
    seedStuck({ status: "superseded" });
    const r = await press(h);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ action: "already_superseded" });
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled();
    expect(calls("clear_test_mode_dispute_ledger")).toHaveLength(0);
    expect(calls("rpc_supersede_dispute_decision")).toHaveLength(0);
  });

  it("a short reason is refused before anything is read", async () => {
    seedStuck();
    const r = await press(h, { reason: "test" });
    expect(r.status).toBe(400);
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled();
  });

  it("the clear refusing (e.g. records changed since the check) stops there: no supersede", async () => {
    seedStuck();
    scenario.rpcErrors = { clear_test_mode_dispute_ledger: { message: "clear_ledger_changed" } };
    const r = await press(h);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/nothing was changed: clear_ledger_changed/);
    expect(calls("rpc_supersede_dispute_decision")).toHaveLength(0);
  });

  it("a clear that answers nothing is not a clear: no supersede", async () => {
    seedStuck();
    scenario.rpc.clear_test_mode_dispute_ledger = null;
    const r = await press(h);
    expect(r.status).toBe(500);
    expect(calls("rpc_supersede_dispute_decision")).toHaveLength(0);
  });

  it("a supersede that fails after the clear says so and to press again", async () => {
    seedStuck();
    scenario.rpcErrors = { rpc_supersede_dispute_decision: { message: "dispute_already_open" } };
    const r = await press(h);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/were cleared, but re-opening the dispute failed: dispute_already_open/);
  });

  it("a non-admin is refused by the function's admin gate", async () => {
    seedStuck();
    scenario.rpc.has_role = false;
    const r = await press(h);
    expect(r.status).toBe(401);
    expect(calls("clear_test_mode_dispute_ledger")).toHaveLength(0);
  });

  it("an unknown action is refused, never run as a split", async () => {
    seedStuck();
    const r = await press(h, { action: "something_else" });
    expect(r.status).toBe(400);
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it("review #2: a job whose ESCROW is live money is refused, nothing cleared", async () => {
    seedStuck();
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_test_old", status: "succeeded" });
    const r = await press(h);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/LIVE money/);
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled();
    expect(calls("clear_test_mode_dispute_ledger")).toHaveLength(0);
  });

  it("review #2: a job with no Stripe payment (a gift card only) is refused, nothing cleared", async () => {
    seedStuck();
    scenario.reads.jobs = { rows: [{ id: "job-1", stripe_payment_intent_id: null, stripe_session_id: null }] };
    const r = await press(h);
    expect(r.status).toBe(409);
    expect(calls("clear_test_mode_dispute_ledger")).toHaveLength(0);
  });

  it("review #2: an escrow Stripe cannot answer about is retry, nothing cleared", async () => {
    seedStuck();
    stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error("connection reset"));
    const r = await press(h);
    expect(r.status).toBe(502);
    expect(calls("clear_test_mode_dispute_ledger")).toHaveLength(0);
  });

  it("review #2: a checkout-session-only job is checked through its session", async () => {
    seedStuck();
    scenario.reads.jobs = { rows: [{ id: "job-1", stripe_payment_intent_id: null, stripe_session_id: "cs_test_old" }] };
    stripeMock.checkout.sessions.retrieve.mockRejectedValue(testModeUnderLiveKey("checkout.session", "cs_test_old"));
    const r = await press(h);
    expect(r.status).toBe(200);
    expect(stripeMock.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_test_old");
  });

  it("review #3: nothing recorded and never cleared is refused (re-opening would only loop)", async () => {
    seedStuck({ execution_refund_id: null });
    scenario.reads.payment_refunds = { rows: [] };
    scenario.reads.payout_transfers = { rows: [] };
    const r = await press(h);
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/nothing to clear/);
    expect(calls("rpc_supersede_dispute_decision")).toHaveLength(0);
  });

  it("review #1: cleared earlier but the re-open failed: pressing again re-opens it", async () => {
    seedStuck({ execution_refund_id: null, execution_error: "test-mode records cleared by an admin (checked at Stripe): x" });
    scenario.reads.payment_refunds = { rows: [] };
    scenario.reads.payout_transfers = { rows: [] };
    scenario.rpc.clear_test_mode_dispute_ledger = { action: "nothing_to_clear" };
    const r = await press(h);
    expect(r.status).toBe(200);
    expect(r.body.action).toBe("superseded");
  });

  it("review #1: a cleared decision is never split again, and the refusal keeps the marker (no markFailed)", async () => {
    seedStuck({ execution_refund_id: null, execution_status: "failed", execution_error: "test-mode records cleared by an admin (checked at Stripe): x" });
    const res = await h.fetch(h.request({ method: "POST", headers: AUTH, body: { dispute_id: DISPUTE_ID } }));
    expect(res.status).toBe(409);
    expect(await res.text()).toMatch(/re-open/);
    expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
    expect(scenario.writes.filter((w) => w.table === "disputes")).toEqual([]);
  });
});
