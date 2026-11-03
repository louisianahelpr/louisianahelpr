/**
 * Q2399 (owner 2026-10-25): hold the poster's card when a job is posted and
 * charge it only when someone is hired. Behind card_hold_at_post. Every path,
 * on the REAL function source (the edge harness doubles Stripe and Supabase
 * with the documented API shapes):
 *
 *   POST     create-payment escrow: a job within 6 days opens a Checkout that
 *            HOLDS card and Link (capture_method manual, API 2025-09-30.clover)
 *            and still charges a bank at once; a job further out saves the card
 *            (setup mode) for a hold 4 days before its start; switch off, a
 *            quote job: today's checkout.
 *   WEBHOOK  a completed hold checkout (requires_capture) marks the job 'held'
 *            with one job_card_holds row and "Your card is on hold for $X";
 *            a bank payment on it takes today's path; a setup checkout
 *            schedules the hold; a hold on a job already funded is dropped.
 *   HIRE     create-payment capture_hold (the Helpr's accept): the hold is
 *            captured and the job moves to escrow; a hold Stripe dropped fails
 *            over to the poster ("pay again") and the Helpr hears it waits on
 *            payment; a timeout changes nothing; only the Helpr the offer
 *            names, and only a ready one, captures; the $2 setup fee is
 *            collected once.
 *   NOBODY   cancel_escrow and card-hold-sweep cancel the authorization (no
 *            refund) and tell the poster their card was not charged.
 *   SWEEP    places a due scheduled hold off-session; a $300+ one asks the
 *            poster; renews an expiring one; completes a pending accept.
 *
 * The live Stripe test-mode proof is the prod money journey after landing
 * (e2e/journeys/card-hold.journey.spec.ts, test accounts in test mode).
 *
 * @mutate supabase/functions/_shared/cardHold.ts |             await updateHold(db, jobId, { payment_intent_id: pi.id }, ["capturing"]); |             void 0;
 * @mutate supabase/functions/_shared/cardHold.ts |     } else if (hold.state === "capturing" && hold.payment_intent_id) { |     } else if (false) {
 * @mutate supabase/functions/card-hold-sweep/index.ts |             defects.record(`job ${j.id}: the poster's held card was CAPTURED but nobody is hired; complete the hire or refund the poster in full`); |             void j;
 * @mutate supabase/functions/card-hold-sweep/index.ts |             if (at === undefined \|\| !(now - at > CAPTURED_UNHIRED_GRACE_MS)) continue; |             if (at === undefined) continue;
 * @mutate supabase/functions/_shared/cardHold.ts | attempts, notified_state, failure_code, failure_message, updated_at"; | attempts, notified_state, failure_code, updated_at";
 * @mutate supabase/functions/_shared/cardHoldPlan.ts |     card: { ...(threeDS?.card ?? {}), capture_method: "manual", setup_future_usage: "off_session" }, |     card: { ...(threeDS?.card ?? {}), setup_future_usage: "off_session" },
 * @mutate supabase/functions/_shared/cardHoldPlan.ts |   if (!Number.isFinite(start) \|\| start - nowMs <= HOLD_AT_POST_WITHIN_MS) return { kind: "hold_now" }; |   return { kind: "hold_now" };
 * @mutate supabase/functions/_shared/cardHold.ts |   if (capturedPi) { |   if (false) {
 * @mutate supabase/functions/_shared/cardHold.ts |         if (!refused) return notDefinite(why, true); |         if (false) return notDefinite(why, true);
 * @mutate supabase/functions/_shared/cardHold.ts |         const refused = captureRefusal(e); |         const refused = null as string \| null;
 * @mutate supabase/functions/_shared/cardHold.ts |       const partial = amountCents < Number(hold.amount_cents); |       const partial = false;
 * @mutate supabase/functions/_shared/cardHoldPlan.ts |       line_items: [{ product_name: "Helpr job", quantity: 1, unit_cost: amountCents }], |       line_items: [{ product_name: "Helpr job", quantity: 1, unit_cost: amountCents + 200 }],
 * @mutate supabase/functions/_shared/cardHold.ts |   if (from === "authorized" && failCode !== "hold_expired") { |   if (false) {
 * @mutate supabase/functions/_shared/cardHold.ts |   return invalid && isDefinitiveStripeRefusal(e) ? `${CAPTURE_REFUSED} |   return invalid ? `${CAPTURE_REFUSED}
 * @mutate supabase/functions/_shared/cardHoldCopy.ts |     including: `, including the one-time ${fee} setup fee`, |     including: "",
 * @mutate supabase/functions/_shared/cardHold.ts |       amountCents = Number(hold.amount_cents) - (feeCents > 0 && !fee.claimed ? feeCents : 0); |       amountCents = Number(hold.amount_cents);
 * @mutate supabase/functions/_shared/cardHold.ts |     if (!claimed \|\| claimed.length === 0) return { ok: false, reason: "retry", detail: "another capture of this hold is in progress" }; |     if (false) return { ok: false, reason: "retry", detail: "another capture of this hold is in progress" };
 * @mutate supabase/functions/_shared/cardHoldPlan.ts |   if (!(amountCents < THREE_D_SECURE_MIN_CENTS)) return { ok: false, why: "large" }; |   if (false) return { ok: false, why: "large" };
 * @mutate supabase/functions/create-payment/index.ts |       if (!offerOpen && !directOpen && !seatOpen) throw new PublicError("Not authorized"); |       if (false) throw new PublicError("Not authorized");
 * @mutate supabase/functions/create-payment/index.ts |         if (!notCaptured(first.error)) return json({ state: "not_held" }); |         if (false) return json({ state: "not_held" });
 * @mutate supabase/functions/create-payment/index.ts |         if (!done.error) return json({ state: "accepted", result: done.data ?? null }); |         return json({ state: "accepted", result: done.data ?? null });
 * @mutate supabase/functions/create-payment/index.ts |       const cardHold = !payInFour && await featureEnabledForUser(supabaseAdmin, CARD_HOLD_SWITCH, user) && !(await quoteBooked()); |       const cardHold = !payInFour && await featureEnabledForUser(supabaseAdmin, CARD_HOLD_SWITCH, user);
 * @mutate supabase/functions/stripe-webhook/handlers/cardHoldCheckout.ts |     if (used === "us_bank_account" \|\| pi.status === "processing") return false; |     if (true) return false;
 * @mutate supabase/functions/create-payment/index.ts |       if (job.payment_status === "held") {\n        return new Response(JSON.stringify({\n          error: "This job's card is only on hold | if (false) {\n        return new Response(JSON.stringify({\n          error: "This job's card is only on hold
 * @mutate supabase/functions/card-hold-sweep/index.ts |   if (["cancelled", "completed"].includes(String(job.status)) && ["held", "failed", "cancelled"].includes(String(job.payment_status))) { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/cardHoldCheckout.ts |     if (!carrier && pi.status === "succeeded") { |     if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/cardHoldCheckout.ts |   if (prior && prior.payment_intent_id === pi.id && was?.stripe_payment_intent_id === pi.id && was?.payment_status === "held") { |   if (false) {
 * @mutate supabase/functions/stripe-webhook/handlers/cardHoldCheckout.ts |       if ((mine ?? []).length > 0 && !existing) { |       if (false) {
 * @mutate supabase/functions/_shared/cardHold.ts |     if (stale && stale.state === "capturing" && opts.resume) return settleClaimOnClosedJob(deps, job, stale); |
 * @mutate supabase/functions/_shared/cardHold.ts |   if (hold.capturing_from === "scheduled" && hold.payment_intent_id) { |   if (false) {
 * @mutate supabase/functions/_shared/cardHold.ts |   if (hold.capturing_from === "authorized" && hold.payment_intent_id) {\n    const pi = await stripe.paymentIntents.retrieve(hold.payment_intent_id);\n    if (pi.status === "succeeded") { |   if (hold.capturing_from === "authorized" && hold.payment_intent_id) {\n    const pi = await stripe.paymentIntents.retrieve(hold.payment_intent_id);\n    if (false) {
 * @mutate supabase/functions/create-payment/index.ts |         if (live?.state === "capturing") { |         if (false) {
 * @mutate supabase/functions/_shared/cardHold.ts |     if (job.payment_status !== "held") {\n      await updateHold(db, job.id, { state: "captured", capturing_from: null }, ["capturing"]);\n      return;\n    } |
 * @mutate supabase/functions/_shared/cardHold.ts |   await unclaimSetupFee(db, job.id, job.customer_id, hold.onboarding_fee_claimed_at);\n  // The refund webhook tells the poster | // The refund webhook tells the poster
 * @mutate supabase/functions/_shared/cardHold.ts | capture_before, place_at, attempts, notified_state, failure_code, failure_message, updated_at"; | capture_before, place_at, attempts, notified_state, updated_at";
 * @mutate supabase/functions/_shared/cardHold.ts |   const begun = hold.failure_code === "nobody_refund_pending"; |   const begun = false;
 * @mutate supabase/functions/card-hold-sweep/index.ts |   if (await helprBanInForce(db, helperId)) return false; |
 * @mutate supabase/functions/_shared/cardHold.ts |     claim = hold.payment_intent_id ? claim.eq("payment_intent_id", hold.payment_intent_id) : claim.is("payment_intent_id", null); |
 * @mutate supabase/functions/create-payment/index.ts |         if (result.already && await hiredNow()) return json({ state: "accepted", result: null }); |
 * @mutate supabase/functions/_shared/cardHold.ts |     } else if (hold.state === "capturing" && hold.payment_intent_id) { |     } else if (false) {
 * @mutate supabase/functions/_shared/cardHold.ts |       if (hold.state === "capturing" && hold.updated_at && Date.now() - Date.parse(hold.updated_at) > CHARGE_KEY_SAFE_MS) { |       if (false) {
 * @mutate supabase/functions/_shared/cardHold.ts |   if ((err?.type === "StripeInvalidRequestError" \|\| err?.type === "invalid_request_error") && isDefinitiveStripeRefusal(e)) { |   if (err?.type === "StripeInvalidRequestError" \|\| err?.type === "invalid_request_error") {
 * @mutate supabase/functions/_shared/cardHold.ts |   if ((err?.type === "StripeInvalidRequestError" \|\| err?.type === "invalid_request_error") && isDefinitiveStripeRefusal(e)) { |   if (false) {
 * @mutate supabase/functions/_shared/cardHold.ts |   if ((err?.type === "StripeInvalidRequestError" \|\| err?.type === "invalid_request_error") && isDefinitiveStripeRefusal(e)) { |   if (true) {
 * @mutate supabase/functions/card-hold-sweep/index.ts |       if (!r.already) await tellWaitingHelprsReady(db, job, defects); |
 * @mutate supabase/functions/card-hold-sweep/index.ts |     if (job.payment_status === "held") {\n      await takeFailedHoldOffListing(db, job.id); |     if (false) {\n      await takeFailedHoldOffListing(db, job.id);
 * @mutate supabase/functions/card-hold-sweep/index.ts |     if (Date.parse(hold.capture_before) <= now) defects.record( |     if (Date.parse(hold.capture_before) <= now) return; if (false) defects.record(
 * @mutate supabase/functions/_shared/cardHold.ts |     if (after?.state === "released") return "already_gone"; |     if (false) return "already_gone";
 * @mutate supabase/functions/_shared/cardHold.ts |     if (after?.state === "released") return "already_gone";\n    throw e; |     return "already_gone";
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks, slackAlerts } from "./mocks/shared";
import { CARD_HOLD_COPY } from "../../../supabase/functions/_shared/cardHoldCopy";
import { holdPlanFor, offSessionAllowed, PLACE_BEFORE_START_MS } from "../../../supabase/functions/_shared/cardHoldPlan";
import { jobLocalStartMs } from "../../../supabase/functions/_shared/cancellationFee";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { blankComments, blankSqlComments } from "../helpers/blankNonCode";

const AUTH = { Authorization: "Bearer test-jwt" };
const POSTER = { id: "poster-1", email: "poster@test.com" };
const HELPR = { id: "helpr-1", email: "helpr@test.com" };
const JOB = "11111111-1111-4111-8111-111111111111";
const ENV = {
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
  STRIPE_SECRET_KEY: "sk_test_abc123",
  STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
};

/** YYYY-MM-DD `days` from now (Louisiana's calendar is close enough for 2 vs 20 days). */
const dayFromNow = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

const updates = (table: string) => scenario.writes.filter((w) => w.table === table && w.op === "update");
const inserts = (table: string) => scenario.writes.filter((w) => w.table === table && (w.op === "insert"));
const notices = () => inserts("notifications").flatMap((w) => (Array.isArray(w.payload) ? w.payload : [w.payload]) as Array<Record<string, unknown>>);

function holdRow(extra: Record<string, unknown> = {}) {
  return {
    job_id: JOB, stripe_mode: "live", stripe_customer_id: "cus_1", payment_method_id: "pm_1", payment_intent_id: "pi_hold",
    state: "authorized", amount_cents: 4200, onboarding_fee_cents: 0, intent_metadata: { job_id: JOB, fee_model: "flat" },
    capture_before: new Date(Date.now() + 5 * 86_400_000).toISOString(), place_at: null, attempts: 0, notified_state: "authorized",
    ...extra,
  };
}

