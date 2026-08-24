/**
 * Unit tests for the `execute-dispute-split` Supabase edge function.
 *
 * This is the function that turns a RECORDED dispute split (poster X% /
 * helper Y%, written by `rpc_decide_dispute`) into real money: one Stripe
 * transfer to the Helpr's Connect account and one refund to the poster, both
 * off the job's original PaymentIntent.
 *
 * What these tests pin down, in rough order of how much a bug would cost:
 *   - the money math, to the cent, including the shared commission helper and
 *     the non-refundable Stripe processing floor;
 *   - endpoint parity — a 100/0 split must settle like a full release and a
 *     0/100 like a full refund, or the slider lies at its extremes;
 *   - the hard cap that refuses to move more than the escrow captured;
 *   - every fail-closed precondition (group job, Pay-It-Forward, wrong state,
 *     uncaptured charge, unparseable split, non-admin caller);
 *   - idempotency, both flavours: a re-invoke of a settled split is refused,
 *     and a HALF-settled split resumes on the leg that didn't finish rather
 *     than re-paying the leg that did.
 *
 * Runs the REAL function source via the edge harness — only Stripe, Supabase,
 * Slack, and the Deno runtime are doubles. `_shared/helperFees.ts` and
 * `_shared/stripeFees.ts` are the genuine modules (see harness.ts), so the
 * commission ladder and the 2.9%+$0.30 floor under test are production's.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock, type SupabaseScenario } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";

/** `slackAlerts` is `unknown[]` by design — narrow it once for assertions. */
const alerts = () => slackAlerts as Array<{ title?: string }>;

const ADMIN = { id: "admin-1", email: "admin@test.com" };
const AUTH = { Authorization: "Bearer admin-jwt" };
const DISPUTE_ID = "dispute-1";

/** $110.00 captured: a $100 budget plus a $10 poster service fee. */
const CAPTURED_CENTS = 11_000;
/** Stripe keeps 2.9% + $0.30 on that capture and never returns it. */
const STRIPE_COST_CENTS = Math.round(CAPTURED_CENTS * 0.029) + 30; // 349

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_ANON_KEY: "anon-key",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
  });
  return loadEdgeFunction("execute-dispute-split");
}

async function json(res: Response): Promise<Record<string, any>> {
  return JSON.parse(await res.text());
}

/** Find the payload of the first write to `table` with the given op. */
function writeTo(table: string, op: "insert" | "update" = "insert"): any {
  return scenario.writes.find((w) => w.table === table && w.op === op)?.payload;
}
function writesTo(table: string, op: "insert" | "update" = "update"): any[] {
  return scenario.writes.filter((w) => w.table === table && w.op === op).map((w) => w.payload);
}

/**
 * Seed a fully executable split: decided dispute, single-helper job sitting in
 * escrow, captured PaymentIntent, active Connect account, no prior movement.
 *
 * `helperShare`/`posterShare` are written in the fraction form
 * `rpc_decide_dispute` normalises to; the percent form is exercised separately.
 */
function seedExecutable(
  s: SupabaseScenario,
  opts: {
    helperShare?: number;
    posterShare?: number;
    job?: Record<string, unknown>;
    dispute?: Record<string, unknown>;
  } = {},
) {
  const helperShare = opts.helperShare ?? 0.6;
  const posterShare = opts.posterShare ?? 1 - helperShare;

  s.authUser = ADMIN;
  s.rpc.has_role = true;

  s.reads.disputes = {
    rows: [
      {
        id: DISPUTE_ID,
        job_id: "job-1",
        status: "decided",
        payout_split: { poster: posterShare, helper: helperShare },
        decision_text: "Work was half-done.",
        execution_status: null,
        execution_transfer_id: null,
        execution_refund_id: null,
        ...opts.dispute,
      },
    ],
  };
  s.reads.jobs = {
    rows: [
      {
        id: "job-1",
        title: "Mow the lawn",
        status: "completed",
        payment_status: "escrow",
        helper_id: "helper-1",
        customer_id: "poster-1",
        budget: 100,
        urgent_fee: 0,
        helper_fee_percent: null,
        is_group_job: false,
        helpers_needed: null,
        stripe_payment_intent_id: "pi_1",
        stripe_session_id: null,
        ...opts.job,
      },
    ],
  };
  s.reads.pif_credits = { rows: [] };
  s.reads.platform_settings = { rows: [{ helper_fee_percent: 12 }] };
  // One `profiles` row serves both reads the function makes: the Connect-account
  // lookup and `getHelperFeePercent`'s tier read. 'free' → the 12% ladder rate.
  s.reads.profiles = {
    rows: [
      {
        stripe_account_id: "acct_helper",
        full_name: "Helpful Helper",
        subscription_tier: "free",
        subscription_expires_at: null,
      },
    ],
  };
  s.reads.payout_transfers = { rows: [] };
  s.reads.payment_refunds = { rows: [] };

  // The execution claim and the final job flip both assert on rows returned.
  s.writeSelectRows.disputes = [{ id: DISPUTE_ID }];
  s.writeSelectRows.jobs = [{ id: "job-1" }];

  stripeMock.paymentIntents.retrieve.mockResolvedValue({
    id: "pi_1",
    status: "succeeded",
    amount_received: CAPTURED_CENTS,
    latest_charge: "ch_1",
  });
  stripeMock.accounts.retrieve.mockResolvedValue({
    id: "acct_helper",
    payouts_enabled: true,
    charges_enabled: true,
  });
  stripeMock.transfers.create.mockResolvedValue({
    id: "tr_1",
    transfer_group: "job_job-1",
  });
  stripeMock.refunds.create.mockImplementation(async (params: any) => ({
    id: "re_1",
    amount: params.amount,
    currency: "usd",
  }));
}

