// @mutate supabase/functions/stripe-webhook/handlers/customerSubscriptionUpdated.ts |         subscription_source: "stripe", |         // source dropped
// @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | const updateData: any = { subscription_tier: tier, subscription_source: "stripe" }; | const updateData: any = { subscription_tier: tier };
/**
 * Unit tests for the `stripe-webhook` Supabase edge function.
 *
 * This webhook is the inbound side of every Stripe-driven state change:
 * checkout completion (escrow funding, tips, boosts, onboarding-fee
 * collection), subscription lifecycle, payment failures, refunds, Connect
 * account updates, and payout transfer settlement.
 *
 * Critical, previously-untested invariants exercised here:
 *   - A delivery it could not verify (bad signature, no signature, missing
 *     key or signing secret) is REFUSED with a non-2xx and never acknowledged,
 *     so Stripe keeps the event and retries it (docs/OPEN.md Q156: the old
 *     200 dropped a real delivery on 2026-09-23 12:43:27Z). Stripe's retries
 *     are bounded per event, so this is not a retry storm.
 *   - Signature verification gates all event processing.
 *   - The idempotency guard (unique event_id insert) skips replays.
 *   - checkout.session.completed funds escrow / marks tips paid.
 *   - charge.refunded + payment_intent.payment_failed update the job.
 *
 * Runs the REAL function source via the edge harness; only Stripe, Supabase,
 * the Slack alerter, and the Deno runtime are doubled.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { slackAlerts, resetSharedMocks } from "./mocks/shared";

/** Load stripe-webhook with both Stripe key + webhook secret present. */
async function loadConfigured(): Promise<EdgeHarness> {
  setEnv({
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-key",
    STRIPE_SECRET_KEY: "sk_test_abc",
    STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  });
  return loadEdgeFunction("stripe-webhook");
}


/** A webhook POST carrying a raw body + signature header. */
function webhookRequest(fn: EdgeHarness, rawBody: string, sig = "t=1,v1=abc") {
  return fn.request({
    rawBody,
    headers: { "stripe-signature": sig, "content-type": "application/json" },
  });
}


