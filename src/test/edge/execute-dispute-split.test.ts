/**
 * Unit tests for the `execute-dispute-split` Supabase edge function.
 *
 * This is the function that turns a RECORDED dispute split (poster X% /
 * helper Y%, written by `rpc_decide_dispute`) into real money: one Stripe
 * transfer to the Helpr's Connect account and one refund to the poster, both
 * off the job's original PaymentIntent — plus, when a Pay-It-Forward gift
 * funded the job, a replacement gift for the poster's share of it, because
 * that half of the escrow has no charge to reverse.
 *
 * What these tests pin down, in rough order of how much a bug would cost:
 *   - the money math, to the cent, including the shared commission helper and
 *     the non-refundable Stripe processing floor;
 *   - endpoint parity — a 100/0 split must settle like a full release and a
 *     0/100 like a full refund, or the slider lies at its extremes;
 *   - the hard cap that refuses to move more than the escrow was funded with,
 *     gift included — on a gift-funded job the transfer has no
 *     `source_transaction`, so that assertion is the only guard left;
 *   - every fail-closed precondition (group job, a gift that can't be valued,
 *     wrong state, uncaptured charge, unparseable split, non-admin caller);
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
// A real uuid: the function now validates the shape before touching the DB,
// because `= 'dispute-1'` on a uuid column comes back as an opaque 22P02.
const DISPUTE_ID = "11111111-1111-4111-8111-111111111111";

/** $110.00 captured: a $100 budget plus a $10 poster service fee. */
const CAPTURED_CENTS = 11_000;
/** Stripe keeps 2.9% + $0.30 on that capture and never returns it. */
const STRIPE_COST_CENTS = Math.round(CAPTURED_CENTS * 0.029) + 30; // 349
/**
 * What a Pay-It-Forward gift applied to the gift-funded job: the $100 budget,
 * and nothing else. No poster service fee (waived — the donor paid the
 * processing floor when the gift was bought) and no Stripe processing cost,
 * because Stripe never touched this money.
 */