function invoke(fn: EdgeHarness, body: unknown = { dispute_id: DISPUTE_ID }) {
  return fn.fetch(fn.request({ headers: AUTH, body }));
}

describe("execute-dispute-split edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  // ────────────────────────────────────────────────────────────────────────
  describe("authorization", () => {
    it("returns 200 with CORS headers for an OPTIONS preflight", async () => {
      const fn = await load();
      const res = await fn.fetch(fn.request({ method: "OPTIONS" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });

    it("rejects a JWT that resolves to no user", async () => {
      scenario.authUser = null;
      const fn = await load();
      const res = await invoke(fn);
      expect(res.status).toBe(401);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("rejects a valid JWT without the admin role", async () => {
      scenario.authUser = { id: "user-1", email: "u@test.com" };
      scenario.rpc.has_role = false;
      const fn = await load();
      const res = await invoke(fn);
      expect(res.status).toBe(401);
      expect((await json(res)).error).toMatch(/admin role required/i);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("returns 400 when dispute_id is missing", async () => {
      scenario.authUser = ADMIN;
      scenario.rpc.has_role = true;
      const fn = await load();
      const res = await invoke(fn, {});
      expect(res.status).toBe(400);
      expect((await json(res)).error).toMatch(/dispute_id required/i);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  describe("happy path — the money math", () => {
    it("transfers the Helpr's share less commission and refunds the poster's share", async () => {
      seedExecutable(scenario, { helperShare: 0.6 });
      const fn = await load();
      const res = await invoke(fn);
      const body = await json(res);

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);

      // Helper leg: $100 × 60% = $60 gross; commission is the SHARED
      // helperCommissionDollars(60, 12) = round(60 × 12)/100 = $7.20;
      // $60 − $7.20 = $52.80.
      expect(body.helper_cents).toBe(5280);
      expect(body.platform_fee_cents).toBe(720);

      // Poster leg: 40% of ($110.00 captured − $3.49 Stripe) = 40% of $106.51.
      const expectedRefund = Math.round((CAPTURED_CENTS - STRIPE_COST_CENTS) * 0.4);
      expect(expectedRefund).toBe(4260);
      expect(body.refund_cents).toBe(expectedRefund);

      // Nothing may exceed what was actually captured.
      expect(body.helper_cents + body.refund_cents).toBeLessThanOrEqual(CAPTURED_CENTS);
    });

    it("sends the Stripe transfer with the escrow charge and a dispute-keyed idempotency key", async () => {
      seedExecutable(scenario, { helperShare: 0.6 });
      const fn = await load();
      await invoke(fn);

      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
      const [params, opts] = stripeMock.transfers.create.mock.calls[0];
      expect(params.amount).toBe(5280);
      expect(params.destination).toBe("acct_helper");
      // Ties the transfer to the funding charge so Stripe enforces the cap too.
      expect(params.source_transaction).toBe("ch_1");
      expect(params.metadata.dispute_id).toBe(DISPUTE_ID);
      expect(opts.idempotencyKey).toBe(`dispute-split-tr-${DISPUTE_ID}`);
    });

    it("issues the refund against the PaymentIntent with its own deterministic key", async () => {
      seedExecutable(scenario, { helperShare: 0.6 });
      const fn = await load();
      await invoke(fn);

      expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
      const [params, opts] = stripeMock.refunds.create.mock.calls[0];
      expect(params.payment_intent).toBe("pi_1");
      expect(params.amount).toBe(4260);
      expect(opts.idempotencyKey).toBe(`dispute-split-rf-${DISPUTE_ID}`);
    });

    it("writes both ledgers so the split reconciles without a Stripe round-trip", async () => {
      seedExecutable(scenario, { helperShare: 0.6 });
      const fn = await load();
      await invoke(fn);

      const payout = writeTo("payout_transfers", "insert");
      expect(payout).toMatchObject({
        job_id: "job-1",
        helper_id: "helper-1",
        stripe_transfer_id: "tr_1",
        amount_cents: 5280,
        platform_fee_cents: 720,
        status: "paid",
        initiated_by: "admin",
        initiated_by_user_id: ADMIN.id,
      });
      expect(payout.metadata).toMatchObject({ source: "execute_dispute_split", dispute_id: DISPUTE_ID });

      const refund = writeTo("payment_refunds", "insert");
      expect(refund).toMatchObject({
        job_id: "job-1",
        customer_id: "poster-1",
        stripe_refund_id: "re_1",
        amount_cents: 4260,
        is_partial: true,
        source: "dispute_split",
      });
    });

    it("settles the job to released and stamps the dispute as executed", async () => {
      seedExecutable(scenario, { helperShare: 0.6 });
      const fn = await load();
      const body = await json(await invoke(fn));

      expect(body.payment_status).toBe("released");
      const jobUpdate = writeTo("jobs", "update");
      expect(jobUpdate).toMatchObject({
        payment_status: "released",
        helper_fee_percent: 12,
        platform_fee_amount: 7.2,
      });

      // The claim comes first, the settlement stamp last.
      const disputeUpdates = writesTo("disputes");
      expect(disputeUpdates[0]).toMatchObject({ execution_status: "executing" });
      expect(disputeUpdates[disputeUpdates.length - 1]).toMatchObject({
        execution_status: "executed",
        execution_transfer_id: "tr_1",
        execution_refund_id: "re_1",
        execution_helper_cents: 5280,
        execution_refund_cents: 4260,
      });
    });

    it("notifies both parties, quoting whole dollars rounded DOWN", async () => {
      // `formatPayoutDollars` floors on purpose: notification copy must never
      // promise more than the amount that actually lands. $52.80 reads "$52".
      seedExecutable(scenario, { helperShare: 0.6 });
      const fn = await load();
      await invoke(fn);

      const notes = scenario.writes.filter((w) => w.table === "notifications").map((w) => w.payload as any);
      expect(notes.map((n) => n.user_id)).toEqual(
        expect.arrayContaining(["helper-1", "poster-1"]),
      );
      expect(notes.find((n) => n.user_id === "helper-1").message).toContain("$52");
      expect(notes.find((n) => n.user_id === "helper-1").message).not.toContain("$53");
      expect(notes.find((n) => n.user_id === "poster-1").message).toContain("$42");
    });

    it("accepts a split recorded in 0–100 percent form", async () => {
      // rpc_decide_dispute normalises percents, but it also ACCEPTS them, so a
      // historical row can hold either shape.
      seedExecutable(scenario, { dispute: { payout_split: { poster: 40, helper: 60 } } });
      const fn = await load();
      const body = await json(await invoke(fn));
      expect(body.helper_cents).toBe(5280);
      expect(body.refund_cents).toBe(4260);
    });

    it("cuts the commission from the Helpr's SHARE, not the whole budget", async () => {
      // The distinction is the whole point of a partial split: at 50% the
      // platform's cut is 12% of $50, not 12% of $100.
      seedExecutable(scenario, { helperShare: 0.5 });
      const fn = await load();
      const body = await json(await invoke(fn));
      expect(body.platform_fee_cents).toBe(600); // round(50 × 12) = 600¢
      expect(body.helper_cents).toBe(4400); // $50 − $6.00
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  describe("endpoint parity with the full release / full refund actions", () => {
    it("a 100/0 split transfers everything and refunds nothing", async () => {
      seedExecutable(scenario, { helperShare: 1, posterShare: 0 });
      const fn = await load();
      const body = await json(await invoke(fn));

      // Identical to what release-payout would have paid: $100 − 12%.
      expect(body.helper_cents).toBe(8800);
      expect(body.refund_cents).toBe(0);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(body.payment_status).toBe("released");
    });

    it("a 0/100 split refunds the capture less Stripe's cut and transfers nothing", async () => {
      seedExecutable(scenario, { helperShare: 0, posterShare: 1 });
      const fn = await load();
      const body = await json(await invoke(fn));

      // Byte-for-byte what admin_refund_dispute returns today.
      expect(body.refund_cents).toBe(CAPTURED_CENTS - STRIPE_COST_CENTS);
      expect(body.helper_cents).toBe(0);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      // No payout row may be written for a $0 helper share — the ledger's
      // amount_cents CHECK is > 0.
      expect(writeTo("payout_transfers", "insert")).toBeUndefined();
      expect(body.payment_status).toBe("refunded");
    });

    it("pays the Helpr their share of the urgent fee too", async () => {
      // $20 urgent fee, net of its bundled 2.9% (no flat) = $19.42; at 60% the
      // Helpr's share is $11.652 → folded in before the cent rounding.
      seedExecutable(scenario, { helperShare: 0.6, job: { urgent_fee: 20 } });
      const fn = await load();
      const body = await json(await invoke(fn));
      const netUrgent = (2000 - Math.round(2000 * 0.029)) / 100; // 19.42
      expect(body.helper_cents).toBe(Math.round((60 + netUrgent * 0.6 - 7.2) * 100));
      expect(body.helper_cents).toBeGreaterThan(5280);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  describe("fail-closed preconditions", () => {
    it("rejects a group job rather than paying one of N helpers", async () => {
      seedExecutable(scenario, { job: { is_group_job: true, helpers_needed: 3 } });
      const fn = await load();
      const res = await invoke(fn);
      const body = await json(res);

      expect(res.status).toBe(409);
      expect(body.error).toMatch(/group jobs/i);
      expect(body.is_group_job).toBe(true);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      // Nothing may be claimed either — a rejected split is not "attempted".
      expect(writesTo("disputes")).toHaveLength(0);
    });

    it("rejects a job whose payment_status is no longer executable", async () => {
      seedExecutable(scenario, { job: { payment_status: "released" } });
      const fn = await load();
      const res = await invoke(fn);
      const body = await json(res);

      expect(res.status).toBe(409);
      expect(body.error).toMatch(/payment_status is released/i);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("accepts payout_pending as well as escrow", async () => {
      seedExecutable(scenario, { job: { payment_status: "payout_pending" } });
      const fn = await load();
      expect((await invoke(fn)).status).toBe(200);
    });

    it("refuses a dispute that has not been decided", async () => {
      seedExecutable(scenario, { dispute: { status: "open" } });
      const fn = await load();
      const res = await invoke(fn);
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/expected decided/i);
    });

    it("refuses a decided dispute with no usable split recorded", async () => {
      seedExecutable(scenario, { dispute: { payout_split: null } });
      const fn = await load();
      const res = await invoke(fn);
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/no usable payout_split/i);
    });

    it("refuses a split whose shares don't add up to the whole award", async () => {
      // 0.3 + 0.3 would strand 40% of the escrow with nobody, silently.
      seedExecutable(scenario, { dispute: { payout_split: { poster: 0.3, helper: 0.3 } } });
      const fn = await load();
      const res = await invoke(fn);
      expect(res.status).toBe(409);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("refuses when the PaymentIntent never captured — the DB row alone is not proof", async () => {
      seedExecutable(scenario);
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_1",
        status: "requires_payment_method",
      });
      const fn = await load();
      const res = await invoke(fn);
      const body = await json(res);

      expect(res.status).toBe(409);
      expect(body.pi_status).toBe("requires_payment_method");
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("refuses a Pay-It-Forward job, which has no poster charge to split", async () => {
      seedExecutable(scenario);
      scenario.reads.pif_credits = { rows: [{ id: "pif-1" }] };
      const fn = await load();
      const res = await invoke(fn);
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/pay-it-forward/i);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("refuses to move more than the escrow captured, and alerts ops", async () => {
      // The poster paid a $110 session, then the budget was raised to $10,000.
      // Without the cap the transfer would come out of the platform balance.
      seedExecutable(scenario, { helperShare: 1, posterShare: 0, job: { budget: 10_000 } });
      const fn = await load();
      const res = await invoke(fn);

      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/exceeds the captured escrow/i);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(alerts().some((a) => /exceeds captured escrow/i.test(a.title ?? ""))).toBe(true);
    });

    it("refuses when the fee configuration can't be read rather than guessing a rate", async () => {
      seedExecutable(scenario);
      scenario.reads.platform_settings = { error: { message: "boom" } };
      const fn = await load();
      const res = await invoke(fn);
      expect(res.status).toBe(500);
      expect((await json(res)).error).toMatch(/fee configuration unavailable/i);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("fails closed when the duplicate-transfer check itself fails", async () => {
      seedExecutable(scenario);
      scenario.reads.payout_transfers = { error: { message: "connection reset" } };
      const fn = await load();
      const res = await invoke(fn);
      expect(res.status).toBe(500);
      expect((await json(res)).error).toMatch(/duplicate-transfer check failed/i);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("refuses when the Helpr's Connect account is not payable", async () => {
      seedExecutable(scenario);
      stripeMock.accounts.retrieve.mockResolvedValue({
        id: "acct_helper",
        payouts_enabled: false,
        charges_enabled: true,
      });
      const fn = await load();
      const res = await invoke(fn);
      expect(res.status).toBe(409);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      // The claim is walked back to a re-claimable 'failed' with the reason.
      const last = writesTo("disputes").pop();
      expect(last).toMatchObject({ execution_status: "failed" });
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  describe("idempotency", () => {
    it("refuses a split that has already executed", async () => {
      seedExecutable(scenario, {
        dispute: {
          execution_status: "executed",
          execution_transfer_id: "tr_prev",
          execution_refund_id: "re_prev",
        },
      });
      const fn = await load();
      const res = await invoke(fn);
      const body = await json(res);

      expect(res.status).toBe(409);
      expect(body.error).toMatch(/already been executed/i);
      expect(body.stripe_transfer_id).toBe("tr_prev");
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("refuses when the claim matches no row — another run already took it", async () => {
      seedExecutable(scenario);
      scenario.writeSelectRows.disputes = []; // claim matched zero rows
      const fn = await load();
      const res = await invoke(fn);

      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/no longer executable/i);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("resumes a half-settled split: skips the paid transfer, still issues the refund", async () => {
      seedExecutable(scenario, {
        helperShare: 0.6,
        dispute: { execution_status: "failed", execution_transfer_id: "tr_prev" },
      });
      // The transfer leg already settled on the previous attempt.
      scenario.reads.payout_transfers = {
        rows: [{ id: "pt-1", stripe_transfer_id: "tr_prev", status: "paid" }],
      };
      const fn = await load();
      const body = await json(await invoke(fn));

      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
      expect(body.stripe_transfer_id).toBe("tr_prev");
      expect(body.refund_cents).toBe(4260);
      expect(body.success).toBe(true);
    });

    it("skips the refund leg when a dispute_split refund is already on the ledger", async () => {
      seedExecutable(scenario, { helperShare: 0.6 });
      scenario.reads.payment_refunds = {
        rows: [{ id: "pr-1", stripe_refund_id: "re_prev", source: "dispute_split" }],
      };
      const fn = await load();
      const body = await json(await invoke(fn));

      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
      expect(body.stripe_refund_id).toBe("re_prev");
    });

    it("salts the transfer idempotency key after a failed attempt so Stripe retries for real", async () => {
      seedExecutable(scenario, { helperShare: 0.6 });
      scenario.reads.payout_transfers = {
        rows: [{ id: "pt-1", stripe_transfer_id: "tr_dead", status: "failed" }],
      };
      const fn = await load();
      await invoke(fn);

      const [, opts] = stripeMock.transfers.create.mock.calls[0];
      expect(opts.idempotencyKey).toBe(`dispute-split-tr-${DISPUTE_ID}-r1`);
    });

    it("refuses a 0%-to-Helpr split on a job whose payout already settled", async () => {
      // Would refund the poster the whole escrow on top of a transfer that
      // already left — the same money out twice.
      seedExecutable(scenario, { helperShare: 0, posterShare: 1 });
      scenario.reads.payout_transfers = {
        rows: [{ id: "pt-1", stripe_transfer_id: "tr_prev", status: "paid" }],
      };
      const fn = await load();
      const res = await invoke(fn);

      expect(res.status).toBe(409);
      expect((await json(res)).existing_transfer_id).toBe("tr_prev");
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(alerts().some((a) => /already-settled payout/i.test(a.title ?? ""))).toBe(true);
    });

    it("treats a reversed transfer as settled — re-paying is an operator decision", async () => {
      seedExecutable(scenario, { helperShare: 0.6 });
      scenario.reads.payout_transfers = {
        rows: [{ id: "pt-1", stripe_transfer_id: "tr_rev", status: "reversed" }],
      };
      const fn = await load();
      await invoke(fn);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  describe("post-movement failures are loud", () => {
    it("alerts and 500s when money moved but the job state did not flip", async () => {
      seedExecutable(scenario, { helperShare: 0.6 });
      scenario.writeSelectRows.jobs = []; // the state precondition matched nothing
      const fn = await load();
      const res = await invoke(fn);
      const body = await json(res);

      expect(res.status).toBe(500);
      expect(body.error).toMatch(/job status update failed/i);
      expect(body.stripe_transfer_id).toBe("tr_1");
      expect(alerts().some((a) => /job state did not flip/i.test(a.title ?? ""))).toBe(true);
    });
  });
});
