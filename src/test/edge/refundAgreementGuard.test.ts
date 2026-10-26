/**
 * Board 141 (docs/OPEN.md Q2272): NO MONEY MOVES WITHOUT THE OTHER SIDE'S
 * RECORDED AGREEMENT.
 *
 * The owner's rule (2026-10-21): when the Helpr agrees to a poster's refund
 * request, the money moves automatically. The only automatic mover is the
 * service-only refund-request-sweep, which asks execute-dispute-split with the
 * service key. That door is the class this guards: a service-key caller must
 * never move money on a dispute unless public.refund_agreement_for_dispute
 * (20261021102943) proves a recorded 'agreed' answer by the job's Helpr to the
 * job's poster's request. Behaviour, on the REAL function source through the
 * edge harness (Stripe and Supabase are doubles):
 *   - no recorded agreement: 403, zero Stripe calls, the dispute not touched;
 *   - an unreadable proof: 503, zero Stripe calls (fail closed);
 *   - a proof for another dispute, or between other parties: refused before
 *     any Stripe call;
 *   - a recorded agreement: the split runs (one transfer, one refund), the
 *     ledger rows name no admin ('system'), the audit row names both parties;
 *   - the service key can never run the admin-only test-mode clear;
 * and on the sweep: it hands execute-dispute-split exactly the agreements
 * refund_agreements_due returns, with the service key; a 401/403/5xx answer
 * is a defect (the run goes red), a 409 refusal is an outcome the split
 * recorded on the dispute. The SQL proof itself (who agreed, which dispute,
 * which shares) is src/test/pglite/refundRequests.pglite.mjs (P1-P8); its
 * NEWEST definition must keep the predicates pinned below.
 *
 * @mutate supabase/functions/execute-dispute-split/index.ts |     if (!agreement) { |     if (false) {
 * @mutate supabase/functions/execute-dispute-split/index.ts |   const agreementCaller = serviceKeys.some((k) => sameSecret(authHeader, `Bearer ${k}`)); |   const agreementCaller = false;
 * @mutate supabase/functions/execute-dispute-split/index.ts |   return diff === 0; |   return true;
 * @mutate supabase/functions/execute-dispute-split/index.ts |   if (out.disputeId !== disputeId \|\| out.posterId === out.helperId) return null; |   if (out.posterId === out.helperId) return null;
 * @mutate supabase/functions/execute-dispute-split/index.ts |   if (agreement && (agreement.jobId !== job.id \|\| agreement.posterId !== job.customer_id \|\| agreement.helperId !== job.helper_id)) { |   if (false) {
 * @mutate supabase/functions/execute-dispute-split/index.ts |     if (agreementCaller \|\| adminUserId === null) return json({ error: "this action needs an admin" }, 403); |     if (adminUserId === "never") return json({ error: "this action needs an admin" }, 403);
 * @mutate supabase/functions/refund-request-sweep/index.ts |       if (res.status === 401 \|\| res.status === 403 \|\| res.status >= 500) { |       if (res.status >= 500) {
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |      AND r.answered_by = r.responder_id\n |
 * @mutate supabase/migrations/20261021102943_refund_requests.sql |      AND r.status = 'agreed'\n     AND r.answered_at IS NOT NULL | AND r.answered_at IS NOT NULL
 * @mutate supabase/functions/execute-dispute-split/index.ts |   if (exactAgreed && refundCents > refundableCents) { |   if (false) {
 * @mutate supabase/functions/execute-dispute-split/index.ts |     if (exactTaxCents === null \|\| exactTaxCents > 0) { |     if (exactTaxCents !== null && exactTaxCents > 0) {
 * @mutate supabase/functions/execute-dispute-split/index.ts |     if (exactTaxCents === null \|\| exactTaxCents > 0) { |     if (exactTaxCents === null) {
 * @mutate supabase/functions/execute-dispute-split/index.ts |   if (exactAgreed && agreement !== null && agreement.budgetCents !== Math.round(perHelperBudget * 100)) { |   if (false) {
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { blankComments, blankSqlComments } from "../helpers/blankNonCode";
import { effectiveDefs } from "../helpers/effectiveFunctionDefs";

const ROOT = resolve(__dirname, "../../..");
const SERVICE_KEY = "service-key";
const DISPUTE = "11111111-1111-4111-8111-111111111111";
const OTHER_DISPUTE = "99999999-9999-4999-8999-999999999999";
const JOB = "22222222-2222-4222-8222-222222222222";
const POSTER = "33333333-3333-4333-8333-333333333333";
const HELPR = "44444444-4444-4444-8444-444444444444";
const REQUEST = "55555555-5555-4555-8555-555555555555";
const STRANGER = "66666666-6666-4666-8666-666666666666";

/** A captured PaymentIntent's status (a Stripe value, not a disputes row's). */
const PI_PAID = "succeeded";
const PROOF = {
  request_id: REQUEST, dispute_id: DISPUTE, job_id: JOB, poster_id: POSTER, helper_id: HELPR,
  amount_cents: 2000, budget_cents: 4000, answered_at: "2026-10-21T10:00:00Z",
};

