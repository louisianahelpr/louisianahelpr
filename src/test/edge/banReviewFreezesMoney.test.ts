/**
 * Q1324 (owner 2026-10-05 "ban now, admin settles"; lh-money-escrow
 * re-review of f943c56b3): while a ban settlement review is OPEN for an
 * account, every job of that account, as poster and as Helpr, is frozen
 * against the automatic money paths until an admin confirms or lifts the ban.
 * Before this, auto-release-payment checked only the Helpr's payout hold, so a
 * banned POSTER's started job could be completed and paid to the Helpr during
 * the review (chargeback exposure if the card was stolen), and the confirm
 * then found it completed and did nothing.
 *
 * The database refuses the moves too (claim trigger, escrow -> payout_pending:
 * src/test/pglite/banEvasionCardBankName.pglite.mjs); this file pins that the
 * crons treat a frozen job as an OUTCOME and move nothing, and that the one
 * admin unban path lifts a review attributably.
 *
 * Runs the REAL sources through the edge harness.
 *
 * @mutate supabase/functions/auto-release-payment/index.ts |       if (!banReview.ok \|\| frozenByBanReview(banReview, job)) {\n        results.push( |       if (false) {\n        results.push(
 * @mutate supabase/functions/auto-release-payment/index.ts |         if (!banReview.ok \|\| frozenByBanReview(banReview, job)) {\n          payoutResults.push( |         if (false) {\n          payoutResults.push(
 * @mutate supabase/functions/auto-resolve-disputes/index.ts |       if (!banReview.ok \|\| frozenByBanReview(banReview, job)) { |       if (false) {
 * @mutate supabase/functions/_shared/banReview.ts |   return (!!job.customer_id && lookup.users.has(job.customer_id)) \|\| (!!job.helper_id && lookup.users.has(job.helper_id)); |   return !!job.helper_id && lookup.users.has(job.helper_id);
 * @mutate supabase/functions/auto-tip-charge/index.ts |       if (frozenByBanReview(banReview, c as { customer_id?: string \| null; helper_id?: string \| null })) { |       if (false) {
 * @mutate supabase/functions/auto-tip-charge/index.ts |     if (!banReview.ok) { |     if (false) {
 * @mutate supabase/functions/create-payment/index.ts |       if (tipReview === "payer") throw new PublicError(PAYER_UNDER_REVIEW); |       void tipReview;
 * @mutate supabase/functions/create-payment/index.ts |       if (tipHold.kind === "held" \|\| tipReview === "counterparty") { |       if (tipHold.kind === "held") {
 * @mutate supabase/functions/create-payment/index.ts |   if (lookup.users.has(payerId)) return "payer"; |   if (false) return "payer";
 * @mutate supabase/functions/admin-user-actions/index.ts |         const { error: liftErr } = await admin.rpc('lift_ban_settlement_review', { |         const { error: liftErr } = await admin.rpc('lift_ban_settlement_review_v0', {
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";

const CRON_SECRET = "test-only-cron";
const POSTER = "poster-under-review";
const HELPR = "innocent-helpr";
const json = async (res: Response) => JSON.parse(await res.text()) as Record<string, unknown>;
const toPayoutPending = () =>
  scenario.writes.filter(
    (w) => w.table === "jobs" && w.op === "update" && (w.payload as { payment_status?: string })?.payment_status === "payout_pending",
  );

beforeEach(() => {
  resetEnv();
  resetStripeMock();
  resetSupabaseMock();
  resetSharedMocks();
});
afterEach(() => vi.unstubAllGlobals());

async function autoRelease(phase2: boolean) {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    CRON_SECRET,
    RELEASE_PAYOUT_AUTO: phase2 ? "1" : "0",
  });
  const fn = await loadEdgeFunction("auto-release-payment");
  return fn.fetch(fn.request({ method: "POST", url: "https://edge.test/auto-release-payment", headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));
}

function seedDueJob() {
  scenario.reads.jobs = {
    selectOverrides: [
      { includes: "revision_acceptance_deadline", result: { rows: [] } },
      { includes: "revision_deadline", result: { rows: [] } },
    ],
    rows: [{
      id: "job-1", title: "Gutters", helper_id: HELPR, customer_id: POSTER, budget: 200, platform_fee_amount: 16,
      urgent_fee: 0, poster_completed_at: null, helper_completed_at: new Date(Date.now() - 48 * 3600e3).toISOString(),
      stripe_session_id: "cs_1", stripe_payment_intent_id: "pi_1", status: "in_progress", is_group_job: false,
      helpers_needed: 1, helper_fee_percent: 8, is_seed: false,
    }],
  };
  scenario.reads.gift_cards = { rows: [] };
  scenario.reads.profiles = { rows: [] };
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_1", status: "succeeded" });
}

describe("auto-release-payment: a review freezes the poster's and the Helpr's jobs", () => {
  it("Phase 1: a banned poster's finished job is NOT moved to payout_pending while the review is open", async () => {
    seedDueJob();
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: POSTER }] };

    const body = await json(await autoRelease(false));

    expect(toPayoutPending(), "the job was completed and queued to pay during the review").toHaveLength(0);
    expect(JSON.stringify(body)).toContain("ban_review");
  });

  it("Phase 1 still releases when nobody on the job is under review (inventory floor)", async () => {
    seedDueJob();
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: "someone-else" }] };
    await autoRelease(false);
    expect(toPayoutPending().length).toBeGreaterThan(0);
  });

  it("an unreadable review list releases nothing this run (fail closed)", async () => {
    seedDueJob();
    scenario.reads.ban_settlement_queue = { error: { message: "connection reset", code: "08006" } };
    await autoRelease(false);
    expect(toPayoutPending()).toHaveLength(0);
  });

  it("Phase 2: a matured payout on a banned poster's job is not handed to release-payout", async () => {
    scenario.reads.jobs = {
      rows: [],
      selectOverrides: [{
        includes: "payout_scheduled_at",
        result: { rows: [{ id: "job-p", title: "Paint", helper_id: HELPR, customer_id: POSTER, budget: 100, urgent_fee: 0, is_group_job: false, helpers_needed: 1, payout_scheduled_at: new Date(0).toISOString(), is_seed: false }] },
      }],
    };
    scenario.reads.profiles = { rows: [] };
    scenario.reads.gift_cards = { rows: [] };
    scenario.reads.payout_transfers = { rows: [] };
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: POSTER }] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const body = await json(await autoRelease(true));

    expect(fetchMock).not.toHaveBeenCalled();
    expect((body.payoutResults as Array<{ status: string }>)[0].status).toBe("ban_review");
  });
});

describe("auto-resolve-disputes: no dispute on a frozen job is auto-resolved", () => {
  it("a past-deadline dispute on a banned poster's job moves no money", async () => {
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_abc", CRON_SECRET });
    scenario.reads.jobs = {
      rows: [{
        id: "job-d", title: "Fence", helper_id: HELPR, customer_id: POSTER, budget: 100, dispute_reason: "x",
        disputed_at: new Date(Date.now() - 100 * 3600e3).toISOString(), dispute_deadline: new Date(Date.now() - 3600e3).toISOString(),
        dispute_status: "open", payment_status: "escrow", stripe_payment_intent_id: "pi_d", stripe_session_id: null,
        disputed_by: POSTER, is_group_job: false,
      }],
    };
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: POSTER }] };
    const fn = await loadEdgeFunction("auto-resolve-disputes");
    const res = await fn.fetch(fn.request({ method: "POST", url: "https://edge.test/auto-resolve-disputes", headers: { Authorization: `Bearer ${CRON_SECRET}` }, body: {} }));

    expect(res.status).toBe(200);
    expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    expect(scenario.writes.filter((w) => w.table === "jobs" && w.op === "update")).toHaveLength(0);
  });
});

describe("admin-user-actions: an admin unban lifts the review, attributably", () => {
  async function setBan(banStatus: string) {
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon" });
    scenario.authUser = { id: "admin-1", email: "admin@example.test" };
    scenario.rpc.has_role = true;
    scenario.reads.profiles = { rows: [{ user_id: POSTER, email: "p@example.test", full_name: "P" }] };
    const fn = await loadEdgeFunction("admin-user-actions");
    return fn.fetch(fn.request({ headers: { Authorization: "Bearer admin-jwt" }, body: { action: "set_ban_status", userId: POSTER, banStatus } }));
  }

  it("moving out of a ban calls lift_ban_settlement_review with the acting admin first", async () => {
    scenario.rpc.lift_ban_settlement_review = { lifted: true };
    const res = await setBan("active");
    expect(res.status).toBe(200);
    const lift = (scenario.rpcCalls ?? []).find((c) => c.name === "lift_ban_settlement_review");
    expect(lift?.args).toEqual({ p_user_id: POSTER, p_admin_id: "admin-1", p_ban_status: "active" });
  });

  it("a lift that fails stops the unban (no profile write)", async () => {
    scenario.rpcErrors = { lift_ban_settlement_review: { message: "boom", code: "XX000" } };
    const res = await setBan("active");
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(scenario.writes.some((w) => w.table === "profiles" && w.op === "update")).toBe(false);
  });

  it("a ban is not a lift", async () => {
    await setBan("permanently_banned");
    expect((scenario.rpcCalls ?? []).some((c) => c.name === "lift_ban_settlement_review")).toBe(false);
  });
});

// Q1414 (lh-money-escrow review of fbdfa47c7, #5): confirm_message_ban wrote
// its user_bans row BEFORE the status write that an open review refuses, so a
// refusal left an active ban row behind. It now asks first and writes nothing.
// @mutate supabase/functions/admin-user-actions/index.ts |         if (openReviews && openReviews.length > 0) { |         if (false) {
describe("admin-user-actions: confirm_message_ban on an account under an open ban review (Q1414)", () => {
  async function confirm(review: Array<{ id: string }> | { error: { message: string } }) {
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", SUPABASE_ANON_KEY: "anon" });
    scenario.authUser = { id: "admin-1", email: "admin@example.test" };
    scenario.rpc.has_role = true;
    scenario.reads.profiles = { rows: [{ user_id: POSTER, email: "p@example.test", full_name: "P" }] };
    scenario.reads.user_violations = { rows: [{ violation_type: "message_violation" }] };
    scenario.reads.user_bans = { rows: [] };
    scenario.reads.ban_settlement_queue = Array.isArray(review) ? { rows: review } : review;
    const fn = await loadEdgeFunction("admin-user-actions");
    return fn.fetch(fn.request({ headers: { Authorization: "Bearer admin-jwt" }, body: { action: "confirm_message_ban", userId: POSTER, violationId: "v-1" } }));
  }

  it("writes no ban row and no status, answers 409 ban_review_open", async () => {
    const res = await confirm([{ id: "review-1" }]);
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe("ban_review_open");
    expect(scenario.writes.some((w) => w.table === "user_bans")).toBe(false);
    expect(scenario.writes.some((w) => w.table === "profiles" && w.op === "update")).toBe(false);
  });

  it("an unreadable review state fails closed: no ban row", async () => {
    const res = await confirm({ error: { message: "boom" } });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(scenario.writes.some((w) => w.table === "user_bans")).toBe(false);
  });

  it("no open review: the confirm goes ahead as before", async () => {
    scenario.writeSelectRows.user_bans = [{ id: "ban-1" }];
    const res = await confirm([]);
    expect(res.status).toBe(200);
    expect(scenario.writes.some((w) => w.table === "user_bans" && w.op === "insert")).toBe(true);
  });
});

describe("auto-tip-charge: no auto-tip is charged on a frozen job", () => {
  async function run(): Promise<Response> {
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_abc", CRON_SECRET });
    scenario.rpc.auto_tip_candidates = [
      { job_id: "job-t", customer_id: POSTER, helper_id: HELPR, budget: 100, tip_amount: 10 },
    ];
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
    scenario.adminUsers = { [POSTER]: { email: "poster@test.com" } };
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_1" }] });
    stripeMock.paymentMethods.list.mockResolvedValue({ data: [{ id: "pm_1" }] });
    stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_auto_1", status: "succeeded" });
    const fn = await loadEdgeFunction("auto-tip-charge");
    return fn.fetch(fn.request({ headers: { Authorization: `Bearer ${CRON_SECRET}` } }));
  }

  it("the poster under review: nothing charged, the tip held for after the decision", async () => {
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: POSTER }] };
    const res = await run();
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.charged).toBe(0);
    expect(body.held).toBe(1);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("the Helpr under review: nothing charged", async () => {
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: HELPR }] };
    const body = await json(await run());
    expect(body.charged).toBe(0);
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });

  it("someone else under review: the tip is charged (inventory floor)", async () => {
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: "someone-else" }] };
    const body = await json(await run());
    expect(body.charged).toBe(1);
    expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
  });

  it("an unreadable review list charges nothing and the run reports an error (fail closed)", async () => {
    scenario.reads.ban_settlement_queue = { error: { message: "connection reset", code: "08006" } };
    const res = await run();
    expect(res.status).toBeGreaterThanOrEqual(500);
    // Named, not a TypeError from reading users off a failed lookup.
    expect(await res.text()).toContain("ban review read failed");
    expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe("create-payment: a payment touching an account under review is refused, without naming the review", () => {
  const PAYER = { id: POSTER, email: "poster@test.com" };
  const NEUTRAL = /can't go through right now/i;

  async function call(body: Record<string, unknown>): Promise<Response> {
    setEnv({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon-key", SUPABASE_SERVICE_ROLE_KEY: "service-key", STRIPE_SECRET_KEY: "sk_test_abc123" });
    scenario.authUser = PAYER;
    stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_existing" }] });
    stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_x", url: "https://checkout.stripe.test/x" });
    const fn = await loadEdgeFunction("create-payment");
    return fn.fetch(fn.request({ headers: { Authorization: "Bearer test-jwt" }, body }));
  }
  const noCheckout = () => expect(stripeMock.checkout.sessions.create).not.toHaveBeenCalled();

  it("escrow: the payer is under review", async () => {
    scenario.reads.jobs = { rows: [{ id: "job-e", customer_id: POSTER, helper_id: HELPR, budget: 100, status: "accepted", payment_status: "unpaid" }] };
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: POSTER }] };
    const body = await json(await call({ action: "escrow", jobId: "job-e" }));
    expect(String(body.error)).toMatch(NEUTRAL);
    noCheckout();
  });

  it("escrow: a Helpr under review is NOT a refusal the poster can see (the payout is refused in the database)", async () => {
    scenario.reads.jobs = { rows: [{ id: "job-e", customer_id: POSTER, helper_id: HELPR, budget: 100, status: "accepted", payment_status: "unpaid" }] };
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: HELPR }] };
    const body = await json(await call({ action: "escrow", jobId: "job-e" }));
    expect(String(body.error ?? "")).not.toMatch(NEUTRAL);
  });

  it("tip: a Helpr under review gets EXACTLY the ordinary payout-hold reply, so the poster cannot tell a review from a hold", async () => {
    scenario.reads.jobs = { rows: [{ id: "job-t", customer_id: POSTER, helper_id: HELPR, status: "completed", title: "Mow" }] };
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
    scenario.reads.payout_holds = { rows: [] };
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: HELPR }] };
    const res = await call({ action: "tip", jobId: "job-t", amount: 15 });
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: "This Helpr can't receive tips right now. Please try again later.", code: "payout_held" }); // PAYOUT_HELD_CODE in _shared/payoutHold.ts
    noCheckout();
  });

  it("tip: the payer is under review", async () => {
    scenario.reads.jobs = { rows: [{ id: "job-t", customer_id: POSTER, helper_id: HELPR, status: "completed", title: "Mow" }] };
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: POSTER }] };
    const body = await json(await call({ action: "tip", jobId: "job-t", amount: 15 }));
    expect(String(body.error)).toMatch(NEUTRAL);
    noCheckout();
  });

  it("tip: an unreadable review list refuses the payment (fail closed)", async () => {
    scenario.reads.jobs = { rows: [{ id: "job-t", customer_id: POSTER, helper_id: HELPR, status: "completed", title: "Mow" }] };
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
    scenario.reads.ban_settlement_queue = { error: { message: "connection reset", code: "08006" } };
    const res = await call({ action: "tip", jobId: "job-t", amount: 15 });
    expect(res.status).not.toBe(200);
    noCheckout();
  });

  it("tip: nobody on the job under review goes through (inventory floor)", async () => {
    scenario.reads.jobs = { rows: [{ id: "job-t", customer_id: POSTER, helper_id: HELPR, status: "completed", title: "Mow" }] };
    scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper" }] };
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: "someone-else" }] };
    const res = await call({ action: "tip", jobId: "job-t", amount: 15 });
    expect(res.status).toBe(200);
    expect(stripeMock.checkout.sessions.create).toHaveBeenCalledTimes(1);
  });

  it("recurring_visit: the payer is under review", async () => {
    scenario.reads.jobs = { rows: [{ id: "parent-1", title: "Weekly clean", status: "in_progress", series_ended_on: null, customer_id: POSTER }] };
    scenario.reads.ban_settlement_queue = { rows: [{ user_id: POSTER }] };
    const body = await json(await call({ action: "recurring_visit", paymentId: "11111111-2222-4333-8444-555555555555" }));
    expect(String(body.error)).toMatch(NEUTRAL);
    noCheckout();
  });
});
