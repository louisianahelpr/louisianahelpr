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
 * @mutate supabase/functions/_shared/cardHold.ts | return { card: { ...(threeDS?.card ?? {}), capture_method: "manual" }, link: { capture_method: "manual" } }; | return { card: { ...(threeDS?.card ?? {}) }, link: {} } as never;
 * @mutate supabase/functions/_shared/cardHold.ts |   if (!Number.isFinite(start) \|\| start - nowMs <= HOLD_AT_POST_WITHIN_MS) return { kind: "hold_now" }; |   return { kind: "hold_now" };
 * @mutate supabase/functions/_shared/cardHold.ts |   if (capturedPi) { |   if (false) {
 * @mutate supabase/functions/_shared/cardHold.ts |       else if (now.status === "requires_capture") { |       else if (false) {
 * @mutate supabase/functions/_shared/cardHold.ts |   const amountCents = Number(hold.amount_cents) - (Number(hold.onboarding_fee_cents ?? 0) > 0 && !fee.claimed ? Number(hold.onboarding_fee_cents) : 0); |   const amountCents = Number(hold.amount_cents);
 * @mutate supabase/functions/_shared/cardHold.ts |   if (!(amountCents < THREE_D_SECURE_MIN_CENTS)) return { ok: false, why: "large" }; |   if (false) return { ok: false, why: "large" };
 * @mutate supabase/functions/create-payment/index.ts |       if (!offerOpen && !directOpen && !seatOpen) throw new PublicError("Not authorized"); |       if (false) throw new PublicError("Not authorized");
 * @mutate supabase/functions/create-payment/index.ts |       if (block != null) return json({ state: "not_ready" }); |       if (false) return json({ state: "not_ready" });
 * @mutate supabase/functions/create-payment/index.ts |       const cardHold = !payInFour && await featureEnabledForUser(supabaseAdmin, CARD_HOLD_SWITCH, user) && !(await quoteBooked()); |       const cardHold = !payInFour && await featureEnabledForUser(supabaseAdmin, CARD_HOLD_SWITCH, user);
 * @mutate supabase/functions/stripe-webhook/handlers/cardHoldCheckout.ts |   if (pi.status !== "requires_capture") return false; |   if (false) return false;
 * @mutate supabase/functions/card-hold-sweep/index.ts |         if (!job \|\| ["cancelled", "completed"].includes(String(job.status))) { |         if (false) {
 */
import { describe, it, expect, beforeEach } from "vitest";
import { loadEdgeFunction, type EdgeHarness } from "./harness";
import { setEnv, resetEnv } from "./mocks/deno-runtime";
import { stripeMock, resetStripeMock } from "./mocks/stripe";
import { scenario, resetSupabaseMock } from "./mocks/supabase";
import { resetSharedMocks } from "./mocks/shared";
import { CARD_HOLD_COPY } from "../../../supabase/functions/_shared/cardHoldCopy";
import { holdPlanFor, offSessionAllowed, PLACE_BEFORE_START_MS } from "../../../supabase/functions/_shared/cardHold";
import { jobLocalStartMs } from "../../../supabase/functions/_shared/cancellationFee";

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
      expect(offSessionAllowed(5_000, "assembly")).toEqual({ ok: false, why: "taxed" });
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
      expect(args?.metadata?.card_hold).toBeUndefined();
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
    }
    async function capture(as = HELPR) {
      scenario.authUser = as;
      const fn = await loadEdgeFunction("create-payment");
      const res = await fn.fetch(fn.request({ headers: AUTH, body: { action: "capture_hold", jobId: JOB } }));
      return { res, payload: JSON.parse(await res.text()) as Record<string, unknown> };
    }

    it("captures the hold and moves the job to escrow (then the accept completes as today)", async () => {
      seedHire();
      stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      const { res, payload } = await capture();
      expect(res.status).toBe(200);
      expect(payload.state).toBe("captured");
      expect(stripeMock.paymentIntents.capture).toHaveBeenCalledWith("pi_hold", { amount_to_capture: 4200 },
        expect.objectContaining({ idempotencyKey: "card-hold-capture-pi_hold-4200-a0" }));
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

    it("a timeout with the hold still capturable changes nothing (503, nobody told)", async () => {
      seedHire();
      stripeMock.paymentIntents.capture.mockRejectedValue(new Error("socket hang up"));
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "requires_capture" });
      const { res } = await capture();
      expect(res.status).toBe(503);
      expect(updates("jobs")).toHaveLength(0);
      expect(notices()).toHaveLength(0);
    });

    it("only the Helpr the live offer names may capture", async () => {
      seedHire();
      const { res } = await capture({ id: "stranger-1", email: "s@test.com" });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
    });

    it("an unready Helpr captures nothing: their accept is recorded pending, as today", async () => {
      seedHire({ ready: false });
      const { payload } = await capture();
      expect(payload.state).toBe("not_ready");
      expect(stripeMock.paymentIntents.capture).not.toHaveBeenCalled();
    });

    it("the $2 setup fee: collected when this capture claims it, left out (no refund) when another job did", async () => {
      seedHire({ hold: { amount_cents: 4400, onboarding_fee_cents: 200 }, feeClaimed: false });
      stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      await capture();
      expect(stripeMock.paymentIntents.capture).toHaveBeenLastCalledWith("pi_hold", { amount_to_capture: 4200 }, expect.anything());

      resetStripeMock(); resetSupabaseMock(); setEnv(ENV);
      seedHire({ hold: { amount_cents: 4400, onboarding_fee_cents: 200 }, feeClaimed: true });
      stripeMock.paymentIntents.capture.mockResolvedValue({ id: "pi_hold", status: "succeeded" });
      await capture();
      expect(stripeMock.paymentIntents.capture).toHaveBeenLastCalledWith("pi_hold", { amount_to_capture: 4400 }, expect.anything());
      expect(updates("jobs").find((w) => (w.payload as Record<string, unknown>).payment_status === "escrow")?.payload)
        .toMatchObject({ onboarding_fee_amount: 2 });
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();
    });

    it("a saved card (no hold yet) under $300 is charged off-session at the hire", async () => {
      seedHire({ hold: { state: "scheduled", payment_intent_id: null, place_at: new Date(Date.now() + 86_400_000).toISOString() } });
      stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_charge", status: "succeeded" });
      const { payload } = await capture();
      expect(payload.state).toBe("captured");
      const [params] = stripeMock.paymentIntents.create.mock.calls[0];
      expect(params).toMatchObject({ amount: 4200, off_session: true, confirm: true, payment_method: "pm_1", customer: "cus_1" });
      expect(params.metadata).toMatchObject({ job_id: JOB, card_hold: "1", card_hold_off_session: "1" });
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
      scenario.reads.job_card_holds = { rows: [holdRow({ notified_state: null, amount_cents: 4200 })] };
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
      expect(notices().find((x) => x.user_id === POSTER.id)?.message).toBe(CARD_HOLD_COPY.held(4200));
      // the setup fee is NOT settled on a hold (it is collected at the capture)
      expect(updates("profiles").some((w) => (w.payload as Record<string, unknown>).onboarding_fee_paid === true)).toBe(false);
    });

    it("a bank payment on the hold checkout (captured, not held) takes today's path", async () => {
      scenario.reads.jobs = { rows: [{ id: JOB, budget: 40, category: "yard_work", is_seed: false }] };
      scenario.writeSelectRows = { jobs: [{ id: JOB }] };
      stripeMock.paymentIntents.retrieve.mockResolvedValue({ id: "pi_hold", status: "processing", amount: 4200, metadata: { job_id: JOB } });
      await deliver(session());
      expect(updates("jobs").some((w) => (w.payload as Record<string, unknown>).payment_status === "held")).toBe(false);
      expect(updates("jobs").some((w) => (w.payload as Record<string, unknown>).stripe_payment_intent_id === "pi_hold")).toBe(true);
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
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }] };
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
      scenario.writeSelectRows = { job_card_holds: [{ job_id: JOB }] };
      stripeMock.paymentIntents.create.mockResolvedValue({ id: "pi_renewed", status: "requires_capture", amount: 4200, latest_charge: null });
      stripeMock.paymentIntents.cancel.mockResolvedValue({ id: "pi_hold", status: "canceled" });
      const { payload } = await sweep();
      expect(JSON.stringify(payload)).toMatch(/"renewed":1/);
      expect(stripeMock.paymentIntents.cancel).toHaveBeenCalledWith("pi_hold", { cancellation_reason: "abandoned" }, expect.anything());
    });
  });
});