const GIFT_APPLIED_CENTS = 10_000;

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
/** The full write records (payload + the eq/neq/in predicate) for a table. */
function writeRecords(table: string, op: "insert" | "update" = "update") {
  return scenario.writes.filter((w) => w.table === table && w.op === op);
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

/**
 * Seed the same executable split, but funded by a Pay-It-Forward gift instead
 * of a card: no PaymentIntent, no checkout session, a redeemed `pif_credits`
 * row against the job, and `restore_pif_credit_for_job` answering with the
 * $100 the gift applied.
 *
 * The RPC is a FUNCTION, not a fixed value, because the source asks it twice
 * for different things — once to value the gift (`p_dry_run: true`, before any
 * money moves) and once to mint the replacement (`p_dry_run: false`).
 */
function seedGiftFunded(
  s: SupabaseScenario,
  opts: Parameters<typeof seedExecutable>[1] = {},
) {
  seedExecutable(s, {
    ...opts,
    job: { stripe_payment_intent_id: null, stripe_session_id: null, ...opts.job },
  });
  s.reads.pif_credits = { rows: [{ id: "pif-1", status: "redeemed" }] };
  s.rpc.restore_pif_credit_for_job = (args: any) => {
    const bps = Number(args?.p_share_bps ?? 10_000);
    const restore = Math.floor((GIFT_APPLIED_CENTS * bps) / 10_000);
    return args?.p_dry_run
      ? { outcome: "would_restore", credit_id: "pif-1", applied_cents: GIFT_APPLIED_CENTS, restore_cents: restore }
      : { outcome: "restored", credit_id: "pif-new", parent_credit_id: "pif-1", recipient_id: "poster-1", applied_cents: GIFT_APPLIED_CENTS, restore_cents: restore };
  };
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

    it("returns 400 — not a misleading 500 — for a dispute_id that isn't a uuid", async () => {
      // Left to Postgres this is a 22P02 cast error, which the read reports as
      // "dispute lookup failed — retry" and sends the admin round in circles.
      seedExecutable(scenario);
      const fn = await load();
      const res = await invoke(fn, { dispute_id: "dispute-1" });
      expect(res.status).toBe(400);
      expect((await json(res)).error).toMatch(/must be a uuid/i);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
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

    it("rejects a terminal job on a FIRST attempt — that escrow was settled elsewhere", async () => {
      // No prior claim on the dispute, so a 'released' job means some other path
      // already settled this escrow. This split must not touch it.
      seedExecutable(scenario, { job: { payment_status: "released" } });
      const fn = await load();
      const res = await invoke(fn);
      const body = await json(res);

      expect(res.status).toBe(409);
      expect(body.error).toMatch(/payment_status is released/i);
      expect(body.is_resume).toBe(false);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("ALLOWS a terminal job when a prior attempt of this split claimed it", async () => {
      // The transfer leg flips the job terminal (directly, and via the
      // transfer.created webhook). Without this widening, a split whose refund
      // leg failed could never be finished — the poster's share would be stuck.
      seedExecutable(scenario, {
        helperShare: 0.6,
        job: { payment_status: "released" },
        dispute: { execution_status: "failed", execution_transfer_id: "tr_1" },
      });
      scenario.reads.payout_transfers = {
        rows: [{ id: "pt-1", stripe_transfer_id: "tr_1", status: "paid", amount_cents: 5280, platform_fee_cents: 720 }],
      };
      const fn = await load();
      const body = await json(await invoke(fn));

      expect(body.success).toBe(true);
      expect(body.resumed).toBe(true);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
      expect(body.refund_cents).toBe(4260);
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

    it("refuses a job whose Pay-It-Forward gift is only RESERVED — the escrow can't be reconciled", async () => {
      seedExecutable(scenario);
      scenario.reads.pif_credits = { rows: [{ id: "pif-1", status: "reserved" }] };
      const fn = await load();
      const res = await invoke(fn);
      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/reserved/i);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("refuses a gift-funded job it cannot VALUE rather than guessing the escrow", async () => {
      seedGiftFunded(scenario);
      // PGRST202 is the real shape of this: the function exists in the repo but
      // the migration that defines it has not deployed yet.
      scenario.rpcErrors = { restore_pif_credit_for_job: { message: "function not found", code: "PGRST202" } };
      const fn = await load();
      const res = await invoke(fn);
      expect(res.status).toBe(503);
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

  // The defect this suite used to enshrine: a gift-funded job was refused
  // outright with "resolve it with the full release or full refund action" —
  // advice that could not work, because a full refund also reverses a
  // PaymentIntent and this job has none. The gift IS the money, so the poster's
  // share has to come back as a gift.
  describe("Pay-It-Forward jobs — the gift leg", () => {
    it("settles a gift-funded job with no PaymentIntent at all", async () => {
      seedGiftFunded(scenario);
      const fn = await load();
      const res = await invoke(fn);
      const body = await json(res);

      expect(res.status).toBe(200);
      // Never asked Stripe about a PaymentIntent that doesn't exist.
      expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      // Helper's 60% of a $100 budget less the 12% commission, paid from the
      // platform balance — no source_transaction, because there is no charge.
      expect(stripeMock.transfers.create).toHaveBeenCalled();
      const transferArgs = stripeMock.transfers.create.mock.calls[0][0];
      expect(transferArgs.amount).toBe(5280);
      expect(transferArgs.source_transaction).toBeUndefined();
      // Poster's 40% of the $100 gift, back as a gift.
      expect(body.gift_restored_cents).toBe(4000);
      expect(body.refund_cents).toBe(0);
      expect(body.poster_returned_cents).toBe(4000);
    });

    it("values the gift with a dry run BEFORE moving anything, then mints", async () => {
      seedGiftFunded(scenario);
      const fn = await load();
      await invoke(fn);

      const calls = (scenario.rpcCalls ?? []).filter((c) => c.name === "restore_pif_credit_for_job");
      expect(calls).toHaveLength(2);
      expect((calls[0].args as any).p_dry_run).toBe(true);
      expect((calls[1].args as any).p_dry_run).toBe(false);
      // The poster's share is passed as basis points, never as a dollar figure
      // this side computed — the amount is the RPC's to derive.
      expect((calls[1].args as any).p_share_bps).toBe(4000);
    });

    it("refuses a gift split that would exceed what the gift actually paid", async () => {
      // $100 gift, but the budget was edited up to $10,000 afterwards.
      seedGiftFunded(scenario, { helperShare: 1, posterShare: 0, job: { budget: 10_000 } });
      const fn = await load();
      const res = await invoke(fn);

      expect(res.status).toBe(409);
      expect((await json(res)).error).toMatch(/exceeds the captured escrow/i);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("a re-run that finds the gift already restored settles without minting a second one", async () => {
      // The database guarantees this: a partial unique index on
      // pif_credits.restored_from_job_id permits one restoration per job,
      // forever, so the second call reports the FIRST one's amount.
      seedGiftFunded(scenario, { dispute: { execution_status: "failed" } });
      scenario.rpc.restore_pif_credit_for_job = (args: any) =>
        args?.p_dry_run
          ? { outcome: "already_restored", credit_id: "pif-new", applied_cents: 10_000, restore_cents: 4000 }
          : { outcome: "already_restored", credit_id: "pif-new", restore_cents: 4000 };

      const fn = await load();
      const res = await invoke(fn);
      const body = await json(res);

      expect(res.status).toBe(200);
      expect(body.gift_restored_cents).toBe(4000);
      expect(body.gift_credit_id).toBe("pif-new");
    });

    it("parks the split as resumable — never silently short — if the gift can't be minted", async () => {
      seedGiftFunded(scenario);
      scenario.rpc.restore_pif_credit_for_job = (args: any) =>
        args?.p_dry_run
          ? { outcome: "would_restore", credit_id: "pif-1", applied_cents: 10_000, restore_cents: 4000 }
          // A null `error` with an outcome the function never defines is NOT
          // proof the gift came back.
          : { outcome: "no_credit" };

      const fn = await load();
      const res = await invoke(fn);

      expect(res.status).toBe(500);
      expect(alerts().some((a) => /could not return the poster's Pay-It-Forward gift/i.test(a.title ?? ""))).toBe(true);
      const failed = writesTo("disputes").find((p) => p.execution_status === "failed");
      expect(failed).toBeTruthy();
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

    it("survives the real failure sequence: transfer paid → refund throws → webhook releases the job → retry finishes the refund", async () => {
      // This is the sequence the entry gate used to make unreachable. The
      // transfer.created webhook matches the 'paid' ledger row this function
      // writes and flips the job escrow → released within milliseconds — so the
      // retry arrives at a terminal job with the poster's share still unpaid.
      seedExecutable(scenario, { helperShare: 0.6 });
      stripeMock.refunds.create.mockRejectedValueOnce(new Error("card_network_unavailable"));

      const fn = await load();
      const first = await invoke(fn);
      const firstBody = await json(first);

      expect(first.status).toBe(502);
      expect(firstBody.stripe_transfer_id).toBe("tr_1");
      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
      // The transfer id is banked on the dispute so the retry can resume.
      const failure = writesTo("disputes").pop();
      expect(failure).toMatchObject({ execution_status: "failed", execution_transfer_id: "tr_1" });

      // ── Now the world as the retry finds it ──
      scenario.writes.length = 0;
      scenario.reads.jobs.rows![0].payment_status = "released"; // transfer.created webhook
      scenario.reads.disputes.rows![0].execution_status = "failed";
      scenario.reads.disputes.rows![0].execution_transfer_id = "tr_1";
      scenario.reads.payout_transfers = {
        rows: [{ id: "pt-1", stripe_transfer_id: "tr_1", status: "paid", amount_cents: 5280, platform_fee_cents: 720 }],
      };
      stripeMock.refunds.create.mockResolvedValue({ id: "re_1", amount: 4260, currency: "usd" });

      const second = await invoke(fn);
      const body = await json(second);

      expect(second.status).toBe(200);
      expect(body.resumed).toBe(true);
      // The Helpr is NOT paid twice.
      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
      expect(stripeMock.refunds.create).toHaveBeenCalledTimes(2); // 1 throw + 1 success
      expect(body.stripe_transfer_id).toBe("tr_1");
      expect(body.refund_cents).toBe(4260);
      expect(writeTo("payment_refunds", "insert")).toMatchObject({ amount_cents: 4260 });
      expect(writesTo("disputes").pop()).toMatchObject({
        execution_status: "executed",
        execution_transfer_id: "tr_1",
        execution_refund_id: "re_1",
      });
    });

    it("reports the LEDGER's amount when the transfer leg is skipped, not a recomputation", async () => {
      // A subscription-tier change between attempts moves the recomputed
      // commission. What the dispute records and the admin is told must be what
      // actually left, which only the ledger knows.
      seedExecutable(scenario, {
        helperShare: 0.6,
        job: { payment_status: "released" },
        dispute: { execution_status: "failed" },
      });
      scenario.reads.payout_transfers = {
        rows: [{ id: "pt-1", stripe_transfer_id: "tr_prev", status: "paid", amount_cents: 5000, platform_fee_cents: 600 }],
      };
      const fn = await load();
      const body = await json(await invoke(fn));

      expect(body.helper_cents).toBe(5000); // ledger, not the recomputed 5280
      expect(body.platform_fee_cents).toBe(600); // ledger, not the recomputed 720
      expect(writesTo("disputes").pop()).toMatchObject({ execution_helper_cents: 5000 });

      const jobPatch = writeTo("jobs", "update");
      expect(jobPatch.platform_fee_amount).toBe(6);
      // The rate the settled transfer was computed at stays frozen — this run
      // must not overwrite it with a live tier no money moved at.
      expect(jobPatch).not.toHaveProperty("helper_fee_percent");
    });

    it("never walks a settled dispute back to 'failed' — the loser of a race can't relabel the winner", async () => {
      seedExecutable(scenario);
      stripeMock.accounts.retrieve.mockResolvedValue({
        id: "acct_helper",
        payouts_enabled: false,
        charges_enabled: true,
      });
      const fn = await load();
      await invoke(fn);

      const failure = writeRecords("disputes").pop()!;
      expect(failure.payload).toMatchObject({ execution_status: "failed" });
      expect(failure.filters).toEqual(
        expect.arrayContaining([
          { op: "neq", column: "execution_status", value: "executed" },
        ]),
      );
    });

    it("catches a refund that reached Stripe but never reached the ledger", async () => {
      // Past Stripe's ~24h idempotency window the key protects nothing, so the
      // metadata cross-check is the only thing standing between a lost ledger
      // write and a second real refund.
      seedExecutable(scenario, {
        helperShare: 0.6,
        job: { payment_status: "released" },
        dispute: { execution_status: "failed" },
      });
      scenario.reads.payout_transfers = {
        rows: [{ id: "pt-1", stripe_transfer_id: "tr_1", status: "paid", amount_cents: 5280, platform_fee_cents: 720 }],
      };
      scenario.reads.payment_refunds = { rows: [] };
      stripeMock.refunds.list.mockResolvedValue({
        data: [{ id: "re_orphan", amount: 4260, currency: "usd", metadata: { dispute_id: DISPUTE_ID } }],
      });

      const fn = await load();
      const body = await json(await invoke(fn));

      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(body.stripe_refund_id).toBe("re_orphan");
      expect(body.success).toBe(true);
      // The divergence we just proved is healed, so the next run answers from
      // the ledger rather than paying for another Stripe round-trip.
      expect(writeTo("payment_refunds", "insert")).toMatchObject({
        stripe_refund_id: "re_orphan",
        amount_cents: 4260,
        source: "dispute_split",
        metadata: { recovered_from_stripe: true },
      });
    });

    it("fails closed when the prior-refund cross-check itself can't run", async () => {
      seedExecutable(scenario, {
        helperShare: 0.6,
        job: { payment_status: "released" },
        dispute: { execution_status: "failed" },
      });
      scenario.reads.payout_transfers = {
        rows: [{ id: "pt-1", stripe_transfer_id: "tr_1", status: "paid", amount_cents: 5280, platform_fee_cents: 720 }],
      };
      stripeMock.refunds.list.mockRejectedValue(new Error("stripe down"));

      const fn = await load();
      const res = await invoke(fn);
      expect(res.status).toBe(502);
      expect((await json(res)).error).toMatch(/could not verify prior refunds/i);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
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
  describe("mixed funding — a gift PLUS a card shortfall", () => {
    /**
     * The gap that let a real bug ship: every PIF test above forces
     * `stripe_payment_intent_id: null`, so `escrowValueCents = captured +
     * giftApplied` was never once exercised with BOTH terms non-zero — which
     * is the shape of a gift that didn't cover the whole job.
     *
     * $100 budget, $80 of it paid by a gift, the $20 shortfall (plus the $10
     * poster service fee) collected by card.
     */
    const SHORTFALL_CAPTURED = 3_000; // $20 shortfall + $10 service fee
    const MIXED_GIFT_APPLIED = 8_000; // $80 of the budget came from the gift

    function seedMixed(opts: Parameters<typeof seedExecutable>[1] = {}) {
      seedExecutable(scenario, {
        ...opts,
        job: { stripe_payment_intent_id: "pi_1", stripe_session_id: null, ...opts.job },
      });
      scenario.reads.pif_credits = { rows: [{ id: "pif-1", status: "redeemed" }] };
      scenario.rpc.restore_pif_credit_for_job = (args: any) => {
        const bps = Number(args?.p_share_bps ?? 10_000);
        const restore = Math.floor((MIXED_GIFT_APPLIED * bps) / 10_000);
        return args?.p_dry_run
          ? { outcome: "would_restore", credit_id: "pif-1", applied_cents: MIXED_GIFT_APPLIED, restore_cents: restore }
          : { outcome: "restored", credit_id: "pif-new", parent_credit_id: "pif-1", recipient_id: "poster-1", applied_cents: MIXED_GIFT_APPLIED, restore_cents: restore };
      };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_1",
        status: "succeeded",
        amount_received: SHORTFALL_CAPTURED,
        latest_charge: "ch_shortfall",
      });
    }

    it("never pins the helper transfer to the shortfall charge", async () => {
      // THE REGRESSION THIS FILE EXISTS TO CATCH. The helper's leg is scaled
      // off the whole $100 budget, but the charge behind a mixed job only
      // holds the $20 shortfall. Passing it as `source_transaction` asks
      // Stripe to move more than the source charge contains, so
      // `transfers.create` throws — permanently, because leg 1 returns before
      // the poster's refund and the gift restore ever run. A retry reproduces
      // it exactly and the escrow is stranded with the dispute unexecutable.
      seedMixed({ helperShare: 1, posterShare: 0 });
      const fn = await load();
      const res = await invoke(fn);

      expect(res.status).toBe(200);
      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
      const [params] = stripeMock.transfers.create.mock.calls[0];
      expect(params.source_transaction).toBeUndefined();
      // Still capped by what actually funded the escrow: $88 of a
      // $30 capture + $80 gift = $110 of escrow value.
      expect(params.amount).toBe(8_800);
    });

    it("keeps source_transaction on a pure-card job, where the charge IS the escrow", async () => {
      // The guard is withheld only when a gift contributed. Without this the
      // fix above could silently drop Stripe's server-side over-draw cap on
      // every ordinary dispute.
      seedExecutable(scenario, { helperShare: 1, posterShare: 0 });
      const fn = await load();
      const res = await invoke(fn);

      expect(res.status).toBe(200);
      const [params] = stripeMock.transfers.create.mock.calls[0];
      expect(params.source_transaction).toBe("ch_1");
    });

    it("refunds the poster from the card and the gift separately, never over-drawing either", async () => {
      seedMixed({ helperShare: 0, posterShare: 1 });
      const fn = await load();
      const res = await invoke(fn);
      const body = await json(res);

      expect(res.status).toBe(200);
      // Cash leg draws on the CAPTURE, not on escrow value — it can never try
      // to refund card money that was never charged.
      const [refundParams] = stripeMock.refunds.create.mock.calls[0];
      expect(refundParams.amount).toBeLessThanOrEqual(SHORTFALL_CAPTURED);
      // Gift leg comes back as credit, valued at the gift's applied amount.
      expect(body.gift_restored_cents).toBe(MIXED_GIFT_APPLIED);
      // And the two legs together never exceed what was held.
      expect(refundParams.amount + MIXED_GIFT_APPLIED).toBeLessThanOrEqual(
        SHORTFALL_CAPTURED + MIXED_GIFT_APPLIED,
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  describe("a lost ledger write must not double-pay the Helpr", () => {
    /**
     * Stripe replays a reused idempotency key for only ~24h. The sequence
     * "transfer succeeded → `payout_transfers` insert failed → nobody retried
     * for a day" therefore had nothing left standing between it and a SECOND
     * real transfer. The refund leg already asked Stripe directly; the
     * transfer leg trusted the one record we know can be missing.
     */
    it("adopts a transfer Stripe already made for this dispute instead of making another", async () => {
      seedExecutable(scenario, {
        helperShare: 0.6,
        dispute: { execution_status: "failed" }, // a resume
      });
      scenario.reads.payout_transfers = { rows: [] }; // the ledger write was lost
      stripeMock.transfers.list.mockResolvedValue({
        data: [{ id: "tr_already", metadata: { dispute_id: DISPUTE_ID } }],
      });

      const fn = await load();
      const res = await invoke(fn);
      const body = await json(res);

      expect(res.status).toBe(200);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(body.stripe_transfer_id).toBe("tr_already");
    });

    it("falls back to the transfer id stamped on the dispute row, verified against Stripe", async () => {
      seedExecutable(scenario, {
        helperShare: 0.6,
        dispute: { execution_status: "failed", execution_transfer_id: "tr_stamped" },
      });
      scenario.reads.payout_transfers = { rows: [] };
      stripeMock.transfers.list.mockResolvedValue({ data: [] }); // group lookup finds nothing
      stripeMock.transfers.retrieve.mockResolvedValue({ id: "tr_stamped" });

      const fn = await load();
      const res = await invoke(fn);

      expect(res.status).toBe(200);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("fails CLOSED when the prior-transfer history cannot be read", async () => {
      // An unverifiable history is exactly the case this check exists for, so
      // it must never fall through to "nothing was paid".
      seedExecutable(scenario, { helperShare: 0.6, dispute: { execution_status: "failed" } });
      scenario.reads.payout_transfers = { rows: [] };
      stripeMock.transfers.list.mockRejectedValue(new Error("stripe down"));

      const fn = await load();
      const res = await invoke(fn);

      expect(res.status).toBe(502);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("does not ask Stripe on a FIRST attempt, where there is nothing to find", async () => {
      seedExecutable(scenario, { helperShare: 0.6 }); // execution_status: null
      const fn = await load();
      const res = await invoke(fn);

      expect(res.status).toBe(200);
      expect(stripeMock.transfers.list).not.toHaveBeenCalled();
      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
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