async function json(res: Response): Promise<Record<string, any>> {
  return JSON.parse(await res.text());
}

/** A decided-by-agreement $20-of-$40 dispute on a single-Helpr job in escrow. */
function seedAgreed() {
  scenario.authUser = null; // the service key is not a member's JWT
  scenario.reads.disputes = {
    rows: [{
      id: DISPUTE, job_id: JOB, status: "decided", decided_at: "2026-10-21T10:00:00Z",
      payout_split: { poster: 0.5, helper: 0.5 }, decision_text: "Agreed by both: $20 of the $40 price back.",
      execution_status: "pending", execution_error: null, execution_transfer_id: null, execution_refund_id: null,
    }],
  };
  scenario.reads.jobs = {
    rows: [{
      id: JOB, title: "Assemble a bookshelf", status: "completed", payment_status: "escrow",
      helper_id: HELPR, customer_id: POSTER, budget: 40, urgent_fee: 0, helper_fee_percent: null,
      is_group_job: false, helpers_needed: null, stripe_payment_intent_id: "pi_1", stripe_session_id: null,
    }],
  };
  scenario.reads.gift_cards = { rows: [] };
  scenario.reads.platform_settings = { rows: [{ helper_fee_percent: 12 }] };
  scenario.reads.profiles = {
    rows: [{ stripe_account_id: "acct_helper", full_name: "Jolie Thibodeaux", subscription_tier: "free", subscription_expires_at: null }],
  };
  scenario.reads.payout_transfers = { rows: [] };
  scenario.reads.payment_refunds = { rows: [] };
  scenario.writeSelectRows.disputes = [{ id: DISPUTE }];
  scenario.writeSelectRows.jobs = [{ id: JOB }];
  scenario.rpc.refund_agreement_for_dispute = PROOF;
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded", amount_received: 4400, latest_charge: "ch_1" });
  stripeMock.accounts.retrieve.mockResolvedValue({ id: "acct_helper", payouts_enabled: true, charges_enabled: true, capabilities: { transfers: "active" } });
  stripeMock.transfers.create.mockResolvedValue({ id: "tr_1", transfer_group: `job_${JOB}` });
  stripeMock.refunds.create.mockImplementation(async (p: any) => ({ id: "re_1", amount: p.amount, currency: "usd" }));
}

async function split(body: unknown = { dispute_id: DISPUTE }, auth = `Bearer ${SERVICE_KEY}`) {
  setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, STRIPE_SECRET_KEY: "sk_test_abc" });
  const fn = await loadEdgeFunction("execute-dispute-split");
  return fn.fetch(fn.request({ headers: { Authorization: auth }, body }));
}

const stripeMoneyCalls = () =>
  stripeMock.transfers.create.mock.calls.length + stripeMock.refunds.create.mock.calls.length;
const stripeAnyCalls = () => stripeMoneyCalls() + stripeMock.paymentIntents.retrieve.mock.calls.length;
const disputeWrites = () => scenario.writes.filter((w) => w.table === "disputes");