function heldJob(extra: Record<string, unknown> = {}) {
  return {
    id: JOB, customer_id: POSTER.id, title: "Mow the yard", status: "accepted", payment_status: "held",
    helper_id: HELPR.id, helper_confirmed_at: null, offered_to_helper_id: null, direct_offer_status: null,
    is_group_job: false, response_deadline: new Date(Date.now() + 86_400_000).toISOString(), category: "yard_work",
    is_seed: false, stripe_session_id: "cs_live_held", ...extra,
  };
}

describe("card hold at posting (Q2399)", () => {
  beforeEach(() => {
    resetEnv();
    resetStripeMock();
    resetSupabaseMock();
    resetSharedMocks();
    setEnv(ENV);
  });

  describe("the plan and the off-session rule", () => {
    it("holds at posting within 6 days of the start, otherwise saves the card for a hold 4 days before", () => {
      expect(holdPlanFor(dayFromNow(2), null)).toEqual({ kind: "hold_now" });
      const far = holdPlanFor(dayFromNow(20), "09:00");
      expect(far.kind).toBe("schedule");
      if (far.kind === "schedule") expect(far.placeAt.getTime()).toBe(jobLocalStartMs(dayFromNow(20), "09:00") - PLACE_BEFORE_START_MS);
    });
    it("a saved card is held off-session only under $300 and on an untaxed category (Q210b, tax)", () => {
      expect(offSessionAllowed(29_999, "yard_work")).toEqual({ ok: true });
      expect(offSessionAllowed(30_000, "yard_work")).toEqual({ ok: false, why: "large" });
      expect(offSessionAllowed(5_000, "auto_repair")).toEqual({ ok: false, why: "taxed" });
    });
    // Q2083 part 2: a job taxed by the poster's answer (an untaxed category) is
    // taxed too, so it is held on a Checkout page like a taxed category.
    // @mutate supabase/functions/_shared/cardHoldPlan.ts |   if (isLaborTaxable(category ?? null, taxKind ?? null)) return { ok: false, why: "taxed" }; |   if (isLaborTaxable(category ?? null)) return { ok: false, why: "taxed" };
    // @mutate supabase/functions/_shared/cardHold.ts | offSessionAllowed(amountCents, job.category, job.tax_kind) | offSessionAllowed(amountCents, job.category)
    it("a job taxed by the poster's answer is never held off-session (Q2083)", () => {
      expect(offSessionAllowed(5_000, "cleaning", "clothes_cleaning")).toEqual({ ok: false, why: "taxed" });
      expect(offSessionAllowed(5_000, "handyman", "item_repair")).toEqual({ ok: false, why: "taxed" });
      expect(offSessionAllowed(5_000, "cleaning", null)).toEqual({ ok: true });
      const src = readFileSync(resolve(process.cwd(), "supabase/functions/_shared/cardHold.ts"), "utf8");
      expect(src).toMatch(/offSessionAllowed\(amountCents, job\.category, job\.tax_kind\)/);
      expect(src).toMatch(/\.select\("[^"]*\btax_kind\b[^"]*"\)/);
    });
  });

  describe("POST: create-payment escrow", () => {
    function seedEscrow(opts: { switchOn: boolean; days?: number; quote?: boolean }) {
      scenario.authUser = POSTER;
      stripeMock.customers.list.mockResolvedValue({ data: [{ id: "cus_existing" }] });
      scenario.reads.jobs = {
        rows: [{ id: JOB, customer_id: POSTER.id, budget: 100, category: "yard_work", title: "Mow", status: "open",
          payment_status: "unpaid", date_needed: dayFromNow(opts.days ?? 2), start_time: null }],
      };
      scenario.reads.platform_settings = { rows: [{ customer_fee_percent: 10, helper_fee_percent: 12, onboarding_fee_cents: 200 }] };
      scenario.reads.profiles = { rows: [{ onboarding_fee_paid: true }] };
      scenario.reads.job_quote_requests = { rows: opts.quote ? [{ id: "qr-1" }] : [] };
      scenario.rpc.feature_enabled_for_user = (a?: unknown) => opts.switchOn && (a as { p_key?: string })?.p_key === "card_hold_at_post";
      stripeMock.checkout.sessions.create.mockResolvedValue({ id: "cs_live_new", url: "https://checkout.stripe.test/cs" });
    }
    async function post() {
      const fn = await loadEdgeFunction("create-payment");
      const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "escrow", jobId: JOB } }));
      const call = stripeMock.checkout.sessions.create.mock.calls[0];
      return { res, payload: JSON.parse(await res.text()), args: call?.[0] as Record<string, any> | undefined, opts: call?.[1] as Record<string, any> | undefined };
    }

    it("switch ON, a job in 2 days: card and Link are held (manual capture), a bank is charged at once", async () => {
      seedEscrow({ switchOn: true });
      const { res, payload, args, opts } = await post();
      expect(res.status).toBe(200);
      expect(payload.cardHold).toBe("hold");
      expect(args?.mode).toBe("payment");
      expect(args?.payment_method_options?.card?.capture_method).toBe("manual");
      expect(args?.payment_method_options?.link?.capture_method).toBe("manual");
      expect(args?.payment_method_options?.us_bank_account).toBeUndefined();
      expect(args?.payment_method_types).toContain("us_bank_account");
      expect(args?.metadata?.card_hold).toBe("1");
      expect(args?.payment_intent_data?.metadata?.card_hold).toBe("1");
      expect(opts?.apiVersion).toBe("2025-09-30.clover");
      expect(opts?.idempotencyKey).toMatch(/-h-b\d+$/);
    });

    it("switch OFF: today's checkout, captured at once (no capture_method, no API override)", async () => {
      seedEscrow({ switchOn: false });
      const { args, opts, payload } = await post();
      expect(payload.cardHold).toBeUndefined();
      expect(args?.payment_method_options?.card?.capture_method).toBeUndefined();
      expect(args?.payment_method_options?.link).toBeUndefined();
      // "" is unset at Stripe (as wallet_save): the webhook settles it as today's checkout.
      expect(args?.metadata?.card_hold).toBe("");
      expect(opts?.apiVersion).toBeUndefined();
    });

    it("switch ON, a job 20 days out: the card is saved (setup mode) for a hold 4 days before the start", async () => {
      seedEscrow({ switchOn: true, days: 20 });
      const { payload, args } = await post();
      expect(payload.cardHold).toBe("scheduled");
      expect(args?.mode).toBe("setup");
      expect(args?.payment_method_types).toEqual(["card", "link"]);
      expect(args?.metadata?.hold_amount_cents).toBe("10000");
      expect(Date.parse(args?.metadata?.hold_place_at)).toBe(jobLocalStartMs(dayFromNow(20), null) - PLACE_BEFORE_START_MS);
      expect(args?.custom_text?.submit?.message).toBe(CARD_HOLD_COPY.scheduled(10000));
      expect(JSON.parse(args?.metadata?.card_hold_intent).job_id).toBe(JOB);
    });

    it("a job booked from a quote is hired when paid, so it is charged at once even with the switch on", async () => {
      seedEscrow({ switchOn: true, quote: true });
      const { args, payload } = await post();
      expect(payload.cardHold).toBeUndefined();
      expect(args?.payment_method_options?.card?.capture_method).toBeUndefined();
    });
  });

  describe("HIRE: create-payment capture_hold", () => {
    function seedHire(opts: { job?: Record<string, unknown>; hold?: Record<string, unknown>; ready?: boolean; feeClaimed?: boolean } = {}) {
      scenario.authUser = HELPR;
      scenario.reads.jobs = { rows: [heldJob(opts.job)] };
      scenario.reads.job_card_holds = { rows: [holdRow(opts.hold)] };
      scenario.reads.group_job_helpers = { rows: [] };
      scenario.rpc.helper_accept_block_reason = opts.ready === false ? "helper_payout_setup_incomplete" : null;
      scenario.writeSelectRows = { jobs: [{ id: JOB }], job_card_holds: [{ job_id: JOB }], profiles: opts.feeClaimed ? [{ user_id: POSTER.id }] : [] };
      // The hire's own RPC, as the Helpr: refused uncaptured first (every other gate passed), then it completes.
      hireCalls = 0;
      const refusedFirst = { message: "payment_not_captured", code: "42501" };
      scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), get accept_job_offer() { return hireCalls++ === 0 ? refusedFirst : undefined; } } as never;
      scenario.rpc.accept_job_offer = { state: "accepted" };
    }
    let hireCalls = 0;
    async function capture(as = HELPR) {
      scenario.authUser = as;
      const fn = await loadEdgeFunction("create-payment");
      const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "capture_hold", jobId: JOB } }));
      return { res, payload: JSON.parse(await res.text()) as Record<string, unknown> };
    }

    it("the whole hire, server-side: the Helpr's own accept proves the gates, the hold is captured (claimed first), the accept completes", async () => {
      seedHire();
      stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      const { res, payload } = await capture();
      expect(res.status).toBe(200);
      expect(payload).toEqual({ state: "accepted", result: { state: "accepted" } });
      expect(hireCalls, "the hire RPC ran before AND after the capture").toBe(2);
      expect(updates("job_card_holds")[0]?.payload).toMatchObject({ state: "capturing", capturing_from: "authorized" });
      expect(updates("job_card_holds")[0]?.filters).toContainEqual({ op: "eq", column: "state", value: "authorized" });
      expect(stripeMock.paymentIntents.capture).toHaveBeenCalledWith("pi_hold", { amount_to_capture: 4200 },
        expect.objectContaining({ idempotencyKey: "card-hold-capture-pi_hold-a0" }));
      const moved = updates("jobs").find((w) => (w.payload as Record<string, unknown>).payment_status === "escrow");
      expect(moved?.payload).toMatchObject({ payment_status: "escrow", stripe_payment_intent_id: "pi_hold" });
      expect(moved?.filters).toContainEqual({ op: "eq", column: "payment_status", value: "held" });
      expect(updates("job_card_holds").some((w) => (w.payload as Record<string, unknown>).state === "captured")).toBe(true);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("a hold Stripe dropped: nothing completes, the poster is asked to pay again, the Helpr hears it waits on payment", async () => {
      seedHire();
      stripeMock.paymentIntents.capture.mockRejectedValue(Object.assign(new Error("This PaymentIntent could not be captured because it has a status of canceled."), { type: "StripeInvalidRequestError" }));
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "canceled", cancellation_reason: "automatic" });
      const { res, payload } = await capture();
      expect(res.status).toBe(409);
      expect(payload.code).toBe("payment_pending");
      expect(updates("jobs").some((w) => (w.payload as Record<string, unknown>).payment_status === "escrow")).toBe(false);
      expect(updates("jobs").find((w) => (w.payload as Record<string, unknown>).payment_status === "failed")?.payload)
        .toEqual({ payment_status: "failed", stripe_session_id: null });
      const n = notices();
      expect(n.find((x) => x.user_id === POSTER.id)?.title).toBe(CARD_HOLD_COPY.failedTitle);
      expect(n.find((x) => x.user_id === HELPR.id)?.title).toBe(CARD_HOLD_COPY.helprWaitingTitle);
      expect(JSON.stringify(n)).not.toMatch(/fee|%/i);
    });

    it("a timeout with the hold still capturable changes nothing (503, nobody told, the claim given back)", async () => {
      seedHire();
      stripeMock.paymentIntents.capture.mockRejectedValue(new Error("socket hang up"));
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "requires_capture" });
      const { res } = await capture();
      expect(res.status).toBe(503);
      expect(updates("jobs")).toHaveLength(0);
      expect(notices()).toHaveLength(0);
      expect(updates("job_card_holds").slice(-1)[0]?.payload).toMatchObject({ state: "authorized" });
    });

    it("two captures at once: the one that finds no claimable hold charges nothing (lh-money-escrow review #1)", async () => {
      seedHire();
      scenario.writeOverrides = [{ table: "job_card_holds", op: "update", when: (p) => p.state === "capturing", rows: [] }];
      const { res } = await capture();
      expect(res.status).toBe(503);
      expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    });

    it("a hire refused for another reason charges nothing; the app re-runs the RPC for its own copy", async () => {
      seedHire();
      scenario.rpcErrors = { accept_job_offer: { message: "offer_expired" } };
      const { payload } = await capture();
      expect(payload.state).toBe("not_held");
      expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
    });

    it("captured, then the hire refused in the moment between: ops is paged, the app is told", async () => {
      seedHire();
      stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      let n = 0;
      scenario.rpcErrors = { get accept_job_offer() { return n++ === 0 ? { message: "payment_not_captured" } : { message: "offer_expired" }; } } as never;
      const { res, payload } = await capture();
      expect(res.status).toBe(409);
      expect(payload.code).toBe("captured_not_hired");
      expect((slackAlerts as Array<{ title: string }>).some((a) => /captured but the hire did not complete/.test(a.title))).toBe(true);
    });

    it("CMP-4: an instant booking's early Confirm captured, then the hire refused: the sweep's path (closed for review, the refund, ONE keyed alert), never the old page", async () => {
      // @mutate supabase/functions/create-payment/index.ts |         if (directOpen && job.instant_decline_until != null) { |         if (false) {
      seedHire({ job: { status: "open", helper_id: null, offered_to_helper_id: HELPR.id, direct_offer_status: "pending", instant_decline_until: new Date(Date.now() + 3_600_000).toISOString() } });
      stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      let n = 0;
      scenario.rpcErrors = { get respond_to_direct_offer() { return n++ === 0 ? { message: "payment_not_captured" } : { message: "offer_not_active" }; } } as never;
      scenario.rpc.instant_book_captured_not_hired = true;
      scenario.reads.job_refund_claims = { rows: [] };
      const { res, payload } = await capture();
      expect(res.status).toBe(409);
      expect(payload.code).toBe("booking_ended");
      expect(String(payload.error)).toMatch(/aren't booked/);
      const ended = scenario.rpcCalls?.find((c) => c.name === "instant_book_captured_not_hired");
      expect(ended?.args).toEqual({ p_job_id: JOB, p_helper: HELPR.id });
      const alerts = slackAlerts as Array<{ title: string; message: string; oncePerDayKey?: string }>;
      const page = alerts.filter((a) => /instant booking was charged but the hire did not complete/.test(a.title));
      expect(page).toHaveLength(1);
      expect(page[0].oncePerDayKey).toBe(`instant-book-captured-not-hired:${JOB}`);
      expect(page[0].message).toMatch(/closed for review/);
      expect(alerts.some((a) => /A card hold was captured but the hire did not complete/.test(a.title))).toBe(false);
    });

    it("only the Helpr the live offer names may capture", async () => {
      seedHire();
      const { res } = await capture({ id: "stranger-1", email: "s@test.com" });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
    });

    it("an unready Helpr captures nothing: their accept is recorded pending by the RPC itself, as today", async () => {
      seedHire({ ready: false });
      scenario.rpcErrors = {};
      scenario.rpc.accept_job_offer = { state: "pending_setup", missing: ["payout_setup"] };
      const { payload } = await capture();
      expect(payload).toEqual({ state: "accepted", result: { state: "pending_setup", missing: ["payout_setup"] } });
      expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
    });

    it("the $2 setup fee: collected when this capture claims it, left out (no refund) when another job did", async () => {
      seedHire({ hold: { amount_cents: 4400, onboarding_fee_cents: 200 }, feeClaimed: false });
      stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      await capture();
      // Under the hold: the line items travel with it, or Stripe refuses (job 02a6e1b5).
      expect(stripeMock.paymentIntents.capture).toHaveBeenLastCalledWith("pi_hold", {
        amount_to_capture: 4200,
        amount_details: { enforce_arithmetic_validation: false, line_items: [{ product_name: "Helpr job", quantity: 1, unit_cost: 4200 }] },
      }, { idempotencyKey: "card-hold-capture-pi_hold-a0-partial", apiVersion: "2026-01-28.clover" });
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(updates("jobs").find((w) => (w.payload as Record<string, unknown>).payment_status === "escrow")?.payload).not.toHaveProperty("onboarding_fee_amount");

      resetStripeMock(); resetSupabaseMock(); resetSharedMocks(); setEnv(ENV);
      seedHire({ hold: { amount_cents: 4400, onboarding_fee_cents: 200 }, feeClaimed: true });
      stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      await capture();
      expect(stripeMock.paymentIntents.capture).toHaveBeenLastCalledWith("pi_hold", { amount_to_capture: 4400 }, expect.anything());
      expect(updates("jobs").find((w) => (w.payload as Record<string, unknown>).payment_status === "escrow")?.payload)
        .toMatchObject({ onboarding_fee_amount: 2 });
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    // Stripe's real refusal, measured on Stripe test (job 02a6e1b5, 2026-10-30).
    const mismatch = () => Object.assign(new Error("The total value of `amount_details` (4200) does not match the amount to capture (4000)."), { type: "StripeInvalidRequestError", statusCode: 400 });

    it("a retried capture (the amount already decided) asks Stripe for the same capture under the same key; the fee is never claimed", async () => {
      seedHire({ hold: { amount_cents: 4200, onboarding_fee_cents: 200, capture_amount_cents: 4000 } });
      stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      const { payload } = await capture();
      expect(payload.state).toBe("accepted");
      const [, params, opts] = stripeMock.paymentIntents.capture.mock.calls[0];
      expect(params.amount_to_capture).toBe(4000);
      expect(params.amount_details.line_items[0].unit_cost).toBe(4000);
      expect(opts.idempotencyKey).toBe("card-hold-capture-pi_hold-a0-partial");
      expect(updates("profiles")).toHaveLength(0);
    });

    it("a capture Stripe refuses ends clearly: recorded on the hold, logged, the hold released, both sides told, never a retry", async () => {
      seedHire({ hold: { amount_cents: 4200, onboarding_fee_cents: 200, capture_amount_cents: 4000 } });
      stripeMock.paymentIntents.capture.mockRejectedValue(mismatch());
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "requires_capture" });
      stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_hold", status: "canceled" });
      const { res, payload } = await capture();
      expect(res.status, "a real answer, not 'Couldn't reach the payment processor'").toBe(409);
      expect(payload.code).toBe("payment_pending");
      const failed = updates("job_card_holds").find((w) => (w.payload as Record<string, unknown>).state === "failed")?.payload as Record<string, unknown>;
      expect(failed).toMatchObject({ state: "failed", failure_code: "capture_refused", attempts: 1, capturing_from: null, capture_amount_cents: null });
      expect(String(failed.failure_message)).toMatch(/does not match the amount to capture/);
      expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith("pi_hold", {}, { idempotencyKey: "card-hold-drop-pi_hold" });
      expect(updates("jobs").find((w) => (w.payload as Record<string, unknown>).payment_status === "failed")?.payload).toEqual({ payment_status: "failed", stripe_session_id: null });
      const page = (slackAlerts as Array<{ title: string; severity?: string; fields?: Record<string, string> }>).find((a) => /refused a card hold's capture/.test(a.title));
      expect(page?.severity).toBe("critical");
      expect(page?.fields).toMatchObject({ job_id: JOB, code: "capture_refused", amount_cents: "4000", hold_cents: "4200" });
      const n = notices();
      expect(n.find((x) => x.user_id === POSTER.id)?.title).toBe(CARD_HOLD_COPY.captureRefusedTitle);
      expect(n.find((x) => x.user_id === POSTER.id)?.message).toBe(CARD_HOLD_COPY.captureRefused("Mow the yard"));
      expect(n.find((x) => x.user_id === HELPR.id)?.title).toBe(CARD_HOLD_COPY.helprWaitingTitle);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("a refused capture gives back the fee THIS capture claimed, so it is still owed and never paid twice", async () => {
      seedHire({ hold: { amount_cents: 4200, onboarding_fee_cents: 200 }, feeClaimed: true });
      stripeMock.paymentIntents.capture.mockRejectedValue(Object.assign(new Error("Your card was declined."), { type: "StripeCardError", code: "card_declined", statusCode: 402 }));
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "requires_capture" });
      stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_hold", status: "canceled" });
      await capture();
      expect(updates("profiles").map((w) => (w.payload as Record<string, unknown>).onboarding_fee_paid)).toEqual([true, false]);
      expect(updates("job_card_holds").find((w) => (w.payload as Record<string, unknown>).state === "failed")?.payload).toMatchObject({ failure_code: "capture_refused_card_card_declined" });
      expect((slackAlerts as Array<{ title: string; severity?: string }>).find((a) => /refused a card hold's capture/.test(a.title))?.severity).toBe("warning");
    });

    it("a seed job's refused capture stays out of the owner's alerts (seed flag on the alert)", async () => {
      seedHire({ job: { is_seed: true }, hold: { amount_cents: 4200, onboarding_fee_cents: 200, capture_amount_cents: 4000 } });
      stripeMock.paymentIntents.capture.mockRejectedValue(mismatch());
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "requires_capture" });
      stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_hold", status: "canceled" });
      await capture();
      expect((slackAlerts as Array<{ title: string; seed?: boolean }>).find((a) => /refused a card hold's capture/.test(a.title))?.seed).toBe(true);
    });

    it.each([
      ["a rate limit", { type: "StripeRateLimitError", statusCode: 429 }],
      ["a 5xx", { type: "StripeAPIError", statusCode: 500 }],
      ["a key still in use", { type: "StripeIdempotencyError", statusCode: 409, code: "idempotency_key_in_use" }],
      ["a 409 invalid request", { type: "StripeInvalidRequestError", statusCode: 409 }],
    ])("%s is NOT a refusal: the hold stays usable, nobody told", async (_label, shape) => {
      seedHire();
      stripeMock.paymentIntents.capture.mockRejectedValue(Object.assign(new Error("not an answer"), shape));
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "requires_capture" });
      const { res } = await capture();
      expect(res.status).toBe(503);
      expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
      expect(notices()).toHaveLength(0);
      expect(updates("job_card_holds").slice(-1)[0]?.payload).toMatchObject({ state: "authorized" });
    });

    it("the hold notice explains the $2: paid once, and what the second hire charges", () => {
      expect(CARD_HOLD_COPY.held(4200, 200)).toBe("Your card is on hold for $42, including the one-time $2 setup fee. You're only charged when you hire someone, and you pay the $2 once: if it's already paid by then, you're charged $40.");
      expect(CARD_HOLD_COPY.scheduled(4200, 200)).toBe("Your card is saved. We'll hold $42 about 4 days before the job, including the one-time $2 setup fee. You're only charged when you hire someone, and you pay the $2 once: if it's already paid by then, you're charged $40.");
      expect(CARD_HOLD_COPY.held(4200)).toBe("Your card is on hold for $42. You're only charged when you hire someone.");
      expect(CARD_HOLD_COPY.scheduled(4200)).toBe("Your card is saved. We'll hold $42 about 4 days before the job, and you're only charged when you hire someone.");
    });

    it("a saved card (no hold yet) under $300 is charged off-session at the hire", async () => {
      seedHire({ hold: { state: "scheduled", payment_intent_id: null, place_at: new Date(Date.now() + 86_400_000).toISOString() } });
      stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_charge", status: "succeeded" });
      const { payload } = await capture();
      expect(payload.state).toBe("accepted");
      const [params] = stripeMock.paymentIntents.create.mock.calls[0];
      expect(params).toMatchObject({ amount: 4200, off_session: true, confirm: true, payment_method: "pm_1", customer: "cus_1" });
      expect(params.metadata).toMatchObject({ job_id: JOB, card_hold: "1", card_hold_off_session: "1" });
      expect(stripeMock.paymentIntents.create.mock.calls[0][1]).toMatchObject({ idempotencyKey: `card-hold-charge-${JOB}-a0` });
    });
  });

  describe("off-session charge recorded before the job write (lh-silent-failure 2026-10-26 #2/#3)", () => {
    function seedSaved(hold: Record<string, unknown>) {
      scenario.authUser = HELPR;
      scenario.reads.jobs = { rows: [heldJob()] };
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "scheduled", payment_intent_id: null, place_at: new Date(Date.now() + 86_400_000).toISOString(), ...hold })] };
      scenario.reads.group_job_helpers = { rows: [] };
      scenario.rpc.helper_accept_block_reason = null;
      scenario.writeSelectRows = { jobs: [{ id: JOB }], job_card_holds: [{ job_id: JOB }], profiles: [] };
      // The hire's own RPC refuses uncaptured first (every other gate passed), then completes.
      let calls = 0;
      scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), get accept_job_offer() { return calls++ === 0 ? { message: "payment_not_captured", code: "42501" } : undefined; } } as never;
      scenario.rpc.accept_job_offer = { state: "accepted" };
    }
    async function sweep() {
      const fn = await loadEdgeFunction("card-hold-sweep");
      const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: {} }));
      return { res, payload: JSON.parse(await res.text()) as Record<string, any> };
    }

    it("the charge's id goes on the claimed hold row BEFORE the job moves to escrow", async () => {
      seedSaved({});
      stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_charge", status: "succeeded" });
      const fn = await loadEdgeFunction("create-payment");
      await fn.fetch(fn.request({ headers: AUTH, body: { action: "capture_hold", jobId: JOB } }));
      const order = scenario.writes.filter((w) => w.op === "update").map((w) => `${w.table}:${JSON.stringify(w.payload)}`);
      const saved = order.findIndex((x) => x.startsWith("job_card_holds:") && x.includes('"payment_intent_id":"pi_charge"'));
      const moved = order.findIndex((x) => x.startsWith("jobs:") && x.includes('"payment_status":"escrow"'));
      expect(saved).toBeGreaterThanOrEqual(0);
      expect(moved).toBeGreaterThan(saved);
    });

    it("a resumed claim whose charge was saved reads THAT charge and never creates a second one", async () => {
      seedSaved({ state: "capturing", capturing_from: "scheduled", capture_amount_cents: 4200, payment_intent_id: "pi_charge", updated_at: new Date(Date.now() - 10 * 60_000).toISOString() });
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_charge", status: "succeeded" });
      await sweep();
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect(stripeMock.paymentIntents.retrieve).toHaveBeenCalledWith("pi_charge");
      expect(updates("jobs").find((w) => (w.payload as Record<string, unknown>).payment_status === "escrow")?.payload).toMatchObject({ stripe_payment_intent_id: "pi_charge" });
    });
  });

  describe("CAPTURED, NOBODY HIRED (lh-silent-failure 2026-10-26 #4)", () => {
    async function sweep() {
      const fn = await loadEdgeFunction("card-hold-sweep");
      const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: {} }));
      return { res, payload: JSON.parse(await res.text()) as Record<string, any> };
    }
    it("a hold captured over 30 minutes ago on a job nobody is hired on is a defect every run, with no time cutoff", async () => {
      const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "captured", updated_at: old })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "open", payment_status: "escrow", helper_id: null, helper_confirmed_at: null, is_group_job: false })] };
      const { payload } = await sweep();
      expect(JSON.stringify(payload)).toContain("CAPTURED but nobody is hired");
    });
    it("a capture in the last 30 minutes (capture_hold about to run the accept) is not reported", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "captured", updated_at: new Date().toISOString() })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "open", payment_status: "escrow", helper_id: null, helper_confirmed_at: null, is_group_job: false })] };
      const { payload } = await sweep();
      expect(JSON.stringify(payload)).not.toContain("CAPTURED but nobody is hired");
    });
  });

  describe("NOBODY HIRED", () => {
    it("cancel_escrow on a held job cancels the authorization (no refund) and tells the poster their card was not charged", async () => {
      scenario.authUser = POSTER;
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null })] };
      scenario.reads.job_card_holds = { rows: [holdRow()] };
      scenario.reads.group_job_helpers = { rows: [] };
      scenario.writeSelectRows = { jobs: [{ id: JOB }], job_card_holds: [{ job_id: JOB }] };
      stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_hold", status: "canceled" });
      const fn = await loadEdgeFunction("create-payment");
      const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "cancel_escrow", jobId: JOB } }));
      const payload = JSON.parse(await res.text());
      expect(res.status).toBe(200);
      expect(payload.released).toBe(true);
      expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith("pi_hold", { cancellation_reason: "abandoned" }, expect.objectContaining({ idempotencyKey: "card-hold-release-pi_hold" }));
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(updates("jobs").find((w) => (w.payload as Record<string, unknown>).payment_status === "cancelled")).toBeTruthy();
      const told = notices().find((x) => x.user_id === POSTER.id);
      expect(told?.title).toBe(CARD_HOLD_COPY.releasedTitle);
      expect(told?.message).toBe(CARD_HOLD_COPY.released("Mow the yard"));
    });
  });

  // Q2449 (finding: lh-silent-failure@756b4e7602#9): an admin cancels a held job from Admin -> Jobs through the
  // poster's own cancel (cancel_escrow's held branch): the job closes, the hold is released (no refund), the
  // poster is told their card was not charged, and the admin is recorded. Never the refund half.
  // @mutate supabase/functions/create-payment/index.ts |         if (isAdmin !== true) throw new PublicError("Not authorized"); |         void isAdmin;
  // @mutate supabase/functions/create-payment/index.ts |         if (job.payment_status !== "held" && job.payment_status !== "failed") throw new PublicError("Not authorized"); |         void 0;
  // @mutate supabase/functions/create-payment/index.ts |       if (adminHeldCancel) {\n        return new Response(JSON.stringify({\n          error: "This job's payment was charged | if (false) {\n        return new Response(JSON.stringify({\n          error: "This job's payment was charged
  // @mutate supabase/functions/create-payment/index.ts |             adminId: user.id, action: "admin_cancel_held_job", jobId, |             adminId: user.id, action: "noop", jobId,
  describe("Q2449: an admin cancels a held job", () => {
    const ADMIN = { id: "admin-1", email: "admin@test.com" };
    function seedAdminCancel(job: Record<string, unknown> = {}, isAdmin = true) {
      scenario.authUser = ADMIN;
      scenario.rpc.has_role = isAdmin;
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null, ...job })] };
      scenario.reads.job_card_holds = { rows: [holdRow()] };
      scenario.reads.group_job_helpers = { rows: [] };
      scenario.writeSelectRows = { jobs: [{ id: JOB }], job_card_holds: [{ job_id: JOB }], admin_audit_log: [{ id: "audit-1" }] };
      stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_hold", status: "canceled" });
    }
    async function cancelAs(reason?: string) {
      const fn = await loadEdgeFunction("create-payment");
      const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "cancel_escrow", jobId: JOB, ...(reason ? { reason } : {}) } }));
      return { res, payload: JSON.parse(await res.text()) as Record<string, unknown> };
    }

    it("closes the job, releases the hold (no refund), tells the poster, and records the admin", async () => {
      seedAdminCancel();
      const { res, payload } = await cancelAs("leftover test job");
      expect(res.status).toBe(200);
      expect(payload.released).toBe(true);
      expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith("pi_hold", { cancellation_reason: "abandoned" }, expect.anything());
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(updates("jobs").find((w) => (w.payload as Record<string, unknown>).status === "cancelled")?.payload).toMatchObject({ cancelled_by: ADMIN.id });
      expect(notices().find((x) => x.user_id === POSTER.id)?.title).toBe(CARD_HOLD_COPY.releasedTitle);
      const audit = inserts("admin_audit_log").map((w) => w.payload as Record<string, unknown>);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({ admin_id: ADMIN.id, action: "admin_cancel_held_job", target_type: "job", target_id: JOB });
      expect((audit[0].details as Record<string, unknown>).reason).toBe("leftover test job");
    });

    it("someone who is neither the poster nor an admin is refused, and nothing moves", async () => {
      seedAdminCancel({}, false);
      const { payload } = await cancelAs();
      expect(String(payload.error)).toMatch(/Not authorized/);
      expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
      expect(updates("jobs")).toHaveLength(0);
    });

    it("an admin on a CHARGED job is refused here (that is Refund Poster), and nothing moves", async () => {
      seedAdminCancel({ payment_status: "escrow", stripe_payment_intent_id: "pi_paid" });
      const { payload } = await cancelAs();
      expect(String(payload.error)).toMatch(/Not authorized/);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(updates("jobs")).toHaveLength(0);
    });

    it("an admin on a failed hold the poster re-paid by bank is refused (charged money), and nothing moves", async () => {
      seedAdminCancel({ payment_status: "failed", stripe_payment_intent_id: "pi_bank" });
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "failed" })] };
      const { res, payload } = await cancelAs();
      expect(res.status).toBe(409);
      expect(String(payload.error)).toMatch(/Use Refund Poster/);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(updates("jobs")).toHaveLength(0);
    });

    it("an admin on a held job with a Helpr already on it is refused like the poster (no money moves)", async () => {
      seedAdminCancel({ status: "accepted", helper_id: HELPR.id });
      const { res } = await cancelAs();
      expect(res.status).toBe(409);
      expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
      expect(updates("jobs").length).toBeLessThan(1);
    });
  });

  describe("Q2531: the poster's cancel and the sweep release one hold at once", () => {
    async function sweep() {
      const fn = await loadEdgeFunction("card-hold-sweep");
      const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: {} }));
      return { res, payload: JSON.parse(await res.text()) as Record<string, any> };
    }
    function seed() {
      // Prod 2026-10-29 15:19Z, job 1b87e990: cancel_escrow closed the job at :00.227, the sweep read it
      // cancelled + held at :00.34 with the hold still 'authorized', and the cancel's release won.
      scenario.reads.job_card_holds = { rows: [holdRow({ notified_state: "released" })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "cancelled", helper_id: null })] };
      scenario.writeSelectRows = { jobs: [{ id: JOB }], job_card_holds: [{ job_id: JOB }] };
    }
    it("the run whose pinned update loses to the other run's release is not a defect", async () => {
      seed();
      stripeMock.paymentIntents.cancel.mockImplementation(async () => {
        // The other run finishes while this one talks to Stripe.
        scenario.reads.job_card_holds = { rows: [holdRow({ state: "released", notified_state: "released" })] };
        scenario.reads.jobs = { rows: [heldJob({ status: "cancelled", payment_status: "cancelled", helper_id: null })],
          eqOverrides: [{ column: "payment_status", value: "held", result: { rows: [] } }] };
        scenario.writeSelectRows = { ...scenario.writeSelectRows, job_card_holds: [] };
        return { id: "pi_hold", status: "canceled" };
      });
      const { res, payload } = await sweep();
      expect(JSON.stringify(payload)).not.toContain("matched 0 rows");
      expect(payload.defectReasons ?? []).toEqual([]);
      expect(payload.defects ?? 0).toBe(0);
      expect(res.status).toBe(200);
    });
    it("a pinned update that matches nothing while the hold is still open stays a defect", async () => {
      seed();
      stripeMock.paymentIntents.cancel.mockImplementation(async () => {
        scenario.writeSelectRows = { ...scenario.writeSelectRows, job_card_holds: [] };
        return { id: "pi_hold", status: "canceled" };
      });
      const { payload } = await sweep();
      expect(JSON.stringify(payload)).toContain("job_card_holds update matched 0 rows");
    });
  });

  describe("ADMIN: a held card is not refundable", () => {
    it("admin_refund_general on a held job is refused (409, cardHold), nothing claimed, no Stripe call", async () => {
      scenario.authUser = { id: "admin-1", email: "admin@test.com" };
      scenario.rpc.has_role = true;
      scenario.reads.user_roles = { rows: [{ user_id: "admin-1" }] };
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null })] };
      const fn = await loadEdgeFunction("create-payment");
      const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "admin_refund_general", jobId: JOB, reason: "goodwill" } }));
      const payload = JSON.parse(await res.text());
      expect(res.status).toBe(409);
      expect(payload.cardHold).toBe(true);
      expect(updates("jobs")).toHaveLength(0);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
    });
  });

  describe("WEBHOOK: a completed hold checkout", () => {
    async function deliver(session: Record<string, unknown>) {
      const fn = await loadEdgeFunction("stripe-webhook");
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id: `evt_${String(session.id)}`, type: "checkout.session.completed", data: { object: session } });
      const res = await fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" } }));
      return res;
    }
    const session = (extra: Record<string, unknown> = {}) => ({
      id: "cs_test_hold", livemode: false, mode: "payment", customer_email: "poster@test.com", payment_status: "unpaid",
      total_details: { amount_tax: 0 }, payment_intent: "pi_hold",
      metadata: { job_id: JOB, customer_id: POSTER.id, card_hold: "1", onboarding_fee_charged: "true", onboarding_fee_cents: "200" }, ...extra,
    });

    it("requires_capture: the job is 'held' with one authorized hold row, the poster is told the held amount, the setup fee waits for the capture", async () => {
      scenario.reads.jobs = { rows: [{ id: JOB, budget: 40, category: "yard_work", customer_fee_amount: 0, poster_fee_flat_cents: null, title: "Mow the yard", customer_id: POSTER.id, helper_id: null, helper_confirmed_at: null }] };
      scenario.reads.job_card_holds = { rows: [holdRow({ notified_state: null, amount_cents: 4200, onboarding_fee_cents: 200 })] };
      scenario.writeSelectRows = { jobs: [{ id: JOB, customer_id: POSTER.id, title: "Mow the yard", helper_id: null, helper_confirmed_at: null }] };
      const captureBefore = Math.floor(Date.now() / 1000) + 6 * 86_400;
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_hold", status: "requires_capture", amount: 4200, customer: "cus_1", payment_method: "pm_1", metadata: { job_id: JOB },
        latest_charge: { payment_method_details: { card: { capture_before: captureBefore } } },
      });
      const res = await deliver(session());
      expect(res.status).toBe(200);
      const held = updates("jobs").find((w) => (w.payload as Record<string, unknown>).payment_status === "held");
      expect(held?.payload).toMatchObject({ payment_status: "held", stripe_payment_intent_id: "pi_hold" });
      expect(updates("jobs").some((w) => (w.payload as Record<string, unknown>).payment_status === "escrow")).toBe(false);
      const row = scenario.writes.find((w) => w.table === "job_card_holds" && (w.payload as Record<string, unknown>)?.state === "authorized")?.payload as Record<string, unknown>;
      expect(row).toMatchObject({ job_id: JOB, state: "authorized", amount_cents: 4200, onboarding_fee_cents: 200, payment_intent_id: "pi_hold", stripe_mode: "test" });
      expect(row.capture_before).toBe(new Date(captureBefore * 1000).toISOString());
      expect(notices().find((x) => x.user_id === POSTER.id)?.message).toBe(CARD_HOLD_COPY.held(4200, 200));
      // the setup fee is NOT settled on a hold (it is collected at the capture)
      expect(updates("profiles").some((w) => (w.payload as Record<string, unknown>).onboarding_fee_paid === true)).toBe(false);
    });

    // Q2083 (lead review 11-02): a held job taxed by its answer stores the rate over labor + the taxed bonus.
    // @mutate supabase/functions/stripe-webhook/handlers/cardHoldCheckout.ts | .select("id, budget, category, tax_kind, customer_fee_amount, | .select("id, budget, category, customer_fee_amount,
    it("Q2083: a held job taxed by its answer (cleaning + item_repair, $100 + $50 bonus) stores 1568 / 15000", async () => {
      const job = { id: JOB, budget: 100, category: "cleaning", customer_fee_amount: 0, poster_fee_flat_cents: null, is_urgent: true, urgent_fee: 50,
        title: "Fix the mower", customer_id: POSTER.id, helper_id: null, helper_confirmed_at: null };
      // The answer arrives only for a select that names tax_kind.
      scenario.reads.jobs = { rows: [job], selectOverrides: [{ includes: "tax_kind", result: { rows: [{ ...job, tax_kind: "item_repair" }] } }] };
      scenario.reads.job_card_holds = { rows: [holdRow({ notified_state: null, amount_cents: 16_768, onboarding_fee_cents: 0 })] };
      scenario.writeSelectRows = { jobs: [{ id: JOB, customer_id: POSTER.id, title: "Fix the mower", helper_id: null, helper_confirmed_at: null }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_hold", status: "requires_capture", amount: 16_768, customer: "cus_1", payment_method: "pm_1", metadata: { job_id: JOB },
        latest_charge: { payment_method_details: { card: { capture_before: Math.floor(Date.now() / 1000) + 6 * 86_400 } } },
      });
      const res = await deliver(session({ total_details: { amount_tax: 1568 } }));
      expect(res.status).toBe(200);
      const held = updates("jobs").find((w) => (w.payload as Record<string, unknown>).payment_status === "held")?.payload as Record<string, unknown>;
      expect(held?.sales_tax_amount).toBe(15.68);
      expect(Number(held?.sales_tax_rate)).toBeCloseTo(0.1045, 3);
    });

    // Q2083 (b): a job taxed at the JOB ADDRESS charged its tax as its own line
    // (automatic_tax off, so total_details reads 0): the held job stores the
    // job-site figure from the session's job_tax_cents.
    // @mutate supabase/functions/stripe-webhook/handlers/cardHoldCheckout.ts |   const taxCents = sessionJobTaxCents(session as any); |   const taxCents = typeof session.total_details?.amount_tax === "number" ? session.total_details.amount_tax : null;
    it("Q2083 (b): a held job taxed at the job address stores its job_tax_cents, not Stripe's 0", async () => {
      const job = { id: JOB, budget: 100, category: "auto_repair", tax_kind: null, customer_fee_amount: 0, poster_fee_flat_cents: null, is_urgent: true, urgent_fee: 50,
        title: "Fix the car", customer_id: POSTER.id, helper_id: null, helper_confirmed_at: null };
      scenario.reads.jobs = { rows: [job] };
      scenario.reads.job_card_holds = { rows: [holdRow({ notified_state: null, amount_cents: 16_650, onboarding_fee_cents: 0 })] };
      scenario.writeSelectRows = { jobs: [{ id: JOB, customer_id: POSTER.id, title: "Fix the car", helper_id: null, helper_confirmed_at: null }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_hold", status: "requires_capture", amount: 16_650, customer: "cus_1", payment_method: "pm_1", metadata: { job_id: JOB },
        latest_charge: { payment_method_details: { card: { capture_before: Math.floor(Date.now() / 1000) + 6 * 86_400 } } },
      });
      const base = session();
      const res = await deliver({ ...base, total_details: { amount_tax: 0 }, metadata: { ...(base.metadata as Record<string, string>), tax_calculation_id: "taxcalc_h", job_tax_cents: "1650" } });
      expect(res.status).toBe(200);
      const held = updates("jobs").find((w) => (w.payload as Record<string, unknown>).payment_status === "held")?.payload as Record<string, unknown>;
      expect(held?.sales_tax_amount).toBe(16.5);
      expect(Number(held?.sales_tax_rate)).toBeCloseTo(0.11, 3);
      // A hold reports no tax until it is captured (payment_intent.succeeded commits it).
      expect(stripeMock.tax.transactions.createFromCalculation).not.toHaveBeenCalled();
    });

    it("a bank payment on the hold checkout (captured, not held) takes today's path", async () => {
      scenario.reads.jobs = { rows: [{ id: JOB, budget: 40, category: "yard_work", is_seed: false }] };
      scenario.writeSelectRows = { jobs: [{ id: JOB }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "processing", amount: 4200, metadata: { job_id: JOB } });
      await deliver(session());
      expect(updates("jobs").some((w) => (w.payload as Record<string, unknown>).payment_status === "held")).toBe(false);
      expect(updates("jobs").some((w) => (w.payload as Record<string, unknown>).stripe_payment_intent_id === "pi_hold")).toBe(true);
    });

    it("a redelivery after the capture (card, succeeded, the job and its hold carry it) re-settles nothing: no setup-fee step, no job write", async () => {
      scenario.reads.jobs = { rows: [{ id: JOB, budget: 40, category: "yard_work", is_seed: false, stripe_payment_intent_id: "pi_hold" }] };
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "captured" })] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "succeeded", amount: 4200, metadata: { job_id: JOB },
        latest_charge: { payment_method_details: { type: "card" } } });
      await deliver(session());
      expect(updates("jobs")).toHaveLength(0);
      expect(updates("profiles")).toHaveLength(0);
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("a hold on a job no longer waiting for one is dropped (cancelled, never refunded)", async () => {
      scenario.reads.jobs = { rows: [{ id: JOB, budget: 40, category: "yard_work" }] };
      scenario.writeSelectRows = { jobs: [] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "requires_capture", amount: 4200, metadata: {} });
      stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_hold", status: "canceled" });
      await deliver(session());
      expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith("pi_hold", { cancellation_reason: "duplicate" }, expect.anything());
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("a setup checkout (a job far out) saves the card and schedules the hold", async () => {
      const placeAt = new Date(Date.now() + 10 * 86_400_000).toISOString();
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "scheduled", payment_intent_id: null, place_at: placeAt, notified_state: null, amount_cents: 4200 })] };
      scenario.writeSelectRows = { jobs: [{ id: JOB, customer_id: POSTER.id, title: "Mow the yard" }] };
      stripeMock.setupIntents.retrieve.mockResolvedValue({ id: "seti_1", status: "succeeded", payment_method: "pm_saved", customer: "cus_1" });
      await deliver(session({ id: "cs_test_setup", mode: "setup", payment_intent: null, setup_intent: "seti_1",
        metadata: { job_id: JOB, card_hold: "1", hold_amount_cents: "4200", hold_place_at: placeAt, card_hold_intent: JSON.stringify({ job_id: JOB }) } }));
      expect(updates("jobs").find((w) => (w.payload as Record<string, unknown>).payment_status === "held")?.filters)
        .toContainEqual({ op: "eq", column: "stripe_session_id", value: "cs_test_setup" });
      const row = scenario.writes.find((w) => w.table === "job_card_holds" && (w.payload as Record<string, unknown>)?.state === "scheduled")?.payload as Record<string, unknown>;
      expect(row).toMatchObject({ state: "scheduled", payment_method_id: "pm_saved", amount_cents: 4200, place_at: placeAt });
      expect(notices().find((x) => x.user_id === POSTER.id)?.message).toBe(CARD_HOLD_COPY.scheduled(4200));
    });
  });

  describe("ROUND 2 (2026-10-25 go-live reviews)", () => {
    async function deliver(session: Record<string, unknown>) {
      const fn = await loadEdgeFunction("stripe-webhook");
      stripeMock.webhooks.constructEventAsync.mockResolvedValue({ id: `evt_${String(session.id)}`, type: "checkout.session.completed", data: { object: session } });
      return fn.fetch(fn.request({ rawBody: "{}", headers: { "stripe-signature": "t=1,v1=abc", "content-type": "application/json" } }));
    }
    const session = (extra: Record<string, unknown> = {}) => ({
      id: "cs_test_hold", livemode: false, mode: "payment", customer_email: "poster@test.com", payment_status: "paid",
      total_details: { amount_tax: 0 }, payment_intent: "pi_hold",
      metadata: { job_id: JOB, customer_id: POSTER.id, card_hold: "1", onboarding_fee_charged: "false", onboarding_fee_cents: "0" }, ...extra,
    });
    async function sweep() {
      const fn = await loadEdgeFunction("card-hold-sweep");
      const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: {} }));
      return { res, payload: JSON.parse(await res.text()) as Record<string, any> };
    }
    const stale = () => new Date(Date.now() - 10 * 60_000).toISOString();

    it("silent #1: a card payment CAPTURED at checkout that no job records is settled as a paid job (today's path) and paged, never only logged", async () => {
      scenario.reads.jobs = { rows: [{ id: JOB, budget: 40, category: "yard_work", is_seed: false }],
        eqOverrides: [{ column: "stripe_payment_intent_id", value: "pi_hold", result: { rows: [] } }] };
      scenario.writeSelectRows = { jobs: [{ id: JOB }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "succeeded", amount: 4200, metadata: { job_id: JOB },
        latest_charge: { payment_method_details: { type: "card" } } });
      await deliver(session());
      expect((slackAlerts as Array<{ title: string }>).some((a) => /charged the card instead of holding it/.test(String(a.title)))).toBe(true);
      expect(updates("jobs").some((w) => (w.payload as Record<string, unknown>).stripe_payment_intent_id === "pi_hold")).toBe(true);
    });

    it("silent #7: a redelivery of THIS hold never rewrites its row (a capture claim may be on it) nor re-sends the notice", async () => {
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null, stripe_payment_intent_id: "pi_hold", budget: 40 })] };
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "capturing", capturing_from: "authorized", capture_amount_cents: 4200 })] };
      scenario.writeSelectRows = { jobs: [{ id: JOB, customer_id: POSTER.id, title: "Mow the yard", helper_id: null, helper_confirmed_at: null }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "requires_capture", amount: 4200, metadata: {}, latest_charge: null });
      await deliver(session());
      expect(scenario.writes.some((w) => w.table === "job_card_holds" && w.op === "insert")).toBe(false);
      expect(notices()).toHaveLength(0);
    });

    it("silent #4: a setup-checkout retry after the first run marked the job held but wrote no hold row writes the row now", async () => {
      const placeAt = new Date(Date.now() + 10 * 86_400_000).toISOString();
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null, stripe_session_id: "cs_test_setup" })] };
      scenario.reads.job_card_holds = { rows: [] };
      scenario.writeSelectRows = { jobs: [] };
      stripeMock.setupIntents.retrieve.mockResolvedValue({ id: "seti_1", status: "succeeded", payment_method: "pm_saved", customer: "cus_1" });
      await deliver(session({ id: "cs_test_setup", mode: "setup", payment_intent: null, setup_intent: "seti_1",
        metadata: { job_id: JOB, card_hold: "1", hold_amount_cents: "4200", hold_place_at: placeAt, card_hold_intent: "{}" } }));
      const row = scenario.writes.find((w) => w.table === "job_card_holds" && (w.payload as Record<string, unknown>)?.state === "scheduled")?.payload as Record<string, unknown>;
      expect(row).toMatchObject({ state: "scheduled", payment_method_id: "pm_saved", amount_cents: 4200, place_at: placeAt });
    });

    it("money #1 / silent #2: a stale capture claim on a job that CLOSED, captured at Stripe: refunded in full at once, the hold leaves 'capturing'", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "capturing", capturing_from: "authorized", capture_amount_cents: 4200, updated_at: stale() })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "cancelled", helper_id: null })] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }], jobs: [{ id: JOB }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      stripeMock.refunds.create.mockResolvedValue({ id: "re_1", status: "succeeded" });
      await sweep();
      expect(stripeMock.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: "pi_hold" }), expect.objectContaining({ idempotencyKey: "card-hold-nobody-refund-pi_hold" }));
      expect(updates("job_card_holds").some((w) => (w.payload as Record<string, unknown>).state === "released")).toBe(true);
      expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
    });

    it("round 3 #1: a stale claim on a closed job whose money a HIRE already moved (cancelled after escrow) is never refunded: the row is closed as captured", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "capturing", capturing_from: "authorized", capture_amount_cents: 4200, updated_at: stale() })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "cancelled", payment_status: "cancelled", helper_confirmed_at: new Date().toISOString(), stripe_payment_intent_id: "pi_hold" })] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }], jobs: [{ id: JOB }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      await sweep();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(updates("job_card_holds").some((w) => (w.payload as Record<string, unknown>).state === "captured")).toBe(true);
    });

    it("a refund for nobody that began and then failed is retried by the next sweep (the marker is READ back, so the job's own 'cancelled' never closes it as a hire)", async () => {
      // The first run marked the hold and the job ('cancelled'), then Stripe's
      // refund threw. The marker lives in failure_code: a sweep that does not
      // select it sees a 'cancelled' job and closes the row as captured,
      // keeping the poster's money for a job nobody was hired on.
      const marked = holdRow({ state: "capturing", capturing_from: "authorized", capture_amount_cents: 4200, updated_at: stale(), failure_code: "nobody_refund_pending" });
      const unmarked = { ...(marked as Record<string, unknown>) };
      delete unmarked.failure_code;
      scenario.reads.job_card_holds = { rows: [unmarked], selectOverrides: [{ includes: "failure_code", result: { rows: [marked] } }] };
      scenario.reads.jobs = { rows: [heldJob({ status: "cancelled", payment_status: "cancelled", helper_id: null, stripe_payment_intent_id: "pi_hold" })] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }], jobs: [{ id: JOB }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      stripeMock.refunds.create.mockResolvedValue({ id: "re_1", status: "succeeded" });
      await sweep();
      expect(stripeMock.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: "pi_hold" }), expect.objectContaining({ idempotencyKey: "card-hold-nobody-refund-pi_hold" }));
      expect(updates("job_card_holds").some((w) => (w.payload as Record<string, unknown>).state === "captured")).toBe(false);
    });

    it("round 3 #2: the refund for nobody gives the $2 setup-fee claim back (the fee is owed again)", async () => {
      const at = new Date(Date.now() - 20 * 60_000).toISOString();
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "capturing", capturing_from: "authorized", capture_amount_cents: 4400, onboarding_fee_cents: 200, onboarding_fee_claimed_at: at, updated_at: stale() })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "cancelled", helper_id: null })] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }], jobs: [{ id: JOB }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      stripeMock.refunds.create.mockResolvedValue({ id: "re_1", status: "succeeded" });
      await sweep();
      expect(stripeMock.refunds.create).toHaveBeenCalled();
      const back = updates("profiles").find((w) => (w.payload as Record<string, unknown>).onboarding_fee_paid === false);
      expect(back?.filters).toContainEqual({ op: "eq", column: "onboarding_fee_charged_at", value: at });
    });

    it("round 4: a refund for nobody that began (marker set, job marked cancelled) and then failed is FINISHED on the next run, never closed as a hire", async () => {
      // The first run set failure_code 'nobody_refund_pending', marked the job's money cancelled, and
      // Stripe's refund then timed out. The resume must refund (same key), not read the cancelled
      // job as money a hire moved and close the row as captured with the poster still charged.
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "capturing", capturing_from: "authorized", capture_amount_cents: 4200, updated_at: stale(),
        failure_code: "nobody_refund_pending", failure_message: "refund of pi_hold: nobody was hired" })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "cancelled", payment_status: "cancelled", helper_id: null, stripe_payment_intent_id: "pi_hold" })] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }], jobs: [{ id: JOB }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      stripeMock.refunds.create.mockResolvedValue({ id: "re_1", status: "succeeded" });
      await sweep();
      expect(stripeMock.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: "pi_hold" }), expect.objectContaining({ idempotencyKey: "card-hold-nobody-refund-pi_hold" }));
      expect(updates("job_card_holds").some((w) => (w.payload as Record<string, unknown>).state === "captured")).toBe(false);
      expect(updates("job_card_holds").some((w) => (w.payload as Record<string, unknown>).state === "released")).toBe(true);
    });

    it("round 4: every hold read selects every HoldRow column (the refund marker was typed but never read, so a resumed refund was dropped)", () => {
      // The edge mock answers every seeded column whatever the select names, so the select list is pinned here.
      const src = blankComments(readFileSync("supabase/functions/_shared/cardHold.ts", "utf8"));
      const body = /export type HoldRow = \{([\s\S]*?)\n\};/.exec(src)?.[1] ?? "";
      const typed = [...body.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]).sort();
      const cols = (/export const HOLD_COLUMNS =\s*"([^"]+)"/.exec(src)?.[1] ?? "").split(",").map((c) => c.trim()).filter(Boolean).sort();
      expect(typed.length).toBeGreaterThan(15);
      expect(typed).toContain("failure_code");
      expect(cols).toEqual(typed);
      const sweepSrc = blankComments(readFileSync("supabase/functions/card-hold-sweep/index.ts", "utf8"));
      expect(sweepSrc.match(/from\("job_card_holds"\)\.select\(HOLD_COLUMNS\)/g)?.length ?? 0).toBeGreaterThan(1);
      expect(sweepSrc, "the sweep spells its own hold column list").not.toMatch(/"[^"]*capture_amount_cents[^"]*"/);
    });

    it("money #1 / silent #2: a stale claim on a closed job whose hold Stripe still has goes back to 'authorized' (the release then cancels it)", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "capturing", capturing_from: "authorized", capture_amount_cents: 4200, updated_at: stale() })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "cancelled", helper_id: null })] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }], jobs: [{ id: JOB }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "requires_capture" });
      await sweep();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
      expect(updates("job_card_holds").some((w) => (w.payload as Record<string, unknown>).state === "authorized")).toBe(true);
    });

    it("money #1: the poster's cancel waits while a Helpr's accept is capturing the hold (409), nothing closed or released", async () => {
      scenario.authUser = POSTER;
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null })] };
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "capturing", capturing_from: "authorized" })] };
      scenario.reads.group_job_helpers = { rows: [] };
      const fn = await loadEdgeFunction("create-payment");
      const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "cancel_escrow", jobId: JOB } }));
      expect(res.status).toBe(409);
      expect(updates("jobs").some((w) => (w.payload as Record<string, unknown>).status === "cancelled")).toBe(false);
      expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
    });

    it("silent #3: a renewal Stripe did not answer (a timeout, a 5xx) keeps the valid hold and retries; only a definite no asks the poster", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ capture_before: new Date(Date.now() + 3_600_000).toISOString() })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null })] };
      scenario.reads.job_accept_pending = { rows: [] };
      scenario.reads.crew_confirm_pending = { rows: [] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }], jobs: [{ id: JOB }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "requires_capture" });
      stripeMock.paymentIntents.create.mockRejectedValue(Object.assign(new Error("Request timed out"), { type: "StripeConnectionError" }));
      const { payload } = await sweep();
      expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
      expect(updates("jobs").some((w) => (w.payload as Record<string, unknown>).payment_status === "failed")).toBe(false);
      expect(notices()).toHaveLength(0);
      expect(JSON.stringify(payload)).toMatch(/timed out/);
    });
  });

  describe("SWEEP: card-hold-sweep", () => {
    async function sweep() {
      const fn = await loadEdgeFunction("card-hold-sweep");
      const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: {} }));
      return { res, payload: JSON.parse(await res.text()) as Record<string, any> };
    }

    it("a job closed with nobody hired: the hold is cancelled and the poster told their card was not charged", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow()] };
      scenario.reads.jobs = { rows: [heldJob({ status: "cancelled", helper_id: null })] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }] };
      stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_hold", status: "canceled" });
      const { res, payload } = await sweep();
      expect(res.status).toBe(200);
      expect(JSON.stringify(payload)).toMatch(/"released":1/);
      expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith("pi_hold", { cancellation_reason: "abandoned" }, expect.anything());
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(notices().find((x) => x.user_id === POSTER.id)?.title).toBe(CARD_HOLD_COPY.releasedTitle);
    });

    it("a due scheduled hold is placed off-session (manual capture) and recorded with its capture_before", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "scheduled", payment_intent_id: null, place_at: new Date(Date.now() - 60_000).toISOString() })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null })] };
      scenario.reads.job_accept_pending = { rows: [] };
      scenario.reads.crew_confirm_pending = { rows: [] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }], jobs: [{ id: JOB }] };
      const cb = Math.floor(Date.now() / 1000) + 4 * 86_400;
      stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_placed", status: "requires_capture", amount: 4200, latest_charge: { payment_method_details: { card: { capture_before: cb } } } });
      const { payload } = await sweep();
      expect(JSON.stringify(payload)).toMatch(/"placed":1/);
      const [params] = stripeMock.paymentIntents.create.mock.calls[0];
      expect(params).toMatchObject({ amount: 4200, capture_method: "manual", off_session: true, confirm: true, payment_method: "pm_1" });
      expect(updates("job_card_holds").find((w) => (w.payload as Record<string, unknown>).state === "authorized")?.payload)
        .toMatchObject({ payment_intent_id: "pi_placed", capture_before: new Date(cb * 1000).toISOString() });
    });

    it("a due scheduled hold of $300 or more is never placed off-session: the poster is asked to confirm, nobody can be hired", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "scheduled", payment_intent_id: null, amount_cents: 35_000, place_at: new Date(Date.now() - 60_000).toISOString(), notified_state: "scheduled" })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null })] };
      scenario.reads.job_accept_pending = { rows: [] };
      scenario.reads.crew_confirm_pending = { rows: [] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }] };
      await sweep();
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect(updates("jobs").find((w) => (w.payload as Record<string, unknown>).payment_status === "failed")).toBeTruthy();
      expect(notices().find((x) => x.user_id === POSTER.id)?.title).toBe(CARD_HOLD_COPY.confirmTitle);
    });

    // Q2083 (lead review 11-02): a job taxed by the poster's ANSWER (an untaxed category) is held on a
    // Checkout page exactly like a taxed category; dropping the kind from either sweep check placed it off-session.
    // @mutate supabase/functions/card-hold-sweep/index.ts |   if (hold.state === "scheduled" && hold.place_at && Date.parse(hold.place_at) <= now) {\n    const allowed = offSessionAllowed(hold.amount_cents, job.category, job.tax_kind); |   if (hold.state === "scheduled" && hold.place_at && Date.parse(hold.place_at) <= now) {\n    const allowed = offSessionAllowed(hold.amount_cents, job.category);
    // @mutate supabase/functions/card-hold-sweep/index.ts |     if (Date.parse(hold.capture_before) <= now) defects.record(`job ${hold.job_id}: hold ${oldPi} is past its recorded capture_before and still capturable; renewing it now`);\n    const allowed = offSessionAllowed(hold.amount_cents, job.category, job.tax_kind); |     if (Date.parse(hold.capture_before) <= now) defects.record(`job ${hold.job_id}: hold ${oldPi} is past its recorded capture_before and still capturable; renewing it now`);\n    const allowed = offSessionAllowed(hold.amount_cents, job.category);
    it("Q2083: a due scheduled hold on a job taxed by its answer (cleaning + item_repair) is never placed off-session", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "scheduled", payment_intent_id: null, place_at: new Date(Date.now() - 60_000).toISOString(), notified_state: "scheduled" })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null, category: "cleaning", tax_kind: "item_repair" })] };
      scenario.reads.job_accept_pending = { rows: [] };
      scenario.reads.crew_confirm_pending = { rows: [] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }] };
      stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_placed", status: "requires_capture", amount: 4200, latest_charge: null });
      await sweep();
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect(updates("job_card_holds").some((w) => (w.payload as Record<string, unknown>).failure_code === "taxed_on_session")).toBe(true);
    });

    it("Q2083: an expiring hold on a job taxed by its answer is not renewed off-session", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ capture_before: new Date(Date.now() + 3_600_000).toISOString() })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null, category: "cleaning", tax_kind: "fabric_cleaning" })] };
      scenario.reads.job_accept_pending = { rows: [] };
      scenario.reads.crew_confirm_pending = { rows: [] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }], jobs: [{ id: JOB }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "requires_capture" });
      stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_renewed", status: "requires_capture", amount: 4200, latest_charge: null });
      stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_hold", status: "canceled" });
      await sweep();
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect(updates("job_card_holds").some((w) => (w.payload as Record<string, unknown>).failure_code === "taxed_on_session")).toBe(true);
    });

    it("a pending accept whose Helpr is ready now: captured, then completed through complete_job_accept", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow()] };
      scenario.reads.jobs = { rows: [heldJob()] };
      scenario.reads.job_accept_pending = { rows: [{ helper_id: HELPR.id }] };
      scenario.rpc.helper_accept_block_reason = null;
      scenario.rpc.complete_job_accept = true;
      scenario.writeSelectRows = { jobs: [{ id: JOB }], job_card_holds: [{ job_id: JOB }], profiles: [] };
      stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      const { payload } = await sweep();
      expect(JSON.stringify(payload)).toMatch(/"completed":1/);
      expect(stripeMock.paymentIntents.capture).toHaveBeenCalled();
      expect(scenario.rpcCalls?.some((c) => c.name === "complete_job_accept")).toBe(true);
    });

    it("an authorization near its expiry is renewed off-session and the old one cancelled", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ capture_before: new Date(Date.now() + 3_600_000).toISOString() })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null })] };
      scenario.reads.job_accept_pending = { rows: [] };
      scenario.reads.crew_confirm_pending = { rows: [] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }], jobs: [{ id: JOB }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "requires_capture" });
      stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_renewed", status: "requires_capture", amount: 4200, latest_charge: null });
      stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_hold", status: "canceled" });
      const { payload } = await sweep();
      expect(JSON.stringify(payload)).toMatch(/"renewed":1/);
      expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith("pi_hold", { cancellation_reason: "abandoned" }, expect.anything());
    });

    it("renewal reads Stripe first: a hold already captured there is paged, nothing new is placed (review #6c)", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ capture_before: new Date(Date.now() + 3_600_000).toISOString() })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null })] };
      scenario.reads.job_accept_pending = { rows: [] };
      scenario.reads.crew_confirm_pending = { rows: [] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      await sweep();
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect((slackAlerts as Array<{ title: string }>).some((a) => /captured at Stripe but the job still reads held/.test(a.title))).toBe(true);
    });

    it("a placed hold whose row moved meanwhile (a capture) is cancelled, never written over it (review #7)", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "scheduled", payment_intent_id: null, place_at: new Date(Date.now() - 60_000).toISOString() })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null })] };
      scenario.reads.job_accept_pending = { rows: [] };
      scenario.reads.crew_confirm_pending = { rows: [] };
      scenario.writeOverrides = [{ table: "job_card_holds", op: "update", when: (p) => p.payment_intent_id === "pi_placed", rows: [] }];
      stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_placed", status: "requires_capture", amount: 4200, latest_charge: null });
      stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_placed", status: "canceled" });
      const { payload } = await sweep();
      expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith("pi_placed", { cancellation_reason: "duplicate" }, expect.anything());
      expect(JSON.stringify(payload)).not.toMatch(/"placed":1/);
    });

    it("a hold whose job was paid another way is closed (its authorization cancelled), so it never clogs the sweep (review #8)", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow()] };
      scenario.reads.jobs = { rows: [heldJob({ status: "open", payment_status: "escrow", stripe_payment_intent_id: "pi_bank" })] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }] };
      stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_hold", status: "canceled" });
      const { payload } = await sweep();
      expect(JSON.stringify(payload)).toMatch(/"reconciled":1/);
      expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith("pi_hold", { cancellation_reason: "duplicate" }, expect.anything());
      expect(notices()).toHaveLength(0);
    });
  });
  // Round 4 (2026-10-25 card-hold-builder reviews, lh-money-escrow + lh-silent-failure).
  describe("ROUND 4", () => {
    const old = (ms: number) => new Date(Date.now() - ms).toISOString();
    async function sweep() {
      const fn = await loadEdgeFunction("card-hold-sweep");
      const res = await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: {} }));
      return { res, payload: JSON.parse(await res.text()) as Record<string, any> };
    }
    async function capture() {
      scenario.authUser = HELPR;
      const fn = await loadEdgeFunction("create-payment");
      const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "capture_hold", jobId: JOB } }));
      return { res, payload: JSON.parse(await res.text()) as Record<string, unknown> };
    }
    function seedHire(hold: Record<string, unknown> = {}, secondHireError?: { message: string; code?: string }) {
      scenario.authUser = HELPR;
      scenario.reads.jobs = { rows: [heldJob()] };
      scenario.reads.job_card_holds = { rows: [holdRow(hold)] };
      scenario.reads.group_job_helpers = { rows: [] };
      scenario.rpc.helper_accept_block_reason = null;
      scenario.writeSelectRows = { jobs: [{ id: JOB }], job_card_holds: [{ job_id: JOB }], profiles: [] };
      let calls = 0;
      const refusedFirst = { message: "payment_not_captured", code: "42501" };
      scenario.rpcErrors = { ...(scenario.rpcErrors ?? {}), get accept_job_offer() { return calls++ === 0 ? refusedFirst : secondHireError; } } as never;
      scenario.rpc.accept_job_offer = { state: "accepted" };
    }
    const stripeErr = (message: string, fields: Record<string, unknown>) => Object.assign(new Error(message), fields);

    it("money #2: the sweep never charges for a BANNED Helpr's pending accept (complete_job_accept skips the ban gate)", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow()] };
      scenario.reads.jobs = { rows: [heldJob()] };
      scenario.reads.job_accept_pending = { rows: [{ helper_id: HELPR.id }] };
      scenario.reads.crew_confirm_pending = { rows: [] };
      scenario.reads.profiles = { rows: [{ user_id: HELPR.id, ban_status: "temp_banned", auto_suspended_until: new Date(Date.now() + 86_400_000).toISOString() }] };
      scenario.rpc.helper_accept_block_reason = null;
      scenario.rpc.complete_job_accept = true;
      scenario.writeSelectRows = { jobs: [{ id: JOB }], job_card_holds: [{ job_id: JOB }], profiles: [] };
      stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      const { payload } = await sweep();
      expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
      expect(scenario.rpcCalls?.some((c) => c.name === "complete_job_accept")).toBe(false);
      expect(JSON.stringify(payload)).not.toMatch(/"completed":1/);
    });

    it("money #2: a temp ban that has run out completes as before", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow()] };
      scenario.reads.jobs = { rows: [heldJob()] };
      scenario.reads.job_accept_pending = { rows: [{ helper_id: HELPR.id }] };
      scenario.reads.profiles = { rows: [{ user_id: HELPR.id, ban_status: "temp_banned", auto_suspended_until: old(60_000) }] };
      scenario.rpc.helper_accept_block_reason = null;
      scenario.rpc.complete_job_accept = true;
      scenario.writeSelectRows = { jobs: [{ id: JOB }], job_card_holds: [{ job_id: JOB }], profiles: [] };
      stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      const { payload } = await sweep();
      expect(JSON.stringify(payload)).toMatch(/"completed":1/);
    });

    it("money #3: a FAILED hold's closed job keeps 'failed' (a reserved gift comes back on its checkout's expiry); only 'held' is marked cancelled", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "failed", notified_state: "failed" })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "cancelled", payment_status: "failed", helper_id: null, stripe_payment_intent_id: null })] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }], jobs: [] };
      await sweep();
      const mark = updates("jobs").find((w) => (w.payload as Record<string, unknown>).payment_status === "cancelled");
      expect(mark?.filters).toContainEqual({ op: "eq", column: "payment_status", value: "held" });
      expect(JSON.stringify(mark?.filters)).not.toMatch(/"failed"/);
      expect(stripeMock.paymentIntents.cancel).not.toHaveBeenCalled();
      expect(updates("job_card_holds").some((w) => (w.payload as Record<string, unknown>).state === "released")).toBe(true);
    });

    it("money #5: the capture claim is pinned to the authorization it read (a renewal that swapped it is never captured)", async () => {
      seedHire();
      stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      await capture();
      expect(updates("job_card_holds")[0]?.filters).toContainEqual({ op: "eq", column: "payment_intent_id", value: "pi_hold" });
    });

    it("money #6: an accept the sweep already completed for THIS Helpr answers accepted, never a false 'captured, not hired' page", async () => {
      seedHire({}, { message: "offer_not_active", code: "P0001" });
      scenario.reads.jobs = { rows: [heldJob()], selectOverrides: [
        { includes: "category, is_seed, stripe_payment_intent_id", result: { rows: [heldJob({ payment_status: "escrow", stripe_payment_intent_id: "pi_hold" })] } },
        { includes: "helper_confirmed_at, helper_id", result: { rows: [{ helper_id: HELPR.id, helper_confirmed_at: new Date().toISOString() }] } },
      ] };
      const { res, payload } = await capture();
      expect(res.status).toBe(200);
      expect(payload.state).toBe("accepted");
      expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
      expect((slackAlerts as Array<{ title: string }>).some((a) => /captured but the hire did not complete/.test(String(a.title)))).toBe(false);
    });

    it("money #1 / silent #4: an off-session charge still PROCESSING is kept on the claim, and the resume reads it (never re-creates)", async () => {
      seedHire({ state: "scheduled", payment_intent_id: null, place_at: new Date(Date.now() + 86_400_000).toISOString() });
      stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_proc", status: "processing" });
      const first = await capture();
      expect(first.res.status).toBe(503);
      expect(updates("job_card_holds").find((w) => (w.payload as Record<string, unknown>).payment_intent_id === "pi_proc")?.filters)
        .toContainEqual({ op: "in", column: "state", value: ["capturing"] });

      resetStripeMock(); resetSupabaseMock(); resetSharedMocks(); setEnv(ENV);
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "capturing", capturing_from: "scheduled", payment_intent_id: "pi_proc", capture_amount_cents: 4200, updated_at: old(10 * 60_000) })] };
      scenario.reads.jobs = { rows: [heldJob()] };
      scenario.writeSelectRows = { jobs: [{ id: JOB }], job_card_holds: [{ job_id: JOB }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_proc", status: "succeeded" });
      await sweep();
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect(updates("jobs").find((w) => (w.payload as Record<string, unknown>).payment_status === "escrow")?.payload).toMatchObject({ stripe_payment_intent_id: "pi_proc" });
    });

    it("money #1: a CLOSED job's stale claim on a saved card whose recorded charge went through is refunded in full; one that did not is put back", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "capturing", capturing_from: "scheduled", payment_intent_id: "pi_proc", capture_amount_cents: 4200, updated_at: old(10 * 60_000) })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "cancelled", helper_id: null })] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }], jobs: [{ id: JOB }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_proc", status: "succeeded" });
      stripeMock.refunds.create.mockResolvedValue({ id: "re_1", status: "succeeded" });
      await sweep();
      expect(stripeMock.refunds.create).toHaveBeenCalledWith(expect.objectContaining({ payment_intent: "pi_proc" }), expect.anything());
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();

      resetStripeMock(); resetSupabaseMock(); resetSharedMocks(); setEnv(ENV);
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "capturing", capturing_from: "scheduled", payment_intent_id: "pi_proc", capture_amount_cents: 4200, updated_at: old(10 * 60_000) })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "cancelled", helper_id: null })] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }], jobs: [{ id: JOB }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_proc", status: "requires_payment_method" });
      await sweep();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
      expect(updates("job_card_holds").find((w) => (w.payload as Record<string, unknown>).state === "scheduled")?.payload)
        .toMatchObject({ state: "scheduled", payment_intent_id: null, capturing_from: null });
    });

    it("money #1: an off-session charge claim older than Stripe's 24-hour key is never re-sent (it could charge twice): a defect for ops", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "capturing", capturing_from: "scheduled", payment_intent_id: null, capture_amount_cents: 4200, updated_at: old(21 * 3_600_000) })] };
      scenario.reads.jobs = { rows: [heldJob()] };
      scenario.writeSelectRows = { jobs: [{ id: JOB }], job_card_holds: [{ job_id: JOB }] };
      const { payload } = await sweep();
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
      expect(JSON.stringify(payload)).toMatch(/older than its idempotency key/);
    });

    it("silent #2: a saved card Stripe refuses as an invalid request at the hire asks the poster (needs_action), never 'try again' forever", async () => {
      seedHire({ state: "scheduled", payment_intent_id: null, place_at: new Date(Date.now() + 86_400_000).toISOString() });
      stripeMock.paymentIntents.create.mockRejectedValue(stripeErr("No such PaymentMethod: 'pm_1'", { type: "StripeInvalidRequestError", code: "resource_missing", statusCode: 400 }));
      const { res, payload } = await capture();
      expect(res.status).toBe(409);
      expect(payload.code).toBe("payment_pending");
      expect(updates("job_card_holds").find((w) => (w.payload as Record<string, unknown>).state === "needs_action")?.payload)
        .toMatchObject({ failure_code: "invalid_request_resource_missing" });
      expect(notices().find((x) => x.user_id === POSTER.id)?.title).toBe(CARD_HOLD_COPY.confirmTitle);
    });

    it("silent #2: a key still in use is NOT a refusal: the claim stays for the same key (503)", async () => {
      seedHire({ state: "scheduled", payment_intent_id: null, place_at: new Date(Date.now() + 86_400_000).toISOString() });
      stripeMock.paymentIntents.create.mockRejectedValue(stripeErr("in use", { type: "StripeInvalidRequestError", code: "idempotency_key_in_use", statusCode: 400 }));
      const { res } = await capture();
      expect(res.status).toBe(503);
      expect(updates("job_card_holds").some((w) => ["needs_action", "failed"].includes(String((w.payload as Record<string, unknown>).state)))).toBe(false);
    });

    it("silent #2: a scheduled hold Stripe refuses as an invalid request asks the poster to confirm (no defect every run)", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "scheduled", payment_intent_id: null, place_at: old(60_000) })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null })] };
      scenario.reads.job_accept_pending = { rows: [] };
      scenario.reads.crew_confirm_pending = { rows: [] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }], jobs: [{ id: JOB }] };
      stripeMock.paymentIntents.create.mockRejectedValue(stripeErr("The customer does not have a payment method with the ID pm_1.", { type: "StripeInvalidRequestError", statusCode: 400 }));
      const { payload } = await sweep();
      expect(JSON.stringify(payload)).toMatch(/"failed_over":1/);
      expect(updates("job_card_holds").find((w) => (w.payload as Record<string, unknown>).state === "needs_action")).toBeTruthy();
    });

    it("silent #1: a capture the sweep RESUMES tells the Helpr whose accept rolled back that they can accept now", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "capturing", capturing_from: "authorized", capture_amount_cents: 4200, updated_at: old(10 * 60_000) })] };
      scenario.reads.jobs = { rows: [heldJob()] };
      scenario.reads.group_job_helpers = { rows: [] };
      scenario.writeSelectRows = { jobs: [{ id: JOB }], job_card_holds: [{ job_id: JOB }] };
      stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      const { payload } = await sweep();
      expect(JSON.stringify(payload)).toMatch(/"resumed":1/);
      const told = notices().find((x) => x.user_id === HELPR.id);
      expect(told?.title).toBe(CARD_HOLD_COPY.helprReadyTitle);
      expect(told?.message).toBe(CARD_HOLD_COPY.helprReady("Mow the yard"));
    });

    it("silent #5: a failed hold whose job still reads 'held' is taken off the listing again (nobody can be hired on it)", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ state: "failed", notified_state: "failed" })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null })] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }], jobs: [{ id: JOB }] };
      const { payload } = await sweep();
      const off = updates("jobs").find((w) => (w.payload as Record<string, unknown>).payment_status === "failed");
      expect(off?.payload).toEqual({ payment_status: "failed", stripe_session_id: null });
      expect(off?.filters).toContainEqual({ op: "eq", column: "payment_status", value: "held" });
      expect(JSON.stringify(payload)).toMatch(/still read 'held'; taken off the listing/);
    });

    it("silent #6: an authorization past its recorded window but still capturable is renewed, never left to lapse", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow({ capture_before: old(60_000) })] };
      scenario.reads.jobs = { rows: [heldJob({ status: "open", helper_id: null })] };
      scenario.reads.job_accept_pending = { rows: [] };
      scenario.reads.crew_confirm_pending = { rows: [] };
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }], jobs: [{ id: JOB }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "requires_capture" });
      stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_new", status: "requires_capture", amount: 4200, latest_charge: null });
      stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_hold", status: "canceled" });
      const { payload } = await sweep();
      expect(JSON.stringify(payload)).toMatch(/"renewed":1/);
    });
  });

  // Q2447 (finding: lh-money-escrow@756b4e7602#4): a held card captured for an accept that is then refused
  // charged the poster only because of our own race. The hold is marked 'captured_not_hired'; if the job then
  // closes with nobody hired, void-cancelled-payments refunds the WHOLE charge (own-mistake rule, owner
  // 2026-10-14), card fee included, keeping only a first job's one-time setup fee (A10 precedent, lead 11-03).
  // @mutate supabase/functions/create-payment/index.ts |         const marked = await markCapturedNotHired(supabaseAdmin, jobId, | const marked = false; void (supabaseAdmin, jobId,
  // @mutate supabase/functions/card-hold-sweep/index.ts |     const marked = await markCapturedNotHired(db, job.id, | const marked = false; void (db, job.id,
  // @mutate supabase/functions/void-cancelled-payments/index.ts |         if (h?.state === "captured" && h.failure_code === CAPTURED_NOT_HIRED && job.helper_confirmed_at == null) { |         if (false) {
  // @mutate supabase/functions/void-cancelled-payments/index.ts |             raceChargedNobodyHired = (count ?? 0) === 0; |             raceChargedNobodyHired = true;
  // @mutate supabase/functions/void-cancelled-payments/index.ts |         if (holdErr && !holdNotDeployed) { |         if (false) {
  // @mutate supabase/functions/void-cancelled-payments/index.ts |             job, sellerFault, platformFault: raceChargedNobodyHired, cancellationFeeCents: | job, sellerFault, platformFault: false, cancellationFeeCents:
  // @mutate supabase/functions/_shared/posterCancelSplit.ts |   const noCardFee = i.sellerFault \|\| i.platformFault === true; |   const noCardFee = i.sellerFault;
  // @mutate supabase/functions/_shared/cardHold.ts |     await updateHold(db, jobId, { failure_code: CAPTURED_NOT_HIRED, failure_message: why.slice(0, 500) }, ["captured"]); |     await updateHold(db, jobId, { failure_code: CAPTURED_NOT_HIRED, failure_message: why.slice(0, 500) });
  // @mutate supabase/functions/create-payment/index.ts |           message: `${posterName}'s held card was charged for ${helprName}'s accept on job ${jobId} ("${job.title ?? "untitled"}"), | message: `The held card was charged for an accept on job ${jobId},
  // @mutate supabase/functions/void-cancelled-payments/index.ts |                     ? `the one-time ${refundDollars(setupKeptCents)} account setup fee, which is paid once: your next job won't charge it again` |                     ? `the one-time ${refundDollars(setupKeptCents)} account setup fee, which is paid once and never refunded`
  describe("Q2447: captured for a hire that was then refused, nobody hired: the whole charge goes back", () => {
    const NAMES = [
      { column: "user_id", value: POSTER.id, result: { rows: [{ user_id: POSTER.id, full_name: "Dana Poster", stripe_account_id: null }] } },
      { column: "user_id", value: HELPR.id, result: { rows: [{ user_id: HELPR.id, full_name: "Hank Helpr", stripe_account_id: null }] } },
    ];
    const markWrites = () => updates("job_card_holds").filter((w) => (w.payload as Record<string, unknown>).failure_code === "captured_not_hired");

    it("capture_hold: the hold is marked (only while captured) and the page names the job, the poster and the Helpr", async () => {
      scenario.authUser = HELPR;
      scenario.reads.jobs = { rows: [heldJob()] };
      scenario.reads.job_card_holds = { rows: [holdRow()] };
      scenario.reads.group_job_helpers = { rows: [] };
      scenario.reads.profiles = { rows: [], eqOverrides: NAMES } as never;
      scenario.rpc.helper_accept_block_reason = null;
      scenario.writeSelectRows = { jobs: [{ id: JOB }], job_card_holds: [{ job_id: JOB }], profiles: [] };
      stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      let n = 0;
      scenario.rpcErrors = { get accept_job_offer() { return n++ === 0 ? { message: "payment_not_captured" } : { message: "offer_expired" }; } } as never;
      const fn = await loadEdgeFunction("create-payment");
      const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "capture_hold", jobId: JOB } }));
      expect(res.status).toBe(409);
      expect(markWrites()).toHaveLength(1);
      expect(markWrites()[0].filters).toContainEqual({ op: "in", column: "state", value: ["captured"] });
      const page = (slackAlerts as Array<{ title: string; message: string; fields?: Record<string, unknown>; seed?: boolean }>)
        .filter((a) => a.title === "A card hold was captured but the hire did not complete");
      expect(page).toHaveLength(1);
      expect(page[0].message).toContain(`Dana's held card was charged for Hank's accept on job ${JOB} ("Mow the yard")`);
      expect(page[0].message).toContain("Dana gets the whole charge back automatically");
      expect(page[0].fields).toMatchObject({ job_title: "Mow the yard", poster: "Dana", helpr: "Hank", full_refund_marked: "yes" });
      expect(page[0].seed).toBe(false);
    });

    it("card-hold-sweep: a pending accept refused after the capture marks the hold and names the people", async () => {
      scenario.reads.job_card_holds = { rows: [holdRow()] };
      scenario.reads.jobs = { rows: [heldJob()] };
      scenario.reads.job_accept_pending = { rows: [{ helper_id: HELPR.id }] };
      scenario.reads.profiles = { rows: [], eqOverrides: NAMES } as never;
      scenario.rpc.helper_accept_block_reason = null;
      scenario.rpc.complete_job_accept = false;
      scenario.writeSelectRows = { jobs: [{ id: JOB }], job_card_holds: [{ job_id: JOB }], profiles: [] };
      stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      const fn = await loadEdgeFunction("card-hold-sweep");
      await fn.fetch(fn.request({ headers: { Authorization: "Bearer service-key" }, body: {} }));
      expect(markWrites()).toHaveLength(1);
      const page = (slackAlerts as Array<{ title: string; message: string; fields?: Record<string, unknown> }>)
        .filter((a) => a.title === "A card hold was captured for a pending accept that did not complete");
      expect(page).toHaveLength(1);
      expect(page[0].message).toContain(`Dana's held card for Hank's pending accept on job ${JOB} ("Mow the yard")`);
      expect(page[0].fields).toMatchObject({ job_title: "Mow the yard", poster: "Dana", helpr: "Hank", full_refund_marked: "yes" });
    });

    const CRON = "cron-secret-q2447";
    const STRIPE_FEE = 152;
    /** The job after expiry: cancelled with nobody hired, its captured charge still in escrow. */
    function seedExpired(opts: { failureCode?: string | null; holdState?: string; setupFee?: boolean; group?: { confirmed: number }; holdReadError?: { message: string; code?: string } } = {}) {
      setEnv({ ...ENV, CRON_SECRET: CRON });
      scenario.reads.jobs = {
        rows: [],
        selectOverrides: [{
          includes: "cancellation_fee",
          result: { rows: [{
            id: JOB, title: "Mow the yard", stripe_session_id: null, stripe_payment_intent_id: "pi_hold", budget: 40,
            customer_fee_amount: 2, onboarding_fee_amount: opts.setupFee ? 2 : 0, cancellation_fee: 0, cancelled_by: null,
            date_needed: "2024-06-25", start_time: "10:00:00", cancelled_at: "2024-06-25T05:00:00Z", is_seed: false,
            helper_id: HELPR.id, helper_confirmed_at: null, customer_id: POSTER.id, helper_fee_percent: 10,
            is_group_job: !!opts.group, helpers_needed: opts.group ? 2 : 1,
          }] },
        }],
      } as never;
      scenario.reads.declutter_order_jobs = { rows: [] };
      scenario.reads.job_card_holds = opts.holdReadError
        ? { rows: [], error: opts.holdReadError }
        : { rows: [holdRow({ state: opts.holdState ?? "captured", failure_code: opts.failureCode === undefined ? "captured_not_hired" : opts.failureCode })] };
      scenario.reads.group_job_helpers = { rows: [], count: opts.group?.confirmed ?? 0 } as never;
      scenario.reads.crew_cancellation_fee_shares = { rows: [] };
      scenario.reads.crew_block_fees = { rows: [] };
      scenario.reads.payment_refunds = { rows: [] };
      scenario.reads.profiles = { rows: [{ stripe_account_id: "acct_helper", subscription_tier: null }] };
      const captured = 4200 + (opts.setupFee ? 200 : 0);
      stripeMock.paymentIntents.retrieve.mockResolvedValue({
        id: "pi_hold", status: "succeeded", amount: captured, amount_received: captured,
        latest_charge: { id: "ch_hold", amount_refunded: 0, balance_transaction: { fee: STRIPE_FEE } },
      });
      stripeMock.refunds.create.mockImplementation(async (p: { amount?: number }) => ({ id: "re_q2447", amount: p.amount ?? captured, currency: "usd" }));
      return captured;
    }
    async function runVoid() {
      const fn = await loadEdgeFunction("void-cancelled-payments");
      return fn.fetch(new Request("https://x/functions/v1/void-cancelled-payments", { method: "POST", headers: { Authorization: `Bearer ${CRON}` } }));
    }
    const refundAmounts = () => stripeMock.refunds.create.mock.calls.map((c) => (c[0] as { amount?: number }).amount);

    it("capture -> refused hire -> expiry: the refund is the FULL charge (card fee included), labelled as our race", async () => {
      const captured = seedExpired();
      await runVoid();
      expect(refundAmounts()).toEqual([captured]);
      const ledger = scenario.writes.filter((w) => w.table === "payment_refunds");
      expect(JSON.stringify(ledger.map((w) => w.payload))).toMatch(/hire that was then refused, nobody hired \(Q2447\): full refund, card fee included/);
    });

    it("control: the same expiry without the mark keeps Stripe's card fee", async () => {
      const captured = seedExpired({ failureCode: null });
      await runVoid();
      expect(refundAmounts()).toHaveLength(1);
      expect(refundAmounts()[0]).toBeLessThan(captured);
    });

    it("a first job's one-time $2 setup fee is still kept, and the poster is told the next job won't charge it again", async () => {
      const captured = seedExpired({ setupFee: true });
      await runVoid();
      expect(refundAmounts()).toEqual([captured - 200]);
      expect(JSON.stringify(notices())).toMatch(/account setup fee, which is paid once: your next job won't charge it again/);
      // The account stays marked paid: nothing here clears it.
      expect(updates("profiles").some((w) => "onboarding_fee_paid" in (w.payload as Record<string, unknown>))).toBe(false);
    });

    it("a crew with a confirmed member is not our race's: the card fee is kept", async () => {
      const captured = seedExpired({ group: { confirmed: 1 } });
      await runVoid();
      expect(refundAmounts()).toHaveLength(1);
      expect(refundAmounts()[0]).toBeLessThan(captured);
    });

    it("a crew with nobody confirmed gets the full charge back", async () => {
      const captured = seedExpired({ group: { confirmed: 0 } });
      await runVoid();
      expect(refundAmounts()).toEqual([captured]);
    });

    it("a hold read that fails moves no money this run", async () => {
      seedExpired({ holdReadError: { message: "boom", code: "XX000" } });
      await runVoid();
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("a hold table that is not deployed reads 'not marked' (the card fee is kept)", async () => {
      const captured = seedExpired({ holdReadError: { message: "missing", code: "42P01" } });
      await runVoid();
      expect(refundAmounts()).toHaveLength(1);
      expect(refundAmounts()[0]).toBeLessThan(captured);
    });

    // Lead PASS 2026-11-03: a real hire clears the mark (20261103110232 trigger on jobs.helper_confirmed_at and a crew
    // seat's, proven in src/test/pglite/clearCapturedNotHiredOnHire.pglite.mjs), so a Helpr hired on that money and
    // then removed leaves the hold unmarked: the cancel keeps the card fee like any other.
    it("hired, then removed before the close: the hire cleared the mark, so the card fee is kept", async () => {
      const captured = seedExpired({ failureCode: null });
      await runVoid();
      expect(refundAmounts()).toHaveLength(1);
      expect(refundAmounts()[0]).toBeLessThan(captured);
    });

    // @mutate supabase/migrations/20261103110232_clear_captured_not_hired_on_hire.sql |      AND failure_code = 'captured_not_hired'; |      AND failure_code IS NULL;
    // @mutate supabase/migrations/20261103110232_clear_captured_not_hired_on_hire.sql |   WHEN (OLD.helper_confirmed_at IS NULL AND NEW.helper_confirmed_at IS NOT NULL) |   WHEN (false)
    // @mutate supabase/migrations/20261103110232_clear_captured_not_hired_on_hire.sql |   AFTER INSERT OR UPDATE OF helper_confirmed_at ON public.group_job_helpers |   AFTER DELETE ON public.group_job_helpers
    it("the newest migration clears ONLY a captured_not_hired mark, on a job's hire and on a crew seat's", () => {
      const dir = resolve(process.cwd(), "supabase/migrations");
      const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
      let fnText = ""; let jobsTrig = ""; let seatTrig = "";
      for (const f of files) {
        const sql = blankSqlComments(readFileSync(resolve(dir, f), "utf8"));
        const fm = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.clear_captured_not_hired_on_hire\s*\([\s\S]*?\bAS\s+(\$[A-Za-z_]*\$)([\s\S]*?)\1/i.exec(sql);
        if (fm) fnText = fm[2];
        const jt = /CREATE\s+TRIGGER\s+trg_jobs_hire_clears_captured_not_hired[\s\S]*?;/i.exec(sql);
        if (jt) jobsTrig = jt[0];
        const st = /CREATE\s+TRIGGER\s+trg_crew_seat_hire_clears_captured_not_hired[\s\S]*?;/i.exec(sql);
        if (st) seatTrig = st[0];
      }
      const norm = (t: string) => t.replace(/\s+/g, " ");
      expect(norm(fnText)).toMatch(/UPDATE public\.job_card_holds SET failure_code = NULL/);
      expect(norm(fnText)).toContain("AND failure_code = 'captured_not_hired'");
      expect(norm(jobsTrig)).toContain("AFTER UPDATE OF helper_confirmed_at ON public.jobs");
      expect(norm(jobsTrig)).toContain("WHEN (OLD.helper_confirmed_at IS NULL AND NEW.helper_confirmed_at IS NOT NULL)");
      expect(norm(seatTrig)).toContain("AFTER INSERT OR UPDATE OF helper_confirmed_at ON public.group_job_helpers");
      expect(norm(seatTrig)).toContain("WHEN (NEW.helper_confirmed_at IS NOT NULL)");
      expect(files.length).toBeGreaterThan(1000);
    });

    it("reads a real inventory (floor): the fee-keeping control refunds a real amount", async () => {
      seedExpired({ failureCode: null });
      await runVoid();
      const kept = refundAmounts()[0] ?? 0;
      expect(kept).toBeGreaterThan(0);
    });
  });
});