// Split 2026-11-07 (lander): stripe-webhook.test.ts was one 5,100-line file whose single worker hit the
// heap limit in CI (m1 #4217 shard 1/6, twice); this file holds payment_intent, charge.refunded and the dispute groups. Same tests, no assertion changed.
describe("stripe-webhook edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | payment_status.eq.failed | payment_status.eq.NEVER
  describe("payment_intent.succeeded", () => {
    // ── Q2083 (b): a job taxed at the JOB ADDRESS is committed to Stripe Tax ──
    // create-payment charged the tax as its own line with automatic_tax off, so
    // Stripe Tax records nothing unless we commit the calculation. It is
    // committed when the money is captured, and the transaction id stamped on
    // the PI is what the refund/dispute reversal (_visitTaxReversal) reads.
    describe("Q2083 (b): job-site sales tax", () => {
      const SITE = { job_id: "job-site", tax_calculation_id: "taxcalc_site", job_tax_cents: "1100" };
      async function deliverPi(metadata: Record<string, string>, extra: Record<string, unknown> = {}) {
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: `evt_site_${Math.random()}`,
          type: "payment_intent.succeeded",
          data: { object: { id: "pi_site", amount: 12100, metadata, ...extra } },
        });
        scenario.reads.jobs = { rows: [{ id: "job-site", customer_id: "poster-1", title: "Job", payment_status: "escrow", sales_tax_amount: 0, is_seed: true }] };
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
      }

      // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts |   await commitJobSiteTax({ stripe, pi, logStep, seed: taxJob?.is_seed === true \|\| testOrphan \|\| shopSeed, supabase }); | 
      it("commits the job-site calculation on capture and stamps the transaction on the PI", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        await deliverPi(SITE);
        expect(stripeMock.tax.transactions.createFromCalculation).toHaveBeenCalledTimes(1);
        const [args, opts] = stripeMock.tax.transactions.createFromCalculation.mock.calls[0];
        expect(args).toEqual({ calculation: "taxcalc_site", reference: "pi_site" });
        expect(opts).toEqual({ idempotencyKey: "job-site-tax:pi_site" });
        expect(stripeMock.paymentIntents.update).toHaveBeenCalledWith("pi_site", { metadata: { tax_transaction_id: "tax_txn_site" } });
      });

      // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts |     const taxAmountCents: number \| null = siteTax !== null ? siteTax : typeof | const taxAmountCents: number \| null = typeof
      it("records the job-site figure as sales_tax_amount even when Stripe's own tax field reads 0", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        await deliverPi(SITE, { amount_details: { tax: { total_tax_amount: 0 } } });
        const w = scenario.writes.find((x) => x.table === "jobs" && x.op === "update" && "sales_tax_amount" in (x.payload as Record<string, unknown>));
        expect((w?.payload as Record<string, unknown>).sales_tax_amount).toBe(11);
      });

      it("does nothing for an untaxed job, a $0 figure, or a PI already stamped", async () => {
        await deliverPi({ job_id: "job-site" });
        await deliverPi({ ...SITE, job_tax_cents: "0" });
        await deliverPi({ ...SITE, tax_transaction_id: "tax_txn_old" });
        expect(stripeMock.tax.transactions.createFromCalculation).not.toHaveBeenCalled();
      });

      // Review fix (lh-money-escrow on 378f7b321 #1): a duplicate checkout refunded BEFORE the
      // stamp found nothing to reverse on charge.refunded; the commit re-reads the refunds.
      // @mutate supabase/functions/stripe-webhook/handlers/_jobTaxCommit.ts |   if (ordinary.length === 0) return "none"; |   return "none";
      it("a refund made before the stamp is reversed right after the commit, keyed on the refund", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        stripeMock.refunds.list.mockResolvedValue({
          data: [{ id: "re_dup", amount: 12100, created: 50, status: "succeeded", charge: "ch_site", metadata: {} }],
          has_more: false,
        });
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_site", metadata: { ...SITE, tax_transaction_id: "tax_txn_site" } });
        stripeMock.tax.transactions.listLineItems.mockResolvedValue({ data: [{ id: "tax_li_1", amount: 10000, amount_tax: 1100, reference: "labor" }], has_more: false });
        stripeMock.tax.transactions.createReversal.mockImplementation(async (a: { reference: string }) => ({ id: `taxrev_${a.reference}` }));
        await deliverPi(SITE);
        expect(stripeMock.refunds.list).toHaveBeenCalledWith({ payment_intent: "pi_site", limit: 100 });
        expect(stripeMock.tax.transactions.createReversal.mock.calls.map((c) => ({ args: c[0], opts: c[1] }))).toEqual([{
          args: { mode: "partial", flat_amount: -11100, original_transaction: "tax_txn_site", reference: "refund:re_dup", metadata: { refund_id: "re_dup", charge_id: "ch_site" } },
          opts: { idempotencyKey: "visit-tax-reversal:re_dup" },
        }]);
      });

      // @mutate supabase/functions/stripe-webhook/handlers/_jobTaxCommit.ts |       title: "Job sales tax recorded, but its earlier refunds were not checked", |       title: "x",
      it("refunds that cannot be read after the commit page ops", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        stripeMock.refunds.list.mockRejectedValue(new Error("stripe down"));
        await deliverPi(SITE);
        const alerts = (slackAlerts as Array<{ title: string; kind: string }>).filter((a) => a.title === "Job sales tax recorded, but its earlier refunds were not checked");
        expect(alerts).toHaveLength(1);
        expect(alerts[0].kind).toBe("money_at_risk");
      });

      // Re-review of 49a8653d81 (C, HIGH): a hold captured only in part (the late fee) must not commit the full tax.
      // @mutate supabase/functions/stripe-webhook/handlers/_jobTaxCommit.ts |   if (!recordCapturedPart && !depositCapture && (cancelFeeCapture \|\| (shortfall !== 0 && shortfall !== setupFeeLeftOutCents))) { |   if (!recordCapturedPart && !depositCapture && cancelFeeCapture) {
      it("a hold captured only in part commits no tax and pages ops", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        await deliverPi(SITE, { amount_received: 2000 });
        expect(stripeMock.tax.transactions.createFromCalculation).not.toHaveBeenCalled();
        const alerts = (slackAlerts as Array<{ title: string; kind: string }>).filter((a) => a.title === "Job sales tax not recorded: the hold was captured only in part");
        expect(alerts).toHaveLength(1);
        expect(alerts[0].kind).toBe("money_at_risk");
      });

      // Q2716: the hire's capture names the exact cents it left out (cardHold.ts); exactly that still commits.
      // @mutate supabase/functions/stripe-webhook/handlers/_jobTaxCommit.ts |   const setupFeeLeftOutCents = Number.isInteger(leftOut) && leftOut > 0 ? leftOut : 0; |   const setupFeeLeftOutCents = 0;
      it("a hire that leaves out exactly the stamped setup fee still commits (Q2716)", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        await deliverPi({ ...SITE, setup_fee_left_out_cents: "200" }, { amount_received: 12100 - 200 });
        expect(stripeMock.tax.transactions.createFromCalculation).toHaveBeenCalledTimes(1);
      });

      it("a non-default setup fee left out commits for exactly its stamped cents, never a guessed $2 (Q2716)", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        await deliverPi({ ...SITE, setup_fee_left_out_cents: "350" }, { amount_received: 12100 - 350 });
        expect(stripeMock.tax.transactions.createFromCalculation).toHaveBeenCalledTimes(1);
      });

      it("a shortfall that is not exactly the stamped cents is a partial capture (Q2716)", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        await deliverPi({ ...SITE, setup_fee_left_out_cents: "200" }, { amount_received: 12100 - 150 });
        await deliverPi({ ...SITE, setup_fee_left_out_cents: "200" }, { amount_received: 12100 - 1200 });
        // The old $2 allowance from onboarding_fee_charged alone is gone.
        await deliverPi({ ...SITE, onboarding_fee_charged: "true" }, { amount_received: 12100 - 200 });
        expect(stripeMock.tax.transactions.createFromCalculation).not.toHaveBeenCalled();
      });

      it("a $2 short capture with no setup fee stamped is still a partial capture", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        await deliverPi(SITE, { amount_received: 12100 - 200 });
        expect(stripeMock.tax.transactions.createFromCalculation).not.toHaveBeenCalled();
      });

      // Q2716: a cancelled job's fee capture (void-cancelled-payments) is always skipped and paged, even a full one.
      // @mutate supabase/functions/stripe-webhook/handlers/_jobTaxCommit.ts |   const cancelFeeCapture = md[CANCEL_FEE_CAPTURE_KEY] === "1"; |   const cancelFeeCapture = false;
      it("a cancellation-fee capture never commits, even when the fees reach the whole hold (Q2716)", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        await deliverPi({ ...SITE, cancel_fee_capture: "1" }, { amount_received: 12100 });
        expect(stripeMock.tax.transactions.createFromCalculation).not.toHaveBeenCalled();
        const alerts = (slackAlerts as Array<{ title: string; kind: string; message: string }>).filter((a) => a.title === "Job sales tax not recorded: the hold was captured only in part");
        expect(alerts).toHaveLength(1);
        expect(alerts[0].message).toContain("cancelled job's fee");
      });

      // Q2716 (left part): a fee capture stamped with the tax inside it is recorded exactly, with no hand step.
      // @mutate supabase/functions/stripe-webhook/handlers/_jobTaxCommit.ts |   if (stampedKeptCents === 0) { |   if (stampedKeptCents === -1) {
      it("a fee capture holding none of its tax records nothing and pages nobody (Q2716)", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        await deliverPi({ ...SITE, cancel_fee_capture: "1", cancel_fee_tax_kept_cents: "0" }, { amount_received: 2000 });
        expect(stripeMock.tax.transactions.createFromCalculation).not.toHaveBeenCalled();
        expect((slackAlerts as Array<{ title: string }>).filter((a) => a.title === "Job sales tax not recorded: the hold was captured only in part")).toHaveLength(0);
      });

      // Review of 2ecaceaf84: a stamp below the tax the capture plainly holds (it reached past amount - tax) is never
      // believed, so collected tax is never silently dropped; it pages as an unstamped fee capture does.
      // @mutate supabase/functions/stripe-webhook/handlers/_jobTaxCommit.ts | && taxAtLeastCents !== null && Number(keptRaw) >= taxAtLeastCents ? | ?
      it("a fee capture stamped 0 that reaches into the tax pages and records nothing (review of 2ecaceaf84)", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        await deliverPi({ ...SITE, cancel_fee_capture: "1", cancel_fee_tax_kept_cents: "0" }, { amount_received: 11500 });
        await deliverPi({ ...SITE, cancel_fee_capture: "1", cancel_fee_tax_kept_cents: "400" }, { amount_received: 11500 });
        expect(stripeMock.tax.transactions.createFromCalculation).not.toHaveBeenCalled();
        expect((slackAlerts as Array<{ title: string }>).filter((a) => a.title === "Job sales tax not recorded: the hold was captured only in part")).toHaveLength(2);
      });

      // @mutate supabase/functions/stripe-webhook/handlers/_jobTaxCommit.ts |        title: "Job sales tax on a cancelled hold reversed, but not stamped", |        title: "x",
      it("a released-tax reversal that went through but was not stamped pages 'do not reverse again' (review of 2ecaceaf84)", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        stripeMock.tax.transactions.listLineItems.mockResolvedValue({ data: [{ id: "tax_li_1", amount: 10000, amount_tax: 1100 }], has_more: false });
        stripeMock.tax.transactions.createReversal.mockResolvedValue({ id: "taxrev_unc" });
        stripeMock.paymentIntents.update.mockImplementation(async (_id: string, p: { metadata?: Record<string, string> }) => {
          if (p?.metadata?.tax_rev_uncaptured) throw new Error("stripe down");
          return { id: "pi_site" };
        });
        await deliverPi({ ...SITE, cancel_fee_capture: "1", cancel_fee_tax_kept_cents: "500" }, { amount_received: 11500 });
        expect(stripeMock.tax.transactions.createReversal).toHaveBeenCalledTimes(1);
        const titles = (slackAlerts as Array<{ title: string }>).map((a) => a.title);
        expect(titles).toContain("Job sales tax on a cancelled hold reversed, but not stamped");
        expect(titles).not.toContain("Job sales tax recorded in full, but the hold kept only part of it");
      });

      // @mutate supabase/functions/stripe-webhook/handlers/_jobTaxCommit.ts |     const flatCents = Math.min(txTotalCents, Math.floor((backCents * txTotalCents) / taxCents)); |     const flatCents = txTotalCents;
      // @mutate supabase/functions/stripe-webhook/handlers/_jobTaxCommit.ts |   if (recordCapturedPart && stampedKeptCents !== null && stampedKeptCents < cents) { |   if (false) {
      it("a fee capture holding part of its tax commits, then reverses exactly the released tax (Q2716)", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        stripeMock.refunds.list.mockResolvedValue({ data: [], has_more: false });
        stripeMock.tax.transactions.listLineItems.mockResolvedValue({ data: [{ id: "tax_li_1", amount: 10000, amount_tax: 1100, reference: "labor" }], has_more: false });
        stripeMock.tax.transactions.createReversal.mockResolvedValue({ id: "taxrev_unc" });
        await deliverPi({ ...SITE, cancel_fee_capture: "1", cancel_fee_tax_kept_cents: "500" }, { amount_received: 11500 });
        expect(stripeMock.tax.transactions.createFromCalculation).toHaveBeenCalledTimes(1);
        // 600c of the 1100c tax was released: floor(600 x 11100 / 1100) = 6054 of labor + tax reversed, 500c tax stays.
        expect(stripeMock.tax.transactions.createReversal.mock.calls.map((c) => ({ args: c[0], opts: c[1] }))).toEqual([{
          args: { mode: "partial", flat_amount: -6054, original_transaction: "tax_txn_site", reference: "uncaptured:pi_site", metadata: { payment_intent: "pi_site", tax_back_cents: "600" } },
          opts: { idempotencyKey: "job-site-tax-uncaptured:pi_site" },
        }]);
        expect(stripeMock.paymentIntents.update).toHaveBeenCalledWith("pi_site", { metadata: { tax_rev_uncaptured: "taxrev_unc" } });
        expect((slackAlerts as Array<{ title: string }>).filter((a) => a.title === "Job sales tax not recorded: the hold was captured only in part")).toHaveLength(0);
      });

      it("a fee capture keeping all its tax commits with no reversal; a stamp above the tax still pages (Q2716)", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        stripeMock.refunds.list.mockResolvedValue({ data: [], has_more: false });
        await deliverPi({ ...SITE, cancel_fee_capture: "1", cancel_fee_tax_kept_cents: "1100" }, { amount_received: 12100 });
        expect(stripeMock.tax.transactions.createFromCalculation).toHaveBeenCalledTimes(1);
        expect(stripeMock.tax.transactions.createReversal).not.toHaveBeenCalled();
        await deliverPi({ ...SITE, cancel_fee_capture: "1", cancel_fee_tax_kept_cents: "1200" }, { amount_received: 12100 });
        expect(stripeMock.tax.transactions.createFromCalculation).toHaveBeenCalledTimes(1);
        expect((slackAlerts as Array<{ title: string }>).filter((a) => a.title === "Job sales tax not recorded: the hold was captured only in part")).toHaveLength(1);
      });

      // @mutate supabase/functions/stripe-webhook/handlers/_jobTaxCommit.ts |       title: "Job sales tax recorded in full, but the hold kept only part of it", |       title: "x",
      it("a failed released-tax reversal pages ops with the hand step (Q2716)", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        stripeMock.tax.transactions.listLineItems.mockResolvedValue({ data: [{ id: "tax_li_1", amount: 10000, amount_tax: 1100 }], has_more: false });
        stripeMock.tax.transactions.createReversal.mockRejectedValue(new Error("stripe down"));
        await deliverPi({ ...SITE, cancel_fee_capture: "1", cancel_fee_tax_kept_cents: "500" }, { amount_received: 11500 });
        const alerts = (slackAlerts as Array<{ title: string; kind: string }>).filter((a) => a.title === "Job sales tax recorded in full, but the hold kept only part of it");
        expect(alerts).toHaveLength(1);
        expect(alerts[0].kind).toBe("money_at_risk");
      });

      it("a hold captured in full still commits", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockResolvedValue({ id: "tax_txn_site" });
        await deliverPi(SITE, { amount_received: 12100 });
        expect(stripeMock.tax.transactions.createFromCalculation).toHaveBeenCalledTimes(1);
      });

      // @mutate supabase/functions/stripe-webhook/handlers/_jobTaxCommit.ts |       title: "Job sales tax collected but NOT recorded in Stripe Tax", |       title: "x",
      it("a failed commit pages ops (money_at_risk) and still answers 200", async () => {
        stripeMock.tax.transactions.createFromCalculation.mockImplementation(() => { throw new Error("calculation expired"); });
        await deliverPi(SITE);
        const alerts = (slackAlerts as Array<{ title: string; kind: string }>).filter((a) => a.title === "Job sales tax collected but NOT recorded in Stripe Tax");
        expect(alerts).toHaveLength(1);
        expect(alerts[0].kind).toBe("money_at_risk");
        expect(stripeMock.paymentIntents.update).not.toHaveBeenCalledWith("pi_site", expect.anything());
      });
    });

    it("promotes a card-declined-then-ACH-succeeded job from failed to escrow", async () => {
      // Bug 3 (ME-046): a card decline within the same checkout session marks the
      // job 'failed' first. When the poster retries with ACH and the debit settles,
      // paymentIntentSucceeded must recognise 'failed' as a promotable state.
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_pi_succeeded_failed",
        type: "payment_intent.succeeded",
        data: {
          object: {
            id: "pi_ach_after_card_fail",
            amount: 5000,
            amount_details: { tax: { total_tax_amount: 0 } },
          },
        },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "failed", sales_tax_amount: 0, is_seed: true }],
      };
      scenario.writeSelectRows.jobs = [{ id: "job-1" }];
      await fn.fetch(webhookRequest(fn, "{}"));
      const escrowWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update" && (w.payload as Record<string, unknown>).payment_status === "escrow",
      );
      expect(escrowWrite).toBeDefined();
      // CAS filter must include 'failed' so the update actually matches.
      expect(JSON.stringify(escrowWrite?.filters)).toMatch(/payment_status\.eq\.failed/);
    });

    // Q1879: an 'abandoned' job whose bank debit settles anyway holds captured
    // money; without this it could never be funded.
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | taxJob.payment_status === "failed" \|\|\n      taxJob.payment_status === "abandoned"; | taxJob.payment_status === "failed";
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | payment_status.eq.failed,payment_status.eq.abandoned") | payment_status.eq.failed")
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | payment_status.eq.abandoned")\n        .neq("status", "completed") | payment_status.eq.abandoned")
    it("promotes an abandoned job whose bank debit settled anyway to escrow (Q1879)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_pi_succeeded_abandoned",
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_ach_abandoned", amount: 5000, amount_details: { tax: { total_tax_amount: 0 } } } },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "abandoned", status: "open", sales_tax_amount: 0, is_seed: true }],
      };
      scenario.writeSelectRows.jobs = [{ id: "job-1" }];
      await fn.fetch(webhookRequest(fn, "{}"));
      const escrowWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update" && (w.payload as Record<string, unknown>).payment_status === "escrow",
      );
      expect(escrowWrite).toBeDefined();
      expect(JSON.stringify(escrowWrite?.filters)).toMatch(/payment_status\.eq\.abandoned/);
      expect(escrowWrite?.filters).toContainEqual({ op: "neq", column: "status", value: "completed" });
    });

    // Q1879 review: a CANCELLED job is promoted on purpose, because
    // void-cancelled-payments Part A (cancelled + escrow) refunds it.
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | if (isStillUnpaid && taxJob.status === "completed") { | if (isStillUnpaid && (taxJob.status === "completed" \|\| taxJob.status === "cancelled")) {
    it("promotes a cancelled abandoned job to escrow so the cancelled-escrow sweep refunds it (Q1879)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_pi_succeeded_abandoned_cancelled",
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_ach_cancelled", amount: 5000, amount_details: { tax: { total_tax_amount: 0 } } } },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "abandoned", status: "cancelled", sales_tax_amount: 0, is_seed: true }],
      };
      scenario.writeSelectRows.jobs = [{ id: "job-1" }];
      await fn.fetch(webhookRequest(fn, "{}"));
      const escrowWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update" && (w.payload as Record<string, unknown>).payment_status === "escrow",
      );
      expect(escrowWrite).toBeDefined();
      expect((slackAlerts as Array<{ kind?: string }>).some((a) => a.kind === "money_at_risk")).toBe(false);
    });

    // Q1879: a COMPLETED job is never escrowed (nothing would pay it out or
    // refund it); the captured money is paged to ops to refund.
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | if (isStillUnpaid && taxJob.status === "completed") { | if (false) {
    it("never escrows a bank payment that settles on a completed unfunded job; pages ops to refund (Q1879)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_pi_succeeded_abandoned_completed",
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_ach_completed", amount: 5000, amount_details: { tax: { total_tax_amount: 0 } } } },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "abandoned", status: "completed", sales_tax_amount: 0, is_seed: true }],
      };
      scenario.writeSelectRows.jobs = [{ id: "job-1" }];
      await fn.fetch(webhookRequest(fn, "{}"));
      const escrowWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update" && (w.payload as Record<string, unknown>).payment_status === "escrow",
      );
      expect(escrowWrite).toBeUndefined();
      expect((slackAlerts as Array<{ kind?: string; title?: string }>).some(
        (a) => a.kind === "money_at_risk" && /can never be funded/.test(a.title ?? ""),
      )).toBe(true);
    });

    // Q1879 review #3: zero rows is re-read. A job completed in between and
    // still unfunded is money at risk, not "already funded".
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | if (nowUnfunded && now.status === "completed") { | if (false) {
    it("pages money at risk when the escrow write matches zero rows because the job completed unfunded (Q1879)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_pi_succeeded_race_completed",
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_ach_race", amount: 5000, amount_details: { tax: { total_tax_amount: 0 } } } },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "unpaid", status: "open", sales_tax_amount: 0, is_seed: true }],
        eqOverrides: [{ column: "id", value: "job-1", result: { rows: [{ status: "completed", payment_status: "unpaid" }] } }],
      };
      scenario.writeSelectRows.jobs = [];
      await fn.fetch(webhookRequest(fn, "{}"));
      const alerts = slackAlerts as Array<{ kind?: string; title?: string }>;
      expect(alerts.some((a) => a.kind === "money_at_risk" && /can never be funded/.test(a.title ?? ""))).toBe(true);
      expect(alerts.some((a) => /no longer unpaid/.test(a.title ?? ""))).toBe(false);
    });

    // Q1879: a job deleted between the read and the write leaves captured
    // money with no job to hold it.
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | if (!now) { | if (false) {
    it("pages money at risk when the job is gone by the escrow write (Q1879)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_pi_succeeded_race_deleted",
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_ach_race3", amount: 5000, amount_details: { tax: { total_tax_amount: 0 } } } },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "unpaid", status: "open", sales_tax_amount: 0, is_seed: true }],
        eqOverrides: [{ column: "id", value: "job-1", result: { rows: [] } }],
      };
      scenario.writeSelectRows.jobs = [];
      await fn.fetch(webhookRequest(fn, "{}"));
      const alerts = slackAlerts as Array<{ kind?: string; title?: string }>;
      expect(alerts.some((a) => a.kind === "money_at_risk" && /can never be funded/.test(a.title ?? ""))).toBe(true);
    });

    // Q1879: a re-read that fails never acks captured money blind.
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | if (nowErr) { | if (false) {
    it("returns 500 so Stripe retries when the zero-row re-read fails (Q1879)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_pi_succeeded_race_readfail",
        type: "payment_intent.succeeded",
        data: { object: { id: "pi_ach_race2", amount: 5000, amount_details: { tax: { total_tax_amount: 0 } } } },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "unpaid", status: "open", sales_tax_amount: 0, is_seed: true }],
        eqOverrides: [{ column: "id", value: "job-1", result: { error: { message: "boom" } } }],
      };
      scenario.writeSelectRows.jobs = [];
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(500);
    });

    // Q1994: a payment that settles on a job already refunded/cancelled/
    // cancelling is captured money with no escrow. A BANK payment pages ops to
    // refund it; a CARD one is a redelivery and stays quiet; an unreadable
    // payment method fails closed and pages.
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | } else if (!FUNDED_PAYMENT_STATUSES.has(String(taxJob.payment_status))) { | } else if (false) {
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | if (paidWith !== "us_bank_account" && paidWith !== null) { | if (paidWith !== null) {
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | if (paidWith !== "us_bank_account" && paidWith !== null) { | if (paidWith !== "us_bank_account") {
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | const FUNDED_PAYMENT_STATUSES = new Set(["escrow", "payout_pending", "released"]); | const FUNDED_PAYMENT_STATUSES = new Set(["escrow", "payout_pending", "released", "refunded"]);
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | new Set(["escrow", "payout_pending", "released"]) | new Set(["escrow", "payout_pending"])
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | const fromEvent = typeOf(pi.latest_charge); | const fromEvent = null as string \| null;
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentSucceeded.ts | return typeOf(full?.latest_charge); | return "card";
    describe("Q1994 a payment that settles on a job already refunded or closed", () => {
      async function settle(paymentStatus: string, latestCharge?: unknown) {
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: `evt_pi_succeeded_closed_${paymentStatus}`,
          type: "payment_intent.succeeded",
          data: { object: { id: "pi_closed", amount: 5000, amount_details: { tax: { total_tax_amount: 0 } }, latest_charge: latestCharge ?? "ch_closed" } },
        });
        scenario.reads.jobs = {
          rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: paymentStatus, status: "cancelled", sales_tax_amount: 0, is_seed: true }],
        };
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        const pages = (slackAlerts as Array<{ kind?: string; title?: string; fields?: Record<string, unknown> }>).filter((a) => a.kind === "money_at_risk");
        const escrowWrite = scenario.writes.find(
          (w) => w.table === "jobs" && w.op === "update" && (w.payload as Record<string, unknown>).payment_status === "escrow",
        );
        return { res, pages, escrowWrite };
      }

      for (const ps of ["refunded", "cancelled", "cancelling"]) {
        it(`pages ops to refund a BANK payment that settles on a '${ps}' job (read from the PI's charge)`, async () => {
          stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_closed", latest_charge: { id: "ch_closed", payment_method_details: { type: "us_bank_account" } } });
          const { res, pages, escrowWrite } = await settle(ps);
          expect(res.status).toBe(200);
          expect(escrowWrite).toBeUndefined();
          expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith("pi_closed", { expand: ["latest_charge"] });
          expect(pages).toHaveLength(1);
          expect(pages[0].title).toMatch(/Bank payment settled on a job that is already refunded or closed/);
          expect(pages[0].fields).toMatchObject({ job_id: "job-1", payment_intent: "pi_closed", payment_status: ps, method: "us_bank_account" });
        });
      }

      it("reads the type from the event's expanded charge without a Stripe call", async () => {
        const { pages } = await settle("refunded", { id: "ch_closed", payment_method_details: { type: "us_bank_account" } });
        expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
        expect(pages).toHaveLength(1);
      });

      it("stays quiet on a CARD redelivery for a job refunded later", async () => {
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_closed", latest_charge: { id: "ch_closed", payment_method_details: { type: "card" } } });
        const { res, pages, escrowWrite } = await settle("refunded");
        expect(res.status).toBe(200);
        expect(escrowWrite).toBeUndefined();
        expect(pages).toHaveLength(0);
        expect(slackAlerts).toHaveLength(0);
      });

      it("fails closed and pages when the PI cannot be read", async () => {
        stripeMock.paymentIntents.retrieve.mockRejectedValue(new Error("stripe down"));
        const { pages } = await settle("refunded");
        expect(pages).toHaveLength(1);
        expect(pages[0].title).toMatch(/payment method could not be read/);
        expect(pages[0].fields).toMatchObject({ method: "unknown" });
      });

      it("fails closed and pages when the charge carries no payment method type", async () => {
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_closed", latest_charge: "ch_closed" });
        const { pages } = await settle("cancelling");
        expect(pages).toHaveLength(1);
        expect(pages[0].fields).toMatchObject({ method: "unknown" });
      });

      it("never reads Stripe or pages for a funded job (escrow, payout_pending, released)", async () => {
        for (const ps of ["escrow", "payout_pending", "released"]) {
          resetStripeMock();
          resetSharedMocks();
          const { pages } = await settle(ps);
          expect(pages).toHaveLength(0);
          expect(stripeMock.paymentIntents.retrieve).not.toHaveBeenCalled();
        }
      });
    });

    it("does not promote a job that is already in escrow (sync card payment)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_pi_succeeded_escrow",
        type: "payment_intent.succeeded",
        data: {
          object: {
            id: "pi_card",
            amount: 5000,
            amount_details: { tax: { total_tax_amount: 0 } },
          },
        },
      });
      // Job is already escrow (sync card payment — PI.succeeded also fires for cards).
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "escrow", sales_tax_amount: 0, is_seed: true }],
      };
      // write-select returns empty (CAS guard excludes escrow — correct, nothing written).
      scenario.writeSelectRows.jobs = [];
      await fn.fetch(webhookRequest(fn, "{}"));
      const escrowWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update" && (w.payload as Record<string, unknown>).payment_status === "escrow",
      );
      expect(escrowWrite).toBeUndefined();
    });
  });

  describe("payment_intent.payment_failed", () => {
    // Q769: a decline is retryable inside the open Checkout Session, so the
    // "job isn't posted" notice waits for checkout.session.expired.
    it("marks the linked job failed and does not notify the poster yet", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_fail",
        type: "payment_intent.payment_failed",
        data: {
          object: {
            id: "pi_failed",
            receipt_email: "poster@test.com",
            // ME-040: a declined Checkout never writes
            // jobs.stripe_payment_intent_id (only the success path does), so
            // the handler resolves the job via `pi.metadata.job_id` — the
            // one field create-payment sets unconditionally on every
            // Checkout Session's payment_intent_data.
            metadata: { job_id: "job-1" },
          },
        },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", stripe_session_id: "cs_open" }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      const jobWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect((jobWrite?.payload as Record<string, unknown>).payment_status).toBe(
        "failed",
      );
      const notif = scenario.writes.find((w) => w.table === "notifications");
      expect(notif).toBeUndefined();
    });

    // ME-046: stripe_session_id is null when checkoutSessionExpired already cleared it
    // (session window expired before the ACH bounce arrived). checkSessionStatus
    // short-circuits to closed=true for null → notify immediately.
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | if (!sessionId) return { closed: true, clearSessionId: false }; | if (!sessionId) return { closed: false, clearSessionId: false };
    it("notifies the poster immediately when stripe_session_id is null (session already cleared)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_fail_ach",
        type: "payment_intent.payment_failed",
        data: {
          object: {
            id: "pi_failed_ach",
            receipt_email: "poster@test.com",
            metadata: { job_id: "job-1" },
          },
        },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", stripe_session_id: null }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      const notif = scenario.writes.find((w) => w.table === "notifications");
      expect(notif).toBeDefined();
      expect((notif?.payload as Record<string, unknown>).link).toBe("/post-job");
    });

    // ME-046: ACH session is "complete" immediately at Checkout but the debit can
    // bounce days later. stripe_session_id is still set (not null), so
    // checkSessionStatus must check live status — "complete" + same PI + failed
    // status → notify + clear stripe_session_id so a new checkout is allowed.
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | return { closed: true, clearSessionId: true }; | return { closed: false, clearSessionId: false };
    it("notifies immediately and clears stripe_session_id when Checkout Session is complete (ACH bounce)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_fail_ach_complete",
        type: "payment_intent.payment_failed",
        data: {
          object: {
            id: "pi_ach_bounced",
            receipt_email: "poster@test.com",
            metadata: { job_id: "job-1" },
          },
        },
      });
      // Expanded session: PI id matches, status is requires_payment_method (ACH bounced).
      stripeMock.checkout.sessions.retrieve.mockResolvedValue({
        status: "complete",
        payment_intent: { id: "pi_ach_bounced", status: "requires_payment_method" },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "unpaid", stripe_session_id: "cs_ach_done" }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      // Notification must fire.
      const notif = scenario.writes.find((w) => w.table === "notifications");
      expect(notif).toBeDefined();
      expect((notif?.payload as Record<string, unknown>).link).toBe("/post-job");
      // stripe_session_id must be cleared so create-payment can mint a new checkout.
      const jobWrite = scenario.writes.find((w) => w.table === "jobs" && w.op === "update");
      expect((jobWrite?.payload as Record<string, unknown>).stripe_session_id).toBeNull();
    });

    // Q1876: a gift-shortfall checkout paid by bank completes BEFORE the debit
    // settles, and that completion spends the gift ('redeemed'). When the debit
    // bounces the job was never funded: the SAME gift row comes back through
    // return_bounced_gift_card (never a minted replacement: lh-money-escrow
    // review of 6b06413c7, #1), named only by pi.metadata.gift_card_id (#2).
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | const giftBack = clearSessionId && giftCardId | const giftBack = false && giftCardId
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts |       if (giftCardId && failedJob.payment_status === "failed") { |       if (false) {
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | if ((back === "returned" \|\| back === "returned_unspendable") && failedJob.customer_id) { | if (false) {
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts |     if (notDeployed) return "held"; |
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts |   if (outcome === "not_consumed" \|\| outcome === "already_restored") return "none"; |
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts |   if (outcome === "not_consumed" \|\| outcome === "already_restored") return "none"; |   if (outcome === "not_consumed") return "none";
    describe("Q1876 a bounced bank debit gives back the gift card its checkout spent", () => {
      const bounce = async (
        jobRow: Record<string, unknown>,
        metadata: Record<string, string> = { job_id: "job-1", gift_card_id: "gc-1" },
      ) => {
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: "evt_fail_ach_gift",
          type: "payment_intent.payment_failed",
          data: { object: { id: "pi_ach_gift", receipt_email: "poster@test.com", metadata } },
        });
        stripeMock.checkout.sessions.retrieve.mockResolvedValue({
          status: "complete",
          payment_intent: { id: "pi_ach_gift", status: "requires_payment_method" },
        });
        scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", ...jobRow }] };
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        const notices = scenario.writes.filter((w) => w.table === "notifications");
        const alerts = slackAlerts as Array<{ kind?: string; title?: string }>;
        return { res, notices, alerts };
      };
      const returnCalls = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "return_bounced_gift_card");
      const noMint = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "restore_gift_card_for_job");

      it("returns the exact gift when the bounce marks the job failed, and the notice says so", async () => {
        scenario.rpc.return_bounced_gift_card = { outcome: "returned", credit_id: "gc-1", restore_cents: 2500, payment_status: "paid" };
        const { res, notices } = await bounce({ payment_status: "unpaid", stripe_session_id: "cs_ach_gift" });
        expect(res.status).toBe(200);
        expect(returnCalls()).toHaveLength(1);
        expect(returnCalls()[0].args).toEqual({ p_job_id: "job-1", p_gift_card_id: "gc-1" });
        expect(noMint()).toHaveLength(0);
        expect(notices).toHaveLength(1);
        expect(String((notices[0].payload as Record<string, unknown>).message)).toMatch(/gift card is back/);
      });

      // lh-money-escrow re-review of 2cd90f553, nit 5: a gift whose donation was
      // refunded comes back as a row redeem_gift_card refuses.
      // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | return answer?.payment_status === "paid" ? "returned" : "returned_unspendable"; | return "returned";
      it("a returned gift whose donation was refunded is not called usable in the notice", async () => {
        scenario.rpc.return_bounced_gift_card = { outcome: "returned", credit_id: "gc-1", restore_cents: 2500, payment_status: "refunded" };
        const { res, notices } = await bounce({ payment_status: "unpaid", stripe_session_id: "cs_ach_gift" });
        expect(res.status).toBe(200);
        expect(returnCalls()).toHaveLength(1);
        expect(notices).toHaveLength(1);
        expect(String((notices[0].payload as Record<string, unknown>).message)).not.toMatch(/gift/);
      });

      it("a PaymentIntent without gift_card_id makes no gift call (not a gift shortfall)", async () => {
        const { notices } = await bounce({ payment_status: "unpaid", stripe_session_id: "cs_ach_gift" }, { job_id: "job-1" });
        expect(returnCalls()).toHaveLength(0);
        expect(notices).toHaveLength(1);
        expect(String((notices[0].payload as Record<string, unknown>).message)).not.toMatch(/gift/);
      });

      it("a database error pages money_at_risk and answers non-2xx so Stripe retries; no notice yet", async () => {
        scenario.rpcErrors = { return_bounced_gift_card: { message: "boom" } };
        const { res, notices, alerts } = await bounce({ payment_status: "unpaid", stripe_session_id: "cs_ach_gift" });
        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(notices).toHaveLength(0);
        expect(alerts.some((a) => a.kind === "money_at_risk" && /gift card was NOT returned/.test(a.title ?? ""))).toBe(true);
      });

      it("the function not deployed yet (PGRST202) pages ops but lets the bounce stand: 200 and the plain notice", async () => {
        scenario.rpcErrors = { return_bounced_gift_card: { message: "Could not find the function", code: "PGRST202" } };
        const { res, notices, alerts } = await bounce({ payment_status: "unpaid", stripe_session_id: "cs_ach_gift" });
        expect(res.status).toBe(200);
        expect(notices).toHaveLength(1);
        expect(String((notices[0].payload as Record<string, unknown>).message)).not.toMatch(/gift/);
        expect(alerts.some((a) => a.kind === "money_at_risk")).toBe(true);
      });

      // Q2079: Postgres' own undefined_function (42883) is "not deployed" too,
      // the same rule the cancel RPC's check uses (one shared helper).
      // @mutate supabase/functions/_shared/rpcNotDeployed.ts |   return code === "PGRST202" \|\| code === "42883"; |   return code === "PGRST202";
      it("the function not deployed yet as 42883 (undefined_function) is read the same as PGRST202: 200 and the plain notice", async () => {
        scenario.rpcErrors = { return_bounced_gift_card: { message: "function public.return_bounced_gift_card(uuid, uuid) does not exist", code: "42883" } };
        const { res, notices, alerts } = await bounce({ payment_status: "unpaid", stripe_session_id: "cs_ach_gift" });
        expect(res.status).toBe(200);
        expect(notices).toHaveLength(1);
        expect(String((notices[0].payload as Record<string, unknown>).message)).not.toMatch(/gift/);
        expect(alerts.some((a) => a.kind === "money_at_risk" && /gift card was NOT returned/.test(a.title ?? ""))).toBe(true);
      });

      it("the retry (job already failed, session cleared) returns the gift AND sends the notice the first delivery lost", async () => {
        scenario.rpc.return_bounced_gift_card = { outcome: "returned", credit_id: "gc-1", restore_cents: 2500, payment_status: "paid" };
        // The CAS no longer matches a 'failed' job with no session: zero rows.
        scenario.writeSelectRows.jobs = [];
        const { res, notices } = await bounce({ payment_status: "failed", stripe_session_id: null });
        expect(res.status).toBe(200);
        expect(returnCalls()).toHaveLength(1);
        expect(notices).toHaveLength(1);
        expect(String((notices[0].payload as Record<string, unknown>).message)).toMatch(/gift card is back/);
      });

      it("a retry that finds the gift already back sends no second notice", async () => {
        scenario.rpc.return_bounced_gift_card = { outcome: "not_consumed", credit_id: "gc-1" };
        scenario.writeSelectRows.jobs = [];
        const { notices, alerts } = await bounce({ payment_status: "failed", stripe_session_id: null });
        expect(returnCalls()).toHaveLength(1);
        expect(notices).toHaveLength(0);
        expect(alerts.some((a) => a.kind === "money_at_risk")).toBe(false);
      });

      it("Q2077: a gift a cancel's refund already gave back as a new row (already_restored) sends no notice and pages nobody", async () => {
        scenario.rpc.return_bounced_gift_card = { outcome: "already_restored", credit_id: "gc-1" };
        scenario.writeSelectRows.jobs = [];
        const { notices, alerts } = await bounce({ payment_status: "failed", stripe_session_id: null });
        expect(returnCalls()).toHaveLength(1);
        expect(notices).toHaveLength(0);
        expect(alerts.some((a) => a.kind === "money_at_risk")).toBe(false);
      });

      it("a retry after the poster opened a new checkout pages ops instead of acking silently", async () => {
        scenario.rpc.return_bounced_gift_card = { outcome: "checkout_open" };
        scenario.writeSelectRows.jobs = [];
        stripeMock.checkout.sessions.retrieve.mockResolvedValue({ status: "open" });
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: "evt_fail_ach_gift_retry",
          type: "payment_intent.payment_failed",
          data: { object: { id: "pi_ach_gift", receipt_email: "poster@test.com", metadata: { job_id: "job-1", gift_card_id: "gc-1" } } },
        });
        scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "failed", stripe_session_id: "cs_new_card" }] };
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        expect(returnCalls()).toHaveLength(1);
        expect((slackAlerts as Array<{ kind?: string; title?: string }>).some(
          (a) => a.kind === "money_at_risk" && /gift card still spent/.test(a.title ?? ""),
        )).toBe(true);
        expect(scenario.writes.filter((w) => w.table === "notifications")).toHaveLength(0);
      });
    });

    // B1: card decline marks job 'failed', poster retries with ACH on same session,
    // ACH bounces. The update must still match even though payment_status is already
    // 'failed', and must clear stripe_session_id so a new checkout is allowed.
    it("clears stripe_session_id and notifies when ACH bounces after prior card decline (B1)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_fail_ach_after_card",
        type: "payment_intent.payment_failed",
        data: {
          object: {
            id: "pi_ach_after_card",
            receipt_email: "poster@test.com",
            metadata: { job_id: "job-1" },
          },
        },
      });
      stripeMock.checkout.sessions.retrieve.mockResolvedValue({
        status: "complete",
        payment_intent: { id: "pi_ach_after_card", status: "requires_payment_method" },
      });
      // Job is already 'failed' from the prior card decline.
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "failed", stripe_session_id: "cs_ach_after_card" }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      // Notification fires.
      const notif = scenario.writes.find((w) => w.table === "notifications");
      expect(notif).toBeDefined();
      // stripe_session_id cleared so a new checkout is allowed.
      const jobWrite = scenario.writes.find((w) => w.table === "jobs" && w.op === "update");
      expect((jobWrite?.payload as Record<string, unknown>).stripe_session_id).toBeNull();
      // CAS filter must include 'failed'.
      expect(JSON.stringify(jobWrite?.filters)).toMatch(/payment_status\.eq\.failed/);
    });

    // The unpaid half of the dead-bank-payment class (7440a72d was the funded
    // half): a COMPLETED checkout whose bank debit failed leaves its
    // PaymentIntent requires_payment_method forever; it is cancelled at Stripe.
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts |     if (clearSessionId) await cancelDeadBankPayment(stripe, pi.id, String(failedJob.id), logStep, failedJob.is_seed ?? false); |     void clearSessionId;
    it("an unpaid job's completed bank checkout that failed: the dead PaymentIntent is cancelled at Stripe", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_fail_ach_unpaid",
        type: "payment_intent.payment_failed",
        data: { object: { id: "pi_ach_unpaid", receipt_email: "poster@test.com", metadata: { job_id: "job-1" } } },
      });
      stripeMock.checkout.sessions.retrieve.mockResolvedValue({
        status: "complete",
        payment_intent: { id: "pi_ach_unpaid", status: "requires_payment_method" },
      });
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_ach_unpaid", status: "requires_payment_method" });
      stripeMock.checkout.sessions.list.mockResolvedValue({ data: [{ id: "cs_ach_unpaid", status: "complete" }] });
      stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_ach_unpaid", status: "canceled" });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "unpaid", stripe_session_id: "cs_ach_unpaid" }],
      };
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      expect(stripeMock.paymentIntents.cancel.mock.calls).toEqual([
        ["pi_ach_unpaid", { cancellation_reason: "abandoned" }, { idempotencyKey: "cancel-failed-bank-payment-pi_ach_unpaid" }],
      ]);
    });

    it("a card declined inside a still-OPEN checkout is never cancelled (the poster can try another card)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_fail_card_open",
        type: "payment_intent.payment_failed",
        data: { object: { id: "pi_card_open", receipt_email: "poster@test.com", metadata: { job_id: "job-1" } } },
      });
      stripeMock.checkout.sessions.retrieve.mockResolvedValue({ status: "open", payment_intent: { id: "pi_card_open", status: "requires_payment_method" } });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "unpaid", stripe_session_id: "cs_card_open" }],
      };
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
    });

    // B2: late re-delivery of a card-decline event after ACH checkout completed —
    // the session's PaymentIntent is now "pi_ach" (processing), not "pi_card".
    // The event must be acked with no write so the live ACH job is not falsely failed.
    it("acks with no write when the session's PI is processing (stale card-decline event, B2)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_stale_card",
        type: "payment_intent.payment_failed",
        data: {
          object: {
            id: "pi_stale_card",
            receipt_email: "poster@test.com",
            metadata: { job_id: "job-1" },
          },
        },
      });
      // Session is complete, but its PI is "pi_ach_processing" — different from
      // "pi_stale_card". ACH is still in flight.
      stripeMock.checkout.sessions.retrieve.mockResolvedValue({
        status: "complete",
        payment_intent: { id: "pi_ach_processing", status: "processing" },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "unpaid", stripe_session_id: "cs_ach_processing" }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      // No write, no notification — job must stay unpaid with session intact.
      expect(scenario.writes.find((w) => w.table === "jobs")).toBeUndefined();
      expect(scenario.writes.find((w) => w.table === "notifications")).toBeUndefined();
    });

    // N1/N2: same-PI allow-list tests. The deny-list approach missed requires_action
    // (microdeposits / bank-transfer in progress) — both us_bank_account and
    // customer_balance are ON in this account. The fix: allow-list — only
    // requires_payment_method and canceled are genuine failures.
    //
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | piStatus !== "requires_payment_method" && piStatus !== "canceled" | false
    it("N2: acks with no write when SAME PI status is processing (bank debit still settling)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_same_pi_processing",
        type: "payment_intent.payment_failed",
        data: {
          object: {
            id: "pi_same_processing",
            receipt_email: "poster@test.com",
            metadata: { job_id: "job-1" },
          },
        },
      });
      // Same PI, status "processing" — the debit is still in flight.
      stripeMock.checkout.sessions.retrieve.mockResolvedValue({
        status: "complete",
        payment_intent: { id: "pi_same_processing", status: "processing" },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "unpaid", stripe_session_id: "cs_bank" }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(scenario.writes.find((w) => w.table === "jobs")).toBeUndefined();
      expect(scenario.writes.find((w) => w.table === "notifications")).toBeUndefined();
    });

    it("N2: acks with no write when SAME PI status is requires_action (microdeposit verification in progress)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_same_pi_requires_action",
        type: "payment_intent.payment_failed",
        data: {
          object: {
            id: "pi_same_requires_action",
            receipt_email: "poster@test.com",
            metadata: { job_id: "job-1" },
          },
        },
      });
      // Same PI, status "requires_action" — microdeposit or bank-transfer still needs
      // customer action. This must NEVER be treated as a payment failure.
      stripeMock.checkout.sessions.retrieve.mockResolvedValue({
        status: "complete",
        payment_intent: { id: "pi_same_requires_action", status: "requires_action" },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "unpaid", stripe_session_id: "cs_microdeposit" }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(scenario.writes.find((w) => w.table === "jobs")).toBeUndefined();
      expect(scenario.writes.find((w) => w.table === "notifications")).toBeUndefined();
    });

    // Q1: CAS false-branch must NOT include 'failed' — a null-session failed job was
    // already handled by checkoutSessionExpired; including 'failed' would let a late
    // payment_failed retry fire a second "Payment failed" notice.
    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | "payment_status.is.null,payment_status.eq.unpaid" | "payment_status.is.null,payment_status.eq.unpaid,payment_status.eq.failed"
    it("uses a CAS filter without 'failed' when stripe_session_id is null (prevents double-notice)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_fail_null_failed",
        type: "payment_intent.payment_failed",
        data: {
          object: {
            id: "pi_null_failed",
            receipt_email: "poster@test.com",
            metadata: { job_id: "job-1" },
          },
        },
      });
      // null session_id short-circuits checkSessionStatus → closed=true, clearSessionId=false.
      // CAS (false branch): null,unpaid — must NOT include 'failed'.
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "failed", stripe_session_id: null }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      const jobWrite = scenario.writes.find((w) => w.table === "jobs" && w.op === "update");
      // The update runs but its CAS must NOT include 'failed' — in prod, a 'failed'
      // job matches zero rows, so checkoutSessionExpired's prior notice is the only one.
      expect(jobWrite).toBeDefined();
      expect(JSON.stringify(jobWrite?.filters)).not.toMatch(/payment_status\.eq\.failed/);
    });

    it("the session expiring on a still-failed job tells the poster it isn't posted", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_expired_failed",
        type: "checkout.session.expired",
        data: { object: { id: "cs_1", metadata: { job_id: "job-1" } } },
      });
      scenario.writeSelectRows.jobs = [
        { id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "failed" },
      ];
      await fn.fetch(webhookRequest(fn, "{}"));
      const notif = scenario.writes.find((w) => w.table === "notifications");
      expect((notif?.payload as Record<string, unknown>).link).toBe("/post-job");
    });

    it("the session expiring on an abandoned (unpaid) job sends nothing", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_expired_unpaid",
        type: "checkout.session.expired",
        data: { object: { id: "cs_1", metadata: { job_id: "job-1" } } },
      });
      scenario.writeSelectRows.jobs = [
        { id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "unpaid" },
      ];
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(scenario.writes.find((w) => w.table === "notifications")).toBeUndefined();
    });

    // 20 gift_cards rows read payment_status 'pending' after their live
    // gift-purchase checkouts expired (prod, 2026-10-25): the expiry stamped
    // status 'expired' only. It now settles the payment too ('abandoned').
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionExpired.ts | await expireGift({ status: "expired", payment_status: "abandoned" }); | await expireGift({ status: "expired" });
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionExpired.ts |     if (expireErr?.code === "23514") { |     if (false) {
    describe("an expired gift-card PURCHASE checkout", () => {
      const expiredGiftPurchase = () =>
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: "evt_gift_expired",
          type: "checkout.session.expired",
          data: { object: { id: "cs_live_gift_1", metadata: { kind: "gift_card_purchase" } } },
        });
      const giftWrites = () => scenario.writes.filter((w) => w.table === "gift_cards" && w.op === "update");

      it("settles the pre-registered gift: status 'expired' AND payment_status 'abandoned', only while still pending, pinned to its session", async () => {
        const fn = await loadConfigured();
        expiredGiftPurchase();
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        const writes = giftWrites();
        expect(writes).toHaveLength(1);
        expect(writes[0].payload).toEqual({ status: "expired", payment_status: "abandoned" });
        expect(writes[0].filters).toContainEqual(expect.objectContaining({ column: "stripe_session_id", value: "cs_live_gift_1" }));
        expect(writes[0].filters).toContainEqual(expect.objectContaining({ column: "payment_status", value: "pending" }));
      });

      it("before migration 20261025161801 deploys (CHECK refuses 'abandoned'): still marks the gift expired, never 500s", async () => {
        const fn = await loadConfigured();
        expiredGiftPurchase();
        scenario.writeOverrides = [{
          table: "gift_cards", op: "update",
          when: (payload) => payload.payment_status === "abandoned",
          error: { message: 'new row for relation "gift_cards" violates check constraint "gift_cards_payment_status_check"', code: "23514" },
        }];
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        expect(giftWrites().map((w) => w.payload)).toEqual([{ status: "expired", payment_status: "abandoned" }, { status: "expired" }]);
      });
    });

    // @mutate supabase/functions/stripe-webhook/handlers/paymentIntentPaymentFailed.ts | if (pi.metadata?.type === "tip") return; | 
    it("a declined TIP never touches the job or tells the poster their job payment failed", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_tip_fail",
        type: "payment_intent.payment_failed",
        data: {
          object: {
            id: "pi_tip_failed",
            receipt_email: "poster@test.com",
            // auto-tip-charge carries job_id on its PaymentIntent for the receipt.
            metadata: { type: "tip", source: "auto", job_id: "job-1" },
          },
        },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job" }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(scenario.writes.find((w) => w.table === "jobs" && w.op === "update")).toBeUndefined();
      expect(scenario.writes.find((w) => w.table === "notifications")).toBeUndefined();
    });

    it("ME-040: does nothing (no crash, no write) for a PI with no job_id metadata, rather than falling back to a column the decline path never wrote", async () => {
      // Before the fix this branch looked up `jobs.stripe_payment_intent_id`,
      // a column ONLY the success path writes — a declined-at-Checkout PI
      // always misses it, so the handler silently found nothing, notified no
      // one, and never marked the job failed, with no error to surface the
      // gap. The fix resolves via `pi.metadata.job_id` instead, which
      // create-payment sets unconditionally. This case (metadata genuinely
      // absent — e.g. a PI created outside create-payment) should still be a
      // clean no-op, not a crash from reading `.job_id` off `undefined`.
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_fail_no_meta",
        type: "payment_intent.payment_failed",
        data: { object: { id: "pi_failed_no_meta", receipt_email: "poster@test.com" } },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job" }],
      };
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      expect(scenario.writes.find((w) => w.table === "jobs" && w.op === "update")).toBeUndefined();
      expect(scenario.writes.find((w) => w.table === "notifications")).toBeUndefined();
    });
  });

  describe("charge.refunded", () => {
    it("flips the job to refunded and notifies the poster on a FULL refund", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_refund",
        type: "charge.refunded",
        data: {
          object: {
            id: "ch_1",
            payment_intent: "pi_refunded",
            amount: 5000,
            amount_refunded: 5000,
          },
        },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "escrow" }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      const jobWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect((jobWrite?.payload as Record<string, unknown>).payment_status).toBe(
        "refunded",
      );
    });

    // A hold captured without its $2 setup fee: charge.amount stays the authorized $42
    // (Stripe: amount_captured "can be less than the amount attribute"), so refunding the
    // whole $40 is a FULL refund, and the job must say refunded.
    // @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |   return captured > 0 ? captured : charge.amount; |   return charge.amount;
    it("a full refund of a partly captured hold reads full, and a partial one stays partial", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_refund_partial_capture",
        type: "charge.refunded",
        data: { object: { id: "ch_1", payment_intent: "pi_refunded", amount: 4200, amount_captured: 4000, amount_refunded: 4000 } },
      });
      scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "escrow" }] };
      await fn.fetch(webhookRequest(fn, "{}"));
      const flips = () => scenario.writes.filter((w) => w.table === "jobs" && w.op === "update" && (w.payload as Record<string, unknown>).payment_status === "refunded");
      expect(flips()).toHaveLength(1);

      scenario.writes.length = 0;
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_refund_partial_capture_2",
        type: "charge.refunded",
        data: { object: { id: "ch_1", payment_intent: "pi_refunded", amount: 4200, amount_captured: 4000, amount_refunded: 3000 } },
      });
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(flips()).toHaveLength(0);
    });

    // Q1355 (2): the event's charge.amount_refunded is a snapshot. A
    // redelivery after the refund FAILED still read "full" and closed the job.
    // @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |   const isFullRefund = liveRefundedCents >= capturedCentsOf(charge); |   const isFullRefund = charge.amount_refunded >= capturedCentsOf(charge);
    it("a redelivered 'full' refund whose refund has since FAILED does not close the job (Q1355 (2))", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_refund_stale",
        type: "charge.refunded",
        data: { object: { id: "ch_1", payment_intent: "pi_refunded", amount: 5000, amount_refunded: 5000 } },
      });
      stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_failed", amount: 5000, status: "failed", metadata: {} }] });
      scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", payment_status: "escrow" }] };
      await fn.fetch(webhookRequest(fn, "{}"));
      const refundedFlip = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update" && (w.payload as Record<string, unknown>).payment_status === "refunded",
      );
      expect(refundedFlip).toBeUndefined();
    });

    // Q1655 / Q1782 (2): a refunded recurring visit's Stripe Tax transaction
    // (stamped on its PaymentIntent by charge-recurring-visits; ONE labor line,
    // tax exclusive) is reversed once per refund, keyed on the refund id, by
    // the share of the labor + tax that refund returned (owner pop-up
    // 2026-10-15: tax stays paid on fees we keep). The visit below: $100
    // labor + $10 tax + $3.50 card fee = $113.50 charged; $110 is taxed.
    describe("recurring-visit sales tax reversal per refund (Q1655, Q1782 (2))", () => {
      // @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |     await reverseVisitTaxForRefund({ stripe, piId: refundPiId, charge, refunds: ordinaryRefunds, listedAnyRefund: allRefunds.length > 0, supabase, logStep }); |     void reverseVisitTaxForRefund;
      const visitRefund = (id: string) => ({
        id,
        type: "charge.refunded",
        data: { object: { id: "ch_visit", payment_intent: "pi_visit", amount: 11350, amount_refunded: 0 } },
      });
      const refundsAre = (rows: Array<{ id: string; amount: number; created: number; status?: string; metadata?: Record<string, string> }>) =>
        // Stripe lists newest first.
        stripeMock.refunds.list.mockResolvedValue({
          data: [...rows].sort((a, b) => b.created - a.created).map((r) => ({ status: "succeeded", metadata: {}, ...r })),
          has_more: false,
        });
      const piMeta = (extra: Record<string, string> = {}) =>
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_visit", metadata: { tax_transaction_id: "tax_txn_9", ...extra } });
      const reversals = () => stripeMock.tax.transactions.createReversal.mock.calls.map((c) => ({ args: c[0], opts: c[1] }));
      const run = async (evtId: string) => {
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue(visitRefund(evtId));
        return fn.fetch(webhookRequest(fn, "{}"));
      };
      beforeEach(() => {
        stripeMock.tax.transactions.listLineItems.mockResolvedValue({
          data: [{ id: "tax_li_1", amount: 10000, amount_tax: 1000, reference: "labor" }],
          has_more: false,
        });
        stripeMock.tax.transactions.createReversal.mockImplementation(async (args: { reference: string }) => ({ id: `taxrev_${args.reference}` }));
        stripeMock.paymentIntents.update.mockResolvedValue({ id: "pi_visit" });
        scenario.reads.jobs = { rows: [{ id: "job-v", customer_id: "poster-1", title: "Visit", payment_status: "escrow" }] };
      });

      // Review of 2ecaceaf84 (Q2716 left part): a fee capture whose released tax was already reversed is never
      // shared again by the whole transaction; a refund not yet reversed pages for a hand reversal of the kept tax.
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |   if (piMeta.tax_rev_uncaptured) { |   if (false) {
      it("a refund of a partly taxed fee capture whose released tax was reversed reverses nothing and pages", async () => {
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_visit", metadata: { tax_transaction_id: "tax_txn_9", tax_calculation_id: "taxcalc_g", job_tax_cents: "1000", cancel_fee_capture: "1", cancel_fee_tax_kept_cents: "400", tax_rev_uncaptured: "taxrev_unc" } });
        refundsAre([{ id: "re_fee", amount: 2000, created: 100 }]);
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id: "evt_tax_unc", type: "charge.refunded", data: { object: { id: "ch_visit", payment_intent: "pi_visit", amount: 9400, amount_refunded: 2000 } } });
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(reversals()).toEqual([]);
        const alerts = (slackAlerts as Array<{ title: string; kind: string }>).filter((a) => a.title === "Refund of a partly taxed fee capture: reverse its sales tax by hand");
        expect(alerts).toHaveLength(1);
        expect(alerts[0].kind).toBe("money_at_risk");
      });

      // Q1912 (Stripe TEST runs 41870316864 + 41871055112): a mode-full reversal can never be undone and blocks any later
      // reversal, so a whole refund is a PARTIAL flat reversal of the whole transaction total.
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts | { mode: "partial", flat_amount: -(full ? txTotalCents : shareCents), | { mode: full ? "full" : "partial", flat_amount: -(full ? txTotalCents : shareCents),
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts | flat_amount: -(full ? txTotalCents : shareCents), | flat_amount: -(full ? 0 : shareCents),
      it("a refund of the whole labor + tax (the card fee kept) is ONE partial reversal of the whole total, keyed on the refund, recorded on the payment", async () => {
        piMeta();
        refundsAre([{ id: "re_full", amount: 11000, created: 100 }]);
        await run("evt_tax_full");
        expect(reversals()).toEqual([{
          args: { mode: "partial", flat_amount: -11000, original_transaction: "tax_txn_9", reference: "refund:re_full", metadata: { refund_id: "re_full", charge_id: "ch_visit" } },
          opts: { idempotencyKey: "visit-tax-reversal:re_full" },
        }]);
        expect(stripeMock.paymentIntents.update).toHaveBeenCalledWith("pi_visit", { metadata: { tax_rev_re_full: "taxrev_refund:re_full" } });
      });

      // Review fix (lh-money-escrow on ddfb06a83 #2): a $100 job paid $90 by gift: the card took the $10
      // shortfall + $10 job-site tax ($20), the transaction holds $100 labor + $10 tax. Refunding the whole
      // card charge on a cancel (the gift goes back too) reverses ALL of it, not $20 of $110.
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |   const giftReduced = jobSiteTaxCents(piMeta) > 0 && | const giftReduced = false &&
      it("a gift-reduced job-site charge refunded in full reverses the whole transaction (tax share, not card share)", async () => {
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_visit", metadata: { tax_transaction_id: "tax_txn_9", tax_calculation_id: "taxcalc_g", job_tax_cents: "1000" } });
        refundsAre([{ id: "re_gift", amount: 2000, created: 100 }]);
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id: "evt_tax_gift", type: "charge.refunded", data: { object: { id: "ch_visit", payment_intent: "pi_visit", amount: 2000, amount_refunded: 0 } } });
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(reversals().map((r) => r.args)).toEqual([{ mode: "partial", flat_amount: -11000, original_transaction: "tax_txn_9", reference: "refund:re_gift", metadata: { refund_id: "re_gift", charge_id: "ch_visit" } }]);
      });

      // Q2717: a $100 job paid $90 by gift; the card took the $10 shortfall + the $10 job-site tax ($20); the
      // transaction holds $110. A cancel keeps $3.50 of fees from the card and the 35c tax on them, so it refunds
      // $16.15 of which $9.65 is tax, stamped on the refund. The reversal is exact: 965 x 11000 / 1000 = $106.15,
      // leaving $3.85 reported ($3.50 kept + its 35c tax). The proportional share (1615 x 11000 / 2000 = $88.83)
      // left $21.17 reported. An unstamped refund keeps the proportional share.
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |         amount: back !== null && siteTax > 0 |         amount: false
      it("Q2717: a gift-reduced cancel refund that stamped its tax-back reverses exactly tax-back x (taxable + tax) / tax", async () => {
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_visit", metadata: { tax_transaction_id: "tax_txn_9", tax_calculation_id: "taxcalc_g", job_tax_cents: "1000", job_taxable_cents: "10000" } });
        refundsAre([{ id: "re_cancel", amount: 1615, created: 100, metadata: { job_tax_back_cents: "965" } }]);
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id: "evt_tax_exact", type: "charge.refunded", data: { object: { id: "ch_visit", payment_intent: "pi_visit", amount: 2000, amount_refunded: 0 } } });
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(reversals().map((r) => r.args)).toEqual([{ mode: "partial", flat_amount: -10615, original_transaction: "tax_txn_9", reference: "refund:re_cancel", metadata: { refund_id: "re_cancel", charge_id: "ch_visit" } }]);
      });

      // Q2717 review (lh-money-escrow on fa77e8fed2): taxable $600 + $30 tax, card $330, gift $300. The stamped cancel
      // (kept $150, tax-back $22.50) reverses $472.50; a LATER unstamped $52.50 crew-share refund must reverse only its
      // own $52.50, not 5250 x 63000 / 33000 = $100.23, so the reported $105.00 still covers the $100 kept + $5 tax.
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |           : anyStamped\n          ? Math.round(amount)\n | : false\n          ? Math.round(amount)\n
      it("Q2717 review: an unstamped refund after a stamped cancel reverses its own amount, never the kept tax", async () => {
        stripeMock.tax.transactions.listLineItems.mockResolvedValue({ data: [{ id: "tax_li_1", amount: 60000, amount_tax: 3000, reference: "labor" }], has_more: false });
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_visit", metadata: { tax_transaction_id: "tax_txn_9", tax_calculation_id: "taxcalc_g", job_tax_cents: "3000", job_taxable_cents: "60000" } });
        refundsAre([
          { id: "re_cancel", amount: 17250, created: 100, metadata: { job_tax_back_cents: "2250" } },
          { id: "re_share", amount: 5250, created: 200 },
        ]);
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id: "evt_tax_after_stamp", type: "charge.refunded", data: { object: { id: "ch_visit", payment_intent: "pi_visit", amount: 33000, amount_refunded: 0 } } });
        await fn.fetch(webhookRequest(fn, "{}"));
        const flats = reversals().map((r) => -Number((r.args as { flat_amount?: number }).flat_amount));
        expect(flats).toEqual([47250, 5250]);
        // What stays reported covers the $100 still kept plus its $5 tax.
        expect(63000 - flats.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(10000 + 500);
      });

      it("Q2717 control: the same refund with no stamp keeps the proportional share", async () => {
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_visit", metadata: { tax_transaction_id: "tax_txn_9", tax_calculation_id: "taxcalc_g", job_tax_cents: "1000", job_taxable_cents: "10000" } });
        refundsAre([{ id: "re_admin", amount: 1615, created: 100 }]);
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id: "evt_tax_prop", type: "charge.refunded", data: { object: { id: "ch_visit", payment_intent: "pi_visit", amount: 2000, amount_refunded: 0 } } });
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(reversals().map((r) => r.args)).toEqual([{ mode: "partial", flat_amount: -8883, original_transaction: "tax_txn_9", reference: "refund:re_admin", metadata: { refund_id: "re_admin", charge_id: "ch_visit" } }]);
      });

      // aa8869511 #3: a TAX-ONLY card charge ($10, the gift paid the whole job): half of it refunded
      // reverses half the tax AND the labor it was charged on ($55 of $110), not $5.
      it("a tax-only charge's partial refund reverses its tax share and that tax's labor", async () => {
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_visit", metadata: { tax_transaction_id: "tax_txn_9", tax_calculation_id: "taxcalc_g", job_tax_cents: "1000" } });
        refundsAre([{ id: "re_half", amount: 500, created: 100 }]);
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id: "evt_tax_only", type: "charge.refunded", data: { object: { id: "ch_visit", payment_intent: "pi_visit", amount: 1000, amount_refunded: 0 } } });
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(reversals().map((r) => r.args)).toEqual([{ mode: "partial", flat_amount: -5500, original_transaction: "tax_txn_9", reference: "refund:re_half", metadata: { refund_id: "re_half", charge_id: "ch_visit" } }]);
      });

      // Q1997: a refund that returned money on a transaction listing no lines
      // (or only zero amounts) reverses nothing, so a person is paged.
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |   if (!(txTotalCents > 0)) { |   if (false) {
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts | logStep("Recurring-visit tax transaction records nothing to reverse; paged", { txId, chargeId: charge.id }); | logStep("Recurring-visit tax transaction records nothing to reverse; paged", { txId, chargeId: charge.id }); return "none";
      for (const [label, lines] of [["no lines", []], ["only zero amounts", [{ id: "tax_li_0", amount: 0, amount_tax: 0, reference: "labor" }]]] as const) {
        it(`a refund on a tax transaction with ${label} pages once and reverses nothing (Q1997)`, async () => {
          stripeMock.tax.transactions.listLineItems.mockResolvedValue({ data: lines, has_more: false });
          piMeta();
          refundsAre([{ id: "re_empty", amount: 11000, created: 100 }]);
          const res = await run(`evt_tax_empty_${label.length}`);
          expect(res.status).toBe(200);
          expect(reversals()).toEqual([]);
          const pages = (slackAlerts as Array<{ kind?: string; title?: string; fields?: Record<string, unknown> }>).filter((a) => /lists nothing to reverse/.test(a.title ?? ""));
          expect(pages).toHaveLength(1);
          expect(pages[0].kind).toBe("money_at_risk");
          expect(pages[0].fields).toMatchObject({ "Tax transaction": "tax_txn_9", Charge: "ch_visit", "Payment Intent": "pi_visit" });
        });
      }

      // Q1997 (lead): test data never pages the owner. The page carries seed:
      // the visit's series job is_seed, or its payer/Helpr is a test subject;
      // a visit row that cannot be read pages as real.
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |       oncePerDayKey: `visit-tax-empty:${charge.id}`,\n      seed: await visitIsSeed(supabase, piId, logStep), |       oncePerDayKey: `visit-tax-empty:${charge.id}`,\n      seed: false,
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |   return job?.is_seed === true \|\| await anyIsTestSubject(supabase, [visit.payer_id, visit.helper_id], logStep); |   return job?.is_seed === true;
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |   if (error \|\| !visit) { |   if (error) {
      for (const [label, setup, seed] of [
        ["a seed series job", () => { scenario.reads.jobs = { rows: [{ id: "job-v", is_seed: true }] }; }, true],
        ["a test-account payer", () => { scenario.reads.jobs = { rows: [{ id: "job-v", is_seed: false }] }; scenario.rpc.is_test_subject = true; }, true],
        ["a real visit", () => { scenario.reads.jobs = { rows: [{ id: "job-v", is_seed: false }] }; scenario.rpc.is_test_subject = false; }, false],
      ] as const) {
        it(`the empty-transaction page is seed=${seed} for ${label} (Q1997)`, async () => {
          stripeMock.tax.transactions.listLineItems.mockResolvedValue({ data: [], has_more: false });
          piMeta();
          refundsAre([{ id: "re_empty", amount: 11000, created: 100 }]);
          scenario.reads.recurring_visit_payments = { rows: [{ parent_job_id: "job-v", payer_id: "poster-1", helper_id: "helpr-1" }] };
          setup();
          await run(`evt_tax_empty_seed_${label.length}`);
          const pages = (slackAlerts as Array<{ title?: string; seed?: boolean }>).filter((a) => /lists nothing to reverse/.test(a.title ?? ""));
          expect(pages).toHaveLength(1);
          expect(pages[0].seed).toBe(seed);
        });
      }

      it("the empty-transaction page counts as real when the visit row is missing (Q1997)", async () => {
        stripeMock.tax.transactions.listLineItems.mockResolvedValue({ data: [], has_more: false });
        piMeta();
        refundsAre([{ id: "re_empty", amount: 11000, created: 100 }]);
        scenario.reads.recurring_visit_payments = { rows: [] };
        scenario.reads.jobs = { rows: [{ id: "job-v", is_seed: true }] };
        await run("evt_tax_empty_novisit");
        const pages = (slackAlerts as Array<{ title?: string; seed?: boolean }>).filter((a) => /lists nothing to reverse/.test(a.title ?? ""));
        expect(pages).toHaveLength(1);
        expect(pages[0].seed).toBe(false);
      });

      // Q1828: an inclusive line's amount already holds its tax.
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts | (li.tax_behavior === "inclusive" ? 0 : Math.abs(Number(li.amount_tax ?? 0))) | Math.abs(Number(li.amount_tax ?? 0))
      it("a tax-INCLUSIVE line is not double-counted: a refund of its whole amount is still ONE reversal of the whole total (Q1828)", async () => {
        stripeMock.tax.transactions.listLineItems.mockResolvedValue({
          data: [{ id: "tax_li_1", amount: 11000, amount_tax: 1000, tax_behavior: "inclusive", reference: "labor" }],
          has_more: false,
        });
        piMeta();
        refundsAre([{ id: "re_incl", amount: 11000, created: 100 }]);
        await run("evt_tax_inclusive");
        expect(reversals().map((r) => [r.args.reference, r.args.mode, r.args.flat_amount])).toEqual([["refund:re_incl", "partial", -11000]]);
      });

      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |     if (piMeta[metaKey]) { |     if (false) {
      it("a redelivery (retry) of the same refund reverses nothing again", async () => {
        piMeta({ tax_rev_re_full: "taxrev_1" });
        refundsAre([{ id: "re_full", amount: 11000, created: 100 }]);
        await run("evt_tax_retry");
        expect(stripeMock.tax.transactions.createReversal).not.toHaveBeenCalled();
      });

      it("a redelivery before the reversal was recorded reuses the refund's idempotency key, so Stripe hands back the same reversal", async () => {
        piMeta();
        refundsAre([{ id: "re_p", amount: 3000, created: 100 }]);
        await run("evt_tax_a");
        await run("evt_tax_b");
        const keys = reversals().map((r) => r.opts.idempotencyKey);
        expect(keys).toEqual(["visit-tax-reversal:re_p", "visit-tax-reversal:re_p"]);
      });

      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |     const shareCents = Math.min(amount, Math.max(0, total - before)); |     const shareCents = amount;
      it("a second partial refund gets a second reversal of its own; the first is not reversed again", async () => {
        piMeta({ tax_rev_re_1: "taxrev_1" });
        refundsAre([{ id: "re_1", amount: 3000, created: 100 }, { id: "re_2", amount: 2000, created: 200 }]);
        await run("evt_tax_second");
        expect(reversals()).toEqual([{
          args: { mode: "partial", flat_amount: -2000, original_transaction: "tax_txn_9", reference: "refund:re_2", metadata: { refund_id: "re_2", charge_id: "ch_visit" } },
          opts: { idempotencyKey: "visit-tax-reversal:re_2" },
        }]);
      });

      it("the cumulative reversal is capped at what the transaction collected", async () => {
        piMeta({ tax_rev_re_1: "taxrev_1" });
        // An own-mistake full refund returns the card fee too: $80 then $33.50.
        refundsAre([{ id: "re_1", amount: 8000, created: 100 }, { id: "re_2", amount: 3350, created: 200 }]);
        await run("evt_tax_cap");
        expect(reversals().map((r) => [r.args.reference, r.args.mode, r.args.flat_amount])).toEqual([["refund:re_2", "partial", -3000]]);
        // A later refund with nothing left to reverse reverses nothing.
        stripeMock.tax.transactions.createReversal.mockClear();
        piMeta({ tax_rev_re_1: "taxrev_1", tax_rev_re_2: "taxrev_2" });
        refundsAre([{ id: "re_1", amount: 8000, created: 100 }, { id: "re_2", amount: 3350, created: 200 }, { id: "re_3", amount: 500, created: 300 }]);
        await run("evt_tax_cap2");
        expect(stripeMock.tax.transactions.createReversal).not.toHaveBeenCalled();
      });

      it("a late-cancel fee kept for the Helpr keeps its share collected: only the returned $85 is reversed, partially", async () => {
        piMeta();
        // $113.50 - $3.50 card fee - $25 late-cancel fee paid to the Helpr.
        refundsAre([{ id: "re_late", amount: 8500, created: 100 }]);
        await run("evt_tax_kept");
        expect(reversals().map((r) => [r.args.mode, r.args.flat_amount])).toEqual([["partial", -8500]]);
        // Q1828's guard: a fee-withheld (partial) visit refund reverses its tax
        // share itself, so ops gets no "reverse it by hand" page.
        expect((slackAlerts as Array<{ title: string }>).some((a) => /tax/i.test(a.title))).toBe(false);
      });

      it("a refund that failed before this event is not reversed; one re-issued after it is", async () => {
        piMeta();
        refundsAre([{ id: "re_failed", amount: 11000, created: 100, status: "failed" }, { id: "re_again", amount: 11000, created: 200 }]);
        await run("evt_tax_reissue");
        expect(reversals().map((r) => [r.args.reference, r.args.mode])).toEqual([["refund:re_again", "partial"]]);
      });

      it("a reversal Stripe refuses is paged with the amount to reverse by hand", async () => {
        piMeta();
        refundsAre([{ id: "re_x", amount: 3000, created: 100 }]);
        stripeMock.tax.transactions.createReversal.mockRejectedValue(new Error("boom"));
        const res = await run("evt_tax_err");
        expect(res.status).toBe(200);
        const page = (slackAlerts as Array<{ title: string; message: string }>).find((a) => /sales tax NOT reversed/.test(a.title));
        expect(page?.message).toContain("re_x");
        expect(page?.message).toContain("reverse $30 by hand");
        // A hand reversal must be recorded, or the next refund event reverses it again.
        expect(page?.message).toContain("metadata.tax_rev_re_x=");
        expect(page?.message).toContain("reference refund:re_x");
      });

      // Reviews of 994f077b2: a stale delivery whose only refund has since
      // FAILED returned no money, so nobody is told to reverse tax by hand.
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |     if (listedAnyRefund) { |     if (false) {
      it("a delivery whose every refund has since failed reverses nothing and pages nothing", async () => {
        piMeta();
        refundsAre([{ id: "re_gone", amount: 11000, created: 100, status: "failed" }]);
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: "evt_tax_allfailed",
          type: "charge.refunded",
          data: { object: { id: "ch_visit", payment_intent: "pi_visit", amount: 11350, amount_refunded: 11000 } },
        });
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(stripeMock.tax.transactions.createReversal).not.toHaveBeenCalled();
        expect((slackAlerts as Array<{ title: string }>).some((a) => /tax/i.test(a.title))).toBe(false);
      });

      // Reviews of 994f077b2: only an invalid-request refusal about the
      // reference reads as "already reversed"; any other error is paged.
      // Q1912: the refusals are Stripe's own, captured in Stripe TEST mode
      // (Actions runs 41870316864 and 41871055112, 2026-11-04): type, param,
      // code, status and message copied from those run logs, ids included.
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |   return invalidRequest && aboutReference && | return aboutReference &&
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |   return invalidRequest && aboutReference && /(already\|exists\|unique\|duplicate)/i.test(msg); |   return invalidRequest;
      const stripeRefusal = (message: string, fields: Record<string, unknown>) => Object.assign(new Error(message), fields);
      it("Stripe's real reused-reference refusal reads as done; a connection error with the same words is paged", async () => {
        piMeta();
        refundsAre([{ id: "re_dup", amount: 3000, created: 100 }]);
        stripeMock.tax.transactions.createReversal.mockRejectedValue(
          stripeRefusal(
            "You have already created a tax transaction tax_1UY7KYKp2H4b7tECrLw9WInY with the reference 'refund:re_b120mw2cmr3pa'. `reference` must be unique across all tax transactions.",
            { type: "StripeInvalidRequestError", rawType: "invalid_request_error", param: "reference", statusCode: 400 },
          ),
        );
        await run("evt_tax_dup");
        const notReversed = () => (slackAlerts as Array<{ title: string }>).filter((a) => /NOT reversed/.test(a.title));
        expect(notReversed()).toHaveLength(0);
        stripeMock.tax.transactions.createReversal.mockRejectedValue(
          stripeRefusal("reference request already in flight", { type: "StripeConnectionError" }),
        );
        await run("evt_tax_dup2");
        expect(notReversed()).toHaveLength(1);
      });

      it.each([
        [
          "an over-reversal (more than is left unreversed)",
          stripeRefusal("The refund amount ('100') is greater than the remaining unrefunded amount ('0') on the Transaction", { type: "StripeInvalidRequestError", rawType: "invalid_request_error", param: "flat_amount", statusCode: 400 }),
        ],
        [
          "a fully reversed original",
          stripeRefusal("You can't reverse transaction 'tax_1UY7KYKp2H4b7tEC0fSw5vXq' because it has been fully reversed.", { type: "StripeInvalidRequestError", rawType: "invalid_request_error", param: "original_transaction", statusCode: 400 }),
        ],
        [
          "an undo of a full reversal",
          stripeRefusal("You cannot reverse the transaction 'tax_1UY7KYKp2H4b7tECrLw9WInY' because it's a full reversal of an earlier transaction.", { type: "StripeInvalidRequestError", rawType: "invalid_request_error", param: "original_transaction", statusCode: 400 }),
        ],
        [
          "a reused idempotency key with other parameters",
          stripeRefusal("Keys for idempotent requests can only be used with the same parameters they were first used with. Try using a key other than 'visit-tax-reversal:re_b120mw2cmr3pa' if you meant to execute a different request.", { type: "StripeIdempotencyError", rawType: "idempotency_error", statusCode: 400 }),
        ],
        [
          "a key still in use by a racing delivery",
          stripeRefusal("There is currently another in-progress request using this Idempotent Key (that probably means you submitted twice, and the other request is still going through): visit-tax-reversal:re_b120mw2cweced. Please try again later.", { type: "StripeInvalidRequestError", rawType: "invalid_request_error", code: "idempotency_key_in_use", statusCode: 409 }),
        ],
      ])("Stripe's real refusal for %s is paged, never read as already reversed (Q1912)", async (_label, refusal) => {
        piMeta();
        refundsAre([{ id: "re_dup", amount: 3000, created: 100 }]);
        stripeMock.tax.transactions.createReversal.mockRejectedValue(refusal);
        await run("evt_tax_refused");
        const page = (slackAlerts as Array<{ title: string; message: string }>).filter((a) => /NOT reversed/.test(a.title));
        expect(page).toHaveLength(1);
        expect(page[0].message).toContain((refusal as Error).message);
      });

      it("control: an ordinary job's PaymentIntent carries no tax transaction, so nothing is reversed", async () => {
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_visit", metadata: {} });
        refundsAre([{ id: "re_plain", amount: 11000, created: 100 }]);
        await run("evt_tax_none");
        expect(stripeMock.tax.transactions.createReversal).not.toHaveBeenCalled();
      });
    });

    // Q1724: a LOST chargeback on a taxed recurring visit returns the money
    // with no charge.refunded event, so charge.dispute.closed reverses the tax.
    // @mutate supabase/functions/stripe-webhook/handlers/chargeDisputeClosed.ts |     await reverseVisitTaxForLostDispute({ stripe, piId: closedPiId, dispute: closedDispute, logStep }); |     void reverseVisitTaxForLostDispute;
    // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |   if (!(chargedCents > 0) \|\| refundedCents > 0 \|\| disputedCents < chargedCents) { |   if (!(chargedCents > 0) \|\| refundedCents > 0) {
    it("reverses a taxed visit's Stripe Tax transaction when its chargeback is LOST, in full only for a whole-charge dispute (Q1724)", async () => {
      const lostEvent = (id: string, amount: number, status = "lost") => ({
        id,
        type: "charge.dispute.closed",
        data: { object: { id: `dp_${id}`, status, amount, payment_intent: "pi_visit", charge: "ch_visit" } },
      });
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_visit", amount_received: 5000, metadata: { tax_transaction_id: "tax_txn_9" } });
      stripeMock.charges.retrieve.mockResolvedValue({ id: "ch_visit", amount: 5000, amount_refunded: 0 });
      stripeMock.tax.transactions.createReversal.mockResolvedValue({ id: "tax_txn_rev" });
      scenario.reads.jobs = { rows: [] };

      let fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue(lostEvent("evt_lost_full", 5000));
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(stripeMock.tax.transactions.createReversal).toHaveBeenCalledTimes(1);
      const [args, opts] = stripeMock.tax.transactions.createReversal.mock.calls[0];
      expect(args).toEqual({ mode: "full", original_transaction: "tax_txn_9", reference: "dispute:dp_evt_lost_full" });
      expect(opts).toEqual({ idempotencyKey: "visit-tax-reversal-dispute:dp_evt_lost_full" });

      // A dispute of part of the charge is paged for a hand reversal.
      stripeMock.tax.transactions.createReversal.mockClear();
      fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue(lostEvent("evt_lost_part", 2000));
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(stripeMock.tax.transactions.createReversal).not.toHaveBeenCalled();
      expect((slackAlerts as Array<{ title?: string }>).some((a) => /Lost chargeback on a taxed recurring visit/.test(a.title ?? ""))).toBe(true);

      // A WON dispute keeps the money: nothing is reversed.
      fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue(lostEvent("evt_won_full", 5000, "won"));
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(stripeMock.tax.transactions.createReversal).not.toHaveBeenCalled();

      // Refunded BEFORE the dispute (review of 5f292defa #2): fully refunded =
      // the refund path already reversed it; partly = a full reversal would
      // reverse that share twice, so it is paged instead.
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |   if (!(chargedCents > 0) \|\| refundedCents > 0 \|\| disputedCents < chargedCents) { |   if (!(chargedCents > 0) \|\| disputedCents < chargedCents) {
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |   if (chargedCents > 0 && refundedCents >= chargedCents) { |   if (false) {
      for (const refunded of [5000, 1000]) {
        (slackAlerts as unknown[]).length = 0;
        stripeMock.charges.retrieve.mockResolvedValue({ id: "ch_visit", amount: 5000, amount_refunded: refunded });
        fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue(lostEvent(`evt_lost_after_${refunded}`, 5000));
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(stripeMock.tax.transactions.createReversal).not.toHaveBeenCalled();
        const paged = (slackAlerts as Array<{ title?: string }>).some((a) => /Lost chargeback on a taxed recurring visit/.test(a.title ?? ""));
        expect(paged, `refunded ${refunded} before the dispute`).toBe(refunded < 5000);
      }

      // Q1918 (reviewer follow-up 11-04): a reversal already recorded on the PaymentIntent (an uncaptured rest, or a
      // refund's reversal since undone, so nothing is refunded now) is paged up front, never a mode-full reversal.
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |   if (priorReversalKeys.length > 0) { |   if (false) {
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts | k.startsWith("tax_rev_") | k.startsWith("tax_rev_re_")
      stripeMock.charges.retrieve.mockResolvedValue({ id: "ch_visit", amount: 5000, amount_refunded: 0 });
      for (const key of ["tax_rev_uncaptured", "tax_rev_re_undone"]) {
        (slackAlerts as unknown[]).length = 0;
        stripeMock.paymentIntents.retrieve.mockResolvedValue({
          id: "pi_visit", amount_received: 5000, metadata: { tax_transaction_id: "tax_txn_9", [key]: "tax_txn_prior" },
        });
        fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue(lostEvent(`evt_lost_prior_${key}`, 5000));
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(stripeMock.tax.transactions.createReversal, key).not.toHaveBeenCalled();
        const page = (slackAlerts as Array<{ title?: string; message?: string }>).find((a) => /Lost chargeback on a taxed recurring visit/.test(a.title ?? ""));
        expect(page?.message, key).toMatch(new RegExp(`already has a reversal recorded.*${key}`));
      }
    });

    it("a lost chargeback whose PaymentIntent cannot be found is paged for the tax check, never dropped (Q1724)", async () => {
      // The caller ignores the return value, so the mutation drops the page
      // itself (the pre-Q1724 behaviour), which is what this test observes.
      // @mutate supabase/functions/stripe-webhook/handlers/_visitTaxReversal.ts |   if (!piId) {\n    // The handler could not find |   if (!piId) return "none";\n  if (false) {\n    // The handler could not find
      stripeMock.charges.retrieve.mockRejectedValue(new Error("stripe down"));
      scenario.reads.jobs = { rows: [] };
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_lost_nopi", type: "charge.dispute.closed",
        data: { object: { id: "dp_nopi", status: "lost", amount: 5000, payment_intent: null, charge: "ch_x" } },
      });
      await fn.fetch(webhookRequest(fn, "{}"));
      const page = (slackAlerts as Array<{ title?: string; message?: string }>).find((a) => /Lost chargeback: could not check/.test(a.title ?? ""));
      expect(page?.message).toMatch(/dp_nopi was lost, but its PaymentIntent could not be found/);
    });

    it("leaves the job status unchanged on a PARTIAL refund (funds still in escrow)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_refund_partial",
        type: "charge.refunded",
        data: {
          object: {
            id: "ch_2",
            payment_intent: "pi_partial",
            amount: 5000,
            amount_refunded: 300,
          },
        },
      });
      scenario.reads.jobs = {
        rows: [{ id: "job-1", customer_id: "poster-1", title: "Job" }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      const jobWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      expect(jobWrite).toBeUndefined();
    });
  });

  describe("charge.dispute.closed restores the pre-dispute payment state", () => {
    // charge.dispute.created blocks only a PAYABLE job (escrow or
    // payout_pending) by flipping it to 'chargeback'. A dismissed inquiry used
    // to write payout_pending back unconditionally, so a job whose work was not
    // done yet (escrow) landed in a state no sweep reads: auto-release-payment
    // only takes escrow, process-scheduled-payouts only takes completed jobs
    // with a payout_scheduled_at. Stranded.
    function closedEvent(id: string, status: string) {
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id,
        type: "charge.dispute.closed",
        data: {
          object: { id: `dp_${id}`, status, amount: 5000, payment_intent: "pi_disputed", charge: "ch_d" },
        },
      });
    }
    function unblockWrite() {
      return scenario.writes.find(
        (w) =>
          w.table === "jobs" &&
          w.op === "update" &&
          "payment_status" in (w.payload as Record<string, unknown>),
      );
    }

    it("dismissed on an in_progress job (work not done) returns it to escrow", async () => {
      const fn = await loadConfigured();
      closedEvent("evt_wc_escrow", "warning_closed");
      scenario.reads.jobs = {
        rows: [{
          id: "job-ip", customer_id: "p", helper_id: "h", title: "Job",
          dispute_status: "stripe_chargeback", disputed_at: "2026-09-12T00:00:00.000Z",
          payment_status: "chargeback", status: "in_progress", payout_scheduled_at: null,
        }],
      };
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      const w = unblockWrite();
      expect((w?.payload as Record<string, unknown>).payment_status).toBe("escrow");
      expect((w?.payload as Record<string, unknown>).disputed_at).toBeNull();
      // Still a compare-and-set on the block, and the row count is observable.
      expect(w?.filters).toContainEqual({ op: "eq", column: "payment_status", value: "chargeback" });
      expect(w?.selectCols).toBe("id");
    });

    it("dismissed on a completed job with its payout scheduled returns it to payout_pending", async () => {
      const fn = await loadConfigured();
      closedEvent("evt_wc_pp", "warning_closed");
      scenario.reads.jobs = {
        rows: [{
          id: "job-done", customer_id: "p", helper_id: "h", title: "Job",
          dispute_status: "stripe_chargeback", disputed_at: "2026-09-12T00:00:00.000Z",
          payment_status: "chargeback", status: "completed",
          payout_scheduled_at: "2026-09-13T00:00:00.000Z",
        }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      expect((unblockWrite()?.payload as Record<string, unknown>).payment_status).toBe("payout_pending");
    });

    it("a completed job with no payout schedule (hand-released, transfer re-queued) still returns to payout_pending", async () => {
      const fn = await loadConfigured();
      closedEvent("evt_wc_pp_nosched", "warning_closed");
      scenario.reads.jobs = {
        rows: [{
          id: "job-requeued", customer_id: "p", helper_id: "h", title: "Job",
          dispute_status: "stripe_chargeback", disputed_at: "2026-09-12T00:00:00.000Z",
          payment_status: "chargeback", status: "completed", payout_scheduled_at: null,
        }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      expect((unblockWrite()?.payload as Record<string, unknown>).payment_status).toBe("payout_pending");
    });

    it("the admin notice names the restored state (escrow is not a payout unblock)", async () => {
      const fn = await loadConfigured();
      closedEvent("evt_wc_notice", "warning_closed");
      scenario.reads.jobs = {
        rows: [{
          id: "job-notice", customer_id: "p", helper_id: "h", title: "Job",
          dispute_status: "stripe_chargeback", disputed_at: "2026-09-12T00:00:00.000Z",
          payment_status: "chargeback", status: "accepted", payout_scheduled_at: null,
        }],
      };
      scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
      await fn.fetch(webhookRequest(fn, "{}"));
      const notices = scenario.writes.filter((w) => w.table === "notifications" && w.op === "insert"
        && (w.payload as Record<string, unknown>).user_id === "admin-1");
      expect(notices).toHaveLength(1);
      expect((notices[0].payload as Record<string, unknown>).title).toMatch(/escrow/i);
      expect((notices[0].payload as Record<string, unknown>).title).not.toMatch(/payout/i);
    });

    it("pages ops when the unblock matches zero rows on a job that was read as chargeback", async () => {
      const fn = await loadConfigured();
      closedEvent("evt_wc_zero", "warning_closed");
      scenario.reads.jobs = {
        rows: [{
          id: "job-moved", customer_id: "p", helper_id: "h", title: "Job",
          dispute_status: "stripe_chargeback", disputed_at: "2026-09-12T00:00:00.000Z",
          payment_status: "chargeback", status: "in_progress", payout_scheduled_at: null,
        }],
      };
      scenario.writeSelectRows.jobs = [];
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(
        slackAlerts.some((a) => /unblock matched no row/i.test((a as { title: string }).title)),
      ).toBe(true);
    });

    it("a LOST dispute leaves payment_status untouched", async () => {
      const fn = await loadConfigured();
      closedEvent("evt_lost", "lost");
      scenario.reads.jobs = {
        rows: [{
          id: "job-lost", customer_id: "p", helper_id: "h", title: "Job",
          dispute_status: "stripe_chargeback", disputed_at: "2026-09-12T00:00:00.000Z",
          payment_status: "chargeback", status: "in_progress", payout_scheduled_at: null,
        }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(unblockWrite()).toBeUndefined();
      const outcome = scenario.writes.find((w) => w.table === "jobs" && w.op === "update");
      expect((outcome?.payload as Record<string, unknown>).dispute_status).toBe("dispute_lost");
    });
  });

  // OPEN.md (HIGH, d7a04acb9): charge.dispute.created overwrote dispute_status
  // and disputed_at whatever hold was already on the job, and a dismissed
  // inquiry (warning_closed) then cleared disputed_at — the only guard
  // process-scheduled-payouts has. Two ways that paid out wrongly:
  //   (1) a decided internal dispute whose split never ran (rpc_decide_dispute
  //       sets dispute_status='resolved' and leaves disputed_at) went back to
  //       payout_pending with no hold: Helpr paid in full, poster never refunded;
  //   (2) a transferReversed 'reversal_hold' job lost its hold and was re-payable.
  describe("a card dispute never lifts a hold it did not place", () => {
    const HELD_AT = "2026-09-10T00:00:00.000Z";

    function createdEvent(id: string) {
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id,
        type: "charge.dispute.created",
        data: {
          object: {
            id: `dp_${id}`, status: "warning_needs_response", amount: 5000, reason: "general",
            payment_intent: "pi_disputed", charge: "ch_d",
          },
        },
      });
    }
    function closedEvent(id: string, status: string) {
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id,
        type: "charge.dispute.closed",
        data: {
          object: { id: `dp_${id}`, status, amount: 5000, payment_intent: "pi_disputed", charge: "ch_d" },
        },
      });
    }
    const jobUpdates = () => scenario.writes.filter((w) => w.table === "jobs" && w.op === "update");
    const payloadOf = (w: { payload: unknown }) => w.payload as Record<string, unknown>;
    const criticalAlerts = () =>
      (slackAlerts as Array<{ severity?: string; title: string }>).filter((a) => a.severity === "critical");

    describe("charge.dispute.created", () => {
      it("(1) blocks the payout on a job with a decided internal dispute but keeps its dispute_status and disputed_at", async () => {
        const fn = await loadConfigured();
        createdEvent("evt_cb_decided");
        scenario.reads.jobs = {
          rows: [{
            id: "job-decided", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "escrow",
            dispute_status: "resolved", disputed_at: HELD_AT,
          }],
        };
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        const block = jobUpdates().find((w) => "payment_status" in payloadOf(w));
        expect(payloadOf(block!).payment_status).toBe("chargeback");
        expect(block?.filters).toContainEqual({ op: "in", column: "payment_status", value: ["payout_pending", "escrow"] });
        expect(block?.selectCols).toBe("id");
        for (const w of jobUpdates()) {
          expect(payloadOf(w)).not.toHaveProperty("dispute_status");
          expect(payloadOf(w)).not.toHaveProperty("disputed_at");
        }
      });

      it("(2) blocks the payout on a reversal_hold job but keeps the reversal hold", async () => {
        const fn = await loadConfigured();
        createdEvent("evt_cb_reversal");
        scenario.reads.jobs = {
          rows: [{
            id: "job-reversed", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "payout_pending",
            dispute_status: "reversal_hold", disputed_at: HELD_AT,
          }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(jobUpdates().some((w) => payloadOf(w).payment_status === "chargeback")).toBe(true);
        for (const w of jobUpdates()) {
          expect(payloadOf(w)).not.toHaveProperty("dispute_status");
          expect(payloadOf(w)).not.toHaveProperty("disputed_at");
        }
      });

      it("normal path: an unheld payable job gets the block and the chargeback markers, each as a conditional write", async () => {
        const fn = await loadConfigured();
        createdEvent("evt_cb_plain");
        scenario.reads.jobs = {
          rows: [{
            id: "job-plain", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "payout_pending",
            dispute_status: null, disputed_at: null,
          }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        const block = jobUpdates().find((w) => "payment_status" in payloadOf(w));
        expect(payloadOf(block!).payment_status).toBe("chargeback");
        const markers = jobUpdates().find((w) => "dispute_status" in payloadOf(w));
        expect(payloadOf(markers!).dispute_status).toBe("stripe_chargeback");
        expect(typeof payloadOf(markers!).disputed_at).toBe("string");
        // Never over an internal status: only null-with-no-hold, or a status the
        // card-dispute handlers own themselves.
        const guard = markers?.filters.find((f) => f.op === "or");
        expect(String(guard?.value)).toContain("and(dispute_status.is.null,disputed_at.is.null)");
        expect(String(guard?.value)).toContain("dispute_status.in.(");
        expect(String(guard?.value)).not.toMatch(/resolved|reversal_hold|open|escalated/);
        expect(markers?.selectCols).toBe("id");
      });
    });

    describe("charge.dispute.closed (warning_closed)", () => {
      it("(1) keeps disputed_at and pages ops critical when a decided dispute has not executed", async () => {
        const fn = await loadConfigured();
        closedEvent("evt_wc_decided", "warning_closed");
        // The shape the OLD created handler left behind: dispute_status
        // overwritten to stripe_chargeback. Only the disputes row still knows.
        scenario.reads.jobs = {
          rows: [{
            id: "job-decided", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: "2026-09-09T00:00:00.000Z",
            dispute_status: "stripe_chargeback", disputed_at: HELD_AT,
          }],
        };
        scenario.reads.disputes = {
          rows: [{ id: "disp-1", execution_status: "pending", payout_split: { poster: 0.5, helper: 0.5 } }],
        };
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        for (const w of jobUpdates()) {
          if ("disputed_at" in payloadOf(w)) expect(payloadOf(w).disputed_at).not.toBeNull();
        }
        expect(criticalAlerts().some((a) => /hold/i.test(a.title))).toBe(true);
      });

      it("(1) keeps an internal 'resolved' dispute_status: the outcome is not written over it", async () => {
        const fn = await loadConfigured();
        closedEvent("evt_wc_decided_new", "warning_closed");
        scenario.reads.jobs = {
          rows: [{
            id: "job-decided", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: null,
            dispute_status: "resolved", disputed_at: HELD_AT,
          }],
        };
        scenario.reads.disputes = { rows: [{ id: "disp-1", execution_status: "failed", payout_split: null }] };
        await fn.fetch(webhookRequest(fn, "{}"));
        for (const w of jobUpdates()) {
          expect(payloadOf(w)).not.toHaveProperty("dispute_status");
          expect(payloadOf(w)).not.toHaveProperty("dispute_resolved_at");
          if ("disputed_at" in payloadOf(w)) expect(payloadOf(w).disputed_at).not.toBeNull();
        }
        expect(criticalAlerts().some((a) => /hold/i.test(a.title))).toBe(true);
      });

      it("(2) keeps disputed_at and pages ops critical when the job has a reversed transfer", async () => {
        const fn = await loadConfigured();
        closedEvent("evt_wc_reversed", "warning_closed");
        scenario.reads.jobs = {
          rows: [{
            id: "job-reversed", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: "2026-09-09T00:00:00.000Z",
            dispute_status: "stripe_chargeback", disputed_at: HELD_AT,
          }],
        };
        scenario.reads.payout_transfers = {
          rows: [{ id: "pt-1", status: "reversed", stripe_transfer_id: "tr_rev" }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        for (const w of jobUpdates()) {
          if ("disputed_at" in payloadOf(w)) expect(payloadOf(w).disputed_at).not.toBeNull();
        }
        expect(criticalAlerts().some((a) => /hold/i.test(a.title))).toBe(true);
      });

      it("(2) a reversal_hold job keeps its dispute_status", async () => {
        const fn = await loadConfigured();
        closedEvent("evt_wc_reversal_hold", "warning_closed");
        scenario.reads.jobs = {
          rows: [{
            id: "job-reversed", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: "2026-09-09T00:00:00.000Z",
            dispute_status: "reversal_hold", disputed_at: HELD_AT,
          }],
        };
        scenario.reads.payout_transfers = {
          rows: [{ id: "pt-1", status: "reversed", stripe_transfer_id: "tr_rev" }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        for (const w of jobUpdates()) {
          expect(payloadOf(w)).not.toHaveProperty("dispute_status");
          if ("disputed_at" in payloadOf(w)) expect(payloadOf(w).disputed_at).not.toBeNull();
        }
      });

      it("fails closed (500, Stripe retries) when the hold lookup cannot be read", async () => {
        const fn = await loadConfigured();
        closedEvent("evt_wc_hold_read_err", "warning_closed");
        scenario.reads.jobs = {
          rows: [{
            id: "job-x", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: null,
            dispute_status: "stripe_chargeback", disputed_at: HELD_AT,
          }],
        };
        scenario.reads.payout_transfers = { error: { message: "boom" } };
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(500);
        expect(jobUpdates().some((w) => payloadOf(w).disputed_at === null)).toBe(false);
      });

      it("normal path: no internal hold → restores the payment state and clears disputed_at, CAS on a chargeback-owned status", async () => {
        const fn = await loadConfigured();
        closedEvent("evt_wc_plain", "warning_closed");
        scenario.reads.jobs = {
          rows: [{
            id: "job-plain", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: "2026-09-09T00:00:00.000Z",
            dispute_status: "stripe_chargeback", disputed_at: HELD_AT,
          }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        const unblock = jobUpdates().find((w) => "payment_status" in payloadOf(w));
        expect(payloadOf(unblock!).payment_status).toBe("payout_pending");
        expect(payloadOf(unblock!).disputed_at).toBeNull();
        expect(unblock?.filters).toContainEqual({ op: "eq", column: "payment_status", value: "chargeback" });
        expect(String(unblock?.filters.find((f) => f.op === "or")?.value)).toMatch(/^dispute_status\.in\.\(/);
        expect(unblock?.selectCols).toBe("id");
        expect(criticalAlerts()).toHaveLength(0);
      });
    });

    it("normal path: a LOST dispute records dispute_lost on a chargeback-owned job, conditionally", async () => {
      const fn = await loadConfigured();
      closedEvent("evt_lost_plain", "lost");
      scenario.reads.jobs = {
        rows: [{
          id: "job-lost", customer_id: "p", helper_id: "h", title: "Job",
          status: "completed", payment_status: "chargeback", payout_scheduled_at: null,
          dispute_status: "stripe_chargeback", disputed_at: HELD_AT,
        }],
      };
      await fn.fetch(webhookRequest(fn, "{}"));
      const outcome = jobUpdates().find((w) => "dispute_status" in payloadOf(w));
      expect(payloadOf(outcome!).dispute_status).toBe("dispute_lost");
      expect(outcome?.selectCols).toBe("id");
      expect(jobUpdates().some((w) => "payment_status" in payloadOf(w) || "disputed_at" in payloadOf(w))).toBe(false);
    });
  });

  // lh-money-escrow review of the fix above (2026-09-14): B1's cheap extra, N1,
  // N2, N5.
  describe("card dispute holds — review follow-ups", () => {
    const HELD_AT = "2026-09-10T00:00:00.000Z";
    function event(id: string, type: string, object: Record<string, unknown>) {
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id, type, data: { object } });
    }
    const disputeObj = (id: string, status: string) => ({
      id: `dp_${id}`, status, amount: 5000, reason: "general", payment_intent: "pi_disputed", charge: "ch_d",
    });
    const jobUpdates = () => scenario.writes.filter((w) => w.table === "jobs" && w.op === "update");
    const payloadOf = (w: { payload: unknown }) => w.payload as Record<string, unknown>;
    const alerts = () => slackAlerts as Array<{ severity?: string; title: string; message: string; oncePerDayKey?: string }>;
    // Admin notices only: the Helpr's own (ME-009) are asserted in
    // chargebackHeldPayoutNotice.test.ts.
    const notices = () =>
      scenario.writes
        .filter((w) => w.table === "notifications" && w.op === "insert")
        .map((w) => w.payload as { user_id: string; title: string; message: string })
        .filter((n) => n.user_id !== "h");

    describe("B1: an open or escalated internal dispute is a hold on dismissal", () => {
      it("a job still in status 'disputed' (legacy stripe_chargeback overwrite) keeps disputed_at and pages", async () => {
        const fn = await loadConfigured();
        event("evt_b1_disputed", "charge.dispute.closed", disputeObj("b1d", "warning_closed"));
        scenario.reads.jobs = {
          rows: [{
            id: "job-esc", customer_id: "p", helper_id: "h", title: "Job",
            status: "disputed", payment_status: "chargeback", payout_scheduled_at: null,
            dispute_status: "stripe_chargeback", disputed_at: HELD_AT,
          }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(jobUpdates().some((w) => "disputed_at" in payloadOf(w) && payloadOf(w).disputed_at === null)).toBe(false);
        expect(alerts().some((a) => a.severity === "critical" && /hold/i.test(a.title))).toBe(true);
      });

      it("an OPEN disputes row keeps disputed_at and pages", async () => {
        const fn = await loadConfigured();
        event("evt_b1_open", "charge.dispute.closed", disputeObj("b1o", "warning_closed"));
        scenario.reads.jobs = {
          rows: [{
            id: "job-open", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: "2026-09-09T00:00:00.000Z",
            dispute_status: "stripe_chargeback", disputed_at: HELD_AT,
          }],
        };
        scenario.reads.disputes = {
          rows: [],
          selectOverrides: [{ includes: "opener_id", result: { rows: [{ id: "disp-open", status: "open", opener_id: "p" }] } }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(jobUpdates().some((w) => "disputed_at" in payloadOf(w) && payloadOf(w).disputed_at === null)).toBe(false);
        expect(alerts().some((a) => a.severity === "critical" && /hold/i.test(a.title))).toBe(true);
      });

      it("an internal 'escalated' dispute_status is a hold", async () => {
        const fn = await loadConfigured();
        event("evt_b1_esc", "charge.dispute.closed", disputeObj("b1e", "warning_closed"));
        scenario.reads.jobs = {
          rows: [{
            id: "job-esc2", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: null,
            dispute_status: "escalated", disputed_at: HELD_AT,
          }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(alerts().some((a) => a.severity === "critical" && /hold/i.test(a.title))).toBe(true);
      });
    });

    describe("N1: a settled internal dispute is not a hold", () => {
      it("dismissal on an auto_resolved job: no hold page, and the admin notice does not say 'on hold'", async () => {
        const fn = await loadConfigured();
        event("evt_n1_wc", "charge.dispute.closed", disputeObj("n1wc", "warning_closed"));
        scenario.reads.jobs = {
          rows: [{
            id: "job-ar", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: "2026-09-09T00:00:00.000Z",
            dispute_status: "auto_resolved", disputed_at: null,
          }],
        };
        scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(alerts().some((a) => a.severity === "critical")).toBe(false);
        expect(notices()).toHaveLength(1);
        expect(notices()[0].title).not.toMatch(/hold/i);
        expect(alerts().some((a) => /hold was kept/i.test(a.message))).toBe(false);
      });

      it("won on an auto_resolved job tells admins to release the payout (not to withhold it)", async () => {
        const fn = await loadConfigured();
        event("evt_n1_won", "charge.dispute.closed", disputeObj("n1won", "won"));
        scenario.reads.jobs = {
          rows: [{
            id: "job-ar", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: null,
            dispute_status: "auto_resolved", disputed_at: null,
          }],
        };
        scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(notices()).toHaveLength(1);
        expect(notices()[0].title).toMatch(/release/i);
        expect(notices()[0].message).not.toMatch(/do not release/i);
      });

      it("won on a job with a real hold says so, and does not tell admins to release", async () => {
        const fn = await loadConfigured();
        event("evt_n1_won_held", "charge.dispute.closed", disputeObj("n1wonh", "won"));
        scenario.reads.jobs = {
          rows: [{
            id: "job-rh", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "chargeback", payout_scheduled_at: null,
            dispute_status: "reversal_hold", disputed_at: HELD_AT,
          }],
        };
        scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(notices()).toHaveLength(1);
        expect(notices()[0].title).not.toMatch(/release Helpr payout/i);
        expect(notices()[0].message).toMatch(/hold/i);
      });
    });

    describe("N2: a released job with a live card dispute still gets a marker release-payout refuses", () => {
      it("created on a released job with a SETTLED internal status places stripe_chargeback, CAS on that status", async () => {
        const fn = await loadConfigured();
        event("evt_n2_rel", "charge.dispute.created", disputeObj("n2rel", "needs_response"));
        scenario.reads.jobs = {
          rows: [{
            id: "job-rel", customer_id: "p", helper_id: "h", title: "Job",
            status: "completed", payment_status: "released",
            dispute_status: "resolved", disputed_at: HELD_AT,
          }],
        };
        await fn.fetch(webhookRequest(fn, "{}"));
        const marker = jobUpdates().find((w) => "dispute_status" in payloadOf(w));
        expect(payloadOf(marker!).dispute_status).toBe("stripe_chargeback");
        expect(marker?.filters).toContainEqual({ op: "or", column: "", value: "dispute_status.eq.resolved" });
        expect(marker?.selectCols).toBe("id");
        // Q202: the only payment_status write on a released job is the
        // clawback's CAS released -> chargeback (chargebackClawback.test.ts);
        // the payable-set block (escrow/payout_pending) never touches it.
        const paymentWrites = jobUpdates().filter((w) => "payment_status" in payloadOf(w));
        expect(paymentWrites).toHaveLength(1);
        expect(payloadOf(paymentWrites[0]).payment_status).toBe("chargeback");
        expect(paymentWrites[0].filters).toContainEqual({ op: "eq", column: "payment_status", value: "released" });
      });

      it("created on a released 'resolved' job whose split has NOT executed leaves the markers alone", async () => {
        const fn = await loadConfigured();
        event("evt_n2_rel_held", "charge.dispute.created", disputeObj("n2relh", "needs_response"));
        scenario.reads.jobs = {
          rows: [{
            id: "job-rel", customer_id: "p", helper_id: "h", title: "Job", payout_scheduled_at: null,
            status: "completed", payment_status: "released",
            dispute_status: "resolved", disputed_at: HELD_AT,
          }],
        };
        scenario.reads.disputes = { rows: [{ id: "disp-1", execution_status: "pending", payout_split: null }] };
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(jobUpdates().some((w) => "dispute_status" in payloadOf(w))).toBe(false);
      });

      for (const type of ["transfer.failed", "transfer.canceled"]) {
        it(`${type} does not move a job with a live dispute back to payout_pending, and pages`, async () => {
          const fn = await loadConfigured();
          event(`evt_n2_${type}`, type, { id: "tr_bad", amount: 5000, destination: "acct_helper", failure_message: "closed" });
          scenario.writeSelectRows.payout_transfers = [{ job_id: "job-cb" }];
          scenario.reads.jobs = {
            rows: [{ id: "job-cb", status: "completed", payment_status: "released", dispute_status: "stripe_chargeback", disputed_at: HELD_AT }],
          };
          const res = await fn.fetch(webhookRequest(fn, "{}"));
          expect(res.status).toBe(200);
          expect(jobUpdates().some((w) => payloadOf(w).payment_status === "payout_pending")).toBe(false);
          expect(alerts().some((a) => a.severity === "critical" && /dispute/i.test(a.title))).toBe(true);
        });

        it(`${type} still re-queues a job with no dispute (normal path)`, async () => {
          const fn = await loadConfigured();
          event(`evt_n2_ok_${type}`, type, { id: "tr_bad", amount: 5000, destination: "acct_helper", failure_message: "closed" });
          scenario.writeSelectRows.payout_transfers = [{ job_id: "job-ok" }];
          scenario.reads.jobs = {
            rows: [{ id: "job-ok", status: "completed", payment_status: "released", dispute_status: null, disputed_at: null }],
          };
          await fn.fetch(webhookRequest(fn, "{}"));
          expect(jobUpdates().some((w) => payloadOf(w).payment_status === "payout_pending")).toBe(true);
        });
      }
    });

    it("N5: the hold-read failure page is deduped per job per day", async () => {
      const fn = await loadConfigured();
      event("evt_n5", "charge.dispute.closed", disputeObj("n5", "warning_closed"));
      scenario.reads.jobs = {
        rows: [{
          id: "job-n5", customer_id: "p", helper_id: "h", title: "Job",
          status: "completed", payment_status: "chargeback", payout_scheduled_at: null,
          dispute_status: "stripe_chargeback", disputed_at: HELD_AT,
        }],
      };
      scenario.reads.payout_transfers = { error: { message: "boom" } };
      await fn.fetch(webhookRequest(fn, "{}"));
      const page = alerts().find((a) => /hold check failed/i.test(a.title));
      expect(page?.oncePerDayKey).toContain("job-n5");
    });
  });
});