describe("execute-dispute-split: the service key moves money only on a recorded agreement", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  it("no recorded agreement: 403, no Stripe call at all, the dispute untouched", async () => {
    seedAgreed();
    scenario.rpc.refund_agreement_for_dispute = null;
    const res = await split();
    expect(res.status).toBe(403);
    expect((await json(res)).code).toBe("no_recorded_agreement");
    expect(stripeAnyCalls()).toBe(0);
    expect(disputeWrites()).toHaveLength(0);
    expect(scenario.rpcCalls?.some((c) => c.name === "refund_agreement_for_dispute" && (c.args as any)?.p_dispute_id === DISPUTE)).toBe(true);
  });

  it("an unreadable proof fails closed: 503, no Stripe call, the dispute untouched", async () => {
    seedAgreed();
    scenario.rpcErrors = { refund_agreement_for_dispute: { message: "connection reset", code: "08006" } };
    const res = await split();
    expect(res.status).toBe(503);
    expect(stripeAnyCalls()).toBe(0);
    expect(disputeWrites()).toHaveLength(0);
  });

  it("a proof for a different dispute is no proof", async () => {
    seedAgreed();
    scenario.rpc.refund_agreement_for_dispute = { ...PROOF, dispute_id: OTHER_DISPUTE };
    const res = await split();
    expect(res.status).toBe(403);
    expect(stripeAnyCalls()).toBe(0);
  });

  it("an 'agreement' with the same person on both sides is no proof", async () => {
    seedAgreed();
    scenario.rpc.refund_agreement_for_dispute = { ...PROOF, helper_id: POSTER };
    const res = await split();
    expect(res.status).toBe(403);
    expect(stripeAnyCalls()).toBe(0);
  });

  it("an agreement between other people than this job's poster and Helpr moves nothing", async () => {
    seedAgreed();
    scenario.rpc.refund_agreement_for_dispute = { ...PROOF, helper_id: STRANGER };
    const res = await split();
    expect(res.status).toBe(409);
    expect(stripeMoneyCalls()).toBe(0);
  });

  it("the service key cannot run an admin action (the test-mode clear)", async () => {
    seedAgreed();
    const res = await split({ dispute_id: DISPUTE, action: "clear_test_mode_records" });
    expect(res.status).toBe(403);
    expect(stripeAnyCalls()).toBe(0);
    expect(disputeWrites()).toHaveLength(0);
  });

  it("a wrong key is not the service door: it is an admin check, and fails", async () => {
    seedAgreed();
    const res = await split(undefined, "Bearer not-the-key");
    expect(res.status).toBe(401);
    expect(stripeAnyCalls()).toBe(0);
  });

  it("a recorded agreement: the split runs once, books 'system', and the audit names both parties", async () => {
    seedAgreed();
    const res = await split();
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
    // Q2298 (owner, 2026-10-21): EXACTLY the recorded amount ($20 of the
    // $40 price), read from the server's proof, never a share of the charge.
    const refundAmount = (stripeMock.refunds.create.mock.calls[0][0] as { amount: number }).amount;
    expect(refundAmount).toBe(2000);
    // Keyed on the dispute: Stripe replays rather than repeats a second run.
    expect((stripeMock.refunds.create.mock.calls[0][1] as { idempotencyKey: string }).idempotencyKey).toBe(`dispute-split-rf-${DISPUTE}`);
    const ledger = scenario.writes.find((w) => w.table === "payout_transfers" && w.op === "insert")?.payload as Record<string, unknown>;
    expect(ledger?.initiated_by).toBe("system");
    expect(ledger?.initiated_by_user_id).toBeNull();
    const audit = scenario.writes.find((w) => w.table === "admin_audit_log")?.payload as Record<string, any>;
    expect(audit?.action).toBe("execute_refund_agreement");
    expect(audit?.admin_id).toBeNull();
    expect(audit?.details).toMatchObject({ refund_request_id: REQUEST, agreed_poster_id: POSTER, agreed_helper_id: HELPR });
  });
});

