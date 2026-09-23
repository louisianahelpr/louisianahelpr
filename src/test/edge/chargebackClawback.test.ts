/**
 * Card-dispute CLAW BACK (docs/OPEN.md Q202, owner decision 2026-09-23).
 *
 * Before: charge.dispute.created blocked a payout only while the job was still
 * escrow / payout_pending. A RELEASED job's Helpr kept the money and the
 * platform paid the cardholder plus Stripe's ~$15 fee; nothing in
 * supabase/functions ever called transfers.createReversal.
 *
 * Now, on the REAL stripe-webhook source through the edge harness:
 *   created (a real chargeback) on a released job → the job flips to
 *     'chargeback' FIRST (CAS on 'released'), then each transfer in
 *     transfer_group job_<id> is reversed up to the disputed amount, one
 *     chargeback_clawbacks row + one idempotency key per (dispute, transfer);
 *   an inquiry (warning_*) reverses nothing;
 *   a redelivery never reverses twice;
 *   a Stripe refusal is recorded and pages (critical), a transient failure 500s;
 *   closed WON pays each reversed amount back (idempotent) and returns the job
 *     to 'released'; closed LOST leaves the reversal standing;
 *   the payee is told in-app each time;
 *   transfer.reversed recognises the clawback and does not freeze the job.
 *
 * Each mutation below undoes one of those and must turn this file red.
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts | if (!isInquiry && (chargebackJob.payment_status === "released" | if (false && (chargebackJob.payment_status === "released"
 * @mutate supabase/functions/stripe-webhook/handlers/_chargebackClawback.ts | if (row && row.status !== "reversing" && row.status !== "reverse_failed") continue; | if (false) continue;
 * @mutate supabase/functions/stripe-webhook/handlers/_chargebackClawback.ts | amount = Math.min(reversible, remaining); | amount = reversible;
 * @mutate supabase/functions/stripe-webhook/handlers/_chargebackClawback.ts | { idempotencyKey: `clawback-${dispute.id}-${t.id}` }, | {},
 * @mutate supabase/functions/stripe-webhook/handlers/_chargebackClawback.ts | result.failed.push({ transferId: t.id, error: message }); | void message;
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeCreated.ts | .eq("payment_status", "released") | .eq("id", chargebackJob.id)
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | repaid = await repayClawback({ stripe, supabase, logStep }, closedDispute, { id: closedJob.id, title: closedJob.title }); | repaid = { repaidNowCents: 0, failed: [], rows: 0 };
 * @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts | await finalizeLostClawback({ stripe, supabase, logStep }, closedDispute, { id: closedJob.id, title: closedJob.title }); | void 0;
 * @mutate supabase/functions/stripe-webhook/handlers/transferReversed.ts | } else if (ours.disputeId) { | } else if (false) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";

async function load(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  return loadEdgeFunction("stripe-webhook");
}
const post = (fn: EdgeHarness) =>
  fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" } }));

function event(id: string, type: string, object: Record<string, unknown>) {
  stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id, type, data: { object } });
}
const dispute = (status: string, amount = 10000) => ({
  id: "dp_1", status, amount, reason: "fraudulent", payment_intent: "pi_job", charge: "ch_job",
});
const releasedJob = (over: Record<string, unknown> = {}) => ({
  id: "job-1", customer_id: "poster-1", helper_id: "helper-1", title: "Fence repair",
  status: "completed", payment_status: "released", dispute_status: null, disputed_at: null,
  payout_scheduled_at: "2026-09-20T00:00:00.000Z", ...over,
});
const transfer = (id: string, amount: number, over: Record<string, unknown> = {}) => ({
  id, amount, amount_reversed: 0, created: 1, destination: "acct_helper", transfer_group: "job_job-1", ...over,
});
const row = (over: Record<string, unknown> = {}) => ({
  id: "cb-1", dispute_id: "dp_1", job_id: "job-1", helper_id: "helper-1", stripe_transfer_id: "tr_1",
  stripe_account_id: "acct_helper", transfer_amount_cents: 9000, reversed_cents: 9000,
  stripe_reversal_id: "trr_1", repay_transfer_id: null, status: "reversed", ...over,
});

const writesTo = (table: string, op?: string) =>
  scenario.writes.filter((w) => w.table === table && (!op || w.op === op));
const payload = (w: { payload: unknown }) => w.payload as Record<string, unknown>;
const alerts = () => slackAlerts as Array<{ severity?: string; title: string; message: string }>;
const notices = () =>
  writesTo("notifications", "insert").map((w) => payload(w) as { user_id: string; title: string; message: string });

describe("card-dispute clawback (Q202)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  describe("charge.dispute.created on a RELEASED job", () => {
    it("flips the job to 'chargeback' first, then reverses the Helpr's transfer with a per-dispute idempotency key", async () => {
      const fn = await load();
      event("evt_c1", "charge.dispute.created", dispute("needs_response"));
      scenario.reads.jobs = { rows: [releasedJob()] };
      scenario.reads.payout_transfers = { rows: [{ stripe_transfer_id: "tr_1", helper_id: "helper-1", status: "paid" }] };
      stripeMock.transfers.list.mockResolvedValue({ data: [transfer("tr_1", 9000)] });
      stripeMock.transfers.createReversal.mockResolvedValue({ id: "trr_1" });
      scenario.writeSelectRows["chargeback_clawbacks:insert"] = [row({ status: "reversing", stripe_reversal_id: null })];

      const res = await post(fn);
      expect(res.status).toBe(200);

      // The flip is a CAS on 'released' and happens BEFORE the reversal.
      const flip = writesTo("jobs", "update").find((w) => payload(w).payment_status === "chargeback");
      expect(flip).toBeDefined();
      expect(flip!.filters).toContainEqual({ op: "eq", column: "payment_status", value: "released" });
      expect(flip!.selectCols).toBe("id");

      expect(stripeMock.transfers.list).toHaveBeenCalledWith({ transfer_group: "job_job-1", limit: 100 });
      expect(stripeMock.transfers.createReversal).toHaveBeenCalledTimes(1);
      const [tid, params, opts] = stripeMock.transfers.createReversal.mock.calls[0];
      expect(tid).toBe("tr_1");
      expect(params.amount).toBe(9000);
      expect(opts).toEqual({ idempotencyKey: "clawback-dp_1-tr_1" });

      // Claimed in the ledger before the call, marked reversed after it.
      const claim = writesTo("chargeback_clawbacks", "insert")[0];
      expect(payload(claim)).toMatchObject({ dispute_id: "dp_1", stripe_transfer_id: "tr_1", reversed_cents: 9000, status: "reversing" });
      expect(writesTo("chargeback_clawbacks", "update").some((w) => payload(w).status === "reversed")).toBe(true);

      // The payee is told, in role-neutral words.
      const told = notices().filter((n) => n.user_id === "helper-1");
      expect(told).toHaveLength(1);
      expect(told[0].message).toMatch(/\$90\.00/);
      expect(told[0].message).toMatch(/paid back to you automatically/);
    });

    it("never reverses more than the disputed amount across several transfers", async () => {
      const fn = await load();
      event("evt_c2", "charge.dispute.created", dispute("needs_response", 5000));
      scenario.reads.jobs = { rows: [releasedJob()] };
      stripeMock.transfers.list.mockResolvedValue({
        data: [transfer("tr_a", 3000, { created: 1 }), transfer("tr_b", 4000, { created: 2 })],
      });
      stripeMock.transfers.createReversal.mockResolvedValue({ id: "trr_x" });
      await post(fn);
      const amounts = stripeMock.transfers.createReversal.mock.calls.map((c) => c[1].amount);
      expect(amounts).toEqual([3000, 2000]);
    });

    it("an inquiry (warning_needs_response) reverses nothing and leaves the released job alone", async () => {
      const fn = await load();
      event("evt_c3", "charge.dispute.created", dispute("warning_needs_response"));
      scenario.reads.jobs = { rows: [releasedJob()] };
      stripeMock.transfers.list.mockResolvedValue({ data: [transfer("tr_1", 9000)] });
      await post(fn);
      expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled();
      expect(writesTo("jobs", "update").some((w) => payload(w).payment_status === "chargeback")).toBe(false);
    });

    it("a redelivery after the reversal never reverses twice", async () => {
      const fn = await load();
      event("evt_c4", "charge.dispute.created", dispute("needs_response"));
      scenario.reads.jobs = { rows: [releasedJob({ payment_status: "chargeback", dispute_status: "stripe_chargeback" })] };
      scenario.reads.chargeback_clawbacks = { rows: [row()] };
      stripeMock.transfers.list.mockResolvedValue({ data: [transfer("tr_1", 9000, { amount_reversed: 9000 })] });
      const res = await post(fn);
      expect(res.status).toBe(200);
      expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled();
      expect(notices().some((n) => n.user_id === "helper-1")).toBe(false);
    });

    it("a redelivery whose first attempt died mid-call resumes with the SAME amount and key", async () => {
      const fn = await load();
      event("evt_c4b", "charge.dispute.created", dispute("needs_response"));
      scenario.reads.jobs = { rows: [releasedJob({ payment_status: "chargeback", dispute_status: "stripe_chargeback" })] };
      scenario.reads.chargeback_clawbacks = { rows: [row({ status: "reversing", reversed_cents: 8000, stripe_reversal_id: null })] };
      stripeMock.transfers.list.mockResolvedValue({ data: [transfer("tr_1", 9000)] });
      stripeMock.transfers.createReversal.mockResolvedValue({ id: "trr_1" });
      await post(fn);
      expect(stripeMock.transfers.createReversal).toHaveBeenCalledTimes(1);
      expect(stripeMock.transfers.createReversal.mock.calls[0][1].amount).toBe(8000);
      expect(stripeMock.transfers.createReversal.mock.calls[0][2]).toEqual({ idempotencyKey: "clawback-dp_1-tr_1" });
      expect(writesTo("chargeback_clawbacks", "insert")).toHaveLength(0);
    });

    it("a Stripe refusal (short balance) is recorded on the row and pages critical; the webhook still acks", async () => {
      const fn = await load();
      event("evt_c5", "charge.dispute.created", dispute("needs_response"));
      scenario.reads.jobs = { rows: [releasedJob()] };
      stripeMock.transfers.list.mockResolvedValue({ data: [transfer("tr_1", 9000)] });
      stripeMock.transfers.createReversal.mockRejectedValue(
        Object.assign(new Error("Insufficient funds in the connected account"), { type: "StripeInvalidRequestError" }),
      );
      const res = await post(fn);
      expect(res.status).toBe(200);
      const failed = writesTo("chargeback_clawbacks", "update").find((w) => payload(w).status === "reverse_failed");
      expect(payload(failed!).error).toMatch(/Insufficient funds/);
      expect(alerts().some((a) => a.severity === "critical" && /clawback REFUSED/.test(a.title))).toBe(true);
    });

    it("a transient Stripe failure answers 500 so Stripe redelivers", async () => {
      const fn = await load();
      event("evt_c6", "charge.dispute.created", dispute("needs_response"));
      scenario.reads.jobs = { rows: [releasedJob()] };
      stripeMock.transfers.list.mockResolvedValue({ data: [transfer("tr_1", 9000)] });
      stripeMock.transfers.createReversal.mockRejectedValue(
        Object.assign(new Error("connection reset"), { type: "StripeConnectionError" }),
      );
      const res = await post(fn);
      expect(res.status).toBe(500);
    });

    it("an escrow job is still blocked as before, and nothing is reversed", async () => {
      const fn = await load();
      event("evt_c7", "charge.dispute.created", dispute("needs_response"));
      scenario.reads.jobs = { rows: [releasedJob({ payment_status: "escrow", status: "in_progress" })] };
      await post(fn);
      expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled();
      const block = writesTo("jobs", "update").find((w) => payload(w).payment_status === "chargeback");
      expect(block!.filters).toContainEqual({ op: "in", column: "payment_status", value: ["payout_pending", "escrow"] });
    });
  });

  describe("charge.dispute.closed", () => {
    it("WON pays each reversed amount back once, returns the job to 'released', tells the payee", async () => {
      const fn = await load();
      event("evt_w1", "charge.dispute.closed", dispute("won"));
      scenario.reads.jobs = { rows: [releasedJob({ payment_status: "chargeback", dispute_status: "stripe_chargeback" })] };
      scenario.reads.chargeback_clawbacks = { rows: [row()] };
      stripeMock.transfers.create.mockResolvedValue({ id: "tr_repay" });
      const res = await post(fn);
      expect(res.status).toBe(200);
      expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1);
      const [params, opts] = stripeMock.transfers.create.mock.calls[0];
      expect(params).toMatchObject({ amount: 9000, destination: "acct_helper", transfer_group: "job_job-1" });
      expect(opts).toEqual({ idempotencyKey: "clawback-repay-dp_1-tr_1" });
      expect(writesTo("chargeback_clawbacks", "update").some((w) => payload(w).status === "repaid")).toBe(true);
      const back = writesTo("jobs", "update").find((w) => payload(w).payment_status === "released");
      expect(back!.filters).toContainEqual({ op: "eq", column: "payment_status", value: "chargeback" });
      expect(notices().some((n) => n.user_id === "helper-1" && /paid to you again/.test(n.message))).toBe(true);
    });

    it("WON on an already-repaid row pays nothing again", async () => {
      const fn = await load();
      event("evt_w2", "charge.dispute.closed", dispute("won"));
      scenario.reads.jobs = { rows: [releasedJob({ payment_status: "released", dispute_status: "dispute_won" })] };
      scenario.reads.chargeback_clawbacks = { rows: [row({ status: "repaid", repay_transfer_id: "tr_repay" })] };
      await post(fn);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
    });

    it("LOST leaves the reversal standing (no re-pay), marks it final, tells the payee", async () => {
      const fn = await load();
      event("evt_l1", "charge.dispute.closed", dispute("lost"));
      scenario.reads.jobs = { rows: [releasedJob({ payment_status: "chargeback", dispute_status: "stripe_chargeback" })] };
      scenario.reads.chargeback_clawbacks = { rows: [row()] };
      await post(fn);
      expect(stripeMock.transfers.create).not.toHaveBeenCalled();
      expect(writesTo("chargeback_clawbacks", "update").some((w) => payload(w).status === "kept")).toBe(true);
      expect(writesTo("jobs", "update").some((w) => payload(w).payment_status === "released")).toBe(false);
      expect(notices().some((n) => n.user_id === "helper-1" && /card dispute/i.test(n.message))).toBe(true);
    });
  });

  describe("transfer.reversed for a clawback", () => {
    it("does not freeze the job or page 'investigate' — it is our own reversal", async () => {
      const fn = await load();
      event("evt_r1", "transfer.reversed", { id: "tr_1", amount: 9000, amount_reversed: 9000, destination: "acct_helper" });
      scenario.writeSelectRows.payout_transfers = [{ job_id: "job-1" }];
      scenario.reads.chargeback_clawbacks = { rows: [{ dispute_id: "dp_1", status: "reversed" }] };
      await post(fn);
      expect(writesTo("jobs", "update")).toHaveLength(0);
      expect(alerts().some((a) => /Investigate/.test(a.message))).toBe(false);
      expect(alerts().some((a) => /card dispute/i.test(a.title))).toBe(true);
    });
  });

  it("inventory floor: the clawback reaches Stripe through both money calls", async () => {
    const fn = await load();
    event("evt_f", "charge.dispute.created", dispute("needs_response"));
    scenario.reads.jobs = { rows: [releasedJob()] };
    stripeMock.transfers.list.mockResolvedValue({ data: [transfer("tr_1", 9000)] });
    stripeMock.transfers.createReversal.mockResolvedValue({ id: "trr_1" });
    await post(fn);
    expect(stripeMock.transfers.createReversal.mock.calls.length).toBeGreaterThan(0);
  });
});
