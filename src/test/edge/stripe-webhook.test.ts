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

async function json(res: Response): Promise<Record<string, unknown>> {
  return JSON.parse(await res.text());
}

/** A webhook POST carrying a raw body + signature header. */
function webhookRequest(fn: EdgeHarness, rawBody: string, sig = "t=1,v1=abc") {
  return fn.request({
    rawBody,
    headers: { "stripe-signature": sig, "content-type": "application/json" },
  });
}


// Split 2026-11-07 (lander): stripe-webhook.test.ts was one 5,100-line file whose single worker hit the
// heap limit in CI (m1 #4217 shard 1/6, twice); payment_intent / refund / dispute groups are in stripe-webhook.payments.test.ts, the rest in stripe-webhook.other.test.ts. Same tests, no assertion changed.
describe("stripe-webhook edge function", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
  });

  /*
   * Q156: nothing it could not verify is ever acknowledged. Each of these used
   * to answer 200 "to stop Stripe retrying", which is how a genuine delivery
   * was dropped on 2026-09-23 12:43:27Z with nothing left to replay.
   *
   * @mutate supabase/functions/_shared/stripeWebhookReject.ts | stripe_key_not_configured: 500, | stripe_key_not_configured: 200,
   * @mutate supabase/functions/_shared/stripeWebhookReject.ts | webhook_secret_not_configured: 500, | webhook_secret_not_configured: 200,
   * @mutate supabase/functions/_shared/stripeWebhookReject.ts | missing_signature_header: 400, | missing_signature_header: 200,
   * @mutate supabase/functions/stripe-webhook/index.ts | return webhookRejectResponse("webhook_secret_not_configured"); | return new Response("{}", { status: 200 });
   */
  describe("misconfiguration is refused (non-2xx), never acknowledged", () => {
    it("returns 500 when STRIPE_SECRET_KEY is not set, and pages ops", async () => {
      setEnv({ SUPABASE_URL: "https://x.test", STRIPE_WEBHOOK_SECRET: "whsec_x" });
      const fn = await loadEdgeFunction("stripe-webhook");
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(500);
      expect((await json(res)).error).toBe("stripe_key_not_configured");
      expect((slackAlerts[0] as { severity?: string }).severity).toBe("critical");
    });

    it("returns 500 when STRIPE_WEBHOOK_SECRET is missing, and pages ops", async () => {
      setEnv({
        SUPABASE_URL: "https://x.test",
        SUPABASE_SERVICE_ROLE_KEY: "svc",
        STRIPE_SECRET_KEY: "sk_test_abc",
      });
      const fn = await loadEdgeFunction("stripe-webhook");
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(500);
      expect((await json(res)).error).toBe("webhook_secret_not_configured");
      expect((slackAlerts[0] as { severity?: string }).severity).toBe("critical");
    });

    it("returns 400 when the stripe-signature header is absent, and writes nothing", async () => {
      const fn = await loadConfigured();
      const res = await fn.fetch(fn.request({ rawBody: "{}" }));
      expect(res.status).toBe(400);
      expect((await json(res)).error).toBe("missing_signature_header");
      expect(stripeMock.webhooks.constructEventAsync).not.toHaveBeenCalled();
      expect(scenario.writes).toHaveLength(0);
    });

    it("OPTIONS preflight returns 200 with CORS", async () => {
      const fn = await loadConfigured();
      const res = await fn.fetch(fn.request({ method: "OPTIONS" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    });
  });

  /*
   * Q156, the incident itself: a real Stripe delivery (3524 bytes, header
   * t=1790167406,v1=…) failed verification and was answered 200, so Stripe
   * recorded a success and never sent it again.
   *
   * @mutate supabase/functions/_shared/stripeWebhookReject.ts | signature_verification_failed: 400, | signature_verification_failed: 200,
   * @mutate supabase/functions/stripe-webhook/index.ts | return webhookRejectResponse("signature_verification_failed"); | return new Response(JSON.stringify({ received: true, error: "signature_verification_failed" }), { status: 200 });
   * @mutate supabase/functions/_shared/stripeWebhookReject.ts | severity: "critical" as const, | severity: "warning" as const,
   * @mutate supabase/functions/_shared/stripeWebhookReject.ts | claimedLivemode = typeof j.livemode === "boolean" ? j.livemode : null; | claimedLivemode = null;
   * @mutate supabase/functions/stripe-webhook/index.ts | await postSlackOpsAlert(\n      signatureFailureAlert({\n        fn: "stripe-webhook", | void (\n      signatureFailureAlert({\n        fn: "stripe-webhook",
   */
  describe("signature verification", () => {
    it("REFUSES a bad signature with 400 (so Stripe retries), writes nothing, and pages ops naming the event", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockRejectedValue(
        new Error("No signatures found matching the expected signature"),
      );
      const res = await fn.fetch(
        webhookRequest(
          fn,
          '{"id":"evt_q156","type":"account.updated","livemode":true}',
          "t=1790167406,v1=5803cc6d86f73d12",
        ),
      );
      expect(res.status).toBe(400);
      expect(res.status >= 200 && res.status < 300).toBe(false);
      expect((await json(res)).error).toBe("signature_verification_failed");
      // Nothing from an unverified body is processed: the dedupe insert is the
      // first write, so zero writes proves it stopped at the signature.
      expect(scenario.writes).toHaveLength(0);

      // A critical alert (which opens an ops_alert_ledger item) naming what the
      // delivery claims to be, so it can be found in Stripe and resent.
      const alert = slackAlerts.find((a) =>
        /signature failed/i.test(String((a as { title?: string }).title ?? "")),
      ) as
        | { kind: string; severity: string; oncePerDayKey?: string; fields: Record<string, unknown> }
        | undefined;
      expect(alert?.kind).toBe("stripe_webhook_error");
      expect(alert?.severity).toBe("critical");
      expect(alert?.fields["Claimed event (unverified)"]).toBe("evt_q156");
      expect(alert?.fields["Claimed livemode (unverified)"]).toBe("true");
      expect(alert?.fields["Key mode"]).toBe("TEST");
      expect(alert?.fields["Signature schemes"]).toBe("t,v1");
      expect(String(alert?.fields.Error)).toMatch(/No signatures found/);
      // Stripe retries a refused event; the page goes out once a day, the
      // ledger still counts every occurrence.
      expect(alert?.oncePerDayKey).toBe("stripe-webhook:signature_verification_failed");
    });

    it("processes the event when the signature verifies", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_ok",
        type: "tax.settings.updated",
        data: { object: {} },
      });
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      expect((await json(res)).received).toBe(true);
    });
  });

  describe("idempotency guard", () => {
    it("skips an event whose id was already recorded (unique violation 23505)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_dup",
        type: "tax.settings.updated",
        data: { object: {} },
      });
      // The idempotency insert into stripe_webhook_events returns 23505.
      scenario.writeErrors.stripe_webhook_events = {
        message: "duplicate key value violates unique constraint",
        code: "23505",
      };
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      expect((await json(res)).duplicate).toBe(true);
    });

    it("continues processing when the idempotency insert is a fresh (no-error) write", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_fresh",
        type: "tax.settings.updated",
        data: { object: {} },
      });
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      const out = await json(res);
      expect(out.duplicate).toBeUndefined();
      expect(out.received).toBe(true);
    });
  });

  describe("checkout.session.completed", () => {
    /*
     * ME-043: a taxable category billed to Louisiana that Stripe taxed at $0
     * looked identical to the correct $0 on an exempt job. It now alerts.
     *
     * @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | if (taxedZeroOnTaxableLouisianaLabor(sessionTaxCents, | if (false && taxedZeroOnTaxableLouisianaLabor(sessionTaxCents,
     */
    describe("taxable labor taxed $0 in Louisiana (ME-043)", () => {
      async function deliver(category: string, meta: Record<string, string> = {}, state = "LA") {
        const fn = await loadConfigured();
        scenario.reads.jobs = { rows: [{ id: "job-tax", budget: 100, category, is_seed: false }] };
        // The PI carries NO amount_details: the signal must come from the
        // session's own total_details, which Checkout always fills.
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_tax" });
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: `evt_tax_${category}_${state}`,
          type: "checkout.session.completed",
          data: {
            object: {
              id: "cs_tax",
              livemode: false,
              mode: "payment",
              customer_email: "poster@test.com",
              customer_details: { address: { state } },
              total_details: { amount_tax: 0 },
              payment_intent: "pi_tax",
              metadata: { job_id: "job-tax", ...meta },
            },
          },
        });
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        return (slackAlerts as Array<{ title: string }>).filter((a) => /\$0 Louisiana sales tax/.test(a.title));
      }

      it("alerts on an auto repair job billed to LA with $0 tax (assembly is untaxed since Q2083 part 1)", async () => {
        const alerts = await deliver("auto_repair");
        expect(alerts).toHaveLength(1);
        expect((alerts[0] as unknown as { oncePerDayKey: string }).oncePerDayKey).toBe("taxable-zero-tax:test");
      });

      // Q2083 (b): a job taxed at the job address is LA by construction, so a
      // $0 job-site figure alerts whatever the billing state.
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |       const billingState = String((session.metadata as any)?.[JOB_TAX_CALC_KEY] ?? "").startsWith("taxcalc_")\n        ? "LA" |       const billingState = false\n        ? "LA"
      // Q1728: a gift shortfall taxed at the job site is a taxed job, so its $0 figure alerts; a plain gift one does not.
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |     const isGiftShortfall = Boolean((session.metadata as any)?.gift_card_id) && !String( |     const isGiftShortfall = Boolean((session.metadata as any)?.gift_card_id) \|\| !String(
      it("a gift shortfall with a $0 job-site figure alerts; a gift shortfall without one does not (Q1728)", async () => {
        expect(await deliver("auto_repair", { gift_card_id: "gc-1", tax_calculation_id: "taxcalc_gz", job_tax_cents: "0" })).toHaveLength(1);
        resetSupabaseMock(); resetStripeMock(); resetSharedMocks();
        expect(await deliver("auto_repair", { gift_card_id: "gc-1" })).toHaveLength(0);
      });

      it("a $0 job-site figure alerts even when the poster is billed out of state (Q2083 b)", async () => {
        expect(await deliver("auto_repair", { tax_calculation_id: "taxcalc_z", job_tax_cents: "0" }, "TX")).toHaveLength(1);
      });

      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |     const sessionTaxCents = sessionJobTaxCents(session as any) ?? undefined; |     const sessionTaxCents = session.total_details?.amount_tax;
      it("a job-site figure above $0 is the tax (total_details reads 0 with automatic_tax off), so no alert (Q2083 b)", async () => {
        expect(await deliver("auto_repair", { tax_calculation_id: "taxcalc_t", job_tax_cents: "1100" })).toHaveLength(0);
        const w = scenario.writes.find((x) => x.table === "jobs" && x.op === "update" && "sales_tax_amount" in (x.payload as Record<string, unknown>));
        expect((w?.payload as Record<string, unknown>)?.sales_tax_amount).toBe(11);
      });

      it("stays quiet on an exempt category, a non-LA address, and a gift-card shortfall", async () => {
        expect(await deliver("yard_work")).toHaveLength(0);
        resetSharedMocks();
        expect(await deliver("auto_repair", {}, "TX")).toHaveLength(0);
        resetSharedMocks();
        expect(await deliver("auto_repair", { gift_card_id: "gc-1" })).toHaveLength(0);
      });
    });

    // jobs.sales_tax_rate has CHECK ck_jobs_sales_tax_rate_range (0..1). The
    // webhook wrote a PERCENT (11.2) in the SAME update that marks the job
    // 'escrow', so the first taxed job would never have been funded.
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |           updateData.sales_tax_rate = effectiveSalesTaxRate(taxCents, taxableBaseCents); |           updateData.sales_tax_rate = Math.round((taxCents / taxableBaseCents) * 100 * 100) / 100;
    // Q2083 (lead review 11-02): a job taxed by the poster's ANSWER (an untaxed category) prices its bonus with the
    // labor's code, so the stored rate divides by labor + bonus: $100 + $50 bonus, 10.45% -> 1568 / 15000, never
    // 1568 / 10000. The kind must be read (select) and passed (jobEscrowTaxableBaseCents).
    // @mutate supabase/functions/_shared/salesTax.ts |   if (!isLaborTaxable(job?.category, job?.tax_kind)) return laborCents; |   if (!isLaborTaxable(job?.category)) return laborCents;
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | .select("budget, category, tax_kind, customer_fee_amount, poster_fee_flat_cents, is_urgent, urgent_fee") | .select("budget, category, customer_fee_amount, poster_fee_flat_cents, is_urgent, urgent_fee")
    it("Q2083: a job taxed by its answer stores the rate over labor + the taxed bonus", async () => {
      const fn = await loadConfigured();
      const row = { id: "job-tax-k", is_seed: false, budget: 100, category: "cleaning", customer_fee_amount: 0, poster_fee_flat_cents: null, is_urgent: true, urgent_fee: 50 };
      scenario.reads.jobs = {
        rows: [{ id: "job-tax-k", is_seed: false, budget: 100 }],
        // The answer arrives only for a select that names tax_kind.
        selectOverrides: [{ includes: "tax_kind", result: { rows: [{ ...row, tax_kind: "item_repair" }] } }, { includes: "urgent_fee", result: { rows: [row] } }],
      };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_tax_k" });
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_tax_rate_kind",
        type: "checkout.session.completed",
        data: { object: {
          id: "cs_tax_rate_kind", mode: "payment", payment_status: "paid", customer_email: "poster@test.com",
          customer_details: { address: { state: "LA" } }, total_details: { amount_tax: 1568 }, payment_intent: "pi_tax_k",
          metadata: { job_id: "job-tax-k" },
        } },
      });
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      const w = scenario.writes.find((x) => x.table === "jobs" && x.op === "update" && (x.payload as Record<string, unknown>).payment_status === "escrow");
      expect(Number((w?.payload as Record<string, unknown>).sales_tax_rate)).toBeCloseTo(0.1045, 3);
    });

    // Q2083: the $0-tax alert fires for a job taxed by its answer, which reads the kind from the job row.
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | billingState, taxJob?.tax_kind)) { | billingState)) {
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | .select("budget, category, tax_kind, is_seed") | .select("budget, category, is_seed")
    it("Q2083: a job taxed by its answer (cleaning + clothes_cleaning) billed to LA with $0 tax alerts", async () => {
      const fn = await loadConfigured();
      const zrow = { id: "job-tax-z", budget: 100, category: "cleaning", is_seed: false };
      // The answer arrives only for a select that names tax_kind.
      scenario.reads.jobs = { rows: [zrow], selectOverrides: [{ includes: "tax_kind", result: { rows: [{ ...zrow, tax_kind: "clothes_cleaning" }] } }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_tax_z" });
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_tax_zero_kind",
        type: "checkout.session.completed",
        data: { object: {
          id: "cs_tax_z", livemode: false, mode: "payment", customer_email: "poster@test.com",
          customer_details: { address: { state: "LA" } }, total_details: { amount_tax: 0 }, payment_intent: "pi_tax_z",
          metadata: { job_id: "job-tax-z" },
        } },
      });
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      expect((slackAlerts as Array<{ title: string }>).filter((a) => /\$0 Louisiana sales tax/.test(a.title))).toHaveLength(1);
    });

    it("a taxed job's escrow write stores sales_tax_rate as a fraction that fits the CHECK", async () => {
      const fn = await loadConfigured();
      scenario.reads.jobs = { rows: [{ id: "job-tax", budget: 100, category: "auto_repair", is_seed: false }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_tax", amount_details: { tax: { total_tax_amount: 1120 } } });
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_tax_rate",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_tax_rate",
            mode: "payment",
            payment_status: "paid",
            customer_email: "poster@test.com",
            customer_details: { address: { state: "LA" } },
            total_details: { amount_tax: 1120 },
            payment_intent: "pi_tax",
            metadata: { job_id: "job-tax" },
          },
        },
      });
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      const w = scenario.writes.find((x) => x.table === "jobs" && x.op === "update" && (x.payload as Record<string, unknown>).payment_status === "escrow");
      const p = w?.payload as Record<string, unknown>;
      expect(p.sales_tax_amount).toBe(11.2);
      expect(p.sales_tax_rate).toBe(0.112); // 1120 / 10000, a fraction
      expect(Number(p.sales_tax_rate)).toBeLessThanOrEqual(1);
    });

    // Q2152 (lh-money-escrow review of 461a6b724 #2): the pinned API (2025-08-27.basil) returns no
    // amount_details.tax on a PaymentIntent, so the job kept the insert-time estimate. The Checkout Session's own
    // total_details.amount_tax is Stripe's figure; a gift difference session (non-taxable on purpose) is not.
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | const taxCents = typeof sessionTaxForJob === "number" ? sessionTaxForJob : piTaxCents; | const taxCents = piTaxCents;
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | const sessionTaxForJob = (session.metadata as any)?.gift_card_id && !jobSiteTaxed ? undefined : (sessionJobTaxCents(session as any) ?? undefined); | const sessionTaxForJob = (sessionJobTaxCents(session as any) ?? undefined);
    it("Q2152: a basil PaymentIntent (no amount_details.tax) records the SESSION's tax, 1105c -> 11.05; a gift difference session's $0 does not overwrite the estimate", async () => {
      const deliver = async (metadata: Record<string, string>, amountTax: number) => {
        const fn = await loadConfigured();
        scenario.reads.jobs = { rows: [{ id: "job-tax", budget: 100, category: "auto_repair", is_seed: false }] };
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_tax", amount_details: { tip: {} } });
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: `evt_q2152_${amountTax}`,
          type: "checkout.session.completed",
          data: {
            object: {
              id: "cs_q2152", mode: "payment", payment_status: "paid", customer_email: "poster@test.com",
              customer_details: { address: { state: "LA" } }, total_details: { amount_tax: amountTax },
              payment_intent: "pi_tax", metadata: { job_id: "job-tax", ...metadata },
            },
          },
        });
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        const w = scenario.writes.find((x) => x.table === "jobs" && x.op === "update" && (x.payload as Record<string, unknown>).stripe_payment_intent_id === "pi_tax");
        return w?.payload as Record<string, unknown> | undefined;
      };
      const p = await deliver({}, 1105);
      expect(p?.sales_tax_amount).toBe(11.05);
      expect(p?.sales_tax_rate).toBe(0.1105);
      resetSupabaseMock(); resetStripeMock(); resetSharedMocks();
      const g = await deliver({ gift_card_id: "gc-1" }, 0);
      expect(g).toBeTruthy();
      expect(g).not.toHaveProperty("sales_tax_amount");
      // Q1728 (owner 11-03): a gift shortfall that carries the job-site tax line records that tax.
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | const sessionTaxForJob = (session.metadata as any)?.gift_card_id && !jobSiteTaxed ? undefined : | const sessionTaxForJob = (session.metadata as any)?.gift_card_id ? undefined :
      resetSupabaseMock(); resetStripeMock(); resetSharedMocks();
      const gt = await deliver({ gift_card_id: "gc-1", tax_calculation_id: "taxcalc_gift", job_tax_cents: "1000" }, 0);
      expect(gt?.sales_tax_amount).toBe(10);
      expect(gt?.sales_tax_rate).toBe(0.1);
    });

    // Q1996 (lh-money-escrow review of slice 3a, #5): on a poster-fee job in a
    // taxable category the "Service fee" line is taxed with the labor, so the
    // rate is tax over budget + fee. Dividing by the budget alone stored
    // 0.1105 for a 10.45% rate.
    // @mutate supabase/functions/_shared/salesTax.ts |   return taxedLaborCents + (Number.isFinite(feeCents) && feeCents > 0 ? feeCents : 0); |   return taxedLaborCents;
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |         const taxableBaseCents = jobEscrowTaxableBaseCents(taxedRow); |         const taxableBaseCents = Math.round(Number(jobRow?.budget ?? 0) * 100);
    // The edge mock ignores select lists, so the fee columns come ONLY through
    // a selectOverride keyed on them: a select that drops them reads the plain
    // row (no fee) and the rate goes wrong (review of the pre-flip items, #1).
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | .select("budget, category, tax_kind, customer_fee_amount, poster_fee_flat_cents, is_urgent, urgent_fee") | .select("budget, category, tax_kind")
    // Q1843: the urgent bonus is taxed like the labor, so its columns must be read too.
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | .select("budget, category, tax_kind, customer_fee_amount, poster_fee_flat_cents, is_urgent, urgent_fee") | .select("budget, category, tax_kind, customer_fee_amount, poster_fee_flat_cents")
    // The charge's own fee (PaymentIntent metadata) wins over a re-priced row (#2).
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |           ? { ...jobRow, customer_fee_amount: Number(piFeeRaw) / 100 } |           ? jobRow
    it.each([
      // [label, job, taxCents, rate]
      ["a taxed poster-fee job divides by budget + the taxed fee", { budget: 100, category: "auto_repair", customer_fee_amount: 5.7, poster_fee_flat_cents: 70 }, 1105, 0.1045],
      ["an exempt poster-fee job's fee is not in the base", { budget: 100, category: "yard_work", customer_fee_amount: 5.7, poster_fee_flat_cents: 70 }, 1045, 0.1045],
      ["a flat-model job divides by the budget", { budget: 100, category: "auto_repair", customer_fee_amount: 0, poster_fee_flat_cents: null }, 1045, 0.1045],
      // The row was re-priced to Pay in 4 ($9.70) after this $5.70 charge opened.
      ["the charge's own fee wins over a re-priced row", { budget: 100, category: "auto_repair", customer_fee_amount: 9.7, poster_fee_flat_cents: 70, piFee: "570" }, 1105, 0.1045],
      // Q1843: a taxed urgent job's $20 bonus is taxed with the labor: 10.45% of $120.
      ["a taxed urgent job divides by budget + the bonus", { budget: 100, category: "auto_repair", customer_fee_amount: 0, poster_fee_flat_cents: null, is_urgent: true, urgent_fee: 20 }, 1254, 0.1045],
      ["an exempt urgent job's bonus is not in the base", { budget: 100, category: "yard_work", customer_fee_amount: 0, poster_fee_flat_cents: null, is_urgent: true, urgent_fee: 20 }, 1045, 0.1045],
    ] as Array<[string, Record<string, unknown>, number, number]>)("%s", async (_label, jobIn, taxCents, rate) => {
      const fn = await loadConfigured();
      const { piFee, ...job } = jobIn;
      const { budget, category, customer_fee_amount, poster_fee_flat_cents, is_urgent, urgent_fee, ...rest } = job;
      // Plain rows carry the budget only; the fee columns arrive only for a select naming them,
      // and the urgent columns only for a select naming those too (first match wins).
      const feeRow = { id: "job-tax-p", is_seed: false, budget, category, customer_fee_amount, poster_fee_flat_cents };
      scenario.reads.jobs = {
        rows: [{ id: "job-tax-p", is_seed: false, budget, ...rest }],
        selectOverrides: [
          { includes: "urgent_fee", result: { rows: [{ ...feeRow, is_urgent: is_urgent ?? false, urgent_fee: urgent_fee ?? 0 }] } },
          { includes: "poster_fee_flat_cents", result: { rows: [feeRow] } },
        ],
      };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_tax_p",
        amount_details: { tax: { total_tax_amount: taxCents } },
        ...(piFee ? { metadata: { service_fee_cents: piFee } } : {}),
      });
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: `evt_tax_rate_p_${String(category)}_${String(poster_fee_flat_cents)}_${String(piFee ?? "")}_${String(urgent_fee ?? "")}`,
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_tax_rate_p",
            mode: "payment",
            payment_status: "paid",
            customer_email: "poster@test.com",
            customer_details: { address: { state: "LA" } },
            total_details: { amount_tax: taxCents },
            payment_intent: "pi_tax_p",
            metadata: { job_id: "job-tax-p" },
          },
        },
      });
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      const w = scenario.writes.find((x) => x.table === "jobs" && x.op === "update" && (x.payload as Record<string, unknown>).payment_status === "escrow");
      // 1105 = 10.45% of the $100 labor (1045) + of the $5.70 fee (60): 1105 / 10570.
      expect(Number((w?.payload as Record<string, unknown>).sales_tax_rate)).toBeCloseTo(rate, 4);
    });

    it("stores the payment intent + escrow status on the job", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_co",
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "payment",
            payment_status: "paid",
            customer_email: "poster@test.com",
            payment_intent: "pi_checkout",
            metadata: { job_id: "job-1" },
          },
        },
      });
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      const jobWrite = scenario.writes.find(
        (w) => w.table === "jobs" && w.op === "update",
      );
      const payload = jobWrite?.payload as Record<string, unknown>;
      expect(payload.stripe_payment_intent_id).toBe("pi_checkout");
      expect(payload.payment_status).toBe("escrow");
    });

    // ME-046: ACH checkout completes with payment_status !== "paid". The job
    // update records the PI id but does NOT touch payment_status or
    // stripe_session_id. void-cancelled-payments treats null stripe_session_id
    // + unpaid + open as "no checkout ever started" and marks the job abandoned
    // within 1h — clearing it would kill a live ACH job mid-settlement.
    // paymentIntentPaymentFailed checks the Stripe session status directly instead.
    it("does not touch payment_status or stripe_session_id on async (ACH) checkout completion", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_ach_complete",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_ach",
            mode: "payment",
            payment_status: "unpaid",
            customer_email: "poster@test.com",
            payment_intent: "pi_ach",
            metadata: { job_id: "job-1" },
          },
        },
      });
      const res = await fn.fetch(webhookRequest(fn, "{}"));
      expect(res.status).toBe(200);
      const jobWrite = scenario.writes.find((w) => w.table === "jobs" && w.op === "update");
      const payload = jobWrite?.payload as Record<string, unknown>;
      expect(payload.stripe_payment_intent_id).toBe("pi_ach");
      expect(payload.payment_status).toBeUndefined();
      expect(payload.stripe_session_id).toBeUndefined();
    });

    // Q1419 (lh-money-escrow review of the Q975 race-15 fix): the escrow write
    // only lands on an unfunded job, or on this same payment again.
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | ,and(stripe_payment_intent_id.eq.${piId},payment_status.eq.escrow)`) | ,stripe_payment_intent_id.eq.${piId}`)
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |       .not("status", "in", "(completed,cancelled)") |
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |       giftConsumedHere = true;\n      logStep("Reserved gift card consumed |       logStep("Reserved gift card consumed
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |       if (!fundedErr && funded && funded.stripe_payment_intent_id === piId) { |       if (false) {
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |         const dupRefund = await refundDuplicateFunding(stripe, piId); |         const dupRefund = { id: "re_none", amount: 0 };
    describe("a checkout completing on a job already funded another way (Q1419)", () => {
      const completed = () =>
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: "evt_dup",
          type: "checkout.session.completed",
          data: { object: { id: "cs_second", mode: "payment", customer_email: "poster@test.com", payment_intent: "pi_second", metadata: { job_id: "job-1" } } },
        });

      it("guards the escrow write: unfunded, or this same payment", async () => {
        const fn = await loadConfigured();
        completed();
        await fn.fetch(webhookRequest(fn, "{}"));
        const w = scenario.writes.find((x) => x.table === "jobs" && x.op === "update");
        expect(w?.filters).toContainEqual(expect.objectContaining({ op: "or", value: "payment_status.is.null,payment_status.in.(unpaid,failed,abandoned),and(stripe_payment_intent_id.eq.pi_second,payment_status.eq.escrow)" }));
        // A closed job is never funded.
        expect(JSON.stringify(w?.filters)).toContain("(completed,cancelled)");
      });

      it("refunds the second payment in full, leaves the job as it was, alerts, and acknowledges", async () => {
        const fn = await loadConfigured();
        completed();
        scenario.writeSelectRows.jobs = [];
        scenario.reads.jobs = { rows: [{ id: "job-1", payment_status: "escrow", stripe_payment_intent_id: null }] };
        stripeMock.refunds.create.mockResolvedValue({ id: "re_dup", status: "succeeded" });
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        expect(stripeMock.refunds.create).toHaveBeenCalledWith(
          { payment_intent: "pi_second", metadata: { source: "duplicate_funding" } },
          { idempotencyKey: "duplicate-funding-refund:pi_second" },
        );
        expect((slackAlerts as Array<{ title: string }>).some((a) => /second payment on an already-funded job was refunded/.test(a.title))).toBe(true);
      });

      // Q1819: the duplicate-funding refund writes its payment_refunds ledger row.
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |         await ledgerDuplicateFundingRefund(supabase, dupRefund, { |         if (false) await ledgerDuplicateFundingRefund(supabase, dupRefund, {
      it("ledgers the duplicate-funding refund once, on its Stripe refund id (Q1819)", async () => {
        const fn = await loadConfigured();
        completed();
        scenario.writeSelectRows.jobs = [];
        scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "poster-1", payment_status: "escrow", stripe_payment_intent_id: "pi_first" }] };
        stripeMock.refunds.create.mockResolvedValue({ id: "re_dup", status: "succeeded", amount: 5150, currency: "usd" });
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        const rows = scenario.writes.filter((x) => x.table === "payment_refunds");
        expect(rows).toHaveLength(1);
        // job_id stays EMPTY: this money never funded the job, and every
        // job-keyed reader (Release, the split, the settle RPCs, reconciliation)
        // would read a row on it as the job's escrow gone back (review of 5f292defa).
        // @mutate supabase/functions/stripe-webhook/handlers/refundDuplicateFunding.ts |       job_id: null, |       job_id: args.jobId,
        expect(rows[0].payload).toMatchObject({
          job_id: null, customer_id: "poster-1", stripe_refund_id: "re_dup", stripe_payment_intent_id: "pi_second",
          amount_cents: 5150, is_partial: false, source: "duplicate_funding",
          metadata: { checkout_session_id: "cs_second", job_id: "job-1", funded_nothing: true },
        });
      });

      it("a failed ledger write pages and fails the event so Stripe redelivers it (Q1819)", async () => {
        // @mutate supabase/functions/stripe-webhook/handlers/refundDuplicateFunding.ts |     throw new Error(`duplicate-funding refund ${refund.id} not ledgered: ${error.message}`); |     void 0;
        const fn = await loadConfigured();
        completed();
        scenario.writeSelectRows.jobs = [];
        scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "poster-1", payment_status: "escrow", stripe_payment_intent_id: "pi_first" }] };
        scenario.writeErrors.payment_refunds = { message: "db down" };
        stripeMock.refunds.create.mockResolvedValue({ id: "re_dup", status: "succeeded", amount: 5150, currency: "usd" });
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBeGreaterThanOrEqual(500);
        expect((slackAlerts as Array<{ title: string }>).some((a) => /Duplicate-funding refund ledger write failed/.test(a.title))).toBe(true);
      });

      it("a retry that finds several live refunds ledgers the one stamped as ours, and none when none is (Q1819)", async () => {
        // @mutate supabase/functions/stripe-webhook/handlers/refundDuplicateFunding.ts |     return live.length === 1 ? live[0] : null; |     return live[0];
        const setup = async (list: unknown[]) => {
          const fn = await loadConfigured();
          completed();
          scenario.writes.length = 0;
          scenario.writeSelectRows.jobs = [];
          scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "poster-1", payment_status: "escrow", stripe_payment_intent_id: "pi_first" }] };
          stripeMock.refunds.create.mockRejectedValue(Object.assign(new Error("already refunded"), { code: "charge_already_refunded" }));
          stripeMock.refunds.list.mockResolvedValue({ data: list, has_more: false });
          const res = await fn.fetch(webhookRequest(fn, "{}"));
          expect(res.status).toBe(200);
          return scenario.writes.filter((x) => x.table === "payment_refunds").map((r) => (r.payload as { stripe_refund_id?: string }).stripe_refund_id);
        };
        expect(await setup([
          { id: "re_other", status: "succeeded", amount: 300, currency: "usd", metadata: {} },
          { id: "re_ours", status: "succeeded", amount: 5150, currency: "usd", metadata: { source: "duplicate_funding" } },
        ])).toEqual(["re_ours"]);
        expect(await setup([
          { id: "re_a", status: "succeeded", amount: 300, currency: "usd", metadata: {} },
          { id: "re_b", status: "succeeded", amount: 4850, currency: "usd", metadata: {} },
        ])).toEqual([]);
        expect((slackAlerts as Array<{ title: string }>).some((a) => /which refund is ours is unclear/.test(a.title))).toBe(true);
      });

      it("charge.refunded still tells the payer about a duplicate-funding refund its path ledgered (Q1819)", async () => {
        // The path ledgers but does not announce; the webhook's "a path tells
        // them itself" skip must not cover it.
        // @mutate supabase/functions/stripe-webhook/handlers/chargeRefunded.ts |       .not("source", "in", "(stripe_dashboard,duplicate_funding)"); |       .neq("source", "stripe_dashboard");
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: "evt_dup_refunded",
          type: "charge.refunded",
          data: { object: { id: "ch_dup", payment_intent: "pi_second", amount: 5150, amount_refunded: 5150 } },
        });
        stripeMock.refunds.list.mockResolvedValue({ data: [{ id: "re_dup", amount: 5150, status: "succeeded", created: Math.floor(Date.now() / 1000), metadata: { source: "duplicate_funding" } }], has_more: false });
        scenario.reads.jobs = { rows: [] };
        scenario.reads.payment_refunds = { rows: [] };
        await fn.fetch(webhookRequest(fn, "{}"));
        const q = scenario.readQueries.find((r) => r.table === "payment_refunds" && r.cols.includes("source"));
        expect(q, "the path-ledger read ran").toBeDefined();
        const not = q!.filters.find((f) => f.op === "not" && f.column === "source");
        expect(String(not?.value)).toContain("duplicate_funding");
        expect(String(not?.value)).toContain("stripe_dashboard");
      });

      it("a retry after the refund key expired ledgers the live refund it finds (Q1819)", async () => {
        const fn = await loadConfigured();
        completed();
        scenario.writeSelectRows.jobs = [];
        scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "poster-1", payment_status: "escrow", stripe_payment_intent_id: "pi_first" }] };
        stripeMock.refunds.create.mockRejectedValue(Object.assign(new Error("already refunded"), { code: "charge_already_refunded" }));
        stripeMock.refunds.list.mockResolvedValue({ data: [
          { id: "re_failed", status: "failed", amount: 5150 },
          { id: "re_live", status: "succeeded", amount: 5150, currency: "usd" },
        ], has_more: false });
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        const rows = scenario.writes.filter((x) => x.table === "payment_refunds");
        expect(rows.map((r) => (r.payload as { stripe_refund_id?: string }).stripe_refund_id)).toEqual(["re_live"]);
      });

      // Q1940 (a): a late payment on a Declutter setup job cancelled for the SELLER's fault (A10) is refunded in full, and
      // the card fee Stripe kept on it is billed to the seller (declutter_setup_job_fee_debt, once per job).
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |         const sellerFeeBilledCents = await billSellerFaultDuplicate(stripe, supabase, { jobId, pi: piId }); |         const sellerFeeBilledCents = 0;
      // @mutate supabase/functions/stripe-webhook/handlers/refundDuplicateFunding.ts |   if (!(link as { seller_fault_refund_id?: string \| null } \| null)?.seller_fault_refund_id) return 0; |   if (link) return 0;
      // @mutate supabase/functions/stripe-webhook/handlers/refundDuplicateFunding.ts |     throw new Error(`declutter seller fee debt for job ${args.jobId} failed: ${debtErr.message}`); |     return 0;
      // @mutate supabase/functions/stripe-webhook/handlers/refundDuplicateFunding.ts |   const cardFeeCents = actualOrEstimatedFeeCents(charged, Number(charged.amount_received ?? charged.amount ?? 0)); |   const cardFeeCents = 0;
      describe("a late payment on a Declutter setup job cancelled for the seller's fault (Q1940 a)", () => {
        const setup = (marker: string | null) => {
          completed();
          scenario.writeSelectRows.jobs = [];
          scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "buyer-1", status: "cancelled", payment_status: "unpaid", stripe_payment_intent_id: null }] };
          scenario.reads.declutter_order_jobs = { rows: marker ? [{ seller_fault_refund_id: marker }] : [] };
          stripeMock.refunds.create.mockResolvedValue({ id: "re_dup", status: "succeeded", amount: 5150, currency: "usd" });
          stripeMock.paymentIntents.retrieve.mockResolvedValue({
            id: "pi_second", amount: 5150, amount_received: 5150,
            latest_charge: { balance_transaction: { fee: 179 } },
          });
          scenario.rpc.declutter_setup_job_fee_debt = 179;
        };
        const bills = () => (scenario.rpcCalls ?? []).filter((c) => c.name === "declutter_setup_job_fee_debt");

        it("refunds it in full and bills the seller the card fee Stripe kept", async () => {
          const fn = await loadConfigured();
          setup("dr-1");
          const res = await fn.fetch(webhookRequest(fn, "{}"));
          expect(res.status).toBe(200);
          expect(stripeMock.refunds.create).toHaveBeenCalledWith(
            { payment_intent: "pi_second", metadata: { source: "duplicate_funding" } },
            { idempotencyKey: "duplicate-funding-refund:pi_second" },
          );
          expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith("pi_second", { expand: ["latest_charge.balance_transaction"] });
          expect(bills()).toEqual([expect.objectContaining({ args: { p_job_id: "job-1", p_card_fee_cents: 179 } })]);
          expect(scenario.writes.filter((x) => x.table === "payment_refunds")).toHaveLength(1);
        });

        it("bills nothing on a job that is not a seller-fault setup job", async () => {
          const fn = await loadConfigured();
          setup(null);
          const res = await fn.fetch(webhookRequest(fn, "{}"));
          expect(res.status).toBe(200);
          expect(bills()).toHaveLength(0);
        });

        it("a failed bill pages and fails the event so Stripe redelivers (the refund is keyed)", async () => {
          const fn = await loadConfigured();
          setup("dr-1");
          scenario.rpcErrors = { declutter_setup_job_fee_debt: { message: "db down" } };
          const res = await fn.fetch(webhookRequest(fn, "{}"));
          expect(res.status).toBeGreaterThanOrEqual(500);
          expect((slackAlerts as Array<{ title: string }>).some((a) => /seller not billed for a late setup-job payment/.test(a.title))).toBe(true);
        });
      });

      it("a late redelivery of the payment that DID fund the job is ignored, never refunded", async () => {
        const fn = await loadConfigured();
        completed();
        scenario.writeSelectRows.jobs = [];
        scenario.reads.jobs = { rows: [{ id: "job-1", status: "completed", payment_status: "released", stripe_payment_intent_id: "pi_second" }] };
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      });

      it("a ledger write error after a gift was consumed still puts the gift back first (Q1819 re-review)", async () => {
        // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |         const dupRefund = await refundDuplicateFunding(stripe, piId);\n |         const dupRefund = await refundDuplicateFunding(stripe, piId);\n        await ledgerDuplicateFundingRefund(supabase, dupRefund, { jobId, customerId: null, pi: piId, sessionId: session.id });\n
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: "evt_dup_gift_ledger",
          type: "checkout.session.completed",
          data: { object: { id: "cs_diff3", mode: "payment", customer_email: "poster@test.com", payment_intent: "pi_diff3", metadata: { job_id: "job-1", gift_card_id: "gc-1" } } },
        });
        scenario.writeSelectRows.gift_cards = [{ id: "gc-1" }];
        scenario.writeSelectRows.jobs = [];
        scenario.writeErrors.payment_refunds = { message: "db down" };
        scenario.reads.jobs = { rows: [{ id: "job-1", status: "open", payment_status: "escrow", stripe_payment_intent_id: "pi_card" }] };
        stripeMock.refunds.create.mockResolvedValue({ id: "re_dup3", status: "succeeded", amount: 2000, currency: "usd" });
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBeGreaterThanOrEqual(500);
        const giftWrites = scenario.writes.filter((x) => x.table === "gift_cards" && x.op === "update");
        expect(giftWrites.map((x) => (x.payload as { status?: string }).status)).toEqual(["redeemed", "sent"]);
      });

      // Q1829: the restore after a duplicate-funding refund errored, so Stripe
      // redelivers. This delivery's consume step finds the gift already
      // 'redeemed' on the job and skips; the restore must still run when the
      // payment that funded the job was not priced with this gift, and must
      // not run when it was (that payment spent the gift legitimately).
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |                spentByThisRedelivery = fundedThisJob && (fundingMeta.gift_card_id ?? null) !== giftCardId; |                spentByThisRedelivery = false;
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |                spentByThisRedelivery = fundedThisJob && (fundingMeta.gift_card_id ?? null) !== giftCardId; |                spentByThisRedelivery = true;
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |            if (gn?.status === "redeemed" && gn.job_id === jobId) { |            if (gn?.status === "redeemed") {
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |                const fundedThisJob = fundingRow.status === "succeeded" && fundingMeta.job_id === jobId; |                const fundedThisJob = true;
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |          if (fundingPi) { |          if (true) {
      it("Q1829: a redelivery after a failed restore still puts back the gift THIS duplicate spent", async () => {
        const run = async (
          fundingMeta: Record<string, string>,
          gift: Record<string, unknown>,
          opts: { fundingStatus?: string; fundingPi?: string | null; piMissing?: boolean } = {},
        ) => {
          resetSupabaseMock(); resetStripeMock(); resetSharedMocks();
          const fn = await loadConfigured();
          stripeMock.webhooks.constructEventAsync.mockResolvedValue({
            id: "evt_dup_gift_redeliver",
            type: "checkout.session.completed",
            data: { object: { id: "cs_diff4", mode: "payment", payment_status: "paid", customer_email: "poster@test.com", payment_intent: "pi_diff4", metadata: { job_id: "job-1", gift_card_id: "gc-1" } } },
          });
          // The first consume matches nothing (already redeemed on this job).
          scenario.writeOverrides = [
            { table: "gift_cards", op: "update", when: (pl) => pl.status === "redeemed", rows: [] },
          ];
          scenario.writeSelectRows.gift_cards = [{ id: "gc-1" }];
          scenario.writeSelectRows.jobs = [];
          scenario.reads.gift_cards = { rows: [gift] };
          const fundingPi = opts.fundingPi === undefined ? "pi_card" : opts.fundingPi;
          scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "poster-1", status: "open", payment_status: "escrow", stripe_payment_intent_id: fundingPi }] };
          stripeMock.paymentIntents.retrieve.mockImplementation(async (id: string) => {
            if (id === "pi_card" && opts.piMissing) throw Object.assign(new Error("No such payment_intent"), { statusCode: 404, code: "resource_missing" });
            // Any other id (even a null one) answers like a card payment for this
            // job, so only the code's own checks keep a gift-only job's gift.
            return id === "pi_card" ? { id, status: opts.fundingStatus ?? "succeeded", metadata: fundingMeta } : { id, status: "succeeded", metadata: { job_id: "job-1" } };
          });
          stripeMock.refunds.create.mockResolvedValue({ id: "re_dup4", status: "succeeded", amount: 2000, currency: "usd" });
          const res = await fn.fetch(webhookRequest(fn, "{}"));
          const restores = scenario.writes.filter((x) => x.table === "gift_cards" && x.op === "update" && (x.payload as { status?: string }).status === "sent");
          return { res, restores };
        };
        const redeemedHere = { id: "gc-1", status: "redeemed", job_id: "job-1", payment_status: "paid" };
        // Funded by a card checkout with no gift: this duplicate spent it -> back to 'sent'.
        const card = await run({ job_id: "job-1" }, redeemedHere);
        expect(card.res.status).toBe(200);
        expect(card.restores).toHaveLength(1);
        expect(card.restores[0].filters).toContainEqual(expect.objectContaining({ column: "job_id", value: "job-1" }));
        // Funded by a checkout priced with THIS gift: it stays spent.
        const sameGift = await run({ job_id: "job-1", gift_card_id: "gc-1" }, redeemedHere);
        expect(sameGift.res.status).toBe(200);
        expect(sameGift.restores).toHaveLength(0);
        // The gift is spent on ANOTHER job: never pulled back from there.
        const elsewhere = await run({ job_id: "job-1" }, { id: "gc-1", status: "redeemed", job_id: "job-9", payment_status: "paid" });
        expect(elsewhere.res.status).toBe(200);
        expect(elsewhere.restores).toHaveLength(0);
        // Gift-only funding (no PaymentIntent on the job): the gift paid for it, kept.
        const giftOnly = await run({}, redeemedHere, { fundingPi: null });
        expect(giftOnly.res.status).toBe(200);
        expect(giftOnly.restores).toHaveLength(0);
        // A STALE intent left by a bounced bank payment (review of 4ec0dea84 #1):
        // not proof it funded the job, so the gift stays spent and ops are told.
        const stale = await run({ job_id: "job-1" }, redeemedHere, { fundingStatus: "requires_payment_method" });
        expect(stale.res.status).toBe(200);
        expect(stale.restores).toHaveLength(0);
        expect(JSON.stringify(slackAlerts)).toContain("may not be what funded it");
        // An intent for ANOTHER job's metadata is no proof either.
        const otherJob = await run({ job_id: "job-7" }, redeemedHere);
        expect(otherJob.res.status).toBe(200);
        expect(otherJob.restores).toHaveLength(0);
        expect(JSON.stringify(slackAlerts)).toContain("may not be what funded it");
        // An intent Stripe cannot find keeps the gift spent instead of retrying for days.
        const missing = await run({ job_id: "job-1" }, redeemedHere, { piMissing: true });
        expect(missing.res.status).toBe(200);
        expect(missing.restores).toHaveLength(0);
        expect(JSON.stringify(slackAlerts)).toContain("cannot be read from Stripe");
      });

      it("a gift this payment consumed is put back when the payment is refunded", async () => {
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: "evt_dup_gift",
          type: "checkout.session.completed",
          data: { object: { id: "cs_diff2", mode: "payment", customer_email: "poster@test.com", payment_intent: "pi_diff2", metadata: { job_id: "job-1", gift_card_id: "gc-1" } } },
        });
        scenario.writeSelectRows.gift_cards = [{ id: "gc-1" }];
        scenario.writeSelectRows.jobs = [];
        scenario.reads.jobs = { rows: [{ id: "job-1", status: "open", payment_status: "escrow", stripe_payment_intent_id: "pi_card" }] };
        stripeMock.refunds.create.mockResolvedValue({ id: "re_dup", status: "succeeded" });
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        const giftWrites = scenario.writes.filter((x) => x.table === "gift_cards" && x.op === "update");
        expect(giftWrites.map((x) => (x.payload as { status?: string }).status)).toEqual(["redeemed", "sent"]);
        expect(giftWrites[1].filters).toContainEqual(expect.objectContaining({ column: "job_id", value: "job-1" }));
      });

      it("a job that is gone is still the loud retry it was (never refunded blind)", async () => {
        const fn = await loadConfigured();
        completed();
        scenario.writeSelectRows.jobs = [];
        scenario.reads.jobs = { rows: [] };
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      });
    });

    // Q1417 (lh-money-escrow review, 2026-10-06): the old difference session's
    // expiry webhook can un-reserve the gift to 'sent' between create-payment's
    // re-reserve and its stamp of the new session. Paying the new session used
    // to log "already consumed or missing" and fund the job by the difference
    // alone, leaving the gift spendable again.
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |           reclaimed = !!reclaimRow; |           reclaimed = false;
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |       if (g?.status === "redeemed" && giftJobId && g.job_id === giftJobId) { |       if (true) {
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |             title: "Gift card difference payment — job underfunded", |             title: "Gift card difference payment",
    // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |     if (consumeJobId) consumeQ = consumeQ.eq("job_id", consumeJobId); |
    describe("a difference payment whose gift was un-reserved mid-checkout (Q1417)", () => {
      const isFirstConsume = (p: Record<string, unknown>) => p.status === "redeemed" && !("job_id" in p);
      async function deliver(
        gift: Record<string, unknown> | null,
        reclaimRows: Array<{ id: string }> = [{ id: "gc-1" }],
        jobRow: Record<string, unknown> = { stripe_session_id: "cs_d2", payment_status: "unpaid" },
      ) {
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: "evt_q1417",
          type: "checkout.session.completed",
          data: { object: { id: "cs_d2", mode: "payment", customer_email: "poster@test.com", payment_intent: "pi_d2", metadata: { job_id: "job-1", gift_card_id: "gc-1" } } },
        });
        scenario.writeOverrides = [
          { table: "gift_cards", op: "update", when: isFirstConsume, rows: [] },
          { table: "gift_cards", op: "update", when: (p) => p.status === "redeemed" && p.job_id === "job-1", rows: reclaimRows },
        ];
        scenario.reads.gift_cards = { rows: gift ? [gift] : [] };
        scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", ...jobRow }] };
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        const giftWrites = scenario.writes.filter((x) => x.table === "gift_cards" && x.op === "update");
        const titles = (slackAlerts as Array<{ title: string }>).map((a) => a.title);
        return { res, giftWrites, titles };
      }

      it("re-claims a gift put back to 'sent' for this job, scoped to a still-free, still-paid row", async () => {
        const { res, giftWrites, titles } = await deliver({ id: "gc-1", status: "sent", job_id: null, payment_status: "paid" });
        expect(res.status).toBe(200);
        expect(giftWrites).toHaveLength(2);
        expect(giftWrites[1].payload).toMatchObject({ status: "redeemed", job_id: "job-1" });
        expect(giftWrites[1].filters).toContainEqual(expect.objectContaining({ op: "or", value: "job_id.is.null,job_id.eq.job-1" }));
        expect(giftWrites[1].filters).toContainEqual(expect.objectContaining({ op: "eq", column: "payment_status", value: "paid" }));
        expect(titles.some((t) => /underfunded/.test(t))).toBe(false);
        expect(titles.some((t) => /re-claimed/.test(t))).toBe(true);
      });

      it("a redelivery after the gift was consumed for this job is quiet and writes nothing more", async () => {
        const { res, giftWrites, titles } = await deliver({ id: "gc-1", status: "redeemed", job_id: "job-1", payment_status: "paid" });
        expect(res.status).toBe(200);
        expect(giftWrites).toHaveLength(1);
        // The first consume only takes a reservation made for THIS job.
        expect(giftWrites[0].filters).toContainEqual(expect.objectContaining({ op: "eq", column: "job_id", value: "job-1" }));
        expect(titles.some((t) => /underfunded|re-claimed/.test(t))).toBe(false);
      });

      it("a gift spent on ANOTHER job is never taken back; ops is paged that this job is underfunded", async () => {
        const { res, giftWrites, titles } = await deliver({ id: "gc-1", status: "redeemed", job_id: "job-OTHER", payment_status: "paid" });
        expect(res.status).toBe(200);
        expect(giftWrites).toHaveLength(1);
        expect(titles).toContain("Gift card difference payment — job underfunded");
      });

      it("a revoked gift (donation refunded) is not re-claimed and pages ops", async () => {
        const { giftWrites, titles } = await deliver({ id: "gc-1", status: "sent", job_id: null, payment_status: "refunded" });
        expect(giftWrites).toHaveLength(1);
        expect(titles).toContain("Gift card difference payment — job underfunded");
      });

      it("a re-claim that loses its own race (zero rows) pages ops instead of claiming success", async () => {
        const { giftWrites, titles } = await deliver({ id: "gc-1", status: "sent", job_id: null, payment_status: "paid" }, []);
        expect(giftWrites).toHaveLength(2);
        expect(titles).toContain("Gift card difference payment — job underfunded");
      });

      // Q1491 (lh-money-escrow review of Q1417 #2): an underfunded job is held
      // so no payout path can claim it before an admin reconciles (the claim
      // trigger refuses a held job: src/test/pglite/jobPayoutHold.pglite.mjs).
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |           if (giftJobId) {\n            // No .select(): zero rows | if (false) {\n            // No .select(): zero rows
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |               throw new Error(`job_payout_holds insert failed | console.log(`job_payout_holds insert failed
      const holds = () => scenario.writes.filter((w) => w.table === "job_payout_holds");
      it.each([
        ["spent on another job", { id: "gc-1", status: "redeemed", job_id: "job-OTHER", payment_status: "paid" }],
        ["revoked", { id: "gc-1", status: "sent", job_id: null, payment_status: "refunded" }],
      ] as const)("an underfunded job (gift %s) gets a payout hold on THIS job", async (_label, gift) => {
        const { res } = await deliver({ ...gift });
        expect(res.status).toBe(200);
        expect(holds()).toHaveLength(1);
        expect(holds()[0].payload).toMatchObject({ job_id: "job-1" });
      });

      it("the harmless outcomes place no hold (re-claimed, or a redelivery)", async () => {
        await deliver({ id: "gc-1", status: "sent", job_id: null, payment_status: "paid" });
        await deliver({ id: "gc-1", status: "redeemed", job_id: "job-1", payment_status: "paid" });
        expect(holds()).toEqual([]);
      });

      it("a hold that could not be written fails the event (Stripe retries) instead of escrowing an unheld job", async () => {
        scenario.writeErrors.job_payout_holds = { message: "connection reset" };
        const { res, titles } = await deliver({ id: "gc-1", status: "redeemed", job_id: "job-OTHER", payment_status: "paid" });
        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(titles.some((t) => /payout hold FAILED/.test(t))).toBe(true);
        expect(scenario.writes.some((w) => w.table === "jobs" && (w.payload as { payment_status?: string }).payment_status === "escrow")).toBe(false);
      });

      // Q1876 (lh-money-escrow review of 6b06413c7, #5): a bounced bank debit
      // gives the gift back to 'sent' and clears the job's session. A late
      // redelivery of that bounced session's completion must not spend it again.
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |         if (reclaimable && sessionIsJobs) { |         if (reclaimable) {
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |           bouncedRedelivery = !sessionIsJobs && jr?.payment_status === "failed"; |           bouncedRedelivery = false;
      it("a redelivered completion of a BOUNCED bank checkout never re-spends the returned gift, and stays quiet", async () => {
        const { res, giftWrites, titles } = await deliver(
          { id: "gc-1", status: "sent", job_id: null, payment_status: "paid" },
          [{ id: "gc-1" }],
          { stripe_session_id: null, payment_status: "failed" },
        );
        expect(res.status).toBe(200);
        expect(giftWrites).toHaveLength(1);
        expect(titles.some((t) => /underfunded|re-claimed/.test(t))).toBe(false);
      });

      it("a checkout that is not the job's current one cannot re-claim; ops is paged", async () => {
        const { giftWrites, titles } = await deliver(
          { id: "gc-1", status: "sent", job_id: null, payment_status: "paid" },
          [{ id: "gc-1" }],
          { stripe_session_id: "cs_newer", payment_status: "unpaid" },
        );
        expect(giftWrites).toHaveLength(1);
        expect(titles).toContain("Gift card difference payment — job underfunded");
      });

      // Q1981 (lh-money-escrow review of 4ec0dea84, #3): a DUPLICATE checkout's
      // first delivery consumed the gift, was refunded, put the gift back to
      // 'sent', then failed its ledger write. Its redelivery must not re-spend
      // the gift (a spurious Q1417 page) nor page a false CRITICAL and hold a
      // job another PaymentIntent funded: the payment is refunded again (keyed)
      // and the gift is left 'sent'.
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |            sessionIsJobs = !fundedElsewhere && jr?.stripe_session_id === session.id; |            sessionIsJobs = jr?.stripe_session_id === session.id;
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |        } else if (fundedElsewhere) { |        } else if (false) {
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |            jr.stripe_payment_intent_id !== thisPi && | false &&
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |            jr.payment_status != null && !["unpaid", "failed", "abandoned"].includes(jr.payment_status); |            jr.payment_status != null;
      async function redeliverDuplicate(
        jobRow: Record<string, unknown>,
        escrowRows: Array<{ id: string }> = [],
        extraOverrides: NonNullable<typeof scenario.writeOverrides> = [],
      ) {
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: "evt_q1981",
          type: "checkout.session.completed",
          data: { object: { id: "cs_d2", mode: "payment", payment_status: "paid", customer_email: "poster@test.com", payment_intent: "pi_d2", metadata: { job_id: "job-1", gift_card_id: "gc-1" } } },
        });
        scenario.writeOverrides = [
          { table: "gift_cards", op: "update", when: isFirstConsume, rows: [] },
          { table: "gift_cards", op: "update", when: (p) => p.status === "redeemed" && p.job_id === "job-1", rows: [{ id: "gc-1" }] },
          ...extraOverrides,
        ];
        scenario.writeSelectRows.jobs = escrowRows;
        scenario.reads.gift_cards = { rows: [{ id: "gc-1", status: "sent", job_id: null, payment_status: "paid" }] };
        scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", status: "open", ...jobRow }] };
        stripeMock.refunds.create.mockResolvedValue({ id: "re_q1981", status: "succeeded", amount: 2000, currency: "usd" });
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        const giftWrites = scenario.writes.filter((x) => x.table === "gift_cards" && x.op === "update");
        const titles = (slackAlerts as Array<{ title: string }>).map((a) => a.title);
        const holds = scenario.writes.filter((w) => w.table === "job_payout_holds");
        return { res, giftWrites, titles, holds };
      }

      it.each([
        ["is the job's stamped one", "cs_d2"],
        ["is not the job's stamped one", "cs_other"],
      ] as const)("Q1981: a duplicate's redelivery whose session %s leaves the gift 'sent', pages no Q1417/underfunded alert, holds nothing", async (_l, stamped) => {
        const { res, giftWrites, titles, holds } = await redeliverDuplicate({ stripe_session_id: stamped, payment_status: "escrow", stripe_payment_intent_id: "pi_card" });
        expect(res.status).toBe(200);
        // Only the first (zero-row) consume: no re-claim, no second restore.
        expect(giftWrites).toHaveLength(1);
        expect(titles.some((t) => /re-claimed|underfunded/.test(t))).toBe(false);
        expect(holds).toEqual([]);
        // Still refunded (keyed) and ledgered by the duplicate-funding branch.
        expect(stripeMock.refunds.create).toHaveBeenCalledWith(
          { payment_intent: "pi_d2", metadata: { source: "duplicate_funding" } },
          { idempotencyKey: "duplicate-funding-refund:pi_d2" },
        );
        expect(titles).toContain("Escrow funding — a second payment on an already-funded job was refunded");
      });

      it("Q1981: a job on an unpaid or failed payment is not 'funded elsewhere' (the Q1417 re-claim still runs)", async () => {
        const { giftWrites, titles } = await redeliverDuplicate({ stripe_session_id: "cs_d2", payment_status: "failed", stripe_payment_intent_id: "pi_card" }, [{ id: "job-1" }]);
        expect(giftWrites).toHaveLength(2);
        expect(titles.some((t) => /re-claimed/.test(t))).toBe(true);
      });

      // Q1902 (a) (lh-money-escrow review of 7133adc73, #3): the Q1491 hold is written before the
      // escrow write finds the job funded by ANOTHER payment; this one is then refunded in full, so the
      // hold this session placed must not stay and block the job's legitimate payout.
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |         if (heldReason && heldReason.startsWith(`Q1491: gift card difference payment ${session.id} `)) { |         if (false) {
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |         if (heldReason && heldReason.startsWith(`Q1491: gift card difference payment ${session.id} `)) { |         if (heldReason) {
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |             throw new Error(`job_payout_holds not lifted | console.log(`job_payout_holds not lifted
      it.each([
        ["this session's underfunded hold is lifted", "Q1491: gift card difference payment cs_d2 — gift gc-1 was not reserved for this job (sent)", true],
        ["a hold for another session stays", "Q1491: gift card difference payment cs_d9 — gift gc-1 was not reserved for this job (sent)", false],
        ["a hold for another reason stays", "admin: chargeback review", false],
      ] as const)("Q1902: a duplicate-funded delivery (refunded in full): %s", async (_l, reason, lifted) => {
        scenario.reads.job_payout_holds = { rows: [{ job_id: "job-1", reason }] };
        const { res, holds, titles } = await redeliverDuplicate({ stripe_session_id: "cs_other", payment_status: "unpaid", stripe_payment_intent_id: "pi_card" });
        expect(res.status).toBe(200);
        expect(titles).toContain("Escrow funding — a second payment on an already-funded job was refunded");
        // The Q1491 hold was placed on the underfunded path first ...
        expect(holds.filter((h) => h.op !== "delete")).toHaveLength(1);
        // ... and only THIS session's hold is deleted, scoped to the job and its exact reason.
        const deletes = holds.filter((h) => h.op === "delete");
        if (lifted) {
          expect(deletes).toHaveLength(1);
          expect(deletes[0].filters).toContainEqual(expect.objectContaining({ op: "eq", column: "job_id", value: "job-1" }));
          expect(deletes[0].filters).toContainEqual(expect.objectContaining({ op: "eq", column: "reason", value: reason }));
        } else {
          expect(deletes).toEqual([]);
        }
      });

      it("Q1902: a hold lift that fails fails the event so Stripe redelivers (the refund is keyed)", async () => {
        scenario.reads.job_payout_holds = { rows: [{ job_id: "job-1", reason: "Q1491: gift card difference payment cs_d2 — gift gc-1 was not reserved for this job (sent)" }] };
        const { res } = await redeliverDuplicate(
          { stripe_session_id: "cs_other", payment_status: "unpaid", stripe_payment_intent_id: "pi_card" },
          [],
          [{ table: "job_payout_holds", op: "delete", when: () => true, error: { message: "connection reset" } }],
        );
        expect(res.status).toBeGreaterThanOrEqual(500);
      });

      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |      if (giftSkippedFundedElsewhere) { |      if (false) {
      it("Q1981: if the escrow write funds the job after all (its other payment failed in between), the underfunded hold and page still run", async () => {
        const { res, titles, holds } = await redeliverDuplicate({ stripe_session_id: "cs_other", payment_status: "escrow", stripe_payment_intent_id: "pi_card" }, [{ id: "job-1" }]);
        expect(res.status).toBe(200);
        expect(holds).toHaveLength(1);
        expect(holds[0].payload).toMatchObject({ job_id: "job-1" });
        expect(titles).toContain("Gift card difference payment — job underfunded");
      });
    });

    // Q1876 follow-up (lh-money-escrow re-review of 2cd90f553, #1): bank checkout D1's
    // first delivery consumed the gift and threw; its debit bounced, the gift
    // came back, and the poster reserved it again for D2. D1's retry must not
    // spend D2's reservation on a payment that failed.
    describe("a retried completion of a bounced bank checkout that is no longer the job's current one", () => {
      async function deliver(opts: {
        sessionPaid?: boolean;
        piStatus: string;
        jobRow: Record<string, unknown>;
      }) {
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: "evt_q1900",
          type: "checkout.session.completed",
          data: { object: {
            id: "cs_d1", mode: "payment", customer_email: "poster@test.com",
            payment_status: opts.sessionPaid ? "paid" : "unpaid", payment_intent: "pi_d1",
            metadata: { job_id: "job-1", gift_card_id: "gc-1" },
          } },
        });
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_d1", status: opts.piStatus, amount_details: { tax: { total_tax_amount: 0 } } });
        scenario.reads.gift_cards = { rows: [{ id: "gc-1", status: "reserved", job_id: "job-1", payment_status: "paid" }] };
        scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", ...opts.jobRow }] };
        scenario.writeSelectRows.gift_cards = [{ id: "gc-1" }];
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        const consumes = scenario.writes.filter(
          (w) => w.table === "gift_cards" && w.op === "update" && (w.payload as Record<string, unknown>).status === "redeemed",
        );
        const jobWrites = scenario.writes.filter((w) => w.table === "jobs");
        const titles = (slackAlerts as Array<{ title?: string }>).map((a) => a.title ?? "");
        return { res, consumes, jobWrites, titles };
      }

      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |   if (giftCardId && staleBouncedCheckout) { |   if (false) {
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |     if (notCurrent && sessionPi) { |     if (false) {
      it("leaves the gift reserved for the new checkout when another session is now the job's, and writes nothing to the job", async () => {
        const { res, consumes, jobWrites, titles } = await deliver({ piStatus: "requires_payment_method", jobRow: { stripe_session_id: "cs_d2", payment_status: "unpaid" } });
        expect(res.status).toBe(200);
        expect(consumes).toHaveLength(0);
        // Review of b837455eb (#1): the dead PaymentIntent is never stamped on the job.
        expect(jobWrites).toHaveLength(0);
        // The reservation belongs to the newer checkout: nothing to page.
        expect(titles.some((t) => /still reserved/.test(t))).toBe(false);
      });

      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | sessionPiRow?.status === "requires_payment_method" \|\| sessionPiRow?.status === "canceled"; | sessionPiRow?.status === "requires_payment_method";
      it("treats a CANCELED bank payment the same way", async () => {
        const { consumes, jobWrites } = await deliver({ piStatus: "canceled", jobRow: { stripe_session_id: "cs_d2", payment_status: "unpaid" } });
        expect(consumes).toHaveLength(0);
        expect(jobWrites).toHaveLength(0);
      });

      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |     const notCurrent = !!cj && cj.stripe_session_id !== session.id; |     const notCurrent = !!cj && !!cj.stripe_session_id && cj.stripe_session_id !== session.id;
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |     if (!staleJobHasSession && hg?.status === "reserved" && hg.job_id === staleJobId) { |     if (false) {
      it("leaves the gift alone when no session is on the job, and pages that it is still reserved there", async () => {
        const { consumes, jobWrites, titles } = await deliver({ piStatus: "requires_payment_method", jobRow: { stripe_session_id: null, payment_status: "failed" } });
        expect(consumes).toHaveLength(0);
        expect(jobWrites).toHaveLength(0);
        expect(titles).toContain("Gift card still reserved on a job whose bank payment failed");
      });

      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | sessionPiRow?.status === "requires_payment_method" \|\| sessionPiRow?.status === "canceled"; | true;
      it("still consumes when the stale bank checkout's payment is still processing (its money may yet arrive)", async () => {
        const { consumes } = await deliver({ piStatus: "processing", jobRow: { stripe_session_id: "cs_d2", payment_status: "unpaid" } });
        expect(consumes.length).toBeGreaterThan(0);
      });

      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |   if (staleJobId && session.payment_status !== "paid" && sessionType !== "tip" && kind !== "job_boost") { |   if (staleJobId && sessionType !== "tip" && kind !== "job_boost") {
      it("never skips a CARD checkout (paid): a stale-but-paid session still consumes the gift it was priced against", async () => {
        const { consumes } = await deliver({ sessionPaid: true, piStatus: "requires_payment_method", jobRow: { stripe_session_id: "cs_d2", payment_status: "unpaid" } });
        expect(consumes.length).toBeGreaterThan(0);
      });

      it("consumes as before when the bank checkout IS the job's current one", async () => {
        const { consumes } = await deliver({ piStatus: "requires_payment_method", jobRow: { stripe_session_id: "cs_d1", payment_status: "unpaid" } });
        expect(consumes.length).toBeGreaterThan(0);
      });
    });

    // Q1980 (lh-money-escrow@b837455eb#1): the same stale bounced bank checkout with NO gift. Its retry
    // used to run the job write and stamp its dead PaymentIntent over the newer checkout's, so
    // paymentIntentSucceeded (which finds the job by it) could not find the job when D2 settled.
    describe("a retried completion of a bounced plain bank checkout (no gift) that is no longer the job's current one", () => {
      async function deliver(opts: { sessionPaid?: boolean; piStatus: string; jobRow: Record<string, unknown>; metadata?: Record<string, string> }) {
        const fn = await loadConfigured();
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id: "evt_q1980",
          type: "checkout.session.completed",
          data: { object: {
            id: "cs_d1", mode: "payment", customer_email: "poster@test.com",
            payment_status: opts.sessionPaid ? "paid" : "unpaid", payment_intent: "pi_d1",
            metadata: opts.metadata ?? { job_id: "job-1" },
          } },
        });
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_d1", status: opts.piStatus, amount_details: { tax: { total_tax_amount: 0 } } });
        scenario.reads.jobs = { rows: [{ id: "job-1", customer_id: "poster-1", title: "Job", ...opts.jobRow }] };
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        const jobWrites = scenario.writes.filter((w) => w.table === "jobs");
        return { res, jobWrites };
      }

      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts |   } else if (staleBouncedCheckout) { |   } else if (false) {
      it("writes nothing to the job when another session is now the job's and the debit failed", async () => {
        const { res, jobWrites } = await deliver({ piStatus: "requires_payment_method", jobRow: { stripe_session_id: "cs_d2", payment_status: "unpaid" } });
        expect(res.status).toBe(200);
        expect(jobWrites).toHaveLength(0);
      });

      it("writes nothing when no session is on the job (the bounce cleared it) and the debit failed", async () => {
        const { jobWrites } = await deliver({ piStatus: "canceled", jobRow: { stripe_session_id: null, payment_status: "failed" } });
        expect(jobWrites).toHaveLength(0);
      });

      it("still stamps the PaymentIntent when the stale bank checkout is still processing (its money may yet arrive)", async () => {
        const { jobWrites } = await deliver({ piStatus: "processing", jobRow: { stripe_session_id: "cs_d2", payment_status: "unpaid" } });
        expect(jobWrites.some((w) => (w.payload as Record<string, unknown>).stripe_payment_intent_id === "pi_d1")).toBe(true);
      });

      it("still stamps the PaymentIntent when the bank checkout IS the job's current one", async () => {
        const { jobWrites } = await deliver({ piStatus: "requires_payment_method", jobRow: { stripe_session_id: "cs_d1", payment_status: "unpaid" } });
        expect(jobWrites.some((w) => (w.payload as Record<string, unknown>).stripe_payment_intent_id === "pi_d1")).toBe(true);
      });

      it("never skips a paid CARD checkout", async () => {
        const { jobWrites } = await deliver({ sessionPaid: true, piStatus: "requires_payment_method", jobRow: { stripe_session_id: "cs_d2", payment_status: "unpaid" } });
        expect(jobWrites.length).toBeGreaterThan(0);
      });
    });

    // Q2329: the webhook no longer writes its own "You received a tip!"; the
    // tips trigger (notify_helper_on_tip) tells the Helpr once, from the paid flip.
    it("marks a tip as paid on a tip checkout and writes no notice of its own (Q2329: the trigger tells the Helpr)", async () => {
      const fn = await loadConfigured();
      // The tip UPDATE is gated on `payment_status='pending'` and returns the
      // flipped row via `.select("id")`; the helper is notified ONLY when a row
      // actually transitioned (so a webhook redelivery of an already-paid tip
      // does not double-notify). Model the first-delivery case: one row flips.
      scenario.writeSelectRows.tips = [{ id: "tip-1" }];
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_tip",
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "payment",
            customer_email: "poster@test.com",
            metadata: {
              type: "tip",
              job_id: "job-1",
              tipper_id: "poster-1",
              helper_id: "helper-1",
            },
          },
        },
      });
      await fn.fetch(webhookRequest(fn, "{}"));
      const tipWrite = scenario.writes.find(
        (w) => w.table === "tips" && w.op === "update",
      );
      expect((tipWrite?.payload as Record<string, unknown>).payment_status).toBe(
        "paid",
      );
      expect(scenario.writes.filter((w) => w.table === "notifications")).toEqual([]);
    });

    // Q1344: a manual tip's PaymentIntent is stamped when its checkout
    // completes, so posterSpend can take a refund or chargeback of it off the
    // poster's Spent total. Only an unstamped row of this session is written.
    it("stamps the tip's PaymentIntent on its row when the checkout completes (Q1344)", async () => {
      const fn = await loadConfigured();
      scenario.writeSelectRows.tips = [{ id: "tip-1" }];
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_tip_pi",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_tip",
            mode: "payment",
            payment_intent: "pi_tip_manual",
            customer_email: "poster@test.com",
            metadata: { type: "tip", job_id: "job-1", tipper_id: "poster-1" },
          },
        },
      });
      await fn.fetch(webhookRequest(fn, "{}"));
      const stamp = scenario.writes.find(
        (w) => w.table === "tips" && w.op === "update" &&
          (w.payload as Record<string, unknown>).stripe_payment_intent_id === "pi_tip_manual",
      );
      expect(stamp, "no tips write carried the PaymentIntent").toBeDefined();
      expect(JSON.stringify(stamp?.filters)).toContain("cs_tip");
      expect(JSON.stringify(stamp?.filters)).toMatch(/stripe_payment_intent_id/);
    });

    // Q1222: a tip Checkout opened before a payout hold and paid after it. The
    // tip is a destination charge, so it reached the held Helpr. Tips are final
    // (Q781): the poster is NOT refunded; the transfer is reversed back to the
    // platform and process-scheduled-payouts re-pays it after the release.
    describe("Q1222 a tip paid while the Helpr is on a payout hold", () => {
      const heldTipEvent = (id: string) =>
        stripeMock.webhooks.constructEventAsync.mockResolvedValue({
          id,
          type: "checkout.session.completed",
          data: {
            object: {
              id: `cs_${id}`,
              mode: "payment",
              payment_intent: "pi_tip",
              customer_email: "poster@test.com",
              metadata: { type: "tip", job_id: "job-1", tipper_id: "poster-1", helper_id: "helper-1" },
            },
          },
        });
      const HOLD = { helper_id: "helper-1", reason: "review", held_at: null, denied_at: null };

      // @mutate supabase/functions/_shared/heldTipRepay.ts | if (hold.kind === "clear") { | if (true) {
      // @mutate supabase/functions/stripe-webhook/handlers/checkoutSessionCompleted.ts | const back = await holdBackPaidTip(stripe, supabase, { | const back = { kind: "not_held" } as { kind: string }; void ({
      it("reverses the transfer (no refund), records the debt, and does not tell the Helpr yet", async () => {
        const fn = await loadConfigured();
        scenario.reads.payout_holds = { rows: [HOLD] };
        scenario.reads.tips = { rows: [{ id: "tip-1" }] };
        scenario.reads.tip_hold_redrives = { rows: [] };
        scenario.writeSelectRows.tips = [{ id: "tip-1" }];
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_tip", latest_charge: { id: "ch_tip", transfer: "tr_tip" } });
        stripeMock.transfers.retrieve.mockResolvedValue({ id: "tr_tip", amount: 1500 });
        stripeMock.transfers.createReversal.mockResolvedValue({ id: "trr_tip" });
        heldTipEvent("evt_tip_held");
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        expect(stripeMock.refunds.create).not.toHaveBeenCalled();
        expect(stripeMock.transfers.createReversal).toHaveBeenCalledWith(
          "tr_tip",
          expect.objectContaining({ metadata: expect.objectContaining({ reason: "payout_hold", tip_id: "tip-1" }) }),
          { idempotencyKey: "tip-hold-reverse-tip-1" },
        );
        const claim = scenario.writes.find((w) => w.table === "tip_hold_redrives" && w.op === "insert");
        expect(claim?.payload).toMatchObject({ tip_id: "tip-1", helper_id: "helper-1", transfer_id: "tr_tip", amount_cents: 1500, status: "owed" });
        const moved = scenario.writes.find((w) => w.table === "tip_hold_redrives" && w.op === "update");
        expect(moved?.payload).toMatchObject({ status: "reversed", reversal_id: "trr_tip" });
        expect(scenario.writes.some((w) => w.table === "notifications" && (w.payload as Record<string, unknown>).user_id === "helper-1")).toBe(false);
      });

      // Q1908: the claim row records where the tip's money sits (the PaymentIntent's livemode), so the
      // re-pay runs on that mode even if an enrolment changes before the hold is released.
      // @mutate supabase/functions/_shared/heldTipRepay.ts |         stripe_mode: modeFromLivemode(pi.livemode), |         stripe_mode: null, void modeFromLivemode,
      it.each([
        [false, "test"],
        [true, "live"],
        [undefined, null],
      ])("Q1908: a PaymentIntent with livemode %s records stripe_mode %s on the claim row", async (livemode, mode) => {
        const fn = await loadConfigured();
        scenario.reads.payout_holds = { rows: [HOLD] };
        scenario.reads.tips = { rows: [{ id: "tip-1" }] };
        scenario.reads.tip_hold_redrives = { rows: [] };
        scenario.writeSelectRows.tips = [{ id: "tip-1" }];
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_tip", livemode, latest_charge: { id: "ch_tip", transfer: "tr_tip" } });
        stripeMock.transfers.retrieve.mockResolvedValue({ id: "tr_tip", amount: 1500 });
        stripeMock.transfers.createReversal.mockResolvedValue({ id: "trr_tip" });
        heldTipEvent("evt_tip_held_mode");
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        const claim = scenario.writes.find((w) => w.table === "tip_hold_redrives" && w.op === "insert");
        expect((claim?.payload as Record<string, unknown>).stripe_mode).toBe(mode);
      });

      // @mutate supabase/functions/_shared/heldTipRepay.ts | if (hold.kind === "error") throw new Error(`payout hold read failed for a paid tip | if (false) throw new Error(`payout hold read failed for a paid tip
      it("an unreadable hold fails the delivery (Stripe redelivers); nothing is reversed", async () => {
        const fn = await loadConfigured();
        scenario.reads.payout_holds = { error: { message: "connection reset", code: "08006" } };
        scenario.reads.tips = { rows: [{ id: "tip-1" }] };
        scenario.reads.tip_hold_redrives = { rows: [] };
        scenario.writeSelectRows.tips = [{ id: "tip-1" }];
        // Everything a reversal would need is there: only the unreadable hold stops it.
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_tip", latest_charge: { id: "ch_tip", transfer: "tr_tip" } });
        stripeMock.transfers.retrieve.mockResolvedValue({ id: "tr_tip", amount: 1500 });
        stripeMock.transfers.createReversal.mockResolvedValue({ id: "trr_tip" });
        heldTipEvent("evt_tip_holdread");
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled();
      });

      it("a Helpr NOT on hold: no reversal, and no webhook notice (Q2329: the tips trigger tells them)", async () => {
        const fn = await loadConfigured();
        scenario.reads.payout_holds = { rows: [] };
        scenario.reads.tips = { rows: [{ id: "tip-1" }] };
        scenario.reads.tip_hold_redrives = { rows: [] };
        scenario.writeSelectRows.tips = [{ id: "tip-1" }];
        heldTipEvent("evt_tip_clear");
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled();
        expect(scenario.writes.some((w) => w.table === "notifications" && (w.payload as Record<string, unknown>).user_id === "helper-1")).toBe(false);
      });

      // @mutate supabase/functions/_shared/heldTipRepay.ts |     if (isTransient(err)) throw err;\n    const why = message(err); |     const why = message(err);
      it("a TRANSIENT reversal fault fails the delivery (Stripe redelivers), never recorded as refused", async () => {
        const fn = await loadConfigured();
        scenario.reads.payout_holds = { rows: [HOLD] };
        scenario.reads.tips = { rows: [{ id: "tip-1" }] };
        scenario.reads.tip_hold_redrives = { rows: [] };
        scenario.writeSelectRows.tips = [{ id: "tip-1" }];
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_tip", latest_charge: { id: "ch_tip", transfer: "tr_tip" } });
        stripeMock.transfers.retrieve.mockResolvedValue({ id: "tr_tip", amount: 1500 });
        stripeMock.transfers.createReversal.mockRejectedValue(Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" }));
        heldTipEvent("evt_tip_transient");
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBeGreaterThanOrEqual(500);
        expect(scenario.writes.some((w) => w.table === "tip_hold_redrives" && (w.payload as Record<string, unknown>).status === "not_reversed")).toBe(false);
      });

      it("a refused reversal is recorded and pages critical; the delivery still acks", async () => {
        const fn = await loadConfigured();
        scenario.reads.payout_holds = { rows: [HOLD] };
        scenario.reads.tips = { rows: [{ id: "tip-1" }] };
        scenario.reads.tip_hold_redrives = { rows: [] };
        scenario.writeSelectRows.tips = [{ id: "tip-1" }];
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_tip", latest_charge: { id: "ch_tip", transfer: "tr_tip" } });
        stripeMock.transfers.retrieve.mockResolvedValue({ id: "tr_tip", amount: 1500 });
        stripeMock.transfers.createReversal.mockRejectedValue(Object.assign(new Error("insufficient funds"), { type: "StripeInvalidRequestError" }));
        heldTipEvent("evt_tip_refused");
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        expect(scenario.writes.find((w) => w.table === "tip_hold_redrives" && w.op === "update")?.payload).toMatchObject({ status: "not_reversed" });
        expect((slackAlerts as Array<{ title?: string; severity?: string }>).some((a) => a.severity === "critical" && /could not be pulled back/.test(String(a.title)))).toBe(true);
      });

      // review of Q1222: a reversal whose row update failed is found at Stripe
      // and adopted on the redelivery, never repeated (and never refused after
      // the ~24h idempotency window into a false "the Helpr has the money").
      // @mutate supabase/functions/_shared/heldTipRepay.ts |   const found = await ourReversal(stripe, a.transferId, a.tipId); |   const found = null;
      it("a redelivery whose 'owed' row Stripe already reversed adopts that reversal (no second reversal)", async () => {
        const fn = await loadConfigured();
        scenario.reads.payout_holds = { rows: [HOLD] };
        scenario.reads.tips = { rows: [{ id: "tip-1" }] };
        scenario.reads.tip_hold_redrives = { rows: [{ tip_id: "tip-1", status: "owed", transfer_id: "tr_tip", reversal_id: null }] };
        scenario.writeSelectRows.tips = [{ id: "tip-1" }];
        stripeMock.transfers.listReversals.mockResolvedValue({ data: [{ id: "trr_prev", metadata: { reason: "payout_hold", tip_id: "tip-1" } }] });
        stripeMock.transfers.createReversal.mockRejectedValue(Object.assign(new Error("idempotency window passed"), { type: "StripeInvalidRequestError" }));
        heldTipEvent("evt_tip_redeliver");
        const res = await fn.fetch(webhookRequest(fn, "{}"));
        expect(res.status).toBe(200);
        expect(stripeMock.transfers.createReversal).not.toHaveBeenCalled();
        const ups = scenario.writes.filter((w) => w.table === "tip_hold_redrives" && w.op === "update").map((w) => w.payload as Record<string, unknown>);
        expect(ups).toContainEqual(expect.objectContaining({ status: "reversed", reversal_id: "trr_prev" }));
        expect(ups.some((p) => p.status === "not_reversed")).toBe(false);
      });

      // Second review (S-D): a reversal whose row did not move pages.
      // @mutate supabase/functions/_shared/heldTipRepay.ts |   if (data && data.length > 0) return;\n  const { data: cur, error: curErr } | return;\n  const { data: cur, error: curErr }
      it("a reversal whose record matched zero rows (row gone) pages critical", async () => {
        const fn = await loadConfigured();
        scenario.reads.payout_holds = { rows: [HOLD] };
        scenario.reads.tips = { rows: [{ id: "tip-1" }] };
        scenario.reads.tip_hold_redrives = { rows: [] };
        scenario.writeSelectRows.tips = [{ id: "tip-1" }];
        scenario.writeSelectRows["tip_hold_redrives:update"] = [];
        stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_tip", latest_charge: { id: "ch_tip", transfer: "tr_tip" } });
        stripeMock.transfers.retrieve.mockResolvedValue({ id: "tr_tip", amount: 1500 });
        stripeMock.transfers.createReversal.mockResolvedValue({ id: "trr_tip" });
        heldTipEvent("evt_tip_zero");
        await fn.fetch(webhookRequest(fn, "{}"));
        expect((slackAlerts as Array<{ title?: string; severity?: string }>).some((a) => a.severity === "critical" && /did not move to 'reversed'/.test(String(a.title)))).toBe(true);
      });

      // Second review (S-E): released before the pull-back: the Helpr keeps it AND is told, once.
      // @mutate supabase/functions/_shared/heldTipRepay.ts |     if (k && k.length > 0 && source === "job") await notifyKept(supabase, args.helperId, args.jobId, args.tipperId ?? null); |
      it("a redelivery after the hold was released with no reversal at Stripe: 'kept', and the Helpr is told once", async () => {
        const fn = await loadConfigured();
        scenario.reads.payout_holds = { rows: [] };
        scenario.reads.tips = { rows: [{ id: "tip-1" }] };
        scenario.reads.tip_hold_redrives = { rows: [{ tip_id: "tip-1", status: "owed", transfer_id: "tr_tip", reversal_id: null }] };
        // A redelivery: the paid flip already happened, so it matches no row now.
        scenario.writeSelectRows["tips:update"] = [];
        heldTipEvent("evt_tip_kept");
        await fn.fetch(webhookRequest(fn, "{}"));
        expect(scenario.writes.filter((w) => w.table === "tip_hold_redrives" && w.op === "update").map((w) => w.payload)).toContainEqual(expect.objectContaining({ status: "kept" }));
        const told = scenario.writes.filter((w) => w.table === "notifications" && (w.payload as Record<string, unknown>).user_id === "helper-1");
        expect(told).toHaveLength(1);
      });

      // @mutate supabase/functions/_shared/heldTipRepay.ts |     const found = await ourReversal(stripe, String(existing.transfer_id), args.tipId); |     const found = null;
      it("a redelivery after the hold was released: an 'owed' row Stripe already reversed is 'reversed', not 'kept'", async () => {
        const fn = await loadConfigured();
        scenario.reads.payout_holds = { rows: [] };
        scenario.reads.tips = { rows: [{ id: "tip-1" }] };
        scenario.reads.tip_hold_redrives = { rows: [{ tip_id: "tip-1", status: "owed", transfer_id: "tr_tip", reversal_id: null }] };
        scenario.writeSelectRows.tips = [{ id: "tip-1" }];
        stripeMock.transfers.listReversals.mockResolvedValue({ data: [{ id: "trr_prev", metadata: { reason: "payout_hold", tip_id: "tip-1" } }] });
        heldTipEvent("evt_tip_released");
        await fn.fetch(webhookRequest(fn, "{}"));
        const ups = scenario.writes.filter((w) => w.table === "tip_hold_redrives" && w.op === "update").map((w) => w.payload as Record<string, unknown>);
        expect(ups).toContainEqual(expect.objectContaining({ status: "reversed", reversal_id: "trr_prev" }));
        expect(ups.some((p) => p.status === "kept")).toBe(false);
      });
    });

    it("does NOT re-notify the helper when a tip webhook is redelivered (no row flips)", async () => {
      const fn = await loadConfigured();
      // Duplicate delivery: the tip was already 'paid', so the conditional
      // UPDATE matches zero rows and `.select("id")` returns []. The helper
      // must NOT be notified a second time (F-WEBHOOK-03).
      scenario.writeSelectRows.tips = [];
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_tip_dup",
        type: "checkout.session.completed",
        data: {
          object: {
            mode: "payment",
            customer_email: "poster@test.com",
            metadata: {
              type: "tip",
              job_id: "job-1",
              tipper_id: "poster-1",
              helper_id: "helper-1",
            },
          },
        },
      });
      await fn.fetch(webhookRequest(fn, "{}"));
      const notif = scenario.writes.find((w) => w.table === "notifications");
      expect(notif).toBeUndefined();
    });

    it("auto-refunds a duplicate $2 onboarding fee when the flag was already set", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_dupfee",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_dup",
            mode: "payment",
            customer_email: "poster@test.com",
            payment_intent: "pi_dup",
            metadata: {
              job_id: "job-1",
              onboarding_fee_charged: "true",
              customer_id: "poster-1",
            },
          },
        },
      });
      // The atomic flip UPDATE ... WHERE onboarding_fee_paid=false matches
      // 0 rows → another path already collected the fee → refund the $2.
      scenario.writeSelectRows.profiles = [];
      stripeMock.refunds.create.mockResolvedValue({ id: "re_dup" });
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(stripeMock.refunds.create).toHaveBeenCalled();
      const refundArgs = stripeMock.refunds.create.mock.calls[0][0];
      expect(refundArgs.amount).toBe(200);
      expect(refundArgs.payment_intent).toBe("pi_dup");
    });

    it("does NOT refund when the onboarding-fee flip succeeded (this checkout was first)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_firstfee",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_first",
            mode: "payment",
            customer_email: "poster@test.com",
            payment_intent: "pi_first",
            metadata: {
              job_id: "job-1",
              onboarding_fee_charged: "true",
              customer_id: "poster-1",
            },
          },
        },
      });
      // Flip matched 1 row → this checkout legitimately collected the fee.
      scenario.writeSelectRows.profiles = [{ user_id: "poster-1" }];
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    // Q1346 (owner, 2026-10-12): the job whose checkout KEPT the setup fee
    // carries it, so the poster's Spent total and Home history count it.
    // @mutate supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts |       await stampJobSetupFee(session, posterId, { supabase, logStep }); |
    // @mutate supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts |     .update({ onboarding_fee_amount: feeCents / 100 }) |     .update({ onboarding_fee_amount: 2 })
    it("the winning checkout stamps the setup fee it kept on its job (Q1346)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_stampfee",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_stamp",
            mode: "payment",
            customer_email: "poster@test.com",
            payment_intent: "pi_stamp",
            metadata: { job_id: "job-1", onboarding_fee_charged: "true", customer_id: "poster-1", onboarding_fee_cents: "250" },
          },
        },
      });
      scenario.writeSelectRows.profiles = [{ user_id: "poster-1" }];
      await fn.fetch(webhookRequest(fn, "{}"));
      const stamps = scenario.writes.filter(
        (w) => w.table === "jobs" && w.op === "update" && "onboarding_fee_amount" in (w.payload as Record<string, unknown>),
      );
      expect(stamps.map((w) => w.payload)).toEqual([{ onboarding_fee_amount: 2.5 }]);
    });

    // @mutate supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts |   const feeCents = Number.parseInt(meta.onboarding_fee_cents ?? "", 10); |   const feeCents = Number.parseInt(meta.onboarding_fee_cents ?? "200", 10);
    it("a session with no readable fee amount is not stamped with a guess, and ops is told (Q1346)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_nofee",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_nofee",
            mode: "payment",
            customer_email: "poster@test.com",
            payment_intent: "pi_nofee",
            metadata: { job_id: "job-1", onboarding_fee_charged: "true", customer_id: "poster-1" },
          },
        },
      });
      scenario.writeSelectRows.profiles = [{ user_id: "poster-1" }];
      scenario.reads.jobs = { rows: [{ id: "job-1", is_seed: false }] };
      await fn.fetch(webhookRequest(fn, "{}"));
      const stamps = scenario.writes.filter(
        (w) => w.table === "jobs" && "onboarding_fee_amount" in ((w.payload ?? {}) as Record<string, unknown>),
      );
      expect(stamps).toEqual([]);
      const alert = (slackAlerts as Array<{ title?: string; seed?: boolean }>).find((a) => a.title === "Setup fee not recorded on its job");
      expect(alert).toBeDefined();
      // A real job's alert pages (seed false), it is not sent to the digest.
      expect(alert?.seed).toBe(false);
    });

    // A seed/E2E job's setup-fee alert goes to the daily digest, not the page
    // (alertingDetectorsDeclareSeedPolicy: the alert carries the job's is_seed).
    // @mutate supabase/functions/stripe-webhook/handlers/settleOnboardingFee.ts |   return (data as { is_seed?: boolean } \| null)?.is_seed === true; |   return false;
    it("a seed job's setup-fee alert is marked seed, from the job's is_seed (Q1346)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_nofee_seed",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_nofee_seed",
            mode: "payment",
            customer_email: "poster@test.com",
            payment_intent: "pi_nofee_seed",
            metadata: { job_id: "job-1", onboarding_fee_charged: "true", customer_id: "poster-1" },
          },
        },
      });
      scenario.writeSelectRows.profiles = [{ user_id: "poster-1" }];
      scenario.reads.jobs = { rows: [{ id: "job-1", is_seed: true }] };
      await fn.fetch(webhookRequest(fn, "{}"));
      const alert = (slackAlerts as Array<{ title?: string; seed?: boolean }>).find((a) => a.title === "Setup fee not recorded on its job");
      expect(alert?.seed).toBe(true);
    });

    it("a losing (duplicate, refunded) checkout never stamps the fee on its job (Q1346)", async () => {
      const fn = await loadConfigured();
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({
        id: "evt_nostamp",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_nostamp",
            mode: "payment",
            customer_email: "poster@test.com",
            payment_intent: "pi_nostamp",
            metadata: { job_id: "job-1", onboarding_fee_charged: "true", customer_id: "poster-1", onboarding_fee_cents: "200" },
          },
        },
      });
      scenario.writeSelectRows.profiles = [];
      stripeMock.refunds.create.mockResolvedValue({ id: "re_nostamp" });
      await fn.fetch(webhookRequest(fn, "{}"));
      expect(stripeMock.refunds.create).toHaveBeenCalled();
      const stamps = scenario.writes.filter(
        (w) => w.table === "jobs" && "onboarding_fee_amount" in ((w.payload ?? {}) as Record<string, unknown>),
      );
      expect(stamps).toEqual([]);
    });
  });
});