describe("execute-dispute-split: an agreed part refunds EXACTLY the amount asked (Q2298)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  // Owner 2026-10-21: the rush fee comes back in the same share as the price (no cliff).
  // @mutate supabase/functions/execute-dispute-split/index.ts |     ? agreement.amountCents + rushBackCents | ? agreement.amountCents
  // @mutate supabase/functions/execute-dispute-split/index.ts |     ? (rushCents - rushBackCents) / 100 |     ? rushCents / 100
  it("the owner's example: $20 of a $40 job with a $10 rush fee refunds $25; the Helpr gets $20 + $5 of the rush fee less 12% of the price ($22)", async () => {
    seedAgreed();
    (scenario.reads.jobs.rows as Array<Record<string, unknown>>)[0].urgent_fee = 10;
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: PI_PAID, amount_received: 5500, latest_charge: "ch_1" });
    const res = await split();
    expect(res.status).toBe(200);
    // $20 asked + $5 (half the $10 rush fee) back to the poster.
    expect((stripeMock.refunds.create.mock.calls[0][0] as { amount: number }).amount).toBe(2500);
    // $20 + $5 - $2.40 (12% of the $20 price share) = $22.60, paid $22 (whole dollars, Q236).
    expect((stripeMock.transfers.create.mock.calls[0][0] as { amount: number }).amount).toBe(2200);
  });

  it("a TAXED charge moves nothing on the exact path (Q1998 unchecked): an admin settles it", async () => {
    seedAgreed();
    const paid = { id: "pi_1", status: PI_PAID, amount_received: 4800, latest_charge: "ch_1" };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ ...paid, amount_details: { tax: { total_tax_amount: 400 } } });
    const res = await split();
    expect(res.status).toBe(409);
    expect(stripeMoneyCalls()).toBe(0);
  });

  it("a tax read that fails counts as taxed: nothing moves", async () => {
    seedAgreed();
    stripeMock.checkout.sessions.list.mockRejectedValue(new Error("stripe down"));
    const res = await split();
    expect(res.status).toBe(409);
    expect(stripeMoneyCalls()).toBe(0);
  });

  it("a recorded price that is not the job's price moves nothing", async () => {
    seedAgreed();
    (scenario.reads.jobs.rows as Array<Record<string, unknown>>)[0].budget = 45;
    const res = await split();
    expect(res.status).toBe(409);
    expect(stripeMoneyCalls()).toBe(0);
  });

  it("more than the charge can return (after its kept card fee) moves nothing", async () => {
    seedAgreed();
    // $39.99 of a $40 price on a $40.00 charge: the Helpr's 1c rounds to $0,
    // so the escrow cap (refund + Helpr <= captured) passes; only the
    // refundable ceiling (captured less the kept card fee) refuses it.
    scenario.rpc.refund_agreement_for_dispute = { ...PROOF, amount_cents: 3999 };
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: PI_PAID, amount_received: 4000, latest_charge: "ch_1" });
    const res = await split();
    expect(res.status).toBe(409);
    expect(stripeMoneyCalls()).toBe(0);
  });
});

describe("refund-request-sweep: hands the split only the agreements the database hands out", () => {
  const DUE = { request_id: REQUEST, dispute_id: DISPUTE, job_id: JOB };
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  async function sweep(auth = `Bearer ${SERVICE_KEY}`) {
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY });
    const fn = await loadEdgeFunction("refund-request-sweep");
    return fn.fetch(fn.request({ method: "POST", headers: { Authorization: auth }, body: {} }));
  }
  const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

  it("refuses any caller without the service key", async () => {
    const fetchMock = answer(200, { success: true });
    vi.stubGlobal("fetch", fetchMock);
    const res = await sweep("Bearer member-jwt");
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(scenario.rpcCalls ?? []).toHaveLength(0);
  });

  it("settles each agreement through execute-dispute-split with the service key", async () => {
    scenario.rpc.refund_requests_sweep = { closed: 0, expired: 1, declined: 0, failed: 0, errors: [] };
    scenario.rpc.refund_agreements_due = [DUE];
    const fetchMock = answer(200, { success: true });
    vi.stubGlobal("fetch", fetchMock);
    const res = await sweep();
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.settled).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/functions/v1/execute-dispute-split");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SERVICE_KEY}`);
    expect(JSON.parse(String(init.body))).toEqual({ dispute_id: DISPUTE });
  });

  it("nothing handed out: no split is asked", async () => {
    scenario.rpc.refund_requests_sweep = { closed: 0, expired: 0, declined: 0, failed: 0, errors: [] };
    scenario.rpc.refund_agreements_due = [];
    const fetchMock = answer(200, { success: true });
    vi.stubGlobal("fetch", fetchMock);
    const res = await sweep();
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an unreadable hand-out is a red run, and no split is asked", async () => {
    scenario.rpc.refund_requests_sweep = { closed: 0, expired: 0, declined: 0, failed: 0, errors: [] };
    scenario.rpcErrors = { refund_agreements_due: { message: "timeout", code: "57014" } };
    const fetchMock = answer(200, { success: true });
    vi.stubGlobal("fetch", fetchMock);
    const res = await sweep();
    expect(res.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a 403 from the door (no recorded agreement for one it was handed) is a defect, never an outcome", async () => {
    scenario.rpc.refund_requests_sweep = { closed: 0, expired: 0, declined: 0, failed: 0, errors: [] };
    scenario.rpc.refund_agreements_due = [DUE];
    vi.stubGlobal("fetch", answer(403, { error: "no recorded agreement", code: "no_recorded_agreement" }));
    const res = await sweep();
    expect(res.status).toBe(500);
  });

  it("a 5xx from the split is a defect", async () => {
    scenario.rpc.refund_requests_sweep = { closed: 0, expired: 0, declined: 0, failed: 0, errors: [] };
    scenario.rpc.refund_agreements_due = [DUE];
    vi.stubGlobal("fetch", answer(502, { error: "Stripe transfer failed" }));
    expect((await sweep()).status).toBe(500);
  });

  it("a 409 refusal (no payout account, a hold) is an outcome the split recorded on the dispute", async () => {
    scenario.rpc.refund_requests_sweep = { closed: 0, expired: 0, declined: 0, failed: 0, errors: [] };
    scenario.rpc.refund_agreements_due = [DUE];
    vi.stubGlobal("fetch", answer(409, { error: "the Helpr has not finished setting up their payout account — nothing was moved" }));
    const res = await sweep();
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(body.settled).toBe(0);
    expect(body.refused).toHaveLength(1);
  });

  it("a held party's agreement (banned, suspended, ban review, payout hold): the split is never asked, ops is paged", async () => {
    scenario.rpc.refund_requests_sweep = { closed: 0, expired: 0, declined: 0, failed: 0, errors: [] };
    scenario.rpc.refund_agreements_due = [{ ...DUE, held: true }];
    const fetchMock = answer(200, { success: true });
    vi.stubGlobal("fetch", fetchMock);
    const res = await sweep();
    const body = await json(res);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body.held_for_admin).toBe(1);
    expect((slackAlerts as Array<{ title?: string }>).some((a) => a.title === "Agreed refund held for an admin")).toBe(true);
  });

  it("a request the SQL sweep could not process is a defect", async () => {
    scenario.rpc.refund_requests_sweep = { closed: 0, expired: 0, declined: 0, failed: 1, errors: ["x: boom"] };
    scenario.rpc.refund_agreements_due = [];
    vi.stubGlobal("fetch", answer(200, { success: true }));
    expect((await sweep()).status).toBe(500);
  });
});

describe("the SQL proof keeps its predicates (newest definition)", () => {
  const defs = effectiveDefs(join(ROOT, "supabase/migrations"));
  const newestBody = (name: string) => blankSqlComments(defs.get(name)?.stmt ?? "");
  const ws = (s: string) => s.replace(/\s+/g, " ");

  it("refund_agreement_for_dispute requires the Helpr's own recorded 'agreed' answer to the poster's request", () => {
    const body = ws(newestBody("refund_agreement_for_dispute"));
    expect(body.length).toBeGreaterThan(400);
    for (const must of [
      "r.dispute_id = p_dispute_id",
      "r.status = 'agreed'",
      "r.answered_at IS NOT NULL",
      "r.answered_by = r.responder_id",
      "r.answered_by <> r.requester_id",
      "d.status = 'decided'",
      "d.decided_via = 'agreement'",
      "d.agreed_poster_id = r.requester_id",
      "d.agreed_helper_id = r.answered_by",
      "j.customer_id = r.requester_id",
      "j.helper_id = r.answered_by",
    ]) expect(body, must).toContain(must);
  });

  it("the sweep asks the split only for dispute ids the hand-out returned, with the service key", () => {
    const src = blankComments(readFileSync(join(ROOT, "supabase/functions/refund-request-sweep/index.ts"), "utf8"));
    expect(src).toContain(`admin.rpc("refund_agreements_due"`);
    expect(src.match(/functions\/v1\/execute-dispute-split/g)).toHaveLength(1);
    expect(src).toContain("JSON.stringify({ dispute_id: row.dispute_id })");
    expect(src).toContain("verifyCronSecret(req)");
  });

  it("the split asks for the proof before its first Stripe call and before any refusal that writes", () => {
    const src = blankComments(readFileSync(join(ROOT, "supabase/functions/execute-dispute-split/index.ts"), "utf8"));
    const proofAt = src.indexOf(`rpc("refund_agreement_for_dispute"`);
    expect(proofAt).toBeGreaterThan(0);
    const handler = src.slice(src.indexOf("serve(async"));
    const firstStripe = src.indexOf("await stripe.", src.indexOf("serve(async"));
    const firstRefuse = src.indexOf("await refuse(", src.indexOf("serve(async"));
    expect(handler.length).toBeGreaterThan(1000);
    expect(proofAt).toBeLessThan(firstStripe);
    expect(proofAt).toBeLessThan(firstRefuse);
  });
});
